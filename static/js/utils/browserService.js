/**
 * Browser-level helpers (DI strict, testable).
 * @param {Object} deps
 * @param {Window} deps.windowObject – injected window for testability
 */

/**
 * Shared URL helpers
 * Refactored for strict dependency injection — no global window.
 * If you need app-level location, inject windowObject and call createBrowserService({ windowObject }).
 * The standalone helpers below now require explicit baseHref/location.
 */

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
    return u;
  }
}

// U.S.-spelling alias – keeps backward compatibility
export const normalizeUrl = normaliseUrl;

export function createBrowserService({ windowObject, logger } = {}) {
  const _logger = logger;

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
    const modules = new Map();
    const pendingResolvers = new Map(); // depName -> [resolveFns]

    function register(name, value) {
      modules.set(name, value);
      if (pendingResolvers.has(name)) {
        pendingResolvers.get(name).forEach((r) => r(value));
        pendingResolvers.delete(name);
      }
      return value;
    }

    function waitFor(deps = [], _ctx = null, timeout = 15000) {
      const required = Array.isArray(deps) ? deps : [deps];
      const remaining = required.filter((d) => !modules.has(d));
      if (remaining.length === 0) return Promise.resolve(true);

      return new Promise((resolve, reject) => {
        const satisfied = new Set();

        const maybeResolve = () => {
          if (satisfied.size === remaining.length) resolve(true);
        };

        const timerId = timeout
          ? setTimeout(
              () => reject(new Error(`DependencySystem.waitFor timeout: [${remaining.join(', ')}]`)),
              timeout,
            )
          : null;

        remaining.forEach((dep) => {
          const arr = pendingResolvers.get(dep) || [];
          arr.push(() => {
            satisfied.add(dep);
            if (timerId && satisfied.size === remaining.length) clearTimeout(timerId);
            maybeResolve();
          });
          pendingResolvers.set(dep, arr);
        });
      });
    }

    function has(dep) {
      return modules.has(dep);
    }

    function cleanupModuleListeners(context = '') {
      const evHandlers = modules.get('eventHandlers');
      if (evHandlers && typeof evHandlers.cleanupListeners === 'function') {
        evHandlers.cleanupListeners({ context });
      }
    }

    return {
      modules,
      register,
      waitFor,
      has,
      cleanupModuleListeners,
    };
  }

  if (!windowObject.DependencySystem || typeof windowObject.DependencySystem.register !== 'function') {
    windowObject.DependencySystem = createFallbackDependencySystem();
  }

  function _buildUrl(params = {}) {
    const url = new URL(windowObject.location.href);
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    });
    // Normalise: keep pathname, sorted params
    const sorted = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    url.search = new URLSearchParams(sorted).toString();
    const raw  = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    const path = raw || '/';
    return path + (url.search ? `?${url.search}` : '');
  }

  // --------- DI wrappers for browser APIs ---------
  function FormDataImpl(form) {
    if (!windowObject.FormData) {
      _logger?.error?.('browserService: windowObject.FormData is not available. This may occur in test/mocked environments.');
      throw new Error('browserService: windowObject.FormData is not available. This may occur in test/mocked environments.');
    }
    return new windowObject.FormData(form);
  }

  function MutationObserverImpl(callback) {
    if (!windowObject.MutationObserver) {
      _logger?.error?.('browserService: windowObject.MutationObserver is not available. This may occur in test/mocked environments.');
      throw new Error('browserService: windowObject.MutationObserver is not available. This may occur in test/mocked environments.');
    }
    return new windowObject.MutationObserver(callback);
  }

  async function fetchImpl(...args) {
    if (!windowObject.fetch) {
      throw new Error('browserService: windowObject.fetch is not available. This may occur in test/mocked environments.');
    }
    if (_logger) {
      _logger.log('[browserService][fetchImpl] Request', {
        context: 'browserService:fetchImpl',
        url: args[0]
      });
    }
    let response;
    try {
      response = await windowObject.fetch(...args);
      if (!response.ok && _logger) {
        _logger?.warn?.('[browserService][fetchImpl] Non-OK response: ' + response.status, {
          context: 'browserService:fetchImpl',
          url: args[0],
          status: response.status
        });
      }
      return response;
    } catch (err) {
      if (_logger) {
        _logger?.error?.('[browserService][fetchImpl] Error during fetch', err, {
          context: 'browserService:fetchImpl',
          url: args[0]
        });
      }
      throw err;
    }
  }

  function setCurrentUser(userObj) { _currentUser = userObj ?? null; }
  function getCurrentUser()      { return _currentUser; }

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

    requestAnimationFrame: (cb) =>
      typeof windowObject.requestAnimationFrame === 'function'
        ? windowObject.requestAnimationFrame(cb)
        : (windowObject.setTimeout
            ? windowObject.setTimeout(cb, 0)
            : (() => { _logger?.error?.('browserService: windowObject.setTimeout is not available for requestAnimationFrame fallback.'); throw new Error('browserService: windowObject.setTimeout is not available for requestAnimationFrame fallback.'); })()),

    // Location / navigation helpers
    setLocation: (url) => { windowObject.location.assign(url); },
    getLocationPathname: () => windowObject.location.pathname,

    // Browser APIs for DI/testability
    FormData: FormDataImpl,
    MutationObserver: MutationObserverImpl,
    fetch: fetchImpl,

    /* Native constructor needed by Auth & other modules */
    URLSearchParams: windowObject.URLSearchParams,

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
    getLocation         : () => windowObject.location,
    getInnerWidth       : () => windowObject.innerWidth,
    getDependencySystem : () => windowObject.DependencySystem,

    // session-scoped user helpers (used by app.handleAuthStateChange)
    setCurrentUser,
    getCurrentUser,
  };
}
