import { getSessionId } from "./session.js";

/**
 * Notifier system — all notification feedback, logging, and routing through DI only.
 * All backend event logs must go through injected apiClient; never use fetch directly.
 */
export function createNotify({
  notificationHandler,
  apiClient = null    // injected apiClient for backend logging, DI only
} = {}) {
  if (!notificationHandler?.show) throw new Error('notificationHandler missing');

  const DURATION = { debug: 3000, info: 4000, success: 4000, warning: 6000, error: 0 };

  const send = (msg, type = 'info', opts = {}) => {
    // Map 'warn' to 'warning'
    let _type = type === 'warn' ? 'warning' : type;
    if (!['debug', 'info', 'success', 'warning', 'error'].includes(_type)) _type = 'info';

    const {
      group,
      context,
      module,
      source,
      id,
      traceId,
      originalError,
      endpoint,
      requestPayload,
      responseDetail,
      extra = {},
      ...rest
    } = opts || {};

    const eventId = id || `${_type}-${Date.now()}`;
    const session = getSessionId();

    // Extract stack trace if available
    let stack = null;
    if (originalError?.stack) stack = originalError.stack;
    else if (opts.stack) stack = opts.stack;
    else if (extra?.stack) stack = extra.stack;

    // Prepare notification payload for UI
    const payload = {
      timeout: DURATION[_type],
      ...rest,
      id: eventId,
      context,
      module,
      source,
      group
    };

    // Show UI notification
    notificationHandler.show(msg, _type, payload);

    // Prepare for backend logging (if DI apiClient provided)
    const logApiPayload = {
      message: msg,
      type: _type,
      module,
      context,
      source,
      stack,
      sessionId: session,
      traceId: traceId || session,
      extra: {
        endpoint,
        requestPayload,
        responseDetail,
        ...extra
      }
    };

    // Only use apiClient for backend logging
    if (apiClient && typeof apiClient.post === "function") {
      apiClient.post('/api/log_notification', logApiPayload).catch(() => {});
    }
    // else: do not fall back to fetch; no logging if not available

    return eventId;
  };

  // Create contextual helper
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

  // Create API
  const api = (msg, type = 'info', opts = {}) => send(msg, type, opts);

  Object.assign(api, {
    debug   : (m, o = {}) => send(m, 'debug',   o),
    info    : (m, o = {}) => send(m, 'info',    o),
    success : (m, o = {}) => send(m, 'success', o),
    warn    : (m, o = {}) => send(m, 'warning', o),
    error   : (m, o = {}) => send(m, 'error',   o),
    apiError: (m, o = {}) => send(m, 'error',   { group: true, context: 'apiRequest', ...o }),
    authWarn: (m, o = {}) => send(m, 'warning', { group: true, context: 'auth',       ...o }),
    log     : (m, o = {}) => send(m, 'debug',   o),
    withContext
  });

  return api;
}
