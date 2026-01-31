/**
 * Node State Store
 * @module @stark-o/node-runtime/agent/node-state-store
 *
 * Persistent storage for node agent credentials and registered nodes.
 * This is separate from CLI credentials to allow nodes to maintain their own auth state.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Directory for node agent state files
 */
const NODE_STATE_DIR = path.join(os.homedir(), '.stark', 'nodes');

/**
 * File path for storing node agent credentials
 */
const NODE_CREDENTIALS_FILE = path.join(NODE_STATE_DIR, 'credentials.json');

/**
 * File path for storing registered nodes
 */
const REGISTERED_NODES_FILE = path.join(NODE_STATE_DIR, 'registered-nodes.json');

/**
 * Stored node credentials (separate from CLI user credentials)
 */
export interface NodeCredentials {
  /** The access token for node authentication */
  accessToken: string;
  /** The refresh token for token renewal */
  refreshToken?: string;
  /** Token expiration timestamp (ISO string) */
  expiresAt: string;
  /** The user ID associated with this credential */
  userId: string;
  /** The email used for this credential */
  email: string;
  /** Timestamp when credentials were created */
  createdAt: string;
}

/**
 * Information about a registered node
 */
export interface RegisteredNode {
  /** Node's unique ID from the orchestrator */
  nodeId: string;
  /** Node's name */
  name: string;
  /** Orchestrator URL this node is registered with */
  orchestratorUrl: string;
  /** Timestamp when the node was registered (ISO string) */
  registeredAt: string;
  /** The user ID that registered this node */
  registeredBy: string;
  /** Last time this node was successfully started */
  lastStarted?: string;
}

/**
 * Map of node names to registered node info
 */
export interface RegisteredNodesMap {
  [orchestratorUrl: string]: {
    [nodeName: string]: RegisteredNode;
  };
}

/**
 * Ensure the node state directory exists
 */
function ensureStateDir(): void {
  if (!fs.existsSync(NODE_STATE_DIR)) {
    fs.mkdirSync(NODE_STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Load node credentials from disk
 */
export function loadNodeCredentials(): NodeCredentials | null {
  try {
    if (fs.existsSync(NODE_CREDENTIALS_FILE)) {
      const content = fs.readFileSync(NODE_CREDENTIALS_FILE, 'utf-8');
      return JSON.parse(content) as NodeCredentials;
    }
  } catch {
    // Return null on error
  }
  return null;
}

/**
 * Save node credentials to disk
 */
export function saveNodeCredentials(credentials: NodeCredentials): void {
  ensureStateDir();
  fs.writeFileSync(NODE_CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Clear stored node credentials
 */
export function clearNodeCredentials(): void {
  try {
    if (fs.existsSync(NODE_CREDENTIALS_FILE)) {
      fs.unlinkSync(NODE_CREDENTIALS_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Check if node credentials are valid (not expired)
 */
export function areNodeCredentialsValid(): boolean {
  const creds = loadNodeCredentials();
  if (!creds) return false;

  const expiresAt = new Date(creds.expiresAt);
  return expiresAt > new Date();
}

/**
 * Get the node access token if valid
 */
export function getNodeAccessToken(): string | null {
  const creds = loadNodeCredentials();
  if (!creds) return null;

  const expiresAt = new Date(creds.expiresAt);
  if (expiresAt <= new Date()) return null;

  return creds.accessToken;
}

/**
 * Load registered nodes from disk
 */
export function loadRegisteredNodes(): RegisteredNodesMap {
  try {
    if (fs.existsSync(REGISTERED_NODES_FILE)) {
      const content = fs.readFileSync(REGISTERED_NODES_FILE, 'utf-8');
      return JSON.parse(content) as RegisteredNodesMap;
    }
  } catch {
    // Return empty object on error
  }
  return {};
}

/**
 * Save registered nodes to disk
 */
export function saveRegisteredNodes(nodes: RegisteredNodesMap): void {
  ensureStateDir();
  fs.writeFileSync(REGISTERED_NODES_FILE, JSON.stringify(nodes, null, 2), { mode: 0o600 });
}

/**
 * Get a registered node by name for a specific orchestrator
 */
export function getRegisteredNode(orchestratorUrl: string, nodeName: string): RegisteredNode | null {
  const nodes = loadRegisteredNodes();
  const normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  return nodes[normalizedUrl]?.[nodeName] ?? null;
}

/**
 * Save a registered node
 */
export function saveRegisteredNode(
  orchestratorUrl: string,
  node: RegisteredNode
): void {
  const nodes = loadRegisteredNodes();
  const normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  
  if (!nodes[normalizedUrl]) {
    nodes[normalizedUrl] = {};
  }
  nodes[normalizedUrl][node.name] = node;
  
  saveRegisteredNodes(nodes);
}

/**
 * Remove a registered node
 */
export function removeRegisteredNode(orchestratorUrl: string, nodeName: string): void {
  const nodes = loadRegisteredNodes();
  const normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  
  if (nodes[normalizedUrl] && nodes[normalizedUrl][nodeName]) {
    delete nodes[normalizedUrl][nodeName];
    
    // Clean up empty orchestrator entries
    if (Object.keys(nodes[normalizedUrl]).length === 0) {
      delete nodes[normalizedUrl];
    }
    
    saveRegisteredNodes(nodes);
  }
}

/**
 * Get all registered nodes for an orchestrator
 */
export function getRegisteredNodesForOrchestrator(orchestratorUrl: string): RegisteredNode[] {
  const nodes = loadRegisteredNodes();
  const normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  
  const orchestratorNodes = nodes[normalizedUrl];
  if (!orchestratorNodes) {
    return [];
  }
  
  return Object.values(orchestratorNodes);
}

/**
 * Update the last started timestamp for a node
 */
export function updateNodeLastStarted(orchestratorUrl: string, nodeName: string): void {
  const node = getRegisteredNode(orchestratorUrl, nodeName);
  if (node) {
    node.lastStarted = new Date().toISOString();
    saveRegisteredNode(orchestratorUrl, node);
  }
}

/**
 * Normalize orchestrator URL for consistent storage keys
 * Removes trailing slashes and normalizes protocol
 */
function normalizeOrchestratorUrl(url: string): string {
  return url
    .replace(/\/+$/, '')
    .replace(/\/ws$/, '')
    .toLowerCase();
}

/**
 * Node State Store class for object-oriented access
 */
export class NodeStateStore {
  private readonly orchestratorUrl: string;

  constructor(orchestratorUrl: string) {
    this.orchestratorUrl = normalizeOrchestratorUrl(orchestratorUrl);
  }

  /**
   * Get credentials for node authentication
   */
  getCredentials(): NodeCredentials | null {
    return loadNodeCredentials();
  }

  /**
   * Save credentials for node authentication
   */
  saveCredentials(credentials: NodeCredentials): void {
    saveNodeCredentials(credentials);
  }

  /**
   * Clear stored credentials
   */
  clearCredentials(): void {
    clearNodeCredentials();
  }

  /**
   * Check if credentials are valid
   */
  hasValidCredentials(): boolean {
    return areNodeCredentialsValid();
  }

  /**
   * Get access token if valid
   */
  getAccessToken(): string | null {
    return getNodeAccessToken();
  }

  /**
   * Get a registered node by name
   */
  getNode(nodeName: string): RegisteredNode | null {
    return getRegisteredNode(this.orchestratorUrl, nodeName);
  }

  /**
   * Save a registered node
   */
  saveNode(node: RegisteredNode): void {
    saveRegisteredNode(this.orchestratorUrl, node);
  }

  /**
   * Remove a registered node
   */
  removeNode(nodeName: string): void {
    removeRegisteredNode(this.orchestratorUrl, nodeName);
  }

  /**
   * Get all registered nodes for this orchestrator
   */
  getAllNodes(): RegisteredNode[] {
    return getRegisteredNodesForOrchestrator(this.orchestratorUrl);
  }

  /**
   * Update the last started timestamp for a node
   */
  updateLastStarted(nodeName: string): void {
    updateNodeLastStarted(this.orchestratorUrl, nodeName);
  }
}

/**
 * Create a new NodeStateStore instance
 */
export function createNodeStateStore(orchestratorUrl: string): NodeStateStore {
  return new NodeStateStore(orchestratorUrl);
}
