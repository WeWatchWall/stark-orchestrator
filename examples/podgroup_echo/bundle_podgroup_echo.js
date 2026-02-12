// Example: PodGroup Echo Service Pack (Isomorphic)
// Demonstrates the ephemeral PodGroup messaging feature.
//
// This pack:
//   1. Joins a shared PodGroup ("demo:podgroup-chat")
//   2. Exposes a /echo route (via ephemeral handler) returning "Hello BACK from echo"
//   3. Waits for incoming ephemeral queries from the greeter-service
//   4. Logs all incoming queries and responses for networking diagnostics
//
// Unlike the network_echo example (which uses an HTTP server / context.listen),
// this pack uses the EphemeralDataPlane for lightweight, in-memory, TTL-scoped
// pod-to-pod messaging within a shared PodGroup.
//
// Usage:
//   1. Register this as a pack:   stark pack register --name podgroup-echo-pack --file examples/podgroup_echo/bundle_podgroup_echo.js
//   2. Create a service:          stark service create podgroup-echo-service --pack podgroup-echo-pack --replicas 2
//   3. The podgroup-greeter-service must also be running in the same PodGroup.
//
// Works in both Node.js and browser (Web Worker) environments.
module.exports.default = async function(context) {
  const podId = context.podId || 'unknown-pod';
  const serviceId = 'podgroup-echo-service';
  const groupId = 'demo:podgroup-chat';
  const startTime = Date.now();
  const runtime = typeof require !== 'undefined' ? 'node' : 'browser';
  let requestCount = 0;

  console.log(`[${serviceId}] Starting on pod ${podId} (runtime: ${runtime})`);

  // ── Obtain the EphemeralDataPlane from context ──
  // The orchestrator injects context.ephemeral (an EphemeralDataPlane instance)
  // for packs that opt into PodGroup messaging.
  const plane = context.ephemeral;
  if (!plane) {
    console.error(`[${serviceId}] No EphemeralDataPlane found on context — PodGroup messaging unavailable`);
    return { message: `${serviceId} on ${podId}: no ephemeral data plane` };
  }

  // ── Join the shared PodGroup ──
  const membership = await plane.joinGroup(groupId, { ttl: 300_000, metadata: { role: 'echo' } });
  console.log(`[${serviceId}] Joined PodGroup "${groupId}" (ttl=${membership.ttl}ms)`);

  // ── Register /echo handler — responds to ephemeral queries ──
  plane.handle('/echo', (path, query) => {
    requestCount++;
    const now = Date.now();
    const callerTimestamp = query?.timestamp ? parseInt(query.timestamp, 10) : null;
    const networkLatencyMs = callerTimestamp ? now - callerTimestamp : null;

    console.log(
      `[${serviceId}] #${requestCount} ${path} from ${query?.from || 'unknown'} ` +
      `| seq=${query?.seq ?? '?'} ` +
      `| network latency=${networkLatencyMs !== null ? networkLatencyMs + 'ms' : 'n/a'} ` +
      `| on pod ${podId}`
    );

    return {
      status: 200,
      body: {
        message: 'Hello BACK from echo',
        echo: query,
        service: serviceId,
        podId: podId,
        path: path,
        requestNumber: requestCount,
        uptimeMs: now - startTime,
        receivedAt: now,
        networkLatencyMs: networkLatencyMs,
        runtime: runtime,
      },
    };
  });

  // ── Register /health handler ──
  plane.handle('/health', () => {
    return {
      status: 200,
      body: {
        status: 'healthy',
        podId: podId,
        service: serviceId,
        uptimeMs: Date.now() - startTime,
        totalRequests: requestCount,
        runtime: runtime,
      },
    };
  });

  console.log(`[${serviceId}] Registered /echo and /health handlers`);

  // ── Periodic membership refresh to stay in the group ──
  const refreshId = setInterval(async () => {
    if (context.lifecycle?.isShuttingDown) return;
    await plane.joinGroup(groupId, { ttl: 120_000, metadata: { role: 'echo' } });

    const members = await plane.getGroupPods(groupId);
    console.log(`[${serviceId}] Membership refresh — ${members.length} pod(s) in group "${groupId}" | handled ${requestCount} queries so far`);
  }, 30_000);

  console.log(`[${serviceId}] Ready on pod ${podId} — waiting for PodGroup queries`);

  // Wait for shutdown
  if (context.onShutdown) {
    context.onShutdown((reason) => {
      clearInterval(refreshId);
      plane.leaveAllGroups();
      console.log(`[${serviceId}] Shutting down pod ${podId} after ${requestCount} requests: ${reason || 'no reason'}`);
    });
  }

  // Keep alive
  while (!context.lifecycle?.isShuttingDown) {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  clearInterval(refreshId);
  await plane.leaveAllGroups();
  return { message: `${serviceId} on ${podId} stopped after handling ${requestCount} requests` };
};
