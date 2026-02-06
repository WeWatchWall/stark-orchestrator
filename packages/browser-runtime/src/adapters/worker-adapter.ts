// Stark Orchestrator - Browser Runtime
// Worker Adapter using native Web Workers

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
 * Extended configuration options for the browser worker adapter.
 */
export interface BrowserWorkerAdapterConfig extends WorkerAdapterConfig {
  /**
   * URL to the worker script bundle.
   * This script will be loaded by each Web Worker and must import its
   * own dependencies (PodLogSink, etc.) directly via the bundle.
   */
  workerScriptUrl?: string;
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
 * Message sent from the main thread to the Web Worker.
 */
export interface BrowserWorkerRequest {
  type: 'execute';
  taskId: string;
  bundleCode: string;
  context: unknown; // PackExecutionContext (serialized via structured clone)
  args: unknown[];
}

/**
 * Message sent back from the Web Worker to the main thread.
 */
export interface BrowserWorkerResponse {
  type: 'result' | 'error';
  taskId: string;
  value?: unknown;
  error?: string;
  errorStack?: string;
}

/**
 * Internal tracking for a running Web Worker task.
 */
interface WebWorkerTask<T = unknown> {
  taskId: string;
  worker: Worker;
  resolve: (result: TaskResult<T>) => void;
  reject: (error: Error) => void;
  cancelled: boolean;
  startTime: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

/**
 * Get the number of logical processors available to the browser.
 * Falls back to 4 if navigator.hardwareConcurrency is not available.
 */
function getHardwareConcurrency(): number {
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    return navigator.hardwareConcurrency;
  }
  return 4;
}

/**
 * Browser worker adapter using native Web Workers.
 * 
 * Each task spawns a dedicated Web Worker that runs the bundled worker script.
 * The worker script imports all dependencies (like PodLogSink, formatLogArgs)
 * directly via the bundle — no serialized function injection. Only pack bundle
 * code and metadata state are passed as messages.
 */
export class WorkerAdapter implements IWorkerAdapter {
  private readonly config: Required<Omit<BrowserWorkerAdapterConfig, 'workerScript' | 'workerScriptUrl' | 'onError'>> &
    Pick<BrowserWorkerAdapterConfig, 'workerScript' | 'workerScriptUrl' | 'onError'>;
  private initialized: boolean = false;
  private readonly runningTasks: Map<string, WebWorkerTask> = new Map();
  private taskIdCounter: number = 0;

  /** URL to the worker script */
  private workerScriptUrl: string;

  constructor(config: BrowserWorkerAdapterConfig = {}) {
    this.config = {
      minWorkers: config.minWorkers ?? 0,
      maxWorkers: config.maxWorkers ?? getHardwareConcurrency(),
      maxQueueSize: config.maxQueueSize ?? Infinity,
      taskTimeout: config.taskTimeout ?? 0,
      workerTerminateTimeout: config.workerTerminateTimeout ?? 1000,
      workerScript: config.workerScript,
      workerScriptUrl: config.workerScriptUrl,
      onError: config.onError,
    };

    // Use workerScriptUrl or workerScript (legacy alias)
    this.workerScriptUrl = config.workerScriptUrl ?? config.workerScript ?? '';
  }

  /**
   * Initialize the worker adapter.
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
   * Execute pack code in a Web Worker.
   *
   * Creates a new Web Worker, posts the bundle code + execution context
   * as a message, and waits for the result.
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
      let worker: Worker;

      if (this.workerScriptUrl) {
        // Use the pre-built worker script URL
        worker = new Worker(this.workerScriptUrl, { type: 'module' });
      } else {
        // Create an inline worker from the pack-worker-inline code
        // This is a fallback when no workerScriptUrl is configured
        const blob = new Blob(
          [getInlineWorkerCode()],
          { type: 'application/javascript' }
        );
        worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
      }

      const task: WebWorkerTask<T> = {
        taskId,
        worker,
        resolve,
        reject,
        cancelled: false,
        startTime,
      };
      this.runningTasks.set(taskId, task as WebWorkerTask);

      // Set up timeout
      if (taskTimeout > 0 && Number.isFinite(taskTimeout)) {
        task.timeoutHandle = setTimeout(() => {
          if (!task.cancelled) {
            task.cancelled = true;
            worker.terminate();
            this.runningTasks.delete(taskId);
            reject(new TaskTimeoutError(taskTimeout));
          }
        }, taskTimeout);
      }

      worker.onmessage = (event: MessageEvent<BrowserWorkerResponse>) => {
        const msg = event.data;
        if (msg.taskId !== taskId) return;

        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);
        worker.terminate();

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
      };

      worker.onerror = (event: ErrorEvent) => {
        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);
        worker.terminate();
        if (!task.cancelled) {
          const error = new Error(event.message ?? 'Worker error');
          this.handleError(error);
          reject(error);
        }
      };

      // Send the task to the worker
      const request: BrowserWorkerRequest = {
        type: 'execute',
        taskId,
        bundleCode,
        context,
        args,
      };
      worker.postMessage(request);
    });
  }

  /**
   * Execute pack code in a Web Worker with cancellation support.
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
    let worker: Worker | null = null;

    const promise = new Promise<TaskResult<T>>((resolve, reject) => {
      if (this.workerScriptUrl) {
        worker = new Worker(this.workerScriptUrl, { type: 'module' });
      } else {
        const blob = new Blob(
          [getInlineWorkerCode()],
          { type: 'application/javascript' }
        );
        worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
      }

      const task: WebWorkerTask<T> = {
        taskId,
        worker,
        resolve,
        reject,
        cancelled: false,
        startTime,
      };
      this.runningTasks.set(taskId, task as WebWorkerTask);

      // Set up timeout
      if (taskTimeout > 0 && Number.isFinite(taskTimeout)) {
        task.timeoutHandle = setTimeout(() => {
          if (!task.cancelled && !cancelled) {
            task.cancelled = true;
            cancelled = true;
            worker?.terminate();
            this.runningTasks.delete(taskId);
            reject(new TaskTimeoutError(taskTimeout));
          }
        }, taskTimeout);
      }

      worker.onmessage = (event: MessageEvent<BrowserWorkerResponse>) => {
        const msg = event.data;
        if (msg.taskId !== taskId) return;

        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);
        worker?.terminate();

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
      };

      worker.onerror = (event: ErrorEvent) => {
        if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        this.runningTasks.delete(taskId);
        worker?.terminate();
        if (!cancelled && !task.cancelled) {
          const error = new Error(event.message ?? 'Worker error');
          this.handleError(error);
          reject(error);
        }
      };

      // Send the task to the worker
      const request: BrowserWorkerRequest = {
        type: 'execute',
        taskId,
        bundleCode,
        context,
        args,
      };
      worker.postMessage(request);
    });

    const cancel = (): void => {
      if (!cancelled) {
        cancelled = true;
        const task = this.runningTasks.get(taskId);
        if (task) {
          task.cancelled = true;
          if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
        }
        worker?.terminate();
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
      worker?.terminate();
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
   * Reports running Web Worker counts as pool stats.
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
   * Cancel all running tasks by terminating their Web Workers.
   */
  cancelAll(): void {
    for (const task of this.runningTasks.values()) {
      task.cancelled = true;
      if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
      task.worker.terminate();
    }
    this.runningTasks.clear();
  }

  /**
   * Terminate all workers and shut down.
   *
   * @param _force - Unused (Web Workers always terminate immediately)
   * @param _timeout - Unused
   */
  async terminate(_force: boolean = false, _timeout?: number): Promise<void> {
    for (const task of this.runningTasks.values()) {
      task.cancelled = true;
      if (task.timeoutHandle) clearTimeout(task.timeoutHandle);
      task.worker.terminate();
    }
    this.runningTasks.clear();
    this.initialized = false;
  }

  /**
   * Get the number of available logical processors.
   */
  static getHardwareConcurrency(): number {
    return getHardwareConcurrency();
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
 * Returns inline worker code as a string for use when no workerScriptUrl is configured.
 * This code is self-contained and handles message-based pack execution inside a Web Worker.
 * It includes its own formatLogArgs and console patching (mirroring PodLogSink format).
 */
function getInlineWorkerCode(): string {
  return `
// Inline pack worker for Stark Browser Runtime
// This code runs inside a Web Worker

function formatLogArgs(args) {
  return args.map(function(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.name + ': ' + arg.message;
    try { return JSON.stringify(arg); } catch(e) { return String(arg); }
  }).join(' ');
}

self.onmessage = async function(event) {
  var msg = event.data;
  if (msg.type !== 'execute') return;

  var taskId = msg.taskId;
  var bundleCode = msg.bundleCode;
  var context = msg.context;
  var args = msg.args;

  // Patch console to route through pod log sink format
  var podId = context.podId;
  var originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  console.log = function() { originalConsole.log('[' + new Date().toISOString() + '][' + podId + ':out]', formatLogArgs(Array.from(arguments))); };
  console.info = function() { originalConsole.log('[' + new Date().toISOString() + '][' + podId + ':out]', formatLogArgs(Array.from(arguments))); };
  console.debug = function() { originalConsole.log('[' + new Date().toISOString() + '][' + podId + ':out]', formatLogArgs(Array.from(arguments))); };
  console.warn = function() { originalConsole.error('[' + new Date().toISOString() + '][' + podId + ':err]', formatLogArgs(Array.from(arguments))); };
  console.error = function() { originalConsole.error('[' + new Date().toISOString() + '][' + podId + ':err]', formatLogArgs(Array.from(arguments))); };

  // Make env available globally
  self.__STARK_ENV__ = context.env || {};
  self.__STARK_CONTEXT__ = context;

  try {
    var moduleExports = {};
    var mod = { exports: moduleExports };

    var moduleFactory = new Function(
      'exports', 'module', 'context', 'args', '__STARK_ENV__',
      bundleCode + '\\n//# sourceURL=pack-' + context.packId + '-' + context.packVersion + '.js'
    );

    moduleFactory(moduleExports, mod, context, args, context.env || {});

    var entrypoint = (context.metadata && context.metadata.entrypoint) || 'default';
    var packExports = mod.exports;
    var entrypointFn = packExports[entrypoint] || packExports.default;

    if (typeof entrypointFn !== 'function') {
      throw new Error(
        "Pack entrypoint '" + entrypoint + "' is not a function. " +
        "Available exports: " + Object.keys(packExports).join(', ')
      );
    }

    var result = await Promise.resolve(entrypointFn(context, ...args));
    self.postMessage({ type: 'result', taskId: taskId, value: result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      taskId: taskId,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    delete self.__STARK_ENV__;
    delete self.__STARK_CONTEXT__;
  }
};
`;
}

/**
 * Default worker adapter instance.
 */
export const defaultWorkerAdapter = new WorkerAdapter();

/**
 * Factory function to create a worker adapter with custom configuration.
 */
export function createWorkerAdapter(config: BrowserWorkerAdapterConfig = {}): WorkerAdapter {
  return new WorkerAdapter(config);
}
