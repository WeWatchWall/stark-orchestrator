/**
 * ClusterConfig, ResourceLimits, and SchedulingPolicy types (Kubernetes-like)
 * @module @stark-o/shared/types/cluster
 */

import type { Annotations } from './labels';
import type { SchedulingPolicy } from './scheduling';

/**
 * Default resource configuration
 */
export interface DefaultResources {
  /** CPU in millicores */
  cpu: number;
  /** Memory in MB */
  memory: number;
}

/**
 * Cluster configuration
 */
export interface ClusterConfig {
  /** Unique identifier (UUID) */
  id: string;
  /** Config name */
  name: string;
  /** Maximum pods per node */
  maxPodsPerNode: number;
  /** Default namespace for resources */
  defaultNamespace: string;
  /** Default scheduling policy */
  schedulingPolicy: SchedulingPolicy;
  /** Default resource requests for pods */
  defaultResourceRequests: DefaultResources;
  /** Default resource limits for pods */
  defaultResourceLimits: DefaultResources;
  /** Maximum total pods in cluster */
  maxTotalPods?: number;
  /** Maximum total nodes in cluster */
  maxTotalNodes?: number;
  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs: number;
  /** Heartbeat timeout in milliseconds */
  heartbeatTimeoutMs: number;
  /** Pod termination grace period in milliseconds */
  podTerminationGracePeriodMs: number;
  /** Whether priority-based preemption is enabled */
  enablePreemption: boolean;
  /** Annotations for metadata */
  annotations: Annotations;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Cluster config update input
 */
export interface UpdateClusterConfigInput {
  maxPodsPerNode?: number;
  defaultNamespace?: string;
  schedulingPolicy?: SchedulingPolicy;
  defaultResourceRequests?: Partial<DefaultResources>;
  defaultResourceLimits?: Partial<DefaultResources>;
  maxTotalPods?: number;
  maxTotalNodes?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  podTerminationGracePeriodMs?: number;
  enablePreemption?: boolean;
  annotations?: Annotations;
}

/**
 * Cluster statistics
 */
export interface ClusterStats {
  /** Total number of nodes */
  totalNodes: number;
  /** Number of healthy nodes */
  healthyNodes: number;
  /** Number of unhealthy nodes */
  unhealthyNodes: number;
  /** Total number of pods */
  totalPods: number;
  /** Number of running pods */
  runningPods: number;
  /** Number of pending pods */
  pendingPods: number;
  /** Total allocatable CPU across all nodes */
  totalCpu: number;
  /** Total allocated CPU */
  allocatedCpu: number;
  /** Total allocatable memory across all nodes */
  totalMemory: number;
  /** Total allocated memory */
  allocatedMemory: number;
  /** Number of namespaces */
  namespaceCount: number;
  /** Number of registered packs */
  packCount: number;
}

/**
 * Cluster health status
 */
export type ClusterHealthStatus = 'healthy' | 'degraded' | 'critical';

/**
 * Cluster health report
 */
export interface ClusterHealth {
  /** Overall status */
  status: ClusterHealthStatus;
  /** Health message */
  message: string;
  /** Individual component statuses */
  components: {
    nodes: { healthy: number; total: number };
    pods: { running: number; failed: number; pending: number };
    schedulerReady: boolean;
  };
  /** Last check timestamp */
  checkedAt: Date;
}

/**
 * Priority class definition
 */
export interface PriorityClass {
  /** Unique identifier (UUID) */
  id: string;
  /** Priority class name */
  name: string;
  /** Priority value (higher = more important) */
  value: number;
  /** Whether this is the global default */
  globalDefault: boolean;
  /** Preemption policy */
  preemptionPolicy: 'PreemptLowerPriority' | 'Never';
  /** Description */
  description?: string;
  /** Labels */
  labels: Record<string, string>;
  /** Annotations */
  annotations: Annotations;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Priority class creation input
 */
export interface CreatePriorityClassInput {
  name: string;
  value: number;
  globalDefault?: boolean;
  preemptionPolicy?: 'PreemptLowerPriority' | 'Never';
  description?: string;
  labels?: Record<string, string>;
  annotations?: Annotations;
}

/**
 * Built-in priority classes
 */
export const BUILTIN_PRIORITY_CLASSES = {
  /** System node critical (highest) */
  SYSTEM_NODE_CRITICAL: {
    name: 'system-node-critical',
    value: 2000001000,
  },
  /** System cluster critical */
  SYSTEM_CLUSTER_CRITICAL: {
    name: 'system-cluster-critical',
    value: 2000000000,
  },
  /** High priority */
  HIGH_PRIORITY: {
    name: 'high-priority',
    value: 1000000,
  },
  /** Default priority */
  DEFAULT: {
    name: 'default',
    value: 0,
  },
  /** Low priority */
  LOW_PRIORITY: {
    name: 'low-priority',
    value: -1000,
  },
  /** Best effort (lowest) */
  BEST_EFFORT: {
    name: 'best-effort',
    value: -1000000,
  },
} as const;

/**
 * Default cluster configuration
 */
export const DEFAULT_CLUSTER_CONFIG: Omit<ClusterConfig, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'default',
  maxPodsPerNode: 110,
  defaultNamespace: 'default',
  schedulingPolicy: 'spread',
  defaultResourceRequests: {
    cpu: 100,
    memory: 128,
  },
  defaultResourceLimits: {
    cpu: 500,
    memory: 512,
  },
  maxTotalPods: 10000,
  maxTotalNodes: 1000,
  heartbeatIntervalMs: 10000,
  heartbeatTimeoutMs: 30000,
  podTerminationGracePeriodMs: 30000,
  enablePreemption: true,
  annotations: {},
};

/**
 * Calculate cluster health status from stats
 */
export function getClusterHealthStatus(stats: ClusterStats): ClusterHealth {
  const nodeHealthPercent = stats.totalNodes > 0 
    ? (stats.healthyNodes / stats.totalNodes) * 100 
    : 100;
  
  let status: ClusterHealthStatus = 'healthy';
  let message = 'All systems operational';

  if (nodeHealthPercent < 50) {
    status = 'critical';
    message = `Critical: Only ${stats.healthyNodes}/${stats.totalNodes} nodes are healthy`;
  } else if (nodeHealthPercent < 80) {
    status = 'degraded';
    message = `Degraded: ${stats.unhealthyNodes} nodes are unhealthy`;
  } else if (stats.pendingPods > stats.runningPods * 0.1) {
    status = 'degraded';
    message = `Degraded: ${stats.pendingPods} pods are pending scheduling`;
  }

  return {
    status,
    message,
    components: {
      nodes: { healthy: stats.healthyNodes, total: stats.totalNodes },
      pods: { 
        running: stats.runningPods, 
        failed: stats.totalPods - stats.runningPods - stats.pendingPods,
        pending: stats.pendingPods,
      },
      schedulerReady: status !== 'critical',
    },
    checkedAt: new Date(),
  };
}

/**
 * Calculate resource utilization percentage
 */
export function getResourceUtilization(stats: ClusterStats): {
  cpu: number;
  memory: number;
} {
  return {
    cpu: stats.totalCpu > 0 ? (stats.allocatedCpu / stats.totalCpu) * 100 : 0,
    memory: stats.totalMemory > 0 ? (stats.allocatedMemory / stats.totalMemory) * 100 : 0,
  };
}
