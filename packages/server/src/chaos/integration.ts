/**
 * Chaos Integration
 *
 * Provides hooks and wrappers to integrate chaos injection
 * into existing services without modifying their core implementation.
 *
 * Uses the decorator/wrapper pattern to intercept messages and operations.
 */

import type { ConnectionManager } from '../ws/connection-manager';
import { getChaosProxy } from '../services/chaos-proxy';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WsMessage {
  type: string;
  payload?: unknown;
  correlationId?: string;
}

interface MessageInterceptor {
  direction: 'incoming' | 'outgoing';
  messageType?: string | string[]; // Specific types or all if undefined
  handler: (
    connectionId: string,
    nodeId: string | undefined,
    message: WsMessage
  ) => Promise<{ action: 'send' | 'drop' | 'delay'; delayMs?: number; message: WsMessage }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chaos Integration Service
// ─────────────────────────────────────────────────────────────────────────────

export class ChaosIntegration {
  private connectionManager: ConnectionManager | null = null;
  private interceptors: MessageInterceptor[] = [];
  private originalSendToConnection: ((id: string, msg: WsMessage) => boolean) | null = null;
  private isAttached = false;

  /**
   * Attach to a ConnectionManager and wrap its methods
   */
  attach(connectionManager: ConnectionManager): void {
    if (this.isAttached) {
      console.warn('[ChaosIntegration] Already attached');
      return;
    }

    this.connectionManager = connectionManager;

    // Wrap sendToConnection to intercept outgoing messages
    this.wrapSendToConnection();

    // Attach chaos proxy to connection manager
    const chaos = getChaosProxy();
    chaos.attach(connectionManager);

    this.isAttached = true;
    console.log('[ChaosIntegration] Attached to ConnectionManager');
  }

  /**
   * Wrap the sendToConnection method to intercept outgoing messages
   */
  private wrapSendToConnection(): void {
    if (!this.connectionManager) return;

    // Store original method - use type assertion for compatibility
    const boundMethod = this.connectionManager.sendToConnection.bind(
      this.connectionManager
    ) as (id: string, msg: WsMessage) => boolean;
    this.originalSendToConnection = boundMethod;

    // Replace with wrapped version
    const chaos = getChaosProxy();
    const original = this.originalSendToConnection;

    (this.connectionManager as any).sendToConnection = (
      connectionId: string,
      message: WsMessage
    ): boolean => {
      if (!chaos.isEnabled()) {
        return original!(connectionId, message);
      }

      // Get node ID from connection if available
      const nodeId = this.getNodeIdFromConnection(connectionId);

      // Intercept outgoing message
      const result = chaos.interceptOutgoingMessage(
        connectionId,
        nodeId,
        message.type,
        message as unknown as Record<string, unknown>
      );

      switch (result.action) {
        case 'drop':
          console.log(`[ChaosIntegration] Dropping outgoing message: ${message.type}`);
          return false;

        case 'delay':
          console.log(
            `[ChaosIntegration] Delaying outgoing message: ${message.type} by ${result.delayMs ?? 0}ms`
          );
          setTimeout(() => {
            original!(connectionId, result.message as WsMessage);
          }, result.delayMs ?? 0);
          return true;

        case 'send':
        default:
          return original!(connectionId, result.message as WsMessage);
      }
    };
  }

  /**
   * Get node ID from a connection
   */
  private getNodeIdFromConnection(connectionId: string): string | undefined {
    if (!this.connectionManager) return undefined;

    const nodes = this.connectionManager.getConnectionNodes(connectionId);
    if (nodes && nodes.size > 0) {
      const nodeArray = Array.from(nodes);
      return nodeArray.length > 0 ? nodeArray[0] : undefined;
    }
    return undefined;
  }

  /**
   * Wrap incoming message handling
   * This should be called from the message handler
   */
  async interceptIncomingMessage(
    connectionId: string,
    nodeId: string | undefined,
    message: WsMessage
  ): Promise<{ process: boolean; delayMs?: number }> {
    const chaos = getChaosProxy();

    if (!chaos.isEnabled()) {
      return { process: true };
    }

    const result = chaos.interceptIncomingMessage(
      connectionId,
      nodeId,
      message.type,
      message
    );

    switch (result.action) {
      case 'drop':
        console.log(`[ChaosIntegration] Dropping incoming message: ${message.type}`);
        return { process: false };

      case 'delay':
        console.log(
          `[ChaosIntegration] Delaying incoming message: ${message.type} by ${result.delayMs}ms`
        );
        return { process: true, delayMs: result.delayMs };

      case 'process':
      default:
        return { process: true };
    }
  }

  /**
   * Add a custom interceptor
   */
  addInterceptor(interceptor: MessageInterceptor): void {
    this.interceptors.push(interceptor);
  }

  /**
   * Clear all custom interceptors
   */
  clearInterceptors(): void {
    this.interceptors = [];
  }

  /**
   * Restore original methods
   */
  detach(): void {
    if (!this.isAttached || !this.connectionManager) return;

    if (this.originalSendToConnection) {
      (this.connectionManager as any).sendToConnection = this.originalSendToConnection;
      this.originalSendToConnection = null;
    }

    this.interceptors = [];
    this.isAttached = false;
    console.log('[ChaosIntegration] Detached from ConnectionManager');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions for Wrapping Database Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrap a database query function with chaos injection
 */
export function wrapDbQuery<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  _name: string
): T {
  const chaos = getChaosProxy();

  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (!chaos.isEnabled()) {
      return fn(...args) as Promise<ReturnType<T>>;
    }

    // Use chaos proxy's maybeFailApiCall
    return chaos.maybeFailApiCall(() => fn(...args)) as Promise<ReturnType<T>>;
  }) as T;
}

/**
 * Create a wrapped version of a query module
 */
export function wrapQueryModule<T extends Record<string, (...args: unknown[]) => Promise<unknown>>>(
  module: T,
  moduleName: string
): T {
  const wrapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(module)) {
    if (typeof value === 'function') {
      wrapped[key] = wrapDbQuery(value as (...args: unknown[]) => Promise<unknown>, `${moduleName}.${key}`);
    } else {
      wrapped[key] = value;
    }
  }

  return wrapped as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let chaosIntegration: ChaosIntegration | null = null;

export function getChaosIntegration(): ChaosIntegration {
  if (!chaosIntegration) {
    chaosIntegration = new ChaosIntegration();
  }
  return chaosIntegration;
}

export function resetChaosIntegration(): void {
  if (chaosIntegration) {
    chaosIntegration.detach();
  }
  chaosIntegration = null;
}
