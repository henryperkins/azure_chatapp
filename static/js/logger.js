/**
 * logger.js - Pure logging functionality, no delivery concerns
 * Emits events for external handlers to process
 */

export function createLogger({
  context = 'App',
  debug = false,
  minLevel = 'info',
  consoleEnabled = true,
  sessionIdProvider = () => null,
  traceIdProvider = () => null,
  domAPI,
  browserService,
  eventHandlers
}) {
  if (!domAPI) {
    throw new Error('[logger] Missing domAPI');
  }
  if (!browserService) {
    throw new Error('[logger] Missing browserService');
  }
  if (!eventHandlers) {
    throw new Error('[logger] Missing eventHandlers');
  }
  const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    critical: 4
  };
  levels.error = 3;

  let currentMinLevel = levels[minLevel] || levels.info;

  function shouldLog(level) {
    return levels[level] >= currentMinLevel;
  }

  function formatLogEntry(level, message, data, metadata) {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: metadata?.context || context,
      sessionId: sessionIdProvider(),
      traceId: traceIdProvider(),
      data: data instanceof Error ? {
        name: data.name,
        message: data.message,
        stack: data.stack
      } : data,
      metadata
    };
  }

  function log(level, message, ...args) {
    if (!shouldLog(level)) return;

    // Parse args: [data], {metadata with context}
    let data = null;
    let metadata = {};

    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      if (lastArg && typeof lastArg === 'object' && 'context' in lastArg) {
        metadata = lastArg;
        args = args.slice(0, -1);
      }
    }

    if (args.length > 0) {
      data = args[0];
    }

    const logEntry = formatLogEntry(level, message, data, metadata);

    // Console output with colorization for readability
    if (consoleEnabled) {
      const method = console[level] || console.log;
      const prefix = `[${logEntry.timestamp}] [${level.toUpperCase()}] [${logEntry.context}]`;
      let color = '';
      switch (level) {
        case 'debug':
          color = 'color: #888';
          break;
        case 'info':
          color = 'color: #1976d2';
          break;
        case 'warn':
          color = 'color: #e65100';
          break;
        case 'error':
          color = 'color: #b71c1c; font-weight: bold';
          break;
        case 'critical':
          color = 'color: #fff; background: #b71c1c; font-weight: bold';
          break;
        default:
          color = '';
      }
      const consoleArgs = [`%c${prefix} ${message}`, color];
      if (data) consoleArgs.push(data);
      method.apply(console, consoleArgs);
    }

    // Emit event for log delivery, with fallback warning if emission fails
    try {
      const CustomEventCtor = browserService.getWindow?.()?.CustomEvent;
      if (domAPI && typeof domAPI.dispatchEvent === 'function' && CustomEventCtor) {
        const event = new CustomEventCtor('app:log', { detail: logEntry, bubbles: false });
        const target = domAPI.getDocument();
        if (target) {
          domAPI.dispatchEvent(target, event);
        } else {
          if (consoleEnabled) {
            console.warn('[logger] Could not emit app:log event: domAPI.getDocument() returned null');
          }
        }
      } else {
        if (consoleEnabled) {
          console.warn('[logger] Could not emit app:log event: domAPI.dispatchEvent or CustomEvent unavailable');
        }
      }
    } catch (e) {
      if (consoleEnabled) {
        console.warn('[logger] Exception during log event emission:', e);
      }
    }
  }

  return {
    debug: (message, ...args) => log('debug', message, ...args),
    info: (message, ...args) => log('info', message, ...args),
    warn: (message, ...args) => log('warn', message, ...args),
    critical: (message, ...args) => log('critical', message, ...args),
    log: (message, ...args) => log('info', message, ...args),

    withContext(newContext) {
      return createLogger({
        context: newContext,
        debug,
        minLevel,
        consoleEnabled,
        sessionIdProvider,
        traceIdProvider,
        domAPI,
        browserService,
        eventHandlers
      });
    },

    setMinLevel(level) {
      if (levels[level] !== undefined) {
        currentMinLevel = levels[level];
      }
    },

    cleanup() {
      eventHandlers.cleanupListeners({ context });
    },

    ['error']: (message, ...args) => log('error', message, ...args)
  };
}
