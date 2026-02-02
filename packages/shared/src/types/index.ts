/**
 * Shared types for Stark Orchestrator
 * @module @stark-o/shared/types
 */

// User types
export type {
  User,
  UserRole,
  CreateUserInput,
  UpdateUserInput,
  UserSession,
} from './user.js';

export {
  hasRole,
  hasAnyRole,
  hasAllRoles,
  canManageResources,
  isNodeAgent,
  ALL_ROLES,
} from './user.js';

// Pack types
export type {
  Pack,
  RuntimeTag,
  PackMetadata,
  RegisterPackInput,
  UpdatePackInput,
  PackVersionSummary,
  PackListItem,
  SemVer,
} from './pack.js';

export {
  isRuntimeCompatible,
  parseSemVer,
  compareSemVer,
  ALL_RUNTIME_TAGS,
} from './pack.js';

// Node types
export type {
  Node,
  RuntimeType,
  NodeStatus,
  NodeCapabilities,
  AllocatableResources,
  RegisterNodeInput,
  UpdateNodeInput,
  NodeHeartbeat,
  NodeListItem,
} from './node.js';

export {
  getAvailableResources,
  hasAvailableResources,
  isNodeSchedulable,
  ALL_NODE_STATUSES,
  ALL_RUNTIME_TYPES,
  DEFAULT_ALLOCATABLE,
  DEFAULT_ALLOCATED,
} from './node.js';

// Pod types
export type {
  Pod,
  PodStatus,
  PodTerminationReason,
  ResourceRequirements,
  PodSchedulingConfig,
  CreatePodInput,
  UpdatePodInput,
  PodAction,
  PodHistoryEntry,
  PodListItem,
} from './pod.js';

export {
  isPodActive,
  isPodRunning,
  isPodTerminated,
  isPodSchedulable,
  shouldCountTowardCrashLoop,
  ALL_POD_STATUSES,
  ALL_POD_ACTIONS,
  ALL_TERMINATION_REASONS,
  INFRASTRUCTURE_TERMINATION_REASONS,
  OPERATOR_TERMINATION_REASONS,
  APPLICATION_TERMINATION_REASONS,
  DEFAULT_RESOURCE_REQUESTS,
  DEFAULT_RESOURCE_LIMITS,
} from './pod.js';

// Labels types
export type {
  Labels,
  Annotations,
  LabelSelectorOperator,
  LabelSelectorMatchExpression,
  LabelSelector,
} from './labels.js';

export {
  matchesExpression,
  matchesSelector,
  matchesLabels,
  mergeLabels,
  createSelector,
  isValidLabelKey,
  isValidLabelValue,
  validateLabels,
} from './labels.js';

// Taints types
export type {
  Taint,
  TaintEffect,
  Toleration,
  TolerationOperator,
} from './taints.js';

export {
  tolerationMatchesTaint,
  toleratesTaints,
  toleratesBlockingTaints,
  getEvictionTaints,
  getUntoleratedPreferNoScheduleTaints,
  CommonTaints,
  CommonTolerations,
  ALL_TAINT_EFFECTS,
  ALL_TOLERATION_OPERATORS,
} from './taints.js';

// Scheduling types
export type {
  SchedulingPolicy,
  NodeSelectorTerm,
  NodeSelectorRequirement,
  PreferredSchedulingTerm,
  NodeAffinity,
  PodAffinityTerm,
  WeightedPodAffinityTerm,
  PodAffinity,
  PodAntiAffinity,
  SchedulingConfig,
} from './scheduling.js';

export {
  matchesRequirement,
  matchesNodeSelectorTerm,
  calculateAffinityScore,
  ALL_SCHEDULING_POLICIES,
} from './scheduling.js';

// Namespace types
export type {
  Namespace,
  NamespacePhase,
  ResourceQuota,
  ResourceQuotaHard,
  LimitRange,
  ResourceLimitValue,
  ResourceUsage,
  CreateNamespaceInput,
  UpdateNamespaceInput,
  NamespaceListItem,
} from './namespace.js';

export {
  RESERVED_NAMESPACES,
  isReservedNamespace,
  hasQuotaAvailable,
  getRemainingQuota,
  applyLimitRangeDefaults,
  validateAgainstLimitRange,
  DEFAULT_RESOURCE_USAGE,
  ALL_NAMESPACE_PHASES,
} from './namespace.js';

// Cluster types
export type {
  ClusterConfig,
  DefaultResources,
  UpdateClusterConfigInput,
  ClusterStats,
  ClusterHealthStatus,
  ClusterHealth,
  PriorityClass,
  CreatePriorityClassInput,
} from './cluster.js';

export {
  BUILTIN_PRIORITY_CLASSES,
  DEFAULT_CLUSTER_CONFIG,
  getClusterHealthStatus,
  getResourceUtilization,
} from './cluster.js';

// Storage adapter types
export type {
  FileStats,
  DirectoryEntry,
  StorageAdapterConfig,
  IStorageAdapter,
  ISyncStorageAdapter,
} from './storage-adapter.js';

// HTTP adapter types
export type {
  HttpMethod,
  HttpAdapterConfig,
  HttpRequestOptions,
  HttpResponse,
  HttpAdapterErrorOptions,
  IHttpAdapter,
} from './http-adapter.js';

export { HttpAdapterError } from './http-adapter.js';

// Worker adapter types
export type {
  WorkerAdapterConfig,
  TaskOptions,
  TaskResult,
  PoolStats,
  TaskHandle,
  IWorkerAdapter,
  TransferableObject,
} from './worker-adapter.js';

export {
  TaskCancelledError,
  TaskTimeoutError,
  WorkerNotInitializedError,
  WorkerScriptRequiredError,
} from './worker-adapter.js';

// Deployment types
export type {
  Deployment,
  DeploymentStatus,
  CreateDeploymentInput,
  UpdateDeploymentInput,
  DeploymentListItem,
} from './deployment.js';

export {
  isDeploymentActive,
  isDeploymentDaemonSet,
  isDeploymentReady,
  DEFAULT_DEPLOYMENT_RESOURCE_REQUESTS,
  DEFAULT_DEPLOYMENT_RESOURCE_LIMITS,
} from './deployment.js';

// App config types
export type {
  AppConfig,
  UpdateAppConfigInput,
} from './app-config.js';

export {
  DEFAULT_APP_CONFIG,
} from './app-config.js';
// Runtime types (shared between node-runtime and browser-runtime)
export type {
  WsMessage,
  ConnectionState,
  BaseAgentEvent,
  PodAgentEvent,
  AgentEvent,
  AgentEventHandler,
  PodDeployPayload,
  PodStopPayload,
  LocalPodStatus,
  PodOperationResult,
  PodLifecyclePhase,
  PodLifecycleFacts,
  ShutdownHandler,
  PackExecutionContext,
  PackExecutionResult,
  ExecutionHandle,
  BasePodHandlerConfig,
  IPackExecutor,
} from './runtime.js';

export {
  mapLocalStatusToPodStatus,
} from './runtime.js';

// Metrics types
export type {
  NodeSystemMetrics,
  WorkerPoolStats,
  ResourceAllocationMetrics,
  NodeMetrics,
  NodeMetricsRecord,
  CreateNodeMetricsInput,
  PodExecutionStats,
  PodMetrics,
  PodMetricsRecord,
  CreatePodMetricsInput,
  SchedulingFailureReasons,
  SchedulingMetrics,
  SchedulingMetricsRecord,
  NodeStatusCounts,
  PodStatusCounts,
  ClusterResourceUtilization,
  RestartStats,
  ClusterMetrics,
  ClusterMetricsRecord,
  MetricsDashboard,
  MetricsTimeRange,
  MetricsQueryOptions,
} from './metrics.js';