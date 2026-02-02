/**
 * Pod Handler
 * @module @stark-o/node-runtime/agent/pod-handler
 *
 * Handles pod deployment and lifecycle events received from the orchestrator.
 */

import {
  createServiceLogger,
  type Logger,
  type Pack,
  type Pod,
  type PodDeployPayload,
  type PodStopPayload,
  type LocalPodStatus,
  type PodOperationResult,
  type BasePodHandlerConfig,
  type ExecutionHandle,
  type PackExecutionResult,
} from '@stark-o/shared';
import { PackExecutor } from '../executor/pack-executor.js';

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
}

/**
 * Pod Handler
 *
 * Manages pod lifecycle on the node:
 * - Receives pod:deploy messages from orchestrator
 * - Executes pack bundles using PackExecutor
 * - Reports status changes back to orchestrator
 * - Handles graceful shutdown of running pods
 */
export class PodHandler {
  private readonly config: Required<Omit<PodHandlerConfig, 'logger' | 'onStatusChange'>> & {
    logger: Logger;
    onStatusChange?: PodHandlerConfig['onStatusChange'];
  };
  private readonly pods: Map<string, LocalPodState> = new Map();

  constructor(config: PodHandlerConfig) {
    this.config = {
      executor: config.executor,
      logger: config.logger ?? createServiceLogger({
        component: 'pod-handler',
        service: 'stark-node-runtime',
      }),
      onStatusChange: config.onStatusChange,
    };
  }

  /**
   * Handle a pod:deploy message
   */
  async handleDeploy(payload: PodDeployPayload): Promise<{ success: boolean; error?: string }> {
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

    // Create local pod state
    const state: LocalPodState = {
      podId,
      status: 'pending',
      pack,
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
      this.config.logger.error('Failed to deploy pod', error instanceof Error ? error : undefined, {
        podId,
        packId: pack.id,
      });
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

    if (result.success) {
      this.config.logger.info('Pod execution completed successfully', {
        podId,
        durationMs: result.durationMs,
      });
      this.updateStatus(podId, 'stopped');
    } else {
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
  async handleStop(payload: PodStopPayload): Promise<{ success: boolean; error?: string }> {
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
      this.config.logger.error('Failed to stop pod', error instanceof Error ? error : undefined, { podId });
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
   * Stop all running pods (for graceful shutdown)
   */
  async stopAll(): Promise<void> {
    const runningPods = this.getRunningPods();
    this.config.logger.info('Stopping all running pods', { count: runningPods.length });

    const stopPromises = runningPods.map(podId =>
      this.handleStop({ podId, reason: 'Node shutdown' })
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