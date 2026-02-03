/**
 * Reactive pods state store using Vue reactivity
 * @module @stark-o/core/stores/pod-store
 */

import { computed, type ComputedRef } from '@vue/reactivity';
import type {
  Pod,
  PodStatus,
  CreatePodInput,
  UpdatePodInput,
  PodHistoryEntry,
  PodAction,
  Labels,
  ResourceRequirements,
  Capability,
} from '@stark-o/shared';
import {
  DEFAULT_RESOURCE_REQUESTS,
  DEFAULT_RESOURCE_LIMITS,
  matchesSelector,
} from '@stark-o/shared';
import { clusterState } from './cluster-store';

/**
 * Extended create pod input with internal fields
 */
interface InternalCreatePodInput extends CreatePodInput {
  id?: string;
  priority?: number;
  createdBy?: string;
  grantedCapabilities?: Capability[];
}

/**
 * Internal pod update input that includes resource updates
 */
interface InternalPodUpdate extends UpdatePodInput {
  resourceRequests?: Partial<ResourceRequirements>;
  resourceLimits?: Partial<ResourceRequirements>;
}

// ============================================================================
// Internal State
// ============================================================================

/**
 * Pod history entries (kept in memory for quick access)
 */
const podHistory: Map<string, PodHistoryEntry[]> = new Map();

// ============================================================================
// Computed Properties
// ============================================================================

/**
 * Total pod count
 */
export const podCount: ComputedRef<number> = computed(() =>
  clusterState.pods.size
);

/**
 * Running pod count
 */
export const runningPodCount: ComputedRef<number> = computed(() =>
  [...clusterState.pods.values()].filter(p => p.status === 'running').length
);

/**
 * Pending pod count
 */
export const pendingPodCount: ComputedRef<number> = computed(() =>
  [...clusterState.pods.values()].filter(p => p.status === 'pending').length
);

/**
 * Pods grouped by status
 */
export const podsByStatus: ComputedRef<Map<PodStatus, Pod[]>> = computed(() => {
  const grouped = new Map<PodStatus, Pod[]>();

  for (const pod of clusterState.pods.values()) {
    const list = grouped.get(pod.status) ?? [];
    list.push(pod);
    grouped.set(pod.status, list);
  }

  return grouped;
});

/**
 * Pods grouped by namespace
 */
export const podsByNamespace: ComputedRef<Map<string, Pod[]>> = computed(() => {
  const grouped = new Map<string, Pod[]>();

  for (const pod of clusterState.pods.values()) {
    const list = grouped.get(pod.namespace) ?? [];
    list.push(pod);
    grouped.set(pod.namespace, list);
  }

  return grouped;
});

/**
 * Pods grouped by node
 */
export const podsByNode: ComputedRef<Map<string, Pod[]>> = computed(() => {
  const grouped = new Map<string, Pod[]>();

  for (const pod of clusterState.pods.values()) {
    if (pod.nodeId) {
      const list = grouped.get(pod.nodeId) ?? [];
      list.push(pod);
      grouped.set(pod.nodeId, list);
    }
  }

  return grouped;
});

// ============================================================================
// Actions
// ============================================================================

/**
 * Create a new pod
 */
export function createPod(input: InternalCreatePodInput): Pod {
  const now = new Date();
  
  // Ensure resource requirements have all required fields
  const resourceRequests: ResourceRequirements = {
    ...DEFAULT_RESOURCE_REQUESTS,
    ...input.resourceRequests,
  };
  const resourceLimits: ResourceRequirements = {
    ...DEFAULT_RESOURCE_LIMITS,
    ...input.resourceLimits,
  };
  
  const pod: Pod = {
    id: input.id ?? crypto.randomUUID(),
    packId: input.packId,
    packVersion: input.packVersion ?? 'latest',
    nodeId: null,
    status: 'pending',
    namespace: input.namespace ?? clusterState.config.defaultNamespace,
    labels: input.labels ?? {},
    annotations: input.annotations ?? {},
    priorityClassName: input.priorityClassName,
    priority: input.priority ?? 0,
    tolerations: input.tolerations ?? [],
    resourceRequests,
    resourceLimits,
    scheduling: input.scheduling,
    createdBy: input.createdBy ?? 'system',
    metadata: input.metadata ?? {},
    grantedCapabilities: input.grantedCapabilities ?? [],
    createdAt: now,
    updatedAt: now,
  };

  clusterState.pods.set(pod.id, pod);
  addHistoryEntry(pod.id, 'created', pod.createdBy, { status: 'pending' });

  return pod;
}

/**
 * Update an existing pod
 */
export function updatePod(id: string, updates: InternalPodUpdate): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    ...updates,
    resourceRequests: updates.resourceRequests
      ? { ...pod.resourceRequests, ...updates.resourceRequests }
      : pod.resourceRequests,
    resourceLimits: updates.resourceLimits
      ? { ...pod.resourceLimits, ...updates.resourceLimits }
      : pod.resourceLimits,
    labels: updates.labels ?? pod.labels,
    annotations: updates.annotations ?? pod.annotations,
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);
  return updated;
}

/**
 * Remove a pod from the store
 */
export function removePod(id: string): boolean {
  return clusterState.pods.delete(id);
}

/**
 * Schedule a pod to a node
 */
export function schedulePod(id: string, nodeId: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    nodeId,
    status: 'scheduled',
    scheduledAt: new Date(),
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);
  addHistoryEntry(id, 'scheduled', undefined, { nodeId });

  return updated;
}

/**
 * Mark pod as starting
 */
export function startPod(id: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    status: 'starting',
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);
  addHistoryEntry(id, 'started');

  return updated;
}

/**
 * Mark pod as running
 */
export function setPodRunning(id: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    status: 'running',
    startedAt: new Date(),
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);

  return updated;
}

/**
 * Mark pod as stopping
 */
export function stopPod(id: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    status: 'stopping',
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);
  addHistoryEntry(id, 'stopped');

  return updated;
}

/**
 * Mark pod as stopped
 */
export function setPodStopped(id: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    status: 'stopped',
    stoppedAt: new Date(),
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);

  return updated;
}

/**
 * Mark pod as failed
 */
export function setPodFailed(id: string, message?: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    status: 'failed',
    statusMessage: message,
    stoppedAt: new Date(),
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);
  addHistoryEntry(id, 'failed', undefined, { message });

  return updated;
}

/**
 * Mark pod as evicted
 */
export function evictPod(id: string, reason?: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const updated: Pod = {
    ...pod,
    status: 'evicted',
    statusMessage: reason,
    stoppedAt: new Date(),
    updatedAt: new Date(),
  };

  clusterState.pods.set(id, updated);
  addHistoryEntry(id, 'evicted', undefined, { reason });

  return updated;
}

/**
 * Update pod status
 */
export function setPodStatus(id: string, status: PodStatus, message?: string): Pod | undefined {
  return updatePod(id, { status, statusMessage: message });
}

/**
 * Update pod labels
 */
export function setPodLabels(id: string, labels: Labels): Pod | undefined {
  return updatePod(id, { labels });
}

/**
 * Add a label to a pod
 */
export function addPodLabel(id: string, key: string, value: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  return updatePod(id, { labels: { ...pod.labels, [key]: value } });
}

/**
 * Remove a label from a pod
 */
export function removePodLabel(id: string, key: string): Pod | undefined {
  const pod = clusterState.pods.get(id);
  if (!pod) return undefined;

  const { [key]: _, ...remaining } = pod.labels;
  return updatePod(id, { labels: remaining });
}

// ============================================================================
// Pod History
// ============================================================================

/**
 * Add a history entry for a pod
 */
export function addHistoryEntry(
  podId: string,
  action: PodAction,
  actorId?: string,
  metadata?: Record<string, unknown>
): PodHistoryEntry {
  const pod = clusterState.pods.get(podId);

  const entry: PodHistoryEntry = {
    id: crypto.randomUUID(),
    podId,
    action,
    actorId,
    previousStatus: pod?.status,
    newNodeId: pod?.nodeId ?? undefined,
    metadata: metadata ?? {},
    timestamp: new Date(),
  };

  const history = podHistory.get(podId) ?? [];
  history.push(entry);
  podHistory.set(podId, history);

  return entry;
}

/**
 * Get history for a pod
 */
export function getPodHistory(podId: string): PodHistoryEntry[] {
  return podHistory.get(podId) ?? [];
}

/**
 * Clear history for a pod
 */
export function clearPodHistory(podId: string): void {
  podHistory.delete(podId);
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Find pods matching a label selector
 */
export function findPodsBySelector(selector: Record<string, string>): Pod[] {
  const selectorObj = {
    matchLabels: selector,
    matchExpressions: [],
  };

  return [...clusterState.pods.values()].filter(pod =>
    matchesSelector(pod.labels, selectorObj)
  );
}

/**
 * Find pods by pack ID
 */
export function findPodsByPack(packId: string): Pod[] {
  return [...clusterState.pods.values()].filter(pod => pod.packId === packId);
}

/**
 * Find pods by node ID
 */
export function findPodsByNode(nodeId: string): Pod[] {
  return [...clusterState.pods.values()].filter(pod => pod.nodeId === nodeId);
}

/**
 * Find pods by namespace
 */
export function findPodsByNamespace(namespace: string): Pod[] {
  return [...clusterState.pods.values()].filter(pod => pod.namespace === namespace);
}

/**
 * Find pods by status
 */
export function findPodsByStatus(status: PodStatus): Pod[] {
  return [...clusterState.pods.values()].filter(pod => pod.status === status);
}

/**
 * Find pending pods sorted by priority (highest first)
 */
export function getPendingPodsByPriority(): Pod[] {
  return [...clusterState.pods.values()]
    .filter(pod => pod.status === 'pending')
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Find evictable pods on a node (sorted by priority, lowest first)
 */
export function getEvictablePodsOnNode(nodeId: string): Pod[] {
  return [...clusterState.pods.values()]
    .filter(pod =>
      pod.nodeId === nodeId &&
      (pod.status === 'running' || pod.status === 'scheduled')
    )
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Check if a node can accept more pods
 */
export function canNodeAcceptPods(nodeId: string): boolean {
  const podsOnNode = findPodsByNode(nodeId);
  const activePods = podsOnNode.filter(p =>
    p.status === 'running' || p.status === 'scheduled' || p.status === 'starting'
  );
  return activePods.length < clusterState.config.maxPodsPerNode;
}

/**
 * Count active pods in namespace
 */
export function countActivePodsInNamespace(namespace: string): number {
  return [...clusterState.pods.values()].filter(
    pod =>
      pod.namespace === namespace &&
      (pod.status === 'running' || pod.status === 'scheduled' || pod.status === 'pending')
  ).length;
}
