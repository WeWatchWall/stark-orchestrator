/**
 * Pod Network Stack
 *
 * Direct-to-orchestrator networking for pod subprocesses.
 * Each pod establishes its own WebSocket to the orchestrator for signaling,
 * then uses WebRTC for all inter-pod data traffic.
 *
 * Architecture:
 * - Pod → Orchestrator: WebSocket (routing requests, signaling relay)
 * - Pod ↔ Pod: WebRTC data channels (all service traffic)
 * - Orchestrator never touches data after handshake
 *
 * @module @stark-o/node-runtime/network/pod-network-stack
 */

import WebSocket from 'ws';
import wrtc from 'wrtc';
import {
  WebRTCConnectionManager,
  ServiceCaller,
  createSimplePeerFactory,
  interceptFetch,
  restoreFetch,
  StarkServerInterceptor,
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

/** Token refresh threshold: 15 minutes before expiration */
export const TOKEN_REFRESH_THRESHOLD_MS = 15 * 60 * 1000;

/** Token refresh check interval: every 60 seconds */
const TOKEN_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;

export interface PodNetworkConfig {
  /** Pod's unique ID */
  podId: string;
  /** Service this pod belongs to */
  serviceId: string;
  /** Orchestrator WebSocket URL (e.g., wss://localhost/ws) */
  orchestratorUrl: string;
  /** Skip TLS verification (for dev) */
  insecure?: boolean;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeout?: number;
  /** Authentication token (required for authenticated connections) */
  authToken?: string;
  /** Refresh token for token renewal */
  refreshToken?: string;
  /** Token expiration timestamp (ISO string) */
  tokenExpiresAt?: string;
  /** Reconnect delay in milliseconds (default: 5000) */
  reconnectDelay?: number;
  /** Maximum reconnect attempts (default: 10, -1 for infinite) */
  maxReconnectAttempts?: number;
  /** Enable automatic reconnection (default: true) */
  autoReconnect?: boolean;
  /** Enable automatic token refresh (default: true) */
  autoTokenRefresh?: boolean;
  /** Callback when authentication fails */
  onAuthFailed?: (error: Error) => void;
  /** Callback when token is refreshed */
  onTokenRefreshed?: (newToken: string, newRefreshToken?: string, expiresAt?: string) => void;
  /** Callback for connection state changes */
  onStateChange?: (state: NetworkStackState) => void;
  /** Logger function */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;
}

/** Connection state for the network stack */
export type NetworkStackState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'authenticated'
  | 'registered'
  | 'reconnecting';

// ── Pod Network Stack ───────────────────────────────────────────────────────

/**
 * Complete networking stack for a pod subprocess.
 *
 * Handles:
 * 1. WebSocket connection to orchestrator (signaling + routing)
 * 2. Authentication with the orchestrator
 * 3. Automatic reconnection with exponential backoff
 * 4. Token refresh for long-running pods
 * 5. WebRTC connections to peer pods (data)
 * 6. Fetch interception for transparent *.internal routing
 * 7. Inbound request handling via StarkServerInterceptor
 */
export class PodNetworkStack {
  private readonly config: Required<Omit<PodNetworkConfig, 'log' | 'onAuthFailed' | 'onTokenRefreshed' | 'onStateChange' | 'authToken' | 'refreshToken' | 'tokenExpiresAt'>> & { 
    log: NonNullable<PodNetworkConfig['log']>;
    onAuthFailed?: PodNetworkConfig['onAuthFailed'];
    onTokenRefreshed?: PodNetworkConfig['onTokenRefreshed'];
    onStateChange?: PodNetworkConfig['onStateChange'];
  };
  private authToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: string | null = null;
  private ws: WebSocket | null = null;
  private connectionManager: WebRTCConnectionManager | null = null;
  private serviceCaller: ServiceCaller | null = null;
  private serverInterceptor: StarkServerInterceptor | null = null;
  private requestRouter: PodRequestRouter | null = null;
  private connected = false;
  private authenticated = false;
  private state: NetworkStackState = 'disconnected';
  private pendingRoutes: Map<string, {
    resolve: (res: RoutingResponse) => void;
    reject: (err: Error) => void;
  }> = new Map();
  private routeCounter = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;
  private isRefreshingToken = false;
  private initPromiseResolve: (() => void) | null = null;
  private initPromiseReject: ((err: Error) => void) | null = null;

  constructor(config: PodNetworkConfig) {
    this.config = {
      podId: config.podId,
      serviceId: config.serviceId,
      orchestratorUrl: config.orchestratorUrl,
      insecure: config.insecure ?? false,
      connectionTimeout: config.connectionTimeout ?? 10_000,
      reconnectDelay: config.reconnectDelay ?? 5_000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      autoReconnect: config.autoReconnect ?? true,
      autoTokenRefresh: config.autoTokenRefresh ?? true,
      onAuthFailed: config.onAuthFailed,
      onTokenRefreshed: config.onTokenRefreshed,
      onStateChange: config.onStateChange,
      log: config.log ?? ((level, msg, data) => {
        const prefix = `[${new Date().toISOString()}][${config.podId}:net:${level}]`;
        if (data) {
          console.log(prefix, msg, JSON.stringify(data));
        } else {
          console.log(prefix, msg);
        }
      }),
    };
    this.authToken = config.authToken ?? null;
    this.refreshToken = config.refreshToken ?? null;
    this.tokenExpiresAt = config.tokenExpiresAt ?? null;
  }

  /**
   * Get the current connection state
   */
  getState(): NetworkStackState {
    return this.state;
  }

  /**
   * Update the state and notify listeners
   */
  private setState(newState: NetworkStackState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.config.log('debug', `State changed to: ${newState}`);
      this.config.onStateChange?.(newState);
    }
  }

  /**
   * Update authentication credentials (e.g., after token refresh)
   */
  updateAuthCredentials(authToken: string, refreshToken?: string, expiresAt?: string): void {
    this.authToken = authToken;
    if (refreshToken !== undefined) {
      this.refreshToken = refreshToken;
    }
    if (expiresAt !== undefined) {
      this.tokenExpiresAt = expiresAt;
    }
    this.config.log('info', 'Auth credentials updated');
  }

  /**
   * Initialize the network stack.
   * Opens WebSocket to orchestrator, authenticates, sets up WebRTC manager, patches fetch.
   */
  async init(): Promise<void> {
    this.isShuttingDown = false;
    this.reconnectAttempts = 0;

    // 1. Connect to orchestrator (includes authentication)
    await this.connectToOrchestrator();

    // 2. Start token refresh timer if enabled and we have credentials
    if (this.config.autoTokenRefresh && this.refreshToken) {
      this.startTokenRefresh();
    }

    // 3. Set up WebRTC connection manager
    const signalSender: SignalSender = (message: SignallingMessage) => {
      this.sendToOrchestrator({
        type: 'network:signal',
        payload: message,
      });
    };


    this.connectionManager = new WebRTCConnectionManager({
      localPodId: this.config.podId,
      signalSender,
      onMessage: (fromPodId, data) => {
        this.handleIncomingData(fromPodId, data);
      },
      peerFactory: createSimplePeerFactory({ wrtc }),
      config: {
        connectionTimeout: this.config.connectionTimeout,
        trickleICE: true,
        iceServers: [], // STUN/TURN can be configured here if needed
      },
    });

    // 4. Set up orchestrator router (for routing requests via WS)
    const orchestratorRouter: OrchestratorRouter = (request: RoutingRequest) => {
      return this.requestRouteFromOrchestrator(request);
    };

    // 5. Set up request router for inbound traffic
    this.requestRouter = new PodRequestRouter();

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
        authToken: this.authToken ?? undefined,
      },
    });

    this.setState('registered');
    this.config.log('info', '✅ Network stack initialized and registered');
  }

  /**
   * Install HTTP server interceptor for inbound requests.
   * Call this BEFORE the pack code runs to capture http.createServer calls.
   */
  installServerInterceptor(httpModule: typeof import('http')): void {
    if (!this.requestRouter) {
      throw new Error('Network stack not initialized — call init() first');
    }
    this.serverInterceptor = new StarkServerInterceptor(this.requestRouter);
    // Cast is safe: Node's http module implements the required interface
    this.serverInterceptor.install(httpModule as unknown as Parameters<typeof this.serverInterceptor.install>[0]);
  }

  /**
   * Install HTTPS server interceptor for inbound requests.
   * Call this BEFORE the pack code runs to capture https.createServer calls.
   */
  installHttpsServerInterceptor(httpsModule: typeof import('https')): void {
    if (!this.serverInterceptor) {
      throw new Error('HTTP server interceptor not installed — call installServerInterceptor() first');
    }
    // Cast is safe: Node's https module implements the required interface
    this.serverInterceptor.installHttps(httpsModule as unknown as Parameters<typeof this.serverInterceptor.installHttps>[0]);
  }

  /**
   * Register a request handler for inbound traffic (non-HTTP server packs).
   */
  registerHandler(pathPrefix: string, handler: (req: ServiceRequest) => Promise<ServiceResponse>): void {
    if (!this.requestRouter) {
      throw new Error('Network stack not initialized — call init() first');
    }
    this.requestRouter.handle(pathPrefix, async (method: string, path: string, body: unknown, headers?: Record<string, string>) => {
      // Wrap into ServiceRequest for handler
      const req: ServiceRequest = {
        requestId: `inbound-${Date.now()}`,
        sourcePodId: 'unknown',
        sourceServiceId: 'unknown',
        targetPodId: this.config.podId,
        targetServiceId: this.config.serviceId,
        method: method as ServiceRequest['method'],
        path,
        body,
        headers,
      };
      const res = await handler(req);
      return { status: res.status, body: res.body, headers: res.headers };
    });
  }

  /**
   * Shut down the network stack cleanly.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Stop token refresh
    this.stopTokenRefresh();

    // Cancel pending reconnection
    this.cancelReconnect();

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
    this.authenticated = false;
    this.setState('disconnected');
    this.config.log('info', 'Network stack shut down');
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
   * Check if connected to orchestrator.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Check if authenticated with orchestrator.
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * Log diagnostic information about the network stack state.
   * Call this to debug connectivity issues.
   */
  dumpDiagnostics(): void {
    this.config.log('info', '═══════════════════════════════════════════════════════════════');
    this.config.log('info', '📊 [Diagnostics] Pod Network Stack State');
    this.config.log('info', '═══════════════════════════════════════════════════════════════');
    
    // Basic info
    this.config.log('info', '🆔 Pod Info', {
      podId: this.config.podId,
      serviceId: this.config.serviceId,
      orchestratorUrl: this.config.orchestratorUrl,
    });

    // Connection state
    this.config.log('info', '📡 Connection State', {
      state: this.state,
      connected: this.connected,
      authenticated: this.authenticated,
      reconnectAttempts: this.reconnectAttempts,
      hasAuthToken: !!this.authToken,
      hasRefreshToken: !!this.refreshToken,
      tokenExpiresAt: this.tokenExpiresAt,
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

    // Server interceptor state
    this.config.log('info', '🖥️ Server Interceptor', {
      installed: !!this.serverInterceptor,
      hasCapturedServers: this.serverInterceptor?.hasCapturedServers ?? false,
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
      this.setState('connecting');
      
      const timeout = setTimeout(() => {
        reject(new Error(`Connection to orchestrator timed out after ${this.config.connectionTimeout}ms`));
      }, this.config.connectionTimeout);

      const wsOptions: WebSocket.ClientOptions = {};
      if (this.config.insecure) {
        wsOptions.rejectUnauthorized = false;
      }

      this.ws = new WebSocket(this.config.orchestratorUrl, wsOptions);

      // Store resolve/reject for authentication flow
      this.initPromiseResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.initPromiseReject = (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      };

      this.ws.on('open', () => {
        this.connected = true;
        this.setState('connected');
        this.config.log('info', '✅ WebSocket connected to orchestrator');
        // Pod authentication happens via network:pod:register (with pod token),
        // NOT via auth:authenticate (which is for Supabase JWT control-plane agents).
        // Resolve immediately so init() can proceed to send network:pod:register.
        this.initPromiseResolve?.();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as WsMessage;
          this.handleOrchestratorMessage(message);
        } catch (err) {
          this.config.log('warn', 'Failed to parse orchestrator message', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      this.ws.on('error', (err) => {
        this.config.log('error', 'WebSocket error', { error: err.message });
        if (!this.connected) {
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.handleClose(code, reason.toString());
      });
    });
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, reason: string): void {
    this.config.log('info', 'WebSocket closed', { code, reason });
    
    this.connected = false;
    this.authenticated = false;
    
    // Reject pending routes
    for (const [id, pending] of this.pendingRoutes) {
      pending.reject(new Error('Connection closed'));
      this.pendingRoutes.delete(id);
    }

    // If we were in the middle of initial connection, reject
    if (this.initPromiseReject && this.state !== 'registered') {
      this.initPromiseReject(new Error(`Connection closed: ${code} ${reason}`));
      this.initPromiseResolve = null;
      this.initPromiseReject = null;
    }

    this.setState('disconnected');

    // Attempt reconnection if enabled and not shutting down
    if (this.config.autoReconnect && !this.isShuttingDown) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;

    if (
      this.config.maxReconnectAttempts !== -1 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.config.log('error', 'Max reconnect attempts reached, giving up', {
        attempts: this.reconnectAttempts,
        maxAttempts: this.config.maxReconnectAttempts,
      });
      return;
    }

    this.reconnectAttempts++;
    // Linear backoff capped at 5x base delay (same as control plane)
    const delay = this.config.reconnectDelay * Math.min(this.reconnectAttempts, 5);

    this.config.log('info', 'Scheduling reconnect', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
      delay,
    });

    this.setState('reconnecting');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.reconnect();
      } catch (error) {
        this.config.log('error', 'Reconnect failed', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Cancel pending reconnection
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Reconnect to orchestrator and re-register
   */
  private async reconnect(): Promise<void> {
    this.config.log('info', 'Attempting reconnect...');

    await this.connectToOrchestrator();

    // Re-register with orchestrator
    this.sendToOrchestrator({
      type: 'network:pod:register',
      payload: {
        podId: this.config.podId,
        serviceId: this.config.serviceId,
        authToken: this.authToken ?? undefined,
      },
    });

    this.setState('registered');
    this.reconnectAttempts = 0; // Reset on successful reconnection
    this.config.log('info', '✅ Reconnected and re-registered');
  }

  // ── Token Refresh ─────────────────────────────────────────────────────────

  /**
   * Start the token refresh timer
   */
  private startTokenRefresh(): void {
    this.stopTokenRefresh();

    // Check immediately if we need to refresh
    void this.checkAndRefreshToken();

    // Then check periodically
    this.tokenRefreshTimer = setInterval(() => {
      void this.checkAndRefreshToken();
    }, TOKEN_REFRESH_CHECK_INTERVAL_MS);

    this.config.log('debug', 'Token refresh timer started');
  }

  /**
   * Stop the token refresh timer
   */
  private stopTokenRefresh(): void {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  private async checkAndRefreshToken(): Promise<void> {
    if (this.isShuttingDown || this.isRefreshingToken) {
      return;
    }

    // Check if we should refresh based on time remaining
    if (!this.shouldRefreshToken()) {
      return;
    }

    if (!this.refreshToken) {
      this.config.log('warn', 'Token needs refresh but no refresh token available');
      return;
    }

    await this.refreshTokenNow();
  }

  /**
   * Check if we should refresh the token
   */
  private shouldRefreshToken(): boolean {
    if (!this.tokenExpiresAt) {
      return false;
    }

    const expiresAt = new Date(this.tokenExpiresAt).getTime();
    const now = Date.now();
    const timeRemaining = expiresAt - now;

    return timeRemaining > 0 && timeRemaining <= TOKEN_REFRESH_THRESHOLD_MS;
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshTokenNow(): Promise<boolean> {
    if (this.isRefreshingToken || !this.refreshToken) {
      return false;
    }

    this.isRefreshingToken = true;
    this.config.log('info', 'Refreshing access token...');

    try {
      const httpUrl = this.config.orchestratorUrl
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/ws\/?$/, '');

      const response = await fetch(`${httpUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });

      interface RefreshResponse {
        success: boolean;
        data?: {
          accessToken: string;
          refreshToken?: string;
          expiresAt: string;
        };
        error?: { code: string; message: string };
      }

      const result = await response.json() as RefreshResponse;

      if (!result.success || !result.data) {
        this.config.log('error', 'Token refresh failed', {
          error: result.error?.message ?? 'Unknown error',
        });
        return false;
      }

      // Update credentials
      this.authToken = result.data.accessToken;
      if (result.data.refreshToken) {
        this.refreshToken = result.data.refreshToken;
      }
      this.tokenExpiresAt = result.data.expiresAt;

      // Notify callback
      this.config.onTokenRefreshed?.(
        result.data.accessToken,
        result.data.refreshToken,
        result.data.expiresAt
      );

      this.config.log('info', 'Access token refreshed successfully', {
        expiresAt: this.tokenExpiresAt,
      });

      return true;
    } catch (error) {
      this.config.log('error', 'Token refresh error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      this.isRefreshingToken = false;
    }
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
      case 'network:pod:register:ack': {
        // Pod registration confirmed by orchestrator
        this.authenticated = true;
        this.config.log('info', '✅ Pod registered and authenticated with orchestrator');
        break;
      }

      case 'network:pod:register:error': {
        // Pod registration rejected
        const payload = message.payload as { code?: string; message?: string };
        const error = new Error(payload.message ?? 'Pod registration failed');
        this.config.log('error', '❌ Pod registration failed', { 
          code: payload.code, 
          message: payload.message 
        });
        
        // Notify callback
        this.config.onAuthFailed?.(error);
        break;
      }

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

      case 'ingress:request': {
        // Incoming HTTP request proxied through the orchestrator's ingress port
        const correlationId = message.correlationId;
        const payload = message.payload as {
          serviceId: string;
          podId: string;
          method: string;
          url: string;
          headers?: Record<string, string>;
          body?: string;
        };

        if (!correlationId || !payload) {
          this.config.log('warn', '⚠️ [Ingress] Malformed ingress:request — missing correlationId or payload');
          break;
        }

        this.config.log('debug', '📥 [Ingress] Received ingress request', {
          correlationId,
          method: payload.method,
          url: payload.url,
          podId: payload.podId,
        });

        // Build a ServiceRequest so we can reuse handleInboundRequest's dispatch logic
        const syntheticRequest: ServiceRequest = {
          requestId: correlationId,
          sourcePodId: 'ingress',
          sourceServiceId: 'ingress',
          targetPodId: this.config.podId,
          targetServiceId: this.config.serviceId,
          method: (payload.method ?? 'GET') as ServiceRequest['method'],
          path: payload.url ?? '/',
          headers: payload.headers,
          body: payload.body,
        };

        // Dispatch and send the response back via WS (not WebRTC)
        this.handleIngressRequest(syntheticRequest, correlationId).catch((err) => {
          this.config.log('error', '❌ [Ingress] Failed to handle ingress request', {
            correlationId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
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
      // Dispatch via server interceptor (if HTTP server captured) or request router
      if (this.serverInterceptor?.hasCapturedServers) {
        // Forward to captured HTTP server via loopback
        const http = await import('http');
        const result = await this.serverInterceptor.dispatch(
          request,
          http as unknown as Parameters<typeof this.serverInterceptor.dispatch>[1]
        );
        response = result;
      } else if (this.requestRouter) {
        // Use explicit handlers
        const result = await this.requestRouter.dispatch(
          request.method,
          request.path,
          request.body,
          request.headers,
        );
        response = {
          requestId: request.requestId,
          status: result.status,
          body: result.body,
          headers: result.headers,
        };
      } else {
        this.config.log('warn', '⚠️ [Dispatch] No handler available for request', {
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

  /**
   * Handle an ingress request from the orchestrator.
   * Similar to handleInboundRequest but sends the response back via WS
   * (as `ingress:response`) instead of WebRTC.
   */
  private async handleIngressRequest(request: ServiceRequest, correlationId: string): Promise<void> {
    let response: ServiceResponse;

    try {
      if (this.serverInterceptor?.hasCapturedServers) {
        const http = await import('http');
        const result = await this.serverInterceptor.dispatch(
          request,
          http as unknown as Parameters<typeof this.serverInterceptor.dispatch>[1]
        );
        response = result;
      } else if (this.requestRouter) {
        const result = await this.requestRouter.dispatch(
          request.method,
          request.path,
          request.body,
          request.headers,
        );
        response = {
          requestId: request.requestId,
          status: result.status,
          body: result.body,
          headers: result.headers,
        };
      } else {
        this.config.log('warn', '⚠️ [Ingress] No handler available for request', {
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
      this.config.log('error', '❌ [Ingress] Handler threw exception', {
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

    // Send response back to orchestrator via WS as ingress:response
    const bodyStr = typeof response.body === 'string'
      ? response.body
      : JSON.stringify(response.body ?? '');

    this.sendToOrchestrator({
      type: 'ingress:response',
      correlationId,
      payload: {
        status: response.status,
        headers: response.headers,
        body: bodyStr,
      },
    });

    this.config.log('debug', '📤 [Ingress] Sent ingress response', {
      correlationId,
      status: response.status,
    });
  }
}
