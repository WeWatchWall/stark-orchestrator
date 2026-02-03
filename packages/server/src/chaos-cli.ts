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
    dropRate: number
  ): Promise<unknown> {
    return this.request('POST', '/message/drop', { nodeId, messageTypes, dropRate });
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

Connection Options:
  --server <url>    Server URL (default: https://localhost)
  -k, --insecure    Skip TLS certificate verification

Commands:
  enable                            Enable chaos mode on server
  disable                           Disable chaos mode
  status                            Show chaos status
  scenarios                         List available scenarios
  stats                             Show chaos statistics
  events [count]                    Show recent chaos events
  clear                             Clear all chaos rules

  nodes                             List connected nodes (use to find node IDs)
  connections                       List active WebSocket connections

  node kill <nodeId>                Kill a node's connection
  heartbeat delay <nodeId> <ms> [duration]   Add heartbeat delay
  heartbeat drop <nodeId> <rate>    Drop heartbeats (rate 0-1)
  message drop <nodeId> <rate>      Drop messages (rate 0-1)
  api flaky <errorRate> [timeoutRate]  Make API calls flaky

  run <scenario> [options...]       Run a scenario

Examples:
  pnpm dev:test -k enable
  pnpm dev:test -k node kill my-node-1
  pnpm dev:test -k heartbeat delay my-node-1 3000 60000
  pnpm dev:test -k api flaky 0.3
  pnpm dev:test -k run node-loss --mode single --nodeId my-node-1

Interactive Mode:
  Run without a command to enter interactive mode.
`);
}

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
Commands:
  enable              Enable chaos on server
  disable             Disable chaos
  status              Show status
  scenarios           List scenarios
  stats               Show statistics
  events [n]          Show last n events
  clear               Clear all rules

  nodes               List connected nodes (use this to get node IDs)
  connections         List active WebSocket connections

  kill <nodeId>       Kill node connection
  delay <nodeId> <ms> Add heartbeat delay
  drop <nodeId> <rate> Drop messages
  flaky <errorRate>   Make API flaky

  run <scenario>      Run scenario (will prompt for options)

  exit, quit          Exit
`);
          break;

        case 'enable':
          console.log(await client.enable());
          break;

        case 'disable':
          console.log(await client.disable());
          break;

        case 'status':
          console.log(await client.getStatus());
          break;

        case 'scenarios':
          const scenarios = await client.listScenarios();
          for (const s of scenarios) {
            console.log(`  ${s.name}: ${s.description}`);
          }
          break;

        case 'stats':
          console.log(JSON.stringify(await client.getStats(), null, 2));
          break;

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
          if (!parts[1] || !parts[2]) {
            console.log('Usage: delay <nodeId> <ms> [durationMs]');
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
          } else {
            console.log(
              await client.addMessageDrop(parts[1], [], parseFloat(parts[2]))
            );
          }
          break;

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
      if (args[1] === 'drop' && args[2] && args[3]) {
        console.log(await client.addMessageDrop(args[2], [], parseFloat(args[3])));
      } else {
        console.log('Usage: message drop <nodeId> <rate>');
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
