/**
 * Pod and PodHistory type definitions
 * @module @stark-o/shared/types/pod
 */

import type { Labels, Annotations } from './labels';
import type { Toleration } from './taints';
import type { NodeAffinity, PodAffinity, PodAntiAffinity } from './scheduling';

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
  namespace: string;
  labels: Labels;
  priority: number;
  createdBy: string;
  createdAt: Date;
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
