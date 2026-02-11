/**
 * Secret Manager Service
 *
 * Orchestrates secret lifecycle: creation, update, deletion, rotation,
 * and pod injection. This is the single authority for secrets — all
 * access goes through here.
 *
 * Security invariants enforced:
 * - Plaintext data is never stored; always encrypted at rest.
 * - Plaintext is never returned in operation results.
 * - Plaintext is never logged.
 * - Resolved material is short-lived and wiped after use.
 * - Mount path conflicts are validated before pod scheduling.
 *
 * @module @stark-o/core/services/secret-manager
 */

import type {
  Secret,
  SecretListItem,
  CreateSecretInput,
  UpdateSecretInput,
  ResolvedSecretMaterial,
  PodSecretPayload,
  SecretVolumeMount,
} from '@stark-o/shared';
import {
  validateCreateSecretInput,
  validateUpdateSecretInput,
  validateMountPathConflicts,
} from '@stark-o/shared';
import {
  addSecret,
  updateSecret as updateSecretInStore,
  removeSecret,
  findSecretById,
  findSecretByName,
  secretExists,
  resolveSecretNames,
  getSecretListItems,
  resetSecretStore,
} from '../stores/secret-store';
import {
  encryptSecretData,
  decryptSecretData,
  wipeSecretMaterial,
  initMasterKey,
  resetMasterKey,
} from './secret-crypto';

// ============================================================================
// Types
// ============================================================================

/**
 * Operation result following the same pattern as other Stark services
 */
export interface SecretOperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Secret manager options
 */
export interface SecretManagerOptions {
  /** Master encryption key (if not set, reads from env or generates ephemeral) */
  masterKey?: string;
  /** Default namespace for secrets */
  defaultNamespace?: string;
}

/**
 * Error codes for secret operations
 */
export const SecretManagerErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  SECRET_EXISTS: 'SECRET_EXISTS',
  SECRET_NOT_FOUND: 'SECRET_NOT_FOUND',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  MOUNT_PATH_CONFLICT: 'MOUNT_PATH_CONFLICT',
  MISSING_SECRETS: 'MISSING_SECRETS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// ============================================================================
// SecretManager Class
// ============================================================================

export class SecretManager {
  private readonly defaultNamespace: string;

  constructor(options: SecretManagerOptions = {}) {
    this.defaultNamespace = options.defaultNamespace ?? 'default';
    initMasterKey(options.masterKey);
  }

  // ==========================================================================
  // CRUD Operations
  // ==========================================================================

  /**
   * Create a new secret.
   *
   * 1. Validates input (name, type, data shape, injection config)
   * 2. Checks for name uniqueness within namespace
   * 3. Encrypts plaintext data with AES-256-GCM
   * 4. Stores the encrypted resource
   * 5. Returns metadata only (no plaintext)
   */
  create(
    input: CreateSecretInput,
    createdBy: string = 'system',
  ): SecretOperationResult<SecretListItem> {
    // Validate
    const validation = validateCreateSecretInput(input);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.VALIDATION_FAILED,
          message: 'Secret validation failed',
          details: { errors: validation.errors },
        },
      };
    }

    const namespace = input.namespace ?? this.defaultNamespace;

    // Check uniqueness
    if (secretExists(input.name, namespace)) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.SECRET_EXISTS,
          message: `Secret "${input.name}" already exists in namespace "${namespace}"`,
        },
      };
    }

    // Encrypt data
    const encrypted = encryptSecretData(input.data);

    // Build resource
    const now = new Date();
    const secret: Secret = {
      id: crypto.randomUUID(),
      name: input.name,
      namespace,
      type: input.type,
      encryptedData: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      injection: input.injection,
      version: 1,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    addSecret(secret);

    // Return list item (safe — no secret data)
    const keyCount = Object.keys(input.data).length;
    return {
      success: true,
      data: {
        id: secret.id,
        name: secret.name,
        namespace: secret.namespace,
        type: secret.type,
        injection: secret.injection,
        keyCount,
        version: secret.version,
        createdBy: secret.createdBy,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      },
    };
  }

  /**
   * Update an existing secret's data and/or injection configuration.
   *
   * When data is updated:
   * - Version is bumped
   * - New data is re-encrypted with a fresh IV
   * - Returns updated metadata
   *
   * The caller (scheduler) is responsible for triggering pod rotation
   * after a successful data update.
   */
  update(
    nameOrId: string,
    input: UpdateSecretInput,
    namespace?: string,
  ): SecretOperationResult<SecretListItem> {
    // Find secret
    const secret = this.findSecret(nameOrId, namespace);
    if (!secret) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.SECRET_NOT_FOUND,
          message: `Secret "${nameOrId}" not found`,
        },
      };
    }

    // Validate update
    const validation = validateUpdateSecretInput(input, secret.type);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.VALIDATION_FAILED,
          message: 'Secret update validation failed',
          details: { errors: validation.errors },
        },
      };
    }

    // Build updates
    const updates: Partial<Secret> = {};

    if (input.data) {
      const encrypted = encryptSecretData(input.data);
      updates.encryptedData = encrypted.ciphertext;
      updates.iv = encrypted.iv;
      updates.authTag = encrypted.authTag;
      updates.version = secret.version + 1;
    }

    if (input.injection) {
      updates.injection = input.injection;
    }

    const updated = updateSecretInStore(secret.id, updates);
    if (!updated) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.INTERNAL_ERROR,
          message: 'Failed to update secret in store',
        },
      };
    }

    const keyCount = input.data
      ? Object.keys(input.data).length
      : 0; // Can't know without decryption; omit for now

    return {
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        namespace: updated.namespace,
        type: updated.type,
        injection: updated.injection,
        keyCount,
        version: updated.version,
        createdBy: updated.createdBy,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    };
  }

  /**
   * Delete a secret.
   * Returns true if deleted, false if not found.
   */
  delete(
    nameOrId: string,
    namespace?: string,
  ): SecretOperationResult {
    const secret = this.findSecret(nameOrId, namespace);
    if (!secret) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.SECRET_NOT_FOUND,
          message: `Secret "${nameOrId}" not found`,
        },
      };
    }

    removeSecret(secret.id);

    return { success: true };
  }

  /**
   * Get a secret's metadata (safe — no plaintext).
   */
  get(
    nameOrId: string,
    namespace?: string,
  ): SecretOperationResult<SecretListItem> {
    const secret = this.findSecret(nameOrId, namespace);
    if (!secret) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.SECRET_NOT_FOUND,
          message: `Secret "${nameOrId}" not found`,
        },
      };
    }

    // Decrypt briefly to get key count, then discard
    let keyCount = 0;
    try {
      const data = decryptSecretData(secret.encryptedData, secret.iv, secret.authTag);
      keyCount = Object.keys(data).length;
      // Wipe reference
      wipeSecretMaterial({ data });
    } catch {
      // If decryption fails, key count is unknown
    }

    return {
      success: true,
      data: {
        id: secret.id,
        name: secret.name,
        namespace: secret.namespace,
        type: secret.type,
        injection: secret.injection,
        keyCount,
        version: secret.version,
        createdBy: secret.createdBy,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      },
    };
  }

  /**
   * List secrets (safe — no plaintext).
   */
  list(namespace?: string): SecretOperationResult<SecretListItem[]> {
    const items = getSecretListItems(namespace);
    return { success: true, data: items };
  }

  // ==========================================================================
  // Pod Injection
  // ==========================================================================

  /**
   * Resolve secrets for a pod.
   *
   * Given a list of secret names (from service spec), this method:
   * 1. Validates all names exist in the namespace
   * 2. Checks for mount path conflicts among volume-mode secrets
   * 3. Decrypts each secret
   * 4. Computes environment variables and volume mounts
   * 5. Returns a PodSecretPayload ready for injection
   *
   * The returned payload is TRANSIENT — the caller must discard it
   * after injecting into the pod process.
   *
   * @param secretNames — list of secret names from service spec
   * @param namespace — pod namespace
   * @returns Resolved env vars and volume mounts, or an error
   */
  resolveForPod(
    secretNames: string[],
    namespace: string = 'default',
  ): SecretOperationResult<PodSecretPayload> {
    if (!secretNames || secretNames.length === 0) {
      return { success: true, data: { env: {}, volumes: [] } };
    }

    // Resolve names to secrets
    const { found, missing } = resolveSecretNames(secretNames, namespace);

    if (missing.length > 0) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.MISSING_SECRETS,
          message: `Secrets not found: ${missing.join(', ')}`,
          details: { missing },
        },
      };
    }

    // Validate mount path conflicts
    const volumeSecrets = found
      .filter(s => s.injection.mode === 'volume')
      .map(s => ({
        name: s.name,
        injection: s.injection as { mode: string; mountPath?: string },
      }));

    const conflicts = validateMountPathConflicts(volumeSecrets);
    if (conflicts.length > 0) {
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.MOUNT_PATH_CONFLICT,
          message: 'Volume mount path conflicts detected',
          details: { conflicts },
        },
      };
    }

    // Decrypt and resolve
    const materials: ResolvedSecretMaterial[] = [];
    try {
      for (const secret of found) {
        const data = decryptSecretData(secret.encryptedData, secret.iv, secret.authTag);
        materials.push({
          name: secret.name,
          type: secret.type,
          data,
          injection: secret.injection,
        });
      }
    } catch {
      // Wipe all materials on failure
      for (const m of materials) {
        wipeSecretMaterial(m);
      }
      return {
        success: false,
        error: {
          code: SecretManagerErrorCodes.DECRYPTION_FAILED,
          message: 'Failed to decrypt one or more secrets',
        },
      };
    }

    // Build payload
    const payload = this.buildPayload(materials);

    // Wipe materials
    for (const m of materials) {
      wipeSecretMaterial(m);
    }

    return { success: true, data: payload };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Find a secret by name or ID, optionally scoped to a namespace.
   */
  private findSecret(nameOrId: string, namespace?: string): Secret | null {
    // Try by ID first
    const byId = findSecretById(nameOrId);
    if (byId) return byId;

    // Try by name in namespace
    return findSecretByName(nameOrId, namespace ?? this.defaultNamespace);
  }

  /**
   * Build a PodSecretPayload from resolved materials.
   */
  private buildPayload(materials: ResolvedSecretMaterial[]): PodSecretPayload {
    const env: Record<string, string> = {};
    const volumes: SecretVolumeMount[] = [];

    for (const material of materials) {
      if (material.injection.mode === 'env') {
        const envInj = material.injection;
        for (const [key, value] of Object.entries(material.data)) {
          // Check explicit key mapping first
          if (envInj.keyMapping && envInj.keyMapping[key]) {
            env[envInj.keyMapping[key]] = value;
          } else {
            // Default: PREFIX + UPPERCASE_KEY
            const envName = (envInj.prefix ?? '') + key.toUpperCase();
            env[envName] = value;
          }
        }
      } else if (material.injection.mode === 'volume') {
        const volInj = material.injection;
        const files: Record<string, string> = {};
        for (const [key, value] of Object.entries(material.data)) {
          const fileName = volInj.fileMapping?.[key] ?? key;
          files[fileName] = value;
        }
        volumes.push({
          mountPath: volInj.mountPath,
          files,
        });
      }
    }

    return { env, volumes };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Default singleton instance.
 * Initialize with `createSecretManager()` for custom options.
 */
export let secretManager: SecretManager = new SecretManager();

/**
 * Create and replace the singleton SecretManager.
 */
export function createSecretManager(options?: SecretManagerOptions): SecretManager {
  secretManager = new SecretManager(options);
  return secretManager;
}

/**
 * Reset secret manager and store (for testing).
 */
export function resetSecretManager(): void {
  resetSecretStore();
  resetMasterKey();
  secretManager = new SecretManager();
}
