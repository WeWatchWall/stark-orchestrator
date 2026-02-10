/**
 * Service validation
 * @module @stark-o/shared/validation/service-validation
 */

import type { ServiceStatus, CreateServiceInput, UpdateServiceInput } from '../types/service';
import type { ValidationResult, ValidationError } from './pack-validation';
import { validateLabels, validateAnnotations } from './node-validation';
import { validateTolerations, validateResourceRequirements } from './pod-validation';
import { validateSchedulingConfig } from './scheduling-validation';

/**
 * Valid service statuses
 */
const VALID_SERVICE_STATUSES: ServiceStatus[] = [
  'active',
  'paused',
  'scaling',
  'deleting',
];

/**
 * UUID pattern for IDs
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Service name pattern (DNS-like: lowercase, alphanumeric, hyphens)
 */
const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Maximum service name length
 */
const MAX_SERVICE_NAME_LENGTH = 63;

/**
 * Maximum replicas
 */
const MAX_REPLICAS = 1000;

/**
 * Maximum metadata keys
 */
const MAX_METADATA_KEYS = 50;

/**
 * Validate service name
 */
export function validateServiceName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return {
      field: 'name',
      message: 'Service name is required',
      code: 'REQUIRED',
    };
  }

  if (typeof name !== 'string') {
    return {
      field: 'name',
      message: 'Service name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (name.length === 0) {
    return {
      field: 'name',
      message: 'Service name cannot be empty',
      code: 'INVALID_LENGTH',
    };
  }

  if (name.length > MAX_SERVICE_NAME_LENGTH) {
    return {
      field: 'name',
      message: `Service name cannot exceed ${MAX_SERVICE_NAME_LENGTH} characters`,
      code: 'INVALID_LENGTH',
    };
  }

  if (!SERVICE_NAME_PATTERN.test(name)) {
    return {
      field: 'name',
      message: 'Service name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate pack ID for service (can be ID or name)
 */
export function validateServicePackId(packId: unknown): ValidationError | null {
  if (packId === undefined || packId === null) {
    return null; // Optional if packName is provided
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
 * Validate pack name for service
 */
export function validateServicePackName(packName: unknown): ValidationError | null {
  if (packName === undefined || packName === null) {
    return null; // Optional if packId is provided
  }

  if (typeof packName !== 'string') {
    return {
      field: 'packName',
      message: 'Pack name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (packName.length === 0) {
    return {
      field: 'packName',
      message: 'Pack name cannot be empty',
      code: 'INVALID_LENGTH',
    };
  }

  return null;
}

/**
 * Validate replicas count
 */
export function validateReplicas(replicas: unknown): ValidationError | null {
  if (replicas === undefined || replicas === null) {
    return null; // Defaults to 1
  }

  if (typeof replicas !== 'number') {
    return {
      field: 'replicas',
      message: 'Replicas must be a number',
      code: 'INVALID_TYPE',
    };
  }

  if (!Number.isInteger(replicas)) {
    return {
      field: 'replicas',
      message: 'Replicas must be an integer',
      code: 'INVALID_TYPE',
    };
  }

  if (replicas < 0) {
    return {
      field: 'replicas',
      message: 'Replicas cannot be negative',
      code: 'INVALID_VALUE',
    };
  }

  if (replicas > MAX_REPLICAS) {
    return {
      field: 'replicas',
      message: `Replicas cannot exceed ${MAX_REPLICAS}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate namespace
 */
export function validateServiceNamespace(namespace: unknown): ValidationError | null {
  if (namespace === undefined || namespace === null) {
    return null; // Defaults to 'default'
  }

  if (typeof namespace !== 'string') {
    return {
      field: 'namespace',
      message: 'Namespace must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (namespace.length === 0) {
    return {
      field: 'namespace',
      message: 'Namespace cannot be empty',
      code: 'INVALID_LENGTH',
    };
  }

  if (namespace.length > 63) {
    return {
      field: 'namespace',
      message: 'Namespace cannot exceed 63 characters',
      code: 'INVALID_LENGTH',
    };
  }

  return null;
}

/**
 * Validate service status
 */
export function validateServiceStatus(status: unknown): ValidationError | null {
  if (status === undefined || status === null) {
    return null; // Optional
  }

  if (typeof status !== 'string') {
    return {
      field: 'status',
      message: 'Status must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (!VALID_SERVICE_STATUSES.includes(status as ServiceStatus)) {
    return {
      field: 'status',
      message: `Status must be one of: ${VALID_SERVICE_STATUSES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate service metadata
 */
export function validateServiceMetadata(metadata: unknown): ValidationError | null {
  if (metadata === undefined || metadata === null) {
    return null; // Defaults to {}
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
      code: 'INVALID_LENGTH',
    };
  }

  return null;
}

/**
 * Validate followLatest flag
 */
export function validateFollowLatest(followLatest: unknown): ValidationError | null {
  if (followLatest === undefined || followLatest === null) {
    return null; // Defaults to false
  }

  if (typeof followLatest !== 'boolean') {
    return {
      field: 'followLatest',
      message: 'followLatest must be a boolean',
      code: 'INVALID_TYPE',
    };
  }

  return null;
}

/**
 * Validate ingress port
 */
export function validateIngressPort(ingressPort: unknown): ValidationError | null {
  if (ingressPort === undefined || ingressPort === null) {
    return null; // Optional
  }

  if (typeof ingressPort !== 'number') {
    return {
      field: 'ingressPort',
      message: 'Ingress port must be a number',
      code: 'INVALID_TYPE',
    };
  }

  if (!Number.isInteger(ingressPort)) {
    return {
      field: 'ingressPort',
      message: 'Ingress port must be an integer',
      code: 'INVALID_TYPE',
    };
  }

  if (ingressPort < 1 || ingressPort > 65535) {
    return {
      field: 'ingressPort',
      message: 'Ingress port must be between 1 and 65535',
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate create service input
 */
export function validateCreateServiceInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as CreateServiceInput;

  // Required: name
  const nameError = validateServiceName(data.name);
  if (nameError) errors.push(nameError);

  // Either packId or packName is required
  const packIdError = validateServicePackId(data.packId);
  const packNameError = validateServicePackName(data.packName);
  
  if (!data.packId && !data.packName) {
    errors.push({
      field: 'packId',
      message: 'Either packId or packName is required',
      code: 'REQUIRED',
    });
  } else {
    if (data.packId && packIdError) errors.push(packIdError);
    if (data.packName && packNameError) errors.push(packNameError);
  }

  // Optional: replicas
  const replicasError = validateReplicas(data.replicas);
  if (replicasError) errors.push(replicasError);

  // Optional: namespace
  const namespaceError = validateServiceNamespace(data.namespace);
  if (namespaceError) errors.push(namespaceError);

  // Optional: followLatest
  const followLatestError = validateFollowLatest(data.followLatest);
  if (followLatestError) errors.push(followLatestError);

  // Optional: labels
  if (data.labels !== undefined) {
    const labelsErrors = validateLabels(data.labels, 'labels');
    errors.push(...labelsErrors);
  }

  // Optional: annotations
  if (data.annotations !== undefined) {
    const annotationsErrors = validateAnnotations(data.annotations, 'annotations');
    errors.push(...annotationsErrors);
  }

  // Optional: podLabels
  if (data.podLabels !== undefined) {
    const podLabelsErrors = validateLabels(data.podLabels, 'podLabels');
    errors.push(...podLabelsErrors);
  }

  // Optional: podAnnotations
  if (data.podAnnotations !== undefined) {
    const podAnnotationsErrors = validateAnnotations(data.podAnnotations, 'podAnnotations');
    errors.push(...podAnnotationsErrors);
  }

  // Optional: tolerations
  if (data.tolerations !== undefined) {
    const tolerationsErrors = validateTolerations(data.tolerations);
    errors.push(...tolerationsErrors);
  }

  // Optional: resourceRequests
  if (data.resourceRequests !== undefined) {
    const requestsErrors = validateResourceRequirements(data.resourceRequests, 'resourceRequests');
    errors.push(...requestsErrors);
  }

  // Optional: resourceLimits
  if (data.resourceLimits !== undefined) {
    const limitsErrors = validateResourceRequirements(data.resourceLimits, 'resourceLimits');
    errors.push(...limitsErrors);
  }

  // Optional: scheduling
  if (data.scheduling !== undefined) {
    const schedulingResult = validateSchedulingConfig(data.scheduling);
    if (!schedulingResult.valid) {
      errors.push(...schedulingResult.errors.map((e: ValidationError) => ({ ...e, field: `scheduling.${e.field}` })));
    }
  }

  // Optional: metadata
  const metadataError = validateServiceMetadata(data.metadata);
  if (metadataError) errors.push(metadataError);

  // Optional: ingressPort
  const ingressPortError = validateIngressPort(data.ingressPort);
  if (ingressPortError) errors.push(ingressPortError);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate update service input
 */
export function validateUpdateServiceInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as UpdateServiceInput;

  // All fields are optional for update

  // Optional: replicas
  if (data.replicas !== undefined) {
    const replicasError = validateReplicas(data.replicas);
    if (replicasError) errors.push(replicasError);
  }

  // Optional: followLatest
  if (data.followLatest !== undefined) {
    const followLatestError = validateFollowLatest(data.followLatest);
    if (followLatestError) errors.push(followLatestError);
  }

  // Optional: status
  if (data.status !== undefined) {
    const statusError = validateServiceStatus(data.status);
    if (statusError) errors.push(statusError);
  }

  // Optional: labels
  if (data.labels !== undefined) {
    const labelsErrors = validateLabels(data.labels, 'labels');
    errors.push(...labelsErrors);
  }

  // Optional: annotations
  if (data.annotations !== undefined) {
    const annotationsErrors = validateAnnotations(data.annotations, 'annotations');
    errors.push(...annotationsErrors);
  }

  // Optional: podLabels
  if (data.podLabels !== undefined) {
    const podLabelsErrors = validateLabels(data.podLabels, 'podLabels');
    errors.push(...podLabelsErrors);
  }

  // Optional: podAnnotations
  if (data.podAnnotations !== undefined) {
    const podAnnotationsErrors = validateAnnotations(data.podAnnotations, 'podAnnotations');
    errors.push(...podAnnotationsErrors);
  }

  // Optional: tolerations
  if (data.tolerations !== undefined) {
    const tolerationsErrors = validateTolerations(data.tolerations);
    errors.push(...tolerationsErrors);
  }

  // Optional: resourceRequests
  if (data.resourceRequests !== undefined) {
    const requestsErrors = validateResourceRequirements(data.resourceRequests, 'resourceRequests');
    errors.push(...requestsErrors);
  }

  // Optional: resourceLimits
  if (data.resourceLimits !== undefined) {
    const limitsErrors = validateResourceRequirements(data.resourceLimits, 'resourceLimits');
    errors.push(...limitsErrors);
  }

  // Optional: scheduling
  if (data.scheduling !== undefined) {
    const schedulingResult = validateSchedulingConfig(data.scheduling);
    if (!schedulingResult.valid) {
      errors.push(...schedulingResult.errors.map((e: ValidationError) => ({ ...e, field: `scheduling.${e.field}` })));
    }
  }

  // Optional: metadata
  if (data.metadata !== undefined) {
    const metadataError = validateServiceMetadata(data.metadata);
    if (metadataError) errors.push(metadataError);
  }

  // Optional: ingressPort
  if (data.ingressPort !== undefined && data.ingressPort !== null) {
    const ingressPortError = validateIngressPort(data.ingressPort);
    if (ingressPortError) errors.push(ingressPortError);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
