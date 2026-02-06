/**
 * User type definitions
 * @module @stark-o/shared/types/user
 */

/**
 * User roles for RBAC
 * - admin: Full access to all resources (manage users, cluster config, all entities)
 * - user: Self-service users - can manage own packs, nodes, and services
 * - node: Node agents - can register/update own node and update pods assigned to it
 * - viewer: Read-only access to packs, pods, nodes, namespaces
 */
export type UserRole = 'admin' | 'user' | 'node' | 'viewer';

/**
 * User entity
 */
export interface User {
  /** Unique identifier (UUID) */
  id: string;
  /** Email address */
  email: string;
  /** Display name */
  displayName?: string;
  /** Assigned roles */
  roles: UserRole[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * User creation input
 */
export interface CreateUserInput {
  email: string;
  displayName?: string;
  roles?: UserRole[];
}

/**
 * User update input
 */
export interface UpdateUserInput {
  displayName?: string;
  roles?: UserRole[];
}

/**
 * User session from authentication
 */
export interface UserSession {
  /** User data */
  user: User;
  /** Access token (JWT) */
  accessToken: string;
  /** Refresh token */
  refreshToken?: string;
  /** Token expiration timestamp */
  expiresAt: Date;
}

/**
 * Check if user has a specific role
 */
export function hasRole(user: User, role: UserRole): boolean {
  return user.roles.includes(role);
}

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(user: User, roles: UserRole[]): boolean {
  return roles.some(role => user.roles.includes(role));
}

/**
 * Check if user has all of the specified roles
 */
export function hasAllRoles(user: User, roles: UserRole[]): boolean {
  return roles.every(role => user.roles.includes(role));
}

/**
 * Check if user can manage resources (admin only)
 */
export function canManageResources(user: User): boolean {
  return hasRole(user, 'admin');
}

/**
 * Check if user is a node agent
 */
export function isNodeAgent(user: User): boolean {
  return hasRole(user, 'node');
}

/**
 * All available roles
 */
export const ALL_ROLES: readonly UserRole[] = ['admin', 'user', 'node', 'viewer'] as const;
