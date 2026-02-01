/**
 * Validation error class
 * @module @stark-o/shared/errors/validation-error
 */

import { StarkError, ErrorCode, ErrorMeta } from './base-error';

/**
 * Validation error detail
 */
export interface ValidationErrorDetail {
  /** Field that failed validation */
  field: string;
  /** Error message */
  message: string;
  /** Validation rule that failed */
  rule?: string;
  /** Expected value/format */
  expected?: string;
  /** Actual value received */
  received?: unknown;
}

/**
 * Validation error for input validation failures
 */
export class ValidationError extends StarkError {
  /** Validation error details */
  public readonly details: ValidationErrorDetail[];

  constructor(
    message: string,
    details: ValidationErrorDetail[] = [],
    meta: ErrorMeta = {},
  ) {
    super(message, ErrorCode.VALIDATION_FAILED, meta);
    this.name = 'ValidationError';
    this.details = details;
  }

  /**
   * Create from a single field error
   */
  static field(
    field: string,
    message: string,
    rule?: string,
  ): ValidationError {
    return new ValidationError(`Validation failed for field: ${field}`, [
      { field, message, rule },
    ]);
  }

  /**
   * Create for a required field
   */
  static required(field: string): ValidationError {
    return new ValidationError(`Missing required field: ${field}`, [
      { field, message: 'This field is required', rule: 'required' },
    ], { field }).withCode(ErrorCode.MISSING_REQUIRED_FIELD);
  }

  /**
   * Create for an invalid format
   */
  static invalidFormat(
    field: string,
    expected: string,
    received?: unknown,
  ): ValidationError {
    return new ValidationError(`Invalid format for field: ${field}`, [
      { field, message: `Expected ${expected}`, rule: 'format', expected, received },
    ], { field }).withCode(ErrorCode.INVALID_FORMAT);
  }

  /**
   * Create for an out of range value
   */
  static outOfRange(
    field: string,
    min?: number,
    max?: number,
    received?: number,
  ): ValidationError {
    let message = `Value out of range for field: ${field}`;
    let expected = '';

    if (min !== undefined && max !== undefined) {
      expected = `between ${min} and ${max}`;
    } else if (min !== undefined) {
      expected = `at least ${min}`;
    } else if (max !== undefined) {
      expected = `at most ${max}`;
    }

    return new ValidationError(message, [
      { field, message: `Expected value ${expected}`, rule: 'range', expected, received },
    ], { field }).withCode(ErrorCode.OUT_OF_RANGE);
  }

  /**
   * Create from multiple field errors
   */
  static multiple(errors: ValidationErrorDetail[]): ValidationError {
    const fieldNames = errors.map(e => e.field).join(', ');
    return new ValidationError(
      `Validation failed for fields: ${fieldNames}`,
      errors,
    );
  }

  /**
   * Create for a constraint violation
   */
  static constraint(
    message: string,
    field?: string,
  ): ValidationError {
    const details: ValidationErrorDetail[] = field
      ? [{ field, message, rule: 'constraint' }]
      : [];
    return new ValidationError(message, details, { field })
      .withCode(ErrorCode.CONSTRAINT_VIOLATION);
  }

  /**
   * Override error code
   */
  private withCode(code: ErrorCode): this {
    (this as { code: ErrorCode }).code = code;
    return this;
  }

  /**
   * Add a validation error detail
   */
  addDetail(detail: ValidationErrorDetail): this {
    this.details.push(detail);
    return this;
  }

  /**
   * Check if a specific field has an error
   */
  hasFieldError(field: string): boolean {
    return this.details.some(d => d.field === field);
  }

  /**
   * Get errors for a specific field
   */
  getFieldErrors(field: string): ValidationErrorDetail[] {
    return this.details.filter(d => d.field === field);
  }

  /**
   * Convert to JSON for API responses
   */
  override toJSON(): Record<string, unknown> {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        details: this.details,
        meta: this.meta,
        timestamp: this.timestamp.toISOString(),
        correlationId: this.correlationId,
      },
    };
  }
}

/**
 * Check if an error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Validation result type
 */
export type ValidationResult<T> = 
  | { valid: true; value: T }
  | { valid: false; error: ValidationError };

/**
 * Create a successful validation result
 */
export function validResult<T>(value: T): ValidationResult<T> {
  return { valid: true, value };
}

/**
 * Create a failed validation result
 */
export function invalidResult<T>(error: ValidationError): ValidationResult<T> {
  return { valid: false, error };
}
