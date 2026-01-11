/**
 * Pack registry service
 * Handles pack registration, versioning, and listing
 * @module @stark-o/core/services/pack-registry
 */

import type { ComputedRef } from '@vue/reactivity';
import type {
  Pack,
  RegisterPackInput,
  UpdatePackInput,
  RuntimeTag,
  PackVersionSummary,
  PackListItem,
} from '@stark-o/shared';
import {
  validateRegisterPackInput,
  compareSemVer,
  isRuntimeCompatible,
  generateUUID,
  createServiceLogger,
} from '@stark-o/shared';

/**
 * Logger for pack registry operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'pack-registry' });
import { clusterState } from '../stores/cluster-store';
import {
  findPackById,
  findPackByNameVersion,
  findPackVersions,
  getLatestPackVersion,
  registerPack as storeRegisterPack,
  updatePack as storeUpdatePack,
  removePack as storeRemovePack,
  removePackByName as storeRemovePackByName,
  packVersionExists,
  packExists,
  searchPacksByName,
  findPacksByOwner,
  findPacksByRuntime,
  findPacksCompatibleWith,
  getPackVersionSummaries,
  packCount,
  uniquePackCount,
  packsByName,
  packsByRuntime,
  packsByOwner,
} from '../stores/pack-store';
import { PackModel, type PackRegistrationResult, type PackListResponse, type PackListFilters } from '../models/pack';

/**
 * Pack registration options
 */
export interface PackRegistrationOptions {
  /** Generate upload URL for bundle */
  generateUploadUrl?: (packId: string, packName: string, version: string) => string;
  /** Validate bundle path */
  validateBundlePath?: boolean;
}

/**
 * Pack operation result
 */
export interface PackOperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Default upload URL generator
 */
function defaultUploadUrlGenerator(packId: string, _packName: string, _version: string): string {
  return `/api/packs/${packId}/upload`;
}

/**
 * Pack Registry Service
 * Manages pack lifecycle: registration, versioning, listing, and deletion
 */
export class PackRegistry {
  private readonly generateUploadUrl: (packId: string, packName: string, version: string) => string;

  constructor(options: PackRegistrationOptions = {}) {
    this.generateUploadUrl = options.generateUploadUrl ?? defaultUploadUrlGenerator;
  }

  // ===========================================================================
  // Computed Properties (reactive)
  // ===========================================================================

  /**
   * Total number of packs (all versions)
   */
  get totalPacks(): ComputedRef<number> {
    return packCount;
  }

  /**
   * Total number of unique packs (by name)
   */
  get uniquePacks(): ComputedRef<number> {
    return uniquePackCount;
  }

  /**
   * Packs grouped by name
   */
  get byName(): ComputedRef<Map<string, Pack[]>> {
    return packsByName;
  }

  /**
   * Packs grouped by runtime tag
   */
  get byRuntime(): ComputedRef<Map<RuntimeTag, Pack[]>> {
    return packsByRuntime;
  }

  /**
   * Packs grouped by owner
   */
  get byOwner(): ComputedRef<Map<string, Pack[]>> {
    return packsByOwner;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  /**
   * Register a new pack
   * @param input - Pack registration input
   * @param ownerId - Owner user ID
   * @returns Registration result with pack and upload URL
   */
  register(
    input: RegisterPackInput,
    ownerId: string
  ): PackOperationResult<PackRegistrationResult> {
    logger.debug('Attempting pack registration', {
      packName: input.name,
      version: input.version,
      runtimeTag: input.runtimeTag,
      ownerId,
    });

    // Validate input
    const validation = validateRegisterPackInput(input);
    if (!validation.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validation.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      logger.warn('Pack registration validation failed', {
        packName: input.name,
        version: input.version,
        ownerId,
        errorCount: validation.errors.length,
      });
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details,
        },
      };
    }

    // Check if version already exists
    if (packVersionExists(input.name, input.version)) {
      logger.warn('Pack version already exists', {
        packName: input.name,
        version: input.version,
        ownerId,
      });
      return {
        success: false,
        error: {
          code: 'VERSION_EXISTS',
          message: `Pack ${input.name}@${input.version} already exists`,
          details: { name: input.name, version: input.version },
        },
      };
    }

    // Generate pack ID
    const packId = generateUUID();

    // Generate bundle path
    const bundlePath = this.generateBundlePath(input.name, input.version);

    // Register in store
    const pack = storeRegisterPack({
      ...input,
      id: packId,
      ownerId,
      bundlePath,
    });

    // Generate upload URL
    const uploadUrl = this.generateUploadUrl(packId, input.name, input.version);

    logger.info('Pack registered successfully', {
      packId,
      packName: pack.name,
      version: pack.version,
      runtimeTag: pack.runtimeTag,
      ownerId,
      bundlePath,
    });

    return {
      success: true,
      data: {
        pack,
        uploadUrl,
      },
    };
  }

  /**
   * Generate bundle path for a pack
   */
  private generateBundlePath(name: string, version: string): string {
    return `packs/${name}/${version}/bundle.js`;
  }

  // ===========================================================================
  // Updates
  // ===========================================================================

  /**
   * Update pack metadata
   * @param packId - Pack ID
   * @param updates - Update input
   * @param requesterId - User requesting the update (for authorization)
   * @returns Updated pack or error
   */
  update(
    packId: string,
    updates: UpdatePackInput,
    requesterId: string
  ): PackOperationResult<Pack> {
    logger.debug('Attempting pack update', {
      packId,
      requesterId,
      updateFields: Object.keys(updates),
    });

    const pack = findPackById(packId);
    if (!pack) {
      logger.warn('Pack update failed: pack not found', { packId, requesterId });
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Pack ${packId} not found`,
          details: { packId },
        },
      };
    }

    // Check ownership
    if (pack.ownerId !== requesterId) {
      logger.warn('Pack update forbidden: not owner', {
        packId,
        packName: pack.name,
        requesterId,
        ownerId: pack.ownerId,
      });
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only the pack owner can update pack metadata',
          details: { packId, ownerId: pack.ownerId },
        },
      };
    }

    const updated = storeUpdatePack(packId, updates);
    if (!updated) {
      logger.error('Pack update failed: store error', { packId, packName: pack.name });
      return {
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: 'Failed to update pack',
          details: { packId },
        },
      };
    }

    logger.info('Pack updated successfully', {
      packId,
      packName: pack.name,
      version: pack.version,
      requesterId,
      updatedFields: Object.keys(updates),
    });

    return {
      success: true,
      data: updated,
    };
  }

  // ===========================================================================
  // Deletion
  // ===========================================================================

  /**
   * Delete a specific pack version
   * @param packId - Pack ID
   * @param requesterId - User requesting deletion (for authorization)
   * @returns Success or error
   */
  delete(packId: string, requesterId: string): PackOperationResult<void> {
    logger.debug('Attempting pack deletion', { packId, requesterId });

    const pack = findPackById(packId);
    if (!pack) {
      logger.warn('Pack deletion failed: pack not found', { packId, requesterId });
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Pack ${packId} not found`,
          details: { packId },
        },
      };
    }

    // Check ownership
    if (pack.ownerId !== requesterId) {
      logger.warn('Pack deletion forbidden: not owner', {
        packId,
        packName: pack.name,
        version: pack.version,
        requesterId,
        ownerId: pack.ownerId,
      });
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only the pack owner can delete a pack',
          details: { packId, ownerId: pack.ownerId },
        },
      };
    }

    const deleted = storeRemovePack(packId);
    if (!deleted) {
      logger.error('Pack deletion failed: store error', {
        packId,
        packName: pack.name,
        version: pack.version,
      });
      return {
        success: false,
        error: {
          code: 'DELETE_FAILED',
          message: 'Failed to delete pack',
          details: { packId },
        },
      };
    }

    logger.info('Pack deleted successfully', {
      packId,
      packName: pack.name,
      version: pack.version,
      requesterId,
    });

    return { success: true };
  }

  /**
   * Delete all versions of a pack
   * @param packName - Pack name
   * @param requesterId - User requesting deletion (for authorization)
   * @returns Number of versions deleted or error
   */
  deleteAllVersions(
    packName: string,
    requesterId: string
  ): PackOperationResult<{ deletedCount: number }> {
    logger.debug('Attempting to delete all pack versions', { packName, requesterId });

    // Check if pack exists
    if (!packExists(packName)) {
      logger.warn('Delete all versions failed: pack not found', { packName, requesterId });
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Pack ${packName} not found`,
          details: { packName },
        },
      };
    }

    // Check ownership of all versions (should be same owner)
    const versions = findPackVersions(packName);
    const nonOwned = versions.find((p) => p.ownerId !== requesterId);
    if (nonOwned) {
      logger.warn('Delete all versions forbidden: not owner of all versions', {
        packName,
        requesterId,
        nonOwnedVersion: nonOwned.version,
        actualOwner: nonOwned.ownerId,
      });
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only the pack owner can delete all versions',
          details: { packName },
        },
      };
    }

    const deletedCount = storeRemovePackByName(packName);

    logger.info('All pack versions deleted successfully', {
      packName,
      deletedCount,
      requesterId,
    });

    return {
      success: true,
      data: { deletedCount },
    };
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Get pack by ID
   */
  getById(packId: string): PackOperationResult<Pack> {
    const pack = findPackById(packId);
    if (!pack) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Pack ${packId} not found`,
          details: { packId },
        },
      };
    }
    return { success: true, data: pack };
  }

  /**
   * Get pack by name and version
   */
  getByNameVersion(name: string, version: string): PackOperationResult<Pack> {
    const pack = findPackByNameVersion(name, version);
    if (!pack) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Pack ${name}@${version} not found`,
          details: { name, version },
        },
      };
    }
    return { success: true, data: pack };
  }

  /**
   * Get latest version of a pack
   */
  getLatest(packName: string): PackOperationResult<Pack> {
    const pack = getLatestPackVersion(packName);
    if (!pack) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Pack ${packName} not found`,
          details: { packName },
        },
      };
    }
    return { success: true, data: pack };
  }

  /**
   * Get all versions of a pack
   */
  getVersions(packName: string): PackOperationResult<PackVersionSummary[]> {
    if (!packExists(packName)) {
      return {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Pack ${packName} not found`,
          details: { packName },
        },
      };
    }
    const versions = getPackVersionSummaries(packName);
    return { success: true, data: versions };
  }

  /**
   * List packs with filtering and pagination
   */
  list(filters: PackListFilters = {}): PackOperationResult<PackListResponse> {
    const { name, runtimeTag, ownerId, page = 1, pageSize = 20 } = filters;

    // Start with all packs
    let packs = [...clusterState.packs.values()];

    // Apply filters
    if (name) {
      const lowerName = name.toLowerCase();
      packs = packs.filter((p) => p.name.toLowerCase().includes(lowerName));
    }

    if (runtimeTag) {
      packs = packs.filter((p) => p.runtimeTag === runtimeTag);
    }

    if (ownerId) {
      packs = packs.filter((p) => p.ownerId === ownerId);
    }

    // Get unique packs (latest version per name)
    const latestByName = new Map<string, Pack>();
    for (const pack of packs) {
      const existing = latestByName.get(pack.name);
      if (!existing || compareSemVer(pack.version, existing.version) > 0) {
        latestByName.set(pack.name, pack);
      }
    }

    // Sort by name
    const sortedPacks = [...latestByName.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Pagination
    const total = sortedPacks.length;
    const offset = (page - 1) * pageSize;
    const paginatedPacks = sortedPacks.slice(offset, offset + pageSize);

    return {
      success: true,
      data: {
        packs: paginatedPacks,
        total,
        page,
        pageSize,
      },
    };
  }

  /**
   * Search packs by name
   */
  search(query: string): PackOperationResult<Pack[]> {
    const packs = searchPacksByName(query);
    return { success: true, data: packs };
  }

  /**
   * Find packs by owner
   */
  findByOwner(ownerId: string): PackOperationResult<Pack[]> {
    const packs = findPacksByOwner(ownerId);
    return { success: true, data: packs };
  }

  /**
   * Find packs by runtime tag
   */
  findByRuntime(runtimeTag: RuntimeTag): PackOperationResult<Pack[]> {
    const packs = findPacksByRuntime(runtimeTag);
    return { success: true, data: packs };
  }

  /**
   * Find packs compatible with a runtime type
   */
  findCompatibleWith(runtimeType: 'node' | 'browser'): PackOperationResult<Pack[]> {
    const packs = findPacksCompatibleWith(runtimeType);
    return { success: true, data: packs };
  }

  /**
   * Check if a specific version exists
   */
  versionExists(packName: string, version: string): boolean {
    return packVersionExists(packName, version);
  }

  /**
   * Check if any version of a pack exists
   */
  exists(packName: string): boolean {
    return packExists(packName);
  }

  /**
   * Check runtime compatibility
   */
  isCompatible(pack: Pack, nodeRuntime: 'node' | 'browser'): boolean {
    return isRuntimeCompatible(pack.runtimeTag, nodeRuntime);
  }

  // ===========================================================================
  // Model helpers
  // ===========================================================================

  /**
   * Create a reactive PackModel from a pack
   */
  createModel(pack: Pack): PackModel {
    return new PackModel(pack);
  }

  /**
   * Create a list item from a pack
   */
  toListItem(pack: Pack): PackListItem {
    const versions = findPackVersions(pack.name);
    return new PackModel(pack).toListItem(versions.length);
  }
}

/**
 * Default pack registry instance
 */
export const packRegistry = new PackRegistry();

/**
 * Create a pack registry with custom options
 */
export function createPackRegistry(options: PackRegistrationOptions = {}): PackRegistry {
  return new PackRegistry(options);
}
