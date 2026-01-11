/**
 * Shared Storage Adapter Interface for Stark Orchestrator
 *
 * This interface defines a unified file system abstraction that can be
 * implemented by different runtimes (Node.js, Browser) using ZenFS backends.
 *
 * @module @stark-o/shared/types/storage-adapter
 */

/**
 * File statistics information.
 * Compatible with Node.js fs.Stats interface.
 */
export interface FileStats {
  /** Size of the file in bytes */
  size: number;
  /** True if the path is a file */
  isFile: () => boolean;
  /** True if the path is a directory */
  isDirectory: () => boolean;
  /** True if the path is a symbolic link */
  isSymbolicLink: () => boolean;
  /** Last access time */
  atime: Date;
  /** Last modification time */
  mtime: Date;
  /** Creation time */
  birthtime: Date;
  /** File mode (permissions) */
  mode: number;
}

/**
 * Directory entry with type information.
 */
export interface DirectoryEntry {
  /** Name of the file or directory */
  name: string;
  /** True if the entry is a file */
  isFile: () => boolean;
  /** True if the entry is a directory */
  isDirectory: () => boolean;
  /** True if the entry is a symbolic link */
  isSymbolicLink: () => boolean;
}

/**
 * Configuration options for storage adapters.
 */
export interface StorageAdapterConfig {
  /**
   * The root path prefix for all file system operations.
   * All operations will be scoped to this directory.
   */
  rootPath?: string;

  /**
   * Unique identifier for the storage instance.
   * Used for IndexedDB database naming in browser.
   */
  storeName?: string;
}

/**
 * Unified storage adapter interface.
 *
 * This interface provides a consistent API for file system operations
 * across different runtime environments (Node.js and Browser).
 * Implementations should use ZenFS with appropriate backends.
 *
 * Note: Sync methods may not be available in all implementations
 * (e.g., browser with IndexedDB). Use async methods for maximum compatibility.
 */
export interface IStorageAdapter {
  // ============================================
  // Lifecycle Methods
  // ============================================

  /**
   * Initialize the storage adapter.
   * Must be called before using any file system operations.
   */
  initialize(): Promise<void>;

  /**
   * Check if the adapter has been initialized.
   */
  isInitialized(): boolean;

  /**
   * Get the configured root path.
   */
  getRootPath(): string;

  // ============================================
  // File Reading Operations
  // ============================================

  /**
   * Read file contents as a string.
   * @param path - Path to the file (relative to root path)
   * @param encoding - Character encoding (default: 'utf-8')
   */
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;

  /**
   * Read file contents as a Uint8Array.
   * @param path - Path to the file (relative to root path)
   */
  readFileBytes(path: string): Promise<Uint8Array>;

  // ============================================
  // File Writing Operations
  // ============================================

  /**
   * Write string content to a file.
   * @param path - Path to the file (relative to root path)
   * @param content - Content to write
   * @param encoding - Character encoding (default: 'utf-8')
   */
  writeFile(
    path: string,
    content: string | Uint8Array,
    encoding?: BufferEncoding,
  ): Promise<void>;

  /**
   * Append content to a file.
   * @param path - Path to the file (relative to root path)
   * @param content - Content to append
   * @param encoding - Character encoding (default: 'utf-8')
   */
  appendFile(
    path: string,
    content: string | Uint8Array,
    encoding?: BufferEncoding,
  ): Promise<void>;

  // ============================================
  // Directory Operations
  // ============================================

  /**
   * Create a directory.
   * @param path - Path to the directory (relative to root path)
   * @param recursive - Create parent directories if they don't exist (default: true)
   */
  mkdir(path: string, recursive?: boolean): Promise<void>;

  /**
   * Read directory contents.
   * @param path - Path to the directory (relative to root path)
   * @returns Array of file/directory names
   */
  readdir(path: string): Promise<string[]>;

  /**
   * Read directory contents with file type information.
   * @param path - Path to the directory (relative to root path)
   * @returns Array of directory entries with type info
   */
  readdirWithTypes(path: string): Promise<DirectoryEntry[]>;

  /**
   * Remove a directory.
   * @param path - Path to the directory (relative to root path)
   * @param recursive - Remove contents recursively (default: false)
   */
  rmdir(path: string, recursive?: boolean): Promise<void>;

  // ============================================
  // File/Path Operations
  // ============================================

  /**
   * Check if a file or directory exists.
   * @param path - Path to check (relative to root path)
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get file or directory statistics.
   * @param path - Path to the file or directory (relative to root path)
   */
  stat(path: string): Promise<FileStats>;

  /**
   * Remove a file.
   * @param path - Path to the file (relative to root path)
   */
  unlink(path: string): Promise<void>;

  /**
   * Rename/move a file or directory.
   * @param oldPath - Current path (relative to root path)
   * @param newPath - New path (relative to root path)
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /**
   * Copy a file.
   * @param src - Source path (relative to root path)
   * @param dest - Destination path (relative to root path)
   */
  copyFile(src: string, dest: string): Promise<void>;

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Check if path is a file.
   * @param path - Path to check (relative to root path)
   */
  isFile(path: string): Promise<boolean>;

  /**
   * Check if path is a directory.
   * @param path - Path to check (relative to root path)
   */
  isDirectory(path: string): Promise<boolean>;
}

/**
 * Extended storage adapter interface with synchronous operations.
 *
 * These methods are only available in environments that support
 * synchronous file system access (e.g., Node.js).
 * Browser implementations using IndexedDB cannot implement these.
 */
export interface ISyncStorageAdapter extends IStorageAdapter {
  // ============================================
  // Synchronous File Reading
  // ============================================

  /** Read file contents as a string synchronously. */
  readFileSync(path: string, encoding?: BufferEncoding): string;

  /** Read file contents as Uint8Array synchronously. */
  readFileBytesSync(path: string): Uint8Array;

  // ============================================
  // Synchronous File Writing
  // ============================================

  /** Write content to a file synchronously. */
  writeFileSync(
    path: string,
    content: string | Uint8Array,
    encoding?: BufferEncoding,
  ): void;

  /** Append content to a file synchronously. */
  appendFileSync(
    path: string,
    content: string | Uint8Array,
    encoding?: BufferEncoding,
  ): void;

  // ============================================
  // Synchronous Directory Operations
  // ============================================

  /** Create a directory synchronously. */
  mkdirSync(path: string, recursive?: boolean): void;

  /** Read directory contents synchronously. */
  readdirSync(path: string): string[];

  /** Remove a directory synchronously. */
  rmdirSync(path: string, recursive?: boolean): void;

  // ============================================
  // Synchronous File/Path Operations
  // ============================================

  /** Check if a file or directory exists synchronously. */
  existsSync(path: string): boolean;

  /** Get file or directory statistics synchronously. */
  statSync(path: string): FileStats;

  /** Remove a file synchronously. */
  unlinkSync(path: string): void;

  /** Rename/move a file or directory synchronously. */
  renameSync(oldPath: string, newPath: string): void;

  /** Copy a file synchronously. */
  copyFileSync(src: string, dest: string): void;

  // ============================================
  // Synchronous Utility Methods
  // ============================================

  /** Check if path is a file synchronously. */
  isFileSync(path: string): boolean;

  /** Check if path is a directory synchronously. */
  isDirectorySync(path: string): boolean;
}
