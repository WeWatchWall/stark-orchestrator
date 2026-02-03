/**
 * Stark Orchestrator Core Package
 * Isomorphic core with Vue reactivity for state management
 * @module @stark-o/core
 */

// Re-export types from shared
export * from './types';

// Export reactive stores
export * from './stores';

// Export models
export * from './models';

// Export services
export * from './services';

// Export query modules for chaos testing and external access
export * from './queries';

// Export Vue reactivity utilities for consumers
export {
  ref,
  reactive,
  computed,
  watch,
  shallowRef,
  shallowReactive,
  toRef,
  toRefs,
  isRef,
  isReactive,
  isProxy,
  type Ref,
  type ComputedRef,
  type ShallowRef,
  type UnwrapRef,
  type WatchOptions,
  type WatchCallback,
} from '@vue/reactivity';
