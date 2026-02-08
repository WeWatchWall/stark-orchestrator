# Stark Orchestrator — Inter-Service Communication (Node-Leader Architecture)

**Task:** Implement inter-service communication for my Stark Orchestrator using node leaders to minimize orchestrator involvement.

---

## Requirements

### 1. Service-to-Service Calls
- Pods call other services using virtual URLs: `http://{serviceId}.internal/{path}`.
- Each service has **node leader pods** that act as local routing authorities for pods on their node.
- Orchestrator is **only involved for first request** if the caller pod does not know the current leader for the target service, or when leader info changes.

### 2. Pod-Level Load Balancing
- Node leaders perform **pod-level load balancing** among all pods of the target service on their node.
- Implement a simple load balancing strategy (round-robin, random, or weighted if info available).
- Sessions are sticky by default so that stateful pods can talk to the same target pod over multiple requests.
- Non-sticky sessions can request different pods on subsequent calls.

### 3. Transport Layer (Node-Level)
- Nodes communicate directly via WebRTC (browser + Node.js) using the `simple-peer` library.
- Maintain persistent WebRTC channels **to each node leader**.
- Reuse an existing node connection for multiple requests; create a new one if needed.
- Include **target pod ID** in each request envelope so the node leader can forward correctly.

### 4. Routing Logic
- Pod requests:
  1. Check local cache for the **current node leader** of the target service.
  2. If missing → query orchestrator → returns node leader info.
  3. Open or reuse WebRTC channel to node leader.
  4. Node leader selects target pod locally and forwards the request.
- Orchestrator involvement is **minimal**, only for:
  - Leader election/updates
  - Pod/node join or leave
  - Cache invalidation or TTL expiry

### 5. Service Registry
- Orchestrator maintains a mapping: `serviceId → [{ nodeLeaderPodId, nodeId, status }]`.
- Node leaders maintain **local pod registry** for their service, with pod health tracked (suspect, online, offline).

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
- Node leaders handle **local pod-level load balancing**.
- Orchestrator **never proxies traffic**, only handles first request routing for leader discovery.
- Include handling for pod churn: node leader re-selection if a pod/node goes offline.

---

## Output
Provide TypeScript implementation of:

1. Orchestrator routing function (node leader election + leader registry)
2. Pod-side wrapper for making service calls
3. Node leader WebRTC connection manager
4. Node leader pod-level load balancer
5. Enforcement of network policies

**Focus on correctness and separation of layers.** Performance optimizations can come later.
