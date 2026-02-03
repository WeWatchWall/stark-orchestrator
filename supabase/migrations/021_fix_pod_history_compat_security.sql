-- Migration: 021_fix_pod_history_compat_security
-- Description: Fix security issue with pod_history_compat view by adding security_invoker
-- Stark Orchestrator
--
-- The pod_history_compat view was accidentally created without security_invoker = on,
-- which could expose the pod_history table data to users who shouldn't have access.
-- This migration recreates the view with proper security settings.

-- Drop and recreate the view with security_invoker = on
DROP VIEW IF EXISTS public.pod_history_compat;

CREATE VIEW public.pod_history_compat WITH (security_invoker = on) AS
SELECT
    e.id,
    e.resource_id AS pod_id,
    CASE e.event_type
        WHEN 'PodCreated' THEN 'created'::pod_action
        WHEN 'PodScheduled' THEN 'scheduled'::pod_action
        WHEN 'PodStarted' THEN 'started'::pod_action
        WHEN 'PodRunning' THEN 'started'::pod_action
        WHEN 'PodStarting' THEN 'started'::pod_action
        WHEN 'PodStopped' THEN 'stopped'::pod_action
        WHEN 'PodFailed' THEN 'failed'::pod_action
        WHEN 'PodRestarted' THEN 'restarted'::pod_action
        WHEN 'PodRolledBack' THEN 'rolled_back'::pod_action
        WHEN 'PodEvicted' THEN 'evicted'::pod_action
        WHEN 'PodScaled' THEN 'scaled'::pod_action
        WHEN 'PodUpdated' THEN 'updated'::pod_action
        WHEN 'PodDeleted' THEN 'deleted'::pod_action
        ELSE 'updated'::pod_action
    END AS action,
    e.actor_id,
    (e.previous_state->>'status')::pod_status AS previous_status,
    (e.new_state->>'status')::pod_status AS new_status,
    e.previous_state->>'version' AS previous_version,
    e.new_state->>'version' AS new_version,
    NULL::UUID AS previous_node_id,  -- Not tracked in events
    e.related_resource_id AS new_node_id,
    e.reason,
    e.message,
    e.metadata,
    e.created_at
FROM public.events e
WHERE e.category = 'pod';

COMMENT ON VIEW public.pod_history_compat IS 'Backwards compatibility view for pod_history. Maps events to the old pod_history format. Uses security_invoker to respect RLS policies.';
