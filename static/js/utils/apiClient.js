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
  errorReporter,
  backendLogger         // Add backendLogger parameter
}) {
  /* strict no-op fall-backs */
  notify = notify || { debug(){}, info(){}, warn(){}, error(){} };
  // Guard-rail #15 – contextual notifier for every subsequent call
  const apiNotify = (notify?.withContext)
    ? notify.withContext({ module: 'ApiClient', context: 'apiRequest' })
    : notify;
  errorReporter = errorReporter || null;
  backendLogger = backendLogger || null; // Add fallback
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
      // Use the imported normaliseUrl from browserService.js
      // It takes only one argument.
      normUrl = browserServiceNormaliseUrl(fullUrl);
    } catch (err) {
      // Fallback or error handling if normaliseUrl itself throws, though it has its own try/catch.
      normUrl = fullUrl; // Fallback to fullUrl if normalization fails catastrophically
      if (APP_CONFIG?.DEBUG) {
        apiNotify.warn(`[API] URL normalization failed for "${fullUrl}", using raw URL.`, {
          source: 'urlNormalizationFailure', originalError: err
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
      if (APP_CONFIG.DEBUG) apiNotify.debug(`[API] Dedup hit: ${key}`, { source:'dedupHit' });
      return pending.get(key);
    }

    opts.headers = { Accept: "application/json", ...(opts.headers || {}) };

    // CSRF token injection
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && auth?.getCSRFToken) {
      const csrf = auth.getCSRFToken();
      if (csrf) {
        opts.headers["X-CSRF-Token"] = csrf;
      } else if (
        APP_CONFIG.DEBUG &&
        // Suppress noisy CSRF warnings for /api/log_notification and /api/log_notification_batch (these endpoints are exempt from CSRF by backend policy)
        !/^\/api\/log_notification(_batch)?$/.test(
          new URL(normUrl, window.location.origin).pathname
        )
      ) {
        apiNotify.warn(`[API] No CSRF for ${method} ${normUrl}`, { source:'csrfTokenMissing' });
      }
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
            source: 'stringifyBodyFailure'
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
            source: 'requestInitiated',
            extra: { httpMethod: method, url: normUrl, hasBody: !!opts.body }
          });

        const resp = await (browserService?.fetch || fetch)(normUrl, opts);

        // Log failed responses
        if (!resp.ok) {
          const errorText = await resp.text().catch(() => 'Failed to read error response');
          apiNotify.error(`API error: ${resp.status} ${resp.statusText}`, {
            source: 'requestFailed',
            extra: { url: normUrl, status: resp.status, responseText: errorText, httpMethod: method }
          });

          // Log to backend
          if (backendLogger?.log) {
            backendLogger.log({
              level: 'error',
              module: 'ApiClient',
              context: 'apiRequest',
              message: `API error: ${resp.status} ${resp.statusText}`,
              extra: { url: normUrl, status: resp.status }
            });
          }
        }

        return resp;
      } finally {
        clearTimeout(timer);
        if (!skipCache && method === "GET") pending.delete(key);
      }
    })();

    if (!skipCache && method === "GET") pending.set(key, p);
    return p;
  };

  // Convenience verbs required by BackendLogger / other callers
  mainApiRequest.post = (url, body = {}, opts = {}, skip = true) =>
    mainApiRequest(url, { ...opts, method: 'POST', body }, skip);
  mainApiRequest.get = (url, params = {}, opts = {}, skip = false) =>
    mainApiRequest(url, { ...opts, method: 'GET',  params }, skip);

  return mainApiRequest;
}
