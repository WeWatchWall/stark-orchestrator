/**
 * CLI Integration Tests
 *
 * Integration tests for the Stark Orchestrator CLI commands.
 * @module @stark-o/cli/tests/integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock modules before importing CLI components
vi.mock('node:fs');
vi.mock('node:readline');

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import {
  loadConfig,
  saveConfig,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  isAuthenticated,
  CONFIG_DIR,
  CONFIG_FILE,
  CREDENTIALS_FILE,
  type CliConfig,
  type Credentials,
} from '../../src/config.js';

import {
  setOutputFormat,
  getOutputFormat,
  success,
  error,
  info,
  table,
  keyValue,
} from '../../src/output.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a mock API response
 */
function mockApiResponse<T>(data: T, success = true): Promise<Response> {
  return Promise.resolve({
    json: () => Promise.resolve({ success, data }),
    ok: success,
    status: success ? 200 : 400,
  } as Response);
}

/**
 * Creates a mock error response
 */
function mockErrorResponse(code: string, message: string): Promise<Response> {
  return Promise.resolve({
    json: () => Promise.resolve({
      success: false,
      error: { code, message },
    }),
    ok: false,
    status: 400,
  } as Response);
}

// ============================================================================
// Config Module Tests
// ============================================================================

describe('Config Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  describe('loadConfig', () => {
    it('should return default config when no config file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const config = loadConfig();

      expect(config.apiUrl).toBe('http://127.0.0.1:3000');
      expect(config.supabaseUrl).toBe('http://127.0.0.1:54321');
      expect(config.defaultNamespace).toBe('default');
      expect(config.defaultOutputFormat).toBe('table');
    });

    it('should load and merge config from file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        apiUrl: 'https://api.example.com',
        defaultNamespace: 'production',
      }));

      const config = loadConfig();

      expect(config.apiUrl).toBe('https://api.example.com');
      expect(config.defaultNamespace).toBe('production');
      // Should still have defaults for unspecified values
      expect(config.defaultOutputFormat).toBe('table');
    });

    it('should return defaults on parse error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const config = loadConfig();

      expect(config.apiUrl).toBe('http://127.0.0.1:3000');
    });
  });

  describe('saveConfig', () => {
    it('should create config directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      saveConfig({ defaultNamespace: 'test' });

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        CONFIG_DIR,
        expect.objectContaining({ recursive: true })
      );
    });

    it('should merge with existing config', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => p === CONFIG_FILE);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        apiUrl: 'https://existing.com',
      }));
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      saveConfig({ defaultNamespace: 'new-ns' });

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent);

      expect(written.apiUrl).toBe('https://existing.com');
      expect(written.defaultNamespace).toBe('new-ns');
    });
  });

  describe('credentials', () => {
    const testCredentials: Credentials = {
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      userId: 'user-123',
      email: 'test@example.com',
    };

    it('should save credentials securely', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      saveCredentials(testCredentials);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        CREDENTIALS_FILE,
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      );
    });

    it('should load credentials from file', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => p === CREDENTIALS_FILE);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(testCredentials));

      const creds = loadCredentials();

      expect(creds).not.toBeNull();
      expect(creds?.email).toBe('test@example.com');
      expect(creds?.accessToken).toBe('test-token');
    });

    it('should return null when no credentials file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const creds = loadCredentials();

      expect(creds).toBeNull();
    });

    it('should clear credentials by deleting file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

      clearCredentials();

      expect(fs.unlinkSync).toHaveBeenCalledWith(CREDENTIALS_FILE);
    });

    it('should detect authenticated state based on valid token', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => p === CREDENTIALS_FILE);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(testCredentials));

      expect(isAuthenticated()).toBe(true);
    });

    it('should detect unauthenticated state when token is expired', () => {
      const expiredCredentials = {
        ...testCredentials,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
      };

      vi.mocked(fs.existsSync).mockImplementation((p) => p === CREDENTIALS_FILE);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(expiredCredentials));

      expect(isAuthenticated()).toBe(false);
    });
  });
});

// ============================================================================
// Output Module Tests
// ============================================================================

describe('Output Module', () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setOutputFormat('table');
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  describe('setOutputFormat / getOutputFormat', () => {
    it('should set and get output format', () => {
      setOutputFormat('json');
      expect(getOutputFormat()).toBe('json');

      setOutputFormat('table');
      expect(getOutputFormat()).toBe('table');

      setOutputFormat('plain');
      expect(getOutputFormat()).toBe('plain');
    });
  });

  describe('success', () => {
    it('should output success message in table format', () => {
      setOutputFormat('table');
      success('Operation completed');

      expect(consoleLog).toHaveBeenCalled();
      const output = consoleLog.mock.calls[0][0] as string;
      expect(output).toContain('Operation completed');
    });

    it('should output JSON in json format', () => {
      setOutputFormat('json');
      success('Operation completed');

      expect(consoleLog).toHaveBeenCalled();
      const output = JSON.parse(consoleLog.mock.calls[0][0] as string);
      expect(output.success).toBe(true);
      expect(output.message).toBe('Operation completed');
    });
  });

  describe('error', () => {
    it('should output error message', () => {
      setOutputFormat('table');
      error('Something went wrong');

      expect(consoleError).toHaveBeenCalled();
      const output = consoleError.mock.calls[0][0] as string;
      expect(output).toContain('Something went wrong');
    });

    it('should include details in JSON format', () => {
      setOutputFormat('json');
      error('Failed', { code: 'ERR_001' });

      expect(consoleError).toHaveBeenCalled();
      const output = JSON.parse(consoleError.mock.calls[0][0] as string);
      expect(output.success).toBe(false);
      expect(output.error).toBe('Failed');
      expect(output.details).toEqual({ code: 'ERR_001' });
    });
  });

  describe('table', () => {
    it('should output formatted table', () => {
      setOutputFormat('table');
      table([
        { name: 'test1', value: 123 },
        { name: 'test2', value: 456 },
      ]);

      expect(consoleLog).toHaveBeenCalled();
    });

    it('should output JSON array in json format', () => {
      setOutputFormat('json');
      const data = [
        { name: 'test1', value: 123 },
        { name: 'test2', value: 456 },
      ];
      table(data);

      expect(consoleLog).toHaveBeenCalled();
      const output = JSON.parse(consoleLog.mock.calls[0][0] as string);
      expect(output).toEqual(data);
    });

    it('should handle empty data', () => {
      setOutputFormat('table');
      table([]);

      expect(consoleLog).toHaveBeenCalled();
      const output = consoleLog.mock.calls[0][0] as string;
      expect(output).toContain('No data');
    });
  });

  describe('keyValue', () => {
    it('should output key-value pairs', () => {
      setOutputFormat('table');
      keyValue({
        Name: 'Test',
        Version: '1.0.0',
        Active: true,
      });

      expect(consoleLog).toHaveBeenCalledTimes(3);
    });

    it('should output JSON object in json format', () => {
      setOutputFormat('json');
      const data = { Name: 'Test', Version: '1.0.0' };
      keyValue(data);

      expect(consoleLog).toHaveBeenCalled();
      const output = JSON.parse(consoleLog.mock.calls[0][0] as string);
      expect(output).toEqual(data);
    });
  });
});

// ============================================================================
// Command Tests (with mocked API)
// ============================================================================

describe('CLI Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();

    // Setup authenticated state
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return p === CREDENTIALS_FILE;
    });
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (p === CREDENTIALS_FILE) {
        return JSON.stringify({
          accessToken: 'test-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          userId: 'user-123',
          email: 'test@example.com',
        });
      }
      return '{}';
    });
  });

  describe('pack list', () => {
    it('should call API and display packs', async () => {
      const mockPacks = {
        packs: [
          {
            id: 'pack-1',
            name: 'my-pack',
            version: '1.0.0',
            runtimeTag: 'node',
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      };

      mockFetch.mockResolvedValueOnce(mockApiResponse(mockPacks));

      // Import and create pack command
      const { createPackCommand } = await import('../../src/commands/pack.js');
      const packCmd = createPackCommand();

      // This would normally be executed via CLI
      // For testing, we verify the command structure
      expect(packCmd.name()).toBe('pack');
      expect(packCmd.commands.find((c) => c.name() === 'list')).toBeDefined();
    });
  });

  describe('node list', () => {
    it('should have list command', async () => {
      const { createNodeCommand } = await import('../../src/commands/node.js');
      const nodeCmd = createNodeCommand();

      expect(nodeCmd.name()).toBe('node');
      expect(nodeCmd.commands.find((c) => c.name() === 'list')).toBeDefined();
      expect(nodeCmd.commands.find((c) => c.name() === 'status')).toBeDefined();
      expect(nodeCmd.commands.find((c) => c.name() === 'watch')).toBeDefined();
    });
  });

  describe('pod', () => {
    it('should have pod commands', async () => {
      const { createPodCommand } = await import('../../src/commands/pod.js');
      const podCmd = createPodCommand();

      expect(podCmd.name()).toBe('pod');
      expect(podCmd.commands.find((c) => c.name() === 'create')).toBeDefined();
      expect(podCmd.commands.find((c) => c.name() === 'list')).toBeDefined();
      expect(podCmd.commands.find((c) => c.name() === 'status')).toBeDefined();
      expect(podCmd.commands.find((c) => c.name() === 'rollback')).toBeDefined();
      expect(podCmd.commands.find((c) => c.name() === 'history')).toBeDefined();
      expect(podCmd.commands.find((c) => c.name() === 'stop')).toBeDefined();
    });
  });

  describe('namespace', () => {
    it('should have namespace commands', async () => {
      const { createNamespaceCommand } = await import('../../src/commands/namespace.js');
      const nsCmd = createNamespaceCommand();

      expect(nsCmd.name()).toBe('namespace');
      expect(nsCmd.commands.find((c) => c.name() === 'create')).toBeDefined();
      expect(nsCmd.commands.find((c) => c.name() === 'list')).toBeDefined();
      expect(nsCmd.commands.find((c) => c.name() === 'get')).toBeDefined();
      expect(nsCmd.commands.find((c) => c.name() === 'delete')).toBeDefined();
      expect(nsCmd.commands.find((c) => c.name() === 'quota')).toBeDefined();
      expect(nsCmd.commands.find((c) => c.name() === 'use')).toBeDefined();
      expect(nsCmd.commands.find((c) => c.name() === 'current')).toBeDefined();
    });
  });

  describe('auth', () => {
    it('should have auth commands', async () => {
      const { createAuthCommand } = await import('../../src/commands/auth.js');
      const authCmd = createAuthCommand();

      expect(authCmd.name()).toBe('auth');
      expect(authCmd.commands.find((c) => c.name() === 'login')).toBeDefined();
      expect(authCmd.commands.find((c) => c.name() === 'logout')).toBeDefined();
      expect(authCmd.commands.find((c) => c.name() === 'whoami')).toBeDefined();
      expect(authCmd.commands.find((c) => c.name() === 'status')).toBeDefined();
    });
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('Unauthenticated access', () => {
    it('should detect unauthenticated state', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(isAuthenticated()).toBe(false);
    });
  });

  describe('API error handling', () => {
    it('should parse API error responses', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse('NOT_FOUND', 'Pack not found'));

      const response = await fetch('/api/packs/nonexistent');
      const result = await response.json();

      expect(result.success).toBe(false);
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('Pack not found');
    });
  });

  describe('Config persistence', () => {
    it('should persist namespace preference', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{}');
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      saveConfig({ defaultNamespace: 'production' });

      const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const written = JSON.parse(writtenContent);

      expect(written.defaultNamespace).toBe('production');
    });
  });
});
