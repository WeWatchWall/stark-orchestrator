-- Migration: 025_node_lease_pod_incarnation
-- Description: Add node lease system and pod incarnation for double-deploy prevention
-- Stark Orchestrator
--
-- This migration adds:
-- 1. 'suspect' status for nodes (held during lease grace period)
-- 2. suspect_since timestamp to track when node became suspect
-- 3. incarnation field on pods for tracking replacement generations

-- Add 'suspect' to node_status enum
-- 'suspect' means: node disconnected but lease hasn't expired yet
-- Pods remain logically owned, no replacements scheduled
ALTER TYPE node_status ADD VALUE IF NOT EXISTS 'suspect' AFTER 'online';

-- Add lease-related fields to nodes table
ALTER TABLE public.nodes 
ADD COLUMN IF NOT EXISTS suspect_since TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.nodes.suspect_since IS 
  'Timestamp when node entered suspect state. NULL when node is not suspect. Used for lease expiration.';

-- Add incarnation field to pods table
-- Incremented each time a replacement pod is created for the same deployment slot
ALTER TABLE public.pods
ADD COLUMN IF NOT EXISTS incarnation INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.pods.incarnation IS 
  'Monotonic incarnation ID. Incremented when scheduling replacements. Used to reject late messages from old incarnations.';

-- Index for finding pods by incarnation (for validation)
CREATE INDEX IF NOT EXISTS idx_pods_incarnation
ON public.pods(id, incarnation);

