/**
 * Unit tests for rollback functionality
 * Tests PodScheduler.rollback() and PackRegistry.getVersions()
 * @module @stark-o/core/tests/unit/rollback
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  PodScheduler,
  createPodScheduler,
  PodSchedulerErrorCodes,
  PackRegistry,
  createPackRegistry,
  resetCluster,
  registerPack,
  addNode,
  clusterState,
  initializeCluster,
  schedulePod,
} from '../../src';

describe('Rollback', () => {
  describe('PodScheduler.rollback', () => {
    let scheduler: PodScheduler;
    let packId: string;
    let packV1Id: string;
    let packV2Id: string;

    beforeEach(() => {
      resetCluster();
      initializeCluster();
      scheduler = createPodScheduler();

      // Register two versions of the same pack
      registerPack({
        name: 'my-service',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/my-service/1.0.0/bundle.js',
      });

      registerPack({
        name: 'my-service',
        version: '2.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/my-service/2.0.0/bundle.js',
      });

      // Get pack IDs
      const packs = [...clusterState.packs.values()];
      const v1Pack = packs.find(p => p.name === 'my-service' && p.version === '1.0.0');
      const v2Pack = packs.find(p => p.name === 'my-service' && p.version === '2.0.0');
      packV1Id = v1Pack!.id;
      packV2Id = v2Pack!.id;
      packId = packV2Id;

      // Add a compatible node
      addNode({
        name: 'node-1',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });
    });

    describe('successful rollback', () => {
      it('should rollback a scheduled pod to a previous version', () => {
        // Create and schedule a pod with v2.0.0
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        expect(createResult.success).toBe(true);
        const podId = createResult.data!.pod.id;

        // Schedule the pod
        const scheduleResult = scheduler.schedule(podId);
        expect(scheduleResult.success).toBe(true);

        // Rollback to v1.0.0
        const rollbackResult = scheduler.rollback(podId, '1.0.0');

        expect(rollbackResult.success).toBe(true);
        expect(rollbackResult.data).toBeDefined();
        expect(rollbackResult.data!.previousVersion).toBe('2.0.0');
        expect(rollbackResult.data!.newVersion).toBe('1.0.0');
        expect(rollbackResult.data!.packName).toBe('my-service');
        expect(rollbackResult.data!.packId).toBe(packV1Id);
        expect(rollbackResult.data!.podId).toBe(podId);
      });

      it('should rollback a running pod to a previous version', () => {
        // Create, schedule, and start a pod
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);
        scheduler.start(podId);

        // Rollback to v1.0.0
        const rollbackResult = scheduler.rollback(podId, '1.0.0');

        expect(rollbackResult.success).toBe(true);
        expect(rollbackResult.data!.previousVersion).toBe('2.0.0');
        expect(rollbackResult.data!.newVersion).toBe('1.0.0');
      });

      it('should rollback a starting pod to a previous version', () => {
        // Create and schedule a pod, then mark it as starting
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Manually set status to starting (simulating the transition)
        const pod = clusterState.pods.get(podId);
        if (pod) {
          clusterState.pods.set(podId, { ...pod, status: 'starting' });
        }

        // Rollback to v1.0.0
        const rollbackResult = scheduler.rollback(podId, '1.0.0');

        expect(rollbackResult.success).toBe(true);
        expect(rollbackResult.data!.newVersion).toBe('1.0.0');
      });

      it('should update pod packId and packVersion after rollback', () => {
        // Create and schedule a pod with v2.0.0
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Verify current state
        let pod = clusterState.pods.get(podId);
        expect(pod!.packId).toBe(packV2Id);
        expect(pod!.packVersion).toBe('2.0.0');

        // Rollback to v1.0.0
        scheduler.rollback(podId, '1.0.0');

        // Verify updated state
        pod = clusterState.pods.get(podId);
        expect(pod!.packId).toBe(packV1Id);
        expect(pod!.packVersion).toBe('1.0.0');
      });

      it('should add a history entry for the rollback', () => {
        // Create and schedule a pod
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Rollback to v1.0.0
        scheduler.rollback(podId, '1.0.0');

        // Check history
        const history = scheduler.getHistory(podId);
        const rollbackEntry = history.find(h => h.action === 'rolled_back');

        expect(rollbackEntry).toBeDefined();
        expect(rollbackEntry!.metadata).toBeDefined();
        expect(rollbackEntry!.metadata!.previousVersion).toBe('2.0.0');
        expect(rollbackEntry!.metadata!.newVersion).toBe('1.0.0');
      });

      it('should support rollback to a newer version (upgrade)', () => {
        // Create and schedule a pod with v1.0.0
        const createResult = scheduler.create({ packId: packV1Id, packVersion: '1.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // "Rollback" to v2.0.0 (really an upgrade)
        const rollbackResult = scheduler.rollback(podId, '2.0.0');

        expect(rollbackResult.success).toBe(true);
        expect(rollbackResult.data!.previousVersion).toBe('1.0.0');
        expect(rollbackResult.data!.newVersion).toBe('2.0.0');
      });
    });

    describe('rollback failures', () => {
      it('should fail when pod is not found', () => {
        const result = scheduler.rollback('nonexistent-pod', '1.0.0');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.POD_NOT_FOUND);
        expect(result.error?.message).toContain('Pod not found');
      });

      it('should fail when pod is in pending status', () => {
        // Create a pod but don't schedule it
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;

        const result = scheduler.rollback(podId, '1.0.0');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATE);
        expect(result.error?.message).toContain('Cannot rollback pod');
        expect(result.error?.details?.currentStatus).toBe('pending');
      });

      it('should fail when pod is in stopped status', () => {
        // Create, schedule, start a pod, then manually set it to stopped
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);
        scheduler.start(podId);
        
        // Manually set to stopped (stop() only sets to 'stopping')
        const pod = clusterState.pods.get(podId);
        if (pod) {
          clusterState.pods.set(podId, { ...pod, status: 'stopped' });
        }

        const result = scheduler.rollback(podId, '1.0.0');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATE);
        expect(result.error?.details?.currentStatus).toBe('stopped');
      });

      it('should fail when pod is in failed status', () => {
        // Create and schedule a pod, then mark it as failed
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);
        scheduler.fail(podId, 'Test failure reason');

        const result = scheduler.rollback(podId, '1.0.0');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.INVALID_STATE);
        expect(result.error?.details?.currentStatus).toBe('failed');
      });

      it('should fail when trying to rollback to the same version', () => {
        // Create and schedule a pod with v2.0.0
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        const result = scheduler.rollback(podId, '2.0.0');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.SAME_VERSION);
        expect(result.error?.message).toContain('already running version');
        expect(result.error?.details?.currentVersion).toBe('2.0.0');
        expect(result.error?.details?.targetVersion).toBe('2.0.0');
      });

      it('should fail when target version does not exist', () => {
        // Create and schedule a pod
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        const result = scheduler.rollback(podId, '3.0.0');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.VERSION_NOT_FOUND);
        expect(result.error?.message).toContain('my-service@3.0.0');
        expect(result.error?.details?.packName).toBe('my-service');
        expect(result.error?.details?.targetVersion).toBe('3.0.0');
      });

      it('should fail when current pack is not found', () => {
        // Create and schedule a pod
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Remove the current pack from the store
        clusterState.packs.delete(packV2Id);

        const result = scheduler.rollback(podId, '1.0.0');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.PACK_NOT_FOUND);
        expect(result.error?.message).toContain('Current pack not found');
      });
    });

    describe('runtime compatibility checks', () => {
      beforeEach(() => {
        // Register a browser-only version of the pack
        registerPack({
          name: 'my-service',
          version: '3.0.0-browser',
          runtimeTag: 'browser',
          ownerId: 'owner1',
          bundlePath: 'packs/my-service/3.0.0-browser/bundle.js',
        });
      });

      it('should fail when target version has incompatible runtime', () => {
        // Create and schedule a pod on a node runtime
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Try to rollback to browser-only version
        const result = scheduler.rollback(podId, '3.0.0-browser');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PodSchedulerErrorCodes.RUNTIME_MISMATCH);
        expect(result.error?.message).toContain('not compatible with node runtime');
        expect(result.error?.details?.nodeRuntime).toBe('node');
        expect(result.error?.details?.targetPackRuntime).toBe('browser');
      });

      it('should allow rollback when pod has no assigned node', () => {
        // Create a pod and manually set it to scheduled without a node (edge case)
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;

        // Manually set to scheduled status without a node
        const pod = clusterState.pods.get(podId);
        if (pod) {
          clusterState.pods.set(podId, { ...pod, status: 'scheduled', nodeId: null });
        }

        // Rollback should succeed since there's no node to check compatibility against
        const result = scheduler.rollback(podId, '1.0.0');

        expect(result.success).toBe(true);
        expect(result.data!.newVersion).toBe('1.0.0');
      });

      it('should allow rollback to universal runtime pack on node', () => {
        // Register a universal version
        registerPack({
          name: 'my-service',
          version: '4.0.0-universal',
          runtimeTag: 'universal',
          ownerId: 'owner1',
          bundlePath: 'packs/my-service/4.0.0-universal/bundle.js',
        });

        // Create and schedule a pod on a node runtime
        const createResult = scheduler.create({ packId: packV2Id, packVersion: '2.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Rollback to universal version should work
        const result = scheduler.rollback(podId, '4.0.0-universal');

        expect(result.success).toBe(true);
        expect(result.data!.newVersion).toBe('4.0.0-universal');
      });
    });

    describe('multiple rollbacks', () => {
      beforeEach(() => {
        // Register a third version
        registerPack({
          name: 'my-service',
          version: '3.0.0',
          runtimeTag: 'node',
          ownerId: 'owner1',
          bundlePath: 'packs/my-service/3.0.0/bundle.js',
        });
      });

      it('should allow multiple sequential rollbacks', () => {
        // Get the v3 pack ID
        const packs = [...clusterState.packs.values()];
        const v3Pack = packs.find(p => p.name === 'my-service' && p.version === '3.0.0');
        const packV3Id = v3Pack!.id;

        // Create and schedule a pod with v3.0.0
        const createResult = scheduler.create({ packId: packV3Id, packVersion: '3.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Rollback to v2.0.0
        let result = scheduler.rollback(podId, '2.0.0');
        expect(result.success).toBe(true);
        expect(result.data!.newVersion).toBe('2.0.0');

        // Rollback to v1.0.0
        result = scheduler.rollback(podId, '1.0.0');
        expect(result.success).toBe(true);
        expect(result.data!.previousVersion).toBe('2.0.0');
        expect(result.data!.newVersion).toBe('1.0.0');

        // Verify final state
        const pod = clusterState.pods.get(podId);
        expect(pod!.packVersion).toBe('1.0.0');
        expect(pod!.packId).toBe(packV1Id);
      });

      it('should track all rollback history entries', () => {
        // Get the v3 pack ID
        const packs = [...clusterState.packs.values()];
        const v3Pack = packs.find(p => p.name === 'my-service' && p.version === '3.0.0');
        const packV3Id = v3Pack!.id;

        // Create and schedule a pod with v3.0.0
        const createResult = scheduler.create({ packId: packV3Id, packVersion: '3.0.0' }, 'user1');
        const podId = createResult.data!.pod.id;
        scheduler.schedule(podId);

        // Multiple rollbacks
        scheduler.rollback(podId, '2.0.0');
        scheduler.rollback(podId, '1.0.0');
        scheduler.rollback(podId, '2.0.0');

        // Check history has all rollback entries
        const history = scheduler.getHistory(podId);
        const rollbackEntries = history.filter(h => h.action === 'rolled_back');

        expect(rollbackEntries.length).toBe(3);
      });
    });
  });

  describe('PackRegistry.getVersions', () => {
    let registry: PackRegistry;

    beforeEach(() => {
      resetCluster();
      initializeCluster();
      registry = createPackRegistry();
    });

    it('should return all versions of a pack sorted by version', () => {
      // Register multiple versions
      registerPack({
        name: 'test-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/test-pack/1.0.0/bundle.js',
      });

      registerPack({
        name: 'test-pack',
        version: '2.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/test-pack/2.0.0/bundle.js',
      });

      registerPack({
        name: 'test-pack',
        version: '1.5.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/test-pack/1.5.0/bundle.js',
      });

      const result = registry.getVersions('test-pack');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(3);

      // Verify versions are included
      const versions = result.data!.map(v => v.version);
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('1.5.0');
      expect(versions).toContain('2.0.0');
    });

    it('should return version summaries with correct fields', () => {
      registerPack({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'browser',
        ownerId: 'owner1',
        bundlePath: 'packs/my-pack/1.0.0/bundle.js',
      });

      const result = registry.getVersions('my-pack');

      expect(result.success).toBe(true);
      expect(result.data![0]).toHaveProperty('version', '1.0.0');
      expect(result.data![0]).toHaveProperty('id');
      expect(result.data![0]).toHaveProperty('runtimeTag', 'browser');
      expect(result.data![0]).toHaveProperty('createdAt');
    });

    it('should fail when pack does not exist', () => {
      const result = registry.getVersions('nonexistent-pack');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
      expect(result.error?.message).toContain('Pack nonexistent-pack not found');
      expect(result.error?.details?.packName).toBe('nonexistent-pack');
    });

    it('should return single version for pack with one version', () => {
      registerPack({
        name: 'single-version-pack',
        version: '1.0.0',
        runtimeTag: 'universal',
        ownerId: 'owner1',
        bundlePath: 'packs/single-version-pack/1.0.0/bundle.js',
      });

      const result = registry.getVersions('single-version-pack');

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(1);
      expect(result.data![0].version).toBe('1.0.0');
    });

    it('should include versions with different runtimes', () => {
      registerPack({
        name: 'multi-runtime-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'owner1',
        bundlePath: 'packs/multi-runtime-pack/1.0.0/bundle.js',
      });

      registerPack({
        name: 'multi-runtime-pack',
        version: '2.0.0',
        runtimeTag: 'browser',
        ownerId: 'owner1',
        bundlePath: 'packs/multi-runtime-pack/2.0.0/bundle.js',
      });

      const result = registry.getVersions('multi-runtime-pack');

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(2);

      const v1 = result.data!.find(v => v.version === '1.0.0');
      const v2 = result.data!.find(v => v.version === '2.0.0');

      expect(v1!.runtimeTag).toBe('node');
      expect(v2!.runtimeTag).toBe('browser');
    });
  });
});
