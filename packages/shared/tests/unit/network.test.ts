/**
 * Tests for Network Module
 *
 * Covers:
 * - Network types (parseInternalUrl)
 * - NetworkPolicyEngine
 * - ServiceRegistry
 * - PodTargetCache
 * - OrchestratorRouter (handleRoutingRequest)
 * - ServiceCaller
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseInternalUrl,
  DEFAULT_CACHE_TTL,
  INTERNAL_URL_SUFFIX,
} from '../../src/types/network.js';
import { NetworkPolicyEngine } from '../../src/network/network-policy.js';
import { ServiceRegistry } from '../../src/network/service-registry.js';
import { PodTargetCache } from '../../src/network/pod-cache.js';
import { handleRoutingRequest } from '../../src/network/orchestrator-router.js';
import { PodRequestRouter } from '../../src/network/orchestrator-router.js';
import { ServiceCaller, NetworkPolicyError } from '../../src/network/service-caller.js';
import type { WebRTCConnectionManager } from '../../src/network/webrtc-manager.js';
import type { RoutingRequest, RoutingResponse } from '../../src/types/network.js';

// ── parseInternalUrl ────────────────────────────────────────────────────────

describe('parseInternalUrl', () => {
  it('parses a full http:// internal URL', () => {
    const result = parseInternalUrl('http://users-service.internal/api/users/123');
    expect(result).toEqual({ serviceId: 'users-service', path: '/api/users/123' });
  });

  it('parses a full https:// internal URL', () => {
    const result = parseInternalUrl('https://users-service.internal/api/users/123');
    expect(result).toEqual({ serviceId: 'users-service', path: '/api/users/123' });
  });

  it('parses without http:// prefix', () => {
    const result = parseInternalUrl('auth.internal/validate');
    expect(result).toEqual({ serviceId: 'auth', path: '/validate' });
  });

  it('handles root path', () => {
    const result = parseInternalUrl('http://my-svc.internal/');
    expect(result).toEqual({ serviceId: 'my-svc', path: '/' });
  });

  it('handles https root path', () => {
    const result = parseInternalUrl('https://my-svc.internal/');
    expect(result).toEqual({ serviceId: 'my-svc', path: '/' });
  });

  it('handles no path after .internal', () => {
    const result = parseInternalUrl('http://my-svc.internal');
    expect(result).toEqual({ serviceId: 'my-svc', path: '/' });
  });

  it('returns null for non-internal URLs', () => {
    expect(parseInternalUrl('http://google.com/api')).toBeNull();
    expect(parseInternalUrl('https://example.com')).toBeNull();
  });

  it('returns null for empty service ID', () => {
    expect(parseInternalUrl('http://.internal/path')).toBeNull();
  });

  it('exports INTERNAL_URL_SUFFIX and DEFAULT_CACHE_TTL', () => {
    expect(INTERNAL_URL_SUFFIX).toBe('.internal');
    expect(DEFAULT_CACHE_TTL).toBe(5 * 60 * 1000);
  });
});

// ── NetworkPolicyEngine ─────────────────────────────────────────────────────

describe('NetworkPolicyEngine', () => {
  let engine: NetworkPolicyEngine;

  beforeEach(() => {
    engine = new NetworkPolicyEngine();
  });

  it('denies all traffic when no policies exist (deny-by-default)', () => {
    const result = engine.isAllowed('serviceA', 'serviceB');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denied by default');
  });

  it('denies traffic when a deny policy exists', () => {
    engine.addPolicy({ sourceService: 'frontend', targetService: 'db', action: 'deny' });
    const result = engine.isAllowed('frontend', 'db');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('frontend');
    expect(result.reason).toContain('db');
  });

  it('allows traffic with explicit allow policy', () => {
    engine.addPolicy({ sourceService: 'api', targetService: 'users', action: 'allow' });
    const result = engine.isAllowed('api', 'users');
    expect(result.allowed).toBe(true);
  });

  it('denies unmatched traffic when policies exist (deny-by-default)', () => {
    engine.addPolicy({ sourceService: 'api', targetService: 'users', action: 'allow' });
    // Different pair — no matching policy → denied
    const result = engine.isAllowed('frontend', 'api');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denied by default');
  });

  it('replaces existing policy for same pair', () => {
    engine.addPolicy({ sourceService: 'a', targetService: 'b', action: 'allow' });
    expect(engine.isAllowed('a', 'b').allowed).toBe(true);

    engine.addPolicy({ sourceService: 'a', targetService: 'b', action: 'deny' });
    expect(engine.isAllowed('a', 'b').allowed).toBe(false);
    expect(engine.size).toBe(1);
  });

  it('removes policy by ID', () => {
    const policy = engine.addPolicy({ sourceService: 'a', targetService: 'b', action: 'deny' });
    expect(engine.removePolicy(policy.id)).toBe(true);
    // After removing all policies, deny-by-default kicks in
    expect(engine.isAllowed('a', 'b').allowed).toBe(false);
  });

  it('removes policy by pair', () => {
    engine.addPolicy({ sourceService: 'x', targetService: 'y', action: 'deny' });
    expect(engine.removePolicyByPair('x', 'y')).toBe(true);
    expect(engine.size).toBe(0);
  });

  it('lists all policies', () => {
    engine.addPolicy({ sourceService: 'a', targetService: 'b', action: 'allow' });
    engine.addPolicy({ sourceService: 'c', targetService: 'd', action: 'deny' });
    expect(engine.listPolicies()).toHaveLength(2);
  });

  it('syncs policies from external source', () => {
    engine.syncPolicies([
      { id: 'netpol-10', sourceService: 'a', targetService: 'b', action: 'deny', createdAt: Date.now() },
    ]);
    expect(engine.size).toBe(1);
    expect(engine.isAllowed('a', 'b').allowed).toBe(false);
  });

  it('clears all policies', () => {
    engine.addPolicy({ sourceService: 'a', targetService: 'b', action: 'deny' });
    engine.clear();
    expect(engine.size).toBe(0);
    // After clearing, deny-by-default kicks in
    expect(engine.isAllowed('a', 'b').allowed).toBe(false);
  });
});

// ── ServiceRegistry ─────────────────────────────────────────────────────────

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  it('registers and retrieves pods for a service', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-1', 'pod-b', 'node-2');

    const pods = registry.getHealthyPods('svc-1');
    expect(pods).toHaveLength(2);
    expect(pods.map((p) => p.podId)).toContain('pod-a');
    expect(pods.map((p) => p.podId)).toContain('pod-b');
  });

  it('updates existing pod entry', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-1', 'pod-a', 'node-2', 'unhealthy');

    const all = registry.getAllPods('svc-1');
    expect(all).toHaveLength(1);
    expect(all[0]!.nodeId).toBe('node-2');
    expect(all[0]!.status).toBe('unhealthy');
  });

  it('unregisters a pod from a service', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-1', 'pod-b', 'node-1');
    expect(registry.unregister('svc-1', 'pod-a')).toBe(true);
    expect(registry.getHealthyPods('svc-1')).toHaveLength(1);
  });

  it('unregisters a pod from all services', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-2', 'pod-a', 'node-1');
    registry.unregisterPod('pod-a');
    expect(registry.getHealthyPods('svc-1')).toHaveLength(0);
    expect(registry.getHealthyPods('svc-2')).toHaveLength(0);
  });

  it('selects a random healthy pod', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-1', 'pod-b', 'node-2');
    const selected = registry.selectPod('svc-1');
    expect(selected).not.toBeNull();
    expect(['pod-a', 'pod-b']).toContain(selected!.podId);
  });

  it('returns null when no healthy pods', () => {
    registry.register('svc-1', 'pod-a', 'node-1', 'unhealthy');
    expect(registry.selectPod('svc-1')).toBeNull();
  });

  it('excludes specific pod during selection', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-1', 'pod-b', 'node-2');
    const selected = registry.selectPod('svc-1', 'pod-a');
    expect(selected!.podId).toBe('pod-b');
  });

  it('checks if a pod is healthy', () => {
    registry.register('svc-1', 'pod-a', 'node-1', 'healthy');
    expect(registry.isPodHealthy('svc-1', 'pod-a')).toBe(true);
    registry.updatePodStatus('svc-1', 'pod-a', 'unhealthy');
    expect(registry.isPodHealthy('svc-1', 'pod-a')).toBe(false);
  });

  it('marks stale pods as unhealthy', () => {
    registry.register('svc-1', 'pod-old', 'node-1');
    // Manually set a very old heartbeat
    const pods = registry.getAllPods('svc-1');
    pods[0]!.lastHeartbeat = Date.now() - 120_000;

    const stale = registry.markStale(60_000);
    expect(stale).toContain('pod-old');
    expect(registry.isPodHealthy('svc-1', 'pod-old')).toBe(false);
  });

  it('provides a snapshot', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-2', 'pod-b', 'node-2');
    const snap = registry.snapshot();
    expect(Object.keys(snap)).toEqual(['svc-1', 'svc-2']);
  });

  it('tracks service and pod counts', () => {
    registry.register('svc-1', 'pod-a', 'node-1');
    registry.register('svc-1', 'pod-b', 'node-1');
    registry.register('svc-2', 'pod-c', 'node-2');
    expect(registry.serviceCount).toBe(2);
    expect(registry.podCount).toBe(3);
  });
});

// ── PodTargetCache ──────────────────────────────────────────────────────────

describe('PodTargetCache', () => {
  let cache: PodTargetCache;

  beforeEach(() => {
    cache = new PodTargetCache(60_000); // 60s TTL
  });

  it('caches and retrieves a target pod (sticky)', () => {
    cache.set('svc-1', 'pod-a', 'node-1');
    const entry = cache.get('svc-1');
    expect(entry).not.toBeNull();
    expect(entry!.podId).toBe('pod-a');
    expect(entry!.healthy).toBe(true);
  });

  it('returns null for missing entry', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns null for expired entry', () => {
    cache.set('svc-1', 'pod-a', 'node-1', 1); // 1ms TTL
    // Wait for expiry
    const entry = cache.get('svc-1');
    // Might or might not be expired in <1ms, so set it explicitly
    const cached = cache.set('svc-1', 'pod-a', 'node-1', 1);
    // Manually expire
    (cached as { cachedAt: number }).cachedAt = Date.now() - 100;
    expect(cache.get('svc-1')).toBeNull();
  });

  it('returns null for unhealthy entry', () => {
    cache.set('svc-1', 'pod-a', 'node-1');
    cache.markUnhealthy('svc-1');
    expect(cache.get('svc-1')).toBeNull();
  });

  it('invalidates by service', () => {
    cache.set('svc-1', 'pod-a', 'node-1');
    cache.invalidate('svc-1');
    expect(cache.get('svc-1')).toBeNull();
  });

  it('invalidates by pod ID', () => {
    cache.set('svc-1', 'pod-a', 'node-1');
    cache.set('svc-2', 'pod-a', 'node-1');
    cache.set('svc-3', 'pod-b', 'node-2');
    cache.invalidatePod('pod-a');
    expect(cache.get('svc-1')).toBeNull();
    expect(cache.get('svc-2')).toBeNull();
    expect(cache.get('svc-3')).not.toBeNull();
  });

  it('reports size', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 'p1', 'n1');
    cache.set('b', 'p2', 'n2');
    expect(cache.size).toBe(2);
  });

  it('supports infinite TTL (ttl=0)', () => {
    cache.set('svc-1', 'pod-a', 'node-1', 0);
    const entry = cache.get('svc-1');
    expect(entry).not.toBeNull();
    // Manually set cachedAt to far past — should NOT expire
    (entry as { cachedAt: number }).cachedAt = Date.now() - 999_999_999;
    expect(cache.get('svc-1')).not.toBeNull();
  });
});

// ── handleRoutingRequest ────────────────────────────────────────────────────

describe('handleRoutingRequest', () => {
  let registry: ServiceRegistry;
  let policyEngine: NetworkPolicyEngine;

  beforeEach(() => {
    registry = new ServiceRegistry();
    policyEngine = new NetworkPolicyEngine();
  });

  it('selects a healthy pod for the target service', () => {
    registry.register('users', 'pod-u1', 'node-1');
    // Need an allow policy since deny-by-default
    policyEngine.addPolicy({ sourceService: 'api', targetService: 'users', action: 'allow' });
    const response = handleRoutingRequest(
      { callerPodId: 'pod-api-1', callerServiceId: 'api', targetServiceId: 'users' },
      { registry, policyEngine },
    );
    expect(response.policyAllowed).toBe(true);
    expect(response.targetPodId).toBe('pod-u1');
    expect(response.targetNodeId).toBe('node-1');
  });

  it('returns denied when policy blocks the call', () => {
    registry.register('db', 'pod-db1', 'node-1');
    policyEngine.addPolicy({ sourceService: 'frontend', targetService: 'db', action: 'deny' });

    const response = handleRoutingRequest(
      { callerPodId: 'pod-fe1', callerServiceId: 'frontend', targetServiceId: 'db' },
      { registry, policyEngine },
    );
    expect(response.policyAllowed).toBe(false);
    expect(response.policyDeniedReason).toContain('frontend');
  });

  it('returns denied when no allow policy exists (deny-by-default)', () => {
    registry.register('users', 'pod-u1', 'node-1');
    // Add an unrelated policy so the engine is non-empty but has no match
    policyEngine.addPolicy({ sourceService: 'other', targetService: 'other2', action: 'allow' });

    const response = handleRoutingRequest(
      { callerPodId: 'pod-api-1', callerServiceId: 'api', targetServiceId: 'users' },
      { registry, policyEngine },
    );
    expect(response.policyAllowed).toBe(false);
    expect(response.policyDeniedReason).toContain('denied by default');
  });

  it('throws when no healthy pods are available', () => {
    expect(() =>
      handleRoutingRequest(
        { callerPodId: 'pod-1', callerServiceId: 'api', targetServiceId: 'missing-service' },
        { registry },
      ),
    ).toThrow('No healthy pods');
  });

  it('works without policy engine (all allowed)', () => {
    registry.register('svc', 'pod-1', 'node-1');
    const response = handleRoutingRequest(
      { callerPodId: 'pod-caller', callerServiceId: 'caller', targetServiceId: 'svc' },
      { registry },
    );
    expect(response.policyAllowed).toBe(true);
  });
});

// ── PodRequestRouter ────────────────────────────────────────────────────────

describe('PodRequestRouter', () => {
  let router: PodRequestRouter;

  beforeEach(() => {
    router = new PodRequestRouter();
  });

  it('dispatches to the correct handler', async () => {
    router.handle('/api/users', async (_method, _path, _body) => ({
      status: 200,
      body: { users: [] },
    }));

    const result = await router.dispatch('GET', '/api/users', null);
    expect(result.status).toBe(200);
  });

  it('returns 404 for unmatched paths with no default', async () => {
    const result = await router.dispatch('GET', '/unknown', null);
    expect(result.status).toBe(404);
  });

  it('falls back to default handler', async () => {
    router.setDefault(async () => ({ status: 200, body: 'default' }));
    const result = await router.dispatch('GET', '/anything', null);
    expect(result.status).toBe(200);
    expect(result.body).toBe('default');
  });

  it('catches handler errors and returns 500', async () => {
    router.handle('/fail', async () => {
      throw new Error('boom');
    });
    const result = await router.dispatch('GET', '/fail', null);
    expect(result.status).toBe(500);
  });

  it('matches longest prefix', async () => {
    router.handle('/api', async () => ({ status: 200, body: 'short' }));
    router.handle('/api/users', async () => ({ status: 200, body: 'long' }));
    const result = await router.dispatch('GET', '/api/users/1', null);
    expect(result.body).toBe('long');
  });
});

// ── ServiceCaller ───────────────────────────────────────────────────────────

describe('ServiceCaller', () => {
  let caller: ServiceCaller;
  let mockConnMgr: WebRTCConnectionManager;
  let mockRouter: (req: RoutingRequest) => Promise<RoutingResponse>;

  beforeEach(() => {
    // Mock connection manager
    mockConnMgr = {
      isConnected: vi.fn().mockReturnValue(true),
      connect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      disconnect: vi.fn(),
      disconnectAll: vi.fn(),
      handleSignal: vi.fn(),
      getState: vi.fn().mockReturnValue('connected'),
      listConnections: vi.fn().mockReturnValue([]),
      activeCount: 0,
    } as unknown as WebRTCConnectionManager;

    // Mock orchestrator router
    mockRouter = vi.fn().mockResolvedValue({
      targetPodId: 'pod-target-1',
      targetNodeId: 'node-1',
      policyAllowed: true,
    });

    caller = new ServiceCaller({
      podId: 'pod-caller-1',
      serviceId: 'api-service',
      connectionManager: mockConnMgr,
      orchestratorRouter: mockRouter,
      defaultTimeout: 5000,
    });
  });

  it('makes a sticky call using cache after first routing', async () => {
    // First call — cache miss, goes to orchestrator
    const callPromise = caller.call('http://users.internal/api/list');

    // Simulate response
    setTimeout(() => {
      const sentData = (mockConnMgr.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
      if (sentData) {
        const req = JSON.parse(sentData as string);
        caller.handleResponse(JSON.stringify({
          requestId: req.requestId,
          status: 200,
          body: { users: ['alice'] },
        }));
      }
    }, 10);

    const res = await callPromise;
    expect(res.status).toBe(200);
    expect(mockRouter).toHaveBeenCalledTimes(1);

    // Second call — sticky, should use cache (no orchestrator call)
    const callPromise2 = caller.call('http://users.internal/api/list');
    setTimeout(() => {
      const sentData = (mockConnMgr.send as ReturnType<typeof vi.fn>).mock.calls[1]?.[1];
      if (sentData) {
        const req = JSON.parse(sentData as string);
        caller.handleResponse(JSON.stringify({
          requestId: req.requestId,
          status: 200,
          body: { users: ['bob'] },
        }));
      }
    }, 10);

    await callPromise2;
    // Orchestrator should NOT have been called again (sticky cache hit)
    expect(mockRouter).toHaveBeenCalledTimes(1);
  });

  it('routes via orchestrator for non-sticky calls', async () => {
    // Pre-populate cache
    caller.getCache().set('users', 'pod-old', 'node-old');

    const callPromise = caller.call('http://users.internal/api/list', { nonSticky: true });
    setTimeout(() => {
      const sentData = (mockConnMgr.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
      if (sentData) {
        const req = JSON.parse(sentData as string);
        caller.handleResponse(JSON.stringify({
          requestId: req.requestId,
          status: 200,
        }));
      }
    }, 10);

    await callPromise;
    // Should have called orchestrator despite cache
    expect(mockRouter).toHaveBeenCalledTimes(1);
  });

  it('throws NetworkPolicyError when policy denies', async () => {
    const policy = new NetworkPolicyEngine();
    policy.addPolicy({ sourceService: 'api-service', targetService: 'db', action: 'deny' });

    const callerWithPolicy = new ServiceCaller({
      podId: 'pod-1',
      serviceId: 'api-service',
      connectionManager: mockConnMgr,
      orchestratorRouter: mockRouter,
      policyEngine: policy,
    });

    await expect(
      callerWithPolicy.call('http://db.internal/query'),
    ).rejects.toThrow(NetworkPolicyError);
  });

  it('throws on invalid internal URL', async () => {
    await expect(
      caller.call('http://google.com/api'),
    ).rejects.toThrow('Invalid internal URL');
  });

  it('re-routes when cached pod connection is dead', async () => {
    // Pre-populate cache
    caller.getCache().set('users', 'pod-dead', 'node-1');
    // Simulate dead connection
    (mockConnMgr.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const callPromise = caller.call('http://users.internal/api/list');
    setTimeout(() => {
      const sentData = (mockConnMgr.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
      if (sentData) {
        const req = JSON.parse(sentData as string);
        caller.handleResponse(JSON.stringify({
          requestId: req.requestId,
          status: 200,
        }));
      }
    }, 10);

    await callPromise;
    // Should have called orchestrator (cache miss due to dead pod)
    expect(mockRouter).toHaveBeenCalled();
  });

  it('notifies pod death and invalidates cache', () => {
    caller.getCache().set('svc-1', 'pod-x', 'node-1');
    caller.notifyPodDead('pod-x');
    expect(caller.getCache().get('svc-1')).toBeNull();
    expect(mockConnMgr.disconnect).toHaveBeenCalledWith('pod-x');
  });
});
