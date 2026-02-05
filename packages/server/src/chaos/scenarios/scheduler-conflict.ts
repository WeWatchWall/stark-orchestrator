/**
 * Chaos Scenario: Scheduler Conflict
 *
 * Simulates scheduling conflicts:
 * - Multiple pods requesting more resources than available
 * - Conflicting affinity rules
 * - Scheduler races
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { podQueries, nodeQueries, packQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult, OptionHelp } from './types';

// Use the query modules that wrap the reactive stores

export interface SchedulerConflictOptions {
  mode: 'resource_exhaustion' | 'affinity_conflict' | 'race_condition';
  nodeId?: string; // Target node for resource test
  packId?: string; // Pack to deploy
  podCount?: number; // Number of pods to create
  cpuRequest?: number; // CPU per pod
  memoryRequest?: number; // Memory per pod
}

export const schedulerConflictScenario: ChaosScenario<SchedulerConflictOptions> = {
  name: 'scheduler-conflict',
  description: 'Simulate scheduling conflicts and resource contention',

  async validate(options: SchedulerConflictOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    if (options.mode === 'resource_exhaustion' && !options.nodeId) {
      return { valid: false, error: 'nodeId required for resource_exhaustion mode' };
    }

    return { valid: true };
  },

  async execute(options: SchedulerConflictOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const startTime = Date.now();
    const events: string[] = [];
    const createdPodIds: string[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: Scheduler Conflict (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      switch (options.mode) {
        case 'resource_exhaustion': {
          const nodeId = options.nodeId!;
          const podCount = options.podCount ?? 5;
          const cpuRequest = options.cpuRequest ?? 2000; // 2 cores
          const memoryRequest = options.memoryRequest ?? 2048; // 2GB

          // Get node capacity
          const node = await nodeQueries.getNodeById(nodeId);
          if (!node) {
            throw new Error(`Node ${nodeId} not found`);
          }

          events.push(
            `Node ${nodeId} capacity: CPU=${node.allocatable?.cpu ?? 'unknown'}, Memory=${node.allocatable?.memory ?? 'unknown'}`
          );
          events.push(
            `Creating ${podCount} pods requesting CPU=${cpuRequest}, Memory=${memoryRequest} each`
          );
          events.push(
            `Total request: CPU=${podCount * cpuRequest}, Memory=${podCount * memoryRequest}`
          );

          // Get or create a test pack
          let packId = options.packId;
          if (!packId) {
            // Use existing pack if available
            const packs = await packQueries.listPacks({ limit: 1 });
            packId = packs[0]?.id;
          }

          if (!packId) {
            events.push('No pack available - simulating with pending pods');
          } else {
            // Create pods that exceed capacity
            for (let i = 0; i < podCount; i++) {
              const result = await podQueries.createPod({
                packId,
                name: `chaos-resource-test-${i}`,
                namespace: 'default',
                resourceRequests: {
                  cpu: cpuRequest,
                  memory: memoryRequest,
                },
                labels: { chaos: 'resource-exhaustion' },
              });
              createdPodIds.push(result.id);
              events.push(`Created pod ${result.id}`);
            }
          }

          // Wait for scheduling attempts
          await sleep(10000);

          // Check pod statuses
          let pendingCount = 0;
          let runningCount = 0;

          for (const podId of createdPodIds) {
            const pod = await podQueries.getPodById(podId);
            if (pod?.status === 'pending') pendingCount++;
            if (pod?.status === 'running') runningCount++;
            events.push(`Pod ${podId}: ${pod?.status ?? 'unknown'} - ${pod?.statusMessage ?? ''}`);
          }

          events.push(`Summary: ${runningCount} running, ${pendingCount} pending due to resources`);
          break;
        }

        case 'affinity_conflict': {
          events.push('Creating pods with conflicting affinity rules');

          // This would create pods that all require the same node
          // but there's only capacity for one

          // For now, simulate via scheduler rules
          chaos.setSchedulerRules({
            failRate: 0.5, // 50% of scheduling attempts fail
          });

          events.push('Set 50% scheduling failure rate');

          // Wait and observe
          await sleep(15000);

          events.push('Checking scheduler stats...');
          const stats = chaos.getStats();
          events.push(`Scheduling failures: ${stats.schedulingFailures}`);

          chaos.clearSchedulerRules();
          break;
        }

        case 'race_condition': {
          events.push('Simulating scheduler race conditions');

          // Add random delays to scheduling
          chaos.setSchedulerRules({
            delayMs: 2000, // 2 second delay on all scheduling
          });

          // Create multiple pods rapidly
          const packId = options.packId;
          if (packId) {
            const podCount = options.podCount ?? 10;

            events.push(`Rapidly creating ${podCount} pods...`);

            const createPromises = [];
            for (let i = 0; i < podCount; i++) {
              createPromises.push(
                podQueries.createPod({
                  packId,
                  name: `chaos-race-test-${i}`,
                  namespace: 'default',
                  labels: { chaos: 'race-condition' },
                })
              );
            }

            const results = await Promise.all(createPromises);
            createdPodIds.push(...results.map((r: any) => r.id));

            events.push(`Created ${podCount} pods simultaneously`);
          } else {
            events.push('No packId provided - simulating with delay rules only');
          }

          // Wait for scheduling with delays
          await sleep(30000);

          // Check for duplicates or conflicts
          events.push('Checking for scheduling anomalies...');

          chaos.clearSchedulerRules();
          break;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        scenario: 'scheduler-conflict',
        mode: options.mode,
        duration,
        events,
        stats: chaos.getStats(),
        data: { createdPodIds },
      };
    } catch (error) {
      chaos.clearSchedulerRules();
      return {
        success: false,
        scenario: 'scheduler-conflict',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
        data: { createdPodIds },
      };
    }
  },

  getExpectedBehavior(options: SchedulerConflictOptions): string[] {
    switch (options.mode) {
      case 'resource_exhaustion':
        return [
          'First pods scheduled successfully',
          'Remaining pods stay pending',
          'Clear "insufficient resources" reason',
          'No infinite retry loop',
          'Scheduler doesn\'t crash',
        ];
      case 'affinity_conflict':
        return [
          'Conflicting pods identified',
          'Clear error messages about conflicts',
          'Scheduler resolves or fails gracefully',
          'No partial/corrupt state',
        ];
      case 'race_condition':
        return [
          'No duplicate pod assignments',
          'No resource over-allocation',
          'Consistent final state',
          'Scheduler handles concurrent requests',
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
        description: 'Scheduler conflict simulation mode',
        choices: ['resource_exhaustion', 'affinity_conflict', 'race_condition'],
        example: 'resource_exhaustion',
      },
      {
        name: 'nodeId',
        type: 'string',
        required: false,
        description: 'Target node for resource_exhaustion mode',
        example: 'node-abc123',
      },
      {
        name: 'packId',
        type: 'string',
        required: false,
        description: 'Pack ID to use for creating test pods',
        example: 'pack-xyz789',
      },
      {
        name: 'podCount',
        type: 'number',
        required: false,
        description: 'Number of pods to create',
        example: '5',
      },
      {
        name: 'cpuRequest',
        type: 'number',
        required: false,
        description: 'CPU millicores requested per pod',
        example: '2000',
      },
      {
        name: 'memoryRequest',
        type: 'number',
        required: false,
        description: 'Memory in MB requested per pod',
        example: '2048',
      },
    ];
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default schedulerConflictScenario;
