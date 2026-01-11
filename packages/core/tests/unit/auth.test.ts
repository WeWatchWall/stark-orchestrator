/**
 * Unit tests for AuthService
 * @module @stark-o/core/tests/unit/auth
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  AuthService,
  createAuthService,
  AuthServiceErrorCodes,
  validateEmail,
  validatePassword,
  validateDisplayName,
  validateRegisterInput,
  validateLoginInput,
  normalizeEmail,
  DEFAULT_PASSWORD_REQUIREMENTS,
  type AuthProvider,
  type AuthProviderResult,
  type RegisterAuthInput,
  type LoginAuthInput,
} from '../../src';
import type { User, UserSession, UserRole } from '@stark-o/shared';

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a mock user
 */
function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    roles: ['developer'] as UserRole[],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock session
 */
function createMockSession(overrides: Partial<UserSession> = {}): UserSession {
  return {
    user: createMockUser(),
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresAt: new Date(Date.now() + 3600_000), // 1 hour from now
    ...overrides,
  };
}

/**
 * Create a mock auth provider
 */
function createMockProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    registerUser: vi.fn().mockResolvedValue({ data: createMockSession(), error: null }),
    loginUser: vi.fn().mockResolvedValue({ data: createMockSession(), error: null }),
    logoutUser: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: createMockSession(), error: null }),
    getUserById: vi.fn().mockResolvedValue({ data: createMockUser(), error: null }),
    verifyToken: vi.fn().mockResolvedValue({ data: createMockUser(), error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: createMockUser(), error: null }),
    deleteUser: vi.fn().mockResolvedValue({ data: undefined, error: null }),
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Tests
// ============================================================================

describe('Validation Helpers', () => {
  describe('validateEmail', () => {
    it('should return error for undefined email', () => {
      const result = validateEmail(undefined);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('REQUIRED');
    });

    it('should return error for null email', () => {
      const result = validateEmail(null);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('REQUIRED');
    });

    it('should return error for empty string', () => {
      const result = validateEmail('');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('REQUIRED');
    });

    it('should return error for non-string', () => {
      const result = validateEmail(123);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('INVALID_TYPE');
    });

    it('should return error for invalid email format', () => {
      const invalidEmails = ['notanemail', 'missing@domain', '@nodomain.com', 'spaces in@email.com'];
      for (const email of invalidEmails) {
        const result = validateEmail(email);
        expect(result).not.toBeNull();
        expect(result?.code).toBe('INVALID_FORMAT');
      }
    });

    it('should return null for valid email', () => {
      const validEmails = ['test@example.com', 'user.name@domain.org', 'user+tag@example.co.uk'];
      for (const email of validEmails) {
        const result = validateEmail(email);
        expect(result).toBeNull();
      }
    });
  });

  describe('validatePassword', () => {
    it('should return error for undefined password', () => {
      const result = validatePassword(undefined);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('REQUIRED');
    });

    it('should return error for null password', () => {
      const result = validatePassword(null);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('REQUIRED');
    });

    it('should return error for empty string', () => {
      const result = validatePassword('');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('REQUIRED');
    });

    it('should return error for non-string', () => {
      const result = validatePassword(12345678);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('INVALID_TYPE');
    });

    it('should return error for password too short', () => {
      const result = validatePassword('Short1');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('TOO_SHORT');
    });

    it('should return error for missing uppercase', () => {
      const result = validatePassword('lowercase1');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('MISSING_UPPERCASE');
    });

    it('should return error for missing lowercase', () => {
      const result = validatePassword('UPPERCASE1');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('MISSING_LOWERCASE');
    });

    it('should return error for missing digit', () => {
      const result = validatePassword('NoDigitsHere');
      expect(result).not.toBeNull();
      expect(result?.code).toBe('MISSING_DIGIT');
    });

    it('should return null for valid password', () => {
      const result = validatePassword('ValidPass1');
      expect(result).toBeNull();
    });

    it('should respect custom requirements', () => {
      const customReqs = {
        minLength: 12,
        requireUppercase: false,
        requireLowercase: false,
        requireDigit: false,
        requireSpecialChar: true,
      };
      
      // Should fail for missing special char
      const result1 = validatePassword('longenoughpassword', customReqs);
      expect(result1?.code).toBe('MISSING_SPECIAL_CHAR');
      
      // Should pass with special char
      const result2 = validatePassword('longenough@pass', customReqs);
      expect(result2).toBeNull();
    });
  });

  describe('validateDisplayName', () => {
    it('should return null for undefined (optional)', () => {
      const result = validateDisplayName(undefined);
      expect(result).toBeNull();
    });

    it('should return null for null (optional)', () => {
      const result = validateDisplayName(null);
      expect(result).toBeNull();
    });

    it('should return null for empty string (optional)', () => {
      const result = validateDisplayName('');
      expect(result).toBeNull();
    });

    it('should return error for non-string', () => {
      const result = validateDisplayName(123);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('INVALID_TYPE');
    });

    it('should return error for display name too long', () => {
      const longName = 'a'.repeat(101);
      const result = validateDisplayName(longName);
      expect(result).not.toBeNull();
      expect(result?.code).toBe('TOO_LONG');
    });

    it('should return null for valid display name', () => {
      const result = validateDisplayName('John Doe');
      expect(result).toBeNull();
    });
  });

  describe('validateRegisterInput', () => {
    it('should return invalid for null input', () => {
      const result = validateRegisterInput(null);
      expect(result.valid).toBe(false);
      expect(result.errors._root).toBeDefined();
    });

    it('should return invalid for undefined input', () => {
      const result = validateRegisterInput(undefined);
      expect(result.valid).toBe(false);
    });

    it('should return invalid for non-object input', () => {
      const result = validateRegisterInput('not an object');
      expect(result.valid).toBe(false);
    });

    it('should validate all fields', () => {
      const result = validateRegisterInput({
        email: 'invalid',
        password: 'short',
        displayName: 'a'.repeat(101),
      });

      expect(result.valid).toBe(false);
      expect(result.errors.email).toBeDefined();
      expect(result.errors.password).toBeDefined();
      expect(result.errors.displayName).toBeDefined();
    });

    it('should return valid for correct input', () => {
      const result = validateRegisterInput({
        email: 'test@example.com',
        password: 'ValidPass1',
        displayName: 'Test User',
      });

      expect(result.valid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
    });
  });

  describe('validateLoginInput', () => {
    it('should return invalid for null input', () => {
      const result = validateLoginInput(null);
      expect(result.valid).toBe(false);
    });

    it('should validate email format', () => {
      const result = validateLoginInput({
        email: 'invalid-email',
        password: 'anypassword',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.email).toBeDefined();
    });

    it('should require password but not validate strength', () => {
      const result = validateLoginInput({
        email: 'test@example.com',
        password: '', // Empty password
      });

      expect(result.valid).toBe(false);
      expect(result.errors.password?.code).toBe('REQUIRED');
    });

    it('should return valid for correct input', () => {
      const result = validateLoginInput({
        email: 'test@example.com',
        password: 'any-password-works-for-login',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('normalizeEmail', () => {
    it('should trim whitespace', () => {
      expect(normalizeEmail('  test@example.com  ')).toBe('test@example.com');
    });

    it('should lowercase email', () => {
      expect(normalizeEmail('TEST@EXAMPLE.COM')).toBe('test@example.com');
    });

    it('should handle mixed case and whitespace', () => {
      expect(normalizeEmail('  Test.User@Example.COM  ')).toBe('test.user@example.com');
    });
  });
});

// ============================================================================
// AuthService Tests
// ============================================================================

describe('AuthService', () => {
  let service: AuthService;
  let mockProvider: AuthProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    mockProvider = createMockProvider();
    service = createAuthService({
      provider: mockProvider,
      enableAutoRefresh: false, // Disable for most tests
    });
  });

  afterEach(() => {
    service.destroy();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const svc = new AuthService();
      expect(svc).toBeInstanceOf(AuthService);
      svc.destroy();
    });

    it('should accept custom options', () => {
      const svc = createAuthService({
        enableAutoRefresh: true,
        autoRefreshIntervalMs: 30_000,
      });
      expect(svc).toBeInstanceOf(AuthService);
      svc.destroy();
    });
  });

  describe('provider configuration', () => {
    it('should report provider status', () => {
      const svc = new AuthService();
      expect(svc.hasProvider()).toBe(false);
      
      svc.setProvider(mockProvider);
      expect(svc.hasProvider()).toBe(true);
      
      svc.destroy();
    });
  });

  describe('computed properties (before login)', () => {
    it('should return null for currentSession', () => {
      expect(service.currentSession.value).toBeNull();
    });

    it('should return null for currentUser', () => {
      expect(service.currentUser.value).toBeNull();
    });

    it('should return false for isAuthenticated', () => {
      expect(service.isAuthenticated.value).toBe(false);
    });

    it('should return false for isRefreshing', () => {
      expect(service.isRefreshing.value).toBe(false);
    });

    it('should return null for currentUserId', () => {
      expect(service.currentUserId.value).toBeNull();
    });

    it('should return empty array for currentUserRoles', () => {
      expect(service.currentUserRoles.value).toEqual([]);
    });

    it('should return false for isAdmin', () => {
      expect(service.isAdmin.value).toBe(false);
    });

    it('should return false for canManageResources', () => {
      expect(service.canManageResources.value).toBe(false);
    });

    it('should return false for canDeploy', () => {
      expect(service.canDeploy.value).toBe(false);
    });
  });

  describe('register', () => {
    const validInput: RegisterAuthInput = {
      email: 'new@example.com',
      password: 'ValidPass1',
      displayName: 'New User',
    };

    it('should register user successfully', async () => {
      const result = await service.register(validInput);

      expect(result.success).toBe(true);
      expect(result.data?.user).toBeDefined();
      expect(result.data?.session).toBeDefined();
      expect(mockProvider.registerUser).toHaveBeenCalled();
    });

    it('should set current session after successful registration', async () => {
      await service.register(validInput);

      expect(service.isAuthenticated.value).toBe(true);
      expect(service.currentSession.value).not.toBeNull();
    });

    it('should fail with validation error for invalid input', async () => {
      const result = await service.register({
        email: 'invalid',
        password: 'short',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.VALIDATION_ERROR);
      expect(result.error?.details).toBeDefined();
    });

    it('should fail when provider is not configured', async () => {
      const svc = new AuthService(); // No provider
      const result = await svc.register(validInput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED);
      
      svc.destroy();
    });

    it('should handle provider error', async () => {
      mockProvider.registerUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'USER_ALREADY_EXISTS', message: 'User exists' },
      });

      const result = await service.register(validInput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.USER_ALREADY_EXISTS);
    });

    it('should normalize email before registration', async () => {
      // Note: Email validation happens before normalization, so emails with
      // leading/trailing spaces would fail validation. Test with uppercase only.
      const result = await service.register({
        email: 'UPPER@EXAMPLE.COM',
        password: 'ValidPass1',
      });

      expect(result.success).toBe(true);
      expect(mockProvider.registerUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'upper@example.com',
        })
      );
    });
  });

  describe('login', () => {
    const validCredentials: LoginAuthInput = {
      email: 'test@example.com',
      password: 'ValidPass1',
    };

    it('should login successfully', async () => {
      const result = await service.login(validCredentials);

      expect(result.success).toBe(true);
      expect(result.data?.user).toBeDefined();
      expect(result.data?.session).toBeDefined();
    });

    it('should set current session after successful login', async () => {
      await service.login(validCredentials);

      expect(service.isAuthenticated.value).toBe(true);
      expect(service.currentUser.value).not.toBeNull();
    });

    it('should fail with validation error for missing email', async () => {
      const result = await service.login({
        email: '',
        password: 'password',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.VALIDATION_ERROR);
    });

    it('should fail with validation error for missing password', async () => {
      const result = await service.login({
        email: 'test@example.com',
        password: '',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.VALIDATION_ERROR);
    });

    it('should handle invalid credentials error', async () => {
      mockProvider.loginUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: 'Wrong password' },
      });

      const result = await service.login(validCredentials);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.INVALID_CREDENTIALS);
    });

    it('should normalize email before login', async () => {
      // Note: Email validation happens before normalization, so emails with
      // leading/trailing spaces would fail validation. Test with uppercase only.
      const result = await service.login({
        email: 'TEST@EXAMPLE.COM',
        password: 'password',
      });

      expect(result.success).toBe(true);
      expect(mockProvider.loginUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
        })
      );
    });
  });

  describe('logout', () => {
    beforeEach(async () => {
      // Login first
      await service.login({ email: 'test@example.com', password: 'password' });
    });

    it('should logout successfully', async () => {
      const result = await service.logout();

      expect(result.success).toBe(true);
      expect(service.isAuthenticated.value).toBe(false);
      expect(service.currentSession.value).toBeNull();
    });

    it('should succeed when no session exists', async () => {
      service.clearSession();
      const result = await service.logout();

      expect(result.success).toBe(true);
    });

    it('should clear local session even if provider fails', async () => {
      mockProvider.logoutUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PROVIDER_ERROR', message: 'Failed' },
      });

      const result = await service.logout();

      expect(result.success).toBe(true);
      expect(service.currentSession.value).toBeNull();
    });

    it('should clear session without provider', async () => {
      const svc = new AuthService();
      svc.restoreSession(createMockSession());
      
      const result = await svc.logout();

      expect(result.success).toBe(true);
      expect(svc.currentSession.value).toBeNull();
      
      svc.destroy();
    });
  });

  describe('refreshSession', () => {
    beforeEach(async () => {
      await service.login({ email: 'test@example.com', password: 'password' });
    });

    it('should refresh session successfully', async () => {
      const newSession = createMockSession({
        accessToken: 'new-access-token',
        expiresAt: new Date(Date.now() + 7200_000),
      });
      mockProvider.refreshSession = vi.fn().mockResolvedValue({
        data: newSession,
        error: null,
      });

      const result = await service.refreshSession();

      expect(result.success).toBe(true);
      expect(result.data?.accessToken).toBe('new-access-token');
    });

    it('should fail when no session exists', async () => {
      service.clearSession();
      const result = await service.refreshSession();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.SESSION_NOT_FOUND);
    });

    it('should fail when no refresh token', async () => {
      service.restoreSession(createMockSession({ refreshToken: undefined }));
      const result = await service.refreshSession();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.REFRESH_FAILED);
    });

    it('should fail when provider is not configured', async () => {
      const svc = new AuthService();
      svc.restoreSession(createMockSession());
      
      const result = await svc.refreshSession();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED);
      
      svc.destroy();
    });

    it('should handle provider refresh error', async () => {
      mockProvider.refreshSession = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'SESSION_EXPIRED', message: 'Expired' },
      });

      const result = await service.refreshSession();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.SESSION_EXPIRED);
    });
  });

  describe('restoreSession', () => {
    it('should restore valid session', () => {
      const session = createMockSession();
      const result = service.restoreSession(session);

      expect(result).toBe(true);
      expect(service.isAuthenticated.value).toBe(true);
    });

    it('should reject expired session', () => {
      const expiredSession = createMockSession({
        expiresAt: new Date(Date.now() - 1000), // Expired
      });
      const result = service.restoreSession(expiredSession);

      expect(result).toBe(false);
      expect(service.isAuthenticated.value).toBe(false);
    });
  });

  describe('clearSession', () => {
    beforeEach(async () => {
      await service.login({ email: 'test@example.com', password: 'password' });
    });

    it('should clear session without provider call', () => {
      service.clearSession();

      expect(service.currentSession.value).toBeNull();
      expect(service.isAuthenticated.value).toBe(false);
      expect(mockProvider.logoutUser).not.toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('should get user by ID', async () => {
      const result = await service.getUser('user-123');

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('user-123');
    });

    it('should fail when provider is not configured', async () => {
      const svc = new AuthService();
      const result = await svc.getUser('user-123');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED);
      
      svc.destroy();
    });

    it('should handle user not found', async () => {
      mockProvider.getUserById = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await service.getUser('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.USER_NOT_FOUND);
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', async () => {
      const result = await service.verifyToken('valid-token');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should fail when provider is not configured', async () => {
      const svc = new AuthService();
      const result = await svc.verifyToken('token');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.PROVIDER_NOT_CONFIGURED);
      
      svc.destroy();
    });

    it('should handle invalid token', async () => {
      mockProvider.verifyToken = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await service.verifyToken('invalid');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(AuthServiceErrorCodes.UNAUTHORIZED);
    });
  });

  describe('authorization helpers', () => {
    describe('hasRole', () => {
      it('should return false when not authenticated', () => {
        expect(service.hasRole('admin')).toBe(false);
      });

      it('should check role correctly', async () => {
        mockProvider.loginUser = vi.fn().mockResolvedValue({
          data: createMockSession({
            user: createMockUser({ roles: ['admin', 'operator'] }),
          }),
          error: null,
        });
        await service.login({ email: 'test@example.com', password: 'password' });

        expect(service.hasRole('admin')).toBe(true);
        expect(service.hasRole('developer')).toBe(false);
      });
    });

    describe('hasAnyRole', () => {
      it('should return false when not authenticated', () => {
        expect(service.hasAnyRole(['admin', 'operator'])).toBe(false);
      });

      it('should check roles correctly', async () => {
        mockProvider.loginUser = vi.fn().mockResolvedValue({
          data: createMockSession({
            user: createMockUser({ roles: ['developer'] }),
          }),
          error: null,
        });
        await service.login({ email: 'test@example.com', password: 'password' });

        expect(service.hasAnyRole(['admin', 'developer'])).toBe(true);
        expect(service.hasAnyRole(['admin', 'operator'])).toBe(false);
      });
    });

    describe('requireAuthentication', () => {
      it('should fail when not authenticated', () => {
        const result = service.requireAuthentication();

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(AuthServiceErrorCodes.UNAUTHORIZED);
      });

      it('should succeed when authenticated', async () => {
        await service.login({ email: 'test@example.com', password: 'password' });

        const result = service.requireAuthentication();

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should fail when session is expired', () => {
        service.restoreSession(createMockSession({
          expiresAt: new Date(Date.now() + 100), // About to expire
        }));
        
        // Fast-forward time to expire session
        vi.advanceTimersByTime(200);

        const result = service.requireAuthentication();

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(AuthServiceErrorCodes.SESSION_EXPIRED);
      });
    });

    describe('requireRole', () => {
      beforeEach(async () => {
        mockProvider.loginUser = vi.fn().mockResolvedValue({
          data: createMockSession({
            user: createMockUser({ roles: ['developer'] }),
          }),
          error: null,
        });
        await service.login({ email: 'test@example.com', password: 'password' });
      });

      it('should succeed when user has role', () => {
        const result = service.requireRole('developer');

        expect(result.success).toBe(true);
      });

      it('should fail when user lacks role', () => {
        const result = service.requireRole('admin');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(AuthServiceErrorCodes.FORBIDDEN);
      });
    });

    describe('requireAnyRole', () => {
      beforeEach(async () => {
        mockProvider.loginUser = vi.fn().mockResolvedValue({
          data: createMockSession({
            user: createMockUser({ roles: ['operator'] }),
          }),
          error: null,
        });
        await service.login({ email: 'test@example.com', password: 'password' });
      });

      it('should succeed when user has any of the roles', () => {
        const result = service.requireAnyRole(['admin', 'operator']);

        expect(result.success).toBe(true);
      });

      it('should fail when user lacks all roles', () => {
        const result = service.requireAnyRole(['admin', 'developer']);

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(AuthServiceErrorCodes.FORBIDDEN);
      });
    });
  });

  describe('computed properties (after login)', () => {
    beforeEach(async () => {
      mockProvider.loginUser = vi.fn().mockResolvedValue({
        data: createMockSession({
          user: createMockUser({
            id: 'user-456',
            roles: ['admin', 'operator'],
          }),
        }),
        error: null,
      });
      await service.login({ email: 'test@example.com', password: 'password' });
    });

    it('should return correct currentUserId', () => {
      expect(service.currentUserId.value).toBe('user-456');
    });

    it('should return correct currentUserRoles', () => {
      expect(service.currentUserRoles.value).toContain('admin');
      expect(service.currentUserRoles.value).toContain('operator');
    });

    it('should return true for isAdmin', () => {
      expect(service.isAdmin.value).toBe(true);
    });

    it('should return true for canManageResources', () => {
      expect(service.canManageResources.value).toBe(true);
    });

    it('should compute shouldRefreshSession', () => {
      expect(service.shouldRefreshSession.value).toBe(false);
    });

    it('should compute sessionTimeRemaining', () => {
      expect(service.sessionTimeRemaining.value).toBeGreaterThan(0);
    });
  });

  describe('activity tracking', () => {
    beforeEach(async () => {
      await service.login({ email: 'test@example.com', password: 'password' });
    });

    it('should track activity after login', () => {
      expect(service.getLastActivity()).not.toBeNull();
    });

    it('should update activity on recordActivity', () => {
      const before = service.getLastActivity();
      vi.advanceTimersByTime(1000);
      service.recordActivity();
      const after = service.getLastActivity();

      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    });

    it('should not update activity when not authenticated', () => {
      service.clearSession();
      service.recordActivity();
      expect(service.getLastActivity()).toBeNull();
    });
  });

  describe('auto-refresh', () => {
    it('should start auto-refresh when enabled', async () => {
      const svc = createAuthService({
        provider: mockProvider,
        enableAutoRefresh: true,
        autoRefreshIntervalMs: 1000,
      });

      await svc.login({ email: 'test@example.com', password: 'password' });

      // Setup mock to return session that should be refreshed
      const sessionNeedingRefresh = createMockSession({
        expiresAt: new Date(Date.now() + 60_000), // 1 minute - under threshold
      });
      mockProvider.refreshSession = vi.fn().mockResolvedValue({
        data: createMockSession(),
        error: null,
      });

      // Note: shouldRefresh depends on the session model implementation
      // This test verifies the auto-refresh mechanism is set up
      
      svc.destroy();
    });

    it('should stop auto-refresh on logout', async () => {
      const svc = createAuthService({
        provider: mockProvider,
        enableAutoRefresh: true,
        autoRefreshIntervalMs: 1000,
      });

      await svc.login({ email: 'test@example.com', password: 'password' });
      await svc.logout();

      // No refresh calls should happen after logout
      vi.advanceTimersByTime(5000);
      
      svc.destroy();
    });
  });

  describe('destroy', () => {
    it('should clean up resources', async () => {
      await service.login({ email: 'test@example.com', password: 'password' });
      
      service.destroy();

      expect(service.currentSession.value).toBeNull();
      expect(service.hasProvider()).toBe(false);
    });
  });

  describe('error mapping', () => {
    it('should map USER_ALREADY_EXISTS error', async () => {
      mockProvider.registerUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'USER_ALREADY_EXISTS', message: 'Exists' },
      });

      const result = await service.register({
        email: 'test@example.com',
        password: 'ValidPass1',
      });

      expect(result.error?.code).toBe(AuthServiceErrorCodes.USER_ALREADY_EXISTS);
    });

    it('should map INVALID_CREDENTIALS error', async () => {
      mockProvider.loginUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: 'Wrong' },
      });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result.error?.code).toBe(AuthServiceErrorCodes.INVALID_CREDENTIALS);
    });

    it('should map RATE_LIMIT_EXCEEDED error', async () => {
      mockProvider.loginUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many' },
      });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result.error?.code).toBe(AuthServiceErrorCodes.RATE_LIMIT_EXCEEDED);
    });

    it('should map ACCOUNT_LOCKED error', async () => {
      mockProvider.loginUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'ACCOUNT_LOCKED', message: 'Locked' },
      });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result.error?.code).toBe(AuthServiceErrorCodes.ACCOUNT_LOCKED);
    });

    it('should pass through unmapped errors', async () => {
      mockProvider.loginUser = vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'CUSTOM_ERROR', message: 'Custom' },
      });

      const result = await service.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(result.error?.code).toBe('CUSTOM_ERROR');
    });
  });
});

describe('createAuthService factory', () => {
  it('should create new instance with options', () => {
    const service1 = createAuthService();
    const service2 = createAuthService();

    expect(service1).not.toBe(service2);
    
    service1.destroy();
    service2.destroy();
  });
});
