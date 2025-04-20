/**
 * Final Remediated Authentication Module
 * Addresses frontend state update issues post-login.
 * Fixes CSRF priming recursion error.
 * Fixes missing throttledVerifyAuthState export.
 * Removes faulty client-side checks for HttpOnly cookies.
 */
const AUTH_DEBUG = true;

// Session & Retry Flags
let sessionExpiredFlag = false;
let lastVerifyFailureTime = 0;
let tokenRefreshInProgress = false;
let lastRefreshAttempt = null;
let __refreshCooldownUntil = 0;  // Throttle timestamp
let authCheckInProgress = false; // Global auth check lock
let backendUnavailableFlag = false;
let lastBackendUnavailableTime = 0;

// Config
const MIN_RETRY_INTERVAL = 30000; // 30s
const MAX_REFRESH_RETRIES = 3;
const BACKEND_UNAVAILABLE_COOLDOWN = 30000; // 30s circuit-breaker

// Auth State - Central source of truth for frontend authentication status
const authState = {
  isAuthenticated: false,
  username: null,
  lastVerified: 0,
  tokenVersion: null
};

const AUTH_CONSTANTS = {
  VERIFICATION_INTERVAL: 300000,    // 5 min
  VERIFICATION_CACHE_DURATION: 60000, // 1 min
  REFRESH_TIMEOUT: 10000,           // 10s
  VERIFY_TIMEOUT: 5000,             // 5s
  MAX_VERIFY_ATTEMPTS: 3,
  ACCESS_TOKEN_EXPIRE_MINUTES: 30, // Should match backend
  REFRESH_TOKEN_EXPIRE_DAYS: 1     // Should match backend
};

const AuthBus = new EventTarget();

/* Cookie Helpers */
// getCookie is now only useful for NON-HttpOnly cookies (like tracking flags, prefs)
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[2]) : null;
}

// setAuthCookie is now only useful for setting NON-HttpOnly cookies or CLEARING cookies
function setAuthCookie(name, value, maxAgeSeconds) {
  let sameSite = 'SameSite=None';
  let secure = 'Secure; ';
  if (
    location.protocol !== 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  ) {
    sameSite = 'SameSite=Lax'; // More appropriate default for non-HTTPS dev
    secure = '';
  }
  const path = '/';
  const cookieParts = [
    `${name}=${encodeURIComponent(value || '')}`,
    `Path=${path}`,
    sameSite,
    secure ? secure.trim() : ''
  ].filter(Boolean);

  if (typeof maxAgeSeconds === 'number' && maxAgeSeconds >= 0) {
    cookieParts.push(`Max-Age=${maxAgeSeconds}`);
    if (maxAgeSeconds === 0) {
      cookieParts.push(`Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
    }
  }
  let cookieString = cookieParts.join('; ');
  document.cookie = cookieString;

  if (AUTH_DEBUG) {
    console.debug(`[Auth] setAuthCookie called for: ${name}`, { /* details */ });
  }
}

/* JWT/Token Helpers (Limited use now) */
// These might still be useful if tokens are ever passed outside cookies, but not for HttpOnly checks.
function getTokenPayload(token) {
  if (!token) return null;
  try {
    // Example parse logic if needed:
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = getTokenPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return true;
  }
  const now = Math.floor(Date.now() / 1000);
  return payload.exp <= now;
}

let __cachedExpirySettings = null;
async function fetchTokenExpirySettings() {
  if (__cachedExpirySettings) return __cachedExpirySettings;
  try {
    const requester = window.apiRequest || _authFetchInternal;
    const settings = await requester('/api/auth/settings/token-expiry', 'GET');
    if (
      settings &&
      settings.access_token_expire_minutes &&
      settings.refresh_token_expire_days
    ) {
      __cachedExpirySettings = settings;
      return settings;
    } else {
      throw new Error('Invalid expiry settings received from backend');
    }
  } catch (error) {
    console.warn('[Auth] Failed to fetch token expiry settings from backend, using defaults.', error);
    __cachedExpirySettings = {
      access_token_expire_minutes: AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES,
      refresh_token_expire_days: AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS
    };
    return __cachedExpirySettings;
  }
}

/* *** START: Fix for Recursion Error *** */
async function _authFetchInternal(endpoint, method, body = null) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: method.toUpperCase(),
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (fetchError) {
    console.error(`[Auth][InternalFetch] Fetch error for ${method} ${endpoint}:`, fetchError);
    throw fetchError;
  }
  if (!resp.ok) {
    let errData;
    try {
      errData = await resp.json();
    } catch {
      errData = { message: await resp.text() || `Internal fetch error ${resp.status}` };
    }
    console.error(`[Auth][InternalFetch] API error ${resp.status} for ${method} ${endpoint}:`, errData);
    const error = new Error(errData.message || `HTTP error ${resp.status}`);
    error.status = resp.status;
    error.data = errData;
    throw error;
  }
  if (resp.status === 204) {
    return null;
  }
  try {
    return await resp.json();
  } catch (e) {
    return await resp.text();
  }
}
/* CSRF Token UTILS */
let __csrfToken = '';
let __csrfTokenPromise = null;

async function primeCSRFToken() {
  if (__csrfToken) return __csrfToken;
  if (__csrfTokenPromise) return __csrfTokenPromise;
  if (AUTH_DEBUG) console.debug('[Auth] Priming CSRF token...');

  __csrfTokenPromise = (async () => {
    try {
      const res = await _authFetchInternal('/api/auth/csrf', 'GET');
      if (!res?.token) throw new Error('Invalid CSRF token response');
      if (AUTH_DEBUG) console.debug('[Auth] Received CSRF token:', res.token ? '******' : '<empty>');

      let meta = document.querySelector('meta[name="csrf-token"]');
      if (!meta) {
        if (AUTH_DEBUG) console.debug('[Auth] Creating csrf-token meta tag');
        meta = document.createElement('meta');
        meta.name = 'csrf-token';
        document.head.appendChild(meta);
      }
      meta.content = res.token;
      __csrfToken = res.token;
      __csrfTokenPromise = null;
      return res.token;
    } catch (err) {
      console.error('[Auth] Failed to prime CSRF token:', err);
      __csrfTokenPromise = null;
      throw err;
    }
  })();

  return __csrfTokenPromise;
}
/* *** END: Fix for Recursion Error *** */

async function getCSRFTokenAsync() {
  if (__csrfToken) return __csrfToken;
  return primeCSRFToken();
}

function getCSRFToken() {
  if (!__csrfToken) {
    if (AUTH_DEBUG) console.warn('[Auth] getCSRFToken called but token not primed yet.');
    primeCSRFToken().catch(err => console.error('[Auth] Sync primeCSRFToken failed:', err));
  }
  return __csrfToken;
}

/* HTTP Functions */
async function authRequest(endpoint, method, body = null) {
  if (window.apiRequest) {
    if (endpoint === '/api/auth/csrf') {
      console.warn('[Auth] authRequest called for /api/auth/csrf, using internal fetcher to prevent potential loop.');
      return await _authFetchInternal(endpoint, method, body);
    }
    return await window.apiRequest(endpoint, method, body);
  }

  console.warn('[Auth] Using fallback _authFetchInternal - window.apiRequest not found.');
  return await _authFetchInternal(endpoint, method, body);
}

if (!window.apiRequest) {
  window.apiRequest = authRequest;
}

/* Token Refresh Logic */
async function refreshTokens() {
  const now = Date.now();
  if (now < __refreshCooldownUntil) {
    const remaining = Math.ceil((__refreshCooldownUntil - now) / 1000);
    console.warn(`[Auth] Refresh throttled for ${remaining}s`);
    throw new Error(`Refresh attempts are temporarily throttled (${remaining}s remaining).`);
  }
  if (tokenRefreshInProgress) {
    if (AUTH_DEBUG) console.debug('[Auth] Refresh already in progress, awaiting existing promise.');
    return window.__tokenRefreshPromise;
  }

  if (AUTH_DEBUG) console.debug('[Auth] Attempting token refresh...');
  tokenRefreshInProgress = true;
  lastRefreshAttempt = now;
  window.__tokenRefreshPromise = null;

  try {
    await getCSRFTokenAsync();
  } catch (csrfErr) {
    console.error('[Auth] Cannot refresh tokens: Failed to get CSRF token.', csrfErr);
    tokenRefreshInProgress = false;
    __refreshCooldownUntil = Date.now() + 15000;
    throw new Error('CSRF token acquisition failed, cannot refresh.');
  }

  window.__tokenRefreshPromise = (async () => {
    // *** REMOVED: Client-side getCookie('refresh_token') check ***
    // We rely on the browser sending the HttpOnly cookie automatically.

    let response;
    try {
      if (AUTH_DEBUG) console.debug('[Auth] Calling /api/auth/refresh via authRequest');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.warn('[Auth] Refresh request timed out.');
        controller.abort();
      }, AUTH_CONSTANTS.REFRESH_TIMEOUT);
      response = await authRequest('/api/auth/refresh', 'POST', null);
      clearTimeout(timeoutId);

      if (!response?.access_token) {
        console.error('[Auth] Invalid refresh response received:', response);
        throw new Error('Invalid refresh response from server');
      }

      if (AUTH_DEBUG) console.debug('[Auth] Refresh successful. New access token received.');
      authState.isAuthenticated = true;
      authState.lastVerified = Date.now();
      if (response.token_version) authState.tokenVersion = response.token_version;
      if (response.username) authState.username = response.username;

      broadcastAuth(true, authState.username);
      AuthBus.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: true } }));
      console.log('[Auth] Token refresh successful.');
      return { success: true, token: response.access_token };
    } catch (err) {
      console.error('[Auth] Token refresh failed:', err.status, err.message, err);
      __refreshCooldownUntil = Date.now() + MIN_RETRY_INTERVAL;
      if (err.status === 401) {
        console.warn('[Auth] Refresh token rejected by backend (401), clearing auth state.');
        await clearTokenState({ source: 'refresh_401_error' });
        sessionExpiredFlag = Date.now();
      }
      AuthBus.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: false, error: err } }));
      throw err;
    } finally {
      tokenRefreshInProgress = false;
      window.__tokenRefreshPromise = null;
    }
  })();

  return window.__tokenRefreshPromise;
}

/* Auth Verification & Access Token */
let _clearingInProgress = false;

async function clearTokenState(options = { source: 'unknown' }) {
  if (_clearingInProgress) {
    if (AUTH_DEBUG) console.debug('[Auth] clearTokenState already in progress, skipping.');
    return;
  }
  _clearingInProgress = true;

  if (AUTH_DEBUG) {
    console.groupCollapsed(`[Auth] Clearing token state (Source: ${options.source})`);
    console.trace('Token clear call stack');
    console.log('Current auth state before clear:', { ...authState });
  }

  authState.isAuthenticated = false;
  authState.username = null;
  authState.lastVerified = 0;
  authState.tokenVersion = null;
  sessionExpiredFlag = Date.now();
  tokenRefreshInProgress = false;
  authCheckInProgress = false;

  setAuthCookie('access_token', '', 0);
  setAuthCookie('refresh_token', '', 0);

  if (options.source !== 'logout') {
    getCSRFTokenAsync()
      .then(csrf => {
        if (csrf) {
          authRequest('/api/auth/logout', 'POST').catch(() => { });
        }
      })
      .catch(() => { });
  }

  if (AUTH_DEBUG) {
    console.debug('[Auth] Token state cleared. isAuthenticated:', authState.isAuthenticated);
    console.groupEnd();
  }
  broadcastAuth(false, null);
  _clearingInProgress = false;
}

async function verifyAuthState(forceVerify = false) {
  const callSource = forceVerify ? 'force' : 'auto';
  if (AUTH_DEBUG) {
    console.debug(`[Auth] verifyAuthState called (source: ${callSource}). Current state: isAuthenticated=${authState.isAuthenticated}`);
  }

  if (authCheckInProgress && !forceVerify) {
    if (AUTH_DEBUG) console.debug('[Auth] Auth check already in progress, skipping redundant call.');
    return authState.isAuthenticated;
  }
  if (
    backendUnavailableFlag &&
    Date.now() - lastBackendUnavailableTime < BACKEND_UNAVAILABLE_COOLDOWN
  ) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping verify - backend unavailable (circuit breaker active).');
    AuthBus.dispatchEvent(new CustomEvent('backendUnavailable', { detail: { reason: 'circuit_breaker' } }));
    return authState.isAuthenticated;
  }
  if (!forceVerify && Date.now() - lastVerifyFailureTime < MIN_RETRY_INTERVAL) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping verify - recent failure throttle.');
    return authState.isAuthenticated;
  }

  const now = Date.now();
  const timeSinceLastVerified = now - authState.lastVerified;
  const isCacheValid =
    !forceVerify &&
    authState.isAuthenticated &&
    authState.lastVerified > 0 &&
    timeSinceLastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION;
  if (isCacheValid) {
    if (AUTH_DEBUG) {
      console.debug(
        `[Auth] Returning cached auth state (verified ${Math.round(timeSinceLastVerified / 1000)}s ago).`
      );
    }
    return true;
  }

  if (AUTH_DEBUG) console.debug('[Auth] Proceeding with server verification.');
  authCheckInProgress = true;

  try {
    await getCSRFTokenAsync();
  } catch (csrfErr) {
    console.error('[Auth] Cannot verify auth state: Failed to get CSRF token.', csrfErr);
    authCheckInProgress = false;
    return false;
  }

  // *** REMOVED: Client-side getCookie('access_token') and isTokenExpired check ***
  // Directly attempt backend verification

  try {
    if (AUTH_DEBUG) console.debug('[Auth] Calling /api/auth/verify via authRequest');
    const res = await authRequest('/api/auth/verify', 'GET');

    const serverAuthenticated = !!res?.authenticated;
    const serverUsername = res?.username || null;
    if (AUTH_DEBUG) console.debug('[Auth] Verification API response:', res);

    if (serverAuthenticated) {
      authState.isAuthenticated = true;
      authState.username = serverUsername;
      authState.lastVerified = Date.now();
      authState.tokenVersion = res?.version || authState.tokenVersion;
      lastVerifyFailureTime = 0;
      backendUnavailableFlag = false;
      if (AUTH_DEBUG) console.log(`[Auth] Verification successful. User: ${serverUsername}`);
      broadcastAuth(true, serverUsername);
    } else {
      console.warn('[Auth] Server verification returned unauthenticated.');
      await clearTokenState({ source: 'verify_negative_response' });
    }
    authCheckInProgress = false;
    return authState.isAuthenticated;
  } catch (err) {
    console.warn('[Auth] Verification API call failed:', err.status, err.message, err);
    lastVerifyFailureTime = Date.now();

    if (err.status === 401) {
      if (AUTH_DEBUG) console.debug('[Auth] Verification returned 401, attempting refresh...');
      try {
        await refreshTokens();
        if (AUTH_DEBUG) console.debug('[Auth] Refresh successful following 401 during verify.');
        authCheckInProgress = false;
        return authState.isAuthenticated;
      } catch (refreshErr) {
        if (AUTH_DEBUG) console.error('[Auth] Refresh attempt failed after 401 during verify:', refreshErr);
        await clearTokenState({ source: 'verify_401_refresh_fail' });
        authCheckInProgress = false;
        return false;
      }
    } else if (err.name === 'AbortError' || err.message?.includes('Failed to fetch')) {
      console.error('[Auth] Network error during verification.');
      backendUnavailableFlag = true;
      lastBackendUnavailableTime = Date.now();
      AuthBus.dispatchEvent(
        new CustomEvent('backendUnavailable', {
          detail: { reason: 'verify_network_error', error: err.message }
        })
      );
    } else {
      console.error('[Auth] Unexpected error during verification:', err);
    }
    authCheckInProgress = false;
    return authState.isAuthenticated;
  }
}

// Throttled version
let lastAuthFailTimestamp = 0;
const AUTH_FAIL_THROTTLE_MS = 10000;
async function throttledVerifyAuthState(forceVerify = false) {
  const now = Date.now();
  if (!forceVerify && authState.isAuthenticated === false && now - lastAuthFailTimestamp < AUTH_FAIL_THROTTLE_MS) {
    if (AUTH_DEBUG) console.warn('[Auth] Verification throttled due to recent failure.');
    return false;
  }
  try {
    const authenticated = await verifyAuthState(forceVerify);
    if (!authenticated) {
      lastAuthFailTimestamp = Date.now();
    }
    return authenticated;
  } catch (err) {
    console.error('[Auth] Error in throttledVerifyAuthState call:', err);
    lastAuthFailTimestamp = now;
    return false;
  }
}

/* UI / Auth State Broadcast */
function broadcastAuth(authenticated, username = null) {
  const previousState = authState.isAuthenticated;
  const stateChanged = authenticated !== previousState;

  authState.isAuthenticated = authenticated;
  authState.username = username;

  if (AUTH_DEBUG) {
    console.debug(
      `[Auth] Broadcasting auth state: ${authenticated}, User: ${username}, Changed: ${stateChanged}`
    );
  }

  const detail = {
    authenticated,
    username,
    timestamp: Date.now(),
    source: 'broadcastAuth',
    stateChanged
  };
  AuthBus.dispatchEvent(new CustomEvent('authStateChanged', { detail }));
}

/* Login / Logout / Registration */
async function loginUser(username, password) {
  if (AUTH_DEBUG) console.log(`[Auth] Attempting login for user: ${username}`);
  try {
    await getCSRFTokenAsync();
  } catch (csrfErr) {
    console.error('[Auth] Login failed: Could not get CSRF token.', csrfErr);
    notify('Login failed: Could not prepare security token. Please try again.', 'error');
    throw new Error('CSRF token failure');
  }

  try {
    const response = await authRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password
    });

    console.log('[Auth] Login API call successful:', response);
    authState.isAuthenticated = true;
    authState.username = response.username || username;
    authState.lastVerified = Date.now();
    authState.tokenVersion = response.token_version || null;
    sessionExpiredFlag = false;

    if (AUTH_DEBUG) console.log('[Auth] Frontend authState updated after successful login:', { ...authState });
    broadcastAuth(true, authState.username);
    notify('Login successful!', 'success');
    return response;
  } catch (error) {
    console.error('[Auth] Login failed:', error.status, error.message, error);
    let message = 'Login failed. Please check your username and password.';
    if (error.status === 429) {
      message = 'Too many login attempts. Please wait a few minutes and try again.';
    } else if (error.status === 403) {
      message = 'Account disabled. Please contact support.';
    } else if (error.status >= 500 || error.message?.includes('Failed to fetch')) {
      message = 'Login service unavailable. Please try again later.';
      backendUnavailableFlag = true;
      lastBackendUnavailableTime = Date.now();
    }
    notify(message, 'error');
    await clearTokenState({ source: 'login_error' });
    throw error;
  }
}

async function logout(e) {
  e?.preventDefault();
  if (AUTH_DEBUG) console.log('[Auth] Logout initiated.');
  broadcastAuth(false, null);

  try {
    await getCSRFTokenAsync();
    await authRequest('/api/auth/logout', 'POST');
    if (AUTH_DEBUG) console.debug('[Auth] Backend logout call successful.');
  } catch (err) {
    console.warn('[Auth] Backend logout call failed (proceeding with cleanup):', err);
  } finally {
    await clearTokenState({ source: 'logout' });
    setTimeout(() => {
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?loggedout=true';
      }
    }, 100);
  }
}

async function handleRegister(formData) {
  const username = formData.get('username');
  const password = formData.get('password');
  if (!username || !password) {
    notify('Please fill out all fields', 'error');
    throw new Error('Missing registration fields');
  }

  if (AUTH_DEBUG) console.log(`[Auth] Attempting registration for: ${username}`);
  try {
    await getCSRFTokenAsync();
  } catch (csrfErr) {
    console.error('[Auth] Registration failed: Could not get CSRF token.', csrfErr);
    notify('Registration failed: Could not prepare security token. Please try again.', 'error');
    throw new Error('CSRF token failure');
  }

  try {
    const response = await authRequest('/api/auth/register', 'POST', {
      username: username.trim(),
      password
    });

    console.log('[Auth] Registration API call successful:', response);

    if (response.access_token && response.username) {
      authState.isAuthenticated = true;
      authState.username = response.username;
      authState.lastVerified = Date.now();
      authState.tokenVersion = response.token_version || null;
      sessionExpiredFlag = false;

      if (AUTH_DEBUG) console.log('[Auth] Frontend authState updated after successful registration:', { ...authState });
      broadcastAuth(true, authState.username);
      notify('Registration successful! You are now logged in.', 'success');
      return response;
    } else {
      console.warn('[Auth] Registration succeeded but no tokens/username received.');
      notify('Registration successful, but auto-login failed. Please log in manually.', 'warning');
      return response;
    }
  } catch (error) {
    console.error('[Auth] Registration failed:', error.status, error.message, error);
    let message = 'Registration failed. Please try again.';
    if (error.status === 400 && error.data?.detail?.includes('taken')) {
      message = 'Username already taken.';
    } else if (error.status === 400 && error.data?.detail?.includes('Password')) {
      message = error.data.detail;
    } else if (error.status >= 500 || error.message?.includes('Failed to fetch')) {
      message = 'Registration service unavailable.';
      backendUnavailableFlag = true;
      lastBackendUnavailableTime = Date.now();
    }
    notify(message, 'error');
    throw error;
  }
}

/* Utilities & Error Handling */
function notify(message, type = 'info', duration = 5000) {
  if (window.showNotification) {
    window.showNotification(message, type, duration);
  } else {
    const logType = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'log';
    console[logType](`[Notification][${type.toUpperCase()}] ${message}`);
  }
}

function handleAuthError(error, context = '') {
  console.error(`[Auth] Error in ${context}:`, error.status, error.message, error);
  notify(`Authentication error (${context}): ${error.message || 'Unknown error'}`, 'error');
  if (error.status === 401 || error.message?.includes('expired') || error.message?.includes('Invalid')) {
    console.warn(`[Auth][handleAuthError] Clearing token state due to error in ${context}.`);
    clearTokenState({ source: `error_${context}` });
  }
  return false;
}

/* Initialization & Monitoring */
let __authInitializing = false;
let authReadyPromise = null;
let resolveAuthReady = null;

async function init() {
  if (window.auth?.isReady || __authInitializing) {
    if (AUTH_DEBUG) console.debug('[Auth] Initialization already complete or in progress.');
    return authReadyPromise || Promise.resolve();
  }
  __authInitializing = true;
  if (AUTH_DEBUG) console.log('[Auth] Initializing...');
  authReadyPromise = new Promise(resolve => {
    resolveAuthReady = resolve;
  });

  try {
    await primeCSRFToken();
    if (AUTH_DEBUG) console.debug('[Auth] CSRF token primed.');

    if (AUTH_DEBUG) console.debug('[Auth] Performing initial auth state verification...');
    try {
      await verifyAuthState(false);
      if (AUTH_DEBUG) {
        console.log(`[Auth] Initial verification complete. Authenticated: ${authState.isAuthenticated}`);
      }
    } catch (error) {
      console.warn('[Auth] Initial verification failed (may be expected if not logged in):', error.message);
      if (error.status === 401 || error.message?.includes('expired')) {
        await clearTokenState({ source: 'init_verify_fail' });
      }
    }

    const intervalMs = AUTH_CONSTANTS.VERIFICATION_INTERVAL;
    setInterval(async () => {
      if (authState.isAuthenticated && !sessionExpiredFlag && !document.hidden) {
        if (AUTH_DEBUG) console.debug('[Auth] Performing periodic verification...');
        try {
          await verifyAuthState(false);
        } catch (err) {
          console.warn('[Auth] Periodic verification failed:', err.message);
        }
      } else {
        if (AUTH_DEBUG) {
          console.debug('[Auth] Skipping periodic verification (unauthenticated, expired, or hidden).');
        }
      }
    }, intervalMs);

    window.addEventListener('focus', async () => {
      const timeSinceLastVerified = Date.now() - authState.lastVerified;
      if (authState.isAuthenticated && !authCheckInProgress && timeSinceLastVerified > AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION) {
        if (AUTH_DEBUG) console.debug('[Auth] Window focused, verifying auth state...');
        try {
          await verifyAuthState(false);
        } catch (err) {
          console.warn('[Auth] Verification on focus failed:', err.message);
        }
      }
    });

    window.auth.isInitialized = true;
    window.auth.isReady = true;
    __authInitializing = false;
    if (AUTH_DEBUG) console.log('[Auth] Module initialized successfully.');

    AuthBus.dispatchEvent(
      new CustomEvent('authReady', {
        detail: { authenticated: authState.isAuthenticated, username: authState.username }
      })
    );
    if (resolveAuthReady) resolveAuthReady();
  } catch (error) {
    console.error('[Auth] Initialization failed critically:', error);
    await clearTokenState({ source: 'init_critical_fail' });
    window.auth.isInitialized = true;
    window.auth.isReady = false;
    __authInitializing = false;
    AuthBus.dispatchEvent(
      new CustomEvent('authReady', {
        detail: { authenticated: false, username: null, error: error.message }
      })
    );
    if (resolveAuthReady) resolveAuthReady();
  }
  return authReadyPromise;
}

/* Public API & Exports */
window.auth = window.auth || {};

const authInstance = {
  // State Accessors
  isAuthenticated: () => authState.isAuthenticated,
  getCurrentUser: () => authState.username,
  getAuthToken: () => getCookie('access_token'), // For debugging or non-HttpOnly usage
  // Core Methods
  init,
  login: loginUser,
  logout,
  register: handleRegister,
  verifyAuthState,
  refreshTokens,
  clearTokenState,
  // Async Check
  checkAuth: async (opts = {}) => {
    if (!window.auth.isReady && authReadyPromise) {
      if (AUTH_DEBUG) console.debug('[Auth][checkAuth] Auth not ready, awaiting init promise...');
      await authReadyPromise;
    }
    return throttledVerifyAuthState(opts.forceVerify || false);
  },
  // Utilities & Events
  AuthBus,
  getCSRFTokenAsync,
  getCSRFToken,
  notify,
  handleAuthError,
  // Readiness Flags (read-only)
  isInitialized: false,
  isReady: false,
  // Throttled Verify
  throttledVerifyAuthState
};

Object.assign(window.auth, authInstance);
export default authInstance;

console.log('[auth.js] Auth module loaded and assigned to window.auth');
