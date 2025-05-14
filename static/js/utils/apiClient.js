/**
 * apiClient.js — Handles API requests with deduplication, timeouts, CSRF, and JSON handling.
 *
 * Usage:
 *   import { createApiClient } from './apiClient.js';
 *   const apiClient = createApiClient({ ... });
 */

/**
 * createApiClient
 * @param {Object} opts
 * @param {Object} opts.APP_CONFIG
 * @param {Object} opts.globalUtils
 * @param {Object} opts.getAuthModule
 * @param {Object} opts.browserService
 * @returns {Function} apiRequest(url, opts, skipCache)
 */
export function createApiClient({
  APP_CONFIG,
  globalUtils,
  getAuthModule,
  browserService
}) {
  const pending = new Map();
  const BASE_URL = APP_CONFIG?.BASE_API_URL || '';

  // Define the main request function
  const mainApiRequest = async function apiRequest(url, opts = {}, skipCache = false) {
    const method = (opts.method || "GET").toUpperCase();

    if (!skipCache && method === "GET" && globalUtils.shouldSkipDedup(url)) {
      skipCache = true;
    }

    const auth = getAuthModule?.();
    let fullUrl = globalUtils.isAbsoluteUrl(url) ? url : `${BASE_URL}${url}`;

    // Handle opts.params for GET requests
    if (method === "GET" && opts.params && typeof opts.params === 'object') {
      const queryParams = new URLSearchParams(opts.params).toString();
      if (queryParams) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryParams;
      }
    }

    let normUrl;
    try {
      normUrl = globalUtils.normaliseUrl(fullUrl);
    } catch (err) {
      normUrl = fullUrl; // Fallback to fullUrl if normalization fails
    }

    const bodyKey =
      opts.body instanceof FormData
        ? `[form-data-${Date.now()}]`
        : globalUtils.stableStringify(opts.body || {});
    const key = `${method}-${normUrl}-${bodyKey}`;

    if (!skipCache && method === "GET" && pending.has(key)) {
      return pending.get(key);
    }

    opts.headers = { Accept: "application/json", ...(opts.headers || {}) };

    // CSRF token injection
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && auth?.getCSRFToken) {
      const csrf = auth.getCSRFToken();
      if (csrf) {
        opts.headers["X-CSRF-Token"] = csrf;
      }
    }

    // JSON stringify body if plain object (not FormData)
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] ??= "application/json;charset=UTF-8";
      if (opts.headers["Content-Type"].includes("application/json")) {
        try {
          opts.body = JSON.stringify(opts.body);
        } catch (err) {
          return Promise.reject(new Error("Failed to serialize request body."));
        }
      }
    }

    // Timeout via AbortController (browserService/DI if available)
    const AbortControllerImpl =
      (browserService?.getWindow?.() || browserService?.windowObject)?.AbortController
      || AbortController;
    const abortCtl = new AbortControllerImpl();
    opts.signal = abortCtl.signal;
    const apiTimeout = APP_CONFIG?.TIMEOUTS?.API_REQUEST || 15000;
    const timer = setTimeout(
      () => abortCtl.abort(new Error(`API Timeout (${apiTimeout}ms)`)),
      apiTimeout,
    );

    const p = (async () => {
      try {
        const resp = await (browserService?.fetch || fetch)(normUrl, opts);
        return resp;
      } finally {
        clearTimeout(timer);
        if (method === "GET") pending.delete(key);
      }
    })();

    if (!skipCache && method === "GET") pending.set(key, p);
    return p;
  };

  // Convenience verbs required by other callers
  mainApiRequest.post = (url, body = {}, opts = {}, skip = true) =>
    mainApiRequest(url, { ...opts, method: 'POST', body }, skip);
  mainApiRequest.get = (url, params = {}, opts = {}, skip = false) =>
    mainApiRequest(url, { ...opts, method: 'GET',  params }, skip);

  return mainApiRequest;
}
