/**
 * Pack type definitions
 * @module @stark-o/shared/types/pack
 */

import type { Capability } from './capabilities.js';

/**
 * Runtime tags for targeting execution environment
 * - node: Only runs on Node.js runtimes
 * - browser: Only runs on browser runtimes
 * - universal: Runs on both Node.js and browser
 */
export type RuntimeTag = 'node' | 'browser' | 'universal';

/**
 * Pack metadata for configuration and dependencies
 */
export interface PackMetadata {
  /** Entry point function name */
  entrypoint?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Environment variables */
  env?: Record<string, string>;
  /**
   * Capabilities requested by this pack.
   * These are validated and granted based on namespace and context.
   * See capabilities.ts for available capabilities.
   */
  requestedCapabilities?: Capability[];
  /**
   * Minimum Node.js version required to run this pack.
   * Format: semver string (e.g., "18.0.0", "20.10.0")
   * If not specified, the pack is assumed compatible with any Node version.
   * Scheduler will refuse to schedule on nodes with incompatible versions.
   */
  minNodeVersion?: string;
  /**
   * Enable the ephemeral data plane for this pack.
   * When true, the runtime injects an `EphemeralDataPlane` instance as
   * `context.ephemeral`, enabling transient pod-to-pod group membership,
   * fan-out queries, and presence tracking.
   * @default false
   */
  enableEphemeral?: boolean;
  /** Additional configuration */
  [key: string]: unknown;
}

/**
 * Pack visibility for access control
 * - private: Only owner and admins can access
 * - public: Anyone can access
 */
export type PackVisibility = 'private' | 'public';

/**
 * Pack namespace for trust boundary
 * - system: Can access cluster state, manage packs, subscribe to global events (admin only)
 * - user: Scoped access, self-lifecycle only, resource capped (default)
 */
export type PackNamespace = 'system' | 'user';

/**
 * Pack entity - a registered software package
 */
export interface Pack {
  /** Unique identifier (UUID) */
  id: string;
  /** Pack name (unique with version) */
  name: string;
  /** Semantic version */
  version: string;
  /** Target runtime */
  runtimeTag: RuntimeTag;
  /** Owner user ID */
  ownerId: string;
  /** Pack namespace (system or user) - determines trust level */
  namespace: PackNamespace;
  /** Pack visibility (private or public) */
  visibility: PackVisibility;
  /** Path to bundle in storage */
  bundlePath: string;
  /** JavaScript bundle content (stored directly in database) */
  bundleContent?: string;
  /** Pack description */
  description?: string;
  /** Additional metadata */
  metadata: PackMetadata;
  /**
   * Capabilities granted to this pack.
   * Determined at registration time based on namespace, runtime, and requested capabilities.
   * 'root' capability means pack runs on main thread (not in worker).
   */
  grantedCapabilities: Capability[];
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Pack registration input
 */
export interface RegisterPackInput {
  /** Pack name */
  name: string;
  /** Semantic version */
  version: string;
  /** Target runtime */
  runtimeTag: RuntimeTag;
  /** Pack namespace (default: user) - system requires admin role */
  namespace?: PackNamespace;
  /** Pack visibility (default: private) */
  visibility?: PackVisibility;
  /** Pack description */
  description?: string;
  /** JavaScript bundle content */
  bundleContent?: string;
  /** Additional metadata */
  metadata?: PackMetadata;
}

/**
 * Pack update input
 */
export interface UpdatePackInput {
  description?: string;
  visibility?: PackVisibility;
  metadata?: PackMetadata;
}

/**
 * Pack version summary (for listing)
 */
export interface PackVersionSummary {
  /** Pack ID */
  id: string;
  /** Version string */
  version: string;
  /** Runtime tag */
  runtimeTag: RuntimeTag;
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Pack list item (for search/listing)
 */
export interface PackListItem {
  /** Pack ID */
  id: string;
  /** Pack name */
  name: string;
  /** Latest version */
  latestVersion: string;
  /** Runtime tag */
  runtimeTag: RuntimeTag;
  /** Description */
  description?: string;
  /** Version count */
  versionCount: number;
  /** Owner ID */
  ownerId: string;
  /** Creation timestamp */
  createdAt: Date;
}

/**
 * Check if a runtime tag is compatible with a target runtime
 * @param packTag - The pack's runtime tag
 * @param nodeRuntime - The node's runtime type ('node' or 'browser')
 */
export function isRuntimeCompatible(packTag: RuntimeTag, nodeRuntime: 'node' | 'browser'): boolean {
  if (packTag === 'universal') {
    return true;
  }
  return packTag === nodeRuntime;
}

/**
 * Parse a semver version string
 */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/**
 * Parse a semantic version string
 */
export function parseSemVer(version: string): SemVer | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    return null;
  }
  const major = match[1];
  const minor = match[2];
  const patch = match[3];
  const prerelease = match[4];
  
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }
  
  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
    prerelease,
  };
}

/**
 * Compare two semantic versions
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareSemVer(a: string, b: string): number {
  const parsedA = parseSemVer(a);
  const parsedB = parseSemVer(b);

  if (!parsedA || !parsedB) {
    return a.localeCompare(b);
  }

  if (parsedA.major !== parsedB.major) {
    return parsedA.major - parsedB.major;
  }
  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor - parsedB.minor;
  }
  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch - parsedB.patch;
  }

  // Prerelease versions are less than release versions
  if (parsedA.prerelease && !parsedB.prerelease) {
    return -1;
  }
  if (!parsedA.prerelease && parsedB.prerelease) {
    return 1;
  }
  if (parsedA.prerelease && parsedB.prerelease) {
    return parsedA.prerelease.localeCompare(parsedB.prerelease);
  }

  return 0;
}

/**
 * Check if a node's version is compatible with a pack's minimum version requirement.
 * @param nodeVersion - The node's runtime version (e.g., "22.0.0", "Chrome 120")
 * @param minNodeVersion - The pack's minimum Node.js version requirement (e.g., "18.0.0")
 * @returns true if compatible (node version >= min version), false otherwise
 * 
 * Returns true if:
 * - minNodeVersion is not specified (pack accepts any version)
 * - nodeVersion is not specified (assume compatible for flexibility)
 * - nodeVersion >= minNodeVersion (satisfies requirement)
 * 
 * Returns false if:
 * - Both versions are valid semver and nodeVersion < minNodeVersion
 */
export function isNodeVersionCompatible(
  nodeVersion: string | undefined,
  minNodeVersion: string | undefined
): boolean {
  // If pack doesn't specify a minimum version, it's compatible with any node
  if (!minNodeVersion) {
    return true;
  }

  // If node doesn't report version, assume compatible (for flexibility)
  if (!nodeVersion) {
    return true;
  }

  // Clean up version strings - extract semver from strings like "v20.10.0" or "Chrome 120"
  const cleanNodeVersion = extractSemVer(nodeVersion);
  const cleanMinVersion = extractSemVer(minNodeVersion);

  if (!cleanNodeVersion || !cleanMinVersion) {
    // Can't parse versions, assume compatible
    return true;
  }

  // Node version must be >= min version
  return compareSemVer(cleanNodeVersion, cleanMinVersion) >= 0;
}

/**
 * Extract a semver string from a version string.
 * Handles formats like "v20.10.0", "20.10.0", "Chrome 120", "Node 18.0.0"
 */
function extractSemVer(version: string): string | null {
  // Remove 'v' prefix if present
  const cleaned = version.replace(/^v/i, '').trim();
  
  // Try to match a semver pattern (x.y.z with optional prerelease)
  const semverMatch = cleaned.match(/(\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?)/);
  if (semverMatch && semverMatch[1]) {
    return semverMatch[1];
  }

  // Try to match just major.minor (e.g., "22.0")
  const majorMinorMatch = cleaned.match(/(\d+\.\d+)/);
  if (majorMinorMatch && majorMinorMatch[1]) {
    return `${majorMinorMatch[1]}.0`;
  }

  // Try to match just major (e.g., "22" or "Chrome 120")
  const majorMatch = cleaned.match(/(\d+)/);
  if (majorMatch && majorMatch[1]) {
    return `${majorMatch[1]}.0.0`;
  }

  return null;
}

/**
 * All available runtime tags
 */
export const ALL_RUNTIME_TAGS: readonly RuntimeTag[] = ['node', 'browser', 'universal'] as const;
