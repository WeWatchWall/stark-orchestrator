// Example: Echo Service Pack — Browser variant
// Receives greeting messages from greeter-service and responds with "Hello back from Echo service".
// Runs inside a Web Worker; Stark routes incoming requests to registered handlers.
// Tracks request counts, latency, and caller metadata for networking diagnostics.
//
// Usage:
//   1. Register this as a pack:   stark pack register --name echo-pack-browser --file examples/network_echo/bundle_network_echo_browser.js
//   2. Create a service:          stark service create echo-service --pack echo-pack-browser --replicas 2
//   3. Allow traffic:             stark network allow greeter-service echo-service
//   4. The greeter-service will automatically call this service on an interval.
//
// Browser only — see bundle_network_echo_node.js for the Node.js variant.
module.exports.default = async function(context) {
  const podId = context.podId || 'unknown-pod';
  const serviceId = 'echo-service';
  const startTime = Date.now();
  let requestCount = 0;

  console.log(`[${serviceId}] Starting on pod ${podId}`);

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
