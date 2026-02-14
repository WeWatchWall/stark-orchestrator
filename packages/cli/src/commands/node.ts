/**
 * Node Commands
 *
 * Node management commands: list, status, agent
 * @module @stark-o/cli/commands/node
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as os from 'node:os';
import { createApiClient, requireAuth, loadConfig, createCliSupabaseClient, saveCredentials, type Credentials } from '../config.js';
import { randomBytes, randomInt } from 'node:crypto';
import {
  error,
  info,
  success,
  table,
  keyValue,
  getOutputFormat,
  statusBadge,
  relativeTime,
  formatBytes,
} from '../output.js';
import { 
  NodeAgent, 
  type NodeAgentConfig, 
  saveNodeCredentials,
  loadNodeCredentials,
  areNodeCredentialsValid,
  type NodeCredentials,
  getRegisteredNode,
} from '@stark-o/node-runtime';
import type { RuntimeType, NodeStatus, TaintEffect } from '@stark-o/shared';

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

interface Node {
  id: string;
  name: string;
  runtimeType: RuntimeType;
  status: NodeStatus;
  lastHeartbeat: string | null;
  registeredBy: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  taints: Array<{ key: string; value?: string; effect: string }>;
  unschedulable: boolean;
  allocatable: {
    cpu: number;
    memory: number;
    storage: number;
    pods: number;
  };
  allocated: {
    cpu: number;
    memory: number;
    storage: number;
    pods: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface NodeListResponse {
  nodes: Node[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Formats node status with color
 */
function formatNodeStatus(status: NodeStatus): string {
  return statusBadge(status);
}

/**
 * Formats resource usage as percentage
 */
function formatResourceUsage(allocated: number, allocatable: number): string {
  if (allocatable === 0) return chalk.gray('N/A');
  const pct = Math.round((allocated / allocatable) * 100);
  const text = `${pct}%`;

  if (pct >= 90) return chalk.red(text);
  if (pct >= 70) return chalk.yellow(text);
  return chalk.green(text);
}

/**
 * List command handler - lists all nodes
 */
async function listHandler(options: {
  status?: string;
  runtime?: string;
  label?: string[];
  page?: string;
  limit?: string;
}): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    const params = new URLSearchParams();

    if (options.status) {
      params.set('status', options.status);
    }
    if (options.runtime) {
      params.set('runtimeType', options.runtime);
    }
    if (options.label && options.label.length > 0) {
      // Convert labels to selector format
      const selector = options.label.join(',');
      params.set('labelSelector', selector);
    }
    if (options.page) {
      params.set('page', options.page);
    }
    if (options.limit) {
      params.set('pageSize', options.limit);
    }

    const url = `/api/nodes${params.toString() ? '?' + params.toString() : ''}`;
    const response = await api.get(url);
    const result = (await response.json()) as ApiResponse<NodeListResponse>;

    if (!result.success || !result.data) {
      error('Failed to list nodes', result.error);
      process.exit(1);
    }

    const { nodes, total } = result.data;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    if (nodes.length === 0) {
      info('No nodes found');
      return;
    }

    console.log(chalk.bold(`\nNodes (${nodes.length} of ${total})\n`));

    table(
      nodes.map((n) => ({
        name: n.name,
        runtime: n.runtimeType,
        status: formatNodeStatus(n.status),
        cpu: formatResourceUsage(n.allocated.cpu, n.allocatable.cpu),
        memory: formatResourceUsage(n.allocated.memory, n.allocatable.memory),
        pods: `${n.allocated.pods}/${n.allocatable.pods}`,
        heartbeat: n.lastHeartbeat ? relativeTime(n.lastHeartbeat) : chalk.gray('never'),
      })),
      [
        { key: 'name', header: 'Name', width: 25 },
        { key: 'runtime', header: 'Runtime', width: 10 },
        { key: 'status', header: 'Status', width: 15 },
        { key: 'cpu', header: 'CPU', width: 8 },
        { key: 'memory', header: 'Memory', width: 8 },
        { key: 'pods', header: 'Pods', width: 10 },
        { key: 'heartbeat', header: 'Last Seen', width: 15 },
      ]
    );

    console.log();
  } catch (err) {
    error('Failed to list nodes', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Status command handler - shows detailed status of a specific node
 * Accepts either node name or UUID
 */
async function statusHandler(nodeNameOrId: string): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();
    
    // Try to look up by name first, fall back to ID
    let response = await api.get(`/api/nodes/name/${encodeURIComponent(nodeNameOrId)}`);
    let result = (await response.json()) as ApiResponse<{ node: Node }>;
    
    // If not found by name, try by ID (for backward compatibility)
    if (!result.success) {
      response = await api.get(`/api/nodes/${nodeNameOrId}`);
      result = (await response.json()) as ApiResponse<{ node: Node }>;
    }

    if (!result.success || !result.data) {
      error('Failed to get node status', result.error);
      process.exit(1);
    }

    const node = result.data.node;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(node, null, 2));
      return;
    }

    console.log(chalk.bold(`\nNode: ${node.name}\n`));

    // Basic info
    console.log(chalk.underline('General'));
    keyValue({
      'ID': node.id,
      'Name': node.name,
      'Runtime': node.runtimeType,
      'Status': formatNodeStatus(node.status),
      'Registered By': node.registeredBy,
      'Last Heartbeat': node.lastHeartbeat
        ? `${relativeTime(node.lastHeartbeat)} (${new Date(node.lastHeartbeat).toLocaleString()})`
        : chalk.gray('never'),
    });

    console.log();

    // Resources
    console.log(chalk.underline('Resources'));
    keyValue({
      'CPU': `${node.allocated.cpu}/${node.allocatable.cpu} (${formatResourceUsage(node.allocated.cpu, node.allocatable.cpu)})`,
      'Memory': `${formatBytes(node.allocated.memory)}/${formatBytes(node.allocatable.memory)} (${formatResourceUsage(node.allocated.memory, node.allocatable.memory)})`,
      'Storage': `${formatBytes(node.allocated.storage)}/${formatBytes(node.allocatable.storage)}`,
      'Pods': `${node.allocated.pods}/${node.allocatable.pods}`,
    });

    console.log();

    // Labels
    if (Object.keys(node.labels).length > 0) {
      console.log(chalk.underline('Labels'));
      for (const [key, value] of Object.entries(node.labels)) {
        console.log(`  ${chalk.cyan(key)}: ${value}`);
      }
      console.log();
    }

    // Taints
    if (node.taints.length > 0) {
      console.log(chalk.underline('Taints'));
      for (const taint of node.taints) {
        const value = taint.value ? `=${taint.value}` : '';
        console.log(`  ${chalk.yellow(taint.key)}${value}:${taint.effect}`);
      }
      console.log();
    }

    // Timestamps
    console.log(chalk.underline('Timestamps'));
    keyValue({
      'Created': new Date(node.createdAt).toLocaleString(),
      'Updated': new Date(node.updatedAt).toLocaleString(),
    });

    console.log();
  } catch (err) {
    error('Failed to get node status', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Delete command handler - deletes a node by name
 */
async function deleteHandler(
  nodeName: string,
  options: { force?: boolean }
): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();

    // First, look up the node by name to get the ID
    const lookupResponse = await api.get(`/api/nodes/name/${encodeURIComponent(nodeName)}`);
    const lookupResult = (await lookupResponse.json()) as ApiResponse<{ node: Node }>;

    if (!lookupResult.success || !lookupResult.data) {
      error(`Node not found: ${nodeName}`, lookupResult.error);
      process.exit(1);
    }

    const node = lookupResult.data.node;

    // Confirmation prompt unless --force is used
    if (!options.force) {
      const readline = await import('node:readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          chalk.yellow(`Are you sure you want to delete node "${nodeName}" (${node.id})? [y/N] `),
          resolve
        );
      });
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        info('Deletion cancelled');
        return;
      }
    }

    // Delete the node by ID
    const deleteResponse = await api.delete(`/api/nodes/${node.id}`);
    const deleteResult = (await deleteResponse.json()) as ApiResponse<{ deleted: boolean }>;

    if (!deleteResult.success) {
      error('Failed to delete node', deleteResult.error);
      process.exit(1);
    }

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify({ deleted: true, node: { id: node.id, name: nodeName } }, null, 2));
      return;
    }

    success(`Node deleted: ${nodeName} (${node.id})`);
  } catch (err) {
    error('Failed to delete node', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Update command handler - updates node properties (labels, taints, etc.)
 */
async function updateHandler(
  nodeName: string,
  options: {
    label?: string[];
    removeLabel?: string[];
    taint?: string[];
    removeTaint?: string[];
    unschedulable?: boolean;
    schedulable?: boolean;
  }
): Promise<void> {
  requireAuth();

  try {
    const api = createApiClient();

    // First, look up the node by name to get the ID and current state
    const lookupResponse = await api.get(`/api/nodes/name/${encodeURIComponent(nodeName)}`);
    const lookupResult = (await lookupResponse.json()) as ApiResponse<{ node: Node }>;

    if (!lookupResult.success || !lookupResult.data) {
      error(`Node not found: ${nodeName}`, lookupResult.error);
      process.exit(1);
    }

    const node = lookupResult.data.node;

    // Build update payload
    const updatePayload: {
      labels?: Record<string, string>;
      taints?: Array<{ key: string; value?: string; effect: string }>;
      unschedulable?: boolean;
    } = {};

    // Handle labels
    if (options.label || options.removeLabel) {
      const newLabels = { ...node.labels };

      // Add new labels
      if (options.label) {
        for (const label of options.label) {
          const [key, value] = label.split('=');
          if (key && value !== undefined) {
            newLabels[key] = value;
          } else {
            error(`Invalid label format: ${label}. Use key=value`);
            process.exit(1);
          }
        }
      }

      // Remove labels
      if (options.removeLabel) {
        for (const key of options.removeLabel) {
          delete newLabels[key];
        }
      }

      updatePayload.labels = newLabels;
    }

    // Handle taints
    if (options.taint || options.removeTaint) {
      const validEffects: TaintEffect[] = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'];
      let newTaints = [...node.taints];

      // Add new taints
      if (options.taint) {
        for (const taint of options.taint) {
          // Format: key=value:effect or key:effect
          const colonIdx = taint.lastIndexOf(':');
          if (colonIdx === -1) {
            error(`Invalid taint format: ${taint}. Use key=value:effect or key:effect`);
            process.exit(1);
          }
          const effect = taint.slice(colonIdx + 1);
          if (!validEffects.includes(effect as TaintEffect)) {
            error(`Invalid taint effect: ${effect}. Must be one of: ${validEffects.join(', ')}`);
            process.exit(1);
          }
          const keyValue = taint.slice(0, colonIdx);
          const eqIdx = keyValue.indexOf('=');

          let newTaint: { key: string; value?: string; effect: string };
          if (eqIdx !== -1) {
            newTaint = {
              key: keyValue.slice(0, eqIdx),
              value: keyValue.slice(eqIdx + 1),
              effect,
            };
          } else {
            newTaint = { key: keyValue, effect };
          }

          // Replace existing taint with same key or add new
          const existingIdx = newTaints.findIndex(t => t.key === newTaint.key);
          if (existingIdx !== -1) {
            newTaints[existingIdx] = newTaint;
          } else {
            newTaints.push(newTaint);
          }
        }
      }

      // Remove taints by key
      if (options.removeTaint) {
        newTaints = newTaints.filter(t => !options.removeTaint!.includes(t.key));
      }

      updatePayload.taints = newTaints;
    }

    // Handle schedulability
    if (options.unschedulable !== undefined && options.unschedulable) {
      updatePayload.unschedulable = true;
    } else if (options.schedulable !== undefined && options.schedulable) {
      updatePayload.unschedulable = false;
    }

    // Check if there's anything to update
    if (Object.keys(updatePayload).length === 0) {
      error('No updates specified. Use --label, --remove-label, --taint, --remove-taint, --schedulable, or --unschedulable');
      process.exit(1);
    }

    // Perform the update
    const updateResponse = await api.patch(`/api/nodes/${node.id}`, updatePayload);
    const updateResult = (await updateResponse.json()) as ApiResponse<{ node: Node }>;

    if (!updateResult.success || !updateResult.data) {
      error('Failed to update node', updateResult.error);
      process.exit(1);
    }

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(updateResult.data.node, null, 2));
      return;
    }

    success(`Node updated: ${nodeName}`);

    // Show what changed
    const updatedNode = updateResult.data.node;

    if (updatePayload.labels) {
      const labelCount = Object.keys(updatedNode.labels).length;
      console.log(chalk.gray(`  Labels: ${labelCount > 0 ? Object.entries(updatedNode.labels).map(([k, v]) => `${k}=${v}`).join(', ') : '(none)'}`));
    }

    if (updatePayload.taints) {
      const taintCount = updatedNode.taints.length;
      console.log(chalk.gray(`  Taints: ${taintCount > 0 ? updatedNode.taints.map(t => `${t.key}${t.value ? '=' + t.value : ''}:${t.effect}`).join(', ') : '(none)'}`));
    }

    if (updatePayload.unschedulable !== undefined) {
      console.log(chalk.gray(`  Schedulable: ${!updatedNode.unschedulable}`));
    }
  } catch (err) {
    error('Failed to update node', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Watch command handler - watches node status changes
 */
async function watchHandler(options: { interval?: string }): Promise<void> {
  requireAuth();

  const intervalMs = parseInt(options.interval ?? '5', 10) * 1000;

  info(`Watching nodes (refresh every ${intervalMs / 1000}s). Press Ctrl+C to stop.`);
  console.log();

  const refresh = async () => {
    try {
      // Clear screen
      console.clear();
      console.log(chalk.bold('Node Status Monitor\n'));

      const api = createApiClient();
      const response = await api.get('/api/nodes');
      const result = (await response.json()) as ApiResponse<NodeListResponse>;

      if (!result.success || !result.data) {
        error('Failed to fetch nodes');
        return;
      }

      const { nodes, total } = result.data;

      // Summary - use correct NodeStatus values: 'online' | 'offline' | 'unhealthy' | 'draining' | 'maintenance'
      const online = nodes.filter((n) => n.status === 'online').length;
      const unhealthy = nodes.filter((n) => n.status === 'unhealthy').length;
      const offline = nodes.filter((n) => n.status === 'offline').length;

      console.log(`Total: ${total}  ${chalk.green(`Online: ${online}`)}  ${chalk.red(`Unhealthy: ${unhealthy}`)}  ${chalk.gray(`Offline: ${offline}`)}`);
      console.log();

      table(
        nodes.map((n) => ({
          name: n.name,
          status: formatNodeStatus(n.status),
          pods: `${n.allocated.pods}/${n.allocatable.pods}`,
          heartbeat: n.lastHeartbeat ? relativeTime(n.lastHeartbeat) : chalk.gray('never'),
        })),
        [
          { key: 'name', header: 'Name', width: 30 },
          { key: 'status', header: 'Status', width: 15 },
          { key: 'pods', header: 'Pods', width: 10 },
          { key: 'heartbeat', header: 'Last Seen', width: 15 },
        ]
      );

      console.log(`\nLast updated: ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      error('Failed to refresh', err instanceof Error ? { message: err.message } : undefined);
    }
  };

  // Initial refresh
  await refresh();

  // Set up interval
  const intervalId = setInterval(refresh, intervalMs);

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.log('\n\nStopped watching.');
    process.exit(0);
  });

  // Keep running
  await new Promise(() => {}); // Never resolves
}

/**
 * Creates the node command group
 */
export function createNodeCommand(): Command {
  const node = new Command('node')
    .description('Node management commands');

  node
    .command('list')
    .alias('ls')
    .description('List all nodes')
    .option('-s, --status <status>', 'Filter by status (healthy, unhealthy, offline)')
    .option('-r, --runtime <runtime>', 'Filter by runtime type (node, browser)')
    .option('-l, --label <selector...>', 'Filter by label selector (e.g., env=prod)')
    .option('-p, --page <page>', 'Page number')
    .option('--limit <limit>', 'Results per page')
    .action(listHandler);

  node
    .command('status <name>')
    .alias('info')
    .description('Show detailed status of a node')
    .action(statusHandler);

  node
    .command('delete <name>')
    .alias('rm')
    .description('Delete a node by name')
    .option('-f, --force', 'Skip confirmation prompt')
    .action(deleteHandler);

  node
    .command('update <name>')
    .description('Update node properties (labels, taints, schedulability)')
    .option('-l, --label <label...>', 'Add or update labels (format: key=value)')
    .option('--remove-label <key...>', 'Remove labels by key')
    .option('--taint <taint...>', 'Add or update taints (format: key=value:effect or key:effect)')
    .option('--remove-taint <key...>', 'Remove taints by key')
    .option('--unschedulable', 'Mark node as unschedulable (cordon)')
    .option('--schedulable', 'Mark node as schedulable (uncordon)')
    .action(updateHandler);

  node
    .command('watch')
    .description('Watch node status in real-time')
    .option('-i, --interval <seconds>', 'Refresh interval in seconds', '5')
    .action(watchHandler);

  // Agent subcommand group
  const agent = node
    .command('agent')
    .description('Node agent commands');

  agent
    .command('start')
    .description('Start a node agent to connect to the orchestrator')
    .option('-u, --url <url>', 'Orchestrator WebSocket URL', process.env.STARK_ORCHESTRATOR_URL ?? 'wss://localhost:443/ws')
    .option('-n, --name <name>', 'Unique node name', process.env.STARK_NODE_NAME ?? os.hostname())
    .option('-t, --token <token>', 'Authentication token', process.env.STARK_AUTH_TOKEN)
    .option('-e, --email <email>', 'Login email (alternative to token)', process.env.STARK_EMAIL)
    .option('-p, --password <password>', 'Login password (with email)', process.env.STARK_PASSWORD)
    .option('-l, --label <label...>', 'Node labels (format: key=value)')
    .option('--taint <taint...>', 'Node taints (format: key=value:effect)')
    .option('--cpu <millicores>', 'Allocatable CPU in millicores', '1000')
    .option('--memory <mb>', 'Allocatable memory in MB', '1024')
    .option('--pods <count>', 'Maximum concurrent pods', '10')
    .option('--heartbeat <seconds>', 'Heartbeat interval in seconds', '15')
    .action(agentStartHandler);

  return node;
}

/**
 * Generates a random string for email/password
 */
function generateRandomString(length: number): string {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Generates a secure random password meeting requirements
 */
function generateRandomPassword(): string {
  // Ensure we have uppercase, lowercase, digit, and sufficient length
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const all = upper + lower + digits;

  // Use cryptographically secure random for password generation
  const secureRandomIndex = (max: number): number => randomInt(max);
  
  // Start with one of each required type
  const chars: string[] = [
    upper[secureRandomIndex(upper.length)]!,
    lower[secureRandomIndex(lower.length)]!,
    digits[secureRandomIndex(digits.length)]!,
  ];
  
  // Fill to 16 characters
  for (let i = 0; i < 13; i++) {
    chars.push(all[secureRandomIndex(all.length)]!);
  }
  
  // Shuffle the password using Fisher-Yates with secure randomness
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/**
 * Agent start command handler - starts a node agent
 */
async function agentStartHandler(options: {
  url: string;
  name: string;
  token?: string;
  email?: string;
  password?: string;
  label?: string[];
  taint?: string[];
  cpu: string;
  memory: string;
  pods: string;
  heartbeat: string;
}): Promise<void> {
  // Resolve authentication token
  let authToken = options.token;

  if (!authToken && options.email && options.password) {
    // Authenticate with email/password to get token
    info('Authenticating with orchestrator...');
    try {
      const config = loadConfig();
      const supabase = createCliSupabaseClient(config);
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: options.email,
        password: options.password,
      });

      if (authError || !data.session) {
        error('Authentication failed', authError ? { message: authError.message } : undefined);
        process.exit(1);
      }

      authToken = data.session.access_token;

      // Save credentials for other CLI commands
      const credentials: Credentials = {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: new Date(data.session.expires_at! * 1000).toISOString(),
        userId: data.user!.id,
        email: data.user!.email!,
      };
      saveCredentials(credentials);

      // Also save as node credentials with password for re-login on refresh token expiry
      const nodeCredentials: NodeCredentials = {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: new Date(data.session.expires_at! * 1000).toISOString(),
        userId: data.user!.id,
        email: data.user!.email!,
        password: options.password,
        createdAt: new Date().toISOString(),
      };
      saveNodeCredentials(nodeCredentials);

      success(`Authenticated as ${options.email}`);
    } catch (err) {
      error('Authentication failed', err instanceof Error ? { message: err.message } : undefined);
      process.exit(1);
    }
  }

  // If still no auth token, check for stored node credentials first
  if (!authToken) {
    // Check if we have valid stored node credentials from a previous run
    if (areNodeCredentialsValid()) {
      const storedCreds = loadNodeCredentials();
      if (storedCreds) {
        info(`Using stored node credentials (${storedCreds.email})`);
        authToken = storedCreds.accessToken;
      }
    }
  }

  // If still no auth token, try auto-registration if public registration is enabled
  if (!authToken) {
    info('No authentication provided. Checking if public registration is available...');
    
    try {
      // Convert ws:// or wss:// URL to http:// or https:// for API calls
      const httpUrl = options.url
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/ws\/?$/, '');

      // Check setup status
      const statusResponse = await fetch(`${httpUrl}/auth/setup/status`);
      const statusResult = await statusResponse.json() as {
        success: boolean;
        data?: { needsSetup: boolean; registrationEnabled: boolean };
        error?: { message: string };
      };

      if (!statusResult.success || !statusResult.data) {
        error('Failed to check registration status', statusResult.error);
        process.exit(1);
      }

      if (!statusResult.data.registrationEnabled) {
        error('Authentication required and public registration is disabled. Provide --token or --email and --password');
        process.exit(1);
      }

      // Generate random credentials for auto-registration
      const randomId = generateRandomString(8);
      const autoEmail = `node-${randomId}@stark.com`;
      const autoPassword = generateRandomPassword();

      info(`Public registration is enabled. Auto-registering as ${autoEmail}...`);

      // Register the user with node role
      const registerResponse = await fetch(`${httpUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: autoEmail,
          password: autoPassword,
          displayName: `Node Agent ${options.name}`,
          roles: ['node'], // Request node role for node agents
        }),
      });

      const registerResult = await registerResponse.json() as {
        success: boolean;
        data?: {
          accessToken: string;
          refreshToken?: string;
          expiresAt: string;
          user: { id: string; email: string };
        };
        error?: { code: string; message: string };
      };

      if (!registerResult.success || !registerResult.data) {
        error('Auto-registration failed', registerResult.error);
        process.exit(1);
      }

      authToken = registerResult.data.accessToken;

      // Save node credentials for reuse across restarts (separate from CLI user credentials)
      const nodeCredentials: NodeCredentials = {
        accessToken: registerResult.data.accessToken,
        refreshToken: registerResult.data.refreshToken,
        expiresAt: registerResult.data.expiresAt,
        userId: registerResult.data.user.id,
        email: registerResult.data.user.email,
        password: autoPassword,
        createdAt: new Date().toISOString(),
      };
      saveNodeCredentials(nodeCredentials);
      success(`Auto-registered and authenticated as ${autoEmail}`);
    } catch (err) {
      error('Auto-registration failed', err instanceof Error ? { message: err.message } : undefined);
      process.exit(1);
    }
  }

  // Parse labels
  const labels: Record<string, string> = {};
  if (options.label) {
    for (const label of options.label) {
      const [key, value] = label.split('=');
      if (key && value !== undefined) {
        labels[key] = value;
      } else {
        error(`Invalid label format: ${label}. Use key=value`);
        process.exit(1);
      }
    }
  }

  // Parse taints
  const validEffects: TaintEffect[] = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'];
  const taints: Array<{ key: string; value?: string; effect: TaintEffect }> = [];
  if (options.taint) {
    for (const taint of options.taint) {
      // Format: key=value:effect or key:effect
      const colonIdx = taint.lastIndexOf(':');
      if (colonIdx === -1) {
        error(`Invalid taint format: ${taint}. Use key=value:effect or key:effect`);
        process.exit(1);
      }
      const effect = taint.slice(colonIdx + 1);
      if (!validEffects.includes(effect as TaintEffect)) {
        error(`Invalid taint effect: ${effect}. Must be one of: ${validEffects.join(', ')}`);
        process.exit(1);
      }
      const keyValue = taint.slice(0, colonIdx);
      const eqIdx = keyValue.indexOf('=');
      if (eqIdx !== -1) {
        taints.push({
          key: keyValue.slice(0, eqIdx),
          value: keyValue.slice(eqIdx + 1),
          effect: effect as TaintEffect,
        });
      } else {
        taints.push({ key: keyValue, effect: effect as TaintEffect });
      }
    }
  }

  // Build agent configuration
  const agentConfig: NodeAgentConfig = {
    orchestratorUrl: options.url,
    authToken,
    nodeName: options.name,
    runtimeType: 'node',
    allocatable: {
      cpu: parseInt(options.cpu, 10),
      memory: parseInt(options.memory, 10),
      pods: parseInt(options.pods, 10),
      storage: 10240, // Default 10GB
    },
    labels,
    taints,
    heartbeatInterval: parseInt(options.heartbeat, 10) * 1000,
    validateSsl: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  };

  // Check for existing registered node
  const existingNode = getRegisteredNode(options.url, options.name);
  if (existingNode) {
    info(`Resuming existing node: ${options.name}`);
    console.log(chalk.gray(`  Node ID: ${existingNode.nodeId}`));
    console.log(chalk.gray(`  Registered: ${new Date(existingNode.registeredAt).toLocaleString()}`));
    if (existingNode.lastStarted) {
      console.log(chalk.gray(`  Last started: ${new Date(existingNode.lastStarted).toLocaleString()}`));
    }
  } else {
    info(`Starting new node agent: ${options.name}`);
  }
  console.log(chalk.gray(`  Orchestrator: ${options.url}`));
  console.log(chalk.gray(`  CPU: ${options.cpu}m, Memory: ${options.memory}MB, Pods: ${options.pods}`));
  if (Object.keys(labels).length > 0) {
    console.log(chalk.gray(`  Labels: ${Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(', ')}`));
  }
  if (taints.length > 0) {
    console.log(chalk.gray(`  Taints: ${taints.map(t => `${t.key}${t.value ? '=' + t.value : ''}:${t.effect}`).join(', ')}`));
  }
  console.log();

  // Create and start the agent
  // Track if we need to restart due to invalid credentials
  let shouldRestartOnStop = false;
  // Promise that resolves when we should exit the main loop (for restart)
  let resolveStoppedPromise: (() => void) | null = null;
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStoppedPromise = resolve;
  });
  
  const agent = new NodeAgent(agentConfig);

  // Set up event handlers
  agent.on((event, data) => {
    switch (event) {
      case 'connecting':
        info('Connecting to orchestrator...');
        break;
      case 'connected':
        success('Connected to orchestrator');
        break;
      case 'authenticated':
        success('Authenticated successfully');
        break;
      case 'registered': {
        const nodeId = agent.getNodeId();
        if (existingNode && existingNode.nodeId === nodeId) {
          success(`Node resumed with ID: ${nodeId}`);
        } else {
          success(`Node registered with ID: ${nodeId}`);
        }
        console.log(chalk.green('\n✓ Node agent is running. Press Ctrl+C to stop.\n'));
        break;
      }
      case 'heartbeat':
        // Silent heartbeats in normal operation
        break;
      case 'disconnected':
        info('Disconnected from orchestrator');
        break;
      case 'reconnecting':
        info('Attempting to reconnect...');
        break;
      case 'credentials_invalid':
        info('Stored credentials are invalid. Will re-register with fresh credentials...');
        shouldRestartOnStop = true;
        break;
      case 'error':
        error('Agent error', data instanceof Error ? { message: data.message } : undefined);
        break;
      case 'stopped':
        info('Node agent stopped');
        // If we stopped due to invalid credentials, restart with fresh credentials
        if (shouldRestartOnStop && resolveStoppedPromise) {
          info('Retrying with fresh credentials...');
          resolveStoppedPromise();
        }
        break;
    }
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n');
    info('Shutting down node agent...');
    // Prevent restart when user manually shuts down
    shouldRestartOnStop = false;
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the agent with retry on auth failure
  try {
    await agent.start();
  } catch (err) {
    // Check if this is an AUTH_FAILED error (could be Error or raw payload object)
    const isAuthFailed = shouldRestartOnStop ||
      (err instanceof Error && err.message.includes('AUTH_FAILED')) ||
      (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'AUTH_FAILED');
    
    // If credentials were invalid (already cleared by agent), retry with auto-registration
    if (isAuthFailed) {
      info('Retrying with fresh credentials...');
      
      // Stop the current agent before retrying
      try {
        await agent.stop();
      } catch {
        // Ignore errors when stopping
      }
      
      // Retry by recursively calling this handler (credentials are now cleared, will trigger auto-registration)
      return agentStartHandler(options);
    }
    
    const errorMessage = err instanceof Error ? err.message : String(err);
    error('Failed to start agent', { message: errorMessage });
    process.exit(1);
  }

  // Keep the process running until stopped (for restart)
  await stoppedPromise;
  
  // If we get here, it means shouldRestartOnStop was true
  // Recursively call to restart with fresh credentials
  return agentStartHandler(options);
}
