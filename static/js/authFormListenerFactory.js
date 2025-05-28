/**
 * Factory for standardized auth modal form listener setup/cleanup.
 * All dependencies must be injected for guardrail compliance.
 * Handles both immediate and dynamic modal form listener attachment, with single-source cleanup.
 */

export function createAuthFormListenerFactory(deps) {
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
    domReadinessService,
    browserService,
    safeHandler,
    logger,
    DependencySystem
  } = deps;

  // Used to allow cleanup of all listeners
  const attachedListeners = [];

  // For guardrails: Single-source-of-truth (do not touch ._listenerAttached)
  function setup(formHandlers) {
    // Attach listeners to login and register forms by ID
    const loginForm = domAPI.getElementById("loginModalForm");
    if (loginForm) {
      domAPI.setAttribute(loginForm, 'novalidate', 'novalidate');
      domAPI.removeAttribute(loginForm, 'action');
      domAPI.removeAttribute(loginForm, 'method');
      attachedListeners.push(
        eventHandlers.trackListener(
          loginForm,
          "submit",
          safeHandler(formHandlers.loginHandler, "AuthFormListener:loginFormSubmit", logger),
          {
            passive: false,
            context: "AuthFormListener:loginFormSubmit",
            description: "Login Form Submit"
          }
        )
      );
    }
    const registerForm = domAPI.getElementById("registerModalForm");
    if (registerForm) {
      domAPI.setAttribute(registerForm, 'novalidate', 'novalidate');
      domAPI.removeAttribute(registerForm, 'action');
      domAPI.removeAttribute(registerForm, 'method');
      attachedListeners.push(
        eventHandlers.trackListener(
          registerForm,
          "submit",
          safeHandler(formHandlers.registerHandler, "AuthFormListener:registerFormSubmit", logger),
          {
            passive: false,
            context: "AuthFormListener:registerFormSubmit",
            description: "Register Form Submit"
          }
        )
      );
    }
    // Attach modalsLoaded dynamic re-setup (for late-loaded modals)
    const doc = domAPI.getDocument?.();
    if (doc && typeof eventHandlers.trackListener === "function") {
      attachedListeners.push(
        eventHandlers.trackListener(
          doc,
          "modalsLoaded",
          safeHandler(() => {
            cleanupListenersOnly();
            setup(formHandlers);
            // Patch up late-initialized forms after modal dynamic load, using a small timeout if needed
            if (browserService?.setTimeout) {
              browserService.setTimeout(() => {
                setup(formHandlers);
              }, 400);
            }
          }, "AuthFormListener:modalsLoaded", logger),
          {
            passive: false,
            context: "AuthFormListener:modalsLoaded",
            description: "modalsLoaded Listener"
          }
        )
      );
    }
  }

  // Only clean up attached listeners, not user session, service timers, etc.
  function cleanupListenersOnly() {
    if (eventHandlers && typeof eventHandlers.cleanupListeners === "function") {
      eventHandlers.cleanupListeners({ context: "AuthFormListenerFactory" });
    }
    attachedListeners.length = 0;
  }

  function cleanup() {
    cleanupListenersOnly();
  }

  return {
    setup,
    cleanup
  };
}
