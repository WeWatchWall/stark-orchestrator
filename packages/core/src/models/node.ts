/**
 * Node reactive model with status and capabilities
 * @module @stark-o/core/models/node
 */

import { reactive, computed, type ComputedRef } from '@vue/reactivity';
import type {
  Node,
  NodeStatus,
  RuntimeType,
  RegisterNodeInput,
  UpdateNodeInput,
  NodeHeartbeat,
  NodeCapabilities,
  AllocatableResources,
  NodeListItem,
  Labels,
  Annotations,
} from '@stark-o/shared';
import type { Taint } from '@stark-o/shared';
import {
  validateRegisterNodeInput,
  isNodeSchedulable,
  getAvailableResources,
  hasAvailableResources,
  DEFAULT_ALLOCATABLE,
  DEFAULT_ALLOCATED,
} from '@stark-o/shared';

/**
 * Node registration result
 */
export interface NodeRegistrationResult {
  node: Node;
}

/**
 * Node list response with pagination
 */
export interface NodeListResponse {
  nodes: Node[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Node list filters
 */
export interface NodeListFilters {
  /** Filter by runtime type */
  runtimeType?: RuntimeType;
  /** Filter by status */
  status?: NodeStatus;
  /** Filter by label selector */
  labelSelector?: Record<string, string>;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

/**
 * Heartbeat timeout in milliseconds (30 seconds)
 */
export const HEARTBEAT_TIMEOUT_MS = 30_000;

/**
 * Reactive Node model wrapper
 * Provides reactive access to node data with computed properties
 */
export class NodeModel {
  private readonly _node: Node;

  constructor(node: Node) {
    this._node = reactive(node) as Node;
  }

  /**
   * Get the raw node data
   */
  get data(): Node {
    return this._node;
  }

  /**
   * Node ID
   */
  get id(): string {
    return this._node.id;
  }

  /**
   * Node name
   */
  get name(): string {
    return this._node.name;
  }

  /**
   * Runtime type
   */
  get runtimeType(): RuntimeType {
    return this._node.runtimeType;
  }

  /**
   * Current status
   */
  get status(): NodeStatus {
    return this._node.status;
  }

  /**
   * Last heartbeat timestamp
   */
  get lastHeartbeat(): Date | undefined {
    return this._node.lastHeartbeat;
  }

  /**
   * Node capabilities
   */
  get capabilities(): NodeCapabilities {
    return this._node.capabilities;
  }

  /**
   * User who registered the node
   */
  get registeredBy(): string | undefined {
    return this._node.registeredBy;
  }

  /**
   * WebSocket connection ID
   */
  get connectionId(): string | undefined {
    return this._node.connectionId;
  }

  /**
   * IP address
   */
  get ipAddress(): string | undefined {
    return this._node.ipAddress;
  }

  /**
   * User agent string
   */
  get userAgent(): string | undefined {
    return this._node.userAgent;
  }

  /**
   * Total allocatable resources
   */
  get allocatable(): AllocatableResources {
    return this._node.allocatable;
  }

  /**
   * Currently allocated resources
   */
  get allocated(): AllocatableResources {
    return this._node.allocated;
  }

  /**
   * Labels for organization and selection
   */
  get labels(): Labels {
    return this._node.labels;
  }

  /**
   * Annotations for metadata
   */
  get annotations(): Annotations {
    return this._node.annotations;
  }

  /**
   * Taints to repel pods
   */
  get taints(): Taint[] {
    return this._node.taints;
  }

  /**
   * Whether node is unschedulable
   */
  get unschedulable(): boolean {
    return this._node.unschedulable;
  }

  /**
   * Creation timestamp
   */
  get createdAt(): Date {
    return this._node.createdAt;
  }

  /**
   * Last update timestamp
   */
  get updatedAt(): Date {
    return this._node.updatedAt;
  }

  /**
   * Check if node can accept new pods
   */
  get isSchedulable(): boolean {
    return isNodeSchedulable(this._node);
  }

  /**
   * Check if node is online
   */
  get isOnline(): boolean {
    return this._node.status === 'online';
  }

  /**
   * Check if node is healthy (online and within heartbeat timeout)
   */
  get isHealthy(): boolean {
    if (this._node.status !== 'online') {
      return false;
    }
    if (!this._node.lastHeartbeat) {
      return false;
    }
    const now = Date.now();
    const lastHeartbeat = this._node.lastHeartbeat.getTime();
    return now - lastHeartbeat < HEARTBEAT_TIMEOUT_MS;
  }

  /**
   * Check if heartbeat has timed out
   */
  get hasHeartbeatTimeout(): boolean {
    if (!this._node.lastHeartbeat) {
      return true;
    }
    const now = Date.now();
    const lastHeartbeat = this._node.lastHeartbeat.getTime();
    return now - lastHeartbeat >= HEARTBEAT_TIMEOUT_MS;
  }

  /**
   * Get available resources (allocatable - allocated)
   */
  get availableResources(): AllocatableResources {
    return getAvailableResources(this._node);
  }

  /**
   * Get current pod count
   */
  get podCount(): number {
    return this._node.allocated.pods;
  }

  /**
   * Update node status
   */
  updateStatus(status: NodeStatus): void {
    this._node.status = status;
    this._node.updatedAt = new Date();
  }

  /**
   * Process heartbeat from node
   */
  processHeartbeat(heartbeat: NodeHeartbeat): void {
    this._node.lastHeartbeat = heartbeat.timestamp;
    this._node.updatedAt = new Date();

    if (heartbeat.status !== undefined) {
      this._node.status = heartbeat.status;
    }

    if (heartbeat.allocated !== undefined) {
      this._node.allocated = {
        ...this._node.allocated,
        ...heartbeat.allocated,
      };
    }
  }

  /**
   * Mark node as unhealthy due to heartbeat timeout
   */
  markUnhealthy(): void {
    this._node.status = 'unhealthy';
    this._node.updatedAt = new Date();
  }

  /**
   * Mark node as offline (disconnected)
   */
  markOffline(): void {
    this._node.status = 'offline';
    this._node.connectionId = undefined;
    this._node.updatedAt = new Date();
  }

  /**
   * Set connection ID when node connects via WebSocket
   */
  setConnectionId(connectionId: string): void {
    this._node.connectionId = connectionId;
    this._node.status = 'online';
    this._node.lastHeartbeat = new Date();
    this._node.updatedAt = new Date();
  }

  /**
   * Update node metadata
   */
  update(updates: UpdateNodeInput): void {
    if (updates.status !== undefined) {
      this._node.status = updates.status;
    }
    if (updates.capabilities !== undefined) {
      this._node.capabilities = updates.capabilities;
    }
    if (updates.allocatable !== undefined) {
      this._node.allocatable = {
        ...this._node.allocatable,
        ...updates.allocatable,
      };
    }
    if (updates.labels !== undefined) {
      this._node.labels = updates.labels;
    }
    if (updates.annotations !== undefined) {
      this._node.annotations = updates.annotations;
    }
    if (updates.taints !== undefined) {
      this._node.taints = updates.taints;
    }
    if (updates.unschedulable !== undefined) {
      this._node.unschedulable = updates.unschedulable;
    }
    this._node.updatedAt = new Date();
  }

  /**
   * Allocate resources on the node
   */
  allocateResources(resources: Partial<AllocatableResources>): boolean {
    if (!hasAvailableResources(this._node, resources)) {
      return false;
    }

    if (resources.cpu !== undefined) {
      this._node.allocated.cpu += resources.cpu;
    }
    if (resources.memory !== undefined) {
      this._node.allocated.memory += resources.memory;
    }
    if (resources.pods !== undefined) {
      this._node.allocated.pods += resources.pods;
    }
    if (resources.storage !== undefined) {
      this._node.allocated.storage += resources.storage;
    }

    this._node.updatedAt = new Date();
    return true;
  }

  /**
   * Release resources on the node
   */
  releaseResources(resources: Partial<AllocatableResources>): void {
    if (resources.cpu !== undefined) {
      this._node.allocated.cpu = Math.max(0, this._node.allocated.cpu - resources.cpu);
    }
    if (resources.memory !== undefined) {
      this._node.allocated.memory = Math.max(0, this._node.allocated.memory - resources.memory);
    }
    if (resources.pods !== undefined) {
      this._node.allocated.pods = Math.max(0, this._node.allocated.pods - resources.pods);
    }
    if (resources.storage !== undefined) {
      this._node.allocated.storage = Math.max(0, this._node.allocated.storage - resources.storage);
    }

    this._node.updatedAt = new Date();
  }

  /**
   * Check if node is compatible with a runtime tag
   */
  isCompatibleWith(runtimeTag: 'node' | 'browser' | 'universal'): boolean {
    if (runtimeTag === 'universal') {
      return true;
    }
    return this._node.runtimeType === runtimeTag;
  }

  /**
   * Check if node has sufficient resources
   */
  hasSufficientResources(required: Partial<AllocatableResources>): boolean {
    return hasAvailableResources(this._node, required);
  }

  /**
   * Convert to list item
   */
  toListItem(): NodeListItem {
    return {
      id: this._node.id,
      name: this._node.name,
      runtimeType: this._node.runtimeType,
      status: this._node.status,
      lastHeartbeat: this._node.lastHeartbeat,
      labels: this._node.labels,
      allocatable: this._node.allocatable,
      allocated: this._node.allocated,
      podCount: this._node.allocated.pods,
    };
  }

  /**
   * Create a new Node from input
   */
  static create(
    input: RegisterNodeInput,
    registeredBy: string,
    connectionId?: string,
    ipAddress?: string,
    userAgent?: string,
    id?: string,
  ): NodeModel {
    const now = new Date();
    const node: Node = {
      id: id ?? crypto.randomUUID(),
      name: input.name,
      runtimeType: input.runtimeType,
      status: 'online',
      lastHeartbeat: now,
      capabilities: input.capabilities ?? {},
      registeredBy,
      trusted: false,
      connectionId,
      ipAddress,
      userAgent,
      allocatable: {
        ...DEFAULT_ALLOCATABLE,
        ...input.allocatable,
      },
      allocated: { ...DEFAULT_ALLOCATED },
      labels: input.labels ?? {},
      annotations: input.annotations ?? {},
      taints: input.taints ?? [],
      unschedulable: false,
      createdAt: now,
      updatedAt: now,
    };
    return new NodeModel(node);
  }

  /**
   * Validate node registration input
   */
  static validate(
    input: unknown,
  ): { valid: boolean; errors: Array<{ field: string; message: string; code: string }> } {
    return validateRegisterNodeInput(input as RegisterNodeInput);
  }

  /**
   * Sort nodes by status priority (online first, then by name)
   */
  static sortByStatusAndName(nodes: Node[]): Node[] {
    const statusPriority: Record<NodeStatus, number> = {
      online: 0,
      suspect: 1,
      draining: 2,
      maintenance: 3,
      unhealthy: 4,
      offline: 5,
    };

    return [...nodes].sort((a, b) => {
      const statusDiff = statusPriority[a.status] - statusPriority[b.status];
      if (statusDiff !== 0) {
        return statusDiff;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Filter schedulable nodes
   */
  static filterSchedulable(nodes: Node[]): Node[] {
    return nodes.filter((node) => isNodeSchedulable(node));
  }

  /**
   * Find nodes with sufficient resources
   */
  static filterByResources(
    nodes: Node[],
    required: Partial<AllocatableResources>,
  ): Node[] {
    return nodes.filter((node) => hasAvailableResources(node, required));
  }

  /**
   * Find nodes by runtime type
   */
  static filterByRuntimeType(nodes: Node[], runtimeType: RuntimeType): Node[] {
    return nodes.filter((node) => node.runtimeType === runtimeType);
  }

  /**
   * Find nodes matching label selector
   */
  static filterByLabels(nodes: Node[], selector: Record<string, string>): Node[] {
    return nodes.filter((node) => {
      for (const [key, value] of Object.entries(selector)) {
        if (node.labels[key] !== value) {
          return false;
        }
      }
      return true;
    });
  }
}

/**
 * Create a reactive computed node list item
 */
export function createReactiveNodeListItem(node: Node): ComputedRef<NodeListItem> {
  const reactiveNode = reactive(node);
  return computed(() => ({
    id: reactiveNode.id,
    name: reactiveNode.name,
    runtimeType: reactiveNode.runtimeType,
    status: reactiveNode.status,
    lastHeartbeat: reactiveNode.lastHeartbeat,
    labels: reactiveNode.labels,
    allocatable: reactiveNode.allocatable,
    allocated: reactiveNode.allocated,
    podCount: reactiveNode.allocated.pods,
  }));
}
