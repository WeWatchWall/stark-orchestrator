-- Migration: 006_cluster_config
-- Description: Cluster configuration table (Kubernetes-like)
-- Stark Orchestrator

-- Scheduling policy enum
CREATE TYPE scheduling_policy AS ENUM (
    'spread',       -- Spread pods across nodes
    'binpack',      -- Pack pods onto fewer nodes
    'random',       -- Random node selection
    'affinity',     -- Use affinity rules
    'least_loaded'  -- Select least loaded node
);

-- Cluster configuration table
CREATE TABLE IF NOT EXISTS public.cluster_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE DEFAULT 'default',
    
    -- Cluster-wide settings
    max_pods_per_node INTEGER NOT NULL DEFAULT 110,
    default_namespace TEXT NOT NULL DEFAULT 'default',
    
    -- Scheduling configuration
    scheduling_policy scheduling_policy NOT NULL DEFAULT 'spread',
    
    -- Default resource limits
    default_resource_requests JSONB NOT NULL DEFAULT '{
        "cpu": 100,
        "memory": 128
    }'::JSONB,
    default_resource_limits JSONB NOT NULL DEFAULT '{
        "cpu": 500,
        "memory": 512
    }'::JSONB,
    
    -- Cluster resource limits
    max_total_pods INTEGER DEFAULT 10000,
    max_total_nodes INTEGER DEFAULT 1000,
    
    -- Heartbeat configuration
    heartbeat_interval_ms INTEGER NOT NULL DEFAULT 10000,  -- 10 seconds
    heartbeat_timeout_ms INTEGER NOT NULL DEFAULT 30000,   -- 30 seconds
    
    -- Pod lifecycle configuration
    pod_termination_grace_period_ms INTEGER NOT NULL DEFAULT 30000,  -- 30 seconds
    
    -- Preemption settings
    enable_preemption BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    annotations JSONB DEFAULT '{}'::JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER trigger_cluster_config_updated_at
    BEFORE UPDATE ON public.cluster_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.cluster_config ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read cluster config
CREATE POLICY "Anyone can read cluster config"
    ON public.cluster_config FOR SELECT
    USING (true);

-- Policy: Only admins can modify cluster config
CREATE POLICY "Admins can modify cluster config"
    ON public.cluster_config FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Insert default cluster configuration
INSERT INTO public.cluster_config (name)
VALUES ('default')
ON CONFLICT (name) DO NOTHING;

-- Function to get active cluster config
CREATE OR REPLACE FUNCTION get_cluster_config()
RETURNS public.cluster_config AS $$
BEGIN
    RETURN (SELECT * FROM public.cluster_config WHERE name = 'default' LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update cluster config
CREATE OR REPLACE FUNCTION update_cluster_config(
    p_max_pods_per_node INTEGER DEFAULT NULL,
    p_scheduling_policy scheduling_policy DEFAULT NULL,
    p_heartbeat_interval_ms INTEGER DEFAULT NULL,
    p_heartbeat_timeout_ms INTEGER DEFAULT NULL,
    p_enable_preemption BOOLEAN DEFAULT NULL
)
RETURNS public.cluster_config AS $$
DECLARE
    result public.cluster_config;
BEGIN
    UPDATE public.cluster_config
    SET
        max_pods_per_node = COALESCE(p_max_pods_per_node, max_pods_per_node),
        scheduling_policy = COALESCE(p_scheduling_policy, scheduling_policy),
        heartbeat_interval_ms = COALESCE(p_heartbeat_interval_ms, heartbeat_interval_ms),
        heartbeat_timeout_ms = COALESCE(p_heartbeat_timeout_ms, heartbeat_timeout_ms),
        enable_preemption = COALESCE(p_enable_preemption, enable_preemption)
    WHERE name = 'default'
    RETURNING * INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE public.cluster_config IS 'Cluster-wide configuration settings (Kubernetes-like)';
COMMENT ON COLUMN public.cluster_config.max_pods_per_node IS 'Maximum number of pods per node';
COMMENT ON COLUMN public.cluster_config.scheduling_policy IS 'Default pod scheduling policy';
COMMENT ON COLUMN public.cluster_config.heartbeat_interval_ms IS 'Expected interval between node heartbeats';
COMMENT ON COLUMN public.cluster_config.heartbeat_timeout_ms IS 'Time after which a node is marked unhealthy';
COMMENT ON COLUMN public.cluster_config.enable_preemption IS 'Whether priority-based preemption is enabled';
