/**
 * Network Commands
 *
 * Manage network policies and inspect the service registry.
 *
 * Examples:
 *   stark network allow api-service users-service
 *   stark network deny frontend-service db-service
 *   stark network policies
 *   stark network remove api-service users-service
 *   stark network registry
 *
 * @module @stark-o/cli/commands/network
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createApiClient, requireAuth, loadConfig } from '../config.js';
import {
  success, error, info, table, getOutputFormat,
} from '../output.js';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface NetworkPolicy {
  id: string;
  sourceService: string;
  targetService: string;
  action: 'allow' | 'deny';
  createdAt: number;
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function allowHandler(
  sourceService: string,
  targetService: string,
  options: { namespace?: string },
): Promise<void> {
  requireAuth();
  const config = loadConfig();
  const api = createApiClient(config);
  const namespace = options.namespace ?? config.defaultNamespace ?? 'default';

  try {
    // Create allow policy
    const res = await api.post('/api/network/policies', {
      sourceService,
      targetService,
      action: 'allow',
      namespace,
    });
    const body = (await res.json()) as ApiResponse<NetworkPolicy>;

    if (!body.success) {
      error(body.error?.message ?? 'Failed to create allow policy');
      process.exit(1);
    }

    // Also update allowedSources on target service
    const svcRes = await api.get(`/api/services/name/${targetService}?namespace=${namespace}`);
    const svcBody = (await svcRes.json()) as ApiResponse<{ service: { id: string } }>;
    if (svcBody.success && svcBody.data) {
      await api.post(`/api/services/${svcBody.data.service.id}/allow-source`, {
        sourceService,
      });
    }

    success(`Network policy created: ${chalk.green('ALLOW')} ${sourceService} → ${targetService} (namespace: ${namespace})`);
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to create network policy');
    process.exit(1);
  }
}

async function denyHandler(
  sourceService: string,
  targetService: string,
  options: { namespace?: string },
): Promise<void> {
  requireAuth();
  const config = loadConfig();
  const api = createApiClient(config);
  const namespace = options.namespace ?? config.defaultNamespace ?? 'default';

  try {
    const res = await api.post('/api/network/policies', {
      sourceService,
      targetService,
      action: 'deny',
      namespace,
    });
    const body = (await res.json()) as ApiResponse<NetworkPolicy>;

    if (!body.success) {
      error(body.error?.message ?? 'Failed to create deny policy');
      process.exit(1);
    }

    // Also remove from allowedSources on target service
    try {
      const svcRes = await api.get(`/api/services/name/${targetService}?namespace=${namespace}`);
      const svcBody = (await svcRes.json()) as ApiResponse<{ service: { id: string } }>;
      if (svcBody.success && svcBody.data) {
        await api.post(`/api/services/${svcBody.data.service.id}/deny-source`, {
          sourceService,
        });
      }
    } catch {
      // Non-fatal: allowedSources update failed but policy was created
    }

    success(`Network policy created: ${chalk.red('DENY')} ${sourceService} → ${targetService} (namespace: ${namespace})`);
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to create network policy');
    process.exit(1);
  }
}

async function removeHandler(
  sourceService: string,
  targetService: string,
  options: { namespace?: string },
): Promise<void> {
  requireAuth();
  const config = loadConfig();
  const api = createApiClient(config);
  const namespace = options.namespace ?? config.defaultNamespace ?? 'default';

  try {
    const res = await api.post('/api/network/policies/delete-pair', {
      sourceService,
      targetService,
      namespace,
    });
    const body = (await res.json()) as ApiResponse<{ deleted: boolean }>;

    if (!body.success) {
      error(body.error?.message ?? 'Failed to remove network policy');
      process.exit(1);
    }

    success(`Network policy removed: ${sourceService} → ${targetService} (namespace: ${namespace})`);
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to remove network policy');
    process.exit(1);
  }
}

async function policiesHandler(options: { namespace?: string }): Promise<void> {
  requireAuth();
  const config = loadConfig();
  const api = createApiClient(config);

  try {
    const params = new URLSearchParams();
    if (options.namespace) {
      params.set('namespace', options.namespace);
    }
    const url = `/api/network/policies${params.toString() ? '?' + params.toString() : ''}`;
    const res = await api.get(url);
    const body = (await res.json()) as ApiResponse<NetworkPolicy[]>;

    if (!body.success || !body.data) {
      error(body.error?.message ?? 'Failed to list network policies');
      process.exit(1);
    }

    const policies = body.data;

    if (policies.length === 0) {
      info('No network policies configured (all inter-service traffic is denied by default — add allow rules to enable communication)');
      return;
    }

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(policies, null, 2));
      return;
    }

    table(
      policies.map((p) => ({
        id: p.id,
        sourceService: p.sourceService,
        targetService: p.targetService,
        action: p.action === 'allow' ? chalk.green('ALLOW') : chalk.red('DENY'),
        createdAt: new Date(p.createdAt).toISOString(),
      })),
      [
        { key: 'id', header: 'ID' },
        { key: 'sourceService', header: 'Source Service' },
        { key: 'targetService', header: 'Target Service' },
        { key: 'action', header: 'Action' },
        { key: 'createdAt', header: 'Created' },
      ],
    );
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to list network policies');
    process.exit(1);
  }
}

async function registryHandler(): Promise<void> {
  requireAuth();
  const config = loadConfig();
  const api = createApiClient(config);

  try {
    const res = await api.get('/api/network/registry');
    const body = (await res.json()) as ApiResponse<Record<string, Array<{
      podId: string;
      nodeId: string;
      status: string;
      lastHeartbeat: number;
    }>>>;

    if (!body.success || !body.data) {
      error(body.error?.message ?? 'Failed to fetch service registry');
      process.exit(1);
    }

    const registry = body.data;
    const services = Object.keys(registry);

    if (services.length === 0) {
      info('Service registry is empty (no pods registered)');
      return;
    }

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(registry, null, 2));
      return;
    }

    // Flatten into rows
    const rows: Array<Record<string, unknown>> = [];
    for (const serviceId of services) {
      const pods = registry[serviceId] ?? [];
      for (const pod of pods) {
        const statusColor = pod.status === 'healthy' ? chalk.green : pod.status === 'unhealthy' ? chalk.red : chalk.yellow;
        rows.push({
          service: serviceId,
          podId: pod.podId,
          nodeId: pod.nodeId,
          status: statusColor(pod.status),
          lastHeartbeat: new Date(pod.lastHeartbeat).toISOString(),
        });
      }
    }

    table(rows, [
      { key: 'service', header: 'Service' },
      { key: 'podId', header: 'Pod ID' },
      { key: 'nodeId', header: 'Node ID' },
      { key: 'status', header: 'Status' },
      { key: 'lastHeartbeat', header: 'Last Heartbeat' },
    ]);
  } catch (err) {
    error(err instanceof Error ? err.message : 'Failed to fetch service registry');
    process.exit(1);
  }
}

// ── Command ─────────────────────────────────────────────────────────────────

export function createNetworkCommand(): Command {
  const cmd = new Command('network')
    .description('Manage inter-service network policies and inspect the service registry');

  cmd
    .command('allow <source-service> <target-service>')
    .description('Allow communication from source service to target service')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(allowHandler);

  cmd
    .command('deny <source-service> <target-service>')
    .description('Deny communication from source service to target service')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(denyHandler);

  cmd
    .command('remove <source-service> <target-service>')
    .description('Remove the network policy for a source → target pair')
    .option('--namespace <namespace>', 'Namespace', 'default')
    .action(removeHandler);

  cmd
    .command('policies')
    .alias('list')
    .description('List all network policies')
    .option('--namespace <namespace>', 'Filter by namespace')
    .action(policiesHandler);

  cmd
    .command('registry')
    .description('Show the service registry (all pods registered per service)')
    .action(registryHandler);

  return cmd;
}
