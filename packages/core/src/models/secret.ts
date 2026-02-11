/**
 * Secret reactive model
 *
 * Provides a reactive wrapper around the Secret resource,
 * following the same patterns as ServiceModel, PodModel, etc.
 *
 * @module @stark-o/core/models/secret
 */

import { reactive } from '@vue/reactivity';
import type {
  Secret,
  SecretType,
  SecretInjection,
  SecretListItem,
  CreateSecretInput,
} from '@stark-o/shared';
import { validateCreateSecretInput } from '@stark-o/shared';

// ============================================================================
// Result Types
// ============================================================================

/**
 * Secret creation result
 */
export interface SecretCreationResult {
  secret: Secret;
}

/**
 * Secret list response with pagination
 */
export interface SecretListResponse {
  secrets: SecretListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Secret list filters
 */
export interface SecretListFilters {
  /** Filter by namespace */
  namespace?: string;
  /** Filter by type */
  type?: SecretType;
  /** Page number (1-based) */
  page?: number;
  /** Page size */
  pageSize?: number;
}

// ============================================================================
// SecretModel
// ============================================================================

/**
 * Reactive Secret model wrapper
 * Provides reactive access to secret metadata with computed properties.
 *
 * IMPORTANT: This model intentionally does NOT expose decrypted data.
 * All data access goes through SecretManager which handles encryption.
 */
export class SecretModel {
  private readonly _secret: Secret;

  constructor(secret: Secret) {
    this._secret = reactive(secret) as Secret;
  }

  /** Raw secret data (with encrypted payload — never plaintext) */
  get data(): Secret {
    return this._secret;
  }

  get id(): string {
    return this._secret.id;
  }

  get name(): string {
    return this._secret.name;
  }

  get namespace(): string {
    return this._secret.namespace;
  }

  get type(): SecretType {
    return this._secret.type;
  }

  get injection(): SecretInjection {
    return this._secret.injection;
  }

  get version(): number {
    return this._secret.version;
  }

  get createdBy(): string {
    return this._secret.createdBy;
  }

  get createdAt(): Date {
    return this._secret.createdAt;
  }

  get updatedAt(): Date {
    return this._secret.updatedAt;
  }

  /** Whether this secret injects as environment variables */
  get isEnvInjection(): boolean {
    return this._secret.injection.mode === 'env';
  }

  /** Whether this secret injects as a volume mount */
  get isVolumeInjection(): boolean {
    return this._secret.injection.mode === 'volume';
  }

  /** Volume mount path (only meaningful for volume injection) */
  get mountPath(): string | undefined {
    return this._secret.injection.mode === 'volume'
      ? this._secret.injection.mountPath
      : undefined;
  }

  /** Env prefix (only meaningful for env injection) */
  get envPrefix(): string | undefined {
    return this._secret.injection.mode === 'env'
      ? this._secret.injection.prefix
      : undefined;
  }

  /**
   * Convert to safe list item (no secret data)
   */
  toListItem(keyCount: number = 0): SecretListItem {
    return {
      id: this._secret.id,
      name: this._secret.name,
      namespace: this._secret.namespace,
      type: this._secret.type,
      injection: this._secret.injection,
      keyCount,
      version: this._secret.version,
      createdBy: this._secret.createdBy,
      createdAt: this._secret.createdAt,
      updatedAt: this._secret.updatedAt,
    };
  }

  /**
   * Create a SecretModel from a creation input (validation + defaults).
   * Does NOT perform encryption — that's done by SecretManager.
   */
  static validate(input: CreateSecretInput): { valid: boolean; errors: Array<{ field: string; message: string }> } {
    const result = validateCreateSecretInput(input);
    return { valid: result.valid, errors: result.errors };
  }
}

/**
 * Create a reactive SecretListItem for UI display
 */
export function createReactiveSecretListItem(secret: Secret, keyCount: number = 0): SecretListItem {
  return reactive<SecretListItem>({
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
  });
}
