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
  getServiceNetworkMetaStore,
} from '@stark-o/shared';
import type {
  WsMessage,
  SignallingMessage,
  RoutingRequest,
  RoutingResponse,
} from '@stark-o/shared';
import { validatePodToken } from '../../services/pod-auth-service.js';

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
     * For pod connections, validates that sourcePodId matches the authenticated identity.
     * Agent connections are trusted to relay on behalf of any pod they manage.
     */
    handleSignalRelay(
      message: WsMessage<SignallingMessage>,
      connUserId?: string,
      connectionType?: 'agent' | 'pod',
    ): void {
      const signal = message.payload;
      if (!signal || !signal.targetPodId || !signal.sourcePodId) {
        logger.warn('Invalid signalling message — missing targetPodId or sourcePodId');
        return;
      }

      // For pod connections, verify the sender isn't spoofing another pod's identity.
      // Agent connections (node agents, browser agents) relay on behalf of their managed pods.
      if (connectionType === 'pod' && connUserId && connUserId !== signal.sourcePodId) {
        logger.warn('Signal relay rejected — sourcePodId mismatch with connection identity', {
          sourcePodId: signal.sourcePodId,
          connUserId,
        });
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
     * For pod connections, validates that callerPodId matches the authenticated identity.
     * Agent connections are trusted to route on behalf of any pod they manage.
     */
    handleRoutingRequest(
      message: WsMessage<RoutingRequest>,
      sendResponse: (response: WsMessage<RoutingResponse | { error: string }>) => void,
      connUserId?: string,
      connectionType?: 'agent' | 'pod',
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

      // For pod connections, verify the caller isn't spoofing another pod's identity.
      // Agent connections relay routing on behalf of their managed pods.
      if (connectionType === 'pod' && connUserId && connUserId !== request.callerPodId) {
        logger.warn('Routing request rejected — callerPodId mismatch with connection identity', {
          callerPodId: request.callerPodId,
          connUserId,
        });
        sendResponse({
          type: 'network:route:response',
          payload: { error: 'Caller identity mismatch' },
          correlationId: message.correlationId,
        });
        return;
      }

      try {
        const response = handleRoutingRequest(request, {
          registry: getServiceRegistry(),
          policyEngine: getNetworkPolicyEngine(),
          networkMetaLookup: getServiceNetworkMetaStore().createLookup(),
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
     * For pod connections, validates that podId matches the authenticated identity.
     */
    handleRegistryHeartbeat(
      message: WsMessage<{ serviceId: string; podId: string; nodeId: string }>,
      connUserId?: string,
      connectionType?: 'agent' | 'pod',
    ): void {
      const { serviceId, podId, nodeId } = message.payload ?? {};
      if (!serviceId || !podId || !nodeId) {
        logger.warn('Invalid registry heartbeat — missing fields');
        return;
      }

      // For pod connections, verify the heartbeat podId matches the authenticated identity.
      // Agent connections (node agents) can heartbeat on behalf of any pod they manage.
      if (connectionType === 'pod' && connUserId && connUserId !== podId) {
        logger.warn('Registry heartbeat rejected — podId mismatch with connection identity', {
          heartbeatPodId: podId,
          connUserId,
        });
        return;
      }

      getServiceRegistry().register(serviceId, podId, nodeId, 'healthy');
    },

    /**
     * Handle pod registration for direct WebRTC signaling.
     * Called when a pod subprocess connects directly to orchestrator.
     * Validates pod auth token to prevent spoofing.
     */
    handlePodRegister(
      message: WsMessage<{ podId: string; serviceId: string; authToken?: string }>,
      sendResponse: (response: WsMessage) => void,
    ): void {
      const { podId, serviceId, authToken } = message.payload ?? {};
      if (!podId || !serviceId) {
        sendResponse({
          type: 'network:pod:register:error',
          payload: { error: 'Missing podId or serviceId' },
          correlationId: message.correlationId,
        });
        return;
      }

      // Validate the pod auth token to prevent spoofing
      if (!authToken) {
        logger.warn('Pod registration rejected — missing auth token', { podId, serviceId });
        sendResponse({
          type: 'network:pod:register:error',
          payload: { error: 'Missing auth token' },
          correlationId: message.correlationId,
        });
        return;
      }

      const tokenResult = validatePodToken(authToken);
      if (!tokenResult.valid || !tokenResult.claims) {
        logger.warn('Pod registration rejected — invalid auth token', { 
          podId, 
          serviceId, 
          error: tokenResult.error,
        });
        sendResponse({
          type: 'network:pod:register:error',
          payload: { error: `Invalid auth token: ${tokenResult.error}` },
          correlationId: message.correlationId,
        });
        return;
      }

      // Verify the token claims match the registration request
      if (tokenResult.claims.podId !== podId) {
        logger.warn('Pod registration rejected — podId mismatch', { 
          claimedPodId: podId, 
          tokenPodId: tokenResult.claims.podId,
        });
        sendResponse({
          type: 'network:pod:register:error',
          payload: { error: 'Pod ID mismatch' },
          correlationId: message.correlationId,
        });
        return;
      }

      if (tokenResult.claims.serviceId !== serviceId) {
        logger.warn('Pod registration rejected — serviceId mismatch', { 
          claimedServiceId: serviceId, 
          tokenServiceId: tokenResult.claims.serviceId,
        });
        sendResponse({
          type: 'network:pod:register:error',
          payload: { error: 'Service ID mismatch' },
          correlationId: message.correlationId,
        });
        return;
      }

      // Register the pod connection
      connectionManager.registerPodConnection?.(podId, serviceId);

      // Register in service registry (with nodeId from token, 'direct' fallback)
      const nodeId = tokenResult.claims.nodeId || 'direct';
      getServiceRegistry().register(serviceId, podId, nodeId, 'healthy');

      logger.info('Pod registered for direct signaling', { 
        podId, 
        serviceId, 
        nodeId,
        userId: tokenResult.claims.userId,
      });

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
