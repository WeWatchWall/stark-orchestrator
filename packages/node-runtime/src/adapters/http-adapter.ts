// Stark Orchestrator - Node.js Runtime
// HTTP Client Adapter using Axios

import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  IHttpAdapter,
  HttpMethod,
  HttpAdapterConfig,
  HttpRequestOptions,
  HttpResponse,
} from '@stark-o/shared';
import { HttpAdapterError } from '@stark-o/shared';

/**
 * Extended request config with metadata for timing.
 */
interface RequestConfigWithMetadata extends InternalAxiosRequestConfig {
  metadata?: {
    startTime: number;
  };
}

// Re-export shared types for convenience
export type { HttpMethod, HttpAdapterConfig, HttpRequestOptions, HttpResponse } from '@stark-o/shared';
export { HttpAdapterError } from '@stark-o/shared';

/**
 * Extended configuration options for the Node.js HTTP adapter.
 * Adds Node.js specific options like SSL validation.
 */
export interface NodeHttpAdapterConfig extends HttpAdapterConfig {
  /**
   * Whether to validate SSL certificates.
   * @default true
   */
  validateSsl?: boolean;
}

/**
 * Extended request options for Node.js HTTP adapter.
 * Adds Node.js specific options like stream response type.
 */
export interface NodeHttpRequestOptions extends Omit<HttpRequestOptions, 'responseType'> {
  /**
   * Response type (includes Node.js specific 'stream').
   * @default 'json'
   */
  responseType?: 'json' | 'text' | 'arraybuffer' | 'blob' | 'stream';
}

/**
 * Request interceptor function type.
 */
export type RequestInterceptor = (
  config: RequestConfigWithMetadata
) => RequestConfigWithMetadata | Promise<RequestConfigWithMetadata>;

/**
 * Response interceptor function type.
 */
export type ResponseInterceptor = (
  response: AxiosResponse<unknown>
) => AxiosResponse<unknown> | Promise<AxiosResponse<unknown>>;

/**
 * Error interceptor function type.
 */
export type ErrorInterceptor = (error: AxiosError<unknown>) => Promise<never> | never;

/**
 * HTTP adapter wrapping Axios for Node.js runtime.
 * Provides a unified HTTP client interface for pack execution.
 */
export class HttpAdapter implements IHttpAdapter {
  private readonly config: Required<NodeHttpAdapterConfig>;
  private readonly client: AxiosInstance;
  private initialized: boolean = false;
  private readonly requestInterceptorIds: number[] = [];
  private readonly responseInterceptorIds: number[] = [];

  constructor(config: NodeHttpAdapterConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl ?? '',
      timeout: config.timeout ?? 30000,
      headers: config.headers ?? {},
      maxRetries: config.maxRetries ?? 0,
      retryDelay: config.retryDelay ?? 1000,
      retryStatusCodes: config.retryStatusCodes ?? [408, 429, 500, 502, 503, 504],
      validateSsl: config.validateSsl ?? true,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: this.config.headers,
      validateStatus: () => true, // Handle all status codes manually
    });

    // Add timing interceptor
    this.client.interceptors.request.use((config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      const configWithMeta = config as RequestConfigWithMetadata;
      configWithMeta.metadata = {
        startTime: Date.now(),
      };
      return configWithMeta;
    });
  }

  /**
   * Initialize the HTTP adapter.
   * Must be called before using any HTTP operations.
   */
  initialize(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }

    // Perform any async initialization (e.g., validate base URL connectivity)
    this.initialized = true;
    return Promise.resolve();
  }

  /**
   * Check if the adapter has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure the adapter is initialized before operations.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new HttpAdapterError('HttpAdapter not initialized. Call initialize() first.');
    }
  }

  // ============================================
  // Request Interceptors
  // ============================================

  /**
   * Add a request interceptor.
   * @param interceptor - Function to intercept and modify requests
   * @returns Interceptor ID for removal
   */
  addRequestInterceptor(interceptor: RequestInterceptor): number {
    const id = this.client.interceptors.request.use(interceptor);
    this.requestInterceptorIds.push(id);
    return id;
  }

  /**
   * Remove a request interceptor.
   * @param id - Interceptor ID returned from addRequestInterceptor
   */
  removeRequestInterceptor(id: number): void {
    this.client.interceptors.request.eject(id);
    const index = this.requestInterceptorIds.indexOf(id);
    if (index > -1) {
      this.requestInterceptorIds.splice(index, 1);
    }
  }

  /**
   * Add a response interceptor.
   * @param interceptor - Function to intercept and modify responses
   * @param errorInterceptor - Optional function to handle errors
   * @returns Interceptor ID for removal
   */
  addResponseInterceptor(
    interceptor: ResponseInterceptor,
    errorInterceptor?: ErrorInterceptor
  ): number {
    const id = this.client.interceptors.response.use(interceptor, errorInterceptor);
    this.responseInterceptorIds.push(id);
    return id;
  }

  /**
   * Remove a response interceptor.
   * @param id - Interceptor ID returned from addResponseInterceptor
   */
  removeResponseInterceptor(id: number): void {
    this.client.interceptors.response.eject(id);
    const index = this.responseInterceptorIds.indexOf(id);
    if (index > -1) {
      this.responseInterceptorIds.splice(index, 1);
    }
  }

  // ============================================
  // Core HTTP Methods
  // ============================================

  /**
   * Perform an HTTP GET request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  async get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, options);
  }

  /**
   * Perform an HTTP POST request.
   * @param url - Request URL (relative to base URL)
   * @param data - Request body
   * @param options - Request options
   */
  async post<T = unknown>(
    url: string,
    data?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T>('POST', url, data, options);
  }

  /**
   * Perform an HTTP PUT request.
   * @param url - Request URL (relative to base URL)
   * @param data - Request body
   * @param options - Request options
   */
  async put<T = unknown>(
    url: string,
    data?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T>('PUT', url, data, options);
  }

  /**
   * Perform an HTTP PATCH request.
   * @param url - Request URL (relative to base URL)
   * @param data - Request body
   * @param options - Request options
   */
  async patch<T = unknown>(
    url: string,
    data?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T>('PATCH', url, data, options);
  }

  /**
   * Perform an HTTP DELETE request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  async delete<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', url, undefined, options);
  }

  /**
   * Perform an HTTP HEAD request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  async head(url: string, options?: HttpRequestOptions): Promise<HttpResponse<void>> {
    return this.request<void>('HEAD', url, undefined, options);
  }

  /**
   * Perform an HTTP OPTIONS request.
   * @param url - Request URL (relative to base URL)
   * @param options - Request options
   */
  async options<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('OPTIONS', url, undefined, options);
  }

  // ============================================
  // Generic Request Method
  // ============================================

  /**
   * Perform a generic HTTP request.
   * @param method - HTTP method
   * @param url - Request URL (relative to base URL)
   * @param data - Request body (for POST, PUT, PATCH)
   * @param options - Request options
   */
  async request<T = unknown>(
    method: HttpMethod,
    url: string,
    data?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    this.ensureInitialized();

    const maxRetries = options?.maxRetries ?? this.config.maxRetries;
    let lastError: HttpAdapterError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.executeRequest<T>(method, url, data, options);

        // Check if we should throw on error status
        const throwOnError = options?.throwOnError ?? true;
        if (throwOnError && (response.status < 200 || response.status >= 300)) {
          throw new HttpAdapterError(`HTTP ${response.status}: ${response.statusText}`, {
            status: response.status,
            data: response.data,
          });
        }

        return response;
      } catch (error) {
        lastError = this.normalizeError(error);

        // Check if we should retry
        const shouldRetry =
          attempt < maxRetries &&
          !lastError.isCancelled &&
          (lastError.isTimeout ||
            lastError.isNetworkError ||
            (lastError.status !== undefined &&
              this.config.retryStatusCodes.includes(lastError.status)));

        if (shouldRetry) {
          // Wait before retrying with exponential backoff
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          await this.sleep(delay);
          continue;
        }

        throw lastError;
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError ?? new HttpAdapterError('Request failed');
  }

  /**
   * Execute a single HTTP request without retry logic.
   */
  private async executeRequest<T>(
    method: HttpMethod,
    url: string,
    data?: unknown,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    const config: AxiosRequestConfig = {
      method,
      url,
      data,
      headers: options?.headers,
      params: options?.params,
      timeout: options?.timeout,
      responseType: options?.responseType,
      signal: options?.signal,
    };

    const response: AxiosResponse<T> = await this.client.request<T>(config);

    // Calculate request duration
    const configWithMeta = response.config as RequestConfigWithMetadata;
    const startTime = configWithMeta.metadata?.startTime;
    const duration = typeof startTime === 'number' ? Date.now() - startTime : 0;

    // Normalize headers to a simple object
    const headers: Record<string, string> = {};
    const responseHeaders = response.headers as Record<string, string | string[] | undefined>;
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      }
    }

    return {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers,
      duration,
    };
  }

  /**
   * Normalize various error types to HttpAdapterError.
   */
  private normalizeError(error: unknown): HttpAdapterError {
    if (error instanceof HttpAdapterError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<unknown>;

      return new HttpAdapterError(axiosError.message ?? 'Request failed', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
        code: axiosError.code,
        isTimeout: axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT',
        isNetworkError: axiosError.code === 'ERR_NETWORK' || axiosError.response === undefined,
        isCancelled: axios.isCancel(error),
        cause: axiosError,
      });
    }

    if (error instanceof Error) {
      return new HttpAdapterError(error.message, { cause: error });
    }

    return new HttpAdapterError(String(error));
  }

  /**
   * Sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Set the authorization header.
   * @param token - Bearer token
   */
  setAuthToken(token: string): void {
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  /**
   * Remove the authorization header.
   */
  clearAuthToken(): void {
    delete this.client.defaults.headers.common['Authorization'];
  }

  /**
   * Set a default header for all requests.
   * @param name - Header name
   * @param value - Header value
   */
  setDefaultHeader(name: string, value: string): void {
    this.client.defaults.headers.common[name] = value;
  }

  /**
   * Remove a default header.
   * @param name - Header name
   */
  removeDefaultHeader(name: string): void {
    delete this.client.defaults.headers.common[name];
  }

  /**
   * Update the base URL.
   * @param baseUrl - New base URL
   */
  setBaseUrl(baseUrl: string): void {
    this.client.defaults.baseURL = baseUrl;
  }

  /**
   * Get the current base URL.
   */
  getBaseUrl(): string {
    return this.client.defaults.baseURL ?? '';
  }

  /**
   * Create an abort controller for request cancellation.
   * @returns AbortController instance
   */
  createAbortController(): AbortController {
    return new AbortController();
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up all interceptors and reset the adapter.
   */
  dispose(): void {
    // Remove all request interceptors
    for (const id of this.requestInterceptorIds) {
      this.client.interceptors.request.eject(id);
    }
    this.requestInterceptorIds.length = 0;

    // Remove all response interceptors
    for (const id of this.responseInterceptorIds) {
      this.client.interceptors.response.eject(id);
    }
    this.responseInterceptorIds.length = 0;

    this.initialized = false;
  }
}

/**
 * Create and initialize an HTTP adapter with the given configuration.
 * @param config - Adapter configuration
 * @returns Initialized HTTP adapter
 */
export async function createHttpAdapter(config?: NodeHttpAdapterConfig): Promise<HttpAdapter> {
  const adapter = new HttpAdapter(config);
  await adapter.initialize();
  return adapter;
}
