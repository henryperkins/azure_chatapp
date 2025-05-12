import { getSessionId } from "./session.js";

export function createNotify({
  notificationHandler
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
      originalError, // pass Error object or stack trace here for full detail!
      endpoint,
      requestPayload,
      responseDetail,
      extra = {},
      ...rest
    } = opts || {};

    const eventId = id || `${_type}-${Date.now()}`;
    const sessionId = getSessionId();

    // Add stack trace if Error is supplied
    let stack = null;
    if (originalError && typeof originalError === "object") {
      if (originalError.stack) stack = originalError.stack;
      else if (typeof originalError === "string") stack = originalError;
    }
    // Also accept direct .stack or .error fields from opts or extra
    if (!stack && opts.stack) stack = opts.stack;
    if (!stack && extra && extra.stack) stack = extra.stack;

    // Compose a merged extra object including advanced context
    const richExtra = {
      ...extra,
      // Purposefully inject API and trace/session context
      endpoint,
      requestPayload,
      responseDetail,
      sessionId,
      traceId: traceId || sessionId,
      ...(stack ? { stack } : {})
    };

    const payload = {
      timeout: DURATION[_type],
      ...rest,
      id: eventId,
      context,
      module,
      source,
      group,
      extra: richExtra
    };

    // Debug log for notification troubleshooting (shows all context passed)
    if (typeof window !== "undefined" && window.console && window.APP_CONFIG?.DEBUG) {
      // Only log if in debug mode
      // eslint-disable-next-line no-console
      console.debug('[notify.send] Notification payload:', { msg, type: _type, payload });
    }

    notificationHandler.show(msg, _type, payload);

    // Send ALL notifications to the backend logging endpoint
    // if (_type === 'error') { // Condition removed to send all types
      const logApiPayload = {
        message: msg,
        type: _type,
        module: payload.module,
        context: payload.context,
        source: payload.source,
        stack: richExtra.stack, // stack is already in richExtra if available
        sessionId: richExtra.sessionId,
        traceId: richExtra.traceId,
        additional_details: { // Send the 'extra' details which might contain more context
            endpoint: richExtra.endpoint,
            requestPayload: richExtra.requestPayload,
            responseDetail: richExtra.responseDetail,
            // Include other custom 'extra' fields passed in opts
            ...(typeof opts.extra === 'object' && opts.extra !== null ? opts.extra : {})
        }
      };

      fetch('/api/log_notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(logApiPayload),
      })
      .then(response => {
        if (!response.ok) {
          console.error(`Failed to POST ${_type} notification to /api/log_notification:`, response.status, response.statusText, logApiPayload);
        } else {
          if (typeof window !== "undefined" && window.console && window.APP_CONFIG?.DEBUG) {
            console.debug(`${_type} notification successfully POSTed to /api/log_notification:`, logApiPayload);
          }
        }
      })
      .catch(networkError => {
        console.error(`Network error when POSTing ${_type} notification to /api/log_notification:`, networkError, logApiPayload);
      });
    // } // Corresponding closing brace for the removed if condition

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

  const api = (msg, type = 'info', opts = {}) => send(msg, type, opts);  // callable

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
