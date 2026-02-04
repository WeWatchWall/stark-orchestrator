/**
 * Node Health Service
 * @module @stark-o/server/services/node-health-service
 *
 * Background service that manages node health with a lease-based model to prevent
 * double-deploy bugs during transient disconnections.
 * 
 * Lease Model:
 * 1. On disconnect: node becomes 'suspect' (not immediately offline)
 * 2. While suspect: pods remain logically owned, no replacements scheduled
 * 3. If reconnects before lease expires: restore to online, nothing else changes
 * 4. If lease expires: node becomes 'offline', pods are REVOKED (not just failed)
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
  /** Interval between health checks in milliseconds (default: 30000 = 30 seconds) */
  checkInterval?: number;
  /** Heartbeat timeout for marking online nodes as suspect (default: 60000 = 60 seconds) */
  heartbeatTimeout?: number;
  /** Lease duration before suspect nodes become offline (default: 120000 = 2 minutes) */
  leaseTimeout?: number;
  /** Whether to start the service automatically when attached (default: true) */
  autoStart?: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<NodeHealthServiceConfig> = {
  checkInterval: 30_000,     // Check every 30 seconds
  heartbeatTimeout: 60_000,  // Mark suspect after 60 seconds without heartbeat
  leaseTimeout: 120_000,     // Lease expires after 2 minutes of being suspect
  autoStart: true,
};

/**
 * Node Health Service
 *
 * Runs a background loop that:
 * 1. Checks online nodes for stale heartbeats -> marks as 'suspect'
 * 2. Checks suspect nodes for lease expiration -> marks as 'offline' + revokes pods
 * 3. Uses incarnation tracking to prevent double-deploy bugs
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
    logger.info('Starting node health service with lease model', {
      checkInterval: this.config.checkInterval,
      heartbeatTimeout: this.config.heartbeatTimeout,
      leaseTimeout: this.config.leaseTimeout,
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
      // Step 1: Check online nodes -> mark stale ones as 'suspect'
      await this.markStaleNodesAsSuspect();
      
      // Step 2: Check suspect nodes -> expire leases and revoke pods
      await this.expireNodeLeases();
    } catch (error) {
      logger.error('Error in node health check', error instanceof Error ? error : undefined);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Find nodes that are marked online but haven't sent a heartbeat recently.
   * Marks them as 'suspect' - pods remain logically owned, no replacements yet.
   */
  private async markStaleNodesAsSuspect(): Promise<void> {
    const nodeQueries = getNodeQueries();

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
    let suspectCount = 0;

    for (const node of nodesResult.data) {
      // Check if heartbeat is stale
      const lastHeartbeat = node.lastHeartbeat ? node.lastHeartbeat.getTime() : 0;
      
      if (lastHeartbeat < staleThreshold) {
        suspectCount++;
        const staleDuration = now - lastHeartbeat;

        logger.warn('Detected stale node - marking as SUSPECT (lease started)', {
          nodeId: node.id,
          nodeName: node.name,
          lastHeartbeat: node.lastHeartbeat?.toISOString() ?? 'never',
          staleDurationMs: staleDuration,
          leaseTimeoutMs: this.config.leaseTimeout,
        });

        // Mark node as suspect (starts lease timer)
        const statusResult = await nodeQueries.markNodeSuspect(node.id);
        if (statusResult.error) {
          logger.error('Failed to mark node as suspect', undefined, {
            nodeId: node.id,
            nodeName: node.name,
            error: statusResult.error,
          });
          continue;
        }

        // Emit event for observability - node is now suspect, NOT lost yet
        await emitNodeEvent({
          eventType: 'NodeSuspect',
          nodeId: node.id,
          nodeName: node.name,
          previousStatus: 'online',
          newStatus: 'suspect',
          reason: 'heartbeat_timeout',
          message: `Node marked suspect after ${Math.round(staleDuration / 1000)}s without heartbeat. Lease expires in ${this.config.leaseTimeout / 1000}s`,
          metadata: {
            lastHeartbeat: node.lastHeartbeat?.toISOString() ?? null,
            staleDurationMs: staleDuration,
            leaseTimeoutMs: this.config.leaseTimeout,
            detectedBy: 'node-health-service',
          },
        }, { useAdmin: true });
      }
    }

    if (suspectCount > 0) {
      logger.info('Stale node detection complete', { nodesMarkedSuspect: suspectCount });
    }
  }

  /**
   * Check suspect nodes for lease expiration.
   * When lease expires: mark offline, REVOKE pods (with incarnation tracking).
   */
  private async expireNodeLeases(): Promise<void> {
    const nodeQueries = getNodeQueries();
    const podQueries = getPodQueriesAdmin();

    // Get all suspect nodes
    const nodesResult = await nodeQueries.listSuspectNodes();
    if (nodesResult.error || !nodesResult.data) {
      logger.error('Failed to get suspect nodes for lease check', undefined, { 
        error: nodesResult.error 
      });
      return;
    }

    const now = Date.now();
    let expiredCount = 0;

    for (const node of nodesResult.data) {
      // Check if lease has expired
      const suspectSince = node.suspectSince ? node.suspectSince.getTime() : now;
      const leaseExpiry = suspectSince + this.config.leaseTimeout;
      
      if (now >= leaseExpiry) {
        expiredCount++;
        const suspectDuration = now - suspectSince;

        logger.warn('Node lease EXPIRED - revoking pods and marking offline', {
          nodeId: node.id,
          nodeName: node.name,
          suspectSince: node.suspectSince?.toISOString() ?? 'unknown',
          suspectDurationMs: suspectDuration,
        });

        // REVOKE all active pods on this node (not just fail - uses incarnation)
        const revokeResult = await podQueries.revokePodsOnNode(node.id);

        if (revokeResult.error) {
          logger.error('Failed to revoke pods on node', undefined, {
            nodeId: node.id,
            nodeName: node.name,
            error: revokeResult.error,
          });
        } else if (revokeResult.data && revokeResult.data.revokedCount > 0) {
          logger.info('Revoked pods due to lease expiration', {
            nodeId: node.id,
            nodeName: node.name,
            revokedCount: revokeResult.data.revokedCount,
            podIds: revokeResult.data.podIds,
          });
        }

        // Transition node from suspect to offline
        const statusResult = await nodeQueries.expireNodeLease(node.id);
        if (statusResult.error) {
          logger.error('Failed to expire node lease', undefined, {
            nodeId: node.id,
            nodeName: node.name,
            error: statusResult.error,
          });
          continue;
        }

        // Clear connection ID
        const clearResult = await nodeQueries.clearConnectionId(node.id);
        if (clearResult.error) {
          logger.error('Failed to clear node connection ID', undefined, {
            nodeId: node.id,
            nodeName: node.name,
            error: clearResult.error,
          });
        }

        logger.info('Node lease expired - now offline', {
          nodeId: node.id,
          nodeName: node.name,
        });

        // Emit NodeLost event - NOW the node is truly lost
        await emitNodeEvent({
          eventType: 'NodeLost',
          nodeId: node.id,
          nodeName: node.name,
          previousStatus: 'suspect',
          newStatus: 'offline',
          reason: 'lease_expired',
          message: `Node lease expired after ${Math.round(suspectDuration / 1000)}s suspect. Pods revoked.`,
          metadata: {
            suspectSince: node.suspectSince?.toISOString() ?? null,
            suspectDurationMs: suspectDuration,
            revokedPodCount: revokeResult.data?.revokedCount ?? 0,
            detectedBy: 'node-health-service',
          },
        }, { useAdmin: true });
      }
    }

    if (expiredCount > 0) {
      logger.info('Lease expiration check complete', { nodesExpired: expiredCount });
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
