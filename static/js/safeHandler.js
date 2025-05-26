// Canonical SafeHandler implementation for DI
// Exports createSafeHandler({ logger }) factory ONLY
// Enforces: strict DI, no direct global/console/window access,
// required "cleanup" method, single source of truth.

export function createSafeHandler({ logger }) {
  if (!logger || typeof logger.error !== 'function') {
    throw new Error('[SafeHandler] DI logger with .error() required');
  }

  // Wrap a handler function for safety, context, and traceability.
  // Usage: safeHandler(fn, description), or safeHandler(fn)
  function safeHandler(fn, description) {
    if (typeof fn !== 'function') {
      throw new TypeError('[SafeHandler] Provided arg is not a function');
    }
    // Description is for structured log context; may be omitted.
    return function(...args) {
      try {
        return fn.apply(this, args);
      } catch (err) {
        // Always use structured logging (never direct console).
        logger.error(
          '[SafeHandler] Unhandled error in handler',
          {
            error: err,
            description: description || fn.name || '<anon>',
            args,
            context: 'SafeHandler'
          }
        );
        // Optionally rethrow or swallow; here, swallow to suppress UI breakage.
        // Uncomment this line to propagate errors if needed:
        // throw err;
      }
    };
  }

  // Required cleanup method (no-ops since this is stateless)
  safeHandler.cleanup = function() { /* nothing to cleanup */ };

  return {
    safeHandler,
    cleanup: safeHandler.cleanup
  };
}
