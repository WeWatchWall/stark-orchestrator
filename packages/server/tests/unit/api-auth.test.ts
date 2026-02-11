/**
 * Unit tests for Auth API endpoints
 * @module @stark-o/server/tests/unit/api-auth
 *
 * These tests directly test the API handlers without requiring a running server.
 * They mock the Supabase layer to test the API logic in isolation.
 *
 * Task: T082 [US3] Unit test for POST /api/auth/register
 * Task: T083 [US3] Contract test for POST /api/auth/login
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import type { User, UserSession } from '@stark-o/shared';

// Mock the supabase auth module before importing the handlers
vi.mock('../../src/supabase/auth.js', () => ({
  getAuthQueries: vi.fn(),
}));

// Mock app-config so the registration guard passes
vi.mock('../../src/supabase/app-config.js', () => ({
  isPublicRegistrationEnabled: vi.fn().mockResolvedValue({ data: true, error: null }),
}));

// Import after mocking
import { register, login, logout } from '../../src/api/auth.js';
import { getAuthQueries } from '../../src/supabase/auth.js';
import { isPublicRegistrationEnabled } from '../../src/supabase/app-config.js';

/**
 * Create a mock Express request
 */
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    ...overrides,
  } as Request;
}

/**
 * Create a mock Express response with spy functions
 */
function createMockResponse(): Response & { _json: unknown; _status: number } {
  const res = {
    _json: null as unknown,
    _status: 200,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(data: unknown) {
      this._json = data;
      return this;
    },
    send() {
      return this;
    },
  };
  return res as Response & { _json: unknown; _status: number };
}

/**
 * Sample user for testing
 */
const sampleUser: User = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'test@example.com',
  displayName: 'Test User',
  roles: ['developer'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Sample user session for testing
 */
const sampleSession: UserSession = {
  user: sampleUser,
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
};

describe('Auth API Handlers', () => {
  let mockAuthQueries: {
    registerUser: ReturnType<typeof vi.fn>;
    loginUser: ReturnType<typeof vi.fn>;
    logoutUser: ReturnType<typeof vi.fn>;
    getUserById: ReturnType<typeof vi.fn>;
    refreshSession: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthQueries = {
      registerUser: vi.fn(),
      loginUser: vi.fn(),
      logoutUser: vi.fn(),
      getUserById: vi.fn(),
      refreshSession: vi.fn(),
    };

    vi.mocked(getAuthQueries).mockReturnValue(mockAuthQueries as any);

    // Re-set after resetAllMocks strips the factory implementation
    vi.mocked(isPublicRegistrationEnabled).mockResolvedValue({ data: true, error: null });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/auth/register - register', () => {
    it('should return 400 for missing email field', async () => {
      const req = createMockRequest({
        body: { password: 'Password123', displayName: 'Test User' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            email: expect.objectContaining({ code: 'REQUIRED' }),
          }),
        },
      });
    });

    it('should return 400 for missing password field', async () => {
      const req = createMockRequest({
        body: { email: 'test@example.com', displayName: 'Test User' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            password: expect.objectContaining({ code: 'REQUIRED' }),
          }),
        },
      });
    });

    it('should return 400 for invalid email format', async () => {
      const req = createMockRequest({
        body: { email: 'not-an-email', password: 'Password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            email: expect.objectContaining({ code: 'INVALID_FORMAT' }),
          }),
        },
      });
    });

    it('should return 400 for password too short', async () => {
      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Pass1' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            password: expect.objectContaining({ code: 'TOO_SHORT' }),
          }),
        },
      });
    });

    it('should return 400 for password missing uppercase', async () => {
      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            password: expect.objectContaining({ code: 'MISSING_UPPERCASE' }),
          }),
        },
      });
    });

    it('should return 400 for password missing lowercase', async () => {
      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'PASSWORD123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            password: expect.objectContaining({ code: 'MISSING_LOWERCASE' }),
          }),
        },
      });
    });

    it('should return 400 for password missing digit', async () => {
      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'PasswordAbc' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            password: expect.objectContaining({ code: 'MISSING_DIGIT' }),
          }),
        },
      });
    });

    it('should return 409 when email already exists', async () => {
      mockAuthQueries.registerUser.mockResolvedValue({
        data: null,
        error: { code: 'USER_ALREADY_EXISTS', message: 'User already exists' },
      });

      const req = createMockRequest({
        body: { email: 'existing@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(409);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'User with this email already exists',
        },
      });
    });

    it('should return 201 and create user successfully', async () => {
      mockAuthQueries.registerUser.mockResolvedValue({
        data: sampleSession,
        error: null,
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(201);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          user: expect.objectContaining({
            id: sampleUser.id,
            email: 'test@example.com',
          }),
          accessToken: expect.any(String),
          expiresAt: expect.any(String),
        },
      });

      expect(mockAuthQueries.registerUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          password: 'Password123',
        })
      );
    });

    it('should create user with optional displayName', async () => {
      const userWithDisplayName = {
        ...sampleSession,
        user: { ...sampleUser, displayName: 'John Doe' },
      };

      mockAuthQueries.registerUser.mockResolvedValue({
        data: userWithDisplayName,
        error: null,
      });

      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'Password123',
          displayName: 'John Doe',
        },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(201);
      expect(mockAuthQueries.registerUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          password: 'Password123',
          displayName: 'John Doe',
        })
      );
    });

    it('should return 400 for displayName too long', async () => {
      const req = createMockRequest({
        body: {
          email: 'test@example.com',
          password: 'Password123',
          displayName: 'a'.repeat(101),
        },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            displayName: expect.objectContaining({ code: 'TOO_LONG' }),
          }),
        },
      });
    });

    it('should handle database error during registration', async () => {
      mockAuthQueries.registerUser.mockResolvedValue({
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Database connection failed' },
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
        },
      });
    });

    it('should return 400 for empty request body', async () => {
      const req = createMockRequest({
        body: {},
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });

    it('should return 400 for null request body', async () => {
      const req = createMockRequest({
        body: null,
      });
      const res = createMockResponse();

      await register(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
      });
    });
  });

  /**
   * Tests for POST /api/auth/login
   * Task: T083 [US3] Contract test for POST /api/auth/login
   */
  describe('POST /api/auth/login - login', () => {
    it('should return 400 for missing email field', async () => {
      const req = createMockRequest({
        body: { password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            email: expect.objectContaining({ code: 'REQUIRED' }),
          }),
        },
      });
    });

    it('should return 400 for missing password field', async () => {
      const req = createMockRequest({
        body: { email: 'test@example.com' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            password: expect.objectContaining({ code: 'REQUIRED' }),
          }),
        },
      });
    });

    it('should return 400 for invalid email format', async () => {
      const req = createMockRequest({
        body: { email: 'not-an-email', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            email: expect.objectContaining({ code: 'INVALID_FORMAT' }),
          }),
        },
      });
    });

    it('should return 400 for empty email', async () => {
      const req = createMockRequest({
        body: { email: '', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            email: expect.objectContaining({ code: 'REQUIRED' }),
          }),
        },
      });
    });

    it('should return 400 for empty password', async () => {
      const req = createMockRequest({
        body: { email: 'test@example.com', password: '' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.objectContaining({
            password: expect.objectContaining({ code: 'REQUIRED' }),
          }),
        },
      });
    });

    it('should return 401 for invalid credentials', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'WrongPassword123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(401);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    });

    it('should return 401 for non-existent user', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: null,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });

      const req = createMockRequest({
        body: { email: 'nonexistent@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(401);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        },
      });
    });

    it('should return 200 and login successfully', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: sampleSession,
        error: null,
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          user: expect.objectContaining({
            id: sampleUser.id,
            email: 'test@example.com',
          }),
          accessToken: expect.any(String),
          expiresAt: expect.any(String),
        },
      });

      expect(mockAuthQueries.loginUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password123',
      });
    });

    it('should return user with all fields on successful login', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: sampleSession,
        error: null,
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(200);
      expect(res._json).toMatchObject({
        success: true,
        data: {
          user: expect.objectContaining({
            id: sampleUser.id,
            email: sampleUser.email,
            displayName: sampleUser.displayName,
            roles: sampleUser.roles,
          }),
        },
      });
    });

    it('should handle database error during login', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: null,
        error: { code: 'INTERNAL_ERROR', message: 'Database connection failed' },
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(500);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
        },
      });
    });

    it('should return 400 for empty request body', async () => {
      const req = createMockRequest({
        body: {},
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    });

    it('should return 400 for null request body', async () => {
      const req = createMockRequest({
        body: null,
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(400);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
        },
      });
    });

    it('should handle rate limiting error', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: null,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many login attempts' },
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(429);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many login attempts. Please try again later.',
        },
      });
    });

    it('should handle account locked error', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: null,
        error: { code: 'ACCOUNT_LOCKED', message: 'Account is locked' },
      });

      const req = createMockRequest({
        body: { email: 'test@example.com', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(403);
      expect(res._json).toMatchObject({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Account is locked. Please contact support.',
        },
      });
    });

    it('should trim whitespace from email', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: sampleSession,
        error: null,
      });

      const req = createMockRequest({
        body: { email: '  test@example.com  ', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(200);
      expect(mockAuthQueries.loginUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password123',
      });
    });

    it('should be case-insensitive for email', async () => {
      mockAuthQueries.loginUser.mockResolvedValue({
        data: sampleSession,
        error: null,
      });

      const req = createMockRequest({
        body: { email: 'TEST@EXAMPLE.COM', password: 'Password123' },
      });
      const res = createMockResponse();

      await login(req, res);

      expect(res._status).toBe(200);
      expect(mockAuthQueries.loginUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password123',
      });
    });
  });
});
