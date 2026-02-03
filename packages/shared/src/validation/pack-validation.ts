/**
 * Pack registration validation
 * @module @stark-o/shared/validation/pack-validation
 */

import type { RuntimeTag } from '../types/pack';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Single validation error
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Valid runtime tags
 */
const VALID_RUNTIME_TAGS: RuntimeTag[] = ['node', 'browser', 'universal'];

/**
 * Pack name pattern: alphanumeric, hyphens, underscores, 1-64 chars
 */
const PACK_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * Semantic version pattern (simplified)
 */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;

/**
 * Maximum description length
 */
const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * Maximum metadata size (keys)
 */
const MAX_METADATA_KEYS = 50;

/**
 * Validate pack name
 */
export function validatePackName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return {
      field: 'name',
      message: 'Pack name is required',
      code: 'REQUIRED',
    };
  }

  if (typeof name !== 'string') {
    return {
      field: 'name',
      message: 'Pack name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (name.length === 0) {
    return {
      field: 'name',
      message: 'Pack name cannot be empty',
      code: 'EMPTY',
    };
  }

  if (name.length > 64) {
    return {
      field: 'name',
      message: 'Pack name cannot exceed 64 characters',
      code: 'TOO_LONG',
    };
  }

  if (!PACK_NAME_PATTERN.test(name)) {
    return {
      field: 'name',
      message:
        'Pack name must start with a letter and contain only alphanumeric characters, hyphens, and underscores',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate pack version
 */
export function validatePackVersion(version: unknown): ValidationError | null {
  if (version === undefined || version === null) {
    return {
      field: 'version',
      message: 'Pack version is required',
      code: 'REQUIRED',
    };
  }

  if (typeof version !== 'string') {
    return {
      field: 'version',
      message: 'Pack version must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (version.length === 0) {
    return {
      field: 'version',
      message: 'Pack version cannot be empty',
      code: 'EMPTY',
    };
  }

  if (!SEMVER_PATTERN.test(version)) {
    return {
      field: 'version',
      message: 'Pack version must be a valid semantic version (e.g., 1.0.0, 1.0.0-beta.1)',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate runtime tag
 */
export function validateRuntimeTag(runtimeTag: unknown): ValidationError | null {
  if (runtimeTag === undefined || runtimeTag === null) {
    return {
      field: 'runtimeTag',
      message: 'Runtime tag is required',
      code: 'REQUIRED',
    };
  }

  if (typeof runtimeTag !== 'string') {
    return {
      field: 'runtimeTag',
      message: 'Runtime tag must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_RUNTIME_TAGS.includes(runtimeTag as RuntimeTag)) {
    return {
      field: 'runtimeTag',
      message: `Runtime tag must be one of: ${VALID_RUNTIME_TAGS.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate pack description
 */
export function validatePackDescription(description: unknown): ValidationError | null {
  if (description === undefined || description === null) {
    return null; // Optional field
  }

  if (typeof description !== 'string') {
    return {
      field: 'description',
      message: 'Pack description must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return {
      field: 'description',
      message: `Pack description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`,
      code: 'TOO_LONG',
    };
  }

  return null;
}

/**
 * Validate pack metadata
 */
export function validatePackMetadata(metadata: unknown): ValidationError | null {
  if (metadata === undefined || metadata === null) {
    return null; // Optional field
  }

  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      field: 'metadata',
      message: 'Pack metadata must be an object',
      code: 'INVALID_TYPE',
    };
  }

  const keys = Object.keys(metadata);
  if (keys.length > MAX_METADATA_KEYS) {
    return {
      field: 'metadata',
      message: `Pack metadata cannot have more than ${MAX_METADATA_KEYS} keys`,
      code: 'TOO_MANY_KEYS',
    };
  }

  return null;
}

/**
 * Valid visibility values
 */
const VALID_VISIBILITY_VALUES = ['private', 'public'];

/**
 * Valid namespace values
 */
const VALID_NAMESPACE_VALUES = ['system', 'user'];

/**
 * Validate pack visibility
 */
export function validatePackVisibility(visibility: unknown): ValidationError | null {
  if (visibility === undefined || visibility === null) {
    return null; // Optional field, defaults to 'private'
  }

  if (typeof visibility !== 'string') {
    return {
      field: 'visibility',
      message: 'Pack visibility must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_VISIBILITY_VALUES.includes(visibility)) {
    return {
      field: 'visibility',
      message: `Pack visibility must be one of: ${VALID_VISIBILITY_VALUES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate pack namespace
 */
export function validatePackNamespace(namespace: unknown): ValidationError | null {
  if (namespace === undefined || namespace === null) {
    return null; // Optional field, defaults to 'user'
  }

  if (typeof namespace !== 'string') {
    return {
      field: 'namespace',
      message: 'Pack namespace must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_NAMESPACE_VALUES.includes(namespace)) {
    return {
      field: 'namespace',
      message: `Pack namespace must be one of: ${VALID_NAMESPACE_VALUES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate pack registration input
 */
export function validateRegisterPackInput(input: unknown): ValidationResult {
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
  const nameError = validatePackName(data.name);
  if (nameError) errors.push(nameError);

  const versionError = validatePackVersion(data.version);
  if (versionError) errors.push(versionError);

  const runtimeTagError = validateRuntimeTag(data.runtimeTag);
  if (runtimeTagError) errors.push(runtimeTagError);

  // Validate optional fields
  const descriptionError = validatePackDescription(data.description);
  if (descriptionError) errors.push(descriptionError);

  const visibilityError = validatePackVisibility(data.visibility);
  if (visibilityError) errors.push(visibilityError);

  const namespaceError = validatePackNamespace(data.namespace);
  if (namespaceError) errors.push(namespaceError);

  const metadataError = validatePackMetadata(data.metadata);
  if (metadataError) errors.push(metadataError);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate pack update input
 */
export function validateUpdatePackInput(input: unknown): ValidationResult {
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

  // Validate optional fields
  const descriptionError = validatePackDescription(data.description);
  if (descriptionError) errors.push(descriptionError);

  const visibilityError = validatePackVisibility(data.visibility);
  if (visibilityError) errors.push(visibilityError);

  const metadataError = validatePackMetadata(data.metadata);
  if (metadataError) errors.push(metadataError);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a runtime tag is compatible with a node runtime type
 */
export function isRuntimeCompatible(packRuntimeTag: RuntimeTag, nodeRuntimeType: 'node' | 'browser'): boolean {
  if (packRuntimeTag === 'universal') {
    return true;
  }
  return packRuntimeTag === nodeRuntimeType;
}
