/**
 * Unit tests for PodScheduler service
 * @module @stark-o/core/tests/unit/pod-scheduler
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  PodScheduler,
  createPodScheduler,
  PodSchedulerErrorCodes,
  resetCluster,
  registerPack,
  addNode,
  findPackById,
  clusterState,
  initializeCluster,
  createNamespaceManager,
} from '../../src';

describe('PodScheduler', () => {
  let scheduler: PodScheduler;

  beforeEach(() => {
    resetCluster();
    initializeCluster();
    scheduler = createPodScheduler();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const sched = new PodScheduler();
      expect(sched).toBeInstanceOf(PodScheduler);
      expect(sched.maxRetries).toBe(3);
    });

    it('should accept custom options', () => {
      const sched = createPodScheduler({
        maxRetries: 5,
        defaultPriority: 100,
        enablePreemption: true,
        schedulingPolicy: 'binpack',
      });

      expect(sched.maxRetries).toBe(5);
    });
  });

  describe('computed properties', () => {
    beforeEach(() => {
      // Register a pack first
      registerPack({
        name: 'test-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: 'packs/test-pack/1.0.0/bundle.js',
      });

      // Add a compatible node
      addNode({
        name: 'node-1',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const pack = [...clusterState.packs.values()][0];

      // Create and schedule some pods
      scheduler.create({ packId: pack.id, packVersion: '1.0.0' }, 'user1');
      scheduler.create({ packId: pack.id, packVersion: '1.0.0' }, 'user1');

      // Schedule one pod
      const pendingPods = scheduler.findByStatus('pending');
      if (pendingPods.length > 0) {
        scheduler.schedule(pendingPods[0].id);
      }
    });

    it('should return total pods count', () => {
      expect(scheduler.totalPods.value).toBe(2);
    });

    it('should return pending pods count', () => {
      expect(scheduler.pendingPods.value).toBeGreaterThanOrEqual(1);
    });

    it('should group pods by status', () => {
      const byStatus = scheduler.byStatus.value;
      expect(byStatus).toBeInstanceOf(Map);
    });

    it('should group pods by namespace', () => {
      const byNamespace = scheduler.byNamespace.value;
      expect(byNamespace.get('default')).toBeDefined();
    });
  });

  describe('create', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/my-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;
    });

    it('should create a new pod successfully', () => {
      const result = scheduler.create(
        { packId, packVersion: '1.0.0' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod).toBeDefined();
      expect(result.data?.pod.packId).toBe(packId);
      expect(result.data?.pod.packVersion).toBe('1.0.0');
      expect(result.data?.pod.status).toBe('pending');
    });

    it('should create pod in default namespace', () => {
      const result = scheduler.create(
        { packId, packVersion: '1.0.0' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod.namespace).toBe('default');
    });

    it('should create pod in custom namespace', () => {
      // Create the production namespace first
      const namespaceManager = createNamespaceManager();
      namespaceManager.create({ name: 'production' }, 'user1');

      const result = scheduler.create(
        { packId, packVersion: '1.0.0', namespace: 'production' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod.namespace).toBe('production');
    });

    it('should default to pack version if not provided', () => {
      const result = scheduler.create(
        { packId },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod.packVersion).toBe('1.0.0');
    });

    it('should fail with non-existent pack', () => {
      // Use a valid UUID format (version 4, variant 1) to pass validation but reference non-existent pack
      const result = scheduler.create(
        { packId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', packVersion: '1.0.0' },
        'user1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.PACK_NOT_FOUND);
    });

    it('should fail with invalid input', () => {
      const result = scheduler.create(
        { packId: '' },
        'user1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.VALIDATION_ERROR);
    });

    it('should set resource requests', () => {
      const result = scheduler.create(
        {
          packId,
          packVersion: '1.0.0',
          resourceRequests: { cpu: 200, memory: 256 },
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod.resourceRequests.cpu).toBe(200);
      expect(result.data?.pod.resourceRequests.memory).toBe(256);
    });

    it('should set labels', () => {
      const result = scheduler.create(
        {
          packId,
          packVersion: '1.0.0',
          labels: { app: 'test', env: 'dev' },
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod.labels.app).toBe('test');
      expect(result.data?.pod.labels.env).toBe('dev');
    });

    it('should set tolerations', () => {
      const result = scheduler.create(
        {
          packId,
          packVersion: '1.0.0',
          tolerations: [
            { key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' },
          ],
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod.tolerations.length).toBe(1);
      expect(result.data?.pod.tolerations[0].key).toBe('dedicated');
    });
  });

  describe('schedule', () => {
    let packId: string;
    let podId: string;

    beforeEach(() => {
      // Create a pack
      registerPack({
        name: 'schedulable-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/schedulable-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      // Add a compatible node
      addNode({
        name: 'node-1',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      // Create a pending pod
      const result = scheduler.create({ packId }, 'user1');
      podId = result.data!.pod.id;
    });

    it('should schedule pod to compatible node', () => {
      const result = scheduler.schedule(podId);

      expect(result.success).toBe(true);
      expect(result.data?.scheduled).toBe(true);
      expect(result.data?.nodeId).toBeDefined();
    });

    it('should update pod status to scheduled', () => {
      scheduler.schedule(podId);

      const pod = scheduler.get(podId);
      expect(pod?.status).toBe('scheduled');
      expect(pod?.nodeId).toBeDefined();
    });

    it('should allocate resources on node', () => {
      const nodesBefore = [...clusterState.nodes.values()][0];
      const allocatedBefore = nodesBefore.allocated.cpu;

      scheduler.schedule(podId);

      const nodesAfter = [...clusterState.nodes.values()][0];
      expect(nodesAfter.allocated.cpu).toBeGreaterThan(allocatedBefore);
    });

    it('should fail when pod not found', () => {
      const result = scheduler.schedule('nonexistent-pod');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.POD_NOT_FOUND);
    });

    it('should fail when pod is not pending', () => {
      scheduler.schedule(podId);

      const result = scheduler.schedule(podId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION);
    });

    it('should fail when no compatible nodes available', () => {
      // Create a browser-only pack
      registerPack({
        name: 'browser-pack',
        version: '1.0.0',
        runtimeTag: 'browser',
        ownerId: 'owner1',
        bundlePath: 'packs/browser-pack/1.0.0/bundle.js',
      });
      const browserPack = [...clusterState.packs.values()].find(p => p.name === 'browser-pack')!;

      const createResult = scheduler.create({ packId: browserPack.id }, 'user1');
      const browserPodId = createResult.data!.pod.id;

      const result = scheduler.schedule(browserPodId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });
  });

  describe('createAndSchedule', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'quick-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/quick-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      addNode({
        name: 'quick-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });
    });

    it('should create and schedule pod in one operation', () => {
      const result = scheduler.createAndSchedule(
        { packId, packVersion: '1.0.0' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod).toBeDefined();
      expect(result.data?.scheduling.scheduled).toBe(true);
    });

    it('should return scheduling result even if scheduling fails', () => {
      // Create a browser pack with no compatible nodes
      registerPack({
        name: 'browser-only',
        version: '1.0.0',
        runtimeTag: 'browser',
        ownerId: 'owner1',
        bundlePath: 'packs/browser-only/1.0.0/bundle.js',
      });
      const browserPack = [...clusterState.packs.values()].find(p => p.name === 'browser-only')!;

      const result = scheduler.createAndSchedule(
        { packId: browserPack.id },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pod).toBeDefined();
      expect(result.data?.scheduling.scheduled).toBe(false);
    });
  });

  describe('checkRuntimeCompatibility', () => {
    it('should return true for node pack on node runtime', () => {
      expect(scheduler.checkRuntimeCompatibility('node', 'node')).toBe(true);
    });

    it('should return true for browser pack on browser runtime', () => {
      expect(scheduler.checkRuntimeCompatibility('browser', 'browser')).toBe(true);
    });

    it('should return true for universal pack on any runtime', () => {
      expect(scheduler.checkRuntimeCompatibility('universal', 'node')).toBe(true);
      expect(scheduler.checkRuntimeCompatibility('universal', 'browser')).toBe(true);
    });

    it('should return false for node pack on browser runtime', () => {
      expect(scheduler.checkRuntimeCompatibility('node', 'browser')).toBe(false);
    });

    it('should return false for browser pack on node runtime', () => {
      expect(scheduler.checkRuntimeCompatibility('browser', 'node')).toBe(false);
    });
  });

  describe('scheduleAll', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'bulk-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/bulk-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      addNode({
        name: 'bulk-node',
        runtimeType: 'node',
        allocatable: { cpu: 5000, memory: 5120, pods: 50 },
      });

      // Create multiple pending pods
      scheduler.create({ packId }, 'user1');
      scheduler.create({ packId }, 'user1');
      scheduler.create({ packId }, 'user1');
    });

    it('should schedule all pending pods', () => {
      const results = scheduler.scheduleAll();

      expect(results.length).toBe(3);
      expect(results.filter(r => r.scheduled).length).toBe(3);
    });

    it('should return results for each pod', () => {
      const results = scheduler.scheduleAll();

      for (const result of results) {
        expect(result.podId).toBeDefined();
        expect(result.nodeId).toBeDefined();
      }
    });
  });

  describe('lifecycle: start', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'lifecycle-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/lifecycle-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'lifecycle-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const createResult = scheduler.create({ packId: pack.id }, 'user1');
      podId = createResult.data!.pod.id;
      scheduler.schedule(podId);
    });

    it('should start a scheduled pod', () => {
      const result = scheduler.start(podId);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('starting');
    });

    it('should fail when pod not found', () => {
      const result = scheduler.start('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.POD_NOT_FOUND);
    });

    it('should fail when pod is not scheduled', () => {
      // Create another pending pod
      registerPack({
        name: 'pending-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/pending-pack/1.0.0/bundle.js',
      });
      const pendingPack = [...clusterState.packs.values()].find(p => p.name === 'pending-pack')!;
      const pendingResult = scheduler.create({ packId: pendingPack.id }, 'user1');
      const pendingPodId = pendingResult.data!.pod.id;

      const result = scheduler.start(pendingPodId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION);
    });
  });

  describe('lifecycle: setRunning', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'running-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/running-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'running-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const createResult = scheduler.create({ packId: pack.id }, 'user1');
      podId = createResult.data!.pod.id;
      scheduler.schedule(podId);
      scheduler.start(podId);
    });

    it('should set pod to running', () => {
      const result = scheduler.setRunning(podId);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('running');
    });

    it('should fail when pod is not starting', () => {
      // Create a scheduled (not started) pod
      registerPack({
        name: 'not-started-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/not-started-pack/1.0.0/bundle.js',
      });
      const notStartedPack = [...clusterState.packs.values()].find(p => p.name === 'not-started-pack')!;
      const createResult = scheduler.create({ packId: notStartedPack.id }, 'user1');
      const notStartedPodId = createResult.data!.pod.id;
      scheduler.schedule(notStartedPodId);

      const result = scheduler.setRunning(notStartedPodId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION);
    });
  });

  describe('lifecycle: stop', () => {
    let podId: string;
    let nodeId: string;

    beforeEach(() => {
      registerPack({
        name: 'stop-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/stop-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      const node = addNode({
        name: 'stop-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });
      nodeId = node.id;

      const createResult = scheduler.create({ packId: pack.id }, 'user1');
      podId = createResult.data!.pod.id;
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);
    });

    it('should stop a running pod', () => {
      const result = scheduler.stop(podId);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('stopping');
    });

    it('should release resources on node', () => {
      const nodeBefore = clusterState.nodes.get(nodeId)!;
      const allocatedBefore = nodeBefore.allocated.cpu;

      scheduler.stop(podId);

      const nodeAfter = clusterState.nodes.get(nodeId)!;
      expect(nodeAfter.allocated.cpu).toBeLessThan(allocatedBefore);
    });

    it('should fail when pod not found', () => {
      const result = scheduler.stop('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.POD_NOT_FOUND);
    });

    it('should fail when pod is already stopped or failed', () => {
      scheduler.stop(podId);
      scheduler.setStopped(podId);

      const result = scheduler.stop(podId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION);
    });
  });

  describe('lifecycle: setStopped', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'stopped-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/stopped-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'stopped-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const createResult = scheduler.create({ packId: pack.id }, 'user1');
      podId = createResult.data!.pod.id;
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);
      scheduler.stop(podId);
    });

    it('should set pod to stopped', () => {
      const result = scheduler.setStopped(podId);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('stopped');
    });

    it('should fail when pod is not stopping', () => {
      scheduler.setStopped(podId);

      const result = scheduler.setStopped(podId);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION);
    });
  });

  describe('lifecycle: fail', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'fail-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/fail-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'fail-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const createResult = scheduler.create({ packId: pack.id }, 'user1');
      podId = createResult.data!.pod.id;
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);
    });

    it('should mark pod as failed', () => {
      const result = scheduler.fail(podId, 'Out of memory');

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('failed');
      expect(result.data?.statusMessage).toBe('Out of memory');
    });

    it('should release resources on node', () => {
      const node = [...clusterState.nodes.values()][0];
      const allocatedBefore = node.allocated.cpu;

      scheduler.fail(podId);

      const nodeAfter = clusterState.nodes.get(node.id)!;
      expect(nodeAfter.allocated.cpu).toBeLessThan(allocatedBefore);
    });

    it('should fail when pod not found', () => {
      const result = scheduler.fail('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.POD_NOT_FOUND);
    });
  });

  describe('lifecycle: evict', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'evict-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/evict-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'evict-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const createResult = scheduler.create({ packId: pack.id }, 'user1');
      podId = createResult.data!.pod.id;
      scheduler.schedule(podId);
    });

    it('should evict a pod', () => {
      const result = scheduler.evict(podId, 'Node maintenance');

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('evicted');
      expect(result.data?.statusMessage).toBe('Node maintenance');
    });

    it('should release resources on node', () => {
      const node = [...clusterState.nodes.values()][0];
      const allocatedBefore = node.allocated.cpu;

      scheduler.evict(podId);

      const nodeAfter = clusterState.nodes.get(node.id)!;
      expect(nodeAfter.allocated.cpu).toBeLessThan(allocatedBefore);
    });

    it('should fail when pod not found', () => {
      const result = scheduler.evict('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.POD_NOT_FOUND);
    });
  });

  describe('lifecycle: delete', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'delete-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/delete-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'delete-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const createResult = scheduler.create({ packId: pack.id }, 'user1');
      podId = createResult.data!.pod.id;
    });

    it('should delete a pending pod', () => {
      const result = scheduler.delete(podId);

      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
      expect(scheduler.get(podId)).toBeUndefined();
    });

    it('should delete a running pod and release resources', () => {
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      const node = [...clusterState.nodes.values()][0];
      const allocatedBefore = node.allocated.cpu;

      scheduler.delete(podId);

      const nodeAfter = clusterState.nodes.get(node.id)!;
      expect(nodeAfter.allocated.cpu).toBeLessThan(allocatedBefore);
    });

    it('should fail when pod not found', () => {
      const result = scheduler.delete('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.POD_NOT_FOUND);
    });
  });

  describe('queries: get', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'get-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/get-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      const result = scheduler.create({ packId: pack.id }, 'user1');
      podId = result.data!.pod.id;
    });

    it('should return pod by ID', () => {
      const pod = scheduler.get(podId);

      expect(pod).toBeDefined();
      expect(pod?.id).toBe(podId);
    });

    it('should return undefined for nonexistent pod', () => {
      const pod = scheduler.get('nonexistent');

      expect(pod).toBeUndefined();
    });
  });

  describe('queries: getModel', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'model-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/model-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      const result = scheduler.create({ packId: pack.id }, 'user1');
      podId = result.data!.pod.id;
    });

    it('should return pod model by ID', () => {
      const model = scheduler.getModel(podId);

      expect(model).toBeDefined();
      expect(model?.id).toBe(podId);
    });

    it('should return undefined for nonexistent pod', () => {
      const model = scheduler.getModel('nonexistent');

      expect(model).toBeUndefined();
    });
  });

  describe('queries: list', () => {
    let pack1Id: string;
    let pack2Id: string;

    beforeEach(() => {
      // Create production namespace
      const namespaceManager = createNamespaceManager();
      namespaceManager.create({ name: 'production' }, 'user1');

      registerPack({
        name: 'list-pack-1',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/list-pack-1/1.0.0/bundle.js',
      });
      registerPack({
        name: 'list-pack-2',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/list-pack-2/1.0.0/bundle.js',
      });

      const packs = [...clusterState.packs.values()];
      pack1Id = packs.find(p => p.name === 'list-pack-1')!.id;
      pack2Id = packs.find(p => p.name === 'list-pack-2')!.id;

      addNode({
        name: 'list-node',
        runtimeType: 'node',
        allocatable: { cpu: 5000, memory: 5120, pods: 50 },
      });

      // Create pods in different namespaces
      scheduler.create({ packId: pack1Id, namespace: 'default' }, 'user1');
      scheduler.create({ packId: pack1Id, namespace: 'default' }, 'user1');
      scheduler.create({ packId: pack2Id, namespace: 'production' }, 'user1');
    });

    it('should list all pods', () => {
      const result = scheduler.list();

      expect(result.pods.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('should filter by packId', () => {
      const result = scheduler.list({ packId: pack1Id });

      expect(result.pods.length).toBe(2);
      expect(result.pods.every(p => p.packId === pack1Id)).toBe(true);
    });

    it('should filter by namespace', () => {
      const result = scheduler.list({ namespace: 'production' });

      expect(result.pods.length).toBe(1);
      expect(result.pods[0].namespace).toBe('production');
    });

    it('should filter by status', () => {
      const result = scheduler.list({ status: 'pending' });

      expect(result.pods.length).toBe(3);
      expect(result.pods.every(p => p.status === 'pending')).toBe(true);
    });

    it('should paginate results', () => {
      const page1 = scheduler.list({ page: 1, pageSize: 2 });
      const page2 = scheduler.list({ page: 2, pageSize: 2 });

      expect(page1.pods.length).toBe(2);
      expect(page1.total).toBe(3);
      expect(page2.pods.length).toBe(1);
      expect(page2.total).toBe(3);
    });
  });

  describe('queries: findByPack', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'find-by-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/find-by-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      scheduler.create({ packId }, 'user1');
      scheduler.create({ packId }, 'user1');
    });

    it('should find pods by pack ID', () => {
      const pods = scheduler.findByPack(packId);

      expect(pods.length).toBe(2);
      expect(pods.every(p => p.packId === packId)).toBe(true);
    });

    it('should return empty array for nonexistent pack', () => {
      const pods = scheduler.findByPack('nonexistent');

      expect(pods.length).toBe(0);
    });
  });

  describe('queries: findByNode', () => {
    let nodeId: string;

    beforeEach(() => {
      registerPack({
        name: 'find-by-node-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/find-by-node-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      const node = addNode({
        name: 'find-by-node',
        runtimeType: 'node',
        allocatable: { cpu: 5000, memory: 5120, pods: 50 },
      });
      nodeId = node.id;

      const pod1 = scheduler.create({ packId: pack.id }, 'user1');
      const pod2 = scheduler.create({ packId: pack.id }, 'user1');

      scheduler.schedule(pod1.data!.pod.id);
      scheduler.schedule(pod2.data!.pod.id);
    });

    it('should find pods by node ID', () => {
      const pods = scheduler.findByNode(nodeId);

      expect(pods.length).toBe(2);
      expect(pods.every(p => p.nodeId === nodeId)).toBe(true);
    });

    it('should return empty array for nonexistent node', () => {
      const pods = scheduler.findByNode('nonexistent');

      expect(pods.length).toBe(0);
    });
  });

  describe('queries: findByNamespace', () => {
    beforeEach(() => {
      // Create namespaces first
      const namespaceManager = createNamespaceManager();
      namespaceManager.create({ name: 'production' }, 'user1');
      namespaceManager.create({ name: 'staging' }, 'user1');

      registerPack({
        name: 'namespace-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/namespace-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      scheduler.create({ packId: pack.id, namespace: 'production' }, 'user1');
      scheduler.create({ packId: pack.id, namespace: 'production' }, 'user1');
      scheduler.create({ packId: pack.id, namespace: 'staging' }, 'user1');
    });

    it('should find pods by namespace', () => {
      const pods = scheduler.findByNamespace('production');

      expect(pods.length).toBe(2);
      expect(pods.every(p => p.namespace === 'production')).toBe(true);
    });

    it('should return empty array for nonexistent namespace', () => {
      const pods = scheduler.findByNamespace('nonexistent');

      expect(pods.length).toBe(0);
    });
  });

  describe('queries: findByStatus', () => {
    beforeEach(() => {
      registerPack({
        name: 'status-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/status-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'status-node',
        runtimeType: 'node',
        allocatable: { cpu: 5000, memory: 5120, pods: 50 },
      });

      const pod1 = scheduler.create({ packId: pack.id }, 'user1');
      const pod2 = scheduler.create({ packId: pack.id }, 'user1');
      scheduler.create({ packId: pack.id }, 'user1');

      scheduler.schedule(pod1.data!.pod.id);
      scheduler.schedule(pod2.data!.pod.id);
    });

    it('should find pods by status', () => {
      const pending = scheduler.findByStatus('pending');
      const scheduled = scheduler.findByStatus('scheduled');

      expect(pending.length).toBe(1);
      expect(scheduled.length).toBe(2);
    });
  });

  describe('queries: getPendingByPriority', () => {
    beforeEach(() => {
      // Add priority classes
      clusterState.priorityClasses.set('high', {
        name: 'high',
        value: 1000,
        globalDefault: false,
        description: 'High priority',
      });
      clusterState.priorityClasses.set('low', {
        name: 'low',
        value: 100,
        globalDefault: false,
        description: 'Low priority',
      });

      registerPack({
        name: 'priority-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/priority-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      scheduler.create({ packId: pack.id, priorityClassName: 'low' }, 'user1');
      scheduler.create({ packId: pack.id, priorityClassName: 'high' }, 'user1');
      scheduler.create({ packId: pack.id }, 'user1');
    });

    it('should return pending pods sorted by priority', () => {
      const pods = scheduler.getPendingByPriority();

      expect(pods.length).toBe(3);
      expect(pods[0].priority).toBe(1000); // high priority first
    });
  });

  describe('queries: getHistory', () => {
    let podId: string;

    beforeEach(() => {
      registerPack({
        name: 'history-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/history-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];

      addNode({
        name: 'history-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });

      const result = scheduler.create({ packId: pack.id }, 'user1');
      podId = result.data!.pod.id;
    });

    it('should return history for pod', () => {
      const history = scheduler.getHistory(podId);

      expect(history.length).toBeGreaterThan(0);
      expect(history[0].action).toBe('created');
    });

    it('should track lifecycle events', () => {
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      const history = scheduler.getHistory(podId);

      // At least 3 entries: created, scheduled, started/running
      expect(history.length).toBeGreaterThanOrEqual(3);
      expect(history.map(h => h.action)).toContain('created');
      expect(history.map(h => h.action)).toContain('scheduled');
    });
  });

  describe('scheduling policies', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'policy-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/policy-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      // Add multiple nodes
      addNode({
        name: 'node-a',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });
      addNode({
        name: 'node-b',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });
    });

    it('should use spread policy by default', () => {
      const sched = createPodScheduler({ schedulingPolicy: 'spread' });

      // Schedule multiple pods
      const pod1 = sched.create({ packId }, 'user1');
      const pod2 = sched.create({ packId }, 'user1');

      sched.schedule(pod1.data!.pod.id);
      sched.schedule(pod2.data!.pod.id);

      // Get updated pods
      const scheduledPod1 = sched.get(pod1.data!.pod.id);
      const scheduledPod2 = sched.get(pod2.data!.pod.id);

      // With spread policy, pods should be distributed
      expect(scheduledPod1?.nodeId).not.toBe(scheduledPod2?.nodeId);
    });

    it('should support binpack policy', () => {
      const sched = createPodScheduler({ schedulingPolicy: 'binpack' });

      // Schedule multiple pods
      const pod1 = sched.create({ packId }, 'user1');
      const pod2 = sched.create({ packId }, 'user1');

      sched.schedule(pod1.data!.pod.id);
      sched.schedule(pod2.data!.pod.id);

      // Get updated pods
      const scheduledPod1 = sched.get(pod1.data!.pod.id);
      const scheduledPod2 = sched.get(pod2.data!.pod.id);

      // With binpack policy, pods should be on the same node
      expect(scheduledPod1?.nodeId).toBe(scheduledPod2?.nodeId);
    });
  });

  describe('taints and tolerations', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'taint-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/taint-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;
    });

    it('should not schedule to tainted node without toleration', () => {
      addNode({
        name: 'tainted-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }],
      });

      const pod = scheduler.create({ packId }, 'user1');
      const result = scheduler.schedule(pod.data!.pod.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should schedule to tainted node with matching toleration', () => {
      addNode({
        name: 'tainted-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }],
      });

      const pod = scheduler.create({
        packId,
        tolerations: [
          { key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' },
        ],
      }, 'user1');

      const result = scheduler.schedule(pod.data!.pod.id);

      expect(result.success).toBe(true);
      expect(result.data?.scheduled).toBe(true);
    });
  });

  describe('node selector', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'selector-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/selector-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      addNode({
        name: 'gpu-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        labels: { 'gpu': 'true', 'env': 'production' },
      });
      addNode({
        name: 'cpu-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        labels: { 'gpu': 'false', 'env': 'production' },
      });
    });

    it('should schedule to node matching selector', () => {
      const pod = scheduler.create({
        packId,
        scheduling: {
          nodeSelector: { gpu: 'true' },
        },
      }, 'user1');

      scheduler.schedule(pod.data!.pod.id);

      const scheduledPod = scheduler.get(pod.data!.pod.id);
      const node = clusterState.nodes.get(scheduledPod!.nodeId!);

      expect(node?.labels.gpu).toBe('true');
    });

    it('should not schedule when no node matches selector', () => {
      const pod = scheduler.create({
        packId,
        scheduling: {
          nodeSelector: { specialHardware: 'quantum' },
        },
      }, 'user1');

      const result = scheduler.schedule(pod.data!.pod.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });
  });

  describe('resource constraints', () => {
    let packId: string;

    beforeEach(() => {
      registerPack({
        name: 'resource-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/resource-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      addNode({
        name: 'limited-node',
        runtimeType: 'node',
        allocatable: { cpu: 500, memory: 512, pods: 10 },
      });
    });

    it('should not schedule when insufficient CPU', () => {
      const pod = scheduler.create({
        packId,
        resourceRequests: { cpu: 1000, memory: 256 },
      }, 'user1');

      const result = scheduler.schedule(pod.data!.pod.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should not schedule when insufficient memory', () => {
      const pod = scheduler.create({
        packId,
        resourceRequests: { cpu: 100, memory: 1024 },
      }, 'user1');

      const result = scheduler.schedule(pod.data!.pod.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should schedule when resources are sufficient', () => {
      const pod = scheduler.create({
        packId,
        resourceRequests: { cpu: 200, memory: 256 },
      }, 'user1');

      const result = scheduler.schedule(pod.data!.pod.id);

      expect(result.success).toBe(true);
      expect(result.data?.scheduled).toBe(true);
    });
  });

  describe('preemption', () => {
    let packId: string;

    beforeEach(() => {
      // Add priority classes
      clusterState.priorityClasses.set('high', {
        name: 'high',
        value: 1000,
        globalDefault: false,
        description: 'High priority',
      });
      clusterState.priorityClasses.set('low', {
        name: 'low',
        value: 100,
        globalDefault: false,
        description: 'Low priority',
      });

      registerPack({
        name: 'preempt-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/preempt-pack/1.0.0/bundle.js',
      });
      const pack = [...clusterState.packs.values()][0];
      packId = pack.id;

      addNode({
        name: 'preempt-node',
        runtimeType: 'node',
        allocatable: { cpu: 500, memory: 512, pods: 10 },
      });
    });

    it('should preempt lower priority pods when enabled', () => {
      const preemptScheduler = createPodScheduler({ enablePreemption: true });

      // Create and schedule a low priority pod that uses all resources
      const lowPod = preemptScheduler.create({
        packId,
        priorityClassName: 'low',
        resourceRequests: { cpu: 400, memory: 400 },
      }, 'user1');
      preemptScheduler.schedule(lowPod.data!.pod.id);

      // Create a high priority pod
      const highPod = preemptScheduler.create({
        packId,
        priorityClassName: 'high',
        resourceRequests: { cpu: 400, memory: 400 },
      }, 'user1');

      const result = preemptScheduler.schedule(highPod.data!.pod.id);

      expect(result.success).toBe(true);
      expect(result.data?.scheduled).toBe(true);

      // Low priority pod should be evicted
      const lowPodAfter = preemptScheduler.get(lowPod.data!.pod.id);
      expect(lowPodAfter?.status).toBe('evicted');
    });

    it('should not preempt when disabled', () => {
      const noPreemptScheduler = createPodScheduler({ enablePreemption: false });

      // Create and schedule a low priority pod that uses all resources
      const lowPod = noPreemptScheduler.create({
        packId,
        priorityClassName: 'low',
        resourceRequests: { cpu: 400, memory: 400 },
      }, 'user1');
      noPreemptScheduler.schedule(lowPod.data!.pod.id);

      // Create a high priority pod
      const highPod = noPreemptScheduler.create({
        packId,
        priorityClassName: 'high',
        resourceRequests: { cpu: 400, memory: 400 },
      }, 'user1');

      const result = noPreemptScheduler.schedule(highPod.data!.pod.id);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });
  });
});
