/**
 * logger.js – Unified browser/server logger for DI
 * Logs to both browser console and a backend endpoint for terminal visibility.
 *
 * Usage (in app.js):
 *   import { createLogger } from './logger.js';
 *   const logger = createLogger({ endpoint: '/api/logs', enableServer: true, debug: ... });
 *   DependencySystem.register('logger', logger);
 */

const LEVELS = new Map([
  ['debug', 10], ['info', 20], ['log', 20],
  ['warn', 30],  ['error', 40], ['critical', 50], ['fatal', 60]
]);
export function createLogger({
  endpoint = '/api/logs',
  enableServer = true,
  debug = false,
  context = 'App',
  minLevel = 'debug',
  fetcher = null,
  apiClient = null,           // NEW: Use centralized API client
  browserService = null,
  sessionIdProvider = null,
  traceIdProvider = null,
  safeHandler = null,
  allowUnauthenticated = false,   // NEW
  consoleEnabled = true,    // NEW
  eventHandlers = null,     // NEW
  maxEventsPerMinute = 60   // Rate limit (events/min)
} = {}) {
  const _win = browserService?.getWindow?.();   // unified, DI-safe window
  let _minLvlNum = LEVELS.get(minLevel) ?? 10;
  let _enableServer = enableServer;

  // Rate-limiting state
  let _rateWindowStart = Date.now();
  let _eventsThisWindow = 0;

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

    // If you need authentication logic, pass isAuthenticated directly via createLogger options in DI.


    if ((LEVELS.get(level) ?? 99) < _minLvlNum) return;

    // ------- Rate limiter --------
    const now = Date.now();
    if (now - _rateWindowStart > 60000) {         // reset every minute
      _rateWindowStart = now;
      _eventsThisWindow = 0;
    }
    if (_eventsThisWindow >= maxEventsPerMinute) return; // drop excess
    _eventsThisWindow++;
    // ------------------------------

    try {
      // Generate request ID for correlation tracking
      const reqId = generateRequestId();

      const sessionId = sessionIdProvider?.() ||
        browserService?.getSessionId?.() ||
        (_win?.__APP_SESSION_ID) ||
        'unknown-session';
      const traceId = traceIdProvider?.();

      // Prefer centralized API client for proper CSRF handling
      if (apiClient?.post) {
        try {
          await apiClient.post(endpoint, {
            level,
            context,
            args,
            ts: Date.now(),
            request_id: reqId,
            session_id: sessionId,
            trace_id: traceId
          }, {
            headers: {
              'X-Request-ID': reqId,
              'X-Correlation-ID': reqId,
              ...(traceId ? { 'X-Trace-ID': traceId } : {})
            }
          });
          return; // Success with API client
        } catch (apiErr) {
          // Fall back to direct fetch if API client fails
          // THIS FALLBACK IS PROBLEMATIC AS IT BYPASSES CSRF
          // Per user request, this fallback should be reconsidered or removed
          // For now, keeping the log but the fetch call below will be removed or conditional
          const _c = (_win?.console) || { warn: () => { } };
          _c.warn(`[Logger] API client failed for ${endpoint} (Level: ${level}), falling back to direct fetch: ${apiErr && apiErr.message ? apiErr.message : apiErr}`);
          // If apiClient is provided, we should NOT fall back to a fetch without CSRF.
          // Throw or log critical error.
          _c.error(`[Logger] CRITICAL: API client failed for ${endpoint}. Log NOT sent via fallback to prevent CSRF bypass. Error: ${apiErr?.message}`);
          return; // Do not proceed to insecure fallback if apiClient was intended to be used.
        }
      }
      /* Insecure direct-fetch fallback removed – logger relies solely
         on apiClient.post to respect CSRF & auth. */
    } catch (err) {
      // Surface client-side failures (e.g., network down, CORS, 0 response) - use fallback logging
      const _c = (_win?.console) || { warn: () => { } };
      _c.warn(`[Logger] Fetch to ${endpoint} failed (Level: ${level}): ${err && err.message ? err.message : err}`);
    }
  }
  function createNoopConsole() {
    return ['log', 'info', 'warn', 'error', 'debug']
      .reduce((o, m) => { o[m] = () => {}; return o; }, {});
  }
  const _c = (_win?.console) || createNoopConsole();
  function wrap(level, fn = _c.log) {
    return (...args) => {
      /* resolve the latest safeHandler each invocation */
      const exec = safeHandler ? safeHandler(fn, `logger:${level}`) : fn;
      if (consoleEnabled) exec(`[${context}]`, ...args);
      void send(level, args);            // fire-and-forget
    };
  }

  // Mutators for runtime control
  function setServerLoggingEnabled(flag = true) { _enableServer = !!flag; }
  function setMinLevel(lvl = 'info') {   // accepts 'debug' … 'fatal'
    if (LEVELS.has(lvl)) _minLvlNum = LEVELS.get(lvl);
  }

  // Upgrade logger with API client for proper CSRF handling
  function upgradeWithApiClient(newApiClient) {
    if (newApiClient && typeof newApiClient.post === 'function') {
      // This function is now largely redundant if logger is created with apiClient.
      // Kept for now in case of specific scenarios, but its usage in app.js is removed.
      apiClient = newApiClient;
    }
  }

  /* allow late upgrade to the canonical safeHandler */
  function setSafeHandler(newSH) {
    if (typeof newSH === 'function') safeHandler = newSH;
  }

  return {
    log: wrap('log', _c.log),
    info: wrap('info', _c.info),
    warn: wrap('warn', _c.warn),
    error: wrap('error', _c.error),
    debug: debug ? wrap('debug', _c.debug ?? _c.log) : () => { },
    critical: wrap('critical', _c.error),
    fatal: wrap('fatal', _c.error),
    setServerLoggingEnabled,
    setMinLevel,
    upgradeWithApiClient,
    setSafeHandler,          // ← NEW
    cleanup() {
      if (eventHandlers?.cleanupListeners)
        eventHandlers.cleanupListeners({ context: 'logger' });
    }
  };
}
