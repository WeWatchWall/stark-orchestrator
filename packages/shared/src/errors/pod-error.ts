/**
 * Pod-specific error class
 * @module @stark-o/shared/errors/pod-error
 */

import { StarkError, ErrorCode, ErrorMeta } from './base-error';

/**
 * Pod scheduling failure reason
 */
export interface SchedulingFailureReason {
  /** Reason type */
  type: 
    | 'no_nodes'           // No nodes available
    | 'no_compatible_nodes' // No nodes with matching runtime
    | 'insufficient_resources' // Nodes don't have enough resources
    | 'taint_not_tolerated' // Pod doesn't tolerate node taints
    | 'affinity_not_met'   // Affinity rules not satisfied
    | 'quota_exceeded'     // Namespace quota exceeded
    | 'scheduler_error';   // Internal scheduler error
  /** Detailed message */
  message: string;
  /** Nodes that were considered */
  consideredNodes?: number;
  /** Nodes that were filtered out */
  filteredNodes?: number;
}

/**
 * Pod execution failure details
 */
export interface ExecutionFailureDetails {
  /** Exit code if available */
  exitCode?: number;
  /** Error output */
  stderr?: string;
  /** Execution duration in ms */
  durationMs?: number;
  /** Memory usage at failure */
  memoryUsage?: number;
}

/**
 * Pod-specific error class
 */
export class PodError extends StarkError {
  /** Pod ID if available */
  public readonly podId?: string;
  /** Pack ID if available */
  public readonly packId?: string;
  /** Node ID if available */
  public readonly nodeId?: string;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.POD_SCHEDULING_FAILED,
    meta: ErrorMeta = {},
    podId?: string,
    packId?: string,
    nodeId?: string,
  ) {
    super(message, code, {
      ...meta,
      resourceType: 'pod',
      resourceId: podId,
    });
    this.name = 'PodError';
    this.podId = podId;
    this.packId = packId;
    this.nodeId = nodeId;
  }

  /**
   * Create for scheduling failure
   */
  static schedulingFailed(
    reason: SchedulingFailureReason,
    podId?: string,
    packId?: string,
  ): PodError {
    return new PodError(
      `Pod scheduling failed: ${reason.message}`,
      ErrorCode.POD_SCHEDULING_FAILED,
      {
        schedulingReason: reason.type,
        consideredNodes: reason.consideredNodes,
        filteredNodes: reason.filteredNodes,
      },
      podId,
      packId,
    );
  }

  /**
   * Create for no available nodes
   */
  static noAvailableNodes(runtimeType?: string, podId?: string): PodError {
    const message = runtimeType
      ? `No available ${runtimeType} nodes for scheduling`
      : 'No available nodes for scheduling';
    return new PodError(
      message,
      ErrorCode.NO_AVAILABLE_NODES,
      { runtimeType },
      podId,
    );
  }

  /**
   * Create for start failure
   */
  static startFailed(
    reason: string,
    podId: string,
    nodeId?: string,
  ): PodError {
    return new PodError(
      `Pod failed to start: ${reason}`,
      ErrorCode.POD_START_FAILED,
      {},
      podId,
      undefined,
      nodeId,
    );
  }

  /**
   * Create for execution failure
   */
  static executionFailed(
    reason: string,
    details: ExecutionFailureDetails,
    podId: string,
    nodeId?: string,
  ): PodError {
    return new PodError(
      `Pod execution failed: ${reason}`,
      ErrorCode.POD_EXECUTION_FAILED,
      {
        exitCode: details.exitCode,
        durationMs: details.durationMs,
        memoryUsage: details.memoryUsage,
      },
      podId,
      undefined,
      nodeId,
    );
  }

  /**
   * Create for timeout
   */
  static timeout(
    timeoutMs: number,
    podId: string,
    nodeId?: string,
  ): PodError {
    return new PodError(
      `Pod execution timed out after ${timeoutMs}ms`,
      ErrorCode.POD_TIMEOUT,
      { timeoutMs },
      podId,
      undefined,
      nodeId,
    );
  }

  /**
   * Create for pod not found
   */
  static notFound(podId: string): PodError {
    return new PodError(
      `Pod '${podId}' not found`,
      ErrorCode.POD_NOT_FOUND,
      {},
      podId,
    );
  }

  /**
   * Create for already running
   */
  static alreadyRunning(podId: string): PodError {
    return new PodError(
      `Pod '${podId}' is already running`,
      ErrorCode.POD_ALREADY_RUNNING,
      {},
      podId,
    );
  }

  /**
   * Create for eviction
   */
  static evicted(
    reason: string,
    podId: string,
    nodeId?: string,
  ): PodError {
    return new PodError(
      `Pod was evicted: ${reason}`,
      ErrorCode.POD_EVICTED,
      { evictionReason: reason },
      podId,
      undefined,
      nodeId,
    );
  }

  /**
   * Create for runtime mismatch
   */
  static runtimeMismatch(
    packRuntime: string,
    nodeRuntime: string,
    podId?: string,
    packId?: string,
  ): PodError {
    return new PodError(
      `Pack runtime '${packRuntime}' is not compatible with node runtime '${nodeRuntime}'`,
      ErrorCode.PACK_RUNTIME_MISMATCH,
      { packRuntime, nodeRuntime },
      podId,
      packId,
    );
  }

  /**
   * Convert to JSON for API responses
   */
  override toJSON(): Record<string, unknown> {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        podId: this.podId,
        packId: this.packId,
        nodeId: this.nodeId,
        meta: this.meta,
        timestamp: this.timestamp.toISOString(),
        correlationId: this.correlationId,
      },
    };
  }
}

/**
 * Check if an error is a PodError
 */
export function isPodError(error: unknown): error is PodError {
  return error instanceof PodError;
}

/**
 * Create common scheduling failure reasons
 */
export const SchedulingFailures = {
  noNodes: (): SchedulingFailureReason => ({
    type: 'no_nodes',
    message: 'No nodes are registered in the cluster',
    consideredNodes: 0,
  }),

  noCompatibleNodes: (runtime: string, considered: number): SchedulingFailureReason => ({
    type: 'no_compatible_nodes',
    message: `No nodes with '${runtime}' runtime available`,
    consideredNodes: considered,
    filteredNodes: considered,
  }),

  insufficientResources: (considered: number, filtered: number): SchedulingFailureReason => ({
    type: 'insufficient_resources',
    message: 'No nodes with sufficient resources available',
    consideredNodes: considered,
    filteredNodes: filtered,
  }),

  taintNotTolerated: (taintKey: string, considered: number): SchedulingFailureReason => ({
    type: 'taint_not_tolerated',
    message: `No nodes without untolerated taint '${taintKey}'`,
    consideredNodes: considered,
  }),

  affinityNotMet: (considered: number): SchedulingFailureReason => ({
    type: 'affinity_not_met',
    message: 'No nodes satisfy affinity requirements',
    consideredNodes: considered,
  }),

  quotaExceeded: (namespace: string): SchedulingFailureReason => ({
    type: 'quota_exceeded',
    message: `Namespace '${namespace}' quota exceeded`,
  }),

  schedulerError: (message: string): SchedulingFailureReason => ({
    type: 'scheduler_error',
    message: `Scheduler error: ${message}`,
  }),
} as const;
