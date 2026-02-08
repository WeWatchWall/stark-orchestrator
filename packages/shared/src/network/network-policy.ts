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
