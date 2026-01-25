/**
 * Node REST API Endpoints
 *
 * Provides REST endpoints for node registration and management.
 * @module @stark-o/server/api/nodes
 */

import { Router, Request, Response } from 'express';
import type {
  RuntimeType,
  NodeStatus,
  RegisterNodeInput,
  UpdateNodeInput,
} from '@stark-o/shared';
import {
  validateRegisterNodeInput,
  validateUpdateNodeInput,
  createServiceLogger,
  generateCorrelationId,
  ALL_RUNTIME_TYPES,
  ALL_NODE_STATUSES,
} from '@stark-o/shared';
import { getNodeQueries } from '../supabase/nodes.js';
import { getPodQueriesAdmin } from '../supabase/pods.js';
import {
  authMiddleware,
  abilityMiddleware,
  canCreateNode,
  canReadNode,
  canUpdateNode,
  canDeleteNode,
} from '../middleware/index.js';

/**
 * Logger for node API operations
 */
const logger = createServiceLogger(
  {
    level: 'debug',
    service: 'stark-orchestrator',
  },
  { component: 'api-nodes' }
);

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
 * Validates UUID format (also serves as type guard)
 */
function isValidUUID(id: string | undefined): id is string {
  return typeof id === 'string' && UUID_PATTERN.test(id);
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
 * Check if user has admin role (can manage any node)
 */
function hasNodeManagementRole(req: Request): boolean {
  const user = (req as Request & { user?: { id: string; roles?: string[] } }).user;
  if (!user?.roles) {
    return false;
  }
  return user.roles.includes('admin');
}

/**
 * POST /api/nodes - Register a new node
 */
export async function registerNode(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Node registration attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to register a node', 401);
      return;
    }

    requestLogger.debug('Node registration request received', { userId });

    // Validate input
    const validationResult = validateRegisterNodeInput(req.body);
    if (!validationResult.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validationResult.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      requestLogger.warn('Node registration validation failed', {
        errors: validationResult.errors,
      });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    const input = req.body as RegisterNodeInput;

    // Check for duplicate node name
    const nodeQueries = getNodeQueries();
    const existsResult = await nodeQueries.nodeExists(input.name);

    if (existsResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to check node existence', 500);
      return;
    }

    if (existsResult.data) {
      requestLogger.info('Node registration conflict - node already exists', {
        name: input.name,
      });
      sendError(res, 'CONFLICT', `Node ${input.name} already exists`, 409);
      return;
    }

    // Create node
    requestLogger.debug('Creating node record', {
      name: input.name,
      runtimeType: input.runtimeType,
    });

    const createResult = await nodeQueries.createNode({
      ...input,
      registeredBy: userId,
    });

    if (createResult.error) {
      // Check for unique constraint violation
      if (createResult.error.code === '23505') {
        sendError(res, 'CONFLICT', `Node ${input.name} already exists`, 409);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to create node', 500);
      return;
    }

    if (!createResult.data) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to create node', 500);
      return;
    }

    requestLogger.info('Node registered successfully', {
      nodeId: createResult.data.id,
      name: createResult.data.name,
      runtimeType: createResult.data.runtimeType,
      userId,
    });

    sendSuccess(res, { node: createResult.data }, 201);
  } catch (error) {
    requestLogger.error(
      'Error registering node',
      error instanceof Error ? error : undefined,
      {
        body: req.body,
      }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/nodes - List nodes with pagination and filtering
 */
export async function listNodes(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));
    const offset = (page - 1) * pageSize;

    // Support both 'runtime' and 'runtimeType' query parameters for developer convenience
    // e.g., GET /api/nodes?runtime=node or GET /api/nodes?runtimeType=node
    const runtimeType = (req.query.runtime ?? req.query.runtimeType) as RuntimeType | undefined;
    const status = req.query.status as NodeStatus | undefined;
    const search = req.query.search as string | undefined;

    // Validate runtimeType filter if provided
    if (runtimeType && !ALL_RUNTIME_TYPES.includes(runtimeType)) {
      sendError(
        res,
        'VALIDATION_ERROR',
        `Invalid runtime type. Must be one of: ${ALL_RUNTIME_TYPES.join(', ')}`,
        400
      );
      return;
    }

    // Validate status filter if provided
    if (status && !ALL_NODE_STATUSES.includes(status)) {
      sendError(
        res,
        'VALIDATION_ERROR',
        `Invalid status. Must be one of: ${ALL_NODE_STATUSES.join(', ')}`,
        400
      );
      return;
    }

    const nodeQueries = getNodeQueries();

    // Get total count
    const countResult = await nodeQueries.countNodes({ runtimeType, status, search });
    if (countResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to count nodes', 500);
      return;
    }

    // Get nodes
    const listResult = await nodeQueries.listNodes({
      runtimeType,
      status,
      search,
      limit: pageSize,
      offset,
    });

    if (listResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to list nodes', 500);
      return;
    }

    requestLogger.debug('Listed nodes', {
      count: listResult.data?.length ?? 0,
      total: countResult.data,
      page,
      pageSize,
    });

    sendSuccess(res, {
      nodes: listResult.data ?? [],
      total: countResult.data ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    requestLogger.error(
      'Error listing nodes',
      error instanceof Error ? error : undefined
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/nodes/:id - Get a node by ID
 */
export async function getNodeById(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    const { id } = req.params;

    // Validate UUID format
    if (!isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid node ID format', 400);
      return;
    }

    const nodeQueries = getNodeQueries();
    const result = await nodeQueries.getNodeById(id);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Node not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to get node', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Node not found', 404);
      return;
    }

    requestLogger.debug('Retrieved node by ID', { nodeId: id });

    sendSuccess(res, { node: result.data });
  } catch (error) {
    requestLogger.error(
      'Error getting node by ID',
      error instanceof Error ? error : undefined,
      { id: req.params.id }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/nodes/name/:name - Get a node by name
 */
export async function getNodeByName(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    const { name } = req.params;

    if (!name) {
      sendError(res, 'VALIDATION_ERROR', 'Node name is required', 400);
      return;
    }

    const nodeQueries = getNodeQueries();
    const result = await nodeQueries.getNodeByName(name);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Node not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to get node', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Node not found', 404);
      return;
    }

    requestLogger.debug('Retrieved node by name', { nodeName: name });

    sendSuccess(res, { node: result.data });
  } catch (error) {
    requestLogger.error(
      'Error getting node by name',
      error instanceof Error ? error : undefined,
      { name: req.params.name }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * PATCH /api/nodes/:id - Update a node
 */
export async function updateNode(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to update a node', 401);
      return;
    }

    const { id } = req.params;

    // Validate UUID format
    if (!isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid node ID format', 400);
      return;
    }

    // Validate input
    const validationResult = validateUpdateNodeInput(req.body);
    if (!validationResult.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validationResult.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    const nodeQueries = getNodeQueries();

    // Check node exists
    const existingResult = await nodeQueries.getNodeById(id);
    if (existingResult.error) {
      if (existingResult.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Node not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to check node', 500);
      return;
    }

    if (!existingResult.data) {
      sendError(res, 'NOT_FOUND', 'Node not found', 404);
      return;
    }

    // Check ownership (only the registerer can update)
    if (existingResult.data.registeredBy && existingResult.data.registeredBy !== userId) {
      sendError(res, 'FORBIDDEN', 'You do not have permission to update this node', 403);
      return;
    }

    const input = req.body as UpdateNodeInput;
    const updateResult = await nodeQueries.updateNode(id, input);

    if (updateResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to update node', 500);
      return;
    }

    requestLogger.info('Node updated successfully', { nodeId: id });

    sendSuccess(res, { node: updateResult.data });
  } catch (error) {
    requestLogger.error(
      'Error updating node',
      error instanceof Error ? error : undefined,
      { id: req.params.id }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * DELETE /api/nodes/:id - Delete a node
 */
export async function deleteNode(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to delete a node', 401);
      return;
    }

    const { id } = req.params;

    // Validate UUID format
    if (!isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid node ID format', 400);
      return;
    }

    const nodeQueries = getNodeQueries();

    // Check node exists
    const existingResult = await nodeQueries.getNodeById(id);
    if (existingResult.error) {
      if (existingResult.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Node not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to check node', 500);
      return;
    }

    if (!existingResult.data) {
      sendError(res, 'NOT_FOUND', 'Node not found', 404);
      return;
    }

    // Check ownership (admins/operators can delete any node, others only their own)
    const isNodeManager = hasNodeManagementRole(req);
    if (!isNodeManager && existingResult.data.registeredBy && existingResult.data.registeredBy !== userId) {
      sendError(res, 'FORBIDDEN', 'You do not have permission to delete this node', 403);
      return;
    }

    // Delete all pods on this node before deleting the node
    const podQueries = getPodQueriesAdmin();
    const deletePodsResult = await podQueries.deletePodsOnNode(id);
    
    if (deletePodsResult.data && deletePodsResult.data.deletedCount > 0) {
      requestLogger.info('Deleted pods due to node deletion', {
        nodeId: id,
        nodeName: existingResult.data.name,
        deletedCount: deletePodsResult.data.deletedCount,
        podIds: deletePodsResult.data.podIds,
      });
    }

    const deleteResult = await nodeQueries.deleteNode(id);
    if (deleteResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete node', 500);
      return;
    }

    requestLogger.info('Node deleted successfully', { nodeId: id });

    sendSuccess(res, { deleted: true, deletedPodsCount: deletePodsResult.data?.deletedCount ?? 0 });
  } catch (error) {
    requestLogger.error(
      'Error deleting node',
      error instanceof Error ? error : undefined,
      { id: req.params.id }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * Create and configure the nodes router
 */
export function createNodesRouter(): Router {
  const router = Router();

  // POST /api/nodes - Register a new node (requires create permission - admin/operator only)
  router.post('/', authMiddleware, abilityMiddleware, canCreateNode, registerNode);

  // GET /api/nodes - List nodes (requires read permission)
  router.get('/', authMiddleware, abilityMiddleware, canReadNode, listNodes);

  // GET /api/nodes/:id - Get node by ID (requires read permission)
  router.get('/:id', authMiddleware, abilityMiddleware, canReadNode, getNodeById);

  // GET /api/nodes/name/:name - Get node by name (requires read permission)
  router.get('/name/:name', authMiddleware, abilityMiddleware, canReadNode, getNodeByName);

  // PATCH /api/nodes/:id - Update node (requires update permission)
  router.patch('/:id', authMiddleware, abilityMiddleware, canUpdateNode, updateNode);

  // DELETE /api/nodes/:id - Delete node (requires delete permission - admin/operator only)
  router.delete('/:id', authMiddleware, abilityMiddleware, canDeleteNode, deleteNode);

  return router;
}
