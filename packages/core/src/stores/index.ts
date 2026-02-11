/**
 * Reactive stores for Stark Orchestrator
 * @module @stark-o/core/stores
 */

// Cluster store - central state management
export {
  // State
  clusterState,
  isLoading,
  lastError,
  // Computed
  nodesList,
  healthyNodes,
  unhealthyNodes,
  schedulableNodes,
  nodeJsNodes,
  browserNodes,
  podsList,
  runningPods,
  pendingPods,
  failedPods,
  packsList,
  namespacesList,
  clusterStats,
  clusterHealth,
  // Actions
  initializeCluster,
  resetCluster,
  resetClusterState,
  updateClusterConfig,
  setLoading,
  setError,
  clearError,
  // Getters
  getNode,
  getPod,
  getPack,
  getNamespace,
  getPodsOnNode,
  getPodsInNamespace,
  getPodsForPack,
  getPriorityClass,
  isClusterHealthy,
  // Types
  type ClusterState,
} from './cluster-store';

// Node store - node registry management
export {
  // Computed
  nodeCount,
  onlineNodeCount,
  nodesByRuntime,
  nodesByStatus,
  // Actions
  addNode,
  updateNode,
  removeNode,
  setNodeStatus,
  processHeartbeat,
  markNodeUnhealthy,
  markNodeOffline,
  drainNode,
  setNodeMaintenance,
  uncordonNode,
  setNodeLabels,
  addNodeLabel,
  removeNodeLabel,
  setNodeTaints,
  addNodeTaint,
  removeNodeTaint,
  allocateResources,
  releaseResources,
  // Queries
  findNodeByName,
  findNodesBySelector,
  findNodesByRuntime,
  getSchedulableNodesForRuntime,
  hasAvailableNodes,
  getStaleNodes,
} from './node-store';

// Pod store - pod lifecycle management
export {
  // Computed
  podCount,
  runningPodCount,
  pendingPodCount,
  podsByStatus,
  podsByNamespace,
  podsByNode,
  // Actions
  createPod,
  updatePod,
  removePod,
  schedulePod,
  startPod,
  setPodRunning,
  stopPod,
  setPodStopped,
  setPodFailed,
  evictPod,
  setPodStatus,
  setPodLabels,
  addPodLabel,
  removePodLabel,
  // History
  addHistoryEntry,
  getPodHistory,
  clearPodHistory,
  // Queries
  findPodsBySelector,
  findPodsByPack,
  findPodsByNode,
  findPodsByNamespace,
  findPodsByStatus,
  getPendingPodsByPriority,
  getEvictablePodsOnNode,
  canNodeAcceptPods,
  countActivePodsInNamespace,
} from './pod-store';

// Pack store - pack registry management
export {
  // Computed
  packCount,
  uniquePackNames,
  uniquePackCount,
  packsByName,
  packsByRuntime,
  packsByOwner,
  // Actions
  registerPack,
  updatePack,
  removePack,
  removePackByName,
  // Queries
  findPackById,
  findPackByNameVersion,
  findPackVersions,
  getPackVersionSummaries,
  getLatestPackVersion,
  findPacksByOwner,
  findPacksByRuntime,
  findPacksCompatibleWith,
  searchPacksByName,
  packVersionExists,
  packExists,
  // Helpers
  isValidVersion,
  getNextPatchVersion,
  getNextMinorVersion,
  getNextMajorVersion,
} from './pack-store';

// Secret store - secret lifecycle management
export {
  // Computed
  secretCount,
  secretsList,
  secretsByNamespace,
  secretsByType,
  // Actions
  addSecret,
  updateSecret,
  removeSecret,
  removeSecretByName,
  // Queries
  findSecretById,
  findSecretByName,
  findSecretsByNamespace,
  findSecretsByType,
  secretExists,
  resolveSecretNames,
  getSecretListItems,
  toSecretListItem,
  // Reset
  resetSecretStore,
} from './secret-store';
