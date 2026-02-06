/**
 * Service REST API Endpoints
 *
 * Provides REST endpoints for service creation, management, and status retrieval.
 * @module @stark-o/server/api/services
 */

import { Router, Request, Response } from 'express';
import type { ServiceStatus, CreateServiceInput } from '@stark-o/shared';
import { validateCreateServiceInput, validateUpdateServiceInput, createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { getServiceQueriesAdmin, getServiceQueries } from '../supabase/services.js';
import { getPackQueries } from '../supabase/packs.js';
import {
  authMiddleware,
  abilityMiddleware,
  canCreatePod, // Reuse pod permissions for services
  canReadPod,
  canDeletePod,
  type AuthenticatedRequest,
} from '../middleware/index.js';

/**
 * Logger for service API operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'api-services' });

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
 * Create service handler
 */
async function createService(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  requestLogger.info('Creating service', { correlationId, userId });

  try {
    const input = req.body as CreateServiceInput;

    // Validate input
    const validation = validateCreateServiceInput(input);
    if (!validation.valid) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid service input', 400, {
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

    // Create service
    const serviceQueries = getServiceQueriesAdmin();
    const result = await serviceQueries.createService(
      input,
      packId,
      packVersion ?? 'latest',
      userId
    );

    if (result.error) {
      if (result.error.code === '23505') {
        // Unique constraint violation
        sendError(res, 'CONFLICT', `Service '${input.name}' already exists in namespace '${input.namespace ?? 'default'}'`, 409);
        return;
      }
      requestLogger.error('Failed to create service', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to create service', 500);
      return;
    }

    requestLogger.info('Service created', {
      serviceId: result.data?.id,
      name: input.name,
      replicas: input.replicas ?? 1,
      correlationId,
    });

    sendSuccess(res, { service: result.data }, 201);
  } catch (error) {
    requestLogger.error('Unexpected error creating service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * List services handler
 */
async function listServices(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  try {
    const { namespace, status, packId, page, pageSize } = req.query;

    const serviceQueries = getServiceQueries();
    const result = await serviceQueries.listServices({
      namespace: namespace as string | undefined,
      status: status as ServiceStatus | undefined,
      packId: packId as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : undefined,
    });

    if (result.error) {
      requestLogger.error('Failed to list services', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to list services', 500);
      return;
    }

    sendSuccess(res, { services: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error listing services', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Get service by ID handler
 */
async function getServiceById(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const { id } = req.params;

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid service ID', 400);
    return;
  }

  try {
    const serviceQueries = getServiceQueries();
    const result = await serviceQueries.getServiceById(id);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Service not found', 404);
        return;
      }
      requestLogger.error('Failed to get service', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get service', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Service not found', 404);
      return;
    }

    sendSuccess(res, { service: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error getting service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Get service by name handler
 */
async function getServiceByName(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger;

  const { name } = req.params;
  const namespace = (req.query.namespace as string) ?? 'default';

  if (!name) {
    sendError(res, 'INVALID_NAME', 'Service name is required', 400);
    return;
  }

  try {
    const serviceQueries = getServiceQueries();
    const result = await serviceQueries.getServiceByName(name, namespace);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Service not found', 404);
        return;
      }
      requestLogger.error('Failed to get service', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to get service', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Service not found', 404);
      return;
    }

    sendSuccess(res, { service: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error getting service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Update service handler
 */
async function updateService(req: Request, res: Response): Promise<void> {
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
    sendError(res, 'INVALID_ID', 'Invalid service ID', 400);
    return;
  }

  try {
    const input = req.body;

    // Validate input
    const validation = validateUpdateServiceInput(input);
    if (!validation.valid) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid update input', 400, {
        errors: validation.errors,
      });
      return;
    }

    const serviceQueries = getServiceQueriesAdmin();
    const result = await serviceQueries.updateService(id, input);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Service not found', 404);
        return;
      }
      requestLogger.error('Failed to update service', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to update service', 500);
      return;
    }

    requestLogger.info('Service updated', {
      serviceId: id,
      correlationId,
    });

    sendSuccess(res, { service: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error updating service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Scale service handler
 */
async function scaleService(req: Request, res: Response): Promise<void> {
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
    sendError(res, 'INVALID_ID', 'Invalid service ID', 400);
    return;
  }

  if (typeof replicas !== 'number' || replicas < 0) {
    sendError(res, 'VALIDATION_ERROR', 'Replicas must be a non-negative number', 400);
    return;
  }

  try {
    const serviceQueries = getServiceQueriesAdmin();
    const result = await serviceQueries.updateService(id, { replicas });

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Service not found', 404);
        return;
      }
      requestLogger.error('Failed to scale service', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to scale service', 500);
      return;
    }

    requestLogger.info('Service scaled', {
      serviceId: id,
      replicas,
      correlationId,
    });

    sendSuccess(res, { service: result.data });
  } catch (error) {
    requestLogger.error('Unexpected error scaling service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Delete service handler
 */
async function deleteService(req: Request, res: Response): Promise<void> {
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
    sendError(res, 'INVALID_ID', 'Invalid service ID', 400);
    return;
  }

  try {
    const serviceQueries = getServiceQueriesAdmin();

    // First mark as deleting
    await serviceQueries.updateService(id, { status: 'deleting' });

    // Then delete
    const result = await serviceQueries.deleteService(id);

    if (result.error) {
      requestLogger.error('Failed to delete service', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete service', 500);
      return;
    }

    requestLogger.info('Service deleted', {
      serviceId: id,
      correlationId,
    });

    sendSuccess(res, { deleted: true });
  } catch (error) {
    requestLogger.error('Unexpected error deleting service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Create and configure the services router
 */
export function createServicesRouter(): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);
  router.use(abilityMiddleware);

  // Create service (POST /api/services)
  router.post('/', canCreatePod, createService);

  // List services (GET /api/services)
  router.get('/', canReadPod, listServices);

  // Get service by ID (GET /api/services/:id)
  router.get('/:id', canReadPod, getServiceById);

  // Get service by name (GET /api/services/name/:name)
  router.get('/name/:name', canReadPod, getServiceByName);

  // Update service (PATCH /api/services/:id)
  router.patch('/:id', canCreatePod, updateService);

  // Scale service (POST /api/services/:id/scale)
  router.post('/:id/scale', canCreatePod, scaleService);

  // Delete service (DELETE /api/services/:id)
  router.delete('/:id', canDeletePod, deleteService);

  return router;
}

/**
 * Default router instance
 */
export const servicesRouter = createServicesRouter();
