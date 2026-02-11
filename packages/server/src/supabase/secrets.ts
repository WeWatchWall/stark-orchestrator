/**
 * Secret CRUD Queries
 *
 * Provides database operations for secret entities using Supabase.
 * Secret data is stored encrypted — this module never decrypts.
 * @module @stark-o/server/supabase/secrets
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  Secret,
  SecretType,
  SecretInjection,
  SecretListItem,
} from '@stark-o/shared';
import { getSupabaseServiceClient } from './client.js';

// ── Row Type ────────────────────────────────────────────────────────────────

/**
 * Database row type for the secrets table (snake_case)
 */
interface SecretRow {
  id: string;
  name: string;
  namespace: string;
  type: SecretType;
  encrypted_data: string;
  iv: string;
  auth_tag: string;
  injection: SecretInjection;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Result Type ─────────────────────────────────────────────────────────────

/**
 * Result type for database operations
 */
export interface SecretResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

// ── Row Mapping ─────────────────────────────────────────────────────────────

/**
 * Converts a database row (snake_case) to a Secret entity (camelCase)
 */
function rowToSecret(row: SecretRow): Secret {
  return {
    id: row.id,
    name: row.name,
    namespace: row.namespace,
    type: row.type,
    encryptedData: row.encrypted_data,
    iv: row.iv,
    authTag: row.auth_tag,
    injection: row.injection,
    version: row.version,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Converts a database row to a SecretListItem (no encrypted data)
 */
function rowToListItem(row: SecretRow): SecretListItem {
  return {
    id: row.id,
    name: row.name,
    namespace: row.namespace,
    type: row.type,
    injection: row.injection,
    keyCount: 0, // Cannot determine from encrypted data
    version: row.version,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ── Input Type ──────────────────────────────────────────────────────────────

/**
 * Input for creating a secret in the database.
 * Data must already be encrypted before calling this.
 */
export interface CreateSecretDbInput {
  name: string;
  namespace: string;
  type: SecretType;
  encryptedData: string;
  iv: string;
  authTag: string;
  injection: SecretInjection;
  createdBy: string;
}

/**
 * Input for updating a secret in the database.
 */
export interface UpdateSecretDbInput {
  encryptedData?: string;
  iv?: string;
  authTag?: string;
  injection?: SecretInjection;
  version?: number;
}

// ── Query Class ─────────────────────────────────────────────────────────────

/**
 * Secret queries using service role (server-side)
 */
export class SecretQueries {
  constructor(private client: SupabaseClient) {}

  /**
   * Create a new secret (data must already be encrypted)
   */
  async createSecret(input: CreateSecretDbInput): Promise<SecretResult<Secret>> {
    const { data, error } = await this.client
      .from('secrets')
      .insert({
        name: input.name,
        namespace: input.namespace,
        type: input.type,
        encrypted_data: input.encryptedData,
        iv: input.iv,
        auth_tag: input.authTag,
        injection: input.injection,
        created_by: input.createdBy,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToSecret(data as SecretRow), error: null };
  }

  /**
   * Get a secret by ID
   */
  async getSecretById(id: string): Promise<SecretResult<Secret>> {
    const { data, error } = await this.client
      .from('secrets')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToSecret(data as SecretRow), error: null };
  }

  /**
   * Get a secret by name and namespace
   */
  async getSecretByName(
    name: string,
    namespace: string = 'default'
  ): Promise<SecretResult<Secret>> {
    const { data, error } = await this.client
      .from('secrets')
      .select('*')
      .eq('name', name)
      .eq('namespace', namespace)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToSecret(data as SecretRow), error: null };
  }

  /**
   * List all secrets (returns list items without encrypted data fields exposed)
   */
  async listSecrets(filters?: {
    namespace?: string;
    type?: SecretType;
  }): Promise<SecretResult<SecretListItem[]>> {
    let query = this.client
      .from('secrets')
      .select('*')
      .order('created_at', { ascending: true });

    if (filters?.namespace) {
      query = query.eq('namespace', filters.namespace);
    }
    if (filters?.type) {
      query = query.eq('type', filters.type);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as SecretRow[]).map(rowToListItem),
      error: null,
    };
  }

  /**
   * Update a secret (data must already be encrypted if changing)
   */
  async updateSecret(
    id: string,
    input: UpdateSecretDbInput
  ): Promise<SecretResult<Secret>> {
    const updates: Record<string, unknown> = {};

    if (input.encryptedData !== undefined) {
      updates.encrypted_data = input.encryptedData;
    }
    if (input.iv !== undefined) {
      updates.iv = input.iv;
    }
    if (input.authTag !== undefined) {
      updates.auth_tag = input.authTag;
    }
    if (input.injection !== undefined) {
      updates.injection = input.injection;
    }
    if (input.version !== undefined) {
      updates.version = input.version;
    }

    const { data, error } = await this.client
      .from('secrets')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToSecret(data as SecretRow), error: null };
  }

  /**
   * Delete a secret by ID
   */
  async deleteSecret(id: string): Promise<SecretResult<{ deleted: boolean }>> {
    const { error, count } = await this.client
      .from('secrets')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: (count ?? 0) > 0 }, error: null };
  }

  /**
   * Delete a secret by name and namespace
   */
  async deleteSecretByName(
    name: string,
    namespace: string = 'default'
  ): Promise<SecretResult<{ deleted: boolean }>> {
    const { error, count } = await this.client
      .from('secrets')
      .delete({ count: 'exact' })
      .eq('name', name)
      .eq('namespace', namespace);

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: (count ?? 0) > 0 }, error: null };
  }

  /**
   * Check if a secret exists by name and namespace
   */
  async secretExists(
    name: string,
    namespace: string = 'default'
  ): Promise<boolean> {
    const { count } = await this.client
      .from('secrets')
      .select('id', { count: 'exact', head: true })
      .eq('name', name)
      .eq('namespace', namespace);

    return (count ?? 0) > 0;
  }

  /**
   * List secrets by namespace (returns full Secret objects for server-side resolution)
   */
  async getSecretsByNamespace(namespace: string): Promise<SecretResult<Secret[]>> {
    const { data, error } = await this.client
      .from('secrets')
      .select('*')
      .eq('namespace', namespace)
      .order('name', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as SecretRow[]).map(rowToSecret),
      error: null,
    };
  }

  /**
   * Resolve multiple secrets by name for pod injection.
   * Returns full Secret objects (with encrypted data) for decryption.
   */
  async resolveSecretsByNames(
    names: string[],
    namespace: string = 'default'
  ): Promise<SecretResult<Secret[]>> {
    const { data, error } = await this.client
      .from('secrets')
      .select('*')
      .in('name', names)
      .eq('namespace', namespace);

    if (error) {
      return { data: null, error };
    }

    return {
      data: (data as SecretRow[]).map(rowToSecret),
      error: null,
    };
  }

  /**
   * Delete all secrets (useful for testing)
   */
  async deleteAllSecrets(): Promise<SecretResult<{ deleted: number }>> {
    const { error, count } = await this.client
      .from('secrets')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: count ?? 0 }, error: null };
  }
}

// ── Singleton Instance ──────────────────────────────────────────────────────

let _queriesInstance: SecretQueries | null = null;

/**
 * Get the singleton SecretQueries instance using service role
 */
export function getSecretQueries(): SecretQueries {
  if (!_queriesInstance) {
    _queriesInstance = new SecretQueries(getSupabaseServiceClient());
  }
  return _queriesInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetSecretQueries(): void {
  _queriesInstance = null;
}

// ── Convenience Functions ───────────────────────────────────────────────────

/**
 * Create a secret
 */
export async function createDbSecret(
  input: CreateSecretDbInput
): Promise<SecretResult<Secret>> {
  return getSecretQueries().createSecret(input);
}

/**
 * Get a secret by ID
 */
export async function getDbSecretById(
  id: string
): Promise<SecretResult<Secret>> {
  return getSecretQueries().getSecretById(id);
}

/**
 * Get a secret by name and namespace
 */
export async function getDbSecretByName(
  name: string,
  namespace?: string
): Promise<SecretResult<Secret>> {
  return getSecretQueries().getSecretByName(name, namespace);
}

/**
 * List secrets with optional filters
 */
export async function listDbSecrets(filters?: {
  namespace?: string;
  type?: SecretType;
}): Promise<SecretResult<SecretListItem[]>> {
  return getSecretQueries().listSecrets(filters);
}

/**
 * Update a secret by ID
 */
export async function updateDbSecret(
  id: string,
  input: UpdateSecretDbInput
): Promise<SecretResult<Secret>> {
  return getSecretQueries().updateSecret(id, input);
}

/**
 * Delete a secret by ID
 */
export async function deleteDbSecret(
  id: string
): Promise<SecretResult<{ deleted: boolean }>> {
  return getSecretQueries().deleteSecret(id);
}

/**
 * Delete a secret by name and namespace
 */
export async function deleteDbSecretByName(
  name: string,
  namespace?: string
): Promise<SecretResult<{ deleted: boolean }>> {
  return getSecretQueries().deleteSecretByName(name, namespace);
}

/**
 * Resolve multiple secrets by name for pod injection
 */
export async function resolveDbSecrets(
  names: string[],
  namespace?: string
): Promise<SecretResult<Secret[]>> {
  return getSecretQueries().resolveSecretsByNames(names, namespace);
}

/**
 * Load all secrets from a namespace for syncing to in-memory store
 */
export async function loadSecretsByNamespace(
  namespace: string
): Promise<Secret[]> {
  const result = await getSecretQueries().getSecretsByNamespace(namespace);
  if (result.error) {
    throw new Error(`Failed to load secrets: ${result.error.message}`);
  }
  return result.data ?? [];
}
