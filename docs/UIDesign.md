# Stark OS – UI Core Pack (Expanded Specification)

The UI Core Pack is **not** a dashboard.

It is the visual execution substrate that allows infrastructure primitives
(nodes, pods, services, volumes, events) to become interactive, spatial,
and stateful UI objects.

It must not duplicate orchestrator logic.
It must expose orchestrator state as a reactive visual system.

---

## 1. Visual State Projection Engine

Purpose:
Convert cluster state into a normalized, reactive UI graph.

Responsibilities:
- Subscribe to event stream (nodes, pods, services, volumes)
- Maintain client-side graph model
- Diff + reconcile visual state without re-rendering entire scene
- Support time-travel (historical projection using event log)

This is not metrics — this is structural state projection.

---

## 2. Spatial Topology Engine

Purpose:
Define how infrastructure entities exist in space.

Responsibilities:
- Node positioning algorithms (force layout / geographic / manual)
- Pod-to-node attachment visualization
- Service edge rendering (directed graph lines)
- Volume attachment overlays
- Policy boundaries (namespaces, public/private zones)

This is a layout engine, not a monitoring panel.

---

## 3. Pod Rendering Runtime

Purpose:
Allow pods to optionally render UI surfaces.

Responsibilities:
- Define visual pod capability contract
- Secure iframe / WebWorker isolation
- Permission-gated UI APIs
- Lifecycle binding (pod start → UI mount, pod stop → UI unmount)
- Crash-safe visual teardown

This enables “visual pods” without coupling to orchestrator internals.

---

## 4. Interaction Model

Purpose:
Make infrastructure manipulable without breaking invariants.

Responsibilities:
- Select / inspect nodes and pods
- Drag-to-redeploy (if allowed by policy)
- Scale via interaction gestures
- Visual namespace filtering
- Context-aware action menus (RBAC aware)

Important:
All interactions must translate into existing CLI/API calls.
UI is a client of the orchestrator — not a bypass.

---

## 5. Multi-Desktop / Workspace Layer

Purpose:
Allow multiple concurrent visual environments.

Responsibilities:
- Independent visual contexts
- Workspace-specific filters
- Persisted layout state per workspace
- Desktop vs mobile responsive mode
- Shareable workspace state (optional later)

This is where Stark becomes experiential, not just functional.

---

## 6. Visual Policy Surface

Purpose:
Make invisible boundaries visible.

Responsibilities:
- Public vs private service highlighting
- Network policy edge coloring
- Secret injection visibility (metadata only)
- Authority flow visualization (node → pod trust chain)
- Ingress exposure indicators

This turns your data plane into something understandable at a glance.

---

## 7. Event Animation Layer

Purpose:
Render infrastructure as a living system.

Responsibilities:
- Pod creation/destruction animations
- Rescheduling movement
- Network request pulses
- Failure shockwave visualization
- Volume attach/detach motion cues

This layer should be subtle, not noisy.
It communicates system health intuitively.

---

## 8. Extensibility Contract

Purpose:
Allow future packs to extend the UI safely.

Responsibilities:
- Plugin registration system
- UI capability permissions
- Namespaced visual components
- Sandboxed rendering zones
- Versioned UI API contract

This ensures Stark UI evolves without tight coupling.

---

## 9. Performance & Safety Constraints

The UI Core must:
- Handle 1k+ pods without freezing
- Degrade gracefully under load
- Never block orchestrator threads
- Fail closed (UI crash ≠ cluster crash)

The UI is a projection layer — not the control plane itself.

---

