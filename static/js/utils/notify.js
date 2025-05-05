/**
 * Notification Utility Module.
 * Dependency-injected wrapper for app/site-wide notifications.
 *
 * Usage:
 *   - Always inject `notify` via DI (DependencySystem.modules.get('notify')) in every module/factory; never import notification handler directly.
 *   - Use grouped/contextual helpers for all user/system messages (e.g. notify.info, notify.success, notify.error, notify.apiError).
 *   - See notification-system.md and custominstructions.md for DI architecture and usage guidelines.
 *
 * Upgraded: Now includes context-rich, structured payloads, deterministic groupKey, transaction/correlation IDs,
 * Sentry breadcrumb integration (if sentry DI provided), and full backward compatibility.
 *
 * API:
 *   - .info(msg, opts?)         // info banner
 *   - .success(msg, opts?)      // success banner
 *   - .warn(msg, opts?)         // warning banner
 *   - .error(msg, opts?)        // error banner (group/context strongly recommended)
 *   - .apiError(msg, opts?)     // error, grouped by API context
 *   - .authWarn(msg, opts?)     // warning, grouped by auth context
 *
 * Example DI skeleton:
 *   export function createFoo({ notify }) {
 *     notify.error('Could not load', { group:true, context:'foo', module:'FooFeature', source:'apiRequest' });
 *   }
 *
 * @param {Object} deps - Dependencies for creation
 * @param {Object} deps.notificationHandler - Registered notification handler (must have .show)
 * @param {Object} [deps.sentry] - Optional Sentry SDK or wrapper
 * @param {Object} [deps.DependencySystem] - DI system for user, transactionId factory, etc.
 * @returns {Object} Notify util with grouped/context helpers
 */
export function createNotify({
  notificationHandler,
  sentry = typeof window !== 'undefined' ? window.Sentry : undefined,
  DependencySystem = typeof window !== 'undefined' ? window.DependencySystem : undefined,
} = {}) {
  if (!notificationHandler?.show) throw new Error('notificationHandler missing');

  // Central defaults
  const DURATION = { info: 4000, success: 4000, warning: 6000, error: 0 };

  // --- Helpers ---

  // Deterministic composite groupKey, e.g. "error|UserProfileService|getUserProfile"
  function computeGroupKey({ type, context, module, source }) {
    return [type, module || '', source || '', context || ''].join('|');
  }

  // Either extract from Sentry (if present) or pass-through DI; fallback to undefined.
  function getCurrentTraceIds() {
    // Attempt DI injection, then fallback to Sentry SDK, else undefined.
    try {
      // If DependencySystem provides traceId/transactionId, use those
      if (DependencySystem?.getCurrentTraceIds)
        return DependencySystem.getCurrentTraceIds();

      // Sentry style fallback
      const S = sentry || (typeof window !== 'undefined' ? window.Sentry : undefined);
      if (S?.getCurrentHub) {
        const hub = S.getCurrentHub();
        const t = hub?.getScope?.()?.getTransaction?.();
        return {
          traceId: t?.traceId || null,
          transactionId: t?.spanId || t?.name || null
        };
      }
    } catch {}
    return { traceId: null, transactionId: null };
  }

  // Generate transactionId if needed (or use DI)
  function generateTransactionId() {
    if (DependencySystem?.generateTransactionId)
      return DependencySystem.generateTransactionId();
    // Fallback: UUID v4 polyfill (RFC4122 variant)
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4))).toString(16)
    );
  }

  async function logNotificationToBackend(payload) {
    try {
      await fetch('/api/log_notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch {/* intentionally swallow errors; never break notification UI */}
  }

  function send(msg, type = 'info', opts = {}) {
    // Determine user (DI, else fallback)
    let user = 'unknown';
    try {
      user =
        (DependencySystem?.modules?.get?.('currentUser')?.username) ||
        (window.currentUser?.username) ||
        (window.currentUser?.name) ||
        'unknown';
    } catch {}
    const timestamp = Date.now() / 1000;

    // Contextual fields (may be undefined)
    const {
      group,
      context,
      module,
      source,
      transactionId: explicitTransactionId,
      traceId: explicitTraceId,
      id,          // allow explicit override
      groupKey: explicitGroupKey,
      extra = {},
      ...restOpts
    } = opts || {};

    // Trace info
    const { traceId, transactionId } = {
      ...getCurrentTraceIds(),
      ...((explicitTransactionId || explicitTraceId) ? {
        transactionId: explicitTransactionId || undefined,
        traceId: explicitTraceId || undefined
      } : {})
    };

    // Grouping key (composite, deterministic)
    const _type = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';
    const groupKey = explicitGroupKey ||
      computeGroupKey({ type: _type, context, module, source });
    // ID for each event (deduplication/tracing)
    const eventId = id || `${groupKey}:${timestamp}`;

    // Structured notification payload
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

    // --- Sentry Breadcrumb/Event ---
    if (sentry?.addBreadcrumb) {
      try {
        sentry.addBreadcrumb({
          category: 'notification',
          level: _type,
          message: msg,
          data: payload
        });
      } catch {/* non-blocking */}
    }

    // Show notification (full opts for UI grouping, allow backward compat)
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

    // Fire and forget structured backend logging
    logNotificationToBackend(payload);

    return eventId;
  }

  // --- Grouped/contextual helpers, backwards compatible ---
  return {
    info:    (msg, o = {}) => send(msg, 'info',    o),
    success: (msg, o = {}) => send(msg, 'success', o),
    warn:    (msg, o = {}) => send(msg, 'warning', o),
    error:   (msg, o = {}) => send(msg, 'error',   o),
    apiError: (msg, o = {}) => send(
      msg,
      'error',
      { group: true, context: 'apiRequest', ...o }
    ),
    authWarn: (msg, o = {}) => send(
      msg,
      'warning',
      { group: true, context: 'auth', ...o }
    ),
    // For direct programmatic access to helpers if needed
    _computeGroupKey: computeGroupKey,
    _getCurrentTraceIds: getCurrentTraceIds
  };
}
