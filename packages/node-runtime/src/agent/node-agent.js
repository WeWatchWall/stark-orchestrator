/**
 * Node Agent
 * @module @stark-o/node-runtime/agent/node-agent
 *
 * Agent that runs on Node.js servers to register with the orchestrator,
 * send heartbeats, and receive pod deployment commands.
 */
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { createServiceLogger } from '@stark-o/shared';
/**
 * Default allocatable resources for Node.js runtime
 */
const DEFAULT_NODE_ALLOCATABLE = {
    cpu: 1000, // 1 CPU core
    memory: 1024, // 1 GB
    pods: 10, // 10 concurrent pods
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
 */
export class NodeAgent {
    config;
    ws = null;
    nodeId = null;
    connectionId = null;
    state = 'disconnected';
    heartbeatTimer = null;
    reconnectTimer = null;
    reconnectAttempts = 0;
    isShuttingDown = false;
    pendingRequests = new Map();
    eventHandlers = new Set();
    allocatedResources = {
        cpu: 0,
        memory: 0,
        pods: 0,
        storage: 0,
    };
    constructor(config) {
        this.config = {
            orchestratorUrl: config.orchestratorUrl,
            authToken: config.authToken,
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
            logger: config.logger ?? createServiceLogger({
                component: 'node-agent',
                service: 'stark-node-runtime',
            }),
        };
    }
    /**
     * Get the current connection state
     */
    getState() {
        return this.state;
    }
    /**
     * Get the registered node ID
     */
    getNodeId() {
        return this.nodeId;
    }
    /**
     * Get the connection ID
     */
    getConnectionId() {
        return this.connectionId;
    }
    /**
     * Check if the agent is connected and registered
     */
    isRegistered() {
        return this.state === 'registered';
    }
    /**
     * Add an event handler
     */
    on(handler) {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
    }
    /**
     * Remove an event handler
     */
    off(handler) {
        this.eventHandlers.delete(handler);
    }
    /**
     * Emit an event to all handlers
     */
    emit(event, data) {
        for (const handler of this.eventHandlers) {
            try {
                handler(event, data);
            }
            catch (error) {
                this.config.logger.error('Event handler error', { event, error });
            }
        }
    }
    /**
     * Start the agent - connect, authenticate, register, and begin heartbeats
     */
    async start() {
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
    async stop() {
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
        this.config.logger.info('Node agent stopped');
    }
    /**
     * Update allocated resources (called when pods are added/removed)
     */
    updateAllocatedResources(resources) {
        this.allocatedResources = {
            ...this.allocatedResources,
            ...resources,
        };
    }
    /**
     * Connect to the orchestrator
     */
    async connect() {
        if (this.isShuttingDown)
            return;
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
            }
            catch (error) {
                this.config.logger.error('Failed to create WebSocket connection', { error });
                this.emit('error', error);
                reject(error);
            }
        });
    }
    /**
     * Handle incoming WebSocket message
     */
    async handleMessage(data) {
        let message;
        try {
            message = JSON.parse(data.toString());
        }
        catch {
            this.config.logger.error('Failed to parse message', { data: data.toString() });
            return;
        }
        this.config.logger.debug('Received message', {
            type: message.type,
            correlationId: message.correlationId,
        });
        // Handle correlation-based responses
        if (message.correlationId && this.pendingRequests.has(message.correlationId)) {
            const pending = this.pendingRequests.get(message.correlationId);
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(message.correlationId);
            // Check for error responses
            if (message.type.endsWith(':error')) {
                pending.reject(message.payload);
            }
            else {
                pending.resolve(message.payload);
            }
            return;
        }
        // Handle server-initiated messages
        switch (message.type) {
            case 'connected':
                // Server sends this on connection, start authentication
                this.connectionId = message.payload?.connectionId ?? null;
                await this.authenticate();
                break;
            case 'ping':
                this.send({ type: 'pong', payload: { timestamp: Date.now() } });
                break;
            case 'disconnect':
                this.config.logger.info('Server requested disconnect', { payload: message.payload });
                break;
            default:
                this.config.logger.debug('Unhandled message type', { type: message.type });
        }
    }
    /**
     * Handle WebSocket close
     */
    handleClose(code, reason) {
        this.config.logger.info('WebSocket closed', { code, reason });
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
    scheduleReconnect() {
        if (this.isShuttingDown)
            return;
        if (this.config.maxReconnectAttempts !== -1 &&
            this.reconnectAttempts >= this.config.maxReconnectAttempts) {
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
            }
            catch (error) {
                this.config.logger.error('Reconnect failed', { error });
                this.scheduleReconnect();
            }
        }, delay);
    }
    /**
     * Cancel pending reconnection
     */
    cancelReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    /**
     * Authenticate with the orchestrator
     */
    async authenticate() {
        this.state = 'authenticating';
        this.config.logger.info('Authenticating with orchestrator');
        try {
            await this.sendRequest('auth:authenticate', {
                token: this.config.authToken,
            });
            this.state = 'authenticated';
            this.emit('authenticated');
            this.config.logger.info('Authenticated successfully');
            // Proceed to registration
            await this.register();
        }
        catch (error) {
            this.config.logger.error('Authentication failed', { error });
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Register the node with the orchestrator
     */
    async register() {
        this.state = 'registering';
        this.config.logger.info('Registering node', { nodeName: this.config.nodeName });
        const registerInput = {
            name: this.config.nodeName,
            runtimeType: this.config.runtimeType,
            capabilities: this.config.capabilities,
            allocatable: this.config.allocatable,
            labels: this.config.labels,
            annotations: this.config.annotations,
            taints: this.config.taints,
        };
        try {
            const response = await this.sendRequest('node:register', registerInput);
            this.nodeId = response.node.id;
            this.state = 'registered';
            this.emit('registered', response.node);
            this.config.logger.info('Node registered', {
                nodeId: this.nodeId,
                nodeName: this.config.nodeName,
            });
            // Start heartbeat
            this.startHeartbeat();
        }
        catch (error) {
            this.config.logger.error('Registration failed', { error });
            this.emit('error', error);
            throw error;
        }
    }
    /**
     * Start the heartbeat timer
     */
    startHeartbeat() {
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
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    /**
     * Send a heartbeat to the orchestrator
     */
    async sendHeartbeat() {
        if (!this.nodeId || this.state !== 'registered') {
            return;
        }
        const heartbeat = {
            nodeId: this.nodeId,
            status: 'online',
            allocated: this.allocatedResources,
            timestamp: new Date(),
        };
        try {
            await this.sendRequest('node:heartbeat', heartbeat);
            this.emit('heartbeat');
            this.config.logger.debug('Heartbeat sent', { nodeId: this.nodeId });
        }
        catch (error) {
            this.config.logger.error('Heartbeat failed', { error, nodeId: this.nodeId });
            // Don't emit error for heartbeat failures, the connection close will handle reconnect
        }
    }
    /**
     * Send a message over WebSocket
     */
    send(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }
        this.ws.send(JSON.stringify(message));
    }
    /**
     * Send a request and wait for response
     */
    sendRequest(type, payload, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const correlationId = randomUUID();
            const timeoutHandle = setTimeout(() => {
                this.pendingRequests.delete(correlationId);
                reject(new Error(`Request timeout: ${type}`));
            }, timeout);
            this.pendingRequests.set(correlationId, {
                resolve: resolve,
                reject,
                timeout: timeoutHandle,
            });
            try {
                this.send({ type, payload, correlationId });
            }
            catch (error) {
                clearTimeout(timeoutHandle);
                this.pendingRequests.delete(correlationId);
                reject(error);
            }
        });
    }
    /**
     * Clear all pending requests with an error
     */
    clearPendingRequests(reason) {
        for (const [_id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(reason));
        }
        this.pendingRequests.clear();
    }
}
/**
 * Create a new NodeAgent instance
 */
export function createNodeAgent(config) {
    return new NodeAgent(config);
}
//# sourceMappingURL=node-agent.js.map