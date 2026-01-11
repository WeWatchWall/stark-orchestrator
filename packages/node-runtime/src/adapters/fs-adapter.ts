// Stark Orchestrator - Node.js Runtime
// File System Adapter using ZenFS with Passthrough backend

import * as nodeFs from 'node:fs';
import { Passthrough, fs as zenFs, configureSingle } from '@zenfs/core';
import type {
  ISyncStorageAdapter,
  FileStats,
  DirectoryEntry,
  StorageAdapterConfig,
} from '@stark-o/shared';

/**
 * Configuration options for the file system adapter
 */
export interface FsAdapterConfig extends StorageAdapterConfig {
  /**
   * The root directory prefix for file system operations.
   * All operations will be scoped to this directory.
   * @default process.cwd()
   */
  rootPath?: string;

  /**
   * Whether to use synchronous operations where possible.
   * @default false
   */
  preferSync?: boolean;
}

/**
 * Internal resolved configuration type.
 */
interface ResolvedFsAdapterConfig {
  rootPath: string;
  storeName: string;
  preferSync: boolean;
}

/**
 * File system adapter wrapping ZenFS with Passthrough backend.
 * Provides a unified file system interface for pack execution.
 * Implements ISyncStorageAdapter interface for both async and sync operations.
 */
export class FsAdapter implements ISyncStorageAdapter {
  private readonly config: ResolvedFsAdapterConfig;
  private initialized: boolean = false;

  constructor(config: FsAdapterConfig = {}) {
    this.config = {
      rootPath: config.rootPath ?? process.cwd(),
      storeName: config.storeName ?? 'node-fs',
      preferSync: config.preferSync ?? false,
    };
  }

  /**
   * Initialize the file system adapter.
   * Must be called before using any file system operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await configureSingle({
      backend: Passthrough,
      fs: nodeFs,
      prefix: this.config.rootPath,
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
      throw new Error('FsAdapter not initialized. Call initialize() first.');
    }
  }

  // ============================================
  // File Reading Operations
  // ============================================

  /**
   * Read file contents as a string.
   * @param path - Path to the file (relative to root path)
   * @param encoding - Character encoding (default: 'utf-8')
   */
  async readFile(path: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    this.ensureInitialized();
    return zenFs.promises.readFile(path, encoding);
  }

  /**
   * Read file contents as a Uint8Array (IStorageAdapter interface).
   * @param path - Path to the file (relative to root path)
   */
  async readFileBytes(path: string): Promise<Uint8Array> {
    this.ensureInitialized();
    return new Uint8Array(await zenFs.promises.readFile(path));
  }

  /**
   * Read file contents as a Buffer.
   * @param path - Path to the file (relative to root path)
   */
  async readFileBuffer(path: string): Promise<Buffer> {
    this.ensureInitialized();
    return Buffer.from(await zenFs.promises.readFile(path));
  }

  /**
   * Read file contents synchronously.
   * @param path - Path to the file (relative to root path)
   * @param encoding - Character encoding (default: 'utf-8')
   */
  readFileSync(path: string, encoding: BufferEncoding = 'utf-8'): string {
    this.ensureInitialized();
    return zenFs.readFileSync(path, encoding);
  }

  /**
   * Read file contents as Uint8Array synchronously (ISyncStorageAdapter interface).
   * @param path - Path to the file (relative to root path)
   */
  readFileBytesSync(path: string): Uint8Array {
    this.ensureInitialized();
    return new Uint8Array(zenFs.readFileSync(path));
  }

  /**
   * Read file contents as Buffer synchronously.
   * @param path - Path to the file (relative to root path)
   */
  readFileBufferSync(path: string): Buffer {
    this.ensureInitialized();
    return Buffer.from(zenFs.readFileSync(path));
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
    content: string | Buffer,
    encoding: BufferEncoding = 'utf-8',
  ): Promise<void> {
    this.ensureInitialized();
    await zenFs.promises.writeFile(path, content, { encoding });
  }

  /**
   * Write content to a file synchronously.
   * @param path - Path to the file (relative to root path)
   * @param content - Content to write
   * @param encoding - Character encoding (default: 'utf-8')
   */
  writeFileSync(
    path: string,
    content: string | Buffer,
    encoding: BufferEncoding = 'utf-8',
  ): void {
    this.ensureInitialized();
    zenFs.writeFileSync(path, content, { encoding });
  }

  /**
   * Append content to a file.
   * @param path - Path to the file (relative to root path)
   * @param content - Content to append
   * @param encoding - Character encoding (default: 'utf-8')
   */
  async appendFile(
    path: string,
    content: string | Buffer,
    encoding: BufferEncoding = 'utf-8',
  ): Promise<void> {
    this.ensureInitialized();
    await zenFs.promises.appendFile(path, content, { encoding });
  }

  /**
   * Append content to a file synchronously.
   * @param path - Path to the file (relative to root path)
   * @param content - Content to append
   * @param encoding - Character encoding (default: 'utf-8')
   */
  appendFileSync(
    path: string,
    content: string | Buffer,
    encoding: BufferEncoding = 'utf-8',
  ): void {
    this.ensureInitialized();
    zenFs.appendFileSync(path, content, { encoding });
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
    await zenFs.promises.mkdir(path, { recursive });
  }

  /**
   * Create a directory synchronously.
   * @param path - Path to the directory (relative to root path)
   * @param recursive - Create parent directories if they don't exist (default: true)
   */
  mkdirSync(path: string, recursive: boolean = true): void {
    this.ensureInitialized();
    zenFs.mkdirSync(path, { recursive });
  }

  /**
   * Read directory contents.
   * @param path - Path to the directory (relative to root path)
   */
  async readdir(path: string): Promise<string[]> {
    this.ensureInitialized();
    return zenFs.promises.readdir(path);
  }

  /**
   * Read directory contents synchronously.
   * @param path - Path to the directory (relative to root path)
   */
  readdirSync(path: string): string[] {
    this.ensureInitialized();
    return zenFs.readdirSync(path);
  }

  /**
   * Read directory contents with file type information.
   * @param path - Path to the directory (relative to root path)
   */
  async readdirWithTypes(path: string): Promise<DirectoryEntry[]> {
    this.ensureInitialized();
    return zenFs.promises.readdir(path, { withFileTypes: true });
  }

  /**
   * Remove a directory.
   * @param path - Path to the directory (relative to root path)
   * @param recursive - Remove contents recursively (default: false)
   */
  async rmdir(path: string, recursive: boolean = false): Promise<void> {
    this.ensureInitialized();
    if (recursive) {
      await zenFs.promises.rm(path, { recursive: true, force: true });
    } else {
      await zenFs.promises.rmdir(path);
    }
  }

  /**
   * Remove a directory synchronously.
   * @param path - Path to the directory (relative to root path)
   * @param recursive - Remove contents recursively (default: false)
   */
  rmdirSync(path: string, recursive: boolean = false): void {
    this.ensureInitialized();
    if (recursive) {
      zenFs.rmSync(path, { recursive: true, force: true });
    } else {
      zenFs.rmdirSync(path);
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
    try {
      await zenFs.promises.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a file or directory exists synchronously.
   * @param path - Path to check (relative to root path)
   */
  existsSync(path: string): boolean {
    this.ensureInitialized();
    return zenFs.existsSync(path);
  }

  /**
   * Get file or directory statistics.
   * @param path - Path to the file or directory (relative to root path)
   */
  async stat(path: string): Promise<FileStats> {
    this.ensureInitialized();
    return zenFs.promises.stat(path);
  }

  /**
   * Get file or directory statistics synchronously.
   * @param path - Path to the file or directory (relative to root path)
   */
  statSync(path: string): FileStats {
    this.ensureInitialized();
    return zenFs.statSync(path);
  }

  /**
   * Remove a file.
   * @param path - Path to the file (relative to root path)
   */
  async unlink(path: string): Promise<void> {
    this.ensureInitialized();
    await zenFs.promises.unlink(path);
  }

  /**
   * Remove a file synchronously.
   * @param path - Path to the file (relative to root path)
   */
  unlinkSync(path: string): void {
    this.ensureInitialized();
    zenFs.unlinkSync(path);
  }

  /**
   * Rename/move a file or directory.
   * @param oldPath - Current path (relative to root path)
   * @param newPath - New path (relative to root path)
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    this.ensureInitialized();
    await zenFs.promises.rename(oldPath, newPath);
  }

  /**
   * Rename/move a file or directory synchronously.
   * @param oldPath - Current path (relative to root path)
   * @param newPath - New path (relative to root path)
   */
  renameSync(oldPath: string, newPath: string): void {
    this.ensureInitialized();
    zenFs.renameSync(oldPath, newPath);
  }

  /**
   * Copy a file.
   * @param src - Source path (relative to root path)
   * @param dest - Destination path (relative to root path)
   */
  async copyFile(src: string, dest: string): Promise<void> {
    this.ensureInitialized();
    await zenFs.promises.copyFile(src, dest);
  }

  /**
   * Copy a file synchronously.
   * @param src - Source path (relative to root path)
   * @param dest - Destination path (relative to root path)
   */
  copyFileSync(src: string, dest: string): void {
    this.ensureInitialized();
    zenFs.copyFileSync(src, dest);
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
    try {
      const stats = await zenFs.promises.stat(path);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Check if path is a file synchronously.
   * @param path - Path to check (relative to root path)
   */
  isFileSync(path: string): boolean {
    this.ensureInitialized();
    try {
      const stats = zenFs.statSync(path);
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
    try {
      const stats = await zenFs.promises.stat(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Check if path is a directory synchronously.
   * @param path - Path to check (relative to root path)
   */
  isDirectorySync(path: string): boolean {
    this.ensureInitialized();
    try {
      const stats = zenFs.statSync(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Get the configured root path.
   */
  getRootPath(): string {
    return this.config.rootPath;
  }

  /**
   * Get the raw ZenFS interface for advanced operations.
   * @returns The ZenFS fs module
   */
  getRawFs(): typeof zenFs {
    this.ensureInitialized();
    return zenFs;
  }
}

/**
 * Create a new FsAdapter instance.
 * @param config - Configuration options
 */
export function createFsAdapter(config?: FsAdapterConfig): FsAdapter {
  return new FsAdapter(config);
}

/**
 * Default export for convenience.
 */
export default FsAdapter;
