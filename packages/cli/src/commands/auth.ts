/**
 * Auth Commands
 *
 * Authentication commands: login, logout, whoami, setup, add-user
 * @module @stark-o/cli/commands/auth
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'node:readline';
import {
  loadConfig,
  saveCredentials,
  clearCredentials,
  loadCredentials,
  isAuthenticated,
  createCliSupabaseClient,
  createApiClient,
  type Credentials,
} from '../config.js';
import {
  success,
  error,
  info,
  keyValue,
  getOutputFormat,
} from '../output.js';

/**
 * Prompts for input (optionally hidden for passwords)
 */
async function prompt(message: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (hidden) {
      // For password input, we need to handle it differently
      process.stdout.write(message);
      let input = '';

      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const onData = (char: string) => {
        // Handle special characters
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          rl.close();
          console.log();
          resolve(input);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
          }
        } else {
          input += char;
        }
      };

      stdin.on('data', onData);
    } else {
      rl.question(message, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Login command handler
 */
async function loginHandler(options: { email?: string }): Promise<void> {
  const config = loadConfig();

  // Check if already authenticated
  if (isAuthenticated()) {
    const creds = loadCredentials()!;
    info(`Already logged in as ${creds.email}`);
    const proceed = await prompt('Do you want to log out and log in again? (y/N) ');
    if (proceed.toLowerCase() !== 'y') {
      return;
    }
    clearCredentials();
  }

  // Get email
  let email = options.email;
  if (!email) {
    email = await prompt('Email: ');
  }

  if (!email || !email.includes('@')) {
    error('Invalid email address');
    process.exit(1);
  }

  // Get password
  const password = await prompt('Password: ', true);
  if (!password) {
    error('Password is required');
    process.exit(1);
  }

  // Authenticate with Supabase
  info('Authenticating...');

  try {
    const supabase = createCliSupabaseClient(config);
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      error('Authentication failed', { message: authError.message });
      process.exit(1);
    }

    if (!data.session || !data.user) {
      error('Authentication failed: No session returned');
      process.exit(1);
    }

    // Save credentials
    const credentials: Credentials = {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: new Date(data.session.expires_at! * 1000).toISOString(),
      userId: data.user.id,
      email: data.user.email!,
    };

    saveCredentials(credentials);
    success(`Logged in as ${email}`);
  } catch (err) {
    error('Authentication failed', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Logout command handler
 */
async function logoutHandler(): Promise<void> {
  if (!isAuthenticated()) {
    info('Not currently logged in');
    return;
  }

  const creds = loadCredentials()!;
  const email = creds.email;

  try {
    const supabase = createCliSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Ignore errors during signout
  }

  clearCredentials();
  success(`Logged out from ${email}`);
}

/**
 * Whoami command handler
 */
async function whoamiHandler(): Promise<void> {
  if (!isAuthenticated()) {
    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify({ authenticated: false }));
    } else {
      info('Not logged in. Run `stark auth login` to authenticate.');
    }
    return;
  }

  const creds = loadCredentials()!;
  const expiresAt = new Date(creds.expiresAt);
  const now = new Date();
  const expiresIn = Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60);

  if (getOutputFormat() === 'json') {
    console.log(JSON.stringify({
      authenticated: true,
      userId: creds.userId,
      email: creds.email,
      expiresAt: creds.expiresAt,
      expiresInMinutes: expiresIn,
    }, null, 2));
  } else {
    console.log(chalk.bold('\nCurrent User'));
    console.log('─'.repeat(40));
    keyValue({
      'Email': creds.email,
      'User ID': creds.userId,
      'Session Expires': expiresAt.toLocaleString(),
      'Expires In': `${expiresIn} minutes`,
    });
    console.log();
  }
}

/**
 * Setup command handler - creates the first admin user
 */
async function setupHandler(options: { email?: string }): Promise<void> {
  const config = loadConfig();
  const apiClient = createApiClient(config);

  // Check if setup is needed
  info('Checking if setup is needed...');

  try {
    const statusResponse = await apiClient.get('/auth/setup/status');
    const statusData = await statusResponse.json() as { success: boolean; data?: { needsSetup: boolean }; error?: { message: string } };

    if (!statusResponse.ok || !statusData.success) {
      error('Failed to check setup status', { message: statusData.error?.message ?? 'Unknown error' });
      process.exit(1);
    }

    if (!statusData.data?.needsSetup) {
      info('Setup has already been completed.');
      info('To add new users, login as an admin and use `stark auth add-user`');
      return;
    }

    console.log(chalk.yellow('\n⚠️  No users exist. Setting up initial admin account.\n'));

    // Get email
    let email = options.email;
    if (!email) {
      email = await prompt('Admin Email: ');
    }

    if (!email || !email.includes('@')) {
      error('Invalid email address');
      process.exit(1);
    }

    // Get password
    const password = await prompt('Password: ', true);
    if (!password) {
      error('Password is required');
      process.exit(1);
    }

    if (password.length < 8) {
      error('Password must be at least 8 characters');
      process.exit(1);
    }

    // Confirm password
    const confirmPassword = await prompt('Confirm Password: ', true);
    if (password !== confirmPassword) {
      error('Passwords do not match');
      process.exit(1);
    }

    // Get display name (optional)
    const displayName = await prompt('Display Name (optional): ');

    info('Creating admin account...');

    const setupResponse = await apiClient.post('/auth/setup', {
      email,
      password,
      displayName: displayName || undefined,
    });

    const setupData = await setupResponse.json() as {
      success: boolean;
      data?: {
        user: { id: string; email: string; roles: string[] };
        accessToken: string;
        refreshToken?: string;
        expiresAt: string;
      };
      error?: { message: string };
    };

    if (!setupResponse.ok || !setupData.success) {
      error('Setup failed', { message: setupData.error?.message ?? 'Unknown error' });
      process.exit(1);
    }

    // Save credentials
    const credentials: Credentials = {
      accessToken: setupData.data!.accessToken,
      refreshToken: setupData.data!.refreshToken,
      expiresAt: setupData.data!.expiresAt,
      userId: setupData.data!.user.id,
      email: setupData.data!.user.email,
    };

    saveCredentials(credentials);

    success(`Admin account created and logged in as ${email}`);
    console.log(chalk.dim(`Roles: ${setupData.data!.user.roles.join(', ')}`));
  } catch (err) {
    error('Setup failed', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Add user command handler - creates a new user (admin only)
 */
async function addUserHandler(options: { email?: string; role?: string[] }): Promise<void> {
  // Check if authenticated
  if (!isAuthenticated()) {
    error('Not authenticated. Run `stark auth login` first.');
    process.exit(1);
  }

  const config = loadConfig();
  const apiClient = createApiClient(config);

  // Get email
  let email = options.email;
  if (!email) {
    email = await prompt('New User Email: ');
  }

  if (!email || !email.includes('@')) {
    error('Invalid email address');
    process.exit(1);
  }

  // Get password
  const password = await prompt('Password for new user: ', true);
  if (!password) {
    error('Password is required');
    process.exit(1);
  }

  if (password.length < 8) {
    error('Password must be at least 8 characters');
    process.exit(1);
  }

  // Get display name (optional)
  const displayName = await prompt('Display Name (optional): ');

  // Get roles
  let roles = options.role ?? [];
  if (roles.length === 0) {
    console.log(chalk.dim('\nAvailable roles: admin, operator, developer, viewer'));
    const rolesInput = await prompt('Roles (comma-separated, default: viewer): ');
    roles = rolesInput ? rolesInput.split(',').map(r => r.trim()).filter(r => r) : ['viewer'];
  }

  info('Creating user...');

  try {
    const response = await apiClient.post('/auth/users', {
      email,
      password,
      displayName: displayName || undefined,
      roles,
    });

    const data = await response.json() as {
      success: boolean;
      data?: { user: { id: string; email: string; roles: string[] } };
      error?: { code: string; message: string };
    };

    if (!response.ok || !data.success) {
      if (response.status === 403) {
        error('Permission denied. Only administrators can add users.');
      } else if (response.status === 409) {
        error('A user with this email already exists.');
      } else {
        error('Failed to create user', { message: data.error?.message ?? 'Unknown error' });
      }
      process.exit(1);
    }

    success(`User created: ${data.data!.user.email}`);
    console.log(chalk.dim(`User ID: ${data.data!.user.id}`));
    console.log(chalk.dim(`Roles: ${data.data!.user.roles.join(', ')}`));
  } catch (err) {
    error('Failed to create user', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * List users command handler - lists all users (admin only)
 */
async function listUsersHandler(): Promise<void> {
  // Check if authenticated
  if (!isAuthenticated()) {
    error('Not authenticated. Run `stark auth login` first.');
    process.exit(1);
  }

  const config = loadConfig();
  const apiClient = createApiClient(config);

  try {
    const response = await apiClient.get('/auth/users');
    const data = await response.json() as {
      success: boolean;
      data?: { users: Array<{ id: string; email: string; displayName?: string; roles: string[]; createdAt: string }> };
      error?: { message: string };
    };

    if (!response.ok || !data.success) {
      if (response.status === 403) {
        error('Permission denied. Only administrators can list users.');
      } else {
        error('Failed to list users', { message: data.error?.message ?? 'Unknown error' });
      }
      process.exit(1);
    }

    const users = data.data!.users;

    if (getOutputFormat() === 'json') {
      console.log(JSON.stringify(users, null, 2));
    } else {
      console.log(chalk.bold('\nUsers'));
      console.log('─'.repeat(60));

      if (users.length === 0) {
        console.log(chalk.dim('No users found'));
      } else {
        for (const user of users) {
          console.log(`${chalk.cyan(user.email)}`);
          console.log(chalk.dim(`  ID: ${user.id}`));
          if (user.displayName) {
            console.log(chalk.dim(`  Name: ${user.displayName}`));
          }
          console.log(chalk.dim(`  Roles: ${user.roles.join(', ')}`));
          console.log(chalk.dim(`  Created: ${new Date(user.createdAt).toLocaleString()}`));
          console.log();
        }
      }
    }
  } catch (err) {
    error('Failed to list users', err instanceof Error ? { message: err.message } : undefined);
    process.exit(1);
  }
}

/**
 * Creates the auth command group
 */
export function createAuthCommand(): Command {
  const auth = new Command('auth')
    .description('Authentication commands');

  auth
    .command('login')
    .description('Log in to Stark Orchestrator')
    .option('-e, --email <email>', 'Email address')
    .action(loginHandler);

  auth
    .command('logout')
    .description('Log out from Stark Orchestrator')
    .action(logoutHandler);

  auth
    .command('whoami')
    .description('Show current authenticated user')
    .action(whoamiHandler);

  // Alias for quick status check
  auth
    .command('status')
    .description('Check authentication status')
    .action(async () => {
      if (isAuthenticated()) {
        success('Authenticated');
      } else {
        info('Not authenticated');
      }
    });

  auth
    .command('setup')
    .description('Create the initial admin account (only works when no users exist)')
    .option('-e, --email <email>', 'Admin email address')
    .action(setupHandler);

  auth
    .command('add-user')
    .description('Add a new user (admin only)')
    .option('-e, --email <email>', 'New user email address')
    .option('-r, --role <role...>', 'User roles (admin, operator, developer, viewer)')
    .action(addUserHandler);

  auth
    .command('list-users')
    .description('List all users (admin only)')
    .action(listUsersHandler);

  return auth;
}
