/**
 * Labels, Annotations, and LabelSelector types (Kubernetes-like)
 * @module @stark-o/shared/types/labels
 */

/**
 * Labels are key-value pairs used for organization and selection
 * Keys and values must be strings
 * 
 * @example
 * {
 *   "app": "frontend",
 *   "environment": "production",
 *   "version": "v1.2.3"
 * }
 */
export type Labels = Record<string, string>;

/**
 * Annotations are key-value pairs for non-identifying metadata
 * Used for tooling, documentation, and integrations
 * 
 * @example
 * {
 *   "description": "Main frontend application",
 *   "owner": "team-frontend",
 *   "docs-url": "https://docs.example.com/frontend"
 * }
 */
export type Annotations = Record<string, string>;

/**
 * Label selector operator for match expressions
 */
export type LabelSelectorOperator = 'In' | 'NotIn' | 'Exists' | 'DoesNotExist';

/**
 * Match expression for advanced label selection
 * 
 * @example
 * // In: key must have one of these values
 * { key: "environment", operator: "In", values: ["production", "staging"] }
 * 
 * // NotIn: key must not have these values
 * { key: "environment", operator: "NotIn", values: ["development"] }
 * 
 * // Exists: key must exist (value doesn't matter)
 * { key: "gpu", operator: "Exists" }
 * 
 * // DoesNotExist: key must not exist
 * { key: "deprecated", operator: "DoesNotExist" }
 */
export interface LabelSelectorMatchExpression {
  /** Label key to match */
  key: string;
  /** Operator for comparison */
  operator: LabelSelectorOperator;
  /** Values to match (required for In/NotIn, ignored for Exists/DoesNotExist) */
  values?: string[];
}

/**
 * Label selector for querying resources
 * 
 * @example
 * {
 *   matchLabels: { "app": "frontend" },
 *   matchExpressions: [
 *     { key: "environment", operator: "In", values: ["production", "staging"] }
 *   ]
 * }
 */
export interface LabelSelector {
  /** Simple key-value matching (all must match) */
  matchLabels?: Labels;
  /** Advanced expression matching (all must match) */
  matchExpressions?: LabelSelectorMatchExpression[];
}

/**
 * Check if a match expression matches a set of labels
 */
export function matchesExpression(
  labels: Labels,
  expr: LabelSelectorMatchExpression,
): boolean {
  const value = labels[expr.key];
  const hasKey = expr.key in labels;

  switch (expr.operator) {
    case 'In':
      return hasKey && value !== undefined && (expr.values?.includes(value) ?? false);
    case 'NotIn':
      return !hasKey || value === undefined || !(expr.values?.includes(value) ?? false);
    case 'Exists':
      return hasKey;
    case 'DoesNotExist':
      return !hasKey;
    default:
      return false;
  }
}

/**
 * Check if labels match a label selector
 */
export function matchesSelector(labels: Labels, selector: LabelSelector): boolean {
  // Check matchLabels
  if (selector.matchLabels) {
    for (const [key, value] of Object.entries(selector.matchLabels)) {
      if (labels[key] !== value) {
        return false;
      }
    }
  }

  // Check matchExpressions
  if (selector.matchExpressions) {
    for (const expr of selector.matchExpressions) {
      if (!matchesExpression(labels, expr)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if labels match simple key-value requirements
 */
export function matchesLabels(labels: Labels, required: Labels): boolean {
  for (const [key, value] of Object.entries(required)) {
    if (labels[key] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Merge labels (later values override earlier)
 */
export function mergeLabels(...labelSets: (Labels | undefined)[]): Labels {
  const result: Labels = {};
  for (const labels of labelSets) {
    if (labels) {
      Object.assign(result, labels);
    }
  }
  return result;
}

/**
 * Create a label selector from simple labels
 */
export function createSelector(matchLabels: Labels): LabelSelector {
  return { matchLabels };
}

/**
 * Validate a label key
 * - Must be non-empty
 * - Must start with alphanumeric
 * - Can contain alphanumeric, dash, underscore, dot
 * - Optional prefix (DNS subdomain) followed by /
 */
export function isValidLabelKey(key: string): boolean {
  if (!key || key.length > 253) {
    return false;
  }

  // Check for prefix
  const parts = key.split('/');
  if (parts.length > 2) {
    return false;
  }

  const name = parts.length === 2 ? parts[1] : parts[0];
  
  // Name must be 1-63 characters
  if (!name || name.length > 63) {
    return false;
  }

  // Must start and end with alphanumeric
  if (!/^[a-zA-Z0-9]/.test(name) || !/[a-zA-Z0-9]$/.test(name)) {
    return false;
  }

  // Can only contain alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9._-]*$/.test(name)) {
    return false;
  }

  return true;
}

/**
 * Validate a label value
 * - Can be empty
 * - Must be 63 characters or less
 * - If non-empty, must start and end with alphanumeric
 * - Can contain alphanumeric, dash, underscore, dot
 */
export function isValidLabelValue(value: string): boolean {
  if (value.length > 63) {
    return false;
  }

  if (value === '') {
    return true;
  }

  // Must start and end with alphanumeric
  if (!/^[a-zA-Z0-9]/.test(value) || !/[a-zA-Z0-9]$/.test(value)) {
    return false;
  }

  // Can only contain alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9._-]*$/.test(value)) {
    return false;
  }

  return true;
}

/**
 * Validate all labels in a set
 */
export function validateLabels(labels: Labels): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const [key, value] of Object.entries(labels)) {
    if (!isValidLabelKey(key)) {
      errors.push(`Invalid label key: "${key}"`);
    }
    if (!isValidLabelValue(value)) {
      errors.push(`Invalid label value for key "${key}": "${value}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
