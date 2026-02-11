/**
 * Tests for Network Policy System (Expose-Based Ingress)
 *
 * Covers:
 * - evaluateNetworkPolicy() centralized enforcement
 * - ServiceNetworkMetaStore
 * - Ingress access via exposed flag
 * - Internal access via visibility + allowedSources
 * - Integration with handleRoutingRequest (orchestrator router)
 *
 * @module @stark-o/shared/tests/unit/network-policy
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateNetworkPolicy,
  ServiceNetworkMetaStore,
  type ServiceNetworkMeta,
  type PolicyEvaluationRequest,
} from '../../src/network/network-policy.js';
import { handleRoutingRequest } from '../../src/network/orchestrator-router.js';
import { ServiceRegistry } from '../../src/network/service-registry.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createMeta(overrides: Partial<ServiceNetworkMeta> & { serviceId: string }): ServiceNetworkMeta {
  return {
    visibility: 'public',
    exposed: false,
    ...overrides,
  };
}

function createStore(...metas: ServiceNetworkMeta[]): ServiceNetworkMetaStore {
  const store = new ServiceNetworkMetaStore();
  for (const meta of metas) {
    store.set(meta);
  }
  return store;
}

// ── evaluateNetworkPolicy ───────────────────────────────────────────────────

describe('evaluateNetworkPolicy', () => {
  // ── Ingress checks ──────────────────────────────────────────────────

  describe('ingress requests', () => {
    it('allows ingress to an exposed service', () => {
      const store = createStore(
        createMeta({ serviceId: 'web-api', exposed: true, visibility: 'public' }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'ingress', targetServiceId: 'web-api', isIngressRequest: true },
        store.createLookup(),
      );

      expect(result.allowed).toBe(true);
    });

    it('allows ingress to an exposed private service', () => {
      const store = createStore(
        createMeta({ serviceId: 'web-api', exposed: true, visibility: 'private' }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'ingress', targetServiceId: 'web-api', isIngressRequest: true },
        store.createLookup(),
      );

      expect(result.allowed).toBe(true);
      // Exposure alone determines external access — visibility is irrelevant for ingress
    });

    it('allows ingress to an exposed system service', () => {
      const store = createStore(
        createMeta({ serviceId: 'admin-api', exposed: true, visibility: 'system' }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'ingress', targetServiceId: 'admin-api', isIngressRequest: true },
        store.createLookup(),
      );

      expect(result.allowed).toBe(true);
    });

    it('denies ingress to a non-exposed service', () => {
      const store = createStore(
        createMeta({ serviceId: 'internal-db', exposed: false, visibility: 'public' }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'ingress', targetServiceId: 'internal-db', isIngressRequest: true },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not exposed');
    });

    it('denies ingress to a non-exposed private service', () => {
      const store = createStore(
        createMeta({ serviceId: 'secret-svc', exposed: false, visibility: 'private' }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'ingress', targetServiceId: 'secret-svc', isIngressRequest: true },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not exposed');
    });

    it('denies ingress when target service not found', () => {
      const store = createStore(); // empty

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'ingress', targetServiceId: 'ghost-service', isIngressRequest: true },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ── Internal: public services ───────────────────────────────────────

  describe('internal requests — public visibility', () => {
    it('allows internal traffic to a public service by default', () => {
      const store = createStore(
        createMeta({ serviceId: 'users-service', visibility: 'public' }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'frontend', targetServiceId: 'users-service', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(true);
    });

    it('allows any internal caller to reach a public service', () => {
      const store = createStore(
        createMeta({ serviceId: 'shared-cache', visibility: 'public' }),
      );

      for (const caller of ['service-a', 'service-b', 'random-pod']) {
        const result = evaluateNetworkPolicy(
          { sourceServiceId: caller, targetServiceId: 'shared-cache', isIngressRequest: false },
          store.createLookup(),
        );
        expect(result.allowed).toBe(true);
      }
    });
  });

  // ── Internal: private services ──────────────────────────────────────

  describe('internal requests — private visibility', () => {
    it('allows an allowed source to reach a private service', () => {
      const store = createStore(
        createMeta({
          serviceId: 'db-service',
          visibility: 'private',
          allowedSources: ['api-gateway', 'admin-service'],
        }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'api-gateway', targetServiceId: 'db-service', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(true);
    });

    it('denies an unauthorized source from reaching a private service', () => {
      const store = createStore(
        createMeta({
          serviceId: 'db-service',
          visibility: 'private',
          allowedSources: ['api-gateway'],
        }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'malicious-service', targetServiceId: 'db-service', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('private');
      expect(result.reason).toContain('malicious-service');
      expect(result.reason).toContain('not in allowedSources');
    });

    it('denies all internal traffic to a private service with no allowedSources', () => {
      const store = createStore(
        createMeta({
          serviceId: 'isolated-service',
          visibility: 'private',
        }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'any-caller', targetServiceId: 'isolated-service', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('private');
    });

    it('denies all internal traffic to a private service with empty allowedSources', () => {
      const store = createStore(
        createMeta({
          serviceId: 'locked-service',
          visibility: 'private',
          allowedSources: [],
        }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'caller', targetServiceId: 'locked-service', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
    });
  });

  // ── Internal: system services ───────────────────────────────────────

  describe('internal requests — system visibility', () => {
    it('allows an allowed source to reach a system service', () => {
      const store = createStore(
        createMeta({
          serviceId: 'scheduler',
          visibility: 'system',
          allowedSources: ['orchestrator'],
        }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'orchestrator', targetServiceId: 'scheduler', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(true);
    });

    it('denies an unauthorized source from reaching a system service', () => {
      const store = createStore(
        createMeta({
          serviceId: 'scheduler',
          visibility: 'system',
          allowedSources: ['orchestrator'],
        }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'user-service', targetServiceId: 'scheduler', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('system service');
    });

    it('denies all internal traffic to a system service with no allowedSources', () => {
      const store = createStore(
        createMeta({
          serviceId: 'metrics-collector',
          visibility: 'system',
        }),
      );

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'any-service', targetServiceId: 'metrics-collector', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('system service');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('denies when target service is not found in registry', () => {
      const store = createStore(); // empty

      const result = evaluateNetworkPolicy(
        { sourceServiceId: 'caller', targetServiceId: 'nonexistent', isIngressRequest: false },
        store.createLookup(),
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('treats ingress source as special — not checked against allowedSources for internal', () => {
      // Ingress requests only check exposed flag, not visibility/allowedSources
      const store = createStore(
        createMeta({
          serviceId: 'web-api',
          visibility: 'private',
          exposed: true,
          allowedSources: [], // no allowed internal sources
        }),
      );

      // Ingress should succeed despite empty allowedSources
      const ingressResult = evaluateNetworkPolicy(
        { sourceServiceId: 'ingress', targetServiceId: 'web-api', isIngressRequest: true },
        store.createLookup(),
      );
      expect(ingressResult.allowed).toBe(true);

      // But internal calls should fail
      const internalResult = evaluateNetworkPolicy(
        { sourceServiceId: 'some-service', targetServiceId: 'web-api', isIngressRequest: false },
        store.createLookup(),
      );
      expect(internalResult.allowed).toBe(false);
    });
  });
});

// ── ServiceNetworkMetaStore ─────────────────────────────────────────────────

describe('ServiceNetworkMetaStore', () => {
  let store: ServiceNetworkMetaStore;

  beforeEach(() => {
    store = new ServiceNetworkMetaStore();
  });

  it('stores and retrieves service metadata', () => {
    store.set({ serviceId: 'svc-a', visibility: 'public', exposed: false });
    const meta = store.get('svc-a');
    expect(meta).toBeDefined();
    expect(meta!.visibility).toBe('public');
    expect(meta!.exposed).toBe(false);
  });

  it('returns undefined for unknown service', () => {
    expect(store.get('unknown')).toBeUndefined();
  });

  it('updates visibility', () => {
    store.set({ serviceId: 'svc-a', visibility: 'public', exposed: false });
    const updated = store.setVisibility('svc-a', 'private');
    expect(updated).toBe(true);
    expect(store.get('svc-a')!.visibility).toBe('private');
  });

  it('returns false when setting visibility for unknown service', () => {
    expect(store.setVisibility('unknown', 'public')).toBe(false);
  });

  it('updates exposed flag', () => {
    store.set({ serviceId: 'svc-a', visibility: 'public', exposed: false });
    store.setExposed('svc-a', true);
    expect(store.get('svc-a')!.exposed).toBe(true);
  });

  it('adds allowed sources', () => {
    store.set({ serviceId: 'svc-a', visibility: 'private', exposed: false });
    store.addAllowedSource('svc-a', 'caller-1');
    store.addAllowedSource('svc-a', 'caller-2');
    store.addAllowedSource('svc-a', 'caller-1'); // duplicate — should be idempotent

    const meta = store.get('svc-a')!;
    expect(meta.allowedSources).toEqual(['caller-1', 'caller-2']);
  });

  it('removes allowed sources', () => {
    store.set({ serviceId: 'svc-a', visibility: 'private', exposed: false, allowedSources: ['a', 'b', 'c'] });
    store.removeAllowedSource('svc-a', 'b');
    expect(store.get('svc-a')!.allowedSources).toEqual(['a', 'c']);
  });

  it('returns false when removing non-existent allowed source', () => {
    store.set({ serviceId: 'svc-a', visibility: 'private', exposed: false, allowedSources: ['a'] });
    expect(store.removeAllowedSource('svc-a', 'z')).toBe(false);
  });

  it('removes service metadata', () => {
    store.set({ serviceId: 'svc-a', visibility: 'public', exposed: false });
    expect(store.remove('svc-a')).toBe(true);
    expect(store.get('svc-a')).toBeUndefined();
    expect(store.remove('svc-a')).toBe(false);
  });

  it('lists all metadata', () => {
    store.set({ serviceId: 'a', visibility: 'public', exposed: false });
    store.set({ serviceId: 'b', visibility: 'private', exposed: true });
    const list = store.list();
    expect(list).toHaveLength(2);
  });

  it('reports size correctly', () => {
    expect(store.size).toBe(0);
    store.set({ serviceId: 'a', visibility: 'public', exposed: false });
    expect(store.size).toBe(1);
  });

  it('clears all entries', () => {
    store.set({ serviceId: 'a', visibility: 'public', exposed: false });
    store.set({ serviceId: 'b', visibility: 'private', exposed: true });
    store.clear();
    expect(store.size).toBe(0);
  });

  it('createLookup returns a working function', () => {
    store.set({ serviceId: 'my-svc', visibility: 'system', exposed: true });
    const lookup = store.createLookup();
    expect(lookup('my-svc')).toBeDefined();
    expect(lookup('my-svc')!.visibility).toBe('system');
    expect(lookup('nonexistent')).toBeUndefined();
  });
});

// ── Integration with handleRoutingRequest ───────────────────────────────────

describe('handleRoutingRequest with networkMetaLookup', () => {
  let registry: ServiceRegistry;
  let metaStore: ServiceNetworkMetaStore;

  beforeEach(() => {
    registry = new ServiceRegistry();
    metaStore = new ServiceNetworkMetaStore();
  });

  it('allows routing to a public service', () => {
    registry.register('public-svc', 'pod-1', 'node-1', 'healthy');
    metaStore.set({ serviceId: 'public-svc', visibility: 'public', exposed: false });

    const response = handleRoutingRequest(
      { callerPodId: 'pod-2', callerServiceId: 'caller-svc', targetServiceId: 'public-svc' },
      { registry, networkMetaLookup: metaStore.createLookup() },
    );

    expect(response.policyAllowed).toBe(true);
    expect(response.targetPodId).toBe('pod-1');
  });

  it('denies routing to a private service from unauthorized caller', () => {
    registry.register('private-svc', 'pod-1', 'node-1', 'healthy');
    metaStore.set({ serviceId: 'private-svc', visibility: 'private', exposed: false, allowedSources: ['allowed-svc'] });

    const response = handleRoutingRequest(
      { callerPodId: 'pod-2', callerServiceId: 'unauthorized-svc', targetServiceId: 'private-svc' },
      { registry, networkMetaLookup: metaStore.createLookup() },
    );

    expect(response.policyAllowed).toBe(false);
    expect(response.policyDeniedReason).toContain('private');
  });

  it('allows routing to a private service from authorized caller', () => {
    registry.register('private-svc', 'pod-1', 'node-1', 'healthy');
    metaStore.set({ serviceId: 'private-svc', visibility: 'private', exposed: false, allowedSources: ['allowed-svc'] });

    const response = handleRoutingRequest(
      { callerPodId: 'pod-2', callerServiceId: 'allowed-svc', targetServiceId: 'private-svc' },
      { registry, networkMetaLookup: metaStore.createLookup() },
    );

    expect(response.policyAllowed).toBe(true);
    expect(response.targetPodId).toBe('pod-1');
  });

  it('denies routing to a system service from unauthorized caller', () => {
    registry.register('system-svc', 'pod-1', 'node-1', 'healthy');
    metaStore.set({ serviceId: 'system-svc', visibility: 'system', exposed: false, allowedSources: ['orchestrator'] });

    const response = handleRoutingRequest(
      { callerPodId: 'pod-2', callerServiceId: 'user-svc', targetServiceId: 'system-svc' },
      { registry, networkMetaLookup: metaStore.createLookup() },
    );

    expect(response.policyAllowed).toBe(false);
    expect(response.policyDeniedReason).toContain('system service');
  });

  it('allows routing to a system service from authorized caller', () => {
    registry.register('system-svc', 'pod-1', 'node-1', 'healthy');
    metaStore.set({ serviceId: 'system-svc', visibility: 'system', exposed: false, allowedSources: ['orchestrator'] });

    const response = handleRoutingRequest(
      { callerPodId: 'pod-2', callerServiceId: 'orchestrator', targetServiceId: 'system-svc' },
      { registry, networkMetaLookup: metaStore.createLookup() },
    );

    expect(response.policyAllowed).toBe(true);
    expect(response.targetPodId).toBe('pod-1');
  });

  it('works without networkMetaLookup (backward compat)', () => {
    registry.register('svc', 'pod-1', 'node-1', 'healthy');

    const response = handleRoutingRequest(
      { callerPodId: 'pod-2', callerServiceId: 'caller', targetServiceId: 'svc' },
      { registry },
    );

    // No policy engine and no meta lookup → all traffic allowed
    expect(response.policyAllowed).toBe(true);
    expect(response.targetPodId).toBe('pod-1');
  });
});
