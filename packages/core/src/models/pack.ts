/**
 * Pack reactive model with validation
 * @module @stark-o/core/models/pack
 */

import { reactive, computed, type ComputedRef } from '@vue/reactivity';
import type {
  Pack,
  RegisterPackInput,
  UpdatePackInput,
  PackMetadata,
  RuntimeTag,
  PackVersionSummary,
  PackListItem,
} from '@stark-o/shared';
import {
  validateRegisterPackInput,
  compareSemVer,
} from '@stark-o/shared';

/**
 * Result of pack registration
 */
export interface PackRegistrationResult {
  pack: Pack;
  uploadUrl: string;
}

/**
 * Pack list response with pagination
 */
export interface PackListResponse {
  packs: Pack[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Pack list filters
 */
export interface PackListFilters {
  /** Filter by pack name (partial match) */
  name?: string;
  /** Filter by runtime tag */
  runtimeTag?: RuntimeTag;
  /** Filter by owner ID */
  ownerId?: string;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

/**
 * Reactive Pack model wrapper
 * Provides reactive access to pack data with computed properties
 */
export class PackModel {
  private readonly _pack: Pack;

  constructor(pack: Pack) {
    this._pack = reactive(pack) as Pack;
  }

  /**
   * Get the raw pack data
   */
  get data(): Pack {
    return this._pack;
  }

  /**
   * Pack ID
   */
  get id(): string {
    return this._pack.id;
  }

  /**
   * Pack name
   */
  get name(): string {
    return this._pack.name;
  }

  /**
   * Pack version
   */
  get version(): string {
    return this._pack.version;
  }

  /**
   * Runtime tag
   */
  get runtimeTag(): RuntimeTag {
    return this._pack.runtimeTag;
  }

  /**
   * Owner ID
   */
  get ownerId(): string {
    return this._pack.ownerId;
  }

  /**
   * Bundle path in storage
   */
  get bundlePath(): string {
    return this._pack.bundlePath;
  }

  /**
   * Description
   */
  get description(): string | undefined {
    return this._pack.description;
  }

  /**
   * Metadata
   */
  get metadata(): PackMetadata {
    return this._pack.metadata;
  }

  /**
   * Creation timestamp
   */
  get createdAt(): Date {
    return this._pack.createdAt;
  }

  /**
   * Last update timestamp
   */
  get updatedAt(): Date {
    return this._pack.updatedAt;
  }

  /**
   * Full pack identifier (name@version)
   */
  get fullId(): string {
    return `${this._pack.name}@${this._pack.version}`;
  }

  /**
   * Check if pack is compatible with a node runtime
   */
  isCompatibleWith(nodeRuntime: 'node' | 'browser'): boolean {
    if (this._pack.runtimeTag === 'universal') {
      return true;
    }
    return this._pack.runtimeTag === nodeRuntime;
  }

  /**
   * Update pack metadata
   */
  update(updates: UpdatePackInput): void {
    if (updates.description !== undefined) {
      this._pack.description = updates.description;
    }
    if (updates.metadata !== undefined) {
      this._pack.metadata = { ...this._pack.metadata, ...updates.metadata };
    }
    this._pack.updatedAt = new Date();
  }

  /**
   * Convert to version summary
   */
  toVersionSummary(): PackVersionSummary {
    return {
      id: this._pack.id,
      version: this._pack.version,
      runtimeTag: this._pack.runtimeTag,
      createdAt: this._pack.createdAt,
    };
  }

  /**
   * Convert to list item
   */
  toListItem(versionCount: number = 1): PackListItem {
    return {
      id: this._pack.id,
      name: this._pack.name,
      latestVersion: this._pack.version,
      runtimeTag: this._pack.runtimeTag,
      description: this._pack.description,
      versionCount,
      ownerId: this._pack.ownerId,
      createdAt: this._pack.createdAt,
    };
  }

  /**
   * Create a new Pack from input
   */
  static create(
    input: RegisterPackInput,
    ownerId: string,
    bundlePath: string,
    id?: string
  ): PackModel {
    const now = new Date();
    const pack: Pack = {
      id: id ?? crypto.randomUUID(),
      name: input.name,
      version: input.version,
      runtimeTag: input.runtimeTag,
      ownerId,
      visibility: input.visibility ?? 'private',
      bundlePath,
      description: input.description,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    return new PackModel(pack);
  }

  /**
   * Validate pack registration input
   */
  static validate(input: unknown): { valid: boolean; errors: Array<{ field: string; message: string; code: string }> } {
    return validateRegisterPackInput(input as RegisterPackInput);
  }

  /**
   * Sort packs by version (newest first)
   */
  static sortByVersion(packs: Pack[]): Pack[] {
    return [...packs].sort((a, b) => compareSemVer(b.version, a.version));
  }

  /**
   * Get the latest version from a list of packs
   */
  static getLatest(packs: Pack[]): Pack | undefined {
    if (packs.length === 0) return undefined;
    return PackModel.sortByVersion(packs)[0];
  }

  /**
   * Generate bundle path for storage
   */
  static generateBundlePath(name: string, version: string): string {
    return `packs/${name}/${version}/bundle.zip`;
  }

  /**
   * Generate upload URL placeholder (actual URL comes from storage service)
   */
  static generateUploadUrlPlaceholder(bundlePath: string): string {
    return `upload://${bundlePath}`;
  }
}

/**
 * Create a reactive computed pack list item
 */
export function createReactivePackListItem(
  pack: Pack,
  versionCount: ComputedRef<number>
): ComputedRef<PackListItem> {
  const reactivePack = reactive(pack);
  return computed(() => ({
    id: reactivePack.id,
    name: reactivePack.name,
    latestVersion: reactivePack.version,
    runtimeTag: reactivePack.runtimeTag,
    description: reactivePack.description,
    versionCount: versionCount.value,
    ownerId: reactivePack.ownerId,
    createdAt: reactivePack.createdAt,
  }));
}
