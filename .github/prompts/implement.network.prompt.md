# Stark Orchestrator — Inter-Service Communication

**Task:** Implement inter-service communication for my Stark Orchestrator.

---

## Requirements

### 1. Service-to-Service Calls
- Pods call other services using virtual URLs: `http://{serviceId}.internal/{path}`.
- The orchestrator is authoritative for the **first request routing**.
- The orchestrator returns the chosen pod and its node for each request.

### 2. Load Balancing
- Orchestrator should distribute requests across all available pods of a service.
- Implement a simple load balancing strategy (round-robin, random, or weighted if info available).
- Sessions are sticky by default so that stateful pods can talk to the same target over multiple requests.

### 3. Transport Layer
- Nodes communicate directly via WebRTC (compatible with browser + Node.js) via the simple-peer library.
- Maintain persistent WebRTC channels to each node.
- Reuse an existing node connection for multiple requests; create a new one if needed.

### 4. Routing Logic
- First request: route through orchestrator → returns pod + node → open WebRTC.
- Subsequent requests: reuse node connection, resolve pod via orchestrator cached info or optional TTL.
- If a pod becomes unavailable, orchestrator must select a new pod automatically.

### 5. Service Registry
- Orchestrator maintains a mapping: `serviceId → { podId, nodeId, status }`.
- Pod health is tracked (suspect, online, offline) for routing decisions.

### 6. Network Policies
- Enforce inter-service allowed/denied communication based on `sourceService → targetService`.
- Denied calls should fail immediately before opening any WebRTC connection.
- Network policies are not enabled by default; they must be explicitly configured.
- Network policies should be configurable at runtime via CLI or API.
- CLI examples:
  - ```stark network allow api-service users-service```
  - ```stark network deny frontend-service db-service```

### 7. Environment
- Must run in both Node.js and browser (Web Workers) environments.
- Code should be import-friendly (can import logger, network utilities, etc.).
- Implement some Example packs with a universal runtime (so isomorphic) that talk to each other and log output `Hello world from service X on pod Y`.

### 8. Additional
- Keep transport abstraction separate from service resolution.
- The orchestrator **never proxies traffic** — only first request routing.
- Wrap the HTTP-like interface so service calls feel like normal `fetch`/`axios` calls from pods.

---

## Output
Provide TypeScript implementation of:

1. Orchestrator routing function
2. Pod-side wrapper for making service calls
3. WebRTC connection manager
4. Load balancer integrated into orchestrator
5. Enforcement of network policies

**Focus on correctness and separation of layers. Performance optimizations can come later.**

---

