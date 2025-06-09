/**
 * createAuthFormListenerFactory – canonical factory for wiring auth modal
 * form listeners (login / register) in a DI-compliant way.
 *
 * Guard-rails compliance
 *   1. Named `create*` export (no default-only export).
 *   2. Strict dependency validation – throws on missing deps.
 *   3. No top-level side-effects; all listeners registered from `.setup()`.
 *   4. Provides deterministic `cleanup()` that calls
 *      `eventHandlers.cleanupListeners({ context })`.
 */

export function createAuthFormListenerFactory(deps = {}) {
  /* ------------------------------------------------------------------ */
  /* Dependency validation                                              */
  /* ------------------------------------------------------------------ */
  if (typeof deps !== 'object' || deps === null) {
    throw new Error('[AuthFormListenerFactory] deps DI object is required');
  }

  const REQUIRED = [
    'eventHandlers',
    'domAPI',
    'domReadinessService',
    'browserService',
    'safeHandler',
    'logger',
  ];

  for (const key of REQUIRED) {
    if (!deps[key]) {
      throw new Error(`[AuthFormListenerFactory] Missing DI: ${key}`);
    }
  }

  const {
    eventHandlers,
    domAPI,
    domReadinessService, // kept for future async readiness wiring
    browserService,
    safeHandler,
    logger,
  } = deps;

  const CONTEXT = 'AuthFormListenerFactory';

  /* ------------------------------------------------------------------ */
  /* Internal mutable references (module-internal only)                  */
  /* ------------------------------------------------------------------ */
  let isSetup = false;
  let loginHandlerRef;
  let registerHandlerRef;
  let modalsLoadedHandlerRef;
  let currentFormHandlers = null;

  /* ------------------------------------------------------------------ */
  /* Private helpers                                                     */
  /* ------------------------------------------------------------------ */
  function _cleanupListenersOnly() {
    eventHandlers.cleanupListeners({ context: CONTEXT });
    isSetup = false;
    loginHandlerRef = registerHandlerRef = modalsLoadedHandlerRef = null;
  }

  function _handleModalsLoaded() {
    _cleanupListenersOnly();
    if (currentFormHandlers) setup(currentFormHandlers);
    // Re-apply a second time after DOM settles (dynamic modal markup)
    browserService.setTimeout?.(() => {
      _cleanupListenersOnly();
      if (currentFormHandlers) setup(currentFormHandlers);
    }, 400);
  }

  function _bindForm(el, submitHandler, description) {
    domAPI.setAttribute(el, 'novalidate', 'novalidate');
    domAPI.removeAttribute(el, 'action');
    domAPI.removeAttribute(el, 'method');

    eventHandlers.trackListener(
      el,
      'submit',
      safeHandler(submitHandler, `${CONTEXT}:${description}`),
      { passive: false, context: CONTEXT, description }
    );
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  function setup(formHandlers) {
    if (isSetup) {
      logger.debug('[AuthFormListenerFactory] setup() called twice – ignored', {
        context: CONTEXT,
      });
      return;
    }

    isSetup = true;
    currentFormHandlers = formHandlers;

    // Wrap the latest implementation of handlers via safeHandler
    loginHandlerRef = safeHandler(formHandlers.loginHandler, CONTEXT, logger);
    registerHandlerRef = safeHandler(
      formHandlers.registerHandler,
      CONTEXT,
      logger,
    );
    modalsLoadedHandlerRef = safeHandler(_handleModalsLoaded, CONTEXT, logger);

    // Attach to forms (if already present)
    const loginForm = domAPI.getElementById('loginModalForm');
    if (loginForm) _bindForm(loginForm, loginHandlerRef, 'loginSubmit');

    const registerForm = domAPI.getElementById('registerModalForm');
    if (registerForm) _bindForm(registerForm, registerHandlerRef, 'registerSubmit');

    // Listen for dynamic modal injection
    const doc = domAPI.getDocument?.();
    if (doc) {
      eventHandlers.trackListener(
        doc,
        'modalsLoaded',
        modalsLoadedHandlerRef,
        { context: CONTEXT, description: 'modalsLoaded Listener' },
      );
    }

    logger.info('[AuthFormListenerFactory] listener wiring complete', {
      context: CONTEXT,
    });
  }

  function cleanup() {
    _cleanupListenersOnly();
  }

  return { setup, cleanup };
}

// Keep default export for backward compatibility during migration
export default createAuthFormListenerFactory;
