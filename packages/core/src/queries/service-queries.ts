/**
 * Service Query Functions
 *
 * Provides query functions for services that can be used by chaos scenarios
 * and other services.
 * @module @stark-o/core/queries/service-queries
 */

import { findPodsBySelector } from '../stores/pod-store';
import type { Pod, ServiceStatus as SharedServiceStatus } from '@stark-o/shared';

// Note: Services are managed by the server's service controller
// This module provides query helpers that work with the cluster state

/**
 * Chaos service status type (extended for testing scenarios)
 * This extends the shared ServiceStatus with additional states for chaos testing
 */
export type ChaosServiceStatus =
  | SharedServiceStatus
  | 'pending'
  | 'progressing'
  | 'available'
  | 'failed';

/**
 * Extended service info
 */
export interface ServiceInfo {
  id: string;
  name: string;
  namespace: string;
  packId: string;
  replicas: number;
  availableReplicas: number;
  status: ChaosServiceStatus;
  createdAt: Date;
  updatedAt: Date;
}

// In-memory service store for chaos testing
// In production, this would be backed by Supabase
const services = new Map<string, ServiceInfo>();

/**
 * Get a service by ID
 */
export async function getServiceById(
  serviceId: string
): Promise<ServiceInfo | undefined> {
  return services.get(serviceId);
}

/**
 * List services with optional filters
 */
export async function listServices(options?: {
  limit?: number;
  namespace?: string;
  status?: ChaosServiceStatus;
}): Promise<ServiceInfo[]> {
  let result = Array.from(services.values());

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
 * Create a new service
 */
export async function createService(spec: {
  name: string;
  packId: string;
  namespace?: string;
  replicas?: number;
}): Promise<ServiceInfo> {
  const id = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();

  const service: ServiceInfo = {
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

  services.set(id, service);
  return service;
}

/**
 * Update a service
 */
export async function updateService(
  serviceId: string,
  updates: Partial<{
    packId: string;
    replicas: number;
    status: ChaosServiceStatus;
  }>
): Promise<ServiceInfo | undefined> {
  const service = services.get(serviceId);
  if (!service) return undefined;

  const updated: ServiceInfo = {
    ...service,
    ...updates,
    updatedAt: new Date(),
  };

  services.set(serviceId, updated);
  return updated;
}

/**
 * Delete a service
 */
export async function deleteService(serviceId: string): Promise<boolean> {
  return services.delete(serviceId);
}

/**
 * Get pods for a service
 */
export async function getServicePods(serviceId: string): Promise<Pod[]> {
  return findPodsBySelector({ matchLabels: { service: serviceId } });
}

/**
 * Consolidated service queries export
 */
export const serviceQueries = {
  getServiceById,
  listServices,
  createService,
  updateService,
  deleteService,
  getServicePods,
};
