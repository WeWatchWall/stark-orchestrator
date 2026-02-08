# Stark Orchestrator — Inter-Service Communication (Leader-less with Pod-Pod Caching)

**Task:** Implement inter-service communication for my Stark Orchestrator using pod-to-pod WebRTC caching with orchestrator fallback. **Sticky sessions are the default**.

---

## Requirements

### 1. Service-to-Service Calls
- Pods call other services using virtual URLs: `http://{serviceId}.internal/{path}`.
- **Sticky sessions are the default**: a pod will reuse the same target pod for repeated requests until TTL expires or the pod becomes unavailable.
- Non-sticky sessions can be enabled as an **optional override** via API or request flag.
- Orchestrator is authoritative **only if the caller pod has no cached target pod** or the cached pod is unavailable.

### 2. Pod-Level Load Balancing
- Each pod caches a **target pod per service** (sticky).  
- Non-sticky sessions:
  - Orchestrator can return **a single pod only**.
- Node-level caching is optional; transport caching occurs per pod-to-pod WebRTC connection.

### 3. Transport Layer (Pod-Pod)
- Pods communicate directly via WebRTC (browser + Node.js) using `simple-peer`.
- Maintain persistent WebRTC channels **per target pod**.
- Reuse existing pod connections if healthy; open new connections if the target pod changes or is unavailable.
- Include **target pod ID** in each request envelope so the receiving pod can route internally if needed.

### 4. Routing Logic
- Pod request flow:
  1. Check local cache for a target pod of the service.
  2. If cache hit and pod healthy → send request via pod-pod WebRTC (sticky default).
  3. If cache miss, pod unavailable, or non-sticky request → query orchestrator → get pod → update cache → open WebRTC channel.
- Orchestrator involvement is **minimal**, only for cache misses, pod failures, or non-sticky selection.

### 5. Service Registry
- Orchestrator maintains a mapping: `serviceId → [{ podId, nodeId, status }]`.
- Each pod maintains a **local cache of target pods** for services it communicates with, including pod health.

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
- Orchestrator **never proxies traffic** — it only handles fallback routing for cache misses or non-sticky selection.
- Include handling for pod churn: if a cached pod dies, query orchestrator for a new one.
- Pod-pod caching should support **TTL or manual invalidation** to prevent stale connections.
- **Sticky sessions are preferred**; non-sticky sessions should only be used where load balancing across multiple pods per request is strictly required.

---

## Output
Provide TypeScript implementation of:

1. Orchestrator routing function (select pod(s) for service, update registry)
2. Pod-side wrapper for making service calls with pod-pod caching
3. WebRTC connection manager (per target pod)
4. Pod-level load balancer (within orchestrator selection if needed for non-sticky sessions)
5. Enforcement of network policies

**Focus on correctness, separation of layers, and sticky session default behavior.** Performance optimizations can come later.
