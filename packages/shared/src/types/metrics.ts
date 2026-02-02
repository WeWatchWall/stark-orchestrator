/**
 * Metrics type definitions
 * @module @stark-o/shared/types/metrics
 */

import type { RuntimeType } from './node.js';
import type { PodStatus } from './pod.js';

// ============================================================================
// Node Metrics Types
// ============================================================================

/**
 * System metrics collected from a node
 */
export interface NodeSystemMetrics {
  /** Uptime in seconds */
  uptimeSeconds: number;
  /** CPU usage percentage (0-100) */
  cpuUsagePercent?: number;
  /** Memory used in bytes */
  memoryUsedBytes?: number;
  /** Total memory in bytes */
  memoryTotalBytes?: number;
  /** Memory usage percentage (0-100) */
  memoryUsagePercent?: number;
  /** Runtime version (e.g., 'v20.10.0' for Node.js) */
  runtimeVersion?: string;
}

/**
 * Worker pool statistics (Node.js only)
 */
export interface WorkerPoolStats {
  /** Total workers in the pool */
  totalWorkers: number;
  /** Workers currently executing */
  busyWorkers: number;
  /** Workers available for work */
  idleWorkers: number;
  /** Tasks waiting in queue */
  pendingTasks: number;
}

/**
 * Resource allocation metrics
 */
export interface ResourceAllocationMetrics {
  /** Pods allocated */
  podsAllocated: number;
  /** Pod capacity */
  podsCapacity: number;
  /** CPU allocated (millicores) */
  cpuAllocated: number;
  /** CPU capacity (millicores) */
  cpuCapacity: number;
  /** Memory allocated (bytes) */
  memoryAllocatedBytes: number;
  /** Memory capacity (bytes) */
  memoryCapacityBytes: number;
}

/**
 * Complete node metrics payload
 */
export interface NodeMetrics {
  /** Node ID */
  nodeId: string;
  /** Runtime type */
  runtimeType: RuntimeType;
  /** System metrics */
  system: NodeSystemMetrics;
  /** Resource allocation */
  resources: ResourceAllocationMetrics;
  /** Worker pool stats (Node.js only) */
  workerPool?: WorkerPoolStats;
  /** Timestamp when metrics were collected */
  timestamp: Date;
}

/**
 * Node metrics stored in database
 */
export interface NodeMetricsRecord extends NodeMetrics {
  /** Record ID */
  id: string;
  /** When the record was created */
  recordedAt: Date;
  createdAt: Date;
}

/**
 * Input for creating node metrics
 */
export interface CreateNodeMetricsInput {
  nodeId: string;
  runtimeType: RuntimeType;
  uptimeSeconds: number;
  cpuUsagePercent?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
  memoryUsagePercent?: number;
  runtimeVersion?: string;
  podsAllocated: number;
  podsCapacity: number;
  cpuAllocated: number;
  cpuCapacity: number;
  memoryAllocatedBytes: number;
  memoryCapacityBytes: number;
  workerPoolTotal?: number;
  workerPoolBusy?: number;
  workerPoolIdle?: number;
  workerPoolPendingTasks?: number;
}

// ============================================================================
// Pod Metrics Types
// ============================================================================

/**
 * Execution statistics for a pod
 */
export interface PodExecutionStats {
  /** Total execution count */
  executionCount: number;
  /** Successful executions */
  successfulExecutions: number;
  /** Failed executions */
  failedExecutions: number;
  /** Total execution time in ms */
  totalExecutionTimeMs: number;
  /** Average execution time in ms */
  avgExecutionTimeMs?: number;
  /** Last execution timestamp */
  lastExecutionAt?: Date;
}

/**
 * Complete pod metrics payload
 */
export interface PodMetrics {
  /** Pod ID */
  podId: string;
  /** Node ID where pod is running */
  nodeId?: string;
  /** Current status */
  status: PodStatus;
  /** Restart count */
  restartCount: number;
  /** Execution statistics */
  execution: PodExecutionStats;
  /** CPU usage (if available) */
  cpuUsagePercent?: number;
  /** Memory used (if available) */
  memoryUsedBytes?: number;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Pod metrics stored in database
 */
export interface PodMetricsRecord extends PodMetrics {
  /** Record ID */
  id: string;
  /** When the record was created */
  recordedAt: Date;
  createdAt: Date;
}

/**
 * Input for creating pod metrics
 */
export interface CreatePodMetricsInput {
  podId: string;
  nodeId?: string;
  status: PodStatus;
  restartCount: number;
  executionCount: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalExecutionTimeMs: number;
  avgExecutionTimeMs?: number;
  lastExecutionAt?: Date;
  cpuUsagePercent?: number;
  memoryUsedBytes?: number;
}

// ============================================================================
// Scheduling Metrics Types
// ============================================================================

/**
 * Failure reason breakdown
 */
export interface SchedulingFailureReasons {
  /** No nodes available at all */
  noNodesAvailable?: number;
  /** Insufficient CPU */
  insufficientCpu?: number;
  /** Insufficient memory */
  insufficientMemory?: number;
  /** Insufficient pod capacity */
  insufficientPodCapacity?: number;
  /** Taint/toleration mismatch */
  taintMismatch?: number;
  /** Node selector mismatch */
  nodeSelectorMismatch?: number;
  /** Affinity mismatch */
  affinityMismatch?: number;
  /** Other reasons */
  other?: number;
  /** Custom reasons */
  [key: string]: number | undefined;
}

/**
 * Scheduling metrics for a time window
 */
export interface SchedulingMetrics {
  /** Window start time */
  windowStart: Date;
  /** Window end time */
  windowEnd: Date;
  /** Total scheduling attempts */
  schedulingAttempts: number;
  /** Successful schedulings */
  schedulingSuccesses: number;
  /** Failed schedulings */
  schedulingFailures: number;
  /** Failure reasons breakdown */
  failureReasons: SchedulingFailureReasons;
  /** Average scheduling latency in ms */
  avgSchedulingLatencyMs?: number;
  /** Max scheduling latency in ms */
  maxSchedulingLatencyMs?: number;
  /** Min scheduling latency in ms */
  minSchedulingLatencyMs?: number;
  /** Pending pods at window end */
  pendingPodsCount: number;
}

/**
 * Scheduling metrics stored in database
 */
export interface SchedulingMetricsRecord extends SchedulingMetrics {
  /** Record ID */
  id: string;
  /** When the record was created */
  createdAt: Date;
}

// ============================================================================
// Cluster Metrics Types
// ============================================================================

/**
 * Node status counts
 */
export interface NodeStatusCounts {
  total: number;
  online: number;
  offline: number;
  unhealthy: number;
  draining: number;
  maintenance: number;
}

/**
 * Pod status counts
 */
export interface PodStatusCounts {
  total: number;
  pending: number;
  scheduled: number;
  starting: number;
  running: number;
  stopping: number;
  stopped: number;
  failed: number;
  evicted: number;
  /** Desired pods from deployments */
  desired: number;
}

/**
 * Cluster resource utilization
 */
export interface ClusterResourceUtilization {
  /** Total CPU capacity (millicores) */
  totalCpuCapacity: number;
  /** Total memory capacity (bytes) */
  totalMemoryCapacityBytes: number;
  /** Total pod capacity */
  totalPodsCapacity: number;
  /** Allocated CPU (millicores) */
  totalCpuAllocated: number;
  /** Allocated memory (bytes) */
  totalMemoryAllocatedBytes: number;
  /** Allocated pods */
  totalPodsAllocated: number;
  /** CPU utilization percentage */
  cpuUtilizationPercent: number;
  /** Memory utilization percentage */
  memoryUtilizationPercent: number;
  /** Pod utilization percentage */
  podsUtilizationPercent: number;
}

/**
 * Restart statistics
 */
export interface RestartStats {
  /** Total restarts across all pods */
  totalPodRestarts: number;
  /** Number of pods that have restarted */
  podsWithRestarts: number;
}

/**
 * Complete cluster metrics
 */
export interface ClusterMetrics {
  /** Node status counts */
  nodes: NodeStatusCounts;
  /** Pod status counts */
  pods: PodStatusCounts;
  /** Resource utilization */
  resources: ClusterResourceUtilization;
  /** Restart statistics */
  restarts: RestartStats;
  /** Scheduling failures in last hour */
  schedulingFailuresLastHour: number;
  /** Average scheduling latency */
  avgSchedulingLatencyMs?: number;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Cluster metrics stored in database
 */
export interface ClusterMetricsRecord {
  /** Record ID */
  id: string;
  /** Node counts */
  nodesTotal: number;
  nodesOnline: number;
  nodesOffline: number;
  nodesUnhealthy: number;
  nodesDraining: number;
  /** Pod counts */
  podsTotal: number;
  podsPending: number;
  podsScheduled: number;
  podsStarting: number;
  podsRunning: number;
  podsStopping: number;
  podsStopped: number;
  podsFailed: number;
  podsEvicted: number;
  podsDesired: number;
  /** Resource capacity */
  totalCpuCapacity: number;
  totalMemoryCapacityBytes: number;
  totalPodsCapacity: number;
  /** Resource allocation */
  totalCpuAllocated: number;
  totalMemoryAllocatedBytes: number;
  totalPodsAllocated: number;
  /** Utilization percentages */
  cpuUtilizationPercent: number;
  memoryUtilizationPercent: number;
  podsUtilizationPercent: number;
  /** Scheduling health */
  schedulingFailuresLastHour: number;
  avgSchedulingLatencyMs?: number;
  /** Restart metrics */
  totalPodRestarts: number;
  podsWithRestarts: number;
  /** Timestamps */
  recordedAt: Date;
  createdAt: Date;
}

// ============================================================================
// Metrics Summary Types (for API responses)
// ============================================================================

/**
 * Dashboard metrics summary
 */
export interface MetricsDashboard {
  /** Latest cluster metrics */
  cluster: ClusterMetrics;
  /** Latest node metrics per node */
  nodes: NodeMetricsRecord[];
  /** Pods with highest restart counts */
  topRestartingPods: Array<{
    podId: string;
    podName?: string;
    restartCount: number;
  }>;
  /** Recent scheduling failures */
  recentSchedulingFailures: number;
  /** Uptime summary */
  uptime: {
    /** Oldest node uptime */
    maxNodeUptimeSeconds: number;
    /** Average node uptime */
    avgNodeUptimeSeconds: number;
  };
}

/**
 * Time range for metrics queries
 */
export interface MetricsTimeRange {
  /** Start time */
  start: Date;
  /** End time */
  end: Date;
}

/**
 * Options for metrics queries
 */
export interface MetricsQueryOptions {
  /** Time range */
  timeRange?: MetricsTimeRange;
  /** Node ID filter */
  nodeId?: string;
  /** Pod ID filter */
  podId?: string;
  /** Maximum number of records */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}
