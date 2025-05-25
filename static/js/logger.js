/**
 * logger.js – Unified browser/server logger for DI
 * Logs to both browser console and a backend endpoint for terminal visibility.
 *
 * Usage (in app.js):
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger({ endpoint: '/api/logs', enableServer: true, debug: ... });
 *   DependencySystem.register('logger', logger);
 */

const LEVELS = { debug: 10, info: 20, log: 20, warn: 30, error: 40, critical: 50, fatal: 60 };
export function createLogger({
  endpoint = '/api/logs',
  enableServer = true,
  debug = false,
  context = 'App',
  minLevel = 'debug',
  fetcher = null,
  browserService = null,
  sessionIdProvider = null,
  traceIdProvider = null,
  safeHandler = null
} = {}) {
  let _minLvlNum = LEVELS[minLevel] ?? 10;
  let _enableServer = enableServer;

  // Generate a unique request ID for correlation tracking
  function generateRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older browsers
    return 'xxxx-xxxx-4xxx-yxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async function send(level, args) {
    if (!_enableServer) return;

    // Use canonical appModule.state (follows Dec 2024 auth guardrails)
    let appModule = null;
    if (typeof DependencySystem !== 'undefined' && DependencySystem?.modules?.get) {
      appModule = DependencySystem.modules.get('appModule');
    }
    if (appModule?.state?.isAuthenticated === false) return;

    if (LEVELS[level] < _minLvlNum) return;

    try {
      const _fetch =
        fetcher ||
        browserService?.fetch ||
        (typeof window !== 'undefined' && window.fetch) ||
        (typeof fetch === 'function' ? fetch : null);
      if (!_fetch) return;                   // no fetch available

      // Generate request ID for correlation tracking
      const reqId = generateRequestId();

      const sessionId = sessionIdProvider?.() ||
        browserService?.getSessionId?.() ||
        (typeof window !== 'undefined' && window.__APP_SESSION_ID) ||
        'unknown-session';
      const traceId = traceIdProvider?.();

      const response = await _fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': reqId,
          'X-Correlation-ID': reqId,
          ...(traceId ? { 'X-Trace-ID': traceId } : {})
        },
        credentials: 'include',
        body: JSON.stringify({
          level,
          context,
          args,
          ts: Date.now(),
          request_id: reqId,
          session_id: sessionId,
          trace_id: traceId
        })
      });
      if (!response.ok) {
        // Surface server-side log ingestion failures - use fallback logging
        const _c = (typeof window !== 'undefined' && window.console) || { warn: () => { } };
        _c.warn(`[Logger] Server responded with ${response.status} for ${endpoint} (Level: ${level})`);
      }
    } catch (err) {
      // Surface client-side failures (e.g., network down, CORS, 0 response) - use fallback logging
      const _c = (typeof window !== 'undefined' && window.console) || { warn: () => { } };
      _c.warn(`[Logger] Fetch to ${endpoint} failed (Level: ${level}): ${err && err.message ? err.message : err}`);
    }
  }
  const _c = (typeof window !== 'undefined' && window.console) || { log: () => { }, info: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
  function wrap(level, fn = _c.log) {
    const safe = safeHandler ? safeHandler(fn, `logger:${level}`) : fn;
    return (...args) => { safe(`[${context}]`, ...args); void send(level, args); };
  }

  // Mutators for runtime control
  function setServerLoggingEnabled(flag = true) { _enableServer = !!flag; }
  function setMinLevel(lvl = 'info') {   // accepts 'debug' … 'fatal'
    if (LEVELS[lvl]) _minLvlNum = LEVELS[lvl];
  }

  return {
    log: wrap('log', _c.log),
    info: wrap('info', _c.info),
    warn: wrap('warn', _c.warn),
    error: wrap('error', _c.error),
    debug: debug ? wrap('debug', _c.debug) : () => { },
    critical: wrap('critical', _c.error),
    fatal: wrap('fatal', _c.error),
    setServerLoggingEnabled,
    setMinLevel
  };
}
