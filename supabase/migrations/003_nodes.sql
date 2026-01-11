-- Migration: 003_nodes
-- Description: Nodes table for registered runtime nodes
-- Stark Orchestrator

-- Runtime type enum for node classification
CREATE TYPE runtime_type AS ENUM ('node', 'browser');

-- Node status enum
CREATE TYPE node_status AS ENUM ('online', 'offline', 'unhealthy', 'draining', 'maintenance');

-- Nodes table
CREATE TABLE IF NOT EXISTS public.nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    runtime_type runtime_type NOT NULL,
    status node_status NOT NULL DEFAULT 'offline',
    last_heartbeat TIMESTAMPTZ,
    capabilities JSONB DEFAULT '{}'::JSONB,
    registered_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    
    -- Connection info
    connection_id TEXT,
    ip_address INET,
    user_agent TEXT,
    
    -- Resource info (for scheduling)
    allocatable JSONB DEFAULT '{
        "cpu": 1000,
        "memory": 1024,
        "pods": 10,
        "storage": 10240
    }'::JSONB,
    allocated JSONB DEFAULT '{
        "cpu": 0,
        "memory": 0,
        "pods": 0,
        "storage": 0
    }'::JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_nodes_status ON public.nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_runtime_type ON public.nodes(runtime_type);
CREATE INDEX IF NOT EXISTS idx_nodes_last_heartbeat ON public.nodes(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_nodes_registered_by ON public.nodes(registered_by);
CREATE INDEX IF NOT EXISTS idx_nodes_status_runtime ON public.nodes(status, runtime_type);

-- Trigger for updated_at
CREATE TRIGGER trigger_nodes_updated_at
    BEFORE UPDATE ON public.nodes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.nodes ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read nodes
CREATE POLICY "Anyone can read nodes"
    ON public.nodes FOR SELECT
    USING (true);

-- Policy: Operators and above can register nodes
CREATE POLICY "Operators can register nodes"
    ON public.nodes FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Policy: Operators can update nodes
CREATE POLICY "Operators can update nodes"
    ON public.nodes FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Policy: Admins can delete nodes
CREATE POLICY "Admins can delete nodes"
    ON public.nodes FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Function to update heartbeat
CREATE OR REPLACE FUNCTION update_node_heartbeat(node_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.nodes
    SET 
        last_heartbeat = NOW(),
        status = CASE 
            WHEN status = 'offline' THEN 'online'::node_status
            WHEN status = 'unhealthy' THEN 'online'::node_status
            ELSE status
        END
    WHERE id = node_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark stale nodes as unhealthy (heartbeat > 30s ago)
CREATE OR REPLACE FUNCTION mark_stale_nodes_unhealthy()
RETURNS INTEGER AS $$
DECLARE
    affected_count INTEGER;
BEGIN
    UPDATE public.nodes
    SET status = 'unhealthy'::node_status
    WHERE status = 'online'
    AND last_heartbeat < NOW() - INTERVAL '30 seconds';
    
    GET DIAGNOSTICS affected_count = ROW_COUNT;
    RETURN affected_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get healthy nodes by runtime type
CREATE OR REPLACE FUNCTION get_healthy_nodes(target_runtime runtime_type DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    name TEXT,
    runtime_type runtime_type,
    capabilities JSONB,
    allocatable JSONB,
    allocated JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT n.id, n.name, n.runtime_type, n.capabilities, n.allocatable, n.allocated
    FROM public.nodes n
    WHERE n.status = 'online'
    AND (target_runtime IS NULL OR n.runtime_type = target_runtime);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE public.nodes IS 'Registered runtime nodes (Node.js servers or browsers)';
COMMENT ON COLUMN public.nodes.runtime_type IS 'Node runtime: node or browser';
COMMENT ON COLUMN public.nodes.status IS 'Current node status: online, offline, unhealthy, draining, maintenance';
COMMENT ON COLUMN public.nodes.capabilities IS 'Node capabilities (features, extensions, etc.)';
COMMENT ON COLUMN public.nodes.allocatable IS 'Total allocatable resources: cpu (millicores), memory (MB), pods, storage (MB)';
COMMENT ON COLUMN public.nodes.allocated IS 'Currently allocated resources';
