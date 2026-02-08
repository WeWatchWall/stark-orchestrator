/**
 * Orchestrator Routing
 *
 * Server-side handler for pod routing requests.
 * When a pod has a cache miss (or non-sticky request), it asks the
 * orchestrator to select a target pod for the requested service.
 *
 * The orchestrator:
 *   1. Checks network policies (if any are configured).
 *   2. Selects a healthy pod from the service registry.
 *   3. Returns the selected pod's ID and node ID to the caller.
 *
 * The orchestrator **never proxies traffic**. It only assists with routing.
 *
 * @module @stark-o/shared/network/orchestrator-router
 */

import type { RoutingRequest, RoutingResponse } from '../types/network.js';
import type { ServiceRegistry } from './service-registry.js';
import type { NetworkPolicyEngine } from './network-policy.js';

export interface OrchestratorRouterConfig {
  /** The service registry (maps serviceId → pods) */
  registry: ServiceRegistry;
  /** The network policy engine (optional — if omitted, all traffic allowed) */
  policyEngine?: NetworkPolicyEngine;
}

/**
 * Handle a routing request from a caller pod.
 *
 * @returns A RoutingResponse with the selected target pod,
 *          or a denied response if a network policy blocks it.
 * @throws  If no healthy pods are available for the target service.
 */
export function handleRoutingRequest(
  request: RoutingRequest,
  config: OrchestratorRouterConfig,
): RoutingResponse {
  const { callerServiceId, targetServiceId } = request;

  // ── Policy check ────────────────────────────────────────────────────
  if (config.policyEngine) {
    const check = config.policyEngine.isAllowed(callerServiceId, targetServiceId);
    if (!check.allowed) {
      return {
        targetPodId: '',
        targetNodeId: '',
        policyAllowed: false,
        policyDeniedReason: check.reason,
      };
    }
  }

  // ── Select pod ──────────────────────────────────────────────────────
  // For non-sticky, we could exclude the caller's cached pod
  // but since the caller doesn't send it, we just pick any healthy pod.
  const pod = config.registry.selectPod(targetServiceId);

  if (!pod) {
    throw new Error(
      `No healthy pods available for service '${targetServiceId}'. ` +
      `Ensure the service is deployed and has running pods.`,
    );
  }

  return {
    targetPodId: pod.podId,
    targetNodeId: pod.nodeId,
    policyAllowed: true,
  };
}

/**
 * Service Request Handler (pod-side)
 *
 * Handles incoming ServiceRequests on the target pod.
 * This is a minimal router that dispatches the request to registered handlers.
 */
export type RequestHandler = (
  method: string,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>;

/**
 * Create a request handler registry for a pod.
 * Pods register handlers for paths, and incoming ServiceRequests are dispatched.
 */
export class PodRequestRouter {
  private handlers: Map<string, RequestHandler> = new Map();
  private defaultHandler: RequestHandler | null = null;

  /**
   * Register a handler for a specific path prefix.
   */
  handle(pathPrefix: string, handler: RequestHandler): void {
    this.handlers.set(pathPrefix, handler);
  }

  /**
   * Set a default handler for unmatched paths.
   */
  setDefault(handler: RequestHandler): void {
    this.defaultHandler = handler;
  }

  /**
   * Dispatch an incoming request to the appropriate handler.
   */
  async dispatch(
    method: string,
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body?: unknown; headers?: Record<string, string> }> {
    // Find longest matching prefix
    let bestMatch: { prefix: string; handler: RequestHandler } | null = null;
    for (const [prefix, handler] of this.handlers) {
      if (path.startsWith(prefix)) {
        if (!bestMatch || prefix.length > bestMatch.prefix.length) {
          bestMatch = { prefix, handler };
        }
      }
    }

    const handler = bestMatch?.handler ?? this.defaultHandler;
    if (!handler) {
      return { status: 404, body: { error: `No handler for path '${path}'` } };
    }

    try {
      return await handler(method, path, body, headers);
    } catch (err) {
      return {
        status: 500,
        body: { error: err instanceof Error ? err.message : 'Internal error' },
      };
    }
  }
}
