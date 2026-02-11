/**
 * API Module
 *
 * Re-exports all REST API routers and handlers
 * @module @stark-o/server/api
 */

// Central API Router
export {
  createApiRouter,
  healthCheck,
  readinessCheck,
  livenessCheck,
  requestLoggingMiddleware,
  errorHandlingMiddleware,
  notFoundHandler,
  type ApiRouterOptions,
} from './router.js';

// Pack API
export {
  createPacksRouter,
  registerPack,
  listPacks,
  getPackById,
  listPackVersions,
  updatePack,
  deletePack,
} from './packs.js';

// Pod API
export {
  createPodsRouter,
  createPod,
  listPods as listPodsHandler,
  getPodById as getPodByIdHandler,
  getPodStatus,
  getPodHistory,
  deletePod as deletePodHandler,
} from './pods.js';

// Node API
export {
  createNodesRouter,
  registerNode,
  listNodes,
  getNodeById,
  getNodeByName,
  updateNode,
  deleteNode,
} from './nodes.js';

// Auth API
export {
  createAuthRouter,
  register,
  login,
  logout,
  setupStatus,
  setup,
  createUser,
  listUsers as listUsersHandler,
} from './auth.js';

// Namespace API
export {
  createNamespacesRouter,
  createNamespace,
  listNamespaces,
  getNamespaceById,
  getNamespaceByName,
  updateNamespace,
  deleteNamespace,
  deleteNamespaceByName,
  getNamespaceQuota,
} from './namespaces.js';

// Config API
export {
  createConfigRouter,
  getConfig,
  putConfig,
} from './config.js';

// Service API
export {
  createServicesRouter,
  servicesRouter,
} from './services.js';

// Secrets API
export {
  createSecretsRouter,
} from './secrets.js';
