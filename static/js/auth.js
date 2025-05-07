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

  // --- Input Validation Utilities ---
  function validateUsername(username) {
    // 3-32 chars, a-zA-Z0-9_.-
    return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
  }
  function validateEmail(email) {
    // Simple RFC 5322 compliant regex (not perfect, but sufficient for client-side)
    return typeof email === 'string' && /^[^@]+@[^@]+\.[^@]+$/.test(email);
  }
  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 12) {
      return { valid: false, message: "Password must be at least 12 characters" };
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
    if (!hasUpper) return { valid: false, message: "Password must contain an uppercase letter" };
    if (!hasLower) return { valid: false, message: "Password must contain a lowercase letter" };
    if (!hasNumber) return { valid: false, message: "Password must contain a number" };
    if (!hasSpecial) return { valid: false, message: "Password must contain a special character" };
    return { valid: true };
  }

  // --- Centralized UI helpers for loading/error state ---
  function setButtonLoading(btn, isLoading, loadingText = "Saving...") {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.innerHTML = `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
    }
  }
  function showError(el, msg) {
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  }
  function hideError(el) {
    if (el) {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }

  // --- Internal Auth State & Event Bus
  const AUTH_CONFIG = { VERIFICATION_INTERVAL: 300000 }; // 5 min
  const authState = { isAuthenticated: false, username: null, isReady: false };
  const AuthBus = new EventTarget();

  // --- Cookie helper ------------------------------------------------------
  function readCookie(name) {
    if (typeof document === 'undefined') return null;
    const m = document.cookie.match(
      new RegExp('(?:^|;\\s*)' + name + '\\s*=\\s*([^;]+)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

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
      if (!data || !data.token) {
        authNotify.error('CSRF token fetch failed, cannot proceed with authentication.');
        throw new Error('CSRF token missing');
      }
      return data.token;
    } catch (error) {
      authNotify.error('[Auth] CSRF token fetch failed: ' + (error?.message || error), { group: true, source: 'fetchCSRFToken' });
      throw error;
    }
  }
  async function getCSRFTokenAsync(forceFetch = false) {
    const cookieVal = readCookie('csrf_token');
    if (!forceFetch && cookieVal) {
      csrfToken = cookieVal;
      return csrfToken;
    }
    if (csrfToken && !forceFetch) return csrfToken;
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
    const current = readCookie('csrf_token');
    if (current && current !== csrfToken) {
      csrfToken = current;          // Mantener variable y cookie sincronizadas
    }
    return csrfToken;
  }

  // --- Centralized Authenticated API Request (No Delegation)
  async function authRequest(endpoint, method, body = null) {
    const headers = { Accept: 'application/json' };
    const options = { method: method.toUpperCase(), headers, credentials: 'include' };
    const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(options.method) && endpoint !== apiEndpoints.AUTH_CSRF;
    if (isStateChanging) {
      const token = getCSRFToken() || await getCSRFTokenAsync();
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
        let response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
        // If backend sent plain text, attempt JSON parse
        if (typeof response === 'string') {
          try { response = JSON.parse(response); } catch { /* keep as string */ }
        }

        // -----------------------------
        // NUEVA lógica de verificación
        // -----------------------------
        // El backend puede devolver distintos campos; consideramos autenticado si
        //  • authenticated === true            (camelCase)
        //  • is_authenticated === true         (snake_case)
        //  • existe username / user            (string u objeto con username)
        // Si se detecta usuario, lo extraemos para difundirlo.
        const usernameField =
          response?.username ??
          (typeof response?.user === 'string'
             ? response.user
             : response?.user?.username) ??
          null;

        const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
        const isAuthenticatedResp =
          truthy(response?.authenticated) ||
          truthy(response?.is_authenticated) ||
          Boolean(usernameField);

        if (isAuthenticatedResp) {
          broadcastAuth(true, usernameField, 'verify_success');
          return true;
        }

        // Si no se valida, procedemos como antes
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
          const errorEl = domAPI.getElementById('loginModalError');
          hideError(errorEl);
          const submitBtn = loginForm.querySelector('button[type="submit"]');
          setButtonLoading(submitBtn, true, "Logging in...");
          const formData = new FormData(loginForm);
          const username = formData.get('username')?.trim();
          const password = formData.get('password');
          // --- Robust input validation ---
          if (!username || !password) {
            showError(errorEl, 'Username and password are required.');
            setButtonLoading(submitBtn, false, "Login");
            return;
          }
          if (!validateUsername(username)) {
            showError(errorEl, 'Invalid username. Use 3-32 letters, numbers, or ._-');
            setButtonLoading(submitBtn, false, "Login");
            return;
          }
          const pwCheck = validatePassword(password);
          if (!pwCheck.valid) {
            showError(errorEl, pwCheck.message);
            setButtonLoading(submitBtn, false, "Login");
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
            showError(errorEl, msg);
          } finally {
            setButtonLoading(submitBtn, false, "Login");
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
        hideError(errorEl);
        setButtonLoading(submitBtn, true, "Registering...");
        const formData = new FormData(registerModalForm);
        const username = formData.get('username')?.trim();
        const email = formData.get('email')?.trim();
        const password = formData.get('password');
        const passwordConfirm = formData.get('passwordConfirm');
        // --- Robust input validation ---
        if (!username || !email || !password || !passwordConfirm) {
          showError(errorEl, 'All fields are required.');
          setButtonLoading(submitBtn, false, "Register");
          return;
        }
        if (!validateUsername(username)) {
          showError(errorEl, 'Invalid username. Use 3-32 letters, numbers, or ._-');
          setButtonLoading(submitBtn, false, "Register");
          return;
        }
        if (!validateEmail(email)) {
          showError(errorEl, 'Invalid email address.');
          setButtonLoading(submitBtn, false, "Register");
          return;
        }
        const pwCheck = validatePassword(password);
        if (!pwCheck.valid) {
          showError(errorEl, pwCheck.message);
          setButtonLoading(submitBtn, false, "Register");
          return;
        }
        if (password !== passwordConfirm) {
          showError(errorEl, 'Passwords do not match.');
          setButtonLoading(submitBtn, false, "Register");
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
          showError(errorEl, msg);
        } finally {
          setButtonLoading(submitBtn, false, "Register");
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
