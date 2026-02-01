/**
 * Namespace CRUD Queries
 *
 * Provides database operations for namespace entities using Supabase.
 * @module @stark-o/server/supabase/namespaces
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  Namespace,
  NamespacePhase,
  NamespaceListItem,
  CreateNamespaceInput,
  UpdateNamespaceInput,
  ResourceQuota,
  LimitRange,
  ResourceUsage,
  Labels,
  Annotations,
} from '@stark-o/shared';
import { DEFAULT_RESOURCE_USAGE } from '@stark-o/shared';
import { getSupabaseClient, getSupabaseServiceClient } from './client.js';

/**
 * Database row type for namespaces table
 */
interface NamespaceRow {
  id: string;
  name: string;
  phase: NamespacePhase;
  labels: Labels;
  annotations: Annotations;
  resource_quota: ResourceQuota | null;
  limit_range: LimitRange | null;
  resource_usage: ResourceUsage;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Result type for database operations
 */
export interface NamespaceResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Namespace query options for listing
 */
export interface ListNamespacesOptions {
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by phase */
  phase?: NamespacePhase;
  /** Search by name */
  search?: string;
}

/**
 * Converts a database row to a Namespace entity
 */
function rowToNamespace(row: NamespaceRow): Namespace {
  return {
    id: row.id,
    name: row.name,
    phase: row.phase,
    labels: row.labels ?? {},
    annotations: row.annotations ?? {},
    resourceQuota: row.resource_quota ?? undefined,
    limitRange: row.limit_range ?? undefined,
    resourceUsage: row.resource_usage ?? DEFAULT_RESOURCE_USAGE,
    createdBy: row.created_by ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Converts a database row to a NamespaceListItem
 */
function rowToNamespaceListItem(row: NamespaceRow): NamespaceListItem {
  return {
    id: row.id,
    name: row.name,
    phase: row.phase,
    labels: row.labels ?? {},
    resourceUsage: row.resource_usage ?? DEFAULT_RESOURCE_USAGE,
    hasQuota: row.resource_quota !== null,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Namespace queries class for interacting with the namespaces table
 */
export class NamespaceQueries {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  /**
   * Creates a new namespace in the database
   */
  async createNamespace(
    input: CreateNamespaceInput & { createdBy?: string }
  ): Promise<NamespaceResult<Namespace>> {
    const { data, error } = await this.client
      .from('namespaces')
      .insert({
        name: input.name,
        phase: 'active' as NamespacePhase,
        labels: input.labels ?? {},
        annotations: input.annotations ?? {},
        resource_quota: input.resourceQuota ?? null,
        limit_range: input.limitRange ?? null,
        resource_usage: DEFAULT_RESOURCE_USAGE,
        created_by: input.createdBy ?? null,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNamespace(data as NamespaceRow), error: null };
  }

  /**
   * Retrieves a namespace by its ID
   */
  async getNamespaceById(id: string): Promise<NamespaceResult<Namespace>> {
    const { data, error } = await this.client
      .from('namespaces')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNamespace(data as NamespaceRow), error: null };
  }

  /**
   * Retrieves a namespace by name
   */
  async getNamespaceByName(name: string): Promise<NamespaceResult<Namespace>> {
    const { data, error } = await this.client
      .from('namespaces')
      .select('*')
      .eq('name', name)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNamespace(data as NamespaceRow), error: null };
  }

  /**
   * Check if a namespace with the given name exists
   */
  async namespaceExists(name: string): Promise<NamespaceResult<boolean>> {
    const { count, error } = await this.client
      .from('namespaces')
      .select('id', { count: 'exact', head: true })
      .eq('name', name);

    if (error) {
      return { data: null, error };
    }

    return { data: (count ?? 0) > 0, error: null };
  }

  /**
   * Lists all namespaces with optional filtering
   */
  async listNamespaces(options?: ListNamespacesOptions): Promise<NamespaceResult<Namespace[]>> {
    let query = this.client
      .from('namespaces')
      .select('*')
      .order('name', { ascending: true });

    if (options?.phase) {
      query = query.eq('phase', options.phase);
    }

    if (options?.search) {
      query = query.ilike('name', `%${options.search}%`);
    }

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

    return { data: (data as NamespaceRow[]).map(rowToNamespace), error: null };
  }

  /**
   * Lists namespaces as list items (summary format)
   */
  async listNamespaceItems(options?: ListNamespacesOptions): Promise<NamespaceResult<NamespaceListItem[]>> {
    let query = this.client
      .from('namespaces')
      .select('id, name, phase, labels, resource_quota, resource_usage, created_at')
      .order('name', { ascending: true });

    if (options?.phase) {
      query = query.eq('phase', options.phase);
    }

    if (options?.search) {
      query = query.ilike('name', `%${options.search}%`);
    }

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

    return { data: (data as NamespaceRow[]).map(rowToNamespaceListItem), error: null };
  }

  /**
   * Counts namespaces with optional filtering
   */
  async countNamespaces(options?: Pick<ListNamespacesOptions, 'phase' | 'search'>): Promise<NamespaceResult<number>> {
    let query = this.client
      .from('namespaces')
      .select('*', { count: 'exact', head: true });

    if (options?.phase) {
      query = query.eq('phase', options.phase);
    }

    if (options?.search) {
      query = query.ilike('name', `%${options.search}%`);
    }

    const { count, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return { data: count ?? 0, error: null };
  }

  /**
   * Updates a namespace by ID
   */
  async updateNamespace(id: string, input: UpdateNamespaceInput): Promise<NamespaceResult<Namespace>> {
    const updates: Partial<Record<string, unknown>> = {};

    if (input.labels !== undefined) {
      updates.labels = input.labels;
    }
    if (input.annotations !== undefined) {
      updates.annotations = input.annotations;
    }
    if (input.resourceQuota !== undefined) {
      updates.resource_quota = input.resourceQuota;
    }
    if (input.limitRange !== undefined) {
      updates.limit_range = input.limitRange;
    }

    if (Object.keys(updates).length === 0) {
      // No updates, just return current namespace
      return this.getNamespaceById(id);
    }

    const { data, error } = await this.client
      .from('namespaces')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNamespace(data as NamespaceRow), error: null };
  }

  /**
   * Updates namespace resource usage
   */
  async updateResourceUsage(id: string, usage: ResourceUsage): Promise<NamespaceResult<Namespace>> {
    const { data, error } = await this.client
      .from('namespaces')
      .update({ resource_usage: usage })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNamespace(data as NamespaceRow), error: null };
  }

  /**
   * Marks a namespace for deletion (sets phase to 'terminating')
   */
  async markForDeletion(id: string): Promise<NamespaceResult<Namespace>> {
    const { data, error } = await this.client
      .from('namespaces')
      .update({ phase: 'terminating' as NamespacePhase })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNamespace(data as NamespaceRow), error: null };
  }

  /**
   * Deletes a namespace by ID
   * Note: Should only be called after all resources in the namespace are cleaned up
   */
  async deleteNamespace(id: string): Promise<NamespaceResult<boolean>> {
    const { error } = await this.client
      .from('namespaces')
      .delete()
      .eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: true, error: null };
  }

  /**
   * Deletes a namespace by name
   * Note: Should only be called after all resources in the namespace are cleaned up
   */
  async deleteNamespaceByName(name: string): Promise<NamespaceResult<boolean>> {
    const { error } = await this.client
      .from('namespaces')
      .delete()
      .eq('name', name);

    if (error) {
      return { data: null, error };
    }

    return { data: true, error: null };
  }

  /**
   * Gets all active namespaces (phase = 'active')
   */
  async getActiveNamespaces(): Promise<NamespaceResult<Namespace[]>> {
    return this.listNamespaces({ phase: 'active' });
  }

  /**
   * Gets namespace quota and usage for quota enforcement
   */
  async getNamespaceQuotaInfo(name: string): Promise<NamespaceResult<{
    resourceQuota: ResourceQuota | undefined;
    resourceUsage: ResourceUsage;
    limitRange: LimitRange | undefined;
  }>> {
    const { data, error } = await this.client
      .from('namespaces')
      .select('resource_quota, resource_usage, limit_range')
      .eq('name', name)
      .single();

    if (error) {
      return { data: null, error };
    }

    const row = data as Pick<NamespaceRow, 'resource_quota' | 'resource_usage' | 'limit_range'>;
    return {
      data: {
        resourceQuota: row.resource_quota ?? undefined,
        resourceUsage: row.resource_usage ?? DEFAULT_RESOURCE_USAGE,
        limitRange: row.limit_range ?? undefined,
      },
      error: null,
    };
  }

  /**
   * Increments namespace resource usage
   * Used when a pod is created in the namespace
   */
  async incrementResourceUsage(
    name: string,
    delta: Partial<ResourceUsage>
  ): Promise<NamespaceResult<Namespace>> {
    // Get current usage
    const { data: current, error: getError } = await this.getNamespaceByName(name);
    if (getError || !current) {
      return { data: null, error: getError };
    }

    const newUsage: ResourceUsage = {
      pods: current.resourceUsage.pods + (delta.pods ?? 0),
      cpu: current.resourceUsage.cpu + (delta.cpu ?? 0),
      memory: current.resourceUsage.memory + (delta.memory ?? 0),
      storage: current.resourceUsage.storage + (delta.storage ?? 0),
    };

    return this.updateResourceUsage(current.id, newUsage);
  }

  /**
   * Decrements namespace resource usage
   * Used when a pod is deleted from the namespace
   */
  async decrementResourceUsage(
    name: string,
    delta: Partial<ResourceUsage>
  ): Promise<NamespaceResult<Namespace>> {
    // Get current usage
    const { data: current, error: getError } = await this.getNamespaceByName(name);
    if (getError || !current) {
      return { data: null, error: getError };
    }

    const newUsage: ResourceUsage = {
      pods: Math.max(0, current.resourceUsage.pods - (delta.pods ?? 0)),
      cpu: Math.max(0, current.resourceUsage.cpu - (delta.cpu ?? 0)),
      memory: Math.max(0, current.resourceUsage.memory - (delta.memory ?? 0)),
      storage: Math.max(0, current.resourceUsage.storage - (delta.storage ?? 0)),
    };

    return this.updateResourceUsage(current.id, newUsage);
  }
}

// Singleton instances
let _namespaceQueries: NamespaceQueries | null = null;
let _namespaceQueriesAdmin: NamespaceQueries | null = null;

/**
 * Gets or creates a NamespaceQueries instance with anon key
 */
export function getNamespaceQueries(): NamespaceQueries {
  if (!_namespaceQueries) {
    _namespaceQueries = new NamespaceQueries(getSupabaseClient());
  }
  return _namespaceQueries;
}

/**
 * Gets or creates a NamespaceQueries instance with service role key
 */
export function getNamespaceQueriesAdmin(): NamespaceQueries {
  if (!_namespaceQueriesAdmin) {
    _namespaceQueriesAdmin = new NamespaceQueries(getSupabaseServiceClient());
  }
  return _namespaceQueriesAdmin;
}

/**
 * Resets singleton instances (for testing)
 */
export function resetNamespaceQueries(): void {
  _namespaceQueries = null;
  _namespaceQueriesAdmin = null;
}

// ============================================================================
// Convenience functions for common operations
// ============================================================================

/**
 * Creates a new namespace using the service role client
 */
export async function createNamespace(
  input: CreateNamespaceInput & { createdBy?: string }
): Promise<NamespaceResult<Namespace>> {
  return getNamespaceQueriesAdmin().createNamespace(input);
}

/**
 * Gets a namespace by ID
 */
export async function getNamespaceById(id: string): Promise<NamespaceResult<Namespace>> {
  return getNamespaceQueries().getNamespaceById(id);
}

/**
 * Gets a namespace by name
 */
export async function getNamespaceByName(name: string): Promise<NamespaceResult<Namespace>> {
  return getNamespaceQueries().getNamespaceByName(name);
}

/**
 * Lists all namespaces
 */
export async function listNamespaces(
  options?: ListNamespacesOptions
): Promise<NamespaceResult<Namespace[]>> {
  return getNamespaceQueries().listNamespaces(options);
}

/**
 * Lists namespaces as list items
 */
export async function listNamespaceItems(
  options?: ListNamespacesOptions
): Promise<NamespaceResult<NamespaceListItem[]>> {
  return getNamespaceQueries().listNamespaceItems(options);
}

/**
 * Counts namespaces
 */
export async function countNamespaces(
  options?: Pick<ListNamespacesOptions, 'phase' | 'search'>
): Promise<NamespaceResult<number>> {
  return getNamespaceQueries().countNamespaces(options);
}

/**
 * Updates a namespace
 */
export async function updateNamespace(
  id: string,
  input: UpdateNamespaceInput
): Promise<NamespaceResult<Namespace>> {
  return getNamespaceQueriesAdmin().updateNamespace(id, input);
}

/**
 * Deletes a namespace by ID
 */
export async function deleteNamespace(id: string): Promise<NamespaceResult<boolean>> {
  return getNamespaceQueriesAdmin().deleteNamespace(id);
}

/**
 * Deletes a namespace by name
 */
export async function deleteNamespaceByName(name: string): Promise<NamespaceResult<boolean>> {
  return getNamespaceQueriesAdmin().deleteNamespaceByName(name);
}

/**
 * Checks if a namespace exists
 */
export async function namespaceExists(name: string): Promise<NamespaceResult<boolean>> {
  return getNamespaceQueries().namespaceExists(name);
}

/**
 * Gets namespace quota info for enforcement
 */
export async function getNamespaceQuotaInfo(name: string): Promise<NamespaceResult<{
  resourceQuota: ResourceQuota | undefined;
  resourceUsage: ResourceUsage;
  limitRange: LimitRange | undefined;
}>> {
  return getNamespaceQueries().getNamespaceQuotaInfo(name);
}

/**
 * Increments namespace resource usage
 */
export async function incrementNamespaceUsage(
  name: string,
  delta: Partial<ResourceUsage>
): Promise<NamespaceResult<Namespace>> {
  return getNamespaceQueriesAdmin().incrementResourceUsage(name, delta);
}

/**
 * Decrements namespace resource usage
 */
export async function decrementNamespaceUsage(
  name: string,
  delta: Partial<ResourceUsage>
): Promise<NamespaceResult<Namespace>> {
  return getNamespaceQueriesAdmin().decrementResourceUsage(name, delta);
}

/**
 * Marks a namespace for deletion
 */
export async function markNamespaceForDeletion(id: string): Promise<NamespaceResult<Namespace>> {
  return getNamespaceQueriesAdmin().markForDeletion(id);
}
