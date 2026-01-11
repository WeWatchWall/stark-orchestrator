/**
 * Unit tests for reactive stores
 * @module @stark-o/core/tests/unit/stores
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isRef, isReactive } from '@vue/reactivity';

import {
  // Cluster store
  clusterState,
  isLoading,
  lastError,
  nodesList,
  healthyNodes,
  unhealthyNodes,
  schedulableNodes,
  podsList,
  runningPods,
  pendingPods,
  packsList,
  clusterStats,
  initializeCluster,
  resetCluster,
  updateClusterConfig,
  setLoading,
  setError,
  clearError,
  getNode,
  getPod,
  getPack,
  getPodsOnNode,
  isClusterHealthy,

  // Node store
  nodeCount,
  onlineNodeCount,
  nodesByRuntime,
  addNode,
  updateNode,
  removeNode,
  setNodeStatus,
  processHeartbeat,
  markNodeUnhealthy,
  drainNode,
  uncordonNode,
  setNodeLabels,
  addNodeTaint,
  removeNodeTaint,
  allocateResources,
  releaseResources,
  findNodeByName,
  findNodesByRuntime,
  getSchedulableNodesForRuntime,
  hasAvailableNodes,
  getStaleNodes,

  // Pod store
  podCount,
  runningPodCount,
  pendingPodCount,
  podsByStatus,
  podsByNode,
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
  addPodLabel,
  getPodHistory,
  findPodsByPack,
  findPodsByNode,
  findPodsByNamespace,
  getPendingPodsByPriority,
  getEvictablePodsOnNode,
  canNodeAcceptPods,

  // Pack store
  packCount,
  uniquePackNames,
  uniquePackCount,
  packsByName,
  registerPack,
  updatePack,
  removePack,
  removePackByName,
  findPackById,
  findPackByNameVersion,
  findPackVersions,
  getLatestPackVersion,
  findPacksByOwner,
  findPacksCompatibleWith,
  searchPacksByName,
  packVersionExists,
  packExists,
  isValidVersion,
  getNextPatchVersion,
  getNextMinorVersion,
  getNextMajorVersion,
} from '../../src';

describe('Cluster Store', () => {
  beforeEach(() => {
    resetCluster();
  });

  describe('State initialization', () => {
    it('should have reactive cluster state', () => {
      expect(isReactive(clusterState)).toBe(true);
    });

    it('should have ref for isLoading', () => {
      expect(isRef(isLoading)).toBe(true);
    });

    it('should have ref for lastError', () => {
      expect(isRef(lastError)).toBe(true);
    });

    it('should start with empty collections', () => {
      expect(clusterState.nodes.size).toBe(0);
      expect(clusterState.pods.size).toBe(0);
      expect(clusterState.packs.size).toBe(0);
      expect(clusterState.namespaces.size).toBe(0);
    });

    it('should start uninitialized', () => {
      expect(clusterState.initialized).toBe(false);
    });
  });

  describe('initializeCluster', () => {
    it('should mark cluster as initialized', () => {
      initializeCluster();
      expect(clusterState.initialized).toBe(true);
    });

    it('should update config with provided values', () => {
      initializeCluster({ maxPodsPerNode: 50 });
      expect(clusterState.config.maxPodsPerNode).toBe(50);
    });

    it('should set lastSyncAt', () => {
      initializeCluster();
      expect(clusterState.lastSyncAt).toBeInstanceOf(Date);
    });
  });

  describe('resetCluster', () => {
    it('should clear all collections', () => {
      addNode({ name: 'node1', runtimeType: 'node' });
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });

      resetCluster();

      expect(clusterState.nodes.size).toBe(0);
      expect(clusterState.pods.size).toBe(0);
      expect(clusterState.initialized).toBe(false);
    });
  });

  describe('updateClusterConfig', () => {
    it('should update specific config values', () => {
      updateClusterConfig({ heartbeatIntervalMs: 10000 });
      expect(clusterState.config.heartbeatIntervalMs).toBe(10000);
    });

    it('should update updatedAt timestamp', () => {
      const before = clusterState.config.updatedAt;
      updateClusterConfig({ maxPodsPerNode: 100 });
      expect(clusterState.config.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('Loading and error state', () => {
    it('should set loading state', () => {
      setLoading(true);
      expect(isLoading.value).toBe(true);

      setLoading(false);
      expect(isLoading.value).toBe(false);
    });

    it('should set error state', () => {
      const error = new Error('Test error');
      setError(error);
      expect(lastError.value).toBe(error);
    });

    it('should clear error state', () => {
      setError(new Error('Test'));
      clearError();
      expect(lastError.value).toBeNull();
    });
  });

  describe('Computed properties', () => {
    beforeEach(() => {
      addNode({ name: 'node1', runtimeType: 'node' });
      addNode({ name: 'node2', runtimeType: 'browser' });
      setNodeStatus(findNodeByName('node2')!.id, 'unhealthy');
    });

    it('should compute nodesList', () => {
      expect(nodesList.value).toHaveLength(2);
    });

    it('should compute healthyNodes', () => {
      expect(healthyNodes.value).toHaveLength(1);
      expect(healthyNodes.value[0].name).toBe('node1');
    });

    it('should compute unhealthyNodes', () => {
      expect(unhealthyNodes.value).toHaveLength(1);
      expect(unhealthyNodes.value[0].name).toBe('node2');
    });

    it('should compute schedulableNodes', () => {
      expect(schedulableNodes.value).toHaveLength(1);
    });
  });

  describe('Cluster statistics', () => {
    it('should compute correct stats', () => {
      addNode({ name: 'node1', runtimeType: 'node' });
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });

      const stats = clusterStats.value;
      expect(stats.totalNodes).toBe(1);
      expect(stats.healthyNodes).toBe(1);
      expect(stats.totalPods).toBe(1);
      expect(stats.pendingPods).toBe(1);
    });
  });

  describe('Getters', () => {
    it('should get node by id', () => {
      const node = addNode({ name: 'test-node', runtimeType: 'node' });
      expect(getNode(node.id)?.name).toBe('test-node');
    });

    it('should get pod by id', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      expect(getPod(pod.id)?.packId).toBe('pack1');
    });

    it('should get pack by id', () => {
      const pack = registerPack({
        name: 'test-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: '/packs/test.js',
      });
      expect(getPack(pack.id)?.name).toBe('test-pack');
    });

    it('should get pods on node', () => {
      const node = addNode({ name: 'node1', runtimeType: 'node' });
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      schedulePod(pod.id, node.id);

      const pods = getPodsOnNode(node.id);
      expect(pods).toHaveLength(1);
    });
  });
});

describe('Node Store', () => {
  beforeEach(() => {
    resetCluster();
  });

  describe('addNode', () => {
    it('should add a new node with generated id', () => {
      const node = addNode({ name: 'test-node', runtimeType: 'node' });

      expect(node.id).toBeDefined();
      expect(node.name).toBe('test-node');
      expect(node.runtimeType).toBe('node');
      expect(node.status).toBe('online');
    });

    it('should add node with custom id', () => {
      const node = addNode({ id: 'custom-id', name: 'test', runtimeType: 'browser' });
      expect(node.id).toBe('custom-id');
    });

    it('should add node to cluster state', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      expect(clusterState.nodes.has(node.id)).toBe(true);
    });

    it('should set default resources', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      expect(node.allocatable.cpu).toBeGreaterThan(0);
      expect(node.allocated.cpu).toBe(0);
    });
  });

  describe('updateNode', () => {
    it('should update node properties', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      const updated = updateNode(node.id, { status: 'draining' });

      expect(updated?.status).toBe('draining');
    });

    it('should return undefined for non-existent node', () => {
      const result = updateNode('non-existent', { status: 'offline' });
      expect(result).toBeUndefined();
    });

    it('should merge allocatable resources', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      updateNode(node.id, { allocatable: { cpu: 2000 } });

      expect(getNode(node.id)?.allocatable.cpu).toBe(2000);
      expect(getNode(node.id)?.allocatable.memory).toBeGreaterThan(0);
    });
  });

  describe('removeNode', () => {
    it('should remove node from store', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      const result = removeNode(node.id);

      expect(result).toBe(true);
      expect(clusterState.nodes.has(node.id)).toBe(false);
    });

    it('should return false for non-existent node', () => {
      expect(removeNode('non-existent')).toBe(false);
    });
  });

  describe('Node status management', () => {
    it('should update node status', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      setNodeStatus(node.id, 'unhealthy');

      expect(getNode(node.id)?.status).toBe('unhealthy');
    });

    it('should process heartbeat', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      setNodeStatus(node.id, 'unhealthy');

      processHeartbeat(node.id);

      expect(getNode(node.id)?.status).toBe('online');
      expect(getNode(node.id)?.lastHeartbeat).toBeInstanceOf(Date);
    });

    it('should mark node unhealthy', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      markNodeUnhealthy(node.id);

      expect(getNode(node.id)?.status).toBe('unhealthy');
    });

    it('should drain node', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      drainNode(node.id);

      const updated = getNode(node.id);
      expect(updated?.status).toBe('draining');
      expect(updated?.unschedulable).toBe(true);
    });

    it('should uncordon node', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      drainNode(node.id);
      uncordonNode(node.id);

      const updated = getNode(node.id);
      expect(updated?.status).toBe('online');
      expect(updated?.unschedulable).toBe(false);
    });
  });

  describe('Labels and taints', () => {
    it('should set node labels', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      setNodeLabels(node.id, { env: 'production' });

      expect(getNode(node.id)?.labels.env).toBe('production');
    });

    it('should add node taint', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      addNodeTaint(node.id, { key: 'special', value: 'true', effect: 'NoSchedule' });

      expect(getNode(node.id)?.taints).toHaveLength(1);
    });

    it('should not duplicate taints', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      const taint = { key: 'special', value: 'true', effect: 'NoSchedule' as const };

      addNodeTaint(node.id, taint);
      addNodeTaint(node.id, taint);

      expect(getNode(node.id)?.taints).toHaveLength(1);
    });

    it('should remove node taint', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      addNodeTaint(node.id, { key: 'special', value: 'true', effect: 'NoSchedule' });
      removeNodeTaint(node.id, 'special');

      expect(getNode(node.id)?.taints).toHaveLength(0);
    });
  });

  describe('Resource management', () => {
    it('should allocate resources', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      allocateResources(node.id, 100, 256);

      const updated = getNode(node.id);
      expect(updated?.allocated.cpu).toBe(100);
      expect(updated?.allocated.memory).toBe(256);
      expect(updated?.allocated.pods).toBe(1);
    });

    it('should release resources', () => {
      const node = addNode({ name: 'test', runtimeType: 'node' });
      allocateResources(node.id, 100, 256);
      releaseResources(node.id, 100, 256);

      const updated = getNode(node.id);
      expect(updated?.allocated.cpu).toBe(0);
      expect(updated?.allocated.memory).toBe(0);
      expect(updated?.allocated.pods).toBe(0);
    });
  });

  describe('Computed properties', () => {
    it('should compute node count', () => {
      addNode({ name: 'node1', runtimeType: 'node' });
      addNode({ name: 'node2', runtimeType: 'browser' });

      expect(nodeCount.value).toBe(2);
    });

    it('should compute online node count', () => {
      addNode({ name: 'node1', runtimeType: 'node' });
      const node2 = addNode({ name: 'node2', runtimeType: 'browser' });
      setNodeStatus(node2.id, 'offline');

      expect(onlineNodeCount.value).toBe(1);
    });

    it('should group nodes by runtime', () => {
      addNode({ name: 'node1', runtimeType: 'node' });
      addNode({ name: 'node2', runtimeType: 'browser' });
      addNode({ name: 'node3', runtimeType: 'node' });

      const byRuntime = nodesByRuntime.value;
      expect(byRuntime.get('node')?.length).toBe(2);
      expect(byRuntime.get('browser')?.length).toBe(1);
    });
  });

  describe('Queries', () => {
    it('should find node by name', () => {
      addNode({ name: 'test-node', runtimeType: 'node' });
      const found = findNodeByName('test-node');

      expect(found?.name).toBe('test-node');
    });

    it('should find nodes by runtime', () => {
      addNode({ name: 'node1', runtimeType: 'node' });
      addNode({ name: 'browser1', runtimeType: 'browser' });

      const nodes = findNodesByRuntime('node');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].runtimeType).toBe('node');
    });

    it('should get schedulable nodes for runtime', () => {
      const node1 = addNode({ name: 'node1', runtimeType: 'node' });
      const node2 = addNode({ name: 'node2', runtimeType: 'node' });
      drainNode(node2.id);

      const schedulable = getSchedulableNodesForRuntime('node');
      expect(schedulable).toHaveLength(1);
      expect(schedulable[0].id).toBe(node1.id);
    });

    it('should check if nodes are available', () => {
      expect(hasAvailableNodes()).toBe(false);

      addNode({ name: 'node1', runtimeType: 'node' });
      expect(hasAvailableNodes()).toBe(true);
    });

    it('should get stale nodes', () => {
      const node = addNode({ name: 'node1', runtimeType: 'node' });
      // Set heartbeat to 1 hour ago
      const hourAgo = new Date(Date.now() - 3600000);
      updateNode(node.id, {});
      clusterState.nodes.get(node.id)!.lastHeartbeat = hourAgo;

      const stale = getStaleNodes(30000); // 30 second threshold
      expect(stale).toHaveLength(1);
    });
  });
});

describe('Pod Store', () => {
  beforeEach(() => {
    resetCluster();
  });

  describe('createPod', () => {
    it('should create a pod with generated id', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });

      expect(pod.id).toBeDefined();
      expect(pod.packId).toBe('pack1');
      expect(pod.status).toBe('pending');
      expect(pod.nodeId).toBeNull();
    });

    it('should create pod with default namespace', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      expect(pod.namespace).toBe(clusterState.config.defaultNamespace);
    });

    it('should create pod with custom namespace', () => {
      const pod = createPod({
        packId: 'pack1',
        packVersion: '1.0.0',
        createdBy: 'user1',
        namespace: 'production',
      });
      expect(pod.namespace).toBe('production');
    });

    it('should add history entry on creation', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      const history = getPodHistory(pod.id);

      expect(history).toHaveLength(1);
      expect(history[0].action).toBe('created');
    });
  });

  describe('Pod lifecycle', () => {
    it('should schedule pod to node', () => {
      const node = addNode({ name: 'node1', runtimeType: 'node' });
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });

      schedulePod(pod.id, node.id);

      const updated = getPod(pod.id);
      expect(updated?.nodeId).toBe(node.id);
      expect(updated?.status).toBe('scheduled');
      expect(updated?.scheduledAt).toBeInstanceOf(Date);
    });

    it('should start pod', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      startPod(pod.id);

      expect(getPod(pod.id)?.status).toBe('starting');
    });

    it('should set pod running', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      setPodRunning(pod.id);

      const updated = getPod(pod.id);
      expect(updated?.status).toBe('running');
      expect(updated?.startedAt).toBeInstanceOf(Date);
    });

    it('should stop pod', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      setPodRunning(pod.id);
      stopPod(pod.id);

      expect(getPod(pod.id)?.status).toBe('stopping');
    });

    it('should set pod stopped', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      setPodStopped(pod.id);

      const updated = getPod(pod.id);
      expect(updated?.status).toBe('stopped');
      expect(updated?.stoppedAt).toBeInstanceOf(Date);
    });

    it('should set pod failed with message', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      setPodFailed(pod.id, 'Out of memory');

      const updated = getPod(pod.id);
      expect(updated?.status).toBe('failed');
      expect(updated?.statusMessage).toBe('Out of memory');
    });

    it('should evict pod', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      evictPod(pod.id, 'Resource pressure');

      const updated = getPod(pod.id);
      expect(updated?.status).toBe('evicted');
      expect(updated?.statusMessage).toBe('Resource pressure');
    });
  });

  describe('updatePod', () => {
    it('should update pod properties', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      updatePod(pod.id, { priority: 100 });

      expect(getPod(pod.id)?.priority).toBe(100);
    });

    it('should merge resource requirements', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      updatePod(pod.id, { resourceRequests: { cpu: 500 } });

      const updated = getPod(pod.id);
      expect(updated?.resourceRequests.cpu).toBe(500);
      expect(updated?.resourceRequests.memory).toBeGreaterThan(0);
    });
  });

  describe('removePod', () => {
    it('should remove pod from store', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      const result = removePod(pod.id);

      expect(result).toBe(true);
      expect(clusterState.pods.has(pod.id)).toBe(false);
    });
  });

  describe('Labels', () => {
    it('should add pod label', () => {
      const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      addPodLabel(pod.id, 'env', 'production');

      expect(getPod(pod.id)?.labels.env).toBe('production');
    });
  });

  describe('Computed properties', () => {
    it('should compute pod counts', () => {
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      const pod2 = createPod({ packId: 'pack2', packVersion: '1.0.0', createdBy: 'user1' });
      setPodRunning(pod2.id);

      expect(podCount.value).toBe(2);
      expect(pendingPodCount.value).toBe(1);
      expect(runningPodCount.value).toBe(1);
    });

    it('should group pods by status', () => {
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      const pod2 = createPod({ packId: 'pack2', packVersion: '1.0.0', createdBy: 'user1' });
      setPodRunning(pod2.id);

      const byStatus = podsByStatus.value;
      expect(byStatus.get('pending')?.length).toBe(1);
      expect(byStatus.get('running')?.length).toBe(1);
    });

    it('should group pods by node', () => {
      const node = addNode({ name: 'node1', runtimeType: 'node' });
      const pod1 = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      const pod2 = createPod({ packId: 'pack2', packVersion: '1.0.0', createdBy: 'user1' });

      schedulePod(pod1.id, node.id);
      schedulePod(pod2.id, node.id);

      const byNode = podsByNode.value;
      expect(byNode.get(node.id)?.length).toBe(2);
    });
  });

  describe('Queries', () => {
    it('should find pods by pack', () => {
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      createPod({ packId: 'pack2', packVersion: '1.0.0', createdBy: 'user1' });

      const pods = findPodsByPack('pack1');
      expect(pods).toHaveLength(2);
    });

    it('should find pods by node', () => {
      const node = addNode({ name: 'node1', runtimeType: 'node' });
      const pod1 = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
      schedulePod(pod1.id, node.id);

      const pods = findPodsByNode(node.id);
      expect(pods).toHaveLength(1);
    });

    it('should find pods by namespace', () => {
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1', namespace: 'prod' });
      createPod({ packId: 'pack2', packVersion: '1.0.0', createdBy: 'user1', namespace: 'dev' });

      const pods = findPodsByNamespace('prod');
      expect(pods).toHaveLength(1);
    });

    it('should get pending pods by priority', () => {
      createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1', priority: 10 });
      createPod({ packId: 'pack2', packVersion: '1.0.0', createdBy: 'user1', priority: 100 });
      createPod({ packId: 'pack3', packVersion: '1.0.0', createdBy: 'user1', priority: 50 });

      const pending = getPendingPodsByPriority();
      expect(pending[0].priority).toBe(100);
      expect(pending[1].priority).toBe(50);
      expect(pending[2].priority).toBe(10);
    });

    it('should get evictable pods on node', () => {
      const node = addNode({ name: 'node1', runtimeType: 'node' });
      const pod1 = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1', priority: 100 });
      const pod2 = createPod({ packId: 'pack2', packVersion: '1.0.0', createdBy: 'user1', priority: 10 });

      schedulePod(pod1.id, node.id);
      schedulePod(pod2.id, node.id);
      setPodRunning(pod1.id);
      setPodRunning(pod2.id);

      const evictable = getEvictablePodsOnNode(node.id);
      expect(evictable[0].priority).toBe(10); // Lowest priority first
    });

    it('should check if node can accept pods', () => {
      const node = addNode({ name: 'node1', runtimeType: 'node' });
      expect(canNodeAcceptPods(node.id)).toBe(true);

      // Create pods up to limit
      for (let i = 0; i < clusterState.config.maxPodsPerNode; i++) {
        const pod = createPod({ packId: 'pack1', packVersion: '1.0.0', createdBy: 'user1' });
        schedulePod(pod.id, node.id);
      }

      expect(canNodeAcceptPods(node.id)).toBe(false);
    });
  });
});

describe('Pack Store', () => {
  beforeEach(() => {
    resetCluster();
  });

  describe('registerPack', () => {
    it('should register a new pack', () => {
      const pack = registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: '/packs/my-pack-1.0.0.js',
      });

      expect(pack.id).toBeDefined();
      expect(pack.name).toBe('my-pack');
      expect(pack.version).toBe('1.0.0');
      expect(pack.runtimeTag).toBe('node');
    });

    it('should add pack to cluster state', () => {
      const pack = registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'browser',
        ownerId: 'user1',
        bundlePath: '/packs/my-pack.js',
      });

      expect(clusterState.packs.has(pack.id)).toBe(true);
    });
  });

  describe('updatePack', () => {
    it('should update pack properties', () => {
      const pack = registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: '/packs/test.js',
      });

      updatePack(pack.id, { description: 'Updated description' });

      expect(getPack(pack.id)?.description).toBe('Updated description');
    });

    it('should merge metadata', () => {
      const pack = registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: '/packs/test.js',
        metadata: { entrypoint: 'main' },
      });

      updatePack(pack.id, { metadata: { timeout: 5000 } });

      const updated = getPack(pack.id);
      expect(updated?.metadata.entrypoint).toBe('main');
      expect(updated?.metadata.timeout).toBe(5000);
    });
  });

  describe('removePack', () => {
    it('should remove pack from store', () => {
      const pack = registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: '/packs/test.js',
      });

      const result = removePack(pack.id);

      expect(result).toBe(true);
      expect(clusterState.packs.has(pack.id)).toBe(false);
    });
  });

  describe('removePackByName', () => {
    it('should remove all versions of a pack', () => {
      registerPack({ name: 'my-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/p1.js' });
      registerPack({ name: 'my-pack', version: '1.1.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/p2.js' });
      registerPack({ name: 'other-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/p3.js' });

      const count = removePackByName('my-pack');

      expect(count).toBe(2);
      expect(packExists('my-pack')).toBe(false);
      expect(packExists('other-pack')).toBe(true);
    });
  });

  describe('Computed properties', () => {
    beforeEach(() => {
      registerPack({ name: 'pack-a', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/a1.js' });
      registerPack({ name: 'pack-a', version: '2.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/a2.js' });
      registerPack({ name: 'pack-b', version: '1.0.0', runtimeTag: 'browser', ownerId: 'user2', bundlePath: '/b1.js' });
    });

    it('should compute pack count', () => {
      expect(packCount.value).toBe(3);
    });

    it('should compute unique pack names', () => {
      expect(uniquePackNames.value.size).toBe(2);
      expect(uniquePackNames.value.has('pack-a')).toBe(true);
      expect(uniquePackNames.value.has('pack-b')).toBe(true);
    });

    it('should compute unique pack count', () => {
      expect(uniquePackCount.value).toBe(2);
    });

    it('should group packs by name sorted by version', () => {
      const byName = packsByName.value;
      const packA = byName.get('pack-a');

      expect(packA).toHaveLength(2);
      expect(packA![0].version).toBe('2.0.0'); // Newest first
      expect(packA![1].version).toBe('1.0.0');
    });
  });

  describe('Queries', () => {
    it('should find pack by id', () => {
      const pack = registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: '/test.js',
      });

      expect(findPackById(pack.id)?.name).toBe('my-pack');
    });

    it('should find pack by name and version', () => {
      registerPack({ name: 'my-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/v1.js' });
      registerPack({ name: 'my-pack', version: '2.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/v2.js' });

      const pack = findPackByNameVersion('my-pack', '1.0.0');
      expect(pack?.version).toBe('1.0.0');
    });

    it('should find all versions of a pack', () => {
      registerPack({ name: 'my-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/v1.js' });
      registerPack({ name: 'my-pack', version: '2.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/v2.js' });
      registerPack({ name: 'my-pack', version: '1.5.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/v15.js' });

      const versions = findPackVersions('my-pack');
      expect(versions).toHaveLength(3);
      expect(versions[0].version).toBe('2.0.0');
      expect(versions[1].version).toBe('1.5.0');
      expect(versions[2].version).toBe('1.0.0');
    });

    it('should get latest pack version', () => {
      registerPack({ name: 'my-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/v1.js' });
      registerPack({ name: 'my-pack', version: '2.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/v2.js' });

      const latest = getLatestPackVersion('my-pack');
      expect(latest?.version).toBe('2.0.0');
    });

    it('should find packs by owner', () => {
      registerPack({ name: 'pack1', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/p1.js' });
      registerPack({ name: 'pack2', version: '1.0.0', runtimeTag: 'node', ownerId: 'user2', bundlePath: '/p2.js' });

      const packs = findPacksByOwner('user1');
      expect(packs).toHaveLength(1);
      expect(packs[0].ownerId).toBe('user1');
    });

    it('should find packs compatible with runtime', () => {
      registerPack({ name: 'node-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/n.js' });
      registerPack({ name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser', ownerId: 'user1', bundlePath: '/b.js' });
      registerPack({ name: 'universal-pack', version: '1.0.0', runtimeTag: 'universal', ownerId: 'user1', bundlePath: '/u.js' });

      const nodeCompatible = findPacksCompatibleWith('node');
      expect(nodeCompatible).toHaveLength(2);

      const browserCompatible = findPacksCompatibleWith('browser');
      expect(browserCompatible).toHaveLength(2);
    });

    it('should search packs by name', () => {
      registerPack({ name: 'my-awesome-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/a.js' });
      registerPack({ name: 'another-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/b.js' });

      const results = searchPacksByName('awesome');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('my-awesome-pack');
    });

    it('should check if pack version exists', () => {
      registerPack({ name: 'my-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/p.js' });

      expect(packVersionExists('my-pack', '1.0.0')).toBe(true);
      expect(packVersionExists('my-pack', '2.0.0')).toBe(false);
    });

    it('should check if pack exists', () => {
      registerPack({ name: 'my-pack', version: '1.0.0', runtimeTag: 'node', ownerId: 'user1', bundlePath: '/p.js' });

      expect(packExists('my-pack')).toBe(true);
      expect(packExists('non-existent')).toBe(false);
    });
  });

  describe('Version helpers', () => {
    it('should validate semantic version', () => {
      expect(isValidVersion('1.0.0')).toBe(true);
      expect(isValidVersion('0.0.1')).toBe(true);
      expect(isValidVersion('1.0.0-alpha')).toBe(true);
      expect(isValidVersion('1.0.0-beta.1')).toBe(true);
      expect(isValidVersion('invalid')).toBe(false);
      expect(isValidVersion('1.0')).toBe(false);
    });

    it('should get next patch version', () => {
      expect(getNextPatchVersion('1.0.0')).toBe('1.0.1');
      expect(getNextPatchVersion('1.0.9')).toBe('1.0.10');
    });

    it('should get next minor version', () => {
      expect(getNextMinorVersion('1.0.0')).toBe('1.1.0');
      expect(getNextMinorVersion('1.9.5')).toBe('1.10.0');
    });

    it('should get next major version', () => {
      expect(getNextMajorVersion('1.0.0')).toBe('2.0.0');
      expect(getNextMajorVersion('9.5.3')).toBe('10.0.0');
    });
  });
});
