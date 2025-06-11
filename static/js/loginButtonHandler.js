// =========================================
// FILE: /static/js/loginButtonHandler.js
// =========================================
/**
 * createLoginButtonHandler
 * ------------------------
 * Factory that wires the global “Login” button (#authButton)
 * to the ModalManager so that the login / register modal
 * (logical key: "login") is shown when the user presses it.
 *
 * Architectural notes:
 * • No top-level side-effects – click listener is attached
 *   only after `.initialize()` is called by uiInit.
 * • All dependencies are injected – never imported directly
 *   (except this factory, which uiInit imports per 2025 rules).
 * • Event listeners are registered exclusively through the
 *   DI-provided `eventHandlers` utility so they are tracked
 *   and cleaned up consistently.
 */

export function createLoginButtonHandler({
  // DI
  DependencySystem,
  domAPI,
  eventHandlers,
  domReadinessService,
  logger,
  modalManager,
  modalConstants
} = {}) {
  if (!DependencySystem || !domAPI || !eventHandlers || !domReadinessService ||
      !logger || !modalManager || !modalConstants) {
    throw new Error('[loginButtonHandler] Missing required dependencies');
  }

  const MODULE_CONTEXT = 'loginButtonHandler';
  let _initialized = false;

  /**
   * Attach click listener once the DOM element becomes available.
   */
  async function initialize() {
    if (_initialized) return;
    _initialized = true;

    // Wait until the Login button is present in the DOM
    await domReadinessService.dependenciesAndElements({
      domSelectors: ['#authButton'],
      timeout: 10000,
      context: MODULE_CONTEXT + ':waitForAuthButton'
    });

    const loginBtn = domAPI.getElementById('authButton');
    if (!loginBtn) {
      logger.error('[loginButtonHandler] #authButton not found after readiness wait', {
        context: MODULE_CONTEXT
      });
      return;
    }

    // Attach click listener through tracked eventHandlers
    eventHandlers.trackListener(
      loginBtn,
      'click',
      () => {
        try {
          // Logical modal key is "login" per modalConstants
          modalManager.show('login');
        } catch (err) {
          logger.error('[loginButtonHandler] Failed to show login modal', err, {
            context: MODULE_CONTEXT
          });
        }
      },
      { context: MODULE_CONTEXT, description: 'OpenLoginModal' }
    );

    logger.info('[loginButtonHandler] Initialized and listener attached', {
      context: MODULE_CONTEXT
    });
  }

  function cleanup() {
    eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
  }

  return {
    initialize,
    cleanup
  };
}
