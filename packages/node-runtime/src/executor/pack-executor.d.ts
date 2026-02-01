/**
 * Pack Executor
 * @module @stark-o/node-runtime/executor/pack-executor
 *
 * Executes pack bundles in worker_threads for isolated, concurrent execution.
 * Provides lifecycle management, resource tracking, and error handling.
 */
import { type WorkerAdapterConfig, type TaskHandle, type PoolStats } from '../adapters/worker-adapter.js';
import { type FsAdapterConfig } from '../adapters/fs-adapter.js';
import { type HttpAdapterConfig } from '../adapters/http-adapter.js';
import { type Logger, type Pack, type Pod, type RuntimeTag } from '@stark-o/shared';
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
    /** Base directory for pack bundles (default: process.cwd()) */
    bundleDir?: string;
    /** Orchestrator URL for downloading bundles (optional) */
    orchestratorUrl?: string;
    /** Auth token for bundle downloads */
    authToken?: string;
    /** Worker adapter configuration */
    workerConfig?: WorkerAdapterConfig;
    /** File system adapter configuration */
    fsConfig?: FsAdapterConfig;
    /** HTTP adapter configuration */
    httpConfig?: HttpAdapterConfig;
    /** Default execution timeout in milliseconds (default: 300000 = 5 minutes) */
    defaultTimeout?: number;
    /** Maximum concurrent executions (default: 10) */
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
export declare class PackExecutor {
    private readonly config;
    private workerAdapter;
    private fsAdapter;
    private httpAdapter;
    private initialized;
    private readonly executions;
    private readonly podExecutions;
    constructor(config?: PackExecutorConfig);
    /**
     * Initialize the pack executor.
     * Must be called before executing any packs.
     */
    initialize(): Promise<void>;
    /**
     * Check if the executor is initialized
     */
    isInitialized(): boolean;
    /**
     * Ensure the executor is initialized before operations
     */
    private ensureInitialized;
    /**
     * Execute a pack for a pod.
     *
     * @param pack - Pack to execute
     * @param pod - Pod requesting the execution
     * @param options - Execution options
     * @returns Execution handle for tracking and cancellation
     */
    execute(pack: Pack, pod: Pod, options?: {
        env?: Record<string, string>;
        timeout?: number;
        args?: unknown[];
    }): ExecutionHandle;
    /**
     * Internal async execution logic
     */
    private executeAsync;
    /**
     * Resolve the bundle path for a pack
     */
    private resolveBundlePath;
    /**
     * Download a bundle from a URL
     */
    private downloadBundle;
    /**
     * Download a bundle from orchestrator storage
     */
    private downloadFromStorage;
    /**
     * Load a bundle from the file system
     */
    private loadBundle;
    /**
     * Create a worker function that executes the pack code
     *
     * The function is self-contained and serializable for worker execution.
     */
    private createWorkerFunction;
    /**
     * Stop execution for a pod
     *
     * @param podId - Pod ID to stop
     * @param graceful - If true, allow in-flight operations to complete
     * @returns True if execution was stopped
     */
    stop(podId: string, graceful?: boolean): boolean;
    /**
     * Get execution status for a pod
     *
     * @param podId - Pod ID
     * @returns Execution state or undefined
     */
    getExecutionStatus(podId: string): ExecutionState | undefined;
    /**
     * Get execution result for a pod
     *
     * @param podId - Pod ID
     * @returns Execution result or undefined
     */
    getExecutionResult(podId: string): PackExecutionResult | undefined;
    /**
     * Get all active executions
     *
     * @returns Array of execution states for running executions
     */
    getActiveExecutions(): ExecutionState[];
    /**
     * Get worker pool statistics
     */
    getPoolStats(): PoolStats;
    /**
     * Cancel all running executions
     */
    cancelAll(): void;
    /**
     * Clean up completed executions older than the specified age
     *
     * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
     * @returns Number of executions cleaned up
     */
    cleanup(maxAgeMs?: number): number;
    /**
     * Terminate the executor and clean up all resources
     *
     * @param force - If true, immediately terminate all workers
     */
    terminate(force?: boolean): Promise<void>;
}
/**
 * Create a pack executor with default configuration
 */
export declare function createPackExecutor(config?: PackExecutorConfig): PackExecutor;
/**
 * Default pack executor instance
 */
export declare const defaultPackExecutor: PackExecutor;
export {};
//# sourceMappingURL=pack-executor.d.ts.map