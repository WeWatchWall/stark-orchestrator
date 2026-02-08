// Example: Greeter Service Pack — Browser variant
// Periodically sends "Hello world from Greeter service" to echo-service via fetch().
// Does NOT expose any API endpoints — echo-service is the only one handling requests.
// Uses setInterval to call echo-service every 3 seconds with rich metadata.
// Logs both outgoing requests and incoming responses for networking diagnostics.
//
// Stark transparently intercepts fetch() calls to *.internal URLs and routes them
// through the WebRTC-based pod-to-pod transport. No special API needed.
//
// Usage:
//   1. Register this as a pack:   stark pack register --name greeter-pack-browser --file examples/network_greeter/bundle_network_greeter_browser.js
//   2. Create a service:          stark service create greeter-service --pack greeter-pack-browser --replicas 1
//   3. The echo-service must be running to receive calls.
//   4. Allow traffic:             stark network allow greeter-service echo-service
//
// Browser only — see bundle_network_greeter_node.js for the Node.js variant.
module.exports.default = async function(context) {
  const podId = context.podId || 'unknown-pod';
  const serviceId = 'greeter-service';
  const startTime = Date.now();
  let seq = 0;
  let successCount = 0;
  let errorCount = 0;

  console.log(`[${serviceId}] Starting on pod ${podId}`);
  console.log(`[${serviceId}] Will send greetings to echo-service every 3 seconds`);

  // ── Periodic greeting → echo-service ──
  const intervalId = setInterval(async () => {
    if (context.lifecycle?.isShuttingDown) return;

    seq++;
    const now = Date.now();
    const payload = {
      message: 'Hello world from Greeter service',
      from: serviceId,
      podId: podId,
      seq: seq,
      timestamp: now,
      uptimeMs: now - startTime,
      runtime: 'browser',
    };

    console.log(`[${serviceId}] → Sending greeting #${seq} to echo-service (uptime ${now - startTime}ms)`);

    try {
      const sendTime = Date.now();
      // Standard fetch() — Stark intercepts *.internal URLs in browser too
      const res = await fetch('http://echo-service.internal/echo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const roundTripMs = Date.now() - sendTime;
      const body = await res.json();
      successCount++;

      console.log(`[${serviceId}] ← Response #${seq} from echo-service (pod ${body.podId || '?'}): "${body.message}" | status=${res.status} | round-trip=${roundTripMs}ms | network latency=${body.networkLatencyMs ?? 'n/a'}ms | echo req#${body.requestNumber || '?'} | success=${successCount} errors=${errorCount}`);
    } catch (err) {
      errorCount++;
      const msg = err && err.message ? err.message : String(err);
      // Dig into nested cause chain (Node.js undici wraps real errors in err.cause)
      let causeChain = '';
      let current = err && err.cause;
      while (current) {
        causeChain += ` → cause: ${current.message || current.code || String(current)}`;
        if (current.code) causeChain += ` [code=${current.code}]`;
        if (current.hostname) causeChain += ` [host=${current.hostname}]`;
        if (current.port !== undefined) causeChain += ` [port=${current.port}]`;
        if (current.syscall) causeChain += ` [syscall=${current.syscall}]`;
        current = current.cause;
      }
      console.error(`[${serviceId}] ✖ Error on greeting #${seq}: ${msg}${causeChain} | success=${successCount} errors=${errorCount}`);
      if (err && err.stack) console.error(`[${serviceId}]   stack: ${err.stack.split('\n').slice(0, 5).join(' | ')}`);
    }
  }, 3000);

  console.log(`[${serviceId}] Ready on pod ${podId} — greeting loop active`);

  // Wait for shutdown signal
  if (context.onShutdown) {
    context.onShutdown((reason) => {
      clearInterval(intervalId);
      console.log(`[${serviceId}] Shutting down pod ${podId}: ${reason || 'no reason'} | sent ${seq} greetings (${successCount} ok, ${errorCount} errors)`);
    });
  }

  // Keep alive
  while (!context.lifecycle?.isShuttingDown) {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  clearInterval(intervalId);
  return { message: `${serviceId} on ${podId} stopped after ${seq} greetings (${successCount} ok, ${errorCount} errors)` };
};
