/**
 * Reactive node registry store using Vue reactivity
 * @module @stark-o/core/stores/node-store
 */

import { computed, type ComputedRef } from '@vue/reactivity';
import type {
  Node,
  NodeStatus,
  RuntimeType,
  RegisterNodeInput,
  UpdateNodeInput,
  Labels,
  Taint,
  AllocatableResources,
  LabelSelector,
} from '@stark-o/shared';
import {
  DEFAULT_ALLOCATABLE,
  DEFAULT_ALLOCATED,
  matchesSelector,
} from '@stark-o/shared';
import { clusterState } from './cluster-store';

/**
 * Internal node update input that includes allocated resources
 */
interface InternalNodeUpdate extends UpdateNodeInput {
  allocated?: Partial<AllocatableResources>;
}

// ============================================================================
// Computed Properties
// ============================================================================

/**
 * Total node count
 */
export const nodeCount: ComputedRef<number> = computed(() =>
  clusterState.nodes.size
);

/**
 * Online node count
 */
export const onlineNodeCount: ComputedRef<number> = computed(() =>
  [...clusterState.nodes.values()].filter(n => n.status === 'online').length
);

/**
 * Nodes grouped by runtime type
 */
export const nodesByRuntime: ComputedRef<Map<RuntimeType, Node[]>> = computed(() => {
  const grouped = new Map<RuntimeType, Node[]>();
  grouped.set('node', []);
  grouped.set('browser', []);

  for (const node of clusterState.nodes.values()) {
    const list = grouped.get(node.runtimeType) ?? [];
    list.push(node);
    grouped.set(node.runtimeType, list);
  }

  return grouped;
});

/**
 * Nodes grouped by status
 */
export const nodesByStatus: ComputedRef<Map<NodeStatus, Node[]>> = computed(() => {
  const grouped = new Map<NodeStatus, Node[]>();

  for (const node of clusterState.nodes.values()) {
    const list = grouped.get(node.status) ?? [];
    list.push(node);
    grouped.set(node.status, list);
  }

  return grouped;
});

// ============================================================================
// Actions
// ============================================================================

/**
 * Add a new node to the registry
 */
export function addNode(input: RegisterNodeInput & { id?: string; registeredBy?: string }): Node {
  const now = new Date();
  const node: Node = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    runtimeType: input.runtimeType,
    status: 'online',
    lastHeartbeat: now,
    capabilities: input.capabilities ?? {},
    registeredBy: input.registeredBy,
    allocatable: { ...DEFAULT_ALLOCATABLE, ...input.allocatable },
    allocated: { ...DEFAULT_ALLOCATED },
    labels: input.labels ?? {},
    annotations: input.annotations ?? {},
    taints: input.taints ?? [],
    unschedulable: false,
    createdAt: now,
    updatedAt: now,
  };

  clusterState.nodes.set(node.id, node);
  return node;
}

/**
 * Update an existing node
 */
export function updateNode(id: string, updates: InternalNodeUpdate): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  const updated: Node = {
    ...node,
    ...updates,
    allocatable: updates.allocatable
      ? { ...node.allocatable, ...updates.allocatable }
      : node.allocatable,
    allocated: updates.allocated
      ? { ...node.allocated, ...updates.allocated }
      : node.allocated,
    labels: updates.labels ?? node.labels,
    annotations: updates.annotations ?? node.annotations,
    taints: updates.taints ?? node.taints,
    updatedAt: new Date(),
  };

  clusterState.nodes.set(id, updated);
  return updated;
}

/**
 * Remove a node from the registry
 */
export function removeNode(id: string): boolean {
  return clusterState.nodes.delete(id);
}

/**
 * Update node status
 */
export function setNodeStatus(id: string, status: NodeStatus): Node | undefined {
  return updateNode(id, { status });
}

/**
 * Process node heartbeat
 */
export function processHeartbeat(id: string): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  const updated: Node = {
    ...node,
    status: 'online',
    lastHeartbeat: new Date(),
    updatedAt: new Date(),
  };

  clusterState.nodes.set(id, updated);
  return updated;
}

/**
 * Mark node as unhealthy (missed heartbeats)
 */
export function markNodeUnhealthy(id: string): Node | undefined {
  return setNodeStatus(id, 'unhealthy');
}

/**
 * Mark node as offline
 */
export function markNodeOffline(id: string): Node | undefined {
  return setNodeStatus(id, 'offline');
}

/**
 * Set node as draining (no new pods)
 */
export function drainNode(id: string): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  return updateNode(id, { status: 'draining', unschedulable: true });
}

/**
 * Set node as under maintenance
 */
export function setNodeMaintenance(id: string): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  return updateNode(id, { status: 'maintenance', unschedulable: true });
}

/**
 * Make node schedulable again
 */
export function uncordonNode(id: string): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  return updateNode(id, { status: 'online', unschedulable: false });
}

/**
 * Update node labels
 */
export function setNodeLabels(id: string, labels: Labels): Node | undefined {
  return updateNode(id, { labels });
}

/**
 * Add a label to a node
 */
export function addNodeLabel(id: string, key: string, value: string): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  return updateNode(id, { labels: { ...node.labels, [key]: value } });
}

/**
 * Remove a label from a node
 */
export function removeNodeLabel(id: string, key: string): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  const { [key]: _, ...remaining } = node.labels;
  return updateNode(id, { labels: remaining });
}

/**
 * Update node taints
 */
export function setNodeTaints(id: string, taints: Taint[]): Node | undefined {
  return updateNode(id, { taints });
}

/**
 * Add a taint to a node
 */
export function addNodeTaint(id: string, taint: Taint): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  // Check if taint already exists
  const exists = node.taints.some(
    t => t.key === taint.key && t.value === taint.value && t.effect === taint.effect
  );
  if (exists) return node;

  return updateNode(id, { taints: [...node.taints, taint] });
}

/**
 * Remove a taint from a node
 */
export function removeNodeTaint(id: string, key: string, effect?: string): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  const filtered = node.taints.filter(t => {
    if (t.key !== key) return true;
    if (effect && t.effect !== effect) return true;
    return false;
  });

  return updateNode(id, { taints: filtered });
}

/**
 * Allocate resources on a node
 */
export function allocateResources(
  id: string,
  cpu: number,
  memory: number
): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  return updateNode(id, {
    allocated: {
      ...node.allocated,
      cpu: node.allocated.cpu + cpu,
      memory: node.allocated.memory + memory,
      pods: node.allocated.pods + 1,
    },
  });
}

/**
 * Release resources on a node
 */
export function releaseResources(
  id: string,
  cpu: number,
  memory: number
): Node | undefined {
  const node = clusterState.nodes.get(id);
  if (!node) return undefined;

  return updateNode(id, {
    allocated: {
      ...node.allocated,
      cpu: Math.max(0, node.allocated.cpu - cpu),
      memory: Math.max(0, node.allocated.memory - memory),
      pods: Math.max(0, node.allocated.pods - 1),
    },
  });
}

/**
 * Find node by name
 */
export function findNodeByName(name: string): Node | undefined {
  for (const node of clusterState.nodes.values()) {
    if (node.name === name) return node;
  }
  return undefined;
}

/**
 * Find nodes matching a label selector
 */
export function findNodesBySelector(selector: LabelSelector): Node[] {
  return [...clusterState.nodes.values()].filter(node =>
    matchesSelector(node.labels, selector)
  );
}

/**
 * Find nodes by runtime type
 */
export function findNodesByRuntime(runtimeType: RuntimeType): Node[] {
  return [...clusterState.nodes.values()].filter(
    node => node.runtimeType === runtimeType
  );
}

/**
 * Get all schedulable nodes for a runtime type
 */
export function getSchedulableNodesForRuntime(runtimeType: RuntimeType): Node[] {
  return [...clusterState.nodes.values()].filter(
    node =>
      node.runtimeType === runtimeType &&
      node.status === 'online' &&
      !node.unschedulable
  );
}

/**
 * Check if any nodes are available
 */
export function hasAvailableNodes(): boolean {
  return [...clusterState.nodes.values()].some(
    node => node.status === 'online' && !node.unschedulable
  );
}

/**
 * Get nodes that need heartbeat check
 * Returns nodes whose last heartbeat is older than the threshold
 */
export function getStaleNodes(thresholdMs: number): Node[] {
  const now = Date.now();
  return [...clusterState.nodes.values()].filter(node => {
    if (!node.lastHeartbeat) return true;
    return now - node.lastHeartbeat.getTime() > thresholdMs;
  });
}
