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
  function send(level, args) {
    if (!enableServer) return;
    try {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level,
          context,
          args,
          ts: Date.now()
        })
      });
    } catch (err) {
      // Fail gracefully (network/log bridge errors never block UI)
    }
  }
  function wrap(level, fn) {
    return (...args) => {
      fn(`[${context}]`, ...args);
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
