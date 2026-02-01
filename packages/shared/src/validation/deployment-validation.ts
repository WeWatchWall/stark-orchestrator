/**
 * Deployment validation
 * @module @stark-o/shared/validation/deployment-validation
 */

import type { DeploymentStatus, CreateDeploymentInput, UpdateDeploymentInput } from '../types/deployment';
import type { ValidationResult, ValidationError } from './pack-validation';
import { validateLabels, validateAnnotations } from './node-validation';
import { validateTolerations, validateResourceRequirements } from './pod-validation';
import { validateSchedulingConfig } from './scheduling-validation';

/**
 * Valid deployment statuses
 */
const VALID_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
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
 * Deployment name pattern (DNS-like: lowercase, alphanumeric, hyphens)
 */
const DEPLOYMENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

/**
 * Maximum deployment name length
 */
const MAX_DEPLOYMENT_NAME_LENGTH = 63;

/**
 * Maximum replicas
 */
const MAX_REPLICAS = 1000;

/**
 * Maximum metadata keys
 */
const MAX_METADATA_KEYS = 50;

/**
 * Validate deployment name
 */
export function validateDeploymentName(name: unknown): ValidationError | null {
  if (name === undefined || name === null) {
    return {
      field: 'name',
      message: 'Deployment name is required',
      code: 'REQUIRED',
    };
  }

  if (typeof name !== 'string') {
    return {
      field: 'name',
      message: 'Deployment name must be a string',
      code: 'INVALID_TYPE',
    };
  }

  if (name.length === 0) {
    return {
      field: 'name',
      message: 'Deployment name cannot be empty',
      code: 'INVALID_LENGTH',
    };
  }

  if (name.length > MAX_DEPLOYMENT_NAME_LENGTH) {
    return {
      field: 'name',
      message: `Deployment name cannot exceed ${MAX_DEPLOYMENT_NAME_LENGTH} characters`,
      code: 'INVALID_LENGTH',
    };
  }

  if (!DEPLOYMENT_NAME_PATTERN.test(name)) {
    return {
      field: 'name',
      message: 'Deployment name must be lowercase alphanumeric with hyphens, starting and ending with alphanumeric',
      code: 'INVALID_FORMAT',
    };
  }

  return null;
}

/**
 * Validate pack ID for deployment (can be ID or name)
 */
export function validateDeploymentPackId(packId: unknown): ValidationError | null {
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
 * Validate pack name for deployment
 */
export function validateDeploymentPackName(packName: unknown): ValidationError | null {
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
export function validateDeploymentNamespace(namespace: unknown): ValidationError | null {
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
 * Validate deployment status
 */
export function validateDeploymentStatus(status: unknown): ValidationError | null {
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

  if (!VALID_DEPLOYMENT_STATUSES.includes(status as DeploymentStatus)) {
    return {
      field: 'status',
      message: `Status must be one of: ${VALID_DEPLOYMENT_STATUSES.join(', ')}`,
      code: 'INVALID_VALUE',
    };
  }

  return null;
}

/**
 * Validate deployment metadata
 */
export function validateDeploymentMetadata(metadata: unknown): ValidationError | null {
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
 * Validate create deployment input
 */
export function validateCreateDeploymentInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as CreateDeploymentInput;

  // Required: name
  const nameError = validateDeploymentName(data.name);
  if (nameError) errors.push(nameError);

  // Either packId or packName is required
  const packIdError = validateDeploymentPackId(data.packId);
  const packNameError = validateDeploymentPackName(data.packName);
  
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
  const namespaceError = validateDeploymentNamespace(data.namespace);
  if (namespaceError) errors.push(namespaceError);

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
  const metadataError = validateDeploymentMetadata(data.metadata);
  if (metadataError) errors.push(metadataError);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate update deployment input
 */
export function validateUpdateDeploymentInput(input: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!input || typeof input !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Input must be an object', code: 'INVALID_TYPE' }],
    };
  }

  const data = input as UpdateDeploymentInput;

  // All fields are optional for update

  // Optional: replicas
  if (data.replicas !== undefined) {
    const replicasError = validateReplicas(data.replicas);
    if (replicasError) errors.push(replicasError);
  }

  // Optional: status
  if (data.status !== undefined) {
    const statusError = validateDeploymentStatus(data.status);
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
    const metadataError = validateDeploymentMetadata(data.metadata);
    if (metadataError) errors.push(metadataError);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
