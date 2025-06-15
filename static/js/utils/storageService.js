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

  const raw = browserService.getWindow().localStorage;

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
