/**
 * storageService.js — DI-safe localStorage wrapper (from globalUtils).
 * Uses browserService for access.
 *
 * Usage:
 *   import { createStorageService } from './storageService.js';
 *   const storage = createStorageService({ browserService, APP_CONFIG });
 */

export function createStorageService({ browserService, APP_CONFIG }) {
  function safe(fn, fallback, ctx) {
    try {
      return fn();
    } catch (err) {
      if (APP_CONFIG?.DEBUG) console.warn(`[storageService] ${ctx} failed`, err);
      return fallback;
    }
  }

  return {
    getItem: (k) => safe(() => browserService.getItem(k), null, "getItem"),
    setItem: (k, v) => safe(() => browserService.setItem(k, v), undefined, "setItem"),
    removeItem: (k) => safe(() => browserService.removeItem(k), undefined, "removeItem"),
    clear: () => safe(() => browserService.clear?.(), undefined, "clear"),
    key: (n) => safe(() => browserService.key?.(n), null, "key"),
    get length() {
      return safe(() => browserService.length ?? 0, 0, "length");
    },
  };
}
