/**
 * Pack type definitions
 * @module @stark-o/shared/types/pack
 */

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
 * All available runtime tags
 */
export const ALL_RUNTIME_TAGS: readonly RuntimeTag[] = ['node', 'browser', 'universal'] as const;
