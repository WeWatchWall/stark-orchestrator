/**
 * Chaos Scenario: Pod Crash
 *
 * Simulates pod crashes and failures:
 * - Abrupt pod failures (process kill)
 * - Slow pods that fail readiness
 * - Crash loops with backoff
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { getExternalChaosRunner } from '../external-chaos';
import { podQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult, OptionHelp } from './types';

// Use the query module that wraps the reactive store

export interface PodCrashOptions {
  podId?: string;
  podIds?: string[];
  mode: 'crash' | 'slow_failure' | 'crash_loop';
  crashLoopCount?: number; // For crash_loop mode
  crashIntervalMs?: number; // Time between crashes
  useExternal?: boolean; // Kill actual process vs internal simulation
}

export const podCrashScenario: ChaosScenario<PodCrashOptions> = {
  name: 'pod-crash',
  description: 'Simulate pod crashes and failure conditions',

  async validate(options: PodCrashOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    if (!options.podId && (!options.podIds || options.podIds.length === 0)) {
      return { valid: false, error: 'podId or podIds required' };
    }

    return { valid: true };
  },

  async execute(options: PodCrashOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const external = getExternalChaosRunner();
    const startTime = Date.now();
    const events: string[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: Pod Crash (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    const targetPods = options.podIds ?? [options.podId!];

    try {
      switch (options.mode) {
        case 'crash': {
          events.push(`Crashing ${targetPods.length} pod(s)`);

          for (const podId of targetPods) {
            if (options.useExternal) {
              // Kill actual pod process
              const result = await external.killProcessByName(`pod.*${podId}`, 'SIGKILL');
              events.push(`External kill pod ${podId}: ${result.message}`);
            } else {
              // Simulate crash via pod status update
              await podQueries.updatePodStatus(podId, 'failed', {
                terminatedAt: new Date(),
                terminationReason: 'chaos_crash',
                terminationMessage: 'CHAOS: Simulated abrupt crash',
              });
              events.push(`Pod ${podId} marked as crashed`);
            }
          }

          // Wait for scheduler reaction
          await sleep(3000);

          // Check pod status
          for (const podId of targetPods) {
            const pod = await podQueries.getPodById(podId);
            events.push(`Pod ${podId} status: ${pod?.status ?? 'not found'}`);
          }
          break;
        }

        case 'slow_failure': {
          events.push('Simulating slow pod failures (readiness timeout)');

          // Add message delays to simulate slow pods
          for (const podId of targetPods) {
            chaos.addMessageRule({
              nodeId: undefined,
              messageTypes: ['pod:status', 'pod:ready'],
              dropRate: 0,
              delayMs: 10000, // 10 second delay
              delayJitterMs: 5000,
            });
            events.push(`Added delay rule for pod ${podId}`);
          }

          // Wait for health checks to timeout
          await sleep(15000);

          // Check status
          for (const podId of targetPods) {
            const pod = await podQueries.getPodById(podId);
            events.push(`Pod ${podId} after delay: ${pod?.status ?? 'not found'}`);
          }

          // Clean up rules
          chaos.clearMessageRules();
          break;
        }

        case 'crash_loop': {
          const crashCount = options.crashLoopCount ?? 5;
          const interval = options.crashIntervalMs ?? 5000;

          events.push(`Starting crash loop: ${crashCount} crashes, ${interval}ms apart`);

          for (let i = 0; i < crashCount; i++) {
            events.push(`Crash ${i + 1}/${crashCount}`);

            for (const podId of targetPods) {
              // Crash the pod
              await podQueries.updatePodStatus(podId, 'failed', {
                terminatedAt: new Date(),
                terminationReason: 'chaos_crash_loop',
                terminationMessage: `CHAOS: Crash loop iteration ${i + 1}`,
              });
            }

            // Wait for potential restart
            await sleep(interval);

            // Check restart count
            for (const podId of targetPods) {
              const pod = await podQueries.getPodById(podId);
              const restartCount = (pod?.metadata as Record<string, unknown>)?.restartCount ?? 0;
              events.push(`Pod ${podId} restarts: ${restartCount}, status: ${pod?.status}`);
            }
          }

          events.push('Crash loop complete - verify backoff is applied');
          break;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        scenario: 'pod-crash',
        mode: options.mode,
        duration,
        events,
        stats: chaos.getStats(),
      };
    } catch (error) {
      return {
        success: false,
        scenario: 'pod-crash',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options: PodCrashOptions): string[] {
    switch (options.mode) {
      case 'crash':
        return [
          'Pod immediately marked as failed',
          'Deployment controller detects and recreates pod',
          'New pod scheduled on available node',
          'Event log shows crash reason',
        ];
      case 'slow_failure':
        return [
          'Pod messages delayed significantly',
          'Health check / readiness eventually times out',
          'Pod marked as unhealthy or failed',
          'Scheduler recreates if part of deployment',
        ];
      case 'crash_loop':
        return [
          'Each crash increments restart count',
          'Backoff time increases exponentially',
          'After max retries, deployment may pause',
          'Clear crash loop indication in status',
        ];
      default:
        return [];
    }
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'podId',
        type: 'string',
        required: false,
        description: 'Single pod ID to target (use podId or podIds)',
        example: 'pod-abc123',
      },
      {
        name: 'podIds',
        type: 'string[]',
        required: false,
        description: 'Array of pod IDs to target (use podId or podIds)',
        example: '["pod-1", "pod-2"]',
      },
      {
        name: 'mode',
        type: 'string',
        required: true,
        description: 'Crash simulation mode',
        choices: ['crash', 'slow_failure', 'crash_loop'],
        example: 'crash',
      },
      {
        name: 'crashLoopCount',
        type: 'number',
        required: false,
        description: 'Number of crashes for crash_loop mode',
        example: '5',
      },
      {
        name: 'crashIntervalMs',
        type: 'number',
        required: false,
        description: 'Time between crashes in milliseconds',
        example: '5000',
      },
      {
        name: 'useExternal',
        type: 'boolean',
        required: false,
        description: 'Kill actual process vs internal simulation',
        example: 'false',
      },
    ];
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default podCrashScenario;
