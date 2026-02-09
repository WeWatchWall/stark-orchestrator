/**
 * Main Thread Network Manager for Browser Runtime.
 *
 * Since Web Workers don't have access to RTCPeerConnection (browser limitation),
 * all WebRTC connections are managed by the main thread. Workers communicate
 * with other pods by sending proxy messages to the main thread, which relays
 * them through the actual WebRTC data channels.
 *
 * IMPORTANT: Each worker pod gets its own WebRTCConnectionManager. This is because
 * WebRTC signaling requires the source pod ID to be correct - each greeter-service
 * pod needs to identify itself, not as a shared "browser node" ID.
 *
 * Flow:
 * 1. Worker wants to send to another pod
 * 2. Worker sends 'network:proxy:send' to main thread via postMessage with sourcePodId
 * 3. MainThreadNetworkManager gets/creates WebRTCConnectionManager for sourcePodId
 * 4. Response comes back through WebRTC to that connection manager
 * 5. MainThreadNetworkManager sends 'network:proxy:message' to worker
 *
 * @module @stark-o/browser-runtime/network/main-thread-network-manager
 */

import {
  WebRTCConnectionManager,
  createSimplePeerFactory,
  type SignallingMessage,
} from '@stark-o/shared';
import type { NetworkProxyToMain, NetworkProxyFromMain } from './worker-network-proxy.js';

/**
 * Configuration for the main thread network manager.
 */
export interface MainThreadNetworkManagerConfig {
  /** Function to get the current WebSocket connection (allows reconnection) */
  getWebSocket: () => WebSocket | null;
  /** Browser node ID (for logging only - each pod uses its own ID for signals) */
  nodeId: string;
  /** Callback to push incoming messages to workers (used for WebRTC data received from remote pods) */
  pushToWorker: (workerId: string, msg: NetworkProxyFromMain) => void;
  /** Logger */
  logger?: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Manages WebRTC connections from the main thread, proxying for Web Workers.
 * 
 * Each worker pod gets its own WebRTCConnectionManager because WebRTC signaling
 * requires the correct source pod ID.
 */
export class MainThreadNetworkManager {
  private getWebSocket: () => WebSocket | null;
  private nodeId: string;
  private logger: Required<MainThreadNetworkManagerConfig>['logger'];
  private pushToWorker: MainThreadNetworkManagerConfig['pushToWorker'];
  
  /** Map of source pod ID -> WebRTCConnectionManager */
  private connectionManagers = new Map<string, WebRTCConnectionManager>();
  
  /** Map of workerId -> sourcePodId for message routing */
  private workerToPod = new Map<string, string>();
  
  /** Map of podId -> workerId for inbound message routing */
  private podToWorker = new Map<string, string>();

  constructor(config: MainThreadNetworkManagerConfig) {
    this.getWebSocket = config.getWebSocket;
    this.nodeId = config.nodeId;
    this.pushToWorker = config.pushToWorker;
    this.logger = config.logger ?? {
      debug: console.debug.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };
    
    this.logger.info('[MainThreadNetworkManager] Initialized for node', { nodeId: this.nodeId });
  }
  
  /**
   * Get or create a WebRTCConnectionManager for a specific pod.
   * Each worker pod needs its own manager for correct signal routing.
   */
  private getOrCreateConnectionManager(sourcePodId: string): WebRTCConnectionManager {
    let manager = this.connectionManagers.get(sourcePodId);
    if (manager) {
      return manager;
    }
    
    manager = new WebRTCConnectionManager({
      localPodId: sourcePodId,
      signalSender: (signal: SignallingMessage) => {
        const ws = this.getWebSocket();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'network:signal',
            payload: signal,
          }));
        } else {
          this.logger.warn('[MainThreadNetworkManager] WebSocket not open, cannot send signal');
        }
      },
      onMessage: (fromPodId: string, data: string) => {
        this.handleIncomingMessage(sourcePodId, fromPodId, data);
      },
      peerFactory: createSimplePeerFactory(),
      config: {
        connectionTimeout: 10_000,
        trickleICE: true,
        iceServers: [],
      },
    });
    
    this.connectionManagers.set(sourcePodId, manager);
    return manager;
  }
  
  /**
   * Clean up resources when a worker terminates.
   */
  cleanupWorker(workerId: string): void {
    // Get the pod ID for this worker and clean up its connection manager
    const podId = this.workerToPod.get(workerId);
    if (podId) {
      const manager = this.connectionManagers.get(podId);
      if (manager) {
        manager.disconnectAll();
        this.connectionManagers.delete(podId);
      }
      this.podToWorker.delete(podId);
      this.workerToPod.delete(workerId);
    }
    
    this.logger.debug('[MainThreadNetworkManager] Cleaned up worker', { workerId, podId });
  }
  
  /**
   * Handle signaling messages from the orchestrator WebSocket.
   * Route to the correct connection manager based on targetPodId.
   */
  handleSignal(signal: SignallingMessage): void {
    // Find the connection manager for the target pod (the pod receiving this signal)
    const manager = this.connectionManagers.get(signal.targetPodId);
    if (manager) {
      manager.handleSignal(signal);
    } else {
      this.logger.warn('[MainThreadNetworkManager] No connection manager for target pod', { targetPodId: signal.targetPodId });
    }
  }
  
  /**
   * Handle proxy requests from a worker.
   * This is the NetworkProxyHandler callback for WorkerAdapter.
   */
  async handleProxyRequest(
    workerId: string,
    message: NetworkProxyToMain
  ): Promise<NetworkProxyFromMain | void> {
    const sourcePodId = message.sourcePodId;
    
    // Track workerId <-> podId mapping
    if (sourcePodId && !this.workerToPod.has(workerId)) {
      this.workerToPod.set(workerId, sourcePodId);
      this.podToWorker.set(sourcePodId, workerId);
    }
    
    switch (message.type) {
      case 'network:proxy:register': {
        // Worker is registering its pod ID - create connection manager now
        // so it can receive inbound connections
        this.getOrCreateConnectionManager(sourcePodId);
        return; // No response needed
      }
      
      case 'network:proxy:connect': {
        const targetPodId = message.targetPodId!;
        try {
          // Get or create a connection manager for this source pod
          const manager = this.getOrCreateConnectionManager(sourcePodId);
          await manager.connect(targetPodId);
          return {
            type: 'network:proxy:connected',
            correlationId: message.correlationId,
            targetPodId,
          };
        } catch (err) {
          return {
            type: 'network:proxy:error',
            correlationId: message.correlationId,
            targetPodId,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
      
      case 'network:proxy:send': {
        const targetPodId = message.targetPodId!;
        try {
          const manager = this.connectionManagers.get(sourcePodId);
          if (!manager) {
            throw new Error(`No connection manager for pod ${sourcePodId}`);
          }
          manager.send(targetPodId, message.data!);
          // No response needed for send
        } catch (err) {
          // Send error back to worker
          return {
            type: 'network:proxy:error',
            targetPodId,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        break;
      }
      
      case 'network:proxy:disconnect': {
        const targetPodId = message.targetPodId!;
        const manager = this.connectionManagers.get(sourcePodId);
        if (manager) {
          manager.disconnect(targetPodId);
        }
        return {
          type: 'network:proxy:disconnected',
          targetPodId,
        };
      }
      
      case 'network:proxy:disconnectAll': {
        const manager = this.connectionManagers.get(sourcePodId);
        if (manager) {
          manager.disconnectAll();
        }
        break;
      }
    }
  }
  
  /**
   * Handle incoming messages from WebRTC connections.
   * Route to the appropriate worker based on which pod received the message.
   */
  private handleIncomingMessage(localPodId: string, fromPodId: string, data: string): void {
    // Find the worker that owns this local pod
    const workerId = this.podToWorker.get(localPodId);
    
    if (!workerId) {
      this.logger.warn('[MainThreadNetworkManager] No worker for local pod', { localPodId, fromPodId });
      return;
    }
    
    // Push the message to the worker
    this.pushToWorker(workerId, {
      type: 'network:proxy:message',
      fromPodId,
      data,
    });
  }
  
  /**
   * Clean up all connections.
   */
  destroy(): void {
    for (const manager of this.connectionManagers.values()) {
      manager.disconnectAll();
    }
    this.connectionManagers.clear();
    this.podToWorker.clear();
    this.workerToPod.clear();
    this.logger.info('[MainThreadNetworkManager] Destroyed');
  }
  
  /**
   * Get active connection count across all pods.
   */
  get activeConnectionCount(): number {
    let total = 0;
    for (const manager of this.connectionManagers.values()) {
      total += manager.activeCount;
    }
    return total;
  }
}
