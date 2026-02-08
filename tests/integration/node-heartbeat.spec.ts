/**
 * Integration tests for Node Heartbeat and Timeout Flow
 * @module tests/integration/node-heartbeat
 *
 * Tests for User Story 2: Node Registration and Health Monitoring
 * These tests verify heartbeat processing and timeout detection
 *
 * NOTE: These tests are SKIPPED until NodeManager is implemented (T073)
 * Required implementations:
 * - T072: packages/core/src/models/node.ts (PENDING)
 * - T073: packages/core/src/services/node-manager.ts (PENDING)
 * - T076: packages/server/src/ws/handlers/node-handler.ts ✓
 * - T078: Heartbeat timeout logic (30s) marking nodes unhealthy (PENDING)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  Node,
  RuntimeType,
  NodeStatus,
  RegisterNodeInput,
  NodeHeartbeat,
  AllocatableResources,
} from '@stark-o/shared';
import { DEFAULT_ALLOCATABLE, DEFAULT_ALLOCATED } from '@stark-o/shared';

// Import the handlers directly for integration testing
import {
  handleNodeRegister,
  handleNodeHeartbeat,
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
 * In-memory node store for integration testing with heartbeat tracking
 */
class InMemoryNodeStore {
  private nodes = new Map<string, Node>();
  private nodesByName = new Map<string, Node>();
  private nodesByConnection = new Map<string, Set<string>>();
  private idCounter = 0;

  /** Heartbeat timeout in milliseconds (30 seconds) */
  static readonly HEARTBEAT_TIMEOUT_MS = 30_000;

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
    return { data: node ?? null, error: node ? null : { code: 'PGRST116', message: 'Not found' } };
  }

  async nodeExists(name: string): Promise<{ data: boolean; error: null }> {
    return { data: this.nodesByName.has(name), error: null };
  }

  async listNodes(
    filters: { connectionId?: string; status?: NodeStatus }
  ): Promise<{ data: Node[] | null; error: null }> {
    let nodes = Array.from(this.nodes.values());

    if (filters.connectionId) {
      const nodeIds = this.nodesByConnection.get(filters.connectionId);
      if (!nodeIds) return { data: [], error: null };
      nodes = Array.from(nodeIds)
        .map((id) => this.nodes.get(id))
        .filter((n): n is Node => n !== undefined);
    }

    if (filters.status) {
      nodes = nodes.filter((n) => n.status === filters.status);
    }

    return { data: nodes, error: null };
  }

  async updateHeartbeat(
    nodeId: string,
    allocated?: Partial<AllocatableResources>,
    status?: NodeStatus
  ): Promise<{ data: void | null; error: { code: string; message: string } | null }> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Node not found' } };
    }

    node.lastHeartbeat = new Date();
    // Preserve special statuses (draining, maintenance) if no new status is provided
    if (status !== undefined) {
      node.status = status;
    } else if (node.status !== 'draining' && node.status !== 'maintenance') {
      node.status = 'online';
    }
    node.updatedAt = new Date();

    if (allocated) {
      node.allocated = { ...node.allocated, ...allocated };
    }

    return { data: undefined, error: null };
  }

  async clearConnectionId(nodeId: string): Promise<{ data: void | null; error: { code: string; message: string } | null }> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Node not found' } };
    }

    // Remove from connection tracking
    if (node.connectionId) {
      const connSet = this.nodesByConnection.get(node.connectionId);
      connSet?.delete(node.id);
    }
    node.connectionId = undefined;
    node.updatedAt = new Date();

    return { data: undefined, error: null };
  }

  async markNodeSuspect(
    id: string
  ): Promise<{ data: void | null; error: { code: string; message: string } | null }> {
    const node = this.nodes.get(id);
    if (!node) {
      return { data: null, error: { code: 'NOT_FOUND', message: 'Node not found' } };
    }
    node.status = 'suspect' as NodeStatus;
    node.updatedAt = new Date();
    return { data: undefined, error: null };
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
    updates: Partial<Node> & { connectionId?: string | null }
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

  /**
   * Check for nodes that have exceeded heartbeat timeout
   * This simulates what the NodeManager would do
   */
  getStaleNodes(timeoutMs: number = InMemoryNodeStore.HEARTBEAT_TIMEOUT_MS): Node[] {
    const now = Date.now();
    return Array.from(this.nodes.values()).filter((node) => {
      if (node.status === 'offline' || node.status === 'suspect') return false;
      if (!node.lastHeartbeat) return true;
      return now - node.lastHeartbeat.getTime() > timeoutMs;
    });
  }

  /**
   * Mark stale nodes as unhealthy (simulates NodeManager heartbeat check)
   */
  async markStaleNodesUnhealthy(timeoutMs?: number): Promise<Node[]> {
    const staleNodes = this.getStaleNodes(timeoutMs);
    for (const node of staleNodes) {
      await this.setNodeStatus(node.id, 'unhealthy');
    }
    return staleNodes;
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

  getById(id: string): Node | undefined {
    return this.nodes.get(id);
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

describe('Node Heartbeat Integration Tests', () => {
  let nodeStore: InMemoryNodeStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    nodeStore = new InMemoryNodeStore();

    // Wire up the mock to use our in-memory store
    vi.mocked(getNodeQueries).mockReturnValue({
      createNode: nodeStore.createNode.bind(nodeStore),
      getNodeById: nodeStore.getNodeById.bind(nodeStore),
      nodeExists: nodeStore.nodeExists.bind(nodeStore),
      listNodes: nodeStore.listNodes.bind(nodeStore),
      setNodeStatus: nodeStore.setNodeStatus.bind(nodeStore),
      updateNode: nodeStore.updateNode.bind(nodeStore),
      updateHeartbeat: nodeStore.updateHeartbeat.bind(nodeStore),
      clearConnectionId: nodeStore.clearConnectionId.bind(nodeStore),
      markNodeSuspect: nodeStore.markNodeSuspect.bind(nodeStore),
      getNodeByName: vi.fn(),
      countNodes: vi.fn(),
      deleteNode: vi.fn(),
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    nodeStore.clear();
  });

  describe('Heartbeat Processing', () => {
    it('should accept heartbeat from registered node', async () => {
      const ws = createMockWsConnection({ id: 'ws-hb-1', userId: 'operator-1' });

      // Register a node first
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'heartbeat-node', runtimeType: 'node' },
        correlationId: 'reg-1',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Send heartbeat
      const heartbeatMessage: WsMessage<NodeHeartbeat> = {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
        },
        correlationId: 'hb-1',
      };

      await handleNodeHeartbeat(ws, heartbeatMessage);

      const hbResponse = parseLastMessage(ws) as any;
      expect(hbResponse.type).toBe('node:heartbeat:ack');
      expect(hbResponse.correlationId).toBe('hb-1');
      expect(hbResponse.payload.nodeId).toBe(nodeId);
      expect(hbResponse.payload.lastHeartbeat).toBeDefined();
    });

    it('should update lastHeartbeat timestamp on heartbeat', async () => {
      const ws = createMockWsConnection({ id: 'ws-hb-2' });

      // Register node
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'timestamp-node', runtimeType: 'node' },
        correlationId: 'reg-2',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;
      const initialHeartbeat = nodeStore.getById(nodeId)?.lastHeartbeat;

      // Advance time
      vi.advanceTimersByTime(5000);

      // Send heartbeat
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { nodeId, timestamp: new Date() },
        correlationId: 'hb-2',
      });

      const updatedNode = nodeStore.getById(nodeId);
      expect(updatedNode?.lastHeartbeat).toBeDefined();
      expect(updatedNode!.lastHeartbeat!.getTime()).toBeGreaterThan(initialHeartbeat!.getTime());
    });

    it('should update allocated resources with heartbeat', async () => {
      const ws = createMockWsConnection({ id: 'ws-hb-3' });

      // Register node with capacity
      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: {
          name: 'resource-node',
          runtimeType: 'node',
          allocatable: { cpu: 4000, memory: 8192, pods: 100, storage: 50000 },
        },
        correlationId: 'reg-3',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Verify initial allocated is zero
      let node = nodeStore.getById(nodeId);
      expect(node?.allocated.cpu).toBe(0);
      expect(node?.allocated.memory).toBe(0);

      // Send heartbeat with updated allocation
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          allocated: { cpu: 1500, memory: 2048, pods: 5 },
        },
        correlationId: 'hb-3',
      });

      node = nodeStore.getById(nodeId);
      expect(node?.allocated.cpu).toBe(1500);
      expect(node?.allocated.memory).toBe(2048);
      expect(node?.allocated.pods).toBe(5);
    });

    it('should update node status with heartbeat', async () => {
      const ws = createMockWsConnection({ id: 'ws-hb-4' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'status-node', runtimeType: 'node' },
        correlationId: 'reg-4',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Verify initial status
      expect(nodeStore.getById(nodeId)?.status).toBe('online');

      // Send heartbeat with draining status
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          status: 'draining',
        },
        correlationId: 'hb-4',
      });

      expect(nodeStore.getById(nodeId)?.status).toBe('draining');
    });

    it('should process multiple consecutive heartbeats', async () => {
      const ws = createMockWsConnection({ id: 'ws-hb-5' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'multi-hb-node', runtimeType: 'node' },
        correlationId: 'reg-5',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Send 5 heartbeats at 10 second intervals
      for (let i = 1; i <= 5; i++) {
        vi.advanceTimersByTime(10_000);
        await handleNodeHeartbeat(ws, {
          type: 'node:heartbeat',
          payload: {
            nodeId,
            timestamp: new Date(),
            allocated: { cpu: i * 200, memory: i * 512 },
          },
          correlationId: `hb-multi-${i}`,
        });

        const response = parseLastMessage(ws) as any;
        expect(response.type).toBe('node:heartbeat:ack');
      }

      const node = nodeStore.getById(nodeId);
      expect(node?.allocated.cpu).toBe(1000); // 5 * 200
      expect(node?.allocated.memory).toBe(2560); // 5 * 512
    });
  });

  describe('Heartbeat Validation', () => {
    it('should reject heartbeat without authentication', async () => {
      const ws = createMockWsConnection({ id: 'ws-anon', userId: undefined });

      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { nodeId: '11111111-1111-4111-8111-000000000001', timestamp: new Date() },
        correlationId: 'hb-anon',
      });

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:heartbeat:error');
      expect(response.payload.code).toBe('UNAUTHORIZED');
    });

    it('should reject heartbeat with missing nodeId', async () => {
      const ws = createMockWsConnection();

      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { timestamp: new Date() } as any,
        correlationId: 'hb-noid',
      });

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:heartbeat:error');
      expect(response.payload.code).toBe('VALIDATION_ERROR');
      expect(response.payload.message).toContain('nodeId');
    });

    it('should reject heartbeat with invalid nodeId format', async () => {
      const ws = createMockWsConnection();

      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { nodeId: 'not-a-uuid', timestamp: new Date() },
        correlationId: 'hb-baduuid',
      });

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:heartbeat:error');
      expect(response.payload.code).toBe('VALIDATION_ERROR');
      expect(response.payload.message).toContain('Invalid');
    });

    it('should reject heartbeat for non-existent node', async () => {
      const ws = createMockWsConnection();
      const fakeNodeId = '99999999-9999-4999-8999-999999999999';

      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { nodeId: fakeNodeId, timestamp: new Date() },
        correlationId: 'hb-notfound',
      });

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:heartbeat:error');
      expect(response.payload.code).toBe('NOT_FOUND');
    });

    it('should reject heartbeat from wrong connection', async () => {
      const ws1 = createMockWsConnection({ id: 'ws-owner' });
      const ws2 = createMockWsConnection({ id: 'ws-imposter' });

      // Register node on ws1
      await handleNodeRegister(ws1, {
        type: 'node:register',
        payload: { name: 'owned-node', runtimeType: 'node' },
        correlationId: 'reg-owner',
      });

      const regResponse = parseLastMessage(ws1) as any;
      const nodeId = regResponse.payload.node.id;

      // Try heartbeat from ws2
      await handleNodeHeartbeat(ws2, {
        type: 'node:heartbeat',
        payload: { nodeId, timestamp: new Date() },
        correlationId: 'hb-imposter',
      });

      const response = parseLastMessage(ws2) as any;
      expect(response.type).toBe('node:heartbeat:error');
      expect(response.payload.code).toBe('FORBIDDEN');
      expect(response.payload.message).toContain('Connection does not own');
    });
  });

  describe('Heartbeat Timeout Detection', () => {
    const TIMEOUT_MS = 30_000; // 30 seconds

    it('should detect node as stale after heartbeat timeout', async () => {
      const ws = createMockWsConnection({ id: 'ws-stale' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'will-timeout', runtimeType: 'node' },
        correlationId: 'reg-stale',
      });

      // Immediately after registration, node should not be stale
      expect(nodeStore.getStaleNodes(TIMEOUT_MS)).toHaveLength(0);

      // Advance time past timeout
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);

      // Node should now be stale
      const staleNodes = nodeStore.getStaleNodes(TIMEOUT_MS);
      expect(staleNodes).toHaveLength(1);
      expect(staleNodes[0].name).toBe('will-timeout');
    });

    it('should not mark node as stale if heartbeat received within timeout', async () => {
      const ws = createMockWsConnection({ id: 'ws-healthy' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'stays-healthy', runtimeType: 'node' },
        correlationId: 'reg-healthy',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Advance 25 seconds (within timeout)
      vi.advanceTimersByTime(25_000);

      // Send heartbeat
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { nodeId, timestamp: new Date() },
        correlationId: 'hb-healthy',
      });

      // Advance another 25 seconds
      vi.advanceTimersByTime(25_000);

      // Node should not be stale (heartbeat reset the timer)
      expect(nodeStore.getStaleNodes(TIMEOUT_MS)).toHaveLength(0);
    });

    it('should mark stale nodes as unhealthy', async () => {
      const ws = createMockWsConnection({ id: 'ws-timeout' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'becomes-unhealthy', runtimeType: 'node' },
        correlationId: 'reg-timeout',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Verify initially online
      expect(nodeStore.getById(nodeId)?.status).toBe('online');

      // Advance past timeout
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);

      // Simulate NodeManager checking for stale nodes
      await nodeStore.markStaleNodesUnhealthy(TIMEOUT_MS);

      // Verify now unhealthy
      expect(nodeStore.getById(nodeId)?.status).toBe('unhealthy');
    });

    it('should handle multiple nodes with different timeout states', async () => {
      const ws1 = createMockWsConnection({ id: 'ws-active' });
      const ws2 = createMockWsConnection({ id: 'ws-inactive' });

      // Register two nodes
      await handleNodeRegister(ws1, {
        type: 'node:register',
        payload: { name: 'active-node', runtimeType: 'node' },
        correlationId: 'reg-active',
      });

      await handleNodeRegister(ws2, {
        type: 'node:register',
        payload: { name: 'inactive-node', runtimeType: 'node' },
        correlationId: 'reg-inactive',
      });

      const reg1 = parseLastMessage(ws1) as any;
      const activeNodeId = reg1.payload.node.id;

      // Advance 15 seconds
      vi.advanceTimersByTime(15_000);

      // Active node sends heartbeat
      await handleNodeHeartbeat(ws1, {
        type: 'node:heartbeat',
        payload: { nodeId: activeNodeId, timestamp: new Date() },
        correlationId: 'hb-active',
      });

      // Advance another 20 seconds (35 seconds since inactive registered)
      vi.advanceTimersByTime(20_000);

      // Check stale nodes
      const staleNodes = nodeStore.getStaleNodes(TIMEOUT_MS);
      expect(staleNodes).toHaveLength(1);
      expect(staleNodes[0].name).toBe('inactive-node');

      // Active node should still be healthy
      const healthyNodes = nodeStore.getAll().filter((n) => n.status === 'online');
      expect(healthyNodes).toHaveLength(2); // Both still online until marked

      // Mark stale as unhealthy
      await nodeStore.markStaleNodesUnhealthy(TIMEOUT_MS);

      // Verify states
      const allNodes = nodeStore.getAll();
      const activeNode = allNodes.find((n) => n.name === 'active-node');
      const inactiveNode = allNodes.find((n) => n.name === 'inactive-node');

      expect(activeNode?.status).toBe('online');
      expect(inactiveNode?.status).toBe('unhealthy');
    });

    it('should recover unhealthy node when heartbeat resumes', async () => {
      const ws = createMockWsConnection({ id: 'ws-recover' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'will-recover', runtimeType: 'node' },
        correlationId: 'reg-recover',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Timeout and mark unhealthy
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);
      await nodeStore.markStaleNodesUnhealthy(TIMEOUT_MS);
      expect(nodeStore.getById(nodeId)?.status).toBe('unhealthy');

      // Node recovers and sends heartbeat with online status
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          status: 'online',
        },
        correlationId: 'hb-recover',
      });

      // Should be back online
      expect(nodeStore.getById(nodeId)?.status).toBe('online');
    });
  });

  describe('Heartbeat with Pod Activity', () => {
    it('should track active pods reported in heartbeat', async () => {
      const ws = createMockWsConnection({ id: 'ws-pods' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'pod-node', runtimeType: 'node' },
        correlationId: 'reg-pods',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Heartbeat with active pods
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          activePods: ['pod-1', 'pod-2', 'pod-3'],
          allocated: { cpu: 750, memory: 1536, pods: 3 },
        },
        correlationId: 'hb-pods',
      });

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:heartbeat:ack');

      // Verify resource tracking
      const node = nodeStore.getById(nodeId);
      expect(node?.allocated.pods).toBe(3);
      expect(node?.allocated.cpu).toBe(750);
    });

    it('should update allocation when pods are removed', async () => {
      const ws = createMockWsConnection({ id: 'ws-pod-remove' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'shrinking-node', runtimeType: 'node' },
        correlationId: 'reg-shrink',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Initial heartbeat with 3 pods
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          allocated: { cpu: 900, memory: 1800, pods: 3 },
        },
        correlationId: 'hb-initial',
      });

      expect(nodeStore.getById(nodeId)?.allocated.pods).toBe(3);

      // Pod removed
      vi.advanceTimersByTime(5000);
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          allocated: { cpu: 600, memory: 1200, pods: 2 },
        },
        correlationId: 'hb-reduced',
      });

      const node = nodeStore.getById(nodeId);
      expect(node?.allocated.pods).toBe(2);
      expect(node?.allocated.cpu).toBe(600);
    });
  });

  describe('Edge Cases', () => {
    const TIMEOUT_MS = 30_000; // 30 seconds

    it('should handle heartbeat immediately after registration', async () => {
      const ws = createMockWsConnection({ id: 'ws-immediate' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'immediate-hb', runtimeType: 'node' },
        correlationId: 'reg-imm',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Send heartbeat immediately
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { nodeId, timestamp: new Date() },
        correlationId: 'hb-imm',
      });

      const response = parseLastMessage(ws) as any;
      expect(response.type).toBe('node:heartbeat:ack');
    });

    it('should handle offline node not being marked stale', async () => {
      const ws = createMockWsConnection({ id: 'ws-offline' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'offline-node', runtimeType: 'node' },
        correlationId: 'reg-offline',
      });

      // Simulate disconnect
      await handleNodeDisconnect(ws);

      // Advance past timeout
      vi.advanceTimersByTime(TIMEOUT_MS + 1000);

      // Offline nodes should not be in stale list
      const staleNodes = nodeStore.getStaleNodes(TIMEOUT_MS);
      expect(staleNodes).toHaveLength(0);
    });

    it('should handle draining node heartbeat', async () => {
      const ws = createMockWsConnection({ id: 'ws-drain' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'draining-node', runtimeType: 'node' },
        correlationId: 'reg-drain',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Set to draining
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          status: 'draining',
        },
        correlationId: 'hb-drain',
      });

      // Subsequent heartbeats maintain draining status
      vi.advanceTimersByTime(10_000);
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          // No status - should keep draining
        },
        correlationId: 'hb-drain-2',
      });

      expect(nodeStore.getById(nodeId)?.status).toBe('draining');
    });

    it('should handle maintenance mode correctly', async () => {
      const ws = createMockWsConnection({ id: 'ws-maint' });

      await handleNodeRegister(ws, {
        type: 'node:register',
        payload: { name: 'maintenance-node', runtimeType: 'node' },
        correlationId: 'reg-maint',
      });

      const regResponse = parseLastMessage(ws) as any;
      const nodeId = regResponse.payload.node.id;

      // Enter maintenance
      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: {
          nodeId,
          timestamp: new Date(),
          status: 'maintenance',
        },
        correlationId: 'hb-maint',
      });

      expect(nodeStore.getById(nodeId)?.status).toBe('maintenance');

      // Advance time - should still be tracked even in maintenance
      vi.advanceTimersByTime(20_000);

      await handleNodeHeartbeat(ws, {
        type: 'node:heartbeat',
        payload: { nodeId, timestamp: new Date() },
        correlationId: 'hb-maint-2',
      });

      // Node should have updated heartbeat
      const node = nodeStore.getById(nodeId);
      expect(node?.lastHeartbeat).toBeDefined();
    });
  });
});
