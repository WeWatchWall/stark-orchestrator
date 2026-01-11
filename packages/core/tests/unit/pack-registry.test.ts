/**
 * Unit tests for PackRegistry service
 * @module @stark-o/core/tests/unit/pack-registry
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  PackRegistry,
  createPackRegistry,
  resetCluster,
  registerPack,
  findPackById,
} from '../../src';

describe('PackRegistry', () => {
  let registry: PackRegistry;

  beforeEach(() => {
    resetCluster();
    registry = createPackRegistry();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const reg = new PackRegistry();
      expect(reg).toBeInstanceOf(PackRegistry);
    });

    it('should accept custom upload URL generator', () => {
      const customGenerator = (id: string, name: string, version: string) =>
        `https://custom.cdn/${name}/${version}/${id}`;

      const reg = createPackRegistry({ generateUploadUrl: customGenerator });
      const result = reg.register(
        { name: 'test-pack', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.uploadUrl).toContain('https://custom.cdn/test-pack/1.0.0/');
    });
  });

  describe('computed properties', () => {
    beforeEach(() => {
      // Register some test packs
      registerPack({
        name: 'pack-a',
        version: '1.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: 'packs/pack-a/1.0.0/bundle.js',
      });
      registerPack({
        name: 'pack-a',
        version: '2.0.0',
        runtimeTag: 'node',
        ownerId: 'user1',
        bundlePath: 'packs/pack-a/2.0.0/bundle.js',
      });
      registerPack({
        name: 'pack-b',
        version: '1.0.0',
        runtimeTag: 'browser',
        ownerId: 'user2',
        bundlePath: 'packs/pack-b/1.0.0/bundle.js',
      });
    });

    it('should return total packs count', () => {
      expect(registry.totalPacks.value).toBe(3);
    });

    it('should return unique packs count', () => {
      expect(registry.uniquePacks.value).toBe(2);
    });

    it('should group packs by name', () => {
      const byName = registry.byName.value;
      expect(byName.get('pack-a')?.length).toBe(2);
      expect(byName.get('pack-b')?.length).toBe(1);
    });

    it('should group packs by runtime', () => {
      const byRuntime = registry.byRuntime.value;
      expect(byRuntime.get('node')?.length).toBe(2);
      expect(byRuntime.get('browser')?.length).toBe(1);
    });

    it('should group packs by owner', () => {
      const byOwner = registry.byOwner.value;
      expect(byOwner.get('user1')?.length).toBe(2);
      expect(byOwner.get('user2')?.length).toBe(1);
    });
  });

  describe('register', () => {
    it('should register a new pack successfully', () => {
      const result = registry.register(
        {
          name: 'my-pack',
          version: '1.0.0',
          runtimeTag: 'node',
        },
        'owner1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pack).toBeDefined();
      expect(result.data?.pack.name).toBe('my-pack');
      expect(result.data?.pack.version).toBe('1.0.0');
      expect(result.data?.pack.runtimeTag).toBe('node');
      expect(result.data?.pack.ownerId).toBe('owner1');
      expect(result.data?.uploadUrl).toBeDefined();
    });

    it('should generate upload URL for registered pack', () => {
      const result = registry.register(
        { name: 'test-pack', version: '1.0.0', runtimeTag: 'browser' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.uploadUrl).toContain('/api/packs/');
      expect(result.data?.uploadUrl).toContain('/upload');
    });

    it('should generate bundle path', () => {
      const result = registry.register(
        { name: 'bundle-test', version: '2.0.0', runtimeTag: 'universal' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pack.bundlePath).toBe('packs/bundle-test/2.0.0/bundle.js');
    });

    it('should fail with invalid pack name', () => {
      const result = registry.register(
        { name: '', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should fail with invalid version format', () => {
      const result = registry.register(
        { name: 'test', version: 'invalid', runtimeTag: 'node' },
        'user1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('should fail when version already exists', () => {
      registry.register(
        { name: 'duplicate', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );

      const result = registry.register(
        { name: 'duplicate', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VERSION_EXISTS');
    });

    it('should allow same name with different versions', () => {
      registry.register(
        { name: 'multi-version', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );

      const result = registry.register(
        { name: 'multi-version', version: '2.0.0', runtimeTag: 'node' },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pack.version).toBe('2.0.0');
    });

    it('should support optional metadata', () => {
      const result = registry.register(
        {
          name: 'with-meta',
          version: '1.0.0',
          runtimeTag: 'node',
          metadata: {
            description: 'A test pack',
            author: 'Test Author',
            repository: 'https://github.com/test/pack',
          },
        },
        'user1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.pack.metadata?.description).toBe('A test pack');
      expect(result.data?.pack.metadata?.author).toBe('Test Author');
    });
  });

  describe('update', () => {
    let packId: string;

    beforeEach(() => {
      const result = registry.register(
        {
          name: 'updatable',
          version: '1.0.0',
          runtimeTag: 'node',
          metadata: { description: 'Original' },
        },
        'owner1'
      );
      packId = result.data!.pack.id;
    });

    it('should update pack metadata successfully', () => {
      const result = registry.update(
        packId,
        { metadata: { description: 'Updated description' } },
        'owner1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.metadata?.description).toBe('Updated description');
    });

    it('should fail when pack not found', () => {
      const result = registry.update(
        'nonexistent-id',
        { metadata: { description: 'Test' } },
        'owner1'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('should fail when requester is not owner', () => {
      const result = registry.update(
        packId,
        { metadata: { description: 'Hacked' } },
        'other-user'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FORBIDDEN');
    });
  });

  describe('delete', () => {
    let packId: string;

    beforeEach(() => {
      const result = registry.register(
        { name: 'deletable', version: '1.0.0', runtimeTag: 'node' },
        'owner1'
      );
      packId = result.data!.pack.id;
    });

    it('should delete pack successfully', () => {
      const result = registry.delete(packId, 'owner1');

      expect(result.success).toBe(true);
      expect(findPackById(packId)).toBeUndefined();
    });

    it('should fail when pack not found', () => {
      const result = registry.delete('nonexistent', 'owner1');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('should fail when requester is not owner', () => {
      const result = registry.delete(packId, 'other-user');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FORBIDDEN');
    });
  });

  describe('deleteAllVersions', () => {
    beforeEach(() => {
      registry.register(
        { name: 'multi-ver', version: '1.0.0', runtimeTag: 'node' },
        'owner1'
      );
      registry.register(
        { name: 'multi-ver', version: '2.0.0', runtimeTag: 'node' },
        'owner1'
      );
      registry.register(
        { name: 'multi-ver', version: '3.0.0', runtimeTag: 'node' },
        'owner1'
      );
    });

    it('should delete all versions successfully', () => {
      const result = registry.deleteAllVersions('multi-ver', 'owner1');

      expect(result.success).toBe(true);
      expect(result.data?.deletedCount).toBe(3);
      expect(registry.exists('multi-ver')).toBe(false);
    });

    it('should fail when pack not found', () => {
      const result = registry.deleteAllVersions('nonexistent', 'owner1');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('should fail when requester is not owner', () => {
      const result = registry.deleteAllVersions('multi-ver', 'other-user');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('FORBIDDEN');
    });
  });

  describe('getById', () => {
    let packId: string;

    beforeEach(() => {
      const result = registry.register(
        { name: 'findable', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );
      packId = result.data!.pack.id;
    });

    it('should return pack by ID', () => {
      const result = registry.getById(packId);

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(packId);
      expect(result.data?.name).toBe('findable');
    });

    it('should fail when pack not found', () => {
      const result = registry.getById('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('getByNameVersion', () => {
    beforeEach(() => {
      registry.register(
        { name: 'versioned', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );
      registry.register(
        { name: 'versioned', version: '2.0.0', runtimeTag: 'node' },
        'user1'
      );
    });

    it('should return specific version', () => {
      const result = registry.getByNameVersion('versioned', '1.0.0');

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe('1.0.0');
    });

    it('should return different version', () => {
      const result = registry.getByNameVersion('versioned', '2.0.0');

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe('2.0.0');
    });

    it('should fail when version not found', () => {
      const result = registry.getByNameVersion('versioned', '3.0.0');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('getLatest', () => {
    beforeEach(() => {
      registry.register(
        { name: 'latest-test', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );
      registry.register(
        { name: 'latest-test', version: '2.0.0', runtimeTag: 'node' },
        'user1'
      );
      registry.register(
        { name: 'latest-test', version: '1.5.0', runtimeTag: 'node' },
        'user1'
      );
    });

    it('should return latest version based on semver', () => {
      const result = registry.getLatest('latest-test');

      expect(result.success).toBe(true);
      expect(result.data?.version).toBe('2.0.0');
    });

    it('should fail when pack not found', () => {
      const result = registry.getLatest('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('getVersions', () => {
    beforeEach(() => {
      registry.register(
        { name: 'versions-pack', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );
      registry.register(
        { name: 'versions-pack', version: '2.0.0', runtimeTag: 'node' },
        'user1'
      );
    });

    it('should return all versions', () => {
      const result = registry.getVersions('versions-pack');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
    });

    it('should return version summaries with correct properties', () => {
      const result = registry.getVersions('versions-pack');

      expect(result.success).toBe(true);
      result.data?.forEach(summary => {
        expect(summary).toHaveProperty('version');
        expect(summary).toHaveProperty('createdAt');
      });
    });

    it('should fail when pack not found', () => {
      const result = registry.getVersions('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });
  });

  describe('list', () => {
    beforeEach(() => {
      // Register multiple packs
      for (let i = 0; i < 25; i++) {
        registry.register(
          {
            name: `pack-${String(i).padStart(2, '0')}`,
            version: '1.0.0',
            runtimeTag: i % 2 === 0 ? 'node' : 'browser',
          },
          i % 3 === 0 ? 'owner-a' : 'owner-b'
        );
      }
    });

    it('should return paginated list with defaults', () => {
      const result = registry.list();

      expect(result.success).toBe(true);
      expect(result.data?.packs.length).toBe(20); // Default page size
      expect(result.data?.total).toBe(25);
      expect(result.data?.page).toBe(1);
      expect(result.data?.pageSize).toBe(20);
    });

    it('should filter by name', () => {
      const result = registry.list({ name: 'pack-0' });

      expect(result.success).toBe(true);
      result.data?.packs.forEach(pack => {
        expect(pack.name).toContain('pack-0');
      });
    });

    it('should filter by runtime tag', () => {
      const result = registry.list({ runtimeTag: 'node' });

      expect(result.success).toBe(true);
      result.data?.packs.forEach(pack => {
        expect(pack.runtimeTag).toBe('node');
      });
    });

    it('should filter by owner', () => {
      const result = registry.list({ ownerId: 'owner-a' });

      expect(result.success).toBe(true);
      result.data?.packs.forEach(pack => {
        expect(pack.ownerId).toBe('owner-a');
      });
    });

    it('should paginate correctly', () => {
      const result = registry.list({ page: 2, pageSize: 10 });

      expect(result.success).toBe(true);
      expect(result.data?.packs.length).toBe(10);
      expect(result.data?.page).toBe(2);
    });

    it('should return remaining items on last page', () => {
      const result = registry.list({ page: 3, pageSize: 10 });

      expect(result.success).toBe(true);
      expect(result.data?.packs.length).toBe(5);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      registry.register({ name: 'auth-service', version: '1.0.0', runtimeTag: 'node' }, 'user1');
      registry.register({ name: 'auth-helper', version: '1.0.0', runtimeTag: 'node' }, 'user1');
      registry.register({ name: 'db-service', version: '1.0.0', runtimeTag: 'node' }, 'user1');
    });

    it('should find packs matching query', () => {
      const result = registry.search('auth');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
    });

    it('should return empty for no matches', () => {
      const result = registry.search('nonexistent');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(0);
    });
  });

  describe('findByOwner', () => {
    beforeEach(() => {
      registry.register({ name: 'pack1', version: '1.0.0', runtimeTag: 'node' }, 'owner1');
      registry.register({ name: 'pack2', version: '1.0.0', runtimeTag: 'node' }, 'owner1');
      registry.register({ name: 'pack3', version: '1.0.0', runtimeTag: 'node' }, 'owner2');
    });

    it('should return packs owned by user', () => {
      const result = registry.findByOwner('owner1');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
      result.data?.forEach(pack => {
        expect(pack.ownerId).toBe('owner1');
      });
    });

    it('should return empty for unknown owner', () => {
      const result = registry.findByOwner('unknown');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(0);
    });
  });

  describe('findByRuntime', () => {
    beforeEach(() => {
      registry.register({ name: 'node-pack', version: '1.0.0', runtimeTag: 'node' }, 'user1');
      registry.register({ name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser' }, 'user1');
      registry.register({ name: 'universal-pack', version: '1.0.0', runtimeTag: 'universal' }, 'user1');
    });

    it('should return packs for node runtime', () => {
      const result = registry.findByRuntime('node');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);
      expect(result.data?.[0].name).toBe('node-pack');
    });

    it('should return packs for browser runtime', () => {
      const result = registry.findByRuntime('browser');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);
      expect(result.data?.[0].name).toBe('browser-pack');
    });

    it('should return universal packs', () => {
      const result = registry.findByRuntime('universal');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);
      expect(result.data?.[0].name).toBe('universal-pack');
    });
  });

  describe('findCompatibleWith', () => {
    beforeEach(() => {
      registry.register({ name: 'node-only', version: '1.0.0', runtimeTag: 'node' }, 'user1');
      registry.register({ name: 'browser-only', version: '1.0.0', runtimeTag: 'browser' }, 'user1');
      registry.register({ name: 'universal', version: '1.0.0', runtimeTag: 'universal' }, 'user1');
    });

    it('should return node-compatible packs (node + universal)', () => {
      const result = registry.findCompatibleWith('node');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
      const names = result.data?.map(p => p.name);
      expect(names).toContain('node-only');
      expect(names).toContain('universal');
    });

    it('should return browser-compatible packs (browser + universal)', () => {
      const result = registry.findCompatibleWith('browser');

      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
      const names = result.data?.map(p => p.name);
      expect(names).toContain('browser-only');
      expect(names).toContain('universal');
    });
  });

  describe('versionExists', () => {
    beforeEach(() => {
      registry.register({ name: 'check-pack', version: '1.0.0', runtimeTag: 'node' }, 'user1');
    });

    it('should return true for existing version', () => {
      expect(registry.versionExists('check-pack', '1.0.0')).toBe(true);
    });

    it('should return false for non-existing version', () => {
      expect(registry.versionExists('check-pack', '2.0.0')).toBe(false);
    });

    it('should return false for non-existing pack', () => {
      expect(registry.versionExists('unknown', '1.0.0')).toBe(false);
    });
  });

  describe('exists', () => {
    beforeEach(() => {
      registry.register({ name: 'existing-pack', version: '1.0.0', runtimeTag: 'node' }, 'user1');
    });

    it('should return true for existing pack', () => {
      expect(registry.exists('existing-pack')).toBe(true);
    });

    it('should return false for non-existing pack', () => {
      expect(registry.exists('unknown')).toBe(false);
    });
  });

  describe('isCompatible', () => {
    let nodePack: any;
    let browserPack: any;
    let universalPack: any;

    beforeEach(() => {
      nodePack = registry.register(
        { name: 'node-pack', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      ).data?.pack;
      browserPack = registry.register(
        { name: 'browser-pack', version: '1.0.0', runtimeTag: 'browser' },
        'user1'
      ).data?.pack;
      universalPack = registry.register(
        { name: 'universal-pack', version: '1.0.0', runtimeTag: 'universal' },
        'user1'
      ).data?.pack;
    });

    it('should return true for node pack with node runtime', () => {
      expect(registry.isCompatible(nodePack, 'node')).toBe(true);
    });

    it('should return false for node pack with browser runtime', () => {
      expect(registry.isCompatible(nodePack, 'browser')).toBe(false);
    });

    it('should return true for browser pack with browser runtime', () => {
      expect(registry.isCompatible(browserPack, 'browser')).toBe(true);
    });

    it('should return true for universal pack with any runtime', () => {
      expect(registry.isCompatible(universalPack, 'node')).toBe(true);
      expect(registry.isCompatible(universalPack, 'browser')).toBe(true);
    });
  });

  describe('createModel', () => {
    it('should create a reactive PackModel', () => {
      const result = registry.register(
        { name: 'model-pack', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );

      const model = registry.createModel(result.data!.pack);

      expect(model).toBeDefined();
      expect(model.id).toBe(result.data!.pack.id);
      expect(model.name).toBe('model-pack');
    });
  });

  describe('toListItem', () => {
    it('should create a list item from pack', () => {
      registry.register(
        { name: 'list-item-pack', version: '1.0.0', runtimeTag: 'node' },
        'user1'
      );
      registry.register(
        { name: 'list-item-pack', version: '2.0.0', runtimeTag: 'node' },
        'user1'
      );

      const result = registry.getLatest('list-item-pack');
      const listItem = registry.toListItem(result.data!);

      expect(listItem).toBeDefined();
      expect(listItem.name).toBe('list-item-pack');
      expect(listItem.versionCount).toBe(2);
    });
  });
});
