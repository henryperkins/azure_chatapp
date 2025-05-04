/**
 * Notification Utility Module.
 * Dependency-injected wrapper for app/site-wide notifications.
 *
 * Usage:
 *   - Always inject `notify` via DI (DependencySystem.modules.get('notify')) in every module/factory; never import notification handler directly.
 *   - Use grouped/contextual helpers for all user/system messages (e.g. notify.info, notify.success, notify.error, notify.apiError).
 *   - See notification-system.md and custominstructions.md for DI architecture and usage guidelines.
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
 *     notify.error('Could not load', { group: true, context: 'foo' });
 *   }
 *
 * @param {Object} deps - Dependencies for creation
 * @param {Object} deps.notificationHandler - Registered notification handler (must have .show)
 * @returns {Object} Notify util with grouped/context helpers
 */
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
