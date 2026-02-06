/**
 * Pod Handler (Browser Runtime)
 * @module @stark-o/browser-runtime/agent/pod-handler
 *
 * Handles pod service and lifecycle events received from the orchestrator.
 * Browser-compatible implementation using Web Workers for pack execution.
 */

import { createServiceLogger, type Logger, type RuntimeTag } from '@stark-o/shared';
import type { ResourceRequirements, Labels, Annotations, Pack, Pod } from '@stark-o/shared';
import type {
  PodDeployPayload,
  PodStopPayload,
  LocalPodStatus,
  PodOperationResult,
  BasePodHandlerConfig,
} from '@stark-o/shared';
import { PackExecutor, type ExecutionHandle, type PackExecutionResult } from '../executor/pack-executor.js';

/**
 * Pod handler configuration
 */
export interface PodHandlerConfig extends BasePodHandlerConfig {
  /** Executor to run packs */
  executor: PackExecutor;
  /** Logger instance */
  logger?: Logger;
}

/**
 * Local pod state
 */
interface LocalPodState {
  podId: string;
  status: LocalPodStatus;
  pack: PodDeployPayload['pack'];
  executionHandle?: ExecutionHandle;
  startedAt?: Date;
  stoppedAt?: Date;
  error?: string;
  /** Number of times this pod has been restarted */
  restartCount: number;
  /** Total execution count for this pod */
  executionCount: number;
  /** Successful execution count */
  successfulExecutions: number;
  /** Failed execution count */
  failedExecutions: number;
  /** Total execution time in milliseconds */
  totalExecutionTimeMs: number;
}

/**
 * Browser-compatible logger interface
 */
interface BrowserLogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, error?: Error, meta?: Record<string, unknown>) => void;
}

/**
 * Create a browser-compatible logger wrapper
 */
function createBrowserLoggerWrapper(logger: Logger): BrowserLogger {
  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      logger.debug(message, meta);
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      logger.info(message, meta);
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      logger.warn(message, meta);
    },
    error: (message: string, error?: Error, meta?: Record<string, unknown>) => {
      logger.error(message, error, meta);
    },
  };
}

/**
 * Pod Handler (Browser Runtime)
 *
 * Manages pod lifecycle in the browser:
 * - Receives pod:deploy messages from orchestrator
 * - Executes pack bundles using PackExecutor with Web Workers
 * - Reports status changes back to orchestrator
 * - Handles graceful shutdown of running pods
 */
export class PodHandler {
  private readonly config: {
    executor: PackExecutor;
    logger: BrowserLogger;
    onStatusChange?: BasePodHandlerConfig['onStatusChange'];
  };
  private readonly pods: Map<string, LocalPodState> = new Map();

  constructor(config: PodHandlerConfig) {
    this.config = {
      executor: config.executor,
      logger: createBrowserLoggerWrapper(
        config.logger ?? createServiceLogger({
          component: 'pod-handler',
          service: 'stark-browser-runtime',
        })
      ),
      onStatusChange: config.onStatusChange,
    };
  }

  /**
   * Handle a pod:deploy message
   */
  async handleDeploy(payload: PodDeployPayload): Promise<PodOperationResult> {
    const { podId, pack } = payload;

    this.config.logger.info('Received pod deploy request', {
      podId,
      packId: pack.id,
      packName: pack.name,
      packVersion: pack.version,
    });

    // Check if pod already exists locally
    if (this.pods.has(podId)) {
      const existing = this.pods.get(podId)!;
      if (existing.status === 'running' || existing.status === 'starting') {
        this.config.logger.warn('Pod already running', { podId });
        return { success: false, error: 'Pod already running' };
      }
    }

    // Create local pod state (or reuse existing for restart tracking)
    const existingState = this.pods.get(podId);
    const state: LocalPodState = {
      podId,
      status: 'pending',
      pack,
      restartCount: existingState?.restartCount ?? 0,
      executionCount: existingState?.executionCount ?? 0,
      successfulExecutions: existingState?.successfulExecutions ?? 0,
      failedExecutions: existingState?.failedExecutions ?? 0,
      totalExecutionTimeMs: existingState?.totalExecutionTimeMs ?? 0,
    };
    this.pods.set(podId, state);

    try {
      // Update status to starting
      this.updateStatus(podId, 'starting');

      // Build Pack and Pod objects for executor
      const packObj: Pack = {
        id: pack.id,
        name: pack.name,
        version: pack.version,
        runtimeTag: pack.runtimeTag,
        bundlePath: pack.bundlePath,
        bundleContent: pack.bundleContent,
        metadata: pack.metadata ?? {},
        ownerId: 'system',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const podObj: Pod = {
        id: podId,
        packId: pack.id,
        packVersion: pack.version,
        status: 'starting',
        nodeId: payload.nodeId,
        namespace: payload.namespace ?? 'default',
        labels: payload.labels ?? {},
        annotations: payload.annotations ?? {},
        priority: 0,
        tolerations: [],
        resourceRequests: payload.resourceRequests ?? { cpu: 100, memory: 128 },
        resourceLimits: payload.resourceLimits ?? { cpu: 500, memory: 512 },
        scheduling: {},
        createdBy: 'system',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Execute the pack
      const executionHandle = this.config.executor.execute(packObj, podObj);
      state.executionHandle = executionHandle;
      state.startedAt = new Date();

      // Update status to running
      this.updateStatus(podId, 'running');

      // Handle execution completion asynchronously
      executionHandle.promise.then((result) => {
        this.handleExecutionComplete(podId, result);
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger.error(
        'Failed to deploy pod',
        error instanceof Error ? error : undefined,
        { podId, packId: pack.id }
      );
      this.updateStatus(podId, 'failed', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Handle pod execution completion
   */
  private handleExecutionComplete(podId: string, result: PackExecutionResult): void {
    const state = this.pods.get(podId);
    if (!state) {
      this.config.logger.warn('Pod not found after execution complete', { podId });
      return;
    }

    state.stoppedAt = new Date();

    // Record execution metrics
    const durationMs = result.durationMs ?? 0;
    state.executionCount++;
    state.totalExecutionTimeMs += durationMs;

    // If pod is already stopping (graceful shutdown in progress), treat as successful stop
    // This prevents a race condition where the execution completes with cancelled status
    // before handleStop can update the status to stopped
    if (state.status === 'stopping') {
      state.successfulExecutions++;
      this.config.logger.info('Pod execution stopped gracefully', {
        podId,
        durationMs: result.durationMs,
      });
      this.updateStatus(podId, 'stopped');
      return;
    }

    if (result.success) {
      state.successfulExecutions++;
      this.config.logger.info('Pod execution completed successfully', {
        podId,
        durationMs: result.durationMs,
      });
      this.updateStatus(podId, 'stopped');
    } else {
      state.failedExecutions++;
      this.config.logger.warn('Pod execution failed', {
        podId,
        error: result.error,
        exitCode: result.exitCode,
      });
      state.error = result.error;
      this.updateStatus(podId, 'failed', result.error);
    }
  }

  /**
   * Handle a pod:stop message
   */
  async handleStop(payload: PodStopPayload): Promise<PodOperationResult> {
    const { podId, reason } = payload;

    this.config.logger.info('Received pod stop request', { podId, reason });

    const state = this.pods.get(podId);
    if (!state) {
      return { success: false, error: 'Pod not found' };
    }

    if (state.status !== 'running') {
      return { success: false, error: `Pod is not running (status: ${state.status})` };
    }

    try {
      this.updateStatus(podId, 'stopping');

      // Gracefully stop the execution - invokes shutdown handlers, then force terminates
      if (state.executionHandle) {
        // Use gracefulStop if available (allows pack code to clean up)
        if (state.executionHandle.gracefulStop) {
          await state.executionHandle.gracefulStop(reason);
        } else {
          // Fall back to force terminate
          await state.executionHandle.forceTerminate();
        }
      }

      state.stoppedAt = new Date();
      this.updateStatus(podId, 'stopped');

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.config.logger.error(
        'Failed to stop pod',
        error instanceof Error ? error : undefined,
        { podId }
      );
      this.updateStatus(podId, 'failed', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update pod status and notify callback
   */
  private updateStatus(podId: string, status: LocalPodStatus, message?: string): void {
    const state = this.pods.get(podId);
    if (state) {
      state.status = status;
      this.config.logger.debug('Pod status updated', { podId, status, message });
    }

    if (this.config.onStatusChange) {
      this.config.onStatusChange(podId, status, message);
    }
  }

  /**
   * Get the status of a local pod
   */
  getStatus(podId: string): LocalPodStatus | null {
    const state = this.pods.get(podId);
    return state?.status ?? null;
  }

  /**
   * Get all running pod IDs
   */
  getRunningPods(): string[] {
    const running: string[] = [];
    for (const [podId, state] of this.pods) {
      if (state.status === 'running') {
        running.push(podId);
      }
    }
    return running;
  }

  /**
   * Get count of pods by status
   */
  getPodCounts(): Record<LocalPodStatus, number> {
    const counts: Record<LocalPodStatus, number> = {
      pending: 0,
      starting: 0,
      running: 0,
      stopping: 0,
      stopped: 0,
      failed: 0,
    };

    for (const state of this.pods.values()) {
      counts[state.status]++;
    }

    return counts;
  }

  /**
   * Get restart statistics for all pods
   */
  getRestartStats(): { totalRestarts: number; podsWithRestarts: number; restartsByPod: Map<string, number> } {
    let totalRestarts = 0;
    let podsWithRestarts = 0;
    const restartsByPod = new Map<string, number>();

    for (const [podId, state] of this.pods) {
      restartsByPod.set(podId, state.restartCount);
      totalRestarts += state.restartCount;
      if (state.restartCount > 0) {
        podsWithRestarts++;
      }
    }

    return { totalRestarts, podsWithRestarts, restartsByPod };
  }

  /**
   * Get execution metrics for all pods
   */
  getPodMetrics(): Array<{
    podId: string;
    status: LocalPodStatus;
    restartCount: number;
    executionCount: number;
    successfulExecutions: number;
    failedExecutions: number;
    totalExecutionTimeMs: number;
    avgExecutionTimeMs: number | null;
  }> {
    const metrics: Array<{
      podId: string;
      status: LocalPodStatus;
      restartCount: number;
      executionCount: number;
      successfulExecutions: number;
      failedExecutions: number;
      totalExecutionTimeMs: number;
      avgExecutionTimeMs: number | null;
    }> = [];

    for (const [podId, state] of this.pods) {
      metrics.push({
        podId,
        status: state.status,
        restartCount: state.restartCount,
        executionCount: state.executionCount,
        successfulExecutions: state.successfulExecutions,
        failedExecutions: state.failedExecutions,
        totalExecutionTimeMs: state.totalExecutionTimeMs,
        avgExecutionTimeMs: state.executionCount > 0
          ? Math.round(state.totalExecutionTimeMs / state.executionCount)
          : null,
      });
    }

    return metrics;
  }

  /**
   * Increment restart count for a pod (called when pod is restarted)
   */
  incrementRestartCount(podId: string): void {
    const state = this.pods.get(podId);
    if (state) {
      state.restartCount++;
      this.config.logger.debug('Pod restart count incremented', { podId, restartCount: state.restartCount });
    }
  }

  /**
   * Record an execution result for a pod
   */
  recordExecution(podId: string, success: boolean, durationMs: number): void {
    const state = this.pods.get(podId);
    if (state) {
      state.executionCount++;
      state.totalExecutionTimeMs += durationMs;
      if (success) {
        state.successfulExecutions++;
      } else {
        state.failedExecutions++;
      }
    }
  }

  /**
   * Stop all running pods (for graceful shutdown)
   */
  async stopAll(): Promise<void> {
    const runningPods = this.getRunningPods();
    this.config.logger.info('Stopping all running pods', { count: runningPods.length });

    const stopPromises = runningPods.map(podId =>
      this.handleStop({ podId, reason: 'Agent shutdown' })
    );

    await Promise.all(stopPromises);
  }
}

/**
 * Create a pod handler instance
 */
export function createPodHandler(config: PodHandlerConfig): PodHandler {
  return new PodHandler(config);
}

// Re-export types for convenience
export type { PodDeployPayload, PodStopPayload, LocalPodStatus, PodOperationResult };
