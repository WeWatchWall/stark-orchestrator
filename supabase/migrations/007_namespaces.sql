-- Migration: 007_namespaces
-- Description: Namespaces table for resource isolation (Kubernetes-like)
-- Stark Orchestrator

-- Namespace phase enum
CREATE TYPE namespace_phase AS ENUM (
    'active',       -- Namespace is active and accepting resources
    'terminating'   -- Namespace is being deleted
);

-- Namespaces table
CREATE TABLE IF NOT EXISTS public.namespaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    
    -- Status
    phase namespace_phase NOT NULL DEFAULT 'active',
    
    -- Metadata
    labels JSONB DEFAULT '{}'::JSONB,
    annotations JSONB DEFAULT '{}'::JSONB,
    
    -- Resource quota (optional limits)
    resource_quota JSONB DEFAULT NULL,
    -- Example: {
    --   "hard": {
    --     "pods": 100,
    --     "cpu": 10000,
    --     "memory": 20480,
    --     "storage": 102400
    --   }
    -- }
    
    -- Limit range (default limits for pods in this namespace)
    limit_range JSONB DEFAULT NULL,
    -- Example: {
    --   "default": {"cpu": 500, "memory": 512},
    --   "defaultRequest": {"cpu": 100, "memory": 128},
    --   "max": {"cpu": 2000, "memory": 4096},
    --   "min": {"cpu": 50, "memory": 64}
    -- }
    
    -- Current usage (calculated)
    resource_usage JSONB DEFAULT '{
        "pods": 0,
        "cpu": 0,
        "memory": 0,
        "storage": 0
    }'::JSONB,
    
    -- Ownership
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_namespaces_phase ON public.namespaces(phase);
CREATE INDEX IF NOT EXISTS idx_namespaces_labels ON public.namespaces USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_namespaces_created_by ON public.namespaces(created_by);

-- Trigger for updated_at
CREATE TRIGGER trigger_namespaces_updated_at
    BEFORE UPDATE ON public.namespaces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.namespaces ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read namespaces
CREATE POLICY "Anyone can read namespaces"
    ON public.namespaces FOR SELECT
    USING (true);

-- Policy: Operators can create namespaces
CREATE POLICY "Operators can create namespaces"
    ON public.namespaces FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Policy: Operators can update namespaces
CREATE POLICY "Operators can update namespaces"
    ON public.namespaces FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Policy: Admins can delete namespaces
CREATE POLICY "Admins can delete namespaces"
    ON public.namespaces FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
        -- Cannot delete reserved namespaces
        AND name NOT IN ('default', 'stark-system', 'stark-public')
    );

-- Create reserved namespaces
INSERT INTO public.namespaces (name, labels, annotations)
VALUES 
    ('default', '{"stark.io/reserved": "true"}'::JSONB, '{"description": "Default namespace for resources without explicit namespace"}'::JSONB),
    ('stark-system', '{"stark.io/reserved": "true", "stark.io/system": "true"}'::JSONB, '{"description": "System namespace for orchestrator components"}'::JSONB),
    ('stark-public', '{"stark.io/reserved": "true", "stark.io/public": "true"}'::JSONB, '{"description": "Public namespace for shared resources"}'::JSONB)
ON CONFLICT (name) DO NOTHING;

-- Function to check if namespace has quota available
CREATE OR REPLACE FUNCTION check_namespace_quota(
    namespace_name TEXT,
    requested_cpu INTEGER DEFAULT 0,
    requested_memory INTEGER DEFAULT 0,
    requested_pods INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
    ns public.namespaces;
    quota JSONB;
    usage JSONB;
BEGIN
    SELECT * INTO ns FROM public.namespaces WHERE name = namespace_name;
    
    IF ns IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- If no quota defined, allow
    IF ns.resource_quota IS NULL THEN
        RETURN TRUE;
    END IF;
    
    quota := ns.resource_quota->'hard';
    usage := ns.resource_usage;
    
    -- Check pod count
    IF quota->>'pods' IS NOT NULL THEN
        IF (usage->>'pods')::INTEGER + requested_pods > (quota->>'pods')::INTEGER THEN
            RETURN FALSE;
        END IF;
    END IF;
    
    -- Check CPU
    IF quota->>'cpu' IS NOT NULL THEN
        IF (usage->>'cpu')::INTEGER + requested_cpu > (quota->>'cpu')::INTEGER THEN
            RETURN FALSE;
        END IF;
    END IF;
    
    -- Check memory
    IF quota->>'memory' IS NOT NULL THEN
        IF (usage->>'memory')::INTEGER + requested_memory > (quota->>'memory')::INTEGER THEN
            RETURN FALSE;
        END IF;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update namespace resource usage
CREATE OR REPLACE FUNCTION update_namespace_usage(
    namespace_name TEXT,
    delta_cpu INTEGER DEFAULT 0,
    delta_memory INTEGER DEFAULT 0,
    delta_pods INTEGER DEFAULT 0,
    delta_storage INTEGER DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.namespaces
    SET resource_usage = jsonb_build_object(
        'pods', GREATEST(0, (resource_usage->>'pods')::INTEGER + delta_pods),
        'cpu', GREATEST(0, (resource_usage->>'cpu')::INTEGER + delta_cpu),
        'memory', GREATEST(0, (resource_usage->>'memory')::INTEGER + delta_memory),
        'storage', GREATEST(0, (resource_usage->>'storage')::INTEGER + delta_storage)
    )
    WHERE name = namespace_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get namespace limit range defaults
CREATE OR REPLACE FUNCTION get_namespace_limits(namespace_name TEXT)
RETURNS JSONB AS $$
DECLARE
    ns public.namespaces;
BEGIN
    SELECT * INTO ns FROM public.namespaces WHERE name = namespace_name;
    
    IF ns IS NULL OR ns.limit_range IS NULL THEN
        -- Return cluster defaults
        RETURN (SELECT default_resource_limits FROM public.cluster_config WHERE name = 'default');
    END IF;
    
    RETURN ns.limit_range;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE public.namespaces IS 'Namespaces for resource isolation (Kubernetes-like)';
COMMENT ON COLUMN public.namespaces.phase IS 'Namespace lifecycle phase: active or terminating';
COMMENT ON COLUMN public.namespaces.labels IS 'Key-value labels for organization and selection';
COMMENT ON COLUMN public.namespaces.annotations IS 'Non-identifying metadata';
COMMENT ON COLUMN public.namespaces.resource_quota IS 'Hard limits on resources in this namespace';
COMMENT ON COLUMN public.namespaces.limit_range IS 'Default and min/max limits for pods in this namespace';
COMMENT ON COLUMN public.namespaces.resource_usage IS 'Current resource usage in this namespace';
