/**
 * AuthStateManager - extracted state and event management (Phase-2)
 * ----------------------------------------------------------------
 * Handles authentication state management, event broadcasting,
 * and session management. Extracted from oversized auth.js.
 */

export function createAuthStateManager({
  eventService,
  logger,
  browserService,
  storageService
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

  // Internal state
  let authState = {
    isAuthenticated: false,
    currentUser: null,
    lastVerification: null,
    sessionStartTime: null
  };

  // Session management constants
  const SESSION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const SESSION_WARNING_THRESHOLD = 10 * 60 * 1000; // 10 minutes before expiry
  let sessionCheckTimer = null;

  function getAuthState() {
    return {
      isAuthenticated: authState.isAuthenticated,
      currentUser: authState.currentUser ? { ...authState.currentUser } : null,
      lastVerification: authState.lastVerification,
      sessionStartTime: authState.sessionStartTime
    };
  }

  function setAuthenticatedState(user) {
    if (!user || !user.id) {
      _logError('setAuthenticatedState called with invalid user object', null, { user });
      return;
    }

    const previousState = getAuthState();
    
    authState.isAuthenticated = true;
    authState.currentUser = { ...user };
    authState.lastVerification = Date.now();
    
    if (!authState.sessionStartTime) {
      authState.sessionStartTime = Date.now();
    }

    _log('Authentication state updated', {
      userId: user.id,
      username: user.username,
      previouslyAuthenticated: previousState.isAuthenticated
    });

    // Start session monitoring
    startSessionMonitoring();

    // Broadcast state change
    broadcastAuthStateChange(previousState, getAuthState());

    // Store user info if storage service available
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
    
    authState.isAuthenticated = false;
    authState.currentUser = null;
    authState.lastVerification = null;
    authState.sessionStartTime = null;

    _log('Authentication state cleared', {
      wasAuthenticated: previousState.isAuthenticated,
      previousUser: previousState.currentUser?.username
    });

    // Stop session monitoring
    stopSessionMonitoring();

    // Broadcast state change
    broadcastAuthStateChange(previousState, getAuthState());

    // Clear stored user info if storage service available
    if (storageService) {
      try {
        storageService.removeItem('lastUser');
      } catch (err) {
        _logError('Failed to clear stored user info', err);
      }
    }
  }

  function updateLastVerification() {
    authState.lastVerification = Date.now();
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
      if (!authState.isAuthenticated) {
        stopSessionMonitoring();
        return;
      }

      const now = Date.now();
      const timeSinceLastVerification = now - (authState.lastVerification || 0);
      
      // Emit session warning if approaching timeout
      if (timeSinceLastVerification > SESSION_WARNING_THRESHOLD) {
        eventService.emit('auth:sessionWarning', {
          timeSinceLastVerification,
          user: authState.currentUser
        });
      }

      _log('Session monitoring check', {
        timeSinceLastVerification,
        sessionAge: now - (authState.sessionStartTime || 0)
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
    return authState.isAuthenticated;
  }

  function getCurrentUser() {
    return authState.currentUser ? { ...authState.currentUser } : null;
  }

  function getCurrentUserId() {
    return authState.currentUser?.id || null;
  }

  function getCurrentUsername() {
    return authState.currentUser?.username || null;
  }

  function getSessionAge() {
    if (!authState.sessionStartTime) return 0;
    return Date.now() - authState.sessionStartTime;
  }

  function getTimeSinceLastVerification() {
    if (!authState.lastVerification) return Infinity;
    return Date.now() - authState.lastVerification;
  }

  function shouldVerifySession(threshold = 5 * 60 * 1000) { // 5 minutes default
    if (!authState.isAuthenticated) return false;
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