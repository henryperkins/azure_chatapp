/**
 * Notification & Error Observability Helpers.
 * Provides utilities for standardized error handling,
 * API-wrapping, and DI-driven feedback hooks.
 *
 * @param {Object} deps - All dependencies must be injected, not imported or globalized.
 *   Expected keys: notify, errorReporter
 * @returns {Object} Helper API - { wrapApi, safeInvoker, emitReady }
 */

/**
 * Wraps an API request function and pipes errors to notify.apiError.
 *
 * @param {Function} apiFn - Async function performing the API call.
 * @param {Object} deps - { notify, errorReporter, ...} All must be DI'd.
 * @param {string} endpoint - API endpoint string.
 * @param {Object} opts - API request options (method, payload, etc).
 * @param {string} [src] - Optional logical source, like 'projectManager'.
 * @returns {Promise<any>} API response if successful; pipes error otherwise.
 */
/**
 * Returns an apiNotify instance with preregistered context/module for wrapped API error reporting.
 * Use this at top-level before calling wrapApi.
 */
export function getApiNotify(notify) {
  return notify.withContext({ context: 'apiRequest', module: 'api' });
}

// ─── Shared helper: build deterministic notification group key ──
export function computeGroupKey({ type, context, module, source } = {}) {
  return [type, module || '', source || '', context || ''].join('|');
}

export async function wrapApi(apiFn, { notify, errorReporter }, endpoint, opts = {}, src = 'api') {
  const apiNotify = notify.withContext
    ? notify.withContext({ context: 'apiRequest', module: 'api' })
    : notify;
  try {
    return await apiFn(endpoint, opts);
  } catch (err) {
    apiNotify.error(`API call failed: ${endpoint}`, { endpoint, method: opts && opts.method, originalError: err });
    if (errorReporter) {
      errorReporter.capture(err, {
        context: src,
        module: src,
        endpoint,
        method: opts && opts.method
      });
    }
    throw err;
  }
}

/**
 * Creates a callback invoker that wraps the original fn,
 * catches all errors, and notifies with context.
 *
 * @param {Function} fn - The actual callback.
 * @param {Object} deps - { notify, errorReporter, ... } - DI only!
 * @param {Object} ctx - Additional context for grouping/logging.
 * @returns {Function} Wrapped callback function.
 */
export function safeInvoker(fn, { notify, errorReporter }, ctx) {
  return function (...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      const contextObj = {
        ...ctx,
        originalError: err
      };
      notify.error('Uncaught callback error', {
        group: true,
        ...contextObj
      });
      if (errorReporter) {
        errorReporter.capture(err, {
          ...ctx,
          module: ctx && ctx.module,
          handler: fn.name || '(anonymous)',
          uncaughtCallback: true
        });
      }
      // Silent: rethrow only for debugging, not production
    }
  };
}

/**
 * Emits a standard, grouped "ready" notification for DI lifecycle events.
 * Usage: Call from end of initialize() to confirm module wiring.
 *
 * @param {Object} deps - { notify, ... } Must be injected.
 * @param {string} who - Logical subsystem or feature (e.g., 'ChatManager').
 */
export function emitReady({ notify }, who) {
  notify.info(`${who} ready`, { group: true, context: who.toLowerCase() });
}
