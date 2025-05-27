// Canonical SafeHandler implementation for DI
// Exports createSafeHandler({ logger }) factory ONLY
// Enforces: strict DI, no direct global/console/window access,
// required "cleanup" method, single source of truth.

export function createSafeHandler({ logger, eventHandlers } = {}) {
  if (!logger || typeof logger.error !== 'function') {
    throw new Error('[SafeHandler] DI logger with .error() required');
  }

  // Wrap a handler function for safety, context, and traceability.
  // Usage: safeHandlerFunction(fn, description), or safeHandlerFunction(fn)
  function safeHandlerFunction(fn, description) {
    if (typeof fn !== 'function') {
      throw new TypeError('[SafeHandler] Provided arg is not a function');
    }
    // Description is for structured log context; may be omitted.
    return function (...args) {
      try {
        return fn.apply(this, args);
      } catch (err) {
        // Always use structured logging (never direct console).
        logger.error(
          '[SafeHandler] Unhandled error in handler',
          err,
          { context: `SafeHandler:${description || 'unknown'}` }
        );
        // Optionally rethrow or swallow; here, swallow to suppress UI breakage.
        // Uncomment this line to propagate errors if needed:
        // throw err;
      }
    };
  }

  // Return object with cleanup method as required by factory pattern
  return {
    // Main safeHandler function
    safeHandler: safeHandlerFunction,

    // Required cleanup method
    cleanup() {
      if (eventHandlers && eventHandlers.cleanupListeners) {
        eventHandlers.cleanupListeners({ context: 'SafeHandler' });
      }
    }
  };
}
