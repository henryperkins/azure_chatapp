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

  const _log = (...args) => {
    if (dbgNotify?.debug) dbgNotify.debug('[DebugTools]', { extra: args });
    // No console allowed per guardrails
  };

  function start(label = '') {
    const id = _uuid();
    _active.set(id, performance.now());
    _log(`[trace:start] ${label}`, { traceId: id, label });
    return id;
  }

  function stop(id, label = '') {
    const t0 = _active.get(id);
    if (t0 == null) return null;
    const dur = +(performance.now() - t0).toFixed(1);
    _active.delete(id);
    _log(`[trace:stop] ${label} (${dur} ms)`, { traceId: id, label, duration: dur });
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
          module: 'notifications-helpers',
          context: 'backendLogger'
        });
      }
    }
  } catch (err) {
    if (logNotify?.error) {
      logNotify.error('Failed to send log to server', {
        module: 'notifications-helpers',
        context: 'backendLogger',
        originalError: err,
        message
      });
    }
    if (errorReporter?.capture) {
      errorReporter.capture(err, {
        module: 'notifications-helpers',
        method: 'logEventToServer',
        originalError: err,
        message
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
      endpoint,
      method: opts?.method,
      originalError: err,
      module: 'notifications-helpers',
      context: src
    });
    maybeCapture(errorReporter, err, {
      context: src,
      module: 'notifications-helpers',
      endpoint,
      method: opts?.method
    });
    if (errorReporter && typeof errorReporter.capture === 'function') {
      errorReporter.capture(err, {
        context: src,
        module: 'notifications-helpers',
        endpoint,
        method: opts?.method,
        from: 'wrapApi'
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
      safeNotify?.error('Uncaught callback error', {
        group: true,
        ...ctx,
        module: ctx?.module || 'notifications-helpers',
        context: ctx?.context || 'callbackError',
        originalError: err
      });

      maybeCapture(errorReporter, err, {
        ...ctx,
        module: ctx?.module || 'notifications-helpers',
        handler: fn.name || '(anonymous)',
        uncaughtCallback: true
      });

      if (errorReporter && typeof errorReporter.capture === 'function') {
        try {
          errorReporter.capture(err, {
            ...ctx,
            module: ctx?.module || 'notifications-helpers',
            handler: fn.name || '(anonymous)',
            uncaughtCallback: true,
            from: 'safeInvoker'
          });
        } catch (captureErr) {
          // Final guardrail: capture our own error reporting failures if possible
          if (errorReporter && typeof errorReporter.capture === "function" && captureErr !== err) {
            try {
              errorReporter.capture(captureErr, {
                module: "notifications-helpers",
                method: "safeInvoker",
                handler: fn.name || '(anonymous)',
                originalError: captureErr,
                from: "safeInvoker-capture"
              });
            } catch (finalCaptureErr) {
              if (errorReporter && typeof errorReporter.capture === "function") {
                try {
                  errorReporter.capture(finalCaptureErr, {
                    module: "notifications-helpers",
                    method: "safeInvoker-finalfallback",
                    handler: fn.name || '(anonymous)',
                    originalError: finalCaptureErr,
                    from: "safeInvoker-capture-fallback"
                  });
                } catch {/* absolute fail-safe: must not leak */}
              }
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
    ? notify.withContext({ module: 'notifications-helpers', context: 'emitReady' })
    : notify;
  readyNotify.info(`${who} ready`, {
    group: true,
    context: who.toLowerCase(),
    module: 'notifications-helpers'
  });
}
