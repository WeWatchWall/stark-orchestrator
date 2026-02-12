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
  createEphemeralDataPlane,
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
  type GroupTransport,
  type EphemeralTransport,
  type EphemeralDataPlane,
  type EphemeralQuery,
  type EphemeralResponse,
  type PodGroupMembership,
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
    // ── Pod Authentication ──
    /** Pod authentication token for orchestrator registration */
    authToken?: string;
    /** Pod refresh token for automatic token renewal */
    refreshToken?: string;
    /** Pod token expiration timestamp (ISO 8601) */
    tokenExpiresAt?: string;
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
let activeEphemeralPlane: EphemeralDataPlane | null = null;

// ── Group transport state (WS round-trips for PodGroup operations) ────
const pendingGroupRequests = new Map<string, {
  resolve: (payload: unknown) => void;
  reject: (err: Error) => void;
}>();
let groupRequestCounter = 0;

// ── Ephemeral transport state (WebRTC round-trips for queries) ────────
const pendingEphemeralResponses = new Map<string, {
  resolve: (res: EphemeralResponse) => void;
  reject: (err: Error) => void;
}>();

// ── Reconnect state ─────────────────────────────────────────────────
let isShuttingDown = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 5_000;

// Registration context (needed for re-registration after reconnect)
let registrationContext: {
  url: string;
  podId: string;
  serviceId: string;
  authToken?: string;
  log: typeof console;
  onMessage: (msg: WsMessage) => void;
} | null = null;

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
        (message: WsMessage) => handleOrchestratorMessage(message, pendingRoutes, originalConsole, podId),
        pendingRoutes,
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

      // Store serviceId + authToken in registration context for reconnect re-registration
      if (registrationContext) {
        registrationContext.serviceId = context.serviceId;
        registrationContext.authToken = context.authToken;
      }

      // 5. Set up orchestrator router (for routing requests via WS)
      //    Uses the module-level activeWs (not a captured reference) so reconnected sockets are picked up
      const orchestratorRouter = (request: RoutingRequest): Promise<RoutingResponse> => {
        if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
          return Promise.reject(new Error('WebSocket not connected — reconnecting'));
        }
        return requestRouteFromOrchestrator(request, activeWs, pendingRoutes, routeCounter++, podId, originalConsole);
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
          authToken: context.authToken,
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

  // Recreate EphemeralDataPlane inside the worker if enabled
  // The EphemeralDataPlane cannot be serialized via postMessage (it contains
  // closures, event listeners, Maps, etc.), so the main thread strips it
  // and we recreate a fresh instance here with the same podId/serviceId.
  let ephemeralPlane: EphemeralDataPlane | null = null;
  if (context.metadata?.enableEphemeral) {
    // Build transport bridges when networking is available
    let groupTransport: GroupTransport | undefined;
    let transport: EphemeralTransport | undefined;

    if (activeWs && networkInitialized) {
      // GroupTransport: proxies join/leave/getGroupPods to orchestrator's
      // central PodGroupStore over the already-connected WS.
      groupTransport = createWorkerGroupTransport(podId);

      // EphemeralTransport: delivers ephemeral queries to remote pods
      // over WebRTC via the WorkerNetworkProxy.
      if (activeNetworkProxy) {
        transport = createWorkerEphemeralTransport();
      }
    }

    ephemeralPlane = createEphemeralDataPlane({
      podId: context.podId,
      serviceId: context.serviceId,
      groupTransport,
      transport,
    });
    activeEphemeralPlane = ephemeralPlane;
    (context as Record<string, unknown>).ephemeral = ephemeralPlane;
    originalConsole.log(
      `[${new Date().toISOString()}][${podId}:out]`,
      `EphemeralDataPlane created in Web Worker (mode=${groupTransport ? 'remote' : 'local'})`,
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
      isShuttingDown = true; // Prevent reconnect attempts during cleanup
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      restoreFetch();
      activeNetworkProxy?.disconnectAll();
      if (activeWs && (activeWs.readyState === WebSocket.OPEN || activeWs.readyState === WebSocket.CONNECTING)) {
        activeWs.close(1000, 'Pod shutdown');
      }
      activeWs = null;
      activeNetworkProxy = null;
      registrationContext = null;
      reconnectAttempts = 0;
      isShuttingDown = false; // Reset for potential reuse of the worker
    }

    // Clean up ephemeral data plane
    if (ephemeralPlane) {
      ephemeralPlane.dispose();
      ephemeralPlane = null;
      activeEphemeralPlane = null;
    }
    // Clear any leftover pending group/ephemeral requests
    for (const [, pending] of pendingGroupRequests) {
      pending.reject(new Error('Worker shutting down'));
    }
    pendingGroupRequests.clear();
    for (const [, pending] of pendingEphemeralResponses) {
      pending.reject(new Error('Worker shutting down'));
    }
    pendingEphemeralResponses.clear();

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
  onMessage: (msg: WsMessage) => void,
  pendingRoutes: Map<string, { resolve: (res: RoutingResponse) => void; reject: (err: Error) => void }>,
): Promise<WebSocket> {
  // Store registration context for reconnect re-registration
  registrationContext = { url, podId, log, onMessage, serviceId: '' /* set after return */ };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Connection to orchestrator timed out after 10000ms'));
    }, 10_000);

    const ws = new WebSocket(url);

    ws.onopen = () => {
      clearTimeout(timeout);
      reconnectAttempts = 0; // Reset on successful connection
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

    ws.onclose = (event) => {
      log.warn(
        `[${new Date().toISOString()}][${podId}:net:warn]`,
        `WebSocket closed (code=${event.code}, reason=${event.reason || 'none'})`
      );

      // Reject all pending routes — they'll never get a response on this socket
      for (const [id, pending] of pendingRoutes) {
        pending.reject(new Error('WebSocket connection closed'));
        pendingRoutes.delete(id);
      }

      // Schedule reconnect if not shutting down
      if (!isShuttingDown) {
        scheduleReconnect(pendingRoutes);
      }
    };
  });
}

function scheduleReconnect(
  pendingRoutes: Map<string, { resolve: (res: RoutingResponse) => void; reject: (err: Error) => void }>,
): void {
  if (isShuttingDown || !registrationContext) return;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    registrationContext.log.error(
      `[${new Date().toISOString()}][${registrationContext.podId}:net:error]`,
      `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached — giving up`
    );
    return;
  }

  reconnectAttempts++;
  // Linear backoff capped at 5x base delay (matches PodNetworkStack)
  const delay = RECONNECT_DELAY_MS * Math.min(reconnectAttempts, 5);

  registrationContext.log.info(
    `[${new Date().toISOString()}][${registrationContext.podId}:net:info]`,
    `Scheduling reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (isShuttingDown || !registrationContext) return;

    const ctx = registrationContext;
    try {
      const ws = await connectToOrchestrator(
        ctx.url, ctx.podId, ctx.log, ctx.onMessage, pendingRoutes
      );
      activeWs = ws;

      // Re-register pod after reconnect
      ws.send(JSON.stringify({
        type: 'network:pod:register',
        payload: {
          podId: ctx.podId,
          serviceId: ctx.serviceId,
          authToken: ctx.authToken,
        },
      }));

      ctx.log.info(
        `[${new Date().toISOString()}][${ctx.podId}:net:info]`,
        '✅ Reconnected and re-registered with orchestrator'
      );
    } catch (err) {
      ctx.log.error(
        `[${new Date().toISOString()}][${ctx.podId}:net:error]`,
        `Reconnect attempt ${reconnectAttempts} failed:`,
        err instanceof Error ? err.message : String(err)
      );
      // Recursive retry
      scheduleReconnect(pendingRoutes);
    }
  }, delay);
}

function handleOrchestratorMessage(
  message: WsMessage,
  pendingRoutes: Map<string, { resolve: (res: RoutingResponse) => void; reject: (err: Error) => void }>,
  log: typeof console,
  podId: string
): void {
  switch (message.type) {
    case 'network:pod:register:ack': {
      // Pod registration confirmed by orchestrator
      log.info(`[${new Date().toISOString()}][${podId}:net:info]`, '✅ Pod registered and authenticated with orchestrator');
      break;
    }

    case 'network:pod:register:error': {
      // Pod registration rejected by orchestrator
      const payload = message.payload as { code?: string; message?: string };
      log.error(`[${new Date().toISOString()}][${podId}:net:error]`, '❌ Pod registration failed', payload);
      break;
    }

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

    // ── Group ack / error messages ──────────────────────────────────────
    case 'group:join:ack':
    case 'group:leave:ack':
    case 'group:leave-all:ack':
    case 'group:get-pods:ack':
    case 'group:get-groups:ack': {
      const cid = message.correlationId;
      if (cid && pendingGroupRequests.has(cid)) {
        pendingGroupRequests.get(cid)!.resolve(message.payload);
        pendingGroupRequests.delete(cid);
      }
      break;
    }

    case 'group:error': {
      const cid = message.correlationId;
      const errPayload = message.payload as { error?: string };
      if (cid && pendingGroupRequests.has(cid)) {
        pendingGroupRequests.get(cid)!.reject(
          new Error(errPayload?.error ?? 'Group operation failed'),
        );
        pendingGroupRequests.delete(cid);
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
    // Guard: check WebSocket readyState before attempting to send
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log.warn(
        `[${new Date().toISOString()}][${podId}:net:warn]`,
        `Cannot route request — WebSocket not open (state=${ws?.readyState ?? 'null'}). Reconnect may be in progress.`
      );
      reject(new Error('WebSocket not connected — reconnecting'));
      return;
    }

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

    try {
      ws.send(JSON.stringify({
        type: 'network:route:request',
        correlationId,
        payload: request,
      }));
    } catch (err) {
      // send() can throw if WS transitions to CLOSING between our check and the call
      clearTimeout(timeout);
      pendingRoutes.delete(correlationId);
      log.warn(
        `[${new Date().toISOString()}][${podId}:net:warn]`,
        'WebSocket send failed (connection lost):',
        err instanceof Error ? err.message : String(err)
      );
      reject(new Error('WebSocket send failed — connection lost'));
    }
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

    // ── Ephemeral messages (PodGroup data plane) ──────────────────────
    if (parsed._ephemeral) {
      if (parsed.type === 'query') {
        // Inbound ephemeral query — dispatch to local plane
        if (activeEphemeralPlane) {
          activeEphemeralPlane.handleIncomingQuery(parsed as unknown as EphemeralQuery).then((response) => {
            if (response && activeNetworkProxy) {
              activeNetworkProxy.send(fromPodId, JSON.stringify({
                _ephemeral: true,
                type: 'response',
                ...response,
              }));
            }
          }).catch((err) => {
            log.error(`[${new Date().toISOString()}][${localPodId}:net:error]`, 'Ephemeral handler error', err);
          });
        } else {
          log.warn(`[${new Date().toISOString()}][${localPodId}:net:warn]`, 'Received ephemeral query but no EphemeralDataPlane set');
        }
      } else if (parsed.type === 'response') {
        // Inbound ephemeral response — resolve pending query
        const resp = parsed as unknown as EphemeralResponse;
        const key = `${resp.queryId}:${fromPodId}`;
        const pending = pendingEphemeralResponses.get(key);
        if (pending) {
          pendingEphemeralResponses.delete(key);
          pending.resolve(resp);
        }
      }
      return;
    }
    
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

// ── Group Transport (WS round-trip for PodGroup operations) ─────────

/**
 * Send a group-related WS message and wait for the ack.
 */
function workerGroupRequest<T>(type: string, payload: Record<string, unknown>, podId: string): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected — cannot send group request'));
      return;
    }

    const correlationId = `grp-${podId}-${++groupRequestCounter}`;

    const timeout = setTimeout(() => {
      pendingGroupRequests.delete(correlationId);
      reject(new Error(`Group request '${type}' timed out`));
    }, 10_000);

    pendingGroupRequests.set(correlationId, {
      resolve: (data) => {
        clearTimeout(timeout);
        resolve(data as T);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    activeWs.send(JSON.stringify({ type, payload, correlationId }));
  });
}

/**
 * Create a GroupTransport that proxies group operations to the
 * orchestrator's central PodGroupStore over WS.
 */
function createWorkerGroupTransport(podId: string): GroupTransport {
  return {
    join: async (groupId, pId, ttl, metadata) => {
      const res = await workerGroupRequest<{ membership: PodGroupMembership }>(
        'group:join',
        { groupId, podId: pId, ttl, metadata },
        podId,
      );
      return res.membership;
    },
    leave: async (groupId, pId) => {
      const res = await workerGroupRequest<{ removed: boolean }>('group:leave', { groupId, podId: pId }, podId);
      return res.removed;
    },
    leaveAll: async (pId) => {
      const res = await workerGroupRequest<{ removedFrom: string[] }>('group:leave-all', { podId: pId }, podId);
      return res.removedFrom;
    },
    getGroupPods: async (groupId) => {
      const res = await workerGroupRequest<{ members: PodGroupMembership[] }>('group:get-pods', { groupId }, podId);
      return res.members;
    },
    getGroupsForPod: async (pId) => {
      const res = await workerGroupRequest<{ groups: string[] }>('group:get-groups', { podId: pId }, podId);
      return res.groups;
    },
  };
}

/**
 * Create an EphemeralTransport that sends ephemeral queries to
 * remote pods over WebRTC via the WorkerNetworkProxy.
 */
function createWorkerEphemeralTransport(): EphemeralTransport {
  return (async (targetPodId: string, query: EphemeralQuery): Promise<EphemeralResponse> => {
    if (!activeNetworkProxy) {
      throw new Error('Network proxy not initialised — cannot send ephemeral query');
    }

    // Ensure WebRTC connection is established before sending
    if (!activeNetworkProxy.isConnected(targetPodId)) {
      await activeNetworkProxy.connect(targetPodId);
    }

    const key = `${query.queryId}:${targetPodId}`;

    return new Promise<EphemeralResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingEphemeralResponses.delete(key);
        reject(new Error(`Ephemeral query to ${targetPodId} timed out`));
      }, query.timeout || 5_000);

      pendingEphemeralResponses.set(key, {
        resolve: (res) => { clearTimeout(timeout); resolve(res); },
        reject:  (err) => { clearTimeout(timeout); reject(err); },
      });

      try {
        activeNetworkProxy!.send(targetPodId, JSON.stringify({
          _ephemeral: true,
          type: 'query',
          ...query,
        }));
      } catch (err) {
        clearTimeout(timeout);
        pendingEphemeralResponses.delete(key);
        reject(err);
      }
    });
  }) as EphemeralTransport;
}
