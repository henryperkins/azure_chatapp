/**
 * Factory for standardized auth modal form listener setup/cleanup.
 * All dependencies must be injected for guardrail compliance.
 * Handles both immediate and dynamic modal form listener attachment, with single-source cleanup.
 *
 * Remediation per event-listener leak/duplication guardrails:
 * - No anonymous handlers (all named/const).
 * - Module-level setup guard (isSetup).
 * - All listeners use context: "AuthFormListenerFactory".
 * - No local attachedListeners array: rely solely on context-based cleanup.
 */

export default function createAuthFormListenerFactory(deps) {
  if (!deps || typeof deps !== "object") throw new Error("[AuthFormListenerFactory] DI object required.");
  const requiredDeps = [
    "eventHandlers", "domAPI", "domReadinessService", "browserService",
    "safeHandler", "logger", "DependencySystem"
  ];
  for (const key of requiredDeps) {
    if (!deps[key]) throw new Error(`[AuthFormListenerFactory] Missing DI: ${key}`);
  }
  const {
    eventHandlers,
    domAPI,
    _domReadinessService: domReadinessService,
    _browserService    : browserService,
    safeHandler,
    logger,
    _DependencySystem  : DependencySystem
  } = deps;

  // Module-level guard to prevent duplicate registrations
  let isSetup = false;

  // ---- NAMED HANDLERS ----
  let loginHandlerRef = null;
  let registerHandlerRef = null;
  let modalsLoadedHandlerRef = null;

  function handleLoginFormSubmit(e) {
    // formHandlers.loginHandler WILL be rebound below
    if (loginHandlerRef) {
      return loginHandlerRef(e);
    }
  }

  function handleRegisterFormSubmit(e) {
    if (registerHandlerRef) {
      return registerHandlerRef(e);
    }
  }

  function handleModalsLoadedEvent() {
    cleanupListenersOnly();
    isSetup = false;
    setup(currentFormHandlers);
    // Patch up late-initialized forms after modal dynamic load
    if (browserService?.setTimeout) {
      browserService.setTimeout(() => {
        cleanupListenersOnly();
        isSetup = false;
        setup(currentFormHandlers);
      }, 400);
    }
  }

  // Reference to most recent handlers for re-setup
  let currentFormHandlers = null;

  function setup(formHandlers) {
    if (isSetup) {
      logger.debug("[AuthFormListenerFactory] Setup called but listeners are already attached.", { context: "AuthFormListenerFactory" });
      return;
    }
    isSetup = true;
    currentFormHandlers = formHandlers;

    // Rebind so they're always up to date for event handler invocation
    loginHandlerRef = safeHandler(formHandlers.loginHandler, "AuthFormListenerFactory", logger);
    registerHandlerRef = safeHandler(formHandlers.registerHandler, "AuthFormListenerFactory", logger);

    // Always use module-level handler identity for event removal correctness
    modalsLoadedHandlerRef = safeHandler(handleModalsLoadedEvent, "AuthFormListenerFactory", logger);

    // Attach listeners to login and register forms by ID
    const loginForm = domAPI.getElementById("loginModalForm");
    if (loginForm) {
      domAPI.setAttribute(loginForm, 'novalidate', 'novalidate');
      domAPI.removeAttribute(loginForm, 'action');
      domAPI.removeAttribute(loginForm, 'method');
      eventHandlers.trackListener(
        loginForm,
        "submit",
        safeHandler(handleLoginFormSubmit, "AuthFormListenerFactory:loginSubmit"),
        {
          passive: false,
          context: "AuthFormListenerFactory",
          description: "Login Form Submit"
        }
      );
    }
    const registerForm = domAPI.getElementById("registerModalForm");
    if (registerForm) {
      domAPI.setAttribute(registerForm, 'novalidate', 'novalidate');
      domAPI.removeAttribute(registerForm, 'action');
      domAPI.removeAttribute(registerForm, 'method');
      eventHandlers.trackListener(
        registerForm,
        "submit",
        safeHandler(handleRegisterFormSubmit, "AuthFormListenerFactory:registerSubmit"),
        {
          passive: false,
          context: "AuthFormListenerFactory",
          description: "Register Form Submit"
        }
      );
    }
    // Attach modalsLoaded dynamic re-setup (for late-loaded modals)
    const doc = domAPI.getDocument?.();
    if (doc && typeof eventHandlers.trackListener === "function") {
      eventHandlers.trackListener(
        doc,
        "modalsLoaded",
        safeHandler(modalsLoadedHandlerRef, "AuthFormListenerFactory:modalsLoaded"),
        {
          passive: false,
          context: "AuthFormListenerFactory",
          description: "modalsLoaded Listener"
        }
      );
    }
    logger.info("[AuthFormListenerFactory] Listener setup completed", { context: "AuthFormListenerFactory" });
  }

  function cleanupListenersOnly() {
    if (eventHandlers && typeof eventHandlers.cleanupListeners === "function") {
      eventHandlers.cleanupListeners({ context: "AuthFormListenerFactory" });
    }
    isSetup = false;
    loginHandlerRef = null;
    registerHandlerRef = null;
    modalsLoadedHandlerRef = null;
  }

  function cleanup() {
    cleanupListenersOnly();
  }

  return {
    setup,
    cleanup
  };
}
