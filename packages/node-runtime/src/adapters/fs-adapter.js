// Stark Orchestrator - Node.js Runtime
// File System Adapter using ZenFS with Passthrough backend
import * as nodeFs from 'node:fs';
import { Passthrough, fs as zenFs, configureSingle } from '@zenfs/core';
/**
 * File system adapter wrapping ZenFS with Passthrough backend.
 * Provides a unified file system interface for pack execution.
 * Implements ISyncStorageAdapter interface for both async and sync operations.
 */
export class FsAdapter {
    config;
    initialized = false;
    constructor(config = {}) {
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
    async initialize() {
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
    isInitialized() {
        return this.initialized;
    }
    /**
     * Ensure the adapter is initialized before operations.
     */
    ensureInitialized() {
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
    async readFile(path, encoding = 'utf-8') {
        this.ensureInitialized();
        return zenFs.promises.readFile(path, encoding);
    }
    /**
     * Read file contents as a Uint8Array (IStorageAdapter interface).
     * @param path - Path to the file (relative to root path)
     */
    async readFileBytes(path) {
        this.ensureInitialized();
        return new Uint8Array(await zenFs.promises.readFile(path));
    }
    /**
     * Read file contents as a Buffer.
     * @param path - Path to the file (relative to root path)
     */
    async readFileBuffer(path) {
        this.ensureInitialized();
        return Buffer.from(await zenFs.promises.readFile(path));
    }
    /**
     * Read file contents synchronously.
     * @param path - Path to the file (relative to root path)
     * @param encoding - Character encoding (default: 'utf-8')
     */
    readFileSync(path, encoding = 'utf-8') {
        this.ensureInitialized();
        return zenFs.readFileSync(path, encoding);
    }
    /**
     * Read file contents as Uint8Array synchronously (ISyncStorageAdapter interface).
     * @param path - Path to the file (relative to root path)
     */
    readFileBytesSync(path) {
        this.ensureInitialized();
        return new Uint8Array(zenFs.readFileSync(path));
    }
    /**
     * Read file contents as Buffer synchronously.
     * @param path - Path to the file (relative to root path)
     */
    readFileBufferSync(path) {
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
    async writeFile(path, content, encoding = 'utf-8') {
        this.ensureInitialized();
        await zenFs.promises.writeFile(path, content, { encoding });
    }
    /**
     * Write content to a file synchronously.
     * @param path - Path to the file (relative to root path)
     * @param content - Content to write
     * @param encoding - Character encoding (default: 'utf-8')
     */
    writeFileSync(path, content, encoding = 'utf-8') {
        this.ensureInitialized();
        zenFs.writeFileSync(path, content, { encoding });
    }
    /**
     * Append content to a file.
     * @param path - Path to the file (relative to root path)
     * @param content - Content to append
     * @param encoding - Character encoding (default: 'utf-8')
     */
    async appendFile(path, content, encoding = 'utf-8') {
        this.ensureInitialized();
        await zenFs.promises.appendFile(path, content, { encoding });
    }
    /**
     * Append content to a file synchronously.
     * @param path - Path to the file (relative to root path)
     * @param content - Content to append
     * @param encoding - Character encoding (default: 'utf-8')
     */
    appendFileSync(path, content, encoding = 'utf-8') {
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
    async mkdir(path, recursive = true) {
        this.ensureInitialized();
        await zenFs.promises.mkdir(path, { recursive });
    }
    /**
     * Create a directory synchronously.
     * @param path - Path to the directory (relative to root path)
     * @param recursive - Create parent directories if they don't exist (default: true)
     */
    mkdirSync(path, recursive = true) {
        this.ensureInitialized();
        zenFs.mkdirSync(path, { recursive });
    }
    /**
     * Read directory contents.
     * @param path - Path to the directory (relative to root path)
     */
    async readdir(path) {
        this.ensureInitialized();
        return zenFs.promises.readdir(path);
    }
    /**
     * Read directory contents synchronously.
     * @param path - Path to the directory (relative to root path)
     */
    readdirSync(path) {
        this.ensureInitialized();
        return zenFs.readdirSync(path);
    }
    /**
     * Read directory contents with file type information.
     * @param path - Path to the directory (relative to root path)
     */
    async readdirWithTypes(path) {
        this.ensureInitialized();
        return zenFs.promises.readdir(path, { withFileTypes: true });
    }
    /**
     * Remove a directory.
     * @param path - Path to the directory (relative to root path)
     * @param recursive - Remove contents recursively (default: false)
     */
    async rmdir(path, recursive = false) {
        this.ensureInitialized();
        if (recursive) {
            await zenFs.promises.rm(path, { recursive: true, force: true });
        }
        else {
            await zenFs.promises.rmdir(path);
        }
    }
    /**
     * Remove a directory synchronously.
     * @param path - Path to the directory (relative to root path)
     * @param recursive - Remove contents recursively (default: false)
     */
    rmdirSync(path, recursive = false) {
        this.ensureInitialized();
        if (recursive) {
            zenFs.rmSync(path, { recursive: true, force: true });
        }
        else {
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
    async exists(path) {
        this.ensureInitialized();
        try {
            await zenFs.promises.access(path);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Check if a file or directory exists synchronously.
     * @param path - Path to check (relative to root path)
     */
    existsSync(path) {
        this.ensureInitialized();
        return zenFs.existsSync(path);
    }
    /**
     * Get file or directory statistics.
     * @param path - Path to the file or directory (relative to root path)
     */
    async stat(path) {
        this.ensureInitialized();
        return zenFs.promises.stat(path);
    }
    /**
     * Get file or directory statistics synchronously.
     * @param path - Path to the file or directory (relative to root path)
     */
    statSync(path) {
        this.ensureInitialized();
        return zenFs.statSync(path);
    }
    /**
     * Remove a file.
     * @param path - Path to the file (relative to root path)
     */
    async unlink(path) {
        this.ensureInitialized();
        await zenFs.promises.unlink(path);
    }
    /**
     * Remove a file synchronously.
     * @param path - Path to the file (relative to root path)
     */
    unlinkSync(path) {
        this.ensureInitialized();
        zenFs.unlinkSync(path);
    }
    /**
     * Rename/move a file or directory.
     * @param oldPath - Current path (relative to root path)
     * @param newPath - New path (relative to root path)
     */
    async rename(oldPath, newPath) {
        this.ensureInitialized();
        await zenFs.promises.rename(oldPath, newPath);
    }
    /**
     * Rename/move a file or directory synchronously.
     * @param oldPath - Current path (relative to root path)
     * @param newPath - New path (relative to root path)
     */
    renameSync(oldPath, newPath) {
        this.ensureInitialized();
        zenFs.renameSync(oldPath, newPath);
    }
    /**
     * Copy a file.
     * @param src - Source path (relative to root path)
     * @param dest - Destination path (relative to root path)
     */
    async copyFile(src, dest) {
        this.ensureInitialized();
        await zenFs.promises.copyFile(src, dest);
    }
    /**
     * Copy a file synchronously.
     * @param src - Source path (relative to root path)
     * @param dest - Destination path (relative to root path)
     */
    copyFileSync(src, dest) {
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
    async isFile(path) {
        this.ensureInitialized();
        try {
            const stats = await zenFs.promises.stat(path);
            return stats.isFile();
        }
        catch {
            return false;
        }
    }
    /**
     * Check if path is a file synchronously.
     * @param path - Path to check (relative to root path)
     */
    isFileSync(path) {
        this.ensureInitialized();
        try {
            const stats = zenFs.statSync(path);
            return stats.isFile();
        }
        catch {
            return false;
        }
    }
    /**
     * Check if path is a directory.
     * @param path - Path to check (relative to root path)
     */
    async isDirectory(path) {
        this.ensureInitialized();
        try {
            const stats = await zenFs.promises.stat(path);
            return stats.isDirectory();
        }
        catch {
            return false;
        }
    }
    /**
     * Check if path is a directory synchronously.
     * @param path - Path to check (relative to root path)
     */
    isDirectorySync(path) {
        this.ensureInitialized();
        try {
            const stats = zenFs.statSync(path);
            return stats.isDirectory();
        }
        catch {
            return false;
        }
    }
    /**
     * Get the configured root path.
     */
    getRootPath() {
        return this.config.rootPath;
    }
    /**
     * Get the raw ZenFS interface for advanced operations.
     * @returns The ZenFS fs module
     */
    getRawFs() {
        this.ensureInitialized();
        return zenFs;
    }
}
/**
 * Create a new FsAdapter instance.
 * @param config - Configuration options
 */
export function createFsAdapter(config) {
    return new FsAdapter(config);
}
/**
 * Default export for convenience.
 */
export default FsAdapter;
//# sourceMappingURL=fs-adapter.js.map