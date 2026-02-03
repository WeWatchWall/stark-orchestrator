-- Migration: 022_fix_node_event_trigger
-- Description: Fix node status event trigger to use valid enum values
-- 
-- The trigger was comparing NEW.status (a node_status enum) to 'ready' and 'cordoned'
-- which are not valid values in the node_status enum. PostgreSQL attempts to cast
-- the string literal to the enum type for comparison, which fails.
--
-- Valid node_status values: 'online', 'offline', 'unhealthy', 'draining', 'maintenance'

-- Replace the trigger function with corrected enum comparisons
CREATE OR REPLACE FUNCTION trigger_node_status_event()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM emit_node_event(
            p_event_type := CASE 
                WHEN NEW.status = 'offline' THEN 'NodeLost'
                WHEN NEW.status = 'online' AND OLD.status = 'offline' THEN 'NodeRecovered'
                WHEN NEW.status = 'online' THEN 'NodeReady'
                WHEN NEW.status = 'draining' THEN 'NodeDraining'
                WHEN NEW.status = 'maintenance' THEN 'NodeCordoned'
                ELSE 'NodeStatusChanged'
            END,
            p_node_id := NEW.id,
            p_node_name := NEW.name,
            p_severity := CASE 
                WHEN NEW.status = 'offline' THEN 'warning'::event_severity
                WHEN NEW.status = 'online' AND OLD.status = 'offline' THEN 'info'::event_severity
                ELSE 'info'::event_severity
            END,
            p_actor_id := auth.uid(),
            p_reason := CASE 
                WHEN NEW.status = 'offline' THEN 'HeartbeatTimeout'
                WHEN NEW.status = 'online' AND OLD.status = 'offline' THEN 'HeartbeatRestored'
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

-- Note: The trigger itself doesn't need to be recreated since we're just
-- replacing the function it calls.
