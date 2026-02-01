/**
 * Node manager service
 * Handles node registration, heartbeat processing, and health status
 * @module @stark-o/core/services/node-manager
 */

import type { ComputedRef } from '@vue/reactivity';
import type {
  Node,
  NodeStatus,
  RuntimeType,
  RegisterNodeInput,
  UpdateNodeInput,
  NodeHeartbeat,
  Labels,
  Taint,
  LabelSelector,
} from '@stark-o/shared';
import {
  validateRegisterNodeInput,
  generateUUID,
  createServiceLogger,
  matchesSelector,
} from '@stark-o/shared';
import { clusterState } from '../stores/cluster-store';
import {
  addNode,
  updateNode,
  removeNode,
  setNodeStatus,
  processHeartbeat as storeProcessHeartbeat,
  markNodeUnhealthy,
  markNodeOffline,
  drainNode as storeDrainNode,
  setNodeMaintenance,
  uncordonNode as storeUncordonNode,
  setNodeLabels,
  addNodeLabel,
  removeNodeLabel,
  setNodeTaints,
  addNodeTaint,
  removeNodeTaint,
  allocateResources as storeAllocateResources,
  releaseResources as storeReleaseResources,
  findNodeByName,
  findNodesBySelector,
  findNodesByRuntime,
  getSchedulableNodesForRuntime,
  hasAvailableNodes,
  getStaleNodes,
  nodeCount,
  onlineNodeCount,
  nodesByRuntime,
  nodesByStatus,
} from '../stores/node-store';
import {
  NodeModel,
  HEARTBEAT_TIMEOUT_MS,
  type NodeRegistrationResult,
  type NodeListResponse,
  type NodeListFilters,
} from '../models/node';

/**
 * Logger for node manager operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'node-manager' });

// ============================================================================
// Types
// ============================================================================

/**
 * Callback when a node becomes unhealthy
 */
export type OnNodeUnhealthyCallback = (nodeId: string, nodeName: string) => void | Promise<void>;

/**
 * Node manager options
 */
export interface NodeManagerOptions {
  /** Heartbeat timeout in milliseconds (default: 30000) */
  heartbeatTimeoutMs?: number;
  /** Heartbeat check interval in milliseconds (default: 10000) */
  heartbeatCheckIntervalMs?: number;
  /** Enable automatic heartbeat monitoring */
  enableHeartbeatMonitoring?: boolean;
  /** Callback when a node becomes unhealthy (e.g., to fail pods) */
  onNodeUnhealthy?: OnNodeUnhealthyCallback;
}

/**
 * Node operation result
 */
export interface NodeOperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Node connection info for WebSocket registration
 */
export interface NodeConnectionInfo {
  connectionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Heartbeat check result
 */
export interface HeartbeatCheckResult {
  /** Number of nodes checked */
  checked: number;
  /** Number of nodes marked unhealthy */
  markedUnhealthy: number;
  /** IDs of nodes marked unhealthy */
  unhealthyNodeIds: string[];
}

/**
 * Node manager error codes
 */
export const NodeManagerErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NODE_EXISTS: 'NODE_EXISTS',
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  HEARTBEAT_TIMEOUT: 'HEARTBEAT_TIMEOUT',
  CONNECTION_REQUIRED: 'CONNECTION_REQUIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;

// ============================================================================
// Node Manager Service
// ============================================================================

/**
 * Node Manager Service
 * Manages node lifecycle: registration, heartbeat processing, health status, and deregistration
 */
export class NodeManager {
  private readonly heartbeatTimeoutMs: number;
  private readonly heartbeatCheckIntervalMs: number;
  private readonly enableHeartbeatMonitoring: boolean;
  private readonly onNodeUnhealthy?: OnNodeUnhealthyCallback;
  private heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: NodeManagerOptions = {}) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
    this.heartbeatCheckIntervalMs = options.heartbeatCheckIntervalMs ?? 10_000;
    this.enableHeartbeatMonitoring = options.enableHeartbeatMonitoring ?? false;
    this.onNodeUnhealthy = options.onNodeUnhealthy;

    if (this.enableHeartbeatMonitoring) {
      this.startHeartbeatMonitoring();
    }
  }

  // ===========================================================================
  // Computed Properties (reactive)
  // ===========================================================================

  /**
   * Total number of nodes
   */
  get totalNodes(): ComputedRef<number> {
    return nodeCount;
  }

  /**
   * Number of online nodes
   */
  get onlineNodes(): ComputedRef<number> {
    return onlineNodeCount;
  }

  /**
   * Nodes grouped by runtime type
   */
  get byRuntime(): ComputedRef<Map<RuntimeType, Node[]>> {
    return nodesByRuntime;
  }

  /**
   * Nodes grouped by status
   */
  get byStatus(): ComputedRef<Map<NodeStatus, Node[]>> {
    return nodesByStatus;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  /**
   * Register a new node
   * @param input - Node registration input
   * @param registeredBy - User ID who is registering the node
   * @param connectionInfo - Optional WebSocket connection info
   * @returns Registration result with node data
   */
  register(
    input: RegisterNodeInput,
    registeredBy: string,
    connectionInfo: NodeConnectionInfo = {},
  ): NodeOperationResult<NodeRegistrationResult> {
    logger.debug('Attempting node registration', {
      nodeName: input.name,
      runtimeType: input.runtimeType,
      registeredBy,
      hasConnectionId: !!connectionInfo.connectionId,
    });

    // Validate input
    const validation = validateRegisterNodeInput(input);
    if (!validation.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validation.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      logger.warn('Node registration validation failed', {
        nodeName: input.name,
        registeredBy,
        errorCount: validation.errors.length,
      });
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.VALIDATION_ERROR,
          message: 'Validation failed',
          details,
        },
      };
    }

    // Check if node with same name already exists
    const existingNode = findNodeByName(input.name);
    if (existingNode) {
      logger.warn('Node already exists', {
        nodeName: input.name,
        existingNodeId: existingNode.id,
        registeredBy,
      });
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_EXISTS,
          message: `Node ${input.name} already exists`,
          details: { name: input.name, existingNodeId: existingNode.id },
        },
      };
    }

    // Generate node ID
    const nodeId = generateUUID();

    // Register in store
    const node = addNode({
      ...input,
      id: nodeId,
      registeredBy,
    });

    // Set connection info if provided
    if (connectionInfo.connectionId) {
      updateNode(node.id, {});
      // Update connection-related fields directly
      const n = clusterState.nodes.get(node.id);
      if (n) {
        n.connectionId = connectionInfo.connectionId;
        n.ipAddress = connectionInfo.ipAddress;
        n.userAgent = connectionInfo.userAgent;
      }
    }

    logger.info('Node registered successfully', {
      nodeId,
      nodeName: node.name,
      runtimeType: node.runtimeType,
      registeredBy,
      connectionId: connectionInfo.connectionId,
    });

    return {
      success: true,
      data: { node },
    };
  }

  /**
   * Re-register an existing node (reconnection scenario)
   * Updates connection info and sets status to online
   */
  reconnect(
    nodeId: string,
    connectionInfo: NodeConnectionInfo,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    logger.debug('Node reconnecting', {
      nodeId,
      nodeName: node.name,
      previousStatus: node.status,
      connectionId: connectionInfo.connectionId,
    });

    // Update connection info and set online
    const updated = updateNode(nodeId, {
      status: 'online',
    });

    if (updated && connectionInfo.connectionId) {
      updated.connectionId = connectionInfo.connectionId;
      updated.ipAddress = connectionInfo.ipAddress;
      updated.userAgent = connectionInfo.userAgent;
      updated.lastHeartbeat = new Date();
    }

    logger.info('Node reconnected successfully', {
      nodeId,
      nodeName: node.name,
      connectionId: connectionInfo.connectionId,
    });

    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  // ===========================================================================
  // Heartbeat Processing
  // ===========================================================================

  /**
   * Process a heartbeat from a node
   * @param heartbeat - Heartbeat payload
   * @returns Updated node or error
   */
  processHeartbeat(heartbeat: NodeHeartbeat): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(heartbeat.nodeId);
    if (!node) {
      logger.warn('Heartbeat received for unknown node', {
        nodeId: heartbeat.nodeId,
      });
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${heartbeat.nodeId} not found`,
        },
      };
    }

    logger.debug('Processing heartbeat', {
      nodeId: heartbeat.nodeId,
      nodeName: node.name,
      previousStatus: node.status,
      timestamp: heartbeat.timestamp,
    });

    // Update heartbeat timestamp and optionally status/resources
    const updated = storeProcessHeartbeat(heartbeat.nodeId);
    if (!updated) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${heartbeat.nodeId} not found`,
        },
      };
    }

    // Apply additional heartbeat data if provided
    if (heartbeat.status !== undefined || heartbeat.allocated !== undefined) {
      const additionalUpdates: Partial<Node> = {};
      if (heartbeat.status !== undefined) {
        additionalUpdates.status = heartbeat.status;
      }
      if (heartbeat.allocated !== undefined) {
        updated.allocated = {
          ...updated.allocated,
          ...heartbeat.allocated,
        };
      }
      if (Object.keys(additionalUpdates).length > 0) {
        updateNode(heartbeat.nodeId, additionalUpdates as UpdateNodeInput);
      }
    }

    return {
      success: true,
      data: { node: updated },
    };
  }

  /**
   * Check all nodes for heartbeat timeout and mark stale nodes as unhealthy
   * @returns Result with count of nodes marked unhealthy
   */
  checkHeartbeats(): HeartbeatCheckResult {
    const staleNodes = getStaleNodes(this.heartbeatTimeoutMs);
    const unhealthyNodeIds: string[] = [];

    for (const node of staleNodes) {
      // Don't mark already offline or unhealthy nodes
      if (node.status === 'offline' || node.status === 'unhealthy') {
        continue;
      }

      logger.warn('Node heartbeat timeout', {
        nodeId: node.id,
        nodeName: node.name,
        lastHeartbeat: node.lastHeartbeat,
        timeoutMs: this.heartbeatTimeoutMs,
      });

      markNodeUnhealthy(node.id);
      unhealthyNodeIds.push(node.id);

      // Call the unhealthy callback if provided (e.g., to fail pods)
      if (this.onNodeUnhealthy) {
        try {
          const result = this.onNodeUnhealthy(node.id, node.name);
          // Handle async callbacks
          if (result instanceof Promise) {
            result.catch((error) => {
              logger.error('Error in onNodeUnhealthy callback', error instanceof Error ? error : undefined, {
                nodeId: node.id,
                nodeName: node.name,
              });
            });
          }
        } catch (error) {
          logger.error('Error in onNodeUnhealthy callback', error instanceof Error ? error : undefined, {
            nodeId: node.id,
            nodeName: node.name,
          });
        }
      }
    }

    if (unhealthyNodeIds.length > 0) {
      logger.info('Heartbeat check completed', {
        checked: staleNodes.length,
        markedUnhealthy: unhealthyNodeIds.length,
        unhealthyNodeIds,
      });
    }

    return {
      checked: staleNodes.length,
      markedUnhealthy: unhealthyNodeIds.length,
      unhealthyNodeIds,
    };
  }

  /**
   * Start automatic heartbeat monitoring
   */
  startHeartbeatMonitoring(): void {
    if (this.heartbeatCheckTimer) {
      return; // Already running
    }

    logger.info('Starting heartbeat monitoring', {
      intervalMs: this.heartbeatCheckIntervalMs,
      timeoutMs: this.heartbeatTimeoutMs,
    });

    this.heartbeatCheckTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.heartbeatCheckIntervalMs);
  }

  /**
   * Stop automatic heartbeat monitoring
   */
  stopHeartbeatMonitoring(): void {
    if (this.heartbeatCheckTimer) {
      clearInterval(this.heartbeatCheckTimer);
      this.heartbeatCheckTimer = null;
      logger.info('Stopped heartbeat monitoring');
    }
  }

  // ===========================================================================
  // Status Management
  // ===========================================================================

  /**
   * Get a node by ID
   */
  getNode(nodeId: string): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }
    return { success: true, data: { node } };
  }

  /**
   * Get a node by name
   */
  getNodeByName(name: string): NodeOperationResult<{ node: Node }> {
    const node = findNodeByName(name);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${name} not found`,
        },
      };
    }
    return { success: true, data: { node } };
  }

  /**
   * Update node status
   */
  updateStatus(
    nodeId: string,
    status: NodeStatus,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    logger.debug('Updating node status', {
      nodeId,
      nodeName: node.name,
      previousStatus: node.status,
      newStatus: status,
    });

    const updated = setNodeStatus(nodeId, status);
    if (!updated) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    logger.info('Node status updated', {
      nodeId,
      nodeName: node.name,
      status,
    });

    return { success: true, data: { node: updated } };
  }

  /**
   * Mark node as offline (disconnected)
   */
  disconnect(nodeId: string): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    logger.info('Node disconnecting', {
      nodeId,
      nodeName: node.name,
      previousStatus: node.status,
    });

    const updated = markNodeOffline(nodeId);
    if (updated) {
      updated.connectionId = undefined;
    }

    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Drain a node (prevent new pods, prepare for maintenance)
   */
  drain(nodeId: string): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    logger.info('Draining node', {
      nodeId,
      nodeName: node.name,
      previousStatus: node.status,
    });

    const updated = storeDrainNode(nodeId);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Put node in maintenance mode
   */
  setMaintenance(nodeId: string): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    logger.info('Setting node to maintenance', {
      nodeId,
      nodeName: node.name,
      previousStatus: node.status,
    });

    const updated = setNodeMaintenance(nodeId);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Make node schedulable again (uncordon)
   */
  uncordon(nodeId: string): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    logger.info('Uncordoning node', {
      nodeId,
      nodeName: node.name,
      previousStatus: node.status,
    });

    const updated = storeUncordonNode(nodeId);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  // ===========================================================================
  // Labels and Taints
  // ===========================================================================

  /**
   * Update node labels
   */
  updateLabels(
    nodeId: string,
    labels: Labels,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = setNodeLabels(nodeId, labels);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Set all labels on a node (replaces existing labels)
   */
  setLabels(
    nodeId: string,
    labels: Labels,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = setNodeLabels(nodeId, labels);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Add a label to a node
   */
  addLabel(
    nodeId: string,
    key: string,
    value: string,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = addNodeLabel(nodeId, key, value);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Remove a label from a node
   */
  removeLabel(
    nodeId: string,
    key: string,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = removeNodeLabel(nodeId, key);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Update node taints
   */
  updateTaints(
    nodeId: string,
    taints: Taint[],
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = setNodeTaints(nodeId, taints);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Add a taint to a node
   */
  addTaint(
    nodeId: string,
    taint: Taint,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = addNodeTaint(nodeId, taint);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Remove a taint from a node
   */
  removeTaint(
    nodeId: string,
    key: string,
    effect?: string,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = removeNodeTaint(nodeId, key, effect);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  // ===========================================================================
  // Resource Management
  // ===========================================================================

  /**
   * Allocate resources on a node
   */
  allocateResources(
    nodeId: string,
    cpu: number,
    memory: number,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = storeAllocateResources(nodeId, cpu, memory);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  /**
   * Release resources on a node
   */
  releaseResources(
    nodeId: string,
    cpu: number,
    memory: number,
  ): NodeOperationResult<{ node: Node }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    const updated = storeReleaseResources(nodeId, cpu, memory);
    return {
      success: true,
      data: { node: updated ?? node },
    };
  }

  // ===========================================================================
  // Listing and Search
  // ===========================================================================

  /**
   * List nodes with optional filters
   */
  list(filters: NodeListFilters = {}): NodeListResponse {
    let nodes = [...clusterState.nodes.values()];

    // Apply filters
    if (filters.runtimeType) {
      nodes = nodes.filter(n => n.runtimeType === filters.runtimeType);
    }

    if (filters.status) {
      nodes = nodes.filter(n => n.status === filters.status);
    }

    if (filters.labelSelector) {
      nodes = nodes.filter(n =>
        matchesSelector(n.labels, {
          matchLabels: filters.labelSelector!,
          matchExpressions: [],
        })
      );
    }

    // Sort by status priority, then name
    nodes = NodeModel.sortByStatusAndName(nodes);

    // Get total before pagination
    const total = nodes.length;

    // Apply pagination
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 20, 100);
    const offset = (page - 1) * pageSize;
    nodes = nodes.slice(offset, offset + pageSize);

    return {
      nodes,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Find nodes by label selector
   */
  findBySelector(selector: LabelSelector): NodeOperationResult<{ nodes: Node[] }> {
    const nodes = findNodesBySelector(selector);
    return {
      success: true,
      data: { nodes },
    };
  }

  /**
   * Find nodes by runtime type
   */
  findByRuntime(runtimeType: RuntimeType): Node[] {
    return findNodesByRuntime(runtimeType);
  }

  /**
   * Get schedulable nodes for a runtime type
   */
  getSchedulableNodes(runtimeType: RuntimeType): Node[] {
    return getSchedulableNodesForRuntime(runtimeType);
  }

  /**
   * Check if any nodes are available
   */
  hasAvailableNodes(): boolean {
    return hasAvailableNodes();
  }

  // ===========================================================================
  // Deregistration
  // ===========================================================================

  /**
   * Deregister (remove) a node
   */
  deregister(
    nodeId: string,
    requesterId?: string,
  ): NodeOperationResult<{ removed: boolean }> {
    const node = clusterState.nodes.get(nodeId);
    if (!node) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.NODE_NOT_FOUND,
          message: `Node ${nodeId} not found`,
        },
      };
    }

    // Authorization check - only the registering user can deregister
    if (requesterId && node.registeredBy && node.registeredBy !== requesterId) {
      return {
        success: false,
        error: {
          code: NodeManagerErrorCodes.UNAUTHORIZED,
          message: 'Only the node owner can deregister',
        },
      };
    }

    logger.info('Deregistering node', {
      nodeId,
      nodeName: node.name,
      registeredBy: node.registeredBy,
      requesterId,
    });

    const removed = removeNode(nodeId);

    return {
      success: true,
      data: { removed },
    };
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Stop all background processes and clean up
   */
  dispose(): void {
    this.stopHeartbeatMonitoring();
    logger.info('NodeManager disposed');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default node manager instance
 */
export const nodeManager = new NodeManager();

/**
 * Create a new node manager instance with custom options
 */
export function createNodeManager(options?: NodeManagerOptions): NodeManager {
  return new NodeManager(options);
}
