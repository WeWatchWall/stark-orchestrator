/**
 * Pod Target Cache
 *
 * Per-pod local cache of target pods for services the pod communicates with.
 * Sticky sessions by default: the same target pod is reused until TTL expires
 * or the pod becomes unavailable.
 *
 * @module @stark-o/shared/network/pod-cache
 */

import type { CachedTargetPod } from '../types/network.js';
import { DEFAULT_CACHE_TTL } from '../types/network.js';

/**
 * Local cache of target pods per service.
 * Lives on each calling pod.
 */
export class PodTargetCache {
  /** serviceId → CachedTargetPod */
  private cache: Map<string, CachedTargetPod> = new Map();
  private defaultTtl: number;

  constructor(defaultTtl: number = DEFAULT_CACHE_TTL) {
    this.defaultTtl = defaultTtl;
  }

  /**
   * Get a cached target pod for a service.
   * Returns null if not cached, expired, or unhealthy.
   */
  get(serviceId: string): CachedTargetPod | null {
    const entry = this.cache.get(serviceId);
    if (!entry) return null;

    // Check TTL (ttl=0 means infinite)
    if (entry.ttl > 0 && Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(serviceId);
      return null;
    }

    if (!entry.healthy) {
      return null;
    }

    return entry;
  }

  /**
   * Set a cached target pod for a service (sticky).
   */
  set(serviceId: string, podId: string, nodeId: string, ttl?: number): CachedTargetPod {
    const entry: CachedTargetPod = {
      serviceId,
      podId,
      nodeId,
      cachedAt: Date.now(),
      ttl: ttl ?? this.defaultTtl,
      healthy: true,
    };
    this.cache.set(serviceId, entry);
    return entry;
  }

  /**
   * Mark a cached pod as unhealthy (triggers re-routing on next call).
   */
  markUnhealthy(serviceId: string): void {
    const entry = this.cache.get(serviceId);
    if (entry) {
      entry.healthy = false;
    }
  }

  /**
   * Invalidate (remove) the cached pod for a service.
   */
  invalidate(serviceId: string): void {
    this.cache.delete(serviceId);
  }

  /**
   * Invalidate all entries pointing to a specific pod
   * (e.g. when a pod is known to have died).
   */
  invalidatePod(podId: string): void {
    for (const [serviceId, entry] of this.cache) {
      if (entry.podId === podId) {
        this.cache.delete(serviceId);
      }
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get all cached entries (for debugging).
   */
  entries(): CachedTargetPod[] {
    return Array.from(this.cache.values());
  }

  /**
   * Number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }
}
