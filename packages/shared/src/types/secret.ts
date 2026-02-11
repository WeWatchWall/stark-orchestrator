/**
 * Secret type definitions for Stark Orchestrator
 *
 * Secrets are first-class resources with self-contained injection definitions.
 * The secret itself declares how it should be injected into pods (env or volume),
 * keeping service specs clean and declarative.
 *
 * @module @stark-o/shared/types/secret
 */

// ============================================================================
// Secret Types
// ============================================================================

/**
 * Secret types supported by the orchestrator.
 *
 * - `opaque`  — generic key-value pairs (passwords, API keys, tokens)
 * - `tls`     — TLS certificate + private key pair
 * - `docker-registry` — Docker registry authentication credentials
 */
export type SecretType = 'opaque' | 'tls' | 'docker-registry';

/**
 * Valid secret type values (for validation)
 */
export const VALID_SECRET_TYPES: SecretType[] = ['opaque', 'tls', 'docker-registry'];

/**
 * Secret injection mode.
 * Defines how the secret is delivered to pods.
 *
 * - `env`    — inject as environment variables
 * - `volume` — mount as files in a directory
 */
export type SecretInjectionMode = 'env' | 'volume';

/**
 * Valid injection modes (for validation)
 */
export const VALID_INJECTION_MODES: SecretInjectionMode[] = ['env', 'volume'];

// ============================================================================
// Injection Configuration
// ============================================================================

/**
 * Environment variable injection configuration.
 *
 * When mode is `env`, each key in the secret data becomes an
 * environment variable. An optional prefix and key-to-env mapping
 * allow fine-grained control.
 *
 * @example
 * // Secret data: { username: "admin", password: "s3cret" }
 * // With prefix "DB_":
 * //   DB_USERNAME=admin
 * //   DB_PASSWORD=s3cret
 *
 * @example
 * // With explicit keyMapping:
 * // { username: "PGUSER", password: "PGPASSWORD" }
 * //   PGUSER=admin
 * //   PGPASSWORD=s3cret
 */
export interface SecretEnvInjection {
  mode: 'env';
  /**
   * Prefix applied to environment variable names.
   * Each secret key is uppercased and prepended with this prefix.
   * Ignored for keys that have an explicit keyMapping entry.
   */
  prefix?: string;
  /**
   * Explicit key-to-environment-variable-name mapping.
   * Overrides the default "PREFIX + UPPERCASE_KEY" naming.
   * Keys not listed fall back to the default naming.
   */
  keyMapping?: Record<string, string>;
}

/**
 * Volume mount injection configuration.
 *
 * When mode is `volume`, each key in the secret data is written
 * as a file under mountPath. Optional fileMapping allows renaming.
 *
 * @example
 * // Secret data: { cert: "...", key: "..." }
 * // With mountPath "/etc/tls":
 * //   /etc/tls/cert
 * //   /etc/tls/key
 *
 * @example
 * // With fileMapping: { cert: "tls.crt", key: "tls.key" }
 * //   /etc/tls/tls.crt
 * //   /etc/tls/tls.key
 */
export interface SecretVolumeInjection {
  mode: 'volume';
  /**
   * Absolute path inside the pod where secret files are mounted.
   * Must start with `/`.
   */
  mountPath: string;
  /**
   * Optional per-key file name mapping.
   * Keys not listed use their secret data key name as filename.
   */
  fileMapping?: Record<string, string>;
}

/**
 * Union type for secret injection configuration.
 * Defined inside the Secret resource itself — services only reference names.
 */
export type SecretInjection = SecretEnvInjection | SecretVolumeInjection;

// ============================================================================
// Secret Resource
// ============================================================================

/**
 * Secret resource — a first-class orchestrator resource.
 *
 * Secrets are independent of services. A service only references a secret
 * by name; the secret itself defines the injection behavior. This design
 * keeps service specs clean and makes secrets portable across services.
 *
 * Secret data is stored encrypted at rest and is NEVER included in API
 * responses, logs, event streams, or crash dumps.
 */
export interface Secret {
  /** Unique identifier (UUID) */
  id: string;
  /** Secret name (unique within namespace, DNS-like) */
  name: string;
  /** Namespace the secret belongs to */
  namespace: string;
  /** Secret type */
  type: SecretType;
  /**
   * Encrypted secret data.
   * This field contains the AES-256-GCM encrypted payload.
   * At rest the value is a base64-encoded ciphertext blob.
   * In memory during pod injection it is decrypted transiently.
   *
   * The plaintext shape is Record<string, string>.
   * NEVER log, serialize to API responses, or embed in events.
   */
  encryptedData: string;
  /**
   * Initialization vector used for AES-GCM encryption.
   * Stored alongside the ciphertext for decryption.
   */
  iv: string;
  /**
   * AES-GCM authentication tag for integrity verification.
   */
  authTag: string;
  /** Injection configuration (how to deliver to pods) */
  injection: SecretInjection;
  /**
   * Version counter. Incremented on every data update.
   * Used for rotation tracking and future multi-version support.
   */
  version: number;
  /** User who created the secret */
  createdBy: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

// ============================================================================
// Input / Output Types
// ============================================================================

/**
 * Input for creating a secret.
 * Data is provided in plaintext — encryption happens internally.
 */
export interface CreateSecretInput {
  /** Secret name */
  name: string;
  /** Target namespace */
  namespace?: string;
  /** Secret type */
  type: SecretType;
  /**
   * Plaintext key-value data.
   * For opaque: arbitrary key-value pairs.
   * For tls: must include `cert` and `key`.
   * For docker-registry: must include `server`, `username`, `password`.
   */
  data: Record<string, string>;
  /** Injection configuration */
  injection: SecretInjection;
}

/**
 * Input for updating a secret.
 * Updating data triggers a version bump and pod rotation.
 */
export interface UpdateSecretInput {
  /** Updated plaintext data (replaces all existing data) */
  data?: Record<string, string>;
  /** Updated injection configuration */
  injection?: SecretInjection;
}

/**
 * Summary view of a secret for listing (no secret data exposed).
 */
export interface SecretListItem {
  id: string;
  name: string;
  namespace: string;
  type: SecretType;
  injection: SecretInjection;
  /** Number of keys in the secret (without revealing key names) */
  keyCount: number;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resolved secret material for pod injection.
 * This is a transient, in-memory-only structure.
 * Must be zeroed/discarded after injection.
 *
 * @internal — never returned via API or logged
 */
export interface ResolvedSecretMaterial {
  /** Secret name */
  name: string;
  /** Secret type */
  type: SecretType;
  /** Decrypted plaintext data */
  data: Record<string, string>;
  /** Injection configuration */
  injection: SecretInjection;
}

/**
 * Computed environment variables from one or more secrets.
 * Used during pod startup to populate the process environment.
 *
 * @internal
 */
export interface SecretEnvBundle {
  /** Merged environment variable map */
  env: Record<string, string>;
}

/**
 * Computed volume mounts from one or more secrets.
 * Used during pod startup to write secret files.
 *
 * @internal
 */
export interface SecretVolumeMount {
  /** Absolute mount path */
  mountPath: string;
  /** Filename → content mapping */
  files: Record<string, string>;
}

/**
 * Complete injection payload for a pod.
 * Contains all resolved env vars and volume mounts.
 *
 * @internal — transient, zero after use
 */
export interface PodSecretPayload {
  /** Environment variables from all env-mode secrets */
  env: Record<string, string>;
  /** Volume mounts from all volume-mode secrets */
  volumes: SecretVolumeMount[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Required data keys for TLS secrets
 */
export const TLS_REQUIRED_KEYS = ['cert', 'key'] as const;

/**
 * Required data keys for docker-registry secrets
 */
export const DOCKER_REGISTRY_REQUIRED_KEYS = ['server', 'username', 'password'] as const;

/**
 * Check if a secret type requires specific data keys
 */
export function getRequiredKeysForType(type: SecretType): readonly string[] {
  switch (type) {
    case 'tls':
      return TLS_REQUIRED_KEYS;
    case 'docker-registry':
      return DOCKER_REGISTRY_REQUIRED_KEYS;
    case 'opaque':
    default:
      return [];
  }
}

/**
 * Maximum secret name length
 */
export const MAX_SECRET_NAME_LENGTH = 253;

/**
 * Maximum number of keys in a secret
 */
export const MAX_SECRET_KEYS = 64;

/**
 * Maximum total secret data size in bytes (1 MB)
 */
export const MAX_SECRET_DATA_SIZE = 1_048_576;

/**
 * Secret name pattern (DNS subdomain: lowercase, alphanumeric, hyphens, dots)
 */
export const SECRET_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$|^[a-z0-9]$/;
