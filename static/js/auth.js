/**
 * auth.js - Core authentication module
 * Handles user authentication, token management, and session state
 */

// Configuration
const AUTH_CONFIG = {
  VERIFICATION_INTERVAL: 300000,
  VERIFICATION_CACHE_DURATION: 60000,
  REFRESH_TIMEOUT: 10000,
  VERIFY_TIMEOUT: 5000,
  MAX_VERIFY_ATTEMPTS: 3,
  TOKEN_EXPIRY: {
    ACCESS_MINUTES: 1440,  // 1 day
    REFRESH_DAYS: 30       // 30 days
  }
};

// Central auth state object
const authState = {
  isAuthenticated: false,
  username: null,
  lastVerified: 0,
  tokenVersion: null
};

// Create a custom event bus for auth events
const AuthBus = new EventTarget();

// Track async operations
let tokenRefreshInProgress = false;
let refreshCooldownUntil = 0;
let authCheckInProgress = false;
let csrfToken = '';
let csrfTokenPromise = null;

/**
 * Persist the current auth state in localStorage
 */
function persistAuthState() {
  try {
    localStorage.setItem('authState', JSON.stringify({
      isAuthenticated: authState.isAuthenticated,
      username: authState.username,
      lastVerified: authState.lastVerified,
      tokenVersion: authState.tokenVersion
    }));
  } catch (e) {
    console.warn('[Auth] Failed to persist auth state:', e);
  }
}

/**
 * Load the persisted auth state from localStorage
 */
function loadPersistedAuthState() {
  try {
    const savedState = localStorage.getItem('authState');
    if (savedState) {
      const parsed = JSON.parse(savedState);
      authState.isAuthenticated = parsed.isAuthenticated || false;
      authState.username = parsed.username || null;
      authState.lastVerified = parsed.lastVerified || 0;
      authState.tokenVersion = parsed.tokenVersion || null;
      return true;
    }
  } catch (e) {
    console.warn('[Auth] Failed to load persisted auth state:', e);
  }
  return false;
}

/**
 * Returns any locally stored tokens (development fallback).
 */
function getStoredTokens() {
  const accessToken = localStorage.getItem('access_token');
  const refreshToken = localStorage.getItem('refresh_token');
  return { accessToken, refreshToken };
}

/**
 * Fetch a CSRF token from the server
 */
async function fetchCsrfToken() {
  try {
    const response = await fetch('/api/auth/csrf', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`CSRF fetch failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.token;
  } catch (error) {
    console.error('[Auth] CSRF token fetch failed:', error);
    throw error;
  }
}

/**
 * Get CSRF token - async safe version
 */
async function getCSRFTokenAsync() {
  if (csrfToken) return csrfToken;
  if (csrfTokenPromise) return csrfTokenPromise;

  csrfTokenPromise = (async () => {
    try {
      const token = await fetchCsrfToken();
      csrfToken = token;

      // Update meta tag if exists
      let meta = document.querySelector('meta[name="csrf-token"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'csrf-token';
        document.head.appendChild(meta);
      }
      meta.content = token;

      csrfTokenPromise = null;
      return token;
    } catch (error) {
      csrfTokenPromise = null;
      throw error;
    }
  })();

  return csrfTokenPromise;
}

/**
 * Synchronous CSRF token accessor
 */
function getCSRFToken() {
  if (!csrfToken) {
    getCSRFTokenAsync().catch(console.error);
  }
  return csrfToken;
}

/**
 * API request wrapper with auth handling
 */
async function authRequest(endpoint, method, body = null) {
  // Use global API request if available
  if (window.apiRequest && endpoint !== '/api/auth/csrf') {
    console.log(`[Auth Debug] Using global apiRequest for ${endpoint}`);
    return await window.apiRequest(endpoint, method, body);
  }

  console.log(`[Auth Debug] Using fallback request implementation for ${endpoint}`);

  // Fallback implementation
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  // Try to use a locally stored token for dev
  const { accessToken } = getStoredTokens();
  if (accessToken && endpoint !== '/api/auth/csrf') {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Skip CSRF for local development
  const isLocalDev = window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (!isLocalDev) {
    const token = await getCSRFTokenAsync();
    headers['X-CSRF-Token'] = token;
  }

  const options = {
    method: method.toUpperCase(),
    headers,
    credentials: 'include'
  };

  if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
    if (body instanceof FormData) {
      // Convert FormData to JSON for API endpoints expecting JSON
      const formDataObj = {};
      body.forEach((value, key) => {
        formDataObj[key] = value;
      });
      options.body = JSON.stringify(formDataObj);
    } else {
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(endpoint, options);

  if (!response.ok) {
    const error = new Error(`API error: ${response.status} ${response.statusText}`);
    error.status = response.status;

    try {
      error.data = await response.json();
    } catch (e) {
      error.data = await response.text();
    }

    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return await response.json();
}

/**
 * Refresh the authentication tokens
 */
async function refreshTokens() {
  const now = Date.now();
  console.log('[Auth Debug] Starting token refresh');

  // Handle cooldown period
  if (now < refreshCooldownUntil) {
    const remaining = Math.ceil((refreshCooldownUntil - now) / 1000);
    console.log(`[Auth Debug] Token refresh in cooldown, ${remaining}s remaining`);
    throw new Error(`Token refresh cooldown: ${remaining}s remaining`);
  }

  // Handle concurrent refresh attempts
  if (tokenRefreshInProgress) {
    console.log('[Auth Debug] Token refresh already in progress, waiting for result');
    return window.__tokenRefreshPromise;
  }

  tokenRefreshInProgress = true;

  window.__tokenRefreshPromise = (async () => {
    try {
      await getCSRFTokenAsync();

      // Debug cookie presence before refresh attempt
      const refreshCookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('refresh_token='));

      console.log('[Auth Debug] Before refresh request:', {
        refreshTokenCookieExists: !!refreshCookie,
        refreshTokenLocalStorage: !!localStorage.getItem('refresh_token')
      });

      const response = await authRequest('/api/auth/refresh', 'POST');

      if (!response?.access_token) {
        throw new Error('Invalid refresh response: missing token');
      }

      // Update auth state
      authState.isAuthenticated = true;
      authState.lastVerified = Date.now();
      if (response.token_version) {
        authState.tokenVersion = response.token_version;
      }
      if (response.username) {
        authState.username = response.username;
      }

      // Store new tokens in localStorage
      if (response.access_token) {
        localStorage.setItem('access_token', response.access_token);
      }
      if (response.refresh_token) {
        localStorage.setItem('refresh_token', response.refresh_token);
      }

      // Broadcast auth state
      broadcastAuth(true, authState.username);

      AuthBus.dispatchEvent(new CustomEvent('tokenRefreshed', {
        detail: { success: true }
      }));

      return { success: true, token: response.access_token };
    } catch (error) {
      // Set cooldown on failure
      refreshCooldownUntil = Date.now() + 30000; // 30s cooldown

      if (error.status === 401) {
        await clearTokenState({ source: 'refresh_401_error' });
      }

      AuthBus.dispatchEvent(new CustomEvent('tokenRefreshed', {
        detail: { success: false, error }
      }));

      throw error;
    } finally {
      tokenRefreshInProgress = false;
      window.__tokenRefreshPromise = null;
    }
  })();

  return window.__tokenRefreshPromise;
}

/**
 * Clear all auth state
 */
async function clearTokenState(options = { source: 'unknown', preserveCookies: false }) {
  authState.isAuthenticated = false;
  authState.username = null;
  authState.lastVerified = 0;
  authState.tokenVersion = null;

  // Also clear localStorage tokens
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');

  // Conditionally clear cookies if preserveCookies is false
  if (!options.preserveCookies) {
    document.cookie = 'access_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    document.cookie = 'refresh_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';

    // If we're not explicitly logging out, we also notify server
    if (options.source !== 'logout') {
      try {
        const csrf = await getCSRFTokenAsync();
        if (csrf) {
          await authRequest('/api/auth/logout', 'POST').catch(() => { });
        }
      } catch (e) {
        console.warn('[Auth] logout call to server failed:', e);
      }
    }
  }

  broadcastAuth(false, null);
}

/**
 * Verify authentication state
 */
async function verifyAuthState(forceVerify = false) {
  // Avoid duplicate checks
  if (authCheckInProgress && !forceVerify) {
    return authState.isAuthenticated;
  }

  // Use cached value if valid and not forcing
  const now = Date.now();
  const timeSinceLastVerified = now - authState.lastVerified;
  const isCacheValid = !forceVerify &&
    authState.isAuthenticated &&
    authState.lastVerified > 0 &&
    timeSinceLastVerified < AUTH_CONFIG.VERIFICATION_CACHE_DURATION;

  if (isCacheValid) {
    return true;
  }

  authCheckInProgress = true;

  try {
    await getCSRFTokenAsync();

    // Debug: Log cookie information
    console.log('[Auth Debug] Current cookies:', document.cookie);
    console.log('[Auth Debug] Local storage tokens:', {
      accessToken: !!localStorage.getItem('access_token'),
      refreshToken: !!localStorage.getItem('refresh_token')
    });

    const res = await authRequest('/api/auth/verify', 'GET', null, {
      timeout: AUTH_CONFIG.VERIFY_TIMEOUT
    });

    const serverAuthenticated = !!res?.authenticated;
    const serverUsername = res?.username || null;

    if (serverAuthenticated) {
      authState.isAuthenticated = true;
      authState.username = serverUsername;
      authState.lastVerified = Date.now();
      authState.tokenVersion = res?.token_version || authState.tokenVersion;
      broadcastAuth(true, serverUsername);
    } else {
      await clearTokenState({ source: 'verify_negative_response' });
    }

    return authState.isAuthenticated;
  } catch (error) {
    if (error.status === 401) {
      try {
        await refreshTokens();
        return authState.isAuthenticated;
      } catch (refreshError) {
        await clearTokenState({ source: 'verify_401_refresh_fail' });
        return false;
      }
    }
    return authState.isAuthenticated;
  } finally {
    authCheckInProgress = false;
  }
}

/**
 * Throttled version of verifyAuthState
 */
async function throttledVerifyAuthState(forceVerify = false) {
  try {
    return await verifyAuthState(forceVerify);
  } catch (error) {
    console.error('[Auth] Error in throttled verification:', error);
    return false;
  }
}

/**
 * Broadcast authentication state change
 */
function broadcastAuth(authenticated, username = null) {
  const previousState = authState.isAuthenticated;
  const stateChanged = authenticated !== previousState;

  authState.isAuthenticated = authenticated;
  authState.username = username;

  // Persist the updated state
  persistAuthState();

  const detail = {
    authenticated,
    username,
    timestamp: Date.now(),
    source: 'broadcastAuth',
    stateChanged
  };

  AuthBus.dispatchEvent(new CustomEvent('authStateChanged', { detail }));
}

/**
 * Login a user
 */
async function loginUser(username, password) {
  try {
    console.log('[Auth Debug] Starting login process for user:', username);
    await getCSRFTokenAsync();

    console.log('[Auth Debug] Sending login request');
    const response = await authRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password
    });

    console.log('[Auth Debug] Login response received:', {
      hasAccessToken: !!response.access_token,
      hasRefreshToken: !!response.refresh_token,
      username: response.username
    });

    // Store tokens in localStorage
    if (response.access_token) {
      localStorage.setItem('access_token', response.access_token);
    }
    if (response.refresh_token) {
      localStorage.setItem('refresh_token', response.refresh_token);
    }

    // Ensure all state updates are complete before broadcasting
    authState.isAuthenticated = true;
    authState.username = response.username || username;
    authState.lastVerified = Date.now();
    authState.tokenVersion = response.token_version || null;

    // Use microtask to ensure state is fully updated
    await Promise.resolve();
    broadcastAuth(true, authState.username);

    return response;
  } catch (error) {
    await clearTokenState({ source: 'login_error' });
    throw error;
  }
}

/**
 * Logout a user
 */
async function logout(e) {
  if (e && e.cancelable) {
    e.preventDefault();
  }

  // Clear project-related localStorage
  ['selectedProjectId', 'projectFilter'].forEach(key => {
    localStorage.removeItem(key);
  });

  broadcastAuth(false, null);

  try {
    const csrfToken = await getCSRFTokenAsync();
    const headers = {
      'X-CSRF-Token': csrfToken
    };
    await authRequest('/api/auth/logout', 'POST', null, headers);
  } catch (err) {
    console.warn('[Auth] Backend logout call failed:', err);
  } finally {
    await clearTokenState({ source: 'logout' });

    // Redirect to login page
    setTimeout(() => {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?loggedout=true';
      }
    }, 100);
  }
}

/**
 * Initialize the auth module
 */
async function init() {
  try {
    console.log('[Auth Debug] Initializing auth module...');
    console.log('[Auth Debug] Environment:', {
      hostname: window.location.hostname,
      protocol: window.location.protocol,
      isLocalDev: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    });

    // Load any persisted auth state from localStorage first
    loadPersistedAuthState();

    // Get initial CSRF token and wait for it to complete
    const csrfPromise = getCSRFTokenAsync().catch(err => {
      console.warn('[Auth] Initial CSRF fetch failed:', err);
      return null;
    });

    // Show a more specific message while verifying
    const loadingDiv = document.getElementById('appLoading');
    if (loadingDiv) {
      loadingDiv.querySelector('p').textContent = 'Verifying authentication...';
    }

    await csrfPromise;
    await verifyAuthState(false);

    // Setup periodic verification - but don't block init on it
    setInterval(() => {
      if (authState.isAuthenticated && !document.hidden) {
        verifyAuthState(false).catch(console.warn);
      }
    }, AUTH_CONFIG.VERIFICATION_INTERVAL);

    // Handle window focus
    window.addEventListener('focus', () => {
      const timeSinceLastVerified = Date.now() - authState.lastVerified;
      if (authState.isAuthenticated &&
        !authCheckInProgress &&
        timeSinceLastVerified > AUTH_CONFIG.VERIFICATION_CACHE_DURATION) {
        verifyAuthState(false).catch(console.warn);
      }
    });

    AuthBus.dispatchEvent(new CustomEvent('authReady', {
      detail: {
        authenticated: authState.isAuthenticated,
        username: authState.username
      }
    }));

    return true;
  } catch (error) {
    console.error('[Auth] Initialization failed:', error);
    await clearTokenState({ source: 'init_fail' });

    AuthBus.dispatchEvent(new CustomEvent('authReady', {
      detail: {
        authenticated: false,
        username: null,
        error: error.message
      }
    }));

    return false;
  }
}

// Register user
async function registerUser(formData) {
  try {
    await getCSRFTokenAsync();

    // Normalize the input data regardless of how it's passed
    let userData;

    if (formData instanceof FormData) {
      userData = {
        username: formData.get('username')?.trim(),
        password: formData.get('password')
      };
    } else {
      userData = {
        username: formData.username?.trim(),
        password: formData.password
      };
    }

    if (!userData.username || !userData.password) {
      throw new Error('Username and password are required');
    }

    console.log('[Auth Debug] Sending registration request to /api/auth/register with username:', userData.username);

    // Use the authRequest wrapper to handle CSRF and other headers
    const response = await authRequest('/api/auth/register', 'POST', userData);
    console.log('[Auth Debug] Registration response received');

    // If registration succeeded, store tokens
    if (response.access_token) {
      localStorage.setItem('access_token', response.access_token);
    }
    if (response.refresh_token) {
      localStorage.setItem('refresh_token', response.refresh_token);
    }

    if (response.access_token && response.username) {
      authState.isAuthenticated = true;
      authState.username = response.username;
      authState.lastVerified = Date.now();
      broadcastAuth(true, authState.username);
    }

    return response;
  } catch (error) {
    console.error('[Auth] Registration error:', error);
    throw error;
  }
}

// Public API
window.auth = {
  // State accessors
  isAuthenticated: () => authState.isAuthenticated,
  getCurrentUser: () => authState.username,

  // Core methods
  init,
  login: loginUser,
  logout,
  register: registerUser,
  verifyAuthState,
  refreshTokens,
  clearTokenState,

  // Async check
  checkAuth: async (opts = {}) => throttledVerifyAuthState(opts.forceVerify || false),

  // Utilities & Events
  AuthBus,
  getCSRFTokenAsync,
  getCSRFToken,

  // State flags
  isInitialized: false,
  isReady: false,
  authCheckInProgress
};

export default window.auth;
DependencySystem.register('auth', window.auth);
