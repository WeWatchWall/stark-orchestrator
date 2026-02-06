/**
 * Chaos Scenario: Service Backoff
 *
 * Tests crash loops and rollback behavior:
 * - Deploy healthy version
 * - Deploy failing version
 * - Verify backoff and optional rollback
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { podQueries, serviceQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult, OptionHelp } from './types';

// Use the query modules that wrap the reactive stores

export interface ServiceBackoffOptions {
  serviceId?: string;
  packIdV1?: string; // Healthy version
  packIdV2?: string; // Failing version
  mode: 'crash_loop' | 'gradual_failure' | 'rollback_test';
  failAfterMs?: number; // How long V2 runs before failing
}

export const serviceBackoffScenario: ChaosScenario<ServiceBackoffOptions> = {
  name: 'service-backoff',
  description: 'Test service crash loops and rollback behavior',

  async validate(options: ServiceBackoffOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    if (options.mode === 'rollback_test' && (!options.packIdV1 || !options.packIdV2)) {
      return { valid: false, error: 'packIdV1 and packIdV2 required for rollback_test' };
    }

    return { valid: true };
  },

  async execute(options: ServiceBackoffOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const startTime = Date.now();
    const events: string[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: Service Backoff (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      switch (options.mode) {
        case 'crash_loop': {
          const serviceId = options.serviceId;
          if (!serviceId) {
            // Get any active service
            events.push('No service specified, finding active service...');
            // Would need to query services here
          }

          events.push(`Targeting service: ${serviceId ?? 'first available'}`);

          // Force pods into crash loop by failing them repeatedly
          if (serviceId) {
            const service = await serviceQueries.getServiceById(serviceId);
            if (!service) {
              throw new Error(`Service ${serviceId} not found`);
            }

            events.push(`Service found: ${service.name}, replicas: ${service.replicas}`);

            // Get pods for this service
            const pods = await podQueries.listPods({
              serviceId,
              limit: 100,
            });

            events.push(`Found ${pods.length} pods, forcing crash loop...`);

            // Crash pods repeatedly
            for (let round = 0; round < 5; round++) {
              events.push(`Crash round ${round + 1}/5`);

              for (const pod of pods) {
                if (pod.status === 'running') {
                  await podQueries.updatePodStatus(pod.id, 'failed', {
                    terminatedAt: new Date(),
                    terminationReason: 'chaos_crash_loop',
                    terminationMessage: `CHAOS: Forced crash round ${round + 1}`,
                  });
                }
              }

              // Wait for controller to react
              await sleep(5000);

              // Check current state
              const currentPods = await podQueries.listPods({ serviceId, limit: 100 });
              const running = currentPods.filter((p) => p.status === 'running').length;
              const pending = currentPods.filter((p) => p.status === 'pending').length;
              const failed = currentPods.filter((p) => p.status === 'failed').length;

              events.push(`Status: ${running} running, ${pending} pending, ${failed} failed`);
            }

            // Check final backoff state
            await sleep(5000);
            const finalService = await serviceQueries.getServiceById(serviceId);
            events.push(
              `Final service status: ${finalService?.status ?? 'unknown'}`
            );
          }
          break;
        }

        case 'gradual_failure': {
          events.push('Simulating gradual failure rate increase');

          // Start with low failure rate, increase over time
          const steps = [0.1, 0.25, 0.5, 0.75, 0.9];

          for (const rate of steps) {
            events.push(`Step ${steps.indexOf(rate) + 1}/${steps.length}: ${rate * 100}% failure rate`);

            chaos.setSchedulerRules({
              failRate: rate,
            });

            await sleep(10000);

            const stats = chaos.getStats();
            events.push(`Scheduling failures so far: ${stats.schedulingFailures}`);
          }

          chaos.clearSchedulerRules();
          events.push('Failure injection stopped');
          break;
        }

        case 'rollback_test': {
          const packIdV1 = options.packIdV1!;
          const packIdV2 = options.packIdV2!;
          const failAfterMs = options.failAfterMs ?? 5000;

          events.push(`V1 pack (healthy): ${packIdV1}`);
          events.push(`V2 pack (failing): ${packIdV2}`);

          // Create service with V1
          const service = await serviceQueries.createService({
            name: `chaos-rollback-test-${Date.now()}`,
            packId: packIdV1,
            namespace: 'default',
            replicas: 2,
          });

          events.push(`Created service ${service.id} with V1`);

          // Wait for V1 to be healthy
          await sleep(10000);

          let v1Status = await serviceQueries.getServiceById(service.id);
          events.push(`V1 service status: ${v1Status?.status ?? 'unknown'}`);

          // Update to V2
          events.push('Updating to V2 (failing version)...');
          await serviceQueries.updateService(service.id, {
            packId: packIdV2,
          });

          // Wait briefly, then start failing pods
          await sleep(failAfterMs);

          events.push('Starting to fail V2 pods...');

          // Simulate V2 pods crashing
          for (let i = 0; i < 3; i++) {
            const pods = await podQueries.listPods({
              serviceId: service.id,
              limit: 100,
            });

            for (const pod of pods.filter((p) => p.status === 'running')) {
              await podQueries.updatePodStatus(pod.id, 'failed', {
                terminatedAt: new Date(),
                terminationReason: 'v2_crash',
                terminationMessage: 'CHAOS: V2 version crash',
              });
            }

            await sleep(5000);
          }

          // Check if rollback occurred
          await sleep(10000);

          const finalService = await serviceQueries.getServiceById(service.id);
          events.push(
            `Final service: status=${finalService?.status}, packId=${finalService?.packId}`
          );

          if (finalService?.packId === packIdV1) {
            events.push('✓ Rollback to V1 occurred!');
          } else {
            events.push('✗ No automatic rollback detected');
          }
          break;
        }
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        scenario: 'service-backoff',
        mode: options.mode,
        duration,
        events,
        stats: chaos.getStats(),
      };
    } catch (error) {
      chaos.clearSchedulerRules();
      return {
        success: false,
        scenario: 'service-backoff',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options: ServiceBackoffOptions): string[] {
    switch (options.mode) {
      case 'crash_loop':
        return [
          'Initial restart attempts are quick',
          'Backoff time increases exponentially',
          'Service eventually marked as degraded/failed',
          'Clear crash loop indication',
          'No infinite restart loop',
        ];
      case 'gradual_failure':
        return [
          'System handles low failure rates gracefully',
          'Higher failure rates trigger alerts/warnings',
          'Service maintains minimum replicas if possible',
          'Clear failure reasons exposed',
        ];
      case 'rollback_test':
        return [
          'V1 deploys successfully',
          'V2 service starts',
          'V2 failures detected',
          'Automatic rollback to V1 (if configured)',
          'System returns to stable state',
        ];
      default:
        return [];
    }
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'serviceId',
        type: 'string',
        required: false,
        description: 'Service ID to target for crash_loop mode',
        example: 'deploy-abc123',
      },
      {
        name: 'packIdV1',
        type: 'string',
        required: false,
        description: 'Healthy pack version for rollback_test mode',
        example: 'pack-v1',
      },
      {
        name: 'packIdV2',
        type: 'string',
        required: false,
        description: 'Failing pack version for rollback_test mode',
        example: 'pack-v2',
      },
      {
        name: 'mode',
        type: 'string',
        required: true,
        description: 'Service backoff simulation mode',
        choices: ['crash_loop', 'gradual_failure', 'rollback_test'],
        example: 'crash_loop',
      },
      {
        name: 'failAfterMs',
        type: 'number',
        required: false,
        description: 'Time in ms before V2 starts failing (rollback_test)',
        example: '5000',
      },
    ];
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default serviceBackoffScenario;
