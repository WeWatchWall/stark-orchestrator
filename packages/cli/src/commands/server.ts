/**
 * Server Commands
 *
 * Commands for starting and managing the Stark Orchestrator server process.
 * @module @stark-o/cli/commands/server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { info } from '../output.js';

/**
 * Handler for `stark server start`
 *
 * Imports and boots the @stark-o/server in-process, identical to what
 * `node packages/server/dist/index.js` (or `pnpm dev:server`) does,
 * but available to globally-installed `stark` users.
 */
async function startHandler(options: {
  port?: string;
  host?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  exposeHttp?: boolean;
}): Promise<void> {
  // Forward CLI flags into env vars so the server picks them up via its
  // DEFAULT_CONFIG that reads from process.env.
  if (options.port) process.env.PORT = options.port;
  if (options.host) process.env.HOST = options.host;
  if (options.supabaseUrl) process.env.SUPABASE_URL = options.supabaseUrl;
  if (options.supabaseAnonKey) process.env.SUPABASE_ANON_KEY = options.supabaseAnonKey;
  if (options.exposeHttp) process.env.EXPOSE_HTTP = 'true';

  info(`Starting Stark Orchestrator server…`);

  try {
    // Dynamic import so the heavy server bundle is only loaded when needed.
    const { createServer } = await import('@stark-o/server');

    const server = createServer();

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      console.log(chalk.yellow(`\nReceived ${signal}, shutting down gracefully…`));
      try {
        await server.stop();
        process.exit(0);
      } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err);
      shutdown('uncaughtException').catch(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason);
    });

    await server.start();
  } catch (err) {
    console.error(chalk.red('Failed to start server:'), err);
    process.exit(1);
  }
}

/**
 * Creates the `stark server` command group
 */
export function createServerCommand(): Command {
  const server = new Command('server')
    .description('Manage the Stark Orchestrator server');

  server
    .command('start')
    .description('Start the orchestrator server')
    .option('-p, --port <port>', 'HTTPS port (default: 443)')
    .option('--host <host>', 'Bind address (default: 0.0.0.0)')
    .option('--supabase-url <url>', 'Supabase project URL')
    .option('--supabase-anon-key <key>', 'Supabase anonymous key')
    .option('--expose-http', 'Expose HTTP on external interface')
    .action(startHandler);

  return server;
}
