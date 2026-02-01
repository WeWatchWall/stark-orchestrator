/**
 * Namespace, ResourceQuota, and LimitRange types (Kubernetes-like)
 * @module @stark-o/shared/types/namespace
 */

import type { Labels, Annotations } from './labels';

/**
 * Namespace phase
 * - active: Namespace is active and accepting resources
 * - terminating: Namespace is being deleted
 */
export type NamespacePhase = 'active' | 'terminating';

/**
 * Resource quota hard limits
 */
export interface ResourceQuotaHard {
  /** Maximum number of pods */
  pods?: number;
  /** Maximum CPU in millicores */
  cpu?: number;
  /** Maximum memory in MB */
  memory?: number;
  /** Maximum storage in MB */
  storage?: number;
}

/**
 * Resource quota for a namespace
 */
export interface ResourceQuota {
  /** Hard limits on resources */
  hard: ResourceQuotaHard;
}

/**
 * Resource limit values
 */
export interface ResourceLimitValue {
  /** CPU in millicores */
  cpu?: number;
  /** Memory in MB */
  memory?: number;
}

/**
 * Limit range for pods in a namespace
 */
export interface LimitRange {
  /** Default limits applied to pods without explicit limits */
  default?: ResourceLimitValue;
  /** Default requests applied to pods without explicit requests */
  defaultRequest?: ResourceLimitValue;
  /** Maximum allowed limits */
  max?: ResourceLimitValue;
  /** Minimum allowed limits */
  min?: ResourceLimitValue;
}

/**
 * Current resource usage in a namespace
 */
export interface ResourceUsage {
  /** Number of pods */
  pods: number;
  /** CPU in millicores */
  cpu: number;
  /** Memory in MB */
  memory: number;
  /** Storage in MB */
  storage: number;
}

/**
 * Namespace entity
 */
export interface Namespace {
  /** Unique identifier (UUID) */
  id: string;
  /** Namespace name (unique) */
  name: string;
  /** Lifecycle phase */
  phase: NamespacePhase;
  /** Labels for organization */
  labels: Labels;
  /** Annotations for metadata */
  annotations: Annotations;
  /** Resource quota (optional) */
  resourceQuota?: ResourceQuota;
  /** Limit range for pods (optional) */
  limitRange?: LimitRange;
  /** Current resource usage */
  resourceUsage: ResourceUsage;
  /** User who created the namespace */
  createdBy?: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Namespace creation input
 */
export interface CreateNamespaceInput {
  /** Namespace name */
  name: string;
  /** Labels */
  labels?: Labels;
  /** Annotations */
  annotations?: Annotations;
  /** Resource quota */
  resourceQuota?: ResourceQuota;
  /** Limit range */
  limitRange?: LimitRange;
}

/**
 * Namespace update input
 */
export interface UpdateNamespaceInput {
  /** Labels */
  labels?: Labels;
  /** Annotations */
  annotations?: Annotations;
  /** Resource quota */
  resourceQuota?: ResourceQuota;
  /** Limit range */
  limitRange?: LimitRange;
}

/**
 * Namespace list item
 */
export interface NamespaceListItem {
  id: string;
  name: string;
  phase: NamespacePhase;
  labels: Labels;
  resourceUsage: ResourceUsage;
  hasQuota: boolean;
  createdAt: Date;
}

/**
 * Reserved namespace names
 */
export const RESERVED_NAMESPACES = ['default', 'stark-system', 'stark-public'] as const;

/**
 * Check if a namespace name is reserved
 */
export function isReservedNamespace(name: string): boolean {
  return (RESERVED_NAMESPACES as readonly string[]).includes(name);
}

/**
 * Check if a namespace has available quota for resources
 */
export function hasQuotaAvailable(
  namespace: Namespace,
  required: Partial<ResourceQuotaHard>,
): boolean {
  if (!namespace.resourceQuota) {
    return true; // No quota = unlimited
  }

  const quota = namespace.resourceQuota.hard;
  const usage = namespace.resourceUsage;

  if (required.pods !== undefined && quota.pods !== undefined) {
    if (usage.pods + required.pods > quota.pods) {
      return false;
    }
  }

  if (required.cpu !== undefined && quota.cpu !== undefined) {
    if (usage.cpu + required.cpu > quota.cpu) {
      return false;
    }
  }

  if (required.memory !== undefined && quota.memory !== undefined) {
    if (usage.memory + required.memory > quota.memory) {
      return false;
    }
  }

  if (required.storage !== undefined && quota.storage !== undefined) {
    if (usage.storage + required.storage > quota.storage) {
      return false;
    }
  }

  return true;
}

/**
 * Get remaining quota for a namespace
 */
export function getRemainingQuota(namespace: Namespace): ResourceQuotaHard | null {
  if (!namespace.resourceQuota) {
    return null;
  }

  const quota = namespace.resourceQuota.hard;
  const usage = namespace.resourceUsage;

  return {
    pods: quota.pods !== undefined ? quota.pods - usage.pods : undefined,
    cpu: quota.cpu !== undefined ? quota.cpu - usage.cpu : undefined,
    memory: quota.memory !== undefined ? quota.memory - usage.memory : undefined,
    storage: quota.storage !== undefined ? quota.storage - usage.storage : undefined,
  };
}

/**
 * Apply limit range defaults to resource values
 */
export function applyLimitRangeDefaults(
  limitRange: LimitRange | undefined,
  requests?: Partial<ResourceLimitValue>,
  limits?: Partial<ResourceLimitValue>,
): { requests: ResourceLimitValue; limits: ResourceLimitValue } {
  const defaultRequests = limitRange?.defaultRequest ?? { cpu: 100, memory: 128 };
  const defaultLimits = limitRange?.default ?? { cpu: 500, memory: 512 };

  return {
    requests: {
      cpu: requests?.cpu ?? defaultRequests.cpu ?? 100,
      memory: requests?.memory ?? defaultRequests.memory ?? 128,
    },
    limits: {
      cpu: limits?.cpu ?? defaultLimits.cpu ?? 500,
      memory: limits?.memory ?? defaultLimits.memory ?? 512,
    },
  };
}

/**
 * Validate resources against limit range
 */
export function validateAgainstLimitRange(
  limitRange: LimitRange | undefined,
  requests: ResourceLimitValue,
  limits: ResourceLimitValue,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!limitRange) {
    return { valid: true, errors };
  }

  // Check minimums
  if (limitRange.min) {
    if (limitRange.min.cpu !== undefined && requests.cpu !== undefined) {
      if (requests.cpu < limitRange.min.cpu) {
        errors.push(`CPU request (${requests.cpu}) is below minimum (${limitRange.min.cpu})`);
      }
    }
    if (limitRange.min.memory !== undefined && requests.memory !== undefined) {
      if (requests.memory < limitRange.min.memory) {
        errors.push(`Memory request (${requests.memory}) is below minimum (${limitRange.min.memory})`);
      }
    }
  }

  // Check maximums
  if (limitRange.max) {
    if (limitRange.max.cpu !== undefined && limits.cpu !== undefined) {
      if (limits.cpu > limitRange.max.cpu) {
        errors.push(`CPU limit (${limits.cpu}) exceeds maximum (${limitRange.max.cpu})`);
      }
    }
    if (limitRange.max.memory !== undefined && limits.memory !== undefined) {
      if (limits.memory > limitRange.max.memory) {
        errors.push(`Memory limit (${limits.memory}) exceeds maximum (${limitRange.max.memory})`);
      }
    }
  }

  // Limits must be >= requests
  if (requests.cpu !== undefined && limits.cpu !== undefined && limits.cpu < requests.cpu) {
    errors.push(`CPU limit (${limits.cpu}) must be >= request (${requests.cpu})`);
  }
  if (requests.memory !== undefined && limits.memory !== undefined && limits.memory < requests.memory) {
    errors.push(`Memory limit (${limits.memory}) must be >= request (${requests.memory})`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Default resource usage (empty)
 */
export const DEFAULT_RESOURCE_USAGE: ResourceUsage = {
  pods: 0,
  cpu: 0,
  memory: 0,
  storage: 0,
};

/**
 * All namespace phases
 */
export const ALL_NAMESPACE_PHASES: readonly NamespacePhase[] = ['active', 'terminating'] as const;
