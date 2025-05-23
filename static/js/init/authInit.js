/**
 * Creates an authentication initializer that manages authentication system setup, state change handling, and UI updates.
 *
 * This factory enforces strict dependency injection and provides methods to initialize authentication, respond to authentication state changes, render authentication-related UI elements, and force the display of the login modal.
 *
 * @returns {object} An object with methods: {@link initializeAuthSystem}, {@link handleAuthStateChange}, {@link renderAuthHeader}, and {@link forceShowLoginModal}.
 *
 * @throws {Error} If any required dependency is missing.
 */

export function createAuthInitializer({
  DependencySystem,
  domAPI,
  eventHandlers,
  logger,
  sanitizer,
  safeHandler,
  domReadinessService,
  APP_CONFIG
}) {
  if (
    !DependencySystem || !domAPI || !eventHandlers ||
    !logger || !sanitizer || !safeHandler || !domReadinessService || !APP_CONFIG
  ) {
    throw new Error('[authInit] Missing required dependencies for auth initialization.');
  }

  // Note: Local state for 'currentUser' has been removed.
  // All currentUser information should be sourced from appModule.state.currentUser.

  /**
   * Initialize the authentication system
   */
  async function initializeAuthSystem() {
    const auth = DependencySystem.modules.get('auth');
    if (!auth?.init) {
      throw new Error('[authInit] Auth module is missing or invalid.');
    }

    // Register auth event listeners before init
    if (auth.AuthBus) {
      logger.log('[authInit] Registering AuthBus listeners before auth.init');
      eventHandlers.trackListener(
        auth.AuthBus,
        'authStateChanged',
        (event) => {
          logger.log('[authInit][AuthBus] Received authStateChanged', event?.detail);
          handleAuthStateChange(event);
        },
        { description: '[authInit] AuthBus authStateChanged', context: 'authInit' }
      );
      eventHandlers.trackListener(
        auth.AuthBus,
        'authReady',
        (event) => {
          logger.log('[authInit][AuthBus] Received authReady', event?.detail);
          handleAuthStateChange(event);
        },
        { description: '[authInit] AuthBus authReady', context: 'authInit' }
      );
    } else {
      logger.warn('[authInit] No AuthBus instance for auth event registration');
    }

    try {
      // auth.init() is responsible for verifying auth and calling broadcastAuth,
      // which in turn calls appModule.setAuthState().
      // So, appModule.state.isAuthenticated will be updated by auth.init() itself.
      logger.log('[authInit] Calling auth.init()');
      await auth.init();

      renderAuthHeader(); // Ensure this renders based on the now canonical appModule.state
      return true;
    } catch (err) {
      logger.error('[authInit] Auth system initialization failed', err, { context: 'authInit:init' });
      throw err;
    }
  }

  /**
   * Responds to authentication state changes by updating UI and dependent modules.
   *
   * Reads the latest authentication state and user information from {@link appModule.state}, updates the authentication header, and notifies relevant modules of the new state. If the user is authenticated, attempts to navigate to the project list or load projects once the application is ready.
   *
   * @param {CustomEvent} event - The authentication state change event.
   */
  function handleAuthStateChange(event) {
    // auth.js's broadcastAuth (via app.setAuthState) has already updated appModule.state
    // before this event listener is triggered.
    // This function now primarily reacts to that pre-established state.
    const appModule = DependencySystem.modules.get('appModule');

    logger.log('[authInit][handleAuthStateChange]', {
      eventDetail: event?.detail,
      appModuleState: JSON.stringify(appModule.state)
    });

    const isAuthenticated = appModule.state.isAuthenticated; // Read from canonical source
    const user = appModule.state.currentUser; // Read from canonical source

    // Local 'currentUser' variable removed.
    // renderAuthHeader will now directly use appModule.state.

    renderAuthHeader(); // Renders based on appModule.state

    // CONSOLIDATED: No need to call individual setAuthState methods
    // All modules should listen to authStateChanged events and read from appModule.state

    if (isAuthenticated) {
      const navService = DependencySystem.modules.get('navigationService');
      const appReadyDispatched = DependencySystem.modules.get('app')?._appReadyDispatched;
      const readyNow = appReadyDispatched || appModule.state.isReady;

      const proceed = () => {
        if (navService?.navigateToProjectList) {
          navService.navigateToProjectList().catch(() => {
            // Error handled silently
          });
        } else if (projectManager?.loadProjects) {
          projectManager.loadProjects('all').catch(() => {
            // Error handled silently
          });
        }
      };

      if (readyNow) {
        proceed();
      } else {
        domReadinessService.waitForEvent('app:ready', {
          timeout: APP_CONFIG.TIMEOUTS?.APP_READY_WAIT ?? 30000,
          context: 'authInit:handleAuthStateChange'
        }).then(proceed).catch(() => {
          // Error handled silently
        });
      }
    }
  }

  /**
   * Updates authentication-related UI elements in the header based on the current authentication state.
   *
   * Adjusts the visibility and content of login buttons, user menus, user initials, and status messages according to the user's authentication status and information from {@link appModule.state}. Attaches a logout handler to the logout button if present.
   *
   * @remark
   * If {@link appModule} is not available in the dependency system, the function logs an error and exits without updating the UI.
   */
  function renderAuthHeader() {
    try {
      const appModule = DependencySystem.modules.get('appModule');
      if (!appModule) {
        logger.error('[authInit][renderAuthHeader] appModule not found in DI. Cannot render header accurately.');
        return;
      }
      const isAuth = appModule.state.isAuthenticated;
      const user = appModule.state.currentUser; // Use canonical source

      logger.debug('[authInit][renderAuthHeader] Rendering auth header', { isAuth, user });

      const authBtn = domAPI.getElementById('authButton');
      const userMenu = domAPI.getElementById('userMenu');
      const logoutBtn = domAPI.getElementById('logoutBtn');
      const userInitialsEl = domAPI.getElementById('userInitials');
      const authStatus = domAPI.getElementById('authStatus');
      const userStatus = domAPI.getElementById('userStatus');

      /* ── login-button / user-menu visibility ─────────────────── */
      if (authBtn) {
        if (isAuth) {
          domAPI.addClass(authBtn, 'hidden');
          domAPI.setStyle(authBtn, 'display', 'none');
          domAPI.setAttribute(authBtn, 'hidden', 'hidden');
        } else {
          domAPI.removeClass(authBtn, 'hidden');
          domAPI.setStyle(authBtn, 'display', '');
          domAPI.removeAttribute(authBtn, 'hidden');
        }
      }

      if (userMenu) {
        domAPI.toggleClass(userMenu, 'hidden', !isAuth);
        domAPI.setStyle(userMenu, 'display', isAuth ? '' : 'none');
        isAuth
          ? userMenu.removeAttribute?.('hidden')
          : userMenu.setAttribute?.('hidden', 'hidden');
      }

      if (!isAuth) {
        const orphan = domAPI.getElementById('headerLoginForm');
        if (orphan) orphan.remove();
      }

      if (isAuth && userMenu && userInitialsEl) {
        let initials = '?';
        if (user?.name) { // Prefer user.name if available
          initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
        } else if (user?.username) { // Fallback to username
          initials = user.username.trim().slice(0, 2).toUpperCase();
        }
        domAPI.setTextContent(userInitialsEl, initials);
      } else if (userMenu && userInitialsEl) {
        domAPI.setTextContent(userInitialsEl, ''); // Clear if not authenticated
      }


      if (authStatus) {
        domAPI.setTextContent(authStatus, isAuth
          ? (user?.username ? `Signed in as ${user.username}` : 'Authenticated')
          : 'Not Authenticated'
        );
      }

      if (userStatus) {
        domAPI.setTextContent(userStatus, isAuth && user?.username
          ? `Hello, ${user.name ?? user.username}` // Prefer user.name for greeting
          : 'Offline'
        );
      }

      if (logoutBtn) {
        // Ensure listener is only attached once, or managed by eventHandlers.trackListener's internal tracking
        // Assuming trackListener handles duplicates or provides a way to clear old ones if this is called multiple times.
        const authMod = DependencySystem.modules.get('auth'); // Get authMod for logout
        eventHandlers.trackListener(
          logoutBtn,
          'click',
          safeHandler((e) => {
            domAPI.preventDefault(e);
            logger.debug('[authInit][renderAuthHeader] Logout button clicked.');
            authMod?.logout?.().catch(err => logger.error('[authInit] Error during logout action from button:', err));
          }, 'Auth logout button click'),
          { description: 'Auth logout button click', context: 'authInit', once: false } // Ensure it can be clicked multiple times if needed
        );
      }
    } catch (err) {
      logger.error('[authInit][renderAuthHeader] Error during rendering', err, { context: 'authInit:renderAuthHeader' });
      // Error handled silently
    }
  }

  /**
   * Utility function to force show login modal
   */
  function forceShowLoginModal() {
    // CONSOLIDATED: Only show login modal if not authenticated (check appModule.state)
    const appModule = DependencySystem.modules.get?.('appModule');
    if (appModule && !appModule.state?.isAuthenticated) {
      // Open the modal using modalManager if available
      const modalManager = DependencySystem.modules.get?.('modalManager');
      if (modalManager && typeof modalManager.show === 'function') {
        modalManager.show('login');
      } else {
        // Fallback: try the native dialog element directly
        const doc = DependencySystem.modules.get('domAPI')?.getDocument?.();
        const loginDlg = doc?.getElementById('loginModal');
        if (loginDlg && typeof loginDlg.showModal === 'function') {
          loginDlg.showModal();
        }
      }
    }
  }

  return {
    initializeAuthSystem,
    handleAuthStateChange,
    renderAuthHeader,
    forceShowLoginModal
  };
}
