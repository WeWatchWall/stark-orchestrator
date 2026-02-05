/**
 * Pod Log Sink
 * @module @stark-o/shared/logging/pod-log-sink
 * 
 * Routes stdout/stderr from pod execution to console with pod metadata.
 * This is a kernel-level abstraction - no files, rotation, retention, streaming,
 * querying, UI, or persistence. Those are policy concerns.
 */

/**
 * Stream type for distinguishing stdout vs stderr
 */
export type LogStream = 'out' | 'err';

/**
 * Pod metadata for log sink
 */
export interface PodLogSinkMeta {
  podId: string;
  packId: string;
  packVersion: string;
  executionId: string;
}

/**
 * PodLogSink routes stdout/stderr from a pod to console with metadata prefix.
 * 
 * Must be closed when the pod exits or is killed to release resources
 * and allow cleanup.
 */
export class PodLogSink {
  private readonly meta: PodLogSinkMeta;
  private closed = false;

  constructor(meta: PodLogSinkMeta) {
    this.meta = meta;
  }

  /**
   * Get the pod ID
   */
  get podId(): string {
    return this.meta.podId;
  }

  /**
   * Check if the sink is closed
   */
  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Write to stdout stream
   */
  stdout(message: string): void {
    this.write('out', message);
  }

  /**
   * Write to stderr stream
   */
  stderr(message: string): void {
    this.write('err', message);
  }

  /**
   * Internal write method
   */
  private write(stream: LogStream, message: string): void {
    if (this.closed) {
      return; // Silently drop messages after close
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}][${this.meta.podId}:${stream}]`;
    
    // Route to appropriate console method
    if (stream === 'err') {
      console.error(prefix, message);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Close the sink. Must be called when the pod exits or is killed.
   * After close, all writes are silently dropped.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
  }
}

/**
 * Create a PodLogSink for a pod execution
 */
export function createPodLogSink(meta: PodLogSinkMeta): PodLogSink {
  return new PodLogSink(meta);
}

/**
 * Console-like interface that can be injected into pack execution context.
 * Routes console methods through the PodLogSink.
 */
export interface PodConsole {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Format arguments for logging (exported for reuse in serializable contexts).
 * Converts unknown values to strings suitable for log output.
 */
export function formatLogArgs(args: unknown[]): string {
  return args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

/**
 * Create a console-like object that routes through a PodLogSink.
 * Useful for injecting into sandboxed pack execution.
 */
export function createPodConsole(sink: PodLogSink): PodConsole {
  return {
    log: (...args: unknown[]) => sink.stdout(formatLogArgs(args)),
    info: (...args: unknown[]) => sink.stdout(formatLogArgs(args)),
    warn: (...args: unknown[]) => sink.stderr(formatLogArgs(args)),
    error: (...args: unknown[]) => sink.stderr(formatLogArgs(args)),
    debug: (...args: unknown[]) => sink.stdout(formatLogArgs(args)),
  };
}

/**
 * Returns JavaScript code that patches console methods to route through pod logging.
 * 
 * This is designed for use in serialized worker functions where we can't import modules.
 * The code is self-contained and can be executed via eval() or new Function().
 * 
 * Usage in worker:
 *   const patchCode = getPodConsolePatchCode(podId);
 *   eval(patchCode);  // patches console.log, console.error, etc.
 * 
 * @param podId - The pod ID to include in log prefixes
 * @returns JavaScript code string that patches console methods
 */
export function getPodConsolePatchCode(podId: string): string {
  // Escape podId for safe embedding in string
  const safePodId = podId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  
  return `
(function() {
  var podId = '${safePodId}';
  var originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  
  var formatArgs = function(args) {
    return Array.prototype.map.call(args, function(arg) {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.name + ': ' + arg.message;
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return String(arg);
      }
    }).join(' ');
  };

  console.log = function() { originalConsole.log('[' + new Date().toISOString() + '][' + podId + ':out]', formatArgs(arguments)); };
  console.info = function() { originalConsole.log('[' + new Date().toISOString() + '][' + podId + ':out]', formatArgs(arguments)); };
  console.debug = function() { originalConsole.log('[' + new Date().toISOString() + '][' + podId + ':out]', formatArgs(arguments)); };
  console.warn = function() { originalConsole.error('[' + new Date().toISOString() + '][' + podId + ':err]', formatArgs(arguments)); };
  console.error = function() { originalConsole.error('[' + new Date().toISOString() + '][' + podId + ':err]', formatArgs(arguments)); };
  
  // Return restore function
  return function restoreConsole() {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  };
})()
`.trim();
}
