// Front-end Auth Header UI Component – extracted from authInit.renderAuthHeader
// Responsible only for reflecting authentication state in the header DOM.
// No business-logic, no direct auth calls – keeps presentation concerns local.

export function createAuthHeaderUI({
  domAPI,
  eventHandlers,
  safeHandler,
  eventService,
  logger
}) {
  if (!domAPI || !eventHandlers || !safeHandler || !eventService) {
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
    // Sync once immediately if state already available
    // Consumers may call render() manually after creating the component; we
    // leave initial paint optional to avoid introducing extra dependencies.

    eventService.on('authStateChanged', ({ detail }) => {
      render(detail || {});
    });
  }

  return {
    init,
    render,
    attachLogoutHandler
  };
}
