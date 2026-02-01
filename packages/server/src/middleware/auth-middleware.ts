/**
 * Authentication Middleware
 *
 * JWT validation middleware for Express routes.
 * Validates Bearer tokens using Supabase Auth and attaches user to request.
 *
 * @module @stark-o/server/middleware/auth-middleware
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { User } from '@stark-o/shared';
import { createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { verifyToken } from '../supabase/auth.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Extended Express Request with authenticated user
 */
export interface AuthenticatedRequest extends Request {
  /** Authenticated user from JWT token */
  user: User;
  /** Access token used for authentication */
  accessToken: string;
  /** Correlation ID for request tracing */
  correlationId: string;
}

/**
 * API error response structure
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
 * Middleware options
 */
export interface AuthMiddlewareOptions {
  /** Custom header name for authorization (default: 'Authorization') */
  headerName?: string;
  /** Whether to skip authentication for OPTIONS requests (default: true) */
  skipOptionsRequests?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default header name for authorization
 */
const DEFAULT_HEADER_NAME = 'authorization';

/**
 * Bearer token prefix
 */
const BEARER_PREFIX = 'Bearer ';

/**
 * Logger for auth middleware
 */
const logger = createServiceLogger(
  {
    level: 'debug',
    service: 'stark-orchestrator',
  },
  { component: 'auth-middleware' }
);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts the Bearer token from the Authorization header
 * @param authHeader - The Authorization header value
 * @returns The token or null if not valid
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  if (!authHeader.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = authHeader.slice(BEARER_PREFIX.length).trim();

  if (token.length === 0) {
    return null;
  }

  return token;
}

/**
 * Sends a 401 Unauthorized response
 */
function sendUnauthorized(
  res: Response,
  code: string,
  message: string,
  correlationId: string
): void {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      details: { correlationId },
    },
  };
  res.status(401).json(response);
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Creates an authentication middleware that validates JWT tokens
 *
 * @param options - Middleware options
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * import { createAuthMiddleware, AuthenticatedRequest } from './middleware/auth-middleware';
 *
 * const authMiddleware = createAuthMiddleware();
 *
 * router.get('/protected', authMiddleware, (req, res) => {
 *   const { user } = req as AuthenticatedRequest;
 *   res.json({ message: `Hello, ${user.displayName}` });
 * });
 * ```
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions = {}): RequestHandler {
  const {
    headerName = DEFAULT_HEADER_NAME,
    skipOptionsRequests = true,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Generate correlation ID for request tracing
    const correlationId = (req.headers['x-correlation-id'] as string) ?? generateCorrelationId();

    // Skip OPTIONS requests if configured (for CORS preflight)
    if (skipOptionsRequests && req.method === 'OPTIONS') {
      next();
      return;
    }

    // Extract Authorization header
    const authHeader = req.headers[headerName.toLowerCase()] as string | undefined;

    // Extract Bearer token
    const token = extractBearerToken(authHeader);

    if (!token) {
      logger.debug('No Bearer token found in request', {
        correlationId,
        method: req.method,
        path: req.path,
        hasAuthHeader: !!authHeader,
      });

      sendUnauthorized(
        res,
        'AUTHENTICATION_REQUIRED',
        'Authentication required. Please provide a valid Bearer token in the Authorization header.',
        correlationId
      );
      return;
    }

    // Verify the token with Supabase Auth
    try {
      const result = await verifyToken(token);

      if (result.error) {
        logger.debug('Token verification failed', {
          correlationId,
          errorCode: result.error.code,
          errorMessage: result.error.message,
        });

        // Map error codes to appropriate responses
        let code: string;
        let message: string;

        switch (result.error.code) {
          case 'TOKEN_EXPIRED':
            code = 'TOKEN_EXPIRED';
            message = 'Token has expired. Please login again.';
            break;
          case 'TOKEN_INVALID':
            code = 'TOKEN_INVALID';
            message = 'Invalid token. Please provide a valid token.';
            break;
          case 'USER_NOT_FOUND':
            code = 'USER_NOT_FOUND';
            message = 'User associated with this token no longer exists.';
            break;
          default:
            code = 'AUTHENTICATION_FAILED';
            message = result.error.message || 'Authentication failed.';
        }

        sendUnauthorized(res, code, message, correlationId);
        return;
      }

      if (!result.data) {
        logger.error('Token verification returned no data and no error', {
          correlationId,
        });

        sendUnauthorized(
          res,
          'AUTHENTICATION_FAILED',
          'Authentication failed. Please try again.',
          correlationId
        );
        return;
      }

      // Attach user and token to request
      const authenticatedReq = req as AuthenticatedRequest;
      authenticatedReq.user = result.data;
      authenticatedReq.accessToken = token;
      authenticatedReq.correlationId = correlationId;

      logger.debug('Authentication successful', {
        correlationId,
        userId: result.data.id,
        email: result.data.email,
        roles: result.data.roles,
      });

      next();
    } catch (error) {
      logger.error('Unexpected error during token verification', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      sendUnauthorized(
        res,
        'AUTHENTICATION_FAILED',
        'An unexpected error occurred during authentication.',
        correlationId
      );
    }
  };
}

/**
 * Optional authentication middleware - proceeds even without valid token
 *
 * Useful for routes that have different behavior for authenticated vs anonymous users.
 *
 * @param options - Middleware options
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * router.get('/public', optionalAuthMiddleware(), (req, res) => {
 *   const user = (req as Partial<AuthenticatedRequest>).user;
 *   if (user) {
 *     res.json({ message: `Hello, ${user.displayName}` });
 *   } else {
 *     res.json({ message: 'Hello, guest!' });
 *   }
 * });
 * ```
 */
export function createOptionalAuthMiddleware(options: AuthMiddlewareOptions = {}): RequestHandler {
  const {
    headerName = DEFAULT_HEADER_NAME,
  } = options;

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Generate correlation ID for request tracing
    const correlationId = (req.headers['x-correlation-id'] as string) ?? generateCorrelationId();

    // Always attach correlation ID
    (req as AuthenticatedRequest).correlationId = correlationId;

    // Extract Authorization header
    const authHeader = req.headers[headerName.toLowerCase()] as string | undefined;

    // Extract Bearer token
    const token = extractBearerToken(authHeader);

    if (!token) {
      // No token - proceed as anonymous
      next();
      return;
    }

    // Verify the token with Supabase Auth
    try {
      const result = await verifyToken(token);

      if (result.error || !result.data) {
        // Token invalid - proceed as anonymous (don't block)
        logger.debug('Optional auth: token invalid, proceeding as anonymous', {
          correlationId,
          errorCode: result.error?.code,
        });
        next();
        return;
      }

      // Attach user and token to request
      const authenticatedReq = req as AuthenticatedRequest;
      authenticatedReq.user = result.data;
      authenticatedReq.accessToken = token;

      logger.debug('Optional auth: authenticated', {
        correlationId,
        userId: result.data.id,
      });

      next();
    } catch (error) {
      // Error during verification - proceed as anonymous
      logger.debug('Optional auth: error during verification, proceeding as anonymous', {
        correlationId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      next();
    }
  };
}

/**
 * Type guard to check if request is authenticated
 */
export function isAuthenticated(req: Request): req is AuthenticatedRequest {
  return 'user' in req && (req as AuthenticatedRequest).user !== undefined;
}

/**
 * Default auth middleware instance with standard configuration
 */
export const authMiddleware: RequestHandler = createAuthMiddleware();

/**
 * Default optional auth middleware instance
 */
export const optionalAuthMiddleware: RequestHandler = createOptionalAuthMiddleware();
