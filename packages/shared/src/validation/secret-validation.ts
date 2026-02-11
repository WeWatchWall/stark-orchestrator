/**
 * Secret validation
 *
 * Validates secret creation and update inputs following the same
 * patterns as other Stark validators (pack, pod, service, etc.).
 *
 * @module @stark-o/shared/validation/secret-validation
 */

import type {
  SecretType,
  SecretInjection,
} from '../types/secret';
import type { ValidationResult, ValidationError } from './pack-validation';
import {
  VALID_SECRET_TYPES,
  VALID_INJECTION_MODES,
  SECRET_NAME_PATTERN,
  MAX_SECRET_NAME_LENGTH,
  MAX_SECRET_KEYS,
  MAX_SECRET_DATA_SIZE,
  TLS_REQUIRED_KEYS,
  DOCKER_REGISTRY_REQUIRED_KEYS,
} from '../types/secret';

// ============================================================================
// Field Validators
// ============================================================================

/**
 * Validate secret name
 */
export function validateSecretName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return { field: 'name', message: 'Secret name is required', code: 'REQUIRED' };
  }
  if (typeof name !== 'string') {
    return { field: 'name', message: 'Secret name must be a string', code: 'INVALID_TYPE' };
  }
  if (name.length === 0) {
    return { field: 'name', message: 'Secret name cannot be empty', code: 'INVALID_LENGTH' };
  }
  if (name.length > MAX_SECRET_NAME_LENGTH) {
    return {
      field: 'name',
      message: `Secret name cannot exceed ${MAX_SECRET_NAME_LENGTH} characters`,
      code: 'INVALID_LENGTH',
    };
  }
  if (!SECRET_NAME_PATTERN.test(name)) {
    return {
      field: 'name',
      message: 'Secret name must be DNS-compatible: lowercase alphanumeric, hyphens, or dots',
      code: 'INVALID_FORMAT',
    };
  }
  return null;
}

/**
 * Validate secret type
 */
export function validateSecretType(type: unknown): ValidationError | null {
  if (type === undefined || type === null) {
    return { field: 'type', message: 'Secret type is required', code: 'REQUIRED' };
  }
  if (typeof type !== 'string') {
    return { field: 'type', message: 'Secret type must be a string', code: 'INVALID_TYPE' };
  }
  if (!VALID_SECRET_TYPES.includes(type as SecretType)) {
    return {
      field: 'type',
      message: `Secret type must be one of: ${VALID_SECRET_TYPES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }
  return null;
}

/**
 * Validate secret data (plaintext key-value pairs)
 */
export function validateSecretData(
  data: unknown,
  type?: SecretType,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (data === undefined || data === null) {
    errors.push({ field: 'data', message: 'Secret data is required', code: 'REQUIRED' });
    return errors;
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    errors.push({ field: 'data', message: 'Secret data must be an object', code: 'INVALID_TYPE' });
    return errors;
  }

  const entries = Object.entries(data as Record<string, unknown>);

  if (entries.length === 0) {
    errors.push({ field: 'data', message: 'Secret data cannot be empty', code: 'INVALID_LENGTH' });
    return errors;
  }

  if (entries.length > MAX_SECRET_KEYS) {
    errors.push({
      field: 'data',
      message: `Secret data cannot have more than ${MAX_SECRET_KEYS} keys`,
      code: 'INVALID_LENGTH',
    });
  }

  // Validate all values are strings
  let totalSize = 0;
  for (const [key, value] of entries) {
    if (typeof value !== 'string') {
      errors.push({
        field: `data.${key}`,
        message: `Secret data value for key "${key}" must be a string`,
        code: 'INVALID_TYPE',
      });
    } else {
      totalSize += key.length + value.length;
    }
  }

  if (totalSize > MAX_SECRET_DATA_SIZE) {
    errors.push({
      field: 'data',
      message: `Total secret data size exceeds maximum of ${MAX_SECRET_DATA_SIZE} bytes`,
      code: 'INVALID_LENGTH',
    });
  }

  // Validate type-specific required keys
  if (type === 'tls') {
    for (const requiredKey of TLS_REQUIRED_KEYS) {
      if (!(requiredKey in (data as Record<string, unknown>))) {
        errors.push({
          field: `data.${requiredKey}`,
          message: `TLS secret must include "${requiredKey}" key`,
          code: 'REQUIRED',
        });
      }
    }
  }

  if (type === 'docker-registry') {
    for (const requiredKey of DOCKER_REGISTRY_REQUIRED_KEYS) {
      if (!(requiredKey in (data as Record<string, unknown>))) {
        errors.push({
          field: `data.${requiredKey}`,
          message: `Docker registry secret must include "${requiredKey}" key`,
          code: 'REQUIRED',
        });
      }
    }
  }

  return errors;
}

/**
 * Validate injection configuration
 */
export function validateSecretInjection(injection: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (injection === undefined || injection === null) {
    errors.push({ field: 'injection', message: 'Injection configuration is required', code: 'REQUIRED' });
    return errors;
  }

  if (typeof injection !== 'object' || Array.isArray(injection)) {
    errors.push({ field: 'injection', message: 'Injection must be an object', code: 'INVALID_TYPE' });
    return errors;
  }

  const inj = injection as Record<string, unknown>;

  if (!inj.mode) {
    errors.push({ field: 'injection.mode', message: 'Injection mode is required', code: 'REQUIRED' });
    return errors;
  }

  if (!VALID_INJECTION_MODES.includes(inj.mode as SecretInjection['mode'])) {
    errors.push({
      field: 'injection.mode',
      message: `Injection mode must be one of: ${VALID_INJECTION_MODES.join(', ')}`,
      code: 'INVALID_VALUE',
    });
    return errors;
  }

  if (inj.mode === 'volume') {
    if (!inj.mountPath) {
      errors.push({
        field: 'injection.mountPath',
        message: 'Volume injection requires a mountPath',
        code: 'REQUIRED',
      });
    } else if (typeof inj.mountPath !== 'string') {
      errors.push({
        field: 'injection.mountPath',
        message: 'mountPath must be a string',
        code: 'INVALID_TYPE',
      });
    } else if (!inj.mountPath.startsWith('/')) {
      errors.push({
        field: 'injection.mountPath',
        message: 'mountPath must be an absolute path starting with /',
        code: 'INVALID_FORMAT',
      });
    }

    if (inj.fileMapping !== undefined) {
      if (typeof inj.fileMapping !== 'object' || Array.isArray(inj.fileMapping) || inj.fileMapping === null) {
        errors.push({
          field: 'injection.fileMapping',
          message: 'fileMapping must be an object',
          code: 'INVALID_TYPE',
        });
      } else {
        for (const [key, value] of Object.entries(inj.fileMapping as Record<string, unknown>)) {
          if (typeof value !== 'string') {
            errors.push({
              field: `injection.fileMapping.${key}`,
              message: `fileMapping value for "${key}" must be a string`,
              code: 'INVALID_TYPE',
            });
          }
        }
      }
    }
  }

  if (inj.mode === 'env') {
    if (inj.prefix !== undefined && typeof inj.prefix !== 'string') {
      errors.push({
        field: 'injection.prefix',
        message: 'prefix must be a string',
        code: 'INVALID_TYPE',
      });
    }

    if (inj.keyMapping !== undefined) {
      if (typeof inj.keyMapping !== 'object' || Array.isArray(inj.keyMapping) || inj.keyMapping === null) {
        errors.push({
          field: 'injection.keyMapping',
          message: 'keyMapping must be an object',
          code: 'INVALID_TYPE',
        });
      } else {
        for (const [key, value] of Object.entries(inj.keyMapping as Record<string, unknown>)) {
          if (typeof value !== 'string') {
            errors.push({
              field: `injection.keyMapping.${key}`,
              message: `keyMapping value for "${key}" must be a string`,
              code: 'INVALID_TYPE',
            });
          }
        }
      }
    }
  }

  return errors;
}

/**
 * Validate secret namespace
 */
export function validateSecretNamespace(namespace: unknown): ValidationError | null {
  if (namespace === undefined || namespace === null) {
    return null; // Optional, defaults to 'default'
  }
  if (typeof namespace !== 'string') {
    return { field: 'namespace', message: 'Namespace must be a string', code: 'INVALID_TYPE' };
  }
  if (namespace.length === 0) {
    return { field: 'namespace', message: 'Namespace cannot be empty', code: 'INVALID_LENGTH' };
  }
  return null;
}

// ============================================================================
// Composite Validators
// ============================================================================

/**
 * Validate a CreateSecretInput
 */
export function validateCreateSecretInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as Record<string, unknown>;

  // Name
  const nameError = validateSecretName(data.name);
  if (nameError) errors.push(nameError);

  // Type
  const typeError = validateSecretType(data.type);
  if (typeError) errors.push(typeError);

  // Namespace
  const nsError = validateSecretNamespace(data.namespace);
  if (nsError) errors.push(nsError);

  // Data
  const dataErrors = validateSecretData(data.data, data.type as SecretType | undefined);
  errors.push(...dataErrors);

  // Injection
  const injectionErrors = validateSecretInjection(data.injection);
  errors.push(...injectionErrors);

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an UpdateSecretInput
 */
export function validateUpdateSecretInput(
  input: unknown,
  existingType?: SecretType,
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as Record<string, unknown>;

  // At least one field must be provided
  if (data.data === undefined && data.injection === undefined) {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'At least one of data or injection must be provided', code: 'REQUIRED' }],
    };
  }

  // Data (optional)
  if (data.data !== undefined) {
    const dataErrors = validateSecretData(data.data, existingType);
    errors.push(...dataErrors);
  }

  // Injection (optional)
  if (data.injection !== undefined) {
    const injectionErrors = validateSecretInjection(data.injection);
    errors.push(...injectionErrors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that volume mount paths don't conflict across multiple secrets.
 * Returns conflicting secret name pairs if any overlap is detected.
 */
export function validateMountPathConflicts(
  secrets: Array<{ name: string; injection: { mode: string; mountPath?: string } }>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const volumeSecrets = secrets.filter(s => s.injection.mode === 'volume' && s.injection.mountPath);

  for (let i = 0; i < volumeSecrets.length; i++) {
    for (let j = i + 1; j < volumeSecrets.length; j++) {
      const a = volumeSecrets[i]!;
      const b = volumeSecrets[j]!;
      const pathA = a.injection.mountPath!;
      const pathB = b.injection.mountPath!;

      // Check for exact match or parent-child relationship
      if (
        pathA === pathB ||
        pathA.startsWith(pathB + '/') ||
        pathB.startsWith(pathA + '/')
      ) {
        errors.push({
          field: 'secrets',
          message: `Mount path conflict between secrets "${a.name}" (${pathA}) and "${b.name}" (${pathB})`,
          code: 'CONFLICT',
        });
      }
    }
  }

  return errors;
}
