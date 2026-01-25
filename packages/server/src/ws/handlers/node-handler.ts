/**
 * WebSocket Node Handler
 * @module @stark-o/server/ws/handlers/node-handler
 *
 * Handles WebSocket messages for node registration, heartbeat, and disconnect.
 */

import type { RegisterNodeInput, NodeHeartbeat } from '@stark-o/shared';
import { validateRegisterNodeInput, createServiceLogger } from '@stark-o/shared';
import { getNodeQueries } from '../../supabase/nodes.js';
import { getPodQueriesAdmin } from '../../supabase/pods.js';

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
  userId?: string;
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

  // Reconnect the node - update connection ID and set online
  const reconnectResult = await nodeQueries.reconnectNode(payload.nodeId, ws.id);
  if (reconnectResult.error || !reconnectResult.data) {
    sendResponse(
      ws,
      'node:reconnect:error',
      { code: 'INTERNAL_ERROR', message: 'Failed to reconnect node' },
      correlationId,
    );
    return;
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
 * Marks nodes as offline and fails all active pods on those nodes
 */
export async function handleNodeDisconnect(ws: WsConnection): Promise<void> {
  const nodeQueries = getNodeQueries();
  const podQueries = getPodQueriesAdmin();

  try {
    // Find all nodes associated with this connection
    const nodesResult = await nodeQueries.listNodes({ connectionId: ws.id });
    if (nodesResult.error || !nodesResult.data) {
      return;
    }

    // Mark all nodes as offline, fail their pods, and clear connection ID
    for (const node of nodesResult.data) {
      // Fail all active pods on this node
      const failResult = await podQueries.failPodsOnNode(
        node.id,
        'Node went offline',
      );
      
      if (failResult.data && failResult.data.failedCount > 0) {
        logger.info('Failed pods due to node disconnect', {
          nodeId: node.id,
          nodeName: node.name,
          failedCount: failResult.data.failedCount,
          podIds: failResult.data.podIds,
        });
      }

      await nodeQueries.setNodeStatus(node.id, 'offline');
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
