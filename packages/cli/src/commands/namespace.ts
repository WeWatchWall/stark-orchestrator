/**
 * Namespace Commands
 *
 * Namespace management commands: create, list, get, delete
 * @module @stark-o/cli/commands/namespace
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createApiClient, requireAuth, loadConfig, saveConfig } from '../config.js';
import {
  success,
  error,
  info,
  warn,
  table,
  keyValue,
  getOutputFormat,
  statusBadge,
  relativeTime,
  formatBytes,
} from '../output.js';

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

interface ResourceQuota {
  maxPods?: number;
  maxCpu?: number;
  maxMemory?: number;
  maxStorage?: number;
}

interface LimitRange {
  defaultCpuRequest?: number;
  defaultCpuLimit?: number;
  defaultMemoryRequest?: number;
  defaultMemoryLimit?: number;
  maxCpuPerPod?: number;
  maxMemoryPerPod?: number;
}

interface Namespace {
  id: string;
  name: string;
  phase: 'Active' | 'Terminating';
  labels: Record<string, string>;
  annotations: Record<string, string>;
  resourceQuota?: ResourceQuota;
  limitRange?: LimitRange;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

interface NamespaceListResponse {
  namespaces: Namespace[];
  total: number;
  page: number;
  pageSize: number;
}

interface NamespaceQuotaUsage {
  namespace: string;
  quota?: ResourceQuota;
  used: {
    pods: number;
    cpu: number;
    memory: number;
    storage: number;
  };
}

/**
 * Create command handler - creates a new namespace
 */
async function createHandler(
  name: string,
  options: {
    maxPods?: string;
    maxCpu?: string;
    maxMemory?: string;
    label?: string[];
  }
): Promise<void> {
  requireAuth();

  info(`Creating namespace: ${name}`);

  try {
    const api = createApiClient();

    const createRequest: Record<string, unknown> = {
      name,
    };

    // Build resource quota if any limits specified
    const quota: ResourceQuota = {};
    if (options.maxPods) {
      quota.maxPods = parseInt(options.maxPods, 10);
    }
    if (options.maxCpu) {
      quota.maxCpu = parseFloat(options.maxCpu);
    }
    if (options.maxMemory) {
      quota.maxMemory = parseMemory(options.maxMemory);
    }

    if (Object.keys(quota).length > 0) {
      createRequest.resourceQuota = quota;
    }

    // Build labels
    if (options.label && options.label.length > 0) {
      const labels: Record<string, string> = {};
      for (const l of options.label) {
        const [key, value] = l.split('=');
        if (key && value) {
          labels[key] = value;
        }
      }
      createRequest.labels = labels;
    }

    const response = await api.post('/api/namespaces', createRequest);
    const result = (await response.json()) as ApiResponse<{ namespace: Namespace }>;

    if (!result.success || !result.data) {
      error('Failed to create namespace', result.error);
      process.exit(1);
    }

    const ns = result.data.namespace;

    success(`Namespace created: ${ns.name}`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(ns, null, 2));
      return;
    }

    keyValue({
      'ID': ns.id,
      'Name': ns.name,
      'Phase': statusBadge(ns.phase),
      'Created': new Date(ns.createdAt).toLocaleString(),
    });
  } catch (err) {
    error('Failed to create namespace', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * List command handler - lists all namespaces
 */
async function listHandler(options: {
  page?: string;
  limit?: string;
}): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const params = new URLSearchParams();

    if (options.page) {
      params.set('page', options.page);
    }
    if (options.limit) {
      params.set('pageSize', options.limit);
    }

    const url = `/api/namespaces${params.toString() ? '?' + params.toString() : ''}`;
    const response = await api.get(url);
    const result = (await response.json()) as ApiResponse<NamespaceListResponse>;

    if (!result.success || !result.data) {
      error('Failed to list namespaces', result.error);
      process.exit(1);
    }

    const { namespaces, total } = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (namespaces.length === 0) {
      info('No namespaces found');
      return;
    }

    console.log(chalk.bold(`\nNamespaces (${namespaces.length} of ${total})\n`));

    table(
      namespaces.map((ns) => ({
        name: ns.name,
        phase: statusBadge(ns.phase),
        maxPods: ns.resourceQuota?.maxPods ?? chalk.gray('∞'),
        maxMemory: ns.resourceQuota?.maxMemory
          ? formatBytes(ns.resourceQuota.maxMemory)
          : chalk.gray('∞'),
        age: relativeTime(ns.createdAt),
      })),
      [
        { key: 'name', header: 'Name', width: 25 },
        { key: 'phase', header: 'Phase', width: 15 },
        { key: 'maxPods', header: 'Max Pods', width: 12 },
        { key: 'maxMemory', header: 'Max Memory', width: 12 },
        { key: 'age', header: 'Age', width: 15 },
      ]
    );

    console.log();
  } catch (err) {
    error('Failed to list namespaces', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Get command handler - shows namespace details
 */
async function getHandler(name: string): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const response = await api.get(`/api/namespaces/name/${encodeURIComponent(name)}`);
    const result = (await response.json()) as ApiResponse<{ namespace: Namespace }>;

    if (!result.success || !result.data) {
      error(`Namespace not found: ${name}`, result.error);
      process.exit(1);
    }

    const ns = result.data.namespace;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(ns, null, 2));
      return;
    }

    console.log(chalk.bold(`\nNamespace: ${ns.name}\n`));

    // Basic info
    console.log(chalk.underline('General'));
    keyValue({
      'ID': ns.id,
      'Name': ns.name,
      'Phase': statusBadge(ns.phase),
      'Created By': ns.createdBy,
      'Created': new Date(ns.createdAt).toLocaleString(),
      'Updated': new Date(ns.updatedAt).toLocaleString(),
    });

    console.log();

    // Resource quota
    if (ns.resourceQuota) {
      console.log(chalk.underline('Resource Quota'));
      keyValue({
        'Max Pods': ns.resourceQuota.maxPods ?? chalk.gray('unlimited'),
        'Max CPU': ns.resourceQuota.maxCpu ?? chalk.gray('unlimited'),
        'Max Memory': ns.resourceQuota.maxMemory
          ? formatBytes(ns.resourceQuota.maxMemory)
          : chalk.gray('unlimited'),
        'Max Storage': ns.resourceQuota.maxStorage
          ? formatBytes(ns.resourceQuota.maxStorage)
          : chalk.gray('unlimited'),
      });
      console.log();
    }

    // Limit range
    if (ns.limitRange) {
      console.log(chalk.underline('Limit Range'));
      keyValue({
        'Default CPU Request': ns.limitRange.defaultCpuRequest ?? chalk.gray('(none)'),
        'Default CPU Limit': ns.limitRange.defaultCpuLimit ?? chalk.gray('(none)'),
        'Default Memory Request': ns.limitRange.defaultMemoryRequest
          ? formatBytes(ns.limitRange.defaultMemoryRequest)
          : chalk.gray('(none)'),
        'Default Memory Limit': ns.limitRange.defaultMemoryLimit
          ? formatBytes(ns.limitRange.defaultMemoryLimit)
          : chalk.gray('(none)'),
      });
      console.log();
    }

    // Labels
    if (Object.keys(ns.labels).length > 0) {
      console.log(chalk.underline('Labels'));
      for (const [key, value] of Object.entries(ns.labels)) {
        console.log(`  ${chalk.cyan(key)}: ${value}`);
      }
      console.log();
    }

    // Annotations
    if (Object.keys(ns.annotations).length > 0) {
      console.log(chalk.underline('Annotations'));
      for (const [key, value] of Object.entries(ns.annotations)) {
        console.log(`  ${chalk.gray(key)}: ${value}`);
      }
      console.log();
    }
  } catch (err) {
    error('Failed to get namespace', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Delete command handler - deletes a namespace
 */
async function deleteHandler(
  name: string,
  options: { force?: boolean }
): Promise<void> {
  requireAuth();

  // Prevent deletion of default namespace
  if (name === 'default' && !options.force) {
    error('Cannot delete the default namespace. Use --force to override.');
    process.exit(1);
  }

  if (!options.force) {
    warn(`This will delete namespace '${name}' and all resources in it. Use --force to confirm.`);
    process.exit(1);
  }

  info(`Deleting namespace: ${name}`);

  try {
    const api = createApiClient();
    const response = await api.delete(`/api/namespaces/name/${encodeURIComponent(name)}`);
    const result = (await response.json()) as ApiResponse<{ deleted: boolean }>;

    if (!result.success) {
      error('Failed to delete namespace', result.error);
      process.exit(1);
    }

    success(`Namespace deleted: ${name}`);
  } catch (err) {
    error('Failed to delete namespace', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Quota command handler - shows namespace quota usage
 */
async function quotaHandler(name: string): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const response = await api.get(`/api/namespaces/name/${encodeURIComponent(name)}/quota`);
    const result = (await response.json()) as ApiResponse<NamespaceQuotaUsage>;

    if (!result.success || !result.data) {
      error('Failed to get namespace quota', result.error);
      process.exit(1);
    }

    const usage = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(usage, null, 2));
      return;
    }

    console.log(chalk.bold(`\nQuota Usage: ${name}\n`));

    const quota = usage.quota ?? {};
    const used = usage.used;

    const formatUsage = (current: number, max: number | undefined, isMem = false): string => {
      if (!max) {
        return isMem ? formatBytes(current) : String(current);
      }
      const pct = Math.round((current / max) * 100);
      const usedStr = isMem ? formatBytes(current) : String(current);
      const maxStr = isMem ? formatBytes(max) : String(max);
      const pctStr = `${pct}%`;

      let color = chalk.green;
      if (pct >= 90) color = chalk.red;
      else if (pct >= 70) color = chalk.yellow;

      return `${usedStr} / ${maxStr} (${color(pctStr)})`;
    };

    keyValue({
      'Pods': formatUsage(used.pods, quota.maxPods),
      'CPU': formatUsage(used.cpu, quota.maxCpu),
      'Memory': formatUsage(used.memory, quota.maxMemory, true),
      'Storage': formatUsage(used.storage, quota.maxStorage, true),
    });

    console.log();
  } catch (err) {
    error('Failed to get quota usage', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Use command handler - sets the default namespace
 */
async function useHandler(name: string): Promise<void> {
  requireAuth();

  // Verify namespace exists
  try {
    const api = createApiClient();
    const response = await api.get(`/api/namespaces/name/${encodeURIComponent(name)}`);
    const result = (await response.json()) as ApiResponse<{ namespace: Namespace }>;

    if (!result.success || !result.data) {
      error(`Namespace not found: ${name}`, result.error);
      process.exit(1);
    }

    // Save as default namespace
    saveConfig({ defaultNamespace: name });
    success(`Default namespace set to: ${name}`);
  } catch (err) {
    error('Failed to set default namespace', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Current command handler - shows current default namespace
 */
function currentHandler(): void {
  const config = loadConfig();
  const ns = config.defaultNamespace ?? 'default';

  if (getOutputFormat() === 'json') {
    console.log(JSON.stringify({ namespace: ns }));
  } else {
    info(`Current namespace: ${chalk.bold(ns)}`);
  }
}

/**
 * Parses memory string (e.g., "512Mi", "1Gi") to bytes
 */
function parseMemory(memStr: string): number {
  const match = memStr.match(/^(\d+(?:\.\d+)?)\s*(B|Ki|Mi|Gi|Ti)?$/i);
  if (!match) {
    return parseInt(memStr, 10);
  }

  const value = parseFloat(match[1] ?? '0');
  const unit = (match[2] ?? 'B').toLowerCase();

  const multipliers: Record<string, number> = {
    'b': 1,
    'ki': 1024,
    'mi': 1024 * 1024,
    'gi': 1024 * 1024 * 1024,
    'ti': 1024 * 1024 * 1024 * 1024,
  };

  return Math.floor(value * (multipliers[unit] ?? 1));
}

/**
 * Creates the namespace command group
 */
export function createNamespaceCommand(): Command {
  const namespace = new Command('namespace')
    .alias('ns')
    .description('Namespace management commands');

  namespace
    .command('create <name>')
    .description('Create a new namespace')
    .option('--max-pods <count>', 'Maximum number of pods')
    .option('--max-cpu <cores>', 'Maximum CPU cores')
    .option('--max-memory <size>', 'Maximum memory (e.g., 512Mi, 1Gi)')
    .option('-l, --label <key=value...>', 'Namespace labels')
    .action(createHandler);

  namespace
    .command('list')
    .alias('ls')
    .description('List all namespaces')
    .option('-p, --page <page>', 'Page number')
    .option('--limit <limit>', 'Results per page')
    .action(listHandler);

  namespace
    .command('get <name>')
    .description('Show namespace details')
    .action(getHandler);

  namespace
    .command('delete <name>')
    .alias('rm')
    .description('Delete a namespace')
    .option('-f, --force', 'Force deletion without confirmation')
    .action(deleteHandler);

  namespace
    .command('quota <name>')
    .description('Show namespace quota usage')
    .action(quotaHandler);

  namespace
    .command('use <name>')
    .description('Set the default namespace for CLI operations')
    .action(useHandler);

  namespace
    .command('current')
    .description('Show the current default namespace')
    .action(currentHandler);

  return namespace;
}
