/**
 * auth.js - Core Authentication Module
 *
 * Handles user authentication state based solely on backend HttpOnly cookies and server verification.
 *
 * Features:
 * - Secure, cookie-based authentication (no tokens in JS-accessible storage)
 * - CSRF protection for all state-changing requests
 * - Periodic session verification and automatic refresh
 * - Event system for auth state changes
 * - Graceful fallback for optional dependencies
 *
 * Dependencies:
 * - window.apiRequest (optional, for API requests)
 * - window.DependencySystem (optional, for module registration)
 * - document, fetch, EventTarget (browser built-ins)
 *
 * Exports:
 * - publicAuth (default): Main API for authentication actions and state
 */

/* =========================
   Configuration
   ========================= */

/** @type {Object} */
const AUTH_CONFIG = {
  VERIFICATION_INTERVAL: 300000, // 5 minutes: How often to re-verify session
};

/* =========================
   Internal State
   ========================= */

/**
 * Central authentication state.
 * @type {{ isAuthenticated: boolean, username: string|null, isReady: boolean }}
 */
const authState = {
  isAuthenticated: false,
  username: null,
  isReady: false, // True after initial verification completes
};

/**
 * Event bus for authentication events.
 * @type {EventTarget}
 */
const AuthBus = new EventTarget();

// Async operation flags to prevent race conditions
let authCheckInProgress = false;
let tokenRefreshInProgress = false;
let tokenRefreshPromise = null;
let csrfToken = '';
let csrfTokenPromise = null;

/* =========================
   Utility Functions
   ========================= */

/**
 * Detect if running in a local development environment.
 * @returns {boolean}
 */
function isLocalDev() {
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
}

/* =========================
   CSRF Token Management
   ========================= */

/**
 * Fetch a CSRF token from the backend.
 * Ensures token is not cached by adding a timestamp.
 * @returns {Promise<string|null>} The CSRF token, or null on error.
 */
async function fetchCsrfToken() {
  try {
    const response = await fetch(`/api/auth/csrf?ts=${Date.now()}`, {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`CSRF fetch failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data.token) {
      throw new Error('CSRF token missing in response');
    }
    return data.token;
  } catch (error) {
    console.error('[Auth] CSRF token fetch failed:', error);
    return null;
  }
}

/**
 * Get the CSRF token, ensuring only one fetch runs at a time.
 * @returns {Promise<string|null>}
 */
async function getCSRFTokenAsync() {
  if (csrfToken) return csrfToken;
  if (csrfTokenPromise) return csrfTokenPromise;

  csrfTokenPromise = (async () => {
    try {
      const token = await fetchCsrfToken();
      if (token) {
        csrfToken = token;
        // Optionally update meta tag for frameworks
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) meta.content = token;
      }
      return token;
    } finally {
      csrfTokenPromise = null;
    }
  })();

  return csrfTokenPromise;
}

/**
 * Synchronous accessor for the CSRF token.
 * May return empty string if token not yet fetched.
 * Triggers async fetch if needed.
 * @returns {string}
 */
function getCSRFToken() {
  if (!csrfToken && !csrfTokenPromise) {
    getCSRFTokenAsync().catch(console.error);
  }
  return csrfToken;
}

/* =========================
   API Request Wrapper
   ========================= */

/**
 * Central API request wrapper for authentication endpoints.
 * Handles credentials, CSRF, and error formatting.
 *
 * @param {string} endpoint - API endpoint (e.g. '/api/auth/login')
 * @param {string} method - HTTP method ('GET', 'POST', etc.)
 * @param {Object|null} body - Request body (for POST/PUT)
 * @returns {Promise<any>} - Parsed JSON response or null for 204
 * @throws {Error} - On network or API error
 */
async function authRequest(endpoint, method, body = null) {
  const AUTH_PROTECTED_ENDPOINTS = [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/logout',
    '/api/auth/refresh'
  ];

  // Use internal logic for protected endpoints, otherwise delegate if possible
  const isAuthProtected = AUTH_PROTECTED_ENDPOINTS.includes(endpoint);

  if (!isAuthProtected && window.apiRequest && endpoint !== '/api/auth/csrf') {
    return window.apiRequest(endpoint, method, body);
  }

  // Internal request logic
  const baseHeaders = { Accept: 'application/json' };
  const headers = { ...baseHeaders };
  const options = {
    method: method.toUpperCase(),
    headers,
    credentials: 'include',
  };

  // Add CSRF token for state-changing requests (except in local dev)
  const isStateChanging =
    !['GET', 'HEAD', 'OPTIONS'].includes(options.method) &&
    endpoint !== '/api/auth/csrf';

  if (isStateChanging) {
    const token = await getCSRFTokenAsync();
    if (token) {
      options.headers['X-CSRF-Token'] = token;
    } else {
      console.warn(`[Auth] CSRF token missing for request: ${endpoint}`);
    }
  }

  // Add JSON body if present
  if (body) {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(endpoint, options);
    if (!response.ok) {
      const error = new Error(`API error: ${response.status} ${response.statusText}`);
      error.status = response.status;
      try {
        error.data = await response.json();
      } catch {
        error.data = { detail: await response.text() };
      }
      throw error;
    }
    if (response.status === 204) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`[Auth] Request failed ${method} ${endpoint}:`, error);
    if (!error.status) {
      error.status = 0;
      error.data = { detail: error.message || 'Network error/CORS issue' };
    }
    throw error;
  }
}

/* =========================
   Token Refresh
   ========================= */

/**
 * Refresh authentication tokens via backend endpoint.
 * Ensures only one refresh runs at a time.
 * @returns {Promise<{success: boolean, response: any}>}
 */
async function refreshTokens() {
  if (tokenRefreshInProgress) {
    return tokenRefreshPromise;
  }

  tokenRefreshInProgress = true;

  tokenRefreshPromise = (async () => {
    try {
      await getCSRFTokenAsync();
      const response = await authRequest('/api/auth/refresh', 'POST');
      return { success: true, response };
    } catch (error) {
      console.error('[Auth] Refresh token failed:', error);
      if (error.status === 401) {
        await clearTokenState({ source: 'refresh_401_error', isError: true });
      }
      throw error;
    } finally {
      tokenRefreshInProgress = false;
      tokenRefreshPromise = null;
    }
  })();

  return tokenRefreshPromise;
}

/* =========================
   Auth State Management
   ========================= */

/**
 * Broadcast authentication state changes to the application.
 * Fires 'authStateChanged' event on AuthBus.
 *
 * @param {boolean} authenticated - New authentication state
 * @param {string|null} username - Username, if authenticated
 * @param {string} source - Source of the state change (for debugging)
 */
function broadcastAuth(authenticated, username = null, source = 'unknown') {
  const previous = authState.isAuthenticated;
  const changed = authenticated !== previous || authState.username !== username;

  authState.isAuthenticated = authenticated;
  authState.username = username;

  if (changed) {
    console.log(`[Auth] State changed (${source}): Auth=${authenticated}, User=${username ?? 'None'}`);
    AuthBus.dispatchEvent(
      new CustomEvent('authStateChanged', {
        detail: {
          authenticated,
          username,
          timestamp: Date.now(),
          source,
        },
      })
    );
  }
}

/**
 * Clears the frontend authentication state and broadcasts the change.
 * @param {Object} options - Additional options (source, isError)
 */
async function clearTokenState(options = { source: 'unknown', isError: false }) {
  console.log(`[Auth] Clearing auth state. Source: ${options.source}`);
  broadcastAuth(false, null, `clearTokenState:${options.source}`);
  // HttpOnly cookies are cleared by backend on logout
}

/* =========================
   Auth Verification
   ========================= */

/**
 * Verify authentication state with the backend.
 * Optionally forces verification even if a check is in progress.
 *
 * @param {boolean} [forceVerify=false] - Force verification even if already checking
 * @returns {Promise<boolean>} - True if authenticated, false otherwise
 */
async function verifyAuthState(forceVerify = false) {
  if (authCheckInProgress && !forceVerify) {
    return authState.isAuthenticated;
  }

  authCheckInProgress = true;

  try {
    const response = await authRequest('/api/auth/verify', 'GET');

    if (response?.authenticated) {
      broadcastAuth(true, response.username, 'verify_success');
      return true;
    }

    await clearTokenState({ source: 'verify_negative' });
    return false;

  } catch (error) {
    console.warn('[Auth] verifyAuthState error:', error);

    if (error.status === 500) {
      await clearTokenState({ source: 'verify_500' });
      throw new Error('Server error during verification');
    }

    if (error.status === 401) {
      try {
        await refreshTokens();
        return verifyAuthState(true);
      } catch (refreshError) {
        await clearTokenState({ source: 'refresh_failed' });
        return false;
      }
    }

    // For other errors, maintain current state
    return authState.isAuthenticated;
  } finally {
    authCheckInProgress = false;
  }
}

/* =========================
   Public Auth Actions
   ========================= */

/**
 * Log in a user via the backend.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<any>} - Backend response
 * @throws {Error} - On login or verification failure
 */
async function loginUser(username, password) {
  console.log('[Auth] Attempting login for user:', username);
  try {
    await getCSRFTokenAsync();

    const response = await authRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password,
    });

    if (response && response.username) {
      const verified = await verifyAuthState(true);
      if (verified) {
        return response;
      } else {
        await clearTokenState({ source: 'login_verify_fail' });
        throw new Error('Login succeeded but session could not be verified immediately.');
      }
    } else {
      await clearTokenState({ source: 'login_bad_response' });
      throw new Error('Login succeeded but received invalid response data.');
    }
  } catch (error) {
    await clearTokenState({ source: 'login_error' });
    throw error;
  }
}

/**
 * Log out the current user.
 * Clears frontend state and calls backend logout.
 * Redirects to /login after completion.
 *
 * @returns {Promise<void>}
 */
async function logout() {
  console.log('[Auth] Initiating logout...');
  await clearTokenState({ source: 'logout_manual' });

  try {
    await getCSRFTokenAsync();
    await authRequest('/api/auth/logout', 'POST');
    console.log('[Auth] Backend logout successful.');
  } catch (err) {
    console.warn('[Auth] Backend logout call failed:', err);
  } finally {
    setTimeout(() => {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?loggedout=true';
      }
    }, 150);
  }
}

/**
 * Register a new user via the backend.
 *
 * @param {Object} userData - { username: string, password: string }
 * @returns {Promise<any>} - Backend response
 * @throws {Error} - On registration or verification failure
 */
async function registerUser(userData) {
  if (!userData?.username || !userData?.password) {
    throw new Error('Username and password required.');
  }

  try {
    await getCSRFTokenAsync();
    const response = await authRequest('/api/auth/register', 'POST', {
      username: userData.username.trim(),
      password: userData.password,
    });

    const verified = await verifyAuthState(true);
    if (!verified) {
      console.warn('[Auth] Registration succeeded but verification failed.');
    }

    return response;
  } catch (error) {
    await clearTokenState({ source: 'register_error', isError: true });
    throw error;
  }
}

/* =========================
   Initialization
   ========================= */

/**
 * Initialize the authentication module.
 * Sets up form handlers, fetches CSRF, and verifies session.
 *
 * @returns {Promise<boolean>} - True if authenticated, false otherwise
 */
async function init() {
  if (authState.isReady) {
    console.warn('[Auth] init called multiple times.');
    return true;
  }
  console.log('[Auth] Initializing auth module...');


  // Set up login form handler (if present)
  const setupLoginForm = () => {
    const loginForm = document.getElementById('loginForm');
    if (loginForm && !loginForm._listenerAttached) {
      loginForm._listenerAttached = true;
      loginForm.action = '/api/auth/login';
      loginForm.method = 'POST';

      window.eventHandlers?.trackListener(loginForm, 'submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(loginForm);
        try {
          await publicAuth.login(
            formData.get('username'),
            formData.get('password')
          );
        } catch (error) {
          window.showNotification?.('Login failed: ' + error.message, 'error');
        }
      });
    }
  };

  setupLoginForm();
  document.addEventListener('modalsLoaded', setupLoginForm);

  try {
    // Fetch CSRF token (does not require authentication)
    await getCSRFTokenAsync();

    // Always verify session with backend (HttpOnly cookies may not be visible)
    const verified = await verifyAuthState(true);
    authState.isReady = true;
    return verified;

  } catch (error) {
    await clearTokenState({ source: 'init_fail', isError: true });
    authState.isReady = true;
    broadcastAuth(false, null, 'init_error');
    return false;
  } finally {
    // Set up periodic verification
    setInterval(() => {
      if (!document.hidden && authState.isAuthenticated) {
        verifyAuthState(false).catch(console.warn);
      }
    }, AUTH_CONFIG.VERIFICATION_INTERVAL);

    // Notify listeners that auth is ready
    AuthBus.dispatchEvent(
      new CustomEvent('authReady', {
        detail: {
          authenticated: authState.isAuthenticated,
          username: authState.username,
          error: null
        }
      })
    );
  }
}

/* =========================
   Public API
   ========================= */

/**
 * Main authentication API.
 * @namespace
 */
const publicAuth = {
  /** @returns {boolean} True if authenticated */
  isAuthenticated: () => authState.isAuthenticated,
  /** @returns {string|null} Current username, or null if not authenticated */
  getCurrentUser: () => authState.username,
  /** @returns {boolean} True if initial verification is complete */
  isReady: () => authState.isReady,

  // Core methods
  init,
  login: loginUser,
  logout,
  register: registerUser,
  verifyAuthState,

  // Utilities & events
  AuthBus,
  getCSRFTokenAsync,
  getCSRFToken,

  /**
   * Check if auth cookies are present (best effort, not reliable for HttpOnly).
   * @returns {boolean}
   */
  hasAuthCookies: () => {
    return document.cookie.includes('access_token') ||
      document.cookie.includes('refresh_token');
  }
};

window.auth = publicAuth;
window.DependencySystem.register('auth', publicAuth);

// ============================
// Auth Dropdown UI Logic
// ============================
(function setupAuthDropdown() {
  // Ensure DOM is ready
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  }

  ready(() => {
    const authBtn = document.getElementById('authButton');
    const dropdown = document.getElementById('authDropdown');
    if (!authBtn || !dropdown) return;

    let open = false;
    let lastActiveElement = null;

    function showDropdown() {
      if (open) return;
      open = true;
      dropdown.classList.remove('hidden');
      dropdown.setAttribute('aria-hidden', 'false');
      authBtn.setAttribute('aria-expanded', 'true');
      lastActiveElement = document.activeElement;

      // Focus first input
      const input = dropdown.querySelector('input, button, [tabindex]:not([tabindex="-1"])');
      if (input) input.focus();

      // Outside click closes
      document.addEventListener('mousedown', handleOutside, true);
      document.addEventListener('keydown', handleKeydown, true);
    }

    function hideDropdown() {
      if (!open) return;
      open = false;
      dropdown.classList.add('hidden');
      dropdown.setAttribute('aria-hidden', 'true');
      authBtn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('keydown', handleKeydown, true);
      if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
        lastActiveElement.focus();
      }
    }

    function handleOutside(e) {
      if (!dropdown.contains(e.target) && e.target !== authBtn) {
        hideDropdown();
      }
    }

    function handleKeydown(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        hideDropdown();
      }
    }

    authBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (open) {
        hideDropdown();
      } else {
        showDropdown();
      }
    });

    // Optional: hide on window blur (mobile UX)
    window.addEventListener('blur', hideDropdown);

    // Defensive: If user logs in, hide the dropdown and show user menu
    window.DependencySystem.waitFor('auth', ([auth]) => {
      auth.AuthBus?.addEventListener('authStateChanged', (ev) => {
        if (ev?.detail?.authenticated) {
          hideDropdown();
        }
      });
    });
  });
})();

export default publicAuth;
