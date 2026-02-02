/**
 * Shared Worker Adapter Interface for Stark Orchestrator
 *
 * This interface defines a unified worker pool abstraction that can be
 * implemented by different runtimes:
 * - Node.js: Using sub-processes via Workerpool (default) or worker_threads
 * - Browser: Using Web Workers via Workerpool
 *
 * @module @stark-o/shared/types/worker-adapter
 */

/**
 * Transferable object type for worker communication.
 * In Node.js: ArrayBuffer, MessagePort
 * In Browser: ArrayBuffer, MessagePort, ImageBitmap, OffscreenCanvas
 * We use a minimal common type that works across environments.
 */
export type TransferableObject = ArrayBuffer | { readonly byteLength: number };

/**
 * Configuration options for the worker adapter.
 */
export interface WorkerAdapterConfig {
  /**
   * Minimum number of workers in the pool.
   * @default 0
   */
  minWorkers?: number | 'max';

  /**
   * Maximum number of workers in the pool.
   * @default Number of CPU cores (Node.js) or navigator.hardwareConcurrency (Browser)
   */
  maxWorkers?: number;

  /**
   * Maximum number of tasks to queue before rejecting new tasks.
   * @default Infinity
   */
  maxQueueSize?: number;

  /**
   * Timeout in milliseconds for task execution.
   * @default 60000 (60 seconds)
   */
  taskTimeout?: number;

  /**
   * Timeout in milliseconds before terminating idle workers.
   * @default 1000
   */
  workerTerminateTimeout?: number;

  /**
   * Path to a custom worker script.
   * If not provided, tasks must be self-contained functions.
   */
  workerScript?: string;

  /**
   * Custom error handler for worker errors.
   */
  onError?: (error: Error) => void;
}

/**
 * Task execution options.
 */
export interface TaskOptions {
  /**
   * Task-specific timeout in milliseconds.
   * Overrides the adapter's default timeout.
   */
  timeout?: number;

  /**
   * Transfer list for transferable objects (ArrayBuffer, MessagePort, etc.).
   * Enables zero-copy transfer of data to workers.
   */
  transfer?: TransferableObject[];

  /**
   * Callback invoked when the task is cancelled.
   */
  onCancel?: () => void;
}

/**
 * Result of a task execution.
 */
export interface TaskResult<T = unknown> {
  /**
   * The result value from the task.
   */
  value: T;

  /**
   * Execution duration in milliseconds.
   */
  duration: number;

  /**
   * Worker ID that executed the task (if available).
   */
  workerId?: string;
}

/**
 * Worker pool statistics.
 */
export interface PoolStats {
  /**
   * Total number of workers in the pool.
   */
  totalWorkers: number;

  /**
   * Number of currently busy workers.
   */
  busyWorkers: number;

  /**
   * Number of idle workers.
   */
  idleWorkers: number;

  /**
   * Number of tasks waiting in the queue.
   */
  pendingTasks: number;

  /**
   * Number of tasks currently being executed.
   */
  activeTasks: number;
}

/**
 * Cancellable task handle.
 */
export interface TaskHandle<T = unknown> {
  /**
   * Promise that resolves with the task result.
   */
  promise: Promise<TaskResult<T>>;

  /**
   * Cancel the task execution.
   * This is a cooperative cancellation - the task may continue running
   * until it checks for cancellation.
   */
  cancel: () => void;

  /**
   * Force terminate the worker executing this task.
   * This immediately kills the worker thread, ensuring the task stops.
   * Use this when you need guaranteed termination (e.g., when a pod is stopped).
   * The worker will be replaced with a new one automatically.
   */
  forceTerminate: () => Promise<void>;

  /**
   * Whether the task has been cancelled.
   */
  isCancelled: () => boolean;
}

/**
 * Unified worker adapter interface.
 *
 * This interface provides a consistent API for executing tasks in worker threads
 * across different runtime environments (Node.js and Browser).
 * Implementations should use Workerpool with appropriate worker types.
 */
export interface IWorkerAdapter {
  // ============================================
  // Lifecycle Methods
  // ============================================

  /**
   * Initialize the worker pool.
   * Must be called before executing any tasks.
   */
  initialize(): Promise<void>;

  /**
   * Check if the adapter has been initialized.
   */
  isInitialized(): boolean;

  /**
   * Terminate all workers and shut down the pool.
   *
   * @param force - If true, terminate immediately without waiting for pending tasks
   * @param timeout - Timeout in milliseconds to wait for pending tasks
   */
  terminate(force?: boolean, timeout?: number): Promise<void>;

  // ============================================
  // Task Execution Methods
  // ============================================

  /**
   * Execute a function in a worker.
   * The function must be self-contained and serializable.
   *
   * @param fn - The function to execute
   * @param args - Arguments to pass to the function
   * @param options - Task execution options
   * @returns Promise resolving to the task result
   */
  exec<T, Args extends unknown[]>(
    fn: (...args: Args) => T | Promise<T>,
    args?: Args,
    options?: TaskOptions
  ): Promise<TaskResult<T>>;

  /**
   * Execute a function in a worker with cancellation support.
   *
   * @param fn - The function to execute
   * @param args - Arguments to pass to the function
   * @param options - Task execution options
   * @returns Task handle with promise and cancel function
   */
  execCancellable<T, Args extends unknown[]>(
    fn: (...args: Args) => T | Promise<T>,
    args?: Args,
    options?: TaskOptions
  ): TaskHandle<T>;

  /**
   * Execute a named method on a worker script.
   * Requires the adapter to be initialized with a workerScript.
   *
   * @param method - The method name to call on the worker
   * @param args - Arguments to pass to the method
   * @param options - Task execution options
   * @returns Promise resolving to the task result
   */
  execMethod<T>(
    method: string,
    args?: unknown[],
    options?: TaskOptions
  ): Promise<TaskResult<T>>;

  /**
   * Execute a named method on a worker script with cancellation support.
   *
   * @param method - The method name to call on the worker
   * @param args - Arguments to pass to the method
   * @param options - Task execution options
   * @returns Task handle with promise and cancel function
   */
  execMethodCancellable<T>(
    method: string,
    args?: unknown[],
    options?: TaskOptions
  ): TaskHandle<T>;

  // ============================================
  // Pool Management Methods
  // ============================================

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
}

/**
 * Error thrown when a task is cancelled.
 */
export class TaskCancelledError extends Error {
  readonly name = 'TaskCancelledError';

  constructor(message: string = 'Task was cancelled') {
    super(message);
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TaskCancelledError);
    }
  }
}

/**
 * Error thrown when a task times out.
 */
export class TaskTimeoutError extends Error {
  readonly name = 'TaskTimeoutError';
  readonly timeout: number;

  constructor(timeout: number, message?: string) {
    super(message ?? `Task timed out after ${timeout}ms`);
    this.timeout = timeout;
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TaskTimeoutError);
    }
  }
}

/**
 * Error thrown when the worker pool is not initialized.
 */
export class WorkerNotInitializedError extends Error {
  readonly name = 'WorkerNotInitializedError';

  constructor(message: string = 'WorkerAdapter not initialized. Call initialize() first.') {
    super(message);
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WorkerNotInitializedError);
    }
  }
}

/**
 * Error thrown when trying to use worker script methods without a script configured.
 */
export class WorkerScriptRequiredError extends Error {
  readonly name = 'WorkerScriptRequiredError';

  constructor(method: string) {
    super(`${method} requires a workerScript to be configured`);
    // Maintain proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WorkerScriptRequiredError);
    }
  }
}
