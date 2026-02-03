/**
 * Deployment Query Functions
 *
 * Provides query functions for deployments that can be used by chaos scenarios
 * and other services.
 * @module @stark-o/core/queries/deployment-queries
 */

import { findPodsBySelector } from '../stores/pod-store';
import type { Pod, DeploymentStatus as SharedDeploymentStatus } from '@stark-o/shared';

// Note: Deployments are managed by the server's deployment controller
// This module provides query helpers that work with the cluster state

/**
 * Chaos deployment status type (extended for testing scenarios)
 * This extends the shared DeploymentStatus with additional states for chaos testing
 */
export type ChaosDeploymentStatus =
  | SharedDeploymentStatus
  | 'pending'
  | 'progressing'
  | 'available'
  | 'failed';

/**
 * Extended deployment info
 */
export interface DeploymentInfo {
  id: string;
  name: string;
  namespace: string;
  packId: string;
  replicas: number;
  availableReplicas: number;
  status: ChaosDeploymentStatus;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory deployment store for chaos testing
// In production, this would be backed by Supabase
const deployments = new Map<string, DeploymentInfo>();

/**
 * Get a deployment by ID
 */
export async function getDeploymentById(
  deploymentId: string
): Promise<DeploymentInfo | undefined> {
  return deployments.get(deploymentId);
}

/**
 * List deployments with optional filters
 */
export async function listDeployments(options?: {
  limit?: number;
  namespace?: string;
  status?: ChaosDeploymentStatus;
}): Promise<DeploymentInfo[]> {
  let result = Array.from(deployments.values());

  if (options?.namespace) {
    result = result.filter(d => d.namespace === options.namespace);
  }

  if (options?.status) {
    result = result.filter(d => d.status === options.status);
  }

  if (options?.limit) {
    result = result.slice(0, options.limit);
  }

  return result;
}

/**
 * Create a new deployment
 */
export async function createDeployment(spec: {
  name: string;
  packId: string;
  namespace?: string;
  replicas?: number;
}): Promise<DeploymentInfo> {
  const id = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();

  const deployment: DeploymentInfo = {
    id,
    name: spec.name,
    namespace: spec.namespace || 'default',
    packId: spec.packId,
    replicas: spec.replicas ?? 1,
    availableReplicas: 0,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  deployments.set(id, deployment);
  return deployment;
}

/**
 * Update a deployment
 */
export async function updateDeployment(
  deploymentId: string,
  updates: Partial<{
    packId: string;
    replicas: number;
    status: ChaosDeploymentStatus;
  }>
): Promise<DeploymentInfo | undefined> {
  const deployment = deployments.get(deploymentId);
  if (!deployment) return undefined;

  const updated: DeploymentInfo = {
    ...deployment,
    ...updates,
    updatedAt: new Date(),
  };

  deployments.set(deploymentId, updated);
  return updated;
}

/**
 * Delete a deployment
 */
export async function deleteDeployment(deploymentId: string): Promise<boolean> {
  return deployments.delete(deploymentId);
}

/**
 * Get pods for a deployment
 */
export async function getDeploymentPods(deploymentId: string): Promise<Pod[]> {
  return findPodsBySelector({ matchLabels: { deployment: deploymentId } });
}

/**
 * Consolidated deployment queries export
 */
export const deploymentQueries = {
  getDeploymentById,
  listDeployments,
  createDeployment,
  updateDeployment,
  deleteDeployment,
  getDeploymentPods,
};
