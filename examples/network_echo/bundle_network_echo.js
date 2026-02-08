// Example: Echo Service Pack (Standard HTTP)
// An isomorphic pack that receives greeting messages from greeter-service
// and responds with "Hello back from Echo service".
// Uses standard HTTP patterns — Stark intercepts automatically in Node.js.
// In the browser, uses context.listen (the one exception).
// Tracks request counts, latency, and caller metadata for networking diagnostics.
//
// Usage:
//   1. Register this as a pack:   stark pack register --name echo-pack --file examples/network_echo/bundle_network_echo.js
//   2. Create a service:          stark service create echo-service --pack echo-pack --replicas 2
//   3. Allow traffic:             stark network allow greeter-service echo-service
//   4. The greeter-service will automatically call this service on an interval.
//
// Works in both Node.js and browser (Web Worker) environments.
module.exports.default = async function(context) {
  const podId = context.podId || 'unknown-pod';
  const serviceId = 'echo-service';
  const startTime = Date.now();
  let requestCount = 0;

  console.log(`[${serviceId}] Starting on pod ${podId}`);

  // ── Node.js: use standard http server (Stark intercepts automatically) ──
  if (typeof require !== 'undefined') {
    const http = require('http');

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : null;

        if (req.url === '/echo' || req.url === '/echo/') {
          requestCount++;
          const now = Date.now();
          const callerTimestamp = parsed?.timestamp || null;
          const networkLatencyMs = callerTimestamp ? now - callerTimestamp : null;

          console.log(`[${serviceId}] #${requestCount} ${req.method} ${req.url} from ${parsed?.from || 'unknown'} (pod ${parsed?.podId || '?'}) | seq=${parsed?.seq ?? '?'} | network latency=${networkLatencyMs !== null ? networkLatencyMs + 'ms' : 'n/a'} | on pod ${podId}`);

          const response = {
            message: `Hello back from Echo service`,
            echo: parsed,
            service: serviceId,
            podId: podId,
            method: req.method,
            path: req.url,
            requestNumber: requestCount,
            uptimeMs: now - startTime,
            receivedAt: now,
            networkLatencyMs: networkLatencyMs,
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } else if (req.url === '/health' || req.url === '/health/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', podId, service: serviceId, uptimeMs: Date.now() - startTime, totalRequests: requestCount }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown route: ${req.method} ${req.url}` }));
        }
      });
    });

    // Stark intercepts listen() and routes WebRTC requests to this server
    const port = parseInt(context.env?.PORT || '0', 10);
    server.listen(port, () => {
      const addr = server.address();
      console.log(`[${serviceId}] HTTP server listening on port ${addr.port} (pod ${podId})`);
    });
  }

  // ── Browser: use context.listen (explicit handler registration) ──
  if (context.listen) {
    context.listen.handle('/echo', async (method, path, body) => {
      requestCount++;
      const now = Date.now();
      const callerTimestamp = body?.timestamp || null;
      const networkLatencyMs = callerTimestamp ? now - callerTimestamp : null;

      console.log(`[${serviceId}] #${requestCount} ${method} ${path} from ${body?.from || 'unknown'} (pod ${body?.podId || '?'}) | seq=${body?.seq ?? '?'} | network latency=${networkLatencyMs !== null ? networkLatencyMs + 'ms' : 'n/a'} | on pod ${podId}`);

      const response = {
        message: `Hello back from Echo service`,
        echo: body,
        service: serviceId,
        podId: podId,
        method: method,
        path: path,
        requestNumber: requestCount,
        uptimeMs: now - startTime,
        receivedAt: now,
        networkLatencyMs: networkLatencyMs,
      };
      return { status: 200, body: response };
    });

    context.listen.handle('/health', async () => {
      return { status: 200, body: { status: 'healthy', podId, service: serviceId, uptimeMs: Date.now() - startTime, totalRequests: requestCount } };
    });

    context.listen.setDefault(async (method, path) => {
      return { status: 404, body: { error: `Unknown route: ${method} ${path}` } };
    });
  }

  console.log(`[${serviceId}] Ready on pod ${podId} — waiting for greeter-service calls`);

  // Wait for shutdown
  if (context.onShutdown) {
    context.onShutdown((reason) => {
      console.log(`[${serviceId}] Shutting down pod ${podId} after ${requestCount} requests: ${reason || 'no reason'}`);
    });
  }

  // Keep alive
  while (!context.lifecycle?.isShuttingDown) {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return { message: `${serviceId} on ${podId} stopped after handling ${requestCount} requests` };
};
