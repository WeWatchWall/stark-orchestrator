// Stark Orchestrator - Node.js Runtime
// Worker Adapter using Workerpool for worker_threads management
import workerpool from 'workerpool';
import { cpus } from 'node:os';
import { TaskCancelledError, TaskTimeoutError, WorkerNotInitializedError, WorkerScriptRequiredError, } from '@stark-o/shared';
export { TaskCancelledError, TaskTimeoutError, WorkerNotInitializedError, WorkerScriptRequiredError, } from '@stark-o/shared';
/**
 * Worker adapter wrapping Workerpool for worker_threads management.
 * Provides a unified interface for executing tasks in worker threads.
 *
 * This implementation uses Workerpool which manages a pool of worker_threads
 * for parallel task execution in Node.js environments.
 */
export class WorkerAdapter {
    config;
    pool = null;
    initialized = false;
    pendingTasks = new Map();
    taskIdCounter = 0;
    constructor(config = {}) {
        this.config = {
            minWorkers: config.minWorkers ?? 0,
            maxWorkers: config.maxWorkers ?? cpus().length,
            maxQueueSize: config.maxQueueSize ?? Infinity,
            workerType: config.workerType ?? 'thread',
            taskTimeout: config.taskTimeout ?? 60000,
            workerTerminateTimeout: config.workerTerminateTimeout ?? 1000,
            workerScript: config.workerScript,
            workerThreadOpts: config.workerThreadOpts,
            onError: config.onError,
        };
    }
    /**
     * Initialize the worker pool.
     * Must be called before executing any tasks.
     */
    async initialize() {
        if (this.initialized) {
            return;
        }
        const poolOptions = {
            minWorkers: this.config.minWorkers,
            maxWorkers: this.config.maxWorkers,
            maxQueueSize: this.config.maxQueueSize,
            workerType: this.config.workerType,
            workerTerminateTimeout: this.config.workerTerminateTimeout,
        };
        // Add worker thread options if provided
        if (this.config.workerThreadOpts) {
            poolOptions.workerThreadOpts = this.config.workerThreadOpts;
        }
        // Create pool with or without a worker script
        if (this.config.workerScript) {
            this.pool = workerpool.pool(this.config.workerScript, poolOptions);
        }
        else {
            this.pool = workerpool.pool(poolOptions);
        }
        this.initialized = true;
    }
    /**
     * Execute a function in a worker thread.
     * The function must be self-contained and serializable.
     *
     * @param fn - The function to execute
     * @param args - Arguments to pass to the function
     * @param options - Task execution options
     * @returns Promise resolving to the task result
     */
    async exec(fn, args = [], options = {}) {
        this.ensureInitialized();
        const startTime = Date.now();
        const taskTimeout = options.timeout ?? this.config.taskTimeout;
        try {
            const workerPromise = this.pool.exec(fn, args);
            const result = await this.withTimeout(workerPromise, taskTimeout);
            return {
                value: result,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            this.handleError(error);
            throw error;
        }
    }
    /**
     * Execute a function in a worker thread with cancellation support.
     *
     * @param fn - The function to execute
     * @param args - Arguments to pass to the function
     * @param options - Task execution options
     * @returns Task handle with promise and cancel function
     */
    execCancellable(fn, args = [], options = {}) {
        this.ensureInitialized();
        const taskId = this.generateTaskId();
        const startTime = Date.now();
        const taskTimeout = options.timeout ?? this.config.taskTimeout;
        let cancelled = false;
        const workerPromise = this.pool.exec(fn, args);
        const cancel = () => {
            if (!cancelled) {
                cancelled = true;
                workerPromise.cancel();
                this.pendingTasks.delete(taskId);
                options.onCancel?.();
            }
        };
        this.pendingTasks.set(taskId, { cancel });
        // Apply timeout and wrap in TaskResult
        const promise = this.withTimeout(workerPromise, taskTimeout)
            .then((value) => {
            this.pendingTasks.delete(taskId);
            return {
                value: value,
                duration: Date.now() - startTime,
            };
        })
            .catch((error) => {
            this.pendingTasks.delete(taskId);
            if (cancelled) {
                throw new TaskCancelledError();
            }
            this.handleError(error);
            throw error;
        });
        return {
            promise,
            cancel,
            isCancelled: () => cancelled,
        };
    }
    /**
     * Execute a method on a worker script.
     * Requires the adapter to be initialized with a workerScript.
     *
     * @param method - The method name to call on the worker
     * @param args - Arguments to pass to the method
     * @param options - Task execution options
     * @returns Promise resolving to the task result
     */
    async execMethod(method, args = [], options = {}) {
        this.ensureInitialized();
        if (!this.config.workerScript) {
            throw new WorkerScriptRequiredError('execMethod');
        }
        const startTime = Date.now();
        const taskTimeout = options.timeout ?? this.config.taskTimeout;
        try {
            const workerPromise = this.pool.exec(method, args);
            const result = await this.withTimeout(workerPromise, taskTimeout);
            return {
                value: result,
                duration: Date.now() - startTime,
            };
        }
        catch (error) {
            this.handleError(error);
            throw error;
        }
    }
    /**
     * Execute a method on a worker script with cancellation support.
     *
     * @param method - The method name to call on the worker
     * @param args - Arguments to pass to the method
     * @param options - Task execution options
     * @returns Task handle with promise and cancel function
     */
    execMethodCancellable(method, args = [], options = {}) {
        this.ensureInitialized();
        if (!this.config.workerScript) {
            throw new WorkerScriptRequiredError('execMethodCancellable');
        }
        const taskId = this.generateTaskId();
        const startTime = Date.now();
        const taskTimeout = options.timeout ?? this.config.taskTimeout;
        let cancelled = false;
        const workerPromise = this.pool.exec(method, args);
        const cancel = () => {
            if (!cancelled) {
                cancelled = true;
                workerPromise.cancel();
                this.pendingTasks.delete(taskId);
                options.onCancel?.();
            }
        };
        this.pendingTasks.set(taskId, { cancel });
        const promise = this.withTimeout(workerPromise, taskTimeout)
            .then((value) => {
            this.pendingTasks.delete(taskId);
            return {
                value: value,
                duration: Date.now() - startTime,
            };
        })
            .catch((error) => {
            this.pendingTasks.delete(taskId);
            if (cancelled) {
                throw new TaskCancelledError();
            }
            this.handleError(error);
            throw error;
        });
        return {
            promise,
            cancel,
            isCancelled: () => cancelled,
        };
    }
    /**
     * Create a proxy for a worker script.
     * Allows calling worker methods as if they were local async functions.
     *
     * @param options - Task execution options applied to all proxied calls
     * @returns Proxy object for the worker script
     */
    async proxy(_options = {}) {
        this.ensureInitialized();
        if (!this.config.workerScript) {
            throw new WorkerScriptRequiredError('proxy');
        }
        const workerProxy = await this.pool.proxy();
        // Wrap the proxy to add timing and error handling
        return new Proxy(workerProxy, {
            get: (target, prop) => {
                if (typeof target[prop] === 'function') {
                    return async (...args) => {
                        const startTime = Date.now();
                        try {
                            const result = await target[prop](...args);
                            return {
                                value: result,
                                duration: Date.now() - startTime,
                            };
                        }
                        catch (error) {
                            this.handleError(error);
                            throw error;
                        }
                    };
                }
                return target[prop];
            },
        });
    }
    /**
     * Get current pool statistics.
     *
     * @returns Pool statistics
     */
    getStats() {
        this.ensureInitialized();
        const stats = this.pool.stats();
        return {
            totalWorkers: stats.totalWorkers,
            busyWorkers: stats.busyWorkers,
            idleWorkers: stats.idleWorkers,
            pendingTasks: stats.pendingTasks,
            activeTasks: stats.activeTasks,
        };
    }
    /**
     * Cancel all pending tasks.
     */
    cancelAll() {
        for (const task of this.pendingTasks.values()) {
            task.cancel();
        }
        this.pendingTasks.clear();
    }
    /**
     * Terminate all workers and shut down the pool.
     *
     * @param force - If true, terminate immediately without waiting for pending tasks
     * @param timeout - Timeout in milliseconds to wait for pending tasks
     */
    async terminate(force = false, timeout) {
        if (!this.pool) {
            return;
        }
        // Cancel all pending tasks if forcing
        if (force) {
            this.cancelAll();
        }
        await this.pool.terminate(force, timeout);
        this.pool = null;
        this.initialized = false;
    }
    /**
     * Check if the adapter is initialized.
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Get the number of available CPU cores.
     * Useful for determining optimal worker pool size.
     */
    static getCpuCount() {
        return cpus().length;
    }
    /**
     * Create a worker adapter from a script path.
     * Helper factory method for common use case.
     *
     * @param scriptPath - Path to the worker script
     * @param config - Additional configuration options
     */
    static fromScript(scriptPath, config = {}) {
        return new WorkerAdapter({
            ...config,
            workerScript: scriptPath,
        });
    }
    /**
     * Create a worker adapter optimized for CPU-intensive tasks.
     * Uses maximum workers and process-based isolation.
     *
     * @param config - Additional configuration options
     */
    static forCpuIntensive(config = {}) {
        const cpuCount = cpus().length;
        return new WorkerAdapter({
            ...config,
            minWorkers: Math.max(1, Math.floor(cpuCount / 2)),
            maxWorkers: cpuCount,
            workerType: 'thread',
        });
    }
    /**
     * Create a worker adapter optimized for I/O-bound tasks.
     * Uses fewer workers with thread-based execution.
     *
     * @param config - Additional configuration options
     */
    static forIoBound(config = {}) {
        const cpuCount = cpus().length;
        return new WorkerAdapter({
            ...config,
            minWorkers: 0,
            maxWorkers: Math.max(2, Math.floor(cpuCount / 4)),
            workerType: 'thread',
        });
    }
    /**
     * Wrap a promise with a timeout.
     *
     * @param promise - The promise to wrap
     * @param timeout - Timeout in milliseconds
     * @returns Promise that rejects if timeout is exceeded
     */
    withTimeout(promise, timeout) {
        return Promise.race([
            promise,
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new TaskTimeoutError(timeout));
                }, timeout);
            }),
        ]);
    }
    /**
     * Ensure the adapter is initialized before operations.
     */
    ensureInitialized() {
        if (!this.initialized || !this.pool) {
            throw new WorkerNotInitializedError();
        }
    }
    /**
     * Generate a unique task ID.
     */
    generateTaskId() {
        return `task-${Date.now()}-${++this.taskIdCounter}`;
    }
    /**
     * Handle and optionally report errors.
     */
    handleError(error) {
        if (this.config.onError) {
            this.config.onError(error);
        }
    }
}
/**
 * Default worker adapter instance.
 * Can be used directly or as a template for custom configurations.
 */
export const defaultWorkerAdapter = new WorkerAdapter();
/**
 * Export workerpool module for advanced usage.
 * Allows direct access to workerpool functionality when needed.
 */
export { workerpool };
//# sourceMappingURL=worker-adapter.js.map