/**
 * Node affinity, pod affinity, and scheduling config types (Kubernetes-like)
 * @module @stark-o/shared/types/scheduling
 */

import type { LabelSelector } from './labels';

/**
 * Scheduling policy for the cluster
 */
export type SchedulingPolicy =
  | 'spread'       // Spread pods across nodes
  | 'binpack'      // Pack pods onto fewer nodes
  | 'random'       // Random node selection
  | 'affinity'     // Use affinity rules
  | 'least_loaded'; // Select least loaded node

/**
 * Node selector term for node affinity
 */
export interface NodeSelectorTerm {
  /** Match expressions (all must match) */
  matchExpressions?: NodeSelectorRequirement[];
  /** Match fields (all must match) */
  matchFields?: NodeSelectorRequirement[];
}

/**
 * Node selector requirement (single expression)
 */
export interface NodeSelectorRequirement {
  /** Label/field key */
  key: string;
  /** Operator */
  operator: 'In' | 'NotIn' | 'Exists' | 'DoesNotExist' | 'Gt' | 'Lt';
  /** Values for In/NotIn */
  values?: string[];
}

/**
 * Preferred scheduling term with weight
 */
export interface PreferredSchedulingTerm {
  /** Weight (1-100) */
  weight: number;
  /** Node selector term */
  preference: NodeSelectorTerm;
}

/**
 * Node affinity rules
 * 
 * @example
 * {
 *   requiredDuringSchedulingIgnoredDuringExecution: {
 *     nodeSelectorTerms: [
 *       { matchExpressions: [{ key: "zone", operator: "In", values: ["us-west-1", "us-west-2"] }] }
 *     ]
 *   },
 *   preferredDuringSchedulingIgnoredDuringExecution: [
 *     { weight: 100, preference: { matchExpressions: [{ key: "disktype", operator: "In", values: ["ssd"] }] } }
 *   ]
 * }
 */
export interface NodeAffinity {
  /** Required: pod can only be scheduled if conditions are met */
  requiredDuringSchedulingIgnoredDuringExecution?: {
    /** Node selector terms (any one must match) */
    nodeSelectorTerms: NodeSelectorTerm[];
  };
  /** Preferred: scheduler will try to meet these conditions */
  preferredDuringSchedulingIgnoredDuringExecution?: PreferredSchedulingTerm[];
}

/**
 * Pod affinity term
 */
export interface PodAffinityTerm {
  /** Label selector for pods */
  labelSelector?: LabelSelector;
  /** Namespaces to consider (empty = same namespace) */
  namespaces?: string[];
  /** Topology key (e.g., "node", "zone") */
  topologyKey: string;
}

/**
 * Weighted pod affinity term
 */
export interface WeightedPodAffinityTerm {
  /** Weight (1-100) */
  weight: number;
  /** Pod affinity term */
  podAffinityTerm: PodAffinityTerm;
}

/**
 * Pod affinity rules - co-locate pods
 * 
 * @example
 * {
 *   requiredDuringSchedulingIgnoredDuringExecution: [
 *     {
 *       labelSelector: { matchLabels: { "app": "cache" } },
 *       topologyKey: "node"
 *     }
 *   ]
 * }
 */
export interface PodAffinity {
  /** Required: pod can only be scheduled if conditions are met */
  requiredDuringSchedulingIgnoredDuringExecution?: PodAffinityTerm[];
  /** Preferred: scheduler will try to meet these conditions */
  preferredDuringSchedulingIgnoredDuringExecution?: WeightedPodAffinityTerm[];
}

/**
 * Pod anti-affinity rules - spread pods apart
 * 
 * @example
 * {
 *   preferredDuringSchedulingIgnoredDuringExecution: [
 *     {
 *       weight: 100,
 *       podAffinityTerm: {
 *         labelSelector: { matchLabels: { "app": "frontend" } },
 *         topologyKey: "node"
 *       }
 *     }
 *   ]
 * }
 */
export interface PodAntiAffinity {
  /** Required: pod cannot be scheduled if conditions are met */
  requiredDuringSchedulingIgnoredDuringExecution?: PodAffinityTerm[];
  /** Preferred: scheduler will try to avoid these conditions */
  preferredDuringSchedulingIgnoredDuringExecution?: WeightedPodAffinityTerm[];
}

/**
 * Full scheduling configuration for a pod
 */
export interface SchedulingConfig {
  /** Simple node label matching */
  nodeSelector?: Record<string, string>;
  /** Node affinity rules */
  nodeAffinity?: NodeAffinity;
  /** Pod affinity rules */
  podAffinity?: PodAffinity;
  /** Pod anti-affinity rules */
  podAntiAffinity?: PodAntiAffinity;
  /** Scheduler name (for custom schedulers) */
  schedulerName?: string;
  /** Priority class name */
  priorityClassName?: string;
}

/**
 * Check if a node selector requirement matches a value
 */
export function matchesRequirement(
  value: string | undefined,
  req: NodeSelectorRequirement,
): boolean {
  const hasValue = value !== undefined;

  switch (req.operator) {
    case 'In':
      return hasValue && (req.values?.includes(value) ?? false);
    case 'NotIn':
      return !hasValue || !(req.values?.includes(value) ?? false);
    case 'Exists':
      return hasValue;
    case 'DoesNotExist':
      return !hasValue;
    case 'Gt':
      if (!hasValue || !req.values?.[0]) return false;
      return parseFloat(value) > parseFloat(req.values[0]);
    case 'Lt':
      if (!hasValue || !req.values?.[0]) return false;
      return parseFloat(value) < parseFloat(req.values[0]);
    default:
      return false;
  }
}

/**
 * Check if a node matches a selector term
 */
export function matchesNodeSelectorTerm(
  nodeLabels: Record<string, string>,
  term: NodeSelectorTerm,
): boolean {
  // Check match expressions
  if (term.matchExpressions) {
    for (const expr of term.matchExpressions) {
      if (!matchesRequirement(nodeLabels[expr.key], expr)) {
        return false;
      }
    }
  }

  // Match fields are typically for node fields, not labels
  // For simplicity, we treat them the same as labels here
  if (term.matchFields) {
    for (const field of term.matchFields) {
      if (!matchesRequirement(nodeLabels[field.key], field)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Calculate affinity score for a node
 * Higher score = more preferred
 */
export function calculateAffinityScore(
  nodeLabels: Record<string, string>,
  affinity: NodeAffinity,
): number {
  let score = 0;

  // Check required terms first
  if (affinity.requiredDuringSchedulingIgnoredDuringExecution) {
    const terms = affinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms;
    const anyMatches = terms.some(term => matchesNodeSelectorTerm(nodeLabels, term));
    if (!anyMatches) {
      return -1; // Node doesn't meet required criteria
    }
  }

  // Calculate preferred score
  if (affinity.preferredDuringSchedulingIgnoredDuringExecution) {
    for (const pref of affinity.preferredDuringSchedulingIgnoredDuringExecution) {
      if (matchesNodeSelectorTerm(nodeLabels, pref.preference)) {
        score += pref.weight;
      }
    }
  }

  return score;
}

/**
 * All scheduling policies
 */
export const ALL_SCHEDULING_POLICIES: readonly SchedulingPolicy[] = [
  'spread',
  'binpack',
  'random',
  'affinity',
  'least_loaded',
] as const;
