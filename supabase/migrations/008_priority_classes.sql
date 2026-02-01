-- Migration: 008_priority_classes
-- Description: Priority classes for scheduling (Kubernetes-like)
-- Stark Orchestrator

-- Preemption policy enum
CREATE TYPE preemption_policy AS ENUM (
    'PreemptLowerPriority',  -- Can preempt lower priority pods
    'Never'                   -- Never preempt other pods
);

-- Priority classes table
CREATE TABLE IF NOT EXISTS public.priority_classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    
    -- Priority value (higher = more important)
    -- Range: -2147483648 to 1000000000 for user-defined
    -- Range: 1000000000+ reserved for system
    value INTEGER NOT NULL,
    
    -- Whether this is the default priority class
    global_default BOOLEAN NOT NULL DEFAULT false,
    
    -- Preemption behavior
    preemption_policy preemption_policy NOT NULL DEFAULT 'PreemptLowerPriority',
    
    -- Description
    description TEXT,
    
    -- Metadata
    labels JSONB DEFAULT '{}'::JSONB,
    annotations JSONB DEFAULT '{}'::JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure only one global default
    CONSTRAINT unique_global_default EXCLUDE (global_default WITH =) WHERE (global_default = true)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_priority_classes_value ON public.priority_classes(value DESC);
CREATE INDEX IF NOT EXISTS idx_priority_classes_global_default ON public.priority_classes(global_default) WHERE global_default = true;

-- Trigger for updated_at
CREATE TRIGGER trigger_priority_classes_updated_at
    BEFORE UPDATE ON public.priority_classes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.priority_classes ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read priority classes
CREATE POLICY "Anyone can read priority classes"
    ON public.priority_classes FOR SELECT
    USING (true);

-- Policy: Admins can manage priority classes
CREATE POLICY "Admins can manage priority classes"
    ON public.priority_classes FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Insert built-in priority classes (Kubernetes-like)
INSERT INTO public.priority_classes (name, value, preemption_policy, description, labels)
VALUES 
    -- System critical (highest priority)
    ('system-node-critical', 2000001000, 'PreemptLowerPriority', 
     'Used for critical node components that must not be evicted', 
     '{"stark.io/system": "true"}'::JSONB),
    
    ('system-cluster-critical', 2000000000, 'PreemptLowerPriority', 
     'Used for critical cluster components', 
     '{"stark.io/system": "true"}'::JSONB),
    
    -- User-defined priorities
    ('high-priority', 1000000, 'PreemptLowerPriority', 
     'High priority user workloads', 
     '{}'::JSONB),
    
    -- Default priority (global default)
    ('default', 0, 'PreemptLowerPriority', 
     'Default priority for pods without explicit priority', 
     '{}'::JSONB),
    
    -- Low priority (can be preempted)
    ('low-priority', -1000, 'Never', 
     'Low priority workloads that can be preempted but won''t preempt others', 
     '{}'::JSONB),
    
    -- Best effort (lowest priority)
    ('best-effort', -1000000, 'Never', 
     'Best effort workloads that run only when resources are available', 
     '{}'::JSONB)
ON CONFLICT (name) DO NOTHING;

-- Set default as global default
UPDATE public.priority_classes 
SET global_default = true 
WHERE name = 'default';

-- Function to get priority class by name
CREATE OR REPLACE FUNCTION get_priority_class(class_name TEXT)
RETURNS public.priority_classes AS $$
BEGIN
    RETURN (SELECT * FROM public.priority_classes WHERE name = class_name);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get default priority class
CREATE OR REPLACE FUNCTION get_default_priority_class()
RETURNS public.priority_classes AS $$
BEGIN
    RETURN (
        SELECT * FROM public.priority_classes 
        WHERE global_default = true 
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get priority value for a pod
CREATE OR REPLACE FUNCTION get_priority_value(class_name TEXT DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
    pc public.priority_classes;
BEGIN
    IF class_name IS NOT NULL THEN
        SELECT * INTO pc FROM public.priority_classes WHERE name = class_name;
        IF pc IS NOT NULL THEN
            RETURN pc.value;
        END IF;
    END IF;
    
    -- Return default priority
    SELECT * INTO pc FROM public.priority_classes WHERE global_default = true;
    IF pc IS NOT NULL THEN
        RETURN pc.value;
    END IF;
    
    -- Fallback to 0
    RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to find pods that can be preempted by a given priority
CREATE OR REPLACE FUNCTION find_preemptable_pods(
    target_node_id UUID,
    preemptor_priority INTEGER,
    required_cpu INTEGER DEFAULT 0,
    required_memory INTEGER DEFAULT 0
)
RETURNS TABLE (
    pod_id UUID,
    priority_value INTEGER,
    cpu_request INTEGER,
    memory_request INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id AS pod_id,
        COALESCE(pc.value, 0) AS priority_value,
        COALESCE((d.resource_requests->>'cpu')::INTEGER, 0) AS cpu_request,
        COALESCE((d.resource_requests->>'memory')::INTEGER, 0) AS memory_request
    FROM public.pods d
    LEFT JOIN public.priority_classes pc ON pc.name = d.metadata->>'priorityClassName'
    WHERE d.node_id = target_node_id
    AND d.status IN ('scheduled', 'starting', 'running')
    AND COALESCE(pc.value, 0) < preemptor_priority
    AND COALESCE(pc.preemption_policy, 'PreemptLowerPriority') = 'PreemptLowerPriority'
    ORDER BY COALESCE(pc.value, 0) ASC, d.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE public.priority_classes IS 'Priority classes for pod scheduling (Kubernetes-like)';
COMMENT ON COLUMN public.priority_classes.value IS 'Priority value: higher means more important';
COMMENT ON COLUMN public.priority_classes.global_default IS 'Whether this is the default priority class for pods without explicit priority';
COMMENT ON COLUMN public.priority_classes.preemption_policy IS 'Whether pods with this priority can preempt lower priority pods';
