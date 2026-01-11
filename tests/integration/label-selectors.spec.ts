/**
 * Integration tests for Label Selector Matching
 * @module tests/integration/label-selectors
 *
 * Tests for User Story 6: Kubernetes-Like Scheduling & Isolation
 * These tests verify that label selectors work correctly for node selection
 *
 * Key scenarios tested:
 * 1. Simple matchLabels key-value matching
 * 2. Match expressions with In, NotIn, Exists, DoesNotExist operators
 * 3. Complex selectors with multiple conditions
 * 4. Nodes are correctly filtered by label selectors
 * 5. Pods are scheduled only to nodes matching their nodeSelector
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  Labels,
  LabelSelector,
  LabelSelectorMatchExpression,
  CreatePodInput,
} from '@stark-o/shared';
import {
  matchesSelector,
  matchesExpression,
  matchesLabels,
  isValidLabelKey,
  isValidLabelValue,
} from '@stark-o/shared';

import { PodScheduler, PodSchedulerErrorCodes } from '@stark-o/core/services/pod-scheduler';
import { PackRegistry } from '@stark-o/core/services/pack-registry';
import { createNodeManager, NodeManager } from '@stark-o/core/services/node-manager';
import { resetClusterState } from '@stark-o/core/stores/cluster-store';

describe('Label Selector Integration Tests', () => {
  let scheduler: PodScheduler;
  let packRegistry: PackRegistry;
  let nodeManager: NodeManager;
  const testUserId = 'test-user-labels';

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

  describe('Label Validation', () => {
    describe('isValidLabelKey', () => {
      it('should accept valid simple keys', () => {
        expect(isValidLabelKey('app')).toBe(true);
        expect(isValidLabelKey('environment')).toBe(true);
        expect(isValidLabelKey('version')).toBe(true);
        expect(isValidLabelKey('my-app')).toBe(true);
        expect(isValidLabelKey('my_app')).toBe(true);
        expect(isValidLabelKey('my.app')).toBe(true);
      });

      it('should accept valid prefixed keys', () => {
        expect(isValidLabelKey('stark.io/app')).toBe(true);
        expect(isValidLabelKey('kubernetes.io/name')).toBe(true);
        expect(isValidLabelKey('app.kubernetes.io/component')).toBe(true);
      });

      it('should reject invalid keys', () => {
        expect(isValidLabelKey('')).toBe(false);
        expect(isValidLabelKey('-invalid')).toBe(false);
        expect(isValidLabelKey('.invalid')).toBe(false);
      });
    });

    describe('isValidLabelValue', () => {
      it('should accept valid values', () => {
        expect(isValidLabelValue('production')).toBe(true);
        expect(isValidLabelValue('v1.2.3')).toBe(true);
        expect(isValidLabelValue('my-app')).toBe(true);
        expect(isValidLabelValue('')).toBe(true); // Empty values are valid
      });

      it('should reject invalid values', () => {
        expect(isValidLabelValue('-invalid')).toBe(false);
        expect(isValidLabelValue('.invalid')).toBe(false);
      });
    });
  });

  describe('matchesExpression helper', () => {
    const labels: Labels = {
      app: 'frontend',
      environment: 'production',
      version: 'v1.0.0',
    };

    describe('In operator', () => {
      it('should match when value is in the list', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'environment',
          operator: 'In',
          values: ['production', 'staging'],
        };
        expect(matchesExpression(labels, expr)).toBe(true);
      });

      it('should not match when value is not in the list', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'environment',
          operator: 'In',
          values: ['development', 'staging'],
        };
        expect(matchesExpression(labels, expr)).toBe(false);
      });

      it('should not match when key does not exist', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'nonexistent',
          operator: 'In',
          values: ['value'],
        };
        expect(matchesExpression(labels, expr)).toBe(false);
      });
    });

    describe('NotIn operator', () => {
      it('should match when value is not in the list', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'environment',
          operator: 'NotIn',
          values: ['development', 'staging'],
        };
        expect(matchesExpression(labels, expr)).toBe(true);
      });

      it('should not match when value is in the list', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'environment',
          operator: 'NotIn',
          values: ['production', 'staging'],
        };
        expect(matchesExpression(labels, expr)).toBe(false);
      });

      it('should match when key does not exist', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'nonexistent',
          operator: 'NotIn',
          values: ['value'],
        };
        expect(matchesExpression(labels, expr)).toBe(true);
      });
    });

    describe('Exists operator', () => {
      it('should match when key exists', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'app',
          operator: 'Exists',
        };
        expect(matchesExpression(labels, expr)).toBe(true);
      });

      it('should not match when key does not exist', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'nonexistent',
          operator: 'Exists',
        };
        expect(matchesExpression(labels, expr)).toBe(false);
      });
    });

    describe('DoesNotExist operator', () => {
      it('should match when key does not exist', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'nonexistent',
          operator: 'DoesNotExist',
        };
        expect(matchesExpression(labels, expr)).toBe(true);
      });

      it('should not match when key exists', () => {
        const expr: LabelSelectorMatchExpression = {
          key: 'app',
          operator: 'DoesNotExist',
        };
        expect(matchesExpression(labels, expr)).toBe(false);
      });
    });
  });

  describe('matchesLabels helper', () => {
    it('should match when all required labels are present', () => {
      const labels: Labels = {
        app: 'frontend',
        environment: 'production',
        team: 'platform',
      };
      const required: Labels = {
        app: 'frontend',
        environment: 'production',
      };
      expect(matchesLabels(labels, required)).toBe(true);
    });

    it('should not match when a required label is missing', () => {
      const labels: Labels = {
        app: 'frontend',
      };
      const required: Labels = {
        app: 'frontend',
        environment: 'production',
      };
      expect(matchesLabels(labels, required)).toBe(false);
    });

    it('should not match when label values differ', () => {
      const labels: Labels = {
        app: 'frontend',
        environment: 'staging',
      };
      const required: Labels = {
        app: 'frontend',
        environment: 'production',
      };
      expect(matchesLabels(labels, required)).toBe(false);
    });

    it('should match when required labels is empty', () => {
      const labels: Labels = {
        app: 'frontend',
      };
      expect(matchesLabels(labels, {})).toBe(true);
    });
  });

  describe('matchesSelector helper', () => {
    const labels: Labels = {
      app: 'frontend',
      environment: 'production',
      version: 'v1.0.0',
      tier: 'web',
    };

    it('should match with matchLabels only', () => {
      const selector: LabelSelector = {
        matchLabels: {
          app: 'frontend',
          tier: 'web',
        },
      };
      expect(matchesSelector(labels, selector)).toBe(true);
    });

    it('should match with matchExpressions only', () => {
      const selector: LabelSelector = {
        matchExpressions: [
          { key: 'environment', operator: 'In', values: ['production', 'staging'] },
          { key: 'deprecated', operator: 'DoesNotExist' },
        ],
      };
      expect(matchesSelector(labels, selector)).toBe(true);
    });

    it('should match with both matchLabels and matchExpressions', () => {
      const selector: LabelSelector = {
        matchLabels: {
          app: 'frontend',
        },
        matchExpressions: [
          { key: 'environment', operator: 'In', values: ['production'] },
          { key: 'tier', operator: 'Exists' },
        ],
      };
      expect(matchesSelector(labels, selector)).toBe(true);
    });

    it('should not match when matchLabels fails', () => {
      const selector: LabelSelector = {
        matchLabels: {
          app: 'backend',
        },
        matchExpressions: [
          { key: 'environment', operator: 'In', values: ['production'] },
        ],
      };
      expect(matchesSelector(labels, selector)).toBe(false);
    });

    it('should not match when matchExpressions fails', () => {
      const selector: LabelSelector = {
        matchLabels: {
          app: 'frontend',
        },
        matchExpressions: [
          { key: 'environment', operator: 'In', values: ['development'] },
        ],
      };
      expect(matchesSelector(labels, selector)).toBe(false);
    });

    it('should match with empty selector', () => {
      const selector: LabelSelector = {};
      expect(matchesSelector(labels, selector)).toBe(true);
    });
  });

  describe('Node Label Filtering', () => {
    beforeEach(() => {
      // Register nodes with different labels
      nodeManager.register(
        {
          name: 'production-node-1',
          runtimeType: 'node',
          labels: {
            environment: 'production',
            zone: 'us-west-1',
            tier: 'compute',
          },
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      nodeManager.register(
        {
          name: 'production-node-2',
          runtimeType: 'node',
          labels: {
            environment: 'production',
            zone: 'us-east-1',
            tier: 'compute',
          },
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      nodeManager.register(
        {
          name: 'staging-node-1',
          runtimeType: 'node',
          labels: {
            environment: 'staging',
            zone: 'us-west-1',
            tier: 'compute',
          },
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 25000 },
        },
        testUserId
      );

      nodeManager.register(
        {
          name: 'gpu-node-1',
          runtimeType: 'node',
          labels: {
            environment: 'production',
            zone: 'us-west-1',
            'gpu': 'nvidia-a100',
            tier: 'gpu',
          },
          allocatable: { cpu: 8000, memory: 32768, pods: 50, storage: 100000 },
        },
        testUserId
      );
    });

    it('should find nodes by exact label match', () => {
      const result = nodeManager.findBySelector({
        matchLabels: { environment: 'production' },
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(3);
      expect(result.data?.nodes.map((n: { name: string }) => n.name)).toContain('production-node-1');
      expect(result.data?.nodes.map((n: { name: string }) => n.name)).toContain('production-node-2');
      expect(result.data?.nodes.map((n: { name: string }) => n.name)).toContain('gpu-node-1');
    });

    it('should find nodes by multiple label match', () => {
      const result = nodeManager.findBySelector({
        matchLabels: {
          environment: 'production',
          zone: 'us-west-1',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(2);
      expect(result.data?.nodes.map((n: { name: string }) => n.name)).toContain('production-node-1');
      expect(result.data?.nodes.map((n: { name: string }) => n.name)).toContain('gpu-node-1');
    });

    it('should find nodes with In expression', () => {
      const result = nodeManager.findBySelector({
        matchExpressions: [
          { key: 'zone', operator: 'In', values: ['us-west-1', 'us-central-1'] },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(3);
    });

    it('should find nodes with NotIn expression', () => {
      const result = nodeManager.findBySelector({
        matchExpressions: [
          { key: 'environment', operator: 'NotIn', values: ['staging'] },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(3);
      expect(result.data?.nodes.every((n: { labels: Labels }) => n.labels.environment !== 'staging')).toBe(true);
    });

    it('should find nodes with Exists expression', () => {
      const result = nodeManager.findBySelector({
        matchExpressions: [
          { key: 'gpu', operator: 'Exists' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(1);
      expect(result.data?.nodes[0].name).toBe('gpu-node-1');
    });

    it('should find nodes with DoesNotExist expression', () => {
      const result = nodeManager.findBySelector({
        matchExpressions: [
          { key: 'gpu', operator: 'DoesNotExist' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(3);
      expect(result.data?.nodes.every((n: { name: string }) => n.name !== 'gpu-node-1')).toBe(true);
    });

    it('should find nodes with complex selector', () => {
      const result = nodeManager.findBySelector({
        matchLabels: {
          tier: 'compute',
        },
        matchExpressions: [
          { key: 'environment', operator: 'In', values: ['production'] },
          { key: 'gpu', operator: 'DoesNotExist' },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(2);
      expect(result.data?.nodes.map((n: { name: string }) => n.name)).toContain('production-node-1');
      expect(result.data?.nodes.map((n: { name: string }) => n.name)).toContain('production-node-2');
    });

    it('should return empty when no nodes match', () => {
      const result = nodeManager.findBySelector({
        matchLabels: {
          environment: 'development',
        },
      });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(0);
    });
  });

  describe('Pod Scheduling with nodeSelector', () => {
    let packId: string;

    beforeEach(() => {
      // Register a pack
      const packResult = packRegistry.register(
        { name: 'test-app', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      expect(packResult.success).toBe(true);
      packId = packResult.data!.pack.id;

      // Register nodes with different labels
      nodeManager.register(
        {
          name: 'production-node',
          runtimeType: 'node',
          labels: {
            environment: 'production',
            tier: 'web',
          },
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      nodeManager.register(
        {
          name: 'staging-node',
          runtimeType: 'node',
          labels: {
            environment: 'staging',
            tier: 'web',
          },
          allocatable: { cpu: 2000, memory: 4096, pods: 50, storage: 25000 },
        },
        testUserId
      );

      nodeManager.register(
        {
          name: 'gpu-node',
          runtimeType: 'node',
          labels: {
            environment: 'production',
            tier: 'gpu',
            'nvidia.com/gpu': 'true',
          },
          allocatable: { cpu: 8000, memory: 32768, pods: 50, storage: 100000 },
        },
        testUserId
      );
    });

    it('should schedule pod to node matching nodeSelector', () => {
      const createResult = scheduler.create(
        {
          packId,
          scheduling: {
            nodeSelector: {
              environment: 'production',
              tier: 'web',
            },
          },
        },
        testUserId
      );

      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      expect(scheduledPod?.status).toBe('scheduled');
      expect(scheduledPod?.nodeId).toBeDefined();

      // Verify it was scheduled to the production-node
      const nodeResult = nodeManager.getNode(scheduledPod!.nodeId!);
      expect(nodeResult.data?.node.name).toBe('production-node');
    });

    it('should schedule pod to GPU node when selector matches', () => {
      const createResult = scheduler.create(
        {
          packId,
          scheduling: {
            nodeSelector: {
              'nvidia.com/gpu': 'true',
            },
          },
        },
        testUserId
      );

      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      const nodeResult = nodeManager.getNode(scheduledPod!.nodeId!);
      expect(nodeResult.data?.node.name).toBe('gpu-node');
    });

    it('should fail to schedule when no nodes match nodeSelector', () => {
      const createResult = scheduler.create(
        {
          packId,
          scheduling: {
            nodeSelector: {
              environment: 'development',
            },
          },
        },
        testUserId
      );

      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(false);
      expect(scheduleResult.error?.code).toBe(PodSchedulerErrorCodes.NO_COMPATIBLE_NODES);
    });

    it('should consider multiple nodeSelector labels together (AND logic)', () => {
      const createResult = scheduler.create(
        {
          packId,
          scheduling: {
            nodeSelector: {
              environment: 'production',
              tier: 'gpu',
            },
          },
        },
        testUserId
      );

      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      const nodeResult = nodeManager.getNode(scheduledPod!.nodeId!);
      expect(nodeResult.data?.node.name).toBe('gpu-node');
    });

    it('should schedule to any matching node when multiple match nodeSelector', () => {
      // Register another production web node
      nodeManager.register(
        {
          name: 'production-node-2',
          runtimeType: 'node',
          labels: {
            environment: 'production',
            tier: 'web',
          },
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );

      const createResult = scheduler.create(
        {
          packId,
          scheduling: {
            nodeSelector: {
              environment: 'production',
              tier: 'web',
            },
          },
        },
        testUserId
      );

      expect(createResult.success).toBe(true);
      const pod = createResult.data!.pod;

      const scheduleResult = scheduler.schedule(pod.id);
      expect(scheduleResult.success).toBe(true);

      const scheduledPod = scheduler.get(pod.id);
      const nodeResult = nodeManager.getNode(scheduledPod!.nodeId!);
      // Should be one of the production-web nodes
      expect(['production-node', 'production-node-2']).toContain(nodeResult.data?.node.name);
    });
  });

  describe('Node Label Management', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = nodeManager.register(
        {
          name: 'test-node',
          runtimeType: 'node',
          labels: {
            environment: 'production',
            app: 'test',
          },
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        testUserId
      );
      expect(result.success).toBe(true);
      nodeId = result.data!.node.id;
    });

    it('should add a label to a node', () => {
      const result = nodeManager.addLabel(nodeId, 'tier', 'web');
      expect(result.success).toBe(true);

      const nodeResult = nodeManager.getNode(nodeId);
      expect(nodeResult.data?.node.labels.tier).toBe('web');
    });

    it('should update an existing label', () => {
      const result = nodeManager.addLabel(nodeId, 'environment', 'staging');
      expect(result.success).toBe(true);

      const nodeResult = nodeManager.getNode(nodeId);
      expect(nodeResult.data?.node.labels.environment).toBe('staging');
    });

    it('should remove a label from a node', () => {
      const result = nodeManager.removeLabel(nodeId, 'app');
      expect(result.success).toBe(true);

      const nodeResult = nodeManager.getNode(nodeId);
      expect(nodeResult.data?.node.labels.app).toBeUndefined();
    });

    it('should set all labels at once', () => {
      const newLabels: Labels = {
        region: 'us-west',
        zone: 'a',
        tier: 'compute',
      };

      const result = nodeManager.setLabels(nodeId, newLabels);
      expect(result.success).toBe(true);

      const nodeResult = nodeManager.getNode(nodeId);
      expect(nodeResult.data?.node.labels).toEqual(newLabels);
      expect(nodeResult.data?.node.labels.environment).toBeUndefined();
    });

    it('should affect scheduling after label change', () => {
      // Register a pack
      const packResult = packRegistry.register(
        { name: 'label-test-app', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      const packId = packResult.data!.pack.id;

      // Create a pod that requires staging environment
      const createResult = scheduler.create(
        {
          packId,
          scheduling: {
            nodeSelector: {
              environment: 'staging',
            },
          },
        },
        testUserId
      );

      const pod = createResult.data!.pod;

      // Should fail - no staging nodes
      const scheduleResult1 = scheduler.schedule(pod.id);
      expect(scheduleResult1.success).toBe(false);

      // Change node label to staging
      nodeManager.addLabel(nodeId, 'environment', 'staging');

      // Create a new pod and try again (pods are immutable once scheduled)
      const createResult2 = scheduler.create(
        {
          packId,
          scheduling: {
            nodeSelector: {
              environment: 'staging',
            },
          },
        },
        testUserId
      );

      const pod2 = createResult2.data!.pod;
      const scheduleResult2 = scheduler.schedule(pod2.id);
      expect(scheduleResult2.success).toBe(true);

      const scheduledPod = scheduler.get(pod2.id);
      expect(scheduledPod?.nodeId).toBe(nodeId);
    });
  });
});
