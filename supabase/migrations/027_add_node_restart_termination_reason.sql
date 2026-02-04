-- Migration: Add 'node_restart' to pod_termination_reason enum
-- This reason is used when a node agent restarts and orphaned pods need to be cleaned up
-- Without this, the stopOrphanedPodsOnNode function silently fails to update pods

-- Add the 'node_restart' value to the pod_termination_reason enum
-- We add it after 'node_lost' to keep infrastructure reasons grouped together
ALTER TYPE pod_termination_reason ADD VALUE IF NOT EXISTS 'node_restart' AFTER 'node_lost';

-- Note: IF NOT EXISTS requires PostgreSQL 9.3+
-- The AFTER clause requires PostgreSQL 9.6+ and ensures proper ordering
