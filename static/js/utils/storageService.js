/**
 * storageService.js — DI-safe localStorage wrapper.
 * Provides a canonical storage API delegating to Window.localStorage.
 *
 * Usage:
 *   import { createStorageService } from './storageService.js';
 *   const storage = createStorageService({ browserService, APP_CONFIG });
 */

export function createStorageService({ browserService, APP_CONFIG, logger, DependencySystem }) {
  if (!browserService) throw new Error('[storageService] browserService required');
  if (!logger) throw new Error('[storageService] logger required');

  // In headless environments like Jest `window.localStorage` may be
  // undefined because no real DOM is available.  To keep unit tests
  // independent from the real browser implementation we transparently
  // fall back to a lightweight in-memory storage shim that implements
  // the *same* synchronous API surface used below.

  const memoryStore = (() => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (n) => Array.from(store.keys())[n] ?? null,
      get length() { return store.size; }
    };
  })();

  const raw = browserService.getWindow().localStorage || memoryStore;

  function safeAccess(fn, ctx) {
    try {
      return fn();
    } catch (err) {
      logger.error(`[storageService] ${ctx} failed`, err, { context: `storageService:${ctx}` });
      throw new Error(`[storageService] ${ctx} failed and fallback is forbidden: ${err?.message || err}`);
    }
  }

  return {
    getItem: (k) => safeAccess(() => raw.getItem(k), 'getItem'),
    setItem: (k, v) => safeAccess(() => raw.setItem(k, v), 'setItem'),
    removeItem: (k) => safeAccess(() => raw.removeItem(k), 'removeItem'),
    clear: () => safeAccess(() => raw.clear(), 'clear'),
    key: (n) => safeAccess(() => raw.key(n), 'key'),
    get length() {
      return safeAccess(() => raw.length, 'length');
    },
    cleanup() {}
  };
}
