/**
 * auth.js - Core authentication module (Refactored Version)
 * Handles user authentication state based *solely* on backend HttpOnly cookies and verification.
/**
 * Dependencies:
 * - window.apiRequest (optional external dependency, for API requests)
 * - window.DependencySystem (optional external dependency, for module registration)
 * - document (browser built-in, for cookie access and DOM manipulation)
 * - fetch (browser built-in, for network requests)
 * - EventTarget (browser built-in, for AuthBus event system)
 */

// Browser APIs:
// - document (cookie access)
// - fetch (network requests)
// - EventTarget (event system)
// - setTimeout (timers)

// External Dependencies (Global Scope):
// - window.apiRequest (optional API request handler)
// - window.DependencySystem (optional module registration system)

// Optional Dependencies:
// - Falls back to internal authRequest if window.apiRequest not available
// - Gracefully handles missing DependencySystem


// Configuration
const AUTH_CONFIG = {
  VERIFICATION_INTERVAL: 300000, // 5 min: Periodic check if user is still logged in
};

// Central auth state - Simplified
const authState = {
  isAuthenticated: false,
  username: null,
  isReady: false, // Flag to indicate if initial verification is complete
};

// Event bus for auth events
const AuthBus = new EventTarget();

// Track async operations to prevent race conditions
let authCheckInProgress = false;
let tokenRefreshInProgress = false;
let tokenRefreshPromise = null; // Stores the promise for an ongoing refresh
let csrfToken = '';
let csrfTokenPromise = null; // Stores the promise for an ongoing CSRF fetch

/**
 * Helper to detect local dev environment
 */
function isLocalDev() {
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
}

/**
 * Fetch a CSRF token from the server
 */
async function fetchCsrfToken() {
  try {
    const response = await fetch('/api/auth/csrf', {
      method: 'GET',
      credentials: 'include', // Important for cookies
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
    // Allow app to continue but warn - state-changing actions will likely fail
    return null;
  }
}

/**
 * Get CSRF token - async safe version, ensures only one fetch runs at a time
 */
async function getCSRFTokenAsync() {
  if (csrfToken) return csrfToken;
  if (csrfTokenPromise) return csrfTokenPromise;

  csrfTokenPromise = (async () => {
    try {
      const token = await fetchCsrfToken();
      if (token) {
        csrfToken = token;
        // Update meta tag if desired
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) {
          meta.content = token;
        }
      }
      return token; // Return fetched token (or null on error)
    } catch {
      // Error already handled/logged in fetchCsrfToken
      return null;
    } finally {
      csrfTokenPromise = null; // Clear the promise lock
    }
  })();

  return csrfTokenPromise;
}

/**
 * Synchronous CSRF token accessor (best effort, may return empty string initially)
 */
function getCSRFToken() {
  if (!csrfToken && !csrfTokenPromise) {
    // Trigger async fetch but don't wait
    getCSRFTokenAsync().catch(console.error);
  }
  return csrfToken;
}

/**
 * Central API request wrapper
 * Handles credentials, CSRF, and basic error formatting.
 */
async function authRequest(endpoint, method, body = null) {
  // Use global apiRequest if available
  if (window.apiRequest && endpoint !== '/api/auth/csrf') {
    console.debug(`[Auth] Using global apiRequest for ${endpoint}`);
    return window.apiRequest(endpoint, method, body);
  }

  // Fallback implementation
  console.debug(`[Auth] Using internal authRequest for ${endpoint}`);
  const headers = { Accept: 'application/json' };
  const options = {
    method: method.toUpperCase(),
    headers,
    credentials: 'include', // crucial for sending/receiving HttpOnly cookies
  };

  // Add CSRF token for non-GET requests if not local dev
  const isStateChanging =
    !['GET', 'HEAD', 'OPTIONS'].includes(options.method) &&
    endpoint !== '/api/auth/csrf' &&
    !isLocalDev();

  if (isStateChanging) {
    const token = await getCSRFTokenAsync();
    if (token) {
      headers['X-CSRF-Token'] = token;
    } else {
      console.warn(`[Auth] CSRF token missing for request: ${endpoint}`);
    }
  }

  // Add body as JSON if present
  if (body) {
    options.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(endpoint, options);
    if (!response.ok) {
      const error = new Error(`API error: ${response.status} ${response.statusText}`);
      error.status = response.status;
      try {
        error.data = await response.json();
      } catch {
        error.data = await response.text();
      }
      throw error;
    }
    if (response.status === 204) {
      return null; // handle no-content
    }
    return await response.json(); // parse JSON response
  } catch (error) {
    console.error(`[Auth] Request failed ${method} ${endpoint}:`, error);
    if (!error.status) {
      // Network or unknown error
      error.status = 0;
      error.data = { detail: error.message || 'Network error/CORS issue' };
    }
    throw error;
  }
}

/**
 * Refresh authentication tokens via the backend endpoint.
 * Made atomic to prevent multiple concurrent refresh attempts.
 */
async function refreshTokens() {
  if (tokenRefreshInProgress) {
    console.debug('[Auth] Token refresh in progress, awaiting previous call.');
    return tokenRefreshPromise;
  }

  console.debug('[Auth] Starting token refresh...');
  tokenRefreshInProgress = true;

  tokenRefreshPromise = (async () => {
    try {
      await getCSRFTokenAsync();
      const response = await authRequest('/api/auth/refresh', 'POST');
      console.debug('[Auth] Token refresh successful.');
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

/**
 * Broadcasts authentication state changes to the application.
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
 * Clears the frontend authentication state.
 */
async function clearTokenState(options = { source: 'unknown', isError: false }) {
  console.log(`[Auth] Clearing auth state. Source: ${options.source}`);
  broadcastAuth(false, null, `clearTokenState:${options.source}`);
  // Cookies are not directly manipulable if HttpOnly; the backend cleans them on logout.
}

/**
 * Verify authentication state with the backend.
 */
async function verifyAuthState(forceVerify = false) {
    if (authCheckInProgress && !forceVerify) {
        return authState.isAuthenticated;
    }

    console.debug(`[Auth] Verifying auth state (forceVerify=${forceVerify})...`);
    authCheckInProgress = true;

    try {
        // Always check cookies first
        if (!document.cookie.includes('access_token')) {
            console.log('[Auth] No auth cookies detected');
            await clearTokenState({ source: 'no_cookies' });
            return false;
        }

        const response = await authRequest('/api/auth/verify', 'GET');

        if (response?.authenticated) {
            broadcastAuth(true, response.username, 'verify_success');
            return true;
        }

        await clearTokenState({ source: 'verify_negative' });
        return false;

    } catch (error) {
        console.warn('[Auth] verifyAuthState error:', error);

        // Handle 500 errors specifically
        if (error.status === 500) {
          console.error('[Auth] Server error during verify, clearing state');
          await clearTokenState({ source: 'verify_500' });
          throw new Error('Server error during verification');
        }

        if (error.status === 401) {
          // Try refresh if available
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

/**
 * Login user via the backend endpoint.
 */
async function loginUser(username, password) {
  console.log('[Auth] Attempting login for user:', username);
  try {
    // Get CSRF token first
    await getCSRFTokenAsync();

    // Perform login
    const response = await authRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password,
    });
    console.log('[Auth] Login API call successful.');

    // Verify auth state before broadcasting success
    try {
      const verified = await verifyAuthState(true);
      if (!verified) {
        console.error('[Auth] Login succeeded but verification failed');
        await clearTokenState({ source: 'verify_failed' });
        throw new Error('Session verification failed');
      }

      // Only broadcast success after verification
      broadcastAuth(true, username, 'login_success');
      console.log(`[Auth] User ${username} is now logged in.`);
      return response;
    } catch (verifyError) {
      console.error('[Auth] Verification failed:', verifyError);
      await clearTokenState({ source: 'verify_error' });
      throw verifyError;
    }
  } catch (error) {
    console.error('[Auth] Login failed:', error);
    await clearTokenState({ source: 'login_error' });
    throw error;
  }
}

/**
 * Logout user.
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
        console.log('[Auth] Redirecting to /login after logout.');
        window.location.href = '/login?loggedout=true';
      }
    }, 150);
  }
}

/**
 * Register a new user.
 */
async function registerUser(userData) {
  console.log('[Auth] Attempting registration:', userData?.username);
  if (!userData?.username || !userData?.password) {
    throw new Error('Username and password required.');
  }

  try {
    await getCSRFTokenAsync();
    const response = await authRequest('/api/auth/register', 'POST', {
      username: userData.username.trim(),
      password: userData.password,
    });

    console.log('[Auth] Registration API call successful.');
    const verified = await verifyAuthState(true);
    if (!verified) {
      console.warn('[Auth] Registration succeeded but verification failed.');
    } else {
      console.log(`[Auth] User ${authState.username} successfully registered and verified.`);
    }

    return response;
  } catch (error) {
    console.error('[Auth] Registration failed:', error);
    await clearTokenState({ source: 'register_error', isError: true });
    throw error;
  }
}

/**
 * Initialize the auth module.
 */
async function init() {
  if (authState.isReady) {
    console.warn('[Auth] init called multiple times.');
    return true;
  }
  console.log('[Auth] Initializing auth module...');

  try {
    // First get CSRF token - this doesn't require auth
    await getCSRFTokenAsync();

    // Skip immediate verify if we have no reason to believe we're authenticated
    if (!document.cookie.includes('access_token')) {
      console.log('[Auth] No auth cookies detected, skipping initial verify');
      broadcastAuth(false, null, 'init_no_cookies');
      return true; // Still return true since initialization completed
    }

    // Proceed with verification
    const verified = await verifyAuthState(true);
    authState.isReady = true;
    return verified;

  } catch (error) {
    console.error('[Auth] Initialization failed:', error);
    await clearTokenState({ source: 'init_fail', isError: true });
    authState.isReady = true; // Mark as ready even if failed
    return false;
  } finally {
    // Setup periodic checks only if we have auth cookies
    if (document.cookie.includes('access_token')) {
      setInterval(() => {
        if (!document.hidden && authState.isAuthenticated) {
          verifyAuthState(false).catch(console.warn);
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);
    }
  }
}

// --- Public API ---
// Define publicAuth *after* AuthBus and all methods are defined
const publicAuth = {
  // State Accessors
  isAuthenticated: () => authState.isAuthenticated,
  getCurrentUser: () => authState.username,
  isReady: () => authState.isReady,

  // Core Methods
  init,
  login: loginUser,
  logout,
  register: registerUser,
  verifyAuthState,

  // Utilities & Events
  AuthBus,
  getCSRFTokenAsync,
  getCSRFToken,

  // Add to auth.js public API
  hasAuthCookies: () => {
    return document.cookie.includes('access_token') ||
           document.cookie.includes('refresh_token');
  }
};

// --- Register with DependencySystem synchronously ---
window.auth = publicAuth; // Always attach to window for global access

if (window.DependencySystem) {
  window.DependencySystem.register('auth', publicAuth);
  console.log('[auth.js] Registered auth module with DependencySystem');
} else {
  console.warn('[auth.js] DependencySystem not found, attached auth to window');
}

// --- Call init after registration ---
init().catch(error => {
  console.error("[Auth] Initialization promise rejected:", error);
  if (!authState.isReady) {
    authState.isReady = true;
    AuthBus.dispatchEvent(
      new CustomEvent('authReady', {
        detail: {
          authenticated: false,
          username: null,
          error: error.message,
        },
      })
    );
  }
});

export default publicAuth;
