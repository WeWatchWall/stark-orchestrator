-- Migration: 028_network_policies
-- Description: Network policies table for persistent inter-service communication rules
-- Stark Orchestrator

-- Network policy action enum
CREATE TYPE network_policy_action AS ENUM ('allow', 'deny');

-- Network policies table
CREATE TABLE IF NOT EXISTS public.network_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Policy definition
    source_service TEXT NOT NULL,
    target_service TEXT NOT NULL,
    action network_policy_action NOT NULL DEFAULT 'allow',
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique policies per source->target pair
    CONSTRAINT unique_source_target UNIQUE (source_service, target_service)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_network_policies_source 
    ON public.network_policies(source_service);
CREATE INDEX IF NOT EXISTS idx_network_policies_target 
    ON public.network_policies(target_service);
CREATE INDEX IF NOT EXISTS idx_network_policies_source_target 
    ON public.network_policies(source_service, target_service);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_network_policies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER network_policies_updated_at
    BEFORE UPDATE ON public.network_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_network_policies_updated_at();

-- Enable RLS
ALTER TABLE public.network_policies ENABLE ROW LEVEL SECURITY;

-- RLS policies: only authenticated users (admins) can manage network policies
CREATE POLICY "network_policies_select" ON public.network_policies
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "network_policies_insert" ON public.network_policies
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "network_policies_update" ON public.network_policies
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "network_policies_delete" ON public.network_policies
    FOR DELETE TO authenticated
    USING (true);

-- Service role has full access (for server-side operations)
CREATE POLICY "network_policies_service_all" ON public.network_policies
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Comments
COMMENT ON TABLE public.network_policies IS 'Network policies controlling inter-service communication';
COMMENT ON COLUMN public.network_policies.source_service IS 'Service ID allowed/denied to initiate communication';
COMMENT ON COLUMN public.network_policies.target_service IS 'Service ID that can be called';
COMMENT ON COLUMN public.network_policies.action IS 'allow or deny the communication';
