/**
 * Chaos Scenario: Deployment Backoff
 *
 * Tests crash loops and rollback behavior:
 * - Deploy healthy version
 * - Deploy failing version
 * - Verify backoff and optional rollback
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { podQueries, deploymentQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult } from './types';

// Use the query modules that wrap the reactive stores

export interface DeploymentBackoffOptions {
  deploymentId?: string;
  packIdV1?: string; // Healthy version
  packIdV2?: string; // Failing version
  mode: 'crash_loop' | 'gradual_failure' | 'rollback_test';
  failAfterMs?: number; // How long V2 runs before failing
}

export const deploymentBackoffScenario: ChaosScenario<DeploymentBackoffOptions> = {
  name: 'deployment-backoff',
  description: 'Test deployment crash loops and rollback behavior',

  async validate(options: DeploymentBackoffOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    if (options.mode === 'rollback_test' && (!options.packIdV1 || !options.packIdV2)) {
      return { valid: false, error: 'packIdV1 and packIdV2 required for rollback_test' };
    }

    return { valid: true };
  },

  async execute(options: DeploymentBackoffOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const startTime = Date.now();
    const events: string[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: Deployment Backoff (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      switch (options.mode) {
        case 'crash_loop': {
          const deploymentId = options.deploymentId;
          if (!deploymentId) {
            // Get any active deployment
            events.push('No deployment specified, finding active deployment...');
            // Would need to query deployments here
          }

          events.push(`Targeting deployment: ${deploymentId ?? 'first available'}`);

          // Force pods into crash loop by failing them repeatedly
          if (deploymentId) {
            const deployment = await deploymentQueries.getDeploymentById(deploymentId);
            if (!deployment) {
              throw new Error(`Deployment ${deploymentId} not found`);
            }

            events.push(`Deployment found: ${deployment.name}, replicas: ${deployment.replicas}`);

            // Get pods for this deployment
            const pods = await podQueries.listPods({
              deploymentId,
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
              const currentPods = await podQueries.listPods({ deploymentId, limit: 100 });
              const running = currentPods.filter((p) => p.status === 'running').length;
              const pending = currentPods.filter((p) => p.status === 'pending').length;
              const failed = currentPods.filter((p) => p.status === 'failed').length;

              events.push(`Status: ${running} running, ${pending} pending, ${failed} failed`);
            }

            // Check final backoff state
            await sleep(5000);
            const finalDeployment = await deploymentQueries.getDeploymentById(deploymentId);
            events.push(
              `Final deployment status: ${finalDeployment?.status ?? 'unknown'}`
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

          // Create deployment with V1
          const deployment = await deploymentQueries.createDeployment({
            name: `chaos-rollback-test-${Date.now()}`,
            packId: packIdV1,
            namespace: 'default',
            replicas: 2,
          });

          events.push(`Created deployment ${deployment.id} with V1`);

          // Wait for V1 to be healthy
          await sleep(10000);

          let v1Status = await deploymentQueries.getDeploymentById(deployment.id);
          events.push(`V1 deployment status: ${v1Status?.status ?? 'unknown'}`);

          // Update to V2
          events.push('Updating to V2 (failing version)...');
          await deploymentQueries.updateDeployment(deployment.id, {
            packId: packIdV2,
          });

          // Wait briefly, then start failing pods
          await sleep(failAfterMs);

          events.push('Starting to fail V2 pods...');

          // Simulate V2 pods crashing
          for (let i = 0; i < 3; i++) {
            const pods = await podQueries.listPods({
              deploymentId: deployment.id,
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

          const finalDeployment = await deploymentQueries.getDeploymentById(deployment.id);
          events.push(
            `Final deployment: status=${finalDeployment?.status}, packId=${finalDeployment?.packId}`
          );

          if (finalDeployment?.packId === packIdV1) {
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
        scenario: 'deployment-backoff',
        mode: options.mode,
        duration,
        events,
        stats: chaos.getStats(),
      };
    } catch (error) {
      chaos.clearSchedulerRules();
      return {
        success: false,
        scenario: 'deployment-backoff',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(options: DeploymentBackoffOptions): string[] {
    switch (options.mode) {
      case 'crash_loop':
        return [
          'Initial restart attempts are quick',
          'Backoff time increases exponentially',
          'Deployment eventually marked as degraded/failed',
          'Clear crash loop indication',
          'No infinite restart loop',
        ];
      case 'gradual_failure':
        return [
          'System handles low failure rates gracefully',
          'Higher failure rates trigger alerts/warnings',
          'Deployment maintains minimum replicas if possible',
          'Clear failure reasons exposed',
        ];
      case 'rollback_test':
        return [
          'V1 deploys successfully',
          'V2 deployment starts',
          'V2 failures detected',
          'Automatic rollback to V1 (if configured)',
          'System returns to stable state',
        ];
      default:
        return [];
    }
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default deploymentBackoffScenario;
