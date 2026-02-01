-- Migration: Update roles to simplified structure
-- Description: Changes from admin/operator/developer/viewer to admin/node/viewer
-- 
-- Role changes:
-- - admin: Full access to all resources (unchanged)
-- - node: Node agents - can create/update own node, update pods assigned to it
-- - viewer: Read-only access (unchanged)
-- 
-- Removed roles: operator, developer

-- ============================================================================
-- Update packs table policies
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Developers can create packs" ON public.packs;

-- Packs can only be created by admins now
-- (Nodes don't create packs, they only read them)
CREATE POLICY "Admins can create packs"
    ON public.packs FOR INSERT
    WITH CHECK (public.has_role('admin'));

-- ============================================================================
-- Update nodes table policies
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Operators can register nodes" ON public.nodes;
DROP POLICY IF EXISTS "Operators can update nodes" ON public.nodes;

-- Node agents can register their own nodes
CREATE POLICY "Node agents can register nodes"
    ON public.nodes FOR INSERT
    WITH CHECK (public.has_any_role(ARRAY['node', 'admin']));

-- Node agents can update their own nodes (ownership enforced in app layer)
CREATE POLICY "Node agents can update nodes"
    ON public.nodes FOR UPDATE
    USING (public.has_any_role(ARRAY['node', 'admin']));

-- ============================================================================
-- Update pods table policies
-- ============================================================================

-- Drop old policies referencing developer/operator
DROP POLICY IF EXISTS "Developers can create pods" ON public.pods;
DROP POLICY IF EXISTS "Operators can update pods" ON public.pods;

-- Only admins create pods (scheduler creates them)
CREATE POLICY "Admins can create pods"
    ON public.pods FOR INSERT
    WITH CHECK (public.has_role('admin'));

-- Node agents can update pod status for pods assigned to them
CREATE POLICY "Node agents can update pods"
    ON public.pods FOR UPDATE
    USING (public.has_any_role(ARRAY['node', 'admin']));

-- ============================================================================
-- Update namespaces table policies
-- ============================================================================

-- Drop old policies referencing operator
DROP POLICY IF EXISTS "Operators can manage namespaces" ON public.namespaces;

-- Only admins can manage namespaces
CREATE POLICY "Admins can manage namespaces"
    ON public.namespaces FOR ALL
    USING (public.has_role('admin'));

-- ============================================================================
-- Update pod_history table policies
-- ============================================================================

-- Drop old policies referencing operator
DROP POLICY IF EXISTS "Operators can view pod history" ON public.pod_history;

-- Admins and nodes can view pod history
CREATE POLICY "Admins and nodes can view pod history"
    ON public.pod_history FOR SELECT
    USING (public.has_any_role(ARRAY['node', 'admin', 'viewer']));

-- ============================================================================
-- Comment documenting the new role structure
-- ============================================================================

COMMENT ON TABLE public.users IS 'User accounts with roles: admin (full access), node (node agents), viewer (read-only)';
