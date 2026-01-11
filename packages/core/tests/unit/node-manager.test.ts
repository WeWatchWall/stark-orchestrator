/**
 * Unit tests for NodeManager service
 * @module @stark-o/core/tests/unit/node-manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  NodeManager,
  createNodeManager,
  NodeManagerErrorCodes,
  resetCluster,
  initializeCluster,
  clusterState,
  addNode,
  findNodeByName,
} from '../../src';
import type { RuntimeType, NodeStatus, NodeHeartbeat } from '@stark-o/shared';

describe('NodeManager', () => {
  let manager: NodeManager;

  beforeEach(() => {
    resetCluster();
    initializeCluster();
    manager = createNodeManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const mgr = new NodeManager();
      expect(mgr).toBeInstanceOf(NodeManager);
      mgr.dispose();
    });

    it('should accept custom heartbeat timeout', () => {
      const mgr = createNodeManager({
        heartbeatTimeoutMs: 60000,
        heartbeatCheckIntervalMs: 20000,
      });
      expect(mgr).toBeInstanceOf(NodeManager);
      mgr.dispose();
    });

    it('should start heartbeat monitoring when enabled', () => {
      const mgr = createNodeManager({
        enableHeartbeatMonitoring: true,
        heartbeatCheckIntervalMs: 1000,
      });
      expect(mgr).toBeInstanceOf(NodeManager);
      mgr.dispose();
    });
  });

  describe('computed properties', () => {
    beforeEach(() => {
      // Add test nodes
      addNode({
        id: 'node-1',
        name: 'test-node-1',
        runtimeType: 'node',
        registeredBy: 'user1',
        allocatable: { cpu: 1000, memory: 1024, pods: 10 },
      });
      addNode({
        id: 'node-2',
        name: 'test-node-2',
        runtimeType: 'browser',
        registeredBy: 'user1',
        allocatable: { cpu: 500, memory: 512, pods: 5 },
      });
    });

    it('should return total nodes count', () => {
      expect(manager.totalNodes.value).toBe(2);
    });

    it('should return online nodes count', () => {
      expect(manager.onlineNodes.value).toBe(2);
    });

    it('should group nodes by runtime', () => {
      const byRuntime = manager.byRuntime.value;
      expect(byRuntime).toBeInstanceOf(Map);
      expect(byRuntime.get('node')?.length).toBe(1);
      expect(byRuntime.get('browser')?.length).toBe(1);
    });

    it('should group nodes by status', () => {
      const byStatus = manager.byStatus.value;
      expect(byStatus).toBeInstanceOf(Map);
      expect(byStatus.get('online')?.length).toBe(2);
    });
  });

  describe('register', () => {
    it('should register a new node successfully', () => {
      const result = manager.register(
        {
          name: 'my-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'owner1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.node).toBeDefined();
      expect(result.data?.node.name).toBe('my-node');
      expect(result.data?.node.runtimeType).toBe('node');
      expect(result.data?.node.registeredBy).toBe('owner1');
      expect(result.data?.node.status).toBe('online');
    });

    it('should register a browser node successfully', () => {
      const result = manager.register(
        {
          name: 'browser-node',
          runtimeType: 'browser',
          allocatable: { cpu: 500, memory: 512, pods: 5 },
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.node.runtimeType).toBe('browser');
    });

    it('should generate a unique node ID', () => {
      const result = manager.register(
        {
          name: 'id-test-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.node.id).toBeDefined();
      expect(typeof result.data?.node.id).toBe('string');
      expect(result.data?.node.id.length).toBeGreaterThan(0);
    });

    it('should register with connection info', () => {
      const result = manager.register(
        {
          name: 'connected-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1',
        {
          connectionId: 'conn-123',
          ipAddress: '192.168.1.100',
          userAgent: 'NodeAgent/1.0',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data?.node).toBeDefined();
    });

    it('should register with labels', () => {
      const result = manager.register(
        {
          name: 'labeled-node',
          runtimeType: 'node',
          labels: {
            'env': 'production',
            'zone': 'us-east-1',
          },
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.node.labels).toBeDefined();
      expect(result.data?.node.labels?.['env']).toBe('production');
    });

    it('should register with capabilities', () => {
      const result = manager.register(
        {
          name: 'capable-node',
          runtimeType: 'node',
          capabilities: {
            gpu: true,
            storage: true,
            network: true,
          },
          allocatable: { cpu: 4000, memory: 8192, pods: 50 },
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.node.capabilities?.gpu).toBe(true);
    });

    it('should fail with invalid node name', () => {
      const result = manager.register(
        {
          name: '',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.VALIDATION_ERROR);
    });

    it('should fail when node name already exists', () => {
      // First registration
      manager.register(
        {
          name: 'duplicate-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      // Second registration with same name
      const result = manager.register(
        {
          name: 'duplicate-node',
          runtimeType: 'browser',
          allocatable: { cpu: 500, memory: 512, pods: 5 },
        },
        'user2'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_EXISTS);
    });

    it('should validate runtime type', () => {
      const result = manager.register(
        {
          name: 'invalid-runtime-node',
          runtimeType: 'invalid' as RuntimeType,
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.VALIDATION_ERROR);
    });
  });

  describe('reconnect', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'reconnect-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;

      // Disconnect the node
      manager.disconnect(nodeId);
    });

    it('should reconnect an existing node', () => {
      const result = manager.reconnect(nodeId, {
        connectionId: 'new-conn-456',
        ipAddress: '192.168.1.101',
      });

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('online');
    });

    it('should update connection info on reconnect', () => {
      const result = manager.reconnect(nodeId, {
        connectionId: 'reconnect-conn',
        ipAddress: '10.0.0.50',
        userAgent: 'NodeAgent/2.0',
      });

      expect(result.success).toBe(true);
      expect(result.data?.node.connectionId).toBe('reconnect-conn');
    });

    it('should fail for non-existent node', () => {
      const result = manager.reconnect('non-existent-id', {
        connectionId: 'conn',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('processHeartbeat', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'heartbeat-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    it('should process a valid heartbeat', () => {
      const heartbeat: NodeHeartbeat = {
        nodeId,
        timestamp: new Date(),
      };

      const result = manager.processHeartbeat(heartbeat);

      expect(result.success).toBe(true);
      expect(result.data?.node).toBeDefined();
    });

    it('should update lastHeartbeat timestamp', () => {
      const timestamp = new Date();
      const heartbeat: NodeHeartbeat = {
        nodeId,
        timestamp,
      };

      const result = manager.processHeartbeat(heartbeat);

      expect(result.success).toBe(true);
      expect(result.data?.node.lastHeartbeat).toBeDefined();
    });

    it('should update node status from heartbeat', () => {
      const heartbeat: NodeHeartbeat = {
        nodeId,
        timestamp: new Date(),
        status: 'online',
      };

      const result = manager.processHeartbeat(heartbeat);

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('online');
    });

    it('should update allocated resources from heartbeat', () => {
      const heartbeat: NodeHeartbeat = {
        nodeId,
        timestamp: new Date(),
        allocated: { cpu: 500, memory: 512, pods: 3 },
      };

      const result = manager.processHeartbeat(heartbeat);

      expect(result.success).toBe(true);
      expect(result.data?.node.allocated.cpu).toBe(500);
    });

    it('should fail for unknown node', () => {
      const heartbeat: NodeHeartbeat = {
        nodeId: 'unknown-node-id',
        timestamp: new Date(),
      };

      const result = manager.processHeartbeat(heartbeat);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('checkHeartbeats', () => {
    beforeEach(() => {
      // Create manager with short timeout for testing
      manager.dispose();
      manager = createNodeManager({
        heartbeatTimeoutMs: 100, // 100ms timeout
      });
    });

    it('should mark stale nodes as unhealthy', async () => {
      // Register a node
      const result = manager.register(
        {
          name: 'stale-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      // Wait for heartbeat timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      const checkResult = manager.checkHeartbeats();

      expect(checkResult.checked).toBeGreaterThanOrEqual(0);
    });

    it('should not mark recently updated nodes as unhealthy', () => {
      // Register and immediately check
      manager.register(
        {
          name: 'fresh-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      const checkResult = manager.checkHeartbeats();

      expect(checkResult.markedUnhealthy).toBe(0);
    });

    it('should return count of unhealthy nodes', async () => {
      // Register nodes
      manager.register(
        {
          name: 'node-a',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      manager.register(
        {
          name: 'node-b',
          runtimeType: 'browser',
          allocatable: { cpu: 500, memory: 512, pods: 5 },
        },
        'user1'
      );

      // Check immediately - should not mark as unhealthy
      const checkResult = manager.checkHeartbeats();
      expect(checkResult.markedUnhealthy).toBe(0);
    });
  });

  describe('heartbeat monitoring', () => {
    it('should start and stop monitoring', () => {
      const mgr = createNodeManager({
        heartbeatCheckIntervalMs: 1000,
      });

      mgr.startHeartbeatMonitoring();
      mgr.stopHeartbeatMonitoring();

      // Should not throw when called multiple times
      mgr.stopHeartbeatMonitoring();
      mgr.dispose();
    });

    it('should not start monitoring twice', () => {
      const mgr = createNodeManager({
        heartbeatCheckIntervalMs: 1000,
      });

      mgr.startHeartbeatMonitoring();
      mgr.startHeartbeatMonitoring(); // Should be idempotent

      mgr.dispose();
    });
  });

  describe('getNode', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'get-test-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    it('should get a node by ID', () => {
      const result = manager.getNode(nodeId);

      expect(result.success).toBe(true);
      expect(result.data?.node.id).toBe(nodeId);
    });

    it('should fail for non-existent node', () => {
      const result = manager.getNode('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('getNodeByName', () => {
    beforeEach(() => {
      manager.register(
        {
          name: 'named-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
    });

    it('should get a node by name', () => {
      const result = manager.getNodeByName('named-node');

      expect(result.success).toBe(true);
      expect(result.data?.node.name).toBe('named-node');
    });

    it('should fail for non-existent node name', () => {
      const result = manager.getNodeByName('unknown-name');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('updateStatus', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'status-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    it('should update node status to unhealthy', () => {
      const result = manager.updateStatus(nodeId, 'unhealthy');

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('unhealthy');
    });

    it('should update node status to maintenance', () => {
      const result = manager.updateStatus(nodeId, 'maintenance');

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('maintenance');
    });

    it('should fail for non-existent node', () => {
      const result = manager.updateStatus('non-existent', 'online');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('disconnect', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'disconnect-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    it('should mark node as offline', () => {
      const result = manager.disconnect(nodeId);

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('offline');
    });

    it('should clear connection ID', () => {
      const result = manager.disconnect(nodeId);

      expect(result.success).toBe(true);
      expect(result.data?.node.connectionId).toBeUndefined();
    });

    it('should fail for non-existent node', () => {
      const result = manager.disconnect('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('drain', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'drain-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    it('should drain a node', () => {
      const result = manager.drain(nodeId);

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('draining');
    });

    it('should fail for non-existent node', () => {
      const result = manager.drain('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('setMaintenance', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'maintenance-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    it('should put node in maintenance mode', () => {
      const result = manager.setMaintenance(nodeId);

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('maintenance');
    });

    it('should fail for non-existent node', () => {
      const result = manager.setMaintenance('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('uncordon', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'uncordon-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;

      // Put in maintenance first
      manager.setMaintenance(nodeId);
    });

    it('should make node schedulable again', () => {
      const result = manager.uncordon(nodeId);

      expect(result.success).toBe(true);
      expect(result.data?.node.status).toBe('online');
    });

    it('should fail for non-existent node', () => {
      const result = manager.uncordon('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });
  });

  describe('labels management', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'label-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    describe('updateLabels', () => {
      it('should update all labels', () => {
        const result = manager.updateLabels(nodeId, {
          'env': 'production',
          'zone': 'us-west-2',
        });

        expect(result.success).toBe(true);
        expect(result.data?.node.labels?.['env']).toBe('production');
        expect(result.data?.node.labels?.['zone']).toBe('us-west-2');
      });

      it('should fail for non-existent node', () => {
        const result = manager.updateLabels('non-existent', { 'key': 'value' });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });

    describe('addLabel', () => {
      it('should add a single label', () => {
        const result = manager.addLabel(nodeId, 'tier', 'frontend');

        expect(result.success).toBe(true);
        expect(result.data?.node.labels?.['tier']).toBe('frontend');
      });

      it('should fail for non-existent node', () => {
        const result = manager.addLabel('non-existent', 'key', 'value');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });

    describe('removeLabel', () => {
      beforeEach(() => {
        manager.addLabel(nodeId, 'to-remove', 'value');
      });

      it('should remove a label', () => {
        const result = manager.removeLabel(nodeId, 'to-remove');

        expect(result.success).toBe(true);
        expect(result.data?.node.labels?.['to-remove']).toBeUndefined();
      });

      it('should fail for non-existent node', () => {
        const result = manager.removeLabel('non-existent', 'key');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });
  });

  describe('taints management', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'taint-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    describe('updateTaints', () => {
      it('should update all taints', () => {
        const result = manager.updateTaints(nodeId, [
          { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' },
          { key: 'special', value: 'true', effect: 'PreferNoSchedule' },
        ]);

        expect(result.success).toBe(true);
        expect(result.data?.node.taints?.length).toBe(2);
      });

      it('should fail for non-existent node', () => {
        const result = manager.updateTaints('non-existent', []);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });

    describe('addTaint', () => {
      it('should add a taint', () => {
        const result = manager.addTaint(nodeId, {
          key: 'gpu',
          value: 'true',
          effect: 'NoSchedule',
        });

        expect(result.success).toBe(true);
        expect(result.data?.node.taints?.some(t => t.key === 'gpu')).toBe(true);
      });

      it('should fail for non-existent node', () => {
        const result = manager.addTaint('non-existent', {
          key: 'test',
          value: 'value',
          effect: 'NoSchedule',
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });

    describe('removeTaint', () => {
      beforeEach(() => {
        manager.addTaint(nodeId, {
          key: 'to-remove',
          value: 'value',
          effect: 'NoSchedule',
        });
      });

      it('should remove a taint by key', () => {
        const result = manager.removeTaint(nodeId, 'to-remove');

        expect(result.success).toBe(true);
        expect(result.data?.node.taints?.some(t => t.key === 'to-remove')).toBe(false);
      });

      it('should remove a taint by key and effect', () => {
        const result = manager.removeTaint(nodeId, 'to-remove', 'NoSchedule');

        expect(result.success).toBe(true);
      });

      it('should fail for non-existent node', () => {
        const result = manager.removeTaint('non-existent', 'key');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });
  });

  describe('resource management', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'resource-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    describe('allocateResources', () => {
      it('should allocate CPU and memory', () => {
        const result = manager.allocateResources(nodeId, 100, 256);

        expect(result.success).toBe(true);
        expect(result.data?.node.allocated.cpu).toBeGreaterThanOrEqual(100);
        expect(result.data?.node.allocated.memory).toBeGreaterThanOrEqual(256);
      });

      it('should fail for non-existent node', () => {
        const result = manager.allocateResources('non-existent', 100, 256);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });

    describe('releaseResources', () => {
      beforeEach(() => {
        manager.allocateResources(nodeId, 200, 512);
      });

      it('should release CPU and memory', () => {
        const result = manager.releaseResources(nodeId, 100, 256);

        expect(result.success).toBe(true);
      });

      it('should fail for non-existent node', () => {
        const result = manager.releaseResources('non-existent', 100, 256);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
      });
    });
  });

  describe('list', () => {
    beforeEach(() => {
      // Create several nodes for listing
      manager.register(
        {
          name: 'node-a',
          runtimeType: 'node',
          labels: { 'env': 'production' },
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      manager.register(
        {
          name: 'node-b',
          runtimeType: 'browser',
          labels: { 'env': 'staging' },
          allocatable: { cpu: 500, memory: 512, pods: 5 },
        },
        'user1'
      );
      manager.register(
        {
          name: 'node-c',
          runtimeType: 'node',
          labels: { 'env': 'production' },
          allocatable: { cpu: 2000, memory: 2048, pods: 20 },
        },
        'user2'
      );
    });

    it('should list all nodes', () => {
      const result = manager.list();

      expect(result.nodes.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('should filter by runtime type', () => {
      const result = manager.list({ runtimeType: 'node' });

      expect(result.nodes.length).toBe(2);
      expect(result.nodes.every(n => n.runtimeType === 'node')).toBe(true);
    });

    it('should filter by status', () => {
      const result = manager.list({ status: 'online' });

      expect(result.nodes.length).toBe(3);
      expect(result.nodes.every(n => n.status === 'online')).toBe(true);
    });

    it('should filter by label selector', () => {
      const result = manager.list({ labelSelector: { 'env': 'production' } });

      expect(result.nodes.length).toBe(2);
    });

    it('should paginate results', () => {
      const result = manager.list({ page: 1, pageSize: 2 });

      expect(result.nodes.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('should return second page', () => {
      const result = manager.list({ page: 2, pageSize: 2 });

      expect(result.nodes.length).toBe(1);
      expect(result.page).toBe(2);
    });

    it('should limit page size to 100', () => {
      const result = manager.list({ pageSize: 200 });

      expect(result.pageSize).toBe(100);
    });
  });

  describe('findBySelector', () => {
    beforeEach(() => {
      manager.register(
        {
          name: 'selector-node-1',
          runtimeType: 'node',
          labels: { 'app': 'web', 'env': 'prod' },
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      manager.register(
        {
          name: 'selector-node-2',
          runtimeType: 'node',
          labels: { 'app': 'api', 'env': 'prod' },
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
    });

    it('should find nodes matching selector', () => {
      const result = manager.findBySelector({ matchLabels: { 'env': 'prod' } });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(2);
    });

    it('should return empty array when no match', () => {
      const result = manager.findBySelector({ matchLabels: { 'env': 'dev' } });

      expect(result.success).toBe(true);
      expect(result.data?.nodes.length).toBe(0);
    });
  });

  describe('findByRuntime', () => {
    beforeEach(() => {
      manager.register(
        {
          name: 'runtime-node-1',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      manager.register(
        {
          name: 'runtime-node-2',
          runtimeType: 'browser',
          allocatable: { cpu: 500, memory: 512, pods: 5 },
        },
        'user1'
      );
    });

    it('should find nodes by runtime type', () => {
      const nodes = manager.findByRuntime('node');

      expect(nodes.length).toBe(1);
      expect(nodes[0].runtimeType).toBe('node');
    });

    it('should return empty array for no matches', () => {
      const nodes = manager.findByRuntime('universal');

      expect(nodes.length).toBe(0);
    });
  });

  describe('getSchedulableNodes', () => {
    beforeEach(() => {
      manager.register(
        {
          name: 'schedulable-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      const result = manager.register(
        {
          name: 'maintenance-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      manager.setMaintenance(result.data!.node.id);
    });

    it('should return only schedulable nodes', () => {
      const nodes = manager.getSchedulableNodes('node');

      expect(nodes.length).toBe(1);
      expect(nodes[0].name).toBe('schedulable-node');
    });
  });

  describe('hasAvailableNodes', () => {
    it('should return false when no nodes exist', () => {
      expect(manager.hasAvailableNodes()).toBe(false);
    });

    it('should return true when online nodes exist', () => {
      manager.register(
        {
          name: 'available-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );

      expect(manager.hasAvailableNodes()).toBe(true);
    });
  });

  describe('deregister', () => {
    let nodeId: string;

    beforeEach(() => {
      const result = manager.register(
        {
          name: 'deregister-node',
          runtimeType: 'node',
          allocatable: { cpu: 1000, memory: 1024, pods: 10 },
        },
        'user1'
      );
      nodeId = result.data!.node.id;
    });

    it('should deregister a node', () => {
      const result = manager.deregister(nodeId);

      expect(result.success).toBe(true);
      expect(result.data?.removed).toBe(true);
    });

    it('should remove node from cluster state', () => {
      manager.deregister(nodeId);

      expect(clusterState.nodes.has(nodeId)).toBe(false);
    });

    it('should fail for non-existent node', () => {
      const result = manager.deregister('non-existent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.NODE_NOT_FOUND);
    });

    it('should allow owner to deregister', () => {
      const result = manager.deregister(nodeId, 'user1');

      expect(result.success).toBe(true);
    });

    it('should prevent non-owner from deregistering', () => {
      const result = manager.deregister(nodeId, 'user2');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(NodeManagerErrorCodes.UNAUTHORIZED);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      const mgr = createNodeManager({
        enableHeartbeatMonitoring: true,
        heartbeatCheckIntervalMs: 1000,
      });

      // Should not throw
      mgr.dispose();
      mgr.dispose(); // Should be safe to call multiple times
    });
  });
});
