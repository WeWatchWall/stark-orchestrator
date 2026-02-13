/**
 * PodGroupHandle
 *
 * A high-level handle returned by `EphemeralDataPlane.joinGroup()`.
 * Encapsulates group membership, member discovery, fan-out queries,
 * and lifecycle (leave / refresh) into a single ergonomic object.
 *
 * @module @stark-o/shared/network/pod-group-handle
 */

import type {
  PodGroupMembership,
  EphemeralQueryResult,
} from '../types/ephemeral.js';

// ── Minimal back-reference to the owning plane ─────────────────────────────
// We use an interface rather than importing the class to avoid circular deps.

/**
 * Subset of EphemeralDataPlane that PodGroupHandle needs.
 * Avoids a circular import between the handle and the plane.
 */
export interface PodGroupPlaneRef {
  /** The pod ID that owns this plane instance. */
  readonly podId: string;

  joinGroup(
    groupId: string,
    options?: { ttl?: number; metadata?: Record<string, unknown> },
  ): PodGroupMembership | Promise<PodGroupMembership>;

  joinGroupRaw(
    groupId: string,
    options?: { ttl?: number; metadata?: Record<string, unknown> },
  ): PodGroupMembership | Promise<PodGroupMembership>;

  leaveGroup(groupId: string): boolean | Promise<boolean>;

  getGroupPods(groupId: string): PodGroupMembership[] | Promise<PodGroupMembership[]>;

  queryPods(
    podIds: string[],
    path: string,
    query?: Record<string, string>,
    timeout?: number,
  ): Promise<EphemeralQueryResult>;
}

// ── Options for creating a handle ───────────────────────────────────────────

export interface PodGroupHandleOptions {
  /** The group this handle belongs to */
  groupId: string;
  /** TTL used when joining / refreshing the group */
  ttl?: number;
  /** Metadata attached to this pod's membership */
  metadata?: Record<string, unknown>;
  /** Initial membership snapshot returned by the join call */
  membership: PodGroupMembership;
  /** Initial member list (fetched right after join) */
  members: PodGroupMembership[];
  /** Back-reference to the owning plane */
  plane: PodGroupPlaneRef;
}

// ── PodGroupHandle ──────────────────────────────────────────────────────────

export class PodGroupHandle {
  /** Group identifier */
  readonly groupId: string;

  /** This pod's membership record (refreshed on `.refresh()`) */
  membership: PodGroupMembership;

  /** Cached pod IDs of all group members (refreshed on `.refresh()`) */
  podIds: string[];

  /** Full membership records of all group members */
  members: PodGroupMembership[];

  // ── Private ─────────────────────────────────────────────────────────────

  private _plane: PodGroupPlaneRef;
  private _ttl: number | undefined;
  private _metadata: Record<string, unknown> | undefined;
  private _left = false;

  constructor(options: PodGroupHandleOptions) {
    this.groupId = options.groupId;
    this.membership = options.membership;
    this.members = options.members;
    this.podIds = options.members.map(m => m.podId);
    this._plane = options.plane;
    this._ttl = options.ttl;
    this._metadata = options.metadata;
  }

  // ── Derived helpers ─────────────────────────────────────────────────────

  /** Pod IDs of every member *except* the current pod. */
  get otherPodIds(): string[] {
    return this.podIds.filter(id => id !== this._plane.podId);
  }

  /** Whether `.leave()` has been called on this handle. */
  get isLeft(): boolean {
    return this._left;
  }

  // ── Query ───────────────────────────────────────────────────────────────

  /**
   * Fan-out a query to every *other* pod in the group.
   *
   * Returns an array of promises — one per target pod — so callers can
   * `await Promise.all(group.queryPods(...))` or process individually.
   *
   * Each promise resolves with an `EphemeralQueryResult` scoped to that
   * single target pod.
   */
  queryPods(
    path: string,
    query?: Record<string, string>,
    timeout?: number,
    includeSelf = false
  ): Promise<EphemeralQueryResult>[] {
    if (this._left) {
      return [];
    }

    const others = includeSelf ? this.podIds : this.otherPodIds;
    return others.map(podId =>
      this._plane.queryPods([podId], path, query, timeout),
    );
  }

  // ── Refresh ─────────────────────────────────────────────────────────────

  /**
   * Re-join the group (refreshing TTL) and update the cached member list.
   */
  async refresh(): Promise<void> {
    if (this._left) return;

    this.membership = await this._plane.joinGroupRaw(this.groupId, {
      ttl: this._ttl,
      metadata: this._metadata,
    });

    this.members = await this._plane.getGroupPods(this.groupId);
    this.podIds = this.members.map(m => m.podId);
  }

  // ── Leave ───────────────────────────────────────────────────────────────

  /**
   * Leave this PodGroup and mark the handle as dead.
   */
  async leave(): Promise<void> {
    if (this._left) return;
    this._left = true;
    await this._plane.leaveGroup(this.groupId);
    this.members = [];
    this.podIds = [];
  }
}
