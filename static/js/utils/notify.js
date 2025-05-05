/**
 * Notification Utility Module.
 * Dependency-injected wrapper for app/site-wide notifications—ensuring context-rich grouping and full observability.
 *
 * Usage:
 *   - Always inject `notify` via DI in every factory/module (see notification-system.md & custominstructions.md).
 *   - All calls should provide context/module/source via options, or use notify.withContext() to enforce context.
 *   - Notifies are logged to backend and Sentry with deterministic groupKey and full context for every event.
 *
 * API:
 *   - .info(msg, opts?)
 *   - .success(msg, opts?)
 *   - .warn(msg, opts?)
 *   - .error(msg, opts?)
 *   - .apiError(msg, opts?) [context:'apiRequest']
 *   - .authWarn(msg, opts?) [context:'auth']
 *   - .withContext({module, context, source}[, extraOpts]) => boundNotifyUtil
 *   - Internal helpers: ._computeGroupKey, ._getCurrentTraceIds
 *   - DEV-only: ._devCheckContextCoverage
 *
 * @param {Object} deps - { notificationHandler, sentry, DependencySystem }
 * @returns {Object} - Notify util with grouped/context helpers
 */
export function createNotify({
  notificationHandler,
  sentry = typeof window !== 'undefined' ? window.Sentry : undefined,
  DependencySystem = typeof window !== 'undefined' ? window.DependencySystem : undefined
} = {}) {
  if (!notificationHandler?.show) throw new Error('notificationHandler missing');

  const DURATION = { info: 4000, success: 4000, warning: 6000, error: 0 };

  // --- Helpers ---
  function computeGroupKey({ type, context, module, source }) {
    // Deterministic: type|module|source|context
    return [type, module || '', source || '', context || ''].join('|');
  }

  function getCurrentTraceIds() {
    try {
      if (DependencySystem?.getCurrentTraceIds) {
        return DependencySystem.getCurrentTraceIds();
      }
      const S = sentry || (typeof window !== 'undefined' ? window.Sentry : undefined);
      if (S?.getCurrentHub) {
        const hub = S.getCurrentHub();
        const t = hub?.getScope?.()?.getTransaction?.();
        return {
          traceId: t?.traceId || null,
          transactionId: t?.spanId || t?.name || null
        };
      }
    } catch (err) {
      // Silent error handling as designed
    }
    return { traceId: null, transactionId: null };
  }

  function generateTransactionId() {
    if (DependencySystem?.generateTransactionId) {
      return DependencySystem.generateTransactionId();
    }
    return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }

  async function logNotificationToBackend(payload) {
    try {
      await fetch('/api/log_notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // Silent error handling as designed
    }
  }

  // DEV-mode: warn on missing context/module/source for grouped notifications
  function devCheckContextCoverage(type, opts, msg) {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return;
    if (window?.NODE_ENV === 'production') return;

    const grouping = opts?.group || opts?.groupKey;
    if (grouping && !(opts.context || opts.module || opts.source)) {
      console.warn('[notify] Grouped notification lacks context/module/source:', { type, msg, opts });
    }
    if (!opts.context && !opts.module && !opts.source) {
      console.warn('[notify] Notification missing context/module/source (should provide at least context):', { type, msg, opts });
    }
  }

  function send(msg, type = 'info', opts = {}) {
    // Dependency-injected user/session
    let user = 'unknown';
    try {
      user = (DependencySystem?.modules?.get?.('currentUser')?.username)
        || (window.currentUser?.username)
        || (window.currentUser?.name)
        || 'unknown';
    } catch (err) {
      // Silent error handling as designed
    }
    const timestamp = Date.now() / 1000;

    // Pull out those opts - allow all, but surface context/module/source strongly
    const {
      group,
      context,
      module,
      source,
      transactionId: explicitTransactionId,
      traceId: explicitTraceId,
      id,
      groupKey: explicitGroupKey,
      extra = {},
      ...restOpts
    } = opts || {};

    // Cover trace info, allow override or fallback to DI/Sentry
    const { traceId, transactionId } = {
      ...getCurrentTraceIds(),
      ...(explicitTransactionId || explicitTraceId ? {
        transactionId: explicitTransactionId || undefined,
        traceId: explicitTraceId || undefined
      } : {})
    };

    const _type = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';

    // Always deterministic—never allow blank legacy keys
    const groupKey = explicitGroupKey ||
      computeGroupKey({ type: _type, context, module, source });
    const eventId = id || `${groupKey}:${timestamp}`;

    // Canonical/observable notification payload, for backend, UI, Sentry, etc.
    const payload = {
      id: eventId,
      message: msg,
      type: _type,
      timestamp,
      user,
      groupKey,
      context,
      module,
      source,
      traceId,
      transactionId: transactionId || generateTransactionId(),
      extra
    };

    // DEV-mode: surface missing context/module/source early for correctness
    devCheckContextCoverage(_type, opts, msg);

    // --- Sentry Breadcrumb/Event ---
    if (sentry?.addBreadcrumb) {
      try {
        sentry.addBreadcrumb({
          category: 'notification',
          level: _type,
          message: msg,
          data: payload
        });
      } catch (err) {
        // Silent error handling as designed
      }
    }

    // Show notification to user (grouped/context, propagation of keys)
    notificationHandler.show(msg, _type, DURATION[_type], {
      ...restOpts,
      group,
      context,
      module,
      source,
      groupKey,
      traceId,
      transactionId: payload.transactionId,
      id: eventId,
      extra
    });

    // Backend log (fire and forget)
    logNotificationToBackend(payload);

    return eventId;
  }

  // -- Contextual helper factory: pre-binds module/context/source to avoid context misses
  function withContext(preset, defaults = {}) {
    if (!preset) throw new Error('notify.withContext requires a context/module/source preset');

    const { module, context, source } = preset;
    return {
      info: (msg, o = {}) => send(msg, 'info', { module, context, source, ...defaults, ...o }),
      success: (msg, o = {}) => send(msg, 'success', { module, context, source, ...defaults, ...o }),
      warn: (msg, o = {}) => send(msg, 'warning', { module, context, source, ...defaults, ...o }),
      error: (msg, o = {}) => send(msg, 'error', { module, context, source, ...defaults, ...o }),
      apiError: (msg, o = {}) => send(msg, 'error', { group: true, context: context || 'apiRequest', module, source, ...defaults, ...o }),
      authWarn: (msg, o = {}) => send(msg, 'warning', { group: true, context: context || 'auth', module, source, ...defaults, ...o })
    };
  }

  // --- Grouped/contextual helpers ---
  const notifyUtil = {
    info: (msg, o = {}) => send(msg, 'info', o),
    success: (msg, o = {}) => send(msg, 'success', o),
    warn: (msg, o = {}) => send(msg, 'warning', o),
    error: (msg, o = {}) => send(msg, 'error', o),
    apiError: (msg, o = {}) => send(
      msg, 'error', { group: true, context: 'apiRequest', ...o }
    ),
    authWarn: (msg, o = {}) => send(
      msg, 'warning', { group: true, context: 'auth', ...o }
    ),
    withContext,
    _computeGroupKey: computeGroupKey,
    _getCurrentTraceIds: getCurrentTraceIds,
    _devCheckContextCoverage: devCheckContextCoverage
  };

  return notifyUtil;
}
