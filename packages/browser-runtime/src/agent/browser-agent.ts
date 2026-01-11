/**
 * Browser Agent
 * @module @stark-o/browser-runtime/agent/browser-agent
 *
 * Agent that runs in browsers to register with the orchestrator,
 * send heartbeats, and receive pod deployment commands.
 */

import type {
  RegisterNodeInput,
  NodeHeartbeat,
  Node,
  RuntimeType,
  AllocatableResources,
  NodeCapabilities,
} from '@stark-o/shared';
import type { Labels, Annotations } from '@stark-o/shared';
import type { Taint } from '@stark-o/shared';

/**
 * WebSocket message structure
 */
interface WsMessage<T = unknown> {
  type: string;
  payload: T;
  correlationId?: string;
}

/**
 * Browser agent configuration
 */
export interface BrowserAgentConfig {
  /** Orchestrator WebSocket URL (e.g., ws://localhost:3000/ws) */
  orchestratorUrl: string;
  /** Authentication token */
  authToken: string;
  /** Node name (must be unique) */
  nodeName: string;
  /** Runtime type (always 'browser' for this agent) */
  runtimeType?: RuntimeType;
  /** Node capabilities */
  capabilities?: NodeCapabilities;
  /** Allocatable resources */
  allocatable?: Partial<AllocatableResources>;
  /** Node labels */
  labels?: Labels;
  /** Node annotations */
  annotations?: Annotations;
  /** Node taints */
  taints?: Taint[];
  /** Heartbeat interval in milliseconds (default: 15000) */
  heartbeatInterval?: number;
  /** Reconnect delay in milliseconds (default: 5000) */
  reconnectDelay?: number;
  /** Maximum reconnect attempts (default: 10, -1 for infinite) */
  maxReconnectAttempts?: number;
  /** Enable debug logging to console (default: false) */
  debug?: boolean;
}

/**
 * Browser agent events
 */
export type BrowserAgentEvent =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'registered'
  | 'heartbeat'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'stopped';

/**
 * Event handler type
 */
export type BrowserAgentEventHandler = (event: BrowserAgentEvent, data?: unknown) => void;

/**
 * Connection state
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticating'
  | 'authenticated'
  | 'registering'
  | 'registered';

/**
 * Default allocatable resources for browser runtime
 */
const DEFAULT_BROWSER_ALLOCATABLE: AllocatableResources = {
  cpu: 500,     // 0.5 CPU core (browser is typically limited)
  memory: 512,  // 512 MB (constrained by browser memory limits)
  pods: 5,      // 5 concurrent pods (Web Workers)
  storage: 100, // 100 MB (IndexedDB quota)
};

/**
 * Get browser version from user agent
 */
function getBrowserVersion(): string {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }
  return navigator.userAgent;
}

/**
 * Generate UUID using browser crypto API
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Simple browser-compatible logger
 */
interface BrowserLogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

function createBrowserLogger(component: string, debug: boolean): BrowserLogger {
  const prefix = `[${component}]`;

  const formatMessage = (level: string, message: string, meta?: Record<string, unknown>): string => {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level.toUpperCase()} ${prefix} ${message}${metaStr}`;
  };

  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (debug) console.debug(formatMessage('debug', message, meta));
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      console.info(formatMessage('info', message, meta));
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      console.warn(formatMessage('warn', message, meta));
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      console.error(formatMessage('error', message, meta));
    },
  };
}

/**
 * Browser Agent
 *
 * Manages the connection between a browser runtime and the orchestrator.
 * Handles:
 * - WebSocket connection and reconnection
 * - Authentication with the orchestrator
 * - Node registration
 * - Periodic heartbeats
 * - Resource reporting
 */
export class BrowserAgent {
  private readonly config: Required<Omit<BrowserAgentConfig, 'debug'>> & { debug: boolean };
  private readonly logger: BrowserLogger;
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private connectionId: string | null = null;
  private state: ConnectionState = 'disconnected';
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: number;
  }>();
  private eventHandlers: Set<BrowserAgentEventHandler> = new Set();
  private allocatedResources: AllocatableResources = {
    cpu: 0,
    memory: 0,
    pods: 0,
    storage: 0,
  };

  constructor(config: BrowserAgentConfig) {
    const debug = config.debug ?? false;

    this.config = {
      orchestratorUrl: config.orchestratorUrl,
      authToken: config.authToken,
      nodeName: config.nodeName,
      runtimeType: config.runtimeType ?? 'browser',
      capabilities: config.capabilities ?? { version: getBrowserVersion() },
      allocatable: { ...DEFAULT_BROWSER_ALLOCATABLE, ...config.allocatable },
      labels: config.labels ?? {},
      annotations: config.annotations ?? {},
      taints: config.taints ?? [],
      heartbeatInterval: config.heartbeatInterval ?? 15000,
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      debug,
    };

    this.logger = createBrowserLogger('browser-agent', debug);
  }

  /**
   * Get the current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get the registered node ID
   */
  getNodeId(): string | null {
    return this.nodeId;
  }

  /**
   * Get the connection ID
   */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /**
   * Check if the agent is connected and registered
   */
  isRegistered(): boolean {
    return this.state === 'registered';
  }

  /**
   * Add an event handler
   */
  on(handler: BrowserAgentEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Remove an event handler
   */
  off(handler: BrowserAgentEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: BrowserAgentEvent, data?: unknown): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event, data);
      } catch (error) {
        this.logger.error('Event handler error', { event, error: String(error) });
      }
    }
  }

  /**
   * Start the agent - connect, authenticate, register, and begin heartbeats
   */
  async start(): Promise<void> {
    if (this.state !== 'disconnected') {
      throw new Error(`Cannot start agent in state: ${this.state}`);
    }

    this.isShuttingDown = false;
    this.reconnectAttempts = 0;

    await this.connect();
  }

  /**
   * Stop the agent - disconnect and cleanup
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHeartbeat();
    this.cancelReconnect();
    this.clearPendingRequests('Agent stopped');

    if (this.ws) {
      this.ws.close(1000, 'Agent stopped');
      this.ws = null;
    }

    this.state = 'disconnected';
    this.nodeId = null;
    this.connectionId = null;

    this.emit('stopped');
    this.logger.info('Browser agent stopped');
  }

  /**
   * Update allocated resources (called when pods are added/removed)
   */
  updateAllocatedResources(resources: Partial<AllocatableResources>): void {
    this.allocatedResources = {
      ...this.allocatedResources,
      ...resources,
    };
  }

  /**
   * Connect to the orchestrator
   */
  private async connect(): Promise<void> {
    if (this.isShuttingDown) return;

    this.state = 'connecting';
    this.emit('connecting');
    this.logger.info('Connecting to orchestrator', {
      url: this.config.orchestratorUrl,
    });

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.orchestratorUrl);

        this.ws.onopen = () => {
          this.state = 'connected';
          this.reconnectAttempts = 0;
          this.emit('connected');
          this.logger.info('Connected to orchestrator');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          this.handleClose(event.code, event.reason);
        };

        this.ws.onerror = () => {
          const error = new Error('WebSocket error');
          this.logger.error('WebSocket error', { error: 'Connection error' });
          this.emit('error', error);
          reject(error);
        };

      } catch (error) {
        this.logger.error('Failed to create WebSocket connection', { error: String(error) });
        this.emit('error', error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(data: string | ArrayBuffer | Blob): Promise<void> {
    let messageData: string;

    if (typeof data === 'string') {
      messageData = data;
    } else if (data instanceof ArrayBuffer) {
      messageData = new TextDecoder().decode(data);
    } else if (data instanceof Blob) {
      messageData = await data.text();
    } else {
      this.logger.error('Unknown message data type');
      return;
    }

    let message: WsMessage;
    try {
      message = JSON.parse(messageData);
    } catch {
      this.logger.error('Failed to parse message', { data: messageData });
      return;
    }

    this.logger.debug('Received message', {
      type: message.type,
      correlationId: message.correlationId,
    });

    // Handle correlation-based responses
    if (message.correlationId && this.pendingRequests.has(message.correlationId)) {
      const pending = this.pendingRequests.get(message.correlationId)!;
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.correlationId);

      // Check for error responses
      if (message.type.endsWith(':error')) {
        pending.reject(message.payload);
      } else {
        pending.resolve(message.payload);
      }
      return;
    }

    // Handle server-initiated messages
    switch (message.type) {
      case 'connected':
        // Server sends this on connection, start authentication
        this.connectionId = (message.payload as { connectionId?: string })?.connectionId ?? null;
        await this.authenticate();
        break;

      case 'ping':
        this.send({ type: 'pong', payload: { timestamp: Date.now() } });
        break;

      case 'disconnect':
        this.logger.info('Server requested disconnect', { payload: message.payload });
        break;

      default:
        this.logger.debug('Unhandled message type', { type: message.type });
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, reason: string): void {
    this.logger.info('WebSocket closed', { code, reason });
    this.stopHeartbeat();
    this.clearPendingRequests('Connection closed');

    const wasRegistered = this.state === 'registered';
    this.state = 'disconnected';
    this.ws = null;
    this.nodeId = null;
    this.connectionId = null;

    this.emit('disconnected', { code, reason, wasRegistered });

    // Attempt reconnection if not shutting down
    if (!this.isShuttingDown) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;

    if (
      this.config.maxReconnectAttempts !== -1 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.logger.error('Max reconnect attempts reached, giving up');
      this.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.min(this.reconnectAttempts, 5);

    this.logger.info('Scheduling reconnect', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
      delay,
    });

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = window.setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        this.logger.error('Reconnect failed', { error: String(error) });
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Cancel pending reconnection
   */
  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Authenticate with the orchestrator
   */
  private async authenticate(): Promise<void> {
    this.state = 'authenticating';
    this.logger.info('Authenticating with orchestrator');

    try {
      await this.sendRequest<{ userId: string }>('auth:authenticate', {
        token: this.config.authToken,
      });

      this.state = 'authenticated';
      this.emit('authenticated');
      this.logger.info('Authenticated successfully');

      // Proceed to registration
      await this.register();
    } catch (error) {
      this.logger.error('Authentication failed', { error: String(error) });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Register the node with the orchestrator
   */
  private async register(): Promise<void> {
    this.state = 'registering';
    this.logger.info('Registering node', { nodeName: this.config.nodeName });

    const registerInput: RegisterNodeInput = {
      name: this.config.nodeName,
      runtimeType: this.config.runtimeType,
      capabilities: this.config.capabilities,
      allocatable: this.config.allocatable,
      labels: this.config.labels,
      annotations: this.config.annotations,
      taints: this.config.taints,
    };

    try {
      const response = await this.sendRequest<{ node: Node }>('node:register', registerInput);
      this.nodeId = response.node.id;

      this.state = 'registered';
      this.emit('registered', response.node);
      this.logger.info('Node registered', {
        nodeId: this.nodeId,
        nodeName: this.config.nodeName,
      });

      // Start heartbeat
      this.startHeartbeat();
    } catch (error) {
      this.logger.error('Registration failed', { error: String(error) });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start the heartbeat timer
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = window.setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    // Send initial heartbeat
    this.sendHeartbeat();
  }

  /**
   * Stop the heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send a heartbeat to the orchestrator
   */
  private async sendHeartbeat(): Promise<void> {
    if (!this.nodeId || this.state !== 'registered') {
      return;
    }

    const heartbeat: NodeHeartbeat = {
      nodeId: this.nodeId,
      status: 'online',
      allocated: this.allocatedResources,
      timestamp: new Date(),
    };

    try {
      await this.sendRequest<{ nodeId: string; lastHeartbeat: string }>(
        'node:heartbeat',
        heartbeat,
      );
      this.emit('heartbeat');
      this.logger.debug('Heartbeat sent', { nodeId: this.nodeId });
    } catch (error) {
      this.logger.error('Heartbeat failed', { error: String(error), nodeId: this.nodeId });
      // Don't emit error for heartbeat failures, the connection close will handle reconnect
    }
  }

  /**
   * Send a message over WebSocket
   */
  private send(message: WsMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send a request and wait for response
   */
  private sendRequest<T>(type: string, payload: unknown, timeout = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      const correlationId = generateUUID();

      const timeoutHandle = window.setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Request timeout: ${type}`));
      }, timeout);

      this.pendingRequests.set(correlationId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      try {
        this.send({ type, payload, correlationId });
      } catch (error) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(correlationId);
        reject(error);
      }
    });
  }

  /**
   * Clear all pending requests with an error
   */
  private clearPendingRequests(reason: string): void {
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}

/**
 * Create a new BrowserAgent instance
 */
export function createBrowserAgent(config: BrowserAgentConfig): BrowserAgent {
  return new BrowserAgent(config);
}
