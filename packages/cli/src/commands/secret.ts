/**
 * Secret Commands
 *
 * Secret management commands: create, list, get, update, delete
 *
 * Secrets are first-class resources with self-contained injection
 * definitions. The CLI never echoes secret values after creation.
 *
 * @module @stark-o/cli/commands/secret
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { createApiClient, requireAuth, loadConfig } from '../config.js';
import {
  success,
  error,
  info,
  warn,
  table,
  keyValue,
  getOutputFormat,
} from '../output.js';
import type { SecretType, SecretInjectionMode } from '@stark-o/shared';

// ============================================================================
// API response types
// ============================================================================

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

interface SecretListItem {
  id: string;
  name: string;
  namespace: string;
  type: SecretType;
  injection: {
    mode: string;
    prefix?: string;
    mountPath?: string;
  };
  keyCount: number;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse --from-literal key=value pairs into a Record.
 * Values are NOT logged.
 */
function parseLiterals(literals: string[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (const literal of literals) {
    const eqIndex = literal.indexOf('=');
    if (eqIndex < 1) {
      error(`Invalid --from-literal format: "${literal}". Expected key=value`);
      process.exit(1);
    }
    const key = literal.substring(0, eqIndex);
    const value = literal.substring(eqIndex + 1);
    data[key] = value;
  }
  return data;
}

/**
 * Parse --from-file key=path pairs, reading file contents.
 * File contents are NOT logged.
 */
function parseFiles(files: string[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (const file of files) {
    const eqIndex = file.indexOf('=');
    if (eqIndex < 1) {
      error(`Invalid --from-file format: "${file}". Expected key=path`);
      process.exit(1);
    }
    const key = file.substring(0, eqIndex);
    const filePath = file.substring(eqIndex + 1);
    try {
      data[key] = readFileSync(filePath, 'utf-8');
    } catch (err) {
      error(`Failed to read file "${filePath}": ${err instanceof Error ? err.message : 'unknown error'}`);
      process.exit(1);
    }
  }
  return data;
}

/**
 * Format injection info for display
 */
function formatInjection(injection: { mode: string; prefix?: string; mountPath?: string }): string {
  if (injection.mode === 'env') {
    return injection.prefix ? `env (prefix: ${injection.prefix})` : 'env';
  }
  if (injection.mode === 'volume') {
    return injection.mountPath ? `volume → ${injection.mountPath}` : 'volume';
  }
  return injection.mode;
}

/**
 * Format secret type with color
 */
function typeBadge(type: string): string {
  switch (type) {
    case 'opaque': return chalk.blue(type);
    case 'tls': return chalk.green(type);
    case 'docker-registry': return chalk.yellow(type);
    default: return type;
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Create command handler
 *
 * stark secret create <name> --type opaque --from-literal username=admin ...
 * stark secret create <name> --type tls --from-file cert=./cert.pem ...
 */
async function createHandler(
  nameArg: string | undefined,
  options: {
    name?: string;
    type?: string;
    namespace?: string;
    fromLiteral?: string[];
    fromFile?: string[];
    inject?: string;
    prefix?: string;
    mountPath?: string;
    keyMapping?: string[];
    fileMapping?: string[];
  },
): Promise<void> {
  const name = nameArg || options.name;

  if (!name) {
    error('Secret name is required');
    process.exit(1);
  }

  const secretType = (options.type ?? 'opaque') as SecretType;
  const validTypes = ['opaque', 'tls', 'docker-registry'];
  if (!validTypes.includes(secretType)) {
    error(`Secret type must be one of: ${validTypes.join(', ')}`);
    process.exit(1);
  }

  // Gather data from literals and files
  const data: Record<string, string> = {};
  if (options.fromLiteral && options.fromLiteral.length > 0) {
    Object.assign(data, parseLiterals(options.fromLiteral));
  }
  if (options.fromFile && options.fromFile.length > 0) {
    Object.assign(data, parseFiles(options.fromFile));
  }

  if (Object.keys(data).length === 0) {
    error('At least one --from-literal or --from-file is required');
    process.exit(1);
  }

  // Build injection config
  const injectMode = (options.inject ?? 'env') as SecretInjectionMode;
  let injection: Record<string, unknown>;

  if (injectMode === 'volume') {
    if (!options.mountPath) {
      error('Volume injection requires --mount-path');
      process.exit(1);
    }
    injection = { mode: 'volume', mountPath: options.mountPath };

    // Parse file mapping if provided
    if (options.fileMapping && options.fileMapping.length > 0) {
      const fm: Record<string, string> = {};
      for (const mapping of options.fileMapping) {
        const [key, value] = mapping.split('=');
        if (key && value) fm[key] = value;
      }
      injection.fileMapping = fm;
    }
  } else {
    injection = { mode: 'env' };
    if (options.prefix) {
      injection.prefix = options.prefix;
    }

    // Parse key mapping if provided
    if (options.keyMapping && options.keyMapping.length > 0) {
      const km: Record<string, string> = {};
      for (const mapping of options.keyMapping) {
        const [key, value] = mapping.split('=');
        if (key && value) km[key] = value;
      }
      injection.keyMapping = km;
    }
  }

  requireAuth();

  const config = loadConfig();
  const namespace = options.namespace ?? config.defaultNamespace ?? 'default';

  info(`Creating secret: ${name} (${secretType}) in namespace ${namespace}`);
  // SECURITY: Do NOT log data contents

  try {
    const api = createApiClient();

    const secretRequest = {
      name,
      type: secretType,
      namespace,
      data,
      injection,
    };

    const response = await api.post('/api/secrets', secretRequest);
    const result = (await response.json()) as ApiResponse<SecretListItem>;

    if (!result.success || !result.data) {
      error('Failed to create secret', result.error);
      process.exit(1);
    }

    const secret = result.data;

    success(`Secret '${secret.name}' created`);

    if (getOutputFormat() === 'json') {
      // SECURITY: Only output metadata, never data
      console.log(JSON.stringify(secret, null, 2));
      return;
    }

    console.log();
    keyValue({
      'ID': secret.id,
      'Name': secret.name,
      'Type': typeBadge(secret.type),
      'Namespace': secret.namespace,
      'Keys': secret.keyCount.toString(),
      'Injection': formatInjection(secret.injection),
      'Version': secret.version.toString(),
    });

    console.log();
    // SECURITY: Explicitly remind user
    info('Secret values are stored encrypted and will not be displayed.');
  } catch (err) {
    error('Failed to create secret', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * List command handler
 */
async function listHandler(options: {
  namespace?: string;
  type?: string;
}): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const params = new URLSearchParams();

    if (options.namespace) params.set('namespace', options.namespace);
    if (options.type) params.set('type', options.type);

    const url = `/api/secrets${params.toString() ? '?' + params.toString() : ''}`;
    const response = await api.get(url);
    const result = (await response.json()) as ApiResponse<{ secrets: SecretListItem[] }>;

    if (!result.success || !result.data) {
      error('Failed to list secrets', result.error);
      process.exit(1);
    }

    const secrets = result.data.secrets;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (secrets.length === 0) {
      info('No secrets found');
      return;
    }

    console.log(chalk.bold(`\nSecrets (${secrets.length})\n`));

    table(
      secrets.map((s) => ({
        name: s.name,
        type: typeBadge(s.type),
        keys: s.keyCount.toString(),
        injection: formatInjection(s.injection),
        version: `v${s.version}`,
        namespace: s.namespace,
      })),
      [
        { key: 'name', header: 'Name', width: 25 },
        { key: 'type', header: 'Type', width: 18 },
        { key: 'keys', header: 'Keys', width: 6 },
        { key: 'injection', header: 'Injection', width: 25 },
        { key: 'version', header: 'Ver', width: 6 },
        { key: 'namespace', header: 'Namespace', width: 15 },
      ],
    );

    console.log();
  } catch (err) {
    error('Failed to list secrets', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Get command handler (metadata only, never data)
 */
async function getHandler(
  name: string,
  options: { namespace?: string },
): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    const response = await api.get(`/api/secrets/name/${name}?namespace=${namespace}`);
    const result = (await response.json()) as ApiResponse<SecretListItem>;

    if (!result.success || !result.data) {
      error('Secret not found', result.error);
      process.exit(1);
    }

    const secret = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(secret, null, 2));
      return;
    }

    console.log(chalk.bold(`\nSecret: ${secret.name}\n`));

    keyValue({
      'ID': secret.id,
      'Name': secret.name,
      'Type': typeBadge(secret.type),
      'Namespace': secret.namespace,
      'Keys': secret.keyCount.toString(),
      'Injection': formatInjection(secret.injection),
      'Version': secret.version.toString(),
      'Created By': secret.createdBy,
      'Created': new Date(secret.createdAt).toLocaleString(),
      'Updated': new Date(secret.updatedAt).toLocaleString(),
    });

    console.log();
    warn('Secret values are encrypted and never displayed.');
  } catch (err) {
    error('Failed to get secret', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Update command handler
 */
async function updateHandler(
  name: string,
  options: {
    namespace?: string;
    fromLiteral?: string[];
    fromFile?: string[];
    inject?: string;
    prefix?: string;
    mountPath?: string;
    keyMapping?: string[];
    fileMapping?: string[];
  },
): Promise<void> {
  requireAuth();

  const updatePayload: Record<string, unknown> = {};

  // Update data
  const data: Record<string, string> = {};
  if (options.fromLiteral && options.fromLiteral.length > 0) {
    Object.assign(data, parseLiterals(options.fromLiteral));
  }
  if (options.fromFile && options.fromFile.length > 0) {
    Object.assign(data, parseFiles(options.fromFile));
  }
  if (Object.keys(data).length > 0) {
    updatePayload.data = data;
  }

  // Update injection
  if (options.inject) {
    const injectMode = options.inject as SecretInjectionMode;
    if (injectMode === 'volume') {
      const injection: Record<string, unknown> = { mode: 'volume', mountPath: options.mountPath };
      if (options.fileMapping && options.fileMapping.length > 0) {
        const fm: Record<string, string> = {};
        for (const mapping of options.fileMapping) {
          const [key, value] = mapping.split('=');
          if (key && value) fm[key] = value;
        }
        injection.fileMapping = fm;
      }
      updatePayload.injection = injection;
    } else {
      const injection: Record<string, unknown> = { mode: 'env' };
      if (options.prefix) injection.prefix = options.prefix;
      if (options.keyMapping && options.keyMapping.length > 0) {
        const km: Record<string, string> = {};
        for (const mapping of options.keyMapping) {
          const [key, value] = mapping.split('=');
          if (key && value) km[key] = value;
        }
        injection.keyMapping = km;
      }
      updatePayload.injection = injection;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    error('Nothing to update. Provide --from-literal, --from-file, or --inject');
    process.exit(1);
  }

  const namespace = options.namespace ?? 'default';
  info(`Updating secret: ${name}`);
  // SECURITY: Do NOT log data changes

  try {
    const api = createApiClient();
    const response = await api.patch(`/api/secrets/name/${name}?namespace=${namespace}`, updatePayload);
    const result = (await response.json()) as ApiResponse<SecretListItem>;

    if (!result.success || !result.data) {
      error('Failed to update secret', result.error);
      process.exit(1);
    }

    success(`Secret '${name}' updated (v${result.data.version})`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    warn('Pods referencing this secret will be restarted with the new values.');
  } catch (err) {
    error('Failed to update secret', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Delete command handler
 */
async function deleteHandler(
  name: string,
  options: { namespace?: string; force?: boolean },
): Promise<void> {
  requireAuth();

  const namespace = options.namespace ?? 'default';

  if (!options.force) {
    warn(`This will permanently delete secret '${name}' in namespace '${namespace}'.`);
    warn('Pods referencing this secret will lose access on next restart.');
    info("Use --force to skip this warning.");
    process.exit(0);
  }

  try {
    const api = createApiClient();
    const response = await api.delete(`/api/secrets/name/${name}?namespace=${namespace}`);
    const result = (await response.json()) as ApiResponse<void>;

    if (!result.success) {
      error('Failed to delete secret', result.error);
      process.exit(1);
    }

    success(`Secret '${name}' deleted`);
  } catch (err) {
    error('Failed to delete secret', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

// ============================================================================
// Command Builder
// ============================================================================

/**
 * Create the `secret` command group with all subcommands
 */
export function createSecretCommand(): Command {
  const secret = new Command('secret')
    .description('Secret management (create, list, get, update, delete)');

  // ── create ──────────────────────────────────────────────────────
  secret
    .command('create')
    .argument('[name]', 'Secret name')
    .option('--name <name>', 'Secret name (alternative to positional arg)')
    .option('--type <type>', 'Secret type: opaque, tls, docker-registry', 'opaque')
    .option('-n, --namespace <namespace>', 'Target namespace')
    .option('--from-literal <key=value...>', 'Add literal key-value pair', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option('--from-file <key=path...>', 'Add key from file contents', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option('--inject <mode>', 'Injection mode: env, volume', 'env')
    .option('--prefix <prefix>', 'Environment variable prefix (for env injection)')
    .option('--mount-path <path>', 'Mount path (required for volume injection)')
    .option('--key-mapping <key=envName...>', 'Key to env var name mapping', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option('--file-mapping <key=filename...>', 'Key to filename mapping', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .description('Create a new secret')
    .action(createHandler);

  // ── list ────────────────────────────────────────────────────────
  secret
    .command('list')
    .alias('ls')
    .option('-n, --namespace <namespace>', 'Filter by namespace')
    .option('--type <type>', 'Filter by type')
    .description('List secrets (metadata only, no values displayed)')
    .action(listHandler);

  // ── get ─────────────────────────────────────────────────────────
  secret
    .command('get')
    .argument('<name>', 'Secret name')
    .option('-n, --namespace <namespace>', 'Secret namespace')
    .description('Get secret metadata (values are never displayed)')
    .action(getHandler);

  // ── update ──────────────────────────────────────────────────────
  secret
    .command('update')
    .argument('<name>', 'Secret name')
    .option('-n, --namespace <namespace>', 'Secret namespace')
    .option('--from-literal <key=value...>', 'Update literal key-value pair', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option('--from-file <key=path...>', 'Update key from file contents', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option('--inject <mode>', 'Change injection mode: env, volume')
    .option('--prefix <prefix>', 'Environment variable prefix (for env injection)')
    .option('--mount-path <path>', 'Mount path (for volume injection)')
    .option('--key-mapping <key=envName...>', 'Key to env var name mapping', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option('--file-mapping <key=filename...>', 'Key to filename mapping', (v: string, prev: string[]) => [...prev, v], [] as string[])
    .description('Update secret data or injection config (triggers pod rotation)')
    .action(updateHandler);

  // ── delete ──────────────────────────────────────────────────────
  secret
    .command('delete')
    .alias('rm')
    .argument('<name>', 'Secret name')
    .option('-n, --namespace <namespace>', 'Secret namespace')
    .option('--force', 'Skip confirmation')
    .description('Delete a secret')
    .action(deleteHandler);

  return secret;
}
