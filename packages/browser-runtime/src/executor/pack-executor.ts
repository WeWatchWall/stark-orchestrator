/**
 * Pack Executor (Browser Runtime)
 * @module @stark-o/browser-runtime/executor/pack-executor
 *
 * Executes pack bundles in Web Workers for isolated, concurrent execution.
 * Provides lifecycle management, resource tracking, and error handling.
 */

import {
  WorkerAdapter,
  type BrowserWorkerAdapterConfig,
  type TaskHandle,
  type PoolStats,
} from '../adapters/worker-adapter.js';
import { StorageAdapter, type BrowserStorageConfig } from '../adapters/storage-adapter.js';
import { FetchAdapter, type BrowserHttpAdapterConfig } from '../adapters/fetch-adapter.js';
import {
  createServiceLogger,
  PodError,
  type Logger,
  type Pack,
  type Pod,
  type RuntimeTag,
} from '@stark-o/shared';

/**
 * Generate a UUID (browser-compatible)
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Pack execution context passed to the pack's entry point
 */
export interface PackExecutionContext {
  /** Unique execution ID */
  executionId: string;
  /** Pod ID */
  podId: string;
  /** Pack ID */
  packId: string;
  /** Pack version */
  packVersion: string;
  /** Pack name */
  packName: string;
  /** Runtime tag */
  runtimeTag: RuntimeTag;
  /** Environment variables */
  env: Record<string, string>;
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Pack execution result
 */
export interface PackExecutionResult {
  /** Execution ID */
  executionId: string;
  /** Pod ID */
  podId: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Return value from the pack */
  returnValue?: unknown;
  /** Error message if failed */
  error?: string;
  /** Error stack trace if failed */
  errorStack?: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Memory usage in bytes (if available) */
  memoryUsage?: number;
  /** Exit code (0 for success) */
  exitCode: number;
}

/**
 * Running execution handle
 */
export interface ExecutionHandle {
  /** Execution ID */
  executionId: string;
  /** Pod ID */
  podId: string;
  /** Promise resolving to execution result */
  promise: Promise<PackExecutionResult>;
  /** Cancel the execution */
  cancel: () => void;
  /** Check if cancelled */
  isCancelled: () => boolean;
  /** Execution start time */
  startedAt: Date;
}

/**
 * Pack executor configuration
 */
export interface PackExecutorConfig {
  /** Base path for pack bundles in storage (default: '/packs') */
  bundlePath?: string;
  /** Orchestrator URL for downloading bundles (optional) */
  orchestratorUrl?: string;
  /** Auth token for bundle downloads */
  authToken?: string;
  /** Worker adapter configuration */
  workerConfig?: BrowserWorkerAdapterConfig;
  /** Storage adapter configuration */
  storageConfig?: BrowserStorageConfig;
  /** HTTP adapter configuration */
  httpConfig?: BrowserHttpAdapterConfig;
  /** Default execution timeout in milliseconds (default: 300000 = 5 minutes) */
  defaultTimeout?: number;
  /** Maximum concurrent executions (default: 4) */
  maxConcurrent?: number;
  /** Logger instance */
  logger?: Logger;
}

/**
 * Execution status for tracking
 */
interface ExecutionState {
  executionId: string;
  podId: string;
  packId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  handle?: TaskHandle<unknown>;
  startedAt: Date;
  completedAt?: Date;
  result?: PackExecutionResult;
}

/**
 * Pack Executor (Browser Runtime)
 *
 * Manages the execution of pack bundles in isolated Web Workers.
 * Features:
 * - Concurrent execution with worker pool
 * - Execution lifecycle management (start, stop, cancel)
 * - Resource tracking and limits
 * - Timeout handling
 * - Error isolation per execution
 */
export class PackExecutor {
  private readonly config: Required<
    Omit<PackExecutorConfig, 'workerConfig' | 'storageConfig' | 'httpConfig' | 'orchestratorUrl' | 'authToken' | 'logger'>
  > & {
    workerConfig?: BrowserWorkerAdapterConfig;
    storageConfig?: BrowserStorageConfig;
    httpConfig?: BrowserHttpAdapterConfig;
    orchestratorUrl?: string;
    authToken?: string;
    logger: Logger;
  };
  private workerAdapter: WorkerAdapter;
  private storageAdapter: StorageAdapter;
  private httpAdapter: FetchAdapter | null = null;
  private initialized = false;
  private readonly executions: Map<string, ExecutionState> = new Map();
  private readonly podExecutions: Map<string, string> = new Map(); // podId -> executionId

  constructor(config: PackExecutorConfig = {}) {
    this.config = {
      bundlePath: config.bundlePath ?? '/packs',
      orchestratorUrl: config.orchestratorUrl,
      authToken: config.authToken,
      workerConfig: config.workerConfig,
      storageConfig: config.storageConfig,
      httpConfig: config.httpConfig,
      defaultTimeout: config.defaultTimeout ?? 300000,
      maxConcurrent: config.maxConcurrent ?? 4, // Lower default for browsers
      logger: config.logger ?? createServiceLogger({
        component: 'pack-executor',
        service: 'stark-browser-runtime',
      }),
    };

    // Initialize worker adapter with configured or default settings
    this.workerAdapter = new WorkerAdapter({
      maxWorkers: this.config.maxConcurrent,
      maxQueueSize: this.config.maxConcurrent * 2,
      taskTimeout: this.config.defaultTimeout,
      ...this.config.workerConfig,
      onError: (error): void => {
        this.config.logger.error('Worker pool error', error);
        this.config.workerConfig?.onError?.(error);
      },
    });

    // Initialize storage adapter for IndexedDB
    this.storageAdapter = new StorageAdapter({
      rootPath: this.config.bundlePath,
      storeName: 'stark-pack-bundles',
      ...this.config.storageConfig,
    });

    // Initialize HTTP adapter if orchestrator URL is provided
    if (this.config.orchestratorUrl !== undefined && this.config.orchestratorUrl !== '') {
      this.httpAdapter = new FetchAdapter({
        baseUrl: this.config.orchestratorUrl,
        timeout: 60000,
        headers: this.config.authToken !== undefined && this.config.authToken !== ''
          ? { Authorization: `Bearer ${this.config.authToken}` }
          : undefined,
        ...this.config.httpConfig,
      });
    }
  }

  /**
   * Initialize the pack executor.
   * Must be called before executing any packs.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.config.logger.info('Initializing browser pack executor', {
      bundlePath: this.config.bundlePath,
      maxConcurrent: this.config.maxConcurrent,
      defaultTimeout: this.config.defaultTimeout,
    });

    await Promise.all([
      this.workerAdapter.initialize(),
      this.storageAdapter.initialize(),
    ]);

    if (this.httpAdapter) {
      await this.httpAdapter.initialize();
    }

    this.initialized = true;
    this.config.logger.info('Browser pack executor initialized');
  }

  /**
   * Check if the executor is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure the executor is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PackExecutor not initialized. Call initialize() first.');
    }
  }

  /**
   * Execute a pack for a pod.
   *
   * @param pack - Pack to execute
   * @param pod - Pod requesting the execution
   * @param options - Execution options
   * @returns Execution handle for tracking and cancellation
   */
  execute(
    pack: Pack,
    pod: Pod,
    options: {
      env?: Record<string, string>;
      timeout?: number;
      args?: unknown[];
    } = {}
  ): ExecutionHandle {
    this.ensureInitialized();

    // Check if pod already has a running execution
    const existingExecutionId = this.podExecutions.get(pod.id);
    if (existingExecutionId !== undefined) {
      const existingState = this.executions.get(existingExecutionId);
      if (existingState && existingState.status === 'running') {
        throw PodError.alreadyRunning(pod.id);
      }
    }

    // Validate runtime compatibility
    if (pack.runtimeTag !== 'browser' && pack.runtimeTag !== 'universal') {
      throw PodError.startFailed(
        `Pack runtime tag '${pack.runtimeTag}' is not compatible with browser runtime`,
        pod.id
      );
    }

    const executionId = generateUUID();
    const timeout = options.timeout ?? pack.metadata?.timeout ?? this.config.defaultTimeout;
    const startedAt = new Date();

    // Create execution context
    const context: PackExecutionContext = {
      executionId,
      podId: pod.id,
      packId: pack.id,
      packVersion: pack.version,
      packName: pack.name,
      runtimeTag: pack.runtimeTag,
      env: {
        ...pack.metadata?.env,
        ...options.env,
        STARK_POD_ID: pod.id,
        STARK_PACK_ID: pack.id,
        STARK_PACK_VERSION: pack.version,
        STARK_EXECUTION_ID: executionId,
      },
      timeout,
      metadata: {
        ...pack.metadata,
        ...pod.metadata,
      },
    };

    this.config.logger.info('Starting pack execution', {
      executionId,
      podId: pod.id,
      packId: pack.id,
      packVersion: pack.version,
      packName: pack.name,
      timeout,
    });

    // Create execution state
    const state: ExecutionState = {
      executionId,
      podId: pod.id,
      packId: pack.id,
      status: 'pending',
      startedAt,
    };
    this.executions.set(executionId, state);
    this.podExecutions.set(pod.id, executionId);

    // Start async execution
    const promise = this.executeAsync(pack, context, options.args ?? [])
      .then((result) => {
        state.status = result.success ? 'completed' : 'failed';
        state.completedAt = new Date();
        state.result = result;
        this.config.logger.info('Pack execution completed', {
          executionId,
          podId: pod.id,
          success: result.success,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
        });
        return result;
      })
      .catch((error) => {
        const result: PackExecutionResult = {
          executionId,
          podId: pod.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          durationMs: Date.now() - startedAt.getTime(),
          exitCode: 1,
        };
        state.status = state.status === 'cancelled' ? 'cancelled' : 'failed';
        state.completedAt = new Date();
        state.result = result;
        this.config.logger.error(
          'Pack execution failed',
          error instanceof Error ? error : new Error(String(error)),
          {
            executionId,
            podId: pod.id,
            durationMs: result.durationMs,
          }
        );
        return result;
      });

    // Create cancel function
    const cancel = (): void => {
      if (state.status === 'running' && state.handle) {
        this.config.logger.info('Cancelling pack execution', {
          executionId,
          podId: pod.id,
        });
        state.handle.cancel();
        state.status = 'cancelled';
      }
    };

    return {
      executionId,
      podId: pod.id,
      promise,
      cancel,
      isCancelled: () => state.status === 'cancelled',
      startedAt,
    };
  }

  /**
   * Internal async execution logic
   */
  private async executeAsync(
    pack: Pack,
    context: PackExecutionContext,
    args: unknown[]
  ): Promise<PackExecutionResult> {
    const state = this.executions.get(context.executionId);
    if (!state) {
      throw new Error(`Execution state not found: ${context.executionId}`);
    }

    const startTime = Date.now();

    try {
      // Load the pack bundle
      const bundleCode = await this.loadBundle(pack);

      // Update state to running
      state.status = 'running';

      // Create the worker function that will execute the pack
      const workerFn = this.createWorkerFunction(bundleCode, context);

      // Execute in Web Worker
      const taskHandle = this.workerAdapter.execCancellable<unknown, [unknown[]]>(
        workerFn,
        [args],
        { timeout: context.timeout }
      );

      state.handle = taskHandle;

      const result = await taskHandle.promise;

      return {
        executionId: context.executionId,
        podId: context.podId,
        success: true,
        returnValue: result.value,
        durationMs: result.duration,
        exitCode: 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isCancelled = state.status === 'cancelled' || errorMessage.includes('cancelled');
      const isTimeout = errorMessage.includes('timed out');

      if (isTimeout) {
        throw PodError.timeout(context.timeout, context.podId);
      }

      if (isCancelled) {
        return {
          executionId: context.executionId,
          podId: context.podId,
          success: false,
          error: 'Execution was cancelled',
          durationMs: Date.now() - startTime,
          exitCode: -1,
        };
      }

      throw PodError.executionFailed(
        errorMessage,
        {
          durationMs: Date.now() - startTime,
          stderr: error instanceof Error ? error.stack : undefined,
        },
        context.podId
      );
    }
  }

  /**
   * Load a bundle for a pack
   *
   * Tries multiple sources:
   * 1. IndexedDB cache (StorageAdapter)
   * 2. Remote URL download (if bundlePath is a URL)
   * 3. Orchestrator storage (if bundlePath starts with 'storage:')
   */
  private async loadBundle(pack: Pack): Promise<string> {
    const cacheKey = `${pack.id}-${pack.version}.js`;
    const cachePath = `${this.config.bundlePath}/${cacheKey}`;

    // Check if we have a cached copy in IndexedDB
    try {
      if (await this.storageAdapter.exists(cachePath)) {
        this.config.logger.debug('Using cached bundle from IndexedDB', {
          packId: pack.id,
          cachePath,
        });
        return await this.storageAdapter.readFile(cachePath, 'utf-8');
      }
    } catch {
      // Cache miss, continue to download
    }

    // Determine source and download
    let bundleCode: string;

    if (pack.bundlePath.startsWith('http://') || pack.bundlePath.startsWith('https://')) {
      // Direct URL download
      bundleCode = await this.downloadFromUrl(pack.bundlePath, pack.id);
    } else if (pack.bundlePath.startsWith('storage:')) {
      // Orchestrator storage download
      bundleCode = await this.downloadFromStorage(pack);
    } else if (pack.bundlePath.startsWith('blob:') || pack.bundlePath.startsWith('data:')) {
      // Inline bundle (data URL or blob)
      bundleCode = await this.fetchInlineBundle(pack.bundlePath);
    } else {
      // Assume it's a relative path on the orchestrator
      bundleCode = await this.downloadFromOrchestrator(pack);
    }

    // Cache the bundle in IndexedDB for future use
    try {
      await this.storageAdapter.mkdir(this.config.bundlePath, true);
      await this.storageAdapter.writeFile(cachePath, bundleCode);
      this.config.logger.debug('Cached bundle to IndexedDB', {
        packId: pack.id,
        cachePath,
      });
    } catch (cacheError) {
      // Log but don't fail on cache errors
      this.config.logger.warn('Failed to cache bundle', cacheError as Error, {
        packId: pack.id,
      });
    }

    return bundleCode;
  }

  /**
   * Download a bundle from a URL
   */
  private async downloadFromUrl(url: string, packId: string): Promise<string> {
    this.config.logger.info('Downloading bundle from URL', {
      packId,
      url,
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw PodError.startFailed(
        `Failed to download bundle: ${response.status} ${response.statusText}`,
        packId
      );
    }

    return await response.text();
  }

  /**
   * Download a bundle from orchestrator storage
   */
  private async downloadFromStorage(pack: Pack): Promise<string> {
    if (!this.httpAdapter) {
      throw PodError.startFailed(
        'Cannot download from storage: HTTP adapter not configured',
        pack.id
      );
    }

    const storagePath = pack.bundlePath.replace('storage:', '');

    this.config.logger.info('Downloading bundle from storage', {
      packId: pack.id,
      storagePath,
    });

    const response = await this.httpAdapter.get<string>(`/api/storage/${storagePath}`, {
      responseType: 'text',
    });

    return response.data;
  }

  /**
   * Download a bundle from the orchestrator
   */
  private async downloadFromOrchestrator(pack: Pack): Promise<string> {
    if (!this.httpAdapter) {
      throw PodError.startFailed(
        'Cannot download bundle: HTTP adapter not configured',
        pack.id
      );
    }

    const bundlePath = pack.bundlePath.startsWith('/') ? pack.bundlePath : `/${pack.bundlePath}`;

    this.config.logger.info('Downloading bundle from orchestrator', {
      packId: pack.id,
      bundlePath,
    });

    const response = await this.httpAdapter.get<string>(`/api/packs/${pack.id}/bundle`, {
      responseType: 'text',
    });

    return response.data;
  }

  /**
   * Fetch an inline bundle from a data URL or blob URL
   */
  private async fetchInlineBundle(url: string): Promise<string> {
    if (url.startsWith('data:')) {
      // Parse data URL
      const match = url.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
      if (!match) {
        throw new Error('Invalid data URL format');
      }
      const [, , data] = match;
      if (url.includes(';base64,')) {
        return atob(data);
      }
      return decodeURIComponent(data);
    }

    // Blob URL - fetch it
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch blob: ${response.status}`);
    }
    return await response.text();
  }

  /**
   * Create a worker function that executes the pack code
   *
   * The function is self-contained and serializable for worker execution.
   * Note: Browser environment has more restrictions than Node.js
   */
  private createWorkerFunction(
    bundleCode: string,
    context: PackExecutionContext
  ): (args: unknown[]) => Promise<unknown> {
    // Create a serializable function that will run in the worker
    // The function constructs and executes the pack in isolation
    return async (args: unknown[]) => {
      // Create a mock environment for pack execution
      const env = context.env;

      // Make environment variables available via a global object
      // (since browser workers don't have process.env)
      const globalScope = typeof self !== 'undefined' ? self : globalThis;
      (globalScope as unknown as Record<string, unknown>).__STARK_ENV__ = env;
      (globalScope as unknown as Record<string, unknown>).__STARK_CONTEXT__ = context;

      try {
        // Create a sandboxed module context for browser
        // Note: More limited than Node.js - no require, no fs, etc.
        const moduleExports: Record<string, unknown> = {};
        const module = { exports: moduleExports };

        // Execute the bundle code
        // Using Function constructor for sandboxing (similar to eval but safer)
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const moduleFactory = new Function(
          'exports',
          'module',
          'context',
          'args',
          '__STARK_ENV__',
          `${bundleCode}\n//# sourceURL=pack-${context.packId}-${context.packVersion}.js`
        );

        // Execute the bundle
        moduleFactory(
          moduleExports,
          module,
          context,
          args,
          env
        );

        // Get the entrypoint function
        const entrypoint = (context.metadata.entrypoint as string | undefined) ?? 'default';
        const packExports = module.exports;
        const entrypointFn = packExports[entrypoint] ?? packExports.default;

        if (typeof entrypointFn !== 'function') {
          throw new Error(
            `Pack entrypoint '${entrypoint}' is not a function. ` +
            `Available exports: ${Object.keys(packExports).join(', ')}`
          );
        }

        // Execute the entrypoint
        const result: unknown = await Promise.resolve(
          (entrypointFn as (ctx: PackExecutionContext, ...args: unknown[]) => unknown)(context, ...args)
        );
        return result;
      } finally {
        // Clean up globals
        delete (globalScope as unknown as Record<string, unknown>).__STARK_ENV__;
        delete (globalScope as unknown as Record<string, unknown>).__STARK_CONTEXT__;
      }
    };
  }

  /**
   * Stop execution for a pod
   *
   * @param podId - Pod ID to stop
   * @param graceful - If true, allow in-flight operations to complete
   * @returns True if execution was stopped
   */
  stop(podId: string, graceful = true): boolean {
    const executionId = this.podExecutions.get(podId);
    if (executionId === undefined) {
      return false;
    }

    const state = this.executions.get(executionId);
    if (!state || state.status !== 'running') {
      return false;
    }

    this.config.logger.info('Stopping pack execution', {
      executionId,
      podId,
      graceful,
    });

    if (state.handle) {
      state.handle.cancel();
    }
    state.status = 'cancelled';

    return true;
  }

  /**
   * Get execution status for a pod
   *
   * @param podId - Pod ID
   * @returns Execution state or undefined
   */
  getExecutionStatus(podId: string): ExecutionState | undefined {
    const executionId = this.podExecutions.get(podId);
    if (executionId === undefined) {
      return undefined;
    }
    return this.executions.get(executionId);
  }

  /**
   * Get execution result for a pod
   *
   * @param podId - Pod ID
   * @returns Execution result or undefined
   */
  getExecutionResult(podId: string): PackExecutionResult | undefined {
    const state = this.getExecutionStatus(podId);
    return state?.result;
  }

  /**
   * Get all active executions
   *
   * @returns Array of execution states for running executions
   */
  getActiveExecutions(): ExecutionState[] {
    return Array.from(this.executions.values()).filter(
      (state) => state.status === 'running' || state.status === 'pending'
    );
  }

  /**
   * Get worker pool statistics
   */
  getPoolStats(): PoolStats {
    this.ensureInitialized();
    return this.workerAdapter.getStats();
  }

  /**
   * Cancel all running executions
   */
  cancelAll(): void {
    this.config.logger.warn('Cancelling all executions');
    this.workerAdapter.cancelAll();

    for (const state of this.executions.values()) {
      if (state.status === 'running' || state.status === 'pending') {
        state.status = 'cancelled';
        state.completedAt = new Date();
      }
    }
  }

  /**
   * Clean up completed executions older than the specified age
   *
   * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
   * @returns Number of executions cleaned up
   */
  cleanup(maxAgeMs = 3600000): number {
    const cutoff = new Date(Date.now() - maxAgeMs);
    let cleaned = 0;

    for (const [executionId, state] of this.executions) {
      if (
        state.status !== 'running' &&
        state.status !== 'pending' &&
        state.completedAt &&
        state.completedAt < cutoff
      ) {
        this.executions.delete(executionId);
        if (this.podExecutions.get(state.podId) === executionId) {
          this.podExecutions.delete(state.podId);
        }
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.config.logger.debug(`Cleaned up ${cleaned} completed executions`);
    }

    return cleaned;
  }

  /**
   * Clear the bundle cache from IndexedDB
   *
   * @returns Number of bundles cleared
   */
  async clearCache(): Promise<number> {
    this.ensureInitialized();

    try {
      const files = await this.storageAdapter.readdir(this.config.bundlePath);
      let cleared = 0;

      for (const file of files) {
        if (file.name.endsWith('.js')) {
          const filePath = `${this.config.bundlePath}/${file.name}`;
          await this.storageAdapter.unlink(filePath);
          cleared++;
        }
      }

      this.config.logger.info(`Cleared ${cleared} bundles from cache`);
      return cleared;
    } catch {
      // Directory may not exist
      return 0;
    }
  }

  /**
   * Terminate the executor and clean up all resources
   *
   * @param force - If true, immediately terminate all workers
   */
  async terminate(force = false): Promise<void> {
    this.config.logger.info('Terminating browser pack executor', { force });

    // Cancel all running executions
    this.cancelAll();

    // Terminate worker pool
    await this.workerAdapter.terminate(force);

    // Clear state
    this.executions.clear();
    this.podExecutions.clear();
    this.initialized = false;

    this.config.logger.info('Browser pack executor terminated');
  }
}

/**
 * Create a pack executor with default configuration
 */
export function createPackExecutor(config?: PackExecutorConfig): PackExecutor {
  return new PackExecutor(config);
}

/**
 * Default pack executor instance
 */
export const defaultPackExecutor = new PackExecutor();
