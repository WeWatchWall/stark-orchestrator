/**
 * Deployment type definitions
 * @module @stark-o/shared/types/deployment
 */

import type { Labels, Annotations } from './labels';
import type { Toleration } from './taints';
import type { PodSchedulingConfig, ResourceRequirements } from './pod';

/**
 * Deployment status values
 */
export type DeploymentStatus =
  | 'active'    // Actively reconciling pods
  | 'paused'    // Reconciliation paused
  | 'scaling'   // Currently scaling up/down
  | 'deleting'; // Being deleted

/**
 * Deployment entity - persistent pod scheduling configuration
 * 
 * A Deployment maintains a desired number of pod replicas:
 * - replicas = 0: Deploy to ALL matching nodes (DaemonSet-like behavior)
 * - replicas > 0: Maintain exactly N pods across eligible nodes
 * 
 * @example
 * // Deploy to all production nodes
 * {
 *   name: "log-collector",
 *   packId: "...",
 *   replicas: 0,
 *   scheduling: { nodeSelector: { env: "production" } }
 * }
 * 
 * // Maintain 3 replicas
 * {
 *   name: "web-frontend",
 *   packId: "...",
 *   replicas: 3
 * }
 */
export interface Deployment {
  /** Unique identifier (UUID) */
  id: string;
  /** Deployment name (unique within namespace) */
  name: string;
  /** Pack ID to deploy */
  packId: string;
  /** Pack version to deploy */
  packVersion: string;
  /** 
   * Whether to automatically update to the latest pack version.
   * When true, pods are updated when new pack versions are registered.
   */
  followLatest: boolean;
  /** Namespace */
  namespace: string;
  /** 
   * Number of desired replicas:
   * - 0 = deploy to all matching nodes (DaemonSet-like)
   * - >0 = maintain exactly N pods
   */
  replicas: number;
  /** Current status */
  status: DeploymentStatus;
  /** Status message */
  statusMessage?: string;
  /** Labels on the deployment itself */
  labels: Labels;
  /** Annotations on the deployment itself */
  annotations: Annotations;
  /** Labels applied to created pods */
  podLabels: Labels;
  /** Annotations applied to created pods */
  podAnnotations: Annotations;
  /** Priority class name for pods */
  priorityClassName?: string;
  /** Priority value for pods */
  priority: number;
  /** Tolerations for pods */
  tolerations: Toleration[];
  /** Resource requests for pods */
  resourceRequests: ResourceRequirements;
  /** Resource limits for pods */
  resourceLimits: ResourceRequirements;
  /** Scheduling configuration for pods */
  scheduling?: PodSchedulingConfig;
  /** Observed generation (for reconciliation) */
  observedGeneration: number;
  /** Number of ready replicas */
  readyReplicas: number;
  /** Number of available replicas */
  availableReplicas: number;
  /** Number of updated replicas */
  updatedReplicas: number;
  /** 
   * Last pack version that ran successfully.
   * Used for auto-rollback when new versions fail.
   */
  lastSuccessfulVersion?: string;
  /**
   * Pack version that failed during upgrade.
   * Prevents retry loops by skipping this version.
   */
  failedVersion?: string;
  /**
   * Count of consecutive pod failures since last success.
   * Used for crash-loop detection.
   */
  consecutiveFailures: number;
  /**
   * Timestamp until which upgrade retries should be skipped.
   * Implements exponential backoff for failed upgrades.
   */
  failureBackoffUntil?: Date;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** User who created the deployment */
  createdBy: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Deployment creation input
 */
export interface CreateDeploymentInput {
  /** Deployment name */
  name: string;
  /** Pack ID or pack name */
  packId?: string;
  /** Pack name (alternative to packId) */
  packName?: string;
  /** Pack version (defaults to latest) */
  packVersion?: string;
  /** 
   * Whether to automatically update to the latest pack version.
   * When true, pods are updated when new pack versions are registered.
   * @default false
   */
  followLatest?: boolean;
  /** Target namespace */
  namespace?: string;
  /** 
   * Number of replicas:
   * - 0 = deploy to all matching nodes
   * - >0 = maintain exactly N pods
   * @default 1
   */
  replicas?: number;
  /** Labels on the deployment */
  labels?: Labels;
  /** Annotations on the deployment */
  annotations?: Annotations;
  /** Labels applied to created pods */
  podLabels?: Labels;
  /** Annotations applied to created pods */
  podAnnotations?: Annotations;
  /** Priority class name */
  priorityClassName?: string;
  /** Tolerations for pods */
  tolerations?: Toleration[];
  /** Resource requests for pods */
  resourceRequests?: Partial<ResourceRequirements>;
  /** Resource limits for pods */
  resourceLimits?: Partial<ResourceRequirements>;
  /** Scheduling configuration */
  scheduling?: PodSchedulingConfig;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Deployment update input
 */
export interface UpdateDeploymentInput {
  /** New pack version */
  packVersion?: string;
  /** Enable or disable follow latest */
  followLatest?: boolean;
  /** New replica count */
  replicas?: number;
  /** New status */
  status?: DeploymentStatus;
  /** Status message */
  statusMessage?: string;
  /** Labels update */
  labels?: Labels;
  /** Annotations update */
  annotations?: Annotations;
  /** Pod labels update */
  podLabels?: Labels;
  /** Pod annotations update */
  podAnnotations?: Annotations;
  /** Priority class name update */
  priorityClassName?: string;
  /** Tolerations update */
  tolerations?: Toleration[];
  /** Resource requests update */
  resourceRequests?: Partial<ResourceRequirements>;
  /** Resource limits update */
  resourceLimits?: Partial<ResourceRequirements>;
  /** Scheduling configuration update */
  scheduling?: PodSchedulingConfig;
  /** Metadata update */
  metadata?: Record<string, unknown>;
  /** Last successful version (for auto-rollback tracking) */
  lastSuccessfulVersion?: string | null;
  /** Failed version (to prevent retry loops) */
  failedVersion?: string | null;
  /** Consecutive failure count (for crash-loop detection) */
  consecutiveFailures?: number;
  /** Backoff timestamp (for exponential backoff) */
  failureBackoffUntil?: Date | null;
}

/**
 * Deployment list item (summary)
 */
export interface DeploymentListItem {
  id: string;
  name: string;
  packId: string;
  packVersion: string;
  followLatest: boolean;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  status: DeploymentStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Check if deployment is active
 */
export function isDeploymentActive(deployment: Deployment): boolean {
  return deployment.status === 'active';
}

/**
 * Check if deployment is a DaemonSet (replicas = 0)
 */
export function isDeploymentDaemonSet(deployment: Deployment): boolean {
  return deployment.replicas === 0;
}

/**
 * Check if deployment has reached desired state
 */
export function isDeploymentReady(deployment: Deployment): boolean {
  if (deployment.replicas === 0) {
    // DaemonSet: check if availableReplicas > 0
    return deployment.availableReplicas > 0 && deployment.status === 'active';
  }
  // Regular deployment: check if readyReplicas matches desired
  return deployment.readyReplicas >= deployment.replicas && deployment.status === 'active';
}

/**
 * Default resource requests for deployment pods
 */
export const DEFAULT_DEPLOYMENT_RESOURCE_REQUESTS: ResourceRequirements = {
  cpu: 100,
  memory: 128,
};

/**
 * Default resource limits for deployment pods
 */
export const DEFAULT_DEPLOYMENT_RESOURCE_LIMITS: ResourceRequirements = {
  cpu: 500,
  memory: 512,
};
