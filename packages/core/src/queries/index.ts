/**
 * Query Modules Index
 *
 * Exports all query modules for easy access by chaos scenarios
 * and other services.
 * @module @stark-o/core/queries
 */

export { nodeQueries, type nodeQueries as NodeQueries } from './node-queries';
export { podQueries, type podQueries as PodQueries } from './pod-queries';
export { packQueries, type packQueries as PackQueries } from './pack-queries';
export {
  serviceQueries,
  type ServiceInfo,
  type ChaosServiceStatus,
} from './service-queries';
export { clusterQueries } from './cluster-queries';

// Re-export individual functions for convenience
export * from './node-queries';
export * from './pod-queries';
export * from './pack-queries';
export * from './service-queries';
export * from './cluster-queries';
