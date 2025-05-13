/**
 * apiClient.js — Extracted from globalUtils, dependency-injected, and logs via notify.js.
 * Handles deduplication, timeout, CSRF, JSON, and error reporting. No hardcoded route filter.
 *
 * Usage:
 *   import { createApiClient } from './apiClient.js';
 *   const apiClient = createApiClient({ ... });
 */

import { logEventToServer, maybeCapture } from './notifications-helpers.js';
import { normaliseUrl as browserServiceNormaliseUrl } from './browserService.js'; // Import corrected function
// NOTE: notify must be injected, not imported. Remove this import to avoid hidden coupling.

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
  browserService,
  notify,
  errorReporter         // ← new DI param
}) {
  /* strict no-op fall-backs                                    */
  notify        = notify        || { debug(){}, info(){}, warn(){}, error(){} };
  // Guard-rail #15 – contextual notifier for every subsequent call
  const apiNotify = (notify?.withContext)
    ? notify.withContext({ module: 'ApiClient', context: 'apiRequest' })
    : notify;
  errorReporter = errorReporter || null;
  const pending = new Map();
  const BASE_URL = APP_CONFIG?.BASE_API_URL || '';

  return async function apiRequest(url, opts = {}, skipCache = false) {
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
      // Use the imported normaliseUrl from browserService.js
      // It takes only one argument.
      normUrl = browserServiceNormaliseUrl(fullUrl);
    } catch (err) {
      // Fallback or error handling if normaliseUrl itself throws, though it has its own try/catch.
      normUrl = fullUrl; // Fallback to fullUrl if normalization fails catastrophically
      if (APP_CONFIG?.DEBUG) {
        notify.warn(`[API] URL normalization failed for "${fullUrl}", using raw URL.`, {
          context: 'apiClient', module: 'ApiClient', source: 'apiRequest', originalError: err
        });
      }
      if (errorReporter?.capture) {
        errorReporter.capture(err, {
          module: 'ApiClient',
          method: 'apiRequest',
          source: 'urlNormalization',
          originalError: err
        });
      }
    }

    const bodyKey =
      opts.body instanceof FormData
        ? `[form-data-${Date.now()}]`
        : globalUtils.stableStringify(opts.body || {});
    const key = `${method}-${normUrl}-${bodyKey}`;

    if (!skipCache && method === "GET" && pending.has(key)) {
      if (APP_CONFIG.DEBUG) apiNotify.debug(`[API] Dedup hit: ${key}`, { module: 'ApiClient', source:'dedup' });
      return pending.get(key);
    }

    opts.headers = { Accept: "application/json", ...(opts.headers || {}) };

    // CSRF token injection
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && auth?.getCSRFToken) {
      const csrf = auth.getCSRFToken();
      if (csrf) opts.headers["X-CSRF-Token"] = csrf;
      else if (APP_CONFIG.DEBUG) apiNotify.warn(`[API] No CSRF for ${method} ${normUrl}`, { module: 'ApiClient', source:'csrf' });
    }

    // JSON stringify body if plain object (not FormData)
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] ??= "application/json;charset=UTF-8";
      if (opts.headers["Content-Type"].includes("application/json")) {
        try {
          opts.body = JSON.stringify(opts.body);
        } catch (err) {
          apiNotify.error("[API] Failed to stringify body", {
            originalError: err,
            module: 'ApiClient',
            context: 'apiClient',
            source: 'stringifyBody'
          });
          if (errorReporter?.capture) {
            errorReporter.capture(err, {
              module: 'ApiClient',
              method: 'apiRequest',
              source: 'stringifyBody',
              originalError: err
            });
          }
          return Promise.reject(new Error("Failed to serialize request body."));
        }
      }
    }

    // Timeout via AbortController (browserService/DI if available)
    const AbortControllerImpl = browserService?.windowObject?.AbortController || AbortController;
    const abortCtl = new AbortControllerImpl();
    opts.signal = abortCtl.signal;
    const apiTimeout = APP_CONFIG?.TIMEOUTS?.API_REQUEST || 15000;
    const timer = setTimeout(
      () => abortCtl.abort(new Error(`API Timeout (${apiTimeout}ms)`)),
      apiTimeout,
    );

    const p = (async () => {
      try {
        if (APP_CONFIG.DEBUG)
          apiNotify.debug(`[API] ${method} ${normUrl}`, {
            context: 'api',
            module: 'ApiClient',
            source: 'request',
            /* trace helpers removed to avoid hidden globals */
            extra: { hasBody: !!opts.body }
          });

        const resp = await (browserService?.fetch || fetch)(normUrl, opts);

        // Debug log for /api/auth/verify
        if (normUrl.includes('/api/auth/verify')) {
          try {
            const clone = resp.clone();
            const cType = clone.headers.get("content-type") || "";
            let body;
            if (cType.includes("application/json")) body = await clone.json();
            else body = await clone.text();
            const headersObj = {};
            for (const [k, v] of clone.headers.entries()) headersObj[k] = v;
            apiNotify.debug("[AUTH DEBUG] /api/auth/verify response", { module: 'ApiClient', source: 'authDebug', extra: body });
            apiNotify.debug("[AUTH DEBUG] /api/auth/verify headers",  { module: 'ApiClient', source: 'authDebug', extra: headersObj });
          } catch (e) {
            apiNotify.warn("[AUTH DEBUG] Failed to log /api/auth/verify response", {
              originalError: e,
              module: 'ApiClient',
              context: 'authDebug',
              source: 'authDebug'
            });
            if (errorReporter?.capture) {
              errorReporter.capture(e, {
                module: 'ApiClient',
                method: 'apiRequest',
                source: 'authDebug',
                originalError: e
              });
            }
          }
        }

        if (!resp.ok) {
          let errPayload = { message: `API Error: ${resp.status} ${resp.statusText}` };
          try {
            const json = await resp.clone().json();
            const detail = json.detail || json.message;
            if (detail)
              errPayload.message = typeof detail === "string" ? detail : JSON.stringify(detail);
            Object.assign(errPayload, json);
          } catch (jsonErr) {
            if (errorReporter?.capture) {
              errorReporter.capture(jsonErr, {
                module: 'ApiClient',
                method: 'apiRequest',
                source: 'parseErrorPayloadJson',
                originalError: jsonErr
              });
            }
            try {
              errPayload.raw = await resp.text();
            } catch (e) {
              apiNotify.warn("[apiClient] (fallback) Failed to read response text", {
                originalError: e,
                module: 'ApiClient',
                context: 'errorReadFallback',
                source: 'errorReadFallback'
              });
              if (errorReporter?.capture) {
                errorReporter.capture(e, {
                  module: 'ApiClient',
                  method: 'apiRequest',
                  source: 'errorReadFallback',
                  originalError: e
                });
              }
            }
          }
          const e = new Error(errPayload.message);
          e.status = resp.status;
          e.data = errPayload;
          logEventToServer('error', errPayload.message, { status: resp.status, ...errPayload });
          maybeCapture(errorReporter, e, { url: normUrl, method });
          throw e;
        }

        if (resp.status === 204 || resp.headers.get("content-length") === "0") return undefined;

        const cType = resp.headers.get("content-type") || "";
        if (cType.includes("application/json")) {
          const json = await resp.json();
          return json?.status === "success" && "data" in json ? json.data : json;
        }

        const rawText = await resp.text();
        try {
          const json = JSON.parse(rawText);
          return json?.status === "success" && "data" in json ? json.data : json;
        } catch (parseErr) {
          /* not JSON */
          if (errorReporter?.capture) {
            errorReporter.capture(parseErr, {
              module: 'ApiClient',
              method: 'apiRequest',
              source: 'parseRawText',
              originalError: parseErr
            });
          }
        }
        return rawText;
      } finally {
        clearTimeout(timer);
        if (!skipCache && method === "GET") pending.delete(key);
      }
    })();

    if (!skipCache && method === "GET") pending.set(key, p);
    return p;
  };

  // Convenience verbs required by BackendLogger / other callers
  apiRequest.post = (url, body = {}, opts = {}, skip = true) =>
    apiRequest(url, { ...opts, method: 'POST', body }, skip);
  apiRequest.get = (url, params = {}, opts = {}, skip = false) =>
    apiRequest(url, { ...opts, method: 'GET',  params }, skip);

  return apiRequest;
}
