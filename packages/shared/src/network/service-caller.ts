/**
 * Service Caller
 *
 * Pod-side wrapper for making inter-service calls.
 * Implements the full routing flow:
 *   1. Parse virtual URL → serviceId + path
 *   2. Check network policy
 *   3. Check sticky cache for cached target pod
 *   4. If cache miss or non-sticky → query orchestrator
 *   5. Open/reuse WebRTC connection → send request → await response
 *
 * Sticky sessions are the **default**. Non-sticky is opt-in per request.
 *
 * @module @stark-o/shared/network/service-caller
 */

import type {
  ServiceRequest,
  ServiceResponse,
  ServiceCallOptions,
  RoutingRequest,
  RoutingResponse,
} from '../types/network.js';
import {
  parseInternalUrl,
  DEFAULT_SERVICE_CALL_TIMEOUT,
} from '../types/network.js';
import { PodTargetCache } from './pod-cache.js';
import { NetworkPolicyEngine } from './network-policy.js';
import type { WebRTCConnectionManager } from './webrtc-manager.js';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Function to request a routing decision from the orchestrator.
 * Implementations differ per runtime (WS message in Node, postMessage in browser, etc.).
 */
export type OrchestratorRouter = (request: RoutingRequest) => Promise<RoutingResponse>;

export interface ServiceCallerConfig {
  /** This pod's ID */
  podId: string;
  /** This pod's service ID */
  serviceId: string;
  /** WebRTC connection manager for sending/receiving */
  connectionManager: WebRTCConnectionManager;
  /** Function to ask the orchestrator for a target pod */
  orchestratorRouter: OrchestratorRouter;
  /** Network policy engine (optional — if omitted, all traffic is allowed) */
  policyEngine?: NetworkPolicyEngine;
  /** Pod target cache (optional — a default one is created) */
  cache?: PodTargetCache;
  /** Default TTL for cached targets in ms */
  cacheTtl?: number;
  /** Default request timeout in ms */
  defaultTimeout?: number;
}

// ── Service Caller ──────────────────────────────────────────────────────────

export class ServiceCaller {
  private podId: string;
  private serviceId: string;
  private connMgr: WebRTCConnectionManager;
  private router: OrchestratorRouter;
  private policy: NetworkPolicyEngine | null;
  private cache: PodTargetCache;
  private defaultTimeout: number;

  /** Pending responses keyed by requestId */
  private pending: Map<string, {
    resolve: (res: ServiceResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  private requestCounter = 0;

  constructor(config: ServiceCallerConfig) {
    this.podId = config.podId;
    this.serviceId = config.serviceId;
    this.connMgr = config.connectionManager;
    this.router = config.orchestratorRouter;
    this.policy = config.policyEngine ?? null;
    this.cache = config.cache ?? new PodTargetCache(config.cacheTtl);
    this.defaultTimeout = config.defaultTimeout ?? DEFAULT_SERVICE_CALL_TIMEOUT;
  }

  /**
   * Make a service call using a virtual internal URL.
   *
   * @example
   * ```ts
   * const res = await caller.call('http://users-service.internal/api/users/123');
   * const res = await caller.call('http://auth.internal/validate', { method: 'POST', body: { token } });
   * // Non-sticky (fresh pod selection):
   * const res = await caller.call('http://workers.internal/process', { nonSticky: true });
   * ```
   */
  async call(url: string, options?: ServiceCallOptions): Promise<ServiceResponse> {
    const parsed = parseInternalUrl(url);
    if (!parsed) {
      console.error(`[stark:ServiceCaller] ❌ parseInternalUrl failed for: '${url}'`);
      throw new Error(`Invalid internal URL: '${url}'. Expected format: http://{serviceId}.internal/{path}`);
    }

    const { serviceId: targetServiceId, path } = parsed;
    const method = options?.method ?? 'GET';
    const nonSticky = options?.nonSticky ?? false;
    const timeout = options?.timeout ?? this.defaultTimeout;

    // ── Step 1: Network policy check ──────────────────────────────────
    if (this.policy) {
      const check = this.policy.isAllowed(this.serviceId, targetServiceId);
      if (!check.allowed) {
        console.error(`[stark:ServiceCaller] 🚫 Policy denied: ${check.reason}`);
        throw new NetworkPolicyError(this.serviceId, targetServiceId, check.reason);
      }
    }

    // ── Step 2: Resolve target pod ────────────────────────────────────
    let targetPodId: string;

    if (!nonSticky) {
      // Sticky default: check cache first
      const cached = this.cache.get(targetServiceId);
      if (cached) {
        // Verify the connection is still healthy
        if (this.connMgr.isConnected(cached.podId)) {
          targetPodId = cached.podId;
        } else {
          // Cached pod is unreachable — mark unhealthy and re-route
          this.cache.markUnhealthy(targetServiceId);
          const routing = await this.routeViaOrchestrator(targetServiceId, nonSticky);
          targetPodId = routing.targetPodId;

          // If the orchestrator returned a different pod than what we had
          // cached, the old pod is dead — tear down the stale WebRTC
          // connection so we don't keep signaling the wrong pod.
          if (cached.podId !== targetPodId) {
            this.notifyPodDead(cached.podId);
          }
        }
      } else {
        // No cache — ask orchestrator
        const routing = await this.routeViaOrchestrator(targetServiceId, nonSticky);
        targetPodId = routing.targetPodId;
      }
    } else {
      // Non-sticky: always ask orchestrator for a fresh pod
      const routing = await this.routeViaOrchestrator(targetServiceId, nonSticky);
      targetPodId = routing.targetPodId;
    }

    // ── Step 3: Ensure WebRTC connection ──────────────────────────────
    if (!this.connMgr.isConnected(targetPodId)) {
      try {
        await this.connMgr.connect(targetPodId);
      } catch (err) {
        console.error(`[stark:ServiceCaller] ❌ WebRTC connect failed to ${targetPodId}:`, err);
        throw err;
      }
    }

    // ── Step 4: Build and send request ────────────────────────────────
    const requestId = this.nextRequestId();

    const request: ServiceRequest = {
      requestId,
      sourcePodId: this.podId,
      sourceServiceId: this.serviceId,
      targetPodId,
      targetServiceId,
      method,
      path,
      headers: options?.headers,
      body: options?.body,
      nonSticky,
    };

    return new Promise<ServiceResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        console.error(`[stark:ServiceCaller] ⏱️ Request ${requestId} timed out after ${timeout}ms`);
        this.pending.delete(requestId);
        reject(new Error(`Service call to '${url}' timed out after ${timeout}ms`));
      }, timeout);

      this.pending.set(requestId, { resolve, reject, timer });

      try {
        this.connMgr.send(targetPodId, JSON.stringify(request));
      } catch (err) {
        console.error(`[stark:ServiceCaller] ❌ connMgr.send() failed for ${requestId}:`, err);
        clearTimeout(timer);
        this.pending.delete(requestId);

        // Connection failed — invalidate cache and retry once via orchestrator
        this.cache.invalidate(targetServiceId);
        reject(err);
      }
    });
  }

  /**
   * Handle an incoming response message from a peer.
   * Called by the WebRTC connection manager's onMessage callback.
   */
  handleResponse(data: string): boolean {
    let parsed: ServiceResponse;
    try {
      parsed = JSON.parse(data) as ServiceResponse;
    } catch {
      console.warn(`[stark:ServiceCaller] ⚠️ handleResponse: failed to parse JSON`);
      return false;
    }

    if (!parsed.requestId) {
      console.warn(`[stark:ServiceCaller] ⚠️ handleResponse: no requestId in response`);
      return false;
    }

    const pending = this.pending.get(parsed.requestId);
    if (!pending) {
      console.warn(`[stark:ServiceCaller] ⚠️ handleResponse: no pending request for ${parsed.requestId}`);
      return false;
    }

    clearTimeout(pending.timer);
    this.pending.delete(parsed.requestId);
    pending.resolve(parsed);
    return true;
  }

  /**
   * Notify that a pod has become unavailable (e.g. pod churn).
   * Invalidates cache entries and closes the connection.
   */
  notifyPodDead(podId: string): void {
    this.cache.invalidatePod(podId);
    if (this.connMgr.isConnected(podId)) {
      this.connMgr.disconnect(podId);
    }
  }

  /**
   * Get the underlying cache (for inspection/testing).
   */
  getCache(): PodTargetCache {
    return this.cache;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async routeViaOrchestrator(targetServiceId: string, nonSticky: boolean): Promise<RoutingResponse> {
    try {
      const routing = await this.router({
        callerPodId: this.podId,
        callerServiceId: this.serviceId,
        targetServiceId,
        nonSticky,
      });

      if (!routing.policyAllowed) {
        console.error(`[stark:ServiceCaller] 🚫 Policy denied by orchestrator: ${routing.policyDeniedReason}`);
        throw new NetworkPolicyError(this.serviceId, targetServiceId, routing.policyDeniedReason);
      }

      // Update sticky cache (even for non-sticky — the next sticky call can use it)
      this.cache.set(targetServiceId, routing.targetPodId, routing.targetNodeId);

      return routing;
    } catch (err) {
      console.error(`[stark:ServiceCaller] ❌ routeViaOrchestrator failed:`, err);
      throw err;
    }
  }

  private nextRequestId(): string {
    return `${this.podId}-req-${++this.requestCounter}-${Date.now()}`;
  }
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class NetworkPolicyError extends Error {
  public readonly sourceService: string;
  public readonly targetService: string;

  constructor(sourceService: string, targetService: string, reason?: string) {
    super(reason ?? `Network policy denies communication from '${sourceService}' to '${targetService}'`);
    this.name = 'NetworkPolicyError';
    this.sourceService = sourceService;
    this.targetService = targetService;
  }
}
