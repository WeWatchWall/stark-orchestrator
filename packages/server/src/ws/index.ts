/**
 * WebSocket module exports
 * @module @stark-o/server/ws
 */

export {
  ConnectionManager,
  createConnectionManager,
  type ConnectionInfo,
  type ConnectionManagerOptions,
  type AuthHandler,
  type AuthResult,
  type WsMessageType,
  type WsMessage,
} from './connection-manager.js';

export {
  handleNodeRegister,
  handleNodeReconnect,
  handleNodeHeartbeat,
  handleNodeDisconnect,
  type WsConnection,
  type WsNodeMessageType,
  type ReconnectNodePayload,
} from './handlers/node-handler.js';

export {
  handlePodSchedule,
  handlePodStart,
  handlePodStop,
  handlePodFail,
  handlePodEvict,
  handlePodRestart,
  handlePodStatusUpdate,
  routePodMessage,
  type WsPodMessageType,
} from './handlers/pod-handler.js';

export {
  createNetworkWsHandlers,
  NETWORK_WS_TYPES,
} from './handlers/network-handler.js';

export {
  createPodGroupWsHandlers,
  resetCentralPodGroupStore,
  PODGROUP_WS_TYPES,
} from './handlers/podgroup-handler.js';
