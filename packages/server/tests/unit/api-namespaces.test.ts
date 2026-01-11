/**
 * Unit tests for Namespace API endpoints
 * @module @stark-o/server/tests/unit/api-namespaces
 *
 * These tests directly test the API handlers without requiring a running server.
 * They mock the Supabase layer to test the API logic in isolation.
 *
 * TDD: These tests are written FIRST and will FAIL until T118s and T118t are implemented.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import type {
  Namespace,
  CreateNamespaceInput,
  UpdateNamespaceInput,
  ResourceUsage,
} from '@stark-o/shared';

// Mock the supabase modules before importing the handlers
vi.mock('../../src/supabase/namespaces.js', () => ({
  getNamespaceQueries: vi.fn(),
}));

// Import after mocking
import {
  createNamespace,
  listNamespaces,
  getNamespaceByName,
  updateNamespace,
  deleteNamespace,
} from '../../src/api/namespaces.js';
import { getNamespaceQueries } from '../../src/supabase/namespaces.js';

/**
 * Create a mock Express request
 */
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
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
 * Default resource usage for testing
 */
const defaultResourceUsage: ResourceUsage = {
  pods: 0,
  cpu: 0,
  memory: 0,
  storage: 0,
};

/**
 * Sample namespace for testing
 */
const sampleNamespace: Namespace = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'test-namespace',
  phase: 'active',
  labels: { team: 'backend' },
  annotations: {},
  resourceQuota: {
    hard: { pods: 10, cpu: 4000, memory: 8192 },
  },
  limitRange: {
    default: { cpu: 500, memory: 512 },
    defaultRequest: { cpu: 100, memory: 128 },
  },
  resourceUsage: defaultResourceUsage,
  createdBy: 'dev-user-id',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Namespace API Handlers', () => {
  let mockNamespaceQueries: {
    createNamespace: ReturnType<typeof vi.fn>;
    getNamespaceById: ReturnType<typeof vi.fn>;
    getNamespaceByName: ReturnType<typeof vi.fn>;
    listNamespaces: ReturnType<typeof vi.fn>;
    listNamespaceItems: ReturnType<typeof vi.fn>;
    countNamespaces: ReturnType<typeof vi.fn>;
    updateNamespace: ReturnType<typeof vi.fn>;
    deleteNamespace: ReturnType<typeof vi.fn>;
    namespaceExists: ReturnType<typeof vi.fn>;
    markForDeletion: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockNamespaceQueries = {
      createNamespace: vi.fn(),
      getNamespaceById: vi.fn(),
      getNamespaceByName: vi.fn(),
      listNamespaces: vi.fn(),
      listNamespaceItems: vi.fn(),
      countNamespaces: vi.fn(),
      updateNamespace: vi.fn(),
      deleteNamespace: vi.fn(),
      namespaceExists: vi.fn(),
      markForDeletion: vi.fn(),
    };

    vi.mocked(getNamespaceQueries).mockReturnValue(mockNamespaceQueries as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/namespaces - createNamespace', () => {
    it('should return 401 when no authorization header', async () => {
      const req = createMockRequest({
        body: { name: 'test-namespace' },
        headers: {},
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required to create a namespace',
        },
      });
    });

    it('should return 400 for missing name field', async () => {
      const req = createMockRequest({
        body: {},
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            name: expect.objectContaining({ code: 'REQUIRED' }),
          },
        },
      });
    });

    it('should return 400 for invalid namespace name format (starts with number)', async () => {
      const req = createMockRequest({
        body: { name: '123-invalid' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            name: expect.objectContaining({ code: 'INVALID_FORMAT' }),
          },
        },
      });
    });

    it('should return 400 for namespace name with uppercase letters', async () => {
      const req = createMockRequest({
        body: { name: 'Test-Namespace' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });

    it('should return 400 for reserved namespace name', async () => {
      const req = createMockRequest({
        body: { name: 'default' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            name: expect.objectContaining({ code: 'RESERVED' }),
          },
        },
      });
    });

    it('should return 400 for reserved stark-system namespace', async () => {
      const req = createMockRequest({
        body: { name: 'stark-system' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            name: expect.objectContaining({ code: 'RESERVED' }),
          },
        },
      });
    });

    it('should return 400 for namespace name exceeding 63 characters', async () => {
      const req = createMockRequest({
        body: { name: 'a'.repeat(64) },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          details: {
            name: expect.objectContaining({ code: 'TOO_LONG' }),
          },
        },
      });
    });

    it('should return 400 for invalid resource quota (negative pods)', async () => {
      const req = createMockRequest({
        body: {
          name: 'test-namespace',
          resourceQuota: { hard: { pods: -1 } },
        },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });

    it('should return 400 for invalid limit range (min > max)', async () => {
      const req = createMockRequest({
        body: {
          name: 'test-namespace',
          limitRange: {
            min: { cpu: 1000 },
            max: { cpu: 500 },
          },
        },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });

    it('should return 409 when namespace already exists', async () => {
      mockNamespaceQueries.namespaceExists.mockResolvedValue({ data: true, error: null });

      const req = createMockRequest({
        body: { name: 'test-namespace' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(409);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Namespace test-namespace already exists',
        },
      });
    });

    it('should return 201 and create namespace successfully', async () => {
      mockNamespaceQueries.namespaceExists.mockResolvedValue({ data: false, error: null });
      mockNamespaceQueries.createNamespace.mockResolvedValue({ data: sampleNamespace, error: null });

      const req = createMockRequest({
        body: { name: 'test-namespace' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(201);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          namespace: expect.objectContaining({
            id: sampleNamespace.id,
            name: 'test-namespace',
            phase: 'active',
          }),
        },
      });

      expect(mockNamespaceQueries.createNamespace).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-namespace',
          createdBy: 'dev-user-id',
        })
      );
    });

    it('should create namespace with labels and resource quota', async () => {
      const namespaceWithOptions = {
        ...sampleNamespace,
        labels: { team: 'backend', env: 'dev' },
        resourceQuota: { hard: { pods: 20, cpu: 8000 } },
      };

      mockNamespaceQueries.namespaceExists.mockResolvedValue({ data: false, error: null });
      mockNamespaceQueries.createNamespace.mockResolvedValue({ data: namespaceWithOptions, error: null });

      const req = createMockRequest({
        body: {
          name: 'test-namespace',
          labels: { team: 'backend', env: 'dev' },
          resourceQuota: { hard: { pods: 20, cpu: 8000 } },
        },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(201);
      expect(mockNamespaceQueries.createNamespace).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: { team: 'backend', env: 'dev' },
          resourceQuota: { hard: { pods: 20, cpu: 8000 } },
        })
      );
    });

    it('should handle database error during namespace existence check', async () => {
      mockNamespaceQueries.namespaceExists.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Connection failed' },
      });

      const req = createMockRequest({
        body: { name: 'test-namespace' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createNamespace(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
        },
      });
    });
  });

  describe('GET /api/namespaces - listNamespaces', () => {
    it('should return paginated list of namespaces', async () => {
      mockNamespaceQueries.countNamespaces.mockResolvedValue({ data: 2, error: null });
      mockNamespaceQueries.listNamespaceItems.mockResolvedValue({
        data: [
          { ...sampleNamespace, id: 'ns-1', name: 'namespace-1' },
          { ...sampleNamespace, id: 'ns-2', name: 'namespace-2' },
        ],
        error: null,
      });

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();

      await listNamespaces(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          namespaces: expect.arrayContaining([
            expect.objectContaining({ id: 'ns-1', name: 'namespace-1' }),
            expect.objectContaining({ id: 'ns-2', name: 'namespace-2' }),
          ]),
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    });

    it('should filter by phase', async () => {
      mockNamespaceQueries.countNamespaces.mockResolvedValue({ data: 1, error: null });
      mockNamespaceQueries.listNamespaceItems.mockResolvedValue({
        data: [{ ...sampleNamespace, phase: 'terminating' }],
        error: null,
      });

      const req = createMockRequest({ query: { phase: 'terminating' } });
      const res = createMockResponse();

      await listNamespaces(req, res);

      expect(mockNamespaceQueries.listNamespaceItems).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'terminating' })
      );
    });

    it('should return 400 for invalid phase filter', async () => {
      const req = createMockRequest({ query: { phase: 'invalid' } });
      const res = createMockResponse();

      await listNamespaces(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.stringContaining('Invalid phase'),
        },
      });
    });

    it('should filter by search term', async () => {
      mockNamespaceQueries.countNamespaces.mockResolvedValue({ data: 1, error: null });
      mockNamespaceQueries.listNamespaceItems.mockResolvedValue({
        data: [{ ...sampleNamespace, labels: { team: 'backend' } }],
        error: null,
      });

      const req = createMockRequest({ query: { search: 'backend' } });
      const res = createMockResponse();

      await listNamespaces(req, res);

      expect(mockNamespaceQueries.listNamespaceItems).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'backend' })
      );
    });

    it('should handle pagination parameters', async () => {
      mockNamespaceQueries.countNamespaces.mockResolvedValue({ data: 50, error: null });
      mockNamespaceQueries.listNamespaceItems.mockResolvedValue({ data: [], error: null });

      const req = createMockRequest({ query: { page: '3', pageSize: '10' } });
      const res = createMockResponse();

      await listNamespaces(req, res);

      expect(mockNamespaceQueries.listNamespaceItems).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 20, // (page 3 - 1) * 10
        })
      );
    });

    it('should clamp pageSize to maximum of 100', async () => {
      mockNamespaceQueries.countNamespaces.mockResolvedValue({ data: 0, error: null });
      mockNamespaceQueries.listNamespaceItems.mockResolvedValue({ data: [], error: null });

      const req = createMockRequest({ query: { pageSize: '500' } });
      const res = createMockResponse();

      await listNamespaces(req, res);

      expect(mockNamespaceQueries.listNamespaceItems).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  describe('GET /api/namespaces/:name - getNamespaceByName', () => {
    it('should return namespace by name', async () => {
      mockNamespaceQueries.getNamespaceByName.mockResolvedValue({ data: sampleNamespace, error: null });

      const req = createMockRequest({
        params: { name: 'test-namespace' },
      });
      const res = createMockResponse();

      await getNamespaceByName(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          namespace: expect.objectContaining({
            id: sampleNamespace.id,
            name: 'test-namespace',
          }),
        },
      });
    });

    it('should return 400 when name is missing', async () => {
      const req = createMockRequest({
        params: {},
      });
      const res = createMockResponse();

      await getNamespaceByName(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Namespace name is required',
        },
      });
    });

    it('should return 404 for non-existent namespace', async () => {
      mockNamespaceQueries.getNamespaceByName.mockResolvedValue({
        data: null,
        error: null,
      });

      const req = createMockRequest({
        params: { name: 'nonexistent-namespace' },
      });
      const res = createMockResponse();

      await getNamespaceByName(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: "Namespace 'nonexistent-namespace' not found",
        },
      });
    });
  });

  describe('PUT /api/namespaces/:id - updateNamespace', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        body: { labels: { env: 'prod' } },
        headers: {},
      });
      const res = createMockResponse();

      await updateNamespace(req, res);

      expect(res._status).toBe(401);
    });

    it('should return 400 when id is invalid UUID', async () => {
      const req = createMockRequest({
        params: { id: 'invalid-uuid' },
        body: { labels: { env: 'prod' } },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNamespace(req, res);

      expect(res._status).toBe(400);
    });

    it('should return 404 for non-existent namespace', async () => {
      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: null,
        error: null,
      });

      const req = createMockRequest({
        params: { id: '22222222-2222-4222-8222-222222222222' },
        body: { labels: { env: 'prod' } },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNamespace(req, res);

      expect(res._status).toBe(404);
    });

    it('should return 409 when trying to update a terminating namespace', async () => {
      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: { ...sampleNamespace, phase: 'terminating' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        body: { labels: { env: 'prod' } },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNamespace(req, res);

      expect(res._status).toBe(409);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'NAMESPACE_TERMINATING',
          message: expect.stringContaining('being deleted'),
        },
      });
    });

    it('should update namespace labels successfully', async () => {
      const updatedNamespace = { ...sampleNamespace, labels: { env: 'prod' } };

      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: sampleNamespace,
        error: null,
      });
      mockNamespaceQueries.updateNamespace.mockResolvedValue({
        data: updatedNamespace,
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        body: { labels: { env: 'prod' } },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNamespace(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          namespace: expect.objectContaining({
            labels: { env: 'prod' },
          }),
        },
      });
    });

    it('should update resource quota successfully', async () => {
      const newQuota = { hard: { pods: 50, cpu: 16000 } };
      const updatedNamespace = { ...sampleNamespace, resourceQuota: newQuota };

      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: sampleNamespace,
        error: null,
      });
      mockNamespaceQueries.updateNamespace.mockResolvedValue({
        data: updatedNamespace,
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        body: { resourceQuota: newQuota },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNamespace(req, res);

      expect(res._status).toBe(200);
      expect(mockNamespaceQueries.updateNamespace).toHaveBeenCalledWith(
        sampleNamespace.id,
        expect.objectContaining({ resourceQuota: newQuota })
      );
    });

  });

  describe('DELETE /api/namespaces/:id - deleteNamespace', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        headers: {},
      });
      const res = createMockResponse();

      await deleteNamespace(req, res);

      expect(res._status).toBe(401);
    });

    it('should return 400 when id is invalid UUID', async () => {
      const req = createMockRequest({
        params: { id: 'invalid-uuid' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNamespace(req, res);

      expect(res._status).toBe(400);
    });

    it('should return 400 when trying to delete reserved namespace', async () => {
      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: { ...sampleNamespace, name: 'default' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNamespace(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'RESERVED_NAME',
          message: expect.stringContaining('reserved'),
        },
      });
    });

    it('should return 404 for non-existent namespace', async () => {
      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: null,
        error: null,
      });

      const req = createMockRequest({
        params: { id: '22222222-2222-4222-8222-222222222222' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNamespace(req, res);

      expect(res._status).toBe(404);
    });

    it('should mark namespace for deletion when it has active pods', async () => {
      const namespaceWithPods = {
        ...sampleNamespace,
        resourceUsage: { pods: 5, cpu: 1000, memory: 2048, storage: 0 },
      };

      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: namespaceWithPods,
        error: null,
      });
      mockNamespaceQueries.markForDeletion.mockResolvedValue({
        data: { ...namespaceWithPods, phase: 'terminating' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNamespace(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          message: expect.stringContaining('marked for deletion'),
          phase: 'terminating',
        },
      });
    });

    it('should delete empty namespace successfully', async () => {
      mockNamespaceQueries.getNamespaceById.mockResolvedValue({
        data: sampleNamespace, // resourceUsage.pods = 0
        error: null,
      });
      mockNamespaceQueries.deleteNamespace.mockResolvedValue({
        data: true,
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNamespace.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNamespace(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          message: "Namespace 'test-namespace' deleted successfully",
        },
      });
    });
  });
});
