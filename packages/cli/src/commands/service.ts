/**
 * Service Commands
 *
 * Service management commands: create, list, status, scale, delete
 * @module @stark-o/cli/commands/service
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
} from '../output.js';
import type { ServiceStatus } from '@stark-o/shared';

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

interface Service {
  id: string;
  name: string;
  packId: string;
  packVersion: string;
  namespace: string;
  replicas: number;
  status: ServiceStatus;
  statusMessage?: string;
  readyReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  visibility?: string;
  exposed?: boolean;
  allowedSources?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface ServiceListItem {
  id: string;
  name: string;
  packId: string;
  packVersion: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  status: ServiceStatus;
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
    visibility?: string;
    label?: string[];
    podLabel?: string[];
    nodeSelector?: string[];
    toleration?: string[];
    cpu?: string;
    memory?: string;
    expose?: string;
    secret?: string[];
  }
): Promise<void> {
  const name = nameArg || options.name;

  if (!name) {
    error('Service name is required');
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

  info(`Creating service: ${name} → ${options.pack}${options.ver ? '@' + options.ver : ''}`);
  info(`Replicas: ${replicasDesc}`);

  // Validate visibility
  const validVisibility = ['public', 'private', 'system'];
  const visibility = options.visibility ?? 'private';
  if (!validVisibility.includes(visibility)) {
    error(`Visibility must be one of: ${validVisibility.join(', ')}`);
    process.exit(1);
  }
  info(`Visibility: ${visibility}`);

  try {
    const api = createApiClient();

    // Build service request
    const serviceRequest: Record<string, unknown> = {
      name,
      packName: options.pack,
      packVersion: options.ver,
      namespace: options.namespace ?? config.defaultNamespace ?? 'default',
      replicas,
      visibility: options.visibility ?? 'private',
    };

    // Attach secrets (names only — injection is defined by the secret)
    if (options.secret && options.secret.length > 0) {
      serviceRequest.secrets = options.secret;
      info(`Secrets: ${options.secret.join(', ')}`);
    }

    // Parse labels
    if (options.label && options.label.length > 0) {
      const labels: Record<string, string> = {};
      for (const l of options.label) {
        const [key, value] = l.split('=');
        if (key && value) {
          labels[key] = value;
        }
      }
      serviceRequest.labels = labels;
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
      serviceRequest.podLabels = podLabels;
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
      serviceRequest.scheduling = { nodeSelector };
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
      serviceRequest.tolerations = tolerations;
    }

    // Parse resource requests
    if (options.cpu || options.memory) {
      serviceRequest.resourceRequests = {
        cpu: options.cpu ? parseInt(options.cpu, 10) : 100,
        memory: options.memory ? parseInt(options.memory, 10) : 128,
      };
    }

    // Parse ingress port
    if (options.expose) {
      const port = parseInt(options.expose, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        error('Expose port must be a number between 1 and 65535');
        process.exit(1);
      }
      serviceRequest.ingressPort = port;
      info(`Ingress: exposing port ${port} on orchestrator`);
    }

    const response = await api.post('/api/services', serviceRequest);
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success || !result.data) {
      error('Failed to create service', result.error);
      process.exit(1);
    }

    const service = result.data.service;

    success(`Service '${service.name}' created`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(service, null, 2));
      return;
    }

    console.log();
    keyValue({
      'ID': service.id,
      'Name': service.name,
      'Pack Version': service.packVersion,
      'Namespace': service.namespace,
      'Replicas': service.replicas === 0 ? 'DaemonSet (all nodes)' : service.replicas.toString(),
      'Visibility': (service as any).visibility ?? 'private',
      'Ingress Port': (service as any).ingressPort ? (service as any).ingressPort.toString() : chalk.gray('(none)'),
      'Status': statusBadge(service.status),
    });

    console.log();
    info(`The service controller will create pods automatically.`);
    info(`Use 'stark service status ${service.name}' to check progress.`);
  } catch (err) {
    error('Failed to create service', err instanceof Error ? { message: err.message } : undefined);
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

    const url = `/api/services${params.toString() ? '?' + params.toString() : ''}`;
    const response = await api.get(url);
    const result = (await response.json()) as ApiResponse<{ services: ServiceListItem[] }>;

    if (!result.success || !result.data) {
      error('Failed to list services', result.error);
      process.exit(1);
    }

    const services = result.data.services;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (services.length === 0) {
      info('No services found');
      return;
    }

    console.log(chalk.bold(`\nServices (${services.length})\n`));

    table(
      services.map((d) => ({
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
    error('Failed to list services', err instanceof Error ? { message: err.message } : undefined);
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
    const response = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success || !result.data) {
      error('Service not found', result.error);
      process.exit(1);
    }

    const service = result.data.service;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(service, null, 2));
      return;
    }

    console.log(chalk.bold(`\nService: ${service.name}\n`));

    const replicaDisplay = service.replicas === 0
      ? 'DaemonSet (deploy to all matching nodes)'
      : service.replicas.toString();

    keyValue({
      'ID': service.id,
      'Status': statusBadge(service.status),
      'Message': service.statusMessage ?? chalk.gray('(none)'),
      'Pack ID': service.packId,
      'Pack Version': service.packVersion,
      'Namespace': service.namespace,
      'Replicas': replicaDisplay,
      'Ready': `${service.readyReplicas}/${service.replicas === 0 ? 'N/A' : service.replicas}`,
      'Available': service.availableReplicas.toString(),
      'Updated': service.updatedReplicas.toString(),
      'Created': new Date(service.createdAt).toLocaleString(),
      'Updated At': new Date(service.updatedAt).toLocaleString(),
    });

    console.log();
  } catch (err) {
    error('Failed to get service status', err instanceof Error ? { message: err.message } : undefined);
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
  info(`Scaling service '${name}' to ${replicasDesc}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // First get the service
    const getResponse = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ service: Service }>;

    if (!getResult.success || !getResult.data) {
      error('Service not found', getResult.error);
      process.exit(1);
    }

    const serviceId = getResult.data.service.id;

    // Scale it
    const response = await api.post(`/api/services/${serviceId}/scale`, { replicas });
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success || !result.data) {
      error('Failed to scale service', result.error);
      process.exit(1);
    }

    success(`Service '${name}' scaled to ${replicasDesc}`);

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data.service, null, 2));
    }
  } catch (err) {
    error('Failed to scale service', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Delete command handler
 */
async function deleteHandler(name: string, options: { namespace?: string; force?: boolean }): Promise<void> {
  requireAuth();

  if (!options.force) {
    warn(`This will delete service '${name}' and stop all associated pods.`);
    warn('Use --force to confirm deletion.');
    process.exit(1);
  }

  info(`Deleting service: ${name}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // First get the service
    const getResponse = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ service: Service }>;

    if (!getResult.success || !getResult.data) {
      error('Service not found', getResult.error);
      process.exit(1);
    }

    const serviceId = getResult.data.service.id;

    // Delete it
    const response = await api.delete(`/api/services/${serviceId}`);

    if (!response.ok) {
      const result = (await response.json().catch(() => ({ success: false }))) as ApiResponse<{ deleted: boolean }>;
      error('Failed to delete service', result.error);
      process.exit(1);
    }

    success(`Service '${name}' deleted`);
  } catch (err) {
    error('Failed to delete service', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Pause command handler
 */
async function pauseHandler(name: string, options: { namespace?: string }): Promise<void> {
  requireAuth();

  info(`Pausing service: ${name}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // Get service
    const getResponse = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ service: Service }>;

    if (!getResult.success || !getResult.data) {
      error('Service not found', getResult.error);
      process.exit(1);
    }

    const serviceId = getResult.data.service.id;

    // Update status to paused
    const response = await api.patch(`/api/services/${serviceId}`, { status: 'paused' });
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success) {
      error('Failed to pause service', result.error);
      process.exit(1);
    }

    success(`Service '${name}' paused`);
  } catch (err) {
    error('Failed to pause service', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Resume command handler
 */
async function resumeHandler(name: string, options: { namespace?: string }): Promise<void> {
  requireAuth();

  info(`Resuming service: ${name}`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';
    
    // Get service
    const getResponse = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ service: Service }>;

    if (!getResult.success || !getResult.data) {
      error('Service not found', getResult.error);
      process.exit(1);
    }

    const serviceId = getResult.data.service.id;

    // Update status to active
    const response = await api.patch(`/api/services/${serviceId}`, { status: 'active' });
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success) {
      error('Failed to resume service', result.error);
      process.exit(1);
    }

    success(`Service '${name}' resumed`);
  } catch (err) {
    error('Failed to resume service', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Set visibility command handler
 */
async function setVisibilityHandler(
  name: string,
  visibility: string,
  options: { namespace?: string },
): Promise<void> {
  requireAuth();

  const validValues = ['public', 'private', 'system'];
  if (!validValues.includes(visibility)) {
    error(`Visibility must be one of: ${validValues.join(', ')}`);
    process.exit(1);
  }

  info(`Setting visibility for service '${name}' to '${visibility}'`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';

    // Get service by name
    const getResponse = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ service: Service }>;

    if (!getResult.success || !getResult.data) {
      error('Service not found', getResult.error);
      process.exit(1);
    }

    const serviceId = getResult.data.service.id;

    // Set visibility
    const response = await api.post(`/api/services/${serviceId}/visibility`, { visibility });
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success) {
      error('Failed to set visibility', result.error);
      process.exit(1);
    }

    success(`Service '${name}' visibility set to '${visibility}'`);
  } catch (err) {
    error('Failed to set visibility', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Expose command handler
 */
async function exposeCommandHandler(
  name: string,
  options: { namespace?: string },
): Promise<void> {
  requireAuth();

  info(`Exposing service '${name}' to ingress`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';

    const getResponse = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ service: Service }>;

    if (!getResult.success || !getResult.data) {
      error('Service not found', getResult.error);
      process.exit(1);
    }

    const serviceId = getResult.data.service.id;

    const response = await api.post(`/api/services/${serviceId}/expose`, {});
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success) {
      error('Failed to expose service', result.error);
      process.exit(1);
    }

    success(`Service '${name}' is now exposed (reachable from ingress)`);
  } catch (err) {
    error('Failed to expose service', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Unexpose command handler
 */
async function unexposeCommandHandler(
  name: string,
  options: { namespace?: string },
): Promise<void> {
  requireAuth();

  info(`Unexposing service '${name}' from ingress`);

  try {
    const api = createApiClient();
    const namespace = options.namespace ?? 'default';

    const getResponse = await api.get(`/api/services/name/${name}?namespace=${namespace}`);
    const getResult = (await getResponse.json()) as ApiResponse<{ service: Service }>;

    if (!getResult.success || !getResult.data) {
      error('Service not found', getResult.error);
      process.exit(1);
    }

    const serviceId = getResult.data.service.id;

    const response = await api.post(`/api/services/${serviceId}/unexpose`, {});
    const result = (await response.json()) as ApiResponse<{ service: Service }>;

    if (!result.success) {
      error('Failed to unexpose service', result.error);
      process.exit(1);
    }

    success(`Service '${name}' is now unexposed (not reachable from ingress)`);
  } catch (err) {
    error('Failed to unexpose service', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Creates the service command group
 */
export function createServiceCommand(): Command {
  const service = new Command('service')
    .alias('deploy')
    .description('Service management commands');

  // Create service
  service
    .command('create [name]')
    .description('Create a persistent service')
    .option('--name <name>', 'Service name')
    .requiredOption('--pack <packName>', 'Pack name to deploy')
    .option('-V, --ver <version>', 'Pack version (defaults to latest)')
    .option('--namespace <namespace>', 'Target namespace', 'default')
    .option('-r, --replicas <count>', 'Number of replicas (0 = all matching nodes)', '1')
    .option('--visibility <level>', 'Network visibility (public, private, system)', 'private')
    .option('-l, --label <key=value...>', 'Service labels')
    .option('--pod-label <key=value...>', 'Labels applied to created pods')
    .option('-s, --node-selector <key=value...>', 'Node selector (can be repeated)')
    .option('-t, --toleration <key=value:effect...>', 'Toleration (can be repeated)')
    .option('--cpu <millicores>', 'CPU request in millicores')
    .option('--memory <mb>', 'Memory request in MB')
    .option('--expose <port>', 'Expose ingress port on orchestrator server')
    .option('--secret <name...>', 'Secret name to attach (can be repeated)')
    .action(createHandler);

  // List services
  service
    .command('list')
    .alias('ls')
    .description('List services')
    .option('--namespace <namespace>', 'Filter by namespace')
    .option('-s, --status <status>', 'Filter by status')
    .option('-p, --page <page>', 'Page number')
    .option('--limit <limit>', 'Results per page')
    .action(listHandler);

  // Service status
  service
    .command('status <name>')
    .description('Show service status')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(statusHandler);

  // Scale service
  service
    .command('scale <name>')
    .description('Scale service replicas')
    .requiredOption('-r, --replicas <count>', 'Number of replicas (0 = all matching nodes)')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(scaleHandler);

  // Set visibility
  service
    .command('set-visibility <name> <visibility>')
    .description('Set network visibility for a service (public, private, or system)')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(setVisibilityHandler);

  // Expose service
  service
    .command('expose <name>')
    .description('Expose service to ingress (make reachable from external traffic)')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(exposeCommandHandler);

  // Unexpose service
  service
    .command('unexpose <name>')
    .description('Unexpose service from ingress (remove from external traffic)')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(unexposeCommandHandler);

  // Pause service
  service
    .command('pause <name>')
    .description('Pause service reconciliation')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(pauseHandler);

  // Resume service
  service
    .command('resume <name>')
    .description('Resume service reconciliation')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(resumeHandler);

  // Delete service
  service
    .command('delete <name>')
    .alias('rm')
    .description('Delete a service')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .option('-f, --force', 'Force deletion without confirmation')
    .action(deleteHandler);

  return service;
}
