#!/usr/bin/env node
/**
 * Chaos CLI Client
 *
 * Command-line client that connects to a running Stark server
 * and injects chaos via the REST API.
 *
 * Usage:
 *   pnpm dev:test                              # Interactive mode
 *   pnpm dev:test --server https://localhost   # Specify server URL
 *   pnpm dev:test node kill <nodeId>           # Kill a node
 *   pnpm dev:test heartbeat delay <nodeId> 3000 # Add 3s heartbeat delay
 */

import { createInterface } from 'readline';
import https from 'https';
import http from 'http';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SERVER = process.env.STARK_SERVER_URL || 'https://localhost';

interface ChaosClientConfig {
  serverUrl: string;
  insecure: boolean; // Skip TLS verification
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Client
// ─────────────────────────────────────────────────────────────────────────────

class ChaosApiClient {
  private baseUrl: string;
  private insecure: boolean;

  constructor(config: ChaosClientConfig) {
    this.baseUrl = config.serverUrl.replace(/\/$/, '');
    this.insecure = config.insecure;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/chaos${path}`);
    const isHttps = url.protocol === 'https:';

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      rejectUnauthorized: !this.insecure,
    };

    return new Promise((resolve, reject) => {
      const lib = isHttps ? https : http;
      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(json as T);
            }
          } catch {
            reject(new Error(`Invalid JSON: ${data}`));
          }
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  async getStatus(): Promise<{
    enabled: boolean;
    currentScenario: string | null;
    stats: unknown;
    runCount: number;
  }> {
    return this.request('GET', '/status');
  }

  async enable(): Promise<{ enabled: boolean; message: string }> {
    return this.request('POST', '/enable');
  }

  async disable(): Promise<{ enabled: boolean; message: string }> {
    return this.request('POST', '/disable');
  }

  async listScenarios(): Promise<{ name: string; description: string }[]> {
    return this.request('GET', '/scenarios');
  }

  async runScenario(
    scenario: string,
    options: Record<string, unknown>
  ): Promise<unknown> {
    return this.request('POST', '/run', { scenario, options });
  }

  async killNode(nodeId: string): Promise<{ success: boolean; message: string }> {
    return this.request('POST', '/node/kill', { nodeId });
  }

  async addHeartbeatDelay(
    nodeId: string,
    delayMs: number,
    durationMs?: number,
    dropRate?: number
  ): Promise<unknown> {
    return this.request('POST', '/heartbeat/delay', {
      nodeId,
      delayMs,
      durationMs,
      dropRate,
    });
  }

  async addMessageDrop(
    nodeId: string,
    messageTypes: string[],
    dropRate: number,
    direction?: 'incoming' | 'outgoing' | 'both',
    delayMs?: number,
    delayJitterMs?: number
  ): Promise<unknown> {
    return this.request('POST', '/message/drop', { 
      nodeId, 
      messageTypes, 
      dropRate,
      direction,
      delayMs,
      delayJitterMs,
    });
  }

  async setApiFlaky(
    errorRate: number,
    timeoutRate?: number,
    timeoutMs?: number
  ): Promise<unknown> {
    return this.request('POST', '/api/flaky', { errorRate, timeoutRate, timeoutMs });
  }

  async clearAll(): Promise<unknown> {
    return this.request('POST', '/clear');
  }

  async getStats(): Promise<unknown> {
    return this.request('GET', '/stats');
  }

  async getRules(): Promise<{
    enabled: boolean;
    messageRules: Array<{
      connectionId?: string;
      nodeId?: string;
      messageTypes?: string[];
      direction?: 'incoming' | 'outgoing' | 'both';
      dropRate: number;
      delayMs?: number;
      delayJitterMs?: number;
    }>;
  }> {
    return this.request('GET', '/rules');
  }

  async getEvents(count?: number): Promise<unknown[]> {
    return this.request('GET', `/events${count ? `?count=${count}` : ''}`);
  }

  async listNodes(): Promise<{
    count: number;
    nodes: Array<{ nodeId: string; connectionId: string; userId?: string; connectedAt: string }>;
  }> {
    return this.request('GET', '/nodes');
  }

  async listConnections(): Promise<{
    count: number;
    connections: Array<{ id: string; nodeIds: string[]; userId?: string; connectedAt: string }>;
  }> {
    return this.request('GET', '/connections');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ⚡ STARK CHAOS INJECTION CLI ⚡                            ║
║                                                              ║
║   Inject failures into a running Stark server                ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
}

function printHelp(): void {
  console.log(`
Usage: pnpm dev:test [options] [command]

${chalk.bold('CONNECTION OPTIONS')}
  --server <url>    Server URL (default: https://localhost)
  -k, --insecure    Skip TLS certificate verification

${chalk.bold('LIFECYCLE COMMANDS')}
  enable                            Enable chaos mode on server
  disable                           Disable chaos mode
  status                            Show chaos status and active rules
  clear                             Clear all chaos rules

${chalk.bold('DISCOVERY COMMANDS')}
  nodes                             List connected nodes (get node IDs for targeting)
  connections                       List active WebSocket connections
  scenarios                         List available chaos scenarios
  stats                             Show chaos statistics
  rules                             Show active chaos rules (message drop/delay rules)
  events [count]                    Show recent chaos events (default: 50)

${chalk.bold('NODE CHAOS')}
  node kill <nodeId>                Forcefully terminate a node's connection

${chalk.bold('HEARTBEAT CHAOS')}
  heartbeat delay <nodeId> <ms> [duration] [dropRate]
                                    Delay heartbeats by <ms> milliseconds
                                    Optional: auto-remove after [duration] ms
                                    Optional: also drop [dropRate] (0-1) of heartbeats

${chalk.bold('MESSAGE CHAOS')} ${chalk.gray('(NEW: supports direction & delay)')}
  message drop <nodeId> <rate> [direction] [delayMs] [jitterMs]
                                    Affect messages for a node
    rate        Drop probability (0-1), use 0 for delay-only
    direction   'incoming' (node→orch), 'outgoing' (orch→node), 'both' (default)
    delayMs     Delay messages by this many ms (optional)
    jitterMs    Add random jitter 0-jitterMs (optional)

${chalk.bold('API CHAOS')}
  api flaky <errorRate> [timeoutRate] [timeoutMs]
                                    Make API calls flaky
    errorRate    Probability of returning 500 error (0-1)
    timeoutRate  Probability of timing out (0-1)
    timeoutMs    Timeout duration in ms

${chalk.bold('SCENARIO RUNNER')}
  run <scenario> [--option value ...]
                                    Run a predefined chaos scenario

${chalk.bold('EXAMPLES')}
  ${chalk.gray('# Enable chaos mode')}
  pnpm dev:test -k enable

  ${chalk.gray('# Kill a specific node')}
  pnpm dev:test -k node kill my-node-1

  ${chalk.gray('# Delay heartbeats by 3s for 60s')}
  pnpm dev:test -k heartbeat delay my-node-1 3000 60000

  ${chalk.gray('# Delay only node→orchestrator messages by 500ms (leave orch→node clean)')}
  pnpm dev:test -k message drop my-node-1 0 incoming 500 100

  ${chalk.gray('# Drop 30% of outgoing messages (orch→node)')}
  pnpm dev:test -k message drop my-node-1 0.3 outgoing

  ${chalk.gray('# Make API 30% flaky')}
  pnpm dev:test -k api flaky 0.3

  ${chalk.gray('# Run node-loss scenario')}
  pnpm dev:test -k run node-loss --mode single --nodeId my-node-1

${chalk.bold('INTERACTIVE MODE')}
  Run without a command to enter interactive mode with tab completion.
`);
}

// Chalk-like minimal coloring for CLI
const chalk = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

async function interactiveMode(client: ChaosApiClient): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  };

  console.log('\nConnected to server. Type "help" for commands.\n');

  // Check initial status
  try {
    const status = await client.getStatus();
    console.log(`Chaos enabled: ${status.enabled}`);
    if (!status.enabled) {
      console.log('Run "enable" to start chaos injection.\n');
    }
  } catch (error) {
    console.error('Failed to connect:', error instanceof Error ? error.message : error);
    console.log('Make sure the server is running with STARK_CHAOS_ENABLED=true\n');
  }

  let running = true;

  while (running) {
    const input = await prompt('chaos> ');
    const parts = input.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();

    try {
      switch (cmd) {
        case 'help':
        case '?':
          console.log(`
${chalk.bold('LIFECYCLE')}
  enable              Enable chaos injection on server
  disable             Disable chaos (clears all rules)
  status              Show current status and active rules
  clear               Clear all chaos rules without disabling

${chalk.bold('DISCOVERY')}
  nodes               List connected nodes ${chalk.gray('(get node IDs for targeting)')}
  connections         List active WebSocket connections
  scenarios           List available chaos scenarios
  rules               Show active chaos rules (message drop/delay rules)
  stats               Show detailed statistics
  events [n]          Show last n chaos events ${chalk.gray('(default: 20)')}

${chalk.bold('NODE CHAOS')}
  kill <nodeId>       Forcefully terminate node connection

${chalk.bold('HEARTBEAT CHAOS')}
  hb-delay <nodeId> <ms> [duration] [dropRate]
                      Delay heartbeats by <ms> milliseconds
                      ${chalk.gray('duration: auto-remove after ms (optional)')}
                      ${chalk.gray('dropRate: also drop 0-1 of heartbeats (optional)')}

${chalk.bold('MESSAGE CHAOS')} ${chalk.yellow('← supports direction!')}
  msg <nodeId> <direction> <delayMs> [jitterMs] [dropRate]
                      Add message chaos rule
    direction   ${chalk.cyan('incoming')} = node→orchestrator
                ${chalk.cyan('outgoing')} = orchestrator→node  
                ${chalk.cyan('both')}     = bidirectional
    delayMs     Delay in milliseconds (use 0 for drop-only)
    jitterMs    Random jitter 0-value ms ${chalk.gray('(optional)')}
    dropRate    Drop probability 0-1 ${chalk.gray('(optional, default: 0)')}

  drop <nodeId> <rate>
                      ${chalk.gray('Legacy: Drop messages bidirectionally')}

${chalk.bold('API CHAOS')}
  flaky <errorRate> [timeoutRate]
                      Make API calls flaky (rates 0-1)

${chalk.bold('SCENARIOS')}
  run <scenario>      Run scenario (will prompt for options)

${chalk.bold('EXAMPLES')}
  ${chalk.gray('# Delay only node→orch messages by 500ms, leave orch→node clean')}
  msg my-node incoming 500 100

  ${chalk.gray('# Drop 30% of orch→node messages')}
  msg my-node outgoing 0 0 0.3

  ${chalk.gray('# Delay heartbeats by 3s')}
  hb-delay my-node 3000

${chalk.bold('OTHER')}
  exit, quit, q       Exit interactive mode
`);
          break;

        case 'enable':
          console.log(await client.enable());
          break;

        case 'disable':
          console.log(await client.disable());
          break;

        case 'status': {
          const status = await client.getStatus();
          console.log();
          console.log(chalk.bold('Chaos Status'));
          console.log(`  Enabled: ${status.enabled ? chalk.green('YES') : chalk.gray('NO')}`);
          if (status.currentScenario) {
            console.log(`  Running: ${chalk.yellow(status.currentScenario)}`);
          }
          console.log(`  Run count: ${status.runCount}`);
          console.log();
          if (status.stats) {
            const s = status.stats as Record<string, number | undefined>;
            const dropped = s.messagesDropped ?? 0;
            const delayed = s.messagesDelayed ?? 0;
            const hbDropped = s.heartbeatsDropped ?? 0;
            const hbDelayed = s.heartbeatsDelayed ?? 0;
            if (dropped > 0 || delayed > 0 || hbDropped > 0 || hbDelayed > 0) {
              console.log(chalk.bold('Active Effects'));
              if (dropped > 0) console.log(`  Messages dropped: ${dropped}`);
              if (delayed > 0) console.log(`  Messages delayed: ${delayed}`);
              if (hbDropped > 0) console.log(`  Heartbeats dropped: ${hbDropped}`);
              if (hbDelayed > 0) console.log(`  Heartbeats delayed: ${hbDelayed}`);
              console.log();
            }
          }
          break;
        }

        case 'scenarios':
          const scenarios = await client.listScenarios();
          for (const s of scenarios) {
            console.log(`  ${s.name}: ${s.description}`);
          }
          break;

        case 'stats':
          console.log(JSON.stringify(await client.getStats(), null, 2));
          break;

        case 'rules': {
          const rulesResult = await client.getRules();
          console.log();
          console.log(chalk.bold('Active Chaos Rules'));
          console.log(`  Chaos Enabled: ${rulesResult.enabled ? chalk.green('YES') : chalk.gray('NO')}`);
          console.log();
          if (rulesResult.messageRules.length === 0) {
            console.log(chalk.gray('  No message rules active'));
          } else {
            console.log(`  Message Rules (${rulesResult.messageRules.length}):`);
            for (const rule of rulesResult.messageRules) {
              const dirLabel = rule.direction === 'incoming' ? 'node→orch' 
                             : rule.direction === 'outgoing' ? 'orch→node' 
                             : 'both';
              console.log(`    • Direction: ${chalk.cyan(dirLabel)}`);
              if (rule.nodeId) console.log(`      Node: ${rule.nodeId}`);
              if (rule.dropRate > 0) console.log(`      Drop: ${(rule.dropRate * 100).toFixed(0)}%`);
              if (rule.delayMs) console.log(`      Delay: ${rule.delayMs}ms${rule.delayJitterMs ? ` ±${rule.delayJitterMs}ms` : ''}`);
              if (rule.messageTypes?.length) console.log(`      Types: ${rule.messageTypes.join(', ')}`);
            }
          }
          console.log();
          break;
        }

        case 'events':
          const events = await client.getEvents(parseInt(parts[1] ?? '20') || 20);
          for (const e of events as any[]) {
            console.log(`  [${e.type}] ${JSON.stringify(e.details)}`);
          }
          break;

        case 'clear':
          console.log(await client.clearAll());
          break;

        case 'nodes': {
          const nodesResult = await client.listNodes();
          if (nodesResult.count === 0) {
            console.log('No nodes currently connected via WebSocket.');
            console.log('Note: Nodes must be connected to be targeted by chaos commands.');
          } else {
            console.log(`\nConnected nodes (${nodesResult.count}):`);
            for (const node of nodesResult.nodes) {
              console.log(`  ${node.nodeId}`);
              console.log(`    Connection: ${node.connectionId}`);
              if (node.userId) console.log(`    User: ${node.userId}`);
            }
          }
          break;
        }

        case 'connections': {
          const connsResult = await client.listConnections();
          if (connsResult.count === 0) {
            console.log('No active WebSocket connections.');
          } else {
            console.log(`\nActive connections (${connsResult.count}):`);
            for (const conn of connsResult.connections) {
              console.log(`  ${conn.id}`);
              console.log(`    Nodes: ${conn.nodeIds.length > 0 ? conn.nodeIds.join(', ') : '(none)'}`);
              if (conn.userId) console.log(`    User: ${conn.userId}`);
            }
          }
          break;
        }

        case 'kill':
          if (!parts[1]) {
            console.log('Usage: kill <nodeId>');
          } else {
            console.log(await client.killNode(parts[1]));
          }
          break;

        case 'delay':
          // Legacy alias for hb-delay
          if (!parts[1] || !parts[2]) {
            console.log('Usage: delay <nodeId> <ms> [durationMs]');
            console.log(chalk.gray('  Alias for hb-delay. Delays heartbeat processing.'));
          } else {
            console.log(
              await client.addHeartbeatDelay(
                parts[1],
                parseInt(parts[2]),
                parts[3] ? parseInt(parts[3]) : undefined
              )
            );
          }
          break;

        case 'drop':
          if (!parts[1] || !parts[2]) {
            console.log('Usage: drop <nodeId> <rate>');
            console.log(chalk.gray('  Legacy command. Use "msg" for direction control.'));
          } else {
            console.log(
              await client.addMessageDrop(parts[1], [], parseFloat(parts[2]), 'both')
            );
          }
          break;

        case 'msg':
        case 'message': {
          // msg <nodeId> <direction> <delayMs> [jitterMs] [dropRate]
          if (!parts[1] || !parts[2] || !parts[3]) {
            console.log('Usage: msg <nodeId> <direction> <delayMs> [jitterMs] [dropRate]');
            console.log('  direction: incoming (node→orch), outgoing (orch→node), both');
            console.log('  delayMs:   delay in ms (use 0 for drop-only)');
            console.log('  jitterMs:  random jitter (optional)');
            console.log('  dropRate:  drop probability 0-1 (optional)');
            console.log();
            console.log(chalk.yellow('Examples:'));
            console.log('  msg my-node incoming 500 100    # Delay node→orch by 500±100ms');
            console.log('  msg my-node outgoing 0 0 0.3    # Drop 30% of orch→node');
          } else {
            const nodeId = parts[1];
            const direction = parts[2] as 'incoming' | 'outgoing' | 'both';
            const delayMs = parseInt(parts[3], 10);
            const jitterMs = parts[4] ? parseInt(parts[4], 10) : undefined;
            const dropRate = parts[5] ? parseFloat(parts[5]) : 0;

            if (!['incoming', 'outgoing', 'both'].includes(direction)) {
              console.log(chalk.red(`Invalid direction: ${direction}`));
              console.log('Must be: incoming, outgoing, or both');
              break;
            }

            const result = await client.addMessageDrop(
              nodeId, 
              [], 
              dropRate, 
              direction, 
              delayMs > 0 ? delayMs : undefined,
              jitterMs
            );
            console.log(chalk.green('✓ Message rule added'));
            console.log(`  Node: ${nodeId}`);
            console.log(`  Direction: ${direction}`);
            if (delayMs > 0) console.log(`  Delay: ${delayMs}ms${jitterMs ? ` ±${jitterMs}ms` : ''}`);
            if (dropRate > 0) console.log(`  Drop rate: ${(dropRate * 100).toFixed(0)}%`);
            console.log(result);
          }
          break;
        }

        case 'hb-delay':
        case 'heartbeat-delay': {
          // hb-delay <nodeId> <ms> [duration] [dropRate]
          if (!parts[1] || !parts[2]) {
            console.log('Usage: hb-delay <nodeId> <ms> [durationMs] [dropRate]');
          } else {
            const result = await client.addHeartbeatDelay(
              parts[1],
              parseInt(parts[2], 10),
              parts[3] ? parseInt(parts[3], 10) : undefined,
              parts[4] ? parseFloat(parts[4]) : undefined
            );
            console.log(chalk.green('✓ Heartbeat delay added'));
            console.log(result);
          }
          break;
        }

        case 'flaky':
          if (!parts[1]) {
            console.log('Usage: flaky <errorRate> [timeoutRate]');
          } else {
            console.log(
              await client.setApiFlaky(
                parseFloat(parts[1]),
                parts[2] ? parseFloat(parts[2]) : undefined
              )
            );
          }
          break;

        case 'run':
          if (!parts[1]) {
            console.log('Usage: run <scenario>');
            const scenarios = await client.listScenarios();
            console.log('Available:', scenarios.map((s) => s.name).join(', '));
          } else {
            const options = await promptForOptions(prompt, parts[1]);
            console.log('Running scenario...');
            const result = await client.runScenario(parts[1], options);
            console.log(JSON.stringify(result, null, 2));
          }
          break;

        case 'exit':
        case 'quit':
        case 'q':
          running = false;
          break;

        case '':
          break;

        default:
          console.log(`Unknown command: ${cmd}. Type "help" for commands.`);
      }
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
    }
  }

  rl.close();
  console.log('\nGoodbye!\n');
}

async function promptForOptions(
  prompt: (q: string) => Promise<string>,
  scenario: string
): Promise<Record<string, unknown>> {
  const options: Record<string, unknown> = {};

  console.log(`\nConfigure ${scenario}:`);

  switch (scenario) {
    case 'node-loss':
      options.mode = (await prompt('Mode (single/flapping/multi) [single]: ')) || 'single';
      options.nodeId = await prompt('Node ID: ');
      if (options.mode === 'flapping') {
        options.flapCount = parseInt((await prompt('Flap count [3]: ')) || '3', 10);
      }
      break;

    case 'heartbeat-delay':
      options.mode = (await prompt('Mode (delay/intermittent/gradual_degradation) [delay]: ')) || 'delay';
      options.nodeId = await prompt('Node ID: ');
      options.delayMs = parseInt((await prompt('Delay ms [3000]: ')) || '3000', 10);
      options.durationMs = parseInt((await prompt('Duration ms [30000]: ')) || '30000', 10);
      break;

    case 'api-flakiness':
      options.mode = (await prompt('Mode (timeout/errors/intermittent) [intermittent]: ')) || 'intermittent';
      options.errorRate = parseFloat((await prompt('Error rate 0-1 [0.3]: ')) || '0.3');
      options.durationMs = parseInt((await prompt('Duration ms [30000]: ')) || '30000', 10);
      break;

    default:
      console.log('(Using defaults)');
  }

  return options;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Command Parsing
// ─────────────────────────────────────────────────────────────────────────────

async function runCommand(client: ChaosApiClient, args: string[]): Promise<void> {
  const cmd = args[0];

  switch (cmd) {
    case 'enable':
      console.log(await client.enable());
      break;

    case 'disable':
      console.log(await client.disable());
      break;

    case 'status':
      console.log(JSON.stringify(await client.getStatus(), null, 2));
      break;

    case 'scenarios':
      const scenarios = await client.listScenarios();
      for (const s of scenarios) {
        console.log(`${s.name}: ${s.description}`);
      }
      break;

    case 'stats':
      console.log(JSON.stringify(await client.getStats(), null, 2));
      break;

    case 'events':
      console.log(JSON.stringify(await client.getEvents(parseInt(args[1] ?? '50') || 50), null, 2));
      break;

    case 'clear':
      console.log(await client.clearAll());
      break;

    case 'nodes': {
      const nodesResult = await client.listNodes();
      console.log(JSON.stringify(nodesResult, null, 2));
      break;
    }

    case 'connections': {
      const connsResult = await client.listConnections();
      console.log(JSON.stringify(connsResult, null, 2));
      break;
    }

    case 'node':
      if (args[1] === 'kill' && args[2]) {
        console.log(await client.killNode(args[2]));
      } else {
        console.log('Usage: node kill <nodeId>');
      }
      break;

    case 'heartbeat':
      if (args[1] === 'delay' && args[2] && args[3]) {
        console.log(
          await client.addHeartbeatDelay(
            args[2],
            parseInt(args[3]),
            args[4] ? parseInt(args[4]) : undefined
          )
        );
      } else if (args[1] === 'drop' && args[2] && args[3]) {
        console.log(
          await client.addHeartbeatDelay(args[2], 0, undefined, parseFloat(args[3]))
        );
      } else {
        console.log('Usage: heartbeat delay <nodeId> <ms> [durationMs]');
        console.log('       heartbeat drop <nodeId> <rate>');
      }
      break;

    case 'message':
      // message drop <nodeId> <rate> [direction] [delayMs] [jitterMs]
      if (args[1] === 'drop' && args[2] && args[3]) {
        const nodeId = args[2];
        const rate = parseFloat(args[3]);
        const direction = (args[4] as 'incoming' | 'outgoing' | 'both') || 'both';
        const delayMs = args[5] ? parseInt(args[5], 10) : undefined;
        const jitterMs = args[6] ? parseInt(args[6], 10) : undefined;

        if (args[4] && !['incoming', 'outgoing', 'both'].includes(args[4])) {
          console.log(`Invalid direction: ${args[4]}. Must be 'incoming', 'outgoing', or 'both'`);
          process.exit(1);
        }

        console.log(await client.addMessageDrop(nodeId, [], rate, direction, delayMs, jitterMs));
      } else {
        console.log('Usage: message drop <nodeId> <rate> [direction] [delayMs] [jitterMs]');
        console.log('');
        console.log('Arguments:');
        console.log('  nodeId      Target node ID');
        console.log('  rate        Drop probability (0-1), use 0 for delay-only');
        console.log('  direction   Message direction (optional, default: both)');
        console.log('              - incoming: node → orchestrator');
        console.log('              - outgoing: orchestrator → node');
        console.log('              - both: bidirectional');
        console.log('  delayMs     Delay in milliseconds (optional)');
        console.log('  jitterMs    Random jitter added to delay (optional)');
        console.log('');
        console.log('Examples:');
        console.log('  # Delay node→orch messages by 500ms, leave orch→node clean');
        console.log('  message drop my-node 0 incoming 500 100');
        console.log('');
        console.log('  # Drop 30% of orch→node messages');
        console.log('  message drop my-node 0.3 outgoing');
      }
      break;

    case 'api':
      if (args[1] === 'flaky' && args[2]) {
        console.log(
          await client.setApiFlaky(
            parseFloat(args[2]),
            args[3] ? parseFloat(args[3]) : undefined
          )
        );
      } else {
        console.log('Usage: api flaky <errorRate> [timeoutRate]');
      }
      break;

    case 'run':
      if (!args[1]) {
        console.log('Usage: run <scenario> [--option value ...]');
        const scenarios = await client.listScenarios();
        console.log('Scenarios:', scenarios.map((s) => s.name).join(', '));
      } else {
        // Parse --key value pairs
        const options: Record<string, unknown> = {};
        for (let i = 2; i < args.length; i += 2) {
          const currentArg = args[i];
          const nextArg = args[i + 1];
          if (currentArg?.startsWith('--') && nextArg !== undefined) {
            const key = currentArg.slice(2);
            const value = nextArg;
            // Try to parse as number
            const num = parseFloat(value);
            options[key] = isNaN(num) ? value : num;
          }
        }
        console.log(JSON.stringify(await client.runScenario(args[1], options), null, 2));
      }
      break;

    default:
      console.log(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Parse options
  let serverUrl = DEFAULT_SERVER;
  let insecure = false;
  const args: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!arg) continue;
    if (arg === '--server' && rawArgs[i + 1]) {
      serverUrl = rawArgs[++i]!;
    } else if (arg === '-k' || arg === '--insecure') {
      insecure = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      return;
    } else {
      args.push(arg);
    }
  }

  printBanner();
  console.log(`Server: ${serverUrl}${insecure ? ' (insecure)' : ''}\n`);

  const client = new ChaosApiClient({ serverUrl, insecure });

  if (args.length === 0) {
    // Interactive mode
    await interactiveMode(client);
  } else {
    // Run command directly
    try {
      await runCommand(client, args);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
