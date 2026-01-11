# Implementation Plan: Stark Orchestrator

**Branch**: `001-stark-orchestrator-core` | **Date**: 2026-01-02 | **Spec**: [spec-stark-orchestrator.md](spec-stark-orchestrator.md)
**Input**: Feature specification from `.specify/memory/spec-stark-orchestrator.md`

## Summary

Build an isomorphic JavaScript orchestration platform using TypeScript and Vue's reactive system as the core state management layer. The system enables registration, pod deployment, and lifecycle management of software packages ("packs") across Node.js servers and browser runtimes. Vue reactivity provides automatic propagation of cluster state changes across the isomorphic codebase without requiring a traditional frontend. Supabase (running locally) serves as the central database, auth provider, and real-time communication layer.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: 
- Vue 3 (reactive system only - `@vue/reactivity`)
- Supabase JS Client (`@supabase/supabase-js`)
- Vite (build tooling for isomorphic bundles)
- Vitest (testing framework)
- ws (WebSocket for Node.js)

**Storage**: Supabase PostgreSQL (local instance) + Supabase Storage for pack bundles
**Testing**: Vitest with coverage, Playwright for E2E
**Target Platform**: Node.js 20+ (server), Modern browsers (Chrome 90+, Firefox 90+, Safari 15+)
**Project Type**: Monorepo with shared isomorphic core
**Performance Goals**: 100 concurrent nodes, <200ms API response (p95), <60s deploy cycle
**Constraints**: Isomorphic core must work identically in Node.js and browser; no Node-specific APIs in shared code
**Scale/Scope**: MVP supports 100 nodes, 1000 packs, 5 concurrent users

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | ✅ Pass | TypeScript strict mode; ESLint + Prettier enforced |
| II. Testing Standards | ✅ Pass | Vitest for unit/integration; TDD workflow; 80% coverage target |
| III. UX Consistency | ✅ Pass | CLI-first; consistent error messages; structured output (JSON/human) |
| IV. Performance | ✅ Pass | Targets defined: <200ms API, <60s deploy, 100 nodes |
| V. Observability | ✅ Pass | Structured JSON logging; correlation IDs planned |
| Security | ✅ Pass | Supabase Auth; RBAC; input validation at boundaries |

## Project Structure

### Documentation (this feature)

```text
.specify/memory/
├── plan-stark-orchestrator.md    # This file
├── spec-stark-orchestrator.md    # Feature specification
├── research.md                   # Phase 0 output (if needed)
├── data-model.md                 # Phase 1 output
└── contracts/                    # API contracts
```

### Source Code (repository root)

```text
packages/
├── core/                         # Isomorphic shared core (Vue reactivity)
│   ├── src/
│   │   ├── models/               # Reactive state models (Pack, Node, Pod, User)
│   │   ├── services/             # Business logic services
│   │   │   ├── pack-registry.ts      # Pack registration & versioning
│   │   │   ├── pod-scheduler.ts  # Pod orchestration
│   │   │   ├── node-manager.ts       # Node lifecycle & health
│   │   │   └── auth.ts               # Auth integration
│   │   ├── stores/               # Reactive state stores (Vue reactive/ref)
│   │   │   ├── cluster-store.ts      # Global cluster state
│   │   │   ├── node-store.ts         # Node registry state
│   │   │   └── pod-store.ts   # Active pods state
│   │   ├── types/                # Shared TypeScript types
│   │   └── index.ts              # Public API exports
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   └── package.json
│
├── node-runtime/                 # Node.js-specific runtime adapter
│   ├── src/
│   │   ├── adapters/             # Platform adapters (fs, http, worker_threads)
│   │   ├── agent/                # Node agent (registers with orchestrator)
│   │   ├── executor/             # Pack execution engine (worker_threads)
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── browser-runtime/              # Browser-specific runtime adapter
│   ├── src/
│   │   ├── adapters/             # Platform adapters (fetch, IndexedDB, Web Workers)
│   │   ├── agent/                # Browser agent (registers with orchestrator)
│   │   ├── executor/             # Pack execution engine (Web Workers)
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── server/                       # Orchestrator server (Node.js)
│   ├── src/
│   │   ├── api/                  # REST API routes
│   │   │   ├── packs.ts
│   │   │   ├── nodes.ts
│   │   │   ├── pods.ts
│   │   │   └── auth.ts
│   │   ├── ws/                   # WebSocket handlers
│   │   │   ├── connection-manager.ts
│   │   │   └── handlers/
│   │   ├── supabase/             # Supabase client & queries
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
├── cli/                          # Command-line interface
│   ├── src/
│   │   ├── commands/
│   │   │   ├── pack.ts           # pack register, pack list, pack deploy
│   │   │   ├── node.ts           # node list, node status
│   │   │   ├── deploy.ts         # deploy, rollback, status
│   │   │   └── auth.ts           # login, logout, whoami
│   │   └── index.ts
│   ├── tests/
│   └── package.json
│
└── shared/                       # Shared utilities (truly universal)
    ├── src/
    │   ├── types/                # Shared TypeScript types
    │   │   ├── user.ts
    │   │   ├── pack.ts
    │   │   ├── node.ts
    │   │   ├── deployment.ts
    │   │   ├── labels.ts             # Kubernetes-like labels & selectors
    │   │   ├── taints.ts             # Kubernetes-like taints & tolerations
    │   │   ├── scheduling.ts         # Kubernetes-like affinity & scheduling
    │   │   ├── namespace.ts          # Kubernetes-like namespaces
    │   │   └── cluster.ts            # Kubernetes-like cluster config
    │   ├── validation/           # Input validation schemas
    │   │   ├── pack-validation.ts
    │   │   ├── node-validation.ts
    │   │   ├── pod-validation.ts
    │   │   ├── namespace-validation.ts   # Kubernetes-like
    │   │   ├── cluster-validation.ts     # Kubernetes-like
    │   │   └── scheduling-validation.ts  # Kubernetes-like
    │   ├── errors/               # Error types
    │   ├── logging/              # Structured logging
    │   └── utils/                # Pure utility functions
    ├── tests/
    └── package.json

supabase/
├── config.toml                   # Supabase local config (exists)
├── migrations/                   # Database migrations
│   ├── 001_users.sql
│   ├── 002_packs.sql
│   ├── 003_nodes.sql
│   ├── 004_pods.sql
│   ├── 005_pod_history.sql
│   ├── 006_cluster_config.sql       # Kubernetes-like cluster configuration
│   ├── 007_namespaces.sql           # Kubernetes-like namespaces
│   ├── 008_priority_classes.sql     # Kubernetes-like priority classes
│   └── 009_kubernetes_like_fields.sql # Labels, taints, tolerations
└── seed.sql                      # Development seed data

tests/
├── e2e/                          # End-to-end tests
│   ├── deploy-flow.spec.ts
│   └── node-registration.spec.ts
└── contract/                     # Contract tests
    ├── api-contracts.spec.ts
    └── ws-contracts.spec.ts
```

**Structure Decision**: Monorepo with package separation to enforce isomorphic boundaries. The `core` package contains all business logic using Vue reactivity and must never import Node.js or browser-specific APIs. Runtime adapters (`node-runtime`, `browser-runtime`) implement platform-specific functionality and inject into core via dependency injection. This ensures the same reactive state management works identically across environments.

## Key Architectural Decisions

### Vue Reactivity for State Management

Vue's `@vue/reactivity` package provides:
- `reactive()` for cluster state objects (nodes, pods, packs)
- `ref()` for primitive values (connection status, counters)
- `computed()` for derived state (available nodes, health summaries)
- `watch()` / `watchEffect()` for side effects (sync to database, trigger pod deployments)

**Example Pattern**:
```typescript
// packages/core/src/stores/cluster-store.ts
import { reactive, computed, watch } from '@vue/reactivity'

export const clusterState = reactive({
  nodes: new Map<string, Node>(),
  pods: new Map<string, Pods>(),
})

export const healthyNodes = computed(() => 
  [...clusterState.nodes.values()].filter(n => n.status === 'healthy')
)

// Auto-sync to Supabase when state changes
watch(() => clusterState.nodes, (nodes) => {
  // Persist to database
}, { deep: true })
```

### Isomorphic Boundaries

| Layer | Isomorphic? | Notes |
|-------|-------------|-------|
| `core` | ✅ Yes | Vue reactivity, business logic, no I/O |
| `shared` | ✅ Yes | Pure functions, validation, types |
| `node-runtime` | ❌ Node only | worker_threads, fs, http |
| `browser-runtime` | ❌ Browser only | Web Workers, IndexedDB, fetch |
| `server` | ❌ Node only | HTTP server, WebSocket server |
| `cli` | ❌ Node only | Terminal I/O |

### Supabase Integration

```
┌─────────────────────────────────────────────────────────┐
│                    Supabase (Local)                     │
├─────────────┬─────────────┬─────────────┬──────────────┤
│ PostgreSQL  │   Auth      │   Storage   │   Realtime   │
│ (entities)  │ (users/JWT) │ (bundles)   │ (ws events)  │
└─────────────┴─────────────┴─────────────┴──────────────┘
        │             │             │              │
        └─────────────┴─────────────┴──────────────┘
                            │
                    ┌───────┴───────┐
                    │    Server     │
                    │  (packages/   │
                    │   server)     │
                    └───────────────┘
```

## Data Model Summary

| Entity | Primary Key | Key Fields | Relationships |
|--------|-------------|------------|---------------|
| User | `id` (uuid) | email, roles[], createdAt | owns Packs, creates Pods |
| Pack | `id` (uuid) | name, version, runtimeTag, ownerId, bundlePath | owned by User, deployed to Nodes |
| Node | `id` (uuid) | name, runtimeType, status, lastHeartbeat, **labels**, **taints**, **allocatable** | runs Pods |
| Pod | `id` (uuid) | packId, packVersion, nodeId, status, **namespace**, **labels**, **tolerations**, **scheduling**, **priority** | links Pack to Node |
| PodHistory | `id` (uuid) | podId, action, timestamp, actorId | audit log |
| **Namespace** | `id` (uuid) | name, phase, labels, resourceQuota, limitRange | isolates resources |
| **PriorityClass** | `id` (uuid) | name, value, globalDefault, preemptionPolicy | scheduling priority |
| **ClusterConfig** | `id` (uuid) | name, maxPodsPerNode, schedulingPolicy, defaultNamespace | cluster-wide settings |

## Kubernetes-Like Features

Stark Orchestrator implements several Kubernetes-inspired concepts for advanced orchestration:

### Labels & Annotations
- **Labels**: Key-value pairs for organizing and selecting resources (nodes, packs, pods)
- **Annotations**: Non-identifying metadata for tooling and integrations
- **Label Selectors**: Query resources using `matchLabels` and `matchExpressions`

### Namespaces
- Resource isolation boundaries for multi-tenant environments
- **Resource Quotas**: Limit CPU, memory, pod deployments, pods per namespace
- **Limit Ranges**: Default and max/min resource constraints
- Reserved namespaces: `default`, `stark-system`, `stark-public`

### Taints & Tolerations
- **Taints**: Applied to nodes to repel pod deployments (NoSchedule, PreferNoSchedule, NoExecute)
- **Tolerations**: Allow pod deployments to schedule on tainted nodes
- Enables dedicated nodes, special hardware isolation, and maintenance modes

### Scheduling & Affinity
- **Node Affinity**: Schedule pod deployments based on node labels (required/preferred)
- **Deployment Affinity**: Co-locate pod deployments on same nodes
- **Deployment Anti-Affinity**: Spread pod deployments across nodes
- **Scheduling Policies**: Spread, BinPack, Random, Affinity, LeastLoaded

### Priority Classes
- **Priority Values**: Integer priority for preemption decisions
- **Preemption Policies**: PreemptLowerPriority, Never
- Built-in classes: system-node-critical, system-cluster-critical, high-priority, default, low-priority

### Resource Management
- **Allocatable Resources**: CPU (millicores), memory (MB), pods, storage per node
- **Resource Limits/Requests**: Per-pod resource constraints
- **Cluster Config**: Global defaults and policies

## Implementation Phases

### Phase 0: Foundation (Week 1)
- [ ] Initialize monorepo with pnpm workspaces
- [ ] Configure TypeScript, ESLint, Prettier
- [ ] Set up Vitest for all packages
- [ ] Create Supabase migrations for all entities
- [ ] Implement `shared` package (types, validation, errors, logging)
- [ ] Implement `core` package skeleton with Vue reactivity stores

### Phase 1: Core Services (Week 2)
- [ ] Implement `core/services/pack-registry.ts`
- [ ] Implement `core/services/node-manager.ts`
- [ ] Implement `core/services/pod-scheduler.ts`
- [ ] Implement `core/stores/*` with full reactivity
- [ ] Unit tests for all core services (80% coverage)

### Phase 2: Server & API (Week 3)
- [ ] Implement REST API endpoints (packs, nodes, pods, auth)
- [ ] Implement WebSocket connection manager
- [ ] Implement heartbeat handling
- [ ] Integration tests against local Supabase
- [ ] Contract tests for API

### Phase 3: Runtime Adapters (Week 4)
- [ ] Implement `node-runtime` agent and executor
- [ ] Implement `browser-runtime` agent and executor
- [ ] E2E test: deploy pack to Node.js node
- [ ] E2E test: deploy pack to browser node

### Phase 4: CLI (Week 5)
- [ ] Implement CLI commands (pack, node, deploy, auth)
- [ ] CLI integration tests
- [ ] User documentation

### Phase 5: Polish & P2 Features (Week 6)
- [ ] Pack versioning and rollback
- [ ] Runtime tag validation
- [ ] Performance testing (100 nodes)
- [ ] Security audit

## Complexity Tracking

> No constitution violations identified. Architecture follows separation of concerns with clear isomorphic boundaries.

| Decision | Justification |
|----------|---------------|
| Monorepo with 6 packages | Required to enforce isomorphic boundaries; each package has distinct runtime requirements |
| Vue reactivity in core | Provides automatic state propagation without framework overhead; works in all JS environments |
| Supabase for all storage | Single platform for auth, database, storage, and realtime; reduces operational complexity |

## Open Questions Resolution

| Question | Decision |
|----------|----------|
| Max pack bundle size | 50MB (Supabase Storage limit configurable) |
| Browser node persistence | Reconnect with same node ID via localStorage token |
| Pack execution isolation | worker_threads (Node), Web Workers (browser) |
| Pack dependencies | Self-contained bundles only (bundled with esbuild/vite) |
| Logging | Structured JSON to stdout; correlation IDs; OpenTelemetry-ready |
