-- Migration: 015_follow_latest
-- Description: Add follow_latest column to deployments for auto-updating to newest pack versions
-- Stark Orchestrator

-- Add follow_latest column to deployments
-- When true, the deployment will automatically update pods when a new version of the pack is registered
ALTER TABLE public.deployments 
ADD COLUMN IF NOT EXISTS follow_latest BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for efficient querying of deployments that follow latest
CREATE INDEX IF NOT EXISTS idx_deployments_follow_latest ON public.deployments(follow_latest) WHERE follow_latest = TRUE;

-- Add comment explaining the feature
COMMENT ON COLUMN public.deployments.follow_latest IS 
    'When true, the deployment automatically updates to the latest pack version when new versions are registered';
