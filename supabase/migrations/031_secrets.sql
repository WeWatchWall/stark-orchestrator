-- Migration: 031_secrets
-- Description: Secrets table for encrypted secret data with injection configuration
-- Stark Orchestrator

-- Secret type enum
CREATE TYPE secret_type AS ENUM ('opaque', 'tls', 'docker-registry');

-- Secrets table
CREATE TABLE IF NOT EXISTS public.secrets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identity
    name TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'default',
    type secret_type NOT NULL DEFAULT 'opaque',

    -- Encrypted data (AES-256-GCM)
    encrypted_data TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,

    -- Injection configuration (env or volume mode)
    injection JSONB NOT NULL DEFAULT '{"mode": "env"}',

    -- Versioning (incremented on data update)
    version INTEGER NOT NULL DEFAULT 1,

    -- Ownership
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Secret names must be unique within a namespace
    CONSTRAINT unique_secret_name_namespace UNIQUE (name, namespace)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_secrets_name
    ON public.secrets(name);
CREATE INDEX IF NOT EXISTS idx_secrets_namespace
    ON public.secrets(namespace);
CREATE INDEX IF NOT EXISTS idx_secrets_type
    ON public.secrets(type);
CREATE INDEX IF NOT EXISTS idx_secrets_created_by
    ON public.secrets(created_by);
CREATE INDEX IF NOT EXISTS idx_secrets_name_namespace
    ON public.secrets(name, namespace);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER secrets_updated_at
    BEFORE UPDATE ON public.secrets
    FOR EACH ROW
    EXECUTE FUNCTION update_secrets_updated_at();

-- Enable RLS
ALTER TABLE public.secrets ENABLE ROW LEVEL SECURITY;

-- RLS policies: authenticated users can manage their own secrets
CREATE POLICY "secrets_select" ON public.secrets
    FOR SELECT TO authenticated
    USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND 'admin' = ANY(users.roles)
        )
    );

CREATE POLICY "secrets_insert" ON public.secrets
    FOR INSERT TO authenticated
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "secrets_update" ON public.secrets
    FOR UPDATE TO authenticated
    USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND 'admin' = ANY(users.roles)
        )
    )
    WITH CHECK (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND 'admin' = ANY(users.roles)
        )
    );

CREATE POLICY "secrets_delete" ON public.secrets
    FOR DELETE TO authenticated
    USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND 'admin' = ANY(users.roles)
        )
    );

-- Service role has full access (for server-side operations)
CREATE POLICY "secrets_service_all" ON public.secrets
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Comments
COMMENT ON TABLE public.secrets IS 'Encrypted secrets for pod injection (env vars or volume mounts)';
COMMENT ON COLUMN public.secrets.name IS 'DNS-like secret name, unique per namespace';
COMMENT ON COLUMN public.secrets.namespace IS 'Namespace isolation boundary';
COMMENT ON COLUMN public.secrets.type IS 'Secret type: opaque, tls, or docker-registry';
COMMENT ON COLUMN public.secrets.encrypted_data IS 'AES-256-GCM encrypted ciphertext (base64)';
COMMENT ON COLUMN public.secrets.iv IS 'Initialization vector for AES-GCM decryption (hex)';
COMMENT ON COLUMN public.secrets.auth_tag IS 'GCM authentication tag for integrity verification (hex)';
COMMENT ON COLUMN public.secrets.injection IS 'JSONB injection config: { mode, prefix?, mountPath?, keyMapping?, fileMapping? }';
COMMENT ON COLUMN public.secrets.version IS 'Monotonic version counter, incremented on data update';
COMMENT ON COLUMN public.secrets.created_by IS 'User who created the secret';
