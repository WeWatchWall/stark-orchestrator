/**
 * PodGroup Store
 *
 * In-memory, TTL-scoped store for ephemeral PodGroup memberships.
 * Backed by `node-cache` for automatic key expiration without blocking
 * the main event loop — optimized for single-process Node.js execution.
 *
 * **Design goals:**
 *   - Overlapping groups: a pod can belong to many groups simultaneously
 *   - Per-member TTL: each membership expires independently
 *   - Automatic reaping: stale members are swept on a configurable interval
 *   - Non-blocking: reap cycles use `setInterval`, never `setImmediate`
 *   - Deterministic separation: ephemeral data plane state is isolated
 *     from the control plane (PodStore / ClusterState)
 *
 * @module @stark-o/shared/network/pod-group-store
 */

import NodeCache from 'node-cache';
import type {
  PodGroupMembership,
  PodGroup,
  EphemeralAuditHook,
  EphemeralDataPlaneConfig,
} from '../types/ephemeral.js';
import {
  DEFAULT_MEMBERSHIP_TTL,
  DEFAULT_REAP_INTERVAL,
} from '../types/ephemeral.js';

// ── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Composite key for a single membership inside node-cache.
 * Format: `grp:<groupId>:pod:<podId>`
 */
function membershipKey(groupId: string, podId: string): string {
  return `grp:${groupId}:pod:${podId}`;
}

/**
 * Extract groupId and podId from a composite key.
 */
function parseMembershipKey(key: string): { groupId: string; podId: string } | null {
  const match = key.match(/^grp:(.+):pod:(.+)$/);
  if (!match) return null;
  return { groupId: match[1]!, podId: match[2]! };
}

// ── PodGroupStore ───────────────────────────────────────────────────────────

export class PodGroupStore {
  /**
   * node-cache instance for individual membership entries.
   * Each key is `grp:<groupId>:pod:<podId>` → PodGroupMembership.
   * TTL is set per-key to the membership's own TTL.
   */
  private cache: NodeCache;

  /**
   * Secondary index: groupId → Set of podIds currently in this group.
   * Kept in sync with the cache via add/remove/expire.
   */
  private groupIndex: Map<string, Set<string>> = new Map();

  /**
   * Reverse index: podId → Set of groupIds the pod belongs to.
   * Enables efficient `leaveAllGroups(podId)`.
   */
  private podIndex: Map<string, Set<string>> = new Map();

  /**
   * Group metadata (createdAt / updatedAt timestamps).
   */
  private groupMeta: Map<string, { createdAt: number; updatedAt: number }> = new Map();

  /**
   * Registered audit hooks.
   */
  private hooks: EphemeralAuditHook[] = [];

  /**
   * Reap interval handle (for cleanup on dispose).
   */
  private reapTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Configuration snapshot.
   */
  private config: Required<EphemeralDataPlaneConfig>;

  constructor(config: EphemeralDataPlaneConfig = {}) {
    this.config = {
      defaultMembershipTtl: config.defaultMembershipTtl ?? DEFAULT_MEMBERSHIP_TTL,
      reapIntervalMs: config.reapIntervalMs ?? DEFAULT_REAP_INTERVAL,
      defaultQueryTimeout: config.defaultQueryTimeout ?? 5_000,
      maxGroups: config.maxGroups ?? 0,
      maxMembersPerGroup: config.maxMembersPerGroup ?? 0,
      useNodeCache: config.useNodeCache ?? true,
    };

    // node-cache with checkperiod = 0 disables its internal interval;
    // we run our own reap cycle at the configured interval instead.
    this.cache = new NodeCache({
      stdTTL: Math.ceil(this.config.defaultMembershipTtl / 1000),
      checkperiod: 0,
      useClones: false,
    });

    // Listen for automatic key expiration from node-cache
    this.cache.on('expired', (key: string, _value: PodGroupMembership) => {
      const parsed = parseMembershipKey(key);
      if (parsed) {
        this.removeMemberFromIndices(parsed.groupId, parsed.podId);
        this.emit({
          type: 'PodMembershipExpired',
          timestamp: new Date().toISOString(),
          groupId: parsed.groupId,
          podId: parsed.podId,
          message: `Membership expired: pod '${parsed.podId}' in group '${parsed.groupId}'`,
        });
      }
    });

    // Start the reap cycle
    if (this.config.reapIntervalMs > 0) {
      this.reapTimer = setInterval(() => this.reapStaleMembers(), this.config.reapIntervalMs);
      // Unref so it doesn't keep the process alive
      if (this.reapTimer && typeof this.reapTimer === 'object' && 'unref' in this.reapTimer) {
        (this.reapTimer as NodeJS.Timeout).unref();
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Join a group by groupId.
   *
   * If the pod is already a member, the membership is refreshed
   * (timestamp + TTL reset). Groups are created lazily.
   *
   * @param groupId  Locally-computed group identifier
   * @param podId    The pod joining the group
   * @param ttl      Optional TTL override in ms (0 = infinite)
   * @param metadata Optional metadata attached to this membership
   * @returns        The created or refreshed membership
   */
  joinGroup(
    groupId: string,
    podId: string,
    ttl?: number,
    metadata?: Record<string, unknown>,
  ): PodGroupMembership {
    const now = Date.now();
    const effectiveTtl = ttl ?? this.config.defaultMembershipTtl;
    const key = membershipKey(groupId, podId);
    const isNewGroup = !this.groupIndex.has(groupId);

    // Enforce limits
    if (isNewGroup && this.config.maxGroups > 0 && this.groupIndex.size >= this.config.maxGroups) {
      throw new Error(
        `PodGroupStore: maximum group limit reached (${this.config.maxGroups}). ` +
        `Cannot create group '${groupId}'.`,
      );
    }
    const groupSet = this.groupIndex.get(groupId);
    if (
      groupSet &&
      !groupSet.has(podId) &&
      this.config.maxMembersPerGroup > 0 &&
      groupSet.size >= this.config.maxMembersPerGroup
    ) {
      throw new Error(
        `PodGroupStore: group '${groupId}' has reached its member limit ` +
        `(${this.config.maxMembersPerGroup}).`,
      );
    }

    const existing = this.cache.get<PodGroupMembership>(key);
    const isRefresh = !!existing;

    const membership: PodGroupMembership = {
      podId,
      joinedAt: existing?.joinedAt ?? now,
      lastRefreshedAt: now,
      ttl: effectiveTtl,
      metadata: metadata ?? existing?.metadata,
    };

    // Store in node-cache (TTL in seconds, 0 = infinite)
    const ttlSeconds = effectiveTtl > 0 ? Math.ceil(effectiveTtl / 1000) : 0;
    this.cache.set(key, membership, ttlSeconds);

    // Update indices
    this.addMemberToIndices(groupId, podId);

    // Update group metadata
    if (isNewGroup) {
      this.groupMeta.set(groupId, { createdAt: now, updatedAt: now });
      this.emit({
        type: 'PodGroupCreated',
        timestamp: new Date(now).toISOString(),
        groupId,
        message: `Group '${groupId}' created`,
      });
    } else {
      const meta = this.groupMeta.get(groupId);
      if (meta) meta.updatedAt = now;
    }

    // Emit join/refresh event
    if (isRefresh) {
      this.emit({
        type: 'PodMembershipRefreshed',
        timestamp: new Date(now).toISOString(),
        groupId,
        podId,
        message: `Membership refreshed: pod '${podId}' in group '${groupId}'`,
        metadata,
      });
    } else {
      this.emit({
        type: 'PodJoinedGroup',
        timestamp: new Date(now).toISOString(),
        groupId,
        podId,
        message: `Pod '${podId}' joined group '${groupId}'`,
        metadata,
      });
    }

    return membership;
  }

  /**
   * Leave a specific group.
   *
   * @returns true if the pod was a member and was removed.
   */
  leaveGroup(groupId: string, podId: string): boolean {
    const key = membershipKey(groupId, podId);
    const existed = this.cache.del(key) > 0;
    if (existed) {
      this.removeMemberFromIndices(groupId, podId);
      this.emit({
        type: 'PodLeftGroup',
        timestamp: new Date().toISOString(),
        groupId,
        podId,
        message: `Pod '${podId}' left group '${groupId}'`,
      });
    }
    return existed;
  }

  /**
   * Remove a pod from all groups it belongs to.
   * Useful when a pod is terminated or evicted.
   *
   * @returns The list of groupIds the pod was removed from.
   */
  leaveAllGroups(podId: string): string[] {
    const groups = this.podIndex.get(podId);
    if (!groups || groups.size === 0) return [];

    const removedFrom: string[] = [];
    for (const groupId of [...groups]) {
      const key = membershipKey(groupId, podId);
      this.cache.del(key);
      this.removeMemberFromIndices(groupId, podId);
      removedFrom.push(groupId);

      this.emit({
        type: 'PodLeftGroup',
        timestamp: new Date().toISOString(),
        groupId,
        podId,
        message: `Pod '${podId}' left group '${groupId}' (leaveAllGroups)`,
      });
    }

    return removedFrom;
  }

  /**
   * Get all pods currently in a group.
   *
   * @returns Array of active memberships, or empty if the group doesn't exist.
   */
  getGroupPods(groupId: string): PodGroupMembership[] {
    const podIds = this.groupIndex.get(groupId);
    if (!podIds || podIds.size === 0) return [];

    const members: PodGroupMembership[] = [];
    const stale: string[] = [];
    for (const podId of podIds) {
      const membership = this.cache.get<PodGroupMembership>(membershipKey(groupId, podId));
      if (membership) {
        members.push(membership);
      } else {
        // Cache entry expired or was deleted but the index was not yet
        // cleaned (checkperiod=0 means node-cache won't fire 'expired'
        // until the key is accessed). Collect for deferred cleanup so we
        // don't mutate the Set while iterating.
        stale.push(podId);
      }
    }

    // Deferred cleanup of stale index entries
    for (const podId of stale) {
      this.removeMemberFromIndices(groupId, podId);
    }

    return members;
  }

  /**
   * Get the PodGroup metadata (including the member list).
   *
   * @returns The full PodGroup or undefined if it doesn't exist.
   */
  getGroup(groupId: string): PodGroup | undefined {
    const meta = this.groupMeta.get(groupId);
    if (!meta) return undefined;

    return {
      groupId,
      members: this.getGroupPods(groupId),
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
  }

  /**
   * Get all group IDs that a pod belongs to.
   */
  getGroupsForPod(podId: string): string[] {
    const groups = this.podIndex.get(podId);
    return groups ? [...groups] : [];
  }

  /**
   * Check if a pod is a member of a specific group.
   */
  isMember(groupId: string, podId: string): boolean {
    return this.cache.has(membershipKey(groupId, podId));
  }

  /**
   * List all active group IDs.
   */
  listGroups(): string[] {
    return [...this.groupIndex.keys()];
  }

  /**
   * Get the number of active groups.
   */
  get groupCount(): number {
    return this.groupIndex.size;
  }

  /**
   * Get the total number of membership entries across all groups.
   */
  get membershipCount(): number {
    return this.cache.keys().length;
  }

  /**
   * Get a snapshot of the full store for debugging/API.
   */
  snapshot(): Record<string, PodGroup> {
    const result: Record<string, PodGroup> = {};
    for (const groupId of this.groupIndex.keys()) {
      const group = this.getGroup(groupId);
      if (group) result[groupId] = group;
    }
    return result;
  }

  // ── Reap / Expiration ──────────────────────────────────────────────────

  /**
   * Manually trigger a stale-membership reap cycle.
   * Normally called automatically on the configured interval.
   *
   * This checks manual TTL expiration for entries that node-cache's
   * internal checkperiod may not have swept yet.
   *
   * @returns Number of memberships reaped.
   */
  reapStaleMembers(): number {
    const now = Date.now();
    let reaped = 0;

    for (const key of this.cache.keys()) {
      const membership = this.cache.get<PodGroupMembership>(key);
      if (!membership) continue;

      // Check manual TTL
      if (membership.ttl > 0 && now - membership.lastRefreshedAt > membership.ttl) {
        this.cache.del(key);
        const parsed = parseMembershipKey(key);
        if (parsed) {
          this.removeMemberFromIndices(parsed.groupId, parsed.podId);
          this.emit({
            type: 'PodMembershipExpired',
            timestamp: new Date(now).toISOString(),
            groupId: parsed.groupId,
            podId: parsed.podId,
            message: `Membership reaped: pod '${parsed.podId}' in group '${parsed.groupId}'`,
          });
        }
        reaped++;
      }
    }

    return reaped;
  }

  // ── Audit Hooks ────────────────────────────────────────────────────────

  /**
   * Register an audit hook for ephemeral events.
   * Hooks are invoked synchronously but must not throw.
   *
   * @returns A dispose function to unregister the hook.
   */
  onEvent(hook: EphemeralAuditHook): () => void {
    this.hooks.push(hook);
    return () => {
      const idx = this.hooks.indexOf(hook);
      if (idx !== -1) this.hooks.splice(idx, 1);
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Clear all groups, memberships, and indices.
   */
  clear(): void {
    this.cache.flushAll();
    this.groupIndex.clear();
    this.podIndex.clear();
    this.groupMeta.clear();
  }

  /**
   * Dispose the store, clearing the reap interval and flushing all data.
   * Call this when the orchestrator shuts down.
   */
  dispose(): void {
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    this.cache.close();
    this.groupIndex.clear();
    this.podIndex.clear();
    this.groupMeta.clear();
    this.hooks.length = 0;
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private addMemberToIndices(groupId: string, podId: string): void {
    // Group index
    let groupSet = this.groupIndex.get(groupId);
    if (!groupSet) {
      groupSet = new Set();
      this.groupIndex.set(groupId, groupSet);
    }
    groupSet.add(podId);

    // Pod index
    let podSet = this.podIndex.get(podId);
    if (!podSet) {
      podSet = new Set();
      this.podIndex.set(podId, podSet);
    }
    podSet.add(groupId);
  }

  private removeMemberFromIndices(groupId: string, podId: string): void {
    // Group index
    const groupSet = this.groupIndex.get(groupId);
    if (groupSet) {
      groupSet.delete(podId);
      if (groupSet.size === 0) {
        this.groupIndex.delete(groupId);
        this.groupMeta.delete(groupId);
        this.emit({
          type: 'PodGroupDissolved',
          timestamp: new Date().toISOString(),
          groupId,
          message: `Group '${groupId}' dissolved (no remaining members)`,
        });
      }
    }

    // Pod index
    const podSet = this.podIndex.get(podId);
    if (podSet) {
      podSet.delete(groupId);
      if (podSet.size === 0) {
        this.podIndex.delete(podId);
      }
    }
  }

  private emit(event: import('../types/ephemeral.js').EphemeralEvent): void {
    for (const hook of this.hooks) {
      try {
        hook(event);
      } catch {
        // Audit hooks must not throw — swallow silently
      }
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _globalPodGroupStore: PodGroupStore | null = null;

/**
 * Get (or create) the global singleton PodGroupStore.
 * For orchestrator-side use in the ephemeral data plane.
 */
export function getPodGroupStore(config?: EphemeralDataPlaneConfig): PodGroupStore {
  if (!_globalPodGroupStore) {
    _globalPodGroupStore = new PodGroupStore(config);
  }
  return _globalPodGroupStore;
}

/**
 * Reset the global PodGroupStore (for testing).
 */
export function resetPodGroupStore(): void {
  if (_globalPodGroupStore) {
    _globalPodGroupStore.dispose();
    _globalPodGroupStore = null;
  }
}
