/**
 * Shared Runtime Types for Stark Orchestrator
 *
 * This module defines common types used by both Node.js and Browser runtime agents.
 * These types enable code sharing between the runtime implementations.
 *
 * @module @stark-o/shared/types/runtime
 */

import type { RuntimeTag, PackNamespace } from './pack.js';
import type { Labels, Annotations } from './labels.js';
import type { ResourceRequirements } from './pod.js';
import type { Capability } from './capabilities.js';
import type { EphemeralDataPlane } from '../network/ephemeral-data-plane.js';

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
  serviceId?: string;
  /** Pod authentication token for data plane (network) connections */
  podToken?: string;
  /** Refresh token for automatic token renewal */
  podRefreshToken?: string;
  /** Token expiration timestamp (ISO string) */
  podTokenExpiresAt?: string;
  pack: {
    id: string;
    name: string;
    version: string;
    runtimeTag: RuntimeTag;
    namespace?: PackNamespace;
    bundlePath: string;
    bundleContent?: string;
    metadata?: Record<string, unknown>;
    grantedCapabilities?: Capability[];
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
 * Pod lifecycle phase - represents the current phase in the pod's lifecycle.
 * Exposed as a "fact" that running pack code can query.
 */
export type PodLifecyclePhase = 
  | 'initializing'  // Pod is being set up
  | 'running'       // Pod is actively executing
  | 'stopping'      // Graceful shutdown requested, cleanup time granted
  | 'terminated';   // Pod execution has ended

/**
 * Pod lifecycle facts - queryable state about the pod's lifecycle.
 * These are "facts" that the running pack code can query to understand its execution context.
 */
export interface PodLifecycleFacts {
  /** Current lifecycle phase */
  readonly phase: PodLifecyclePhase;
  /** Whether a shutdown has been requested (graceful stop signal received) */
  readonly isShuttingDown: boolean;
  /** Reason for shutdown (if stopping/terminated) */
  readonly shutdownReason?: string;
  /** Timestamp when shutdown was requested (if stopping) */
  readonly shutdownRequestedAt?: Date;
  /** Time remaining for graceful shutdown in ms (if stopping), undefined if not stopping */
  readonly gracefulShutdownRemainingMs?: number;
}

/**
 * Callback for shutdown notification - allows pack code to handle graceful shutdown
 */
export type ShutdownHandler = (reason?: string) => void | Promise<void>;

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
  
  /**
   * Pod lifecycle facts - queryable state about the pod's lifecycle.
   * Use this to check if the pod is shutting down and respond gracefully.
   * 
   * @example
   * ```typescript
   * // Check if shutdown was requested
   * if (context.lifecycle.isShuttingDown) {
   *   await cleanup();
   *   return;
   * }
   * 
   * // Periodic check in long-running operations
   * while (!context.lifecycle.isShuttingDown) {
   *   await doWork();
   * }
   * ```
   */
  lifecycle: PodLifecycleFacts;
  
  /**
   * Register a handler to be called when shutdown is requested.
   * The handler will be invoked during graceful shutdown before force termination.
   * 
   * @param handler - Async function to call on shutdown
   * @example
   * ```typescript
   * context.onShutdown(async (reason) => {
   *   console.log(`Shutting down: ${reason}`);
   *   await saveState();
   *   await closeConnections();
   * });
   * ```
   */
  onShutdown: (handler: ShutdownHandler) => void;

  /**
   * The service ID for this pod (set by the runtime when networking is enabled).
   * Used by HTTP interceptors for policy checking and routing.
   */
  serviceId?: string;

  /**
   * Pod authentication token for orchestrator registration.
   * Used to prevent pod spoofing by verifying the pod's identity.
   * @internal Set by the runtime, not intended for pack code use.
   */
  authToken?: string;

  /**
   * Pod refresh token for automatic token renewal.
   * @internal Set by the runtime, not intended for pack code use.
   */
  refreshToken?: string;

  /**
   * Pod token expiration timestamp (ISO 8601).
   * @internal Set by the runtime, not intended for pack code use.
   */
  tokenExpiresAt?: string;

  /**
   * Ephemeral data plane instance for transient pod-to-pod communication.
   * Only available when `metadata.enableEphemeral` is `true` on the pack.
   *
   * Provides group membership, fan-out queries, and presence tracking
   * without requiring persistent state or external dependencies.
   *
   * @example
   * ```typescript
   * if (context.ephemeral) {
   *   context.ephemeral.joinGroup('room:lobby');
   *   const members = context.ephemeral.getGroupPods('room:lobby');
   *   const result = await context.ephemeral.queryPods(members, '/ping');
   * }
   * ```
   */
  ephemeral?: EphemeralDataPlane;

  /**
   * Browser-only: register inbound request handlers.
   *
   * In Node.js, use standard HTTP servers (Express, Fastify, Koa, etc.) —
   * Stark intercepts `http.createServer` automatically and routes WebRTC
   * requests to the pack's server. No explicit handler registration needed.
   *
   * In the browser (Web Workers), there is no `http.createServer`, so packs
   * must use `context.listen` to register handlers explicitly.
   *
   * @example
   * ```typescript
   * // Browser pack:
   * context.listen.handle('/greet', async (method, path, body) => {
   *   return { status: 200, body: { message: 'Hello!' } };
   * });
   *
   * context.listen.handle('/echo', async (method, path, body) => {
   *   return { status: 200, body: { echo: body } };
   * });
   *
   * context.listen.setDefault(async (method, path) => {
   *   return { status: 404, body: { error: `Not found: ${method} ${path}` } };
   * });
   * ```
   */
  listen?: {
    handle: (pathPrefix: string, handler: (
      method: string,
      path: string,
      body: unknown,
      headers?: Record<string, string>,
    ) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>) => void;
    setDefault: (handler: (
      method: string,
      path: string,
      body: unknown,
      headers?: Record<string, string>,
    ) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>) => void;
  };
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
  /** 
   * Gracefully stop the execution - invokes shutdown handlers, waits for graceful timeout,
   * then force terminates. Allows pack code to clean up before termination.
   */
  gracefulStop?: (reason?: string) => Promise<void>;
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
