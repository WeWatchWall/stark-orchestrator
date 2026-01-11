/**
 * Namespace REST API Endpoints
 *
 * Provides REST endpoints for namespace CRUD operations.
 * @module @stark-o/server/api/namespaces
 */

import { Router, Request, Response } from 'express';
import type {
  CreateNamespaceInput,
  UpdateNamespaceInput,
  Namespace,
  NamespaceListItem,
  NamespacePhase,
} from '@stark-o/shared';
import {
  validateCreateNamespaceInput,
  validateUpdateNamespaceInput,
  isReservedNamespaceName,
  createServiceLogger,
  generateCorrelationId,
} from '@stark-o/shared';
import { getNamespaceQueries } from '../supabase/namespaces.js';
import {
  authMiddleware,
  abilityMiddleware,
  canCreateNamespace,
  canReadNamespace,
  canUpdateNamespace,
  canDeleteNamespace,
} from '../middleware/index.js';

/**
 * Logger for namespace API operations
 */
const logger = createServiceLogger(
  {
    level: 'debug',
    service: 'stark-orchestrator',
  },
  { component: 'api-namespaces' }
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
 * Namespace response (single namespace)
 */
interface NamespaceResponse {
  namespace: Namespace;
}

/**
 * Namespace list response (pagination)
 */
interface NamespaceListResponse {
  namespaces: NamespaceListItem[];
  total: number;
  page: number;
  pageSize: number;
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
function isValidUUID(id: string | undefined): id is string {
  return typeof id === 'string' && UUID_PATTERN.test(id);
}

/**
 * Extract user ID from request (middleware should set this)
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
 * POST /api/namespaces - Create a new namespace
 */
export async function createNamespaceHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Namespace creation attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to create a namespace', 401);
      return;
    }

    requestLogger.debug('Namespace creation request received', { userId });

    // Validate input
    const validationResult = validateCreateNamespaceInput(req.body);
    if (!validationResult.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validationResult.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      requestLogger.warn('Namespace creation validation failed', {
        errors: validationResult.errors,
      });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    const input = req.body as CreateNamespaceInput;

    // Check for reserved namespace names
    if (isReservedNamespaceName(input.name)) {
      requestLogger.info('Namespace creation rejected - reserved name', {
        name: input.name,
      });
      sendError(
        res,
        'RESERVED_NAME',
        `Namespace name '${input.name}' is reserved and cannot be created`,
        400
      );
      return;
    }

    // Check for duplicate namespace name
    const namespaceQueries = getNamespaceQueries();
    const existsResult = await namespaceQueries.namespaceExists(input.name);

    if (existsResult.error) {
      requestLogger.error('Failed to check namespace existence', undefined, {
        name: input.name,
        error: existsResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to check namespace existence', 500);
      return;
    }

    if (existsResult.data) {
      requestLogger.info('Namespace creation conflict - namespace already exists', {
        name: input.name,
      });
      sendError(res, 'CONFLICT', `Namespace ${input.name} already exists`, 409);
      return;
    }

    // Create namespace
    requestLogger.debug('Creating namespace record', { name: input.name });

    const createResult = await namespaceQueries.createNamespace({
      ...input,
      createdBy: userId,
    });

    if (createResult.error) {
      // Check for unique constraint violation
      if (createResult.error.code === '23505') {
        sendError(res, 'CONFLICT', `Namespace ${input.name} already exists`, 409);
        return;
      }
      requestLogger.error('Failed to create namespace', undefined, {
        name: input.name,
        error: createResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to create namespace', 500);
      return;
    }

    if (!createResult.data) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to create namespace', 500);
      return;
    }

    requestLogger.info('Namespace created successfully', {
      namespaceId: createResult.data.id,
      name: createResult.data.name,
      userId,
    });

    const response: NamespaceResponse = {
      namespace: createResult.data,
    };

    sendSuccess(res, response, 201);
  } catch (error) {
    requestLogger.error(
      'Error creating namespace',
      error instanceof Error ? error : undefined,
      { body: req.body }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/namespaces - List namespaces with pagination and filtering
 */
export async function listNamespacesHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const phase = req.query.phase as NamespacePhase | undefined;
    const search = req.query.search as string | undefined;

    // Validate phase if provided
    if (phase && !['active', 'terminating'].includes(phase)) {
      sendError(
        res,
        'VALIDATION_ERROR',
        'Invalid phase. Must be one of: active, terminating',
        400
      );
      return;
    }

    const namespaceQueries = getNamespaceQueries();

    // Get total count for pagination
    const countResult = await namespaceQueries.countNamespaces({
      phase,
      search,
    });

    if (countResult.error) {
      requestLogger.error('Failed to count namespaces', undefined, {
        error: countResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to count namespaces', 500);
      return;
    }

    // Get namespaces with offset
    const offset = (page - 1) * pageSize;
    const listResult = await namespaceQueries.listNamespaceItems({
      phase,
      search,
      limit: pageSize,
      offset,
    });

    if (listResult.error) {
      requestLogger.error('Failed to list namespaces', undefined, {
        error: listResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to list namespaces', 500);
      return;
    }

    const response: NamespaceListResponse = {
      namespaces: listResult.data ?? [],
      total: countResult.data ?? 0,
      page,
      pageSize,
    };

    requestLogger.debug('Namespaces listed successfully', {
      total: response.total,
      page,
      pageSize,
      count: response.namespaces.length,
    });

    sendSuccess(res, response);
  } catch (error) {
    requestLogger.error(
      'Error listing namespaces',
      error instanceof Error ? error : undefined,
      { query: req.query }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/namespaces/:id - Get namespace by ID
 */
export async function getNamespaceByIdHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid namespace ID format', 400);
      return;
    }

    const namespaceQueries = getNamespaceQueries();
    const result = await namespaceQueries.getNamespaceById(id);

    if (result.error) {
      // Check for not found error
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
        return;
      }
      requestLogger.error('Failed to get namespace by ID', undefined, {
        namespaceId: id,
        error: result.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get namespace', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
      return;
    }

    requestLogger.debug('Namespace retrieved by ID', {
      namespaceId: id,
      name: result.data.name,
    });

    const response: NamespaceResponse = {
      namespace: result.data,
    };

    sendSuccess(res, response);
  } catch (error) {
    requestLogger.error(
      'Error getting namespace by ID',
      error instanceof Error ? error : undefined,
      { id: req.params.id }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/namespaces/name/:name - Get namespace by name
 */
export async function getNamespaceByNameHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    const { name } = req.params;

    if (!name || typeof name !== 'string') {
      sendError(res, 'VALIDATION_ERROR', 'Namespace name is required', 400);
      return;
    }

    const namespaceQueries = getNamespaceQueries();
    const result = await namespaceQueries.getNamespaceByName(name);

    if (result.error) {
      // Check for not found error
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', `Namespace '${name}' not found`, 404);
        return;
      }
      requestLogger.error('Failed to get namespace by name', undefined, {
        name,
        error: result.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get namespace', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', `Namespace '${name}' not found`, 404);
      return;
    }

    requestLogger.debug('Namespace retrieved by name', {
      namespaceId: result.data.id,
      name: result.data.name,
    });

    const response: NamespaceResponse = {
      namespace: result.data,
    };

    sendSuccess(res, response);
  } catch (error) {
    requestLogger.error(
      'Error getting namespace by name',
      error instanceof Error ? error : undefined,
      { name: req.params.name }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * PUT /api/namespaces/:id - Update a namespace
 */
export async function updateNamespaceHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Namespace update attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to update a namespace', 401);
      return;
    }

    const { id } = req.params;

    if (!isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid namespace ID format', 400);
      return;
    }

    // Validate input
    const validationResult = validateUpdateNamespaceInput(req.body);
    if (!validationResult.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validationResult.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      requestLogger.warn('Namespace update validation failed', {
        namespaceId: id,
        errors: validationResult.errors,
      });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    const input = req.body as UpdateNamespaceInput;

    // Check namespace exists
    const namespaceQueries = getNamespaceQueries();
    const existsResult = await namespaceQueries.getNamespaceById(id);

    if (existsResult.error) {
      if (existsResult.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
        return;
      }
      requestLogger.error('Failed to check namespace existence', undefined, {
        namespaceId: id,
        error: existsResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to check namespace existence', 500);
      return;
    }

    if (!existsResult.data) {
      sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
      return;
    }

    // Check if namespace is terminating
    if (existsResult.data.phase === 'terminating') {
      sendError(
        res,
        'NAMESPACE_TERMINATING',
        `Namespace ${existsResult.data.name} is being deleted and cannot be updated`,
        409
      );
      return;
    }

    // Update namespace
    requestLogger.debug('Updating namespace', {
      namespaceId: id,
      name: existsResult.data.name,
    });

    const updateResult = await namespaceQueries.updateNamespace(id, input);

    if (updateResult.error) {
      requestLogger.error('Failed to update namespace', undefined, {
        namespaceId: id,
        error: updateResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to update namespace', 500);
      return;
    }

    if (!updateResult.data) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to update namespace', 500);
      return;
    }

    requestLogger.info('Namespace updated successfully', {
      namespaceId: id,
      name: updateResult.data.name,
      userId,
    });

    const response: NamespaceResponse = {
      namespace: updateResult.data,
    };

    sendSuccess(res, response);
  } catch (error) {
    requestLogger.error(
      'Error updating namespace',
      error instanceof Error ? error : undefined,
      { id: req.params.id, body: req.body }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * DELETE /api/namespaces/:id - Delete a namespace
 */
export async function deleteNamespaceHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Namespace deletion attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to delete a namespace', 401);
      return;
    }

    const { id } = req.params;

    if (!isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid namespace ID format', 400);
      return;
    }

    // Check namespace exists
    const namespaceQueries = getNamespaceQueries();
    const existsResult = await namespaceQueries.getNamespaceById(id);

    if (existsResult.error) {
      if (existsResult.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
        return;
      }
      requestLogger.error('Failed to check namespace existence', undefined, {
        namespaceId: id,
        error: existsResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to check namespace existence', 500);
      return;
    }

    if (!existsResult.data) {
      sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
      return;
    }

    // Check for reserved namespace names
    if (isReservedNamespaceName(existsResult.data.name)) {
      requestLogger.info('Namespace deletion rejected - reserved name', {
        namespaceId: id,
        name: existsResult.data.name,
      });
      sendError(
        res,
        'RESERVED_NAME',
        `Namespace '${existsResult.data.name}' is reserved and cannot be deleted`,
        400
      );
      return;
    }

    // Check if namespace has resources (pods)
    // Uses resourceUsage tracking from namespace store to determine if deletion should be immediate or deferred
    const hasResources = existsResult.data.resourceUsage.pods > 0;

    if (hasResources) {
      // Mark for termination instead of immediate deletion
      requestLogger.debug('Marking namespace for deletion', {
        namespaceId: id,
        name: existsResult.data.name,
        podCount: existsResult.data.resourceUsage.pods,
      });

      const markResult = await namespaceQueries.markForDeletion(id);

      if (markResult.error) {
        requestLogger.error('Failed to mark namespace for deletion', undefined, {
          namespaceId: id,
          error: markResult.error,
        });
        sendError(res, 'INTERNAL_ERROR', 'Failed to delete namespace', 500);
        return;
      }

      requestLogger.info('Namespace marked for deletion', {
        namespaceId: id,
        name: existsResult.data.name,
        userId,
        reason: 'has_resources',
      });

      sendSuccess(res, {
        message: `Namespace '${existsResult.data.name}' marked for deletion. Resources will be cleaned up.`,
        phase: 'terminating' as NamespacePhase,
      });
      return;
    }

    // Delete namespace immediately if empty
    requestLogger.debug('Deleting namespace', {
      namespaceId: id,
      name: existsResult.data.name,
    });

    const deleteResult = await namespaceQueries.deleteNamespace(id);

    if (deleteResult.error) {
      requestLogger.error('Failed to delete namespace', undefined, {
        namespaceId: id,
        error: deleteResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete namespace', 500);
      return;
    }

    requestLogger.info('Namespace deleted successfully', {
      namespaceId: id,
      name: existsResult.data.name,
      userId,
    });

    sendSuccess(res, {
      message: `Namespace '${existsResult.data.name}' deleted successfully`,
    }, 200);
  } catch (error) {
    requestLogger.error(
      'Error deleting namespace',
      error instanceof Error ? error : undefined,
      { id: req.params.id }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * DELETE /api/namespaces/name/:name - Delete a namespace by name
 */
export async function deleteNamespaceByNameHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Namespace deletion attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to delete a namespace', 401);
      return;
    }

    const { name } = req.params;

    if (!name || typeof name !== 'string') {
      sendError(res, 'VALIDATION_ERROR', 'Namespace name is required', 400);
      return;
    }

    // Check for reserved namespace names
    if (isReservedNamespaceName(name)) {
      requestLogger.info('Namespace deletion rejected - reserved name', { name });
      sendError(
        res,
        'RESERVED_NAME',
        `Namespace '${name}' is reserved and cannot be deleted`,
        400
      );
      return;
    }

    // Check namespace exists
    const namespaceQueries = getNamespaceQueries();
    const existsResult = await namespaceQueries.getNamespaceByName(name);

    if (existsResult.error) {
      if (existsResult.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', `Namespace '${name}' not found`, 404);
        return;
      }
      requestLogger.error('Failed to check namespace existence', undefined, {
        name,
        error: existsResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to check namespace existence', 500);
      return;
    }

    if (!existsResult.data) {
      sendError(res, 'NOT_FOUND', `Namespace '${name}' not found`, 404);
      return;
    }

    // Check if namespace has resources (pods)
    const hasResources = existsResult.data.resourceUsage.pods > 0;

    if (hasResources) {
      // Mark for termination instead of immediate deletion
      requestLogger.debug('Marking namespace for deletion', {
        namespaceId: existsResult.data.id,
        name: existsResult.data.name,
        podCount: existsResult.data.resourceUsage.pods,
      });

      const markResult = await namespaceQueries.markForDeletion(existsResult.data.id);

      if (markResult.error) {
        requestLogger.error('Failed to mark namespace for deletion', undefined, {
          name,
          error: markResult.error,
        });
        sendError(res, 'INTERNAL_ERROR', 'Failed to delete namespace', 500);
        return;
      }

      requestLogger.info('Namespace marked for deletion', {
        namespaceId: existsResult.data.id,
        name,
        userId,
        reason: 'has_resources',
      });

      sendSuccess(res, {
        message: `Namespace '${name}' marked for deletion. Resources will be cleaned up.`,
        phase: 'terminating' as NamespacePhase,
      });
      return;
    }

    // Delete namespace immediately if empty
    requestLogger.debug('Deleting namespace by name', { name });

    const deleteResult = await namespaceQueries.deleteNamespaceByName(name);

    if (deleteResult.error) {
      requestLogger.error('Failed to delete namespace', undefined, {
        name,
        error: deleteResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete namespace', 500);
      return;
    }

    requestLogger.info('Namespace deleted successfully', {
      name,
      userId,
    });

    sendSuccess(res, {
      message: `Namespace '${name}' deleted successfully`,
    }, 200);
  } catch (error) {
    requestLogger.error(
      'Error deleting namespace by name',
      error instanceof Error ? error : undefined,
      { name: req.params.name }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/namespaces/:id/quota - Get namespace quota info
 */
export async function getNamespaceQuotaHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid namespace ID format', 400);
      return;
    }

    // First get the namespace to get its name
    const namespaceQueries = getNamespaceQueries();
    const namespaceResult = await namespaceQueries.getNamespaceById(id);

    if (namespaceResult.error) {
      if (namespaceResult.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
        return;
      }
      requestLogger.error('Failed to get namespace', undefined, {
        namespaceId: id,
        error: namespaceResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get namespace', 500);
      return;
    }

    if (!namespaceResult.data) {
      sendError(res, 'NOT_FOUND', `Namespace ${id} not found`, 404);
      return;
    }

    const quotaResult = await namespaceQueries.getNamespaceQuotaInfo(namespaceResult.data.name);

    if (quotaResult.error) {
      requestLogger.error('Failed to get namespace quota info', undefined, {
        namespaceId: id,
        error: quotaResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get namespace quota info', 500);
      return;
    }

    requestLogger.debug('Namespace quota info retrieved', {
      namespaceId: id,
      name: namespaceResult.data.name,
      hasQuota: !!quotaResult.data?.resourceQuota,
    });

    sendSuccess(res, {
      name: namespaceResult.data.name,
      ...quotaResult.data,
    });
  } catch (error) {
    requestLogger.error(
      'Error getting namespace quota info',
      error instanceof Error ? error : undefined,
      { id: req.params.id }
    );
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * Creates the namespaces router with all endpoints
 */
export function createNamespacesRouter(): Router {
  const router = Router();

  // Apply auth and ability middleware to all routes
  router.use(authMiddleware);
  router.use(abilityMiddleware);

  // POST /api/namespaces - Create namespace
  router.post('/', canCreateNamespace, createNamespaceHandler);

  // GET /api/namespaces - List namespaces
  router.get('/', canReadNamespace, listNamespacesHandler);

  // GET /api/namespaces/name/:name - Get namespace by name
  router.get('/name/:name', canReadNamespace, getNamespaceByNameHandler);

  // GET /api/namespaces/:id - Get namespace by ID
  router.get('/:id', canReadNamespace, getNamespaceByIdHandler);

  // GET /api/namespaces/:id/quota - Get namespace quota info
  router.get('/:id/quota', canReadNamespace, getNamespaceQuotaHandler);

  // PUT /api/namespaces/:id - Update namespace
  router.put('/:id', canUpdateNamespace, updateNamespaceHandler);

  // DELETE /api/namespaces/:id - Delete namespace
  router.delete('/:id', canDeleteNamespace, deleteNamespaceHandler);

  // DELETE /api/namespaces/name/:name - Delete namespace by name
  router.delete('/name/:name', canDeleteNamespace, deleteNamespaceByNameHandler);

  return router;
}

// Export individual handlers for testing
export {
  createNamespaceHandler as createNamespace,
  listNamespacesHandler as listNamespaces,
  getNamespaceByIdHandler as getNamespaceById,
  getNamespaceByNameHandler as getNamespaceByName,
  updateNamespaceHandler as updateNamespace,
  deleteNamespaceHandler as deleteNamespace,
  deleteNamespaceByNameHandler as deleteNamespaceByName,
  getNamespaceQuotaHandler as getNamespaceQuota,
};
