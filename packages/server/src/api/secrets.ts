/**
 * Secrets REST API Endpoints
 *
 * Provides REST endpoints for secret lifecycle management.
 * Secret values are NEVER returned in API responses — only metadata.
 *
 * @module @stark-o/server/api/secrets
 */

import { Router, Request, Response } from 'express';
import type { SecretType, CreateSecretInput, UpdateSecretInput } from '@stark-o/shared';
import {
  validateCreateSecretInput,
  validateUpdateSecretInput,
  createServiceLogger,
  generateCorrelationId,
} from '@stark-o/shared';
import { getSecretQueries } from '../supabase/secrets.js';
import { encryptSecretData, initMasterKey } from '@stark-o/core';
import {
  authMiddleware,
  abilityMiddleware,
  canCreatePod,
  canReadPod,
  canDeletePod,
  type AuthenticatedRequest,
} from '../middleware/index.js';

/**
 * Logger for secrets API
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'api-secrets' });

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

// ── Handlers ────────────────────────────────────────────────────────────────

/**
 * POST /api/secrets — Create a new secret
 */
async function createSecret(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  logger.info('Creating secret', { correlationId, userId });

  try {
    const input = req.body as CreateSecretInput;

    // Validate input
    const validation = validateCreateSecretInput(input);
    if (!validation.valid) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid secret input', 400, {
        errors: validation.errors,
      });
      return;
    }

    const namespace = input.namespace ?? 'default';

    // Check uniqueness
    const queries = getSecretQueries();
    const exists = await queries.secretExists(input.name, namespace);
    if (exists) {
      sendError(res, 'CONFLICT', `Secret '${input.name}' already exists in namespace '${namespace}'`, 409);
      return;
    }

    // Encrypt data
    initMasterKey();
    const encrypted = encryptSecretData(input.data);

    // Persist to database
    const result = await queries.createSecret({
      name: input.name,
      namespace,
      type: input.type,
      encryptedData: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      injection: input.injection,
      createdBy: userId,
    });

    if (result.error) {
      logger.error('Failed to create secret', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to create secret', 500);
      return;
    }

    logger.info('Secret created', {
      secretId: result.data?.id,
      name: input.name,
      namespace,
      type: input.type,
      correlationId,
    });

    // Return metadata only — never return encrypted data
    sendSuccess(res, {
      secret: {
        id: result.data!.id,
        name: result.data!.name,
        namespace: result.data!.namespace,
        type: result.data!.type,
        injection: result.data!.injection,
        version: result.data!.version,
        createdAt: result.data!.createdAt,
      },
    }, 201);
  } catch (err) {
    logger.error('Error creating secret', err instanceof Error ? err : undefined, { correlationId });
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * GET /api/secrets — List secrets (metadata only)
 */
async function listSecrets(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  try {
    const namespace = req.query.namespace as string | undefined;
    const type = req.query.type as SecretType | undefined;

    const queries = getSecretQueries();
    const result = await queries.listSecrets({ namespace, type });

    if (result.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to list secrets', 500);
      return;
    }

    sendSuccess(res, { secrets: result.data ?? [] });
  } catch (err) {
    logger.error('Error listing secrets', err instanceof Error ? err : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * GET /api/secrets/name/:name — Get secret metadata by name
 */
async function getSecretByName(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  try {
    const name = req.params.name;
    if (!name) {
      sendError(res, 'VALIDATION_ERROR', 'Secret name is required', 400);
      return;
    }
    const namespace = (req.query.namespace as string) ?? 'default';

    const queries = getSecretQueries();
    const result = await queries.getSecretByName(name, namespace);

    if (result.error || !result.data) {
      sendError(res, 'NOT_FOUND', `Secret '${name}' not found in namespace '${namespace}'`, 404);
      return;
    }

    // Return metadata only
    const secret = result.data;
    sendSuccess(res, {
      secret: {
        id: secret.id,
        name: secret.name,
        namespace: secret.namespace,
        type: secret.type,
        injection: secret.injection,
        version: secret.version,
        createdBy: secret.createdBy,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      },
    });
  } catch (err) {
    logger.error('Error getting secret', err instanceof Error ? err : undefined);
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * PATCH /api/secrets/name/:name — Update a secret
 */
async function updateSecretByName(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  try {
    const name = req.params.name;
    if (!name) {
      sendError(res, 'VALIDATION_ERROR', 'Secret name is required', 400);
      return;
    }
    const namespace = (req.query.namespace as string) ?? (req.body.namespace as string) ?? 'default';

    const queries = getSecretQueries();

    // Find existing secret
    const existing = await queries.getSecretByName(name, namespace);
    if (existing.error || !existing.data) {
      sendError(res, 'NOT_FOUND', `Secret '${name}' not found in namespace '${namespace}'`, 404);
      return;
    }

    const input = req.body as UpdateSecretInput;

    // Validate update
    const validation = validateUpdateSecretInput(input, existing.data.type);
    if (!validation.valid) {
      sendError(res, 'VALIDATION_ERROR', 'Invalid update input', 400, {
        errors: validation.errors,
      });
      return;
    }

    // Build DB update
    const dbUpdate: Record<string, unknown> = {};

    if (input.data) {
      initMasterKey();
      const encrypted = encryptSecretData(input.data);
      dbUpdate.encryptedData = encrypted.ciphertext;
      dbUpdate.iv = encrypted.iv;
      dbUpdate.authTag = encrypted.authTag;
      dbUpdate.version = existing.data.version + 1;
    }

    if (input.injection) {
      dbUpdate.injection = input.injection;
    }

    const result = await queries.updateSecret(existing.data.id, dbUpdate);

    if (result.error) {
      logger.error('Failed to update secret', undefined, {
        error: result.error,
        correlationId,
      });
      sendError(res, 'INTERNAL_ERROR', 'Failed to update secret', 500);
      return;
    }

    logger.info('Secret updated', {
      secretId: existing.data.id,
      name,
      namespace,
      correlationId,
    });

    sendSuccess(res, {
      secret: {
        id: result.data!.id,
        name: result.data!.name,
        namespace: result.data!.namespace,
        type: result.data!.type,
        injection: result.data!.injection,
        version: result.data!.version,
        updatedAt: result.data!.updatedAt,
      },
    });
  } catch (err) {
    logger.error('Error updating secret', err instanceof Error ? err : undefined, { correlationId });
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

/**
 * DELETE /api/secrets/name/:name — Delete a secret
 */
async function deleteSecretByName(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;

  if (!userId) {
    sendError(res, 'UNAUTHORIZED', 'Authentication required', 401);
    return;
  }

  try {
    const name = req.params.name;
    if (!name) {
      sendError(res, 'VALIDATION_ERROR', 'Secret name is required', 400);
      return;
    }
    const namespace = (req.query.namespace as string) ?? 'default';

    const queries = getSecretQueries();
    const result = await queries.deleteSecretByName(name, namespace);

    if (result.error) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to delete secret', 500);
      return;
    }

    if (!result.data?.deleted) {
      sendError(res, 'NOT_FOUND', `Secret '${name}' not found in namespace '${namespace}'`, 404);
      return;
    }

    logger.info('Secret deleted', { name, namespace, correlationId });
    res.status(204).send();
  } catch (err) {
    logger.error('Error deleting secret', err instanceof Error ? err : undefined, { correlationId });
    sendError(res, 'INTERNAL_ERROR', 'Internal server error', 500);
  }
}

// ── Router ──────────────────────────────────────────────────────────────────

/**
 * Create the secrets router
 */
export function createSecretsRouter(): Router {
  const router = Router();

  // All routes require authentication
  router.use(authMiddleware);
  router.use(abilityMiddleware);

  // CRUD routes
  router.post('/', canCreatePod, createSecret);
  router.get('/', canReadPod, listSecrets);
  router.get('/name/:name', canReadPod, getSecretByName);
  router.patch('/name/:name', canCreatePod, updateSecretByName);
  router.delete('/name/:name', canDeletePod, deleteSecretByName);

  return router;
}

export default createSecretsRouter;
