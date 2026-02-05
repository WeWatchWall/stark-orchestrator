/**
 * Chaos Scenario Types
 */

import type { ChaosStats } from '../../services/chaos-proxy';

export interface ScenarioResult {
  success: boolean;
  scenario: string;
  mode?: string;
  duration: number;
  events: string[];
  error?: string;
  stats?: ChaosStats;
  data?: Record<string, unknown>;
}

/**
 * Describes a scenario option for help text
 */
export interface OptionHelp {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required: boolean;
  description: string;
  example?: string;
  choices?: string[];
}

export interface ChaosScenario<T = unknown> {
  name: string;
  description: string;

  /**
   * Validate scenario options before execution
   */
  validate(options: T): Promise<{ valid: boolean; error?: string }>;

  /**
   * Execute the chaos scenario
   */
  execute(options: T): Promise<ScenarioResult>;

  /**
   * Get expected behavior for documentation/verification
   */
  getExpectedBehavior(options: T): string[];

  /**
   * Get help text for scenario options (optional)
   */
  getOptionsHelp?(): OptionHelp[];
}

export interface ScenarioRegistry {
  [name: string]: ChaosScenario<unknown>;
}
