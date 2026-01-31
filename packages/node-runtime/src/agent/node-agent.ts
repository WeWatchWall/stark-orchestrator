/**
 * Node Agent
 * @module @stark-o/node-runtime/agent/node-agent
 *
 * Agent that runs on Node.js servers to register with the orchestrator,
 * send heartbeats, and receive pod deployment commands.
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import {
  createServiceLogger,
  type Logger,
  type RegisterNodeInput,
  type NodeHeartbeat,
  type Node,
  type RuntimeType,
  type AllocatableResources,
  type NodeCapabilities,
  type Labels,
  type Annotations,
  type Taint,
  type WsMessage,
  type PodDeployPayload,
  type PodStopPayload,
  type LocalPodStatus,
} from '@stark-o/shared';
import { PodHandler, createPodHandler } from './pod-handler.js';
import { PackExecutor } from '../executor/pack-executor.js';
import {
  NodeStateStore,
  createNodeStateStore,
  type RegisteredNode,
  type NodeCredentials,
} from './node-state-store.js';

/**
 * Node agent configuration
 */
export interface NodeAgentConfig {
  /** Orchestrator WebSocket URL (e.g., ws://localhost:3000/ws) */
  orchestratorUrl: string;
  /** Authentication token (optional if using stored credentials or auto-registration) */
  authToken?: string;
  /** Node name (must be unique) */
  nodeName: string;
  /** Runtime type (always 'node' for this agent) */
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
  /** Directory for pack bundles (default: process.cwd()) */
  bundleDir?: string;
  /** Logger instance */
  logger?: Logger;
  /** Enable persistent storage of node registration (default: true) */
  persistState?: boolean;
  /** Automatically resume an existing node with the same name (default: true) */
  resumeExisting?: boolean;
}

/**
 * Node agent events
 */
export type NodeAgentEvent =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'registered'
  | 'heartbeat'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'stopped'
  | 'pod:deployed'
  | 'pod:started'
  | 'pod:stopped'
  | 'pod:failed';

/**
 * Event handler type
 */
export type NodeAgentEventHandler = (event: NodeAgentEvent, data?: unknown) => void;

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
 * Default allocatable resources for Node.js runtime
 */
const DEFAULT_NODE_ALLOCATABLE: AllocatableResources = {
  cpu: 1000,    // 1 CPU core
  memory: 1024, // 1 GB
  pods: 10,     // 10 concurrent pods
  storage: 10240, // 10 GB
};

/**
 * Node Agent
 *
 * Manages the connection between a Node.js runtime and the orchestrator.
 * Handles:
 * - WebSocket connection and reconnection
 * - Authentication with the orchestrator
 * - Node registration
 * - Periodic heartbeats
 * - Resource reporting
 * - Pod deployment and lifecycle
 * - Persistent storage of node state for resumption
 */
export class NodeAgent {
  private readonly config: Required<Omit<NodeAgentConfig, 'logger' | 'bundleDir' | 'authToken'>> & { 
    logger: Logger; 
    bundleDir: string;
  };
  private authToken: string;
  private readonly stateStore: NodeStateStore;
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private connectionId: string | null = null;
  private state: ConnectionState = 'disconnected';
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private tokenRefreshTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  private isRefreshingToken = false;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timeout: NodeJS.Timeout;
  }>();
  private eventHandlers: Set<NodeAgentEventHandler> = new Set();
  private allocatedResources: AllocatableResources = {
    cpu: 0,
    memory: 0,
    pods: 0,
    storage: 0,
  };
  private executor: PackExecutor;
  private podHandler: PodHandler;

  constructor(config: NodeAgentConfig) {
    this.config = {
      orchestratorUrl: config.orchestratorUrl,
      nodeName: config.nodeName,
      runtimeType: config.runtimeType ?? 'node',
      capabilities: config.capabilities ?? { version: process.version },
      allocatable: { ...DEFAULT_NODE_ALLOCATABLE, ...config.allocatable },
      labels: config.labels ?? {},
      annotations: config.annotations ?? {},
      taints: config.taints ?? [],
      heartbeatInterval: config.heartbeatInterval ?? 15000,
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      bundleDir: config.bundleDir ?? process.cwd(),
      logger: config.logger ?? createServiceLogger({
        component: 'node-agent',
        service: 'stark-node-runtime',
      }),
      persistState: config.persistState ?? true,
      resumeExisting: config.resumeExisting ?? true,
    };

    this.authToken = config.authToken ?? '';
    
    // Initialize state store for persistent storage
    this.stateStore = createNodeStateStore(config.orchestratorUrl);

    // Try to load existing node registration if resumeExisting is enabled
    if (this.config.resumeExisting) {
      const existingNode = this.stateStore.getNode(this.config.nodeName);
      if (existingNode) {
        this.nodeId = existingNode.nodeId;
        this.config.logger.info('Found existing node registration', {
          nodeName: this.config.nodeName,
          nodeId: this.nodeId,
          registeredAt: existingNode.registeredAt,
        });
      }
    }

    // Initialize pack executor
    this.executor = new PackExecutor({
      bundleDir: this.config.bundleDir,
      orchestratorUrl: this.config.orchestratorUrl.replace(/^ws/, 'http').replace('/ws', ''),
      authToken: this.authToken,
      logger: this.config.logger,
    });

    // Initialize pod handler
    this.podHandler = createPodHandler({
      executor: this.executor,
      logger: this.config.logger,
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
  on(handler: NodeAgentEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Remove an event handler
   */
  off(handler: NodeAgentEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: NodeAgentEvent, data?: unknown): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event, data);
      } catch (error) {
        this.config.logger.error('Event handler error', { event, error });
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
    this.stopTokenRefresh();
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
    this.config.logger.info('Node agent stopped');
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
    this.config.logger.info('Connecting to orchestrator', {
      url: this.config.orchestratorUrl,
    });

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.orchestratorUrl);

        this.ws.on('open', () => {
          this.state = 'connected';
          this.reconnectAttempts = 0;
          this.emit('connected');
          this.config.logger.info('Connected to orchestrator');
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          this.handleClose(code, reason.toString());
        });

        this.ws.on('error', (error) => {
          this.config.logger.error('WebSocket error', { error: error.message });
          this.emit('error', error);
          reject(error);
        });

      } catch (error) {
        this.config.logger.error('Failed to create WebSocket connection', { error });
        this.emit('error', error);
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    let message: WsMessage;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.config.logger.error('Failed to parse message', { data: data.toString() });
      return;
    }

    this.config.logger.debug('Received message', {
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
        this.config.logger.info('Server requested disconnect', { payload: message.payload });
        break;

      case 'pod:deploy': {
        // Handle pod deployment request from orchestrator
        const deployPayload = message.payload as PodDeployPayload;
        this.config.logger.info('Received pod deploy command', {
          podId: deployPayload.podId,
          packName: deployPayload.pack?.name,
        });
        
        try {
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
          this.config.logger.error('Pod deploy failed', { podId: deployPayload.podId, error: errorMessage });
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
        this.config.logger.info('Received pod stop command', {
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
          this.config.logger.error('Pod stop failed', { podId: stopPayload.podId, error: errorMessage });
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
        this.config.logger.debug('Unhandled message type', { type: message.type });
    }
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(code: number, reason: string): void {
    this.config.logger.info('WebSocket closed', { code, reason });
    this.stopHeartbeat();
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

    if (
      this.config.maxReconnectAttempts !== -1 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.config.logger.error('Max reconnect attempts reached, giving up');
      this.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay * Math.min(this.reconnectAttempts, 5);

    this.config.logger.info('Scheduling reconnect', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
      delay,
    });

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        this.config.logger.error('Reconnect failed', { error });
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
   * Authenticate with the orchestrator
   */
  private async authenticate(): Promise<void> {
    this.state = 'authenticating';
    this.config.logger.info('Authenticating with orchestrator');

    try {
      // If no auth token provided, try to use stored credentials
      if (!this.authToken) {
        const storedToken = this.stateStore.getAccessToken();
        if (storedToken) {
          this.authToken = storedToken;
          this.config.logger.info('Using stored node credentials');
          
          // Update executor with the token
          this.executor = new PackExecutor({
            bundleDir: this.config.bundleDir,
            orchestratorUrl: this.config.orchestratorUrl.replace(/^ws/, 'http').replace('/ws', ''),
            authToken: this.authToken,
            logger: this.config.logger,
          });
        }
      }

      if (!this.authToken) {
        throw new Error('No authentication token available. Provide authToken in config or ensure valid stored credentials.');
      }

      await this.sendRequest<{ userId: string }>('auth:authenticate', {
        token: this.authToken,
      });

      this.state = 'authenticated';
      this.emit('authenticated');
      this.config.logger.info('Authenticated successfully');

      // If we have an existing nodeId (either from reconnect or from stored state), reconnect instead of registering
      if (this.nodeId) {
        await this.reconnect();
      } else {
        await this.register();
      }
    } catch (error) {
      this.config.logger.error('Authentication failed', { error });
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Register the node with the orchestrator
   */
  private async register(): Promise<void> {
    this.state = 'registering';
    this.config.logger.info('Registering node', { nodeName: this.config.nodeName });

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
        const registeredNode: RegisteredNode = {
          nodeId: this.nodeId,
          name: this.config.nodeName,
          orchestratorUrl: this.config.orchestratorUrl,
          registeredAt: new Date().toISOString(),
          registeredBy: response.node.registeredBy!,
          lastStarted: new Date().toISOString(),
        };
        this.stateStore.saveNode(registeredNode);
        this.config.logger.info('Persisted node registration', { nodeName: this.config.nodeName, nodeId: this.nodeId });
      }

      this.state = 'registered';
      this.emit('registered', response.node);
      this.config.logger.info('Node registered', {
        nodeId: this.nodeId,
        nodeName: this.config.nodeName,
      });

      // Start heartbeat
      this.startHeartbeat();
    } catch (error) {
      // Check if this is a CONFLICT error (node already exists)
      const errorObj = error as { code?: string; message?: string };
      if (errorObj.code === 'CONFLICT') {
        this.config.logger.info('Node already exists, attempting to look up and reconnect', {
          nodeName: this.config.nodeName,
        });

        // Try to look up the existing node by name via HTTP API
        try {
          const httpUrl = this.config.orchestratorUrl
            .replace(/^wss:\/\//, 'https://')
            .replace(/^ws:\/\//, 'http://')
            .replace(/\/ws\/?$/, '');

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
            this.config.logger.info('Found existing node, attempting reconnect', {
              nodeId: this.nodeId,
              nodeName: this.config.nodeName,
            });

            // Save the node registration locally for future restarts
            if (this.config.persistState) {
              const registeredNode: RegisteredNode = {
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
          this.config.logger.error('Failed to look up existing node', { error: lookupError });
        }
      }

      this.config.logger.error('Registration failed', { error });
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
    this.config.logger.info('Reconnecting node', { nodeId: this.nodeId, nodeName: this.config.nodeName });

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
      this.config.logger.info('Node reconnected', {
        nodeId: this.nodeId,
        nodeName: this.config.nodeName,
      });

      // Start heartbeat
      this.startHeartbeat();
    } catch (error) {
      this.config.logger.error('Reconnection failed, falling back to registration', { error });
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

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    // Send initial heartbeat
    this.sendHeartbeat();
  }

  /**
   * Stop the heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
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
    this.tokenRefreshTimer = setInterval(() => {
      void this.checkAndRefreshToken();
    }, NodeAgent.TOKEN_REFRESH_CHECK_INTERVAL_MS);

    this.config.logger.debug('Token refresh timer started');
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
    if (!this.stateStore.shouldRefreshCredentials()) {
      return;
    }

    const refreshToken = this.stateStore.getRefreshToken();
    if (!refreshToken) {
      this.config.logger.warn('Token needs refresh but no refresh token available');
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
    this.config.logger.info('Refreshing access token...');

    try {
      const httpUrl = this.config.orchestratorUrl
        .replace(/^wss:\/\//, 'https://')
        .replace(/^ws:\/\//, 'http://')
        .replace(/\/ws\/?$/, '');

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
        this.config.logger.error('Token refresh failed', { 
          error: result.error?.message ?? 'Unknown error' 
        });
        return false;
      }

      // Update credentials with new tokens
      const existingCreds = this.stateStore.getCredentials();
      const newCredentials: NodeCredentials = {
        accessToken: result.data.accessToken,
        refreshToken: result.data.refreshToken ?? refreshToken,
        expiresAt: result.data.expiresAt,
        userId: result.data.user.id,
        email: result.data.user.email,
        createdAt: existingCreds?.createdAt ?? new Date().toISOString(),
      };

      // Save credentials and update auth token
      this.saveCredentials(newCredentials);

      this.config.logger.info('Access token refreshed successfully', {
        userId: newCredentials.userId,
        expiresAt: newCredentials.expiresAt,
      });

      return true;
    } catch (error) {
      this.config.logger.error('Token refresh failed', {
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
      this.config.logger.debug('Heartbeat sent', { nodeId: this.nodeId });
    } catch (error) {
      this.config.logger.error('Heartbeat failed', { error, nodeId: this.nodeId });
      // Don't emit error for heartbeat failures, the connection close will handle reconnect
    }
  }

  /**
   * Handle pod status change from PodHandler
   * Reports the status change to the orchestrator
   */
  private handlePodStatusChange(podId: string, status: LocalPodStatus, message?: string): void {
    this.config.logger.info('Pod status changed', { podId, status, message });

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
          status: this.mapLocalStatusToPodStatus(status),
          message,
          reason: 'runtime_status_change',
        },
      });
    }
  }

  /**
   * Map local pod status to orchestrator pod status
   */
  private mapLocalStatusToPodStatus(status: LocalPodStatus): string {
    switch (status) {
      case 'pending':
        return 'pending';
      case 'starting':
        return 'starting';
      case 'running':
        return 'running';
      case 'stopping':
        return 'stopping';
      case 'stopped':
        return 'stopped';
      case 'failed':
        return 'failed';
      default:
        return 'unknown';
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
      const correlationId = randomUUID();

      const timeoutHandle = setTimeout(() => {
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
   * Get the state store for direct access to persisted state
   */
  getStateStore(): NodeStateStore {
    return this.stateStore;
  }

  /**
   * Save credentials for future node agent sessions
   * This stores credentials separately from CLI user credentials
   */
  saveCredentials(credentials: NodeCredentials): void {
    this.stateStore.saveCredentials(credentials);
    this.authToken = credentials.accessToken;
    
    // Update the executor with the new auth token
    this.executor = new PackExecutor({
      bundleDir: this.config.bundleDir,
      orchestratorUrl: this.config.orchestratorUrl.replace(/^ws/, 'http').replace('/ws', ''),
      authToken: this.authToken,
      logger: this.config.logger,
    });

    this.config.logger.info('Saved node credentials', { userId: credentials.userId, email: credentials.email });
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
      bundleDir: this.config.bundleDir,
      orchestratorUrl: this.config.orchestratorUrl.replace(/^ws/, 'http').replace('/ws', ''),
      authToken: this.authToken,
      logger: this.config.logger,
    });
  }
}

/**
 * Create a new NodeAgent instance
 */
export function createNodeAgent(config: NodeAgentConfig): NodeAgent {
  return new NodeAgent(config);
}
