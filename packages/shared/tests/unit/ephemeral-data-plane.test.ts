/**
 * Tests for Ephemeral Data Plane
 *
 * Covers:
 *   - PodGroupStore: join/leave, TTL expiration, reaping, indices, limits
 *   - EphemeralDataPlane: joinGroup, getGroupPods, queryPods, handlers
 *   - Audit hooks: event emission on join/leave/expire/dissolve
 *   - Overlapping groups and multi-membership
 *   - Edge cases: duplicate joins, empty groups, disposed stores
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PodGroupStore, resetPodGroupStore } from '../../src/network/pod-group-store.js';
import {
  EphemeralDataPlane,
  createEphemeralDataPlane,
} from '../../src/network/ephemeral-data-plane.js';
import { PodGroupHandle } from '../../src/network/pod-group-handle.js';
import type {
  EphemeralEvent,
  EphemeralAuditHook,
  PodGroupMembership,
  EphemeralQuery,
  EphemeralResponse,
} from '../../src/types/ephemeral.js';

// ═══════════════════════════════════════════════════════════════════════════
// PodGroupStore
// ═══════════════════════════════════════════════════════════════════════════

describe('PodGroupStore', () => {
  let store: PodGroupStore;

  beforeEach(() => {
    store = new PodGroupStore({ reapIntervalMs: 0 }); // disable auto-reap for tests
  });

  afterEach(() => {
    store.dispose();
    resetPodGroupStore();
  });

  // ── Basic Join/Leave ──────────────────────────────────────────────────

  describe('joinGroup', () => {
    it('creates a new group on first join', () => {
      const membership = store.joinGroup('room:lobby', 'pod-1');
      expect(membership.podId).toBe('pod-1');
      expect(membership.ttl).toBeGreaterThan(0);
      expect(store.groupCount).toBe(1);
      expect(store.membershipCount).toBe(1);
    });

    it('adds multiple pods to the same group', () => {
      store.joinGroup('room:lobby', 'pod-1');
      store.joinGroup('room:lobby', 'pod-2');
      store.joinGroup('room:lobby', 'pod-3');

      const members = store.getGroupPods('room:lobby');
      expect(members).toHaveLength(3);
      expect(members.map(m => m.podId).sort()).toEqual(['pod-1', 'pod-2', 'pod-3']);
    });

    it('refreshes membership on duplicate join', () => {
      const first = store.joinGroup('g1', 'pod-1');
      const firstJoinedAt = first.joinedAt;

      // Simulate time passing by mocking Date.now
      const originalNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(originalNow + 100);

      const refreshed = store.joinGroup('g1', 'pod-1');

      expect(refreshed.joinedAt).toBe(firstJoinedAt); // preserved
      expect(refreshed.lastRefreshedAt).toBeGreaterThan(firstJoinedAt);
      expect(store.membershipCount).toBe(1); // not duplicated

      vi.restoreAllMocks();
    });

    it('supports custom TTL per membership', () => {
      const m = store.joinGroup('g1', 'pod-1', 5_000);
      expect(m.ttl).toBe(5_000);
    });

    it('supports custom metadata', () => {
      const m = store.joinGroup('g1', 'pod-1', undefined, { role: 'editor' });
      expect(m.metadata).toEqual({ role: 'editor' });
    });
  });

  describe('leaveGroup', () => {
    it('removes a pod from a group', () => {
      store.joinGroup('g1', 'pod-1');
      store.joinGroup('g1', 'pod-2');

      const removed = store.leaveGroup('g1', 'pod-1');
      expect(removed).toBe(true);
      expect(store.getGroupPods('g1')).toHaveLength(1);
      expect(store.getGroupPods('g1')[0]!.podId).toBe('pod-2');
    });

    it('returns false if pod was not a member', () => {
      expect(store.leaveGroup('g1', 'pod-1')).toBe(false);
    });

    it('dissolves group when last member leaves', () => {
      store.joinGroup('g1', 'pod-1');
      store.leaveGroup('g1', 'pod-1');

      expect(store.groupCount).toBe(0);
      expect(store.getGroup('g1')).toBeUndefined();
    });
  });

  describe('leaveAllGroups', () => {
    it('removes pod from all groups', () => {
      store.joinGroup('g1', 'pod-1');
      store.joinGroup('g2', 'pod-1');
      store.joinGroup('g3', 'pod-1');
      store.joinGroup('g1', 'pod-2'); // keep g1 alive

      const removed = store.leaveAllGroups('pod-1');
      expect(removed.sort()).toEqual(['g1', 'g2', 'g3']);
      expect(store.getGroupPods('g1')).toHaveLength(1); // pod-2 remains
      expect(store.getGroupPods('g2')).toHaveLength(0);
      expect(store.groupCount).toBe(1); // only g1 survives
    });

    it('returns empty array if pod has no groups', () => {
      expect(store.leaveAllGroups('pod-nonexistent')).toEqual([]);
    });
  });

  // ── Overlapping Groups ────────────────────────────────────────────────

  describe('overlapping groups', () => {
    it('supports a pod in multiple groups simultaneously', () => {
      store.joinGroup('g1', 'pod-1');
      store.joinGroup('g2', 'pod-1');
      store.joinGroup('g3', 'pod-1');

      expect(store.getGroupsForPod('pod-1').sort()).toEqual(['g1', 'g2', 'g3']);
      expect(store.isMember('g1', 'pod-1')).toBe(true);
      expect(store.isMember('g2', 'pod-1')).toBe(true);
      expect(store.isMember('g3', 'pod-1')).toBe(true);
    });

    it('independent TTLs per group membership', () => {
      store.joinGroup('g1', 'pod-1', 1_000);
      store.joinGroup('g2', 'pod-1', 5_000);

      const m1 = store.getGroupPods('g1').find(m => m.podId === 'pod-1');
      const m2 = store.getGroupPods('g2').find(m => m.podId === 'pod-1');

      expect(m1!.ttl).toBe(1_000);
      expect(m2!.ttl).toBe(5_000);
    });
  });

  // ── TTL and Reaping ───────────────────────────────────────────────────

  describe('TTL / reaping', () => {
    it('reaps expired memberships', () => {
      // Use a very short TTL
      store.joinGroup('g1', 'pod-1', 1); // 1ms TTL

      // Simulate passage of time
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 100);

      const reaped = store.reapStaleMembers();
      expect(reaped).toBe(1);
      expect(store.getGroupPods('g1')).toHaveLength(0);
      expect(store.groupCount).toBe(0); // group dissolved

      vi.restoreAllMocks();
    });

    it('does not reap memberships with TTL=0 (infinite)', () => {
      store.joinGroup('g1', 'pod-1', 0);

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 1_000_000);

      const reaped = store.reapStaleMembers();
      expect(reaped).toBe(0);
      expect(store.isMember('g1', 'pod-1')).toBe(true);

      vi.restoreAllMocks();
    });

    it('refreshing a membership resets the TTL clock', () => {
      store.joinGroup('g1', 'pod-1', 100);

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 50);

      // Refresh before expiry
      store.joinGroup('g1', 'pod-1', 100);

      vi.spyOn(Date, 'now').mockReturnValue(now + 120);

      // Would have expired under original TTL, but refresh moved it forward
      const reaped = store.reapStaleMembers();
      // It should not be reaped because lastRefreshedAt was updated
      // The effective expiry is now + 50 + 100 = now + 150
      expect(store.isMember('g1', 'pod-1')).toBe(true);

      vi.restoreAllMocks();
    });
  });

  // ── Queries ───────────────────────────────────────────────────────────

  describe('getGroup / snapshot', () => {
    it('returns full PodGroup metadata', () => {
      store.joinGroup('room:1', 'pod-a');
      store.joinGroup('room:1', 'pod-b');

      const group = store.getGroup('room:1');
      expect(group).toBeDefined();
      expect(group!.groupId).toBe('room:1');
      expect(group!.members).toHaveLength(2);
      expect(group!.createdAt).toBeGreaterThan(0);
      expect(group!.updatedAt).toBeGreaterThanOrEqual(group!.createdAt);
    });

    it('returns undefined for nonexistent group', () => {
      expect(store.getGroup('nonexistent')).toBeUndefined();
    });

    it('snapshot returns all groups', () => {
      store.joinGroup('g1', 'pod-1');
      store.joinGroup('g2', 'pod-2');

      const snap = store.snapshot();
      expect(Object.keys(snap).sort()).toEqual(['g1', 'g2']);
      expect(snap['g1']!.members).toHaveLength(1);
    });
  });

  // ── Limits ────────────────────────────────────────────────────────────

  describe('limits', () => {
    it('enforces maxGroups', () => {
      const limited = new PodGroupStore({ maxGroups: 2, reapIntervalMs: 0 });
      limited.joinGroup('g1', 'pod-1');
      limited.joinGroup('g2', 'pod-2');

      expect(() => limited.joinGroup('g3', 'pod-3')).toThrow(/maximum group limit/);
      limited.dispose();
    });

    it('enforces maxMembersPerGroup', () => {
      const limited = new PodGroupStore({ maxMembersPerGroup: 2, reapIntervalMs: 0 });
      limited.joinGroup('g1', 'pod-1');
      limited.joinGroup('g1', 'pod-2');

      expect(() => limited.joinGroup('g1', 'pod-3')).toThrow(/member limit/);
      limited.dispose();
    });

    it('allows re-join when at member limit (refresh, not new)', () => {
      const limited = new PodGroupStore({ maxMembersPerGroup: 1, reapIntervalMs: 0 });
      limited.joinGroup('g1', 'pod-1');

      // Re-joining existing member should succeed
      expect(() => limited.joinGroup('g1', 'pod-1')).not.toThrow();
      limited.dispose();
    });
  });

  // ── Audit Hooks ───────────────────────────────────────────────────────

  describe('audit hooks', () => {
    it('emits PodGroupCreated on first join', () => {
      const events: EphemeralEvent[] = [];
      store.onEvent((e) => events.push(e));

      store.joinGroup('g1', 'pod-1');

      const created = events.find(e => e.type === 'PodGroupCreated');
      expect(created).toBeDefined();
      expect(created!.groupId).toBe('g1');
    });

    it('emits PodJoinedGroup on join', () => {
      const events: EphemeralEvent[] = [];
      store.onEvent((e) => events.push(e));

      store.joinGroup('g1', 'pod-1');

      const joined = events.find(e => e.type === 'PodJoinedGroup');
      expect(joined).toBeDefined();
      expect(joined!.podId).toBe('pod-1');
      expect(joined!.groupId).toBe('g1');
    });

    it('emits PodMembershipRefreshed on re-join', () => {
      store.joinGroup('g1', 'pod-1');

      const events: EphemeralEvent[] = [];
      store.onEvent((e) => events.push(e));

      store.joinGroup('g1', 'pod-1');

      const refreshed = events.find(e => e.type === 'PodMembershipRefreshed');
      expect(refreshed).toBeDefined();
    });

    it('emits PodLeftGroup on leave', () => {
      store.joinGroup('g1', 'pod-1');

      const events: EphemeralEvent[] = [];
      store.onEvent((e) => events.push(e));

      store.leaveGroup('g1', 'pod-1');

      const left = events.find(e => e.type === 'PodLeftGroup');
      expect(left).toBeDefined();
      expect(left!.podId).toBe('pod-1');
    });

    it('emits PodGroupDissolved when last member leaves', () => {
      store.joinGroup('g1', 'pod-1');

      const events: EphemeralEvent[] = [];
      store.onEvent((e) => events.push(e));

      store.leaveGroup('g1', 'pod-1');

      const dissolved = events.find(e => e.type === 'PodGroupDissolved');
      expect(dissolved).toBeDefined();
      expect(dissolved!.groupId).toBe('g1');
    });

    it('emits PodMembershipExpired on reap', () => {
      store.joinGroup('g1', 'pod-1', 1);

      const events: EphemeralEvent[] = [];
      store.onEvent((e) => events.push(e));

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 100);

      store.reapStaleMembers();

      const expired = events.find(e => e.type === 'PodMembershipExpired');
      expect(expired).toBeDefined();
      expect(expired!.podId).toBe('pod-1');

      vi.restoreAllMocks();
    });

    it('dispose function unregisters hook', () => {
      const events: EphemeralEvent[] = [];
      const dispose = store.onEvent((e) => events.push(e));

      store.joinGroup('g1', 'pod-1');
      expect(events.length).toBeGreaterThan(0);

      const countBefore = events.length;
      dispose();

      store.joinGroup('g2', 'pod-2');
      expect(events.length).toBe(countBefore); // no new events
    });

    it('swallows hook errors silently', () => {
      store.onEvent(() => { throw new Error('boom'); });
      // Should not throw
      expect(() => store.joinGroup('g1', 'pod-1')).not.toThrow();
    });
  });

  // ── Clear / Dispose ────────────────────────────────────────────────────

  describe('clear / dispose', () => {
    it('clear removes all data but keeps store usable', () => {
      store.joinGroup('g1', 'pod-1');
      store.joinGroup('g2', 'pod-2');

      store.clear();

      expect(store.groupCount).toBe(0);
      expect(store.membershipCount).toBe(0);

      // Should still work after clear
      store.joinGroup('g3', 'pod-3');
      expect(store.groupCount).toBe(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EphemeralDataPlane
// ═══════════════════════════════════════════════════════════════════════════

describe('EphemeralDataPlane', () => {
  let plane: EphemeralDataPlane;

  beforeEach(() => {
    plane = createEphemeralDataPlane({
      podId: 'pod-self',
      serviceId: 'my-service',
      config: { reapIntervalMs: 0 },
    });
  });

  afterEach(() => {
    plane.dispose();
  });

  // ── Group API ─────────────────────────────────────────────────────────

  describe('joinGroup / getGroupPods', () => {
    it('joins a group and returns a PodGroupHandle', async () => {
      const handle = await plane.joinGroup('room:lobby');

      expect(handle).toBeInstanceOf(PodGroupHandle);
      expect(handle.groupId).toBe('room:lobby');
      expect(handle.podIds).toContain('pod-self');

      const members = plane.getGroupPods('room:lobby');
      expect(members).toHaveLength(1);
      expect((members as PodGroupMembership[])[0]!.podId).toBe('pod-self');
    });

    it('returns empty array for unknown group', () => {
      expect(plane.getGroupPods('nonexistent')).toEqual([]);
    });

    it('supports TTL and metadata options', async () => {
      const handle = await plane.joinGroup('g1', { ttl: 3_000, metadata: { cursor: 42 } });
      expect(handle.membership.ttl).toBe(3_000);
      expect(handle.membership.metadata).toEqual({ cursor: 42 });
    });

    it('returns the same handle on duplicate join to same group', async () => {
      const h1 = await plane.joinGroup('g1');
      const h2 = await plane.joinGroup('g1');
      expect(h1).toBe(h2);
    });
  });

  describe('leaveGroup / leaveAllGroups', () => {
    it('leaves a specific group', async () => {
      await plane.joinGroup('g1');
      await plane.joinGroup('g2');

      plane.leaveGroup('g1');

      expect(plane.myGroups()).toEqual(['g2']);
    });

    it('leaveAllGroups clears all memberships', async () => {
      await plane.joinGroup('g1');
      await plane.joinGroup('g2');

      const removed = await plane.leaveAllGroups();
      expect(removed.sort()).toEqual(['g1', 'g2']);
      expect(plane.myGroups()).toEqual([]);
    });

    it('leaveGroup marks the handle as left', async () => {
      const handle = await plane.joinGroup('g1');
      expect(handle.isLeft).toBe(false);

      plane.leaveGroup('g1');

      expect(handle.isLeft).toBe(true);
      expect(handle.podIds).toEqual([]);
      expect(handle.members).toEqual([]);
    });

    it('leaveAllGroups marks all handles as left', async () => {
      const h1 = await plane.joinGroup('g1');
      const h2 = await plane.joinGroup('g2');

      await plane.leaveAllGroups();

      expect(h1.isLeft).toBe(true);
      expect(h2.isLeft).toBe(true);
    });
  });

  describe('myGroups', () => {
    it('lists all groups the pod belongs to', async () => {
      await plane.joinGroup('a');
      await plane.joinGroup('b');
      await plane.joinGroup('c');

      expect((plane.myGroups() as string[]).sort()).toEqual(['a', 'b', 'c']);
    });
  });

  // ── Query API ─────────────────────────────────────────────────────────

  describe('queryPods (local handlers)', () => {
    it('dispatches to registered handler and returns response', async () => {
      plane.handle('/state', (path, query) => ({
        status: 200,
        body: { path, query, alive: true },
      }));

      const result = await plane.queryPods(['pod-self'], '/state/presence', { room: 'lobby' });

      expect(result.complete).toBe(true);
      expect(result.timedOut).toHaveLength(0);
      expect(result.responses.size).toBe(1);

      const resp = result.responses.get('pod-self');
      expect(resp).toBeDefined();
      expect(resp!.status).toBe(200);
      expect(resp!.body).toEqual({
        path: '/state/presence',
        query: { room: 'lobby' },
        alive: true,
      });
    });

    it('times out remote pods when no transport is provided', async () => {
      const result = await plane.queryPods(['pod-remote'], '/health');

      expect(result.complete).toBe(false);
      expect(result.timedOut).toEqual(['pod-remote']);
      expect(result.responses.size).toBe(0);
    });

    it('handles handler errors gracefully', async () => {
      plane.handle('/crash', () => {
        throw new Error('handler boom');
      });

      const result = await plane.queryPods(['pod-self'], '/crash');

      expect(result.responses.size).toBe(1);
      const resp = result.responses.get('pod-self');
      expect(resp!.status).toBe(500);
    });

    it('returns 404-like for unmatched paths (null → timeout)', async () => {
      // No handlers registered
      const result = await plane.queryPods(['pod-self'], '/unknown');

      expect(result.timedOut).toEqual(['pod-self']);
    });
  });

  describe('queryPods (with transport)', () => {
    it('fans out queries via transport', async () => {
      const mockTransport = vi.fn(async (
        targetPodId: string,
        query: EphemeralQuery,
      ): Promise<EphemeralResponse> => ({
        queryId: query.queryId,
        podId: targetPodId,
        status: 200,
        body: { echo: true },
        respondedAt: Date.now(),
      }));

      const planeWithTransport = createEphemeralDataPlane({
        podId: 'pod-self',
        transport: mockTransport,
        config: { reapIntervalMs: 0 },
      });

      const result = await planeWithTransport.queryPods(
        ['pod-a', 'pod-b'],
        '/ping',
      );

      expect(mockTransport).toHaveBeenCalledTimes(2);
      expect(result.complete).toBe(true);
      expect(result.responses.size).toBe(2);

      planeWithTransport.dispose();
    });

    it('handles transport timeout per pod', async () => {
      const mockTransport = vi.fn(async (
        targetPodId: string,
        _query: EphemeralQuery,
      ): Promise<EphemeralResponse> => {
        if (targetPodId === 'pod-slow') {
          await new Promise((resolve) => setTimeout(resolve, 10_000)); // will timeout
        }
        return {
          queryId: _query.queryId,
          podId: targetPodId,
          status: 200,
          respondedAt: Date.now(),
        };
      });

      const planeWithTransport = createEphemeralDataPlane({
        podId: 'pod-self',
        transport: mockTransport,
        config: { reapIntervalMs: 0, defaultQueryTimeout: 50 },
      });

      const result = await planeWithTransport.queryPods(
        ['pod-fast', 'pod-slow'],
        '/ping',
      );

      expect(result.responses.has('pod-fast')).toBe(true);
      expect(result.timedOut).toContain('pod-slow');

      planeWithTransport.dispose();
    });
  });

  // ── Response Storage ──────────────────────────────────────────────────

  describe('getQueryResult / getResponses', () => {
    it('stores and retrieves query results', async () => {
      plane.handle('/echo', () => ({ status: 200, body: 'hello' }));

      const result = await plane.queryPods(['pod-self'], '/echo');
      const queryId = result.query.queryId;

      const stored = plane.getQueryResult(queryId);
      expect(stored).toBeDefined();
      expect(stored!.query.queryId).toBe(queryId);

      const responses = plane.getResponses(queryId);
      expect(responses).toBeDefined();
      expect(responses!.get('pod-self')!.body).toBe('hello');
    });

    it('returns undefined for unknown queryId', () => {
      expect(plane.getQueryResult('nonexistent')).toBeUndefined();
      expect(plane.getResponses('nonexistent')).toBeUndefined();
    });
  });

  describe('evictStaleResults', () => {
    it('removes results older than maxAge', async () => {
      plane.handle('/ping', () => ({ status: 200 }));

      await plane.queryPods(['pod-self'], '/ping');
      const queryId = (await plane.queryPods(['pod-self'], '/ping')).query.queryId;

      // Simulate time passage
      const originalNow = Date.now;
      Date.now = () => originalNow() + 120_000;

      const evicted = plane.evictStaleResults(60_000);
      expect(evicted).toBe(2);
      expect(plane.getQueryResult(queryId)).toBeUndefined();

      Date.now = originalNow;
    });
  });

  // ── Incoming Query Handler ─────────────────────────────────────────────

  describe('handleIncomingQuery', () => {
    it('dispatches incoming query to registered handler', async () => {
      plane.handle('/state', () => ({ status: 200, body: { ready: true } }));

      const response = await plane.handleIncomingQuery({
        queryId: 'q-external-1',
        targetPodIds: ['pod-self'],
        path: '/state/ready',
        issuedAt: Date.now(),
      });

      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.body).toEqual({ ready: true });
    });

    it('returns null when no handler matches', async () => {
      const response = await plane.handleIncomingQuery({
        queryId: 'q-external-2',
        targetPodIds: ['pod-self'],
        path: '/no-handler',
        issuedAt: Date.now(),
      });

      expect(response).toBeNull();
    });
  });

  // ── Audit Hooks (via plane) ────────────────────────────────────────────

  describe('audit hooks', () => {
    it('receives group events through the plane', async () => {
      const events: EphemeralEvent[] = [];
      plane.onEvent((e) => events.push(e));

      await plane.joinGroup('room:test');
      plane.leaveGroup('room:test');

      expect(events.some(e => e.type === 'PodJoinedGroup')).toBe(true);
      expect(events.some(e => e.type === 'PodLeftGroup')).toBe(true);
    });
  });

  // ── Store Access ──────────────────────────────────────────────────────

  describe('getStore', () => {
    it('returns the backing PodGroupStore', () => {
      const store = plane.getStore();
      expect(store).toBeInstanceOf(PodGroupStore);
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('cleans up all state', async () => {
      const h1 = await plane.joinGroup('g1');
      const h2 = await plane.joinGroup('g2');

      plane.dispose();

      // The store is disposed — accessing it after dispose should still work without error
      expect(plane.myGroups()).toEqual([]);
      // All handles should be marked as left
      expect(h1.isLeft).toBe(true);
      expect(h2.isLeft).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PodGroupHandle
// ═══════════════════════════════════════════════════════════════════════════

describe('PodGroupHandle', () => {
  let plane: EphemeralDataPlane;

  beforeEach(() => {
    plane = createEphemeralDataPlane({
      podId: 'pod-self',
      serviceId: 'svc-test',
      config: { reapIntervalMs: 0 },
    });
  });

  afterEach(() => {
    plane.dispose();
  });

  // ── Construction / Properties ─────────────────────────────────────────

  describe('construction', () => {
    it('returns a PodGroupHandle from joinGroup', async () => {
      const handle = await plane.joinGroup('room:test');
      expect(handle).toBeInstanceOf(PodGroupHandle);
    });

    it('populates groupId, membership, podIds, and members', async () => {
      const handle = await plane.joinGroup('room:test', { ttl: 5_000, metadata: { role: 'x' } });
      expect(handle.groupId).toBe('room:test');
      expect(handle.membership.podId).toBe('pod-self');
      expect(handle.membership.ttl).toBe(5_000);
      expect(handle.membership.metadata).toEqual({ role: 'x' });
      expect(handle.podIds).toEqual(['pod-self']);
      expect(handle.members).toHaveLength(1);
      expect(handle.members[0]!.podId).toBe('pod-self');
    });

    it('populates members from multiple pods in the group', async () => {
      // Simulate another pod already in the group via the backing store
      const store = plane.getStore()!;
      store.joinGroup('room:test', 'pod-other', 60_000);

      const handle = await plane.joinGroup('room:test');
      expect(handle.podIds.sort()).toEqual(['pod-other', 'pod-self']);
      expect(handle.members).toHaveLength(2);
    });
  });

  // ── otherPodIds ───────────────────────────────────────────────────────

  describe('otherPodIds', () => {
    it('excludes the current pod', async () => {
      const store = plane.getStore()!;
      store.joinGroup('g1', 'pod-a', 60_000);
      store.joinGroup('g1', 'pod-b', 60_000);

      const handle = await plane.joinGroup('g1');

      expect(handle.otherPodIds.sort()).toEqual(['pod-a', 'pod-b']);
      expect(handle.otherPodIds).not.toContain('pod-self');
    });

    it('returns empty array when only self is in the group', async () => {
      const handle = await plane.joinGroup('g1');
      expect(handle.otherPodIds).toEqual([]);
    });
  });

  // ── queryPods ─────────────────────────────────────────────────────────

  describe('queryPods', () => {
    it('returns an array of promises, one per other pod', async () => {
      const store = plane.getStore()!;
      store.joinGroup('g1', 'pod-a', 60_000);
      store.joinGroup('g1', 'pod-b', 60_000);

      const handle = await plane.joinGroup('g1');

      const promises = handle.queryPods('/echo');
      expect(promises).toHaveLength(2); // pod-a, pod-b (not pod-self)
      expect(promises[0]).toBeInstanceOf(Promise);
    });

    it('each promise resolves to an EphemeralQueryResult', async () => {
      // Use a transport so queries actually resolve
      const mockTransport = vi.fn(async (
        targetPodId: string,
        query: EphemeralQuery,
      ): Promise<EphemeralResponse> => ({
        queryId: query.queryId,
        podId: targetPodId,
        status: 200,
        body: { hello: 'back' },
        respondedAt: Date.now(),
      }));

      const planeT = createEphemeralDataPlane({
        podId: 'pod-self',
        transport: mockTransport,
        config: { reapIntervalMs: 0 },
      });

      const store = planeT.getStore()!;
      store.joinGroup('g1', 'pod-peer', 60_000);

      const handle = await planeT.joinGroup('g1');
      const results = await Promise.all(handle.queryPods('/echo', { from: 'me' }));

      expect(results).toHaveLength(1);
      expect(results[0]!.complete).toBe(true);
      expect(results[0]!.responses.get('pod-peer')!.status).toBe(200);
      expect(results[0]!.responses.get('pod-peer')!.body).toEqual({ hello: 'back' });

      planeT.dispose();
    });

    it('returns empty array when no other pods in group', async () => {
      const handle = await plane.joinGroup('g1');
      const promises = handle.queryPods('/echo');
      expect(promises).toEqual([]);
    });

    it('returns empty array when handle is left', async () => {
      const store = plane.getStore()!;
      store.joinGroup('g1', 'pod-a', 60_000);

      const handle = await plane.joinGroup('g1');
      await handle.leave();

      const promises = handle.queryPods('/echo');
      expect(promises).toEqual([]);
    });

    it('includes self when includeSelf=true', async () => {
      plane.handle('/ping', () => ({ status: 200, body: 'pong' }));

      const handle = await plane.joinGroup('g1');
      const promises = handle.queryPods('/ping', undefined, undefined, true);
      expect(promises).toHaveLength(1); // just self

      const results = await Promise.all(promises);
      expect(results[0]!.responses.get('pod-self')!.body).toBe('pong');
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('updates membership and member list', async () => {
      const handle = await plane.joinGroup('g1', { ttl: 5_000 });
      expect(handle.podIds).toEqual(['pod-self']);

      // Add another pod behind the scenes
      const store = plane.getStore()!;
      store.joinGroup('g1', 'pod-new', 60_000);

      await handle.refresh();

      expect(handle.podIds.sort()).toEqual(['pod-new', 'pod-self']);
      expect(handle.members).toHaveLength(2);
    });

    it('refreshes the membership TTL', async () => {
      const handle = await plane.joinGroup('g1', { ttl: 5_000 });
      const originalRefresh = handle.membership.lastRefreshedAt;

      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 100);

      await handle.refresh();

      expect(handle.membership.lastRefreshedAt).toBeGreaterThan(originalRefresh);

      vi.restoreAllMocks();
    });

    it('is a no-op after leave', async () => {
      const handle = await plane.joinGroup('g1');
      await handle.leave();

      await handle.refresh(); // should not throw
      expect(handle.podIds).toEqual([]);
    });
  });

  // ── leave ─────────────────────────────────────────────────────────────

  describe('leave', () => {
    it('marks handle as left', async () => {
      const handle = await plane.joinGroup('g1');
      expect(handle.isLeft).toBe(false);

      await handle.leave();

      expect(handle.isLeft).toBe(true);
    });

    it('clears members and podIds', async () => {
      const handle = await plane.joinGroup('g1');
      expect(handle.podIds).toHaveLength(1);

      await handle.leave();

      expect(handle.podIds).toEqual([]);
      expect(handle.members).toEqual([]);
    });

    it('actually leaves the group on the store', async () => {
      const handle = await plane.joinGroup('g1');
      expect(plane.getStore()!.isMember('g1', 'pod-self')).toBe(true);

      await handle.leave();

      expect(plane.getStore()!.isMember('g1', 'pod-self')).toBe(false);
    });

    it('is idempotent', async () => {
      const handle = await plane.joinGroup('g1');
      await handle.leave();
      await handle.leave(); // should not throw
      expect(handle.isLeft).toBe(true);
    });

    it('after leave, joinGroup creates a fresh handle', async () => {
      const h1 = await plane.joinGroup('g1');
      await h1.leave();

      const h2 = await plane.joinGroup('g1');
      expect(h2).not.toBe(h1);
      expect(h2.isLeft).toBe(false);
      expect(h2.podIds).toContain('pod-self');
    });
  });

  // ── Integration with leaveAllGroups ────────────────────────────────────

  describe('integration with leaveAllGroups', () => {
    it('marks all handles as left when plane.leaveAllGroups is called', async () => {
      const h1 = await plane.joinGroup('g1');
      const h2 = await plane.joinGroup('g2');

      await plane.leaveAllGroups();

      expect(h1.isLeft).toBe(true);
      expect(h2.isLeft).toBe(true);
      expect(h1.podIds).toEqual([]);
      expect(h2.podIds).toEqual([]);
    });

    it('new handles can be created after leaveAllGroups', async () => {
      await plane.joinGroup('g1');
      await plane.leaveAllGroups();

      const h = await plane.joinGroup('g1');
      expect(h.isLeft).toBe(false);
      expect(h.podIds).toContain('pod-self');
    });
  });

  // ── Integration with dispose ──────────────────────────────────────────

  describe('integration with dispose', () => {
    it('marks all handles as left when plane.dispose is called', async () => {
      const h1 = await plane.joinGroup('g1');
      const h2 = await plane.joinGroup('g2');

      plane.dispose();

      expect(h1.isLeft).toBe(true);
      expect(h2.isLeft).toBe(true);
    });
  });
});
