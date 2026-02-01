-- Migration: 009_kubernetes_like_fields
-- Description: Add labels, taints, tolerations, scheduling fields to nodes/pods
-- Stark Orchestrator

-- ============================================================================
-- TAINT EFFECT ENUM
-- ============================================================================

CREATE TYPE taint_effect AS ENUM (
    'NoSchedule',       -- Don't schedule new pods
    'PreferNoSchedule', -- Try not to schedule new pods
    'NoExecute'         -- Evict existing pods and don't schedule new ones
);

-- ============================================================================
-- ADD KUBERNETES-LIKE FIELDS TO NODES
-- ============================================================================

-- Labels: Key-value pairs for organization and selection
ALTER TABLE public.nodes 
ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '{}'::JSONB;

-- Annotations: Non-identifying metadata
ALTER TABLE public.nodes 
ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '{}'::JSONB;

-- Taints: Repel pods unless they have matching tolerations
-- Format: [{"key": "dedicated", "value": "gpu", "effect": "NoSchedule"}]
ALTER TABLE public.nodes 
ADD COLUMN IF NOT EXISTS taints JSONB DEFAULT '[]'::JSONB;

-- Unschedulable: Prevent new pods from being scheduled
ALTER TABLE public.nodes 
ADD COLUMN IF NOT EXISTS unschedulable BOOLEAN DEFAULT false;

-- Indexes for labels (for label selector queries)
CREATE INDEX IF NOT EXISTS idx_nodes_labels ON public.nodes USING GIN(labels);

-- ============================================================================
-- ADD KUBERNETES-LIKE FIELDS TO PODS
-- ============================================================================

-- Namespace reference
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS namespace TEXT DEFAULT 'default' REFERENCES public.namespaces(name);

-- Labels: Key-value pairs for organization and selection
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '{}'::JSONB;

-- Annotations: Non-identifying metadata
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '{}'::JSONB;

-- Priority class name reference
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS priority_class_name TEXT REFERENCES public.priority_classes(name);

-- Priority value (cached from priority class for efficient queries)
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

-- Tolerations: Allow scheduling on tainted nodes
-- Format: [{"key": "dedicated", "operator": "Equal", "value": "gpu", "effect": "NoSchedule"}]
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS tolerations JSONB DEFAULT '[]'::JSONB;

-- Node selector: Simple label-based node selection
-- Format: {"disktype": "ssd", "zone": "us-west-1"}
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS node_selector JSONB DEFAULT '{}'::JSONB;

-- Node affinity: Advanced node selection rules
-- Format: {
--   "requiredDuringSchedulingIgnoredDuringExecution": {...},
--   "preferredDuringSchedulingIgnoredDuringExecution": [...]
-- }
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS node_affinity JSONB DEFAULT NULL;

-- Pod affinity: Co-location rules
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS pod_affinity JSONB DEFAULT NULL;

-- Pod anti-affinity: Anti co-location rules
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS pod_anti_affinity JSONB DEFAULT NULL;

-- Indexes for pods
CREATE INDEX IF NOT EXISTS idx_pods_namespace ON public.pods(namespace);
CREATE INDEX IF NOT EXISTS idx_pods_labels ON public.pods USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_pods_priority ON public.pods(priority DESC);
CREATE INDEX IF NOT EXISTS idx_pods_priority_class ON public.pods(priority_class_name);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to check if a pod tolerates a node's taints
CREATE OR REPLACE FUNCTION pod_tolerates_node(
    pod_tolerations JSONB,
    node_taints JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
    taint JSONB;
    toleration JSONB;
    tolerates_taint BOOLEAN;
BEGIN
    -- If node has no taints, pod is allowed
    IF node_taints IS NULL OR jsonb_array_length(node_taints) = 0 THEN
        RETURN TRUE;
    END IF;
    
    -- Check each taint
    FOR taint IN SELECT * FROM jsonb_array_elements(node_taints) LOOP
        tolerates_taint := FALSE;
        
        -- Check if any toleration matches this taint
        IF pod_tolerations IS NOT NULL THEN
            FOR toleration IN SELECT * FROM jsonb_array_elements(pod_tolerations) LOOP
                -- Empty key with Exists operator tolerates all
                IF toleration->>'operator' = 'Exists' AND 
                   (toleration->>'key' IS NULL OR toleration->>'key' = '') THEN
                    tolerates_taint := TRUE;
                    EXIT;
                END IF;
                
                -- Key must match
                IF toleration->>'key' = taint->>'key' THEN
                    -- Exists operator: key match is enough
                    IF toleration->>'operator' = 'Exists' THEN
                        -- Effect must match (or be empty for all effects)
                        IF toleration->>'effect' IS NULL OR 
                           toleration->>'effect' = '' OR 
                           toleration->>'effect' = taint->>'effect' THEN
                            tolerates_taint := TRUE;
                            EXIT;
                        END IF;
                    -- Equal operator (default): value must also match
                    ELSIF COALESCE(toleration->>'operator', 'Equal') = 'Equal' THEN
                        IF toleration->>'value' = taint->>'value' THEN
                            IF toleration->>'effect' IS NULL OR 
                               toleration->>'effect' = '' OR 
                               toleration->>'effect' = taint->>'effect' THEN
                                tolerates_taint := TRUE;
                                EXIT;
                            END IF;
                        END IF;
                    END IF;
                END IF;
            END LOOP;
        END IF;
        
        -- If pod doesn't tolerate this taint, it can't be scheduled
        IF NOT tolerates_taint THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if a node matches a label selector
CREATE OR REPLACE FUNCTION node_matches_selector(
    node_labels JSONB,
    selector JSONB
)
RETURNS BOOLEAN AS $$
DECLARE
    key TEXT;
    value TEXT;
BEGIN
    -- If no selector, all nodes match
    IF selector IS NULL OR selector = '{}'::JSONB THEN
        RETURN TRUE;
    END IF;
    
    -- If no labels, can't match non-empty selector
    IF node_labels IS NULL OR node_labels = '{}'::JSONB THEN
        RETURN FALSE;
    END IF;
    
    -- Check each selector key-value pair
    FOR key, value IN SELECT * FROM jsonb_each_text(selector) LOOP
        IF node_labels->>key IS NULL OR node_labels->>key != value THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get schedulable nodes for a pod
CREATE OR REPLACE FUNCTION get_schedulable_nodes(
    target_runtime runtime_type,
    pod_node_selector JSONB DEFAULT '{}'::JSONB,
    pod_tolerations JSONB DEFAULT '[]'::JSONB
)
RETURNS TABLE (
    node_id UUID,
    node_name TEXT,
    runtime_type runtime_type,
    labels JSONB,
    allocatable JSONB,
    allocated JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        n.id AS node_id,
        n.name AS node_name,
        n.runtime_type,
        n.labels,
        n.allocatable,
        n.allocated
    FROM public.nodes n
    WHERE n.status = 'online'
    AND n.unschedulable = false
    AND (target_runtime IS NULL OR n.runtime_type = target_runtime)
    AND node_matches_selector(n.labels, pod_node_selector)
    AND pod_tolerates_node(pod_tolerations, n.taints);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-set priority from priority class
CREATE OR REPLACE FUNCTION set_pod_priority()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.priority_class_name IS NOT NULL THEN
        NEW.priority := get_priority_value(NEW.priority_class_name);
    ELSE
        NEW.priority := get_priority_value(NULL);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_pod_priority
    BEFORE INSERT OR UPDATE OF priority_class_name ON public.pods
    FOR EACH ROW
    EXECUTE FUNCTION set_pod_priority();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN public.nodes.labels IS 'Key-value labels for organization and selection';
COMMENT ON COLUMN public.nodes.annotations IS 'Non-identifying metadata';
COMMENT ON COLUMN public.nodes.taints IS 'Taints that repel pods without matching tolerations';
COMMENT ON COLUMN public.nodes.unschedulable IS 'When true, prevents new pod scheduling';

COMMENT ON COLUMN public.pods.namespace IS 'Namespace for resource isolation';
COMMENT ON COLUMN public.pods.labels IS 'Key-value labels for organization and selection';
COMMENT ON COLUMN public.pods.annotations IS 'Non-identifying metadata';
COMMENT ON COLUMN public.pods.priority_class_name IS 'Reference to priority class';
COMMENT ON COLUMN public.pods.priority IS 'Cached priority value for efficient queries';
COMMENT ON COLUMN public.pods.tolerations IS 'Tolerations for scheduling on tainted nodes';
COMMENT ON COLUMN public.pods.node_selector IS 'Simple label-based node selection';
COMMENT ON COLUMN public.pods.node_affinity IS 'Advanced node selection rules';
COMMENT ON COLUMN public.pods.pod_affinity IS 'Co-location rules with other pods';
COMMENT ON COLUMN public.pods.pod_anti_affinity IS 'Anti co-location rules';
