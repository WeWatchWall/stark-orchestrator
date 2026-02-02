/**
 * Deployment CRUD Queries
 *
 * Provides database operations for deployment entities using Supabase.
 * @module @stark-o/server/supabase/deployments
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  Deployment,
  DeploymentStatus,
  DeploymentListItem,
  CreateDeploymentInput,
  UpdateDeploymentInput,
  ResourceRequirements,
  Labels,
  Annotations,
  Toleration,
  PodSchedulingConfig,
} from '@stark-o/shared';
import { getSupabaseClient, getSupabaseServiceClient } from './client.js';

/**
 * Database row type for deployments table
 */
interface DeploymentRow {
  id: string;
  name: string;
  pack_id: string;
  pack_version: string;
  follow_latest: boolean;
  namespace: string;
  replicas: number;
  status: DeploymentStatus;
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
export interface DeploymentResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Converts a database row to a Deployment entity
 */
function rowToDeployment(row: DeploymentRow): Deployment {
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
 * Converts a database row to a DeploymentListItem
 */
function rowToDeploymentListItem(row: DeploymentRow): DeploymentListItem {
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
 * Deployment queries using authenticated user context
 */
export class DeploymentQueries {
  constructor(private client: SupabaseClient) {}

  /**
   * Create a new deployment
   */
  async createDeployment(
    input: CreateDeploymentInput,
    packId: string,
    packVersion: string,
    createdBy: string
  ): Promise<DeploymentResult<Deployment>> {
    const { data, error } = await this.client
      .from('deployments')
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

    return { data: rowToDeployment(data as DeploymentRow), error: null };
  }

  /**
   * Get deployment by ID
   */
  async getDeploymentById(id: string): Promise<DeploymentResult<Deployment>> {
    const { data, error } = await this.client
      .from('deployments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToDeployment(data as DeploymentRow), error: null };
  }

  /**
   * Get deployment by name and namespace
   */
  async getDeploymentByName(
    name: string,
    namespace: string = 'default'
  ): Promise<DeploymentResult<Deployment>> {
    const { data, error } = await this.client
      .from('deployments')
      .select('*')
      .eq('name', name)
      .eq('namespace', namespace)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToDeployment(data as DeploymentRow), error: null };
  }

  /**
   * List deployments with optional filters
   */
  async listDeployments(filters?: {
    namespace?: string;
    status?: DeploymentStatus;
    packId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<DeploymentResult<DeploymentListItem[]>> {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = this.client
      .from('deployments')
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

    const deployments = (data as DeploymentRow[]).map(rowToDeploymentListItem);
    return { data: deployments, error: null };
  }

  /**
   * List all active deployments (for reconciliation)
   */
  async listActiveDeployments(): Promise<DeploymentResult<Deployment[]>> {
    const { data, error } = await this.client
      .from('deployments')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    const deployments = (data as DeploymentRow[]).map(rowToDeployment);
    return { data: deployments, error: null };
  }

  /**
   * List active deployments that follow latest pack version
   * Used for auto-update reconciliation when new pack versions are registered
   */
  async listFollowLatestDeployments(): Promise<DeploymentResult<Deployment[]>> {
    const { data, error } = await this.client
      .from('deployments')
      .select('*')
      .eq('status', 'active')
      .eq('follow_latest', true)
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    const deployments = (data as DeploymentRow[]).map(rowToDeployment);
    return { data: deployments, error: null };
  }

  /**
   * List active deployments by pack ID that follow latest
   * Used to quickly find deployments affected by a specific pack version update
   */
  async listFollowLatestDeploymentsByPackId(packId: string): Promise<DeploymentResult<Deployment[]>> {
    const { data, error } = await this.client
      .from('deployments')
      .select('*')
      .eq('status', 'active')
      .eq('pack_id', packId)
      .eq('follow_latest', true)
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error };
    }

    const deployments = (data as DeploymentRow[]).map(rowToDeployment);
    return { data: deployments, error: null };
  }

  /**
   * Update deployment
   */
  async updateDeployment(
    id: string,
    input: UpdateDeploymentInput
  ): Promise<DeploymentResult<Deployment>> {
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
      .from('deployments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToDeployment(data as DeploymentRow), error: null };
  }

  /**
   * Update deployment replica counts
   */
  async updateReplicaCounts(
    id: string,
    ready: number,
    available: number,
    updated: number
  ): Promise<DeploymentResult<Deployment>> {
    const { data, error } = await this.client
      .from('deployments')
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

    return { data: rowToDeployment(data as DeploymentRow), error: null };
  }

  /**
   * Delete deployment
   */
  async deleteDeployment(id: string): Promise<DeploymentResult<{ deleted: boolean }>> {
    const { error } = await this.client
      .from('deployments')
      .delete()
      .eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: { deleted: true }, error: null };
  }
}

/**
 * Get deployment queries with authenticated client
 */
export function getDeploymentQueries(): DeploymentQueries {
  return new DeploymentQueries(getSupabaseClient());
}

/**
 * Get deployment queries with service (admin) client
 */
export function getDeploymentQueriesAdmin(): DeploymentQueries {
  return new DeploymentQueries(getSupabaseServiceClient());
}
