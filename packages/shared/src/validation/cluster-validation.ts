/**
 * Cluster configuration validation (Kubernetes-like)
 * @module @stark-o/shared/validation/cluster-validation
 */

import type { SchedulingPolicy } from '../types/scheduling';
import type { ValidationResult, ValidationError } from './pack-validation';
import { validateLabels, validateAnnotations } from './node-validation';

/**
 * Valid scheduling policies
 */
const VALID_SCHEDULING_POLICIES: SchedulingPolicy[] = [
  'spread',
  'binpack',
  'random',
  'affinity',
  'least_loaded',
];

/**
 * Valid preemption policies
 */
const VALID_PREEMPTION_POLICIES = ['PreemptLowerPriority', 'Never'] as const;

/**
 * Priority class name pattern
 */
const PRIORITY_CLASS_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

/**
 * Priority value range
 */
const MIN_PRIORITY_VALUE = -2000000000;
const MAX_PRIORITY_VALUE = 2000001000;

/**
 * Validate scheduling policy
 */
export function validateSchedulingPolicy(policy: unknown): ValidationError | null {
  if (policy === undefined || policy === null) {
    return null; // Optional
  }

  if (typeof policy !== 'string') {
    return {
      field: 'schedulingPolicy',
      message: 'Scheduling policy must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_SCHEDULING_POLICIES.includes(policy as SchedulingPolicy)) {
    return {
      field: 'schedulingPolicy',
      message: `Scheduling policy must be one of: ${VALID_SCHEDULING_POLICIES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate default resources
 */
export function validateDefaultResources(
  resources: unknown,
  fieldName: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (resources === undefined || resources === null) {
    return errors; // Optional
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
 * Validate positive integer
 */
export function validatePositiveInteger(
  value: unknown,
  fieldName: string,
): ValidationError | null {
  if (value === undefined || value === null) {
    return null; // Optional
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return {
      field: fieldName,
      message: `${fieldName} must be a positive integer`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate non-negative integer
 */
export function validateNonNegativeInteger(
  value: unknown,
  fieldName: string,
): ValidationError | null {
  if (value === undefined || value === null) {
    return null; // Optional
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return {
      field: fieldName,
      message: `${fieldName} must be a non-negative integer`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate boolean
 */
export function validateBoolean(
  value: unknown,
  fieldName: string,
): ValidationError | null {
  if (value === undefined || value === null) {
    return null; // Optional
  }

  if (typeof value !== 'boolean') {
    return {
      field: fieldName,
      message: `${fieldName} must be a boolean`,
      code: 'INVALID_TYPE',
    };
  }

  return null;
}

/**
 * Validate cluster config update input
 */
export function validateUpdateClusterConfigInput(input: unknown): ValidationResult {
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

  // Validate fields
  const maxPodsError = validatePositiveInteger(data.maxPodsPerNode, 'maxPodsPerNode');
  if (maxPodsError) errors.push(maxPodsError);

  const policyError = validateSchedulingPolicy(data.schedulingPolicy);
  if (policyError) errors.push(policyError);

  errors.push(...validateDefaultResources(data.defaultResourceRequests, 'defaultResourceRequests'));
  errors.push(...validateDefaultResources(data.defaultResourceLimits, 'defaultResourceLimits'));

  const maxTotalPodsError = validatePositiveInteger(data.maxTotalPods, 'maxTotalPods');
  if (maxTotalPodsError) errors.push(maxTotalPodsError);

  const maxTotalNodesError = validatePositiveInteger(data.maxTotalNodes, 'maxTotalNodes');
  if (maxTotalNodesError) errors.push(maxTotalNodesError);

  const heartbeatIntervalError = validatePositiveInteger(
    data.heartbeatIntervalMs,
    'heartbeatIntervalMs',
  );
  if (heartbeatIntervalError) errors.push(heartbeatIntervalError);

  const heartbeatTimeoutError = validatePositiveInteger(
    data.heartbeatTimeoutMs,
    'heartbeatTimeoutMs',
  );
  if (heartbeatTimeoutError) errors.push(heartbeatTimeoutError);

  const gracePeriodError = validateNonNegativeInteger(
    data.podTerminationGracePeriodMs,
    'podTerminationGracePeriodMs',
  );
  if (gracePeriodError) errors.push(gracePeriodError);

  const preemptionError = validateBoolean(data.enablePreemption, 'enablePreemption');
  if (preemptionError) errors.push(preemptionError);

  errors.push(...validateAnnotations(data.annotations));

  // Cross-field validation: timeout should be greater than interval
  if (
    typeof data.heartbeatIntervalMs === 'number' &&
    typeof data.heartbeatTimeoutMs === 'number' &&
    data.heartbeatTimeoutMs <= data.heartbeatIntervalMs
  ) {
    errors.push({
      field: 'heartbeatTimeoutMs',
      message: 'Heartbeat timeout must be greater than heartbeat interval',
      code: 'INVALID_RANGE',
    });
  }

  // Cross-field validation: default requests shouldn't exceed default limits
  if (data.defaultResourceRequests && data.defaultResourceLimits) {
    const req = data.defaultResourceRequests as Record<string, number>;
    const lim = data.defaultResourceLimits as Record<string, number>;

    if (req.cpu !== undefined && lim.cpu !== undefined && req.cpu > lim.cpu) {
      errors.push({
        field: 'defaultResourceRequests.cpu',
        message: 'Default CPU request cannot exceed default CPU limit',
        code: 'INVALID_RANGE',
      });
    }

    if (req.memory !== undefined && lim.memory !== undefined && req.memory > lim.memory) {
      errors.push({
        field: 'defaultResourceRequests.memory',
        message: 'Default memory request cannot exceed default memory limit',
        code: 'INVALID_RANGE',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate priority class name
 */
export function validatePriorityClassName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return {
      field: 'name',
      message: 'Priority class name is required',
      code: 'REQUIRED',
    };
  }

  if (typeof name !== 'string') {
    return {
      field: 'name',
      message: 'Priority class name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (name.length === 0) {
    return {
      field: 'name',
      message: 'Priority class name cannot be empty',
      code: 'EMPTY',
    };
  }

  if (name.length > 63) {
    return {
      field: 'name',
      message: 'Priority class name cannot exceed 63 characters',
      code: 'TOO_LONG',
    };
  }

  if (!PRIORITY_CLASS_NAME_PATTERN.test(name)) {
    return {
      field: 'name',
      message:
        'Priority class name must start with a lowercase letter and contain only lowercase alphanumeric characters and hyphens',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate priority value
 */
export function validatePriorityValue(value: unknown): ValidationError | null {
  if (value === undefined || value === null) {
    return {
      field: 'value',
      message: 'Priority value is required',
      code: 'REQUIRED',
    };
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return {
      field: 'value',
      message: 'Priority value must be an integer',
      code: 'INVALID_TYPE',
    };
  }

  if (value < MIN_PRIORITY_VALUE || value > MAX_PRIORITY_VALUE) {
    return {
      field: 'value',
      message: `Priority value must be between ${MIN_PRIORITY_VALUE} and ${MAX_PRIORITY_VALUE}`,
      code: 'OUT_OF_RANGE',
    };
  }

  return null;
}

/**
 * Validate preemption policy
 */
export function validatePreemptionPolicy(policy: unknown): ValidationError | null {
  if (policy === undefined || policy === null) {
    return null; // Optional, defaults to PreemptLowerPriority
  }

  if (typeof policy !== 'string') {
    return {
      field: 'preemptionPolicy',
      message: 'Preemption policy must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_PREEMPTION_POLICIES.includes(policy as typeof VALID_PREEMPTION_POLICIES[number])) {
    return {
      field: 'preemptionPolicy',
      message: `Preemption policy must be one of: ${VALID_PREEMPTION_POLICIES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate priority class creation input
 */
export function validateCreatePriorityClassInput(input: unknown): ValidationResult {
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
  const nameError = validatePriorityClassName(data.name);
  if (nameError) errors.push(nameError);

  const valueError = validatePriorityValue(data.value);
  if (valueError) errors.push(valueError);

  // Validate optional fields
  const globalDefaultError = validateBoolean(data.globalDefault, 'globalDefault');
  if (globalDefaultError) errors.push(globalDefaultError);

  const preemptionError = validatePreemptionPolicy(data.preemptionPolicy);
  if (preemptionError) errors.push(preemptionError);

  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') {
      errors.push({
        field: 'description',
        message: 'Description must be a string',
        code: 'INVALID_TYPE',
      });
    } else if (data.description.length > 1000) {
      errors.push({
        field: 'description',
        message: 'Description cannot exceed 1000 characters',
        code: 'TOO_LONG',
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
