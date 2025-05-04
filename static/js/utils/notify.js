// static/js/utils/notify.js
export function createNotify({ notificationHandler }) {
  if (!notificationHandler?.show) throw new Error('notificationHandler missing');

  /* Centralised defaults ↓ */
  const DURATION = { info:4000, success:4000, warning:6000, error:0 };

  function send(msg, type='info', opts={}) {
    return notificationHandler.show(msg, type, DURATION[type], opts);
  }

  /* Sugar helpers  –  encourage grouping */
  return {
    info   : (msg, o={}) => send(msg,'info',   o),
    success: (msg, o={}) => send(msg,'success',o),
    warn   : (msg, o={}) => send(msg,'warning',o),
    error  : (msg, o={}) => send(msg,'error',  o),

    /* Common, opinionated buckets */
    apiError : (msg, o={}) => send(msg,'error',
                     { group:true, context:'apiRequest', ...o }),
    authWarn : (msg, o={}) => send(msg,'warning',
                     { group:true, context:'auth', ...o }),
  };
}
