#!/usr/bin/env node
/**
 * Chaos Test Runner
 *
 * Entry point for dev:test script.
 * Provides an interactive CLI for running chaos tests.
 *
 * Usage:
 *   pnpm dev:test                    # Interactive mode
 *   pnpm dev:test node-loss          # Run specific scenario
 *   pnpm dev:test --list             # List scenarios
 *   pnpm dev:test --suite basic      # Run predefined suite
 */

import { createInterface } from 'readline';
import {
  getChaosController,
  ChaosController,
  describeScenarios,
} from './chaos';

// ─────────────────────────────────────────────────────────────────────────────
// Predefined Test Suites
// ─────────────────────────────────────────────────────────────────────────────

const testSuites = {
  basic: [
    { scenario: 'api-flakiness', options: { mode: 'intermittent', errorRate: 0.1, durationMs: 10000 } },
    { scenario: 'heartbeat-delay', options: { mode: 'delay', delayMs: 2000, durationMs: 15000 } },
  ],

  nodes: [
    { scenario: 'node-loss', options: { mode: 'single', nodeId: 'test-node-1' } },
    { scenario: 'heartbeat-delay', options: { mode: 'gradual_degradation', nodeId: 'test-node-1', durationMs: 30000 } },
    { scenario: 'node-loss', options: { mode: 'flapping', nodeId: 'test-node-1', flapCount: 3 } },
  ],

  pods: [
    { scenario: 'pod-crash', options: { mode: 'crash', podId: 'test-pod-1' } },
    { scenario: 'pod-crash', options: { mode: 'crash_loop', podId: 'test-pod-1', crashLoopCount: 3 } },
  ],

  scheduler: [
    { scenario: 'scheduler-conflict', options: { mode: 'resource_exhaustion', nodeId: 'test-node-1', podCount: 5, cpuRequest: 2000 } },
    { scenario: 'scheduler-conflict', options: { mode: 'race_condition', podCount: 10 } },
  ],

  full: [
    { scenario: 'api-flakiness', options: { mode: 'progressive', durationMs: 20000 } },
    { scenario: 'heartbeat-delay', options: { mode: 'intermittent', dropRate: 0.2, durationMs: 20000 } },
    { scenario: 'node-loss', options: { mode: 'single', nodeId: 'test-node-1' } },
    { scenario: 'scheduler-conflict', options: { mode: 'affinity_conflict' } },
    { scenario: 'deployment-backoff', options: { mode: 'crash_loop' } },
    { scenario: 'orchestrator-restart', options: { mode: 'graceful' } },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI Helpers
// ─────────────────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ⚡ STARK ORCHESTRATOR - CHAOS TEST RUNNER ⚡                 ║
║                                                              ║
║   Inject failures to test system resilience                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
}

function printHelp(): void {
  console.log(`
Usage: pnpm dev:test [options] [scenario]

Options:
  --list, -l              List available scenarios
  --describe <scenario>   Describe a specific scenario
  --suite <name>          Run a predefined test suite
  --dry-run               Don't execute, just show what would happen
  --seed <number>         Set random seed for reproducibility
  --help, -h              Show this help

Scenarios:
${describeScenarios()
  .map((s) => `  ${s.name.padEnd(25)} ${s.description}`)
  .join('\n')}

Suites:
${Object.keys(testSuites)
  .map((s) => `  ${s.padEnd(25)} ${(testSuites as any)[s].length} scenarios`)
  .join('\n')}

Interactive Mode:
  Run without arguments to enter interactive mode.

Examples:
  pnpm dev:test                           # Interactive mode
  pnpm dev:test node-loss                 # Run node-loss scenario
  pnpm dev:test --suite basic             # Run basic test suite
  pnpm dev:test --describe heartbeat-delay
`);
}

function printScenarios(): void {
  console.log('\nAvailable Chaos Scenarios:\n');
  for (const scenario of describeScenarios()) {
    console.log(`  ⚡ ${scenario.name}`);
    console.log(`     ${scenario.description}\n`);
  }
}

function printScenarioDetails(name: string, controller: ChaosController): void {
  const details = controller.getScenarioDetails(name);
  if (!details) {
    console.log(`Unknown scenario: ${name}`);
    return;
  }

  console.log(`\n⚡ Scenario: ${details.name}`);
  console.log(`   ${details.description}\n`);
  console.log('   Expected Behavior:');
  for (const behavior of details.expectedBehavior) {
    console.log(`     • ${behavior}`);
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive Mode
// ─────────────────────────────────────────────────────────────────────────────

async function interactiveMode(controller: ChaosController): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  };

  console.log('\nEntering interactive mode. Type "help" for commands.\n');

  let running = true;

  while (running) {
    const input = await prompt('chaos> ');
    const [command, ...args] = input.trim().split(/\s+/);

    switch (command?.toLowerCase()) {
      case 'help':
      case '?':
        console.log(`
Commands:
  list              List available scenarios
  describe <name>   Describe a scenario
  run <name>        Run a scenario (will prompt for options)
  suite <name>      Run a test suite
  stats             Show chaos statistics
  clear             Clear all chaos rules
  enable            Enable chaos injection
  disable           Disable chaos injection
  exit, quit        Exit interactive mode
`);
        break;

      case 'list':
        printScenarios();
        break;

      case 'describe':
        if (args[0]) {
          printScenarioDetails(args[0], controller);
        } else {
          console.log('Usage: describe <scenario-name>');
        }
        break;

      case 'run':
        if (!args[0]) {
          console.log('Usage: run <scenario-name>');
          break;
        }
        if (!controller.isEnabled()) {
          console.log('Chaos not enabled. Run "enable" first.');
          break;
        }
        try {
          const options = await promptForOptions(prompt, args[0]);
          const result = await controller.run({
            scenario: args[0],
            options,
          });
          printResult(result);
        } catch (error) {
          console.error('Error:', error instanceof Error ? error.message : error);
        }
        break;

      case 'suite':
        if (!args[0]) {
          console.log('Available suites:', Object.keys(testSuites).join(', '));
          break;
        }
        if (!controller.isEnabled()) {
          console.log('Chaos not enabled. Run "enable" first.');
          break;
        }
        const suite = (testSuites as any)[args[0]];
        if (!suite) {
          console.log(`Unknown suite: ${args[0]}`);
          break;
        }
        const results = await controller.runSuite(suite);
        console.log(`\nSuite ${args[0]} completed: ${results.filter((r) => r.success).length}/${results.length} passed`);
        break;

      case 'stats':
        const stats = controller.getStats();
        console.log('\nChaos Statistics:');
        console.log(`  Enabled: ${stats.enabled}`);
        console.log(`  Current scenario: ${stats.currentScenario ?? 'none'}`);
        console.log(`  Run history: ${stats.runHistory.length} runs`);
        console.log(`  Messages dropped: ${stats.proxyStats.messagesDropped}`);
        console.log(`  Connections terminated: ${stats.proxyStats.connectionsTerminated}`);
        console.log(`  API errors injected: ${stats.proxyStats.apiErrorsInjected}`);
        break;

      case 'clear':
        controller.clearAll();
        break;

      case 'enable':
        controller.enable();
        break;

      case 'disable':
        controller.disable();
        break;

      case 'exit':
      case 'quit':
        running = false;
        break;

      case '':
        break;

      default:
        console.log(`Unknown command: ${command}. Type "help" for commands.`);
    }
  }

  rl.close();
  console.log('\nExiting chaos test runner.\n');
}

async function promptForOptions(
  prompt: (q: string) => Promise<string>,
  scenario: string
): Promise<Record<string, unknown>> {
  const options: Record<string, unknown> = {};

  console.log(`\nConfiguring ${scenario} scenario:`);

  switch (scenario) {
    case 'node-loss':
      options.mode = await prompt('Mode (single/flapping/multi) [single]: ') || 'single';
      if (options.mode === 'single' || options.mode === 'flapping') {
        options.nodeId = await prompt('Node ID: ');
      }
      if (options.mode === 'multi') {
        const ids = await prompt('Node IDs (comma-separated): ');
        options.nodeIds = ids.split(',').map((s) => s.trim());
      }
      if (options.mode === 'flapping') {
        options.flapCount = parseInt(await prompt('Flap count [3]: ') || '3', 10);
      }
      break;

    case 'pod-crash':
      options.mode = await prompt('Mode (crash/slow_failure/crash_loop) [crash]: ') || 'crash';
      options.podId = await prompt('Pod ID: ');
      if (options.mode === 'crash_loop') {
        options.crashLoopCount = parseInt(await prompt('Crash count [5]: ') || '5', 10);
      }
      break;

    case 'heartbeat-delay':
      options.mode = await prompt('Mode (delay/intermittent/gradual_degradation) [delay]: ') || 'delay';
      options.nodeId = await prompt('Node ID: ');
      if (options.mode !== 'gradual_degradation') {
        options.delayMs = parseInt(await prompt('Delay ms [3000]: ') || '3000', 10);
      }
      options.durationMs = parseInt(await prompt('Duration ms [30000]: ') || '30000', 10);
      break;

    case 'api-flakiness':
      options.mode = await prompt('Mode (timeout/errors/intermittent/progressive) [intermittent]: ') || 'intermittent';
      if (options.mode === 'errors' || options.mode === 'intermittent') {
        options.errorRate = parseFloat(await prompt('Error rate 0-1 [0.3]: ') || '0.3');
      }
      options.durationMs = parseInt(await prompt('Duration ms [30000]: ') || '30000', 10);
      break;

    default:
      console.log('(Using default options for this scenario)');
  }

  return options;
}

function printResult(result: { success: boolean; scenario: string; events: string[]; error?: string }): void {
  console.log(`\n${result.success ? '✓ SUCCESS' : '✗ FAILED'}: ${result.scenario}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }
  if (result.events.length > 0) {
    console.log('  Events:');
    for (const event of result.events.slice(-10)) {
      console.log(`    - ${event}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  const flags = {
    help: args.includes('--help') || args.includes('-h'),
    list: args.includes('--list') || args.includes('-l'),
    dryRun: args.includes('--dry-run'),
    describe: args.includes('--describe') ? args[args.indexOf('--describe') + 1] : null,
    suite: args.includes('--suite') ? args[args.indexOf('--suite') + 1] : null,
    seed: args.includes('--seed') ? parseInt(args[args.indexOf('--seed') + 1]!, 10) : undefined,
  };

  // Get non-flag arguments (scenario name)
  const scenario = args.find((a) => !a.startsWith('-') && a !== flags.describe && a !== flags.suite && a !== String(flags.seed));

  printBanner();

  if (flags.help) {
    printHelp();
    return;
  }

  if (flags.list) {
    printScenarios();
    return;
  }

  // Create controller
  const controller = getChaosController({
    enabled: false,
    dryRun: flags.dryRun,
    seed: flags.seed,
  });

  if (flags.describe) {
    printScenarioDetails(flags.describe, controller);
    return;
  }

  // Enable chaos for running tests
  controller.enable();

  if (flags.suite) {
    const suite = (testSuites as any)[flags.suite];
    if (!suite) {
      console.error(`Unknown suite: ${flags.suite}`);
      console.log('Available:', Object.keys(testSuites).join(', '));
      process.exit(1);
    }
    const results = await controller.runSuite(suite);
    const passed = results.filter((r) => r.success).length;
    process.exit(passed === results.length ? 0 : 1);
  }

  if (scenario) {
    // Run single scenario with default options
    try {
      const result = await controller.run({
        scenario,
        options: getDefaultOptions(scenario),
      });
      printResult(result);
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  // Interactive mode
  await interactiveMode(controller);
}

function getDefaultOptions(scenario: string): Record<string, unknown> {
  switch (scenario) {
    case 'node-loss':
      return { mode: 'single', nodeId: 'test-node-1' };
    case 'pod-crash':
      return { mode: 'crash', podId: 'test-pod-1' };
    case 'heartbeat-delay':
      return { mode: 'delay', nodeId: 'test-node-1', delayMs: 3000, durationMs: 30000 };
    case 'scheduler-conflict':
      return { mode: 'affinity_conflict' };
    case 'deployment-backoff':
      return { mode: 'crash_loop' };
    case 'orchestrator-restart':
      return { mode: 'graceful' };
    case 'api-flakiness':
      return { mode: 'intermittent', errorRate: 0.3, durationMs: 30000 };
    default:
      return {};
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
