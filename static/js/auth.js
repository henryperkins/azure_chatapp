/**
 * Authentication module for handling user sessions, tokens, and auth state
 */
const AUTH_DEBUG = true;

// Session & Retry Flags
let sessionExpiredFlag = false;
let lastVerifyFailureTime = 0;
let tokenRefreshInProgress = false;
let lastRefreshAttempt = null;
let refreshFailCount = 0;

// Auth caching


// Config
const MIN_RETRY_INTERVAL = 5000; // ms between verification attempts after failure
const MAX_REFRESH_RETRIES = 3;

const authState = {
  isAuthenticated: false,
  username: null,
  lastVerified: 0,
  tokenVersion: null
};

// Primary constants for timeouts & intervals
const AUTH_CONSTANTS = {
  VERIFICATION_INTERVAL: 300000,          // 5 min
  VERIFICATION_CACHE_DURATION: 60000,     // 1 min
  REFRESH_TIMEOUT: 10000,                 // 10s
  VERIFY_TIMEOUT: 5000,                   // 5s
  MAX_VERIFY_ATTEMPTS: 3,
  ACCESS_TOKEN_EXPIRE_MINUTES: 30,
  REFRESH_TOKEN_EXPIRE_DAYS: 1
};

/* ----------------------------------
 *  Helpers: Cookies, Storage, Debug
 * ---------------------------------- */

/** Returns the cookie value by name or null if missing. */
function getCookie(name) {
  const c = `; ${document.cookie}`.split(`; ${name}=`);
  if (c.length === 2) return c.pop().split(';').shift();
  return null;
}

/** Sets an auth cookie with standard attributes in one place. */
function setAuthCookie(name, value, maxAgeSeconds) {
  const secure = location.protocol === 'https:' ? 'Secure; ' : '';
  const sameSite = 'SameSite=Strict';
  const path = '/;';

  if (!value) {
    // Clear cookie
    document.cookie = `${name}=; path=${path} expires=Thu, 01 Jan 1970 00:00:00 GMT; ${secure}${sameSite}`;
  } else {
    document.cookie = `${name}=${value}; path=${path} max-age=${maxAgeSeconds}; ${secure}${sameSite}`;
  }
}

/** Fetch token expiry from JWT 'exp' claim. */
function getTokenExpiry(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/** Checks if a token is already expired (server time if available). */
async function isTokenExpired(token) {
  if (!token) return true;
  const expiry = getTokenExpiry(token);
  if (!expiry) return true;

  let serverTime;
  try {
    const { serverTimestamp } = await apiRequest('/api/auth/timestamp', 'GET');
    serverTime = serverTimestamp * 1000;
  } catch {
    serverTime = Date.now();
  }
  return expiry < (serverTime - 10000);
}

/** Basic fallback for token expiry settings. Could be replaced by real API call. */
let __cachedExpirySettings = null;
async function fetchTokenExpirySettings() {
  if (__cachedExpirySettings) return __cachedExpirySettings;
  __cachedExpirySettings = {
    access_token_expire_minutes: 30,
    refresh_token_expire_days: 7
  };
  return __cachedExpirySettings;
}

/** Checks token age against a max window derived from iat. */
async function checkTokenValidity(token, { allowRefresh = false } = {}) {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const settings = await fetchTokenExpirySettings();
    const maxAge = allowRefresh
      ? settings.refresh_token_expire_days * 86400
      : settings.access_token_expire_minutes * 60;
    const tokenAge = (Date.now() / 1000) - payload.iat;
    return tokenAge < maxAge;
  } catch {
    return false;
  }
}

/** Clears in-memory auth state & marks session as expired. Does NOT remove cookies. */
function clearTokenState() {
  authState.isAuthenticated = false;
  authState.username = null;
  authState.lastVerified = 0;
  sessionExpiredFlag = Date.now();
  refreshFailCount = 0;
  broadcastAuth(false);
  if (AUTH_DEBUG) console.debug('[Auth] Auth state cleared');
}

/** Basic user notification fallback. */
function notify(message, type = "info") {
  if (window.showNotification) {
    window.showNotification(message, type);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

/** Helper logging for form or security issues. */
function logFormIssue(type, details) {
  if (AUTH_DEBUG) {
    console.warn(`[Auth][Issue] ${type}`, details);
  }
  if (window.telemetry?.logSecurityEvent && type.includes('SECURITY')) {
    window.telemetry.logSecurityEvent(type, details);
  }
}

/** Minimal error standardization. */
function standardizeError(error, context) {
  const e = {
    status: error.status || 500,
    message: error.message || "Unknown error",
    context: context || "auth",
    code: error.code || "UNKNOWN_ERROR"
  };
  if (e.status === 401 || e.message.includes('expired')) {
    e.code = "SESSION_EXPIRED";
  }
  return e;
}

/** Optionally show session-expired UI. */
function showSessionExpiredModal() {
  notify("Your session has expired. Please log in again.", "error");
  // Possibly show more UI here if needed.
}

/** Single function that either sets or gets tokens from sessionStorage. */
function syncTokensToSessionStorage(action = 'get') {
  if (action === 'store') {
    // Store tokens from cookies to sessionStorage
    const accessToken = getCookie('access_token');
    const refreshToken = getCookie('refresh_token');

    if (accessToken) {
      sessionStorage.setItem('access_token', accessToken);
    } else {
      sessionStorage.removeItem('access_token');
    }

    if (refreshToken) {
      sessionStorage.setItem('refresh_token', refreshToken);
    } else {
      sessionStorage.removeItem('refresh_token');
    }

    if (authState.username) {
      sessionStorage.setItem('username', authState.username);
    }

    return true;
  } else {
    // Retrieve tokens from sessionStorage and set as cookies if found
    const accessToken = sessionStorage.getItem('access_token');
    const refreshToken = sessionStorage.getItem('refresh_token');
    const username = sessionStorage.getItem('username');

    let restored = false;

    if (accessToken && !getCookie('access_token')) {
      setAuthCookie('access_token', accessToken, 60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES);
      restored = true;
    }

    if (refreshToken && !getCookie('refresh_token')) {
      setAuthCookie('refresh_token', refreshToken, 60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS);
      restored = true;
    }

    if (username) {
      window.__lastUsername = username;
    }

    return restored;
  }
}


/* ----------------------------------
 *  Core HTTP Functions
 * ---------------------------------- */

/** Low-level fetch wrapper with credentials & optional CSRF. */
async function authRequest(endpoint, method, body = null) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (csrfToken && method !== 'GET') {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const resp = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: 'Unknown error' }));
      throw { status: resp.status, message: err.message || 'Authentication failed' };
    }
    return resp.json();
  } catch (error) {
    throw error;
  }
}

/** Fallback or override for requests. */
async function apiRequest(url, method, data = null, options = {}) {
  if (window.apiRequest) return window.apiRequest(url, method, data, options);
  return authRequest(url, method, data);
}

/* ----------------------------------
 *  Token Refresh Logic
 * ---------------------------------- */

async function refreshTokens() {
  const refreshId = Date.now().toString(36);
  if (tokenRefreshInProgress) {
    if (AUTH_DEBUG) console.debug(`[Auth][${refreshId}] Refresh in progress`);
    return window.__tokenRefreshPromise;
  }

  const now = Date.now();
  const timeSinceLastVerified = now - authState.lastVerified;
  if (timeSinceLastVerified < 5000) {
    if (AUTH_DEBUG) console.debug(`[Auth][${refreshId}] Skipping refresh - recent verify`);
    return { success: true, token: getCookie('access_token') };
  }

  if (lastRefreshAttempt && now - lastRefreshAttempt < 30000 && refreshFailCount >= MAX_REFRESH_RETRIES) {
    return Promise.reject(new Error('Too many refresh attempts'));
  }

  tokenRefreshInProgress = true;
  lastRefreshAttempt = now;
  window.__tokenRefreshPromise = (async () => {
    let refreshTokenVal = getCookie('refresh_token');
    if (!refreshTokenVal) {
      tokenRefreshInProgress = false;
      throw new Error('No refresh token available');
    }

    const expiry = getTokenExpiry(refreshTokenVal);
    if (expiry && expiry < Date.now()) {
      tokenRefreshInProgress = false;
      throw new Error('Refresh token expired');
    }

    let lastError, response;
    for (let attempt = 1; attempt <= MAX_REFRESH_RETRIES; attempt++) {
      try {
        if (AUTH_DEBUG) console.debug(`[Auth] Refresh attempt ${attempt}/${MAX_REFRESH_RETRIES}`);
        const controller = new AbortController();
        const timeoutMs = AUTH_CONSTANTS.REFRESH_TIMEOUT * Math.pow(2, attempt - 1);
        const fetchPromise = apiRequest('/api/auth/refresh', 'POST', null, { signal: controller.signal });
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        response = await fetchPromise.catch(err => {
          if (err.name === 'AbortError') throw new Error(`Refresh timeout (${timeoutMs}ms)`);
          throw err;
        });
        clearTimeout(timeoutId);

        if (!response?.access_token) throw new Error('Invalid refresh response');

        if (response.token_version) authState.tokenVersion = response.token_version;
        break;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_REFRESH_RETRIES) {
          const backoff = 300 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }

    if (lastError && !response?.access_token) throw lastError;

    refreshFailCount = 0;
    authState.lastVerified = Date.now();

    if (response.access_token) {
      setAuthCookie('access_token', response.access_token, 60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES);
    }
    if (response.refresh_token) {
      setAuthCookie('refresh_token', response.refresh_token, 60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS);
    }

    tokenRefreshInProgress = false;
    // Ensure auth state is updated and broadcasted on successful refresh
    authState.isAuthenticated = true; // Mark as authenticated locally
    // We don't get username from refresh, so keep existing or null
    broadcastAuth(true, authState.username);
    document.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: true } }));

    return { success: true, token: response.access_token };
  })()
    .catch(err => {
      // On unrecoverable refresh failure, clear the auth state
      if (AUTH_DEBUG) console.error(`[Auth] Unrecoverable refresh error: ${err.message}. Clearing token state.`);
      clearTokenState(); // This will also broadcast false

      refreshFailCount++;
      tokenRefreshInProgress = false;
      document.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: false, error: err } }));
      // Re-throw the original error after clearing state
      throw err;
    });

  return window.__tokenRefreshPromise;
}

/* ----------------------------------
 *  Verification Logic
 * ---------------------------------- */

/**
 * Retrieve a valid access token, attempting refresh if necessary.
 * Simplified logic: Check access -> Check refresh -> Attempt refresh -> Fail/Return empty.
 */
async function getAuthToken(options = {}) {
  const allowEmpty = options.allowEmpty === true;
  const operationId = `getAuthToken-${Date.now().toString(36)}`; // Unique ID for logging

  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] getAuthToken called`, options);

  // 1. Check current access token
  const accessToken = getCookie('access_token');
  if (accessToken) {
    const isValid = await checkTokenValidity(accessToken).catch(() => false);
    if (isValid) {
      if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Valid access token found in cookie.`);
      return accessToken;
    }
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Access token found but invalid/expired.`);
  } else {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] No access token cookie found.`);
  }

  // 2. Check refresh token validity
  const refreshToken = getCookie('refresh_token');
  if (!refreshToken) {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] No refresh token found.`);
    if (allowEmpty) return '';
    throw new Error('Authentication required (no refresh token)');
  }

  const isRefreshValid = await checkTokenValidity(refreshToken, { allowRefresh: true }).catch(() => false);
  if (!isRefreshValid) {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Refresh token found but invalid/expired.`);
    clearTokenState(); // Clear state if refresh token is bad
    if (allowEmpty) return '';
    throw new Error('Session expired (invalid refresh token)');
  }

  // 3. Attempt token refresh (handles its own locking and retries)
  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Attempting token refresh.`);
  try {
    // Wait for any ongoing refresh first
    if (tokenRefreshInProgress && window.__tokenRefreshPromise) {
        if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Waiting for existing refresh promise.`);
        await window.__tokenRefreshPromise;
    } else {
        await refreshTokens(); // Trigger refresh if not already in progress
    }

    // After refresh attempt (successful or waited), check for new access token
    const newAccessToken = getCookie('access_token');
    if (newAccessToken && await checkTokenValidity(newAccessToken).catch(() => false)) {
      if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Token refresh successful, returning new access token.`);
      // Ensure auth state is consistent after successful refresh
      if (!authState.isAuthenticated) {
          broadcastAuth(true, authState.username); // Broadcast if state was somehow inconsistent
      }
      return newAccessToken;
    } else {
      // This case should ideally be handled within refreshTokens failure logic
      if (AUTH_DEBUG) console.warn(`[Auth][${operationId}] Refresh completed but no valid access token found.`);
      // Don't clear state here, refreshTokens should handle that on failure
      if (allowEmpty) return '';
      throw new Error('Token refresh failed to provide a valid token.');
    }
  } catch (refreshError) {
    if (AUTH_DEBUG) console.error(`[Auth][${operationId}] Token refresh failed:`, refreshError);
    // refreshTokens should handle clearing state on unrecoverable errors.
    // We just propagate the error or return empty based on options.
    if (allowEmpty) {
        console.warn(`[Auth][${operationId}] Refresh failed, returning empty token due to allowEmpty.`);
        return '';
    }
    // Re-throw a more specific error if possible
    const errorMessage = refreshError.message.includes('expired') ? 'Session expired' : 'Authentication failed during refresh';
    throw new Error(errorMessage);
  }
}

/**
 * Master function to verify the user's auth state with the server.
 * If tokens are present but invalid, tries refresh.
 * Verifies the user's auth state directly with the server via `/api/auth/verify`.
 * Should be called when forced verification is needed or periodically.
 * Does NOT attempt token refresh itself.
 */
async function verifyAuthState(forceVerify = false) {
  const operationId = `verifyAuthState-${Date.now().toString(36)}`;
  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] verifyAuthState called (forceVerify=${forceVerify})`);

  // 1. Check rate limiting and session expired flag
  if (Date.now() - lastVerifyFailureTime < MIN_RETRY_INTERVAL) {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Skipping verify - recent failure.`);
    return authState.isAuthenticated; // Return last known state
  }
  if (sessionExpiredFlag && Date.now() - sessionExpiredFlag < 10000) {
     if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Skipping verify - session recently marked expired.`);
     return false; // Definitely not authenticated if recently expired
  }
   // Reset expired flag if enough time has passed
  if (sessionExpiredFlag && Date.now() - sessionExpiredFlag >= 10000) {
     sessionExpiredFlag = false;
  }

  // 2. Check cache (unless forced) - Use simple time-based cache
  const now = Date.now();
  if (!forceVerify && authState.lastVerified && (now - authState.lastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION)) {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Returning cached auth state (valid for ${((AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION - (now - authState.lastVerified))/1000).toFixed(1)}s).`);
    return authState.isAuthenticated;
  }

  // 3. Perform server verification
  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Performing server verification.`);
  const attempts = AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS;
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      // Check CSRF token first - moved earlier in the flow
      const csrfToken = getCSRFToken();
      if (!csrfToken) {
        if (AUTH_DEBUG) console.warn(`[Auth][${operationId}] CSRF token missing for verification`);
        // Don't fail immediately, attempt to refresh first
        if (i === attempts) {
          throw new Error('CSRF token missing for verification');
        }
        // Wait before retry
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const res = await Promise.race([
        apiRequest('/api/auth/verify', 'GET', null, {
          headers: {
            'X-CSRF-Token': csrfToken
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`verify timeout (attempt ${i})`)), AUTH_CONSTANTS.VERIFY_TIMEOUT + i * 1000)
        )
      ]);

      // --- Success Case ---
      const serverAuthenticated = !!res.authenticated;
      const serverUsername = res.username || null;
      if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Verification successful: authenticated=${serverAuthenticated}, username=${serverUsername}`);

      authState.isAuthenticated = serverAuthenticated;
      authState.username = serverUsername;
      authState.lastVerified = Date.now(); // Update cache time
      lastVerifyFailureTime = 0; // Reset failure time on success

      broadcastAuth(serverAuthenticated, serverUsername); // Broadcast the verified state
      return serverAuthenticated;

    } catch (err) {
      lastError = err;
      if (AUTH_DEBUG) console.warn(`[Auth][${operationId}] Verification attempt ${i} failed:`, err);

      // --- Handle 401 Unauthorized ---
      if (err.status === 401 || err.message?.includes('expired')) {
        if (AUTH_DEBUG) {
          console.debug(`[Auth][${operationId}] Received 401/Expired, attempting token refresh before clearing state.`);
          console.debug('Access token:', getCookie('access_token') ? 'present' : 'missing');
          console.debug('Refresh token:', getCookie('refresh_token') ? 'present' : 'missing');
          console.debug('CSRF token:', document.querySelector('meta[name="csrf-token"]')?.content ? 'present' : 'missing');
        }

        // First attempt token refresh before clearing state
        try {
          const refreshToken = getCookie('refresh_token');
          if (!refreshToken) {
            if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] No refresh token available, clearing state.`);
            sessionExpiredFlag = Date.now();
            clearTokenState();
            return false;
          }

          // Check if refresh token is still valid
          const isRefreshValid = await checkTokenValidity(refreshToken, { allowRefresh: true }).catch(() => false);
          if (!isRefreshValid) {
            if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Refresh token invalid, clearing state.`);
            sessionExpiredFlag = Date.now();
            clearTokenState();
            return false;
          }

          // Attempt refresh with short timeout
          const refreshResult = await Promise.race([
            refreshTokens(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), 2000))
          ]).catch(refreshErr => {
            if (AUTH_DEBUG) console.error(`[Auth][${operationId}] Token refresh failed:`, refreshErr);
            return null;
          });

          if (refreshResult?.success) {
            if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Token refresh successful, retrying verification.`);
            // Short delay before retrying verification
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
        } catch (refreshErr) {
          if (AUTH_DEBUG) console.error(`[Auth][${operationId}] Error during refresh attempt:`, refreshErr);
        }

        // If we get here, refresh failed or wasn't attempted
        sessionExpiredFlag = Date.now();
        clearTokenState();
        return false;
      }

      // --- Handle other errors (timeout, server error) ---
      if (i < attempts) {
        // Exponential backoff before retrying
        const backoffMs = Math.min(1000 * (2 ** (i - 1)), 5000);
        if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Waiting ${backoffMs}ms before retry.`);
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
         // Max attempts reached
         if (AUTH_DEBUG) console.error(`[Auth][${operationId}] Max verification attempts reached.`);
         authState.lastVerified = Date.now(); // Update timestamp even on failure to prevent immediate retry loops
         lastVerifyFailureTime = Date.now(); // Set failure time to enforce rate limit
         // Don't change authState here, just throw the last error
         throw lastError || new Error('Auth verification failed after multiple attempts');
      }
    }
  }
  // Should not be reached if loop completes or throws
  return authState.isAuthenticated;
}

/* ----------------------------------
 *  UI Handling & State Broadcasting
 * ---------------------------------- */

function broadcastAuth(authenticated, username = null) {
  const changed = (authState.isAuthenticated !== authenticated) ||
    (authState.username !== username);
  authState.isAuthenticated = authenticated;
  authState.username = username;

  // Always update UI even if state hasn't changed to ensure sync
  updateAuthUI(authenticated, username);

  // Create a more detailed event payload with timestamp
  const detail = {
    authenticated,
    username,
    timestamp: Date.now(),
    source: 'authStateChanged'
  };

  // Dispatch on both document and window for wider reach
  document.dispatchEvent(new CustomEvent("authStateChanged", { detail }));
  window.dispatchEvent(new CustomEvent("authStateChanged", { detail }));

  // Force a project reload if authenticated to ensure fresh data
  if (authenticated && window.projectManager?.loadProjects) {
    console.log("[Auth] Broadcasting auth state triggered project reload");
    setTimeout(() => {
      window.projectManager.loadProjects('all')
        .catch(err => console.error("[Auth] Error loading projects after auth broadcast:", err));
    }, 50);
  }
}

function updateAuthUI(authenticated, username = null) {
  const userStatus = document.getElementById('userStatus');
  const authButton = document.getElementById('authButton');
  if (userStatus) userStatus.textContent = authenticated ? (username || 'Online') : 'Offline';
  if (authButton) authButton.textContent = authenticated ? (username || 'Account') : 'Login';

  const loggedInState = document.getElementById('loggedInState');
  if (loggedInState) {
    loggedInState.classList.toggle('hidden', !authenticated);
    const usrSpan = document.getElementById('loggedInUsername');
    if (usrSpan && username) usrSpan.textContent = username;
  }

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  if (loginForm && registerForm) {
    if (authenticated) {
      loginForm.classList.add('hidden');
      registerForm.classList.add('hidden');
    } else {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
    }
  }
}

/* ----------------------------------
 *  Login / Logout / Registration
 * ---------------------------------- */

async function loginUser(username, password) {
  if (window.__loginInProgress && window.__loginAbortController) {
    window.__loginAbortController.abort();
  }
  window.__loginInProgress = true;
  window.__loginAbortController = new AbortController();
  const loginId = Date.now().toString(36);
  const loginTimeout = setTimeout(() => {
    if (window.__loginAbortController) window.__loginAbortController.abort();
    throw new Error('Login timed out');
  }, 15000);

  try {
    const response = await apiRequest('/api/auth/login', 'POST', { username: username.trim(), password });
    if (!response.access_token) throw new Error('No access token received');

    window.__recentLoginTimestamp = Date.now();
    window.__directAccessToken = response.access_token;
    window.__directRefreshToken = response.refresh_token;
    window.__lastUsername = response.username || username;

    setAuthCookie('access_token', response.access_token, 60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES);
    if (response.refresh_token) {
      setAuthCookie('refresh_token', response.refresh_token, 60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS);
    }
    authState.isAuthenticated = true;
    authState.username = response.username || username;
    authState.lastVerified = Date.now();
    sessionExpiredFlag = false;

    // Ensure tokens are properly synced to sessionStorage
    syncTokensToSessionStorage('store');

    // Wait for auth state to be fully propagated before proceeding
    await new Promise(resolve => {
      // Broadcast auth state change first
      broadcastAuth(true, authState.username);

      // Small delay to ensure event listeners complete processing
      setTimeout(resolve, 100);
    });

    // Dispatch explicit event for components to react to successful authentication
    document.dispatchEvent(new CustomEvent('authStateConfirmed', {
      detail: {
        isAuthenticated: true,
        username: authState.username,
        timestamp: Date.now()
      }
    }));

    // Prepare for post-login steps
    const postLoginTasks = async () => {
      try {
        // Ensure we have a selected project after login
        const selectedProjectId = localStorage.getItem('selectedProjectId');
        if (!selectedProjectId && window.projectManager?.loadProjects) {
          console.log("[Auth] No project selected, loading first available project after login");
          const response = await window.projectManager.loadProjects('all');
          if (response?.data?.projects?.length > 0) {
            const firstProject = response.data.projects[0];
            localStorage.setItem('selectedProjectId', firstProject.id);
            console.log(`[Auth] Selected first project after login: ${firstProject.id} (${firstProject.name})`);

            // Force render project list if component exists
            if (window.projectListComponent?.forceRender) {
              setTimeout(() => {
                console.log("[Auth] Forcing project list render after selection");
                window.projectListComponent.forceRender();
              }, 300);
            }
          }
        }
      } catch (err) {
        console.error("[Auth] Error in post-login tasks:", err);
      }
    };

    // Run post-login tasks immediately instead of delaying
    postLoginTasks();

    // Ensure project list is displayed immediately
    const projectListView = document.getElementById('projectListView');
    const loginRequiredMessage = document.getElementById('loginRequiredMessage');
    if (projectListView) projectListView.classList.remove('hidden');
    if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');

    // More aggressive UI updates after login success
    const projectListGrid = document.getElementById('projectList');
    if (projectListGrid && projectListGrid.classList.contains('hidden')) {
      projectListGrid.classList.remove('hidden');
    }

    // Important: Force dashboard initialization if needed
    if (window.projectDashboard && typeof window.projectDashboard.init === 'function') {
      console.log("[Auth] Reinitializing project dashboard after login");
      setTimeout(() => {
        window.projectDashboard.init().catch(err => {
          console.error("[Auth] Error reinitializing dashboard:", err);
        });
      }, 100);
    }

    // Immediately load projects
    if (window.projectManager?.loadProjects) {
      console.log("[Auth] Loading projects immediately after successful login");
      setTimeout(() => {
        window.projectManager.loadProjects('all')
          .then(projects => {
            if (window.projectListComponent?.renderProjects) {
              console.log(`[Auth] Rendering ${projects?.length || 0} projects after login`);
              window.projectListComponent.renderProjects(projects);
            }
          })
          .catch(err => console.error("[Auth] Error loading projects after login:", err));
      }, 50);  // Reduced delay for more responsive feeling
    }

    return { ...response, success: true };
  } catch (error) {
    const e = standardizeError(error, 'login_api');
    logFormIssue('LOGIN_FAILURE', { username, error: e.message });
    throw new Error(e.message || 'Login failed');
  } finally {
    clearTimeout(loginTimeout);
    window.__loginInProgress = false;
    window.__loginAbortController = null;
  }
}

async function logout(e) {
  e?.preventDefault();
  try {
    await Promise.race([
      apiRequest('/api/auth/logout', 'POST'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Logout timeout')), 5000))
    ]);
  } catch {
    // Even if logout API fails, proceed to clear state
  }
  clearTokenState();
  notify("Logged out successfully", "success");
  window.location.href = '/index.html';
}

async function handleRegister(formData) {
  const username = formData.get("username");
  const password = formData.get("password");
  if (!username || !password) {
    notify("Please fill out all fields", "error");
    return;
  }
  if (password.length < 12) {
    notify("Password must be at least 12 characters", "error");
    return;
  }
  try {
    await apiRequest('/api/auth/register', 'POST', { username: username.trim(), password });
    const result = await loginUser(username, password);
    notify("Registration successful", "success");
    return result;
  } catch (error) {
    logFormIssue('REGISTER_FAILURE', { username, error: error.message });
    notify(error.message || "Registration failed", "error");
    throw error;
  }
}

/* ----------------------------------
 *  UI Listeners
 * ---------------------------------- */

function switchForm(isLogin) {
  const loginTab = document.getElementById("loginTab");
  const registerTab = document.getElementById("registerTab");
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  if (!loginTab || !registerTab || !loginForm || !registerForm) return;

  // Update login tab styles
  loginTab.classList.toggle("border-blue-500", isLogin);
  loginTab.classList.toggle("text-blue-600", isLogin);
  loginTab.classList.toggle("text-blue-400", isLogin && document.documentElement.classList.contains('dark'));
  loginTab.classList.toggle("text-gray-500", !isLogin);
  loginTab.classList.toggle("text-gray-400", !isLogin && document.documentElement.classList.contains('dark'));

  // Update register tab styles
  registerTab.classList.toggle("border-blue-500", !isLogin);
  registerTab.classList.toggle("text-blue-600", !isLogin);
  registerTab.classList.toggle("text-blue-400", !isLogin && document.documentElement.classList.contains('dark'));
  registerTab.classList.toggle("text-gray-500", isLogin);
  registerTab.classList.toggle("text-gray-400", isLogin && document.documentElement.classList.contains('dark'));

  // Set border-b-2 class on active tab
  loginTab.classList.toggle("border-b-2", isLogin);
  registerTab.classList.toggle("border-b-2", !isLogin);

  // Show/hide the appropriate form
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);

  // On mobile, adjust the modal position after switching tab
  setTimeout(() => {
    if (window.innerWidth < 768) {
      const authDropdown = document.getElementById("authDropdown");
      if (authDropdown && !authDropdown.classList.contains('hidden')) {
        const viewportHeight = window.innerHeight;
        const dropdownRect = authDropdown.getBoundingClientRect();

        // If dropdown would extend beyond viewport, adjust top position
        if (dropdownRect.bottom > viewportHeight) {
          const newTopPosition = Math.max(10, viewportHeight - dropdownRect.height - 10);
          authDropdown.style.top = `${newTopPosition}px`;
        }
      }
    }
  }, 10);
}

function setupUIListeners() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");

  if (authBtn && authDropdown) {
    // Enhanced click event for auth button with positioning
    authBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();

      // Toggle dropdown visibility
      const isHidden = authDropdown.classList.contains('hidden');
      authDropdown.classList.toggle("hidden", !isHidden);

      // Position dropdown correctly on mobile
      if (!isHidden) return; // Only position when showing

      if (window.innerWidth < 768) {
        // Center horizontally on mobile devices
        authDropdown.style.left = '50%';
        authDropdown.style.right = 'auto';
        authDropdown.style.transform = 'translateX(-50%)';

        // Position vertically under the header
        authDropdown.style.top = '60px';

        // If we have an external handleAuthModalPositioning function, use it
        if (typeof window.handleAuthModalPositioning === 'function') {
          window.handleAuthModalPositioning();
        }
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", e => {
      if (!authDropdown.classList.contains('hidden') &&
          !e.target.closest("#authContainer") &&
          !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
      }
    });

    // Adjust touch event to 'touchend' so dropdown isn't immediately closed on mobile
    document.addEventListener("touchend", e => {
      if (!authDropdown.classList.contains('hidden') &&
          !e.target.closest("#authContainer") &&
          !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
      }
    }, { passive: false });
  }

  // Enhanced tab handling with better touch response
  const loginTabEl = document.getElementById("loginTab");
  const registerTabEl = document.getElementById("registerTab");

  if (loginTabEl && registerTabEl) {
    // Login tab event handler
    loginTabEl.addEventListener("click", e => {
      e.preventDefault();
      switchForm(true);
    });

    // Touch event for login tab (for better mobile response)
    loginTabEl.addEventListener("touchend", e => {
      e.preventDefault();
      switchForm(true);
    }, { passive: false });

    // Register tab event handler
    registerTabEl.addEventListener("click", e => {
      e.preventDefault();
      switchForm(false);
    });

    // Touch event for register tab (for better mobile response)
    registerTabEl.addEventListener("touchend", e => {
      e.preventDefault();
      switchForm(false);
    }, { passive: false });
  }

  // Login form handling
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");

  if (loginForm) {
    loginForm.addEventListener("submit", async e => {
      e.preventDefault();

      // Show visual feedback that login is processing
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Logging in...";
      }

      const formData = new FormData(loginForm);
      const username = formData.get("username");
      const password = formData.get("password");

      if (!username || !password) {
        notify("Username and password are required", "error");
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Log In";
        }
        return;
      }

      try {
        await loginUser(username, password);
        document.getElementById("authDropdown")?.classList.add('hidden');
      } catch (err) {
        // Show error and reset button
        notify(err.message || "Login failed", "error");

        // Display error in the login form
        const errorElement = document.getElementById('login-error');
        if (errorElement) {
          errorElement.textContent = err.message || "Login failed";
          errorElement.classList.remove('hidden');
        }
      } finally {
        // Re-enable login button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Log In";
        }
      }
    });
  }
}

/* ----------------------------------
 *  ADDITION #1: Register Form Event Listener
 * ---------------------------------- */
if (document.getElementById("registerForm")) {
  const registerForm = document.getElementById("registerForm");
  registerForm.addEventListener("submit", async e => {
    e.preventDefault();

    // Show visual feedback that registration is processing
    const submitBtn = registerForm.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Registering...";
    }

    const data = new FormData(registerForm);
    try {
      await handleRegister(data);
      // Hide modal after successful registration
      document.getElementById("authDropdown")?.classList.add('hidden');
    } catch (err) {
      // Show inline error message if possible
      const errorMsg = err?.message || "Registration failed";
      notify(errorMsg, "error");
    } finally {
      // Re-enable register button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Register";
      }
    }
  });
}

/* ----------------------------------
 *  ADDITION #2: Logout Button Listener
 * ---------------------------------- */
document.getElementById("logoutBtn")?.addEventListener("click", logout);

/* ----------------------------------
 *  ADDITION #3: Monitoring & Initialization
 * ---------------------------------- */
function setupAuthStateMonitoring() {
  setTimeout(() => {
    verifyAuthState(false).catch(() => { });
  }, 300);

  // Periodic verify every 3x normal interval to reduce server load
  const intervalMs = AUTH_CONSTANTS.VERIFICATION_INTERVAL * 3;
  const authCheck = setInterval(() => {
    if (!sessionExpiredFlag) verifyAuthState(false).catch(() => { });
  }, intervalMs);

  window.addEventListener('focus', () => {
    if (!window.__verifyingOnFocus &&
      (!authState.lastVerified || Date.now() - authState.lastVerified > 300000)) {
      window.__verifyingOnFocus = true;
      setTimeout(() => {
        verifyAuthState(false).finally(() => {
          window.__verifyingOnFocus = false;
        });
      }, 1000);
    }
  });

  // Sync tokens to sessionStorage every 30s
  setInterval(() => syncTokensToSessionStorage('store'), 30000);

  // Before unload, remove references to sessionStorage sync
  window.addEventListener('beforeunload', () => {
    clearInterval(authCheck);
  });
}

async function init() {
  if (window.__authInitializing) {
    return new Promise(res => {
      const checkInit = () => {
        if (window.auth.isInitialized) res(true);
        else setTimeout(checkInit, 50);
      };
      checkInit();
    });
  }
  window.__authInitializing = true;

  if (window.auth.isInitialized) {
    window.__authInitializing = false;
    return true;
  }
  if (window.API_CONFIG) window.API_CONFIG.authCheckInProgress = true;

  try {
    // Ensure CSRF token is set before any auth operations
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (!csrfMeta?.content) {
      console.warn('[Auth] Initializing without CSRF token');
      if (window.getCSRFToken) {
        const token = await window.getCSRFToken();
        if (token && csrfMeta) {
          csrfMeta.content = token;
          console.log('[Auth] Set CSRF token from getCSRFToken()');
        }
      }
    }

    // Attempt to restore from sessionStorage
    const restored = syncTokensToSessionStorage('get');
    if (restored) {
      authState.isAuthenticated = true;
      authState.lastVerified = Date.now();
      broadcastAuth(true, window.__lastUsername);
    }

    setupUIListeners();
    setupAuthStateMonitoring();

    if (!restored) {
      await new Promise(r => setTimeout(r, 600));
      try {
        await verifyAuthState(false);
      } catch (error) {
        console.warn("[Auth] Initial verification failed:", error);
      }
    }

    // Set initialization flags
    window.auth.isInitialized = true;
    window.auth.isReady = true;
    console.log("[Auth] Module initialized");

    // Dispatch authReady event for components waiting on auth
    document.dispatchEvent(new CustomEvent('authReady', {
      detail: {
        authenticated: authState.isAuthenticated,
        username: authState.username
      }
    }));

    return true;
  } catch (error) {
    console.error("[Auth] Initialization failed:", error);
    if (!authState.isAuthenticated) broadcastAuth(false);

    // Even on failure, dispatch the event to unblock waiting components
    document.dispatchEvent(new CustomEvent('authReady', {
      detail: {
        authenticated: false,
        error: error.message
      }
    }));

    return false;
  } finally {
    if (window.API_CONFIG) window.API_CONFIG.authCheckInProgress = false;
    window.__authInitializing = false;
  }
}

function handleAuthError(error, context = '') {
  console.error(`[Auth] Error in ${context}:`, error);
  if (error.status === 401 || error.message?.includes('expired')) {
    clearTokenState();
    broadcastAuth(false);
    showSessionExpiredModal();
  }
  return false;
}

/* ----------------------------------
 *  CSRF Token Utilities
 * ---------------------------------- */
function getCSRFToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (!meta?.content) {
    console.warn('[Auth] CSRF token meta tag missing or empty');
    return '';
  }
  return meta.content;
}

/* ----------------------------------
 *  ADDITION #4: Export / Window Attach
 * ---------------------------------- */
window.auth = window.auth || {};
Object.assign(window.auth, {
  init,
  standardizeError,
  getCSRFToken,
  logout,
  login: loginUser,
  handleRegister,
  getAuthToken,
  refreshTokens,
  verifyAuthState,
  clear: clearTokenState,
  broadcastAuth,
  handleAuthError,
  isInitialized: false,
  isAuthenticated: async (opts = {}) => {
    try {
      // Rely solely on verifyAuthState and lastVerified logic
      return await verifyAuthState(opts.forceVerify || false);
    } catch {
      return false;
    }
  }
});

// Default export for ES modules
export default {
  init,
  login: loginUser,
  logout,
  verifyAuthState,
  refreshTokens,
  getAuthToken,
  clear: clearTokenState,
  standardizeError,
  handleAuthError,
  isAuthenticated: async (opts = {}) => {
    try {
      return await verifyAuthState(opts.forceVerify || false);
    } catch {
      return false;
    }
  }
};
/**
 * Additional handlers for responsive auth dropdowns on mobile devices
 * (Merged from mobile-auth-handler.js)
 */
let isAuthDropdownVisible = false;
let lastTouchTime = 0;

/**
 * Primary function for positioning the auth modal on mobile devices
 * This is called from app.js and can be called directly when needed
 */
function handleAuthModalPositioning() {
  const authDropdown = document.getElementById("authDropdown");
  if (!authDropdown || authDropdown.classList.contains('hidden')) {
    return;
  }

  if (window.innerWidth < 768) {
    authDropdown.style.left = '50%';
    authDropdown.style.right = 'auto';
    authDropdown.style.transform = 'translateX(-50%)';
    const viewportHeight = window.innerHeight;
    const dropdownRect = authDropdown.getBoundingClientRect();
    if (dropdownRect.bottom > viewportHeight) {
      const newTopPosition = Math.max(10, viewportHeight - dropdownRect.height - 10);
      authDropdown.style.top = `${newTopPosition}px`;
    } else {
      authDropdown.style.top = '60px';
    }
  } else {
    authDropdown.style.left = '';
    authDropdown.style.right = '';
    authDropdown.style.transform = '';
    authDropdown.style.top = '';
  }
}

/**
 * Enhance form inputs for better mobile experience
 */
function enhanceMobileInputs() {
  const inputs = document.querySelectorAll('#loginForm input, #registerForm input');
  inputs.forEach(input => {
    // Listen for autofill (which browsers handle differently)
    input.addEventListener('animationstart', (e) => {
      if (e.animationName.includes('autofill')) {
        input.classList.add('autofilled');
      }
    });
    // Add larger touch targets on focus for mobile
    input.addEventListener('focus', () => {
      if (window.innerWidth < 768) {
        input.classList.add('touch-input-focus');
      }
    });
    input.addEventListener('blur', () => {
      input.classList.remove('touch-input-focus');
    });
  });
}

/**
 * Add event listeners for better mobile auth experience
 */
function setupMobileAuthListeners() {
  const authBtn = document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');
  if (authBtn && authDropdown) {
    // Additional click handler to store state
    authBtn.addEventListener('click', () => {
      setTimeout(() => {
        isAuthDropdownVisible = !authDropdown.classList.contains('hidden');
      }, 10);
    });

    // Orientation change handling
    window.addEventListener('orientationchange', () => {
      if (isAuthDropdownVisible) {
        setTimeout(handleAuthModalPositioning, 100);
      }
    });

    // Window resize to reposition dropdown
    window.addEventListener('resize', () => {
      if (isAuthDropdownVisible) {
        handleAuthModalPositioning();
      }
    });
  }

  // Improve login/register tab touch responsiveness
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  if (loginTab && registerTab) {
    const handleTouchWithDebounce = (handler) => {
      return (e) => {
        const now = Date.now();
        if (now - lastTouchTime > 300) {
          lastTouchTime = now;
          handler(e);
        }
        e.preventDefault();
      };
    };
    loginTab.addEventListener('touchend', handleTouchWithDebounce(() => {
      if (typeof window.switchForm === 'function') {
        window.switchForm(true);
      }
    }), { passive: false });
    registerTab.addEventListener('touchend', handleTouchWithDebounce(() => {
      if (typeof window.switchForm === 'function') {
        window.switchForm(false);
      }
    }), { passive: false });
  }
}

// Make functions available globally
window.handleAuthModalPositioning = handleAuthModalPositioning;
window.setupMobileAuthListeners = setupMobileAuthListeners;

/**
 * Initialize these mobile enhancements after DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  enhanceMobileInputs();
  setupMobileAuthListeners();
});
