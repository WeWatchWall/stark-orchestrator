/**
 * Pod scheduler service
 * Handles pod orchestration, scheduling, and runtime compatibility checking
 * @module @stark-o/core/services/pod-scheduler
 */

import type { ComputedRef } from '@vue/reactivity';
import type {
  Pod,
  PodStatus,
  CreatePodInput,
  Node,
  RuntimeTag,
  RuntimeType,
  Pack,
  PodHistoryEntry,
  ResourceQuotaHard,
} from '@stark-o/shared';
import {
  validateCreatePodInput,
  isRuntimeCompatible,
  toleratesBlockingTaints,
  getUntoleratedPreferNoScheduleTaints,
  matchesSelector,
  matchesNodeSelectorTerm,
  calculateAffinityScore,
  hasAvailableResources,
  isNodeSchedulable,
  createServiceLogger,
  hasQuotaAvailable,
  getRemainingQuota,
  DEFAULT_RESOURCE_REQUESTS,
} from '@stark-o/shared';

/**
 * Logger for pod scheduler operations
 */
const logger = createServiceLogger({
  level: 'debug',
  service: 'stark-orchestrator',
}, { component: 'pod-scheduler' });
import { clusterState } from '../stores/cluster-store';
import {
  createPod,
  schedulePod as storeSchedulePod,
  startPod as storeStartPod,
  setPodRunning,
  stopPod as storeStopPod,
  setPodStopped,
  setPodFailed,
  evictPod as storeEvictPod,
  removePod,
  findPodsByPack,
  findPodsByNode,
  findPodsByNamespace,
  findPodsByStatus,
  getPendingPodsByPriority,
  getEvictablePodsOnNode,
  getPodHistory,
  addHistoryEntry,
  podCount,
  runningPodCount,
  pendingPodCount,
  podsByStatus,
  podsByNamespace,
  podsByNode,
} from '../stores/pod-store';
import {
  findPackById,
  findPackByNameVersion,
} from '../stores/pack-store';
import {
  getSchedulableNodesForRuntime,
  allocateResources,
  releaseResources,
} from '../stores/node-store';
import {
  updatePod,
} from '../stores/pod-store';
import { PodModel, type PodCreationResult, type PodListResponse, type PodListFilters } from '../models/pod';

// ============================================================================
// Types
// ============================================================================

/**
 * Pod scheduler options
 */
export interface PodSchedulerOptions {
  /** Maximum retries for scheduling */
  maxRetries?: number;
  /** Default priority for pods */
  defaultPriority?: number;
  /** Enable preemption */
  enablePreemption?: boolean;
  /** Scheduling policy */
  schedulingPolicy?: 'spread' | 'binpack' | 'random' | 'affinity' | 'least_loaded';
}

/**
 * Pod operation result
 */
export interface PodOperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Scheduling result
 */
export interface SchedulingResult {
  podId: string;
  nodeId: string;
  scheduled: boolean;
  message?: string;
}

/**
 * Node scoring result for scheduling decisions
 */
interface NodeScore {
  node: Node;
  score: number;
  reasons: string[];
}

/**
 * Pod scheduler error codes
 */
export const PodSchedulerErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PACK_NOT_FOUND: 'PACK_NOT_FOUND',
  NAMESPACE_NOT_FOUND: 'NAMESPACE_NOT_FOUND',
  NAMESPACE_QUOTA_EXCEEDED: 'NAMESPACE_QUOTA_EXCEEDED',
  NO_COMPATIBLE_NODES: 'NO_COMPATIBLE_NODES',
  INSUFFICIENT_RESOURCES: 'INSUFFICIENT_RESOURCES',
  SCHEDULING_FAILED: 'SCHEDULING_FAILED',
  POD_NOT_FOUND: 'POD_NOT_FOUND',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  RUNTIME_MISMATCH: 'RUNTIME_MISMATCH',
  TAINT_NOT_TOLERATED: 'TAINT_NOT_TOLERATED',
  AFFINITY_NOT_SATISFIED: 'AFFINITY_NOT_SATISFIED',
  NODE_NOT_SCHEDULABLE: 'NODE_NOT_SCHEDULABLE',
  PREEMPTION_FAILED: 'PREEMPTION_FAILED',
  VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
  SAME_VERSION: 'SAME_VERSION',
  INVALID_STATE: 'INVALID_STATE',
} as const;

/**
 * Rollback result
 */
export interface RollbackResult {
  podId: string;
  previousVersion: string;
  newVersion: string;
  packId: string;
  packName: string;
}

// ============================================================================
// Pod Scheduler Service
// ============================================================================

/**
 * Pod Scheduler Service
 * Manages pod lifecycle: creation, scheduling, status updates, and termination
 */
export class PodScheduler {
  public readonly maxRetries: number;
  private readonly defaultPriority: number;
  private readonly enablePreemption: boolean;
  private readonly schedulingPolicy: string;

  constructor(options: PodSchedulerOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.defaultPriority = options.defaultPriority ?? 0;
    this.enablePreemption = options.enablePreemption ?? false;
    this.schedulingPolicy = options.schedulingPolicy ?? 'spread';
  }

  // ===========================================================================
  // Computed Properties (reactive)
  // ===========================================================================

  /**
   * Total number of pods
   */
  get totalPods(): ComputedRef<number> {
    return podCount;
  }

  /**
   * Number of running pods
   */
  get runningPods(): ComputedRef<number> {
    return runningPodCount;
  }

  /**
   * Number of pending pods
   */
  get pendingPods(): ComputedRef<number> {
    return pendingPodCount;
  }

  /**
   * Pods grouped by status
   */
  get byStatus(): ComputedRef<Map<PodStatus, Pod[]>> {
    return podsByStatus;
  }

  /**
   * Pods grouped by namespace
   */
  get byNamespace(): ComputedRef<Map<string, Pod[]>> {
    return podsByNamespace;
  }

  /**
   * Pods grouped by node
   */
  get byNode(): ComputedRef<Map<string, Pod[]>> {
    return podsByNode;
  }

  // ===========================================================================
  // Pod Creation
  // ===========================================================================

  /**
   * Create a new pod
   * @param input - Pod creation input
   * @param createdBy - User ID who created the pod
   * @returns Operation result with created pod
   */
  create(
    input: CreatePodInput,
    createdBy: string
  ): PodOperationResult<PodCreationResult> {
    logger.debug('Attempting pod creation', {
      packId: input.packId,
      packVersion: input.packVersion,
      namespace: input.namespace,
      createdBy,
      priorityClassName: input.priorityClassName,
    });

    // Validate input
    const validation = validateCreatePodInput(input);
    if (!validation.valid) {
      const details: Record<string, { code: string; message: string }> = {};
      for (const error of validation.errors) {
        details[error.field] = { code: error.code, message: error.message };
      }
      logger.warn('Pod creation validation failed', {
        packId: input.packId,
        createdBy,
        errorCount: validation.errors.length,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.VALIDATION_ERROR,
          message: 'Invalid pod creation input',
          details,
        },
      };
    }

    // Find the pack
    const pack = findPackById(input.packId);
    if (!pack) {
      logger.warn('Pod creation failed: pack not found', {
        packId: input.packId,
        createdBy,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.PACK_NOT_FOUND,
          message: `Pack not found: ${input.packId}`,
        },
      };
    }

    // Determine pack version
    const packVersion = input.packVersion ?? pack.version;

    // Validate namespace exists and check quota
    const namespaceName = input.namespace ?? clusterState.config.defaultNamespace;
    const namespace = clusterState.namespaces.get(namespaceName);
    if (!namespace) {
      logger.warn('Pod creation failed: namespace not found', {
        namespace: namespaceName,
        packId: input.packId,
        createdBy,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.NAMESPACE_NOT_FOUND,
          message: `Namespace not found: ${namespaceName}`,
          details: { namespace: namespaceName },
        },
      };
    }

    // Check if namespace is terminating
    if (namespace.phase === 'terminating') {
      logger.warn('Pod creation failed: namespace is terminating', {
        namespace: namespaceName,
        packId: input.packId,
        createdBy,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.VALIDATION_ERROR,
          message: `Namespace '${namespaceName}' is terminating and cannot accept new pods`,
          details: { namespace: namespaceName, phase: namespace.phase },
        },
      };
    }

    // Calculate resource requirements for quota validation
    const resourceRequests = {
      cpu: input.resourceRequests?.cpu ?? DEFAULT_RESOURCE_REQUESTS.cpu,
      memory: input.resourceRequests?.memory ?? DEFAULT_RESOURCE_REQUESTS.memory,
    };

    // Validate namespace quota
    const quotaRequired: Partial<ResourceQuotaHard> = {
      pods: 1,
      cpu: resourceRequests.cpu,
      memory: resourceRequests.memory,
    };

    if (!hasQuotaAvailable(namespace, quotaRequired)) {
      const remaining = getRemainingQuota(namespace);
      const exceededResources: string[] = [];

      if (remaining) {
        if (remaining.pods !== undefined && remaining.pods < 1) {
          exceededResources.push(`pods (requested: 1, remaining: ${remaining.pods})`);
        }
        if (remaining.cpu !== undefined && resourceRequests.cpu > remaining.cpu) {
          exceededResources.push(`cpu (requested: ${resourceRequests.cpu}, remaining: ${remaining.cpu})`);
        }
        if (remaining.memory !== undefined && resourceRequests.memory > remaining.memory) {
          exceededResources.push(`memory (requested: ${resourceRequests.memory}, remaining: ${remaining.memory})`);
        }
      }

      logger.warn('Pod creation failed: namespace quota exceeded', {
        namespace: namespaceName,
        packId: input.packId,
        createdBy,
        requested: quotaRequired,
        remaining,
        exceeded: exceededResources,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.NAMESPACE_QUOTA_EXCEEDED,
          message: `Quota exceeded in namespace '${namespaceName}'`,
          details: {
            namespace: namespaceName,
            requested: quotaRequired,
            remaining,
            exceeded: exceededResources,
          },
        },
      };
    }

    // Check if there are compatible nodes (early validation)
    const compatibleRuntime = this.getCompatibleRuntimeType(pack.runtimeTag);
    const schedulableNodes = getSchedulableNodesForRuntime(compatibleRuntime);
    if (schedulableNodes.length === 0) {
      // Still create the pod, but it will be pending
      // This is similar to Kubernetes behavior
      logger.debug('No compatible nodes available, pod will be pending', {
        packId: input.packId,
        packName: pack.name,
        runtimeTag: pack.runtimeTag,
        compatibleRuntime,
      });
    }

    // Determine priority
    const priority = this.resolvePriority(input.priorityClassName);

    // Create the pod in the store
    const pod = createPod({
      ...input,
      packVersion,
      priority,
      createdBy,
    });

    // Allocate resources in the namespace (update usage counters)
    namespace.resourceUsage.pods += 1;
    namespace.resourceUsage.cpu += resourceRequests.cpu;
    namespace.resourceUsage.memory += resourceRequests.memory;
    namespace.updatedAt = new Date();

    logger.info('Pod created successfully', {
      podId: pod.id,
      packId: pod.packId,
      packName: pack.name,
      packVersion: pod.packVersion,
      namespace: pod.namespace,
      priority: pod.priority,
      status: pod.status,
      createdBy,
      quotaAllocated: quotaRequired,
    });

    return {
      success: true,
      data: { pod },
    };
  }

  /**
   * Create and immediately attempt to schedule a pod
   * @param input - Pod creation input
   * @param createdBy - User ID who created the pod
   * @returns Operation result with pod and scheduling result
   */
  createAndSchedule(
    input: CreatePodInput,
    createdBy: string
  ): PodOperationResult<{ pod: Pod; scheduling: SchedulingResult }> {
    // Create the pod
    const createResult = this.create(input, createdBy);
    if (!createResult.success || !createResult.data) {
      return {
        success: false,
        error: createResult.error,
      };
    }

    const pod = createResult.data.pod;

    // Attempt to schedule
    const scheduleResult = this.schedule(pod.id);

    return {
      success: true,
      data: {
        pod: clusterState.pods.get(pod.id) ?? pod,
        scheduling: scheduleResult.data ?? {
          podId: pod.id,
          nodeId: '',
          scheduled: false,
          message: scheduleResult.error?.message,
        },
      },
    };
  }

  // ===========================================================================
  // Scheduling
  // ===========================================================================

  /**
   * Schedule a pending pod to an appropriate node
   * @param podId - Pod ID to schedule
   * @returns Scheduling result
   */
  schedule(podId: string): PodOperationResult<SchedulingResult> {
    logger.debug('Attempting pod scheduling', { podId });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Pod scheduling failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    if (pod.status !== 'pending') {
      logger.warn('Pod scheduling failed: invalid status', {
        podId,
        currentStatus: pod.status,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Pod is not pending: current status is ${pod.status}`,
        },
      };
    }

    // Find the pack to check runtime compatibility
    const pack = findPackById(pod.packId);
    if (!pack) {
      logger.warn('Pod scheduling failed: pack not found', {
        podId,
        packId: pod.packId,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.PACK_NOT_FOUND,
          message: `Pack not found for pod: ${pod.packId}`,
        },
      };
    }

    // Get compatible runtime type
    const compatibleRuntime = this.getCompatibleRuntimeType(pack.runtimeTag);

    // Find all schedulable nodes
    const candidateNodes = this.filterSchedulableNodes(pod, pack, compatibleRuntime);

    logger.debug('Found candidate nodes for scheduling', {
      podId,
      packName: pack.name,
      runtimeTag: pack.runtimeTag,
      candidateCount: candidateNodes.length,
    });

    if (candidateNodes.length === 0) {
      // Try preemption if enabled
      if (this.enablePreemption) {
        logger.debug('Attempting preemption for pod', { podId, priority: pod.priority });
        const preemptResult = this.attemptPreemption(pod, pack, compatibleRuntime);
        if (preemptResult.success && preemptResult.data) {
          return preemptResult;
        }
      }

      logger.warn('Pod scheduling failed: no compatible nodes', {
        podId,
        packId: pod.packId,
        packName: pack.name,
        runtimeTag: pack.runtimeTag,
        compatibleRuntime,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.NO_COMPATIBLE_NODES,
          message: 'No compatible nodes available for scheduling',
          details: {
            packRuntimeTag: pack.runtimeTag,
            requiredRuntime: compatibleRuntime,
          },
        },
      };
    }

    // Score and select the best node
    const scoredNodes = this.scoreNodes(pod, candidateNodes);
    const selectedNode = this.selectNode(scoredNodes);

    if (!selectedNode) {
      logger.warn('Pod scheduling failed: could not select node', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.SCHEDULING_FAILED,
          message: 'Failed to select a node for scheduling',
        },
      };
    }

    // Schedule the pod to the selected node
    storeSchedulePod(podId, selectedNode.id);

    // Allocate resources on the node
    allocateResources(
      selectedNode.id,
      pod.resourceRequests.cpu,
      pod.resourceRequests.memory
    );

    logger.info('Pod scheduled successfully', {
      podId,
      nodeId: selectedNode.id,
      nodeName: selectedNode.name,
      packId: pod.packId,
      packName: pack.name,
      namespace: pod.namespace,
      priority: pod.priority,
      resourceCpu: pod.resourceRequests.cpu,
      resourceMemory: pod.resourceRequests.memory,
    });

    return {
      success: true,
      data: {
        podId,
        nodeId: selectedNode.id,
        scheduled: true,
        message: `Pod scheduled to node ${selectedNode.name}`,
      },
    };
  }

  /**
   * Schedule all pending pods
   * @returns Array of scheduling results
   */
  scheduleAll(): SchedulingResult[] {
    const pendingPods = getPendingPodsByPriority();
    const results: SchedulingResult[] = [];

    for (const pod of pendingPods) {
      const result = this.schedule(pod.id);
      results.push(result.data ?? {
        podId: pod.id,
        nodeId: '',
        scheduled: false,
        message: result.error?.message,
      });
    }

    return results;
  }

  // ===========================================================================
  // Runtime Compatibility
  // ===========================================================================

  /**
   * Check if a pack is compatible with a node's runtime
   * @param packRuntimeTag - Pack's runtime tag
   * @param nodeRuntimeType - Node's runtime type
   * @returns true if compatible
   */
  checkRuntimeCompatibility(packRuntimeTag: RuntimeTag, nodeRuntimeType: RuntimeType): boolean {
    return isRuntimeCompatible(packRuntimeTag, nodeRuntimeType);
  }

  /**
   * Get the compatible runtime type for a pack
   * For universal packs, prefer 'node' runtime
   * @param runtimeTag - Pack's runtime tag
   * @returns Preferred runtime type
   */
  private getCompatibleRuntimeType(runtimeTag: RuntimeTag): RuntimeType {
    if (runtimeTag === 'universal') {
      // Prefer node runtime for universal packs
      const nodeNodes = getSchedulableNodesForRuntime('node');
      if (nodeNodes.length > 0) {
        return 'node';
      }
      return 'browser';
    }
    return runtimeTag as RuntimeType;
  }

  // ===========================================================================
  // Node Filtering and Scoring
  // ===========================================================================

  /**
   * Filter nodes that can accept the pod
   */
  private filterSchedulableNodes(pod: Pod, pack: Pack, _runtimeType: RuntimeType): Node[] {
    const allNodes = [...clusterState.nodes.values()];

    return allNodes.filter(node => {
      // Check basic schedulability
      if (!isNodeSchedulable(node)) {
        return false;
      }

      // Check runtime compatibility
      if (!isRuntimeCompatible(pack.runtimeTag, node.runtimeType)) {
        return false;
      }

      // Check blocking taints/tolerations (NoSchedule and NoExecute effects)
      // PreferNoSchedule is a soft constraint handled in scoring, not filtering
      if (!toleratesBlockingTaints(pod.tolerations, node.taints)) {
        return false;
      }

      // Check resource availability
      if (!hasAvailableResources(node, {
        cpu: pod.resourceRequests.cpu,
        memory: pod.resourceRequests.memory,
        pods: 1,
      })) {
        return false;
      }

      // Check node selector
      if (pod.scheduling?.nodeSelector) {
        for (const [key, value] of Object.entries(pod.scheduling.nodeSelector)) {
          if (node.labels[key] !== value) {
            return false;
          }
        }
      }

      // Check required node affinity
      if (pod.scheduling?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution) {
        const terms = pod.scheduling.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms;
        const matchesAny = terms.some(term => matchesNodeSelectorTerm(node.labels, term));
        if (!matchesAny) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Score nodes for pod placement
   */
  private scoreNodes(pod: Pod, nodes: Node[]): NodeScore[] {
    return nodes.map(node => {
      let score = 100; // Base score
      const reasons: string[] = [];

      // Apply scheduling policy
      switch (this.schedulingPolicy) {
        case 'spread': {
          // Prefer nodes with fewer pods
          const podsOnNode = findPodsByNode(node.id).length;
          score -= podsOnNode * 10;
          reasons.push(`spread: ${podsOnNode} pods on node`);
          break;
        }

        case 'binpack': {
          // Prefer nodes with more pods (pack them in)
          const existingPods = findPodsByNode(node.id).length;
          score += existingPods * 5;
          reasons.push(`binpack: ${existingPods} pods on node`);
          break;
        }

        case 'least_loaded': {
          // Prefer nodes with most available resources
          const cpuAvailable = node.allocatable.cpu - node.allocated.cpu;
          const memAvailable = node.allocatable.memory - node.allocated.memory;
          score += (cpuAvailable / node.allocatable.cpu) * 50;
          score += (memAvailable / node.allocatable.memory) * 50;
          reasons.push(`least_loaded: ${cpuAvailable}m CPU, ${memAvailable}Mi memory available`);
          break;
        }

        case 'random': {
          // Add some randomness
          score += Math.random() * 20;
          reasons.push('random selection');
          break;
        }
      }

      // Apply PreferNoSchedule taint penalty
      // These are soft constraints that reduce the node's score but don't block scheduling
      const untoleratedPreferNoSchedule = getUntoleratedPreferNoScheduleTaints(pod.tolerations, node.taints);
      if (untoleratedPreferNoSchedule.length > 0) {
        // Penalty of 50 per untolerated PreferNoSchedule taint
        const penalty = untoleratedPreferNoSchedule.length * 50;
        score -= penalty;
        reasons.push(`PreferNoSchedule penalty: -${penalty} (${untoleratedPreferNoSchedule.length} taints)`);
      }

      // Apply node affinity preferences
      if (pod.scheduling?.nodeAffinity) {
        const affinityScore = calculateAffinityScore(node.labels, pod.scheduling.nodeAffinity);
        if (affinityScore >= 0) {
          score += affinityScore;
          if (affinityScore > 0) {
            reasons.push(`affinity score: +${affinityScore}`);
          }
        }
      }

      // Apply pod affinity/anti-affinity
      if (pod.scheduling?.podAffinity ?? pod.scheduling?.podAntiAffinity) {
        const affinityScore = this.calculatePodAffinityScore(pod, node);
        score += affinityScore;
        if (affinityScore !== 0) {
          reasons.push(`pod affinity score: ${affinityScore >= 0 ? '+' : ''}${affinityScore}`);
        }
      }

      return { node, score, reasons };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate pod affinity/anti-affinity score for a node
   */
  private calculatePodAffinityScore(pod: Pod, node: Node): number {
    let score = 0;
    const podsOnNode = findPodsByNode(node.id);

    // Pod affinity - prefer nodes with matching pods
    if (pod.scheduling?.podAffinity?.preferredDuringSchedulingIgnoredDuringExecution) {
      for (const weightedTerm of pod.scheduling.podAffinity.preferredDuringSchedulingIgnoredDuringExecution) {
        const term = weightedTerm.podAffinityTerm;
        if (term.labelSelector) {
          const matchingPods = podsOnNode.filter(p =>
            matchesSelector(p.labels, term.labelSelector!)
          );
          if (matchingPods.length > 0) {
            score += weightedTerm.weight;
          }
        }
      }
    }

    // Pod anti-affinity - avoid nodes with matching pods
    if (pod.scheduling?.podAntiAffinity?.preferredDuringSchedulingIgnoredDuringExecution) {
      for (const weightedTerm of pod.scheduling.podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution) {
        const term = weightedTerm.podAffinityTerm;
        if (term.labelSelector) {
          const matchingPods = podsOnNode.filter(p =>
            matchesSelector(p.labels, term.labelSelector!)
          );
          if (matchingPods.length > 0) {
            score -= weightedTerm.weight;
          }
        }
      }
    }

    return score;
  }

  /**
   * Select the best node from scored nodes
   */
  private selectNode(scoredNodes: NodeScore[]): Node | undefined {
    if (scoredNodes.length === 0) {
      return undefined;
    }

    // Return the highest-scored node
    return scoredNodes[0]?.node;
  }

  // ===========================================================================
  // Preemption
  // ===========================================================================

  /**
   * Check if a pod is allowed to preempt other pods based on its priority class preemption policy.
   * @param pod - The pod that wants to preempt
   * @returns true if the pod can preempt, false if it has 'Never' preemption policy
   */
  private canPodPreempt(pod: Pod): boolean {
    // If no priority class specified, use default behavior (can preempt)
    if (pod.priorityClassName === undefined || pod.priorityClassName === '') {
      return true;
    }

    // Check the priority class's preemption policy
    const priorityClass = clusterState.priorityClasses.get(pod.priorityClassName);
    if (!priorityClass) {
      // Unknown priority class - default to allowing preemption
      return true;
    }

    // If preemptionPolicy is not defined, default to allowing preemption (PreemptLowerPriority)
    // Only 'Never' policy explicitly prevents preemption
    return priorityClass.preemptionPolicy !== 'Never';
  }

  /**
   * Attempt to preempt lower-priority pods to make room for a higher-priority pod
   */
  private attemptPreemption(
    pod: Pod,
    pack: Pack,
    _runtimeType: RuntimeType
  ): PodOperationResult<SchedulingResult> {
    if (!this.enablePreemption) {
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.PREEMPTION_FAILED,
          message: 'Preemption is disabled',
        },
      };
    }

    // Check if the pod's priority class allows preemption
    if (!this.canPodPreempt(pod)) {
      logger.debug('Pod cannot preempt: preemption policy is Never', {
        podId: pod.id,
        priorityClassName: pod.priorityClassName,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.PREEMPTION_FAILED,
          message: `Pod with priority class '${pod.priorityClassName}' has 'Never' preemption policy`,
        },
      };
    }

    // Find nodes with compatible runtime that match pod's scheduling requirements
    const allNodes = [...clusterState.nodes.values()].filter(node => {
      // Check basic compatibility
      if (!isRuntimeCompatible(pack.runtimeTag, node.runtimeType)) {
        return false;
      }
      
      // Skip if node is not schedulable
      if (node.unschedulable || node.status !== 'online') {
        return false;
      }

      // Check blocking taints/tolerations
      if (!toleratesBlockingTaints(pod.tolerations, node.taints)) {
        return false;
      }

      // Check node selector
      if (pod.scheduling?.nodeSelector) {
        for (const [key, value] of Object.entries(pod.scheduling.nodeSelector)) {
          if (node.labels[key] !== value) {
            return false;
          }
        }
      }

      // Check required node affinity
      if (pod.scheduling?.nodeAffinity?.requiredDuringSchedulingIgnoredDuringExecution) {
        const terms = pod.scheduling.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms;
        const matchesAny = terms.some(term => matchesNodeSelectorTerm(node.labels, term));
        if (!matchesAny) {
          return false;
        }
      }

      return true;
    });

    for (const node of allNodes) {
      // Get evictable pods on this node (sorted by priority, lowest first)
      const evictablePods = getEvictablePodsOnNode(node.id);

      // Find pods with lower priority that we can evict
      const podsToEvict: Pod[] = [];
      let freedCpu = 0;
      let freedMemory = 0;

      for (const evictablePod of evictablePods) {
        if (evictablePod.priority < pod.priority) {
          podsToEvict.push(evictablePod);
          freedCpu += evictablePod.resourceRequests.cpu;
          freedMemory += evictablePod.resourceRequests.memory;

          // Check if we have enough resources now
          const availableCpu = (node.allocatable.cpu - node.allocated.cpu) + freedCpu;
          const availableMemory = (node.allocatable.memory - node.allocated.memory) + freedMemory;

          if (availableCpu >= pod.resourceRequests.cpu && availableMemory >= pod.resourceRequests.memory) {
            // Evict the pods
            for (const podToEvict of podsToEvict) {
              this.evict(podToEvict.id, `Preempted by pod ${pod.id} with higher priority`);
            }

            // Schedule the pod
            storeSchedulePod(pod.id, node.id);
            allocateResources(node.id, pod.resourceRequests.cpu, pod.resourceRequests.memory);

            logger.info('Pod scheduled via preemption', {
              podId: pod.id,
              nodeId: node.id,
              nodeName: node.name,
              evictedPods: podsToEvict.map(p => p.id),
              evictedCount: podsToEvict.length,
            });

            return {
              success: true,
              data: {
                podId: pod.id,
                nodeId: node.id,
                scheduled: true,
                message: `Pod scheduled to node ${node.name} after preempting ${podsToEvict.length} pod(s)`,
              },
            };
          }
        }
      }
    }

    return {
      success: false,
      error: {
        code: PodSchedulerErrorCodes.PREEMPTION_FAILED,
        message: 'No pods with lower priority could be preempted',
      },
    };
  }

  // ===========================================================================
  // Priority Resolution
  // ===========================================================================

  /**
   * Resolve priority from priority class name
   */
  private resolvePriority(priorityClassName?: string): number {
    if (priorityClassName === undefined || priorityClassName === '') {
      return this.defaultPriority;
    }

    // Check cluster state for priority classes
    const priorityClass = clusterState.priorityClasses.get(priorityClassName);

    if (priorityClass) {
      return priorityClass.value;
    }

    return this.defaultPriority;
  }

  // ===========================================================================
  // Pod Lifecycle
  // ===========================================================================

  /**
   * Start a scheduled pod
   * @param podId - Pod ID
   * @returns Updated pod
   */
  start(podId: string): PodOperationResult<Pod> {
    logger.debug('Attempting to start pod', { podId });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Pod start failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    if (pod.status !== 'scheduled') {
      logger.warn('Pod start failed: invalid status', {
        podId,
        currentStatus: pod.status,
        expectedStatus: 'scheduled',
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Cannot start pod: current status is ${pod.status}, expected scheduled`,
        },
      };
    }

    const updated = storeStartPod(podId);

    logger.info('Pod started successfully', {
      podId,
      nodeId: pod.nodeId,
      packId: pod.packId,
      namespace: pod.namespace,
      previousStatus: 'scheduled',
      newStatus: 'starting',
    });

    return {
      success: true,
      data: updated,
    };
  }

  /**
   * Mark pod as running
   * @param podId - Pod ID
   * @returns Updated pod
   */
  setRunning(podId: string): PodOperationResult<Pod> {
    logger.debug('Attempting to set pod to running', { podId });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Set pod running failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    if (pod.status !== 'starting') {
      logger.warn('Set pod running failed: invalid status', {
        podId,
        currentStatus: pod.status,
        expectedStatus: 'starting',
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Cannot set pod to running: current status is ${pod.status}, expected starting`,
        },
      };
    }

    const updated = setPodRunning(podId);

    logger.info('Pod is now running', {
      podId,
      nodeId: pod.nodeId,
      packId: pod.packId,
      namespace: pod.namespace,
    });

    return {
      success: true,
      data: updated,
    };
  }

  /**
   * Stop a running pod
   * @param podId - Pod ID
   * @returns Updated pod
   */
  stop(podId: string): PodOperationResult<Pod> {
    logger.debug('Attempting to stop pod', { podId });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Pod stop failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    if (!['running', 'starting', 'scheduled'].includes(pod.status)) {
      logger.warn('Pod stop failed: invalid status', {
        podId,
        currentStatus: pod.status,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Cannot stop pod: current status is ${pod.status}`,
        },
      };
    }

    const previousStatus = pod.status;

    // Release resources if pod was on a node
    if (pod.nodeId !== null && pod.nodeId !== undefined && pod.nodeId !== '') {
      releaseResources(pod.nodeId, pod.resourceRequests.cpu, pod.resourceRequests.memory);
      logger.debug('Released pod resources from node', {
        podId,
        nodeId: pod.nodeId,
        cpu: pod.resourceRequests.cpu,
        memory: pod.resourceRequests.memory,
      });
    }

    // Release resources from namespace
    const podNamespace = clusterState.namespaces.get(pod.namespace);
    if (podNamespace) {
      podNamespace.resourceUsage.pods = Math.max(0, podNamespace.resourceUsage.pods - 1);
      podNamespace.resourceUsage.cpu = Math.max(0, podNamespace.resourceUsage.cpu - pod.resourceRequests.cpu);
      podNamespace.resourceUsage.memory = Math.max(0, podNamespace.resourceUsage.memory - pod.resourceRequests.memory);
      podNamespace.updatedAt = new Date();
      logger.debug('Released pod resources from namespace', {
        podId,
        namespace: pod.namespace,
        cpu: pod.resourceRequests.cpu,
        memory: pod.resourceRequests.memory,
      });
    }

    const updated = storeStopPod(podId);

    logger.info('Pod stopped successfully', {
      podId,
      nodeId: pod.nodeId,
      packId: pod.packId,
      namespace: pod.namespace,
      previousStatus,
      newStatus: 'stopping',
    });

    return {
      success: true,
      data: updated,
    };
  }

  /**
   * Mark pod as stopped
   * @param podId - Pod ID
   * @returns Updated pod
   */
  setStopped(podId: string): PodOperationResult<Pod> {
    logger.debug('Attempting to set pod to stopped', { podId });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Set pod stopped failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    if (pod.status !== 'stopping') {
      logger.warn('Set pod stopped failed: invalid status', {
        podId,
        currentStatus: pod.status,
        expectedStatus: 'stopping',
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.INVALID_STATUS_TRANSITION,
          message: `Cannot set pod to stopped: current status is ${pod.status}, expected stopping`,
        },
      };
    }

    const updated = setPodStopped(podId);

    logger.info('Pod is now stopped', {
      podId,
      nodeId: pod.nodeId,
      packId: pod.packId,
      namespace: pod.namespace,
    });

    return {
      success: true,
      data: updated,
    };
  }

  /**
   * Mark pod as failed
   * @param podId - Pod ID
   * @param reason - Failure reason
   * @returns Updated pod
   */
  fail(podId: string, reason?: string): PodOperationResult<Pod> {
    logger.debug('Attempting to mark pod as failed', { podId, reason });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Pod fail failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    // Release resources if pod was on a node
    if (pod.nodeId !== null && pod.nodeId !== undefined && pod.nodeId !== '') {
      releaseResources(pod.nodeId, pod.resourceRequests.cpu, pod.resourceRequests.memory);
      logger.debug('Released failed pod resources from node', {
        podId,
        nodeId: pod.nodeId,
      });
    }

    // Release resources from namespace
    const podNamespace = clusterState.namespaces.get(pod.namespace);
    if (podNamespace) {
      podNamespace.resourceUsage.pods = Math.max(0, podNamespace.resourceUsage.pods - 1);
      podNamespace.resourceUsage.cpu = Math.max(0, podNamespace.resourceUsage.cpu - pod.resourceRequests.cpu);
      podNamespace.resourceUsage.memory = Math.max(0, podNamespace.resourceUsage.memory - pod.resourceRequests.memory);
      podNamespace.updatedAt = new Date();
      logger.debug('Released failed pod resources from namespace', {
        podId,
        namespace: pod.namespace,
      });
    }

    const previousStatus = pod.status;
    const updated = setPodFailed(podId, reason);

    logger.warn('Pod marked as failed', {
      podId,
      nodeId: pod.nodeId,
      packId: pod.packId,
      namespace: pod.namespace,
      previousStatus,
      reason,
    });

    return {
      success: true,
      data: updated,
    };
  }

  /**
   * Evict a pod
   * @param podId - Pod ID
   * @param reason - Eviction reason
   * @returns Updated pod
   */
  evict(podId: string, reason?: string): PodOperationResult<Pod> {
    logger.debug('Attempting to evict pod', { podId, reason });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Pod eviction failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    const previousStatus = pod.status;

    // Release resources if pod was on a node
    if (pod.nodeId !== null && pod.nodeId !== undefined && pod.nodeId !== '') {
      releaseResources(pod.nodeId, pod.resourceRequests.cpu, pod.resourceRequests.memory);
      logger.debug('Released evicted pod resources from node', {
        podId,
        nodeId: pod.nodeId,
      });
    }

    // Release resources from namespace
    const podNamespace = clusterState.namespaces.get(pod.namespace);
    if (podNamespace) {
      podNamespace.resourceUsage.pods = Math.max(0, podNamespace.resourceUsage.pods - 1);
      podNamespace.resourceUsage.cpu = Math.max(0, podNamespace.resourceUsage.cpu - pod.resourceRequests.cpu);
      podNamespace.resourceUsage.memory = Math.max(0, podNamespace.resourceUsage.memory - pod.resourceRequests.memory);
      podNamespace.updatedAt = new Date();
      logger.debug('Released evicted pod resources from namespace', {
        podId,
        namespace: pod.namespace,
      });
    }

    const updated = storeEvictPod(podId, reason);

    logger.info('Pod evicted successfully', {
      podId,
      nodeId: pod.nodeId,
      packId: pod.packId,
      namespace: pod.namespace,
      previousStatus,
      reason,
    });

    return {
      success: true,
      data: updated,
    };
  }

  /**
   * Fail all active pods on a node
   * Used when a node goes offline, becomes unhealthy, or is deleted
   * @param nodeId - The node ID
   * @param reason - Reason for failing the pods (e.g., 'Node went offline')
   * @returns Result with count of pods failed and their IDs
   */
  failPodsOnNode(
    nodeId: string,
    reason: string,
  ): PodOperationResult<{ failedCount: number; podIds: string[] }> {
    logger.debug('Attempting to fail all pods on node', { nodeId, reason });

    // Find all active pods on the node
    const podsOnNode = findPodsByNode(nodeId);
    const activeStatuses: PodStatus[] = ['pending', 'scheduled', 'starting', 'running', 'stopping'];
    const activePods = podsOnNode.filter(pod => activeStatuses.includes(pod.status));

    if (activePods.length === 0) {
      logger.debug('No active pods found on node', { nodeId });
      return {
        success: true,
        data: { failedCount: 0, podIds: [] },
      };
    }

    const failedPodIds: string[] = [];

    for (const pod of activePods) {
      const result = this.fail(pod.id, reason);
      if (result.success) {
        failedPodIds.push(pod.id);
      } else {
        logger.warn('Failed to mark pod as failed', {
          podId: pod.id,
          nodeId,
          error: result.error,
        });
      }
    }

    logger.info('Failed pods on node', {
      nodeId,
      reason,
      failedCount: failedPodIds.length,
      totalActive: activePods.length,
      podIds: failedPodIds,
    });

    return {
      success: true,
      data: { failedCount: failedPodIds.length, podIds: failedPodIds },
    };
  }

  /**
   * Rollback a pod to a different version of the same pack
   * @param podId - Pod ID
   * @param targetVersion - Target pack version to rollback to
   * @returns Rollback result with previous and new versions
   */
  rollback(podId: string, targetVersion: string): PodOperationResult<RollbackResult> {
    logger.debug('Attempting pod rollback', { podId, targetVersion });

    // Find the pod
    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Pod rollback failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    // Validate pod status - only allow rollback for scheduled, running, or starting pods
    const allowedStatuses: PodStatus[] = ['scheduled', 'running', 'starting'];
    if (!allowedStatuses.includes(pod.status)) {
      logger.warn('Pod rollback failed: invalid state', {
        podId,
        currentStatus: pod.status,
        allowedStatuses,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.INVALID_STATE,
          message: `Cannot rollback pod in status '${pod.status}'. Allowed statuses: ${allowedStatuses.join(', ')}`,
          details: { currentStatus: pod.status, allowedStatuses },
        },
      };
    }

    // Get the current pack
    const currentPack = findPackById(pod.packId);
    if (!currentPack) {
      logger.warn('Pod rollback failed: current pack not found', {
        podId,
        packId: pod.packId,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.PACK_NOT_FOUND,
          message: `Current pack not found: ${pod.packId}`,
        },
      };
    }

    const packName = currentPack.name;
    const previousVersion = pod.packVersion;

    // Check if target version is the same as current
    if (previousVersion === targetVersion) {
      logger.warn('Pod rollback failed: same version', {
        podId,
        version: targetVersion,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.SAME_VERSION,
          message: `Pod is already running version ${targetVersion}`,
          details: { currentVersion: previousVersion, targetVersion },
        },
      };
    }

    // Find the target version pack
    const targetPack = findPackByNameVersion(packName, targetVersion);
    if (!targetPack) {
      logger.warn('Pod rollback failed: target version not found', {
        podId,
        packName,
        targetVersion,
      });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.VERSION_NOT_FOUND,
          message: `Pack version ${packName}@${targetVersion} not found`,
          details: { packName, targetVersion },
        },
      };
    }

    // Check runtime compatibility with the node
    if (pod.nodeId !== null && pod.nodeId !== undefined && pod.nodeId !== '') {
      const node = clusterState.nodes.get(pod.nodeId);
      if (node && !isRuntimeCompatible(targetPack.runtimeTag, node.runtimeType)) {
        logger.warn('Pod rollback failed: runtime mismatch', {
          podId,
          nodeId: pod.nodeId,
          nodeRuntime: node.runtimeType,
          targetPackRuntime: targetPack.runtimeTag,
        });
        return {
          success: false,
          error: {
            code: PodSchedulerErrorCodes.RUNTIME_MISMATCH,
            message: `Target version ${targetVersion} is not compatible with node runtime '${node.runtimeType}'`,
            details: {
              nodeId: pod.nodeId,
              nodeRuntime: node.runtimeType,
              targetPackRuntime: targetPack.runtimeTag,
            },
          },
        };
      }
    }

    // Update the pod with the new pack ID and version
    const updatedPod = updatePod(pod.id, {
      // Note: we update packVersion but keep the same packId reference
      // In a real system, we might also update packId to point to the new version's pack ID
    });

    // Manually update pack version since updatePod doesn't handle it directly
    if (updatedPod) {
      const podWithNewVersion: Pod = {
        ...updatedPod,
        packId: targetPack.id,
        packVersion: targetVersion,
        updatedAt: new Date(),
      };
      clusterState.pods.set(pod.id, podWithNewVersion);
    }

    // Add history entry for the rollback
    addHistoryEntry(podId, 'rolled_back', undefined, {
      previousVersion,
      newVersion: targetVersion,
      previousPackId: currentPack.id,
      newPackId: targetPack.id,
    });

    logger.info('Pod rolled back successfully', {
      podId,
      packName,
      previousVersion,
      newVersion: targetVersion,
      previousPackId: currentPack.id,
      newPackId: targetPack.id,
      nodeId: pod.nodeId,
    });

    return {
      success: true,
      data: {
        podId,
        previousVersion,
        newVersion: targetVersion,
        packId: targetPack.id,
        packName,
      },
    };
  }

  /**
   * Delete a pod
   * @param podId - Pod ID
   * @returns true if deleted
   */
  delete(podId: string): PodOperationResult<boolean> {
    logger.debug('Attempting to delete pod', { podId });

    const pod = clusterState.pods.get(podId);
    if (!pod) {
      logger.warn('Pod deletion failed: pod not found', { podId });
      return {
        success: false,
        error: {
          code: PodSchedulerErrorCodes.POD_NOT_FOUND,
          message: `Pod not found: ${podId}`,
        },
      };
    }

    const podInfo = {
      podId,
      nodeId: pod.nodeId,
      packId: pod.packId,
      namespace: pod.namespace,
      status: pod.status,
    };

    // Release resources if pod was on a node
    if (pod.nodeId !== null && pod.nodeId !== undefined && pod.nodeId !== '' && ['running', 'scheduled', 'starting'].includes(pod.status)) {
      releaseResources(pod.nodeId, pod.resourceRequests.cpu, pod.resourceRequests.memory);
      logger.debug('Released deleted pod resources from node', {
        podId,
        nodeId: pod.nodeId,
      });
    }

    // Release resources from namespace
    const podNamespace = clusterState.namespaces.get(pod.namespace);
    if (podNamespace) {
      podNamespace.resourceUsage.pods = Math.max(0, podNamespace.resourceUsage.pods - 1);
      podNamespace.resourceUsage.cpu = Math.max(0, podNamespace.resourceUsage.cpu - pod.resourceRequests.cpu);
      podNamespace.resourceUsage.memory = Math.max(0, podNamespace.resourceUsage.memory - pod.resourceRequests.memory);
      podNamespace.updatedAt = new Date();
      logger.debug('Released deleted pod resources from namespace', {
        podId,
        namespace: pod.namespace,
      });
    }

    // Record deletion in history
    addHistoryEntry(podId, 'deleted');

    const deleted = removePod(podId);

    logger.info('Pod deleted successfully', podInfo);

    return {
      success: true,
      data: deleted,
    };
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Get a pod by ID
   * @param podId - Pod ID
   * @returns Pod or undefined
   */
  get(podId: string): Pod | undefined {
    return clusterState.pods.get(podId);
  }

  /**
   * Get a pod model by ID
   * @param podId - Pod ID
   * @returns PodModel or undefined
   */
  getModel(podId: string): PodModel | undefined {
    const pod = clusterState.pods.get(podId);
    if (!pod) {
      return undefined;
    }
    return new PodModel(pod, getPodHistory(podId));
  }

  /**
   * List pods with optional filters
   * @param filters - Optional filters
   * @returns Paginated pod list
   */
  list(filters: PodListFilters = {}): PodListResponse {
    let pods = [...clusterState.pods.values()];

    // Apply filters
    if (filters.packId !== undefined && filters.packId !== '') {
      pods = pods.filter(p => p.packId === filters.packId);
    }
    if (filters.nodeId !== undefined && filters.nodeId !== '') {
      pods = pods.filter(p => p.nodeId === filters.nodeId);
    }
    if (filters.namespace !== undefined && filters.namespace !== '') {
      pods = pods.filter(p => p.namespace === filters.namespace);
    }
    if (filters.status) {
      pods = pods.filter(p => p.status === filters.status);
    }
    if (filters.labelSelector) {
      pods = pods.filter(p =>
        matchesSelector(p.labels, { matchLabels: filters.labelSelector })
      );
    }

    const total = pods.length;
    const page = filters.page ?? 1;
    const pageSize = filters.pageSize ?? 20;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      pods: pods.slice(start, end),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Find pods by pack ID
   * @param packId - Pack ID
   * @returns Array of pods
   */
  findByPack(packId: string): Pod[] {
    return findPodsByPack(packId);
  }

  /**
   * Find pods by node ID
   * @param nodeId - Node ID
   * @returns Array of pods
   */
  findByNode(nodeId: string): Pod[] {
    return findPodsByNode(nodeId);
  }

  /**
   * Find pods by namespace
   * @param namespace - Namespace
   * @returns Array of pods
   */
  findByNamespace(namespace: string): Pod[] {
    return findPodsByNamespace(namespace);
  }

  /**
   * Find pods by status
   * @param status - Pod status
   * @returns Array of pods
   */
  findByStatus(status: PodStatus): Pod[] {
    return findPodsByStatus(status);
  }

  /**
   * Get pending pods sorted by priority
   * @returns Array of pending pods
   */
  getPendingByPriority(): Pod[] {
    return getPendingPodsByPriority();
  }

  /**
   * Get pod history
   * @param podId - Pod ID
   * @returns Array of history entries
   */
  getHistory(podId: string): PodHistoryEntry[] {
    return getPodHistory(podId);
  }
}

// ============================================================================
// Default Instance
// ============================================================================

/**
 * Default pod scheduler instance
 */
export const podScheduler = new PodScheduler();

/**
 * Create a new pod scheduler with custom options
 */
export function createPodScheduler(options?: PodSchedulerOptions): PodScheduler {
  return new PodScheduler(options);
}
