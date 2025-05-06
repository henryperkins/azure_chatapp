import { computeGroupKey } from './notifications-helpers.js';

export function createNotify({
  notificationHandler,
  sentry = typeof window !== 'undefined' ? window.Sentry : undefined,
  DependencySystem = typeof window !== 'undefined' ? window.DependencySystem : undefined
} = {}) {
  if (!notificationHandler?.show) throw new Error('notificationHandler missing');

  const DURATION = { debug: 3000, info: 4000, success: 4000, warning: 6000, error: 0 };

  // --- Helpers ---

  const getCurrentTraceIds = () => {
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
    } catch { // Silent catch - previously renamed to avoid conflict if outer scope has err
      // console.warn('[notify] Error in getCurrentTraceIds:', _errCaught); // Optional: log if needed
    }
    return { traceId: null, transactionId: null };
  };

  const generateTransactionId = () => {
    if (DependencySystem?.generateTransactionId) {
      return DependencySystem.generateTransactionId();
    }
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
    }
    // Fallback: not cryptographically secure
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  const logNotificationToBackend = async (payload) => {
    try {
      await fetch('/api/log_notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch { // Silent catch - previously had unused variable
      // console.warn('[notify] Failed to log notification to backend:', _errCaught); // Optional: log if needed
    }
  };

  // DEV-mode: warn on missing context/module/source for grouped notifications
  const devCheckContextCoverage = (type, opts, msg) => {
    if (
      (typeof window !== 'undefined' && window.NODE_ENV === 'production') ||
      (typeof window !== 'undefined' && window.__ENV__ && window.__ENV__.NODE_ENV === 'production')
    ) return;

    const grouping = opts?.group || opts?.groupKey;
    if (grouping && !(opts.context || opts.module || opts.source)) {
      console.warn('[notify] Grouped notification lacks context/module/source:', { type, msg, opts });
    }
    if (!opts.context && !opts.module && !opts.source) {
      console.warn('[notify] Notification missing context/module/source (should provide at least context):', { type, msg, opts });
    }
  };

  const send = (msg, type = 'info', opts = {}) => {
    // Map 'warn' to 'warning'
    let _type = type === 'warn' ? 'warning' : type;
    if (!['debug', 'info', 'success', 'warning', 'error'].includes(_type)) _type = 'info';

    // Dependency-injected user/session
    let user = 'unknown';
    try {
      if (DependencySystem && DependencySystem.modules && typeof DependencySystem.modules.get === 'function') {
        const currentUserModule = DependencySystem.modules.get('currentUser');
        if (currentUserModule) {
          user = currentUserModule.username || currentUserModule.name || 'unknown';
        }
      } else if (window.currentUser) { // Fallback if DependencySystem.modules is not available
        user = window.currentUser.username || window.currentUser.name || 'unknown';
      }
    } catch (_userError) { // Changed err to error to avoid conflict if outer scope has err
      // Optional: log this internal error during development if DependencySystem was expected
      // console.warn('[notify] Error retrieving current user for notification:', _userError);
    }

    const timestamp = Date.now() / 1000;

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

    const { traceId, transactionId } = {
      ...getCurrentTraceIds(),
      ...(explicitTransactionId || explicitTraceId ? {
        transactionId: explicitTransactionId || undefined,
        traceId: explicitTraceId || undefined
      } : {})
    };

    const groupKey = explicitGroupKey ||
      computeGroupKey({ type: _type, context, module, source });
    const eventId = id || `${groupKey}:${timestamp}`;

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
      } catch (_sentryBreadcrumbErr) { // Renamed to avoid conflict
        // console.warn('[notify] Error adding Sentry breadcrumb:', _sentryBreadcrumbErr); // Optional: log if needed
      }
    }

    notificationHandler.show(msg, _type, {
      timeout: DURATION[_type],           // ← moved inside opts
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

    logNotificationToBackend(payload);

    return eventId;
  };

  // -- Contextual helper factory: pre-binds module/context/source to avoid context misses
  const withContext = (preset, defaults = {}) => {
    if (!preset) throw new Error('notify.withContext requires a context/module/source preset');
    const { module, context, source } = preset;
    return {
      debug: (msg, o = {}) => send(msg, 'debug', { module, context, source, ...defaults, ...o }),
      info: (msg, o = {}) => send(msg, 'info', { module, context, source, ...defaults, ...o }),
      success: (msg, o = {}) => send(msg, 'success', { module, context, source, ...defaults, ...o }),
      warn: (msg, o = {}) => send(msg, 'warning', { module, context, source, ...defaults, ...o }),
      error: (msg, o = {}) => send(msg, 'error', { module, context, source, ...defaults, ...o }),
      apiError: (msg, o = {}) => send(msg, 'error', { group: true, context: context || 'apiRequest', module, source, ...defaults, ...o }),
      authWarn: (msg, o = {}) => send(msg, 'warning', { group: true, context: context || 'auth', module, source, ...defaults, ...o })
    };
  };

  return {
    debug: (msg, o = {}) => send(msg, 'debug', o),
    info: (msg, o = {}) => send(msg, 'info', o),
    success: (msg, o = {}) => send(msg, 'success', o),
    warn: (msg, o = {}) => send(msg, 'warning', o),
    error: (msg, o = {}) => send(msg, 'error', o),
    apiError: (msg, o = {}) => send(msg, 'error', { group: true, context: 'apiRequest', ...o }),
    authWarn: (msg, o = {}) => send(msg, 'warning', { group: true, context: 'auth', ...o }),
    withContext,
    _computeGroupKey: computeGroupKey,
    _getCurrentTraceIds: getCurrentTraceIds,
    _devCheckContextCoverage: devCheckContextCoverage
  };
}
