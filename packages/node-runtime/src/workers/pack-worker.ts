/**
 * Pack Worker Script (Node.js subprocess)
 * @module @stark-o/node-runtime/workers/pack-worker
 *
 * This script runs in a forked child_process. It IMPORTS all dependencies
 * (PodLogSink, createPodConsole, etc.) directly — no serialized function
 * injection. Only the pack bundle code and metadata state are received
 * via IPC message from the parent process.
 */

import {
  formatLogArgs,
} from '@stark-o/shared';

// ── Types matching parent's WorkerRequest / WorkerResponse ──────────

interface WorkerRequest {
  type: 'execute';
  taskId: string;
  bundleCode: string;
  context: {
    executionId: string;
    podId: string;
    packId: string;
    packVersion: string;
    packName?: string;
    runtimeTag: string;
    env: Record<string, string>;
    timeout: number;
    metadata: Record<string, unknown>;
    // lifecycle and onShutdown are NOT serializable — they live in the parent
  };
  args: unknown[];
}

interface WorkerResponse {
  type: 'result' | 'error';
  taskId: string;
  value?: unknown;
  error?: string;
  errorStack?: string;
}

// ── Main execution ──────────────────────────────────────────────────

/**
 * Execute a pack bundle inside this subprocess.
 *
 * 1. Sets up environment variables from context.env
 * 2. Patches console.* to include pod metadata prefixes
 * 3. Evaluates the pack bundle code
 * 4. Calls the entrypoint, passing the context + args
 * 5. Sends the result (or error) back to the parent via IPC
 */
async function executePack(request: WorkerRequest): Promise<void> {
  const { taskId, bundleCode, context, args } = request;

  // 1. Set environment variables
  for (const [key, value] of Object.entries(context.env)) {
    process.env[key] = value;
  }

  // 2. Patch console to route through pod log format
  // Uses formatLogArgs imported from @stark-o/shared.
  // We patch console directly using saved original references to avoid
  // circular recursion (PodLogSink.write() calls console.log internally).
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
    // 3. Evaluate the pack bundle code
    // The bundle is a fully-bundled CJS module — we provide exports/module
    // so the bundle can attach its entrypoint(s). No sandboxing.
    const moduleExports: Record<string, unknown> = {};
    const mod = { exports: moduleExports };

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const moduleFactory = new Function(
      'exports',
      'module',
      'context',
      'args',
      `${bundleCode}\n//# sourceURL=pack-${context.packId}-${context.packVersion}.js`
    );

    // 4. Execute the bundle
    moduleFactory(moduleExports, mod, context, args);

    // 5. Resolve and call entrypoint
    const entrypoint = (context.metadata.entrypoint as string | undefined) ?? 'default';
    const packExports = mod.exports;
    const entrypointFn = packExports[entrypoint] ?? packExports.default;

    if (typeof entrypointFn !== 'function') {
      throw new Error(
        `Pack entrypoint '${entrypoint}' is not a function. ` +
        `Available exports: ${Object.keys(packExports).join(', ')}`
      );
    }

    const result: unknown = await Promise.resolve(
      (entrypointFn as (ctx: unknown, ...a: unknown[]) => unknown)(context, ...args)
    );

    // 6. Send result back
    const response: WorkerResponse = {
      type: 'result',
      taskId,
      value: result,
    };
    process.send!(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      taskId,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    };
    process.send!(response);
  } finally {
    // Restore console
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;

    // Clean up environment variables
    for (const key of Object.keys(context.env)) {
      delete process.env[key];
    }
  }
}

// ── IPC message handler ─────────────────────────────────────────────

process.on('message', (msg: WorkerRequest) => {
  if (msg.type === 'execute') {
    executePack(msg).catch((error) => {
      // Last-resort error handler
      const response: WorkerResponse = {
        type: 'error',
        taskId: msg.taskId,
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      };
      process.send!(response);
    });
  }
});

// Handle graceful shutdown (SIGTERM from parent)
process.on('SIGTERM', () => {
  process.exit(0);
});
