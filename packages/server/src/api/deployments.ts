/**
 * Deployment REST API Endpoints
 *
 * Provides REST endpoints for deployment creation, management, and status retrieval.
 * @module @stark-o/server/api/deployments
 */

import { Router, Request, Response } from 'express';
import type { DeploymentStatus, CreateDeploymentInput } from '@stark-o/shared';
import { validateCreateDeploymentInput, validateUpdateDeploymentInput, createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { getDeploymentQueriesAdmin, getDeploymentQueries } from '../supabase/deployments.js';
import { getPackQueries } from '../supabase/packs.js';
import {
  authMiddleware,
  abilityMiddleware,
  canCreatePod, // Reuse pod permissions for deployments
  canReadPod,
  canDeletePod,
  type AuthenticatedRequest,
} from '../middleware/index.js';

/**
 * Logger for deployment API operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'api-deployments' });

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
 * Create deployment handler
 */
async function createDeployment(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  requestLogger.info('Creating deployment', { correlationId, userId });

  try {
    const input = req.body as CreateDeploymentInput;

    // Validate input
    const validation = validateCreateDeploymentInput(input);
    if (!validation.valid) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid deployment input', 400, {
        errors: validation.errors,
      });
      return;
    }

    // Resolve pack ID from packId or packName
    const packQueries = getPackQueries();
    let packId = input.packId;
    let packVersion = input.packVersion;

    if (!packId && input.packName) {
      // Look up pack by name
      const packResult = await packQueries.getLatestPackVersion(input.packName);
      if (packResult.error || !packResult.data) {
        sendError(res, 'NOT_FOUND', `Pack '${input.packName}' not found`, 404);
        return;
      }
      packId = packResult.data.id;
      packVersion = packVersion ?? packResult.data.version;
    } else if (packId) {
      // Verify pack exists
      const packResult = await packQueries.getPackById(packId);
      if (packResult.error || !packResult.data) {
        sendError(res, 'NOT_FOUND', 'Pack not found', 404);
        return;
      }
      packVersion = packVersion ?? packResult.data.version;
    } else {
      sendError(res, 'VALIDATION_ERROR', 'Either packId or packName is required', 400);
      return;
    }

    // Create deployment
    const deploymentQueries = getDeploymentQueriesAdmin();
    const result = await deploymentQueries.createDeployment(
      input,
      packId,
      packVersion ?? 'latest',
      userId
    );

    if (result.error) {
      if (result.error.code === '23505') {
        // Unique constraint violation
        sendError(res, 'CONFLICT', `Deployment '${input.name}' already exists in namespace '${input.namespace ?? 'default'}'`, 409);
        return;
      }
      requestLogger.error('Failed to create deployment', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to create deployment', 500);
      return;
    }

    requestLogger.info('Deployment created', {
      deploymentId: result.data?.id,
      name: input.name,
      replicas: input.replicas ?? 1,
      correlationId,
    });

    sendSuccess(res, { deployment: result.data }, 201);
  } catch (error) {
    requestLogger.error('Unexpected error creating deployment', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * List deployments handler
 */
async function listDeployments(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  try {
    const { namespace, status, packId, page, pageSize } = req.query;

    const deploymentQueries = getDeploymentQueries();
    const result = await deploymentQueries.listDeployments({
      namespace: namespace as string | undefined,
      status: status as DeploymentStatus | undefined,
      packId: packId as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });

    if (result.error) {
      requestLogger.error('Failed to list deployments', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to list deployments', 500);
      return;
    }

    sendSuccess(res, { deployments: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error listing deployments', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Get deployment by ID handler
 */
async function getDeploymentById(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const { id } = req.params;

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid deployment ID', 400);
    return;
  }

  try {
    const deploymentQueries = getDeploymentQueries();
    const result = await deploymentQueries.getDeploymentById(id);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Deployment not found', 404);
        return;
      }
      requestLogger.error('Failed to get deployment', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get deployment', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Deployment not found', 404);
      return;
    }

    sendSuccess(res, { deployment: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error getting deployment', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Get deployment by name handler
 */
async function getDeploymentByName(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const { name } = req.params;
  const namespace = (req.query.namespace as string) ?? 'default';

  if (!name) {
    sendError(res, 'INVALID_NAME', 'Deployment name is required', 400);
    return;
  }

  try {
    const deploymentQueries = getDeploymentQueries();
    const result = await deploymentQueries.getDeploymentByName(name, namespace);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Deployment not found', 404);
        return;
      }
      requestLogger.error('Failed to get deployment', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get deployment', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Deployment not found', 404);
      return;
    }

    sendSuccess(res, { deployment: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error getting deployment', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Update deployment handler
 */
async function updateDeployment(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  const { id } = req.params;

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid deployment ID', 400);
    return;
  }

  try {
    const input = req.body;

    // Validate input
    const validation = validateUpdateDeploymentInput(input);
    if (!validation.valid) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid update input', 400, {
        errors: validation.errors,
      });
      return;
    }

    const deploymentQueries = getDeploymentQueriesAdmin();
    const result = await deploymentQueries.updateDeployment(id, input);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Deployment not found', 404);
        return;
      }
      requestLogger.error('Failed to update deployment', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to update deployment', 500);
      return;
    }

    requestLogger.info('Deployment updated', {
      deploymentId: id,
      correlationId,
    });

    sendSuccess(res, { deployment: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error updating deployment', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Scale deployment handler
 */
async function scaleDeployment(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  const { id } = req.params;
  const { replicas } = req.body;

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid deployment ID', 400);
    return;
  }

  if (typeof replicas !== 'number' || replicas < 0) {
    sendError(res, 'VALIDATION_ERROR', 'Replicas must be a non-negative number', 400);
    return;
  }

  try {
    const deploymentQueries = getDeploymentQueriesAdmin();
    const result = await deploymentQueries.updateDeployment(id, { replicas });

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Deployment not found', 404);
        return;
      }
      requestLogger.error('Failed to scale deployment', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to scale deployment', 500);
      return;
    }

    requestLogger.info('Deployment scaled', {
      deploymentId: id,
      replicas,
      correlationId,
    });

    sendSuccess(res, { deployment: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error scaling deployment', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Delete deployment handler
 */
async function deleteDeployment(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  const { id } = req.params;

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid deployment ID', 400);
    return;
  }

  try {
    const deploymentQueries = getDeploymentQueriesAdmin();

    // First mark as deleting
    await deploymentQueries.updateDeployment(id, { status: 'deleting' });

    // Then delete
    const result = await deploymentQueries.deleteDeployment(id);

    if (result.error) {
      requestLogger.error('Failed to delete deployment', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete deployment', 500);
      return;
    }

    requestLogger.info('Deployment deleted', {
      deploymentId: id,
      correlationId,
    });

    sendSuccess(res, { deleted: true });
  } catch (error) {
    requestLogger.error('Unexpected error deleting deployment', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Create and configure the deployments router
 */
export function createDeploymentsRouter(): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);
  router.use(abilityMiddleware);

  // Create deployment (POST /api/deployments)
  router.post('/', canCreatePod, createDeployment);

  // List deployments (GET /api/deployments)
  router.get('/', canReadPod, listDeployments);

  // Get deployment by ID (GET /api/deployments/:id)
  router.get('/:id', canReadPod, getDeploymentById);

  // Get deployment by name (GET /api/deployments/name/:name)
  router.get('/name/:name', canReadPod, getDeploymentByName);

  // Update deployment (PATCH /api/deployments/:id)
  router.patch('/:id', canCreatePod, updateDeployment);

  // Scale deployment (POST /api/deployments/:id/scale)
  router.post('/:id/scale', canCreatePod, scaleDeployment);

  // Delete deployment (DELETE /api/deployments/:id)
  router.delete('/:id', canDeletePod, deleteDeployment);

  return router;
}

/**
 * Default router instance
 */
export const deploymentsRouter = createDeploymentsRouter();
