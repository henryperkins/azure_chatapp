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
 *
 * Singleton enforcement:
 *   • Only one EventTarget (event bus) should exist per application instance.
 *   • If multiple eventService instances are created, a warning is logged.
 *   • The singleton EventTarget is stored on window.__APP_EVENT_BUS__ if available.
 */

let _singletonEventBus = null;

export function createEventService({
  DependencySystem,
  logger,
  eventHandlers,
  existingBus
} = {}) {
  /* ------------------------------------------------------------------
   * Dependency validation
   * ---------------------------------------------------------------- */
  if (!logger) {
    throw new Error('[eventService] Missing logger');
  }

  if (!eventHandlers) {
    throw new Error('[eventService] Missing eventHandlers');
  }

  if (!DependencySystem) {
    // Soft-fail: allow unit tests to omit DI but warn in debug builds.
    logger.warn?.('[eventService] DependencySystem not provided – listener ' +
                 'cleanup by module context will not be possible', {
      context: 'eventService'
    });
  }

  // Singleton Event Bus enforcement
  let mainBus;
  if (existingBus) {
    mainBus = existingBus;
    if (_singletonEventBus && mainBus !== _singletonEventBus) {
      logger.warn?.('[eventService] Multiple event buses detected! Ensure only one eventService instance is created and injected.', {
        context: 'eventService:singleton',
        previousBus: _singletonEventBus,
        newBus: mainBus
      });
    }
    _singletonEventBus = mainBus;
  } else if (typeof window !== "undefined") {
    if (!window.__APP_EVENT_BUS__) {
      window.__APP_EVENT_BUS__ = new EventTarget();
      _singletonEventBus = window.__APP_EVENT_BUS__;
    }
    mainBus = window.__APP_EVENT_BUS__;
  } else if (_singletonEventBus) {
    mainBus = _singletonEventBus;
  } else {
    mainBus = new EventTarget();
    _singletonEventBus = mainBus;
  }

  const MODULE_CONTEXT = 'eventService';

  /* ---------------------------------------------------------------- */
  /* Core helpers                                                      */
  /* ---------------------------------------------------------------- */

  function emit(eventName, detail = undefined) {
    if (!eventName || typeof eventName !== 'string') {
      throw new Error('[eventService] emit() requires non-empty event name');
    }
    try {
      const evt = new CustomEvent(eventName, { detail });
      mainBus.dispatchEvent(evt);
    } catch (err) {
      logger.error?.('[eventService] Failed to dispatch', err, {
        context: MODULE_CONTEXT,
        eventName
      });
      throw err;
    }
  }

  /**
   * Subscribe to an event.
   * Returns an unsubscribe function for convenience so callers can do:
   *   const off = eventService.on('foo', handler);
   *   ...later => off();
   */
  function on(eventName, handler, { context = MODULE_CONTEXT, options } = {}) {
    if (!eventName || typeof handler !== 'function') {
      throw new Error('[eventService] on() requires eventName & handler');
    }
    mainBus.addEventListener(eventName, handler, options);
    // Register with global tracking so components can automatically clean up
    eventHandlers.trackListener(mainBus, eventName, handler, { context });

    return () => off(eventName, handler, options);
  }

  function off(eventName, handler, options) {
    if (!eventName || typeof handler !== 'function') return;
    mainBus.removeEventListener(eventName, handler, options);
  }

  /**
   * One-shot listener that auto-unsubscribes after first invocation.
   */
  function once(eventName, handler, { context = MODULE_CONTEXT } = {}) {
    const wrapped = function (evt) {
      try { handler(evt); } finally { off(eventName, wrapped); }
    };
    return on(eventName, wrapped, { context });
  }

  /**
   * Promise helper – resolves next time `eventName` fires.  If a filter
   * function is supplied it must return truthy for the promise to resolve.
   */
  function waitFor(eventName, { filter } = {}) {
    return new Promise((resolve) => {
      const disposer = once(eventName, (evt) => {
        if (typeof filter === 'function' && !filter(evt)) return;
        resolve(evt.detail);
        disposer(); // ensure removal in case once() wasn't used
      }, { context: MODULE_CONTEXT + ':waitFor' });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  return {
    emit,
    on,
    off,
    once,
    waitFor,

    // Legacy shims – point to the same bus for backwards compatibility
    getAuthBus() {
      return mainBus;
    },
    getAppBus() {
      return mainBus;
    },

    /**
     * Returns the singleton EventTarget used by all eventService instances.
     * Use for diagnostics or advanced integration only.
     */
    getSingletonBus() {
      return _singletonEventBus || mainBus;
    },

    /**
     * Explicit cleanup.  Removes all listeners that were registered through
     * the eventHandlers tracking system and targeted this EventTarget.
     */
    cleanup() {
      eventHandlers.cleanupListeners({ target: mainBus });
      logger.debug?.('[eventService] cleanup() executed', { context: MODULE_CONTEXT });
    },

    /* internal for unit tests */
    _getBus() {
      return mainBus;
    }
  };
}

export default createEventService;
