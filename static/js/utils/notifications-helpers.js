/**
 * Notification & Error Observability Helpers.
 * Provides utilities for standardized error handling,
 * API-wrapping, DI-driven feedback hooks, debug/trace, and backend notification logging.
 *
 * @param {Object} deps - All dependencies must be injected, not imported or globalized.
 *   Expected keys: notify, errorReporter
 * @returns {Object} Helper API - { wrapApi, safeInvoker, emitReady, createDebugTools, logEventToServer }
 */

/**
 * Debug/trace tool: Lightweight stopwatch, traceId, trace logging.
 * Usage:
 *   import { createDebugTools } from './notifications-helpers.js';
 *   const debugTools = createDebugTools({ notify });
 *   const traceId = debugTools.start('SomeOperation');
 *   // ... do work
 *   debugTools.stop(traceId, 'SomeOperation');
 */
export function createDebugTools({ notify } = {}) {
  const _active = new Map();
  const _uuid   = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `trace-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const _log    = (...args) =>
    (notify?.debug ? notify.debug : window?.console?.debug?.bind(console) || (() => {}))(...args);

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
    _log(`[trace:stop ] ${label} (${dur} ms)`, { traceId: id, label, duration: dur });
    return dur;
  }
  return { start, stop, newTraceId: _uuid };
}

/**
 * Backend event logger. Used by notify/apiClient to ship important notification events to the backend for persistent logging.
 * Only sends 'warning' and 'error' types (by default).
 *
 * @param {string} type - One of 'debug','info','success','warning','error'
 * @param {string} message - The message to send
 * @param {Object} opts - Additional context
 */
export function logEventToServer(type, message, opts = {}) {
  const ALLOWED_LEVELS = new Set(['warning', 'error']);
  if (!ALLOWED_LEVELS.has(type)) return;
  try {
    const fullPayload = {
      type,
      message,
      msg: message,
      ...opts,
      _clientLogSource: "notifications-helpers.js",
    };
    fetch("/api/log_notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullPayload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Silent fallback
  }
}

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
export function maybeCapture(errorReporter, err, meta = {}) {
  if (!errorReporter) return;

  // Accepts both capture and captureException
  const captureFn =
    (typeof errorReporter.capture === 'function'
      ? errorReporter.capture
      : (typeof errorReporter.captureException === 'function'
          ? errorReporter.captureException
          : null));

  if (captureFn) captureFn.call(errorReporter, err, meta);
}

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
    maybeCapture(errorReporter, err, {
      context : src,
      module  : src,
      endpoint,
      method  : opts && opts.method
    });
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
      maybeCapture(errorReporter, err, {
        ...ctx,
        module : ctx && ctx.module,
        handler: fn.name || '(anonymous)',
        uncaughtCallback: true
      });
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
