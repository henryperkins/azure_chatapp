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
    const { returnFullResponse = false, ...restOpts } = opts;
    const method = (restOpts.method || "GET").toUpperCase();

    if (!skipCache && method === "GET" && globalUtils.shouldSkipDedup(url)) {
      skipCache = true;
    }

    const auth = getAuthModule?.();
    let fullUrl = globalUtils.isAbsoluteUrl(url) ? url : `${BASE_URL}${url}`;

    // Handle restOpts.params for GET requests
    if (method === "GET" && restOpts.params && typeof restOpts.params === 'object') {
      const queryParams = new browserService.URLSearchParams(restOpts.params)
        .toString();
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
      restOpts.body instanceof FormData
        ? `[form-data-${Date.now()}]`
        : globalUtils.stableStringify(restOpts.body || {});
    const key = `${method}-${normUrl}-${bodyKey}`;

    if (!skipCache && method === "GET" && pending.has(key)) {
      return pending.get(key);
    }

    restOpts.headers = { Accept: "application/json", ...(restOpts.headers || {}) };
    // Always send cookies unless caller over-rides
    if (!('credentials' in restOpts)) restOpts.credentials = 'include';

    // CSRF token injection
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && auth?.getCSRFToken) {
      const csrf = auth.getCSRFToken();
      if (csrf) {
        restOpts.headers["X-CSRF-Token"] = csrf;
      } else if (auth?.logger && typeof auth.logger.warn === "function") {
        auth.logger.warn("[apiClient] Missing CSRF token for " + normUrl, { context: "apiClient:csrf" });
      }
    }

    // JSON stringify body if plain object (not FormData)
    if (restOpts.body && typeof restOpts.body === "object" && !(restOpts.body instanceof FormData)) {
      restOpts.headers["Content-Type"] ??= "application/json;charset=UTF-8";
      if (restOpts.headers["Content-Type"].includes("application/json")) {
        try {
          restOpts.body = JSON.stringify(restOpts.body);
        } catch (err) {
          return Promise.reject(new Error("Failed to serialize request body."));
        }
      }
    }

    // Timeout via AbortController (browserService/DI if available)
    const AbortControllerImpl =
      browserService.getWindow()?.AbortController
      ?? (()=>{ throw new Error('[apiClient] AbortController unavailable via DI'); })();
    const abortCtl = new AbortControllerImpl();
    restOpts.signal = abortCtl.signal;
    const apiTimeout = APP_CONFIG?.TIMEOUTS?.API_REQUEST || 15000;
    const timer = browserService.setTimeout(
      () => abortCtl.abort(new Error(`API Timeout (${apiTimeout}ms)`)),
      apiTimeout,
    );

    const p = (async () => {
      try {
        if (!browserService?.fetch) throw new Error('[apiClient] browserService.fetch unavailable');
        const resp = await browserService.fetch(normUrl, restOpts);

        // ---------- NEW unified response handling ----------
        const contentType = resp.headers.get('content-type') || '';
        let payload = null;

        if (resp.status !== 204) {                // 204 = No-Content
          if (contentType.includes('application/json')) {
            try { payload = await resp.json(); } catch { payload = null; }
          } else {
            try { payload = await resp.text(); } catch { payload = null; }
          }
        }

        if (resp.ok) {                     // 2xx
          if (returnFullResponse) {
            return {
              data   : payload,                       // may be null
              status : resp.status,
              headers: Object.fromEntries(resp.headers.entries())
            };
          }
          return payload;                  // <- what callers will receive
        }

        // ----- non-OK: throw rich error object -----
        // Preserve backend-provided details so callers can display them
        const humanMsg =
          (payload?.detail) ? String(payload.detail) :
          (typeof payload === 'string') ? payload :
          (payload?.message) ? String(payload.message) :
          `HTTP ${resp.status}`;

        const err = new Error(humanMsg);
        err.status = resp.status;
        err.data   = payload;          // keep full payload for callers
        throw err;
      } finally {
        browserService.clearTimeout(timer);
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

  mainApiRequest.fetch = mainApiRequest; // Expose the main function as .fetch
  return mainApiRequest;
}
