/**
 * Namespace creation/update validation (Kubernetes-like)
 * @module @stark-o/shared/validation/namespace-validation
 */

import type {
  LimitRange,
} from '../types/namespace';
import type { ValidationResult, ValidationError } from './pack-validation';
import { validateLabels, validateAnnotations } from './node-validation';

/**
 * Namespace name pattern: lowercase, alphanumeric, hyphens, 1-63 chars
 */
const NAMESPACE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Reserved namespace names that cannot be created by users
 */
export const RESERVED_NAMESPACE_NAMES = ['default', 'stark-system', 'stark-public'] as const;

/**
 * Validate namespace name
 */
export function validateNamespaceName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return {
      field: 'name',
      message: 'Namespace name is required',
      code: 'REQUIRED',
    };
  }

  if (typeof name !== 'string') {
    return {
      field: 'name',
      message: 'Namespace name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (name.length === 0) {
    return {
      field: 'name',
      message: 'Namespace name cannot be empty',
      code: 'EMPTY',
    };
  }

  if (name.length > 63) {
    return {
      field: 'name',
      message: 'Namespace name cannot exceed 63 characters',
      code: 'TOO_LONG',
    };
  }

  if (!NAMESPACE_NAME_PATTERN.test(name)) {
    return {
      field: 'name',
      message:
        'Namespace name must start with a lowercase letter and contain only lowercase alphanumeric characters and hyphens',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Check if namespace name is reserved
 */
export function isReservedNamespaceName(name: string): boolean {
  return (RESERVED_NAMESPACE_NAMES as readonly string[]).includes(name);
}

/**
 * Validate resource quota hard limits
 */
export function validateResourceQuotaHard(
  hard: unknown,
  fieldPrefix = 'resourceQuota.hard',
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (hard === undefined || hard === null) {
    return errors; // Optional
  }

  if (typeof hard !== 'object' || Array.isArray(hard)) {
    errors.push({
      field: fieldPrefix,
      message: 'Resource quota hard limits must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const h = hard as Record<string, unknown>;

  if (h.pods !== undefined) {
    if (typeof h.pods !== 'number' || !Number.isInteger(h.pods) || h.pods < 0) {
      errors.push({
        field: `${fieldPrefix}.pods`,
        message: 'Pods limit must be a non-negative integer',
        code: 'INVALID_VALUE',
      });
    }
  }

  if (h.cpu !== undefined) {
    if (typeof h.cpu !== 'number' || h.cpu < 0) {
      errors.push({
        field: `${fieldPrefix}.cpu`,
        message: 'CPU limit must be a non-negative number',
        code: 'INVALID_VALUE',
      });
    }
  }

  if (h.memory !== undefined) {
    if (typeof h.memory !== 'number' || h.memory < 0) {
      errors.push({
        field: `${fieldPrefix}.memory`,
        message: 'Memory limit must be a non-negative number',
        code: 'INVALID_VALUE',
      });
    }
  }

  if (h.storage !== undefined) {
    if (typeof h.storage !== 'number' || h.storage < 0) {
      errors.push({
        field: `${fieldPrefix}.storage`,
        message: 'Storage limit must be a non-negative number',
        code: 'INVALID_VALUE',
      });
    }
  }

  return errors;
}

/**
 * Validate resource quota
 */
export function validateResourceQuota(quota: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (quota === undefined || quota === null) {
    return errors; // Optional
  }

  if (typeof quota !== 'object' || Array.isArray(quota)) {
    errors.push({
      field: 'resourceQuota',
      message: 'Resource quota must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const q = quota as Record<string, unknown>;

  // Hard limits are required if quota is specified
  if (q.hard === undefined || q.hard === null) {
    errors.push({
      field: 'resourceQuota.hard',
      message: 'Resource quota hard limits are required',
      code: 'REQUIRED',
    });
    return errors;
  }

  errors.push(...validateResourceQuotaHard(q.hard));

  return errors;
}

/**
 * Validate resource limit value (cpu/memory)
 */
export function validateResourceLimitValue(
  value: unknown,
  fieldName: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (value === undefined || value === null) {
    return errors; // Optional
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push({
      field: fieldName,
      message: `${fieldName} must be an object`,
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const v = value as Record<string, unknown>;

  if (v.cpu !== undefined) {
    if (typeof v.cpu !== 'number' || v.cpu < 0) {
      errors.push({
        field: `${fieldName}.cpu`,
        message: 'CPU must be a non-negative number',
        code: 'INVALID_VALUE',
      });
    }
  }

  if (v.memory !== undefined) {
    if (typeof v.memory !== 'number' || v.memory < 0) {
      errors.push({
        field: `${fieldName}.memory`,
        message: 'Memory must be a non-negative number',
        code: 'INVALID_VALUE',
      });
    }
  }

  return errors;
}

/**
 * Validate limit range
 */
export function validateLimitRange(limitRange: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (limitRange === undefined || limitRange === null) {
    return errors; // Optional
  }

  if (typeof limitRange !== 'object' || Array.isArray(limitRange)) {
    errors.push({
      field: 'limitRange',
      message: 'Limit range must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const lr = limitRange as Record<string, unknown>;

  errors.push(...validateResourceLimitValue(lr.default, 'limitRange.default'));
  errors.push(...validateResourceLimitValue(lr.defaultRequest, 'limitRange.defaultRequest'));
  errors.push(...validateResourceLimitValue(lr.max, 'limitRange.max'));
  errors.push(...validateResourceLimitValue(lr.min, 'limitRange.min'));

  // Validate that min <= max if both are specified
  if (lr.min && lr.max) {
    const min = lr.min as Record<string, number>;
    const max = lr.max as Record<string, number>;

    if (min.cpu !== undefined && max.cpu !== undefined && min.cpu > max.cpu) {
      errors.push({
        field: 'limitRange.min.cpu',
        message: 'Minimum CPU cannot exceed maximum CPU',
        code: 'INVALID_RANGE',
      });
    }

    if (min.memory !== undefined && max.memory !== undefined && min.memory > max.memory) {
      errors.push({
        field: 'limitRange.min.memory',
        message: 'Minimum memory cannot exceed maximum memory',
        code: 'INVALID_RANGE',
      });
    }
  }

  // Validate that defaultRequest <= default (limits) if both are specified
  if (lr.defaultRequest && lr.default) {
    const request = lr.defaultRequest as Record<string, number>;
    const limit = lr.default as Record<string, number>;

    if (request.cpu !== undefined && limit.cpu !== undefined && request.cpu > limit.cpu) {
      errors.push({
        field: 'limitRange.defaultRequest.cpu',
        message: 'Default CPU request cannot exceed default CPU limit',
        code: 'INVALID_RANGE',
      });
    }

    if (request.memory !== undefined && limit.memory !== undefined && request.memory > limit.memory) {
      errors.push({
        field: 'limitRange.defaultRequest.memory',
        message: 'Default memory request cannot exceed default memory limit',
        code: 'INVALID_RANGE',
      });
    }
  }

  return errors;
}

/**
 * Validate namespace creation input
 */
export function validateCreateNamespaceInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (input === undefined || input === null) {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input is required', code: 'REQUIRED' }],
    };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as Record<string, unknown>;

  // Validate required fields
  const nameError = validateNamespaceName(data.name);
  if (nameError) errors.push(nameError);

  // Check for reserved names
  if (typeof data.name === 'string' && isReservedNamespaceName(data.name)) {
    errors.push({
      field: 'name',
      message: `Namespace name '${data.name}' is reserved`,
      code: 'RESERVED',
    });
  }

  // Validate optional fields
  errors.push(...validateLabels(data.labels));
  errors.push(...validateAnnotations(data.annotations));
  errors.push(...validateResourceQuota(data.resourceQuota));
  errors.push(...validateLimitRange(data.limitRange));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate namespace update input
 */
export function validateUpdateNamespaceInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (input === undefined || input === null) {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input is required', code: 'REQUIRED' }],
    };
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as Record<string, unknown>;

  // All fields are optional for update
  errors.push(...validateLabels(data.labels));
  errors.push(...validateAnnotations(data.annotations));
  errors.push(...validateResourceQuota(data.resourceQuota));
  errors.push(...validateLimitRange(data.limitRange));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that pod resources fit within namespace limits
 */
export function validatePodFitsNamespaceLimits(
  podCpu: number,
  podMemory: number,
  limitRange: LimitRange | undefined,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!limitRange) {
    return errors;
  }

  // Check against max
  if (limitRange.max) {
    if (limitRange.max.cpu !== undefined && podCpu > limitRange.max.cpu) {
      errors.push({
        field: 'resourceLimits.cpu',
        message: `Pod CPU limit ${podCpu} exceeds namespace maximum ${limitRange.max.cpu}`,
        code: 'EXCEEDS_NAMESPACE_LIMIT',
      });
    }

    if (limitRange.max.memory !== undefined && podMemory > limitRange.max.memory) {
      errors.push({
        field: 'resourceLimits.memory',
        message: `Pod memory limit ${podMemory} exceeds namespace maximum ${limitRange.max.memory}`,
        code: 'EXCEEDS_NAMESPACE_LIMIT',
      });
    }
  }

  // Check against min
  if (limitRange.min) {
    if (limitRange.min.cpu !== undefined && podCpu < limitRange.min.cpu) {
      errors.push({
        field: 'resourceLimits.cpu',
        message: `Pod CPU limit ${podCpu} is below namespace minimum ${limitRange.min.cpu}`,
        code: 'BELOW_NAMESPACE_MINIMUM',
      });
    }

    if (limitRange.min.memory !== undefined && podMemory < limitRange.min.memory) {
      errors.push({
        field: 'resourceLimits.memory',
        message: `Pod memory limit ${podMemory} is below namespace minimum ${limitRange.min.memory}`,
        code: 'BELOW_NAMESPACE_MINIMUM',
      });
    }
  }

  return errors;
}
