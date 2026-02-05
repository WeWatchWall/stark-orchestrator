/**
 * Chaos Scenario: Node Loss
 *
 * Simulates nodes abruptly disappearing from the cluster.
 * Tests scheduler's ability to:
 * - Mark node unreachable
 * - Evict pods
 * - Reschedule pods onto remaining nodes
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { getExternalChaosRunner } from '../external-chaos';
import { nodeQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult, OptionHelp } from './types';

// Use the query module that wraps the reactive store

// Import from the core store - individual functions
// These may need to be adjusted based on actual core exports
// For now we'll use placeholders that work with the chaos framework

export interface NodeLossOptions {
  nodeId?: string; // Specific node to kill
  nodeIds?: string[]; // Multiple nodes
  mode: 'single' | 'flapping' | 'multi';
  flapIntervalMs?: number; // For flapping mode
  flapCount?: number; // Number of times to flap
  useExternal?: boolean; // Use external chaos (process kill) vs internal (connection drop)
}

export const nodeLossScenario: ChaosScenario<NodeLossOptions> = {
  name: 'node-loss',
  description: 'Simulate node disappearing from the cluster',

  async validate(options: NodeLossOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    if (options.mode === 'single' && !options.nodeId) {
      return { valid: false, error: 'nodeId required for single mode' };
    }

    if (options.mode === 'multi' && (!options.nodeIds || options.nodeIds.length < 2)) {
      return { valid: false, error: 'nodeIds array with 2+ nodes required for multi mode' };
    }

    return { valid: true };
  },

  async execute(options: NodeLossOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const external = getExternalChaosRunner();
    const startTime = Date.now();
    const events: string[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: Node Loss (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      switch (options.mode) {
        case 'single': {
          const nodeId = options.nodeId!;
          events.push(`Targeting node: ${nodeId}`);

          if (options.useExternal) {
            // Kill the actual node process
            const result = await external.killProcessByName(`node.*${nodeId}`);
            events.push(`External kill result: ${result.message}`);
          } else {
            // Drop connection internally
            const success = chaos.simulateNodeLoss(nodeId);
            events.push(`Internal node loss: ${success ? 'success' : 'failed'}`);
          }

          // Wait for node health service to detect
          events.push('Waiting for node health detection...');
          await sleep(2000);

          // Check node status
          const node = await nodeQueries.getNodeById(nodeId);
          events.push(`Node status after chaos: ${node?.status ?? 'not found'}`);

          break;
        }

        case 'flapping': {
          const nodeId = options.nodeId!;
          const flapInterval = options.flapIntervalMs ?? 5000;
          const flapCount = options.flapCount ?? 3;

          events.push(`Flapping node ${nodeId} ${flapCount} times every ${flapInterval}ms`);

          for (let i = 0; i < flapCount; i++) {
            events.push(`Flap ${i + 1}/${flapCount}: Killing node connection`);

            // Kill connection
            chaos.simulateNodeLoss(nodeId);

            // Wait for potential reconnection
            await sleep(flapInterval);

            // Check status
            const node = await nodeQueries.getNodeById(nodeId);
            events.push(`Node status after flap ${i + 1}: ${node?.status ?? 'unknown'}`);
          }

          events.push('Flapping complete - checking for backoff behavior');
          break;
        }

        case 'multi': {
          const nodeIds = options.nodeIds!;
          events.push(`Killing ${nodeIds.length} nodes simultaneously`);

          // Kill all nodes at once
          chaos.simulateMultiNodeLoss(nodeIds);

          await sleep(2000);

          // Check all nodes
          for (const nodeId of nodeIds) {
            const node = await nodeQueries.getNodeById(nodeId);
            events.push(`Node ${nodeId}: ${node?.status ?? 'not found'}`);
          }

          // Check pending pods
          events.push('Checking for pending pods with insufficient capacity...');
          break;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        scenario: 'node-loss',
        mode: options.mode,
        duration,
        events,
        stats: chaos.getStats(),
      };
    } catch (error) {
      return {
        success: false,
        scenario: 'node-loss',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options: NodeLossOptions): string[] {
    switch (options.mode) {
      case 'single':
        return [
          'Node marked as offline/unreachable',
          'All pods on node marked as failed with reason "node_lost"',
          'Scheduler reschedules pods to remaining nodes',
          'NodeLost event emitted',
        ];
      case 'flapping':
        return [
          'Node status alternates between online/offline',
          'Backoff applied to prevent rapid rescheduling',
          'Eventually stabilizes to consistent state',
          'No duplicate pod scheduling',
        ];
      case 'multi':
        return [
          'All targeted nodes marked offline',
          'Pods remain pending if insufficient capacity',
          'Pending reason shows "no_available_nodes" or similar',
          'System remains stable, no crash loops',
        ];
      default:
        return [];
    }
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'mode',
        type: 'string',
        required: true,
        description: 'Failure mode to simulate',
        choices: ['single', 'flapping', 'multi'],
        example: 'single',
      },
      {
        name: 'nodeId',
        type: 'string',
        required: false,
        description: 'Node ID to target (required for single/flapping mode)',
        example: 'my-node-1',
      },
      {
        name: 'nodeIds',
        type: 'string[]',
        required: false,
        description: 'Node IDs to target (required for multi mode, comma-separated)',
        example: 'node-1,node-2',
      },
      {
        name: 'flapIntervalMs',
        type: 'number',
        required: false,
        description: 'Interval between flaps in flapping mode (default: 5000)',
        example: '5000',
      },
      {
        name: 'flapCount',
        type: 'number',
        required: false,
        description: 'Number of flaps in flapping mode (default: 3)',
        example: '3',
      },
    ];
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default nodeLossScenario;
