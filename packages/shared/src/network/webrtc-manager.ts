/**
 * WebRTC Connection Manager
 *
 * Manages persistent WebRTC peer connections between pods.
 * Isomorphic: works in both Node.js (via simple-peer) and browser.
 *
 * Transport is kept separate from routing logic:
 * - This module only manages connections (open, close, send, receive).
 * - Routing decisions are made by the ServiceCaller / orchestrator.
 *
 * @module @stark-o/shared/network/webrtc-manager
 */

import type {
  PeerConnectionState,
  WebRTCConfig,
  RTCIceServerInit,
  SignallingMessage,
} from '../types/network.js';
import { DEFAULT_CONNECTION_TIMEOUT } from '../types/network.js';

/**
 * Default STUN servers used when no iceServers are provided.
 * Without STUN, WebRTC can only generate host candidates which often fail
 * on multi-homed machines (e.g. Windows with Hyper-V / WSL / Docker adapters)
 * because the wrtc library may pick an unreachable interface address.
 */
const DEFAULT_ICE_SERVERS: RTCIceServerInit[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Maximum number of retry attempts when a WebRTC connection times out. */
const MAX_CONNECT_RETRIES = 2;

/** Delay (ms) between retry attempts. */
const RETRY_DELAY_MS = 1_000;

// ── Peer Wrapper ────────────────────────────────────────────────────────────

/**
 * Thin wrapper around a single WebRTC peer connection to a target pod.
 */
export interface PeerConnection {
  targetPodId: string;
  state: PeerConnectionState;
  createdAt: number;
  lastActivity: number;
  /** Send a serialised message over the data channel. */
  send(data: string): void;
  /** Close the connection and clean up. */
  close(): void;
}

/**
 * Callback to deliver a signalling message to the remote pod
 * (typically relayed via the orchestrator's WebSocket).
 */
export type SignalSender = (message: SignallingMessage) => void;

/**
 * Callback invoked when a message is received from a peer.
 */
export type MessageHandler = (fromPodId: string, data: string) => void;

// ── Connection Manager ──────────────────────────────────────────────────────

/**
 * Manages all WebRTC connections for a single pod.
 *
 * Usage:
 * ```ts
 * const mgr = new WebRTCConnectionManager({
 *   localPodId: 'pod-1',
 *   signalSender: (msg) => ws.send(JSON.stringify(msg)),
 *   onMessage: (from, data) => handleIncoming(from, data),
 *   peerFactory: (initiator) => new SimplePeer({ initiator }),
 * });
 *
 * // To connect to a target pod (initiator side):
 * await mgr.connect('pod-2');
 *
 * // To send data:
 * mgr.send('pod-2', JSON.stringify(request));
 *
 * // When a signalling message arrives from the WebSocket:
 * mgr.handleSignal(signallingMessage);
 * ```
 */
export class WebRTCConnectionManager {
  private localPodId: string;
  private connections: Map<string, PeerConnectionInternal> = new Map();
  private signalSender: SignalSender;
  private onMessage: MessageHandler;
  private peerFactory: PeerFactory;
  private config: Required<WebRTCConfig>;
  private pendingConnections: Map<string, {
    resolve: (conn: PeerConnection) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();

  /** Optional callback invoked when a peer-gone notification is received. */
  private onPeerGone?: (deadPodId: string) => void;

  constructor(opts: {
    localPodId: string;
    signalSender: SignalSender;
    onMessage: MessageHandler;
    /** Factory to create a simple-peer instance. Keeps this module peer-library agnostic. */
    peerFactory: PeerFactory;
    config?: WebRTCConfig;
    /** Called when a remote peer is reported dead by the orchestrator. */
    onPeerGone?: (deadPodId: string) => void;
  }) {
    this.localPodId = opts.localPodId;
    this.signalSender = opts.signalSender;
    this.onMessage = opts.onMessage;
    this.peerFactory = opts.peerFactory;
    this.onPeerGone = opts.onPeerGone;
    this.config = {
      iceServers: opts.config?.iceServers?.length ? opts.config.iceServers : DEFAULT_ICE_SERVERS,
      connectionTimeout: opts.config?.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT,
      trickleICE: opts.config?.trickleICE ?? true,
    };
  }

  /**
   * Open a connection to a target pod (initiator side).
   * If a healthy connection already exists, returns it immediately.
   * Retries up to {@link MAX_CONNECT_RETRIES} times with a short delay on timeout.
   */
  async connect(targetPodId: string): Promise<PeerConnection> {
    const existing = this.connections.get(targetPodId);
    if (existing && existing.state === 'connected') {
      existing.lastActivity = Date.now();
      return existing;
    }

    // Clean up any dead connection
    if (existing) {
      this.destroyPeer(targetPodId);
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= MAX_CONNECT_RETRIES; attempt++) {
      try {
        return await this.createPeer(targetPodId, true);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry on timeout — other errors (e.g. peer error) are not transient
        if (!lastError.message.includes('timed out') || attempt === MAX_CONNECT_RETRIES) {
          throw lastError;
        }
        // Brief pause before retrying so signalling state can settle
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        this.destroyPeer(targetPodId);
      }
    }
    throw lastError!;
  }

  /**
   * Send data to a connected peer.
   * Throws if no connection exists or the connection is not open.
   */
  send(targetPodId: string, data: string): void {
    const conn = this.connections.get(targetPodId);
    if (!conn || conn.state !== 'connected') {
      throw new Error(`No active WebRTC connection to pod '${targetPodId}'`);
    }
    conn.send(data);
    conn.lastActivity = Date.now();
  }

  /**
   * Handle an incoming signalling message from the WebSocket relay.
   * If no connection exists for the source pod, creates one (responder side).
   */
  handleSignal(message: SignallingMessage): void {
    if (message.targetPodId !== this.localPodId) return;

    let conn = this.connections.get(message.sourcePodId);

    // If we receive a new offer but already have a non-connected peer,
    // we need to decide whether to keep our peer or yield.
    if (conn && message.type === 'offer' && conn.state !== 'connected') {
      if (conn.initiator) {
        // GLARE: both sides initiated simultaneously.  Use a deterministic
        // tie-breaker so exactly one side keeps its initiator role and the
        // other becomes the responder.  The pod with the lexicographically
        // *lower* ID keeps its initiator peer (ignores the incoming offer);
        // the pod with the *higher* ID yields and becomes the responder.
        if (this.localPodId < message.sourcePodId) {
          // We win the tie — keep our initiator, ignore the remote offer.
          return;
        }
        // We lose the tie — fall through to destroy our initiator and
        // create a responder peer for the remote's offer.
      }
      // Either a non-initiator peer that the remote is re-negotiating,
      // or we lost the glare tie-break — tear down and create a fresh
      // responder peer.
      this.destroyPeer(message.sourcePodId);
      conn = undefined;
    }

    if (!conn) {
      // We are the responder — create a non-initiator peer.
      // The Promise is intentionally fire-and-forget but we MUST catch
      // rejections (e.g. timeout) to avoid crashing the Node process.
      this.createPeer(message.sourcePodId, false).catch((err) => {
        // Peer timed out or errored on the responder side — not fatal.
        // The initiator will see the timeout on their end and can retry.
        void err;
      });
      conn = this.connections.get(message.sourcePodId);
    }

    if (conn && conn.peer) {
      conn.peer.signal(message.payload);
    }
  }

  /**
   * Handle a `network:peer-gone` notification from the orchestrator.
   * Tears down the PeerConnection for the dead pod and invokes the optional
   * callback so higher layers (e.g. ServiceCaller) can invalidate caches.
   */
  handlePeerGone(deadPodId: string): void {
    const conn = this.connections.get(deadPodId);
    if (conn) {
      this.destroyPeer(deadPodId);
    }
    this.onPeerGone?.(deadPodId);
  }

  /**
   * Check if a connection to a target pod is healthy.
   */
  isConnected(targetPodId: string): boolean {
    const conn = this.connections.get(targetPodId);
    return conn?.state === 'connected';
  }

  /**
   * Get the connection state for a target pod.
   */
  getState(targetPodId: string): PeerConnectionState {
    return this.connections.get(targetPodId)?.state ?? 'closed';
  }

  /**
   * Close a specific peer connection.
   */
  disconnect(targetPodId: string): void {
    this.destroyPeer(targetPodId);
  }

  /**
   * Close all peer connections.
   */
  disconnectAll(): void {
    for (const podId of Array.from(this.connections.keys())) {
      this.destroyPeer(podId);
    }
  }

  /**
   * Get all active connections.
   */
  listConnections(): Array<{ targetPodId: string; state: PeerConnectionState; lastActivity: number }> {
    const result: Array<{ targetPodId: string; state: PeerConnectionState; lastActivity: number }> = [];
    for (const [podId, conn] of this.connections) {
      result.push({ targetPodId: podId, state: conn.state, lastActivity: conn.lastActivity });
    }
    return result;
  }

  /**
   * Number of active (connected) peers.
   */
  get activeCount(): number {
    let count = 0;
    for (const conn of this.connections.values()) {
      if (conn.state === 'connected') count++;
    }
    return count;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private createPeer(targetPodId: string, initiator: boolean): Promise<PeerConnection> {
    return new Promise<PeerConnection>((resolve, reject) => {
      const peer = this.peerFactory(initiator, this.config);

      const conn: PeerConnectionInternal = {
        targetPodId,
        state: 'connecting',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        initiator,
        peer,
        send: (data: string) => {
          peer.send(data);
        },
        close: () => {
          this.destroyPeer(targetPodId);
        },
      };

      this.connections.set(targetPodId, conn);

      // Timeout
      const timer = setTimeout(() => {
        if (conn.state !== 'connected') {
          conn.state = 'failed';
          this.destroyPeer(targetPodId);
          reject(new Error(`WebRTC connection to pod '${targetPodId}' timed out`));
        }
      }, this.config.connectionTimeout);

      this.pendingConnections.set(targetPodId, { resolve, reject, timer });

      // Signalling: relay offers/answers/ICE candidates through the orchestrator WS
      peer.on('signal', (data: unknown) => {
        const msgType = isSDPSignal(data) ? (initiator ? 'offer' : 'answer') : 'ice-candidate';
        this.signalSender({
          type: msgType,
          sourcePodId: this.localPodId,
          targetPodId,
          payload: data,
        });
      });

      // Connection established
      peer.on('connect', () => {
        conn.state = 'connected';
        conn.lastActivity = Date.now();
        const pending = this.pendingConnections.get(targetPodId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingConnections.delete(targetPodId);
          pending.resolve(conn);
        }
      });

      // Data received
      peer.on('data', (data: Uint8Array | string) => {
        conn.lastActivity = Date.now();
        const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
        this.onMessage(targetPodId, str);
      });

      // Errors
      peer.on('error', (err: Error) => {
        conn.state = 'failed';
        // Only act if this conn is still the active one for the pod.
        // A replacement peer may already have been installed by handleSignal.
        if (this.connections.get(targetPodId) === conn) {
          const pending = this.pendingConnections.get(targetPodId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingConnections.delete(targetPodId);
            pending.reject(err);
          }
          this.destroyPeer(targetPodId);
        }
      });

      // Close
      peer.on('close', () => {
        conn.state = 'closed';
        // Only remove from the map if this conn is still the active one.
        // If a new peer was already created for this pod, leave it alone.
        if (this.connections.get(targetPodId) === conn) {
          this.connections.delete(targetPodId);
        }
      });
    });
  }

  private destroyPeer(targetPodId: string): void {
    const conn = this.connections.get(targetPodId);
    if (conn) {
      conn.state = 'closed';
      try { conn.peer.destroy(); } catch { /* ignore */ }
      this.connections.delete(targetPodId);
    }
    const pending = this.pendingConnections.get(targetPodId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingConnections.delete(targetPodId);
      // Reject so callers of connect() / createPeer() don't hang forever
      // (e.g. when an initiator peer is torn down due to glare resolution).
      pending.reject(new Error(`WebRTC connection to pod '${targetPodId}' was destroyed`));
    }
  }
}

// ── Peer Factory Interface ──────────────────────────────────────────────────

/**
 * A SimplePeer-like interface. We don't import simple-peer directly
 * so this module stays dependency-free and isomorphic.
 */
export interface SimplePeerLike {
  signal(data: unknown): void;
  send(data: string | Uint8Array): void;
  destroy(): void;
  on(event: 'signal', cb: (data: unknown) => void): void;
  on(event: 'connect', cb: () => void): void;
  on(event: 'data', cb: (data: Uint8Array | string) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'close', cb: () => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

/**
 * Factory function to create a SimplePeer-like instance.
 * Implementations differ between Node.js (simple-peer with wrtc) and browser (simple-peer native).
 */
export type PeerFactory = (initiator: boolean, config: Required<WebRTCConfig>) => SimplePeerLike;

// ── Internals ───────────────────────────────────────────────────────────────

interface PeerConnectionInternal extends PeerConnection {
  peer: SimplePeerLike;
  /** Whether this peer was created as the initiator (called connect()) or responder (received offer). */
  initiator: boolean;
}

/** Check if a signalling payload is an SDP offer/answer (vs ICE candidate). */
function isSDPSignal(data: unknown): boolean {
  if (typeof data === 'object' && data !== null && 'type' in data) {
    const t = (data as Record<string, unknown>).type;
    return t === 'offer' || t === 'answer';
  }
  // simple-peer wraps SDP in { sdp, type } — if it has 'sdp' field, it's SDP
  if (typeof data === 'object' && data !== null && 'sdp' in data) {
    return true;
  }
  return false;
}
