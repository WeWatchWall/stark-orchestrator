/**
 * Unit tests for Pod API endpoints
 * @module @stark-o/server/tests/unit/api-pods
 *
 * These tests directly test the API handlers without requiring a running server.
 * They mock the Supabase layer to test the API logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import type { CreatePodInput, Pod, PodStatus } from '@stark-o/shared';

// Mock the supabase modules before importing the handlers
vi.mock('../../src/supabase/pods.js', () => ({
  getPodQueries: vi.fn(),
  getPodQueriesAdmin: vi.fn(),
}));

vi.mock('../../src/supabase/packs.js', () => ({
  getPackQueries: vi.fn(),
}));

// Import after mocking
import { createPod, listPods, getPodById, getPodStatus, deletePod, rollbackPod } from '../../src/api/pods.js';
import { getPodQueries, getPodQueriesAdmin } from '../../src/supabase/pods.js';
import { getPackQueries } from '../../src/supabase/packs.js';

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
 * Sample pod for testing
 */
const samplePod: Pod = {
  id: '11111111-1111-4111-8111-111111111111', // Valid UUID v4 format
  packId: '22222222-2222-4222-8222-222222222222', // Valid UUID v4 format
  packVersion: '1.0.0',
  nodeId: null,
  status: 'pending',
  namespace: 'default',
  labels: {},
  annotations: {},
  priority: 0,
  tolerations: [],
  resourceRequests: { cpu: 100, memory: 128 },
  resourceLimits: { cpu: 500, memory: 512 },
  createdBy: 'test-user-id',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Sample pack for testing
 */
const samplePack = {
  id: '22222222-2222-4222-8222-222222222222', // Valid UUID v4 format
  name: 'test-pack',
  version: '1.0.0',
  runtimeTag: 'node' as const,
  ownerId: 'test-user-id',
  bundlePath: 'packs/test-pack/1.0.0/bundle.js',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Pod API Handlers', () => {
  let mockPodQueries: {
    createPod: ReturnType<typeof vi.fn>;
    getPodById: ReturnType<typeof vi.fn>;
    listPods: ReturnType<typeof vi.fn>;
    countPods: ReturnType<typeof vi.fn>;
    deletePod: ReturnType<typeof vi.fn>;
    stopPod: ReturnType<typeof vi.fn>;
    createPodHistory: ReturnType<typeof vi.fn>;
    updatePodPackVersion: ReturnType<typeof vi.fn>;
    rollbackPod: ReturnType<typeof vi.fn>;
  };

  let mockPackQueries: {
    getPackById: ReturnType<typeof vi.fn>;
    listPackVersions: ReturnType<typeof vi.fn>;
    packExists: ReturnType<typeof vi.fn>;
    getPackByNameAndVersion: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup mock pod queries
    mockPodQueries = {
      createPod: vi.fn(),
      getPodById: vi.fn(),
      listPods: vi.fn(),
      countPods: vi.fn(),
      deletePod: vi.fn(),
      stopPod: vi.fn(),
      createPodHistory: vi.fn(),
      updatePodPackVersion: vi.fn(),
      rollbackPod: vi.fn(),
    };

    // Setup mock pack queries
    mockPackQueries = {
      listPackVersions: vi.fn(),
      packExists: vi.fn(),
      getPackById: vi.fn(),
      getPackByNameAndVersion: vi.fn(),
    };

    // Wire up the mocks
    vi.mocked(getPodQueries).mockReturnValue(mockPodQueries as any);
    vi.mocked(getPodQueriesAdmin).mockReturnValue(mockPodQueries as any);
    vi.mocked(getPackQueries).mockReturnValue(mockPackQueries as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/pods - createPod', () => {
    it('should return 401 when no authorization header', async () => {
      const req = createMockRequest({
        body: { packId: samplePack.id },
        headers: {},
      });
      const res = createMockResponse();

      await createPod(req, res);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required to create a pod',
        },
      });
    });

    it('should return 400 for missing packId', async () => {
      const req = createMockRequest({
        body: {},
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
      });
    });

    it('should return 400 for invalid packId format', async () => {
      const req = createMockRequest({
        body: { packId: 'not-a-uuid' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });

    it('should return 404 when pack does not exist', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const req = createMockRequest({
        body: { packId: '00000000-0000-4000-8000-000000000000' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createPod(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Pack not found',
        },
      });
    });

    it('should return 201 and create pod successfully', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: samplePack,
        error: null,
      });

      mockPodQueries.createPod.mockResolvedValue({
        data: samplePod,
        error: null,
      });

      mockPodQueries.createPodHistory.mockResolvedValue({
        data: { id: 'history-1' },
        error: null,
      });

      const req = createMockRequest({
        body: { packId: samplePack.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createPod(req, res);

      expect(res._status).toBe(201);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pod: expect.objectContaining({
            id: samplePod.id,
            packId: samplePod.packId,
            status: 'pending',
          }),
        },
      });

      // Verify pod was created with correct args
      expect(mockPodQueries.createPod).toHaveBeenCalledWith(
        expect.objectContaining({
          packId: samplePack.id,
          createdBy: 'dev-user-id', // From getUserId fallback
        })
      );

      // Verify history was recorded
      expect(mockPodQueries.createPodHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          podId: samplePod.id,
          action: 'created',
          newStatus: 'pending',
        })
      );
    });

    it('should create pod with all optional fields', async () => {
      const fullInput: CreatePodInput = {
        packId: samplePack.id,
        packVersion: '2.0.0',
        namespace: 'production',
        labels: { app: 'web', tier: 'frontend' },
        annotations: { description: 'Test pod' },
        priorityClassName: 'high',
        tolerations: [{ key: 'special', operator: 'Exists', effect: 'NoSchedule' }],
        resourceRequests: { cpu: 500, memory: 512 },
        resourceLimits: { cpu: 1000, memory: 1024 },
        metadata: { region: 'us-east' },
      };

      const podWithOptionals = {
        ...samplePod,
        packVersion: '2.0.0',
        namespace: 'production',
        labels: { app: 'web', tier: 'frontend' },
      };

      mockPackQueries.getPackById.mockResolvedValue({
        data: samplePack,
        error: null,
      });

      mockPodQueries.createPod.mockResolvedValue({
        data: podWithOptionals,
        error: null,
      });

      mockPodQueries.createPodHistory.mockResolvedValue({
        data: { id: 'history-1' },
        error: null,
      });

      const req = createMockRequest({
        body: fullInput,
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createPod(req, res);

      expect(res._status).toBe(201);
      expect(mockPodQueries.createPod).toHaveBeenCalledWith(
        expect.objectContaining({
          packId: samplePack.id,
          packVersion: '2.0.0',
          namespace: 'production',
          labels: { app: 'web', tier: 'frontend' },
        })
      );
    });

    it('should return 400 when resource limits are less than requests', async () => {
      const req = createMockRequest({
        body: {
          packId: samplePack.id,
          resourceRequests: { cpu: 500, memory: 512 },
          resourceLimits: { cpu: 250, memory: 256 }, // Less than requests
        },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await createPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });
  });

  describe('GET /api/pods - listPods', () => {
    it('should return paginated list of pods', async () => {
      mockPodQueries.countPods.mockResolvedValue({ data: 2, error: null });
      mockPodQueries.listPods.mockResolvedValue({
        data: [
          { ...samplePod, id: 'pod-1' },
          { ...samplePod, id: 'pod-2' },
        ],
        error: null,
      });

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();

      await listPods(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pods: expect.arrayContaining([
            expect.objectContaining({ id: 'pod-1' }),
            expect.objectContaining({ id: 'pod-2' }),
          ]),
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    });

    it('should filter by namespace', async () => {
      mockPodQueries.countPods.mockResolvedValue({ data: 1, error: null });
      mockPodQueries.listPods.mockResolvedValue({
        data: [{ ...samplePod, namespace: 'production' }],
        error: null,
      });

      const req = createMockRequest({ query: { namespace: 'production' } });
      const res = createMockResponse();

      await listPods(req, res);

      expect(mockPodQueries.listPods).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'production' })
      );
    });

    it('should filter by status', async () => {
      mockPodQueries.countPods.mockResolvedValue({ data: 1, error: null });
      mockPodQueries.listPods.mockResolvedValue({
        data: [{ ...samplePod, status: 'running' }],
        error: null,
      });

      const req = createMockRequest({ query: { status: 'running' } });
      const res = createMockResponse();

      await listPods(req, res);

      expect(mockPodQueries.listPods).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running' })
      );
    });

    it('should return 400 for invalid status', async () => {
      const req = createMockRequest({ query: { status: 'invalid-status' } });
      const res = createMockResponse();

      await listPods(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });

    it('should parse label selector', async () => {
      mockPodQueries.countPods.mockResolvedValue({ data: 1, error: null });
      mockPodQueries.listPods.mockResolvedValue({
        data: [samplePod],
        error: null,
      });

      const req = createMockRequest({ query: { labelSelector: 'app=web,tier=frontend' } });
      const res = createMockResponse();

      await listPods(req, res);

      expect(mockPodQueries.listPods).toHaveBeenCalledWith(
        expect.objectContaining({
          labelSelector: { app: 'web', tier: 'frontend' },
        })
      );
    });
  });

  describe('GET /api/pods/:id - getPodById', () => {
    it('should return pod by ID', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: samplePod,
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
      });
      const res = createMockResponse();

      await getPodById(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pod: expect.objectContaining({ id: samplePod.id }),
        },
      });
    });

    it('should return 400 for invalid UUID format', async () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' },
      });
      const res = createMockResponse();

      await getPodById(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid pod ID format',
        },
      });
    });

    it('should return 404 for non-existent pod', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
      });
      const res = createMockResponse();

      await getPodById(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Pod not found',
        },
      });
    });
  });

  describe('GET /api/pods/:id/status - getPodStatus', () => {
    it('should return pod status summary', async () => {
      const runningPod = {
        ...samplePod,
        status: 'running' as PodStatus,
        nodeId: 'node-123',
        startedAt: new Date(),
      };

      mockPodQueries.getPodById.mockResolvedValue({
        data: runningPod,
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
      });
      const res = createMockResponse();

      await getPodStatus(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pod: {
            id: samplePod.id,
            status: 'running',
            nodeId: 'node-123',
            startedAt: expect.any(Date),
          },
        },
      });
    });

    it('should include statusMessage for failed pods', async () => {
      const failedPod = {
        ...samplePod,
        status: 'failed' as PodStatus,
        statusMessage: 'Pack execution timeout',
        stoppedAt: new Date(),
      };

      mockPodQueries.getPodById.mockResolvedValue({
        data: failedPod,
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
      });
      const res = createMockResponse();

      await getPodStatus(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pod: {
            status: 'failed',
            statusMessage: 'Pack execution timeout',
          },
        },
      });
    });
  });

  describe('DELETE /api/pods/:id - deletePod', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: samplePod.id },
        headers: {},
      });
      const res = createMockResponse();

      await deletePod(req, res);

      expect(res._status).toBe(401);
    });

    it('should return 404 for non-existent pod', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deletePod(req, res);

      expect(res._status).toBe(404);
    });

    it('should return 403 when user does not own pod', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: { ...samplePod, createdBy: 'other-user' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deletePod(req, res);

      expect(res._status).toBe(403);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'FORBIDDEN',
        },
      });
    });

    it('should stop and delete pod successfully', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: { ...samplePod, createdBy: 'dev-user-id', status: 'running' },
        error: null,
      });

      mockPodQueries.stopPod.mockResolvedValue({
        data: { ...samplePod, status: 'stopped' },
        error: null,
      });

      mockPodQueries.createPodHistory.mockResolvedValue({
        data: { id: 'history-1' },
        error: null,
      });

      mockPodQueries.deletePod.mockResolvedValue({
        data: null,
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        headers: { authorization: 'Bearer test-token' },
        user: { id: 'dev-user-id', email: 'dev@test.com', roles: ['developer'] },
      });
      const res = createMockResponse();

      await deletePod(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          message: 'Pod stopped and deleted',
        },
      });

      // Verify pod was stopped before deletion
      expect(mockPodQueries.stopPod).toHaveBeenCalledWith(samplePod.id, 'Deleted by user');
      expect(mockPodQueries.deletePod).toHaveBeenCalledWith(samplePod.id);
    });
  });

  describe('POST /api/pods/:id/rollback - rollbackPod', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '1.0.0' },
        headers: {},
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required to rollback a pod',
        },
      });
    });

    it('should return 400 for invalid pod ID format', async () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid pod ID format',
        },
      });
    });

    it('should return 400 for missing targetVersion', async () => {
      const req = createMockRequest({
        params: { id: samplePod.id },
        body: {},
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'targetVersion is required and must be a string',
        },
      });
    });

    it('should return 400 for empty targetVersion', async () => {
      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '   ' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'targetVersion cannot be empty',
        },
      });
    });

    it('should return 404 for non-existent pod', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Pod not found',
        },
      });
    });

    it('should return 403 when user does not own pod', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: { ...samplePod, createdBy: 'other-user', status: 'running' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(403);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Not authorized to rollback this pod',
        },
      });
    });

    it('should return 400 when pod is not in a rollback-able state', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: { ...samplePod, createdBy: 'dev-user-id', status: 'pending' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: expect.stringContaining('Cannot rollback pod'),
        },
      });
    });

    it('should return 400 when target version is same as current version', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: { ...samplePod, createdBy: 'dev-user-id', status: 'running', packVersion: '1.0.0' },
        error: null,
      });

      mockPackQueries.getPackById.mockResolvedValue({
        data: { ...samplePack, name: 'test-pack' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'SAME_VERSION',
          message: expect.stringContaining('already running version'),
        },
      });
    });

    it('should return 404 when target version does not exist for pack', async () => {
      mockPodQueries.getPodById.mockResolvedValue({
        data: { ...samplePod, createdBy: 'dev-user-id', status: 'running', packVersion: '2.0.0' },
        error: null,
      });

      mockPackQueries.getPackById.mockResolvedValue({
        data: { ...samplePack, name: 'test-pack' },
        error: null,
      });

      mockPackQueries.getPackByNameAndVersion.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VERSION_NOT_FOUND',
          message: expect.stringContaining('not found'),
        },
      });
    });

    it('should rollback pod successfully', async () => {
      const runningPod = {
        ...samplePod,
        createdBy: 'dev-user-id',
        status: 'running' as PodStatus,
        packVersion: '2.0.0',
      };

      const targetPackData = {
        ...samplePack,
        id: '33333333-3333-4333-8333-333333333333',
        version: '1.0.0',
        name: 'test-pack',
      };

      mockPodQueries.getPodById.mockResolvedValue({
        data: runningPod,
        error: null,
      });

      mockPackQueries.getPackById.mockResolvedValue({
        data: { ...samplePack, name: 'test-pack' },
        error: null,
      });

      mockPackQueries.getPackByNameAndVersion.mockResolvedValue({
        data: targetPackData,
        error: null,
      });

      mockPodQueries.rollbackPod.mockResolvedValue({
        data: { ...runningPod, packVersion: '1.0.0', packId: targetPackData.id },
        error: null,
      });

      mockPodQueries.createPodHistory.mockResolvedValue({
        data: { id: 'history-1' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          podId: samplePod.id,
          previousVersion: '2.0.0',
          newVersion: '1.0.0',
          packId: targetPackData.id,
          packName: 'test-pack',
        },
      });

      // Verify pod was rolled back
      expect(mockPodQueries.rollbackPod).toHaveBeenCalledWith(
        samplePod.id,
        targetPackData.id,
        '1.0.0'
      );

      // Verify history was recorded
      expect(mockPodQueries.createPodHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          podId: samplePod.id,
          action: 'rolled_back',
          previousVersion: '2.0.0',
          newVersion: '1.0.0',
        })
      );
    });

    it('should handle database error during rollback', async () => {
      const runningPod = {
        ...samplePod,
        createdBy: 'dev-user-id',
        status: 'running' as PodStatus,
        packVersion: '2.0.0',
      };

      const targetPackData = {
        ...samplePack,
        id: '33333333-3333-4333-8333-333333333333',
        version: '1.0.0',
        name: 'test-pack',
      };

      mockPodQueries.getPodById.mockResolvedValue({
        data: runningPod,
        error: null,
      });

      mockPackQueries.getPackById.mockResolvedValue({
        data: { ...samplePack, name: 'test-pack' },
        error: null,
      });

      mockPackQueries.getPackByNameAndVersion.mockResolvedValue({
        data: targetPackData,
        error: null,
      });

      mockPodQueries.rollbackPod.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Database error' },
      });

      const req = createMockRequest({
        params: { id: samplePod.id },
        body: { targetVersion: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await rollbackPod(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
        },
      });
    });
  });
});
