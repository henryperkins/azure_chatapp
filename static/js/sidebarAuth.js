/**
 * sidebarAuth.js - Extracted authentication form logic for sidebar.
 *
 * Factory function with strict DI and no globals.
 * Handles:
 *  - Inline auth form DOM nodes and updates
 *  - Form validation and mode toggling
 *  - Auth submit and error display
 *  - Auth state synchronization
 *  - Exposes public API: init, handleGlobalAuthStateChange, cleanup
 *
 * @param {object} deps - All dependencies injected
 */
export function createSidebarAuth({
  domAPI,
  eventHandlers,
  DependencySystem,
  logger,
  sanitizer,
  safeHandler,
}) {
  if (!domAPI) throw new Error('[SidebarAuth] domAPI is required');
  if (!eventHandlers) throw new Error('[SidebarAuth] eventHandlers is required');
  if (!DependencySystem) throw new Error('[SidebarAuth] DependencySystem is required');
  if (!logger) throw new Error('[SidebarAuth] logger is required');
  if (typeof safeHandler !== 'function') throw new Error('[SidebarAuth] safeHandler required');
  // sanitizer optional

  const MODULE = 'SidebarAuth';
  // Inline auth state
  let isRegisterMode = false;
  let sidebarAuthFormContainerEl,
    sidebarAuthFormTitleEl,
    sidebarAuthFormEl,
    sidebarUsernameContainerEl,
    sidebarUsernameInputEl,
    sidebarEmailInputEl,
    sidebarPasswordInputEl,
    sidebarConfirmPasswordContainerEl,
    sidebarConfirmPasswordInputEl,
    sidebarAuthBtnEl,
    sidebarAuthErrorEl,
    sidebarAuthToggleEl;

  function initAuthDom() {
    sidebarAuthFormContainerEl = domAPI.getElementById('sidebarAuthFormContainer');
    sidebarAuthFormTitleEl = domAPI.getElementById('sidebarAuthFormTitle');
    sidebarAuthFormEl = domAPI.getElementById('sidebarAuthForm');
    sidebarUsernameContainerEl = domAPI.getElementById('sidebarUsernameContainer');
    sidebarUsernameInputEl = domAPI.getElementById('sidebarUsername');
    sidebarEmailInputEl = domAPI.getElementById('sidebarEmail');
    sidebarPasswordInputEl = domAPI.getElementById('sidebarPassword');
    sidebarConfirmPasswordContainerEl = domAPI.getElementById('sidebarConfirmPasswordContainer');
    sidebarConfirmPasswordInputEl = domAPI.getElementById('sidebarConfirmPassword');
    sidebarAuthBtnEl = domAPI.getElementById('sidebarAuthBtn');
    sidebarAuthErrorEl = domAPI.getElementById('sidebarAuthError');
    sidebarAuthToggleEl = domAPI.getElementById('sidebarAuthToggle');
  }

  function clearAuthForm() {
    if (sidebarAuthFormEl) {
      sidebarAuthFormEl.reset();
    }
    if (sidebarAuthErrorEl) {
      domAPI.setTextContent(sidebarAuthErrorEl, '');
    }
  }

  function updateAuthFormUI(registerMode) {
    isRegisterMode = registerMode;
    if (!sidebarAuthFormTitleEl || !sidebarAuthBtnEl || !sidebarConfirmPasswordContainerEl) {
      return;
    }
    domAPI.setTextContent(sidebarAuthFormTitleEl, registerMode ? 'Register' : 'Login');
    domAPI.setTextContent(sidebarAuthBtnEl, registerMode ? 'Create account' : 'Sign in');
    domAPI.toggleClass(sidebarConfirmPasswordContainerEl, 'hidden', !registerMode);
    domAPI.toggleClass(sidebarUsernameContainerEl, 'hidden', !registerMode);
  }

  async function handleAuthSubmit(authModule) {
    let username = sidebarUsernameInputEl.value.trim();
    let email = sidebarEmailInputEl.value.trim();
    const password = sidebarPasswordInputEl.value;

    // Sanitize user inputs to prevent XSS
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
        // In login mode, the username field is hidden, so use email as username
        // The backend expects a username field, but users enter their email in login mode
        const loginUsername = username || email;
        if (!loginUsername || !password) {
          throw new Error('Email and password are required.');
        }
        await authModule.login(loginUsername, password);
      }
    } catch (err) {
      logger.error('[SidebarAuth][authSubmit]', err && err.stack ? err.stack : err, { context: MODULE });
      const errorMessage = sanitizer?.sanitize(err?.message) || (isRegisterMode ? 'Registration failed.' : 'Login failed.');
      domAPI.setTextContent(sidebarAuthErrorEl, errorMessage);
    } finally {
      if (sidebarAuthBtnEl) {
        domAPI.setProperty(sidebarAuthBtnEl, 'disabled', false);
      }
    }
  }

  function setupInlineAuthForm() {
    const authModule = DependencySystem.modules?.get('auth') || DependencySystem.get?.('auth');
    if (!authModule) return;

    // Toggle between "Register" and "Login"
    eventHandlers.trackListener(
      sidebarAuthToggleEl,
      'click',
      safeHandler(() => {
        updateAuthFormUI(!isRegisterMode);
        clearAuthForm();
      }, '[SidebarAuth] toggle auth mode'),
      { description: 'Sidebar toggle auth mode', context: MODULE }
    );

    // Auth form submit
    eventHandlers.trackListener(
      sidebarAuthFormEl,
      'submit',
      safeHandler((e) => {
        e.preventDefault();
        handleAuthSubmit(authModule);
      }, '[SidebarAuth] auth form submit'),
      { description: 'Sidebar auth submit', context: MODULE }
    );
  }

  async function handleGlobalAuthStateChange(event) {
    if (!sidebarAuthFormContainerEl) {
      initAuthDom();
    }

    // Use event detail from AuthModule, but also fallback to appModule.state for robustness
    let authenticated = event?.detail?.authenticated ?? false;
    let currentUser = event?.detail?.user ?? null;

    // ENHANCED: If event doesn't have auth data, read from canonical source
    if (event?.detail?.authenticated === undefined) {
      const appModule = DependencySystem?.modules?.get('appModule');
      if (appModule?.state) {
        authenticated = appModule.state.isAuthenticated;
        currentUser = appModule.state.currentUser;
        logger.debug('[SidebarAuth][handleGlobalAuthStateChange] Event missing auth data, reading from appModule.state:', {
          authenticated,
          currentUser: currentUser ? { id: currentUser.id, username: currentUser.username } : null
        });
      }
    }

    logger.debug('[SidebarAuth][handleGlobalAuthStateChange] Auth state update:', {
      isAuthenticated: authenticated,
      currentUser: currentUser ? { id: currentUser.id, username: currentUser.username } : null,
      eventDetail: event?.detail,
      sidebarAuthFormContainerEl_exists: !!sidebarAuthFormContainerEl,
      sidebarAuthFormContainerEl_id: sidebarAuthFormContainerEl?.id,
      eventSource: event?.detail?.source || 'unknown'
    });

    if (sidebarAuthFormContainerEl) {
      const shouldHideForm = authenticated;

      logger.debug('[SidebarAuth][handleGlobalAuthStateChange] Updating form visibility:', {
        shouldHideForm,
        authenticated,
        formCurrentlyHidden: domAPI.hasClass(sidebarAuthFormContainerEl, 'hidden')
      });

      domAPI.toggleClass(sidebarAuthFormContainerEl, 'hidden', shouldHideForm);
      domAPI.setStyle(sidebarAuthFormContainerEl, 'display', shouldHideForm ? 'none' : '');

      if (shouldHideForm) {
        sidebarAuthFormContainerEl.setAttribute?.('hidden', 'hidden');
      } else {
        sidebarAuthFormContainerEl.removeAttribute?.('hidden');
      }
    } else {
      logger.warn('[SidebarAuth][handleGlobalAuthStateChange] sidebarAuthFormContainerEl not found, cannot update form visibility');
    }

    // Always ensure the sidebar is visible independent of auth state
    const sidebarEl = domAPI.getElementById('mainSidebar');
    if (sidebarEl) {
      domAPI.toggleClass(sidebarEl, 'hidden', false);
      domAPI.setStyle(sidebarEl, 'display', '');
      sidebarEl.removeAttribute?.('hidden');
    }

    if (authenticated) {
      try {
        logger.info(`[SidebarAuth][auth:stateChanged] User authenticated.`, {
          context: MODULE,
          userId: currentUser?.id,
          username: currentUser?.username
        });
        // Consumer should reload projects and activate tab if needed
      } catch (err) {
        logger.error(`[SidebarAuth][auth:stateChanged] Failed during post-auth actions.`, err, { context: MODULE });
      }
    } else {
      logger.info(`[SidebarAuth][auth:stateChanged] User not authenticated. Resetting form.`, { context: MODULE });
      if (isRegisterMode) {
        updateAuthFormUI(false);
      }
      clearAuthForm();
    }
  }

  function forceAuthStateSync() {
    logger.debug('[SidebarAuth][forceAuthStateSync] Forcing auth state sync from appModule.state');
    const appModule = DependencySystem?.modules?.get('appModule');
    if (appModule?.state) {
      const authenticated = appModule.state.isAuthenticated;
      const currentUser = appModule.state.currentUser;

      logger.debug('[SidebarAuth][forceAuthStateSync] Current appModule state:', {
        authenticated,
        currentUser: currentUser ? { id: currentUser.id, username: currentUser.username } : null
      });

      handleGlobalAuthStateChange({
        detail: {
          authenticated,
          user: currentUser,
          source: 'force_auth_state_sync'
        }
      });

      return { authenticated, currentUser };
    } else {
      logger.warn('[SidebarAuth][forceAuthStateSync] appModule.state not available');
      return null;
    }
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
    init: initAuthDom,
    setupInlineAuthForm,
    handleGlobalAuthStateChange,
    forceAuthStateSync,
    cleanup,
    updateAuthFormUI,
    clearAuthForm
  };
}
