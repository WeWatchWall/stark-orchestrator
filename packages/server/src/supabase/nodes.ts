/**
 * Node CRUD Queries
 *
 * Provides database operations for node entities using Supabase.
 * @module @stark-o/server/supabase/nodes
 */

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js';
import type {
  Node,
  NodeStatus,
  RuntimeType,
  NodeCapabilities,
  AllocatableResources,
  RegisterNodeInput,
  UpdateNodeInput,
  NodeListItem,
} from '@stark-o/shared';
import type { Labels, Annotations } from '@stark-o/shared';
import type { Taint } from '@stark-o/shared';
import { getSupabaseServiceClient } from './client.js';
import { DEFAULT_ALLOCATABLE, DEFAULT_ALLOCATED } from '@stark-o/shared';

/**
 * Database row type for nodes table
 */
interface NodeRow {
  id: string;
  name: string;
  runtime_type: RuntimeType;
  status: NodeStatus;
  last_heartbeat: string | null;
  capabilities: NodeCapabilities;
  registered_by: string | null;
  connection_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  allocatable: AllocatableResources;
  allocated: AllocatableResources;
  labels: Labels;
  annotations: Annotations;
  taints: Taint[];
  unschedulable: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Result type for database operations
 */
export interface NodeResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/**
 * Converts a database row to a Node entity
 */
function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    name: row.name,
    runtimeType: row.runtime_type,
    status: row.status,
    lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : undefined,
    capabilities: row.capabilities ?? {},
    registeredBy: row.registered_by ?? undefined,
    connectionId: row.connection_id ?? undefined,
    ipAddress: row.ip_address ?? undefined,
    userAgent: row.user_agent ?? undefined,
    allocatable: row.allocatable ?? DEFAULT_ALLOCATABLE,
    allocated: row.allocated ?? DEFAULT_ALLOCATED,
    labels: row.labels ?? {},
    annotations: row.annotations ?? {},
    taints: row.taints ?? [],
    unschedulable: row.unschedulable ?? false,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Converts a database row to a NodeListItem
 */
function rowToNodeListItem(row: NodeRow & { pod_count?: number }): NodeListItem {
  return {
    id: row.id,
    name: row.name,
    runtimeType: row.runtime_type,
    status: row.status,
    lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : undefined,
    labels: row.labels ?? {},
    allocatable: row.allocatable ?? DEFAULT_ALLOCATABLE,
    allocated: row.allocated ?? DEFAULT_ALLOCATED,
    podCount: row.pod_count ?? 0,
    connectionId: row.connection_id ?? undefined,
    registeredBy: row.registered_by ?? undefined,
  };
}

/**
 * Node queries class for interacting with the nodes table
 */
export class NodeQueries {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseServiceClient();
  }

  /**
   * Creates a new node in the database
   */
  async createNode(
    input: RegisterNodeInput & { registeredBy?: string; connectionId?: string }
  ): Promise<NodeResult<Node>> {
    const { data, error } = await this.client
      .from('nodes')
      .insert({
        name: input.name,
        runtime_type: input.runtimeType,
        status: 'online' as NodeStatus,
        capabilities: input.capabilities ?? {},
        registered_by: input.registeredBy ?? null,
        connection_id: input.connectionId ?? null,
        allocatable: { ...DEFAULT_ALLOCATABLE, ...input.allocatable },
        allocated: DEFAULT_ALLOCATED,
        labels: input.labels ?? {},
        annotations: input.annotations ?? {},
        taints: input.taints ?? [],
        unschedulable: false,
      })
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNode(data as NodeRow), error: null };
  }

  /**
   * Retrieves a node by its ID
   */
  async getNodeById(id: string): Promise<NodeResult<Node>> {
    const { data, error } = await this.client
      .from('nodes')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNode(data as NodeRow), error: null };
  }

  /**
   * Retrieves a node by name
   */
  async getNodeByName(name: string): Promise<NodeResult<Node>> {
    const { data, error } = await this.client
      .from('nodes')
      .select('*')
      .eq('name', name)
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNode(data as NodeRow), error: null };
  }

  /**
   * Check if a node with the given name exists
   */
  async nodeExists(name: string): Promise<NodeResult<boolean>> {
    const { count, error } = await this.client
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('name', name);

    if (error) {
      return { data: null, error };
    }

    return { data: (count ?? 0) > 0, error: null };
  }

  /**
   * Lists all nodes with optional filtering
   */
  async listNodes(options?: {
    runtimeType?: RuntimeType;
    status?: NodeStatus;
    search?: string;
    connectionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<NodeResult<NodeListItem[]>> {
    let query = this.client.from('nodes').select('*');

    if (options?.runtimeType) {
      query = query.eq('runtime_type', options.runtimeType);
    }

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.search) {
      query = query.ilike('name', `%${options.search}%`);
    }

    if (options?.connectionId) {
      query = query.eq('connection_id', options.connectionId);
    }

    query = query.order('created_at', { ascending: false });

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

    const items = (data as NodeRow[]).map((row) => rowToNodeListItem(row));
    return { data: items, error: null };
  }

  /**
   * Counts nodes with optional filtering
   */
  async countNodes(options?: {
    runtimeType?: RuntimeType;
    status?: NodeStatus;
    search?: string;
  }): Promise<NodeResult<number>> {
    let query = this.client.from('nodes').select('id', { count: 'exact', head: true });

    if (options?.runtimeType) {
      query = query.eq('runtime_type', options.runtimeType);
    }

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.search) {
      query = query.ilike('name', `%${options.search}%`);
    }

    const { count, error } = await query;

    if (error) {
      return { data: null, error };
    }

    return { data: count ?? 0, error: null };
  }

  /**
   * Updates a node's fields
   */
  async updateNode(id: string, input: UpdateNodeInput): Promise<NodeResult<Node>> {
    const updates: Record<string, unknown> = {};

    if (input.status !== undefined) {
      updates.status = input.status;
    }

    if (input.capabilities !== undefined) {
      updates.capabilities = input.capabilities;
    }

    if (input.allocatable !== undefined) {
      updates.allocatable = input.allocatable;
    }

    if (input.labels !== undefined) {
      updates.labels = input.labels;
    }

    if (input.annotations !== undefined) {
      updates.annotations = input.annotations;
    }

    if (input.taints !== undefined) {
      updates.taints = input.taints;
    }

    if (input.unschedulable !== undefined) {
      updates.unschedulable = input.unschedulable;
    }

    if (Object.keys(updates).length === 0) {
      // No updates, just fetch and return current state
      return this.getNodeById(id);
    }

    const { data, error } = await this.client
      .from('nodes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNode(data as NodeRow), error: null };
  }

  /**
   * Updates node heartbeat
   */
  async updateHeartbeat(
    id: string,
    allocated?: Partial<AllocatableResources>,
    status?: NodeStatus
  ): Promise<NodeResult<void>> {
    const updates: Record<string, unknown> = {
      last_heartbeat: new Date().toISOString(),
      status: status ?? 'online',
    };

    if (allocated) {
      updates.allocated = allocated;
    }

    const { error } = await this.client.from('nodes').update(updates).eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: undefined, error: null };
  }

  /**
   * Deletes a node by ID
   */
  async deleteNode(id: string): Promise<NodeResult<void>> {
    const { error } = await this.client.from('nodes').delete().eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: undefined, error: null };
  }

  /**
   * Sets node status
   */
  async setNodeStatus(id: string, status: NodeStatus): Promise<NodeResult<void>> {
    const { error } = await this.client.from('nodes').update({ status }).eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: undefined, error: null };
  }

  /**
   * Clears node connection ID (used on disconnect)
   */
  async clearConnectionId(id: string): Promise<NodeResult<void>> {
    const { error } = await this.client
      .from('nodes')
      .update({ connection_id: null })
      .eq('id', id);

    if (error) {
      return { data: null, error };
    }

    return { data: undefined, error: null };
  }

  /**
   * Updates node connection ID and sets status to online (used on reconnect)
   */
  async reconnectNode(id: string, connectionId: string): Promise<NodeResult<Node>> {
    const { data, error } = await this.client
      .from('nodes')
      .update({
        connection_id: connectionId,
        status: 'online' as NodeStatus,
        last_heartbeat: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    return { data: rowToNode(data as NodeRow), error: null };
  }
}

/**
 * Singleton instance of NodeQueries
 */
let nodeQueriesInstance: NodeQueries | null = null;

/**
 * Get the node queries singleton
 */
export function getNodeQueries(): NodeQueries {
  if (!nodeQueriesInstance) {
    nodeQueriesInstance = new NodeQueries();
  }
  return nodeQueriesInstance;
}

/**
 * Reset node queries singleton (for testing)
 */
export function resetNodeQueries(): void {
  nodeQueriesInstance = null;
}
