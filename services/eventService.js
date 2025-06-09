/**
 * Unified Event Service – single EventTarget for the entire frontend
 * ------------------------------------------------------------------
 * This service replaces the legacy scattered buses (AuthBus, AppBus,
 * chatUIBus, SidebarBus, …).  Every module should depend on this service
 * and no module should create its own EventTarget after migration.
 *
 * Guard-rails compliance:
 *   • Pure factory – no side-effects at module scope.
 *   • Explicit DI parameters (only `logger` is optional).
 *   • Always exposes cleanup() even if currently a no-op.
 *
 * Back-compat helpers:
 *   • getAuthBus() / getAppBus() return the same underlying bus so legacy
 *     modules continue to work during incremental migration.
 */

export function createEventService({ logger, existingBus } = {}) {
  // Use supplied bus (e.g., AppBus from appInitializer) or create new.
  const mainBus = existingBus || new EventTarget();

  /* ---------------------------------------------------------------- */
  /* Helper wrappers                                                   */
  /* ---------------------------------------------------------------- */

  function emit(eventName, detail = undefined) {
    if (!eventName || typeof eventName !== 'string') {
      throw new Error('[eventService] emit() requires non-empty event name');
    }
    try {
      const evt = new CustomEvent(eventName, { detail });
      mainBus.dispatchEvent(evt);
    } catch (err) {
      logger?.error?.('[eventService] Failed to dispatch', err, {
        context: 'eventService',
        eventName,
      });
      throw err;
    }
  }

  function on(eventName, handler, options) {
    if (!eventName || typeof handler !== 'function') {
      throw new Error('[eventService] on() requires eventName & handler');
    }
    mainBus.addEventListener(eventName, handler, options);
  }

  function off(eventName, handler, options) {
    if (!eventName || typeof handler !== 'function') return;
    mainBus.removeEventListener(eventName, handler, options);
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  return {
    emit,
    on,
    off,

    // Legacy shims ---------------------------------------------------
    getAuthBus() {
      return mainBus;
    },
    getAppBus() {
      return mainBus;
    },

    /* --------------------------------------------------------------- */
    /* cleanup – placeholder (EventTarget cannot enumerate listeners)  */
    /* --------------------------------------------------------------- */
    cleanup() {
      // No built-in way to iterate listeners; rely on eventHandlers
      // central tracking for proper teardown.
      logger?.debug?.('[eventService] cleanup() called', {
        context: 'eventService',
      });
    },

    /* internal for tests */
    _getBus() {
      return mainBus;
    },
  };
}

export default createEventService;
