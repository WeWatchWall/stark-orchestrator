// Example: PodGroup Greeter Service Pack (Isomorphic)
// Demonstrates the ephemeral PodGroup messaging feature.
//
// This pack:
//   1. Joins a shared PodGroup ("demo:podgroup-chat")
//   2. Exposes a /echo route (via ephemeral handler) returning "Hello from greeter"
//   3. Periodically discovers group members and queries the echo-service's /echo route
//   4. Logs the responses — showcasing bidirectional PodGroup communication
//
// Unlike the network_greeter example (which uses HTTP fetch to *.internal URLs),
// this pack uses the EphemeralDataPlane for lightweight, in-memory, TTL-scoped
// pod-to-pod messaging within a shared PodGroup.
//
// Usage:
//   1. Register this as a pack:   stark pack register --name podgroup-greeter-pack --file examples/podgroup_greeter/bundle_podgroup_greeter.js
//   2. Create a service:          stark service create podgroup-greeter-service --pack podgroup-greeter-pack --replicas 1
//   3. The podgroup-echo-service must also be running in the same PodGroup.
//
// Works in both Node.js and browser (Web Worker) environments.
module.exports.default = async function(context) {
  const podId = context.podId || 'unknown-pod';
  const serviceId = 'podgroup-greeter-service';
  const groupId = 'demo:podgroup-chat';
  const startTime = Date.now();
  const runtime = typeof require !== 'undefined' ? 'node' : 'browser';
  let seq = 0;
  let successCount = 0;
  let errorCount = 0;

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
  const group = await plane.joinGroup(groupId, { ttl: 300_000, metadata: { role: 'greeter' } });
  console.log(`[${serviceId}] Joined PodGroup "${groupId}" (ttl=${group.membership.ttl}ms, ${group.podIds.length} member(s))`);

  // ── Register /echo handler — responds to ephemeral queries ──
  // plane.handle('/echo', (path, query) => {
  //   console.log(`[${serviceId}] Received ephemeral query on ${path} (query: ${JSON.stringify(query || {})})`);
  //   return {
  //     status: 200,
  //     body: {
  //       message: 'Hello from greeter',
  //       from: serviceId,
  //       podId: podId,
  //       path: path,
  //       query: query,
  //       uptimeMs: Date.now() - startTime,
  //     },
  //   };
  // });

  // console.log(`[${serviceId}] Registered /echo handler`);

  // ── Periodic: discover group members & query echo-service pods ──
  const intervalId = setInterval(async () => {
    if (context.lifecycle?.isShuttingDown) return;

    seq++;
    const now = Date.now();

    // Refresh our own membership and update the member list
    await group.refresh();

    const otherPodIds = group.otherPodIds;

    if (otherPodIds.length === 0) {
      console.log(`[${serviceId}] #${seq} No other pods in group "${groupId}" yet (${group.podIds.length} member(s) total)`);
      return;
    }

    console.log(`[${serviceId}] #${seq} Found ${otherPodIds.length} other pod(s) in group — querying /echo`);

    try {
      const sendTime = Date.now();
      const results = await Promise.all(group.queryPods('/echo', {
        from: serviceId,
        seq: String(seq),
        timestamp: String(now),
      }));
      const roundTripMs = Date.now() - sendTime;

      for (const result of results) {
        for (const [targetPodId, response] of result.responses) {
          successCount++;
          const body = response.body || {};
          console.log(
            `[${serviceId}] ← Response #${seq} from pod ${targetPodId}: "${body.message || '(no message)'}" ` +
            `| status=${response.status} | round-trip=${roundTripMs}ms ` +
            `| success=${successCount} errors=${errorCount}`
          );
        }

        for (const timedOutPod of result.timedOut) {
          errorCount++;
          console.warn(`[${serviceId}] ✖ Timeout #${seq} from pod ${timedOutPod} | success=${successCount} errors=${errorCount}`);
        }
      }
    } catch (err) {
      errorCount++;
      const msg = err && err.message ? err.message : String(err);
      console.error(`[${serviceId}] ✖ Error on query #${seq}: ${msg} | success=${successCount} errors=${errorCount}`);
    }
  }, 10_000);

  console.log(`[${serviceId}] Ready on pod ${podId} — PodGroup query loop active`);

  // Wait for shutdown signal
  if (context.onShutdown) {
    context.onShutdown((reason) => {
      clearInterval(intervalId);
      group.leave();
      console.log(`[${serviceId}] Shutting down pod ${podId}: ${reason || 'no reason'} | sent ${seq} queries (${successCount} ok, ${errorCount} errors)`);
    });
  }

  // Keep alive
  while (!context.lifecycle?.isShuttingDown) {
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  clearInterval(intervalId);
  await group.leave();
  return { message: `${serviceId} on ${podId} stopped after ${seq} queries (${successCount} ok, ${errorCount} errors)` };
};
