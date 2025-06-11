// Front-end Auth Header UI Component – extracted from authInit.renderAuthHeader
// Responsible only for reflecting authentication state in the header DOM.
// No business-logic, no direct auth calls – keeps presentation concerns local.

export function createAuthHeaderUI({
  domAPI,
  eventHandlers,
  safeHandler,
  eventService,
  logger,
  DependencySystem
}) {
  if (!domAPI || !eventHandlers || !safeHandler || !eventService || !DependencySystem) {
    throw new Error('[authHeaderUI] Missing required dependencies');
  }

  const els = {
    authButton: null,
    userMenu: null,
    logoutBtn: null,
    userInitials: null,
    authStatus: null,
    userStatus: null
  };

  function _cacheDom() {
    const doc = domAPI.getDocument();
    els.authButton   = doc && domAPI.getElementById('authButton');
    els.userMenu     = doc && domAPI.getElementById('userMenu');
    els.logoutBtn    = doc && domAPI.getElementById('logoutBtn');
    els.userInitials = doc && domAPI.getElementById('userInitials');
    els.authStatus   = doc && domAPI.getElementById('authStatus');
    els.userStatus   = doc && domAPI.getElementById('userStatus');
  }

  function _initials(user) {
    if (!user) return 'U';
    if (user.name) {
      return user.name.trim().split(/\s+/).map(p => p[0]).join('').toUpperCase();
    }
    if (user.username) return user.username.slice(0, 2).toUpperCase();
    return 'U';
  }

  function render({ isAuthenticated, currentUser }) {
    if (!els.authButton) _cacheDom();

    if (els.authButton) {
      domAPI.toggleClass(els.authButton, 'hidden', isAuthenticated);
    }

    if (els.userMenu) {
      domAPI.toggleClass(els.userMenu, 'hidden', !isAuthenticated);
    }

    if (els.userInitials) {
      domAPI.setTextContent(els.userInitials, _initials(currentUser));
    }

    if (els.authStatus) {
      domAPI.setTextContent(
        els.authStatus,
        isAuthenticated ? `Signed in as ${currentUser?.name || currentUser?.username || 'User'}` : 'Not Authenticated'
      );
    }

    if (els.userStatus) {
      domAPI.setTextContent(
        els.userStatus,
        isAuthenticated ? `Hello, ${currentUser?.name || currentUser?.username || 'User'}` : 'Offline'
      );
    }
  }

  function attachLogoutHandler(onLogout) {
    if (!els.logoutBtn) _cacheDom();
    if (els.logoutBtn) {
      eventHandlers.trackListener(
        els.logoutBtn,
        'click',
        safeHandler((e) => {
          domAPI.preventDefault(e);
          onLogout?.();
        }, 'AuthHeaderUI:logout'),
        { context: 'authHeaderUI', description: 'logout click' }
      );
    }
  }

  function init() {
    _cacheDom();
    
    // Listen for auth state changes
    eventService.on('authStateChanged', (event) => {
      // Handle both direct event data and detail property
      const authData = event?.detail || event || {};
      logger.debug('[authHeaderUI] Received authStateChanged event', authData, { context: 'authHeaderUI:init' });
      render({
        isAuthenticated: authData.authenticated || authData.isAuthenticated || false,
        currentUser: authData.user || authData.currentUser || null
      });
    });

    // Try to get initial auth state and render immediately
    try {
      const authenticationService = DependencySystem?.modules?.get('authenticationService');
      if (authenticationService) {
        const isAuthenticated = authenticationService.isAuthenticated();
        const currentUser = authenticationService.getCurrentUser();
        
        logger.debug('[authHeaderUI] Rendering initial auth state', { 
          isAuthenticated, currentUser, context: 'authHeaderUI:init' 
        });
        
        render({ isAuthenticated, currentUser });
      }
    } catch (err) {
      logger.warn('[authHeaderUI] Could not get initial auth state', err, { context: 'authHeaderUI:init' });
    }
  }

  function cleanup() {
    eventHandlers.cleanupListeners({ context: 'authHeaderUI' });
    eventService.off('authStateChanged');
  }

  return {
    init,
    render,
    attachLogoutHandler,
    cleanup
  };
}
