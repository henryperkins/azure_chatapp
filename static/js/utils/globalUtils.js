/* ---------------------------------------------------------------------------
 *  globalUtils.js — Deprecated god-utility module, split into focused utilities.
 *  All prior factory methods have moved to their own modules in ./utils/.
 *  This file now ONLY exports formatting helpers, debounce, and legacy shims.
 *  -----
 *  Deprecated: Use these instead:
 *    - createApiClient      => './utils/apiClient.js'
 *    - createStorageService => './utils/storageService.js'
 *    - createDebugTools     => './utils/notifications-helpers.js'
 *    - createBrowserAPI     => './utils/browserService.js'
 *    - All notification logic => './utils/notify.js' and './utils/notifications-helpers.js'
 *    - DOM helpers => './utils/domAPI.js'
 *    - URL helpers => './utils/browserService.js'
 *  -----
 */

/**
 * @deprecated Use createApiClient from './apiClient.js'
 */
export { createApiClient } from './apiClient.js';

/**
 * @deprecated Use createStorageService from './storageService.js'
 */
export { createStorageService } from './storageService.js';


/**
 * @deprecated Use createBrowserService from './browserService.js'
 */
export { createBrowserService } from './browserService.js';


// General-purpose helper functions
import { isValidProjectId as rawIsValidProjectId } from "../projectManager.js";
export const isValidProjectId = rawIsValidProjectId;

/* Only keep one implementation of each helper below (NO duplicates) */

/* ------------------------------------------------------------------
 *  URL / request helpers required by createApiClient & app.js
 * ------------------------------------------------------------------*/

/** True ⇢ `url` already contains a protocol or starts with ‘//’. */
export function isAbsoluteUrl(url = '') {
  return /^(?:[a-z]+:)?\/\//i.test(String(url));
}

/**
 * CONSOLIDATED: normaliseUrl moved to browserService.js to eliminate duplication.
 * This is a re-export for backward compatibility.
 */
export { normaliseUrl, normalizeUrl } from './browserService.js';

/**
 * Returns true when a GET request to `url` should NOT be deduplicated
 * (each call is unique even if the URL string repeats).  Extend the
 * regex list as new endpoints are discovered.
 */
const DEDUP_EXCLUSION_RE = /\/api\/log_notification\b|\/(sse|stream|events)\b/i;
export function shouldSkipDedup(url = '') {
  return DEDUP_EXCLUSION_RE.test(url);
}

/**
 * debounce – DI-safe version.
 * Requires a timer API that exposes { setTimeout, clearTimeout }.
 * If no timerAPI is supplied, it attempts to obtain the injected
 * browserService from the global DependencySystem.
 */
export function debounce(fn, wait = 250, timerAPI = null) {
  let timerId = null;

  /* Resolve timer helpers strictly via DI (never from window/global). */
  const getTimerAPI = () => {
    if (timerAPI?.setTimeout && timerAPI?.clearTimeout) return timerAPI;

    // Fallback: look-up browserService already registered in DI
    const ds = globalThis?.DependencySystem;
    const bs = ds?.modules?.get?.('browserService');
    if (bs?.setTimeout && bs?.clearTimeout) return bs;

    throw new Error('[globalUtils.debounce] timerAPI with setTimeout/clearTimeout is required (strict DI)');
  };

  return function debounced(...args) {
    const api = getTimerAPI();
    api.clearTimeout(timerId);
    timerId = api.setTimeout(() => {
      timerId = null;
      fn.apply(this, args);
    }, wait);
  };
}

// JSON helpers
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(",")}}`;
}
export function safeParseJSON(str) {
  if (typeof str !== "string") throw new Error('[globalUtils.safeParseJSON] Input not a string and fallback is forbidden.');
  try {
    return JSON.parse(str);
  } catch (err) {
    const logger = globalThis?.DependencySystem?.modules?.get?.('logger');
    logger?.error('[globalUtils] safeParseJSON failed', err,
      { context: 'globalUtils:safeParseJSON' });
    throw new Error('[globalUtils.safeParseJSON] JSON parse failed and fallback is forbidden: ' + (err?.message || err));
  }
}

// DOM helpers (only single definition, prefer domAPI for new code)
export function createElement(tag, opts = {}, trackListener, domAPI) {
  const doc = domAPI?.getDocument?.();
  if (!doc) throw new Error('[globalUtils.createElement] domAPI with getDocument() is required');
  let el;
  try {
    el = doc.createElement(tag);
    if (opts.className) el.className = opts.className;
    if (opts.id) el.id = opts.id;
    if ("textContent" in opts) el.textContent = opts.textContent;
    if ("innerHTML" in opts) {
      if (domAPI?.setInnerHTML) {
        domAPI.setInnerHTML(el, opts.innerHTML);   // sanitizer aware
      } else {
        // Fallback: escape tags to avoid XSS
        el.textContent = String(opts.innerHTML).replace(/<[^>]*>?/gm, '');
      }
    }

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
  } catch (err) {
    const logger = globalThis?.DependencySystem?.modules?.get?.('logger');
    logger?.error('[globalUtils] createElement failed', err,
      { context: 'globalUtils:createElement' });
    throw err;
  }
  return el;
}

export function toggleElement(selOrEl, show, domAPI) {
  try {
    if (typeof selOrEl === "string") {
      domAPI.querySelectorAll(selOrEl).forEach((el) => el.classList.toggle("hidden", !show));
    } else if (selOrEl && selOrEl.classList) {
      selOrEl.classList.toggle("hidden", !show);
    }
  } catch (err) {
    const logger = globalThis?.DependencySystem?.modules?.get?.('logger');
    logger?.error('[globalUtils] toggleElement failed', err,
      { context: 'globalUtils:toggleElement' });
  }
}

// Formatters
export const formatNumber = (n) => new Intl.NumberFormat().format(n || 0);
export const formatDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString();
  } catch (err) {
    const logger = globalThis?.DependencySystem?.modules?.get?.('logger');
    logger?.error('[globalUtils] formatDate failed', err,
      { context: 'globalUtils:formatDate' });
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


/**
 * @deprecated Use apiClient + proper .get/.post signature for this
 * (errorReporter/maybeCapture removed)
 */
export async function fetchData({ apiClient } = {}, id) {
  if (!apiClient) throw new Error('[globalUtils.fetchData] Missing apiClient dependency');
  return await apiClient.get(`/item/${id}`);
}

export function createGlobalUtils({ logger, apiClient } = {}) {
  if (!logger)        throw new Error('[globalUtils] logger required');
  if (!apiClient)     throw new Error('[globalUtils] apiClient required');

  return {
    isAbsoluteUrl, normaliseUrl, normalizeUrl, shouldSkipDedup,
    debounce, stableStringify, safeParseJSON,
    createElement: (...a) => createElement(...a),
    toggleElement: (...a) => toggleElement(...a),
    formatNumber, formatDate, formatBytes, fileIcon,
    fetchData   : (id) => apiClient.get(`/item/${id}`),
    cleanup () {}
  };
}
