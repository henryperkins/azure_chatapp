/**
 * @module sidebarAuth
 * @description Canonical DI-only factory for sidebar auth logic (strict .clinerules compliance).
 * Exports a single createSidebarAuth({ ...deps }) factory. No top-level logic/side effects.
 * All logger/event/context usage is canonicalized.
 */

const MODULE = 'SidebarAuth';

export function createSidebarAuth({
  domAPI,
  eventHandlers,
  DependencySystem,
  logger,
  sanitizer,
  safeHandler,
  domReadinessService
}) {
  if (!domAPI) throw new Error(`[${MODULE}] domAPI is required`);
  if (!eventHandlers) throw new Error(`[${MODULE}] eventHandlers is required`);
  if (!DependencySystem) throw new Error(`[${MODULE}] DependencySystem is required`);
  if (!logger) throw new Error(`[${MODULE}] logger is required`);
  if (typeof safeHandler !== 'function') throw new Error(`[${MODULE}] safeHandler required`);

  let isRegisterMode = false;

  let sidebarAuthFormContainerEl = null,
      sidebarAuthFormTitleEl = null,
      sidebarAuthFormEl = null,
      sidebarUsernameContainerEl = null,
      sidebarUsernameInputEl = null,
      sidebarEmailInputEl = null,
      sidebarPasswordInputEl = null,
      sidebarConfirmPasswordContainerEl = null,
      sidebarConfirmPasswordInputEl = null,
      sidebarAuthBtnEl = null,
      sidebarAuthErrorEl = null,
      sidebarAuthToggleEl = null;

  function initAuthDom() {
    sidebarAuthFormContainerEl = domAPI.getElementById('sidebarAuthFormContainer');
    sidebarAuthFormTitleEl = domAPI.getElementById('sidebarAuthFormTitle');
    sidebarAuthFormEl = domAPI.getElementById('sidebarAuthForm');
    sidebarUsernameContainerEl = domAPI.getElementById('sidebarUsernameContainer');
    sidebarUsernameInputEl = domAPI.getElementById('sidebarUsername');
    sidebarEmailInputEl = domAPI.getElementById('sidebarUsernameLogin');
    sidebarPasswordInputEl = domAPI.getElementById('sidebarPassword');
    sidebarConfirmPasswordContainerEl = domAPI.getElementById('sidebarConfirmPasswordContainer');
    sidebarConfirmPasswordInputEl = domAPI.getElementById('sidebarConfirmPassword');
    sidebarAuthBtnEl = domAPI.getElementById('sidebarAuthBtn');
    sidebarAuthErrorEl = domAPI.getElementById('sidebarAuthError');
    sidebarAuthToggleEl = domAPI.getElementById('sidebarAuthToggle');
  }

  function clearAuthForm() {
    sidebarAuthFormEl?.reset();
    if (sidebarAuthErrorEl) {
      domAPI.setTextContent(sidebarAuthErrorEl, '');
    }
  }

  function updateAuthFormUI(registerMode) {
    isRegisterMode = registerMode;
    if (!sidebarAuthFormTitleEl || !sidebarAuthBtnEl || !sidebarConfirmPasswordContainerEl) return;

    domAPI.setTextContent(sidebarAuthFormTitleEl, registerMode ? 'Register' : 'Login');
    domAPI.setTextContent(sidebarAuthBtnEl, registerMode ? 'Create account' : 'Sign in');
    domAPI.toggleClass(sidebarConfirmPasswordContainerEl, 'hidden', !registerMode);
    domAPI.toggleClass(sidebarUsernameContainerEl, 'hidden', !registerMode);
  }

  async function handleAuthSubmit(authModule) {
    if (!authModule) return;
    let username = sidebarUsernameInputEl.value.trim();
    let email = sidebarEmailInputEl.value.trim();
    const password = sidebarPasswordInputEl.value;

    // sanitize
    username = sanitizer?.sanitize(username) || username;
    email = sanitizer?.sanitize(email) || email;

    if (sidebarAuthBtnEl) {
      domAPI.setProperty(sidebarAuthBtnEl, 'disabled', true);
    }

    try {
      if (isRegisterMode) {
        const confirm = sidebarConfirmPasswordInputEl.value;
        if (password !== confirm) {
          throw new Error('Passwords do not match.');
        }
        await authModule.register({ username, email, password });
        updateAuthFormUI(false);
        domAPI.setTextContent(sidebarAuthErrorEl, 'Registration successful. Please sign in.');
      } else {
        const loginUsername = email;
        if (!loginUsername || !password) {
          throw new Error('Username and password are required.');
        }
        await authModule.login(loginUsername, password);
      }
    } catch (err) {
      logger.error('[SidebarAuth][authSubmit]', err, { context: MODULE });
      const errMsg = sanitizer?.sanitize(err?.message) ||
                     (isRegisterMode ? 'Registration failed' : 'Login failed');
      domAPI.setTextContent(sidebarAuthErrorEl, errMsg);
    } finally {
      domAPI.setProperty(sidebarAuthBtnEl, 'disabled', false);
    }
  }

  function setupInlineAuthForm() {
    const authModule = DependencySystem.modules?.get('auth') || DependencySystem.get?.('auth');
    if (!authModule) return;
    if (!sidebarAuthFormEl || !sidebarAuthToggleEl) return;

    // Toggle
    eventHandlers.trackListener(
      sidebarAuthToggleEl,
      'click',
      safeHandler(() => {
        updateAuthFormUI(!isRegisterMode);
        clearAuthForm();
      }, '[SidebarAuth] toggle mode'),
      { context: MODULE }
    );

    // Submit
    eventHandlers.trackListener(
      sidebarAuthFormEl,
      'submit',
      safeHandler((e) => {
        domAPI.preventDefault(e);
        handleAuthSubmit(authModule);
      }, '[SidebarAuth] form submit'),
      { context: MODULE }
    );
  }

  async function handleGlobalAuthStateChange(event) {
    logger.debug(`[${MODULE}] handleGlobalAuthStateChange called with event`, event, { context: MODULE });
    // Wait for DOM readiness if available
    if (domReadinessService?.elementsReady) {
      try {
        await domReadinessService.elementsReady(
          ['#sidebarAuthFormContainer', '#mainSidebar'],
          { timeout: 5000, context: `${MODULE}:handleAuthStateChange` }
        );
      } catch (err) {
        logger.error(`[${MODULE}] DOM not ready for auth update`, err, { context: MODULE });
        return;
      }
    }
    if (!sidebarAuthFormContainerEl) {
      initAuthDom();
    }

    let authenticated = event?.detail?.authenticated ?? false;
    let currentUser = event?.detail?.user ?? null;

    if (event?.detail?.authenticated === undefined) {
      const appModule = DependencySystem.modules?.get('appModule');
      if (appModule?.state) {
        authenticated = appModule.state.isAuthenticated;
        currentUser = appModule.state.currentUser;
      }
    }

    if (sidebarAuthFormContainerEl) {
      const hidden = !!authenticated;
      domAPI.toggleClass(sidebarAuthFormContainerEl, 'hidden', hidden);
      domAPI.setStyle(sidebarAuthFormContainerEl, 'display', hidden ? 'none' : '');
      if (hidden) sidebarAuthFormContainerEl.setAttribute('hidden', 'hidden');
      else sidebarAuthFormContainerEl.removeAttribute('hidden');
    }

    // Always ensure #mainSidebar is visible
    const mainSidebarEl = domAPI.getElementById('mainSidebar');
    if (mainSidebarEl) {
      domAPI.toggleClass(mainSidebarEl, 'hidden', false);
      domAPI.setStyle(mainSidebarEl, 'display', '');
      mainSidebarEl.removeAttribute('hidden');
    }

    if (!authenticated) {
      // reset
      if (isRegisterMode) updateAuthFormUI(false);
      clearAuthForm();
    }
  }

  function forceAuthStateSync() {
    logger.debug('[SidebarAuth] Forcing auth state sync from appModule', { context: MODULE });
    const appModule = DependencySystem.modules?.get('appModule');
    if (appModule?.state) {
      handleGlobalAuthStateChange({
        detail: {
          authenticated: appModule.state.isAuthenticated,
          user: appModule.state.currentUser,
          source: 'forceSync'
        }
      });
    }
  }

  function init() {
    initAuthDom();
  }

  function cleanup() {
    eventHandlers.cleanupListeners({ context: MODULE });
    isRegisterMode = false;
    sidebarAuthFormContainerEl = null;
    sidebarAuthFormTitleEl = null;
    sidebarAuthFormEl = null;
    sidebarUsernameContainerEl = null;
    sidebarUsernameInputEl = null;
    sidebarEmailInputEl = null;
    sidebarPasswordInputEl = null;
    sidebarConfirmPasswordContainerEl = null;
    sidebarConfirmPasswordInputEl = null;
    sidebarAuthBtnEl = null;
    sidebarAuthErrorEl = null;
    sidebarAuthToggleEl = null;
  }

  return {
    init,
    setupInlineAuthForm,
    handleGlobalAuthStateChange,
    forceAuthStateSync,
    cleanup,
    updateAuthFormUI,
    clearAuthForm
  };
}
