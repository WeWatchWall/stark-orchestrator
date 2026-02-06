/**
 * Pack Worker Script (Browser Web Worker)
 * @module @stark-o/browser-runtime/workers/pack-worker
 *
 * This script runs inside a Web Worker. It IMPORTS dependencies
 * (formatLogArgs from @stark-o/shared) directly — no serialized function
 * injection. Only the pack bundle code and metadata state are received
 * via postMessage from the main thread.
 * 
 * Build this file as a separate entry point (e.g. via Vite) so that
 * it becomes a standalone .js file that can be loaded as a Web Worker.
 */

import { formatLogArgs } from '@stark-o/shared';

// ── Types matching the main thread's BrowserWorkerRequest / Response ──

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

// ── Declare self as a DedicatedWorkerGlobalScope ─────────────────────
declare const self: DedicatedWorkerGlobalScope & {
  __STARK_ENV__?: Record<string, string>;
  __STARK_CONTEXT__?: unknown;
};

// ── Main message handler ────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const msg = event.data;
  if (msg.type !== 'execute') return;

  const { taskId, bundleCode, context, args } = msg;

  // Patch console to route through pod log sink format
  // Uses formatLogArgs imported from @stark-o/shared — single source of truth
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

  // Make env + context available globally for pack code that expects it
  self.__STARK_ENV__ = context.env ?? {};
  self.__STARK_CONTEXT__ = context;

  try {
    // Evaluate the pack bundle code
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

    // Execute the bundle
    moduleFactory(moduleExports, mod, context, args);

    // Resolve and call entrypoint
    const entrypoint = (context.metadata?.entrypoint as string | undefined) ?? 'default';
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

    const response: WorkerResponse = { type: 'result', taskId, value: result };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      taskId,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    };
    self.postMessage(response);
  } finally {
    // Restore console
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.debug = originalConsole.debug;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;

    // Clean up globals
    delete self.__STARK_ENV__;
    delete self.__STARK_CONTEXT__;
  }
};
