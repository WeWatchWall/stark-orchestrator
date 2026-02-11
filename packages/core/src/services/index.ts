/**
 * Core services exports
 * @module @stark-o/core/services
 */

export {
  PackRegistry,
  packRegistry,
  createPackRegistry,
  type PackRegistrationOptions,
  type PackOperationResult,
} from './pack-registry';

export {
  PodScheduler,
  podScheduler,
  createPodScheduler,
  PodSchedulerErrorCodes,
  type PodSchedulerOptions,
  type PodOperationResult as PodSchedulerOperationResult,
  type SchedulingResult,
} from './pod-scheduler';

export {
  NodeManager,
  nodeManager,
  createNodeManager,
  NodeManagerErrorCodes,
  type NodeManagerOptions,
  type NodeOperationResult,
  type NodeConnectionInfo,
  type HeartbeatCheckResult,
  type OnNodeUnhealthyCallback,
} from './node-manager';

export {
  AuthService,
  authService,
  createAuthService,
  AuthServiceErrorCodes,
  validateEmail,
  validatePassword,
  validateDisplayName,
  validateRegisterInput,
  validateLoginInput,
  normalizeEmail,
  DEFAULT_PASSWORD_REQUIREMENTS,
  type AuthServiceOptions,
  type AuthOperationResult,
  type AuthProvider,
  type AuthProviderResult,
  type AuthProviderError,
  type RegisterAuthInput,
  type LoginAuthInput,
  type UpdateAuthInput,
  type SessionState,
  type PasswordRequirements,
} from './auth';

export {
  NamespaceManager,
  namespaceManager,
  createNamespaceManager,
  NamespaceManagerErrorCodes,
  // Computed
  namespaceCount,
  activeNamespaceCount,
  namespacesByPhase,
  namespacesWithQuota,
  totalResourceUsage,
  // Store functions
  findNamespaceByName,
  findNamespacesBySelector,
  findNamespacesByPhase,
  namespaceExists,
  type NamespaceManagerOptions,
  type NamespaceOperationResult,
  type NamespaceCreationResult,
  type QuotaCheckResult,
} from './namespace-manager';

export {
  SecretManager,
  secretManager,
  createSecretManager,
  resetSecretManager,
  SecretManagerErrorCodes,
  type SecretManagerOptions,
  type SecretOperationResult,
} from './secret-manager';

export {
  encryptSecretData,
  decryptSecretData,
  wipeSecretMaterial,
  initMasterKey,
  resetMasterKey,
  type EncryptionResult,
} from './secret-crypto';
