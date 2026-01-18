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

import { createServiceLogger, matchesSelector, isRuntimeCompatible } from '@stark-o/shared';
import type { Deployment, Labels, RuntimeTag, RuntimeType } from '@stark-o/shared';
import { toleratesBlockingTaints } from '@stark-o/shared';
import { getDeploymentQueriesAdmin } from '../supabase/deployments.js';
import { getPodQueriesAdmin } from '../supabase/pods.js';
import { getNodeQueries } from '../supabase/nodes.js';
import { getPackQueries } from '../supabase/packs.js';

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
}

/**
 * Default controller configuration
 */
const DEFAULT_CONFIG: Required<DeploymentControllerConfig> = {
  reconcileInterval: 10000,
  autoStart: true,
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
    // Prevent overlapping runs
    if (this.isProcessing) {
      logger.debug('Skipping reconcile cycle - previous cycle still running');
      return;
    }

    this.isProcessing = true;

    try {
      await this.reconcileDeployments();
    } catch (error) {
      logger.error('Error in reconcile cycle', error instanceof Error ? error : undefined);
    } finally {
      this.isProcessing = false;
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

    logger.debug('Reconciling deployments', { count: deployments.length });

    // Reconcile each deployment
    for (const deployment of deployments) {
      await this.reconcileDeployment(deployment);
    }
  }

  /**
   * Reconcile a single deployment
   */
  private async reconcileDeployment(deployment: Deployment): Promise<void> {
    const podQueries = getPodQueriesAdmin();

    // Get current pods for this deployment
    const podsResult = await podQueries.listPodsByDeployment(deployment.id);
    const currentPods = podsResult.data ?? [];
    
    // Filter to active pods (not stopped, failed, or evicted)
    const activePods = currentPods.filter(p => 
      !['stopped', 'failed', 'evicted'].includes(p.status)
    );

    if (deployment.replicas === 0) {
      // DaemonSet mode: deploy to all matching nodes
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
    const packQueries = getPackQueries();

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
    const packRuntimeTag = packResult.data.runtimeTag;

    // Get all online nodes
    const nodesResult = await nodeQueries.listNodes({ status: 'online' });
    if (nodesResult.error || !nodesResult.data) {
      logger.error('Failed to get nodes for DaemonSet reconciliation', undefined, {
        deploymentId: deployment.id,
        error: nodesResult.error,
      });
      return;
    }

    // Filter nodes based on scheduling constraints AND runtime compatibility
    const eligibleNodes = this.filterEligibleNodes(
      nodesResult.data,
      deployment,
      packRuntimeTag
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
      const podsToRemove = currentPods.slice(0, toRemove);
      
      for (const pod of podsToRemove) {
        await podQueries.updatePod(pod.id, { 
          status: 'stopping' 
        });
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
    }>,
    deployment: Deployment,
    packRuntimeTag?: RuntimeTag
  ): Array<{ id: string; name: string }> {
    return nodes.filter(node => {
      // Check runtime compatibility
      if (packRuntimeTag && node.runtimeType) {
        if (!isRuntimeCompatible(packRuntimeTag, node.runtimeType)) {
          return false;
        }
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
   * Create a pod for a deployment
   */
  private async createPodForDeployment(
    deployment: Deployment,
    targetNodeId?: string
  ): Promise<void> {
    const podQueries = getPodQueriesAdmin();
    const packQueries = getPackQueries();

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

    // Create pod with deployment reference
    const result = await podQueries.createPod({
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
    }, deployment.createdBy, deployment.id);

    if (result.error) {
      logger.error('Failed to create pod for deployment', undefined, {
        deploymentId: deployment.id,
        error: result.error,
      });
      return;
    }

    logger.info('Created pod for deployment', {
      deploymentName: deployment.name,
      podId: result.data?.id,
      targetNodeId,
    });
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
