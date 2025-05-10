/**
 * apiClient.js — Extracted from globalUtils, dependency-injected, and logs via notify.js.
 * Handles deduplication, timeout, CSRF, JSON, and error reporting. No hardcoded route filter.
 *
 * Usage:
 *   import { createApiClient } from './apiClient.js';
 *   const apiClient = createApiClient({ ... });
 */

import { logEventToServer, maybeCapture } from './notifications-helpers.js';
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
export function createApiClient({ APP_CONFIG, globalUtils, getAuthModule, browserService }) {
  const pending = new Map();
  const BASE_URL = APP_CONFIG?.BASE_API_URL || '';

  return async function apiRequest(url, opts = {}, skipCache = false) {
    const method = (opts.method || "GET").toUpperCase();

    if (!skipCache && method === "GET" && globalUtils.shouldSkipDedup(url)) {
      skipCache = true;
    }

    const auth = getAuthModule?.();
    const fullUrl = globalUtils.isAbsoluteUrl(url) ? url : `${BASE_URL}${url}`;

    let normUrl;
    try {
      const base = browserService?.getLocationHref?.() || browserService?.windowObject?.location.origin;
      normUrl = globalUtils.normaliseUrl(fullUrl, base);
    } catch (err) {
      normUrl = fullUrl;
      if (APP_CONFIG?.DEBUG) {
        notify.warn(`[API] normaliseUrl failed for "${fullUrl}"`, {
          context: 'apiClient', module: 'ApiClient', source: 'apiRequest', originalError: err
        });
      }
    }

    const bodyKey =
      opts.body instanceof FormData
        ? `[form-data-${Date.now()}]`
        : globalUtils.stableStringify(opts.body || {});
    const key = `${method}-${normUrl}-${bodyKey}`;

    if (!skipCache && method === "GET" && pending.has(key)) {
      if (APP_CONFIG.DEBUG) notify.debug(`[API] Dedup hit: ${key}`);
      return pending.get(key);
    }

    opts.headers = { Accept: "application/json", ...(opts.headers || {}) };

    // CSRF token injection
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && auth?.getCSRFToken) {
      const csrf = auth.getCSRFToken();
      if (csrf) opts.headers["X-CSRF-Token"] = csrf;
      else if (APP_CONFIG.DEBUG) notify.warn(`[API] No CSRF for ${method} ${normUrl}`);
    }

    // JSON stringify body if plain object (not FormData)
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] ??= "application/json;charset=UTF-8";
      if (opts.headers["Content-Type"].includes("application/json")) {
        try {
          opts.body = JSON.stringify(opts.body);
        } catch (err) {
          notify.error("[API] Failed to stringify body", err);
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
          notify.debug(`[API] ${method} ${normUrl}`, {
            context: 'api',
            module: 'ApiClient',
            source: 'apiRequest',
            traceId: APP_CONFIG?.DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: APP_CONFIG?.DependencySystem?.generateTransactionId?.(),
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
            // eslint-disable-next-line no-console
            console.log("[AUTH DEBUG] /api/auth/verify response:", body);
            // eslint-disable-next-line no-console
            console.log("[AUTH DEBUG] /api/auth/verify headers:", headersObj);
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[AUTH DEBUG] Failed to log /api/auth/verify response", e);
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
          } catch {
            try {
              errPayload.raw = await resp.text();
            } catch (e) {
              notify.warn("[apiClient] (fallback) Failed to read response text", e);
            }
          }
          const e = new Error(errPayload.message);
          e.status = resp.status;
          e.data = errPayload;
          logEventToServer('error', errPayload.message, { status: resp.status, ...errPayload });
          maybeCapture(notify?.errorReporter, e, { url: normUrl, method });
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
        } catch {
          /* not JSON */
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
}
