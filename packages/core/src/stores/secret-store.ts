/**
 * Reactive secret store using Vue reactivity
 *
 * Secrets are stored in a dedicated Map, separate from the cluster state,
 * to enforce isolation. The store never exposes decrypted data — only
 * encrypted blobs and metadata.
 *
 * @module @stark-o/core/stores/secret-store
 */

import { reactive, computed, type ComputedRef } from '@vue/reactivity';
import type {
  Secret,
  SecretType,
  SecretListItem,
} from '@stark-o/shared';

// ============================================================================
// Internal State
// ============================================================================

/**
 * Secret state — deliberately NOT part of clusterState to prevent
 * accidental serialization or exposure via cluster snapshots.
 */
interface SecretState {
  /** All secrets by ID */
  secrets: Map<string, Secret>;
}

const secretState: SecretState = reactive<SecretState>({
  secrets: new Map(),
});

// ============================================================================
// Computed Properties
// ============================================================================

/** Total secret count */
export const secretCount: ComputedRef<number> = computed(() =>
  secretState.secrets.size,
);

/** All secrets as a list (metadata only — encrypted data is present but opaque) */
export const secretsList: ComputedRef<Secret[]> = computed(() =>
  [...secretState.secrets.values()],
);

/** Secrets grouped by namespace */
export const secretsByNamespace: ComputedRef<Map<string, Secret[]>> = computed(() => {
  const grouped = new Map<string, Secret[]>();
  for (const secret of secretState.secrets.values()) {
    const list = grouped.get(secret.namespace) ?? [];
    list.push(secret);
    grouped.set(secret.namespace, list);
  }
  return grouped;
});

/** Secrets grouped by type */
export const secretsByType: ComputedRef<Map<SecretType, Secret[]>> = computed(() => {
  const grouped = new Map<SecretType, Secret[]>();
  for (const secret of secretState.secrets.values()) {
    const list = grouped.get(secret.type) ?? [];
    list.push(secret);
    grouped.set(secret.type, list);
  }
  return grouped;
});

// ============================================================================
// Actions
// ============================================================================

/**
 * Add a secret to the store.
 * The secret must already be encrypted before calling this.
 */
export function addSecret(secret: Secret): void {
  secretState.secrets.set(secret.id, secret);
}

/**
 * Update a secret in the store.
 * Replaces the existing secret entirely (new encrypted data, bumped version).
 */
export function updateSecret(id: string, updates: Partial<Secret>): Secret | null {
  const existing = secretState.secrets.get(id);
  if (!existing) return null;

  const updated = { ...existing, ...updates, updatedAt: new Date() };
  secretState.secrets.set(id, updated);
  return updated;
}

/**
 * Remove a secret from the store by ID.
 * Returns the removed secret (for cleanup) or null.
 */
export function removeSecret(id: string): Secret | null {
  const secret = secretState.secrets.get(id);
  if (!secret) return null;
  secretState.secrets.delete(id);
  return secret;
}

/**
 * Remove a secret from the store by name and namespace.
 */
export function removeSecretByName(name: string, namespace: string = 'default'): Secret | null {
  const secret = findSecretByName(name, namespace);
  if (!secret) return null;
  secretState.secrets.delete(secret.id);
  return secret;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Find a secret by ID
 */
export function findSecretById(id: string): Secret | null {
  return secretState.secrets.get(id) ?? null;
}

/**
 * Find a secret by name within a namespace
 */
export function findSecretByName(name: string, namespace: string = 'default'): Secret | null {
  for (const secret of secretState.secrets.values()) {
    if (secret.name === name && secret.namespace === namespace) {
      return secret;
    }
  }
  return null;
}

/**
 * Find all secrets by namespace
 */
export function findSecretsByNamespace(namespace: string): Secret[] {
  return [...secretState.secrets.values()].filter(s => s.namespace === namespace);
}

/**
 * Find all secrets by type
 */
export function findSecretsByType(type: SecretType): Secret[] {
  return [...secretState.secrets.values()].filter(s => s.type === type);
}

/**
 * Check if a secret exists by name and namespace
 */
export function secretExists(name: string, namespace: string = 'default'): boolean {
  return findSecretByName(name, namespace) !== null;
}

/**
 * Resolve multiple secret names to their Secret objects.
 * Returns only found secrets and a list of missing names.
 */
export function resolveSecretNames(
  names: string[],
  namespace: string = 'default',
): { found: Secret[]; missing: string[] } {
  const found: Secret[] = [];
  const missing: string[] = [];

  for (const name of names) {
    const secret = findSecretByName(name, namespace);
    if (secret) {
      found.push(secret);
    } else {
      missing.push(name);
    }
  }

  return { found, missing };
}

/**
 * Get a safe listing view (no encrypted data exposed)
 */
export function getSecretListItems(namespace?: string): SecretListItem[] {
  const secrets = namespace
    ? findSecretsByNamespace(namespace)
    : [...secretState.secrets.values()];

  return secrets.map(toSecretListItem);
}

/**
 * Convert a Secret to a SecretListItem (safe for API responses)
 */
export function toSecretListItem(secret: Secret): SecretListItem {
  // Count keys by decoding the injection config (key count is not sensitive)
  // We infer keyCount from the injection config mappings when possible,
  // otherwise we store it separately. For now we use a sentinel.
  return {
    id: secret.id,
    name: secret.name,
    namespace: secret.namespace,
    type: secret.type,
    injection: secret.injection,
    keyCount: 0, // Will be set by the manager which has access to decrypt
    version: secret.version,
    createdBy: secret.createdBy,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}

/**
 * Reset all secret state (for testing)
 */
export function resetSecretStore(): void {
  secretState.secrets.clear();
}
