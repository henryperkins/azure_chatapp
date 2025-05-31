/**
 * Browser-level helpers (DI strict, testable).
 * @param {Object} deps
 * @param {Window} deps.windowObject – injected window for testability
 */

let _moduleLogger = null;          // NEW – gives normaliseUrl access to logger

/**
 * Shared URL helpers
 * Refactored for strict dependency injection — no global window.
 * If you need app-level location, inject windowObject and call createBrowserService({ windowObject }).
 * The standalone helpers below now require explicit baseHref/location.
 */

import { getSessionId } from './session.js';
// --- shared URL helpers -------------------------------------------------
export function buildUrl(params = {}, baseHref) {
  if (!baseHref) {
    throw new Error('buildUrl requires baseHref (no global window access allowed)');
  }
  const url = new URL(baseHref, baseHref.startsWith('http') ? undefined : 'http://_');
  Object.entries(params).forEach(([k, v]) =>
    (v === undefined || v === null || v === '')
      ? url.searchParams.delete(k)
      : url.searchParams.set(k, v)
  );
  const sorted = Array.from(url.searchParams.entries())
                      .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(sorted).toString();
  const raw = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const path = raw || '/';          // guarantee leading “/”
  return path + (url.search ? `?${url.search}` : '');
}

export function normaliseUrl(u = '') {
  try {
    const url = new URL(u, u.startsWith('http') ? undefined : 'http://_');
    // url.search already includes '?' if params exist, or is empty string otherwise.
    const raw   = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    const path  = raw || '/';
    return path + url.search + url.hash;
  } catch (err) {
    const logger = _moduleLogger;
    if (logger) {
      logger.error('[browserService] normaliseUrl failed', err,
        { context: 'browserService:normaliseUrl', input: u });
    }
    return u;
  }
}

// U.S.-spelling alias – keeps backward compatibility
export const normalizeUrl = normaliseUrl;

export function createBrowserService({ windowObject, logger } = {}) {
  let _logger = logger;

  _moduleLogger = _logger;

  let _currentUser = null;

  if (!windowObject)
    throw new Error('browserService: windowObject must be injected (no global fallback)');
  if (!windowObject?.location) throw new Error('browserService: windowObject is required');

  /* --------------------------------------------------------------
   *  DependencySystem bootstrap (runtime fallback)
   * --------------------------------------------------------------
   *  The production build expects the hosting HTML page to expose a
   *  fully-featured `window.DependencySystem` **before** any of the
   *  application modules execute.  In unit-tests or server-side
   *  rendering scenarios this global often does not exist which used
   *  to make the very first access (`browserAPI.getDependencySystem()` in
   *  app.js) throw and abort the whole bootstrap.
   *
   *  To keep the contract intact while still allowing execution in
   *  non-browser contexts we lazily create a *minimal* implementation
   *  that fulfils just the subset of the API used across the codebase.
   *  The implementation lives *inside* browserService so we respect the
   *  guardrail that forbids creation of new top-level modules.
   * -------------------------------------------------------------- */

  function createFallbackDependencySystem() {
    throw new Error('[browserService] Fallback DependencySystem is forbidden—application DI contract not satisfied.');
  }

  if (!windowObject.DependencySystem || typeof windowObject.DependencySystem.register !== 'function') {
    windowObject.DependencySystem = createFallbackDependencySystem();
  }

  // Ensure modern alias exists even when host page provided its own DS
  if (typeof windowObject.DependencySystem.waitForDependencies !== 'function'
      && typeof windowObject.DependencySystem.waitFor === 'function') {
    windowObject.DependencySystem.waitForDependencies = (deps = [], { timeout = 15000, context = null } = {}) =>
      windowObject.DependencySystem.waitFor(deps, context, timeout);
  }

  // reuse shared helper – avoids keeping two divergent copies
  function _buildUrl(params = {}) {
    return buildUrl(params, windowObject.location.href);
  }

  // --------- DI wrappers for browser APIs ---------
  function FormDataImpl(form) {
    if (!windowObject.FormData) {
      logger.error('browserService: windowObject.FormData is not available. This may occur in test/mocked environments.');
      throw new Error('browserService: windowObject.FormData is not available. This may occur in test/mocked environments.');
    }
    return new windowObject.FormData(form);
  }

  function MutationObserverImpl(callback) {
    if (!windowObject.MutationObserver) {
      logger.error('browserService: windowObject.MutationObserver is not available. This may occur in test/mocked environments.');
      throw new Error('browserService: windowObject.MutationObserver is not available. This may occur in test/mocked environments.');
    }
    return new windowObject.MutationObserver(callback);
  }

  async function fetchImpl(...args) {
    if (!windowObject.fetch) {
      throw new Error('browserService: windowObject.fetch is not available. This may occur in test/mocked environments.');
    }
    let response;
    response = await windowObject.fetch(...args);
    return response;
  }

  function setCurrentUser(userObj) { _currentUser = userObj ?? null; }
  function getCurrentUser()      { return _currentUser; }

  // ---------------- File download helper ----------------
  /**
   * Trigger a browser download for a Blob or ArrayBuffer.
   * Falls back to console error if window APIs unavailable.
   * @param {Blob|ArrayBuffer} blob
   * @param {string} suggestedName
   */
  function triggerDownload(blob, suggestedName = 'download.bin') {
    try {
      const url = windowObject.URL.createObjectURL(blob);
      const a = windowObject.document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      windowObject.document.body.appendChild(a);
      a.click();
      windowObject.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      logger.error('[browserService] triggerDownload failed', err);
      throw err;
    }
  }

  return {
    // Query-string helpers
    buildUrl        : _buildUrl,
    normaliseUrl,              // ← add this line
    normalizeUrl,              // ← new alias
    getSearchParam: (k) => new URL(windowObject.location.href).searchParams.get(k),
    setSearchParam   : (k, v) => windowObject.history.replaceState({}, '', _buildUrl({ [k]: v })),
    removeSearchParam: (k) => windowObject.history.replaceState({}, '', _buildUrl({ [k]: '' })),

    // Storage helpers
    getItem   : (k) => windowObject.localStorage.getItem(k),
    setItem   : (k, v) => windowObject.localStorage.setItem(k, v),
    removeItem: (k) => windowObject.localStorage.removeItem(k),
    clear     : () => windowObject.localStorage.clear(),
    key       : (n) => windowObject.localStorage.key(n),
    get length() { return windowObject.localStorage.length; },

    // Timing helpers
    setTimeout: (...args) => {
      if (!windowObject.setTimeout) {
        _logger?.error?.('browserService: windowObject.setTimeout is not available. This may occur in test/mocked environments.');
        throw new Error('browserService: windowObject.setTimeout is not available. This may occur in test/mocked environments.');
      }
      return windowObject.setTimeout(...args);
    },

    /* Auth & other modules need interval helpers – expose via DI */
    setInterval: (...args) => {
      if (!windowObject.setInterval) {
        _logger?.error?.('browserService: windowObject.setInterval is not available. This may occur in test/mocked environments.');
        throw new Error('browserService: windowObject.setInterval is not available. This may occur in test/mocked environments.');
      }
      return windowObject.setInterval(...args);
    },
    clearInterval: (...args) => {
      if (!windowObject.clearInterval) {
        _logger?.error?.('browserService: windowObject.clearInterval is not available. This may occur in test/mocked environments.');
        throw new Error('browserService: windowObject.clearInterval is not available. This may occur in test/mocked environments.');
      }
      return windowObject.clearInterval(...args);
    },

    requestAnimationFrame: (cb) => {
      if (typeof windowObject.requestAnimationFrame === 'function') {
        return windowObject.requestAnimationFrame(cb);
      }
      logger.error('browserService: windowObject.requestAnimationFrame is required; fallback to setTimeout is forbidden.');
      throw new Error('browserService: windowObject.requestAnimationFrame is required; fallback to setTimeout is forbidden.');
    },

    // Location / navigation helpers
    setLocation: (url) => { windowObject.location.assign(url); },
    getLocationPathname: () => windowObject.location.pathname,
    getLocation: () => windowObject.location,
    URLSearchParams: windowObject.URLSearchParams,
    FormData: windowObject.FormData,

    // Browser APIs for DI/testability
    FormDataImpl,
    MutationObserver: MutationObserverImpl,
    fetch: fetchImpl,

    /* Native constructor needed by Auth & other modules */
    // URLSearchParams: windowObject.URLSearchParams, // already above

    // Passthroughs for test harnesses
    getLocationHref: () => windowObject.location.href,
    setHistory: (...a) => windowObject.history.pushState(...a),

    /* --- History helpers for NavigationService --- */
    pushState   : (state = {}, title = '', url = '') =>
      windowObject.history.pushState(state, title, url),

    replaceState: (state = {}, title = '', url = '') =>
      windowObject.history.replaceState(state, title, url),
    clearTimeout : (...a) => windowObject.clearTimeout(...a),

    /* new accessors required by app.js */
    getWindow           : () => windowObject,
    getDocument         : () => windowObject.document,
    getHistory          : () => windowObject.history,
    getInnerWidth       : () => windowObject.innerWidth,
    getDependencySystem : () => windowObject.DependencySystem,

    // session-scoped user helpers (used by app.handleAuthStateChange)
    setCurrentUser,
    getCurrentUser,

    /* correlation helpers */
    getSessionId : () => getSessionId(),
    getUserAgent : () => windowObject.navigator?.userAgent || 'Unknown',
    setLogger(newLogger) { _logger = newLogger; },

    cleanup () {/* no internal listeners or timers */}
  };
}
