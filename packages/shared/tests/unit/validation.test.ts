/**
 * Unit tests for validation module
 */

import { describe, it, expect } from 'vitest';

import {
  // Pack validation
  validatePackName,
  validatePackVersion,
  validateRuntimeTag,
  validateRegisterPackInput,
  validateUpdatePackInput,

  // Node validation
  validateNodeName,
  validateRuntimeType,
  validateNodeLabels,
  validateAnnotations,
  validateTaints,
  validateRegisterNodeInput,

  // Pod validation
  validatePackId,
  validateNamespace,
  validateTolerations,
  validateCreatePodInput,
  validateUpdatePodInput,
  validateResourceRequestsVsLimits,

  // Namespace validation
  validateNamespaceName,
  isReservedNamespaceName,
  validateResourceQuota,
  validateLimitRange,
  validateCreateNamespaceInput,

  // Cluster validation
  validateSchedulingPolicy,
  validateUpdateClusterConfigInput,
  validateCreatePriorityClassInput,

  // Scheduling validation
  validateNodeAffinity,
  validateSchedulingConfig,
} from '../../src/validation';

// Import isRuntimeCompatible from types
import { isRuntimeCompatible, isNodeVersionCompatible } from '../../src/types';

// Import validateMinNodeVersion
import { validateMinNodeVersion } from '../../src/validation';

// Use validateNodeLabels as validateLabels for the tests
const validateLabels = validateNodeLabels;

describe('Pack Validation', () => {
  describe('validatePackName', () => {
    it('should accept valid pack names', () => {
      expect(validatePackName('my-pack')).toBeNull();
      expect(validatePackName('MyPack')).toBeNull();
      expect(validatePackName('pack_123')).toBeNull();
      expect(validatePackName('a')).toBeNull();
    });

    it('should reject empty names', () => {
      expect(validatePackName('')?.code).toBe('EMPTY');
      expect(validatePackName(null)?.code).toBe('REQUIRED');
      expect(validatePackName(undefined)?.code).toBe('REQUIRED');
    });

    it('should reject invalid names', () => {
      expect(validatePackName('123-pack')?.code).toBe('INVALID_FORMAT');
      expect(validatePackName('-invalid')?.code).toBe('INVALID_FORMAT');
      expect(validatePackName('pack with spaces')?.code).toBe('INVALID_FORMAT');
    });

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(65);
      expect(validatePackName(longName)?.code).toBe('TOO_LONG');
    });
  });

  describe('validatePackVersion', () => {
    it('should accept valid semver versions', () => {
      expect(validatePackVersion('1.0.0')).toBeNull();
      expect(validatePackVersion('2.1.3')).toBeNull();
      expect(validatePackVersion('0.0.1')).toBeNull();
      expect(validatePackVersion('1.0.0-beta.1')).toBeNull();
      expect(validatePackVersion('1.0.0-alpha+build.123')).toBeNull();
    });

    it('should reject invalid versions', () => {
      expect(validatePackVersion('1.0')?.code).toBe('INVALID_FORMAT');
      expect(validatePackVersion('v1.0.0')?.code).toBe('INVALID_FORMAT');
      expect(validatePackVersion('1.0.0.0')?.code).toBe('INVALID_FORMAT');
    });
  });

  describe('validateRuntimeTag', () => {
    it('should accept valid runtime tags', () => {
      expect(validateRuntimeTag('node')).toBeNull();
      expect(validateRuntimeTag('browser')).toBeNull();
      expect(validateRuntimeTag('universal')).toBeNull();
    });

    it('should reject invalid runtime tags', () => {
      expect(validateRuntimeTag('invalid')?.code).toBe('INVALID_VALUE');
      expect(validateRuntimeTag('Node')?.code).toBe('INVALID_VALUE');
    });
  });

  describe('validateRegisterPackInput', () => {
    it('should accept valid input', () => {
      const result = validateRegisterPackInput({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'node',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept input with optional fields', () => {
      const result = validateRegisterPackInput({
        name: 'my-pack',
        version: '1.0.0',
        runtimeTag: 'browser',
        description: 'A test pack',
        metadata: { key: 'value' },
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing required fields', () => {
      const result = validateRegisterPackInput({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('isRuntimeCompatible', () => {
    it('should match exact runtime tags', () => {
      expect(isRuntimeCompatible('node', 'node')).toBe(true);
      expect(isRuntimeCompatible('browser', 'browser')).toBe(true);
    });

    it('should handle universal runtime tag', () => {
      expect(isRuntimeCompatible('universal', 'node')).toBe(true);
      expect(isRuntimeCompatible('universal', 'browser')).toBe(true);
    });

    it('should reject mismatched runtime tags', () => {
      expect(isRuntimeCompatible('node', 'browser')).toBe(false);
      expect(isRuntimeCompatible('browser', 'node')).toBe(false);
    });
  });

  describe('isNodeVersionCompatible', () => {
    it('should return true when no minNodeVersion is specified', () => {
      expect(isNodeVersionCompatible('22.0.0', undefined)).toBe(true);
      expect(isNodeVersionCompatible('18.0.0', undefined)).toBe(true);
      expect(isNodeVersionCompatible(undefined, undefined)).toBe(true);
    });

    it('should return true when node version is not reported', () => {
      expect(isNodeVersionCompatible(undefined, '18.0.0')).toBe(true);
    });

    it('should return true when node version >= min version', () => {
      expect(isNodeVersionCompatible('22.0.0', '18.0.0')).toBe(true);
      expect(isNodeVersionCompatible('20.10.0', '20.0.0')).toBe(true);
      expect(isNodeVersionCompatible('18.0.0', '18.0.0')).toBe(true);
      expect(isNodeVersionCompatible('22.5.1', '22.5.0')).toBe(true);
    });

    it('should return false when node version < min version', () => {
      expect(isNodeVersionCompatible('16.0.0', '18.0.0')).toBe(false);
      expect(isNodeVersionCompatible('18.0.0', '20.0.0')).toBe(false);
      expect(isNodeVersionCompatible('20.9.0', '20.10.0')).toBe(false);
    });

    it('should handle v-prefixed versions', () => {
      expect(isNodeVersionCompatible('v22.0.0', '18.0.0')).toBe(true);
      expect(isNodeVersionCompatible('22.0.0', 'v18.0.0')).toBe(true);
      expect(isNodeVersionCompatible('v16.0.0', 'v18.0.0')).toBe(false);
    });

    it('should handle browser-style versions like "Chrome 120"', () => {
      // Browser versions should still work for major version comparison
      expect(isNodeVersionCompatible('Chrome 120', '100')).toBe(true);
      expect(isNodeVersionCompatible('Chrome 90', '100')).toBe(false);
    });

    it('should handle partial versions (major only)', () => {
      expect(isNodeVersionCompatible('22.0.0', '18')).toBe(true);
      expect(isNodeVersionCompatible('16.0.0', '18')).toBe(false);
    });
  });

  describe('validateMinNodeVersion', () => {
    it('should accept valid version formats', () => {
      expect(validateMinNodeVersion('18')).toBeNull();
      expect(validateMinNodeVersion('18.0')).toBeNull();
      expect(validateMinNodeVersion('18.0.0')).toBeNull();
      expect(validateMinNodeVersion('20.10.0')).toBeNull();
      expect(validateMinNodeVersion('22.5.1-beta')).toBeNull();
    });

    it('should accept v-prefixed versions', () => {
      expect(validateMinNodeVersion('v18.0.0')).toBeNull();
      expect(validateMinNodeVersion('v20')).toBeNull();
    });

    it('should allow undefined/null (optional field)', () => {
      expect(validateMinNodeVersion(undefined)).toBeNull();
      expect(validateMinNodeVersion(null)).toBeNull();
    });

    it('should reject empty strings', () => {
      expect(validateMinNodeVersion('')?.code).toBe('EMPTY');
    });

    it('should reject invalid formats', () => {
      expect(validateMinNodeVersion('abc')?.code).toBe('INVALID_FORMAT');
      expect(validateMinNodeVersion('node18')?.code).toBe('INVALID_FORMAT');
    });

    it('should reject non-string values', () => {
      expect(validateMinNodeVersion(18)?.code).toBe('INVALID_TYPE');
      expect(validateMinNodeVersion({})?.code).toBe('INVALID_TYPE');
    });
  });
});

describe('Node Validation', () => {
  describe('validateNodeName', () => {
    it('should accept valid node names', () => {
      expect(validateNodeName('node-1')).toBeNull();
      expect(validateNodeName('worker_node')).toBeNull();
      expect(validateNodeName('myNode123')).toBeNull();
    });

    it('should reject invalid node names', () => {
      expect(validateNodeName('')?.code).toBe('EMPTY');
      expect(validateNodeName('123-node')?.code).toBe('INVALID_FORMAT');
    });
  });

  describe('validateRuntimeType', () => {
    it('should accept valid runtime types', () => {
      expect(validateRuntimeType('node')).toBeNull();
      expect(validateRuntimeType('browser')).toBeNull();
    });

    it('should reject invalid runtime types', () => {
      expect(validateRuntimeType('universal')?.code).toBe('INVALID_VALUE');
      expect(validateRuntimeType('invalid')?.code).toBe('INVALID_VALUE');
    });
  });

  describe('validateLabels', () => {
    it('should accept valid labels', () => {
      const errors = validateLabels({ 'app': 'web', 'tier': 'frontend' });
      expect(errors).toHaveLength(0);
    });

    it('should accept labels with prefixes', () => {
      const errors = validateLabels({ 'example.com/role': 'primary' });
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid label keys', () => {
      const errors = validateLabels({ '-invalid': 'value' });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateTaints', () => {
    it('should accept valid taints', () => {
      const errors = validateTaints([
        { key: 'dedicated', value: 'gpu', effect: 'NoSchedule' },
      ]);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid taint effects', () => {
      const errors = validateTaints([
        { key: 'test', effect: 'Invalid' },
      ]);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateRegisterNodeInput', () => {
    it('should accept valid input', () => {
      const result = validateRegisterNodeInput({
        name: 'node-1',
        runtimeType: 'node',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept input with optional fields', () => {
      const result = validateRegisterNodeInput({
        name: 'node-1',
        runtimeType: 'browser',
        labels: { 'env': 'prod' },
        taints: [{ key: 'reserved', effect: 'NoSchedule' }],
      });
      expect(result.valid).toBe(true);
    });
  });
});

describe('Pod Validation', () => {
  describe('validatePackId', () => {
    it('should accept valid UUIDs', () => {
      expect(validatePackId('123e4567-e89b-12d3-a456-426614174000')).toBeNull();
    });

    it('should reject invalid UUIDs', () => {
      expect(validatePackId('invalid')?.code).toBe('INVALID_FORMAT');
      expect(validatePackId('123')?.code).toBe('INVALID_FORMAT');
    });
  });

  describe('validateNamespace', () => {
    it('should accept valid namespaces', () => {
      expect(validateNamespace('default')).toBeNull();
      expect(validateNamespace('my-namespace')).toBeNull();
      expect(validateNamespace('ns1')).toBeNull();
    });

    it('should reject invalid namespaces', () => {
      expect(validateNamespace('My-Namespace')?.code).toBe('INVALID_FORMAT');
      expect(validateNamespace('123-namespace')?.code).toBe('INVALID_FORMAT');
    });
  });

  describe('validateTolerations', () => {
    it('should accept valid tolerations', () => {
      const errors = validateTolerations([
        { key: 'node-role', operator: 'Equal', value: 'master', effect: 'NoSchedule' },
      ]);
      expect(errors).toHaveLength(0);
    });

    it('should accept tolerations with Exists operator', () => {
      const errors = validateTolerations([
        { key: 'dedicated', operator: 'Exists', effect: 'NoExecute' },
      ]);
      expect(errors).toHaveLength(0);
    });
  });

  describe('validateCreatePodInput', () => {
    it('should accept valid input', () => {
      const result = validateCreatePodInput({
        packId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept input with optional fields', () => {
      const result = validateCreatePodInput({
        packId: '123e4567-e89b-12d3-a456-426614174000',
        namespace: 'production',
        labels: { 'app': 'web' },
        resourceRequests: { cpu: 100, memory: 256 },
        resourceLimits: { cpu: 200, memory: 512 },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateResourceRequestsVsLimits', () => {
    it('should pass when requests are less than limits', () => {
      const errors = validateResourceRequestsVsLimits(
        { cpu: 100, memory: 256 },
        { cpu: 200, memory: 512 },
      );
      expect(errors).toHaveLength(0);
    });

    it('should fail when requests exceed limits', () => {
      const errors = validateResourceRequestsVsLimits(
        { cpu: 300, memory: 256 },
        { cpu: 200, memory: 512 },
      );
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});

describe('Namespace Validation', () => {
  describe('validateNamespaceName', () => {
    it('should accept valid namespace names', () => {
      expect(validateNamespaceName('my-namespace')).toBeNull();
      expect(validateNamespaceName('ns1')).toBeNull();
      expect(validateNamespaceName('production')).toBeNull();
    });

    it('should reject invalid namespace names', () => {
      expect(validateNamespaceName('')?.code).toBe('EMPTY');
      expect(validateNamespaceName('MyNamespace')?.code).toBe('INVALID_FORMAT');
      expect(validateNamespaceName('123-ns')?.code).toBe('INVALID_FORMAT');
    });
  });

  describe('isReservedNamespaceName', () => {
    it('should identify reserved namespaces', () => {
      expect(isReservedNamespaceName('default')).toBe(true);
      expect(isReservedNamespaceName('stark-system')).toBe(true);
      expect(isReservedNamespaceName('stark-public')).toBe(true);
    });

    it('should not flag non-reserved namespaces', () => {
      expect(isReservedNamespaceName('my-namespace')).toBe(false);
      expect(isReservedNamespaceName('production')).toBe(false);
    });
  });

  describe('validateResourceQuota', () => {
    it('should accept valid resource quota', () => {
      const errors = validateResourceQuota({
        hard: { pods: 10, cpu: 4000, memory: 8192 },
      });
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid resource values', () => {
      const errors = validateResourceQuota({
        hard: { pods: -5 },
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateLimitRange', () => {
    it('should accept valid limit range', () => {
      const errors = validateLimitRange({
        default: { cpu: 200, memory: 512 },
        defaultRequest: { cpu: 100, memory: 256 },
        max: { cpu: 1000, memory: 2048 },
        min: { cpu: 50, memory: 128 },
      });
      expect(errors).toHaveLength(0);
    });

    it('should reject when min exceeds max', () => {
      const errors = validateLimitRange({
        min: { cpu: 1000 },
        max: { cpu: 500 },
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateCreateNamespaceInput', () => {
    it('should accept valid input', () => {
      const result = validateCreateNamespaceInput({
        name: 'my-namespace',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject reserved namespace names', () => {
      const result = validateCreateNamespaceInput({
        name: 'default',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'RESERVED')).toBe(true);
    });
  });
});

describe('Cluster Validation', () => {
  describe('validateSchedulingPolicy', () => {
    it('should accept valid policies', () => {
      expect(validateSchedulingPolicy('spread')).toBeNull();
      expect(validateSchedulingPolicy('binpack')).toBeNull();
      expect(validateSchedulingPolicy('random')).toBeNull();
      expect(validateSchedulingPolicy('affinity')).toBeNull();
      expect(validateSchedulingPolicy('least_loaded')).toBeNull();
    });

    it('should reject invalid policies', () => {
      expect(validateSchedulingPolicy('invalid')?.code).toBe('INVALID_VALUE');
    });
  });

  describe('validateUpdateClusterConfigInput', () => {
    it('should accept valid config updates', () => {
      const result = validateUpdateClusterConfigInput({
        maxPodsPerNode: 110,
        schedulingPolicy: 'spread',
        heartbeatIntervalMs: 10000,
        heartbeatTimeoutMs: 30000,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject when timeout is less than interval', () => {
      const result = validateUpdateClusterConfigInput({
        heartbeatIntervalMs: 30000,
        heartbeatTimeoutMs: 10000,
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateCreatePriorityClassInput', () => {
    it('should accept valid priority class', () => {
      const result = validateCreatePriorityClassInput({
        name: 'high-priority',
        value: 1000000,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept optional fields', () => {
      const result = validateCreatePriorityClassInput({
        name: 'critical',
        value: 2000000,
        globalDefault: false,
        preemptionPolicy: 'PreemptLowerPriority',
        description: 'Critical workloads',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid priority values', () => {
      const result = validateCreatePriorityClassInput({
        name: 'invalid',
        value: 3000000000, // Out of range
      });
      expect(result.valid).toBe(false);
    });
  });
});

describe('Scheduling Validation', () => {
  describe('validateNodeAffinity', () => {
    it('should accept valid node affinity', () => {
      const errors = validateNodeAffinity({
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [
                { key: 'zone', operator: 'In', values: ['us-west-1', 'us-west-2'] },
              ],
            },
          ],
        },
      });
      expect(errors).toHaveLength(0);
    });

    it('should accept preferred scheduling terms', () => {
      const errors = validateNodeAffinity({
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 100,
            preference: {
              matchExpressions: [
                { key: 'disktype', operator: 'In', values: ['ssd'] },
              ],
            },
          },
        ],
      });
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid operators', () => {
      const errors = validateNodeAffinity({
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [
                { key: 'zone', operator: 'InvalidOp', values: ['us-west-1'] },
              ],
            },
          ],
        },
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should require values for In operator', () => {
      const errors = validateNodeAffinity({
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [
                { key: 'zone', operator: 'In' }, // Missing values
              ],
            },
          ],
        },
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateSchedulingConfig', () => {
    it('should accept valid scheduling config', () => {
      const result = validateSchedulingConfig({
        nodeSelector: { 'zone': 'us-west-1' },
        priorityClassName: 'high-priority',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept empty config', () => {
      const result = validateSchedulingConfig(undefined);
      expect(result.valid).toBe(true);
    });

    it('should accept complex affinity rules', () => {
      const result = validateSchedulingConfig({
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              { matchExpressions: [{ key: 'env', operator: 'In', values: ['prod'] }] },
            ],
          },
        },
        podAntiAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 50,
              podAffinityTerm: {
                labelSelector: { matchLabels: { 'app': 'web' } },
                topologyKey: 'node',
              },
            },
          ],
        },
      });
      expect(result.valid).toBe(true);
    });
  });
});

// Import deployment validation functions
import {
  validateDeploymentName,
  validateDeploymentPackId,
  validateDeploymentPackName,
  validateReplicas,
  validateDeploymentNamespace,
  validateDeploymentStatus,
  validateDeploymentMetadata,
  validateCreateDeploymentInput,
  validateUpdateDeploymentInput,
} from '../../src/validation';

describe('Deployment Validation', () => {
  describe('validateDeploymentName', () => {
    it('should accept valid deployment names', () => {
      expect(validateDeploymentName('my-deployment')).toBeNull();
      expect(validateDeploymentName('deployment-1')).toBeNull();
      expect(validateDeploymentName('a')).toBeNull();
      expect(validateDeploymentName('web-app')).toBeNull();
      expect(validateDeploymentName('backend-api-v2')).toBeNull();
    });

    it('should reject missing names', () => {
      expect(validateDeploymentName(null)?.code).toBe('REQUIRED');
      expect(validateDeploymentName(undefined)?.code).toBe('REQUIRED');
    });

    it('should reject empty names', () => {
      expect(validateDeploymentName('')?.code).toBe('INVALID_LENGTH');
    });

    it('should reject non-string names', () => {
      expect(validateDeploymentName(123)?.code).toBe('INVALID_TYPE');
      expect(validateDeploymentName({})?.code).toBe('INVALID_TYPE');
    });

    it('should reject names with uppercase letters', () => {
      expect(validateDeploymentName('MyDeployment')?.code).toBe('INVALID_FORMAT');
      expect(validateDeploymentName('UPPERCASE')?.code).toBe('INVALID_FORMAT');
    });

    it('should reject names starting with hyphen', () => {
      expect(validateDeploymentName('-invalid')?.code).toBe('INVALID_FORMAT');
    });

    it('should reject names ending with hyphen', () => {
      expect(validateDeploymentName('invalid-')?.code).toBe('INVALID_FORMAT');
    });

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(64);
      expect(validateDeploymentName(longName)?.code).toBe('INVALID_LENGTH');
    });

    it('should accept max length names', () => {
      const maxName = 'a'.repeat(63);
      expect(validateDeploymentName(maxName)).toBeNull();
    });
  });

  describe('validateDeploymentPackId', () => {
    it('should accept valid UUIDs', () => {
      expect(validateDeploymentPackId('11111111-1111-4111-8111-111111111111')).toBeNull();
      expect(validateDeploymentPackId('22222222-2222-4222-8222-222222222222')).toBeNull();
    });

    it('should allow undefined (optional)', () => {
      expect(validateDeploymentPackId(undefined)).toBeNull();
      expect(validateDeploymentPackId(null)).toBeNull();
    });

    it('should reject invalid UUIDs', () => {
      expect(validateDeploymentPackId('not-a-uuid')?.code).toBe('INVALID_FORMAT');
      expect(validateDeploymentPackId('12345')?.code).toBe('INVALID_FORMAT');
    });

    it('should reject non-string values', () => {
      expect(validateDeploymentPackId(123)?.code).toBe('INVALID_TYPE');
    });
  });

  describe('validateDeploymentPackName', () => {
    it('should accept valid pack names', () => {
      expect(validateDeploymentPackName('my-pack')).toBeNull();
      expect(validateDeploymentPackName('web-app')).toBeNull();
    });

    it('should allow undefined (optional)', () => {
      expect(validateDeploymentPackName(undefined)).toBeNull();
      expect(validateDeploymentPackName(null)).toBeNull();
    });

    it('should reject empty pack names', () => {
      expect(validateDeploymentPackName('')?.code).toBe('INVALID_LENGTH');
    });

    it('should reject non-string values', () => {
      expect(validateDeploymentPackName(123)?.code).toBe('INVALID_TYPE');
    });
  });

  describe('validateReplicas', () => {
    it('should accept valid replica counts', () => {
      expect(validateReplicas(0)).toBeNull(); // DaemonSet mode
      expect(validateReplicas(1)).toBeNull();
      expect(validateReplicas(100)).toBeNull();
      expect(validateReplicas(1000)).toBeNull(); // Max replicas
    });

    it('should allow undefined (defaults to 1)', () => {
      expect(validateReplicas(undefined)).toBeNull();
      expect(validateReplicas(null)).toBeNull();
    });

    it('should reject negative replicas', () => {
      expect(validateReplicas(-1)?.code).toBe('INVALID_VALUE');
    });

    it('should reject replicas exceeding max', () => {
      expect(validateReplicas(1001)?.code).toBe('INVALID_VALUE');
    });

    it('should reject non-integer replicas', () => {
      expect(validateReplicas(1.5)?.code).toBe('INVALID_TYPE');
    });

    it('should reject non-number replicas', () => {
      expect(validateReplicas('5')?.code).toBe('INVALID_TYPE');
    });
  });

  describe('validateDeploymentNamespace', () => {
    it('should accept valid namespaces', () => {
      expect(validateDeploymentNamespace('default')).toBeNull();
      expect(validateDeploymentNamespace('production')).toBeNull();
      expect(validateDeploymentNamespace('my-namespace')).toBeNull();
    });

    it('should allow undefined (defaults to default)', () => {
      expect(validateDeploymentNamespace(undefined)).toBeNull();
      expect(validateDeploymentNamespace(null)).toBeNull();
    });

    it('should reject empty namespace', () => {
      expect(validateDeploymentNamespace('')?.code).toBe('INVALID_LENGTH');
    });

    it('should reject namespace exceeding max length', () => {
      const longNamespace = 'a'.repeat(64);
      expect(validateDeploymentNamespace(longNamespace)?.code).toBe('INVALID_LENGTH');
    });

    it('should reject non-string namespace', () => {
      expect(validateDeploymentNamespace(123)?.code).toBe('INVALID_TYPE');
    });
  });

  describe('validateDeploymentStatus', () => {
    it('should accept valid statuses', () => {
      expect(validateDeploymentStatus('active')).toBeNull();
      expect(validateDeploymentStatus('paused')).toBeNull();
      expect(validateDeploymentStatus('scaling')).toBeNull();
      expect(validateDeploymentStatus('deleting')).toBeNull();
    });

    it('should allow undefined (optional)', () => {
      expect(validateDeploymentStatus(undefined)).toBeNull();
      expect(validateDeploymentStatus(null)).toBeNull();
    });

    it('should reject invalid statuses', () => {
      expect(validateDeploymentStatus('invalid')?.code).toBe('INVALID_VALUE');
      expect(validateDeploymentStatus('running')?.code).toBe('INVALID_VALUE');
    });

    it('should reject non-string status', () => {
      expect(validateDeploymentStatus(123)?.code).toBe('INVALID_TYPE');
    });
  });

  describe('validateDeploymentMetadata', () => {
    it('should accept valid metadata', () => {
      expect(validateDeploymentMetadata({})).toBeNull();
      expect(validateDeploymentMetadata({ key: 'value' })).toBeNull();
      expect(validateDeploymentMetadata({ nested: { data: 123 } })).toBeNull();
    });

    it('should allow undefined (defaults to empty object)', () => {
      expect(validateDeploymentMetadata(undefined)).toBeNull();
      expect(validateDeploymentMetadata(null)).toBeNull();
    });

    it('should reject non-object metadata', () => {
      expect(validateDeploymentMetadata('string')?.code).toBe('INVALID_TYPE');
      expect(validateDeploymentMetadata(123)?.code).toBe('INVALID_TYPE');
      expect(validateDeploymentMetadata([])?.code).toBe('INVALID_TYPE');
    });

    it('should reject metadata with too many keys', () => {
      const tooManyKeys: Record<string, string> = {};
      for (let i = 0; i < 51; i++) {
        tooManyKeys[`key${i}`] = 'value';
      }
      expect(validateDeploymentMetadata(tooManyKeys)?.code).toBe('INVALID_LENGTH');
    });
  });

  describe('validateCreateDeploymentInput', () => {
    it('should accept valid input with packId', () => {
      const result = validateCreateDeploymentInput({
        name: 'my-deployment',
        packId: '11111111-1111-4111-8111-111111111111',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid input with packName', () => {
      const result = validateCreateDeploymentInput({
        name: 'my-deployment',
        packName: 'my-pack',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept valid input with all optional fields', () => {
      const result = validateCreateDeploymentInput({
        name: 'full-deployment',
        packId: '11111111-1111-4111-8111-111111111111',
        replicas: 5,
        namespace: 'production',
        labels: { app: 'web' },
        annotations: { description: 'Test' },
        podLabels: { version: 'v1' },
        podAnnotations: { owner: 'team-backend' },
        tolerations: [{ key: 'gpu', operator: 'Exists', effect: 'NoSchedule' }],
        resourceRequests: { cpu: 500, memory: 512 },
        resourceLimits: { cpu: 1000, memory: 1024 },
        metadata: { region: 'us-east' },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing name', () => {
      const result = validateCreateDeploymentInput({
        packId: '11111111-1111-4111-8111-111111111111',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'name')).toBe(true);
    });

    it('should reject missing packId and packName', () => {
      const result = validateCreateDeploymentInput({
        name: 'my-deployment',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'packId' && e.code === 'REQUIRED')).toBe(true);
    });

    it('should reject invalid replicas', () => {
      const result = validateCreateDeploymentInput({
        name: 'my-deployment',
        packId: '11111111-1111-4111-8111-111111111111',
        replicas: -5,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'replicas')).toBe(true);
    });

    it('should reject non-object input', () => {
      const result = validateCreateDeploymentInput('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'input')).toBe(true);
    });

    it('should accept DaemonSet mode (replicas=0)', () => {
      const result = validateCreateDeploymentInput({
        name: 'daemonset-deployment',
        packId: '11111111-1111-4111-8111-111111111111',
        replicas: 0,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('validateUpdateDeploymentInput', () => {
    it('should accept empty update (no fields)', () => {
      const result = validateUpdateDeploymentInput({});
      expect(result.valid).toBe(true);
    });

    it('should accept valid replicas update', () => {
      const result = validateUpdateDeploymentInput({ replicas: 10 });
      expect(result.valid).toBe(true);
    });

    it('should accept valid status update', () => {
      const result = validateUpdateDeploymentInput({ status: 'paused' });
      expect(result.valid).toBe(true);
    });

    it('should accept valid labels update', () => {
      const result = validateUpdateDeploymentInput({ labels: { app: 'web' } });
      expect(result.valid).toBe(true);
    });

    it('should accept valid tolerations update', () => {
      const result = validateUpdateDeploymentInput({
        tolerations: [{ key: 'gpu', operator: 'Exists', effect: 'NoSchedule' }],
      });
      expect(result.valid).toBe(true);
    });

    it('should accept multiple field updates', () => {
      const result = validateUpdateDeploymentInput({
        replicas: 5,
        status: 'active',
        labels: { app: 'web' },
        resourceRequests: { cpu: 500, memory: 512 },
      });
      expect(result.valid).toBe(true);
    });

    it('should reject invalid replicas', () => {
      const result = validateUpdateDeploymentInput({ replicas: -1 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'replicas')).toBe(true);
    });

    it('should reject invalid status', () => {
      const result = validateUpdateDeploymentInput({ status: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'status')).toBe(true);
    });

    it('should reject non-object input', () => {
      const result = validateUpdateDeploymentInput('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'input')).toBe(true);
    });

    it('should accept scale to DaemonSet mode', () => {
      const result = validateUpdateDeploymentInput({ replicas: 0 });
      expect(result.valid).toBe(true);
    });
  });
});
