# Stark Orchestrator

An isomorphic JavaScript orchestration platform for deploying and managing software packages ("packs") across Node.js and browser runtimes.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

## Features

- 🚀 **Isomorphic Core**: Shared logic works identically in Node.js and browsers
- 📦 **Pack Management**: Register, version, and deploy software packages
- 🖥️ **Multi-Runtime**: Deploy to Node.js servers or browser clients
- 🔄 **Reactive State**: Vue reactivity for automatic state propagation
- 🎯 **Kubernetes-Like Scheduling**: Namespaces, taints/tolerations, affinity rules
- 🔐 **Authentication & RBAC**: Secure access with role-based permissions
- 📡 **Real-Time Updates**: WebSocket connections for live status updates
- 🛡️ **Built-in Rollback**: Version management with instant rollback capability

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for Supabase local development)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/stark-orchestrator.git
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

### Production Deployment

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

## CLI Usage

The Stark CLI provides command-line access to all orchestrator features.

### Initial Setup

When starting fresh, create the first admin account:

```bash
# Create the initial admin user (only works when no users exist)
node packages/cli/dist/index.js auth setup
```

This will prompt for an email, password, and optional display name. The first user is automatically granted the admin role.

### CLI Configuration

The CLI stores its configuration in `~/.stark/` (e.g., `C:\Users\<username>\.stark\` on Windows or `/home/<username>/.stark/` on Linux/macOS).

#### Configuration File

Create `~/.stark/config.json` to customize CLI behavior:

```json
{
  "apiUrl": "https://127.0.0.1:443",
  "supabaseUrl": "http://127.0.0.1:54321",
  "supabaseAnonKey": "your-supabase-anon-key",
  "defaultNamespace": "default",
  "defaultOutputFormat": "table"
}
```

#### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `apiUrl` | Stark orchestrator API URL | `https://127.0.0.1:443` |
| `supabaseUrl` | Supabase instance URL | `http://127.0.0.1:54321` |
| `supabaseAnonKey` | Supabase anonymous key | Local dev key |
| `defaultNamespace` | Default namespace for commands | `default` |
| `defaultOutputFormat` | Output format: `json`, `table`, or `plain` | `table` |

#### Credentials File

After logging in, credentials are stored in `~/.stark/credentials.json`. This file is managed automatically by the CLI and contains:

- Access token
- Refresh token
- Token expiration
- User ID and email

> **Note**: The `~/.stark/` directory is created with restricted permissions (mode `0700`) to protect sensitive credentials.

#### Production Configuration Example

For connecting to a production Supabase instance:

```json
{
  "apiUrl": "https://your-orchestrator.example.com",
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "defaultNamespace": "production",
  "defaultOutputFormat": "json"
}
```

### Logging

All services emit structured JSON logs.

Common fields:

- timestamp
- level
- service
- nodeId
- podId
- message

### Authentication

```bash
# Login to the orchestrator
node packages/cli/dist/index.js auth login --email user@example.com

# Check current user
node packages/cli/dist/index.js auth whoami

# Logout
node packages/cli/dist/index.js auth logout
```

### User Management (Admin Only)

Administrators can create and manage users:

```bash
# Add a new user
node packages/cli/dist/index.js auth add-user --email newuser@example.com --role node

# List all users
node packages/cli/dist/index.js auth list-users
```

#### User Roles

- **admin**: Full access to everything (manage all). Admin nodes are shared infrastructure that can run packs from any user.
- **user**: Self-service users - can create/manage own packs, nodes, and deployments. Packs can only be deployed to own nodes (unless public).
- **node**: Node agents - can register/update own node, update pods assigned to it, read accessible packs/pods/namespaces
- **viewer**: Read-only access to packs, pods, nodes, namespaces

### Pack Management

Packs support visibility control to manage who can deploy them:

- **private** (default): Only the owner can deploy this pack (to their own nodes or admin nodes)
- **public**: Anyone can deploy this pack to their nodes

```bash
# Bundle a pack from source (auto-detects Nuxt projects)
node packages/cli/dist/index.js pack bundle ./src/my-pack --out ./bundle.js

# Register a private pack (default)
node packages/cli/dist/index.js pack register ./bundle.js \
  --name my-pack \
  --ver 1.0.0 \
  --runtime node

# Register a public pack (anyone can use it)
node packages/cli/dist/index.js pack register ./bundle.js \
  --name my-public-pack \
  --ver 1.0.0 \
  --runtime node \
  --visibility public

# List all packs
node packages/cli/dist/index.js pack list

# List versions of a specific pack
node packages/cli/dist/index.js pack versions my-pack
```

#### Bundling Requirements

For web apps (Nuxt/Vue) to be bundled as self-contained packs:

| Requirement | Description |
|-------------|-------------|
| **pnpm** | Project must use pnpm as package manager |
| **Static output** | Must generate static HTML/JS/CSS (no SSR) |
| **No code-splitting** | Disable dynamic imports (`inlineDynamicImports: true`) |
| **Inline assets** | Assets must be inlined as base64 data URIs |

**Nuxt configuration example** (`nuxt.config.ts`):

```typescript
export default defineNuxtConfig({
  ssr: false,
  nitro: { preset: 'static' },
  vite: {
    build: {
      assetsInlineLimit: 100 * 1024, // 100KB
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          manualChunks: undefined,
        },
      },
    },
  },
})
```

See [examples/nuxt-pack](examples/nuxt-pack) for a complete example.

### Pod Management

```bash
# Deploy a pack to a node
node packages/cli/dist/index.js pod create --pack my-pack --node node-1

# Deploy with scheduling constraints
node packages/cli/dist/index.js pod create --pack my-pack \
  --node-selector env=production \
  --node-selector tier=backend \
  --toleration dedicated=gpu:NoSchedule \
  --cpu 500 \
  --memory 256

# Deploy with labels and priority
node packages/cli/dist/index.js pod create --pack my-pack \
  --label app=web \
  --label version=v1 \
  --priority 200 \
  --replicas 3

# Check pod status
node packages/cli/dist/index.js pod status <pod-id>

# List pods with filters
node packages/cli/dist/index.js pod list --namespace production --status running

# Rollback to a previous version
node packages/cli/dist/index.js pod rollback <pod-id> --ver 0.9.0
```

#### Pod Create Options

| Option | Description | De+fault |
|--------|-------------|---------|
| `--pack <name>` | Pack name to deploy | (required) |
| `-V, --ver <version>` | Pack version | latest |
| `-n, --node <nodeId>` | Target specific node | auto-scheduled |
| `--namespace <ns>` | Target namespace | `default` |
| `-p, --priority <n>` | Priority (0-1000) | `100` |
| `-l, --label <k=v>` | Pod label (can be repeated) | - |
| `-r, --replicas <n>` | Number of replicas | `1` |
| `-s, --node-selector <k=v>` | Node selector (can be repeated) | - |
| `-t, --toleration <k=v:effect>` | Toleration (can be repeated) | - |
| `--cpu <millicores>` | CPU request in millicores | `100` |
| `--memory <mb>` | Memory request in MB | `128` |

#### Scheduling Concepts

Pods are scheduled to nodes based on these Kubernetes-like constraints:

- **Node Selectors**: Pods only schedule on nodes with matching labels
  - Node has `--label env=production` → Pod needs `--node-selector env=production`
- **Tolerations**: Allow pods to schedule on tainted nodes
  - Node has `--taint dedicated=gpu:NoSchedule` → Pod needs `--toleration dedicated=gpu:NoSchedule`
- **Resource Requests**: Pods fit onto nodes with sufficient capacity
  - Node has `--cpu 2000 --memory 4096` → Pod requesting `--cpu 500 --memory 256` fits 4× per node
- **Pack Ownership**: Packs can only be deployed to nodes where the node owner can access the pack
  - **Private packs**: Only deploy to owner's nodes or admin nodes
  - **Public packs**: Deploy to any node
  - This enforces user isolation - users can only run their own packs on their own nodes

### Deployment Management

Deployments are persistent resources that automatically create and manage pods. They are useful for:

- **Auto-healing**: Automatically recreate pods when nodes fail
- **Scaling**: Easily scale the number of replicas
- **DaemonSet mode**: Deploy to all nodes matching scheduling constraints

```bash
# Create a deployment with 3 replicas
node packages/cli/dist/index.js deployment create my-deployment \
  --pack my-pack \
  --replicas 3

# Create a DaemonSet-like deployment (deploys to all matching nodes)
node packages/cli/dist/index.js deployment create gpu-worker \
  --pack ml-pack \
  --replicas 0 \
  --node-selector gpu=true \
  --toleration gpu=dedicated:NoSchedule

# Create a deployment with scheduling constraints
node packages/cli/dist/index.js deployment create web-app \
  --pack web-pack \
  --replicas 5 \
  --namespace production \
  --node-selector env=production \
  --node-selector tier=frontend \
  --label app=web

# List all deployments
node packages/cli/dist/index.js deployment list

# Check deployment status
node packages/cli/dist/index.js deployment status my-deployment

# Scale a deployment
node packages/cli/dist/index.js deployment scale my-deployment --replicas 10

# Convert a scaled deployment to DaemonSet mode
node packages/cli/dist/index.js deployment scale my-deployment --replicas 0

# Pause reconciliation (stops creating/deleting pods)
node packages/cli/dist/index.js deployment pause my-deployment

# Resume reconciliation
node packages/cli/dist/index.js deployment resume my-deployment

# Delete a deployment (stops all pods)
node packages/cli/dist/index.js deployment delete my-deployment --force
```

#### Deployment Create Options

| Option | Description | Default |
|--------|-------------|---------|
| `--pack <name>` | Pack name to deploy | (required) |
| `-V, --ver <version>` | Pack version | latest |
| `--namespace <ns>` | Target namespace | `default` |
| `-r, --replicas <n>` | Number of replicas (0 = all matching nodes) | `1` |
| `-l, --label <k=v>` | Deployment label (can be repeated) | - |
| `--pod-label <k=v>` | Label for created pods (can be repeated) | - |
| `-s, --node-selector <k=v>` | Node selector (can be repeated) | - |
| `-t, --toleration <k=v:effect>` | Toleration (can be repeated) | - |
| `--cpu <millicores>` | CPU request in millicores | `100` |
| `--memory <mb>` | Memory request in MB | `128` |

#### Deployment vs Pod

| Aspect | Pod | Deployment |
|--------|-----|------------|
| **Lifecycle** | Manual - you create and delete | Managed - controller creates pods |
| **Auto-healing** | None - pod stays failed | Yes - recreates failed pods |
| **Scaling** | Create more pods manually | Single scale command |
| **New nodes** | Manual pod creation | Auto-deploys (if replicas=0) |
| **Use case** | One-off tasks, testing | Production workloads |

When `replicas=0`, the deployment operates in **DaemonSet mode**:
- Automatically creates one pod on every node matching the scheduling constraints
- When new nodes join with matching labels, pods are automatically deployed
- When nodes leave, their pods are removed

#### Automatic Version Updates (Follow Latest)

Deployments can automatically update to new pack versions when they are registered:

```bash
# Create a deployment that auto-updates to latest pack versions
node packages/cli/dist/index.js deployment create my-deployment \
  --pack my-pack \
  --follow-latest
```

When `--follow-latest` is enabled:
- The deployment controller checks for new pack versions during each reconciliation cycle
- When a new version is detected, a rolling update is triggered automatically
- Old pods are stopped and replaced with pods running the new version

#### Crash-Loop Protection

The deployment controller includes built-in crash-loop protection to prevent infinite upgrade/fail cycles:

| Feature | Description |
|---------|-------------|
| **Failure Tracking** | Counts consecutive pod failures per deployment |
| **Exponential Backoff** | Failed upgrades trigger increasing wait periods (1min → 2min → 4min → ... up to 1 hour) |
| **Auto-Rollback** | After 3 consecutive failures, automatically rolls back to the last successful version |
| **Version Blacklisting** | Failed versions are temporarily blocked from retry attempts |

**How it works:**

1. When a new pack version fails to start pods, the failure count increments
2. After 3 consecutive failures:
   - If a previous successful version exists → **auto-rollback** to that version
   - If no previous version → **pause** the deployment with an error message
3. The failed version is blocked until either:
   - The backoff period expires (exponential, up to 1 hour)
   - A newer pack version is registered
4. When pods successfully start, the failure state is cleared

This prevents a broken pack version from causing endless pod creation/failure cycles while preserving the ability to recover by publishing a fixed version.

### Node Management

```bash
# List all registered nodes
node packages/cli/dist/index.js node list

# Get detailed node status
node packages/cli/dist/index.js node status my-node-1

# Update node labels
node packages/cli/dist/index.js node update my-node-1 \
  --label env=staging \
  --label tier=frontend

# Add a taint to a node
node packages/cli/dist/index.js node update my-node-1 \
  --taint dedicated=gpu:NoSchedule

# Remove a label and taint
node packages/cli/dist/index.js node update my-node-1 \
  --remove-label tier \
  --remove-taint dedicated

# Cordon a node (prevent new pods from scheduling)
node packages/cli/dist/index.js node update my-node-1 --unschedulable

# Uncordon a node (allow scheduling again)
node packages/cli/dist/index.js node update my-node-1 --schedulable

# Delete node
node packages/cli/dist/index.js node rm my-node-1
```

#### Node Update Options

| Option | Description |
|--------|-------------|
| `-l, --label <k=v>` | Add or update a label (can be repeated) |
| `--remove-label <key>` | Remove a label by key (can be repeated) |
| `--taint <k=v:effect>` | Add or update a taint (can be repeated) |
| `--remove-taint <key>` | Remove a taint by key (can be repeated) |
| `--unschedulable` | Mark node as unschedulable (cordon) |
| `--schedulable` | Mark node as schedulable (uncordon) |

### Starting a Node Agent

The Node.js runtime agent connects to the orchestrator and registers itself to receive pod deployments.
If you are logged in as admin, you can enable automatic registration of the node,
which makes passing in authentification parameters optional:

```bash
node packages/cli/dist/index.js server-config set --enable-registration
```

```bash
# Start a node agent with basic configuration
node packages/cli/dist/index.js node agent start \
  --url wss://localhost/ws \
  --name my-node-1

# Start with username/password authentication
node packages/cli/dist/index.js node agent start \
  --url wss://localhost/ws \
  --name production-node-1 \
  --email user@example.com \
  --password yourpassword

# Start with labels and resource limits
node packages/cli/dist/index.js node agent start \
  --url wss://localhost/ws \
  --name my-node-1 \
  --token <auth-token> \
  --label env=production \
  --label tier=backend \
  --cpu 2000 \
  --memory 4096 \
  --pods 20
```

#### Node Agent Options

| Option | Description | Default |
|--------|-------------|---------|
| `--url, -u` | Orchestrator WebSocket URL | `wss://localhost/ws` |
| `--name, -n` | Unique node name | hostname |
| `--token, -t` | Authentication token | - |
| `--email, -e` | Login email (alternative to token) | - |
| `--password, -p` | Login password (with email) | - |
| `--label, -l` | Node label (can be repeated) | - |
| `--taint` | Node taint (format: key=value:effect) | - |
| `--cpu` | Allocatable CPU millicores | 1000 |
| `--memory` | Allocatable memory in MB | 1024 |
| `--pods` | Maximum concurrent pods | 10 |
| `--heartbeat` | Heartbeat interval in seconds | 15 |

#### Environment Variables

The node agent also supports configuration via environment variables:

| Variable | Description |
|----------|-------------|
| `STARK_ORCHESTRATOR_URL` | Orchestrator WebSocket URL |
| `STARK_NODE_NAME` | Node name |
| `STARK_AUTH_TOKEN` | Authentication token |
| `STARK_EMAIL` | Login email |
| `STARK_PASSWORD` | Login password |

#### Running as a Service

For production deployments, run the node agent as a systemd service:

```bash
# /etc/systemd/system/stark-node-agent.service
[Unit]
Description=Stark Node Agent
After=network.target

[Service]
Type=simple
User=stark
Environment=STARK_ORCHESTRATOR_URL=wss://orchestrator.example.com/ws
Environment=STARK_NODE_NAME=prod-node-1
Environment=STARK_AUTH_TOKEN=your-token
ExecStart=/usr/local/bin/stark node agent start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Namespace Management

```bash
# Create a namespace
node packages/cli/dist/index.js namespace create my-namespace

# List all namespaces
node packages/cli/dist/index.js namespace list

# Delete a namespace
node packages/cli/dist/index.js namespace delete my-namespace
```

### Output Formats

All commands support JSON output for scripting:

```bash
node packages/cli/dist/index.js pack list --output json
node packages/cli/dist/index.js node list -o json
```

## Project Structure

```
stark-orchestrator/
├── packages/
│   ├── core/            # Isomorphic reactive core
│   ├── shared/          # Shared types, validation, utilities
│   ├── server/          # REST API & WebSocket server
│   ├── cli/             # Command-line interface
│   ├── node-runtime/    # Node.js runtime adapter
│   └── browser-runtime/ # Browser runtime adapter
├── supabase/
│   └── migrations/      # Database schema migrations
├── tests/
│   ├── integration/     # Integration tests
│   └── e2e/            # End-to-end tests
└── docs/
    └── architecture.md  # Architecture documentation
```

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/auth/setup/status` | Check if initial setup is needed |
| POST | `/auth/setup` | Create initial admin (only when no users exist) |
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | User login |
| POST | `/auth/logout` | User logout |
| GET | `/auth/users` | List all users (admin only) |
| POST | `/auth/users` | Create a new user (admin only) |
| GET | `/api/packs` | List all packs |
| POST | `/api/packs` | Register a new pack |
| GET | `/api/packs/:name/versions` | List pack versions |
| GET | `/api/pods` | List all pods |
| POST | `/api/pods` | Create a pod |
| GET | `/api/pods/:id` | Get pod details |
| POST | `/api/pods/:id/rollback` | Rollback pod version |
| DELETE | `/api/pods/:id` | Delete a pod |
| GET | `/api/nodes` | List all nodes |
| GET | `/api/nodes/:id` | Get node details by ID |
| GET | `/api/nodes/name/:name` | Get node details by name |
| GET | `/api/namespaces` | List all namespaces |
| POST | `/api/namespaces` | Create a namespace |
| DELETE | `/api/namespaces/:id` | Delete a namespace |

### WebSocket

Connect to `/ws` for real-time updates:

```javascript
const ws = new WebSocket('wss://localhost/ws');

// Node registration
ws.send(JSON.stringify({
  type: 'node:register',
  payload: { name: 'my-node', runtimeType: 'node' }
}));

// Heartbeat
ws.send(JSON.stringify({
  type: 'node:heartbeat',
  payload: { nodeId: 'node-123' }
}));
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `443` | HTTPS server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `NODE_ENV` | `development` | Environment mode |
| `CORS_ORIGINS` | `https://localhost:*` | Allowed CORS origins |
| `SSL_CERT` | - | Path to SSL certificate (auto-generated if not set) |
| `SSL_KEY` | - | Path to SSL private key (auto-generated if not set) |
| `SUPABASE_URL` | - | Supabase project URL |
| `SUPABASE_ANON_KEY` | - | Supabase anonymous key |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

## Development

### Scripts

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Watch mode for development
pnpm test:watch

# Lint code
pnpm lint

# Format code
pnpm format

# Type checking
pnpm typecheck

# Clean build artifacts
pnpm clean
```

### Database Management

```bash
# Start local Supabase
pnpm db:start

# Stop Supabase
pnpm db:stop

# Reset database (apply migrations from scratch)
pnpm db:reset

# Apply new migrations
pnpm db:migrate
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed architecture documentation.

### Key Concepts

- **Pack**: A bundled software package that can be deployed (private or public visibility)
- **Node**: A runtime environment (Node.js or browser) that executes packs (owned by the registering user)
- **Pod**: A running instance of a pack on a specific node
- **Namespace**: Isolated resource boundary with quotas
- **Ownership**: Users can only deploy their packs to their nodes (unless packs are public or nodes are admin-owned)

### Technology Stack

- **Language**: TypeScript 5.x (strict mode)
- **Reactivity**: Vue 3 (`@vue/reactivity`)
- **Database**: Supabase (PostgreSQL)
- **Testing**: Vitest
- **Build**: Vite

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Standards

- TypeScript strict mode enabled
- ESLint + Prettier for code formatting
- 80% test coverage target
- Conventional commits preferred

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by Kubernetes orchestration concepts
- Built with Vue.js reactivity system
- Powered by Supabase for database and auth
