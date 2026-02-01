/**
 * Node Agent
 * @module @stark-o/node-runtime/agent/node-agent
 *
 * Agent that runs on Node.js servers to register with the orchestrator,
 * send heartbeats, and receive pod deployment commands.
 */
import { type Logger } from '@stark-o/shared';
import type { RuntimeType, AllocatableResources, NodeCapabilities } from '@stark-o/shared';
import type { Labels, Annotations } from '@stark-o/shared';
import type { Taint } from '@stark-o/shared';
/**
 * Node agent configuration
 */
export interface NodeAgentConfig {
    /** Orchestrator WebSocket URL (e.g., wss://localhost:443/ws) */
    orchestratorUrl: string;
    /** Authentication token */
    authToken: string;
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
    /** Logger instance */
    logger?: Logger;
}
/**
 * Node agent events
 */
export type NodeAgentEvent = 'connecting' | 'connected' | 'authenticated' | 'registered' | 'heartbeat' | 'disconnected' | 'reconnecting' | 'error' | 'stopped';
/**
 * Event handler type
 */
export type NodeAgentEventHandler = (event: NodeAgentEvent, data?: unknown) => void;
/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticating' | 'authenticated' | 'registering' | 'registered';
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
 */
export declare class NodeAgent {
    private readonly config;
    private ws;
    private nodeId;
    private connectionId;
    private state;
    private heartbeatTimer;
    private reconnectTimer;
    private reconnectAttempts;
    private isShuttingDown;
    private pendingRequests;
    private eventHandlers;
    private allocatedResources;
    constructor(config: NodeAgentConfig);
    /**
     * Get the current connection state
     */
    getState(): ConnectionState;
    /**
     * Get the registered node ID
     */
    getNodeId(): string | null;
    /**
     * Get the connection ID
     */
    getConnectionId(): string | null;
    /**
     * Check if the agent is connected and registered
     */
    isRegistered(): boolean;
    /**
     * Add an event handler
     */
    on(handler: NodeAgentEventHandler): () => void;
    /**
     * Remove an event handler
     */
    off(handler: NodeAgentEventHandler): void;
    /**
     * Emit an event to all handlers
     */
    private emit;
    /**
     * Start the agent - connect, authenticate, register, and begin heartbeats
     */
    start(): Promise<void>;
    /**
     * Stop the agent - disconnect and cleanup
     */
    stop(): Promise<void>;
    /**
     * Update allocated resources (called when pods are added/removed)
     */
    updateAllocatedResources(resources: Partial<AllocatableResources>): void;
    /**
     * Connect to the orchestrator
     */
    private connect;
    /**
     * Handle incoming WebSocket message
     */
    private handleMessage;
    /**
     * Handle WebSocket close
     */
    private handleClose;
    /**
     * Schedule a reconnection attempt
     */
    private scheduleReconnect;
    /**
     * Cancel pending reconnection
     */
    private cancelReconnect;
    /**
     * Authenticate with the orchestrator
     */
    private authenticate;
    /**
     * Register the node with the orchestrator
     */
    private register;
    /**
     * Start the heartbeat timer
     */
    private startHeartbeat;
    /**
     * Stop the heartbeat timer
     */
    private stopHeartbeat;
    /**
     * Send a heartbeat to the orchestrator
     */
    private sendHeartbeat;
    /**
     * Send a message over WebSocket
     */
    private send;
    /**
     * Send a request and wait for response
     */
    private sendRequest;
    /**
     * Clear all pending requests with an error
     */
    private clearPendingRequests;
}
/**
 * Create a new NodeAgent instance
 */
export declare function createNodeAgent(config: NodeAgentConfig): NodeAgent;
//# sourceMappingURL=node-agent.d.ts.map