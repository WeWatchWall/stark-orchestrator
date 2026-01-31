/**
 * @stark-o/node-runtime
 *
 * Node.js runtime package for Stark Orchestrator.
 * Provides platform-specific adapters and execution capabilities for Node.js environments.
 *
 * @module @stark-o/node-runtime
 */

// ============================================
// Agent Exports
// ============================================

export {
  NodeAgent,
  createNodeAgent,
  type NodeAgentConfig,
  type NodeAgentEvent,
  type NodeAgentEventHandler,
  type ConnectionState,
} from './agent/node-agent.js';

export {
  NodeStateStore,
  createNodeStateStore,
  loadNodeCredentials,
  saveNodeCredentials,
  clearNodeCredentials,
  areNodeCredentialsValid,
  getNodeAccessToken,
  loadRegisteredNodes,
  saveRegisteredNodes,
  getRegisteredNode,
  saveRegisteredNode,
  removeRegisteredNode,
  getRegisteredNodesForOrchestrator,
  updateNodeLastStarted,
  type NodeCredentials,
  type RegisteredNode,
  type RegisteredNodesMap,
} from './agent/node-state-store.js';

// ============================================
// Pack Executor Exports
// ============================================

export {
  PackExecutor,
  createPackExecutor,
  defaultPackExecutor,
  type PackExecutorConfig,
  type PackExecutionContext,
  type PackExecutionResult,
  type ExecutionHandle,
} from './executor/pack-executor.js';

// ============================================
// Adapter Exports
// ============================================

// File System Adapter
export {
  FsAdapter,
  type FsAdapterConfig,
} from './adapters/fs-adapter.js';

// HTTP Adapter
export {
  HttpAdapter,
  HttpAdapterError,
  type HttpAdapterConfig,
  type HttpRequestOptions,
  type HttpResponse,
  type HttpMethod,
  type RequestInterceptor,
  type ResponseInterceptor,
  type ErrorInterceptor,
} from './adapters/http-adapter.js';

// Worker Adapter
export {
  WorkerAdapter,
  defaultWorkerAdapter,
  type NodeWorkerAdapterConfig,
  type WorkerAdapterConfig,
  type TaskOptions,
  type TaskResult,
  type TaskHandle,
  type PoolStats,
  type IWorkerAdapter,
  TaskCancelledError,
  TaskTimeoutError,
  WorkerNotInitializedError,
  WorkerScriptRequiredError,
} from './adapters/worker-adapter.js';
