/**
 * Rate Limiting Middleware
 *
 * Protects the API from abuse by limiting request rates per client.
 * Uses express-rate-limit with configurable windows and limits.
 *
 * @module @stark-o/server/middleware/rate-limit-middleware
 */

import { RequestHandler, Request, Response } from 'express';
import rateLimit, { RateLimitRequestHandler, Options, ipKeyGenerator } from 'express-rate-limit';
import { createServiceLogger } from '@stark-o/shared';

/**
 * Logger for rate limiting operations
 */
const logger = createServiceLogger(
  {
    level: 'info',
    service: 'stark-orchestrator',
  },
  { component: 'rate-limit' }
);

/**
 * Rate limit configuration options
 */
export interface RateLimitConfig {
  /** Window duration in milliseconds (default: 15 minutes) */
  windowMs?: number;
  /** Maximum requests per window (default: 100) */
  max?: number;
  /** Message to send when rate limit is exceeded */
  message?: string;
  /** Whether to skip successful requests in count (default: false) */
  skipSuccessfulRequests?: boolean;
  /** Whether to skip failed requests in count (default: false) */
  skipFailedRequests?: boolean;
  /** Whether to add rate limit headers to response (default: true) */
  standardHeaders?: boolean;
  /** Whether to include legacy X-RateLimit headers (default: false) */
  legacyHeaders?: boolean;
  /** Key generator function for identifying clients */
  keyGenerator?: (req: Request) => string;
  /** Handler for rate limit exceeded */
  handler?: (req: Request, res: Response) => void;
  /** Skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
}

/**
 * Default rate limit configuration
 */
const DEFAULT_CONFIG: Required<
  Pick<RateLimitConfig, 'windowMs' | 'max' | 'message' | 'standardHeaders' | 'legacyHeaders'>
> = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
};

/**
 * Generate a client key from the request
 * Uses IP address as the default identifier with IPv6 normalization
 */
function defaultKeyGenerator(req: Request): string {
  // Try various headers for client IP (for proxied requests)
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string') {
    // Take the first IP in the chain and normalize for IPv6
    const ip = forwardedFor.split(',')[0]!.trim();
    return ipKeyGenerator(ip) ?? ip;
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return ipKeyGenerator(realIp) ?? realIp;
  }

  // Fall back to socket remote address with IPv6 normalization
  const fallbackIp = req.ip || req.socket.remoteAddress || 'unknown';
  return ipKeyGenerator(fallbackIp) ?? fallbackIp;
}

/**
 * Default handler for rate limit exceeded
 */
function defaultHandler(req: Request, res: Response): void {
  const correlationId = (req as Request & { correlationId?: string }).correlationId;
  const clientKey = defaultKeyGenerator(req);

  logger.warn('Rate limit exceeded', {
    correlationId,
    ip: clientKey,
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'],
  });

  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: DEFAULT_CONFIG.message,
      retryAfter: res.getHeader('Retry-After'),
    },
  });
}

/**
 * Create a rate limiting middleware with the given configuration
 */
export function createRateLimitMiddleware(config: RateLimitConfig = {}): RateLimitRequestHandler {
  const finalConfig: Partial<Options> = {
    windowMs: config.windowMs ?? DEFAULT_CONFIG.windowMs,
    limit: config.max ?? DEFAULT_CONFIG.max,
    message: config.message ?? DEFAULT_CONFIG.message,
    standardHeaders: config.standardHeaders ?? DEFAULT_CONFIG.standardHeaders,
    legacyHeaders: config.legacyHeaders ?? DEFAULT_CONFIG.legacyHeaders,
    keyGenerator: config.keyGenerator ?? defaultKeyGenerator,
    handler: config.handler ?? defaultHandler,
    ...(config.skip !== undefined && { skip: config.skip }),
    ...(config.skipSuccessfulRequests !== undefined && { skipSuccessfulRequests: config.skipSuccessfulRequests }),
    ...(config.skipFailedRequests !== undefined && { skipFailedRequests: config.skipFailedRequests }),
  };

  logger.info('Rate limit middleware configured', {
    windowMs: finalConfig.windowMs,
    max: finalConfig.limit,
  });

  return rateLimit(finalConfig);
}

/**
 * Pre-configured rate limiters for different use cases
 */

/**
 * Standard API rate limiter
 * 100 requests per 15 minutes
 */
export const standardRateLimiter: RateLimitRequestHandler = createRateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please try again later',
});

/**
 * Authentication rate limiter (stricter)
 * 10 requests per 15 minutes for login/register
 */
export const authRateLimiter: RateLimitRequestHandler = createRateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many authentication attempts, please try again later',
  skipSuccessfulRequests: false,
});

/**
 * Pack upload rate limiter
 * 20 uploads per hour
 */
export const uploadRateLimiter: RateLimitRequestHandler = createRateLimitMiddleware({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many uploads, please try again later',
});

/**
 * WebSocket connection rate limiter
 * 5 connections per minute per IP
 */
export const wsConnectionRateLimiter: RateLimitRequestHandler = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: 'Too many connection attempts, please try again later',
});

/**
 * Health check exemption - skip rate limiting for health endpoints
 */
export function skipHealthChecks(req: Request): boolean {
  const healthPaths = ['/health', '/ready', '/live'];
  return healthPaths.includes(req.path);
}

/**
 * Create rate limiter that skips health checks
 */
export const apiRateLimiter: RateLimitRequestHandler = createRateLimitMiddleware({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: skipHealthChecks,
});

/**
 * Create a custom rate limiter for specific routes
 */
export function createCustomRateLimiter(
  windowMs: number,
  max: number,
  message?: string
): RateLimitRequestHandler {
  return createRateLimitMiddleware({
    windowMs,
    max,
    message: message ?? `Rate limit exceeded. Maximum ${max} requests per ${windowMs / 1000} seconds.`,
  });
}

/**
 * Middleware to attach rate limit info to request for logging
 */
export const rateLimitInfoMiddleware: RequestHandler = (_req, _res, next) => {
  // Rate limit info is automatically added to response headers by express-rate-limit
  // This middleware can be extended to add custom logging or tracking
  next();
};

/**
 * Export all rate limit middleware
 */
export default {
  createRateLimitMiddleware,
  standardRateLimiter,
  authRateLimiter,
  uploadRateLimiter,
  wsConnectionRateLimiter,
  apiRateLimiter,
  createCustomRateLimiter,
  skipHealthChecks,
};
