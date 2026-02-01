/**
 * Pod reactive model
 * @module @stark-o/core/models/pod
 */

import { reactive, computed, type ComputedRef } from '@vue/reactivity';
import type {
  Pod,
  PodStatus,
  CreatePodInput,
  UpdatePodInput,
  PodHistoryEntry,
  PodAction,
  PodListItem,
  ResourceRequirements,
  Labels,
  Annotations,
  PodSchedulingConfig,
} from '@stark-o/shared';
import type { Toleration } from '@stark-o/shared';
import {
  validateCreatePodInput,
  DEFAULT_RESOURCE_REQUESTS,
  DEFAULT_RESOURCE_LIMITS,
  isPodActive,
  isPodRunning,
  isPodTerminated,
  isPodSchedulable,
} from '@stark-o/shared';

/**
 * Pod creation result
 */
export interface PodCreationResult {
  pod: Pod;
}

/**
 * Pod list response with pagination
 */
export interface PodListResponse {
  pods: Pod[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Pod list filters
 */
export interface PodListFilters {
  /** Filter by pack ID */
  packId?: string;
  /** Filter by node ID */
  nodeId?: string;
  /** Filter by namespace */
  namespace?: string;
  /** Filter by status */
  status?: PodStatus;
  /** Filter by label selector */
  labelSelector?: Record<string, string>;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

/**
 * Reactive Pod model wrapper
 * Provides reactive access to pod data with computed properties
 */
export class PodModel {
  private readonly _pod: Pod;
  private readonly _history: PodHistoryEntry[];

  constructor(pod: Pod, history: PodHistoryEntry[] = []) {
    this._pod = reactive(pod) as Pod;
    this._history = reactive(history);
  }

  /**
   * Get the raw pod data
   */
  get data(): Pod {
    return this._pod;
  }

  /**
   * Pod ID
   */
  get id(): string {
    return this._pod.id;
  }

  /**
   * Pack ID
   */
  get packId(): string {
    return this._pod.packId;
  }

  /**
   * Pack version
   */
  get packVersion(): string {
    return this._pod.packVersion;
  }

  /**
   * Node ID (null if not scheduled)
   */
  get nodeId(): string | null {
    return this._pod.nodeId;
  }

  /**
   * Current status
   */
  get status(): PodStatus {
    return this._pod.status;
  }

  /**
   * Status message
   */
  get statusMessage(): string | undefined {
    return this._pod.statusMessage;
  }

  /**
   * Namespace
   */
  get namespace(): string {
    return this._pod.namespace;
  }

  /**
   * Labels
   */
  get labels(): Labels {
    return this._pod.labels;
  }

  /**
   * Annotations
   */
  get annotations(): Annotations {
    return this._pod.annotations;
  }

  /**
   * Priority
   */
  get priority(): number {
    return this._pod.priority;
  }

  /**
   * Priority class name
   */
  get priorityClassName(): string | undefined {
    return this._pod.priorityClassName;
  }

  /**
   * Tolerations
   */
  get tolerations(): Toleration[] {
    return this._pod.tolerations;
  }

  /**
   * Resource requests
   */
  get resourceRequests(): ResourceRequirements {
    return this._pod.resourceRequests;
  }

  /**
   * Resource limits
   */
  get resourceLimits(): ResourceRequirements {
    return this._pod.resourceLimits;
  }

  /**
   * Scheduling configuration
   */
  get scheduling(): PodSchedulingConfig | undefined {
    return this._pod.scheduling;
  }

  /**
   * Creator user ID
   */
  get createdBy(): string {
    return this._pod.createdBy;
  }

  /**
   * Creation timestamp
   */
  get createdAt(): Date {
    return this._pod.createdAt;
  }

  /**
   * Last update timestamp
   */
  get updatedAt(): Date {
    return this._pod.updatedAt;
  }

  /**
   * Started at timestamp
   */
  get startedAt(): Date | undefined {
    return this._pod.startedAt;
  }

  /**
   * Stopped at timestamp
   */
  get stoppedAt(): Date | undefined {
    return this._pod.stoppedAt;
  }

  /**
   * Scheduled at timestamp
   */
  get scheduledAt(): Date | undefined {
    return this._pod.scheduledAt;
  }

  /**
   * Pod history
   */
  get history(): PodHistoryEntry[] {
    return this._history;
  }

  /**
   * Check if pod is active
   */
  get isActive(): boolean {
    return isPodActive(this._pod);
  }

  /**
   * Check if pod is running
   */
  get isRunning(): boolean {
    return isPodRunning(this._pod);
  }

  /**
   * Check if pod is terminated
   */
  get isTerminated(): boolean {
    return isPodTerminated(this._pod);
  }

  /**
   * Check if pod can be scheduled
   */
  get isSchedulable(): boolean {
    return isPodSchedulable(this._pod);
  }

  /**
   * Update pod status
   */
  updateStatus(status: PodStatus, message?: string, actorId?: string): void {
    const previousStatus = this._pod.status;
    this._pod.status = status;
    this._pod.statusMessage = message;
    this._pod.updatedAt = new Date();

    // Update timestamps based on status
    if (status === 'scheduled' && !this._pod.scheduledAt) {
      this._pod.scheduledAt = new Date();
    }
    if (status === 'running' && !this._pod.startedAt) {
      this._pod.startedAt = new Date();
    }
    if (['stopped', 'failed', 'evicted'].includes(status) && !this._pod.stoppedAt) {
      this._pod.stoppedAt = new Date();
    }

    // Record in history
    this.addHistoryEntry(
      statusToAction(status),
      actorId,
      previousStatus,
      status
    );
  }

  /**
   * Assign to a node
   */
  assignToNode(nodeId: string, actorId?: string): void {
    const previousNodeId = this._pod.nodeId ?? undefined;
    this._pod.nodeId = nodeId;
    this._pod.status = 'scheduled';
    this._pod.scheduledAt = new Date();
    this._pod.updatedAt = new Date();

    this.addHistoryEntry(
      'scheduled',
      actorId,
      this._pod.status,
      'scheduled',
      undefined,
      undefined,
      previousNodeId,
      nodeId
    );
  }

  /**
   * Update pod metadata
   */
  update(updates: UpdatePodInput): void {
    if (updates.status !== undefined) {
      this._pod.status = updates.status;
    }
    if (updates.statusMessage !== undefined) {
      this._pod.statusMessage = updates.statusMessage;
    }
    if (updates.nodeId !== undefined) {
      this._pod.nodeId = updates.nodeId;
    }
    if (updates.labels !== undefined) {
      this._pod.labels = updates.labels;
    }
    if (updates.annotations !== undefined) {
      this._pod.annotations = updates.annotations;
    }
    this._pod.updatedAt = new Date();
  }

  /**
   * Add history entry
   */
  addHistoryEntry(
    action: PodAction,
    actorId?: string,
    previousStatus?: PodStatus,
    newStatus?: PodStatus,
    previousVersion?: string,
    newVersion?: string,
    previousNodeId?: string,
    newNodeId?: string,
    reason?: string,
    message?: string
  ): PodHistoryEntry {
    const entry: PodHistoryEntry = {
      id: crypto.randomUUID(),
      podId: this._pod.id,
      action,
      actorId,
      previousStatus,
      newStatus,
      previousVersion,
      newVersion,
      previousNodeId,
      newNodeId,
      reason,
      message,
      metadata: {},
      timestamp: new Date(),
    };
    this._history.push(entry);
    return entry;
  }

  /**
   * Convert to list item
   */
  toListItem(): PodListItem {
    return {
      id: this._pod.id,
      packId: this._pod.packId,
      packVersion: this._pod.packVersion,
      nodeId: this._pod.nodeId,
      status: this._pod.status,
      namespace: this._pod.namespace,
      labels: this._pod.labels,
      priority: this._pod.priority,
      createdBy: this._pod.createdBy,
      createdAt: this._pod.createdAt,
      startedAt: this._pod.startedAt,
    };
  }

  /**
   * Create a new Pod from input
   */
  static create(
    input: CreatePodInput,
    packVersion: string,
    createdBy: string,
    priority: number = 0,
    id?: string
  ): PodModel {
    const now = new Date();
    const pod: Pod = {
      id: id ?? crypto.randomUUID(),
      packId: input.packId,
      packVersion: input.packVersion ?? packVersion,
      nodeId: null,
      status: 'pending',
      statusMessage: undefined,
      namespace: input.namespace ?? 'default',
      labels: input.labels ?? {},
      annotations: input.annotations ?? {},
      priorityClassName: input.priorityClassName,
      priority,
      tolerations: input.tolerations ?? [],
      resourceRequests: {
        ...DEFAULT_RESOURCE_REQUESTS,
        ...input.resourceRequests,
      },
      resourceLimits: {
        ...DEFAULT_RESOURCE_LIMITS,
        ...input.resourceLimits,
      },
      scheduling: input.scheduling,
      createdBy,
      scheduledAt: undefined,
      startedAt: undefined,
      stoppedAt: undefined,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };

    const model = new PodModel(pod);
    
    // Record creation in history
    model.addHistoryEntry('created', createdBy, undefined, 'pending');

    return model;
  }

  /**
   * Validate pod creation input
   */
  static validate(input: unknown): { valid: boolean; errors: Array<{ field: string; message: string; code: string }> } {
    return validateCreatePodInput(input as CreatePodInput);
  }
}

/**
 * Map pod status to history action
 */
function statusToAction(status: PodStatus): PodAction {
  switch (status) {
    case 'pending':
      return 'created';
    case 'scheduled':
      return 'scheduled';
    case 'starting':
    case 'running':
      return 'started';
    case 'stopping':
    case 'stopped':
      return 'stopped';
    case 'failed':
      return 'failed';
    case 'evicted':
      return 'evicted';
    default:
      return 'updated';
  }
}

/**
 * Create a reactive computed pod list item
 */
export function createReactivePodListItem(pod: Pod): ComputedRef<PodListItem> {
  const reactivePod = reactive(pod);
  return computed(() => ({
    id: reactivePod.id,
    packId: reactivePod.packId,
    packVersion: reactivePod.packVersion,
    nodeId: reactivePod.nodeId,
    status: reactivePod.status,
    namespace: reactivePod.namespace,
    labels: reactivePod.labels,
    priority: reactivePod.priority,
    createdBy: reactivePod.createdBy,
    createdAt: reactivePod.createdAt,
    startedAt: reactivePod.startedAt,
  }));
}
