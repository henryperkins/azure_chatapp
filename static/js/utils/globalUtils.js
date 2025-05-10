/* ---------------------------------------------------------------------------
 *  globalUtils.js — Unified DI‑strict utilities library
 *  ---------------------------------------------------------------------------
 *  This single module replaces the former separate files:
 *    • browserAPI.js
 *    • storageService.js
 *    • apiClient.js
 *    • (legacy) globalUtils.js helpers
 *
 *  All functionality is now exported here to simplify bundling and ensure that
 *  every part of the codebase can be imported from one place while still
 *  adhering to strict dependency‑injection.  Nothing inside this file reaches
 *  for globals except via the injected browserAPI wrapper created below.
 *
 *  --- Notification bridge for helpers that antes usaban console.* ---
 */
let _notifyGU = {                     // fallback a consola si DI no llega
  warn : (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
  info : (...a) => console.info?.(...a) ?? console.log(...a),
  debug: (...a) => console.debug?.(...a) ?? console.log(...a)
};
/**
 * DI hook – llámalo cuando tengas el `notify` real
 * (App lo hará tras createNotify)
 */
export function setGlobalUtilsNotifier(notify) {
  if (notify && typeof notify.warn === 'function') {
    _notifyGU = notify.withContext
      ? notify.withContext({ module: 'globalUtils', context: 'utils' })
      : notify;
  }
}

/*
 *  Usage pattern (ESM):
 *
 *    import {
 *      createBrowserAPI,
 *      createStorageService,
 *      createApiClient,
 *      debounce,
 *      normaliseUrl,
 *      // …etc.
 *    } from "./utils/globalUtils.js";
 *
 * ------------------------------------------------------------------------ */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Browser API abstraction
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns an abstraction over browser‑only globals so all consumer modules can
 * be SSR‑safe and testable.  If the module is imported in a non‑browser
 * context, the factory throws immediately.
 */
export function createBrowserAPI() {
  if (typeof window === "undefined")
    throw new Error("browserAPI: window context required");

  const logger = {
    log   : (...a) => _notifyGU.debug?.(...a)  ?? console.log(...a),
    info  : (...a) => _notifyGU.info?.(...a)   ?? console.info(...a),
    warn  : (...a) => _notifyGU.warn?.(...a)   ?? console.warn(...a),
    error : (...a) => _notifyGU.error?.(...a)  ?? console.error(...a),
    debug : (...a) => _notifyGU.debug?.(...a)  ?? console.debug(...a)
  };
  return {
    /* DependencySystem gateway */
    getDependencySystem: () => window.DependencySystem,

    /* Window accessor for DI (used by app.js and others) */
    getWindow: () => window,

    /* Navigation / history helpers */
    getLocation: () => window.location,
    getHistory: () => window.history,

    /* Current user helpers */
    getCurrentUser: () => window.currentUser,
    setCurrentUser: (u) => {
      window.currentUser = u;
    },

    /* Runtime metrics */
    getInnerWidth: () => window.innerWidth,

    /* DOM */
    getDocument: () => document,

    /* Storage */
    getLocalStorage: () => window.localStorage,

    /* Event helpers */
    addEventListener: (...a) => window.addEventListener(...a),
    removeEventListener: (...a) => window.removeEventListener(...a),

    /* Misc */
    alert: (...args) => window.alert(...args),
    createURLSearchParams: (...args) => new URLSearchParams(...args),
    createEvent: (...args) => new Event(...args),
    requestAnimationFrame: (cb) => window.requestAnimationFrame(cb),

    /* Optional: expose fetch + AbortController for DI‑strict code */
    fetch: (...args) => window.fetch(...args),
    AbortController: window.AbortController,

    /* Console wrapper so tests can stub easily */
    console: logger,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Storage service (localStorage wrapper)
// ─────────────────────────────────────────────────────────────────────────────
export function createStorageService({ browserAPI, APP_CONFIG, notificationHandler }) {
  function safe(fn, fallback, ctx) {
    try {
      return fn();
    } catch (err) {
      if (APP_CONFIG?.DEBUG && notificationHandler?.warn)
        notificationHandler.warn(`[storageService] ${ctx} failed`, { err });
      return fallback;
    }
  }

  return {
    getItem: (k) => safe(() => browserAPI.getLocalStorage().getItem(k), null, "getItem"),
    setItem: (k, v) => safe(() => browserAPI.getLocalStorage().setItem(k, v), undefined, "setItem"),
    removeItem: (k) => safe(() => browserAPI.getLocalStorage().removeItem(k), undefined, "removeItem"),
    clear: () => safe(() => browserAPI.getLocalStorage().clear(), undefined, "clear"),
    key: (n) => safe(() => browserAPI.getLocalStorage().key(n), null, "key"),
    get length() {
      return safe(() => browserAPI.getLocalStorage().length, 0, "length");
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. API client – dedup, timeout, CSRF, JSON handling
// ─────────────────────────────────────────────────────────────────────────────
export function createApiClient({ APP_CONFIG, globalUtils, notificationHandler, getAuthModule, browserAPI }) {
  const pending = new Map();
  const BASE_URL = APP_CONFIG?.BASE_API_URL || ''; // Get base URL from config

  /**
   * Main request wrapper.  Mirrors `fetch` signature with extras.
   *
   * @param {string} url
   * @param {RequestInit} opts
   * @param {boolean} skipCache – bypass GET‑deduplication
   */
  return async function apiRequest(url, opts = {}, skipCache = false) {
    // hard-kill deprecated backend logging endpoint
    if (url.includes('/api/log_notification')) return { skipped: true };
    const method = (opts.method || "GET").toUpperCase();

    if (!skipCache && method === "GET" && globalUtils.shouldSkipDedup(url)) {
      skipCache = true;
    }

    const auth = getAuthModule?.();
    // Construct full URL using BASE_URL if url is relative
    const fullUrl = globalUtils.isAbsoluteUrl(url) ? url : `${BASE_URL}${url}`;

let normUrl;
try {
  // Always pass base for DI strictness and robustness
  const base = browserAPI?.getLocation?.().origin;
  normUrl = globalUtils.normaliseUrl(fullUrl, base);
} catch (err) {
      // graceful fallback: usa la URL sin normalizar y registra la incidencia
      normUrl = fullUrl;
      if (APP_CONFIG?.DEBUG && notificationHandler?.warn) {
        notificationHandler.warn(`[API] normaliseUrl failed for "${fullUrl}"`, {
          context : 'apiClient',
          module  : 'ApiClient',
          source  : 'apiRequest',
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
      if (APP_CONFIG.DEBUG) notificationHandler?.debug?.(`[API] Dedup hit: ${key}`);
      return pending.get(key);
    }

    opts.headers = { Accept: "application/json", ...(opts.headers || {}) };

    // CSRF token injection
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && auth?.getCSRFToken) {
      const csrf = auth.getCSRFToken();
      if (csrf) opts.headers["X-CSRF-Token"] = csrf;
      else if (APP_CONFIG.DEBUG) notificationHandler?.warn?.(`[API] No CSRF for ${method} ${normUrl}`);
    }

    // JSON stringify body if plain object (and not FormData)
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.headers["Content-Type"] ??= "application/json;charset=UTF-8";
      if (opts.headers["Content-Type"].includes("application/json")) {
        try {
          opts.body = JSON.stringify(opts.body);
        } catch (err) {
          notificationHandler?.error?.("[API] Failed to stringify body", err);
          return Promise.reject(new Error("Failed to serialize request body."));
        }
      }
    }

    // Timeout via AbortController (injected from browserAPI for SSR safety)
    const abortCtl = new (browserAPI?.AbortController || AbortController)();
    opts.signal = abortCtl.signal;
    const apiTimeout = APP_CONFIG?.TIMEOUTS?.API_REQUEST || 15000; // Use configured timeout or default
    const timer = setTimeout(
      () => abortCtl.abort(new Error(`API Timeout (${apiTimeout}ms)`)),
      apiTimeout,
    );

    const p = (async () => {
      try {
        if (APP_CONFIG.DEBUG)
          notificationHandler?.debug?.(`[API] ${method} ${normUrl}`, {
            context: 'api',
            module: 'ApiClient',
            source: 'apiRequest',
            traceId: APP_CONFIG?.DependencySystem?.getCurrentTraceIds?.().traceId,
            transactionId: APP_CONFIG?.DependencySystem?.generateTransactionId?.(),
            extra: { hasBody: !!opts.body }
          });

        const resp = await (browserAPI?.fetch || fetch)(normUrl, opts);

        // --- LOG /api/auth/verify response and headers ---
        if (normUrl.includes('/api/auth/verify')) {
          try {
            const clone = resp.clone();
            const cType = clone.headers.get("content-type") || "";
            let body;
            if (cType.includes("application/json")) {
              body = await clone.json();
            } else {
              body = await clone.text();
            }
            // Log headers as object
            const headersObj = {};
            for (const [k, v] of clone.headers.entries()) headersObj[k] = v;
            console.log("[AUTH DEBUG] /api/auth/verify response:", body);
            console.log("[AUTH DEBUG] /api/auth/verify headers:", headersObj);
          } catch (e) {
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
              console.warn("[globalUtils] (fallback) Failed to read response text", e);
            }
          }
          const e = new Error(errPayload.message);
          e.status = resp.status;
          e.data = errPayload;
          throw e;
        }

        // No-content → undefined
        if (resp.status === 204 || resp.headers.get("content-length") === "0") return undefined;

        const cType = resp.headers.get("content-type") || "";

        // 1) Correct header → parse JSON
        if (cType.includes("application/json")) {
          const json = await resp.json();
          return json?.status === "success" && "data" in json ? json.data : json;
        }

        // 2) Header missing / wrong → try to parse anyway
        const rawText = await resp.text();
        try {
          const json = JSON.parse(rawText);
          return json?.status === "success" && "data" in json ? json.data : json;
        } catch {
          /* not JSON */
        }

        // 3) Plain text fallback
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

// ─────────────────────────────────────────────────────────────────────────────
// 4. General‑purpose helper functions (was legacy globalUtils.js)
// ─────────────────────────────────────────────────────────────────────────────
import { isValidProjectId as rawIsValidProjectId } from "../projectManager.js";
import { maybeCapture } from './notifications-helpers.js';   // ruta relativa a utils/
export const isValidProjectId = rawIsValidProjectId;

// ░░ Debounce ░░───────────────────────────────────────────────────────────────
export function debounce(fn, wait = 250) {
  let t = null;
  return function (...a) {
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn.apply(this, a);
    }, wait);
  };
}

// ░░ URL helpers ░░────────────────────────────────────────────────────────────
export function isAbsoluteUrl(url) {
    try {
        new URL(url);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Normalize a URL to absolute, optionally using a provided base.
 * @param {string} url - The URL or path to normalize.
 * @param {string} [base] - Optional base URL. If not provided, tries window.location.origin.
 * @returns {string} - The normalized absolute URL.
 */
export function normaliseUrl(url, base) {
  if (!url || typeof url !== 'string') throw new Error('normaliseUrl: url is required and must be a string');
  let finalBase = base;
  if (!finalBase && typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null" && window.location.origin !== "undefined") {
    finalBase = window.location.origin;
  }
  if (!finalBase) {
    finalBase = "http://localhost:8000";
    _notifyGU.warn("[globalUtils] normaliseUrl: No valid base, using localhost fallback.");
  }
  try {
    const u = new URL(url, finalBase);
    // strip trailing “/”, sort query params – keep existing behaviour
    if (u.pathname.length > 1 && u.pathname.endsWith("/"))
      u.pathname = u.pathname.slice(0, -1);
    const sorted = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = new URLSearchParams(sorted).toString();
    return u.toString();
  } catch (_e) {
    _notifyGU.warn("[globalUtils] normaliseUrl failed", url, _e);
    return url; // graceful fallback
  }
}

export function shouldSkipDedup(url) {
  try {
    const lower = url.toLowerCase();
    if (
      lower.includes("/api/projects/") &&
      (lower.endsWith("/stats") ||
        lower.endsWith("/files") ||
        lower.endsWith("/artifacts") ||
        lower.endsWith("/conversations") ||
        lower.includes("/conversations?"))
    ) {
      return true;
    }
  } catch (e) {
    _notifyGU.warn("[globalUtils] (fallback) shouldSkipDedup error", e);
  }
  return false;
}

// ░░ JSON helpers ░░───────────────────────────────────────────────────────────
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(",")}}`;
}

export function safeParseJSON(str, fallback) {
  if (typeof str !== "string") return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ░░ DOM helpers ░░────────────────────────────────────────────────────────────
export function createElement(tag, opts = {}, trackListener) {
  const el = document.createElement(tag);
  if (opts.className) el.className = opts.className;
  if (opts.id) el.id = opts.id;
  if ("textContent" in opts) el.textContent = opts.textContent;
  if ("innerHTML" in opts) el.innerHTML = opts.innerHTML;

  // Attach event listeners via DI tracker
  Object.entries(opts).forEach(([k, v]) => {
    if (k.startsWith("on") && typeof v === "function") {
      const evt = k.slice(2).toLowerCase();
      if (!trackListener)
        throw new Error(`[globalUtils] createElement requires trackListener for ${evt}`);
      trackListener(el, evt, v);
    }
  });

  // data‑* attributes & common HTML props
  Object.entries(opts).forEach(([k, v]) => {
    if (k.startsWith("data-")) el.setAttribute(k, v);
  });
  [
    "title",
    "alt",
    "src",
    "href",
    "placeholder",
    "type",
    "value",
    "name",
  ].forEach((p) => {
    if (opts[p] !== undefined) el[p] = opts[p];
  });

  return el;
}

export function toggleElement(selOrEl, show) {
  try {
    if (typeof selOrEl === "string") {
      document.querySelectorAll(selOrEl).forEach((el) => el.classList.toggle("hidden", !show));
    } else if (selOrEl instanceof HTMLElement) {
      selOrEl.classList.toggle("hidden", !show);
    }
  } catch (e) {
    _notifyGU.error("[globalUtils] (fallback) toggleElement error", e);
  }
}

/**
 * createDebugTools
 * Lightweight stopwatch / trace helper.
 *
 * @param {Object} deps
 * @param {Object} [deps.notify] – DI notify util (optional but preferred)
 * @returns {Object} API – { start(label), stop(id,label), newTraceId() }
 *
 * Follows “factory-function-export-pattern”.
 */
export function createDebugTools({ notify } = {}) {
  const _active = new Map();
  const _uuid   = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `trace-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const _log    = (...args) =>
    (notify?.debug ? notify.debug : _notifyGU.debug)(...args);

  function start(label = '') {
    const id = _uuid();
    _active.set(id, performance.now());
    _log(`[trace:start] ${label}`, { traceId: id, label });
    return id;
  }

  function stop(id, label = '') {
    const t0 = _active.get(id);
    if (t0 == null) return null;
    const dur = +(performance.now() - t0).toFixed(1);
    _active.delete(id);
    _log(`[trace:stop ] ${label} (${dur} ms)`, { traceId: id, label, duration: dur });
    return dur;
  }

  return { start, stop, newTraceId: _uuid };
}

// ░░ Formatting helpers ░░────────────────────────────────────────────────────
export const formatNumber = (n) => new Intl.NumberFormat().format(n || 0);
export const formatDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return String(d);
  }
};
export function formatBytes(num) {
  if (num == null) return "";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  if (num === 0) return "0 B";
  const i = Math.floor(Math.log(num) / Math.log(1024));
  return `${(num / 1024 ** i).toFixed(2)} ${sizes[i]}`;
}
export const fileIcon = (t = "") =>
(
  {
    pdf: "📄",
    doc: "📝",
    docx: "📝",
    txt: "📄",
    csv: "📊",
    json: "📋",
    md: "📄",
    py: "🐍",
    js: "📜",
    html: "🌐",
    css: "🎨",
    jpg: "🖼️",
    jpeg: "🖼️",
    png: "🖼️",
    gif: "🖼️",
    zip: "📦",
  }[t.toLowerCase()] || "📄"
);

// ░░ Misc helpers ░░───────────────────────────────────────────────────────────
export async function waitForDepsAndDom({
  deps = [],
  DependencySystem = window.DependencySystem,
  domSelectors = [],
  pollInterval = 30,
  timeout = 4000,
  domAPI = { querySelector: (s) => document.querySelector(s) }, // Allow injected domAPI, fallback to global document
  notify = _notifyGU, // Use injected notify, fallback to _notifyGU
  source = 'waitForDepsAndDom' // Allow a source to be passed for logging
} = {}) {
  if (!DependencySystem) {
    notify.error("waitForDepsAndDom: DependencySystem missing", { source, critical: true });
    throw new Error("waitForDepsAndDom: DependencySystem missing");
  }

  // Verify DependencySystem has expected structure
  if (!DependencySystem.modules || typeof DependencySystem.modules.has !== 'function' || typeof DependencySystem.modules.get !== 'function') {
    notify.error("waitForDepsAndDom: DependencySystem.modules is missing or invalid", { source, critical: true });
    throw new Error("waitForDepsAndDom: DependencySystem.modules is missing or invalid");
  }
  if (!domAPI || typeof domAPI.querySelector !== 'function') {
    notify.error("waitForDepsAndDom: domAPI.querySelector is missing or invalid", { source, critical: true });
    // Fallback to global document if domAPI is truly unusable, though this is against DI principles
    domAPI = { querySelector: (s) => document.querySelector(s) };
    notify.warn("waitForDepsAndDom: Fallback to global document.querySelector due to invalid domAPI.", { source });
  }


  const start = Date.now();
  while (true) {
    try {
      const depsReady = deps.every((d) => DependencySystem.modules.has(d) && DependencySystem.modules.get(d));
      const domReady = domSelectors.every((s) => domAPI.querySelector(s));
      if (depsReady && domReady) {
        notify.debug(`waitForDepsAndDom: Conditions met for source '${source}'. Deps: [${deps.join(', ')}], DOM: [${domSelectors.join(', ')}]`, { source });
        return;
      }

      if (Date.now() - start > timeout) {
        const missingDeps = deps.filter((d) => !(DependencySystem.modules.has(d) && DependencySystem.modules.get(d)));
        const missingDom = domSelectors.filter((s) => !domAPI.querySelector(s));
        const errorMsg = `waitForDepsAndDom timeout ${timeout}ms for source '${source}' — Missing Deps: [${missingDeps.join(', ')}], Missing DOM: [${missingDom.join(', ')}]`;
        notify.error(errorMsg, { source, timeout, missingDeps, missingDom });
        throw new Error(errorMsg);
      }
    } catch (err) {
      // If the error is the timeout error we just threw, rethrow it.
      if (err.message.startsWith(`waitForDepsAndDom timeout ${timeout}ms`)) {
        throw err;
      }
      // For other errors during checks (e.g., if domAPI.querySelector itself throws for some reason)
      if (Date.now() - start > timeout) { // Check timeout again in case the error itself took time
        notify.error(`waitForDepsAndDom error after timeout threshold for source '${source}': ${err.message}`, { source, originalError: err });
        throw new Error(`waitForDepsAndDom error for source '${source}': ${err.message}`);
      }
      notify.warn(`waitForDepsAndDom: Caught error while checking dependencies for source '${source}', retrying...`, { source, originalError: err });
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
}

export async function fetchData({ apiClient, errorReporter }, id) {
  try {
    return await apiClient.get(`/item/${id}`);
  } catch (err) {
    maybeCapture(errorReporter, err, {
      module: "projectManager",
      method: "fetchData",
      itemId: id,
    });
    throw err;
  }
}
