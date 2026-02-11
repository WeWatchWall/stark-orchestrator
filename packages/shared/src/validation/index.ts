/**
 * Validation module - re-exports all validators
 * @module @stark-o/shared/validation
 */

// Types
export type { ValidationResult, ValidationError } from './pack-validation';

// Pack validation
export {
  validatePackName,
  validatePackVersion,
  validateRuntimeTag,
  validatePackDescription,
  validatePackMetadata,
  validateMinNodeVersion,
  validateRequestedCapabilities,
  validateRegisterPackInput,
  validateUpdatePackInput,
  isRuntimeCompatible as validateRuntimeCompatibility,
} from './pack-validation';

// Node validation
export {
  validateNodeName,
  validateRuntimeType,
  validateNodeCapabilities,
  validateLabelEntry,
  validateLabels as validateNodeLabels,
  validateAnnotations,
  validateTaint,
  validateTaints,
  validateAllocatableResources,
  validateRegisterNodeInput,
  validateUpdateNodeInput,
} from './node-validation';

// Pod validation
export {
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
} from './pod-validation';

// Namespace validation
export {
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
} from './namespace-validation';

// Cluster validation
export {
  validateSchedulingPolicy,
  validateDefaultResources,
  validatePositiveInteger,
  validateNonNegativeInteger,
  validateBoolean,
  validateUpdateClusterConfigInput,
  validatePriorityClassName as validatePriorityClassNameForClass,
  validatePriorityValue,
  validatePreemptionPolicy,
  validateCreatePriorityClassInput,
} from './cluster-validation';

// Scheduling validation
export {
  validateNodeSelectorRequirement,
  validateNodeSelectorTerm,
  validatePreferredSchedulingTerm,
  validateNodeAffinity,
  validateLabelSelector,
  validatePodAffinityTerm,
  validateWeightedPodAffinityTerm,
  validatePodAffinity,
  validatePodAntiAffinity,
  validateSchedulingConfig,
} from './scheduling-validation';

// Service validation
export {
  validateServiceName,
  validateServicePackId,
  validateServicePackName,
  validateReplicas,
  validateServiceNamespace,
  validateServiceStatus,
  validateServiceMetadata,
  validateFollowLatest,
  validateIngressPort,
  validateCreateServiceInput,
  validateUpdateServiceInput,
} from './service-validation';

// Secret validation
export {
  validateSecretName,
  validateSecretType,
  validateSecretData,
  validateSecretInjection,
  validateSecretNamespace,
  validateCreateSecretInput,
  validateUpdateSecretInput,
  validateMountPathConflicts,
} from './secret-validation';
