/**
 * Pod History Service
 *
 * Provides integrated pod status management with automatic history tracking.
 * Ensures all pod state changes are recorded in the history table.
 * @module @stark-o/server/supabase/pod-history-service
 */

import type { PodStatus, PodAction, Pod, PodHistoryEntry } from '@stark-o/shared';
import { createServiceLogger } from '@stark-o/shared';
import { getPodQueries, getPodQueriesAdmin, type PodResult, type PodQueries } from './pods.js';

/**
 * Gets the appropriate PodQueries instance based on useAdmin flag
 */
function getQueries(useAdmin?: boolean): PodQueries {
  return useAdmin ? getPodQueriesAdmin() : getPodQueries();
}

/**
 * Logger for pod history service
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'pod-history-service' });

/**
 * Maps pod status to pod action for history tracking
 */
function statusToAction(status: PodStatus): PodAction {
  switch (status) {
    case 'scheduled':
      return 'scheduled';
    case 'starting':
    case 'running':
      return 'started';
    case 'stopping':
    case 'stopped':
      return 'stopped';
    case 'failed':
      return 'failed';
    case 'evicted':
      return 'evicted';
    default:
      return 'updated';
  }
}

/**
 * Options for pod status change operations
 */
export interface StatusChangeOptions {
  /** User ID performing the action */
  actorId?: string;
  /** Reason for the status change */
  reason?: string;
  /** Human-readable message */
  message?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Use admin client to bypass RLS (for internal services like scheduler) */
  useAdmin?: boolean;
}

/**
 * Schedule a pod to a node with history tracking
 */
export async function schedulePodWithHistory(
  podId: string,
  nodeId: string,
  options?: StatusChangeOptions
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousStatus = previousResult.data?.status;
  const previousNodeId = previousResult.data?.nodeId ?? undefined;

  // Update pod status
  const result = await podQueries.schedulePod(podId, nodeId);

  if (result.error) {
    if ((result.error as unknown as string) === 'POD_NOT_PENDING') {
      // Another code path already scheduled this pod — expected race resolution, not an error
      logger.debug('Pod already scheduled by another path, skipping', { podId, nodeId });
    } else {
      logger.error('Failed to schedule pod', undefined, { podId, nodeId, error: result.error });
    }
    return result;
  }

  // Record history
  await podQueries.createPodHistory({
    podId,
    action: 'scheduled',
    actorId: options?.actorId,
    previousStatus,
    newStatus: 'scheduled',
    previousNodeId,
    newNodeId: nodeId,
    reason: options?.reason ?? 'pod_scheduled',
    message: options?.message ?? `Pod scheduled to node ${nodeId}`,
    metadata: options?.metadata,
  });

  logger.debug('Pod scheduled with history', { podId, nodeId, previousStatus });
  return result;
}

/**
 * Start a pod with history tracking
 */
export async function startPodWithHistory(
  podId: string,
  options?: StatusChangeOptions
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousStatus = previousResult.data?.status;
  const nodeId = previousResult.data?.nodeId ?? undefined;

  // Update pod status
  const result = await podQueries.startPod(podId);

  if (result.error) {
    logger.error('Failed to start pod', undefined, { podId, error: result.error });
    return result;
  }

  // Record history
  await podQueries.createPodHistory({
    podId,
    action: 'started',
    actorId: options?.actorId,
    previousStatus,
    newStatus: 'running',
    newNodeId: nodeId,
    reason: options?.reason ?? 'pod_started',
    message: options?.message ?? 'Pod started running',
    metadata: options?.metadata,
  });

  logger.debug('Pod started with history', { podId, previousStatus, nodeId });
  return result;
}

/**
 * Stop a pod with history tracking
 */
export async function stopPodWithHistory(
  podId: string,
  stopMessage?: string,
  options?: StatusChangeOptions
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousStatus = previousResult.data?.status;
  const nodeId = previousResult.data?.nodeId ?? undefined;

  // Update pod status
  const result = await podQueries.stopPod(podId, stopMessage);

  if (result.error) {
    logger.error('Failed to stop pod', undefined, { podId, error: result.error });
    return result;
  }

  // Record history
  await podQueries.createPodHistory({
    podId,
    action: 'stopped',
    actorId: options?.actorId,
    previousStatus,
    newStatus: 'stopped',
    previousNodeId: nodeId,
    reason: options?.reason ?? 'pod_stopped',
    message: options?.message ?? stopMessage ?? 'Pod stopped',
    metadata: options?.metadata,
  });

  logger.debug('Pod stopped with history', { podId, previousStatus, nodeId });
  return result;
}

/**
 * Mark a pod as failed with history tracking
 */
export async function failPodWithHistory(
  podId: string,
  errorMessage: string,
  options?: StatusChangeOptions
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousStatus = previousResult.data?.status;
  const nodeId = previousResult.data?.nodeId ?? undefined;

  // Update pod status
  const result = await podQueries.failPod(podId, errorMessage);

  if (result.error) {
    logger.error('Failed to mark pod as failed', undefined, { podId, error: result.error });
    return result;
  }

  // Record history
  await podQueries.createPodHistory({
    podId,
    action: 'failed',
    actorId: options?.actorId,
    previousStatus,
    newStatus: 'failed',
    previousNodeId: nodeId,
    reason: options?.reason ?? 'pod_failed',
    message: options?.message ?? errorMessage,
    metadata: {
      ...options?.metadata,
      errorMessage,
    },
  });

  logger.debug('Pod marked as failed with history', { podId, previousStatus, nodeId, errorMessage });
  return result;
}

/**
 * Evict a pod with history tracking
 */
export async function evictPodWithHistory(
  podId: string,
  evictionReason: string,
  options?: StatusChangeOptions
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousStatus = previousResult.data?.status;
  const nodeId = previousResult.data?.nodeId ?? undefined;

  // Update pod status
  const result = await podQueries.evictPod(podId, evictionReason);

  if (result.error) {
    logger.error('Failed to evict pod', undefined, { podId, error: result.error });
    return result;
  }

  // Record history
  await podQueries.createPodHistory({
    podId,
    action: 'evicted',
    actorId: options?.actorId,
    previousStatus,
    newStatus: 'evicted',
    previousNodeId: nodeId,
    reason: options?.reason ?? evictionReason,
    message: options?.message ?? `Pod evicted: ${evictionReason}`,
    metadata: {
      ...options?.metadata,
      evictionReason,
    },
  });

  logger.debug('Pod evicted with history', { podId, previousStatus, nodeId, evictionReason });
  return result;
}

/**
 * Restart a pod with history tracking
 */
export async function restartPodWithHistory(
  podId: string,
  options?: StatusChangeOptions
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  if (!previousResult.data) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'Pod not found' } as any };
  }
  
  const previousStatus = previousResult.data.status;
  const nodeId = previousResult.data.nodeId ?? undefined;
  const packVersion = previousResult.data.packVersion;

  // First stop the pod
  await podQueries.stopPod(podId, 'Restarting');

  // Then start it again
  const result = await podQueries.startPod(podId);

  if (result.error) {
    logger.error('Failed to restart pod', undefined, { podId, error: result.error });
    return result;
  }

  // Record history
  await podQueries.createPodHistory({
    podId,
    action: 'restarted',
    actorId: options?.actorId,
    previousStatus,
    newStatus: 'running',
    previousNodeId: nodeId,
    newNodeId: nodeId,
    previousVersion: packVersion,
    newVersion: packVersion,
    reason: options?.reason ?? 'pod_restarted',
    message: options?.message ?? 'Pod restarted',
    metadata: options?.metadata,
  });

  logger.debug('Pod restarted with history', { podId, previousStatus, nodeId });
  return result;
}

/**
 * Update pod status with history tracking
 */
export async function updatePodStatusWithHistory(
  podId: string,
  newStatus: PodStatus,
  statusOptions?: {
    statusMessage?: string;
    nodeId?: string;
  },
  historyOptions?: StatusChangeOptions
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(historyOptions?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousStatus = previousResult.data?.status;
  const previousNodeId = previousResult.data?.nodeId ?? undefined;

  // Update pod status
  const result = await podQueries.updatePodStatus(podId, newStatus, statusOptions);

  if (result.error) {
    logger.error('Failed to update pod status', undefined, { podId, newStatus, error: result.error });
    return result;
  }

  // Determine action from status
  const action = statusToAction(newStatus);

  // Record history
  await podQueries.createPodHistory({
    podId,
    action,
    actorId: historyOptions?.actorId,
    previousStatus,
    newStatus,
    previousNodeId,
    newNodeId: statusOptions?.nodeId ?? previousNodeId,
    reason: historyOptions?.reason ?? `status_changed_to_${newStatus}`,
    message: historyOptions?.message ?? statusOptions?.statusMessage ?? `Status changed to ${newStatus}`,
    metadata: historyOptions?.metadata,
  });

  logger.debug('Pod status updated with history', { podId, previousStatus, newStatus });
  return result;
}

/**
 * Rollback pod with history tracking
 * This is a wrapper that ensures history is recorded - the actual rollback
 * API endpoint already records history, but this can be used for internal rollbacks
 */
export async function rollbackPodWithHistory(
  podId: string,
  newPackId: string,
  newVersion: string,
  options?: StatusChangeOptions & { previousVersion?: string }
): Promise<PodResult<Pod>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousVersion = options?.previousVersion ?? previousResult.data?.packVersion;
  const nodeId = previousResult.data?.nodeId ?? undefined;

  // Rollback pod
  const result = await podQueries.rollbackPod(podId, newPackId, newVersion);

  if (result.error) {
    logger.error('Failed to rollback pod', undefined, { podId, newPackId, newVersion, error: result.error });
    return result;
  }

  // Record history
  await podQueries.createPodHistory({
    podId,
    action: 'rolled_back',
    actorId: options?.actorId,
    previousVersion,
    newVersion,
    newNodeId: nodeId,
    reason: options?.reason ?? 'pod_rolled_back',
    message: options?.message ?? `Rolled back from ${previousVersion} to ${newVersion}`,
    metadata: {
      ...options?.metadata,
      previousPackId: previousResult.data?.packId,
      newPackId,
    },
  });

  logger.info('Pod rolled back with history', { podId, previousVersion, newVersion, nodeId });
  return result;
}

/**
 * Delete pod with history tracking
 * Records history before deletion since the pod will be removed
 */
export async function deletePodWithHistory(
  podId: string,
  options?: StatusChangeOptions
): Promise<PodResult<void>> {
  const podQueries = getQueries(options?.useAdmin);

  // Get the pod's previous state for history
  const previousResult = await podQueries.getPodById(podId);
  const previousStatus = previousResult.data?.status;
  const nodeId = previousResult.data?.nodeId ?? undefined;
  const packVersion = previousResult.data?.packVersion;

  // Record history before deletion (since pod will be gone)
  await podQueries.createPodHistory({
    podId,
    action: 'deleted',
    actorId: options?.actorId,
    previousStatus,
    reason: options?.reason ?? 'pod_deleted',
    message: options?.message ?? 'Pod deleted',
    previousNodeId: nodeId,
    previousVersion: packVersion,
    metadata: {
      ...options?.metadata,
      deletedAt: new Date().toISOString(),
    },
  });

  // Delete pod
  const result = await podQueries.deletePod(podId);

  if (result.error) {
    logger.error('Failed to delete pod', undefined, { podId, error: result.error });
    return result;
  }

  logger.info('Pod deleted with history', { podId, previousStatus, nodeId });
  return result;
}

/**
 * Get full pod history with pagination
 */
export async function getFullPodHistory(
  podId: string,
  options?: { limit?: number; offset?: number }
): Promise<PodResult<PodHistoryEntry[]>> {
  return getPodQueries().getPodHistory(podId, options);
}

/**
 * Get the latest history entry for a pod
 */
export async function getLatestHistoryEntry(
  podId: string
): Promise<PodResult<PodHistoryEntry>> {
  return getPodQueries().getLatestPodHistoryEntry(podId);
}

// Export all functions
export const PodHistoryService = {
  schedulePodWithHistory,
  startPodWithHistory,
  stopPodWithHistory,
  failPodWithHistory,
  evictPodWithHistory,
  restartPodWithHistory,
  updatePodStatusWithHistory,
  rollbackPodWithHistory,
  deletePodWithHistory,
  getFullPodHistory,
  getLatestHistoryEntry,
};

export default PodHistoryService;
