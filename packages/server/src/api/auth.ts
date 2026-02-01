/**
 * Auth REST API Endpoints
 *
 * Provides REST endpoints for user authentication.
 * - POST /auth/register - Register a new user
 * - POST /auth/login - Login an existing user
 * - POST /auth/logout - Logout the current user
 * - POST /auth/refresh - Refresh access token using refresh token
 *
 * @module @stark-o/server/api/auth
 */

import { Router, Request, Response } from 'express';
import { createServiceLogger, generateCorrelationId } from '@stark-o/shared';
import { getAuthQueries, countUsers, getUserQueries, verifyToken } from '../supabase/auth.js';
import { isPublicRegistrationEnabled } from '../supabase/app-config.js';

/**
 * Logger for auth API operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'api-auth' });

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

/**
 * Register/Login response structure
 */
interface AuthSessionResponse {
  user: {
    id: string;
    email: string;
    displayName?: string;
    roles: string[];
    createdAt: string;
    updatedAt: string;
  };
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
}

// ============================================================================
// Validation Types
// ============================================================================

interface ValidationError {
  code: string;
  message: string;
}

interface ValidationResult {
  valid: boolean;
  errors: Record<string, ValidationError>;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Email regex pattern
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password minimum length
 */
const PASSWORD_MIN_LENGTH = 8;

/**
 * Display name maximum length
 */
const DISPLAY_NAME_MAX_LENGTH = 100;

/**
 * Validates email format
 */
function validateEmail(email: unknown): ValidationError | null {
  if (email === undefined || email === null || email === '') {
    return { code: 'REQUIRED', message: 'Email is required' };
  }

  if (typeof email !== 'string') {
    return { code: 'INVALID_TYPE', message: 'Email must be a string' };
  }

  // Trim and check if empty after trimming
  const trimmedEmail = email.trim();
  if (trimmedEmail === '') {
    return { code: 'REQUIRED', message: 'Email is required' };
  }

  if (!EMAIL_REGEX.test(trimmedEmail)) {
    return { code: 'INVALID_FORMAT', message: 'Email must be a valid email address' };
  }

  return null;
}

/**
 * Validates password for login (simpler, just requires non-empty)
 */
function validateLoginPassword(password: unknown): ValidationError | null {
  if (password === undefined || password === null || password === '') {
    return { code: 'REQUIRED', message: 'Password is required' };
  }

  if (typeof password !== 'string') {
    return { code: 'INVALID_TYPE', message: 'Password must be a string' };
  }

  return null;
}

/**
 * Validates password for registration (stronger requirements)
 */
function validateRegisterPassword(password: unknown): ValidationError | null {
  if (password === undefined || password === null || password === '') {
    return { code: 'REQUIRED', message: 'Password is required' };
  }

  if (typeof password !== 'string') {
    return { code: 'INVALID_TYPE', message: 'Password must be a string' };
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return { code: 'TOO_SHORT', message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }

  if (!/[A-Z]/.test(password)) {
    return { code: 'MISSING_UPPERCASE', message: 'Password must contain at least one uppercase letter' };
  }

  if (!/[a-z]/.test(password)) {
    return { code: 'MISSING_LOWERCASE', message: 'Password must contain at least one lowercase letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { code: 'MISSING_DIGIT', message: 'Password must contain at least one digit' };
  }

  return null;
}

/**
 * Validates display name (optional)
 */
function validateDisplayName(displayName: unknown): ValidationError | null {
  if (displayName === undefined || displayName === null) {
    return null; // Optional field
  }

  if (typeof displayName !== 'string') {
    return { code: 'INVALID_TYPE', message: 'Display name must be a string' };
  }

  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return { code: 'TOO_LONG', message: `Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters` };
  }

  return null;
}

/**
 * Validates registration input
 */
function validateRegisterInput(body: unknown): ValidationResult {
  const errors: Record<string, ValidationError> = {};

  if (body === null || body === undefined || typeof body !== 'object') {
    return {
      valid: false,
      errors: {
        email: { code: 'REQUIRED', message: 'Email is required' },
        password: { code: 'REQUIRED', message: 'Password is required' },
      },
    };
  }

  const input = body as Record<string, unknown>;

  const emailError = validateEmail(input.email);
  if (emailError) errors.email = emailError;

  const passwordError = validateRegisterPassword(input.password);
  if (passwordError) errors.password = passwordError;

  const displayNameError = validateDisplayName(input.displayName);
  if (displayNameError) errors.displayName = displayNameError;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validates login input
 */
function validateLoginInput(body: unknown): ValidationResult {
  const errors: Record<string, ValidationError> = {};

  if (body === null || body === undefined || typeof body !== 'object') {
    return {
      valid: false,
      errors: {
        email: { code: 'REQUIRED', message: 'Email is required' },
        password: { code: 'REQUIRED', message: 'Password is required' },
      },
    };
  }

  const input = body as Record<string, unknown>;

  const emailError = validateEmail(input.email);
  if (emailError) errors.email = emailError;

  const passwordError = validateLoginPassword(input.password);
  if (passwordError) errors.password = passwordError;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
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
 * POST /auth/register - Register a new user
 */
export async function register(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Register request received');

    // Check if requester is an admin (optional auth - allows admin bypass)
    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader !== undefined && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);
      const tokenResult = await verifyToken(accessToken);
      if (tokenResult.data !== null && tokenResult.data !== undefined && tokenResult.data.roles.includes('admin')) {
        isAdmin = true;
        requestLogger.debug('Admin user performing registration');
      }
    }

    // Check if public registration is enabled (only required for non-admin requests)
    if (!isAdmin) {
      const registrationResult = await isPublicRegistrationEnabled();
      if (registrationResult.error) {
        requestLogger.error('Error checking registration status', new Error(registrationResult.error.message));
        sendError(res, 'INTERNAL_ERROR', 'Failed to check registration status', 500);
        return;
      }

      if (registrationResult.data !== true) {
        requestLogger.info('Registration attempted but public registration is disabled');
        sendError(res, 'FORBIDDEN', 'Public registration is disabled. Contact an administrator for access.', 403);
        return;
      }
    }

    // Validate input
    const validationResult = validateRegisterInput(req.body);
    if (!validationResult.valid) {
      requestLogger.warn('Registration validation failed', { errors: validationResult.errors });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, validationResult.errors);
      return;
    }

    const { email, password, displayName, roles } = req.body as {
      email: string;
      password: string;
      displayName?: string;
      roles?: string[];
    };

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // Determine roles:
    // - Admins can specify any valid roles
    // - Anonymous registration only allows non-admin roles (defaults to 'viewer')
    const validRoles = ['admin', 'node', 'viewer'] as const;
    const nonAdminRoles = ['node', 'viewer'] as const;
    type UserRole = typeof validRoles[number];
    
    let userRoles: UserRole[];
    if (isAdmin && roles) {
      // Admin can assign any valid role
      userRoles = roles.filter((r): r is UserRole => validRoles.includes(r as UserRole));
      if (userRoles.length === 0) {
        userRoles = ['viewer'];
      }
    } else if (roles && roles.length > 0) {
      // Anonymous registration: filter to non-admin roles only
      userRoles = roles.filter((r): r is UserRole => 
        nonAdminRoles.includes(r as typeof nonAdminRoles[number])
      );
      if (userRoles.length === 0) {
        userRoles = ['viewer'];
      }
    } else {
      // Default role for anonymous registration
      userRoles = ['viewer'];
    }

    // Register user
    const authQueries = getAuthQueries();
    const result = await authQueries.registerUser({
      email: normalizedEmail,
      password,
      displayName,
      roles: userRoles,
    });

    if (result.error) {
      // Handle specific error codes
      if (result.error.code === 'USER_ALREADY_EXISTS') {
        requestLogger.info('Registration conflict - user already exists', { email: normalizedEmail });
        sendError(res, 'CONFLICT', 'User with this email already exists', 409);
        return;
      }

      requestLogger.error('Registration failed', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Registration failed', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'INTERNAL_ERROR', 'Registration failed', 500);
      return;
    }

    const session = result.data;
    const response: AuthSessionResponse = {
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        roles: session.user.roles,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    };

    requestLogger.info('User registered successfully', {
      userId: session.user.id,
      email: normalizedEmail,
    });

    sendSuccess(res, response, 201);
  } catch (error) {
    requestLogger.error('Error during registration', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * POST /auth/login - Login an existing user
 */
export async function login(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Login request received');

    // Validate input
    const validationResult = validateLoginInput(req.body);
    if (!validationResult.valid) {
      requestLogger.warn('Login validation failed', { errors: validationResult.errors });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, validationResult.errors);
      return;
    }

    const { email, password } = req.body as {
      email: string;
      password: string;
    };

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // Login user
    const authQueries = getAuthQueries();
    const result = await authQueries.loginUser({
      email: normalizedEmail,
      password,
    });

    if (result.error) {
      // Handle specific error codes
      if (result.error.code === 'INVALID_CREDENTIALS' || result.error.code === 'USER_NOT_FOUND') {
        requestLogger.info('Login failed - invalid credentials', { email: normalizedEmail });
        sendError(res, 'UNAUTHORIZED', 'Invalid email or password', 401);
        return;
      }

      if (result.error.code === 'RATE_LIMIT_EXCEEDED') {
        requestLogger.warn('Login rate limited', { email: normalizedEmail });
        sendError(res, 'RATE_LIMIT_EXCEEDED', 'Too many login attempts. Please try again later.', 429);
        return;
      }

      if (result.error.code === 'ACCOUNT_LOCKED') {
        requestLogger.warn('Login attempt on locked account', { email: normalizedEmail });
        sendError(res, 'FORBIDDEN', 'Account is locked. Please contact support.', 403);
        return;
      }

      requestLogger.error('Login failed', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Login failed', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'INTERNAL_ERROR', 'Login failed', 500);
      return;
    }

    const session = result.data;
    const response: AuthSessionResponse = {
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        roles: session.user.roles,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    };

    requestLogger.info('User logged in successfully', {
      userId: session.user.id,
      email: normalizedEmail,
    });

    sendSuccess(res, response, 200);
  } catch (error) {
    requestLogger.error('Error during login', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * POST /auth/logout - Logout the current user
 */
export async function logout(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Logout request received');

    // Get access token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      sendError(res, 'UNAUTHORIZED', 'Missing or invalid authorization header', 401);
      return;
    }

    const accessToken = authHeader.substring(7);

    // Logout user
    const authQueries = getAuthQueries();
    const result = await authQueries.logoutUser(accessToken);

    if (result.error) {
      // Token may already be invalid/expired, still return success
      if (result.error.code === 'TOKEN_EXPIRED' || result.error.code === 'TOKEN_INVALID') {
        requestLogger.info('Logout with invalid/expired token - treating as success');
        sendSuccess(res, { message: 'Logged out successfully' }, 200);
        return;
      }

      requestLogger.error('Logout failed', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Logout failed', 500);
      return;
    }

    requestLogger.info('User logged out successfully');
    sendSuccess(res, { message: 'Logged out successfully' }, 200);
  } catch (error) {
    requestLogger.error('Error during logout', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * POST /auth/refresh - Refresh an access token using a refresh token
 */
export async function refresh(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Token refresh request received');

    // Get refresh token from body
    const { refreshToken } = req.body;

    if (!refreshToken || typeof refreshToken !== 'string') {
      sendError(res, 'VALIDATION_ERROR', 'Refresh token is required', 400);
      return;
    }

    // Refresh the session
    const authQueries = getAuthQueries();
    const result = await authQueries.refreshSession(refreshToken);

    if (result.error) {
      if (result.error.code === 'REFRESH_FAILED' || result.error.code === 'TOKEN_EXPIRED') {
        requestLogger.warn('Token refresh failed - invalid or expired refresh token');
        sendError(res, 'UNAUTHORIZED', 'Invalid or expired refresh token', 401);
        return;
      }

      requestLogger.error('Token refresh failed', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Token refresh failed', 500);
      return;
    }

    if (!result.data) {
      requestLogger.error('Token refresh returned no data');
      sendError(res, 'INTERNAL_ERROR', 'Token refresh failed unexpectedly', 500);
      return;
    }

    const session = result.data;
    const response: AuthSessionResponse = {
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        roles: session.user.roles,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    };

    requestLogger.info('Token refreshed successfully', {
      userId: session.user.id,
    });

    sendSuccess(res, response, 200);
  } catch (error) {
    requestLogger.error('Error during token refresh', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /auth/setup/status - Check if setup is needed (no users exist) and registration status
 */
export async function setupStatus(_req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Setup status check requested');

    const countResult = await countUsers();

    if (countResult.error) {
      requestLogger.error('Error checking user count', new Error(countResult.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Failed to check setup status', 500);
      return;
    }

    const needsSetup = (countResult.data ?? 0) === 0;

    // Get public registration status
    const registrationResult = await isPublicRegistrationEnabled();
    const registrationEnabled = registrationResult.data ?? false;

    sendSuccess(res, {
      needsSetup,
      userCount: countResult.data ?? 0,
      registrationEnabled,
    }, 200);
  } catch (error) {
    requestLogger.error('Error checking setup status', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * POST /auth/setup - Create the first admin user (only works when no users exist)
 */
export async function setup(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Setup request received');

    // Check if any users exist
    const countResult = await countUsers();

    if (countResult.error) {
      requestLogger.error('Error checking user count', new Error(countResult.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Failed to check if setup is needed', 500);
      return;
    }

    if ((countResult.data ?? 0) > 0) {
      requestLogger.warn('Setup attempted but users already exist');
      sendError(res, 'FORBIDDEN', 'Setup has already been completed. Use an admin account to add new users.', 403);
      return;
    }

    // Validate input
    const validationResult = validateRegisterInput(req.body);
    if (!validationResult.valid) {
      requestLogger.warn('Setup validation failed', { errors: validationResult.errors });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, validationResult.errors);
      return;
    }

    const { email, password, displayName } = req.body as {
      email: string;
      password: string;
      displayName?: string;
    };

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // Register user with admin role
    const authQueries = getAuthQueries();
    const result = await authQueries.registerUser({
      email: normalizedEmail,
      password,
      displayName,
      roles: ['admin'],
    });

    if (result.error) {
      requestLogger.error('Setup failed', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Setup failed', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'INTERNAL_ERROR', 'Setup failed', 500);
      return;
    }

    const session = result.data;
    const response: AuthSessionResponse = {
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        roles: session.user.roles,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt.toISOString(),
    };

    requestLogger.info('Initial admin user created successfully', {
      userId: session.user.id,
      email: normalizedEmail,
    });

    sendSuccess(res, response, 201);
  } catch (error) {
    requestLogger.error('Error during setup', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * POST /auth/users - Create a new user (admin only)
 */
export async function createUser(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('Create user request received');

    // Get access token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      sendError(res, 'UNAUTHORIZED', 'Missing or invalid authorization header', 401);
      return;
    }

    const accessToken = authHeader.substring(7);

    // Verify token and get user
    const tokenResult = await verifyToken(accessToken);
    if (tokenResult.error || !tokenResult.data) {
      requestLogger.warn('Invalid token for create user request');
      sendError(res, 'UNAUTHORIZED', 'Invalid or expired token', 401);
      return;
    }

    const currentUser = tokenResult.data;

    // Check if user is admin
    if (!currentUser.roles.includes('admin')) {
      requestLogger.warn('Non-admin attempted to create user', { userId: currentUser.id });
      sendError(res, 'FORBIDDEN', 'Only administrators can create users', 403);
      return;
    }

    // Validate input
    const validationResult = validateRegisterInput(req.body);
    if (!validationResult.valid) {
      requestLogger.warn('Create user validation failed', { errors: validationResult.errors });
      sendError(res, 'VALIDATION_ERROR', 'Validation failed', 400, validationResult.errors);
      return;
    }

    const { email, password, displayName, roles } = req.body as {
      email: string;
      password: string;
      displayName?: string;
      roles?: string[];
    };

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // Validate roles if provided
    const validRoles = ['admin', 'node', 'viewer'];
    const userRoles = roles?.filter(r => validRoles.includes(r)) ?? ['viewer'];

    // Register user
    const authQueries = getAuthQueries();
    const result = await authQueries.registerUser({
      email: normalizedEmail,
      password,
      displayName,
      roles: userRoles as ('admin' | 'node' | 'viewer')[],
    });

    if (result.error) {
      if (result.error.code === 'USER_ALREADY_EXISTS') {
        requestLogger.info('Create user conflict - user already exists', { email: normalizedEmail });
        sendError(res, 'CONFLICT', 'User with this email already exists', 409);
        return;
      }

      requestLogger.error('Create user failed', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Failed to create user', 500);
      return;
    }

    if (!result.data) {
      sendError(res, 'INTERNAL_ERROR', 'Failed to create user', 500);
      return;
    }

    const session = result.data;

    requestLogger.info('User created by admin', {
      createdUserId: session.user.id,
      createdEmail: normalizedEmail,
      createdBy: currentUser.id,
    });

    // Return user info (without session tokens since this is admin-created)
    sendSuccess(res, {
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.displayName,
        roles: session.user.roles,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
    }, 201);
  } catch (error) {
    requestLogger.error('Error creating user', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

/**
 * GET /auth/users - List all users (admin only)
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
  const correlationId = generateCorrelationId();
  const requestLogger = logger.withCorrelationId(correlationId);

  try {
    requestLogger.debug('List users request received');

    // Get access token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      sendError(res, 'UNAUTHORIZED', 'Missing or invalid authorization header', 401);
      return;
    }

    const accessToken = authHeader.substring(7);

    // Verify token and get user
    const tokenResult = await verifyToken(accessToken);
    if (tokenResult.error || !tokenResult.data) {
      requestLogger.warn('Invalid token for list users request');
      sendError(res, 'UNAUTHORIZED', 'Invalid or expired token', 401);
      return;
    }

    const currentUser = tokenResult.data;

    // Check if user is admin
    if (!currentUser.roles.includes('admin')) {
      requestLogger.warn('Non-admin attempted to list users', { userId: currentUser.id });
      sendError(res, 'FORBIDDEN', 'Only administrators can list users', 403);
      return;
    }

    // Get optional query params
    const { role, search, limit, offset } = req.query;

    // Validate role if provided
    const validRoles = ['admin', 'node', 'viewer'] as const;
    type UserRole = typeof validRoles[number];
    const roleFilter = role && validRoles.includes(role as UserRole) 
      ? (role as UserRole) 
      : undefined;

    const userQueries = getUserQueries();
    const result = await userQueries.listUsers({
      role: roleFilter,
      search: search as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    if (result.error) {
      requestLogger.error('Error listing users', new Error(result.error.message));
      sendError(res, 'INTERNAL_ERROR', 'Failed to list users', 500);
      return;
    }

    const users = result.data ?? [];

    sendSuccess(res, {
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        roles: u.roles,
        createdAt: u.createdAt.toISOString(),
        updatedAt: u.updatedAt.toISOString(),
      })),
      count: users.length,
    }, 200);
  } catch (error) {
    requestLogger.error('Error listing users', error instanceof Error ? error : undefined);
    sendError(res, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
  }
}

// ============================================================================
// Router
// ============================================================================

/**
 * Creates the auth router with all endpoints
 */
export function createAuthRouter(): Router {
  const router = Router();

  router.post('/register', register);
  router.post('/login', login);
  router.post('/logout', logout);
  router.post('/refresh', refresh);
  router.get('/setup/status', setupStatus);
  router.post('/setup', setup);
  router.get('/users', listUsers);
  router.post('/users', createUser);

  return router;
}

// Default export for convenience
export default createAuthRouter;
