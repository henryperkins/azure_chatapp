/**
 * logger.js – Unified browser/server logger for DI
 * Logs to both browser console and a backend endpoint for terminal visibility.
 *
 * Usage (in app.js):
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger({ endpoint: '/api/logs', enableServer: true, debug: ... });
 *   DependencySystem.register('logger', logger);
 */

export function createLogger({
  endpoint = '/api/logs',
  enableServer = true,
  debug = false,
  context = 'App'
} = {}) {
  async function send(level, args) {
    if (!enableServer) return;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level,
          context,
          args,
          ts: Date.now()
        })
      });
      if (!response.ok) {
        // Surface server-side log ingestion failures
        console.warn(`[Logger] Server responded with ${response.status} for ${endpoint} (Level: ${level})`);
      }
    } catch (err) {
      // Surface client-side failures (e.g., network down, CORS, 0 response)
      console.warn(`[Logger] Fetch to ${endpoint} failed (Level: ${level}): ${err && err.message ? err.message : err}`);
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
    log:   wrap('log',    console.log),
    info:  wrap('info',   console.info),
    warn:  wrap('warn',   console.warn),
    error: wrap('error',  console.error),
    debug: debug ? wrap('debug', console.debug) : () => {}
  };
}
