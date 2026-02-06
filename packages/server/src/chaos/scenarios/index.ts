/**
 * Chaos Scenarios Index
 *
 * Exports all available chaos scenarios for the chaos runner.
 */

export * from './types';

// Individual scenarios
export { nodeLossScenario, default as nodeLoss } from './node-loss';
export { podCrashScenario, default as podCrash } from './pod-crash';
export { heartbeatDelayScenario, default as heartbeatDelay } from './heartbeat-delay';
export { schedulerConflictScenario, default as schedulerConflict } from './scheduler-conflict';
export { serviceBackoffScenario, default as serviceBackoff } from './service-backoff';
export {
  orchestratorRestartScenario,
  default as orchestratorRestart,
} from './orchestrator-restart';
export { apiFlakinesScenario, default as apiFlakiness } from './api-flakiness';

// Reconciliation test scenarios
export {
  nodeBanReconciliationScenario,
  heartbeatDelayConvergenceScenario,
  serviceShapeChangeScenario,
  default as reconciliationTests,
} from './reconciliation-tests';

// Scenario registry
import { nodeLossScenario } from './node-loss';
import { podCrashScenario } from './pod-crash';
import { heartbeatDelayScenario } from './heartbeat-delay';
import { schedulerConflictScenario } from './scheduler-conflict';
import { serviceBackoffScenario } from './service-backoff';
import { orchestratorRestartScenario } from './orchestrator-restart';
import { apiFlakinesScenario } from './api-flakiness';
import {
  nodeBanReconciliationScenario,
  heartbeatDelayConvergenceScenario,
  serviceShapeChangeScenario,
} from './reconciliation-tests';
import type { ChaosScenario, ScenarioRegistry } from './types';

export const scenarios: ScenarioRegistry = {
  'node-loss': nodeLossScenario as ChaosScenario<unknown>,
  'pod-crash': podCrashScenario as ChaosScenario<unknown>,
  'heartbeat-delay': heartbeatDelayScenario as ChaosScenario<unknown>,
  'scheduler-conflict': schedulerConflictScenario as ChaosScenario<unknown>,
  'service-backoff': serviceBackoffScenario as ChaosScenario<unknown>,
  'orchestrator-restart': orchestratorRestartScenario as ChaosScenario<unknown>,
  'api-flakiness': apiFlakinesScenario as ChaosScenario<unknown>,
  // Reconciliation test scenarios
  'node-ban-reconciliation': nodeBanReconciliationScenario as ChaosScenario<unknown>,
  'heartbeat-delay-convergence': heartbeatDelayConvergenceScenario as ChaosScenario<unknown>,
  'service-shape-change': serviceShapeChangeScenario as ChaosScenario<unknown>,
};

export function getScenario(name: string): ChaosScenario<unknown> | undefined {
  return scenarios[name];
}

export function listScenarios(): string[] {
  return Object.keys(scenarios);
}

export function describeScenarios(): { name: string; description: string }[] {
  return Object.entries(scenarios).map(([name, scenario]) => ({
    name,
    description: scenario.description,
  }));
}
