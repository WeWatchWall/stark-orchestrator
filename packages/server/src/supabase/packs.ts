/**
 * Pack CRUD Queries
 *
 * Provides database operations for pack entities using Supabase.
 * @module @stark-o/server/supabase/packs
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  Pack,
  PackMetadata,
  PackListItem,
  PackVersionSummary,
  RegisterPackInput,
  UpdatePackInput,
  RuntimeTag,
  PackNamespace,
} from '@stark-o/shared';
import { getSupabaseClient, getSupabaseServiceClient } from './client.js';

/**
 * Database row type for packs table
 */
interface PackRow {
  id: string;
  name: string;
  version: string;
  runtime_tag: RuntimeTag;
  owner_id: string;
  namespace: PackNamespace;
  visibility: 'private' | 'public';
  bundle_path: string;
  bundle_content: string | null;
  description: string | null;
  metadata: PackMetadata;
  created_at: string;
  updated_at: string;
}

/**
 * Result type for database operations
 */
export interface PackResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Converts a database row to a Pack entity
 */
function rowToPack(row: PackRow): Pack {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    runtimeTag: row.runtime_tag,
    ownerId: row.owner_id,
    namespace: row.namespace,
    visibility: row.visibility,
    bundlePath: row.bundle_path,
    bundleContent: row.bundle_content ?? undefined,
    description: row.description ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Converts a database row to a PackListItem
 */
function rowToPackListItem(row: PackRow & { version_count?: number }): PackListItem {
  return {
    id: row.id,
    name: row.name,
    latestVersion: row.version,
    runtimeTag: row.runtime_tag,
    description: row.description ?? undefined,
    versionCount: row.version_count ?? 1,
    ownerId: row.owner_id,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Converts a database row to a PackVersionSummary
 */
function rowToPackVersionSummary(row: Pick<PackRow, 'id' | 'version' | 'runtime_tag' | 'created_at'>): PackVersionSummary {
  return {
    id: row.id,
    version: row.version,
    runtimeTag: row.runtime_tag,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Pack queries class for interacting with the packs table
 */
export class PackQueries {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  /**
   * Creates a new pack in the database
   */
  async createPack(input: RegisterPackInput & { ownerId: string; bundlePath: string }): Promise<PackResult<Pack>> {
    const { data, error } = await this.client
      .from('packs')
      .insert({
        name: input.name,
        version: input.version,
        runtime_tag: input.runtimeTag,
        owner_id: input.ownerId,
        namespace: input.namespace ?? 'user',
        visibility: input.visibility ?? 'private',
        bundle_path: input.bundlePath,
        bundle_content: input.bundleContent ?? null,
        description: input.description ?? null,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPack(data as PackRow), error: null };
  }

  /**
   * Retrieves a pack by its ID
   */
  async getPackById(id: string): Promise<PackResult<Pack>> {
    const { data, error } = await this.client
      .from('packs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPack(data as PackRow), error: null };
  }

  /**
   * Retrieves a pack by name and version
   */
  async getPackByNameAndVersion(name: string, version: string): Promise<PackResult<Pack>> {
    const { data, error } = await this.client
      .from('packs')
      .select('*')
      .eq('name', name)
      .eq('version', version)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPack(data as PackRow), error: null };
  }

  /**
   * Retrieves the latest version of a pack by name
   */
  async getLatestPackVersion(name: string): Promise<PackResult<Pack>> {
    const { data, error } = await this.client
      .from('packs')
      .select('*')
      .eq('name', name)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPack(data as PackRow), error: null };
  }

  /**
   * Lists all packs with optional filtering
   */
  async listPacks(options?: {
    ownerId?: string;
    runtimeTag?: RuntimeTag;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<PackResult<PackListItem[]>> {
    // Use a subquery to get the latest version of each pack
    // Group by name and get the most recent entry
    let query = this.client
      .from('packs')
      .select('*');

    if (options?.ownerId) {
      query = query.eq('owner_id', options.ownerId);
    }

    if (options?.runtimeTag) {
      query = query.eq('runtime_tag', options.runtimeTag);
    }

    if (options?.search) {
      query = query.ilike('name', `%${options.search}%`);
    }

    query = query.order('created_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    // Group by pack name and get the latest version for each
    const packMap = new Map<string, { pack: PackRow; count: number }>();
    for (const row of data as PackRow[]) {
      const existing = packMap.get(row.name);
      if (!existing) {
        packMap.set(row.name, { pack: row, count: 1 });
      } else {
        existing.count++;
        // Keep the latest version (data is sorted by created_at DESC)
      }
    }

    const items = Array.from(packMap.values()).map(({ pack, count }) =>
      rowToPackListItem({ ...pack, version_count: count })
    );

    return { data: items, error: null };
  }

  /**
   * Lists all versions of a pack by name
   */
  async listPackVersions(name: string): Promise<PackResult<PackVersionSummary[]>> {
    const { data, error } = await this.client
      .from('packs')
      .select('id, version, runtime_tag, created_at')
      .eq('name', name)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: null, error };
    }

    const versions = (data as Pick<PackRow, 'id' | 'version' | 'runtime_tag' | 'created_at'>[]).map(rowToPackVersionSummary);
    return { data: versions, error: null };
  }

  /**
   * Updates a pack's mutable fields
   */
  async updatePack(id: string, input: UpdatePackInput): Promise<PackResult<Pack>> {
    const updates: Record<string, unknown> = {};

    if (input.description !== undefined) {
      updates.description = input.description;
    }

    if (input.visibility !== undefined) {
      updates.visibility = input.visibility;
    }

    if (input.metadata !== undefined) {
      updates.metadata = input.metadata;
    }

    if (Object.keys(updates).length === 0) {
      // No updates, just fetch and return current state
      return this.getPackById(id);
    }

    const { data, error } = await this.client
      .from('packs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPack(data as PackRow), error: null };
  }

  /**
   * Deletes a pack by ID
   */
  async deletePack(id: string): Promise<PackResult<void>> {
    const { error } = await this.client
      .from('packs')
      .delete()
      .eq('id', id);

    return { data: null, error };
  }

  /**
   * Deletes all versions of a pack by name
   */
  async deletePackByName(name: string): Promise<PackResult<{ deletedCount: number }>> {
    // First count the versions
    const { data: versions } = await this.client
      .from('packs')
      .select('id')
      .eq('name', name);

    const count = versions?.length ?? 0;

    const { error } = await this.client
      .from('packs')
      .delete()
      .eq('name', name);

    if (error) {
      return { data: null, error };
    }

    return { data: { deletedCount: count }, error: null };
  }

  /**
   * Checks if a pack name and version already exists
   */
  async packExists(name: string, version: string): Promise<PackResult<boolean>> {
    const { data, error } = await this.client
      .from('packs')
      .select('id')
      .eq('name', name)
      .eq('version', version)
      .maybeSingle();

    if (error) {
      return { data: null, error };
    }

    return { data: data !== null, error: null };
  }

  /**
   * Counts packs matching the given criteria
   */
  async countPacks(options?: {
    ownerId?: string;
    runtimeTag?: RuntimeTag;
    name?: string;
  }): Promise<PackResult<number>> {
    let query = this.client
      .from('packs')
      .select('*', { count: 'exact', head: true });

    if (options?.ownerId) {
      query = query.eq('owner_id', options.ownerId);
    }

    if (options?.runtimeTag) {
      query = query.eq('runtime_tag', options.runtimeTag);
    }

    if (options?.name) {
      query = query.eq('name', options.name);
    }

    const { count, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return { data: count ?? 0, error: null };
  }

  /**
   * Check if a node owner can access a pack.
   * A node owner can access a pack if:
   * 1. The pack is public
   * 2. The pack owner is the same as the node owner
   * 3. The node owner is an admin (admin nodes are shared infrastructure)
   * 
   * @param pack The pack to check access for
   * @param nodeOwnerId The user ID of the node owner
   * @returns True if the node owner can access the pack
   */
  async canNodeAccessPack(
    pack: { ownerId: string; visibility: 'private' | 'public' },
    nodeOwnerId: string | undefined
  ): Promise<PackResult<boolean>> {
    // Public packs are accessible to all
    if (pack.visibility === 'public') {
      return { data: true, error: null };
    }

    // If no node owner (unowned nodes are open infrastructure)
    if (!nodeOwnerId) {
      return { data: true, error: null };
    }

    // Pack owner matches node owner
    if (pack.ownerId === nodeOwnerId) {
      return { data: true, error: null };
    }

    // Check if node owner is admin (admin nodes are shared infrastructure)
    const { data, error } = await this.client
      .from('users')
      .select('roles')
      .eq('id', nodeOwnerId)
      .single();

    if (error) {
      return { data: null, error };
    }

    const roles = data?.roles as string[] | undefined;
    if (roles && roles.includes('admin')) {
      return { data: true, error: null };
    }

    return { data: false, error: null };
  }
}

/**
 * Singleton instance using the default client
 */
let _packQueries: PackQueries | null = null;

/**
 * Gets or creates the default PackQueries instance
 */
export function getPackQueries(): PackQueries {
  if (!_packQueries) {
    _packQueries = new PackQueries();
  }
  return _packQueries;
}

/**
 * Creates a PackQueries instance with service role (admin) privileges
 * Use for administrative operations that bypass RLS
 */
export function getPackQueriesAdmin(): PackQueries {
  return new PackQueries(getSupabaseServiceClient());
}

/**
 * Resets singleton instances (useful for testing)
 */
export function resetPackQueries(): void {
  _packQueries = null;
}

// Export convenience functions that use the default instance
export const createPack = (input: RegisterPackInput & { ownerId: string; bundlePath: string }) =>
  getPackQueries().createPack(input);

export const getPackById = (id: string) =>
  getPackQueries().getPackById(id);

export const getPackByNameAndVersion = (name: string, version: string) =>
  getPackQueries().getPackByNameAndVersion(name, version);

export const getLatestPackVersion = (name: string) =>
  getPackQueries().getLatestPackVersion(name);

export const listPacks = (options?: Parameters<PackQueries['listPacks']>[0]) =>
  getPackQueries().listPacks(options);

export const listPackVersions = (name: string) =>
  getPackQueries().listPackVersions(name);

export const updatePack = (id: string, input: UpdatePackInput) =>
  getPackQueries().updatePack(id, input);

export const deletePack = (id: string) =>
  getPackQueries().deletePack(id);

export const deletePackByName = (name: string) =>
  getPackQueries().deletePackByName(name);

export const packExists = (name: string, version: string) =>
  getPackQueries().packExists(name, version);

export const countPacks = (options?: Parameters<PackQueries['countPacks']>[0]) =>
  getPackQueries().countPacks(options);
