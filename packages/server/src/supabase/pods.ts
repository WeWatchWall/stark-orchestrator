/**
 * Pod CRUD Queries
 *
 * Provides database operations for pod entities using Supabase.
 * @module @stark-o/server/supabase/pods
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  Pod,
  PodStatus,
  PodTerminationReason,
  PodListItem,
  PodHistoryEntry,
  PodAction,
  CreatePodInput,
  UpdatePodInput,
  ResourceRequirements,
  Labels,
  Annotations,
} from '@stark-o/shared';
import type { Toleration } from '@stark-o/shared';
import type { NodeAffinity, PodAffinity, PodAntiAffinity } from '@stark-o/shared';
import { getSupabaseClient, getSupabaseServiceClient } from './client.js';

/**
 * Database row type for pods table
 */
interface PodRow {
  id: string;
  pack_id: string;
  pack_version: string;
  node_id: string | null;
  deployment_id: string | null;
  status: PodStatus;
  status_message: string | null;
  termination_reason: PodTerminationReason | null;
  namespace: string;
  labels: Labels;
  annotations: Annotations;
  priority_class_name: string | null;
  priority: number;
  tolerations: Toleration[];
  node_selector: Record<string, string>;
  node_affinity: NodeAffinity | null;
  pod_affinity: PodAffinity | null;
  pod_anti_affinity: PodAntiAffinity | null;
  resource_requests: ResourceRequirements;
  resource_limits: ResourceRequirements;
  created_by: string;
  scheduled_at: string | null;
  started_at: string | null;
  stopped_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Database row type for pod_history table
 */
interface PodHistoryRow {
  id: string;
  pod_id: string;
  action: PodAction;
  actor_id: string | null;
  previous_status: PodStatus | null;
  new_status: PodStatus | null;
  previous_version: string | null;
  new_version: string | null;
  previous_node_id: string | null;
  new_node_id: string | null;
  reason: string | null;
  message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Result type for database operations
 */
export interface PodResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Converts a database row to a Pod entity
 */
function rowToPod(row: PodRow): Pod {
  return {
    id: row.id,
    packId: row.pack_id,
    packVersion: row.pack_version,
    nodeId: row.node_id,
    status: row.status,
    statusMessage: row.status_message ?? undefined,
    terminationReason: row.termination_reason ?? undefined,
    namespace: row.namespace,
    labels: row.labels ?? {},
    annotations: row.annotations ?? {},
    priorityClassName: row.priority_class_name ?? undefined,
    priority: row.priority,
    tolerations: row.tolerations ?? [],
    resourceRequests: row.resource_requests ?? { cpu: 100, memory: 128 },
    resourceLimits: row.resource_limits ?? { cpu: 500, memory: 512 },
    scheduling: {
      nodeSelector: row.node_selector ?? undefined,
      nodeAffinity: row.node_affinity ?? undefined,
      podAffinity: row.pod_affinity ?? undefined,
      podAntiAffinity: row.pod_anti_affinity ?? undefined,
    },
    createdBy: row.created_by,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : undefined,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    stoppedAt: row.stopped_at ? new Date(row.stopped_at) : undefined,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Converts a database row to a PodListItem
 */
function rowToPodListItem(row: PodRow): PodListItem {
  return {
    id: row.id,
    packId: row.pack_id,
    packVersion: row.pack_version,
    nodeId: row.node_id,
    status: row.status,
    statusMessage: row.status_message ?? undefined,
    terminationReason: row.termination_reason ?? undefined,
    namespace: row.namespace,
    labels: row.labels ?? {},
    priority: row.priority,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
  };
}

/**
 * Converts a database row to a PodHistoryEntry
 */
function rowToPodHistoryEntry(row: PodHistoryRow): PodHistoryEntry {
  return {
    id: row.id,
    podId: row.pod_id,
    action: row.action,
    actorId: row.actor_id ?? undefined,
    previousStatus: row.previous_status ?? undefined,
    newStatus: row.new_status ?? undefined,
    previousVersion: row.previous_version ?? undefined,
    newVersion: row.new_version ?? undefined,
    previousNodeId: row.previous_node_id ?? undefined,
    newNodeId: row.new_node_id ?? undefined,
    reason: row.reason ?? undefined,
    message: row.message ?? undefined,
    metadata: row.metadata ?? {},
    timestamp: new Date(row.created_at),
  };
}

/**
 * Pod queries class for interacting with the pods table
 */
export class PodQueries {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseClient();
  }

  /**
   * Creates a new pod in the database
   */
  async createPod(
    input: CreatePodInput,
    createdBy: string,
    deploymentId?: string
  ): Promise<PodResult<Pod>> {
    const defaultResourceRequests = { cpu: 100, memory: 128 };
    const defaultResourceLimits = { cpu: 500, memory: 512 };

    const insertData: Record<string, unknown> = {
      pack_id: input.packId,
      pack_version: input.packVersion ?? 'latest',
      namespace: input.namespace ?? 'default',
      labels: input.labels ?? {},
      annotations: input.annotations ?? {},
      priority_class_name: input.priorityClassName ?? null,
      tolerations: input.tolerations ?? [],
      node_selector: input.scheduling?.nodeSelector ?? {},
      node_affinity: input.scheduling?.nodeAffinity ?? null,
      pod_affinity: input.scheduling?.podAffinity ?? null,
      pod_anti_affinity: input.scheduling?.podAntiAffinity ?? null,
      resource_requests: {
        cpu: input.resourceRequests?.cpu ?? defaultResourceRequests.cpu,
        memory: input.resourceRequests?.memory ?? defaultResourceRequests.memory,
      },
      resource_limits: {
        cpu: input.resourceLimits?.cpu ?? defaultResourceLimits.cpu,
        memory: input.resourceLimits?.memory ?? defaultResourceLimits.memory,
      },
      created_by: createdBy,
      metadata: input.metadata ?? {},
    };

    if (deploymentId) {
      insertData.deployment_id = deploymentId;
    }

    const { data, error } = await this.client
      .from('pods')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPod(data as PodRow), error: null };
  }

  /**
   * Retrieves a pod by its ID
   */
  async getPodById(id: string): Promise<PodResult<Pod>> {
    const { data, error } = await this.client
      .from('pods')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPod(data as PodRow), error: null };
  }

  /**
   * Lists pods with optional filtering
   */
  async listPods(options?: {
    namespace?: string;
    packId?: string;
    nodeId?: string;
    status?: PodStatus | PodStatus[];
    createdBy?: string;
    labelSelector?: Record<string, string>;
    limit?: number;
    offset?: number;
    orderBy?: 'created_at' | 'priority' | 'started_at';
    orderDirection?: 'asc' | 'desc';
  }): Promise<PodResult<PodListItem[]>> {
    let query = this.client
      .from('pods')
      .select('*');

    if (options?.namespace) {
      query = query.eq('namespace', options.namespace);
    }

    if (options?.packId) {
      query = query.eq('pack_id', options.packId);
    }

    if (options?.nodeId) {
      query = query.eq('node_id', options.nodeId);
    }

    if (options?.status) {
      if (Array.isArray(options.status)) {
        query = query.in('status', options.status);
      } else {
        query = query.eq('status', options.status);
      }
    }

    if (options?.createdBy) {
      query = query.eq('created_by', options.createdBy);
    }

    // Label selector: filter by matching labels
    if (options?.labelSelector) {
      for (const [key, value] of Object.entries(options.labelSelector)) {
        query = query.eq(`labels->>${key}`, value);
      }
    }

    const orderBy = options?.orderBy ?? 'created_at';
    const ascending = options?.orderDirection === 'asc';
    query = query.order(orderBy, { ascending });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    const pods = (data as PodRow[]).map(rowToPodListItem);
    return { data: pods, error: null };
  }

  /**
   * Lists active pods (pending, scheduled, starting, running, stopping)
   */
  async listActivePods(options?: {
    namespace?: string;
    nodeId?: string;
  }): Promise<PodResult<PodListItem[]>> {
    return this.listPods({
      ...options,
      status: ['pending', 'scheduled', 'starting', 'running', 'stopping'],
    });
  }

  /**
   * Lists pods pending scheduling
   */
  async listPendingPods(): Promise<PodResult<PodListItem[]>> {
    return this.listPods({
      status: 'pending',
      orderBy: 'priority',
      orderDirection: 'desc',
    });
  }

  /**
   * Lists pods belonging to a deployment
   */
  async listPodsByDeployment(deploymentId: string): Promise<PodResult<PodListItem[]>> {
    const { data, error } = await this.client
      .from('pods')
      .select('*')
      .eq('deployment_id', deploymentId)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: null, error };
    }

    const pods = (data as PodRow[]).map(rowToPodListItem);
    return { data: pods, error: null };
  }

  /**
   * Updates a pod's status and optional fields
   */
  async updatePod(id: string, input: UpdatePodInput): Promise<PodResult<Pod>> {
    const updates: Record<string, unknown> = {};

    if (input.status !== undefined) {
      updates.status = input.status;
    }

    if (input.statusMessage !== undefined) {
      updates.status_message = input.statusMessage;
    }

    if (input.nodeId !== undefined) {
      updates.node_id = input.nodeId;
    }

    if (input.labels !== undefined) {
      updates.labels = input.labels;
    }

    if (input.annotations !== undefined) {
      updates.annotations = input.annotations;
    }

    if (Object.keys(updates).length === 0) {
      return this.getPodById(id);
    }

    const { data, error } = await this.client
      .from('pods')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPod(data as PodRow), error: null };
  }

  /**
   * Updates pod status with timestamp management
   */
  async updatePodStatus(
    id: string,
    status: PodStatus,
    options?: {
      statusMessage?: string;
      terminationReason?: PodTerminationReason;
      nodeId?: string;
    }
  ): Promise<PodResult<Pod>> {
    const updates: Record<string, unknown> = {
      status,
    };

    if (options?.statusMessage !== undefined) {
      updates.status_message = options.statusMessage;
    }

    if (options?.terminationReason !== undefined) {
      updates.termination_reason = options.terminationReason;
    }

    if (options?.nodeId !== undefined) {
      updates.node_id = options.nodeId;
    }

    // Update lifecycle timestamps based on status
    switch (status) {
      case 'scheduled':
        updates.scheduled_at = new Date().toISOString();
        break;
      case 'running':
        updates.started_at = new Date().toISOString();
        break;
      case 'stopped':
      case 'failed':
      case 'evicted':
        updates.stopped_at = new Date().toISOString();
        break;
    }

    const { data, error } = await this.client
      .from('pods')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPod(data as PodRow), error: null };
  }

  /**
   * Schedules a pod to a specific node
   */
  async schedulePod(id: string, nodeId: string): Promise<PodResult<Pod>> {
    return this.updatePodStatus(id, 'scheduled', { nodeId });
  }

  /**
   * Marks a pod as running
   */
  async startPod(id: string): Promise<PodResult<Pod>> {
    return this.updatePodStatus(id, 'running');
  }

  /**
   * Marks a pod as stopped
   */
  async stopPod(id: string, message?: string, terminationReason?: PodTerminationReason): Promise<PodResult<Pod>> {
    return this.updatePodStatus(id, 'stopped', { statusMessage: message, terminationReason });
  }

  /**
   * Marks a pod as failed
   */
  async failPod(id: string, message: string, terminationReason: PodTerminationReason = 'error'): Promise<PodResult<Pod>> {
    return this.updatePodStatus(id, 'failed', { statusMessage: message, terminationReason });
  }

  /**
   * Evicts a pod
   */
  async evictPod(id: string, reason: string, terminationReason: PodTerminationReason = 'evicted_resources'): Promise<PodResult<Pod>> {
    return this.updatePodStatus(id, 'evicted', { statusMessage: reason, terminationReason });
  }

  /**
   * Fails all active pods on a node
   * Used when a node goes offline, becomes unhealthy, or is deleted
   * @param nodeId - The node ID
   * @param reason - Human-readable reason for failing the pods
   * @param terminationReason - Canonical termination reason for crash loop classification
   * @returns Result with count of pods failed
   */
  async failPodsOnNode(
    nodeId: string,
    reason: string,
    terminationReason: PodTerminationReason = 'node_lost',
  ): Promise<PodResult<{ failedCount: number; podIds: string[] }>> {
    // First, get all active pods on the node
    const activeStatuses: PodStatus[] = ['pending', 'scheduled', 'starting', 'running', 'stopping'];
    
    const { data: pods, error: listError } = await this.client
      .from('pods')
      .select('id')
      .eq('node_id', nodeId)
      .in('status', activeStatuses);

    if (listError) {
      return { data: null, error: listError };
    }

    if (!pods || pods.length === 0) {
      return { data: { failedCount: 0, podIds: [] }, error: null };
    }

    const podIds = pods.map((p: { id: string }) => p.id);

    // Update all pods to failed status with canonical termination reason
    const { error: updateError } = await this.client
      .from('pods')
      .update({
        status: 'failed' as PodStatus,
        status_message: reason,
        termination_reason: terminationReason,
        stopped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('node_id', nodeId)
      .in('status', activeStatuses);

    if (updateError) {
      return { data: null, error: updateError };
    }

    return { 
      data: { failedCount: podIds.length, podIds }, 
      error: null,
    };
  }

  /**
   * Rolls back a pod to a different version
   */
  async rollbackPod(
    id: string,
    newPackId: string,
    newVersion: string
  ): Promise<PodResult<Pod>> {
    const { data, error } = await this.client
      .from('pods')
      .update({
        pack_id: newPackId,
        pack_version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPod(data as PodRow), error: null };
  }

  /**
   * Deletes a pod by ID
   */
  async deletePod(id: string): Promise<PodResult<void>> {
    const { error } = await this.client
      .from('pods')
      .delete()
      .eq('id', id);

    return { data: null, error };
  }

  /**
   * Deletes all pods in a namespace
   */
  async deletePodsInNamespace(namespace: string): Promise<PodResult<{ deletedCount: number }>> {
    const { data: pods } = await this.client
      .from('pods')
      .select('id')
      .eq('namespace', namespace);

    const count = pods?.length ?? 0;

    const { error } = await this.client
      .from('pods')
      .delete()
      .eq('namespace', namespace);

    if (error) {
      return { data: null, error };
    }

    return { data: { deletedCount: count }, error: null };
  }

  /**
   * Deletes all pods on a node
   * Used when a node is deleted to clean up orphaned pods
   * @param nodeId - The node ID
   * @returns Result with count of pods deleted and their IDs
   */
  async deletePodsOnNode(
    nodeId: string,
  ): Promise<PodResult<{ deletedCount: number; podIds: string[] }>> {
    // First, get all pods on the node
    const { data: pods, error: listError } = await this.client
      .from('pods')
      .select('id')
      .eq('node_id', nodeId);

    if (listError) {
      return { data: null, error: listError };
    }

    if (!pods || pods.length === 0) {
      return { data: { deletedCount: 0, podIds: [] }, error: null };
    }

    const podIds = pods.map((p: { id: string }) => p.id);

    // Delete all pods on the node
    const { error: deleteError } = await this.client
      .from('pods')
      .delete()
      .eq('node_id', nodeId);

    if (deleteError) {
      return { data: null, error: deleteError };
    }

    return { 
      data: { deletedCount: podIds.length, podIds }, 
      error: null,
    };
  }

  /**
   * Counts pods matching the given criteria
   */
  async countPods(options?: {
    namespace?: string;
    packId?: string;
    nodeId?: string;
    status?: PodStatus | PodStatus[];
  }): Promise<PodResult<number>> {
    let query = this.client
      .from('pods')
      .select('*', { count: 'exact', head: true });

    if (options?.namespace) {
      query = query.eq('namespace', options.namespace);
    }

    if (options?.packId) {
      query = query.eq('pack_id', options.packId);
    }

    if (options?.nodeId) {
      query = query.eq('node_id', options.nodeId);
    }

    if (options?.status) {
      if (Array.isArray(options.status)) {
        query = query.in('status', options.status);
      } else {
        query = query.eq('status', options.status);
      }
    }

    const { count, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return { data: count ?? 0, error: null };
  }

  // =========================================================================
  // Pod History Operations
  // =========================================================================

  /**
   * Creates a history entry for a pod action
   */
  async createPodHistory(entry: {
    podId: string;
    action: PodAction;
    actorId?: string;
    previousStatus?: PodStatus;
    newStatus?: PodStatus;
    previousVersion?: string;
    newVersion?: string;
    previousNodeId?: string;
    newNodeId?: string;
    reason?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PodResult<PodHistoryEntry>> {
    const { data, error } = await this.client
      .from('pod_history')
      .insert({
        pod_id: entry.podId,
        action: entry.action,
        actor_id: entry.actorId ?? null,
        previous_status: entry.previousStatus ?? null,
        new_status: entry.newStatus ?? null,
        previous_version: entry.previousVersion ?? null,
        new_version: entry.newVersion ?? null,
        previous_node_id: entry.previousNodeId ?? null,
        new_node_id: entry.newNodeId ?? null,
        reason: entry.reason ?? null,
        message: entry.message ?? null,
        metadata: entry.metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPodHistoryEntry(data as PodHistoryRow), error: null };
  }

  /**
   * Gets the history for a pod
   */
  async getPodHistory(
    podId: string,
    options?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<PodResult<PodHistoryEntry[]>> {
    let query = this.client
      .from('pod_history')
      .select('*')
      .eq('pod_id', podId)
      .order('timestamp', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
    }

    const { data, error } = await query;

    if (error) {
      return { data: null, error };
    }

    const entries = (data as PodHistoryRow[]).map(rowToPodHistoryEntry);
    return { data: entries, error: null };
  }

  /**
   * Gets the latest history entry for a pod
   */
  async getLatestPodHistoryEntry(podId: string): Promise<PodResult<PodHistoryEntry>> {
    const { data, error } = await this.client
      .from('pod_history')
      .select('*')
      .eq('pod_id', podId)
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToPodHistoryEntry(data as PodHistoryRow), error: null };
  }
}

/**
 * Singleton instance using the default client
 */
let _podQueries: PodQueries | null = null;

/**
 * Gets or creates the default PodQueries instance
 */
export function getPodQueries(): PodQueries {
  if (!_podQueries) {
    _podQueries = new PodQueries();
  }
  return _podQueries;
}

/**
 * Creates a PodQueries instance with service role (admin) privileges
 * Use for administrative operations that bypass RLS
 */
export function getPodQueriesAdmin(): PodQueries {
  return new PodQueries(getSupabaseServiceClient());
}

/**
 * Resets singleton instances (useful for testing)
 */
export function resetPodQueries(): void {
  _podQueries = null;
}

// Export convenience functions that use the default instance
export const createPod = (
  input: CreatePodInput,
  createdBy: string,
  deploymentId?: string
) => getPodQueries().createPod(input, createdBy, deploymentId);

export const getPodById = (id: string) =>
  getPodQueries().getPodById(id);

export const listPods = (options?: Parameters<PodQueries['listPods']>[0]) =>
  getPodQueries().listPods(options);

export const listActivePods = (options?: Parameters<PodQueries['listActivePods']>[0]) =>
  getPodQueries().listActivePods(options);

export const listPendingPods = () =>
  getPodQueries().listPendingPods();

export const updatePod = (id: string, input: UpdatePodInput) =>
  getPodQueries().updatePod(id, input);

export const updatePodStatus = (
  id: string,
  status: PodStatus,
  options?: Parameters<PodQueries['updatePodStatus']>[2]
) => getPodQueries().updatePodStatus(id, status, options);

export const schedulePod = (id: string, nodeId: string) =>
  getPodQueries().schedulePod(id, nodeId);

export const startPod = (id: string) =>
  getPodQueries().startPod(id);

export const stopPod = (id: string, message?: string, terminationReason?: PodTerminationReason) =>
  getPodQueries().stopPod(id, message, terminationReason);

export const failPod = (id: string, message: string, terminationReason?: PodTerminationReason) =>
  getPodQueries().failPod(id, message, terminationReason);

export const evictPod = (id: string, reason: string, terminationReason?: PodTerminationReason) =>
  getPodQueries().evictPod(id, reason, terminationReason);

export const failPodsOnNode = (nodeId: string, reason: string, terminationReason?: PodTerminationReason) =>
  getPodQueries().failPodsOnNode(nodeId, reason, terminationReason);

export const deletePod = (id: string) =>
  getPodQueries().deletePod(id);

export const deletePodsInNamespace = (namespace: string) =>
  getPodQueries().deletePodsInNamespace(namespace);

export const deletePodsOnNode = (nodeId: string) =>
  getPodQueries().deletePodsOnNode(nodeId);

export const countPods = (options?: Parameters<PodQueries['countPods']>[0]) =>
  getPodQueries().countPods(options);

export const createPodHistory = (entry: Parameters<PodQueries['createPodHistory']>[0]) =>
  getPodQueries().createPodHistory(entry);

export const getPodHistory = (podId: string, options?: Parameters<PodQueries['getPodHistory']>[1]) =>
  getPodQueries().getPodHistory(podId, options);

export const getLatestPodHistoryEntry = (podId: string) =>
  getPodQueries().getLatestPodHistoryEntry(podId);
