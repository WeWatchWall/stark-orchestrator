// Stark Orchestrator - Browser Runtime
// Storage Adapter using ZenFS with IndexedDB backend

import { IndexedDB } from '@zenfs/dom';
import { fs as zenFs, configureSingle } from '@zenfs/core';
import type {
  IStorageAdapter,
  FileStats,
  DirectoryEntry,
  StorageAdapterConfig,
} from '@stark-o/shared';

/**
 * Configuration options for the browser storage adapter
 */
export interface BrowserStorageConfig extends StorageAdapterConfig {
  /**
   * The root path prefix for all file system operations.
   * @default '/'
   */
  rootPath?: string;

  /**
   * The name of the IndexedDB database to use.
   * @default 'stark-orchestrator'
   */
  storeName?: string;
}

/**
 * Browser storage adapter wrapping ZenFS with IndexedDB backend.
 * Provides a unified file system interface for pack execution in browsers.
 *
 * Note: This implementation only provides async methods since
 * IndexedDB does not support synchronous operations.
 */
export class StorageAdapter implements IStorageAdapter {
  private readonly config: Required<BrowserStorageConfig>;
  private initialized: boolean = false;

  constructor(config: BrowserStorageConfig = {}) {
    this.config = {
      rootPath: config.rootPath ?? '/',
      storeName: config.storeName ?? 'stark-orchestrator',
    };
  }

  /**
   * Initialize the storage adapter with IndexedDB backend.
   * Must be called before using any file system operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await configureSingle({
      backend: IndexedDB,
      storeName: this.config.storeName,
    });

    this.initialized = true;
  }

  /**
   * Check if the adapter has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure the adapter is initialized before operations.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'StorageAdapter not initialized. Call initialize() first.',
      );
    }
  }

  /**
   * Get the configured root path.
   */
  getRootPath(): string {
    return this.config.rootPath;
  }

  /**
   * Resolve a path relative to the root path.
   */
  private resolvePath(path: string): string {
    if (path.startsWith('/')) {
      return path;
    }
    const root = this.config.rootPath.endsWith('/')
      ? this.config.rootPath
      : this.config.rootPath + '/';
    return root + path;
  }

  // ============================================
  // File Reading Operations
  // ============================================

  /**
   * Read file contents as a string.
   * @param path - Path to the file (relative to root path)
   * @param encoding - Character encoding (default: 'utf-8')
   */
  async readFile(
    path: string,
    encoding: BufferEncoding = 'utf-8',
  ): Promise<string> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    return zenFs.promises.readFile(resolvedPath, encoding);
  }

  /**
   * Read file contents as a Uint8Array.
   * @param path - Path to the file (relative to root path)
   */
  async readFileBytes(path: string): Promise<Uint8Array> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    return new Uint8Array(await zenFs.promises.readFile(resolvedPath));
  }

  // ============================================
  // File Writing Operations
  // ============================================

  /**
   * Write string content to a file.
   * @param path - Path to the file (relative to root path)
   * @param content - Content to write
   * @param encoding - Character encoding (default: 'utf-8')
   */
  async writeFile(
    path: string,
    content: string | Uint8Array,
    encoding: BufferEncoding = 'utf-8',
  ): Promise<void> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    await zenFs.promises.writeFile(resolvedPath, content, { encoding });
  }

  /**
   * Append content to a file.
   * @param path - Path to the file (relative to root path)
   * @param content - Content to append
   * @param encoding - Character encoding (default: 'utf-8')
   */
  async appendFile(
    path: string,
    content: string | Uint8Array,
    encoding: BufferEncoding = 'utf-8',
  ): Promise<void> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    await zenFs.promises.appendFile(resolvedPath, content, { encoding });
  }

  // ============================================
  // Directory Operations
  // ============================================

  /**
   * Create a directory.
   * @param path - Path to the directory (relative to root path)
   * @param recursive - Create parent directories if they don't exist (default: true)
   */
  async mkdir(path: string, recursive: boolean = true): Promise<void> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    await zenFs.promises.mkdir(resolvedPath, { recursive });
  }

  /**
   * Read directory contents.
   * @param path - Path to the directory (relative to root path)
   */
  async readdir(path: string): Promise<string[]> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    return zenFs.promises.readdir(resolvedPath);
  }

  /**
   * Read directory contents with file type information.
   * @param path - Path to the directory (relative to root path)
   */
  async readdirWithTypes(path: string): Promise<DirectoryEntry[]> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    return zenFs.promises.readdir(resolvedPath, { withFileTypes: true });
  }

  /**
   * Remove a directory.
   * @param path - Path to the directory (relative to root path)
   * @param recursive - Remove contents recursively (default: false)
   */
  async rmdir(path: string, recursive: boolean = false): Promise<void> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    if (recursive) {
      await zenFs.promises.rm(resolvedPath, { recursive: true, force: true });
    } else {
      await zenFs.promises.rmdir(resolvedPath);
    }
  }

  // ============================================
  // File/Path Operations
  // ============================================

  /**
   * Check if a file or directory exists.
   * @param path - Path to check (relative to root path)
   */
  async exists(path: string): Promise<boolean> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    try {
      await zenFs.promises.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file or directory statistics.
   * @param path - Path to the file or directory (relative to root path)
   */
  async stat(path: string): Promise<FileStats> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    return zenFs.promises.stat(resolvedPath);
  }

  /**
   * Remove a file.
   * @param path - Path to the file (relative to root path)
   */
  async unlink(path: string): Promise<void> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    await zenFs.promises.unlink(resolvedPath);
  }

  /**
   * Rename/move a file or directory.
   * @param oldPath - Current path (relative to root path)
   * @param newPath - New path (relative to root path)
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    this.ensureInitialized();
    const resolvedOldPath = this.resolvePath(oldPath);
    const resolvedNewPath = this.resolvePath(newPath);
    await zenFs.promises.rename(resolvedOldPath, resolvedNewPath);
  }

  /**
   * Copy a file.
   * @param src - Source path (relative to root path)
   * @param dest - Destination path (relative to root path)
   */
  async copyFile(src: string, dest: string): Promise<void> {
    this.ensureInitialized();
    const resolvedSrc = this.resolvePath(src);
    const resolvedDest = this.resolvePath(dest);
    await zenFs.promises.copyFile(resolvedSrc, resolvedDest);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Check if path is a file.
   * @param path - Path to check (relative to root path)
   */
  async isFile(path: string): Promise<boolean> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    try {
      const stats = await zenFs.promises.stat(resolvedPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Check if path is a directory.
   * @param path - Path to check (relative to root path)
   */
  async isDirectory(path: string): Promise<boolean> {
    this.ensureInitialized();
    const resolvedPath = this.resolvePath(path);
    try {
      const stats = await zenFs.promises.stat(resolvedPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Get the raw ZenFS interface for advanced operations.
   * @returns The ZenFS fs module
   */
  getRawFs(): typeof zenFs {
    this.ensureInitialized();
    return zenFs;
  }

  /**
   * Get the store name (IndexedDB database name).
   */
  getStoreName(): string {
    return this.config.storeName;
  }
}

/**
 * Create a new StorageAdapter instance.
 * @param config - Configuration options
 */
export function createStorageAdapter(
  config?: BrowserStorageConfig,
): StorageAdapter {
  return new StorageAdapter(config);
}

/**
 * Default export for convenience.
 */
export default StorageAdapter;
