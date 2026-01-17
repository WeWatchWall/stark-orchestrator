/**
 * Config REST API Endpoints
 *
 * Provides REST endpoints for application configuration.
 * - GET /config - Get current configuration (public)
 * - PUT /config - Update configuration (admin only)
 *
 * @module @stark-o/server/api/config
 */

import { Router, Request, Response } from 'express';
import { createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { getAppConfig, updateAppConfig } from '../supabase/app-config.js';
import { verifyToken } from '../supabase/auth.js';

/**
 * Logger for config API operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'api-config' });

// ============================================================================
// Response Types
// ============================================================================

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

// ============================================================================
// Response Helpers
// ============================================================================

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

// ============================================================================
// Route Handlers
// ============================================================================

/**
 * GET /config - Get current application configuration
 * This endpoint is public (no authentication required)
 */
export async function getConfig(_req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Get config request received');

    const result = await getAppConfig();

    if (result.error) {
      requestLogger.error('Error getting config', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Failed to get configuration', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Configuration not found', 404);
      return;
    }

    sendSuccess(res, {
      enablePublicRegistration: result.data.enablePublicRegistration,
    }, 200);
  } catch (error) {
    requestLogger.error('Error getting config', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * PUT /config - Update application configuration (admin only)
 */
export async function putConfig(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Update config request received');

    // Extract and verify token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      sendError(res, 'UNAUTHORIZED', 'Missing or invalid authorization header', 401);
      return;
    }

    const accessToken = authHeader.substring(7);
    const tokenResult = await verifyToken(accessToken);

    if (tokenResult.error) {
      requestLogger.warn('Token verification failed', { error: tokenResult.error.message });
      sendError(res, 'UNAUTHORIZED', 'Invalid or expired token', 401);
      return;
    }

    if (!tokenResult.data) {
      sendError(res, 'UNAUTHORIZED', 'Invalid or expired token', 401);
      return;
    }

    const currentUser = tokenResult.data;

    // Check if user is admin
    if (!currentUser.roles.includes('admin')) {
      requestLogger.warn('Non-admin attempted to update config', { userId: currentUser.id });
      sendError(res, 'FORBIDDEN', 'Only administrators can update configuration', 403);
      return;
    }

    // Validate input
    const { enablePublicRegistration } = req.body as { enablePublicRegistration?: unknown };

    if (enablePublicRegistration !== undefined && typeof enablePublicRegistration !== 'boolean') {
      sendError(res, 'VALIDATION_ERROR', 'enablePublicRegistration must be a boolean', 400);
      return;
    }

    // Update config
    const result = await updateAppConfig({
      enablePublicRegistration: enablePublicRegistration as boolean | undefined,
    });

    if (result.error) {
      requestLogger.error('Error updating config', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Failed to update configuration', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'NOT_FOUND', 'Configuration not found', 404);
      return;
    }

    requestLogger.info('Config updated successfully', {
      userId: currentUser.id,
      enablePublicRegistration: result.data.enablePublicRegistration,
    });

    sendSuccess(res, {
      enablePublicRegistration: result.data.enablePublicRegistration,
      updatedAt: result.data.updatedAt.toISOString(),
    }, 200);
  } catch (error) {
    requestLogger.error('Error updating config', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

// ============================================================================
// Router
// ============================================================================

/**
 * Creates the config router with all endpoints
 */
export function createConfigRouter(): Router {
  const router = Router();

  router.get('/', getConfig);
  router.put('/', putConfig);

  return router;
}

// Default export for convenience
export default createConfigRouter;
