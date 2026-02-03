/**
 * Pack Commands
 *
 * Pack management commands: bundle, register, list, versions
 * @module @stark-o/cli/commands/pack
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createApiClient, requireAuth } from '../config.js';
import {
  success,
  error,
  info,
  warn,
  table,
  keyValue,
  getOutputFormat,
  relativeTime,
  truncate,
} from '../output.js';
import { bundleNuxtProject, bundleSimple, isNuxtProject } from '../bundler.js';
import type { RuntimeTag } from '@stark-o/shared';

/**
 * Get current Node.js version (without 'v' prefix)
 */
function getSystemNodeVersion(): string {
  return process.version.replace(/^v/, '');
}

/**
 * Prompts for yes/no confirmation
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * API response types
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

interface Pack {
  id: string;
  name: string;
  version: string;
  runtimeTag: RuntimeTag;
  ownerId: string;
  bundlePath: string;
  description?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface PackListResponse {
  packs: Pack[];
  total: number;
  page: number;
  pageSize: number;
}

interface PackVersionsResponse {
  versions: Array<{ version: string; createdAt: string }>;
}

/**
 * Bundle command handler - creates a pack bundle from source files
 */
async function bundleHandler(
  sourcePath: string,
  options: { out?: string; name?: string; skipInstall?: boolean; skipBuild?: boolean }
): Promise<void> {
  info('Bundling pack...');

  const absPath = path.resolve(sourcePath);

  if (!fs.existsSync(absPath)) {
    error(`Source path not found: ${absPath}`);
    process.exit(1);
  }

  // Determine output path
  const outputPath = path.resolve(options.out ?? path.join(process.cwd(), 'bundle.js'));
  const packName = options.name ?? path.basename(absPath, path.extname(absPath));

  try {
    // Check if it's a Nuxt project
    if (fs.statSync(absPath).isDirectory() && isNuxtProject(absPath)) {
      info('Detected Nuxt project, using Nuxt bundler...');
      
      const result = await bundleNuxtProject({
        sourceDir: absPath,
        outputPath,
        packName,
        skipInstall: options.skipInstall,
        skipBuild: options.skipBuild,
      });

      if (!result.success) {
        error(`Failed to bundle Nuxt project: ${result.error}`);
        process.exit(1);
      }

      success(`Bundle created: ${outputPath}`);
      info(`Pack name: ${packName}`);
      info(`Bundle size: ${result.bundleSizeKb} KB`);
    } else {
      // Use simple bundler for non-Nuxt projects
      const result = await bundleSimple({
        sourceDir: absPath,
        outputPath,
        packName,
      });

      if (!result.success) {
        error(`Failed to create bundle: ${result.error}`);
        process.exit(1);
      }

      success(`Bundle created: ${outputPath}`);
      info(`Pack name: ${packName}`);
    }
  } catch (err) {
    error('Failed to create bundle', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Register command handler - registers a pack with the orchestrator
 */
async function registerHandler(
  bundlePath: string,
  options: {
    name: string;
    ver: string;
    runtime: string;
    description?: string;
    visibility?: string;
    minNodeVersion?: string;
    yes?: boolean;
  }
): Promise<void> {
  requireAuth();

  const absPath = path.resolve(bundlePath);

  if (!fs.existsSync(absPath)) {
    error(`Bundle not found: ${absPath}`);
    process.exit(1);
  }

  // Validate runtime tag
  const validRuntimes = ['node', 'browser', 'universal'];
  if (!validRuntimes.includes(options.runtime)) {
    error(`Invalid runtime: ${options.runtime}. Must be one of: ${validRuntimes.join(', ')}`);
    process.exit(1);
  }

  // Validate visibility
  const validVisibilities = ['private', 'public'];
  if (options.visibility && !validVisibilities.includes(options.visibility)) {
    error(`Invalid visibility: ${options.visibility}. Must be one of: ${validVisibilities.join(', ')}`);
    process.exit(1);
  }

  // Read the bundle content from the file
  info(`Reading bundle from: ${absPath}`);
  let bundleContent: string;
  try {
    bundleContent = fs.readFileSync(absPath, 'utf-8');
    info(`Bundle size: ${bundleContent.length} bytes`);
  } catch (readErr) {
    error(`Failed to read bundle file: ${readErr instanceof Error ? readErr.message : 'Unknown error'}`);
    process.exit(1);
  }

  // Handle Node version compatibility for node runtime
  let minNodeVersion = options.minNodeVersion;
  if (options.runtime === 'node' && !minNodeVersion && !options.yes) {
    // No explicit version specified - warn about using system version
    const systemVersion = getSystemNodeVersion();
    console.log();
    warn(`No minimum Node.js version specified.`);
    info(`Current system Node.js version: ${chalk.cyan(systemVersion)}`);
    info(`Packs without minNodeVersion may fail on nodes with older Node.js versions.`);
    console.log();
    
    const shouldUseSystemVersion = await confirm(
      `Use current Node.js version (${systemVersion}) as minimum? [y/N] `
    );
    
    if (shouldUseSystemVersion) {
      minNodeVersion = systemVersion;
      info(`Using minNodeVersion: ${chalk.cyan(minNodeVersion)}`);
    } else {
      info(`Proceeding without minNodeVersion constraint.`);
      info(chalk.dim(`Tip: Use --min-node-version <version> to specify version requirements.`));
      info(chalk.dim(`     Example: --min-node-version 18.0.0`));
    }
    console.log();
  }

  info('Registering pack...');

  try {
    const api = createApiClient();
    
    // Include bundleContent directly in the request body
    const requestBody: Record<string, unknown> = {
      name: options.name,
      version: options.ver,
      runtimeTag: options.runtime,
      description: options.description,
      visibility: options.visibility,
      bundleContent: bundleContent,
    };

    // Add minNodeVersion if specified
    if (minNodeVersion) {
      requestBody.minNodeVersion = minNodeVersion;
    }
    
    info(`Sending registration request for ${options.name}@${options.ver}...`);
    const response = await api.post('/api/packs', requestBody);

    const result = (await response.json()) as ApiResponse<{ pack: Pack; uploadUrl?: string }>;

    if (!result.success || !result.data) {
      error('Failed to register pack', result.error);
      process.exit(1);
    }

    success(`Pack registered: ${options.name}@${options.ver}`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data.pack, null, 2));
    } else {
      keyValue({
        'ID': result.data.pack.id,
        'Name': result.data.pack.name,
        'Version': result.data.pack.version,
        'Runtime': result.data.pack.runtimeTag,
        'Created': new Date(result.data.pack.createdAt).toLocaleString(),
      });
    }
  } catch (err) {
    error('Failed to register pack', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * List command handler - lists all packs
 */
async function listHandler(options: {
  runtime?: string;
  page?: string;
  limit?: string;
}): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const params = new URLSearchParams();

    if (options.runtime) {
      params.set('runtimeTag', options.runtime);
    }
    if (options.page) {
      params.set('page', options.page);
    }
    if (options.limit) {
      params.set('pageSize', options.limit);
    }

    const url = `/api/packs${params.toString() ? '?' + params.toString() : ''}`;
    const response = await api.get(url);
    const result = (await response.json()) as ApiResponse<PackListResponse>;

    if (!result.success || !result.data) {
      error('Failed to list packs', result.error);
      process.exit(1);
    }

    const { packs, total } = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (packs.length === 0) {
      info('No packs found');
      return;
    }

    console.log(chalk.bold(`\nPacks (${packs.length} of ${total})\n`));

    table(
      packs.map((p) => ({
        name: p.name,
        version: p.version,
        runtime: p.runtimeTag,
        description: truncate(p.description ?? '', 30),
        created: relativeTime(p.createdAt),
      })),
      [
        { key: 'name', header: 'Name', width: 25 },
        { key: 'version', header: 'Version', width: 12 },
        { key: 'runtime', header: 'Runtime', width: 12 },
        { key: 'description', header: 'Description', width: 30 },
        { key: 'created', header: 'Created', width: 15 },
      ]
    );

    console.log();
  } catch (err) {
    error('Failed to list packs', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Versions command handler - lists all versions of a pack
 */
async function versionsHandler(packName: string): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const response = await api.get(`/api/packs/${encodeURIComponent(packName)}/versions`);
    const result = (await response.json()) as ApiResponse<PackVersionsResponse>;

    if (!result.success || !result.data) {
      error('Failed to get pack versions', result.error);
      process.exit(1);
    }

    const { versions } = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (versions.length === 0) {
      info(`No versions found for pack: ${packName}`);
      return;
    }

    console.log(chalk.bold(`\nVersions of ${packName}\n`));

    table(
      versions.map((v, i) => ({
        version: v.version,
        created: relativeTime(v.createdAt),
        latest: i === 0 ? chalk.green('✓') : '',
      })),
      [
        { key: 'version', header: 'Version', width: 15 },
        { key: 'created', header: 'Created', width: 20 },
        { key: 'latest', header: 'Latest', width: 8 },
      ]
    );

    console.log();
  } catch (err) {
    error('Failed to get versions', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Info command handler - shows details of a specific pack
 */
async function infoHandler(packName: string, options: { ver?: string }): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();

    // First get the pack by name (need to search or use a different endpoint)
    const listResponse = await api.get(`/api/packs?name=${encodeURIComponent(packName)}`);
    const listResult = (await listResponse.json()) as ApiResponse<PackListResponse>;

    if (!listResult.success || !listResult.data) {
      error('Failed to get pack info', listResult.error);
      process.exit(1);
    }

    let pack = listResult.data.packs.find((p) => p.name === packName);

    if (options.ver) {
      pack = listResult.data.packs.find(
        (p) => p.name === packName && p.version === options.ver
      );
    }

    if (!pack) {
      error(`Pack not found: ${packName}${options.ver ? '@' + options.ver : ''}`);
      process.exit(1);
    }

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(pack, null, 2));
      return;
    }

    console.log(chalk.bold(`\nPack: ${pack.name}\n`));
    keyValue({
      'ID': pack.id,
      'Name': pack.name,
      'Version': pack.version,
      'Runtime': pack.runtimeTag,
      'Description': pack.description ?? '(none)',
      'Owner ID': pack.ownerId,
      'Bundle Path': pack.bundlePath,
      'Created': new Date(pack.createdAt).toLocaleString(),
      'Updated': new Date(pack.updatedAt).toLocaleString(),
    });
    console.log();
  } catch (err) {
    error('Failed to get pack info', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Delete command handler - deletes a pack by name
 */
async function deleteHandler(
  packName: string,
  options: { force?: boolean; ver?: string }
): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();

    // Look up pack by name to get the ID
    const listResponse = await api.get(`/api/packs?name=${encodeURIComponent(packName)}`);
    const listResult = (await listResponse.json()) as ApiResponse<PackListResponse>;

    if (!listResult.success || !listResult.data) {
      error('Failed to find pack', listResult.error);
      process.exit(1);
    }

    let pack = listResult.data.packs.find((p) => p.name === packName);
    if (options.ver) {
      pack = listResult.data.packs.find(
        (p) => p.name === packName && p.version === options.ver
      );
    }

    if (!pack) {
      error(`Pack not found: ${packName}${options.ver ? '@' + options.ver : ''}`);
      process.exit(1);
    }

    if (!options.force) {
      warn(`This will permanently delete pack ${pack.name}@${pack.version}. Use --force to confirm.`);
      process.exit(1);
    }

    const response = await api.delete(`/api/packs/${pack.id}`);
    const result = (await response.json()) as ApiResponse<{ deleted: boolean }>;

    if (!result.success) {
      error('Failed to delete pack', result.error);
      process.exit(1);
    }

    success(`Pack deleted: ${pack.name}@${pack.version}`);
  } catch (err) {
    error('Failed to delete pack', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Creates the pack command group
 */
export function createPackCommand(): Command {
  const pack = new Command('pack')
    .description('Pack management commands');

  pack
    .command('bundle <source>')
    .description('Bundle source files into a pack (auto-detects Nuxt projects)')
    .option('--out <path>', 'Output bundle path')
    .option('-n, --name <name>', 'Pack name')
    .option('--skip-install', 'Skip pnpm install step (for Nuxt projects)')
    .option('--skip-build', 'Skip build step (for Nuxt projects)')
    .action(bundleHandler);

  pack
    .command('register <bundle>')
    .description('Register a pack with the orchestrator')
    .requiredOption('-n, --name <name>', 'Pack name')
    .requiredOption('-V, --ver <version>', 'Pack version (semver)')
    .requiredOption('-r, --runtime <runtime>', 'Runtime tag: node, browser, universal')
    .option('-d, --description <desc>', 'Pack description')
    .option('--visibility <visibility>', 'Pack visibility: private (default) or public')
    .option('--min-node-version <version>', 'Minimum Node.js version required (e.g., 18, 20.10.0)')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(registerHandler);

  pack
    .command('list')
    .alias('ls')
    .description('List all packs')
    .option('-r, --runtime <runtime>', 'Filter by runtime tag')
    .option('-p, --page <page>', 'Page number')
    .option('-l, --limit <limit>', 'Results per page')
    .action(listHandler);

  pack
    .command('versions <name>')
    .description('List all versions of a pack')
    .action(versionsHandler);

  pack
    .command('info <name>')
    .description('Show details of a pack')
    .option('-V, --ver <version>', 'Specific version')
    .action(infoHandler);

  pack
    .command('delete <name>')
    .alias('rm')
    .description('Delete a pack by name')
    .option('-V, --ver <version>', 'Specific version to delete (defaults to latest)')
    .option('-f, --force', 'Force deletion without confirmation')
    .action(deleteHandler);

  return pack;
}
