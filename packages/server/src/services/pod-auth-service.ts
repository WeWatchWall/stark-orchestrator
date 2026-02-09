/**
 * Pod Authentication Service
 *
 * Generates and validates short-lived tokens for pod authentication.
 * Tokens are HMAC-signed and include the podId, nodeId, and serviceId
 * to prevent pod spoofing attacks.
 *
 * @module @stark-o/server/services/pod-auth-service
 */

import { createHmac, randomBytes } from 'crypto';
import { createServiceLogger } from '@stark-o/shared';

const logger = createServiceLogger({ component: 'pod-auth', service: 'stark-server' });

// ── Configuration ───────────────────────────────────────────────────────────

/** Default token TTL: 1 hour */
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Token refresh threshold: 15 minutes before expiration (same as node tokens) */
export const POD_TOKEN_REFRESH_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Get the pod token secret from environment or generate a random one.
 * In production, POD_TOKEN_SECRET should be set in environment.
 */
function getTokenSecret(): string {
  const envSecret = process.env.POD_TOKEN_SECRET;
  if (envSecret) {
    return envSecret;
  }

  // For development, generate a random secret per server instance
  // This means tokens won't survive server restarts in dev mode
  if (process.env.NODE_ENV !== 'production') {
    const devSecret = randomBytes(32).toString('hex');
    logger.warn('POD_TOKEN_SECRET not set, using random secret (tokens will not survive restart)');
    return devSecret;
  }

  throw new Error('POD_TOKEN_SECRET environment variable is required in production');
}

// Lazy-initialized secret
let tokenSecret: string | null = null;
function getSecret(): string {
  if (!tokenSecret) {
    tokenSecret = getTokenSecret();
  }
  return tokenSecret;
}

// ── Token Types ─────────────────────────────────────────────────────────────

/**
 * Claims embedded in a pod token
 */
export interface PodTokenClaims {
  /** Pod ID */
  podId: string;
  /** Node ID where pod is deployed */
  nodeId: string;
  /** Service ID (for routing) */
  serviceId: string;
  /** Pod incarnation number (prevents replay with old tokens) */
  incarnation: number;
  /** User ID who owns the pod */
  userId: string;
  /** Token issued at timestamp (ms) */
  iat: number;
  /** Token expiration timestamp (ms) */
  exp: number;
}

/**
 * Result of token generation
 */
export interface PodTokenResult {
  /** The encoded token string */
  token: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Token expiration timestamp (ISO string) */
  expiresAt: string;
}

/**
 * Result of token validation
 */
export interface PodTokenValidationResult {
  valid: boolean;
  claims?: PodTokenClaims;
  error?: string;
}

// ── Token Generation ────────────────────────────────────────────────────────

/**
 * Generate a pod authentication token.
 *
 * Token format: base64(claims).base64(signature)
 * This is a simple HMAC-based token, not a full JWT, for efficiency.
 *
 * @param podId - Pod ID
 * @param nodeId - Node ID where pod is deployed
 * @param serviceId - Service ID for routing
 * @param incarnation - Pod incarnation number
 * @param userId - User ID who owns the pod
 * @param ttlMs - Token time-to-live in milliseconds (default: 1 hour)
 * @returns Token result with token string and expiration
 */
export function generatePodToken(
  podId: string,
  nodeId: string,
  serviceId: string,
  incarnation: number,
  userId: string,
  ttlMs: number = DEFAULT_TOKEN_TTL_MS
): PodTokenResult {
  const now = Date.now();
  const exp = now + ttlMs;

  const claims: PodTokenClaims = {
    podId,
    nodeId,
    serviceId,
    incarnation,
    userId,
    iat: now,
    exp,
  };

  const claimsJson = JSON.stringify(claims);
  const claimsBase64 = Buffer.from(claimsJson).toString('base64url');

  const signature = createHmac('sha256', getSecret())
    .update(claimsBase64)
    .digest('base64url');

  const token = `${claimsBase64}.${signature}`;

  // Generate refresh token (longer-lived, used to get new access tokens)
  // Refresh token is essentially a token with longer TTL
  const refreshTtlMs = ttlMs * 24; // 24 hours for refresh token
  const refreshExp = now + refreshTtlMs;
  const refreshClaims: PodTokenClaims = {
    ...claims,
    exp: refreshExp,
  };

  const refreshClaimsJson = JSON.stringify(refreshClaims);
  const refreshClaimsBase64 = Buffer.from(refreshClaimsJson).toString('base64url');
  const refreshSignature = createHmac('sha256', getSecret())
    .update(refreshClaimsBase64)
    .digest('base64url');

  const refreshToken = `${refreshClaimsBase64}.${refreshSignature}`;

  logger.debug('Generated pod token', {
    podId,
    nodeId,
    serviceId,
    incarnation,
    expiresAt: new Date(exp).toISOString(),
  });

  return {
    token,
    refreshToken,
    expiresAt: new Date(exp).toISOString(),
  };
}

// ── Token Validation ────────────────────────────────────────────────────────

/**
 * Validate a pod authentication token.
 *
 * Checks:
 * 1. Token format is valid
 * 2. Signature matches
 * 3. Token is not expired
 *
 * @param token - The token string to validate
 * @returns Validation result with claims if valid
 */
export function validatePodToken(token: string): PodTokenValidationResult {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid token format' };
    }

    const claimsBase64 = parts[0]!;
    const providedSignature = parts[1]!;

    // Verify signature
    const expectedSignature = createHmac('sha256', getSecret())
      .update(claimsBase64)
      .digest('base64url');

    if (providedSignature !== expectedSignature) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Decode and parse claims
    const claimsJson = Buffer.from(claimsBase64, 'base64url').toString('utf8');
    const claims = JSON.parse(claimsJson) as PodTokenClaims;

    // Check expiration
    if (Date.now() > claims.exp) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, claims };
  } catch (error) {
    logger.warn('Token validation error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { valid: false, error: 'Token validation failed' };
  }
}

/**
 * Refresh a pod token using a refresh token.
 *
 * @param refreshToken - The refresh token
 * @returns New token result or null if refresh token is invalid
 */
export function refreshPodToken(refreshToken: string): PodTokenResult | null {
  const validation = validatePodToken(refreshToken);
  if (!validation.valid || !validation.claims) {
    logger.debug('Refresh token validation failed', { error: validation.error });
    return null;
  }

  const { podId, nodeId, serviceId, incarnation, userId } = validation.claims;

  // Generate new tokens
  return generatePodToken(podId, nodeId, serviceId, incarnation, userId);
}

// ── HTTP Endpoint Handler ───────────────────────────────────────────────────

/**
 * Handle pod token refresh HTTP request.
 * This is the endpoint pods call to refresh their tokens.
 *
 * @param refreshToken - The refresh token from request body
 * @returns New tokens or error
 */
export async function handlePodTokenRefresh(
  refreshToken: string
): Promise<{ success: true; data: PodTokenResult } | { success: false; error: { code: string; message: string } }> {
  const result = refreshPodToken(refreshToken);

  if (!result) {
    return {
      success: false,
      error: {
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      },
    };
  }

  logger.debug('Pod token refreshed', {
    expiresAt: result.expiresAt,
  });

  return {
    success: true,
    data: result,
  };
}

// ── Export singleton pattern ────────────────────────────────────────────────

export const podAuthService = {
  generateToken: generatePodToken,
  validateToken: validatePodToken,
  refreshToken: refreshPodToken,
  handleRefresh: handlePodTokenRefresh,
  POD_TOKEN_REFRESH_THRESHOLD_MS,
};
