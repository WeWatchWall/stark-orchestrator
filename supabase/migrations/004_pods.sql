-- Migration: 004_pods
-- Description: Pods table for pack deployments to nodes
-- Stark Orchestrator

-- Pod status enum
CREATE TYPE pod_status AS ENUM (
    'pending',      -- Waiting for scheduling
    'scheduled',    -- Assigned to node, not yet running
    'starting',     -- Node is starting the pack
    'running',      -- Pack is executing
    'stopping',     -- Graceful shutdown in progress
    'stopped',      -- Normally terminated
    'failed',       -- Terminated with error
    'evicted',      -- Removed due to resource pressure or preemption
    'unknown'       -- Lost contact with node
);

-- Pods table
CREATE TABLE IF NOT EXISTS public.pods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Pack reference
    pack_id UUID NOT NULL REFERENCES public.packs(id) ON DELETE CASCADE,
    pack_version TEXT NOT NULL,
    
    -- Node assignment
    node_id UUID REFERENCES public.nodes(id) ON DELETE SET NULL,
    
    -- Status
    status pod_status NOT NULL DEFAULT 'pending',
    status_message TEXT,
    
    -- Resource requests
    resource_requests JSONB DEFAULT '{
        "cpu": 100,
        "memory": 128
    }'::JSONB,
    resource_limits JSONB DEFAULT '{
        "cpu": 500,
        "memory": 512
    }'::JSONB,
    
    -- Scheduling info
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMPTZ,
    
    -- Lifecycle timestamps
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pods_pack_id ON public.pods(pack_id);
CREATE INDEX IF NOT EXISTS idx_pods_node_id ON public.pods(node_id);
CREATE INDEX IF NOT EXISTS idx_pods_status ON public.pods(status);
CREATE INDEX IF NOT EXISTS idx_pods_created_by ON public.pods(created_by);
CREATE INDEX IF NOT EXISTS idx_pods_created_at ON public.pods(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pods_status_node ON public.pods(status, node_id);
CREATE INDEX IF NOT EXISTS idx_pods_pack_version ON public.pods(pack_id, pack_version);

-- Trigger for updated_at
CREATE TRIGGER trigger_pods_updated_at
    BEFORE UPDATE ON public.pods
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.pods ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read pods
CREATE POLICY "Anyone can read pods"
    ON public.pods FOR SELECT
    USING (true);

-- Policy: Developers can create pods
CREATE POLICY "Developers can create pods"
    ON public.pods FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('developer' = ANY(roles) OR 'operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Policy: Creators can update their pods
CREATE POLICY "Creators can update own pods"
    ON public.pods FOR UPDATE
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Policy: Operators can update any pod
CREATE POLICY "Operators can update pods"
    ON public.pods FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Policy: Creators can delete their pending pods
CREATE POLICY "Creators can delete pending pods"
    ON public.pods FOR DELETE
    USING (created_by = auth.uid() AND status = 'pending');

-- Policy: Admins can delete any pod
CREATE POLICY "Admins can delete pods"
    ON public.pods FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Function to get pods by status
CREATE OR REPLACE FUNCTION get_pods_by_status(target_status pod_status)
RETURNS TABLE (
    id UUID,
    pack_id UUID,
    pack_version TEXT,
    node_id UUID,
    status pod_status,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT d.id, d.pack_id, d.pack_version, d.node_id, d.status, d.created_at
    FROM public.pods d
    WHERE d.status = target_status
    ORDER BY d.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active pods on a node
CREATE OR REPLACE FUNCTION get_node_pods(target_node_id UUID)
RETURNS TABLE (
    id UUID,
    pack_id UUID,
    pack_version TEXT,
    status pod_status,
    started_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT d.id, d.pack_id, d.pack_version, d.status, d.started_at
    FROM public.pods d
    WHERE d.node_id = target_node_id
    AND d.status IN ('scheduled', 'starting', 'running')
    ORDER BY d.started_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE public.pods IS 'Pack deployments to nodes';
COMMENT ON COLUMN public.pods.pack_version IS 'Specific version of the pack being deployed';
COMMENT ON COLUMN public.pods.status IS 'Current pod status';
COMMENT ON COLUMN public.pods.resource_requests IS 'Minimum resources required: cpu (millicores), memory (MB)';
COMMENT ON COLUMN public.pods.resource_limits IS 'Maximum resources allowed: cpu (millicores), memory (MB)';
