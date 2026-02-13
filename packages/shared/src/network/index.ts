/**
 * Network Module — Barrel exports
 *
 * Inter-service communication with pod-to-pod WebRTC caching
 * and orchestrator fallback routing.
 *
 * @module @stark-o/shared/network
 */

// Network policies
export {
  NetworkPolicyEngine,
  getNetworkPolicyEngine,
  isServiceCallAllowed,
  evaluateNetworkPolicy,
  ServiceNetworkMetaStore,
  getServiceNetworkMetaStore,
  type ServiceNetworkMeta,
  type ServiceNetworkMetaLookup,
  type PolicyEvaluationRequest,
  type PolicyEvaluationResult,
} from './network-policy.js';

// Service registry (orchestrator-side)
export { ServiceRegistry, getServiceRegistry } from './service-registry.js';

// Pod target cache (pod-side, sticky by default)
export { PodTargetCache } from './pod-cache.js';

// WebRTC connection manager (isomorphic)
export {
  WebRTCConnectionManager,
  type PeerConnection,
  type SignalSender,
  type MessageHandler,
  type SimplePeerLike,
  type PeerFactory,
} from './webrtc-manager.js';

// Service caller (pod-side API for making inter-service calls)
export {
  ServiceCaller,
  NetworkPolicyError,
  type OrchestratorRouter,
  type ServiceCallerConfig,
} from './service-caller.js';

// Orchestrator routing handler
export {
  handleRoutingRequest,
  PodRequestRouter,
  type OrchestratorRouterConfig,
  type RequestHandler,
} from './orchestrator-router.js';

// HTTP interceptor (outbound — fetch + Axios monkey patching)
export {
  isInternalUrl,
  interceptFetch,
  restoreFetch,
  createAxiosStarkInterceptor,
  installAxiosInterceptor,
  installOutboundInterceptors,
  type InterceptorHandles,
} from './http-interceptor.js';

// Server interceptor (inbound — Node.js http.createServer patching)
export {
  StarkServerInterceptor,
  type HttpModuleLike,
  type HttpServerLike,
} from './server-interceptor.js';

// Browser listener (inbound — explicit handler registration for browser packs)
export { StarkBrowserListener } from './browser-listener.js';

// Default PeerFactory implementation using simple-peer
export { createSimplePeerFactory, type SimplePeerFactoryOptions } from './peer-factory.js';

// Ephemeral data plane — PodGroup store + developer-facing API
export {
  PodGroupStore,
  getPodGroupStore,
  resetPodGroupStore,
} from './pod-group-store.js';

export {
  EphemeralDataPlane,
  createEphemeralDataPlane,
  type EphemeralQueryHandler,
  type EphemeralTransport,
  type GroupTransport,
  type EphemeralDataPlaneOptions,
} from './ephemeral-data-plane.js';

export {
  PodGroupHandle,
  type PodGroupPlaneRef,
  type PodGroupHandleOptions,
} from './pod-group-handle.js';
