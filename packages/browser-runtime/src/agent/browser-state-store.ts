/**
 * Browser Agent State Store
 * @module @stark-o/browser-runtime/agent/browser-state-store
 *
 * Persistent storage for browser agent credentials and registered nodes.
 * Uses localStorage for persistence across browser sessions.
 */

/**
 * Storage keys for browser agent state
 */
const STORAGE_KEYS = {
  CREDENTIALS: 'stark:agent:credentials',
  REGISTERED_NODES: 'stark:agent:nodes',
} as const;

/**
 * Stored node credentials (for browser agent authentication)
 */
export interface BrowserNodeCredentials {
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
export interface RegisteredBrowserNode {
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
export interface RegisteredBrowserNodesMap {
  [orchestratorUrl: string]: {
    [nodeName: string]: RegisteredBrowserNode;
  };
}

/**
 * Check if localStorage is available
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__stark_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load credentials from localStorage
 */
export function loadBrowserCredentials(): BrowserNodeCredentials | null {
  if (!isLocalStorageAvailable()) {
    return null;
  }
  
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CREDENTIALS);
    if (data) {
      return JSON.parse(data) as BrowserNodeCredentials;
    }
  } catch {
    // Return null on error
  }
  return null;
}

/**
 * Save credentials to localStorage
 */
export function saveBrowserCredentials(credentials: BrowserNodeCredentials): void {
  if (!isLocalStorageAvailable()) {
    console.warn('localStorage not available, credentials will not persist');
    return;
  }
  
  try {
    localStorage.setItem(STORAGE_KEYS.CREDENTIALS, JSON.stringify(credentials));
  } catch (error) {
    console.error('Failed to save credentials to localStorage:', error);
  }
}

/**
 * Clear stored credentials
 */
export function clearBrowserCredentials(): void {
  if (!isLocalStorageAvailable()) {
    return;
  }
  
  try {
    localStorage.removeItem(STORAGE_KEYS.CREDENTIALS);
  } catch {
    // Ignore errors
  }
}

/**
 * Check if credentials are valid (not expired)
 */
export function areBrowserCredentialsValid(): boolean {
  const creds = loadBrowserCredentials();
  if (!creds) return false;

  const expiresAt = new Date(creds.expiresAt);
  return expiresAt > new Date();
}

/**
 * Token refresh threshold - refresh when 15 minutes or less remaining
 */
export const TOKEN_REFRESH_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Check if browser credentials should be refreshed (within threshold of expiration)
 */
export function shouldRefreshBrowserCredentials(): boolean {
  const creds = loadBrowserCredentials();
  if (!creds || !creds.refreshToken) return false;

  const expiresAt = new Date(creds.expiresAt);
  const now = new Date();
  const timeRemaining = expiresAt.getTime() - now.getTime();
  
  // Should refresh if within threshold of expiration
  return timeRemaining > 0 && timeRemaining <= TOKEN_REFRESH_THRESHOLD_MS;
}

/**
 * Get the time remaining until token expiration in milliseconds
 */
export function getBrowserTokenTimeRemaining(): number {
  const creds = loadBrowserCredentials();
  if (!creds) return 0;

  const expiresAt = new Date(creds.expiresAt);
  const now = new Date();
  return Math.max(0, expiresAt.getTime() - now.getTime());
}

/**
 * Get the refresh token if available
 */
export function getBrowserRefreshToken(): string | null {
  const creds = loadBrowserCredentials();
  if (!creds || !creds.refreshToken) return null;
  return creds.refreshToken;
}

/**
 * Get the access token if valid
 */
export function getBrowserAccessToken(): string | null {
  const creds = loadBrowserCredentials();
  if (!creds) return null;

  const expiresAt = new Date(creds.expiresAt);
  if (expiresAt <= new Date()) return null;

  return creds.accessToken;
}

/**
 * Load registered nodes from localStorage
 */
export function loadRegisteredBrowserNodes(): RegisteredBrowserNodesMap {
  if (!isLocalStorageAvailable()) {
    return {};
  }
  
  try {
    const data = localStorage.getItem(STORAGE_KEYS.REGISTERED_NODES);
    if (data) {
      return JSON.parse(data) as RegisteredBrowserNodesMap;
    }
  } catch {
    // Return empty object on error
  }
  return {};
}

/**
 * Save registered nodes to localStorage
 */
export function saveRegisteredBrowserNodes(nodes: RegisteredBrowserNodesMap): void {
  if (!isLocalStorageAvailable()) {
    console.warn('localStorage not available, registered nodes will not persist');
    return;
  }
  
  try {
    localStorage.setItem(STORAGE_KEYS.REGISTERED_NODES, JSON.stringify(nodes));
  } catch (error) {
    console.error('Failed to save registered nodes to localStorage:', error);
  }
}

/**
 * Normalize orchestrator URL for consistent storage keys
 */
function normalizeOrchestratorUrl(url: string): string {
  return url
    .replace(/\/+$/, '')
    .replace(/\/ws$/, '')
    .toLowerCase();
}

/**
 * Get a registered node by name for a specific orchestrator
 */
export function getRegisteredBrowserNode(orchestratorUrl: string, nodeName: string): RegisteredBrowserNode | null {
  const nodes = loadRegisteredBrowserNodes();
  const normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  return nodes[normalizedUrl]?.[nodeName] ?? null;
}

/**
 * Save a registered node
 */
export function saveRegisteredBrowserNode(
  orchestratorUrl: string,
  node: RegisteredBrowserNode
): void {
  const nodes = loadRegisteredBrowserNodes();
  const normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  
  if (!nodes[normalizedUrl]) {
    nodes[normalizedUrl] = {};
  }
  nodes[normalizedUrl][node.name] = node;
  
  saveRegisteredBrowserNodes(nodes);
}

/**
 * Remove a registered node
 */
export function removeRegisteredBrowserNode(orchestratorUrl: string, nodeName: string): void {
  const nodes = loadRegisteredBrowserNodes();
  const normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  
  if (nodes[normalizedUrl] && nodes[normalizedUrl][nodeName]) {
    delete nodes[normalizedUrl][nodeName];
    
    // Clean up empty orchestrator entries
    if (Object.keys(nodes[normalizedUrl]).length === 0) {
      delete nodes[normalizedUrl];
    }
    
    saveRegisteredBrowserNodes(nodes);
  }
}

/**
 * Get all registered nodes for an orchestrator
 */
export function getRegisteredBrowserNodesForOrchestrator(orchestratorUrl: string): RegisteredBrowserNode[] {
  const nodes = loadRegisteredBrowserNodes();
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
export function updateBrowserNodeLastStarted(orchestratorUrl: string, nodeName: string): void {
  const node = getRegisteredBrowserNode(orchestratorUrl, nodeName);
  if (node) {
    node.lastStarted = new Date().toISOString();
    saveRegisteredBrowserNode(orchestratorUrl, node);
  }
}

/**
 * Browser State Store class for object-oriented access
 */
export class BrowserStateStore {
  private readonly orchestratorUrl: string;
  private readonly normalizedUrl: string;

  constructor(orchestratorUrl: string) {
    this.orchestratorUrl = orchestratorUrl;
    this.normalizedUrl = normalizeOrchestratorUrl(orchestratorUrl);
  }

  /**
   * Get credentials for node authentication
   */
  getCredentials(): BrowserNodeCredentials | null {
    return loadBrowserCredentials();
  }

  /**
   * Save credentials for node authentication
   */
  saveCredentials(credentials: BrowserNodeCredentials): void {
    saveBrowserCredentials(credentials);
  }

  /**
   * Clear stored credentials
   */
  clearCredentials(): void {
    clearBrowserCredentials();
  }

  /**
   * Check if credentials are valid
   */
  hasValidCredentials(): boolean {
    return areBrowserCredentialsValid();
  }

  /**
   * Check if credentials should be refreshed
   */
  shouldRefreshCredentials(): boolean {
    return shouldRefreshBrowserCredentials();
  }

  /**
   * Get time remaining until token expiration in milliseconds
   */
  getTokenTimeRemaining(): number {
    return getBrowserTokenTimeRemaining();
  }

  /**
   * Get refresh token if available
   */
  getRefreshToken(): string | null {
    return getBrowserRefreshToken();
  }

  /**
   * Get access token if valid
   */
  getAccessToken(): string | null {
    return getBrowserAccessToken();
  }

  /**
   * Get a registered node by name
   */
  getNode(nodeName: string): RegisteredBrowserNode | null {
    return getRegisteredBrowserNode(this.orchestratorUrl, nodeName);
  }

  /**
   * Save a registered node
   */
  saveNode(node: RegisteredBrowserNode): void {
    saveRegisteredBrowserNode(this.orchestratorUrl, node);
  }

  /**
   * Remove a registered node
   */
  removeNode(nodeName: string): void {
    removeRegisteredBrowserNode(this.orchestratorUrl, nodeName);
  }

  /**
   * Get all registered nodes for this orchestrator
   */
  getAllNodes(): RegisteredBrowserNode[] {
    return getRegisteredBrowserNodesForOrchestrator(this.orchestratorUrl);
  }

  /**
   * Update the last started timestamp for a node
   */
  updateLastStarted(nodeName: string): void {
    updateBrowserNodeLastStarted(this.orchestratorUrl, nodeName);
  }

  /**
   * Check if localStorage is available
   */
  isStorageAvailable(): boolean {
    return isLocalStorageAvailable();
  }
}

/**
 * Create a new BrowserStateStore instance
 */
export function createBrowserStateStore(orchestratorUrl: string): BrowserStateStore {
  return new BrowserStateStore(orchestratorUrl);
}
