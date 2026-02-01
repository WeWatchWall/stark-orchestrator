/**
 * Central API Router
 *
 * Combines all REST API routes into a single router.
 * @module @stark-o/server/api/router
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { createPacksRouter } from './packs.js';
import { createPodsRouter } from './pods.js';
import { createNodesRouter } from './nodes.js';
import { createAuthRouter } from './auth.js';
import { createNamespacesRouter } from './namespaces.js';
import { createConfigRouter } from './config.js';
import { createDeploymentsRouter } from './deployments.js';
import { apiRateLimiter, authRateLimiter } from '../middleware/rate-limit-middleware.js';

/**
 * Logger for API router operations
 */
const logger = createServiceLogger(
  {
    level: 'debug',
    service: 'stark-orchestrator',
  },
  { component: 'api-router' }
);

/**
 * API router configuration options
 */
export interface ApiRouterOptions {
  /** Enable request logging */
  enableLogging?: boolean;
  /** API version prefix (default: 'v1') */
  apiVersion?: string;
  /** Enable rate limiting (default: true in production, false in test) */
  enableRateLimiting?: boolean;
}

/**
 * Health check response
 */
interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database?: { status: 'up' | 'down'; latency?: number };
    websocket?: { status: 'up' | 'down'; connections?: number };
  };
}

/**
 * Server start time for uptime calculation
 */
const startTime = Date.now();

/**
 * GET /health - Health check endpoint
 */
export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    // Basic health check - can be extended to check database, etc.
    const response: HealthCheckResponse = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
      uptime,
      checks: {
        database: { status: 'up' },
        websocket: { status: 'up' },
      },
    };

    requestLogger.debug('Health check performed', { status: response.status, uptime });
    res.status(200).json(response);
  } catch (error) {
    requestLogger.error('Health check failed', error instanceof Error ? error : undefined);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks: {},
    });
  }
}

/**
 * GET /ready - Readiness check endpoint
 */
export async function readinessCheck(_req: Request, res: Response): Promise<void> {
  // Check if server is ready to accept traffic
  // This can be extended to check database connections, etc.
  res.status(200).json({
    ready: true,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /live - Liveness check endpoint
 */
export async function livenessCheck(_req: Request, res: Response): Promise<void> {
  // Simple liveness check - if this responds, the server is alive
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Request logging middleware
 */
export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  const startTime = Date.now();

  // Attach correlation ID to request for downstream use
  (req as Request & { correlationId: string }).correlationId = correlationId;

  // Set correlation ID header in response
  res.setHeader('X-Correlation-ID', correlationId);

  const requestLogger = logger.withCorrelationId(correlationId);

  // Log request
  requestLogger.info('Incoming request', {
    method: req.method,
    path: req.path,
    query: req.query,
    userAgent: req.headers['user-agent'],
    ip: req.ip || req.socket.remoteAddress,
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logFn = res.statusCode >= 400 ? requestLogger.warn.bind(requestLogger) : requestLogger.info.bind(requestLogger);

    logFn('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
}

/**
 * Error handling middleware
 */
export function errorHandlingMiddleware(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = (req as Request & { correlationId?: string }).correlationId || generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  requestLogger.error('Unhandled error', err, {
    method: req.method,
    path: req.path,
  });

  // Don't leak error details in production
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'An internal error occurred' : err.message,
      ...(isProduction ? {} : { stack: err.stack }),
    },
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

/**
 * Create the central API router
 */
export function createApiRouter(options: ApiRouterOptions = {}): Router {
  const {
    enableLogging = true,
    apiVersion = 'v1',
    enableRateLimiting = process.env.NODE_ENV !== 'test',
  } = options;

  const router = Router();

  // Request logging middleware
  if (enableLogging) {
    router.use(requestLoggingMiddleware);
  }

  // Health check endpoints (no auth required, no rate limiting)
  router.get('/health', healthCheck);
  router.get('/ready', readinessCheck);
  router.get('/live', livenessCheck);

  // API routes
  const apiRouter = Router();

  // Apply rate limiting to API routes if enabled
  if (enableRateLimiting) {
    apiRouter.use(apiRateLimiter);
    logger.debug('Rate limiting enabled for API routes');
  }

  // Auth routes with stricter rate limiting (no /api prefix - directly at /auth)
  if (enableRateLimiting) {
    router.use('/auth', authRateLimiter, createAuthRouter());
  } else {
    router.use('/auth', createAuthRouter());
  }

  // Protected API routes
  apiRouter.use('/packs', createPacksRouter());
  apiRouter.use('/pods', createPodsRouter());
  apiRouter.use('/nodes', createNodesRouter());
  apiRouter.use('/namespaces', createNamespacesRouter());
  apiRouter.use('/deployments', createDeploymentsRouter());

  // Config route (public read, admin-only write)
  apiRouter.use('/config', createConfigRouter());

  // Mount API router at /api
  router.use('/api', apiRouter);

  // 404 handler for API routes
  router.use('/api/*', notFoundHandler);

  // Error handling middleware
  router.use(errorHandlingMiddleware);

  logger.info('API router initialized', {
    version: apiVersion,
    rateLimiting: enableRateLimiting,
    routes: ['/health', '/ready', '/live', '/auth/*', '/api/packs', '/api/pods', '/api/nodes', '/api/namespaces', '/api/deployments', '/api/config'],
  });

  return router;
}

/**
 * Default export for convenience
 */
export default createApiRouter;
