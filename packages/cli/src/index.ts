#!/usr/bin/env node
/**
 * Stark Orchestrator CLI
 *
 * Command-line interface for managing packs, nodes, pods, and namespaces.
 * @module @stark-o/cli
 */

import { Command } from 'commander';
import { loadConfig, isAuthenticated } from './config.js';
import { setOutputFormat, type OutputFormat } from './output.js';
import { createAuthCommand } from './commands/auth.js';
import { createPackCommand } from './commands/pack.js';
import { createNodeCommand } from './commands/node.js';
import { createPodCommand } from './commands/pod.js';
import { createNamespaceCommand } from './commands/namespace.js';

/**
 * CLI version from package.json
 */
const VERSION = '0.0.1';

/**
 * CLI program description
 */
const DESCRIPTION = `
Stark Orchestrator CLI

A command-line interface for managing distributed pack deployments
across Node.js servers and browser runtimes.

Commands:
  auth        Authentication commands (login, logout, whoami)
  pack        Pack management (register, list, versions)
  node        Node management (list, status)
  pod         Pod management (create, list, status, rollback)
  namespace   Namespace management (create, list, delete)

Examples:
  $ stark auth login
  $ stark pack list
  $ stark pod create my-pack --node my-node
  $ stark node list --status healthy
`;

/**
 * Creates and configures the main CLI program
 */
function createProgram(): Command {
  const program = new Command();

  program
    .name('stark')
    .version(VERSION, '-v, --version', 'Display CLI version')
    .description(DESCRIPTION)
    .option('-o, --output <format>', 'Output format: json, table, plain', 'table')
    .option('--api-url <url>', 'API server URL')
    .option('--no-color', 'Disable colored output')
    .hook('preAction', (thisCommand) => {
      // Set output format from global option
      const opts = thisCommand.opts();
      if (opts.output) {
        setOutputFormat(opts.output as OutputFormat);
      }

      // Handle --no-color
      if (opts.color === false) {
        process.env.FORCE_COLOR = '0';
      }
    });

  // Add subcommands
  program.addCommand(createAuthCommand());
  program.addCommand(createPackCommand());
  program.addCommand(createNodeCommand());
  program.addCommand(createPodCommand());
  program.addCommand(createNamespaceCommand());

  // Add config command for managing CLI settings
  program
    .command('config')
    .description('Manage CLI configuration')
    .option('--show', 'Show current configuration')
    .option('--set <key=value>', 'Set a configuration value')
    .action((options) => {
      const config = loadConfig();

      if (options.show) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      if (options.set) {
        const [key, value] = options.set.split('=');
        console.log(`Setting ${key} to ${value}`);
        // Would call saveConfig here
      }
    });

  // Add status command for quick cluster overview
  program
    .command('status')
    .description('Show cluster status overview')
    .action(async () => {
      if (!isAuthenticated()) {
        console.log('Not authenticated. Run `stark auth login` first.');
        return;
      }
      console.log('Cluster Status:');
      console.log('  Authenticated: Yes');
      console.log('  API: ' + loadConfig().apiUrl);
      // Would fetch and display cluster stats here
    });

  return program;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof Error) {
      console.error('Error:', err.message);
    }
    process.exit(1);
  }
}

// Run the CLI
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
