/**
 * Node Health Service
 * @module @stark-o/server/services/node-health-service
 *
 * Background service that periodically checks for stale nodes (nodes that
 * haven't sent a heartbeat within the timeout threshold) and marks them offline.
 * This prevents "zombie" nodes that crashed without a clean WebSocket disconnect.
 */

import { createServiceLogger } from '@stark-o/shared';
import { getNodeQueries, getPodQueriesAdmin, emitNodeEvent } from '../supabase/index.js';

/**
 * Logger for node health service
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'node-health-service' });

/**
 * Node health service configuration
 */
export interface NodeHealthServiceConfig {
  /** Interval between health checks in milliseconds (default: 60000 = 1 minute) */
  checkInterval?: number;
  /** Heartbeat timeout threshold in milliseconds (default: 90000 = 90 seconds) */
  heartbeatTimeout?: number;
  /** Whether to start the service automatically when attached (default: true) */
  autoStart?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<NodeHealthServiceConfig> = {
  checkInterval: 60_000,     // Check every 60 seconds
  heartbeatTimeout: 90_000,  // Mark stale after 90 seconds without heartbeat
  autoStart: true,
};

/**
 * Node Health Service
 *
 * Runs a background loop that:
 * 1. Queries all online nodes
 * 2. Checks last_heartbeat against timeout threshold
 * 3. Marks stale nodes as offline
 * 4. Fails all pods on stale nodes with 'node_lost' termination reason
 */
export class NodeHealthService {
  private config: Required<NodeHealthServiceConfig>;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;

  constructor(config: NodeHealthServiceConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the health check loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Node health service is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting node health service', {
      checkInterval: this.config.checkInterval,
      heartbeatTimeout: this.config.heartbeatTimeout,
    });

    // Run immediately, then on interval
    this.runHealthCheck();

    this.intervalTimer = setInterval(() => {
      this.runHealthCheck();
    }, this.config.checkInterval);
  }

  /**
   * Stop the health check loop
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

    logger.info('Node health service stopped');
  }

  /**
   * Check if the service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Run a single health check cycle
   */
  private async runHealthCheck(): Promise<void> {
    // Prevent overlapping runs
    if (this.isProcessing) {
      logger.debug('Skipping health check - previous check still running');
      return;
    }

    this.isProcessing = true;

    try {
      await this.detectAndMarkStaleNodes();
    } catch (error) {
      logger.error('Error in node health check', error instanceof Error ? error : undefined);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Find nodes that are marked online but haven't sent a heartbeat recently
   */
  private async detectAndMarkStaleNodes(): Promise<void> {
    const nodeQueries = getNodeQueries();
    const podQueries = getPodQueriesAdmin();

    // Get all online nodes
    const nodesResult = await nodeQueries.listNodes({ status: 'online' });
    if (nodesResult.error || !nodesResult.data) {
      logger.error('Failed to get online nodes for health check', undefined, { 
        error: nodesResult.error 
      });
      return;
    }

    const now = Date.now();
    const staleThreshold = now - this.config.heartbeatTimeout;
    let staleCount = 0;

    for (const node of nodesResult.data) {
      // Check if heartbeat is stale
      const lastHeartbeat = node.lastHeartbeat ? node.lastHeartbeat.getTime() : 0;
      
      if (lastHeartbeat < staleThreshold) {
        staleCount++;
        const staleDuration = now - lastHeartbeat;

        logger.warn('Detected stale node - marking offline', {
          nodeId: node.id,
          nodeName: node.name,
          lastHeartbeat: node.lastHeartbeat?.toISOString() ?? 'never',
          staleDurationMs: staleDuration,
        });

        // Fail all active pods on this node
        const failResult = await podQueries.failPodsOnNode(
          node.id,
          'Node heartbeat timeout',
          'node_lost',
        );

        if (failResult.data && failResult.data.failedCount > 0) {
          logger.info('Failed pods due to stale node', {
            nodeId: node.id,
            nodeName: node.name,
            failedCount: failResult.data.failedCount,
            podIds: failResult.data.podIds,
          });
        }

        // Mark node as offline and clear connection
        const statusResult = await nodeQueries.setNodeStatus(node.id, 'offline');
        if (statusResult.error) {
          logger.error('Failed to set node status to offline', undefined, {
            nodeId: node.id,
            nodeName: node.name,
            errorCode: statusResult.error.code,
            errorMessage: statusResult.error.message,
            errorDetails: statusResult.error.details,
            errorHint: statusResult.error.hint,
          });
          continue; // Skip to next node, don't clear connection or emit event
        }

        const clearResult = await nodeQueries.clearConnectionId(node.id);
        if (clearResult.error) {
          logger.error('Failed to clear node connection ID', undefined, {
            nodeId: node.id,
            nodeName: node.name,
            errorCode: clearResult.error.code,
            errorMessage: clearResult.error.message,
          });
        }

        logger.info('Node marked offline successfully', {
          nodeId: node.id,
          nodeName: node.name,
        });

        // Emit event for observability
        await emitNodeEvent({
          eventType: 'NodeLost',
          nodeId: node.id,
          nodeName: node.name,
          previousStatus: 'online',
          newStatus: 'offline',
          reason: 'heartbeat_timeout',
          message: `Node marked offline after ${Math.round(staleDuration / 1000)}s without heartbeat`,
          metadata: {
            lastHeartbeat: node.lastHeartbeat?.toISOString() ?? null,
            staleDurationMs: staleDuration,
            detectedBy: 'node-health-service',
          },
        }, { useAdmin: true });
      }
    }

    if (staleCount > 0) {
      logger.info('Health check complete', { staleNodesMarkedOffline: staleCount });
    }
  }
}

/**
 * Create a node health service instance
 */
export function createNodeHealthService(config?: NodeHealthServiceConfig): NodeHealthService {
  return new NodeHealthService(config);
}

/**
 * Singleton instance
 */
let nodeHealthServiceInstance: NodeHealthService | null = null;

/**
 * Get or create the singleton node health service
 */
export function getNodeHealthService(config?: NodeHealthServiceConfig): NodeHealthService {
  if (!nodeHealthServiceInstance) {
    nodeHealthServiceInstance = createNodeHealthService(config);
  }
  return nodeHealthServiceInstance;
}

/**
 * Reset the node health service (for testing)
 */
export function resetNodeHealthService(): void {
  if (nodeHealthServiceInstance) {
    nodeHealthServiceInstance.stop();
    nodeHealthServiceInstance = null;
  }
}
