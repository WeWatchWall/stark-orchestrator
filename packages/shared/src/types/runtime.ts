/**
 * Shared Runtime Types for Stark Orchestrator
 *
 * This module defines common types used by both Node.js and Browser runtime agents.
 * These types enable code sharing between the runtime implementations.
 *
 * @module @stark-o/shared/types/runtime
 */

import type { RuntimeTag } from './pack.js';
import type { Labels, Annotations } from './labels.js';
import type { ResourceRequirements } from './pod.js';

/**
 * WebSocket message structure used for agent communication
 */
export interface WsMessage<T = unknown> {
  type: string;
  payload: T;
  correlationId?: string;
}

/**
 * Connection state for runtime agents
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'authenticated'
  | 'registering'
  | 'registered';

/**
 * Common agent events shared between Node.js and Browser agents
 */
export type BaseAgentEvent =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'registered'
  | 'heartbeat'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'stopped';

/**
 * Pod-related agent events
 */
export type PodAgentEvent =
  | 'pod:deployed'
  | 'pod:started'
  | 'pod:stopped'
  | 'pod:failed';

/**
 * All agent events (base + pod events)
 */
export type AgentEvent = BaseAgentEvent | PodAgentEvent;

/**
 * Agent event handler function type
 */
export type AgentEventHandler<E extends string = AgentEvent> = (event: E, data?: unknown) => void;

/**
 * Pod deploy payload received from orchestrator
 */
export interface PodDeployPayload {
  podId: string;
  nodeId: string;
  pack: {
    id: string;
    name: string;
    version: string;
    runtimeTag: RuntimeTag;
    bundlePath: string;
    bundleContent?: string;
    metadata?: Record<string, unknown>;
  };
  resourceRequests?: ResourceRequirements;
  resourceLimits?: ResourceRequirements;
  labels?: Labels;
  annotations?: Annotations;
  namespace?: string;
}

/**
 * Pod stop payload received from orchestrator
 */
export interface PodStopPayload {
  podId: string;
  reason?: string;
}

/**
 * Pod status for local tracking in runtime agents
 */
export type LocalPodStatus = 
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

/**
 * Result of a pod operation (deploy/stop)
 */
export interface PodOperationResult {
  success: boolean;
  error?: string;
}

/**
 * Pack execution context passed to the pack's entry point.
 * Shared between Node.js and Browser runtimes.
 */
export interface PackExecutionContext {
  /** Unique execution ID */
  executionId: string;
  /** Pod ID */
  podId: string;
  /** Pack ID */
  packId: string;
  /** Pack version */
  packVersion: string;
  /** Pack name */
  packName: string;
  /** Runtime tag */
  runtimeTag: RuntimeTag;
  /** Environment variables */
  env: Record<string, string>;
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Pack execution result.
 * Shared between Node.js and Browser runtimes.
 */
export interface PackExecutionResult {
  /** Execution ID */
  executionId: string;
  /** Pod ID */
  podId: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Return value from the pack */
  returnValue?: unknown;
  /** Error message if failed */
  error?: string;
  /** Error stack trace if failed */
  errorStack?: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Memory usage in bytes (if available) */
  memoryUsage?: number;
  /** Exit code (0 for success) */
  exitCode: number;
}

/**
 * Running execution handle.
 * Shared between Node.js and Browser runtimes.
 */
export interface ExecutionHandle {
  /** Execution ID */
  executionId: string;
  /** Pod ID */
  podId: string;
  /** Promise resolving to execution result */
  promise: Promise<PackExecutionResult>;
  /** Cancel the execution (cooperative - task may continue until it checks for cancellation) */
  cancel: () => void;
  /** Force terminate the worker executing this task (immediate termination) */
  forceTerminate: () => Promise<void>;
  /** Check if cancelled */
  isCancelled: () => boolean;
  /** Execution start time */
  startedAt: Date;
}

/**
 * Pod handler configuration shared between runtimes
 */
export interface BasePodHandlerConfig {
  /** Callback when pod status changes */
  onStatusChange?: (podId: string, status: LocalPodStatus, message?: string) => void;
}

/**
 * Interface for pack executor (implemented by both Node.js and Browser runtimes)
 */
export interface IPackExecutor {
  /** Initialize the executor */
  initialize(): Promise<void>;
  /** Check if initialized */
  isInitialized(): boolean;
  /** Execute a pack for a pod */
  execute(
    pack: { id: string; name: string; version: string; runtimeTag: RuntimeTag; bundlePath: string; bundleContent?: string; metadata?: Record<string, unknown> },
    pod: { id: string; namespace: string; labels?: Labels; annotations?: Annotations; resourceRequests?: ResourceRequirements; resourceLimits?: ResourceRequirements },
    options?: { env?: Record<string, string>; timeout?: number; args?: unknown[] }
  ): ExecutionHandle;
  /** Shutdown the executor */
  shutdown(): Promise<void>;
}

/**
 * Map local pod status to orchestrator pod status string
 */
export function mapLocalStatusToPodStatus(status: LocalPodStatus): string {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'starting':
      return 'starting';
    case 'running':
      return 'running';
    case 'stopping':
      return 'stopping';
    case 'stopped':
      return 'stopped';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}
