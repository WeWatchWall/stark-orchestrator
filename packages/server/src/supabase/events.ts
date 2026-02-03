/**
 * Event Service
 *
 * Provides unified event emission and querying for the Stark Orchestrator.
 * Events are first-class data for debugging, UI timelines, and audits.
 * @module @stark-o/server/supabase/events
 */

import type {
  StarkEvent,
  EventCategory,
  EventSeverity,
  StarkEventType,
  EventActorType,
  EventSource,
  EmitPodEventInput,
  EmitNodeEventInput,
  EmitEventInput,
  EventQueryOptions,
  EventQueryResult,
  EventTimelineItem,
} from '@stark-o/shared';
import { getDefaultSeverity, getCategoryFromEventType, createServiceLogger } from '@stark-o/shared';
import { getSupabaseClient, getSupabaseServiceClient } from './client.js';

/**
 * Logger for event service
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'event-service' });

// ============================================================================
// Database Event Interface
// ============================================================================

interface DbEvent {
  id: string;
  event_type: string;
  category: EventCategory;
  severity: EventSeverity;
  resource_id: string | null;
  resource_type: string | null;
  resource_name: string | null;
  namespace: string;
  actor_id: string | null;
  actor_type: string;
  reason: string | null;
  message: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  related_resource_id: string | null;
  related_resource_type: string | null;
  related_resource_name: string | null;
  metadata: Record<string, unknown>;
  source: string;
  correlation_id: string | null;
  created_at: string;
}

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Map database event to StarkEvent
 */
function mapDbEventToStarkEvent(db: DbEvent): StarkEvent {
  return {
    id: db.id,
    eventType: db.event_type as StarkEventType,
    category: db.category,
    severity: db.severity,
    resourceId: db.resource_id ?? undefined,
    resourceType: db.resource_type ?? undefined,
    resourceName: db.resource_name ?? undefined,
    namespace: db.namespace,
    actorId: db.actor_id ?? undefined,
    actorType: (db.actor_type as EventActorType) ?? 'system',
    reason: db.reason ?? undefined,
    message: db.message ?? undefined,
    previousState: db.previous_state ?? undefined,
    newState: db.new_state ?? undefined,
    relatedResourceId: db.related_resource_id ?? undefined,
    relatedResourceType: db.related_resource_type ?? undefined,
    relatedResourceName: db.related_resource_name ?? undefined,
    metadata: db.metadata ?? {},
    source: (db.source as EventSource) ?? 'server',
    correlationId: db.correlation_id ?? undefined,
    timestamp: new Date(db.created_at),
  };
}

/**
 * Map database event to timeline item (lightweight for UI)
 */
function mapDbEventToTimelineItem(db: DbEvent): EventTimelineItem {
  return {
    id: db.id,
    eventType: db.event_type as StarkEventType,
    category: db.category,
    severity: db.severity,
    resourceType: db.resource_type ?? undefined,
    resourceName: db.resource_name ?? undefined,
    reason: db.reason ?? undefined,
    message: db.message ?? undefined,
    timestamp: new Date(db.created_at),
  };
}

// ============================================================================
// Event Emission
// ============================================================================

export interface EventServiceOptions {
  /** Use admin client to bypass RLS */
  useAdmin?: boolean;
}

/**
 * Get the appropriate Supabase client
 */
function getClient(useAdmin?: boolean) {
  return useAdmin ? getSupabaseServiceClient() : getSupabaseClient();
}

/**
 * Emit a generic event
 */
export async function emitEvent(
  input: EmitEventInput,
  options?: EventServiceOptions
): Promise<{ id: string | null; error: Error | null }> {
  const client = getClient(options?.useAdmin);
  
  const severity = input.severity ?? getDefaultSeverity(input.eventType);
  const category = input.category ?? getCategoryFromEventType(input.eventType);
  
  try {
    const { data, error } = await client.rpc('emit_event', {
      p_event_type: input.eventType,
      p_category: category,
      p_resource_id: input.resourceId ?? null,
      p_resource_type: input.resourceType ?? null,
      p_resource_name: input.resourceName ?? null,
      p_severity: severity,
      p_namespace: input.namespace ?? 'default',
      p_actor_id: input.actorId ?? null,
      p_actor_type: input.actorType ?? 'system',
      p_reason: input.reason ?? null,
      p_message: input.message ?? null,
      p_previous_state: input.previousState ?? null,
      p_new_state: input.newState ?? null,
      p_related_resource_id: input.relatedResourceId ?? null,
      p_related_resource_type: input.relatedResourceType ?? null,
      p_related_resource_name: input.relatedResourceName ?? null,
      p_metadata: input.metadata ?? {},
      p_source: input.source ?? 'server',
      p_correlation_id: input.correlationId ?? null,
    });

    if (error) {
      logger.error('Failed to emit event', undefined, { eventType: input.eventType, error });
      return { id: null, error: new Error(error.message) };
    }

    logger.debug('Event emitted', { eventType: input.eventType, id: data, resourceId: input.resourceId });
    return { id: data as string, error: null };
  } catch (err) {
    logger.error('Exception emitting event', undefined, { eventType: input.eventType, error: err });
    return { id: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Emit a pod event
 */
export async function emitPodEvent(
  input: EmitPodEventInput,
  options?: EventServiceOptions
): Promise<{ id: string | null; error: Error | null }> {
  const client = getClient(options?.useAdmin);
  const severity = input.severity ?? getDefaultSeverity(input.eventType);

  try {
    const { data, error } = await client.rpc('emit_pod_event', {
      p_event_type: input.eventType,
      p_pod_id: input.podId,
      p_pod_name: input.podName ?? null,
      p_severity: severity,
      p_namespace: input.namespace ?? 'default',
      p_actor_id: input.actorId ?? null,
      p_reason: input.reason ?? null,
      p_message: input.message ?? null,
      p_previous_status: input.previousStatus ?? null,
      p_new_status: input.newStatus ?? null,
      p_node_id: input.nodeId ?? null,
      p_node_name: input.nodeName ?? null,
      p_metadata: input.metadata ?? {},
    });

    if (error) {
      logger.error('Failed to emit pod event', undefined, { eventType: input.eventType, podId: input.podId, error });
      return { id: null, error: new Error(error.message) };
    }

    logger.debug('Pod event emitted', { eventType: input.eventType, podId: input.podId, id: data });
    return { id: data as string, error: null };
  } catch (err) {
    logger.error('Exception emitting pod event', undefined, { eventType: input.eventType, podId: input.podId, error: err });
    return { id: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Emit a node event
 */
export async function emitNodeEvent(
  input: EmitNodeEventInput,
  options?: EventServiceOptions
): Promise<{ id: string | null; error: Error | null }> {
  const client = getClient(options?.useAdmin);
  const severity = input.severity ?? getDefaultSeverity(input.eventType);

  try {
    const { data, error } = await client.rpc('emit_node_event', {
      p_event_type: input.eventType,
      p_node_id: input.nodeId,
      p_node_name: input.nodeName ?? null,
      p_severity: severity,
      p_actor_id: input.actorId ?? null,
      p_reason: input.reason ?? null,
      p_message: input.message ?? null,
      p_previous_status: input.previousStatus ?? null,
      p_new_status: input.newStatus ?? null,
      p_metadata: input.metadata ?? {},
    });

    if (error) {
      logger.error('Failed to emit node event', undefined, { eventType: input.eventType, nodeId: input.nodeId, error });
      return { id: null, error: new Error(error.message) };
    }

    logger.debug('Node event emitted', { eventType: input.eventType, nodeId: input.nodeId, id: data });
    return { id: data as string, error: null };
  } catch (err) {
    logger.error('Exception emitting node event', undefined, { eventType: input.eventType, nodeId: input.nodeId, error: err });
    return { id: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ============================================================================
// Event Queries
// ============================================================================

/**
 * Get events for a specific resource
 */
export async function getResourceEvents(
  resourceType: string,
  resourceId: string,
  limit = 50,
  offset = 0,
  options?: EventServiceOptions
): Promise<{ events: StarkEvent[]; error: Error | null }> {
  const client = getClient(options?.useAdmin);

  try {
    const { data, error } = await client
      .from('events')
      .select('*')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to get resource events', undefined, { resourceType, resourceId, error });
      return { events: [], error: new Error(error.message) };
    }

    return { events: (data as DbEvent[]).map(mapDbEventToStarkEvent), error: null };
  } catch (err) {
    logger.error('Exception getting resource events', undefined, { resourceType, resourceId, error: err });
    return { events: [], error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Get pod events
 */
export async function getPodEvents(
  podId: string,
  limit = 50,
  options?: EventServiceOptions
): Promise<{ events: StarkEvent[]; error: Error | null }> {
  return getResourceEvents('pod', podId, limit, 0, options);
}

/**
 * Get node events
 */
export async function getNodeEvents(
  nodeId: string,
  limit = 50,
  options?: EventServiceOptions
): Promise<{ events: StarkEvent[]; error: Error | null }> {
  return getResourceEvents('node', nodeId, limit, 0, options);
}

/**
 * Query events with filters
 */
export async function queryEvents(
  queryOptions: EventQueryOptions,
  serviceOptions?: EventServiceOptions
): Promise<EventQueryResult> {
  const client = getClient(serviceOptions?.useAdmin);
  const limit = queryOptions.limit ?? 50;
  const offset = queryOptions.offset ?? 0;

  try {
    let query = client
      .from('events')
      .select('*', { count: 'exact' });

    // Apply filters
    if (queryOptions.category) {
      query = query.eq('category', queryOptions.category);
    }
    if (queryOptions.eventType) {
      query = query.eq('event_type', queryOptions.eventType);
    }
    if (queryOptions.resourceType) {
      query = query.eq('resource_type', queryOptions.resourceType);
    }
    if (queryOptions.resourceId) {
      query = query.eq('resource_id', queryOptions.resourceId);
    }
    if (queryOptions.namespace) {
      query = query.eq('namespace', queryOptions.namespace);
    }
    if (queryOptions.severity) {
      if (Array.isArray(queryOptions.severity)) {
        query = query.in('severity', queryOptions.severity);
      } else {
        query = query.eq('severity', queryOptions.severity);
      }
    }
    if (queryOptions.since) {
      query = query.gte('created_at', queryOptions.since.toISOString());
    }
    if (queryOptions.until) {
      query = query.lte('created_at', queryOptions.until.toISOString());
    }

    // Order and pagination
    const order = queryOptions.order ?? 'desc';
    query = query.order('created_at', { ascending: order === 'asc' });
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Failed to query events', undefined, { error });
      return { events: [], total: 0, hasMore: false };
    }

    const events = (data as DbEvent[]).map(mapDbEventToStarkEvent);
    const total = count ?? 0;

    return {
      events,
      total,
      hasMore: offset + events.length < total,
    };
  } catch (err) {
    logger.error('Exception querying events', undefined, { error: err });
    return { events: [], total: 0, hasMore: false };
  }
}

/**
 * Get events by category
 */
export async function getEventsByCategory(
  category: EventCategory,
  limit = 50,
  since?: Date,
  options?: EventServiceOptions
): Promise<{ events: StarkEvent[]; error: Error | null }> {
  const result = await queryEvents({
    category,
    limit,
    since,
  }, options);

  return { events: result.events, error: null };
}

/**
 * Get critical/error events for alerting
 */
export async function getCriticalEvents(
  since?: Date,
  limit = 100,
  options?: EventServiceOptions
): Promise<{ events: StarkEvent[]; error: Error | null }> {
  const result = await queryEvents({
    severity: ['error', 'critical'],
    since: since ?? new Date(Date.now() - 60 * 60 * 1000), // Default: last hour
    limit,
  }, options);

  return { events: result.events, error: null };
}

/**
 * Get namespace timeline (all events in a namespace)
 */
export async function getNamespaceTimeline(
  namespace: string,
  limit = 100,
  since?: Date,
  options?: EventServiceOptions
): Promise<{ events: EventTimelineItem[]; error: Error | null }> {
  const client = getClient(options?.useAdmin);

  try {
    let query = client
      .from('events')
      .select('id, event_type, category, severity, resource_type, resource_name, reason, message, created_at')
      .eq('namespace', namespace)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (since) {
      query = query.gte('created_at', since.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to get namespace timeline', undefined, { namespace, error });
      return { events: [], error: new Error(error.message) };
    }

    return { events: (data as DbEvent[]).map(mapDbEventToTimelineItem), error: null };
  } catch (err) {
    logger.error('Exception getting namespace timeline', undefined, { namespace, error: err });
    return { events: [], error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Get cluster-wide timeline (all events)
 */
export async function getClusterTimeline(
  limit = 100,
  since?: Date,
  options?: EventServiceOptions
): Promise<{ events: EventTimelineItem[]; error: Error | null }> {
  const client = getClient(options?.useAdmin);

  try {
    let query = client
      .from('events')
      .select('id, event_type, category, severity, resource_type, resource_name, reason, message, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (since) {
      query = query.gte('created_at', since.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to get cluster timeline', undefined, { error });
      return { events: [], error: new Error(error.message) };
    }

    return { events: (data as DbEvent[]).map(mapDbEventToTimelineItem), error: null };
  } catch (err) {
    logger.error('Exception getting cluster timeline', undefined, { error: err });
    return { events: [], error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ============================================================================
// Event Statistics
// ============================================================================

export interface EventStats {
  total: number;
  byCategory: Record<EventCategory, number>;
  bySeverity: Record<EventSeverity, number>;
  recentErrors: number;
}

/**
 * Get event statistics for a time period
 */
export async function getEventStats(
  since?: Date,
  options?: EventServiceOptions
): Promise<{ stats: EventStats | null; error: Error | null }> {
  const client = getClient(options?.useAdmin);
  const sinceDate = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours

  try {
    const { data, error } = await client
      .from('events')
      .select('category, severity')
      .gte('created_at', sinceDate.toISOString());

    if (error) {
      logger.error('Failed to get event stats', undefined, { error });
      return { stats: null, error: new Error(error.message) };
    }

    const stats: EventStats = {
      total: data.length,
      byCategory: {
        pod: 0,
        node: 0,
        pack: 0,
        deployment: 0,
        system: 0,
        auth: 0,
        scheduler: 0,
      },
      bySeverity: {
        info: 0,
        warning: 0,
        error: 0,
        critical: 0,
      },
      recentErrors: 0,
    };

    for (const event of data) {
      const cat = event.category as EventCategory;
      const sev = event.severity as EventSeverity;
      if (Object.prototype.hasOwnProperty.call(stats.byCategory, cat)) {
        (stats.byCategory as Record<string, number>)[cat]!++;
      }
      if (Object.prototype.hasOwnProperty.call(stats.bySeverity, sev)) {
        (stats.bySeverity as Record<string, number>)[sev]!++;
      }
    }

    stats.recentErrors = (stats.bySeverity.error ?? 0) + (stats.bySeverity.critical ?? 0);

    return { stats, error: null };
  } catch (err) {
    logger.error('Exception getting event stats', undefined, { error: err });
    return { stats: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ============================================================================
// Convenience Event Emitters
// ============================================================================

/**
 * Emit a PodScheduled event
 */
export function emitPodScheduled(
  podId: string,
  podName: string | undefined,
  nodeId: string,
  nodeName: string | undefined,
  namespace = 'default',
  actorId?: string,
  correlationId?: string,
  options?: EventServiceOptions
) {
  return emitPodEvent({
    eventType: 'PodScheduled',
    podId,
    podName,
    namespace,
    actorId,
    reason: 'Scheduled',
    message: `Pod scheduled to node ${nodeName ?? nodeId}`,
    newStatus: 'scheduled',
    nodeId,
    nodeName,
    correlationId,
  }, options);
}

/**
 * Emit a PodFailed event
 */
export function emitPodFailed(
  podId: string,
  podName: string | undefined,
  reason: string,
  message: string,
  namespace = 'default',
  previousStatus?: string,
  nodeId?: string,
  nodeName?: string,
  metadata?: Record<string, unknown>,
  options?: EventServiceOptions
) {
  return emitPodEvent({
    eventType: 'PodFailed',
    podId,
    podName,
    namespace,
    severity: 'error',
    reason,
    message,
    previousStatus,
    newStatus: 'failed',
    nodeId,
    nodeName,
    metadata,
  }, options);
}

/**
 * Emit a PodRestarted event
 */
export function emitPodRestarted(
  podId: string,
  podName: string | undefined,
  namespace = 'default',
  reason?: string,
  actorId?: string,
  nodeId?: string,
  nodeName?: string,
  options?: EventServiceOptions
) {
  return emitPodEvent({
    eventType: 'PodRestarted',
    podId,
    podName,
    namespace,
    actorId,
    reason: reason ?? 'Restarted',
    message: 'Pod restarted',
    nodeId,
    nodeName,
  }, options);
}

/**
 * Emit a NodeLost event
 */
export function emitNodeLost(
  nodeId: string,
  nodeName: string | undefined,
  reason: string,
  lastHeartbeat?: Date,
  options?: EventServiceOptions
) {
  return emitNodeEvent({
    eventType: 'NodeLost',
    nodeId,
    nodeName,
    severity: 'warning',
    reason,
    message: `Node lost: ${nodeName ?? nodeId}`,
    previousStatus: 'ready',
    newStatus: 'offline',
    metadata: lastHeartbeat ? { lastHeartbeat: lastHeartbeat.toISOString() } : undefined,
  }, options);
}

/**
 * Emit a NodeRecovered event
 */
export function emitNodeRecovered(
  nodeId: string,
  nodeName: string | undefined,
  options?: EventServiceOptions
) {
  return emitNodeEvent({
    eventType: 'NodeRecovered',
    nodeId,
    nodeName,
    severity: 'info',
    reason: 'HeartbeatRestored',
    message: `Node recovered: ${nodeName ?? nodeId}`,
    previousStatus: 'offline',
    newStatus: 'ready',
  }, options);
}
