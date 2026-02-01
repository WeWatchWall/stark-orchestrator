/**
 * Integration tests for Node Affinity Scheduling
 * @module tests/integration/node-affinity
 *
 * Tests for User Story 6: Kubernetes-Like Scheduling & Isolation
 * These tests verify that node affinity rules work correctly for pod scheduling
 *
 * TDD: These tests are written FIRST and will FAIL until T118v is fully implemented.
 *
 * Key scenarios tested:
 * 1. Required node affinity (requiredDuringSchedulingIgnoredDuringExecution)
 * 2. Preferred node affinity (preferredDuringSchedulingIgnoredDuringExecution)
 * 3. Node selector term matching with In, NotIn, Exists, DoesNotExist, Gt, Lt operators
 * 4. Multiple node selector terms (OR logic)
 * 5. Multiple match expressions within a term (AND logic)
 * 6. Weighted preferences affect node scoring
 * 7. Combination of required and preferred affinity
 * 8. Simple nodeSelector shorthand
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  NodeAffinity,
  NodeSelectorTerm,
  NodeSelectorRequirement,
  PreferredSchedulingTerm,
  CreatePodInput,
} from '@stark-o/shared';
import {
  matchesRequirement,
  matchesNodeSelectorTerm,
  calculateAffinityScore,
} from '@stark-o/shared';

import { PodScheduler, PodSchedulerErrorCodes } from '@stark-o/core/services/pod-scheduler';
import { PackRegistry } from '@stark-o/core/services/pack-registry';
import { createNodeManager, NodeManager } from '@stark-o/core/services/node-manager';
import { resetClusterState } from '@stark-o/core/stores/cluster-store';

describe('Node Affinity Integration Tests', () => {
  let scheduler: PodScheduler;
  let packRegistry: PackRegistry;
  let nodeManager: NodeManager;
  const testUserId = 'test-user-affinity';
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
  // Helper Function Tests
  // ===========================================================================

  describe('matchesRequirement helper', () => {
    describe('In operator', () => {
      it('should match when value is in the list', () => {
        const req: NodeSelectorRequirement = {
          key: 'zone',
          operator: 'In',
          values: ['us-west-1', 'us-west-2'],
        };
        expect(matchesRequirement('us-west-1', req)).toBe(true);
        expect(matchesRequirement('us-west-2', req)).toBe(true);
      });

      it('should not match when value is not in the list', () => {
        const req: NodeSelectorRequirement = {
          key: 'zone',
          operator: 'In',
          values: ['us-west-1', 'us-west-2'],
        };
        expect(matchesRequirement('us-east-1', req)).toBe(false);
      });

      it('should not match when value is undefined', () => {
        const req: NodeSelectorRequirement = {
          key: 'zone',
          operator: 'In',
          values: ['us-west-1'],
        };
        expect(matchesRequirement(undefined, req)).toBe(false);
      });
    });

    describe('NotIn operator', () => {
      it('should match when value is not in the list', () => {
        const req: NodeSelectorRequirement = {
          key: 'zone',
          operator: 'NotIn',
          values: ['us-west-1', 'us-west-2'],
        };
        expect(matchesRequirement('us-east-1', req)).toBe(true);
      });

      it('should not match when value is in the list', () => {
        const req: NodeSelectorRequirement = {
          key: 'zone',
          operator: 'NotIn',
          values: ['us-west-1', 'us-west-2'],
        };
        expect(matchesRequirement('us-west-1', req)).toBe(false);
      });

      it('should match when value is undefined (key does not exist)', () => {
        const req: NodeSelectorRequirement = {
          key: 'zone',
          operator: 'NotIn',
          values: ['us-west-1'],
        };
        expect(matchesRequirement(undefined, req)).toBe(true);
      });
    });

    describe('Exists operator', () => {
      it('should match when value exists', () => {
        const req: NodeSelectorRequirement = {
          key: 'gpu',
          operator: 'Exists',
        };
        expect(matchesRequirement('nvidia', req)).toBe(true);
        expect(matchesRequirement('', req)).toBe(true); // Empty string is still a value
      });

      it('should not match when value is undefined', () => {
        const req: NodeSelectorRequirement = {
          key: 'gpu',
          operator: 'Exists',
        };
        expect(matchesRequirement(undefined, req)).toBe(false);
      });
    });

    describe('DoesNotExist operator', () => {
      it('should match when value is undefined', () => {
        const req: NodeSelectorRequirement = {
          key: 'gpu',
          operator: 'DoesNotExist',
        };
        expect(matchesRequirement(undefined, req)).toBe(true);
      });

      it('should not match when value exists', () => {
        const req: NodeSelectorRequirement = {
          key: 'gpu',
          operator: 'DoesNotExist',
        };
        expect(matchesRequirement('nvidia', req)).toBe(false);
      });
    });

    describe('Gt operator', () => {
      it('should match when value is greater than threshold', () => {
        const req: NodeSelectorRequirement = {
          key: 'memory',
          operator: 'Gt',
          values: ['8000'],
        };
        expect(matchesRequirement('16000', req)).toBe(true);
      });

      it('should not match when value is less than or equal to threshold', () => {
        const req: NodeSelectorRequirement = {
          key: 'memory',
          operator: 'Gt',
          values: ['8000'],
        };
        expect(matchesRequirement('8000', req)).toBe(false);
        expect(matchesRequirement('4000', req)).toBe(false);
      });

      it('should not match when value is undefined', () => {
        const req: NodeSelectorRequirement = {
          key: 'memory',
          operator: 'Gt',
          values: ['8000'],
        };
        expect(matchesRequirement(undefined, req)).toBe(false);
      });
    });

    describe('Lt operator', () => {
      it('should match when value is less than threshold', () => {
        const req: NodeSelectorRequirement = {
          key: 'latency',
          operator: 'Lt',
          values: ['100'],
        };
        expect(matchesRequirement('50', req)).toBe(true);
      });

      it('should not match when value is greater than or equal to threshold', () => {
        const req: NodeSelectorRequirement = {
          key: 'latency',
          operator: 'Lt',
          values: ['100'],
        };
        expect(matchesRequirement('100', req)).toBe(false);
        expect(matchesRequirement('150', req)).toBe(false);
      });
    });
  });

  describe('matchesNodeSelectorTerm helper', () => {
    it('should match when all expressions match', () => {
      const labels = { zone: 'us-west-1', environment: 'production', gpu: 'nvidia' };
      const term: NodeSelectorTerm = {
        matchExpressions: [
          { key: 'zone', operator: 'In', values: ['us-west-1', 'us-west-2'] },
          { key: 'environment', operator: 'In', values: ['production'] },
        ],
      };
      expect(matchesNodeSelectorTerm(labels, term)).toBe(true);
    });

    it('should not match when any expression fails', () => {
      const labels = { zone: 'us-east-1', environment: 'production' };
      const term: NodeSelectorTerm = {
        matchExpressions: [
          { key: 'zone', operator: 'In', values: ['us-west-1', 'us-west-2'] },
          { key: 'environment', operator: 'In', values: ['production'] },
        ],
      };
      expect(matchesNodeSelectorTerm(labels, term)).toBe(false);
    });

    it('should match empty term (no requirements)', () => {
      const labels = { zone: 'us-west-1' };
      const term: NodeSelectorTerm = {};
      expect(matchesNodeSelectorTerm(labels, term)).toBe(true);
    });

    it('should handle both matchExpressions and matchFields', () => {
      const labels = { zone: 'us-west-1', type: 'node' };
      const term: NodeSelectorTerm = {
        matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-west-1'] }],
        matchFields: [{ key: 'type', operator: 'In', values: ['node'] }],
      };
      expect(matchesNodeSelectorTerm(labels, term)).toBe(true);
    });
  });

  describe('calculateAffinityScore helper', () => {
    it('should return -1 when required affinity is not satisfied', () => {
      const labels = { zone: 'us-east-1' };
      const affinity: NodeAffinity = {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            { matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-west-1'] }] },
          ],
        },
      };
      expect(calculateAffinityScore(labels, affinity)).toBe(-1);
    });

    it('should return 0 when only required affinity is satisfied (no preferences)', () => {
      const labels = { zone: 'us-west-1' };
      const affinity: NodeAffinity = {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            { matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-west-1'] }] },
          ],
        },
      };
      expect(calculateAffinityScore(labels, affinity)).toBe(0);
    });

    it('should sum weights for matched preferred terms', () => {
      const labels = { zone: 'us-west-1', disktype: 'ssd', gpu: 'nvidia' };
      const affinity: NodeAffinity = {
        preferredDuringSchedulingIgnoredDuringExecution: [
          { weight: 50, preference: { matchExpressions: [{ key: 'disktype', operator: 'In', values: ['ssd'] }] } },
          { weight: 30, preference: { matchExpressions: [{ key: 'gpu', operator: 'Exists' }] } },
        ],
      };
      expect(calculateAffinityScore(labels, affinity)).toBe(80);
    });

    it('should only add weight for matching preferences', () => {
      const labels = { zone: 'us-west-1', disktype: 'hdd' };
      const affinity: NodeAffinity = {
        preferredDuringSchedulingIgnoredDuringExecution: [
          { weight: 50, preference: { matchExpressions: [{ key: 'disktype', operator: 'In', values: ['ssd'] }] } },
          { weight: 30, preference: { matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-west-1'] }] } },
        ],
      };
      expect(calculateAffinityScore(labels, affinity)).toBe(30);
    });
  });

  // ===========================================================================
  // Simple nodeSelector Tests
  // ===========================================================================

  describe('Simple nodeSelector', () => {
    it('should schedule to node matching nodeSelector', () => {
      // Register nodes with different labels
      nodeManager.register(
        {
          name: 'node-west',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', environment: 'production' },
        },
        testUserId
      );

      const eastNodeResult = nodeManager.register(
        {
          name: 'node-east',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-east-1', environment: 'production' },
        },
        testUserId
      );
      expect(eastNodeResult.success).toBe(true);

      // Create pod with nodeSelector requiring us-west-1
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeSelector: { zone: 'us-west-1' },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Schedule should succeed and select the west node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.status).toBe('scheduled');

      // Verify it's on the west node
      const westNode = nodeManager.getNodeByName('node-west');
      expect(scheduledPod?.nodeId).toBe(westNode.data?.node.id);
    });

    it('should fail when no node matches nodeSelector', () => {
      // Register nodes that don't match the selector
      nodeManager.register(
        {
          name: 'node-east',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-east-1' },
        },
        testUserId
      );

      // Create pod requiring non-existent zone
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeSelector: { zone: 'eu-central-1' },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Schedule should fail
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should match multiple labels in nodeSelector', () => {
      // Register node matching both labels
      const matchingNodeResult = nodeManager.register(
        {
          name: 'matching-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', environment: 'production', tier: 'frontend' },
        },
        testUserId
      );
      expect(matchingNodeResult.success).toBe(true);
      const matchingNodeId = matchingNodeResult.data!.node.id;

      // Register node matching only one label
      nodeManager.register(
        {
          name: 'partial-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', environment: 'staging' },
        },
        testUserId
      );

      // Create pod requiring both labels
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeSelector: { zone: 'us-west-1', environment: 'production' },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to the matching node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(matchingNodeId);
    });
  });

  // ===========================================================================
  // Required Node Affinity Tests
  // ===========================================================================

  describe('Required Node Affinity', () => {
    it('should schedule to node matching required affinity', () => {
      // Register nodes
      const gpuNodeResult = nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { gpu: 'nvidia', zone: 'us-west-1' },
        },
        testUserId
      );
      expect(gpuNodeResult.success).toBe(true);
      const gpuNodeId = gpuNodeResult.data!.node.id;

      nodeManager.register(
        {
          name: 'cpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1' },
        },
        testUserId
      );

      // Create pod requiring GPU
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'gpu', operator: 'Exists' }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to GPU node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(gpuNodeId);
    });

    it('should fail when no node matches required affinity', () => {
      // Register only non-GPU nodes
      nodeManager.register(
        {
          name: 'cpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1' },
        },
        testUserId
      );

      // Create pod requiring GPU
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'gpu', operator: 'Exists' }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should fail to schedule
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should match any of multiple node selector terms (OR logic)', () => {
      // Register nodes in different zones
      nodeManager.register(
        {
          name: 'node-west',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1' },
        },
        testUserId
      );

      const eastNodeResult = nodeManager.register(
        {
          name: 'node-east',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-east-1' },
        },
        testUserId
      );
      expect(eastNodeResult.success).toBe(true);

      nodeManager.register(
        {
          name: 'node-central',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-central-1' },
        },
        testUserId
      );

      // Create pod that can run in west OR east (not central)
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-west-1'] }] },
                  { matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-east-1'] }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule (to either west or east node)
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBeDefined();

      // Verify it's not on central node
      const centralNode = nodeManager.getNodeByName('node-central');
      expect(scheduledPod?.nodeId).not.toBe(centralNode.data?.node.id);
    });

    it('should require all expressions within a term to match (AND logic)', () => {
      // Register nodes
      nodeManager.register(
        {
          name: 'node-partial',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', environment: 'staging' },
        },
        testUserId
      );

      const fullMatchNodeResult = nodeManager.register(
        {
          name: 'node-full',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', environment: 'production' },
        },
        testUserId
      );
      expect(fullMatchNodeResult.success).toBe(true);
      const fullMatchNodeId = fullMatchNodeResult.data!.node.id;

      // Create pod requiring zone=us-west-1 AND environment=production
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  {
                    matchExpressions: [
                      { key: 'zone', operator: 'In', values: ['us-west-1'] },
                      { key: 'environment', operator: 'In', values: ['production'] },
                    ],
                  },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to the fully matching node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(fullMatchNodeId);
    });

    it('should handle NotIn operator for anti-requirements', () => {
      // Register nodes
      const prodNodeResult = nodeManager.register(
        {
          name: 'node-prod',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { environment: 'production' },
        },
        testUserId
      );
      expect(prodNodeResult.success).toBe(true);
      const prodNodeId = prodNodeResult.data!.node.id;

      nodeManager.register(
        {
          name: 'node-dev',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { environment: 'development' },
        },
        testUserId
      );

      // Create pod that should NOT run in development
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'environment', operator: 'NotIn', values: ['development'] }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to production node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(prodNodeId);
    });

    it('should handle DoesNotExist operator', () => {
      // Register nodes
      const noGpuNodeResult = nodeManager.register(
        {
          name: 'cpu-only-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1' },
        },
        testUserId
      );
      expect(noGpuNodeResult.success).toBe(true);
      const noGpuNodeId = noGpuNodeResult.data!.node.id;

      nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', gpu: 'nvidia' },
        },
        testUserId
      );

      // Create pod that requires nodes WITHOUT GPU
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'gpu', operator: 'DoesNotExist' }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to CPU-only node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(noGpuNodeId);
    });
  });

  // ===========================================================================
  // Preferred Node Affinity Tests
  // ===========================================================================

  describe('Preferred Node Affinity', () => {
    it('should prefer nodes matching preferred affinity with higher weight', () => {
      // Register nodes with different characteristics
      nodeManager.register(
        {
          name: 'hdd-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { disktype: 'hdd', zone: 'us-west-1' },
        },
        testUserId
      );

      const ssdNodeResult = nodeManager.register(
        {
          name: 'ssd-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { disktype: 'ssd', zone: 'us-west-1' },
        },
        testUserId
      );
      expect(ssdNodeResult.success).toBe(true);
      const ssdNodeId = ssdNodeResult.data!.node.id;

      // Create pod preferring SSD nodes
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                {
                  weight: 100,
                  preference: {
                    matchExpressions: [{ key: 'disktype', operator: 'In', values: ['ssd'] }],
                  },
                },
              ],
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should prefer SSD node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(ssdNodeId);
    });

    it('should still schedule when preferred affinity cannot be satisfied', () => {
      // Register only HDD nodes
      const hddNodeResult = nodeManager.register(
        {
          name: 'hdd-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { disktype: 'hdd', zone: 'us-west-1' },
        },
        testUserId
      );
      expect(hddNodeResult.success).toBe(true);
      const hddNodeId = hddNodeResult.data!.node.id;

      // Create pod preferring SSD (but SSD not available)
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                {
                  weight: 100,
                  preference: {
                    matchExpressions: [{ key: 'disktype', operator: 'In', values: ['ssd'] }],
                  },
                },
              ],
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should still schedule to HDD node (preference is soft)
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(hddNodeId);
    });

    it('should accumulate weights from multiple matching preferences', () => {
      // Register nodes with different labels
      nodeManager.register(
        {
          name: 'basic-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1' },
        },
        testUserId
      );

      nodeManager.register(
        {
          name: 'ssd-only-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', disktype: 'ssd' },
        },
        testUserId
      );

      const superNodeResult = nodeManager.register(
        {
          name: 'super-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { zone: 'us-west-1', disktype: 'ssd', gpu: 'nvidia' },
        },
        testUserId
      );
      expect(superNodeResult.success).toBe(true);
      const superNodeId = superNodeResult.data!.node.id;

      // Create pod with multiple preferences
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                { weight: 50, preference: { matchExpressions: [{ key: 'disktype', operator: 'In', values: ['ssd'] }] } },
                { weight: 50, preference: { matchExpressions: [{ key: 'gpu', operator: 'Exists' }] } },
              ],
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should prefer super-node (matches both preferences = weight 100)
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(superNodeId);
    });
  });

  // ===========================================================================
  // Combined Required and Preferred Affinity Tests
  // ===========================================================================

  describe('Combined Required and Preferred Affinity', () => {
    it('should filter by required and then sort by preferred', () => {
      // Register production nodes
      nodeManager.register(
        {
          name: 'prod-hdd-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { environment: 'production', disktype: 'hdd' },
        },
        testUserId
      );

      const prodSsdNodeResult = nodeManager.register(
        {
          name: 'prod-ssd-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { environment: 'production', disktype: 'ssd' },
        },
        testUserId
      );
      expect(prodSsdNodeResult.success).toBe(true);
      const prodSsdNodeId = prodSsdNodeResult.data!.node.id;

      // Register staging SSD node (should be excluded by required)
      nodeManager.register(
        {
          name: 'staging-ssd-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { environment: 'staging', disktype: 'ssd' },
        },
        testUserId
      );

      // Create pod requiring production, preferring SSD
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'environment', operator: 'In', values: ['production'] }] },
                ],
              },
              preferredDuringSchedulingIgnoredDuringExecution: [
                { weight: 100, preference: { matchExpressions: [{ key: 'disktype', operator: 'In', values: ['ssd'] }] } },
              ],
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to prod-ssd-node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(prodSsdNodeId);
    });

    it('should fail if required is not satisfied even if preferred is available', () => {
      // Register only staging node with SSD
      nodeManager.register(
        {
          name: 'staging-ssd-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { environment: 'staging', disktype: 'ssd' },
        },
        testUserId
      );

      // Create pod requiring production (not available)
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'environment', operator: 'In', values: ['production'] }] },
                ],
              },
              preferredDuringSchedulingIgnoredDuringExecution: [
                { weight: 100, preference: { matchExpressions: [{ key: 'disktype', operator: 'In', values: ['ssd'] }] } },
              ],
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should fail - required not satisfied
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });
  });

  // ===========================================================================
  // Gt and Lt Operator Tests
  // ===========================================================================

  describe('Gt and Lt Operators', () => {
    it('should handle Gt operator for numeric comparisons', () => {
      // Register nodes with numeric labels
      nodeManager.register(
        {
          name: 'small-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { 'node.stark.io/cpu-score': '50' },
        },
        testUserId
      );

      const largeNodeResult = nodeManager.register(
        {
          name: 'large-node',
          runtimeType: 'node',
          allocatable: { cpu: 8000, memory: 16384, pods: 200, storage: 100000 },
          labels: { 'node.stark.io/cpu-score': '150' },
        },
        testUserId
      );
      expect(largeNodeResult.success).toBe(true);
      const largeNodeId = largeNodeResult.data!.node.id;

      // Create pod requiring high CPU score (> 100)
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'node.stark.io/cpu-score', operator: 'Gt', values: ['100'] }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to large node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(largeNodeId);
    });

    it('should handle Lt operator for numeric comparisons', () => {
      // Register nodes with latency labels
      nodeManager.register(
        {
          name: 'high-latency-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { 'network.stark.io/latency-ms': '100' },
        },
        testUserId
      );

      const lowLatencyNodeResult = nodeManager.register(
        {
          name: 'low-latency-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { 'network.stark.io/latency-ms': '10' },
        },
        testUserId
      );
      expect(lowLatencyNodeResult.success).toBe(true);
      const lowLatencyNodeId = lowLatencyNodeResult.data!.node.id;

      // Create pod requiring low latency (< 50ms)
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'network.stark.io/latency-ms', operator: 'Lt', values: ['50'] }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should schedule to low-latency node
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.nodeId).toBe(lowLatencyNodeId);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle empty affinity rules', () => {
      const nodeResult = nodeManager.register(
        {
          name: 'basic-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      expect(nodeResult.success).toBe(true);
      const nodeId = nodeResult.data!.node.id;

      // Create pod with empty scheduling config
      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {},
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

    it('should combine node affinity with taints/tolerations', () => {
      // Register tainted GPU node matching affinity
      const gpuNodeResult = nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
          labels: { gpu: 'nvidia' },
          taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }],
        },
        testUserId
      );
      expect(gpuNodeResult.success).toBe(true);
      const gpuNodeId = gpuNodeResult.data!.node.id;

      // Create pod with affinity for GPU but without toleration
      const createResult1 = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'gpu', operator: 'Exists' }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult1.success).toBe(true);
      const pod1 = createResult1.data!.pod;

      // Should fail - matches affinity but not toleration
      const scheduleResult1 = scheduler.schedule(pod1.id);
      expect(scheduleResult1.success).toBe(false);

      // Create pod with both affinity and toleration
      const createResult2 = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'gpu', operator: 'Exists' }] },
                ],
              },
            },
          },
          tolerations: [{ key: 'dedicated', operator: 'Equal', value: 'gpu', effect: 'NoSchedule' }],
        },
        testUserId
      );
      expect(createResult2.success).toBe(true);
      const pod2 = createResult2.data!.pod;

      // Should succeed
      const scheduleResult2 = scheduler.schedule(pod2.id);
      expect(scheduleResult2.success).toBe(true);
      expect(scheduleResult2.data?.nodeId).toBe(gpuNodeId);
    });

    it('should combine node affinity with runtime compatibility', () => {
      // Register browser node matching affinity
      nodeManager.register(
        {
          name: 'browser-node',
          runtimeType: 'browser',
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 10000 },
          labels: { zone: 'us-west-1' },
        },
        testUserId
      );

      // Create pod for node-runtime pack with affinity matching browser node
      const createResult = scheduler.create(
        {
          packId: testPackId, // node-tagged pack
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-west-1'] }] },
                ],
              },
            },
          },
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

    it('should handle scheduling when no nodes are available', () => {
      // No nodes registered

      const createResult = scheduler.create(
        {
          packId: testPackId,
          scheduling: {
            nodeAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: {
                nodeSelectorTerms: [
                  { matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-west-1'] }] },
                ],
              },
            },
          },
        },
        testUserId
      );
      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      // Should fail gracefully
      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });
  });
});
