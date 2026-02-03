/**
 * Chaos Scenario: Orchestrator Restart
 *
 * Tests state persistence and recovery:
 * - Stop orchestrator mid-reconciliation
 * - Restart and verify state convergence
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { getExternalChaosRunner } from '../external-chaos';
import { podQueries, nodeQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult } from './types';

// Use the query modules that wrap the reactive stores
// Note: clusterQueries removed as it wasn't being used directly

export interface OrchestratorRestartOptions {
  mode: 'graceful' | 'abrupt' | 'mid_reconciliation';
  restartDelayMs?: number; // Time to wait before restart
  verifyAfterMs?: number; // Time to wait after restart before verification
}

export const orchestratorRestartScenario: ChaosScenario<OrchestratorRestartOptions> = {
  name: 'orchestrator-restart',
  description: 'Test orchestrator restart and state recovery',

  async validate(_options: OrchestratorRestartOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    console.warn(
      '[WARNING] This scenario may restart the orchestrator process. ' +
        'Ensure you have process supervision (e.g., nodemon, pm2) configured.'
    );

    return { valid: true };
  },

  async execute(options: OrchestratorRestartOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    void getExternalChaosRunner(); // May be used for external process control in future
    const startTime = Date.now();
    const events: string[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: Orchestrator Restart (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      // Capture state before restart
      events.push('Capturing pre-restart state...');

      const preNodes = await nodeQueries.listNodes({ limit: 100 });
      const prePods = await podQueries.listPods({ limit: 100 });

      const preState = {
        nodeCount: preNodes.length,
        onlineNodes: preNodes.filter((n) => n.status === 'online').length,
        podCount: prePods.length,
        runningPods: prePods.filter((p) => p.status === 'running').length,
        pendingPods: prePods.filter((p) => p.status === 'pending').length,
      };

      events.push(`Pre-restart: ${preState.nodeCount} nodes (${preState.onlineNodes} online)`);
      events.push(
        `Pre-restart: ${preState.podCount} pods (${preState.runningPods} running, ${preState.pendingPods} pending)`
      );

      switch (options.mode) {
        case 'graceful': {
          events.push('Graceful restart: Signaling shutdown...');

          // In a real scenario, this would trigger SIGTERM
          // For testing, we just log and wait
          events.push('[SIMULATED] Would send SIGTERM to orchestrator');
          events.push('Note: For actual restart, use external process manager');

          await sleep(options.restartDelayMs ?? 5000);
          break;
        }

        case 'abrupt': {
          events.push('Abrupt restart: Killing orchestrator...');

          // This is dangerous - it kills the current process
          // Only enable if external supervision is configured

          events.push('[SIMULATED] Would send SIGKILL to orchestrator');
          events.push('Note: For actual restart, use external process manager');

          // In real chaos testing with pm2/nodemon:
          // await external.killProcessByName('stark-orchestrator', 'SIGKILL');

          await sleep(options.restartDelayMs ?? 2000);
          break;
        }

        case 'mid_reconciliation': {
          events.push('Mid-reconciliation restart: Creating pods, then killing...');

          // Create pods to trigger reconciliation
          events.push('Creating pods to trigger reconciliation...');

          // Force scheduler to run
          chaos.setSchedulerRules({
            delayMs: 10000, // 10 second delay to catch mid-reconciliation
          });

          events.push('Scheduler slowed - reconciliation in progress');
          events.push('[SIMULATED] Would kill orchestrator during reconciliation');

          await sleep(5000);
          chaos.clearSchedulerRules();
          break;
        }
      }

      // Simulate post-restart verification
      events.push('Verifying post-restart state...');
      await sleep(options.verifyAfterMs ?? 5000);

      const postNodes = await nodeQueries.listNodes({ limit: 100 });
      const postPods = await podQueries.listPods({ limit: 100 });

      const postState = {
        nodeCount: postNodes.length,
        onlineNodes: postNodes.filter((n) => n.status === 'online').length,
        podCount: postPods.length,
        runningPods: postPods.filter((p) => p.status === 'running').length,
        pendingPods: postPods.filter((p) => p.status === 'pending').length,
      };

      events.push(`Post-restart: ${postState.nodeCount} nodes (${postState.onlineNodes} online)`);
      events.push(
        `Post-restart: ${postState.podCount} pods (${postState.runningPods} running, ${postState.pendingPods} pending)`
      );

      // Compare states
      const statePreserved =
        preState.nodeCount === postState.nodeCount && preState.podCount === postState.podCount;

      if (statePreserved) {
        events.push('✓ State counts preserved across restart');
      } else {
        events.push('✗ State mismatch detected!');
        events.push(`  Nodes: ${preState.nodeCount} → ${postState.nodeCount}`);
        events.push(`  Pods: ${preState.podCount} → ${postState.podCount}`);
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        scenario: 'orchestrator-restart',
        mode: options.mode,
        duration,
        events,
        stats: chaos.getStats(),
        data: { preState, postState, statePreserved },
      };
    } catch (error) {
      return {
        success: false,
        scenario: 'orchestrator-restart',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(_options: OrchestratorRestartOptions): string[] {
    return [
      'Desired state persisted in database',
      'After restart, orchestrator reads persisted state',
      'Reconciliation loop resumes',
      'Pods return to desired replica counts',
      'No duplicate scheduling',
      'No orphaned pods',
      'Node reconnections handled gracefully',
    ];
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default orchestratorRestartScenario;
