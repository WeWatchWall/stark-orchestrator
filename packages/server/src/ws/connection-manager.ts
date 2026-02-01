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
import type { RegisterNodeInput, NodeHeartbeat } from '@stark-o/shared';
import { getSupabaseServiceClient } from '../supabase/client.js';

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

    return { success: true, userId: data.user.id };
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
  private pingInterval: NodeJS.Timeout | null = null;
  private readonly options: Required<ConnectionManagerOptions>;

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

    // Start ping interval
    this.startPingInterval();

    logger.info('Connection manager attached to WebSocket server');
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
        // Require authentication for node registration
        if (this.options.requireAuth && !conn.isAuthenticated) {
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
        // Require authentication for node reconnection
        if (this.options.requireAuth && !conn.isAuthenticated) {
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
        // Require authentication for heartbeat
        if (this.options.requireAuth && !conn.isAuthenticated) {
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
        // Check if it's a pod message
        if (message.type.startsWith('pod:')) {
          // Require authentication for pod operations
          if (this.options.requireAuth && !conn.isAuthenticated) {
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

        logger.info('Connection authenticated', {
          connectionId: conn.id,
          userId: result.userId,
        });

        this.sendMessage(conn.ws, {
          type: 'auth:authenticated',
          payload: { userId: result.userId },
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
   * Create a WsConnection interface for handlers
   */
  private createWsConnection(conn: ConnectionInfo): WsConnection {
    return {
      id: conn.id,
      send: (data: string) => conn.ws.send(data),
      close: () => conn.ws.close(),
      userId: conn.userId,
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
