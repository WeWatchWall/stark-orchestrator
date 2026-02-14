/**
 * Chaos Proxy Service
 *
 * Internal chaos injection using the proxy pattern.
 * Intercepts and manipulates service behavior for testing:
 * - Message delays/drops
 * - Heartbeat manipulation
 * - Scheduling interference
 * - Connection termination
 * - Network partitions
 * - Latency injection
 *
 * This service should ONLY be active in development/test environments.
 */

import type { ConnectionManager } from '../ws/connection-manager';
import { EventEmitter } from 'events';

/** Maximum allowed duration for chaos operations (1 hour) to prevent resource exhaustion */
const MAX_CHAOS_DURATION_MS = 3_600_000;

/** Clamp duration to a safe maximum, returns undefined if input is undefined */
function clampDuration(durationMs: number | undefined): number | undefined {
  if (durationMs === undefined) return undefined;
  return Math.min(Math.max(0, durationMs), MAX_CHAOS_DURATION_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChaosConfig {
  enabled: boolean;
  seed?: number; // For reproducible randomness
}

export type MessageDirection = 'incoming' | 'outgoing' | 'both';

export interface MessageChaosRule {
  connectionId?: string;
  nodeId?: string;
  messageTypes?: string[];
  direction?: MessageDirection; // 'incoming' = node→orch, 'outgoing' = orch→node, 'both' (default)
  dropRate: number; // 0-1, probability of dropping message
  delayMs?: number; // Optional delay before delivery
  delayJitterMs?: number; // Random jitter added to delay
}

export interface HeartbeatChaosRule {
  nodeId: string;
  delayMs: number; // Delay heartbeat processing
  delayJitterMs?: number;
  dropRate?: number; // Probability of dropping heartbeat
}

export interface SchedulerChaosRule {
  failPodIds?: string[]; // Force specific pods to fail scheduling
  failRate?: number; // Random failure rate for scheduling
  delayMs?: number; // Delay scheduling decisions
}

export interface LatencyRule {
  id: string;
  nodeId?: string;
  connectionId?: string;
  latencyMs: number;
  jitterMs: number;
  expiresAt?: number;
}

export interface NetworkPartition {
  id: string;
  nodeIds: string[];
  connectionIds: string[];
  createdAt: Date;
  expiresAt?: Date;
}

export interface PausedConnection {
  connectionId: string;
  nodeId?: string;
  pausedAt: Date;
  resumeAt?: Date;
  pendingMessages: Array<{ message: unknown; timestamp: Date }>;
}

/** Banned connection - WebSocket severed, tracked for unban */
export interface BannedNode {
  nodeId: string;
  bannedAt: Date;
  unbanAt?: Date;
}

export interface ChaosEvent {
  timestamp: Date;
  type:
    | 'message_dropped'
    | 'message_delayed'
    | 'heartbeat_dropped'
    | 'heartbeat_delayed'
    | 'connection_terminated'
    | 'connection_paused'
    | 'connection_resumed'
    | 'connection_banned'
    | 'connection_unbanned'
    | 'node_forced_offline'
    | 'scheduling_failed'
    | 'scheduling_delayed'
    | 'api_error_injected'
    | 'partition_created'
    | 'partition_removed'
    | 'latency_injected';
  details: Record<string, unknown>;
}

export interface ChaosStats {
  messagesDropped: number;
  messagesDelayed: number;
  heartbeatsDropped: number;
  heartbeatsDelayed: number;
  connectionsTerminated: number;
  connectionsPaused: number;
  connectionsBanned: number;
  nodesForceOffline: number;
  schedulingFailures: number;
  apiErrorsInjected: number;
  partitionsCreated: number;
  latencyRulesActive: number;
  events: ChaosEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Chaos Proxy Service
// ─────────────────────────────────────────────────────────────────────────────

export class ChaosProxyService extends EventEmitter {
  private enabled = false;
  private seed: number;
  private rng: () => number;

  private messageRules: MessageChaosRule[] = [];
  private heartbeatRules: Map<string, HeartbeatChaosRule> = new Map();
  private schedulerRules: SchedulerChaosRule = {};

  // Live connection manipulation state
  private partitions: Map<string, NetworkPartition> = new Map();
  private pausedConnections: Map<string, PausedConnection> = new Map();
  private bannedNodes: Map<string, BannedNode> = new Map();
  private latencyRules: Map<string, LatencyRule> = new Map();
  private partitionCounter = 0;
  private latencyRuleCounter = 0;

  private stats: ChaosStats = {
    messagesDropped: 0,
    messagesDelayed: 0,
    heartbeatsDropped: 0,
    heartbeatsDelayed: 0,
    connectionsTerminated: 0,
    connectionsPaused: 0,
    connectionsBanned: 0,
    nodesForceOffline: 0,
    schedulingFailures: 0,
    apiErrorsInjected: 0,
    partitionsCreated: 0,
    latencyRulesActive: 0,
    events: [],
  };

  // Reference to connection manager for active chaos
  private connectionManager: ConnectionManager | null = null;

  constructor(config: ChaosConfig = { enabled: false }) {
    super();
    this.enabled = config.enabled;
    this.seed = config.seed ?? Date.now();
    this.rng = this.createSeededRandom(this.seed);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Seeded Random for Reproducibility
  // ─────────────────────────────────────────────────────────────────────────

  private createSeededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Service Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  enable(): void {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[ChaosProxy] REFUSING to enable in production environment');
      return;
    }
    this.enabled = true;
    console.log('[ChaosProxy] ⚡ Chaos injection ENABLED');
    this.emit('enabled');
  }

  disable(): void {
    this.enabled = false;
    this.clearAllRules();
    console.log('[ChaosProxy] Chaos injection disabled');
    this.emit('disabled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  attach(connectionManager: ConnectionManager): void {
    this.connectionManager = connectionManager;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Message Chaos (Proxy Pattern)
  // ─────────────────────────────────────────────────────────────────────────

  addMessageRule(rule: MessageChaosRule): string {
    const ruleId = `msg_${Date.now()}_${this.messageRules.length}`;
    this.messageRules.push(rule);
    const dirLabel = rule.direction === 'incoming' ? 'node→orch' 
                   : rule.direction === 'outgoing' ? 'orch→node' 
                   : 'both';
    console.log(
      `[ChaosProxy] Added message rule: direction=${dirLabel}, dropRate=${rule.dropRate}, delay=${rule.delayMs ?? 0}ms, jitter=${rule.delayJitterMs ?? 0}ms, nodeId=${rule.nodeId ?? 'all'}`
    );
    return ruleId;
  }

  /**
   * Get all active message rules (for debugging/status)
   */
  getMessageRules(): MessageChaosRule[] {
    return [...this.messageRules];
  }

  clearMessageRules(): void {
    this.messageRules = [];
  }

  /**
   * Intercept outgoing message (orchestrator → node) - returns modified message or null if dropped
   */
  interceptOutgoingMessage(
    connectionId: string,
    nodeId: string | undefined,
    messageType: string,
    message: unknown
  ): { action: 'send' | 'drop' | 'delay'; delayMs?: number; message: unknown } {
    if (!this.enabled) {
      return { action: 'send', message };
    }

    for (const rule of this.messageRules) {
      // Check direction filter - skip if rule is for incoming only
      if (rule.direction === 'incoming') continue;
      // Check if rule matches
      if (rule.connectionId && rule.connectionId !== connectionId) continue;
      if (rule.nodeId && rule.nodeId !== nodeId) continue;
      // Empty array means "match all message types", only filter if array has items
      if (rule.messageTypes && rule.messageTypes.length > 0 && !rule.messageTypes.includes(messageType)) continue;

      // Apply drop rate
      if (this.rng() < rule.dropRate) {
        this.recordEvent('message_dropped', { connectionId, nodeId, messageType });
        this.stats.messagesDropped++;
        return { action: 'drop', message };
      }

      // Apply delay
      if (rule.delayMs && rule.delayMs > 0) {
        const jitter = rule.delayJitterMs ? this.rng() * rule.delayJitterMs : 0;
        const totalDelay = rule.delayMs + jitter;
        this.recordEvent('message_delayed', { connectionId, nodeId, messageType, delayMs: totalDelay });
        this.stats.messagesDelayed++;
        return { action: 'delay', delayMs: totalDelay, message };
      }
    }

    return { action: 'send', message };
  }

  /**
   * Intercept incoming message (e.g., heartbeats)
   */
  interceptIncomingMessage(
    connectionId: string,
    nodeId: string | undefined,
    messageType: string,
    message: unknown
  ): { action: 'process' | 'drop' | 'delay'; delayMs?: number; message: unknown } {
    if (!this.enabled) {
      return { action: 'process', message };
    }

    // Debug logging for chaos message interception
    if (this.messageRules.length > 0) {
      console.log(`[ChaosProxy] Intercepting incoming message: type=${messageType}, nodeId=${nodeId ?? 'undefined'}, rules=${this.messageRules.length}`);
    }

    // Check heartbeat-specific rules
    if (messageType === 'node:heartbeat' && nodeId) {
      const hbRule = this.heartbeatRules.get(nodeId);
      if (hbRule) {
        // Check drop
        if (hbRule.dropRate && this.rng() < hbRule.dropRate) {
          this.recordEvent('heartbeat_dropped', { nodeId });
          this.stats.heartbeatsDropped++;
          return { action: 'drop', message };
        }

        // Check delay
        if (hbRule.delayMs > 0) {
          const jitter = hbRule.delayJitterMs ? this.rng() * hbRule.delayJitterMs : 0;
          const totalDelay = hbRule.delayMs + jitter;
          this.recordEvent('heartbeat_delayed', { nodeId, delayMs: totalDelay });
          this.stats.heartbeatsDelayed++;
          return { action: 'delay', delayMs: totalDelay, message };
        }
      }
    }

    // Apply generic message rules
    for (const rule of this.messageRules) {
      // Check direction filter - skip if rule is for outgoing only
      if (rule.direction === 'outgoing') {
        console.log(`[ChaosProxy] Rule skipped: direction is outgoing-only`);
        continue;
      }
      if (rule.connectionId && rule.connectionId !== connectionId) {
        console.log(`[ChaosProxy] Rule skipped: connectionId mismatch (rule=${rule.connectionId}, actual=${connectionId})`);
        continue;
      }
      if (rule.nodeId && rule.nodeId !== nodeId) {
        console.log(`[ChaosProxy] Rule skipped: nodeId mismatch (rule=${rule.nodeId}, actual=${nodeId})`);
        continue;
      }
      // Empty array means "match all message types", only filter if array has items
      if (rule.messageTypes && rule.messageTypes.length > 0 && !rule.messageTypes.includes(messageType)) {
        console.log(`[ChaosProxy] Rule skipped: messageType not in list`);
        continue;
      }

      console.log(`[ChaosProxy] Rule matched! Applying delay=${rule.delayMs}ms, dropRate=${rule.dropRate}`);

      // Apply drop rate
      if (this.rng() < rule.dropRate) {
        this.recordEvent('message_dropped', { connectionId, nodeId, messageType, direction: 'incoming' });
        this.stats.messagesDropped++;
        return { action: 'drop', message };
      }

      // Apply delay
      if (rule.delayMs && rule.delayMs > 0) {
        const jitter = rule.delayJitterMs ? this.rng() * rule.delayJitterMs : 0;
        const totalDelay = rule.delayMs + jitter;
        this.recordEvent('message_delayed', { connectionId, nodeId, messageType, direction: 'incoming', delayMs: totalDelay });
        this.stats.messagesDelayed++;
        return { action: 'delay', delayMs: totalDelay, message };
      }
    }

    return { action: 'process', message };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Heartbeat Chaos
  // ─────────────────────────────────────────────────────────────────────────

  addHeartbeatRule(rule: HeartbeatChaosRule): void {
    this.heartbeatRules.set(rule.nodeId, rule);
    console.log(
      `[ChaosProxy] Added heartbeat rule for node ${rule.nodeId}: delay=${rule.delayMs}ms, dropRate=${rule.dropRate ?? 0}`
    );
  }

  removeHeartbeatRule(nodeId: string): void {
    this.heartbeatRules.delete(nodeId);
  }

  clearHeartbeatRules(): void {
    this.heartbeatRules.clear();
  }

  /**
   * Simulate heartbeat delays for a node
   */
  simulateHeartbeatDelay(nodeId: string, delayMs: number, durationMs: number = 30000): void {
    const safeDuration = clampDuration(durationMs) ?? 30000;
    this.addHeartbeatRule({
      nodeId,
      delayMs,
      delayJitterMs: delayMs * 0.5, // 50% jitter
    });

    setTimeout(() => {
      this.removeHeartbeatRule(nodeId);
      console.log(`[ChaosProxy] Heartbeat delay for node ${nodeId} expired`);
    }, safeDuration);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scheduler Chaos
  // ─────────────────────────────────────────────────────────────────────────

  setSchedulerRules(rules: SchedulerChaosRule): void {
    this.schedulerRules = rules;
    console.log('[ChaosProxy] Updated scheduler chaos rules:', rules);
  }

  clearSchedulerRules(): void {
    this.schedulerRules = {};
  }

  /**
   * Check if scheduling should fail for a pod
   */
  shouldFailScheduling(podId: string): { fail: boolean; reason?: string } {
    if (!this.enabled) {
      return { fail: false };
    }

    // Check specific pod failures
    if (this.schedulerRules.failPodIds?.includes(podId)) {
      this.recordEvent('scheduling_failed', { podId, reason: 'chaos_targeted' });
      this.stats.schedulingFailures++;
      return { fail: true, reason: 'CHAOS: Targeted scheduling failure' };
    }

    // Check random failure rate
    if (this.schedulerRules.failRate && this.rng() < this.schedulerRules.failRate) {
      this.recordEvent('scheduling_failed', { podId, reason: 'chaos_random' });
      this.stats.schedulingFailures++;
      return { fail: true, reason: 'CHAOS: Random scheduling failure' };
    }

    return { fail: false };
  }

  /**
   * Get scheduling delay if any
   */
  getSchedulingDelay(): number {
    if (!this.enabled || !this.schedulerRules.delayMs) {
      return 0;
    }
    this.recordEvent('scheduling_delayed', { delayMs: this.schedulerRules.delayMs });
    return this.schedulerRules.delayMs;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection Chaos
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Forcefully terminate a connection (simulates network partition)
   */
  terminateConnection(connectionId: string): boolean {
    if (!this.connectionManager) {
      console.error('[ChaosProxy] No connection manager attached');
      return false;
    }

    const conn = this.connectionManager.getConnection(connectionId);
    if (!conn) {
      console.warn(`[ChaosProxy] Connection ${connectionId} not found`);
      return false;
    }

    console.log(`[ChaosProxy] ⚡ Terminating connection ${connectionId}`);
    this.recordEvent('connection_terminated', { connectionId, nodeIds: Array.from(conn.nodeIds) });
    this.stats.connectionsTerminated++;

    // Force close the WebSocket
    conn.ws.terminate();
    return true;
  }

  /**
   * Terminate connection for a specific node
   */
  terminateNodeConnection(nodeId: string): boolean {
    if (!this.connectionManager) {
      console.error('[ChaosProxy] No connection manager attached');
      return false;
    }

    const connections = this.connectionManager.getConnections();
    for (const [connId, conn] of connections) {
      if (conn.nodeIds.has(nodeId)) {
        return this.terminateConnection(connId);
      }
    }

    console.warn(`[ChaosProxy] No connection found for node ${nodeId}`);
    return false;
  }

  /**
   * Simulate node disappearing (terminate + prevent reconnection briefly)
   */
  simulateNodeLoss(nodeId: string): boolean {
    console.log(`[ChaosProxy] ⚡ Simulating node loss: ${nodeId}`);
    this.recordEvent('node_forced_offline', { nodeId });
    this.stats.nodesForceOffline++;
    return this.terminateNodeConnection(nodeId);
  }

  /**
   * Simulate multiple nodes going offline
   */
  simulateMultiNodeLoss(nodeIds: string[]): void {
    console.log(`[ChaosProxy] ⚡ Simulating multi-node loss: ${nodeIds.length} nodes`);
    for (const nodeId of nodeIds) {
      this.simulateNodeLoss(nodeId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API Chaos (for testing backend flakiness)
  // ─────────────────────────────────────────────────────────────────────────

  private apiErrorRate = 0;
  private apiTimeoutRate = 0;
  private apiTimeoutMs = 5000;

  setApiChaos(config: {
    errorRate?: number; // 0-1, probability of 500 error
    timeoutRate?: number; // 0-1, probability of timeout
    timeoutMs?: number;
  }): void {
    this.apiErrorRate = config.errorRate ?? 0;
    this.apiTimeoutRate = config.timeoutRate ?? 0;
    this.apiTimeoutMs = config.timeoutMs ?? 5000;
    console.log('[ChaosProxy] API chaos configured:', config);
  }

  clearApiChaos(): void {
    this.apiErrorRate = 0;
    this.apiTimeoutRate = 0;
  }

  /**
   * Check if an API call should fail
   * Use this in API handlers to inject chaos
   */
  async maybeFailApiCall<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return operation();
    }

    // Check for timeout
    if (this.rng() < this.apiTimeoutRate) {
      this.recordEvent('api_error_injected', { type: 'timeout', delayMs: this.apiTimeoutMs });
      this.stats.apiErrorsInjected++;
      await new Promise((resolve) => setTimeout(resolve, this.apiTimeoutMs));
      throw new Error('CHAOS: Simulated API timeout');
    }

    // Check for error
    if (this.rng() < this.apiErrorRate) {
      this.recordEvent('api_error_injected', { type: 'error_500' });
      this.stats.apiErrorsInjected++;
      throw new Error('CHAOS: Simulated internal server error');
    }

    return operation();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stats & Events
  // ─────────────────────────────────────────────────────────────────────────

  private recordEvent(type: ChaosEvent['type'], details: Record<string, unknown>): void {
    const event: ChaosEvent = {
      timestamp: new Date(),
      type,
      details,
    };
    this.stats.events.push(event);

    // Keep only last 1000 events
    if (this.stats.events.length > 1000) {
      this.stats.events = this.stats.events.slice(-1000);
    }

    this.emit('chaos_event', event);
  }

  getStats(): ChaosStats {
    return { ...this.stats };
  }

  getRecentEvents(count = 50): ChaosEvent[] {
    return this.stats.events.slice(-count);
  }

  resetStats(): void {
    this.stats = {
      messagesDropped: 0,
      messagesDelayed: 0,
      heartbeatsDropped: 0,
      heartbeatsDelayed: 0,
      connectionsTerminated: 0,
      connectionsPaused: 0,
      connectionsBanned: 0,
      nodesForceOffline: 0,
      schedulingFailures: 0,
      apiErrorsInjected: 0,
      partitionsCreated: 0,
      latencyRulesActive: 0,
      events: [],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Live Connection Manipulation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Pause a connection - queue messages instead of delivering them
   * Simulates network freeze or temporary disconnect
   */
  pauseConnection(connectionId?: string, nodeId?: string, durationMs?: number): boolean {
    if (!this.connectionManager) {
      console.error('[ChaosProxy] No connection manager attached');
      return false;
    }

    let targetConnectionId = connectionId;

    // Find connection by nodeId if connectionId not provided
    if (!targetConnectionId && nodeId) {
      const connections = this.connectionManager.getConnections();
      for (const [connId, conn] of connections) {
        if (conn.nodeIds.has(nodeId)) {
          targetConnectionId = connId;
          break;
        }
      }
    }

    if (!targetConnectionId) {
      console.warn(`[ChaosProxy] No connection found for pause request`);
      return false;
    }

    const paused: PausedConnection = {
      connectionId: targetConnectionId,
      nodeId,
      pausedAt: new Date(),
      resumeAt: durationMs ? new Date(Date.now() + durationMs) : undefined,
      pendingMessages: [],
    };

    this.pausedConnections.set(targetConnectionId, paused);
    this.stats.connectionsPaused++;
    this.recordEvent('connection_paused', { connectionId: targetConnectionId, nodeId, durationMs });

    console.log(`[ChaosProxy] ⚡ Connection paused: ${targetConnectionId}`);

    // Auto-resume after duration
    if (durationMs) {
      setTimeout(() => {
        this.resumeConnection(targetConnectionId);
      }, clampDuration(durationMs));
    }

    return true;
  }

  /**
   * Resume a paused connection and deliver queued messages
   */
  resumeConnection(connectionId?: string, nodeId?: string): boolean {
    let targetConnectionId = connectionId;

    // Find by nodeId if connectionId not provided
    if (!targetConnectionId && nodeId) {
      for (const [connId, paused] of this.pausedConnections) {
        if (paused.nodeId === nodeId) {
          targetConnectionId = connId;
          break;
        }
      }
    }

    if (!targetConnectionId) {
      return false;
    }

    const paused = this.pausedConnections.get(targetConnectionId);
    if (!paused) {
      return false;
    }

    // Deliver queued messages
    if (this.connectionManager && paused.pendingMessages.length > 0) {
      const conn = this.connectionManager.getConnection(targetConnectionId);
      if (conn) {
        console.log(`[ChaosProxy] Delivering ${paused.pendingMessages.length} queued messages`);
        for (const pending of paused.pendingMessages) {
          try {
            conn.ws.send(JSON.stringify(pending.message));
          } catch (err) {
            console.error('[ChaosProxy] Error delivering queued message:', err);
          }
        }
      }
    }

    this.pausedConnections.delete(targetConnectionId);
    this.recordEvent('connection_resumed', { connectionId: targetConnectionId, nodeId, queuedMessages: paused.pendingMessages.length });

    console.log(`[ChaosProxy] Connection resumed: ${targetConnectionId}`);
    return true;
  }

  /**
   * Check if a connection is paused
   */
  isConnectionPaused(connectionId: string): boolean {
    return this.pausedConnections.has(connectionId);
  }

  /**
   * Queue a message for a paused connection
   * Returns true if message was queued, false if connection not paused
   */
  queueMessageForPausedConnection(connectionId: string, message: unknown): boolean {
    const paused = this.pausedConnections.get(connectionId);
    if (!paused) {
      return false;
    }
    paused.pendingMessages.push({ message, timestamp: new Date() });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ban/Unban (Connection Severing with Reconnect Block)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ban a node - severs the WebSocket connection AND blocks reconnection
   * Unlike pause (which queues messages), ban completely cuts off the node
   */
  banNode(nodeId: string, durationMs?: number): boolean {
    if (!this.connectionManager) {
      console.error('[ChaosProxy] No connection manager attached');
      return false;
    }

    // Find and terminate the node's connection
    const connections = this.connectionManager.getConnections();
    let terminated = false;
    for (const [connId, conn] of connections) {
      if (conn.nodeIds.has(nodeId)) {
        console.log(`[ChaosProxy] ⚡ Banning node ${nodeId} - terminating connection ${connId}`);
        conn.ws.terminate();
        terminated = true;
        break;
      }
    }

    // Track the ban (even if not currently connected, prevents future connections)
    const banned: BannedNode = {
      nodeId,
      bannedAt: new Date(),
      unbanAt: durationMs ? new Date(Date.now() + durationMs) : undefined,
    };

    this.bannedNodes.set(nodeId, banned);
    this.stats.connectionsBanned++;
    this.recordEvent('connection_banned', { nodeId, durationMs, wasConnected: terminated });

    console.log(`[ChaosProxy] ⚡ Node banned: ${nodeId}${durationMs ? ` for ${durationMs}ms` : ' indefinitely'}`);

    // Auto-unban after duration
    if (durationMs) {
      setTimeout(() => {
        this.unbanNode(nodeId);
      }, clampDuration(durationMs));
    }

    return true;
  }

  /**
   * Unban a node - allows it to reconnect
   */
  unbanNode(nodeId: string): boolean {
    const banned = this.bannedNodes.get(nodeId);
    if (!banned) {
      return false;
    }

    this.bannedNodes.delete(nodeId);
    this.recordEvent('connection_unbanned', { nodeId, bannedDurationMs: Date.now() - banned.bannedAt.getTime() });

    console.log(`[ChaosProxy] Node unbanned: ${nodeId}`);
    return true;
  }

  /**
   * Check if a node is banned
   */
  isNodeBanned(nodeId: string): boolean {
    return this.bannedNodes.has(nodeId);
  }

  /**
   * Get list of banned nodes
   */
  getBannedNodes(): BannedNode[] {
    return Array.from(this.bannedNodes.values());
  }

  /**
   * Create a network partition - isolate nodes/connections from each other
   */
  createPartition(nodeIds: string[], connectionIds: string[], durationMs?: number): string {
    const id = `partition_${++this.partitionCounter}`;
    const partition: NetworkPartition = {
      id,
      nodeIds,
      connectionIds,
      createdAt: new Date(),
      expiresAt: durationMs ? new Date(Date.now() + durationMs) : undefined,
    };

    this.partitions.set(id, partition);
    this.stats.partitionsCreated++;
    this.recordEvent('partition_created', { partitionId: id, nodeIds, connectionIds, durationMs });

    console.log(`[ChaosProxy] ⚡ Network partition created: ${id}`);

    // Auto-remove after duration
    if (durationMs) {
      setTimeout(() => {
        this.removePartition(id);
      }, clampDuration(durationMs));
    }

    return id;
  }

  /**
   * Remove a network partition
   */
  removePartition(partitionId: string): boolean {
    const partition = this.partitions.get(partitionId);
    if (!partition) {
      return false;
    }

    this.partitions.delete(partitionId);
    this.recordEvent('partition_removed', { partitionId, nodeIds: partition.nodeIds, connectionIds: partition.connectionIds });

    console.log(`[ChaosProxy] Network partition removed: ${partitionId}`);
    return true;
  }

  /**
   * Get all active partitions
   */
  getActivePartitions(): NetworkPartition[] {
    return Array.from(this.partitions.values());
  }

  /**
   * Check if a node or connection is partitioned
   */
  isPartitioned(nodeId?: string, connectionId?: string): boolean {
    for (const partition of this.partitions.values()) {
      if (nodeId && partition.nodeIds.includes(nodeId)) return true;
      if (connectionId && partition.connectionIds.includes(connectionId)) return true;
    }
    return false;
  }

  /**
   * Inject latency into a connection or node
   */
  injectLatency(config: {
    nodeId?: string;
    connectionId?: string;
    latencyMs: number;
    jitterMs?: number;
    durationMs?: number;
  }): string {
    const id = `latency_${++this.latencyRuleCounter}`;
    const rule: LatencyRule = {
      id,
      nodeId: config.nodeId,
      connectionId: config.connectionId,
      latencyMs: config.latencyMs,
      jitterMs: config.jitterMs || 0,
      expiresAt: config.durationMs ? Date.now() + config.durationMs : undefined,
    };

    this.latencyRules.set(id, rule);
    this.stats.latencyRulesActive = this.latencyRules.size;
    this.recordEvent('latency_injected', { ruleId: id, ...config });

    console.log(`[ChaosProxy] ⚡ Latency injection configured: ${id} (${config.latencyMs}ms ± ${config.jitterMs || 0}ms)`);

    // Auto-remove after duration
    if (config.durationMs) {
      setTimeout(() => {
        this.removeLatencyRule(id);
      }, clampDuration(config.durationMs));
    }

    return id;
  }

  /**
   * Remove a latency injection rule
   */
  removeLatencyRule(ruleId: string): boolean {
    const removed = this.latencyRules.delete(ruleId);
    if (removed) {
      this.stats.latencyRulesActive = this.latencyRules.size;
      console.log(`[ChaosProxy] Latency rule removed: ${ruleId}`);
    }
    return removed;
  }

  /**
   * Get the latency to apply for a connection/node
   */
  getLatencyForTarget(nodeId?: string, connectionId?: string): number {
    let maxLatency = 0;

    for (const rule of this.latencyRules.values()) {
      // Check if rule has expired
      if (rule.expiresAt && Date.now() > rule.expiresAt) {
        this.latencyRules.delete(rule.id);
        continue;
      }

      // Check if rule matches
      const matchesNode = rule.nodeId && rule.nodeId === nodeId;
      const matchesConnection = rule.connectionId && rule.connectionId === connectionId;
      const matchesAny = !rule.nodeId && !rule.connectionId; // Global rule

      if (matchesNode || matchesConnection || matchesAny) {
        const jitter = this.rng() * rule.jitterMs * 2 - rule.jitterMs;
        const latency = rule.latencyMs + jitter;
        maxLatency = Math.max(maxLatency, latency);
      }
    }

    return maxLatency;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────

  clearAllRules(): void {
    this.messageRules = [];
    this.heartbeatRules.clear();
    this.schedulerRules = {};
    this.apiErrorRate = 0;
    this.apiTimeoutRate = 0;

    // Clear live connection manipulation state
    // Resume all paused connections first
    for (const connId of this.pausedConnections.keys()) {
      this.resumeConnection(connId);
    }
    this.pausedConnections.clear();
    this.partitions.clear();
    this.latencyRules.clear();
    this.stats.latencyRulesActive = 0;

    console.log('[ChaosProxy] All chaos rules cleared');
  }

  /**
   * Reset random seed for reproducibility
   */
  setSeed(seed: number): void {
    this.seed = seed;
    this.rng = this.createSeededRandom(seed);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let chaosProxy: ChaosProxyService | null = null;

export function getChaosProxy(config?: ChaosConfig): ChaosProxyService {
  if (!chaosProxy) {
    chaosProxy = new ChaosProxyService(config);
  }
  return chaosProxy;
}

export function resetChaosProxy(): void {
  if (chaosProxy) {
    chaosProxy.disable();
  }
  chaosProxy = null;
}
