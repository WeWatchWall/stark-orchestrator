/**
 * Namespace manager service
 * Handles namespace CRUD, quota enforcement, and resource management
 * @module @stark-o/core/services/namespace-manager
 */

import type { ComputedRef } from '@vue/reactivity';
import { computed } from '@vue/reactivity';
import type {
  Namespace,
  NamespacePhase,
  ResourceQuotaHard,
  LimitRange,
  ResourceUsage,
  CreateNamespaceInput,
  UpdateNamespaceInput,
  Labels,
} from '@stark-o/shared';
import {
  validateCreateNamespaceInput,
  validateUpdateNamespaceInput,
  isReservedNamespaceName,
  hasQuotaAvailable,
  getRemainingQuota,
  createServiceLogger,
  matchesSelector,
  DEFAULT_RESOURCE_USAGE,
} from '@stark-o/shared';
import { clusterState } from '../stores/cluster-store';
import {
  NamespaceModel,
  type NamespaceCreationResult,
  type NamespaceListResponse,
  type NamespaceListFilters,
  type ResourceAllocationRequest,
} from '../models/namespace';

/**
 * Logger for namespace manager operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'namespace-manager' });

// ============================================================================
// Types
// ============================================================================

/**
 * Namespace manager options
 */
export interface NamespaceManagerOptions {
  /** Initialize default namespaces on startup */
  initializeDefaults?: boolean;
}

/**
 * Namespace operation result
 */
export interface NamespaceOperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Re-export NamespaceCreationResult from models
 */
export type { NamespaceCreationResult };

/**
 * Quota check result
 */
export interface QuotaCheckResult {
  allowed: boolean;
  namespace: string;
  requested: ResourceAllocationRequest;
  remaining: ResourceQuotaHard | null;
  exceededResources?: string[];
}

/**
 * Namespace manager error codes
 */
export const NamespaceManagerErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NAMESPACE_EXISTS: 'NAMESPACE_EXISTS',
  NAMESPACE_NOT_FOUND: 'NAMESPACE_NOT_FOUND',
  RESERVED_NAMESPACE: 'RESERVED_NAMESPACE',
  NAMESPACE_TERMINATING: 'NAMESPACE_TERMINATING',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  NAMESPACE_NOT_EMPTY: 'NAMESPACE_NOT_EMPTY',
  CANNOT_DELETE_DEFAULT: 'CANNOT_DELETE_DEFAULT',
  INVALID_PHASE_TRANSITION: 'INVALID_PHASE_TRANSITION',
} as const;

// ============================================================================
// Computed Properties
// ============================================================================

/**
 * Total number of namespaces
 */
export const namespaceCount: ComputedRef<number> = computed(() =>
  clusterState.namespaces.size
);

/**
 * Number of active namespaces
 */
export const activeNamespaceCount: ComputedRef<number> = computed(() =>
  [...clusterState.namespaces.values()].filter(ns => ns.phase === 'active').length
);

/**
 * Namespaces grouped by phase
 */
export const namespacesByPhase: ComputedRef<Map<NamespacePhase, Namespace[]>> = computed(() => {
  const grouped = new Map<NamespacePhase, Namespace[]>();
  for (const ns of clusterState.namespaces.values()) {
    const list = grouped.get(ns.phase) ?? [];
    list.push(ns);
    grouped.set(ns.phase, list);
  }
  return grouped;
});

/**
 * Namespaces with quotas
 */
export const namespacesWithQuota: ComputedRef<Namespace[]> = computed(() =>
  [...clusterState.namespaces.values()].filter(ns => ns.resourceQuota !== undefined)
);

/**
 * Total resource usage across all namespaces
 */
export const totalResourceUsage: ComputedRef<ResourceUsage> = computed(() => {
  const namespaces = [...clusterState.namespaces.values()];
  return namespaces.reduce(
    (acc, ns) => ({
      pods: acc.pods + ns.resourceUsage.pods,
      cpu: acc.cpu + ns.resourceUsage.cpu,
      memory: acc.memory + ns.resourceUsage.memory,
      storage: acc.storage + ns.resourceUsage.storage,
    }),
    { ...DEFAULT_RESOURCE_USAGE }
  );
});

// ============================================================================
// Store Actions
// ============================================================================

/**
 * Add a namespace to the store
 */
function addNamespace(namespace: Namespace): Namespace {
  clusterState.namespaces.set(namespace.name, namespace);
  return namespace;
}

/**
 * Remove a namespace from the store
 */
function removeNamespace(name: string): boolean {
  return clusterState.namespaces.delete(name);
}

/**
 * Find namespace by name
 */
export function findNamespaceByName(name: string): Namespace | undefined {
  return clusterState.namespaces.get(name);
}

/**
 * Find namespaces by label selector
 */
export function findNamespacesBySelector(selector: Labels): Namespace[] {
  return [...clusterState.namespaces.values()].filter(ns =>
    matchesSelector(ns.labels, selector)
  );
}

/**
 * Find namespaces by phase
 */
export function findNamespacesByPhase(phase: NamespacePhase): Namespace[] {
  return [...clusterState.namespaces.values()].filter(ns => ns.phase === phase);
}

/**
 * Check if a namespace exists
 */
export function namespaceExists(name: string): boolean {
  return clusterState.namespaces.has(name);
}

/**
 * Get pods count in namespace
 */
function getPodsCountInNamespace(namespaceName: string): number {
  let count = 0;
  for (const pod of clusterState.pods.values()) {
    if (pod.namespace === namespaceName) {
      count++;
    }
  }
  return count;
}

// ============================================================================
// Namespace Manager Service
// ============================================================================

/**
 * Namespace Manager Service
 * Manages namespace lifecycle: creation, update, deletion, and quota enforcement
 */
export class NamespaceManager {
  private readonly initializeDefaults: boolean;
  private initialized = false;

  constructor(options: NamespaceManagerOptions = {}) {
    this.initializeDefaults = options.initializeDefaults ?? true;
  }

  // ===========================================================================
  // Computed Properties (reactive)
  // ===========================================================================

  /**
   * Total number of namespaces
   */
  get total(): ComputedRef<number> {
    return namespaceCount;
  }

  /**
   * Number of active namespaces
   */
  get activeCount(): ComputedRef<number> {
    return activeNamespaceCount;
  }

  /**
   * Namespaces grouped by phase
   */
  get byPhase(): ComputedRef<Map<NamespacePhase, Namespace[]>> {
    return namespacesByPhase;
  }

  /**
   * Namespaces with quotas
   */
  get withQuota(): ComputedRef<Namespace[]> {
    return namespacesWithQuota;
  }

  /**
   * Total resource usage
   */
  get totalUsage(): ComputedRef<ResourceUsage> {
    return totalResourceUsage;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the namespace manager
   * Creates default namespaces if configured
   */
  initialize(): void {
    if (this.initialized) {
      logger.debug('Namespace manager already initialized');
      return;
    }

    logger.info('Initializing namespace manager');

    if (this.initializeDefaults) {
      this.ensureDefaultNamespaces();
    }

    this.initialized = true;
    logger.info('Namespace manager initialized', {
      namespaceCount: clusterState.namespaces.size,
    });
  }

  /**
   * Ensure default namespaces exist
   */
  ensureDefaultNamespaces(): void {
    // Create default namespace if it doesn't exist
    if (!clusterState.namespaces.has('default')) {
      const defaultNs = NamespaceModel.createDefault();
      addNamespace(defaultNs.data);
      logger.info('Created default namespace');
    }

    // Create system namespace if it doesn't exist
    if (!clusterState.namespaces.has('stark-system')) {
      const systemNs = NamespaceModel.createSystem();
      addNamespace(systemNs.data);
      logger.info('Created stark-system namespace');
    }

    // Create public namespace if it doesn't exist
    if (!clusterState.namespaces.has('stark-public')) {
      const publicNs = NamespaceModel.createPublic();
      addNamespace(publicNs.data);
      logger.info('Created stark-public namespace');
    }
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Create a new namespace
   * @param input - Namespace creation input
   * @param createdBy - User ID who is creating the namespace
   * @returns Creation result with namespace data
   */
  create(
    input: CreateNamespaceInput,
    createdBy?: string,
  ): NamespaceOperationResult<NamespaceCreationResult> {
    logger.debug('Attempting namespace creation', {
      namespaceName: input.name,
      createdBy,
      hasQuota: !!input.resourceQuota,
      hasLimitRange: !!input.limitRange,
    });

    // Validate input
    const validation = validateCreateNamespaceInput(input);
    if (!validation.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validation.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      logger.warn('Namespace creation validation failed', {
        namespaceName: input.name,
        createdBy,
        errorCount: validation.errors.length,
      });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.VALIDATION_ERROR,
          message: 'Validation failed',
          details,
        },
      };
    }

    // Check if namespace already exists
    if (clusterState.namespaces.has(input.name)) {
      logger.warn('Namespace already exists', {
        namespaceName: input.name,
        createdBy,
      });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_EXISTS,
          message: `Namespace '${input.name}' already exists`,
          details: { name: input.name },
        },
      };
    }

    // Check if name is reserved (validation should catch this too)
    if (isReservedNamespaceName(input.name)) {
      logger.warn('Attempted to create reserved namespace', {
        namespaceName: input.name,
        createdBy,
      });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.RESERVED_NAMESPACE,
          message: `Namespace name '${input.name}' is reserved`,
          details: { name: input.name },
        },
      };
    }

    // Create the namespace
    const namespaceModel = NamespaceModel.create(input, createdBy);
    const namespace = addNamespace(namespaceModel.data);

    logger.info('Namespace created successfully', {
      namespaceId: namespace.id,
      namespaceName: namespace.name,
      createdBy,
      hasQuota: !!namespace.resourceQuota,
    });

    return {
      success: true,
      data: { namespace },
    };
  }

  /**
   * Get a namespace by name
   * @param name - Namespace name
   * @returns Namespace or error
   */
  get(name: string): NamespaceOperationResult<{ namespace: Namespace }> {
    const namespace = clusterState.namespaces.get(name);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${name}' not found`,
          details: { name },
        },
      };
    }

    return {
      success: true,
      data: { namespace },
    };
  }

  /**
   * List namespaces with optional filtering
   * @param filters - Optional filters
   * @returns List of namespaces with pagination
   */
  list(filters: NamespaceListFilters = {}): NamespaceListResponse {
    let namespaces = [...clusterState.namespaces.values()];

    // Filter by phase
    if (filters.phase) {
      namespaces = namespaces.filter(ns => ns.phase === filters.phase);
    }

    // Filter by label selector
    if (filters.labelSelector && Object.keys(filters.labelSelector).length > 0) {
      namespaces = namespaces.filter(ns =>
        matchesSelector(ns.labels, filters.labelSelector!)
      );
    }

    // Filter by quota presence
    if (filters.hasQuota !== undefined) {
      const hasQuotaFilter = filters.hasQuota;
      namespaces = namespaces.filter(ns =>
        hasQuotaFilter === true ? ns.resourceQuota !== undefined : ns.resourceQuota === undefined
      );
    }

    // Sort by phase and name
    namespaces = NamespaceModel.sortByPhaseAndName(namespaces);

    const total = namespaces.length;
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const paginatedNamespaces = namespaces.slice(start, start + pageSize);

    return {
      namespaces: paginatedNamespaces,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Update a namespace
   * @param name - Namespace name
   * @param input - Update input
   * @returns Updated namespace or error
   */
  update(
    name: string,
    input: UpdateNamespaceInput,
  ): NamespaceOperationResult<{ namespace: Namespace }> {
    logger.debug('Attempting namespace update', {
      namespaceName: name,
      hasLabels: input.labels !== undefined,
      hasAnnotations: input.annotations !== undefined,
      hasQuota: input.resourceQuota !== undefined,
      hasLimitRange: input.limitRange !== undefined,
    });

    // Check if namespace exists
    const existing = clusterState.namespaces.get(name);
    if (!existing) {
      logger.warn('Namespace not found for update', { namespaceName: name });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${name}' not found`,
          details: { name },
        },
      };
    }

    // Check if namespace is terminating
    if (existing.phase === 'terminating') {
      logger.warn('Cannot update terminating namespace', { namespaceName: name });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_TERMINATING,
          message: `Namespace '${name}' is terminating and cannot be updated`,
          details: { name, phase: existing.phase },
        },
      };
    }

    // Validate input
    const validation = validateUpdateNamespaceInput(input);
    if (!validation.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validation.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      logger.warn('Namespace update validation failed', {
        namespaceName: name,
        errorCount: validation.errors.length,
      });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.VALIDATION_ERROR,
          message: 'Validation failed',
          details,
        },
      };
    }

    // Apply updates using the model
    const model = new NamespaceModel(existing);
    model.update(input);

    logger.info('Namespace updated successfully', {
      namespaceId: existing.id,
      namespaceName: name,
    });

    return {
      success: true,
      data: { namespace: existing },
    };
  }

  /**
   * Delete a namespace
   * @param name - Namespace name
   * @param force - Force deletion even if not empty
   * @returns Success or error
   */
  delete(
    name: string,
    force = false,
  ): NamespaceOperationResult<{ name: string }> {
    logger.debug('Attempting namespace deletion', {
      namespaceName: name,
      force,
    });

    // Check if namespace exists
    const existing = clusterState.namespaces.get(name);
    if (!existing) {
      logger.warn('Namespace not found for deletion', { namespaceName: name });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${name}' not found`,
          details: { name },
        },
      };
    }

    // Cannot delete 'default' namespace
    if (name === 'default') {
      logger.warn('Attempted to delete default namespace');
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.CANNOT_DELETE_DEFAULT,
          message: "Cannot delete the 'default' namespace",
          details: { name },
        },
      };
    }

    // Check if namespace is empty (unless force)
    if (!force) {
      const podCount = getPodsCountInNamespace(name);
      if (podCount > 0) {
        logger.warn('Cannot delete non-empty namespace', {
          namespaceName: name,
          podCount,
        });
        return {
          success: false,
          error: {
            code: NamespaceManagerErrorCodes.NAMESPACE_NOT_EMPTY,
            message: `Namespace '${name}' contains ${podCount} pod(s). Use force=true to delete anyway.`,
            details: { name, podCount },
          },
        };
      }
    }

    // Mark as terminating first
    if (existing.phase !== 'terminating') {
      existing.phase = 'terminating';
      existing.updatedAt = new Date();
    }

    // Remove the namespace
    removeNamespace(name);

    logger.info('Namespace deleted successfully', {
      namespaceId: existing.id,
      namespaceName: name,
      force,
    });

    return {
      success: true,
      data: { name },
    };
  }

  /**
   * Mark a namespace as terminating (soft delete)
   * @param name - Namespace name
   * @returns Success or error
   */
  markTerminating(name: string): NamespaceOperationResult<{ namespace: Namespace }> {
    const existing = clusterState.namespaces.get(name);
    if (!existing) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${name}' not found`,
          details: { name },
        },
      };
    }

    if (name === 'default') {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.CANNOT_DELETE_DEFAULT,
          message: "Cannot terminate the 'default' namespace",
          details: { name },
        },
      };
    }

    if (existing.phase === 'terminating') {
      return {
        success: true,
        data: { namespace: existing },
      };
    }

    existing.phase = 'terminating';
    existing.updatedAt = new Date();

    logger.info('Namespace marked as terminating', {
      namespaceId: existing.id,
      namespaceName: name,
    });

    return {
      success: true,
      data: { namespace: existing },
    };
  }

  // ===========================================================================
  // Quota Enforcement
  // ===========================================================================

  /**
   * Check if resources can be allocated within namespace quota
   * @param namespaceName - Namespace name
   * @param required - Required resources
   * @returns Quota check result
   */
  checkQuota(
    namespaceName: string,
    required: ResourceAllocationRequest,
  ): NamespaceOperationResult<QuotaCheckResult> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    const remaining = getRemainingQuota(namespace);
    const allowed = hasQuotaAvailable(namespace, required);
    const exceededResources: string[] = [];

    if (!allowed && remaining) {
      if (required.pods !== undefined && remaining.pods !== undefined) {
        if (required.pods > remaining.pods) {
          exceededResources.push(`pods (requested: ${required.pods}, remaining: ${remaining.pods})`);
        }
      }
      if (required.cpu !== undefined && remaining.cpu !== undefined) {
        if (required.cpu > remaining.cpu) {
          exceededResources.push(`cpu (requested: ${required.cpu}, remaining: ${remaining.cpu})`);
        }
      }
      if (required.memory !== undefined && remaining.memory !== undefined) {
        if (required.memory > remaining.memory) {
          exceededResources.push(`memory (requested: ${required.memory}, remaining: ${remaining.memory})`);
        }
      }
      if (required.storage !== undefined && remaining.storage !== undefined) {
        if (required.storage > remaining.storage) {
          exceededResources.push(`storage (requested: ${required.storage}, remaining: ${remaining.storage})`);
        }
      }
    }

    return {
      success: true,
      data: {
        allowed,
        namespace: namespaceName,
        requested: required,
        remaining,
        exceededResources: exceededResources.length > 0 ? exceededResources : undefined,
      },
    };
  }

  /**
   * Allocate resources in a namespace
   * Increases resource usage counters
   * @param namespaceName - Namespace name
   * @param resources - Resources to allocate
   * @returns Success or quota exceeded error
   */
  allocateResources(
    namespaceName: string,
    resources: ResourceAllocationRequest,
  ): NamespaceOperationResult<{ namespace: Namespace }> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    // Check quota before allocating
    const quotaCheck = this.checkQuota(namespaceName, resources);
    if (!quotaCheck.success) {
      return {
        success: false,
        error: quotaCheck.error,
      };
    }

    if (!quotaCheck.data!.allowed) {
      logger.warn('Quota exceeded for namespace', {
        namespaceName,
        requested: resources,
        remaining: quotaCheck.data!.remaining,
        exceeded: quotaCheck.data!.exceededResources,
      });
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.QUOTA_EXCEEDED,
          message: `Quota exceeded in namespace '${namespaceName}'`,
          details: {
            name: namespaceName,
            requested: resources,
            remaining: quotaCheck.data!.remaining,
            exceeded: quotaCheck.data!.exceededResources,
          },
        },
      };
    }

    // Allocate resources
    const model = new NamespaceModel(namespace);
    model.allocateResources(resources);

    logger.debug('Resources allocated in namespace', {
      namespaceName,
      resources,
      newUsage: namespace.resourceUsage,
    });

    return {
      success: true,
      data: { namespace },
    };
  }

  /**
   * Release resources in a namespace
   * Decreases resource usage counters
   * @param namespaceName - Namespace name
   * @param resources - Resources to release
   * @returns Updated namespace
   */
  releaseResources(
    namespaceName: string,
    resources: ResourceAllocationRequest,
  ): NamespaceOperationResult<{ namespace: Namespace }> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    // Release resources
    const model = new NamespaceModel(namespace);
    model.releaseResources(resources);

    logger.debug('Resources released in namespace', {
      namespaceName,
      resources,
      newUsage: namespace.resourceUsage,
    });

    return {
      success: true,
      data: { namespace },
    };
  }

  /**
   * Get remaining quota for a namespace
   * @param namespaceName - Namespace name
   * @returns Remaining quota or null if no quota
   */
  getRemainingQuota(namespaceName: string): NamespaceOperationResult<{ remaining: ResourceQuotaHard | null }> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    return {
      success: true,
      data: { remaining: getRemainingQuota(namespace) },
    };
  }

  /**
   * Update resource usage for a namespace
   * Directly sets resource usage values (for syncing with actual state)
   * @param namespaceName - Namespace name
   * @param usage - New usage values
   * @returns Updated namespace
   */
  updateResourceUsage(
    namespaceName: string,
    usage: Partial<ResourceUsage>,
  ): NamespaceOperationResult<{ namespace: Namespace }> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    const model = new NamespaceModel(namespace);
    model.updateResourceUsage(usage);

    return {
      success: true,
      data: { namespace },
    };
  }

  // ===========================================================================
  // Limit Range
  // ===========================================================================

  /**
   * Get limit range for a namespace
   * @param namespaceName - Namespace name
   * @returns Limit range or undefined
   */
  getLimitRange(namespaceName: string): NamespaceOperationResult<{ limitRange: LimitRange | undefined }> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    return {
      success: true,
      data: { limitRange: namespace.limitRange },
    };
  }

  /**
   * Apply limit range defaults to pod resources
   * @param namespaceName - Namespace name
   * @param requests - Pod resource requests
   * @param limits - Pod resource limits
   * @returns Resolved requests and limits
   */
  applyLimitRangeDefaults(
    namespaceName: string,
    requests?: { cpu?: number; memory?: number },
    limits?: { cpu?: number; memory?: number },
  ): NamespaceOperationResult<{ requests: { cpu?: number; memory?: number }; limits: { cpu?: number; memory?: number } }> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    const model = new NamespaceModel(namespace);
    const result = model.applyDefaults(requests, limits);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Validate pod resources against namespace limit range
   * @param namespaceName - Namespace name
   * @param requests - Pod resource requests
   * @param limits - Pod resource limits
   * @returns Validation result
   */
  validateLimitRange(
    namespaceName: string,
    requests: { cpu?: number; memory?: number },
    limits: { cpu?: number; memory?: number },
  ): NamespaceOperationResult<{ valid: boolean; errors: string[] }> {
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      return {
        success: false,
        error: {
          code: NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace '${namespaceName}' not found`,
          details: { name: namespaceName },
        },
      };
    }

    const model = new NamespaceModel(namespace);
    const result = model.validateResources(requests, limits);

    return {
      success: true,
      data: result,
    };
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Find namespaces by label selector
   * @param selector - Label selector
   * @returns Matching namespaces
   */
  findBySelector(selector: Labels): Namespace[] {
    return findNamespacesBySelector(selector);
  }

  /**
   * Find namespaces by phase
   * @param phase - Phase to filter by
   * @returns Matching namespaces
   */
  findByPhase(phase: NamespacePhase): Namespace[] {
    return findNamespacesByPhase(phase);
  }

  /**
   * Check if a namespace exists
   * @param name - Namespace name
   * @returns True if exists
   */
  exists(name: string): boolean {
    return namespaceExists(name);
  }

  /**
   * Get the default namespace
   * @returns Default namespace or undefined
   */
  getDefault(): Namespace | undefined {
    return clusterState.namespaces.get('default');
  }

  /**
   * Get namespace or default
   * Returns the specified namespace, or 'default' if not found
   * @param name - Namespace name (optional)
   * @returns Namespace
   */
  getOrDefault(name?: string): Namespace | undefined {
    if (name !== undefined && name !== '') {
      return clusterState.namespaces.get(name) ?? clusterState.namespaces.get('default');
    }
    return clusterState.namespaces.get('default');
  }
}

// ============================================================================
// Default Instance
// ============================================================================

/**
 * Default namespace manager instance
 */
export const namespaceManager = new NamespaceManager();

/**
 * Create a new namespace manager with custom options
 */
export function createNamespaceManager(options?: NamespaceManagerOptions): NamespaceManager {
  return new NamespaceManager(options);
}
