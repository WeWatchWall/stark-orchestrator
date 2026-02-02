-- Migration: 016_rollback_protection
-- Description: Add crash-loop protection and auto-rollback support to deployments
-- Stark Orchestrator

-- Add columns for tracking upgrade failures and enabling auto-rollback
ALTER TABLE public.deployments 
ADD COLUMN IF NOT EXISTS last_successful_version TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS failed_version TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS failure_backoff_until TIMESTAMPTZ DEFAULT NULL;

-- Add index for efficient querying of deployments in failure state
CREATE INDEX IF NOT EXISTS idx_deployments_failure_backoff 
ON public.deployments(failure_backoff_until) 
WHERE failure_backoff_until IS NOT NULL;

-- Add comments explaining the new columns
COMMENT ON COLUMN public.deployments.last_successful_version IS 
    'The last pack version that ran successfully (for auto-rollback)';
COMMENT ON COLUMN public.deployments.failed_version IS 
    'Pack version that failed during upgrade (to prevent retry loops)';
COMMENT ON COLUMN public.deployments.consecutive_failures IS 
    'Count of consecutive pod failures since last success (for crash-loop detection)';
COMMENT ON COLUMN public.deployments.failure_backoff_until IS 
    'Timestamp until which upgrade retries should be skipped (exponential backoff)';

