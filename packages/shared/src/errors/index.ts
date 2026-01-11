/**
 * Error classes for Stark Orchestrator
 * @module @stark-o/shared/errors
 */

// Base error
export {
  StarkError,
  ErrorCode,
  isStarkError,
  wrapError,
} from './base-error';

export type { ErrorMeta } from './base-error';

// Validation errors
export {
  ValidationError,
  isValidationError,
  validResult,
  invalidResult,
} from './validation-error';

export type {
  ValidationErrorDetail,
  ValidationResult,
} from './validation-error';

// Auth errors
export {
  AuthenticationError,
  AuthorizationError,
  isAuthenticationError,
  isAuthorizationError,
  isAuthError,
} from './auth-error';

// Pod errors
export {
  PodError,
  isPodError,
  SchedulingFailures,
} from './pod-error';

export type {
  SchedulingFailureReason,
  ExecutionFailureDetails,
} from './pod-error';
