/**
 * Browser Agent
 * @module @stark-o/browser-runtime/agent/browser-agent
 *
 * Agent that runs in browsers to register with the orchestrator,
 * send heartbeats, and receive pod deployment commands.
 */

import {
  mapLocalStatusToPodStatus,
  type RegisterNodeInput,
  type NodeHeartbeat,
  type Node,
  type RuntimeType,
  type AllocatableResources,
  type NodeCapabilities,
  type LocalPodStatus,
  type Labels,
  type Annotations,
  type Taint,
  type PodDeployPayload,
  type PodStopPayload,
  type WsMessage,
} from '@stark-o/shared';
import { PodHandler, createPodHandler } from './pod-handler.js';
import { PackExecutor } from '../executor/pack-executor.js';
import {
  BrowserStateStore,
  createBrowserStateStore,
  type RegisteredBrowserNode,
  type BrowserNodeCredentials,
} from './browser-state-store.js';

/**
 * Browser agent configuration
 */
export interface BrowserAgentConfig {
  /** Orchestrator WebSocket URL (e.g., wss://localhost:443/ws) */
  orchestratorUrl: string;
  /** Authentication token (optional if autoRegister is true or using stored credentials) */
  authToken?: string;
  /** Node name (must be unique) */
  nodeName: string;
  /** Automatically register a user if no auth token provided and registration is open (default: true) */
  autoRegister?: boolean;
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
  /** Metrics reporting interval in milliseconds (default: 30000) */
  metricsInterval?: number;
  /** Reconnect delay in milliseconds (default: 5000) */
  reconnectDelay?: number;
  /** Maximum reconnect attempts (default: 10, -1 for infinite) */
  maxReconnectAttempts?: number;
  /** Base path for pack bundles in storage (default: '/packs') */
  bundlePath?: string;
  /** Enable debug logging to console (default: false) */
  debug?: boolean;
  /** Enable persistent storage of node registration (default: true) */
  persistState?: boolean;
  /** Automatically resume an existing node with the same name (default: true) */
  resumeExisting?: boolean;
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
  | 'credentials_invalid'
  | 'stopped'
  | 'pod:deployed'
  | 'pod:started'
  | 'pod:stopped'
  | 'pod:failed';

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
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
 * - Node registration and reconnection
 * - Periodic heartbeats
 * - Resource reporting
 * - Pod deployment and lifecycle
 * - Persistent storage of node state for resumption
 */
export class BrowserAgent {
  private readonly config: Required<Omit<BrowserAgentConfig, 'debug' | 'bundlePath' | 'authToken' | 'autoRegister'>> & { 
    debug: boolean;
    bundlePath: string;
    autoRegister: boolean;
  };
  private authToken: string;
  private readonly logger: BrowserLogger;
  private readonly stateStore: BrowserStateStore;
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private connectionId: string | null = null;
  private state: ConnectionState = 'disconnected';
  private heartbeatTimer: number | null = null;
  private metricsTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private tokenRefreshTimer: number | null = null;
  private reconnectAttempts = 0;
  private authRetryCount = 0;
  private isShuttingDown = false;
  private isRefreshingToken = false;
  private startTime: number = Date.now();
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
  private executor: PackExecutor;
  private podHandler: PodHandler;

  constructor(config: BrowserAgentConfig) {
    const debug = config.debug ?? false;

    this.config = {
      orchestratorUrl: config.orchestratorUrl,
      nodeName: config.nodeName,
      runtimeType: config.runtimeType ?? 'browser',
      capabilities: config.capabilities ?? { version: getBrowserVersion() },
      allocatable: { ...DEFAULT_BROWSER_ALLOCATABLE, ...config.allocatable },
      labels: config.labels ?? {},
      annotations: config.annotations ?? {},
      taints: config.taints ?? [],
      heartbeatInterval: config.heartbeatInterval ?? 15000,
      metricsInterval: config.metricsInterval ?? 30000,
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      bundlePath: config.bundlePath ?? '/packs',
      debug,
      autoRegister: config.autoRegister ?? true,
      persistState: config.persistState ?? true,
      resumeExisting: config.resumeExisting ?? true,
    };

    this.authToken = config.authToken ?? '';
    this.logger = createBrowserLogger('browser-agent', debug);
    
    // Initialize state store for persistent storage
    this.stateStore = createBrowserStateStore(config.orchestratorUrl);

    // Try to load existing node registration if resumeExisting is enabled
    if (this.config.resumeExisting) {
      const existingNode = this.stateStore.getNode(this.config.nodeName);
      if (existingNode) {
        this.nodeId = existingNode.nodeId;
        this.logger.info('Found existing node registration', {
          nodeName: this.config.nodeName,
          nodeId: this.nodeId,
          registeredAt: existingNode.registeredAt,
        });
      }
    }

    // Initialize pack executor (authToken will be updated after auto-registration if needed)
    this.executor = new PackExecutor({
      bundlePath: this.config.bundlePath,
      orchestratorUrl: this.config.orchestratorUrl.replace(/^ws/, 'http').replace('/ws', ''),
      authToken: this.authToken,
    });

    // Initialize pod handler
    this.podHandler = createPodHandler({
      executor: this.executor,
      onStatusChange: (podId, status, message) => {
        this.handlePodStatusChange(podId, status, message);
      },
    });
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

    // Initialize the pack executor before connecting
    await this.executor.initialize();

    // Start token refresh timer to keep credentials fresh
    this.startTokenRefresh();

    await this.connect();
  }

  /**
   * Stop the agent - disconnect and cleanup
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHeartbeat();
    this.stopMetricsCollection();
    this.stopTokenRefresh();
    this.cancelReconnect();
    this.clearPendingRequests('Agent stopped');

    // Stop all running pods
    await this.podHandler.stopAll();

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

    // Clean up any existing WebSocket before creating a new one
    if (this.ws) {
      this.logger.debug('Cleaning up existing WebSocket before reconnect');
      try {
        // Remove event handlers to prevent triggering handleClose again
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        // Close if not already closed
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        // Ignore errors during cleanup
      }
      this.ws = null;
    }

    this.state = 'connecting';
    this.emit('connecting');
    this.logger.info('Connecting to orchestrator', {
      url: this.config.orchestratorUrl,
    });

    return new Promise((resolve, reject) => {
      let settled = false;

      try {
        // Add a cache-busting query parameter to prevent connection reuse issues
        const wsUrl = new URL(this.config.orchestratorUrl);
        wsUrl.searchParams.set('_t', Date.now().toString());
        const urlWithCacheBuster = wsUrl.toString();
        
        this.logger.info('Creating new WebSocket', { url: urlWithCacheBuster });
        this.ws = new WebSocket(urlWithCacheBuster);
        this.logger.debug('WebSocket created, waiting for open', { 
          readyState: this.ws.readyState,
          url: this.ws.url 
        });

        this.ws.onopen = () => {
          this.logger.debug('WebSocket onopen fired');
          if (settled) return;
          settled = true;
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
          this.logger.debug('WebSocket onclose fired', { 
            code: event.code, 
            reason: event.reason,
            wasClean: event.wasClean,
            settled 
          });
          if (!settled) {
            settled = true;
            reject(new Error(`WebSocket closed during connection: ${event.code}`));
          }
          this.handleClose(event.code, event.reason);
        };

        this.ws.onerror = (event) => {
          // Note: onerror is always followed by onclose, so we let onclose handle the rejection
          // to avoid double-rejection and ensure handleClose is called for reconnection
          this.logger.error('WebSocket onerror fired', { 
            error: 'Connection error',
            type: event.type,
            readyState: this.ws?.readyState
          });
          this.emit('error', new Error('WebSocket error'));
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
        const errorPayload = message.payload as { code?: string; message?: string } | null;
        const errorMessage = errorPayload?.message ?? errorPayload?.code ?? 'Unknown error';
        pending.reject(new Error(errorMessage));
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

      case 'pod:deploy': {
        // Handle pod deployment request from orchestrator
        const deployPayload = message.payload as PodDeployPayload;
        this.logger.info('Received pod deploy command', {
          podId: deployPayload.podId,
          packName: deployPayload.pack?.name,
        });
        
        try {
          // Ensure executor is initialized before handling pod deploy
          if (!this.executor.isInitialized()) {
            this.logger.warn('Executor not initialized, initializing now before pod deploy');
            await this.executor.initialize();
          }
          
          const result = await this.podHandler.handleDeploy(deployPayload);
          if (result.success) {
            this.emit('pod:deployed', { podId: deployPayload.podId });
            // Send success response if there's a correlationId
            if (message.correlationId) {
              this.send({
                type: 'pod:deploy:success',
                payload: { podId: deployPayload.podId },
                correlationId: message.correlationId,
              });
            }
          } else {
            this.emit('pod:failed', { podId: deployPayload.podId, error: result.error });
            if (message.correlationId) {
              this.send({
                type: 'pod:deploy:error',
                payload: { podId: deployPayload.podId, error: result.error },
                correlationId: message.correlationId,
              });
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error('Pod deploy failed', { podId: deployPayload.podId, error: errorMessage });
          this.emit('pod:failed', { podId: deployPayload.podId, error: errorMessage });
          if (message.correlationId) {
            this.send({
              type: 'pod:deploy:error',
              payload: { podId: deployPayload.podId, error: errorMessage },
              correlationId: message.correlationId,
            });
          }
        }
        break;
      }

      case 'pod:stop': {
        // Handle pod stop request from orchestrator
        const stopPayload = message.payload as PodStopPayload;
        this.logger.info('Received pod stop command', {
          podId: stopPayload.podId,
          reason: stopPayload.reason,
        });
        
        try {
          const result = await this.podHandler.handleStop(stopPayload);
          if (result.success) {
            this.emit('pod:stopped', { podId: stopPayload.podId });
            if (message.correlationId) {
              this.send({
                type: 'pod:stop:success',
                payload: { podId: stopPayload.podId },
                correlationId: message.correlationId,
              });
            }
          } else {
            if (message.correlationId) {
              this.send({
                type: 'pod:stop:error',
                payload: { podId: stopPayload.podId, error: result.error },
                correlationId: message.correlationId,
              });
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error('Pod stop failed', { podId: stopPayload.podId, error: errorMessage });
          if (message.correlationId) {
            this.send({
              type: 'pod:stop:error',
              payload: { podId: stopPayload.podId, error: errorMessage },
              correlationId: message.correlationId,
            });
          }
        }
        break;
      }

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
    this.stopMetricsCollection();
    this.clearPendingRequests('Connection closed');

    const wasRegistered = this.state === 'registered';
    this.state = 'disconnected';
    this.ws = null;
    // Preserve nodeId for reconnection - don't reset it
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

    // Prevent double-scheduling if a reconnect is already pending
    if (this.reconnectTimer !== null) {
      this.logger.debug('Reconnect already scheduled, skipping');
      return;
    }

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
      this.logger.info('Reconnect timer fired, attempting to connect');
      try {
        // Ensure executor is still initialized after reconnect
        if (!this.executor.isInitialized()) {
          this.logger.info('Re-initializing executor after reconnect');
          await this.executor.initialize();
        }
        await this.connect();
        this.logger.info('Reconnect succeeded');
      } catch (error) {
        this.logger.error('Reconnect failed', { error: String(error) });
        // If connect() threw (WebSocket closed during connection), handleClose was already
        // called but may not have scheduled a reconnect because we were mid-reconnect.
        // Schedule the next reconnect attempt explicitly.
        if (!this.isShuttingDown && this.reconnectTimer === null) {
          this.logger.info('Scheduling next reconnect attempt');
          this.scheduleReconnect();
        }
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
   * Get HTTP base URL from WebSocket URL
   */
  private getHttpBaseUrl(): string {
    return this.config.orchestratorUrl
      .replace(/^wss:\/\//, 'https://')
      .replace(/^ws:\/\//, 'http://')
      .replace(/\/ws\/?$/, '');
  }

  /**
   * Check if public registration is enabled
   */
  private async checkRegistrationStatus(): Promise<{ needsSetup: boolean; registrationEnabled: boolean }> {
    const httpUrl = this.getHttpBaseUrl();
    
    try {
      const response = await fetch(`${httpUrl}/auth/setup/status`);
      const result = await response.json() as {
        success: boolean;
        data?: { needsSetup: boolean; registrationEnabled: boolean };
        error?: { message: string };
      };

      if (!result.success || !result.data) {
        throw new Error(result.error?.message ?? 'Failed to check registration status');
      }

      return result.data;
    } catch (error) {
      this.logger.error('Failed to check registration status', { error: String(error) });
      throw error;
    }
  }

  /**
   * Generate a random string for unique identifiers
   */
  private generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < length; i++) {
      result += chars.charAt(randomValues[i]! % chars.length);
    }
    return result;
  }

  /**
   * Generate a random password for auto-registration
   * Ensures at least one uppercase, one lowercase, and one digit to meet validation requirements
   */
  private generateRandomPassword(): string {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const special = '!@#$%^&*';
    const allChars = upper + lower + digits + special;

    const randomValues = new Uint8Array(16);
    crypto.getRandomValues(randomValues);

    // Guarantee at least one of each required character type
    const result: string[] = [
      upper.charAt(randomValues[0]! % upper.length),
      lower.charAt(randomValues[1]! % lower.length),
      digits.charAt(randomValues[2]! % digits.length),
    ];

    // Fill the rest randomly from all characters
    for (let i = 3; i < 16; i++) {
      result.push(allChars.charAt(randomValues[i]! % allChars.length));
    }

    // Shuffle to avoid predictable positions for required characters
    for (let i = result.length - 1; i > 0; i--) {
      const j = randomValues[i]! % (i + 1);
      [result[i], result[j]] = [result[j]!, result[i]!];
    }

    return result.join('');
  }

  /**
   * Auto-registration result
   */
  private autoRegResult: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: string;
    userId: string;
    email: string;
  } | null = null;

  /**
   * Auto-register a new user with node role
   * Returns the access token on success
   */
  private async autoRegisterUser(): Promise<string> {
    const httpUrl = this.getHttpBaseUrl();
    const randomId = this.generateRandomString(8);
    const autoEmail = `browser-${randomId}@stark.local`;
    const autoPassword = this.generateRandomPassword();

    this.logger.info('Auto-registering browser agent user', { email: autoEmail });

    try {
      const response = await fetch(`${httpUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: autoEmail,
          password: autoPassword,
          displayName: `Browser Agent ${this.config.nodeName}`,
          roles: ['node'],
        }),
      });

      const result = await response.json() as {
        success: boolean;
        data?: {
          accessToken: string;
          refreshToken?: string;
          expiresAt: string;
          user: { id: string; email: string };
        };
        error?: { code: string; message: string };
      };

      if (!result.success || !result.data) {
        throw new Error(result.error?.message ?? 'Auto-registration failed');
      }

      // Store the full result for credential saving
      this.autoRegResult = {
        accessToken: result.data.accessToken,
        refreshToken: result.data.refreshToken,
        expiresAt: result.data.expiresAt,
        userId: result.data.user.id,
        email: result.data.user.email,
      };

      this.logger.info('Auto-registered successfully', { email: autoEmail, userId: result.data.user.id });
      return result.data.accessToken;
    } catch (error) {
      this.logger.error('Auto-registration failed', { error: String(error) });
      throw error;
    }
  }

  /**
   * Ensure we have an auth token, auto-registering if needed
   */
  private async ensureAuthToken(): Promise<void> {
    if (this.authToken) {
      return;
    }

    // Try to use stored credentials first
    const storedToken = this.stateStore.getAccessToken();
    if (storedToken) {
      this.authToken = storedToken;
      this.logger.info('Using stored credentials');

      // Update the executor with the stored auth token
      this.executor = new PackExecutor({
        bundlePath: this.config.bundlePath,
        orchestratorUrl: this.getHttpBaseUrl(),
        authToken: this.authToken,
      });

      // Initialize the new executor so metrics collection works
      await this.executor.initialize();

      // Re-initialize the pod handler with the new executor
      this.podHandler = createPodHandler({
        executor: this.executor,
        onStatusChange: (podId, status, message) => {
          this.handlePodStatusChange(podId, status, message);
        },
      });
      return;
    }

    // If access token is expired but we have a refresh token, try to refresh
    const storedCredentials = this.stateStore.getCredentials();
    if (storedCredentials?.refreshToken) {
      this.logger.info('Access token expired, attempting to refresh...');
      const refreshed = await this.refreshToken(storedCredentials.refreshToken);
      if (refreshed) {
        this.logger.info('Token refreshed successfully');
        return;
      }
      this.logger.warn('Token refresh failed, falling back to auto-registration');
    }

    if (!this.config.autoRegister) {
      throw new Error('No auth token provided, no stored credentials, and autoRegister is disabled');
    }

    this.logger.info('No auth token or stored credentials. Checking if public registration is available...');

    const status = await this.checkRegistrationStatus();

    if (!status.registrationEnabled) {
      throw new Error('Authentication required and public registration is disabled. Provide an authToken.');
    }

    this.authToken = await this.autoRegisterUser();

    // Save the credentials for future sessions
    if (!this.autoRegResult) {
      this.logger.error('Auto-registration succeeded but autoRegResult is missing');
    } else if (!this.config.persistState) {
      this.logger.info('Skipping credential save (persistState is disabled)');
    } else {
      const credentials: BrowserNodeCredentials = {
        accessToken: this.autoRegResult.accessToken,
        refreshToken: this.autoRegResult.refreshToken,
        expiresAt: this.autoRegResult.expiresAt,
        userId: this.autoRegResult.userId,
        email: this.autoRegResult.email,
        createdAt: new Date().toISOString(),
      };
      this.stateStore.saveCredentials(credentials);
      this.logger.info('Saved credentials for future sessions', { 
        email: this.autoRegResult.email,
        hasRefreshToken: !!this.autoRegResult.refreshToken,
        expiresAt: this.autoRegResult.expiresAt,
      });
    }

    // Update the executor with the new auth token
    this.executor = new PackExecutor({
      bundlePath: this.config.bundlePath,
      orchestratorUrl: this.getHttpBaseUrl(),
      authToken: this.authToken,
    });

    // Initialize the new executor so metrics collection works
    await this.executor.initialize();

    // Re-initialize the pod handler with the new executor
    this.podHandler = createPodHandler({
      executor: this.executor,
      onStatusChange: (podId, status, message) => {
        this.handlePodStatusChange(podId, status, message);
      },
    });
  }

  /**
   * Authenticate with the orchestrator
   */
  private async authenticate(): Promise<void> {
    this.state = 'authenticating';
    this.logger.info('Authenticating with orchestrator');

    try {
      // Ensure we have an auth token (auto-register if needed)
      await this.ensureAuthToken();

      await this.sendRequest<{ userId: string }>('auth:authenticate', {
        token: this.authToken,
      });

      // Reset retry counter on successful auth
      this.authRetryCount = 0;
      this.state = 'authenticated';
      this.emit('authenticated');
      this.logger.info('Authenticated successfully');

      // If we have an existing nodeId (either from reconnect or from stored state), reconnect instead of registering
      if (this.nodeId) {
        await this.reconnect();
      } else {
        await this.register();
      }
    } catch (error) {
      this.logger.error('Authentication failed', { error: String(error) });
      
      // Check if this is an AUTH_FAILED error - credentials are invalid/expired
      const errorCode = typeof error === 'object' && error !== null && 'code' in error 
        ? (error as { code: string }).code 
        : '';
      const errorMessage = error instanceof Error ? error.message : '';
      const isAuthFailed = 
        errorMessage.includes('AUTH_FAILED') ||
        errorMessage.includes('USER_NOT_FOUND') ||
        errorMessage.includes('sub claim') ||
        errorCode === 'AUTH_FAILED' ||
        errorCode === 'USER_NOT_FOUND';
      
      if (isAuthFailed && this.authRetryCount < 1) {
        this.authRetryCount++;
        this.logger.info('Credentials are invalid, clearing stored credentials and retrying...');
        this.stateStore.clearCredentials();
        this.stateStore.removeNode(this.config.nodeName);
        this.authToken = '';
        this.nodeId = null;
        this.emit('credentials_invalid', error);
        
        // Retry authentication - ensureAuthToken will auto-register since credentials are cleared
        this.logger.info('Retrying authentication with fresh credentials...');
        return this.authenticate();
      }
      
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

      // Persist the node registration for future resumption
      if (this.config.persistState) {
        const registeredNode: RegisteredBrowserNode = {
          nodeId: this.nodeId,
          name: this.config.nodeName,
          orchestratorUrl: this.config.orchestratorUrl,
          registeredAt: new Date().toISOString(),
          registeredBy: response.node.registeredBy!,
          lastStarted: new Date().toISOString(),
        };
        this.stateStore.saveNode(registeredNode);
        this.logger.info('Persisted node registration', { nodeName: this.config.nodeName, nodeId: this.nodeId });
      }

      this.state = 'registered';
      this.emit('registered', response.node);
      this.logger.info('Node registered', {
        nodeId: this.nodeId,
        nodeName: this.config.nodeName,
      });

      // Start heartbeat and metrics collection
      this.startHeartbeat();
      this.startMetricsCollection();
    } catch (error) {
      // Check if this is a CONFLICT error (node already exists)
      const errorObj = error as { code?: string; message?: string };
      if (errorObj.code === 'CONFLICT') {
        this.logger.info('Node already exists, attempting to look up and reconnect', {
          nodeName: this.config.nodeName,
        });

        // Try to look up the existing node by name via HTTP API
        try {
          const httpUrl = this.getHttpBaseUrl();

          const lookupResponse = await fetch(`${httpUrl}/api/nodes/name/${encodeURIComponent(this.config.nodeName)}`, {
            headers: {
              'Authorization': `Bearer ${this.authToken}`,
            },
          });

          const lookupResult = await lookupResponse.json() as {
            success: boolean;
            data?: { node: { id: string; registeredBy: string } };
            error?: { code: string; message: string };
          };

          if (lookupResult.success && lookupResult.data?.node) {
            this.nodeId = lookupResult.data.node.id;
            this.logger.info('Found existing node, attempting reconnect', {
              nodeId: this.nodeId,
              nodeName: this.config.nodeName,
            });

            // Save the node registration locally for future restarts
            if (this.config.persistState) {
              const registeredNode: RegisteredBrowserNode = {
                nodeId: this.nodeId,
                name: this.config.nodeName,
                orchestratorUrl: this.config.orchestratorUrl,
                registeredAt: new Date().toISOString(),
                registeredBy: lookupResult.data.node.registeredBy,
                lastStarted: new Date().toISOString(),
              };
              this.stateStore.saveNode(registeredNode);
            }

            // Now attempt to reconnect with the existing node
            await this.reconnect();
            return;
          }
        } catch (lookupError) {
          this.logger.error('Failed to look up existing node', { error: String(lookupError) });
        }
      }

      this.logger.error('Registration failed', { error: String(error) });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Reconnect an existing node to the orchestrator
   * Used when reconnecting after a connection drop or when resuming a previously registered node
   */
  private async reconnect(): Promise<void> {
    this.state = 'registering';
    this.logger.info('Reconnecting node', { nodeId: this.nodeId, nodeName: this.config.nodeName });

    try {
      const response = await this.sendRequest<{ node: Node }>('node:reconnect', {
        nodeId: this.nodeId,
      });

      // Update the lastStarted timestamp in persisted state
      if (this.config.persistState) {
        this.stateStore.updateLastStarted(this.config.nodeName);
      }

      this.state = 'registered';
      this.emit('registered', response.node);
      this.logger.info('Node reconnected', {
        nodeId: this.nodeId,
        nodeName: this.config.nodeName,
      });

      // Start heartbeat and metrics collection
      this.startHeartbeat();
      this.startMetricsCollection();
    } catch (error) {
      this.logger.error('Reconnection failed, falling back to registration', { error: String(error) });
      // If reconnection fails (e.g., node was deleted), fall back to fresh registration
      this.nodeId = null;
      
      // Remove the stale node registration from storage
      if (this.config.persistState) {
        this.stateStore.removeNode(this.config.nodeName);
      }
      
      await this.register();
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

  // ============================================================================
  // Metrics Collection
  // ============================================================================

  /**
   * Start the metrics collection timer
   */
  private startMetricsCollection(): void {
    this.stopMetricsCollection();

    this.metricsTimer = window.setInterval(() => {
      this.sendMetrics();
    }, this.config.metricsInterval);

    // Send initial metrics
    this.sendMetrics();

    this.logger.debug('Metrics collection started', { intervalMs: this.config.metricsInterval });
  }

  /**
   * Stop the metrics collection timer
   */
  private stopMetricsCollection(): void {
    if (this.metricsTimer !== null) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  /**
   * Collect and send node metrics to the orchestrator
   */
  private sendMetrics(): void {
    if (!this.nodeId || this.state !== 'registered') {
      return;
    }

    // Skip metrics if executor is not initialized to avoid race conditions
    if (!this.executor.isInitialized()) {
      this.logger.debug('Skipping metrics: executor not initialized');
      return;
    }

    try {
      const systemMetrics = this.collectSystemMetrics();
      const poolStats = this.executor.getPoolStats?.() ?? null;
      const podCounts = this.podHandler.getPodCounts();
      const restartStats = this.podHandler.getRestartStats();

      const metricsPayload = {
        nodeId: this.nodeId,
        runtimeType: this.config.runtimeType,
        // System metrics
        uptimeSeconds: systemMetrics.uptimeSeconds,
        cpuUsagePercent: systemMetrics.cpuUsagePercent,
        memoryUsedBytes: systemMetrics.memoryUsedBytes,
        memoryTotalBytes: systemMetrics.memoryTotalBytes,
        memoryUsagePercent: systemMetrics.memoryUsagePercent,
        runtimeVersion: systemMetrics.runtimeVersion,
        // Resource allocation
        podsAllocated: this.allocatedResources.pods,
        podsCapacity: this.config.allocatable.pods,
        cpuAllocated: this.allocatedResources.cpu,
        cpuCapacity: this.config.allocatable.cpu,
        memoryAllocatedBytes: this.allocatedResources.memory * 1024 * 1024, // Convert MB to bytes
        memoryCapacityBytes: (this.config.allocatable.memory ?? 0) * 1024 * 1024,
        // Pod status counts
        podsRunning: podCounts.running,
        podsPending: podCounts.pending,
        podsStopped: podCounts.stopped,
        podsFailed: podCounts.failed,
        // Restart statistics
        totalPodRestarts: restartStats.totalRestarts,
        podsWithRestarts: restartStats.podsWithRestarts,
        // Worker pool stats (if available)
        workerPool: poolStats ? {
          totalWorkers: poolStats.totalWorkers,
          busyWorkers: poolStats.busyWorkers,
          idleWorkers: poolStats.idleWorkers,
          pendingTasks: poolStats.pendingTasks,
        } : undefined,
        timestamp: new Date().toISOString(),
      };

      this.send({
        type: 'metrics:node',
        payload: metricsPayload,
      });

      this.logger.debug('Metrics sent', {
        nodeId: this.nodeId,
        uptimeSeconds: systemMetrics.uptimeSeconds,
        memoryUsagePercent: systemMetrics.memoryUsagePercent,
        podsRunning: podCounts.running,
        totalRestarts: restartStats.totalRestarts,
      });
    } catch (error) {
      this.logger.error('Failed to send metrics', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Collect system metrics (uptime, memory, runtime version)
   * Browser-compatible implementation with limited access to system info
   */
  private collectSystemMetrics(): {
    uptimeSeconds: number;
    cpuUsagePercent: number | undefined;
    memoryUsedBytes: number | undefined;
    memoryTotalBytes: number | undefined;
    memoryUsagePercent: number | undefined;
    runtimeVersion: string;
  } {
    // Calculate agent uptime
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    // Browser version info from user agent
    const runtimeVersion = this.getBrowserVersion();

    // Try to get memory info if available (Chrome/Edge only)
    let memoryUsedBytes: number | undefined;
    let memoryTotalBytes: number | undefined;
    let memoryUsagePercent: number | undefined;

    // Use Performance.memory API if available (Chrome/Edge)
    const performance = globalThis.performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };

    if (performance?.memory) {
      memoryUsedBytes = performance.memory.usedJSHeapSize;
      memoryTotalBytes = performance.memory.jsHeapSizeLimit;
      memoryUsagePercent = Math.round((memoryUsedBytes / memoryTotalBytes) * 10000) / 100;
    } else if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
      // Fallback to deviceMemory API (gives approximate device RAM in GB)
      const deviceMemoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
      if (deviceMemoryGB) {
        memoryTotalBytes = deviceMemoryGB * 1024 * 1024 * 1024;
      }
    }

    // CPU usage is not reliably available in browsers
    // We could estimate based on frame rate or task timing, but it's not accurate
    const cpuUsagePercent = undefined;

    return {
      uptimeSeconds,
      cpuUsagePercent,
      memoryUsedBytes,
      memoryTotalBytes,
      memoryUsagePercent,
      runtimeVersion,
    };
  }

  /**
   * Get browser version string
   */
  private getBrowserVersion(): string {
    if (typeof navigator === 'undefined') {
      return 'unknown';
    }

    const ua = navigator.userAgent;
    
    // Try to extract browser name and version
    const browserPatterns = [
      { name: 'Chrome', pattern: /Chrome\/(\d+\.\d+)/ },
      { name: 'Firefox', pattern: /Firefox\/(\d+\.\d+)/ },
      { name: 'Safari', pattern: /Version\/(\d+\.\d+).*Safari/ },
      { name: 'Edge', pattern: /Edg\/(\d+\.\d+)/ },
    ];

    for (const { name, pattern } of browserPatterns) {
      const match = ua.match(pattern);
      if (match) {
        return `${name}/${match[1]}`;
      }
    }

    return 'Browser/unknown';
  }

  /**
   * Get current metrics snapshot (for external access)
   */
  getMetricsSnapshot(): {
    uptime: number;
    pods: { running: number; pending: number; stopped: number; failed: number };
    restarts: { total: number; byPod: Map<string, number> };
    resources: {
      allocated: { cpu: number; memory: number; pods: number };
      capacity: { cpu: number; memory: number; pods: number };
    };
    workerPool: { total: number; busy: number; idle: number; pending: number } | null;
  } {
    const podCounts = this.podHandler.getPodCounts();
    const restartStats = this.podHandler.getRestartStats();
    // Only get pool stats if executor is initialized to avoid errors
    const poolStats = this.executor.isInitialized() 
      ? (this.executor.getPoolStats?.() ?? null)
      : null;

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      pods: {
        running: podCounts.running,
        pending: podCounts.pending,
        stopped: podCounts.stopped,
        failed: podCounts.failed,
      },
      restarts: {
        total: restartStats.totalRestarts,
        byPod: restartStats.restartsByPod,
      },
      resources: {
        allocated: {
          cpu: this.allocatedResources.cpu,
          memory: this.allocatedResources.memory,
          pods: this.allocatedResources.pods,
        },
        capacity: {
          cpu: this.config.allocatable.cpu,
          memory: this.config.allocatable.memory ?? 0,
          pods: this.config.allocatable.pods,
        },
      },
      workerPool: poolStats ? {
        total: poolStats.totalWorkers,
        busy: poolStats.busyWorkers,
        idle: poolStats.idleWorkers,
        pending: poolStats.pendingTasks,
      } : null,
    };
  }

  /**
   * Token refresh check interval - check every minute
   */
  private static readonly TOKEN_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;

  /**
   * Start the token refresh timer
   * Periodically checks if the token needs to be refreshed
   */
  private startTokenRefresh(): void {
    this.stopTokenRefresh();

    // Check immediately if we need to refresh
    void this.checkAndRefreshToken();

    // Then check periodically
    this.tokenRefreshTimer = window.setInterval(() => {
      void this.checkAndRefreshToken();
    }, BrowserAgent.TOKEN_REFRESH_CHECK_INTERVAL_MS);

    this.logger.debug('Token refresh timer started');
  }

  /**
   * Stop the token refresh timer
   */
  private stopTokenRefresh(): void {
    if (this.tokenRefreshTimer !== null) {
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
    if (!this.stateStore.shouldRefreshCredentials()) {
      return;
    }

    const refreshToken = this.stateStore.getRefreshToken();
    if (!refreshToken) {
      this.logger.warn('Token needs refresh but no refresh token available');
      return;
    }

    await this.refreshToken(refreshToken);
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshToken(refreshToken: string): Promise<boolean> {
    if (this.isRefreshingToken) {
      return false;
    }

    this.isRefreshingToken = true;
    this.logger.info('Refreshing access token...');

    try {
      const httpUrl = this.getHttpBaseUrl();

      const response = await fetch(`${httpUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      const result = await response.json() as {
        success: boolean;
        data?: {
          accessToken: string;
          refreshToken?: string;
          expiresAt: string;
          user: { id: string; email: string };
        };
        error?: { code: string; message: string };
      };

      if (!result.success || !result.data) {
        this.logger.error('Token refresh failed', { 
          error: result.error?.message ?? 'Unknown error' 
        });
        return false;
      }

      // Update credentials with new tokens
      const existingCreds = this.stateStore.getCredentials();
      const newCredentials: BrowserNodeCredentials = {
        accessToken: result.data.accessToken,
        refreshToken: result.data.refreshToken ?? refreshToken,
        expiresAt: result.data.expiresAt,
        userId: result.data.user.id,
        email: result.data.user.email,
        createdAt: existingCreds?.createdAt ?? new Date().toISOString(),
      };

      // Save credentials
      if (this.config.persistState) {
        this.stateStore.saveCredentials(newCredentials);
      }

      // Update auth token
      this.authToken = newCredentials.accessToken;

      // Update the executor with the new auth token
      this.executor = new PackExecutor({
        bundlePath: this.config.bundlePath,
        orchestratorUrl: this.getHttpBaseUrl(),
        authToken: this.authToken,
      });

      // Initialize the new executor so metrics collection works
      await this.executor.initialize();

      // Re-initialize the pod handler with the new executor
      this.podHandler = createPodHandler({
        executor: this.executor,
        onStatusChange: (podId, status, message) => {
          this.handlePodStatusChange(podId, status, message);
        },
      });

      this.logger.info('Access token refreshed successfully', {
        userId: newCredentials.userId,
        expiresAt: newCredentials.expiresAt,
      });

      return true;
    } catch (error) {
      this.logger.error('Token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      this.isRefreshingToken = false;
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

  /**
   * Handle pod status change from PodHandler
   * Reports the status change to the orchestrator
   */
  private handlePodStatusChange(podId: string, status: LocalPodStatus, message?: string): void {
    this.logger.info('Pod status changed', { podId, status, message });

    // Map local status to pod events
    switch (status) {
      case 'running':
        this.emit('pod:started', { podId });
        break;
      case 'stopped':
        this.emit('pod:stopped', { podId, message });
        break;
      case 'failed':
        this.emit('pod:failed', { podId, error: message });
        break;
    }

    // Update allocated resources based on pod status
    if (status === 'running') {
      this.allocatedResources.pods++;
    } else if (status === 'stopped' || status === 'failed') {
      this.allocatedResources.pods = Math.max(0, this.allocatedResources.pods - 1);
    }

    // Report status change to orchestrator if connected
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state === 'registered') {
      this.send({
        type: 'pod:status:update',
        payload: {
          podId,
          status: mapLocalStatusToPodStatus(status),
          message,
          reason: 'runtime_status_change',
        },
      });
    }
  }

  /**
   * Get the pod handler for direct access to pod operations
   */
  getPodHandler(): PodHandler {
    return this.podHandler;
  }

  /**
   * Get the pack executor for direct access to execution operations
   */
  getExecutor(): PackExecutor {
    return this.executor;
  }

  /**
   * Get the state store for direct access to persisted state
   */
  getStateStore(): BrowserStateStore {
    return this.stateStore;
  }

  /**
   * Save credentials for future browser agent sessions
   */
  saveCredentials(credentials: BrowserNodeCredentials): void {
    this.stateStore.saveCredentials(credentials);
    this.authToken = credentials.accessToken;
    
    // Update the executor with the new auth token
    this.executor = new PackExecutor({
      bundlePath: this.config.bundlePath,
      orchestratorUrl: this.getHttpBaseUrl(),
      authToken: this.authToken,
    });

    this.logger.info('Saved credentials', { userId: credentials.userId, email: credentials.email });
  }

  /**
   * Check if valid stored credentials exist
   */
  hasStoredCredentials(): boolean {
    return this.stateStore.hasValidCredentials();
  }

  /**
   * Get the current auth token
   */
  getAuthToken(): string {
    return this.authToken;
  }

  /**
   * Set the auth token (updates executor as well)
   */
  setAuthToken(token: string): void {
    this.authToken = token;
    
    // Update the executor with the new auth token
    this.executor = new PackExecutor({
      bundlePath: this.config.bundlePath,
      orchestratorUrl: this.getHttpBaseUrl(),
      authToken: this.authToken,
    });
  }
}

/**
 * Create a new BrowserAgent instance
 */
export function createBrowserAgent(config: BrowserAgentConfig): BrowserAgent {
  return new BrowserAgent(config);
}
