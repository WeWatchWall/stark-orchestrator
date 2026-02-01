/**
 * Connection Service
 * @module @stark-o/server/services/connection-service
 *
 * Singleton service that provides access to the WebSocket connection manager
 * for sending messages to connected nodes from any part of the application.
 */

import type { ConnectionManager, WsMessage } from '../ws/connection-manager.js';
import { createServiceLogger } from '@stark-o/shared';

/**
 * Logger for connection service
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'connection-service' });

/**
 * Singleton connection manager reference
 */
let connectionManagerInstance: ConnectionManager | null = null;

/**
 * Set the connection manager instance
 * Called during server initialization
 */
export function setConnectionManager(manager: ConnectionManager): void {
  connectionManagerInstance = manager;
  logger.info('Connection manager registered with connection service');
}

/**
 * Get the connection manager instance
 * Returns null if not yet initialized
 */
export function getConnectionManager(): ConnectionManager | null {
  return connectionManagerInstance;
}

/**
 * Send a message to a specific node by its connection ID
 * @param connectionId - The WebSocket connection ID of the node
 * @param message - The message to send
 * @returns true if the message was sent, false if the connection was not found
 */
export function sendToNode(connectionId: string, message: WsMessage): boolean {
  if (!connectionManagerInstance) {
    logger.error('Cannot send to node: connection manager not initialized');
    return false;
  }

  return connectionManagerInstance.sendToConnection(connectionId, message);
}

/**
 * Reset the connection service (for testing)
 */
export function resetConnectionService(): void {
  connectionManagerInstance = null;
}
