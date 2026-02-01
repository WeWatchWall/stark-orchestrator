import { fs as zenFs } from '@zenfs/core';
import type { ISyncStorageAdapter, FileStats, DirectoryEntry, StorageAdapterConfig } from '@stark-o/shared';
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
 * File system adapter wrapping ZenFS with Passthrough backend.
 * Provides a unified file system interface for pack execution.
 * Implements ISyncStorageAdapter interface for both async and sync operations.
 */
export declare class FsAdapter implements ISyncStorageAdapter {
    private readonly config;
    private initialized;
    constructor(config?: FsAdapterConfig);
    /**
     * Initialize the file system adapter.
     * Must be called before using any file system operations.
     */
    initialize(): Promise<void>;
    /**
     * Check if the adapter has been initialized.
     */
    isInitialized(): boolean;
    /**
     * Ensure the adapter is initialized before operations.
     */
    private ensureInitialized;
    /**
     * Read file contents as a string.
     * @param path - Path to the file (relative to root path)
     * @param encoding - Character encoding (default: 'utf-8')
     */
    readFile(path: string, encoding?: BufferEncoding): Promise<string>;
    /**
     * Read file contents as a Uint8Array (IStorageAdapter interface).
     * @param path - Path to the file (relative to root path)
     */
    readFileBytes(path: string): Promise<Uint8Array>;
    /**
     * Read file contents as a Buffer.
     * @param path - Path to the file (relative to root path)
     */
    readFileBuffer(path: string): Promise<Buffer>;
    /**
     * Read file contents synchronously.
     * @param path - Path to the file (relative to root path)
     * @param encoding - Character encoding (default: 'utf-8')
     */
    readFileSync(path: string, encoding?: BufferEncoding): string;
    /**
     * Read file contents as Uint8Array synchronously (ISyncStorageAdapter interface).
     * @param path - Path to the file (relative to root path)
     */
    readFileBytesSync(path: string): Uint8Array;
    /**
     * Read file contents as Buffer synchronously.
     * @param path - Path to the file (relative to root path)
     */
    readFileBufferSync(path: string): Buffer;
    /**
     * Write string content to a file.
     * @param path - Path to the file (relative to root path)
     * @param content - Content to write
     * @param encoding - Character encoding (default: 'utf-8')
     */
    writeFile(path: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void>;
    /**
     * Write content to a file synchronously.
     * @param path - Path to the file (relative to root path)
     * @param content - Content to write
     * @param encoding - Character encoding (default: 'utf-8')
     */
    writeFileSync(path: string, content: string | Buffer, encoding?: BufferEncoding): void;
    /**
     * Append content to a file.
     * @param path - Path to the file (relative to root path)
     * @param content - Content to append
     * @param encoding - Character encoding (default: 'utf-8')
     */
    appendFile(path: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void>;
    /**
     * Append content to a file synchronously.
     * @param path - Path to the file (relative to root path)
     * @param content - Content to append
     * @param encoding - Character encoding (default: 'utf-8')
     */
    appendFileSync(path: string, content: string | Buffer, encoding?: BufferEncoding): void;
    /**
     * Create a directory.
     * @param path - Path to the directory (relative to root path)
     * @param recursive - Create parent directories if they don't exist (default: true)
     */
    mkdir(path: string, recursive?: boolean): Promise<void>;
    /**
     * Create a directory synchronously.
     * @param path - Path to the directory (relative to root path)
     * @param recursive - Create parent directories if they don't exist (default: true)
     */
    mkdirSync(path: string, recursive?: boolean): void;
    /**
     * Read directory contents.
     * @param path - Path to the directory (relative to root path)
     */
    readdir(path: string): Promise<string[]>;
    /**
     * Read directory contents synchronously.
     * @param path - Path to the directory (relative to root path)
     */
    readdirSync(path: string): string[];
    /**
     * Read directory contents with file type information.
     * @param path - Path to the directory (relative to root path)
     */
    readdirWithTypes(path: string): Promise<DirectoryEntry[]>;
    /**
     * Remove a directory.
     * @param path - Path to the directory (relative to root path)
     * @param recursive - Remove contents recursively (default: false)
     */
    rmdir(path: string, recursive?: boolean): Promise<void>;
    /**
     * Remove a directory synchronously.
     * @param path - Path to the directory (relative to root path)
     * @param recursive - Remove contents recursively (default: false)
     */
    rmdirSync(path: string, recursive?: boolean): void;
    /**
     * Check if a file or directory exists.
     * @param path - Path to check (relative to root path)
     */
    exists(path: string): Promise<boolean>;
    /**
     * Check if a file or directory exists synchronously.
     * @param path - Path to check (relative to root path)
     */
    existsSync(path: string): boolean;
    /**
     * Get file or directory statistics.
     * @param path - Path to the file or directory (relative to root path)
     */
    stat(path: string): Promise<FileStats>;
    /**
     * Get file or directory statistics synchronously.
     * @param path - Path to the file or directory (relative to root path)
     */
    statSync(path: string): FileStats;
    /**
     * Remove a file.
     * @param path - Path to the file (relative to root path)
     */
    unlink(path: string): Promise<void>;
    /**
     * Remove a file synchronously.
     * @param path - Path to the file (relative to root path)
     */
    unlinkSync(path: string): void;
    /**
     * Rename/move a file or directory.
     * @param oldPath - Current path (relative to root path)
     * @param newPath - New path (relative to root path)
     */
    rename(oldPath: string, newPath: string): Promise<void>;
    /**
     * Rename/move a file or directory synchronously.
     * @param oldPath - Current path (relative to root path)
     * @param newPath - New path (relative to root path)
     */
    renameSync(oldPath: string, newPath: string): void;
    /**
     * Copy a file.
     * @param src - Source path (relative to root path)
     * @param dest - Destination path (relative to root path)
     */
    copyFile(src: string, dest: string): Promise<void>;
    /**
     * Copy a file synchronously.
     * @param src - Source path (relative to root path)
     * @param dest - Destination path (relative to root path)
     */
    copyFileSync(src: string, dest: string): void;
    /**
     * Check if path is a file.
     * @param path - Path to check (relative to root path)
     */
    isFile(path: string): Promise<boolean>;
    /**
     * Check if path is a file synchronously.
     * @param path - Path to check (relative to root path)
     */
    isFileSync(path: string): boolean;
    /**
     * Check if path is a directory.
     * @param path - Path to check (relative to root path)
     */
    isDirectory(path: string): Promise<boolean>;
    /**
     * Check if path is a directory synchronously.
     * @param path - Path to check (relative to root path)
     */
    isDirectorySync(path: string): boolean;
    /**
     * Get the configured root path.
     */
    getRootPath(): string;
    /**
     * Get the raw ZenFS interface for advanced operations.
     * @returns The ZenFS fs module
     */
    getRawFs(): typeof zenFs;
}
/**
 * Create a new FsAdapter instance.
 * @param config - Configuration options
 */
export declare function createFsAdapter(config?: FsAdapterConfig): FsAdapter;
/**
 * Default export for convenience.
 */
export default FsAdapter;
//# sourceMappingURL=fs-adapter.d.ts.map