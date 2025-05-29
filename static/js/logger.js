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
  context = 'App',
  debug = false,
  minLevel = 'info',
  enableServer = true,
  apiClient,
  browserService,
  sessionIdProvider = () => null,
  traceIdProvider = () => null,
  safeHandler,
  consoleEnabled = true,
  allowUnauthenticated = false
}) {
  // Validate required dependencies
  if (!apiClient) throw new Error('Logger requires apiClient');
  if (!browserService) throw new Error('Logger requires browserService');
  if (!safeHandler) throw new Error('Logger requires safeHandler');

  const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  let currentMinLevel = levels[minLevel] || levels.info;
  let serverLoggingEnabled = enableServer;
  let buffer = [];
  const MAX_BUFFER_SIZE = 100;
  const BATCH_INTERVAL = 5000; // 5 seconds
  let batchTimer = null;

  function shouldLog(level) {
    return levels[level] >= currentMinLevel;
  }

  function formatLogEntry(level, message, data, metadata) {
    const timestamp = new Date().toISOString();
    const sessionId = sessionIdProvider();
    const traceId = traceIdProvider();

    // Extract error details if present
    let errorDetails = null;
    if (data instanceof Error) {
      errorDetails = {
        name: data.name,
        message: data.message,
        stack: data.stack
      };
    }

    return {
      timestamp,
      level,
      message,
      context: metadata?.context || context,
      sessionId,
      traceId,
      data: errorDetails || data,
      metadata: {
        ...metadata,
        userAgent: browserService.getUserAgent(),
        url: window.location.href
      }
    };
  }

  // Helper to deep-sanitize an object for JSON serialization,
  // converts Error objects to string, drops unserializables
  function jsonSafeClone(obj) {
    const seen = new WeakSet();
    function _clone(val) {
      if (val === null || typeof val === "undefined") return val;
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return val;
      if (typeof val === "function" || typeof val === "symbol") return undefined;
      if (val instanceof Error) {
        return `${val.name}: ${val.message}`;
      }
      if (Array.isArray(val)) return val.map(_clone);
      if (typeof val === "object") {
        if (seen.has(val)) return undefined; // Prevent cycles
        seen.add(val);
        const out = {};
        for (const k in val) {
          try {
            out[k] = _clone(val[k]);
          } catch (_e) {
            out[k] = undefined;
          }
        }
        seen.delete(val);
        return out;
      }
      try {
        return JSON.parse(JSON.stringify(val)); // fallback for unexpected types
      } catch {
        return String(val);
      }
    }
    return _clone(obj);
  }

  async function send(logs) {
    if (!serverLoggingEnabled || logs.length === 0) return;

    try {
      // Ensure we have proper authentication or allowUnauthenticated is true
      const appModule = safeHandler(() => {
        const DependencySystem = window.DependencySystem;
        return DependencySystem?.modules?.get('appModule');
      });

      const isAuthenticated = appModule?.state?.isAuthenticated || false;

      if (!isAuthenticated && !allowUnauthenticated) {
        if (debug) {
          console.log('[Logger] Skipping server log - not authenticated');
        }
        return;
      }

      // Sanitize logs & format the payload according to backend model
      const sanitizedLogs = logs.map(log => ({
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        context: log.context,
        session_id: log.sessionId,
        trace_id: log.traceId,
        data: jsonSafeClone(log.data || {}),
        metadata: jsonSafeClone(log.metadata || {}),
        args: []
      }));
      const payload = { logs: sanitizedLogs };

      // Always use returnFullResponse to get {status}
      const resp = await apiClient.post('/api/logs', payload, {
        headers: {
          'Content-Type': 'application/json',
          // CSRF token auto-injected by apiClient
        },
        credentials: 'include',
        returnFullResponse: true
      });

      // Handle response status for retry/no retry
      if (typeof resp.status === "number") {
        if (resp.status >= 500) {
          if (debug) {
            console.error('[Logger] Server error during log delivery, status:', resp.status);
          }
          // retry: leave logs in buffer
        } else if (resp.status >= 400) {
          // client error: drop logs, do not retry
          if (debug) {
            console.warn('[Logger] Dropping log batch due to client error status:', resp.status);
          }
          buffer = [];
        } else {
          // success
          buffer = [];
        }
      } else {
        // fallback
        buffer = [];
      }
    } catch (error) {
      if (debug) {
        console.error('[Logger] Error sending logs:', error);
      }
      // Keep logs in buffer for retry on transient errors
    }
  }

  function scheduleBatch() {
    if (batchTimer) return;

    batchTimer = setTimeout(() => {
      batchTimer = null;
      if (buffer.length > 0) {
        const logsToSend = [...buffer];
        buffer = [];
        send(logsToSend);
      }
    }, BATCH_INTERVAL);
  }

  function log(level, message, ...args) {
    if (!shouldLog(level)) return;

    // Extract data and metadata from args
    let data = null;
    let metadata = {};

    // Last argument should be metadata with context
    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      if (lastArg && typeof lastArg === 'object' && 'context' in lastArg) {
        metadata = lastArg;
        args = args.slice(0, -1);
      }
    }

    // If there's still an argument, it's data (could be Error or object)
    if (args.length > 0) {
      data = args[0];
    }

    const logEntry = formatLogEntry(level, message, data, metadata);

    // Console output
    if (consoleEnabled) {
      const consoleMethod = console[level] || console.log;
      const consoleArgs = [
        `[${logEntry.timestamp}] [${level.toUpperCase()}] [${logEntry.context}] ${message}`
      ];
      if (data) consoleArgs.push(data);
      consoleMethod(...consoleArgs);
    }

    // Buffer for server
    if (serverLoggingEnabled) {
      buffer.push(logEntry);

      // Trim buffer if too large
      if (buffer.length > MAX_BUFFER_SIZE) {
        buffer = buffer.slice(-MAX_BUFFER_SIZE);
      }

      // Schedule batch send
      scheduleBatch();
    }
  }

  // Public API
  const logger = {
    debug: (message, ...args) => log('debug', message, ...args),
    info: (message, ...args) => log('info', message, ...args),
    warn: (message, ...args) => log('warn', message, ...args),
    error: (message, ...args) => log('error', message, ...args),

    withContext(newContext) {
      return createLogger({
        context: newContext,
        debug,
        minLevel,
        enableServer: serverLoggingEnabled,
        apiClient,
        browserService,
        sessionIdProvider,
        traceIdProvider,
        safeHandler,
        consoleEnabled,
        allowUnauthenticated
      });
    },

    setMinLevel(level) {
      if (levels[level] !== undefined) {
        currentMinLevel = levels[level];
      }
    },

    setServerLoggingEnabled(enabled) {
      serverLoggingEnabled = enabled;
      if (!enabled && batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
        buffer = [];
      }
    },

    // Force send any buffered logs
    async flush() {
      if (buffer.length > 0) {
        const logsToSend = [...buffer];
        buffer = [];
        await send(logsToSend);
      }
    },

    // Cleanup
    cleanup() {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      // Try to send remaining logs
      if (buffer.length > 0 && serverLoggingEnabled) {
        send([...buffer]);
      }
      buffer = [];
    }
  };

  return logger;
}
