# Stark Orchestrator Architecture

This document describes the architecture of the Stark Orchestrator, an isomorphic JavaScript orchestration platform for deploying and managing software packages across Node.js and browser runtimes.

## Table of Contents

1. [Overview](#overview)
2. [Design Principles](#design-principles)
3. [System Architecture](#system-architecture)
4. [Package Structure](#package-structure)
5. [Core Concepts](#core-concepts)
6. [Data Flow](#data-flow)
7. [State Management](#state-management)
8. [Authentication & Authorization](#authentication--authorization)
9. [Scheduling System](#scheduling-system)
10. [Database Schema](#database-schema)
11. [API Design](#api-design)
12. [WebSocket Protocol](#websocket-protocol)
13. [Deployment Architecture](#deployment-architecture)

---

## Overview

Stark Orchestrator manages the deployment and lifecycle of software packages ("packs") across distributed runtimes. It supports both Node.js servers and browser clients as deployment targets, using an isomorphic core that works identically in both environments.

### Key Characteristics

- **Isomorphic Design**: Core business logic runs in any JavaScript environment
- **Reactive State**: Vue.js reactivity system for automatic state synchronization
- **Kubernetes-Inspired**: Familiar concepts like namespaces, taints, and affinity
- **Real-Time Updates**: WebSocket connections for live status monitoring
- **Secure by Default**: Authentication and RBAC on all protected endpoints

---

## Design Principles

### 1. Isomorphic Core
The `@stark-o/core` package contains no platform-specific code. It uses only standard JavaScript/TypeScript features and the Vue reactivity system, enabling it to run in Node.js, browsers, or any JavaScript runtime.

### 2. Separation of Concerns
```
shared/     → Types, validation, utilities (pure functions)
core/       → Business logic, reactive state (platform-agnostic)
server/     → HTTP API, WebSocket server (Node.js specific)
*-runtime/  → Platform adapters (Node.js/browser specific)
cli/        → Command-line interface (Node.js specific)
```

### 3. Reactive-First State Management
All state changes propagate automatically through Vue's reactivity system. This eliminates manual synchronization and ensures consistency across the application.

### 4. Test-Driven Development
- 80% code coverage target
- Integration tests for all user stories
- Contract tests for API endpoints
- Unit tests for business logic

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clients                                  │
├─────────────────┬───────────────────┬───────────────────────────┤
│   CLI Client    │   Browser Agent   │      Node.js Agent        │
│  (stark-cli)    │ (browser-runtime) │    (node-runtime)         │
└────────┬────────┴─────────┬─────────┴────────────┬──────────────┘
         │                  │                      │
         │    REST API      │     WebSocket        │
         ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Orchestrator Server                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │   REST API   │  │   WebSocket  │  │    Middleware        │   │
│  │  (Express)   │  │   Server     │  │ - Auth               │   │
│  │              │  │   (ws)       │  │ - RBAC               │   │
│  │ /api/packs   │  │              │  │ - Rate Limiting      │   │
│  │ /api/pods    │  │ /ws          │  │ - Correlation ID     │   │
│  │ /api/nodes   │  │              │  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                            │                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Core Services                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐      │   │
│  │  │    Pack     │  │    Pod      │  │    Node      │      │   │
│  │  │  Registry   │  │  Scheduler  │  │   Manager    │      │   │
│  │  └─────────────┘  └─────────────┘  └──────────────┘      │   │
│  │  ┌─────────────┐  ┌─────────────┐                        │   │
│  │  │  Namespace  │  │    Auth     │                        │   │
│  │  │   Manager   │  │  Service    │                        │   │
│  │  └─────────────┘  └─────────────┘                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   Reactive Stores                        │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │   │
│  │  │ Cluster  │ │   Node   │ │   Pod    │ │   Pack   │     │   │
│  │  │  Store   │ │  Store   │ │  Store   │ │  Store   │     │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Supabase                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  PostgreSQL  │  │     Auth     │  │       Storage        │   │
│  │  (Database)  │  │   (Users)    │  │   (Pack Bundles)     │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

### @stark-o/shared
Pure utility functions, types, and validation schemas. No dependencies on other packages.

```
shared/
├── src/
│   ├── types/           # TypeScript type definitions
│   │   ├── user.ts      # User, Role types
│   │   ├── pack.ts      # Pack, RuntimeTag types
│   │   ├── node.ts      # Node, NodeStatus types
│   │   ├── pod.ts       # Pod, PodStatus types
│   │   ├── labels.ts    # Labels, LabelSelector types
│   │   ├── taints.ts    # Taint, Toleration types
│   │   ├── scheduling.ts # Affinity, scheduling types
│   │   ├── namespace.ts # Namespace, Quota types
│   │   └── cluster.ts   # ClusterConfig types
│   ├── validation/      # Input validation functions
│   ├── errors/          # Custom error classes
│   ├── logging/         # Structured logging
│   └── utils/           # Pure utility functions
└── tests/
```

### @stark-o/core
Isomorphic business logic with Vue reactivity. Depends only on `@stark-o/shared` and `@vue/reactivity`.

```
core/
├── src/
│   ├── models/          # Reactive data models
│   │   ├── pack.ts      # Pack model with validation
│   │   ├── pod.ts       # Pod model with state machine
│   │   ├── node.ts      # Node model with health tracking
│   │   ├── user.ts      # User model with roles
│   │   └── namespace.ts # Namespace model with quotas
│   ├── services/        # Business logic services
│   │   ├── pack-registry.ts   # Pack registration & versioning
│   │   ├── pod-scheduler.ts   # Pod orchestration & scheduling
│   │   ├── node-manager.ts    # Node lifecycle management
│   │   ├── namespace-manager.ts # Namespace & quota management
│   │   └── auth.ts            # Authentication integration
│   ├── stores/          # Reactive state stores
│   │   ├── cluster-store.ts   # Global cluster state
│   │   ├── node-store.ts      # Node registry
│   │   ├── pod-store.ts       # Active pods
│   │   └── pack-store.ts      # Pack catalog
│   └── types/           # Re-exports from shared
└── tests/
```

### @stark-o/server
HTTP REST API and WebSocket server. Node.js specific.

```
server/
├── src/
│   ├── api/             # REST API routes
│   │   ├── router.ts    # Central router
│   │   ├── packs.ts     # Pack endpoints
│   │   ├── pods.ts      # Pod endpoints
│   │   ├── nodes.ts     # Node endpoints
│   │   ├── namespaces.ts # Namespace endpoints
│   │   └── auth.ts      # Auth endpoints
│   ├── ws/              # WebSocket handling
│   │   ├── connection-manager.ts
│   │   └── handlers/
│   ├── middleware/      # Express middleware
│   │   ├── auth-middleware.ts
│   │   ├── rbac-middleware.ts
│   │   └── rate-limit-middleware.ts
│   ├── supabase/        # Database queries
│   └── index.ts         # Server entry point
└── tests/
```

### @stark-o/node-runtime
Node.js runtime adapter for executing packs.

```
node-runtime/
├── src/
│   ├── adapters/        # Platform adapters
│   │   ├── fs-adapter.ts       # File system operations
│   │   ├── http-adapter.ts     # HTTP client
│   │   └── worker-adapter.ts   # worker_threads wrapper
│   ├── agent/           # Node agent
│   │   └── node-agent.ts       # Registers with orchestrator
│   └── executor/        # Pack execution
│       └── pack-executor.ts    # Executes packs in workers
```

### @stark-o/browser-runtime
Browser runtime adapter for executing packs in browsers.

```
browser-runtime/
├── src/
│   ├── adapters/        # Platform adapters
│   │   ├── storage-adapter.ts  # IndexedDB wrapper
│   │   ├── fetch-adapter.ts    # Fetch API wrapper
│   │   └── worker-adapter.ts   # Web Worker wrapper
│   ├── agent/           # Browser agent
│   │   └── browser-agent.ts    # Registers with orchestrator
│   └── executor/        # Pack execution
│       └── pack-executor.ts    # Executes packs in Web Workers
```

### @stark-o/cli
Command-line interface for orchestrator operations.

```
cli/
├── src/
│   ├── commands/        # CLI commands
│   │   ├── auth.ts      # login, logout, whoami
│   │   ├── pack.ts      # bundle, register, list
│   │   ├── node.ts      # list, status
│   │   ├── deploy.ts    # create, rollback, status
│   │   └── namespace.ts # create, list, delete
│   ├── config.ts        # Configuration management
│   ├── output.ts        # Output formatting
│   └── index.ts         # CLI entry point
```

---

## Core Concepts

### Pack
A bundled software package that can be deployed to nodes.

```typescript
interface Pack {
  id: string;
  name: string;
  version: string;
  runtimeTag: 'node' | 'browser' | 'universal';
  ownerId: string;
  bundlePath: string;
  description?: string;
  createdAt: Date;
}
```

### Node
A runtime environment that can execute packs.

```typescript
interface Node {
  id: string;
  name: string;
  runtimeType: 'node' | 'browser';
  status: 'healthy' | 'unhealthy' | 'unknown';
  lastHeartbeat: Date;
  capabilities: Record<string, unknown>;
  labels: Record<string, string>;
  taints: Taint[];
}
```

### Pod
A running instance of a pack on a specific node.

```typescript
interface Pod {
  id: string;
  packId: string;
  packVersion: string;
  nodeId: string;
  namespaceId: string;
  status: 'pending' | 'scheduled' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  tolerations: Toleration[];
  priority: number;
}
```

### Namespace
An isolated resource boundary with quotas.

```typescript
interface Namespace {
  id: string;
  name: string;
  resourceQuota: {
    maxPods: number;
    maxCpu: string;
    maxMemory: string;
  };
  labels: Record<string, string>;
}
```

---

## Data Flow

### Pack Registration Flow
```
CLI/API → Server → Validation → Pack Registry → Database → Storage
                                     ↓
                              Reactive Store Update
```

### Pod Creation Flow
```
CLI/API → Server → Validation → Pod Scheduler → Node Selection
                                     ↓
                              Scheduling Checks:
                              - Runtime compatibility
                              - Namespace quotas
                              - Taint/toleration matching
                              - Affinity rules
                              - Priority scoring
                                     ↓
                              Node Assignment → Database
                                     ↓
                              WebSocket → Node Agent → Pack Executor
```

### Node Health Flow
```
Node Agent → WebSocket → Server → Node Manager → Heartbeat Processing
                                       ↓
                                 Health Status Update
                                       ↓
                                 Reactive Store Update
```

---

## State Management

State is managed through Vue's reactivity system in the core stores:

```typescript
// Cluster Store - Global state
const clusterStore = reactive({
  nodes: new Map<string, Node>(),
  config: { ... },
  schedulingPolicy: { ... }
});

// Watch for changes
watch(
  () => clusterStore.nodes.size,
  (count) => console.log(`Cluster has ${count} nodes`)
);
```

### Store Update Pattern
```typescript
// Services modify stores, reactivity propagates changes
nodeManager.registerNode(nodeData); // Modifies nodeStore
podScheduler.schedulePod(podData);  // Modifies podStore
```

---

## Authentication & Authorization

### Authentication Flow
```
Client → POST /auth/login → Supabase Auth → JWT Token
                                ↓
              Token stored in client (cookie/localStorage)
                                ↓
         Subsequent requests include Authorization header
```

### RBAC Implementation
Uses CASL for attribute-based access control:

```typescript
// Role hierarchy
const roles = {
  admin: ['manage:all'],
  operator: ['read:all', 'manage:nodes', 'manage:pods'],
  developer: ['read:all', 'manage:packs', 'create:pods'],
  viewer: ['read:all']
};

// Permission check
if (can('delete', 'Pod', pod)) {
  await deletePod(pod.id);
}
```

---

## Scheduling System

### Scheduling Algorithm
```
1. Filter nodes by runtime compatibility
2. Filter nodes by taint/toleration matching
3. Apply required affinity rules (hard constraints)
4. Score nodes by:
   - Preferred affinity rules (soft constraints)
   - Resource availability
   - Priority class
5. Select highest-scoring node
6. Check namespace quotas
7. Schedule pod
```

### Taints and Tolerations
```yaml
# Node taint
node:
  taints:
    - key: "dedicated"
      value: "gpu"
      effect: "NoSchedule"

# Pod toleration
pod:
  tolerations:
    - key: "dedicated"
      operator: "Equal"
      value: "gpu"
      effect: "NoSchedule"
```

### Affinity Rules
```yaml
pod:
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: "zone"
                operator: "In"
                values: ["us-west-1a"]
```

---

## Database Schema

### Core Tables
```
users          - User accounts and roles
packs          - Registered pack metadata
nodes          - Registered node information
pods           - Pod instances
pod_history    - Pod lifecycle audit log
namespaces     - Namespace definitions
priority_classes - Priority class definitions
cluster_config - Cluster-wide configuration
```

### Key Relationships
```
users 1--* packs      (owner)
packs 1--* pods       (deployed from)
nodes 1--* pods       (runs on)
namespaces 1--* pods  (contains)
```

---

## API Design

### REST Principles
- Resource-based URLs (`/api/packs`, `/api/pods`)
- HTTP methods for CRUD (`GET`, `POST`, `PUT`, `DELETE`)
- Consistent response format:

```typescript
// Success
{
  "success": true,
  "data": { ... }
}

// Error
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid pack name"
  }
}
```

### Request Correlation
All requests include correlation IDs for distributed tracing:
```
X-Correlation-ID: abc-123-def-456
```

---

## WebSocket Protocol

### Message Format
```typescript
interface WebSocketMessage {
  type: string;      // e.g., 'node:register', 'node:heartbeat'
  payload: unknown;
  timestamp: string;
  correlationId?: string;
}
```

### Message Types
```
node:register    - Register a new node
node:heartbeat   - Send heartbeat signal
node:disconnect  - Node disconnecting
pod:status       - Pod status update
pod:logs         - Pod log stream
```

---

## Deployment Architecture

### Development
```
Local machine:
├── Supabase (Docker)
│   ├── PostgreSQL
│   ├── Auth
│   └── Storage
└── Server (Node.js)
    └── https://localhost:443
```

### Production
```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           ▼                 ▼                 ▼
    ┌──────────┐      ┌──────────┐      ┌──────────┐
    │ Server 1 │      │ Server 2 │      │ Server N │
    └────┬─────┘      └────┬─────┘      └────┬─────┘
         │                 │                 │
         └─────────────────┼─────────────────┘
                           ▼
                    ┌──────────────┐
                    │   Supabase   │
                    │   (Hosted)   │
                    └──────────────┘
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| API Response (p95) | < 200ms |
| Deploy Cycle | < 60s |
| Concurrent Nodes | 100 |
| Packs | 1,000 |
| Concurrent Users | 5 |
| Heartbeat Timeout | 30s |

---

## Security Considerations

1. **Authentication**: All protected endpoints require valid JWT
2. **Authorization**: RBAC enforced via CASL middleware
3. **Input Validation**: All inputs validated at API boundary
4. **Rate Limiting**: Protect against abuse
5. **CORS**: Configurable origin whitelist
6. **SQL Injection**: Parameterized queries via Supabase
7. **Secrets**: Environment variables, never committed

---

## Future Considerations

1. **Horizontal Scaling**: Multiple server instances with shared state
2. **Event Sourcing**: Full audit trail via events
3. **Metrics**: Prometheus/Grafana integration
4. **Service Mesh**: Istio/Linkerd for inter-service communication
5. **Custom Schedulers**: Pluggable scheduling algorithms
