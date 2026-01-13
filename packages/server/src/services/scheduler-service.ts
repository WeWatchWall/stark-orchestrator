/**
 * Pod Scheduler Service
 * @module @stark-o/server/services/scheduler-service
 *
 * Background service that periodically checks for pending pods and schedules
 * them to available nodes, then notifies nodes to start execution.
 */

import { createServiceLogger } from '@stark-o/shared';
import type { RuntimeType, Pack } from '@stark-o/shared';
import { isRuntimeCompatible } from '@stark-o/shared';
import { getPodQueriesAdmin, getPackQueries, getNodeQueries } from '../supabase/index.js';
import { schedulePodWithHistory } from '../supabase/pod-history-service.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

/**
 * Logger for scheduler service
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'scheduler-service' });

/**
 * Scheduler service configuration
 */
export interface SchedulerServiceConfig {
  /** Interval between scheduling runs in milliseconds (default: 5000) */
  scheduleInterval?: number;
  /** Maximum pods to schedule per run (default: 10) */
  maxPodsPerRun?: number;
  /** Whether to start the scheduler automatically (default: true) */
  autoStart?: boolean;
}

/**
 * Default scheduler configuration
 */
const DEFAULT_CONFIG: Required<SchedulerServiceConfig> = {
  scheduleInterval: 5000,
  maxPodsPerRun: 10,
  autoStart: true,
};

/**
 * Pod Scheduler Service
 *
 * Runs a background loop that:
 * 1. Queries pending pods ordered by priority
 * 2. Finds compatible online nodes for each pod
 * 3. Schedules pods to nodes (updates database)
 * 4. Sends pod:deploy messages to nodes via WebSocket
 */
export class SchedulerService {
  private config: Required<SchedulerServiceConfig>;
  private connectionManager: ConnectionManager | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;

  constructor(config: SchedulerServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Attach a connection manager for sending messages to nodes
   */
  attach(connectionManager: ConnectionManager): void {
    this.connectionManager = connectionManager;
    logger.info('Scheduler service attached to connection manager');

    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * Start the scheduling loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    if (!this.connectionManager) {
      logger.error('Cannot start scheduler: no connection manager attached');
      return;
    }

    this.isRunning = true;
    logger.info('Starting scheduler service', {
      interval: this.config.scheduleInterval,
      maxPodsPerRun: this.config.maxPodsPerRun,
    });

    // Run immediately, then on interval
    this.runSchedulingCycle();

    this.intervalTimer = setInterval(() => {
      this.runSchedulingCycle();
    }, this.config.scheduleInterval);
  }

  /**
   * Stop the scheduling loop
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    logger.info('Scheduler service stopped');
  }

  /**
   * Run a single scheduling cycle
   */
  private async runSchedulingCycle(): Promise<void> {
    // Prevent overlapping runs
    if (this.isProcessing) {
      logger.debug('Skipping scheduling cycle - previous cycle still running');
      return;
    }

    this.isProcessing = true;

    try {
      await this.schedulePendingPods();
    } catch (error) {
      logger.error('Error in scheduling cycle', error instanceof Error ? error : undefined);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Main scheduling logic - find pending pods and schedule them
   */
  private async schedulePendingPods(): Promise<void> {
    const podQueries = getPodQueriesAdmin();
    const packQueries = getPackQueries();
    const nodeQueries = getNodeQueries();

    // Get pending pods ordered by priority
    const pendingResult = await podQueries.listPendingPods();
    if (pendingResult.error || !pendingResult.data) {
      logger.error('Failed to get pending pods', undefined, { error: pendingResult.error });
      return;
    }

    const pendingPods = pendingResult.data.slice(0, this.config.maxPodsPerRun);
    if (pendingPods.length === 0) {
      // logger.debug('No pending pods to schedule');
      return;
    }

    logger.debug('Found pending pods', { count: pendingPods.length });

    // Get online nodes
    const nodesResult = await nodeQueries.listNodes({ status: 'online' });
    if (nodesResult.error || !nodesResult.data) {
      logger.error('Failed to get online nodes', undefined, { error: nodesResult.error });
      return;
    }

    const onlineNodes = nodesResult.data;
    if (onlineNodes.length === 0) {
      logger.debug('No online nodes available');
      return;
    }

    logger.debug('Found online nodes', { count: onlineNodes.length });

    // Process each pending pod
    for (const podListItem of pendingPods) {
      await this.schedulePod(podListItem, onlineNodes, packQueries, nodeQueries);
    }
  }

  /**
   * Schedule a single pod to an available node
   */
  private async schedulePod(
    podListItem: { id: string; packId: string },
    onlineNodes: Array<{ id: string; name: string; runtimeType: RuntimeType; connectionId?: string }>,
    packQueries: ReturnType<typeof getPackQueries>,
    _nodeQueries: ReturnType<typeof getNodeQueries>,
  ): Promise<void> {
    const { id: podId, packId } = podListItem;

    // Get pack details for runtime compatibility
    const packResult = await packQueries.getPackById(packId);
    if (packResult.error || !packResult.data) {
      logger.warn('Failed to get pack for pod', { podId, packId, error: packResult.error });
      return;
    }

    const pack = packResult.data;

    // Find compatible nodes
    const compatibleNodes = onlineNodes.filter(node =>
      isRuntimeCompatible(pack.runtimeTag, node.runtimeType)
    );

    if (compatibleNodes.length === 0) {
      logger.debug('No compatible nodes for pod', {
        podId,
        packId,
        runtimeTag: pack.runtimeTag,
      });
      return;
    }

    // Select node (simple round-robin / first available for now)
    // TODO: Implement more sophisticated scoring (resources, affinity, taints)
    const selectedNode = compatibleNodes[0];
    if (!selectedNode) {
      logger.debug('No compatible node found for pod', { podId, packId });
      return;
    }

    // Check if node has a connection
    if (!selectedNode.connectionId) {
      logger.warn('Selected node has no connection', {
        nodeId: selectedNode.id,
        nodeName: selectedNode.name,
      });
      return;
    }

    // Schedule the pod in database
    const scheduleResult = await schedulePodWithHistory(
      podId,
      selectedNode.id,
      {
        message: `Scheduled to node ${selectedNode.name}`,
        reason: 'scheduler_auto',
        useAdmin: true,
      }
    );

    if (scheduleResult.error) {
      logger.error('Failed to schedule pod', undefined, {
        podId,
        nodeId: selectedNode.id,
        error: scheduleResult.error,
      });
      return;
    }

    logger.info('Pod scheduled', {
      podId,
      nodeId: selectedNode.id,
      nodeName: selectedNode.name,
      packName: pack.name,
      runtimeTag: pack.runtimeTag,
    });

    // Send deploy message to node
    await this.deployPodToNode(podId, selectedNode.id, selectedNode.connectionId, pack);
  }

  /**
   * Send pod:deploy message to a node via WebSocket
   */
  private async deployPodToNode(
    podId: string,
    nodeId: string,
    connectionId: string,
    pack: Pack,
  ): Promise<void> {
    if (!this.connectionManager) {
      logger.error('No connection manager available');
      return;
    }

    // Get full pod details for deployment
    const podQueries = getPodQueriesAdmin();
    const podResult = await podQueries.getPodById(podId);
    if (podResult.error || !podResult.data) {
      logger.error('Failed to get pod for deployment', undefined, {
        podId,
        error: podResult.error,
      });
      return;
    }

    const pod = podResult.data;

    // Send pod:deploy message to the node
    const sent = this.connectionManager.sendToConnection(connectionId, {
      type: 'pod:deploy',
      payload: {
        podId,
        nodeId,
        pack: {
          id: pack.id,
          name: pack.name,
          version: pack.version,
          runtimeTag: pack.runtimeTag,
          bundlePath: pack.bundlePath,
          bundleContent: pack.bundleContent,
          metadata: pack.metadata,
        },
        resourceRequests: pod.resourceRequests,
        resourceLimits: pod.resourceLimits,
        labels: pod.labels,
        annotations: pod.annotations,
        namespace: pod.namespace,
      },
    });

    if (sent) {
      logger.info('Pod deploy message sent to node', {
        podId,
        nodeId,
        connectionId,
        packName: pack.name,
      });
    } else {
      logger.warn('Failed to send pod deploy message - connection not found', {
        podId,
        nodeId,
        connectionId,
      });
    }
  }

  /**
   * Trigger an immediate scheduling cycle (for testing or manual trigger)
   */
  async triggerSchedule(): Promise<void> {
    await this.runSchedulingCycle();
  }

  /**
   * Check if the scheduler is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Create a scheduler service instance
 */
export function createSchedulerService(config?: SchedulerServiceConfig): SchedulerService {
  return new SchedulerService(config);
}

/**
 * Singleton scheduler instance
 */
let schedulerInstance: SchedulerService | null = null;

/**
 * Get or create the singleton scheduler service
 */
export function getSchedulerService(config?: SchedulerServiceConfig): SchedulerService {
  if (!schedulerInstance) {
    schedulerInstance = createSchedulerService(config);
  }
  return schedulerInstance;
}

/**
 * Reset the scheduler service (for testing)
 */
export function resetSchedulerService(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    schedulerInstance = null;
  }
}
