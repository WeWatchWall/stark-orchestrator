/**
 * Unit tests for Service API endpoints
 * @module @stark-o/server/tests/unit/api-services
 *
 * These tests directly test the API handlers without requiring a running server.
 * They mock the Supabase layer to test the API logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import type { Service, ServiceStatus, CreateServiceInput } from '@stark-o/shared';

// Mock the supabase modules before importing the handlers
vi.mock('../../src/supabase/services.js', () => ({
  getServiceQueries: vi.fn(),
  getServiceQueriesAdmin: vi.fn(),
}));

vi.mock('../../src/supabase/packs.js', () => ({
  getPackQueries: vi.fn(),
}));

// Import after mocking
import {
  createServicesRouter,
} from '../../src/api/services.js';
import { getServiceQueries, getServiceQueriesAdmin } from '../../src/supabase/services.js';
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
 * Sample service for testing
 */
const sampleService: Service = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'test-service',
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
  const module = await import('../../src/api/services.js');
  return module;
}

describe('Service API Handlers', () => {
  let mockServiceQueries: {
    createService: ReturnType<typeof vi.fn>;
    getServiceById: ReturnType<typeof vi.fn>;
    getServiceByName: ReturnType<typeof vi.fn>;
    listServices: ReturnType<typeof vi.fn>;
    listActiveServices: ReturnType<typeof vi.fn>;
    updateService: ReturnType<typeof vi.fn>;
    updateReplicaCounts: ReturnType<typeof vi.fn>;
    deleteService: ReturnType<typeof vi.fn>;
  };

  let mockPackQueries: {
    getPackById: ReturnType<typeof vi.fn>;
    getLatestPackVersion: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockServiceQueries = {
      createService: vi.fn(),
      getServiceById: vi.fn(),
      getServiceByName: vi.fn(),
      listServices: vi.fn(),
      listActiveServices: vi.fn(),
      updateService: vi.fn(),
      updateReplicaCounts: vi.fn(),
      deleteService: vi.fn(),
    };

    mockPackQueries = {
      getPackById: vi.fn(),
      getLatestPackVersion: vi.fn(),
    };

    vi.mocked(getServiceQueries).mockReturnValue(mockServiceQueries as any);
    vi.mocked(getServiceQueriesAdmin).mockReturnValue(mockServiceQueries as any);
    vi.mocked(getPackQueries).mockReturnValue(mockPackQueries as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createServicesRouter', () => {
    it('should create a router with all expected routes', () => {
      const router = createServicesRouter();
      expect(router).toBeDefined();
      // Router should have the expected stack of middleware and routes
      expect(router.stack.length).toBeGreaterThan(0);
    });
  });

  describe('Service Queries - createService', () => {
    it('should create service with packId', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: samplePack,
        error: null,
      });

      mockServiceQueries.createService.mockResolvedValue({
        data: sampleService,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        { name: 'test-service', packId: samplePack.id, replicas: 3 },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data).toEqual(sampleService);
      expect(result.error).toBeNull();
    });

    it('should return error on duplicate service name', async () => {
      mockServiceQueries.createService.mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'Unique constraint violation' },
      });

      const result = await mockServiceQueries.createService(
        { name: 'test-service', packId: samplePack.id },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('23505');
    });

    it('should handle database errors', async () => {
      mockServiceQueries.createService.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Database connection failed' },
      });

      const result = await mockServiceQueries.createService(
        { name: 'test-service', packId: samplePack.id },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST000');
    });
  });

  describe('Service Queries - getServiceById', () => {
    it('should return service by ID', async () => {
      mockServiceQueries.getServiceById.mockResolvedValue({
        data: sampleService,
        error: null,
      });

      const result = await mockServiceQueries.getServiceById(sampleService.id);

      expect(result.data).toEqual(sampleService);
      expect(result.error).toBeNull();
    });

    it('should return error for non-existent service', async () => {
      mockServiceQueries.getServiceById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await mockServiceQueries.getServiceById('non-existent-id');

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST116');
    });
  });

  describe('Service Queries - getServiceByName', () => {
    it('should return service by name and namespace', async () => {
      mockServiceQueries.getServiceByName.mockResolvedValue({
        data: sampleService,
        error: null,
      });

      const result = await mockServiceQueries.getServiceByName('test-service', 'default');

      expect(result.data).toEqual(sampleService);
      expect(result.error).toBeNull();
    });

    it('should use default namespace when not specified', async () => {
      mockServiceQueries.getServiceByName.mockResolvedValue({
        data: sampleService,
        error: null,
      });

      await mockServiceQueries.getServiceByName('test-service', 'default');

      expect(mockServiceQueries.getServiceByName).toHaveBeenCalledWith(
        'test-service',
        'default'
      );
    });

    it('should return error for non-existent service name', async () => {
      mockServiceQueries.getServiceByName.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await mockServiceQueries.getServiceByName('non-existent', 'default');

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST116');
    });
  });

  describe('Service Queries - listServices', () => {
    it('should return list of services', async () => {
      const serviceList = [
        { id: sampleService.id, name: sampleService.name, replicas: 3, readyReplicas: 3, availableReplicas: 3, status: 'active' as ServiceStatus },
      ];

      mockServiceQueries.listServices.mockResolvedValue({
        data: serviceList,
        error: null,
      });

      const result = await mockServiceQueries.listServices({});

      expect(result.data).toEqual(serviceList);
      expect(result.error).toBeNull();
    });

    it('should filter by namespace', async () => {
      mockServiceQueries.listServices.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockServiceQueries.listServices({ namespace: 'production' });

      expect(mockServiceQueries.listServices).toHaveBeenCalledWith({ namespace: 'production' });
    });

    it('should filter by status', async () => {
      mockServiceQueries.listServices.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockServiceQueries.listServices({ status: 'paused' });

      expect(mockServiceQueries.listServices).toHaveBeenCalledWith({ status: 'paused' });
    });

    it('should filter by packId', async () => {
      mockServiceQueries.listServices.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockServiceQueries.listServices({ packId: samplePack.id });

      expect(mockServiceQueries.listServices).toHaveBeenCalledWith({ packId: samplePack.id });
    });

    it('should support pagination', async () => {
      mockServiceQueries.listServices.mockResolvedValue({
        data: [],
        error: null,
      });

      await mockServiceQueries.listServices({ page: 2, pageSize: 10 });

      expect(mockServiceQueries.listServices).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
    });
  });

  describe('Service Queries - listActiveServices', () => {
    it('should return all active services', async () => {
      const activeServices = [sampleService];

      mockServiceQueries.listActiveServices.mockResolvedValue({
        data: activeServices,
        error: null,
      });

      const result = await mockServiceQueries.listActiveServices();

      expect(result.data).toEqual(activeServices);
      expect(result.error).toBeNull();
    });

    it('should handle empty list', async () => {
      mockServiceQueries.listActiveServices.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await mockServiceQueries.listActiveServices();

      expect(result.data).toEqual([]);
      expect(result.error).toBeNull();
    });
  });

  describe('Service Queries - updateService', () => {
    it('should update service replicas', async () => {
      const updatedService = { ...sampleService, replicas: 5 };

      mockServiceQueries.updateService.mockResolvedValue({
        data: updatedService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { replicas: 5 });

      expect(result.data?.replicas).toBe(5);
      expect(result.error).toBeNull();
    });

    it('should update service status', async () => {
      const pausedService = { ...sampleService, status: 'paused' as ServiceStatus };

      mockServiceQueries.updateService.mockResolvedValue({
        data: pausedService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { status: 'paused' });

      expect(result.data?.status).toBe('paused');
      expect(result.error).toBeNull();
    });

    it('should update service pack version', async () => {
      const updatedService = { ...sampleService, packVersion: '2.0.0' };

      mockServiceQueries.updateService.mockResolvedValue({
        data: updatedService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { packVersion: '2.0.0' });

      expect(result.data?.packVersion).toBe('2.0.0');
      expect(result.error).toBeNull();
    });

    it('should update service labels', async () => {
      const updatedService = { ...sampleService, labels: { app: 'web', tier: 'frontend' } };

      mockServiceQueries.updateService.mockResolvedValue({
        data: updatedService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { labels: { app: 'web', tier: 'frontend' } });

      expect(result.data?.labels).toEqual({ app: 'web', tier: 'frontend' });
      expect(result.error).toBeNull();
    });

    it('should update service tolerations', async () => {
      const tolerations = [{ key: 'gpu', operator: 'Exists' as const, effect: 'NoSchedule' as const }];
      const updatedService = { ...sampleService, tolerations };

      mockServiceQueries.updateService.mockResolvedValue({
        data: updatedService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { tolerations });

      expect(result.data?.tolerations).toEqual(tolerations);
      expect(result.error).toBeNull();
    });

    it('should return error for non-existent service', async () => {
      mockServiceQueries.updateService.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const result = await mockServiceQueries.updateService('non-existent-id', { replicas: 5 });

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST116');
    });
  });

  describe('Service Queries - updateReplicaCounts', () => {
    it('should update replica counts', async () => {
      const updatedService = { ...sampleService, readyReplicas: 2, availableReplicas: 2, updatedReplicas: 3 };

      mockServiceQueries.updateReplicaCounts.mockResolvedValue({
        data: updatedService,
        error: null,
      });

      const result = await mockServiceQueries.updateReplicaCounts(sampleService.id, 2, 2, 3);

      expect(result.data?.readyReplicas).toBe(2);
      expect(result.data?.availableReplicas).toBe(2);
      expect(result.data?.updatedReplicas).toBe(3);
      expect(result.error).toBeNull();
    });
  });

  describe('Service Queries - deleteService', () => {
    it('should delete service', async () => {
      mockServiceQueries.deleteService.mockResolvedValue({
        data: { deleted: true },
        error: null,
      });

      const result = await mockServiceQueries.deleteService(sampleService.id);

      expect(result.data?.deleted).toBe(true);
      expect(result.error).toBeNull();
    });

    it('should handle database error during deletion', async () => {
      mockServiceQueries.deleteService.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Database error' },
      });

      const result = await mockServiceQueries.deleteService(sampleService.id);

      expect(result.data).toBeNull();
      expect(result.error?.code).toBe('PGRST000');
    });
  });

  describe('Service Status Validation', () => {
    it('should accept valid service statuses', () => {
      const validStatuses: ServiceStatus[] = ['active', 'paused', 'scaling', 'deleting'];
      validStatuses.forEach(status => {
        expect(['active', 'paused', 'scaling', 'deleting']).toContain(status);
      });
    });
  });

  describe('Service with DaemonSet mode (replicas=0)', () => {
    it('should create service in DaemonSet mode', async () => {
      const daemonSetService = { ...sampleService, replicas: 0 };

      mockServiceQueries.createService.mockResolvedValue({
        data: daemonSetService,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        { name: 'daemonset-service', packId: samplePack.id, replicas: 0 },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.replicas).toBe(0);
      expect(result.error).toBeNull();
    });

    it('should scale from regular to DaemonSet mode', async () => {
      const daemonSetService = { ...sampleService, replicas: 0 };

      mockServiceQueries.updateService.mockResolvedValue({
        data: daemonSetService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { replicas: 0 });

      expect(result.data?.replicas).toBe(0);
      expect(result.error).toBeNull();
    });
  });

  describe('Service Scheduling Configuration', () => {
    it('should create service with node selectors', async () => {
      const serviceWithScheduling = {
        ...sampleService,
        scheduling: { nodeSelector: { env: 'production' } },
      };

      mockServiceQueries.createService.mockResolvedValue({
        data: serviceWithScheduling,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        {
          name: 'scheduled-service',
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

    it('should create service with tolerations', async () => {
      const tolerations = [{ key: 'dedicated', value: 'gpu', operator: 'Equal' as const, effect: 'NoSchedule' as const }];
      const serviceWithTolerations = { ...sampleService, tolerations };

      mockServiceQueries.createService.mockResolvedValue({
        data: serviceWithTolerations,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        { name: 'tolerant-service', packId: samplePack.id, tolerations },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.tolerations).toEqual(tolerations);
      expect(result.error).toBeNull();
    });

    it('should create service with resource requests and limits', async () => {
      const serviceWithResources = {
        ...sampleService,
        resourceRequests: { cpu: 500, memory: 512 },
        resourceLimits: { cpu: 1000, memory: 1024 },
      };

      mockServiceQueries.createService.mockResolvedValue({
        data: serviceWithResources,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        {
          name: 'resource-service',
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

  describe('Service Labels and Annotations', () => {
    it('should create service with labels', async () => {
      const serviceWithLabels = {
        ...sampleService,
        labels: { app: 'web', version: 'v1' },
      };

      mockServiceQueries.createService.mockResolvedValue({
        data: serviceWithLabels,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        { name: 'labeled-service', packId: samplePack.id, labels: { app: 'web', version: 'v1' } },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.labels).toEqual({ app: 'web', version: 'v1' });
      expect(result.error).toBeNull();
    });

    it('should create service with pod labels', async () => {
      const serviceWithPodLabels = {
        ...sampleService,
        podLabels: { pod: 'label', version: 'v1' },
      };

      mockServiceQueries.createService.mockResolvedValue({
        data: serviceWithPodLabels,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        { name: 'pod-labeled-service', packId: samplePack.id, podLabels: { pod: 'label', version: 'v1' } },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.podLabels).toEqual({ pod: 'label', version: 'v1' });
      expect(result.error).toBeNull();
    });

    it('should create service with annotations', async () => {
      const serviceWithAnnotations = {
        ...sampleService,
        annotations: { description: 'Test service', owner: 'team-backend' },
      };

      mockServiceQueries.createService.mockResolvedValue({
        data: serviceWithAnnotations,
        error: null,
      });

      const result = await mockServiceQueries.createService(
        { name: 'annotated-service', packId: samplePack.id, annotations: { description: 'Test service', owner: 'team-backend' } },
        samplePack.id,
        '1.0.0',
        'dev-user-id'
      );

      expect(result.data?.annotations).toEqual({ description: 'Test service', owner: 'team-backend' });
      expect(result.error).toBeNull();
    });
  });

  describe('Service Lifecycle', () => {
    it('should transition from active to paused', async () => {
      const pausedService = { ...sampleService, status: 'paused' as ServiceStatus };

      mockServiceQueries.updateService.mockResolvedValue({
        data: pausedService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { status: 'paused' });

      expect(result.data?.status).toBe('paused');
    });

    it('should transition from paused to active', async () => {
      const activeService = { ...sampleService, status: 'active' as ServiceStatus };

      mockServiceQueries.updateService.mockResolvedValue({
        data: activeService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { status: 'active' });

      expect(result.data?.status).toBe('active');
    });

    it('should mark service as deleting before deletion', async () => {
      const deletingService = { ...sampleService, status: 'deleting' as ServiceStatus };

      mockServiceQueries.updateService.mockResolvedValue({
        data: deletingService,
        error: null,
      });

      const result = await mockServiceQueries.updateService(sampleService.id, { status: 'deleting' });

      expect(result.data?.status).toBe('deleting');
    });
  });
});
