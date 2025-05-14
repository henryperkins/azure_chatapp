// static/js/utils/notifications-helpers.js
/**
 * Notification & Error Observability Helpers.
 * Provides utilities for standardized error handling,
 * API-wrapping, DI-driven feedback hooks, debug/trace, and backend notification logging.
 */

/**
 * Notification & Error Observability Helpers.
 * Provides utilities for standardized error handling,
 * API-wrapping, DI-driven feedback hooks, debug/trace, and backend notification logging.
 * NOTE: All utilities now require module/context scoping via .withContext whenever possible.
 * All errors are reported via errorReporter.capture if provided.
 * All fetch-calls use injected apiClient.
 */

// Debug/trace tool
export function createDebugTools({ notify, errorReporter } = {}) {
  const _active = new Map();
  const _uuid = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `trace-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  // Always use notify in context
  const dbgNotify = notify?.withContext
    ? notify.withContext({ module: 'notifications-helpers', context: 'debugTools' })
    : notify;

  const _log = (message, source, details = {}) => {
    if (dbgNotify?.debug) dbgNotify.debug(message, { source, ...details });
    // No console allowed per guardrails
  };

  function start(label = '') {
    const id = _uuid();
    _active.set(id, performance.now());
    _log(`[trace:start] ${label}`, 'start', { traceId: id, label });
    return id;
  }

  function stop(id, label = '') {
    const t0 = _active.get(id);
    if (t0 == null) return null;
    const dur = +(performance.now() - t0).toFixed(1);
    _active.delete(id);
    _log(`[trace:stop] ${label} (${dur} ms)`, 'stop', { traceId: id, label, duration: dur });
    return dur;
  }

  return { start, stop, newTraceId: _uuid };
}

// Backend event logger (now requires injected apiClient)
export async function logEventToServer(type, message, opts = {}, { apiClient, notify, errorReporter } = {}) {
  const ALLOWED_LEVELS = new Set(['warning', 'error']);
  if (!ALLOWED_LEVELS.has(type)) return;

  const logNotify = notify?.withContext
    ? notify.withContext({ module: 'notifications-helpers', context: 'backendLogger' })
    : notify;

  try {
    const fullPayload = {
      type,
      message,
      msg: message,
      ...opts,
      _clientLogSource: "notifications-helpers.js",
    };
    if (apiClient) {
      await apiClient.post('/api/log_notification', fullPayload); // .post required
    } else {
      // fallback: must warn, per guardrails
      if (logNotify?.warn) {
        logNotify.warn('No apiClient injected for backend event logging', {
          source: 'logEventToServer-missingApiClient'
          // module & context are from logNotify
        });
      }
    }
  } catch (err) {
    if (logNotify?.error) {
      logNotify.error('Failed to send log to server', {
        source: 'logEventToServer-apiClientError',
        originalError: err,
        message // keep original message for context
        // module & context are from logNotify
      });
    }
    if (errorReporter?.capture) {
      errorReporter.capture(err, {
        module: 'notifications-helpers',
        method: 'logEventToServer',
        originalError: err,
        message,
        details: 'Error during apiClient.post to /api/log_notification'
      });
    }
    // No console fallback per codebase rules.
  }
}

// Error capture helper
export function maybeCapture(errorReporter, err, meta = {}) {
  if (!errorReporter) return;

  const captureFn = errorReporter.capture || errorReporter.captureException;
  if (captureFn) {
    try {
      captureFn.call(errorReporter, err, meta);
    } catch (captureErr) {
      // Guardrail: capture our own capture errors for observability, no leaking PII/tokens
      if (errorReporter && typeof errorReporter.capture === "function" && captureErr !== err) {
        try {
          errorReporter.capture(captureErr, {
            module: "notifications-helpers",
            method: "maybeCapture",
            originalError: captureErr,
            context: meta?.context || undefined
          });
        } catch (finalCaptureErr) {
          if (errorReporter && typeof errorReporter.capture === "function") {
            try {
              errorReporter.capture(finalCaptureErr, {
                module: "notifications-helpers",
                method: "maybeCapture-finalfallback",
                originalError: finalCaptureErr,
                context: meta?.context || undefined
              });
            } catch {/* absolute fail-safe: must not leak */}
          }
        }
      }
      // Silently swallow: error handling must never throw outward
    }
  }
}

// Get API notify instance
export function getApiNotify(notify) {
  return notify.withContext({ context: 'apiRequest', module: 'api' });
}

// Compute notification group key
export function computeGroupKey({ type, context, module, source } = {}) {
  return [type, module || '', source || '', context || ''].join('|');
}

// API wrapper
export async function wrapApi(apiFn, { notify, errorReporter }, endpoint, opts = {}, src = 'api') {
  const apiNotify = notify.withContext
    ? notify.withContext({ context: 'apiRequest', module: 'api' })
    : notify;

  try {
    return await apiFn(endpoint, opts);
  } catch (err) {
    apiNotify.error(`API call failed: ${endpoint}`, {
      source: src, // Use 'src' as the source of the API call
      endpoint,
      method: opts?.method,
      originalError: err
      // module & context 'apiRequest' are from apiNotify
    });
    // maybeCapture is already called by the more specific errorReporter.capture below
    if (errorReporter && typeof errorReporter.capture === 'function') {
      errorReporter.capture(err, {
        module: 'notifications-helpers', // Module where wrapApi lives
        method: 'wrapApi', // The helper method itself
        context: src, // The specific context/source of the API call
        endpoint,
        httpMethod: opts?.method, // Consistent naming with other error captures
        originalError: err,
        fromUtils: true // Indicates error captured within a utility
      });
    }
    throw err;
  }
}

// Safe invoker
export function safeInvoker(fn, { notify, errorReporter }, ctx) {
  const safeNotify = notify?.withContext
    ? notify.withContext({ module: ctx?.module || 'notifications-helpers', context: ctx?.context || 'safeInvoker' })
    : notify;

  return function (...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      const sourceName = fn.name || (ctx?.source) || 'anonymousCallback';
      safeNotify?.error('Uncaught callback error', {
        source: sourceName, // module & context are from safeNotify
        group: true, // Keep grouping if desired
        originalError: err,
        extraContext: ctx // Pass along original ctx if needed
      });

      // maybeCapture is already called by the more specific errorReporter.capture below
      if (errorReporter && typeof errorReporter.capture === 'function') {
        try {
          errorReporter.capture(err, {
            module: ctx?.module || 'notifications-helpers', // Module where safeInvoker is used or helper itself
            method: 'safeInvoker', // The helper method
            context: ctx?.context || 'callbackError', // Original context
            handlerName: fn.name || '(anonymous)',
            originalError: err,
            uncaughtCallback: true,
            fromUtils: true // Indicates error captured within a utility
          });
        } catch (captureErr) {
          // Final guardrail: capture our own error reporting failures if possible
          if (errorReporter && typeof errorReporter.capture === "function" && captureErr !== err) {
            try {
              errorReporter.capture(captureErr, {
                module: "notifications-helpers",
                method: "safeInvoker-captureErr",
                originalError: captureErr,
                details: "Error while trying to report an error from safeInvoker"
              });
            } catch (finalCaptureErr) {
              // Absolute fail-safe, do nothing to prevent infinite loops
            }
          }
        }
      }
    }
  };
}

// Ready notification
export function emitReady({ notify }, who) {
  const readyNotify = notify?.withContext
    ? notify.withContext({ module: 'notifications-helpers', context: 'emitReady' }) // Base context
    : notify;
  readyNotify.info(`${who} ready`, {
    source: `emitReady-${who.toLowerCase().replace(/\s+/g, '-')}`, // Specific source for this emission
    group: true
    // module & context 'emitReady' are from readyNotify
  });
}
