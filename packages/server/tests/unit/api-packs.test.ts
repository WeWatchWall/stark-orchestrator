/**
 * Unit tests for Pack API endpoints
 * @module @stark-o/server/tests/unit/api-packs
 *
 * These tests directly test the API handlers without requiring a running server.
 * They mock the Supabase layer to test the API logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import type { Pack, RegisterPackInput, RuntimeTag } from '@stark-o/shared';

// Mock the supabase modules before importing the handlers
vi.mock('../../src/supabase/packs.js', () => ({
  getPackQueries: vi.fn(),
}));

// Import after mocking
import {
  registerPack,
  listPacks,
  getPackById,
  listPackVersions,
  updatePack,
  deletePack,
} from '../../src/api/packs.js';
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
 * Sample pack for testing
 */
const samplePack: Pack = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'test-pack',
  version: '1.0.0',
  runtimeTag: 'node',
  ownerId: 'dev-user-id',
  bundlePath: 'packs/test-pack/1.0.0/bundle.js',
  description: 'A test pack',
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Pack API Handlers', () => {
  let mockPackQueries: {
    createPack: ReturnType<typeof vi.fn>;
    getPackById: ReturnType<typeof vi.fn>;
    listPacks: ReturnType<typeof vi.fn>;
    countPacks: ReturnType<typeof vi.fn>;
    listPackVersions: ReturnType<typeof vi.fn>;
    updatePack: ReturnType<typeof vi.fn>;
    deletePack: ReturnType<typeof vi.fn>;
    packExists: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPackQueries = {
      createPack: vi.fn(),
      getPackById: vi.fn(),
      listPacks: vi.fn(),
      countPacks: vi.fn(),
      listPackVersions: vi.fn(),
      updatePack: vi.fn(),
      deletePack: vi.fn(),
      packExists: vi.fn(),
    };

    vi.mocked(getPackQueries).mockReturnValue(mockPackQueries as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/packs - registerPack', () => {
    it('should return 401 when no authorization header', async () => {
      const req = createMockRequest({
        body: { name: 'test-pack', version: '1.0.0', runtimeTag: 'node' },
        headers: {},
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required to register a pack',
        },
      });
    });

    it('should return 400 for missing name field', async () => {
      const req = createMockRequest({
        body: { version: '1.0.0', runtimeTag: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

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

    it('should return 400 for missing version field', async () => {
      const req = createMockRequest({
        body: { name: 'test-pack', runtimeTag: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            version: expect.objectContaining({ code: 'REQUIRED' }),
          },
        },
      });
    });

    it('should return 400 for missing runtimeTag field', async () => {
      const req = createMockRequest({
        body: { name: 'test-pack', version: '1.0.0' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            runtimeTag: expect.objectContaining({ code: 'REQUIRED' }),
          },
        },
      });
    });

    it('should return 400 for invalid pack name format (starts with number)', async () => {
      const req = createMockRequest({
        body: { name: '123-invalid', version: '1.0.0', runtimeTag: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

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

    it('should return 400 for invalid version format', async () => {
      const req = createMockRequest({
        body: { name: 'test-pack', version: 'not-semver', runtimeTag: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            version: expect.objectContaining({ code: 'INVALID_FORMAT' }),
          },
        },
      });
    });

    it('should return 400 for invalid runtimeTag value', async () => {
      const req = createMockRequest({
        body: { name: 'test-pack', version: '1.0.0', runtimeTag: 'invalid-runtime' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            runtimeTag: expect.objectContaining({ code: 'INVALID_VALUE' }),
          },
        },
      });
    });

    it('should return 409 when pack already exists', async () => {
      mockPackQueries.packExists.mockResolvedValue({ data: true, error: null });

      const req = createMockRequest({
        body: { name: 'test-pack', version: '1.0.0', runtimeTag: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(409);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Pack test-pack@1.0.0 already exists',
        },
      });
    });

    it('should return 201 and create pack successfully', async () => {
      mockPackQueries.packExists.mockResolvedValue({ data: false, error: null });
      mockPackQueries.createPack.mockResolvedValue({ data: samplePack, error: null });

      const req = createMockRequest({
        body: { name: 'test-pack', version: '1.0.0', runtimeTag: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(201);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pack: expect.objectContaining({
            id: samplePack.id,
            name: 'test-pack',
            version: '1.0.0',
            runtimeTag: 'node',
          }),
          uploadUrl: expect.stringContaining('test-pack'),
        },
      });

      expect(mockPackQueries.createPack).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-pack',
          version: '1.0.0',
          runtimeTag: 'node',
          ownerId: 'dev-user-id',
        })
      );
    });

    it('should create pack with optional description and metadata', async () => {
      const packWithOptionals = {
        ...samplePack,
        description: 'My awesome pack',
        metadata: { author: 'test' },
      };

      mockPackQueries.packExists.mockResolvedValue({ data: false, error: null });
      mockPackQueries.createPack.mockResolvedValue({ data: packWithOptionals, error: null });

      const req = createMockRequest({
        body: {
          name: 'test-pack',
          version: '1.0.0',
          runtimeTag: 'node',
          description: 'My awesome pack',
          metadata: { author: 'test' },
        },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(201);
      expect(mockPackQueries.createPack).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'My awesome pack',
          metadata: { author: 'test' },
        })
      );
    });

    it('should handle database error during pack existence check', async () => {
      mockPackQueries.packExists.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Connection failed' },
      });

      const req = createMockRequest({
        body: { name: 'test-pack', version: '1.0.0', runtimeTag: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerPack(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
        },
      });
    });
  });

  describe('GET /api/packs - listPacks', () => {
    it('should return paginated list of packs', async () => {
      mockPackQueries.countPacks.mockResolvedValue({ data: 2, error: null });
      mockPackQueries.listPacks.mockResolvedValue({
        data: [
          { ...samplePack, id: 'pack-1', latestVersion: '1.0.0' },
          { ...samplePack, id: 'pack-2', latestVersion: '2.0.0' },
        ],
        error: null,
      });

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();

      await listPacks(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          packs: expect.arrayContaining([
            expect.objectContaining({ id: 'pack-1' }),
            expect.objectContaining({ id: 'pack-2' }),
          ]),
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    });

    it('should filter by runtimeTag', async () => {
      mockPackQueries.countPacks.mockResolvedValue({ data: 1, error: null });
      mockPackQueries.listPacks.mockResolvedValue({
        data: [{ ...samplePack, runtimeTag: 'browser', latestVersion: '1.0.0' }],
        error: null,
      });

      const req = createMockRequest({ query: { runtimeTag: 'browser' } });
      const res = createMockResponse();

      await listPacks(req, res);

      expect(mockPackQueries.listPacks).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeTag: 'browser' })
      );
    });

    it('should return 400 for invalid runtimeTag filter', async () => {
      const req = createMockRequest({ query: { runtimeTag: 'invalid' } });
      const res = createMockResponse();

      await listPacks(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.stringContaining('Invalid runtime tag'),
        },
      });
    });

    it('should support search parameter', async () => {
      mockPackQueries.countPacks.mockResolvedValue({ data: 1, error: null });
      mockPackQueries.listPacks.mockResolvedValue({
        data: [{ ...samplePack, latestVersion: '1.0.0' }],
        error: null,
      });

      const req = createMockRequest({ query: { search: 'test' } });
      const res = createMockResponse();

      await listPacks(req, res);

      expect(mockPackQueries.listPacks).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'test' })
      );
    });

    it('should handle pagination parameters', async () => {
      mockPackQueries.countPacks.mockResolvedValue({ data: 50, error: null });
      mockPackQueries.listPacks.mockResolvedValue({ data: [], error: null });

      const req = createMockRequest({ query: { page: '3', pageSize: '10' } });
      const res = createMockResponse();

      await listPacks(req, res);

      expect(mockPackQueries.listPacks).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 20, // (3-1) * 10
        })
      );
    });

    it('should clamp pageSize to maximum of 100', async () => {
      mockPackQueries.countPacks.mockResolvedValue({ data: 0, error: null });
      mockPackQueries.listPacks.mockResolvedValue({ data: [], error: null });

      const req = createMockRequest({ query: { pageSize: '500' } });
      const res = createMockResponse();

      await listPacks(req, res);

      expect(mockPackQueries.listPacks).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  describe('GET /api/packs/:id - getPackById', () => {
    it('should return pack by ID', async () => {
      mockPackQueries.getPackById.mockResolvedValue({ data: samplePack, error: null });

      const req = createMockRequest({
        params: { id: samplePack.id },
      });
      const res = createMockResponse();

      await getPackById(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pack: expect.objectContaining({ id: samplePack.id }),
        },
      });
    });

    it('should return 400 for invalid UUID format', async () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' },
      });
      const res = createMockResponse();

      await getPackById(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid pack ID format',
        },
      });
    });

    it('should return 404 for non-existent pack', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
      });
      const res = createMockResponse();

      await getPackById(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Pack not found',
        },
      });
    });
  });

  describe('GET /api/packs/:name/versions - listPackVersions', () => {
    it('should return all versions of a pack', async () => {
      const versions = [
        { version: '2.0.0', createdAt: new Date() },
        { version: '1.1.0', createdAt: new Date() },
        { version: '1.0.0', createdAt: new Date() },
      ];
      mockPackQueries.listPackVersions.mockResolvedValue({ data: versions, error: null });

      const req = createMockRequest({
        params: { name: 'test-pack' },
      });
      const res = createMockResponse();

      await listPackVersions(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          versions: expect.arrayContaining([
            expect.objectContaining({ version: '2.0.0' }),
            expect.objectContaining({ version: '1.0.0' }),
          ]),
        },
      });
    });

    it('should return 400 when name is missing', async () => {
      const req = createMockRequest({
        params: {},
      });
      const res = createMockResponse();

      await listPackVersions(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Pack name is required',
        },
      });
    });

    it('should return 404 when pack has no versions', async () => {
      mockPackQueries.listPackVersions.mockResolvedValue({ data: [], error: null });

      const req = createMockRequest({
        params: { name: 'nonexistent-pack' },
      });
      const res = createMockResponse();

      await listPackVersions(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'NOT_FOUND',
        },
      });
    });
  });

  describe('PATCH /api/packs/:id - updatePack', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: samplePack.id },
        body: { description: 'Updated description' },
        headers: {},
      });
      const res = createMockResponse();

      await updatePack(req, res);

      expect(res._status).toBe(401);
    });

    it('should return 400 for invalid UUID', async () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' },
        body: { description: 'Updated' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updatePack(req, res);

      expect(res._status).toBe(400);
    });

    it('should return 404 for non-existent pack', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
        body: { description: 'Updated' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updatePack(req, res);

      expect(res._status).toBe(404);
    });

    it('should return 403 when user does not own pack', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: { ...samplePack, ownerId: 'other-user' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePack.id },
        body: { description: 'Updated' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updatePack(req, res);

      expect(res._status).toBe(403);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'FORBIDDEN',
        },
      });
    });

    it('should update pack successfully', async () => {
      const updatedPack = { ...samplePack, description: 'New description' };

      mockPackQueries.getPackById.mockResolvedValue({
        data: samplePack,
        error: null,
      });
      mockPackQueries.updatePack.mockResolvedValue({
        data: updatedPack,
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePack.id },
        body: { description: 'New description' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updatePack(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          pack: expect.objectContaining({ description: 'New description' }),
        },
      });
    });
  });

  describe('DELETE /api/packs/:id - deletePack', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: samplePack.id },
        headers: {},
      });
      const res = createMockResponse();

      await deletePack(req, res);

      expect(res._status).toBe(401);
    });

    it('should return 404 for non-existent pack', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deletePack(req, res);

      expect(res._status).toBe(404);
    });

    it('should return 403 when user does not own pack', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: { ...samplePack, ownerId: 'other-user' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePack.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deletePack(req, res);

      expect(res._status).toBe(403);
    });

    it('should delete pack successfully', async () => {
      mockPackQueries.getPackById.mockResolvedValue({
        data: samplePack,
        error: null,
      });
      mockPackQueries.deletePack.mockResolvedValue({
        data: null,
        error: null,
      });

      const req = createMockRequest({
        params: { id: samplePack.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deletePack(req, res);

      expect(res._status).toBe(204);
      expect(mockPackQueries.deletePack).toHaveBeenCalledWith(samplePack.id);
    });
  });
});
