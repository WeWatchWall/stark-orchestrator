-- Migration: 012_app_config
-- Description: Application configuration table for system-level settings
-- Stark Orchestrator

-- Application configuration table
CREATE TABLE IF NOT EXISTS public.app_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE DEFAULT 'default',
    
    -- Registration settings
    enable_public_registration BOOLEAN NOT NULL DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER trigger_app_config_updated_at
    BEFORE UPDATE ON public.app_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS (Row Level Security)
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read app config (needed for checking registration status)
CREATE POLICY "Anyone can read app config"
    ON public.app_config FOR SELECT
    USING (true);

-- Policy: Only admins can modify app config
CREATE POLICY "Admins can modify app config"
    ON public.app_config FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND 'admin' = ANY(roles)
        )
    );

-- Insert default app configuration
INSERT INTO public.app_config (name)
VALUES ('default')
ON CONFLICT (name) DO NOTHING;

-- Function to get app config
CREATE OR REPLACE FUNCTION get_app_config()
RETURNS public.app_config AS $$
BEGIN
    RETURN (SELECT * FROM public.app_config WHERE name = 'default' LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update app config
CREATE OR REPLACE FUNCTION update_app_config(
    p_enable_public_registration BOOLEAN DEFAULT NULL
)
RETURNS public.app_config AS $$
DECLARE
    result public.app_config;
BEGIN
    UPDATE public.app_config
    SET
        enable_public_registration = COALESCE(p_enable_public_registration, enable_public_registration)
    WHERE name = 'default'
    RETURNING * INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE public.app_config IS 'Application-level configuration settings';
COMMENT ON COLUMN public.app_config.enable_public_registration IS 'Whether users can register without admin invitation';
