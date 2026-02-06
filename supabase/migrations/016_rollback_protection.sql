-- Migration: 016_rollback_protection
-- Description: Add crash-loop protection and auto-rollback support to services
-- Stark Orchestrator

-- Add columns for tracking upgrade failures and enabling auto-rollback
ALTER TABLE public.services 
ADD COLUMN IF NOT EXISTS last_successful_version TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS failed_version TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS failure_backoff_until TIMESTAMPTZ DEFAULT NULL;

-- Add index for efficient querying of services in failure state
CREATE INDEX IF NOT EXISTS idx_services_failure_backoff 
ON public.services(failure_backoff_until) 
WHERE failure_backoff_until IS NOT NULL;

-- Add comments explaining the new columns
COMMENT ON COLUMN public.services.last_successful_version IS 
    'The last pack version that ran successfully (for auto-rollback)';
COMMENT ON COLUMN public.services.failed_version IS 
    'Pack version that failed during upgrade (to prevent retry loops)';
COMMENT ON COLUMN public.services.consecutive_failures IS 
    'Count of consecutive pod failures since last success (for crash-loop detection)';
COMMENT ON COLUMN public.services.failure_backoff_until IS 
    'Timestamp until which upgrade retries should be skipped (exponential backoff)';

