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
    console: {
      log: (...a) => console.log(...a),
      info: (...a) => console.info(...a),
      warn: (...a) => console.warn(...a),
      error: (...a) => console.error(...a),
      debug: (...a) => console.debug(...a),
    },
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
    const normUrl = globalUtils.normaliseUrl(fullUrl); // Normalize the potentially full URL
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

        // No‑content = undefined
        if (resp.status === 204 || resp.headers.get("content-length") === "0") return undefined;

        // JSON auto‑parse
        if (resp.headers.get("content-type")?.includes("application/json")) {
          const json = await resp.json();
          return json?.status === "success" && "data" in json ? json.data : json;
        }

        // Fallback: plain text
        return resp.text();
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

export function normaliseUrl(url) {
  try {
    // Assume url is already absolute or has been prefixed
    const u = new URL(url);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    const sorted = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = new URLSearchParams(sorted).toString();
    return u.toString();
  } catch (e) {
    /* eslint-disable no-console */
    console.warn("[globalUtils] (fallback) Failed to normalise URL", url, e);
    /* eslint-enable */
    return url;
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
    console.warn("[globalUtils] (fallback) shouldSkipDedup error", e);
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
    console.error("[globalUtils] (fallback) toggleElement error", e);
  }
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
} = {}) {
  if (!DependencySystem) throw new Error("waitForDepsAndDom: DependencySystem missing");

  // Verify DependencySystem has expected structure
  if (!DependencySystem.modules || typeof DependencySystem.modules.has !== 'function' || typeof DependencySystem.modules.get !== 'function') {
    throw new Error("waitForDepsAndDom: DependencySystem.modules is missing or invalid");
  }

  const start = Date.now();
  while (true) {
    try {
      const depsReady = deps.every((d) => DependencySystem.modules.has(d) && DependencySystem.modules.get(d));
      const domReady = domSelectors.every((s) => document.querySelector(s));
      if (depsReady && domReady) return;

      if (Date.now() - start > timeout) {
        const missingDeps = deps.filter((d) => !DependencySystem.modules.has(d) || !DependencySystem.modules.get(d));
        const missingDom = domSelectors.filter((s) => !document.querySelector(s));
        throw new Error(
          `waitForDepsAndDom timeout ${timeout}ms — deps: ${missingDeps.join(', ')}, dom: ${missingDom.join(', ')}`,
        );
      }
    } catch (err) {
      if (Date.now() - start > timeout) {
        throw new Error(`waitForDepsAndDom error: ${err.message}`);
      }
      console.warn('waitForDepsAndDom: Caught error while checking dependencies, retrying...', err);
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
}

export async function fetchData({ apiClient, errorReporter }, id) {
  try {
    return await apiClient.get(`/item/${id}`);
  } catch (err) {
    errorReporter?.capture?.(err, {
      module: "projectManager",
      method: "fetchData",
      itemId: id,
    });
    throw err;
  }
}
