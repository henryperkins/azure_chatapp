/**
 * auth.js
 *
 * Centralized, DI-compliant authentication module for login/logout/register/session/CSRF.
 * All authentication state, CSRF handling, API request-wrapping, form/event logic, and error notification
 * is implemented in this single module—no dependencies external to DI context.
 *
 * Removal Notice: All previous modular primitives (authRequester, authState, csrfManager, etc.) deprecated and removed.
 * This module is now the single source of truth for ALL auth logic and event wiring.
 *
 * @module auth
 */

export function createAuthModule({
  apiRequest,
  notify,
  eventHandlers,
  domAPI,
  sanitizer,
  modalManager,
  apiEndpoints
} = {}) {
  if (!apiRequest) throw new Error('Auth module requires apiRequest as a dependency');
  if (!eventHandlers?.trackListener) throw new Error('Auth module requires eventHandlers.trackListener as a dependency');
  if (!domAPI || typeof domAPI.getElementById !== 'function' || typeof domAPI.isDocumentHidden !== 'function') throw new Error('Auth module requires domAPI with getElementById and isDocumentHidden');
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') throw new Error('Auth module requires sanitizer for setting innerHTML safely');
  if (!notify) throw new Error('Auth module requires a notify object for notifications');
  if (!apiEndpoints) throw new Error('Auth module requires apiEndpoints as a dependency');

  // Canonical, context-aware notifier for this whole module:
  const authNotify = notify.withContext({ module: 'AuthModule', context: 'auth' });

  // --- Internal Auth State & Event Bus
  const AUTH_CONFIG = { VERIFICATION_INTERVAL: 300000 }; // 5 min
  const authState = { isAuthenticated: false, username: null, isReady: false };
  const AuthBus = new EventTarget();

  let authCheckInProgress = false, tokenRefreshInProgress = false, tokenRefreshPromise = null;
  let csrfToken = '', csrfTokenPromise = null;
  let verifyInterval = null;
  const registeredListeners = [];

  // --- Secure CSRF Token Fetch/Caching (Centralized Here)
  async function fetchCSRFToken() {
    try {
      if (!apiEndpoints.AUTH_CSRF) throw new Error("AUTH_CSRF endpoint missing in apiEndpoints");
      const csrfUrl = apiEndpoints.AUTH_CSRF;
      const url = csrfUrl.includes('?') ? `${csrfUrl}&ts=${Date.now()}` : `${csrfUrl}?ts=${Date.now()}`;
      const data = await apiRequest(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (!data || !data.token) throw new Error('CSRF token missing in response');
      return data.token;
    } catch (error) {
      authNotify.error('[Auth] CSRF token fetch failed: ' + (error?.message || error), { group: true, source: 'fetchCSRFToken' });
      return null;
    }
  }
  async function getCSRFTokenAsync() {
    if (csrfToken) return csrfToken;
    if (csrfTokenPromise) return csrfTokenPromise;
    csrfTokenPromise = (async () => {
      try {
        const token = await fetchCSRFToken();
        if (token) csrfToken = token;
        return token;
      } finally {
        csrfTokenPromise = null;
      }
    })();
    return csrfTokenPromise;
  }
  function getCSRFToken() {
    if (!csrfToken && !csrfTokenPromise) {
      getCSRFTokenAsync().catch(err => {
        authNotify.warn("[Auth] getCSRFToken error: " + (err?.message || err), { group: true, source: 'getCSRFToken' });
      });
    }
    return csrfToken;
  }

  // --- Centralized Authenticated API Request (No Delegation)
  async function authRequest(endpoint, method, body = null) {
    const headers = { Accept: 'application/json' };
    const options = { method: method.toUpperCase(), headers, credentials: 'include' };
    const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(options.method) && endpoint !== apiEndpoints.AUTH_CSRF;
    if (isStateChanging) {
      const token = await getCSRFTokenAsync();
      if (token) options.headers['X-CSRF-Token'] = token;
      else authNotify.warn(`[Auth] CSRF token missing for request: ${endpoint}`, { group: true, source: 'authRequest' });
    }
    if (body) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }
    try {
      const data = await apiRequest(endpoint, options);
      return data;
    } catch (error) {
      authNotify.apiError(`[Auth] Request failed ${method} ${endpoint}: ${error?.message || error}`, { group: true, source: 'authRequest' });
      if (!error.status) Object.assign(error, { status: 0, data: { detail: error.message || 'Network error/CORS issue' } });
      throw error;
    }
  }

  // --- Token Refresh
  async function refreshTokens() {
    if (tokenRefreshInProgress) return tokenRefreshPromise;
    tokenRefreshInProgress = true;
    tokenRefreshPromise = (async () => {
      try {
        await getCSRFTokenAsync();
        const response = await authRequest(apiEndpoints.AUTH_REFRESH, 'POST');
        return { success: true, response };
      } catch (error) {
        authNotify.apiError('[Auth] Refresh token failed: ' + (error?.message || error), { group: true, source: 'refreshTokens' });
        if (error.status === 401) await clearTokenState({ source: 'refresh_401_error', isError: true });
        throw error;
      } finally {
        tokenRefreshInProgress = false;
        tokenRefreshPromise = null;
      }
    })();
    return tokenRefreshPromise;
  }

  // --- Auth State Broadcasting
  function broadcastAuth(authenticated, username = null, source = 'unknown') {
    const previousAuth = authState.isAuthenticated;
    const changed = (authenticated !== previousAuth) || (authState.username !== username);
    authState.isAuthenticated = authenticated;
    authState.username = username;
    if (changed) {
      authNotify.info(`[Auth] State changed (${source}): Auth=${authenticated}, User=${username ?? 'None'}`, { group: true, source: 'broadcastAuth' });
      AuthBus.dispatchEvent(new CustomEvent('authStateChanged', { detail: { authenticated, username, timestamp: Date.now(), source } }));
    }
  }
  async function clearTokenState(options = { source: 'unknown', isError: false }) {
    authNotify.info(`[Auth] Clearing auth state. Source: ${options.source}`, { group: true, source: 'clearTokenState' });
    broadcastAuth(false, null, `clearTokenState:${options.source}`);
  }

  // --- Verification & Auto-Refresh
  async function verifyAuthState(forceVerify = false) {
    if (authCheckInProgress && !forceVerify) return authState.isAuthenticated;
    authCheckInProgress = true;
    try {
      try {
        const response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
        if (response?.authenticated) {
          broadcastAuth(true, response.username, 'verify_success');
          return true;
        }
        await clearTokenState({ source: 'verify_negative' });
        return false;
      } catch (error) {
        authNotify.warn('[Auth] verifyAuthState error: ' + (error?.message || error), { group: true, source: 'verifyAuthState' });
        if (error.status === 500) {
          await clearTokenState({ source: 'verify_500' });
          throw new Error('Server error during verification');
        }
        if (error.status === 401) {
          try { await refreshTokens(); return verifyAuthState(true); }
          catch { await clearTokenState({ source: 'refresh_failed' }); return false; }
        }
        return authState.isAuthenticated;
      }
    } catch (outerErr) {
      authNotify.error('[Auth] verifyAuthState outer error: ' + (outerErr?.message || outerErr), { group: true, source: 'verifyAuthState' });
      throw outerErr;
    } finally {
      authCheckInProgress = false;
    }
  }

  // --- Public Auth Actions (Login, Logout, Register)
  async function loginUser(username, password) {
    authNotify.info(`[Auth] Attempting login for user: ${username}`, { group: true, source: 'loginUser' });
    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_LOGIN, 'POST', { username: username.trim(), password });
      if (response && response.username) {
        const verified = await verifyAuthState(true);
        if (verified) {
          authNotify.success("Login successful.", { group: true, source: "loginUser" });
          return response;
        }
        await clearTokenState({ source: 'login_verify_fail' });
        authNotify.error("Login succeeded but could not verify session.", { group: true, source: "loginUser" });
        throw new Error('Login succeeded but session could not be verified.');
      }
      await clearTokenState({ source: 'login_bad_response' });
      authNotify.error("Login succeeded but received invalid response from server.", { group: true, source: "loginUser" });
      throw new Error('Login succeeded but invalid response data.');
    } catch (error) {
      await clearTokenState({ source: 'login_error' });
      authNotify.error("Login failed: " + (error.message || "Unknown login error."), { group: true, source: "loginUser" });
      throw error;
    }
  }
  async function logout() {
    authNotify.info('[Auth] Initiating logout...', { group: true, source: 'logout' });
    await clearTokenState({ source: 'logout_manual' });
    try {
      await getCSRFTokenAsync();
      await authRequest(apiEndpoints.AUTH_LOGOUT, 'POST');
      authNotify.success('Logout successful.', { group: true, source: 'logout' });
    } catch (err) {
      authNotify.warn('[Auth] Backend logout call failed: ' + (err?.message || err), { group: true, source: 'logout' });
    }
  }
  async function registerUser(userData) {
    if (!userData?.username || !userData?.password) {
      authNotify.error('Username and password required.', { group: true, source: 'registerUser' });
      throw new Error('Username and password required.');
    }
    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_REGISTER, 'POST', { username: userData.username.trim(), password: userData.password });
      const verified = await verifyAuthState(true);
      if (!verified) {
        authNotify.warn('[Auth] Registration succeeded but verification failed.', { group: true, source: 'registerUser' });
      } else {
        authNotify.success('Registration successful.', { group: true, source: 'registerUser' });
      }
      return response;
    } catch (error) {
      await clearTokenState({ source: 'register_error', isError: true });
      authNotify.error("Registration failed: " + (error.message || "Unknown error."), { group: true, source: "registerUser" });
      throw error;
    }
  }

  // --- Centralized Form Event Handler (Only Here)
  function setupAuthForms() {
    // Remove query to #loginForm, which no longer exists (per UI changes)
    const loginForms = [
      domAPI.getElementById('loginModalForm')
    ];
    loginForms.forEach(loginForm => {
      if (loginForm && !loginForm._listenerAttached) {
        loginForm._listenerAttached = true;
        loginForm.action = apiEndpoints.AUTH_LOGIN;
        loginForm.method = 'POST';
        const handler = async (e) => {
          e.preventDefault();
          if (loginForm.id === 'loginModalForm') {
            const errorEl = domAPI.getElementById('loginModalError');
            if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
          }
          const submitBtn = loginForm.querySelector('button[type="submit"]');
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = sanitizer.sanitize(`<span class="loading loading-spinner loading-xs"></span> Logging in...`);
          }
          const formData = new FormData(loginForm);
          const username = formData.get('username');
          const password = formData.get('password');
          if (!username || !password) {
            if (loginForm.id === 'loginModalForm') {
              const errorEl = domAPI.getElementById('loginModalError');
              if (errorEl) { errorEl.textContent = 'Username and password are required.'; errorEl.classList.remove('hidden'); }
            } else {
              authNotify.error('Username and password are required.', { group: true, source: 'loginForm' });
            }
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Login'; }
            return;
          }
          try {
            await publicAuth.login(username, password);
            if (loginForm.id === 'loginModalForm' && modalManager?.hide) modalManager.hide('login');
          } catch (error) {
            let msg;
            if (error.status === 401) msg = 'Incorrect username or password.';
            else if (error.status === 400) msg = (error.data && error.data.detail) || 'Invalid login request.';
            else msg = (error.data && error.data.detail) || error.message || 'Login failed due to server error.';
            if (loginForm.id === 'loginModalForm') {
              const errorEl = domAPI.getElementById('loginModalError');
              if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }
            } else {
              authNotify.error(msg, { group: true, source: 'loginForm' });
            }
          } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Login'; }
          }
        };
        registeredListeners.push(eventHandlers.trackListener(loginForm, 'submit', handler, { passive: false }));
      }
    });
    const registerModalForm = domAPI.getElementById('registerModalForm');
    if (registerModalForm && !registerModalForm._listenerAttached) {
      registerModalForm._listenerAttached = true;
      const handler = async (e) => {
        e.preventDefault();
        const errorEl = domAPI.getElementById('registerModalError');
        const submitBtn = domAPI.getElementById('registerModalSubmitBtn');
        if (errorEl) errorEl.classList.add('hidden');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = sanitizer.sanitize(`<span class="loading loading-spinner loading-xs"></span> Registering...`);
        }
        const formData = new FormData(registerModalForm);
        const username = formData.get('username')?.trim();
        const email = formData.get('email')?.trim();
        const password = formData.get('password');
        const passwordConfirm = formData.get('passwordConfirm');
        if (!username || !email || !password || !passwordConfirm) {
          if (errorEl) { errorEl.textContent = 'All fields are required.'; errorEl.classList.remove('hidden'); }
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Register'; }
          return;
        }
        if (password !== passwordConfirm) {
          if (errorEl) { errorEl.textContent = 'Passwords do not match.'; errorEl.classList.remove('hidden'); }
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Register'; }
          return;
        }
        try {
          await publicAuth.register({ username, password });
          if (modalManager?.hide) modalManager.hide('login');
          authNotify.success('Registration successful. You may now log in.', { group: true, source: 'registerModalForm' });
        } catch (error) {
          let msg;
          if (error.status === 409) msg = 'A user with that username already exists.';
          else if (error.status === 400) msg = (error.data && error.data.detail) || 'Invalid registration data.';
          else msg = (error.data && error.data.detail) || error.message || 'Registration failed due to server error.';
          if (errorEl) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Register'; }
        }
      };
      registeredListeners.push(eventHandlers.trackListener(registerModalForm, 'submit', handler, { passive: false }));
    }
  }

  // --- Module Initialization
  async function init() {
    if (authState.isReady) {
      authNotify.warn('[Auth] init called multiple times.', { group: true, source: 'init' });
      return true;
    }
    authNotify.info('[Auth] Initializing auth module...', { group: true, source: 'init' });
    setupAuthForms();
    if (eventHandlers.trackListener) {
      registeredListeners.push(eventHandlers.trackListener(document, 'modalsLoaded', setupAuthForms));
    }
    try {
      await getCSRFTokenAsync();
      const verified = await verifyAuthState(true);
      authState.isReady = true;
      verifyInterval = setInterval(() => {
        if (!domAPI.isDocumentHidden() && authState.isAuthenticated) {
          verifyAuthState(false).catch(e => {
            authNotify.warn('[Auth] verifyAuthState periodic error: ' + (e?.message || e), { group: true, source: 'verifyAuthState' });
          });
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);
      AuthBus.dispatchEvent(new CustomEvent('authReady', { detail: { authenticated: authState.isAuthenticated, username: authState.username, error: null } }));
      return verified;
    } catch (err) {
      authNotify.error('[Auth] Initial verification failed in init: ' + (err?.stack || err), { group: true, source: 'init' });
      await clearTokenState({ source: 'init_fail', isError: true });
      authState.isReady = true;
      broadcastAuth(false, null, 'init_error');
      throw err;
    }
  }

  // --- Cleanup (Listeners & Interval Removal)
  function cleanup() {
    registeredListeners.forEach(l => l.remove());
    registeredListeners.length = 0;
    if (verifyInterval) { clearInterval(verifyInterval); verifyInterval = null; }
  }

  // --- Exposed Auth API (Centralized, Only Here)
  async function fetchCurrentUser() {
    try {
      const resp = await apiRequest(apiEndpoints.AUTH_VERIFY, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      });
      if (!resp || !resp.user) return null;
      return resp.user;
    } catch {
      return null;
    }
  }

  const publicAuth = {
    isAuthenticated: () => authState.isAuthenticated,
    getCurrentUser: () => authState.username,
    isReady: () => authState.isReady,
    init,
    login: loginUser,
    logout,
    register: registerUser,
    verifyAuthState,
    AuthBus,
    getCSRFTokenAsync,
    getCSRFToken,
    hasAuthCookies: () =>
      typeof document !== 'undefined' &&
      (document.cookie.includes('access_token') || document.cookie.includes('refresh_token')),
    cleanup,
    fetchCurrentUser
  };

  return publicAuth;
}
