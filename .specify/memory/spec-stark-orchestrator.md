# Feature Specification: Stark Orchestrator

**Feature Branch**: `001-stark-orchestrator-core`  
**Created**: 2026-01-02  
**Status**: Draft  
**Input**: User description: "Build an application that can orchestrate software across JavaScript environments. Isomorphic across NodeJS server and browser runtimes. Software organized into packages (packs) deployed across nodes similar to Kubernetes. Central database for packs, users, nodes, and other data."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register and Deploy a Pack (Priority: P1)

As a developer, I want to register a JavaScript package (pack) to the central registry and deploy it to a target node, so that my software runs in the desired environment (Node.js server or browser).

**Why this priority**: This is the core value proposition - without pack registration and pod, the orchestrator has no purpose. This enables the fundamental workflow of the entire system.

**Independent Test**: Can be fully tested by uploading a simple pack, selecting a target node, and verifying the pack executes correctly on that node. Delivers immediate value by proving the orchestration pipeline works end-to-end.

**Acceptance Scenarios**:

1. **Given** I am an authenticated user with a valid pack, **When** I submit the pack to the registry, **Then** the pack is stored in the central database with metadata (name, version, runtime compatibility)
2. **Given** a registered pack exists, **When** I select a target node and trigger pod deployment, **Then** the pack is transferred to the node and starts executing
3. **Given** a pack is deployed to a node, **When** I query the pod status, **Then** I receive the current state (pending, running, stopped, error)
4. **Given** a pack with Node.js runtime requirement, **When** I attempt to deploy to a browser-only node, **Then** the system rejects with a compatibility error

---

### User Story 2 - Node Registration and Health Monitoring (Priority: P1)

As an operator, I want to register nodes (servers or browser instances) with the orchestrator and monitor their health, so that I know which nodes are available for pods.

**Why this priority**: Equal priority to Story 1 because pods require available nodes. The orchestrator cannot function without a node registry.

**Independent Test**: Can be tested by registering a Node.js server node, observing it appear in the node list, and verifying health status updates in real-time.

**Acceptance Scenarios**:

1. **Given** I have a Node.js server or browser runtime, **When** I run the Stark agent, **Then** the node registers with the central orchestrator with its capabilities (runtime type, resources)
2. **Given** a registered node, **When** the node sends periodic heartbeats, **Then** the orchestrator updates the node's last-seen timestamp and health status
3. **Given** a registered node stops sending heartbeats, **When** the timeout threshold is exceeded (e.g., 30 seconds), **Then** the node is marked as "unhealthy" or "offline"
4. **Given** multiple nodes are registered, **When** I query the node list, **Then** I see all nodes with their runtime type, status, and resource metrics

---

### User Story 3 - User Authentication and Authorization (Priority: P1)

As a user, I want to authenticate with the orchestrator and have role-based access to resources, so that only authorized users can deploy packs and manage nodes.

**Why this priority**: Security is foundational - without auth, anyone could deploy arbitrary code to nodes. Must be in place before any production use.

**Independent Test**: Can be tested by creating a user, logging in, and verifying that protected endpoints reject unauthenticated requests while accepting authenticated ones.

**Acceptance Scenarios**:

1. **Given** I am a new user, **When** I register with email and password, **Then** my account is created and I receive authentication credentials
2. **Given** I have valid credentials, **When** I authenticate, **Then** I receive a session token valid for API requests
3. **Given** I am authenticated as a "deployer" role, **When** I attempt to deploy a pack, **Then** the action succeeds
4. **Given** I am authenticated as a "viewer" role, **When** I attempt to deploy a pack, **Then** the action is denied with a 403 Forbidden error
5. **Given** I am unauthenticated, **When** I attempt any protected operation, **Then** I receive a 401 Unauthorized error

---

### User Story 4 - Pack Versioning and Rollback (Priority: P2)

As a developer, I want to manage multiple versions of a pack and rollback to a previous version, so that I can recover from bad pods.

**Why this priority**: Version management is critical for production reliability but can be built after core pod works.

**Independent Test**: Can be tested by deploying v1.0.0 of a pack, deploying v2.0.0, then rolling back to v1.0.0 and verifying the correct version is running.

**Acceptance Scenarios**:

1. **Given** a pack "my-app" v1.0.0 exists, **When** I register v2.0.0, **Then** both versions are stored and accessible
2. **Given** v2.0.0 is deployed to a node, **When** I trigger rollback to v1.0.0, **Then** v2.0.0 is stopped and v1.0.0 is deployed
3. **Given** I query a pack's history, **When** multiple versions exist, **Then** I see all versions with timestamps and pod history

---

### User Story 5 - Runtime-Targeted Pack pod (Priority: P2)

As a developer, I want to specify which runtime(s) my pack supports (Node.js, browser, or both), so that the orchestrator only deploys to compatible nodes.

**Why this priority**: Runtime targeting is essential for production use but requires core pod to work first.

**Independent Test**: Can be tested by deploying packs with different runtime tags and verifying the orchestrator respects compatibility constraints.

**Acceptance Scenarios**:

1. **Given** a pack tagged as `runtime: node`, **When** I attempt to deploy, **Then** only Node.js nodes are available as targets
2. **Given** a pack tagged as `runtime: browser`, **When** I attempt to deploy, **Then** only browser nodes are available as targets
3. **Given** a pack tagged as `runtime: isomorphic`, **When** I attempt to deploy, **Then** both Node.js and browser nodes are available as targets
4. **Given** a pack tagged as `runtime: isomorphic`, **When** deployed to a Node.js node and a browser node, **Then** both execute the same logic successfully
5. **Given** a pack with no runtime tag, **When** I submit it to the registry, **Then** registration fails with a validation error requiring runtime specification

---

### User Story 6 - Scaling and Replication (Priority: P3)

As an operator, I want to scale a pack across multiple nodes and configure replication, so that I can achieve high availability and load distribution.

**Why this priority**: Scaling is an advanced feature for production workloads; core functionality must work first.

**Independent Test**: Can be tested by deploying a pack with replicas=3, verifying three instances run across available nodes.

**Acceptance Scenarios**:

1. **Given** a pack pod request with replicas=3, **When** 3+ nodes are available, **Then** the pack is deployed to 3 different nodes
2. **Given** a pack running on 3 nodes, **When** one node goes offline, **Then** the orchestrator schedules a replacement on an available node
3. **Given** a scaling policy (e.g., min=2, max=5), **When** load increases, **Then** additional replicas are scheduled up to max

---

### User Story 7 - Dashboard and Monitoring UI (Priority: P3)

As an operator, I want a web dashboard to view nodes, packs, and pods, so that I can monitor the system visually.

**Why this priority**: CLI/API functionality must work first; UI is a convenience layer.

**Independent Test**: Can be tested by opening the dashboard, viewing the node list, and verifying it matches the API response.

**Acceptance Scenarios**:

1. **Given** I am authenticated, **When** I open the dashboard, **Then** I see an overview of nodes, packs, and active pods
2. **Given** pods are running, **When** I view the pods page, **Then** I see real-time status updates
3. **Given** a node goes offline, **When** I am viewing the dashboard, **Then** I see the status change reflected within 5 seconds

---

### Edge Cases

- What happens when a pack pod fails mid-transfer? (System should mark pod as "failed" and retain previous version)
- How does the system handle a node that reconnects after being marked offline? (Re-register with current state; do not auto-resume failed pods)
- What happens when the central database is temporarily unavailable? (Nodes continue running; queue operations for retry; read from cache if available)
- How does the system handle conflicting pack versions deployed simultaneously? (Last-write-wins with conflict detection warning; optional locking)
- What happens when a browser tab/node is closed? (Graceful unregister on close; timeout for ungraceful close)
- How does authentication work for isomorphic packs running in browser? (Pack inherits deployer's scoped permissions; sandboxed execution)

## Requirements *(mandatory)*

### Functional Requirements

**Core Orchestration**
- **FR-001**: System MUST allow registration of packs with metadata (name, version, runtime tag, entry point)
- **FR-002**: System MUST store packs in a central database (Supabase)
- **FR-003**: System MUST deploy packs to registered nodes based on runtime tag compatibility
- **FR-004**: System MUST support three runtime tags: `node` (Node.js only), `browser` (browser only), `isomorphic` (both)
- **FR-005**: System MUST reject pod requests where pack runtime tag is incompatible with target node
- **FR-006**: System MUST track pod status (pending, transferring, running, stopped, error)

**Node Management**
- **FR-007**: System MUST allow nodes to self-register with capabilities (runtime type, available resources)
- **FR-008**: System MUST receive and process heartbeats from nodes to determine health
- **FR-009**: System MUST mark nodes as unhealthy after heartbeat timeout [NEEDS CLARIFICATION: timeout duration - suggest 30s]
- **FR-010**: System MUST provide a node listing API with filtering by runtime type and status

**User & Auth**
- **FR-011**: System MUST support user registration and authentication
- **FR-012**: System MUST implement role-based access control (admin, deployer, viewer)
- **FR-013**: System MUST validate authentication tokens on all protected endpoints
- **FR-014**: System MUST integrate with Supabase Auth for identity management

**Versioning**
- **FR-015**: System MUST support multiple versions of the same pack
- **FR-016**: System MUST allow rollback to any previously deployed version
- **FR-017**: System MUST maintain pod history per pack/node combination

**Runtime Execution**
- **FR-018**: System MUST execute packs tagged `node` only on Node.js nodes
- **FR-019**: System MUST execute packs tagged `browser` only on browser nodes
- **FR-020**: System MUST execute packs tagged `isomorphic` on either Node.js or browser nodes
- **FR-021**: System MUST provide a runtime abstraction layer for isomorphic packs to access environment-specific APIs
- **FR-022**: System MUST validate pack runtime tag against target node before pod

**Communication**
- **FR-023**: System MUST use WebSocket for real-time node-orchestrator communication
- **FR-024**: System MUST support REST API for management operations
- **FR-025**: System MUST handle reconnection and message queuing for intermittent connectivity

### Key Entities

- **User**: Authenticated identity with roles; owns packs and pods; attributes: id, email, roles[], createdAt
- **Pack**: Deployable JavaScript package; attributes: id, name, version, ownerId, runtimeTag (node|browser|isomorphic), entryPoint, bundle, manifest, createdAt
- **Node**: Execution environment (server or browser); attributes: id, name, runtimeType (node|browser), status, lastHeartbeat, capabilities{}, registeredBy
- **pod**: Instance of a pack running on a node; attributes: id, packId, packVersion, nodeId, status, startedAt, stoppedAt, logs[]
- **podHistory**: Audit log of pod actions; attributes: id, podId, action, timestamp, actorId

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pack can be registered, deployed to a node, and confirmed running within 60 seconds
- **SC-002**: System maintains 99.9% uptime for the central orchestrator API
- **SC-003**: Node health status updates reflect actual state within 5 seconds of change
- **SC-004**: Rollback to a previous pack version completes within 30 seconds
- **SC-005**: System supports at least 100 concurrent nodes without performance degradation
- **SC-006**: Dashboard reflects real-time state with < 2 second latency
- **SC-007**: Packs tagged `isomorphic` run identically on Node.js and browser nodes (verified by test suite)
- **SC-010**: 100% of pod deployment attempts to incompatible nodes are rejected before transfer begins
- **SC-008**: API response times remain < 200ms at p95 under normal load
- **SC-009**: 90% of users successfully complete their first pod deployment without support intervention

## Technical Considerations

### Isomorphic Architecture

The core orchestrator logic must be runtime-agnostic:

- **Shared Core**: Business logic (pack validation, pod scheduling, state management) in isomorphic TypeScript
- **Runtime Adapters**: Platform-specific implementations for networking, storage, and execution
- **Node Adapter**: Uses Node.js APIs (http, fs, worker_threads)
- **Browser Adapter**: Uses Web APIs (fetch, IndexedDB, Web Workers)

### Database (Supabase)

- PostgreSQL for relational data (users, packs metadata, nodes, pods)
- Supabase Storage for pack bundles
- Supabase Realtime for live status updates
- Supabase Auth for user identity

### Communication Protocol

- WebSocket for persistent node connections (heartbeats, commands, logs)
- REST API for CRUD operations on packs, nodes, pods
- Message format: JSON with typed schemas

## Open Questions

1. What is the maximum pack bundle size? (Suggest: 50MB for initial version)
2. Should browser nodes persist across page refreshes? (Suggest: Optional reconnect with same node ID)
3. What isolation model for pack execution? (Suggest: Web Workers in browser, worker_threads or child_process in Node)
4. How to handle pack dependencies? (Suggest: Packs must be self-contained bundles; no runtime dependency resolution)
5. What logging/monitoring integration? (Suggest: Structured logs to central service; OpenTelemetry compatible)
