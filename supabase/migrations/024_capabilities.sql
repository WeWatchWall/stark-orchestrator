-- Migration: Add capabilities to packs and pods
-- Supports declarative capability model for fine-grained access control

-- Add granted_capabilities column to packs table
-- Stores the capabilities granted to a pack at registration time
ALTER TABLE packs
ADD COLUMN granted_capabilities TEXT[] DEFAULT '{}'::TEXT[];

-- Add granted_capabilities column to pods table  
-- Copied from pack at scheduling time for runtime enforcement
ALTER TABLE pods
ADD COLUMN granted_capabilities TEXT[] DEFAULT '{}'::TEXT[];

-- Add comment explaining the capability system
COMMENT ON COLUMN packs.granted_capabilities IS 
  'Capabilities granted to this pack based on namespace, runtime, and requested capabilities. '
  'Special capability "root" means pack runs on main thread (not in worker).';

COMMENT ON COLUMN pods.granted_capabilities IS 
  'Capabilities granted to this pod (copied from pack at scheduling time). '
  'Used by runtime for execution decisions (e.g., root = main thread execution).';

-- Create index for capability-based queries
CREATE INDEX idx_packs_capabilities ON packs USING GIN (granted_capabilities);
CREATE INDEX idx_pods_capabilities ON pods USING GIN (granted_capabilities);

-- Migrate existing packs to have default capabilities based on namespace
-- System namespace packs get full system capabilities
UPDATE packs 
SET granted_capabilities = ARRAY[
  'root',
  'cluster:read', 
  'cluster:write',
  'packs:read',
  'packs:manage',
  'pods:read',
  'pods:manage',
  'events:self',
  'events:global',
  'ui:render',
  'ui:system',
  'storage:self',
  'storage:shared'
]
WHERE namespace = 'system';

-- User namespace packs get default user capabilities
UPDATE packs
SET granted_capabilities = ARRAY[
  'root',
  'pods:self',
  'events:self',
  'storage:self',
  'packs:read',
  'pods:read'
]
WHERE namespace = 'user';

-- Browser packs automatically get ui:render
UPDATE packs
SET granted_capabilities = array_append(granted_capabilities, 'ui:render')
WHERE runtime_tag IN ('browser', 'universal')
  AND NOT 'ui:render' = ANY(granted_capabilities);

-- Browser packs automatically get root capability
UPDATE packs
SET granted_capabilities = array_append(granted_capabilities, 'root')
WHERE runtime_tag IN ('browser', 'universal')
  AND NOT 'root' = ANY(granted_capabilities);

-- Migrate existing pods to copy capabilities from their pack
UPDATE pods p
SET granted_capabilities = (
  SELECT pk.granted_capabilities 
  FROM packs pk 
  WHERE pk.id = p.pack_id
)
WHERE p.granted_capabilities = '{}';
