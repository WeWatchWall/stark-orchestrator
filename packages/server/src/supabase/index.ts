/**
 * Supabase Module
 *
 * Re-exports all Supabase-related functionality
 */

export {
  // Configuration
  type SupabaseConfig,
  getSupabaseConfig,
  validateSupabaseConfig,

  // Client factories
  createSupabaseClient,
  createSupabaseServiceClient,
  createSupabaseUserClient,

  // Singleton getters
  getSupabaseClient,
  getSupabaseServiceClient,
  resetSupabaseClients,

  // Default instances
  supabase,
  supabaseAdmin,
} from './client.js';

// Pack queries
export {
  type PackResult,
  PackQueries,
  getPackQueries,
  getPackQueriesAdmin,
  resetPackQueries,
  createPack,
  getPackById,
  getPackByNameAndVersion,
  getLatestPackVersion,
  listPacks,
  listPackVersions,
  updatePack,
  deletePack,
  deletePackByName,
  packExists,
  countPacks,
} from './packs.js';

// Pod queries
export {
  type PodResult,
  PodQueries,
  getPodQueries,
  getPodQueriesAdmin,
  resetPodQueries,
  createPod,
  getPodById,
  listPods,
  listActivePods,
  listPendingPods,
  updatePod,
  updatePodStatus,
  schedulePod,
  startPod,
  stopPod,
  failPod,
  evictPod,
  deletePod,
  deletePodsInNamespace,
  countPods,
  createPodHistory,
  getPodHistory,
  getLatestPodHistoryEntry,
} from './pods.js';

// Node queries
export {
  type NodeResult,
  NodeQueries,
  getNodeQueries,
  resetNodeQueries,
} from './nodes.js';

// Storage operations
export {
  STORAGE_BUCKETS,
  type StorageResult,
  type StorageError,
  type UploadResult,
  type DownloadResult,
  type SignedUrlResult,
  type FileMetadata,
  StorageQueries,
  getStorageQueries,
  getStorageQueriesWithClient,
  resetStorageQueries,
  uploadPackBundle,
  downloadPackBundle,
  createPackBundleSignedUrl,
  deletePackBundle,
  packBundleExists,
  generatePackBundlePath,
} from './storage.js';

// Pod history service (integrated pod operations with history tracking)
export {
  type StatusChangeOptions,
  PodHistoryService,
  schedulePodWithHistory,
  startPodWithHistory,
  stopPodWithHistory,
  failPodWithHistory,
  evictPodWithHistory,
  restartPodWithHistory,
  updatePodStatusWithHistory,
  rollbackPodWithHistory,
  deletePodWithHistory,
  getFullPodHistory,
  getLatestHistoryEntry,
} from './pod-history-service.js';

// Auth operations
export {
  type AuthResult,
  type AuthQueries,
  SupabaseAuthProvider,
  UserQueries,
  getAuthProvider,
  getAuthQueries,
  getUserQueries,
  resetAuthSingletons,
  registerUser,
  loginUser,
  logoutUser,
  refreshSession,
  verifyToken,
  getUserById,
  getUserByEmail,
  listUsers,
  userExists,
  updateUserRoles,
} from './auth.js';

// Namespace queries
export {
  type NamespaceResult,
  type ListNamespacesOptions,
  NamespaceQueries,
  getNamespaceQueries,
  getNamespaceQueriesAdmin,
  resetNamespaceQueries,
  createNamespace,
  getNamespaceById,
  getNamespaceByName,
  listNamespaces,
  listNamespaceItems,
  countNamespaces,
  updateNamespace,
  deleteNamespace,
  deleteNamespaceByName,
  namespaceExists,
  getNamespaceQuotaInfo,
  incrementNamespaceUsage,
  decrementNamespaceUsage,
  markNamespaceForDeletion,
} from './namespaces.js';

// App config queries
export {
  type AppConfigResult,
  getAppConfig,
  updateAppConfig,
  isPublicRegistrationEnabled,
} from './app-config.js';
