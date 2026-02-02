/**
 * Metrics CRUD Queries
 *
 * Provides database operations for metrics using Supabase.
 * @module @stark-o/server/supabase/metrics
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  NodeMetricsRecord,
  CreateNodeMetricsInput,
  PodMetricsRecord,
  CreatePodMetricsInput,
  SchedulingMetricsRecord,
  SchedulingFailureReasons,
  ClusterMetricsRecord,
  MetricsQueryOptions,
  RuntimeType,
  PodStatus,
} from '@stark-o/shared';
import { getSupabaseServiceClient } from './client.js';

/**
 * Result type for database operations
 */
export interface MetricsResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

// ============================================================================
// Database Row Types
// ============================================================================

interface NodeMetricsRow {
  id: string;
  node_id: string;
  uptime_seconds: number;
  cpu_usage_percent: number | null;
  memory_used_bytes: number | null;
  memory_total_bytes: number | null;
  memory_usage_percent: number | null;
  runtime_type: RuntimeType;
  runtime_version: string | null;
  pods_allocated: number;
  pods_capacity: number;
  cpu_allocated: number;
  cpu_capacity: number;
  memory_allocated_bytes: number;
  memory_capacity_bytes: number;
  worker_pool_total: number | null;
  worker_pool_busy: number | null;
  worker_pool_idle: number | null;
  worker_pool_pending_tasks: number | null;
  recorded_at: string;
  created_at: string;
}

interface PodMetricsRow {
  id: string;
  pod_id: string;
  node_id: string | null;
  status: PodStatus;
  restart_count: number;
  execution_count: number;
  successful_executions: number;
  failed_executions: number;
  total_execution_time_ms: number;
  avg_execution_time_ms: number | null;
  last_execution_at: string | null;
  cpu_usage_percent: number | null;
  memory_used_bytes: number | null;
  recorded_at: string;
  created_at: string;
}

interface SchedulingMetricsRow {
  id: string;
  window_start: string;
  window_end: string;
  scheduling_attempts: number;
  scheduling_successes: number;
  scheduling_failures: number;
  failure_reasons: Record<string, number>;
  avg_scheduling_latency_ms: number | null;
  max_scheduling_latency_ms: number | null;
  min_scheduling_latency_ms: number | null;
  pending_pods_count: number;
  created_at: string;
}

interface ClusterMetricsRow {
  id: string;
  nodes_total: number;
  nodes_online: number;
  nodes_offline: number;
  nodes_unhealthy: number;
  nodes_draining: number;
  pods_total: number;
  pods_pending: number;
  pods_scheduled: number;
  pods_starting: number;
  pods_running: number;
  pods_stopping: number;
  pods_stopped: number;
  pods_failed: number;
  pods_evicted: number;
  pods_desired: number;
  total_cpu_capacity: number;
  total_memory_capacity_bytes: number;
  total_pods_capacity: number;
  total_cpu_allocated: number;
  total_memory_allocated_bytes: number;
  total_pods_allocated: number;
  cpu_utilization_percent: number;
  memory_utilization_percent: number;
  pods_utilization_percent: number;
  scheduling_failures_last_hour: number;
  avg_scheduling_latency_ms: number | null;
  total_pod_restarts: number;
  pods_with_restarts: number;
  recorded_at: string;
  created_at: string;
}

// ============================================================================
// Row Conversion Functions
// ============================================================================

function rowToNodeMetrics(row: NodeMetricsRow): NodeMetricsRecord {
  return {
    id: row.id,
    nodeId: row.node_id,
    runtimeType: row.runtime_type,
    system: {
      uptimeSeconds: row.uptime_seconds,
      cpuUsagePercent: row.cpu_usage_percent ?? undefined,
      memoryUsedBytes: row.memory_used_bytes ?? undefined,
      memoryTotalBytes: row.memory_total_bytes ?? undefined,
      memoryUsagePercent: row.memory_usage_percent ?? undefined,
      runtimeVersion: row.runtime_version ?? undefined,
    },
    resources: {
      podsAllocated: row.pods_allocated,
      podsCapacity: row.pods_capacity,
      cpuAllocated: row.cpu_allocated,
      cpuCapacity: row.cpu_capacity,
      memoryAllocatedBytes: row.memory_allocated_bytes,
      memoryCapacityBytes: row.memory_capacity_bytes,
    },
    workerPool: row.worker_pool_total !== null ? {
      totalWorkers: row.worker_pool_total,
      busyWorkers: row.worker_pool_busy ?? 0,
      idleWorkers: row.worker_pool_idle ?? 0,
      pendingTasks: row.worker_pool_pending_tasks ?? 0,
    } : undefined,
    timestamp: new Date(row.recorded_at),
    recordedAt: new Date(row.recorded_at),
    createdAt: new Date(row.created_at),
  };
}

function rowToPodMetrics(row: PodMetricsRow): PodMetricsRecord {
  return {
    id: row.id,
    podId: row.pod_id,
    nodeId: row.node_id ?? undefined,
    status: row.status,
    restartCount: row.restart_count,
    execution: {
      executionCount: row.execution_count,
      successfulExecutions: row.successful_executions,
      failedExecutions: row.failed_executions,
      totalExecutionTimeMs: row.total_execution_time_ms,
      avgExecutionTimeMs: row.avg_execution_time_ms ?? undefined,
      lastExecutionAt: row.last_execution_at ? new Date(row.last_execution_at) : undefined,
    },
    cpuUsagePercent: row.cpu_usage_percent ?? undefined,
    memoryUsedBytes: row.memory_used_bytes ?? undefined,
    timestamp: new Date(row.recorded_at),
    recordedAt: new Date(row.recorded_at),
    createdAt: new Date(row.created_at),
  };
}

function rowToSchedulingMetrics(row: SchedulingMetricsRow): SchedulingMetricsRecord {
  return {
    id: row.id,
    windowStart: new Date(row.window_start),
    windowEnd: new Date(row.window_end),
    schedulingAttempts: row.scheduling_attempts,
    schedulingSuccesses: row.scheduling_successes,
    schedulingFailures: row.scheduling_failures,
    failureReasons: row.failure_reasons as SchedulingFailureReasons,
    avgSchedulingLatencyMs: row.avg_scheduling_latency_ms ?? undefined,
    maxSchedulingLatencyMs: row.max_scheduling_latency_ms ?? undefined,
    minSchedulingLatencyMs: row.min_scheduling_latency_ms ?? undefined,
    pendingPodsCount: row.pending_pods_count,
    createdAt: new Date(row.created_at),
  };
}

function rowToClusterMetrics(row: ClusterMetricsRow): ClusterMetricsRecord {
  return {
    id: row.id,
    nodesTotal: row.nodes_total,
    nodesOnline: row.nodes_online,
    nodesOffline: row.nodes_offline,
    nodesUnhealthy: row.nodes_unhealthy,
    nodesDraining: row.nodes_draining,
    podsTotal: row.pods_total,
    podsPending: row.pods_pending,
    podsScheduled: row.pods_scheduled,
    podsStarting: row.pods_starting,
    podsRunning: row.pods_running,
    podsStopping: row.pods_stopping,
    podsStopped: row.pods_stopped,
    podsFailed: row.pods_failed,
    podsEvicted: row.pods_evicted,
    podsDesired: row.pods_desired,
    totalCpuCapacity: row.total_cpu_capacity,
    totalMemoryCapacityBytes: row.total_memory_capacity_bytes,
    totalPodsCapacity: row.total_pods_capacity,
    totalCpuAllocated: row.total_cpu_allocated,
    totalMemoryAllocatedBytes: row.total_memory_allocated_bytes,
    totalPodsAllocated: row.total_pods_allocated,
    cpuUtilizationPercent: row.cpu_utilization_percent,
    memoryUtilizationPercent: row.memory_utilization_percent,
    podsUtilizationPercent: row.pods_utilization_percent,
    schedulingFailuresLastHour: row.scheduling_failures_last_hour,
    avgSchedulingLatencyMs: row.avg_scheduling_latency_ms ?? undefined,
    totalPodRestarts: row.total_pod_restarts,
    podsWithRestarts: row.pods_with_restarts,
    recordedAt: new Date(row.recorded_at),
    createdAt: new Date(row.created_at),
  };
}

// ============================================================================
// Metrics Queries Class
// ============================================================================

export class MetricsQueries {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseServiceClient();
  }

  // --------------------------------------------------------------------------
  // Node Metrics
  // --------------------------------------------------------------------------

  /**
   * Inserts a new node metrics record
   */
  async insertNodeMetrics(input: CreateNodeMetricsInput): Promise<MetricsResult<NodeMetricsRecord>> {
    const { data, error } = await this.client
      .from('node_metrics')
      .insert({
        node_id: input.nodeId,
        runtime_type: input.runtimeType,
        uptime_seconds: input.uptimeSeconds,
        cpu_usage_percent: input.cpuUsagePercent ?? null,
        memory_used_bytes: input.memoryUsedBytes ?? null,
        memory_total_bytes: input.memoryTotalBytes ?? null,
        memory_usage_percent: input.memoryUsagePercent ?? null,
        runtime_version: input.runtimeVersion ?? null,
        pods_allocated: input.podsAllocated,
        pods_capacity: input.podsCapacity,
        cpu_allocated: input.cpuAllocated,
        cpu_capacity: input.cpuCapacity,
        memory_allocated_bytes: input.memoryAllocatedBytes,
        memory_capacity_bytes: input.memoryCapacityBytes,
        worker_pool_total: input.workerPoolTotal ?? null,
        worker_pool_busy: input.workerPoolBusy ?? null,
        worker_pool_idle: input.workerPoolIdle ?? null,
        worker_pool_pending_tasks: input.workerPoolPendingTasks ?? null,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNodeMetrics(data as NodeMetricsRow), error: null };
  }

  /**
   * Gets the latest node metrics for a specific node
   */
  async getLatestNodeMetrics(nodeId: string): Promise<MetricsResult<NodeMetricsRecord>> {
    const { data, error } = await this.client
      .from('node_metrics')
      .select('*')
      .eq('node_id', nodeId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNodeMetrics(data as NodeMetricsRow), error: null };
  }

  /**
   * Gets node metrics history
   */
  async getNodeMetricsHistory(
    nodeId: string,
    options?: MetricsQueryOptions
  ): Promise<MetricsResult<NodeMetricsRecord[]>> {
    let query = this.client
      .from('node_metrics')
      .select('*')
      .eq('node_id', nodeId)
      .order('recorded_at', { ascending: false });

    if (options?.timeRange) {
      query = query
        .gte('recorded_at', options.timeRange.start.toISOString())
        .lte('recorded_at', options.timeRange.end.toISOString());
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit ?? 100) - 1);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as NodeMetricsRow[]).map(rowToNodeMetrics),
      error: null,
    };
  }

  /**
   * Gets latest metrics for all nodes
   */
  async getAllLatestNodeMetrics(): Promise<MetricsResult<NodeMetricsRecord[]>> {
    const { data, error } = await this.client
      .rpc('get_latest_node_metrics');

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as NodeMetricsRow[]).map(rowToNodeMetrics),
      error: null,
    };
  }

  // --------------------------------------------------------------------------
  // Pod Metrics
  // --------------------------------------------------------------------------

  /**
   * Inserts a new pod metrics record
   */
  async insertPodMetrics(input: CreatePodMetricsInput): Promise<MetricsResult<PodMetricsRecord>> {
    const { data, error } = await this.client
      .from('pod_metrics')
      .insert({
        pod_id: input.podId,
        node_id: input.nodeId ?? null,
        status: input.status,
        restart_count: input.restartCount,
        execution_count: input.executionCount,
        successful_executions: input.successfulExecutions,
        failed_executions: input.failedExecutions,
        total_execution_time_ms: input.totalExecutionTimeMs,
        avg_execution_time_ms: input.avgExecutionTimeMs ?? null,
        last_execution_at: input.lastExecutionAt?.toISOString() ?? null,
        cpu_usage_percent: input.cpuUsagePercent ?? null,
        memory_used_bytes: input.memoryUsedBytes ?? null,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPodMetrics(data as PodMetricsRow), error: null };
  }

  /**
   * Gets the latest pod metrics for a specific pod
   */
  async getLatestPodMetrics(podId: string): Promise<MetricsResult<PodMetricsRecord>> {
    const { data, error } = await this.client
      .from('pod_metrics')
      .select('*')
      .eq('pod_id', podId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPodMetrics(data as PodMetricsRow), error: null };
  }

  /**
   * Gets pod metrics history
   */
  async getPodMetricsHistory(
    podId: string,
    options?: MetricsQueryOptions
  ): Promise<MetricsResult<PodMetricsRecord[]>> {
    let query = this.client
      .from('pod_metrics')
      .select('*')
      .eq('pod_id', podId)
      .order('recorded_at', { ascending: false });

    if (options?.timeRange) {
      query = query
        .gte('recorded_at', options.timeRange.start.toISOString())
        .lte('recorded_at', options.timeRange.end.toISOString());
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as PodMetricsRow[]).map(rowToPodMetrics),
      error: null,
    };
  }

  /**
   * Gets latest metrics for all pods
   */
  async getAllLatestPodMetrics(): Promise<MetricsResult<PodMetricsRecord[]>> {
    const { data, error } = await this.client
      .rpc('get_latest_pod_metrics');

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as PodMetricsRow[]).map(rowToPodMetrics),
      error: null,
    };
  }

  /**
   * Gets pods with highest restart counts
   */
  async getTopRestartingPods(limit: number = 10): Promise<MetricsResult<Array<{ podId: string; restartCount: number }>>> {
    const { data, error } = await this.client
      .from('pod_metrics')
      .select('pod_id, restart_count')
      .order('restart_count', { ascending: false })
      .limit(limit);

    if (error) {
      return { data: null, error };
    }

    // Deduplicate by pod_id, keeping highest restart count
    const podMap = new Map<string, number>();
    for (const row of data as Array<{ pod_id: string; restart_count: number }>) {
      const existing = podMap.get(row.pod_id) ?? 0;
      if (row.restart_count > existing) {
        podMap.set(row.pod_id, row.restart_count);
      }
    }

    const result = Array.from(podMap.entries())
      .map(([podId, restartCount]) => ({ podId, restartCount }))
      .sort((a, b) => b.restartCount - a.restartCount)
      .slice(0, limit);

    return { data: result, error: null };
  }

  // --------------------------------------------------------------------------
  // Scheduling Metrics
  // --------------------------------------------------------------------------

  /**
   * Inserts a new scheduling metrics record
   */
  async insertSchedulingMetrics(input: {
    windowStart: Date;
    windowEnd: Date;
    schedulingAttempts: number;
    schedulingSuccesses: number;
    schedulingFailures: number;
    failureReasons: SchedulingFailureReasons;
    avgSchedulingLatencyMs?: number;
    maxSchedulingLatencyMs?: number;
    minSchedulingLatencyMs?: number;
    pendingPodsCount: number;
  }): Promise<MetricsResult<SchedulingMetricsRecord>> {
    const { data, error } = await this.client
      .from('scheduling_metrics')
      .insert({
        window_start: input.windowStart.toISOString(),
        window_end: input.windowEnd.toISOString(),
        scheduling_attempts: input.schedulingAttempts,
        scheduling_successes: input.schedulingSuccesses,
        scheduling_failures: input.schedulingFailures,
        failure_reasons: input.failureReasons,
        avg_scheduling_latency_ms: input.avgSchedulingLatencyMs ?? null,
        max_scheduling_latency_ms: input.maxSchedulingLatencyMs ?? null,
        min_scheduling_latency_ms: input.minSchedulingLatencyMs ?? null,
        pending_pods_count: input.pendingPodsCount,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToSchedulingMetrics(data as SchedulingMetricsRow), error: null };
  }

  /**
   * Gets scheduling metrics for a time range
   */
  async getSchedulingMetrics(options?: MetricsQueryOptions): Promise<MetricsResult<SchedulingMetricsRecord[]>> {
    let query = this.client
      .from('scheduling_metrics')
      .select('*')
      .order('window_start', { ascending: false });

    if (options?.timeRange) {
      query = query
        .gte('window_start', options.timeRange.start.toISOString())
        .lte('window_end', options.timeRange.end.toISOString());
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as SchedulingMetricsRow[]).map(rowToSchedulingMetrics),
      error: null,
    };
  }

  /**
   * Gets total scheduling failures in the last hour
   */
  async getSchedulingFailuresLastHour(): Promise<MetricsResult<number>> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const { data, error } = await this.client
      .from('scheduling_metrics')
      .select('scheduling_failures')
      .gte('window_start', oneHourAgo.toISOString());

    if (error) {
      return { data: null, error };
    }

    const total = (data as Array<{ scheduling_failures: number }>)
      .reduce((sum, row) => sum + row.scheduling_failures, 0);

    return { data: total, error: null };
  }

  // --------------------------------------------------------------------------
  // Cluster Metrics
  // --------------------------------------------------------------------------

  /**
   * Calculates and stores a new cluster metrics snapshot
   */
  async calculateClusterMetrics(): Promise<MetricsResult<string>> {
    const { data, error } = await this.client
      .rpc('calculate_cluster_metrics');

    if (error) {
      return { data: null, error };
    }

    return { data: data as string, error: null };
  }

  /**
   * Gets the latest cluster metrics
   */
  async getLatestClusterMetrics(): Promise<MetricsResult<ClusterMetricsRecord>> {
    const { data, error } = await this.client
      .from('cluster_metrics')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToClusterMetrics(data as ClusterMetricsRow), error: null };
  }

  /**
   * Gets cluster metrics history
   */
  async getClusterMetricsHistory(options?: MetricsQueryOptions): Promise<MetricsResult<ClusterMetricsRecord[]>> {
    let query = this.client
      .from('cluster_metrics')
      .select('*')
      .order('recorded_at', { ascending: false });

    if (options?.timeRange) {
      query = query
        .gte('recorded_at', options.timeRange.start.toISOString())
        .lte('recorded_at', options.timeRange.end.toISOString());
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as ClusterMetricsRow[]).map(rowToClusterMetrics),
      error: null,
    };
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Cleans up old metrics data
   */
  async cleanupOldMetrics(retentionDays: number = 7): Promise<MetricsResult<void>> {
    const { error } = await this.client
      .rpc('cleanup_old_metrics', { retention_days: retentionDays });

    if (error) {
      return { data: null, error };
    }

    return { data: undefined, error: null };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let metricsQueriesInstance: MetricsQueries | null = null;

export function getMetricsQueries(): MetricsQueries {
  if (!metricsQueriesInstance) {
    metricsQueriesInstance = new MetricsQueries();
  }
  return metricsQueriesInstance;
}

export function resetMetricsQueries(): void {
  metricsQueriesInstance = null;
}
