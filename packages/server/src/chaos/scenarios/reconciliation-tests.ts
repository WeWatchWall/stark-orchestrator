/**
 * Chaos Scenarios: Reconciliation Tests
 *
 * These scenarios verify that Stark converges to a single authoritative
 * pod state under realistic failure and recovery conditions.
 *
 * TIMING CONSTANTS (from actual code):
 * ────────────────────────────────────────────────────────────────────────
 * • heartbeatInterval (node sends):     15,000 ms  (node-agent.ts)
 * • heartbeatTimeout → SUSPECT:         60,000 ms  (node-health-service.ts)
 * • leaseTimeout → OFFLINE:            120,000 ms  (node-health-service.ts)
 * • healthCheckInterval:                30,000 ms  (node-health-service.ts)
 * • reconcileInterval:                  10,000 ms  (service-controller.ts)
 *
 * RECONNECTION BACKOFF (node-agent.ts):
 * • Initial delay: 5,000 ms
 * • Multiplier: min(attempt, 5)
 * • Max attempts: 10 (by default)
 * • Total time to exhaust: ~200,000 ms (3.3 min)
 *
 * ────────────────────────────────────────────────────────────────────────
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { getNodeQueries } from '../../supabase/nodes.js';
import { getPodQueriesAdmin } from '../../supabase/pods.js';
import { getServiceQueriesAdmin } from '../../supabase/services.js';
import type { ChaosScenario, ScenarioResult, OptionHelp } from './types';
import type { PodListItem } from '@stark-o/shared';

// ─────────────────────────────────────────────────────────────────────────────
// TIMING CONSTANTS (extracted from actual codebase)
// ─────────────────────────────────────────────────────────────────────────────

const TIMING = {
  /** Time from last heartbeat until node marked SUSPECT */
  HEARTBEAT_TIMEOUT_MS: 60_000,
  /** Time in SUSPECT state before node marked OFFLINE */
  LEASE_TIMEOUT_MS: 120_000,
  /** How often the health service checks node status */
  HEALTH_CHECK_INTERVAL_MS: 30_000,
  /** How often the service controller reconciles */
  RECONCILE_INTERVAL_MS: 10_000,
  /** How often nodes send heartbeats */
  HEARTBEAT_INTERVAL_MS: 15_000,
  /** Time for node to exhaust all reconnection attempts */
  RECONNECTION_EXHAUSTION_MS: 200_000,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

function banner(text: string): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`⚡ ${text}`);
  console.log(`${'═'.repeat(70)}\n`);
}

function section(text: string): void {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`│ ${text}`);
  console.log(`${'─'.repeat(50)}`);
}

function verify(instruction: string): void {
  console.log(`\n✓ VERIFY: ${instruction}`);
}

function timeline(eventName: string, elapsedMs: number): void {
  console.log(`    [T+${formatTime(elapsedMs).padEnd(7)}] ${eventName}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1: Node Ban → Reschedule → Unban Reconciliation
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeBanReconciliationOptions {
  /** Node to ban (will have pod rescheduled away) */
  nodeAId: string;
  /** Alternative node for rescheduling */
  nodeBId: string;
  /**
   * Mode:
   * - 'standard': Ban, wait for reschedule, unban, verify stale cleanup
   * - 'fast_unban': Unban BEFORE OFFLINE (pod should NOT move)
   * - 'late_unban': Unban AFTER reconnection exhausted (node may need restart)
   */
  mode: 'standard' | 'fast_unban' | 'late_unban';
}

export const nodeBanReconciliationScenario: ChaosScenario<NodeBanReconciliationOptions> = {
  name: 'node-ban-reconciliation',
  description: 'Test node ban/unban with pod rescheduling and stale state cleanup',

  async validate(options): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }
    if (!options.nodeAId || !options.nodeBId) {
      return { valid: false, error: 'Both nodeAId and nodeBId are required' };
    }
    if (options.nodeAId === options.nodeBId) {
      return { valid: false, error: 'nodeAId and nodeBId must be different' };
    }
    return { valid: true };
  },

  async execute(options): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const nodeQueries = getNodeQueries();
    const podQueries = getPodQueriesAdmin();
    const startTime = Date.now();
    const events: string[] = [];

    banner(`CHAOS SCENARIO: Node Ban Reconciliation (${options.mode})`);

    // ─────────────────────────────────────────────────────────────────────────
    // Print timing expectations
    // ─────────────────────────────────────────────────────────────────────────
    
    section('TIMING WINDOWS (from actual code constants)');
    console.log(`
    Node health state transitions:
    ├─ T+0s:     Node banned (heartbeats stop arriving)
    ├─ T+60s:    Node marked SUSPECT (heartbeat timeout)
    ├─ T+90s:    Node marked OFFLINE (worst case: +30s health check)
    ├─ T+100s:   Pods rescheduled (next reconcile cycle)
    └─ T+200s:   Node exhausts reconnection attempts (gives up)

    Key timing constants:
    • HEARTBEAT_TIMEOUT_MS:   ${TIMING.HEARTBEAT_TIMEOUT_MS}ms (${formatTime(TIMING.HEARTBEAT_TIMEOUT_MS)})
    • LEASE_TIMEOUT_MS:       ${TIMING.LEASE_TIMEOUT_MS}ms (${formatTime(TIMING.LEASE_TIMEOUT_MS)})
    • RECONCILE_INTERVAL_MS:  ${TIMING.RECONCILE_INTERVAL_MS}ms
    • RECONNECT_EXHAUSTION:   ~${TIMING.RECONNECTION_EXHAUSTION_MS}ms (${formatTime(TIMING.RECONNECTION_EXHAUSTION_MS)})
    `);

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // Initial state capture
      // ─────────────────────────────────────────────────────────────────────────
      
      section('INITIAL STATE');
      
      const nodeAInitial = await nodeQueries.getNodeById(options.nodeAId);
      const nodeBInitial = await nodeQueries.getNodeById(options.nodeBId);
      
      console.log(`    NodeA (${options.nodeAId}): ${nodeAInitial.data?.status ?? 'NOT FOUND'}`);
      console.log(`    NodeB (${options.nodeBId}): ${nodeBInitial.data?.status ?? 'NOT FOUND'}`);
      
      // Get pods on NodeA before ban
      const podsOnABefore = await podQueries.listPods({ nodeId: options.nodeAId });
      console.log(`    Pods on NodeA: ${podsOnABefore.data?.length ?? 0}`);
      podsOnABefore.data?.forEach((pod: PodListItem) => {
        console.log(`      • ${pod.id} (${pod.status})`);
      });
      
      events.push(`Initial: NodeA=${nodeAInitial.data?.status}, NodeB=${nodeBInitial.data?.status}`);
      events.push(`Pods on NodeA before ban: ${podsOnABefore.data?.length ?? 0}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Execute based on mode
      // ─────────────────────────────────────────────────────────────────────────
      
      let unbanDelayMs: number;
      
      switch (options.mode) {
        case 'standard':
          // Unban after reschedule but before reconnection exhaustion
          unbanDelayMs = 160_000; // T+160s
          break;
        case 'fast_unban':
          // Unban before SUSPECT - should NOT trigger reschedule
          unbanDelayMs = 30_000; // T+30s (before 60s SUSPECT threshold)
          break;
        case 'late_unban':
          // Unban after reconnection exhaustion
          unbanDelayMs = 300_000; // T+300s
          break;
      }

      section(`CHAOS EVENT: Banning NodeA (${options.nodeAId})`);
      console.log(`    Mode: ${options.mode}`);
      console.log(`    Planned unban delay: ${formatTime(unbanDelayMs)}`);
      console.log(`    Expected state at unban:`);
      
      if (options.mode === 'fast_unban') {
        console.log(`      • NodeA: Still ONLINE (ban too short)`);
        console.log(`      • Pods: Should remain on NodeA`);
      } else {
        console.log(`      • NodeA: OFFLINE`);
        console.log(`      • Pods: Should be rescheduled to NodeB`);
      }

      // BAN THE NODE
      const banTime = Date.now();
      const banned = chaos.banNode(options.nodeAId);
      timeline('NodeA BANNED', 0);
      events.push(`T+0: NodeA banned (success=${banned})`);

      // ─────────────────────────────────────────────────────────────────────────
      // Wait and monitor
      // ─────────────────────────────────────────────────────────────────────────

      section('WAITING FOR STATE TRANSITIONS');
      console.log(`    Monitoring every 15s until unban at T+${formatTime(unbanDelayMs)}...\n`);
      
      const monitorInterval = 15_000;
      let elapsed = 0;
      
      // Monitor until unban time
      while (elapsed < unbanDelayMs) {
        await sleep(monitorInterval);
        elapsed = Date.now() - banTime;
        
        const nodeAStatus = await nodeQueries.getNodeById(options.nodeAId);
        const nodeBStatus = await nodeQueries.getNodeById(options.nodeBId);
        const podsOnA = await podQueries.listPods({ nodeId: options.nodeAId });
        const podsOnB = await podQueries.listPods({ nodeId: options.nodeBId });
        
        timeline(
          `NodeA=${nodeAStatus.data?.status ?? '?'}, NodeB=${nodeBStatus.data?.status ?? '?'}, ` +
          `PodsA=${podsOnA.data?.length ?? 0}, PodsB=${podsOnB.data?.length ?? 0}`,
          elapsed
        );
        
        events.push(`T+${formatTime(elapsed)}: NodeA=${nodeAStatus.data?.status}, pods_A=${podsOnA.data?.length}, pods_B=${podsOnB.data?.length}`);
        
        // Exit early if we've been monitoring for too long
        if (elapsed >= unbanDelayMs) break;
      }

      // ─────────────────────────────────────────────────────────────────────────
      // UNBAN THE NODE
      // ─────────────────────────────────────────────────────────────────────────

      section('CHAOS EVENT: Unbanning NodeA');
      const actualUnbanDelay = Date.now() - banTime;
      timeline('NodeA UNBANNED', actualUnbanDelay);
      
      const unbanned = chaos.unbanNode(options.nodeAId);
      events.push(`T+${formatTime(actualUnbanDelay)}: NodeA unbanned (success=${unbanned})`);

      console.log(`\n    Now waiting for NodeA to reconnect and report state...`);
      console.log(`    If NodeA has stale pods, orchestrator should send pod:stop`);

      // ─────────────────────────────────────────────────────────────────────────
      // Post-unban monitoring
      // ─────────────────────────────────────────────────────────────────────────

      section('POST-UNBAN STATE (monitoring for 60s)');
      
      const postUnbanMonitorMs = 60_000;
      const postUnbanStart = Date.now();
      let postElapsed = 0;
      
      while (postElapsed < postUnbanMonitorMs) {
        await sleep(10_000);
        postElapsed = Date.now() - postUnbanStart;
        const totalElapsed = Date.now() - banTime;
        
        const nodeAStatus = await nodeQueries.getNodeById(options.nodeAId);
        const podsOnA = await podQueries.listPods({ nodeId: options.nodeAId });
        const podsOnB = await podQueries.listPods({ nodeId: options.nodeBId });
        
        // Count running pods vs all pods
        const runningOnA = podsOnA.data?.filter((p: PodListItem) => p.status === 'running').length ?? 0;
        const runningOnB = podsOnB.data?.filter((p: PodListItem) => p.status === 'running').length ?? 0;
        
        timeline(
          `NodeA=${nodeAStatus.data?.status ?? '?'} (running_pods=${runningOnA}), ` + 
          `NodeB running_pods=${runningOnB}`,
          totalElapsed
        );
        
        events.push(`T+${formatTime(totalElapsed)}: NodeA=${nodeAStatus.data?.status}, running_A=${runningOnA}, running_B=${runningOnB}`);
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Final state and verification instructions
      // ─────────────────────────────────────────────────────────────────────────

      section('FINAL STATE');
      
      const nodeAFinal = await nodeQueries.getNodeById(options.nodeAId);
      const nodeBFinal = await nodeQueries.getNodeById(options.nodeBId);
      const finalPodsOnA = await podQueries.listPods({ nodeId: options.nodeAId });
      const finalPodsOnB = await podQueries.listPods({ nodeId: options.nodeBId });
      
      console.log(`    NodeA: ${nodeAFinal.data?.status ?? 'NOT FOUND'}`);
      console.log(`    NodeB: ${nodeBFinal.data?.status ?? 'NOT FOUND'}`);
      console.log(`    Pods on NodeA: ${finalPodsOnA.data?.length ?? 0}`);
      finalPodsOnA.data?.forEach((pod: PodListItem) => {
        console.log(`      • ${pod.id}: ${pod.status}`);
      });
      console.log(`    Pods on NodeB: ${finalPodsOnB.data?.length ?? 0}`);
      finalPodsOnB.data?.forEach((pod: PodListItem) => {
        console.log(`      • ${pod.id}: ${pod.status}`);
      });

      // ─────────────────────────────────────────────────────────────────────────
      // Manual verification instructions
      // ─────────────────────────────────────────────────────────────────────────

      section('MANUAL VERIFICATION');
      
      if (options.mode === 'standard') {
        verify('Exactly ONE pod should exist (across both nodes)');
        verify('Pod should remain on NodeB (NOT reclaimed by NodeA)');
        verify('If NodeA reconnected with stale pod, orchestrator sent pod:stop');
        verify('No pods in permanent "stopping" state');
        console.log(`
    How to verify:
    1. Check the events log above - look for:
       • NodeA transitioning ONLINE → SUSPECT → OFFLINE
       • Pod count on NodeB increasing after NodeA went OFFLINE
       • After unban: NodeA reconnected, any stale pods stopped
       
    2. Check chaos proxy events for 'pod:stop' messages sent to NodeA
    
    3. Database should show exactly 1 running pod total
        `);
      } else if (options.mode === 'fast_unban') {
        verify('NodeA should still be ONLINE (never reached SUSPECT)');
        verify('Pods should remain on NodeA (no rescheduling occurred)');
        verify('No pod duplication');
        console.log(`
    How to verify:
    1. NodeA status should have stayed ONLINE throughout
    2. Pod count should be unchanged
    3. No reschedule events in service controller logs
        `);
      } else if (options.mode === 'late_unban') {
        verify('Node may need manual restart (reconnection exhausted)');
        verify('Pods should all be on NodeB');
        verify('Database is consistent even if node never reconnects');
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        scenario: 'node-ban-reconciliation',
        mode: options.mode,
        duration,
        events,
        stats: chaos.getStats(),
        data: {
          nodeAFinalStatus: nodeAFinal.data?.status,
          nodeBFinalStatus: nodeBFinal.data?.status,
          finalPodsOnA: finalPodsOnA.data?.length ?? 0,
          finalPodsOnB: finalPodsOnB.data?.length ?? 0,
        },
      };

    } catch (error) {
      // Always try to unban on error
      chaos.unbanNode(options.nodeAId);
      
      return {
        success: false,
        scenario: 'node-ban-reconciliation',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options): string[] {
    switch (options.mode) {
      case 'standard':
        return [
          'NodeA goes ONLINE → SUSPECT (60s) → OFFLINE (120s)',
          'Pod rescheduled to NodeB after NodeA is OFFLINE',
          'After unban, NodeA reconnects but does NOT reclaim pod',
          'If NodeA reports stale pod, orchestrator sends pod:stop',
          'Exactly 1 pod running at convergence',
        ];
      case 'fast_unban':
        return [
          'NodeA never reaches SUSPECT (unban before 60s)',
          'No rescheduling occurs',
          'Pod remains on NodeA',
          'No state inconsistency',
        ];
      case 'late_unban':
        return [
          'NodeA exhausts reconnection attempts before unban',
          'Pod is on NodeB',
          'NodeA may need manual restart to rejoin cluster',
        ];
      default:
        return [];
    }
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'nodeAId',
        type: 'string',
        required: true,
        description: 'Node ID to ban (will have pods rescheduled away)',
        example: 'my-node-1',
      },
      {
        name: 'nodeBId',
        type: 'string',
        required: true,
        description: 'Alternative node ID for rescheduling',
        example: 'my-node-2',
      },
      {
        name: 'mode',
        type: 'string',
        required: false,
        description: 'Test mode (default: standard)',
        choices: ['standard', 'fast_unban', 'late_unban'],
        example: 'standard',
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2: Heartbeat Delay Without Disconnect (with convergence checks)
// ─────────────────────────────────────────────────────────────────────────────

export interface HeartbeatDelayConvergenceOptions {
  nodeId: string;
  /** 
   * Delay to inject. Must consider the thresholds:
   * - < 60s: No state change expected
   * - 60-90s: Should become SUSPECT but not OFFLINE
   * - > 90s: Should go OFFLINE and trigger reschedule
   */
  delayMs: number;
  /** How long to run the test */
  durationMs: number;
}

export const heartbeatDelayConvergenceScenario: ChaosScenario<HeartbeatDelayConvergenceOptions> = {
  name: 'heartbeat-delay-convergence',
  description: 'Test heartbeat delays with explicit convergence verification',

  async validate(options): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }
    if (!options.nodeId) {
      return { valid: false, error: 'nodeId is required' };
    }
    if (options.delayMs < 0) {
      return { valid: false, error: 'delayMs must be positive' };
    }
    return { valid: true };
  },

  async execute(options): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const nodeQueries = getNodeQueries();
    const podQueries = getPodQueriesAdmin();
    const startTime = Date.now();
    const events: string[] = [];

    banner(`CHAOS SCENARIO: Heartbeat Delay Convergence`);

    // ─────────────────────────────────────────────────────────────────────────
    // Predict expected behavior based on delay
    // ─────────────────────────────────────────────────────────────────────────

    section('TIMING ANALYSIS');
    
    const effectiveDelay = options.delayMs;
    let expectedBehavior: string;
    
    // Heartbeat interval is 15s, so effective "time since last heartbeat" = delay
    // Node goes SUSPECT if no heartbeat for 60s
    // Node goes OFFLINE if no heartbeat for 120s
    
    if (effectiveDelay < TIMING.HEARTBEAT_TIMEOUT_MS) {
      expectedBehavior = 'ONLINE (delay < 60s heartbeat timeout)';
    } else if (effectiveDelay < TIMING.LEASE_TIMEOUT_MS) {
      expectedBehavior = 'SUSPECT (60s < delay < 120s)';
    } else {
      expectedBehavior = 'OFFLINE (delay > 120s)';
    }

    console.log(`
    Injecting ${formatTime(options.delayMs)} delay to heartbeats
    
    Thresholds:
    • < 60s:   Node stays ONLINE          (30s delay ✓)
    • 60-120s: Node becomes SUSPECT       (90s delay ⚠)
    • > 120s:  Node becomes OFFLINE       (150s delay ✗)
    
    Your delay: ${formatTime(options.delayMs)}
    Expected state: ${expectedBehavior}
    
    Duration: ${formatTime(options.durationMs)}
    `);

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // Capture initial state
      // ─────────────────────────────────────────────────────────────────────────

      section('INITIAL STATE');
      
      const initialNode = await nodeQueries.getNodeById(options.nodeId);
      const initialPods = await podQueries.listPods({ nodeId: options.nodeId });
      const initialPodCount = initialPods.data?.filter((p: PodListItem) => p.status === 'running').length ?? 0;
      
      console.log(`    Node: ${initialNode.data?.status ?? 'NOT FOUND'}`);
      console.log(`    Running pods: ${initialPodCount}`);
      
      events.push(`Initial: Node=${initialNode.data?.status}, running_pods=${initialPodCount}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Inject heartbeat delay
      // ─────────────────────────────────────────────────────────────────────────

      section('INJECTING HEARTBEAT DELAY');
      
      chaos.addMessageRule({
        messageTypes: ['node:heartbeat'],
        direction: 'incoming',
        nodeId: options.nodeId,
        dropRate: 0,
        delayMs: options.delayMs,
      });
      
      timeline(`Heartbeat delay rule applied: ${options.delayMs}ms`, 0);
      events.push(`T+0: Heartbeat delay rule applied (${options.delayMs}ms)`);

      // ─────────────────────────────────────────────────────────────────────────
      // Monitor
      // ─────────────────────────────────────────────────────────────────────────

      section('MONITORING');
      console.log(`    Watching for ${formatTime(options.durationMs)}...\n`);
      
      const monitorInterval = 10_000;
      const injectTime = Date.now();
      let overServiceDetected = false;
      let maxPodCount = initialPodCount;
      
      while (Date.now() - injectTime < options.durationMs) {
        await sleep(monitorInterval);
        const elapsed = Date.now() - injectTime;
        
        const nodeStatus = await nodeQueries.getNodeById(options.nodeId);
        const currentPods = await podQueries.listPods({ nodeId: options.nodeId });
        const runningPods = currentPods.data?.filter((p: PodListItem) => p.status === 'running').length ?? 0;
        
        if (runningPods > maxPodCount) {
          overServiceDetected = true;
          maxPodCount = runningPods;
        }
        
        // Check for pod duplication by looking at service-level counts
        // (Would need service context for real check)
        
        timeline(`Node=${nodeStatus.data?.status ?? '?'}, running_pods=${runningPods}`, elapsed);
        events.push(`T+${formatTime(elapsed)}: Node=${nodeStatus.data?.status}, running_pods=${runningPods}`);
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Clean up delay rule
      // ─────────────────────────────────────────────────────────────────────────

      section('REMOVING DELAY RULE');
      chaos.clearMessageRules();
      timeline(`Heartbeat delay rule removed`, Date.now() - injectTime);
      events.push(`Delay rule removed`);

      // Let system recover
      console.log(`    Waiting 30s for recovery...\n`);
      await sleep(30_000);

      // ─────────────────────────────────────────────────────────────────────────
      // Final state
      // ─────────────────────────────────────────────────────────────────────────

      section('FINAL STATE');
      
      const finalNode = await nodeQueries.getNodeById(options.nodeId);
      const finalPods = await podQueries.listPods({ nodeId: options.nodeId });
      const finalPodCount = finalPods.data?.filter((p: PodListItem) => p.status === 'running').length ?? 0;
      
      console.log(`    Node: ${finalNode.data?.status ?? 'NOT FOUND'}`);
      console.log(`    Running pods: ${finalPodCount}`);
      console.log(`    Max pod count during test: ${maxPodCount}`);
      console.log(`    Over-service detected: ${overServiceDetected ? 'YES ⚠' : 'NO ✓'}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Verification
      // ─────────────────────────────────────────────────────────────────────────

      section('MANUAL VERIFICATION');
      
      verify('No over-service occurred (pod count never exceeded initial)');
      verify('No duplicate pods created');
      verify('System converged correctly after delay removed');
      verify(`Node reached expected state: ${expectedBehavior}`);
      
      console.log(`
    Check points:
    1. If delay < 60s: Node should have stayed ONLINE throughout
    2. If delay was 60-120s: Node may have become SUSPECT but recovered
    3. If delay > 120s: Node went OFFLINE, pods rescheduled
    
    Key invariants:
    • Running pod count should match initial (${initialPodCount})
    • No "orphan" or "duplicate" pods in database
      `);

      return {
        success: true,
        scenario: 'heartbeat-delay-convergence',
        duration: Date.now() - startTime,
        events,
        stats: chaos.getStats(),
        data: {
          delayMs: options.delayMs,
          expectedBehavior,
          initialPodCount,
          finalPodCount,
          maxPodCount,
          overServiceDetected,
        },
      };

    } catch (error) {
      chaos.clearMessageRules();
      
      return {
        success: false,
        scenario: 'heartbeat-delay-convergence',
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options): string[] {
    const behaviors = [
      'No over-service occurs',
      'No duplicate pods created',
      'Orchestrator tolerates delay and converges correctly',
    ];
    
    if (options.delayMs < TIMING.HEARTBEAT_TIMEOUT_MS) {
      behaviors.push('Node remains ONLINE (delay below threshold)');
    } else if (options.delayMs < TIMING.LEASE_TIMEOUT_MS) {
      behaviors.push('Node may become SUSPECT but should not go OFFLINE');
    } else {
      behaviors.push('Node goes OFFLINE, pods rescheduled');
    }
    
    return behaviors;
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'nodeId',
        type: 'string',
        required: true,
        description: 'Node ID to inject heartbeat delay into',
        example: 'my-node-1',
      },
      {
        name: 'delayMs',
        type: 'number',
        required: true,
        description: 'Delay to inject (ms). <60000=ONLINE, 60000-120000=SUSPECT, >120000=OFFLINE',
        example: '45000',
      },
      {
        name: 'durationMs',
        type: 'number',
        required: true,
        description: 'How long to run the test (ms)',
        example: '120000',
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3: Service Shape Change Cleanup
// ─────────────────────────────────────────────────────────────────────────────

export interface ServiceShapeChangeOptions {
  /** Service ID to modify */
  serviceId: string;
  /**
   * Change type:
   * - 'scale_down': Reduce replica count
   * - 'daemonset_to_replica': Change from replicas=0 (DaemonSet) to fixed count
   */
  changeType: 'scale_down' | 'daemonset_to_replica';
  /** New replica count (for scale_down or daemonset_to_replica) */
  newReplicas: number;
}

export const serviceShapeChangeScenario: ChaosScenario<ServiceShapeChangeOptions> = {
  name: 'service-shape-change',
  description: 'Test pod cleanup when service shape changes (scale down, DaemonSet→replica)',

  async validate(options): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }
    if (!options.serviceId) {
      return { valid: false, error: 'serviceId is required' };
    }
    if (options.newReplicas < 0) {
      return { valid: false, error: 'newReplicas must be non-negative' };
    }
    return { valid: true };
  },

  async execute(options): Promise<ScenarioResult> {
    const serviceQueries = getServiceQueriesAdmin();
    const podQueries = getPodQueriesAdmin();
    const startTime = Date.now();
    const events: string[] = [];

    banner(`CHAOS SCENARIO: Service Shape Change (${options.changeType})`);

    try {
      // ─────────────────────────────────────────────────────────────────────────
      // Capture initial state
      // ─────────────────────────────────────────────────────────────────────────

      section('INITIAL STATE');
      
      const initialService = await serviceQueries.getServiceById(options.serviceId);
      if (!initialService.data) {
        return {
          success: false,
          scenario: 'service-shape-change',
          duration: Date.now() - startTime,
          events: ['Service not found'],
          error: `Service ${options.serviceId} not found`,
        };
      }
      
      const initialPods = await podQueries.listPodsByService(options.serviceId);
      const runningPods = initialPods.data?.filter((p: PodListItem) => p.status === 'running') ?? [];
      
      console.log(`    Service: ${initialService.data.name}`);
      console.log(`    Current replicas setting: ${initialService.data.replicas}`);
      console.log(`    Running pods: ${runningPods.length}`);
      runningPods.forEach((pod: PodListItem) => {
        console.log(`      • ${pod.id} on node ${pod.nodeId}`);
      });
      
      events.push(`Initial: replicas=${initialService.data.replicas}, running_pods=${runningPods.length}`);

      const isDaemonSet = initialService.data.replicas === 0;
      
      if (options.changeType === 'daemonset_to_replica' && !isDaemonSet) {
        console.log(`\n    ⚠ Warning: Service is not a DaemonSet (replicas=${initialService.data.replicas})`);
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Explain timing
      // ─────────────────────────────────────────────────────────────────────────
      
      section('TIMING EXPECTATIONS');
      console.log(`
    Service controller reconcile interval: ${TIMING.RECONCILE_INTERVAL_MS}ms (${formatTime(TIMING.RECONCILE_INTERVAL_MS)})
    
    After changing replica count from ${runningPods.length} → ${options.newReplicas}:
    1. Service updated in database
    2. Next reconcile detects mismatch (within ${formatTime(TIMING.RECONCILE_INTERVAL_MS)})
    3. Excess pods marked 'stopping'
    4. pod:stop messages sent to nodes
    5. Nodes confirm pod stopped
    6. Pods removed from database
    
    Expected excess pods to stop: ${Math.max(0, runningPods.length - options.newReplicas)}
      `);

      // ─────────────────────────────────────────────────────────────────────────
      // Apply the change
      // ─────────────────────────────────────────────────────────────────────────

      section('APPLYING SERVICE CHANGE');
      
      const updateResult = await serviceQueries.updateService(options.serviceId, {
        replicas: options.newReplicas,
      });
      
      if (updateResult.error) {
        return {
          success: false,
          scenario: 'service-shape-change',
          duration: Date.now() - startTime,
          events,
          error: `Failed to update service: ${updateResult.error.message}`,
        };
      }
      
      const changeTime = Date.now();
      timeline(`Service updated: replicas=${options.newReplicas}`, 0);
      events.push(`T+0: Service replicas changed to ${options.newReplicas}`);

      // ─────────────────────────────────────────────────────────────────────────
      // Monitor convergence
      // ─────────────────────────────────────────────────────────────────────────

      section('MONITORING CONVERGENCE');
      console.log(`    Watching for pod cleanup...\n`);
      
      // Wait up to 60s for convergence
      const maxWaitMs = 60_000;
      const checkInterval = 5_000;
      let converged = false;
      let stoppingPodsStuck = false;
      
      while (Date.now() - changeTime < maxWaitMs) {
        await sleep(checkInterval);
        const elapsed = Date.now() - changeTime;
        
        const currentPods = await podQueries.listPodsByService(options.serviceId);
        const running = currentPods.data?.filter((p: PodListItem) => p.status === 'running') ?? [];
        const stopping = currentPods.data?.filter((p: PodListItem) => p.status === 'stopping') ?? [];
        const total = currentPods.data?.length ?? 0;
        
        timeline(`running=${running.length}, stopping=${stopping.length}, total=${total}`, elapsed);
        events.push(`T+${formatTime(elapsed)}: running=${running.length}, stopping=${stopping.length}`);
        
        // Check convergence
        if (running.length === options.newReplicas && stopping.length === 0) {
          converged = true;
          console.log(`\n    ✓ Converged at T+${formatTime(elapsed)}`);
          break;
        }
        
        // Check for stuck stopping pods (> 30s in stopping state)
        if (stopping.length > 0 && elapsed > 30_000) {
          // Check if same pods are still stopping
          const stoppingIds = stopping.map((p: PodListItem) => p.id).join(',');
          events.push(`Warning: pods still in stopping state: ${stoppingIds}`);
        }
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Final state
      // ─────────────────────────────────────────────────────────────────────────

      section('FINAL STATE');
      
      const finalPods = await podQueries.listPodsByService(options.serviceId);
      const finalRunning = finalPods.data?.filter((p: PodListItem) => p.status === 'running') ?? [];
      const finalStopping = finalPods.data?.filter((p: PodListItem) => p.status === 'stopping') ?? [];
      
      console.log(`    Target replicas: ${options.newReplicas}`);
      console.log(`    Running pods: ${finalRunning.length}`);
      console.log(`    Stopping pods: ${finalStopping.length}`);
      console.log(`    Converged: ${converged ? 'YES ✓' : 'NO ⚠'}`);
      
      if (finalStopping.length > 0) {
        stoppingPodsStuck = true;
        console.log(`\n    ⚠ WARNING: Pods stuck in 'stopping' state:`);
        finalStopping.forEach((pod: PodListItem) => {
          console.log(`      • ${pod.id} on node ${pod.nodeId}`);
        });
      }

      // ─────────────────────────────────────────────────────────────────────────
      // Verification
      // ─────────────────────────────────────────────────────────────────────────

      section('MANUAL VERIFICATION');
      
      verify('Orchestrator actively stopped excess pods');
      verify(`Running pod count matches target (${options.newReplicas})`);
      verify('No pods remain in permanent "stopping" state');
      verify('Runtime and database converged');
      
      console.log(`
    Check points:
    1. Excess pods (${runningPods.length - options.newReplicas}) should have been stopped
    2. pod:stop messages should appear in orchestrator logs
    3. Node runtime should have terminated the processes
    4. Database should show exactly ${options.newReplicas} running pods
    
    If pods are stuck in 'stopping':
    • Check if node is online and receiving messages
    • Check node logs for pod:stop handling
    • Verify WebSocket connection is healthy
      `);

      return {
        success: converged && !stoppingPodsStuck,
        scenario: 'service-shape-change',
        mode: options.changeType,
        duration: Date.now() - startTime,
        events,
        data: {
          changeType: options.changeType,
          initialPodCount: runningPods.length,
          targetReplicas: options.newReplicas,
          finalRunningPods: finalRunning.length,
          finalStoppingPods: finalStopping.length,
          converged,
          stoppingPodsStuck,
        },
      };

    } catch (error) {
      return {
        success: false,
        scenario: 'service-shape-change',
        mode: options.changeType,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options): string[] {
    return [
      `Service replicas changed to ${options.newReplicas}`,
      'Excess pods marked as stopping within 10s (reconcile interval)',
      'pod:stop messages sent to nodes hosting excess pods',
      'Nodes terminate excess pods and confirm',
      'Pods removed from database after confirmation',
      `Final state: exactly ${options.newReplicas} running pods`,
      'No pods remain in permanent stopping state',
    ];
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'serviceId',
        type: 'string',
        required: true,
        description: 'Service ID to modify',
        example: 'abc123-def456',
      },
      {
        name: 'changeType',
        type: 'string',
        required: true,
        description: 'Type of change to apply',
        choices: ['scale_down', 'daemonset_to_replica'],
        example: 'scale_down',
      },
      {
        name: 'newReplicas',
        type: 'number',
        required: true,
        description: 'New replica count after change',
        example: '1',
      },
    ];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Export default for all scenarios
// ─────────────────────────────────────────────────────────────────────────────

export default {
  nodeBanReconciliationScenario,
  heartbeatDelayConvergenceScenario,
  serviceShapeChangeScenario,
};
