/**
 * Capability type definitions for Stark Orchestrator
 * @module @stark-o/shared/types/capabilities
 *
 * Capabilities define what a pack can do at runtime.
 * Instead of ad-hoc permission flags, packs declare capabilities they need,
 * and the orchestrator grants them based on namespace, pack type, and context.
 */

import type { PackNamespace, RuntimeTag } from './pack.js';

/**
 * Available capabilities for packs
 *
 * Capabilities are hierarchical: 'cluster:read' is separate from 'cluster:write'
 *
 * Special capabilities:
 * - 'root': Runs on main thread (not in worker pool), required for UI packs
 *           that need DOM access. Granted to all namespace packs by default
 *           so users can run UI apps on their own nodes.
 */
export type Capability =
  // Root/privileged execution
  | 'root' // Main thread execution (DOM access, no worker isolation)

  // Cluster operations
  | 'cluster:read' // Read cluster state (nodes, health)
  | 'cluster:write' // Modify cluster configuration

  // Pack operations
  | 'packs:read' // List/get pack metadata
  | 'packs:manage' // Register, update, delete packs

  // Pod operations
  | 'pods:read' // List/get pod status
  | 'pods:manage' // Create, stop, delete pods
  | 'pods:self' // Manage own pod lifecycle only

  // Event subscriptions
  | 'events:self' // Subscribe to own pod events
  | 'events:global' // Subscribe to all cluster events

  // UI capabilities
  | 'ui:render' // Render to designated UI container
  | 'ui:system' // System-level UI (settings, admin panels)

  // Storage capabilities
  | 'storage:self' // Access own pack's storage
  | 'storage:shared'; // Access shared storage

/**
 * All available capabilities as a const array
 */
export const ALL_CAPABILITIES: readonly Capability[] = [
  'root',
  'cluster:read',
  'cluster:write',
  'packs:read',
  'packs:manage',
  'pods:read',
  'pods:manage',
  'pods:self',
  'events:self',
  'events:global',
  'ui:render',
  'ui:system',
  'storage:self',
  'storage:shared',
] as const;

/**
 * Capabilities that require system namespace
 * These cannot be granted to user namespace packs
 */
export const SYSTEM_ONLY_CAPABILITIES: readonly Capability[] = [
  'cluster:write',
  'packs:manage',
  'events:global',
  'ui:system',
  'storage:shared',
] as const;

/**
 * Default capabilities granted based on namespace
 */
export const DEFAULT_CAPABILITIES: Record<PackNamespace, readonly Capability[]> = {
  user: ['root', 'pods:self', 'events:self', 'storage:self', 'packs:read', 'pods:read'],
  system: [
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
    'storage:shared',
  ],
} as const;

/**
 * Capabilities automatically granted to browser UI packs
 */
export const UI_PACK_CAPABILITIES: readonly Capability[] = ['root', 'ui:render'] as const;

/**
 * Context for capability granting decisions
 */
export interface CapabilityGrantContext {
  /** Pack's declared namespace */
  namespace: PackNamespace;
  /** Pack's runtime tag */
  runtimeTag: RuntimeTag;
  /** Whether registering user is admin */
  isAdmin: boolean;
  /** Additional context for special cases */
  installContext?: 'bootstrap' | 'user-install' | 'system-upgrade';
}

/**
 * Result of capability granting
 */
export interface CapabilityGrantResult {
  /** Capabilities that were granted */
  granted: Capability[];
  /** Capabilities that were denied (with reasons) */
  denied: Array<{ capability: Capability; reason: string }>;
}

/**
 * Check if a capability is valid
 */
export function isValidCapability(cap: string): cap is Capability {
  return ALL_CAPABILITIES.includes(cap as Capability);
}

/**
 * Check if a capability requires system namespace
 */
export function requiresSystemNamespace(cap: Capability): boolean {
  return SYSTEM_ONLY_CAPABILITIES.includes(cap);
}

/**
 * Grant capabilities to a pack based on context
 *
 * Rules:
 * 1. System namespace packs can request any capability
 * 2. User namespace packs cannot request system-only capabilities
 * 3. Browser packs automatically get ui:render and root if needed
 * 4. 'root' capability is granted by default to both user and system namespace packs
 *    - This allows users to run UI apps on their own nodes
 *    - Root packs run on main thread (not in worker pool)
 *
 * @param requested - Capabilities the pack is requesting
 * @param context - Context for the granting decision
 * @returns Which capabilities are granted and which are denied
 */
export function grantCapabilities(
  requested: Capability[],
  context: CapabilityGrantContext
): CapabilityGrantResult {
  const granted: Capability[] = [];
  const denied: Array<{ capability: Capability; reason: string }> = [];

  // Start with default capabilities for the namespace
  const defaults = [...DEFAULT_CAPABILITIES[context.namespace]];

  // Add defaults that aren't explicitly requested
  for (const cap of defaults) {
    if (!requested.includes(cap) && !granted.includes(cap)) {
      granted.push(cap);
    }
  }

  // Process each requested capability
  for (const cap of requested) {
    // Skip if already granted via defaults
    if (granted.includes(cap)) {
      continue;
    }

    // Check if capability requires system namespace
    if (requiresSystemNamespace(cap) && context.namespace !== 'system') {
      denied.push({
        capability: cap,
        reason: `Capability '${cap}' requires system namespace`,
      });
      continue;
    }

    // Grant the capability
    granted.push(cap);
  }

  // Auto-grant ui:render for browser packs if they don't have it
  if (
    (context.runtimeTag === 'browser' || context.runtimeTag === 'universal') &&
    !granted.includes('ui:render')
  ) {
    granted.push('ui:render');
    granted.push('root'); // Ensure root is granted for UI packs
  }

  return { granted, denied };
}

/**
 * Check if a set of capabilities includes a specific capability
 */
export function hasCapability(capabilities: Capability[], cap: Capability): boolean {
  return capabilities.includes(cap);
}

/**
 * Check if a set of capabilities includes any of the specified capabilities
 */
export function hasAnyCapability(capabilities: Capability[], caps: Capability[]): boolean {
  return caps.some((cap) => capabilities.includes(cap));
}

/**
 * Check if a set of capabilities includes all of the specified capabilities
 */
export function hasAllCapabilities(capabilities: Capability[], caps: Capability[]): boolean {
  return caps.every((cap) => capabilities.includes(cap));
}

/**
 * Check if capabilities include 'root' (main thread execution)
 * This is a convenience function for the common UI pack check
 */
export function requiresMainThread(capabilities: Capability[]): boolean {
  return hasCapability(capabilities, 'root');
}

/**
 * Validate that requested capabilities are valid strings
 * @returns Array of invalid capability strings
 */
export function validateCapabilities(requested: string[]): string[] {
  return requested.filter((cap) => !isValidCapability(cap));
}
