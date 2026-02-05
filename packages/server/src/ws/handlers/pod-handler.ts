/**
 * WebSocket Pod Handler
 * @module @stark-o/server/ws/handlers/pod-handler
 *
 * Handles WebSocket messages for pod lifecycle operations with history tracking.
 */

import type { PodStatus, UserRole } from '@stark-o/shared';
import { createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import {
  schedulePodWithHistory,
  startPodWithHistory,
  stopPodWithHistory,
  failPodWithHistory,
  evictPodWithHistory,
  restartPodWithHistory,
} from '../../supabase/pod-history-service.js';
import { getPodQueries } from '../../supabase/pods.js';

/**
 * Logger for pod handler
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'ws-pod-handler' });

/**
 * WebSocket message types for pods
 */
export type WsPodMessageType =
  | 'pod:schedule'
  | 'pod:schedule:ack'
  | 'pod:schedule:error'
  | 'pod:start'
  | 'pod:start:ack'
  | 'pod:start:error'
  | 'pod:stop'
  | 'pod:stop:ack'
  | 'pod:stop:error'
  | 'pod:fail'
  | 'pod:fail:ack'
  | 'pod:fail:error'
  | 'pod:evict'
  | 'pod:evict:ack'
  | 'pod:evict:error'
  | 'pod:restart'
  | 'pod:restart:ack'
  | 'pod:restart:error'
  | 'pod:status:update'
  | 'pod:status:update:ack'
  | 'pod:status:update:error';

/**
 * WebSocket message structure
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
  nodeId?: string;
}

/**
 * UUID validation regex
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Pod schedule payload
 */
interface PodSchedulePayload {
  podId: string;
  nodeId: string;
  message?: string;
}

/**
 * Pod status update payload
 */
interface PodStatusUpdatePayload {
  podId: string;
  status: PodStatus;
  message?: string;
  reason?: string;
  /** Pod incarnation - used to reject late messages from old incarnations */
  incarnation?: number;
}

/**
 * Pod action payload (stop, fail, evict, restart)
 */
interface PodActionPayload {
  podId: string;
  message?: string;
  reason?: string;
  /** Pod incarnation - used to reject late messages from old incarnations */
  incarnation?: number;
}

/**
 * Helper to send a WebSocket response
 */
function sendResponse<T>(
  ws: WsConnection,
  type: WsPodMessageType,
  payload: T,
  correlationId?: string,
): void {
  ws.send(JSON.stringify({ type, payload, correlationId }));
}

/**
 * Check if connection is authenticated
 */
function checkAuth(ws: WsConnection, correlationId?: string): boolean {
  if (!ws.userId) {
    sendResponse(
      ws,
      'pod:schedule:error' as WsPodMessageType,
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      correlationId,
    );
    return false;
  }
  return true;
}

/**
 * Validate UUID format
 */
function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

/**
 * Handle pod scheduling from a node
 */
export async function handlePodSchedule(
  ws: WsConnection,
  message: WsMessage<PodSchedulePayload>,
): Promise<void> {
  const { payload, correlationId } = message;
  const requestLogger = logger.withCorrelationId(correlationId ?? generateCorrelationId());

  if (!checkAuth(ws, correlationId)) return;

  // Validate payload
  if (!payload.podId || !isValidUUID(payload.podId)) {
    sendResponse(ws, 'pod:schedule:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing podId',
    }, correlationId);
    return;
  }

  if (!payload.nodeId || !isValidUUID(payload.nodeId)) {
    sendResponse(ws, 'pod:schedule:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing nodeId',
    }, correlationId);
    return;
  }

  requestLogger.debug('Pod schedule request', { podId: payload.podId, nodeId: payload.nodeId });

  const result = await schedulePodWithHistory(
    payload.podId,
    payload.nodeId,
    {
      actorId: ws.userId,
      message: payload.message,
      reason: 'ws_schedule',
      useAdmin: true,
    }
  );

  if (result.error) {
    requestLogger.error('Failed to schedule pod', undefined, { error: result.error });
    sendResponse(ws, 'pod:schedule:error', {
      code: 'SCHEDULE_FAILED',
      message: result.error.message || 'Failed to schedule pod',
    }, correlationId);
    return;
  }

  requestLogger.info('Pod scheduled successfully', { podId: payload.podId, nodeId: payload.nodeId });
  sendResponse(ws, 'pod:schedule:ack', {
    podId: payload.podId,
    nodeId: payload.nodeId,
    status: 'scheduled',
  }, correlationId);
}

/**
 * Handle pod start notification from a node
 */
export async function handlePodStart(
  ws: WsConnection,
  message: WsMessage<PodActionPayload>,
): Promise<void> {
  const { payload, correlationId } = message;
  const requestLogger = logger.withCorrelationId(correlationId ?? generateCorrelationId());

  if (!checkAuth(ws, correlationId)) return;

  if (!payload.podId || !isValidUUID(payload.podId)) {
    sendResponse(ws, 'pod:start:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing podId',
    }, correlationId);
    return;
  }

  requestLogger.debug('Pod start request', { podId: payload.podId });

  const result = await startPodWithHistory(
    payload.podId,
    {
      actorId: ws.userId,
      message: payload.message,
      reason: payload.reason ?? 'ws_start',
      metadata: { initiatedBy: ws.nodeId ?? 'unknown' },
      useAdmin: true,
    }
  );

  if (result.error) {
    requestLogger.error('Failed to start pod', undefined, { error: result.error });
    sendResponse(ws, 'pod:start:error', {
      code: 'START_FAILED',
      message: result.error.message || 'Failed to start pod',
    }, correlationId);
    return;
  }

  requestLogger.info('Pod started successfully', { podId: payload.podId });
  sendResponse(ws, 'pod:start:ack', {
    podId: payload.podId,
    status: 'running',
  }, correlationId);
}

/**
 * Handle pod stop request
 */
export async function handlePodStop(
  ws: WsConnection,
  message: WsMessage<PodActionPayload>,
): Promise<void> {
  const { payload, correlationId } = message;
  const requestLogger = logger.withCorrelationId(correlationId ?? generateCorrelationId());

  if (!checkAuth(ws, correlationId)) return;

  if (!payload.podId || !isValidUUID(payload.podId)) {
    sendResponse(ws, 'pod:stop:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing podId',
    }, correlationId);
    return;
  }

  requestLogger.debug('Pod stop request', { podId: payload.podId });

  const result = await stopPodWithHistory(
    payload.podId,
    payload.message,
    {
      actorId: ws.userId,
      reason: payload.reason ?? 'ws_stop',
      metadata: { initiatedBy: ws.nodeId ?? 'unknown' },
      useAdmin: true,
    }
  );

  if (result.error) {
    requestLogger.error('Failed to stop pod', undefined, { error: result.error });
    sendResponse(ws, 'pod:stop:error', {
      code: 'STOP_FAILED',
      message: result.error.message || 'Failed to stop pod',
    }, correlationId);
    return;
  }

  requestLogger.info('Pod stopped successfully', { podId: payload.podId });
  sendResponse(ws, 'pod:stop:ack', {
    podId: payload.podId,
    status: 'stopped',
  }, correlationId);
}

/**
 * Handle pod failure notification from a node
 */
export async function handlePodFail(
  ws: WsConnection,
  message: WsMessage<PodActionPayload>,
): Promise<void> {
  const { payload, correlationId } = message;
  const requestLogger = logger.withCorrelationId(correlationId ?? generateCorrelationId());

  if (!checkAuth(ws, correlationId)) return;

  if (!payload.podId || !isValidUUID(payload.podId)) {
    sendResponse(ws, 'pod:fail:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing podId',
    }, correlationId);
    return;
  }

  const errorMessage = payload.message ?? 'Pod failed unexpectedly';
  requestLogger.debug('Pod fail notification', { podId: payload.podId, message: errorMessage });

  const result = await failPodWithHistory(
    payload.podId,
    errorMessage,
    {
      actorId: ws.userId,
      reason: payload.reason ?? 'ws_fail',
      metadata: { initiatedBy: ws.nodeId ?? 'unknown' },
      useAdmin: true,
    }
  );

  if (result.error) {
    requestLogger.error('Failed to mark pod as failed', undefined, { error: result.error });
    sendResponse(ws, 'pod:fail:error', {
      code: 'FAIL_UPDATE_ERROR',
      message: result.error.message || 'Failed to update pod status',
    }, correlationId);
    return;
  }

  requestLogger.warn('Pod marked as failed', { podId: payload.podId, message: errorMessage });
  sendResponse(ws, 'pod:fail:ack', {
    podId: payload.podId,
    status: 'failed',
  }, correlationId);
}

/**
 * Handle pod eviction request
 */
export async function handlePodEvict(
  ws: WsConnection,
  message: WsMessage<PodActionPayload>,
): Promise<void> {
  const { payload, correlationId } = message;
  const requestLogger = logger.withCorrelationId(correlationId ?? generateCorrelationId());

  if (!checkAuth(ws, correlationId)) return;

  if (!payload.podId || !isValidUUID(payload.podId)) {
    sendResponse(ws, 'pod:evict:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing podId',
    }, correlationId);
    return;
  }

  const evictionReason = payload.reason ?? payload.message ?? 'Resource pressure';
  requestLogger.debug('Pod evict request', { podId: payload.podId, reason: evictionReason });

  const result = await evictPodWithHistory(
    payload.podId,
    evictionReason,
    {
      actorId: ws.userId,
      message: payload.message,
      metadata: { initiatedBy: ws.nodeId ?? 'unknown' },
      useAdmin: true,
    }
  );

  if (result.error) {
    requestLogger.error('Failed to evict pod', undefined, { error: result.error });
    sendResponse(ws, 'pod:evict:error', {
      code: 'EVICT_FAILED',
      message: result.error.message || 'Failed to evict pod',
    }, correlationId);
    return;
  }

  requestLogger.info('Pod evicted successfully', { podId: payload.podId, reason: evictionReason });
  sendResponse(ws, 'pod:evict:ack', {
    podId: payload.podId,
    status: 'evicted',
    reason: evictionReason,
  }, correlationId);
}

/**
 * Handle pod restart request
 */
export async function handlePodRestart(
  ws: WsConnection,
  message: WsMessage<PodActionPayload>,
): Promise<void> {
  const { payload, correlationId } = message;
  const requestLogger = logger.withCorrelationId(correlationId ?? generateCorrelationId());

  if (!checkAuth(ws, correlationId)) return;

  if (!payload.podId || !isValidUUID(payload.podId)) {
    sendResponse(ws, 'pod:restart:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing podId',
    }, correlationId);
    return;
  }

  requestLogger.debug('Pod restart request', { podId: payload.podId });

  const result = await restartPodWithHistory(
    payload.podId,
    {
      actorId: ws.userId,
      message: payload.message,
      reason: payload.reason ?? 'ws_restart',
      metadata: { initiatedBy: ws.nodeId ?? 'unknown' },
      useAdmin: true,
    }
  );

  if (result.error) {
    requestLogger.error('Failed to restart pod', undefined, { error: result.error });
    sendResponse(ws, 'pod:restart:error', {
      code: 'RESTART_FAILED',
      message: result.error.message || 'Failed to restart pod',
    }, correlationId);
    return;
  }

  requestLogger.info('Pod restarted successfully', { podId: payload.podId });
  sendResponse(ws, 'pod:restart:ack', {
    podId: payload.podId,
    status: 'running',
  }, correlationId);
}

/**
 * Handle generic pod status update
 */
export async function handlePodStatusUpdate(
  ws: WsConnection,
  message: WsMessage<PodStatusUpdatePayload>,
): Promise<void> {
  const { payload, correlationId } = message;
  const requestLogger = logger.withCorrelationId(correlationId ?? generateCorrelationId());

  if (!checkAuth(ws, correlationId)) return;

  if (!payload.podId || !isValidUUID(payload.podId)) {
    sendResponse(ws, 'pod:status:update:error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid or missing podId',
    }, correlationId);
    return;
  }

  const validStatuses: PodStatus[] = [
    'pending', 'scheduled', 'starting', 'running',
    'stopping', 'stopped', 'failed', 'evicted', 'unknown'
  ];

  if (!payload.status || !validStatuses.includes(payload.status)) {
    sendResponse(ws, 'pod:status:update:error', {
      code: 'VALIDATION_ERROR',
      message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
    }, correlationId);
    return;
  }

  // Validate incarnation if provided - reject stale messages from old incarnations
  if (payload.incarnation !== undefined) {
    const podQueries = getPodQueries();
    const validResult = await podQueries.validatePodIncarnation(payload.podId, payload.incarnation);
    
    if (validResult.error) {
      requestLogger.warn('Failed to validate pod incarnation', {
        podId: payload.podId,
        incarnation: payload.incarnation,
        error: validResult.error,
      });
      // Continue anyway - don't block updates due to validation errors
    } else if (validResult.data === false) {
      // Incarnation mismatch - this is a late message from an old pod instance
      requestLogger.warn('Rejecting pod status update from stale incarnation', {
        podId: payload.podId,
        providedIncarnation: payload.incarnation,
        status: payload.status,
      });
      sendResponse(ws, 'pod:status:update:error', {
        code: 'STALE_INCARNATION',
        message: 'Pod incarnation mismatch - this pod instance has been superseded',
      }, correlationId);
      return;
    }
  }

  requestLogger.debug('Pod status update request', {
    podId: payload.podId,
    status: payload.status,
    incarnation: payload.incarnation,
  });

  // Route to appropriate handler based on status
  switch (payload.status) {
    case 'running':
      await handlePodStart(ws, { type: 'pod:start', payload, correlationId });
      return;
    case 'stopped':
      await handlePodStop(ws, { type: 'pod:stop', payload, correlationId });
      return;
    case 'failed':
      await handlePodFail(ws, { type: 'pod:fail', payload, correlationId });
      return;
    case 'evicted':
      await handlePodEvict(ws, { type: 'pod:evict', payload, correlationId });
      return;
    default:
      // For other statuses, use direct update
      const podQueries = getPodQueries();
      const result = await podQueries.updatePodStatus(payload.podId, payload.status, {
        statusMessage: payload.message,
      });

      if (result.error) {
        requestLogger.error('Failed to update pod status', undefined, { error: result.error });
        sendResponse(ws, 'pod:status:update:error', {
          code: 'UPDATE_FAILED',
          message: result.error.message || 'Failed to update pod status',
        }, correlationId);
        return;
      }

      // Record history for the update
      await podQueries.createPodHistory({
        podId: payload.podId,
        action: 'updated',
        actorId: ws.userId,
        newStatus: payload.status,
        reason: payload.reason ?? 'ws_status_update',
        message: payload.message,
      });

      requestLogger.info('Pod status updated', { podId: payload.podId, status: payload.status });
      sendResponse(ws, 'pod:status:update:ack', {
        podId: payload.podId,
        status: payload.status,
      }, correlationId);
  }
}

/**
 * Pod handler message routing
 */
export function routePodMessage(
  ws: WsConnection,
  message: WsMessage,
): Promise<void> | void {
  switch (message.type) {
    case 'pod:schedule':
      return handlePodSchedule(ws, message as WsMessage<PodSchedulePayload>);
    case 'pod:start':
      return handlePodStart(ws, message as WsMessage<PodActionPayload>);
    case 'pod:stop':
      return handlePodStop(ws, message as WsMessage<PodActionPayload>);
    case 'pod:fail':
      return handlePodFail(ws, message as WsMessage<PodActionPayload>);
    case 'pod:evict':
      return handlePodEvict(ws, message as WsMessage<PodActionPayload>);
    case 'pod:restart':
      return handlePodRestart(ws, message as WsMessage<PodActionPayload>);
    case 'pod:status:update':
      return handlePodStatusUpdate(ws, message as WsMessage<PodStatusUpdatePayload>);
    default:
      // Not a pod message
      return;
  }
}

// Export handlers
export default {
  handlePodSchedule,
  handlePodStart,
  handlePodStop,
  handlePodFail,
  handlePodEvict,
  handlePodRestart,
  handlePodStatusUpdate,
  routePodMessage,
};
