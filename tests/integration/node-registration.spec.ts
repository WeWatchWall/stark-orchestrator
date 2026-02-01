/**
 * Integration tests for Node Registration Flow
 * @module tests/integration/node-registration
 *
 * Tests for User Story 2: Node Registration and Health Monitoring
 * These tests verify the complete node registration workflow via WebSocket
 *
 * NOTE: These tests are SKIPPED until NodeManager is implemented (T073)
 * Required implementations:
 * - T072: packages/core/src/models/node.ts (PENDING)
 * - T073: packages/core/src/services/node-manager.ts (PENDING)
 * - T075: packages/server/src/ws/connection-manager.ts (PENDING)
 * - T076: packages/server/src/ws/handlers/node-handler.ts ✓
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Node,
  RuntimeType,
  NodeStatus,
  RegisterNodeInput,
  AllocatableResources,
} from '@stark-o/shared';
import type { Labels, Annotations } from '@stark-o/shared';
import type { Taint } from '@stark-o/shared';
import { DEFAULT_ALLOCATABLE, DEFAULT_ALLOCATED } from '@stark-o/shared';

// Import the handlers directly for integration testing
import {
  handleNodeRegister,
  handleNodeDisconnect,
  type WsConnection,
  type WsMessage,
} from '@stark-o/server/ws/handlers/node-handler';

// Mock Supabase for integration tests
vi.mock('@stark-o/server/supabase/nodes', () => ({
  getNodeQueries: vi.fn(),
}));

import { getNodeQueries } from '@stark-o/server/supabase/nodes';

/**
 * In-memory node store for integration testing
 */
class InMemoryNodeStore {
  private nodes = new Map<string, Node>();
  private nodesByName = new Map<string, Node>();
  private nodesByConnection = new Map<string, Set<string>>();
  private idCounter = 0;

  generateId(): string {
    this.idCounter++;
    return `11111111-1111-4111-8111-${String(this.idCounter).padStart(12, '0')}`;
  }

  async createNode(
    input: RegisterNodeInput & { registeredBy?: string; connectionId?: string; status?: NodeStatus }
  ): Promise<{ data: Node | null; error: { code: string; message: string } | null }> {
    if (this.nodesByName.has(input.name)) {
      return {
        data: null,
        error: { code: 'CONFLICT', message: `Node ${input.name} already exists` },
      };
    }

    const now = new Date();
    const node: Node = {
      id: this.generateId(),
      name: input.name,
      runtimeType: input.runtimeType,
      status: input.status ?? 'online',
      lastHeartbeat: now,
      capabilities: input.capabilities ?? {},
      registeredBy: input.registeredBy,
      connectionId: input.connectionId,
      ipAddress: undefined,
      userAgent: undefined,
      allocatable: { ...DEFAULT_ALLOCATABLE, ...input.allocatable },
      allocated: DEFAULT_ALLOCATED,
      labels: input.labels ?? {},
      annotations: input.annotations ?? {},
      taints: input.taints ?? [],
      unschedulable: false,
      createdAt: now,
      updatedAt: now,
    };

    this.nodes.set(node.id, node);
    this.nodesByName.set(node.name, node);

    if (input.connectionId) {
      if (!this.nodesByConnection.has(input.connectionId)) {
        this.nodesByConnection.set(input.connectionId, new Set());
      }
      this.nodesByConnection.get(input.connectionId)!.add(node.id);
    }

    return { data: node, error: null };
  }

  async getNodeById(
    id: string
  ): Promise<{ data: Node | null; error: { code: string; message: string } | null }> {
    const node = this.nodes.get(id);
    return { data: node ?? null, error: node ? null : { code: 'NOT_FOUND', message: 'Node not found' } };
  }

  async nodeExists(name: string): Promise<{ data: boolean; error: null }> {
    return { data: this.nodesByName.has(name), error: null };
  }

  async listNodes(
    filters: { connectionId?: string }
  ): Promise<{ data: Node[] | null; error: null }> {
    if (filters.connectionId) {
      const nodeIds = this.nodesByConnection.get(filters.connectionId);
      if (!nodeIds) return { data: [], error: null };
      const nodes = Array.from(nodeIds)
        .map((id) => this.nodes.get(id))
        .filter((n): n is Node => n !== undefined);
      return { data: nodes, error: null };
    }
    return { data: Array.from(this.nodes.values()), error: null };
  }

  async setNodeStatus(
    id: string,
    status: NodeStatus
  ): Promise<{ data: Node | null; error: { code: string; message: string } | null }> {
    const node = this.nodes.get(id);
    if (!node) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Node not found' } };
    }
    node.status = status;
    node.updatedAt = new Date();
    return { data: node, error: null };
  }

  async updateNode(
    id: string,
    updates: Partial<Node>
  ): Promise<{ data: Node | null; error: { code: string; message: string } | null }> {
    const node = this.nodes.get(id);
    if (!node) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Node not found' } };
    }

    // Handle connectionId updates for connection tracking
    if ('connectionId' in updates && updates.connectionId !== node.connectionId) {
      // Remove from old connection
      if (node.connectionId) {
        const oldSet = this.nodesByConnection.get(node.connectionId);
        oldSet?.delete(node.id);
      }
      // Add to new connection
      if (updates.connectionId) {
        if (!this.nodesByConnection.has(updates.connectionId)) {
          this.nodesByConnection.set(updates.connectionId, new Set());
        }
        this.nodesByConnection.get(updates.connectionId)!.add(node.id);
      }
    }

    Object.assign(node, updates, { updatedAt: new Date() });
    return { data: node, error: null };
  }

  clear(): void {
    this.nodes.clear();
    this.nodesByName.clear();
    this.nodesByConnection.clear();
    this.idCounter = 0;
  }

  getAll(): Node[] {
    return Array.from(this.nodes.values());
  }
}

/**
 * Mock WebSocket connection for testing
 */
interface MockWsConnection extends WsConnection {
  messages: string[];
  closed: boolean;
}

function createMockWsConnection(overrides: Partial<WsConnection> = {}): MockWsConnection {
  const connection: MockWsConnection = {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userId: 'test-user-1',
    messages: [],
    closed: false,
    send(data: string) {
      this.messages.push(data);
    },
    close() {
      this.closed = true;
    },
    ...overrides,
  };
  return connection;
}

/**
 * Parse the last message sent to a WebSocket connection
 */
function parseLastMessage(ws: MockWsConnection): unknown {
  if (ws.messages.length === 0) return null;
  return JSON.parse(ws.messages[ws.messages.length - 1]);
}

describe('Node Registration Integration Tests', () => {
  let nodeStore: InMemoryNodeStore;

  beforeEach(() => {
    vi.clearAllMocks();
    nodeStore = new InMemoryNodeStore();

    // Wire up the mock to use our in-memory store
    vi.mocked(getNodeQueries).mockReturnValue({
      createNode: nodeStore.createNode.bind(nodeStore),
      getNodeById: nodeStore.getNodeById.bind(nodeStore),
      nodeExists: nodeStore.nodeExists.bind(nodeStore),
      listNodes: nodeStore.listNodes.bind(nodeStore),
      setNodeStatus: nodeStore.setNodeStatus.bind(nodeStore),
      updateNode: nodeStore.updateNode.bind(nodeStore),
      // Add other methods as needed
      getNodeByName: vi.fn(),
      countNodes: vi.fn(),
      deleteNode: vi.fn(),
      updateHeartbeat: vi.fn(),
      clearConnectionId: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    } as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
    nodeStore.clear();
  });

  describe('Complete Registration Flow', () => {
    it('should register a new node and return acknowledgement', async () => {
      const ws = createMockWsConnection({ id: 'ws-conn-1', userId: 'operator-1' });
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: {
          name: 'production-node-1',
          runtimeType: 'node',
        },
        correlationId: 'reg-1',
      };

      await handleNodeRegister(ws, message);

      // Verify acknowledgement was sent
      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:register:ack');
      expect(response.correlationId).toBe('reg-1');
      expect(response.payload.node).toBeDefined();
      expect(response.payload.node.name).toBe('production-node-1');
      expect(response.payload.node.runtimeType).toBe('node');
      expect(response.payload.node.status).toBe('online');
      expect(response.payload.node.connectionId).toBe('ws-conn-1');

      // Verify node was persisted
      const allNodes = nodeStore.getAll();
      expect(allNodes).toHaveLength(1);
      expect(allNodes[0].name).toBe('production-node-1');
      expect(allNodes[0].registeredBy).toBe('operator-1');
    });

    it('should register node with full configuration', async () => {
      const ws = createMockWsConnection({ id: 'ws-conn-2', userId: 'operator-1' });
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: {
          name: 'high-capacity-node',
          runtimeType: 'node',
          capabilities: {
            version: '22.0.0',
            features: ['worker_threads', 'http2', 'esm'],
          },
          allocatable: {
            cpu: 8000,
            memory: 16384,
            pods: 200,
            storage: 100000,
          },
          labels: {
            environment: 'production',
            tier: 'compute',
            region: 'us-west-2',
          },
          annotations: {
            'deployment/version': 'v2.3.0',
          },
          taints: [
            { key: 'dedicated', value: 'high-priority', effect: 'NoSchedule' },
          ],
        },
        correlationId: 'reg-2',
      };

      await handleNodeRegister(ws, message);

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:register:ack');

      const node = response.payload.node;
      expect(node.capabilities.version).toBe('22.0.0');
      expect(node.capabilities.features).toContain('worker_threads');
      expect(node.allocatable.cpu).toBe(8000);
      expect(node.allocatable.memory).toBe(16384);
      expect(node.labels.environment).toBe('production');
      expect(node.annotations['deployment/version']).toBe('v2.3.0');
      expect(node.taints).toHaveLength(1);
      expect(node.taints[0].key).toBe('dedicated');
    });

    it('should register browser runtime node', async () => {
      const ws = createMockWsConnection({ id: 'ws-browser-1', userId: 'user-1' });
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: {
          name: 'browser-worker-1',
          runtimeType: 'browser',
          capabilities: {
            version: 'Chrome 120',
            features: ['web-workers', 'wasm'],
          },
        },
        correlationId: 'reg-3',
      };

      await handleNodeRegister(ws, message);

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:register:ack');
      expect(response.payload.node.runtimeType).toBe('browser');
      expect(response.payload.node.capabilities.version).toBe('Chrome 120');
    });

    it('should allow multiple nodes from different connections', async () => {
      // Register first node
      const ws1 = createMockWsConnection({ id: 'ws-1', userId: 'operator-1' });
      await handleNodeRegister(ws1, {
        type: 'node:register',
        payload: { name: 'node-alpha', runtimeType: 'node' },
        correlationId: 'reg-alpha',
      });

      // Register second node
      const ws2 = createMockWsConnection({ id: 'ws-2', userId: 'operator-2' });
      await handleNodeRegister(ws2, {
        type: 'node:register',
        payload: { name: 'node-beta', runtimeType: 'node' },
        correlationId: 'reg-beta',
      });

      // Register third node (browser)
      const ws3 = createMockWsConnection({ id: 'ws-3', userId: 'user-1' });
      await handleNodeRegister(ws3, {
        type: 'node:register',
        payload: { name: 'browser-gamma', runtimeType: 'browser' },
        correlationId: 'reg-gamma',
      });

      // Verify all nodes are registered
      const allNodes = nodeStore.getAll();
      expect(allNodes).toHaveLength(3);
      expect(allNodes.map((n) => n.name).sort()).toEqual([
        'browser-gamma',
        'node-alpha',
        'node-beta',
      ]);
    });
  });

  describe('Validation and Error Handling', () => {
    it('should reject registration without authentication', async () => {
      const ws = createMockWsConnection({ id: 'ws-anon', userId: undefined });
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: 'anon-node', runtimeType: 'node' },
        correlationId: 'reg-anon',
      };

      await handleNodeRegister(ws, message);

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:register:error');
      expect(response.payload.code).toBe('UNAUTHORIZED');
      expect(response.payload.message).toBe('Authentication required');

      // Verify node was NOT created
      expect(nodeStore.getAll()).toHaveLength(0);
    });

    it('should reject registration with missing name', async () => {
      const ws = createMockWsConnection();
      const message: WsMessage<Partial<RegisterNodeInput>> = {
        type: 'node:register',
        payload: { runtimeType: 'node' },
        correlationId: 'reg-noname',
      } as any;

      await handleNodeRegister(ws, message as any);

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:register:error');
      expect(response.payload.code).toBe('VALIDATION_ERROR');
      expect(response.payload.details.name.code).toBe('REQUIRED');
    });

    it('should reject registration with missing runtimeType', async () => {
      const ws = createMockWsConnection();
      const message: WsMessage<Partial<RegisterNodeInput>> = {
        type: 'node:register',
        payload: { name: 'test-node' },
        correlationId: 'reg-notype',
      } as any;

      await handleNodeRegister(ws, message as any);

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:register:error');
      expect(response.payload.code).toBe('VALIDATION_ERROR');
      expect(response.payload.details.runtimeType.code).toBe('REQUIRED');
    });

    it('should reject registration with invalid node name format', async () => {
      const ws = createMockWsConnection();
      const invalidNames = [
        '123-starts-with-number',
        '-starts-with-dash',
        'ends-with-dash-',
        'has spaces',
        'special@chars!',
        '', // empty
      ];

      for (const name of invalidNames) {
        const message: WsMessage<RegisterNodeInput> = {
          type: 'node:register',
          payload: { name, runtimeType: 'node' },
          correlationId: `reg-invalid-${name}`,
        };

        await handleNodeRegister(ws, message);

        const response = parseLastMessage(ws) as any;
        expect(response.type).toBe('node:register:error');
        expect(response.payload.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject registration with invalid runtimeType', async () => {
      const ws = createMockWsConnection();
      const message: WsMessage<RegisterNodeInput> = {
        type: 'node:register',
        payload: { name: 'test-node', runtimeType: 'python' as RuntimeType },
        correlationId: 'reg-badtype',
      };

      await handleNodeRegister(ws, message);

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:register:error');
      expect(response.payload.code).toBe('VALIDATION_ERROR');
      expect(response.payload.details.runtimeType.code).toBe('INVALID_VALUE');
    });

    it('should reject duplicate node name registration', async () => {
      const ws1 = createMockWsConnection({ id: 'ws-1' });
      const ws2 = createMockWsConnection({ id: 'ws-2' });

      // First registration succeeds
      await handleNodeRegister(ws1, {
        type: 'node:register',
        payload: { name: 'unique-node', runtimeType: 'node' },
        correlationId: 'reg-first',
      });

      expect((parseLastMessage(ws1) as any).type).toBe('node:register:ack');

      // Second registration with same name fails
      await handleNodeRegister(ws2, {
        type: 'node:register',
        payload: { name: 'unique-node', runtimeType: 'browser' },
        correlationId: 'reg-second',
      });

      const response = parseLastMessage(ws2) as any;
      expect(response.type).toBe('node:register:error');
      expect(response.payload.code).toBe('CONFLICT');
      expect(response.payload.message).toContain('unique-node');

      // Verify only one node exists
      expect(nodeStore.getAll()).toHaveLength(1);
    });
  });

  describe('Connection Tracking', () => {
    it('should associate node with WebSocket connection', async () => {
      const ws = createMockWsConnection({ id: 'tracked-conn-1' });
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'tracked-node', runtimeType: 'node' },
        correlationId: 'reg-track',
      });

      const nodes = nodeStore.getAll();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].connectionId).toBe('tracked-conn-1');
    });

    it('should allow same connection to register multiple nodes', async () => {
      const ws = createMockWsConnection({ id: 'multi-conn' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'multi-node-1', runtimeType: 'node' },
        correlationId: 'reg-m1',
      });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'multi-node-2', runtimeType: 'node' },
        correlationId: 'reg-m2',
      });

      const nodes = nodeStore.getAll();
      expect(nodes).toHaveLength(2);
      expect(nodes.every((n) => n.connectionId === 'multi-conn')).toBe(true);
    });
  });

  describe('Node Disconnect Flow', () => {
    it('should mark nodes as offline when connection disconnects', async () => {
      const ws = createMockWsConnection({ id: 'disconnect-conn' });

      // Register a node
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'will-disconnect', runtimeType: 'node' },
        correlationId: 'reg-disc',
      });

      const nodes = nodeStore.getAll();
      expect(nodes[0].status).toBe('online');

      // Simulate disconnect
      await handleNodeDisconnect(ws);

      // Verify node is now offline
      const updatedNodes = nodeStore.getAll();
      expect(updatedNodes[0].status).toBe('offline');
    });

    it('should mark all nodes from connection as offline on disconnect', async () => {
      const ws = createMockWsConnection({ id: 'multi-disconnect' });

      // Register multiple nodes
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'disc-node-1', runtimeType: 'node' },
        correlationId: 'reg-d1',
      });
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'disc-node-2', runtimeType: 'node' },
        correlationId: 'reg-d2',
      });

      // Verify both online
      let nodes = nodeStore.getAll();
      expect(nodes.every((n) => n.status === 'online')).toBe(true);

      // Disconnect
      await handleNodeDisconnect(ws);

      // Verify both offline
      nodes = nodeStore.getAll();
      expect(nodes.every((n) => n.status === 'offline')).toBe(true);
    });

    it('should not affect other connections when one disconnects', async () => {
      const ws1 = createMockWsConnection({ id: 'stay-conn' });
      const ws2 = createMockWsConnection({ id: 'leave-conn' });

      await handleNodeRegister(ws1, {
        type: 'node:register',
        payload: { name: 'stays-online', runtimeType: 'node' },
        correlationId: 'reg-stay',
      });
      await handleNodeRegister(ws2, {
        type: 'node:register',
        payload: { name: 'goes-offline', runtimeType: 'node' },
        correlationId: 'reg-leave',
      });

      // Disconnect only ws2
      await handleNodeDisconnect(ws2);

      const nodes = nodeStore.getAll();
      const staysOnline = nodes.find((n) => n.name === 'stays-online');
      const goesOffline = nodes.find((n) => n.name === 'goes-offline');

      expect(staysOnline?.status).toBe('online');
      expect(goesOffline?.status).toBe('offline');
    });
  });

  describe('Initial Node State', () => {
    it('should initialize node with online status', async () => {
      const ws = createMockWsConnection();
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'new-node', runtimeType: 'node' },
        correlationId: 'reg-init',
      });

      const nodes = nodeStore.getAll();
      expect(nodes[0].status).toBe('online');
    });

    it('should initialize allocated resources to zero', async () => {
      const ws = createMockWsConnection();
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: {
          name: 'resource-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        correlationId: 'reg-res',
      });

      const nodes = nodeStore.getAll();
      expect(nodes[0].allocated).toEqual(DEFAULT_ALLOCATED);
      expect(nodes[0].allocatable.cpu).toBe(4000);
    });

    it('should set lastHeartbeat on registration', async () => {
      const beforeReg = new Date();
      const ws = createMockWsConnection();

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'heartbeat-node', runtimeType: 'node' },
        correlationId: 'reg-hb',
      });

      const afterReg = new Date();
      const nodes = nodeStore.getAll();

      expect(nodes[0].lastHeartbeat).toBeDefined();
      expect(nodes[0].lastHeartbeat!.getTime()).toBeGreaterThanOrEqual(beforeReg.getTime());
      expect(nodes[0].lastHeartbeat!.getTime()).toBeLessThanOrEqual(afterReg.getTime());
    });

    it('should initialize node as schedulable by default', async () => {
      const ws = createMockWsConnection();
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'schedulable-node', runtimeType: 'node' },
        correlationId: 'reg-sched',
      });

      const nodes = nodeStore.getAll();
      expect(nodes[0].unschedulable).toBe(false);
    });
  });
});
