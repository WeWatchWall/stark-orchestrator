/**
 * Ingress Manager Service
 * @module @stark-o/server/services/ingress-manager
 *
 * Manages ingress ports for services. When a service declares an ingress port,
 * the orchestrator:
 *   1. Opens an HTTP listener on that port.
 *   2. Routes incoming requests to a healthy pod using modulus-based selection
 *      (request parameter → pod index).
 *   3. Relays request/response data to the selected pod via WebSocket
 *      (the orchestrator's existing WebSocket connection to the node agent).
 *   4. Re-balances when pods die or become unhealthy.
 *   5. Cleans up the listener and channels when the service is removed.
 *   6. Restores all ingress listeners on server restart by reading from DB.
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createServiceLogger } from '@stark-o/shared';
import { getServiceRegistry } from '@stark-o/shared';
import type { ServiceRegistryEntry } from '@stark-o/shared';
import { getConnectionManager } from './connection-service.js';

/**
 * Logger for ingress manager
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'ingress-manager' });

/**
 * Tracks an active ingress listener
 */
interface IngressBinding {
  /** Service ID (UUID) */
  serviceId: string;
  /** Service name (for logging) */
  serviceName: string;
  /** The TCP port the HTTPS server listens on */
  port: number;
  /** The HTTPS server instance */
  server: https.Server;
  /** Monotonically increasing request counter for modulus routing */
  requestCounter: number;
}

/**
 * An in-flight request waiting for a pod response via WebSocket
 */
interface PendingRequest {
  /** Express/http response to send data back to the external caller */
  res: http.ServerResponse;
  /** Timeout handle for the request */
  timeout: NodeJS.Timeout;
  /** Service ID the request belongs to */
  serviceId: string;
}

/**
 * Ingress Manager
 *
 * Singleton service that opens HTTP listeners for services with ingress ports
 * and proxies traffic to pods via the orchestrator's WebSocket data plane.
 */
export class IngressManager {
  /** port → IngressBinding */
  private bindings = new Map<number, IngressBinding>();
  /** correlationId → PendingRequest (in-flight proxied requests) */
  private pendingRequests = new Map<string, PendingRequest>();
  /** Default timeout for proxied requests (30 s) */
  private readonly requestTimeoutMs: number;
  /** Host to bind ingress listeners to */
  private readonly host: string;
  /** Cached SSL options for HTTPS ingress listeners */
  private sslOptions: https.ServerOptions | null = null;

  constructor(options?: { requestTimeoutMs?: number; host?: string }) {
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 30_000;
    this.host = options?.host ?? '0.0.0.0';
  }

  /**
   * Load or read cached SSL options from the same .cache/ directory
   * that the main server uses. Falls back to self-signed generation
   * via the `selfsigned` package if no certs exist yet.
   */
  private async getSslOptions(): Promise<https.ServerOptions> {
    if (this.sslOptions) return this.sslOptions;

    // Check environment variables first (production path)
    if (process.env.SSL_CERT && process.env.SSL_KEY) {
      this.sslOptions = {
        cert: fs.readFileSync(process.env.SSL_CERT),
        key: fs.readFileSync(process.env.SSL_KEY),
      };
      return this.sslOptions;
    }

    // Dev path — read the cached self-signed cert that the main server generates
    const cacheDir = path.join(process.cwd(), '.cache');
    const certPath = path.join(cacheDir, 'localhost.crt');
    const keyPath = path.join(cacheDir, 'localhost.key');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      this.sslOptions = {
        cert: fs.readFileSync(certPath, 'utf-8'),
        key: fs.readFileSync(keyPath, 'utf-8'),
      };
      return this.sslOptions;
    }

    // Generate self-signed cert if none exists yet
    const selfsigned = await import('selfsigned');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = await selfsigned.default.generate(attrs, {
      algorithm: 'sha256',
      keySize: 2048,
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ],
        },
      ],
    });

    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(certPath, pems.cert);
    fs.writeFileSync(keyPath, pems.private);

    this.sslOptions = { cert: pems.cert, key: pems.private };
    return this.sslOptions;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Open an ingress listener for a service.
   * Idempotent – if a listener already exists on this port for the same
   * service it is a no-op; if a *different* service claims the port an
   * error is thrown.
   */
  async openIngress(serviceId: string, serviceName: string, port: number): Promise<void> {
    const existing = this.bindings.get(port);
    if (existing) {
      if (existing.serviceId === serviceId) {
        logger.debug('Ingress already open for this service', { serviceId, port });
        return; // idempotent
      }
      throw new Error(
        `Port ${port} is already claimed by service '${existing.serviceName}' (${existing.serviceId})`
      );
    }

    const ssl = await this.getSslOptions();
    const server = https.createServer(ssl, (req, res) => {
      this.handleIngressRequest(port, req, res);
    });

    await new Promise<void>((resolve, reject) => {
      server.on('error', (err) => {
        logger.error('Ingress listener error', err, { port, serviceId });
        reject(err);
      });

      server.listen(port, this.host, () => {
        logger.info('Ingress HTTPS listener opened', { port, serviceName, serviceId });
        resolve();
      });
    });

    this.bindings.set(port, {
      serviceId,
      serviceName,
      port,
      server,
      requestCounter: 0,
    });
  }

  /**
   * Close the ingress listener for a service (by service ID).
   * Also aborts any in-flight requests belonging to this service.
   */
  async closeIngress(serviceId: string): Promise<void> {
    // Find binding by serviceId
    let binding: IngressBinding | undefined;
    for (const b of this.bindings.values()) {
      if (b.serviceId === serviceId) {
        binding = b;
        break;
      }
    }

    if (!binding) {
      logger.debug('No ingress binding found for service', { serviceId });
      return;
    }

    const port = binding.port;

    // Abort any pending requests for this service
    for (const [corrId, pending] of this.pendingRequests) {
      if (pending.serviceId === serviceId) {
        clearTimeout(pending.timeout);
        if (!pending.res.writableEnded) {
          pending.res.writeHead(503, { 'Content-Type': 'application/json' });
          pending.res.end(JSON.stringify({ error: 'Service removed' }));
        }
        this.pendingRequests.delete(corrId);
      }
    }

    // Close the HTTP server
    await new Promise<void>((resolve) => {
      binding!.server.close(() => {
        logger.info('Ingress listener closed', { port, serviceId, serviceName: binding!.serviceName });
        resolve();
      });
    });

    this.bindings.delete(port);
  }

  /**
   * Close ingress by port number.
   */
  async closeIngressByPort(port: number): Promise<void> {
    const binding = this.bindings.get(port);
    if (binding) {
      await this.closeIngress(binding.serviceId);
    }
  }

  /**
   * Handle an incoming WebSocket response from a pod for a proxied ingress request.
   * Called by the connection manager when it receives an `ingress:response` message.
   */
  handleIngressResponse(correlationId: string, payload: {
    status: number;
    headers?: Record<string, string>;
    body?: string;
  }): void {
    const pending = this.pendingRequests.get(correlationId);
    if (!pending) {
      logger.debug('No pending ingress request for correlation ID (may have timed out)', { correlationId });
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(correlationId);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(payload.headers ?? {}),
      };
      pending.res.writeHead(payload.status ?? 200, headers);
      pending.res.end(payload.body ?? '');
    } catch (err) {
      logger.error('Error sending ingress response to client', err instanceof Error ? err : undefined, { correlationId });
    }
  }

  /**
   * Check if a port is bound to an ingress.
   */
  hasIngress(port: number): boolean {
    return this.bindings.has(port);
  }

  /**
   * Get the service ID for a port.
   */
  getServiceIdForPort(port: number): string | undefined {
    return this.bindings.get(port)?.serviceId;
  }

  /**
   * List all active ingress bindings (for debugging / status API).
   */
  listBindings(): Array<{ port: number; serviceId: string; serviceName: string }> {
    return Array.from(this.bindings.values()).map(b => ({
      port: b.port,
      serviceId: b.serviceId,
      serviceName: b.serviceName,
    }));
  }

  /**
   * Shut down all ingress listeners. Called during server shutdown.
   */
  async shutdown(): Promise<void> {
    const ports = Array.from(this.bindings.keys());
    for (const port of ports) {
      await this.closeIngressByPort(port);
    }
    logger.info('All ingress listeners shut down');
  }

  // ──────────────────────────────────────────────────────────────────────
  // Private: request handling & pod routing
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Handle an incoming HTTP request on an ingress port.
   * 1. Selects a pod using modulus on the request counter.
   * 2. Sends the request payload to the pod via WebSocket.
   * 3. Waits for the pod's response (or timeout).
   */
  private handleIngressRequest(port: number, req: http.IncomingMessage, res: http.ServerResponse): void {
    const binding = this.bindings.get(port);
    if (!binding) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No ingress binding for this port' }));
      return;
    }

    const { serviceId, serviceName } = binding;

    // Collect request body
    const bodyChunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(bodyChunks).toString('utf-8');
      this.routeToPoD(binding, req, res, body);
    });
    req.on('error', (err) => {
      logger.error('Ingress request read error', err, { port, serviceId, serviceName });
      if (!res.writableEnded) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request read error' }));
      }
    });
  }

  /**
   * Select a pod and relay the request via WebSocket.
   */
  private routeToPoD(
    binding: IngressBinding,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string,
  ): void {
    const { serviceId, serviceName } = binding;

    // Get healthy pods from the service registry.
    // The registry is keyed by service NAME (not UUID), so use serviceName.
    const registry = getServiceRegistry();
    const healthyPods = registry.getHealthyPods(serviceName);

    if (healthyPods.length === 0) {
      logger.warn('No healthy pods for ingress request', { serviceId, serviceName, port: binding.port });
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No healthy pods available for this service' }));
      return;
    }

    // Use modulus of request counter to pick a pod (deterministic round-robin).
    // The `stark-route` query/header parameter can be used for affinity.
    const routeKey = this.extractRouteKey(req) ?? binding.requestCounter;
    binding.requestCounter++;

    const podIndex = Math.abs(typeof routeKey === 'number' ? routeKey : this.hashString(routeKey)) % healthyPods.length;
    const selectedPod = healthyPods[podIndex]!;

    const correlationId = randomUUID();

    logger.debug('Routing ingress request to pod', {
      serviceId,
      serviceName,
      podId: selectedPod.podId,
      nodeId: selectedPod.nodeId,
      correlationId,
      routeKey,
      podIndex,
      totalPods: healthyPods.length,
    });

    // Send the request to the pod via WebSocket (through its node agent)
    const connectionManager = getConnectionManager();
    if (!connectionManager) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Orchestrator connection manager not available' }));
      return;
    }

    // Build ingress request message
    const ingressMessage = {
      type: 'ingress:request',
      correlationId,
      payload: {
        serviceId,
        podId: selectedPod.podId,
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: this.flattenHeaders(req.headers),
        body,
      },
    };

    // Try sending to the pod directly first (pod may have a direct WS connection)
    let sent = connectionManager.sendToPod(selectedPod.podId, ingressMessage);

    // If direct pod connection not available, send via node agent
    if (!sent) {
      sent = connectionManager.sendToNodeId
        ? connectionManager.sendToNodeId(selectedPod.nodeId, ingressMessage)
        : false;

      // Fallback: try sendToConnection with nodeId as connection lookup
      if (!sent) {
        // The node agent's connection ID may differ from node ID;
        // try looking up node to find its connection ID.
        sent = this.sendViaNodeLookup(selectedPod.nodeId, ingressMessage);
      }
    }

    if (!sent) {
      logger.warn('Failed to relay ingress request — pod/node not connected, trying next pod', {
        podId: selectedPod.podId,
        nodeId: selectedPod.nodeId,
        correlationId,
      });

      // Try other healthy pods as fallback
      const fallbackPod = this.tryFallbackPods(healthyPods, selectedPod.podId, ingressMessage, connectionManager);
      if (!fallbackPod) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unable to reach any healthy pod' }));
        return;
      }
    }

    // Register pending request
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(correlationId);
      if (!res.writableEnded) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request timed out' }));
      }
    }, this.requestTimeoutMs);

    this.pendingRequests.set(correlationId, { res, timeout, serviceId });
  }

  /**
   * Try sending to alternative healthy pods when the primary is unreachable.
   */
  private tryFallbackPods(
    pods: ServiceRegistryEntry[],
    skipPodId: string,
    message: unknown,
    connectionManager: NonNullable<ReturnType<typeof getConnectionManager>>,
  ): boolean {
    for (const pod of pods) {
      if (pod.podId === skipPodId) continue;

      let sent = connectionManager.sendToPod(pod.podId, message as any);
      if (!sent) {
        sent = this.sendViaNodeLookup(pod.nodeId, message as any);
      }
      if (sent) {
        logger.debug('Fallback pod reached', { podId: pod.podId, nodeId: pod.nodeId });
        return true;
      }
    }
    return false;
  }

  /**
   * Send a message to a node by looking up its connection in the connection manager.
   */
  private sendViaNodeLookup(nodeId: string, message: any): boolean {
    const connectionManager = getConnectionManager();
    if (!connectionManager) return false;

    // Use sendToConnection with the node ID
    // The ConnectionManager has a nodeToConnection map
    // We can use the existing sendToNodeId or try the public API
    if (typeof (connectionManager as any).sendToNodeId === 'function') {
      return (connectionManager as any).sendToNodeId(nodeId, message);
    }

    return false;
  }

  /**
   * Extract a route key from the request for affinity-based routing.
   * Checks `X-Stark-Route` header, then `stark-route` query param.
   * Returns null if no explicit key is provided (falls back to counter).
   */
  private extractRouteKey(req: http.IncomingMessage): string | number | null {
    // Check header
    const headerKey = req.headers['x-stark-route'];
    if (headerKey) {
      const num = parseInt(String(headerKey), 10);
      return isNaN(num) ? String(headerKey) : num;
    }

    // Check query parameter
    const url = req.url ?? '';
    const qIndex = url.indexOf('?');
    if (qIndex >= 0) {
      const params = new URLSearchParams(url.slice(qIndex));
      const paramKey = params.get('stark-route');
      if (paramKey) {
        const num = parseInt(paramKey, 10);
        return isNaN(num) ? paramKey : num;
      }
    }

    return null;
  }

  /**
   * Simple string hash for non-numeric route keys.
   */
  private hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      const char = s.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * Flatten Node.js IncomingHttpHeaders to simple Record<string, string>.
   */
  private flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        result[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }
    return result;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────

let _instance: IngressManager | null = null;

/**
 * Get or create the singleton ingress manager.
 */
export function getIngressManager(options?: { requestTimeoutMs?: number; host?: string }): IngressManager {
  if (!_instance) {
    _instance = new IngressManager(options);
  }
  return _instance;
}

/**
 * Reset the ingress manager (for testing).
 */
export function resetIngressManager(): void {
  if (_instance) {
    _instance.shutdown().catch(() => {});
    _instance = null;
  }
}
