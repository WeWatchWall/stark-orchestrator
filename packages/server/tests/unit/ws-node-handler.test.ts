/**
 * Unit tests for WebSocket Node Handlers
 * @module @stark-o/server/tests/unit/ws-node-handler
 *
 * These tests directly test the WebSocket handlers without requiring a running server.
 * They mock the Supabase layer to test the handler logic in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Node, RuntimeType, NodeStatus, RegisterNodeInput, NodeHeartbeat } from '@stark-o/shared';
import { DEFAULT_ALLOCATABLE, DEFAULT_ALLOCATED } from '@stark-o/shared';

// Mock the supabase modules before importing the handlers
vi.mock('../../src/supabase/nodes.js', () => ({
  getNodeQueries: vi.fn(),
}));

// Import after mocking
import {
  handleNodeRegister,
  handleNodeHeartbeat,
  handleNodeDisconnect,
} from '../../src/ws/handlers/node-handler.js';
import { getNodeQueries } from '../../src/supabase/nodes.js';

/**
 * WebSocket message types
 */
type WsMessageType =
  | 'node:register'
  | 'node:register:ack'
  | 'node:register:error'
  | 'node:heartbeat'
  | 'node:heartbeat:ack'
  | 'node:heartbeat:error'
  | 'node:disconnect';

/**
 * WebSocket message structure
 */
interface WsMessage<T = unknown> {
  type: WsMessageType;
  payload: T;
  correlationId?: string;
}

/**
 * Mock WebSocket connection
 */
interface MockWebSocket {
  id: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  userId?: string;
}

/**
 * Create a mock WebSocket connection
 */
function createMockWebSocket(overrides: Partial<MockWebSocket> = {}): MockWebSocket {
  return {
    id: 'ws-connection-1',
    send: vi.fn(),
    close: vi.fn(),
    userId: 'dev-user-id',
    ...overrides,
  };
}

/**
 * Parse the JSON sent to ws.send
 */
function parseSentMessage(ws: MockWebSocket): WsMessage | null {
  if (ws.send.mock.calls.length === 0) return null;
  return JSON.parse(ws.send.mock.calls[0][0]);
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
  connectionId: 'ws-connection-1',
  ipAddress: '127.0.0.1',
  userAgent: 'stark-agent/1.0.0',
  allocatable: DEFAULT_ALLOCATABLE,
  allocated: DEFAULT_ALLOCATED,
  labels: {},
  annotations: {},
  taints: [],
  unschedulable: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('WebSocket Node Handlers', () => {
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
    clearConnectionId: ReturnType<typeof vi.fn>;
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
      clearConnectionId: vi.fn(),
    };

    vi.mocked(getNodeQueries).mockReturnValue(mockNodeQueries as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('handleNodeRegister', () => {
    it('should return error when userId is missing', async () => {
      const ws = createMockWebSocket({ userId: undefined });
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: 'test-node', runtimeType: 'node' },
        correlationId: 'req-1',
      };

      await handleNodeRegister(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:register:error',
          payload: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
          correlationId: 'req-1',
        }),
      );
    });

    it('should return error for missing name field', async () => {
      const ws = createMockWebSocket();
      const message: WsMessage<Partial<RegisterNodeInput>> = {
        type: 'node:register',
        payload: { runtimeType: 'node' },
        correlationId: 'req-2',
      };

      await handleNodeRegister(ws, message as WsMessage<RegisterNodeInput>);

      expect(ws.send).toHaveBeenCalled();
      const response = parseSentMessage(ws);
      expect(response).toMatchObject({
        type: 'node:register:error',
        payload: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
        correlationId: 'req-2',
      });
      expect(response?.payload.details.name.code).toBe('REQUIRED');
    });

    it('should return error for missing runtimeType field', async () => {
      const ws = createMockWebSocket();
      const message: WsMessage<Partial<RegisterNodeInput>> = {
        type: 'node:register',
        payload: { name: 'test-node' },
        correlationId: 'req-3',
      };

      await handleNodeRegister(ws, message as WsMessage<RegisterNodeInput>);

      expect(ws.send).toHaveBeenCalled();
      const response = parseSentMessage(ws);
      expect(response).toMatchObject({
        type: 'node:register:error',
        payload: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
        correlationId: 'req-3',
      });
      expect(response?.payload.details.runtimeType.code).toBe('REQUIRED');
    });

    it('should return error for invalid node name format', async () => {
      const ws = createMockWebSocket();
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: '123-invalid', runtimeType: 'node' },
        correlationId: 'req-4',
      };

      await handleNodeRegister(ws, message);

      expect(ws.send).toHaveBeenCalled();
      const response = parseSentMessage(ws);
      expect(response).toMatchObject({
        type: 'node:register:error',
        payload: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
        correlationId: 'req-4',
      });
      expect(response?.payload.details.name.code).toBe('INVALID_FORMAT');
    });

    it('should return error for invalid runtimeType value', async () => {
      const ws = createMockWebSocket();
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: 'test-node', runtimeType: 'invalid' as RuntimeType },
        correlationId: 'req-5',
      };

      await handleNodeRegister(ws, message);

      expect(ws.send).toHaveBeenCalled();
      const response = parseSentMessage(ws);
      expect(response).toMatchObject({
        type: 'node:register:error',
        payload: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
        correlationId: 'req-5',
      });
      expect(response?.payload.details.runtimeType.code).toBe('INVALID_VALUE');
    });

    it('should return conflict error when node name already exists', async () => {
      mockNodeQueries.nodeExists.mockResolvedValue({ data: true, error: null });

      const ws = createMockWebSocket();
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: 'test-node', runtimeType: 'node' },
        correlationId: 'req-6',
      };

      await handleNodeRegister(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:register:error',
          payload: {
            code: 'CONFLICT',
            message: 'Node test-node already exists',
          },
          correlationId: 'req-6',
        }),
      );
    });

    it('should register node successfully and send acknowledgement', async () => {
      mockNodeQueries.nodeExists.mockResolvedValue({ data: false, error: null });
      mockNodeQueries.createNode.mockResolvedValue({ data: sampleNode, error: null });

      const ws = createMockWebSocket();
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: 'test-node', runtimeType: 'node' },
        correlationId: 'req-7',
      };

      await handleNodeRegister(ws, message);

      expect(ws.send).toHaveBeenCalled();
      const response = parseSentMessage(ws);
      expect(response).toMatchObject({
        type: 'node:register:ack',
        correlationId: 'req-7',
      });
      expect(response?.payload.node).toMatchObject({
        id: sampleNode.id,
        name: 'test-node',
        runtimeType: 'node',
        status: 'online',
        connectionId: 'ws-connection-1',
      });

      expect(mockNodeQueries.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-node',
          runtimeType: 'node',
          registeredBy: 'dev-user-id',
          connectionId: 'ws-connection-1',
        }),
      );
    });

    it('should register node with optional capabilities and labels', async () => {
      const nodeWithExtras = {
        ...sampleNode,
        capabilities: { version: '22.0.0', features: ['worker_threads'] },
        labels: { environment: 'production' },
      };

      mockNodeQueries.nodeExists.mockResolvedValue({ data: false, error: null });
      mockNodeQueries.createNode.mockResolvedValue({ data: nodeWithExtras, error: null });

      const ws = createMockWebSocket();
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: {
          name: 'test-node',
          runtimeType: 'node',
          capabilities: { version: '22.0.0', features: ['worker_threads'] },
          labels: { environment: 'production' },
        },
        correlationId: 'req-8',
      };

      await handleNodeRegister(ws, message);

      expect(mockNodeQueries.createNode).toHaveBeenCalledWith(
        expect.objectContaining({
          capabilities: { version: '22.0.0', features: ['worker_threads'] },
          labels: { environment: 'production' },
        }),
      );
    });

    it('should handle database error during node registration', async () => {
      mockNodeQueries.nodeExists.mockResolvedValue({ data: false, error: null });
      mockNodeQueries.createNode.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Connection failed' },
      });

      const ws = createMockWebSocket();
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: 'test-node', runtimeType: 'node' },
        correlationId: 'req-9',
      };

      await handleNodeRegister(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:register:error',
          payload: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to register node',
          },
          correlationId: 'req-9',
        }),
      );
    });
  });

  describe('handleNodeHeartbeat', () => {
    it('should return error when userId is missing', async () => {
      const ws = createMockWebSocket({ userId: undefined });
      const message: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: { nodeId: sampleNode.id, timestamp: new Date() },
        correlationId: 'hb-1',
      };

      await handleNodeHeartbeat(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:heartbeat:error',
          payload: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
          correlationId: 'hb-1',
        }),
      );
    });

    it('should return error for missing nodeId field', async () => {
      const ws = createMockWebSocket();
      const message: WsMessage<Partial<NodeHeartbeat>> = {
        type: 'node:heartbeat',
        payload: { timestamp: new Date() },
        correlationId: 'hb-2',
      };

      await handleNodeHeartbeat(ws, message as WsMessage<NodeHeartbeat>);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:heartbeat:error',
          payload: {
            code: 'VALIDATION_ERROR',
            message: 'nodeId is required',
          },
          correlationId: 'hb-2',
        }),
      );
    });

    it('should return error for invalid UUID format', async () => {
      const ws = createMockWebSocket();
      const message: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: { nodeId: 'not-a-uuid', timestamp: new Date() },
        correlationId: 'hb-3',
      };

      await handleNodeHeartbeat(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:heartbeat:error',
          payload: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid node ID format',
          },
          correlationId: 'hb-3',
        }),
      );
    });

    it('should return error when node not found', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'Not found' },
      });

      const ws = createMockWebSocket();
      const message: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: { nodeId: '00000000-0000-4000-8000-000000000000', timestamp: new Date() },
        correlationId: 'hb-4',
      };

      await handleNodeHeartbeat(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:heartbeat:error',
          payload: {
            code: 'NOT_FOUND',
            message: 'Node not found',
          },
          correlationId: 'hb-4',
        }),
      );
    });

    it('should return error when connection ID does not match', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({
        data: { ...sampleNode, connectionId: 'different-connection' },
        error: null,
      });

      const ws = createMockWebSocket();
      const message: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: { nodeId: sampleNode.id, timestamp: new Date() },
        correlationId: 'hb-5',
      };

      await handleNodeHeartbeat(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:heartbeat:error',
          payload: {
            code: 'FORBIDDEN',
            message: 'Connection does not own this node',
          },
          correlationId: 'hb-5',
        }),
      );
    });

    it('should update heartbeat successfully and send acknowledgement', async () => {
      const now = new Date();
      mockNodeQueries.getNodeById.mockResolvedValue({ data: sampleNode, error: null });
      mockNodeQueries.updateHeartbeat.mockResolvedValue({
        data: { ...sampleNode, lastHeartbeat: now },
        error: null,
      });

      const ws = createMockWebSocket();
      const message: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: { nodeId: sampleNode.id, timestamp: now },
        correlationId: 'hb-6',
      };

      await handleNodeHeartbeat(ws, message);

      expect(ws.send).toHaveBeenCalled();
      const response = parseSentMessage(ws);
      expect(response).toMatchObject({
        type: 'node:heartbeat:ack',
        correlationId: 'hb-6',
      });
      expect(response?.payload.nodeId).toBe(sampleNode.id);
      expect(typeof response?.payload.lastHeartbeat).toBe('string');

      expect(mockNodeQueries.updateHeartbeat).toHaveBeenCalled();
      expect(mockNodeQueries.updateHeartbeat.mock.calls[0][0]).toBe(sampleNode.id);
      // Second arg is optional allocated resources, not a Date
      expect(mockNodeQueries.updateHeartbeat.mock.calls[0][1]).toBeUndefined();
    });

    it('should update heartbeat with status and allocated resources', async () => {
      const now = new Date();
      mockNodeQueries.getNodeById.mockResolvedValue({ data: sampleNode, error: null });
      mockNodeQueries.updateHeartbeat.mockResolvedValue({
        data: { ...sampleNode, lastHeartbeat: now },
        error: null,
      });

      const ws = createMockWebSocket();
      const message: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: {
          nodeId: sampleNode.id,
          timestamp: now,
          status: 'online',
          allocated: { cpu: 500, memory: 512 },
          activePods: ['pod-1', 'pod-2'],
        },
        correlationId: 'hb-7',
      };

      await handleNodeHeartbeat(ws, message);

      expect(mockNodeQueries.updateHeartbeat).toHaveBeenCalledWith(
        sampleNode.id,
        { cpu: 500, memory: 512 },
        'online',
      );
    });

    it('should handle database error during heartbeat update', async () => {
      mockNodeQueries.getNodeById.mockResolvedValue({ data: sampleNode, error: null });
      mockNodeQueries.updateHeartbeat.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Connection failed' },
      });

      const ws = createMockWebSocket();
      const message: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: { nodeId: sampleNode.id, timestamp: new Date() },
        correlationId: 'hb-8',
      };

      await handleNodeHeartbeat(ws, message);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'node:heartbeat:error',
          payload: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to update heartbeat',
          },
          correlationId: 'hb-8',
        }),
      );
    });
  });

  describe('handleNodeDisconnect', () => {
    it('should mark node as offline when connection closes', async () => {
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [sampleNode],
        error: null,
      });
      mockNodeQueries.setNodeStatus.mockResolvedValue({ data: null, error: null });
      mockNodeQueries.clearConnectionId.mockResolvedValue({ data: null, error: null });

      const ws = createMockWebSocket();

      await handleNodeDisconnect(ws);

      expect(mockNodeQueries.listNodes).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'ws-connection-1',
        }),
      );

      expect(mockNodeQueries.setNodeStatus).toHaveBeenCalledWith(sampleNode.id, 'offline');
    });

    it('should mark multiple nodes as offline for the same connection', async () => {
      const node2 = { ...sampleNode, id: '22222222-2222-4222-8222-222222222222', name: 'test-node-2' };
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [sampleNode, node2],
        error: null,
      });
      mockNodeQueries.setNodeStatus.mockResolvedValue({ data: null, error: null });
      mockNodeQueries.clearConnectionId.mockResolvedValue({ data: null, error: null });

      const ws = createMockWebSocket();

      await handleNodeDisconnect(ws);

      expect(mockNodeQueries.setNodeStatus).toHaveBeenCalledTimes(2);
      expect(mockNodeQueries.setNodeStatus).toHaveBeenCalledWith(sampleNode.id, 'offline');
      expect(mockNodeQueries.setNodeStatus).toHaveBeenCalledWith(node2.id, 'offline');
    });

    it('should clear connection ID when node disconnects', async () => {
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [sampleNode],
        error: null,
      });
      mockNodeQueries.setNodeStatus.mockResolvedValue({ data: null, error: null });
      mockNodeQueries.clearConnectionId.mockResolvedValue({ data: null, error: null });

      const ws = createMockWebSocket();

      await handleNodeDisconnect(ws);

      expect(mockNodeQueries.clearConnectionId).toHaveBeenCalledWith(sampleNode.id);
    });

    it('should handle gracefully when no nodes are associated with connection', async () => {
      mockNodeQueries.listNodes.mockResolvedValue({
        data: [],
        error: null,
      });

      const ws = createMockWebSocket();

      await handleNodeDisconnect(ws);

      expect(mockNodeQueries.setNodeStatus).not.toHaveBeenCalled();
    });

    it('should handle database error gracefully during disconnect', async () => {
      mockNodeQueries.listNodes.mockResolvedValue({
        data: null,
        error: { code: 'PGRST000', message: 'Connection failed' },
      });

      const ws = createMockWebSocket();

      // Should not throw
      await expect(handleNodeDisconnect(ws)).resolves.not.toThrow();
    });
  });
});
