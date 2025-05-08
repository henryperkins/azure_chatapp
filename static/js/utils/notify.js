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
      extra = {},
      ...rest
    } = opts || {};

    const eventId = id || `${_type}-${Date.now()}`;

    notificationHandler.show(msg, _type, {
      timeout: DURATION[_type],
      ...rest,
      id: eventId,
      context,
      module,
      source,
      extra
    });

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
