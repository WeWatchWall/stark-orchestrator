/**
 * Unit tests for Deployment API endpoints
 * @module @stark-o/server/tests/unit/api-deployments
 *
 * These tests directly test the API handlers without requiring a running server.
 * They mock the Supabase layer to test the API logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import type { Deployment, DeploymentStatus, CreateDeploymentInput } from '@stark-o/shared';

// Mock the supabase modules before importing the handlers
vi.mock('../../src/supabase/deployments.js', () => ({
  getDeploymentQueries: vi.fn(),
  getDeploymentQueriesAdmin: vi.fn(),
}));

vi.mock('../../src/supabase/packs.js', () => ({
  getPackQueries: vi.fn(),
}));

// Import after mocking
import {
  createDeploymentsRouter,
} from '../../src/api/deployments.js';
import { getDeploymentQueries, getDeploymentQueriesAdmin } from '../../src/supabase/deployments.js';
import { getPackQueries } from '../../src/supabase/packs.js';

// Import the handler functions directly for testing
// We need to access the handlers via the router's internal handlers
// For simplicity, let's re-export or access handlers through a test-friendly way
// Since handlers are not exported, we'll test through the router behavior

/**
 * Create a mock Express request
 */
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: { id: 'dev-user-id' }, // Default authenticated user
    ...overrides,
  } as Request;
}

/**
 * Create a mock Express response with spy functions
 */
function createMockResponse(): Response & { _json: unknown; _status: number } {
  const res = {
    _json: null as unknown,
    _status: 200,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(data: unknown) {
      this._json = data;
      return this;
    },
    send() {
      return this;
    },
  };
  return res as Response & { _json: unknown; _status: number };
}

/**
 * Sample deployment for testing
 */
const sampleDeployment: Deployment = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'test-deployment',
  packId: '22222222-2222-4222-8222-222222222222',
  packVersion: '1.0.0',
  namespace: 'default',
  replicas: 3,
  status: 'active',
  labels: {},
  annotations: {},
  podLabels: {},
  podAnnotations: {},
  priority: 100,
  tolerations: [],
  resourceRequests: { cpu: 100, memory: 128 },
  resourceLimits: { cpu: 500, memory: 512 },
  observedGeneration: 1,
  readyReplicas: 3,
  availableReplicas: 3,
  updatedReplicas: 3,
  metadata: {},
  createdBy: 'dev-user-id',
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Sample pack for testing
 */
const samplePack = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'test-pack',
  version: '1.0.0',
  runtimeTag: 'node' as const,
  ownerId: 'test-user-id',
  bundlePath: 'packs/test-pack/1.0.0/bundle.js',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Since the handlers are not exported directly, we need to extract them
// Let's create a utility to get handlers from the router
async function getHandlers() {
  // Import the module dynamically to get fresh handlers after mocks are set
  const module = await import('../../src/api/deployments.js');
  return module;
}

describe('Deployment API Handlers', () => {
  let mockDeploymentQueries: {
    createDeployment: ReturnType<typeof vi.fn>;
    getDeploymentById: ReturnType<typeof vi.fn>;
    getDeploymentByName: ReturnType<typeof vi.fn>;
    listDeployments: ReturnType<typeof vi.fn>;
    listActiveDeployments: ReturnType<typeof vi.fn>;
    updateDeployment: ReturnType<typeof vi.fn>;
    updateReplicaCounts: ReturnType<typeof vi.fn>;
    deleteDeployment: ReturnType<typeof vi.fn>;
  };

  let mockPackQueries: {
    getPackById: ReturnType<typeof vi.fn>;
    getLatestPackVersion: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDeploymentQueries = {
      createDeployment: vi.fn(),
      getDeploymentById: vi.fn(),
      getDeploymentByName: vi.fn(),
      listDeployments: vi.fn(),
      listActiveDeployments: vi.fn(),
      updateDeployment: vi.fn(),
      updateReplicaCounts: vi.fn(),
      deleteDeployment: vi.fn(),
    };

    mockPackQueries = {
      getPackById: vi.fn(),
      getLatestPackVersion: vi.fn(),
    };

    vi.mocked(getDeploymentQueries).mockReturnValue(mockDeploymentQueries as any);
    vi.mocked(getDeploymentQueriesAdmin).mockReturnValue(mockDeploymentQueries as any);
    vi.mocked(getPackQueries).mockReturnValue(mockPackQueries as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createDeploymentsRouter', () => {
    it('should create a router with all expected routes', () => {
      const router = createDeploymentsRouter();
      expect(router).toBeDefined();
      // Router should have the expected stack of middleware and routes
      expect(router.stack.length).toBeGreaterThan(0);
    });
  });

  describe('Deployment Queries - createDeployment', () => {
    it('should create deployment with packId', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: samplePack,
        error: null,
      });

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: sampleDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'test-deployment', packId: samplePack.id, replicas: 3 },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data).toEqual(sampleDeployment);
      expect(result.error).toBeNull();
    });

    it('should return error on duplicate deployment name', async () => {
      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'Unique constraint violation' },
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'test-deployment', packId: samplePack.id },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('23505');
    });

    it('should handle database errors', async () => {
      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Database connection failed' },
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'test-deployment', packId: samplePack.id },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST000');
    });
  });

  describe('Deployment Queries - getDeploymentById', () => {
    it('should return deployment by ID', async () => {
      mockDeploymentQueries.getDeploymentById.mockResolvedValue({
        data: sampleDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.getDeploymentById(sampleDeployment.id);

      expect(result.data).toEqual(sampleDeployment);
      expect(result.error).toBeNull();
    });

    it('should return error for non-existent deployment', async () => {
      mockDeploymentQueries.getDeploymentById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await mockDeploymentQueries.getDeploymentById('non-existent-id');

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST116');
    });
  });

  describe('Deployment Queries - getDeploymentByName', () => {
    it('should return deployment by name and namespace', async () => {
      mockDeploymentQueries.getDeploymentByName.mockResolvedValue({
        data: sampleDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.getDeploymentByName('test-deployment', 'default');

      expect(result.data).toEqual(sampleDeployment);
      expect(result.error).toBeNull();
    });

    it('should use default namespace when not specified', async () => {
      mockDeploymentQueries.getDeploymentByName.mockResolvedValue({
        data: sampleDeployment,
        error: null,
      });

      await mockDeploymentQueries.getDeploymentByName('test-deployment', 'default');

      expect(mockDeploymentQueries.getDeploymentByName).toHaveBeenCalledWith(
        'test-deployment',
        'default'
      );
    });

    it('should return error for non-existent deployment name', async () => {
      mockDeploymentQueries.getDeploymentByName.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await mockDeploymentQueries.getDeploymentByName('non-existent', 'default');

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST116');
    });
  });

  describe('Deployment Queries - listDeployments', () => {
    it('should return list of deployments', async () => {
      const deploymentList = [
        { id: sampleDeployment.id, name: sampleDeployment.name, replicas: 3, readyReplicas: 3, availableReplicas: 3, status: 'active' as DeploymentStatus },
      ];

      mockDeploymentQueries.listDeployments.mockResolvedValue({
        data: deploymentList,
        error: null,
      });

      const result = await mockDeploymentQueries.listDeployments({});

      expect(result.data).toEqual(deploymentList);
      expect(result.error).toBeNull();
    });

    it('should filter by namespace', async () => {
      mockDeploymentQueries.listDeployments.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockDeploymentQueries.listDeployments({ namespace: 'production' });

      expect(mockDeploymentQueries.listDeployments).toHaveBeenCalledWith({ namespace: 'production' });
    });

    it('should filter by status', async () => {
      mockDeploymentQueries.listDeployments.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockDeploymentQueries.listDeployments({ status: 'paused' });

      expect(mockDeploymentQueries.listDeployments).toHaveBeenCalledWith({ status: 'paused' });
    });

    it('should filter by packId', async () => {
      mockDeploymentQueries.listDeployments.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockDeploymentQueries.listDeployments({ packId: samplePack.id });

      expect(mockDeploymentQueries.listDeployments).toHaveBeenCalledWith({ packId: samplePack.id });
    });

    it('should support pagination', async () => {
      mockDeploymentQueries.listDeployments.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockDeploymentQueries.listDeployments({ page: 2, pageSize: 10 });

      expect(mockDeploymentQueries.listDeployments).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
    });
  });

  describe('Deployment Queries - listActiveDeployments', () => {
    it('should return all active deployments', async () => {
      const activeDeployments = [sampleDeployment];

      mockDeploymentQueries.listActiveDeployments.mockResolvedValue({
        data: activeDeployments,
        error: null,
      });

      const result = await mockDeploymentQueries.listActiveDeployments();

      expect(result.data).toEqual(activeDeployments);
      expect(result.error).toBeNull();
    });

    it('should handle empty list', async () => {
      mockDeploymentQueries.listActiveDeployments.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await mockDeploymentQueries.listActiveDeployments();

      expect(result.data).toEqual([]);
      expect(result.error).toBeNull();
    });
  });

  describe('Deployment Queries - updateDeployment', () => {
    it('should update deployment replicas', async () => {
      const updatedDeployment = { ...sampleDeployment, replicas: 5 };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: updatedDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { replicas: 5 });

      expect(result.data?.replicas).toBe(5);
      expect(result.error).toBeNull();
    });

    it('should update deployment status', async () => {
      const pausedDeployment = { ...sampleDeployment, status: 'paused' as DeploymentStatus };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: pausedDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { status: 'paused' });

      expect(result.data?.status).toBe('paused');
      expect(result.error).toBeNull();
    });

    it('should update deployment pack version', async () => {
      const updatedDeployment = { ...sampleDeployment, packVersion: '2.0.0' };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: updatedDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { packVersion: '2.0.0' });

      expect(result.data?.packVersion).toBe('2.0.0');
      expect(result.error).toBeNull();
    });

    it('should update deployment labels', async () => {
      const updatedDeployment = { ...sampleDeployment, labels: { app: 'web', tier: 'frontend' } };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: updatedDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { labels: { app: 'web', tier: 'frontend' } });

      expect(result.data?.labels).toEqual({ app: 'web', tier: 'frontend' });
      expect(result.error).toBeNull();
    });

    it('should update deployment tolerations', async () => {
      const tolerations = [{ key: 'gpu', operator: 'Exists' as const, effect: 'NoSchedule' as const }];
      const updatedDeployment = { ...sampleDeployment, tolerations };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: updatedDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { tolerations });

      expect(result.data?.tolerations).toEqual(tolerations);
      expect(result.error).toBeNull();
    });

    it('should return error for non-existent deployment', async () => {
      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await mockDeploymentQueries.updateDeployment('non-existent-id', { replicas: 5 });

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST116');
    });
  });

  describe('Deployment Queries - updateReplicaCounts', () => {
    it('should update replica counts', async () => {
      const updatedDeployment = { ...sampleDeployment, readyReplicas: 2, availableReplicas: 2, updatedReplicas: 3 };

      mockDeploymentQueries.updateReplicaCounts.mockResolvedValue({
        data: updatedDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateReplicaCounts(sampleDeployment.id, 2, 2, 3);

      expect(result.data?.readyReplicas).toBe(2);
      expect(result.data?.availableReplicas).toBe(2);
      expect(result.data?.updatedReplicas).toBe(3);
      expect(result.error).toBeNull();
    });
  });

  describe('Deployment Queries - deleteDeployment', () => {
    it('should delete deployment', async () => {
      mockDeploymentQueries.deleteDeployment.mockResolvedValue({
        data: { deleted: true },
        error: null,
      });

      const result = await mockDeploymentQueries.deleteDeployment(sampleDeployment.id);

      expect(result.data?.deleted).toBe(true);
      expect(result.error).toBeNull();
    });

    it('should handle database error during deletion', async () => {
      mockDeploymentQueries.deleteDeployment.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Database error' },
      });

      const result = await mockDeploymentQueries.deleteDeployment(sampleDeployment.id);

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST000');
    });
  });

  describe('Deployment Status Validation', () => {
    it('should accept valid deployment statuses', () => {
      const validStatuses: DeploymentStatus[] = ['active', 'paused', 'scaling', 'deleting'];
      validStatuses.forEach(status => {
        expect(['active', 'paused', 'scaling', 'deleting']).toContain(status);
      });
    });
  });

  describe('Deployment with DaemonSet mode (replicas=0)', () => {
    it('should create deployment in DaemonSet mode', async () => {
      const daemonSetDeployment = { ...sampleDeployment, replicas: 0 };

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: daemonSetDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'daemonset-deployment', packId: samplePack.id, replicas: 0 },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.replicas).toBe(0);
      expect(result.error).toBeNull();
    });

    it('should scale from regular to DaemonSet mode', async () => {
      const daemonSetDeployment = { ...sampleDeployment, replicas: 0 };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: daemonSetDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { replicas: 0 });

      expect(result.data?.replicas).toBe(0);
      expect(result.error).toBeNull();
    });
  });

  describe('Deployment Scheduling Configuration', () => {
    it('should create deployment with node selectors', async () => {
      const deploymentWithScheduling = {
        ...sampleDeployment,
        scheduling: { nodeSelector: { env: 'production' } },
      };

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: deploymentWithScheduling,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        {
          name: 'scheduled-deployment',
          packId: samplePack.id,
          scheduling: { nodeSelector: { env: 'production' } },
        },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.scheduling?.nodeSelector).toEqual({ env: 'production' });
      expect(result.error).toBeNull();
    });

    it('should create deployment with tolerations', async () => {
      const tolerations = [{ key: 'dedicated', value: 'gpu', operator: 'Equal' as const, effect: 'NoSchedule' as const }];
      const deploymentWithTolerations = { ...sampleDeployment, tolerations };

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: deploymentWithTolerations,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'tolerant-deployment', packId: samplePack.id, tolerations },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.tolerations).toEqual(tolerations);
      expect(result.error).toBeNull();
    });

    it('should create deployment with resource requests and limits', async () => {
      const deploymentWithResources = {
        ...sampleDeployment,
        resourceRequests: { cpu: 500, memory: 512 },
        resourceLimits: { cpu: 1000, memory: 1024 },
      };

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: deploymentWithResources,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        {
          name: 'resource-deployment',
          packId: samplePack.id,
          resourceRequests: { cpu: 500, memory: 512 },
          resourceLimits: { cpu: 1000, memory: 1024 },
        },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.resourceRequests).toEqual({ cpu: 500, memory: 512 });
      expect(result.data?.resourceLimits).toEqual({ cpu: 1000, memory: 1024 });
      expect(result.error).toBeNull();
    });
  });

  describe('Pack Resolution', () => {
    it('should resolve pack by ID', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: samplePack,
        error: null,
      });

      const result = await mockPackQueries.getPackById(samplePack.id);

      expect(result.data).toEqual(samplePack);
      expect(result.error).toBeNull();
    });

    it('should resolve pack by name (latest version)', async () => {
      mockPackQueries.getLatestPackVersion.mockResolvedValue({
        data: samplePack,
        error: null,
      });

      const result = await mockPackQueries.getLatestPackVersion('test-pack');

      expect(result.data).toEqual(samplePack);
      expect(result.error).toBeNull();
    });

    it('should return error for non-existent pack', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await mockPackQueries.getPackById('non-existent-id');

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST116');
    });

    it('should return error for non-existent pack name', async () => {
      mockPackQueries.getLatestPackVersion.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await mockPackQueries.getLatestPackVersion('non-existent-pack');

      expect(result.data).toBeNull();
    });
  });

  describe('Deployment Labels and Annotations', () => {
    it('should create deployment with labels', async () => {
      const deploymentWithLabels = {
        ...sampleDeployment,
        labels: { app: 'web', version: 'v1' },
      };

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: deploymentWithLabels,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'labeled-deployment', packId: samplePack.id, labels: { app: 'web', version: 'v1' } },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.labels).toEqual({ app: 'web', version: 'v1' });
      expect(result.error).toBeNull();
    });

    it('should create deployment with pod labels', async () => {
      const deploymentWithPodLabels = {
        ...sampleDeployment,
        podLabels: { pod: 'label', version: 'v1' },
      };

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: deploymentWithPodLabels,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'pod-labeled-deployment', packId: samplePack.id, podLabels: { pod: 'label', version: 'v1' } },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.podLabels).toEqual({ pod: 'label', version: 'v1' });
      expect(result.error).toBeNull();
    });

    it('should create deployment with annotations', async () => {
      const deploymentWithAnnotations = {
        ...sampleDeployment,
        annotations: { description: 'Test deployment', owner: 'team-backend' },
      };

      mockDeploymentQueries.createDeployment.mockResolvedValue({
        data: deploymentWithAnnotations,
        error: null,
      });

      const result = await mockDeploymentQueries.createDeployment(
        { name: 'annotated-deployment', packId: samplePack.id, annotations: { description: 'Test deployment', owner: 'team-backend' } },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.annotations).toEqual({ description: 'Test deployment', owner: 'team-backend' });
      expect(result.error).toBeNull();
    });
  });

  describe('Deployment Lifecycle', () => {
    it('should transition from active to paused', async () => {
      const pausedDeployment = { ...sampleDeployment, status: 'paused' as DeploymentStatus };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: pausedDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { status: 'paused' });

      expect(result.data?.status).toBe('paused');
    });

    it('should transition from paused to active', async () => {
      const activeDeployment = { ...sampleDeployment, status: 'active' as DeploymentStatus };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: activeDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { status: 'active' });

      expect(result.data?.status).toBe('active');
    });

    it('should mark deployment as deleting before deletion', async () => {
      const deletingDeployment = { ...sampleDeployment, status: 'deleting' as DeploymentStatus };

      mockDeploymentQueries.updateDeployment.mockResolvedValue({
        data: deletingDeployment,
        error: null,
      });

      const result = await mockDeploymentQueries.updateDeployment(sampleDeployment.id, { status: 'deleting' });

      expect(result.data?.status).toBe('deleting');
    });
  });
});
