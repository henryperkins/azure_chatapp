/**
 * Authentication module for handling user sessions, tokens, and auth state
 */
const AUTH_DEBUG = false;

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
  VERIFICATION_INTERVAL: 300000, // 5 min
  VERIFICATION_CACHE_DURATION: 60000, // 1 min
  REFRESH_TIMEOUT: 10000, // 10s
  VERIFY_TIMEOUT: 5000, // 5s
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

/** Basic fallback for token expiry settings. */
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

/** Clears in-memory auth state & marks session as expired. */
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
}

/** Single function that either sets or gets tokens from sessionStorage. */
function syncTokensToSessionStorage(action = 'get') {
  if (action === 'store') {
    const accessToken = getCookie('access_token');
    const refreshToken = getCookie('refresh_token');
    if (accessToken) sessionStorage.setItem('access_token', accessToken);
    else sessionStorage.removeItem('access_token');
    if (refreshToken) sessionStorage.setItem('refresh_token', refreshToken);
    else sessionStorage.removeItem('refresh_token');
    if (authState.username) sessionStorage.setItem('username', authState.username);
    return true;
  } else {
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
    if (username) window.__lastUsername = username;
    return restored;
  }
}

/* ----------------------------------
 *  Core HTTP Functions
 * ---------------------------------- */

async function authRequest(endpoint, method, body = null) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
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
    authState.isAuthenticated = true;
    broadcastAuth(true, authState.username);
    document.dispatchEvent(new CustomEvent('tokenRefreshed', { detail: { success: true } }));
    return { success: true, token: response.access_token };
  })().catch(err => {
    if (AUTH_DEBUG) console.error(`[Auth] Unrecoverable refresh error: ${err.message}. Clearing token state.`);
    clearTokenState();
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

async function getAuthToken(options = {}) {
  const allowEmpty = options.allowEmpty === true;
  const operationId = `getAuthToken-${Date.now().toString(36)}`;
  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] getAuthToken called`, options);
  const accessToken = getCookie('access_token');
  if (accessToken) {
    const isValid = await checkTokenValidity(accessToken).catch(() => false);
    if (isValid) {
      if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Valid access token found in cookie.`);
      return accessToken;
    }
  }
  const refreshToken = getCookie('refresh_token');
  if (!refreshToken) {
    if (allowEmpty) return '';
    throw new Error('Authentication required (no refresh token)');
  }
  const isRefreshValid = await checkTokenValidity(refreshToken, { allowRefresh: true }).catch(() => false);
  if (!isRefreshValid) {
    clearTokenState();
    if (allowEmpty) return '';
    throw new Error('Session expired (invalid refresh token)');
  }
  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Attempting token refresh.`);
  try {
    if (tokenRefreshInProgress && window.__tokenRefreshPromise) {
      if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Waiting for existing refresh promise.`);
      await window.__tokenRefreshPromise;
    } else {
      await refreshTokens();
    }
    const newAccessToken = getCookie('access_token');
    if (newAccessToken && await checkTokenValidity(newAccessToken).catch(() => false)) {
      if (!authState.isAuthenticated) broadcastAuth(true, authState.username);
      return newAccessToken;
    } else {
      if (allowEmpty) return '';
      throw new Error('Token refresh failed to provide a valid token.');
    }
  } catch (refreshError) {
    if (AUTH_DEBUG) console.error(`[Auth][${operationId}] Token refresh failed:`, refreshError);
    if (allowEmpty) return '';
    const errorMessage = refreshError.message.includes('expired') ? 'Session expired' : 'Authentication failed during refresh';
    throw new Error(errorMessage);
  }
}

async function verifyAuthState(forceVerify = false) {
  const operationId = `verifyAuthState-${Date.now().toString(36)}`;
  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] verifyAuthState called (forceVerify=${forceVerify})`);
  if (Date.now() - lastVerifyFailureTime < MIN_RETRY_INTERVAL) {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Skipping verify - recent failure.`);
    return authState.isAuthenticated;
  }
  if (sessionExpiredFlag && Date.now() - sessionExpiredFlag < 10000) {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Skipping verify - session recently marked expired.`);
    return false;
  }
  if (sessionExpiredFlag && Date.now() - sessionExpiredFlag >= 10000) {
    sessionExpiredFlag = false;
  }
  const now = Date.now();
  if (!forceVerify && authState.lastVerified && (now - authState.lastVerified < AUTH_CONSTANTS.VERIFICATION_CACHE_DURATION)) {
    if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Returning cached auth state`);
    return authState.isAuthenticated;
  }
  if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Performing server verification.`);
  const attempts = AUTH_CONSTANTS.MAX_VERIFY_ATTEMPTS;
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const csrfToken = getCSRFToken();
      if (!csrfToken) {
        if (i === attempts) throw new Error('CSRF token missing for verification');
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      const res = await Promise.race([
        apiRequest('/api/auth/verify', 'GET', null, { headers: { 'X-CSRF-Token': csrfToken } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`verify timeout (attempt ${i})`)), AUTH_CONSTANTS.VERIFY_TIMEOUT + i * 1000))
      ]);
      const serverAuthenticated = !!res.authenticated;
      const serverUsername = res.username || null;
      if (AUTH_DEBUG) console.debug(`[Auth][${operationId}] Verification successful: authenticated=${serverAuthenticated}`);
      authState.isAuthenticated = serverAuthenticated;
      authState.username = serverUsername;
      authState.lastVerified = Date.now();
      lastVerifyFailureTime = 0;
      broadcastAuth(serverAuthenticated, serverUsername);
      return serverAuthenticated;
    } catch (err) {
      lastError = err;
      if (AUTH_DEBUG) console.warn(`[Auth][${operationId}] Verification attempt ${i} failed:`, err);
      if (err.status === 401 || err.message?.includes('expired')) {
        const refreshToken = getCookie('refresh_token');
        if (!refreshToken) {
          sessionExpiredFlag = Date.now();
          clearTokenState();
          return false;
        }
        const isRefreshValid = await checkTokenValidity(refreshToken, { allowRefresh: true }).catch(() => false);
        if (!isRefreshValid) {
          sessionExpiredFlag = Date.now();
          clearTokenState();
          return false;
        }
        const refreshResult = await Promise.race([
          refreshTokens(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timeout')), 2000))
        ]).catch(refreshErr => {
          if (AUTH_DEBUG) console.error(`[Auth][${operationId}] Token refresh failed:`, refreshErr);
          return null;
        });
        if (refreshResult?.success) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        sessionExpiredFlag = Date.now();
        clearTokenState();
        return false;
      }
      if (i < attempts) {
        const backoffMs = Math.min(1000 * (2 ** (i - 1)), 5000);
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
        if (AUTH_DEBUG) console.error(`[Auth][${operationId}] Max verification attempts reached.`);
        authState.lastVerified = Date.now();
        lastVerifyFailureTime = Date.now();
        throw lastError || new Error('Auth verification failed after multiple attempts');
      }
    }
  }
  return authState.isAuthenticated;
}

/* ----------------------------------
 *  UI Handling & State Broadcasting
 * ---------------------------------- */

function broadcastAuth(authenticated, username = null) {
  const changed = (authState.isAuthenticated !== authenticated) || (authState.username !== username);
  authState.isAuthenticated = authenticated;
  authState.username = username;
  updateAuthUI(authenticated, username);
  const detail = { authenticated, username, timestamp: Date.now(), source: 'authStateChanged' };
  document.dispatchEvent(new CustomEvent("authStateChanged", { detail }));
  window.dispatchEvent(new CustomEvent("authStateChanged", { detail }));
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
  const loginMsg = document.getElementById('loginRequiredMessage');
  if (loginMsg) loginMsg.classList.toggle('hidden', authenticated);
  const projectPanel = document.getElementById('projectManagerPanel');
  if (projectPanel) projectPanel.classList.toggle('hidden', !authenticated);
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
    syncTokensToSessionStorage('store');
    broadcastAuth(true, authState.username);
    document.dispatchEvent(new CustomEvent('authStateConfirmed', {
      detail: { isAuthenticated: true, username: authState.username, timestamp: Date.now() }
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
  try {
    await Promise.race([
      apiRequest('/api/auth/logout', 'POST'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Logout timeout')), 5000))
    ]);
  } catch {
    // Proceed to clear state even if API fails
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
  loginTab.classList.toggle("text-blue-400", isLogin && document.documentElement.classList.contains('dark'));
  loginTab.classList.toggle("text-gray-500", !isLogin);
  loginTab.classList.toggle("text-gray-400", !isLogin && document.documentElement.classList.contains('dark'));
  registerTab.classList.toggle("border-blue-500", !isLogin);
  registerTab.classList.toggle("text-blue-600", !isLogin);
  registerTab.classList.toggle("text-blue-400", !isLogin && document.documentElement.classList.contains('dark'));
  registerTab.classList.toggle("text-gray-500", isLogin);
  registerTab.classList.toggle("text-gray-400", isLogin && document.documentElement.classList.contains('dark'));
  loginTab.classList.toggle("border-b-2", isLogin);
  registerTab.classList.toggle("border-b-2", !isLogin);
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  setTimeout(() => {
    if (window.innerWidth < 768) {
      const authDropdown = document.getElementById("authDropdown");
      if (authDropdown && !authDropdown.classList.contains('hidden')) {
        const viewportHeight = window.innerHeight;
        const dropdownRect = authDropdown.getBoundingClientRect();
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
    authBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      const isHidden = authDropdown.classList.contains('hidden');
      authDropdown.classList.toggle("hidden", !isHidden);
      if (!isHidden) return;
      if (window.innerWidth < 768) {
        authDropdown.style.left = '50%';
        authDropdown.style.right = 'auto';
        authDropdown.style.transform = 'translateX(-50%)';
        authDropdown.style.top = '60px';
      }
    });
    document.addEventListener("click", e => {
      if (!authDropdown.classList.contains('hidden') &&
        !e.target.closest("#authContainer") &&
        !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
      }
    });
    document.addEventListener("touchend", e => {
      if (!authDropdown.classList.contains('hidden') &&
        !e.target.closest("#authContainer") &&
        !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
      }
    }, { passive: false });
  }
  const loginTabEl = document.getElementById("loginTab");
  const registerTabEl = document.getElementById("registerTab");
  if (loginTabEl && registerTabEl) {
    loginTabEl.addEventListener("click", e => { e.preventDefault(); switchForm(true); });
    loginTabEl.addEventListener("touchend", e => { e.preventDefault(); switchForm(true); }, { passive: false });
    registerTabEl.addEventListener("click", e => { e.preventDefault(); switchForm(false); });
    registerTabEl.addEventListener("touchend", e => { e.preventDefault(); switchForm(false); }, { passive: false });
  }
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async e => {
      e.preventDefault();
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
        notify(err.message || "Login failed", "error");
        const errorElement = document.getElementById('login-error');
        if (errorElement) {
          errorElement.textContent = err.message || "Login failed";
          errorElement.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Log In";
        }
      }
    });
  }
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async e => {
      e.preventDefault();
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Registering...";
      }
      const data = new FormData(registerForm);
      try {
        await handleRegister(data);
        document.getElementById("authDropdown")?.classList.add('hidden');
      } catch (err) {
        const errorMsg = err?.message || "Registration failed";
        notify(errorMsg, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Register";
        }
      }
    });
  }
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
}

/* ----------------------------------
 *  Monitoring & Initialization
 * ---------------------------------- */

function setupAuthStateMonitoring() {
  setTimeout(() => verifyAuthState(false).catch(() => { }), 300);
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
  setInterval(() => syncTokensToSessionStorage('store'), 30000);
  window.addEventListener('beforeunload', () => clearInterval(authCheck));
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
    window.auth.isInitialized = true;
    window.auth.isReady = true;
    console.log("[Auth] Module initialized");
    document.dispatchEvent(new CustomEvent('authReady', {
      detail: { authenticated: authState.isAuthenticated, username: authState.username }
    }));
    return true;
  } catch (error) {
    console.error("[Auth] Initialization failed:", error);
    if (!authState.isAuthenticated) broadcastAuth(false);
    document.dispatchEvent(new CustomEvent('authReady', {
      detail: { authenticated: false, error: error.message }
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
 *  Mobile Auth Enhancements
 * ---------------------------------- */

function handleAuthModalPositioning() {
  const authDropdown = document.getElementById("authDropdown");
  if (!authDropdown || authDropdown.classList.contains('hidden')) return;
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

function enhanceMobileInputs() {
  const inputs = document.querySelectorAll('#loginForm input, #registerForm input');
  inputs.forEach(input => {
    input.addEventListener('animationstart', (e) => {
      if (e.animationName.includes('autofill')) input.classList.add('autofilled');
    });
    input.addEventListener('focus', () => {
      if (window.innerWidth < 768) input.classList.add('touch-input-focus');
    });
    input.addEventListener('blur', () => input.classList.remove('touch-input-focus'));
  });
}

let isAuthDropdownVisible = false;
let lastTouchTime = 0;

function setupMobileAuthListeners() {
  const authBtn = document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');
  if (authBtn && authDropdown) {
    authBtn.addEventListener('click', () => {
      setTimeout(() => {
        isAuthDropdownVisible = !authDropdown.classList.contains('hidden');
      }, 10);
    });
    window.addEventListener('orientationchange', () => {
      if (isAuthDropdownVisible) setTimeout(handleAuthModalPositioning, 100);
    });
    window.addEventListener('resize', () => {
      if (isAuthDropdownVisible) handleAuthModalPositioning();
    });
  }
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
    loginTab.addEventListener('touchend', handleTouchWithDebounce(() => switchForm(true)), { passive: false });
    registerTab.addEventListener('touchend', handleTouchWithDebounce(() => switchForm(false)), { passive: false });
  }
}

/* ----------------------------------
 *  Export / Window Attach
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
  updateAuthUI,
  isInitialized: false,
  isAuthenticated: async (opts = {}) => {
    try {
      return await verifyAuthState(opts.forceVerify || false);
    } catch {
      return false;
    }
  }
});
window.handleAuthModalPositioning = handleAuthModalPositioning;
window.setupMobileAuthListeners = setupMobileAuthListeners;

document.addEventListener('DOMContentLoaded', () => {
  enhanceMobileInputs();
  setupMobileAuthListeners();
});

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
