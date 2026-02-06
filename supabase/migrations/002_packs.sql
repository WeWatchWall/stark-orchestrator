-- Migration: 002_packs
-- Description: Packs table for registered software packages
-- Stark Orchestrator

-- Runtime tags enum for targeting execution environment
CREATE TYPE runtime_tag AS ENUM ('node', 'browser', 'universal');

-- Packs table
CREATE TABLE IF NOT EXISTS public.packs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    runtime_tag runtime_tag NOT NULL,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    bundle_path TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint on name + version
    CONSTRAINT unique_pack_version UNIQUE (name, version)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_packs_name ON public.packs(name);
CREATE INDEX IF NOT EXISTS idx_packs_owner_id ON public.packs(owner_id);
CREATE INDEX IF NOT EXISTS idx_packs_runtime_tag ON public.packs(runtime_tag);
CREATE INDEX IF NOT EXISTS idx_packs_name_version ON public.packs(name, version);
CREATE INDEX IF NOT EXISTS idx_packs_created_at ON public.packs(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER trigger_packs_updated_at
    BEFORE UPDATE ON public.packs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read packs
CREATE POLICY "Anyone can read packs"
    ON public.packs FOR SELECT
    USING (true);

-- Policy: Developers and above can create packs
CREATE POLICY "Developers can create packs"
    ON public.packs FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() 
            AND ('developer' = ANY(roles) OR 'operator' = ANY(roles) OR 'admin' = ANY(roles))
        )
    );

-- Policy: Owners can update their packs
CREATE POLICY "Owners can update own packs"
    ON public.packs FOR UPDATE
    USING (owner_id = auth.uid())
    WITH CHECK (owner_id = auth.uid());

-- Policy: Owners can delete their packs
CREATE POLICY "Owners can delete own packs"
    ON public.packs FOR DELETE
    USING (owner_id = auth.uid());

-- Policy: Admins can manage all packs
CREATE POLICY "Admins can manage all packs"
    ON public.packs FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Function to get latest version of a pack
CREATE OR REPLACE FUNCTION get_latest_pack_version(pack_name TEXT)
RETURNS TABLE (
    id UUID,
    name TEXT,
    version TEXT,
    runtime_tag runtime_tag,
    owner_id UUID,
    bundle_path TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.name, p.version, p.runtime_tag, p.owner_id, p.bundle_path, p.created_at
    FROM public.packs p
    WHERE p.name = pack_name
    ORDER BY p.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to list all versions of a pack
CREATE OR REPLACE FUNCTION get_pack_versions(pack_name TEXT)
RETURNS TABLE (
    id UUID,
    version TEXT,
    runtime_tag runtime_tag,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id, p.version, p.runtime_tag, p.created_at
    FROM public.packs p
    WHERE p.name = pack_name
    ORDER BY p.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE public.packs IS 'Registered software packages (packs) for service';
COMMENT ON COLUMN public.packs.runtime_tag IS 'Target runtime: node, browser, or universal';
COMMENT ON COLUMN public.packs.bundle_path IS 'Path to bundle in Supabase Storage';
COMMENT ON COLUMN public.packs.metadata IS 'Additional pack metadata (dependencies, config, etc.)';
