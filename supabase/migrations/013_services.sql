-- Migration: 013_services
-- Description: Services table for persistent pod scheduling
-- Stark Orchestrator

-- Service status enum
CREATE TYPE service_status AS ENUM (
    'active',       -- Actively reconciling pods
    'paused',       -- Reconciliation paused
    'scaling',      -- Currently scaling up/down
    'deleting'      -- Being deleted
);

-- Services table
CREATE TABLE IF NOT EXISTS public.services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Identity
    name TEXT NOT NULL,
    
    -- Pack reference
    pack_id UUID NOT NULL REFERENCES public.packs(id) ON DELETE CASCADE,
    pack_version TEXT NOT NULL,
    
    -- Namespace
    namespace TEXT NOT NULL DEFAULT 'default',
    
    -- Replica configuration
    -- replicas = 0 means "deploy to all matching nodes" (DaemonSet-like)
    -- replicas > 0 means "maintain exactly N pods" (Service-like)
    replicas INTEGER NOT NULL DEFAULT 1 CHECK (replicas >= 0),
    
    -- Status
    status service_status NOT NULL DEFAULT 'active',
    status_message TEXT,
    
    -- Labels and annotations for the service itself
    labels JSONB DEFAULT '{}'::JSONB,
    annotations JSONB DEFAULT '{}'::JSONB,
    
    -- Template: labels/annotations applied to created pods
    pod_labels JSONB DEFAULT '{}'::JSONB,
    pod_annotations JSONB DEFAULT '{}'::JSONB,
    
    -- Priority
    priority_class_name TEXT,
    priority INTEGER DEFAULT 100,
    
    -- Tolerations (applied to created pods)
    tolerations JSONB DEFAULT '[]'::JSONB,
    
    -- Resource requests/limits (applied to created pods)
    resource_requests JSONB DEFAULT '{
        "cpu": 100,
        "memory": 128
    }'::JSONB,
    resource_limits JSONB DEFAULT '{
        "cpu": 500,
        "memory": 512
    }'::JSONB,
    
    -- Scheduling configuration (applied to created pods)
    scheduling JSONB DEFAULT NULL,
    
    -- Observed state (for reconciliation)
    observed_generation BIGINT DEFAULT 0,
    ready_replicas INTEGER DEFAULT 0,
    available_replicas INTEGER DEFAULT 0,
    updated_replicas INTEGER DEFAULT 0,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::JSONB,
    
    -- Ownership
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: name + namespace
    UNIQUE(name, namespace)
);

-- Add service_id to pods for tracking which service owns a pod
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES public.services(id) ON DELETE SET NULL;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_services_name ON public.services(name);
CREATE INDEX IF NOT EXISTS idx_services_namespace ON public.services(namespace);
CREATE INDEX IF NOT EXISTS idx_services_pack_id ON public.services(pack_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON public.services(status);
CREATE INDEX IF NOT EXISTS idx_services_created_by ON public.services(created_by);
CREATE INDEX IF NOT EXISTS idx_services_name_namespace ON public.services(name, namespace);
CREATE INDEX IF NOT EXISTS idx_pods_service_id ON public.pods(service_id);

-- Trigger for updated_at
CREATE TRIGGER trigger_services_updated_at
    BEFORE UPDATE ON public.services
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read services
CREATE POLICY "Anyone can read services"
    ON public.services FOR SELECT
    USING (true);

-- Policy: Authenticated users can create services
CREATE POLICY "Authenticated users can create services"
    ON public.services FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Policy: Creators and admins can update services
CREATE POLICY "Creators and admins can update services"
    ON public.services FOR UPDATE
    USING (
        created_by = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Policy: Creators and admins can delete services
CREATE POLICY "Creators and admins can delete services"
    ON public.services FOR DELETE
    USING (
        created_by = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Comments
COMMENT ON TABLE public.services IS 'Persistent service configurations for pack scheduling';
COMMENT ON COLUMN public.services.replicas IS '0 = deploy to all matching nodes (DaemonSet), >0 = maintain N replicas (Service)';
COMMENT ON COLUMN public.services.scheduling IS 'Scheduling config: nodeSelector, nodeAffinity, podAffinity, podAntiAffinity';
COMMENT ON COLUMN public.pods.service_id IS 'Reference to the service that created this pod (null for standalone pods)';
