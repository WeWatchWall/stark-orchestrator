/**
 * Stark Orchestrator - Shared Package
 * Types, validation, errors, logging, and utilities
 * @module @stark-o/shared
 */

// Types (includes helper functions like isRuntimeCompatible, matchesSelector, etc.)
export * from './types/index.js';

// Errors (export ValidationError class and ValidationResult type from here)
export * from './errors/index.js';

// Validation (exclude conflicting names that are already exported from errors/types)
export {
  // Pack validation
  validatePackName,
  validatePackVersion,
  validateRuntimeTag,
  validatePackDescription,
  validatePackMetadata,
  validateMinNodeVersion,
  validateRegisterPackInput,
  validateUpdatePackInput,
  // Node validation
  validateNodeName,
  validateRuntimeType,
  validateNodeCapabilities,
  validateLabelEntry,
  validateNodeLabels,
  validateAnnotations,
  validateTaint,
  validateTaints,
  validateAllocatableResources,
  validateRegisterNodeInput,
  validateUpdateNodeInput,
  // Pod validation
  validatePackId,
  validatePodPackVersion,
  validateNamespace,
  validatePriorityClassName,
  validateToleration,
  validateTolerations,
  validateResourceRequirements,
  validatePodMetadata,
  validateCreatePodInput,
  validatePodStatus,
  validateUpdatePodInput,
  validateResourceRequestsVsLimits,
  // Namespace validation
  validateNamespaceName,
  isReservedNamespaceName,
  validateResourceQuotaHard,
  validateResourceQuota,
  validateResourceLimitValue,
  validateLimitRange,
  validateCreateNamespaceInput,
  validateUpdateNamespaceInput,
  validatePodFitsNamespaceLimits,
  RESERVED_NAMESPACE_NAMES,
  // Cluster validation
  validateSchedulingPolicy as validateClusterSchedulingPolicyInput,
  validateDefaultResources,
  validatePositiveInteger,
  validateNonNegativeInteger,
  validateBoolean,
  validateUpdateClusterConfigInput,
  validatePriorityClassNameForClass,
  validatePriorityValue,
  validatePreemptionPolicy,
  validateCreatePriorityClassInput,
  // Scheduling validation
  validateNodeSelectorRequirement,
  validateNodeSelectorTerm,
  validatePreferredSchedulingTerm,
  validateNodeAffinity as validateNodeAffinityInput,
  validateLabelSelector,
  validatePodAffinityTerm,
  validateWeightedPodAffinityTerm,
  validatePodAffinity as validatePodAffinityInput,
  validatePodAntiAffinity,
  validateSchedulingConfig,
  // Deployment validation
  validateDeploymentName,
  validateDeploymentPackId,
  validateDeploymentPackName,
  validateReplicas,
  validateDeploymentNamespace,
  validateDeploymentStatus,
  validateDeploymentMetadata,
  validateCreateDeploymentInput,
  validateUpdateDeploymentInput,
} from './validation/index.js';

// Logging
export {
  Logger,
  createLogger,
  createServiceLogger,
  isTestEnvironment,
  logger,
  generateCorrelationId,
  type LogLevel,
  type LogMeta,
  type LogEntry,
  type LoggerConfig,
} from './logging/logger.js';

// Utilities
export {
  generateUUID,
  isValidUUID,
  formatISODate,
  formatDate,
  formatRelativeTime,
  parseISODate,
  nowISO,
  now,
  sleep,
  retry,
  deepClone,
  deepMerge,
  pick,
  omit,
  deepEqual,
  debounce,
  throttle,
  capitalize,
  toKebabCase,
  toCamelCase,
  truncate,
  randomString,
  isPlainObject,
  compact,
  groupBy,
  sortBy,
} from './utils/index.js';
