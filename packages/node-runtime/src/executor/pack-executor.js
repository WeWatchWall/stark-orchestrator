/**
 * Pack Executor
 * @module @stark-o/node-runtime/executor/pack-executor
 *
 * Executes pack bundles in worker_threads for isolated, concurrent execution.
 * Provides lifecycle management, resource tracking, and error handling.
 */
import { randomUUID } from 'crypto';
import { join, isAbsolute } from 'path';
import { WorkerAdapter, } from '../adapters/worker-adapter.js';
import { FsAdapter } from '../adapters/fs-adapter.js';
import { HttpAdapter } from '../adapters/http-adapter.js';
import { createServiceLogger, PodError, } from '@stark-o/shared';
/**
 * Pack Executor
 *
 * Manages the execution of pack bundles in isolated worker threads.
 * Features:
 * - Concurrent execution with worker pool
 * - Execution lifecycle management (start, stop, cancel)
 * - Resource tracking and limits
 * - Timeout handling
 * - Error isolation per execution
 */
export class PackExecutor {
    config;
    workerAdapter;
    fsAdapter;
    httpAdapter = null;
    initialized = false;
    executions = new Map();
    podExecutions = new Map(); // podId -> executionId
    constructor(config = {}) {
        this.config = {
            bundleDir: config.bundleDir ?? process.cwd(),
            orchestratorUrl: config.orchestratorUrl,
            authToken: config.authToken,
            workerConfig: config.workerConfig,
            fsConfig: config.fsConfig,
            httpConfig: config.httpConfig,
            defaultTimeout: config.defaultTimeout ?? 300000,
            maxConcurrent: config.maxConcurrent ?? 10,
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
            ...this.config.workerConfig,
            onError: (error) => {
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
     * Initialize the pack executor.
     * Must be called before executing any packs.
     */
    async initialize() {
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
    isInitialized() {
        return this.initialized;
    }
    /**
     * Ensure the executor is initialized before operations
     */
    ensureInitialized() {
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
    execute(pack, pod, options = {}) {
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
            throw PodError.startFailed(`Pack runtime tag '${pack.runtimeTag}' is not compatible with Node.js runtime`, pod.id);
        }
        const executionId = randomUUID();
        const timeout = options.timeout ?? pack.metadata?.timeout ?? this.config.defaultTimeout;
        const startedAt = new Date();
        // Create execution context
        const context = {
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
        const state = {
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
            const result = {
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
            this.config.logger.error('Pack execution failed', error instanceof Error ? error : new Error(String(error)), {
                executionId,
                podId: pod.id,
                durationMs: result.durationMs,
            });
            return result;
        });
        // Create cancel function
        const cancel = () => {
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
    async executeAsync(pack, context, args) {
        const state = this.executions.get(context.executionId);
        if (!state) {
            throw new Error(`Execution state not found: ${context.executionId}`);
        }
        const startTime = Date.now();
        try {
            // Load the pack bundle
            const bundlePath = await this.resolveBundlePath(pack);
            const bundleCode = await this.loadBundle(bundlePath);
            // Update state to running
            state.status = 'running';
            // Create the worker function that will execute the pack
            const workerFn = this.createWorkerFunction(bundleCode, context);
            // Execute in worker thread
            const taskHandle = this.workerAdapter.execCancellable(workerFn, [args], { timeout: context.timeout });
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
        }
        catch (error) {
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
            throw PodError.executionFailed(errorMessage, {
                durationMs: Date.now() - startTime,
                stderr: error instanceof Error ? error.stack : undefined,
            }, context.podId);
        }
    }
    /**
     * Resolve the bundle path for a pack
     */
    async resolveBundlePath(pack) {
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
    async downloadBundle(pack) {
        if (!this.httpAdapter) {
            throw PodError.startFailed('Cannot download bundle: HTTP adapter not configured', pack.id);
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
        const response = await this.httpAdapter.get(pack.bundlePath, {
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
    async downloadFromStorage(pack) {
        if (!this.httpAdapter) {
            throw PodError.startFailed('Cannot download from storage: HTTP adapter not configured', pack.id);
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
        const response = await this.httpAdapter.get(`/api/storage/${storagePath}`, {
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
    async loadBundle(bundlePath) {
        try {
            const code = await this.fsAdapter.readFile(bundlePath, 'utf-8');
            return code;
        }
        catch (error) {
            throw PodError.startFailed(`Failed to load bundle: ${error instanceof Error ? error.message : String(error)}`, bundlePath);
        }
    }
    /**
     * Create a worker function that executes the pack code
     *
     * The function is self-contained and serializable for worker execution.
     */
    createWorkerFunction(bundleCode, context) {
        // Create a serializable function that will run in the worker
        // The function constructs and executes the pack in isolation
        return async (args) => {
            // Set up environment variables
            const env = context.env;
            for (const [key, value] of Object.entries(env)) {
                process.env[key] = value;
            }
            try {
                // Create a sandboxed module context
                // eslint-disable-next-line @typescript-eslint/no-implied-eval
                const moduleFactory = new Function('exports', 'require', 'module', '__filename', '__dirname', 'context', 'args', `${bundleCode}\n//# sourceURL=pack-${context.packId}-${context.packVersion}.js`);
                // Create module-like objects for the pack
                const moduleExports = {};
                const module = { exports: moduleExports };
                // Limited require function (packs should be bundled)
                const requireFn = (id) => {
                    // Only allow safe built-in modules
                    const allowedModules = ['url', 'path', 'querystring', 'util', 'crypto', 'buffer'];
                    if (allowedModules.includes(id)) {
                        // Dynamic require for allowed modules
                        // eslint-disable-next-line @typescript-eslint/no-require-imports
                        return require(id);
                    }
                    throw new Error(`Module '${id}' is not available in pack execution context`);
                };
                // Execute the bundle
                moduleFactory(moduleExports, requireFn, module, `pack-${context.packId}.js`, '/pack', context, args);
                // Get the entrypoint function
                const entrypoint = context.metadata.entrypoint ?? 'default';
                const packExports = module.exports;
                const entrypointFn = packExports[entrypoint] ?? packExports.default;
                if (typeof entrypointFn !== 'function') {
                    throw new Error(`Pack entrypoint '${entrypoint}' is not a function. ` +
                        `Available exports: ${Object.keys(packExports).join(', ')}`);
                }
                // Execute the entrypoint
                const result = await Promise.resolve(entrypointFn(context, ...args));
                return result;
            }
            finally {
                // Clean up environment variables
                for (const key of Object.keys(env)) {
                    delete process.env[key];
                }
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
    stop(podId, graceful = true) {
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
    getExecutionStatus(podId) {
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
    getExecutionResult(podId) {
        const state = this.getExecutionStatus(podId);
        return state?.result;
    }
    /**
     * Get all active executions
     *
     * @returns Array of execution states for running executions
     */
    getActiveExecutions() {
        return Array.from(this.executions.values()).filter((state) => state.status === 'running' || state.status === 'pending');
    }
    /**
     * Get worker pool statistics
     */
    getPoolStats() {
        this.ensureInitialized();
        return this.workerAdapter.getStats();
    }
    /**
     * Cancel all running executions
     */
    cancelAll() {
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
    cleanup(maxAgeMs = 3600000) {
        const cutoff = new Date(Date.now() - maxAgeMs);
        let cleaned = 0;
        for (const [executionId, state] of this.executions) {
            if (state.status !== 'running' &&
                state.status !== 'pending' &&
                state.completedAt &&
                state.completedAt < cutoff) {
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
    async terminate(force = false) {
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
export function createPackExecutor(config) {
    return new PackExecutor(config);
}
/**
 * Default pack executor instance
 */
export const defaultPackExecutor = new PackExecutor();
//# sourceMappingURL=pack-executor.js.map