/**
 * Service CRUD Queries
 *
 * Provides database operations for service entities using Supabase.
 * @module @stark-o/server/supabase/services
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  Service,
  ServiceStatus,
  ServiceListItem,
  CreateServiceInput,
  UpdateServiceInput,
  ResourceRequirements,
  Labels,
  Annotations,
  Toleration,
  PodSchedulingConfig,
} from '@stark-o/shared';
import { getSupabaseClient, getSupabaseServiceClient } from './client.js';

/**
 * Database row type for services table
 */
interface ServiceRow {
  id: string;
  name: string;
  pack_id: string;
  pack_version: string;
  follow_latest: boolean;
  namespace: string;
  replicas: number;
  status: ServiceStatus;
  status_message: string | null;
  labels: Labels;
  annotations: Annotations;
  pod_labels: Labels;
  pod_annotations: Annotations;
  priority_class_name: string | null;
  priority: number;
  tolerations: Toleration[];
  resource_requests: ResourceRequirements;
  resource_limits: ResourceRequirements;
  scheduling: PodSchedulingConfig | null;
  observed_generation: number;
  ready_replicas: number;
  available_replicas: number;
  updated_replicas: number;
  last_successful_version: string | null;
  failed_version: string | null;
  consecutive_failures: number;
  failure_backoff_until: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Result type for database operations
 */
export interface ServiceResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Converts a database row to a Service entity
 */
function rowToService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name,
    packId: row.pack_id,
    packVersion: row.pack_version,
    followLatest: row.follow_latest ?? false,
    namespace: row.namespace,
    replicas: row.replicas,
    status: row.status,
    statusMessage: row.status_message ?? undefined,
    labels: row.labels ?? {},
    annotations: row.annotations ?? {},
    podLabels: row.pod_labels ?? {},
    podAnnotations: row.pod_annotations ?? {},
    priorityClassName: row.priority_class_name ?? undefined,
    priority: row.priority,
    tolerations: row.tolerations ?? [],
    resourceRequests: row.resource_requests ?? { cpu: 100, memory: 128 },
    resourceLimits: row.resource_limits ?? { cpu: 500, memory: 512 },
    scheduling: row.scheduling ?? undefined,
    observedGeneration: row.observed_generation,
    readyReplicas: row.ready_replicas,
    availableReplicas: row.available_replicas,
    updatedReplicas: row.updated_replicas,
    lastSuccessfulVersion: row.last_successful_version ?? undefined,
    failedVersion: row.failed_version ?? undefined,
    consecutiveFailures: row.consecutive_failures ?? 0,
    failureBackoffUntil: row.failure_backoff_until ? new Date(row.failure_backoff_until) : undefined,
    metadata: row.metadata ?? {},
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Converts a database row to a ServiceListItem
 */
function rowToServiceListItem(row: ServiceRow): ServiceListItem {
  return {
    id: row.id,
    name: row.name,
    packId: row.pack_id,
    packVersion: row.pack_version,
    followLatest: row.follow_latest ?? false,
    namespace: row.namespace,
    replicas: row.replicas,
    readyReplicas: row.ready_replicas,
    availableReplicas: row.available_replicas,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Service queries using authenticated user context
 */
export class ServiceQueries {
  constructor(private client: SupabaseClient) {}

  /**
   * Create a new service
   */
  async createService(
    input: CreateServiceInput,
    packId: string,
    packVersion: string,
    createdBy: string
  ): Promise<ServiceResult<Service>> {
    const { data, error } = await this.client
      .from('services')
      .insert({
        name: input.name,
        pack_id: packId,
        pack_version: packVersion,
        follow_latest: input.followLatest ?? false,
        namespace: input.namespace ?? 'default',
        replicas: input.replicas ?? 1, // Default to 1 replica
        status: 'active',
        labels: input.labels ?? {},
        annotations: input.annotations ?? {},
        pod_labels: input.podLabels ?? {},
        pod_annotations: input.podAnnotations ?? {},
        priority_class_name: input.priorityClassName ?? null,
        priority: 100,
        tolerations: input.tolerations ?? [],
        resource_requests: {
          cpu: input.resourceRequests?.cpu ?? 100,
          memory: input.resourceRequests?.memory ?? 128,
        },
        resource_limits: {
          cpu: input.resourceLimits?.cpu ?? 500,
          memory: input.resourceLimits?.memory ?? 512,
        },
        scheduling: input.scheduling ?? null,
        metadata: input.metadata ?? {},
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToService(data as ServiceRow), error: null };
  }

  /**
   * Get service by ID
   */
  async getServiceById(id: string): Promise<ServiceResult<Service>> {
    const { data, error } = await this.client
      .from('services')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToService(data as ServiceRow), error: null };
  }

  /**
   * Get service by name and namespace
   */
  async getServiceByName(
    name: string,
    namespace: string = 'default'
  ): Promise<ServiceResult<Service>> {
    const { data, error } = await this.client
      .from('services')
      .select('*')
      .eq('name', name)
      .eq('namespace', namespace)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToService(data as ServiceRow), error: null };
  }

  /**
   * List services with optional filters
   */
  async listServices(filters?: {
    namespace?: string;
    status?: ServiceStatus;
    packId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ServiceResult<ServiceListItem[]>> {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.client
      .from('services')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (filters?.namespace) {
      query = query.eq('namespace', filters.namespace);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.packId) {
      query = query.eq('pack_id', filters.packId);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    const services = (data as ServiceRow[]).map(rowToServiceListItem);
    return { data: services, error: null };
  }

  /**
   * List all active services (for reconciliation)
   */
  async listActiveServices(): Promise<ServiceResult<Service[]>> {
    const { data, error } = await this.client
      .from('services')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    const services = (data as ServiceRow[]).map(rowToService);
    return { data: services, error: null };
  }

  /**
   * List active services that follow latest pack version
   * Used for auto-update reconciliation when new pack versions are registered
   */
  async listFollowLatestServices(): Promise<ServiceResult<Service[]>> {
    const { data, error } = await this.client
      .from('services')
      .select('*')
      .eq('status', 'active')
      .eq('follow_latest', true)
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    const services = (data as ServiceRow[]).map(rowToService);
    return { data: services, error: null };
  }

  /**
   * List active services by pack ID that follow latest
   * Used to quickly find services affected by a specific pack version update
   */
  async listFollowLatestServicesByPackId(packId: string): Promise<ServiceResult<Service[]>> {
    const { data, error } = await this.client
      .from('services')
      .select('*')
      .eq('status', 'active')
      .eq('pack_id', packId)
      .eq('follow_latest', true)
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    const services = (data as ServiceRow[]).map(rowToService);
    return { data: services, error: null };
  }

  /**
   * Update service
   */
  async updateService(
    id: string,
    input: UpdateServiceInput
  ): Promise<ServiceResult<Service>> {
    const updates: Partial<Record<string, unknown>> = {};

    if (input.packVersion !== undefined) {
      updates.pack_version = input.packVersion;
    }
    if (input.followLatest !== undefined) {
      updates.follow_latest = input.followLatest;
    }
    if (input.replicas !== undefined) {
      updates.replicas = input.replicas;
    }
    if (input.status !== undefined) {
      updates.status = input.status;
    }
    if (input.statusMessage !== undefined) {
      updates.status_message = input.statusMessage;
    }
    if (input.labels !== undefined) {
      updates.labels = input.labels;
    }
    if (input.annotations !== undefined) {
      updates.annotations = input.annotations;
    }
    if (input.podLabels !== undefined) {
      updates.pod_labels = input.podLabels;
    }
    if (input.podAnnotations !== undefined) {
      updates.pod_annotations = input.podAnnotations;
    }
    if (input.priorityClassName !== undefined) {
      updates.priority_class_name = input.priorityClassName;
    }
    if (input.tolerations !== undefined) {
      updates.tolerations = input.tolerations;
    }
    if (input.resourceRequests !== undefined) {
      updates.resource_requests = input.resourceRequests;
    }
    if (input.resourceLimits !== undefined) {
      updates.resource_limits = input.resourceLimits;
    }
    if (input.scheduling !== undefined) {
      updates.scheduling = input.scheduling;
    }
    if (input.metadata !== undefined) {
      updates.metadata = input.metadata;
    }
    // Crash-loop protection fields
    if (input.lastSuccessfulVersion !== undefined) {
      updates.last_successful_version = input.lastSuccessfulVersion;
    }
    if (input.failedVersion !== undefined) {
      updates.failed_version = input.failedVersion;
    }
    if (input.consecutiveFailures !== undefined) {
      updates.consecutive_failures = input.consecutiveFailures;
    }
    if (input.failureBackoffUntil !== undefined) {
      updates.failure_backoff_until = input.failureBackoffUntil?.toISOString() ?? null;
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await this.client
      .from('services')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToService(data as ServiceRow), error: null };
  }

  /**
   * Update service replica counts
   */
  async updateReplicaCounts(
    id: string,
    ready: number,
    available: number,
    updated: number
  ): Promise<ServiceResult<Service>> {
    const { data, error } = await this.client
      .from('services')
      .update({
        ready_replicas: ready,
        available_replicas: available,
        updated_replicas: updated,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToService(data as ServiceRow), error: null };
  }

  /**
   * Delete service
   */
  async deleteService(id: string): Promise<ServiceResult<{ deleted: boolean }>> {
    const { error } = await this.client
      .from('services')
      .delete()
      .eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: true }, error: null };
  }
}

/**
 * Get service queries with authenticated client
 */
export function getServiceQueries(): ServiceQueries {
  return new ServiceQueries(getSupabaseClient());
}

/**
 * Get service queries with service (admin) client
 */
export function getServiceQueriesAdmin(): ServiceQueries {
  return new ServiceQueries(getSupabaseServiceClient());
}
