import type { AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import type { IHttpAdapter, HttpMethod, HttpAdapterConfig, HttpRequestOptions, HttpResponse } from '@stark-o/shared';
/**
 * Extended request config with metadata for timing.
 */
interface RequestConfigWithMetadata extends InternalAxiosRequestConfig {
    metadata?: {
        startTime: number;
    };
}
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
export type RequestInterceptor = (config: RequestConfigWithMetadata) => RequestConfigWithMetadata | Promise<RequestConfigWithMetadata>;
/**
 * Response interceptor function type.
 */
export type ResponseInterceptor = (response: AxiosResponse<unknown>) => AxiosResponse<unknown> | Promise<AxiosResponse<unknown>>;
/**
 * Error interceptor function type.
 */
export type ErrorInterceptor = (error: AxiosError<unknown>) => Promise<never> | never;
/**
 * HTTP adapter wrapping Axios for Node.js runtime.
 * Provides a unified HTTP client interface for pack execution.
 */
export declare class HttpAdapter implements IHttpAdapter {
    private readonly config;
    private readonly client;
    private initialized;
    private readonly requestInterceptorIds;
    private readonly responseInterceptorIds;
    constructor(config?: NodeHttpAdapterConfig);
    /**
     * Initialize the HTTP adapter.
     * Must be called before using any HTTP operations.
     */
    initialize(): Promise<void>;
    /**
     * Check if the adapter has been initialized.
     */
    isInitialized(): boolean;
    /**
     * Ensure the adapter is initialized before operations.
     */
    private ensureInitialized;
    /**
     * Add a request interceptor.
     * @param interceptor - Function to intercept and modify requests
     * @returns Interceptor ID for removal
     */
    addRequestInterceptor(interceptor: RequestInterceptor): number;
    /**
     * Remove a request interceptor.
     * @param id - Interceptor ID returned from addRequestInterceptor
     */
    removeRequestInterceptor(id: number): void;
    /**
     * Add a response interceptor.
     * @param interceptor - Function to intercept and modify responses
     * @param errorInterceptor - Optional function to handle errors
     * @returns Interceptor ID for removal
     */
    addResponseInterceptor(interceptor: ResponseInterceptor, errorInterceptor?: ErrorInterceptor): number;
    /**
     * Remove a response interceptor.
     * @param id - Interceptor ID returned from addResponseInterceptor
     */
    removeResponseInterceptor(id: number): void;
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
    request<T = unknown>(method: HttpMethod, url: string, data?: unknown, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
    /**
     * Execute a single HTTP request without retry logic.
     */
    private executeRequest;
    /**
     * Normalize various error types to HttpAdapterError.
     */
    private normalizeError;
    /**
     * Sleep for a specified duration.
     */
    private sleep;
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
    /**
     * Clean up all interceptors and reset the adapter.
     */
    dispose(): void;
}
/**
 * Create and initialize an HTTP adapter with the given configuration.
 * @param config - Adapter configuration
 * @returns Initialized HTTP adapter
 */
export declare function createHttpAdapter(config?: NodeHttpAdapterConfig): Promise<HttpAdapter>;
//# sourceMappingURL=http-adapter.d.ts.map