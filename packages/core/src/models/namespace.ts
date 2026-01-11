/**
 * Namespace reactive model
 * @module @stark-o/core/models/namespace
 */

import { reactive, computed, type ComputedRef } from '@vue/reactivity';
import type {
  Namespace,
  NamespacePhase,
  ResourceQuota,
  ResourceQuotaHard,
  LimitRange,
  ResourceLimitValue,
  ResourceUsage,
  CreateNamespaceInput,
  UpdateNamespaceInput,
  NamespaceListItem,
  Labels,
  Annotations,
} from '@stark-o/shared';
import {
  validateCreateNamespaceInput,
  validateUpdateNamespaceInput,
  hasQuotaAvailable,
  getRemainingQuota,
  applyLimitRangeDefaults,
  validateAgainstLimitRange,
  DEFAULT_RESOURCE_USAGE,
  isReservedNamespace,
} from '@stark-o/shared';

/**
 * Namespace creation result
 */
export interface NamespaceCreationResult {
  namespace: Namespace;
}

/**
 * Namespace list response with pagination
 */
export interface NamespaceListResponse {
  namespaces: Namespace[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Namespace list filters
 */
export interface NamespaceListFilters {
  /** Filter by phase */
  phase?: NamespacePhase;
  /** Filter by label selector */
  labelSelector?: Record<string, string>;
  /** Filter namespaces with quotas only */
  hasQuota?: boolean;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

/**
 * Resource allocation request for quota checking
 */
export interface ResourceAllocationRequest {
  pods?: number;
  cpu?: number;
  memory?: number;
  storage?: number;
}

/**
 * Reactive Namespace model wrapper
 * Provides reactive access to namespace data with computed properties
 */
export class NamespaceModel {
  private readonly _namespace: Namespace;

  constructor(namespace: Namespace) {
    this._namespace = reactive(namespace) as Namespace;
  }

  /**
   * Get the raw namespace data
   */
  get data(): Namespace {
    return this._namespace;
  }

  /**
   * Namespace ID
   */
  get id(): string {
    return this._namespace.id;
  }

  /**
   * Namespace name
   */
  get name(): string {
    return this._namespace.name;
  }

  /**
   * Lifecycle phase
   */
  get phase(): NamespacePhase {
    return this._namespace.phase;
  }

  /**
   * Labels for organization
   */
  get labels(): Labels {
    return this._namespace.labels;
  }

  /**
   * Annotations for metadata
   */
  get annotations(): Annotations {
    return this._namespace.annotations;
  }

  /**
   * Resource quota (optional)
   */
  get resourceQuota(): ResourceQuota | undefined {
    return this._namespace.resourceQuota;
  }

  /**
   * Limit range for pods (optional)
   */
  get limitRange(): LimitRange | undefined {
    return this._namespace.limitRange;
  }

  /**
   * Current resource usage
   */
  get resourceUsage(): ResourceUsage {
    return this._namespace.resourceUsage;
  }

  /**
   * User who created the namespace
   */
  get createdBy(): string | undefined {
    return this._namespace.createdBy;
  }

  /**
   * Creation timestamp
   */
  get createdAt(): Date {
    return this._namespace.createdAt;
  }

  /**
   * Last update timestamp
   */
  get updatedAt(): Date {
    return this._namespace.updatedAt;
  }

  /**
   * Check if namespace is active
   */
  get isActive(): boolean {
    return this._namespace.phase === 'active';
  }

  /**
   * Check if namespace is terminating
   */
  get isTerminating(): boolean {
    return this._namespace.phase === 'terminating';
  }

  /**
   * Check if namespace has a resource quota
   */
  get hasQuota(): boolean {
    return this._namespace.resourceQuota !== undefined;
  }

  /**
   * Check if namespace has a limit range
   */
  get hasLimitRange(): boolean {
    return this._namespace.limitRange !== undefined;
  }

  /**
   * Check if namespace is reserved (cannot be deleted by users)
   */
  get isReserved(): boolean {
    return isReservedNamespace(this._namespace.name);
  }

  /**
   * Get remaining quota (null if no quota)
   */
  get remainingQuota(): ResourceQuotaHard | null {
    return getRemainingQuota(this._namespace);
  }

  /**
   * Check if resources can be allocated within quota
   */
  canAllocate(required: ResourceAllocationRequest): boolean {
    return hasQuotaAvailable(this._namespace, required);
  }

  /**
   * Apply limit range defaults to resource requests/limits
   */
  applyDefaults(
    requests?: { cpu?: number; memory?: number },
    limits?: { cpu?: number; memory?: number },
  ): { requests: ResourceLimitValue; limits: ResourceLimitValue } {
    return applyLimitRangeDefaults(this._namespace.limitRange, requests, limits);
  }

  /**
   * Validate resources against limit range
   */
  validateResources(
    requests: { cpu?: number; memory?: number },
    limits: { cpu?: number; memory?: number },
  ): { valid: boolean; errors: string[] } {
    return validateAgainstLimitRange(
      this._namespace.limitRange,
      { cpu: requests.cpu ?? 0, memory: requests.memory ?? 0 },
      { cpu: limits.cpu ?? 0, memory: limits.memory ?? 0 },
    );
  }

  /**
   * Update namespace phase
   */
  updatePhase(phase: NamespacePhase): void {
    this._namespace.phase = phase;
    this._namespace.updatedAt = new Date();
  }

  /**
   * Mark namespace as terminating
   */
  markTerminating(): void {
    this._namespace.phase = 'terminating';
    this._namespace.updatedAt = new Date();
  }

  /**
   * Update namespace metadata
   */
  update(updates: UpdateNamespaceInput): void {
    if (updates.labels !== undefined) {
      this._namespace.labels = updates.labels;
    }
    if (updates.annotations !== undefined) {
      this._namespace.annotations = updates.annotations;
    }
    if (updates.resourceQuota !== undefined) {
      this._namespace.resourceQuota = updates.resourceQuota;
    }
    if (updates.limitRange !== undefined) {
      this._namespace.limitRange = updates.limitRange;
    }
    this._namespace.updatedAt = new Date();
  }

  /**
   * Update resource usage
   */
  updateResourceUsage(usage: Partial<ResourceUsage>): void {
    if (usage.pods !== undefined) {
      this._namespace.resourceUsage.pods = usage.pods;
    }
    if (usage.cpu !== undefined) {
      this._namespace.resourceUsage.cpu = usage.cpu;
    }
    if (usage.memory !== undefined) {
      this._namespace.resourceUsage.memory = usage.memory;
    }
    if (usage.storage !== undefined) {
      this._namespace.resourceUsage.storage = usage.storage;
    }
    this._namespace.updatedAt = new Date();
  }

  /**
   * Allocate resources (increase usage)
   */
  allocateResources(resources: ResourceAllocationRequest): boolean {
    if (!this.canAllocate(resources)) {
      return false;
    }

    if (resources.pods !== undefined) {
      this._namespace.resourceUsage.pods += resources.pods;
    }
    if (resources.cpu !== undefined) {
      this._namespace.resourceUsage.cpu += resources.cpu;
    }
    if (resources.memory !== undefined) {
      this._namespace.resourceUsage.memory += resources.memory;
    }
    if (resources.storage !== undefined) {
      this._namespace.resourceUsage.storage += resources.storage;
    }

    this._namespace.updatedAt = new Date();
    return true;
  }

  /**
   * Release resources (decrease usage)
   */
  releaseResources(resources: ResourceAllocationRequest): void {
    if (resources.pods !== undefined) {
      this._namespace.resourceUsage.pods = Math.max(
        0,
        this._namespace.resourceUsage.pods - resources.pods,
      );
    }
    if (resources.cpu !== undefined) {
      this._namespace.resourceUsage.cpu = Math.max(
        0,
        this._namespace.resourceUsage.cpu - resources.cpu,
      );
    }
    if (resources.memory !== undefined) {
      this._namespace.resourceUsage.memory = Math.max(
        0,
        this._namespace.resourceUsage.memory - resources.memory,
      );
    }
    if (resources.storage !== undefined) {
      this._namespace.resourceUsage.storage = Math.max(
        0,
        this._namespace.resourceUsage.storage - resources.storage,
      );
    }

    this._namespace.updatedAt = new Date();
  }

  /**
   * Convert to list item
   */
  toListItem(): NamespaceListItem {
    return {
      id: this._namespace.id,
      name: this._namespace.name,
      phase: this._namespace.phase,
      labels: this._namespace.labels,
      resourceUsage: this._namespace.resourceUsage,
      hasQuota: this._namespace.resourceQuota !== undefined,
      createdAt: this._namespace.createdAt,
    };
  }

  /**
   * Create a new Namespace from input
   */
  static create(input: CreateNamespaceInput, createdBy?: string, id?: string): NamespaceModel {
    const now = new Date();
    const namespace: Namespace = {
      id: id ?? crypto.randomUUID(),
      name: input.name,
      phase: 'active',
      labels: input.labels ?? {},
      annotations: input.annotations ?? {},
      resourceQuota: input.resourceQuota,
      limitRange: input.limitRange,
      resourceUsage: { ...DEFAULT_RESOURCE_USAGE },
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    return new NamespaceModel(namespace);
  }

  /**
   * Create the default namespace
   */
  static createDefault(id?: string): NamespaceModel {
    return NamespaceModel.create({ name: 'default' }, undefined, id);
  }

  /**
   * Create system namespace
   */
  static createSystem(id?: string): NamespaceModel {
    const model = NamespaceModel.create(
      {
        name: 'stark-system',
        labels: { 'stark.io/system': 'true' },
        annotations: { 'stark.io/description': 'System namespace for orchestrator components' },
      },
      undefined,
      id,
    );
    return model;
  }

  /**
   * Create public namespace
   */
  static createPublic(id?: string): NamespaceModel {
    const model = NamespaceModel.create(
      {
        name: 'stark-public',
        labels: { 'stark.io/public': 'true' },
        annotations: { 'stark.io/description': 'Public namespace for shared resources' },
      },
      undefined,
      id,
    );
    return model;
  }

  /**
   * Validate namespace creation input
   */
  static validateCreate(
    input: unknown,
  ): { valid: boolean; errors: Array<{ field: string; message: string; code: string }> } {
    return validateCreateNamespaceInput(input);
  }

  /**
   * Validate namespace update input
   */
  static validateUpdate(
    input: unknown,
  ): { valid: boolean; errors: Array<{ field: string; message: string; code: string }> } {
    return validateUpdateNamespaceInput(input);
  }

  /**
   * Sort namespaces by phase priority (active first, then by name)
   */
  static sortByPhaseAndName(namespaces: Namespace[]): Namespace[] {
    const phasePriority: Record<NamespacePhase, number> = {
      active: 0,
      terminating: 1,
    };

    return [...namespaces].sort((a, b) => {
      const phaseDiff = phasePriority[a.phase] - phasePriority[b.phase];
      if (phaseDiff !== 0) {
        return phaseDiff;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Filter active namespaces
   */
  static filterActive(namespaces: Namespace[]): Namespace[] {
    return namespaces.filter((ns) => ns.phase === 'active');
  }

  /**
   * Filter namespaces with quotas
   */
  static filterWithQuota(namespaces: Namespace[]): Namespace[] {
    return namespaces.filter((ns) => ns.resourceQuota !== undefined);
  }

  /**
   * Filter namespaces by labels
   */
  static filterByLabels(namespaces: Namespace[], selector: Record<string, string>): Namespace[] {
    return namespaces.filter((ns) => {
      for (const [key, value] of Object.entries(selector)) {
        if (ns.labels[key] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Find namespace by name
   */
  static findByName(namespaces: Namespace[], name: string): Namespace | undefined {
    return namespaces.find((ns) => ns.name === name);
  }

  /**
   * Check if a namespace with the given name exists
   */
  static nameExists(namespaces: Namespace[], name: string): boolean {
    return namespaces.some((ns) => ns.name === name);
  }

  /**
   * Get total resource usage across all namespaces
   */
  static getTotalUsage(namespaces: Namespace[]): ResourceUsage {
    return namespaces.reduce(
      (acc, ns) => ({
        pods: acc.pods + ns.resourceUsage.pods,
        cpu: acc.cpu + ns.resourceUsage.cpu,
        memory: acc.memory + ns.resourceUsage.memory,
        storage: acc.storage + ns.resourceUsage.storage,
      }),
      { ...DEFAULT_RESOURCE_USAGE },
    );
  }
}

/**
 * Create a reactive computed namespace list item
 */
export function createReactiveNamespaceListItem(namespace: Namespace): ComputedRef<NamespaceListItem> {
  const reactiveNamespace = reactive(namespace);
  return computed(() => ({
    id: reactiveNamespace.id,
    name: reactiveNamespace.name,
    phase: reactiveNamespace.phase,
    labels: reactiveNamespace.labels,
    resourceUsage: reactiveNamespace.resourceUsage,
    hasQuota: reactiveNamespace.resourceQuota !== undefined,
    createdAt: reactiveNamespace.createdAt,
  }));
}
