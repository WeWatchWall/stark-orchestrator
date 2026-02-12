-- Add enable_ephemeral column to services table
-- When true, pods in this service receive an EphemeralDataPlane instance.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS enable_ephemeral BOOLEAN NOT NULL DEFAULT false;
