/**
 * Pod request validation including runtime compatibility
 * @module @stark-o/shared/validation/pod-validation
 */

import type { PodStatus, ResourceRequirements } from '../types/pod';
import type { ValidationResult, ValidationError } from './pack-validation';
import { validateLabels, validateAnnotations } from './node-validation';

/**
 * Valid pod statuses
 */
const VALID_POD_STATUSES: PodStatus[] = [
  'pending',
  'scheduled',
  'starting',
  'running',
  'stopping',
  'stopped',
  'failed',
  'evicted',
  'unknown',
];

/**
 * UUID pattern for IDs
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Maximum tolerations per pod
 */
const MAX_TOLERATIONS = 50;

/**
 * Maximum metadata size
 */
const MAX_METADATA_KEYS = 50;

/**
 * Label key pattern (shared with node validation)
 */
const LABEL_KEY_PATTERN = /^([a-zA-Z0-9][-a-zA-Z0-9_.]*\/)?[a-zA-Z0-9][-a-zA-Z0-9_.]*$/;

/**
 * Valid toleration operators
 */
const VALID_TOLERATION_OPERATORS = ['Equal', 'Exists'] as const;

/**
 * Valid taint effects (for tolerations)
 */
const VALID_TAINT_EFFECTS = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'] as const;

/**
 * Validate pack ID
 */
export function validatePackId(packId: unknown): ValidationError | null {
  if (packId === undefined || packId === null) {
    return {
      field: 'packId',
      message: 'Pack ID is required',
      code: 'REQUIRED',
    };
  }

  if (typeof packId !== 'string') {
    return {
      field: 'packId',
      message: 'Pack ID must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!UUID_PATTERN.test(packId)) {
    return {
      field: 'packId',
      message: 'Pack ID must be a valid UUID',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate pack version (optional for pod creation)
 */
export function validatePodPackVersion(version: unknown): ValidationError | null {
  if (version === undefined || version === null) {
    return null; // Optional field
  }

  if (typeof version !== 'string') {
    return {
      field: 'packVersion',
      message: 'Pack version must be a string',
      code: 'INVALID_TYPE',
    };
  }

  // Simple semver check
  const semverPattern = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
  if (!semverPattern.test(version)) {
    return {
      field: 'packVersion',
      message: 'Pack version must be a valid semantic version',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Namespace name pattern
 */
const NAMESPACE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Validate namespace
 */
export function validateNamespace(namespace: unknown): ValidationError | null {
  if (namespace === undefined || namespace === null) {
    return null; // Optional field, defaults to 'default'
  }

  if (typeof namespace !== 'string') {
    return {
      field: 'namespace',
      message: 'Namespace must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!NAMESPACE_NAME_PATTERN.test(namespace)) {
    return {
      field: 'namespace',
      message:
        'Namespace must start with a lowercase letter and contain only lowercase alphanumeric characters and hyphens, max 63 characters',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate priority class name
 */
export function validatePriorityClassName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return null; // Optional field
  }

  if (typeof name !== 'string') {
    return {
      field: 'priorityClassName',
      message: 'Priority class name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (name.length === 0) {
    return {
      field: 'priorityClassName',
      message: 'Priority class name cannot be empty',
      code: 'EMPTY',
    };
  }

  if (name.length > 63) {
    return {
      field: 'priorityClassName',
      message: 'Priority class name cannot exceed 63 characters',
      code: 'TOO_LONG',
    };
  }

  return null;
}

/**
 * Validate a single toleration
 */
export function validateToleration(toleration: unknown, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const fieldPrefix = `tolerations[${index}]`;

  if (typeof toleration !== 'object' || toleration === null || Array.isArray(toleration)) {
    errors.push({
      field: fieldPrefix,
      message: 'Toleration must be an object',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const t = toleration as Record<string, unknown>;

  // Key is optional when operator is Exists
  if (t.key !== undefined && t.key !== null) {
    if (typeof t.key !== 'string') {
      errors.push({
        field: `${fieldPrefix}.key`,
        message: 'Toleration key must be a string',
        code: 'INVALID_TYPE',
      });
    } else if (t.key.length > 0 && !LABEL_KEY_PATTERN.test(t.key)) {
      errors.push({
        field: `${fieldPrefix}.key`,
        message: `Invalid toleration key format: ${t.key}`,
        code: 'INVALID_FORMAT',
      });
    }
  }

  // Operator is optional, defaults to Equal
  if (t.operator !== undefined && t.operator !== null) {
    if (typeof t.operator !== 'string') {
      errors.push({
        field: `${fieldPrefix}.operator`,
        message: 'Toleration operator must be a string',
        code: 'INVALID_TYPE',
      });
    } else if (!VALID_TOLERATION_OPERATORS.includes(t.operator as typeof VALID_TOLERATION_OPERATORS[number])) {
      errors.push({
        field: `${fieldPrefix}.operator`,
        message: `Toleration operator must be one of: ${VALID_TOLERATION_OPERATORS.join(', ')}`,
        code: 'INVALID_VALUE',
      });
    }
  }

  // Value is only valid when operator is Equal
  if (t.value !== undefined && t.value !== null) {
    if (typeof t.value !== 'string') {
      errors.push({
        field: `${fieldPrefix}.value`,
        message: 'Toleration value must be a string',
        code: 'INVALID_TYPE',
      });
    }
  }

  // Effect is optional
  if (t.effect !== undefined && t.effect !== null) {
    if (typeof t.effect !== 'string') {
      errors.push({
        field: `${fieldPrefix}.effect`,
        message: 'Toleration effect must be a string',
        code: 'INVALID_TYPE',
      });
    } else if (!VALID_TAINT_EFFECTS.includes(t.effect as typeof VALID_TAINT_EFFECTS[number])) {
      errors.push({
        field: `${fieldPrefix}.effect`,
        message: `Toleration effect must be one of: ${VALID_TAINT_EFFECTS.join(', ')}`,
        code: 'INVALID_VALUE',
      });
    }
  }

  // TolerationSeconds is optional, only valid for NoExecute
  if (t.tolerationSeconds !== undefined && t.tolerationSeconds !== null) {
    if (typeof t.tolerationSeconds !== 'number' || t.tolerationSeconds < 0) {
      errors.push({
        field: `${fieldPrefix}.tolerationSeconds`,
        message: 'Toleration seconds must be a non-negative number',
        code: 'INVALID_VALUE',
      });
    }
  }

  return errors;
}

/**
 * Validate tolerations array
 */
export function validateTolerations(tolerations: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (tolerations === undefined || tolerations === null) {
    return errors; // Optional field
  }

  if (!Array.isArray(tolerations)) {
    errors.push({
      field: 'tolerations',
      message: 'Tolerations must be an array',
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  if (tolerations.length > MAX_TOLERATIONS) {
    errors.push({
      field: 'tolerations',
      message: `Tolerations cannot have more than ${MAX_TOLERATIONS} entries`,
      code: 'TOO_MANY_ENTRIES',
    });
    return errors;
  }

  for (let i = 0; i < tolerations.length; i++) {
    errors.push(...validateToleration(tolerations[i], i));
  }

  return errors;
}

/**
 * Validate resource requirements
 */
export function validateResourceRequirements(
  resources: unknown,
  fieldName: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (resources === undefined || resources === null) {
    return errors; // Optional field
  }

  if (typeof resources !== 'object' || Array.isArray(resources)) {
    errors.push({
      field: fieldName,
      message: `${fieldName} must be an object`,
      code: 'INVALID_TYPE',
    });
    return errors;
  }

  const r = resources as Record<string, unknown>;

  if (r.cpu !== undefined) {
    if (typeof r.cpu !== 'number' || r.cpu < 0) {
      errors.push({
        field: `${fieldName}.cpu`,
        message: 'CPU must be a non-negative number',
        code: 'INVALID_VALUE',
      });
    }
  }

  if (r.memory !== undefined) {
    if (typeof r.memory !== 'number' || r.memory < 0) {
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
 * Validate pod metadata
 */
export function validatePodMetadata(metadata: unknown): ValidationError | null {
  if (metadata === undefined || metadata === null) {
    return null; // Optional field
  }

  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      field: 'metadata',
      message: 'Metadata must be an object',
      code: 'INVALID_TYPE',
    };
  }

  const keys = Object.keys(metadata);
  if (keys.length > MAX_METADATA_KEYS) {
    return {
      field: 'metadata',
      message: `Metadata cannot have more than ${MAX_METADATA_KEYS} keys`,
      code: 'TOO_MANY_KEYS',
    };
  }

  return null;
}

/**
 * Validate pod creation input
 */
export function validateCreatePodInput(input: unknown): ValidationResult {
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
  const packIdError = validatePackId(data.packId);
  if (packIdError) errors.push(packIdError);

  // Validate optional fields
  const packVersionError = validatePodPackVersion(data.packVersion);
  if (packVersionError) errors.push(packVersionError);

  const namespaceError = validateNamespace(data.namespace);
  if (namespaceError) errors.push(namespaceError);

  const priorityClassError = validatePriorityClassName(data.priorityClassName);
  if (priorityClassError) errors.push(priorityClassError);

  errors.push(...validateLabels(data.labels));
  errors.push(...validateAnnotations(data.annotations));
  errors.push(...validateTolerations(data.tolerations));
  errors.push(...validateResourceRequirements(data.resourceRequests, 'resourceRequests'));
  errors.push(...validateResourceRequirements(data.resourceLimits, 'resourceLimits'));

  const metadataError = validatePodMetadata(data.metadata);
  if (metadataError) errors.push(metadataError);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate pod status
 */
export function validatePodStatus(status: unknown): ValidationError | null {
  if (status === undefined || status === null) {
    return null; // Optional field
  }

  if (typeof status !== 'string') {
    return {
      field: 'status',
      message: 'Status must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_POD_STATUSES.includes(status as PodStatus)) {
    return {
      field: 'status',
      message: `Status must be one of: ${VALID_POD_STATUSES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate pod update input
 */
export function validateUpdatePodInput(input: unknown): ValidationResult {
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
  const statusError = validatePodStatus(data.status);
  if (statusError) errors.push(statusError);

  if (data.statusMessage !== undefined && data.statusMessage !== null) {
    if (typeof data.statusMessage !== 'string') {
      errors.push({
        field: 'statusMessage',
        message: 'Status message must be a string',
        code: 'INVALID_TYPE',
      });
    }
  }

  if (data.nodeId !== undefined && data.nodeId !== null) {
    if (typeof data.nodeId !== 'string') {
      errors.push({
        field: 'nodeId',
        message: 'Node ID must be a string or null',
        code: 'INVALID_TYPE',
      });
    } else if (!UUID_PATTERN.test(data.nodeId)) {
      errors.push({
        field: 'nodeId',
        message: 'Node ID must be a valid UUID',
        code: 'INVALID_FORMAT',
      });
    }
  }

  errors.push(...validateLabels(data.labels));
  errors.push(...validateAnnotations(data.annotations));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that resource requests don't exceed limits
 */
export function validateResourceRequestsVsLimits(
  requests: Partial<ResourceRequirements> | undefined,
  limits: Partial<ResourceRequirements> | undefined,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!requests || !limits) {
    return errors;
  }

  if (requests.cpu !== undefined && limits.cpu !== undefined && requests.cpu > limits.cpu) {
    errors.push({
      field: 'resourceRequests.cpu',
      message: 'CPU request cannot exceed CPU limit',
      code: 'EXCEEDS_LIMIT',
    });
  }

  if (requests.memory !== undefined && limits.memory !== undefined && requests.memory > limits.memory) {
    errors.push({
      field: 'resourceRequests.memory',
      message: 'Memory request cannot exceed memory limit',
      code: 'EXCEEDS_LIMIT',
    });
  }

  return errors;
}
