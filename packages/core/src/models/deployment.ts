/**
 * Deployment reactive model
 * @module @stark-o/core/models/deployment
 */

import { reactive } from '@vue/reactivity';
import type {
  Deployment,
  DeploymentStatus,
  CreateDeploymentInput,
  DeploymentListItem,
  ResourceRequirements,
  Labels,
  Annotations,
  PodSchedulingConfig,
  Toleration,
} from '@stark-o/shared';
import {
  validateCreateDeploymentInput,
  isDeploymentActive,
  isDeploymentDaemonSet,
  isDeploymentReady,
  DEFAULT_DEPLOYMENT_RESOURCE_REQUESTS,
  DEFAULT_DEPLOYMENT_RESOURCE_LIMITS,
} from '@stark-o/shared';

/**
 * Deployment creation result
 */
export interface DeploymentCreationResult {
  deployment: Deployment;
}

/**
 * Deployment list response with pagination
 */
export interface DeploymentListResponse {
  deployments: Deployment[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Deployment list filters
 */
export interface DeploymentListFilters {
  /** Filter by pack ID */
  packId?: string;
  /** Filter by namespace */
  namespace?: string;
  /** Filter by status */
  status?: DeploymentStatus;
  /** Filter by label selector */
  labelSelector?: Record<string, string>;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

/**
 * Reactive Deployment model wrapper
 * Provides reactive access to deployment data with computed properties
 */
export class DeploymentModel {
  private readonly _deployment: Deployment;

  constructor(deployment: Deployment) {
    this._deployment = reactive(deployment) as Deployment;
  }

  /**
   * Get the raw deployment data
   */
  get data(): Deployment {
    return this._deployment;
  }

  /**
   * Deployment ID
   */
  get id(): string {
    return this._deployment.id;
  }

  /**
   * Deployment name
   */
  get name(): string {
    return this._deployment.name;
  }

  /**
   * Pack ID
   */
  get packId(): string {
    return this._deployment.packId;
  }

  /**
   * Pack version
   */
  get packVersion(): string {
    return this._deployment.packVersion;
  }

  /**
   * Namespace
   */
  get namespace(): string {
    return this._deployment.namespace;
  }

  /**
   * Desired replicas (0 = DaemonSet mode)
   */
  get replicas(): number {
    return this._deployment.replicas;
  }

  /**
   * Current status
   */
  get status(): DeploymentStatus {
    return this._deployment.status;
  }

  /**
   * Status message
   */
  get statusMessage(): string | undefined {
    return this._deployment.statusMessage;
  }

  /**
   * Labels
   */
  get labels(): Labels {
    return this._deployment.labels;
  }

  /**
   * Annotations
   */
  get annotations(): Annotations {
    return this._deployment.annotations;
  }

  /**
   * Pod labels (applied to created pods)
   */
  get podLabels(): Labels {
    return this._deployment.podLabels;
  }

  /**
   * Pod annotations (applied to created pods)
   */
  get podAnnotations(): Annotations {
    return this._deployment.podAnnotations;
  }

  /**
   * Priority class name
   */
  get priorityClassName(): string | undefined {
    return this._deployment.priorityClassName;
  }

  /**
   * Priority value
   */
  get priority(): number {
    return this._deployment.priority;
  }

  /**
   * Tolerations
   */
  get tolerations(): Toleration[] {
    return this._deployment.tolerations;
  }

  /**
   * Resource requests
   */
  get resourceRequests(): ResourceRequirements {
    return this._deployment.resourceRequests;
  }

  /**
   * Resource limits
   */
  get resourceLimits(): ResourceRequirements {
    return this._deployment.resourceLimits;
  }

  /**
   * Scheduling configuration
   */
  get scheduling(): PodSchedulingConfig | undefined {
    return this._deployment.scheduling;
  }

  /**
   * Observed generation
   */
  get observedGeneration(): number {
    return this._deployment.observedGeneration;
  }

  /**
   * Ready replicas count
   */
  get readyReplicas(): number {
    return this._deployment.readyReplicas;
  }

  /**
   * Available replicas count
   */
  get availableReplicas(): number {
    return this._deployment.availableReplicas;
  }

  /**
   * Updated replicas count
   */
  get updatedReplicas(): number {
    return this._deployment.updatedReplicas;
  }

  /**
   * Creator user ID
   */
  get createdBy(): string {
    return this._deployment.createdBy;
  }

  /**
   * Creation timestamp
   */
  get createdAt(): Date {
    return this._deployment.createdAt;
  }

  /**
   * Last update timestamp
   */
  get updatedAt(): Date {
    return this._deployment.updatedAt;
  }

  /**
   * Check if deployment is active
   */
  get isActive(): boolean {
    return isDeploymentActive(this._deployment);
  }

  /**
   * Check if deployment is a DaemonSet (replicas = 0)
   */
  get isDaemonSet(): boolean {
    return isDeploymentDaemonSet(this._deployment);
  }

  /**
   * Check if deployment has reached desired state
   */
  get isReady(): boolean {
    return isDeploymentReady(this._deployment);
  }

  /**
   * Update deployment status
   */
  updateStatus(status: DeploymentStatus, message?: string): void {
    this._deployment.status = status;
    this._deployment.statusMessage = message;
    this._deployment.updatedAt = new Date();
  }

  /**
   * Update replica counts
   */
  updateReplicaCounts(ready: number, available: number, updated: number): void {
    this._deployment.readyReplicas = ready;
    this._deployment.availableReplicas = available;
    this._deployment.updatedReplicas = updated;
    this._deployment.updatedAt = new Date();
  }

  /**
   * Update replicas
   */
  setReplicas(replicas: number): void {
    this._deployment.replicas = replicas;
    this._deployment.updatedAt = new Date();
  }

  /**
   * Update pack version (for rollouts)
   */
  setPackVersion(version: string): void {
    this._deployment.packVersion = version;
    this._deployment.updatedAt = new Date();
  }

  /**
   * Pause deployment
   */
  pause(): void {
    this._deployment.status = 'paused';
    this._deployment.updatedAt = new Date();
  }

  /**
   * Resume deployment
   */
  resume(): void {
    this._deployment.status = 'active';
    this._deployment.updatedAt = new Date();
  }

  /**
   * Convert to list item format
   */
  toListItem(): DeploymentListItem {
    return {
      id: this._deployment.id,
      name: this._deployment.name,
      packId: this._deployment.packId,
      packVersion: this._deployment.packVersion,
      followLatest: this._deployment.followLatest,
      namespace: this._deployment.namespace,
      replicas: this._deployment.replicas,
      readyReplicas: this._deployment.readyReplicas,
      availableReplicas: this._deployment.availableReplicas,
      status: this._deployment.status,
      createdAt: this._deployment.createdAt,
      updatedAt: this._deployment.updatedAt,
    };
  }

  /**
   * Create from input
   */
  static fromInput(
    input: CreateDeploymentInput,
    packId: string,
    packVersion: string,
    createdBy: string
  ): DeploymentModel {
    const validation = validateCreateDeploymentInput(input);
    if (!validation.valid) {
      throw new Error(`Invalid deployment input: ${validation.errors[0]?.message ?? 'Unknown error'}`);
    }

    const deployment: Deployment = {
      id: '', // Will be set by database
      name: input.name,
      packId,
      packVersion,
      followLatest: input.followLatest ?? false,
      namespace: input.namespace ?? 'default',
      replicas: input.replicas ?? 1, // Default to 1 replica
      status: 'active',
      statusMessage: undefined,
      labels: input.labels ?? {},
      annotations: input.annotations ?? {},
      podLabels: input.podLabels ?? {},
      podAnnotations: input.podAnnotations ?? {},
      priorityClassName: input.priorityClassName,
      priority: 100, // Will be resolved from priorityClassName
      tolerations: input.tolerations ?? [],
      resourceRequests: {
        ...DEFAULT_DEPLOYMENT_RESOURCE_REQUESTS,
        ...input.resourceRequests,
      },
      resourceLimits: {
        ...DEFAULT_DEPLOYMENT_RESOURCE_LIMITS,
        ...input.resourceLimits,
      },
      scheduling: input.scheduling,
      observedGeneration: 0,
      readyReplicas: 0,
      availableReplicas: 0,
      updatedReplicas: 0,
      consecutiveFailures: 0,
      metadata: input.metadata ?? {},
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return new DeploymentModel(deployment);
  }
}

/**
 * Create a reactive deployment list item
 */
export function createReactiveDeploymentListItem(item: DeploymentListItem): DeploymentListItem {
  return reactive(item) as DeploymentListItem;
}
