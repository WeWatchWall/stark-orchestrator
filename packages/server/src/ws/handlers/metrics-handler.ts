/**
 * WebSocket Metrics Handler
 * @module @stark-o/server/ws/handlers/metrics-handler
 *
 * Handles WebSocket messages for metrics reporting from nodes.
 */

import type {
  CreateNodeMetricsInput,
  CreatePodMetricsInput,
  RuntimeType,
  PodStatus,
  UserRole,
} from '@stark-o/shared';
import { createServiceLogger } from '@stark-o/shared';
import { getMetricsService } from '../../services/metrics-service.js';

/**
 * Logger for metrics handler operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'ws-metrics-handler' });

/**
 * WebSocket message types for metrics
 */
export type WsMetricsMessageType =
  | 'metrics:node'
  | 'metrics:node:ack'
  | 'metrics:node:error'
  | 'metrics:pod'
  | 'metrics:pod:ack'
  | 'metrics:pod:error'
  | 'metrics:pod:batch'
  | 'metrics:pod:batch:ack'
  | 'metrics:pod:batch:error';

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
  userId?: string;
  userRoles?: UserRole[];
}

/**
 * Node metrics payload from runtime
 */
export interface NodeMetricsPayload {
  nodeId: string;
  runtimeType: RuntimeType;
  uptimeSeconds: number;
  cpuUsagePercent?: number;
  memoryUsedBytes?: number;
  memoryTotalBytes?: number;
  memoryUsagePercent?: number;
  runtimeVersion?: string;
  podsAllocated: number;
  podsCapacity: number;
  cpuAllocated: number;
  cpuCapacity: number;
  memoryAllocatedBytes: number;
  memoryCapacityBytes: number;
  workerPool?: {
    totalWorkers: number;
    busyWorkers: number;
    idleWorkers: number;
    pendingTasks: number;
  };
  timestamp: string;
}

/**
 * Pod metrics payload from runtime
 */
export interface PodMetricsPayload {
  podId: string;
  nodeId?: string;
  status: PodStatus;
  restartCount: number;
  executionCount: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalExecutionTimeMs: number;
  avgExecutionTimeMs?: number;
  lastExecutionAt?: string;
  cpuUsagePercent?: number;
  memoryUsedBytes?: number;
}

/**
 * Helper to send a WebSocket response
 */
function sendResponse<T>(
  ws: WsConnection,
  type: WsMetricsMessageType,
  payload: T,
  correlationId?: string,
): void {
  ws.send(JSON.stringify({ type, payload, correlationId }));
}

/**
 * Validate node metrics payload
 */
function validateNodeMetricsPayload(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.nodeId !== 'string' || !p.nodeId) {
    errors.push('nodeId is required');
  }

  if (p.runtimeType !== 'node' && p.runtimeType !== 'browser') {
    errors.push('runtimeType must be "node" or "browser"');
  }

  if (typeof p.uptimeSeconds !== 'number' || p.uptimeSeconds < 0) {
    errors.push('uptimeSeconds must be a non-negative number');
  }

  if (typeof p.podsAllocated !== 'number') {
    errors.push('podsAllocated is required');
  }

  if (typeof p.podsCapacity !== 'number') {
    errors.push('podsCapacity is required');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate pod metrics payload
 */
function validatePodMetricsPayload(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.podId !== 'string' || !p.podId) {
    errors.push('podId is required');
  }

  if (typeof p.status !== 'string' || !p.status) {
    errors.push('status is required');
  }

  if (typeof p.restartCount !== 'number' || p.restartCount < 0) {
    errors.push('restartCount must be a non-negative number');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Handle node metrics report via WebSocket
 */
export async function handleNodeMetrics(
  ws: WsConnection,
  message: WsMessage<NodeMetricsPayload>,
): Promise<void> {
  const { payload, correlationId } = message;

  // Check authentication
  if (!ws.userId) {
    sendResponse(
      ws,
      'metrics:node:error',
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      correlationId,
    );
    return;
  }

  // Validate the payload
  const validation = validateNodeMetricsPayload(payload);
  if (!validation.valid) {
    sendResponse(
      ws,
      'metrics:node:error',
      {
        code: 'VALIDATION_ERROR',
        message: 'Invalid metrics payload',
        errors: validation.errors,
      },
      correlationId,
    );
    return;
  }

  try {
    const metricsService = getMetricsService();

    const input: CreateNodeMetricsInput = {
      nodeId: payload.nodeId,
      runtimeType: payload.runtimeType,
      uptimeSeconds: payload.uptimeSeconds,
      cpuUsagePercent: payload.cpuUsagePercent,
      memoryUsedBytes: payload.memoryUsedBytes,
      memoryTotalBytes: payload.memoryTotalBytes,
      memoryUsagePercent: payload.memoryUsagePercent,
      runtimeVersion: payload.runtimeVersion,
      podsAllocated: payload.podsAllocated,
      podsCapacity: payload.podsCapacity,
      cpuAllocated: payload.cpuAllocated,
      cpuCapacity: payload.cpuCapacity,
      memoryAllocatedBytes: payload.memoryAllocatedBytes,
      memoryCapacityBytes: payload.memoryCapacityBytes,
      workerPoolTotal: payload.workerPool?.totalWorkers,
      workerPoolBusy: payload.workerPool?.busyWorkers,
      workerPoolIdle: payload.workerPool?.idleWorkers,
      workerPoolPendingTasks: payload.workerPool?.pendingTasks,
    };

    await metricsService.recordNodeMetrics(input);

    logger.debug('Received node metrics', {
      nodeId: payload.nodeId,
      uptimeSeconds: payload.uptimeSeconds,
      cpuUsagePercent: payload.cpuUsagePercent,
    });

    sendResponse(
      ws,
      'metrics:node:ack',
      { success: true },
      correlationId,
    );
  } catch (error) {
    logger.error('Failed to record node metrics', {
      nodeId: payload.nodeId,
      error: error instanceof Error ? error.message : String(error),
    });

    sendResponse(
      ws,
      'metrics:node:error',
      {
        code: 'INTERNAL_ERROR',
        message: 'Failed to record metrics',
      },
      correlationId,
    );
  }
}

/**
 * Handle pod metrics report via WebSocket
 */
export async function handlePodMetrics(
  ws: WsConnection,
  message: WsMessage<PodMetricsPayload>,
): Promise<void> {
  const { payload, correlationId } = message;

  // Check authentication
  if (!ws.userId) {
    sendResponse(
      ws,
      'metrics:pod:error',
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      correlationId,
    );
    return;
  }

  // Validate the payload
  const validation = validatePodMetricsPayload(payload);
  if (!validation.valid) {
    sendResponse(
      ws,
      'metrics:pod:error',
      {
        code: 'VALIDATION_ERROR',
        message: 'Invalid metrics payload',
        errors: validation.errors,
      },
      correlationId,
    );
    return;
  }

  try {
    const metricsService = getMetricsService();

    const input: CreatePodMetricsInput = {
      podId: payload.podId,
      nodeId: payload.nodeId,
      status: payload.status,
      restartCount: payload.restartCount,
      executionCount: payload.executionCount,
      successfulExecutions: payload.successfulExecutions,
      failedExecutions: payload.failedExecutions,
      totalExecutionTimeMs: payload.totalExecutionTimeMs,
      avgExecutionTimeMs: payload.avgExecutionTimeMs,
      lastExecutionAt: payload.lastExecutionAt ? new Date(payload.lastExecutionAt) : undefined,
      cpuUsagePercent: payload.cpuUsagePercent,
      memoryUsedBytes: payload.memoryUsedBytes,
    };

    await metricsService.recordPodMetrics(input);

    logger.debug('Received pod metrics', {
      podId: payload.podId,
      restartCount: payload.restartCount,
      executionCount: payload.executionCount,
    });

    sendResponse(
      ws,
      'metrics:pod:ack',
      { success: true },
      correlationId,
    );
  } catch (error) {
    logger.error('Failed to record pod metrics', {
      podId: payload.podId,
      error: error instanceof Error ? error.message : String(error),
    });

    sendResponse(
      ws,
      'metrics:pod:error',
      {
        code: 'INTERNAL_ERROR',
        message: 'Failed to record metrics',
      },
      correlationId,
    );
  }
}

/**
 * Handle batch pod metrics report via WebSocket
 */
export async function handlePodMetricsBatch(
  ws: WsConnection,
  message: WsMessage<{ pods: PodMetricsPayload[] }>,
): Promise<void> {
  const { payload, correlationId } = message;

  // Check authentication
  if (!ws.userId) {
    sendResponse(
      ws,
      'metrics:pod:batch:error',
      { code: 'UNAUTHORIZED', message: 'Authentication required' },
      correlationId,
    );
    return;
  }

  if (!Array.isArray(payload.pods)) {
    sendResponse(
      ws,
      'metrics:pod:batch:error',
      {
        code: 'VALIDATION_ERROR',
        message: 'pods must be an array',
      },
      correlationId,
    );
    return;
  }

  try {
    const metricsService = getMetricsService();
    let successCount = 0;
    let errorCount = 0;

    for (const podPayload of payload.pods) {
      const validation = validatePodMetricsPayload(podPayload);
      if (!validation.valid) {
        errorCount++;
        continue;
      }

      const input: CreatePodMetricsInput = {
        podId: podPayload.podId,
        nodeId: podPayload.nodeId,
        status: podPayload.status,
        restartCount: podPayload.restartCount,
        executionCount: podPayload.executionCount,
        successfulExecutions: podPayload.successfulExecutions,
        failedExecutions: podPayload.failedExecutions,
        totalExecutionTimeMs: podPayload.totalExecutionTimeMs,
        avgExecutionTimeMs: podPayload.avgExecutionTimeMs,
        lastExecutionAt: podPayload.lastExecutionAt ? new Date(podPayload.lastExecutionAt) : undefined,
        cpuUsagePercent: podPayload.cpuUsagePercent,
        memoryUsedBytes: podPayload.memoryUsedBytes,
      };

      await metricsService.recordPodMetrics(input);
      successCount++;
    }

    logger.debug('Received batch pod metrics', {
      total: payload.pods.length,
      successCount,
      errorCount,
    });

    sendResponse(
      ws,
      'metrics:pod:batch:ack',
      { success: true, processed: successCount, errors: errorCount },
      correlationId,
    );
  } catch (error) {
    logger.error('Failed to record batch pod metrics', {
      error: error instanceof Error ? error.message : String(error),
    });

    sendResponse(
      ws,
      'metrics:pod:batch:error',
      {
        code: 'INTERNAL_ERROR',
        message: 'Failed to record metrics',
      },
      correlationId,
    );
  }
}

/**
 * Route metrics messages to appropriate handlers
 */
export async function routeMetricsMessage(
  ws: WsConnection,
  message: WsMessage,
): Promise<void> {
  switch (message.type) {
    case 'metrics:node':
      await handleNodeMetrics(ws, message as WsMessage<NodeMetricsPayload>);
      break;

    case 'metrics:pod':
      await handlePodMetrics(ws, message as WsMessage<PodMetricsPayload>);
      break;

    case 'metrics:pod:batch':
      await handlePodMetricsBatch(ws, message as WsMessage<{ pods: PodMetricsPayload[] }>);
      break;

    default:
      logger.warn('Unknown metrics message type', { type: message.type });
  }
}
