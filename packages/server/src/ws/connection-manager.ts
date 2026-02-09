/**
 * WebSocket Connection Manager
 * @module @stark-o/server/ws/connection-manager
 *
 * Manages WebSocket connections for the orchestrator server.
 * Handles authentication, message routing, and connection lifecycle.
 */

import type { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import type { IncomingMessage } from 'http';
import { createLogger } from '@stark-o/shared';
import {
  handleNodeRegister,
  handleNodeHeartbeat,
  handleNodeReconnect,
  handleNodeDisconnect,
  type WsConnection,
  type ReconnectNodePayload,
} from './handlers/node-handler.js';
import { routePodMessage } from './handlers/pod-handler.js';
import { routeMetricsMessage } from './handlers/metrics-handler.js';
import { createNetworkWsHandlers, NETWORK_WS_TYPES } from './handlers/network-handler.js';
import type { RegisterNodeInput, NodeHeartbeat, UserRole, SignallingMessage, RoutingRequest } from '@stark-o/shared';
import { getServiceRegistry } from '@stark-o/shared';
import { getSupabaseServiceClient } from '../supabase/client.js';
import { getUserById } from '../supabase/auth.js';
import { getChaosIntegration, isChaosIntegrationAttached } from '../chaos/integration.js';

const logger = createLogger({ component: 'ws-connection-manager' });

/**
 * Generic WebSocket message structure
 */
export interface WsMessage<T = unknown> {
  type: string;
  payload: T;
  correlationId?: string;
}

/**
 * Connection metadata stored for each WebSocket
 */
export interface ConnectionInfo {
  /** Unique connection ID */
  id: string;
  /** WebSocket instance */
  ws: WebSocket;
  /** User ID (from authentication) */
  userId?: string;
  /** User roles (from authentication) */
  userRoles?: UserRole[];
  /** IP address of the client */
  ipAddress?: string;
  /** User agent string */
  userAgent?: string;
  /** Node IDs registered on this connection */
  nodeIds: Set<string>;
  /** When the connection was established */
  connectedAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
  /** Whether the connection is authenticated */
  isAuthenticated: boolean;
  /** Connection type: 'agent' for node agents (Supabase JWT), 'pod' for pod subprocesses (pod token) */
  connectionType?: 'agent' | 'pod';
}

/**
 * All WebSocket message types handled by the connection manager
 */
export type WsMessageType =
  | 'connected'
  | 'disconnect'
  | 'error'
  | 'node:register'
  | 'node:register:ack'
  | 'node:register:error'
  | 'node:reconnect'
  | 'node:reconnect:ack'
  | 'node:reconnect:error'
  | 'node:heartbeat'
  | 'node:heartbeat:ack'
  | 'node:heartbeat:error'
  | 'auth:authenticate'
  | 'auth:authenticated'
  | 'auth:error'
  | 'ping'
  | 'pong';

/**
 * Authentication result
 */
export interface AuthResult {
  success: boolean;
  userId?: string;
  userRoles?: UserRole[];
  error?: string;
}

/**
 * Authentication handler function type
 */
export type AuthHandler = (token: string) => Promise<AuthResult>;

/**
 * Connection manager options
 */
export interface ConnectionManagerOptions {
  /** Ping interval in milliseconds (default: 30000) */
  pingInterval?: number;
  /** Pong timeout in milliseconds (default: 10000) */
  pongTimeout?: number;
  /** Maximum message size in bytes (default: 1MB) */
  maxMessageSize?: number;
  /** Authentication handler */
  authHandler?: AuthHandler;
  /** Whether to require authentication (default: true in production) */
  requireAuth?: boolean;
}

/**
 * Default authentication handler using Supabase JWT validation
 */
const devAuthHandler: AuthHandler = async (token: string): Promise<AuthResult> => {
  if (!token) {
    return { success: false, error: 'Token required' };
  }

  try {
    // Use Supabase service client to verify the JWT token
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      logger.debug('JWT validation failed', { error: error?.message });
      return { success: false, error: error?.message || 'Invalid token' };
    }

    // Fetch user roles from users table
    const userResult = await getUserById(data.user.id);
    const userRoles: UserRole[] = userResult.data?.roles ?? ['user'];

    return { success: true, userId: data.user.id, userRoles };
  } catch (err) {
    logger.error('Auth handler error', { error: err instanceof Error ? err.message : 'Unknown error' });
    return { success: false, error: 'Authentication failed' };
  }
};

/**
 * WebSocket Connection Manager
 *
 * Manages all WebSocket connections to the orchestrator server.
 * Handles:
 * - Connection lifecycle (connect, disconnect, reconnect)
 * - Authentication
 * - Message routing to appropriate handlers
 * - Heartbeat/ping-pong for connection health
 * - Connection tracking and cleanup
 */
export class ConnectionManager {
  private connections = new Map<string, ConnectionInfo>();
  /** Reverse index: nodeId → connectionId */
  private nodeToConnection = new Map<string, string>();
  /** Reverse index: podId → connectionId (for direct pod connections) */
  private podToConnection = new Map<string, string>();
  /** Reverse index: connectionId → Set of podIds (for cleanup on disconnect) */
  private connectionToPods = new Map<string, Set<string>>();
  /** Current connection being processed (for registration callbacks) */
  private currentConnectionId: string | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly options: Required<ConnectionManagerOptions>;
  private networkHandlers: ReturnType<typeof createNetworkWsHandlers> | null = null;

  constructor(options: ConnectionManagerOptions = {}) {
    this.options = {
      pingInterval: options.pingInterval ?? 30000,
      pongTimeout: options.pongTimeout ?? 10000,
      maxMessageSize: options.maxMessageSize ?? 1024 * 1024, // 1MB
      authHandler: options.authHandler ?? devAuthHandler,
      requireAuth: options.requireAuth ?? process.env.NODE_ENV === 'production',
    };
  }

  /**
   * Attach the connection manager to a WebSocket server
   */
  attach(wss: WebSocketServer): void {
    wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });

    // Initialise network (signalling) handlers
    this.networkHandlers = createNetworkWsHandlers({
      sendToPod: (podId, message) => this.sendToPod(podId, message),
      sendToNode: (nodeId, message) => this.sendToNodeId(nodeId, message),
      registerPodConnection: (podId, serviceId) => this.registerPodConnection(podId, serviceId),
    });

    // Start ping interval
    this.startPingInterval();

    logger.info('Connection manager attached to WebSocket server');
  }

  /**
   * Register a pod's direct connection for WebRTC signaling.
   * Also marks the connection as authenticated (pod tokens are validated by the network handler).
   */
  private registerPodConnection(podId: string, _serviceId: string): void {
    if (this.currentConnectionId) {
      this.podToConnection.set(podId, this.currentConnectionId);
      
      // Track pod for cleanup when connection closes
      let pods = this.connectionToPods.get(this.currentConnectionId);
      if (!pods) {
        pods = new Set();
        this.connectionToPods.set(this.currentConnectionId, pods);
      }
      pods.add(podId);

      // Mark the connection as authenticated — the pod token has been validated
      // by handlePodRegister before this method is called. This allows subsequent
      // network:signal and network:route:request messages to pass the auth gate.
      const conn = this.connections.get(this.currentConnectionId);
      if (conn && !conn.isAuthenticated) {
        conn.isAuthenticated = true;
        conn.userId = podId; // Use podId as the identity for pod connections
        conn.connectionType = 'pod'; // Restrict to network:* messages only
        logger.debug('Pod connection marked as authenticated via pod token', {
          podId,
          connectionId: this.currentConnectionId,
        });
      }
      
      logger.debug('Pod registered for direct signaling', {
        podId,
        connectionId: this.currentConnectionId,
      });
    }
  }

  /**
   * Get all active connections
   */
  getConnections(): Map<string, ConnectionInfo> {
    return new Map(this.connections);
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): ConnectionInfo | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get authenticated connection count
   */
  getAuthenticatedConnectionCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.isAuthenticated) count++;
    }
    return count;
  }

  /**
   * Close all connections and cleanup
   */
  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const [id, conn] of this.connections) {
      this.sendMessage(conn.ws, {
        type: 'disconnect',
        payload: { reason: 'Server shutting down' },
      });
      conn.ws.close(1001, 'Server shutting down');
      this.connections.delete(id);
    }

    logger.info('Connection manager shutdown complete');
  }

  /**
   * Handle a new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const connectionId = randomUUID();
    const ipAddress = this.extractIpAddress(request);
    const userAgent = request.headers['user-agent'];

    const connectionInfo: ConnectionInfo = {
      id: connectionId,
      ws,
      ipAddress,
      userAgent,
      nodeIds: new Set(),
      connectedAt: new Date(),
      lastActivity: new Date(),
      isAuthenticated: false,
    };

    this.connections.set(connectionId, connectionInfo);

    logger.info('New WebSocket connection', {
      connectionId,
      ipAddress,
      userAgent,
    });

    // Set up event handlers
    ws.on('message', (data) => this.handleMessage(connectionId, data));
    ws.on('close', (code, reason) => this.handleClose(connectionId, code, reason));
    ws.on('error', (error) => this.handleError(connectionId, error));
    ws.on('pong', () => this.handlePong(connectionId));

    // Send welcome message with connection ID
    this.sendMessage(ws, {
      type: 'connected',
      payload: {
        connectionId,
        requiresAuth: this.options.requireAuth,
      },
    });
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(connectionId: string, data: unknown): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.lastActivity = new Date();

    let message: WsMessage;
    try {
      const rawData = Buffer.isBuffer(data) ? data.toString() : String(data);

      // Check message size
      if (rawData.length > this.options.maxMessageSize) {
        this.sendError(conn.ws, 'MESSAGE_TOO_LARGE', 'Message exceeds maximum size');
        return;
      }

      message = JSON.parse(rawData);
    } catch {
      this.sendError(conn.ws, 'INVALID_JSON', 'Failed to parse message');
      return;
    }

    // Validate message structure
    if (!message.type || typeof message.type !== 'string') {
      this.sendError(conn.ws, 'INVALID_MESSAGE', 'Message type is required');
      return;
    }

    logger.debug('Received message', {
      connectionId,
      type: message.type,
      correlationId: message.correlationId,
    });

    // Route message to appropriate handler
    await this.routeMessage(conn, message);
  }

  /**
   * Route message to the appropriate handler
   */
  private async routeMessage(conn: ConnectionInfo, message: WsMessage): Promise<void> {
    // Intercept incoming messages for chaos testing
    const chaosAttached = isChaosIntegrationAttached();
    if (chaosAttached) {
      const nodeId = this.getFirstNodeId(conn);
      console.log(`[CM-Chaos] routeMessage: type=${message.type}, nodeId=${nodeId ?? 'undefined'}, connNodeIds=${Array.from(conn.nodeIds).join(',') || 'empty'}`);
      const chaosResult = await getChaosIntegration().interceptIncomingMessage(
        conn.id,
        nodeId,
        message
      );

      if (!chaosResult.process) {
        // Message was dropped by chaos proxy
        logger.debug('Message dropped by chaos proxy', {
          connectionId: conn.id,
          type: message.type,
        });
        return;
      }

      if (chaosResult.delayMs && chaosResult.delayMs > 0) {
        // Delay message processing
        logger.debug('Message delayed by chaos proxy', {
          connectionId: conn.id,
          type: message.type,
          delayMs: chaosResult.delayMs,
        });
        await new Promise(resolve => setTimeout(resolve, chaosResult.delayMs));
      }
    }

    const wsConnection = this.createWsConnection(conn);

    switch (message.type) {
      case 'auth:authenticate':
        await this.handleAuthenticate(conn, message);
        break;

      case 'ping':
        this.sendMessage(conn.ws, {
          type: 'pong',
          payload: { timestamp: Date.now() },
          correlationId: message.correlationId,
        });
        break;

      case 'node:register':
        // Require authentication for node registration (agents only, not pod connections)
        if (this.options.requireAuth && (!conn.isAuthenticated || conn.connectionType === 'pod')) {
          this.sendMessage(conn.ws, {
            type: 'node:register:error',
            payload: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            correlationId: message.correlationId,
          });
          return;
        }
        await handleNodeRegister(wsConnection, message as WsMessage<RegisterNodeInput>);
        break;

      case 'node:reconnect':
        // Require authentication for node reconnection (agents only, not pod connections)
        if (this.options.requireAuth && (!conn.isAuthenticated || conn.connectionType === 'pod')) {
          this.sendMessage(conn.ws, {
            type: 'node:reconnect:error',
            payload: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            correlationId: message.correlationId,
          });
          return;
        }
        await handleNodeReconnect(wsConnection, message as WsMessage<ReconnectNodePayload>);
        break;

      case 'node:heartbeat':
        // Require authentication for heartbeat (agents only, not pod connections)
        if (this.options.requireAuth && (!conn.isAuthenticated || conn.connectionType === 'pod')) {
          this.sendMessage(conn.ws, {
            type: 'node:heartbeat:error',
            payload: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            correlationId: message.correlationId,
          });
          return;
        }
        await handleNodeHeartbeat(wsConnection, message as WsMessage<NodeHeartbeat>);
        break;

      default:
        // Check if it's a network message (WebRTC signalling, routing, registry)
        if (message.type.startsWith('network:')) {
          // Pod registration has its own pod-token auth — exempt from connection-level auth.
          // All other network messages require connection-level auth.
          const isPodRegister = message.type === NETWORK_WS_TYPES.POD_REGISTER;
          if (!isPodRegister && this.options.requireAuth && !conn.isAuthenticated) {
            this.sendMessage(conn.ws, {
              type: `${message.type}:error`,
              payload: { code: 'UNAUTHORIZED', message: 'Authentication required' },
              correlationId: message.correlationId,
            });
            return;
          }
          if (this.networkHandlers) {
            // Track current connection for pod registration
            this.currentConnectionId = conn.id;
            try {
              switch (message.type) {
                case NETWORK_WS_TYPES.SIGNAL:
                  this.networkHandlers.handleSignalRelay(
                    message as WsMessage<SignallingMessage>,
                    conn.userId,
                    conn.connectionType,
                  );
                  return;
                case NETWORK_WS_TYPES.ROUTE_REQUEST:
                  this.networkHandlers.handleRoutingRequest(
                    message as WsMessage<RoutingRequest>,
                    (response) => this.sendMessage(conn.ws, response),
                    conn.userId,
                    conn.connectionType,
                  );
                  return;
                case NETWORK_WS_TYPES.REGISTRY_HEARTBEAT:
                  this.networkHandlers.handleRegistryHeartbeat(
                    message as WsMessage<{ serviceId: string; podId: string; nodeId: string }>,
                    conn.userId,
                    conn.connectionType,
                  );
                  return;
                case NETWORK_WS_TYPES.POD_REGISTER:
                  this.networkHandlers.handlePodRegister(
                    message as WsMessage<{ podId: string; serviceId: string; authToken?: string }>,
                    (response) => this.sendMessage(conn.ws, response),
                  );
                  return;
                default:
                  break; // fall through to unknown
              }
            } finally {
              this.currentConnectionId = null;
            }
          }
        }

        // Check if it's a pod message
        if (message.type.startsWith('pod:')) {
          // Require authentication for pod operations (agents only, not pod connections)
          if (this.options.requireAuth && (!conn.isAuthenticated || conn.connectionType === 'pod')) {
            this.sendMessage(conn.ws, {
              type: `${message.type}:error`,
              payload: { code: 'UNAUTHORIZED', message: 'Authentication required' },
              correlationId: message.correlationId,
            });
            return;
          }
          const result = routePodMessage(wsConnection, message);
          if (result !== undefined) {
            await result; // Message was handled by pod router
            return;
          }
        }

        // Check if it's a metrics message
        if (message.type.startsWith('metrics:')) {
          // Require authentication for metrics operations (agents only, not pod connections)
          if (this.options.requireAuth && (!conn.isAuthenticated || conn.connectionType === 'pod')) {
            this.sendMessage(conn.ws, {
              type: `${message.type}:error`,
              payload: { code: 'UNAUTHORIZED', message: 'Authentication required' },
              correlationId: message.correlationId,
            });
            return;
          }
          await routeMetricsMessage(wsConnection, message);
          return;
        }

        this.sendError(
          conn.ws,
          'UNKNOWN_MESSAGE_TYPE',
          `Unknown message type: ${message.type}`,
          message.correlationId
        );
    }
  }

  /**
   * Handle authentication message
   */
  private async handleAuthenticate(conn: ConnectionInfo, message: WsMessage): Promise<void> {
    const { payload, correlationId } = message;
    const token = (payload as { token?: string })?.token;

    if (!token) {
      this.sendMessage(conn.ws, {
        type: 'auth:error',
        payload: { code: 'INVALID_TOKEN', message: 'Token is required' },
        correlationId,
      });
      return;
    }

    try {
      const result = await this.options.authHandler(token);

      if (result.success && result.userId) {
        conn.isAuthenticated = true;
        conn.userId = result.userId;
        conn.userRoles = result.userRoles;
        conn.connectionType = 'agent'; // Full agent access

        logger.info('Connection authenticated', {
          connectionId: conn.id,
          userId: result.userId,
          userRoles: result.userRoles,
        });

        this.sendMessage(conn.ws, {
          type: 'auth:authenticated',
          payload: { userId: result.userId, roles: result.userRoles },
          correlationId,
        });
      } else {
        this.sendMessage(conn.ws, {
          type: 'auth:error',
          payload: { code: 'AUTH_FAILED', message: result.error ?? 'Authentication failed' },
          correlationId,
        });
      }
    } catch (error) {
      logger.error('Authentication error', { error, connectionId: conn.id });
      this.sendMessage(conn.ws, {
        type: 'auth:error',
        payload: { code: 'AUTH_ERROR', message: 'Authentication error' },
        correlationId,
      });
    }
  }

  /**
   * Handle WebSocket close event
   */
  private async handleClose(
    connectionId: string,
    code: number,
    reason: Buffer
  ): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    logger.info('WebSocket connection closed', {
      connectionId,
      code,
      reason: reason.toString(),
    });

    // Clean up browser pods registered on this connection
    const pods = this.connectionToPods.get(connectionId);
    if (pods && pods.size > 0) {
      logger.debug('Cleaning up browser pods on connection close', {
        connectionId,
        podCount: pods.size,
        podIds: Array.from(pods),
      });
      for (const podId of pods) {
        // Unregister from ServiceRegistry
        if (this.networkHandlers) {
          this.networkHandlers.handlePodDisconnected(podId);
        }
        // Clean up pod-to-connection mapping
        this.podToConnection.delete(podId);
      }
      this.connectionToPods.delete(connectionId);
    }

    // Call node disconnect handler to clean up any registered nodes
    const wsConnection = this.createWsConnection(conn);
    await handleNodeDisconnect(wsConnection);

    this.connections.delete(connectionId);
  }

  /**
   * Handle WebSocket error
   */
  private handleError(connectionId: string, error: Error): void {
    logger.error('WebSocket error', { connectionId, error: error.message });
  }

  /**
   * Handle pong response (for connection health checking)
   */
  private handlePong(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.lastActivity = new Date();
    }
  }

  /**
   * Get the first node ID from a connection (for chaos proxy)
   */
  private getFirstNodeId(conn: ConnectionInfo): string | undefined {
    if (conn.nodeIds.size > 0) {
      return conn.nodeIds.values().next().value;
    }
    return undefined;
  }

  /**
   * Create a WsConnection interface for handlers
   */
  private createWsConnection(conn: ConnectionInfo): WsConnection {
    return {
      id: conn.id,
      send: (data: string) => conn.ws.send(data),
      close: () => conn.ws.close(),
      terminate: () => conn.ws.terminate(),
      userId: conn.userId,
      userRoles: conn.userRoles,
    };
  }

  /**
   * Send a message to a WebSocket
   */
  private sendMessage(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send an error message to a WebSocket
   */
  private sendError(
    ws: WebSocket,
    code: string,
    message: string,
    correlationId?: string
  ): void {
    this.sendMessage(ws, {
      type: 'error',
      payload: { code, message },
      correlationId,
    });
  }

  /**
   * Start the ping interval for connection health checking
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.options.pongTimeout;

      for (const [id, conn] of this.connections) {
        const lastActivity = conn.lastActivity.getTime();

        // Check if connection has timed out
        if (now - lastActivity > this.options.pingInterval + timeout) {
          logger.warn('Connection timed out', { connectionId: id });
          conn.ws.terminate();
          this.connections.delete(id);
          continue;
        }

        // Send ping
        if (conn.ws.readyState === conn.ws.OPEN) {
          conn.ws.ping();
        }
      }
    }, this.options.pingInterval);
  }

  /**
   * Extract IP address from the request
   */
  private extractIpAddress(request: IncomingMessage): string | undefined {
    // Check for forwarded headers (behind proxy)
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = typeof forwarded === 'string' ? forwarded : forwarded[0];
      return ips?.split(',')[0]?.trim();
    }

    // Fall back to socket address
    return request.socket.remoteAddress;
  }

  /**
   * Register a node ID to a connection
   */
  registerNodeToConnection(connectionId: string, nodeId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.nodeIds.add(nodeId);
      this.nodeToConnection.set(nodeId, connectionId);
    }
  }

  /**
   * Unregister a node ID from a connection
   */
  unregisterNodeFromConnection(connectionId: string, nodeId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.nodeIds.delete(nodeId);
    }
    this.nodeToConnection.delete(nodeId);
  }

  /**
   * Get all node IDs for a connection
   */
  getConnectionNodes(connectionId: string): Set<string> {
    const conn = this.connections.get(connectionId);
    return conn ? new Set(conn.nodeIds) : new Set();
  }

  /**
   * Broadcast a message to all authenticated connections
   */
  broadcast(message: WsMessage, filter?: (conn: ConnectionInfo) => boolean): void {
    for (const conn of this.connections.values()) {
      if (!conn.isAuthenticated) continue;
      if (filter && !filter(conn)) continue;

      this.sendMessage(conn.ws, message);
    }
  }

  /**
   * Send a message to a specific connection
   */
  sendToConnection(connectionId: string, message: WsMessage): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;

    this.sendMessage(conn.ws, message);
    return true;
  }

  /**
   * Send a message to a specific node by its nodeId (not connectionId).
   * Uses the nodeToConnection reverse index.
   */
  sendToNodeId(nodeId: string, message: WsMessage): boolean {
    const connectionId = this.nodeToConnection.get(nodeId);
    if (!connectionId) return false;
    return this.sendToConnection(connectionId, message);
  }

  /**
   * Send a message to a pod.
   *
   * First tries direct pod connection (pod subprocess connected directly),
   * then falls back to routing through the node agent hosting the pod.
   */
  sendToPod(podId: string, message: WsMessage): boolean {
    // First: check for direct pod connection (pod subprocess connected directly)
    const directConnectionId = this.podToConnection.get(podId);
    if (directConnectionId) {
      const sent = this.sendToConnection(directConnectionId, message);
      if (sent) {
        logger.debug('Message sent to pod via direct connection', { podId });
        return true;
      }
      // Connection may have closed, clean up stale entry
      this.podToConnection.delete(podId);
    }

    // Fallback: route through node agent
    const registry = getServiceRegistry();
    const snapshot = registry.snapshot();
    for (const entries of Object.values(snapshot)) {
      const entry = entries.find((e) => e.podId === podId);
      if (entry && entry.nodeId !== 'direct') {
        return this.sendToNodeId(entry.nodeId, message);
      }
    }
    logger.warn('sendToPod failed — pod not found', { podId });
    return false;
  }
}

/**
 * Create a connection manager instance
 */
export function createConnectionManager(
  options?: ConnectionManagerOptions
): ConnectionManager {
  return new ConnectionManager(options);
}

/**
 * Default export for convenience
 */
export default ConnectionManager;
