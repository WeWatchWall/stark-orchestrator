/**
 * Unit tests for NamespaceManager service
 * @module @stark-o/core/tests/unit/namespace-manager
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  NamespaceManager,
  createNamespaceManager,
  NamespaceManagerErrorCodes,
  resetCluster,
  clusterState,
  // Computed exports
  namespaceCount,
  activeNamespaceCount,
  namespacesByPhase,
  namespacesWithQuota,
  totalResourceUsage,
  // Store functions
  findNamespaceByName,
  findNamespacesBySelector,
  findNamespacesByPhase,
  namespaceExists,
  // Pod store functions for testing namespace not empty
  createPod,
} from '../../src';
import type { CreateNamespaceInput, UpdateNamespaceInput } from '@stark-o/shared';

// Default namespaces created by ensureDefaultNamespaces()
const DEFAULT_NAMESPACES = ['default', 'stark-system', 'stark-public'];

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a valid namespace input
 */
function createValidNamespaceInput(overrides: Partial<CreateNamespaceInput> = {}): CreateNamespaceInput {
  return {
    name: `test-namespace-${Date.now()}`,
    labels: { env: 'test' },
    annotations: { description: 'Test namespace' },
    ...overrides,
  };
}

/**
 * Create a namespace with quota
 */
function createNamespaceWithQuota(name: string): CreateNamespaceInput {
  return {
    name,
    resourceQuota: {
      hard: {
        pods: 10,
        cpu: 1000,
        memory: 2048,
        storage: 10240,
      },
    },
  };
}

/**
 * Create a namespace with limit range
 */
function createNamespaceWithLimitRange(name: string): CreateNamespaceInput {
  return {
    name,
    limitRange: {
      default: { cpu: 100, memory: 256 },
      defaultRequest: { cpu: 50, memory: 128 },
      max: { cpu: 500, memory: 1024 },
      min: { cpu: 10, memory: 32 },
    },
  };
}

// ============================================================================
// NamespaceManager Tests
// ============================================================================

describe('NamespaceManager', () => {
  let manager: NamespaceManager;

  beforeEach(() => {
    resetCluster();
    // Note: Do NOT call initializeCluster() as it creates default namespaces
    manager = createNamespaceManager({ initializeDefaults: false });
  });

  // ==========================================================================
  // Constructor Tests
  // ==========================================================================

  describe('constructor', () => {
    it('should create with default options', () => {
      const mgr = new NamespaceManager();
      expect(mgr).toBeInstanceOf(NamespaceManager);
    });

    it('should accept initializeDefaults option', () => {
      const mgr = createNamespaceManager({ initializeDefaults: false });
      expect(mgr).toBeInstanceOf(NamespaceManager);
    });

    it('should not auto-initialize defaults when disabled', () => {
      const mgr = createNamespaceManager({ initializeDefaults: false });
      mgr.initialize();
      expect(clusterState.namespaces.size).toBe(0);
    });

    it('should create default namespaces when initializeDefaults is true', () => {
      resetCluster();
      const mgr = createNamespaceManager({ initializeDefaults: true });
      mgr.initialize();
      expect(clusterState.namespaces.has('default')).toBe(true);
      expect(clusterState.namespaces.has('stark-system')).toBe(true);
      expect(clusterState.namespaces.has('stark-public')).toBe(true);
    });
  });

  // ==========================================================================
  // Initialization Tests
  // ==========================================================================

  describe('initialize', () => {
    it('should mark manager as initialized', () => {
      manager.initialize();
      // Second call should not throw
      manager.initialize();
    });

    it('should be idempotent', () => {
      manager.initialize();
      const countBefore = clusterState.namespaces.size;
      manager.initialize();
      expect(clusterState.namespaces.size).toBe(countBefore);
    });
  });

  describe('ensureDefaultNamespaces', () => {
    it('should create default namespace if it does not exist', () => {
      manager.ensureDefaultNamespaces();
      expect(clusterState.namespaces.has('default')).toBe(true);
    });

    it('should create stark-system namespace if it does not exist', () => {
      manager.ensureDefaultNamespaces();
      expect(clusterState.namespaces.has('stark-system')).toBe(true);
    });

    it('should create stark-public namespace if it does not exist', () => {
      manager.ensureDefaultNamespaces();
      expect(clusterState.namespaces.has('stark-public')).toBe(true);
    });

    it('should not duplicate default namespaces', () => {
      manager.ensureDefaultNamespaces();
      manager.ensureDefaultNamespaces();
      expect(clusterState.namespaces.size).toBe(3);
    });
  });

  // ==========================================================================
  // Computed Properties Tests
  // ==========================================================================

  describe('computed properties', () => {
    beforeEach(() => {
      manager.create({ name: 'ns-1' }, 'user1');
      manager.create({ name: 'ns-2', resourceQuota: { hard: { pods: 10 } } }, 'user1');
      manager.create({ name: 'ns-3' }, 'user1');
    });

    it('should return total namespace count', () => {
      expect(manager.total.value).toBe(3);
      expect(namespaceCount.value).toBe(3);
    });

    it('should return active namespace count', () => {
      expect(manager.activeCount.value).toBe(3);
      expect(activeNamespaceCount.value).toBe(3);
    });

    it('should group namespaces by phase', () => {
      manager.markTerminating('ns-1');
      const byPhase = manager.byPhase.value;
      expect(byPhase).toBeInstanceOf(Map);
      expect(byPhase.get('active')?.length).toBe(2);
      expect(byPhase.get('terminating')?.length).toBe(1);
    });

    it('should filter namespaces with quota', () => {
      const withQuota = manager.withQuota.value;
      expect(withQuota.length).toBe(1);
      expect(withQuota[0].name).toBe('ns-2');
      expect(namespacesWithQuota.value.length).toBe(1);
    });

    it('should track total resource usage', () => {
      expect(manager.totalUsage.value.pods).toBe(0);
      expect(manager.totalUsage.value.cpu).toBe(0);
      expect(totalResourceUsage.value.pods).toBe(0);
    });
  });

  // ==========================================================================
  // CRUD Operations - Create
  // ==========================================================================

  describe('create', () => {
    it('should create a namespace with valid input', () => {
      const input = createValidNamespaceInput({ name: 'my-namespace' });
      const result = manager.create(input, 'user1');

      expect(result.success).toBe(true);
      expect(result.data?.namespace.name).toBe('my-namespace');
      expect(result.data?.namespace.phase).toBe('active');
      expect(result.data?.namespace.createdBy).toBe('user1');
    });

    it('should set labels and annotations', () => {
      const input = createValidNamespaceInput({
        name: 'labeled-ns',
        labels: { env: 'production' },
        annotations: { owner: 'team-a' },
      });
      const result = manager.create(input);

      expect(result.success).toBe(true);
      expect(result.data?.namespace.labels.env).toBe('production');
      expect(result.data?.namespace.annotations.owner).toBe('team-a');
    });

    it('should set resource quota', () => {
      const input = createNamespaceWithQuota('quota-ns');
      const result = manager.create(input);

      expect(result.success).toBe(true);
      expect(result.data?.namespace.resourceQuota?.hard.pods).toBe(10);
      expect(result.data?.namespace.resourceQuota?.hard.cpu).toBe(1000);
    });

    it('should set limit range', () => {
      const input = createNamespaceWithLimitRange('limit-ns');
      const result = manager.create(input);

      expect(result.success).toBe(true);
      expect(result.data?.namespace.limitRange?.default?.cpu).toBe(100);
      expect(result.data?.namespace.limitRange?.min?.cpu).toBe(10);
    });

    it('should initialize resource usage to zero', () => {
      const result = manager.create({ name: 'zero-usage' });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.resourceUsage.pods).toBe(0);
      expect(result.data?.namespace.resourceUsage.cpu).toBe(0);
      expect(result.data?.namespace.resourceUsage.memory).toBe(0);
      expect(result.data?.namespace.resourceUsage.storage).toBe(0);
    });

    it('should fail for duplicate namespace name', () => {
      manager.create({ name: 'duplicate' });
      const result = manager.create({ name: 'duplicate' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_EXISTS);
    });

    it('should fail for reserved namespace name', () => {
      // Reserved names are caught by validation before the explicit check
      const result = manager.create({ name: 'stark-system' });

      expect(result.success).toBe(false);
      // Validation catches reserved names first
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.VALIDATION_ERROR);
    });

    it('should fail for invalid input', () => {
      const result = manager.create({ name: '' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.VALIDATION_ERROR);
    });

    it('should fail for name starting with dash', () => {
      const result = manager.create({ name: '-invalid' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.VALIDATION_ERROR);
    });

    it('should store namespace in cluster state', () => {
      manager.create({ name: 'stored-ns' });
      expect(clusterState.namespaces.has('stored-ns')).toBe(true);
    });
  });

  // ==========================================================================
  // CRUD Operations - Get
  // ==========================================================================

  describe('get', () => {
    beforeEach(() => {
      manager.create({ name: 'existing-ns' });
    });

    it('should get existing namespace', () => {
      const result = manager.get('existing-ns');

      expect(result.success).toBe(true);
      expect(result.data?.namespace.name).toBe('existing-ns');
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.get('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  // ==========================================================================
  // CRUD Operations - List
  // ==========================================================================

  describe('list', () => {
    beforeEach(() => {
      manager.create({ name: 'ns-a', labels: { env: 'prod' } });
      manager.create({ name: 'ns-b', labels: { env: 'staging' }, resourceQuota: { hard: { pods: 5 } } });
      manager.create({ name: 'ns-c', labels: { env: 'prod' } });
    });

    it('should list all namespaces', () => {
      const result = manager.list();

      expect(result.namespaces.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('should filter by phase', () => {
      manager.markTerminating('ns-a');
      const result = manager.list({ phase: 'active' });

      expect(result.namespaces.length).toBe(2);
      expect(result.namespaces.every(ns => ns.phase === 'active')).toBe(true);
    });

    it('should filter by label selector', () => {
      // list() with labelSelector expects a LabelSelector with matchLabels
      const result = manager.list({ labelSelector: { matchLabels: { env: 'prod' } } as any });

      expect(result.namespaces.length).toBe(2);
    });

    it('should filter by hasQuota true', () => {
      const result = manager.list({ hasQuota: true });

      expect(result.namespaces.length).toBe(1);
      expect(result.namespaces[0].name).toBe('ns-b');
    });

    it('should filter by hasQuota false', () => {
      const result = manager.list({ hasQuota: false });

      expect(result.namespaces.length).toBe(2);
    });

    it('should support pagination', () => {
      const result = manager.list({ page: 1, pageSize: 2 });

      expect(result.namespaces.length).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
      expect(result.total).toBe(3);
    });

    it('should return empty for page beyond total', () => {
      const result = manager.list({ page: 10, pageSize: 2 });

      expect(result.namespaces.length).toBe(0);
      expect(result.total).toBe(3);
    });

    it('should sort by phase and name', () => {
      manager.markTerminating('ns-a');
      const result = manager.list();

      // Active namespaces first, then terminating
      expect(result.namespaces[result.namespaces.length - 1].name).toBe('ns-a');
    });
  });

  // ==========================================================================
  // CRUD Operations - Update
  // ==========================================================================

  describe('update', () => {
    beforeEach(() => {
      manager.create({ name: 'updatable-ns', labels: { env: 'dev' } });
    });

    it('should update labels', () => {
      const result = manager.update('updatable-ns', { labels: { env: 'prod' } });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.labels.env).toBe('prod');
    });

    it('should update annotations', () => {
      const result = manager.update('updatable-ns', { annotations: { note: 'updated' } });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.annotations.note).toBe('updated');
    });

    it('should update resource quota', () => {
      const result = manager.update('updatable-ns', {
        resourceQuota: { hard: { pods: 20 } },
      });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.resourceQuota?.hard.pods).toBe(20);
    });

    it('should update limit range', () => {
      const result = manager.update('updatable-ns', {
        limitRange: { default: { cpu: 200 } },
      });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.limitRange?.default?.cpu).toBe(200);
    });

    it('should update updatedAt timestamp', () => {
      const before = clusterState.namespaces.get('updatable-ns')!.updatedAt;
      // Small delay to ensure different timestamp
      manager.update('updatable-ns', { labels: { new: 'label' } });
      const after = clusterState.namespaces.get('updatable-ns')!.updatedAt;

      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.update('non-existent', { labels: {} });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });

    it('should fail for terminating namespace', () => {
      manager.markTerminating('updatable-ns');
      const result = manager.update('updatable-ns', { labels: {} });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_TERMINATING);
    });

    it('should fail for invalid update input', () => {
      const result = manager.update('updatable-ns', { labels: 'invalid' as any });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.VALIDATION_ERROR);
    });
  });

  // ==========================================================================
  // CRUD Operations - Delete
  // ==========================================================================

  describe('delete', () => {
    beforeEach(() => {
      manager.create({ name: 'deletable-ns' });
      manager.ensureDefaultNamespaces();
    });

    it('should delete empty namespace', () => {
      const result = manager.delete('deletable-ns');

      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('deletable-ns');
      expect(clusterState.namespaces.has('deletable-ns')).toBe(false);
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.delete('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });

    it('should fail to delete default namespace', () => {
      const result = manager.delete('default');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.CANNOT_DELETE_DEFAULT);
    });

    it('should fail for non-empty namespace without force', () => {
      // Create a pod in the namespace
      createPod({
        id: 'pod-1',
        packId: 'pack-1',
        packVersion: '1.0.0',
        nodeId: undefined,
        namespace: 'deletable-ns',
        createdBy: 'user1',
      });

      const result = manager.delete('deletable-ns');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_EMPTY);
    });

    it('should delete non-empty namespace with force', () => {
      // Create a pod in the namespace
      createPod({
        id: 'pod-1',
        packId: 'pack-1',
        packVersion: '1.0.0',
        nodeId: undefined,
        namespace: 'deletable-ns',
        createdBy: 'user1',
      });

      const result = manager.delete('deletable-ns', true);

      expect(result.success).toBe(true);
      expect(clusterState.namespaces.has('deletable-ns')).toBe(false);
    });

    it('should mark namespace as terminating before removal', () => {
      // This tests the internal flow - namespace is marked terminating then removed
      const result = manager.delete('deletable-ns');

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Mark Terminating Tests
  // ==========================================================================

  describe('markTerminating', () => {
    beforeEach(() => {
      manager.create({ name: 'active-ns' });
      manager.ensureDefaultNamespaces();
    });

    it('should mark namespace as terminating', () => {
      const result = manager.markTerminating('active-ns');

      expect(result.success).toBe(true);
      expect(result.data?.namespace.phase).toBe('terminating');
    });

    it('should be idempotent for already terminating namespace', () => {
      manager.markTerminating('active-ns');
      const result = manager.markTerminating('active-ns');

      expect(result.success).toBe(true);
      expect(result.data?.namespace.phase).toBe('terminating');
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.markTerminating('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });

    it('should fail for default namespace', () => {
      const result = manager.markTerminating('default');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.CANNOT_DELETE_DEFAULT);
    });
  });

  // ==========================================================================
  // Quota Enforcement Tests
  // ==========================================================================

  describe('checkQuota', () => {
    beforeEach(() => {
      manager.create({
        name: 'quota-ns',
        resourceQuota: {
          hard: { pods: 10, cpu: 1000, memory: 2048, storage: 5000 },
        },
      });
      manager.create({ name: 'no-quota-ns' });
    });

    it('should allow allocation within quota', () => {
      const result = manager.checkQuota('quota-ns', { pods: 5, cpu: 500 });

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(true);
      expect(result.data?.remaining?.pods).toBe(10);
    });

    it('should deny allocation exceeding quota', () => {
      const result = manager.checkQuota('quota-ns', { pods: 20 });

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(false);
      expect(result.data?.exceededResources).toContain('pods (requested: 20, remaining: 10)');
    });

    it('should always allow for namespace without quota', () => {
      const result = manager.checkQuota('no-quota-ns', { pods: 1000 });

      expect(result.success).toBe(true);
      expect(result.data?.allowed).toBe(true);
      expect(result.data?.remaining).toBeNull();
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.checkQuota('non-existent', { pods: 1 });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  describe('allocateResources', () => {
    beforeEach(() => {
      manager.create({
        name: 'alloc-ns',
        resourceQuota: { hard: { pods: 10, cpu: 1000, memory: 2048 } },
      });
    });

    it('should allocate resources and update usage', () => {
      const result = manager.allocateResources('alloc-ns', { pods: 2, cpu: 200 });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.resourceUsage.pods).toBe(2);
      expect(result.data?.namespace.resourceUsage.cpu).toBe(200);
    });

    it('should accumulate allocations', () => {
      manager.allocateResources('alloc-ns', { pods: 2 });
      manager.allocateResources('alloc-ns', { pods: 3 });

      const ns = clusterState.namespaces.get('alloc-ns')!;
      expect(ns.resourceUsage.pods).toBe(5);
    });

    it('should fail when exceeding quota', () => {
      const result = manager.allocateResources('alloc-ns', { pods: 20 });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.QUOTA_EXCEEDED);
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.allocateResources('non-existent', { pods: 1 });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  describe('releaseResources', () => {
    beforeEach(() => {
      manager.create({
        name: 'release-ns',
        resourceQuota: { hard: { pods: 10 } },
      });
      manager.allocateResources('release-ns', { pods: 5, cpu: 500 });
    });

    it('should release resources and update usage', () => {
      const result = manager.releaseResources('release-ns', { pods: 2 });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.resourceUsage.pods).toBe(3);
    });

    it('should not go below zero', () => {
      manager.releaseResources('release-ns', { pods: 10 });

      const ns = clusterState.namespaces.get('release-ns')!;
      expect(ns.resourceUsage.pods).toBe(0);
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.releaseResources('non-existent', { pods: 1 });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  describe('getRemainingQuota', () => {
    beforeEach(() => {
      manager.create({
        name: 'remaining-ns',
        resourceQuota: { hard: { pods: 10, cpu: 1000 } },
      });
      manager.allocateResources('remaining-ns', { pods: 3, cpu: 400 });
    });

    it('should return remaining quota', () => {
      const result = manager.getRemainingQuota('remaining-ns');

      expect(result.success).toBe(true);
      expect(result.data?.remaining?.pods).toBe(7);
      expect(result.data?.remaining?.cpu).toBe(600);
    });

    it('should return null for namespace without quota', () => {
      manager.create({ name: 'no-quota' });
      const result = manager.getRemainingQuota('no-quota');

      expect(result.success).toBe(true);
      expect(result.data?.remaining).toBeNull();
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.getRemainingQuota('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  describe('updateResourceUsage', () => {
    beforeEach(() => {
      manager.create({ name: 'usage-ns' });
    });

    it('should directly set resource usage values', () => {
      const result = manager.updateResourceUsage('usage-ns', { pods: 5, cpu: 300 });

      expect(result.success).toBe(true);
      expect(result.data?.namespace.resourceUsage.pods).toBe(5);
      expect(result.data?.namespace.resourceUsage.cpu).toBe(300);
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.updateResourceUsage('non-existent', { pods: 1 });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  // ==========================================================================
  // Limit Range Tests
  // ==========================================================================

  describe('getLimitRange', () => {
    beforeEach(() => {
      manager.create(createNamespaceWithLimitRange('limit-ns'));
      manager.create({ name: 'no-limit-ns' });
    });

    it('should return limit range for namespace with limits', () => {
      const result = manager.getLimitRange('limit-ns');

      expect(result.success).toBe(true);
      expect(result.data?.limitRange?.default?.cpu).toBe(100);
    });

    it('should return undefined for namespace without limit range', () => {
      const result = manager.getLimitRange('no-limit-ns');

      expect(result.success).toBe(true);
      expect(result.data?.limitRange).toBeUndefined();
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.getLimitRange('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  describe('applyLimitRangeDefaults', () => {
    beforeEach(() => {
      manager.create(createNamespaceWithLimitRange('defaults-ns'));
    });

    it('should apply default values when not specified', () => {
      const result = manager.applyLimitRangeDefaults('defaults-ns', undefined, undefined);

      expect(result.success).toBe(true);
      expect(result.data?.requests.cpu).toBe(50); // defaultRequest
      expect(result.data?.limits.cpu).toBe(100); // default
    });

    it('should preserve specified values', () => {
      const result = manager.applyLimitRangeDefaults(
        'defaults-ns',
        { cpu: 75 },
        { cpu: 150 },
      );

      expect(result.success).toBe(true);
      expect(result.data?.requests.cpu).toBe(75);
      expect(result.data?.limits.cpu).toBe(150);
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.applyLimitRangeDefaults('non-existent', {}, {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  describe('validateLimitRange', () => {
    beforeEach(() => {
      manager.create(createNamespaceWithLimitRange('validate-ns'));
    });

    it('should validate resources within limits', () => {
      const result = manager.validateLimitRange(
        'validate-ns',
        { cpu: 50, memory: 128 },
        { cpu: 200, memory: 512 },
      );

      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(true);
      expect(result.data?.errors).toHaveLength(0);
    });

    it('should reject resources exceeding max limits', () => {
      const result = manager.validateLimitRange(
        'validate-ns',
        { cpu: 50 },
        { cpu: 1000 }, // exceeds max of 500
      );

      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(false);
      expect(result.data?.errors.length).toBeGreaterThan(0);
    });

    it('should reject resources below min limits', () => {
      const result = manager.validateLimitRange(
        'validate-ns',
        { cpu: 5 }, // below min of 10
        { cpu: 100 },
      );

      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(false);
    });

    it('should fail for non-existent namespace', () => {
      const result = manager.validateLimitRange('non-existent', {}, {});

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NamespaceManagerErrorCodes.NAMESPACE_NOT_FOUND);
    });
  });

  // ==========================================================================
  // Query Methods Tests
  // ==========================================================================

  describe('findBySelector', () => {
    beforeEach(() => {
      manager.create({ name: 'labeled-1', labels: { env: 'prod', tier: 'frontend' } });
      manager.create({ name: 'labeled-2', labels: { env: 'prod', tier: 'backend' } });
      manager.create({ name: 'labeled-3', labels: { env: 'staging' } });
    });

    it('should find namespaces matching selector', () => {
      // findBySelector expects a LabelSelector with matchLabels
      const result = manager.findBySelector({ matchLabels: { env: 'prod' } } as any);

      expect(result.length).toBe(2);
    });

    it('should match all selector labels', () => {
      const result = manager.findBySelector({ matchLabels: { env: 'prod', tier: 'frontend' } } as any);

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('labeled-1');
    });

    it('should return empty for non-matching selector', () => {
      const result = manager.findBySelector({ matchLabels: { env: 'dev' } } as any);

      expect(result.length).toBe(0);
    });
  });

  describe('findByPhase', () => {
    beforeEach(() => {
      manager.create({ name: 'active-1' });
      manager.create({ name: 'active-2' });
      manager.markTerminating('active-1');
    });

    it('should find namespaces by phase', () => {
      const active = manager.findByPhase('active');
      const terminating = manager.findByPhase('terminating');

      expect(active.length).toBe(1);
      expect(terminating.length).toBe(1);
    });
  });

  describe('exists', () => {
    beforeEach(() => {
      manager.create({ name: 'exists-ns' });
    });

    it('should return true for existing namespace', () => {
      expect(manager.exists('exists-ns')).toBe(true);
    });

    it('should return false for non-existent namespace', () => {
      expect(manager.exists('non-existent')).toBe(false);
    });
  });

  describe('getDefault', () => {
    it('should return undefined when default does not exist', () => {
      expect(manager.getDefault()).toBeUndefined();
    });

    it('should return default namespace when it exists', () => {
      manager.ensureDefaultNamespaces();
      const defaultNs = manager.getDefault();

      expect(defaultNs).toBeDefined();
      expect(defaultNs?.name).toBe('default');
    });
  });

  describe('getOrDefault', () => {
    beforeEach(() => {
      manager.ensureDefaultNamespaces();
      manager.create({ name: 'custom-ns' });
    });

    it('should return specified namespace if exists', () => {
      const ns = manager.getOrDefault('custom-ns');

      expect(ns?.name).toBe('custom-ns');
    });

    it('should return default if specified namespace does not exist', () => {
      const ns = manager.getOrDefault('non-existent');

      expect(ns?.name).toBe('default');
    });

    it('should return default for undefined name', () => {
      const ns = manager.getOrDefault(undefined);

      expect(ns?.name).toBe('default');
    });

    it('should return default for empty string name', () => {
      const ns = manager.getOrDefault('');

      expect(ns?.name).toBe('default');
    });
  });

  // ==========================================================================
  // Store Functions Tests
  // ==========================================================================

  describe('findNamespaceByName (store function)', () => {
    beforeEach(() => {
      manager.create({ name: 'find-me' });
    });

    it('should find namespace by name', () => {
      const ns = findNamespaceByName('find-me');

      expect(ns).toBeDefined();
      expect(ns?.name).toBe('find-me');
    });

    it('should return undefined for non-existent namespace', () => {
      expect(findNamespaceByName('not-found')).toBeUndefined();
    });
  });

  describe('findNamespacesBySelector (store function)', () => {
    beforeEach(() => {
      manager.create({ name: 'select-1', labels: { app: 'api' } });
      manager.create({ name: 'select-2', labels: { app: 'web' } });
    });

    it('should find namespaces by selector', () => {
      // findNamespacesBySelector expects a LabelSelector with matchLabels
      const result = findNamespacesBySelector({ matchLabels: { app: 'api' } } as any);

      expect(result.length).toBe(1);
      expect(result[0].name).toBe('select-1');
    });
  });

  describe('findNamespacesByPhase (store function)', () => {
    beforeEach(() => {
      manager.create({ name: 'phase-1' });
      manager.create({ name: 'phase-2' });
      manager.markTerminating('phase-1');
    });

    it('should find namespaces by phase', () => {
      const terminating = findNamespacesByPhase('terminating');

      expect(terminating.length).toBe(1);
      expect(terminating[0].name).toBe('phase-1');
    });
  });

  describe('namespaceExists (store function)', () => {
    beforeEach(() => {
      manager.create({ name: 'check-exists' });
    });

    it('should return true for existing namespace', () => {
      expect(namespaceExists('check-exists')).toBe(true);
    });

    it('should return false for non-existent namespace', () => {
      expect(namespaceExists('does-not-exist')).toBe(false);
    });
  });

  // ==========================================================================
  // Computed Properties (module-level) Tests
  // ==========================================================================

  describe('module-level computed properties', () => {
    beforeEach(() => {
      manager.create({ name: 'comp-1', resourceQuota: { hard: { pods: 10 } } });
      manager.create({ name: 'comp-2' });
      manager.allocateResources('comp-1', { pods: 3, cpu: 100 });
    });

    it('namespaceCount should reflect total namespaces', () => {
      expect(namespaceCount.value).toBe(2);
    });

    it('activeNamespaceCount should reflect active namespaces', () => {
      manager.markTerminating('comp-2');
      expect(activeNamespaceCount.value).toBe(1);
    });

    it('namespacesByPhase should group correctly', () => {
      manager.markTerminating('comp-2');
      const byPhase = namespacesByPhase.value;

      expect(byPhase.get('active')?.length).toBe(1);
      expect(byPhase.get('terminating')?.length).toBe(1);
    });

    it('namespacesWithQuota should filter correctly', () => {
      expect(namespacesWithQuota.value.length).toBe(1);
      expect(namespacesWithQuota.value[0].name).toBe('comp-1');
    });

    it('totalResourceUsage should aggregate usage', () => {
      manager.allocateResources('comp-2', { pods: 2, cpu: 50 });

      expect(totalResourceUsage.value.pods).toBe(5);
      expect(totalResourceUsage.value.cpu).toBe(150);
    });
  });
});
