/**
 * Middleware Module
 *
 * Re-exports all middleware for the server
 * @module @stark-o/server/middleware
 */

// Auth Middleware
export {
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  authMiddleware,
  optionalAuthMiddleware,
  extractBearerToken,
  isAuthenticated,
  type AuthenticatedRequest,
  type AuthMiddlewareOptions,
} from './auth-middleware.js';

// RBAC Middleware (CASL-based)
export {
  // Core functions
  defineAbilityFor,
  attachAbility,
  authorize,
  requireAnyRole,
  requireAllRoles,
  checkOwnership,
  hasAbility,
  // Pre-configured middleware instances
  abilityMiddleware,
  requireAdmin,
  requireNode,
  requireViewer,
  // Pack authorization
  canCreatePack,
  canReadPack,
  canUpdatePack,
  canDeletePack,
  canManagePack,
  // Pod authorization
  canCreatePod,
  canReadPod,
  canUpdatePod,
  canDeletePod,
  canManagePod,
  // Node authorization
  canCreateNode,
  canReadNode,
  canUpdateNode,
  canDeleteNode,
  canManageNode,
  // Namespace authorization
  canCreateNamespace,
  canReadNamespace,
  canUpdateNamespace,
  canDeleteNamespace,
  canManageNamespace,
  // Cluster config authorization
  canReadClusterConfig,
  canManageClusterConfig,
  // User authorization
  canReadUser,
  canManageUser,
  // Types
  type Action,
  type Subject,
  type AppAbility,
  type AuthorizedRequest,
  type RbacMiddlewareOptions,
} from './rbac-middleware.js';

// Rate Limiting Middleware
export {
  createRateLimitMiddleware,
  standardRateLimiter,
  authRateLimiter,
  uploadRateLimiter,
  wsConnectionRateLimiter,
  apiRateLimiter,
  createCustomRateLimiter,
  skipHealthChecks,
  rateLimitInfoMiddleware,
  type RateLimitConfig,
} from './rate-limit-middleware.js';
