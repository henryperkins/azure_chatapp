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
  apiClient = null,           // NEW: Use centralized API client
  browserService = null,
  sessionIdProvider = null,
  traceIdProvider = null,
  safeHandler = null,
  allowUnauthenticated = false,   // NEW
  consoleEnabled = true,    // NEW
  eventHandlers = null      // NEW
} = {}) {
  const _win = browserService?.getWindow?.();   // unified, DI-safe window
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

    // If you need authentication logic, pass isAuthenticated directly via createLogger options in DI.


    if (LEVELS[level] < _minLvlNum) return;

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

      // Fallback to direct fetch (without CSRF protection) - This section should ideally be removed if apiClient is always present.
      // If apiClient is null (e.g. very early logger before DI is set up, and allowUnauthenticated is true)
      // then this fetch might be used.
      if (!apiClient) { // Only use direct fetch if apiClient was not provided/configured
        const _fetch =
          fetcher ||
          browserService?.fetch ||
          (_win?.fetch) ||
          (typeof fetch === 'function' ? fetch : null);
        if (!_fetch) return;                   // no fetch available

        const response = await _fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': reqId,
            'X-Correlation-ID': reqId,
            ...(traceId ? { 'X-Trace-ID': traceId } : {})
          },
          credentials: 'include', // This might be an issue if cookies are not correctly set for unauthenticated requests
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
          const _c = (_win?.console) || { warn: () => { } };
          _c.warn(`[Logger] Server responded with ${response.status} for ${endpoint} (Level: ${level})`);
        }
      }
    } catch (err) {
      // Surface client-side failures (e.g., network down, CORS, 0 response) - use fallback logging
      const _c = (_win?.console) || { warn: () => { } };
      _c.warn(`[Logger] Fetch to ${endpoint} failed (Level: ${level}): ${err && err.message ? err.message : err}`);
    }
  }
  const _c = (_win?.console) || { log: () => { }, info: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
  function wrap(level, fn = _c.log) {
    const safe = safeHandler ? safeHandler(fn, `logger:${level}`) : fn;
    return (...args) => {
      if (consoleEnabled) safe(`[${context}]`, ...args);
      void send(level, args);
    };
  }

  // Mutators for runtime control
  function setServerLoggingEnabled(flag = true) { _enableServer = !!flag; }
  function setMinLevel(lvl = 'info') {   // accepts 'debug' … 'fatal'
    if (LEVELS[lvl]) _minLvlNum = LEVELS[lvl];
  }

  // Upgrade logger with API client for proper CSRF handling
  function upgradeWithApiClient(newApiClient) {
    if (newApiClient && typeof newApiClient.post === 'function') {
      // This function is now largely redundant if logger is created with apiClient.
      // Kept for now in case of specific scenarios, but its usage in app.js is removed.
      apiClient = newApiClient;
    }
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
    cleanup() {
      if (eventHandlers?.cleanupListeners)
        eventHandlers.cleanupListeners({ context: 'logger' });
    }
  };
}
