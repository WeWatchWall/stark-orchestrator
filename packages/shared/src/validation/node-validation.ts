/**
 * Node registration validation
 * @module @stark-o/shared/validation/node-validation
 */

import type { RuntimeType } from '../types/node';
import type { ValidationResult, ValidationError } from './pack-validation';

/**
 * Valid runtime types
 */
const VALID_RUNTIME_TYPES: RuntimeType[] = ['node', 'browser'];

/**
 * Node name pattern: must start with a letter, end with alphanumeric,
 * and contain only alphanumeric characters, hyphens, and underscores.
 * Single character names are allowed (just a letter).
 * Length: 1-253 chars
 */
const NODE_NAME_PATTERN = /^[a-zA-Z]([a-zA-Z0-9_-]{0,251}[a-zA-Z0-9])?$/;

/**
 * Maximum labels/annotations
 */
const MAX_LABELS = 100;
const MAX_ANNOTATIONS = 100;
const MAX_TAINTS = 50;

/**
 * Label key pattern
 */
const LABEL_KEY_PATTERN = /^([a-zA-Z0-9][-a-zA-Z0-9_.]*\/)?[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

/**
 * Label value max length
 */
const MAX_LABEL_VALUE_LENGTH = 63;

/**
 * Validate node name
 */
export function validateNodeName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return {
      field: 'name',
      message: 'Node name is required',
      code: 'REQUIRED',
    };
  }

  if (typeof name !== 'string') {
    return {
      field: 'name',
      message: 'Node name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (name.length === 0) {
    return {
      field: 'name',
      message: 'Node name cannot be empty',
      code: 'EMPTY',
    };
  }

  if (name.length > 253) {
    return {
      field: 'name',
      message: 'Node name cannot exceed 253 characters',
      code: 'TOO_LONG',
    };
  }

  if (!NODE_NAME_PATTERN.test(name)) {
    return {
      field: 'name',
      message:
        'Node name must start with a letter and contain only alphanumeric characters, hyphens, and underscores',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate runtime type
 */
export function validateRuntimeType(runtimeType: unknown): ValidationError | null {
  if (runtimeType === undefined || runtimeType === null) {
    return {
      field: 'runtimeType',
      message: 'Runtime type is required',
      code: 'REQUIRED',
    };
  }

  if (typeof runtimeType !== 'string') {
    return {
      field: 'runtimeType',
      message: 'Runtime type must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_RUNTIME_TYPES.includes(runtimeType as RuntimeType)) {
    return {
      field: 'runtimeType',
      message: `Runtime type must be one of: ${VALID_RUNTIME_TYPES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate node capabilities
 */
export function validateNodeCapabilities(capabilities: unknown): ValidationError | null {
  if (capabilities === undefined || capabilities === null) {
    return null; // Optional field
  }

  if (typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    return {
      field: 'capabilities',
      message: 'Node capabilities must be an object',
      code: 'INVALID_TYPE',
    };
  }

  return null;
}

/**
 * Validate a single label key-value pair
 */
export function validateLabelEntry(
  key: string,
  value: string,
  fieldPrefix: string,
): ValidationError | null {
  if (!LABEL_KEY_PATTERN.test(key)) {
    return {
      field: `${fieldPrefix}.${key}`,
      message: `Invalid label key format: ${key}`,
      code: 'INVALID_KEY_FORMAT',
    };
  }

  if (key.length > 253) {
    return {
      field: `${fieldPrefix}.${key}`,
      message: `Label key cannot exceed 253 characters`,
      code: 'KEY_TOO_LONG',
    };
  }

  if (typeof value !== 'string') {
    return {
      field: `${fieldPrefix}.${key}`,
      message: `Label value must be a string`,
      code: 'INVALID_VALUE_TYPE',
    };
  }

  if (value.length > MAX_LABEL_VALUE_LENGTH) {
    return {
      field: `${fieldPrefix}.${key}`,
      message: `Label value cannot exceed ${MAX_LABEL_VALUE_LENGTH} characters`,
      code: 'VALUE_TOO_LONG',
    };
  }

  return null;
}

/**
 * Validate labels
 */
export function validateLabels(labels: unknown, fieldName = 'labels'): ValidationError[] {
  const errors: ValidationError[] = [];

  if (labels === undefined || labels === null) {
    return errors; // Optional field
  }

  if (typeof labels !== 'object' || Array.isArray(labels)) {
    errors.push({
      field: fieldName,
      message: 'Labels must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const entries = Object.entries(labels as Record<string, unknown>);

  if (entries.length > MAX_LABELS) {
    errors.push({
      field: fieldName,
      message: `Labels cannot have more than ${MAX_LABELS} entries`,
      code: 'TOO_MANY_ENTRIES',
    });
    return errors;
  }

  for (const [key, value] of entries) {
    const error = validateLabelEntry(key, value as string, fieldName);
    if (error) errors.push(error);
  }

  return errors;
}

/**
 * Validate annotations
 */
export function validateAnnotations(
  annotations: unknown,
  fieldName = 'annotations',
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (annotations === undefined || annotations === null) {
    return errors; // Optional field
  }

  if (typeof annotations !== 'object' || Array.isArray(annotations)) {
    errors.push({
      field: fieldName,
      message: 'Annotations must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const entries = Object.entries(annotations as Record<string, unknown>);

  if (entries.length > MAX_ANNOTATIONS) {
    errors.push({
      field: fieldName,
      message: `Annotations cannot have more than ${MAX_ANNOTATIONS} entries`,
      code: 'TOO_MANY_ENTRIES',
    });
    return errors;
  }

  for (const [key, value] of entries) {
    if (!LABEL_KEY_PATTERN.test(key)) {
      errors.push({
        field: `${fieldName}.${key}`,
        message: `Invalid annotation key format: ${key}`,
        code: 'INVALID_KEY_FORMAT',
      });
    }

    if (typeof value !== 'string') {
      errors.push({
        field: `${fieldName}.${key}`,
        message: 'Annotation value must be a string',
        code: 'INVALID_VALUE_TYPE',
      });
    }
  }

  return errors;
}

/**
 * Valid taint effects
 */
const VALID_TAINT_EFFECTS = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'] as const;

/**
 * Validate a single taint
 */
export function validateTaint(taint: unknown, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldPrefix = `taints[${index}]`;

  if (typeof taint !== 'object' || taint === null || Array.isArray(taint)) {
    errors.push({
      field: fieldPrefix,
      message: 'Taint must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const t = taint as Record<string, unknown>;

  // Key is required
  if (!t.key || typeof t.key !== 'string') {
    errors.push({
      field: `${fieldPrefix}.key`,
      message: 'Taint key is required and must be a string',
      code: 'REQUIRED',
    });
  } else if (!LABEL_KEY_PATTERN.test(t.key)) {
    errors.push({
      field: `${fieldPrefix}.key`,
      message: `Invalid taint key format: ${t.key}`,
      code: 'INVALID_FORMAT',
    });
  }

  // Effect is required
  if (!t.effect || typeof t.effect !== 'string') {
    errors.push({
      field: `${fieldPrefix}.effect`,
      message: 'Taint effect is required and must be a string',
      code: 'REQUIRED',
    });
  } else if (!VALID_TAINT_EFFECTS.includes(t.effect as typeof VALID_TAINT_EFFECTS[number])) {
    errors.push({
      field: `${fieldPrefix}.effect`,
      message: `Taint effect must be one of: ${VALID_TAINT_EFFECTS.join(', ')}`,
      code: 'INVALID_VALUE',
    });
  }

  // Value is optional but must be a string if provided
  if (t.value !== undefined && t.value !== null && typeof t.value !== 'string') {
    errors.push({
      field: `${fieldPrefix}.value`,
      message: 'Taint value must be a string',
      code: 'INVALID_TYPE',
    });
  }

  return errors;
}

/**
 * Validate taints array
 */
export function validateTaints(taints: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (taints === undefined || taints === null) {
    return errors; // Optional field
  }

  if (!Array.isArray(taints)) {
    errors.push({
      field: 'taints',
      message: 'Taints must be an array',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  if (taints.length > MAX_TAINTS) {
    errors.push({
      field: 'taints',
      message: `Taints cannot have more than ${MAX_TAINTS} entries`,
      code: 'TOO_MANY_ENTRIES',
    });
    return errors;
  }

  for (let i = 0; i < taints.length; i++) {
    errors.push(...validateTaint(taints[i], i));
  }

  return errors;
}

/**
 * Validate allocatable resources
 */
export function validateAllocatableResources(resources: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (resources === undefined || resources === null) {
    return errors; // Optional field
  }

  if (typeof resources !== 'object' || Array.isArray(resources)) {
    errors.push({
      field: 'allocatable',
      message: 'Allocatable resources must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const r = resources as Record<string, unknown>;

  if (r.cpu !== undefined && (typeof r.cpu !== 'number' || r.cpu < 0)) {
    errors.push({
      field: 'allocatable.cpu',
      message: 'CPU must be a non-negative number',
      code: 'INVALID_VALUE',
    });
  }

  if (r.memory !== undefined && (typeof r.memory !== 'number' || r.memory < 0)) {
    errors.push({
      field: 'allocatable.memory',
      message: 'Memory must be a non-negative number',
      code: 'INVALID_VALUE',
    });
  }

  if (r.pods !== undefined && (typeof r.pods !== 'number' || r.pods < 0 || !Number.isInteger(r.pods))) {
    errors.push({
      field: 'allocatable.pods',
      message: 'Pods must be a non-negative integer',
      code: 'INVALID_VALUE',
    });
  }

  if (r.storage !== undefined && (typeof r.storage !== 'number' || r.storage < 0)) {
    errors.push({
      field: 'allocatable.storage',
      message: 'Storage must be a non-negative number',
      code: 'INVALID_VALUE',
    });
  }

  return errors;
}

/**
 * Validate node registration input
 */
export function validateRegisterNodeInput(input: unknown): ValidationResult {
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
  const nameError = validateNodeName(data.name);
  if (nameError) errors.push(nameError);

  const runtimeTypeError = validateRuntimeType(data.runtimeType);
  if (runtimeTypeError) errors.push(runtimeTypeError);

  // Validate optional fields
  const capabilitiesError = validateNodeCapabilities(data.capabilities);
  if (capabilitiesError) errors.push(capabilitiesError);

  errors.push(...validateLabels(data.labels));
  errors.push(...validateAnnotations(data.annotations));
  errors.push(...validateTaints(data.taints));
  errors.push(...validateAllocatableResources(data.allocatable));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate node update input
 */
export function validateUpdateNodeInput(input: unknown): ValidationResult {
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
  const capabilitiesError = validateNodeCapabilities(data.capabilities);
  if (capabilitiesError) errors.push(capabilitiesError);

  errors.push(...validateLabels(data.labels));
  errors.push(...validateAnnotations(data.annotations));
  errors.push(...validateTaints(data.taints));
  errors.push(...validateAllocatableResources(data.allocatable));

  return {
    valid: errors.length === 0,
    errors,
  };
}
