-- Migration: Add canonical failure reason classification
-- This provides structured failure/termination reasons instead of relying on free-form messages

-- Pod termination reason enum
-- Represents WHY a pod transitioned to a terminal state (stopped/failed/evicted)
CREATE TYPE pod_termination_reason AS ENUM (
    -- Infrastructure reasons (should NOT trigger crash loop)
    'node_lost',              -- Node disconnected or went offline
    'node_unhealthy',         -- Node failed health checks
    'node_draining',          -- Node is being drained for maintenance
    'node_maintenance',       -- Node entered maintenance mode
    
    -- Resource reasons
    'oom_killed',             -- Out of memory
    'evicted_resources',      -- Evicted due to resource pressure
    'preempted',              -- Preempted by higher priority pod
    'quota_exceeded',         -- Resource quota exceeded
    
    -- Application reasons (SHOULD trigger crash loop if repeated)
    'error',                  -- Generic application error/crash
    'init_error',             -- Failed during initialization
    'config_error',           -- Configuration error
    'pack_load_error',        -- Failed to load pack/bundle
    
    -- Operator/user initiated (should NOT trigger crash loop)
    'user_stopped',           -- Manual stop by user/operator
    'rolling_update',         -- Replaced during rolling update
    'scaled_down',            -- Removed due to scale down
    'service_deleted',     -- Parent service was deleted
    
    -- Lifecycle reasons
    'completed',              -- Normal completion (for job-like pods)
    'deadline_exceeded',      -- Execution deadline exceeded
    
    -- Unknown
    'unknown'                 -- Reason not determined
);

-- Add failure_reason column to pods table
ALTER TABLE public.pods 
ADD COLUMN IF NOT EXISTS termination_reason pod_termination_reason DEFAULT NULL;

-- Add index for querying by termination reason
CREATE INDEX IF NOT EXISTS idx_pods_termination_reason ON public.pods(termination_reason) 
WHERE termination_reason IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.pods.termination_reason IS 'Canonical reason for pod termination. Used for crash loop detection and observability.';
COMMENT ON TYPE pod_termination_reason IS 'Canonical enumeration of reasons why a pod terminated. Infrastructure reasons do not count toward crash loops.';
