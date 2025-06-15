const MODULE_CONTEXT = 'globalUtils';
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

import { normaliseUrl, normalizeUrl } from './browserService.js';

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
import { isValidProjectId } from '../projectManager.js';

/* Only keep one implementation of each helper below (NO duplicates) */

/* ------------------------------------------------------------------
 *  URL / request helpers required by createApiClient & app.js
 * ------------------------------------------------------------------*/

import { isAbsoluteUrl, shouldSkipDedup } from './urlUtils.js';
export { isAbsoluteUrl, shouldSkipDedup };

import { debounce } from './debounce.js';
export { debounce };

// ------------------------------------------------------------------
// Named JSON helpers (public API)
// ------------------------------------------------------------------

// Provide a named export so callers can `import { safeParseJSON } ...`.
// We deliberately re-export the internal implementation to avoid duplicating
// logic or exposing logger dependencies at the top level.  The DI-aware
// version remains available via createGlobalUtils({ logger }).

import { stableStringify, safeParseJSON } from './jsonUtils.js';
export { stableStringify, safeParseJSON };

import { createElement, toggleElement } from './elementUtils.js';
export { createElement, toggleElement };

import { formatNumber, formatDate, formatBytes, fileIcon } from './formatUtils.js';
export { formatNumber, formatDate, formatBytes, fileIcon };

// DOM helpers (only single definition, prefer domAPI for new code)

function _toggleElement(selOrEl, show, domAPI) {
  try {
    if (typeof selOrEl === "string") {
      domAPI.querySelectorAll(selOrEl).forEach((el) => el.classList.toggle("hidden", !show));
    } else if (selOrEl && selOrEl.classList) {
      selOrEl.classList.toggle("hidden", !show);
    }
  } catch {
    // No-op, logger handled in DI wrapper
  }
}

// Formatters
export const formatNumber = (n) => new Intl.NumberFormat().format(n || 0);
function _formatDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    return String(d);
  }
}

// Provide a named export so callers can `import { formatDate } ...`.
export { _formatDate as formatDate };
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


export function createGlobalUtils({ logger, apiClient } = {}) {
  if (!logger) throw new Error('[globalUtils] logger required');
  if (!apiClient) throw new Error('[globalUtils] apiClient required');

  return {
    isAbsoluteUrl,
    normaliseUrl,
    normalizeUrl,
    shouldSkipDedup,
    debounce,
    stableStringify,
    safeParseJSON: function (str) {
      try {
        return safeParseJSON(str);
      } catch (err) {
        logger.error('[globalUtils] safeParseJSON failed', err, { context: MODULE_CONTEXT + ':safeParseJSON' });
        throw err;
      }
    },
    createElement: function (...args) {
      try {
        return createElement(...args);
      } catch (err) {
        logger.error('[globalUtils] createElement failed', err, { context: MODULE_CONTEXT + ':createElement' });
        throw err;
      }
    },
    toggleElement: function (...args) {
      try {
        return toggleElement(...args);
      } catch (err) {
        logger.error('[globalUtils] toggleElement failed', err, { context: MODULE_CONTEXT + ':toggleElement' });
      }
    },
    formatNumber,
    formatDate,
    formatBytes,
    fileIcon,
    fetchData: (id) => apiClient.get(`/item/${id}`),
    cleanup() { }
  };
}
