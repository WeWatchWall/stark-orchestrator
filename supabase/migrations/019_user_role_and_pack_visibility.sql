-- Migration: Add user role and pack visibility
-- Description: Introduces the 'user' role for self-service users and pack visibility
-- to control who can deploy which packs.
--
-- Role changes:
-- - admin: Full access to all resources (unchanged)
-- - user: Can create/manage own packs, nodes, services (NEW)
-- - node: Node agents - can create/update own node, update pods assigned to it (unchanged)
-- - viewer: Read-only access (unchanged)
--
-- Pack visibility:
-- - private: Only owner can read/deploy (default)
-- - public: Anyone can read/deploy

-- ============================================================================
-- Add visibility column to packs
-- ============================================================================

ALTER TABLE public.packs 
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public'));

-- Add index for visibility queries
CREATE INDEX IF NOT EXISTS idx_packs_visibility ON public.packs(visibility);

-- ============================================================================
-- Update packs table policies for visibility
-- ============================================================================

-- Drop old read policy
DROP POLICY IF EXISTS "Anyone can read packs" ON public.packs;

-- New read policy: public packs, own packs, or admin
CREATE POLICY "Users can read accessible packs"
    ON public.packs FOR SELECT
    USING (
        visibility = 'public' 
        OR owner_id = auth.uid() 
        OR public.has_role('admin')
    );

-- Drop old create policy
DROP POLICY IF EXISTS "Admins can create packs" ON public.packs;
DROP POLICY IF EXISTS "Only admins can create packs" ON public.packs;

-- Users can create their own packs
CREATE POLICY "Users can create own packs"
    ON public.packs FOR INSERT
    WITH CHECK (
        owner_id = auth.uid()
        AND public.has_any_role(ARRAY['admin', 'user'])
    );

-- ============================================================================
-- Update nodes table policies for user ownership
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Node agents can register nodes" ON public.nodes;
DROP POLICY IF EXISTS "Node agents can update nodes" ON public.nodes;

-- Users and node agents can register nodes (they become owner via registered_by)
CREATE POLICY "Users and agents can register nodes"
    ON public.nodes FOR INSERT
    WITH CHECK (
        registered_by = auth.uid()
        AND public.has_any_role(ARRAY['admin', 'user', 'node'])
    );

-- Users can update their own nodes, admins can update any
CREATE POLICY "Owners and admins can update nodes"
    ON public.nodes FOR UPDATE
    USING (
        registered_by = auth.uid() 
        OR public.has_role('admin')
    );

-- ============================================================================
-- Update pods table policies
-- ============================================================================

-- Drop old policy
DROP POLICY IF EXISTS "Admins can create pods" ON public.pods;

-- Users can create pods for their own services, admins can create any
-- Note: The service controller uses service client, so this is for direct pod creation
CREATE POLICY "Users and admins can create pods"
    ON public.pods FOR INSERT
    WITH CHECK (
        created_by = auth.uid()
        AND public.has_any_role(ARRAY['admin', 'user'])
    );

-- ============================================================================
-- Update services table policies
-- ============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "Authenticated users can create services" ON public.services;

-- Users can create their own services
CREATE POLICY "Users can create own services"
    ON public.services FOR INSERT
    WITH CHECK (
        created_by = auth.uid()
        AND public.has_any_role(ARRAY['admin', 'user'])
    );

-- ============================================================================
-- Helper function to check pack access
-- ============================================================================

-- Function to check if a user can access a pack (for use in triggers)
CREATE OR REPLACE FUNCTION public.can_access_pack(pack_id UUID, user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    pack_visibility TEXT;
    pack_owner_id UUID;
    user_is_admin BOOLEAN;
BEGIN
    -- Get pack info
    SELECT visibility, owner_id 
    INTO pack_visibility, pack_owner_id 
    FROM public.packs 
    WHERE id = pack_id;
    
    -- Pack not found
    IF pack_visibility IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Public packs are accessible to all
    IF pack_visibility = 'public' THEN
        RETURN TRUE;
    END IF;
    
    -- Owner can access their own pack
    IF pack_owner_id = user_id THEN
        RETURN TRUE;
    END IF;
    
    -- Check if user is admin
    SELECT 'admin' = ANY(roles) INTO user_is_admin
    FROM public.users
    WHERE id = user_id;
    
    IF user_is_admin THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Helper function to check node ownership
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_deploy_to_node(node_id UUID, pack_owner_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    node_owner_id UUID;
    node_owner_is_admin BOOLEAN;
BEGIN
    -- Get node owner
    SELECT registered_by INTO node_owner_id
    FROM public.nodes
    WHERE id = node_id;
    
    -- Node not found or unowned
    IF node_owner_id IS NULL THEN
        RETURN TRUE;  -- Unowned nodes are open infrastructure
    END IF;
    
    -- Pack owner matches node owner
    IF node_owner_id = pack_owner_id THEN
        RETURN TRUE;
    END IF;
    
    -- Check if node owner is admin (admin nodes are shared infrastructure)
    SELECT 'admin' = ANY(roles) INTO node_owner_is_admin
    FROM public.users
    WHERE id = node_owner_id;
    
    IF node_owner_is_admin THEN
        RETURN TRUE;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Comment documenting the new role structure
-- ============================================================================

COMMENT ON TABLE public.users IS 'User accounts with roles: admin (full access), user (self-service), node (node agents), viewer (read-only)';
COMMENT ON COLUMN public.packs.visibility IS 'Pack visibility: private (owner only) or public (everyone)';
