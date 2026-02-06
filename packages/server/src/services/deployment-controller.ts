/**
 * Deployment Controller Service
 * @module @stark-o/server/services/deployment-controller
 *
 * Background service that reconciles deployments by:
 * 1. Checking desired vs actual pod counts
 * 2. Creating pods for under-replicated deployments
 * 3. Handling DaemonSet mode (replicas=0) by deploying to all matching nodes
 * 4. Cleaning up pods when deployments are deleted
 */

import { createServiceLogger, matchesSelector, isRuntimeCompatible, isNodeVersionCompatible, shouldCountTowardCrashLoop } from '@stark-o/shared';
import type { Deployment, Labels, RuntimeTag, RuntimeType, PodTerminationReason, NodeListItem, PackMetadata, Pack } from '@stark-o/shared';
import { toleratesBlockingTaints } from '@stark-o/shared';
import { getDeploymentQueriesAdmin } from '../supabase/deployments.js';
import { getPodQueriesAdmin } from '../supabase/pods.js';
import { getNodeQueries } from '../supabase/nodes.js';
import { getPackQueriesAdmin } from '../supabase/packs.js';
import { getConnectionManager, sendToNode } from './connection-service.js';

/**
 * Logger for deployment controller
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'deployment-controller' });

/**
 * Deployment controller configuration
 */
export interface DeploymentControllerConfig {
  /** Interval between reconciliation runs in milliseconds (default: 10000) */
  reconcileInterval?: number;
  /** Whether to start the controller automatically (default: true) */
  autoStart?: boolean;
  /** Number of consecutive failures before triggering auto-rollback (default: 3) */
  maxConsecutiveFailures?: number;
  /** Initial backoff duration in milliseconds after failures (default: 60000 = 1 min) */
  initialBackoffMs?: number;
  /** Maximum backoff duration in milliseconds (default: 3600000 = 1 hour) */
  maxBackoffMs?: number;
  /** Time window in milliseconds to detect rapid pod failures (default: 60000 = 1 min) */
  failureDetectionWindowMs?: number;
}

/**
 * Default controller configuration
 */
const DEFAULT_CONFIG: Required<DeploymentControllerConfig> = {
  reconcileInterval: 10000,
  autoStart: true,
  maxConsecutiveFailures: 3,
  initialBackoffMs: 60000, // 1 minute
  maxBackoffMs: 3600000,   // 1 hour
  failureDetectionWindowMs: 60000, // 1 minute
};

/**
 * Deployment Controller Service
 *
 * Runs a background loop that reconciles deployments:
 * - For replicas > 0: maintains exactly N pods
 * - For replicas = 0 (DaemonSet): maintains 1 pod per matching node
 */
export class DeploymentController {
  private config: Required<DeploymentControllerConfig>;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;
  /** 
   * Set to true when triggerReconcile() is called during an active cycle.
   * Causes another reconcile to run immediately after the current one finishes.
   * This prevents lost reconciles when orphaned pods are stopped mid-cycle.
   */
  private pendingReconcile = false;

  constructor(config: DeploymentControllerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the reconciliation loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Deployment controller is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting deployment controller', {
      interval: this.config.reconcileInterval,
    });

    // Run immediately, then on interval
    this.runReconcileLoop();

    this.intervalTimer = setInterval(() => {
      this.runReconcileLoop();
    }, this.config.reconcileInterval);
  }

  /**
   * Stop the reconciliation loop
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

    logger.info('Deployment controller stopped');
  }

  /**
   * Run a single reconciliation cycle
   */
  private async runReconcileLoop(): Promise<void> {
    // Prevent overlapping runs - but queue a follow-up if triggered during processing
    if (this.isProcessing) {
      logger.debug('Queueing reconcile cycle - previous cycle still running');
      this.pendingReconcile = true;
      return;
    }

    this.isProcessing = true;
    // Clear pending flag before running - we're about to process
    this.pendingReconcile = false;

    try {
      await this.reconcileDeployments();
    } catch (error) {
      logger.error('Error in reconcile cycle', error instanceof Error ? error : undefined);
    } finally {
      this.isProcessing = false;
      
      // If a reconcile was requested while we were processing, run again immediately.
      // This ensures orphaned pod cleanup triggers a fresh reconcile with updated data.
      if (this.pendingReconcile) {
        logger.debug('Running queued reconcile cycle');
        this.pendingReconcile = false;
        // Use setImmediate to avoid stack overflow on rapid triggers
        setImmediate(() => this.runReconcileLoop());
      }
    }
  }

  /**
   * Main reconciliation logic
   */
  private async reconcileDeployments(): Promise<void> {
    const deploymentQueries = getDeploymentQueriesAdmin();

    // Get all active deployments
    const deploymentsResult = await deploymentQueries.listActiveDeployments();
    if (deploymentsResult.error || !deploymentsResult.data) {
      logger.error('Failed to get active deployments', undefined, { 
        error: deploymentsResult.error 
      });
      return;
    }

    const deployments = deploymentsResult.data;
    if (deployments.length === 0) {
      return;
    }

    // logger.debug('Reconciling deployments', { count: deployments.length });

    // First, check for pack version updates on followLatest deployments
    await this.reconcileFollowLatestVersions(deployments.filter(d => d.followLatest));

    // Reconcile each deployment
    for (const deployment of deployments) {
      await this.reconcileDeployment(deployment);
    }
  }

  /**
   * Check and update deployments that follow the latest pack version
   * If a new pack version exists, update the deployment and trigger a rolling update
   * Includes crash-loop protection to prevent infinite upgrade/fail cycles
   */
  private async reconcileFollowLatestVersions(deployments: Deployment[]): Promise<void> {
    if (deployments.length === 0) {
      return;
    }

    const packQueries = getPackQueriesAdmin();
    const deploymentQueries = getDeploymentQueriesAdmin();

    // Group deployments by packId to minimize pack queries
    const deploymentsByPackId = new Map<string, Deployment[]>();
    for (const deployment of deployments) {
      const existing = deploymentsByPackId.get(deployment.packId) ?? [];
      existing.push(deployment);
      deploymentsByPackId.set(deployment.packId, existing);
    }

    // Check each pack for new versions
    for (const [packId, packDeployments] of deploymentsByPackId) {
      // Get the pack to find its name
      const packResult = await packQueries.getPackById(packId);
      if (packResult.error || !packResult.data) {
        logger.error('Failed to get pack for followLatest check', undefined, {
          packId,
          error: packResult.error,
        });
        continue;
      }

      // Get the latest version of this pack
      const latestResult = await packQueries.getLatestPackVersion(packResult.data.name);
      if (latestResult.error || !latestResult.data) {
        logger.error('Failed to get latest pack version', undefined, {
          packName: packResult.data.name,
          error: latestResult.error,
        });
        continue;
      }

      const latestVersion = latestResult.data.version;

      // Update deployments that are behind
      for (const deployment of packDeployments) {
        // Skip if we're in backoff period for this failed version
        if (this.isInFailureBackoff(deployment, latestVersion)) {
          logger.debug('Skipping upgrade due to failure backoff', {
            deploymentName: deployment.name,
            failedVersion: deployment.failedVersion,
            backoffUntil: deployment.failureBackoffUntil,
            latestVersion,
          });
          continue;
        }

        if (deployment.packVersion !== latestVersion) {
          logger.info('Updating followLatest deployment to new pack version', {
            deploymentName: deployment.name,
            deploymentId: deployment.id,
            oldVersion: deployment.packVersion,
            newVersion: latestVersion,
          });

          // Record the current version as last successful before upgrading
          // (if pods are running, current version is "successful")
          const updateData: Record<string, unknown> = {
            packVersion: latestVersion,
          };
          
          // Only record last successful if we have running pods
          if (deployment.readyReplicas > 0 && !deployment.lastSuccessfulVersion) {
            updateData.lastSuccessfulVersion = deployment.packVersion;
          }

          // Update the deployment's pack version
          await deploymentQueries.updateDeployment(deployment.id, updateData);

          // Trigger rolling update of existing pods
          await this.triggerRollingUpdate(deployment, latestVersion);
        }
      }
    }
  }

  /**
   * Trigger a rolling update of pods for a deployment
   * Marks existing pods for replacement with new version
   */
  private async triggerRollingUpdate(deployment: Deployment, newVersion: string): Promise<void> {
    const podQueries = getPodQueriesAdmin();

    // Get current pods for this deployment
    const podsResult = await podQueries.listPodsByDeployment(deployment.id);
    if (podsResult.error || !podsResult.data) {
      logger.error('Failed to get pods for rolling update', undefined, {
        deploymentId: deployment.id,
        error: podsResult.error,
      });
      return;
    }

    const currentPods = podsResult.data;
    
    // Filter to pods that need updating (running on old version)
    const podsToUpdate = currentPods.filter(p => 
      p.packVersion !== newVersion && 
      !['stopped', 'failed', 'evicted', 'stopping'].includes(p.status)
    );

    if (podsToUpdate.length === 0) {
      return;
    }

    logger.info('Triggering rolling update', {
      deploymentName: deployment.name,
      podsToUpdate: podsToUpdate.length,
      newVersion,
    });

    // Mark old pods for termination (they will be replaced by reconcileDeployment)
    for (const pod of podsToUpdate) {
      await podQueries.updatePod(pod.id, { 
        status: 'stopping',
        statusMessage: `Rolling update to version ${newVersion}`,
      });
    }
  }

  /**
   * Check if a deployment is in failure backoff for a specific version
   */
  private isInFailureBackoff(deployment: Deployment, targetVersion: string): boolean {
    // If the target version is the one that failed, check backoff
    if (deployment.failedVersion === targetVersion && deployment.failureBackoffUntil) {
      return new Date() < deployment.failureBackoffUntil;
    }
    return false;
  }

  /**
   * Calculate exponential backoff duration based on consecutive failures
   */
  private calculateBackoffMs(consecutiveFailures: number): number {
    // Exponential backoff: initialBackoff * 2^(failures-1), capped at maxBackoff
    const backoff = this.config.initialBackoffMs * Math.pow(2, Math.max(0, consecutiveFailures - 1));
    return Math.min(backoff, this.config.maxBackoffMs);
  }

  /**
   * Detect crash loop and handle auto-rollback if needed
   * Returns true if deployment should skip further reconciliation
   */
  private async detectAndHandleCrashLoop(
    deployment: Deployment,
    allPods: Array<{ id: string; status: string; terminationReason?: PodTerminationReason; packVersion: string; updatedAt?: Date }>
  ): Promise<boolean> {
    const deploymentQueries = getDeploymentQueriesAdmin();

    // Count recent failures (pods that failed within the detection window)
    // Only count application failures - infrastructure failures don't indicate bugs
    const now = Date.now();
    const recentFailures = allPods.filter(p => {
      if (p.status !== 'failed') return false;
      // Use canonical termination reason to determine if this should count toward crash loop
      if (!shouldCountTowardCrashLoop(p.terminationReason)) {
        return false;
      }
      if (!p.updatedAt) return true; // Assume recent if no timestamp
      return (now - new Date(p.updatedAt).getTime()) < this.config.failureDetectionWindowMs;
    });

    // If we have running pods, reset failure tracking
    const runningPods = allPods.filter(p => p.status === 'running');
    if (runningPods.length > 0) {
      // Check if running pods are on current version - if so, it's successful
      const currentVersionRunning = runningPods.some(p => p.packVersion === deployment.packVersion);
      if (currentVersionRunning && deployment.consecutiveFailures > 0) {
        // Clear failure state - deployment is now healthy
        logger.info('Deployment recovered, clearing failure state', {
          deploymentName: deployment.name,
          version: deployment.packVersion,
          previousFailures: deployment.consecutiveFailures,
        });
        await deploymentQueries.updateDeployment(deployment.id, {
          consecutiveFailures: 0,
          failedVersion: null,
          failureBackoffUntil: null,
          lastSuccessfulVersion: deployment.packVersion,
        });
      }
      return false;
    }

    // If no recent failures, nothing to do
    if (recentFailures.length === 0) {
      return false;
    }

    // We have failures and no running pods - potential crash loop
    const newFailureCount = deployment.consecutiveFailures + recentFailures.length;

    // Check if we've exceeded the threshold
    if (newFailureCount >= this.config.maxConsecutiveFailures) {
      logger.warn('Crash loop detected - too many consecutive failures', {
        deploymentName: deployment.name,
        deploymentId: deployment.id,
        version: deployment.packVersion,
        consecutiveFailures: newFailureCount,
        threshold: this.config.maxConsecutiveFailures,
      });

      // Calculate backoff
      const backoffMs = this.calculateBackoffMs(newFailureCount);
      const backoffUntil = new Date(Date.now() + backoffMs);

      // Check if we can auto-rollback
      if (deployment.lastSuccessfulVersion && 
          deployment.lastSuccessfulVersion !== deployment.packVersion) {
        // Auto-rollback to last successful version
        logger.info('Auto-rolling back to last successful version', {
          deploymentName: deployment.name,
          failedVersion: deployment.packVersion,
          rollbackVersion: deployment.lastSuccessfulVersion,
        });

        await deploymentQueries.updateDeployment(deployment.id, {
          packVersion: deployment.lastSuccessfulVersion,
          consecutiveFailures: 0,
          failedVersion: deployment.packVersion,
          failureBackoffUntil: backoffUntil,
          statusMessage: `Auto-rolled back from ${deployment.packVersion} to ${deployment.lastSuccessfulVersion} after ${newFailureCount} failures`,
        });

        // Trigger rolling update to the old version
        await this.triggerRollingUpdate(deployment, deployment.lastSuccessfulVersion);
        return true;
      } else {
        // No version to roll back to - just pause and wait
        logger.warn('No previous version to rollback to, pausing deployment', {
          deploymentName: deployment.name,
          failedVersion: deployment.packVersion,
        });

        await deploymentQueries.updateDeployment(deployment.id, {
          status: 'paused',
          consecutiveFailures: newFailureCount,
          failedVersion: deployment.packVersion,
          failureBackoffUntil: backoffUntil,
          statusMessage: `Paused after ${newFailureCount} failures. No previous version available for rollback.`,
        });
        return true;
      }
    } else {
      // Update failure count but don't trigger rollback yet
      await deploymentQueries.updateDeployment(deployment.id, {
        consecutiveFailures: newFailureCount,
        failedVersion: deployment.packVersion,
      });
    }

    return false;
  }

  /**
   * Reconcile a single deployment
   */
  private async reconcileDeployment(deployment: Deployment): Promise<void> {
    const podQueries = getPodQueriesAdmin();

    // Get current pods for this deployment
    const podsResult = await podQueries.listPodsByDeployment(deployment.id);
    if (podsResult.error || !podsResult.data) {
      logger.error('Failed to get pods for deployment', undefined, {
        deploymentId: deployment.id,
        error: podsResult.error,
      });
      return;
    }

    // Check for crash loop before proceeding with reconciliation
    const allPods = podsResult.data.map(p => ({
      id: p.id,
      status: p.status,
      terminationReason: p.terminationReason,
      packVersion: p.packVersion,
      updatedAt: p.updatedAt,
    }));
    
    const shouldSkip = await this.detectAndHandleCrashLoop(deployment, allPods);
    if (shouldSkip) {
      return;
    }

    // Filter to active pods (not stopped/failed/evicted)
    const activePods = podsResult.data.filter(p => 
      !['stopped', 'failed', 'evicted'].includes(p.status)
    );

    if (deployment.replicas === 0) {
      // DaemonSet mode: one pod per matching node
      await this.reconcileDaemonSet(deployment, activePods);
    } else {
      // Regular deployment: maintain exact replica count
      await this.reconcileReplicas(deployment, activePods);
    }

    // Update replica counts
    const readyPods = activePods.filter(p => p.status === 'running');
    const availablePods = activePods.filter(p => 
      ['running', 'starting', 'scheduled'].includes(p.status)
    );

    const deploymentQueries = getDeploymentQueriesAdmin();
    await deploymentQueries.updateReplicaCounts(
      deployment.id,
      readyPods.length,
      availablePods.length,
      activePods.length
    );
  }

  /**
   * Reconcile DaemonSet mode (replicas = 0)
   * Creates one pod per matching node
   */
  private async reconcileDaemonSet(
    deployment: Deployment,
    currentPods: Array<{ id: string; nodeId: string | null; status: string }>
  ): Promise<void> {
    const nodeQueries = getNodeQueries();
    const packQueries = getPackQueriesAdmin();

    // Get pack to check runtime compatibility
    const packResult = await packQueries.getPackById(deployment.packId);
    if (packResult.error || !packResult.data) {
      logger.error('Failed to get pack for DaemonSet reconciliation', undefined, {
        deploymentId: deployment.id,
        packId: deployment.packId,
        error: packResult.error,
      });
      return;
    }
    const pack = packResult.data;
    const packRuntimeTag = pack.runtimeTag;

    // Get all online nodes
    const nodesResult = await nodeQueries.listNodes({ status: 'online' });
    if (nodesResult.error || !nodesResult.data) {
      logger.error('Failed to get nodes for DaemonSet reconciliation', undefined, {
        deploymentId: deployment.id,
        error: nodesResult.error,
      });
      return;
    }

    // Filter nodes by pack access (ownership check) first
    const accessibleNodes: NodeListItem[] = [];
    for (const node of nodesResult.data) {
      const accessResult = await packQueries.canNodeAccessPack(
        { ownerId: pack.ownerId, visibility: pack.visibility },
        node.registeredBy
      );
      if (accessResult.error) {
        logger.warn('Failed to check pack access for node in DaemonSet', { 
          nodeId: node.id, 
          packId: pack.id,
          error: accessResult.error 
        });
        continue;
      }
      if (accessResult.data) {
        accessibleNodes.push(node);
      }
    }

    // Filter nodes based on scheduling constraints AND runtime compatibility
    const eligibleNodes = this.filterEligibleNodes(
      accessibleNodes,
      deployment,
      packRuntimeTag,
      pack.metadata
    );

    // Find nodes that don't have a pod yet
    const podNodeIds = new Set(currentPods.map(p => p.nodeId).filter(Boolean));
    const nodesNeedingPods = eligibleNodes.filter(n => !podNodeIds.has(n.id));

    if (nodesNeedingPods.length === 0) {
      return;
    }

    logger.info('DaemonSet needs pods on new nodes', {
      deploymentName: deployment.name,
      nodesCount: nodesNeedingPods.length,
    });

    // Create pods for each node
    for (const node of nodesNeedingPods) {
      await this.createPodForDeployment(deployment, node.id);
    }
  }

  /**
   * Reconcile regular deployment (replicas > 0)
   */
  private async reconcileReplicas(
    deployment: Deployment,
    currentPods: Array<{ id: string; nodeId: string | null; status: string }>
  ): Promise<void> {
    const desired = deployment.replicas;
    const current = currentPods.length;

    if (current < desired) {
      // Scale up
      const toCreate = desired - current;
      logger.info('Scaling up deployment', {
        deploymentName: deployment.name,
        current,
        desired,
        toCreate,
      });

      for (let i = 0; i < toCreate; i++) {
        await this.createPodForDeployment(deployment);
      }
    } else if (current > desired) {
      // Scale down - remove excess pods
      const toRemove = current - desired;
      logger.info('Scaling down deployment', {
        deploymentName: deployment.name,
        current,
        desired,
        toRemove,
      });

      const podQueries = getPodQueriesAdmin();
      const nodeQueries = getNodeQueries();

      // Exclude pods already being stopped to avoid sending duplicate stop commands
      const alreadyStopping = currentPods.filter(p => p.status === 'stopping').length;
      const actualToRemove = Math.max(0, toRemove - alreadyStopping);
      const candidatePods = currentPods.filter(p => p.status !== 'stopping');
      const podsToRemove = candidatePods.slice(0, actualToRemove);

      if (podsToRemove.length === 0) {
        logger.debug('Scale down already in progress, waiting for pods to terminate', {
          deploymentName: deployment.name,
          alreadyStopping,
        });
        return;
      }
      
      for (const pod of podsToRemove) {
        await podQueries.updatePod(pod.id, { 
          status: 'stopping' 
        });

        // Send pod:stop message to the node so it actually terminates the pod
        if (pod.nodeId) {
          const nodeResult = await nodeQueries.getNodeById(pod.nodeId);
          if (nodeResult.data?.connectionId) {
            const sent = sendToNode(nodeResult.data.connectionId, {
              type: 'pod:stop',
              payload: {
                podId: pod.id,
                reason: 'deployment_scale_down',
                message: `Pod stopped due to deployment ${deployment.name} scale down`,
              },
            });

            if (sent) {
              logger.info('Pod stop message sent to node', {
                podId: pod.id,
                nodeId: pod.nodeId,
                connectionId: nodeResult.data.connectionId,
              });
            } else {
              logger.warn('Failed to send pod stop message - node connection not found', {
                podId: pod.id,
                nodeId: pod.nodeId,
              });
            }
          } else {
            logger.debug('Node has no active connection, skipping WebSocket notification', {
              podId: pod.id,
              nodeId: pod.nodeId,
            });
          }
        }
      }
    }
  }

  /**
   * Filter nodes eligible for a deployment based on scheduling constraints and runtime
   */
  private filterEligibleNodes(
    nodes: Array<{ 
      id: string; 
      name: string;
      runtimeType?: RuntimeType;
      labels?: Labels; 
      taints?: Array<{ key: string; value?: string; effect: string }>;
      capabilities?: { version?: string; [key: string]: unknown };
    }>,
    deployment: Deployment,
    packRuntimeTag?: RuntimeTag,
    packMetadata?: PackMetadata
  ): Array<{ id: string; name: string }> {
    return nodes.filter(node => {
      // Check runtime compatibility
      if (packRuntimeTag && node.runtimeType) {
        if (!isRuntimeCompatible(packRuntimeTag, node.runtimeType)) {
          return false;
        }
      }

      // Check Node.js version compatibility
      const minNodeVersion = packMetadata?.minNodeVersion as string | undefined;
      if (!isNodeVersionCompatible(node.capabilities?.version, minNodeVersion)) {
        return false;
      }

      // Check node selector
      if (deployment.scheduling?.nodeSelector) {
        const nodeLabels = node.labels ?? {};
        if (!matchesSelector(nodeLabels, deployment.scheduling.nodeSelector)) {
          return false;
        }
      }

      // Check tolerations vs taints
      if (node.taints && node.taints.length > 0) {
        const tolerations = deployment.tolerations ?? [];
        if (!toleratesBlockingTaints(tolerations, node.taints as never[])) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Create a pod for a deployment with proper incarnation tracking
   */
  private async createPodForDeployment(
    deployment: Deployment,
    targetNodeId?: string
  ): Promise<void> {
    const podQueries = getPodQueriesAdmin();
    const packQueries = getPackQueriesAdmin();

    // Get pack info
    const packResult = await packQueries.getPackById(deployment.packId);
    if (packResult.error || !packResult.data) {
      logger.error('Failed to get pack for deployment', undefined, {
        deploymentId: deployment.id,
        packId: deployment.packId,
        error: packResult.error,
      });
      return;
    }
    const pack = packResult.data;

    // Get the next incarnation number for this deployment
    // This ensures late messages from old incarnations are rejected
    const incarnationResult = await podQueries.getNextIncarnation(deployment.id);
    const incarnation = incarnationResult.data ?? 1;

    // Create pod with deployment reference and incarnation
    // For DaemonSet mode (targetNodeId provided), the pod is pre-assigned to the node
    const result = await podQueries.createPodWithIncarnation({
      packId: deployment.packId,
      packVersion: deployment.packVersion,
      namespace: deployment.namespace,
      labels: {
        ...deployment.podLabels,
        'stark.io/deployment': deployment.name,
        'stark.io/deployment-id': deployment.id,
      },
      annotations: deployment.podAnnotations,
      priorityClassName: deployment.priorityClassName,
      tolerations: deployment.tolerations,
      resourceRequests: deployment.resourceRequests,
      resourceLimits: deployment.resourceLimits,
      scheduling: deployment.scheduling,
    }, deployment.createdBy, deployment.id, incarnation, targetNodeId);

    if (result.error) {
      logger.error('Failed to create pod for deployment', undefined, {
        deploymentId: deployment.id,
        error: result.error,
      });
      return;
    }

    const pod = result.data;

    logger.info('Created pod for deployment', {
      deploymentName: deployment.name,
      podId: pod?.id,
      incarnation,
      targetNodeId,
    });

    // For DaemonSet mode: immediately deploy to the target node
    if (targetNodeId && pod) {
      await this.deployPodToNode(pod.id, targetNodeId, pack);
    }
  }

  /**
   * Send pod:deploy message to a node via WebSocket
   * Used for DaemonSet pods that are pre-assigned to specific nodes
   */
  private async deployPodToNode(
    podId: string,
    nodeId: string,
    pack: Pack
  ): Promise<void> {
    const connectionManager = getConnectionManager();
    if (!connectionManager) {
      logger.error('No connection manager available for pod deployment', {
        podId,
        nodeId,
      });
      return;
    }

    // Get node to find its connection ID
    const nodeQueries = getNodeQueries();
    const nodeResult = await nodeQueries.getNodeById(nodeId);
    if (nodeResult.error || !nodeResult.data) {
      logger.error('Failed to get node for pod deployment', undefined, {
        podId,
        nodeId,
        error: nodeResult.error,
      });
      return;
    }

    const node = nodeResult.data;
    if (!node.connectionId) {
      logger.warn('Node has no connection, pod will be deployed when node reconnects', {
        podId,
        nodeId,
        nodeName: node.name,
      });
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
    const sent = connectionManager.sendToConnection(node.connectionId, {
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
      logger.info('DaemonSet pod deploy message sent to node', {
        podId,
        nodeId,
        nodeName: node.name,
        packName: pack.name,
      });
    } else {
      logger.warn('Failed to send pod deploy message - connection not found', {
        podId,
        nodeId,
        connectionId: node.connectionId,
      });
    }
  }

  /**
   * Trigger an immediate reconciliation cycle
   */
  async triggerReconcile(): Promise<void> {
    await this.runReconcileLoop();
  }

  /**
   * Check if the controller is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Create a deployment controller instance
 */
export function createDeploymentController(
  config?: DeploymentControllerConfig
): DeploymentController {
  return new DeploymentController(config);
}

/**
 * Singleton controller instance
 */
let controllerInstance: DeploymentController | null = null;

/**
 * Get or create the singleton deployment controller
 */
export function getDeploymentController(
  config?: DeploymentControllerConfig
): DeploymentController {
  if (!controllerInstance) {
    controllerInstance = createDeploymentController(config);
  }
  return controllerInstance;
}

/**
 * Reset the deployment controller (for testing)
 */
export function resetDeploymentController(): void {
  if (controllerInstance) {
    controllerInstance.stop();
    controllerInstance = null;
  }
}
