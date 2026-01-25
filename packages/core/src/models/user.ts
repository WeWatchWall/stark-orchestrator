/**
 * User reactive model with roles
 * @module @stark-o/core/models/user
 */

import { reactive, computed, type ComputedRef } from '@vue/reactivity';
import type {
  User,
  UserRole,
  CreateUserInput,
  UpdateUserInput,
  UserSession,
} from '@stark-o/shared';
import {
  hasRole,
  hasAnyRole,
  hasAllRoles,
  canManageResources,
  isNodeAgent,
} from '@stark-o/shared';

/**
 * User registration result
 */
export interface UserRegistrationResult {
  user: User;
  session?: UserSession;
}

/**
 * User login result
 */
export interface UserLoginResult {
  user: User;
  session: UserSession;
}

/**
 * User list response with pagination
 */
export interface UserListResponse {
  users: User[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * User list filters
 */
export interface UserListFilters {
  /** Filter by email (partial match) */
  email?: string;
  /** Filter by role */
  role?: UserRole;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

/**
 * Authentication credentials
 */
export interface AuthCredentials {
  email: string;
  password: string;
}

/**
 * Reactive User model wrapper
 * Provides reactive access to user data with computed properties
 */
export class UserModel {
  private readonly _user: User;

  constructor(user: User) {
    this._user = reactive(user) as User;
  }

  /**
   * Get the raw user data
   */
  get data(): User {
    return this._user;
  }

  /**
   * User ID
   */
  get id(): string {
    return this._user.id;
  }

  /**
   * User email
   */
  get email(): string {
    return this._user.email;
  }

  /**
   * User display name
   */
  get displayName(): string | undefined {
    return this._user.displayName;
  }

  /**
   * User roles
   */
  get roles(): UserRole[] {
    return this._user.roles;
  }

  /**
   * Creation timestamp
   */
  get createdAt(): Date {
    return this._user.createdAt;
  }

  /**
   * Last update timestamp
   */
  get updatedAt(): Date {
    return this._user.updatedAt;
  }

  /**
   * Computed: Check if user is an admin
   */
  get isAdmin(): ComputedRef<boolean> {
    return computed(() => hasRole(this._user, 'admin'));
  }

  /**
   * Computed: Check if user is a node agent
   */
  get isNode(): ComputedRef<boolean> {
    return computed(() => hasRole(this._user, 'node'));
  }

  /**
   * Computed: Check if user is a viewer only
   */
  get isViewerOnly(): ComputedRef<boolean> {
    return computed(() => 
      this._user.roles.length === 1 && hasRole(this._user, 'viewer')
    );
  }

  /**
   * Computed: Check if user can manage resources (admin only)
   */
  get canManageResources(): ComputedRef<boolean> {
    return computed(() => canManageResources(this._user));
  }

  /**
   * Computed: Check if user is a node agent
   */
  get isNodeAgent(): ComputedRef<boolean> {
    return computed(() => isNodeAgent(this._user));
  }

  /**
   * Computed: Formatted display name or email
   */
  get displayNameOrEmail(): ComputedRef<string> {
    return computed(() => this._user.displayName ?? this._user.email);
  }

  /**
   * Computed: Primary role (first role in list)
   */
  get primaryRole(): ComputedRef<UserRole | undefined> {
    return computed(() => this._user.roles[0]);
  }

  /**
   * Computed: Role display string
   */
  get roleDisplay(): ComputedRef<string> {
    return computed(() => {
      if (this._user.roles.length === 0) {
        return 'No roles';
      }
      if (this._user.roles.length === 1) {
        return this._user.roles[0] ?? 'No roles';
      }
      return this._user.roles.join(', ');
    });
  }

  /**
   * Check if user has a specific role
   * @param role - The role to check
   */
  hasRole(role: UserRole): boolean {
    return hasRole(this._user, role);
  }

  /**
   * Check if user has any of the specified roles
   * @param roles - The roles to check
   */
  hasAnyRole(roles: UserRole[]): boolean {
    return hasAnyRole(this._user, roles);
  }

  /**
   * Check if user has all of the specified roles
   * @param roles - The roles to check
   */
  hasAllRoles(roles: UserRole[]): boolean {
    return hasAllRoles(this._user, roles);
  }

  /**
   * Update user properties
   * @param input - Properties to update
   */
  update(input: UpdateUserInput): void {
    if (input.displayName !== undefined) {
      this._user.displayName = input.displayName;
    }
    if (input.roles !== undefined) {
      this._user.roles = [...input.roles];
    }
    this._user.updatedAt = new Date();
  }

  /**
   * Add a role to the user
   * @param role - The role to add
   */
  addRole(role: UserRole): void {
    if (!this._user.roles.includes(role)) {
      this._user.roles.push(role);
      this._user.updatedAt = new Date();
    }
  }

  /**
   * Remove a role from the user
   * @param role - The role to remove
   */
  removeRole(role: UserRole): void {
    const index = this._user.roles.indexOf(role);
    if (index !== -1) {
      this._user.roles.splice(index, 1);
      this._user.updatedAt = new Date();
    }
  }

  /**
   * Convert to plain object
   */
  toJSON(): User {
    return {
      id: this._user.id,
      email: this._user.email,
      displayName: this._user.displayName,
      roles: [...this._user.roles],
      createdAt: this._user.createdAt,
      updatedAt: this._user.updatedAt,
    };
  }

  /**
   * Create a UserModel from CreateUserInput
   * @param input - User creation input
   * @param id - Generated user ID
   */
  static fromInput(input: CreateUserInput, id: string): UserModel {
    const now = new Date();
    const user: User = {
      id,
      email: input.email,
      displayName: input.displayName,
      roles: input.roles ?? ['viewer'],
      createdAt: now,
      updatedAt: now,
    };
    return new UserModel(user);
  }
}

/**
 * Create a reactive user list item for display
 * @param user - User data
 */
export function createReactiveUserListItem(user: User): {
  id: string;
  email: string;
  displayName: ComputedRef<string>;
  roles: ComputedRef<string>;
  isNodeAgent: ComputedRef<boolean>;
  canManageResources: ComputedRef<boolean>;
} {
  const model = new UserModel(user);
  return {
    id: model.id,
    email: model.email,
    displayName: model.displayNameOrEmail,
    roles: model.roleDisplay,
    isNodeAgent: model.isNodeAgent,
    canManageResources: model.canManageResources,
  };
}

/**
 * Session timeout in milliseconds (1 hour default)
 */
export const SESSION_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Session refresh threshold (refresh when 15 mins left)
 */
export const SESSION_REFRESH_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Reactive UserSession model wrapper
 * Provides reactive access to session data with expiration tracking
 */
export class UserSessionModel {
  private readonly _session: UserSession;
  private readonly _userModel: UserModel;

  constructor(session: UserSession) {
    this._session = reactive(session) as UserSession;
    this._userModel = new UserModel(this._session.user);
  }

  /**
   * Get the raw session data
   */
  get data(): UserSession {
    return this._session;
  }

  /**
   * Get the user model
   */
  get user(): UserModel {
    return this._userModel;
  }

  /**
   * Access token
   */
  get accessToken(): string {
    return this._session.accessToken;
  }

  /**
   * Refresh token
   */
  get refreshToken(): string | undefined {
    return this._session.refreshToken;
  }

  /**
   * Session expiration timestamp
   */
  get expiresAt(): Date {
    return this._session.expiresAt;
  }

  /**
   * Computed: Check if session is expired
   */
  get isExpired(): ComputedRef<boolean> {
    return computed(() => new Date() >= this._session.expiresAt);
  }

  /**
   * Computed: Check if session should be refreshed
   */
  get shouldRefresh(): ComputedRef<boolean> {
    return computed(() => {
      const now = new Date().getTime();
      const expiresAt = this._session.expiresAt.getTime();
      return expiresAt - now <= SESSION_REFRESH_THRESHOLD_MS;
    });
  }

  /**
   * Computed: Time remaining until expiration in milliseconds
   */
  get timeRemaining(): ComputedRef<number> {
    return computed(() => {
      const now = new Date().getTime();
      const expiresAt = this._session.expiresAt.getTime();
      return Math.max(0, expiresAt - now);
    });
  }

  /**
   * Update session tokens (after refresh)
   * @param accessToken - New access token
   * @param refreshToken - New refresh token (optional)
   * @param expiresAt - New expiration time
   */
  updateTokens(
    accessToken: string,
    expiresAt: Date,
    refreshToken?: string
  ): void {
    this._session.accessToken = accessToken;
    this._session.expiresAt = expiresAt;
    if (refreshToken !== undefined) {
      this._session.refreshToken = refreshToken;
    }
  }

  /**
   * Convert to plain object
   */
  toJSON(): UserSession {
    return {
      user: this._userModel.toJSON(),
      accessToken: this._session.accessToken,
      refreshToken: this._session.refreshToken,
      expiresAt: this._session.expiresAt,
    };
  }
}
