-- Migration: 029_ingress
-- Description: Add ingress port to services for external traffic routing
-- Stark Orchestrator

-- Add ingress_port column to services table
-- When set, the orchestrator opens this port and proxies traffic to a pod in the service
ALTER TABLE public.services
ADD COLUMN IF NOT EXISTS ingress_port INTEGER DEFAULT NULL
    CHECK (ingress_port IS NULL OR (ingress_port >= 1 AND ingress_port <= 65535));

-- Unique constraint: only one service can claim a given ingress port
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_ingress_port
    ON public.services(ingress_port)
    WHERE ingress_port IS NOT NULL;
