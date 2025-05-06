/**
 * Browser-level helpers (DI strict, testable).
 * @param {Object} deps
 * @param {Window} deps.windowObject – injected window for testability
 */
export function createBrowserService({ windowObject = window } = {}) {
  if (!windowObject?.location) throw new Error('browserService: windowObject is required');

  function buildUrl(params = {}) {
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

  return {
    // Query-string helpers
    buildUrl,
    getSearchParam: (k) => new URL(windowObject.location.href).searchParams.get(k),
    setSearchParam: (k, v) => windowObject.history.replaceState({}, '', buildUrl({ [k]: v })),
    removeSearchParam: (k) => windowObject.history.replaceState({}, '', buildUrl({ [k]: '' })),

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

    // Browser APIs for DI/testability
    FormData: FormDataImpl,
    MutationObserver: MutationObserverImpl,
    fetch: fetchImpl,

    // Passthroughs for test harnesses
    getLocationHref: () => windowObject.location.href,
    setHistory: (...a) => windowObject.history.pushState(...a),
  };
}
