/**
 * Pod REST API Endpoints
 *
 * Provides REST endpoints for pod creation, management, and status retrieval.
 * @module @stark-o/server/api/pods
 */

import { Router, Request, Response } from 'express';
import type { PodStatus, CreatePodInput, Pod } from '@stark-o/shared';
import { validateCreatePodInput, validateResourceRequestsVsLimits, createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { getPodQueriesAdmin } from '../supabase/pods.js';
import { getPackQueries } from '../supabase/packs.js';
import { getNodeQueries } from '../supabase/nodes.js';
import { sendToNode } from '../services/connection-service.js';
import {
  authMiddleware,
  abilityMiddleware,
  canCreatePod,
  canReadPod,
  canDeletePod,
  checkOwnership,
  type AuthenticatedRequest,
} from '../middleware/index.js';

/**
 * Logger for pod API operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'api-pods' });

/**
 * UUID v4 validation pattern
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * API success response
 */
interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

/**
 * API error response
 */
interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Pod creation response
 */
interface CreatePodResponse {
  pod: Pod;
}

/**
 * Pod list response
 */
interface PodListResponse {
  pods: Array<{
    id: string;
    packId: string;
    packVersion: string;
    nodeId: string | null;
    status: PodStatus;
    namespace: string;
    labels: Record<string, string>;
    priority: number;
    createdBy: string;
    createdAt: Date;
    startedAt?: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Pod by ID response
 */
interface PodByIdResponse {
  pod: Pod;
}

/**
 * Pod status response
 */
interface PodStatusResponse {
  pod: Pick<Pod, 'id' | 'status' | 'statusMessage' | 'nodeId' | 'startedAt' | 'stoppedAt'>;
}

/**
 * Helper to send success response
 */
function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  const response: ApiSuccessResponse<T> = { success: true, data };
  res.status(statusCode).json(response);
}

/**
 * Helper to send error response
 */
function sendError(
  res: Response,
  code: string,
  message: string,
  statusCode: number,
  details?: Record<string, unknown>
): void {
  const response: ApiErrorResponse = {
    success: false,
    error: { code, message, ...(details && { details }) },
  };
  res.status(statusCode).json(response);
}

/**
 * Validates UUID format
 */
function isValidUUID(id: string): boolean {
  return UUID_PATTERN.test(id);
}

/**
 * Extract user ID from request (middleware should set this)
 * For now, returns a placeholder until auth middleware is implemented (T089)
 */
function getUserId(req: Request): string | null {
  // Check for user set by auth middleware
  const user = (req as Request & { user?: { id: string } }).user;
  if (user?.id) {
    return user.id;
  }

  // Fallback for development - check authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    // In production, this would be decoded from JWT
    // For now, use a development user ID
    return 'dev-user-id';
  }

  return null;
}

/**
 * Parse label selector from query string
 * Format: "key1=value1,key2=value2"
 */
function parseLabelSelector(selectorStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = selectorStr.split(',');

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      result[key.trim()] = value.trim();
    }
  }

  return result;
}

/**
 * POST /api/pods - Create a new pod
 */
async function createPod(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Pod creation attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to create a pod', 401);
      return;
    }

    requestLogger.debug('Pod creation request received', { userId });

    const body = req.body as Record<string, unknown>;
    const packQueries = getPackQueries();

    // Support both packId (direct UUID) and packName + optional packVersion
    let resolvedPackId = body.packId as string | undefined;
    let resolvedPackVersion = body.packVersion as string | undefined;

    if (!resolvedPackId && body.packName) {
      // Resolve pack by name and version
      const packName = body.packName as string;
      const packVersion = body.packVersion as string | undefined;

      if (packVersion) {
        // Get specific version
        const packResult = await packQueries.getPackByNameAndVersion(packName, packVersion);
        if (packResult.error || !packResult.data) {
          sendError(res, 'NOT_FOUND', `Pack '${packName}' version '${packVersion}' not found`, 404);
          return;
        }
        resolvedPackId = packResult.data.id;
        resolvedPackVersion = packResult.data.version;
      } else {
        // Get latest version
        const packResult = await packQueries.getLatestPackVersion(packName);
        if (packResult.error || !packResult.data) {
          sendError(res, 'NOT_FOUND', `Pack '${packName}' not found`, 404);
          return;
        }
        resolvedPackId = packResult.data.id;
        resolvedPackVersion = packResult.data.version;
        requestLogger.debug('Resolved to latest pack version', { packName, version: resolvedPackVersion });
      }
    }

    // Build the validated input with resolved packId
    const validatedBody = {
      ...body,
      packId: resolvedPackId,
      packVersion: resolvedPackVersion,
    };

    // Validate input
    const validationResult = validateCreatePodInput(validatedBody);
    if (!validationResult.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validationResult.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      requestLogger.warn('Pod creation validation failed', { errors: validationResult.errors });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    const input = validatedBody as CreatePodInput;

    // Validate resource requests vs limits
    const resourceErrors = validateResourceRequestsVsLimits(
      input.resourceRequests,
      input.resourceLimits
    );
    if (resourceErrors.length > 0) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of resourceErrors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      requestLogger.warn('Pod resource validation failed', { errors: resourceErrors });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    // Verify pack exists (already done above if using packName, but still verify for direct packId)
    const packResult = await packQueries.getPackById(input.packId);

    if (packResult.error) {
      // Check for not found error
      if (packResult.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Pack not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to verify pack', 500);
      return;
    }

    if (!packResult.data) {
      sendError(res, 'NOT_FOUND', 'Pack not found', 404);
      return;
    }

    // Create pod
    const podQueries = getPodQueriesAdmin();
    const createResult = await podQueries.createPod(input, userId);

    if (createResult.error) {
      requestLogger.error('Failed to create pod in database', undefined, {
        error: createResult.error,
        packId: input.packId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to create pod', 500, {
        dbError: createResult.error.message,
        dbCode: createResult.error.code,
      });
      return;
    }

    if (!createResult.data) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to create pod', 500);
      return;
    }

    // Log history entry for pod creation
    await podQueries.createPodHistory({
      podId: createResult.data.id,
      action: 'created',
      actorId: userId,
      newStatus: 'pending',
      message: `Pod created for pack ${input.packId}`,
    });

    const response: CreatePodResponse = {
      pod: createResult.data,
    };

    requestLogger.info('Pod created successfully', {
      podId: createResult.data.id,
      packId: input.packId,
      namespace: input.namespace || 'default',
      userId,
    });

    sendSuccess(res, response, 201);
  } catch (error) {
    requestLogger.error('Error creating pod', error instanceof Error ? error : undefined, {
      body: req.body,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/pods - List pods with pagination and filtering
 */
async function listPods(req: Request, res: Response): Promise<void> {
  try {
    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const namespace = req.query.namespace as string | undefined;
    const packId = req.query.packId as string | undefined;
    const nodeId = req.query.nodeId as string | undefined;
    const status = req.query.status as PodStatus | undefined;
    const labelSelector = req.query.labelSelector as string | undefined;

    // Validate packId if provided
    if (packId && !isValidUUID(packId)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pack ID format', 400);
      return;
    }

    // Validate nodeId if provided
    if (nodeId && !isValidUUID(nodeId)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid node ID format', 400);
      return;
    }

    // Validate status if provided
    const validStatuses: PodStatus[] = [
      'pending',
      'scheduled',
      'starting',
      'running',
      'stopping',
      'stopped',
      'failed',
      'evicted',
      'unknown',
    ];
    if (status && !validStatuses.includes(status)) {
      sendError(
        res,
        'VALIDATION_ERROR',
        `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        400
      );
      return;
    }

    const podQueries = getPodQueriesAdmin();

    // Get total count for pagination
    const countResult = await podQueries.countPods({
      namespace,
      packId,
      nodeId,
      status,
    });

    if (countResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to count pods', 500);
      return;
    }

    // Get pods with offset
    const offset = (page - 1) * pageSize;
    const listResult = await podQueries.listPods({
      namespace,
      packId,
      nodeId,
      status,
      labelSelector: labelSelector ? parseLabelSelector(labelSelector) : undefined,
      limit: pageSize,
      offset,
    });

    if (listResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to list pods', 500);
      return;
    }

    const pods = listResult.data || [];

    const response: PodListResponse = {
      pods,
      total: countResult.data ?? 0,
      page,
      pageSize,
    };

    logger.debug('Pods listed', { total: response.total, page, pageSize, namespace });
    sendSuccess(res, response);
  } catch (error) {
    logger.error('Error listing pods', error instanceof Error ? error : undefined, {
      query: req.query,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/pods/:id - Get pod by ID
 */
async function getPodById(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pod ID format', 400);
      return;
    }

    const podQueries = getPodQueriesAdmin();
    const result = await podQueries.getPodById(id);

    if (result.error) {
      // Check for not found error
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Pod not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to get pod', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Pod not found', 404);
      return;
    }

    const response: PodByIdResponse = {
      pod: result.data,
    };

    logger.debug('Pod retrieved', { podId: id });
    sendSuccess(res, response);
  } catch (error) {
    logger.error('Error getting pod', error instanceof Error ? error : undefined, {
      podId: req.params.id,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/pods/:id/status - Get pod status summary
 */
async function getPodStatus(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pod ID format', 400);
      return;
    }

    const podQueries = getPodQueriesAdmin();
    const result = await podQueries.getPodById(id);

    if (result.error) {
      // Check for not found error
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Pod not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to get pod status', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Pod not found', 404);
      return;
    }

    const response: PodStatusResponse = {
      pod: {
        id: result.data.id,
        status: result.data.status,
        statusMessage: result.data.statusMessage,
        nodeId: result.data.nodeId,
        startedAt: result.data.startedAt,
        stoppedAt: result.data.stoppedAt,
      },
    };

    logger.debug('Pod status retrieved', { podId: id, status: result.data.status });
    sendSuccess(res, response);
  } catch (error) {
    logger.error('Error getting pod status', error instanceof Error ? error : undefined, {
      podId: req.params.id,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * DELETE /api/pods/:id - Stop and delete a pod
 */
async function deletePod(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;

    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to delete a pod', 401);
      return;
    }

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pod ID format', 400);
      return;
    }

    const podQueries = getPodQueriesAdmin();

    // Check pod exists
    const existingResult = await podQueries.getPodById(id);
    if (existingResult.error || !existingResult.data) {
      sendError(res, 'NOT_FOUND', 'Pod not found', 404);
      return;
    }

    // Check authorization (owner or admin/operator)
    // Uses RBAC checkOwnership which grants access to admins, operators, or the owner
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user || !checkOwnership(authReq.user, existingResult.data.createdBy)) {
      sendError(res, 'FORBIDDEN', 'Not authorized to delete this pod', 403);
      return;
    }

    const previousStatus = existingResult.data.status;
    const nodeId = existingResult.data.nodeId;

    // If pod is running, stop it first and notify the node
    if (['running', 'starting', 'scheduled'].includes(existingResult.data.status)) {
      await podQueries.stopPod(id, 'Deleted by user');

      // Send pod:stop message to the node via WebSocket if the pod was assigned to a node
      if (nodeId) {
        const nodeQueries = getNodeQueries();
        const nodeResult = await nodeQueries.getNodeById(nodeId);
        if (nodeResult.data?.connectionId) {
          const sent = sendToNode(nodeResult.data.connectionId, {
            type: 'pod:stop',
            payload: {
              podId: id,
              reason: 'user_delete',
              message: 'Pod stopped by user via API',
            },
          });

          if (sent) {
            logger.info('Pod stop message sent to node', { podId: id, nodeId, connectionId: nodeResult.data.connectionId });
          } else {
            logger.warn('Failed to send pod stop message - node connection not found', { podId: id, nodeId });
          }
        } else {
          logger.debug('Node has no active connection, skipping WebSocket notification', { podId: id, nodeId });
        }
      }
    }

    // Log history entry before deletion
    await podQueries.createPodHistory({
      podId: id,
      action: 'stopped',
      actorId: userId,
      previousStatus,
      newStatus: 'stopped',
      reason: 'user_delete',
      message: 'Pod stopped and deleted by user',
    });

    // Delete pod
    const deleteResult = await podQueries.deletePod(id);

    if (deleteResult.error) {
      logger.error('Failed to delete pod from database', undefined, {
        podId: id,
        error: deleteResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete pod', 500);
      return;
    }

    logger.info('Pod deleted successfully', { podId: id, userId, previousStatus });
    sendSuccess(res, { message: 'Pod stopped and deleted' });
  } catch (error) {
    logger.error('Error deleting pod', error instanceof Error ? error : undefined, {
      podId: req.params.id,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/pods/:id/history - Get pod history
 */
async function getPodHistory(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pod ID format', 400);
      return;
    }

    // Parse pagination parameters
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const podQueries = getPodQueriesAdmin();

    // Verify pod exists
    const podResult = await podQueries.getPodById(id);
    if (podResult.error || !podResult.data) {
      sendError(res, 'NOT_FOUND', 'Pod not found', 404);
      return;
    }

    // Get history
    const historyResult = await podQueries.getPodHistory(id, { limit, offset });

    if (historyResult.error) {
      logger.error('Failed to get pod history', undefined, {
        podId: id,
        error: historyResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get pod history', 500);
      return;
    }

    logger.debug('Pod history retrieved', { podId: id, historyCount: historyResult.data?.length ?? 0 });
    sendSuccess(res, {
      history: historyResult.data || [],
      podId: id,
    });
  } catch (error) {
    logger.error('Error getting pod history', error instanceof Error ? error : undefined, {
      podId: req.params.id,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * Rollback request body
 */
interface RollbackRequestBody {
  targetVersion: string;
}

/**
 * Rollback response
 */
interface RollbackResponse {
  podId: string;
  previousVersion: string;
  newVersion: string;
  packId: string;
  packName: string;
}

/**
 * POST /api/pods/:id/rollback - Rollback a pod to a different version
 */
async function rollbackPod(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    const id = req.params.id;

    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Pod rollback attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to rollback a pod', 401);
      return;
    }

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pod ID format', 400);
      return;
    }

    // Validate request body
    const body = req.body as RollbackRequestBody;
    if (!body.targetVersion || typeof body.targetVersion !== 'string') {
      sendError(res, 'VALIDATION_ERROR', 'targetVersion is required and must be a string', 400);
      return;
    }

    const targetVersion = body.targetVersion.trim();
    if (targetVersion === '') {
      sendError(res, 'VALIDATION_ERROR', 'targetVersion cannot be empty', 400);
      return;
    }

    requestLogger.debug('Pod rollback request received', { podId: id, targetVersion, userId });

    const podQueries = getPodQueriesAdmin();
    const packQueries = getPackQueries();

    // Verify pod exists
    const podResult = await podQueries.getPodById(id);
    if (podResult.error || !podResult.data) {
      sendError(res, 'NOT_FOUND', 'Pod not found', 404);
      return;
    }

    const pod = podResult.data;

    // Validate pod status - only allow rollback for scheduled, running, or starting pods
    const allowedStatuses: PodStatus[] = ['scheduled', 'running', 'starting'];
    if (!allowedStatuses.includes(pod.status)) {
      sendError(
        res,
        'INVALID_STATE',
        `Cannot rollback pod in status '${pod.status}'. Allowed statuses: ${allowedStatuses.join(', ')}`,
        400
      );
      return;
    }

    // Check authorization (owner or admin)
    if (pod.createdBy !== userId) {
      sendError(res, 'FORBIDDEN', 'Not authorized to rollback this pod', 403);
      return;
    }

    // Get the current pack
    const currentPackResult = await packQueries.getPackById(pod.packId);
    if (currentPackResult.error || !currentPackResult.data) {
      sendError(res, 'NOT_FOUND', 'Current pack not found', 404);
      return;
    }

    const currentPack = currentPackResult.data;
    const packName = currentPack.name;
    const previousVersion = pod.packVersion;

    // Check if target version is the same as current
    if (previousVersion === targetVersion) {
      sendError(res, 'SAME_VERSION', `Pod is already running version ${targetVersion}`, 400);
      return;
    }

    // Find the target version pack
    const targetPackResult = await packQueries.getPackByNameAndVersion(packName, targetVersion);
    if (targetPackResult.error || !targetPackResult.data) {
      sendError(
        res,
        'VERSION_NOT_FOUND',
        `Pack version ${packName}@${targetVersion} not found`,
        404
      );
      return;
    }

    const targetPack = targetPackResult.data;

    // Note: Runtime compatibility check would require node lookup
    // For now, we assume if the pack exists, it's compatible
    // A full implementation would check the node's runtime type

    // Update the pod with the new pack ID and version
    const rollbackResult = await podQueries.rollbackPod(id, targetPack.id, targetVersion);
    if (rollbackResult.error) {
      requestLogger.error('Failed to rollback pod', undefined, {
        podId: id,
        error: rollbackResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to rollback pod', 500);
      return;
    }

    // Record history entry for the rollback
    await podQueries.createPodHistory({
      podId: id,
      action: 'rolled_back',
      actorId: userId,
      previousVersion,
      newVersion: targetVersion,
      message: `Rolled back from ${previousVersion} to ${targetVersion}`,
    });

    const response: RollbackResponse = {
      podId: id,
      previousVersion,
      newVersion: targetVersion,
      packId: targetPack.id,
      packName,
    };

    requestLogger.info('Pod rolled back successfully', {
      podId: id,
      packName,
      previousVersion,
      newVersion: targetVersion,
      userId,
    });

    sendSuccess(res, response);
  } catch (error) {
    requestLogger.error('Error rolling back pod', error instanceof Error ? error : undefined, {
      podId: req.params.id,
      body: req.body,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * Creates the pods router
 */
export function createPodsRouter(): Router {
  const router = Router();

  // POST /api/pods - Create a new pod (requires create permission)
  router.post('/', authMiddleware, abilityMiddleware, canCreatePod, createPod);

  // GET /api/pods - List pods (requires read permission)
  router.get('/', authMiddleware, abilityMiddleware, canReadPod, listPods);

  // GET /api/pods/:id - Get pod by ID (requires read permission)
  router.get('/:id([0-9a-f-]{36})', authMiddleware, abilityMiddleware, canReadPod, getPodById);

  // GET /api/pods/:id/status - Get pod status (requires read permission)
  router.get('/:id([0-9a-f-]{36})/status', authMiddleware, abilityMiddleware, canReadPod, getPodStatus);

  // GET /api/pods/:id/history - Get pod history (requires read permission)
  router.get('/:id([0-9a-f-]{36})/history', authMiddleware, abilityMiddleware, canReadPod, getPodHistory);

  // POST /api/pods/:id/rollback - Rollback pod to a different version (requires create permission)
  router.post('/:id([0-9a-f-]{36})/rollback', authMiddleware, abilityMiddleware, canCreatePod, rollbackPod);

  // DELETE /api/pods/:id - Delete pod (requires delete permission)
  router.delete('/:id([0-9a-f-]{36})', authMiddleware, abilityMiddleware, canDeletePod, deletePod);

  return router;
}

// Export the router factory
export default createPodsRouter;

// Export individual handlers for testing
export {
  createPod,
  listPods,
  getPodById,
  getPodStatus,
  getPodHistory,
  rollbackPod,
  deletePod,
};
