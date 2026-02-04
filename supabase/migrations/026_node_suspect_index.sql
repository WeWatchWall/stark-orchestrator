-- Migration: 026_node_suspect_index
-- Description: Add partial index for suspect nodes (separated from enum addition)
-- Stark Orchestrator
--
-- NOTE: This is split from 025 because PostgreSQL doesn't allow using newly added
-- enum values in WHERE clauses within the same transaction.

-- Index for efficient lease expiration queries
CREATE INDEX IF NOT EXISTS idx_nodes_suspect_since 
ON public.nodes(suspect_since) 
WHERE status = 'suspect';
