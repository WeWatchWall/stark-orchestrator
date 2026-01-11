/**
 * Scheduling config, affinity, and toleration validation (Kubernetes-like)
 * @module @stark-o/shared/validation/scheduling-validation
 */

import type { ValidationResult, ValidationError } from './pack-validation';

/**
 * Valid node selector operators
 */
const VALID_NODE_SELECTOR_OPERATORS = ['In', 'NotIn', 'Exists', 'DoesNotExist', 'Gt', 'Lt'] as const;

/**
 * Valid label selector operators
 */
const VALID_LABEL_SELECTOR_OPERATORS = ['In', 'NotIn', 'Exists', 'DoesNotExist'] as const;

/**
 * Label key pattern
 */
const LABEL_KEY_PATTERN = /^([a-zA-Z0-9][-a-zA-Z0-9_.]*\/)?[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

/**
 * Maximum weight value
 */
const MAX_WEIGHT = 100;
const MIN_WEIGHT = 1;

/**
 * Validate node selector requirement
 */
export function validateNodeSelectorRequirement(
  req: unknown,
  fieldPrefix: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof req !== 'object' || req === null || Array.isArray(req)) {
    errors.push({
      field: fieldPrefix,
      message: 'Node selector requirement must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const r = req as Record<string, unknown>;

  // Key is required
  if (!r.key || typeof r.key !== 'string') {
    errors.push({
      field: `${fieldPrefix}.key`,
      message: 'Key is required and must be a string',
      code: 'REQUIRED',
    });
  } else if (!LABEL_KEY_PATTERN.test(r.key)) {
    errors.push({
      field: `${fieldPrefix}.key`,
      message: `Invalid key format: ${r.key}`,
      code: 'INVALID_FORMAT',
    });
  }

  // Operator is required
  if (!r.operator || typeof r.operator !== 'string') {
    errors.push({
      field: `${fieldPrefix}.operator`,
      message: 'Operator is required and must be a string',
      code: 'REQUIRED',
    });
  } else if (!VALID_NODE_SELECTOR_OPERATORS.includes(r.operator as typeof VALID_NODE_SELECTOR_OPERATORS[number])) {
    errors.push({
      field: `${fieldPrefix}.operator`,
      message: `Operator must be one of: ${VALID_NODE_SELECTOR_OPERATORS.join(', ')}`,
      code: 'INVALID_VALUE',
    });
  }

  // Values validation
  if (r.values !== undefined && r.values !== null) {
    if (!Array.isArray(r.values)) {
      errors.push({
        field: `${fieldPrefix}.values`,
        message: 'Values must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < r.values.length; i++) {
        if (typeof r.values[i] !== 'string') {
          errors.push({
            field: `${fieldPrefix}.values[${i}]`,
            message: 'Value must be a string',
            code: 'INVALID_TYPE',
          });
        }
      }
    }
  }

  // Values required for In/NotIn, not allowed for Exists/DoesNotExist
  const operator = r.operator as string;
  if (operator === 'In' || operator === 'NotIn') {
    if (!r.values || !Array.isArray(r.values) || r.values.length === 0) {
      errors.push({
        field: `${fieldPrefix}.values`,
        message: `Values array is required for operator ${operator}`,
        code: 'REQUIRED',
      });
    }
  } else if (operator === 'Exists' || operator === 'DoesNotExist') {
    if (r.values && Array.isArray(r.values) && r.values.length > 0) {
      errors.push({
        field: `${fieldPrefix}.values`,
        message: `Values must not be specified for operator ${operator}`,
        code: 'NOT_ALLOWED',
      });
    }
  }

  return errors;
}

/**
 * Validate node selector term
 */
export function validateNodeSelectorTerm(
  term: unknown,
  fieldPrefix: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof term !== 'object' || term === null || Array.isArray(term)) {
    errors.push({
      field: fieldPrefix,
      message: 'Node selector term must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const t = term as Record<string, unknown>;

  // At least matchExpressions or matchFields must be specified
  if (!t.matchExpressions && !t.matchFields) {
    errors.push({
      field: fieldPrefix,
      message: 'At least one of matchExpressions or matchFields must be specified',
      code: 'REQUIRED',
    });
    return errors;
  }

  if (t.matchExpressions) {
    if (!Array.isArray(t.matchExpressions)) {
      errors.push({
        field: `${fieldPrefix}.matchExpressions`,
        message: 'matchExpressions must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < t.matchExpressions.length; i++) {
        errors.push(
          ...validateNodeSelectorRequirement(
            t.matchExpressions[i],
            `${fieldPrefix}.matchExpressions[${i}]`,
          ),
        );
      }
    }
  }

  if (t.matchFields) {
    if (!Array.isArray(t.matchFields)) {
      errors.push({
        field: `${fieldPrefix}.matchFields`,
        message: 'matchFields must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < t.matchFields.length; i++) {
        errors.push(
          ...validateNodeSelectorRequirement(
            t.matchFields[i],
            `${fieldPrefix}.matchFields[${i}]`,
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate preferred scheduling term
 */
export function validatePreferredSchedulingTerm(
  term: unknown,
  fieldPrefix: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof term !== 'object' || term === null || Array.isArray(term)) {
    errors.push({
      field: fieldPrefix,
      message: 'Preferred scheduling term must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const t = term as Record<string, unknown>;

  // Weight is required
  if (t.weight === undefined || t.weight === null) {
    errors.push({
      field: `${fieldPrefix}.weight`,
      message: 'Weight is required',
      code: 'REQUIRED',
    });
  } else if (typeof t.weight !== 'number' || !Number.isInteger(t.weight)) {
    errors.push({
      field: `${fieldPrefix}.weight`,
      message: 'Weight must be an integer',
      code: 'INVALID_TYPE',
    });
  } else if (t.weight < MIN_WEIGHT || t.weight > MAX_WEIGHT) {
    errors.push({
      field: `${fieldPrefix}.weight`,
      message: `Weight must be between ${MIN_WEIGHT} and ${MAX_WEIGHT}`,
      code: 'OUT_OF_RANGE',
    });
  }

  // Preference is required
  if (!t.preference) {
    errors.push({
      field: `${fieldPrefix}.preference`,
      message: 'Preference is required',
      code: 'REQUIRED',
    });
  } else {
    errors.push(...validateNodeSelectorTerm(t.preference, `${fieldPrefix}.preference`));
  }

  return errors;
}

/**
 * Validate node affinity
 */
export function validateNodeAffinity(affinity: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldPrefix = 'nodeAffinity';

  if (affinity === undefined || affinity === null) {
    return errors; // Optional
  }

  if (typeof affinity !== 'object' || Array.isArray(affinity)) {
    errors.push({
      field: fieldPrefix,
      message: 'Node affinity must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const a = affinity as Record<string, unknown>;

  // Validate required scheduling
  if (a.requiredDuringSchedulingIgnoredDuringExecution) {
    const req = a.requiredDuringSchedulingIgnoredDuringExecution as Record<string, unknown>;
    if (!req.nodeSelectorTerms || !Array.isArray(req.nodeSelectorTerms)) {
      errors.push({
        field: `${fieldPrefix}.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms`,
        message: 'nodeSelectorTerms is required and must be an array',
        code: 'REQUIRED',
      });
    } else if (req.nodeSelectorTerms.length === 0) {
      errors.push({
        field: `${fieldPrefix}.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms`,
        message: 'nodeSelectorTerms cannot be empty',
        code: 'EMPTY',
      });
    } else {
      for (let i = 0; i < req.nodeSelectorTerms.length; i++) {
        errors.push(
          ...validateNodeSelectorTerm(
            req.nodeSelectorTerms[i],
            `${fieldPrefix}.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms[${i}]`,
          ),
        );
      }
    }
  }

  // Validate preferred scheduling
  if (a.preferredDuringSchedulingIgnoredDuringExecution) {
    if (!Array.isArray(a.preferredDuringSchedulingIgnoredDuringExecution)) {
      errors.push({
        field: `${fieldPrefix}.preferredDuringSchedulingIgnoredDuringExecution`,
        message: 'preferredDuringSchedulingIgnoredDuringExecution must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < a.preferredDuringSchedulingIgnoredDuringExecution.length; i++) {
        errors.push(
          ...validatePreferredSchedulingTerm(
            a.preferredDuringSchedulingIgnoredDuringExecution[i],
            `${fieldPrefix}.preferredDuringSchedulingIgnoredDuringExecution[${i}]`,
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate label selector
 */
export function validateLabelSelector(
  selector: unknown,
  fieldPrefix: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (selector === undefined || selector === null) {
    return errors; // Optional
  }

  if (typeof selector !== 'object' || Array.isArray(selector)) {
    errors.push({
      field: fieldPrefix,
      message: 'Label selector must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const s = selector as Record<string, unknown>;

  // Validate matchLabels
  if (s.matchLabels !== undefined && s.matchLabels !== null) {
    if (typeof s.matchLabels !== 'object' || Array.isArray(s.matchLabels)) {
      errors.push({
        field: `${fieldPrefix}.matchLabels`,
        message: 'matchLabels must be an object',
        code: 'INVALID_TYPE',
      });
    } else {
      for (const [key, value] of Object.entries(s.matchLabels as Record<string, unknown>)) {
        if (!LABEL_KEY_PATTERN.test(key)) {
          errors.push({
            field: `${fieldPrefix}.matchLabels.${key}`,
            message: `Invalid label key format: ${key}`,
            code: 'INVALID_FORMAT',
          });
        }
        if (typeof value !== 'string') {
          errors.push({
            field: `${fieldPrefix}.matchLabels.${key}`,
            message: 'Label value must be a string',
            code: 'INVALID_TYPE',
          });
        }
      }
    }
  }

  // Validate matchExpressions
  if (s.matchExpressions !== undefined && s.matchExpressions !== null) {
    if (!Array.isArray(s.matchExpressions)) {
      errors.push({
        field: `${fieldPrefix}.matchExpressions`,
        message: 'matchExpressions must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < s.matchExpressions.length; i++) {
        const expr = s.matchExpressions[i] as Record<string, unknown>;
        const exprPrefix = `${fieldPrefix}.matchExpressions[${i}]`;

        if (typeof expr !== 'object' || expr === null) {
          errors.push({
            field: exprPrefix,
            message: 'Match expression must be an object',
            code: 'INVALID_TYPE',
          });
          continue;
        }

        if (!expr.key || typeof expr.key !== 'string') {
          errors.push({
            field: `${exprPrefix}.key`,
            message: 'Key is required',
            code: 'REQUIRED',
          });
        }

        if (!expr.operator || typeof expr.operator !== 'string') {
          errors.push({
            field: `${exprPrefix}.operator`,
            message: 'Operator is required',
            code: 'REQUIRED',
          });
        } else if (
          !VALID_LABEL_SELECTOR_OPERATORS.includes(
            expr.operator as typeof VALID_LABEL_SELECTOR_OPERATORS[number],
          )
        ) {
          errors.push({
            field: `${exprPrefix}.operator`,
            message: `Operator must be one of: ${VALID_LABEL_SELECTOR_OPERATORS.join(', ')}`,
            code: 'INVALID_VALUE',
          });
        }

        if (expr.values !== undefined && expr.values !== null && !Array.isArray(expr.values)) {
          errors.push({
            field: `${exprPrefix}.values`,
            message: 'Values must be an array',
            code: 'INVALID_TYPE',
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validate pod affinity term
 */
export function validatePodAffinityTerm(
  term: unknown,
  fieldPrefix: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof term !== 'object' || term === null || Array.isArray(term)) {
    errors.push({
      field: fieldPrefix,
      message: 'Pod affinity term must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const t = term as Record<string, unknown>;

  // topologyKey is required
  if (!t.topologyKey || typeof t.topologyKey !== 'string') {
    errors.push({
      field: `${fieldPrefix}.topologyKey`,
      message: 'topologyKey is required and must be a string',
      code: 'REQUIRED',
    });
  }

  // Validate labelSelector
  if (t.labelSelector) {
    errors.push(...validateLabelSelector(t.labelSelector, `${fieldPrefix}.labelSelector`));
  }

  // Validate namespaces
  if (t.namespaces !== undefined && t.namespaces !== null) {
    if (!Array.isArray(t.namespaces)) {
      errors.push({
        field: `${fieldPrefix}.namespaces`,
        message: 'Namespaces must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < t.namespaces.length; i++) {
        if (typeof t.namespaces[i] !== 'string') {
          errors.push({
            field: `${fieldPrefix}.namespaces[${i}]`,
            message: 'Namespace must be a string',
            code: 'INVALID_TYPE',
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Validate weighted pod affinity term
 */
export function validateWeightedPodAffinityTerm(
  term: unknown,
  fieldPrefix: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof term !== 'object' || term === null || Array.isArray(term)) {
    errors.push({
      field: fieldPrefix,
      message: 'Weighted pod affinity term must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const t = term as Record<string, unknown>;

  // Weight is required
  if (t.weight === undefined || t.weight === null) {
    errors.push({
      field: `${fieldPrefix}.weight`,
      message: 'Weight is required',
      code: 'REQUIRED',
    });
  } else if (typeof t.weight !== 'number' || !Number.isInteger(t.weight)) {
    errors.push({
      field: `${fieldPrefix}.weight`,
      message: 'Weight must be an integer',
      code: 'INVALID_TYPE',
    });
  } else if (t.weight < MIN_WEIGHT || t.weight > MAX_WEIGHT) {
    errors.push({
      field: `${fieldPrefix}.weight`,
      message: `Weight must be between ${MIN_WEIGHT} and ${MAX_WEIGHT}`,
      code: 'OUT_OF_RANGE',
    });
  }

  // podAffinityTerm is required
  if (!t.podAffinityTerm) {
    errors.push({
      field: `${fieldPrefix}.podAffinityTerm`,
      message: 'podAffinityTerm is required',
      code: 'REQUIRED',
    });
  } else {
    errors.push(...validatePodAffinityTerm(t.podAffinityTerm, `${fieldPrefix}.podAffinityTerm`));
  }

  return errors;
}

/**
 * Validate pod affinity
 */
export function validatePodAffinity(affinity: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldPrefix = 'podAffinity';

  if (affinity === undefined || affinity === null) {
    return errors; // Optional
  }

  if (typeof affinity !== 'object' || Array.isArray(affinity)) {
    errors.push({
      field: fieldPrefix,
      message: 'Pod affinity must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const a = affinity as Record<string, unknown>;

  // Validate required scheduling
  if (a.requiredDuringSchedulingIgnoredDuringExecution) {
    if (!Array.isArray(a.requiredDuringSchedulingIgnoredDuringExecution)) {
      errors.push({
        field: `${fieldPrefix}.requiredDuringSchedulingIgnoredDuringExecution`,
        message: 'requiredDuringSchedulingIgnoredDuringExecution must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < a.requiredDuringSchedulingIgnoredDuringExecution.length; i++) {
        errors.push(
          ...validatePodAffinityTerm(
            a.requiredDuringSchedulingIgnoredDuringExecution[i],
            `${fieldPrefix}.requiredDuringSchedulingIgnoredDuringExecution[${i}]`,
          ),
        );
      }
    }
  }

  // Validate preferred scheduling
  if (a.preferredDuringSchedulingIgnoredDuringExecution) {
    if (!Array.isArray(a.preferredDuringSchedulingIgnoredDuringExecution)) {
      errors.push({
        field: `${fieldPrefix}.preferredDuringSchedulingIgnoredDuringExecution`,
        message: 'preferredDuringSchedulingIgnoredDuringExecution must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < a.preferredDuringSchedulingIgnoredDuringExecution.length; i++) {
        errors.push(
          ...validateWeightedPodAffinityTerm(
            a.preferredDuringSchedulingIgnoredDuringExecution[i],
            `${fieldPrefix}.preferredDuringSchedulingIgnoredDuringExecution[${i}]`,
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate pod anti-affinity
 */
export function validatePodAntiAffinity(affinity: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldPrefix = 'podAntiAffinity';

  if (affinity === undefined || affinity === null) {
    return errors; // Optional
  }

  if (typeof affinity !== 'object' || Array.isArray(affinity)) {
    errors.push({
      field: fieldPrefix,
      message: 'Pod anti-affinity must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const a = affinity as Record<string, unknown>;

  // Same structure as pod affinity
  if (a.requiredDuringSchedulingIgnoredDuringExecution) {
    if (!Array.isArray(a.requiredDuringSchedulingIgnoredDuringExecution)) {
      errors.push({
        field: `${fieldPrefix}.requiredDuringSchedulingIgnoredDuringExecution`,
        message: 'requiredDuringSchedulingIgnoredDuringExecution must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < a.requiredDuringSchedulingIgnoredDuringExecution.length; i++) {
        errors.push(
          ...validatePodAffinityTerm(
            a.requiredDuringSchedulingIgnoredDuringExecution[i],
            `${fieldPrefix}.requiredDuringSchedulingIgnoredDuringExecution[${i}]`,
          ),
        );
      }
    }
  }

  if (a.preferredDuringSchedulingIgnoredDuringExecution) {
    if (!Array.isArray(a.preferredDuringSchedulingIgnoredDuringExecution)) {
      errors.push({
        field: `${fieldPrefix}.preferredDuringSchedulingIgnoredDuringExecution`,
        message: 'preferredDuringSchedulingIgnoredDuringExecution must be an array',
        code: 'INVALID_TYPE',
      });
    } else {
      for (let i = 0; i < a.preferredDuringSchedulingIgnoredDuringExecution.length; i++) {
        errors.push(
          ...validateWeightedPodAffinityTerm(
            a.preferredDuringSchedulingIgnoredDuringExecution[i],
            `${fieldPrefix}.preferredDuringSchedulingIgnoredDuringExecution[${i}]`,
          ),
        );
      }
    }
  }

  return errors;
}

/**
 * Validate scheduling configuration
 */
export function validateSchedulingConfig(config: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (config === undefined || config === null) {
    return { valid: true, errors: [] }; // Optional
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    return {
      valid: false,
      errors: [
        { field: 'scheduling', message: 'Scheduling config must be an object', code: 'INVALID_TYPE' },
      ],
    };
  }

  const c = config as Record<string, unknown>;

  // Validate nodeSelector
  if (c.nodeSelector !== undefined && c.nodeSelector !== null) {
    if (typeof c.nodeSelector !== 'object' || Array.isArray(c.nodeSelector)) {
      errors.push({
        field: 'scheduling.nodeSelector',
        message: 'nodeSelector must be an object',
        code: 'INVALID_TYPE',
      });
    } else {
      for (const [key, value] of Object.entries(c.nodeSelector as Record<string, unknown>)) {
        if (!LABEL_KEY_PATTERN.test(key)) {
          errors.push({
            field: `scheduling.nodeSelector.${key}`,
            message: `Invalid label key format: ${key}`,
            code: 'INVALID_FORMAT',
          });
        }
        if (typeof value !== 'string') {
          errors.push({
            field: `scheduling.nodeSelector.${key}`,
            message: 'Label value must be a string',
            code: 'INVALID_TYPE',
          });
        }
      }
    }
  }

  // Validate affinities
  errors.push(...validateNodeAffinity(c.nodeAffinity));
  errors.push(...validatePodAffinity(c.podAffinity));
  errors.push(...validatePodAntiAffinity(c.podAntiAffinity));

  // Validate schedulerName
  if (c.schedulerName !== undefined && c.schedulerName !== null) {
    if (typeof c.schedulerName !== 'string') {
      errors.push({
        field: 'scheduling.schedulerName',
        message: 'Scheduler name must be a string',
        code: 'INVALID_TYPE',
      });
    }
  }

  // Validate priorityClassName
  if (c.priorityClassName !== undefined && c.priorityClassName !== null) {
    if (typeof c.priorityClassName !== 'string') {
      errors.push({
        field: 'scheduling.priorityClassName',
        message: 'Priority class name must be a string',
        code: 'INVALID_TYPE',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
