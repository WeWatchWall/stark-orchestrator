/**
 * Server Config Commands
 *
 * Commands for managing server-side application configuration
 * @module @stark-o/cli/commands/server-config
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadConfig,
  isAuthenticated,
  createApiClient,
} from '../config.js';
import {
  success,
  error,
  info,
  keyValue,
  getOutputFormat,
} from '../output.js';

/**
 * Get server config command handler
 */
async function getServerConfigHandler(): Promise<void> {
  const config = loadConfig();
  const apiClient = createApiClient(config);

  try {
    const response = await apiClient.get('/api/config');
    const data = await response.json() as {
      success: boolean;
      data?: { enablePublicRegistration: boolean };
      error?: { message: string };
    };

    if (!response.ok || !data.success) {
      error('Failed to get server configuration', { message: data.error?.message ?? 'Unknown error' });
      process.exit(1);
    }

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(data.data, null, 2));
    } else {
      console.log(chalk.bold('\nServer Configuration'));
      console.log('─'.repeat(40));
      keyValue({
        'Public Registration': data.data!.enablePublicRegistration ? chalk.green('Enabled') : chalk.red('Disabled'),
      });
      console.log();
    }
  } catch (err) {
    error('Failed to get server configuration', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Set server config command handler
 */
async function setServerConfigHandler(options: { enableRegistration?: boolean; disableRegistration?: boolean }): Promise<void> {
  // Check if authenticated
  if (!isAuthenticated()) {
    error('Not authenticated. Run `stark auth login` first.');
    process.exit(1);
  }

  // Determine what to set
  let enablePublicRegistration: boolean | undefined;

  if (options.enableRegistration) {
    enablePublicRegistration = true;
  } else if (options.disableRegistration) {
    enablePublicRegistration = false;
  } else {
    error('Please specify --enable-registration or --disable-registration');
    process.exit(1);
  }

  const config = loadConfig();
  const apiClient = createApiClient(config);

  info('Updating server configuration...');

  try {
    const response = await apiClient.put('/api/config', {
      enablePublicRegistration,
    });

    const data = await response.json() as {
      success: boolean;
      data?: { enablePublicRegistration: boolean; updatedAt: string };
      error?: { code: string; message: string };
    };

    if (!response.ok || !data.success) {
      if (response.status === 401) {
        error('Authentication required. Please log in again.');
      } else if (response.status === 403) {
        error('Permission denied. Only administrators can update server configuration.');
      } else {
        error('Failed to update server configuration', { message: data.error?.message ?? 'Unknown error' });
      }
      process.exit(1);
    }

    success('Server configuration updated');
    if (getOutputFormat() !== 'json') {
      keyValue({
        'Public Registration': data.data!.enablePublicRegistration ? chalk.green('Enabled') : chalk.red('Disabled'),
      });
    } else {
      console.log(JSON.stringify(data.data, null, 2));
    }
  } catch (err) {
    error('Failed to update server configuration', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Creates the server-config command group
 */
export function createServerConfigCommand(): Command {
  const serverConfig = new Command('server-config')
    .description('Manage server-side configuration (admin only)');

  serverConfig
    .command('get')
    .description('Get current server configuration')
    .action(getServerConfigHandler);

  serverConfig
    .command('set')
    .description('Update server configuration (admin only)')
    .option('--enable-registration', 'Enable public user registration')
    .option('--disable-registration', 'Disable public user registration')
    .action(setServerConfigHandler);

  return serverConfig;
}
