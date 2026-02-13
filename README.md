# StarkOS

A JavaScript operating system that deploys and manages software packages ("packs") across Node.js and browser runtimes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

## Features

- 🚀 **Isomorphic Execution**: Same pack runs identically on Node.js servers and browser tabs — UI is just another workload
- 📦 **Pack Management**: Immutable, versioned, bundled JavaScript artifacts with private/public visibility and system/user namespaces
- 🖥️ **Multi-Runtime**: Deploy to Node.js (`worker_threads`) or browser (Web Workers) with a runtime-agnostic core
- 🔄 **Reactive State**: Vue 3 `@vue/reactivity` primitives throughout — desired-state reconciliation converges declared state with actual state automatically
- 🎯 **Kubernetes-Like Scheduling**: Filter → Score → Select pipeline with node selectors, taints/tolerations, resource fitting, priority & preemption
- 🔐 **Security & RBAC**: Supabase Auth with 4-role model (admin/user/node/viewer), ownership boundaries, trust zones, and transport security
- 📡 **Real-Time Event System**: Structured events across 7 categories with persistent storage, WebSocket streaming, correlation IDs, and audit trails
- 🛡️ **Services & Auto-Healing**: Declarative service controller with replica-based and DaemonSet modes, crash-loop detection, auto-rollback, and follow-latest upgrades
- 🌐 **Networking & Service Mesh**: Inter-service communication via internal URLs, WebRTC data plane, network policies (deny-by-default), and HTTP interceptors
- 💥 **Built-in Chaos Testing**: 10 pre-built fault-injection scenarios including node loss, network partitions, latency injection, and API flakiness
- 📊 **Observability**: Structured JSON logging, health endpoints, resource monitoring, and JSON output for scripting
- 🖥️ **Comprehensive CLI**: Unified `stark <resource> <action>` syntax covering all orchestrator features with multiple output formats

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for Supabase local development)

### Installation

```bash
# Clone the repository
git clone https://github.com/wewatchwall/stark-orchestrator.git
cd stark-orchestrator

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Start Local Development

```bash
# Start Supabase (database, auth, storage)
pnpm db:start

# Apply database migrations
pnpm db:migrate

# Start the development server
pnpm dev:server
```

The server will start at `https://localhost:443`.

### Production Service

```bash
# Build all packages
pnpm build

# Set required environment variables
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
export NODE_ENV=production

# Start the production server
pnpm --filter @stark-o/server run start
```

Or from the server package directory:

```bash
cd packages/server
node dist/index.js
```

### Verify Installation

```bash
# Health check (use -k for self-signed certificates in development)
curl -k https://localhost/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-10T12:00:00.000Z",
  "version": "0.0.1"
}
```

## Documentation

For comprehensive documentation, visit the **[Stark Orchestrator Wiki](https://github.com/wewatchwall/stark-orchestrator/wiki)**:

- [Installation](https://github.com/wewatchwall/stark-orchestrator/wiki/Installation) — Full setup guide
- [Quick Start](https://github.com/wewatchwall/stark-orchestrator/wiki/Quick-Start) — Deploy your first pack in minutes
- [Mental Model](https://github.com/wewatchwall/stark-orchestrator/wiki/Mental-Model) — Understand how Stark thinks
- [Architecture](https://github.com/wewatchwall/stark-orchestrator/wiki/Architecture) — System design and package structure
- [CLI Reference](https://github.com/wewatchwall/stark-orchestrator/wiki/CLI-Reference) — Complete command documentation
- [API Reference](https://github.com/wewatchwall/stark-orchestrator/wiki/API-Reference) — REST and WebSocket APIs
- [Networking & Services](https://github.com/wewatchwall/stark-orchestrator/wiki/Networking-and-Services) — Service mesh, network policies, and ingress
- [Scheduling & Policies](https://github.com/wewatchwall/stark-orchestrator/wiki/Scheduling-Policies) — Scheduling pipeline, taints, tolerations, and preemption
- [Security & Capabilities](https://github.com/wewatchwall/stark-orchestrator/wiki/Security-and-Capabilities) — RBAC, trust boundaries, and transport security
- [Chaos Testing](https://github.com/wewatchwall/stark-orchestrator/wiki/Chaos-Testing) — Built-in fault injection framework
- [Metrics & Observability](https://github.com/wewatchwall/stark-orchestrator/wiki/Metrics-and-Observability) — Logging, monitoring, and health checks
- [Contributing Guide](https://github.com/wewatchwall/stark-orchestrator/wiki/Contributing-Guide) — How to contribute

## Project Structure

```
stark-orchestrator/
├── packages/
│   ├── core/            # Isomorphic reactive core
│   ├── shared/          # Shared types, validation, utilities
│   ├── server/          # REST API & WebSocket server
│   ├── cli/             # Command-line interface
│   ├── node-runtime/    # Node.js runtime adapter
│   ├── browser-runtime/ # Browser runtime adapter
│   └── client/          # Nuxt 3 dashboard
├── supabase/
│   └── migrations/      # Database schema migrations
└── tests/
    └── integration/     # Integration tests
```

## Technology Stack

- **Language**: TypeScript 5.x (strict mode)
- **Reactivity**: Vue 3 (`@vue/reactivity`)
- **Database**: Supabase (PostgreSQL)
- **Testing**: Vitest
- **Build**: Vite

## Vision

Platform-defining ideas that become possible because Stark is a programmable visual orchestrator:

**1. Infrastructure Branching / Parallel Universes** — Fork, diff, and merge live cluster state like Git for running systems.

**2. Infrastructure Replay Debugger** — Step through cluster history frame-by-frame, inspecting scheduler decisions and failure paths.

**3. Live Infrastructure Composer** — A visual IDE where infrastructure is composed like music, with real-time feedback and forkable workspaces.

**4. Executable Architecture Documentation** — Cluster state becomes interactive, living documentation with click-to-run examples and architecture diffs.

**5. Trust Graph Explorer** — Visualizes the entire authority chain, secret lineage, and lateral movement potential as a living zero-trust map.

**6. Chaos Theater & Experiment Arena** — A cinematic chaos engine with gamified security hardening, slow-motion failure replay, and emergent behavior experiments.

**7. Distributed Workflow Engine** — Orchestrate complex DAG-based workflows visually with event-triggered execution and cross-cluster choreography.

**8. Infrastructure Sandbox Multiplayer Mode** — Multiple users manipulate a shared cluster in real-time with RBAC, cursor trails, and branchable state.

**9. Visual Infrastructure Fabric** — Define, observe, and reshape cluster topology as a living visual surface with capacity drag, pressure fields, and streaming analytics.

**10. Distributed AI Runtime Surface** — AI-native orchestration with visual model routing, GPU/CPU allocation, and resource-to-accuracy tradeoffs.

**11. Stateful Storytelling Engine** — Turn cluster evolution or interactive narratives into a timeline with chapters, story arcs, and presentation mode.

**12. Economic Simulation Engine** — Model infrastructure or financial systems as a market with demand-priced services and visualized cost-pressure waves.

**13. Capability Marketplace** — Pods advertise capabilities and users compose workflows dynamically, replacing monolithic SaaS with composable services.

**14. AI-Powered Personal Assistant Pod** — A runtime-native assistant that reads your visual workspace and orchestrates multi-step tasks across pods.

**15. Education & Citizen Science Sandbox** — Students and citizen scientists deploy pods visually in safe environments for STEM simulations and collective research.

**16. Real-Time Game Engine Pods** — Game logic runs inside Stark pods with network, physics, and AI pods connected visually for multiplayer simulation.

**17. Personal IoT Hub** — Pods represent smart devices, with automations created by visually wiring devices to logic pods under full user control.

**18. Creative Media Studio** — Audio, video, animation, and music pods linked visually for real-time composition and distributed jam sessions.

**19. Civic Infrastructure Simulator** — Visualize and simulate traffic, utilities, or energy grids with per-subsystem pods and collaborative policy testing.

**20. Health & Bioinformatics Sandbox** — Visualize genomic data and analytics pods with real-time collaboration and AI-assisted insights.

**21. Personal Finance & Tax Automation Pods** — Data pods pull from accounts while logic pods calculate taxes and risk with full visual traceability.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
