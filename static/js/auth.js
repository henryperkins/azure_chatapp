/**
 * Final Remediated Authentication Module
 * ... (header comment unchanged)
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

// Auth State
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
  ACCESS_TOKEN_EXPIRE_MINUTES: 30,
  REFRESH_TOKEN_EXPIRE_DAYS: 1
};

const AuthBus = new EventTarget();

/* Cookie Helpers */
function getCookie(name) {
  const c = `; ${document.cookie}`.split(`; ${name}=`);
  if (c.length === 2) return c.pop().split(';').shift();
  return null;
}

function setAuthCookie(name, value, maxAgeSeconds) {
  let sameSite = 'SameSite=None';
  let secure = 'Secure; ';
  if (
    location.protocol !== 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  ) {
    sameSite = 'SameSite=Lax';
    secure = '';
  }
  const path = '/';
  const cookieParts = [
    `${name}=${value || ''}`,
    `Path=${path}`,
    sameSite,
    secure
  ];

  if (typeof maxAgeSeconds === 'number' && maxAgeSeconds > 0) {
    cookieParts.push(`Max-Age=${maxAgeSeconds}`);
  }

  let cookieString = cookieParts.join('; ');
  document.cookie = cookieString;

  if (AUTH_DEBUG) {
    console.debug(`[Auth] Setting cookie: ${name}`, {
      value: value ? '*****' : '<empty>',
      sameSite,
      secure: secure.includes('Secure'),
      maxAgeSeconds,
      path
    });
  }

  if (!value) {
    document.cookie = `${name}=; Path=${path}; Max-Age=0; ${sameSite}; ${secure}`;
    if (AUTH_DEBUG) console.debug(`[Auth] Clearing cookie: ${name}`);
  }
}

/* JWT/Token Helpers */
function getTokenExpiry(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

let __cachedExpirySettings = null;
async function fetchTokenExpirySettings() {
  if (__cachedExpirySettings) return __cachedExpirySettings;
  __cachedExpirySettings = {
    access_token_expire_minutes: 30,
    refresh_token_expire_days: 7
  };
  return __cachedExpirySettings;
}

async function checkTokenValidity(token, options = {}) {
  const { allowRefresh = false } = options;
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Date.now() / 1000;

    if (payload.exp && payload.exp < now) return false;

    const settings = await fetchTokenExpirySettings();
    const maxAge = allowRefresh ? (settings.refresh_token_expire_days * 86400) : (settings.access_token_expire_minutes * 60);

    if (!payload.iat) return false;
    if ((now - payload.iat) > maxAge) return false;

    return true;
  } catch {
    return false;
  }
}

/* CSRF Token UTILS */
let __csrfToken = '';
let __csrfTokenPromise = null;

async function primeCSRFToken() {
  if (__csrfToken) return __csrfToken;
  if (__csrfTokenPromise) return __csrfTokenPromise;

  __csrfTokenPromise = (async () => {
    try {
      const res = await authRequest('/api/auth/csrf', 'GET');
      if (!res?.token) throw new Error('Invalid CSRF token response');

      let meta = document.querySelector('meta[name="csrf-token"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'csrf-token';
        document.head.appendChild(meta);
      }
      meta.content = res.token;
      __csrfToken = res.token;
      return res.token;
    } catch (err) {
      __csrfTokenPromise = null;
      throw err;
    }
  })();

  return __csrfTokenPromise;
}

async function getCSRFTokenAsync() {
  if (__csrfToken) return __csrfToken;
  return primeCSRFToken();
}

function getCSRFToken() {
  return __csrfToken;
}

/* HTTP Functions */
async function authRequest(endpoint, method, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (__csrfToken) headers['X-CSRF-Token'] = __csrfToken;

  let resp;
  try {
    resp = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (fetchError) {
    throw fetchError;
  }
  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({ message: 'Unknown error' }));
    throw {
      status: resp.status,
      message: errData.message || 'Authentication failed'
    };
  }
  return resp.json();
}

async function apiRequest(url, method, data = null, options = {}) {
  if (window.apiRequest) {
    return window.apiRequest(url, method, data, options);
  }
  return authRequest(url, method, data);
}

/* Token Refresh Logic */
async function refreshTokens() {
  if (Date.now() < __refreshCooldownUntil) {
    throw new Error('Refresh attempts are temporarily throttled.');
  }

  if (tokenRefreshInProgress) {
    if (AUTH_DEBUG) console.debug('[Auth] Refresh already in progress, awaiting promise.');
    return window.__tokenRefreshPromise;
  }

  await getCSRFTokenAsync().catch(err => {
    if (AUTH_DEBUG) console.error('[Auth] Could not fetch CSRF token before refresh:', err);
    throw new Error('No CSRF token available for refresh');
  });

  tokenRefreshInProgress = true;
  lastRefreshAttempt = Date.now();

  window.__tokenRefreshPromise = (async () => {
    const refreshTokenVal = getCookie('refresh_token');
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
        if (AUTH_DEBUG) {
          console.debug(`[Auth] Refresh attempt ${attempt}/${MAX_REFRESH_RETRIES}`);
        }

        const controller = new AbortController();
        const timeoutMs = AUTH_CONSTANTS.REFRESH_TIMEOUT * Math.pow(2, attempt - 1);

        const fetchPromise = apiRequest(
          '/api/auth/refresh',
          'POST',
          null,
          { signal: controller.signal }
        );
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        response = await fetchPromise.catch(err => {
          if (err.name === 'AbortError')
            throw new Error(`Refresh timeout (${timeoutMs}ms)`);
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

    if (lastError && !response?.access_token) {
      throw lastError;
    }

    authState.lastVerified = Date.now();
    if (response.access_token) {
      setAuthCookie('access_token', response.access_token, 60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES);
    }
    if (response.refresh_token) {
      setAuthCookie('refresh_token', response.refresh_token, 60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS);
    }

    tokenRefreshInProgress = false;
    authState.isAuthenticated = true;
    broadcastAuth(true, authState.username);
    AuthBus.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: true } }));
    return { success: true, token: response.access_token };
  })().catch(err => {
    if (AUTH_DEBUG) console.error('[Auth] Unrecoverable refresh error:', err);
    clearTokenState();
    tokenRefreshInProgress = false;
    __refreshCooldownUntil = Date.now() + 30000;
    AuthBus.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: false, error: err } }));
    throw err;
  });

  return window.__tokenRefreshPromise;
}

/* Auth Verification & Access Token */
let __isInitializing = false;
async function clearTokenState(options = {}) {
  if (__isInitializing && !options.force) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping state clear during initialization');
    return;
  }

  if (AUTH_DEBUG) {
    console.groupCollapsed('[Auth] Clearing token state');
    console.trace('Token clear call stack');
    console.log('Clear options:', options);
    console.log('Current auth state:', {...authState});
  }

  authState.isAuthenticated = false;
  authState.username = null;
  authState.lastVerified = 0;
  sessionExpiredFlag = Date.now();

  if (AUTH_DEBUG) console.debug('[Auth] Clearing access_token cookie');
  setAuthCookie('access_token', '', 0);

  if (AUTH_DEBUG) console.debug('[Auth] Clearing refresh_token cookie');
  setAuthCookie('refresh_token', '', 0);

  if (AUTH_DEBUG) {
    console.debug('[Auth] Token state cleared');
    console.groupEnd();
  }
}

async function verifyAuthState(forceVerify = false) {
  // Client-side expiration guard
  const accessToken = getCookie('access_token');
  if (!accessToken || isTokenExpired(accessToken)) {
    clearTokenState();
    return false;
  }

  // Prevent concurrent verifications
  if (authCheckInProgress && !forceVerify) {
    console.debug('[Auth] Auth check already in progress, waiting...');
    while (authCheckInProgress) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return authState.isAuthenticated;
  }

  authCheckInProgress = true;

  // Circuit breaker
  if (
    backendUnavailableFlag &&
    Date.now() - lastBackendUnavailableTime < BACKEND_UNAVAILABLE_COOLDOWN
  ) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping verify - backend unavailable.');
    AuthBus.dispatchEvent(new CustomEvent('backendUnavailable', {
      detail: {
        until: new Date(lastBackendUnavailableTime + BACKEND_UNAVAILABLE_COOLDOWN),
        reason: 'circuit_breaker'
      }
    }));
    authCheckInProgress = false;
    return authState.isAuthenticated;
  }

  if (Date.now() - lastVerifyFailureTime < MIN_RETRY_INTERVAL) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping verify - recent failure.');
    authCheckInProgress = false;
    return authState.isAuthenticated;
  }

  if (sessionExpiredFlag && (Date.now() - sessionExpiredFlag < 10000)) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping verify - session recently expired.');
    authCheckInProgress = false;
    return false;
  }
  if (sessionExpiredFlag && (Date.now() - sessionExpiredFlag >= 10000)) {
    sessionExpiredFlag = false;
  }

  const now = Date.now();
  const timeSinceLastVerified = now - authState.lastVerified;
  const shouldVerify = forceVerify ||
    (timeSinceLastVerified > AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION) ||
    !authState.lastVerified;

  if (!shouldVerify) {
    if (AUTH_DEBUG) console.debug('[Auth] Returning cached auth state.');
    authCheckInProgress = false;
    return authState.isAuthenticated;
  }

  if (AUTH_DEBUG) console.debug('[Auth] Performing server verification.');

  let lastError;
  for (let i = 1; i <= AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS; i++) {
    try {
      await getCSRFTokenAsync();
      const res = await Promise.race([
        apiRequest('/api/auth/verify', 'GET'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`verify timeout (attempt ${i})`)), AUTH_CONSTANTS.VERIFY_TIMEOUT + i * 1000)
        )
      ]);

      const serverAuthenticated = !!res.authenticated;
      const serverUsername = res.username || null;
      authState.isAuthenticated = serverAuthenticated;
      authState.username = serverUsername;
      authState.lastVerified = Date.now();
      lastVerifyFailureTime = 0;

      broadcastAuth(serverAuthenticated, serverUsername);
      authCheckInProgress = false;
      return serverAuthenticated;
    } catch (err) {
      if (err.code === 'E401_THROTTLED') {
        if (AUTH_DEBUG) console.warn('[Auth] 401 throttled by app.js, returning false immediately.');
        authCheckInProgress = false;
        return false;
      }
      lastError = err;
      if (AUTH_DEBUG) {
        console.warn(`[Auth] Verification attempt ${i} failed:`, err);
      }

      if (err.status === 401 || (err.message && err.message.includes('expired'))) {
        if (AUTH_DEBUG) console.debug('[Auth] Access token invalid, attempting refresh...');
        try {
          const refreshResult = await refreshTokens();
          if (refreshResult?.success) {
            if (AUTH_DEBUG) console.debug('[Auth] Token refresh successful, retrying verification...');
            await new Promise(r => setTimeout(r, 100));
            continue;
          } else {
            if (AUTH_DEBUG) console.warn('[Auth] Token refresh failed during verification.');
            sessionExpiredFlag = Date.now();
            clearTokenState();
            authCheckInProgress = false;
            return false;
          }
        } catch (refreshErr) {
          if (AUTH_DEBUG) console.error('[Auth] Token refresh attempt failed:', refreshErr);
          sessionExpiredFlag = Date.now();
          clearTokenState();
          authCheckInProgress = false;
          return false;
        }
      }

      const isNetworkError = [
        'ERR_CONNECTION_RESET',
        'Failed to fetch',
        'NetworkError',
        'Network request failed',
        'timeout'
      ].some(netStr => err.message?.includes(netStr)) || (err.name === 'AbortError');

      if (isNetworkError && i >= AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS) {
        backendUnavailableFlag = true;
        lastBackendUnavailableTime = Date.now();
        console.error('[Auth] Backend service appears to be unavailable. Circuit breaker activated.');

        AuthBus.dispatchEvent(new CustomEvent('backendUnavailable', {
          detail: {
            until: new Date(lastBackendUnavailableTime + BACKEND_UNAVAILABLE_COOLDOWN),
            reason: 'connection_failed',
            error: err.message
          }
        }));
        lastVerifyFailureTime = Date.now();
      }

      if (i < AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS) {
        const backoffMs = Math.min(1000 * (2 ** (i - 1)), 5000);
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
        if (AUTH_DEBUG) console.error('[Auth] Max verification attempts reached.');
        authState.lastVerified = Date.now();
        // Only set lastVerifyFailureTime for network/backend errors, not for 401/session expired
        if (!err.status || (err.status !== 401 && !err.message?.includes('expired'))) {
          lastVerifyFailureTime = Date.now();
        }
        authCheckInProgress = false;
        throw lastError || new Error('Auth verification failed after multiple attempts');
      }
    }
  }
  authCheckInProgress = false;
  return authState.isAuthenticated;
}

let lastAuthFailTimestamp = 0;
const AUTH_FAIL_THROTTLE_MS = 10000;
async function throttledVerifyAuthState(forceVerify = false) {
  const now = Date.now();
  if (!forceVerify && now - lastAuthFailTimestamp < AUTH_FAIL_THROTTLE_MS) {
    if (AUTH_DEBUG) console.warn('[Auth] Verification throttled due to recent failure.');
    return false;
  }
  try {
    const authenticated = await verifyAuthState(forceVerify);
    if (!authenticated) lastAuthFailTimestamp = now;
    return authenticated;
  } catch (err) {
    lastAuthFailTimestamp = now;
    return false;
  }
}

/* UI / Auth State Broadcast */
function broadcastAuth(authenticated, username = null) {
  const detail = {
    authenticated,
    username,
    timestamp: Date.now(),
    source: 'authStateChanged'
  };
  authState.isAuthenticated = authenticated;
  authState.username = username;
  AuthBus.dispatchEvent(new CustomEvent('authStateChanged', { detail }));
}

/* Login / Logout / Registration */
async function loginUser(username, password) {
  if (window.__loginInProgress && window.__loginAbortController) {
    window.__loginAbortController.abort();
  }
  window.__loginInProgress = true;
  window.__loginAbortController = new AbortController();

  const loginTimeout = setTimeout(() => {
    if (window.__loginAbortController) {
      window.__loginAbortController.abort();
    }
    throw new Error('Login timed out');
  }, 15000);

  try {
    await getCSRFTokenAsync();
    const response = await apiRequest('/api/auth/login', 'POST', {
      username: username.trim(),
      password
    });

    if (!response.access_token) throw new Error('No access token received');
    setAuthCookie('access_token', response.access_token, 60 * AUTH_CONSTANTS.ACCESS_TOKEN_EXPIRE_MINUTES);

    if (response.refresh_token) {
      setAuthCookie('refresh_token', response.refresh_token, 60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS);
    }

    authState.isAuthenticated = true;
    authState.username = response.username || username;
    authState.lastVerified = Date.now();
    sessionExpiredFlag = false;

    broadcastAuth(true, authState.username);

    AuthBus.dispatchEvent(new CustomEvent('authStateConfirmed', {
      detail: { isAuthenticated: true, username: authState.username }
    }));

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
  broadcastAuth(false);
  try {
    await Promise.race([
      apiRequest('/api/auth/logout', 'POST'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Logout timeout')), 5000))
    ]);
  } catch (err) {
    if (AUTH_DEBUG) console.warn('[Auth] Logout request failed:', err);
  } finally {
    clearTokenState();
    setAuthCookie('access_token', '', 0);
    setAuthCookie('refresh_token', '', 0);
    window.location.href = '/login';
  }
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

/* Utilities & Error Handling */
function logFormIssue(type, details) {
  if (AUTH_DEBUG) {
    console.warn(`[Auth][Issue] ${type}`, details);
  }
  if (window.telemetry?.logSecurityEvent && type.includes('SECURITY')) {
    window.telemetry.logSecurityEvent(type, details);
  }
}

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

function notify(message, type = "info") {
  if (window.showNotification) {
    window.showNotification(message, type);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

function showSessionExpiredModal() {
  notify("Your session has expired. Please log in again.", "error");
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


/* Initialization & Monitoring */
let __authInitializing = false;

async function init() {
  if (__authInitializing) return;
  __authInitializing = true;

  try {
    await primeCSRFToken();

    if (getCookie('access_token')) {
      try {
        await verifyAuthState(false);
      } catch (error) {
        console.warn("[Auth] Initial verification failed:", error);
      }
    }

    const intervalMs = AUTH_CONSTANTS.VERIFICATION_INTERVAL * 3;
    const authCheckInterval = setInterval(() => {
      if (!sessionExpiredFlag) {
        verifyAuthState(false).catch(() => { });
      }
    }, intervalMs);

    window.addEventListener('focus', () => {
      if (
        !window.__verifyingOnFocus &&
        (!authState.lastVerified || (Date.now() - authState.lastVerified > 300000))
      ) {
        window.__verifyingOnFocus = true;
        setTimeout(() => {
          verifyAuthState(false).finally(() => {
            window.__verifyingOnFocus = false;
          });
        }, 1000);
      }
    });

    window.addEventListener('beforeunload', () => clearInterval(authCheckInterval));
    console.log("[Auth] Module initialized");
    window.auth.isInitialized = true;
    window.auth.isReady = true;

    AuthBus.dispatchEvent(new CustomEvent('authReady', {
      detail: { authenticated: authState.isAuthenticated, username: authState.username }
    }));
  } catch (error) {
    console.error("[Auth] Initialization failed:", error);
    clearTokenState();
  } finally {
    __authInitializing = false;
  }
}

/* Public API & Exports */
window.auth = window.auth || {};
Object.assign(window.auth, {
  getAuthToken: () => getCookie('access_token') || '',
  init,
  login: loginUser,
  logout,
  verifyAuthState,
  refreshTokens,
  clear: clearTokenState,
  isInitialized: false,
  isReady: false,
  getCurrentUser: () => authState.isAuthenticated ? authState.username : null,
  isAuthenticated: async (opts = {}) => {
    try {
      if (tokenRefreshInProgress && window.__tokenRefreshPromise) {
        await window.__tokenRefreshPromise;
      }
      return await verifyAuthState(opts.forceVerify || false);
    } catch {
      return false;
    }
  },
  AuthBus,
  logFormIssue,
  standardizeError,
  handleAuthError,
  getCSRFTokenAsync,
  getCSRFToken,
  throttledVerifyAuthState
});

export default {
  init,
  login: loginUser,
  logout,
  verifyAuthState,
  refreshTokens,
  clear: clearTokenState,
  logFormIssue,
  standardizeError,
  handleAuthError,
  isInitialized: () => window.auth.isInitialized,
  isReady: () => window.auth.isReady,
  isAuthenticated: async (opts = {}) => {
    try {
      return await verifyAuthState(opts.forceVerify || false);
    } catch {
      return false;
    }
  },
  AuthBus,
  getCSRFTokenAsync,
  getCSRFToken,
  throttledVerifyAuthState
};

// Utility: isTokenExpired
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Math.floor(Date.now() / 1000);
    return payload.exp && payload.exp < now;
  } catch (e) {
    return true;
  }
}
