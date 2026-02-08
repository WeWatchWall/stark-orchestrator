/**
 * Network Types for Inter-Service Communication
 *
 * Defines types for pod-to-pod WebRTC communication, service routing,
 * network policies, and the orchestrator service registry.
 *
 * @module @stark-o/shared/types/network
 */

// ── Service Registry ────────────────────────────────────────────────────────

/**
 * Status of a pod within the service registry.
 */
export type RegistryPodStatus = 'healthy' | 'unhealthy' | 'unknown';

/**
 * An entry in the orchestrator's service registry.
 * Maps a service to its backing pods.
 */
export interface ServiceRegistryEntry {
  podId: string;
  nodeId: string;
  status: RegistryPodStatus;
  lastHeartbeat: number; // epoch ms
}

/**
 * The full service registry: serviceId → list of pods.
 */
export type ServiceRegistry = Map<string, ServiceRegistryEntry[]>;

// ── Pod-Level Cache ─────────────────────────────────────────────────────────

/**
 * A cached target pod for a specific service, stored on the caller pod.
 * Sticky by default: the same target pod is reused until TTL or failure.
 */
export interface CachedTargetPod {
  serviceId: string;
  podId: string;
  nodeId: string;
  cachedAt: number;  // epoch ms
  ttl: number;       // ms — 0 means infinite (manual invalidation only)
  healthy: boolean;
}

// ── Network Policies ────────────────────────────────────────────────────────

/**
 * A network policy rule controlling inter-service communication.
 */
export type NetworkPolicyAction = 'allow' | 'deny';

export interface NetworkPolicy {
  id: string;
  sourceService: string;
  targetService: string;
  action: NetworkPolicyAction;
  createdAt: number; // epoch ms
}

/**
 * Input for creating a network policy via API or CLI.
 */
export interface CreateNetworkPolicyInput {
  sourceService: string;
  targetService: string;
  action: NetworkPolicyAction;
}

// ── Request / Response Envelopes ────────────────────────────────────────────

/**
 * A service call request envelope sent pod-to-pod via WebRTC.
 */
export interface ServiceRequest {
  /** Unique request ID for correlation */
  requestId: string;
  /** The calling pod's ID */
  sourcePodId: string;
  /** The calling pod's service ID */
  sourceServiceId: string;
  /** The target service virtual URL was resolved to this pod */
  targetPodId: string;
  /** The target service ID */
  targetServiceId: string;
  /** HTTP-like method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path portion of the virtual URL (e.g. /users/123) */
  path: string;
  /** Optional headers */
  headers?: Record<string, string>;
  /** Optional body (serialised) */
  body?: unknown;
  /** If true, bypass sticky cache and ask orchestrator for a fresh pod */
  nonSticky?: boolean;
}

/**
 * A service call response envelope returned pod-to-pod via WebRTC.
 */
export interface ServiceResponse {
  requestId: string;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
  error?: string;
}

// ── WebRTC Transport ────────────────────────────────────────────────────────

/**
 * State of a WebRTC connection to a target pod.
 */
export type PeerConnectionState =
  | 'new'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

/**
 * Configuration for the WebRTC connection manager.
 */
export interface WebRTCConfig {
  /** ICE servers for NAT traversal */
  iceServers?: RTCIceServerInit[];
  /** Connection timeout in ms (default: 10_000) */
  connectionTimeout?: number;
  /** Whether to use trickle ICE (default: true) */
  trickleICE?: boolean;
}

/**
 * Minimal ICE server config (isomorphic — no dependency on browser globals). */
export interface RTCIceServerInit {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Signalling message exchanged via the orchestrator WebSocket
 * to establish WebRTC connections between pods.
 */
export type SignallingMessageType = 'offer' | 'answer' | 'ice-candidate';

export interface SignallingMessage {
  type: SignallingMessageType;
  sourcePodId: string;
  targetPodId: string;
  payload: unknown; // SDP or ICE candidate
}

// ── Orchestrator Routing ────────────────────────────────────────────────────

/**
 * Request from a pod to the orchestrator asking for a target pod
 * for a given service.
 */
export interface RoutingRequest {
  callerPodId: string;
  callerServiceId: string;
  targetServiceId: string;
  /** If true, orchestrator should pick a fresh pod even if the caller has a cached one */
  nonSticky?: boolean;
}

/**
 * Response from the orchestrator with the selected target pod.
 */
export interface RoutingResponse {
  targetPodId: string;
  targetNodeId: string;
  /** Whether the policy check passed (always true if policies are disabled) */
  policyAllowed: boolean;
  /** If policyAllowed is false, the reason */
  policyDeniedReason?: string;
}

// ── Service Call Options ────────────────────────────────────────────────────

/**
 * Options for making a service call from a pod.
 */
export interface ServiceCallOptions {
  /** HTTP-like method (default: GET) */
  method?: ServiceRequest['method'];
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body */
  body?: unknown;
  /** Bypass sticky session and request a fresh target pod */
  nonSticky?: boolean;
  /** Request timeout in ms (default: 30_000) */
  timeout?: number;
}

// ── Network Events ──────────────────────────────────────────────────────────

export type NetworkEventType =
  | 'NetworkPolicyCreated'
  | 'NetworkPolicyDeleted'
  | 'NetworkPolicyDenied'
  | 'ServiceCallRouted'
  | 'PeerConnectionOpened'
  | 'PeerConnectionClosed'
  | 'PeerConnectionFailed';

// ── Default Configuration ───────────────────────────────────────────────────

/** Default TTL for cached target pods: 5 minutes */
export const DEFAULT_CACHE_TTL = 5 * 60 * 1000;

/** Default WebRTC connection timeout: 10 seconds */
export const DEFAULT_CONNECTION_TIMEOUT = 10_000;

/** Default service call timeout: 30 seconds */
export const DEFAULT_SERVICE_CALL_TIMEOUT = 30_000;

/** Virtual URL suffix for internal service calls */
export const INTERNAL_URL_SUFFIX = '.internal';

/**
 * Parse a virtual internal URL into serviceId and path.
 * Input:  `http://my-service.internal/api/users`
 * Output: `{ serviceId: 'my-service', path: '/api/users' }`
 */
export function parseInternalUrl(url: string): { serviceId: string; path: string } | null {
  // Support both http:// and plain forms
  const normalised = url.startsWith('http://') ? url.slice(7) : url;
  const suffixIdx = normalised.indexOf(INTERNAL_URL_SUFFIX);
  if (suffixIdx === -1) return null;

  const serviceId = normalised.slice(0, suffixIdx);
  if (!serviceId) return null;

  const rest = normalised.slice(suffixIdx + INTERNAL_URL_SUFFIX.length);
  const path = rest.startsWith('/') ? rest : `/${rest}`;
  return { serviceId, path };
}
