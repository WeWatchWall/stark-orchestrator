/**
 * Pod and PodHistory type definitions
 * @module @stark-o/shared/types/pod
 */

import type { Labels, Annotations } from './labels';
import type { Toleration } from './taints';
import type { NodeAffinity, PodAffinity, PodAntiAffinity } from './scheduling';
import type { Capability } from './capabilities.js';

/**
 * Pod status values
 */
export type PodStatus =
  | 'pending'    // Waiting for scheduling
  | 'scheduled'  // Assigned to node, not yet running
  | 'starting'   // Node is starting the pack
  | 'running'    // Pack is executing
  | 'stopping'   // Graceful shutdown in progress
  | 'stopped'    // Normally terminated
  | 'failed'     // Terminated with error
  | 'evicted'    // Removed due to resource pressure or preemption
  | 'unknown';   // Lost contact with node

/**
 * Canonical termination reason for pods
 * Used for crash loop detection and observability
 */
export type PodTerminationReason =
  // Infrastructure reasons (should NOT trigger crash loop)
  | 'node_lost'           // Node disconnected or went offline
  | 'node_restart'        // Node agent restarted - pod processes lost
  | 'node_unhealthy'      // Node failed health checks
  | 'node_draining'       // Node is being drained for maintenance
  | 'node_maintenance'    // Node entered maintenance mode
  // Resource reasons
  | 'oom_killed'          // Out of memory
  | 'evicted_resources'   // Evicted due to resource pressure
  | 'preempted'           // Preempted by higher priority pod
  | 'quota_exceeded'      // Resource quota exceeded
  // Application reasons (SHOULD trigger crash loop if repeated)
  | 'error'               // Generic application error/crash
  | 'init_error'          // Failed during initialization
  | 'config_error'        // Configuration error
  | 'pack_load_error'     // Failed to load pack/bundle
  // Operator/user initiated (should NOT trigger crash loop)
  | 'user_stopped'        // Manual stop by user/operator
  | 'rolling_update'      // Replaced during rolling update
  | 'scaled_down'         // Removed due to scale down
  | 'deployment_deleted'  // Parent deployment was deleted
  // Lifecycle reasons
  | 'completed'           // Normal completion (for job-like pods)
  | 'deadline_exceeded'   // Execution deadline exceeded
  // Unknown
  | 'unknown';            // Reason not determined

/**
 * Termination reasons that indicate infrastructure issues (not application bugs)
 * These should NOT count toward crash loop detection
 */
export const INFRASTRUCTURE_TERMINATION_REASONS: readonly PodTerminationReason[] = [
  'node_lost',
  'node_restart',
  'node_unhealthy',
  'node_draining',
  'node_maintenance',
  'evicted_resources',
  'preempted',
] as const;

/**
 * Termination reasons initiated by operators/users
 * These should NOT count toward crash loop detection
 */
export const OPERATOR_TERMINATION_REASONS: readonly PodTerminationReason[] = [
  'user_stopped',
  'rolling_update',
  'scaled_down',
  'deployment_deleted',
] as const;

/**
 * Termination reasons that indicate application errors
 * These SHOULD count toward crash loop detection
 */
export const APPLICATION_TERMINATION_REASONS: readonly PodTerminationReason[] = [
  'error',
  'init_error',
  'config_error',
  'pack_load_error',
  'oom_killed',
  'deadline_exceeded',
] as const;

/**
 * Check if a termination reason should count toward crash loop detection
 */
export function shouldCountTowardCrashLoop(reason: PodTerminationReason | undefined): boolean {
  if (!reason) return true; // Assume application error if no reason provided
  return APPLICATION_TERMINATION_REASONS.includes(reason as typeof APPLICATION_TERMINATION_REASONS[number]);
}

/**
 * All available termination reasons
 */
export const ALL_TERMINATION_REASONS: readonly PodTerminationReason[] = [
  'node_lost', 'node_restart', 'node_unhealthy', 'node_draining', 'node_maintenance',
  'oom_killed', 'evicted_resources', 'preempted', 'quota_exceeded',
  'error', 'init_error', 'config_error', 'pack_load_error',
  'user_stopped', 'rolling_update', 'scaled_down', 'deployment_deleted',
  'completed', 'deadline_exceeded', 'unknown',
] as const;

/**
 * Resource requests/limits
 */
export interface ResourceRequirements {
  /** CPU in millicores */
  cpu: number;
  /** Memory in MB */
  memory: number;
}

/**
 * Pod scheduling configuration
 */
export interface PodSchedulingConfig {
  /** Simple label-based node selection */
  nodeSelector?: Record<string, string>;
  /** Advanced node selection rules */
  nodeAffinity?: NodeAffinity;
  /** Co-location rules */
  podAffinity?: PodAffinity;
  /** Anti co-location rules */
  podAntiAffinity?: PodAntiAffinity;
}

/**
 * Pod entity - a pack deployment to a node
 */
export interface Pod {
  /** Unique identifier (UUID) */
  id: string;
  /** Pack ID */
  packId: string;
  /** Pack version */
  packVersion: string;
  /** Assigned node ID (null if pending) */
  nodeId: string | null;
  /** Current status */
  status: PodStatus;
  /** Status message (for errors) */
  statusMessage?: string;
  /** Canonical termination reason (for stopped/failed/evicted pods) */
  terminationReason?: PodTerminationReason;
  /** Namespace */
  namespace: string;
  /** Labels for organization and selection */
  labels: Labels;
  /** Annotations for metadata */
  annotations: Annotations;
  /** Priority class name */
  priorityClassName?: string;
  /** Priority value (cached) */
  priority: number;
  /** Tolerations for tainted nodes */
  tolerations: Toleration[];
  /** Resource requests */
  resourceRequests: ResourceRequirements;
  /** Resource limits */
  resourceLimits: ResourceRequirements;
  /** Scheduling configuration */
  scheduling?: PodSchedulingConfig;
  /** User who created the pod */
  createdBy: string;
  /** When pod was scheduled */
  scheduledAt?: Date;
  /** When pod started running */
  startedAt?: Date;
  /** When pod stopped */
  stoppedAt?: Date;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /**
   * Capabilities granted to this pod (copied from pack at scheduling time).
   * 'root' capability means pod runs on main thread (not in worker).
   */
  grantedCapabilities: Capability[];
  /**
   * Monotonic incarnation ID. Incremented when scheduling replacements.
   * Used to reject late messages from old incarnations and prevent double-deploy.
   */
  incarnation: number;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Pod creation input
 */
export interface CreatePodInput {
  /** Pack ID */
  packId: string;
  /** Pack version (optional, defaults to latest) */
  packVersion?: string;
  /** Target namespace */
  namespace?: string;
  /** Labels */
  labels?: Labels;
  /** Annotations */
  annotations?: Annotations;
  /** Priority class name */
  priorityClassName?: string;
  /** Tolerations */
  tolerations?: Toleration[];
  /** Resource requests */
  resourceRequests?: Partial<ResourceRequirements>;
  /** Resource limits */
  resourceLimits?: Partial<ResourceRequirements>;
  /** Scheduling configuration */
  scheduling?: PodSchedulingConfig;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Pod update input
 */
export interface UpdatePodInput {
  status?: PodStatus;
  statusMessage?: string;
  terminationReason?: PodTerminationReason;
  nodeId?: string | null;
  labels?: Labels;
  annotations?: Annotations;
}

/**
 * Pod action for history tracking
 */
export type PodAction =
  | 'created'
  | 'scheduled'
  | 'started'
  | 'stopped'
  | 'failed'
  | 'restarted'
  | 'rolled_back'
  | 'evicted'
  | 'scaled'
  | 'updated'
  | 'deleted';

/**
 * Pod history entry
 */
export interface PodHistoryEntry {
  /** Unique identifier */
  id: string;
  /** Pod ID */
  podId: string;
  /** Action that occurred */
  action: PodAction;
  /** User who performed the action */
  actorId?: string;
  /** Previous status */
  previousStatus?: PodStatus;
  /** New status */
  newStatus?: PodStatus;
  /** Previous version */
  previousVersion?: string;
  /** New version */
  newVersion?: string;
  /** Previous node ID */
  previousNodeId?: string;
  /** New node ID */
  newNodeId?: string;
  /** Reason code */
  reason?: string;
  /** Human-readable message */
  message?: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Pod list item (for search/listing)
 */
export interface PodListItem {
  id: string;
  packId: string;
  packVersion: string;
  nodeId: string | null;
  status: PodStatus;
  statusMessage?: string;
  terminationReason?: PodTerminationReason;
  namespace: string;
  labels: Labels;
  priority: number;
  incarnation: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
}

/**
 * Check if a pod is active (not terminated)
 */
export function isPodActive(pod: Pod): boolean {
  return ['pending', 'scheduled', 'starting', 'running', 'stopping'].includes(pod.status);
}

/**
 * Check if a pod is running
 */
export function isPodRunning(pod: Pod): boolean {
  return pod.status === 'running';
}

/**
 * Check if a pod has terminated
 */
export function isPodTerminated(pod: Pod): boolean {
  return ['stopped', 'failed', 'evicted'].includes(pod.status);
}

/**
 * Check if a pod can be scheduled
 */
export function isPodSchedulable(pod: Pod): boolean {
  return pod.status === 'pending';
}

/**
 * All available pod statuses
 */
export const ALL_POD_STATUSES: readonly PodStatus[] = [
  'pending',
  'scheduled',
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
  'evicted',
  'unknown',
] as const;

/**
 * All available pod actions
 */
export const ALL_POD_ACTIONS: readonly PodAction[] = [
  'created',
  'scheduled',
  'started',
  'stopped',
  'failed',
  'restarted',
  'rolled_back',
  'evicted',
  'scaled',
  'updated',
  'deleted',
] as const;

/**
 * Default resource requests
 */
export const DEFAULT_RESOURCE_REQUESTS: ResourceRequirements = {
  cpu: 100,
  memory: 128,
};

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCE_LIMITS: ResourceRequirements = {
  cpu: 500,
  memory: 512,
};
