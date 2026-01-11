-- Seed: Development test data
-- Description: Sample data for local development and testing
-- Stark Orchestrator
-- 
-- NOTE: This seed file assumes Supabase Auth has created users first.
-- For local development, create users via Supabase Auth UI or API first.

-- ============================================================================
-- USERS (profiles will be auto-created by trigger when auth users are created)
-- ============================================================================

-- For development, we'll insert directly into users table with UUIDs
-- These should match auth.users created via Supabase Auth

-- Admin user
INSERT INTO public.users (id, email, display_name, roles)
VALUES (
    '00000000-0000-0000-0000-000000000001'::UUID,
    'admin@stark.local',
    'Admin User',
    ARRAY['admin', 'operator', 'developer', 'viewer']
) ON CONFLICT (id) DO NOTHING;

-- Operator user
INSERT INTO public.users (id, email, display_name, roles)
VALUES (
    '00000000-0000-0000-0000-000000000002'::UUID,
    'operator@stark.local',
    'Operator User',
    ARRAY['operator', 'viewer']
) ON CONFLICT (id) DO NOTHING;

-- Developer user
INSERT INTO public.users (id, email, display_name, roles)
VALUES (
    '00000000-0000-0000-0000-000000000003'::UUID,
    'developer@stark.local',
    'Developer User',
    ARRAY['developer', 'viewer']
) ON CONFLICT (id) DO NOTHING;

-- Viewer user
INSERT INTO public.users (id, email, display_name, roles)
VALUES (
    '00000000-0000-0000-0000-000000000004'::UUID,
    'viewer@stark.local',
    'Viewer User',
    ARRAY['viewer']
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PACKS
-- ============================================================================

-- Simple Node.js pack
INSERT INTO public.packs (id, name, version, runtime_tag, owner_id, bundle_path, description, metadata)
VALUES (
    '10000000-0000-0000-0000-000000000001'::UUID,
    'hello-world',
    '1.0.0',
    'node',
    '00000000-0000-0000-0000-000000000003'::UUID,
    '/packs/hello-world/1.0.0/bundle.js',
    'Simple hello world pack for testing',
    '{"entrypoint": "main", "timeout": 30000}'::JSONB
) ON CONFLICT DO NOTHING;

-- Updated version of hello-world
INSERT INTO public.packs (id, name, version, runtime_tag, owner_id, bundle_path, description, metadata)
VALUES (
    '10000000-0000-0000-0000-000000000002'::UUID,
    'hello-world',
    '1.1.0',
    'node',
    '00000000-0000-0000-0000-000000000003'::UUID,
    '/packs/hello-world/1.1.0/bundle.js',
    'Simple hello world pack for testing (updated)',
    '{"entrypoint": "main", "timeout": 30000}'::JSONB
) ON CONFLICT DO NOTHING;

-- Browser pack
INSERT INTO public.packs (id, name, version, runtime_tag, owner_id, bundle_path, description, metadata)
VALUES (
    '10000000-0000-0000-0000-000000000003'::UUID,
    'browser-widget',
    '1.0.0',
    'browser',
    '00000000-0000-0000-0000-000000000003'::UUID,
    '/packs/browser-widget/1.0.0/bundle.js',
    'Browser-only widget pack',
    '{"entrypoint": "render", "timeout": 10000}'::JSONB
) ON CONFLICT DO NOTHING;

-- Universal pack
INSERT INTO public.packs (id, name, version, runtime_tag, owner_id, bundle_path, description, metadata)
VALUES (
    '10000000-0000-0000-0000-000000000004'::UUID,
    'data-processor',
    '2.0.0',
    'universal',
    '00000000-0000-0000-0000-000000000001'::UUID,
    '/packs/data-processor/2.0.0/bundle.js',
    'Universal data processing pack',
    '{"entrypoint": "process", "timeout": 60000}'::JSONB
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- NODES
-- ============================================================================

-- Node.js server node (online)
INSERT INTO public.nodes (id, name, runtime_type, status, last_heartbeat, capabilities, registered_by, allocatable)
VALUES (
    '20000000-0000-0000-0000-000000000001'::UUID,
    'node-server-1',
    'node',
    'online',
    NOW(),
    '{"version": "20.0.0", "features": ["worker_threads", "esm"]}'::JSONB,
    '00000000-0000-0000-0000-000000000002'::UUID,
    '{"cpu": 4000, "memory": 8192, "pods": 50, "storage": 102400}'::JSONB
) ON CONFLICT DO NOTHING;

-- Node.js server node (offline)
INSERT INTO public.nodes (id, name, runtime_type, status, last_heartbeat, capabilities, registered_by, allocatable)
VALUES (
    '20000000-0000-0000-0000-000000000002'::UUID,
    'node-server-2',
    'node',
    'offline',
    NOW() - INTERVAL '5 minutes',
    '{"version": "18.0.0", "features": ["worker_threads"]}'::JSONB,
    '00000000-0000-0000-0000-000000000002'::UUID,
    '{"cpu": 2000, "memory": 4096, "pods": 25, "storage": 51200}'::JSONB
) ON CONFLICT DO NOTHING;

-- Browser node (online)
INSERT INTO public.nodes (id, name, runtime_type, status, last_heartbeat, capabilities, registered_by, allocatable)
VALUES (
    '20000000-0000-0000-0000-000000000003'::UUID,
    'browser-client-1',
    'browser',
    'online',
    NOW(),
    '{"userAgent": "Chrome/120", "features": ["web_workers", "indexeddb", "wasm"]}'::JSONB,
    '00000000-0000-0000-0000-000000000002'::UUID,
    '{"cpu": 1000, "memory": 1024, "pods": 10, "storage": 5120}'::JSONB
) ON CONFLICT DO NOTHING;

-- Browser node (unhealthy)
INSERT INTO public.nodes (id, name, runtime_type, status, last_heartbeat, capabilities, registered_by, allocatable)
VALUES (
    '20000000-0000-0000-0000-000000000004'::UUID,
    'browser-client-2',
    'browser',
    'unhealthy',
    NOW() - INTERVAL '45 seconds',
    '{"userAgent": "Firefox/121", "features": ["web_workers", "indexeddb"]}'::JSONB,
    '00000000-0000-0000-0000-000000000002'::UUID,
    '{"cpu": 1000, "memory": 1024, "pods": 10, "storage": 5120}'::JSONB
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- PODS
-- ============================================================================

-- Running pod
INSERT INTO public.pods (id, pack_id, pack_version, node_id, status, created_by, scheduled_at, started_at)
VALUES (
    '30000000-0000-0000-0000-000000000001'::UUID,
    '10000000-0000-0000-0000-000000000001'::UUID,
    '1.0.0',
    '20000000-0000-0000-0000-000000000001'::UUID,
    'running',
    '00000000-0000-0000-0000-000000000003'::UUID,
    NOW() - INTERVAL '1 hour',
    NOW() - INTERVAL '59 minutes'
) ON CONFLICT DO NOTHING;

-- Pending pod (waiting for scheduling)
INSERT INTO public.pods (id, pack_id, pack_version, node_id, status, created_by)
VALUES (
    '30000000-0000-0000-0000-000000000002'::UUID,
    '10000000-0000-0000-0000-000000000002'::UUID,
    '1.1.0',
    NULL,
    'pending',
    '00000000-0000-0000-0000-000000000003'::UUID
) ON CONFLICT DO NOTHING;

-- Stopped pod
INSERT INTO public.pods (id, pack_id, pack_version, node_id, status, created_by, scheduled_at, started_at, stopped_at)
VALUES (
    '30000000-0000-0000-0000-000000000003'::UUID,
    '10000000-0000-0000-0000-000000000003'::UUID,
    '1.0.0',
    '20000000-0000-0000-0000-000000000003'::UUID,
    'stopped',
    '00000000-0000-0000-0000-000000000003'::UUID,
    NOW() - INTERVAL '2 hours',
    NOW() - INTERVAL '1 hour 55 minutes',
    NOW() - INTERVAL '30 minutes'
) ON CONFLICT DO NOTHING;

-- Failed pod
INSERT INTO public.pods (id, pack_id, pack_version, node_id, status, status_message, created_by, scheduled_at, started_at, stopped_at)
VALUES (
    '30000000-0000-0000-0000-000000000004'::UUID,
    '10000000-0000-0000-0000-000000000004'::UUID,
    '2.0.0',
    '20000000-0000-0000-0000-000000000001'::UUID,
    'failed',
    'OutOfMemory: Pack exceeded memory limit',
    '00000000-0000-0000-0000-000000000001'::UUID,
    NOW() - INTERVAL '3 hours',
    NOW() - INTERVAL '2 hours 58 minutes',
    NOW() - INTERVAL '2 hours 50 minutes'
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- POD HISTORY (manual entries for testing)
-- ============================================================================

-- History for running pod
INSERT INTO public.pod_history (pod_id, action, actor_id, previous_status, new_status, previous_version, new_version, reason, message)
VALUES (
    '30000000-0000-0000-0000-000000000001'::UUID,
    'created',
    '00000000-0000-0000-0000-000000000003'::UUID,
    NULL,
    'pending',
    NULL,
    '1.0.0',
    'UserRequest',
    'Pod created by developer'
) ON CONFLICT DO NOTHING;

INSERT INTO public.pod_history (pod_id, action, actor_id, previous_status, new_status, reason, message)
VALUES (
    '30000000-0000-0000-0000-000000000001'::UUID,
    'scheduled',
    NULL,
    'pending',
    'scheduled',
    'SchedulerDecision',
    'Pod scheduled to node-server-1'
) ON CONFLICT DO NOTHING;

INSERT INTO public.pod_history (pod_id, action, actor_id, previous_status, new_status, reason, message)
VALUES (
    '30000000-0000-0000-0000-000000000001'::UUID,
    'started',
    NULL,
    'scheduled',
    'running',
    'NodeReport',
    'Pod started successfully'
) ON CONFLICT DO NOTHING;

-- Print summary
DO $$
BEGIN
    RAISE NOTICE 'Seed data loaded successfully:';
    RAISE NOTICE '  - Users: %', (SELECT COUNT(*) FROM public.users);
    RAISE NOTICE '  - Packs: %', (SELECT COUNT(*) FROM public.packs);
    RAISE NOTICE '  - Nodes: %', (SELECT COUNT(*) FROM public.nodes);
    RAISE NOTICE '  - Pods: %', (SELECT COUNT(*) FROM public.pods);
    RAISE NOTICE '  - Pod History: %', (SELECT COUNT(*) FROM public.pod_history);
END $$;
