/**
 * Pod Commands
 *
 * Pod management commands: create, list, status, rollback
 * @module @stark-o/cli/commands/pod
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createApiClient, requireAuth, loadConfig } from '../config.js';
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
} from '../output.js';
import type { PodStatus } from '@stark-o/shared';

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

interface Pod {
  id: string;
  packId: string;
  packVersion: string;
  nodeId: string | null;
  status: PodStatus;
  statusMessage?: string;
  namespace: string;
  labels: Record<string, string>;
  priority: number;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  stoppedAt?: string;
}

interface PodListResponse {
  pods: Pod[];
  total: number;
  page: number;
  pageSize: number;
}

interface PodHistoryEntry {
  id: string;
  podId: string;
  action: string;
  previousStatus?: PodStatus;
  newStatus: PodStatus;
  previousVersion?: string;
  newVersion?: string;
  performedBy: string;
  reason?: string;
  createdAt: string;
}

/**
 * Create command handler - deploys a pack to a node
 * Supports both positional argument and --pack option
 */
async function createHandler(
  packNameArg: string | undefined,
  options: {
    pack?: string;
    ver?: string;
    node?: string;
    namespace?: string;
    priority?: string;
    label?: string[];
    replicas?: string;
    nodeSelector?: string[];
    toleration?: string[];
    cpu?: string;
    memory?: string;
  }
): Promise<void> {
  // Support both positional argument and --pack option
  const packName = packNameArg || options.pack;

  if (!packName) {
    error('Pack name is required. Use positional argument or --pack option');
    process.exit(1);
  }

  requireAuth();
  const config = loadConfig();

  info(`Deploying pack: ${packName}${options.ver ? '@' + options.ver : ' (latest)'}`);

  try {
    const api = createApiClient();

    // Build pod creation request
    const podRequest: Record<string, unknown> = {
      packName,
      packVersion: options.ver, // undefined means latest
      namespace: options.namespace ?? config.defaultNamespace ?? 'default',
    };

    if (options.node) {
      podRequest.nodeId = options.node;
    }

    if (options.priority) {
      podRequest.priority = parseInt(options.priority, 10);
    }

    if (options.label && options.label.length > 0) {
      const labels: Record<string, string> = {};
      for (const l of options.label) {
        const [key, value] = l.split('=');
        if (key && value) {
          labels[key] = value;
        }
      }
      podRequest.labels = labels;
    }

    // Parse node selectors (key=value pairs)
    if (options.nodeSelector && options.nodeSelector.length > 0) {
      const nodeSelector: Record<string, string> = {};
      for (const s of options.nodeSelector) {
        const [key, value] = s.split('=');
        if (key && value) {
          nodeSelector[key] = value;
        }
      }
      podRequest.scheduling = { nodeSelector };
    }

    // Parse tolerations (key=value:effect format)
    if (options.toleration && options.toleration.length > 0) {
      const tolerations: Array<{ key: string; value?: string; effect?: string; operator: string }> = [];
      for (const t of options.toleration) {
        // Format: key=value:effect or key:effect or key
        const effectMatch = t.match(/^(.+):([A-Za-z]+)$/);
        if (effectMatch && effectMatch[1] && effectMatch[2]) {
          const keyValuePart = effectMatch[1];
          const effect = effectMatch[2];
          const kvMatch = keyValuePart.match(/^([^=]+)=(.+)$/);
          if (kvMatch && kvMatch[1] && kvMatch[2]) {
            tolerations.push({ key: kvMatch[1], value: kvMatch[2], effect, operator: 'Equal' });
          } else {
            tolerations.push({ key: keyValuePart, effect, operator: 'Exists' });
          }
        } else {
          // Just a key
          tolerations.push({ key: t, operator: 'Exists' });
        }
      }
      podRequest.tolerations = tolerations;
    }

    // Parse resource requests
    if (options.cpu || options.memory) {
      podRequest.resourceRequests = {
        cpu: options.cpu ? parseInt(options.cpu, 10) : 100,
        memory: options.memory ? parseInt(options.memory, 10) : 128,
      };
    }

    const replicas = parseInt(options.replicas ?? '1', 10);

    // Create pods
    const createdPods: Pod[] = [];

    for (let i = 0; i < replicas; i++) {
      const response = await api.post('/api/pods', podRequest);
      const result = (await response.json()) as ApiResponse<{ pod: Pod }>;

      if (!result.success || !result.data) {
        error(`Failed to create pod ${i + 1}/${replicas}`, result.error);
        if (createdPods.length > 0) {
          warn(`Successfully created ${createdPods.length} pod(s) before failure`);
        }
        process.exit(1);
      }

      createdPods.push(result.data.pod);
    }

    success(`Deployed ${createdPods.length} pod(s)`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify({ pods: createdPods }, null, 2));
      return;
    }

    console.log();
    table(
      createdPods.map((p) => ({
        id: p.id,
        pack: packName,
        version: p.packVersion,
        node: p.nodeId ?? chalk.gray('pending'),
        status: statusBadge(p.status),
        namespace: p.namespace,
      })),
      [
        { key: 'id', header: 'Pod ID', width: 38 },
        { key: 'pack', header: 'Pack', width: 20 },
        { key: 'version', header: 'Version', width: 12 },
        { key: 'node', header: 'Node', width: 38 },
        { key: 'status', header: 'Status', width: 15 },
        { key: 'namespace', header: 'Namespace', width: 15 },
      ]
    );

    console.log();
    info(`Use 'stark pod status <pod-id>' to check deployment status`);
  } catch (err) {
    error('Deployment failed', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Status command handler - shows pod status
 */
async function statusHandler(podId: string): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const response = await api.get(`/api/pods/${podId}`);
    const result = (await response.json()) as ApiResponse<{ pod: Pod }>;

    if (!result.success || !result.data) {
      error('Failed to get pod status', result.error);
      process.exit(1);
    }

    const pod = result.data.pod;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(pod, null, 2));
      return;
    }

    console.log(chalk.bold(`\nPod: ${pod.id}\n`));

    keyValue({
      'Status': statusBadge(pod.status),
      'Message': pod.statusMessage ?? chalk.gray('(none)'),
      'Pack ID': pod.packId,
      'Pack Version': pod.packVersion,
      'Node ID': pod.nodeId ?? chalk.gray('(not scheduled)'),
      'Namespace': pod.namespace,
      'Priority': pod.priority,
      'Created By': pod.createdBy,
      'Created': new Date(pod.createdAt).toLocaleString(),
      'Started': pod.startedAt ? new Date(pod.startedAt).toLocaleString() : chalk.gray('(not started)'),
      'Stopped': pod.stoppedAt ? new Date(pod.stoppedAt).toLocaleString() : chalk.gray('(running)'),
    });

    if (Object.keys(pod.labels).length > 0) {
      console.log('\n' + chalk.underline('Labels'));
      for (const [key, value] of Object.entries(pod.labels)) {
        console.log(`  ${chalk.cyan(key)}: ${value}`);
      }
    }

    console.log();
  } catch (err) {
    error('Failed to get pod status', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * List command handler - lists pods
 */
async function listHandler(options: {
  namespace?: string;
  status?: string;
  node?: string;
  pack?: string;
  page?: string;
  limit?: string;
}): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const params = new URLSearchParams();

    if (options.namespace) {
      params.set('namespace', options.namespace);
    }
    if (options.status) {
      params.set('status', options.status);
    }
    if (options.node) {
      params.set('nodeId', options.node);
    }
    if (options.pack) {
      params.set('packName', options.pack);
    }
    if (options.page) {
      params.set('page', options.page);
    }
    if (options.limit) {
      params.set('pageSize', options.limit);
    }

    const url = `/api/pods${params.toString() ? '?' + params.toString() : ''}`;
    const response = await api.get(url);
    const result = (await response.json()) as ApiResponse<PodListResponse>;

    if (!result.success || !result.data) {
      error('Failed to list pods', result.error);
      process.exit(1);
    }

    const { pods, total } = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (pods.length === 0) {
      info('No pods found');
      return;
    }

    console.log(chalk.bold(`\nPods (${pods.length} of ${total})\n`));

    table(
      pods.map((p) => ({
        id: p.id,
        pack: p.packId,
        version: p.packVersion,
        node: p.nodeId ?? chalk.gray('pending'),
        status: statusBadge(p.status),
        namespace: p.namespace,
        age: relativeTime(p.createdAt),
      })),
      [
        { key: 'id', header: 'Pod ID', width: 38 },
        { key: 'pack', header: 'Pack', width: 38 },
        { key: 'version', header: 'Version', width: 12 },
        { key: 'node', header: 'Node', width: 38 },
        { key: 'status', header: 'Status', width: 15 },
        { key: 'namespace', header: 'Namespace', width: 12 },
        { key: 'age', header: 'Age', width: 12 },
      ]
    );

    console.log();
  } catch (err) {
    error('Failed to list pods', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Rollback command handler - rolls back a pod to a previous version
 */
async function rollbackHandler(
  podId: string,
  options: { ver?: string; reason?: string }
): Promise<void> {
  requireAuth();

  info(`Rolling back pod: ${podId}`);

  try {
    const api = createApiClient();

    const rollbackRequest: Record<string, unknown> = {};
    if (options.ver) {
      rollbackRequest.targetVersion = options.ver;
    }
    if (options.reason) {
      rollbackRequest.reason = options.reason;
    }

    const response = await api.post(`/api/pods/${podId}/rollback`, rollbackRequest);
    const result = (await response.json()) as ApiResponse<{ pod: Pod }>;

    if (!result.success || !result.data) {
      error('Rollback failed', result.error);
      process.exit(1);
    }

    const pod = result.data.pod;

    success(`Rolled back to version ${pod.packVersion}`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(pod, null, 2));
      return;
    }

    keyValue({
      'Pod ID': pod.id,
      'New Version': pod.packVersion,
      'Status': statusBadge(pod.status),
    });
  } catch (err) {
    error('Rollback failed', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * History command handler - shows pod history
 */
async function historyHandler(podId: string): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const response = await api.get(`/api/pods/${podId}/history`);
    const result = (await response.json()) as ApiResponse<{ history: PodHistoryEntry[] }>;

    if (!result.success || !result.data) {
      error('Failed to get pod history', result.error);
      process.exit(1);
    }

    const { history } = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (history.length === 0) {
      info('No history entries found');
      return;
    }

    console.log(chalk.bold(`\nPod History: ${podId}\n`));

    table(
      history.map((h) => ({
        action: h.action,
        status: `${h.previousStatus ?? '-'} → ${h.newStatus}`,
        version: h.newVersion ?? h.previousVersion ?? '-',
        reason: h.reason ?? '-',
        when: relativeTime(h.createdAt),
      })),
      [
        { key: 'action', header: 'Action', width: 15 },
        { key: 'status', header: 'Status Change', width: 25 },
        { key: 'version', header: 'Version', width: 12 },
        { key: 'reason', header: 'Reason', width: 20 },
        { key: 'when', header: 'When', width: 15 },
      ]
    );

    console.log();
  } catch (err) {
    error('Failed to get pod history', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Stop command handler - stops a pod
 */
async function stopHandler(podId: string, options: { force?: boolean }): Promise<void> {
  requireAuth();

  info(`Stopping pod: ${podId}`);

  try {
    const api = createApiClient();
    const response = await api.delete(`/api/pods/${podId}${options.force ? '?force=true' : ''}`);
    const result = (await response.json()) as ApiResponse<{ deleted: boolean }>;

    if (!result.success) {
      error('Failed to stop pod', result.error);
      process.exit(1);
    }

    success(`Pod stopped: ${podId}`);
  } catch (err) {
    error('Failed to stop pod', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Logs command handler - shows pod logs (placeholder)
 */
async function logsHandler(
  podId: string,
  options: { follow?: boolean; tail?: string }
): Promise<void> {
  requireAuth();

  info(`Fetching logs for pod: ${podId}`);

  // This is a placeholder - actual implementation would connect to the node
  // and stream logs via WebSocket

  if (options.follow) {
    info('Following logs... (Press Ctrl+C to stop)');
    // Would set up WebSocket connection here
  }

  warn('Log streaming is not yet implemented');
  info('Pod logs would appear here when available');
}

/**
 * Creates the pod command group
 */
export function createPodCommand(): Command {
  const pod = new Command('pod')
    .description('Pod management commands');

  // Main pod create command
  pod
    .command('create [pack]')
    .alias('run')
    .description('Deploy a pack')
    .option('--pack <packName>', 'Pack name to deploy')
    .option('-V, --ver <version>', 'Pack version (defaults to latest)')
    .option('-n, --node <nodeId>', 'Target node ID')
    .option('--namespace <namespace>', 'Target namespace', 'default')
    .option('-p, --priority <priority>', 'Pod priority (0-1000)', '100')
    .option('-l, --label <key=value...>', 'Pod labels')
    .option('-r, --replicas <count>', 'Number of replicas', '1')
    .option('-s, --node-selector <key=value...>', 'Node selector (can be repeated)')
    .option('-t, --toleration <key=value:effect...>', 'Toleration (can be repeated)')
    .option('--cpu <millicores>', 'CPU request in millicores')
    .option('--memory <mb>', 'Memory request in MB')
    .action(createHandler);

  // List pods
  pod
    .command('list')
    .alias('ls')
    .description('List pods')
    .option('--namespace <namespace>', 'Filter by namespace')
    .option('-s, --status <status>', 'Filter by status')
    .option('-n, --node <nodeId>', 'Filter by node')
    .option('--pack <packName>', 'Filter by pack name')
    .option('-p, --page <page>', 'Page number')
    .option('--limit <limit>', 'Results per page')
    .action(listHandler);

  // Pod status
  pod
    .command('status <podId>')
    .description('Show pod status')
    .action(statusHandler);

  // Rollback
  pod
    .command('rollback <podId>')
    .description('Rollback pod to a previous version')
    .option('-V, --ver <version>', 'Target version (defaults to previous)')
    .option('-r, --reason <reason>', 'Reason for rollback')
    .action(rollbackHandler);

  // History
  pod
    .command('history <podId>')
    .description('Show pod history')
    .action(historyHandler);

  // Stop pod
  pod
    .command('stop <podId>')
    .description('Stop a pod')
    .option('-f, --force', 'Force stop without graceful shutdown')
    .action(stopHandler);

  // Logs
  pod
    .command('logs <podId>')
    .description('Show pod logs')
    .option('-f, --follow', 'Follow log output')
    .option('-t, --tail <lines>', 'Number of lines to show from end')
    .action(logsHandler);

  return pod;
}
