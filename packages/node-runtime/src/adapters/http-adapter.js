// Stark Orchestrator - Node.js Runtime
// HTTP Client Adapter using Axios
import axios from 'axios';
import { HttpAdapterError } from '@stark-o/shared';
export { HttpAdapterError } from '@stark-o/shared';
/**
 * HTTP adapter wrapping Axios for Node.js runtime.
 * Provides a unified HTTP client interface for pack execution.
 */
export class HttpAdapter {
    config;
    client;
    initialized = false;
    requestInterceptorIds = [];
    responseInterceptorIds = [];
    constructor(config = {}) {
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
        this.client.interceptors.request.use((config) => {
            const configWithMeta = config;
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
    initialize() {
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
    isInitialized() {
        return this.initialized;
    }
    /**
     * Ensure the adapter is initialized before operations.
     */
    ensureInitialized() {
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
    addRequestInterceptor(interceptor) {
        const id = this.client.interceptors.request.use(interceptor);
        this.requestInterceptorIds.push(id);
        return id;
    }
    /**
     * Remove a request interceptor.
     * @param id - Interceptor ID returned from addRequestInterceptor
     */
    removeRequestInterceptor(id) {
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
    addResponseInterceptor(interceptor, errorInterceptor) {
        const id = this.client.interceptors.response.use(interceptor, errorInterceptor);
        this.responseInterceptorIds.push(id);
        return id;
    }
    /**
     * Remove a response interceptor.
     * @param id - Interceptor ID returned from addResponseInterceptor
     */
    removeResponseInterceptor(id) {
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
    async get(url, options) {
        return this.request('GET', url, undefined, options);
    }
    /**
     * Perform an HTTP POST request.
     * @param url - Request URL (relative to base URL)
     * @param data - Request body
     * @param options - Request options
     */
    async post(url, data, options) {
        return this.request('POST', url, data, options);
    }
    /**
     * Perform an HTTP PUT request.
     * @param url - Request URL (relative to base URL)
     * @param data - Request body
     * @param options - Request options
     */
    async put(url, data, options) {
        return this.request('PUT', url, data, options);
    }
    /**
     * Perform an HTTP PATCH request.
     * @param url - Request URL (relative to base URL)
     * @param data - Request body
     * @param options - Request options
     */
    async patch(url, data, options) {
        return this.request('PATCH', url, data, options);
    }
    /**
     * Perform an HTTP DELETE request.
     * @param url - Request URL (relative to base URL)
     * @param options - Request options
     */
    async delete(url, options) {
        return this.request('DELETE', url, undefined, options);
    }
    /**
     * Perform an HTTP HEAD request.
     * @param url - Request URL (relative to base URL)
     * @param options - Request options
     */
    async head(url, options) {
        return this.request('HEAD', url, undefined, options);
    }
    /**
     * Perform an HTTP OPTIONS request.
     * @param url - Request URL (relative to base URL)
     * @param options - Request options
     */
    async options(url, options) {
        return this.request('OPTIONS', url, undefined, options);
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
    async request(method, url, data, options) {
        this.ensureInitialized();
        const maxRetries = options?.maxRetries ?? this.config.maxRetries;
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.executeRequest(method, url, data, options);
                // Check if we should throw on error status
                const throwOnError = options?.throwOnError ?? true;
                if (throwOnError && (response.status < 200 || response.status >= 300)) {
                    throw new HttpAdapterError(`HTTP ${response.status}: ${response.statusText}`, {
                        status: response.status,
                        data: response.data,
                    });
                }
                return response;
            }
            catch (error) {
                lastError = this.normalizeError(error);
                // Check if we should retry
                const shouldRetry = attempt < maxRetries &&
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
    async executeRequest(method, url, data, options) {
        const config = {
            method,
            url,
            data,
            headers: options?.headers,
            params: options?.params,
            timeout: options?.timeout,
            responseType: options?.responseType,
            signal: options?.signal,
        };
        const response = await this.client.request(config);
        // Calculate request duration
        const configWithMeta = response.config;
        const startTime = configWithMeta.metadata?.startTime;
        const duration = typeof startTime === 'number' ? Date.now() - startTime : 0;
        // Normalize headers to a simple object
        const headers = {};
        const responseHeaders = response.headers;
        for (const [key, value] of Object.entries(responseHeaders)) {
            if (typeof value === 'string') {
                headers[key] = value;
            }
            else if (Array.isArray(value)) {
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
    normalizeError(error) {
        if (error instanceof HttpAdapterError) {
            return error;
        }
        if (axios.isAxiosError(error)) {
            const axiosError = error;
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
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    // ============================================
    // Utility Methods
    // ============================================
    /**
     * Set the authorization header.
     * @param token - Bearer token
     */
    setAuthToken(token) {
        this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    /**
     * Remove the authorization header.
     */
    clearAuthToken() {
        delete this.client.defaults.headers.common['Authorization'];
    }
    /**
     * Set a default header for all requests.
     * @param name - Header name
     * @param value - Header value
     */
    setDefaultHeader(name, value) {
        this.client.defaults.headers.common[name] = value;
    }
    /**
     * Remove a default header.
     * @param name - Header name
     */
    removeDefaultHeader(name) {
        delete this.client.defaults.headers.common[name];
    }
    /**
     * Update the base URL.
     * @param baseUrl - New base URL
     */
    setBaseUrl(baseUrl) {
        this.client.defaults.baseURL = baseUrl;
    }
    /**
     * Get the current base URL.
     */
    getBaseUrl() {
        return this.client.defaults.baseURL ?? '';
    }
    /**
     * Create an abort controller for request cancellation.
     * @returns AbortController instance
     */
    createAbortController() {
        return new AbortController();
    }
    // ============================================
    // Cleanup
    // ============================================
    /**
     * Clean up all interceptors and reset the adapter.
     */
    dispose() {
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
export async function createHttpAdapter(config) {
    const adapter = new HttpAdapter(config);
    await adapter.initialize();
    return adapter;
}
//# sourceMappingURL=http-adapter.js.map