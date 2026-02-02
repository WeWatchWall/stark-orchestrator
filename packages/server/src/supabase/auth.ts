/**
 * Supabase Auth Integration
 *
 * Provides authentication operations using Supabase Auth.
 * Implements the AuthProvider interface from @stark-o/core/services/auth.
 * @module @stark-o/server/supabase/auth
 */

import type { SupabaseClient, AuthError, PostgrestError } from '@supabase/supabase-js';
import type { User, UserRole, UserSession } from '@stark-o/shared';
import type {
  AuthProvider,
  AuthProviderResult,
  AuthProviderError,
  RegisterAuthInput,
  LoginAuthInput,
  UpdateAuthInput,
} from '@stark-o/core';
import { getSupabaseClient, getSupabaseServiceClient, createSupabaseUserClient } from './client.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Database row type for users table
 */
interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  roles: string[];
  created_at: string;
  updated_at: string;
}

/**
 * Result type for user query operations
 */
export interface AuthResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Converts a Supabase AuthError to an AuthProviderError
 */
function authErrorToProviderError(authErr: AuthError): AuthProviderError {
  return {
    code: mapAuthErrorCode(authErr.message),
    message: authErr.message,
    details: {
      status: authErr.status,
      name: authErr.name,
    },
  };
}

/**
 * Maps Supabase auth error messages to error codes
 */
function mapAuthErrorCode(message: string): string {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('email already registered') || lowerMessage.includes('user already registered')) {
    return 'USER_ALREADY_EXISTS';
  }
  if (lowerMessage.includes('invalid login credentials') || lowerMessage.includes('invalid password')) {
    return 'INVALID_CREDENTIALS';
  }
  if (
    lowerMessage.includes('user not found') ||
    lowerMessage.includes('no user found') ||
    lowerMessage.includes('sub claim') ||
    lowerMessage.includes('does not exist')
  ) {
    return 'USER_NOT_FOUND';
  }
  if (lowerMessage.includes('token expired') || lowerMessage.includes('jwt expired')) {
    return 'TOKEN_EXPIRED';
  }
  if (lowerMessage.includes('invalid token') || lowerMessage.includes('invalid jwt')) {
    return 'TOKEN_INVALID';
  }
  if (lowerMessage.includes('session not found') || lowerMessage.includes('no session')) {
    return 'SESSION_NOT_FOUND';
  }
  if (lowerMessage.includes('refresh token')) {
    return 'REFRESH_FAILED';
  }
  if (lowerMessage.includes('rate limit')) {
    return 'RATE_LIMIT_EXCEEDED';
  }
  if (lowerMessage.includes('email not confirmed')) {
    return 'EMAIL_NOT_CONFIRMED';
  }
  if (lowerMessage.includes('password') && lowerMessage.includes('weak')) {
    return 'WEAK_PASSWORD';
  }

  return 'AUTH_ERROR';
}

/**
 * Converts a database row to a User entity
 */
function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    roles: row.roles as UserRole[],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Creates a UserSession from Supabase session data and user row
 */
function createUserSession(
  user: User,
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number | null
): UserSession {
  // Handle expiresAt: if it's a valid positive number, use it; otherwise default to 1 hour
  const expiresAtMs = typeof expiresAt === 'number' && expiresAt > 0
    ? expiresAt * 1000
    : Date.now() + 3600 * 1000;

  return {
    user,
    accessToken,
    refreshToken,
    expiresAt: new Date(expiresAtMs),
  };
}

// ============================================================================
// Auth Queries Class
// ============================================================================

/**
 * Auth queries class implementing the AuthProvider interface
 */
export class SupabaseAuthProvider implements AuthProvider {
  private client: SupabaseClient;
  private adminClient: SupabaseClient;

  constructor(client?: SupabaseClient, adminClient?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
    this.adminClient = adminClient ?? getSupabaseServiceClient();
  }

  /**
   * Register a new user with email and password
   */
  async registerUser(input: RegisterAuthInput): Promise<AuthProviderResult<UserSession>> {
    try {
      // Sign up with Supabase Auth
      const signUpResult = await this.client.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: {
            display_name: input.displayName,
            roles: input.roles ?? ['viewer'],
          },
        },
      });

      if (signUpResult.error) {
        return { data: null, error: authErrorToProviderError(signUpResult.error) };
      }

      const authUser = signUpResult.data.user;
      const authSession = signUpResult.data.session;

      if (authUser === null || authSession === null) {
        return {
          data: null,
          error: {
            code: 'REGISTRATION_FAILED',
            message: 'Registration completed but no session returned',
          },
        };
      }

      // Fetch the user profile from public.users table
      const fetchResult = await this.adminClient
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      // Check if we need to create the profile manually
      if (fetchResult.error !== null) {
        // User profile might not be created yet by the trigger, create manually
        const createResult = await this.adminClient
          .from('users')
          .insert({
            id: authUser.id,
            email: input.email,
            display_name: input.displayName ?? input.email.split('@')[0],
            roles: input.roles ?? ['viewer'],
          })
          .select()
          .single();

        if (createResult.error !== null) {
          return {
            data: null,
            error: {
              code: 'PROFILE_CREATION_FAILED',
              message: `Failed to create user profile: ${createResult.error.message}`,
            },
          };
        }

        const user = rowToUser(createResult.data as UserRow);
        const session = createUserSession(
          user,
          authSession.access_token,
          authSession.refresh_token,
          authSession.expires_at
        );

        return { data: session, error: null };
      }

      const user = rowToUser(fetchResult.data as UserRow);
      const session = createUserSession(
        user,
        authSession.access_token,
        authSession.refresh_token,
        authSession.expires_at
      );

      return { data: session, error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error during registration',
        },
      };
    }
  }

  /**
   * Login an existing user with email and password
   */
  async loginUser(credentials: LoginAuthInput): Promise<AuthProviderResult<UserSession>> {
    try {
      const signInResult = await this.client.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (signInResult.error) {
        return { data: null, error: authErrorToProviderError(signInResult.error) };
      }

      const authUser = signInResult.data.user;
      const authSession = signInResult.data.session;

      if (authUser === null || authSession === null) {
        return {
          data: null,
          error: {
            code: 'LOGIN_FAILED',
            message: 'Login completed but no session returned',
          },
        };
      }

      // Fetch the user profile from public.users table
      const fetchResult = await this.adminClient
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (fetchResult.error !== null) {
        return {
          data: null,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User authenticated but profile not found',
          },
        };
      }

      const user = rowToUser(fetchResult.data as UserRow);
      const session = createUserSession(
        user,
        authSession.access_token,
        authSession.refresh_token,
        authSession.expires_at
      );

      return { data: session, error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error during login',
        },
      };
    }
  }

  /**
   * Logout the current user by invalidating the session
   */
  async logoutUser(_accessToken: string): Promise<AuthProviderResult<void>> {
    try {
      // Create a client scoped to the user's session for proper sign-out
      const userClient = createSupabaseUserClient(_accessToken);
      const signOutResult = await userClient.auth.signOut();

      if (signOutResult.error) {
        return { data: null, error: authErrorToProviderError(signOutResult.error) };
      }

      return { data: undefined, error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error during logout',
        },
      };
    }
  }

  /**
   * Refresh the session using a refresh token
   */
  async refreshSession(refreshToken: string): Promise<AuthProviderResult<UserSession>> {
    try {
      const refreshResult = await this.client.auth.refreshSession({
        refresh_token: refreshToken,
      });

      if (refreshResult.error) {
        return { data: null, error: authErrorToProviderError(refreshResult.error) };
      }

      const authUser = refreshResult.data.user;
      const authSession = refreshResult.data.session;

      if (authUser === null || authSession === null) {
        return {
          data: null,
          error: {
            code: 'REFRESH_FAILED',
            message: 'Refresh completed but no session returned',
          },
        };
      }

      // Fetch the user profile from public.users table
      const fetchResult = await this.adminClient
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (fetchResult.error !== null) {
        return {
          data: null,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'Session refreshed but user profile not found',
          },
        };
      }

      const user = rowToUser(fetchResult.data as UserRow);
      const session = createUserSession(
        user,
        authSession.access_token,
        authSession.refresh_token,
        authSession.expires_at
      );

      return { data: session, error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error during session refresh',
        },
      };
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<AuthProviderResult<User>> {
    try {
      const fetchResult = await this.adminClient
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (fetchResult.error !== null) {
        if (fetchResult.error.code === 'PGRST116') {
          return {
            data: null,
            error: {
              code: 'USER_NOT_FOUND',
              message: `User with ID ${userId} not found`,
            },
          };
        }
        return {
          data: null,
          error: {
            code: 'DATABASE_ERROR',
            message: fetchResult.error.message,
          },
        };
      }

      return { data: rowToUser(fetchResult.data as UserRow), error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error fetching user',
        },
      };
    }
  }

  /**
   * Verify an access token and return the user
   */
  async verifyToken(accessToken: string): Promise<AuthProviderResult<User>> {
    try {
      // Use getUser which verifies the token server-side
      const getUserResult = await this.adminClient.auth.getUser(accessToken);

      if (getUserResult.error) {
        return { data: null, error: authErrorToProviderError(getUserResult.error) };
      }

      const authUser = getUserResult.data.user;
      if (authUser === null) {
        return {
          data: null,
          error: {
            code: 'TOKEN_INVALID',
            message: 'Token is invalid or expired',
          },
        };
      }

      // Fetch the user profile from public.users table
      const fetchResult = await this.adminClient
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (fetchResult.error !== null) {
        return {
          data: null,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'Token valid but user profile not found',
          },
        };
      }

      return { data: rowToUser(fetchResult.data as UserRow), error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error verifying token',
        },
      };
    }
  }

  /**
   * Update user profile
   */
  async updateUser(userId: string, updates: UpdateAuthInput): Promise<AuthProviderResult<User>> {
    try {
      const updateData: Record<string, unknown> = {};

      if (updates.displayName !== undefined) {
        updateData['display_name'] = updates.displayName;
      }

      if (updates.roles !== undefined) {
        updateData['roles'] = updates.roles;
      }

      if (Object.keys(updateData).length === 0) {
        // Nothing to update, just fetch current user
        return this.getUserById(userId);
      }

      const updateResult = await this.adminClient
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (updateResult.error !== null) {
        if (updateResult.error.code === 'PGRST116') {
          return {
            data: null,
            error: {
              code: 'USER_NOT_FOUND',
              message: `User with ID ${userId} not found`,
            },
          };
        }
        return {
          data: null,
          error: {
            code: 'DATABASE_ERROR',
            message: updateResult.error.message,
          },
        };
      }

      return { data: rowToUser(updateResult.data as UserRow), error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error updating user',
        },
      };
    }
  }

  /**
   * Delete user account (admin only)
   */
  async deleteUser(userId: string): Promise<AuthProviderResult<void>> {
    try {
      // Delete from auth.users (cascades to public.users)
      const deleteResult = await this.adminClient.auth.admin.deleteUser(userId);

      if (deleteResult.error) {
        return { data: null, error: authErrorToProviderError(deleteResult.error) };
      }

      return { data: undefined, error: null };
    } catch (err) {
      return {
        data: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error deleting user',
        },
      };
    }
  }
}

// ============================================================================
// User Queries (non-auth operations)
// ============================================================================

/**
 * User queries class for non-auth database operations
 */
export class UserQueries {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseServiceClient();
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<AuthResult<User>> {
    const result = await this.client
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (result.error !== null) {
      return { data: null, error: result.error };
    }

    return { data: rowToUser(result.data as UserRow), error: null };
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<AuthResult<User>> {
    const result = await this.client
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (result.error !== null) {
      return { data: null, error: result.error };
    }

    return { data: rowToUser(result.data as UserRow), error: null };
  }

  /**
   * List users with optional filtering
   */
  async listUsers(options?: {
    role?: UserRole;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<AuthResult<User[]>> {
    let query = this.client.from('users').select('*');

    if (options?.role) {
      query = query.contains('roles', [options.role]);
    }

    if (options?.search) {
      query = query.or(`email.ilike.%${options.search}%,display_name.ilike.%${options.search}%`);
    }

    query = query.order('created_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
    }

    const result = await query;

    if (result.error !== null) {
      return { data: null, error: result.error };
    }

    return {
      data: (result.data as UserRow[]).map(rowToUser),
      error: null,
    };
  }

  /**
   * Count users with optional filtering
   */
  async countUsers(options?: { role?: UserRole; search?: string }): Promise<AuthResult<number>> {
    let query = this.client.from('users').select('id', { count: 'exact', head: true });

    if (options?.role) {
      query = query.contains('roles', [options.role]);
    }

    if (options?.search) {
      query = query.or(`email.ilike.%${options.search}%,display_name.ilike.%${options.search}%`);
    }

    const result = await query;

    if (result.error !== null) {
      return { data: null, error: result.error };
    }

    return { data: result.count ?? 0, error: null };
  }

  /**
   * Check if a user with the given email exists
   */
  async userExists(email: string): Promise<AuthResult<boolean>> {
    const result = await this.client
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('email', email.toLowerCase());

    if (result.error !== null) {
      return { data: null, error: result.error };
    }

    return { data: (result.count ?? 0) > 0, error: null };
  }

  /**
   * Update user roles (admin operation)
   */
  async updateUserRoles(userId: string, roles: UserRole[]): Promise<AuthResult<User>> {
    const result = await this.client
      .from('users')
      .update({ roles })
      .eq('id', userId)
      .select()
      .single();

    if (result.error !== null) {
      return { data: null, error: result.error };
    }

    return { data: rowToUser(result.data as UserRow), error: null };
  }
}

// ============================================================================
// Singleton instances
// ============================================================================

let _authProvider: SupabaseAuthProvider | null = null;
let _userQueries: UserQueries | null = null;

/**
 * Gets or creates the singleton SupabaseAuthProvider
 */
export function getAuthProvider(): SupabaseAuthProvider {
  if (_authProvider === null) {
    _authProvider = new SupabaseAuthProvider();
  }
  return _authProvider;
}

/**
 * Auth queries interface for API handlers
 * This provides a simplified interface for the REST API endpoints
 */
export interface AuthQueries {
  registerUser(input: RegisterAuthInput): Promise<AuthProviderResult<UserSession>>;
  loginUser(credentials: LoginAuthInput): Promise<AuthProviderResult<UserSession>>;
  logoutUser(accessToken: string): Promise<AuthProviderResult<void>>;
  getUserById(userId: string): Promise<AuthProviderResult<User>>;
  refreshSession(refreshToken: string): Promise<AuthProviderResult<UserSession>>;
}

/**
 * Gets auth queries object for REST API handlers
 */
export function getAuthQueries(): AuthQueries {
  const provider = getAuthProvider();
  return {
    registerUser: (input) => provider.registerUser(input),
    loginUser: (credentials) => provider.loginUser(credentials),
    logoutUser: (accessToken) => provider.logoutUser(accessToken),
    getUserById: (userId) => provider.getUserById(userId),
    refreshSession: (refreshToken) => provider.refreshSession(refreshToken),
  };
}

/**
 * Count users (for bootstrap check)
 */
export async function countUsers(): Promise<AuthResult<number>> {
  return getUserQueries().countUsers();
}

/**
 * Gets or creates the singleton UserQueries
 */
export function getUserQueries(): UserQueries {
  if (_userQueries === null) {
    _userQueries = new UserQueries();
  }
  return _userQueries;
}

/**
 * Resets singleton instances (useful for testing)
 */
export function resetAuthSingletons(): void {
  _authProvider = null;
  _userQueries = null;
}

// ============================================================================
// Convenience functions
// ============================================================================

/**
 * Register a new user
 */
export async function registerUser(input: RegisterAuthInput): Promise<AuthProviderResult<UserSession>> {
  return getAuthProvider().registerUser(input);
}

/**
 * Login an existing user
 */
export async function loginUser(credentials: LoginAuthInput): Promise<AuthProviderResult<UserSession>> {
  return getAuthProvider().loginUser(credentials);
}

/**
 * Logout the current user
 */
export async function logoutUser(accessToken: string): Promise<AuthProviderResult<void>> {
  return getAuthProvider().logoutUser(accessToken);
}

/**
 * Refresh session with refresh token
 */
export async function refreshSession(refreshToken: string): Promise<AuthProviderResult<UserSession>> {
  return getAuthProvider().refreshSession(refreshToken);
}

/**
 * Verify an access token
 */
export async function verifyToken(accessToken: string): Promise<AuthProviderResult<User>> {
  return getAuthProvider().verifyToken(accessToken);
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<AuthResult<User>> {
  return getUserQueries().getUserById(userId);
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<AuthResult<User>> {
  return getUserQueries().getUserByEmail(email);
}

/**
 * List users
 */
export async function listUsers(options?: {
  role?: UserRole;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<AuthResult<User[]>> {
  return getUserQueries().listUsers(options);
}

/**
 * Check if user exists
 */
export async function userExists(email: string): Promise<AuthResult<boolean>> {
  return getUserQueries().userExists(email);
}

/**
 * Update user roles
 */
export async function updateUserRoles(userId: string, roles: UserRole[]): Promise<AuthResult<User>> {
  return getUserQueries().updateUserRoles(userId, roles);
}
