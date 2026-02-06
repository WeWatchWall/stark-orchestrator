// Stark Orchestrator - Node.js Runtime
// Worker Adapter using child_process.fork() for sub-process management

import { fork, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  IWorkerAdapter,
  WorkerAdapterConfig,
  TaskOptions,
  TaskResult,
  PoolStats,
  TaskHandle,
} from '@stark-o/shared';
import {
  TaskCancelledError,
  TaskTimeoutError,
  WorkerNotInitializedError,
} from '@stark-o/shared';

/**
 * Extended configuration options for the Node.js worker adapter.
 */
export interface NodeWorkerAdapterConfig extends WorkerAdapterConfig {
  /**
   * Maximum memory limit per worker in megabytes.
   * Sets --max-old-space-size for the sub-process.
   */
  maxMemoryMB?: number;
}

// Re-export shared types for convenience
export type {
  WorkerAdapterConfig,
  TaskOptions,
  TaskResult,
  PoolStats,
  TaskHandle,
  IWorkerAdapter,
} from '@stark-o/shared';

export {
  TaskCancelledError,
  TaskTimeoutError,
  WorkerNotInitializedError,
} from '@stark-o/shared';

/**
 * Message sent from the parent to the worker subprocess.
 */
export interface WorkerRequest {
  type: 'execute';
  taskId: string;
  bundleCode: string;
  context: unknown; // PackExecutionContext (serialized via IPC)
  args: unknown[];
}

/**
 * Message sent back from the worker subprocess to the parent.
 */
export interface WorkerResponse {
  type: 'result' | 'error';
  taskId: string;
  value?: unknown;
  error?: string;
  errorStack?: string;
}

/**
 * Internal tracking for a running subprocess task.
 */
interface SubprocessTask<T = unknown> {
  taskId: string;
  process: ChildProcess;
  resolve: (result: TaskResult<T>) => void;
  reject: (error: Error) => void;
  cancelled: boolean;
  startTime: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

/**
 * Worker adapter using Node.js child_process.fork() for sub-process management.
 * 
 * Each task spawns a dedicated subprocess that runs the worker script.
 * The worker script imports all dependencies (like PodLogSink) directly
 * rather than receiving serialized functions. Only pack bundle code and
 * metadata state are passed as arguments via IPC.
 */
export class WorkerAdapter implements IWorkerAdapter {
  private readonly config: Required<Omit<NodeWorkerAdapterConfig, 'workerScript' | 'maxMemoryMB' | 'onError'>> &
    Pick<NodeWorkerAdapterConfig, 'workerScript' | 'maxMemoryMB' | 'onError'>;
  private initialized: boolean = false;
  private readonly runningTasks: Map<string, SubprocessTask> = new Map();
  private taskIdCounter: number = 0;

  /** Path to the built-in worker script (resolved at runtime) */
  private workerScriptPath: string;

  constructor(config: NodeWorkerAdapterConfig = {}) {
    this.config = {
      minWorkers: config.minWorkers ?? 0,
      maxWorkers: config.maxWorkers ?? cpus().length,
      maxQueueSize: config.maxQueueSize ?? Infinity,
      taskTimeout: config.taskTimeout ?? 0,
      workerTerminateTimeout: config.workerTerminateTimeout ?? 1000,
      maxMemoryMB: config.maxMemoryMB,
      workerScript: config.workerScript,
      onError: config.onError,
    };

    // Resolve the default worker script path relative to this file
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFilePath);
    this.workerScriptPath = config.workerScript ?? join(currentDir, '..', 'workers', 'pack-worker.js');
  }

  /**
   * Initialize the worker adapter.
   * For subprocess-based execution, this is a lightweight operation.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  /**
   * Check if the adapter has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Execute pack code in a subprocess.
   * 
   * Forks a new child process running the worker script, passes the
   * bundle code + execution context as arguments via IPC message,
   * and waits for the result.
   *
   * @param bundleCode - The pack's JavaScript bundle code
   * @param context - The PackExecutionContext (serializable metadata/state)
   * @param args - Additional arguments for the pack entrypoint
   * @param options - Task execution options (timeout, etc.)
   * @returns Promise resolving to the task result
   */
  async execTask<T>(
    bundleCode: string,
    context: unknown,
    args: unknown[] = [],
    options: TaskOptions = {}
  ): Promise<TaskResult<T>> {
    this.ensureInitialized();

    const taskId = this.generateTaskId();
    const startTime = Date.now();
    const taskTimeout = options.timeout ?? this.config.taskTimeout;

    return new Promise<TaskResult<T>>((resolve, reject) => {
      const execArgv: string[] = [];
      if (this.config.maxMemoryMB) {
        execArgv.push(`--max-old-space-size=${this.config.maxMemoryMB}`);
      }

      const child = fork(this.workerScriptPath, [], {
        execArgv,
        stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
        serialization: 'advanced',
      });

      const task: SubprocessTask<T> = {
        taskId,
        process: child,
        resolve,
        reject,
        cancelled: false,
        startTime,
      };
      this.runningTasks.set(taskId, task as SubprocessTask);

      // Set up timeout
      if (taskTimeout > 0 && Number.isFinite(taskTimeout)) {
        task.timeoutHandle = setTimeout(() => {
          if (!task.cancelled) {
            task.cancelled = true;
            child.kill('SIGKILL');
            this.runningTasks.delete(taskId);
            reject(new TaskTimeoutError(taskTimeout));
          }
        }, taskTimeout);
      }

      child.on('message', (msg: WorkerResponse) => {
        if (msg.taskId !== taskId) return;

        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);

        if (task.cancelled) {
          reject(new TaskCancelledError());
          return;
        }

        if (msg.type === 'result') {
          resolve({
            value: msg.value as T,
            duration: Date.now() - startTime,
          });
        } else {
          const error = new Error(msg.error ?? 'Unknown worker error');
          if (msg.errorStack) error.stack = msg.errorStack;
          reject(error);
        }
      });

      child.on('error', (error) => {
        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);
        if (!task.cancelled) {
          this.handleError(error);
          reject(error);
        }
      });

      child.on('exit', (code, signal) => {
        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        // Only reject if we haven't already resolved/rejected
        if (this.runningTasks.has(taskId)) {
          this.runningTasks.delete(taskId);
          if (!task.cancelled && code !== 0) {
            const error = new Error(`Worker process exited with code ${code}, signal ${signal}`);
            reject(error);
          }
        }
      });

      // Send the task to the subprocess
      const request: WorkerRequest = {
        type: 'execute',
        taskId,
        bundleCode,
        context,
        args,
      };
      child.send(request);
    });
  }

  /**
   * Execute pack code in a subprocess with cancellation support.
   *
   * @param bundleCode - The pack's JavaScript bundle code
   * @param context - The PackExecutionContext (serializable metadata/state) 
   * @param args - Additional arguments for the pack entrypoint
   * @param options - Task execution options
   * @returns Task handle with promise and cancel/forceTerminate functions
   */
  execTaskCancellable<T>(
    bundleCode: string,
    context: unknown,
    args: unknown[] = [],
    options: TaskOptions = {}
  ): TaskHandle<T> {
    this.ensureInitialized();

    const taskId = this.generateTaskId();
    const startTime = Date.now();
    const taskTimeout = options.timeout ?? this.config.taskTimeout;
    let cancelled = false;
    let child: ChildProcess | null = null;

    const promise = new Promise<TaskResult<T>>((resolve, reject) => {
      const execArgv: string[] = [];
      if (this.config.maxMemoryMB) {
        execArgv.push(`--max-old-space-size=${this.config.maxMemoryMB}`);
      }

      child = fork(this.workerScriptPath, [], {
        execArgv,
        stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
        serialization: 'advanced',
      });

      const task: SubprocessTask<T> = {
        taskId,
        process: child,
        resolve,
        reject,
        cancelled: false,
        startTime,
      };
      this.runningTasks.set(taskId, task as SubprocessTask);

      // Set up timeout
      if (taskTimeout > 0 && Number.isFinite(taskTimeout)) {
        task.timeoutHandle = setTimeout(() => {
          if (!task.cancelled && !cancelled) {
            task.cancelled = true;
            cancelled = true;
            child?.kill('SIGKILL');
            this.runningTasks.delete(taskId);
            reject(new TaskTimeoutError(taskTimeout));
          }
        }, taskTimeout);
      }

      child.on('message', (msg: WorkerResponse) => {
        if (msg.taskId !== taskId) return;

        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);

        if (cancelled || task.cancelled) {
          reject(new TaskCancelledError());
          return;
        }

        if (msg.type === 'result') {
          resolve({
            value: msg.value as T,
            duration: Date.now() - startTime,
          });
        } else {
          const error = new Error(msg.error ?? 'Unknown worker error');
          if (msg.errorStack) error.stack = msg.errorStack;
          reject(error);
        }
      });

      child.on('error', (error) => {
        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);
        if (!cancelled && !task.cancelled) {
          this.handleError(error);
          reject(error);
        }
      });

      child.on('exit', (code, signal) => {
        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        if (this.runningTasks.has(taskId)) {
          this.runningTasks.delete(taskId);
          if (!cancelled && !task.cancelled && code !== 0) {
            const error = new Error(`Worker process exited with code ${code}, signal ${signal}`);
            reject(error);
          }
        }
      });

      // Send the task to the subprocess
      const request: WorkerRequest = {
        type: 'execute',
        taskId,
        bundleCode,
        context,
        args,
      };
      child.send(request);
    });

    const cancel = (): void => {
      if (!cancelled) {
        cancelled = true;
        const task = this.runningTasks.get(taskId);
        if (task) {
          task.cancelled = true;
          if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        }
        // Send SIGTERM for graceful shutdown
        child?.kill('SIGTERM');
        this.runningTasks.delete(taskId);
        options.onCancel?.();
      }
    };

    const forceTerminate = async (): Promise<void> => {
      if (!cancelled) {
        cancelled = true;
        options.onCancel?.();
      }
      const task = this.runningTasks.get(taskId);
      if (task) {
        task.cancelled = true;
        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
      }
      // SIGKILL for immediate termination
      child?.kill('SIGKILL');
      this.runningTasks.delete(taskId);
    };

    return {
      promise,
      cancel,
      forceTerminate,
      isCancelled: () => cancelled,
    };
  }

  // ============================================
  // Legacy IWorkerAdapter interface methods
  // (kept for interface compatibility, throw descriptive errors)
  // ============================================

  async exec<T, Args extends unknown[]>(
    _fn: (...args: Args) => T | Promise<T>,
    _args: Args = [] as unknown as Args,
    _options: TaskOptions = {}
  ): Promise<TaskResult<T>> {
    throw new Error(
      'WorkerAdapter.exec() with serialized functions is no longer supported. ' +
      'Use execTask() with bundleCode and context instead.'
    );
  }

  execCancellable<T, Args extends unknown[]>(
    _fn: (...args: Args) => T | Promise<T>,
    _args: Args = [] as unknown as Args,
    _options: TaskOptions = {}
  ): TaskHandle<T> {
    throw new Error(
      'WorkerAdapter.execCancellable() with serialized functions is no longer supported. ' +
      'Use execTaskCancellable() with bundleCode and context instead.'
    );
  }

  async execMethod<T>(
    _method: string,
    _args: unknown[] = [],
    _options: TaskOptions = {}
  ): Promise<TaskResult<T>> {
    throw new Error(
      'WorkerAdapter.execMethod() is no longer supported. ' +
      'Use execTask() with bundleCode and context instead.'
    );
  }

  execMethodCancellable<T>(
    _method: string,
    _args: unknown[] = [],
    _options: TaskOptions = {}
  ): TaskHandle<T> {
    throw new Error(
      'WorkerAdapter.execMethodCancellable() is no longer supported. ' +
      'Use execTaskCancellable() with bundleCode and context instead.'
    );
  }

  /**
   * Get current pool statistics.
   * Reports running subprocess counts as pool stats.
   */
  getStats(): PoolStats {
    this.ensureInitialized();

    const activeTasks = this.runningTasks.size;
    return {
      totalWorkers: activeTasks,
      busyWorkers: activeTasks,
      idleWorkers: 0,
      pendingTasks: 0,
      activeTasks,
    };
  }

  /**
   * Cancel all running tasks by killing their subprocesses.
   */
  cancelAll(): void {
    for (const task of this.runningTasks.values()) {
      task.cancelled = true;
      if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
      task.process.kill('SIGTERM');
    }
    this.runningTasks.clear();
  }

  /**
   * Terminate all workers and shut down.
   *
   * @param force - If true, use SIGKILL; otherwise SIGTERM
   * @param _timeout - Unused (kept for interface compatibility)
   */
  async terminate(force: boolean = false, _timeout?: number): Promise<void> {
    const signal = force ? 'SIGKILL' : 'SIGTERM';
    for (const task of this.runningTasks.values()) {
      task.cancelled = true;
      if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
      task.process.kill(signal);
    }
    this.runningTasks.clear();
    this.initialized = false;
  }

  /**
   * Get the number of available CPU cores.
   */
  static getCpuCount(): number {
    return cpus().length;
  }

  /**
   * Ensure the adapter is initialized before operations.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new WorkerNotInitializedError();
    }
  }

  /**
   * Generate a unique task ID.
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${++this.taskIdCounter}`;
  }

  /**
   * Handle and optionally report errors.
   */
  private handleError(error: Error): void {
    if (this.config.onError) {
      this.config.onError(error);
    }
  }
}

/**
 * Default worker adapter instance.
 */
export const defaultWorkerAdapter = new WorkerAdapter();
