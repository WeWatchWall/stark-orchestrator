/**
 * Integration tests for Runtime-Targeted Pack Deployment
 * @module tests/integration/runtime-targeting
 *
 * Tests for User Story 5: Runtime-Targeted Pack Deployment
 * These tests verify that runtime compatibility is enforced between packs and nodes
 *
 * Key scenarios tested:
 * 1. Node-tagged pack can only deploy to node runtime nodes
 * 2. Browser-tagged pack can only deploy to browser runtime nodes
 * 3. Universal packs can deploy to any runtime
 * 4. Clear error messages when runtime is incompatible
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CreatePodInput } from '@stark-o/shared';
import { isRuntimeCompatible } from '@stark-o/shared';

import { PodScheduler, PodSchedulerErrorCodes } from '@stark-o/core/services/pod-scheduler';
import { PackRegistry } from '@stark-o/core/services/pack-registry';
import { createNodeManager, NodeManager } from '@stark-o/core/services/node-manager';
import { resetClusterState } from '@stark-o/core/stores/cluster-store';

describe('Runtime Targeting Integration Tests', () => {
  let scheduler: PodScheduler;
  let packRegistry: PackRegistry;
  let nodeManager: NodeManager;
  const testUserId = 'test-user-runtime';

  beforeEach(() => {
    // Reset state before each test
    resetClusterState();

    // Create fresh instances for each test
    packRegistry = new PackRegistry();
    nodeManager = createNodeManager();
    scheduler = new PodScheduler();
  });

  afterEach(() => {
    nodeManager.dispose();
  });

  describe('isRuntimeCompatible helper', () => {
    it('should return true when pack tag matches node runtime', () => {
      expect(isRuntimeCompatible('node', 'node')).toBe(true);
      expect(isRuntimeCompatible('browser', 'browser')).toBe(true);
    });

    it('should return false when pack tag does not match node runtime', () => {
      expect(isRuntimeCompatible('node', 'browser')).toBe(false);
      expect(isRuntimeCompatible('browser', 'node')).toBe(false);
    });

    it('should return true for universal packs on any runtime', () => {
      expect(isRuntimeCompatible('universal', 'node')).toBe(true);
      expect(isRuntimeCompatible('universal', 'browser')).toBe(true);
    });
  });

  describe('Node-tagged Pack Targeting', () => {
    let nodePackId: string;

    beforeEach(() => {
      // Register a node-tagged pack
      const result = packRegistry.register(
        { name: 'node-only-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(result.success).toBe(true);
      nodePackId = result.data!.pack.id;
    });

    it('should deploy node-tagged pack to node runtime node', () => {
      // Register a node runtime node
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: nodePackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      expect(scheduleResult.data?.scheduled).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.status).toBe('scheduled');
      expect(scheduledPod?.nodeId).toBeDefined();
    });

    it('should reject node-tagged pack on browser runtime node', () => {
      // Only register a browser runtime node
      nodeManager.register(
        {
          name: 'browser-client',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: nodePackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
      expect(scheduleResult.error?.message).toContain('No compatible nodes');
      expect(scheduleResult.error?.details?.packRuntimeTag).toBe('node');
    });

    it('should select node runtime node when both runtime types available', () => {
      // Register both types of nodes
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      nodeManager.register(
        {
          name: 'browser-client',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: nodePackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBeDefined();

      // Verify it was scheduled to the node runtime
      const nodeResult = nodeManager.getNode(scheduledPod!.nodeId!);
      expect(nodeResult.data?.node.runtimeType).toBe('node');
    });
  });

  describe('Browser-tagged Pack Targeting', () => {
    let browserPackId: string;

    beforeEach(() => {
      // Register a browser-tagged pack
      const result = packRegistry.register(
        { name: 'browser-only-pack', version: '1.0.0', runtimeTag: 'browser' },
        testUserId
      );
      expect(result.success).toBe(true);
      browserPackId = result.data!.pack.id;
    });

    it('should deploy browser-tagged pack to browser runtime node', () => {
      // Register a browser runtime node
      nodeManager.register(
        {
          name: 'browser-client',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: browserPackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);
      expect(scheduleResult.data?.scheduled).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.status).toBe('scheduled');
    });

    it('should reject browser-tagged pack on node runtime node', () => {
      // Only register a node runtime node
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: browserPackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
      expect(scheduleResult.error?.message).toContain('No compatible nodes');
      expect(scheduleResult.error?.details?.packRuntimeTag).toBe('browser');
    });

    it('should select browser runtime node when both runtime types available', () => {
      // Register both types of nodes
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      nodeManager.register(
        {
          name: 'browser-client',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: browserPackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBeDefined();

      // Verify it was scheduled to the browser runtime
      const nodeResult = nodeManager.getNode(scheduledPod!.nodeId!);
      expect(nodeResult.data?.node.runtimeType).toBe('browser');
    });
  });

  describe('Universal Pack Targeting', () => {
    let universalPackId: string;

    beforeEach(() => {
      // Register a universal pack
      const result = packRegistry.register(
        { name: 'universal-pack', version: '1.0.0', runtimeTag: 'universal' },
        testUserId
      );
      expect(result.success).toBe(true);
      universalPackId = result.data!.pack.id;
    });

    it('should deploy universal pack to node runtime node', () => {
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: universalPackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const nodeResult = nodeManager.getNode(scheduler.get(pod.id)!.nodeId!);
      expect(nodeResult.data?.node.runtimeType).toBe('node');
    });

    it('should deploy universal pack to browser runtime node', () => {
      nodeManager.register(
        {
          name: 'browser-client',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: universalPackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const nodeResult = nodeManager.getNode(scheduler.get(pod.id)!.nodeId!);
      expect(nodeResult.data?.node.runtimeType).toBe('browser');
    });

    it('should prefer node runtime for universal packs when both available', () => {
      // Register both types of nodes
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      nodeManager.register(
        {
          name: 'browser-client',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      const createResult = scheduler.create({ packId: universalPackId }, testUserId);
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      const nodeResult = nodeManager.getNode(scheduledPod!.nodeId!);
      // Universal packs should prefer 'node' runtime
      expect(nodeResult.data?.node.runtimeType).toBe('node');
    });
  });

  describe('Runtime Compatibility Error Messages', () => {
    it('should provide clear error when no compatible runtime nodes exist', () => {
      // Register a node-only pack
      const packResult = packRegistry.register(
        { name: 'node-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(packResult.success).toBe(true);

      // Register only browser nodes
      nodeManager.register(
        {
          name: 'browser-node-1',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );
      nodeManager.register(
        {
          name: 'browser-node-2',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      const createResult = scheduler.create(
        { packId: packResult.data!.pack.id },
        testUserId
      );
      expect(createResult.success).toBe(true);

      const scheduleResult = scheduler.schedule(createResult.data!.pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error).toBeDefined();
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
      expect(scheduleResult.error?.message).toContain('No compatible nodes');

      // Error details should include runtime information
      expect(scheduleResult.error?.details).toBeDefined();
      expect(scheduleResult.error?.details?.packRuntimeTag).toBe('node');
      expect(scheduleResult.error?.details?.requiredRuntime).toBe('node');
    });

    it('should provide clear error for browser pack with only node nodes', () => {
      // Register a browser-only pack
      const packResult = packRegistry.register(
        { name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser' },
        testUserId
      );
      expect(packResult.success).toBe(true);

      // Register only node nodes
      nodeManager.register(
        {
          name: 'node-server-1',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      const createResult = scheduler.create(
        { packId: packResult.data!.pack.id },
        testUserId
      );
      expect(createResult.success).toBe(true);

      const scheduleResult = scheduler.schedule(createResult.data!.pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
      expect(scheduleResult.error?.details?.packRuntimeTag).toBe('browser');
      expect(scheduleResult.error?.details?.requiredRuntime).toBe('browser');
    });
  });

  describe('Multiple Pod Scheduling with Mixed Runtimes', () => {
    it('should correctly distribute pods across appropriate runtime nodes', () => {
      // Register both types of packs
      const nodePackResult = packRegistry.register(
        { name: 'node-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      const browserPackResult = packRegistry.register(
        { name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser' },
        testUserId
      );
      expect(nodePackResult.success).toBe(true);
      expect(browserPackResult.success).toBe(true);

      // Register both types of nodes
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      nodeManager.register(
        {
          name: 'browser-client',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );

      // Create and schedule node pack pod
      const nodeCreateResult = scheduler.create(
        { packId: nodePackResult.data!.pack.id },
        testUserId
      );
      expect(nodeCreateResult.success).toBe(true);
      const nodeScheduleResult = scheduler.schedule(nodeCreateResult.data!.pod.id);
      expect(nodeScheduleResult.success).toBe(true);

      // Create and schedule browser pack pod
      const browserCreateResult = scheduler.create(
        { packId: browserPackResult.data!.pack.id },
        testUserId
      );
      expect(browserCreateResult.success).toBe(true);
      const browserScheduleResult = scheduler.schedule(browserCreateResult.data!.pod.id);
      expect(browserScheduleResult.success).toBe(true);

      // Verify correct targeting
      const nodePod = scheduler.get(nodeCreateResult.data!.pod.id);
      const browserPod = scheduler.get(browserCreateResult.data!.pod.id);

      const nodeNode = nodeManager.getNode(nodePod!.nodeId!);
      const browserNode = nodeManager.getNode(browserPod!.nodeId!);

      expect(nodeNode.data?.node.runtimeType).toBe('node');
      expect(browserNode.data?.node.runtimeType).toBe('browser');
    });
  });

  describe('Runtime Targeting with Node Availability', () => {
    it('should not schedule to unhealthy compatible nodes', () => {
      // Register a node pack
      const packResult = packRegistry.register(
        { name: 'node-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );

      // Register two node runtime nodes
      nodeManager.register(
        {
          name: 'unhealthy-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      nodeManager.register(
        {
          name: 'healthy-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      // Mark first node as unhealthy
      const nodeList = nodeManager.list({});
      const unhealthyNode = nodeList.nodes.find((n) => n.name === 'unhealthy-node');
      nodeManager.updateStatus(unhealthyNode!.id, 'unhealthy');

      // Schedule pod
      const createResult = scheduler.create(
        { packId: packResult.data!.pack.id },
        testUserId
      );
      const scheduleResult = scheduler.schedule(createResult.data!.pod.id);
      expect(scheduleResult.success).toBe(true);

      // Should be scheduled to healthy node
      const pod = scheduler.get(createResult.data!.pod.id);
      const nodeResult = nodeManager.getNode(pod!.nodeId!);
      expect(nodeResult.data?.node.name).toBe('healthy-node');
    });

    it('should fail if only incompatible healthy nodes exist', () => {
      // Register a browser pack
      const packResult = packRegistry.register(
        { name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser' },
        testUserId
      );

      // Register browser node (unhealthy) and node node (healthy)
      nodeManager.register(
        {
          name: 'browser-node',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
        },
        testUserId
      );
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      // Mark browser node as unhealthy
      const nodeList = nodeManager.list({});
      const browserNode = nodeList.nodes.find((n) => n.name === 'browser-node');
      nodeManager.updateStatus(browserNode!.id, 'unhealthy');

      // Schedule pod - should fail because the only compatible node is unhealthy
      const createResult = scheduler.create(
        { packId: packResult.data!.pack.id },
        testUserId
      );
      const scheduleResult = scheduler.schedule(createResult.data!.pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });
  });

  describe('Runtime Targeting with Rollback', () => {
    it('should verify runtime compatibility during rollback', async () => {
      // Register a node with node runtime
      nodeManager.register(
        {
          name: 'node-server',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      // Register pack v1 and v2
      const v1Result = packRegistry.register(
        { name: 'versioned-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(v1Result.success).toBe(true);

      const v2Result = packRegistry.register(
        { name: 'versioned-pack', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(v2Result.success).toBe(true);

      // Create and schedule pod with v2
      const createResult = scheduler.create(
        {
          packId: v2Result.data!.pack.id,
          packVersion: '2.0.0',
        },
        testUserId
      );
      expect(createResult.success).toBe(true);

      const scheduleResult = scheduler.schedule(createResult.data!.pod.id);
      expect(scheduleResult.success).toBe(true);

      // Start and set running
      scheduler.start(createResult.data!.pod.id);
      scheduler.setRunning(createResult.data!.pod.id);

      // Rollback to v1
      const rollbackResult = scheduler.rollback(createResult.data!.pod.id, '1.0.0');
      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.data?.previousVersion).toBe('2.0.0');
      expect(rollbackResult.data?.newVersion).toBe('1.0.0');
    });
  });
});
