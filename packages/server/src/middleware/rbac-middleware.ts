/**
 * Role-Based Access Control (RBAC) Middleware
 *
 * Uses CASL library to define and enforce permissions based on user roles.
 * Provides fine-grained access control for packs, nodes, pods, and namespaces.
 *
 * @module @stark-o/server/middleware/rbac-middleware
 */

import { AbilityBuilder, createMongoAbility, type MongoAbility, type MongoQuery } from '@casl/ability';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { User, UserRole } from '@stark-o/shared';
import { createServiceLogger } from '@stark-o/shared';
import type { AuthenticatedRequest } from './auth-middleware.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Actions that can be performed on resources
 */
export type Action = 'create' | 'read' | 'update' | 'delete' | 'manage';

/**
 * Resource types in the system
 */
export type Subject = 'Pack' | 'Pod' | 'Node' | 'Namespace' | 'User' | 'ClusterConfig' | 'all';

/**
 * CASL ability type for the application
 */
export type AppAbility = MongoAbility<[Action, Subject], MongoQuery>;

/**
 * Extended request with CASL ability
 */
export interface AuthorizedRequest extends AuthenticatedRequest {
  /** CASL ability for authorization checks */
  ability: AppAbility;
}

/**
 * RBAC middleware options
 */
export interface RbacMiddlewareOptions {
  /** Action required to access the route */
  action: Action;
  /** Subject type the action is performed on */
  subject: Subject;
  /** Optional condition check function */
  conditionCheck?: (req: Request, user: User) => boolean;
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

// ============================================================================
// Logger
// ============================================================================

const logger = createServiceLogger(
  {
    level: 'debug',
    service: 'stark-orchestrator',
  },
  { component: 'rbac-middleware' }
);

// ============================================================================
// Ability Definitions
// ============================================================================

/**
 * Defines abilities for a user based on their roles
 *
 * Role permissions:
 * - admin: Full access to all resources (manage all)
 * - node: Node agents - can create/update own node, update pods assigned to it, read packs
 * - viewer: Read-only access to packs, pods, nodes, namespaces
 *
 * Note: The 'node' role provides baseline permissions. Ownership-based access control
 * (e.g., node can only update its own record) is enforced in route handlers.
 *
 * @param user - The authenticated user
 * @returns CASL MongoAbility instance
 */
export function defineAbilityFor(user: User): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  // Check each role the user has
  for (const role of user.roles) {
    switch (role) {
      case 'admin':
        // Admin has full access to everything
        can('manage', 'all');
        break;

      case 'node':
        // Node agents manage their own node and assigned pods
        // Note: Ownership checks are enforced in route handlers/WebSocket handlers
        can('create', 'Node');  // Register own node
        can('read', 'Node');    // Read own node (for reconnection)
        can('update', 'Node');  // Update own node (heartbeat, status)
        // Nodes can update pod status for pods assigned to them
        can('read', 'Pod');     // Read pods assigned to this node
        can('update', 'Pod');   // Update pod status (running, failed, etc.)
        // Nodes need to read packs to execute them
        can('read', 'Pack');
        // Nodes can read namespaces for pod filtering
        can('read', 'Namespace');
        break;

      case 'viewer':
        // Viewers have read-only access
        can('read', 'Pack');
        can('read', 'Pod');
        can('read', 'Node');
        can('read', 'Namespace');
        break;
    }
  }

  return build();
}

// ============================================================================
// Middleware Functions
// ============================================================================

/**
 * Sends a 403 Forbidden response
 */
function sendForbidden(
  res: Response,
  action: Action,
  subject: Subject,
  correlationId: string
): void {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: 'FORBIDDEN',
      message: `You do not have permission to ${action} ${subject} resources.`,
      details: { action, subject, correlationId },
    },
  };
  res.status(403).json(response);
}

/**
 * Sends a 401 Unauthorized response (when user is not authenticated)
 */
function sendUnauthorized(res: Response, correlationId: string): void {
  const response: ApiErrorResponse = {
    success: false,
    error: {
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required to access this resource.',
      details: { correlationId },
    },
  };
  res.status(401).json(response);
}

/**
 * Attaches CASL ability to an authenticated request
 *
 * This middleware should be used after auth middleware.
 * It creates a CASL ability based on the user's roles.
 *
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * router.get('/protected',
 *   authMiddleware,
 *   attachAbility(),
 *   (req, res) => {
 *     const { ability } = req as AuthorizedRequest;
 *     if (ability.can('read', 'Pack')) {
 *       // User can read packs
 *     }
 *   }
 * );
 * ```
 */
export function attachAbility(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;

    if (!authReq.user) {
      // No user attached - proceed without ability
      // The authorize middleware will handle the 401
      next();
      return;
    }

    // Create ability based on user roles
    const ability = defineAbilityFor(authReq.user);
    (req as AuthorizedRequest).ability = ability;

    logger.debug('Ability attached to request', {
      correlationId: authReq.correlationId,
      userId: authReq.user.id,
      roles: authReq.user.roles,
    });

    next();
  };
}

/**
 * Creates an authorization middleware that checks if the user can perform an action
 *
 * This middleware should be used after auth middleware and attachAbility middleware.
 *
 * @param action - The action to check (create, read, update, delete, manage)
 * @param subject - The resource type to check against
 * @param options - Additional options for authorization
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Require 'create' permission on 'Pack'
 * router.post('/packs',
 *   authMiddleware,
 *   attachAbility(),
 *   authorize('create', 'Pack'),
 *   createPackHandler
 * );
 *
 * // Require 'manage' permission on 'Node'
 * router.delete('/nodes/:id',
 *   authMiddleware,
 *   attachAbility(),
 *   authorize('delete', 'Node'),
 *   deleteNodeHandler
 * );
 * ```
 */
export function authorize(
  action: Action,
  subject: Subject,
  options?: { conditionCheck?: (req: Request, user: User) => boolean }
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthorizedRequest;
    const correlationId = authReq.correlationId || 'unknown';

    // Check if user is authenticated
    if (!authReq.user) {
      logger.debug('Authorization failed: no authenticated user', {
        correlationId,
        action,
        subject,
        path: req.path,
        method: req.method,
      });

      sendUnauthorized(res, correlationId);
      return;
    }

    // Check if ability is attached
    if (!authReq.ability) {
      // Ability not attached - create it now
      authReq.ability = defineAbilityFor(authReq.user);
    }

    // Check if additional condition is met
    if (options?.conditionCheck && !options.conditionCheck(req, authReq.user)) {
      logger.debug('Authorization failed: condition check failed', {
        correlationId,
        userId: authReq.user.id,
        action,
        subject,
        path: req.path,
        method: req.method,
      });

      sendForbidden(res, action, subject, correlationId);
      return;
    }

    // Check if user has permission
    if (!authReq.ability.can(action, subject)) {
      logger.debug('Authorization failed: insufficient permissions', {
        correlationId,
        userId: authReq.user.id,
        roles: authReq.user.roles,
        action,
        subject,
        path: req.path,
        method: req.method,
      });

      sendForbidden(res, action, subject, correlationId);
      return;
    }

    logger.debug('Authorization successful', {
      correlationId,
      userId: authReq.user.id,
      action,
      subject,
      path: req.path,
    });

    next();
  };
}

/**
 * Creates a middleware that requires any of the specified roles
 *
 * Simpler alternative to CASL-based authorization for basic role checks.
 *
 * @param roles - Array of roles, any of which grants access
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Allow admin or node agents
 * router.put('/nodes/:id',
 *   authMiddleware,
 *   requireAnyRole(['admin', 'node']),
 *   updateNodeHandler
 * );
 * ```
 */
export function requireAnyRole(roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    const correlationId = authReq.correlationId || 'unknown';

    // Check if user is authenticated
    if (!authReq.user) {
      sendUnauthorized(res, correlationId);
      return;
    }

    // Check if user has any of the required roles
    const hasRole = roles.some((role) => authReq.user.roles.includes(role));

    if (!hasRole) {
      logger.debug('Role check failed', {
        correlationId,
        userId: authReq.user.id,
        userRoles: authReq.user.roles,
        requiredRoles: roles,
        path: req.path,
        method: req.method,
      });

      const response: ApiErrorResponse = {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `This action requires one of the following roles: ${roles.join(', ')}`,
          details: { requiredRoles: roles, correlationId },
        },
      };
      res.status(403).json(response);
      return;
    }

    logger.debug('Role check passed', {
      correlationId,
      userId: authReq.user.id,
      matchedRole: authReq.user.roles.find((r) => roles.includes(r)),
    });

    next();
  };
}

/**
 * Creates a middleware that requires all of the specified roles
 *
 * @param roles - Array of roles, all of which are required for access
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Require both admin and operator roles (uncommon but possible)
 * router.post('/cluster/config',
 *   authMiddleware,
 *   requireAllRoles(['admin']),
 *   updateClusterConfigHandler
 * );
 * ```
 */
export function requireAllRoles(roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    const correlationId = authReq.correlationId || 'unknown';

    // Check if user is authenticated
    if (!authReq.user) {
      sendUnauthorized(res, correlationId);
      return;
    }

    // Check if user has all of the required roles
    const hasAllRoles = roles.every((role) => authReq.user.roles.includes(role));

    if (!hasAllRoles) {
      const missingRoles = roles.filter((role) => !authReq.user.roles.includes(role));

      logger.debug('All roles check failed', {
        correlationId,
        userId: authReq.user.id,
        userRoles: authReq.user.roles,
        requiredRoles: roles,
        missingRoles,
        path: req.path,
        method: req.method,
      });

      const response: ApiErrorResponse = {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `This action requires all of the following roles: ${roles.join(', ')}`,
          details: { requiredRoles: roles, missingRoles, correlationId },
        },
      };
      res.status(403).json(response);
      return;
    }

    logger.debug('All roles check passed', {
      correlationId,
      userId: authReq.user.id,
    });

    next();
  };
}

/**
 * Checks resource ownership for authorization
 *
 * Use this in route handlers to verify the user owns a resource before allowing modification.
 *
 * @param user - The authenticated user
 * @param resourceOwnerId - The owner ID of the resource
 * @returns true if user is owner or has admin/operator role
 *
 * @example
 * ```typescript
 * // In route handler
 * if (!checkOwnership(req.user, pack.ownerId)) {
 *   return sendForbidden(res, 'update', 'Pack');
 * }
 * ```
 */
export function checkOwnership(user: User, resourceOwnerId: string): boolean {
  // Admins can access any resource
  if (user.roles.includes('admin')) {
    return true;
  }

  // Otherwise, user must be the owner
  return user.id === resourceOwnerId;
}

/**
 * Type guard to check if request has ability attached
 */
export function hasAbility(req: Request): req is AuthorizedRequest {
  return 'ability' in req && (req as AuthorizedRequest).ability !== undefined;
}

// ============================================================================
// Pre-configured Middleware Instances
// ============================================================================

/**
 * Middleware that attaches CASL ability (use after authMiddleware)
 */
export const abilityMiddleware: RequestHandler = attachAbility();

/**
 * Pre-configured authorization middlewares for common patterns
 */
export const requireAdmin: RequestHandler = requireAnyRole(['admin']);
export const requireNode: RequestHandler = requireAnyRole(['admin', 'node']);
export const requireViewer: RequestHandler = requireAnyRole(['admin', 'node', 'viewer']);

// Pack authorization
export const canCreatePack: RequestHandler = authorize('create', 'Pack');
export const canReadPack: RequestHandler = authorize('read', 'Pack');
export const canUpdatePack: RequestHandler = authorize('update', 'Pack');
export const canDeletePack: RequestHandler = authorize('delete', 'Pack');
export const canManagePack: RequestHandler = authorize('manage', 'Pack');

// Pod authorization
export const canCreatePod: RequestHandler = authorize('create', 'Pod');
export const canReadPod: RequestHandler = authorize('read', 'Pod');
export const canUpdatePod: RequestHandler = authorize('update', 'Pod');
export const canDeletePod: RequestHandler = authorize('delete', 'Pod');
export const canManagePod: RequestHandler = authorize('manage', 'Pod');

// Node authorization
export const canCreateNode: RequestHandler = authorize('create', 'Node');
export const canReadNode: RequestHandler = authorize('read', 'Node');
export const canUpdateNode: RequestHandler = authorize('update', 'Node');
export const canDeleteNode: RequestHandler = authorize('delete', 'Node');
export const canManageNode: RequestHandler = authorize('manage', 'Node');

// Namespace authorization
export const canCreateNamespace: RequestHandler = authorize('create', 'Namespace');
export const canReadNamespace: RequestHandler = authorize('read', 'Namespace');
export const canUpdateNamespace: RequestHandler = authorize('update', 'Namespace');
export const canDeleteNamespace: RequestHandler = authorize('delete', 'Namespace');
export const canManageNamespace: RequestHandler = authorize('manage', 'Namespace');

// Cluster config authorization
export const canReadClusterConfig: RequestHandler = authorize('read', 'ClusterConfig');
export const canManageClusterConfig: RequestHandler = authorize('manage', 'ClusterConfig');

// User authorization
export const canReadUser: RequestHandler = authorize('read', 'User');
export const canManageUser: RequestHandler = authorize('manage', 'User');
