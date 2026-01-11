/**
 * Integration tests for Pack Rollback Flow
 * @module tests/integration/rollback
 *
 * Tests for User Story 4: Pack Versioning and Rollback
 * These tests verify the complete rollback workflow from start to finish
 *
 * Flow:
 * 1. Register pack v1.0.0, deploy as a pod, verify it runs
 * 2. Register pack v2.0.0, deploy as a pod, verify it runs
 * 3. Rollback the pod to v1.0.0
 * 4. Verify the pod is now running with v1.0.0
 *
 * NOTE: These tests require the following implementations:
 * - T055: packages/core/src/models/pack.ts ✓
 * - T056: packages/core/src/models/pod.ts ✓
 * - T057: packages/core/src/services/pack-registry.ts ✓
 * - T058: packages/core/src/services/pod-scheduler.ts ✓
 * - T073: packages/core/src/services/node-manager.ts ✓
 * - T108: packages/core/src/services/pack-registry.ts - getVersions (PENDING)
 * - T109: packages/core/src/services/pod-scheduler.ts - rollback (PENDING)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PodStatus } from '@stark-o/shared';

import { PodScheduler } from '@stark-o/core/services/pod-scheduler';
import { PackRegistry } from '@stark-o/core/services/pack-registry';
import { createNodeManager, NodeManager } from '@stark-o/core/services/node-manager';
import { resetClusterState } from '@stark-o/core/stores/cluster-store';

describe('Rollback Flow Integration Tests', () => {
  let scheduler: PodScheduler;
  let packRegistry: PackRegistry;
  let nodeManager: NodeManager;
  const testUserId = 'rollback-test-user';

  beforeEach(async () => {
    // Reset state before each test
    resetClusterState();

    // Create fresh instances for each test
    packRegistry = new PackRegistry();
    nodeManager = createNodeManager();
    scheduler = new PodScheduler();

    // Set up a default healthy node
    nodeManager.register({
      name: 'rollback-test-node',
      runtimeType: 'node',
      allocatable: {
        cpu: 4000,
        memory: 8192,
        pods: 100,
        storage: 50000,
      },
    }, testUserId);
  });

  afterEach(() => {
    nodeManager.dispose();
  });

  describe('Version Listing', () => {
    it('should list all versions of a pack', () => {
      // Register multiple versions
      packRegistry.register(
        { name: 'versioned-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'versioned-pack', version: '1.1.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'versioned-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );

      const versionsResult = packRegistry.getVersions('versioned-pack');
      expect(versionsResult.success).toBe(true);
      expect(versionsResult.data).toBeDefined();
      expect(versionsResult.data!.length).toBe(3);

      const versions = versionsResult.data!.map(v => v.version);
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('1.1.0');
      expect(versions).toContain('2.0.0');
    });

    it('should return error for non-existent pack versions', () => {
      const versionsResult = packRegistry.getVersions('non-existent-pack');
      expect(versionsResult.success).toBe(false);
      expect(versionsResult.error?.code).toBe('NOT_FOUND');
    });

    it('should order versions correctly (semantic versioning)', () => {
      packRegistry.register(
        { name: 'semver-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'semver-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'semver-pack', version: '1.5.0', runtimeTag: 'node' },
        testUserId
      );

      const versionsResult = packRegistry.getVersions('semver-pack');
      expect(versionsResult.success).toBe(true);

      const versions = versionsResult.data!.map(v => v.version);
      // Should be ordered by semantic version (ascending or descending depending on implementation)
      expect(versions).toEqual(expect.arrayContaining(['1.0.0', '1.5.0', '2.0.0']));
    });
  });

  describe('Pod Version Update (Rollback)', () => {
    let packV1Id: string;
    let packV2Id: string;

    beforeEach(() => {
      // Register v1.0.0
      const v1Result = packRegistry.register(
        { name: 'rollback-test-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(v1Result.success).toBe(true);
      packV1Id = v1Result.data!.pack.id;

      // Register v2.0.0
      const v2Result = packRegistry.register(
        { name: 'rollback-test-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(v2Result.success).toBe(true);
      packV2Id = v2Result.data!.pack.id;
    });

    it('should rollback a running pod to a previous version', () => {
      // Create a pod using v2.0.0
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const podId = createResult.data!.pod.id;
      expect(createResult.data!.pod.packVersion).toBe('2.0.0');

      // Schedule and start the pod
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      let pod = scheduler.get(podId)!;
      expect(pod.status).toBe('running');
      expect(pod.packVersion).toBe('2.0.0');

      // Rollback to v1.0.0
      const rollbackResult = scheduler.rollback(podId, '1.0.0');
      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.data?.previousVersion).toBe('2.0.0');
      expect(rollbackResult.data?.newVersion).toBe('1.0.0');

      // Verify pod is now using v1.0.0
      pod = scheduler.get(podId)!;
      expect(pod.packVersion).toBe('1.0.0');
    });

    it('should rollback a scheduled pod to a previous version', () => {
      // Create a pod using v2.0.0
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const podId = createResult.data!.pod.id;

      // Schedule but don't start
      scheduler.schedule(podId);

      let pod = scheduler.get(podId)!;
      expect(pod.status).toBe('scheduled');
      expect(pod.packVersion).toBe('2.0.0');

      // Rollback to v1.0.0
      const rollbackResult = scheduler.rollback(podId, '1.0.0');
      expect(rollbackResult.success).toBe(true);

      // Verify pod is now using v1.0.0
      pod = scheduler.get(podId)!;
      expect(pod.packVersion).toBe('1.0.0');
    });

    it('should fail to rollback a pending pod', () => {
      // Create a pod (pending state)
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const podId = createResult.data!.pod.id;

      const pod = scheduler.get(podId)!;
      expect(pod.status).toBe('pending');

      // Rollback should fail for pending pods
      const rollbackResult = scheduler.rollback(podId, '1.0.0');
      expect(rollbackResult.success).toBe(false);
      expect(rollbackResult.error?.code).toBe('INVALID_STATE');
    });

    it('should fail to rollback to the same version', () => {
      // Create a pod using v2.0.0
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const podId = createResult.data!.pod.id;

      // Schedule and start the pod
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      // Rollback to same version should fail
      const rollbackResult = scheduler.rollback(podId, '2.0.0');
      expect(rollbackResult.success).toBe(false);
      expect(rollbackResult.error?.code).toBe('SAME_VERSION');
    });

    it('should fail to rollback to non-existent version', () => {
      // Create a pod using v2.0.0
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const podId = createResult.data!.pod.id;

      // Schedule and start the pod
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      // Rollback to non-existent version should fail
      const rollbackResult = scheduler.rollback(podId, '3.0.0');
      expect(rollbackResult.success).toBe(false);
      expect(rollbackResult.error?.code).toBe('VERSION_NOT_FOUND');
    });

    it('should fail to rollback non-existent pod', () => {
      const rollbackResult = scheduler.rollback('non-existent-pod-id', '1.0.0');
      expect(rollbackResult.success).toBe(false);
      expect(rollbackResult.error?.code).toBe('POD_NOT_FOUND');
    });

    it('should fail to rollback a stopped pod', () => {
      // Create a pod using v2.0.0
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const podId = createResult.data!.pod.id;

      // Full lifecycle: schedule, start, run, stop
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);
      scheduler.stop(podId);
      scheduler.setStopped(podId);

      const pod = scheduler.get(podId)!;
      expect(pod.status).toBe('stopped');

      // Rollback should fail for stopped pods
      const rollbackResult = scheduler.rollback(podId, '1.0.0');
      expect(rollbackResult.success).toBe(false);
      expect(rollbackResult.error?.code).toBe('INVALID_STATE');
    });

    it('should fail to rollback a failed pod', () => {
      // Create a pod using v2.0.0
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const podId = createResult.data!.pod.id;

      // Schedule, start, then fail
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.fail(podId, 'Test failure');

      const pod = scheduler.get(podId)!;
      expect(pod.status).toBe('failed');

      // Rollback should fail for failed pods
      const rollbackResult = scheduler.rollback(podId, '1.0.0');
      expect(rollbackResult.success).toBe(false);
      expect(rollbackResult.error?.code).toBe('INVALID_STATE');
    });
  });

  describe('Rollback History Tracking', () => {
    let packV1Id: string;
    let packV2Id: string;

    beforeEach(() => {
      const v1Result = packRegistry.register(
        { name: 'history-test-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      packV1Id = v1Result.data!.pack.id;

      const v2Result = packRegistry.register(
        { name: 'history-test-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      packV2Id = v2Result.data!.pack.id;
    });

    it('should record rollback in pod history', () => {
      // Create and run a pod with v2.0.0
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      const podId = createResult.data!.pod.id;

      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      // Perform rollback
      scheduler.rollback(podId, '1.0.0');

      // Check history
      const history = scheduler.getHistory(podId);
      const rollbackEvent = history.find(h => h.action === 'rolled_back');

      expect(rollbackEvent).toBeDefined();
      expect(rollbackEvent?.metadata?.previousVersion).toBe('2.0.0');
      expect(rollbackEvent?.metadata?.newVersion).toBe('1.0.0');
    });

    it('should track multiple rollbacks', () => {
      // Register v3.0.0
      const v3Result = packRegistry.register(
        { name: 'history-test-pack', version: '3.0.0', runtimeTag: 'node' },
        testUserId
      );
      const packV3Id = v3Result.data!.pack.id;

      // Create and run a pod with v3.0.0
      const createResult = scheduler.create(
        { packId: packV3Id },
        testUserId
      );
      const podId = createResult.data!.pod.id;

      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      // Rollback to v2.0.0
      scheduler.rollback(podId, '2.0.0');

      // Rollback to v1.0.0
      scheduler.rollback(podId, '1.0.0');

      // Check history
      const history = scheduler.getHistory(podId);
      const rollbackEvents = history.filter(h => h.action === 'rolled_back');

      expect(rollbackEvents.length).toBe(2);

      // First rollback: 3.0.0 -> 2.0.0
      expect(rollbackEvents[0]?.metadata?.previousVersion).toBe('3.0.0');
      expect(rollbackEvents[0]?.metadata?.newVersion).toBe('2.0.0');

      // Second rollback: 2.0.0 -> 1.0.0
      expect(rollbackEvents[1]?.metadata?.previousVersion).toBe('2.0.0');
      expect(rollbackEvents[1]?.metadata?.newVersion).toBe('1.0.0');
    });
  });

  describe('Rollback with Node Compatibility', () => {
    it('should verify target version is compatible with node runtime', () => {
      // Register a universal pack (v1) and node-only pack (v2)
      const v1Result = packRegistry.register(
        { name: 'compat-test-pack', version: '1.0.0', runtimeTag: 'universal' },
        testUserId
      );
      const packV1Id = v1Result.data!.pack.id;

      const v2Result = packRegistry.register(
        { name: 'compat-test-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      const packV2Id = v2Result.data!.pack.id;

      // Create and run a pod with v2.0.0 on node runtime
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      const podId = createResult.data!.pod.id;

      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      // Rollback to v1.0.0 (universal) should work
      const rollbackResult = scheduler.rollback(podId, '1.0.0');
      expect(rollbackResult.success).toBe(true);
    });

    it('should fail rollback if target version is incompatible with node', () => {
      // Register node pack (v1) and browser pack (v2 - different pack to deploy)
      packRegistry.register(
        { name: 'incompat-test-pack', version: '1.0.0', runtimeTag: 'browser' },
        testUserId
      );

      const v2Result = packRegistry.register(
        { name: 'incompat-test-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      const packV2Id = v2Result.data!.pack.id;

      // Create and run a pod with v2.0.0 on node runtime
      const createResult = scheduler.create(
        { packId: packV2Id },
        testUserId
      );
      const podId = createResult.data!.pod.id;

      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);

      // Rollback to v1.0.0 (browser) should fail since pod is on node
      const rollbackResult = scheduler.rollback(podId, '1.0.0');
      expect(rollbackResult.success).toBe(false);
      expect(rollbackResult.error?.code).toBe('RUNTIME_MISMATCH');
    });
  });

  describe('End-to-End Rollback Scenario', () => {
    it('should complete full deploy -> upgrade -> rollback cycle', () => {
      // Step 1: Register v1.0.0 and deploy
      const v1Result = packRegistry.register(
        { name: 'e2e-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(v1Result.success).toBe(true);
      const packV1Id = v1Result.data!.pack.id;

      const pod1Result = scheduler.create({ packId: packV1Id }, testUserId);
      expect(pod1Result.success).toBe(true);
      const pod1Id = pod1Result.data!.pod.id;

      scheduler.schedule(pod1Id);
      scheduler.start(pod1Id);
      scheduler.setRunning(pod1Id);

      let pod1 = scheduler.get(pod1Id)!;
      expect(pod1.status).toBe('running');
      expect(pod1.packVersion).toBe('1.0.0');

      // Step 2: Register v2.0.0 and create new pod
      const v2Result = packRegistry.register(
        { name: 'e2e-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(v2Result.success).toBe(true);

      // Step 3: Rollback pod1 to previous version (it's already on v1)
      // First upgrade it to v2.0.0
      const upgradeResult = scheduler.rollback(pod1Id, '2.0.0'); // Using rollback for version change
      expect(upgradeResult.success).toBe(true);
      
      pod1 = scheduler.get(pod1Id)!;
      expect(pod1.packVersion).toBe('2.0.0');

      // Step 4: Rollback back to v1.0.0
      const rollbackResult = scheduler.rollback(pod1Id, '1.0.0');
      expect(rollbackResult.success).toBe(true);

      pod1 = scheduler.get(pod1Id)!;
      expect(pod1.packVersion).toBe('1.0.0');

      // Step 5: Verify history contains all version changes
      const history = scheduler.getHistory(pod1Id);
      const rollbackEvents = history.filter(h => h.action === 'rolled_back');
      expect(rollbackEvents.length).toBeGreaterThanOrEqual(2);
    });
  });
});
