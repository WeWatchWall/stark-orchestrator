# Stark Orchestrator — Inter-Service Communication (Leader-less with Pod-Pod Caching)

**Task:** Implement inter-service communication for my Stark Orchestrator using pod-to-pod WebRTC caching with orchestrator fallback.

---

## Requirements

### 1. Service-to-Service Calls
- Pods call other services using virtual URLs: `http://{serviceId}.internal/{path}`.
- The orchestrator is authoritative **only if the caller pod has no cached target pod** or the cached pod is unavailable.
- Most requests should go **directly pod-to-pod** via cached WebRTC channels.

### 2. Pod-Level Load Balancing
- Each pod can cache **a target pod per service** for a configurable TTL.
- Orchestrator selects the pod if cache is missing or invalid.
- Pod-level load balancing can be sticky (reuse same target pod) or non-sticky (refresh each request after TTL).
- Node-level caching is optional; transport caching occurs per pod-to-pod WebRTC connection.

### 3. Transport Layer (Pod-Pod)
- Pods communicate directly via WebRTC (browser + Node.js) using `simple-peer`.
- Maintain persistent WebRTC channels **per target pod**.
- Reuse an existing pod connection if it exists and the pod is healthy.
- If the target pod is unavailable, query the orchestrator for a new pod and establish a new WebRTC connection.

### 4. Routing Logic
- Pod request flow:
  1. Check local cache for a target pod of the service.
  2. If cache hit and pod healthy → send request via pod-pod WebRTC.
  3. If cache miss or pod unavailable → query orchestrator → get a new target pod → update cache → open WebRTC channel.
  4. Include **target pod ID** in each request envelope so the receiving pod can route internally if necessary (e.g., multi-container pods).
- Orchestrator is **minimally involved**: only on first request, cache miss, or failed pod recovery.

### 5. Service Registry
- Orchestrator maintains a mapping: `serviceId → [{ podId, nodeId, status }]`.
- Each pod maintains a local cache of **target pods for services it communicates with**, including pod health.

### 6. Network Policies
- Enforce inter-service allowed/denied communication based on `sourceService → targetService`.
- Denied calls fail immediately before opening any WebRTC connection.
- Network policies are **not enabled by default**; must be explicitly configured.
- Configurable at runtime via CLI or API.
- CLI examples:
  - ```stark network allow api-service users-service```
  - ```stark network deny frontend-service db-service```

### 7. Environment
- Must run in both Node.js and browser (Web Workers) environments.
- Code should be import-friendly (can import logger, network utilities, etc.).
- Include example packs with a universal runtime (isomorphic) that talk to each other and log output:  
  `"Hello world from service X on pod Y"`

### 8. Additional Notes
- Keep **transport abstraction separate from pod-level routing**.
- Orchestrator **never proxies traffic** — it only handles fallback routing for cache misses.
- Include handling for pod churn: if a cached pod dies, query orchestrator for a new one.
- Pod-pod caching should support **TTL or manual invalidation** to prevent stale connections.

---

## Output
Provide TypeScript implementation of:

1. Orchestrator routing function (select pod for service, update registry)
2. Pod-side wrapper for making service calls with pod-pod caching
3. WebRTC connection manager (per target pod)
4. Pod-level load balancer (within orchestrator selection)
5. Enforcement of network policies

**Focus on correctness and separation of layers.** Performance optimizations can come later.
