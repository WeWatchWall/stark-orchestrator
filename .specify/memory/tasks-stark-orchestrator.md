# Tasks: Stark Orchestrator

**Input**: Design documents from `.specify/memory/`
**Prerequisites**: plan-stark-orchestrator.md ✅, spec-stark-orchestrator.md ✅

**Tests**: Tests are included as this is a TDD project per the constitution (80% coverage target).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo initialization and tooling configuration

- [X] T001 Create monorepo root with pnpm workspaces configuration at `pnpm-workspace.yaml`
- [X] T002 [P] Create `packages/shared/package.json` with TypeScript dependencies
- [X] T003 [P] Create `packages/core/package.json` with @vue/reactivity dependency
- [X] T004 [P] Create `packages/node-runtime/package.json`
- [X] T005 [P] Create `packages/browser-runtime/package.json`
- [X] T006 [P] Create `packages/server/package.json` with express/fastify and ws dependencies
- [X] T007 [P] Create `packages/cli/package.json`
- [X] T008 Create root `tsconfig.json` with strict mode, path mappings for packages
- [X] T009 [P] Create `packages/shared/tsconfig.json` extending root
- [X] T010 [P] Create `packages/core/tsconfig.json` extending root
- [X] T011 [P] Create `packages/node-runtime/tsconfig.json` extending root
- [X] T012 [P] Create `packages/browser-runtime/tsconfig.json` extending root
- [X] T013 [P] Create `packages/server/tsconfig.json` extending root
- [X] T014 [P] Create `packages/cli/tsconfig.json` extending root
- [X] T015 Configure ESLint in root `.eslintrc.cjs` with TypeScript rules
- [X] T016 Configure Prettier in root `.prettierrc`
- [X] T017 Configure Vitest in root `vitest.config.ts`
- [X] T018 Create root `package.json` with scripts for build, test, lint

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### 2.1 Database Schema (Supabase Migrations)

- [x] T019 Create `supabase/migrations/001_users.sql` - users table with Supabase Auth integration
- [x] T020 [P] Create `supabase/migrations/002_packs.sql` - packs table (id, name, version, runtime_tag, owner_id, bundle_path, created_at)
- [x] T021 [P] Create `supabase/migrations/003_nodes.sql` - nodes table (id, name, runtime_type, status, last_heartbeat, capabilities, registered_by)
- [x] T022 [P] Create `supabase/migrations/004_pods.sql` - pods table (id, pack_id, pack_version, node_id, status, started_at, stopped_at)
- [x] T023 [P] Create `supabase/migrations/005_pod_history.sql` - pod_history audit log table
- [x] T024 Create `supabase/seed.sql` with test data for development
- [x] T024a [P] Create `supabase/migrations/006_cluster_config.sql` - cluster configuration table (Kubernetes-like)
- [x] T024b [P] Create `supabase/migrations/007_namespaces.sql` - namespaces table for resource isolation (Kubernetes-like)
- [x] T024c [P] Create `supabase/migrations/008_priority_classes.sql` - priority classes for scheduling (Kubernetes-like)
- [x] T024d [P] Create `supabase/migrations/009_kubernetes_like_fields.sql` - add labels, taints, tolerations, scheduling fields to nodes/pods

### 2.2 Shared Package (Types, Validation, Errors, Logging)

- [x] T025 [P] Create `packages/shared/src/types/user.ts` - User type definitions
- [x] T026 [P] Create `packages/shared/src/types/pack.ts` - Pack type definitions with RuntimeTag enum
- [x] T027 [P] Create `packages/shared/src/types/node.ts` - Node type definitions with RuntimeType enum
- [x] T028 [P] Create `packages/shared/src/types/pod.ts` - Pod and PodHistory type definitions
- [x] T028a [P] Create `packages/shared/src/types/labels.ts` - Labels, Annotations, and LabelSelector types (Kubernetes-like)
- [x] T028b [P] Create `packages/shared/src/types/taints.ts` - Taints and Tolerations types (Kubernetes-like)
- [x] T028c [P] Create `packages/shared/src/types/scheduling.ts` - Node affinity, pod affinity, scheduling config (Kubernetes-like)
- [x] T028d [P] Create `packages/shared/src/types/namespace.ts` - Namespace, ResourceQuota, LimitRange types (Kubernetes-like)
- [x] T028e [P] Create `packages/shared/src/types/cluster.ts` - ClusterConfig, ResourceLimits, SchedulingPolicy types (Kubernetes-like)
- [x] T029 [P] Create `packages/shared/src/types/index.ts` - Re-export all types
- [x] T030 [P] Create `packages/shared/src/errors/base-error.ts` - Base error class with error codes
- [x] T031 [P] Create `packages/shared/src/errors/validation-error.ts` - Validation error class
- [x] T032 [P] Create `packages/shared/src/errors/auth-error.ts` - Authentication/Authorization error class
- [x] T033 [P] Create `packages/shared/src/errors/pod-error.ts` - Pod-specific error class
- [x] T034 [P] Create `packages/shared/src/errors/index.ts` - Re-export all errors
- [x] T035 [P] Create `packages/shared/src/validation/pack-validation.ts` - Pack registration validation (name, version, runtime tag required)
- [x] T036 [P] Create `packages/shared/src/validation/node-validation.ts` - Node registration validation
- [x] T037 [P] Create `packages/shared/src/validation/pod-validation.ts` - Pod request validation including runtime compatibility
- [x] T037a [P] Create `packages/shared/src/validation/namespace-validation.ts` - Namespace creation/update validation (Kubernetes-like)
- [x] T037b [P] Create `packages/shared/src/validation/cluster-validation.ts` - Cluster configuration validation (Kubernetes-like)
- [x] T037c [P] Create `packages/shared/src/validation/scheduling-validation.ts` - Scheduling config, affinity, toleration validation (Kubernetes-like)
- [x] T038 [P] Create `packages/shared/src/validation/index.ts` - Re-export all validators
- [x] T039 [P] Create `packages/shared/src/logging/logger.ts` - Structured JSON logger with correlation IDs
- [x] T040 [P] Create `packages/shared/src/utils/index.ts` - Pure utility functions (uuid generation, date formatting)
- [x] T041 Create `packages/shared/src/index.ts` - Public API exports
- [x] T042 Create `packages/shared/tests/unit/validation.test.ts` - Unit tests for validators

### 2.3 Core Package Skeleton (Vue Reactivity Stores)

- [x] T043 [P] Create `packages/core/src/types/index.ts` - Re-export from shared
- [x] T044 [P] Create `packages/core/src/stores/cluster-store.ts` - Reactive cluster state with nodes Map
- [x] T045 [P] Create `packages/core/src/stores/node-store.ts` - Reactive node registry state
- [x] T046 [P] Create `packages/core/src/stores/pod-store.ts` - Reactive pods state
- [x] T047 [P] Create `packages/core/src/stores/pack-store.ts` - Reactive pack registry state
- [x] T048 Create `packages/core/src/stores/index.ts` - Re-export all stores
- [x] T049 Create `packages/core/src/index.ts` - Public API exports
- [x] T050 Create `packages/core/tests/unit/stores.test.ts` - Unit tests for reactive stores

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Register and Deploy a Pack (Priority: P1) 🎯 MVP

**Goal**: Enable developers to register packs and deploy them to target nodes

**Independent Test**: Upload a simple pack, select a target node, verify the pack executes correctly on that node

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T051 [P] [US1] Contract test for POST /api/packs in `tests/contract/packs.spec.ts`
- [X] T052 [P] [US1] Contract test for POST /api/pods in `tests/contract/pods.spec.ts`
- [X] T053 [P] [US1] Integration test for pack registration flow in `tests/integration/pack-registration.spec.ts`
- [X] T054 [P] [US1] Integration test for pod flow in `tests/integration/pod-flow.spec.ts`

### Implementation for User Story 1

- [x] T055 [P] [US1] Create `packages/core/src/models/pack.ts` - Pack reactive model with validation
- [x] T056 [P] [US1] Create `packages/core/src/models/pod.ts` - Pod reactive model
- [x] T057 [US1] Implement `packages/core/src/services/pack-registry.ts` - Pack registration, versioning, listing (depends on T055)
- [x] T058 [US1] Implement `packages/core/src/services/pod-scheduler.ts` - Pod orchestration, runtime compatibility check (depends on T055, T056)
- [x] T059 [US1] Implement `packages/server/src/supabase/client.ts` - Supabase client configuration
- [x] T060 [US1] Implement `packages/server/src/supabase/packs.ts` - Pack CRUD queries
- [x] T061 [US1] Implement `packages/server/src/supabase/pods.ts` - Pod CRUD queries
- [x] T062 [US1] Implement `packages/server/src/api/packs.ts` - REST endpoints (GET, POST /api/packs)
- [x] T063 [US1] Implement `packages/server/src/api/pods.ts` - REST endpoints (GET, POST /api/pods, GET /api/pods/:id/status)
- [x] T064 [US1] Add pack bundle upload to Supabase Storage in `packages/server/src/supabase/storage.ts`
- [x] T065 [US1] Add logging for pack registration and pod operations
- [x] T066 [US1] Unit tests for pack-registry service in `packages/core/tests/unit/pack-registry.test.ts`
- [x] T067 [US1] Unit tests for pod-scheduler service in `packages/core/tests/unit/pod-scheduler.test.ts`

**Checkpoint**: Pack registration and pod deployment works end-to-end

---

## Phase 4: User Story 2 - Node Registration and Health Monitoring (Priority: P1) 🎯 MVP

**Goal**: Enable operators to register nodes and monitor their health status

**Independent Test**: Register a Node.js server node, observe it in the node list, verify health status updates

### Tests for User Story 2

- [x] T068 [P] [US2] Contract test for GET /api/nodes in `tests/contract/nodes.spec.ts`
- [x] T069 [P] [US2] Contract test for WebSocket node registration in `tests/contract/ws-nodes.spec.ts`
- [x] T070 [P] [US2] Integration test for node registration in `tests/integration/node-registration.spec.ts`
- [x] T071 [P] [US2] Integration test for heartbeat timeout in `tests/integration/node-heartbeat.spec.ts`

### Implementation for User Story 2

- [x] T072 [P] [US2] Create `packages/core/src/models/node.ts` - Node reactive model with status, capabilities
- [x] T073 [US2] Implement `packages/core/src/services/node-manager.ts` - Node registration, heartbeat processing, health status (depends on T072)
- [x] T074 [US2] Implement `packages/server/src/supabase/nodes.ts` - Node CRUD queries
- [x] T075 [US2] Implement `packages/server/src/ws/connection-manager.ts` - WebSocket connection handling
- [x] T076 [US2] Implement `packages/server/src/ws/handlers/node-handler.ts` - Node registration/heartbeat WebSocket handlers
- [x] T077 [US2] Implement `packages/server/src/api/nodes.ts` - REST endpoints (GET /api/nodes, GET /api/nodes/:id)
- [x] T078 [US2] Implement heartbeat timeout logic (30s) marking nodes unhealthy in node-manager.ts
- [x] T079 [US2] Implement `packages/node-runtime/src/agent/node-agent.ts` - Agent that registers with orchestrator
- [x] T080 [US2] Add logging for node lifecycle events
- [x] T081 [US2] Unit tests for node-manager service in `packages/core/tests/unit/node-manager.test.ts`

**Checkpoint**: Nodes can register, send heartbeats, and health status is tracked

---

## Phase 5: User Story 3 - User Authentication and Authorization (Priority: P1) 🎯 MVP

**Goal**: Secure the orchestrator with authentication and role-based access control

**Independent Test**: Create user, login, verify protected endpoints reject unauthenticated requests

### Tests for User Story 3

- [x] T082 [P] [US3] Unit test for POST /api/auth/register in `packages/server/tests/unit/api-auth.test.ts`
- [x] T083 [P] [US3] Contract test for POST /api/auth/login in `tests/contract/auth.spec.ts`
- [x] T084 [P] [US3] Integration test for RBAC enforcement in `tests/integration/auth-rbac.spec.ts`

### Implementation for User Story 3

- [x] T085 [P] [US3] Create `packages/core/src/models/user.ts` - User model with roles
- [x] T086 [US3] Implement `packages/core/src/services/auth.ts` - Auth service wrapping Supabase Auth (depends on T085)
- [x] T087 [US3] Implement `packages/server/src/supabase/auth.ts` - Supabase Auth integration
- [x] T088 [US3] Implement `packages/server/src/api/auth.ts` - REST endpoints (POST /auth/register, POST /auth/login, POST /auth/logout)
- [x] T089 [US3] Implement `packages/server/src/middleware/auth-middleware.ts` - JWT validation middleware
- [x] T090 [US3] Implement `packages/server/src/middleware/rbac-middleware.ts` - Role-based access control middleware
- [x] T091 [US3] Apply auth middleware to protected routes in packs.ts, nodes.ts, pods.ts
- [x] T092 [US3] Add 401/403 error responses to all protected endpoints
- [x] T093 [US3] Unit tests for auth service in `packages/core/tests/unit/auth.test.ts`

**Checkpoint**: All endpoints secured with authentication and RBAC

---

## Phase 6: Runtime Adapters (Required for Deployment Execution)

**Goal**: Enable pack execution on Node.js and browser runtimes

### Node.js Runtime Adapter

- [x] T094 [P] Implement `packages/node-runtime/src/adapters/fs-adapter.ts` - File system operations
- [x] T095 [P] Implement `packages/node-runtime/src/adapters/http-adapter.ts` - HTTP client
- [x] T096 [P] Implement `packages/node-runtime/src/adapters/worker-adapter.ts` - worker_threads wrapper
- [x] T097 Implement `packages/node-runtime/src/executor/pack-executor.ts` - Execute packs in worker_threads
- [x] T098 Implement `packages/node-runtime/src/index.ts` - Public API exports

### Browser Runtime Adapter

- [x] T099 [P] Implement `packages/browser-runtime/src/adapters/storage-adapter.ts` - IndexedDB wrapper
- [x] T100 [P] Implement `packages/browser-runtime/src/adapters/fetch-adapter.ts` - Fetch API wrapper
- [x] T101 [P] Implement `packages/browser-runtime/src/adapters/worker-adapter.ts` - Web Worker wrapper
- [x] T102 Implement `packages/browser-runtime/src/executor/pack-executor.ts` - Execute packs in Web Workers
- [x] T103 Implement `packages/browser-runtime/src/agent/browser-agent.ts` - Browser agent registration
- [x] T104 Implement `packages/browser-runtime/src/index.ts` - Public API exports

**Checkpoint**: Packs can execute on both Node.js and browser nodes

---

## Phase 7: User Story 4 - Pack Versioning and Rollback (Priority: P2)

**Goal**: Enable version management and rollback for packs

**Independent Test**: Deploy v1.0.0, deploy v2.0.0, rollback to v1.0.0, verify correct version runs

### Tests for User Story 4

- [x] T105 [P] [US4] Contract test for GET /api/packs/:name/versions in `packages/server/tests/unit/api-packs.test.ts`
- [x] T106 [P] [US4] Contract test for POST /api/pods/:id/rollback in `tests/contract/pods.spec.ts`
- [x] T107 [P] [US4] Integration test for rollback flow in `tests/integration/rollback.spec.ts`

### Implementation for User Story 4

- [x] T108 [US4] Add version listing to pack-registry.ts - getVersions(packName)
- [x] T109 [US4] Add rollback logic to pod-scheduler.ts - rollback(podId, targetVersion)
- [x] T110 [US4] Add GET /api/packs/:name/versions endpoint in packs.ts
- [x] T111 [US4] Add POST /api/pods/:id/rollback endpoint in pods.ts
- [x] T112 [US4] Add pod history tracking for all actions
- [x] T113 [US4] Unit tests for rollback in `packages/core/tests/unit/rollback.test.ts`

**Checkpoint**: Full version management and rollback functional

---

## Phase 8: User Story 5 - Runtime-Targeted Pack Deployment (Priority: P2)

**Goal**: Enforce runtime compatibility between packs and nodes

**Independent Test**: Deploy node-tagged pack to browser node, verify rejection

### Tests for User Story 5

- [x] T114 [P] [US5] Integration test for runtime tag validation in `tests/integration/runtime-targeting.spec.ts`

### Implementation for User Story 5

- [x] T115 [US5] Enhance pod-scheduler.ts with strict runtime tag validation
- [x] T116 [US5] Add runtime compatibility error responses with clear messages
- [x] T117 [US5] Add GET /api/nodes?runtime=node filter support
- [x] T118 [US5] Update pack validation to require runtime tag

**Checkpoint**: Runtime targeting fully enforced

---

## Phase 8a: User Story 6 - Kubernetes-Like Scheduling & Isolation (Priority: P2)

**Goal**: Advanced scheduling with namespaces, taints/tolerations, affinity, and priority classes

**Independent Test**: Create namespace with quota, create pod with tolerations to tainted node, verify priority preemption

### Foundation (Completed)

- [x] T118a [P] [US6] Create namespace types in `packages/shared/src/types/namespace.ts`
- [x] T118b [P] [US6] Create labels/selectors types in `packages/shared/src/types/labels.ts`
- [x] T118c [P] [US6] Create taints/tolerations types in `packages/shared/src/types/taints.ts`
- [x] T118d [P] [US6] Create scheduling/affinity types in `packages/shared/src/types/scheduling.ts`
- [x] T118e [P] [US6] Create cluster config types in `packages/shared/src/types/cluster.ts`
- [x] T118f [P] [US6] Create namespace validation in `packages/shared/src/validation/namespace-validation.ts`
- [x] T118g [P] [US6] Create cluster validation in `packages/shared/src/validation/cluster-validation.ts`
- [x] T118h [P] [US6] Create scheduling validation in `packages/shared/src/validation/scheduling-validation.ts`
- [x] T118i [P] [US6] Create `supabase/migrations/007_namespaces.sql`
- [x] T118j [P] [US6] Create `supabase/migrations/008_priority_classes.sql`
- [x] T118k [P] [US6] Create `supabase/migrations/009_kubernetes_like_fields.sql`

### Tests for User Story 6

- [x] T118l [P] [US6] Contract test for namespace CRUD in `tests/contract/namespaces.spec.ts`
- [x] T118m [P] [US6] Integration test for label selector matching in `tests/integration/label-selectors.spec.ts`
- [x] T118n [P] [US6] Integration test for taint/toleration scheduling in `tests/integration/taints-tolerations.spec.ts`
- [x] T118o [P] [US6] Integration test for node affinity in `tests/integration/node-affinity.spec.ts`
- [x] T118p [P] [US6] Integration test for priority preemption in `tests/integration/priority-preemption.spec.ts`

### Implementation for User Story 6

- [x] T118q [US6] Create `packages/core/src/models/namespace.ts` - Namespace reactive model
- [x] T118r [US6] Create `packages/core/src/services/namespace-manager.ts` - Namespace CRUD, quota enforcement
- [x] T118s [US6] Implement `packages/server/src/supabase/namespaces.ts` - Namespace database queries
- [x] T118t [US6] Implement `packages/server/src/api/namespaces.ts` - REST endpoints (GET, POST, DELETE /api/namespaces)
- [x] T118u [US6] Enhance pod-scheduler with taint/toleration filtering
- [x] T118v [US6] Enhance pod-scheduler with node affinity scoring
- [x] T118w [US6] Enhance pod-scheduler with priority-based scheduling
- [x] T118x [US6] Add namespace quota validation on pod creation
- [x] T118y [US6] Unit tests for namespace-manager in `packages/core/tests/unit/namespace-manager.test.ts`

**Checkpoint**: Full Kubernetes-like scheduling and isolation functional

---

## Phase 9: CLI (Priority: P2)

**Goal**: Command-line interface for all orchestrator operations

- [x] T119 [P] Create `packages/cli/src/index.ts` - CLI entry point with commander library
- [x] T120 [P] Implement `packages/cli/src/commands/auth.ts` - login, logout, whoami commands
- [x] T121 [P] Implement `packages/cli/src/commands/pack.ts` - bundle, upload and register, list, versions commands
- [x] T122 [P] Implement `packages/cli/src/commands/node.ts` - list, status commands
- [x] T123 [P] Implement `packages/cli/src/commands/deploy.ts` - deploy, rollback, status commands
- [x] T123a [P] Add CLI commands for namespace management in `packages/cli/src/commands/namespace.ts`
- [x] T124 Add structured output support (JSON and human-readable)
- [x] T125 CLI integration tests in `packages/cli/tests/integration/cli.spec.ts`

**Checkpoint**: Full CLI for all orchestrator operations

---

## Phase 10: Server Entry Point and API Router

**Goal**: Wire up all API routes and start server

- [x] T126 Create `packages/server/src/api/router.ts` - Central API router combining all routes
- [x] T127 Create `packages/server/src/index.ts` - Server entry point (HTTP + WebSocket)
- [x] T128 Add health check endpoint GET /health
- [x] T129 Add CORS configuration for browser clients
- [x] T130 Add request logging middleware with correlation IDs

**Checkpoint**: Server fully operational

---

## Phase 11: Polish & Cross-Cutting Concerns (Priority: P3)

**Purpose**: Improvements that affect multiple user stories

- [x] T131 [P] Create README.md with quickstart guide
- [x] T132 [P] Create docs/architecture.md
- [x] T133 Add rate limiting middleware using express-rate-limit library
- [x] T133a Finish implementing TODOs in code

---

## Phase 11: E2E Tests

**Goal**: End-to-end validation of complete workflows

- [ ] T134 E2E test: Full pod flow in `tests/e2e/pod-flow.spec.ts`
- [ ] T135 E2E test: Node registration and heartbeat in `tests/e2e/node-registration.spec.ts`
- [ ] T136 E2E test: Rollback workflow in `tests/e2e/rollback-flow.spec.ts`

---

## Phase 13: Optional Concerns (Priority: P3)

**Purpose**: Improvements that affect multiple user stories

- [ ] T137 Performance testing for 100 concurrent nodes
- [ ] T138 Security audit - input validation review
- [ ] T139 Code cleanup and consistent error handling

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories
- **User Stories 1, 2, 3 (Phases 3-5)**: All depend on Phase 2 - can run in parallel
- **Runtime Adapters (Phase 6)**: Can run in parallel with Phases 3-5
- **User Stories 4, 5 (Phases 7-8)**: Depend on Phases 3-5
- **User Story 6 (Phase 8a)**: Depends on Phase 2 (types/validation complete), integrates with Phases 3-5
- **CLI (Phase 9)**: Depends on Phases 3-5, 8a
- **Server Entry (Phase 10)**: Depends on Phases 3-6, 8a
- **E2E (Phase 11)**: Depends on all previous phases
- **Polish (Phase 12)**: Depends on Phase 11

### User Story Dependencies

| Story | Depends On | Can Parallelize With |
|-------|------------|----------------------|
| US1 (Pack Deploy) | Phase 2 | US2, US3, US6 |
| US2 (Node Health) | Phase 2 | US1, US3, US6 |
| US3 (Auth) | Phase 2 | US1, US2, US6 |
| US4 (Versioning) | US1 | US5, US6 |
| US5 (Runtime Targeting) | US1, US2 | US4, US6 |
| US6 (K8s-Like Scheduling) | Phase 2 (foundation complete) | US1, US2, US3, US4, US5 |

### Within Each Phase

- Tests marked [P] can run in parallel
- Tests MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational package.json tasks can run in parallel
- All migration files can be created in parallel
- All shared/types/* can be created in parallel
- US1, US2, US3 can proceed in parallel after Phase 2

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Total estimated tasks: 149 (including Kubernetes-like features)
- MVP scope: Phases 1-6 (Tasks T001-T104)

## Kubernetes-Like Features Implemented

The following Kubernetes-inspired features have been added to provide advanced orchestration capabilities:

| Feature | Description | Files |
|---------|-------------|-------|
| **Labels & Annotations** | Key-value metadata for organization and selection | `types/labels.ts`, migrations |
| **Namespaces** | Resource isolation with quotas and limit ranges | `types/namespace.ts`, `007_namespaces.sql` |
| **Taints & Tolerations** | Node repelling and pod allowlisting | `types/taints.ts`, `009_kubernetes_like_fields.sql` |
| **Node Affinity** | Scheduling constraints based on node labels | `types/scheduling.ts` |
| **Pod Affinity** | Co-location and anti-affinity rules | `types/scheduling.ts` |
| **Priority Classes** | Preemption-based scheduling priorities | `008_priority_classes.sql` |
| **Cluster Config** | Cluster-wide scheduling policies and defaults | `types/cluster.ts`, `006_cluster_config.sql` |
| **Resource Limits** | CPU, memory, storage constraints | `types/cluster.ts`, `types/namespace.ts` |
