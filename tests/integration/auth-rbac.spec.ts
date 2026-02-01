/**
 * Integration tests for RBAC Enforcement
 * @module tests/integration/auth-rbac
 *
 * Tests for User Story 3: User Authentication and Authorization
 * These tests verify role-based access control (RBAC) enforcement across all protected resources
 *
 * Task: T084 [US3] Integration test for RBAC enforcement
 *
 * Implemented using CASL library via defineAbilityFor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { User, UserRole, UserSession } from '@stark-o/shared';
import { defineAbilityFor, type Action, type Subject } from '@stark-o/server/middleware';

/**
 * RBAC Permission Matrix
 *
 * | Resource    | Action    | admin | node  | viewer |
 * |-------------|-----------|-------|-------|--------|
 * | packs       | create    | ✓     | ✗     | ✗      |
 * | packs       | read      | ✓     | ✓     | ✓      |
 * | packs       | update    | ✓     | ✗     | ✗      |
 * | packs       | delete    | ✓     | ✗     | ✗      |
 * | pods        | create    | ✓     | ✗     | ✗      |
 * | pods        | read      | ✓     | ✓     | ✓      |
 * | pods        | update    | ✓     | ✓     | ✗      |
 * | pods        | delete    | ✓     | ✗     | ✗      |
 * | nodes       | create    | ✓     | ✓     | ✗      |
 * | nodes       | read      | ✓     | ✓     | ✓      |
 * | nodes       | update    | ✓     | ✓     | ✗      |
 * | nodes       | delete    | ✓     | ✗     | ✗      |
 * | namespaces  | create    | ✓     | ✗     | ✗      |
 * | namespaces  | read      | ✓     | ✓     | ✓      |
 * | namespaces  | update    | ✓     | ✗     | ✗      |
 * | namespaces  | delete    | ✓     | ✗     | ✗      |
 * | users       | create    | ✓     | ✗     | ✗      |
 * | users       | read      | ✓     | ✗     | ✗      |
 * | users       | update    | ✓     | ✗     | ✗      |
 * | users       | delete    | ✓     | ✗     | ✗      |
 */

/**
 * Test user factory
 */
function createTestUser(role: UserRole, id?: string): User {
  const userId = id ?? `user-${role}-${Date.now()}`;
  return {
    id: userId,
    email: `${role}@example.com`,
    displayName: `Test ${role.charAt(0).toUpperCase() + role.slice(1)}`,
    roles: [role],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Test session factory
 */
function createTestSession(user: User): UserSession {
  return {
    user,
    accessToken: `mock-token-${user.id}`,
    refreshToken: `mock-refresh-${user.id}`,
    expiresAt: new Date(Date.now() + 3600000),
  };
}

/**
 * Mock request with authorization
 */
interface MockAuthRequest {
  headers: { authorization?: string };
  user?: User;
  body: Record<string, unknown>;
  params: Record<string, string>;
  query: Record<string, string>;
}

function createAuthenticatedRequest(user: User, overrides: Partial<MockAuthRequest> = {}): MockAuthRequest {
  const session = createTestSession(user);
  return {
    headers: { authorization: `Bearer ${session.accessToken}` },
    user,
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

function createUnauthenticatedRequest(overrides: Partial<MockAuthRequest> = {}): MockAuthRequest {
  return {
    headers: {},
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

/**
 * Helper to check ability for a user with given role
 */
function checkAbility(role: UserRole, action: Action, subject: Subject): boolean {
  const user = createTestUser(role);
  const ability = defineAbilityFor(user);
  return ability.can(action, subject);
}

describe('RBAC Enforcement Integration Tests', () => {
  // Test users for each role
  let adminUser: User;
  let nodeUser: User;
  let viewerUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test users for each role
    adminUser = createTestUser('admin', 'admin-user-1');
    nodeUser = createTestUser('node', 'node-user-1');
    viewerUser = createTestUser('viewer', 'viewer-user-1');
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Authentication Requirements', () => {
    describe('Token Extraction', () => {
      it('should identify unauthenticated request without authorization header', () => {
        const req = createUnauthenticatedRequest();
        expect(req.headers.authorization).toBeUndefined();
        expect(req.user).toBeUndefined();
      });

      it('should identify authenticated request with valid authorization header', () => {
        const req = createAuthenticatedRequest(adminUser);
        expect(req.headers.authorization).toBeDefined();
        expect(req.headers.authorization).toMatch(/^Bearer /);
        expect(req.user).toBeDefined();
      });

      it('should attach user to authenticated request', () => {
        const req = createAuthenticatedRequest(nodeUser);
        expect(req.user).toBeDefined();
        expect(req.user?.id).toBe('node-user-1');
        expect(req.user?.roles).toContain('node');
      });

      it('should create valid session with expiration', () => {
        const session = createTestSession(adminUser);
        expect(session.accessToken).toBeDefined();
        expect(session.refreshToken).toBeDefined();
        expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      });

      it('should include user in session', () => {
        const session = createTestSession(nodeUser);
        expect(session.user).toEqual(nodeUser);
        expect(session.user.roles).toContain('node');
      });

      it('should generate unique tokens for different users', () => {
        const session1 = createTestSession(adminUser);
        const session2 = createTestSession(nodeUser);
        expect(session1.accessToken).not.toBe(session2.accessToken);
        expect(session1.refreshToken).not.toBe(session2.refreshToken);
      });
    });
  });

  describe('Pack Resource RBAC', () => {
    describe('POST /api/packs - Create Pack', () => {
      it('should allow admin to create pack', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('create', 'Pack')).toBe(true);
      });

      it('should deny node from creating pack', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('create', 'Pack')).toBe(false);
      });

      it('should deny viewer from creating pack', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('create', 'Pack')).toBe(false);
      });
    });

    describe('GET /api/packs - List Packs', () => {
      it('should allow all roles to list packs', () => {
        const roles: UserRole[] = ['admin', 'node', 'viewer'];
        for (const role of roles) {
          const user = createTestUser(role);
          const ability = defineAbilityFor(user);
          expect(ability.can('read', 'Pack')).toBe(true);
        }
      });
    });

    describe('PUT /api/packs/:id - Update Pack', () => {
      it('should allow admin to update any pack', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('update', 'Pack')).toBe(true);
      });

      it('should deny node from updating pack', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('update', 'Pack')).toBe(false);
      });

      it('should deny viewer from updating pack', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('update', 'Pack')).toBe(false);
      });
    });

    describe('DELETE /api/packs/:id - Delete Pack', () => {
      it('should allow admin to delete any pack', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('delete', 'Pack')).toBe(true);
      });

      it('should deny node from deleting pack', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('delete', 'Pack')).toBe(false);
      });

      it('should deny viewer from deleting pack', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('delete', 'Pack')).toBe(false);
      });
    });
  });

  describe('Pod Resource RBAC', () => {
    describe('POST /api/pods - Create Pod', () => {
      it('should allow admin to create pod', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('create', 'Pod')).toBe(true);
      });

      it('should deny node from creating pod', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('create', 'Pod')).toBe(false);
      });

      it('should deny viewer from creating pod', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('create', 'Pod')).toBe(false);
      });
    });

    describe('GET /api/pods - List Pods', () => {
      it('should allow all roles to list pods', () => {
        const roles: UserRole[] = ['admin', 'node', 'viewer'];
        for (const role of roles) {
          const user = createTestUser(role);
          const ability = defineAbilityFor(user);
          expect(ability.can('read', 'Pod')).toBe(true);
        }
      });
    });

    describe('PUT /api/pods/:id - Update Pod', () => {
      it('should allow admin to update any pod', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('update', 'Pod')).toBe(true);
      });

      it('should allow node to update pod (ownership checked in handler)', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('update', 'Pod')).toBe(true);
      });

      it('should deny viewer from updating pod', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('update', 'Pod')).toBe(false);
      });
    });

    describe('DELETE /api/pods/:id - Delete Pod', () => {
      it('should allow admin to delete any pod', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('delete', 'Pod')).toBe(true);
      });

      it('should deny node from deleting pod', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('delete', 'Pod')).toBe(false);
      });

      it('should deny viewer from deleting pod', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('delete', 'Pod')).toBe(false);
      });
    });
  });

  describe('Node Resource RBAC', () => {
    describe('POST /api/nodes - Register Node', () => {
      it('should allow admin to register node', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('create', 'Node')).toBe(true);
      });

      it('should allow node to register itself', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('create', 'Node')).toBe(true);
      });

      it('should deny viewer from registering node', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('create', 'Node')).toBe(false);
      });
    });

    describe('GET /api/nodes - List Nodes', () => {
      it('should allow all roles to list nodes', () => {
        const roles: UserRole[] = ['admin', 'node', 'viewer'];
        for (const role of roles) {
          const user = createTestUser(role);
          const ability = defineAbilityFor(user);
          expect(ability.can('read', 'Node')).toBe(true);
        }
      });
    });

    describe('PUT /api/nodes/:id - Update Node', () => {
      it('should allow admin to update node', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('update', 'Node')).toBe(true);
      });

      it('should allow node to update itself (ownership checked in handler)', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('update', 'Node')).toBe(true);
      });

      it('should deny viewer from updating node', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('update', 'Node')).toBe(false);
      });
    });

    describe('DELETE /api/nodes/:id - Delete Node', () => {
      it('should allow admin to delete node', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('delete', 'Node')).toBe(true);
      });

      it('should deny node from deleting nodes', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('delete', 'Node')).toBe(false);
      });

      it('should deny viewer from deleting node', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('delete', 'Node')).toBe(false);
      });
    });
  });

  describe('Namespace Resource RBAC', () => {
    describe('POST /api/namespaces - Create Namespace', () => {
      it('should allow admin to create namespace', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('create', 'Namespace')).toBe(true);
      });

      it('should deny node from creating namespace', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('create', 'Namespace')).toBe(false);
      });

      it('should deny viewer from creating namespace', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('create', 'Namespace')).toBe(false);
      });
    });

    describe('GET /api/namespaces - List Namespaces', () => {
      it('should allow all roles to list namespaces', () => {
        const roles: UserRole[] = ['admin', 'node', 'viewer'];
        for (const role of roles) {
          const user = createTestUser(role);
          const ability = defineAbilityFor(user);
          expect(ability.can('read', 'Namespace')).toBe(true);
        }
      });
    });

    describe('DELETE /api/namespaces/:name - Delete Namespace', () => {
      it('should allow admin to delete namespace', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('delete', 'Namespace')).toBe(true);
      });

      it('should deny node from deleting namespace', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('delete', 'Namespace')).toBe(false);
      });

      it('should deny viewer from deleting namespace', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('delete', 'Namespace')).toBe(false);
      });
    });
  });

  describe('User Resource RBAC', () => {
    describe('GET /api/users - List Users', () => {
      it('should allow admin to list all users', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('read', 'User')).toBe(true);
      });

      it('should deny node from listing all users', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('read', 'User')).toBe(false);
      });

      it('should deny viewer from listing all users', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('read', 'User')).toBe(false);
      });
    });

    describe('GET /api/users/:id - Get User', () => {
      it('should allow admin to get any user', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('read', 'User')).toBe(true);
      });

      it('should deny node from getting other user', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('read', 'User')).toBe(false);
      });

      it('should deny viewer from getting other user', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('read', 'User')).toBe(false);
      });
    });

    describe('PUT /api/users/:id - Update User', () => {
      it('should allow admin to update any user', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('update', 'User')).toBe(true);
      });

      it('should deny node from updating users', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('update', 'User')).toBe(false);
      });

      it('should deny viewer from updating users', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('update', 'User')).toBe(false);
      });
    });

    describe('DELETE /api/users/:id - Delete User', () => {
      it('should allow admin to delete any user', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('delete', 'User')).toBe(true);
      });

      it('should deny node from deleting users', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('delete', 'User')).toBe(false);
      });

      it('should deny viewer from deleting users', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('delete', 'User')).toBe(false);
      });
    });
  });

  describe('Cross-Cutting RBAC Concerns', () => {
    describe('Role Hierarchy', () => {
      it('should grant admin all permissions via manage all', () => {
        const ability = defineAbilityFor(adminUser);
        // Admin should be able to perform any action on any resource
        expect(ability.can('manage', 'Pack')).toBe(true);
        expect(ability.can('manage', 'Pod')).toBe(true);
        expect(ability.can('manage', 'Node')).toBe(true);
        expect(ability.can('manage', 'Namespace')).toBe(true);
        expect(ability.can('manage', 'User')).toBe(true);
        expect(ability.can('manage', 'ClusterConfig')).toBe(true);
      });

      it('should grant node agent permissions', () => {
        const ability = defineAbilityFor(nodeUser);
        // Nodes can register and update themselves
        expect(ability.can('create', 'Node')).toBe(true);
        expect(ability.can('read', 'Node')).toBe(true);
        expect(ability.can('update', 'Node')).toBe(true);
        // Nodes can read and update pods assigned to them
        expect(ability.can('read', 'Pod')).toBe(true);
        expect(ability.can('update', 'Pod')).toBe(true);
        // Nodes can read packs to execute them
        expect(ability.can('read', 'Pack')).toBe(true);
        // Nodes can read namespaces for pod filtering
        expect(ability.can('read', 'Namespace')).toBe(true);
        // Nodes cannot delete resources or manage users
        expect(ability.can('delete', 'Node')).toBe(false);
        expect(ability.can('create', 'Pod')).toBe(false);
        expect(ability.can('delete', 'Pod')).toBe(false);
        expect(ability.can('manage', 'User')).toBe(false);
      });

      it('should grant viewer read-only access', () => {
        const ability = defineAbilityFor(viewerUser);
        // Viewers have read-only access
        expect(ability.can('read', 'Pack')).toBe(true);
        expect(ability.can('read', 'Pod')).toBe(true);
        expect(ability.can('read', 'Node')).toBe(true);
        expect(ability.can('read', 'Namespace')).toBe(true);
        // Viewers cannot create, update, or delete anything
        expect(ability.can('create', 'Pack')).toBe(false);
        expect(ability.can('update', 'Pack')).toBe(false);
        expect(ability.can('delete', 'Pack')).toBe(false);
        expect(ability.can('create', 'Pod')).toBe(false);
        expect(ability.can('create', 'Node')).toBe(false);
      });
    });

    describe('Multi-Role Users', () => {
      it('should combine permissions for users with multiple roles', () => {
        // User with both node and viewer roles should have both sets of permissions
        const multiRoleUser: User = {
          ...nodeUser,
          roles: ['node', 'viewer'],
        };
        const ability = defineAbilityFor(multiRoleUser);
        
        // Node permissions
        expect(ability.can('create', 'Node')).toBe(true);
        expect(ability.can('update', 'Node')).toBe(true);
        expect(ability.can('update', 'Pod')).toBe(true);
        
        // Viewer permissions (already covered by node)
        expect(ability.can('read', 'Pack')).toBe(true);
        expect(ability.can('read', 'Pod')).toBe(true);
      });

      it('should handle user with all roles', () => {
        const allRolesUser: User = {
          ...adminUser,
          roles: ['admin', 'node', 'viewer'],
        };
        const ability = defineAbilityFor(allRolesUser);
        
        // Should have full access via admin role
        expect(ability.can('manage', 'all')).toBe(true);
      });
    });

    describe('Ability Creation', () => {
      it('should create ability for each role without error', () => {
        const roles: UserRole[] = ['admin', 'node', 'viewer'];
        for (const role of roles) {
          const user = createTestUser(role);
          const ability = defineAbilityFor(user);
          expect(ability).toBeDefined();
        }
      });

      it('should handle empty roles array gracefully', () => {
        const noRolesUser: User = {
          ...viewerUser,
          roles: [] as unknown as UserRole[],
        };
        const ability = defineAbilityFor(noRolesUser);
        // User with no roles should have no permissions
        expect(ability.can('read', 'Pack')).toBe(false);
        expect(ability.can('create', 'Pod')).toBe(false);
      });
    });

    describe('ClusterConfig RBAC', () => {
      it('should allow admin to manage cluster config', () => {
        const ability = defineAbilityFor(adminUser);
        expect(ability.can('manage', 'ClusterConfig')).toBe(true);
      });

      it('should deny node from managing cluster config', () => {
        const ability = defineAbilityFor(nodeUser);
        expect(ability.can('manage', 'ClusterConfig')).toBe(false);
      });

      it('should deny viewer from managing cluster config', () => {
        const ability = defineAbilityFor(viewerUser);
        expect(ability.can('manage', 'ClusterConfig')).toBe(false);
      });
    });
  });
});
