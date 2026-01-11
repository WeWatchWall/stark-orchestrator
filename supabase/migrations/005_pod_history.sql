-- Migration: 005_pod_history
-- Description: Pod history audit log table
-- Stark Orchestrator

-- Pod action enum
CREATE TYPE pod_action AS ENUM (
    'created',      -- Pod was created
    'scheduled',    -- Pod was assigned to a node
    'started',      -- Pod started running
    'stopped',      -- Pod was stopped normally
    'failed',       -- Pod failed with error
    'restarted',    -- Pod was restarted
    'rolled_back',  -- Pod was rolled back to previous version
    'evicted',      -- Pod was evicted from node
    'scaled',       -- Pod was scaled (replicas changed)
    'updated',      -- Pod configuration was updated
    'deleted'       -- Pod was deleted
);

-- Pod history table
CREATE TABLE IF NOT EXISTS public.pod_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Reference to pod
    pod_id UUID NOT NULL,  -- Not FK because pod might be deleted
    
    -- Action details
    action pod_action NOT NULL,
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    
    -- State snapshot
    previous_status pod_status,
    new_status pod_status,
    previous_version TEXT,
    new_version TEXT,
    previous_node_id UUID,
    new_node_id UUID,
    
    -- Additional context
    reason TEXT,
    message TEXT,
    metadata JSONB DEFAULT '{}'::JSONB,
    
    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pod_history_pod_id ON public.pod_history(pod_id);
CREATE INDEX IF NOT EXISTS idx_pod_history_action ON public.pod_history(action);
CREATE INDEX IF NOT EXISTS idx_pod_history_actor_id ON public.pod_history(actor_id);
CREATE INDEX IF NOT EXISTS idx_pod_history_created_at ON public.pod_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pod_history_pod_created_at ON public.pod_history(pod_id, created_at DESC);

-- RLS (Row Level Security)
ALTER TABLE public.pod_history ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read pod history
CREATE POLICY "Anyone can read pod history"
    ON public.pod_history FOR SELECT
    USING (true);

-- Policy: Only system and operators can insert history
CREATE POLICY "System can insert history"
    ON public.pod_history FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Function to record pod history
CREATE OR REPLACE FUNCTION record_pod_history(
    p_pod_id UUID,
    p_action pod_action,
    p_actor_id UUID DEFAULT NULL,
    p_previous_status pod_status DEFAULT NULL,
    p_new_status pod_status DEFAULT NULL,
    p_previous_version TEXT DEFAULT NULL,
    p_new_version TEXT DEFAULT NULL,
    p_previous_node_id UUID DEFAULT NULL,
    p_new_node_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_message TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID AS $$
DECLARE
    history_id UUID;
BEGIN
    INSERT INTO public.pod_history (
        pod_id, action, actor_id,
        previous_status, new_status,
        previous_version, new_version,
        previous_node_id, new_node_id,
        reason, message, metadata
    ) VALUES (
        p_pod_id, p_action, p_actor_id,
        p_previous_status, p_new_status,
        p_previous_version, p_new_version,
        p_previous_node_id, p_new_node_id,
        p_reason, p_message, p_metadata
    )
    RETURNING id INTO history_id;
    
    RETURN history_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get pod history
CREATE OR REPLACE FUNCTION get_pod_history(
    target_pod_id UUID,
    limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
    id UUID,
    action pod_action,
    actor_id UUID,
    previous_status pod_status,
    new_status pod_status,
    reason TEXT,
    message TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        h.id, h.action, h.actor_id,
        h.previous_status, h.new_status,
        h.reason, h.message, h.created_at
    FROM public.pod_history h
    WHERE h.pod_id = target_pod_id
    ORDER BY h.created_at DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-record pod status changes
CREATE OR REPLACE FUNCTION trigger_pod_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM record_pod_history(
            NEW.id,
            CASE NEW.status
                WHEN 'scheduled' THEN 'scheduled'::pod_action
                WHEN 'starting' THEN 'started'::pod_action
                WHEN 'running' THEN 'started'::pod_action
                WHEN 'stopped' THEN 'stopped'::pod_action
                WHEN 'failed' THEN 'failed'::pod_action
                WHEN 'evicted' THEN 'evicted'::pod_action
                ELSE 'updated'::pod_action
            END,
            auth.uid(),
            OLD.status,
            NEW.status,
            OLD.pack_version,
            NEW.pack_version,
            OLD.node_id,
            NEW.node_id,
            NULL,
            'Status changed from ' || OLD.status || ' to ' || NEW.status,
            '{}'::JSONB
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_pods_status_history
    AFTER UPDATE ON public.pods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_pod_status_change();

-- Trigger to record pod creation
CREATE OR REPLACE FUNCTION trigger_pod_created()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM record_pod_history(
        NEW.id,
        'created'::pod_action,
        NEW.created_by,
        NULL,
        NEW.status,
        NULL,
        NEW.pack_version,
        NULL,
        NEW.node_id,
        NULL,
        'Pod created',
        '{}'::JSONB
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_pods_created_history
    AFTER INSERT ON public.pods
    FOR EACH ROW
    EXECUTE FUNCTION trigger_pod_created();

-- Comments
COMMENT ON TABLE public.pod_history IS 'Audit log for pod lifecycle events';
COMMENT ON COLUMN public.pod_history.action IS 'Type of action that occurred';
COMMENT ON COLUMN public.pod_history.actor_id IS 'User who performed the action (null for system actions)';
COMMENT ON COLUMN public.pod_history.reason IS 'Short reason code for the action';
COMMENT ON COLUMN public.pod_history.message IS 'Human-readable description of the action';
