/**
 * Secret encryption utilities for Stark Orchestrator
 *
 * Provides AES-256-GCM encryption/decryption for secret data at rest.
 * Uses Node.js built-in crypto module (isomorphic via webcrypto in browsers).
 *
 * Security design:
 * - AES-256-GCM authenticated encryption (confidentiality + integrity)
 * - Random 96-bit IV per encryption operation (never reused)
 * - Master key derived from environment variable or generated on first use
 * - Plaintext is wiped from buffers after use where practical
 *
 * Future: The master key strategy can be swapped for KMS, Vault, or
 * hardware-backed key stores without changing the encryption interface.
 *
 * @module @stark-o/core/services/secret-crypto
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Encryption algorithm — AES-256-GCM
 */
const ALGORITHM = 'aes-256-gcm';

/**
 * IV length in bytes (96 bits recommended for GCM)
 */
const IV_LENGTH = 12;

/**
 * Auth tag length in bytes
 */
const AUTH_TAG_LENGTH = 16;

/**
 * Encryption result
 */
export interface EncryptionResult {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded authentication tag */
  authTag: string;
}

/**
 * Derive a 256-bit key from a passphrase or raw key material.
 * Uses SHA-256 for deterministic key derivation.
 *
 * In production, this should be replaced with a proper KDF (PBKDF2, scrypt)
 * or a key management service. For a single-developer orchestrator this
 * provides adequate security.
 */
function deriveKey(masterKey: string): Buffer {
  return createHash('sha256').update(masterKey).digest();
}

/**
 * In-memory master key. Set once via `initMasterKey()`.
 * Never logged, never serialized.
 */
let _masterKey: Buffer | null = null;

/**
 * Initialize the master encryption key.
 *
 * Call once at orchestrator startup. The key can come from:
 * - Environment variable STARK_MASTER_KEY
 * - A file on disk (future)
 * - A KMS call (future)
 *
 * If no key is provided, generates a random one (ephemeral — secrets
 * won't survive restarts; suitable for development).
 *
 * @param key — raw master key string. If omitted, reads STARK_MASTER_KEY
 *              from environment or generates a random ephemeral key.
 */
export function initMasterKey(key?: string): void {
  const source = key ?? process.env.STARK_MASTER_KEY;
  if (source) {
    _masterKey = deriveKey(source);
  } else {
    // Ephemeral key — development only
    _masterKey = randomBytes(32);
  }
}

/**
 * Get the current master key, initializing if necessary.
 * @internal
 */
function getMasterKey(): Buffer {
  if (!_masterKey) {
    initMasterKey();
  }
  return _masterKey!;
}

/**
 * Reset the master key (for testing purposes only).
 * @internal
 */
export function resetMasterKey(): void {
  if (_masterKey) {
    _masterKey.fill(0);
    _masterKey = null;
  }
}

/**
 * Encrypt a plaintext Record<string, string> to a sealed blob.
 *
 * @param data — plaintext key-value pairs
 * @returns EncryptionResult with ciphertext, iv, and authTag (all base64)
 */
export function encryptSecretData(data: Record<string, string>): EncryptionResult {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const plaintext = JSON.stringify(data);

  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt sealed secret data back to plaintext key-value pairs.
 *
 * @param ciphertext — base64-encoded ciphertext
 * @param iv — base64-encoded initialization vector
 * @param authTag — base64-encoded authentication tag
 * @returns Decrypted plaintext data
 * @throws Error if decryption fails (tampered data, wrong key, etc.)
 */
export function decryptSecretData(
  ciphertext: string,
  iv: string,
  authTag: string,
): Record<string, string> {
  const key = getMasterKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64'),
    { authTagLength: AUTH_TAG_LENGTH },
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);

  const plaintext = decrypted.toString('utf8');

  // Zero the buffer after reading
  decrypted.fill(0);

  return JSON.parse(plaintext) as Record<string, string>;
}

/**
 * Wipe a resolved secret material object from memory.
 * Overwrites string values with empty strings.
 *
 * Note: JavaScript string immutability means we can't truly zero
 * the original strings, but we can remove all references so GC
 * can reclaim the memory. This is the best-effort approach in JS.
 *
 * @param material — object with a `data` field to wipe
 */
export function wipeSecretMaterial(material: { data: Record<string, string> }): void {
  for (const key of Object.keys(material.data)) {
    material.data[key] = '';
    delete material.data[key];
  }
}
