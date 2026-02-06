-- Migration: 015_follow_latest
-- Description: Add follow_latest column to services for auto-updating to newest pack versions
-- Stark Orchestrator

-- Add follow_latest column to services
-- When true, the service will automatically update pods when a new version of the pack is registered
ALTER TABLE public.services 
ADD COLUMN IF NOT EXISTS follow_latest BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for efficient querying of services that follow latest
CREATE INDEX IF NOT EXISTS idx_services_follow_latest ON public.services(follow_latest) WHERE follow_latest = TRUE;

-- Add comment explaining the feature
COMMENT ON COLUMN public.services.follow_latest IS 
    'When true, the service automatically updates to the latest pack version when new versions are registered';
