/**
 * logger.js – Unified browser/server logger for DI
 * Logs to both browser console and a backend endpoint for terminal visibility.
 *
 * Usage (in app.js):
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger({ endpoint: '/api/logs', enableServer: true, debug: ... });
 *   DependencySystem.register('logger', logger);
 */

const LVL = { debug: 10, info: 20, log: 20, warn: 30, error: 40, critical: 50, fatal: 60 };

export function createLogger({
  endpoint = '/api/logs',
  enableServer = true,
  debug = false,
  context = 'App',
  minLevel = 'info',           // default threshold
  fetcher = null,             // ← NEW injectable fetch
  browserService = null,          // ← NEW optional DI
  authModule = null               // ← NEW optional DI: AuthModule for auth check
} = {}) {
  const THRESHOLD = LVL[minLevel] ?? LVL.info;
  async function send(level, args) {
    if (!enableServer) return;
    if (LVL[level] < THRESHOLD) return;          // NEW

    // Only send logs to backend if authenticated (if authModule is provided)
    if (authModule && typeof authModule.isAuthenticated === 'function' && !authModule.isAuthenticated()) {
      // Optionally, could log to browser only
      return;
    }

    try {
      const _fetch =
        fetcher ||
        browserService?.fetch ||
        (typeof window !== 'undefined' && window.fetch) ||
        (typeof fetch === 'function' ? fetch : null);
      if (!_fetch) return;                   // no fetch available

      const response = await _fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',                   // NEW – carry cookies / CSRF exempt
        body: JSON.stringify({ level, context, args, ts: Date.now() })
      });
      if (!response.ok) {
        // Surface server-side log ingestion failures - use fallback logging
        if (typeof window !== 'undefined' && window.console && window.console.warn) {
          window.console.warn(`[Logger] Server responded with ${response.status} for ${endpoint} (Level: ${level})`);
        }
      }
    } catch (err) {
      // Surface client-side failures (e.g., network down, CORS, 0 response) - use fallback logging
      if (typeof window !== 'undefined' && window.console && window.console.warn) {
        window.console.warn(`[Logger] Fetch to ${endpoint} failed (Level: ${level}): ${err && err.message ? err.message : err}`);
      }
    }
  }
  function wrap(level, fn) {
    return (...args) => {
      fn(`[${context}]`, ...args);
      // fire-and-forget, do not await to avoid blocking UI
      send(level, args);
    };
  }
  return {
    log: wrap('log', console.log),
    info: wrap('info', console.info),
    warn: wrap('warn', console.warn),
    error: wrap('error', console.error),
    debug: debug ? wrap('debug', console.debug) : () => { }
  };
}
