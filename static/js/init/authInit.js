/**
 * authInit.js
 * Factory for auth system initialization, auth state change handling, and auth header rendering.
 *
 * Guardrails:
 * - Factory export (createAuthInitializer)
 * - Strict DI: Accept all dependencies as factory arguments
 * - No import-time side effects
 * - No global/window/document usage directly
 * - All event/listener registration via injected eventHandlers
 * - All logging via injected logger
 * - Use domReadinessService for DOM waits
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

  // Local state for currentUser (synced with appModule.state.currentUser)
  let currentUser = null;

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
   * Handle authentication state changes
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

    // Update the local `currentUser` variable which might be used by renderAuthHeader or other legacy parts.
    currentUser = user;

    renderAuthHeader(); // Renders based on the local `currentUser`

    const chatManager = DependencySystem.modules.get('chatManager');
    if (chatManager?.setAuthState) {
      chatManager.setAuthState(isAuthenticated);
    }
    const projectManager = DependencySystem.modules.get('projectManager');
    if (projectManager?.setAuthState) {
      projectManager.setAuthState(isAuthenticated);
    }

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
   * Render authentication header elements
   */
  function renderAuthHeader() {
    try {
      const authMod = DependencySystem.modules.get('auth');
      const isAuth = authMod?.isAuthenticated?.();
      const user = currentUser || { username: authMod?.getCurrentUser?.() };

      const authBtn = domAPI.getElementById('authButton');
      const userMenu = domAPI.getElementById('userMenu');
      const logoutBtn = domAPI.getElementById('logoutBtn');
      const userInitialsEl = domAPI.getElementById('userInitials');
      const authStatus = domAPI.getElementById('authStatus');
      const userStatus = domAPI.getElementById('userStatus');

      if (isAuth) {
        if (authBtn) domAPI.addClass(authBtn, 'hidden');
        if (userMenu) domAPI.removeClass(userMenu, 'hidden');
      } else {
        if (authBtn) domAPI.removeClass(authBtn, 'hidden');
        if (userMenu) domAPI.addClass(userMenu, 'hidden');
        const orphan = domAPI.getElementById('headerLoginForm');
        if (orphan) orphan.remove();
      }

      if (isAuth && userMenu && userInitialsEl) {
        let initials = '?';
        if (user?.name) {
          initials = user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
        } else if (user?.username) {
          initials = user.username.trim().slice(0, 2).toUpperCase();
        }
        domAPI.setTextContent(userInitialsEl, initials);
      }

      if (authStatus) {
        domAPI.setTextContent(authStatus, isAuth
          ? (user?.username ? `Signed in as ${user.username}` : 'Authenticated')
          : 'Not Authenticated'
        );
      }

      if (userStatus) {
        domAPI.setTextContent(userStatus, isAuth && user?.username
          ? `Hello, ${user.name ?? user.username}`
          : 'Offline'
        );
      }

      if (logoutBtn) {
        eventHandlers.trackListener(
          logoutBtn,
          'click',
          safeHandler((e) => {
            domAPI.preventDefault(e);
            authMod?.logout?.();
          }, 'Auth logout button'),
          { description: 'Auth logout button', context: 'authInit' }
        );
      }
    } catch (err) {
      logger.error('[authInit][renderAuthHeader]', err, { context: 'authInit:renderAuthHeader' });
      // Error handled silently
    }
  }

  /**
   * Utility function to force show login modal
   */
  function forceShowLoginModal() {
    // Only show login modal if not authenticated
    const authMod = DependencySystem.modules.get?.('auth');
    if (authMod && !authMod.isAuthenticated?.()) {
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
