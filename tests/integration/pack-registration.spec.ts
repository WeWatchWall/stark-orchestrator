/**
 * Integration tests for Pack Registration Flow
 * @module tests/integration/pack-registration
 *
 * Tests for User Story 1: Register and Deploy a Pack
 * These tests verify the complete pack registration workflow
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { RegisterPackInput, RuntimeTag } from '@stark-o/shared';

import { PackRegistry } from '@stark-o/core/services/pack-registry';

// Helper to clear pack state between tests
import { clusterState } from '@stark-o/core/stores/cluster-store';

describe('Pack Registration Integration Tests', () => {
  let packRegistry: PackRegistry;
  const testUserId = 'test-user-1';

  beforeEach(() => {
    // Clear the pack state before each test
    clusterState.packs.clear();
    // Create a fresh instance for each test
    packRegistry = new PackRegistry();
  });

  describe('Complete Registration Flow', () => {
    it('should register a new pack and return upload URL', () => {
      const input: RegisterPackInput = {
        name: 'my-first-pack',
        version: '1.0.0',
        runtimeTag: 'node',
        description: 'My first pack',
      };

      const result = packRegistry.register(input, testUserId);

      // Verify operation succeeded
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const { pack, uploadUrl } = result.data!;

      // Verify pack was created
      expect(pack.id).toBeDefined();
      expect(pack.name).toBe('my-first-pack');
      expect(pack.version).toBe('1.0.0');
      expect(pack.runtimeTag).toBe('node');
      expect(pack.ownerId).toBe(testUserId);
      expect(pack.bundlePath).toContain('my-first-pack');

      // Verify upload URL was generated
      expect(uploadUrl).toBeDefined();
      expect(uploadUrl).toContain('upload');

      // Verify pack is retrievable
      const retrieved = packRegistry.getById(pack.id);
      expect(retrieved.success).toBe(true);
      expect(retrieved.data?.name).toBe('my-first-pack');
    });

    it('should allow registering multiple versions of the same pack', () => {
      const inputV1: RegisterPackInput = {
        name: 'versioned-pack',
        version: '1.0.0',
        runtimeTag: 'universal',
      };

      const inputV2: RegisterPackInput = {
        name: 'versioned-pack',
        version: '2.0.0',
        runtimeTag: 'universal',
      };

      const inputV3: RegisterPackInput = {
        name: 'versioned-pack',
        version: '2.1.0',
        runtimeTag: 'universal',
      };

      const resultV1 = packRegistry.register(inputV1, testUserId);
      const resultV2 = packRegistry.register(inputV2, testUserId);
      const resultV3 = packRegistry.register(inputV3, testUserId);

      expect(resultV1.success).toBe(true);
      expect(resultV2.success).toBe(true);
      expect(resultV3.success).toBe(true);

      // All versions should have unique IDs
      expect(resultV1.data!.pack.id).not.toBe(resultV2.data!.pack.id);
      expect(resultV2.data!.pack.id).not.toBe(resultV3.data!.pack.id);

      // Should be able to list all versions
      const versions = packRegistry.getVersions('versioned-pack');
      expect(versions.success).toBe(true);
      expect(versions.data).toHaveLength(3);
    });

    it('should prevent duplicate name+version registration', () => {
      const input: RegisterPackInput = {
        name: 'duplicate-test',
        version: '1.0.0',
        runtimeTag: 'node',
      };

      // First registration should succeed
      const first = packRegistry.register(input, testUserId);
      expect(first.success).toBe(true);

      // Second registration should fail
      const second = packRegistry.register(input, testUserId);
      expect(second.success).toBe(false);
      expect(second.error?.code).toBe('VERSION_EXISTS');
      expect(second.error?.message).toContain('duplicate-test@1.0.0 already exists');
    });

    it('should store metadata correctly', () => {
      const input: RegisterPackInput = {
        name: 'metadata-pack',
        version: '1.0.0',
        runtimeTag: 'browser',
        description: 'Pack with rich metadata',
        metadata: {
          entrypoint: 'main',
          timeout: 30000,
          env: {
            API_URL: 'https://api.example.com',
          },
          dependencies: ['lodash', 'axios'],
        },
      };

      const result = packRegistry.register(input, testUserId);

      expect(result.success).toBe(true);
      expect(result.data!.pack.description).toBe('Pack with rich metadata');
      expect(result.data!.pack.metadata.entrypoint).toBe('main');
      expect(result.data!.pack.metadata.timeout).toBe(30000);
      expect(result.data!.pack.metadata.env).toEqual({ API_URL: 'https://api.example.com' });
      expect(result.data!.pack.metadata.dependencies).toEqual(['lodash', 'axios']);
    });
  });

  describe('Pack Listing and Querying', () => {
    beforeEach(() => {
      // Set up test packs
      packRegistry.register(
        { name: 'node-pack-1', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'node-pack-2', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser' },
        testUserId
      );
      packRegistry.register(
        { name: 'universal-pack', version: '1.0.0', runtimeTag: 'universal' },
        testUserId
      );
    });

    it('should list all packs with pagination', () => {
      const result = packRegistry.list({ page: 1, pageSize: 10 });

      expect(result.success).toBe(true);
      expect(result.data!.packs).toHaveLength(4);
      expect(result.data!.total).toBe(4);
      expect(result.data!.page).toBe(1);
      expect(result.data!.pageSize).toBe(10);
    });

    it('should filter packs by runtime tag', () => {
      const nodeResult = packRegistry.list({ runtimeTag: 'node' });
      expect(nodeResult.success).toBe(true);
      expect(nodeResult.data!.packs).toHaveLength(2);
      nodeResult.data!.packs.forEach((p) => expect(p.runtimeTag).toBe('node'));

      const browserResult = packRegistry.list({ runtimeTag: 'browser' });
      expect(browserResult.success).toBe(true);
      expect(browserResult.data!.packs).toHaveLength(1);
      expect(browserResult.data!.packs[0].name).toBe('browser-pack');
    });

    it('should paginate results correctly', () => {
      const page1 = packRegistry.list({ page: 1, pageSize: 2 });
      const page2 = packRegistry.list({ page: 2, pageSize: 2 });

      expect(page1.success).toBe(true);
      expect(page2.success).toBe(true);
      expect(page1.data!.packs).toHaveLength(2);
      expect(page2.data!.packs).toHaveLength(2);
      expect(page1.data!.total).toBe(4);
      expect(page2.data!.total).toBe(4);

      // Should not have overlapping packs
      const page1Ids = new Set(page1.data!.packs.map((p) => p.id));
      page2.data!.packs.forEach((p) => expect(page1Ids.has(p.id)).toBe(false));
    });

    it('should retrieve pack by ID', () => {
      const registered = packRegistry.register(
        { name: 'findable-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );

      const found = packRegistry.getById(registered.data!.pack.id);

      expect(found.success).toBe(true);
      expect(found.data?.id).toBe(registered.data!.pack.id);
      expect(found.data?.name).toBe('findable-pack');
    });

    it('should return error for non-existent pack ID', () => {
      const found = packRegistry.getById('non-existent-id');
      expect(found.success).toBe(false);
      expect(found.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('Version Management', () => {
    beforeEach(() => {
      // Register multiple versions of the same pack
      packRegistry.register(
        { name: 'multi-version', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'multi-version', version: '1.1.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'multi-version', version: '2.0.0', runtimeTag: 'node' },
        testUserId
      );
      packRegistry.register(
        { name: 'multi-version', version: '2.0.1', runtimeTag: 'node' },
        testUserId
      );
    });

    it('should list all versions of a pack', () => {
      const versions = packRegistry.getVersions('multi-version');

      expect(versions.success).toBe(true);
      expect(versions.data).toHaveLength(4);
      // PackVersionSummary contains version, id, runtimeTag, createdAt
      const versionStrings = versions.data!.map((v) => v.version).sort();
      expect(versionStrings).toEqual(['1.0.0', '1.1.0', '2.0.0', '2.0.1']);
    });

    it('should return versions sorted by creation date (newest first)', () => {
      const versions = packRegistry.getVersions('multi-version');

      expect(versions.success).toBe(true);
      // Verify chronological order (newest first)
      for (let i = 1; i < versions.data!.length; i++) {
        expect(versions.data![i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
          versions.data![i].createdAt.getTime()
        );
      }
    });

    it('should retrieve specific version by name and version', () => {
      const pack = packRegistry.getByNameVersion('multi-version', '1.1.0');

      expect(pack.success).toBe(true);
      expect(pack.data?.name).toBe('multi-version');
      expect(pack.data?.version).toBe('1.1.0');
    });

    it('should return error for non-existent version', () => {
      const pack = packRegistry.getByNameVersion('multi-version', '9.9.9');
      expect(pack.success).toBe(false);
      expect(pack.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('Bundle Upload Flow', () => {
    it('should generate valid upload URL on registration', () => {
      const result = packRegistry.register(
        { name: 'upload-test', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );

      expect(result.success).toBe(true);
      expect(result.data!.uploadUrl).toBeDefined();
      // Default URL generator creates /api/packs/{id}/upload
      expect(result.data!.uploadUrl).toContain('/api/packs/');
      expect(result.data!.uploadUrl).toContain('/upload');
    });

    it('should allow custom upload URL generator', () => {
      const customRegistry = new PackRegistry({
        generateUploadUrl: (packId, packName, version) =>
          `https://storage.example.com/packs/${packName}/${version}?id=${packId}`,
      });

      const result = customRegistry.register(
        { name: 'custom-upload', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );

      expect(result.success).toBe(true);
      expect(result.data!.uploadUrl).toContain('https://storage.example.com');
      expect(result.data!.uploadUrl).toContain('custom-upload');
    });
  });

  describe('Ownership and Authorization', () => {
    it('should set correct owner on registration', () => {
      const result = packRegistry.register(
        { name: 'owned-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );

      expect(result.success).toBe(true);
      expect(result.data!.pack.ownerId).toBe(testUserId);
    });

    it('should allow different users to own packs with different names', () => {
      const user1Pack = packRegistry.register(
        { name: 'user1-pack', version: '1.0.0', runtimeTag: 'node' },
        'test-user-1'
      );

      const user2Pack = packRegistry.register(
        { name: 'user2-pack', version: '1.0.0', runtimeTag: 'node' },
        'test-user-2'
      );

      expect(user1Pack.success).toBe(true);
      expect(user2Pack.success).toBe(true);
      expect(user1Pack.data!.pack.ownerId).toBe('test-user-1');
      expect(user2Pack.data!.pack.ownerId).toBe('test-user-2');
    });
  });

  describe('Runtime Tag Validation', () => {
    it('should accept all valid runtime tags', () => {
      const runtimeTags: RuntimeTag[] = ['node', 'browser', 'universal'];

      for (const tag of runtimeTags) {
        const result = packRegistry.register(
          { name: `${tag}-runtime-pack`, version: '1.0.0', runtimeTag: tag },
          testUserId
        );
        expect(result.success).toBe(true);
        expect(result.data!.pack.runtimeTag).toBe(tag);
      }
    });
  });

  describe('Timestamps', () => {
    it('should set createdAt and updatedAt on registration', () => {
      const before = new Date();

      const result = packRegistry.register(
        { name: 'timestamp-pack', version: '1.0.0', runtimeTag: 'node' },
        testUserId
      );

      const after = new Date();

      expect(result.success).toBe(true);
      expect(result.data!.pack.createdAt).toBeDefined();
      expect(result.data!.pack.updatedAt).toBeDefined();
      expect(result.data!.pack.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.data!.pack.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(result.data!.pack.createdAt.getTime()).toBe(result.data!.pack.updatedAt.getTime());
    });
  });
});
