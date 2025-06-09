/**
 * Regression test – ensures that a placeholder implementation for
 * `tokenStatsManager` is present in the DependencySystem **before** the
 * core bootstrap phase (specifically before `coreInit` would attempt to
 * resolve the dependency via `createMessageHandler`).  The placeholder is
 * provided by `tokenStatsManagerProxy` during the early DI setup inside
 * `createAppInitializer`.
 *
 * The test only executes the Basic & Advanced service registration phases
 * (matching the order that runs before `coreInit`).  It does **not** fully
 * initialize the app – keeping the scope minimal while still catching
 * regressions where the proxy registration might be removed or renamed.
 */

import { createAppInitializer } from '../init/appInitializer.js';

function createMockDependencySystem() {
  const DS = {
    modules: new Map(),
    register(key, value) {
      this.modules.set(key, value);
    }
  };
  return DS;
}

function createStubBrowserService({ documentObject, windowObject } = {}) {
  const win = windowObject ?? {
    DOMPurify: {},
    EventTarget: class {
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return false; }
    },
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {},
    performance: { now: () => 0 },
    URL: { createObjectURL: () => '', revokeObjectURL: () => '' },
    document : documentObject
  };

  const doc = documentObject ?? {
    readyState: 'complete',
    getElementById: () => null,
    querySelector : () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ style: {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
  };

  win.document = doc;

  return {
    getWindow: () => win,
    getDocument: () => doc,
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout
  };
}

function createStubApiEndpoints() {
  return {
    endpoints: {
      AUTH_CSRF: '/api/csrf',
      AUTH_LOGIN: '/api/login',
      AUTH_LOGOUT: '/api/logout',
      AUTH_REGISTER: '/api/register',
      AUTH_VERIFY: '/api/verify',
      AUTH_REFRESH: '/api/refresh'
    },
    resolveApiEndpoints: () => ({}),
    cleanup: () => {}
  };
}

test('tokenStatsManager placeholder exists before coreInit', async () => {
  const DependencySystem = createMockDependencySystem();

  const appInit = createAppInitializer({
    DependencySystem,
    browserService: createStubBrowserService(),
    createChatManager: () => ({}),
    createApiEndpoints: () => createStubApiEndpoints(),
    APP_CONFIG: {
      TIMEOUTS: { DOM_READY: 1000 }
    },
    // The remaining optional config/factories are left undefined intentionally
  });

  // Execute only the DI service registration phases that precede coreInit
  await appInit.serviceInit.registerBasicServices();
  await appInit.serviceInit.registerAdvancedServices();

  expect(DependencySystem.modules.get('tokenStatsManager')).toBeDefined();
});
