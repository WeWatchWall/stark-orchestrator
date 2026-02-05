/**
 * Chaos Controller
 *
 * Main entry point for chaos testing.
 * Provides a CLI interface and programmatic API for running chaos scenarios.
 */

import { getChaosProxy, ChaosProxyService } from '../services/chaos-proxy';
import { getExternalChaosRunner, ExternalChaosRunner } from './external-chaos';
import {
  getScenario,
  listScenarios,
  describeScenarios,
  ScenarioResult,
  OptionHelp,
} from './scenarios';
import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChaosControllerConfig {
  enabled?: boolean;
  dryRun?: boolean;
  seed?: number;
  logEvents?: boolean;
}

export interface ChaosRunOptions {
  scenario: string;
  options: Record<string, unknown>;
  timeout?: number;
}

export interface ChaosRunResult extends ScenarioResult {
  startedAt: Date;
  completedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chaos Controller
// ─────────────────────────────────────────────────────────────────────────────

export class ChaosController extends EventEmitter {
  private proxy: ChaosProxyService;
  private external: ExternalChaosRunner;
  private config: ChaosControllerConfig;
  private runHistory: ChaosRunResult[] = [];
  private isRunning = false;
  private currentScenario: string | null = null;

  constructor(config: ChaosControllerConfig = {}) {
    super();
    this.config = {
      enabled: config.enabled ?? false,
      dryRun: config.dryRun ?? false,
      seed: config.seed,
      logEvents: config.logEvents ?? true,
    };

    this.proxy = getChaosProxy({
      enabled: this.config.enabled ?? false,
      seed: this.config.seed,
    });

    this.external = getExternalChaosRunner({
      enabled: this.config.enabled ?? false,
      dryRun: this.config.dryRun,
    });

    if (this.config.logEvents) {
      this.setupEventLogging();
    }
  }

  private setupEventLogging(): void {
    this.proxy.on('chaos_event', (event) => {
      console.log(`[Chaos] ${event.type}:`, event.details);
      this.emit('chaos_event', event);
    });

    this.external.on('process_killed', (data) => {
      console.log(`[Chaos] Process killed:`, data);
      this.emit('external_event', { type: 'process_killed', ...data });
    });

    this.external.on('process_exited', (data) => {
      console.log(`[Chaos] Process exited:`, data);
      this.emit('external_event', { type: 'process_exited', ...data });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  enable(): void {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ REFUSING to enable chaos in production environment');
      return;
    }

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ⚡ CHAOS TESTING ENABLED ⚡                                  ║
║                                                              ║
║   WARNING: This will inject failures into the system.        ║
║   Only use in development/test environments.                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

    this.proxy.enable();
    this.external.enable();
    this.config.enabled = true;
    this.emit('enabled');
  }

  disable(): void {
    this.proxy.disable();
    this.external.disable();
    this.config.enabled = false;
    console.log('[Chaos] Chaos testing disabled');
    this.emit('disabled');
  }

  isEnabled(): boolean {
    return this.config.enabled ?? false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario Management
  // ─────────────────────────────────────────────────────────────────────────

  listAvailableScenarios(): { name: string; description: string }[] {
    return describeScenarios();
  }

  getScenarioDetails(name: string): {
    name: string;
    description: string;
    expectedBehavior: string[];
    options?: OptionHelp[];
  } | null {
    const scenario = getScenario(name);
    if (!scenario) return null;

    return {
      name: scenario.name,
      description: scenario.description,
      expectedBehavior: scenario.getExpectedBehavior({}),
      options: scenario.getOptionsHelp?.(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Run Scenarios
  // ─────────────────────────────────────────────────────────────────────────

  async run(options: ChaosRunOptions): Promise<ChaosRunResult> {
    if (!this.config.enabled) {
      throw new Error('Chaos controller not enabled. Call enable() first.');
    }

    if (this.isRunning) {
      throw new Error(`Already running scenario: ${this.currentScenario}`);
    }

    const scenario = getScenario(options.scenario);
    if (!scenario) {
      throw new Error(
        `Unknown scenario: ${options.scenario}. Available: ${listScenarios().join(', ')}`
      );
    }

    // Validate options
    const validation = await scenario.validate(options.options);
    if (!validation.valid) {
      const optionsHelp = scenario.getOptionsHelp?.();
      let errorMsg = `Invalid scenario options: ${validation.error}`;
      
      if (optionsHelp && optionsHelp.length > 0) {
        errorMsg += '\n\nRequired options:';
        for (const opt of optionsHelp) {
          const required = opt.required ? ' (required)' : '';
          const choices = opt.choices ? ` [${opt.choices.join('|')}]` : '';
          errorMsg += `\n  --option ${opt.name}=<${opt.type}>${required}${choices}`;
          errorMsg += `\n      ${opt.description}`;
          if (opt.example) {
            errorMsg += `\n      Example: ${opt.example}`;
          }
        }
        errorMsg += '\n\nUsage example:';
        errorMsg += `\n  stark chaos run ${options.scenario}` + optionsHelp
          .filter(o => o.required)
          .map(o => ` --option ${o.name}=${o.example ?? `<${o.type}>`}`)
          .join('');
      }
      
      throw new Error(errorMsg);
    }

    this.isRunning = true;
    this.currentScenario = options.scenario;
    const startedAt = new Date();

    console.log(`\n[Chaos] Starting scenario: ${options.scenario}`);
    this.emit('scenario_started', { scenario: options.scenario, options: options.options });

    try {
      // Run with timeout if specified
      let result: ScenarioResult;

      if (options.timeout) {
        result = await Promise.race([
          scenario.execute(options.options),
          new Promise<ScenarioResult>((_, reject) =>
            setTimeout(() => reject(new Error('Scenario timeout')), options.timeout)
          ),
        ]);
      } else {
        result = await scenario.execute(options.options);
      }

      const completedAt = new Date();

      const runResult: ChaosRunResult = {
        ...result,
        startedAt,
        completedAt,
      };

      this.runHistory.push(runResult);

      console.log(`\n[Chaos] Scenario completed: ${result.success ? '✓ SUCCESS' : '✗ FAILED'}`);
      if (!result.success) {
        console.log(`[Chaos] Error: ${result.error}`);
      }

      this.emit('scenario_completed', runResult);
      return runResult;
    } catch (error) {
      const completedAt = new Date();
      const runResult: ChaosRunResult = {
        success: false,
        scenario: options.scenario,
        duration: completedAt.getTime() - startedAt.getTime(),
        events: [],
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt,
      };

      this.runHistory.push(runResult);
      this.emit('scenario_failed', runResult);
      return runResult;
    } finally {
      this.isRunning = false;
      this.currentScenario = null;
    }
  }

  /**
   * Run multiple scenarios in sequence
   */
  async runSuite(scenarios: ChaosRunOptions[]): Promise<ChaosRunResult[]> {
    const results: ChaosRunResult[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS TEST SUITE: ${scenarios.length} scenarios`);
    console.log(`${'═'.repeat(60)}\n`);

    for (let i = 0; i < scenarios.length; i++) {
      const scenarioConfig = scenarios[i]!;
      console.log(`\n[${i + 1}/${scenarios.length}] Running: ${scenarioConfig.scenario}`);

      try {
        const result = await this.run(scenarioConfig);
        results.push(result);

        if (!result.success) {
          console.log(`[Chaos] Scenario failed, continuing with next...`);
        }
      } catch (error) {
        console.error(`[Chaos] Scenario error:`, error);
        results.push({
          success: false,
          scenario: scenarioConfig.scenario,
          duration: 0,
          events: [],
          error: error instanceof Error ? error.message : String(error),
          startedAt: new Date(),
          completedAt: new Date(),
        });
      }

      // Brief pause between scenarios
      await sleep(2000);
    }

    // Summary
    const passed = results.filter((r) => r.success).length;
    const failed = results.length - passed;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`⚡ CHAOS SUITE COMPLETE: ${passed} passed, ${failed} failed`);
    console.log(`${'═'.repeat(60)}\n`);

    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Quick Actions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Quick action: Simulate single node loss
   */
  async killNode(nodeId: string): Promise<ChaosRunResult> {
    return this.run({
      scenario: 'node-loss',
      options: { nodeId, mode: 'single' },
    });
  }

  /**
   * Quick action: Crash a pod
   */
  async crashPod(podId: string): Promise<ChaosRunResult> {
    return this.run({
      scenario: 'pod-crash',
      options: { podId, mode: 'crash' },
    });
  }

  /**
   * Quick action: Add heartbeat delays to a node
   */
  addHeartbeatDelay(nodeId: string, delayMs: number, durationMs?: number): void {
    if (!this.config.enabled) {
      console.warn('[Chaos] Not enabled');
      return;
    }
    this.proxy.simulateHeartbeatDelay(nodeId, delayMs, durationMs);
  }

  /**
   * Quick action: Enable API flakiness
   */
  setApiFlakiness(errorRate: number, timeoutRate?: number): void {
    if (!this.config.enabled) {
      console.warn('[Chaos] Not enabled');
      return;
    }
    this.proxy.setApiChaos({
      errorRate,
      timeoutRate,
    });
  }

  /**
   * Quick action: Clear all chaos rules
   */
  clearAll(): void {
    this.proxy.clearAllRules();
    console.log('[Chaos] All chaos rules cleared');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stats & History
  // ─────────────────────────────────────────────────────────────────────────

  getStats(): {
    enabled: boolean;
    runHistory: ChaosRunResult[];
    proxyStats: ReturnType<ChaosProxyService['getStats']>;
    currentScenario: string | null;
  } {
    return {
      enabled: this.config.enabled ?? false,
      runHistory: [...this.runHistory],
      proxyStats: this.proxy.getStats(),
      currentScenario: this.currentScenario,
    };
  }

  clearHistory(): void {
    this.runHistory = [];
    this.proxy.resetStats();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Access to underlying services
  // ─────────────────────────────────────────────────────────────────────────

  getProxy(): ChaosProxyService {
    return this.proxy;
  }

  getExternal(): ExternalChaosRunner {
    return this.external;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let chaosController: ChaosController | null = null;

export function getChaosController(config?: ChaosControllerConfig): ChaosController {
  if (!chaosController) {
    chaosController = new ChaosController(config);
  }
  return chaosController;
}

export function resetChaosController(): void {
  if (chaosController) {
    chaosController.disable();
  }
  chaosController = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
