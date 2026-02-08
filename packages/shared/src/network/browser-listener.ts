/**
 * Browser Listener for Inbound Inter-Service Communication
 *
 * In browser environments (Web Workers), there is no `http.createServer`.
 * Packs must explicitly register request handlers using this listener.
 *
 * This is the **one exception** to Stark's transparent HTTP interception:
 * browser packs need a special listen/handle function for inbound traffic.
 *
 * Wraps PodRequestRouter with a friendlier API.
 *
 * @module @stark-o/shared/network/browser-listener
 */

import { PodRequestRouter, type RequestHandler } from './orchestrator-router.js';
import type { ServiceRequest, ServiceResponse } from '../types/network.js';

/**
 * StarkBrowserListener
 *
 * Provides an explicit handler registration API for browser-based packs.
 *
 * @example
 * ```ts
 * // In a browser pack:
 * module.exports.default = async function(context) {
 *   // context.listen is a StarkBrowserListener
 *
 *   context.listen.handle('/greet', async (method, path, body) => {
 *     return { status: 200, body: { message: 'Hello!' } };
 *   });
 *
 *   context.listen.handle('/echo', async (method, path, body) => {
 *     return { status: 200, body: { echo: body } };
 *   });
 *
 *   context.listen.setDefault(async (method, path) => {
 *     return { status: 404, body: { error: `Not found: ${method} ${path}` } };
 *   });
 * };
 * ```
 */
export class StarkBrowserListener {
  private router: PodRequestRouter;

  constructor(router?: PodRequestRouter) {
    this.router = router ?? new PodRequestRouter();
  }

  /**
   * Register a handler for a specific path prefix.
   *
   * @param pathPrefix - Path prefix to match (e.g. '/api/users')
   * @param handler - Handler function: (method, path, body, headers?) => { status, body?, headers? }
   */
  handle(pathPrefix: string, handler: RequestHandler): void {
    this.router.handle(pathPrefix, handler);
  }

  /**
   * Set a default handler for paths that don't match any registered prefix.
   */
  setDefault(handler: RequestHandler): void {
    this.router.setDefault(handler);
  }

  /**
   * Dispatch an incoming ServiceRequest to the registered handlers.
   * Called by the browser runtime when a WebRTC request arrives.
   */
  async dispatch(request: ServiceRequest): Promise<ServiceResponse> {
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
   * Get the underlying PodRequestRouter (for advanced use or testing).
   */
  getRouter(): PodRequestRouter {
    return this.router;
  }
}
