/**
 * Worker-side network proxy for Web Workers that don't have WebRTC access.
 *
 * Since RTCPeerConnection is not available in Web Workers (browser limitation),
 * this proxy forwards all network operations to the main thread via postMessage.
 * The main thread (BrowserAgent/WorkerAdapter) manages the actual WebRTC connections.
 *
 * Protocol:
 * - Worker → Main: 'network:proxy:connect', 'network:proxy:send', 'network:proxy:disconnect'
 * - Main → Worker: 'network:proxy:connected', 'network:proxy:message', 'network:proxy:error'
 *
 * @module @stark-o/browser-runtime/network/worker-network-proxy
 */

/** Message types from worker to main thread */
export interface NetworkProxyToMain {
  type:
    | 'network:proxy:register'
    | 'network:proxy:connect'
    | 'network:proxy:send'
    | 'network:proxy:disconnect'
    | 'network:proxy:disconnectAll';
  /** The pod ID of the worker sending this message (required for proper signal routing) */
  sourcePodId: string;
  correlationId?: string;
  targetPodId?: string;
  data?: string;
}

/** Message types from main thread to worker */
export interface NetworkProxyFromMain {
  type:
    | 'network:proxy:connected'
    | 'network:proxy:message'
    | 'network:proxy:error'
    | 'network:proxy:disconnected';
  correlationId?: string;
  fromPodId?: string;
  targetPodId?: string;
  data?: string;
  error?: string;
}

/** Connection state for proxy connections */
interface ProxyConnection {
  targetPodId: string;
  state: 'connecting' | 'connected' | 'failed' | 'closed';
  createdAt: number;
  lastActivity: number;
}

/** Pending connection callback */
interface PendingConnection {
  resolve: (conn: { targetPodId: string; state: string }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Worker-side network proxy that implements the same interface as WebRTCConnectionManager
 * but forwards all operations to the main thread.
 */
export class WorkerNetworkProxy {
  private localPodId: string;
  private connections = new Map<string, ProxyConnection>();
  private pendingConnections = new Map<string, PendingConnection>();
  private messageHandler: (fromPodId: string, data: string) => void;
  private correlationCounter = 0;
  private connectionTimeout: number;

  constructor(config: {
    localPodId: string;
    onMessage: (fromPodId: string, data: string) => void;
    connectionTimeout?: number;
  }) {
    this.localPodId = config.localPodId;
    this.messageHandler = config.onMessage;
    this.connectionTimeout = config.connectionTimeout ?? 10000;

    // Listen for messages from main thread
    self.addEventListener('message', this.handleMainThreadMessage.bind(this));
    
    // Register this pod with the main thread so it can receive inbound connections
    // This creates the connection manager before any signals arrive
    const registerMessage: NetworkProxyToMain = {
      type: 'network:proxy:register',
      sourcePodId: this.localPodId,
    };
    self.postMessage(registerMessage);
  }

  /**
   * Request a connection to another pod via the main thread.
   */
  async connect(targetPodId: string): Promise<{ targetPodId: string; state: string }> {
    const existing = this.connections.get(targetPodId);
    if (existing && existing.state === 'connected') {
      existing.lastActivity = Date.now();
      return { targetPodId, state: 'connected' };
    }

    // Clean up any failed connection
    if (existing) {
      this.connections.delete(targetPodId);
    }

    const correlationId = `conn-${++this.correlationCounter}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingConnections.delete(correlationId);
        const conn = this.connections.get(targetPodId);
        if (conn) conn.state = 'failed';
        reject(new Error(`Connection to pod '${targetPodId}' timed out`));
      }, this.connectionTimeout);

      this.pendingConnections.set(correlationId, { resolve, reject, timer });

      // Track the connection locally
      this.connections.set(targetPodId, {
        targetPodId,
        state: 'connecting',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });

      // Request connection from main thread
      const message: NetworkProxyToMain = {
        type: 'network:proxy:connect',
        sourcePodId: this.localPodId,
        correlationId,
        targetPodId,
      };
      self.postMessage(message);
    });
  }

  /**
   * Send data to a connected pod via the main thread.
   */
  send(targetPodId: string, data: string): void {
    const conn = this.connections.get(targetPodId);
    if (!conn || conn.state !== 'connected') {
      throw new Error(`No active connection to pod '${targetPodId}'`);
    }

    conn.lastActivity = Date.now();

    const message: NetworkProxyToMain = {
      type: 'network:proxy:send',
      sourcePodId: this.localPodId,
      targetPodId,
      data,
    };
    self.postMessage(message);
  }

  /**
   * Check if connected to a pod.
   */
  isConnected(targetPodId: string): boolean {
    const conn = this.connections.get(targetPodId);
    return conn?.state === 'connected';
  }

  /**
   * Disconnect from a specific pod.
   */
  disconnect(targetPodId: string): void {
    const conn = this.connections.get(targetPodId);
    if (conn) {
      conn.state = 'closed';
      this.connections.delete(targetPodId);

      const message: NetworkProxyToMain = {
        type: 'network:proxy:disconnect',
        sourcePodId: this.localPodId,
        targetPodId,
      };
      self.postMessage(message);
    }
  }

  /**
   * Disconnect from all pods.
   */
  disconnectAll(): void {
    for (const podId of this.connections.keys()) {
      this.connections.delete(podId);
    }

    const message: NetworkProxyToMain = {
      type: 'network:proxy:disconnectAll',
      sourcePodId: this.localPodId,
    };
    self.postMessage(message);
  }

  /**
   * Handle messages from the main thread.
   */
  private handleMainThreadMessage(event: MessageEvent): void {
    const msg = event.data as NetworkProxyFromMain;
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('network:proxy:')) {
      return;
    }

    switch (msg.type) {
      case 'network:proxy:connected': {
        const { correlationId, targetPodId } = msg;
        if (correlationId && targetPodId) {
          const pending = this.pendingConnections.get(correlationId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingConnections.delete(correlationId);

            const conn = this.connections.get(targetPodId);
            if (conn) {
              conn.state = 'connected';
              conn.lastActivity = Date.now();
            }

            pending.resolve({ targetPodId, state: 'connected' });
          }
        }
        break;
      }

      case 'network:proxy:error': {
        const { correlationId, targetPodId, error } = msg;
        if (correlationId) {
          const pending = this.pendingConnections.get(correlationId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingConnections.delete(correlationId);

            if (targetPodId) {
              const conn = this.connections.get(targetPodId);
              if (conn) conn.state = 'failed';
            }

            pending.reject(new Error(error ?? 'Connection failed'));
          }
        }
        break;
      }

      case 'network:proxy:message': {
        const { fromPodId, data } = msg;
        if (fromPodId && data) {
          // Update or create connection activity for responses
          // This handles inbound connections we didn't initiate
          let conn = this.connections.get(fromPodId);
          if (!conn) {
            // Auto-register reverse connection so we can send responses back
            conn = {
              targetPodId: fromPodId,
              state: 'connected',
              createdAt: Date.now(),
              lastActivity: Date.now(),
            };
            this.connections.set(fromPodId, conn);
          } else {
            conn.lastActivity = Date.now();
          }

          // Deliver to message handler
          this.messageHandler(fromPodId, data);
        }
        break;
      }

      case 'network:proxy:disconnected': {
        const { targetPodId } = msg;
        if (targetPodId) {
          this.connections.delete(targetPodId);
        }
        break;
      }
    }
  }

  /** Get active connection count */
  get activeCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.state === 'connected') count++;
    }
    return count;
  }
}
