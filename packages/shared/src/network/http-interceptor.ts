/**
 * HTTP Interceptor for Transparent Inter-Service Communication
 *
 * Monkey-patches `globalThis.fetch` and provides Axios interceptor adapters
 * so that pods can use any HTTP client/library to make service calls to
 * `*.internal` URLs without needing explicit `context.serviceCall()`.
 *
 * Outgoing requests to `http://{serviceId}.internal/{path}` are transparently
 * routed through the Stark networking layer (ServiceCaller → WebRTC).
 *
 * Works in both Node.js and browser environments (isomorphic).
 *
 * @module @stark-o/shared/network/http-interceptor
 */

import { parseInternalUrl } from '../types/network.js';
import type { ServiceCaller } from './service-caller.js';
import type { ServiceCallOptions, ServiceResponse } from '../types/network.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if a URL targets a Stark internal service.
 */
export function isInternalUrl(url: string): boolean {
  return parseInternalUrl(url) !== null;
}

/**
 * Normalise a possibly-relative URL against a base URL.
 * Returns the combined URL string.
 */
function resolveUrl(base: string | undefined, path: string): string {
  if (!base) return path;
  // Avoid double slashes
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

// ── Fetch Interceptor (Isomorphic) ──────────────────────────────────────────

let _originalFetch: typeof globalThis.fetch | null = null;

/**
 * Monkey-patch `globalThis.fetch` to intercept `*.internal` URLs.
 * Non-internal URLs pass through to the original fetch unchanged.
 *
 * @example
 * ```ts
 * interceptFetch(serviceCaller);
 *
 * // This now routes transparently through Stark:
 * const res = await fetch('http://users-service.internal/api/users');
 * const data = await res.json();
 *
 * // This still goes to the real internet:
 * const ext = await fetch('https://api.example.com/data');
 * ```
 */
export function interceptFetch(serviceCaller: ServiceCaller): void {
  if (_originalFetch) {
    console.log('[stark:fetch] ⚠️ interceptFetch called but already patched — skipping');
    return;
  }
  _originalFetch = globalThis.fetch;
  console.log('[stark:fetch] ✅ Patching globalThis.fetch for *.internal interception');

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    const isInternal = isInternalUrl(url);
    console.log(`[stark:fetch] 🔍 fetch("${url}") → internal=${isInternal}`);

    if (!isInternal) {
      console.log(`[stark:fetch] ➡️ Passing through to native fetch: ${url}`);
      return _originalFetch!(input, init);
    }

    console.log(`[stark:fetch] 🎯 Intercepting internal URL: ${url}`);

    // Route through ServiceCaller
    const method = (init?.method?.toUpperCase() ?? 'GET') as ServiceCallOptions['method'];
    let body: unknown;
    if (init?.body) {
      if (typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      } else {
        body = init.body;
      }
    }

    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [key, value] of init.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, init.headers);
      }
    }

    console.log(`[stark:fetch] 📤 Calling serviceCaller.call() for ${url}`, { method, hasBody: !!body });

    try {
      const serviceResponse = await serviceCaller.call(url, {
        method,
        body,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      console.log(`[stark:fetch] 📥 ServiceCaller returned status=${serviceResponse.status} for ${url}`);
      return serviceResponseToFetchResponse(serviceResponse);
    } catch (err) {
      console.error(`[stark:fetch] ❌ ServiceCaller.call() threw for ${url}:`, err);
      throw err;
    }
  };
}

/**
 * Restore the original `globalThis.fetch` function.
 */
export function restoreFetch(): void {
  if (_originalFetch) {
    globalThis.fetch = _originalFetch;
    _originalFetch = null;
  }
}

/**
 * Convert a Stark ServiceResponse to a standard fetch Response object.
 */
function serviceResponseToFetchResponse(res: ServiceResponse): Response {
  const bodyStr = res.body !== undefined ? JSON.stringify(res.body) : null;
  const responseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...(res.headers ?? {}),
  };

  return new Response(bodyStr, {
    status: res.status,
    statusText: statusTextForCode(res.status),
    headers: responseHeaders,
  });
}

function statusTextForCode(code: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return map[code] ?? `Status ${code}`;
}

// ── Axios Interceptor ───────────────────────────────────────────────────────

/**
 * Create an Axios request interceptor configuration that transparently routes
 * `*.internal` URLs through the Stark ServiceCaller.
 *
 * Usage with a per-pod Axios instance:
 * ```ts
 * import axios from 'axios';
 * const interceptor = createAxiosStarkInterceptor(serviceCaller);
 * axios.interceptors.request.use(interceptor.requestInterceptor);
 * ```
 *
 * Usage with the global Axios instance (patches all requests):
 * ```ts
 * installAxiosInterceptor(axios, serviceCaller);
 * ```
 *
 * After installation, any Axios request to `*.internal` is routed through Stark:
 * ```ts
 * const res = await axios.post('http://echo.internal/echo', { hello: 'world' });
 * // Transparently goes through WebRTC pod-to-pod communication
 * ```
 */
export function createAxiosStarkInterceptor(serviceCaller: ServiceCaller) {
  return {
    /**
     * Axios request interceptor. Detects `.internal` URLs and short-circuits
     * the request by overriding the adapter to return the ServiceCaller response.
     */
    requestInterceptor: async (config: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const fullUrl = resolveUrl(config.baseURL as string | undefined, (config.url as string) ?? '');
      if (!isInternalUrl(fullUrl)) return config;

      const actualUrl = fullUrl.startsWith('http') ? fullUrl : `http://${fullUrl}`;
      const method = ((config.method as string)?.toUpperCase() ?? 'GET') as ServiceCallOptions['method'];

      // Extract headers, filtering out undefined values
      let headers: Record<string, string> | undefined;
      if (config.headers && typeof config.headers === 'object') {
        const filtered: Record<string, string> = {};
        for (const [k, v] of Object.entries(config.headers as Record<string, unknown>)) {
          if (v !== undefined && v !== null) filtered[k] = String(v);
        }
        if (Object.keys(filtered).length > 0) headers = filtered;
      }

      const serviceResponse = await serviceCaller.call(actualUrl, {
        method,
        body: config.data as unknown,
        headers,
      });

      // Override the adapter so Axios doesn't make a real HTTP request.
      // Instead it returns our ServiceCaller response directly.
      config.adapter = () => {
        return Promise.resolve({
          data: serviceResponse.body,
          status: serviceResponse.status,
          statusText: statusTextForCode(serviceResponse.status),
          headers: serviceResponse.headers ?? {},
          config,
        });
      };

      return config;
    },
  };
}

/**
 * Install the Stark interceptor on an Axios instance.
 * Returns the interceptor ID so it can be removed later.
 *
 * @example
 * ```ts
 * import axios from 'axios';
 * const id = installAxiosInterceptor(axios, serviceCaller);
 * // Later:
 * axios.interceptors.request.eject(id);
 * ```
 */
export function installAxiosInterceptor(
  axiosInstance: { interceptors: { request: { use: (fn: Function) => number } } },
  serviceCaller: ServiceCaller,
): number {
  const { requestInterceptor } = createAxiosStarkInterceptor(serviceCaller);
  return axiosInstance.interceptors.request.use(requestInterceptor as (...args: unknown[]) => unknown);
}

// ── Combined Setup / Teardown ───────────────────────────────────────────────

export interface InterceptorHandles {
  /** Restore fetch to its original implementation */
  restoreFetch: () => void;
  /** Axios interceptor ID (if installed) — eject with `axios.interceptors.request.eject(id)` */
  axiosInterceptorId?: number;
}

/**
 * Install all outbound HTTP interceptors for a pod.
 * Patches `globalThis.fetch` and optionally installs an Axios interceptor.
 *
 * @param serviceCaller - The pod's ServiceCaller instance
 * @param axiosInstance - Optional Axios instance to patch
 * @returns Handles for tearing down interceptors
 */
export function installOutboundInterceptors(
  serviceCaller: ServiceCaller,
  axiosInstance?: { interceptors: { request: { use: (fn: Function) => number } } },
): InterceptorHandles {
  interceptFetch(serviceCaller);

  let axiosInterceptorId: number | undefined;
  if (axiosInstance) {
    axiosInterceptorId = installAxiosInterceptor(axiosInstance, serviceCaller);
  }

  return {
    restoreFetch,
    axiosInterceptorId,
  };
}
