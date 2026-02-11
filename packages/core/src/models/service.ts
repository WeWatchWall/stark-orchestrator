/**
 * Service reactive model
 * @module @stark-o/core/models/service
 */

import { reactive } from '@vue/reactivity';
import type {
  Service,
  ServiceStatus,
  CreateServiceInput,
  ServiceListItem,
  ResourceRequirements,
  Labels,
  Annotations,
  PodSchedulingConfig,
  Toleration,
} from '@stark-o/shared';
import {
  validateCreateServiceInput,
  isServiceActive,
  isServiceDaemonSet,
  isServiceReady,
  DEFAULT_SERVICE_RESOURCE_REQUESTS,
  DEFAULT_SERVICE_RESOURCE_LIMITS,
} from '@stark-o/shared';

/**
 * Service creation result
 */
export interface ServiceCreationResult {
  service: Service;
}

/**
 * Service list response with pagination
 */
export interface ServiceListResponse {
  services: Service[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Service list filters
 */
export interface ServiceListFilters {
  /** Filter by pack ID */
  packId?: string;
  /** Filter by namespace */
  namespace?: string;
  /** Filter by status */
  status?: ServiceStatus;
  /** Filter by label selector */
  labelSelector?: Record<string, string>;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

/**
 * Reactive Service model wrapper
 * Provides reactive access to service data with computed properties
 */
export class ServiceModel {
  private readonly _service: Service;

  constructor(service: Service) {
    this._service = reactive(service) as Service;
  }

  /**
   * Get the raw service data
   */
  get data(): Service {
    return this._service;
  }

  /**
   * Service ID
   */
  get id(): string {
    return this._service.id;
  }

  /**
   * Service name
   */
  get name(): string {
    return this._service.name;
  }

  /**
   * Pack ID
   */
  get packId(): string {
    return this._service.packId;
  }

  /**
   * Pack version
   */
  get packVersion(): string {
    return this._service.packVersion;
  }

  /**
   * Namespace
   */
  get namespace(): string {
    return this._service.namespace;
  }

  /**
   * Desired replicas (0 = DaemonSet mode)
   */
  get replicas(): number {
    return this._service.replicas;
  }

  /**
   * Current status
   */
  get status(): ServiceStatus {
    return this._service.status;
  }

  /**
   * Status message
   */
  get statusMessage(): string | undefined {
    return this._service.statusMessage;
  }

  /**
   * Labels
   */
  get labels(): Labels {
    return this._service.labels;
  }

  /**
   * Annotations
   */
  get annotations(): Annotations {
    return this._service.annotations;
  }

  /**
   * Pod labels (applied to created pods)
   */
  get podLabels(): Labels {
    return this._service.podLabels;
  }

  /**
   * Pod annotations (applied to created pods)
   */
  get podAnnotations(): Annotations {
    return this._service.podAnnotations;
  }

  /**
   * Priority class name
   */
  get priorityClassName(): string | undefined {
    return this._service.priorityClassName;
  }

  /**
   * Priority value
   */
  get priority(): number {
    return this._service.priority;
  }

  /**
   * Tolerations
   */
  get tolerations(): Toleration[] {
    return this._service.tolerations;
  }

  /**
   * Resource requests
   */
  get resourceRequests(): ResourceRequirements {
    return this._service.resourceRequests;
  }

  /**
   * Resource limits
   */
  get resourceLimits(): ResourceRequirements {
    return this._service.resourceLimits;
  }

  /**
   * Scheduling configuration
   */
  get scheduling(): PodSchedulingConfig | undefined {
    return this._service.scheduling;
  }

  /**
   * Observed generation
   */
  get observedGeneration(): number {
    return this._service.observedGeneration;
  }

  /**
   * Ready replicas count
   */
  get readyReplicas(): number {
    return this._service.readyReplicas;
  }

  /**
   * Available replicas count
   */
  get availableReplicas(): number {
    return this._service.availableReplicas;
  }

  /**
   * Updated replicas count
   */
  get updatedReplicas(): number {
    return this._service.updatedReplicas;
  }

  /**
   * Creator user ID
   */
  get createdBy(): string {
    return this._service.createdBy;
  }

  /**
   * Creation timestamp
   */
  get createdAt(): Date {
    return this._service.createdAt;
  }

  /**
   * Last update timestamp
   */
  get updatedAt(): Date {
    return this._service.updatedAt;
  }

  /**
   * Check if service is active
   */
  get isActive(): boolean {
    return isServiceActive(this._service);
  }

  /**
   * Check if service is a DaemonSet (replicas = 0)
   */
  get isDaemonSet(): boolean {
    return isServiceDaemonSet(this._service);
  }

  /**
   * Check if service has reached desired state
   */
  get isReady(): boolean {
    return isServiceReady(this._service);
  }

  /**
   * Update service status
   */
  updateStatus(status: ServiceStatus, message?: string): void {
    this._service.status = status;
    this._service.statusMessage = message;
    this._service.updatedAt = new Date();
  }

  /**
   * Update replica counts
   */
  updateReplicaCounts(ready: number, available: number, updated: number): void {
    this._service.readyReplicas = ready;
    this._service.availableReplicas = available;
    this._service.updatedReplicas = updated;
    this._service.updatedAt = new Date();
  }

  /**
   * Update replicas
   */
  setReplicas(replicas: number): void {
    this._service.replicas = replicas;
    this._service.updatedAt = new Date();
  }

  /**
   * Update pack version (for rollouts)
   */
  setPackVersion(version: string): void {
    this._service.packVersion = version;
    this._service.updatedAt = new Date();
  }

  /**
   * Pause service
   */
  pause(): void {
    this._service.status = 'paused';
    this._service.updatedAt = new Date();
  }

  /**
   * Resume service
   */
  resume(): void {
    this._service.status = 'active';
    this._service.updatedAt = new Date();
  }

  /**
   * Convert to list item format
   */
  toListItem(): ServiceListItem {
    return {
      id: this._service.id,
      name: this._service.name,
      packId: this._service.packId,
      packVersion: this._service.packVersion,
      followLatest: this._service.followLatest,
      namespace: this._service.namespace,
      replicas: this._service.replicas,
      readyReplicas: this._service.readyReplicas,
      availableReplicas: this._service.availableReplicas,
      status: this._service.status,
      createdAt: this._service.createdAt,
      updatedAt: this._service.updatedAt,
    };
  }

  /**
   * Create from input
   */
  static fromInput(
    input: CreateServiceInput,
    packId: string,
    packVersion: string,
    createdBy: string
  ): ServiceModel {
    const validation = validateCreateServiceInput(input);
    if (!validation.valid) {
      throw new Error(`Invalid service input: ${validation.errors[0]?.message ?? 'Unknown error'}`);
    }

    const service: Service = {
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
        ...DEFAULT_SERVICE_RESOURCE_REQUESTS,
        ...input.resourceRequests,
      },
      resourceLimits: {
        ...DEFAULT_SERVICE_RESOURCE_LIMITS,
        ...input.resourceLimits,
      },
      scheduling: input.scheduling,
      observedGeneration: 0,
      readyReplicas: 0,
      availableReplicas: 0,
      updatedReplicas: 0,
      consecutiveFailures: 0,
      ingressPort: input.ingressPort,
      visibility: input.visibility ?? 'private',
      exposed: input.exposed ?? false,
      allowedSources: input.allowedSources ?? [],
      secrets: input.secrets ?? [],
      metadata: input.metadata ?? {},
      createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return new ServiceModel(service);
  }
}

/**
 * Create a reactive service list item
 */
export function createReactiveServiceListItem(item: ServiceListItem): ServiceListItem {
  return reactive(item) as ServiceListItem;
}
