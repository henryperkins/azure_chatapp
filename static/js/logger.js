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
  traceIdProvider = () => null
}) {
  const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    critical: 4
  };

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

    // Console output
    if (consoleEnabled) {
      const method = console[level] || console.log;
      const prefix = `[${logEntry.timestamp}] [${level.toUpperCase()}] [${logEntry.context}]`;
      const consoleArgs = [`${prefix} ${message}`];
      if (data) consoleArgs.push(data);
      method.apply(console, consoleArgs);
    }

    // Emit event for external handlers
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      try {
        window.dispatchEvent(new CustomEvent('app:log', {
          detail: logEntry,
          bubbles: false
        }));
      } catch (e) {
        // Silent fail - don't create log loops
      }
    }
  }

  const logger = {
    debug: (message, ...args) => log('debug', message, ...args),
    info: (message, ...args) => log('info', message, ...args),
    warn: (message, ...args) => log('warn', message, ...args),
    error: (message, ...args) => log('error', message, ...args),
    critical: (message, ...args) => log('critical', message, ...args),

    withContext(newContext) {
      return createLogger({
        context: newContext,
        debug,
        minLevel,
        consoleEnabled,
        sessionIdProvider,
        traceIdProvider
      });
    },

    setMinLevel(level) {
      if (levels[level] !== undefined) {
        currentMinLevel = levels[level];
      }
    }
  };

  logger.log = logger.info;
  return logger;
}
