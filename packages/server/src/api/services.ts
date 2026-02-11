/**
 * Service REST API Endpoints
 *
 * Provides REST endpoints for service creation, management, and status retrieval.
 * @module @stark-o/server/api/services
 */

import { Router, Request, Response } from 'express';
import type { ServiceStatus, CreateServiceInput, ServiceVisibility } from '@stark-o/shared';
import { validateCreateServiceInput, validateUpdateServiceInput, createServiceLogger, generateCorrelationId, VALID_SERVICE_VISIBILITY_VALUES } from '@stark-o/shared';
import { getServiceQueriesAdmin, getServiceQueries } from '../supabase/services.js';
import { getPackQueriesAdmin } from '../supabase/packs.js';
import { getIngressManager } from '../services/ingress-manager.js';
import { getServiceNetworkMetaStore } from '@stark-o/shared';
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
    const packQueries = getPackQueriesAdmin();
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
      ingressPort: input.ingressPort,
      correlationId,
    });

    // Open ingress listener if ingressPort is specified
    if (result.data && input.ingressPort) {
      try {
        const ingressManager = getIngressManager();
        await ingressManager.openIngress(result.data.id, result.data.name, input.ingressPort);
        requestLogger.info('Ingress opened for service', {
          serviceId: result.data.id,
          port: input.ingressPort,
        });
      } catch (ingressErr) {
        requestLogger.error('Failed to open ingress — service created but port not exposed',
          ingressErr instanceof Error ? ingressErr : undefined, {
          serviceId: result.data.id,
          port: input.ingressPort,
        });
      }
    }

    // Populate in-memory network metadata store
    if (result.data) {
      const metaStore = getServiceNetworkMetaStore();
      metaStore.set({
        serviceId: result.data.name,
        namespace: result.data.namespace,
        visibility: result.data.visibility ?? 'private',
        exposed: result.data.exposed ?? false,
        allowedSources: result.data.allowedSources ?? [],
      });
    }

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

    // Close ingress listener if the service has one
    try {
      const ingressManager = getIngressManager();
      await ingressManager.closeIngress(id);
    } catch (ingressErr) {
      requestLogger.warn('Error closing ingress during service deletion', {
        serviceId: id,
        error: ingressErr instanceof Error ? ingressErr.message : 'Unknown error',
      });
    }

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

// ── Network Policy Handlers: visibility, expose, allowedSources ─────────

/**
 * Set visibility for a service
 * POST /api/services/:id/visibility
 * Body: { visibility: 'public' | 'private' | 'system' }
 */
async function setVisibilityHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();

  const authReq = req as AuthenticatedRequest;
  if (!authReq.user?.id) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  const { id } = req.params;
  const { visibility } = req.body as { visibility?: string };

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid service ID', 400);
    return;
  }

  if (!visibility || !VALID_SERVICE_VISIBILITY_VALUES.includes(visibility as ServiceVisibility)) {
    sendError(res, 'VALIDATION_ERROR', `Visibility must be one of: ${VALID_SERVICE_VISIBILITY_VALUES.join(', ')}`, 400);
    return;
  }

  try {
    const serviceQueries = getServiceQueriesAdmin();
    const result = await serviceQueries.updateService(id, { visibility: visibility as ServiceVisibility });

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Service not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to update visibility', 500);
      return;
    }

    // Update in-memory network meta store
    const metaStore = getServiceNetworkMetaStore();
    const serviceName = result.data?.name ?? id;
    const serviceNamespace = result.data?.namespace ?? 'default';
    metaStore.setVisibility(serviceName, visibility as ServiceVisibility, serviceNamespace);

    logger.info('Service visibility updated', { serviceId: id, visibility, correlationId });
    sendSuccess(res, { service: result.data });
  } catch (error) {
    logger.error('Unexpected error setting visibility', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Expose a service (make reachable from ingress)
 * POST /api/services/:id/expose
 */
async function exposeHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();

  const authReq = req as AuthenticatedRequest;
  if (!authReq.user?.id) {
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
    const result = await serviceQueries.updateService(id, { exposed: true } as any);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Service not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to expose service', 500);
      return;
    }

    // Update in-memory network meta store
    const metaStore = getServiceNetworkMetaStore();
    const serviceName = result.data?.name ?? id;
    const serviceNamespace = result.data?.namespace ?? 'default';
    metaStore.setExposed(serviceName, true, serviceNamespace);

    logger.info('Service exposed', { serviceId: id, correlationId });
    sendSuccess(res, { service: result.data });
  } catch (error) {
    logger.error('Unexpected error exposing service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Unexpose a service (remove from ingress)
 * POST /api/services/:id/unexpose
 */
async function unexposeHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();

  const authReq = req as AuthenticatedRequest;
  if (!authReq.user?.id) {
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
    const result = await serviceQueries.updateService(id, { exposed: false } as any);

    if (result.error) {
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Service not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to unexpose service', 500);
      return;
    }

    // Update in-memory network meta store
    const metaStore = getServiceNetworkMetaStore();
    const serviceName = result.data?.name ?? id;
    const serviceNamespace = result.data?.namespace ?? 'default';
    metaStore.setExposed(serviceName, false, serviceNamespace);

    logger.info('Service unexposed', { serviceId: id, correlationId });
    sendSuccess(res, { service: result.data });
  } catch (error) {
    logger.error('Unexpected error unexposing service', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Add an allowed source for internal traffic
 * POST /api/services/:id/allow-source
 * Body: { sourceService: string }
 */
async function allowSourceHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();

  const authReq = req as AuthenticatedRequest;
  if (!authReq.user?.id) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  const { id } = req.params;
  const { sourceService } = req.body as { sourceService?: string };

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid service ID', 400);
    return;
  }

  if (!sourceService || typeof sourceService !== 'string') {
    sendError(res, 'VALIDATION_ERROR', 'sourceService is required', 400);
    return;
  }

  try {
    // First get the current service to read existing allowedSources
    const serviceQueries = getServiceQueriesAdmin();
    const getResult = await serviceQueries.getServiceById(id);

    if (getResult.error || !getResult.data) {
      sendError(res, 'NOT_FOUND', 'Service not found', 404);
      return;
    }

    const service = getResult.data;
    const currentSources: string[] = (service as any).allowedSources ?? [];
    if (!currentSources.includes(sourceService)) {
      currentSources.push(sourceService);
    }

    const result = await serviceQueries.updateService(id, { allowedSources: currentSources } as any);

    if (result.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to update allowed sources', 500);
      return;
    }

    // Update in-memory network meta store
    const metaStore = getServiceNetworkMetaStore();
    const serviceName = service.name;
    const serviceNamespace = service.namespace ?? 'default';
    metaStore.addAllowedSource(serviceName, sourceService, serviceNamespace);

    logger.info('Allowed source added', { serviceId: id, sourceService, correlationId });
    sendSuccess(res, { service: result.data });
  } catch (error) {
    logger.error('Unexpected error adding allowed source', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * Remove an allowed source for internal traffic
 * POST /api/services/:id/deny-source
 * Body: { sourceService: string }
 */
async function denySourceHandler(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();

  const authReq = req as AuthenticatedRequest;
  if (!authReq.user?.id) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  const { id } = req.params;
  const { sourceService } = req.body as { sourceService?: string };

  if (!id || !UUID_PATTERN.test(id)) {
    sendError(res, 'INVALID_ID', 'Invalid service ID', 400);
    return;
  }

  if (!sourceService || typeof sourceService !== 'string') {
    sendError(res, 'VALIDATION_ERROR', 'sourceService is required', 400);
    return;
  }

  try {
    const serviceQueries = getServiceQueriesAdmin();
    const getResult = await serviceQueries.getServiceById(id);

    if (getResult.error || !getResult.data) {
      sendError(res, 'NOT_FOUND', 'Service not found', 404);
      return;
    }

    const service = getResult.data;
    const currentSources: string[] = (service as any).allowedSources ?? [];
    const idx = currentSources.indexOf(sourceService);
    if (idx !== -1) {
      currentSources.splice(idx, 1);
    }

    const result = await serviceQueries.updateService(id, { allowedSources: currentSources } as any);

    if (result.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to update allowed sources', 500);
      return;
    }

    // Update in-memory network meta store
    const metaStore = getServiceNetworkMetaStore();
    const serviceName = service.name;
    const serviceNamespace = service.namespace ?? 'default';
    metaStore.removeAllowedSource(serviceName, sourceService, serviceNamespace);

    logger.info('Allowed source removed', { serviceId: id, sourceService, correlationId });
    sendSuccess(res, { service: result.data });
  } catch (error) {
    logger.error('Unexpected error removing allowed source', error instanceof Error ? error : undefined);
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

  // Network policy: visibility, expose/unexpose, allowed sources
  router.post('/:id/visibility', canCreatePod, setVisibilityHandler);
  router.post('/:id/expose', canCreatePod, exposeHandler);
  router.post('/:id/unexpose', canCreatePod, unexposeHandler);
  router.post('/:id/allow-source', canCreatePod, allowSourceHandler);
  router.post('/:id/deny-source', canCreatePod, denySourceHandler);

  // Delete service (DELETE /api/services/:id)
  router.delete('/:id', canDeletePod, deleteService);

  return router;
}

/**
 * Default router instance
 */
export const servicesRouter = createServicesRouter();
