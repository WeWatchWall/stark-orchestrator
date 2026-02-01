-- Migration: 011_bundle_content
-- Description: Add bundle_content column to packs table for storing JavaScript bundle code directly
-- Stark Orchestrator

-- Add bundle_content column to store the actual bundle code
ALTER TABLE public.packs ADD COLUMN IF NOT EXISTS bundle_content TEXT;

-- Add comment describing the column
COMMENT ON COLUMN public.packs.bundle_content IS 'JavaScript bundle content stored directly in the database';

-- Create index for packs that have bundle content (partial index for efficiency)
CREATE INDEX IF NOT EXISTS idx_packs_has_bundle ON public.packs((bundle_content IS NOT NULL)) WHERE bundle_content IS NOT NULL;
