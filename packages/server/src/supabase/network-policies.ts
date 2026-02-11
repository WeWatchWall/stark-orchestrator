/**
 * Network Policies CRUD Queries
 *
 * Provides database operations for network policy entities using Supabase.
 * @module @stark-o/server/supabase/network-policies
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type { NetworkPolicy, CreateNetworkPolicyInput, NetworkPolicyAction } from '@stark-o/shared';
import { getSupabaseServiceClient } from './client.js';

/**
 * Database row type for network_policies table
 */
interface NetworkPolicyRow {
  id: string;
  source_service: string;
  target_service: string;
  action: NetworkPolicyAction;
  namespace: string;
  created_at: string;
  updated_at: string;
}

/**
 * Result type for database operations
 */
export interface NetworkPolicyResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Converts a database row to a NetworkPolicy entity
 */
function rowToNetworkPolicy(row: NetworkPolicyRow): NetworkPolicy {
  return {
    id: row.id,
    sourceService: row.source_service,
    targetService: row.target_service,
    action: row.action,
    namespace: row.namespace ?? 'default',
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * Network policy queries using service role (server-side)
 */
export class NetworkPolicyQueries {
  constructor(private client: SupabaseClient) {}

  /**
   * Create a new network policy
   * If a policy exists for the same source->target pair, it is replaced (upsert)
   */
  async createPolicy(input: CreateNetworkPolicyInput): Promise<NetworkPolicyResult<NetworkPolicy>> {
    const { data, error } = await this.client
      .from('network_policies')
      .upsert(
        {
          source_service: input.sourceService,
          target_service: input.targetService,
          action: input.action,
          namespace: input.namespace ?? 'default',
        },
        {
          onConflict: 'source_service,target_service,namespace',
        }
      )
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNetworkPolicy(data as NetworkPolicyRow), error: null };
  }

  /**
   * Get policy by ID
   */
  async getPolicyById(id: string): Promise<NetworkPolicyResult<NetworkPolicy>> {
    const { data, error } = await this.client
      .from('network_policies')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNetworkPolicy(data as NetworkPolicyRow), error: null };
  }

  /**
   * Get policy by source and target service pair
   */
  async getPolicyByPair(
    sourceService: string,
    targetService: string
  ): Promise<NetworkPolicyResult<NetworkPolicy>> {
    const { data, error } = await this.client
      .from('network_policies')
      .select('*')
      .eq('source_service', sourceService)
      .eq('target_service', targetService)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNetworkPolicy(data as NetworkPolicyRow), error: null };
  }

  /**
   * List all network policies
   */
  async listPolicies(): Promise<NetworkPolicyResult<NetworkPolicy[]>> {
    const { data, error } = await this.client
      .from('network_policies')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as NetworkPolicyRow[]).map(rowToNetworkPolicy),
      error: null,
    };
  }

  /**
   * Delete policy by ID
   */
  async deletePolicy(id: string): Promise<NetworkPolicyResult<{ deleted: boolean }>> {
    const { error, count } = await this.client
      .from('network_policies')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: (count ?? 0) > 0 }, error: null };
  }

  /**
   * Delete policy by source and target service pair
   */
  async deletePolicyByPair(
    sourceService: string,
    targetService: string,
    namespace: string = 'default'
  ): Promise<NetworkPolicyResult<{ deleted: boolean }>> {
    const { error, count } = await this.client
      .from('network_policies')
      .delete({ count: 'exact' })
      .eq('source_service', sourceService)
      .eq('target_service', targetService)
      .eq('namespace', namespace);

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: (count ?? 0) > 0 }, error: null };
  }

  /**
   * Delete all policies (useful for testing)
   */
  async deleteAllPolicies(): Promise<NetworkPolicyResult<{ deleted: number }>> {
    const { error, count } = await this.client
      .from('network_policies')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: count ?? 0 }, error: null };
  }
}

// ── Singleton Instance ──────────────────────────────────────────────────────

let _queriesInstance: NetworkPolicyQueries | null = null;

/**
 * Get the singleton NetworkPolicyQueries instance using service role
 */
export function getNetworkPolicyQueries(): NetworkPolicyQueries {
  if (!_queriesInstance) {
    _queriesInstance = new NetworkPolicyQueries(getSupabaseServiceClient());
  }
  return _queriesInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetNetworkPolicyQueries(): void {
  _queriesInstance = null;
}

// ── Convenience Functions ───────────────────────────────────────────────────

/**
 * Create a network policy
 */
export async function createNetworkPolicy(
  input: CreateNetworkPolicyInput
): Promise<NetworkPolicyResult<NetworkPolicy>> {
  return getNetworkPolicyQueries().createPolicy(input);
}

/**
 * Get a network policy by ID
 */
export async function getNetworkPolicyById(
  id: string
): Promise<NetworkPolicyResult<NetworkPolicy>> {
  return getNetworkPolicyQueries().getPolicyById(id);
}

/**
 * Get a network policy by source and target service pair
 */
export async function getNetworkPolicyByPair(
  sourceService: string,
  targetService: string
): Promise<NetworkPolicyResult<NetworkPolicy>> {
  return getNetworkPolicyQueries().getPolicyByPair(sourceService, targetService);
}

/**
 * List all network policies
 */
export async function listNetworkPolicies(): Promise<NetworkPolicyResult<NetworkPolicy[]>> {
  return getNetworkPolicyQueries().listPolicies();
}

/**
 * Delete a network policy by ID
 */
export async function deleteNetworkPolicy(
  id: string
): Promise<NetworkPolicyResult<{ deleted: boolean }>> {
  return getNetworkPolicyQueries().deletePolicy(id);
}

/**
 * Delete a network policy by source and target service pair
 */
export async function deleteNetworkPolicyByPair(
  sourceService: string,
  targetService: string,
  namespace: string = 'default'
): Promise<NetworkPolicyResult<{ deleted: boolean }>> {
  return getNetworkPolicyQueries().deletePolicyByPair(sourceService, targetService, namespace);
}

/**
 * Load all network policies from the database
 * Returns an array of NetworkPolicy objects for syncing to the in-memory engine
 */
export async function loadAllNetworkPolicies(): Promise<NetworkPolicy[]> {
  const result = await listNetworkPolicies();
  if (result.error) {
    throw new Error(`Failed to load network policies: ${result.error.message}`);
  }
  return result.data ?? [];
}
