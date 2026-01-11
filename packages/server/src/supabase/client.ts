/**
 * Supabase Client Configuration
 *
 * Initializes and exports the Supabase client for server-side usage.
 * Supports both authenticated and service role clients.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Environment variable names for Supabase configuration
 */
const ENV_SUPABASE_URL = 'SUPABASE_URL';
const ENV_SUPABASE_ANON_KEY = 'SUPABASE_ANON_KEY';
const ENV_SUPABASE_SERVICE_ROLE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * Default local Supabase configuration (for development)
 */
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const LOCAL_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * Retrieves the Supabase configuration from environment variables
 * Falls back to local development defaults if not set
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: process.env[ENV_SUPABASE_URL] ?? LOCAL_SUPABASE_URL,
    anonKey: process.env[ENV_SUPABASE_ANON_KEY] ?? LOCAL_ANON_KEY,
    serviceRoleKey: process.env[ENV_SUPABASE_SERVICE_ROLE_KEY] ?? LOCAL_SERVICE_ROLE_KEY,
  };
}

/**
 * Creates a Supabase client with the anonymous key
 * Use for public/authenticated user operations
 */
export function createSupabaseClient(): SupabaseClient {
  const config = getSupabaseConfig();
  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false, // Server-side, no localStorage
      detectSessionInUrl: false,
    },
  });
}

/**
 * Creates a Supabase client with the service role key
 * Use for administrative operations that bypass RLS
 *
 * WARNING: Only use server-side, never expose to clients
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const config = getSupabaseConfig();
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Creates a Supabase client with a specific user's JWT token
 * Use for user-scoped operations with RLS
 */
export function createSupabaseUserClient(accessToken: string): SupabaseClient {
  const config = getSupabaseConfig();
  return createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

/**
 * Singleton instances for common use cases
 */
let _supabaseClient: SupabaseClient | null = null;
let _supabaseServiceClient: SupabaseClient | null = null;

/**
 * Gets or creates the default Supabase client (anon key)
 */
export function getSupabaseClient(): SupabaseClient {
  if (!_supabaseClient) {
    _supabaseClient = createSupabaseClient();
  }
  return _supabaseClient;
}

/**
 * Gets or creates the Supabase service role client
 *
 * WARNING: Only use server-side, never expose to clients
 */
export function getSupabaseServiceClient(): SupabaseClient {
  if (!_supabaseServiceClient) {
    _supabaseServiceClient = createSupabaseServiceClient();
  }
  return _supabaseServiceClient;
}

/**
 * Resets singleton clients (useful for testing)
 */
export function resetSupabaseClients(): void {
  _supabaseClient = null;
  _supabaseServiceClient = null;
}

/**
 * Validates that required Supabase environment variables are set
 * Throws if running in production without proper configuration
 */
export function validateSupabaseConfig(): void {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const url = process.env[ENV_SUPABASE_URL];
    const anonKey = process.env[ENV_SUPABASE_ANON_KEY];
    const serviceRoleKey = process.env[ENV_SUPABASE_SERVICE_ROLE_KEY];

    if (!url) {
      throw new Error(`Missing required environment variable: ${ENV_SUPABASE_URL}`);
    }
    if (!anonKey) {
      throw new Error(`Missing required environment variable: ${ENV_SUPABASE_ANON_KEY}`);
    }
    if (!serviceRoleKey) {
      throw new Error(`Missing required environment variable: ${ENV_SUPABASE_SERVICE_ROLE_KEY}`);
    }
  }
}

// Export default client for convenience
export const supabase = getSupabaseClient();
export const supabaseAdmin = getSupabaseServiceClient();
