/**
 * Node.js Server Interceptor for Inbound Inter-Service Communication
 *
 * Patches Node.js `http.createServer` / `http.Server` so that when a pack
 * starts an HTTP server (Express, Fastify, Koa, plain http, etc.), incoming
 * WebRTC ServiceRequests are automatically forwarded to it by emitting
 * synthetic 'request' events directly on the server.
 *
 * This makes `context.router.handle()` unnecessary in Node.js —
 * packs can use any HTTP framework and Stark will route traffic to them.
 *
 * If no HTTP server is captured (e.g. the pack doesn't start one),
 * falls back to the PodRequestRouter for handler-based dispatch.
 *
 * @module @stark-o/shared/network/server-interceptor
 */

import type { ServiceRequest, ServiceResponse } from '../types/network.js';
import type { PodRequestRouter } from './orchestrator-router.js';

/**
 * Minimal interface for the Node.js `http` module.
 * We accept it as a parameter to avoid importing `http` directly
 * (keeping this module importable in browser bundles that never call `install()`).
 */
export interface HttpModuleLike {
  createServer: (...args: unknown[]) => HttpServerLike;
  request: (options: Record<string, unknown>, cb: (res: IncomingMessageLike) => void) => WritableLike;
  Server?: { prototype: Record<string, unknown> };
}

export interface HttpServerLike {
  listen: (...args: unknown[]) => HttpServerLike;
  address: () => { port: number; address: string; family: string } | string | null;
  on: (event: string, listener: (...args: unknown[]) => void) => HttpServerLike;
  once: (event: string, listener: (...args: unknown[]) => void) => HttpServerLike;
  emit: (event: string, ...args: unknown[]) => boolean;
}

export interface IncomingMessageLike {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

export interface WritableLike {
  write: (data: string | Buffer) => boolean;
  end: (data?: string | Buffer) => void;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
}

/**
 * StarkServerInterceptor
 *
 * Captures HTTP servers created by pack code and forwards incoming
 * WebRTC ServiceRequests to them as real HTTP loopback requests.
 *
 * Usage (in the runtime, before pack code runs):
 * ```ts
 * import http from 'http';
 * const interceptor = new StarkServerInterceptor(podRequestRouter);
 * interceptor.install(http);
 *
 * // ... pack code runs, creates Express/Fastify/etc. server ...
 *
 * // When a ServiceRequest arrives via WebRTC:
 * const response = await interceptor.dispatch(serviceRequest, http);
 *
 * // Cleanup:
 * interceptor.uninstall(http);
 * ```
 */
export class StarkServerInterceptor {
  /** Captured servers: port → server instance */
  private capturedServers: Map<number, HttpServerLike> = new Map();
  /** All captured servers (for immediate use before port is known) */
  private allServers: Set<HttpServerLike> = new Set();
  /** Server that had listen() called (primary target for synthetic requests) */
  private primaryServer: HttpServerLike | null = null;
  /** Fallback router for when no HTTP server is available */
  private router: PodRequestRouter;
  /** Original createServer function for http module */
  private _originalHttpCreateServer: ((...args: unknown[]) => HttpServerLike) | null = null;
  /** Original createServer function for https module */
  private _originalHttpsCreateServer: ((...args: unknown[]) => HttpServerLike) | null = null;

  constructor(router: PodRequestRouter) {
    this.router = router;
  }

  /**
   * Create a wrapped createServer function that captures servers.
   */
  private wrapCreateServer(
    originalCreateServer: (...args: unknown[]) => HttpServerLike
  ): (...args: unknown[]) => HttpServerLike {
    const self = this;
    return function (...args: unknown[]): HttpServerLike {
      const server = originalCreateServer(...args);

      // Wrap listen() to capture the server immediately
      const originalListen = server.listen.bind(server);
      server.listen = function (...listenArgs: unknown[]): HttpServerLike {
        // Capture the server immediately when listen() is called
        // This is our primary target for synthetic requests
        self.allServers.add(server);
        self.primaryServer = server;

        const result = originalListen(...listenArgs);

        server.once('listening', () => {
          const addr = server.address();
          if (addr && typeof addr === 'object' && 'port' in addr) {
            self.capturedServers.set(addr.port, server);
          }
        });

        return result;
      };

      return server;
    };
  }

  /**
   * Patch `http.createServer` and `server.listen` to capture HTTP servers
   * started by pack code. Call this BEFORE the pack code runs.
   */
  install(httpModule: HttpModuleLike): void {
    if (this._originalHttpCreateServer) return; // already installed

    this._originalHttpCreateServer = httpModule.createServer.bind(httpModule);
    httpModule.createServer = this.wrapCreateServer(this._originalHttpCreateServer);
  }

  /**
   * Patch `https.createServer` to capture HTTPS servers.
   * Call this in addition to install() if you want to capture HTTPS servers.
   */
  installHttps(httpsModule: HttpModuleLike): void {
    if (this._originalHttpsCreateServer) return; // already installed

    this._originalHttpsCreateServer = httpsModule.createServer.bind(httpsModule);
    httpsModule.createServer = this.wrapCreateServer(this._originalHttpsCreateServer);
  }

  /**
   * Restore the original `http.createServer` function.
   */
  uninstall(httpModule: HttpModuleLike): void {
    if (this._originalHttpCreateServer) {
      httpModule.createServer = this._originalHttpCreateServer;
      this._originalHttpCreateServer = null;
    }
    this.capturedServers.clear();
    this.allServers.clear();
    this.primaryServer = null;
  }

  /**
   * Restore the original `https.createServer` function.
   */
  uninstallHttps(httpsModule: HttpModuleLike): void {
    if (this._originalHttpsCreateServer) {
      httpsModule.createServer = this._originalHttpsCreateServer;
      this._originalHttpsCreateServer = null;
    }
  }

  /**
   * Check if any HTTP servers have been captured.
   */
  get hasCapturedServers(): boolean {
    return this.primaryServer !== null || this.allServers.size > 0;
  }

  /**
   * Get the port of the first captured server (for debugging).
   */
  get capturedPort(): number | null {
    for (const port of this.capturedServers.keys()) return port;
    return null;
  }

  /**
   * Dispatch a ServiceRequest to the pack's HTTP server.
   *
   * - If a primary server is available, emits a synthetic 'request' event directly.
   * - Otherwise falls back to the PodRequestRouter.
   *
   * @param request - The incoming ServiceRequest from WebRTC
   * @param _httpModule - Unused (kept for API compatibility)
   */
  async dispatch(request: ServiceRequest, _httpModule?: HttpModuleLike): Promise<ServiceResponse> {
    // If we have a primary server, emit synthetic request event directly
    if (this.primaryServer) {
      return this.forwardViaSyntheticEvent(request, this.primaryServer);
    }

    // Fall back to PodRequestRouter
    return this.dispatchToRouter(request);
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async dispatchToRouter(request: ServiceRequest): Promise<ServiceResponse> {
    const result = await this.router.dispatch(
      request.method,
      request.path,
      request.body,
      request.headers,
    );
    return {
      requestId: request.requestId,
      status: result.status,
      body: result.body,
      headers: result.headers,
    };
  }

  /**
   * Emit a synthetic 'request' event on the server with mock req/res objects.
   * This works because Node.js HTTP servers (and frameworks like Express)
   * listen for 'request' events and handle them via their request listeners.
   */
  private forwardViaSyntheticEvent(
    request: ServiceRequest,
    server: HttpServerLike,
  ): Promise<ServiceResponse> {
    return new Promise((resolve) => {
      const bodyStr = request.body !== undefined ? JSON.stringify(request.body) : '';

      // Create synthetic IncomingMessage (readable stream)
      const req = new SyntheticIncomingMessage({
        method: request.method,
        url: request.path,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(bodyStr)),
          ...(request.headers ?? {}),
        },
        body: bodyStr,
      });

      // Create synthetic ServerResponse (writable stream)
      const res = new SyntheticServerResponse((statusCode, headers, body) => {
        let parsedBody: unknown;
        try {
          parsedBody = body ? JSON.parse(body) : undefined;
        } catch {
          parsedBody = body;
        }

        resolve({
          requestId: request.requestId,
          status: statusCode,
          body: parsedBody,
          headers,
        });
      });

      // Emit the 'request' event on the server
      // The server's request listener will process it
      server.emit('request', req, res);
    });
  }
}

// ── Synthetic HTTP Classes ───────────────────────────────────────────────────

interface SyntheticMessageOptions {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

// Minimal event emitter mixin (avoids import from 'events' which breaks browser builds)
type EventListener = (...args: unknown[]) => void;

class MinimalEventEmitter {
  private _listeners: Map<string, EventListener[]> = new Map();

  on(event: string, listener: EventListener): this {
    const listeners = this._listeners.get(event) ?? [];
    listeners.push(listener);
    this._listeners.set(event, listeners);
    return this;
  }

  once(event: string, listener: EventListener): this {
    const wrapper: EventListener = (...args) => {
      this.removeListener(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  removeListener(event: string, listener: EventListener): this {
    const listeners = this._listeners.get(event);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.length === 0) return false;
    // Copy array to avoid mutation during iteration
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }

  // Aliases for compatibility
  addListener(event: string, listener: EventListener): this {
    return this.on(event, listener);
  }

  off(event: string, listener: EventListener): this {
    return this.removeListener(event, listener);
  }
}

/**
 * Synthetic IncomingMessage that mimics Node.js http.IncomingMessage.
 * Implements event emitter interface to support readable stream events (data, end).
 */
class SyntheticIncomingMessage extends MinimalEventEmitter {
  public method: string;
  public url: string;
  public headers: Record<string, string>;
  public httpVersion = '1.1';
  public httpVersionMajor = 1;
  public httpVersionMinor = 1;
  public complete = false;
  public readable = true;
  private bodyBuffer: string;
  private bodyEmitted = false;

  constructor(options: SyntheticMessageOptions) {
    super();
    this.method = options.method;
    this.url = options.url;
    this.headers = options.headers;
    this.bodyBuffer = options.body;

    // Emit body data on next tick (async, like real streams)
    // Use setTimeout for browser compatibility (process.nextTick is Node-only)
    setTimeout(() => {
      if (!this.bodyEmitted) {
        this.bodyEmitted = true;
        if (this.bodyBuffer) {
          // Convert string to Buffer-like if available, otherwise use string
          const data = typeof Buffer !== 'undefined' 
            ? Buffer.from(this.bodyBuffer) 
            : this.bodyBuffer;
          this.emit('data', data);
        }
        this.complete = true;
        this.readable = false;
        this.emit('end');
      }
    }, 0);
  }

  // Express and other frameworks often check these
  get socket(): Record<string, unknown> {
    return {
      remoteAddress: '127.0.0.1',
      remotePort: 0,
      localAddress: '127.0.0.1',
      localPort: 0,
    };
  }

  get connection(): Record<string, unknown> {
    return this.socket;
  }
}

type ResponseCallback = (statusCode: number, headers: Record<string, string>, body: string) => void;

/**
 * Synthetic ServerResponse that mimics Node.js http.ServerResponse.
 * Captures written data and calls a callback when the response is finished.
 */
class SyntheticServerResponse extends MinimalEventEmitter {
  public statusCode = 200;
  public statusMessage = 'OK';
  public headersSent = false;
  public finished = false;
  public writable = true;
  private _headers: Record<string, string> = {};
  private _body: (string | Uint8Array)[] = [];
  private _callback: ResponseCallback;

  constructor(callback: ResponseCallback) {
    super();
    this._callback = callback;
  }

  // Set status code
  writeHead(statusCode: number, statusMessage?: string | Record<string, string>, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (typeof statusMessage === 'string') {
      this.statusMessage = statusMessage;
      if (headers) {
        this._mergeHeaders(headers);
      }
    } else if (statusMessage && typeof statusMessage === 'object') {
      this._mergeHeaders(statusMessage);
    }
    this.headersSent = true;
    return this;
  }

  // Set a single header
  setHeader(name: string, value: string | number | string[]): this {
    const val = Array.isArray(value) ? value.join(', ') : String(value);
    this._headers[name.toLowerCase()] = val;
    return this;
  }

  getHeader(name: string): string | undefined {
    return this._headers[name.toLowerCase()];
  }

  removeHeader(name: string): void {
    delete this._headers[name.toLowerCase()];
  }

  hasHeader(name: string): boolean {
    return name.toLowerCase() in this._headers;
  }

  getHeaders(): Record<string, string> {
    return { ...this._headers };
  }

  // Write body data
  write(chunk: string | Uint8Array, encoding?: string | (() => void), callback?: () => void): boolean {
    if (this.finished) return false;

    // Store as-is
    this._body.push(chunk);

    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof callback === 'function') {
      callback();
    }

    return true;
  }

  // Finish the response
  end(chunk?: string | Uint8Array | (() => void), encoding?: string | (() => void), callback?: () => void): this {
    if (this.finished) return this;

    // Handle overloaded signatures
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = undefined;
    } else if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    if (chunk !== undefined) {
      this.write(chunk as string | Uint8Array);
    }

    this.finished = true;
    this.writable = false;

    // Concatenate body parts into a string
    let bodyStr = '';
    for (const part of this._body) {
      if (typeof part === 'string') {
        bodyStr += part;
      } else {
        // Uint8Array / Buffer
        bodyStr += new TextDecoder().decode(part);
      }
    }
    
    this._callback(this.statusCode, this._headers, bodyStr);

    this.emit('finish');

    if (typeof callback === 'function') {
      callback();
    }

    return this;
  }

  // Compatibility methods
  flushHeaders(): void {
    this.headersSent = true;
  }

  cork(): void { /* no-op */ }
  uncork(): void { /* no-op */ }

  private _mergeHeaders(headers: Record<string, string>): void {
    for (const [k, v] of Object.entries(headers)) {
      this._headers[k.toLowerCase()] = v;
    }
  }
}
