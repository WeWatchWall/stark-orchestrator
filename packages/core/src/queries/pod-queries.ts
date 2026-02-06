/**
 * Pod Query Functions
 *
 * Provides query functions for pods that can be used by chaos scenarios
 * and other services. These wrap the reactive store functions.
 * @module @stark-o/core/queries/pod-queries
 */

import {
  findPodsBySelector,
  findPodsByPack,
  findPodsByNode,
  findPodsByNamespace,
  findPodsByStatus,
  getPendingPodsByPriority,
  getEvictablePodsOnNode,
  createPod as storeCreatePod,
  setPodStatus,
  setPodFailed,
  removePod,
} from '../stores/pod-store';
import { getPod, podsList } from '../stores/cluster-store';
import type { Pod, PodStatus, LabelSelector } from '@stark-o/shared';

/**
 * Get a pod by ID
 */
export async function getPodById(podId: string): Promise<Pod | undefined> {
  return getPod(podId);
}

/**
 * List pods with optional filters
 */
export async function listPods(options?: {
  limit?: number;
  status?: PodStatus;
  namespace?: string;
  nodeId?: string;
  serviceId?: string;
}): Promise<Pod[]> {
  let pods = podsList.value;

  if (options?.status) {
    pods = pods.filter((p: Pod) => p.status === options.status);
  }

  if (options?.namespace) {
    pods = pods.filter((p: Pod) => p.namespace === options.namespace);
  }

  if (options?.nodeId) {
    pods = pods.filter((p: Pod) => p.nodeId === options.nodeId);
  }

  if (options?.serviceId) {
    pods = pods.filter((p: Pod) => p.labels?.service === options.serviceId);
  }

  if (options?.limit) {
    pods = pods.slice(0, options.limit);
  }

  return pods;
}

/**
 * Find pods by label selector
 */
export async function findPodsByLabelSelector(
  selector: LabelSelector
): Promise<Pod[]> {
  return findPodsBySelector(selector);
}

/**
 * Find pods by pack
 */
export async function findByPack(packId: string): Promise<Pod[]> {
  return findPodsByPack(packId);
}

/**
 * Find pods by node
 */
export async function findByNode(nodeId: string): Promise<Pod[]> {
  return findPodsByNode(nodeId);
}

/**
 * Find pods by namespace
 */
export async function findByNamespace(namespace: string): Promise<Pod[]> {
  return findPodsByNamespace(namespace);
}

/**
 * Find pods by status
 */
export async function findByStatus(status: PodStatus): Promise<Pod[]> {
  return findPodsByStatus(status);
}

/**
 * Get pending pods sorted by priority
 */
export async function getPendingByPriority(): Promise<Pod[]> {
  return getPendingPodsByPriority();
}

/**
 * Get evictable pods on a node
 */
export async function getEvictableOnNode(nodeId: string): Promise<Pod[]> {
  return getEvictablePodsOnNode(nodeId);
}

/**
 * Create a new pod from a specification
 */
export async function createPodFromSpec(podSpec: {
  packId: string;
  name?: string;
  namespace?: string;
  resourceRequests?: { cpu?: number; memory?: number };
  labels?: Record<string, string>;
}): Promise<Pod> {
  const pod = storeCreatePod({
    packId: podSpec.packId,
    namespace: podSpec.namespace || 'default',
    priority: 0,
    labels: podSpec.labels,
  });
  return pod;
}

/**
 * Update pod status
 */
export async function updatePodStatus(
  podId: string,
  status: PodStatus,
  details?: {
    terminatedAt?: Date;
    terminationReason?: string;
    terminationMessage?: string;
  }
): Promise<void> {
  if (status === 'failed' && details) {
    // setPodFailed takes (id, message?) - combine reason and message
    const message = details.terminationMessage
      ? `${details.terminationReason || 'unknown'}: ${details.terminationMessage}`
      : details.terminationReason || 'unknown';
    setPodFailed(podId, message);
  } else {
    setPodStatus(podId, status);
  }
}

/**
 * Remove a pod
 */
export async function deletePod(podId: string): Promise<void> {
  removePod(podId);
}

/**
 * Consolidated pod queries export
 */
export const podQueries = {
  getPodById,
  listPods,
  findBySelector: findPodsByLabelSelector,
  findByPack,
  findByNode,
  findByNamespace,
  findByStatus,
  getPendingByPriority,
  getEvictableOnNode,
  createPod: createPodFromSpec,
  updatePodStatus,
  deletePod,
};
