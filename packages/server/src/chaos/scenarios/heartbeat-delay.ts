/**
 * Chaos Scenario: Heartbeat Delays
 *
 * Simulates slow or unreliable heartbeats:
 * - Random delays between 1-5 seconds
 * - Intermittent drops
 * - Tests liveness detection without false positives
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { nodeQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult, OptionHelp } from './types';

// Use the query module that wraps the reactive store

export interface HeartbeatDelayOptions {
  nodeId?: string;
  nodeIds?: string[];
  mode: 'delay' | 'intermittent' | 'gradual_degradation';
  delayMs?: number; // Base delay
  delayJitterMs?: number; // Random jitter
  dropRate?: number; // 0-1, probability of dropping
  durationMs?: number; // How long to run the scenario
}

export const heartbeatDelayScenario: ChaosScenario<HeartbeatDelayOptions> = {
  name: 'heartbeat-delay',
  description: 'Simulate slow or unreliable node heartbeats',

  async validate(options: HeartbeatDelayOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    if (!options.nodeId && (!options.nodeIds || options.nodeIds.length === 0)) {
      return { valid: false, error: 'nodeId or nodeIds required' };
    }

    return { valid: true };
  },

  async execute(options: HeartbeatDelayOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const startTime = Date.now();
    const events: string[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: Heartbeat Delays (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    const targetNodes = options.nodeIds ?? [options.nodeId!];
    const duration = options.durationMs ?? 60000;

    try {
      switch (options.mode) {
        case 'delay': {
          const delayMs = options.delayMs ?? 3000;
          const jitter = options.delayJitterMs ?? 2000;

          events.push(`Adding ${delayMs}ms delay (±${jitter}ms) to heartbeats`);

          for (const nodeId of targetNodes) {
            chaos.addHeartbeatRule({
              nodeId,
              delayMs,
              delayJitterMs: jitter,
            });
          }

          // Monitor node status during delay period
          const checkInterval = 10000;
          const checks = Math.floor(duration / checkInterval);

          for (let i = 0; i < checks; i++) {
            await sleep(checkInterval);

            for (const nodeId of targetNodes) {
              const node = await nodeQueries.getNodeById(nodeId);
              events.push(
                `[${((i + 1) * checkInterval) / 1000}s] Node ${nodeId}: ${node?.status ?? 'unknown'}`
              );
            }
          }

          // Clean up
          chaos.clearHeartbeatRules();
          events.push('Heartbeat delay rules cleared');
          break;
        }

        case 'intermittent': {
          const dropRate = options.dropRate ?? 0.3;
          events.push(`Dropping ${dropRate * 100}% of heartbeats`);

          for (const nodeId of targetNodes) {
            chaos.addHeartbeatRule({
              nodeId,
              delayMs: 0,
              dropRate,
            });
          }

          // Monitor
          await sleep(duration);

          // Check final status
          for (const nodeId of targetNodes) {
            const node = await nodeQueries.getNodeById(nodeId);
            events.push(`Final status - Node ${nodeId}: ${node?.status ?? 'unknown'}`);
          }

          chaos.clearHeartbeatRules();
          break;
        }

        case 'gradual_degradation': {
          events.push('Gradually increasing heartbeat delays');

          const steps = 5;
          const stepDuration = duration / steps;

          for (let i = 1; i <= steps; i++) {
            const delayMs = i * 1000; // 1s, 2s, 3s, 4s, 5s
            events.push(`Step ${i}/${steps}: Delay = ${delayMs}ms`);

            for (const nodeId of targetNodes) {
              chaos.removeHeartbeatRule(nodeId);
              chaos.addHeartbeatRule({
                nodeId,
                delayMs,
                delayJitterMs: delayMs * 0.2,
              });
            }

            await sleep(stepDuration);

            // Check status
            for (const nodeId of targetNodes) {
              const node = await nodeQueries.getNodeById(nodeId);
              events.push(`Node ${nodeId}: ${node?.status ?? 'unknown'}`);
            }
          }

          chaos.clearHeartbeatRules();
          events.push('Degradation complete - rules cleared');
          break;
        }
      }

      const duration_final = Date.now() - startTime;

      return {
        success: true,
        scenario: 'heartbeat-delay',
        mode: options.mode,
        duration: duration_final,
        events,
        stats: chaos.getStats(),
      };
    } catch (error) {
      chaos.clearHeartbeatRules();
      return {
        success: false,
        scenario: 'heartbeat-delay',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options: HeartbeatDelayOptions): string[] {
    switch (options.mode) {
      case 'delay':
        return [
          'Node remains online if delay < heartbeat timeout (90s default)',
          'No false positive node failures',
          'Heartbeat timestamps show delays',
          'Eventually marks offline if delay exceeds threshold',
        ];
      case 'intermittent':
        return [
          'Dropped heartbeats logged but tolerated',
          'Node remains online if enough heartbeats succeed',
          'No race conditions in liveness detection',
          'Consistent state after chaos ends',
        ];
      case 'gradual_degradation':
        return [
          'System tolerates increasing delays initially',
          'At some threshold, node marked unhealthy',
          'Clear correlation between delay and status change',
          'Recovery when delays stop',
        ];
      default:
        return [];
    }
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'nodeId',
        type: 'string',
        required: false,
        description: 'Single node ID to target (use nodeId or nodeIds)',
        example: 'node-abc123',
      },
      {
        name: 'nodeIds',
        type: 'string[]',
        required: false,
        description: 'Array of node IDs to target (use nodeId or nodeIds)',
        example: '["node-1", "node-2"]',
      },
      {
        name: 'mode',
        type: 'string',
        required: true,
        description: 'Heartbeat delay simulation mode',
        choices: ['delay', 'intermittent', 'gradual_degradation'],
        example: 'delay',
      },
      {
        name: 'delayMs',
        type: 'number',
        required: false,
        description: 'Base delay in milliseconds',
        example: '3000',
      },
      {
        name: 'delayJitterMs',
        type: 'number',
        required: false,
        description: 'Random jitter added to delay in milliseconds',
        example: '2000',
      },
      {
        name: 'dropRate',
        type: 'number',
        required: false,
        description: 'Probability of dropping heartbeat (0-1)',
        example: '0.3',
      },
      {
        name: 'durationMs',
        type: 'number',
        required: false,
        description: 'How long to run the scenario in milliseconds',
        example: '60000',
      },
    ];
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default heartbeatDelayScenario;
