/**
 * Node Query Functions
 *
 * Provides query functions for nodes that can be used by chaos scenarios
 * and other services. These wrap the reactive store functions.
 * @module @stark-o/core/queries/node-queries
 */

import {
  findNodeByName,
  findNodesBySelector,
  findNodesByRuntime,
  getSchedulableNodesForRuntime,
  hasAvailableNodes,
  getStaleNodes,
} from '../stores/node-store';
import { getNode, nodesList } from '../stores/cluster-store';
import type { Node, Labels, RuntimeType } from '@stark-o/shared';

/**
 * Get a node by ID
 */
export async function getNodeById(nodeId: string): Promise<Node | undefined> {
  // This is a synchronous operation wrapping the reactive store
  // Made async for consistency with other query patterns
  return getNode(nodeId);
}

/**
 * Get a node by name
 */
export async function getNodeByName(name: string): Promise<Node | undefined> {
  return findNodeByName(name);
}

/**
 * List all nodes with optional filters
 */
export async function listNodes(options?: {
  limit?: number;
  status?: string;
  runtime?: string;
}): Promise<Node[]> {
  let nodes = nodesList.value;

  if (options?.status) {
    nodes = nodes.filter((n: Node) => n.status === options.status);
  }

  if (options?.runtime) {
    nodes = nodes.filter((n: Node) => n.runtimeType === options.runtime);
  }

  if (options?.limit) {
    nodes = nodes.slice(0, options.limit);
  }

  return nodes;
}

/**
 * Find nodes by label selector
 */
export async function findNodesByLabelSelector(
  selector: Partial<Labels>
): Promise<Node[]> {
  return findNodesBySelector(selector);
}

/**
 * Find nodes by runtime
 */
export async function findNodesByRuntimeType(runtime: RuntimeType): Promise<Node[]> {
  return findNodesByRuntime(runtime);
}

/**
 * Get schedulable nodes for a runtime
 */
export async function getSchedulableNodes(
  runtime: RuntimeType
): Promise<Node[]> {
  return getSchedulableNodesForRuntime(runtime);
}

/**
 * Check if any nodes are available
 */
export async function hasAvailable(): Promise<boolean> {
  return hasAvailableNodes();
}

/**
 * Get stale nodes (not heartbeating)
 */
export async function getStale(thresholdMs?: number): Promise<Node[]> {
  if (thresholdMs === undefined) {
    return getStaleNodes();
  }
  return getStaleNodes(thresholdMs);
}

/**
 * Consolidated node queries export
 */
export const nodeQueries = {
  getNodeById,
  getNodeByName,
  listNodes,
  findBySelector: findNodesByLabelSelector,
  findByRuntime: findNodesByRuntimeType,
  getSchedulableNodes,
  hasAvailable,
  getStale,
};
