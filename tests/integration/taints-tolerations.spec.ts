/**
 * Integration tests for Taint/Toleration Scheduling
 * @module tests/integration/taints-tolerations
 *
 * Tests for User Story 6: Kubernetes-Like Scheduling & Isolation
 * These tests verify that taints and tolerations work correctly for pod scheduling
 *
 * TDD: These tests are written FIRST and will FAIL until implementation is complete.
 *
 * Key scenarios tested:
 * 1. Pods without tolerations are rejected from tainted nodes
 * 2. Pods with matching tolerations can schedule to tainted nodes
 * 3. NoSchedule effect prevents scheduling but not eviction
 * 4. PreferNoSchedule effect deprioritizes nodes but allows scheduling
 * 5. NoExecute effect causes immediate eviction of non-tolerating pods
 * 6. Toleration operators (Equal, Exists) work correctly
 * 7. Super-toleration (empty key with Exists) tolerates all taints
 * 8. TolerationSeconds for NoExecute taints
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CreatePodInput, Taint, Toleration } from '@stark-o/shared';
import {
  tolerationMatchesTaint,
  toleratesTaints,
  getEvictionTaints,
  CommonTaints,
  CommonTolerations,
} from '@stark-o/shared';

import { PodScheduler, PodSchedulerErrorCodes } from '@stark-o/core/services/pod-scheduler';
import { PackRegistry } from '@stark-o/core/services/pack-registry';
import { createNodeManager, NodeManager } from '@stark-o/core/services/node-manager';
import { resetClusterState } from '@stark-o/core/stores/cluster-store';

describe('Taints and Tolerations Integration Tests', () => {
  let scheduler: PodScheduler;
  let packRegistry: PackRegistry;
  let nodeManager: NodeManager;
  const testUserId = 'test-user-taints';
  let testPackId: string;

  beforeEach(() => {
    // Reset state before each test
    resetClusterState();

    // Create fresh instances for each test
    packRegistry = new PackRegistry();
    nodeManager = createNodeManager();
    scheduler = new PodScheduler();

    // Register a test pack for all tests
    const packResult = packRegistry.register(
      { name: 'test-pack', version: '1.0.0', runtimeTag: 'node' },
      testUserId
    );
    expect(packResult.success).toBe(true);
    testPackId = packResult.data!.pack.id;
  });

  afterEach(() => {
    nodeManager.dispose();
  });

  // ===========================================================================
  // Helper Functions
  // ===========================================================================

  describe('tolerationMatchesTaint helper', () => {
    describe('Equal operator', () => {
      it('should match when key, value, and effect all match', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'dedicated',
          operator: 'Equal',
          value: 'gpu',
          effect: 'NoSchedule',
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(true);
      });

      it('should not match when key differs', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'other-key',
          operator: 'Equal',
          value: 'gpu',
          effect: 'NoSchedule',
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(false);
      });

      it('should not match when value differs', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'dedicated',
          operator: 'Equal',
          value: 'cpu',
          effect: 'NoSchedule',
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(false);
      });

      it('should not match when effect differs and is specified', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'dedicated',
          operator: 'Equal',
          value: 'gpu',
          effect: 'NoExecute',
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(false);
      });

      it('should match when effect is not specified in toleration', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'dedicated',
          operator: 'Equal',
          value: 'gpu',
          // No effect specified - matches any effect
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(true);
      });

      it('should default to Equal operator when not specified', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'dedicated',
          value: 'gpu',
          effect: 'NoSchedule',
          // No operator specified - defaults to Equal
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(true);
      });
    });

    describe('Exists operator', () => {
      it('should match when key matches regardless of value', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'dedicated',
          operator: 'Exists',
          effect: 'NoSchedule',
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(true);
      });

      it('should match taint without value when using Exists', () => {
        const taint: Taint = { key: 'maintenance', effect: 'NoExecute' };
        const toleration: Toleration = {
          key: 'maintenance',
          operator: 'Exists',
          effect: 'NoExecute',
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(true);
      });

      it('should not match when key differs', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          key: 'other-key',
          operator: 'Exists',
          effect: 'NoSchedule',
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(false);
      });
    });

    describe('Super-toleration (empty key with Exists)', () => {
      it('should match any taint when key is empty and operator is Exists', () => {
        const taints: Taint[] = [
          { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' },
          { key: 'maintenance', effect: 'NoExecute' },
          { key: 'cost', value: 'high', effect: 'PreferNoSchedule' },
        ];
        const superToleration: Toleration = { operator: 'Exists' };

        for (const taint of taints) {
          expect(tolerationMatchesTaint(superToleration, taint)).toBe(true);
        }
      });

      it('should still respect effect when specified in super-toleration', () => {
        const taint: Taint = { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' };
        const toleration: Toleration = {
          operator: 'Exists',
          effect: 'NoExecute', // Only match NoExecute taints
        };
        expect(tolerationMatchesTaint(toleration, taint)).toBe(false);
      });
    });
  });

  describe('toleratesTaints helper', () => {
    it('should return true when no taints exist', () => {
      const tolerations: Toleration[] = [];
      const taints: Taint[] = [];
      expect(toleratesTaints(tolerations, taints)).toBe(true);
    });

    it('should return true when all taints are tolerated', () => {
      const taints: Taint[] = [
        { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' },
        { key: 'maintenance', effect: 'NoExecute' },
      ];
      const tolerations: Toleration[] = [
        { key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' },
        { key: 'maintenance', operator: 'Exists', effect: 'NoExecute' },
      ];
      expect(toleratesTaints(tolerations, taints)).toBe(true);
    });

    it('should return false when any taint is not tolerated', () => {
      const taints: Taint[] = [
        { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' },
        { key: 'untolerated', effect: 'NoSchedule' },
      ];
      const tolerations: Toleration[] = [
        { key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' },
        // Missing toleration for 'untolerated' taint
      ];
      expect(toleratesTaints(tolerations, taints)).toBe(false);
    });

    it('should handle super-toleration matching all taints', () => {
      const taints: Taint[] = [
        { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' },
        { key: 'maintenance', effect: 'NoExecute' },
        { key: 'cost', value: 'high', effect: 'PreferNoSchedule' },
      ];
      const tolerations: Toleration[] = [CommonTolerations.all()];
      expect(toleratesTaints(tolerations, taints)).toBe(true);
    });
  });

  describe('getEvictionTaints helper', () => {
    it('should return empty array when no NoExecute taints exist', () => {
      const taints: Taint[] = [
        { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' },
        { key: 'cost', value: 'high', effect: 'PreferNoSchedule' },
      ];
      const tolerations: Toleration[] = [];
      expect(getEvictionTaints(tolerations, taints)).toEqual([]);
    });

    it('should return NoExecute taints that are not tolerated', () => {
      const taints: Taint[] = [
        { key: 'maintenance', effect: 'NoExecute' },
        { key: 'unreachable', effect: 'NoExecute' },
      ];
      const tolerations: Toleration[] = [
        { key: 'maintenance', operator: 'Exists', effect: 'NoExecute' },
      ];
      const evictionTaints = getEvictionTaints(tolerations, taints);
      expect(evictionTaints).toHaveLength(1);
      expect(evictionTaints[0].key).toBe('unreachable');
    });
  });

  describe('CommonTaints factory', () => {
    it('should create a not-ready taint', () => {
      const taint = CommonTaints.notReady();
      expect(taint.key).toBe('node.stark.io/not-ready');
      expect(taint.effect).toBe('NoSchedule');
    });

    it('should create a maintenance taint with NoExecute', () => {
      const taint = CommonTaints.maintenance();
      expect(taint.key).toBe('node.stark.io/maintenance');
      expect(taint.effect).toBe('NoExecute');
    });

    it('should create a dedicated taint with custom value', () => {
      const taint = CommonTaints.dedicated('gpu');
      expect(taint.key).toBe('dedicated');
      expect(taint.value).toBe('gpu');
      expect(taint.effect).toBe('NoSchedule');
    });
  });

  // ===========================================================================
  // NoSchedule Effect Tests
  // ===========================================================================

  describe('NoSchedule Taint Effect', () => {
    it('should reject pod without toleration from tainted node', () => {
      // Register a tainted node
      nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.dedicated('gpu')],
        },
        testUserId
      );

      // Create pod without tolerations
      const createResult = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Try to schedule - should fail because no nodes tolerate
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should schedule pod with matching toleration to tainted node', () => {
      // Register a tainted node
      nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.dedicated('gpu')],
        },
        testUserId
      );

      // Create pod with matching toleration
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [CommonTolerations.dedicated('gpu')],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Schedule should succeed
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      expect(scheduleResult.data?.scheduled).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.status).toBe('scheduled');
      expect(scheduledPod?.nodeId).toBeDefined();
    });

    it('should prefer untainted node when available', () => {
      // Register both tainted and untainted nodes
      nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.dedicated('gpu')],
          labels: { type: 'gpu' },
        },
        testUserId
      );

      const regularNodeResult = nodeManager.register(
        {
          name: 'regular-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { type: 'regular' },
        },
        testUserId
      );
      expect(regularNodeResult.success).toBe(true);
      const regularNodeId = regularNodeResult.data!.node.id;

      // Create pod without tolerations
      const createResult = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to untainted node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(regularNodeId);
    });

    it('should schedule to tainted node when it is the only option and pod tolerates', () => {
      // Register only a tainted node
      const gpuNodeResult = nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.dedicated('gpu')],
        },
        testUserId
      );
      expect(gpuNodeResult.success).toBe(true);
      const gpuNodeId = gpuNodeResult.data!.node.id;

      // Create pod that tolerates the taint
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [CommonTolerations.dedicated('gpu')],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to tainted node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(gpuNodeId);
    });
  });

  // ===========================================================================
  // PreferNoSchedule Effect Tests
  // ===========================================================================

  describe('PreferNoSchedule Taint Effect', () => {
    it('should schedule to node with PreferNoSchedule when no other option', () => {
      // Register only a node with PreferNoSchedule taint
      const preferNoScheduleNodeResult = nodeManager.register(
        {
          name: 'expensive-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [{ key: 'cost', value: 'high', effect: 'PreferNoSchedule' }],
        },
        testUserId
      );
      expect(preferNoScheduleNodeResult.success).toBe(true);
      const nodeId = preferNoScheduleNodeResult.data!.node.id;

      // Create pod without tolerations
      const createResult = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should still schedule to the node (PreferNoSchedule is a soft constraint)
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(nodeId);
    });

    it('should prefer node without PreferNoSchedule taint', () => {
      // Register node with PreferNoSchedule taint
      nodeManager.register(
        {
          name: 'expensive-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [{ key: 'cost', value: 'high', effect: 'PreferNoSchedule' }],
          labels: { type: 'expensive' },
        },
        testUserId
      );

      // Register node without taint
      const cheapNodeResult = nodeManager.register(
        {
          name: 'cheap-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { type: 'cheap' },
        },
        testUserId
      );
      expect(cheapNodeResult.success).toBe(true);
      const cheapNodeId = cheapNodeResult.data!.node.id;

      // Create pod without tolerations
      const createResult = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should prefer the untainted node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(cheapNodeId);
    });
  });

  // ===========================================================================
  // NoExecute Effect Tests
  // ===========================================================================

  describe('NoExecute Taint Effect', () => {
    it('should reject pod without toleration from NoExecute tainted node', () => {
      // Register a node with NoExecute taint
      nodeManager.register(
        {
          name: 'maintenance-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.maintenance()],
        },
        testUserId
      );

      // Create pod without tolerations
      const createResult = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should not schedule to node with NoExecute taint
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should schedule pod with maintenance toleration to maintenance node', () => {
      // Register a node with NoExecute maintenance taint
      const maintenanceNodeResult = nodeManager.register(
        {
          name: 'maintenance-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.maintenance()],
        },
        testUserId
      );
      expect(maintenanceNodeResult.success).toBe(true);
      const nodeId = maintenanceNodeResult.data!.node.id;

      // Create pod with maintenance toleration
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [CommonTolerations.maintenance()],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to maintenance node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(nodeId);
    });
  });

  // ===========================================================================
  // Multiple Taints Tests
  // ===========================================================================

  describe('Multiple Taints', () => {
    it('should require tolerations for all taints', () => {
      // Register a node with multiple taints
      nodeManager.register(
        {
          name: 'multi-taint-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [
            CommonTaints.dedicated('gpu'),
            { key: 'special', value: 'workload', effect: 'NoSchedule' },
          ],
        },
        testUserId
      );

      // Create pod with only one toleration
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [CommonTolerations.dedicated('gpu')],
          // Missing toleration for 'special' taint
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should not schedule - missing toleration for 'special' taint
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should schedule when all taints are tolerated', () => {
      // Register a node with multiple taints
      const multiTaintNodeResult = nodeManager.register(
        {
          name: 'multi-taint-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [
            CommonTaints.dedicated('gpu'),
            { key: 'special', value: 'workload', effect: 'NoSchedule' },
          ],
        },
        testUserId
      );
      expect(multiTaintNodeResult.success).toBe(true);
      const nodeId = multiTaintNodeResult.data!.node.id;

      // Create pod with all required tolerations
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [
            CommonTolerations.dedicated('gpu'),
            { key: 'special', operator: 'Equal', value: 'workload', effect: 'NoSchedule' },
          ],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule successfully
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(nodeId);
    });

    it('should schedule with super-toleration to node with any taints', () => {
      // Register a node with multiple taints
      const heavilyTaintedNodeResult = nodeManager.register(
        {
          name: 'heavily-tainted-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [
            CommonTaints.dedicated('gpu'),
            CommonTaints.maintenance(),
            { key: 'custom', value: 'taint', effect: 'NoSchedule' },
          ],
        },
        testUserId
      );
      expect(heavilyTaintedNodeResult.success).toBe(true);
      const nodeId = heavilyTaintedNodeResult.data!.node.id;

      // Create pod with super-toleration
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [CommonTolerations.all()],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule successfully
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(nodeId);
    });
  });

  // ===========================================================================
  // Dynamic Taint Addition Tests
  // ===========================================================================

  describe('Dynamic Taint Management', () => {
    it('should add taint to node dynamically', () => {
      // Register a clean node
      const nodeResult = nodeManager.register(
        {
          name: 'clean-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      expect(nodeResult.success).toBe(true);
      const nodeId = nodeResult.data!.node.id;

      // Add a taint to the node
      const taintResult = nodeManager.addTaint(nodeId, CommonTaints.maintenance());
      expect(taintResult.success).toBe(true);

      // Verify the node now has the taint
      const nodeInfo = nodeManager.getNode(nodeId);
      expect(nodeInfo.success).toBe(true);
      expect(nodeInfo.data?.node.taints).toHaveLength(1);
      expect(nodeInfo.data?.node.taints[0].key).toBe('node.stark.io/maintenance');
    });

    it('should remove taint from node dynamically', () => {
      // Register a node with a taint
      const nodeResult = nodeManager.register(
        {
          name: 'tainted-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.dedicated('gpu')],
        },
        testUserId
      );
      expect(nodeResult.success).toBe(true);
      const nodeId = nodeResult.data!.node.id;

      // Remove the taint
      const removeTaintResult = nodeManager.removeTaint(nodeId, 'dedicated', 'NoSchedule');
      expect(removeTaintResult.success).toBe(true);

      // Verify the taint is removed
      const nodeInfo = nodeManager.getNode(nodeId);
      expect(nodeInfo.success).toBe(true);
      expect(nodeInfo.data?.node.taints).toHaveLength(0);
    });

    it('should allow scheduling after taint is removed', () => {
      // Register a node with a taint
      const nodeResult = nodeManager.register(
        {
          name: 'tainted-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [CommonTaints.dedicated('gpu')],
        },
        testUserId
      );
      expect(nodeResult.success).toBe(true);
      const nodeId = nodeResult.data!.node.id;

      // Create pod without tolerations
      const createResult = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should fail to schedule initially
      const firstScheduleResult = scheduler.schedule(pod.id);
      expect(firstScheduleResult.success).toBe(false);

      // Remove the taint
      nodeManager.removeTaint(nodeId, 'dedicated', 'NoSchedule');

      // Reset pod to pending for rescheduling
      // Note: This tests the scenario where taint removal allows new scheduling
      const createResult2 = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult2.success).toBe(true);
      const pod2 = createResult2.data!.pod;

      // Now should schedule successfully
      const secondScheduleResult = scheduler.schedule(pod2.id);
      expect(secondScheduleResult.success).toBe(true);
      expect(secondScheduleResult.data?.nodeId).toBe(nodeId);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle node with empty taints array', () => {
      // Register a node with explicit empty taints
      const nodeResult = nodeManager.register(
        {
          name: 'no-taint-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [],
        },
        testUserId
      );
      expect(nodeResult.success).toBe(true);
      const nodeId = nodeResult.data!.node.id;

      // Create pod without tolerations
      const createResult = scheduler.create(
        { packId: testPackId },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule successfully
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      expect(scheduleResult.data?.nodeId).toBe(nodeId);
    });

    it('should handle pod with empty tolerations array', () => {
      // Register untainted node
      const nodeResult = nodeManager.register(
        {
          name: 'clean-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      expect(nodeResult.success).toBe(true);
      const nodeId = nodeResult.data!.node.id;

      // Create pod with explicit empty tolerations
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule successfully
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      expect(scheduleResult.data?.nodeId).toBe(nodeId);
    });

    it('should handle taint with undefined value', () => {
      // Register node with taint that has no value
      const nodeResult = nodeManager.register(
        {
          name: 'key-only-taint-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          taints: [{ key: 'special', effect: 'NoSchedule' }],
        },
        testUserId
      );
      expect(nodeResult.success).toBe(true);
      const nodeId = nodeResult.data!.node.id;

      // Create pod with Exists toleration (should match key-only taint)
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [{ key: 'special', operator: 'Exists', effect: 'NoSchedule' }],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule successfully
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      expect(scheduleResult.data?.nodeId).toBe(nodeId);
    });

    it('should combine taints with runtime compatibility', () => {
      // Register browser node with taint
      nodeManager.register(
        {
          name: 'browser-tainted-node',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
          taints: [CommonTaints.dedicated('frontend')],
        },
        testUserId
      );

      // Create pod for node runtime (pack is node-tagged)
      // Even with toleration, should fail due to runtime mismatch
      const createResult = scheduler.create(
        {
          packId: testPackId,
          tolerations: [{ key: 'dedicated', operator: 'Equal', value: 'frontend', effect: 'NoSchedule' }],
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should fail - runtime mismatch takes precedence
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });
  });
});
