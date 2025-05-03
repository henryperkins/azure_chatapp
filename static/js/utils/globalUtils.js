// globalUtils.js (REFACTORED & CONSOLIDATED)

import { isValidProjectId as rawIsValidProjectId } from '../projectManager.js';

/**
 * Re-export from projectManager.js for convenience.
 */
export const isValidProjectId = rawIsValidProjectId;

/**
 * Checks if the current user is authenticated based on window.app.state data.
 * (Not used in app.js, but kept here for other modules if needed.)
 */
export function isAuthenticated() {
  return window.app?.state?.isAuthenticated === true;
}

/**
 * Displays a notification message (via window.DependencySystem if available)
 * or logs in console as a fallback.
 */
export function showNotification(message, type = 'info', duration = 5000) {
  try {
    const ds = window.DependencySystem || null;
    const notificationHandler = ds?.modules?.get('notificationHandler');
    if (notificationHandler?.show) {
      notificationHandler.show(message, type, { timeout: duration });
    } else {
      const logMethod = type === 'error'
        ? console.error
        : type === 'warn'
          ? console.warn
          : console.log;
      logMethod(`[Notification Fallback] (${type}): ${message}`);
    }
  } catch (e) {
    console.error("[globalUtils] Error showing notification:", e);
    const logMethod = type === 'error'
      ? console.error
      : type === 'warn'
        ? console.warn
        : console.log;
    logMethod(`[Notification Critical Fallback] (${type}): ${message}`);
  }
}

/**
 * Debounce: delay function calls until after `wait` ms have elapsed
 * since the last invocation.
 */
export function debounce(fn, wait = 250) {
  let timeoutId = null;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn.apply(this, args);
    }, wait);
  };
}

/**
 * Normalizes a given URL by removing trailing slashes and sorting query params.
 */
export function normaliseUrl(url) {
  try {
    const origin = window.location?.origin || 'http://localhost';
    const u = new URL(url, origin);
    // Trim any trailing slash if not the root
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Sort query params
    const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    u.search = new URLSearchParams(params).toString();
    return u.toString();
  } catch (e) {
    console.warn(`[globalUtils] Failed to normalize URL: ${url}`, e);
    return url;
  }
}

/**
 * Checks if the given URL should skip deduplication logic.
 */
export function shouldSkipDedup(url) {
  try {
    const lower = url.toLowerCase();
    if (
      lower.includes("/api/projects/") &&
      (
        lower.endsWith("/stats") ||
        lower.endsWith("/files") ||
        lower.endsWith("/artifacts") ||
        lower.endsWith("/conversations") ||
        lower.includes("/conversations?")
      )
    ) {
      return true;
    }
  } catch (e) {
    console.warn("[globalUtils] shouldSkipDedup error:", e);
  }
  return false;
}

/**
 * JSON-serializes a value deterministically by sorting object keys.
 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}

/**
 * Safely parse JSON, returning `defaultVal` if parsing fails.
 */
export function safeParseJSON(jsonString, defaultVal) {
  if (typeof jsonString !== 'string') return defaultVal;
  try {
    return JSON.parse(jsonString);
  } catch {
    return defaultVal;
  }
}

/**
 * Create an element with classes, events, data-* attributes, etc.
 */
export function createElement(tag, options = {}, trackListener) {
  const el = document.createElement(tag);
  if (options.className) el.className = options.className;
  if (options.id) el.id = options.id;
  if (options.textContent !== undefined) el.textContent = options.textContent;
  if (options.innerHTML !== undefined) el.innerHTML = options.innerHTML;

  // Attach events if provided (onClick, onChange, etc.)
  Object.entries(options).forEach(([key, val]) => {
    if (key.startsWith('on') && typeof val === 'function') {
      const evt = key.slice(2).toLowerCase();
      if (!trackListener) {
        throw new Error(`[globalUtils] createElement requires a trackListener for event: ${evt}`);
      }
      trackListener(el, evt, val);
    }
  });

  // data-* attributes
  Object.entries(options).forEach(([key, val]) => {
    if (key.startsWith('data-')) el.setAttribute(key, val);
  });

  // Set common HTML properties if present in options
  ['title', 'alt', 'src', 'href', 'placeholder', 'type', 'value', 'name']
    .forEach(prop => {
      if (options[prop] !== undefined) el[prop] = options[prop];
    });

  return el;
}

/**
 * Toggles "hidden" class on an element or collection of elements.
 * Accepts a DOM element or a string selector.
 */
export function toggleElement(selectorOrElement, show) {
  try {
    if (typeof selectorOrElement === 'string') {
      document.querySelectorAll(selectorOrElement).forEach(el => {
        el.classList.toggle('hidden', !show);
      });
    } else if (selectorOrElement instanceof HTMLElement) {
      selectorOrElement.classList.toggle('hidden', !show);
    }
  } catch (e) {
    console.error(`[globalUtils] Error in toggleElement for ${selectorOrElement}:`, e);
  }
}

/**
 * Formatting helpers
 */
export function formatNumber(number) {
  return new Intl.NumberFormat().format(number || 0);
}

export function formatDate(date) {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString();
  } catch {
    return String(date);
  }
}

export function formatBytes(num) {
  if (num == null) return '';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (num === 0) return '0 B';
  const i = Math.floor(Math.log(num) / Math.log(1024));
  return (num / Math.pow(1024, i)).toFixed(2) + ' ' + sizes[i];
}

export function fileIcon(fileType) {
  const icons = {
    pdf: '📄', doc: '📝', docx: '📝', txt: '📄',
    csv: '📊', json: '📋', md: '📄', py: '🐍',
    js: '📜', html: '🌐', css: '🎨',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
    zip: '📦'
  };
  return icons[(fileType || '').toLowerCase()] || '📄';
}

/**
 * Waits for named dependencies in DependencySystem and required DOM selectors.
 * Polls at `pollInterval` until `timeout` is reached.
 */
export async function waitForDepsAndDom({
  deps = [],
  DependencySystem = window.DependencySystem,
  domSelectors = [],
  pollInterval = 30,
  timeout = 4000
} = {}) {
  if (!DependencySystem) {
    throw new Error('DependencySystem not present for waitForDepsAndDom');
  }

  const start = Date.now();
  while (true) {
    // Check dependencies
    let depsReady = true;
    for (const d of deps) {
      if (!DependencySystem.modules.has(d) || !DependencySystem.modules.get(d)) {
        depsReady = false;
        break;
      }
    }

    // Check DOM elements
    let domReady = true;
    for (const selector of domSelectors) {
      if (!document.querySelector(selector)) {
        domReady = false;
        break;
      }
    }

    if (depsReady && domReady) return;

    if (Date.now() - start > timeout) {
      throw new Error(
        `waitForDepsAndDom: Not ready within ${timeout}ms.\n` +
        `Deps missing: ${deps.filter(d => !DependencySystem.modules.has(d)).join(', ')}\n` +
        `DOM missing: ${domSelectors.filter(s => !document.querySelector(s)).join(', ')}`
      );
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

/**
 * Context-rich error-handling async fetch utility.
 * Usage: await fetchData({ apiClient, errorReporter }, id)
 *
 * @param {Object} deps - DI bundle.
 * @param {Object} deps.apiClient - API client with a .get(url) method.
 * @param {Object} deps.errorReporter - Error tracker with .capture(err, ctx).
 * @param {any} id - Resource identifier for API endpoint.
 * @returns {Promise<any>} - Resolves with data or rethrows error after reporting.
 */
export async function fetchData({ apiClient, errorReporter }, id) {
  try {
    const data = await apiClient.get(`/item/${id}`);
    return data;
  } catch (err) {
    errorReporter?.capture?.(err, {
      module: 'projectManager',
      method: 'fetchData',
      itemId: id,
    });
    throw err;
  }
}
