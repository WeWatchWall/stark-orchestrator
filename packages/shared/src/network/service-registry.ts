/**
 * Service Registry
 *
 * Orchestrator-side registry mapping serviceId → pods.
 * Isomorphic: can also be used on pods for local cache of registry state.
 *
 * @module @stark-o/shared/network/service-registry
 */

import type { ServiceRegistryEntry, RegistryPodStatus } from '../types/network.js';

/**
 * In-memory service registry.
 */
export class ServiceRegistry {
  private registry: Map<string, ServiceRegistryEntry[]> = new Map();

  /**
   * Register a pod for a service.
   * If the pod already exists, updates it.
   */
  register(serviceId: string, podId: string, nodeId: string, status: RegistryPodStatus = 'healthy'): void {
    const entries = this.registry.get(serviceId) ?? [];
    const existing = entries.find((e) => e.podId === podId);
    if (existing) {
      existing.nodeId = nodeId;
      existing.status = status;
      existing.lastHeartbeat = Date.now();
    } else {
      entries.push({ podId, nodeId, status, lastHeartbeat: Date.now() });
      this.registry.set(serviceId, entries);
    }
  }

  /**
   * Unregister a pod from a service.
   */
  unregister(serviceId: string, podId: string): boolean {
    const entries = this.registry.get(serviceId);
    if (!entries) return false;
    const idx = entries.findIndex((e) => e.podId === podId);
    if (idx === -1) return false;
    entries.splice(idx, 1);
    if (entries.length === 0) {
      this.registry.delete(serviceId);
    }
    return true;
  }

  /**
   * Remove a pod from all services (e.g. when pod dies).
   */
  unregisterPod(podId: string): void {
    for (const [serviceId, entries] of this.registry) {
      const idx = entries.findIndex((e) => e.podId === podId);
      if (idx !== -1) {
        entries.splice(idx, 1);
        if (entries.length === 0) {
          this.registry.delete(serviceId);
        }
      }
    }
  }

  /**
   * Update a pod's status.
   */
  updatePodStatus(serviceId: string, podId: string, status: RegistryPodStatus): void {
    const entries = this.registry.get(serviceId);
    if (!entries) return;
    const entry = entries.find((e) => e.podId === podId);
    if (entry) {
      entry.status = status;
      entry.lastHeartbeat = Date.now();
    }
  }

  /**
   * Get all healthy pods for a service.
   */
  getHealthyPods(serviceId: string): ServiceRegistryEntry[] {
    const entries = this.registry.get(serviceId) ?? [];
    return entries.filter((e) => e.status === 'healthy');
  }

  /**
   * Get all pods for a service (any status).
   */
  getAllPods(serviceId: string): ServiceRegistryEntry[] {
    return this.registry.get(serviceId) ?? [];
  }

  /**
   * Select a single pod for a service using round-robin-like selection.
   * Picks a random healthy pod (simple load balancing).
   */
  selectPod(serviceId: string, excludePodId?: string): ServiceRegistryEntry | null {
    const healthy = this.getHealthyPods(serviceId);
    const candidates = excludePodId
      ? healthy.filter((e) => e.podId !== excludePodId)
      : healthy;
    if (candidates.length === 0) return null;
    // Simple random selection; deterministic round-robin can be added later
    const idx = Math.floor(Math.random() * candidates.length);
    return candidates[idx] ?? null;
  }

  /**
   * Check if a specific pod is healthy.
   */
  isPodHealthy(serviceId: string, podId: string): boolean {
    const entries = this.registry.get(serviceId) ?? [];
    const entry = entries.find((e) => e.podId === podId);
    return entry?.status === 'healthy';
  }

  /**
   * Get all registered services.
   */
  listServices(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * Mark pods as unhealthy if they haven't sent a heartbeat within the given threshold.
   */
  markStale(heartbeatThresholdMs: number): string[] {
    const now = Date.now();
    const stalePods: string[] = [];
    for (const entries of this.registry.values()) {
      for (const entry of entries) {
        if (entry.status === 'healthy' && now - entry.lastHeartbeat > heartbeatThresholdMs) {
          entry.status = 'unhealthy';
          stalePods.push(entry.podId);
        }
      }
    }
    return stalePods;
  }

  /**
   * Get full registry snapshot (for API/debugging).
   */
  snapshot(): Record<string, ServiceRegistryEntry[]> {
    const result: Record<string, ServiceRegistryEntry[]> = {};
    for (const [serviceId, entries] of this.registry) {
      result[serviceId] = [...entries];
    }
    return result;
  }

  /**
   * Clear the entire registry.
   */
  clear(): void {
    this.registry.clear();
  }

  /**
   * Number of services in the registry.
   */
  get serviceCount(): number {
    return this.registry.size;
  }

  /**
   * Total number of pod entries across all services.
   */
  get podCount(): number {
    let count = 0;
    for (const entries of this.registry.values()) {
      count += entries.length;
    }
    return count;
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _globalRegistry: ServiceRegistry | null = null;

export function getServiceRegistry(): ServiceRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new ServiceRegistry();
  }
  return _globalRegistry;
}
