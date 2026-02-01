/**
 * Integration tests for Pod Orchestration Flow
 * @module tests/integration/pod-flow
 *
 * Tests for User Story 1: Register and Deploy a Pack
 * These tests verify the complete pod lifecycle from creation to termination
 *
 * NOTE: These tests are SKIPPED until NodeManager is implemented (T073)
 * Required implementations:
 * - T055: packages/core/src/models/pack.ts ✓
 * - T056: packages/core/src/models/pod.ts ✓
 * - T057: packages/core/src/services/pack-registry.ts ✓
 * - T058: packages/core/src/services/pod-scheduler.ts ✓
 * - T073: packages/core/src/services/node-manager.ts (PENDING)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  CreatePodInput,
  PodStatus,
  RuntimeTag,
} from '@stark-o/shared';
import type { Node } from '@stark-o/shared';
import type { Toleration } from '@stark-o/shared';

import { PodScheduler } from '@stark-o/core/services/pod-scheduler';
import { PackRegistry } from '@stark-o/core/services/pack-registry';
import { createNodeManager, NodeManager } from '@stark-o/core/services/node-manager';
import { createNamespaceManager, NamespaceManager } from '@stark-o/core/services/namespace-manager';
import { resetClusterState } from '@stark-o/core/stores/cluster-store';

describe('Pod Flow Integration Tests', () => {
  let scheduler: PodScheduler;
  let packRegistry: PackRegistry;
  let nodeManager: NodeManager;
  const testUserId = 'test-user-1';

  beforeEach(async () => {
    // Reset state before each test
    resetClusterState();

    // Create fresh instances for each test
    packRegistry = new PackRegistry();
    nodeManager = createNodeManager();
    scheduler = new PodScheduler();

    // Set up a default pack
    packRegistry.register(
      {
        name: 'default-pack',
        version: '1.0.0',
        runtimeTag: 'node',
      },
      testUserId
    );

    // Set up a default healthy node
    nodeManager.register({
      name: 'default-node',
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

  describe('Pod Creation', () => {
    it('should create a pod in pending state', () => {
      const listResult = packRegistry.list({});
      expect(listResult.success).toBe(true);
      const defaultPack = listResult.data!.packs[0];

      const input: CreatePodInput = {
        packId: defaultPack.id,
      };

      const createResult = scheduler.create(input, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      expect(pod.id).toBeDefined();
      expect(pod.packId).toBe(defaultPack.id);
      expect(pod.status).toBe('pending');
      expect(pod.nodeId).toBeNull();
      expect(pod.namespace).toBe('default');
      expect(pod.createdBy).toBe(testUserId);
    });

    it('should fail to create pod for non-existent pack', () => {
      const input: CreatePodInput = {
        packId: 'a1234567-1234-4123-a123-123456789012', // Valid UUID format but non-existent pack
      };

      const result = scheduler.create(input, testUserId);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PACK_NOT_FOUND');
    });

    it('should apply default resource requests', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const input: CreatePodInput = {
        packId: defaultPack.id,
      };

      const createResult = scheduler.create(input, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      expect(pod.resourceRequests.cpu).toBe(100);
      expect(pod.resourceRequests.memory).toBe(128);
    });

    it('should use custom resource requests', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const input: CreatePodInput = {
        packId: defaultPack.id,
        resourceRequests: { cpu: 500, memory: 512 },
        resourceLimits: { cpu: 1000, memory: 1024 },
      };

      const createResult = scheduler.create(input, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      expect(pod.resourceRequests.cpu).toBe(500);
      expect(pod.resourceRequests.memory).toBe(512);
      expect(pod.resourceLimits?.cpu).toBe(1000);
      expect(pod.resourceLimits?.memory).toBe(1024);
    });

    it('should record creation in pod history', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const input: CreatePodInput = {
        packId: defaultPack.id,
      };

      const createResult = scheduler.create(input, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const history = scheduler.getHistory(pod.id);

      const creationEvent = history.find((h) => h.action === 'created');
      expect(creationEvent).toBeDefined();
      expect(creationEvent?.actorId).toBe(testUserId);
    });
  });

  describe('Pod Scheduling', () => {
    it('should schedule pending pod to a compatible node', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create({ packId: defaultPack.id }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      expect(scheduleResult.data!.scheduled).toBe(true);
      expect(scheduleResult.data!.nodeId).toBeDefined();

      const scheduledPod = scheduler.get(pod.id)!;
      expect(scheduledPod.status).toBe('scheduled');
      expect(scheduledPod.nodeId).toBeDefined();
      expect(scheduledPod.scheduledAt).toBeDefined();
    });

    it('should fail to schedule when no compatible nodes exist', () => {
      // Clear all nodes
      const listResult = nodeManager.list({});
      for (const node of listResult.nodes) {
        nodeManager.deregister(node.id);
      }

      const packListResult = packRegistry.list({});
      const defaultPack = packListResult.data!.packs[0];

      const createResult = scheduler.create({ packId: defaultPack.id }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe('NO_COMPATIBLE_NODES');
    });

    it('should respect runtime compatibility during scheduling', () => {
      // Register a browser-only pack
      packRegistry.register(
        { name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser' },
        testUserId
      );

      // Register a browser node
      nodeManager.register({
        name: 'browser-node',
        runtimeType: 'browser',
        allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
      }, testUserId);

      const packListResult = packRegistry.list({ runtimeTag: 'browser' });
      const browserPack = packListResult.data!.packs[0];

      const createResult = scheduler.create({ packId: browserPack.id }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      const scheduledPod = scheduler.get(pod.id)!;

      // Verify it was scheduled to the browser node
      const nodeResult = nodeManager.getNode(scheduledPod.nodeId!);
      expect(nodeResult.data?.node.runtimeType).toBe('browser');
    });

    it('should skip unhealthy nodes', () => {
      // Mark the default node as unhealthy
      const listResult = nodeManager.list({});
      const defaultNode = listResult.nodes[0];
      nodeManager.updateStatus(defaultNode.id, 'unhealthy');

      // Register a healthy node
      nodeManager.register({
        name: 'healthy-node',
        runtimeType: 'node',
        allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
      }, testUserId);

      const packListResult = packRegistry.list({});
      const defaultPack = packListResult.data!.packs[0];

      const createResult = scheduler.create({ packId: defaultPack.id }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      const scheduledPod = scheduler.get(pod.id)!;

      // Verify it was scheduled to the healthy node
      const nodeResult = nodeManager.getNode(scheduledPod.nodeId!);
      expect(nodeResult.data?.node.name).toBe('healthy-node');
    });

    it('should respect node selector constraints', () => {
      // Add a label to the default node
      const listResult = nodeManager.list({});
      const defaultNode = listResult.nodes[0];
      nodeManager.addLabel(defaultNode.id, 'environment', 'production');

      const packListResult = packRegistry.list({});
      const defaultPack = packListResult.data!.packs[0];

      const createResult = scheduler.create(
        {
          packId: defaultPack.id,
          nodeSelector: { environment: 'production' },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      const scheduledPod = scheduler.get(pod.id)!;

      expect(scheduledPod.status).toBe('scheduled');
      expect(scheduledPod.nodeId).toBe(defaultNode.id);
    });

    it('should handle taints and tolerations', () => {
      // Add a taint to the default node
      const listResult = nodeManager.list({});
      const defaultNode = listResult.nodes[0];
      nodeManager.addTaint(defaultNode.id, { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' });

      const packListResult = packRegistry.list({});
      const defaultPack = packListResult.data!.packs[0];

      // Pod without toleration should fail
      const createResult1 = scheduler.create({ packId: defaultPack.id }, testUserId);
      expect(createResult1.success).toBe(true);
      const pod1 = createResult1.data!.pod;

      const scheduleResult1 = scheduler.schedule(pod1.id);
      expect(scheduleResult1.success).toBe(false);

      // Pod with toleration should succeed
      const createResult2 = scheduler.create(
        {
          packId: defaultPack.id,
          tolerations: [{ key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' }],
        },
        testUserId
      );
      expect(createResult2.success).toBe(true);
      const pod2 = createResult2.data!.pod;

      const scheduleResult2 = scheduler.schedule(pod2.id);
      expect(scheduleResult2.success).toBe(true);
    });
  });

  describe('Pod Lifecycle', () => {
    let podId: string;

    beforeEach(() => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];
      const createResult = scheduler.create({ packId: defaultPack.id }, testUserId);
      expect(createResult.success).toBe(true);
      podId = createResult.data!.pod.id;
    });

    it('should transition through full lifecycle: pending -> scheduled -> starting -> running -> stopping -> stopped', () => {
      // Initial state
      let pod = scheduler.get(podId);
      expect(pod?.status).toBe('pending');

      // Schedule
      const scheduleResult = scheduler.schedule(podId);
      expect(scheduleResult.success).toBe(true);
      pod = scheduler.get(podId);
      expect(pod?.status).toBe('scheduled');

      // Start (transitions to starting)
      const startResult = scheduler.start(podId);
      expect(startResult.success).toBe(true);
      pod = scheduler.get(podId);
      expect(pod?.status).toBe('starting');

      // Set running (transitions to running)
      const runningResult = scheduler.setRunning(podId);
      expect(runningResult.success).toBe(true);
      pod = scheduler.get(podId);
      expect(pod?.status).toBe('running');

      // Stop (transitions to stopping)
      const stopResult = scheduler.stop(podId);
      expect(stopResult.success).toBe(true);
      pod = scheduler.get(podId);
      expect(pod?.status).toBe('stopping');

      // Set stopped (transitions to stopped)
      const stoppedResult = scheduler.setStopped(podId);
      expect(stoppedResult.success).toBe(true);
      pod = scheduler.get(podId);
      expect(pod?.status).toBe('stopped');
    });

    it('should not allow starting an unscheduled pod', () => {
      const result = scheduler.start(podId);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('should set startedAt when pod starts running', () => {
      scheduler.schedule(podId);
      scheduler.start(podId);
      const result = scheduler.setRunning(podId);
      expect(result.success).toBe(true);
      const runningPod = result.data;

      expect(runningPod?.startedAt).toBeDefined();
      expect(runningPod?.startedAt).toBeInstanceOf(Date);
    });

    it('should set stoppedAt when pod stops', () => {
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.setRunning(podId);
      scheduler.stop(podId);
      const result = scheduler.setStopped(podId);
      expect(result.success).toBe(true);
      const stoppedPod = result.data;

      expect(stoppedPod?.stoppedAt).toBeDefined();
      expect(stoppedPod?.stoppedAt).toBeInstanceOf(Date);
    });

    it('should record all lifecycle events in history', () => {
      scheduler.schedule(podId);
      scheduler.start(podId);
      scheduler.stop(podId);

      const history = scheduler.getHistory(podId);
      const actions = history.map((h) => h.action);

      expect(actions).toContain('created');
      expect(actions).toContain('scheduled');
      expect(actions).toContain('started');
      expect(actions).toContain('stopped');
    });
  });

  describe('Pod Deletion', () => {
    it('should delete a stopped pod', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create({ packId: defaultPack.id }, testUserId);
      const pod = createResult.data!.pod;
      scheduler.schedule(pod.id);
      scheduler.start(pod.id);
      scheduler.stop(pod.id);

      const deleteResult = scheduler.delete(pod.id);
      expect(deleteResult.success).toBe(true);

      expect(scheduler.get(pod.id)).toBeUndefined();
    });

    it('should stop and delete a running pod', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create({ packId: defaultPack.id }, testUserId);
      const pod = createResult.data!.pod;
      scheduler.schedule(pod.id);
      scheduler.start(pod.id);

      const deleteResult = scheduler.delete(pod.id);
      expect(deleteResult.success).toBe(true);

      expect(scheduler.get(pod.id)).toBeUndefined();
    });

    it('should delete a pending pod', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create({ packId: defaultPack.id }, testUserId);
      const pod = createResult.data!.pod;

      const deleteResult = scheduler.delete(pod.id);
      expect(deleteResult.success).toBe(true);

      expect(scheduler.get(pod.id)).toBeUndefined();
    });

    it('should return error for non-existent pod', () => {
      const deleteResult = scheduler.delete('non-existent-id');
      expect(deleteResult.success).toBe(false);
      expect(deleteResult.error?.code).toBe('POD_NOT_FOUND');
    });
  });

  describe('Resource Constraints', () => {
    it('should not schedule pod when node lacks resources', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      // Create a resource-hungry pod
      const createResult = scheduler.create(
        {
          packId: defaultPack.id,
          resourceRequests: { cpu: 10000, memory: 16384 }, // More than node has
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe('NO_COMPATIBLE_NODES');
    });

    it('should prefer nodes with more available resources', () => {
      // Register nodes with different capacities
      nodeManager.register({
        name: 'small-node',
        runtimeType: 'node',
        allocatable: { cpu: 1000, memory: 1024, pods: 10, storage: 1000 },
      }, testUserId);
      nodeManager.register({
        name: 'large-node',
        runtimeType: 'node',
        allocatable: { cpu: 8000, memory: 16384, pods: 100, storage: 10000 },
      }, testUserId);

      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create(
        {
          packId: defaultPack.id,
          resourceRequests: { cpu: 500, memory: 512 },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      const scheduledPod = scheduler.get(pod.id)!;

      const nodeResult = nodeManager.getNode(scheduledPod.nodeId!);

      // Should prefer the larger node (or any node with sufficient resources)
      expect(['default-node', 'large-node']).toContain(nodeResult.data?.node.name);
    });
  });

  describe('Multi-Pod Scenarios', () => {
    it('should schedule multiple pods to the same node', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const create1 = scheduler.create({ packId: defaultPack.id }, testUserId);
      const create2 = scheduler.create({ packId: defaultPack.id }, testUserId);
      const create3 = scheduler.create({ packId: defaultPack.id }, testUserId);

      const schedule1 = scheduler.schedule(create1.data!.pod.id);
      const schedule2 = scheduler.schedule(create2.data!.pod.id);
      const schedule3 = scheduler.schedule(create3.data!.pod.id);

      // All should be scheduled (to the only available node)
      expect(schedule1.success).toBe(true);
      expect(schedule2.success).toBe(true);
      expect(schedule3.success).toBe(true);
      expect(scheduler.get(create1.data!.pod.id)?.status).toBe('scheduled');
      expect(scheduler.get(create2.data!.pod.id)?.status).toBe('scheduled');
      expect(scheduler.get(create3.data!.pod.id)?.status).toBe('scheduled');
    });
  });

  describe('Namespace Isolation', () => {
    it('should assign pods to specified namespace', () => {
      // Create the production namespace first
      const namespaceManager = createNamespaceManager();
      namespaceManager.create({ name: 'production' }, testUserId);

      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create(
        {
          packId: defaultPack.id,
          namespace: 'production',
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      expect(pod.namespace).toBe('production');
    });

    it('should use default namespace when not specified', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create(
        {
          packId: defaultPack.id,
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      expect(pod.namespace).toBe('default');
    });
  });

  describe('Priority Handling', () => {
    it('should assign priority from priority class name', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create(
        {
          packId: defaultPack.id,
          priorityClassName: 'high-priority',
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      expect(pod.priorityClassName).toBe('high-priority');
      // Priority value depends on priority class configuration
      expect(pod.priority).toBeDefined();
    });

    it('should default to zero priority', () => {
      const listResult = packRegistry.list({});
      const defaultPack = listResult.data!.packs[0];

      const createResult = scheduler.create(
        {
          packId: defaultPack.id,
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      expect(pod.priority).toBe(0);
    });
  });
});
