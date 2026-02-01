/**
 * @stark-o/node-runtime
 *
 * Node.js runtime package for Stark Orchestrator.
 * Provides platform-specific adapters and execution capabilities for Node.js environments.
 *
 * @module @stark-o/node-runtime
 */
export { NodeAgent, createNodeAgent, type NodeAgentConfig, type NodeAgentEvent, type NodeAgentEventHandler, type ConnectionState, } from './agent/node-agent.js';
export { PackExecutor, createPackExecutor, defaultPackExecutor, type PackExecutorConfig, type PackExecutionContext, type PackExecutionResult, type ExecutionHandle, } from './executor/pack-executor.js';
export { FsAdapter, type FsAdapterConfig, } from './adapters/fs-adapter.js';
export { HttpAdapter, HttpAdapterError, type HttpAdapterConfig, type HttpRequestOptions, type HttpResponse, type HttpMethod, type RequestInterceptor, type ResponseInterceptor, type ErrorInterceptor, } from './adapters/http-adapter.js';
export { WorkerAdapter, defaultWorkerAdapter, type NodeWorkerAdapterConfig, type WorkerAdapterConfig, type TaskOptions, type TaskResult, type TaskHandle, type PoolStats, type IWorkerAdapter, TaskCancelledError, TaskTimeoutError, WorkerNotInitializedError, WorkerScriptRequiredError, } from './adapters/worker-adapter.js';
//# sourceMappingURL=index.d.ts.map