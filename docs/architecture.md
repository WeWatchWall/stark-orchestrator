# Stark Orchestrator — Architecture

> **Version 0.9.2** · Last updated February 2026

Stark is an isomorphic JavaScript orchestration platform that treats both server-side and browser-side code as deployable, schedulable workloads. It borrows proven Kubernetes concepts — pods, nodes, namespaces, scheduling, services — and maps them onto JavaScript runtimes connected over WebSockets.

---

## 1  Design Philosophy

| Principle | What it means in practice |
|---|---|
| **Desired-state reconciliation** | The system continuously compares what is declared (services, replicas) with what exists, and converges. |
| **Isomorphic first** | Core logic is runtime-agnostic TypeScript. The same pack can be scheduled onto a Node.js process *or* a browser tab. |
| **Kubernetes-inspired, JavaScript-native** | Familiar resource model (pods, nodes, taints, tolerations, affinity) — no YAML, no containers, no complex networking. |
| **Reactive state** | Vue 3 `@vue/reactivity` primitives (`ref`, `reactive`, `computed`, `watch`) propagate state changes through every layer. |
| **UI is just another workload** | The browser is a first-class node. UI packs are scheduled and observed identically to backend packs. |
| **Failure is normal** | Auto-restart, crash-loop back-off, heartbeat-based liveness, automatic service rollback after 3 consecutive failures. |
| **Security by default** | RBAC (admin / user / node / viewer), Supabase RLS, pack namespaces with trust boundaries, JWT auth on every request. |
| **Developer experience first** | A single, consistent CLI: `stark <resource> <action> [name] [options]`. |

---

## 2  Conceptual Model

```
┌──────────────────────────────────────────────────────────────────┐
│                        STARK ORCHESTRATOR                        │
│                                                                  │
│   Source Code ──► Bundle ──► Register ──►  PACK  (the "what")    │
│                                             │                    │
│                                    create / deploy               │
│                                             ▼                    │
│   Browser ─────────────────────────►  NODE  (the "where")        │
│   Node.js process ─────────────────►        │                    │
│                                             │ schedule            │
│                                             ▼                    │
│                                          POD  (the "how")        │
│                               Pending → Scheduled → Running      │
│                                          │            │          │
│                                     Stopping    Succeeded/Failed │
│                                          │                       │
│                                       Stopped                    │
└──────────────────────────────────────────────────────────────────┘
```

| Concept | Kubernetes analogue | Description |
|---|---|---|
| **Pack** | Container Image | Immutable, versioned, bundled JavaScript artifact. Private or public visibility. |
| **Pod** | Container / Pod | Ephemeral running instance of a pack on a specific node. Owns its lifecycle state machine. |
| **Node** | Node | A runtime environment (Node.js process or browser tab) connected via WebSocket. Reports heartbeats, resources, labels. |
| **Namespace** | Namespace | Isolation boundary for resource scoping. |
| **Service** | Service | Declarative desired-state spec: replica count, auto-healing, rolling updates, rollback, DaemonSet mode. |

---

## 3  System Architecture

```
 ┌─────────┐   ┌──────────────┐   ┌──────────────┐
 │   CLI   │   │ Browser Node │   │  Node.js Node│
 │(Commander)  │ (Web Workers) │   │(worker_threads)
 └────┬────┘   └──────┬───────┘   └──────┬───────┘
      │  REST/HTTPS    │  WSS             │  WSS
      ▼                ▼                  ▼
 ┌────────────────────────────────────────────────┐
 │                   SERVER                        │
 │                                                 │
 │  ┌────────────┐  ┌──────────────────────────┐   │
 │  │  REST API   │  │  WebSocket Gateway       │   │
 │  │ (Express)   │  │  (ws)                    │   │
 │  └─────┬──────┘  └──────────┬───────────────┘   │
 │        │                    │                    │
 │        ▼                    ▼                    │
 │  ┌─────────────────────────────────────────┐    │
 │  │             CORE SERVICES               │    │
 │  │                                         │    │
 │  │  PackService   PodService   NodeService │    │
 │  │  SchedulerService   ServiceController│    │
 │  │  NodeHealthService  NamespaceService    │    │
 │  │  AuthService   EventService             │    │
 │  └────────────────┬────────────────────────┘    │
 │                   │                              │
 │  ┌────────────────▼────────────────────────┐    │
 │  │          REACTIVE STORES                │    │
 │  │    (@vue/reactivity refs & computeds)    │    │
 │  └────────────────┬────────────────────────┘    │
 │                   │                              │
 └───────────────────┼──────────────────────────────┘
                     │
                     ▼
 ┌──────────────────────────────────────────────────┐
 │                  SUPABASE                         │
 │  PostgreSQL · RLS · Auth · Realtime (Channels)    │
 └──────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Responsibility |
|---|---|
| **CLI** (`packages/cli`) | User-facing command-line interface built on Commander.js. Outputs JSON, table, or plain text. |
| **Client** (`packages/client`) | Nuxt 3 dashboard for visual cluster management. |
| **Server** (`packages/server`) | Express HTTPS server + WebSocket gateway. Starts scheduler, service controller, and node-health services on boot. Auto-generates self-signed TLS certs for development. |
| **Core** (`packages/core`) | Pure orchestration logic — services, stores (reactive), models, queries, type definitions. Zero I/O side-effects; all external interaction injected. |
| **Shared** (`packages/shared`) | Cross-package types, validation functions (~60+), structured logging, utility helpers (retry, deepClone, debounce, etc.), error classes. |
| **Node Runtime** (`packages/node-runtime`) | Runtime adapter for Node.js. `NodeAgent` connects to the server, `PackExecutor` runs packs in `worker_threads`. File-system credential store. |
| **Browser Runtime** (`packages/browser-runtime`) | Runtime adapter for browsers. `BrowserAgent` connects via WebSocket, `PackExecutor` runs packs in Web Workers (Workerpool). IndexedDB credential store (ZenFS). |

---

## 4  Package Dependency Graph

```
                 ┌──────────┐
                 │  shared  │  (types, validation, logging, utils)
                 └────┬─────┘
                      │
              ┌───────┴────────┐
              ▼                ▼
         ┌────────┐       ┌────────┐
         │  core  │       │  cli   │
         └───┬────┘       └────────┘
             │
     ┌───────┼──────────┐
     ▼       ▼          ▼
 ┌────────┐┌──────────┐┌───────────────┐
 │ server ││node-     ││browser-       │
 │        ││runtime   ││runtime        │
 └────────┘└──────────┘└───────────────┘
```

All packages are ESM (`"type": "module"`), built with **tsup** or **Vite**, managed via **pnpm workspaces**.

---

## 5  Data Flows

### 5.1  Pack lifecycle

```
Developer                 CLI                  Server               Database
    │    stark pack bundle   │                     │                     │
    │───────────────────────►│  POST /api/packs    │                     │
    │                        │────────────────────►│  INSERT pack        │
    │                        │                     │────────────────────►│
    │                        │  201 Created        │                     │
    │◄───────────────────────│◄────────────────────│                     │
```

1. **Bundle** — CLI resolves the entry point, runs Vite/Rollup to produce a single self-contained JS artifact with inlined dependencies.
2. **Register** — The bundle content, metadata (name, version, runtime compatibility, resource requirements), and visibility are sent to the server.
3. **Store** — Server validates, deduplicates version, persists to PostgreSQL. Pack is now available for pod creation.

### 5.2  Pod scheduling

```
Client/CLI          Server               Scheduler            Node (agent)
    │ POST /api/pods   │                     │                     │
    │─────────────────►│  validate           │                     │
    │                  │──► pod = Pending     │                     │
    │                  │                     │                     │
    │                  │  scheduleIfPending() │                     │
    │                  │────────────────────►│                     │
    │                  │   Filter → Score     │                     │
    │                  │   → Select node      │                     │
    │                  │◄────────────────────│                     │
    │                  │  pod = Scheduled     │                     │
    │                  │  ws: pod:assign ─────┼────────────────────►│
    │                  │                     │   executor.run(pack) │
    │                  │  ◄── ws: pod:status (Running) ────────────│
    │  200 OK          │                     │                     │
    │◄─────────────────│                     │                     │
```

### 5.3  Node heartbeat & health

```
Node Agent              Server                    NodeHealthService
    │  ws: node:heartbeat  │                           │
    │─────────────────────►│  update lastHeartbeat     │
    │                      │──────────────────────────►│
    │                      │                           │ (periodic check)
    │                      │                           │ if now - lastHeartbeat
    │                      │                           │   > threshold:
    │                      │                           │   node → NotReady → Offline
    │                      │                           │   reschedule pods
```

Nodes send heartbeats at a configurable interval. If a node is unresponsive beyond the threshold, its pods are rescheduled to healthy nodes.

### 5.4  Service reconciliation

```
                  ServiceController (reconciliation loop)
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Count running     Compare to       Handle failures
   pods for deploy   desired replicas  (crash-loop backoff,
          │                │            auto-rollback after 3
          │                │            consecutive failures)
          │                ▼
          │          Create / delete
          │          pods to converge
          ▼
   DaemonSet mode:
   one pod per
   matching node
```

---

## 6  Scheduling Algorithm

The scheduler runs **Filter → Score → Select → Assign**:

### Filter (hard constraints — any failure excludes the node)

| # | Criterion | Detail |
|---|---|---|
| 1 | Resource capacity | `allocatable - allocated ≥ requested` for CPU (millicores) and memory (MB) |
| 2 | Pod count limit | Node's `maxPods` not exceeded |
| 3 | Node selectors | Pod's `nodeSelector` labels match node labels |
| 4 | Taints / tolerations | `NoSchedule` taints block unless tolerated |
| 5 | Runtime type | Pod's required runtime (`node` / `browser`) matches node type |
| 6 | Node schedulable | Node not cordoned (`unschedulable: false`) |
| 7 | Ownership | Private packs only schedule to owner's or admin-registered (trusted) nodes |

### Score (soft preferences — higher is better)

- **Resource balance** — prefer nodes with more headroom.
- **Existing pod count** — spread across nodes.
- **`PreferNoSchedule` taints** — penalty if tolerated but not preferred.
- **Priority** — 0–1000; higher-priority pods may **preempt** lower-priority ones.

### DaemonSet mode

When `replicas = 0`, the controller ensures exactly **one pod per matching node**, automatically adapting as nodes join or leave.

---

## 7  State Management

All in-process state lives in **Vue 3 reactive primitives** exposed by the core stores:

```typescript
// Simplified example
const pods = reactive(new Map<string, Pod>());
const podCount = computed(() => pods.size);

watch(pods, (newPods) => {
  // react to any pod change
});
```

Changes propagate through a reactive pipeline:

```
API request
  → Core service mutates reactive store
    → Database write (Supabase)
      → Realtime channel broadcast
        → WebSocket push to connected nodes / clients
          → Node executor acts on change
            → Status update flows back
```

This eliminates manual pub/sub wiring; adding a `watch()` or `computed()` on any store value is enough to react to cluster-wide state changes.

---

## 8  Security Architecture

### Authentication

```
User ──► POST /auth/login ──► Supabase Auth ──► JWT
                                                  │
                              every request carries │
                              Authorization: Bearer ◄┘
```

Initial admin bootstrap: `stark auth setup` (only works when zero users exist).

### Authorization (RBAC)

| Role | Capabilities |
|---|---|
| **admin** | Full cluster access. Register system packs. Mark nodes trusted. Manage all users. |
| **user** | Self-service: own packs, pods, services, namespaces. Cannot access other users' private resources. |
| **node** | Agent role. Receives only its assigned pod data. |
| **viewer** | Read-only across visible resources. |

### Trust boundaries

```
┌──────────────────────────────────────────────┐
│               Pack Namespaces                │
│                                              │
│  ┌──────────────┐     ┌──────────────────┐   │
│  │   "system"   │     │     "user"       │   │
│  │  Admin-only  │     │  Any user can    │   │
│  │  Cluster-wide│     │  register packs  │   │
│  │  access      │     │  Scoped access   │   │
│  └──────┬───────┘     └────────┬─────────┘   │
│         │                      │             │
│         ▼                      ▼             │
│  Trusted nodes only     Any node             │
│  (admin-registered)     (including user)     │
└──────────────────────────────────────────────┘
```

### Database security

Every table enforces Supabase **Row-Level Security** (RLS) policies. Users can only query rows they own or that are public. Service-role access (used by the server) bypasses RLS.

---

## 9  Event System

Events are **first-class, structured, persistent, queryable** records:

```json
{
  "id": "uuid",
  "eventType": "PodScheduled",
  "category": "pod",
  "severity": "info",
  "resourceType": "pod",
  "resourceId": "pod-uuid",
  "resourceName": "my-api-pod",
  "previousState": "Pending",
  "newState": "Scheduled",
  "reason": "Scheduled",
  "message": "Pod scheduled to node web-node-1",
  "correlationId": "request-uuid",
  "timestamp": "2026-02-05T12:00:00Z"
}
```

**Categories:** Pod · Node · Service · Pack · System · Auth · Scheduler

Events are emitted by database triggers and programmatic calls, delivered in real time over WebSocket channels, and queryable via `GET /api/events`.

---

## 10  Database Schema

27 incremental migrations define the schema in `supabase/migrations/`:

| Table | Purpose |
|---|---|
| `users` | User accounts (synced from Supabase Auth) with roles |
| `packs` | Registered pack metadata, bundle content, version history |
| `nodes` | Connected runtime nodes — labels, taints, resources, heartbeat, trust |
| `pods` | Running instances — state, assigned node, resource requests, config |
| `pod_history` | Audit trail of pod state transitions |
| `namespaces` | Isolation boundaries |
| `cluster_config` | Singleton cluster-wide settings |
| `services` | Desired-state declarations with replica targets |
| `priority_classes` | Named priority levels for preemption |
| `events` | Structured event log |

All tables include `created_at`, `updated_at`, and owner references. RLS policies enforce access control at the database level.

---

## 11  Runtime Adapters

Both runtime adapters implement the same conceptual interface — only the underlying primitives differ:

| Concern | Node.js (`node-runtime`) | Browser (`browser-runtime`) |
|---|---|---|
| Pack execution | `worker_threads` | Web Workers (Workerpool) |
| Credential storage | File system (`~/.stark/`) | IndexedDB (ZenFS) |
| HTTP client | Axios / Node fetch | Axios / Fetch API |
| WebSocket | `ws` library | Native `WebSocket` |
| Agent class | `NodeAgent` | `BrowserAgent` |

### Execution contract for root packages

Root packs run on the **main thread** and share fate with their node. They **must not** perform unbounded synchronous work. The runtime may terminate and restart any pack that blocks the event loop beyond its execution budget.

---

## 12  CLI Design

```
stark <resource> <action> [name] [options]

  auth      login | logout | whoami | setup | register | users
  pack      bundle | register | list | versions
  pod       create | status | rollback | delete | list
  service create | list | status | scale | pause | resume | delete
  node      list | status | update | cordon | uncordon | agents
  namespace list | create | delete
  config    get | set
  status    (cluster-wide health summary)
```

Global options: `--output json|table|plain`, `--api-url`, `--no-color`, `-k/--insecure`.

---

## 13  WebSocket Protocol

All persistent connections use WSS. Messages are JSON with a `type` field:

| Direction | Message | Payload |
|---|---|---|
| Node → Server | `node:register` | Node metadata, labels, resources, capabilities |
| Node → Server | `node:heartbeat` | Timestamp, resource usage snapshot |
| Server → Node | `pod:assign` | Pod spec + pack bundle content |
| Node → Server | `pod:status` | Pod ID, new state, optional exit code / error |
| Server → Node | `pod:stop` | Pod ID, reason |

---

## 14  Observability

- **Structured JSON logging** — every log line carries `timestamp`, `level`, `service`, `nodeId`, `podId`, `userId`.
- **Health endpoint** — `GET /health` returns server status.
- **Node heartbeats** — configurable interval; missed heartbeats trigger `NotReady` → `Offline` transitions and pod rescheduling.
- **Real-time WebSocket events** — subscribe to `node:*`, `pod:*`, `service:*` channels.
- **Crash-loop detection** — exponential back-off with automatic service rollback after 3 consecutive failures.
- **Resource monitoring** — `stark node status` shows allocatable vs. allocated CPU/memory; `stark pod status` shows per-pod resource usage.
- **JSON output** — `--output json` for scripting and pipeline integration.

---

## 15  Service Topology

### Development

```
pnpm dev
  └─► Vite dev server (hot reload)
  └─► Supabase local (Docker)
  └─► Express + WSS on https://localhost:443  (self-signed cert)
```

### Production

```
┌───────────────┐       ┌───────────────┐
│  Load Balancer│──────►│  Stark Server │──► Supabase (managed)
│  (TLS term.)  │       │  (Express+WSS)│
└───────────────┘       └───────┬───────┘
                                │ WSS
                   ┌────────────┼────────────┐
                   ▼            ▼            ▼
              Node Agent   Node Agent   Browser Agent
              (worker_     (worker_     (Web Workers)
               threads)     threads)
```

---

## 16  Technology Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.x (strict, ESM) |
| Reactivity | `@vue/reactivity` (Vue 3 standalone) |
| HTTP server | Express 4 |
| WebSocket | `ws` |
| Database | PostgreSQL (via Supabase) |
| Auth | Supabase Auth (JWT) |
| Realtime | Supabase Realtime (Postgres Changes) |
| CLI framework | Commander.js |
| Bundler | Vite / Rollup / tsup |
| Testing | Vitest |
| Monorepo | pnpm workspaces |
| Linting | ESLint 9 + Prettier 3 |

---

## 17  What Stark Is Not

- **Not a Kubernetes replacement.** It orchestrates JavaScript workloads, not arbitrary containers.
- **Not a serverless platform.** Nodes are persistent; packs are long-running or short-lived but explicitly managed.
- **Not a build system.** Bundling is a CLI convenience — you can bring your own artifacts.
- **Not a multi-cloud abstraction.** It operates within a single Stark cluster (one server, many nodes).
