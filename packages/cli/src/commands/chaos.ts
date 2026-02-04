/**
 * Chaos Commands
 *
 * Live chaos testing commands for injecting faults into a running server.
 * These commands communicate with the chaos API endpoints on the server.
 * @module @stark-o/cli/commands/chaos
 */

import { Command } from 'commander';
import chalk from 'chalk';
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
} from '../output.js';

/**
 * API response types
 */
interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface ChaosStatus {
  enabled: boolean;
  currentScenario: string | null;
  stats: {
    messagesProcessed: number;
    messagesDropped: number;
    latencyInjected: number;
    connectionsPaused: number;
    partitionsActive: number;
  };
  runCount: number;
}

interface ChaosScenario {
  id: string;
  name: string;
  description: string;
  options?: Record<string, { description: string; default?: unknown }>;
}

interface ChaosConnection {
  id: string;
  nodeIds: string[];
  userId?: string;
  ipAddress?: string;
  connectedAt: string;
  lastActivity: string;
  isAuthenticated: boolean;
}

interface ChaosNode {
  nodeId: string;
  connectionId: string;
  userId?: string;
  connectedAt: string;
}

interface ChaosEvent {
  type: string;
  timestamp: string;
  details: Record<string, unknown>;
}

interface ChaosPartition {
  id: string;
  nodeIds: string[];
  connectionIds: string[];
  createdAt: string;
  durationMs?: number;
}

/**
 * Status subcommand - shows chaos system status
 */
async function statusHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.get('/chaos/status');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to get chaos status: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const status = await response.json() as ChaosStatus;
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(chalk.bold('\n🔥 Chaos Status\n'));
      keyValue({
        'Enabled': status.enabled ? chalk.green('Yes') : chalk.gray('No'),
        'Current Scenario': status.currentScenario || chalk.gray('None'),
        'Run Count': String(status.runCount),
      });
      
      if (status.stats) {
        console.log(chalk.bold('\n📊 Statistics\n'));
        keyValue({
          'Messages Processed': String(status.stats.messagesProcessed),
          'Messages Dropped': String(status.stats.messagesDropped),
          'Latency Injections': String(status.stats.latencyInjected),
          'Connections Paused': String(status.stats.connectionsPaused),
          'Active Partitions': String(status.stats.partitionsActive),
        });
      }
    }
  } catch (err) {
    error(`Failed to get chaos status: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Enable chaos mode
 */
async function enableHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.post('/chaos/enable');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to enable chaos: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    success('Chaos mode enabled');
    warn('Chaos testing can disrupt service. Use with caution.');
  } catch (err) {
    error(`Failed to enable chaos: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Disable chaos mode
 */
async function disableHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.post('/chaos/disable');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to disable chaos: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    success('Chaos mode disabled');
  } catch (err) {
    error(`Failed to disable chaos: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * List available scenarios
 */
async function scenariosHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.get('/chaos/scenarios');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to get scenarios: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const scenarios = await response.json() as ChaosScenario[];
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(scenarios, null, 2));
    } else {
      console.log(chalk.bold('\n🎭 Available Chaos Scenarios\n'));
      
      if (scenarios.length === 0) {
        info('No scenarios available');
        return;
      }
      
      for (const scenario of scenarios) {
        console.log(chalk.cyan(`  ${scenario.id}`));
        console.log(chalk.gray(`    ${scenario.description}`));
        if (scenario.options && Object.keys(scenario.options).length > 0) {
          console.log(chalk.gray('    Options:'));
          for (const [key, opt] of Object.entries(scenario.options)) {
            console.log(chalk.gray(`      --${key}: ${opt.description} (default: ${opt.default})`));
          }
        }
        console.log();
      }
    }
  } catch (err) {
    error(`Failed to get scenarios: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Run a chaos scenario
 */
async function runHandler(
  scenarioId: string,
  options: { option?: string[]; timeout?: string }
): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    // Parse options
    const scenarioOptions: Record<string, unknown> = {};
    if (options.option) {
      for (const opt of options.option) {
        const [key, value] = opt.split('=');
        if (key && value) {
          // Try to parse as number or boolean
          if (value === 'true') scenarioOptions[key] = true;
          else if (value === 'false') scenarioOptions[key] = false;
          else if (!isNaN(Number(value))) scenarioOptions[key] = Number(value);
          else scenarioOptions[key] = value;
        }
      }
    }
    
    info(`Running chaos scenario: ${scenarioId}`);
    
    const response = await api.post('/chaos/run', {
      scenario: scenarioId,
      options: scenarioOptions,
      timeout: options.timeout ? parseInt(options.timeout, 10) : undefined,
    });
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Scenario failed: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json();
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      success(`Scenario ${scenarioId} completed`);
      console.log(chalk.gray(JSON.stringify(result, null, 2)));
    }
  } catch (err) {
    error(`Failed to run scenario: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * List connections
 */
async function connectionsHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.get('/chaos/connections');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to get connections: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { count: number; connections: ChaosConnection[] };
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold(`\n🔌 Active Connections (${result.count})\n`));
      
      if (result.connections.length === 0) {
        info('No active connections');
        return;
      }
      
      table(
        result.connections.map((c) => ({
          ID: c.id.slice(0, 12) + '...',
          Nodes: c.nodeIds.join(', ') || '-',
          User: c.userId || '-',
          IP: c.ipAddress || '-',
          Auth: c.isAuthenticated ? '✓' : '✗',
          Connected: relativeTime(c.connectedAt),
        }))
      );
    }
  } catch (err) {
    error(`Failed to get connections: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * List nodes (from chaos perspective)
 */
async function nodesHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.get('/chaos/nodes');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to get nodes: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { count: number; nodes: ChaosNode[] };
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(chalk.bold(`\n🖥️  Connected Nodes (${result.count})\n`));
      
      if (result.nodes.length === 0) {
        info('No nodes connected');
        return;
      }
      
      table(
        result.nodes.map((n) => ({
          'Node ID': n.nodeId,
          'Connection ID': n.connectionId.slice(0, 12) + '...',
          User: n.userId || '-',
          Connected: relativeTime(n.connectedAt),
        }))
      );
    }
  } catch (err) {
    error(`Failed to get nodes: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Kill a node connection
 */
async function killNodeHandler(nodeId: string): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    info(`Killing connection for node: ${nodeId}`);
    
    const response = await api.post('/chaos/node/kill', { nodeId });
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to kill node: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { success: boolean; message: string };
    
    if (result.success) {
      success(`Node ${nodeId} connection terminated`);
    } else {
      warn(result.message);
    }
  } catch (err) {
    error(`Failed to kill node: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Kill a connection
 */
async function killConnectionHandler(connectionId: string): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    info(`Killing connection: ${connectionId}`);
    
    const response = await api.post('/chaos/connection/kill', { connectionId });
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to kill connection: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { success: boolean; message: string };
    
    if (result.success) {
      success(`Connection ${connectionId} terminated`);
    } else {
      warn(result.message);
    }
  } catch (err) {
    error(`Failed to kill connection: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Pause a connection (network freeze)
 */
async function pauseHandler(options: {
  node?: string;
  connection?: string;
  duration?: string;
}): Promise<void> {
  requireAuth();
  
  if (!options.node && !options.connection) {
    error('Either --node or --connection is required');
    process.exit(1);
  }
  
  try {
    const api = createApiClient();
    
    const body: Record<string, unknown> = {};
    if (options.node) body.nodeId = options.node;
    if (options.connection) body.connectionId = options.connection;
    if (options.duration) body.durationMs = parseInt(options.duration, 10);
    
    info(`Pausing connection (simulating network freeze)...`);
    
    const response = await api.post('/chaos/connection/pause', body);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to pause: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { success: boolean; message: string; durationMs?: number };
    
    if (result.success) {
      success(`Connection paused${result.durationMs ? ` for ${result.durationMs}ms` : ''}`);
    } else {
      warn(result.message);
    }
  } catch (err) {
    error(`Failed to pause: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Resume a paused connection
 */
async function resumeHandler(options: {
  node?: string;
  connection?: string;
}): Promise<void> {
  requireAuth();
  
  if (!options.node && !options.connection) {
    error('Either --node or --connection is required');
    process.exit(1);
  }
  
  try {
    const api = createApiClient();
    
    const body: Record<string, unknown> = {};
    if (options.node) body.nodeId = options.node;
    if (options.connection) body.connectionId = options.connection;
    
    const response = await api.post('/chaos/connection/resume', body);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to resume: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { success: boolean; message: string };
    
    if (result.success) {
      success('Connection resumed');
    } else {
      warn(result.message);
    }
  } catch (err) {
    error(`Failed to resume: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Create a network partition
 */
async function partitionCreateHandler(options: {
  node?: string[];
  connection?: string[];
  duration?: string;
}): Promise<void> {
  requireAuth();
  
  if (!options.node?.length && !options.connection?.length) {
    error('At least one --node or --connection is required');
    process.exit(1);
  }
  
  try {
    const api = createApiClient();
    
    const body: Record<string, unknown> = {
      nodeIds: options.node || [],
      connectionIds: options.connection || [],
    };
    if (options.duration) body.durationMs = parseInt(options.duration, 10);
    
    info('Creating network partition...');
    
    const response = await api.post('/chaos/partition', body);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to create partition: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { 
      success: boolean; 
      partitionId: string; 
      message: string;
      durationMs?: number;
    };
    
    if (result.success) {
      success(`Network partition created: ${result.partitionId}`);
      if (result.durationMs) {
        info(`Partition will auto-heal in ${result.durationMs}ms`);
      }
    } else {
      warn(result.message);
    }
  } catch (err) {
    error(`Failed to create partition: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * List active partitions
 */
async function partitionListHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.get('/chaos/partitions');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to get partitions: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const partitions = await response.json() as ChaosPartition[];
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(partitions, null, 2));
    } else {
      console.log(chalk.bold('\n🔀 Active Network Partitions\n'));
      
      if (partitions.length === 0) {
        info('No active partitions');
        return;
      }
      
      for (const partition of partitions) {
        console.log(chalk.cyan(`  ${partition.id}`));
        console.log(chalk.gray(`    Nodes: ${partition.nodeIds.join(', ') || 'none'}`));
        console.log(chalk.gray(`    Connections: ${partition.connectionIds.join(', ') || 'none'}`));
        if (partition.durationMs) {
          console.log(chalk.gray(`    Duration: ${partition.durationMs}ms`));
        }
        console.log();
      }
    }
  } catch (err) {
    error(`Failed to get partitions: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Remove a partition
 */
async function partitionRemoveHandler(partitionId: string): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    const response = await api.delete(`/chaos/partition/${partitionId}`);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to remove partition: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { success: boolean; message: string };
    
    if (result.success) {
      success(`Partition ${partitionId} removed (network healed)`);
    } else {
      warn(result.message);
    }
  } catch (err) {
    error(`Failed to remove partition: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Inject latency
 */
async function latencyAddHandler(options: {
  node?: string;
  connection?: string;
  latency: string;
  jitter?: string;
  duration?: string;
}): Promise<void> {
  requireAuth();
  
  if (!options.node && !options.connection) {
    error('Either --node or --connection is required');
    process.exit(1);
  }
  
  try {
    const api = createApiClient();
    
    const body: Record<string, unknown> = {
      latencyMs: parseInt(options.latency, 10),
    };
    if (options.node) body.nodeId = options.node;
    if (options.connection) body.connectionId = options.connection;
    if (options.jitter) body.jitterMs = parseInt(options.jitter, 10);
    if (options.duration) body.durationMs = parseInt(options.duration, 10);
    
    info(`Injecting ${options.latency}ms latency...`);
    
    const response = await api.post('/chaos/latency', body);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to inject latency: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { 
      success: boolean; 
      ruleId: string;
      latencyMs: number;
      jitterMs: number;
    };
    
    if (result.success) {
      success(`Latency injection enabled (rule: ${result.ruleId})`);
      info(`Latency: ${result.latencyMs}ms ± ${result.jitterMs}ms jitter`);
    }
  } catch (err) {
    error(`Failed to inject latency: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Remove latency rule
 */
async function latencyRemoveHandler(ruleId: string): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    const response = await api.delete(`/chaos/latency/${ruleId}`);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to remove latency rule: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { success: boolean; message: string };
    
    if (result.success) {
      success(`Latency rule ${ruleId} removed`);
    } else {
      warn(result.message);
    }
  } catch (err) {
    error(`Failed to remove latency rule: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Add heartbeat delay
 */
async function heartbeatDelayHandler(
  nodeId: string,
  options: { delay: string; duration?: string; dropRate?: string }
): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    const body: Record<string, unknown> = {
      nodeId,
      delayMs: parseInt(options.delay, 10),
    };
    if (options.duration) body.durationMs = parseInt(options.duration, 10);
    if (options.dropRate) body.dropRate = parseFloat(options.dropRate);
    
    info(`Adding heartbeat delay for node: ${nodeId}`);
    
    const response = await api.post('/chaos/heartbeat/delay', body);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to add heartbeat delay: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    success(`Heartbeat delay of ${options.delay}ms added for node ${nodeId}`);
    if (options.dropRate) {
      info(`Drop rate: ${parseFloat(options.dropRate) * 100}%`);
    }
  } catch (err) {
    error(`Failed to add heartbeat delay: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Add message drop/delay rule
 * direction: 'incoming' = node→orch, 'outgoing' = orch→node, 'both' (default)
 */
async function messageDropHandler(options: {
  node?: string;
  types?: string[];
  rate?: string;
  direction?: string;
  delay?: string;
  jitter?: string;
}): Promise<void> {
  requireAuth();
  
  // Validate at least one effect is specified
  if (!options.rate && !options.delay) {
    error('At least --rate or --delay must be specified');
    process.exit(1);
  }
  
  // Validate direction
  if (options.direction && !['incoming', 'outgoing', 'both'].includes(options.direction)) {
    error(`Invalid direction: ${options.direction}. Must be 'incoming', 'outgoing', or 'both'`);
    process.exit(1);
  }
  
  try {
    const api = createApiClient();
    
    const body: Record<string, unknown> = {
      dropRate: options.rate ? parseFloat(options.rate) : 0,
    };
    if (options.node) body.nodeId = options.node;
    if (options.types?.length) body.messageTypes = options.types;
    if (options.direction) body.direction = options.direction;
    if (options.delay) body.delayMs = parseInt(options.delay, 10);
    if (options.jitter) body.delayJitterMs = parseInt(options.jitter, 10);
    
    const effects: string[] = [];
    if (options.rate) effects.push(`${parseFloat(options.rate) * 100}% drop rate`);
    if (options.delay) effects.push(`${options.delay}ms delay`);
    const dirLabel = options.direction === 'incoming' ? 'node→orchestrator' 
                   : options.direction === 'outgoing' ? 'orchestrator→node' 
                   : 'bidirectional';
    
    info(`Adding message rule (${effects.join(', ')}) for ${dirLabel} messages...`);
    
    const response = await api.post('/chaos/message/drop', body);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to add message rule: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const result = await response.json() as { success: boolean; ruleId: string; direction: string };
    
    if (result.success) {
      success(`Message rule created (rule: ${result.ruleId}, direction: ${result.direction})`);
    }
  } catch (err) {
    error(`Failed to add message rule: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Make API flaky
 */
async function apiFlakyHandler(options: {
  errorRate?: string;
  timeoutRate?: string;
  timeoutMs?: string;
}): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    const body: Record<string, unknown> = {};
    if (options.errorRate) body.errorRate = parseFloat(options.errorRate);
    if (options.timeoutRate) body.timeoutRate = parseFloat(options.timeoutRate);
    if (options.timeoutMs) body.timeoutMs = parseInt(options.timeoutMs, 10);
    
    info('Configuring flaky API behavior...');
    
    const response = await api.post('/chaos/api/flaky', body);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to configure flaky API: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    success('API flaky behavior configured');
    if (options.errorRate) info(`Error rate: ${parseFloat(options.errorRate) * 100}%`);
    if (options.timeoutRate) info(`Timeout rate: ${parseFloat(options.timeoutRate) * 100}%`);
  } catch (err) {
    error(`Failed to configure flaky API: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Clear all chaos rules
 */
async function clearHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    
    const response = await api.post('/chaos/clear');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to clear chaos rules: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    success('All chaos rules cleared');
  } catch (err) {
    error(`Failed to clear chaos rules: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Get chaos stats
 */
async function statsHandler(): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const response = await api.get('/chaos/stats');
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to get stats: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const stats = await response.json();
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(chalk.bold('\n📊 Chaos Statistics\n'));
      console.log(JSON.stringify(stats, null, 2));
    }
  } catch (err) {
    error(`Failed to get stats: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Get recent chaos events
 */
async function eventsHandler(options: { count?: string }): Promise<void> {
  requireAuth();
  
  try {
    const api = createApiClient();
    const count = options.count || '50';
    const response = await api.get(`/chaos/events?count=${count}`);
    
    if (!response.ok) {
      const data = await response.json() as ApiResponse<never>;
      error(`Failed to get events: ${data.error || response.statusText}`);
      process.exit(1);
    }
    
    const events = await response.json() as ChaosEvent[];
    
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(events, null, 2));
    } else {
      console.log(chalk.bold('\n📜 Recent Chaos Events\n'));
      
      if (events.length === 0) {
        info('No recent events');
        return;
      }
      
      for (const event of events.slice(0, 20)) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        console.log(chalk.gray(`[${time}]`) + ' ' + chalk.cyan(event.type));
        if (Object.keys(event.details).length > 0) {
          console.log(chalk.gray(`    ${JSON.stringify(event.details)}`));
        }
      }
      
      if (events.length > 20) {
        info(`... and ${events.length - 20} more events (use --count to see more)`);
      }
    }
  } catch (err) {
    error(`Failed to get events: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Creates the chaos command with all subcommands
 */
export function createChaosCommand(): Command {
  const chaos = new Command('chaos');
  
  chaos
    .description('Chaos testing commands for fault injection')
    .addHelpText('after', `
Examples:
  $ stark chaos status                              Show chaos system status
  $ stark chaos enable                              Enable chaos mode
  $ stark chaos scenarios                           List available scenarios
  $ stark chaos run node-failure                    Run a chaos scenario
  $ stark chaos connections                         List active connections
  $ stark chaos kill node <nodeId>                  Kill a node connection
  $ stark chaos pause --node <nodeId> --duration 5000    Pause a connection
  $ stark chaos partition create --node n1 --node n2     Create network partition
  $ stark chaos latency add --node <nodeId> --latency 500    Inject latency
  $ stark chaos clear                               Clear all chaos rules
`);

  // Status command
  chaos
    .command('status')
    .description('Show chaos system status and statistics')
    .action(statusHandler);

  // Enable/disable commands
  chaos
    .command('enable')
    .description('Enable chaos mode on the server')
    .action(enableHandler);

  chaos
    .command('disable')
    .description('Disable chaos mode and clear all rules')
    .action(disableHandler);

  // Scenarios commands
  chaos
    .command('scenarios')
    .description('List available chaos scenarios')
    .action(scenariosHandler);

  chaos
    .command('run <scenario>')
    .description('Run a chaos scenario')
    .option('-o, --option <key=value...>', 'Scenario options (repeatable)')
    .option('-t, --timeout <ms>', 'Scenario timeout in milliseconds')
    .action(runHandler);

  // Connection inspection commands
  chaos
    .command('connections')
    .description('List all active WebSocket connections')
    .action(connectionsHandler);

  chaos
    .command('nodes')
    .description('List connected nodes (from chaos perspective)')
    .action(nodesHandler);

  // Kill commands
  const kill = chaos.command('kill').description('Kill connections or nodes');

  kill
    .command('node <nodeId>')
    .description('Kill a node connection')
    .action(killNodeHandler);

  kill
    .command('connection <connectionId>')
    .description('Kill a specific connection')
    .action(killConnectionHandler);

  // Pause/resume commands
  chaos
    .command('pause')
    .description('Pause a connection (simulate network freeze)')
    .option('-n, --node <nodeId>', 'Target node ID')
    .option('-c, --connection <connectionId>', 'Target connection ID')
    .option('-d, --duration <ms>', 'Auto-resume after duration (ms)')
    .action(pauseHandler);

  chaos
    .command('resume')
    .description('Resume a paused connection')
    .option('-n, --node <nodeId>', 'Target node ID')
    .option('-c, --connection <connectionId>', 'Target connection ID')
    .action(resumeHandler);

  // Partition commands
  const partition = chaos.command('partition').description('Network partition management');

  partition
    .command('create')
    .description('Create a network partition')
    .option('-n, --node <nodeId...>', 'Node IDs to partition (repeatable)')
    .option('-c, --connection <connectionId...>', 'Connection IDs to partition (repeatable)')
    .option('-d, --duration <ms>', 'Auto-heal after duration (ms)')
    .action(partitionCreateHandler);

  partition
    .command('list')
    .description('List active network partitions')
    .action(partitionListHandler);

  partition
    .command('remove <partitionId>')
    .description('Remove a network partition (heal network)')
    .action(partitionRemoveHandler);

  // Latency commands
  const latency = chaos.command('latency').description('Latency injection management');

  latency
    .command('add')
    .description('Inject latency into connections')
    .option('-n, --node <nodeId>', 'Target node ID')
    .option('-c, --connection <connectionId>', 'Target connection ID')
    .requiredOption('-l, --latency <ms>', 'Latency to inject (ms)')
    .option('-j, --jitter <ms>', 'Latency jitter (ms)')
    .option('-d, --duration <ms>', 'Auto-remove after duration (ms)')
    .action(latencyAddHandler);

  latency
    .command('remove <ruleId>')
    .description('Remove a latency injection rule')
    .action(latencyRemoveHandler);

  // Heartbeat delay command
  chaos
    .command('heartbeat-delay <nodeId>')
    .description('Add heartbeat delay for a node')
    .requiredOption('--delay <ms>', 'Delay in milliseconds')
    .option('--duration <ms>', 'Auto-remove after duration (ms)')
    .option('--drop-rate <rate>', 'Probability to drop heartbeats (0-1)')
    .action(heartbeatDelayHandler);

  // Message chaos command (drop/delay)
  chaos
    .command('message-drop')
    .description('Add message drop/delay rule')
    .option('-n, --node <nodeId>', 'Target node ID')
    .option('-t, --types <type...>', 'Message types to affect (repeatable)')
    .option('-r, --rate <rate>', 'Drop rate (0-1, e.g., 0.5 for 50%)')
    .option('-d, --direction <dir>', "Message direction: 'incoming' (node→orch), 'outgoing' (orch→node), or 'both' (default)")
    .option('--delay <ms>', 'Delay messages by this many milliseconds')
    .option('--jitter <ms>', 'Random jitter to add to delay')
    .action(messageDropHandler);

  // API flaky command
  chaos
    .command('api-flaky')
    .description('Make API calls flaky')
    .option('--error-rate <rate>', 'Error rate (0-1)')
    .option('--timeout-rate <rate>', 'Timeout rate (0-1)')
    .option('--timeout-ms <ms>', 'Timeout duration (ms)')
    .action(apiFlakyHandler);

  // Clear all rules
  chaos
    .command('clear')
    .description('Clear all chaos rules')
    .action(clearHandler);

  // Stats command
  chaos
    .command('stats')
    .description('Get detailed chaos statistics')
    .action(statsHandler);

  // Events command
  chaos
    .command('events')
    .description('Get recent chaos events')
    .option('-c, --count <n>', 'Number of events to retrieve', '50')
    .action(eventsHandler);

  return chaos;
}
