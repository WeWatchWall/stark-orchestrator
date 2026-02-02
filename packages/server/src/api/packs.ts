/**
 * Pack REST API Endpoints
 *
 * Provides REST endpoints for pack registration and management.
 * @module @stark-o/server/api/packs
 */

import { Router, Request, Response } from 'express';
import type { RuntimeTag, RegisterPackInput, UpdatePackInput, PackVisibility } from '@stark-o/shared';
import { validateRegisterPackInput, validateUpdatePackInput, createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { getPackQueries, getPackQueriesAdmin } from '../supabase/packs.js';
import {
  authMiddleware,
  abilityMiddleware,
  canCreatePack,
  canReadPack,
  canUpdatePack,
  canDeletePack,
} from '../middleware/index.js';

/**
 * Logger for pack API operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'api-packs' });

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
 * Pack registration response
 */
interface RegisterPackResponse {
  pack: {
    id: string;
    name: string;
    version: string;
    runtimeTag: RuntimeTag;
    ownerId: string;
    visibility: PackVisibility;
    bundlePath: string;
    description?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  };
  uploadUrl: string;
}

/**
 * Pack list response
 */
interface PackListResponse {
  packs: Array<{
    id: string;
    name: string;
    version: string;
    runtimeTag: RuntimeTag;
    ownerId: string;
    visibility: PackVisibility;
    bundlePath: string;
    description?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Pack by ID response
 */
interface PackByIdResponse {
  pack: {
    id: string;
    name: string;
    version: string;
    runtimeTag: RuntimeTag;
    ownerId: string;
    visibility: PackVisibility;
    bundlePath: string;
    description?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
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
 * Validates UUID format
 */
function isValidUUID(id: string): boolean {
  return UUID_PATTERN.test(id);
}

/**
 * Generate a signed upload URL for pack bundle
 * TODO: Replace with actual Supabase Storage signed URL generation (T064)
 */
function generateUploadUrl(packName: string, version: string): string {
  // Placeholder - will be replaced with Supabase Storage signed URL
  return `https://storage.supabase.co/v1/object/sign/packs/${packName}/${version}/bundle.js`;
}

/**
 * Generate bundle path for storage
 */
function generateBundlePath(packName: string, version: string): string {
  return `packs/${packName}/${version}/bundle.js`;
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
 * POST /api/packs - Register a new pack
 */
async function registerPack(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      requestLogger.warn('Pack registration attempted without authentication');
      sendError(res, 'AUTHENTICATION_REQUIRED', 'Authentication required to register a pack', 401);
      return;
    }

    requestLogger.debug('Pack registration request received', { userId });

    // Validate input
    const validationResult = validateRegisterPackInput(req.body);
    if (!validationResult.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validationResult.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      requestLogger.warn('Pack registration validation failed', { errors: validationResult.errors });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    const input = req.body as RegisterPackInput;

    // Check for duplicate pack name+version
    // Use regular client for reads, admin client for writes (since we've already verified permissions via RBAC middleware)
    const packQueries = getPackQueries();
    const packQueriesAdmin = getPackQueriesAdmin();
    const existsResult = await packQueries.packExists(input.name, input.version);
    
    if (existsResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to check pack existence', 500);
      return;
    }

    if (existsResult.data) {
      requestLogger.info('Pack registration conflict - pack already exists', { 
        name: input.name, 
        version: input.version 
      });
      sendError(
        res,
        'CONFLICT',
        `Pack ${input.name}@${input.version} already exists`,
        409
      );
      return;
    }

    // Generate bundle path and create pack
    const bundlePath = generateBundlePath(input.name, input.version);
    requestLogger.debug('Creating pack record', { name: input.name, version: input.version, bundlePath });
    
    const createResult = await packQueriesAdmin.createPack({
      ...input,
      ownerId: userId,
      bundlePath,
    });

    if (createResult.error) {
      // Check for unique constraint violation
      if (createResult.error.code === '23505') {
        sendError(
          res,
          'CONFLICT',
          `Pack ${input.name}@${input.version} already exists`,
          409
        );
        return;
      }
      requestLogger.error(`Failed to create pack in database: ${createResult.error.message} (code: ${createResult.error.code})`, undefined, {
        errorCode: createResult.error.code,
        errorMessage: createResult.error.message,
        errorDetails: createResult.error.details,
        errorHint: createResult.error.hint,
        name: input.name,
        version: input.version,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to create pack', 500);
      return;
    }

    if (!createResult.data) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to create pack', 500);
      return;
    }

    // Generate upload URL
    const uploadUrl = generateUploadUrl(input.name, input.version);

    const response: RegisterPackResponse = {
      pack: {
        id: createResult.data.id,
        name: createResult.data.name,
        version: createResult.data.version,
        runtimeTag: createResult.data.runtimeTag,
        ownerId: createResult.data.ownerId,
        visibility: createResult.data.visibility,
        bundlePath: createResult.data.bundlePath,
        description: createResult.data.description,
        metadata: createResult.data.metadata,
        createdAt: createResult.data.createdAt,
        updatedAt: createResult.data.updatedAt,
      },
      uploadUrl,
    };

    requestLogger.info('Pack registered successfully', {
      packId: createResult.data.id,
      name: createResult.data.name,
      version: createResult.data.version,
      runtimeTag: createResult.data.runtimeTag,
      userId,
    });

    sendSuccess(res, response, 201);
  } catch (error) {
    requestLogger.error('Error registering pack', error instanceof Error ? error : undefined, {
      body: req.body,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/packs - List packs with pagination and filtering
 */
async function listPacks(req: Request, res: Response): Promise<void> {
  try {
    // Parse query parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const runtimeTag = req.query.runtimeTag as RuntimeTag | undefined;
    const search = req.query.search as string | undefined;
    const ownerId = req.query.ownerId as string | undefined;

    // Validate runtime tag if provided
    if (runtimeTag && !['node', 'browser', 'universal'].includes(runtimeTag)) {
      sendError(
        res,
        'VALIDATION_ERROR',
        'Invalid runtime tag. Must be one of: node, browser, universal',
        400
      );
      return;
    }

    const packQueries = getPackQueries();

    // Get total count for pagination
    const countResult = await packQueries.countPacks({
      ownerId,
      runtimeTag,
      name: search,
    });

    if (countResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to count packs', 500);
      return;
    }

    // Get packs with offset
    const offset = (page - 1) * pageSize;
    const listResult = await packQueries.listPacks({
      ownerId,
      runtimeTag,
      search,
      limit: pageSize,
      offset,
    });

    if (listResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to list packs', 500);
      return;
    }

    // Map list items to full pack objects (need to fetch details)
    // For now, return the list items as-is
    const packs = (listResult.data || []).map((item) => ({
      id: item.id,
      name: item.name,
      version: item.latestVersion,
      runtimeTag: item.runtimeTag,
      ownerId: item.ownerId,
      visibility: 'private' as PackVisibility, // List items don't have visibility, default to private
      bundlePath: `packs/${item.name}/${item.latestVersion}/bundle.js`,
      description: item.description,
      metadata: {},
      createdAt: item.createdAt,
      updatedAt: item.createdAt, // List items don't have updatedAt
    }));

    const response: PackListResponse = {
      packs,
      total: countResult.data ?? 0,
      page,
      pageSize,
    };

    logger.debug('Packs listed', { total: response.total, page, pageSize });
    sendSuccess(res, response);
  } catch (error) {
    logger.error('Error listing packs', error instanceof Error ? error : undefined, {
      query: req.query,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/packs/:id - Get pack by ID
 */
async function getPackById(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pack ID format', 400);
      return;
    }

    const packQueries = getPackQueries();
    const result = await packQueries.getPackById(id);

    if (result.error) {
      // Check for not found error
      if (result.error.code === 'PGRST116') {
        sendError(res, 'NOT_FOUND', 'Pack not found', 404);
        return;
      }
      sendError(res, 'INTERNAL_ERROR', 'Failed to get pack', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Pack not found', 404);
      return;
    }

    const response: PackByIdResponse = {
      pack: {
        id: result.data.id,
        name: result.data.name,
        version: result.data.version,
        runtimeTag: result.data.runtimeTag,
        ownerId: result.data.ownerId,
        visibility: result.data.visibility,
        bundlePath: result.data.bundlePath,
        description: result.data.description,
        metadata: result.data.metadata,
        createdAt: result.data.createdAt,
        updatedAt: result.data.updatedAt,
      },
    };

    logger.debug('Pack retrieved', { packId: id });
    sendSuccess(res, response);
  } catch (error) {
    logger.error('Error getting pack', error instanceof Error ? error : undefined, {
      packId: req.params.id,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /api/packs/:name/versions - List all versions of a pack
 */
async function listPackVersions(req: Request, res: Response): Promise<void> {
  try {
    const name = req.params.name;

    if (!name) {
      sendError(res, 'VALIDATION_ERROR', 'Pack name is required', 400);
      return;
    }

    const packQueries = getPackQueries();
    const result = await packQueries.listPackVersions(name);

    if (result.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to list pack versions', 500);
      return;
    }

    const versions = result.data || [];

    if (versions.length === 0) {
      logger.debug('Pack not found when listing versions', { name });
      sendError(res, 'NOT_FOUND', `Pack '${name}' not found`, 404);
      return;
    }

    logger.debug('Pack versions listed', { name, versionCount: versions.length });
    sendSuccess(res, { versions });
  } catch (error) {
    logger.error('Error listing pack versions', error instanceof Error ? error : undefined, {
      name: req.params.name,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * PATCH /api/packs/:id - Update pack metadata
 */
async function updatePack(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;

    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
      return;
    }

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pack ID format', 400);
      return;
    }

    // Validate input
    const validationResult = validateUpdatePackInput(req.body);
    if (!validationResult.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validationResult.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, details);
      return;
    }

    const input = req.body as UpdatePackInput;
    const packQueries = getPackQueries();
    const packQueriesAdmin = getPackQueriesAdmin();

    // Check pack exists and user owns it
    const existingResult = await packQueries.getPackById(id);
    if (existingResult.error || !existingResult.data) {
      sendError(res, 'NOT_FOUND', 'Pack not found', 404);
      return;
    }

    if (existingResult.data.ownerId !== userId) {
      sendError(res, 'FORBIDDEN', 'You do not have permission to update this pack', 403);
      return;
    }

    // Update pack
    const updateResult = await packQueriesAdmin.updatePack(id, input);

    if (updateResult.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to update pack', 500);
      return;
    }

    if (!updateResult.data) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to update pack', 500);
      return;
    }

    logger.info('Pack updated successfully', {
      packId: id,
      userId,
      updatedFields: Object.keys(input),
    });
    sendSuccess(res, { pack: updateResult.data });
  } catch (error) {
    logger.error('Error updating pack', error instanceof Error ? error : undefined, {
      packId: req.params.id,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * DELETE /api/packs/:id - Delete a pack
 */
async function deletePack(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id;

    // Check authentication
    const userId = getUserId(req);
    if (!userId) {
      sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
      return;
    }

    // Validate id is present and UUID format
    if (!id || !isValidUUID(id)) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid pack ID format', 400);
      return;
    }

    const packQueries = getPackQueries();
    const packQueriesAdmin = getPackQueriesAdmin();

    // Check pack exists and user owns it
    const existingResult = await packQueries.getPackById(id);
    if (existingResult.error || !existingResult.data) {
      sendError(res, 'NOT_FOUND', 'Pack not found', 404);
      return;
    }

    if (existingResult.data.ownerId !== userId) {
      sendError(res, 'FORBIDDEN', 'You do not have permission to delete this pack', 403);
      return;
    }

    // Delete pack
    const deleteResult = await packQueriesAdmin.deletePack(id);

    if (deleteResult.error) {
      logger.error('Failed to delete pack from database', undefined, {
        packId: id,
        error: deleteResult.error,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete pack', 500);
      return;
    }

    logger.info('Pack deleted successfully', { packId: id, userId });
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting pack', error instanceof Error ? error : undefined, {
      packId: req.params.id,
    });
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * Creates the packs router
 */
export function createPacksRouter(): Router {
  const router = Router();

  // POST /api/packs - Register a new pack (requires create permission)
  router.post('/', authMiddleware, abilityMiddleware, canCreatePack, registerPack);

  // GET /api/packs - List packs (requires read permission)
  router.get('/', authMiddleware, abilityMiddleware, canReadPack, listPacks);

  // GET /api/packs/:id - Get pack by ID (requires read permission)
  router.get('/:id([0-9a-f-]{36})', authMiddleware, abilityMiddleware, canReadPack, getPackById);

  // GET /api/packs/:name/versions - List pack versions (requires read permission)
  router.get('/:name/versions', authMiddleware, abilityMiddleware, canReadPack, listPackVersions);

  // PATCH /api/packs/:id - Update pack (requires update permission)
  router.patch('/:id([0-9a-f-]{36})', authMiddleware, abilityMiddleware, canUpdatePack, updatePack);

  // DELETE /api/packs/:id - Delete pack (requires delete permission)
  router.delete('/:id([0-9a-f-]{36})', authMiddleware, abilityMiddleware, canDeletePack, deletePack);

  return router;
}

// Export the router factory
export default createPacksRouter;

// Export individual handlers for testing
export {
  registerPack,
  listPacks,
  getPackById,
  listPackVersions,
  updatePack,
  deletePack,
};
