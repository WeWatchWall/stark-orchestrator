/**
 * AppConfig types for application-level settings
 * @module @stark-o/shared/types/app-config
 */

/**
 * Application configuration
 */
export interface AppConfig {
  /** Unique identifier (UUID) */
  id: string;
  /** Config name */
  name: string;
  /** Whether public registration is enabled */
  enablePublicRegistration: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * App config update input
 */
export interface UpdateAppConfigInput {
  enablePublicRegistration?: boolean;
}

/**
 * Default app configuration
 */
export const DEFAULT_APP_CONFIG: Omit<AppConfig, 'id' | 'createdAt' | 'updatedAt'> = {
  name: 'default',
  enablePublicRegistration: false,
};
