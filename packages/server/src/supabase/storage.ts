/**
 * Supabase Storage Operations
 *
 * Provides file upload, download, and management for pack bundles
 * using Supabase Storage.
 * @module @stark-o/server/supabase/storage
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceClient } from './client.js';

/**
 * Storage bucket names
 */
export const STORAGE_BUCKETS = {
  PACK_BUNDLES: 'pack-bundles',
} as const;

/**
 * Result type for storage operations
 */
export interface StorageResult<T> {
  data: T | null;
  error: StorageError | null;
}

/**
 * Storage error type
 */
export interface StorageError {
  message: string;
  statusCode?: string;
}

/**
 * Upload result data
 */
export interface UploadResult {
  path: string;
  fullPath: string;
  id: string;
}

/**
 * Download result data
 */
export interface DownloadResult {
  data: Blob;
  contentType: string | null;
}

/**
 * Signed URL result data
 */
export interface SignedUrlResult {
  signedUrl: string;
  path: string;
}

/**
 * File metadata
 */
export interface FileMetadata {
  name: string;
  id: string;
  size: number;
  contentType: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Storage queries class for interacting with Supabase Storage
 */
export class StorageQueries {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseServiceClient();
  }

  /**
   * Generates a storage path for a pack bundle
   * Format: {ownerId}/{packName}/{version}/bundle.{extension}
   */
  generatePackBundlePath(
    ownerId: string,
    packName: string,
    version: string,
    extension = 'js'
  ): string {
    // Sanitize pack name for safe file paths
    const safeName = packName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const safeVersion = version.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${ownerId}/${safeName}/${safeVersion}/bundle.${extension}`;
  }

  /**
   * Ensures the pack-bundles bucket exists
   * Creates it if it doesn't exist
   */
  async ensureBucketExists(): Promise<StorageResult<boolean>> {
    const { data: buckets, error: listError } = await this.client.storage.listBuckets();

    if (listError) {
      return {
        data: null,
        error: { message: listError.message, statusCode: listError.message },
      };
    }

    const bucketExists = buckets?.some((b) => b.name === STORAGE_BUCKETS.PACK_BUNDLES);

    if (!bucketExists) {
      const { error: createError } = await this.client.storage.createBucket(
        STORAGE_BUCKETS.PACK_BUNDLES,
        {
          public: false,
          fileSizeLimit: 50 * 1024 * 1024, // 50MB limit
          allowedMimeTypes: [
            'application/javascript',
            'text/javascript',
            'application/json',
            'application/zip',
            'application/gzip',
            'application/x-tar',
          ],
        }
      );

      if (createError) {
        return {
          data: null,
          error: { message: createError.message, statusCode: createError.message },
        };
      }
    }

    return { data: true, error: null };
  }

  /**
   * Uploads a pack bundle to storage
   *
   * @param path - Storage path for the bundle
   * @param file - File content (Buffer, Blob, ArrayBuffer, or FormData)
   * @param options - Upload options
   * @returns Upload result with path and ID
   */
  async uploadPackBundle(
    path: string,
    file: Buffer | Blob | ArrayBuffer | FormData,
    options?: {
      contentType?: string;
      upsert?: boolean;
      cacheControl?: string;
    }
  ): Promise<StorageResult<UploadResult>> {
    // Ensure bucket exists
    const { error: bucketError } = await this.ensureBucketExists();
    if (bucketError) {
      return { data: null, error: bucketError };
    }

    const { data, error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .upload(path, file, {
        contentType: options?.contentType ?? 'application/javascript',
        upsert: options?.upsert ?? false,
        cacheControl: options?.cacheControl ?? '3600',
      });

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return {
      data: {
        path: data.path,
        fullPath: data.fullPath ?? `${STORAGE_BUCKETS.PACK_BUNDLES}/${data.path}`,
        id: data.id ?? data.path,
      },
      error: null,
    };
  }

  /**
   * Uploads a pack bundle from raw content
   *
   * @param ownerId - Owner user ID
   * @param packName - Pack name
   * @param version - Pack version
   * @param content - Bundle content as string or Buffer
   * @param options - Upload options
   * @returns Upload result with path
   */
  async uploadPackBundleContent(
    ownerId: string,
    packName: string,
    version: string,
    content: string | Buffer,
    options?: {
      extension?: string;
      contentType?: string;
      upsert?: boolean;
    }
  ): Promise<StorageResult<UploadResult>> {
    const path = this.generatePackBundlePath(
      ownerId,
      packName,
      version,
      options?.extension ?? 'js'
    );

    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;

    return this.uploadPackBundle(path, buffer, {
      contentType: options?.contentType ?? 'application/javascript',
      upsert: options?.upsert ?? false,
    });
  }

  /**
   * Downloads a pack bundle from storage
   *
   * @param path - Storage path of the bundle
   * @returns Download result with blob data
   */
  async downloadPackBundle(path: string): Promise<StorageResult<DownloadResult>> {
    const { data, error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .download(path);

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return {
      data: {
        data,
        contentType: data.type,
      },
      error: null,
    };
  }

  /**
   * Downloads a pack bundle and returns it as a string
   *
   * @param path - Storage path of the bundle
   * @returns Bundle content as string
   */
  async downloadPackBundleAsText(path: string): Promise<StorageResult<string>> {
    const { data, error } = await this.downloadPackBundle(path);

    if (error !== null) {
      return { data: null, error };
    }

    if (!data) {
      return { data: null, error: null };
    }

    try {
      const text = await data.data.text();
      return { data: text, error: null };
    } catch (e) {
      return {
        data: null,
        error: { message: `Failed to read bundle as text: ${(e as Error).message}` },
      };
    }
  }

  /**
   * Creates a signed URL for temporary access to a pack bundle
   *
   * @param path - Storage path of the bundle
   * @param expiresIn - URL expiration time in seconds (default: 3600)
   * @returns Signed URL result
   */
  async createSignedUrl(
    path: string,
    expiresIn = 3600
  ): Promise<StorageResult<SignedUrlResult>> {
    const { data, error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .createSignedUrl(path, expiresIn);

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return {
      data: {
        signedUrl: data.signedUrl,
        path,
      },
      error: null,
    };
  }

  /**
   * Creates multiple signed URLs at once
   *
   * @param paths - Array of storage paths
   * @param expiresIn - URL expiration time in seconds
   * @returns Array of signed URL results
   */
  async createSignedUrls(
    paths: string[],
    expiresIn = 3600
  ): Promise<StorageResult<SignedUrlResult[]>> {
    const { data, error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .createSignedUrls(paths, expiresIn);

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return {
      data: data.map((item) => ({
        signedUrl: item.signedUrl ?? '',
        path: item.path ?? '',
      })),
      error: null,
    };
  }

  /**
   * Deletes a pack bundle from storage
   *
   * @param path - Storage path of the bundle to delete
   */
  async deletePackBundle(path: string): Promise<StorageResult<boolean>> {
    const { error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .remove([path]);

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return { data: true, error: null };
  }

  /**
   * Deletes multiple pack bundles from storage
   *
   * @param paths - Array of storage paths to delete
   */
  async deletePackBundles(paths: string[]): Promise<StorageResult<boolean>> {
    const { error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .remove(paths);

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return { data: true, error: null };
  }

  /**
   * Deletes all bundles for a specific pack (all versions)
   *
   * @param ownerId - Owner user ID
   * @param packName - Pack name
   */
  async deleteAllPackVersions(
    ownerId: string,
    packName: string
  ): Promise<StorageResult<boolean>> {
    const safeName = packName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const folderPath = `${ownerId}/${safeName}`;

    // List all files in the pack folder
    const { data: files, error: listError } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .list(folderPath, { limit: 1000, offset: 0 });

    if (listError) {
      return {
        data: null,
        error: { message: listError.message, statusCode: listError.message },
      };
    }

    if (files.length === 0) {
      return { data: true, error: null };
    }

    // Get all nested files
    const allPaths: string[] = [];
    for (const item of files) {
      if (item.id) {
        // It's a folder, need to list its contents
        const { data: nestedFiles } = await this.client.storage
          .from(STORAGE_BUCKETS.PACK_BUNDLES)
          .list(`${folderPath}/${item.name}`, { limit: 100 });

        if (nestedFiles) {
          for (const nested of nestedFiles) {
            allPaths.push(`${folderPath}/${item.name}/${nested.name}`);
          }
        }
      } else {
        allPaths.push(`${folderPath}/${item.name}`);
      }
    }

    if (allPaths.length > 0) {
      return this.deletePackBundles(allPaths);
    }

    return { data: true, error: null };
  }

  /**
   * Lists all bundles for a specific pack
   *
   * @param ownerId - Owner user ID
   * @param packName - Pack name
   */
  async listPackBundles(
    ownerId: string,
    packName: string
  ): Promise<StorageResult<FileMetadata[]>> {
    const safeName = packName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const folderPath = `${ownerId}/${safeName}`;

    const { data: folders, error: listError } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .list(folderPath, { limit: 100 });

    if (listError) {
      return {
        data: null,
        error: { message: listError.message, statusCode: listError.message },
      };
    }

    if (folders.length === 0) {
      return { data: [], error: null };
    }

    const metadata: FileMetadata[] = [];

    for (const folder of folders) {
      const { data: files } = await this.client.storage
        .from(STORAGE_BUCKETS.PACK_BUNDLES)
        .list(`${folderPath}/${folder.name}`, { limit: 10 });

      if (files) {
        for (const file of files) {
          if (file.name && file.id) {
            const fileMetadata = file.metadata as Record<string, unknown> | undefined;
            metadata.push({
              name: file.name,
              id: file.id,
              size: (fileMetadata?.size as number) ?? 0,
              contentType: (fileMetadata?.mimetype as string) ?? 'application/octet-stream',
              createdAt: new Date(file.created_at ?? Date.now()),
              updatedAt: new Date(file.updated_at ?? Date.now()),
            });
          }
        }
      }
    }

    return { data: metadata, error: null };
  }

  /**
   * Checks if a pack bundle exists at the given path
   *
   * @param path - Storage path to check
   */
  async bundleExists(path: string): Promise<StorageResult<boolean>> {
    const { data, error } = await this.downloadPackBundle(path);

    if (error) {
      // If error is "Object not found", return false (not an error)
      if (error.message.toLowerCase().includes('not found')) {
        return { data: false, error: null };
      }
      return { data: null, error };
    }

    return { data: data !== null, error: null };
  }

  /**
   * Gets the public URL for a pack bundle (if bucket is public)
   *
   * @param path - Storage path of the bundle
   */
  getPublicUrl(path: string): string {
    const { data } = this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  /**
   * Copies a pack bundle to a new location
   *
   * @param fromPath - Source path
   * @param toPath - Destination path
   */
  async copyPackBundle(
    fromPath: string,
    toPath: string
  ): Promise<StorageResult<UploadResult>> {
    const { error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .copy(fromPath, toPath);

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return {
      data: {
        path: toPath,
        fullPath: `${STORAGE_BUCKETS.PACK_BUNDLES}/${toPath}`,
        id: toPath,
      },
      error: null,
    };
  }

  /**
   * Moves a pack bundle to a new location
   *
   * @param fromPath - Source path
   * @param toPath - Destination path
   */
  async movePackBundle(
    fromPath: string,
    toPath: string
  ): Promise<StorageResult<UploadResult>> {
    const { error } = await this.client.storage
      .from(STORAGE_BUCKETS.PACK_BUNDLES)
      .move(fromPath, toPath);

    if (error) {
      return {
        data: null,
        error: { message: error.message, statusCode: error.message },
      };
    }

    return {
      data: {
        path: toPath,
        fullPath: `${STORAGE_BUCKETS.PACK_BUNDLES}/${toPath}`,
        id: toPath,
      },
      error: null,
    };
  }
}

// Singleton instances
let _storageQueries: StorageQueries | null = null;

/**
 * Gets or creates the default StorageQueries instance (service role client)
 */
export function getStorageQueries(): StorageQueries {
  if (!_storageQueries) {
    _storageQueries = new StorageQueries();
  }
  return _storageQueries;
}

/**
 * Creates a StorageQueries instance with a specific client
 */
export function getStorageQueriesWithClient(client: SupabaseClient): StorageQueries {
  return new StorageQueries(client);
}

/**
 * Resets singleton instances (useful for testing)
 */
export function resetStorageQueries(): void {
  _storageQueries = null;
}

// Convenience functions using the default instance

/**
 * Uploads a pack bundle content
 */
export async function uploadPackBundle(
  ownerId: string,
  packName: string,
  version: string,
  content: string | Buffer,
  options?: {
    extension?: string;
    contentType?: string;
    upsert?: boolean;
  }
): Promise<StorageResult<UploadResult>> {
  return getStorageQueries().uploadPackBundleContent(
    ownerId,
    packName,
    version,
    content,
    options
  );
}

/**
 * Downloads a pack bundle as text
 */
export async function downloadPackBundle(
  path: string
): Promise<StorageResult<string>> {
  return getStorageQueries().downloadPackBundleAsText(path);
}

/**
 * Creates a signed URL for a pack bundle
 */
export async function createPackBundleSignedUrl(
  path: string,
  expiresIn = 3600
): Promise<StorageResult<SignedUrlResult>> {
  return getStorageQueries().createSignedUrl(path, expiresIn);
}

/**
 * Deletes a pack bundle
 */
export async function deletePackBundle(
  path: string
): Promise<StorageResult<boolean>> {
  return getStorageQueries().deletePackBundle(path);
}

/**
 * Checks if a bundle exists
 */
export async function packBundleExists(
  path: string
): Promise<StorageResult<boolean>> {
  return getStorageQueries().bundleExists(path);
}

/**
 * Generates a storage path for a pack bundle
 */
export function generatePackBundlePath(
  ownerId: string,
  packName: string,
  version: string,
  extension = 'js'
): string {
  return getStorageQueries().generatePackBundlePath(ownerId, packName, version, extension);
}
