-- Migration: 010_fix_rls_recursion
-- Description: Fix infinite recursion in RLS policies by using auth.jwt() instead of querying users table
-- Stark Orchestrator
--
-- Problem: The "Admins can read all users" policy on public.users creates infinite recursion
-- because it queries public.users within the policy, triggering the same policy check.
-- This also affects policies on other tables (packs, nodes, pods) that reference public.users.
--
-- Solution: Use auth.jwt() to read roles directly from the JWT token instead of querying the users table.
-- Roles are stored in user_metadata during registration/update.

-- ============================================================================
-- Helper function to get roles from JWT (avoids recursion)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_roles()
RETURNS TEXT[] AS $$
BEGIN
    -- Extract roles from the JWT user_metadata
    -- This avoids querying the users table and prevents RLS recursion
    RETURN COALESCE(
        (SELECT ARRAY(
            SELECT jsonb_array_elements_text(
                (auth.jwt() -> 'user_metadata' -> 'roles')
            )
        )),
        ARRAY[]::TEXT[]
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Helper function to check if current user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(required_role TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN required_role = ANY(public.get_user_roles());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Helper function to check if current user has any of the specified roles
CREATE OR REPLACE FUNCTION public.has_any_role(required_roles TEXT[])
RETURNS BOOLEAN AS $$
BEGIN
    RETURN public.get_user_roles() && required_roles;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- Fix users table policies
-- ============================================================================

-- Drop existing policies that cause recursion
DROP POLICY IF EXISTS "Admins can read all users" ON public.users;
DROP POLICY IF EXISTS "Admins can update all users" ON public.users;

-- Recreate admin policies using JWT-based role check
CREATE POLICY "Admins can read all users"
    ON public.users FOR SELECT
    USING (public.has_role('admin'));

CREATE POLICY "Admins can update all users"
    ON public.users FOR UPDATE
    USING (public.has_role('admin'));

-- ============================================================================
-- Fix packs table policies
-- ============================================================================

-- Drop existing policies that reference users table
DROP POLICY IF EXISTS "Developers can create packs" ON public.packs;
DROP POLICY IF EXISTS "Admins can manage all packs" ON public.packs;

-- Recreate policies using JWT-based role check
CREATE POLICY "Developers can create packs"
    ON public.packs FOR INSERT
    WITH CHECK (public.has_any_role(ARRAY['developer', 'operator', 'admin']));

CREATE POLICY "Admins can manage all packs"
    ON public.packs FOR ALL
    USING (public.has_role('admin'));

-- ============================================================================
-- Fix nodes table policies
-- ============================================================================

-- Drop existing policies that reference users table
DROP POLICY IF EXISTS "Operators can register nodes" ON public.nodes;
DROP POLICY IF EXISTS "Operators can update nodes" ON public.nodes;
DROP POLICY IF EXISTS "Admins can delete nodes" ON public.nodes;

-- Recreate policies using JWT-based role check
CREATE POLICY "Operators can register nodes"
    ON public.nodes FOR INSERT
    WITH CHECK (public.has_any_role(ARRAY['operator', 'admin']));

CREATE POLICY "Operators can update nodes"
    ON public.nodes FOR UPDATE
    USING (public.has_any_role(ARRAY['operator', 'admin']));

CREATE POLICY "Admins can delete nodes"
    ON public.nodes FOR DELETE
    USING (public.has_role('admin'));

-- ============================================================================
-- Fix pods table policies
-- ============================================================================

-- Drop existing policies that reference users table
DROP POLICY IF EXISTS "Developers can create pods" ON public.pods;
DROP POLICY IF EXISTS "Operators can update pods" ON public.pods;
DROP POLICY IF EXISTS "Admins can delete pods" ON public.pods;

-- Recreate policies using JWT-based role check
CREATE POLICY "Developers can create pods"
    ON public.pods FOR INSERT
    WITH CHECK (public.has_any_role(ARRAY['developer', 'operator', 'admin']));

CREATE POLICY "Operators can update pods"
    ON public.pods FOR UPDATE
    USING (public.has_any_role(ARRAY['operator', 'admin']));

CREATE POLICY "Admins can delete pods"
    ON public.pods FOR DELETE
    USING (public.has_role('admin'));

-- ============================================================================
-- Fix namespaces table policies
-- ============================================================================

-- Drop existing policies that reference users table
DROP POLICY IF EXISTS "Operators can create namespaces" ON public.namespaces;
DROP POLICY IF EXISTS "Operators can update namespaces" ON public.namespaces;
DROP POLICY IF EXISTS "Admins can delete namespaces" ON public.namespaces;

-- Recreate policies using JWT-based role check
CREATE POLICY "Operators can create namespaces"
    ON public.namespaces FOR INSERT
    WITH CHECK (public.has_any_role(ARRAY['operator', 'admin']));

CREATE POLICY "Operators can update namespaces"
    ON public.namespaces FOR UPDATE
    USING (public.has_any_role(ARRAY['operator', 'admin']));

CREATE POLICY "Admins can delete namespaces"
    ON public.namespaces FOR DELETE
    USING (
        public.has_role('admin')
        -- Cannot delete reserved namespaces
        AND name NOT IN ('default', 'stark-system', 'stark-public')
    );

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON FUNCTION public.get_user_roles() IS 'Extracts user roles from JWT token to avoid RLS recursion';
COMMENT ON FUNCTION public.has_role(TEXT) IS 'Checks if current user has a specific role via JWT';
COMMENT ON FUNCTION public.has_any_role(TEXT[]) IS 'Checks if current user has any of the specified roles via JWT';
