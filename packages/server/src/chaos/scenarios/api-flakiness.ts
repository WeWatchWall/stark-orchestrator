/**
 * Chaos Scenario: API Flakiness
 *
 * Simulates intermittent API/database failures:
 * - Timeouts
 * - 500 errors
 * - Partial failures
 */

import { getChaosProxy } from '../../services/chaos-proxy';
import { podQueries, nodeQueries } from '@stark-o/core';
import type { ChaosScenario, ScenarioResult, OptionHelp } from './types';

// Use the query modules that wrap the reactive stores

export interface ApiFlakinesOptions {
  mode: 'timeout' | 'errors' | 'intermittent' | 'progressive';
  errorRate?: number; // 0-1
  timeoutRate?: number; // 0-1
  timeoutMs?: number;
  durationMs?: number;
}

export const apiFlakinesScenario: ChaosScenario<ApiFlakinesOptions> = {
  name: 'api-flakiness',
  description: 'Simulate intermittent API and database failures',

  async validate(_options: ApiFlakinesOptions): Promise<{ valid: boolean; error?: string }> {
    const chaos = getChaosProxy();
    if (!chaos.isEnabled()) {
      return { valid: false, error: 'Chaos proxy not enabled' };
    }

    return { valid: true };
  },

  async execute(options: ApiFlakinesOptions): Promise<ScenarioResult> {
    const chaos = getChaosProxy();
    const startTime = Date.now();
    const events: string[] = [];
    const duration = options.durationMs ?? 30000;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SCENARIO: API Flakiness (${options.mode})`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
      switch (options.mode) {
        case 'timeout': {
          const timeoutRate = options.timeoutRate ?? 0.5;
          const timeoutMs = options.timeoutMs ?? 5000;

          events.push(`Setting ${timeoutRate * 100}% timeout rate (${timeoutMs}ms delays)`);

          chaos.setApiChaos({
            timeoutRate,
            timeoutMs,
          });

          // Test API calls
          events.push('Testing API calls with timeout chaos...');

          for (let i = 0; i < 5; i++) {
            const callStart = Date.now();
            try {
              await chaos.maybeFailApiCall(() => nodeQueries.listNodes({ limit: 10 }));
              events.push(`API call ${i + 1}: Success (${Date.now() - callStart}ms)`);
            } catch (error) {
              events.push(
                `API call ${i + 1}: Failed - ${error instanceof Error ? error.message : 'Unknown'}`
              );
            }
          }

          chaos.clearApiChaos();
          break;
        }

        case 'errors': {
          const errorRate = options.errorRate ?? 0.5;

          events.push(`Setting ${errorRate * 100}% error rate`);

          chaos.setApiChaos({
            errorRate,
          });

          // Test API calls
          events.push('Testing API calls with error chaos...');

          let successCount = 0;
          let errorCount = 0;

          for (let i = 0; i < 10; i++) {
            try {
              await chaos.maybeFailApiCall(() => podQueries.listPods({ limit: 10 }));
              successCount++;
            } catch {
              errorCount++;
            }
          }

          events.push(`Results: ${successCount} success, ${errorCount} errors`);
          events.push(`Actual error rate: ${(errorCount / 10 * 100).toFixed(1)}%`);

          chaos.clearApiChaos();
          break;
        }

        case 'intermittent': {
          const errorRate = options.errorRate ?? 0.3;
          const timeoutRate = options.timeoutRate ?? 0.2;

          events.push(
            `Setting intermittent chaos: ${errorRate * 100}% errors, ${timeoutRate * 100}% timeouts`
          );

          chaos.setApiChaos({
            errorRate,
            timeoutRate,
            timeoutMs: options.timeoutMs ?? 3000,
          });

          // Run for duration, monitoring behavior
          const checkInterval = 5000;
          const checks = Math.floor(duration / checkInterval);

          for (let i = 0; i < checks; i++) {
            await sleep(checkInterval);

            const stats = chaos.getStats();
            events.push(
              `[${((i + 1) * checkInterval) / 1000}s] API errors injected: ${stats.apiErrorsInjected}`
            );
          }

          chaos.clearApiChaos();
          events.push('Intermittent chaos stopped');
          break;
        }

        case 'progressive': {
          events.push('Progressive failure rate increase');

          const stages = [
            { errorRate: 0.1, timeoutRate: 0.05, label: 'light' },
            { errorRate: 0.3, timeoutRate: 0.1, label: 'moderate' },
            { errorRate: 0.5, timeoutRate: 0.2, label: 'heavy' },
            { errorRate: 0.8, timeoutRate: 0.3, label: 'severe' },
          ];

          const stageTime = duration / stages.length;

          for (const stage of stages) {
            events.push(`Stage: ${stage.label} (${stage.errorRate * 100}% errors)`);

            chaos.setApiChaos({
              errorRate: stage.errorRate,
              timeoutRate: stage.timeoutRate,
              timeoutMs: 2000,
            });

            // Test during this stage
            let success = 0;
            let fail = 0;
            const testCount = 5;

            for (let i = 0; i < testCount; i++) {
              try {
                await chaos.maybeFailApiCall(() => nodeQueries.listNodes({ limit: 5 }));
                success++;
              } catch {
                fail++;
              }
              await sleep(stageTime / testCount);
            }

            events.push(`  Results: ${success}/${testCount} successful`);
          }

          chaos.clearApiChaos();
          events.push('Progressive chaos complete');
          break;
        }
      }

      const finalDuration = Date.now() - startTime;

      return {
        success: true,
        scenario: 'api-flakiness',
        mode: options.mode,
        duration: finalDuration,
        events,
        stats: chaos.getStats(),
      };
    } catch (error) {
      chaos.clearApiChaos();
      return {
        success: false,
        scenario: 'api-flakiness',
        mode: options.mode,
        duration: Date.now() - startTime,
        events,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  getExpectedBehavior(_options: ApiFlakinesOptions): string[] {
    return [
      'Orchestrator retries failed API calls',
      'Exponential backoff on repeated failures',
      'No partial state corruption',
      'Clear error logging',
      'Graceful degradation under high failure rates',
      'Recovery when failures stop',
      'Transactions rolled back on failure',
    ];
  },

  getOptionsHelp(): OptionHelp[] {
    return [
      {
        name: 'mode',
        type: 'string',
        required: true,
        description: 'API flakiness simulation mode',
        choices: ['timeout', 'errors', 'intermittent', 'progressive'],
        example: 'intermittent',
      },
      {
        name: 'errorRate',
        type: 'number',
        required: false,
        description: 'Probability of API error (0-1)',
        example: '0.5',
      },
      {
        name: 'timeoutRate',
        type: 'number',
        required: false,
        description: 'Probability of API timeout (0-1)',
        example: '0.3',
      },
      {
        name: 'timeoutMs',
        type: 'number',
        required: false,
        description: 'Timeout delay in milliseconds',
        example: '5000',
      },
      {
        name: 'durationMs',
        type: 'number',
        required: false,
        description: 'How long to run the scenario in milliseconds',
        example: '30000',
      },
    ];
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default apiFlakinesScenario;
