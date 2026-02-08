// Example: Echo Service Pack — Node.js variant
// Receives greeting messages from greeter-service and responds with "Hello back from Echo service".
// Uses a standard Node.js HTTP server. Stark intercepts listen() and routes WebRTC requests automatically.
// Tracks request counts, latency, and caller metadata for networking diagnostics.
//
// Usage:
//   1. Register this as a pack:   stark pack register --name echo-pack-node --file examples/network_echo/bundle_network_echo_node.js
//   2. Create a service:          stark service create echo-service --pack echo-pack-node --replicas 2
//   3. Allow traffic:             stark network allow greeter-service echo-service
//   4. The greeter-service will automatically call this service on an interval.
//
// Node.js only — see bundle_network_echo_browser.js for the browser variant.
module.exports.default = async function(context) {
  const podId = context.podId || 'unknown-pod';
  const serviceId = 'echo-service';
  const startTime = Date.now();
  let requestCount = 0;

  console.log(`[${serviceId}] Starting on pod ${podId}`);

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
