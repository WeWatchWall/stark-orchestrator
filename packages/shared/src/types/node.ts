/**
 * Node type definitions
 * @module @stark-o/shared/types/node
 */

import type { Labels, Annotations } from './labels';
import type { Taint } from './taints';

/**
 * Runtime types for nodes
 * - node: Node.js server runtime
 * - browser: Browser runtime
 */
export type RuntimeType = 'node' | 'browser';

/**
 * Node status values
 * - online: Node is healthy and accepting pods
 * - offline: Node is disconnected
 * - unhealthy: Node missed heartbeats
 * - draining: Node is being evacuated (no new pods)
 * - maintenance: Node is under maintenance
 */
export type NodeStatus = 'online' | 'offline' | 'unhealthy' | 'draining' | 'maintenance';

/**
 * Node capabilities - features supported by the node
 */
export interface NodeCapabilities {
  /** Node.js or browser version */
  version?: string;
  /** Supported features */
  features?: string[];
  /** Custom capabilities */
  [key: string]: unknown;
}

/**
 * Allocatable resources on a node
 */
export interface AllocatableResources {
  /** CPU in millicores (1000 = 1 CPU) */
  cpu: number;
  /** Memory in MB */
  memory: number;
  /** Maximum number of pods */
  pods: number;
  /** Storage in MB */
  storage: number;
}

/**
 * Node entity - a registered runtime node
 */
export interface Node {
  /** Unique identifier (UUID) */
  id: string;
  /** Node name (unique) */
  name: string;
  /** Runtime type */
  runtimeType: RuntimeType;
  /** Current status */
  status: NodeStatus;
  /** Last heartbeat timestamp */
  lastHeartbeat?: Date;
  /** Node capabilities */
  capabilities: NodeCapabilities;
  /** User who registered the node */
  registeredBy?: string;
  /** WebSocket connection ID */
  connectionId?: string;
  /** IP address */
  ipAddress?: string;
  /** User agent string */
  userAgent?: string;
  /** Total allocatable resources */
  allocatable: AllocatableResources;
  /** Currently allocated resources */
  allocated: AllocatableResources;
  /** Labels for organization and selection */
  labels: Labels;
  /** Annotations for metadata */
  annotations: Annotations;
  /** Taints to repel pods */
  taints: Taint[];
  /** Whether node is unschedulable */
  unschedulable: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Node registration input
 */
export interface RegisterNodeInput {
  /** Node name */
  name: string;
  /** Runtime type */
  runtimeType: RuntimeType;
  /** Node capabilities */
  capabilities?: NodeCapabilities;
  /** Allocatable resources */
  allocatable?: Partial<AllocatableResources>;
  /** Labels */
  labels?: Labels;
  /** Annotations */
  annotations?: Annotations;
  /** Taints */
  taints?: Taint[];
}

/**
 * Node update input
 */
export interface UpdateNodeInput {
  status?: NodeStatus;
  capabilities?: NodeCapabilities;
  allocatable?: Partial<AllocatableResources>;
  labels?: Labels;
  annotations?: Annotations;
  taints?: Taint[];
  unschedulable?: boolean;
}

/**
 * Node heartbeat payload
 */
export interface NodeHeartbeat {
  /** Node ID */
  nodeId: string;
  /** Current status */
  status?: NodeStatus;
  /** Currently allocated resources */
  allocated?: Partial<AllocatableResources>;
  /** Active pod IDs */
  activePods?: string[];
  /** Timestamp */
  timestamp: Date;
}

/**
 * Node list item (for search/listing)
 */
export interface NodeListItem {
  id: string;
  name: string;
  runtimeType: RuntimeType;
  status: NodeStatus;
  lastHeartbeat?: Date;
  labels: Labels;
  allocatable: AllocatableResources;
  allocated: AllocatableResources;
  podCount: number;
  connectionId?: string;
  /** User who registered the node */
  registeredBy?: string;
}

/**
 * Calculate available resources on a node
 */
export function getAvailableResources(node: Node): AllocatableResources {
  return {
    cpu: node.allocatable.cpu - node.allocated.cpu,
    memory: node.allocatable.memory - node.allocated.memory,
    pods: node.allocatable.pods - node.allocated.pods,
    storage: node.allocatable.storage - node.allocated.storage,
  };
}

/**
 * Check if a node has sufficient resources
 */
export function hasAvailableResources(
  node: Node,
  required: Partial<AllocatableResources>,
): boolean {
  const available = getAvailableResources(node);

  if (required.cpu !== undefined && available.cpu < required.cpu) {
    return false;
  }
  if (required.memory !== undefined && available.memory < required.memory) {
    return false;
  }
  if (required.pods !== undefined && available.pods < required.pods) {
    return false;
  }
  if (required.storage !== undefined && available.storage < required.storage) {
    return false;
  }

  return true;
}

/**
 * Check if a node can accept new pods
 */
export function isNodeSchedulable(node: Node): boolean {
  return (
    node.status === 'online' &&
    !node.unschedulable &&
    node.allocated.pods < node.allocatable.pods
  );
}

/**
 * All available node statuses
 */
export const ALL_NODE_STATUSES: readonly NodeStatus[] = [
  'online',
  'offline',
  'unhealthy',
  'draining',
  'maintenance',
] as const;

/**
 * All available runtime types
 */
export const ALL_RUNTIME_TYPES: readonly RuntimeType[] = ['node', 'browser'] as const;

/**
 * Default allocatable resources
 */
export const DEFAULT_ALLOCATABLE: AllocatableResources = {
  cpu: 1000,
  memory: 1024,
  pods: 10,
  storage: 10240,
};

/**
 * Default allocated resources (empty)
 */
export const DEFAULT_ALLOCATED: AllocatableResources = {
  cpu: 0,
  memory: 0,
  pods: 0,
  storage: 0,
};
