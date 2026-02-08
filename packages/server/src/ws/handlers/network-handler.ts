/**
 * Network WebSocket Handler
 *
 * Handles WebSocket messages related to inter-service networking:
 * - WebRTC signalling relay (offer/answer/ICE candidates between pods)
 * - Pod routing requests (when pods connect directly for routing)
 * - Pod registration (pods connecting directly for WebRTC signaling)
 *
 * Architecture:
 * - Pods connect directly to orchestrator via WebSocket for signaling
 * - Orchestrator relays WebRTC signals between pods
 * - Orchestrator never handles data traffic after WebRTC handshake
 *
 * @module @stark-o/server/ws/handlers/network-handler
 */

import { createServiceLogger } from '@stark-o/shared';
import {
  getServiceRegistry,
  getNetworkPolicyEngine,
  handleRoutingRequest,
} from '@stark-o/shared';
import type {
  WsMessage,
  SignallingMessage,
  RoutingRequest,
  RoutingResponse,
} from '@stark-o/shared';

const logger = createServiceLogger(
  { level: 'debug', service: 'stark-orchestrator' },
  { component: 'network-ws-handler' },
);

/**
 * Interface for the connection manager used to send messages to pods.
 */
interface NetworkConnectionManager {
  /** Send a WsMessage to a specific pod */
  sendToPod?(podId: string, message: WsMessage): boolean;
  /** Send a WsMessage to a specific node */
  sendToNode?(nodeId: string, message: WsMessage): boolean;
  /** Register a pod's WebSocket connection for direct signaling */
  registerPodConnection?(podId: string, serviceId: string): void;
}

/**
 * Install network-related WebSocket message handlers.
 *
 * Call this from the connection manager setup to register handlers
 * for network message types.
 */
export function createNetworkWsHandlers(connectionManager: NetworkConnectionManager) {
  return {
    /**
     * Handle a WebRTC signalling relay message.
     * Forwards the signal to the target pod via the connection manager.
     */
    handleSignalRelay(message: WsMessage<SignallingMessage>): void {
      const signal = message.payload;
      if (!signal || !signal.targetPodId || !signal.sourcePodId) {
        logger.warn('Invalid signalling message — missing targetPodId or sourcePodId');
        return;
      }

      logger.debug('Relaying WebRTC signal', {
        type: signal.type,
        from: signal.sourcePodId,
        to: signal.targetPodId,
      });

      // Relay the signal to the target pod
      const relayMessage: WsMessage<SignallingMessage> = {
        type: 'network:signal',
        payload: signal,
        correlationId: message.correlationId,
      };

      const sent = connectionManager.sendToPod?.(signal.targetPodId, relayMessage);
      if (!sent) {
        logger.warn('Failed to relay signal — target pod not connected', {
          targetPodId: signal.targetPodId,
        });
      }
    },

    /**
     * Handle a routing request from a pod (via WebSocket instead of HTTP).
     * Returns a routing response to the requesting pod.
     */
    handleRoutingRequest(
      message: WsMessage<RoutingRequest>,
      sendResponse: (response: WsMessage<RoutingResponse | { error: string }>) => void,
    ): void {
      const request = message.payload;
      if (!request || !request.callerPodId || !request.targetServiceId) {
        sendResponse({
          type: 'network:route:response',
          payload: { error: 'Invalid routing request' },
          correlationId: message.correlationId,
        });
        return;
      }

      try {
        const response = handleRoutingRequest(request, {
          registry: getServiceRegistry(),
          policyEngine: getNetworkPolicyEngine(),
        });

        sendResponse({
          type: 'network:route:response',
          payload: response,
          correlationId: message.correlationId,
        });

        logger.debug('Routing request handled via WS', {
          caller: request.callerPodId,
          target: request.targetServiceId,
          selectedPod: response.targetPodId,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Routing failed';
        sendResponse({
          type: 'network:route:response',
          payload: { error: errorMessage } as RoutingResponse & { error: string },
          correlationId: message.correlationId,
        });

        logger.error('Routing request failed via WS', err instanceof Error ? err : undefined, {
          caller: request.callerPodId,
          target: request.targetServiceId,
        });
      }
    },

    /**
     * Handle a pod's service registry heartbeat.
     * The pod tells the orchestrator which service it hosts.
     */
    handleRegistryHeartbeat(
      message: WsMessage<{ serviceId: string; podId: string; nodeId: string }>,
    ): void {
      const { serviceId, podId, nodeId } = message.payload ?? {};
      if (!serviceId || !podId || !nodeId) {
        logger.warn('Invalid registry heartbeat — missing fields');
        return;
      }

      getServiceRegistry().register(serviceId, podId, nodeId, 'healthy');
    },

    /**
     * Handle pod registration for direct WebRTC signaling.
     * Called when a pod subprocess connects directly to orchestrator.
     */
    handlePodRegister(
      message: WsMessage<{ podId: string; serviceId: string }>,
      sendResponse: (response: WsMessage) => void,
    ): void {
      const { podId, serviceId } = message.payload ?? {};
      if (!podId || !serviceId) {
        sendResponse({
          type: 'network:pod:register:error',
          payload: { error: 'Missing podId or serviceId' },
          correlationId: message.correlationId,
        });
        return;
      }

      // Register the pod connection
      connectionManager.registerPodConnection?.(podId, serviceId);

      // Register in service registry (with 'direct' as nodeId since pod connects directly)
      getServiceRegistry().register(serviceId, podId, 'direct', 'healthy');

      logger.info('Pod registered for direct signaling', { podId, serviceId });

      sendResponse({
        type: 'network:pod:register:ack',
        payload: { podId, serviceId },
        correlationId: message.correlationId,
      });
    },

    /**
     * Handle pod disconnection → unregister from registry.
     */
    handlePodDisconnected(podId: string): void {
      getServiceRegistry().unregisterPod(podId);
      logger.debug('Pod unregistered from service registry on disconnect', { podId });
    },
  };
}

/**
 * Network-related WS message types.
 */
export const NETWORK_WS_TYPES = {
  /** WebRTC signalling relay */
  SIGNAL: 'network:signal',
  /** Routing request (pod → orchestrator) */
  ROUTE_REQUEST: 'network:route:request',
  /** Routing response (orchestrator → pod) */
  ROUTE_RESPONSE: 'network:route:response',
  /** Registry heartbeat (pod → orchestrator) */
  REGISTRY_HEARTBEAT: 'network:registry:heartbeat',
  /** Pod registration for direct signaling */
  POD_REGISTER: 'network:pod:register',
} as const;
