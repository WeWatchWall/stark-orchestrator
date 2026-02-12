/**
 * Pack Executor
 * @module @stark-o/node-runtime/executor/pack-executor
 *
 * Executes pack bundles in sub-processes for isolated, concurrent execution.
 * Provides lifecycle management, resource tracking, and error handling.
 */

import { randomUUID } from 'crypto';
import { join, isAbsolute } from 'path';
import {
  WorkerAdapter,
  type WorkerAdapterConfig,
  type TaskHandle,
  type PoolStats,
} from '../adapters/worker-adapter.js';
import { FsAdapter, type FsAdapterConfig } from '../adapters/fs-adapter.js';
import { HttpAdapter, type HttpAdapterConfig } from '../adapters/http-adapter.js';
import {
  createServiceLogger,
  PodError,
  requiresMainThread,
  createPodLogSink,
  formatLogArgs,
  createEphemeralDataPlane,
  type Logger,
  type Pack,
  type Pod,
  type PackExecutionContext,
  type PackExecutionResult,
  type ExecutionHandle,
  type PodLifecycleFacts,
  type PodLifecyclePhase,
  type ShutdownHandler,
  type PodLogSink,
} from '@stark-o/shared';

// Re-export for convenience
export type { PackExecutionContext, PackExecutionResult, ExecutionHandle };

/**
 * Pack executor configuration
 */
export interface PackExecutorConfig {
  /** Base directory for pack bundles (default: process.cwd()) */
  bundleDir?: string;
  /** Orchestrator URL for downloading bundles (optional) */
  orchestratorUrl?: string;
  /** Auth token for bundle downloads */
  authToken?: string;
  /** Orchestrator WebSocket URL for pod networking (e.g., wss://localhost/ws) */
  orchestratorWsUrl?: string;
  /** Skip TLS verification for orchestrator WebSocket (dev only) */
  insecure?: boolean;
  /** Worker adapter configuration */
  workerConfig?: WorkerAdapterConfig;
  /** File system adapter configuration */
  fsConfig?: FsAdapterConfig;
  /** HTTP adapter configuration */
  httpConfig?: HttpAdapterConfig;
  /** Default execution timeout in milliseconds (default: 0 = no timeout) */
  defaultTimeout?: number;
  /** Maximum concurrent executions (default: 10) */
  maxConcurrent?: number;
  /** Maximum memory per worker process in MB (sets --max-old-space-size for sub-processes) */
  maxMemoryMB?: number;
  /** 
   * Graceful shutdown timeout in milliseconds (default: 5000 = 5 seconds)
   * Time to wait for pack code to handle shutdown before force terminating
   */
  gracefulShutdownTimeout?: number;
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
  /** Shutdown handlers registered by pack code */
  shutdownHandlers: ShutdownHandler[];
  /** Function to update lifecycle phase */
  setLifecyclePhase: (phase: PodLifecyclePhase) => void;
  /** Function to request shutdown */
  requestShutdown: (reason?: string) => void;
  /** Log sink for stdout/stderr */
  logSink: PodLogSink;
}

/**
 * Pack Executor
 *
 * Manages the execution of pack bundles in isolated sub-processes.
 * Features:
 * - Concurrent execution with worker pool
 * - Execution lifecycle management (start, stop, cancel)
 * - Resource tracking and limits
 * - Timeout handling
 * - Error isolation per execution
 */
export class PackExecutor {
  private readonly config: Required<
    Omit<PackExecutorConfig, 'workerConfig' | 'fsConfig' | 'httpConfig' | 'orchestratorUrl' | 'authToken' | 'orchestratorWsUrl' | 'insecure' | 'maxMemoryMB' | 'logger'>
  > & {
    workerConfig?: WorkerAdapterConfig;
    fsConfig?: FsAdapterConfig;
    httpConfig?: HttpAdapterConfig;
    orchestratorUrl?: string;
    authToken?: string;
    orchestratorWsUrl?: string;
    insecure?: boolean;
    maxMemoryMB?: number;
    logger: Logger;
  };
  private workerAdapter: WorkerAdapter;
  private fsAdapter: FsAdapter;
  private httpAdapter: HttpAdapter | null = null;
  private initialized = false;
  private readonly executions: Map<string, ExecutionState> = new Map();
  private readonly podExecutions: Map<string, string> = new Map(); // podId -> executionId

  constructor(config: PackExecutorConfig = {}) {
    this.config = {
      bundleDir: config.bundleDir ?? process.cwd(),
      orchestratorUrl: config.orchestratorUrl,
      authToken: config.authToken,
      orchestratorWsUrl: config.orchestratorWsUrl,
      insecure: config.insecure,
      workerConfig: config.workerConfig,
      fsConfig: config.fsConfig,
      httpConfig: config.httpConfig,
      defaultTimeout: config.defaultTimeout ?? 0,
      maxConcurrent: config.maxConcurrent ?? 10,
      gracefulShutdownTimeout: config.gracefulShutdownTimeout ?? 5000,
      logger: config.logger ?? createServiceLogger({
        component: 'pack-executor',
        service: 'stark-node-runtime',
      }),
    };

    // Initialize worker adapter with configured or default settings
    this.workerAdapter = new WorkerAdapter({
      maxWorkers: this.config.maxConcurrent,
      maxQueueSize: this.config.maxConcurrent * 2,
      taskTimeout: this.config.defaultTimeout,
      maxMemoryMB: config.maxMemoryMB,
      ...this.config.workerConfig,
      onError: (error): void => {
        this.config.logger.error('Worker pool error', error);
        this.config.workerConfig?.onError?.(error);
      },
    });

    // Initialize file system adapter
    this.fsAdapter = new FsAdapter({
      rootPath: this.config.bundleDir,
      ...this.config.fsConfig,
    });

    // Initialize HTTP adapter if orchestrator URL is provided
    if (this.config.orchestratorUrl !== undefined && this.config.orchestratorUrl !== '') {
      this.httpAdapter = new HttpAdapter({
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
   * Update the auth token on the existing HTTP adapter without
   * recreating the executor or disrupting running pods.
   */
  updateAuthToken(token: string): void {
    this.config.authToken = token;
    if (this.httpAdapter) {
      this.httpAdapter.setAuthToken(token);
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

    this.config.logger.info('Initializing pack executor', {
      bundleDir: this.config.bundleDir,
      maxConcurrent: this.config.maxConcurrent,
      defaultTimeout: this.config.defaultTimeout,
    });

    await Promise.all([
      this.workerAdapter.initialize(),
      this.fsAdapter.initialize(),
    ]);

    this.initialized = true;
    this.config.logger.info('Pack executor initialized');
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
      /** Service ID for network policy checks (required for inter-service comm) */
      serviceId?: string;
      /** Pod authentication token for data plane connections */
      podToken?: string;
      /** Refresh token for automatic token renewal */
      podRefreshToken?: string;
      /** Token expiration timestamp (ISO string) */
      podTokenExpiresAt?: string;
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
    if (pack.runtimeTag !== 'node' && pack.runtimeTag !== 'universal') {
      throw PodError.startFailed(
        `Pack runtime tag '${pack.runtimeTag}' is not compatible with Node.js runtime`,
        pod.id
      );
    }

    const executionId = randomUUID();
    const timeout = options.timeout ?? pack.metadata?.timeout ?? this.config.defaultTimeout;
    const startedAt = new Date();

    // Create shutdown handlers registry for this execution
    const shutdownHandlers: ShutdownHandler[] = [];
    
    // Create mutable lifecycle state for this execution
    let lifecyclePhase: PodLifecyclePhase = 'initializing';
    let isShuttingDown = false;
    let shutdownReason: string | undefined;
    let shutdownRequestedAt: Date | undefined;
    
    // Capture config for use in lifecycle object getters
    const executorConfig = this.config;
    
    // Create lifecycle facts object with getters for live values
    const lifecycle: PodLifecycleFacts = {
      get phase() { return lifecyclePhase; },
      get isShuttingDown() { return isShuttingDown; },
      get shutdownReason() { return shutdownReason; },
      get shutdownRequestedAt() { return shutdownRequestedAt; },
      get gracefulShutdownRemainingMs() {
        if (!isShuttingDown || !shutdownRequestedAt) return undefined;
        const gracefulTimeout = executorConfig.gracefulShutdownTimeout ?? 5000;
        const elapsed = Date.now() - shutdownRequestedAt.getTime();
        return Math.max(0, gracefulTimeout - elapsed);
      },
    };

    // Create execution context with lifecycle facts
    // serviceId is required for inter-service networking — can come from options or pod metadata
    const serviceId = options.serviceId ?? (pod.metadata?.serviceId as string | undefined);
    if (!serviceId) {
      this.config.logger.warn('No serviceId provided — inter-service networking will be disabled', {
        podId: pod.id,
        packId: pack.id,
      });
    }

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
      lifecycle,
      onShutdown: (handler: ShutdownHandler) => {
        shutdownHandlers.push(handler);
      },
      // Networking: service ID for policy checks
      serviceId,
      // Authentication: pod token for data plane auth (prevents spoofing)
      authToken: options.podToken,
      refreshToken: options.podRefreshToken,
      tokenExpiresAt: options.podTokenExpiresAt,
      // Ephemeral data plane: opt-in via pack metadata
      ...(pack.metadata?.enableEphemeral ? {
        ephemeral: createEphemeralDataPlane({
          podId: pod.id,
          serviceId,
        }),
      } : {}),
    };

    this.config.logger.info('Starting pack execution', {
      executionId,
      podId: pod.id,
      packId: pack.id,
      packVersion: pack.version,
      packName: pack.name,
      timeout,
    });

    // Create log sink for stdout/stderr capture
    const logSink = createPodLogSink({
      podId: pod.id,
      packId: pack.id,
      packVersion: pack.version,
      executionId,
    });

    // Create execution state with lifecycle control functions
    const state: ExecutionState = {
      executionId,
      podId: pod.id,
      packId: pack.id,
      status: 'pending',
      startedAt,
      shutdownHandlers,
      logSink,
      setLifecyclePhase: (phase: PodLifecyclePhase) => {
        lifecyclePhase = phase;
      },
      requestShutdown: (reason?: string) => {
        if (!isShuttingDown) {
          isShuttingDown = true;
          shutdownReason = reason;
          shutdownRequestedAt = new Date();
          lifecyclePhase = 'stopping';
        }
      },
    };
    this.executions.set(executionId, state);
    this.podExecutions.set(pod.id, executionId);
    
    // Set lifecycle to running once setup is complete
    lifecyclePhase = 'running';

    // Start async execution
    const promise = this.executeAsync(pack, context, options.args ?? [])
      .then((result) => {
        state.status = result.success ? 'completed' : 'failed';
        state.completedAt = new Date();
        state.result = result;
        state.logSink.close();
        // Dispose ephemeral data plane if it was created
        context.ephemeral?.dispose();
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
        state.logSink.close();
        // Dispose ephemeral data plane if it was created
        context.ephemeral?.dispose();
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

    // Create cancel function (cooperative cancellation)
    const cancel = (): void => {
      if (state.status === 'running' && state.handle) {
        this.config.logger.info('Cancelling pack execution', {
          executionId,
          podId: pod.id,
        });
        // Signal shutdown to pack code via lifecycle facts
        state.requestShutdown('Execution cancelled');
        state.handle.cancel();
        state.status = 'cancelled';
      }
    };

    // Create graceful stop function - invokes shutdown handlers then force terminates
    const gracefulStop = async (reason?: string): Promise<void> => {
      if (state.status !== 'running') return;
      
      this.config.logger.info('Initiating graceful shutdown', {
        executionId,
        podId: pod.id,
        reason,
      });
      
      // Signal shutdown to pack code
      state.requestShutdown(reason);
      state.setLifecyclePhase('stopping');
      
      // Invoke shutdown handlers with timeout
      const gracefulTimeout = this.config.gracefulShutdownTimeout ?? 5000;
      try {
        const handlerPromises = state.shutdownHandlers.map(async (handler) => {
          try {
            await handler(reason);
          } catch (error) {
            this.config.logger.warn('Shutdown handler error', { 
              executionId, 
              error: error instanceof Error ? error.message : String(error) 
            });
          }
        });
        
        // Wait for handlers with timeout
        await Promise.race([
          Promise.all(handlerPromises),
          new Promise<void>(resolve => setTimeout(resolve, gracefulTimeout)),
        ]);
      } catch (error) {
        this.config.logger.warn('Error during graceful shutdown', {
          executionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      
      // Force terminate after graceful period
      if (state.handle) {
        await state.handle.forceTerminate();
      }
      state.setLifecyclePhase('terminated');
      state.status = 'cancelled';
      state.logSink.close();
    };

    // Create force terminate function (immediate termination)
    const forceTerminate = async (): Promise<void> => {
      if (state.handle) {
        this.config.logger.info('Force terminating pack execution', {
          executionId,
          podId: pod.id,
        });
        state.requestShutdown('Force terminated');
        state.setLifecyclePhase('terminated');
        await state.handle.forceTerminate();
        state.status = 'cancelled';
        state.logSink.close();
      }
    };

    return {
      executionId,
      podId: pod.id,
      promise,
      cancel,
      forceTerminate,
      gracefulStop,
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
      // If bundleContent is provided directly (from orchestrator), use it
      // Otherwise, resolve the path and load from file system
      let bundleCode: string;
      if (pack.bundleContent) {
        this.config.logger.debug('Using bundleContent directly from pack', {
          packId: pack.id,
          bundleContentLength: pack.bundleContent.length,
        });
        bundleCode = pack.bundleContent;
      } else {
        const bundlePath = await this.resolveBundlePath(pack);
        bundleCode = await this.loadBundle(bundlePath);
      }

      // Update state to running
      state.status = 'running';

      // Check if pack has root capability - run on main thread instead of worker pool
      // Root packs need main thread access for UI/DOM or privileged operations
      const hasRootCapability = requiresMainThread(pack.grantedCapabilities ?? []);

      if (hasRootCapability) {
        this.config.logger.info('Executing pack on main thread (root capability)', {
          packId: pack.id,
          packVersion: pack.version,
          executionId: context.executionId,
        });

        // Execute on main thread WITHOUT blocking - yield to event loop first
        // This ensures the execute() call returns immediately with the ExecutionHandle
        // and the actual pack execution happens in a subsequent tick
        const mainThreadResult = await new Promise<PackExecutionResult>((resolve, reject) => {
          // Use setImmediate to yield control back to the event loop
          // This allows the caller to receive the ExecutionHandle before execution starts
          setImmediate(() => {
            this.executeOnMainThread(bundleCode, context, args, state.logSink)
              .then((result) => {
                resolve({
                  executionId: context.executionId,
                  podId: context.podId,
                  success: true,
                  returnValue: result,
                  durationMs: Date.now() - startTime,
                  exitCode: 0,
                });
              })
              .catch(reject);
          });
        });
        
        return mainThreadResult;
      }

      // Execute in a forked subprocess via the worker adapter.
      // The worker script imports PodLogSink and other dependencies directly —
      // no serialized functions are injected. Only bundleCode, context (metadata/state),
      // and args are passed via IPC.
      // Strip non-serializable properties (lifecycle, onShutdown, ephemeral) — they use
      // getters/closures and cannot survive structured clone over IPC.
      // The ephemeral data plane (EphemeralDataPlane) contains a PodGroupStore with
      // NodeCache event listeners and Map handlers — none of which can be cloned.
      // The worker will recreate it from context.metadata.enableEphemeral.
      // Add networking config for direct pod-to-orchestrator WebRTC signaling.
      const { lifecycle: _lc, onShutdown: _os, ephemeral: _eph, ...serializableContext } = context;
      const workerContext = {
        ...serializableContext,
        // Networking: pod connects directly to orchestrator for signaling
        orchestratorUrl: this.config.orchestratorWsUrl,
        insecure: this.config.insecure,
        // Note: authToken, refreshToken, tokenExpiresAt are already in serializableContext from context
      };
      const taskHandle = this.workerAdapter.execTaskCancellable<unknown>(
        bundleCode,
        workerContext,
        args,
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
   * Resolve the bundle path for a pack
   */
  private async resolveBundlePath(pack: Pack): Promise<string> {
    // If bundle path is absolute, use it directly
    if (isAbsolute(pack.bundlePath)) {
      return pack.bundlePath;
    }

    // If bundle path is a URL, it needs to be downloaded
    if (pack.bundlePath.startsWith('http://') || pack.bundlePath.startsWith('https://')) {
      return this.downloadBundle(pack);
    }

    // If bundle path starts with 'storage:', it's in orchestrator storage
    if (pack.bundlePath.startsWith('storage:')) {
      return this.downloadFromStorage(pack);
    }

    // Otherwise, it's relative to the bundle directory
    return join(this.config.bundleDir, pack.bundlePath);
  }

  /**
   * Download a bundle from a URL
   */
  private async downloadBundle(pack: Pack): Promise<string> {
    if (!this.httpAdapter) {
      throw PodError.startFailed(
        'Cannot download bundle: HTTP adapter not configured',
        pack.id
      );
    }

    const localPath = join(this.config.bundleDir, 'downloads', `${pack.id}-${pack.version}.js`);

    // Check if already downloaded
    if (await this.fsAdapter.exists(localPath)) {
      this.config.logger.debug('Using cached bundle', {
        packId: pack.id,
        localPath,
      });
      return localPath;
    }

    this.config.logger.info('Downloading bundle', {
      packId: pack.id,
      url: pack.bundlePath,
    });

    // Download the bundle
    const response = await this.httpAdapter.get<string>(pack.bundlePath, {
      responseType: 'text',
    });

    // Ensure directory exists and write bundle
    await this.fsAdapter.mkdir(join(this.config.bundleDir, 'downloads'), true);
    await this.fsAdapter.writeFile(localPath, response.data);

    return localPath;
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
    const localPath = join(this.config.bundleDir, 'downloads', `${pack.id}-${pack.version}.js`);

    // Check if already downloaded
    if (await this.fsAdapter.exists(localPath)) {
      this.config.logger.debug('Using cached bundle from storage', {
        packId: pack.id,
        localPath,
      });
      return localPath;
    }

    this.config.logger.info('Downloading bundle from storage', {
      packId: pack.id,
      storagePath,
    });

    // Download from storage endpoint
    const response = await this.httpAdapter.get<string>(`/api/storage/${storagePath}`, {
      responseType: 'text',
    });

    // Ensure directory exists and write bundle
    await this.fsAdapter.mkdir(join(this.config.bundleDir, 'downloads'), true);
    await this.fsAdapter.writeFile(localPath, response.data);

    return localPath;
  }

  /**
   * Load a bundle from the file system
   */
  private async loadBundle(bundlePath: string): Promise<string> {
    try {
      const code = await this.fsAdapter.readFile(bundlePath, 'utf-8');
      return code;
    } catch (error) {
      throw PodError.startFailed(
        `Failed to load bundle: ${error instanceof Error ? error.message : String(error)}`,
        bundlePath
      );
    }
  }

  /**
   * Execute a pack directly on the main thread (for root capability packs).
   * 
   * Root packs run on the main thread without worker isolation, which is required for:
   * - UI packs that need DOM access (in browser)
   * - Privileged operations that need direct node access
   * 
   * Per the Root Package Execution Contract, root packs must:
   * - Use budgeted execution with explicit max time per slice
   * - Yield control cooperatively back to the runtime
   * - Use only async/non-blocking I/O
   * - Never perform unbounded synchronous work
   * 
   * @param bundleCode - The JavaScript bundle code to execute
   * @param context - Execution context with environment and metadata
   * @param args - Arguments to pass to the entrypoint
   * @returns The return value from the pack entrypoint
   */
  private async executeOnMainThread(
    bundleCode: string,
    context: PackExecutionContext,
    args: unknown[],
    _logSink: PodLogSink
  ): Promise<unknown> {
    // Set up environment variables
    const env = context.env;
    const originalEnv: Record<string, string | undefined> = {};
    
    for (const [key, value] of Object.entries(env)) {
      originalEnv[key] = process.env[key];
      process.env[key] = value;
    }

    // Patch console to route through pod log format.
    // We patch directly using saved original references to avoid circular
    // recursion (PodLogSink.write() calls console.log internally).
    const podId = context.podId;
    const originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    console.log = (...logArgs: unknown[]) =>
      originalConsole.log(`[${new Date().toISOString()}][${podId}:out]`, formatLogArgs(logArgs));
    console.info = (...logArgs: unknown[]) =>
      originalConsole.log(`[${new Date().toISOString()}][${podId}:out]`, formatLogArgs(logArgs));
    console.debug = (...logArgs: unknown[]) =>
      originalConsole.log(`[${new Date().toISOString()}][${podId}:out]`, formatLogArgs(logArgs));
    console.warn = (...logArgs: unknown[]) =>
      originalConsole.error(`[${new Date().toISOString()}][${podId}:err]`, formatLogArgs(logArgs));
    console.error = (...logArgs: unknown[]) =>
      originalConsole.error(`[${new Date().toISOString()}][${podId}:err]`, formatLogArgs(logArgs));

    try {
      // Evaluate the pack bundle code
      // The bundle is a fully-bundled CJS module — we provide exports/module
      // so the bundle can attach its entrypoint(s). No sandboxing.
      const moduleExports: Record<string, unknown> = {};
      const module = { exports: moduleExports };

      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const moduleFactory = new Function(
        'exports',
        'module',
        'context',
        'args',
        `${bundleCode}\n//# sourceURL=pack-${context.packId}-${context.packVersion}.js`
      );

      // Execute the bundle
      moduleFactory(moduleExports, module, context, args);

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
      // Restore original console methods
      console.log = originalConsole.log;
      console.info = originalConsole.info;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.debug = originalConsole.debug;
      
      // Restore original environment variables
      for (const [key, originalValue] of Object.entries(originalEnv)) {
        if (originalValue === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = originalValue;
        }
      }
    }
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
   * Terminate the executor and clean up all resources
   *
   * @param force - If true, immediately terminate all workers
   */
  async terminate(force = false): Promise<void> {
    this.config.logger.info('Terminating pack executor', { force });

    // Cancel all running executions
    this.cancelAll();

    // Terminate worker pool
    await this.workerAdapter.terminate(force);

    // Clear state
    this.executions.clear();
    this.podExecutions.clear();
    this.initialized = false;

    this.config.logger.info('Pack executor terminated');
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
