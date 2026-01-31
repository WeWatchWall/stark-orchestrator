// Stark Orchestrator - Browser Runtime
// Platform-specific adapters for browsers

// Browser Agent (connects to orchestrator, sends heartbeats, receives pod commands)
export {
  BrowserAgent,
  createBrowserAgent,
  type BrowserAgentConfig,
  type BrowserAgentEvent,
  type BrowserAgentEventHandler,
  type ConnectionState,
} from './agent/browser-agent.js';

// Browser State Store (persistent storage for credentials and registered nodes)
export {
  BrowserStateStore,
  createBrowserStateStore,
  loadBrowserCredentials,
  saveBrowserCredentials,
  clearBrowserCredentials,
  areBrowserCredentialsValid,
  getBrowserAccessToken,
  loadRegisteredBrowserNodes,
  saveRegisteredBrowserNodes,
  getRegisteredBrowserNode,
  saveRegisteredBrowserNode,
  removeRegisteredBrowserNode,
  getRegisteredBrowserNodesForOrchestrator,
  updateBrowserNodeLastStarted,
  type BrowserNodeCredentials,
  type RegisteredBrowserNode,
  type RegisteredBrowserNodesMap,
} from './agent/browser-state-store.js';

// Pod Handler (handles pod deployment and lifecycle)
export {
  PodHandler,
  createPodHandler,
  type PodHandlerConfig,
  type PodDeployPayload,
  type PodStopPayload,
  type LocalPodStatus,
  type PodOperationResult,
} from './agent/pod-handler.js';

// Pack Executor (executes pack bundles in Web Workers)
export {
  PackExecutor,
  createPackExecutor,
  defaultPackExecutor,
  type PackExecutorConfig,
  type PackExecutionContext,
  type PackExecutionResult,
  type ExecutionHandle,
} from './executor/pack-executor.js';

// Storage adapter (IndexedDB via ZenFS)
export {
  StorageAdapter,
  createStorageAdapter,
  type BrowserStorageConfig,
} from './adapters/storage-adapter.js';

// HTTP adapter (Axios-based Fetch wrapper)
export {
  FetchAdapter,
  createFetchAdapter,
  type BrowserHttpAdapterConfig,
} from './adapters/fetch-adapter.js';

// Worker adapter (Web Workers via Workerpool)
export {
  WorkerAdapter,
  createWorkerAdapter,
  defaultWorkerAdapter,
  workerpool,
  type BrowserWorkerAdapterConfig,
} from './adapters/worker-adapter.js';

// Re-export shared types for convenience
export type {
  IStorageAdapter,
  FileStats,
  DirectoryEntry,
  StorageAdapterConfig,
  IHttpAdapter,
  HttpMethod,
  HttpAdapterConfig,
  HttpRequestOptions,
  HttpResponse,
  IWorkerAdapter,
  WorkerAdapterConfig,
  TaskOptions,
  TaskResult,
  PoolStats,
  TaskHandle,
} from '@stark-o/shared';

export {
  HttpAdapterError,
  TaskCancelledError,
  TaskTimeoutError,
  WorkerNotInitializedError,
  WorkerScriptRequiredError,
} from '@stark-o/shared';
