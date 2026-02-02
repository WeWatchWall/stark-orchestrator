/**
 * Metrics Service
 * @module @stark-o/server/services/metrics-service
 *
 * Background service that collects, aggregates, and stores metrics.
 * Handles:
 * - Receiving metrics from nodes
 * - Computing cluster-wide metrics
 * - Tracking scheduling statistics
 * - Periodic cleanup of old metrics
 */

import { createServiceLogger } from '@stark-o/shared';
import type {
  CreateNodeMetricsInput,
  CreatePodMetricsInput,
  SchedulingFailureReasons,
  ClusterMetrics,
  NodeMetricsRecord,
  PodMetricsRecord,
} from '@stark-o/shared';
import { getMetricsQueries } from '../supabase/metrics.js';

/**
 * Logger for metrics service
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'metrics-service' });

/**
 * Metrics service configuration
 */
export interface MetricsServiceConfig {
  /** Interval for cluster metrics collection in milliseconds (default: 60000 = 1 minute) */
  clusterMetricsInterval?: number;
  /** Interval for metrics cleanup in milliseconds (default: 3600000 = 1 hour) */
  cleanupInterval?: number;
  /** Retention period for metrics in days (default: 7) */
  retentionDays?: number;
  /** Whether to start automatically (default: true) */
  autoStart?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<MetricsServiceConfig> = {
  clusterMetricsInterval: 60000, // 1 minute
  cleanupInterval: 3600000, // 1 hour
  retentionDays: 7,
  autoStart: true,
};

/**
 * Scheduling statistics tracked in memory between persistence
 */
interface SchedulingStats {
  attempts: number;
  successes: number;
  failures: number;
  failureReasons: SchedulingFailureReasons;
  latencies: number[];
  windowStart: Date;
}

/**
 * Metrics Service
 *
 * Provides:
 * - Node metrics ingestion
 * - Pod metrics ingestion
 * - Scheduling metrics tracking
 * - Cluster metrics aggregation
 * - Metrics cleanup
 */
export class MetricsService {
  private config: Required<MetricsServiceConfig>;
  private isRunning = false;
  private clusterMetricsTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private schedulingStats: SchedulingStats;

  constructor(config: MetricsServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.schedulingStats = this.createEmptySchedulingStats();
  }

  /**
   * Creates empty scheduling stats
   */
  private createEmptySchedulingStats(): SchedulingStats {
    return {
      attempts: 0,
      successes: 0,
      failures: 0,
      failureReasons: {},
      latencies: [],
      windowStart: new Date(),
    };
  }

  /**
   * Start the metrics service
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Metrics service is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting metrics service', {
      clusterMetricsInterval: this.config.clusterMetricsInterval,
      cleanupInterval: this.config.cleanupInterval,
      retentionDays: this.config.retentionDays,
    });

    // Start cluster metrics collection
    this.clusterMetricsTimer = setInterval(
      () => this.collectClusterMetrics(),
      this.config.clusterMetricsInterval
    );

    // Start cleanup timer
    this.cleanupTimer = setInterval(
      () => this.cleanupOldMetrics(),
      this.config.cleanupInterval
    );

    // Run initial collection
    this.collectClusterMetrics();
  }

  /**
   * Stop the metrics service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Stopping metrics service');

    if (this.clusterMetricsTimer) {
      clearInterval(this.clusterMetricsTimer);
      this.clusterMetricsTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Persist any remaining scheduling stats
    this.persistSchedulingStats();
  }

  // --------------------------------------------------------------------------
  // Node Metrics
  // --------------------------------------------------------------------------

  /**
   * Record node metrics
   */
  async recordNodeMetrics(input: CreateNodeMetricsInput): Promise<void> {
    try {
      const metricsQueries = getMetricsQueries();
      const result = await metricsQueries.insertNodeMetrics(input);

      if (result.error) {
        logger.error('Failed to record node metrics', {
          nodeId: input.nodeId,
          error: result.error.message,
        });
        return;
      }

      logger.debug('Recorded node metrics', {
        nodeId: input.nodeId,
        uptimeSeconds: input.uptimeSeconds,
        cpuUsagePercent: input.cpuUsagePercent,
        memoryUsagePercent: input.memoryUsagePercent,
      });
    } catch (error) {
      logger.error('Error recording node metrics', {
        nodeId: input.nodeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get latest metrics for a specific node
   */
  async getNodeMetrics(nodeId: string): Promise<NodeMetricsRecord | null> {
    const metricsQueries = getMetricsQueries();
    const result = await metricsQueries.getLatestNodeMetrics(nodeId);
    return result.data;
  }

  /**
   * Get latest metrics for all nodes
   */
  async getAllNodeMetrics(): Promise<NodeMetricsRecord[]> {
    const metricsQueries = getMetricsQueries();
    const result = await metricsQueries.getAllLatestNodeMetrics();
    return result.data ?? [];
  }

  // --------------------------------------------------------------------------
  // Pod Metrics
  // --------------------------------------------------------------------------

  /**
   * Record pod metrics
   */
  async recordPodMetrics(input: CreatePodMetricsInput): Promise<void> {
    try {
      const metricsQueries = getMetricsQueries();
      const result = await metricsQueries.insertPodMetrics(input);

      if (result.error) {
        logger.error('Failed to record pod metrics', {
          podId: input.podId,
          error: result.error.message,
        });
        return;
      }

      logger.debug('Recorded pod metrics', {
        podId: input.podId,
        restartCount: input.restartCount,
        executionCount: input.executionCount,
      });
    } catch (error) {
      logger.error('Error recording pod metrics', {
        podId: input.podId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get latest metrics for a specific pod
   */
  async getPodMetrics(podId: string): Promise<PodMetricsRecord | null> {
    const metricsQueries = getMetricsQueries();
    const result = await metricsQueries.getLatestPodMetrics(podId);
    return result.data;
  }

  /**
   * Get pods with highest restart counts
   */
  async getTopRestartingPods(limit: number = 10): Promise<Array<{ podId: string; restartCount: number }>> {
    const metricsQueries = getMetricsQueries();
    const result = await metricsQueries.getTopRestartingPods(limit);
    return result.data ?? [];
  }

  // --------------------------------------------------------------------------
  // Scheduling Metrics
  // --------------------------------------------------------------------------

  /**
   * Record a scheduling attempt
   */
  recordSchedulingAttempt(): void {
    this.schedulingStats.attempts++;
  }

  /**
   * Record a successful scheduling with latency
   */
  recordSchedulingSuccess(latencyMs: number): void {
    this.schedulingStats.successes++;
    this.schedulingStats.latencies.push(latencyMs);
  }

  /**
   * Record a scheduling failure with reason
   */
  recordSchedulingFailure(reason: keyof SchedulingFailureReasons): void {
    this.schedulingStats.failures++;
    this.schedulingStats.failureReasons[reason] = 
      (this.schedulingStats.failureReasons[reason] ?? 0) + 1;
  }

  /**
   * Persist current scheduling stats to database
   */
  private async persistSchedulingStats(): Promise<void> {
    const stats = this.schedulingStats;
    
    // Skip if no activity
    if (stats.attempts === 0) {
      return;
    }

    const windowEnd = new Date();
    const latencies = stats.latencies;

    try {
      const metricsQueries = getMetricsQueries();
      await metricsQueries.insertSchedulingMetrics({
        windowStart: stats.windowStart,
        windowEnd,
        schedulingAttempts: stats.attempts,
        schedulingSuccesses: stats.successes,
        schedulingFailures: stats.failures,
        failureReasons: stats.failureReasons,
        avgSchedulingLatencyMs: latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : undefined,
        maxSchedulingLatencyMs: latencies.length > 0
          ? Math.max(...latencies)
          : undefined,
        minSchedulingLatencyMs: latencies.length > 0
          ? Math.min(...latencies)
          : undefined,
        pendingPodsCount: 0, // Will be updated by cluster metrics
      });

      logger.debug('Persisted scheduling stats', {
        attempts: stats.attempts,
        successes: stats.successes,
        failures: stats.failures,
      });
    } catch (error) {
      logger.error('Failed to persist scheduling stats', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Reset stats
    this.schedulingStats = this.createEmptySchedulingStats();
  }

  /**
   * Get scheduling failures in the last hour
   */
  async getSchedulingFailuresLastHour(): Promise<number> {
    const metricsQueries = getMetricsQueries();
    const result = await metricsQueries.getSchedulingFailuresLastHour();
    return result.data ?? 0;
  }

  // --------------------------------------------------------------------------
  // Cluster Metrics
  // --------------------------------------------------------------------------

  /**
   * Collect and store cluster-wide metrics
   */
  private async collectClusterMetrics(): Promise<void> {
    try {
      // First persist any pending scheduling stats
      await this.persistSchedulingStats();

      // Then calculate cluster metrics
      const metricsQueries = getMetricsQueries();
      const result = await metricsQueries.calculateClusterMetrics();

      if (result.error) {
        logger.error('Failed to collect cluster metrics', {
          error: result.error.message,
        });
        return;
      }

      logger.debug('Collected cluster metrics', { id: result.data });
    } catch (error) {
      logger.error('Error collecting cluster metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get latest cluster metrics
   */
  async getClusterMetrics(): Promise<ClusterMetrics | null> {
    const metricsQueries = getMetricsQueries();
    const result = await metricsQueries.getLatestClusterMetrics();

    if (!result.data) {
      return null;
    }

    const record = result.data;

    return {
      nodes: {
        total: record.nodesTotal,
        online: record.nodesOnline,
        offline: record.nodesOffline,
        unhealthy: record.nodesUnhealthy,
        draining: record.nodesDraining,
        maintenance: 0, // Not tracked separately in this version
      },
      pods: {
        total: record.podsTotal,
        pending: record.podsPending,
        scheduled: record.podsScheduled,
        starting: record.podsStarting,
        running: record.podsRunning,
        stopping: record.podsStopping,
        stopped: record.podsStopped,
        failed: record.podsFailed,
        evicted: record.podsEvicted,
        desired: record.podsDesired,
      },
      resources: {
        totalCpuCapacity: record.totalCpuCapacity,
        totalMemoryCapacityBytes: record.totalMemoryCapacityBytes,
        totalPodsCapacity: record.totalPodsCapacity,
        totalCpuAllocated: record.totalCpuAllocated,
        totalMemoryAllocatedBytes: record.totalMemoryAllocatedBytes,
        totalPodsAllocated: record.totalPodsAllocated,
        cpuUtilizationPercent: record.cpuUtilizationPercent,
        memoryUtilizationPercent: record.memoryUtilizationPercent,
        podsUtilizationPercent: record.podsUtilizationPercent,
      },
      restarts: {
        totalPodRestarts: record.totalPodRestarts,
        podsWithRestarts: record.podsWithRestarts,
      },
      schedulingFailuresLastHour: record.schedulingFailuresLastHour,
      avgSchedulingLatencyMs: record.avgSchedulingLatencyMs,
      timestamp: record.recordedAt,
    };
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Clean up old metrics data
   */
  private async cleanupOldMetrics(): Promise<void> {
    try {
      const metricsQueries = getMetricsQueries();
      const result = await metricsQueries.cleanupOldMetrics(this.config.retentionDays);

      if (result.error) {
        logger.error('Failed to cleanup old metrics', {
          error: result.error.message,
        });
        return;
      }

      logger.info('Cleaned up old metrics', {
        retentionDays: this.config.retentionDays,
      });
    } catch (error) {
      logger.error('Error cleaning up old metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // --------------------------------------------------------------------------
  // Dashboard Summary
  // --------------------------------------------------------------------------

  /**
   * Get a complete metrics dashboard summary
   */
  async getDashboardMetrics(): Promise<{
    cluster: ClusterMetrics | null;
    nodes: NodeMetricsRecord[];
    topRestartingPods: Array<{ podId: string; restartCount: number }>;
    schedulingFailuresLastHour: number;
    uptime: { maxNodeUptimeSeconds: number; avgNodeUptimeSeconds: number };
  }> {
    const [cluster, nodes, topRestartingPods, schedulingFailures] = await Promise.all([
      this.getClusterMetrics(),
      this.getAllNodeMetrics(),
      this.getTopRestartingPods(10),
      this.getSchedulingFailuresLastHour(),
    ]);

    // Calculate uptime stats from node metrics
    const uptimes = nodes.map(n => n.system.uptimeSeconds);
    const maxNodeUptimeSeconds = uptimes.length > 0 ? Math.max(...uptimes) : 0;
    const avgNodeUptimeSeconds = uptimes.length > 0
      ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length
      : 0;

    return {
      cluster,
      nodes,
      topRestartingPods,
      schedulingFailuresLastHour: schedulingFailures,
      uptime: {
        maxNodeUptimeSeconds,
        avgNodeUptimeSeconds,
      },
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let metricsServiceInstance: MetricsService | null = null;

export function getMetricsService(config?: MetricsServiceConfig): MetricsService {
  if (!metricsServiceInstance) {
    metricsServiceInstance = new MetricsService(config);
  }
  return metricsServiceInstance;
}

export function resetMetricsService(): void {
  if (metricsServiceInstance) {
    metricsServiceInstance.stop();
  }
  metricsServiceInstance = null;
}
