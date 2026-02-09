/**
 * Pod Network Stack (Browser Runtime)
 *
 * Direct-to-orchestrator networking for pod Web Workers.
 * Each pod establishes its own WebSocket to the orchestrator for signaling,
 * then uses WebRTC for all inter-pod data traffic.
 *
 * Architecture:
 * - Pod → Orchestrator: WebSocket (routing requests, signaling relay)
 * - Pod ↔ Pod: WebRTC data channels (all service traffic)
 * - Orchestrator never touches data after handshake
 *
 * Browser-specific differences from Node.js runtime:
 * - Uses native WebSocket API (not 'ws' package)
 * - Uses native WebRTC (no 'wrtc' polyfill needed)
 * - Uses StarkBrowserListener for inbound requests (no http.createServer)
 *
 * @module @stark-o/browser-runtime/network/pod-network-stack
 */

import {
  WebRTCConnectionManager,
  ServiceCaller,
  createSimplePeerFactory,
  interceptFetch,
  restoreFetch,
  StarkBrowserListener,
  PodRequestRouter,
  type SignalSender,
  type OrchestratorRouter,
} from '@stark-o/shared';
import type {
  SignallingMessage,
  RoutingRequest,
  RoutingResponse,
  ServiceRequest,
  ServiceResponse,
  WsMessage,
} from '@stark-o/shared';

// ── Configuration ───────────────────────────────────────────────────────────

export interface BrowserPodNetworkConfig {
  /** Pod's unique ID */
  podId: string;
  /** Service this pod belongs to */
  serviceId: string;
  /** Orchestrator WebSocket URL (e.g., wss://localhost/ws) */
  orchestratorUrl: string;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeout?: number;
  /** Logger function */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;
}

// ── Browser Pod Network Stack ───────────────────────────────────────────────

/**
 * Complete networking stack for a pod running in a browser Web Worker.
 *
 * Handles:
 * 1. WebSocket connection to orchestrator (signaling + routing)
 * 2. WebRTC connections to peer pods (data)
 * 3. Fetch interception for transparent *.internal routing
 * 4. Inbound request handling via StarkBrowserListener
 */
export class BrowserPodNetworkStack {
  private readonly config: Required<Omit<BrowserPodNetworkConfig, 'log'>> & { log: NonNullable<BrowserPodNetworkConfig['log']> };
  private ws: WebSocket | null = null;
  private connectionManager: WebRTCConnectionManager | null = null;
  private serviceCaller: ServiceCaller | null = null;
  private browserListener: StarkBrowserListener | null = null;
  private requestRouter: PodRequestRouter | null = null;
  private connected = false;
  private pendingRoutes: Map<string, {
    resolve: (res: RoutingResponse) => void;
    reject: (err: Error) => void;
  }> = new Map();
  private routeCounter = 0;

  constructor(config: BrowserPodNetworkConfig) {
    this.config = {
      podId: config.podId,
      serviceId: config.serviceId,
      orchestratorUrl: config.orchestratorUrl,
      connectionTimeout: config.connectionTimeout ?? 10_000,
      log: config.log ?? ((level, msg, data) => {
        const prefix = `[${new Date().toISOString()}][${config.podId}:net:${level}]`;
        if (data) {
          console.log(prefix, msg, JSON.stringify(data));
        } else {
          console.log(prefix, msg);
        }
      }),
    };
  }

  /**
   * Initialize the network stack.
   * Opens WebSocket to orchestrator, sets up WebRTC manager, patches fetch.
   */
  async init(): Promise<void> {
    // 1. Connect to orchestrator
    await this.connectToOrchestrator();

    // 2. Set up WebRTC connection manager
    const signalSender: SignalSender = (message: SignallingMessage) => {
      this.sendToOrchestrator({
        type: 'network:signal',
        payload: message,
      });
    };

    // Browser uses native WebRTC — no wrtc polyfill needed
    this.connectionManager = new WebRTCConnectionManager({
      localPodId: this.config.podId,
      signalSender,
      onMessage: (fromPodId, data) => {
        this.handleIncomingData(fromPodId, data);
      },
      peerFactory: createSimplePeerFactory(), // No wrtc needed in browser
      config: {
        connectionTimeout: this.config.connectionTimeout,
        trickleICE: true,
        iceServers: [], // STUN/TURN can be configured here if needed
      },
    });

    // 3. Set up orchestrator router (for routing requests via WS)
    const orchestratorRouter: OrchestratorRouter = (request: RoutingRequest) => {
      return this.requestRouteFromOrchestrator(request);
    };

    // 4. Set up request router for inbound traffic
    this.requestRouter = new PodRequestRouter();

    // 5. Set up browser listener (for explicit handler registration)
    this.browserListener = new StarkBrowserListener(this.requestRouter);

    // 6. Set up service caller
    this.serviceCaller = new ServiceCaller({
      podId: this.config.podId,
      serviceId: this.config.serviceId,
      connectionManager: this.connectionManager,
      orchestratorRouter,
    });

    // 7. Intercept fetch() for transparent *.internal routing
    interceptFetch(this.serviceCaller);

    // 8. Register pod with orchestrator
    this.sendToOrchestrator({
      type: 'network:pod:register',
      payload: {
        podId: this.config.podId,
        serviceId: this.config.serviceId,
      },
    });
  }

  /**
   * Get the browser listener for registering inbound request handlers.
   * This is the browser equivalent of http.createServer() interception.
   *
   * @example
   * ```ts
   * const listen = stack.getBrowserListener();
   * listen.handle('/echo', async (method, path, body) => {
   *   return { status: 200, body: { message: 'Hello!' } };
   * });
   * ```
   */
  getBrowserListener(): StarkBrowserListener | null {
    return this.browserListener;
  }

  /**
   * Shut down the network stack cleanly.
   */
  async shutdown(): Promise<void> {
    // Restore fetch
    restoreFetch();

    // Close WebRTC connections
    this.connectionManager?.disconnectAll();

    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Pod shutdown');
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Get the service caller for manual use (if not using fetch interception).
   */
  getServiceCaller(): ServiceCaller | null {
    return this.serviceCaller;
  }

  /**
   * Get the connection manager for inspection.
   */
  getConnectionManager(): WebRTCConnectionManager | null {
    return this.connectionManager;
  }

  /**
   * Check if WebSocket is connected to orchestrator.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Log diagnostic information about the network stack state.
   * Call this to debug connectivity issues.
   */
  dumpDiagnostics(): void {
    this.config.log('info', '═══════════════════════════════════════════════════════════════');
    this.config.log('info', '📊 [Diagnostics] Browser Pod Network Stack State');
    this.config.log('info', '═══════════════════════════════════════════════════════════════');
    
    // Basic info
    this.config.log('info', '🆔 Pod Info', {
      podId: this.config.podId,
      serviceId: this.config.serviceId,
      orchestratorUrl: this.config.orchestratorUrl,
    });

    // WebSocket state
    const wsStates = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    this.config.log('info', '🔌 WebSocket State', {
      connected: this.connected,
      wsState: this.ws ? wsStates[this.ws.readyState] : 'null',
      wsReadyState: this.ws?.readyState,
    });

    // Pending routes
    this.config.log('info', '⏳ Pending Routes', {
      count: this.pendingRoutes.size,
      ids: Array.from(this.pendingRoutes.keys()),
    });

    // WebRTC connections
    if (this.connectionManager) {
      const connections = this.connectionManager.listConnections();
      this.config.log('info', '📡 WebRTC Connections', {
        totalConnections: connections.length,
        connections: connections.map((conn) => ({
          targetPodId: conn.targetPodId,
          state: conn.state,
          lastActivity: new Date(conn.lastActivity).toISOString(),
        })),
      });
    } else {
      this.config.log('warn', '📡 WebRTC Connection Manager not initialized');
    }

    // Browser listener state
    this.config.log('info', '🖥️ Browser Listener', {
      initialized: !!this.browserListener,
    });

    // Service caller
    this.config.log('info', '📞 Service Caller', {
      initialized: !!this.serviceCaller,
    });

    this.config.log('info', '═══════════════════════════════════════════════════════════════');
  }

  // ── WebSocket to Orchestrator ─────────────────────────────────────────────

  private connectToOrchestrator(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection to orchestrator timed out after ${this.config.connectionTimeout}ms`));
      }, this.config.connectionTimeout);

      // Browser uses native WebSocket API
      this.ws = new WebSocket(this.config.orchestratorUrl);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.connected = true;
        this.config.log('info', '✅ Connected to orchestrator');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = typeof event.data === 'string' ? event.data : '';
          const message = JSON.parse(data) as WsMessage;
          this.handleOrchestratorMessage(message);
        } catch (err) {
          this.config.log('warn', 'Failed to parse orchestrator message', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };

      this.ws.onerror = (event) => {
        this.config.log('error', 'WebSocket error', { event: String(event) });
        if (!this.connected) {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        }
      };

      this.ws.onclose = (event) => {
        this.connected = false;
        this.config.log('info', 'WebSocket closed', {
          code: event.code,
          reason: event.reason,
        });
        // Reject pending routes
        for (const [id, pending] of this.pendingRoutes) {
          pending.reject(new Error('Connection closed'));
          this.pendingRoutes.delete(id);
        }
      };
    });
  }

  private sendToOrchestrator(message: WsMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.config.log('warn', '⚠️ [WS] Cannot send — WebSocket not connected', {
        messageType: message.type,
        wsState: this.ws?.readyState,
      });
      return;
    }
    const json = JSON.stringify(message);
    this.ws.send(json);
  }

  private handleOrchestratorMessage(message: WsMessage): void {
    switch (message.type) {
      case 'network:signal': {
        // Incoming WebRTC signaling from another pod
        const signal = message.payload as SignallingMessage;
        if (signal && this.connectionManager) {
          this.connectionManager.handleSignal(signal);
        }
        break;
      }

      case 'network:route:response': {
        // Response to a routing request
        const correlationId = message.correlationId;
        if (correlationId && this.pendingRoutes.has(correlationId)) {
          const pending = this.pendingRoutes.get(correlationId)!;
          this.pendingRoutes.delete(correlationId);

          const payload = message.payload as RoutingResponse & { error?: string };
          if (payload.error) {
            this.config.log('warn', '⚠️ [Routing] Orchestrator returned error', {
              correlationId,
              error: payload.error,
            });
            pending.reject(new Error(payload.error));
          } else {
            pending.resolve(payload);
          }
        } else {
          this.config.log('warn', '⚠️ [Routing] Received route response for unknown correlationId', {
            correlationId,
          });
        }
        break;
      }
    }
  }

  private requestRouteFromOrchestrator(request: RoutingRequest): Promise<RoutingResponse> {
    return new Promise((resolve, reject) => {
      const correlationId = `route-${this.config.podId}-${++this.routeCounter}`;

      const timeout = setTimeout(() => {
        this.config.log('error', '⏱️ [Routing] Route request TIMED OUT', {
          correlationId,
          targetServiceId: request.targetServiceId,
          timeoutMs: this.config.connectionTimeout,
        });
        this.pendingRoutes.delete(correlationId);
        reject(new Error('Routing request timed out'));
      }, this.config.connectionTimeout);

      this.pendingRoutes.set(correlationId, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.sendToOrchestrator({
        type: 'network:route:request',
        payload: request,
        correlationId,
      });
    });
  }

  // ── Inbound Data Handling ─────────────────────────────────────────────────

  private handleIncomingData(fromPodId: string, data: string): void {
    try {
      const parsed = JSON.parse(data);

      // Check if it's a ServiceResponse (reply to our request)
      if (parsed.requestId && 'status' in parsed) {
        // It's a response — let the ServiceCaller handle it
        this.serviceCaller?.handleResponse(data);
        return;
      }

      // It's a ServiceRequest (inbound call from another pod)
      if (parsed.requestId && 'method' in parsed && 'path' in parsed) {
        const request = parsed as ServiceRequest;
        this.handleInboundRequest(request, fromPodId);
        return;
      }

      this.config.log('warn', '⚠️ [WebRTC] Unknown message format from peer', {
        fromPodId,
        keys: Object.keys(parsed),
        dataPreview: data.substring(0, 100),
      });
    } catch (err) {
      this.config.log('warn', '⚠️ [WebRTC] Failed to parse peer message', {
        fromPodId,
        error: err instanceof Error ? err.message : String(err),
        rawData: data.substring(0, 100),
      });
    }
  }

  private async handleInboundRequest(request: ServiceRequest, fromPodId: string): Promise<void> {
    let response: ServiceResponse;

    try {
      // Dispatch via browser listener (explicit handler registration)
      if (this.browserListener) {
        response = await this.browserListener.dispatch(request);
      } else {
        this.config.log('warn', '⚠️ [Dispatch] No browser listener available for request', {
          requestId: request.requestId,
          method: request.method,
          path: request.path,
        });
        response = {
          requestId: request.requestId,
          status: 503,
          body: { error: 'No handler available' },
        };
      }
    } catch (err) {
      this.config.log('error', '❌ [Dispatch] Handler threw exception', {
        requestId: request.requestId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      response = {
        requestId: request.requestId,
        status: 500,
        body: { error: err instanceof Error ? err.message : 'Internal error' },
      };
    }

    // Send response back via WebRTC
    try {
      const responseJson = JSON.stringify(response);
      this.connectionManager?.send(fromPodId, responseJson);
    } catch (err) {
      this.config.log('error', '❌ [WebRTC] Failed to send response', {
        requestId: request.requestId,
        to: fromPodId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
