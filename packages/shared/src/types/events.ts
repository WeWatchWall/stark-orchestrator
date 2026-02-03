/**
 * Event types for Stark Orchestrator
 * Events are first-class data for debugging, UI timelines, and audits.
 * @module @stark-o/shared/types/events
 */

// ============================================================================
// Event Categories
// ============================================================================

/**
 * High-level event categories for filtering
 */
export type EventCategory =
  | 'pod'        // Pod lifecycle events
  | 'node'       // Node lifecycle events
  | 'pack'       // Pack lifecycle events
  | 'deployment' // Deployment events
  | 'system'     // System-level events
  | 'auth'       // Authentication events
  | 'scheduler'; // Scheduler events

/**
 * Event severity levels
 */
export type EventSeverity =
  | 'info'     // Informational events
  | 'warning'  // Warning events (degraded state)
  | 'error'    // Error events (failures)
  | 'critical'; // Critical events (requires immediate attention)

// ============================================================================
// Pod Event Types
// ============================================================================

/**
 * All pod event types
 */
export type PodEventType =
  | 'PodCreated'
  | 'PodScheduled'
  | 'PodScheduleFailed'
  | 'PodStarting'
  | 'PodStarted'
  | 'PodRunning'
  | 'PodStopped'
  | 'PodFailed'
  | 'PodRestarted'
  | 'PodRolledBack'
  | 'PodEvicted'
  | 'PodScaled'
  | 'PodUpdated'
  | 'PodDeleted'
  | 'PodStatusChanged';

// ============================================================================
// Node Event Types
// ============================================================================

/**
 * All node event types
 */
export type NodeEventType =
  | 'NodeRegistered'
  | 'NodeReady'
  | 'NodeLost'
  | 'NodeRecovered'
  | 'NodeDraining'
  | 'NodeDrained'
  | 'NodeCordoned'
  | 'NodeUncordoned'
  | 'NodeDeleted'
  | 'NodeStatusChanged'
  | 'NodeResourcePressure';

// ============================================================================
// Pack Event Types
// ============================================================================

/**
 * All pack event types
 */
export type PackEventType =
  | 'PackPublished'
  | 'PackUpdated'
  | 'PackDeleted'
  | 'PackVersionPublished'
  | 'PackVersionDeprecated';

// ============================================================================
// Deployment Event Types
// ============================================================================

/**
 * All deployment event types
 */
export type DeploymentEventType =
  | 'DeploymentCreated'
  | 'DeploymentScaled'
  | 'DeploymentRollingUpdate'
  | 'DeploymentRollback'
  | 'DeploymentPaused'
  | 'DeploymentResumed'
  | 'DeploymentCompleted'
  | 'DeploymentFailed'
  | 'DeploymentDeleted';

// ============================================================================
// System Event Types
// ============================================================================

/**
 * All system event types
 */
export type SystemEventType =
  | 'ClusterStarted'
  | 'ClusterStopped'
  | 'ConfigChanged'
  | 'SchedulerStarted'
  | 'SchedulerStopped'
  | 'GarbageCollectionRun';

// ============================================================================
// Auth Event Types
// ============================================================================

/**
 * All authentication event types
 */
export type AuthEventType =
  | 'UserLoggedIn'
  | 'UserLoggedOut'
  | 'TokenRefreshed'
  | 'PermissionDenied';

// ============================================================================
// Scheduler Event Types
// ============================================================================

/**
 * All scheduler event types
 */
export type SchedulerEventType =
  | 'SchedulingCycleStarted'
  | 'SchedulingCycleCompleted'
  | 'NoNodesAvailable'
  | 'PreemptionTriggered';

// ============================================================================
// Combined Event Type
// ============================================================================

/**
 * All event types in the system
 */
export type StarkEventType =
  | PodEventType
  | NodeEventType
  | PackEventType
  | DeploymentEventType
  | SystemEventType
  | AuthEventType
  | SchedulerEventType;

// ============================================================================
// Event Actor Types
// ============================================================================

/**
 * Who or what caused the event
 */
export type EventActorType =
  | 'user'      // Human user action
  | 'system'    // System automation
  | 'scheduler' // Scheduler decision
  | 'node';     // Node-initiated

// ============================================================================
// Event Source Types
// ============================================================================

/**
 * Where the event originated
 */
export type EventSource =
  | 'server'   // Orchestrator server
  | 'node'     // Node runtime
  | 'client'   // Client application
  | 'cli'      // CLI tool
  | 'scheduler'; // Scheduler

// ============================================================================
// Core Event Interfaces
// ============================================================================

/**
 * Base event metadata
 */
export interface EventMetadata {
  /** Event source */
  source?: EventSource;
  /** Request correlation ID for tracing */
  correlationId?: string;
  /** Acting user ID */
  userId?: string;
  /** Additional custom metadata */
  [key: string]: unknown;
}

/**
 * Base Stark event structure
 */
export interface StarkEvent<T = unknown> {
  /** Unique event identifier */
  id: string;
  /** Specific event type */
  eventType: StarkEventType;
  /** High-level category */
  category: EventCategory;
  /** Severity level */
  severity: EventSeverity;
  /** Primary resource ID */
  resourceId?: string;
  /** Resource type (pod, node, pack, etc.) */
  resourceType?: string;
  /** Human-readable resource name */
  resourceName?: string;
  /** Namespace context */
  namespace?: string;
  /** Actor who caused the event */
  actorId?: string;
  /** Actor type */
  actorType: EventActorType;
  /** Short reason code */
  reason?: string;
  /** Human-readable message */
  message?: string;
  /** Previous state snapshot */
  previousState?: T;
  /** New state snapshot */
  newState?: T;
  /** Related resource ID */
  relatedResourceId?: string;
  /** Related resource type */
  relatedResourceType?: string;
  /** Related resource name */
  relatedResourceName?: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
  /** Event source */
  source: EventSource;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** When the event occurred */
  timestamp: Date;
}

// ============================================================================
// Specific Event Payload Types
// ============================================================================

/**
 * Pod state for event tracking
 */
export interface PodEventState {
  status?: string;
  version?: string;
  nodeId?: string;
  nodeName?: string;
}

/**
 * Pod event with typed state
 */
export type PodEvent = StarkEvent<PodEventState> & {
  category: 'pod';
  eventType: PodEventType;
  resourceType: 'pod';
};

/**
 * Node state for event tracking
 */
export interface NodeEventState {
  status?: string;
  runtimeType?: string;
  runningPods?: number;
}

/**
 * Node event with typed state
 */
export type NodeEvent = StarkEvent<NodeEventState> & {
  category: 'node';
  eventType: NodeEventType;
  resourceType: 'node';
};

/**
 * Pack state for event tracking
 */
export interface PackEventState {
  version?: string;
  visibility?: string;
}

/**
 * Pack event with typed state
 */
export type PackEvent = StarkEvent<PackEventState> & {
  category: 'pack';
  eventType: PackEventType;
  resourceType: 'pack';
};

/**
 * Deployment state for event tracking
 */
export interface DeploymentEventState {
  replicas?: number;
  readyReplicas?: number;
  version?: string;
  status?: string;
}

/**
 * Deployment event with typed state
 */
export type DeploymentEvent = StarkEvent<DeploymentEventState> & {
  category: 'deployment';
  eventType: DeploymentEventType;
  resourceType: 'deployment';
};

// ============================================================================
// Event Creation Helpers
// ============================================================================

/**
 * Input for creating a pod event
 */
export interface EmitPodEventInput {
  eventType: PodEventType;
  podId: string;
  podName?: string;
  namespace?: string;
  severity?: EventSeverity;
  actorId?: string;
  reason?: string;
  message?: string;
  previousStatus?: string;
  newStatus?: string;
  nodeId?: string;
  nodeName?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Input for creating a node event
 */
export interface EmitNodeEventInput {
  eventType: NodeEventType;
  nodeId: string;
  nodeName?: string;
  severity?: EventSeverity;
  actorId?: string;
  reason?: string;
  message?: string;
  previousStatus?: string;
  newStatus?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Input for creating a generic event
 */
export interface EmitEventInput {
  eventType: StarkEventType;
  category: EventCategory;
  resourceId?: string;
  resourceType?: string;
  resourceName?: string;
  namespace?: string;
  severity?: EventSeverity;
  actorId?: string;
  actorType?: EventActorType;
  reason?: string;
  message?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  relatedResourceId?: string;
  relatedResourceType?: string;
  relatedResourceName?: string;
  metadata?: Record<string, unknown>;
  source?: EventSource;
  correlationId?: string;
}

// ============================================================================
// Event Query Interfaces
// ============================================================================

/**
 * Options for querying events
 */
export interface EventQueryOptions {
  /** Filter by category */
  category?: EventCategory;
  /** Filter by event type */
  eventType?: StarkEventType;
  /** Filter by resource type */
  resourceType?: string;
  /** Filter by resource ID */
  resourceId?: string;
  /** Filter by namespace */
  namespace?: string;
  /** Filter by severity */
  severity?: EventSeverity | EventSeverity[];
  /** Events after this time */
  since?: Date;
  /** Events before this time */
  until?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Order direction */
  order?: 'asc' | 'desc';
}

/**
 * Paginated event result
 */
export interface EventQueryResult {
  events: StarkEvent[];
  total: number;
  hasMore: boolean;
}

/**
 * Event timeline item (simplified for UI display)
 */
export interface EventTimelineItem {
  id: string;
  eventType: StarkEventType;
  category: EventCategory;
  severity: EventSeverity;
  resourceType?: string;
  resourceName?: string;
  reason?: string;
  message?: string;
  timestamp: Date;
}

// ============================================================================
// Event Subscription Types (for real-time updates)
// ============================================================================

/**
 * Event subscription filter
 */
export interface EventSubscriptionFilter {
  /** Filter by categories */
  categories?: EventCategory[];
  /** Filter by event types */
  eventTypes?: StarkEventType[];
  /** Filter by resource types */
  resourceTypes?: string[];
  /** Filter by namespace */
  namespace?: string;
  /** Filter by minimum severity */
  minSeverity?: EventSeverity;
}

/**
 * Event callback for subscriptions
 */
export type EventCallback = (event: StarkEvent) => void;

// ============================================================================
// Predefined Event Reasons
// ============================================================================

/**
 * Common pod event reasons
 */
export const PodEventReasons = {
  // Scheduling
  Scheduled: 'Scheduled',
  ScheduleFailed: 'ScheduleFailed',
  NoNodesAvailable: 'NoNodesAvailable',
  AffinityNotSatisfied: 'AffinityNotSatisfied',
  InsufficientResources: 'InsufficientResources',
  TaintNotTolerated: 'TaintNotTolerated',
  
  // Lifecycle
  Created: 'Created',
  Started: 'Started',
  Stopped: 'Stopped',
  Deleted: 'Deleted',
  
  // Failures
  Failed: 'Failed',
  OOMKilled: 'OOMKilled',
  CrashLoopBackOff: 'CrashLoopBackOff',
  ImagePullError: 'ImagePullError',
  StartupFailed: 'StartupFailed',
  
  // Eviction
  Evicted: 'Evicted',
  NodeDrain: 'NodeDrain',
  ResourcePressure: 'ResourcePressure',
  Preempted: 'Preempted',
  
  // Updates
  RolledBack: 'RolledBack',
  Restarted: 'Restarted',
  Scaled: 'Scaled',
} as const;

/**
 * Common node event reasons
 */
export const NodeEventReasons = {
  // Registration
  Registered: 'Registered',
  RegistrationFailed: 'RegistrationFailed',
  
  // Health
  HeartbeatTimeout: 'HeartbeatTimeout',
  HeartbeatRestored: 'HeartbeatRestored',
  HealthCheckFailed: 'HealthCheckFailed',
  
  // Status
  Ready: 'Ready',
  NotReady: 'NotReady',
  Cordoned: 'Cordoned',
  Uncordoned: 'Uncordoned',
  
  // Drain
  Draining: 'Draining',
  Drained: 'Drained',
  DrainFailed: 'DrainFailed',
  
  // Resources
  MemoryPressure: 'MemoryPressure',
  DiskPressure: 'DiskPressure',
  PodPressure: 'PodPressure',
} as const;

// ============================================================================
// Severity Helpers
// ============================================================================

/**
 * Severity levels in order of importance
 */
export const SEVERITY_ORDER: Record<EventSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

/**
 * Compare severity levels
 */
export function compareSeverity(a: EventSeverity, b: EventSeverity): number {
  return SEVERITY_ORDER[a] - SEVERITY_ORDER[b];
}

/**
 * Check if severity meets minimum threshold
 */
export function meetsMinSeverity(severity: EventSeverity, minSeverity: EventSeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[minSeverity];
}

/**
 * Get default severity for an event type
 */
export function getDefaultSeverity(eventType: StarkEventType): EventSeverity {
  // Error events
  if (eventType.includes('Failed') || eventType.includes('Lost') || eventType === 'PermissionDenied') {
    return 'error';
  }
  
  // Warning events
  if (eventType.includes('Evicted') || eventType.includes('Pressure') || eventType.includes('Draining')) {
    return 'warning';
  }
  
  // Default to info
  return 'info';
}

/**
 * Get category from event type
 */
export function getCategoryFromEventType(eventType: StarkEventType): EventCategory {
  if (eventType.startsWith('Pod')) return 'pod';
  if (eventType.startsWith('Node')) return 'node';
  if (eventType.startsWith('Pack')) return 'pack';
  if (eventType.startsWith('Deployment')) return 'deployment';
  if (eventType.startsWith('Cluster') || eventType.startsWith('Config') || eventType.startsWith('Garbage')) return 'system';
  if (eventType.startsWith('User') || eventType.startsWith('Token') || eventType.startsWith('Permission')) return 'auth';
  if (eventType.startsWith('Scheduling') || eventType.startsWith('NoNodes') || eventType.startsWith('Preemption')) return 'scheduler';
  return 'system';
}
