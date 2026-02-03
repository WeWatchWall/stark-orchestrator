/**
 * Deployment Commands
 *
 * Deployment management commands: create, list, status, scale, delete
 * @module @stark-o/cli/commands/deployment
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'node:readline';
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
} from '../output.js';
import type { DeploymentStatus } from '@stark-o/shared';

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

interface Deployment {
  id: string;
  name: string;
  packId: string;
  packVersion: string;
  namespace: string;
  replicas: number;
  status: DeploymentStatus;
  statusMessage?: string;
  readyReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface DeploymentListItem {
  id: string;
  name: string;
  packId: string;
  packVersion: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  status: DeploymentStatus;
  createdAt: string;
}

/**
 * Create command handler
 */
async function createHandler(
  nameArg: string | undefined,
  options: {
    name?: string;
    pack: string;
    ver?: string;
    namespace?: string;
    replicas?: string;
    label?: string[];
    podLabel?: string[];
    nodeSelector?: string[];
    toleration?: string[];
    cpu?: string;
    memory?: string;
    minNodeVersion?: string;
    yes?: boolean;
  }
): Promise<void> {
  const name = nameArg || options.name;

  if (!name) {
    error('Deployment name is required');
    process.exit(1);
  }

  if (!options.pack) {
    error('Pack name is required (--pack)');
    process.exit(1);
  }

  requireAuth();
  const config = loadConfig();

  const replicas = options.replicas !== undefined ? parseInt(options.replicas, 10) : 1;
  const replicasDesc = replicas === 0 ? 'all matching nodes (DaemonSet mode)' : `${replicas} replica(s)`;

  info(`Creating deployment: ${name} → ${options.pack}${options.ver ? '@' + options.ver : ''}`);
  info(`Replicas: ${replicasDesc}`);

  try {
    const api = createApiClient();

    // Build deployment request
    const deploymentRequest: Record<string, unknown> = {
      name,
      packName: options.pack,
      packVersion: options.ver,
      namespace: options.namespace ?? config.defaultNamespace ?? 'default',
      replicas,
    };

    // Parse labels
    if (options.label && options.label.length > 0) {
      const labels: Record<string, string> = {};
      for (const l of options.label) {
        const [key, value] = l.split('=');
        if (key && value) {
          labels[key] = value;
        }
      }
      deploymentRequest.labels = labels;
    }

    // Parse pod labels
    if (options.podLabel && options.podLabel.length > 0) {
      const podLabels: Record<string, string> = {};
      for (const l of options.podLabel) {
        const [key, value] = l.split('=');
        if (key && value) {
          podLabels[key] = value;
        }
      }
      deploymentRequest.podLabels = podLabels;
    }

    // Parse node selectors
    if (options.nodeSelector && options.nodeSelector.length > 0) {
      const nodeSelector: Record<string, string> = {};
      for (const s of options.nodeSelector) {
        const [key, value] = s.split('=');
        if (key && value) {
          nodeSelector[key] = value;
        }
      }
      deploymentRequest.scheduling = { nodeSelector };
    }

    // Parse tolerations
    if (options.toleration && options.toleration.length > 0) {
      const tolerations: Array<{ key: string; value?: string; effect?: string; operator: string }> = [];
      for (const t of options.toleration) {
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
          tolerations.push({ key: t, operator: 'Exists' });
        }
      }
      deploymentRequest.tolerations = tolerations;
    }

    // Parse resource requests
    if (options.cpu || options.memory) {
      deploymentRequest.resourceRequests = {
        cpu: options.cpu ? parseInt(options.cpu, 10) : 100,
        memory: options.memory ? parseInt(options.memory, 10) : 128,
      };
    }

    // Handle Node version compatibility
    let minNodeVersion = options.minNodeVersion;
    if (!minNodeVersion && !options.yes) {
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

    // Add minNodeVersion to pack metadata if specified
    if (minNodeVersion) {
      deploymentRequest.packMetadata = {
        ...(deploymentRequest.packMetadata as Record<string, unknown> ?? {}),
        minNodeVersion,
      };
    }

    const response = await api.post('/api/deployments', deploymentRequest);
    const result = (await response.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!result.success || !result.data) {
      error('Failed to create deployment', result.error);
      process.exit(1);
    }

    const deployment = result.data.deployment;

    success(`Deployment '${deployment.name}' created`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(deployment, null, 2));
      return;
    }

    console.log();
    keyValue({
      'ID': deployment.id,
      'Name': deployment.name,
      'Pack Version': deployment.packVersion,
      'Namespace': deployment.namespace,
      'Replicas': deployment.replicas === 0 ? 'DaemonSet (all nodes)' : deployment.replicas.toString(),
      'Status': statusBadge(deployment.status),
    });

    console.log();
    info(`The deployment controller will create pods automatically.`);
    info(`Use 'stark deployment status ${deployment.name}' to check progress.`);
  } catch (err) {
    error('Failed to create deployment', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * List command handler
 */
async function listHandler(options: {
  namespace?: string;
  status?: string;
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
    if (options.page) {
      params.set('page', options.page);
    }
    if (options.limit) {
      params.set('pageSize', options.limit);
    }

    const url = `/api/deployments${params.toString() ? '?' + params.toString() : ''}`;
    const response = await api.get(url);
    const result = (await response.json()) as ApiResponse<{ deployments: DeploymentListItem[] }>;

    if (!result.success || !result.data) {
      error('Failed to list deployments', result.error);
      process.exit(1);
    }

    const deployments = result.data.deployments;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (deployments.length === 0) {
      info('No deployments found');
      return;
    }

    console.log(chalk.bold(`\nDeployments (${deployments.length})\n`));

    table(
      deployments.map((d) => ({
        name: d.name,
        pack: d.packVersion,
        replicas: d.replicas === 0 ? 'DaemonSet' : `${d.readyReplicas}/${d.replicas}`,
        status: statusBadge(d.status),
        namespace: d.namespace,
      })),
      [
        { key: 'name', header: 'Name', width: 25 },
        { key: 'pack', header: 'Version', width: 15 },
        { key: 'replicas', header: 'Ready', width: 12 },
        { key: 'status', header: 'Status', width: 12 },
        { key: 'namespace', header: 'Namespace', width: 15 },
      ]
    );

    console.log();
  } catch (err) {
    error('Failed to list deployments', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Status command handler
 */
async function statusHandler(name: string, options: { namespace?: string }): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    const response = await api.get(`/api/deployments/name/${name}?namespace=${namespace}`);
    const result = (await response.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!result.success || !result.data) {
      error('Deployment not found', result.error);
      process.exit(1);
    }

    const deployment = result.data.deployment;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(deployment, null, 2));
      return;
    }

    console.log(chalk.bold(`\nDeployment: ${deployment.name}\n`));

    const replicaDisplay = deployment.replicas === 0
      ? 'DaemonSet (deploy to all matching nodes)'
      : deployment.replicas.toString();

    keyValue({
      'ID': deployment.id,
      'Status': statusBadge(deployment.status),
      'Message': deployment.statusMessage ?? chalk.gray('(none)'),
      'Pack ID': deployment.packId,
      'Pack Version': deployment.packVersion,
      'Namespace': deployment.namespace,
      'Replicas': replicaDisplay,
      'Ready': `${deployment.readyReplicas}/${deployment.replicas === 0 ? 'N/A' : deployment.replicas}`,
      'Available': deployment.availableReplicas.toString(),
      'Updated': deployment.updatedReplicas.toString(),
      'Created': new Date(deployment.createdAt).toLocaleString(),
      'Updated At': new Date(deployment.updatedAt).toLocaleString(),
    });

    console.log();
  } catch (err) {
    error('Failed to get deployment status', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Scale command handler
 */
async function scaleHandler(
  name: string,
  options: { replicas: string; namespace?: string }
): Promise<void> {
  requireAuth();

  const replicas = parseInt(options.replicas, 10);
  if (isNaN(replicas) || replicas < 0) {
    error('Replicas must be a non-negative number');
    process.exit(1);
  }

  const replicasDesc = replicas === 0 ? 'DaemonSet mode (all matching nodes)' : `${replicas} replica(s)`;
  info(`Scaling deployment '${name}' to ${replicasDesc}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // First get the deployment
    const getResponse = await api.get(`/api/deployments/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!getResult.success || !getResult.data) {
      error('Deployment not found', getResult.error);
      process.exit(1);
    }

    const deploymentId = getResult.data.deployment.id;

    // Scale it
    const response = await api.post(`/api/deployments/${deploymentId}/scale`, { replicas });
    const result = (await response.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!result.success || !result.data) {
      error('Failed to scale deployment', result.error);
      process.exit(1);
    }

    success(`Deployment '${name}' scaled to ${replicasDesc}`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data.deployment, null, 2));
    }
  } catch (err) {
    error('Failed to scale deployment', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Delete command handler
 */
async function deleteHandler(name: string, options: { namespace?: string; force?: boolean }): Promise<void> {
  requireAuth();

  if (!options.force) {
    warn(`This will delete deployment '${name}' and stop all associated pods.`);
    warn('Use --force to confirm deletion.');
    process.exit(1);
  }

  info(`Deleting deployment: ${name}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // First get the deployment
    const getResponse = await api.get(`/api/deployments/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!getResult.success || !getResult.data) {
      error('Deployment not found', getResult.error);
      process.exit(1);
    }

    const deploymentId = getResult.data.deployment.id;

    // Delete it
    const response = await api.delete(`/api/deployments/${deploymentId}`);
    const result = (await response.json()) as ApiResponse<{ deleted: boolean }>;

    if (!result.success) {
      error('Failed to delete deployment', result.error);
      process.exit(1);
    }

    success(`Deployment '${name}' deleted`);
  } catch (err) {
    error('Failed to delete deployment', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Pause command handler
 */
async function pauseHandler(name: string, options: { namespace?: string }): Promise<void> {
  requireAuth();

  info(`Pausing deployment: ${name}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // Get deployment
    const getResponse = await api.get(`/api/deployments/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!getResult.success || !getResult.data) {
      error('Deployment not found', getResult.error);
      process.exit(1);
    }

    const deploymentId = getResult.data.deployment.id;

    // Update status to paused
    const response = await api.patch(`/api/deployments/${deploymentId}`, { status: 'paused' });
    const result = (await response.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!result.success) {
      error('Failed to pause deployment', result.error);
      process.exit(1);
    }

    success(`Deployment '${name}' paused`);
  } catch (err) {
    error('Failed to pause deployment', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Resume command handler
 */
async function resumeHandler(name: string, options: { namespace?: string }): Promise<void> {
  requireAuth();

  info(`Resuming deployment: ${name}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // Get deployment
    const getResponse = await api.get(`/api/deployments/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!getResult.success || !getResult.data) {
      error('Deployment not found', getResult.error);
      process.exit(1);
    }

    const deploymentId = getResult.data.deployment.id;

    // Update status to active
    const response = await api.patch(`/api/deployments/${deploymentId}`, { status: 'active' });
    const result = (await response.json()) as ApiResponse<{ deployment: Deployment }>;

    if (!result.success) {
      error('Failed to resume deployment', result.error);
      process.exit(1);
    }

    success(`Deployment '${name}' resumed`);
  } catch (err) {
    error('Failed to resume deployment', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Creates the deployment command group
 */
export function createDeploymentCommand(): Command {
  const deployment = new Command('deployment')
    .alias('deploy')
    .description('Deployment management commands');

  // Create deployment
  deployment
    .command('create [name]')
    .description('Create a persistent deployment')
    .option('--name <name>', 'Deployment name')
    .requiredOption('--pack <packName>', 'Pack name to deploy')
    .option('-V, --ver <version>', 'Pack version (defaults to latest)')
    .option('--namespace <namespace>', 'Target namespace', 'default')
    .option('-r, --replicas <count>', 'Number of replicas (0 = all matching nodes)', '1')
    .option('-l, --label <key=value...>', 'Deployment labels')
    .option('--pod-label <key=value...>', 'Labels applied to created pods')
    .option('-s, --node-selector <key=value...>', 'Node selector (can be repeated)')
    .option('-t, --toleration <key=value:effect...>', 'Toleration (can be repeated)')
    .option('--cpu <millicores>', 'CPU request in millicores')
    .option('--memory <mb>', 'Memory request in MB')
    .option('--min-node-version <version>', 'Minimum Node.js version required (e.g., 18, 20.10.0)')
    .option('-y, --yes', 'Skip confirmation prompts')
    .action(createHandler);

  // List deployments
  deployment
    .command('list')
    .alias('ls')
    .description('List deployments')
    .option('--namespace <namespace>', 'Filter by namespace')
    .option('-s, --status <status>', 'Filter by status')
    .option('-p, --page <page>', 'Page number')
    .option('--limit <limit>', 'Results per page')
    .action(listHandler);

  // Deployment status
  deployment
    .command('status <name>')
    .description('Show deployment status')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(statusHandler);

  // Scale deployment
  deployment
    .command('scale <name>')
    .description('Scale deployment replicas')
    .requiredOption('-r, --replicas <count>', 'Number of replicas (0 = all matching nodes)')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(scaleHandler);

  // Pause deployment
  deployment
    .command('pause <name>')
    .description('Pause deployment reconciliation')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(pauseHandler);

  // Resume deployment
  deployment
    .command('resume <name>')
    .description('Resume deployment reconciliation')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(resumeHandler);

  // Delete deployment
  deployment
    .command('delete <name>')
    .alias('rm')
    .description('Delete a deployment')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .option('-f, --force', 'Force deletion without confirmation')
    .action(deleteHandler);

  return deployment;
}
