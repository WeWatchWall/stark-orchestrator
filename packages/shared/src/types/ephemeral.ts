/**
 * Ephemeral Data Plane Types
 *
 * Types for transient pod-to-pod state: PodGroups, ephemeral queries,
 * and ephemeral responses. Designed for high-throughput in-memory
 * communication patterns (presence, signal exchange, contact tracing)
 * that live outside the persistent control plane.
 *
 * **Separation of concerns:**
 *   - Control plane (ServiceRegistry, PodStore): authoritative, persistent state
 *   - Ephemeral data plane (PodGroupStore): transient, TTL-scoped state
 *
 * @module @stark-o/shared/types/ephemeral
 */

// ── PodGroup Membership ─────────────────────────────────────────────────────

/**
 * A single pod's membership within a PodGroup.
 * Each membership carries its own TTL — stale members are reaped automatically.
 */
export interface PodGroupMembership {
  /** The pod that joined this group */
  podId: string;
  /** Epoch ms when this membership was created */
  joinedAt: number;
  /** Epoch ms when this membership was last refreshed */
  lastRefreshedAt: number;
  /** TTL in ms for this membership (0 = infinite, manual removal only) */
  ttl: number;
  /** Optional caller-supplied metadata (e.g. presence payload, capability tags) */
  metadata?: Record<string, unknown>;
}

/**
 * A PodGroup is an ephemeral, overlapping collection of pods grouped
 * by a locally-computed `groupId`. Groups are created lazily on first
 * join and garbage-collected when all members expire.
 */
export interface PodGroup {
  /** Group identifier (locally computed by the joining pod) */
  groupId: string;
  /** Active memberships in this group */
  members: PodGroupMembership[];
  /** Epoch ms when this group was first created */
  createdAt: number;
  /** Epoch ms of the most recent membership change */
  updatedAt: number;
}

// ── Ephemeral Query / Response ──────────────────────────────────────────────

/**
 * A query sent to one or more pods for ephemeral (non-persistent) data.
 * Unlike ServiceRequest (which is a full HTTP-like RPC), an ephemeral query
 * is a lightweight read-only probe for transient state.
 */
export interface EphemeralQuery {
  /** Unique query ID for correlation */
  queryId: string;
  /** The pod IDs to query */
  targetPodIds: string[];
  /** Virtual path to query (e.g. '/health', '/state/presence') */
  path: string;
  /** Optional query parameters */
  query?: Record<string, string>;
  /** Epoch ms when this query was issued */
  issuedAt: number;
  /** Timeout in ms (0 = use default) */
  timeout?: number;
}

/**
 * A single pod's ephemeral response to a query.
 */
export interface EphemeralResponse {
  /** Correlation query ID */
  queryId: string;
  /** The responding pod */
  podId: string;
  /** HTTP-like status code */
  status: number;
  /** Response payload (ephemeral, never persisted) */
  body?: unknown;
  /** Epoch ms when this response was recorded */
  respondedAt: number;
}

/**
 * Aggregated responses from querying a list of pods.
 * Keyed by podId for O(1) lookup per pod.
 */
export interface EphemeralQueryResult {
  /** The original query */
  query: EphemeralQuery;
  /** Responses keyed by podId */
  responses: Map<string, EphemeralResponse>;
  /** Pod IDs that did not respond before timeout */
  timedOut: string[];
  /** Whether all targeted pods responded */
  complete: boolean;
  /** Epoch ms when the result was finalized */
  completedAt: number;
}

// ── Ephemeral Events (for audit hooks) ──────────────────────────────────────

/**
 * Ephemeral event types emitted by the data plane.
 * These are separate from the control plane's StarkEventType.
 */
export type EphemeralEventType =
  | 'PodJoinedGroup'
  | 'PodLeftGroup'
  | 'PodGroupCreated'
  | 'PodGroupDissolved'
  | 'PodMembershipExpired'
  | 'PodMembershipRefreshed'
  | 'EphemeralQueryIssued'
  | 'EphemeralResponseReceived';

/**
 * An ephemeral event payload for audit/logging hooks.
 */
export interface EphemeralEvent {
  /** Event type */
  type: EphemeralEventType;
  /** ISO timestamp */
  timestamp: string;
  /** Primary group ID (if applicable) */
  groupId?: string;
  /** Primary pod ID (if applicable) */
  podId?: string;
  /** Query ID (if applicable) */
  queryId?: string;
  /** Human-readable detail message */
  message?: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Callback signature for ephemeral audit hooks.
 * Hooks are fire-and-forget — they must not throw or block.
 */
export type EphemeralAuditHook = (event: EphemeralEvent) => void;

// ── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration for the ephemeral data plane.
 */
export interface EphemeralDataPlaneConfig {
  /** Default TTL for PodGroup memberships in ms (default: 60_000 — 1 minute) */
  defaultMembershipTtl?: number;
  /** Interval in ms between stale-membership reap cycles (default: 10_000) */
  reapIntervalMs?: number;
  /** Default timeout for ephemeral queries in ms (default: 5_000) */
  defaultQueryTimeout?: number;
  /** Maximum number of concurrent groups (0 = unlimited) */
  maxGroups?: number;
  /** Maximum members per group (0 = unlimited) */
  maxMembersPerGroup?: number;
  /** Whether to use node-cache for the backing store (default: true) */
  useNodeCache?: boolean;
}

// ── Default Constants ───────────────────────────────────────────────────────

/** Default membership TTL: 60 seconds */
export const DEFAULT_MEMBERSHIP_TTL = 60_000;

/** Default reap interval: 10 seconds */
export const DEFAULT_REAP_INTERVAL = 10_000;

/** Default ephemeral query timeout: 5 seconds */
export const DEFAULT_EPHEMERAL_QUERY_TIMEOUT = 5_000;

// ── PodGroup WS Message Payloads ────────────────────────────────────────────

/** Payload for `podgroup:join` — pod requests to join a group via orchestrator */
export interface PodGroupJoinRequest {
  groupId: string;
  podId: string;
  serviceId?: string;
  ttl?: number;
  metadata?: Record<string, unknown>;
}

/** Payload for `podgroup:join:ack` — orchestrator confirms join + returns members */
export interface PodGroupJoinAck {
  groupId: string;
  members: PodGroupMembership[];
}

/** Payload for `podgroup:leave` — pod requests to leave a group */
export interface PodGroupLeaveRequest {
  groupId: string;
  podId: string;
}

/** Payload for `podgroup:members` — pod queries current group membership */
export interface PodGroupMembersRequest {
  groupId: string;
}

/** Payload for `podgroup:members:response` — orchestrator returns membership list */
export interface PodGroupMembersResponse {
  groupId: string;
  members: PodGroupMembership[];
}
