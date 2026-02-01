/**
 * Supabase App Config Integration
 *
 * Provides app configuration operations using Supabase.
 * @module @stark-o/server/supabase/app-config
 */

import type { PostgrestError } from '@supabase/supabase-js';
import type { AppConfig, UpdateAppConfigInput } from '@stark-o/shared';
import { getSupabaseServiceClient } from './client.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Database row type for app_config table
 */
interface AppConfigRow {
  id: string;
  name: string;
  enable_public_registration: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Result type for app config operations
 */
export interface AppConfigResult<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Converts a database row to an AppConfig object
 */
function rowToAppConfig(row: AppConfigRow): AppConfig {
  return {
    id: row.id,
    name: row.name,
    enablePublicRegistration: row.enable_public_registration,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Maps PostgrestError to our error format
 */
function mapPostgrestError(err: PostgrestError): { code: string; message: string } {
  return {
    code: err.code ?? 'DATABASE_ERROR',
    message: err.message,
  };
}

// ============================================================================
// App Config Queries
// ============================================================================

/**
 * Gets the current app configuration
 */
export async function getAppConfig(): Promise<AppConfigResult<AppConfig>> {
  const client = getSupabaseServiceClient();

  const { data, error } = await client
    .from('app_config')
    .select('*')
    .eq('name', 'default')
    .single();

  if (error) {
    return { data: null, error: mapPostgrestError(error) };
  }

  if (!data) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'App config not found' } };
  }

  return { data: rowToAppConfig(data as AppConfigRow), error: null };
}

/**
 * Updates the app configuration (admin only - enforced at API level)
 */
export async function updateAppConfig(
  input: UpdateAppConfigInput
): Promise<AppConfigResult<AppConfig>> {
  const client = getSupabaseServiceClient();

  // Build update object with snake_case keys
  const updateData: Record<string, unknown> = {};
  if (input.enablePublicRegistration !== undefined) {
    updateData.enable_public_registration = input.enablePublicRegistration;
  }

  // If no fields to update, just return current config
  if (Object.keys(updateData).length === 0) {
    return getAppConfig();
  }

  const { data, error } = await client
    .from('app_config')
    .update(updateData)
    .eq('name', 'default')
    .select()
    .single();

  if (error) {
    return { data: null, error: mapPostgrestError(error) };
  }

  if (!data) {
    return { data: null, error: { code: 'NOT_FOUND', message: 'App config not found' } };
  }

  return { data: rowToAppConfig(data as AppConfigRow), error: null };
}

/**
 * Checks if public registration is enabled
 */
export async function isPublicRegistrationEnabled(): Promise<AppConfigResult<boolean>> {
  const result = await getAppConfig();

  if (result.error) {
    return { data: null, error: result.error };
  }

  return { data: result.data?.enablePublicRegistration ?? false, error: null };
}
