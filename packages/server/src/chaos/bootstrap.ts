/**
 * Chaos Mode Bootstrap
 *
 * Call this during server startup to conditionally enable chaos mode.
 * Chaos mode is only enabled if:
 * - NODE_ENV is not 'production'
 * - STARK_CHAOS_ENABLED=true environment variable is set
 *
 * Usage in server startup:
 *   import { bootstrapChaosMode } from './chaos/bootstrap';
 *   bootstrapChaosMode(connectionManager);
 */

import type { ConnectionManager } from '../ws/connection-manager';
import { getChaosController } from './controller';
import { getChaosIntegration } from './integration';

export interface ChaosBootstrapOptions {
  /** Force enable even if env var not set (for testing) */
  forceEnable?: boolean;
  /** Seed for reproducible randomness */
  seed?: number;
  /** Log all chaos events */
  logEvents?: boolean;
}

/**
 * Bootstrap chaos mode during server startup
 */
export function bootstrapChaosMode(
  connectionManager: ConnectionManager,
  options: ChaosBootstrapOptions = {}
): void {
  // Check if we should enable chaos
  const isProduction = process.env.NODE_ENV === 'production';
  const chaosEnvEnabled = process.env.STARK_CHAOS_ENABLED === 'true';

  if (isProduction) {
    console.log('[Chaos] Production environment detected - chaos mode disabled');
    return;
  }

  if (!chaosEnvEnabled && !options.forceEnable) {
    console.log('[Chaos] Chaos mode not enabled (set STARK_CHAOS_ENABLED=true to enable)');
    return;
  }

  console.log('[Chaos] Bootstrapping chaos mode...');

  // Get controller and integration
  const controller = getChaosController({
    enabled: false, // Will enable after setup
    seed: options.seed,
    logEvents: options.logEvents ?? true,
  });

  const integration = getChaosIntegration();

  // Attach integration to connection manager
  integration.attach(connectionManager);

  // Enable chaos
  controller.enable();

  // Log available scenarios
  console.log('[Chaos] Available scenarios:');
  for (const scenario of controller.listAvailableScenarios()) {
    console.log(`  - ${scenario.name}: ${scenario.description}`);
  }

  // Set up graceful shutdown
  const shutdown = (): void => {
    console.log('[Chaos] Shutting down chaos mode...');
    controller.disable();
    integration.detach();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('[Chaos] ⚡ Chaos mode ready');
  console.log('[Chaos] Run "pnpm dev:test" to inject failures');
}

/**
 * Check if chaos mode is currently enabled
 */
export function isChaosEnabled(): boolean {
  try {
    const controller = getChaosController();
    return controller.isEnabled();
  } catch {
    return false;
  }
}
