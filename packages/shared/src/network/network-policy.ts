/**
 * Network Policy Engine
 *
 * Enforces inter-service communication policies. Runs isomorphically
 * on both orchestrator (server-side) and pod (client-side).
 *
 * **Deny-by-default**: all inter-service traffic is blocked until
 * explicit 'allow' rules are configured.
 *
 * @module @stark-o/shared/network/network-policy
 */

import type { NetworkPolicy, CreateNetworkPolicyInput } from '../types/network.js';

/**
 * In-memory network policy store.
 * Can be used on the orchestrator or synced to pods.
 */
export class NetworkPolicyEngine {
  private policies: Map<string, NetworkPolicy> = new Map();
  private nextId = 1;

  /**
   * Add a new network policy.
   * If a policy for the same source→target pair already exists, it is replaced.
   */
  addPolicy(input: CreateNetworkPolicyInput): NetworkPolicy {
    // Remove any existing policy for the same pair
    const existingKey = this.pairKey(input.sourceService, input.targetService);
    for (const [id, policy] of this.policies) {
      if (this.pairKey(policy.sourceService, policy.targetService) === existingKey) {
        this.policies.delete(id);
      }
    }

    const policy: NetworkPolicy = {
      id: `netpol-${this.nextId++}`,
      sourceService: input.sourceService,
      targetService: input.targetService,
      action: input.action,
      createdAt: Date.now(),
    };
    this.policies.set(policy.id, policy);
    return policy;
  }

  /**
   * Remove a policy by ID.
   */
  removePolicy(id: string): boolean {
    return this.policies.delete(id);
  }

  /**
   * Remove all policies for a source→target pair.
   */
  removePolicyByPair(sourceService: string, targetService: string): boolean {
    const key = this.pairKey(sourceService, targetService);
    let removed = false;
    for (const [id, policy] of this.policies) {
      if (this.pairKey(policy.sourceService, policy.targetService) === key) {
        this.policies.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  /**
   * Check if a service call is allowed.
   *
   * Rules (deny-by-default):
   * 1. If no policies exist at all → **denied** (no allow rules configured).
   * 2. If an explicit 'allow' exists for source→target → **allowed**.
   * 3. If an explicit 'deny' exists for source→target → **denied**.
   * 4. If policies exist but none match this pair → **denied** (default-deny).
   */
  isAllowed(sourceService: string, targetService: string): { allowed: boolean; reason?: string } {
    if (this.policies.size === 0) {
      return {
        allowed: false,
        reason: `No network policies configured — all traffic is denied by default. Add an allow rule: sourceService='${sourceService}' → targetService='${targetService}'`,
      };
    }

    const key = this.pairKey(sourceService, targetService);
    for (const policy of this.policies.values()) {
      if (this.pairKey(policy.sourceService, policy.targetService) === key) {
        if (policy.action === 'allow') {
          return { allowed: true };
        }
        // explicit deny
        return {
          allowed: false,
          reason: `Network policy denies communication from '${sourceService}' to '${targetService}' (policy ${policy.id})`,
        };
      }
    }

    // No matching policy — default deny
    return {
      allowed: false,
      reason: `No allow rule configured for '${sourceService}' → '${targetService}' — denied by default`,
    };
  }

  /**
   * Get all policies.
   */
  listPolicies(): NetworkPolicy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get a policy by ID.
   */
  getPolicy(id: string): NetworkPolicy | undefined {
    return this.policies.get(id);
  }

  /**
   * Replace the entire policy set (used for syncing from orchestrator).
   */
  syncPolicies(policies: NetworkPolicy[]): void {
    this.policies.clear();
    for (const p of policies) {
      this.policies.set(p.id, p);
      // Keep nextId above any synced id
      const num = parseInt(p.id.replace('netpol-', ''), 10);
      if (!isNaN(num) && num >= this.nextId) {
        this.nextId = num + 1;
      }
    }
  }

  /**
   * Clear all policies.
   */
  clear(): void {
    this.policies.clear();
  }

  /**
   * Number of active policies.
   */
  get size(): number {
    return this.policies.size;
  }

  private pairKey(source: string, target: string): string {
    return `${source}→${target}`;
  }

  /**
   * Filter policies by namespace.
   */
  listPoliciesByNamespace(namespace: string): NetworkPolicy[] {
    return Array.from(this.policies.values()).filter(
      p => (p as any).namespace === namespace || !(p as any).namespace
    );
  }
}

/**
 * Singleton policy engine for orchestrator-side use.
 */
let _globalPolicyEngine: NetworkPolicyEngine | null = null;

export function getNetworkPolicyEngine(): NetworkPolicyEngine {
  if (!_globalPolicyEngine) {
    _globalPolicyEngine = new NetworkPolicyEngine();
  }
  return _globalPolicyEngine;
}

/**
 * Quick check: is traffic from source to target allowed?
 * Uses the global policy engine singleton.
 */
export function isServiceCallAllowed(
  sourceService: string,
  targetService: string,
): { allowed: boolean; reason?: string } {
  return getNetworkPolicyEngine().isAllowed(sourceService, targetService);
}

// ── Expose-Based Ingress Network Policy ─────────────────────────────────────

import type { ServiceVisibility } from '../types/service.js';

/**
 * Network metadata for a service, used by the centralized policy evaluator.
 * This is a lightweight subset of the full Service type.
 */
export interface ServiceNetworkMeta {
  /** Service ID (name) */
  serviceId: string;
  /** Namespace the service belongs to */
  namespace: string;
  /** Network visibility: public, private, or system */
  visibility: ServiceVisibility;
  /** Whether this service is reachable from ingress */
  exposed: boolean;
  /** Service IDs allowed to call this service internally (for private/system) */
  allowedSources?: string[];
}

/**
 * Lookup function to retrieve network metadata for a service by ID/name.
 * Implementations will query the service registry / database.
 */
export type ServiceNetworkMetaLookup = (serviceId: string) => ServiceNetworkMeta | undefined;

/**
 * Request context for centralized policy evaluation.
 */
export interface PolicyEvaluationRequest {
  /** The calling service ID (use 'ingress' for external traffic) */
  sourceServiceId: string;
  /** The target service ID */
  targetServiceId: string;
  /** Whether this request originates from ingress (external) */
  isIngressRequest: boolean;
}

/**
 * Result of a centralized policy evaluation.
 */
export interface PolicyEvaluationResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Human-readable reason (populated on deny) */
  reason?: string;
}

/**
 * Centralized network policy evaluation function.
 *
 * Implements the two-step policy model:
 *   Step 1 — Ingress Check: if isIngressRequest, only `exposed` matters.
 *   Step 2 — Internal Policy Check: uses visibility + allowedSources.
 *
 * This function is the single source of truth for network policy decisions.
 * It must be called at the ingress routing layer and at the node routing layer.
 * Pods must NOT call this — enforcement is centralized.
 *
 * @param request  The policy evaluation request context
 * @param lookup   Function to resolve service network metadata
 * @returns        PolicyEvaluationResult with allowed/denied + reason
 */
export function evaluateNetworkPolicy(
  request: PolicyEvaluationRequest,
  lookup: ServiceNetworkMetaLookup,
): PolicyEvaluationResult {
  const { sourceServiceId, targetServiceId, isIngressRequest } = request;

  // Resolve target service metadata
  const target = lookup(targetServiceId);
  if (!target) {
    return {
      allowed: false,
      reason: `Target service '${targetServiceId}' not found in registry`,
    };
  }

  // ── Step 1: Ingress Check ──────────────────────────────────────────
  if (isIngressRequest) {
    if (!target.exposed) {
      return {
        allowed: false,
        reason: `Service '${targetServiceId}' is not exposed — ingress access denied`,
      };
    }
    // Ingress does NOT care about visibility. Exposure alone determines external access.
    return { allowed: true };
  }

  // ── Step 2: Internal Policy Check ──────────────────────────────────
  switch (target.visibility) {
    case 'public':
      // Public services allow all internal traffic by default
      return { allowed: true };

    case 'private': {
      if (target.allowedSources && target.allowedSources.length > 0) {
        if (target.allowedSources.includes(sourceServiceId)) {
          return { allowed: true };
        }
      }
      return {
        allowed: false,
        reason: `Service '${targetServiceId}' is private — '${sourceServiceId}' is not in allowedSources`,
      };
    }

    case 'system': {
      if (target.allowedSources && target.allowedSources.length > 0) {
        if (target.allowedSources.includes(sourceServiceId)) {
          return { allowed: true };
        }
      }
      return {
        allowed: false,
        reason: `Service '${targetServiceId}' is a system service — '${sourceServiceId}' is not in allowedSources`,
      };
    }

    default:
      return {
        allowed: false,
        reason: `Unknown visibility '${target.visibility}' on service '${targetServiceId}'`,
      };
  }
}

// ── Global Service Network Metadata Store ───────────────────────────────────

/**
 * In-memory store for service network metadata.
 * Used by the orchestrator to track visibility/exposed/allowedSources
 * for all registered services.
 */
export class ServiceNetworkMetaStore {
  private store = new Map<string, ServiceNetworkMeta>();

  /**
   * Build a composite key from namespace and serviceId.
   */
  private key(serviceId: string, namespace: string = 'default'): string {
    return `${namespace}/${serviceId}`;
  }

  /**
   * Set or update network metadata for a service.
   */
  set(meta: ServiceNetworkMeta): void {
    this.store.set(this.key(meta.serviceId, meta.namespace), meta);
  }

  /**
   * Get network metadata for a service.
   */
  get(serviceId: string, namespace: string = 'default'): ServiceNetworkMeta | undefined {
    return this.store.get(this.key(serviceId, namespace));
  }

  /**
   * Remove network metadata for a service.
   */
  remove(serviceId: string, namespace: string = 'default'): boolean {
    return this.store.delete(this.key(serviceId, namespace));
  }

  /**
   * List all service network metadata.
   */
  list(): ServiceNetworkMeta[] {
    return Array.from(this.store.values());
  }

  /**
   * Set visibility for a service.
   */
  setVisibility(serviceId: string, visibility: ServiceVisibility, namespace: string = 'default'): boolean {
    const existing = this.store.get(this.key(serviceId, namespace));
    if (!existing) return false;
    existing.visibility = visibility;
    return true;
  }

  /**
   * Set exposed flag for a service.
   */
  setExposed(serviceId: string, exposed: boolean, namespace: string = 'default'): boolean {
    const existing = this.store.get(this.key(serviceId, namespace));
    if (!existing) return false;
    existing.exposed = exposed;
    return true;
  }

  /**
   * Add a source to a service's allowed sources.
   */
  addAllowedSource(serviceId: string, sourceServiceId: string, namespace: string = 'default'): boolean {
    const existing = this.store.get(this.key(serviceId, namespace));
    if (!existing) return false;
    if (!existing.allowedSources) {
      existing.allowedSources = [];
    }
    if (!existing.allowedSources.includes(sourceServiceId)) {
      existing.allowedSources.push(sourceServiceId);
    }
    return true;
  }

  /**
   * Remove a source from a service's allowed sources.
   */
  removeAllowedSource(serviceId: string, sourceServiceId: string, namespace: string = 'default'): boolean {
    const existing = this.store.get(this.key(serviceId, namespace));
    if (!existing || !existing.allowedSources) return false;
    const idx = existing.allowedSources.indexOf(sourceServiceId);
    if (idx === -1) return false;
    existing.allowedSources.splice(idx, 1);
    return true;
  }

  /**
   * Create a lookup function bound to this store.
   * Use this as the `lookup` argument to `evaluateNetworkPolicy`.
   * When namespace is provided, lookups are scoped to that namespace.
   */
  createLookup(namespace: string = 'default'): ServiceNetworkMetaLookup {
    return (serviceId: string) => this.get(serviceId, namespace);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Number of entries.
   */
  get size(): number {
    return this.store.size;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _globalMetaStore: ServiceNetworkMetaStore | null = null;

export function getServiceNetworkMetaStore(): ServiceNetworkMetaStore {
  if (!_globalMetaStore) {
    _globalMetaStore = new ServiceNetworkMetaStore();
  }
  return _globalMetaStore;
}
