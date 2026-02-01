/**
 * Authentication/Authorization error class
 * @module @stark-o/shared/errors/auth-error
 */

import { StarkError, ErrorCode, ErrorMeta } from './base-error';
import type { UserRole } from '../types/user';

/**
 * Authentication error for login/token failures
 */
export class AuthenticationError extends StarkError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.AUTHENTICATION_REQUIRED,
    meta: ErrorMeta = {},
  ) {
    super(message, code, meta);
    this.name = 'AuthenticationError';
  }

  /**
   * Create for missing authentication
   */
  static required(): AuthenticationError {
    return new AuthenticationError(
      'Authentication required',
      ErrorCode.AUTHENTICATION_REQUIRED,
    );
  }

  /**
   * Create for invalid credentials
   */
  static invalidCredentials(): AuthenticationError {
    return new AuthenticationError(
      'Invalid email or password',
      ErrorCode.INVALID_CREDENTIALS,
    );
  }

  /**
   * Create for expired token
   */
  static tokenExpired(): AuthenticationError {
    return new AuthenticationError(
      'Token has expired',
      ErrorCode.TOKEN_EXPIRED,
    );
  }

  /**
   * Create for invalid token
   */
  static tokenInvalid(reason?: string): AuthenticationError {
    return new AuthenticationError(
      reason ? `Invalid token: ${reason}` : 'Invalid token',
      ErrorCode.TOKEN_INVALID,
    );
  }

  /**
   * Create for expired session
   */
  static sessionExpired(): AuthenticationError {
    return new AuthenticationError(
      'Session has expired, please login again',
      ErrorCode.SESSION_EXPIRED,
    );
  }
}

/**
 * Authorization error for permission failures
 */
export class AuthorizationError extends StarkError {
  /** Required roles for the action */
  public readonly requiredRoles?: UserRole[];
  /** User's actual roles */
  public readonly userRoles?: UserRole[];

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.FORBIDDEN,
    meta: ErrorMeta = {},
    requiredRoles?: UserRole[],
    userRoles?: UserRole[],
  ) {
    super(message, code, meta);
    this.name = 'AuthorizationError';
    this.requiredRoles = requiredRoles;
    this.userRoles = userRoles;
  }

  /**
   * Create for general forbidden access
   */
  static forbidden(resource?: string): AuthorizationError {
    const message = resource
      ? `Access to ${resource} is forbidden`
      : 'Access forbidden';
    return new AuthorizationError(
      message,
      ErrorCode.FORBIDDEN,
      { resourceType: resource },
    );
  }

  /**
   * Create for insufficient permissions
   */
  static insufficientPermissions(
    action: string,
    resource?: string,
  ): AuthorizationError {
    const message = resource
      ? `Insufficient permissions to ${action} ${resource}`
      : `Insufficient permissions to ${action}`;
    return new AuthorizationError(
      message,
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      { resourceType: resource },
    );
  }

  /**
   * Create for missing required role
   */
  static roleRequired(
    requiredRoles: UserRole[],
    userRoles?: UserRole[],
  ): AuthorizationError {
    const rolesStr = requiredRoles.join(' or ');
    return new AuthorizationError(
      `One of the following roles is required: ${rolesStr}`,
      ErrorCode.ROLE_REQUIRED,
      {},
      requiredRoles,
      userRoles,
    );
  }

  /**
   * Create for resource access denied
   */
  static resourceAccessDenied(
    resourceType: string,
    resourceId: string,
    reason?: string,
  ): AuthorizationError {
    const message = reason
      ? `Access denied to ${resourceType} '${resourceId}': ${reason}`
      : `Access denied to ${resourceType} '${resourceId}'`;
    return new AuthorizationError(
      message,
      ErrorCode.RESOURCE_ACCESS_DENIED,
      { resourceType, resourceId },
    );
  }

  /**
   * Convert to JSON for API responses
   */
  override toJSON(): Record<string, unknown> {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        requiredRoles: this.requiredRoles,
        meta: this.meta,
        timestamp: this.timestamp.toISOString(),
        correlationId: this.correlationId,
      },
    };
  }
}

/**
 * Check if an error is an AuthenticationError
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

/**
 * Check if an error is an AuthorizationError
 */
export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}

/**
 * Check if an error is any auth-related error
 */
export function isAuthError(error: unknown): error is AuthenticationError | AuthorizationError {
  return isAuthenticationError(error) || isAuthorizationError(error);
}
