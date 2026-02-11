/**
 * Shared types for Stark Orchestrator
 * @module @stark-o/shared/types
 */

// Capability types
export type {
  Capability,
  CapabilityGrantContext,
  CapabilityGrantResult,
} from './capabilities.js';

export {
  ALL_CAPABILITIES,
  SYSTEM_ONLY_CAPABILITIES,
  DEFAULT_CAPABILITIES,
  UI_PACK_CAPABILITIES,
  isValidCapability,
  requiresSystemNamespace,
  grantCapabilities,
  hasCapability,
  hasAnyCapability,
  hasAllCapabilities,
  requiresMainThread,
  validateCapabilities,
} from './capabilities.js';

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
  PackVisibility,
  PackNamespace,
  RegisterPackInput,
  UpdatePackInput,
  PackVersionSummary,
  PackListItem,
  SemVer,
} from './pack.js';

export {
  isRuntimeCompatible,
  isNodeVersionCompatible,
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
  canRunSystemPacks,
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

// Service types
export type {
  Service,
  ServiceStatus,
  ServiceVisibility,
  CreateServiceInput,
  UpdateServiceInput,
  ServiceListItem,
} from './service.js';

export {
  isServiceActive,
  isServiceDaemonSet,
  isServiceReady,
  DEFAULT_SERVICE_RESOURCE_REQUESTS,
  DEFAULT_SERVICE_RESOURCE_LIMITS,
  VALID_SERVICE_VISIBILITY_VALUES,
} from './service.js';

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

// Event types
export type {
  EventCategory,
  EventSeverity,
  PodEventType,
  NodeEventType,
  PackEventType,
  ServiceEventType,
  SystemEventType,
  AuthEventType,
  SchedulerEventType,
  StarkEventType,
  EventActorType,
  EventSource,
  EventMetadata,
  StarkEvent,
  PodEventState,
  PodEvent,
  NodeEventState,
  NodeEvent,
  PackEventState,
  PackEvent,
  ServiceEventState,
  ServiceEvent,
  EmitPodEventInput,
  EmitNodeEventInput,
  EmitEventInput,
  EventQueryOptions,
  EventQueryResult,
  EventTimelineItem,
  EventSubscriptionFilter,
  EventCallback,
} from './events.js';

export {
  PodEventReasons,
  NodeEventReasons,
  SEVERITY_ORDER,
  compareSeverity,
  meetsMinSeverity,
  getDefaultSeverity,
  getCategoryFromEventType,
} from './events.js';

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

// Network types
export type {
  RegistryPodStatus,
  ServiceRegistryEntry,
  CachedTargetPod,
  NetworkPolicyAction,
  NetworkPolicy,
  CreateNetworkPolicyInput,
  ServiceRequest,
  ServiceResponse,
  PeerConnectionState,
  WebRTCConfig,
  RTCIceServerInit,
  SignallingMessageType,
  SignallingMessage,
  RoutingRequest,
  RoutingResponse,
  ServiceCallOptions,
  NetworkEventType,
} from './network.js';

export {
  DEFAULT_CACHE_TTL,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_SERVICE_CALL_TIMEOUT,
  INTERNAL_URL_SUFFIX,
  parseInternalUrl,
} from './network.js';