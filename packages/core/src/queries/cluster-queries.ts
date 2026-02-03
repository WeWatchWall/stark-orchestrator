/**
 * Cluster Query Functions
 *
 * Provides query functions for cluster-wide operations.
 * @module @stark-o/core/queries/cluster-queries
 */

import {
  clusterStats,
  clusterHealth,
  isClusterHealthy,
  getNode,
  getPod,
  getPack,
  getNamespace,
  getPodsOnNode,
  getPodsInNamespace,
  getPodsForPack,
} from '../stores/cluster-store';
import type { Node, Pod, Pack, ClusterStats, ClusterHealth } from '@stark-o/shared';

/**
 * Get cluster statistics
 */
export async function getClusterStats(): Promise<ClusterStats> {
  return clusterStats.value;
}

/**
 * Get cluster health
 */
export async function getClusterHealth(): Promise<ClusterHealth> {
  return clusterHealth.value;
}

/**
 * Check if cluster is healthy
 */
export async function checkClusterHealthy(): Promise<boolean> {
  return isClusterHealthy();
}

/**
 * Get a node by ID
 */
export async function getClusterNodeById(nodeId: string): Promise<Node | undefined> {
  return getNode(nodeId);
}

/**
 * Get a pod by ID
 */
export async function getClusterPodById(podId: string): Promise<Pod | undefined> {
  return getPod(podId);
}

/**
 * Get a pack by ID
 */
export async function getClusterPackById(packId: string): Promise<Pack | undefined> {
  return getPack(packId);
}

/**
 * Get a namespace by name
 */
export async function getNamespaceByName(name: string): Promise<unknown | undefined> {
  return getNamespace(name);
}

/**
 * Get pods on a node
 */
export async function getPodsOnNodeById(nodeId: string): Promise<Pod[]> {
  return getPodsOnNode(nodeId);
}

/**
 * Get pods in a namespace
 */
export async function getPodsInNamespaceByName(namespace: string): Promise<Pod[]> {
  return getPodsInNamespace(namespace);
}

/**
 * Get pods for a pack
 */
export async function getPodsForPackById(packId: string): Promise<Pod[]> {
  return getPodsForPack(packId);
}

/**
 * Consolidated cluster queries export
 */
export const clusterQueries = {
  getClusterStats,
  getClusterHealth,
  checkClusterHealthy,
  getNodeById: getClusterNodeById,
  getPodById: getClusterPodById,
  getPackById: getClusterPackById,
  getNamespaceByName,
  getPodsOnNodeById,
  getPodsInNamespaceByName,
  getPodsForPackById,
};
