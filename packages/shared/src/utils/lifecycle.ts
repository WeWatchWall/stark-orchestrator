/**
 * Pod Lifecycle Utilities
 * @module @stark-o/shared/utils/lifecycle
 *
 * Provides utilities for creating and managing pod lifecycle facts.
 */

import type { PodLifecycleFacts, PodLifecyclePhase, ShutdownHandler } from '../types/runtime.js';

/**
 * Creates a mutable lifecycle state manager for use within a worker context.
 * This is used internally by pack executors to create lifecycle facts that
 * can be updated during execution.
 */
export interface LifecycleStateManager {
  /** Get current lifecycle facts (readonly view) */
  readonly facts: PodLifecycleFacts;
  /** Transition to a new phase */
  setPhase(phase: PodLifecyclePhase): void;
  /** Request shutdown with optional reason */
  requestShutdown(reason?: string, gracefulTimeoutMs?: number): void;
  /** Register a shutdown handler */
  addShutdownHandler(handler: ShutdownHandler): void;
  /** Call all registered shutdown handlers */
  invokeShutdownHandlers(reason?: string): Promise<void>;
  /** Check if shutdown was requested */
  isShutdownRequested(): boolean;
}

/**
 * Creates a lifecycle state manager for tracking pod execution lifecycle.
 * 
 * @param initialPhase - Initial lifecycle phase (default: 'initializing')
 * @returns A lifecycle state manager with mutable internal state
 */
export function createLifecycleManager(initialPhase: PodLifecyclePhase = 'initializing'): LifecycleStateManager {
  let phase: PodLifecyclePhase = initialPhase;
  let isShuttingDown = false;
  let shutdownReason: string | undefined;
  let shutdownRequestedAt: Date | undefined;
  let gracefulTimeoutMs: number | undefined;
  const shutdownHandlers: ShutdownHandler[] = [];

  const facts: PodLifecycleFacts = {
    get phase() {
      return phase;
    },
    get isShuttingDown() {
      return isShuttingDown;
    },
    get shutdownReason() {
      return shutdownReason;
    },
    get shutdownRequestedAt() {
      return shutdownRequestedAt;
    },
    get gracefulShutdownRemainingMs() {
      if (!isShuttingDown || !shutdownRequestedAt || gracefulTimeoutMs === undefined) {
        return undefined;
      }
      const elapsed = Date.now() - shutdownRequestedAt.getTime();
      const remaining = Math.max(0, gracefulTimeoutMs - elapsed);
      return remaining;
    },
  };

  return {
    get facts() {
      return facts;
    },

    setPhase(newPhase: PodLifecyclePhase) {
      phase = newPhase;
    },

    requestShutdown(reason?: string, timeoutMs?: number) {
      if (!isShuttingDown) {
        isShuttingDown = true;
        shutdownReason = reason;
        shutdownRequestedAt = new Date();
        gracefulTimeoutMs = timeoutMs;
        phase = 'stopping';
      }
    },

    addShutdownHandler(handler: ShutdownHandler) {
      shutdownHandlers.push(handler);
    },

    async invokeShutdownHandlers(reason?: string) {
      const errors: Error[] = [];
      for (const handler of shutdownHandlers) {
        try {
          await handler(reason);
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `${errors.length} shutdown handler(s) failed`);
      }
    },

    isShutdownRequested() {
      return isShuttingDown;
    },
  };
}

/**
 * Creates a serializable snapshot of lifecycle facts for passing to workers.
 * Since workers receive serialized data, we need to create a snapshot that
 * includes default implementations for the callback methods.
 */
export interface SerializableLifecycleContext {
  /** Initial lifecycle facts (will be recreated in worker) */
  initialPhase: PodLifecyclePhase;
  /** Whether shutdown was already requested before worker started */
  isShuttingDown: boolean;
  /** Shutdown reason if already requested */
  shutdownReason?: string;
}

/**
 * Creates a serializable lifecycle context for passing to a worker.
 */
export function createSerializableLifecycleContext(
  manager?: LifecycleStateManager
): SerializableLifecycleContext {
  if (!manager) {
    return {
      initialPhase: 'running',
      isShuttingDown: false,
    };
  }

  return {
    initialPhase: manager.facts.phase,
    isShuttingDown: manager.facts.isShuttingDown,
    shutdownReason: manager.facts.shutdownReason,
  };
}

/**
 * Reconstructs lifecycle facts from a serializable context within a worker.
 * This creates a local lifecycle manager that the pack code can use.
 */
export function createWorkerLifecycleManager(
  context: SerializableLifecycleContext
): LifecycleStateManager {
  const manager = createLifecycleManager(context.initialPhase);
  
  if (context.isShuttingDown) {
    manager.requestShutdown(context.shutdownReason);
  }
  
  return manager;
}
