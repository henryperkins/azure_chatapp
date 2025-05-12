/**
 * Browser-level helpers (DI strict, testable).
 * @param {Object} deps
 * @param {Window} deps.windowObject – injected window for testability
 */

// --- shared URL helpers -------------------------------------------------
export function buildUrl(params = {}, baseHref = (typeof window !== 'undefined' ? window.location.href : 'http://_/')) {
  const url = new URL(baseHref, baseHref.startsWith('http') ? undefined : 'http://_');
  Object.entries(params).forEach(([k, v]) =>
    (v === undefined || v === null || v === '')
      ? url.searchParams.delete(k)
      : url.searchParams.set(k, v)
  );
  const sorted = Array.from(url.searchParams.entries())
                      .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(sorted).toString();
  return url.pathname + (url.search ? `?${url.search}` : '');
}

export function normaliseUrl(u = '') {
  try {
    const url = new URL(u, u.startsWith('http') ? undefined : 'http://_');
    // url.search already includes '?' if params exist, or is empty string otherwise.
    return url.pathname.replace(/\/+$/, '') + url.search + url.hash;
  } catch { return u; }
}

// U.S.-spelling alias – keeps backward compatibility
export const normalizeUrl = normaliseUrl;

export function createBrowserService({ windowObject } = {}) {

  let _currentUser = null;

  if (!windowObject)
    throw new Error('browserService: windowObject must be injected (no global fallback)');
  if (!windowObject?.location) throw new Error('browserService: windowObject is required');

  function _buildUrl(params = {}) {
    const url = new URL(windowObject.location.href);
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, v);
    });
    // Normalise: keep pathname, sorted params
    const sorted = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    url.search = new URLSearchParams(sorted).toString();
    return url.pathname + (url.search ? `?${url.search}` : '');
  }

  // --------- DI wrappers for browser APIs ---------
  function FormDataImpl(form) {
    return new windowObject.FormData(form);
  }

  function MutationObserverImpl(callback) {
    return new windowObject.MutationObserver(callback);
  }

  async function fetchImpl(...args) {
    // Direct passthrough; you may inject/wrap for testability in tests
    return windowObject.fetch(...args);
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
    getItem: (k) => windowObject.localStorage.getItem(k),
    setItem: (k, v) => windowObject.localStorage.setItem(k, v),
    removeItem: (k) => windowObject.localStorage.removeItem(k),

    // Timing helpers
    setTimeout: windowObject.setTimeout.bind(windowObject),
    requestAnimationFrame: (cb) =>
      typeof windowObject.requestAnimationFrame === 'function'
        ? windowObject.requestAnimationFrame(cb)
        : windowObject.setTimeout(cb, 0),

    // Location / navigation helpers
    setLocation: (url) => { windowObject.location.assign(url); },
    getLocationPathname: () => windowObject.location.pathname,

    // Browser APIs for DI/testability
    FormData: FormDataImpl,
    MutationObserver: MutationObserverImpl,
    fetch: fetchImpl,

    // Passthroughs for test harnesses
    getLocationHref: () => windowObject.location.href,
    setHistory: (...a) => windowObject.history.pushState(...a),

    /* --- History helpers for NavigationService --- */
    pushState   : (state = {}, title = '', url = '') =>
      windowObject.history.pushState(state, title, url),

    replaceState: (state = {}, title = '', url = '') =>
      windowObject.history.replaceState(state, title, url),

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
