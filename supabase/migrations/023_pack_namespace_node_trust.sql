-- Migration: 023_pack_namespace_node_trust
-- Description: Add pack namespace (system/user trust boundary) and node trusted flag
-- Stark Orchestrator

-- Pack namespace enum for trust boundary
-- system: Can access cluster state, manage packs, subscribe to global events (admin only)
-- user: Scoped access, self-lifecycle only, resource capped (default)
CREATE TYPE pack_namespace AS ENUM ('system', 'user');

-- Add namespace column to packs table with default 'user'
ALTER TABLE public.packs 
ADD COLUMN namespace pack_namespace NOT NULL DEFAULT 'user';

-- Add index for namespace queries
CREATE INDEX IF NOT EXISTS idx_packs_namespace ON public.packs(namespace);

-- Add trusted column to nodes table
-- Trusted nodes can run system namespace packs
-- Derived from owner's admin role at registration time
ALTER TABLE public.nodes 
ADD COLUMN trusted BOOLEAN NOT NULL DEFAULT false;

-- Add index for trusted node queries  
CREATE INDEX IF NOT EXISTS idx_nodes_trusted ON public.nodes(trusted);

-- Comment documenting the trust model
COMMENT ON COLUMN public.packs.namespace IS 'Trust boundary: system packs have cluster-wide access, user packs are scoped';
COMMENT ON COLUMN public.nodes.trusted IS 'Whether this node can run system packs. Set based on owner admin role at registration.';
