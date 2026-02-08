/**
 * Service Controller Service
 * @module @stark-o/server/services/service-controller
 *
 * Background service that reconciles services by:
 * 1. Checking desired vs actual pod counts
 * 2. Creating pods for under-replicated services
 * 3. Handling DaemonSet mode (replicas=0) by deploying to all matching nodes
 * 4. Cleaning up pods when services are deleted
 */

import { createServiceLogger, matchesSelector, isRuntimeCompatible, isNodeVersionCompatible, shouldCountTowardCrashLoop } from '@stark-o/shared';
import type { Service, Labels, RuntimeTag, RuntimeType, PodTerminationReason, NodeListItem, PackMetadata, Pack } from '@stark-o/shared';
import { toleratesBlockingTaints } from '@stark-o/shared';
import { getServiceQueriesAdmin } from '../supabase/services.js';
import { getPodQueriesAdmin } from '../supabase/pods.js';
import { getNodeQueries } from '../supabase/nodes.js';
import { getPackQueriesAdmin } from '../supabase/packs.js';
import { getConnectionManager, sendToNode } from './connection-service.js';

/**
 * Logger for service controller
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'service-controller' });

/**
 * Service controller configuration
 */
export interface ServiceControllerConfig {
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
const DEFAULT_CONFIG: Required<ServiceControllerConfig> = {
  reconcileInterval: 10000,
  autoStart: true,
  maxConsecutiveFailures: 3,
  initialBackoffMs: 60000, // 1 minute
  maxBackoffMs: 3600000,   // 1 hour
  failureDetectionWindowMs: 60000, // 1 minute
};

/**
 * Service Controller Service
 *
 * Runs a background loop that reconciles services:
 * - For replicas > 0: maintains exactly N pods
 * - For replicas = 0 (DaemonSet): maintains 1 pod per matching node
 */
export class ServiceController {
  private config: Required<ServiceControllerConfig>;
  private intervalTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;
  /** 
   * Set to true when triggerReconcile() is called during an active cycle.
   * Causes another reconcile to run immediately after the current one finishes.
   * This prevents lost reconciles when orphaned pods are stopped mid-cycle.
   */
  private pendingReconcile = false;
  /**
   * Timestamp of last completed reconcile cycle.
   * Used to debounce triggerReconcile() calls that arrive shortly after
   * a cycle already ran (e.g. reconnect handler + interval timer racing).
   */
  private lastReconcileAt = 0;
  /** Minimum gap in ms between reconcile cycles triggered externally */
  private static readonly RECONCILE_DEBOUNCE_MS = 3000;
  /**
   * Per-service lock set. While a service ID is in this set, no other
   * reconcile pass can create pods for it. Prevents the triggered-reconcile
   * vs interval-reconcile race from double-creating pods.
   */
  private reconcilingServices = new Set<string>();

  constructor(config: ServiceControllerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the reconciliation loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Service controller is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting service controller', {
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

    logger.info('Service controller stopped');
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
      await this.reconcileServices();
    } catch (error) {
      logger.error('Error in reconcile cycle', error instanceof Error ? error : undefined);
    } finally {
      this.isProcessing = false;
      this.lastReconcileAt = Date.now();
      
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
  private async reconcileServices(): Promise<void> {
    const serviceQueries = getServiceQueriesAdmin();

    // Get all active services
    const servicesResult = await serviceQueries.listActiveServices();
    if (servicesResult.error || !servicesResult.data) {
      logger.error('Failed to get active services', undefined, { 
        error: servicesResult.error 
      });
      return;
    }

    const services = servicesResult.data;
    if (services.length === 0) {
      return;
    }

    // logger.debug('Reconciling services', { count: services.length });

    // First, check for pack version updates on followLatest services
    await this.reconcileFollowLatestVersions(services.filter(d => d.followLatest));

    // Reconcile each service
    for (const service of services) {
      await this.reconcileService(service);
    }
  }

  /**
   * Check and update services that follow the latest pack version
   * If a new pack version exists, update the service and trigger a rolling update
   * Includes crash-loop protection to prevent infinite upgrade/fail cycles
   */
  private async reconcileFollowLatestVersions(services: Service[]): Promise<void> {
    if (services.length === 0) {
      return;
    }

    const packQueries = getPackQueriesAdmin();
    const serviceQueries = getServiceQueriesAdmin();

    // Group services by packId to minimize pack queries
    const servicesByPackId = new Map<string, Service[]>();
    for (const service of services) {
      const existing = servicesByPackId.get(service.packId) ?? [];
      existing.push(service);
      servicesByPackId.set(service.packId, existing);
    }

    // Check each pack for new versions
    for (const [packId, packServices] of servicesByPackId) {
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

      // Update services that are behind
      for (const service of packServices) {
        // Skip if we're in backoff period for this failed version
        if (this.isInFailureBackoff(service, latestVersion)) {
          logger.debug('Skipping upgrade due to failure backoff', {
            serviceName: service.name,
            failedVersion: service.failedVersion,
            backoffUntil: service.failureBackoffUntil,
            latestVersion,
          });
          continue;
        }

        if (service.packVersion !== latestVersion) {
          logger.info('Updating followLatest service to new pack version', {
            serviceName: service.name,
            serviceId: service.id,
            oldVersion: service.packVersion,
            newVersion: latestVersion,
          });

          // Record the current version as last successful before upgrading
          // (if pods are running, current version is "successful")
          const updateData: Record<string, unknown> = {
            packVersion: latestVersion,
          };
          
          // Only record last successful if we have running pods
          if (service.readyReplicas > 0 && !service.lastSuccessfulVersion) {
            updateData.lastSuccessfulVersion = service.packVersion;
          }

          // Update the service's pack version
          await serviceQueries.updateService(service.id, updateData);

          // Trigger rolling update of existing pods
          await this.triggerRollingUpdate(service, latestVersion);
        }
      }
    }
  }

  /**
   * Trigger a rolling update of pods for a service
   * Marks existing pods for replacement with new version
   */
  private async triggerRollingUpdate(service: Service, newVersion: string): Promise<void> {
    const podQueries = getPodQueriesAdmin();

    // Get current pods for this service
    const podsResult = await podQueries.listPodsByService(service.id);
    if (podsResult.error || !podsResult.data) {
      logger.error('Failed to get pods for rolling update', undefined, {
        serviceId: service.id,
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
      serviceName: service.name,
      podsToUpdate: podsToUpdate.length,
      newVersion,
    });

    // Mark old pods for termination (they will be replaced by reconcileService)
    for (const pod of podsToUpdate) {
      await podQueries.updatePod(pod.id, { 
        status: 'stopping',
        statusMessage: `Rolling update to version ${newVersion}`,
      });
    }
  }

  /**
   * Check if a service is in failure backoff for a specific version
   */
  private isInFailureBackoff(service: Service, targetVersion: string): boolean {
    // If the target version is the one that failed, check backoff
    if (service.failedVersion === targetVersion && service.failureBackoffUntil) {
      return new Date() < service.failureBackoffUntil;
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
   * Returns true if service should skip further reconciliation
   */
  private async detectAndHandleCrashLoop(
    service: Service,
    allPods: Array<{ id: string; status: string; terminationReason?: PodTerminationReason; packVersion: string; updatedAt?: Date }>
  ): Promise<boolean> {
    const serviceQueries = getServiceQueriesAdmin();

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
      const currentVersionRunning = runningPods.some(p => p.packVersion === service.packVersion);
      if (currentVersionRunning && service.consecutiveFailures > 0) {
        // Clear failure state - service is now healthy
        logger.info('Service recovered, clearing failure state', {
          serviceName: service.name,
          version: service.packVersion,
          previousFailures: service.consecutiveFailures,
        });
        await serviceQueries.updateService(service.id, {
          consecutiveFailures: 0,
          failedVersion: null,
          failureBackoffUntil: null,
          lastSuccessfulVersion: service.packVersion,
        });
      }
      return false;
    }

    // If no recent failures, nothing to do
    if (recentFailures.length === 0) {
      return false;
    }

    // We have failures and no running pods - potential crash loop
    const newFailureCount = service.consecutiveFailures + recentFailures.length;

    // Check if we've exceeded the threshold
    if (newFailureCount >= this.config.maxConsecutiveFailures) {
      logger.warn('Crash loop detected - too many consecutive failures', {
        serviceName: service.name,
        serviceId: service.id,
        version: service.packVersion,
        consecutiveFailures: newFailureCount,
        threshold: this.config.maxConsecutiveFailures,
      });

      // Calculate backoff
      const backoffMs = this.calculateBackoffMs(newFailureCount);
      const backoffUntil = new Date(Date.now() + backoffMs);

      // Check if we can auto-rollback
      if (service.lastSuccessfulVersion && 
          service.lastSuccessfulVersion !== service.packVersion) {
        // Auto-rollback to last successful version
        logger.info('Auto-rolling back to last successful version', {
          serviceName: service.name,
          failedVersion: service.packVersion,
          rollbackVersion: service.lastSuccessfulVersion,
        });

        await serviceQueries.updateService(service.id, {
          packVersion: service.lastSuccessfulVersion,
          consecutiveFailures: 0,
          failedVersion: service.packVersion,
          failureBackoffUntil: backoffUntil,
          statusMessage: `Auto-rolled back from ${service.packVersion} to ${service.lastSuccessfulVersion} after ${newFailureCount} failures`,
        });

        // Trigger rolling update to the old version
        await this.triggerRollingUpdate(service, service.lastSuccessfulVersion);
        return true;
      } else {
        // No version to roll back to - just pause and wait
        logger.warn('No previous version to rollback to, pausing service', {
          serviceName: service.name,
          failedVersion: service.packVersion,
        });

        await serviceQueries.updateService(service.id, {
          status: 'paused',
          consecutiveFailures: newFailureCount,
          failedVersion: service.packVersion,
          failureBackoffUntil: backoffUntil,
          statusMessage: `Paused after ${newFailureCount} failures. No previous version available for rollback.`,
        });
        return true;
      }
    } else {
      // Update failure count but don't trigger rollback yet
      await serviceQueries.updateService(service.id, {
        consecutiveFailures: newFailureCount,
        failedVersion: service.packVersion,
      });
    }

    return false;
  }

  /**
   * Reconcile a single service
   */
  private async reconcileService(service: Service): Promise<void> {
    // Per-service lock: skip if another reconcile pass is already handling this service.
    // This prevents the triggered-reconcile vs interval-reconcile race from both
    // seeing 0 active pods and each creating replacement pods.
    if (this.reconcilingServices.has(service.id)) {
      logger.debug('Skipping service — already being reconciled by another pass', {
        serviceName: service.name,
        serviceId: service.id,
      });
      return;
    }
    this.reconcilingServices.add(service.id);

    try {
      await this.reconcileServiceInner(service);
    } finally {
      this.reconcilingServices.delete(service.id);
    }
  }

  /**
   * Inner reconciliation logic for a single service (called under per-service lock)
   */
  private async reconcileServiceInner(service: Service): Promise<void> {
    const podQueries = getPodQueriesAdmin();

    // Get current pods for this service
    const podsResult = await podQueries.listPodsByService(service.id);
    if (podsResult.error || !podsResult.data) {
      logger.error('Failed to get pods for service', undefined, {
        serviceId: service.id,
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
    
    const shouldSkip = await this.detectAndHandleCrashLoop(service, allPods);
    if (shouldSkip) {
      return;
    }

    // Filter to active pods (not stopped/failed/evicted)
    const activePods = podsResult.data.filter(p => 
      !['stopped', 'failed', 'evicted'].includes(p.status)
    );

    if (service.replicas === 0) {
      // DaemonSet mode: one pod per matching node
      await this.reconcileDaemonSet(service, activePods);
    } else {
      // Regular service: maintain exact replica count
      await this.reconcileReplicas(service, activePods);
    }

    // Update replica counts
    const readyPods = activePods.filter(p => p.status === 'running');
    const availablePods = activePods.filter(p => 
      ['running', 'starting', 'scheduled'].includes(p.status)
    );

    const serviceQueries = getServiceQueriesAdmin();
    await serviceQueries.updateReplicaCounts(
      service.id,
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
    service: Service,
    currentPods: Array<{ id: string; nodeId: string | null; status: string }>
  ): Promise<void> {
    const nodeQueries = getNodeQueries();
    const packQueries = getPackQueriesAdmin();

    // Get pack to check runtime compatibility
    const packResult = await packQueries.getPackById(service.packId);
    if (packResult.error || !packResult.data) {
      logger.error('Failed to get pack for DaemonSet reconciliation', undefined, {
        serviceId: service.id,
        packId: service.packId,
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
        serviceId: service.id,
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
      service,
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
      serviceName: service.name,
      nodesCount: nodesNeedingPods.length,
    });

    // Create pods for each node
    for (const node of nodesNeedingPods) {
      await this.createPodForService(service, node.id);
    }
  }

  /**
   * Reconcile regular service (replicas > 0)
   */
  private async reconcileReplicas(
    service: Service,
    currentPods: Array<{ id: string; nodeId: string | null; status: string }>
  ): Promise<void> {
    const desired = service.replicas;
    const current = currentPods.length;

    if (current < desired) {
      // Scale up
      const toCreate = desired - current;
      logger.info('Scaling up service', {
        serviceName: service.name,
        current,
        desired,
        toCreate,
      });

      for (let i = 0; i < toCreate; i++) {
        await this.createPodForService(service);
      }
    } else if (current > desired) {
      // Scale down - remove excess pods
      const toRemove = current - desired;
      logger.info('Scaling down service', {
        serviceName: service.name,
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
          serviceName: service.name,
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
                reason: 'service_scale_down',
                message: `Pod stopped due to service ${service.name} scale down`,
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
   * Filter nodes eligible for a service based on scheduling constraints and runtime
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
    service: Service,
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
      if (service.scheduling?.nodeSelector) {
        const nodeLabels = node.labels ?? {};
        if (!matchesSelector(nodeLabels, service.scheduling.nodeSelector)) {
          return false;
        }
      }

      // Check tolerations vs taints
      if (node.taints && node.taints.length > 0) {
        const tolerations = service.tolerations ?? [];
        if (!toleratesBlockingTaints(tolerations, node.taints as never[])) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Create a pod for a service with proper incarnation tracking
   */
  private async createPodForService(
    service: Service,
    targetNodeId?: string
  ): Promise<void> {
    const podQueries = getPodQueriesAdmin();
    const packQueries = getPackQueriesAdmin();

    // Get pack info
    const packResult = await packQueries.getPackById(service.packId);
    if (packResult.error || !packResult.data) {
      logger.error('Failed to get pack for service', undefined, {
        serviceId: service.id,
        packId: service.packId,
        error: packResult.error,
      });
      return;
    }
    const pack = packResult.data;

    // Get the next incarnation number for this service
    // This ensures late messages from old incarnations are rejected
    const incarnationResult = await podQueries.getNextIncarnation(service.id);
    const incarnation = incarnationResult.data ?? 1;

    // Create pod with service reference and incarnation
    // For DaemonSet mode (targetNodeId provided), the pod is pre-assigned to the node
    const result = await podQueries.createPodWithIncarnation({
      packId: service.packId,
      packVersion: service.packVersion,
      namespace: service.namespace,
      labels: {
        ...service.podLabels,
        'stark.io/service': service.name,
        'stark.io/service-id': service.id,
      },
      annotations: service.podAnnotations,
      priorityClassName: service.priorityClassName,
      tolerations: service.tolerations,
      resourceRequests: service.resourceRequests,
      resourceLimits: service.resourceLimits,
      scheduling: service.scheduling,
    }, service.createdBy, service.id, incarnation, targetNodeId);

    if (result.error) {
      logger.error('Failed to create pod for service', undefined, {
        serviceId: service.id,
        error: result.error,
      });
      return;
    }

    const pod = result.data;

    logger.info('Created pod for service', {
      serviceName: service.name,
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
      logger.error('No connection manager available for pod service', {
        podId,
        nodeId,
      });
      return;
    }

    // Get node to find its connection ID
    const nodeQueries = getNodeQueries();
    const nodeResult = await nodeQueries.getNodeById(nodeId);
    if (nodeResult.error || !nodeResult.data) {
      logger.error('Failed to get node for pod service', undefined, {
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

    // Get full pod details for service
    const podQueries = getPodQueriesAdmin();
    const podResult = await podQueries.getPodById(podId);
    if (podResult.error || !podResult.data) {
      logger.error('Failed to get pod for service', undefined, {
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
   * Trigger an immediate reconciliation cycle.
   * Debounced: if a reconcile completed within RECONCILE_DEBOUNCE_MS, the call
   * is coalesced into a pending flag so the next interval picks it up instead
   * of racing with pod creation from the just-finished cycle.
   */
  async triggerReconcile(): Promise<void> {
    const elapsed = Date.now() - this.lastReconcileAt;
    if (elapsed < ServiceController.RECONCILE_DEBOUNCE_MS) {
      logger.debug('Debouncing triggerReconcile — recent cycle completed', {
        elapsedMs: elapsed,
        debounceMs: ServiceController.RECONCILE_DEBOUNCE_MS,
      });
      this.pendingReconcile = true;
      return;
    }
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
 * Create a service controller instance
 */
export function createServiceController(
  config?: ServiceControllerConfig
): ServiceController {
  return new ServiceController(config);
}

/**
 * Singleton controller instance
 */
let controllerInstance: ServiceController | null = null;

/**
 * Get or create the singleton service controller
 */
export function getServiceController(
  config?: ServiceControllerConfig
): ServiceController {
  if (!controllerInstance) {
    controllerInstance = createServiceController(config);
  }
  return controllerInstance;
}

/**
 * Reset the service controller (for testing)
 */
export function resetServiceController(): void {
  if (controllerInstance) {
    controllerInstance.stop();
    controllerInstance = null;
  }
}
