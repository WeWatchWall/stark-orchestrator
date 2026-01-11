/**
 * Shared HTTP Adapter Interface for Stark Orchestrator
 *
 * This interface defines a unified HTTP client abstraction that can be
 * implemented by different runtimes (Node.js, Browser) using Axios.
 *
 * @module @stark-o/shared/types/http-adapter
 */

/**
 * HTTP method types supported by the adapter.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Configuration options for the HTTP adapter.
 */
export interface HttpAdapterConfig {
  /**
   * Base URL for all requests.
   * All request paths will be relative to this URL.
   */
  baseUrl?: string;

  /**
   * Default timeout in milliseconds.
   * @default 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Default headers to include in every request.
   */
  headers?: Record<string, string>;

  /**
   * Maximum number of automatic retries for failed requests.
   * @default 0 (no retries)
   */
  maxRetries?: number;

  /**
   * Delay between retries in milliseconds.
   * @default 1000
   */
  retryDelay?: number;

  /**
   * HTTP status codes that should trigger a retry.
   * @default [408, 429, 500, 502, 503, 504]
   */
  retryStatusCodes?: number[];
}

/**
 * Request options for individual HTTP requests.
 */
export interface HttpRequestOptions {
  /**
   * Request headers.
   */
  headers?: Record<string, string>;

  /**
   * Query parameters.
   */
  params?: Record<string, string | number | boolean | undefined>;

  /**
   * Request timeout in milliseconds (overrides default).
   */
  timeout?: number;

  /**
   * Response type.
   * @default 'json'
   */
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob';

  /**
   * Abort signal for request cancellation.
   */
  signal?: AbortSignal;

  /**
   * Whether to throw on non-2xx status codes.
   * @default true
   */
  throwOnError?: boolean;

  /**
   * Maximum number of retries for this specific request.
   * Overrides the adapter-level setting.
   */
  maxRetries?: number;
}

/**
 * HTTP response structure returned by the adapter.
 */
export interface HttpResponse<T = unknown> {
  /**
   * Response data.
   */
  data: T;

  /**
   * HTTP status code.
   */
  status: number;

  /**
   * HTTP status text.
   */
  statusText: string;

  /**
   * Response headers.
   */
  headers: Record<string, string>;

  /**
   * Request duration in milliseconds.
   */
  duration: number;
}

/**
 * Options for creating an HttpAdapterError.
 */
export interface HttpAdapterErrorOptions {
  status?: number;
  data?: unknown;
  code?: string;
  isTimeout?: boolean;
  isNetworkError?: boolean;
  isCancelled?: boolean;
  cause?: Error;
}

/**
 * HTTP error structure for failed requests.
 */
export class HttpAdapterError extends Error {
  /**
   * HTTP status code (if available).
   */
  readonly status?: number;

  /**
   * Response data (if available).
   */
  readonly data?: unknown;

  /**
   * Original error code.
   */
  readonly code?: string;

  /**
   * Whether this is a timeout error.
   */
  readonly isTimeout: boolean;

  /**
   * Whether this is a network error.
   */
  readonly isNetworkError: boolean;

  /**
   * Whether the request was cancelled.
   */
  readonly isCancelled: boolean;

  constructor(message: string, options: HttpAdapterErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'HttpAdapterError';
    this.status = options.status;
    this.data = options.data;
    this.code = options.code;
    this.isTimeout = options.isTimeout ?? false;
    this.isNetworkError = options.isNetworkError ?? false;
    this.isCancelled = options.isCancelled ?? false;
  }
}

/**
 * Unified HTTP adapter interface.
 *
 * This interface provides a consistent API for HTTP operations
 * across different runtime environments (Node.js and Browser).
 * Implementations should use Axios for maximum compatibility.
 */
export interface IHttpAdapter {
  // ============================================
  // Lifecycle Methods
  // ============================================

  /**
   * Initialize the HTTP adapter.
   * Must be called before using any HTTP operations.
   */
  initialize(): Promise<void>;

  /**
   * Check if the adapter has been initialized.
   */
  isInitialized(): boolean;

  // ============================================
  // Core HTTP Methods
  // ============================================

  /**
   * Perform an HTTP GET request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;

  /**
   * Perform an HTTP POST request.
   * @param url - Request URL (relative to base URL)
   * @param data - Request body
   * @param options - Request options
   */
  post<T = unknown>(url: string, data?: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>>;

  /**
   * Perform an HTTP PUT request.
   * @param url - Request URL (relative to base URL)
   * @param data - Request body
   * @param options - Request options
   */
  put<T = unknown>(url: string, data?: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>>;

  /**
   * Perform an HTTP PATCH request.
   * @param url - Request URL (relative to base URL)
   * @param data - Request body
   * @param options - Request options
   */
  patch<T = unknown>(url: string, data?: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>>;

  /**
   * Perform an HTTP DELETE request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  delete<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;

  /**
   * Perform an HTTP HEAD request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  head(url: string, options?: HttpRequestOptions): Promise<HttpResponse<void>>;

  /**
   * Perform an HTTP OPTIONS request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  options<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;

  /**
   * Perform a generic HTTP request.
   * @param method - HTTP method
   * @param url - Request URL (relative to base URL)
   * @param data - Request body (for POST, PUT, PATCH)
   * @param options - Request options
   */
  request<T = unknown>(
    method: HttpMethod,
    url: string,
    data?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>>;

  // ============================================
  // Configuration Methods
  // ============================================

  /**
   * Set the authorization header.
   * @param token - Bearer token
   */
  setAuthToken(token: string): void;

  /**
   * Remove the authorization header.
   */
  clearAuthToken(): void;

  /**
   * Set a default header for all requests.
   * @param name - Header name
   * @param value - Header value
   */
  setDefaultHeader(name: string, value: string): void;

  /**
   * Remove a default header.
   * @param name - Header name
   */
  removeDefaultHeader(name: string): void;

  /**
   * Update the base URL.
   * @param baseUrl - New base URL
   */
  setBaseUrl(baseUrl: string): void;

  /**
   * Get the current base URL.
   */
  getBaseUrl(): string;

  /**
   * Create an abort controller for request cancellation.
   * @returns AbortController instance
   */
  createAbortController(): AbortController;

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up resources and reset the adapter.
   */
  dispose(): void;
}
