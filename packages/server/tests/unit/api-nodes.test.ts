/**
 * Unit tests for Node API endpoints
 * @module @stark-o/server/tests/unit/api-nodes
 *
 * These tests directly test the API handlers without requiring a running server.
 * They mock the Supabase layer to test the API logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import type { Node, RuntimeType, NodeStatus, RegisterNodeInput } from '@stark-o/shared';
import { DEFAULT_ALLOCATABLE, DEFAULT_ALLOCATED } from '@stark-o/shared';

// Mock the supabase modules before importing the handlers
vi.mock('../../src/supabase/nodes.js', () => ({
  getNodeQueries: vi.fn(),
}));

// Import after mocking
import {
  registerNode,
  listNodes,
  getNodeById,
  getNodeByName,
  updateNode,
  deleteNode,
} from '../../src/api/nodes.js';
import { getNodeQueries } from '../../src/supabase/nodes.js';

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
 * Sample node for testing
 */
const sampleNode: Node = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'test-node',
  runtimeType: 'node',
  status: 'online',
  lastHeartbeat: new Date(),
  capabilities: { version: '20.0.0' },
  registeredBy: 'dev-user-id',
  connectionId: undefined,
  ipAddress: undefined,
  userAgent: undefined,
  allocatable: DEFAULT_ALLOCATABLE,
  allocated: DEFAULT_ALLOCATED,
  labels: {},
  annotations: {},
  taints: [],
  unschedulable: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Node API Handlers', () => {
  let mockNodeQueries: {
    createNode: ReturnType<typeof vi.fn>;
    getNodeById: ReturnType<typeof vi.fn>;
    getNodeByName: ReturnType<typeof vi.fn>;
    listNodes: ReturnType<typeof vi.fn>;
    countNodes: ReturnType<typeof vi.fn>;
    updateNode: ReturnType<typeof vi.fn>;
    deleteNode: ReturnType<typeof vi.fn>;
    nodeExists: ReturnType<typeof vi.fn>;
    updateHeartbeat: ReturnType<typeof vi.fn>;
    setNodeStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockNodeQueries = {
      createNode: vi.fn(),
      getNodeById: vi.fn(),
      getNodeByName: vi.fn(),
      listNodes: vi.fn(),
      countNodes: vi.fn(),
      updateNode: vi.fn(),
      deleteNode: vi.fn(),
      nodeExists: vi.fn(),
      updateHeartbeat: vi.fn(),
      setNodeStatus: vi.fn(),
    };

    vi.mocked(getNodeQueries).mockReturnValue(mockNodeQueries as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/nodes - registerNode', () => {
    it('should return 401 when no authorization header', async () => {
      const req = createMockRequest({
        body: { name: 'test-node', runtimeType: 'node' },
        headers: {},
      });
      const res = createMockResponse();

      await registerNode(req, res);

      expect(res._status).toBe(401);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required to register a node',
        },
      });
    });

    it('should return 400 for missing name field', async () => {
      const req = createMockRequest({
        body: { runtimeType: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

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

    it('should return 400 for missing runtimeType field', async () => {
      const req = createMockRequest({
        body: { name: 'test-node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            runtimeType: expect.objectContaining({ code: 'REQUIRED' }),
          },
        },
      });
    });

    it('should return 400 for invalid node name format (starts with number)', async () => {
      const req = createMockRequest({
        body: { name: '123-invalid', runtimeType: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

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

    it('should return 400 for invalid runtimeType value', async () => {
      const req = createMockRequest({
        body: { name: 'test-node', runtimeType: 'invalid-runtime' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: {
            runtimeType: expect.objectContaining({ code: 'INVALID_VALUE' }),
          },
        },
      });
    });

    it('should return 409 when node already exists', async () => {
      mockNodeQueries.nodeExists.mockResolvedValue({ data: true, error: null });

      const req = createMockRequest({
        body: { name: 'test-node', runtimeType: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

      expect(res._status).toBe(409);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Node test-node already exists',
        },
      });
    });

    it('should return 201 and create node successfully', async () => {
      mockNodeQueries.nodeExists.mockResolvedValue({ data: false, error: null });
      mockNodeQueries.createNode.mockResolvedValue({ data: sampleNode, error: null });

      const req = createMockRequest({
        body: { name: 'test-node', runtimeType: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

      expect(res._status).toBe(201);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          node: expect.objectContaining({
            id: sampleNode.id,
            name: 'test-node',
            runtimeType: 'node',
            status: 'online',
          }),
        },
      });

      expect(mockNodeQueries.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-node',
          runtimeType: 'node',
          registeredBy: 'dev-user-id',
        })
      );
    });

    it('should create node with optional capabilities and labels', async () => {
      const nodeWithOptionals = {
        ...sampleNode,
        capabilities: { version: '20.0.0', features: ['esm'] },
        labels: { env: 'production' },
      };

      mockNodeQueries.nodeExists.mockResolvedValue({ data: false, error: null });
      mockNodeQueries.createNode.mockResolvedValue({ data: nodeWithOptionals, error: null });

      const req = createMockRequest({
        body: {
          name: 'test-node',
          runtimeType: 'node',
          capabilities: { version: '20.0.0', features: ['esm'] },
          labels: { env: 'production' },
        },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

      expect(res._status).toBe(201);
      expect(mockNodeQueries.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilities: { version: '20.0.0', features: ['esm'] },
          labels: { env: 'production' },
        })
      );
    });

    it('should handle database error during node existence check', async () => {
      mockNodeQueries.nodeExists.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Connection failed' },
      });

      const req = createMockRequest({
        body: { name: 'test-node', runtimeType: 'node' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await registerNode(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
        },
      });
    });
  });

  describe('GET /api/nodes - listNodes', () => {
    it('should return paginated list of nodes', async () => {
      mockNodeQueries.countNodes.mockResolvedValue({ data: 2, error: null });
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [
          { ...sampleNode, id: 'node-1', name: 'node-1' },
          { ...sampleNode, id: 'node-2', name: 'node-2' },
        ],
        error: null,
      });

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: 'node-1' }),
            expect.objectContaining({ id: 'node-2' }),
          ]),
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    });

    it('should filter by runtimeType', async () => {
      mockNodeQueries.countNodes.mockResolvedValue({ data: 1, error: null });
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [{ ...sampleNode, runtimeType: 'browser' }],
        error: null,
      });

      const req = createMockRequest({ query: { runtimeType: 'browser' } });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(mockNodeQueries.listNodes).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeType: 'browser' })
      );
    });

    it('should return 400 for invalid runtimeType filter', async () => {
      const req = createMockRequest({ query: { runtimeType: 'invalid' } });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.stringContaining('Invalid runtime type'),
        },
      });
    });

    it('should filter by status', async () => {
      mockNodeQueries.countNodes.mockResolvedValue({ data: 1, error: null });
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [{ ...sampleNode, status: 'offline' }],
        error: null,
      });

      const req = createMockRequest({ query: { status: 'offline' } });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(mockNodeQueries.listNodes).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'offline' })
      );
    });

    it('should return 400 for invalid status filter', async () => {
      const req = createMockRequest({ query: { status: 'invalid' } });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.stringContaining('Invalid status'),
        },
      });
    });

    it('should support search parameter', async () => {
      mockNodeQueries.countNodes.mockResolvedValue({ data: 1, error: null });
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [sampleNode],
        error: null,
      });

      const req = createMockRequest({ query: { search: 'test' } });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(mockNodeQueries.listNodes).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'test' })
      );
    });

    it('should handle pagination parameters', async () => {
      mockNodeQueries.countNodes.mockResolvedValue({ data: 50, error: null });
      mockNodeQueries.listNodes.mockResolvedValue({ data: [], error: null });

      const req = createMockRequest({ query: { page: '3', pageSize: '10' } });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(mockNodeQueries.listNodes).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 20, // (3-1) * 10
        })
      );
    });

    it('should clamp pageSize to maximum of 100', async () => {
      mockNodeQueries.countNodes.mockResolvedValue({ data: 0, error: null });
      mockNodeQueries.listNodes.mockResolvedValue({ data: [], error: null });

      const req = createMockRequest({ query: { pageSize: '500' } });
      const res = createMockResponse();

      await listNodes(req, res);

      expect(mockNodeQueries.listNodes).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });
  });

  describe('GET /api/nodes/:id - getNodeById', () => {
    it('should return node by ID', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({ data: sampleNode, error: null });

      const req = createMockRequest({
        params: { id: sampleNode.id },
      });
      const res = createMockResponse();

      await getNodeById(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          node: expect.objectContaining({ id: sampleNode.id }),
        },
      });
    });

    it('should return 400 for invalid UUID format', async () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' },
      });
      const res = createMockResponse();

      await getNodeById(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid node ID format',
        },
      });
    });

    it('should return 404 for non-existent node', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
      });
      const res = createMockResponse();

      await getNodeById(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toEqual({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Node not found',
        },
      });
    });
  });

  describe('GET /api/nodes/name/:name - getNodeByName', () => {
    it('should return node by name', async () => {
      mockNodeQueries.getNodeByName.mockResolvedValue({ data: sampleNode, error: null });

      const req = createMockRequest({
        params: { name: 'test-node' },
      });
      const res = createMockResponse();

      await getNodeByName(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          node: expect.objectContaining({ name: 'test-node' }),
        },
      });
    });

    it('should return 400 when name is missing', async () => {
      const req = createMockRequest({
        params: {},
      });
      const res = createMockResponse();

      await getNodeByName(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Node name is required',
        },
      });
    });

    it('should return 404 when node not found', async () => {
      mockNodeQueries.getNodeByName.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const req = createMockRequest({
        params: { name: 'nonexistent-node' },
      });
      const res = createMockResponse();

      await getNodeByName(req, res);

      expect(res._status).toBe(404);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'NOT_FOUND',
        },
      });
    });
  });

  describe('PATCH /api/nodes/:id - updateNode', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: sampleNode.id },
        body: { status: 'offline' },
        headers: {},
      });
      const res = createMockResponse();

      await updateNode(req, res);

      expect(res._status).toBe(401);
    });

    it('should return 400 for invalid UUID', async () => {
      const req = createMockRequest({
        params: { id: 'not-a-uuid' },
        body: { status: 'offline' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNode(req, res);

      expect(res._status).toBe(400);
    });

    it('should return 404 for non-existent node', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
        body: { status: 'offline' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNode(req, res);

      expect(res._status).toBe(404);
    });

    it('should return 403 when user does not own node', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: { ...sampleNode, registeredBy: 'other-user' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNode.id },
        body: { status: 'offline' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNode(req, res);

      expect(res._status).toBe(403);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'FORBIDDEN',
        },
      });
    });

    it('should update node successfully', async () => {
      const updatedNode = { ...sampleNode, status: 'offline' as NodeStatus };

      mockNodeQueries.getNodeById.mockResolvedValue({
        data: sampleNode,
        error: null,
      });
      mockNodeQueries.updateNode.mockResolvedValue({
        data: updatedNode,
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNode.id },
        body: { status: 'offline' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNode(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          node: expect.objectContaining({ status: 'offline' }),
        },
      });
    });

    it('should update node labels and taints', async () => {
      const updatedNode = {
        ...sampleNode,
        labels: { env: 'staging' },
        taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' as const }],
      };

      mockNodeQueries.getNodeById.mockResolvedValue({
        data: sampleNode,
        error: null,
      });
      mockNodeQueries.updateNode.mockResolvedValue({
        data: updatedNode,
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNode.id },
        body: {
          labels: { env: 'staging' },
          taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }],
        },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await updateNode(req, res);

      expect(res._status).toBe(200);
      expect(mockNodeQueries.updateNode).toHaveBeenCalledWith(
        sampleNode.id,
        expect.objectContaining({
          labels: { env: 'staging' },
          taints: [{ key: 'dedicated', value: 'gpu', effect: 'NoSchedule' }],
        })
      );
    });
  });

  describe('DELETE /api/nodes/:id - deleteNode', () => {
    it('should return 401 when not authenticated', async () => {
      const req = createMockRequest({
        params: { id: sampleNode.id },
        headers: {},
      });
      const res = createMockResponse();

      await deleteNode(req, res);

      expect(res._status).toBe(401);
    });

    it('should return 404 for non-existent node', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' },
      });

      const req = createMockRequest({
        params: { id: '00000000-0000-4000-8000-000000000000' },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNode(req, res);

      expect(res._status).toBe(404);
    });

    it('should return 403 when user does not own node', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: { ...sampleNode, registeredBy: 'other-user' },
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNode.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNode(req, res);

      expect(res._status).toBe(403);
    });

    it('should delete node successfully', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: sampleNode,
        error: null,
      });
      mockNodeQueries.deleteNode.mockResolvedValue({
        data: undefined,
        error: null,
      });

      const req = createMockRequest({
        params: { id: sampleNode.id },
        headers: { authorization: 'Bearer test-token' },
      });
      const res = createMockResponse();

      await deleteNode(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          deleted: true,
        },
      });

      expect(mockNodeQueries.deleteNode).toHaveBeenCalledWith(sampleNode.id);
    });
  });
});
