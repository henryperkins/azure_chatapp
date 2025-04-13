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
  if (!value) {
    // Clear cookie
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${secure}${sameSite}`;
  } else {
    document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; ${secure}${sameSite}`;
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
function syncTokensToSessionStorage(mode = 'store') {
  try {
    if (mode === 'store') {
      if (window.__directAccessToken) {
        sessionStorage.setItem('_auth_token_backup', window.__directAccessToken);
        sessionStorage.setItem('_auth_refresh_backup', window.__directRefreshToken || '');
        sessionStorage.setItem('_auth_timestamp', String(window.__recentLoginTimestamp || Date.now()));
        sessionStorage.setItem('_auth_username', window.__lastUsername || '');
      }
    } else {
      const token = sessionStorage.getItem('_auth_token_backup');
      const ts = sessionStorage.getItem('_auth_timestamp');
      if (token && ts) {
        window.__directAccessToken = token;
        window.__directRefreshToken = sessionStorage.getItem('_auth_refresh_backup') || null;
        window.__recentLoginTimestamp = parseInt(ts, 10) || Date.now();
        window.__lastUsername = sessionStorage.getItem('_auth_username') || null;
        return true;
      }
    }
  } catch (err) {
    if (AUTH_DEBUG) console.warn('[Auth] SessionStorage sync error:', err);
  }
  return false;
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
    document.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: true } }));

    return { success: true, token: response.access_token };
  })()
    .catch(err => {
      refreshFailCount++;
      tokenRefreshInProgress = false;
      document.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: false, error: err } }));
      throw err;
    });

  return window.__tokenRefreshPromise;
}

/* ----------------------------------
 *  Verification Logic
 * ---------------------------------- */

/** Force or retrieve a valid access token. */
async function getAuthToken(options = {}) {
  const accessToken = getCookie('access_token');
  if (await checkTokenValidity(accessToken)) return accessToken;

  const refreshTokenVal = getCookie('refresh_token');
  if (refreshTokenVal && await checkTokenValidity(refreshTokenVal, { allowRefresh: true })) {
    const { success, token } = await refreshTokens();
    if (success) return getCookie('access_token');
  }

  await verifyAuthState(true);
  if (authState.isAuthenticated) {
    const newTok = getCookie('access_token');
    if (newTok) return newTok;
  }
  throw new Error('Not authenticated');
}

/**
 * Master function to verify the user's auth state with the server.
 * If tokens are present but invalid, tries refresh. 
 * If forced, calls `/api/auth/verify` up to MAX_VERIFY_ATTEMPTS.
 */
async function verifyAuthState(bypassCache = false) {
  if (Date.now() - lastVerifyFailureTime < MIN_RETRY_INTERVAL) {
    if (AUTH_DEBUG) console.debug('[Auth] Skipping verify - recent fail');
    return authState.isAuthenticated;
  }
  if (sessionExpiredFlag && Date.now() - sessionExpiredFlag < 10000) return false;
  if (sessionExpiredFlag && Date.now() - sessionExpiredFlag >= 10000) sessionExpiredFlag = false;

  if (!bypassCache && authState.lastVerified && 
      (Date.now() - authState.lastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION)) {
    return authState.isAuthenticated;
  }

  let accessToken = getCookie('access_token');
  let refreshTokenVal = getCookie('refresh_token');

  // If no cookies but direct tokens are in memory, set them as cookies
  if (!accessToken && window.__directAccessToken) {
    setAuthCookie('access_token', window.__directAccessToken, 60 * 25);
    if (window.__directRefreshToken) {
      setAuthCookie('refresh_token', window.__directRefreshToken, 60 * 60 * 24 * AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRE_DAYS);
    }
    accessToken = window.__directAccessToken;
    refreshTokenVal = window.__directRefreshToken;
  }

  if (!accessToken && !refreshTokenVal) {
    broadcastAuth(false);
    return false;
  }
  if ((!accessToken || (await isTokenExpired(accessToken))) && refreshTokenVal) {
    try {
      const r = await refreshTokens();
      if (!r.success) throw new Error('Refresh token flow failed');
      authState.isAuthenticated = true;
      authState.lastVerified = Date.now();
      broadcastAuth(true);
      return true;
    } catch {
      clearTokenState();
      broadcastAuth(false);
      return false;
    }
  }

  const attempts = AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS;
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await Promise.race([
        apiRequest('/api/auth/verify', 'GET'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`verify timeout (attempt ${i})`)), AUTH_CONSTANTS.VERIFY_TIMEOUT + i * 1000)
        )
      ]);
      authState.isAuthenticated = !!res.authenticated;
      authState.username = res.username || null;
      authState.lastVerified = Date.now();
      lastVerifyFailureTime = 0;
      broadcastAuth(!!res.authenticated, authState.username);
      return !!res.authenticated;
    } catch (err) {
      lastError = err;
      if (err.status === 401) {
        sessionExpiredFlag = Date.now();
        clearTokenState();
        throw new Error('Session expired');
      }
      if (i < attempts) {
        const backoffMs = Math.min(1000 * (2 ** (i - 1)), 5000);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }
  authState.isAuthenticated = false;
  authState.lastVerified = Date.now();
  broadcastAuth(false);
  lastVerifyFailureTime = Date.now();
  throw lastError || new Error('Auth verification failed');
}

/* ----------------------------------
 *  UI Handling & State Broadcasting
 * ---------------------------------- */

function broadcastAuth(authenticated, username = null) {
  const changed = (authState.isAuthenticated !== authenticated) || 
                  (authState.username !== username);
  authState.isAuthenticated = authenticated;
  authState.username = username;
  if (!changed) return;
  document.dispatchEvent(new CustomEvent("authStateChanged", { detail: { authenticated, username }}));
  window.dispatchEvent(new CustomEvent("authStateChanged", { detail: { authenticated, username }}));
  updateAuthUI(authenticated, username);
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
    broadcastAuth(true, authState.username);

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

  loginTab.classList.toggle("border-blue-500", isLogin);
  loginTab.classList.toggle("text-blue-600", isLogin);
  loginTab.classList.toggle("text-gray-500", !isLogin);

  registerTab.classList.toggle("border-blue-500", !isLogin);
  registerTab.classList.toggle("text-blue-600", !isLogin);
  registerTab.classList.toggle("text-gray-500", isLogin);

  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
}

function setupUIListeners() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");
  if (authBtn && authDropdown) {
    authBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      authDropdown.classList.toggle("hidden");
    });
    document.addEventListener("click", e => {
      if (!e.target.closest("#authContainer") && !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
      }
    });
  }

  const loginTabEl = document.getElementById("loginTab");
  const registerTabEl = document.getElementById("registerTab");
  if (loginTabEl && registerTabEl) {
    loginTabEl.addEventListener("click", e => {
      e.preventDefault();
      switchForm(true);
    });
    registerTabEl.addEventListener("click", e => {
      e.preventDefault();
      switchForm(false);
    });
  }

  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async e => {
      e.preventDefault();
      const formData = new FormData(loginForm);
      const username = formData.get("username");
      const password = formData.get("password");
      if (!username || !password) {
        notify("Username and password are required", "error");
        return;
      }
      try {
        await loginUser(username, password);
        document.getElementById("authDropdown")?.classList.add('hidden');
      } catch (err) {
        notify(err.message || "Login failed", "error");
      }
    });
  }
  if (registerForm) {
    registerForm.addEventListener("submit", async e => {
      e.preventDefault();
      const data = new FormData(registerForm);
      try {
        await handleRegister(data);
      } catch {}
    });
  }

  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

/* ----------------------------------
 *  Initialization & Monitoring
 * ---------------------------------- */

function setupAuthStateMonitoring() {
  setTimeout(() => {
    verifyAuthState(false).catch(() => {});
  }, 300);

  // Periodic verify every 3x normal interval to reduce server load
  const intervalMs = AUTH_CONSTANTS.VERIFICATION_INTERVAL * 3;
  const authCheck = setInterval(() => {
    if (!sessionExpiredFlag) verifyAuthState(false).catch(() => {});
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

  // Before unload, store tokens
  window.addEventListener('beforeunload', () => {
    syncTokensToSessionStorage('store');
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
 *  Export / Window Attach
 * ---------------------------------- */
window.auth = window.auth || {};
Object.assign(window.auth, {
  init,
  standardizeError,
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
