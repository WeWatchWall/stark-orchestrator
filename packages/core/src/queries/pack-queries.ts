/**
 * Pack Query Functions
 *
 * Provides query functions for packs that can be used by chaos scenarios
 * and other services. These wrap the reactive store functions.
 * @module @stark-o/core/queries/pack-queries
 */

import {
  findPackById,
  findPackByNameVersion,
  findPackVersions,
  getPackVersionSummaries,
  getLatestPackVersion,
  findPacksByOwner,
  findPacksByRuntime,
  findPacksCompatibleWith,
  searchPacksByName,
  packVersionExists,
  packExists,
} from '../stores/pack-store';
import { packsList } from '../stores/cluster-store';
import type { Pack, RuntimeTag } from '@stark-o/shared';

/**
 * Get a pack by ID
 */
export async function getPackById(packId: string): Promise<Pack | undefined> {
  return findPackById(packId);
}

/**
 * List packs with optional filters
 */
export async function listPacks(options?: {
  limit?: number;
  ownerId?: string;
  runtime?: string;
}): Promise<Pack[]> {
  let packs = packsList.value;

  if (options?.ownerId) {
    packs = packs.filter((p: Pack) => p.ownerId === options.ownerId);
  }

  if (options?.runtime) {
    packs = packs.filter((p: Pack) => p.runtimeTag === options.runtime);
  }

  if (options?.limit) {
    packs = packs.slice(0, options.limit);
  }

  return packs;
}

/**
 * Find pack by name and version
 */
export async function findByNameVersion(
  name: string,
  version: string
): Promise<Pack | undefined> {
  return findPackByNameVersion(name, version);
}

/**
 * Get all versions of a pack
 */
export async function getVersions(packName: string): Promise<Pack[]> {
  return findPackVersions(packName);
}

/**
 * Get version summaries for a pack
 */
export async function getVersionSummaries(
  packName: string
): Promise<Array<{ id: string; version: string; createdAt: Date }>> {
  return getPackVersionSummaries(packName);
}

/**
 * Get the latest version of a pack
 */
export async function getLatestVersion(packName: string): Promise<Pack | undefined> {
  return getLatestPackVersion(packName);
}

/**
 * Find packs by owner
 */
export async function findByOwner(ownerId: string): Promise<Pack[]> {
  return findPacksByOwner(ownerId);
}

/**
 * Find packs by runtime
 */
export async function findPacksByRuntimeTag(runtime: RuntimeTag): Promise<Pack[]> {
  return findPacksByRuntime(runtime);
}

/**
 * Find packs compatible with a runtime type
 */
export async function findCompatibleWith(runtimeType: 'node' | 'browser'): Promise<Pack[]> {
  return findPacksCompatibleWith(runtimeType);
}

/**
 * Search packs by name
 */
export async function searchByName(query: string): Promise<Pack[]> {
  return searchPacksByName(query);
}

/**
 * Check if a pack version exists
 */
export async function versionExists(name: string, version: string): Promise<boolean> {
  return packVersionExists(name, version);
}

/**
 * Check if a pack exists
 */
export async function exists(name: string): Promise<boolean> {
  return packExists(name);
}

/**
 * Consolidated pack queries export
 */
export const packQueries = {
  getPackById,
  listPacks,
  findByNameVersion,
  getVersions,
  getVersionSummaries,
  getLatestVersion,
  findByOwner,
  findByRuntime: findPacksByRuntimeTag,
  findCompatibleWith,
  searchByName,
  versionExists,
  exists,
};
