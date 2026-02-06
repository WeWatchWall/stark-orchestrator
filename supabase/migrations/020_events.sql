-- Migration: 020_events
-- Description: Unified events table - first-class event log for debugging, UI timelines, and audits
-- Stark Orchestrator
--
-- This migration creates a comprehensive event system to replace and extend pod_history.
-- Events are gold for: debugging, UI timelines, audits, monitoring, and observability.

-- Event category enum
CREATE TYPE event_category AS ENUM (
    'pod',          -- Pod lifecycle events
    'node',         -- Node lifecycle events
    'pack',         -- Pack lifecycle events
    'service',   -- Service events
    'system',       -- System-level events
    'auth',         -- Authentication events
    'scheduler'     -- Scheduler events
);

-- Event severity enum
CREATE TYPE event_severity AS ENUM (
    'info',         -- Informational events
    'warning',      -- Warning events (degraded state)
    'error',        -- Error events (failures)
    'critical'      -- Critical events (requires attention)
);

-- Unified events table
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Event identification
    event_type TEXT NOT NULL,           -- e.g., 'PodScheduled', 'NodeLost', 'PodFailed'
    category event_category NOT NULL,    -- High-level category for filtering
    severity event_severity NOT NULL DEFAULT 'info',
    
    -- Resource identification (polymorphic)
    resource_id UUID,                    -- ID of the affected resource (pod, node, pack, etc.)
    resource_type TEXT,                  -- 'pod', 'node', 'pack', 'service', etc.
    resource_name TEXT,                  -- Human-readable name of the resource
    namespace TEXT DEFAULT 'default',    -- Namespace context
    
    -- Actor information
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    actor_type TEXT DEFAULT 'user',      -- 'user', 'system', 'scheduler', 'node'
    
    -- Event details
    reason TEXT,                         -- Short reason code (e.g., 'ScheduleFailed', 'OOMKilled')
    message TEXT,                        -- Human-readable description
    
    -- State tracking (for status transitions)
    previous_state JSONB,                -- Previous state snapshot
    new_state JSONB,                     -- New state snapshot
    
    -- Related resources
    related_resource_id UUID,            -- Related resource (e.g., node for pod events)
    related_resource_type TEXT,          -- Type of related resource
    related_resource_name TEXT,          -- Name of related resource
    
    -- Additional context
    metadata JSONB DEFAULT '{}'::JSONB,  -- Flexible additional data
    source TEXT DEFAULT 'server',        -- Event source: 'server', 'node', 'client', 'scheduler'
    correlation_id TEXT,                 -- For tracing related events
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- For time-series queries
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- When the event was recorded (may differ from created_at)
);

-- Indexes for efficient querying
-- Primary access patterns
CREATE INDEX IF NOT EXISTS idx_events_resource ON public.events(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_events_category ON public.events(category);
CREATE INDEX IF NOT EXISTS idx_events_type ON public.events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_severity ON public.events(severity);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON public.events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_namespace ON public.events(namespace);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_resource_timeline 
    ON public.events(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_category_timeline 
    ON public.events(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_namespace_timeline 
    ON public.events(namespace, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_severity_created 
    ON public.events(severity, created_at DESC) WHERE severity IN ('error', 'critical');

-- Correlation tracking
CREATE INDEX IF NOT EXISTS idx_events_correlation ON public.events(correlation_id) WHERE correlation_id IS NOT NULL;

-- RLS (Row Level Security)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read events (for now - can be restricted by namespace later)
CREATE POLICY "Anyone can read events"
    ON public.events FOR SELECT
    USING (true);

-- Policy: System and operators can insert events
CREATE POLICY "System can insert events"
    ON public.events FOR INSERT
    WITH CHECK (
        auth.uid() IS NULL  -- Allow anonymous system inserts
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- ============================================================================
-- Event Recording Functions
-- ============================================================================

-- Generic event recording function
CREATE OR REPLACE FUNCTION emit_event(
    p_event_type TEXT,
    p_category event_category,
    p_resource_id UUID DEFAULT NULL,
    p_resource_type TEXT DEFAULT NULL,
    p_resource_name TEXT DEFAULT NULL,
    p_severity event_severity DEFAULT 'info',
    p_namespace TEXT DEFAULT 'default',
    p_actor_id UUID DEFAULT NULL,
    p_actor_type TEXT DEFAULT 'system',
    p_reason TEXT DEFAULT NULL,
    p_message TEXT DEFAULT NULL,
    p_previous_state JSONB DEFAULT NULL,
    p_new_state JSONB DEFAULT NULL,
    p_related_resource_id UUID DEFAULT NULL,
    p_related_resource_type TEXT DEFAULT NULL,
    p_related_resource_name TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB,
    p_source TEXT DEFAULT 'server',
    p_correlation_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO public.events (
        event_type, category, resource_id, resource_type, resource_name,
        severity, namespace, actor_id, actor_type,
        reason, message, previous_state, new_state,
        related_resource_id, related_resource_type, related_resource_name,
        metadata, source, correlation_id
    ) VALUES (
        p_event_type, p_category, p_resource_id, p_resource_type, p_resource_name,
        p_severity, p_namespace, p_actor_id, p_actor_type,
        p_reason, p_message, p_previous_state, p_new_state,
        p_related_resource_id, p_related_resource_type, p_related_resource_name,
        p_metadata, p_source, p_correlation_id
    )
    RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Convenience function for pod events
CREATE OR REPLACE FUNCTION emit_pod_event(
    p_event_type TEXT,
    p_pod_id UUID,
    p_pod_name TEXT DEFAULT NULL,
    p_severity event_severity DEFAULT 'info',
    p_namespace TEXT DEFAULT 'default',
    p_actor_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_message TEXT DEFAULT NULL,
    p_previous_status TEXT DEFAULT NULL,
    p_new_status TEXT DEFAULT NULL,
    p_node_id UUID DEFAULT NULL,
    p_node_name TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID AS $$
BEGIN
    RETURN emit_event(
        p_event_type := p_event_type,
        p_category := 'pod'::event_category,
        p_resource_id := p_pod_id,
        p_resource_type := 'pod',
        p_resource_name := p_pod_name,
        p_severity := p_severity,
        p_namespace := p_namespace,
        p_actor_id := p_actor_id,
        p_actor_type := CASE WHEN p_actor_id IS NULL THEN 'system' ELSE 'user' END,
        p_reason := p_reason,
        p_message := p_message,
        p_previous_state := CASE WHEN p_previous_status IS NOT NULL 
            THEN jsonb_build_object('status', p_previous_status) ELSE NULL END,
        p_new_state := CASE WHEN p_new_status IS NOT NULL 
            THEN jsonb_build_object('status', p_new_status) ELSE NULL END,
        p_related_resource_id := p_node_id,
        p_related_resource_type := CASE WHEN p_node_id IS NOT NULL THEN 'node' ELSE NULL END,
        p_related_resource_name := p_node_name,
        p_metadata := p_metadata,
        p_source := 'server'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Convenience function for node events
CREATE OR REPLACE FUNCTION emit_node_event(
    p_event_type TEXT,
    p_node_id UUID,
    p_node_name TEXT DEFAULT NULL,
    p_severity event_severity DEFAULT 'info',
    p_actor_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_message TEXT DEFAULT NULL,
    p_previous_status TEXT DEFAULT NULL,
    p_new_status TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID AS $$
BEGIN
    RETURN emit_event(
        p_event_type := p_event_type,
        p_category := 'node'::event_category,
        p_resource_id := p_node_id,
        p_resource_type := 'node',
        p_resource_name := p_node_name,
        p_severity := p_severity,
        p_namespace := 'default',  -- Nodes are cluster-scoped
        p_actor_id := p_actor_id,
        p_actor_type := CASE WHEN p_actor_id IS NULL THEN 'system' ELSE 'user' END,
        p_reason := p_reason,
        p_message := p_message,
        p_previous_state := CASE WHEN p_previous_status IS NOT NULL 
            THEN jsonb_build_object('status', p_previous_status) ELSE NULL END,
        p_new_state := CASE WHEN p_new_status IS NOT NULL 
            THEN jsonb_build_object('status', p_new_status) ELSE NULL END,
        p_metadata := p_metadata,
        p_source := 'server'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Event Query Functions
-- ============================================================================

-- Get events for a specific resource
CREATE OR REPLACE FUNCTION get_resource_events(
    p_resource_type TEXT,
    p_resource_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    event_type TEXT,
    category event_category,
    severity event_severity,
    reason TEXT,
    message TEXT,
    previous_state JSONB,
    new_state JSONB,
    related_resource_name TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id, e.event_type, e.category, e.severity,
        e.reason, e.message, e.previous_state, e.new_state,
        e.related_resource_name, e.metadata, e.created_at
    FROM public.events e
    WHERE e.resource_type = p_resource_type
      AND e.resource_id = p_resource_id
    ORDER BY e.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get recent events by category
CREATE OR REPLACE FUNCTION get_events_by_category(
    p_category event_category,
    p_limit INTEGER DEFAULT 50,
    p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    event_type TEXT,
    severity event_severity,
    resource_id UUID,
    resource_name TEXT,
    namespace TEXT,
    reason TEXT,
    message TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id, e.event_type, e.severity,
        e.resource_id, e.resource_name, e.namespace,
        e.reason, e.message, e.created_at
    FROM public.events e
    WHERE e.category = p_category
      AND (p_since IS NULL OR e.created_at > p_since)
    ORDER BY e.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get critical/error events (for alerts and monitoring)
CREATE OR REPLACE FUNCTION get_critical_events(
    p_since TIMESTAMPTZ DEFAULT NOW() - INTERVAL '1 hour',
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    event_type TEXT,
    category event_category,
    severity event_severity,
    resource_type TEXT,
    resource_name TEXT,
    namespace TEXT,
    reason TEXT,
    message TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id, e.event_type, e.category, e.severity,
        e.resource_type, e.resource_name, e.namespace,
        e.reason, e.message, e.created_at
    FROM public.events e
    WHERE e.severity IN ('error', 'critical')
      AND e.created_at > p_since
    ORDER BY e.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get namespace timeline (all events in a namespace)
CREATE OR REPLACE FUNCTION get_namespace_timeline(
    p_namespace TEXT DEFAULT 'default',
    p_limit INTEGER DEFAULT 100,
    p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    event_type TEXT,
    category event_category,
    severity event_severity,
    resource_type TEXT,
    resource_id UUID,
    resource_name TEXT,
    reason TEXT,
    message TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        e.id, e.event_type, e.category, e.severity,
        e.resource_type, e.resource_id, e.resource_name,
        e.reason, e.message, e.created_at
    FROM public.events e
    WHERE e.namespace = p_namespace
      AND (p_since IS NULL OR e.created_at > p_since)
    ORDER BY e.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Migration: Copy existing pod_history to events
-- ============================================================================

-- Migrate existing pod_history data to events table
INSERT INTO public.events (
    event_type,
    category,
    severity,
    resource_id,
    resource_type,
    actor_id,
    actor_type,
    reason,
    message,
    previous_state,
    new_state,
    related_resource_id,
    related_resource_type,
    metadata,
    source,
    created_at
)
SELECT
    -- Map pod_action to event_type
    CASE action
        WHEN 'created' THEN 'PodCreated'
        WHEN 'scheduled' THEN 'PodScheduled'
        WHEN 'started' THEN 'PodStarted'
        WHEN 'stopped' THEN 'PodStopped'
        WHEN 'failed' THEN 'PodFailed'
        WHEN 'restarted' THEN 'PodRestarted'
        WHEN 'rolled_back' THEN 'PodRolledBack'
        WHEN 'evicted' THEN 'PodEvicted'
        WHEN 'scaled' THEN 'PodScaled'
        WHEN 'updated' THEN 'PodUpdated'
        WHEN 'deleted' THEN 'PodDeleted'
        ELSE 'PodUpdated'
    END,
    'pod'::event_category,
    -- Map to severity
    CASE action
        WHEN 'failed' THEN 'error'::event_severity
        WHEN 'evicted' THEN 'warning'::event_severity
        ELSE 'info'::event_severity
    END,
    pod_id,
    'pod',
    actor_id,
    CASE WHEN actor_id IS NULL THEN 'system' ELSE 'user' END,
    reason,
    message,
    -- Previous state
    CASE WHEN previous_status IS NOT NULL OR previous_version IS NOT NULL THEN
        jsonb_build_object(
            'status', previous_status,
            'version', previous_version
        )
    ELSE NULL END,
    -- New state
    CASE WHEN new_status IS NOT NULL OR new_version IS NOT NULL THEN
        jsonb_build_object(
            'status', new_status,
            'version', new_version
        )
    ELSE NULL END,
    -- Related node
    COALESCE(new_node_id, previous_node_id),
    CASE WHEN new_node_id IS NOT NULL OR previous_node_id IS NOT NULL THEN 'node' ELSE NULL END,
    metadata,
    'server',
    created_at
FROM public.pod_history;

-- ============================================================================
-- Update Pod Triggers to use events table
-- ============================================================================

-- Drop old triggers
DROP TRIGGER IF EXISTS trigger_pods_status_history ON public.pods;
DROP TRIGGER IF EXISTS trigger_pods_created_history ON public.pods;

-- New trigger for pod status changes
CREATE OR REPLACE FUNCTION trigger_pod_status_event()
RETURNS TRIGGER AS $$
DECLARE
    pack_name TEXT;
    pod_name TEXT;
    node_name TEXT;
    ns TEXT;
BEGIN
    -- Get pack name from packs table
    SELECT name INTO pack_name FROM public.packs WHERE id = NEW.pack_id;
    -- Generate pod name from pack name + short pod ID
    pod_name := COALESCE(pack_name, 'pod') || '-' || LEFT(NEW.id::TEXT, 8);
    ns := COALESCE(NEW.namespace, 'default');
    
    -- Get node name if assigned
    IF NEW.node_id IS NOT NULL THEN
        SELECT name INTO node_name FROM public.nodes WHERE id = NEW.node_id;
    END IF;
    
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM emit_pod_event(
            p_event_type := CASE NEW.status
                WHEN 'scheduled' THEN 'PodScheduled'
                WHEN 'starting' THEN 'PodStarting'
                WHEN 'running' THEN 'PodRunning'
                WHEN 'stopped' THEN 'PodStopped'
                WHEN 'failed' THEN 'PodFailed'
                WHEN 'evicted' THEN 'PodEvicted'
                ELSE 'PodStatusChanged'
            END,
            p_pod_id := NEW.id,
            p_pod_name := pod_name,
            p_severity := CASE 
                WHEN NEW.status = 'failed' THEN 'error'::event_severity
                WHEN NEW.status = 'evicted' THEN 'warning'::event_severity
                ELSE 'info'::event_severity
            END,
            p_namespace := ns,
            p_actor_id := auth.uid(),
            p_reason := CASE NEW.status
                WHEN 'failed' THEN 'PodFailed'
                WHEN 'evicted' THEN 'NodeEviction'
                ELSE NULL
            END,
            p_message := 'Status changed from ' || OLD.status || ' to ' || NEW.status,
            p_previous_status := OLD.status::TEXT,
            p_new_status := NEW.status::TEXT,
            p_node_id := NEW.node_id,
            p_node_name := node_name,
            p_metadata := jsonb_build_object(
                'packName', pack_name,
                'previousVersion', OLD.pack_version,
                'newVersion', NEW.pack_version
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_pods_status_event
    AFTER UPDATE ON public.pods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_pod_status_event();

-- Trigger for pod creation
CREATE OR REPLACE FUNCTION trigger_pod_created_event()
RETURNS TRIGGER AS $$
DECLARE
    pack_name TEXT;
    pod_name TEXT;
    node_name TEXT;
    ns TEXT;
BEGIN
    -- Get pack name from packs table
    SELECT name INTO pack_name FROM public.packs WHERE id = NEW.pack_id;
    -- Generate pod name from pack name + short pod ID
    pod_name := COALESCE(pack_name, 'pod') || '-' || LEFT(NEW.id::TEXT, 8);
    ns := COALESCE(NEW.namespace, 'default');
    
    IF NEW.node_id IS NOT NULL THEN
        SELECT name INTO node_name FROM public.nodes WHERE id = NEW.node_id;
    END IF;
    
    PERFORM emit_pod_event(
        p_event_type := 'PodCreated',
        p_pod_id := NEW.id,
        p_pod_name := pod_name,
        p_severity := 'info'::event_severity,
        p_namespace := ns,
        p_actor_id := NEW.created_by,
        p_reason := 'PodCreated',
        p_message := 'Pod created',
        p_previous_status := NULL,
        p_new_status := NEW.status::TEXT,
        p_node_id := NEW.node_id,
        p_node_name := node_name,
        p_metadata := jsonb_build_object(
            'packName', pack_name,
            'packVersion', NEW.pack_version
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_pods_created_event
    AFTER INSERT ON public.pods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_pod_created_event();

-- ============================================================================
-- Node Event Triggers
-- ============================================================================

-- Trigger for node status changes (NodeLost, NodeRecovered, etc.)
CREATE OR REPLACE FUNCTION trigger_node_status_event()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM emit_node_event(
            p_event_type := CASE 
                WHEN NEW.status = 'offline' THEN 'NodeLost'
                WHEN NEW.status = 'ready' AND OLD.status = 'offline' THEN 'NodeRecovered'
                WHEN NEW.status = 'ready' THEN 'NodeReady'
                WHEN NEW.status = 'draining' THEN 'NodeDraining'
                WHEN NEW.status = 'cordoned' THEN 'NodeCordoned'
                ELSE 'NodeStatusChanged'
            END,
            p_node_id := NEW.id,
            p_node_name := NEW.name,
            p_severity := CASE 
                WHEN NEW.status = 'offline' THEN 'warning'::event_severity
                WHEN NEW.status = 'ready' AND OLD.status = 'offline' THEN 'info'::event_severity
                ELSE 'info'::event_severity
            END,
            p_actor_id := auth.uid(),
            p_reason := CASE 
                WHEN NEW.status = 'offline' THEN 'HeartbeatTimeout'
                WHEN NEW.status = 'ready' AND OLD.status = 'offline' THEN 'HeartbeatRestored'
                ELSE NULL
            END,
            p_message := 'Node status changed from ' || OLD.status || ' to ' || NEW.status,
            p_previous_status := OLD.status::TEXT,
            p_new_status := NEW.status::TEXT,
            p_metadata := jsonb_build_object(
                'runtimeType', NEW.runtime_type,
                'lastHeartbeat', NEW.last_heartbeat
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_nodes_status_event
    AFTER UPDATE ON public.nodes
    FOR EACH ROW
    EXECUTE FUNCTION trigger_node_status_event();

-- Trigger for node registration
CREATE OR REPLACE FUNCTION trigger_node_registered_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM emit_node_event(
        p_event_type := 'NodeRegistered',
        p_node_id := NEW.id,
        p_node_name := NEW.name,
        p_severity := 'info'::event_severity,
        p_actor_id := NULL,
        p_reason := 'NodeRegistered',
        p_message := 'Node registered with orchestrator',
        p_previous_status := NULL,
        p_new_status := NEW.status::TEXT,
        p_metadata := jsonb_build_object(
            'runtimeType', NEW.runtime_type,
            'labels', NEW.labels,
            'allocatable', NEW.allocatable
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_nodes_registered_event
    AFTER INSERT ON public.nodes
    FOR EACH ROW
    EXECUTE FUNCTION trigger_node_registered_event();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.events IS 'Unified event log for debugging, UI timelines, and audits';
COMMENT ON COLUMN public.events.event_type IS 'Specific event type (e.g., PodScheduled, NodeLost)';
COMMENT ON COLUMN public.events.category IS 'High-level category for filtering (pod, node, pack, system)';
COMMENT ON COLUMN public.events.severity IS 'Event severity level (info, warning, error, critical)';
COMMENT ON COLUMN public.events.resource_id IS 'ID of the primary affected resource';
COMMENT ON COLUMN public.events.resource_type IS 'Type of the primary affected resource (pod, node, pack, etc.)';
COMMENT ON COLUMN public.events.previous_state IS 'State snapshot before the event';
COMMENT ON COLUMN public.events.new_state IS 'State snapshot after the event';
COMMENT ON COLUMN public.events.related_resource_id IS 'ID of a related resource (e.g., node for pod events)';
COMMENT ON COLUMN public.events.correlation_id IS 'For tracing related events across the system';

-- ============================================================================
-- Optional: Deprecate pod_history (keep for backwards compatibility)
-- ============================================================================

-- Add a deprecation notice to the pod_history table
COMMENT ON TABLE public.pod_history IS 'DEPRECATED: Use events table instead. This table is kept for backwards compatibility.';

-- Create a view that maps events back to pod_history format for backwards compatibility
CREATE OR REPLACE VIEW public.pod_history_compat AS
SELECT
    e.id,
    e.resource_id AS pod_id,
    CASE e.event_type
        WHEN 'PodCreated' THEN 'created'::pod_action
        WHEN 'PodScheduled' THEN 'scheduled'::pod_action
        WHEN 'PodStarted' THEN 'started'::pod_action
        WHEN 'PodRunning' THEN 'started'::pod_action
        WHEN 'PodStarting' THEN 'started'::pod_action
        WHEN 'PodStopped' THEN 'stopped'::pod_action
        WHEN 'PodFailed' THEN 'failed'::pod_action
        WHEN 'PodRestarted' THEN 'restarted'::pod_action
        WHEN 'PodRolledBack' THEN 'rolled_back'::pod_action
        WHEN 'PodEvicted' THEN 'evicted'::pod_action
        WHEN 'PodScaled' THEN 'scaled'::pod_action
        WHEN 'PodUpdated' THEN 'updated'::pod_action
        WHEN 'PodDeleted' THEN 'deleted'::pod_action
        ELSE 'updated'::pod_action
    END AS action,
    e.actor_id,
    (e.previous_state->>'status')::pod_status AS previous_status,
    (e.new_state->>'status')::pod_status AS new_status,
    e.previous_state->>'version' AS previous_version,
    e.new_state->>'version' AS new_version,
    NULL::UUID AS previous_node_id,  -- Not tracked in events
    e.related_resource_id AS new_node_id,
    e.reason,
    e.message,
    e.metadata,
    e.created_at
FROM public.events e
WHERE e.category = 'pod';
