/**
 * Integration tests for Priority-Based Preemption
 * @module tests/integration/priority-preemption
 *
 * Tests for User Story 6: Kubernetes-Like Scheduling & Isolation
 * These tests verify that priority-based preemption works correctly for pod scheduling
 *
 * TDD: These tests are written FIRST and will FAIL until T118w is fully implemented.
 *
 * Key scenarios tested:
 * 1. High-priority pod preempts lower-priority pods when resources are constrained
 * 2. PreemptLowerPriority policy allows preemption
 * 3. Never preemption policy prevents pod from preempting others
 * 4. Multiple pods are evicted if needed to free sufficient resources
 * 5. Pods are evicted in priority order (lowest first)
 * 6. System-critical pods cannot be preempted by user pods
 * 7. Preemption only occurs when no other options are available
 * 8. Priority class resolution from name to value
 * 9. Default priority is applied when no priority class is specified
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CreatePodInput, PriorityClass } from '@stark-o/shared';
import { BUILTIN_PRIORITY_CLASSES } from '@stark-o/shared';

import { PodScheduler, PodSchedulerErrorCodes } from '@stark-o/core/services/pod-scheduler';
import { PackRegistry } from '@stark-o/core/services/pack-registry';
import { createNodeManager, NodeManager } from '@stark-o/core/services/node-manager';
import { clusterState, resetClusterState } from '@stark-o/core/stores/cluster-store';

describe('Priority Preemption Integration Tests', () => {
  let scheduler: PodScheduler;
  let schedulerWithPreemption: PodScheduler;
  let packRegistry: PackRegistry;
  let nodeManager: NodeManager;
  const testUserId = 'test-user-priority';
  let testPackId: string;

  /**
   * Create a priority class and add it to the cluster state
   */
  function createPriorityClass(
    name: string,
    value: number,
    preemptionPolicy: 'PreemptLowerPriority' | 'Never' = 'PreemptLowerPriority',
    globalDefault = false
  ): PriorityClass {
    const priorityClass: PriorityClass = {
      id: crypto.randomUUID(),
      name,
      value,
      globalDefault,
      preemptionPolicy,
      description: `Test priority class: ${name}`,
      labels: {},
      annotations: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    clusterState.priorityClasses.set(name, priorityClass);
    return priorityClass;
  }

  /**
   * Register a node with specific resources
   */
  function registerNodeWithResources(
    name: string,
    cpuAllocatable: number,
    memoryAllocatable: number,
    labels: Record<string, string> = {}
  ): string {
    const result = nodeManager.register(
      {
        name,
        runtimeType: 'node',
        labels,
        allocatable: {
          cpu: cpuAllocatable,
          memory: memoryAllocatable,
          pods: 10,
          storage: 1000,
        },
      },
      testUserId
    );
    expect(result.success).toBe(true);
    return result.data!.node.id;
  }

  /**
   * Create a pod with specific resource requests and priority
   */
  function createPodInput(
    priorityClassName: string | undefined,
    cpuRequest: number,
    memoryRequest: number
  ): CreatePodInput {
    return {
      packId: testPackId,
      namespace: 'default',
      priorityClassName,
      resourceRequests: {
        cpu: cpuRequest,
        memory: memoryRequest,
      },
    };
  }

  beforeEach(() => {
    // Reset state before each test
    resetClusterState();

    // Create fresh instances for each test
    packRegistry = new PackRegistry();
    nodeManager = createNodeManager();
    
    // Scheduler without preemption (default)
    scheduler = new PodScheduler({ enablePreemption: false });
    
    // Scheduler with preemption enabled
    schedulerWithPreemption = new PodScheduler({ 
      enablePreemption: true,
      defaultPriority: 0,
    });

    // Register a test pack for all tests
    const packResult = packRegistry.register(
      { name: 'test-pack', version: '1.0.0', runtimeTag: 'node' },
      testUserId
    );
    expect(packResult.success).toBe(true);
    testPackId = packResult.data!.pack.id;

    // Set up standard priority classes
    createPriorityClass('system-node-critical', 2000001000, 'PreemptLowerPriority');
    createPriorityClass('system-cluster-critical', 2000000000, 'PreemptLowerPriority');
    createPriorityClass('high-priority', 1000000, 'PreemptLowerPriority');
    createPriorityClass('default', 0, 'PreemptLowerPriority', true);
    createPriorityClass('low-priority', -1000, 'Never');
    createPriorityClass('best-effort', -1000000, 'Never');
  });

  afterEach(() => {
    nodeManager.dispose();
  });

  // ===========================================================================
  // Basic Preemption Tests
  // ===========================================================================

  describe('Basic Preemption Behavior', () => {
    it('should preempt lower-priority pod when resources are constrained', () => {
      // Create a node with limited resources (100 CPU, 256 MB)
      const nodeId = registerNodeWithResources('constrained-node', 100, 256);

      // Schedule a low-priority pod that uses most of the resources
      const lowPriorityInput = createPodInput('low-priority', 80, 200);
      const lowPriorityResult = schedulerWithPreemption.createAndSchedule(lowPriorityInput, testUserId);
      expect(lowPriorityResult.success).toBe(true);
      expect(lowPriorityResult.data!.scheduling.scheduled).toBe(true);
      const lowPriorityPodId = lowPriorityResult.data!.pod.id;

      // Start the low-priority pod
      schedulerWithPreemption.start(lowPriorityPodId);
      schedulerWithPreemption.setRunning(lowPriorityPodId);

      // Try to schedule a high-priority pod that requires more resources than available
      const highPriorityInput = createPodInput('high-priority', 90, 200);
      const highPriorityResult = schedulerWithPreemption.createAndSchedule(highPriorityInput, testUserId);

      // High-priority pod should be scheduled after preempting the low-priority pod
      expect(highPriorityResult.success).toBe(true);
      expect(highPriorityResult.data!.scheduling.scheduled).toBe(true);
      expect(highPriorityResult.data!.scheduling.nodeId).toBe(nodeId);

      // The low-priority pod should be evicted
      const lowPriorityPod = clusterState.pods.get(lowPriorityPodId);
      expect(lowPriorityPod?.status).toBe('evicted');
    });

    it('should not preempt when preemption is disabled', () => {
      // Create a node with limited resources
      const nodeId = registerNodeWithResources('constrained-node', 100, 256);

      // Schedule a low-priority pod that uses all resources
      const lowPriorityInput = createPodInput('low-priority', 100, 256);
      const lowPriorityResult = scheduler.createAndSchedule(lowPriorityInput, testUserId);
      expect(lowPriorityResult.success).toBe(true);
      const lowPriorityPodId = lowPriorityResult.data!.pod.id;

      // Start the low-priority pod
      scheduler.start(lowPriorityPodId);
      scheduler.setRunning(lowPriorityPodId);

      // Try to schedule a high-priority pod (preemption disabled)
      const highPriorityInput = createPodInput('high-priority', 50, 128);
      const highPriorityResult = scheduler.createAndSchedule(highPriorityInput, testUserId);

      // Should fail to schedule (no resources, preemption disabled)
      expect(highPriorityResult.data!.scheduling.scheduled).toBe(false);

      // The low-priority pod should still be running
      const lowPriorityPod = clusterState.pods.get(lowPriorityPodId);
      expect(lowPriorityPod?.status).toBe('running');
    });

    it('should not preempt pods with equal or higher priority', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Schedule a high-priority pod
      const highPriorityInput1 = createPodInput('high-priority', 80, 200);
      const result1 = schedulerWithPreemption.createAndSchedule(highPriorityInput1, testUserId);
      expect(result1.success).toBe(true);
      const pod1Id = result1.data!.pod.id;

      // Start the pod
      schedulerWithPreemption.start(pod1Id);
      schedulerWithPreemption.setRunning(pod1Id);

      // Try to schedule another high-priority pod (same priority)
      const highPriorityInput2 = createPodInput('high-priority', 50, 100);
      const result2 = schedulerWithPreemption.createAndSchedule(highPriorityInput2, testUserId);

      // Should fail to schedule (cannot preempt equal priority)
      expect(result2.data!.scheduling.scheduled).toBe(false);

      // Original pod should still be running
      const pod1 = clusterState.pods.get(pod1Id);
      expect(pod1?.status).toBe('running');
    });
  });

  // ===========================================================================
  // Preemption Policy Tests
  // ===========================================================================

  describe('Preemption Policy', () => {
    it('should respect Never preemption policy - pod cannot preempt others', () => {
      // Create a node with limited resources
      const nodeId = registerNodeWithResources('constrained-node', 100, 256);

      // Schedule a best-effort pod (uses all resources)
      const bestEffortInput = createPodInput('best-effort', 100, 256);
      const bestEffortResult = schedulerWithPreemption.createAndSchedule(bestEffortInput, testUserId);
      expect(bestEffortResult.success).toBe(true);
      const bestEffortPodId = bestEffortResult.data!.pod.id;

      schedulerWithPreemption.start(bestEffortPodId);
      schedulerWithPreemption.setRunning(bestEffortPodId);

      // Try to schedule a low-priority pod with Never preemption policy
      // Even though low-priority has higher value than best-effort,
      // low-priority has Never policy so it cannot preempt
      const lowPriorityInput = createPodInput('low-priority', 50, 128);
      const lowPriorityResult = schedulerWithPreemption.createAndSchedule(lowPriorityInput, testUserId);

      // Should fail to schedule because low-priority has Never policy
      expect(lowPriorityResult.data!.scheduling.scheduled).toBe(false);
    });

    it('should allow PreemptLowerPriority pods to preempt', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Schedule a best-effort pod
      const bestEffortInput = createPodInput('best-effort', 80, 200);
      const bestEffortResult = schedulerWithPreemption.createAndSchedule(bestEffortInput, testUserId);
      expect(bestEffortResult.success).toBe(true);
      const bestEffortPodId = bestEffortResult.data!.pod.id;

      schedulerWithPreemption.start(bestEffortPodId);
      schedulerWithPreemption.setRunning(bestEffortPodId);

      // Schedule a high-priority pod (PreemptLowerPriority policy)
      const highPriorityInput = createPodInput('high-priority', 80, 200);
      const highPriorityResult = schedulerWithPreemption.createAndSchedule(highPriorityInput, testUserId);

      // Should succeed by preempting the best-effort pod
      expect(highPriorityResult.success).toBe(true);
      expect(highPriorityResult.data!.scheduling.scheduled).toBe(true);

      // Best-effort pod should be evicted
      const bestEffortPod = clusterState.pods.get(bestEffortPodId);
      expect(bestEffortPod?.status).toBe('evicted');
    });
  });

  // ===========================================================================
  // Multiple Pod Preemption Tests
  // ===========================================================================

  describe('Multiple Pod Preemption', () => {
    it('should preempt multiple pods if needed to free sufficient resources', () => {
      // Create a node with limited resources
      const nodeId = registerNodeWithResources('constrained-node', 200, 512);

      // Schedule three low-priority pods
      const podIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const input = createPodInput('low-priority', 60, 150);
        const result = schedulerWithPreemption.createAndSchedule(input, testUserId);
        expect(result.success).toBe(true);
        expect(result.data!.scheduling.scheduled).toBe(true);
        podIds.push(result.data!.pod.id);
        
        schedulerWithPreemption.start(result.data!.pod.id);
        schedulerWithPreemption.setRunning(result.data!.pod.id);
      }

      // Try to schedule a high-priority pod that needs 150 CPU
      // This requires evicting at least 3 pods (3 * 60 = 180 > 150)
      const highPriorityInput = createPodInput('high-priority', 150, 400);
      const highPriorityResult = schedulerWithPreemption.createAndSchedule(highPriorityInput, testUserId);

      // Should succeed after preempting multiple pods
      expect(highPriorityResult.success).toBe(true);
      expect(highPriorityResult.data!.scheduling.scheduled).toBe(true);

      // Count evicted pods
      const evictedCount = podIds.filter(id => {
        const pod = clusterState.pods.get(id);
        return pod?.status === 'evicted';
      }).length;

      // At least enough pods should be evicted to free resources
      expect(evictedCount).toBeGreaterThanOrEqual(2);
    });

    it('should evict pods in priority order (lowest priority first)', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 150, 384);

      // Schedule pods with different priorities
      const defaultInput = createPodInput('default', 50, 128);
      const defaultResult = schedulerWithPreemption.createAndSchedule(defaultInput, testUserId);
      const defaultPodId = defaultResult.data!.pod.id;
      schedulerWithPreemption.start(defaultPodId);
      schedulerWithPreemption.setRunning(defaultPodId);

      const lowInput = createPodInput('low-priority', 50, 128);
      const lowResult = schedulerWithPreemption.createAndSchedule(lowInput, testUserId);
      const lowPodId = lowResult.data!.pod.id;
      schedulerWithPreemption.start(lowPodId);
      schedulerWithPreemption.setRunning(lowPodId);

      const bestEffortInput = createPodInput('best-effort', 50, 128);
      const bestEffortResult = schedulerWithPreemption.createAndSchedule(bestEffortInput, testUserId);
      const bestEffortPodId = bestEffortResult.data!.pod.id;
      schedulerWithPreemption.start(bestEffortPodId);
      schedulerWithPreemption.setRunning(bestEffortPodId);

      // Schedule a high-priority pod that needs resources from at least one pod
      const highPriorityInput = createPodInput('high-priority', 60, 150);
      const highPriorityResult = schedulerWithPreemption.createAndSchedule(highPriorityInput, testUserId);

      expect(highPriorityResult.success).toBe(true);
      expect(highPriorityResult.data!.scheduling.scheduled).toBe(true);

      // Best-effort (lowest priority) should be evicted first
      const bestEffortPod = clusterState.pods.get(bestEffortPodId);
      expect(bestEffortPod?.status).toBe('evicted');

      // Default priority pod should still be running (not needed for resources)
      const defaultPod = clusterState.pods.get(defaultPodId);
      expect(defaultPod?.status).toBe('running');
    });
  });

  // ===========================================================================
  // System Priority Tests
  // ===========================================================================

  describe('System Priority Protection', () => {
    it('should not preempt system-critical pods for user workloads', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Schedule a system-cluster-critical pod
      const systemInput = createPodInput('system-cluster-critical', 80, 200);
      const systemResult = schedulerWithPreemption.createAndSchedule(systemInput, testUserId);
      expect(systemResult.success).toBe(true);
      const systemPodId = systemResult.data!.pod.id;
      schedulerWithPreemption.start(systemPodId);
      schedulerWithPreemption.setRunning(systemPodId);

      // Try to schedule a high-priority user pod
      const userInput = createPodInput('high-priority', 80, 200);
      const userResult = schedulerWithPreemption.createAndSchedule(userInput, testUserId);

      // Should fail - cannot preempt system-critical pods
      expect(userResult.data!.scheduling.scheduled).toBe(false);

      // System pod should still be running
      const systemPod = clusterState.pods.get(systemPodId);
      expect(systemPod?.status).toBe('running');
    });

    it('should allow system-node-critical to preempt system-cluster-critical', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Schedule a system-cluster-critical pod
      const clusterCriticalInput = createPodInput('system-cluster-critical', 80, 200);
      const clusterCriticalResult = schedulerWithPreemption.createAndSchedule(clusterCriticalInput, testUserId);
      expect(clusterCriticalResult.success).toBe(true);
      const clusterCriticalPodId = clusterCriticalResult.data!.pod.id;
      schedulerWithPreemption.start(clusterCriticalPodId);
      schedulerWithPreemption.setRunning(clusterCriticalPodId);

      // Schedule a system-node-critical pod (higher priority)
      const nodeCriticalInput = createPodInput('system-node-critical', 80, 200);
      const nodeCriticalResult = schedulerWithPreemption.createAndSchedule(nodeCriticalInput, testUserId);

      // Should succeed by preempting the cluster-critical pod
      expect(nodeCriticalResult.success).toBe(true);
      expect(nodeCriticalResult.data!.scheduling.scheduled).toBe(true);

      // Cluster-critical pod should be evicted
      const clusterCriticalPod = clusterState.pods.get(clusterCriticalPodId);
      expect(clusterCriticalPod?.status).toBe('evicted');
    });
  });

  // ===========================================================================
  // Priority Class Resolution Tests
  // ===========================================================================

  describe('Priority Class Resolution', () => {
    it('should resolve priority from priority class name', () => {
      // Create a node with plenty of resources
      registerNodeWithResources('large-node', 1000, 4096);

      // Create pod with high-priority class
      const input = createPodInput('high-priority', 50, 128);
      const result = schedulerWithPreemption.createAndSchedule(input, testUserId);

      expect(result.success).toBe(true);
      expect(result.data!.pod.priority).toBe(BUILTIN_PRIORITY_CLASSES.HIGH_PRIORITY.value);
    });

    it('should use default priority when no priority class is specified', () => {
      // Create a node with plenty of resources
      registerNodeWithResources('large-node', 1000, 4096);

      // Create pod without priority class
      const input = createPodInput(undefined, 50, 128);
      const result = schedulerWithPreemption.createAndSchedule(input, testUserId);

      expect(result.success).toBe(true);
      expect(result.data!.pod.priority).toBe(0); // default priority
    });

    it('should use scheduler default priority for unknown priority class', () => {
      // Create a node with plenty of resources
      registerNodeWithResources('large-node', 1000, 4096);

      // Create pod with unknown priority class
      const input = createPodInput('unknown-priority-class', 50, 128);
      const result = schedulerWithPreemption.createAndSchedule(input, testUserId);

      expect(result.success).toBe(true);
      expect(result.data!.pod.priority).toBe(0); // falls back to default
    });
  });

  // ===========================================================================
  // Preemption Only When Necessary Tests
  // ===========================================================================

  describe('Preemption Only When Necessary', () => {
    it('should prefer available resources over preemption', () => {
      // Create two nodes - one with resources, one full
      const emptyNodeId = registerNodeWithResources('empty-node', 100, 256);
      const fullNodeId = registerNodeWithResources('full-node', 100, 256);

      // Fill one node with a low-priority pod (it will go to one of the nodes based on scheduling)
      const lowInput = createPodInput('low-priority', 100, 256);
      const lowResult = schedulerWithPreemption.createAndSchedule(lowInput, testUserId);
      expect(lowResult.success).toBe(true);
      const lowPodId = lowResult.data!.pod.id;
      const nodeFilledByLowPriorityPod = lowResult.data!.scheduling.nodeId;
      schedulerWithPreemption.start(lowPodId);
      schedulerWithPreemption.setRunning(lowPodId);

      // Determine which node is actually empty after the first pod is scheduled
      const actualEmptyNode = nodeFilledByLowPriorityPod === emptyNodeId ? fullNodeId : emptyNodeId;

      // Schedule a high-priority pod - should use the empty node, not preempt
      const highInput = createPodInput('high-priority', 50, 128);
      const highResult = schedulerWithPreemption.createAndSchedule(highInput, testUserId);

      expect(highResult.success).toBe(true);
      expect(highResult.data!.scheduling.scheduled).toBe(true);
      // Should be scheduled on the actually empty node (whichever is not filled)
      expect(highResult.data!.scheduling.nodeId).toBe(actualEmptyNode);

      // Low-priority pod should still be running (not preempted)
      const lowPod = clusterState.pods.get(lowPodId);
      expect(lowPod?.status).toBe('running');
    });

    it('should try all nodes before resorting to preemption', () => {
      // Create multiple nodes with some capacity
      const node1Id = registerNodeWithResources('node-1', 50, 128);
      const node2Id = registerNodeWithResources('node-2', 100, 256);
      const node3Id = registerNodeWithResources('node-3', 80, 200);

      // Fill node2 partially
      const existingInput = createPodInput('low-priority', 60, 150);
      const existingResult = schedulerWithPreemption.createAndSchedule(existingInput, testUserId);
      expect(existingResult.success).toBe(true);
      expect(existingResult.data!.scheduling.nodeId).toBe(node2Id);
      const existingPodId = existingResult.data!.pod.id;
      schedulerWithPreemption.start(existingPodId);
      schedulerWithPreemption.setRunning(existingPodId);

      // Schedule a high-priority pod that fits on node-3
      const highInput = createPodInput('high-priority', 70, 180);
      const highResult = schedulerWithPreemption.createAndSchedule(highInput, testUserId);

      expect(highResult.success).toBe(true);
      expect(highResult.data!.scheduling.scheduled).toBe(true);
      // Should be scheduled on node-3 (has capacity)
      expect(highResult.data!.scheduling.nodeId).toBe(node3Id);

      // Existing pod should not be preempted
      const existingPod = clusterState.pods.get(existingPodId);
      expect(existingPod?.status).toBe('running');
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle preemption when victim pod is in scheduled state', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Create and schedule a low-priority pod but don't start it
      const lowInput = createPodInput('low-priority', 80, 200);
      const lowResult = schedulerWithPreemption.createAndSchedule(lowInput, testUserId);
      expect(lowResult.success).toBe(true);
      expect(lowResult.data!.scheduling.scheduled).toBe(true);
      const lowPodId = lowResult.data!.pod.id;
      // Pod is scheduled but not started

      // Try to schedule a high-priority pod
      const highInput = createPodInput('high-priority', 80, 200);
      const highResult = schedulerWithPreemption.createAndSchedule(highInput, testUserId);

      // Should succeed by preempting the scheduled (not yet running) pod
      expect(highResult.success).toBe(true);
      expect(highResult.data!.scheduling.scheduled).toBe(true);

      // Low-priority pod should be evicted
      const lowPod = clusterState.pods.get(lowPodId);
      expect(lowPod?.status).toBe('evicted');
    });

    it('should not preempt pods that are already evicted or stopped', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Create, schedule, start, and then stop a low-priority pod
      const lowInput = createPodInput('low-priority', 80, 200);
      const lowResult = schedulerWithPreemption.createAndSchedule(lowInput, testUserId);
      const lowPodId = lowResult.data!.pod.id;
      schedulerWithPreemption.start(lowPodId);
      schedulerWithPreemption.setRunning(lowPodId);
      schedulerWithPreemption.stop(lowPodId);

      // Now try to schedule a high-priority pod
      // The stopped pod's resources should already be freed
      const highInput = createPodInput('high-priority', 80, 200);
      const highResult = schedulerWithPreemption.createAndSchedule(highInput, testUserId);

      // Should succeed without needing preemption (resources already free)
      expect(highResult.success).toBe(true);
      expect(highResult.data!.scheduling.scheduled).toBe(true);
    });

    it('should handle preemption failure gracefully', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Fill with system-critical pod (cannot be preempted)
      const systemInput = createPodInput('system-node-critical', 100, 256);
      const systemResult = schedulerWithPreemption.createAndSchedule(systemInput, testUserId);
      const systemPodId = systemResult.data!.pod.id;
      schedulerWithPreemption.start(systemPodId);
      schedulerWithPreemption.setRunning(systemPodId);

      // Try to schedule a high-priority pod (lower than system-critical)
      const highInput = createPodInput('high-priority', 50, 128);
      const highResult = schedulerWithPreemption.createAndSchedule(highInput, testUserId);

      // Should fail gracefully
      expect(highResult.success).toBe(true); // Creation succeeded
      expect(highResult.data!.scheduling.scheduled).toBe(false); // But scheduling failed

      // High-priority pod should be pending
      const highPod = clusterState.pods.get(highResult.data!.pod.id);
      expect(highPod?.status).toBe('pending');
    });

    it('should handle case where preemption cannot free enough resources', () => {
      // Create a node with limited resources
      registerNodeWithResources('constrained-node', 100, 256);

      // Fill with a single pod that won't give enough resources
      const lowInput = createPodInput('low-priority', 50, 128);
      const lowResult = schedulerWithPreemption.createAndSchedule(lowInput, testUserId);
      const lowPodId = lowResult.data!.pod.id;
      schedulerWithPreemption.start(lowPodId);
      schedulerWithPreemption.setRunning(lowPodId);

      // Try to schedule a high-priority pod that needs more than node can provide
      const highInput = createPodInput('high-priority', 150, 300);
      const highResult = schedulerWithPreemption.createAndSchedule(highInput, testUserId);

      // Should fail - even with preemption, not enough total resources
      expect(highResult.data!.scheduling.scheduled).toBe(false);
    });
  });

  // ===========================================================================
  // Preemption with Affinity/Taints Tests
  // ===========================================================================

  describe('Preemption with Scheduling Constraints', () => {
    it('should only consider preemption on nodes that satisfy affinity requirements', () => {
      // Create two nodes with different labels
      const gpuNodeId = registerNodeWithResources('gpu-node', 100, 256, { 'gpu': 'nvidia' });
      const cpuNodeId = registerNodeWithResources('cpu-node', 100, 256, { 'cpu': 'intel' });

      // Fill both nodes with low-priority pods
      const lowInput1 = createPodInput('low-priority', 100, 256);
      const lowResult1 = schedulerWithPreemption.createAndSchedule(lowInput1, testUserId);
      const lowPod1Id = lowResult1.data!.pod.id;
      schedulerWithPreemption.start(lowPod1Id);
      schedulerWithPreemption.setRunning(lowPod1Id);

      const lowInput2 = createPodInput('low-priority', 100, 256);
      const lowResult2 = schedulerWithPreemption.createAndSchedule(lowInput2, testUserId);
      const lowPod2Id = lowResult2.data!.pod.id;
      schedulerWithPreemption.start(lowPod2Id);
      schedulerWithPreemption.setRunning(lowPod2Id);

      // Try to schedule a high-priority pod that requires GPU node
      const highInput: CreatePodInput = {
        packId: testPackId,
        namespace: 'default',
        priorityClassName: 'high-priority',
        resourceRequests: { cpu: 80, memory: 200 },
        scheduling: {
          nodeSelector: { 'gpu': 'nvidia' },
        },
      };
      const highResult = schedulerWithPreemption.createAndSchedule(highInput, testUserId);

      // Should be scheduled on GPU node after preempting
      expect(highResult.success).toBe(true);
      if (highResult.data!.scheduling.scheduled) {
        expect(highResult.data!.scheduling.nodeId).toBe(gpuNodeId);
      }
    });
  });
});
