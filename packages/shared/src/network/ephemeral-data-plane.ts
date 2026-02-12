/**
 * Ephemeral Data Plane
 *
 * High-level, developer-friendly API for transient pod communication.
 * Sits atop the PodGroupStore and integrates with the existing
 * orchestrator routing and policy architecture.
 *
 * **API surface:**
 *   - `joinGroup(groupId)`         — join a locally-computed group
 *   - `getGroupPods(groupId)`      — list current members of a group
 *   - `queryPods(podIds, path, q)` — fan-out ephemeral query to pods
 *   - `podResponses[podId]`        — access aggregated responses
 *
 * All state is in-memory and fully TTL-scoped. No persistent storage
 * or external dependencies beyond `node-cache`.
 *
 * **Extensibility hooks:**
 *   - Contact tracing: who talked to whom
 *   - Presence updates: heartbeat-style membership refresh
 *   - Signal exchange: WebRTC offer/answer relay via ephemeral queries
 *
 * @module @stark-o/shared/network/ephemeral-data-plane
 */

import type {
  PodGroupMembership,
  PodGroup,
  EphemeralQuery,
  EphemeralResponse,
  EphemeralQueryResult,
  EphemeralAuditHook,
  EphemeralDataPlaneConfig,
} from '../types/ephemeral.js';
import {
  DEFAULT_EPHEMERAL_QUERY_TIMEOUT,
} from '../types/ephemeral.js';
import { PodGroupStore } from './pod-group-store.js';
import type { NetworkPolicyEngine } from './network-policy.js';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Handler registered by a pod to respond to ephemeral queries.
 * Mirrors the lightweight `RequestHandler` pattern from orchestrator-router.
 */
export type EphemeralQueryHandler = (
  path: string,
  query?: Record<string, string>,
) => Promise<{ status: number; body?: unknown }> | { status: number; body?: unknown };

/**
 * Transport abstraction for delivering ephemeral queries to pods.
 * Implementations differ per runtime (WebRTC data channel, postMessage, direct call).
 */
export type EphemeralTransport = (
  targetPodId: string,
  query: EphemeralQuery,
) => Promise<EphemeralResponse>;

/**
 * Transport abstraction for group operations via WS to the orchestrator.
 * When provided, group join/leave/getGroupPods are proxied through the
 * orchestrator's central PodGroupStore instead of using a local store.
 */
export interface GroupTransport {
  join(groupId: string, podId: string, ttl?: number, metadata?: Record<string, unknown>): Promise<PodGroupMembership>;
  leave(groupId: string, podId: string): Promise<boolean>;
  leaveAll(podId: string): Promise<string[]>;
  getGroupPods(groupId: string): Promise<PodGroupMembership[]>;
  getGroupsForPod(podId: string): Promise<string[]>;
}

/**
 * Configuration for the EphemeralDataPlane.
 */
export interface EphemeralDataPlaneOptions {
  /** This pod's ID (used as the caller identity) */
  podId: string;
  /** This pod's service ID (for policy checks) */
  serviceId?: string;
  /** Network policy engine (optional — omit to skip policy checks) */
  policyEngine?: NetworkPolicyEngine;
  /** Transport function for sending queries to remote pods */
  transport?: EphemeralTransport;
  /**
   * Transport for group operations via WS to the orchestrator.
   * When provided, group state is managed centrally on the server
   * instead of in a local PodGroupStore.
   */
  groupTransport?: GroupTransport;
  /** Backing PodGroupStore (a default one is created if omitted; ignored when groupTransport is set) */
  groupStore?: PodGroupStore;
  /** Data plane configuration */
  config?: EphemeralDataPlaneConfig;
}

// ── EphemeralDataPlane ──────────────────────────────────────────────────────

export class EphemeralDataPlane {
  private podId: string;
  // private serviceId: string;
  // private policy: NetworkPolicyEngine | null;
  private transport: EphemeralTransport | null;
  private groupTransport: GroupTransport | null;
  private store: PodGroupStore | null;
  private config: EphemeralDataPlaneConfig;

  /**
   * Ephemeral query handlers registered by this pod.
   * Path → handler, matching orchestrator-router's PodRequestRouter pattern.
   */
  private handlers: Map<string, EphemeralQueryHandler> = new Map();

  /**
   * In-memory store of the latest query results, keyed by queryId.
   * `podResponses[podId]` is accessible via `getResponses(queryId)`.
   */
  private queryResults: Map<string, EphemeralQueryResult> = new Map();

  /** Monotonic query counter for ID generation */
  private queryCounter = 0;

  constructor(options: EphemeralDataPlaneOptions) {
    this.podId = options.podId;
    // this.serviceId = options.serviceId ?? options.podId;
    // this.policy = options.policyEngine ?? null;
    this.transport = options.transport ?? null;
    this.groupTransport = options.groupTransport ?? null;
    this.config = options.config ?? {};
    // Only create a local store when there is no group transport
    this.store = this.groupTransport ? null : (options.groupStore ?? new PodGroupStore(this.config));
  }

  /** Whether group ops are proxied through the orchestrator. */
  get isRemoteGroupMode(): boolean {
    return this.groupTransport !== null;
  }

  // ── Group API ───────────────────────────────────────────────────────────

  /**
   * Join a group by a locally-computed groupId.
   *
   * When a `groupTransport` is configured the operation is proxied to the
   * orchestrator's central PodGroupStore via WS and returns a Promise.
   * Without a transport, the local store is used synchronously (legacy mode).
   *
   * @param groupId  Group identifier (locally computed by the pod)
   * @param options  Optional TTL and metadata overrides
   * @returns        The created or refreshed PodGroupMembership (or a Promise thereof)
   */
  joinGroup(
    groupId: string,
    options?: { ttl?: number; metadata?: Record<string, unknown> },
  ): PodGroupMembership | Promise<PodGroupMembership> {
    if (this.groupTransport) {
      return this.groupTransport.join(groupId, this.podId, options?.ttl, options?.metadata);
    }
    return this.store!.joinGroup(groupId, this.podId, options?.ttl, options?.metadata);
  }

  /**
   * Leave a specific group.
   */
  leaveGroup(groupId: string): boolean | Promise<boolean> {
    if (this.groupTransport) {
      return this.groupTransport.leave(groupId, this.podId);
    }
    return this.store!.leaveGroup(groupId, this.podId);
  }

  /**
   * Leave all groups this pod belongs to.
   * Call during graceful shutdown.
   */
  leaveAllGroups(): string[] | Promise<string[]> {
    if (this.groupTransport) {
      return this.groupTransport.leaveAll(this.podId);
    }
    return this.store!.leaveAllGroups(this.podId);
  }

  /**
   * Get all pods currently in a PodGroup.
   *
   * When a `groupTransport` is configured this returns a Promise that
   * resolves with the authoritative member list from the orchestrator.
   */
  getGroupPods(groupId: string): PodGroupMembership[] | Promise<PodGroupMembership[]> {
    if (this.groupTransport) {
      return this.groupTransport.getGroupPods(groupId);
    }
    return this.store!.getGroupPods(groupId);
  }

  /**
   * Get the full PodGroup (metadata + members).
   * Note: only available in local mode (returns undefined in remote mode).
   */
  getGroup(groupId: string): PodGroup | undefined {
    if (this.groupTransport) return undefined;
    return this.store!.getGroup(groupId);
  }

  /**
   * List all groups this pod currently belongs to.
   */
  myGroups(): string[] | Promise<string[]> {
    if (this.groupTransport) {
      return this.groupTransport.getGroupsForPod(this.podId);
    }
    return this.store!.getGroupsForPod(this.podId);
  }

  // ── Query API ───────────────────────────────────────────────────────────

  /**
   * Fan-out an ephemeral query to a list of pods.
   *
   * @example
   * ```ts
   * const result = await plane.queryPods(
   *   ['pod-abc', 'pod-def'],
   *   '/state/presence',
   *   { room: 'lobby' },
   * );
   * const abcResponse = result.responses.get('pod-abc');
   * ```
   *
   * @param podIds  Target pod IDs
   * @param path    Virtual path to query
   * @param query   Optional query parameters
   * @param timeout Optional timeout override in ms
   * @returns       Aggregated EphemeralQueryResult
   */
  async queryPods(
    podIds: string[],
    path: string,
    query?: Record<string, string>,
    timeout?: number,
  ): Promise<EphemeralQueryResult> {
    const effectiveTimeout = timeout ?? this.config.defaultQueryTimeout ?? DEFAULT_EPHEMERAL_QUERY_TIMEOUT;
    const queryId = this.nextQueryId();
    const now = Date.now();

    const ephemeralQuery: EphemeralQuery = {
      queryId,
      targetPodIds: podIds,
      path,
      query,
      issuedAt: now,
      timeout: effectiveTimeout,
    };

    // Emit audit event
    this.store?.onEvent(() => {})(); // noop — we emit directly via the store's hooks
    // We can't directly emit through the store for queries since it's a different concern.
    // Instead, store hooks are for group events; query events use the result store.

    const responses = new Map<string, EphemeralResponse>();
    const timedOut: string[] = [];

    if (this.transport) {
      // Fan-out queries in parallel with a per-query timeout
      const promises = podIds.map(async (targetPodId) => {
        try {
          const response = await Promise.race([
            this.transport!(targetPodId, ephemeralQuery),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), effectiveTimeout),
            ),
          ]);
          responses.set(targetPodId, response);
        } catch {
          timedOut.push(targetPodId);
        }
      });

      await Promise.all(promises);
    } else {
      // No transport — attempt local handler dispatch for local queries
      for (const targetPodId of podIds) {
        if (targetPodId === this.podId) {
          const response = await this.dispatchLocal(ephemeralQuery);
          if (response) {
            responses.set(targetPodId, response);
          } else {
            timedOut.push(targetPodId);
          }
        } else {
          // No transport available for remote pods
          timedOut.push(targetPodId);
        }
      }
    }

    const result: EphemeralQueryResult = {
      query: ephemeralQuery,
      responses,
      timedOut,
      complete: timedOut.length === 0,
      completedAt: Date.now(),
    };

    // Store for later retrieval via getResponses
    this.queryResults.set(queryId, result);

    return result;
  }

  /**
   * Get the stored result of a previous query by queryId.
   */
  getQueryResult(queryId: string): EphemeralQueryResult | undefined {
    return this.queryResults.get(queryId);
  }

  /**
   * Get the ephemeral response map for a specific query result.
   * Returns a `podResponses[podId]` view.
   */
  getResponses(queryId: string): Map<string, EphemeralResponse> | undefined {
    return this.queryResults.get(queryId)?.responses;
  }

  /**
   * Clear stored query results older than the given age in ms.
   * Call periodically to prevent unbounded memory growth.
   *
   * @param maxAgeMs  Maximum age for query results (default: 60_000)
   * @returns         Number of results evicted
   */
  evictStaleResults(maxAgeMs: number = 60_000): number {
    const now = Date.now();
    let evicted = 0;
    for (const [queryId, result] of this.queryResults) {
      if (now - result.completedAt > maxAgeMs) {
        this.queryResults.delete(queryId);
        evicted++;
      }
    }
    return evicted;
  }

  // ── Handler Registration ────────────────────────────────────────────────

  /**
   * Register a handler for incoming ephemeral queries on this pod.
   * Mirrors `PodRequestRouter.handle()` from orchestrator-router.
   *
   * @param pathPrefix  Path prefix to match (e.g. '/state', '/health')
   * @param handler     Handler function
   */
  handle(pathPrefix: string, handler: EphemeralQueryHandler): void {
    this.handlers.set(pathPrefix, handler);
  }

  /**
   * Dispatch an incoming ephemeral query to a registered handler.
   * Called by the transport layer when this pod receives a query.
   *
   * @returns The EphemeralResponse, or null if no handler matched.
   */
  async handleIncomingQuery(query: EphemeralQuery): Promise<EphemeralResponse | null> {
    return this.dispatchLocal(query);
  }

  // ── Audit Hooks ─────────────────────────────────────────────────────────

  /**
   * Register an audit hook on the backing PodGroupStore.
   * Only available in local mode (no-op in remote mode).
   * @returns A dispose function to unregister the hook.
   */
  onEvent(hook: EphemeralAuditHook): () => void {
    if (this.store) return this.store.onEvent(hook);
    return () => {}; // no-op in remote mode
  }

  // ── Store Access ────────────────────────────────────────────────────────

  /**
   * Get the backing PodGroupStore (for advanced use or testing).
   * Returns null when operating in remote group mode.
   */
  getStore(): PodGroupStore | null {
    return this.store;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Graceful shutdown: leave all groups, clear results, dispose the store.
   */
  dispose(): void {
    if (this.store) {
      this.store.leaveAllGroups(this.podId);
    } else if (this.groupTransport) {
      // Fire-and-forget — the server will also clean up on WS disconnect
      this.groupTransport.leaveAll(this.podId).catch(() => {});
    }
    this.queryResults.clear();
    this.handlers.clear();
    if (this.store) {
      this.store.dispose();
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────

  /**
   * Dispatch a query to a local handler (longest-prefix match).
   */
  private async dispatchLocal(query: EphemeralQuery): Promise<EphemeralResponse | null> {
    let bestMatch: { prefix: string; handler: EphemeralQueryHandler } | null = null;

    for (const [prefix, handler] of this.handlers) {
      if (query.path.startsWith(prefix)) {
        if (!bestMatch || prefix.length > bestMatch.prefix.length) {
          bestMatch = { prefix, handler };
        }
      }
    }

    if (!bestMatch) return null;

    try {
      const result = await bestMatch.handler(query.path, query.query);
      return {
        queryId: query.queryId,
        podId: this.podId,
        status: result.status,
        body: result.body,
        respondedAt: Date.now(),
      };
    } catch {
      return {
        queryId: query.queryId,
        podId: this.podId,
        status: 500,
        body: { error: 'Handler error' },
        respondedAt: Date.now(),
      };
    }
  }

  private nextQueryId(): string {
    return `${this.podId}-eq-${++this.queryCounter}-${Date.now()}`;
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an EphemeralDataPlane instance for a pod.
 *
 * @example
 * ```ts
 * const plane = createEphemeralDataPlane({
 *   podId: 'pod-abc-123',
 *   serviceId: 'my-service',
 * });
 *
 * plane.joinGroup('room:lobby');
 * const members = plane.getGroupPods('room:lobby');
 * const result = await plane.queryPods(['pod-def'], '/state/presence');
 * ```
 */
export function createEphemeralDataPlane(options: EphemeralDataPlaneOptions): EphemeralDataPlane {
  return new EphemeralDataPlane(options);
}
