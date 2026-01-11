/**
 * Reactive cluster state store using Vue reactivity
 * @module @stark-o/core/stores/cluster-store
 */

import { reactive, computed, ref, shallowRef, type Ref, type ComputedRef } from '@vue/reactivity';
import type {
  Node,
  Pod,
  Pack,
  ClusterConfig,
  Namespace,
  PriorityClass,
  ClusterStats,
  ClusterHealth,
} from '@stark-o/shared';
import {
  DEFAULT_CLUSTER_CONFIG,
  getClusterHealthStatus,
  DEFAULT_RESOURCE_USAGE,
} from '@stark-o/shared';

/**
 * Cluster state interface
 */
export interface ClusterState {
  /** All registered nodes by ID */
  nodes: Map<string, Node>;
  /** All active pods by ID */
  pods: Map<string, Pod>;
  /** All registered packs by ID */
  packs: Map<string, Pack>;
  /** All namespaces by name */
  namespaces: Map<string, Namespace>;
  /** Priority classes by name */
  priorityClasses: Map<string, PriorityClass>;
  /** Cluster configuration */
  config: ClusterConfig;
  /** Whether the cluster is initialized */
  initialized: boolean;
  /** Last sync timestamp */
  lastSyncAt: Date | null;
}

/**
 * Create a default cluster configuration
 */
function createDefaultConfig(): ClusterConfig {
  return {
    ...DEFAULT_CLUSTER_CONFIG,
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create the reactive cluster state
 */
function createClusterState(): ClusterState {
  return reactive<ClusterState>({
    nodes: new Map(),
    pods: new Map(),
    packs: new Map(),
    namespaces: new Map(),
    priorityClasses: new Map(),
    config: createDefaultConfig(),
    initialized: false,
    lastSyncAt: null,
  });
}

/**
 * Cluster store instance
 */
export const clusterState = createClusterState();

/**
 * Loading state for async operations
 */
export const isLoading: Ref<boolean> = ref(false);

/**
 * Error state for async operations
 */
export const lastError: Ref<Error | null> = shallowRef(null);

// ============================================================================
// Computed Properties
// ============================================================================

/**
 * List of all nodes
 */
export const nodesList: ComputedRef<Node[]> = computed(() =>
  [...clusterState.nodes.values()]
);

/**
 * List of healthy nodes
 */
export const healthyNodes: ComputedRef<Node[]> = computed(() =>
  nodesList.value.filter(node => node.status === 'online')
);

/**
 * List of unhealthy nodes
 */
export const unhealthyNodes: ComputedRef<Node[]> = computed(() =>
  nodesList.value.filter(node =>
    node.status === 'unhealthy' || node.status === 'offline'
  )
);

/**
 * List of schedulable nodes (online and not unschedulable)
 */
export const schedulableNodes: ComputedRef<Node[]> = computed(() =>
  nodesList.value.filter(node =>
    node.status === 'online' && !node.unschedulable
  )
);

/**
 * Node.js nodes
 */
export const nodeJsNodes: ComputedRef<Node[]> = computed(() =>
  nodesList.value.filter(node => node.runtimeType === 'node')
);

/**
 * Browser nodes
 */
export const browserNodes: ComputedRef<Node[]> = computed(() =>
  nodesList.value.filter(node => node.runtimeType === 'browser')
);

/**
 * List of all pods
 */
export const podsList: ComputedRef<Pod[]> = computed(() =>
  [...clusterState.pods.values()]
);

/**
 * List of running pods
 */
export const runningPods: ComputedRef<Pod[]> = computed(() =>
  podsList.value.filter(pod => pod.status === 'running')
);

/**
 * List of pending pods
 */
export const pendingPods: ComputedRef<Pod[]> = computed(() =>
  podsList.value.filter(pod => pod.status === 'pending')
);

/**
 * List of failed pods
 */
export const failedPods: ComputedRef<Pod[]> = computed(() =>
  podsList.value.filter(pod => pod.status === 'failed')
);

/**
 * List of all packs
 */
export const packsList: ComputedRef<Pack[]> = computed(() =>
  [...clusterState.packs.values()]
);

/**
 * List of all namespaces
 */
export const namespacesList: ComputedRef<Namespace[]> = computed(() =>
  [...clusterState.namespaces.values()]
);

/**
 * Cluster statistics
 */
export const clusterStats: ComputedRef<ClusterStats> = computed(() => {
  const nodes = nodesList.value;
  const pods = podsList.value;

  let totalCpu = 0;
  let allocatedCpu = 0;
  let totalMemory = 0;
  let allocatedMemory = 0;

  for (const node of nodes) {
    totalCpu += node.allocatable.cpu;
    allocatedCpu += node.allocated.cpu;
    totalMemory += node.allocatable.memory;
    allocatedMemory += node.allocated.memory;
  }

  return {
    totalNodes: nodes.length,
    healthyNodes: healthyNodes.value.length,
    unhealthyNodes: unhealthyNodes.value.length,
    totalPods: pods.length,
    runningPods: runningPods.value.length,
    pendingPods: pendingPods.value.length,
    totalCpu,
    allocatedCpu,
    totalMemory,
    allocatedMemory,
    namespaceCount: clusterState.namespaces.size,
    packCount: clusterState.packs.size,
    lastUpdated: new Date(),
  };
});

/**
 * Cluster health status
 */
export const clusterHealth: ComputedRef<ClusterHealth> = computed(() =>
  getClusterHealthStatus(clusterStats.value)
);

// ============================================================================
// Actions
// ============================================================================

/**
 * Create a default namespace
 */
function createDefaultNamespace(name: string, labels?: Record<string, string>, annotations?: Record<string, string>): Namespace {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name,
    phase: 'active',
    labels: labels ?? {},
    annotations: annotations ?? {},
    resourceUsage: { ...DEFAULT_RESOURCE_USAGE },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Ensure default namespaces exist
 */
function ensureDefaultNamespaces(): void {
  if (!clusterState.namespaces.has('default')) {
    clusterState.namespaces.set('default', createDefaultNamespace('default'));
  }
  if (!clusterState.namespaces.has('stark-system')) {
    clusterState.namespaces.set('stark-system', createDefaultNamespace(
      'stark-system',
      { 'stark.io/system': 'true' },
      { 'stark.io/description': 'System namespace for orchestrator components' }
    ));
  }
  if (!clusterState.namespaces.has('stark-public')) {
    clusterState.namespaces.set('stark-public', createDefaultNamespace(
      'stark-public',
      { 'stark.io/public': 'true' },
      { 'stark.io/description': 'Public namespace for shared resources' }
    ));
  }
}

/**
 * Initialize the cluster state
 */
export function initializeCluster(config?: Partial<ClusterConfig>): void {
  if (config) {
    Object.assign(clusterState.config, config, { updatedAt: new Date() });
  }
  clusterState.initialized = true;
  clusterState.lastSyncAt = new Date();
  
  // Ensure default namespaces exist
  ensureDefaultNamespaces();
}

/**
 * Reset the cluster state
 */
export function resetCluster(): void {
  clusterState.nodes.clear();
  clusterState.pods.clear();
  clusterState.packs.clear();
  clusterState.namespaces.clear();
  clusterState.priorityClasses.clear();
  clusterState.config = createDefaultConfig();
  clusterState.initialized = false;
  clusterState.lastSyncAt = null;
  isLoading.value = false;
  lastError.value = null;
}

/**
 * Update cluster configuration
 */
export function updateClusterConfig(updates: Partial<ClusterConfig>): void {
  Object.assign(clusterState.config, updates, { updatedAt: new Date() });
}

/**
 * Set loading state
 */
export function setLoading(loading: boolean): void {
  isLoading.value = loading;
}

/**
 * Set error state
 */
export function setError(error: Error | null): void {
  lastError.value = error;
}

/**
 * Clear error state
 */
export function clearError(): void {
  lastError.value = null;
}

/**
 * Get a node by ID
 */
export function getNode(id: string): Node | undefined {
  return clusterState.nodes.get(id);
}

/**
 * Get a pod by ID
 */
export function getPod(id: string): Pod | undefined {
  return clusterState.pods.get(id);
}

/**
 * Get a pack by ID
 */
export function getPack(id: string): Pack | undefined {
  return clusterState.packs.get(id);
}

/**
 * Get a namespace by name
 */
export function getNamespace(name: string): Namespace | undefined {
  return clusterState.namespaces.get(name);
}

/**
 * Get pods on a specific node
 */
export function getPodsOnNode(nodeId: string): Pod[] {
  return podsList.value.filter(pod => pod.nodeId === nodeId);
}

/**
 * Get pods in a namespace
 */
export function getPodsInNamespace(namespace: string): Pod[] {
  return podsList.value.filter(pod => pod.namespace === namespace);
}

/**
 * Get pods for a specific pack
 */
export function getPodsForPack(packId: string): Pod[] {
  return podsList.value.filter(pod => pod.packId === packId);
}

/**
 * Get priority class by name
 */
export function getPriorityClass(name: string): PriorityClass | undefined {
  return clusterState.priorityClasses.get(name);
}

/**
 * Check if cluster is healthy
 */
export function isClusterHealthy(): boolean {
  return clusterHealth.value.status === 'healthy';
}

/**
 * Reset cluster state to initial empty state (for testing)
 */
export function resetClusterState(): void {
  clusterState.nodes.clear();
  clusterState.pods.clear();
  clusterState.packs.clear();
  clusterState.namespaces.clear();
  clusterState.priorityClasses.clear();
  clusterState.config = createDefaultConfig();
  clusterState.initialized = false;
  clusterState.lastSyncAt = null;
  
  // Ensure default namespaces are always present
  ensureDefaultNamespaces();
}
