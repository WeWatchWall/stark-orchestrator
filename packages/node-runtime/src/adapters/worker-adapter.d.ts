import workerpool from 'workerpool';
import type { IWorkerAdapter, WorkerAdapterConfig, TaskOptions, TaskResult, PoolStats, TaskHandle } from '@stark-o/shared';
/**
 * Extended configuration options for the Node.js worker adapter.
 */
export interface NodeWorkerAdapterConfig extends WorkerAdapterConfig {
    /**
     * Worker type: 'auto', 'thread', or 'process'.
     * @default 'thread'
     */
    workerType?: 'auto' | 'thread' | 'process';
    /**
     * Additional options to pass to the underlying worker threads.
     */
    workerThreadOpts?: Record<string, unknown>;
}
export type { WorkerAdapterConfig, TaskOptions, TaskResult, PoolStats, TaskHandle, IWorkerAdapter, } from '@stark-o/shared';
export { TaskCancelledError, TaskTimeoutError, WorkerNotInitializedError, WorkerScriptRequiredError, } from '@stark-o/shared';
/**
 * Worker adapter wrapping Workerpool for worker_threads management.
 * Provides a unified interface for executing tasks in worker threads.
 *
 * This implementation uses Workerpool which manages a pool of worker_threads
 * for parallel task execution in Node.js environments.
 */
export declare class WorkerAdapter implements IWorkerAdapter {
    private readonly config;
    private pool;
    private initialized;
    private readonly pendingTasks;
    private taskIdCounter;
    constructor(config?: NodeWorkerAdapterConfig);
    /**
     * Initialize the worker pool.
     * Must be called before executing any tasks.
     */
    initialize(): Promise<void>;
    /**
     * Execute a function in a worker thread.
     * The function must be self-contained and serializable.
     *
     * @param fn - The function to execute
     * @param args - Arguments to pass to the function
     * @param options - Task execution options
     * @returns Promise resolving to the task result
     */
    exec<T, Args extends unknown[]>(fn: (...args: Args) => T | Promise<T>, args?: Args, options?: TaskOptions): Promise<TaskResult<T>>;
    /**
     * Execute a function in a worker thread with cancellation support.
     *
     * @param fn - The function to execute
     * @param args - Arguments to pass to the function
     * @param options - Task execution options
     * @returns Task handle with promise and cancel function
     */
    execCancellable<T, Args extends unknown[]>(fn: (...args: Args) => T | Promise<T>, args?: Args, options?: TaskOptions): TaskHandle<T>;
    /**
     * Execute a method on a worker script.
     * Requires the adapter to be initialized with a workerScript.
     *
     * @param method - The method name to call on the worker
     * @param args - Arguments to pass to the method
     * @param options - Task execution options
     * @returns Promise resolving to the task result
     */
    execMethod<T>(method: string, args?: unknown[], options?: TaskOptions): Promise<TaskResult<T>>;
    /**
     * Execute a method on a worker script with cancellation support.
     *
     * @param method - The method name to call on the worker
     * @param args - Arguments to pass to the method
     * @param options - Task execution options
     * @returns Task handle with promise and cancel function
     */
    execMethodCancellable<T>(method: string, args?: unknown[], options?: TaskOptions): TaskHandle<T>;
    /**
     * Create a proxy for a worker script.
     * Allows calling worker methods as if they were local async functions.
     *
     * @param options - Task execution options applied to all proxied calls
     * @returns Proxy object for the worker script
     */
    proxy<T extends Record<string, (...args: unknown[]) => unknown>>(_options?: TaskOptions): Promise<T>;
    /**
     * Get current pool statistics.
     *
     * @returns Pool statistics
     */
    getStats(): PoolStats;
    /**
     * Cancel all pending tasks.
     */
    cancelAll(): void;
    /**
     * Terminate all workers and shut down the pool.
     *
     * @param force - If true, terminate immediately without waiting for pending tasks
     * @param timeout - Timeout in milliseconds to wait for pending tasks
     */
    terminate(force?: boolean, timeout?: number): Promise<void>;
    /**
     * Check if the adapter is initialized.
     */
    isInitialized(): boolean;
    /**
     * Get the number of available CPU cores.
     * Useful for determining optimal worker pool size.
     */
    static getCpuCount(): number;
    /**
     * Create a worker adapter from a script path.
     * Helper factory method for common use case.
     *
     * @param scriptPath - Path to the worker script
     * @param config - Additional configuration options
     */
    static fromScript(scriptPath: string, config?: Omit<NodeWorkerAdapterConfig, 'workerScript'>): WorkerAdapter;
    /**
     * Create a worker adapter optimized for CPU-intensive tasks.
     * Uses maximum workers and process-based isolation.
     *
     * @param config - Additional configuration options
     */
    static forCpuIntensive(config?: Omit<NodeWorkerAdapterConfig, 'minWorkers' | 'maxWorkers' | 'workerType'>): WorkerAdapter;
    /**
     * Create a worker adapter optimized for I/O-bound tasks.
     * Uses fewer workers with thread-based execution.
     *
     * @param config - Additional configuration options
     */
    static forIoBound(config?: Omit<NodeWorkerAdapterConfig, 'minWorkers' | 'maxWorkers' | 'workerType'>): WorkerAdapter;
    /**
     * Wrap a promise with a timeout.
     *
     * @param promise - The promise to wrap
     * @param timeout - Timeout in milliseconds
     * @returns Promise that rejects if timeout is exceeded
     */
    private withTimeout;
    /**
     * Ensure the adapter is initialized before operations.
     */
    private ensureInitialized;
    /**
     * Generate a unique task ID.
     */
    private generateTaskId;
    /**
     * Handle and optionally report errors.
     */
    private handleError;
}
/**
 * Default worker adapter instance.
 * Can be used directly or as a template for custom configurations.
 */
export declare const defaultWorkerAdapter: WorkerAdapter;
/**
 * Export workerpool module for advanced usage.
 * Allows direct access to workerpool functionality when needed.
 */
export { workerpool };
//# sourceMappingURL=worker-adapter.d.ts.map