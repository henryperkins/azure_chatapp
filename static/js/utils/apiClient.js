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
  browserService,
  eventHandlers,
  logger
}) {
  // Dependency validation (MANDATORY for factories)
  if (!APP_CONFIG) throw new Error('[apiClient] Missing APP_CONFIG dependency');
  if (!globalUtils) throw new Error('[apiClient] Missing globalUtils dependency');
  if (!getAuthModule) throw new Error('[apiClient] Missing getAuthModule dependency');
  if (!browserService) throw new Error('[apiClient] Missing browserService dependency');
  if (!eventHandlers) throw new Error('[apiClient] Missing eventHandlers dependency');
  if (typeof eventHandlers.cleanupListeners !== "function") throw new Error('[apiClient] eventHandlers.cleanupListeners is required');
  if (!logger) throw new Error('[apiClient] Missing logger dependency');

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
      logger.error('[apiClient] URL normalization failed', err, { context: 'apiClient:normaliseUrl', url: fullUrl });
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

    // Inject Authorization header if auth module provides it and caller hasn't set it explicitly
    if (auth) {
      try {
        if (typeof auth.getAuthHeader === 'function') {
          const authHeaderObj = auth.getAuthHeader();
          if (
            authHeaderObj &&
            authHeaderObj.Authorization &&
            !restOpts.headers["Authorization"]
          ) {
            restOpts.headers["Authorization"] = authHeaderObj.Authorization;
          }
        } else if (typeof auth.getAccessToken === 'function') {
          const token = auth.getAccessToken();
          if (token && !restOpts.headers["Authorization"]) {
            restOpts.headers["Authorization"] = `Bearer ${token}`;
          }
        }
        /* ------------------------------------------------------------------
         * Fallback: If user appears authenticated but still no Authorization
         * header, attempt to fetch a token from the DependencySystem's
         * storageService – accessed via the global namespace to avoid an
         * undeclared identifier error under ESLint's no-undef rule.
         * ------------------------------------------------------------------ */
        const globalDS = globalThis?.DependencySystem;
        const userSeemsAuthed =
          !restOpts.headers["Authorization"] &&
          ((typeof auth.hasAuthCookies === "function" && auth.hasAuthCookies()) ||
            globalDS?.modules?.get?.('appModule')?.state?.isAuthenticated);
        if (userSeemsAuthed) {
          const storageService = globalDS?.modules?.get?.('storageService');
          const storageTok = storageService?.getItem?.('access_token');
          if (storageTok) {
            restOpts.headers["Authorization"] = `Bearer ${storageTok}`;
          }
        }
      } catch (err) {
        logger.error('[apiClient] Failed to inject Authorization header', err, {
          context: 'apiClient:authHeader'
        });
      }
    }

    // Diagnostic: warn only if the header is missing *and* no auth cookies exist
    // Suppress warning for CSRF and login/verify endpoints (expected to be unauthenticated)
    const isCsrfOrAuthInit =
      /\/api\/auth\/csrf\b/.test(normUrl) ||
      /\/api\/auth\/(login|register|verify)\b/.test(normUrl);
    if (
      !restOpts.headers["Authorization"] &&
      !(auth?.hasAuthCookies?.() === true)
    ) {
      if (isCsrfOrAuthInit) {
        logger.info(
          '[apiClient] Authorization header/cookie missing (this is normal for CSRF/login/register/verify endpoints)',
          { url: normUrl, context: 'apiClient:authHeader:missing:init' }
        );
      } else {
        logger.warn(
          '[apiClient] Authorization header missing and no auth cookies present',
          { url: normUrl, context: 'apiClient:authHeader:missing:noCookie' }
        );
      }
    }
    // CSRF token injection
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && auth?.getCSRFToken) {
      // Set log delivery context if this is a request to /api/logs
      const isLogDelivery = /\/api\/logs\b/.test(normUrl);
      if (isLogDelivery && auth.setLogDeliveryContext) {
        auth.setLogDeliveryContext(true);
      }

      const csrf = auth.getCSRFToken();

      if (isLogDelivery && auth.setLogDeliveryContext) {
        auth.setLogDeliveryContext(false);
      }

      if (csrf) {
        restOpts.headers["X-CSRF-Token"] = csrf;
      } else if (!isLogDelivery && auth?.logger && typeof auth.logger.warn === "function") {
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
          logger.error('[apiClient] Failed to serialize request body.', err, { context: 'apiClient:jsonStringify', url: normUrl });
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
      let resp;
      let payload = null;
      let contentType = '';
      try {
        if (!browserService?.fetch) throw new Error('[apiClient] browserService.fetch unavailable');
        resp = await browserService.fetch(normUrl, restOpts);

        /* --------------------------------------------------------
         *  Binary / file download handling
         * --------------------------------------------------------
         *  A caller can force binary mode by passing
         *     { responseType: 'blob' }   or  'arrayBuffer'
         *  OR the code auto-detects when the server sets
         *  `Content-Disposition: attachment`.
         * ------------------------------------------------------ */
        const wantsBlob =
          restOpts.responseType === 'blob' ||
          resp.headers.get('content-disposition')?.includes('attachment');

        const wantsArrayBuffer = restOpts.responseType === 'arrayBuffer';

        if (wantsBlob || wantsArrayBuffer) {
          const data = wantsArrayBuffer ? await resp.arrayBuffer() : await resp.blob();
          if (!resp.ok) {
            const err = new Error(`HTTP ${resp.status}`);
            err.status = resp.status;
            err.data = data;
            throw err;
          }
          return data;
        }

        // ---------- NEW unified response handling ----------
        contentType = resp.headers.get('content-type') || '';

        // ------------------------------------------------------------------
        // Special-case handling for 204 No-Content responses
        // ------------------------------------------------------------------
        // When the backend returns HTTP 204 the body is empty, causing the
        // previous implementation to propagate a `null` payload.  Down-stream
        // callers such as ProjectManager.loadProjectDetails expect a *truthy*
        // response object and will otherwise raise
        // “Null or undefined response from server …”.
        //
        // To maintain compatibility while still signalling “no content” we now
        // resolve with an **empty object** (or a structured full-response
        // wrapper when `returnFullResponse` is requested).  This preserves the
        // successful control-flow without forcing every caller to add explicit
        // null-checks for 204 responses.
        // ------------------------------------------------------------------
        if (resp.status === 204) {
          if (returnFullResponse) {
            return {
              data: {},
              status: resp.status,
              headers: Object.fromEntries(resp.headers.entries()),
            };
          }
          return {}; // <- canonical empty payload for 204 success
        }

        if (resp.status !== 204) { // 204 = No-Content
          if (contentType.includes('application/json')) {
            try {
              payload = await resp.json();
            } catch (err) {
              logger.error(
                '[apiClient] JSON parse error in API response',
                err,
                { context: 'apiClient:jsonParse', url: normUrl, status: resp.status }
              );
              /* Propagate the parsing failure so callers can react properly
                 instead of receiving a "null" payload that triggers opaque
                 downstream errors like "Null or undefined response". */
              throw err;
            }
          } else {
            try {
              payload = await resp.text();
            } catch (err) {
              logger.error(
                '[apiClient] Text parse error in API response',
                err,
                { context: 'apiClient:textParse', url: normUrl, status: resp.status }
              );
              /* Surface the error to the caller for consistent handling */
              throw err;
            }
          }
        }

        if (resp.ok) { // 2xx
          // --------------------------------------------------------------
          // Enforce JSON responses for all `/api/` endpoints unless the
          // caller explicitly opts-in via `opts.allowNonJsonResponse`.
          // This prevents HTML redirect pages (added by browsers or
          // extensions) from being handed to business-logic code that expects
          // JSON and subsequently fails deep down the stack.
          // --------------------------------------------------------------

          /* Hardened: also match URLs where “/api/” appears after a leading
             run of “?” characters or additional query params (e.g. “??project=…”). */
          const expectsJson =
            /([?&].*?)?\/api\//.test(normUrl) &&
            !restOpts.allowNonJsonResponse;

          if (expectsJson && !contentType.includes('application/json')) {
            const err = new Error('Non-JSON payload received for API endpoint');
            err.status = resp.status;
            err.data = payload;
            logger.error('[apiClient] Expected application/json but received', err, {
              context: 'apiClient:unexpectedContentType',
              url: normUrl,
              contentType,
            });
            throw err;
          }

          // ---- final return --------------------------------------------------
          if (returnFullResponse) {
            return {
              data: payload ?? {},
              status: resp.status,
              headers: Object.fromEntries(resp.headers.entries()),
            };
          }
          // For 204 and similar cases ensure callers receive an object, not null.
          return payload ?? {};
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
        err.data = payload;

        // Prevent recursive logger/apiClient loop for logger delivery
        if (!/\/api\/logs\b/.test(normUrl)) {
          logger.error('[apiClient] API response not OK', err, { context: 'apiClient:apiError', url: normUrl, status: resp.status, payload });
        }

        throw err;
      } catch (outerErr) {
        // Prevent recursive logger/apiClient loop for logger delivery
        if (!/\/api\/logs\b/.test(normUrl)) {
          logger.error('[apiClient] Unexpected API error', outerErr, { context: 'apiClient:outerCatch', url: normUrl, method, opts: restOpts });
        } else {
          // Only output to console, not logger, for log delivery failures
          (browserService?.getWindow?.()?.console ?? console).error('[apiClient] Failed to deliver log to /api/logs', outerErr);
        }
        throw outerErr;
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

  // Expose cleanup
  const cleanup = () => {
    pending.clear();
    eventHandlers.cleanupListeners({ context: "apiClient" });
  };

  return {
    fetch: mainApiRequest,
    get: mainApiRequest.get,
    post: mainApiRequest.post,
    cleanup
  };
}
