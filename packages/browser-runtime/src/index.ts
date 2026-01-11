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
} from './agent/browser-agent';

// Storage adapter (IndexedDB via ZenFS)
export {
  StorageAdapter,
  createStorageAdapter,
  type BrowserStorageConfig,
} from './adapters/storage-adapter';

// HTTP adapter (Axios-based Fetch wrapper)
export {
  FetchAdapter,
  createFetchAdapter,
  type BrowserHttpAdapterConfig,
} from './adapters/fetch-adapter';

// Worker adapter (Web Workers via Workerpool)
export {
  WorkerAdapter,
  createWorkerAdapter,
  defaultWorkerAdapter,
  workerpool,
  type BrowserWorkerAdapterConfig,
} from './adapters/worker-adapter';

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
