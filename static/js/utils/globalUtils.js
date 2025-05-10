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
 * @deprecated Use createDebugTools from './notifications-helpers.js'
 */
export { createDebugTools } from './notifications-helpers.js';

/**
 * @deprecated Use createBrowserService from './browserService.js'
 */
export { createBrowserService } from './browserService.js';

// General-purpose helper functions
import { isValidProjectId as rawIsValidProjectId } from "../projectManager.js";
import { maybeCapture } from './notifications-helpers.js';
export const isValidProjectId = rawIsValidProjectId;

/* Only keep one implementation of each helper below (NO duplicates) */

// Debounce
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

// JSON helpers
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

// DOM helpers (only single definition, prefer domAPI for new code)
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
    // no-op/log
  }
}

// Formatters
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

// Misc helpers
export async function waitForDepsAndDom({
  deps = [],
  DependencySystem = window.DependencySystem,
  domSelectors = [],
  pollInterval = 30,
  timeout = 4000,
  domAPI,
  notify = console,
  source = 'waitForDepsAndDom'
} = {}) {
  if (!DependencySystem) {
    notify.error("waitForDepsAndDom: DependencySystem missing", { source, critical: true });
    throw new Error("waitForDepsAndDom: DependencySystem missing");
  }
  if (!DependencySystem.modules || typeof DependencySystem.modules.has !== 'function' || typeof DependencySystem.modules.get !== 'function') {
    notify.error("waitForDepsAndDom: DependencySystem.modules is missing or invalid", { source, critical: true });
    throw new Error("waitForDepsAndDom: DependencySystem.modules is missing or invalid");
  }
  if (!domAPI || typeof domAPI.querySelector !== 'function') {
    notify.error('waitForDepsAndDom: domAPI.querySelector is required (no global fallback)', { source, critical: true });
    throw new Error('waitForDepsAndDom: domAPI.querySelector is required');
  }

  const start = Date.now();
  while (true) {
    try {
      const depsReady = deps.every((d) => DependencySystem.modules.has(d) && DependencySystem.modules.get(d));
      const domReady = domSelectors.every((s) => domAPI.querySelector(s));
      if (depsReady && domReady) {
        notify.debug?.(`waitForDepsAndDom: Conditions met for source '${source}'. Deps: [${deps.join(', ')}], DOM: [${domSelectors.join(', ')}]`, { source });
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
      if (err.message.startsWith(`waitForDepsAndDom timeout ${timeout}ms`)) {
        throw err;
      }
      if (Date.now() - start > timeout) {
        notify.error?.(`waitForDepsAndDom error after timeout threshold for source '${source}': ${err.message}`, { source, originalError: err });
        throw new Error(`waitForDepsAndDom error for source '${source}': ${err.message}`);
      }
      notify.warn?.(`waitForDepsAndDom: Caught error while checking dependencies for source '${source}', retrying...`, { source, originalError: err });
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
}

/**
 * @deprecated Use apiClient + proper .get/.post signature for this
 */
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
