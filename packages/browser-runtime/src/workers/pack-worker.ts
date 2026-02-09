/**
 * Pack Worker Script (Browser Web Worker)
 * @module @stark-o/browser-runtime/workers/pack-worker
 *
 * This script runs inside a Web Worker. It IMPORTS dependencies
 * (formatLogArgs from @stark-o/shared) directly — no serialized function
 * injection. Only the pack bundle code and metadata state are received
 * via postMessage from the main thread.
 *
 * Networking: Each pod Web Worker connects DIRECTLY to the orchestrator
 * via WebSocket for signaling, then establishes WebRTC data channels
 * for all inter-pod traffic. `fetch()` is intercepted for *.internal URLs.
 * 
 * Build this file as a separate entry point (e.g. via Vite) so that
 * it becomes a standalone .js file that can be loaded as a Web Worker.
 * 
 * NOTE: The process polyfill is injected via vite.config.ts banner option
 * to ensure it runs before any ES module code.
 */

import {
  formatLogArgs,
  ServiceCaller,
  PodRequestRouter,
  StarkBrowserListener,
  interceptFetch,
  restoreFetch,
  type RoutingRequest,
  type RoutingResponse,
  type WsMessage,
  type SignallingMessage,
  type ServiceRequest,
  type ServiceResponse,
} from '@stark-o/shared';
import { WorkerNetworkProxy } from '../network/worker-network-proxy.js';

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
    // ── Networking ──
    /** Service ID this pod belongs to (for network policy checks) */
    serviceId?: string;
    /** Orchestrator WebSocket URL for signaling (e.g., wss://localhost/ws) */
    orchestratorUrl?: string;
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

// ── Network state (module-level for cleanup) ─────────────────────────
let activeWs: WebSocket | null = null;
let activeNetworkProxy: WorkerNetworkProxy | null = null;

// ── Main message handler ────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const msg = event.data;
  if (msg.type !== 'execute') return;

  const { taskId, bundleCode, context, args } = msg;

  // ═══════════════════════════════════════════════════════════════════════════
  // Raw console for errors/warnings only (before console patching)
  // ═══════════════════════════════════════════════════════════════════════════
  const rawWarn = console.warn.bind(console);
  
  if (!context.serviceId || !context.orchestratorUrl) {
    rawWarn('[STARK-WORKER] ⚠️ NETWORKING WILL BE DISABLED - fetch() to *.internal will fail!');
    if (!context.serviceId) {
      rawWarn('[STARK-WORKER]   → serviceId not passed from executor');
    }
    if (!context.orchestratorUrl) {
      rawWarn('[STARK-WORKER]   → orchestratorUrl not passed from executor');
    }
  }

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

  // ── Initialize networking (if orchestrator URL AND serviceId provided) ──
  let networkInitialized = false;
  const pendingRoutes = new Map<string, {
    resolve: (res: RoutingResponse) => void;
    reject: (err: Error) => void;
  }>();
  let routeCounter = 0;

  if (context.orchestratorUrl && context.serviceId) {
    try {

      // 1. Connect to orchestrator via WebSocket (for routing only - signaling handled by main thread)
      activeWs = await connectToOrchestrator(
        context.orchestratorUrl,
        podId,
        originalConsole,
        (message: WsMessage) => handleOrchestratorMessage(message, pendingRoutes, originalConsole, podId)
      );

      // 2. Set up request router for inbound traffic
      const requestRouter = new PodRequestRouter();
      const browserListener = new StarkBrowserListener(requestRouter);

      // 2a. Attach browserListener to context so packs can register handlers via context.listen
      (context as Record<string, unknown>).listen = browserListener;

      // 3. ServiceCaller reference (set after creation below)
      let serviceCaller: ServiceCaller | null = null;

      // 4. Use WorkerNetworkProxy instead of WebRTCConnectionManager
      // WebRTC is NOT available in Web Workers (browser limitation) so we proxy through main thread
      activeNetworkProxy = new WorkerNetworkProxy({
        localPodId: podId,
        onMessage: (fromPodId, data) => {
          handleIncomingData(fromPodId, data, browserListener, serviceCaller, podId, originalConsole);
        },
        connectionTimeout: 10_000,
      });

      // 5. Set up orchestrator router (for routing requests via WS)
      const orchestratorRouter = (request: RoutingRequest): Promise<RoutingResponse> => {
        return requestRouteFromOrchestrator(request, activeWs!, pendingRoutes, routeCounter++, podId, originalConsole);
      };

      // 6. Set up service caller with the network proxy
      serviceCaller = new ServiceCaller({
        podId: podId,
        serviceId: context.serviceId,
        connectionManager: activeNetworkProxy,
        orchestratorRouter,
      });

      // 7. Intercept fetch() for transparent *.internal routing
      interceptFetch(serviceCaller);
      networkInitialized = true;

      // 7. Register pod with orchestrator
      activeWs.send(JSON.stringify({
        type: 'network:pod:register',
        payload: {
          podId: podId,
          serviceId: context.serviceId,
        },
      }));
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
      '⚠️ NETWORKING DISABLED — missing orchestratorUrl or serviceId. fetch() calls to *.internal will fail!',
      { orchestratorUrl: context.orchestratorUrl ?? '(missing)', serviceId: context.serviceId ?? '(missing)' }
    );
  }

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
    // Clean up networking
    if (networkInitialized) {
      restoreFetch();
      activeNetworkProxy?.disconnectAll();
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.close(1000, 'Pod shutdown');
      }
      activeWs = null;
      activeNetworkProxy = null;
    }

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

// ── Networking Helper Functions ─────────────────────────────────────

function connectToOrchestrator(
  url: string,
  podId: string,
  log: typeof console,
  onMessage: (msg: WsMessage) => void
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Connection to orchestrator timed out after 10000ms'));
    }, 10_000);

    const ws = new WebSocket(url);

    ws.onopen = () => {
      clearTimeout(timeout);
      resolve(ws);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as WsMessage;
        onMessage(message);
      } catch (err) {
        log.warn(`[${new Date().toISOString()}][${podId}:net:warn]`, 'Failed to parse orchestrator message', err);
      }
    };

    ws.onerror = (event) => {
      log.error(`[${new Date().toISOString()}][${podId}:net:error]`, 'WebSocket error', event);
      clearTimeout(timeout);
      reject(new Error('WebSocket connection error'));
    };

    ws.onclose = () => {
      // Handled elsewhere
    };
  });
}

function handleOrchestratorMessage(
  message: WsMessage,
  pendingRoutes: Map<string, { resolve: (res: RoutingResponse) => void; reject: (err: Error) => void }>,
  log: typeof console,
  podId: string
): void {
  switch (message.type) {
    case 'network:signal': {
      // Forward WebRTC signals to main thread, which manages RTCPeerConnection
      // (WebRTC is not available in Web Workers - browser limitation)
      // The main thread's MainThreadNetworkManager will handle this signal
      const signal = message.payload as SignallingMessage;
      self.postMessage({
        type: 'network:signal:forward',
        payload: signal,
      });
      break;
    }

    case 'network:route:response': {
      const correlationId = message.correlationId;
      if (correlationId && pendingRoutes.has(correlationId)) {
        const pending = pendingRoutes.get(correlationId)!;
        pendingRoutes.delete(correlationId);

        const payload = message.payload as RoutingResponse & { error?: string };
        if (payload.error) {
          log.warn(`[${new Date().toISOString()}][${podId}:net:warn]`, 'Routing error', payload.error);
          pending.reject(new Error(payload.error));
        } else {
          pending.resolve(payload);
        }
      }
      break;
    }
  }
}

function requestRouteFromOrchestrator(
  request: RoutingRequest,
  ws: WebSocket,
  pendingRoutes: Map<string, { resolve: (res: RoutingResponse) => void; reject: (err: Error) => void }>,
  counter: number,
  podId: string,
  log: typeof console
): Promise<RoutingResponse> {
  return new Promise((resolve, reject) => {
    const correlationId = `route-${podId}-${counter}`;

    const timeout = setTimeout(() => {
      log.error(`[${new Date().toISOString()}][${podId}:net:error]`, 'Route request timed out');
      pendingRoutes.delete(correlationId);
      reject(new Error('Routing request timed out'));
    }, 10_000);

    pendingRoutes.set(correlationId, {
      resolve: (res) => {
        clearTimeout(timeout);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    ws.send(JSON.stringify({
      type: 'network:route:request',
      correlationId,
      payload: request,
    }));
  });
}

function handleIncomingData(
  fromPodId: string,
  data: string,
  browserListener: StarkBrowserListener,
  serviceCaller: ServiceCaller | null,
  localPodId: string,
  log: typeof console
): void {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    
    // Check if this is a RESPONSE (has status field) vs REQUEST (has method field)
    if (typeof parsed.status === 'number' && parsed.requestId) {
      // It's a service RESPONSE — let serviceCaller handle it
      if (serviceCaller) {
        const handled = serviceCaller.handleResponse(data);
        if (!handled) {
          log.warn(`[${new Date().toISOString()}][${localPodId}:net:warn]`, 'Unhandled response', parsed.requestId);
        }
      }
      return;
    }
    
    // It's a service REQUEST — dispatch to listener
    const request = parsed as unknown as ServiceRequest;
    if (request.requestId && request.method) {
      browserListener.dispatch(request).then((response) => {
        // Send response back via WebRTC
        if (activeNetworkProxy) {
          activeNetworkProxy.send(fromPodId, JSON.stringify(response));
        }
      }).catch((err) => {
        log.error(`[${new Date().toISOString()}][${localPodId}:net:error]`, 'Failed to handle incoming request', err);
        // Send error response
        const errorResponse: ServiceResponse = {
          requestId: request.requestId,
          status: 500,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
        if (activeNetworkProxy) {
          activeNetworkProxy.send(fromPodId, JSON.stringify(errorResponse));
        }
      });
    }
  } catch {
    // Not JSON or not a service message — ignore
  }
}
