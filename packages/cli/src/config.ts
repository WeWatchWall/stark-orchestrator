/**
 * CLI Configuration
 *
 * Handles configuration loading, API client setup, and credentials management.
 * @module @stark-o/cli/config
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Default API URL (local development)
 */
export const DEFAULT_API_URL = 'http://127.0.0.1:3000';

/**
 * Default Supabase URL (local development)
 */
export const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:54321';

/**
 * Default Supabase anon key (local development)
 */
export const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/**
 * Config directory path
 */
export const CONFIG_DIR = path.join(os.homedir(), '.stark');

/**
 * Config file path
 */
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Credentials file path
 */
export const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials.json');

/**
 * CLI configuration structure
 */
export interface CliConfig {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  defaultNamespace?: string;
  defaultOutputFormat?: 'json' | 'table' | 'plain';
}

/**
 * Stored credentials structure
 */
export interface Credentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  userId: string;
  email: string;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: CliConfig = {
  apiUrl: DEFAULT_API_URL,
  supabaseUrl: DEFAULT_SUPABASE_URL,
  supabaseAnonKey: DEFAULT_SUPABASE_ANON_KEY,
  defaultNamespace: 'default',
  defaultOutputFormat: 'table',
};

/**
 * Ensures config directory exists
 */
export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Loads CLI configuration
 */
export function loadConfig(): CliConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content) as Partial<CliConfig>;
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch {
    // Return defaults on error
  }
  return DEFAULT_CONFIG;
}

/**
 * Saves CLI configuration
 */
export function saveConfig(config: Partial<CliConfig>): void {
  ensureConfigDir();
  const current = loadConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), { mode: 0o600 });
}

/**
 * Loads stored credentials
 */
export function loadCredentials(): Credentials | null {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const content = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
      return JSON.parse(content) as Credentials;
    }
  } catch {
    // Return null on error
  }
  return null;
}

/**
 * Saves credentials securely
 */
export function saveCredentials(credentials: Credentials): void {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Clears stored credentials
 */
export function clearCredentials(): void {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Checks if user is authenticated
 */
export function isAuthenticated(): boolean {
  const creds = loadCredentials();
  if (!creds) return false;

  // Check if token is expired
  const expiresAt = new Date(creds.expiresAt);
  return expiresAt > new Date();
}

/**
 * Gets the current access token if authenticated
 */
export function getAccessToken(): string | null {
  const creds = loadCredentials();
  if (!creds) return null;

  const expiresAt = new Date(creds.expiresAt);
  if (expiresAt <= new Date()) return null;

  return creds.accessToken;
}

/**
 * Creates a Supabase client for CLI operations
 */
export function createCliSupabaseClient(config?: CliConfig): SupabaseClient {
  const cfg = config ?? loadConfig();
  const accessToken = getAccessToken();

  const client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  // If we have an access token, set it
  if (accessToken) {
    // Note: Setting session with access token
    void client.auth.setSession({
      access_token: accessToken,
      refresh_token: loadCredentials()?.refreshToken ?? '',
    });
  }

  return client;
}

/**
 * Creates an authenticated HTTP client for API calls
 */
export function createApiClient(config?: CliConfig): {
  get: (path: string) => Promise<Response>;
  post: (path: string, body?: unknown) => Promise<Response>;
  put: (path: string, body?: unknown) => Promise<Response>;
  delete: (path: string) => Promise<Response>;
} {
  const cfg = config ?? loadConfig();
  const baseUrl = cfg.apiUrl;
  const accessToken = getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  return {
    get: (path: string) =>
      fetch(`${baseUrl}${path}`, { method: 'GET', headers }),

    post: (path: string, body?: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),

    put: (path: string, body?: unknown) =>
      fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      }),

    delete: (path: string) =>
      fetch(`${baseUrl}${path}`, { method: 'DELETE', headers }),
  };
}

/**
 * Requires authentication, exits with error if not authenticated
 */
export function requireAuth(): Credentials {
  const creds = loadCredentials();
  if (!creds) {
    console.error('Error: Not authenticated. Run `stark auth login` first.');
    process.exit(1);
  }

  const expiresAt = new Date(creds.expiresAt);
  if (expiresAt <= new Date()) {
    console.error('Error: Session expired. Run `stark auth login` to reauthenticate.');
    process.exit(1);
  }

  return creds;
}
