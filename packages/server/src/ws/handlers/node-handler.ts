/**
 * WebSocket Node Handler
 * @module @stark-o/server/ws/handlers/node-handler
 *
 * Handles WebSocket messages for node registration, heartbeat, and disconnect.
 */

import type { RegisterNodeInput, NodeHeartbeat, UserRole } from '@stark-o/shared';
import { validateRegisterNodeInput, createServiceLogger } from '@stark-o/shared';
import { getNodeQueries } from '../../supabase/nodes.js';
import { getPodQueriesAdmin } from '../../supabase/pods.js';
import { getConnectionManager, sendToNode } from '../../services/connection-service.js';
import { getDeploymentController } from '../../services/deployment-controller.js';
import { getChaosProxy } from '../../services/chaos-proxy.js';

/**
 * Logger for node handler operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'ws-node-handler' });

/**
 * Simple validation error (from validation functions)
 */
interface SimpleValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Convert validation errors array to a details object
 */
function errorsToDetails(errors: SimpleValidationError[]): Record<string, SimpleValidationError> {
  const details: Record<string, SimpleValidationError> = {};
  for (const error of errors) {
    details[error.field] = error;
  }
  return details;
}

/**
 * WebSocket message types for nodes
 */
export type WsNodeMessageType =
  | 'node:register'
  | 'node:register:ack'
  | 'node:register:error'
  | 'node:reconnect'
  | 'node:reconnect:ack'
  | 'node:reconnect:error'
  | 'node:heartbeat'
  | 'node:heartbeat:ack'
  | 'node:heartbeat:error'
  | 'node:disconnect';

/**
 * WebSocket message structure
 * Type is loosely typed to allow connection manager to pass messages
 */
export interface WsMessage<T = unknown> {
  type: string;
  payload: T;
  correlationId?: string;
}

/**
 * WebSocket connection interface
 */
export interface WsConnection {
  id: string;
  send: (data: string) => void;
  close: () => void;
  terminate: () => void;
  userId?: string;
  userRoles?: UserRole[];
}

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Helper to send a WebSocket response
 */
function sendResponse<T>(
  ws: WsConnection,
  type: WsNodeMessageType,
  payload: T,
  correlationId?: string,
): void {
  ws.send(JSON.stringify({ type, payload, correlationId }));
}

/**
 * Handle node registration via WebSocket
 */
export async function handleNodeRegister(
  ws: WsConnection,
  message: WsMessage<RegisterNodeInput>,
): Promise<void> {
  const { payload, correlationId } = message;

  // Check authentication
  if (!ws.userId) {
    sendResponse(
      ws,
      'node:register:error',
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      correlationId,
    );
    return;
  }

  // Validate the input
  const validation = validateRegisterNodeInput(payload);
  if (!validation.valid) {
    sendResponse(
      ws,
      'node:register:error',
      {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errorsToDetails(validation.errors),
      },
      correlationId,
    );
    return;
  }

  const nodeQueries = getNodeQueries();

  // Check if node already exists
  const existsResult = await nodeQueries.nodeExists(payload.name);
  if (existsResult.error) {
    sendResponse(
      ws,
      'node:register:error',
      { code: 'INTERNAL_ERROR', message: 'Failed to check node existence' },
      correlationId,
    );
    return;
  }

  if (existsResult.data) {
    sendResponse(
      ws,
      'node:register:error',
      { code: 'CONFLICT', message: `Node ${payload.name} already exists` },
      correlationId,
    );
    return;
  }

  // Create the node
  // Nodes are trusted if registered by an admin (can run system packs)
  const isAdmin = ws.userRoles?.includes('admin') ?? false;
  const createResult = await nodeQueries.createNode({
    name: payload.name,
    runtimeType: payload.runtimeType,
    capabilities: payload.capabilities ?? {},
    allocatable: payload.allocatable,
    labels: payload.labels ?? {},
    annotations: payload.annotations ?? {},
    taints: payload.taints ?? [],
    registeredBy: ws.userId,
    connectionId: ws.id,
    trusted: isAdmin,
  });

  if (createResult.error || !createResult.data) {
    console.error('Node registration failed:', createResult.error);
    sendResponse(
      ws,
      'node:register:error',
      { code: 'INTERNAL_ERROR', message: 'Failed to register node' },
      correlationId,
    );
    return;
  }

  // Register the node ID to the connection for chaos testing and tracking
  const connManager = getConnectionManager();
  if (connManager) {
    connManager.registerNodeToConnection(ws.id, createResult.data.id);
  }

  sendResponse(
    ws,
    'node:register:ack',
    { node: createResult.data },
    correlationId,
  );
}

/**
 * Handle node heartbeat via WebSocket
 */
export async function handleNodeHeartbeat(
  ws: WsConnection,
  message: WsMessage<NodeHeartbeat>,
): Promise<void> {
  const { payload, correlationId } = message;

  // Check authentication
  if (!ws.userId) {
    sendResponse(
      ws,
      'node:heartbeat:error',
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      correlationId,
    );
    return;
  }

  // Validate nodeId is present
  if (!payload.nodeId) {
    sendResponse(
      ws,
      'node:heartbeat:error',
      { code: 'VALIDATION_ERROR', message: 'nodeId is required' },
      correlationId,
    );
    return;
  }

  // Validate nodeId format
  if (!UUID_REGEX.test(payload.nodeId)) {
    sendResponse(
      ws,
      'node:heartbeat:error',
      { code: 'VALIDATION_ERROR', message: 'Invalid node ID format' },
      correlationId,
    );
    return;
  }

  const nodeQueries = getNodeQueries();

  // Get the node
  const nodeResult = await nodeQueries.getNodeById(payload.nodeId);
  if (nodeResult.error || !nodeResult.data) {
    sendResponse(
      ws,
      'node:heartbeat:error',
      { code: 'NOT_FOUND', message: 'Node not found' },
      correlationId,
    );
    return;
  }

  // Verify connection owns the node
  if (nodeResult.data.connectionId !== ws.id) {
    sendResponse(
      ws,
      'node:heartbeat:error',
      { code: 'FORBIDDEN', message: 'Connection does not own this node' },
      correlationId,
    );
    return;
  }

  // Update heartbeat
  const updateResult = await nodeQueries.updateHeartbeat(
    payload.nodeId,
    payload.allocated,
    payload.status,
  );
  if (updateResult.error) {
    sendResponse(
      ws,
      'node:heartbeat:error',
      { code: 'INTERNAL_ERROR', message: 'Failed to update heartbeat' },
      correlationId,
    );
    return;
  }

  sendResponse(
    ws,
    'node:heartbeat:ack',
    { nodeId: payload.nodeId, lastHeartbeat: new Date().toISOString() },
    correlationId,
  );
}

/**
 * Reconnect payload
 */
export interface ReconnectNodePayload {
  nodeId: string;
  /** Optional capabilities update - allows updating Node.js version on reconnect */
  capabilities?: {
    version?: string;
    features?: string[];
    [key: string]: unknown;
  };
  /** 
   * Pod IDs currently running on the node.
   * Used to detect orphaned pods after node restart.
   * If a pod is in the DB but not in this list, it means the node lost it (e.g., after restart).
   */
  runningPodIds?: string[];
}

/**
 * Handle node reconnection via WebSocket
 * Used when a node with an existing nodeId reconnects after a connection drop
 */
export async function handleNodeReconnect(
  ws: WsConnection,
  message: WsMessage<ReconnectNodePayload>,
): Promise<void> {
  const { payload, correlationId } = message;

  logger.info('Node reconnect request received', {
    nodeId: payload.nodeId,
    hasRunningPodIds: payload.runningPodIds !== undefined,
    runningPodCount: payload.runningPodIds?.length ?? 0,
  });

  // Check authentication
  if (!ws.userId) {
    sendResponse(
      ws,
      'node:reconnect:error',
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      correlationId,
    );
    return;
  }

  // Check if node is banned (chaos testing)
  // Silently terminate - don't reveal ban status to client so it appears as network failure
  const chaosProxy = getChaosProxy();
  if (chaosProxy.isEnabled() && chaosProxy.isNodeBanned(payload.nodeId)) {
    logger.info('Blocked reconnect attempt from banned node (silent terminate)', { nodeId: payload.nodeId });
    // Just terminate the connection without sending any error
    // Client will see this as a transient network failure and retry
    ws.terminate();
    return;
  }

  // Validate nodeId is present
  if (!payload.nodeId) {
    sendResponse(
      ws,
      'node:reconnect:error',
      { code: 'VALIDATION_ERROR', message: 'nodeId is required' },
      correlationId,
    );
    return;
  }

  // Validate nodeId format
  if (!UUID_REGEX.test(payload.nodeId)) {
    sendResponse(
      ws,
      'node:reconnect:error',
      { code: 'VALIDATION_ERROR', message: 'Invalid node ID format' },
      correlationId,
    );
    return;
  }

  const nodeQueries = getNodeQueries();

  // Get the node to verify it exists and belongs to this user
  const nodeResult = await nodeQueries.getNodeById(payload.nodeId);
  if (nodeResult.error || !nodeResult.data) {
    sendResponse(
      ws,
      'node:reconnect:error',
      { code: 'NOT_FOUND', message: 'Node not found' },
      correlationId,
    );
    return;
  }

  // Verify the node was registered by this user
  if (nodeResult.data.registeredBy !== ws.userId) {
    sendResponse(
      ws,
      'node:reconnect:error',
      { code: 'FORBIDDEN', message: 'Node does not belong to this user' },
      correlationId,
    );
    return;
  }

  // Reconnect the node - update connection ID, set online, and optionally update capabilities
  const reconnectResult = await nodeQueries.reconnectNode(
    payload.nodeId,
    ws.id,
    payload.capabilities
  );
  if (reconnectResult.error || !reconnectResult.data) {
    sendResponse(
      ws,
      'node:reconnect:error',
      { code: 'INTERNAL_ERROR', message: 'Failed to reconnect node' },
      correlationId,
    );
    return;
  }

  // Register the node ID to the connection for chaos testing and tracking
  const connManager = getConnectionManager();
  if (connManager) {
    connManager.registerNodeToConnection(ws.id, reconnectResult.data.id);
  }

  // Handle orphaned pods after node restart.
  // If the node provides runningPodIds, we stop any pods that the DB thinks are running
  // but the node doesn't have (they were lost during the restart).
  if (payload.runningPodIds !== undefined) {
    const podQueries = getPodQueriesAdmin();
    const orphanResult = await podQueries.stopOrphanedPodsOnNode(
      payload.nodeId,
      payload.runningPodIds
    );

    // Log errors from orphan cleanup - these should not happen and indicate
    // a database issue (e.g., missing enum value for termination_reason)
    if (orphanResult.error) {
      logger.error('Failed to stop orphaned pods on node reconnect', undefined, {
        nodeId: payload.nodeId,
        nodeName: reconnectResult.data.name,
        runningPodCount: payload.runningPodIds.length,
        error: orphanResult.error.message || String(orphanResult.error),
      });
    }

    if (orphanResult.data && orphanResult.data.stoppedCount > 0) {
      logger.info('Stopped orphaned pods after node restart', {
        nodeId: payload.nodeId,
        nodeName: reconnectResult.data.name,
        stoppedCount: orphanResult.data.stoppedCount,
        podIds: orphanResult.data.podIds,
      });

      // Trigger immediate reconciliation to create replacement pods for stopped orphans.
      // This ensures DaemonSet pods are re-created without waiting for the next reconcile cycle.
      const deploymentController = getDeploymentController();
      if (deploymentController && deploymentController.isActive()) {
        // Run reconciliation asynchronously to not block the response
        deploymentController.triggerReconcile().catch((error) => {
          logger.error('Failed to trigger reconciliation after orphan cleanup', error instanceof Error ? error : undefined, {
            nodeId: payload.nodeId,
          });
        });
      }
    }

    // Handle stale pods: pods the node is running but shouldn't be.
    // This happens when a node was banned/disconnected, another node took over,
    // but the original node kept running the pod. On reconnect, we tell it to stop.
    const staleResult = await podQueries.findStalePods(
      payload.nodeId,
      payload.runningPodIds
    );

    if (staleResult.error) {
      logger.error('Failed to find stale pods on node reconnect', undefined, {
        nodeId: payload.nodeId,
        nodeName: reconnectResult.data.name,
        error: staleResult.error.message || String(staleResult.error),
      });
    }

    if (staleResult.data && staleResult.data.podIds.length > 0) {
      logger.info('Found stale pods on reconnected node - sending stop commands', {
        nodeId: payload.nodeId,
        nodeName: reconnectResult.data.name,
        stalePodCount: staleResult.data.podIds.length,
        podIds: staleResult.data.podIds,
      });

      // Send stop commands to the node for each stale pod
      for (const podId of staleResult.data.podIds) {
        const sent = sendToNode(ws.id, {
          type: 'pod:stop',
          payload: {
            podId,
            reason: 'stale_pod',
            message: 'Pod was taken over by another node during disconnect - stopping stale instance',
          },
        });

        if (sent) {
          logger.debug('Sent stop command for stale pod', {
            podId,
            nodeId: payload.nodeId,
          });
        } else {
          logger.warn('Failed to send stop command for stale pod', {
            podId,
            nodeId: payload.nodeId,
          });
        }
      }
    }
  }

  sendResponse(
    ws,
    'node:reconnect:ack',
    { node: reconnectResult.data },
    correlationId,
  );
}

/**
 * Handle node disconnect (connection closed)
 * Marks nodes as SUSPECT (not offline) to allow reconnection within lease period.
 * Pods remain logically owned during suspect period - no replacements scheduled.
 * The NodeHealthService will expire the lease and revoke pods if node doesn't reconnect.
 */
export async function handleNodeDisconnect(ws: WsConnection): Promise<void> {
  const nodeQueries = getNodeQueries();

  try {
    // Find all nodes associated with this connection
    const nodesResult = await nodeQueries.listNodes({ connectionId: ws.id });
    if (nodesResult.error || !nodesResult.data) {
      return;
    }

    // Mark all nodes as SUSPECT (not offline) and clear connection ID
    // Do NOT fail pods yet - they remain logically owned during lease period
    for (const node of nodesResult.data) {
      logger.info('Node disconnected - marking as SUSPECT (lease started)', {
        nodeId: node.id,
        nodeName: node.name,
        connectionId: ws.id,
      });

      // Mark node as suspect (starts the lease timer)
      const suspectResult = await nodeQueries.markNodeSuspect(node.id);
      if (suspectResult.error) {
        logger.error('Failed to mark node as suspect', undefined, {
          nodeId: node.id,
          nodeName: node.name,
          error: suspectResult.error,
        });
      }

      // Clear connection ID so new connection can be established
      await nodeQueries.clearConnectionId(node.id);
    }
  } catch (error) {
    logger.error(
      'Error handling node disconnect',
      error instanceof Error ? error : undefined,
      { connectionId: ws.id },
    );
    // Handle gracefully - node disconnect should not throw
  }
}
