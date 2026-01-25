/**
 * Auth service wrapping Supabase Auth
 * Handles user authentication, session management, and authorization
 * @module @stark-o/core/services/auth
 */

import { shallowRef, computed, type ComputedRef, type ShallowRef } from '@vue/reactivity';
import type {
  User,
  UserRole,
  UserSession,
} from '@stark-o/shared';
import {
  hasRole,
  hasAnyRole,
  canManageResources,
  isNodeAgent,
  createServiceLogger,
} from '@stark-o/shared';
import {
  UserModel,
  UserSessionModel,
  type UserLoginResult,
} from '../models/user';

/**
 * Logger for auth service operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'auth-service' });

// ============================================================================
// Types
// ============================================================================

/**
 * Auth provider interface for dependency injection
 * This allows the core package to remain isomorphic while the server
 * provides the actual Supabase implementation
 */
export interface AuthProvider {
  /** Register a new user */
  registerUser(input: RegisterAuthInput): Promise<AuthProviderResult<UserSession>>;
  /** Login an existing user */
  loginUser(credentials: LoginAuthInput): Promise<AuthProviderResult<UserSession>>;
  /** Logout the current user */
  logoutUser(accessToken: string): Promise<AuthProviderResult<void>>;
  /** Refresh the session token */
  refreshSession(refreshToken: string): Promise<AuthProviderResult<UserSession>>;
  /** Get user by ID */
  getUserById(userId: string): Promise<AuthProviderResult<User>>;
  /** Verify an access token */
  verifyToken(accessToken: string): Promise<AuthProviderResult<User>>;
  /** Update user profile */
  updateUser(userId: string, updates: UpdateAuthInput): Promise<AuthProviderResult<User>>;
  /** Delete user account */
  deleteUser(userId: string): Promise<AuthProviderResult<void>>;
}

/**
 * Auth provider result
 */
export interface AuthProviderResult<T> {
  data: T | null;
  error: AuthProviderError | null;
}

/**
 * Auth provider error
 */
export interface AuthProviderError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Registration input for auth provider
 */
export interface RegisterAuthInput {
  email: string;
  password: string;
  displayName?: string;
  roles?: UserRole[];
}

/**
 * Login input for auth provider
 */
export interface LoginAuthInput {
  email: string;
  password: string;
}

/**
 * Update user input for auth provider
 */
export interface UpdateAuthInput {
  displayName?: string;
  roles?: UserRole[];
}

/**
 * Auth service options
 */
export interface AuthServiceOptions {
  /** Auth provider (Supabase implementation) */
  provider?: AuthProvider;
  /** Session timeout in milliseconds */
  sessionTimeoutMs?: number;
  /** Session refresh threshold in milliseconds */
  sessionRefreshThresholdMs?: number;
  /** Enable automatic session refresh */
  enableAutoRefresh?: boolean;
  /** Auto refresh interval in milliseconds */
  autoRefreshIntervalMs?: number;
}

/**
 * Auth operation result
 */
export interface AuthOperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Session state for tracking current user
 */
export interface SessionState {
  /** Current session model */
  session: UserSessionModel | null;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Whether session is being refreshed */
  isRefreshing: boolean;
  /** Last activity timestamp */
  lastActivity: Date | null;
}

/**
 * Auth service error codes
 */
export const AuthServiceErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  REFRESH_FAILED: 'REFRESH_FAILED',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/**
 * Password validation requirements
 */
export interface PasswordRequirements {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
}

/**
 * Default password requirements
 */
export const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecialChar: false,
};

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validation error detail
 */
interface ValidationErrorDetail {
  code: string;
  message: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  valid: boolean;
  errors: Record<string, ValidationErrorDetail>;
}

/**
 * Validate email format
 */
export function validateEmail(email: unknown): ValidationErrorDetail | null {
  if (email === undefined || email === null || email === '') {
    return { code: 'REQUIRED', message: 'Email is required' };
  }
  if (typeof email !== 'string') {
    return { code: 'INVALID_TYPE', message: 'Email must be a string' };
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return { code: 'INVALID_FORMAT', message: 'Invalid email format' };
  }
  return null;
}

/**
 * Validate password against requirements
 */
export function validatePassword(
  password: unknown,
  requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
): ValidationErrorDetail | null {
  if (password === undefined || password === null || password === '') {
    return { code: 'REQUIRED', message: 'Password is required' };
  }
  if (typeof password !== 'string') {
    return { code: 'INVALID_TYPE', message: 'Password must be a string' };
  }
  if (password.length < requirements.minLength) {
    return {
      code: 'TOO_SHORT',
      message: `Password must be at least ${requirements.minLength} characters`,
    };
  }
  if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
    return {
      code: 'MISSING_UPPERCASE',
      message: 'Password must contain at least one uppercase letter',
    };
  }
  if (requirements.requireLowercase && !/[a-z]/.test(password)) {
    return {
      code: 'MISSING_LOWERCASE',
      message: 'Password must contain at least one lowercase letter',
    };
  }
  if (requirements.requireDigit && !/\d/.test(password)) {
    return {
      code: 'MISSING_DIGIT',
      message: 'Password must contain at least one digit',
    };
  }
  if (requirements.requireSpecialChar && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    return {
      code: 'MISSING_SPECIAL_CHAR',
      message: 'Password must contain at least one special character',
    };
  }
  return null;
}

/**
 * Validate display name
 */
export function validateDisplayName(displayName: unknown): ValidationErrorDetail | null {
  if (displayName === undefined || displayName === null || displayName === '') {
    return null; // Optional field
  }
  if (typeof displayName !== 'string') {
    return { code: 'INVALID_TYPE', message: 'Display name must be a string' };
  }
  if (displayName.length > 100) {
    return {
      code: 'TOO_LONG',
      message: 'Display name must be at most 100 characters',
    };
  }
  return null;
}

/**
 * Validate registration input
 */
export function validateRegisterInput(input: unknown): ValidationResult {
  const errors: Record<string, ValidationErrorDetail> = {};

  if (input === null || input === undefined || typeof input !== 'object') {
    return {
      valid: false,
      errors: { _root: { code: 'INVALID_INPUT', message: 'Invalid input' } },
    };
  }

  const data = input as Record<string, unknown>;

  const emailError = validateEmail(data.email);
  if (emailError) {
    errors.email = emailError;
  }

  const passwordError = validatePassword(data.password);
  if (passwordError) {
    errors.password = passwordError;
  }

  const displayNameError = validateDisplayName(data.displayName);
  if (displayNameError) {
    errors.displayName = displayNameError;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate login input
 */
export function validateLoginInput(input: unknown): ValidationResult {
  const errors: Record<string, ValidationErrorDetail> = {};

  if (input === null || input === undefined || typeof input !== 'object') {
    return {
      valid: false,
      errors: { _root: { code: 'INVALID_INPUT', message: 'Invalid input' } },
    };
  }

  const data = input as Record<string, unknown>;

  const emailError = validateEmail(data.email);
  if (emailError) {
    errors.email = emailError;
  }

  // For login, we only check if password is present, not its strength
  if (data.password === undefined || data.password === null || data.password === '') {
    errors.password = { code: 'REQUIRED', message: 'Password is required' };
  } else if (typeof data.password !== 'string') {
    errors.password = { code: 'INVALID_TYPE', message: 'Password must be a string' };
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Normalize email (trim, lowercase)
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ============================================================================
// Auth Service Class
// ============================================================================

/**
 * Auth Service
 * Manages user authentication, session lifecycle, and authorization
 */
export class AuthService {
  private provider: AuthProvider | null;
  private readonly enableAutoRefresh: boolean;
  private readonly autoRefreshIntervalMs: number;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // Reactive state (using shallowRef for class instances)
  private readonly _currentSession: ShallowRef<UserSessionModel | null>;
  private readonly _isRefreshing: ShallowRef<boolean>;
  private readonly _lastActivity: ShallowRef<Date | null>;

  constructor(options: AuthServiceOptions = {}) {
    this.provider = options.provider ?? null;
    this.enableAutoRefresh = options.enableAutoRefresh ?? true;
    this.autoRefreshIntervalMs = options.autoRefreshIntervalMs ?? 60_000; // 1 minute

    // Initialize reactive state (shallowRef for class instances to avoid deep proxying)
    this._currentSession = shallowRef<UserSessionModel | null>(null);
    this._isRefreshing = shallowRef(false);
    this._lastActivity = shallowRef<Date | null>(null);
  }

  // ===========================================================================
  // Computed Properties (reactive)
  // ===========================================================================

  /**
   * Current session (reactive)
   */
  get currentSession(): ComputedRef<UserSessionModel | null> {
    return computed(() => this._currentSession.value);
  }

  /**
   * Current user (reactive)
   */
  get currentUser(): ComputedRef<UserModel | null> {
    return computed(() => this._currentSession.value?.user ?? null);
  }

  /**
   * Whether user is authenticated (reactive)
   */
  get isAuthenticated(): ComputedRef<boolean> {
    return computed(() => {
      const session = this._currentSession.value;
      if (!session) {
        return false;
      }
      return !session.isExpired.value;
    });
  }

  /**
   * Whether session is being refreshed (reactive)
   */
  get isRefreshing(): ComputedRef<boolean> {
    return computed(() => this._isRefreshing.value);
  }

  /**
   * Whether session should be refreshed soon (reactive)
   */
  get shouldRefreshSession(): ComputedRef<boolean> {
    return computed(() => {
      const session = this._currentSession.value;
      if (!session) {
        return false;
      }
      return session.shouldRefresh.value;
    });
  }

  /**
   * Time remaining until session expires in milliseconds (reactive)
   */
  get sessionTimeRemaining(): ComputedRef<number> {
    return computed(() => {
      const session = this._currentSession.value;
      if (!session) {
        return 0;
      }
      return session.timeRemaining.value;
    });
  }

  /**
   * Current user ID (reactive)
   */
  get currentUserId(): ComputedRef<string | null> {
    return computed(() => this._currentSession.value?.user?.id ?? null);
  }

  /**
   * Current user roles (reactive)
   */
  get currentUserRoles(): ComputedRef<UserRole[]> {
    return computed(() => this._currentSession.value?.user?.roles ?? []);
  }

  /**
   * Whether current user is admin (reactive)
   */
  get isAdmin(): ComputedRef<boolean> {
    return computed(() => {
      const user = this._currentSession.value?.user;
      if (!user) {
        return false;
      }
      return hasRole(user.data, 'admin');
    });
  }

  /**
   * Whether current user can manage resources (reactive)
   */
  get canManageResources(): ComputedRef<boolean> {
    return computed(() => {
      const user = this._currentSession.value?.user;
      if (!user) {
        return false;
      }
      return canManageResources(user.data);
    });
  }

  /**
   * Whether current user is a node agent (reactive)
   */
  get isNodeAgent(): ComputedRef<boolean> {
    return computed(() => {
      const user = this._currentSession.value?.user;
      if (!user) {
        return false;
      }
      return isNodeAgent(user.data);
    });
  }

  // ===========================================================================
  // Provider Configuration
  // ===========================================================================

  /**
   * Set the auth provider
   * @param provider - The auth provider implementation
   */
  setProvider(provider: AuthProvider): void {
    this.provider = provider;
    logger.info('Auth provider configured');
  }

  /**
   * Check if provider is configured
   */
  hasProvider(): boolean {
    return this.provider !== null;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  /**
   * Register a new user
   * @param input - Registration input (email, password, displayName)
   * @returns Registration result with session
   */
  async register(input: RegisterAuthInput): Promise<AuthOperationResult<UserLoginResult>> {
    logger.debug('Attempting user registration', { email: input.email });

    // Validate input
    const validation = validateRegisterInput(input);
    if (!validation.valid) {
      logger.warn('Registration validation failed', {
        email: input.email,
        errorCount: Object.keys(validation.errors).length,
      });
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.VALIDATION_ERROR,
          message: 'Validation failed',
          details: validation.errors,
        },
      };
    }

    // Check provider
    if (!this.provider) {
      logger.error('Auth provider not configured');
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED,
          message: 'Auth provider not configured',
        },
      };
    }

    // Normalize email
    const normalizedInput: RegisterAuthInput = {
      ...input,
      email: normalizeEmail(input.email),
    };

    // Register with provider
    const result = await this.provider.registerUser(normalizedInput);

    if (result.error) {
      logger.warn('Registration failed', {
        email: normalizedInput.email,
        errorCode: result.error.code,
      });
      return this.mapProviderError(result.error);
    }

    if (!result.data) {
      logger.error('Registration returned no data', { email: normalizedInput.email });
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.INTERNAL_ERROR,
          message: 'Registration failed unexpectedly',
        },
      };
    }

    // Set current session
    const sessionModel = new UserSessionModel(result.data);
    this._currentSession.value = sessionModel;
    this._lastActivity.value = new Date();

    // Start auto-refresh if enabled
    if (this.enableAutoRefresh) {
      this.startAutoRefresh();
    }

    logger.info('User registered successfully', {
      userId: result.data.user.id,
      email: result.data.user.email,
    });

    return {
      success: true,
      data: {
        user: result.data.user,
        session: result.data,
      },
    };
  }

  // ===========================================================================
  // Login
  // ===========================================================================

  /**
   * Login an existing user
   * @param credentials - Login credentials (email, password)
   * @returns Login result with session
   */
  async login(credentials: LoginAuthInput): Promise<AuthOperationResult<UserLoginResult>> {
    logger.debug('Attempting user login', { email: credentials.email });

    // Validate input
    const validation = validateLoginInput(credentials);
    if (!validation.valid) {
      logger.warn('Login validation failed', {
        email: credentials.email,
        errorCount: Object.keys(validation.errors).length,
      });
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.VALIDATION_ERROR,
          message: 'Validation failed',
          details: validation.errors,
        },
      };
    }

    // Check provider
    if (!this.provider) {
      logger.error('Auth provider not configured');
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED,
          message: 'Auth provider not configured',
        },
      };
    }

    // Normalize credentials
    const normalizedCredentials: LoginAuthInput = {
      email: normalizeEmail(credentials.email),
      password: credentials.password,
    };

    // Login with provider
    const result = await this.provider.loginUser(normalizedCredentials);

    if (result.error) {
      logger.warn('Login failed', {
        email: normalizedCredentials.email,
        errorCode: result.error.code,
      });
      return this.mapProviderError(result.error);
    }

    if (!result.data) {
      logger.error('Login returned no data', { email: normalizedCredentials.email });
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.INTERNAL_ERROR,
          message: 'Login failed unexpectedly',
        },
      };
    }

    // Set current session
    const sessionModel = new UserSessionModel(result.data);
    this._currentSession.value = sessionModel;
    this._lastActivity.value = new Date();

    // Start auto-refresh if enabled
    if (this.enableAutoRefresh) {
      this.startAutoRefresh();
    }

    logger.info('User logged in successfully', {
      userId: result.data.user.id,
      email: result.data.user.email,
    });

    return {
      success: true,
      data: {
        user: result.data.user,
        session: result.data,
      },
    };
  }

  // ===========================================================================
  // Logout
  // ===========================================================================

  /**
   * Logout the current user
   * @returns Logout result
   */
  async logout(): Promise<AuthOperationResult<void>> {
    const session = this._currentSession.value;
    
    if (!session) {
      logger.debug('Logout called with no active session');
      return { success: true };
    }

    logger.debug('Attempting user logout', { userId: session.user.id });

    // Stop auto-refresh
    this.stopAutoRefresh();

    // Check provider
    if (!this.provider) {
      // No provider, just clear local session
      this._currentSession.value = null;
      this._lastActivity.value = null;
      logger.info('Local session cleared (no provider)');
      return { success: true };
    }

    // Logout with provider
    const result = await this.provider.logoutUser(session.accessToken);

    // Always clear local session, even if provider logout fails
    this._currentSession.value = null;
    this._lastActivity.value = null;

    if (result.error) {
      logger.warn('Provider logout failed, local session cleared', {
        errorCode: result.error.code,
      });
      // Still return success since local session is cleared
      return { success: true };
    }

    logger.info('User logged out successfully');
    return { success: true };
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  /**
   * Refresh the current session
   * @returns Refresh result
   */
  async refreshSession(): Promise<AuthOperationResult<UserSession>> {
    const session = this._currentSession.value;

    if (!session) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.SESSION_NOT_FOUND,
          message: 'No active session to refresh',
        },
      };
    }

    if (session.refreshToken === undefined || session.refreshToken === null || session.refreshToken === '') {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.REFRESH_FAILED,
          message: 'No refresh token available',
        },
      };
    }

    if (!this.provider) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED,
          message: 'Auth provider not configured',
        },
      };
    }

    this._isRefreshing.value = true;
    logger.debug('Refreshing session', { userId: session.user.id });

    try {
      const result = await this.provider.refreshSession(session.refreshToken);

      if (result.error) {
        logger.warn('Session refresh failed', {
          userId: session.user.id,
          errorCode: result.error.code,
        });
        return this.mapProviderError(result.error);
      }

      if (!result.data) {
        logger.error('Session refresh returned no data');
        return {
          success: false,
          error: {
            code: AuthServiceErrorCodes.REFRESH_FAILED,
            message: 'Session refresh failed unexpectedly',
          },
        };
      }

      // Update session tokens
      session.updateTokens(
        result.data.accessToken,
        result.data.expiresAt,
        result.data.refreshToken
      );

      this._lastActivity.value = new Date();

      logger.info('Session refreshed successfully', { userId: session.user.id });

      return {
        success: true,
        data: session.toJSON(),
      };
    } finally {
      this._isRefreshing.value = false;
    }
  }

  /**
   * Initialize session from stored tokens
   * @param session - Stored session data
   * @returns Whether session was restored successfully
   */
  restoreSession(session: UserSession): boolean {
    // Check if session is expired
    if (new Date() >= session.expiresAt) {
      logger.debug('Cannot restore expired session');
      return false;
    }

    const sessionModel = new UserSessionModel(session);
    this._currentSession.value = sessionModel;
    this._lastActivity.value = new Date();

    // Start auto-refresh if enabled
    if (this.enableAutoRefresh) {
      this.startAutoRefresh();
    }

    logger.info('Session restored', { userId: session.user.id });
    return true;
  }

  /**
   * Clear the current session without calling provider
   */
  clearSession(): void {
    this.stopAutoRefresh();
    this._currentSession.value = null;
    this._lastActivity.value = null;
    logger.debug('Session cleared');
  }

  // ===========================================================================
  // User Operations
  // ===========================================================================

  /**
   * Get user by ID
   * @param userId - User ID
   * @returns User or error
   */
  async getUser(userId: string): Promise<AuthOperationResult<User>> {
    if (!this.provider) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED,
          message: 'Auth provider not configured',
        },
      };
    }

    const result = await this.provider.getUserById(userId);

    if (result.error) {
      return this.mapProviderError(result.error);
    }

    if (!result.data) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.USER_NOT_FOUND,
          message: `User ${userId} not found`,
        },
      };
    }

    return {
      success: true,
      data: result.data,
    };
  }

  /**
   * Verify an access token
   * @param accessToken - Access token to verify
   * @returns User from token or error
   */
  async verifyToken(accessToken: string): Promise<AuthOperationResult<User>> {
    if (!this.provider) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED,
          message: 'Auth provider not configured',
        },
      };
    }

    const result = await this.provider.verifyToken(accessToken);

    if (result.error) {
      return this.mapProviderError(result.error);
    }

    if (!result.data) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.UNAUTHORIZED,
          message: 'Invalid or expired token',
        },
      };
    }

    return {
      success: true,
      data: result.data,
    };
  }

  // ===========================================================================
  // Authorization Helpers
  // ===========================================================================

  /**
   * Check if current user has a specific role
   * @param role - Role to check
   */
  hasRole(role: UserRole): boolean {
    const user = this._currentSession.value?.user;
    if (!user) {
      return false;
    }
    return hasRole(user.data, role);
  }

  /**
   * Check if current user has any of the specified roles
   * @param roles - Roles to check
   */
  hasAnyRole(roles: UserRole[]): boolean {
    const user = this._currentSession.value?.user;
    if (!user) {
      return false;
    }
    return hasAnyRole(user.data, roles);
  }

  /**
   * Assert that user is authenticated
   * @throws AuthOperationResult with error if not authenticated
   */
  requireAuthentication(): AuthOperationResult<User> {
    const session = this._currentSession.value;
    if (!session) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.UNAUTHORIZED,
          message: 'Authentication required',
        },
      };
    }

    if (session.isExpired.value) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.SESSION_EXPIRED,
          message: 'Session has expired',
        },
      };
    }

    return {
      success: true,
      data: session.user.data,
    };
  }

  /**
   * Assert that user has required role
   * @param role - Required role
   */
  requireRole(role: UserRole): AuthOperationResult<User> {
    const authResult = this.requireAuthentication();
    if (!authResult.success) {
      return authResult;
    }

    if (!hasRole(authResult.data!, role)) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.FORBIDDEN,
          message: `Role '${role}' is required`,
        },
      };
    }

    return authResult;
  }

  /**
   * Assert that user has any of the required roles
   * @param roles - Required roles (any)
   */
  requireAnyRole(roles: UserRole[]): AuthOperationResult<User> {
    const authResult = this.requireAuthentication();
    if (!authResult.success) {
      return authResult;
    }

    if (!hasAnyRole(authResult.data!, roles)) {
      return {
        success: false,
        error: {
          code: AuthServiceErrorCodes.FORBIDDEN,
          message: `One of roles [${roles.join(', ')}] is required`,
        },
      };
    }

    return authResult;
  }

  // ===========================================================================
  // Activity Tracking
  // ===========================================================================

  /**
   * Record user activity (extends session)
   */
  recordActivity(): void {
    if (this._currentSession.value) {
      this._lastActivity.value = new Date();
    }
  }

  /**
   * Get last activity timestamp
   */
  getLastActivity(): Date | null {
    return this._lastActivity.value;
  }

  // ===========================================================================
  // Auto-Refresh
  // ===========================================================================

  /**
   * Start automatic session refresh
   */
  private startAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      return; // Already running
    }

    this.autoRefreshTimer = setInterval(() => {
      const session = this._currentSession.value;
      if (!session) {
        this.stopAutoRefresh();
        return;
      }

      if (session.shouldRefresh.value && !this._isRefreshing.value) {
        // Fire and forget - errors are handled internally
        void this.refreshSession();
      }
    }, this.autoRefreshIntervalMs);

    logger.debug('Auto-refresh started', {
      intervalMs: this.autoRefreshIntervalMs,
    });
  }

  /**
   * Stop automatic session refresh
   */
  private stopAutoRefresh(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
      logger.debug('Auto-refresh stopped');
    }
  }

  // ===========================================================================
  // Error Mapping
  // ===========================================================================

  /**
   * Map provider error to operation result
   */
  private mapProviderError(error: AuthProviderError): AuthOperationResult<never> {
    const codeMapping: Record<string, { code: string; message: string }> = {
      USER_ALREADY_EXISTS: {
        code: AuthServiceErrorCodes.USER_ALREADY_EXISTS,
        message: 'User with this email already exists',
      },
      INVALID_CREDENTIALS: {
        code: AuthServiceErrorCodes.INVALID_CREDENTIALS,
        message: 'Invalid email or password',
      },
      USER_NOT_FOUND: {
        code: AuthServiceErrorCodes.USER_NOT_FOUND,
        message: 'User not found',
      },
      SESSION_EXPIRED: {
        code: AuthServiceErrorCodes.SESSION_EXPIRED,
        message: 'Session has expired',
      },
      RATE_LIMIT_EXCEEDED: {
        code: AuthServiceErrorCodes.RATE_LIMIT_EXCEEDED,
        message: 'Too many attempts. Please try again later.',
      },
      ACCOUNT_LOCKED: {
        code: AuthServiceErrorCodes.ACCOUNT_LOCKED,
        message: 'Account is locked. Please contact support.',
      },
      INTERNAL_ERROR: {
        code: AuthServiceErrorCodes.INTERNAL_ERROR,
        message: 'An internal error occurred',
      },
    };

    const mapped = codeMapping[error.code];
    if (mapped) {
      return {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
          details: error.details,
        },
      };
    }

    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Destroy the auth service and clean up resources
   */
  destroy(): void {
    this.stopAutoRefresh();
    this._currentSession.value = null;
    this._lastActivity.value = null;
    this.provider = null;
    logger.debug('Auth service destroyed');
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default auth service instance
 */
export const authService = new AuthService();

/**
 * Create a new auth service with custom options
 */
export function createAuthService(options?: AuthServiceOptions): AuthService {
  return new AuthService(options);
}
