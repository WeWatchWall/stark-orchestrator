-- Migration: 030_service_visibility_namespace_policies
-- Description: Add visibility/exposed/allowed_sources columns to services,
--              add namespace scoping to network_policies
-- Stark Orchestrator

-- ── Add visibility columns to services ──────────────────────────────────────

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public', 'private', 'system'));

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS exposed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS allowed_sources JSONB DEFAULT '[]'::JSONB;

-- Index for visibility queries
CREATE INDEX IF NOT EXISTS idx_services_visibility ON public.services(visibility);
CREATE INDEX IF NOT EXISTS idx_services_exposed ON public.services(exposed);

COMMENT ON COLUMN public.services.visibility IS 'Network visibility: public (allow all internal), private (deny unless allowedSources), system (deny unless allowedSources)';
COMMENT ON COLUMN public.services.exposed IS 'Whether this service is reachable from ingress (external traffic)';
COMMENT ON COLUMN public.services.allowed_sources IS 'JSON array of service names allowed to call this service internally (for private/system visibility)';

-- ── Add namespace to network_policies ───────────────────────────────────────

ALTER TABLE public.network_policies
ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default';

-- Drop old unique constraint and recreate with namespace
ALTER TABLE public.network_policies
DROP CONSTRAINT IF EXISTS unique_source_target;

ALTER TABLE public.network_policies
ADD CONSTRAINT unique_source_target_namespace UNIQUE (source_service, target_service, namespace);

-- Update indexes to include namespace
DROP INDEX IF EXISTS idx_network_policies_source;
DROP INDEX IF EXISTS idx_network_policies_target;
DROP INDEX IF EXISTS idx_network_policies_source_target;

CREATE INDEX IF NOT EXISTS idx_network_policies_namespace ON public.network_policies(namespace);
CREATE INDEX IF NOT EXISTS idx_network_policies_source_ns ON public.network_policies(source_service, namespace);
CREATE INDEX IF NOT EXISTS idx_network_policies_target_ns ON public.network_policies(target_service, namespace);
CREATE INDEX IF NOT EXISTS idx_network_policies_source_target_ns ON public.network_policies(source_service, target_service, namespace);

COMMENT ON COLUMN public.network_policies.namespace IS 'Namespace scope for this policy — policies only apply to services in the same namespace';
