/**
 * Reactive pack registry state store using Vue reactivity
 * @module @stark-o/core/stores/pack-store
 */

import { computed, type ComputedRef } from '@vue/reactivity';
import type {
  Pack,
  RuntimeTag,
  RegisterPackInput,
  UpdatePackInput,
  PackVersionSummary,
} from '@stark-o/shared';
import { clusterState } from './cluster-store';

// ============================================================================
// Computed Properties
// ============================================================================

/**
 * Total pack count
 */
export const packCount: ComputedRef<number> = computed(() =>
  clusterState.packs.size
);

/**
 * Unique pack names (not counting versions)
 */
export const uniquePackNames: ComputedRef<Set<string>> = computed(() => {
  const names = new Set<string>();
  for (const pack of clusterState.packs.values()) {
    names.add(pack.name);
  }
  return names;
});

/**
 * Unique pack count (not counting versions)
 */
export const uniquePackCount: ComputedRef<number> = computed(() =>
  uniquePackNames.value.size
);

/**
 * Packs grouped by name
 */
export const packsByName: ComputedRef<Map<string, Pack[]>> = computed(() => {
  const grouped = new Map<string, Pack[]>();

  for (const pack of clusterState.packs.values()) {
    const list = grouped.get(pack.name) ?? [];
    list.push(pack);
    grouped.set(pack.name, list);
  }

  // Sort each group by version (newest first)
  for (const [name, packs] of grouped) {
    packs.sort((a, b) => compareVersions(b.version, a.version));
    grouped.set(name, packs);
  }

  return grouped;
});

/**
 * Packs grouped by runtime tag
 */
export const packsByRuntime: ComputedRef<Map<RuntimeTag, Pack[]>> = computed(() => {
  const grouped = new Map<RuntimeTag, Pack[]>();
  grouped.set('node', []);
  grouped.set('browser', []);
  grouped.set('universal', []);

  for (const pack of clusterState.packs.values()) {
    const list = grouped.get(pack.runtimeTag) ?? [];
    list.push(pack);
    grouped.set(pack.runtimeTag, list);
  }

  return grouped;
});

/**
 * Packs grouped by owner
 */
export const packsByOwner: ComputedRef<Map<string, Pack[]>> = computed(() => {
  const grouped = new Map<string, Pack[]>();

  for (const pack of clusterState.packs.values()) {
    const list = grouped.get(pack.ownerId) ?? [];
    list.push(pack);
    grouped.set(pack.ownerId, list);
  }

  return grouped;
});

// ============================================================================
// Actions
// ============================================================================

/**
 * Register a new pack
 */
export function registerPack(
  input: RegisterPackInput & { id?: string; ownerId: string; bundlePath: string }
): Pack {
  const now = new Date();
  const pack: Pack = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    version: input.version,
    runtimeTag: input.runtimeTag,
    ownerId: input.ownerId,
    bundlePath: input.bundlePath,
    description: input.description,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };

  clusterState.packs.set(pack.id, pack);
  return pack;
}

/**
 * Update an existing pack
 */
export function updatePack(id: string, updates: UpdatePackInput): Pack | undefined {
  const pack = clusterState.packs.get(id);
  if (!pack) return undefined;

  const updated: Pack = {
    ...pack,
    ...updates,
    metadata: updates.metadata
      ? { ...pack.metadata, ...updates.metadata }
      : pack.metadata,
    updatedAt: new Date(),
  };

  clusterState.packs.set(id, updated);
  return updated;
}

/**
 * Remove a pack from the registry
 */
export function removePack(id: string): boolean {
  return clusterState.packs.delete(id);
}

/**
 * Remove all versions of a pack by name
 */
export function removePackByName(name: string): number {
  let count = 0;
  for (const [id, pack] of clusterState.packs) {
    if (pack.name === name) {
      clusterState.packs.delete(id);
      count++;
    }
  }
  return count;
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Find pack by ID
 */
export function findPackById(id: string): Pack | undefined {
  return clusterState.packs.get(id);
}

/**
 * Find pack by name and version
 */
export function findPackByNameVersion(name: string, version: string): Pack | undefined {
  for (const pack of clusterState.packs.values()) {
    if (pack.name === name && pack.version === version) {
      return pack;
    }
  }
  return undefined;
}

/**
 * Find all versions of a pack
 */
export function findPackVersions(name: string): Pack[] {
  const packs: Pack[] = [];
  for (const pack of clusterState.packs.values()) {
    if (pack.name === name) {
      packs.push(pack);
    }
  }
  return packs.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Get version summaries for a pack
 */
export function getPackVersionSummaries(name: string): PackVersionSummary[] {
  return findPackVersions(name).map(pack => ({
    id: pack.id,
    version: pack.version,
    runtimeTag: pack.runtimeTag,
    createdAt: pack.createdAt,
  }));
}

/**
 * Get latest version of a pack
 */
export function getLatestPackVersion(name: string): Pack | undefined {
  const versions = findPackVersions(name);
  return versions[0]; // Already sorted by version, newest first
}

/**
 * Find packs by owner
 */
export function findPacksByOwner(ownerId: string): Pack[] {
  return [...clusterState.packs.values()].filter(pack => pack.ownerId === ownerId);
}

/**
 * Find packs by runtime tag
 */
export function findPacksByRuntime(runtimeTag: RuntimeTag): Pack[] {
  return [...clusterState.packs.values()].filter(pack => pack.runtimeTag === runtimeTag);
}

/**
 * Find packs compatible with a runtime type
 */
export function findPacksCompatibleWith(runtimeType: 'node' | 'browser'): Pack[] {
  return [...clusterState.packs.values()].filter(pack =>
    pack.runtimeTag === 'universal' || pack.runtimeTag === runtimeType
  );
}

/**
 * Search packs by name (partial match)
 */
export function searchPacksByName(query: string): Pack[] {
  const lowerQuery = query.toLowerCase();
  const seenNames = new Set<string>();
  const results: Pack[] = [];

  // Get latest version of each matching pack
  for (const pack of clusterState.packs.values()) {
    if (pack.name.toLowerCase().includes(lowerQuery) && !seenNames.has(pack.name)) {
      const latest = getLatestPackVersion(pack.name);
      if (latest) {
        results.push(latest);
        seenNames.add(pack.name);
      }
    }
  }

  return results;
}

/**
 * Check if a pack version exists
 */
export function packVersionExists(name: string, version: string): boolean {
  return findPackByNameVersion(name, version) !== undefined;
}

/**
 * Check if any version of a pack exists
 */
export function packExists(name: string): boolean {
  for (const pack of clusterState.packs.values()) {
    if (pack.name === name) return true;
  }
  return false;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compare semantic versions (simplified comparison)
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] ?? 0;
    const partB = partsB[i] ?? 0;

    if (partA !== partB) {
      return partA - partB;
    }
  }

  return 0;
}

/**
 * Validate semantic version format
 */
export function isValidVersion(version: string): boolean {
  const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
  return semverRegex.test(version);
}

/**
 * Get next patch version
 */
export function getNextPatchVersion(version: string): string {
  const parts = version.split('.');
  const patch = parseInt(parts[2]?.split('-')[0] ?? '0', 10) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

/**
 * Get next minor version
 */
export function getNextMinorVersion(version: string): string {
  const parts = version.split('.');
  const minor = parseInt(parts[1] ?? '0', 10) + 1;
  return `${parts[0]}.${minor}.0`;
}

/**
 * Get next major version
 */
export function getNextMajorVersion(version: string): string {
  const parts = version.split('.');
  const major = parseInt(parts[0] ?? '0', 10) + 1;
  return `${major}.0.0`;
}
