/**
 * AuthStateManager - extracted state and event management (Phase-2)
 * ----------------------------------------------------------------
 * Handles authentication state management, event broadcasting,
 * and session management. Extracted from oversized auth.js.
 */

// ----------------------------------------------------------------------------
// AuthStateManager – v2 (2025-06-11)
// ----------------------------------------------------------------------------
// This revision removes the *duplicate* mutable authentication copy that used
// to live exclusively inside AuthStateManager.  From now on the canonical
// source-of-truth for `isAuthenticated` and `currentUser` is
// `appModule.state`, which every other front-end service (including the thin
// `authenticationService` façade) already relies on.  AuthStateManager still
// owns *session-related* fields (lastVerification, sessionStartTime) and the
// periodic session-age timer – no other module needs to mutate those.
//
// design notes:
//   • We lazily resolve `appModule` (and therefore `authenticationService`)
//     because bootstrapCore creates AuthStateManager *before* appModule has
//     been registered.  The resolve helper retries whenever it is needed so
//     early-boot code keeps functioning with a local fallback, while every
//     subsequent access uses the global state once available.
//   • All public read helpers (`isAuthenticated`, `getCurrentUser`, …)
//     delegate to `authenticationService` when available; otherwise they read
//     the local fallback copy (harmless during the few milliseconds in early
//     boot).
// ----------------------------------------------------------------------------

export function createAuthStateManager({
  eventService,
  logger,
  browserService,
  storageService,
  DependencySystem // optional – provided by bootstrapCore for lazy look-ups
} = {}) {
  const MODULE = 'AuthStateManager';

  if (!eventService || !logger || !browserService) {
    throw new Error(`[${MODULE}] Required dependencies missing: eventService, logger, browserService`);
  }

  const _log = (msg, extra = {}) => logger?.debug?.(`[${MODULE}] ${msg}`, {
    context: MODULE,
    ...extra
  });

  const _logError = (msg, err, extra = {}) => {
    logger?.error?.(`[${MODULE}] ${msg}`, err?.stack || err, {
      context: MODULE,
      ...extra
    });
  };

  // -------------------------------------------------------------
  // Lazy DI helpers – resolve appModule & authenticationService
  // -------------------------------------------------------------

  function _getAppModule() {
    return DependencySystem?.modules?.get?.('appModule') || null;
  }

  function _getAuthService() {
    return DependencySystem?.modules?.get?.('authenticationService') || null;
  }

  // Internal *fallback* state – used only until appModule is ready.
  let _fallbackAuthState = {
    isAuthenticated: false,
    currentUser: null,
    lastVerification: null,
    sessionStartTime: null
  };

  // Session management constants
  const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const SESSION_WARNING_THRESHOLD = 10 * 60 * 1000; // 10 minutes before expiry
  let sessionCheckTimer = null;

  function _readAuthStateFromSource() {
    const authSvc = _getAuthService();
    if (authSvc) {
      return authSvc.getAuthState();
    }

    const appMod = _getAppModule();
    if (appMod?.state) {
      return {
        isAuthenticated: appMod.state.isAuthenticated,
        currentUser: appMod.state.currentUser,
        lastVerification: _fallbackAuthState.lastVerification,
        sessionStartTime: _fallbackAuthState.sessionStartTime
      };
    }

    return { ..._fallbackAuthState };
  }

  function getAuthState() {
    return _readAuthStateFromSource();
  }

  function setAuthenticatedState(user) {
    if (!user || !user.id) {
      _logError('setAuthenticatedState called with invalid user object', null, { user });
      return;
    }

    const previousState = getAuthState();

    // --- Update canonical state ---------------------------------------
    const appMod = _getAppModule();
    if (appMod?.setAuthState) {
      try {
        appMod.setAuthState({ isAuthenticated: true, currentUser: user });
      } catch (e) {
        _logError('Failed to update appModule.setAuthState', e);
      }
    } else {
      // Fallback early-boot local copy
      _fallbackAuthState.isAuthenticated = true;
      _fallbackAuthState.currentUser = { ...user };
    }

    _fallbackAuthState.lastVerification = Date.now();
    if (!_fallbackAuthState.sessionStartTime) {
      _fallbackAuthState.sessionStartTime = Date.now();
    }

    _log('Authentication state updated', {
      userId: user.id,
      username: user.username,
      previouslyAuthenticated: previousState.isAuthenticated
    });

    startSessionMonitoring();

    broadcastAuthStateChange(previousState, getAuthState());

    if (storageService) {
      try {
        storageService.setItem('lastUser', JSON.stringify({
          id: user.id,
          username: user.username,
          lastLogin: Date.now()
        }));
      } catch (err) {
        _logError('Failed to store user info', err);
      }
    }
  }

  function setUnauthenticatedState() {
    const previousState = getAuthState();

    const appMod = _getAppModule();
    if (appMod?.setAuthState) {
      try {
        appMod.setAuthState({ isAuthenticated: false, currentUser: null });
      } catch (e) {
        _logError('Failed to clear auth state via appModule', e);
      }
    }

    _fallbackAuthState.isAuthenticated = false;
    _fallbackAuthState.currentUser = null;
    _fallbackAuthState.lastVerification = null;
    _fallbackAuthState.sessionStartTime = null;

    _log('Authentication state cleared', {
      wasAuthenticated: previousState.isAuthenticated,
      previousUser: previousState.currentUser?.username
    });

    stopSessionMonitoring();

    broadcastAuthStateChange(previousState, getAuthState());

    if (storageService) {
      try {
        storageService.removeItem('lastUser');
      } catch (err) {
        _logError('Failed to clear stored user info', err);
      }
    }
  }

  function updateLastVerification() {
    _fallbackAuthState.lastVerification = Date.now();
    _log('Last verification timestamp updated');
  }

  function broadcastAuthStateChange(previousState, newState) {
    try {
      const eventData = {
        authenticated: newState.isAuthenticated,
        user: newState.currentUser,
        previouslyAuthenticated: previousState.isAuthenticated,
        timestamp: Date.now()
      };

      // Emit on multiple event names for compatibility
      eventService.emit('authStateChanged', eventData);
      eventService.emit('auth:stateChanged', eventData);
      
      // Legacy event for backward compatibility
      if (newState.isAuthenticated && !previousState.isAuthenticated) {
        eventService.emit('user:loggedIn', eventData);
      } else if (!newState.isAuthenticated && previousState.isAuthenticated) {
        eventService.emit('user:loggedOut', eventData);
      }

      _log('Auth state change broadcasted', {
        authenticated: newState.isAuthenticated,
        userId: newState.currentUser?.id,
        eventTimestamp: eventData.timestamp
      });
    } catch (err) {
      _logError('Failed to broadcast auth state change', err);
    }
  }

  function startSessionMonitoring() {
    if (sessionCheckTimer) {
      clearInterval(sessionCheckTimer);
    }

    sessionCheckTimer = setInterval(() => {
      if (!_fallbackAuthState.isAuthenticated && !_getAuthService()?.isAuthenticated?.()) {
        stopSessionMonitoring();
        return;
      }

      const now = Date.now();
      const lastVerif = _fallbackAuthState.lastVerification || 0;
      const timeSinceLastVerification = now - lastVerif;
      
      // Emit session warning if approaching timeout
      if (timeSinceLastVerification > SESSION_WARNING_THRESHOLD) {
        eventService.emit('auth:sessionWarning', {
          timeSinceLastVerification,
          user: getCurrentUser()
        });
      }

      _log('Session monitoring check', {
        timeSinceLastVerification,
        sessionAge: now - (_fallbackAuthState.sessionStartTime || 0)
      });
    }, SESSION_CHECK_INTERVAL);

    _log('Session monitoring started');
  }

  function stopSessionMonitoring() {
    if (sessionCheckTimer) {
      clearInterval(sessionCheckTimer);
      sessionCheckTimer = null;
      _log('Session monitoring stopped');
    }
  }

  function isAuthenticated() {
    const authSvc = _getAuthService();
    if (authSvc) return authSvc.isAuthenticated();
    return _fallbackAuthState.isAuthenticated;
  }

  function getCurrentUser() {
    const authSvc = _getAuthService();
    if (authSvc) return authSvc.getCurrentUser();
    return _fallbackAuthState.currentUser ? { ..._fallbackAuthState.currentUser } : null;
  }

  function getCurrentUserId() {
    const user = getCurrentUser();
    return user?.id || null;
  }

  function getCurrentUsername() {
    const user = getCurrentUser();
    return user?.username || null;
  }

  function getSessionAge() {
    if (!_fallbackAuthState.sessionStartTime) return 0;
    return Date.now() - _fallbackAuthState.sessionStartTime;
  }

  function getTimeSinceLastVerification() {
    if (!_fallbackAuthState.lastVerification) return Infinity;
    return Date.now() - _fallbackAuthState.lastVerification;
  }

  function shouldVerifySession(threshold = 5 * 60 * 1000) { // 5 minutes default
    if (!isAuthenticated()) return false;
    return getTimeSinceLastVerification() > threshold;
  }

  // Initialize from stored data if available
  function initializeFromStorage() {
    if (!storageService) return;

    try {
      const storedUser = storageService.getItem('lastUser');
      if (storedUser) {
        const userData = JSON.parse(storedUser);
        _log('Found stored user data', { username: userData.username });
        // Don't automatically set as authenticated - will verify with server
        return userData;
      }
    } catch (err) {
      _logError('Failed to initialize from storage', err);
    }
    return null;
  }

  return {
    // State queries
    isAuthenticated,
    getCurrentUser,
    getCurrentUserId,
    getCurrentUsername,
    getAuthState,
    
    // Session info
    getSessionAge,
    getTimeSinceLastVerification,
    shouldVerifySession,

    // State management
    setAuthenticatedState,
    setUnauthenticatedState,
    updateLastVerification,

    // Session monitoring
    startSessionMonitoring,
    stopSessionMonitoring,

    // Initialization
    initializeFromStorage,

    // Event broadcasting (for manual triggers)
    broadcastAuthStateChange,

    cleanup() {
      _log('cleanup()');
      stopSessionMonitoring();
      setUnauthenticatedState();
    }
  };
}

export default createAuthStateManager;