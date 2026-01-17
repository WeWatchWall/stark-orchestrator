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

The server will start at `http://localhost:80`.

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
# Health check
curl http://localhost:3000/health
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

This will prompt for an email, password, and optional display name. The first user is automatically granted all roles (admin, operator, developer, viewer).

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
node packages/cli/dist/index.js auth add-user --email newuser@example.com --role developer --role viewer

# List all users
node packages/cli/dist/index.js auth list-users
```

### Pack Management

```bash
# Bundle a pack from source
node packages/cli/dist/index.js pack bundle ./src/my-pack --output ./bundle.js

# Register a pack with the orchestrator
node packages/cli/dist/index.js pack register ./bundle.js \
  --name my-pack \
  --ver 1.0.0 \
  --runtime node

# List all packs
node packages/cli/dist/index.js pack list

# List versions of a specific pack
node packages/cli/dist/index.js pack versions my-pack
```

### Pod Management

```bash
# Deploy a pack to a node
node packages/cli/dist/index.js pod create --pack my-pack --node node-1

# Check pod status
node packages/cli/dist/index.js pod status <pod-id>

# Rollback to a previous version
node packages/cli/dist/index.js pod rollback <pod-id> --ver 0.9.0
```

### Node Management

```bash
# List all registered nodes
node packages/cli/dist/index.js node list

# Get detailed node status
node packages/cli/dist/index.js node status my-node-1

# Delete node
node packages/cli/dist/index.js node rm my-node-1
```

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
  --url ws://localhost:3000/ws \
  --name my-node-1 \
  --token <auth-token>

# Start with username/password authentication
node packages/cli/dist/index.js node agent start \
  --url ws://localhost:3000/ws \
  --name production-node-1 \
  --email user@example.com \
  --password yourpassword

# Start with labels and resource limits
node packages/cli/dist/index.js node agent start \
  --url ws://localhost:3000/ws \
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
| `--url, -u` | Orchestrator WebSocket URL | `ws://localhost:3000/ws` |
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
Environment=STARK_ORCHESTRATOR_URL=ws://orchestrator.example.com/ws
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
const ws = new WebSocket('ws://localhost:3000/ws');

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
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `NODE_ENV` | `development` | Environment mode |
| `CORS_ORIGINS` | `http://localhost:*` | Allowed CORS origins |
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

- **Pack**: A bundled software package that can be deployed
- **Node**: A runtime environment (Node.js or browser) that executes packs
- **Pod**: A running instance of a pack on a specific node
- **Namespace**: Isolated resource boundary with quotas

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
