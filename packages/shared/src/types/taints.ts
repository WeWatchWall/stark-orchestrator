/**
 * Taints and Tolerations types (Kubernetes-like)
 * @module @stark-o/shared/types/taints
 */

/**
 * Taint effect - what happens to pods that don't tolerate the taint
 * - NoSchedule: Don't schedule new pods
 * - PreferNoSchedule: Try not to schedule new pods
 * - NoExecute: Evict existing pods and don't schedule new ones
 */
export type TaintEffect = 'NoSchedule' | 'PreferNoSchedule' | 'NoExecute';

/**
 * Taint applied to a node
 * Repels pods unless they have a matching toleration
 * 
 * @example
 * // GPU node - only GPU workloads should run here
 * { key: "dedicated", value: "gpu", effect: "NoSchedule" }
 * 
 * // Maintenance mode - evict all pods
 * { key: "node.stark.io/maintenance", effect: "NoExecute" }
 * 
 * // Prefer other nodes
 * { key: "cost", value: "high", effect: "PreferNoSchedule" }
 */
export interface Taint {
  /** Taint key */
  key: string;
  /** Taint value (optional) */
  value?: string;
  /** Effect on non-tolerating pods */
  effect: TaintEffect;
  /** For NoExecute: seconds to wait before eviction (optional) */
  timeAdded?: Date;
}

/**
 * Toleration operator
 * - Equal: key and value must match (default)
 * - Exists: only key must match, value is ignored
 */
export type TolerationOperator = 'Equal' | 'Exists';

/**
 * Toleration allows a pod to be scheduled on a tainted node
 * 
 * @example
 * // Tolerate specific taint
 * { key: "dedicated", operator: "Equal", value: "gpu", effect: "NoSchedule" }
 * 
 * // Tolerate any value for a key
 * { key: "node.stark.io/maintenance", operator: "Exists", effect: "NoExecute" }
 * 
 * // Tolerate all NoSchedule taints with this key (any effect)
 * { key: "dedicated", operator: "Exists" }
 * 
 * // Tolerate everything (super-toleration)
 * { operator: "Exists" }
 */
export interface Toleration {
  /** Taint key to tolerate (empty = all keys) */
  key?: string;
  /** Match operator */
  operator?: TolerationOperator;
  /** Value to match (for Equal operator) */
  value?: string;
  /** Effect to tolerate (empty = all effects) */
  effect?: TaintEffect;
  /** For NoExecute: seconds to tolerate before eviction */
  tolerationSeconds?: number;
}

/**
 * Check if a toleration matches a taint
 */
export function tolerationMatchesTaint(toleration: Toleration, taint: Taint): boolean {
  // Empty key with Exists operator matches all taints
  if (!toleration.key && toleration.operator === 'Exists') {
    // Still need to check effect if specified
    if (toleration.effect && toleration.effect !== taint.effect) {
      return false;
    }
    return true;
  }

  // Key must match
  if (toleration.key !== taint.key) {
    return false;
  }

  // Check operator
  const operator = toleration.operator || 'Equal';
  if (operator === 'Equal') {
    // Value must match
    if (toleration.value !== taint.value) {
      return false;
    }
  }
  // For Exists, value doesn't need to match

  // Check effect if specified
  if (toleration.effect && toleration.effect !== taint.effect) {
    return false;
  }

  return true;
}

/**
 * Check if a pod (via tolerations) tolerates a node's taints
 */
export function toleratesTaints(tolerations: Toleration[], taints: Taint[]): boolean {
  // If no taints, pod is allowed
  if (!taints || taints.length === 0) {
    return true;
  }

  // Each taint must be tolerated
  for (const taint of taints) {
    const isTolerated = tolerations.some(t => tolerationMatchesTaint(t, taint));
    if (!isTolerated) {
      return false;
    }
  }

  return true;
}

/**
 * Get taints that would cause immediate eviction (NoExecute without toleration)
 */
export function getEvictionTaints(tolerations: Toleration[], taints: Taint[]): Taint[] {
  if (!taints) {
    return [];
  }

  return taints.filter(taint => {
    if (taint.effect !== 'NoExecute') {
      return false;
    }
    return !tolerations.some(t => tolerationMatchesTaint(t, taint));
  });
}

/**
 * Check if a pod tolerates all blocking taints (NoSchedule and NoExecute).
 * PreferNoSchedule taints are soft constraints and don't block scheduling.
 * This is used for the scheduling filter step.
 */
export function toleratesBlockingTaints(tolerations: Toleration[], taints: Taint[]): boolean {
  // If no taints, pod is allowed
  if (!taints || taints.length === 0) {
    return true;
  }

  // Only check NoSchedule and NoExecute taints (blocking effects)
  const blockingTaints = taints.filter(t => t.effect === 'NoSchedule' || t.effect === 'NoExecute');

  // Each blocking taint must be tolerated
  for (const taint of blockingTaints) {
    const isTolerated = tolerations.some(t => tolerationMatchesTaint(t, taint));
    if (!isTolerated) {
      return false;
    }
  }

  return true;
}

/**
 * Get PreferNoSchedule taints that are not tolerated by the pod.
 * These are soft constraints that should reduce the node's scheduling score.
 */
export function getUntoleratedPreferNoScheduleTaints(tolerations: Toleration[], taints: Taint[]): Taint[] {
  if (!taints || taints.length === 0) {
    return [];
  }

  return taints.filter(taint => {
    // Only check PreferNoSchedule taints
    if (taint.effect !== 'PreferNoSchedule') {
      return false;
    }
    // Return taints that are NOT tolerated
    return !tolerations.some(t => tolerationMatchesTaint(t, taint));
  });
}

/**
 * Create a common taint
 */
export const CommonTaints = {
  /** Node is not ready */
  notReady: (effect: TaintEffect = 'NoSchedule'): Taint => ({
    key: 'node.stark.io/not-ready',
    effect,
  }),

  /** Node is unreachable */
  unreachable: (effect: TaintEffect = 'NoSchedule'): Taint => ({
    key: 'node.stark.io/unreachable',
    effect,
  }),

  /** Node is in maintenance mode */
  maintenance: (effect: TaintEffect = 'NoExecute'): Taint => ({
    key: 'node.stark.io/maintenance',
    effect,
  }),

  /** Node has dedicated workload type */
  dedicated: (value: string, effect: TaintEffect = 'NoSchedule'): Taint => ({
    key: 'dedicated',
    value,
    effect,
  }),

  /** Node is unschedulable */
  unschedulable: (): Taint => ({
    key: 'node.stark.io/unschedulable',
    effect: 'NoSchedule',
  }),
} as const;

/**
 * Create common tolerations
 */
export const CommonTolerations = {
  /** Tolerate all taints (super-toleration) */
  all: (): Toleration => ({
    operator: 'Exists',
  }),

  /** Tolerate not-ready nodes */
  notReady: (seconds?: number): Toleration => ({
    key: 'node.stark.io/not-ready',
    operator: 'Exists',
    effect: 'NoExecute',
    tolerationSeconds: seconds,
  }),

  /** Tolerate unreachable nodes */
  unreachable: (seconds?: number): Toleration => ({
    key: 'node.stark.io/unreachable',
    operator: 'Exists',
    effect: 'NoExecute',
    tolerationSeconds: seconds,
  }),

  /** Tolerate dedicated workload */
  dedicated: (value: string): Toleration => ({
    key: 'dedicated',
    operator: 'Equal',
    value,
    effect: 'NoSchedule',
  }),

  /** Tolerate maintenance mode (for critical system pods) */
  maintenance: (): Toleration => ({
    key: 'node.stark.io/maintenance',
    operator: 'Exists',
    effect: 'NoExecute',
  }),
} as const;

/**
 * All taint effects
 */
export const ALL_TAINT_EFFECTS: readonly TaintEffect[] = [
  'NoSchedule',
  'PreferNoSchedule',
  'NoExecute',
] as const;

/**
 * All toleration operators
 */
export const ALL_TOLERATION_OPERATORS: readonly TolerationOperator[] = [
  'Equal',
  'Exists',
] as const;
