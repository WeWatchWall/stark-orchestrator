/**
 * Pack Worker Script (Node.js subprocess)
 * @module @stark-o/node-runtime/workers/pack-worker
 *
 * This script runs in a forked child_process. It IMPORTS all dependencies
 * (PodLogSink, createPodConsole, etc.) directly — no serialized function
 * injection. Only the pack bundle code and metadata state are received
 * via IPC message from the parent process.
 *
 * Networking: Each pod subprocess connects DIRECTLY to the orchestrator
 * via WebSocket for signaling, then establishes WebRTC data channels
 * for all inter-pod traffic. No IPC relay through node-agent needed.
 */

import http from 'http';
import {
  formatLogArgs,
} from '@stark-o/shared';
import { PodNetworkStack } from '../network/pod-network-stack.js';

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
    // ── Networking ──
    /** Service ID this pod belongs to (for network policy checks) */
    serviceId?: string;
    /** Orchestrator WebSocket URL for signaling (e.g., wss://localhost/ws) */
    orchestratorUrl?: string;
    /** Skip TLS verification for orchestrator connection */
    insecure?: boolean;
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

/** Active network stack for cleanup on shutdown */
let activeNetworkStack: PodNetworkStack | null = null;

/**
 * Execute a pack bundle inside this subprocess.
 *
 * 1. Sets up environment variables from context.env
 * 2. Patches console.* to include pod metadata prefixes
 * 3. Initializes WebRTC networking (direct to orchestrator)
 * 4. Installs HTTP server interceptor
 * 5. Evaluates the pack bundle code
 * 6. Calls the entrypoint, passing the context + args
 * 7. Sends the result (or error) back to the parent via IPC
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

  // 3. Initialize WebRTC networking (if orchestrator URL AND serviceId provided)
  let networkStack: PodNetworkStack | null = null;
  
  originalConsole.log(`[${new Date().toISOString()}][${podId}:net:debug]`, 'Checking networking config', {
    hasOrchestratorUrl: !!context.orchestratorUrl,
    orchestratorUrl: context.orchestratorUrl ?? '(not set)',
    hasServiceId: !!context.serviceId,
    serviceId: context.serviceId ?? '(not set)',
  });

  if (context.orchestratorUrl && context.serviceId) {
    try {
      originalConsole.log(`[${new Date().toISOString()}][${podId}:net:info]`, 'Initializing WebRTC networking...', {
        serviceId: context.serviceId,
        orchestratorUrl: context.orchestratorUrl,
      });
      
      networkStack = new PodNetworkStack({
        podId: context.podId,
        serviceId: context.serviceId,
        orchestratorUrl: context.orchestratorUrl,
        insecure: context.insecure,
        log: (level, msg, data) => {
          const logFn = level === 'error' ? originalConsole.error : originalConsole.log;
          const prefix = `[${new Date().toISOString()}][${podId}:net:${level}]`;
          if (data) {
            logFn(prefix, msg, JSON.stringify(data));
          } else {
            logFn(prefix, msg);
          }
        },
      });
      await networkStack.init();
      activeNetworkStack = networkStack;

      // 4. Install HTTP server interceptor BEFORE pack code runs
      // This captures any http.createServer() calls made by the pack
      networkStack.installServerInterceptor(http);

      originalConsole.log(`[${new Date().toISOString()}][${podId}:net:info]`, '✅ WebRTC networking initialized — fetch() is now intercepted for *.internal');
    } catch (err) {
      originalConsole.error(
        `[${new Date().toISOString()}][${podId}:net:error]`,
        '❌ Failed to initialize networking:',
        err instanceof Error ? err.message : String(err)
      );
      // Non-fatal: pack can still run but won't have inter-service comm
    }
  } else {
    originalConsole.warn(
      `[${new Date().toISOString()}][${podId}:net:warn]`,
      '⚠️ NETWORKING DISABLED — missing orchestratorUrl or serviceId. fetch() calls to *.internal will go to DNS and fail!',
      { orchestratorUrl: context.orchestratorUrl ?? '(missing)', serviceId: context.serviceId ?? '(missing)' }
    );
  }

  try {
    // 5. Evaluate the pack bundle code
    // The bundle is a fully-bundled CJS module — we provide exports/module
    // so the bundle can attach its entrypoint(s). No sandboxing.
    // We also provide require so bundles can access Node.js built-ins.
    // Note: The http module passed to require() is the SAME instance we patched
    // via installServerInterceptor, so http.createServer calls will be captured.
    const moduleExports: Record<string, unknown> = {};
    const mod = { exports: moduleExports };

    // Create a require function that the bundle can use
    // This uses Node's native require (via createRequire) which respects module caching,
    // so the patched http module will be returned when require('http') is called.
    const { createRequire } = await import('module');
    const bundleRequire = createRequire(import.meta.url);

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const moduleFactory = new Function(
      'exports',
      'module',
      'require',
      'context',
      'args',
      `${bundleCode}\n//# sourceURL=pack-${context.packId}-${context.packVersion}.js`
    );

    // 6. Execute the bundle
    moduleFactory(moduleExports, mod, bundleRequire, context, args);

    // 7. Resolve and call entrypoint
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

    // Clean up network stack
    if (networkStack) {
      try {
        await networkStack.shutdown();
        activeNetworkStack = null;
      } catch {
        // Ignore shutdown errors
      }
    }

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
  // Clean up network stack before exiting
  if (activeNetworkStack) {
    activeNetworkStack.shutdown().finally(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});
