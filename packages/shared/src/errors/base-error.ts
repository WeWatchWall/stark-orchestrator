/**
 * Base error class with error codes
 * @module @stark-o/shared/errors/base-error
 */

/**
 * Error codes for categorization
 */
export enum ErrorCode {
  // General errors (1xxx)
  UNKNOWN = 1000,
  INTERNAL = 1001,
  NOT_IMPLEMENTED = 1002,
  TIMEOUT = 1003,
  CANCELLED = 1004,

  // Validation errors (2xxx)
  VALIDATION_FAILED = 2000,
  INVALID_INPUT = 2001,
  MISSING_REQUIRED_FIELD = 2002,
  INVALID_FORMAT = 2003,
  OUT_OF_RANGE = 2004,
  CONSTRAINT_VIOLATION = 2005,

  // Authentication errors (3xxx)
  AUTHENTICATION_REQUIRED = 3000,
  INVALID_CREDENTIALS = 3001,
  TOKEN_EXPIRED = 3002,
  TOKEN_INVALID = 3003,
  SESSION_EXPIRED = 3004,

  // Authorization errors (4xxx)
  FORBIDDEN = 4000,
  INSUFFICIENT_PERMISSIONS = 4001,
  ROLE_REQUIRED = 4002,
  RESOURCE_ACCESS_DENIED = 4003,

  // Resource errors (5xxx)
  NOT_FOUND = 5000,
  ALREADY_EXISTS = 5001,
  CONFLICT = 5002,
  GONE = 5003,
  RESOURCE_EXHAUSTED = 5004,

  // Pod errors (6xxx)
  POD_SCHEDULING_FAILED = 6000,
  POD_START_FAILED = 6001,
  POD_EXECUTION_FAILED = 6002,
  POD_TIMEOUT = 6003,
  POD_NOT_FOUND = 6004,
  POD_ALREADY_RUNNING = 6005,
  POD_EVICTED = 6006,

  // Node errors (7xxx)
  NODE_NOT_FOUND = 7000,
  NODE_OFFLINE = 7001,
  NODE_UNHEALTHY = 7002,
  NODE_CAPACITY_EXCEEDED = 7003,
  NO_AVAILABLE_NODES = 7004,
  NODE_REGISTRATION_FAILED = 7005,

  // Pack errors (8xxx)
  PACK_NOT_FOUND = 8000,
  PACK_VERSION_NOT_FOUND = 8001,
  PACK_ALREADY_EXISTS = 8002,
  PACK_INVALID_BUNDLE = 8003,
  PACK_RUNTIME_MISMATCH = 8004,
  PACK_UPLOAD_FAILED = 8005,

  // Namespace errors (9xxx)
  NAMESPACE_NOT_FOUND = 9000,
  NAMESPACE_QUOTA_EXCEEDED = 9001,
  NAMESPACE_LIMIT_VIOLATION = 9002,
  NAMESPACE_RESERVED = 9003,
  NAMESPACE_TERMINATING = 9004,

  // Cluster errors (10xxx)
  CLUSTER_UNHEALTHY = 10000,
  CLUSTER_CAPACITY_EXCEEDED = 10001,
  SCHEDULER_UNAVAILABLE = 10002,
}

/**
 * Error metadata for additional context
 */
export interface ErrorMeta {
  /** Resource type involved */
  resourceType?: string;
  /** Resource ID involved */
  resourceId?: string;
  /** Field that caused the error */
  field?: string;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Base error class for all Stark Orchestrator errors
 */
export class StarkError extends Error {
  /** Error code for categorization */
  public readonly code: ErrorCode;
  /** HTTP status code equivalent */
  public readonly statusCode: number;
  /** Error metadata */
  public readonly meta: ErrorMeta;
  /** Timestamp when error occurred */
  public readonly timestamp: Date;
  /** Correlation ID for tracing */
  public correlationId?: string;
  /** Original error if this wraps another */
  public readonly cause?: Error;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN,
    meta: ErrorMeta = {},
    cause?: Error,
  ) {
    super(message);
    this.name = 'StarkError';
    this.code = code;
    this.meta = meta;
    this.timestamp = new Date();
    this.cause = cause;
    this.statusCode = this.getStatusCode(code);

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Map error code to HTTP status code
   */
  private getStatusCode(code: ErrorCode): number {
    const codeCategory = Math.floor(code / 1000);

    switch (codeCategory) {
      case 1: // General
        return 500;
      case 2: // Validation
        return 400;
      case 3: // Authentication
        return 401;
      case 4: // Authorization
        return 403;
      case 5: // Resource
        if (code === ErrorCode.NOT_FOUND || code === ErrorCode.GONE) {
          return 404;
        }
        if (code === ErrorCode.ALREADY_EXISTS || code === ErrorCode.CONFLICT) {
          return 409;
        }
        return 400;
      case 6: // Pod
      case 7: // Node
      case 8: // Pack
      case 9: // Namespace
      case 10: // Cluster
        if (code.toString().includes('NOT_FOUND')) {
          return 404;
        }
        return 400;
      default:
        return 500;
    }
  }

  /**
   * Set correlation ID for tracing
   */
  withCorrelationId(correlationId: string): this {
    this.correlationId = correlationId;
    return this;
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        meta: this.meta,
        timestamp: this.timestamp.toISOString(),
        correlationId: this.correlationId,
      },
    };
  }

  /**
   * Convert to log-friendly format
   */
  toLog(): Record<string, unknown> {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      meta: this.meta,
      timestamp: this.timestamp.toISOString(),
      correlationId: this.correlationId,
      stack: this.stack,
      cause: this.cause?.message,
    };
  }

  /**
   * Check if this is a client error (4xx)
   */
  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /**
   * Check if this is a server error (5xx)
   */
  isServerError(): boolean {
    return this.statusCode >= 500;
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return [
      ErrorCode.TIMEOUT,
      ErrorCode.INTERNAL,
      ErrorCode.NODE_UNHEALTHY,
      ErrorCode.SCHEDULER_UNAVAILABLE,
    ].includes(this.code);
  }
}

/**
 * Check if an error is a StarkError
 */
export function isStarkError(error: unknown): error is StarkError {
  return error instanceof StarkError;
}

/**
 * Wrap an unknown error as a StarkError
 */
export function wrapError(error: unknown, code: ErrorCode = ErrorCode.UNKNOWN): StarkError {
  if (isStarkError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new StarkError(error.message, code, {}, error);
  }

  return new StarkError(String(error), code);
}
