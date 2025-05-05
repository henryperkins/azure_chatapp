/**
 * auth.js
 *
 * Secure, cookie-based authentication module with CSRF protection.
 * Exposes a fully DI-compliant factory function that manages user login,
 * logout, registration, and periodic session verification.
 *
 * @module auth
 */

/**
 * Creates a new AuthModule instance.
 *
 * @param {Object} deps - All required dependencies (strict e.g. no window.*).
 * @param {Function} deps.apiRequest - Injected API request wrapper.
 * @param {Object} deps.notify - Notification utility object.
 * @param {Object} deps.eventHandlers - Event wiring abstraction (trackListener, etc.).
 * @param {Object} deps.domAPI - DOM utilities (getElementById, isDocumentHidden, etc.).
 * @param {Object} deps.sanitizer - Sanitization utility for safe HTML injection.
 * @param {Object} [deps.modalManager] - (Optional) for closing modals on success/failure flows.
 *
 * @returns {AuthModule} A fully initialized AuthModule with the following API:
 *   - isAuthenticated()
 *   - getCurrentUser()
 *   - isReady()
 *   - init()
 *   - login(username, password)
 *   - logout()
 *   - register(userData)
 *   - verifyAuthState(forceVerify)
 *   - AuthBus (EventTarget)
 *   - getCSRFTokenAsync()
 *   - getCSRFToken()
 *   - hasAuthCookies()
 *   - cleanup()  // to remove listeners & intervals if necessary
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
  /* =========================
     1) Validate Dependencies (Strict DI, No Globals)
     ========================= */
  if (!apiRequest) {
    throw new Error('Auth module requires apiRequest as a dependency');
  }
  if (!eventHandlers?.trackListener) {
    throw new Error('Auth module requires eventHandlers.trackListener as a dependency');
  }
  if (!domAPI || typeof domAPI.getElementById !== 'function' || typeof domAPI.isDocumentHidden !== 'function') {
    throw new Error('Auth module requires domAPI with getElementById and isDocumentHidden');
  }
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') {
    throw new Error('Auth module requires sanitizer for setting innerHTML safely');
  }
  if (!notify) {
    throw new Error('Auth module requires a notify object for notifications');
  }
  if (!apiEndpoints) {
    throw new Error('Auth module requires apiEndpoints as a dependency');
  }

  /* =========================
     2) Diagnostic & Code Comment
     - No side effects at import-time
     - Timers/listeners are set up after init() so testing frameworks can mock or skip them
     ========================= */

  /* =========================
     3) Internal Configuration
     ========================= */
  const AUTH_CONFIG = {
    VERIFICATION_INTERVAL: 300000, // 5 minutes
  };

  /* =========================
     4) Internal State & Objects
     ========================= */
  const authState = {
    isAuthenticated: false,
    username: null,
    isReady: false, // True after first init/verification
  };

  const AuthBus = new EventTarget();

  let authCheckInProgress = false;
  let tokenRefreshInProgress = false;
  let tokenRefreshPromise = null;
  let csrfToken = '';
  let csrfTokenPromise = null;

  // For cleanup
  let verifyInterval = null;
  const registeredListeners = [];

  /* =========================
     5) Secure CSRF Token Fetch
     ========================= */
  async function fetchCSRFToken() {
    try {
      const url =
        (apiEndpoints.AUTH_CSRF?.includes('?') ? apiEndpoints.AUTH_CSRF + `&ts=${Date.now()}` :
          apiEndpoints.AUTH_CSRF + `?ts=${Date.now()}`);
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });
      if (!response.ok) {
        throw new Error(`CSRF fetch failed: ${response.status}`);
      }
      const data = await response.json();
      if (!data.token) {
        throw new Error('CSRF token missing in response');
      }
      return data.token;
    } catch (error) {
      notify.error('[Auth] CSRF token fetch failed: ' + (error?.message || error), {
        group: true,
        context: 'auth',
      });
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
    // Fire off a refresh if none is loaded yet (bonus: async load).
    if (!csrfToken && !csrfTokenPromise) {
      getCSRFTokenAsync().catch(err => {
        notify.warn("[Auth] getCSRFToken error: " + (err?.message || err), {
          group: true,
          context: 'auth'
        });
      });
    }
    return csrfToken;
  }

  /* =========================
     6) Auth Request Wrapper (with fallback)
     ========================= */
  async function authRequest(endpoint, method, body = null) {
    const AUTH_PROTECTED_ENDPOINTS = [
      apiEndpoints.AUTH_LOGIN,
      apiEndpoints.AUTH_REGISTER,
      apiEndpoints.AUTH_LOGOUT,
      apiEndpoints.AUTH_REFRESH
    ];
    const isAuthProtected = AUTH_PROTECTED_ENDPOINTS.includes(endpoint);

    // Defer to injected apiRequest for non-auth endpoints
    if (!isAuthProtected && apiRequest && endpoint !== apiEndpoints.AUTH_CSRF) {
      return apiRequest(endpoint, { method, body });
    }

    const headers = { Accept: 'application/json' };
    const options = {
      method: method.toUpperCase(),
      headers,
      credentials: 'include',
    };

    const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(options.method)
      && endpoint !== apiEndpoints.AUTH_CSRF;

    // Ensure CSRF token for state-changing calls
    if (isStateChanging) {
      const token = await getCSRFTokenAsync();
      if (token) {
        options.headers['X-CSRF-Token'] = token;
      } else {
        notify.warn(`[Auth] CSRF token missing for request: ${endpoint}`, {
          group: true,
          context: 'auth'
        });
      }
    }

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
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      notify.apiError(`[Auth] Request failed ${method} ${endpoint}: ${error?.message || error}`, {
        group: true,
        context: 'auth'
      });
      if (!error.status) {
        error.status = 0;
        error.data = { detail: error.message || 'Network error/CORS issue' };
      }
      throw error;
    }
  }

  /* =========================
     7) Token Refresh Logic
     ========================= */
  async function refreshTokens() {
    if (tokenRefreshInProgress) return tokenRefreshPromise;
    tokenRefreshInProgress = true;

    tokenRefreshPromise = (async () => {
      try {
        await getCSRFTokenAsync();
        const response = await authRequest(apiEndpoints.AUTH_REFRESH, 'POST');
        return { success: true, response };
      } catch (error) {
        notify.apiError('[Auth] Refresh token failed: ' + (error?.message || error), {
          group: true,
          context: 'auth'
        });
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
     8) Auth State Broadcasting
     ========================= */
  function broadcastAuth(authenticated, username = null, source = 'unknown') {
    const previousAuth = authState.isAuthenticated;
    const changed = (authenticated !== previousAuth) || (authState.username !== username);

    authState.isAuthenticated = authenticated;
    authState.username = username;

    if (changed) {
      notify.info(`[Auth] State changed (${source}): Auth=${authenticated}, User=${username ?? 'None'}`, {
        group: true,
        context: 'auth'
      });
      AuthBus.dispatchEvent(
        new CustomEvent('authStateChanged', {
          detail: {
            authenticated,
            username,
            timestamp: Date.now(),
            source,
          }
        })
      );
    }
  }

  async function clearTokenState(options = { source: 'unknown', isError: false }) {
    notify.info(`[Auth] Clearing auth state. Source: ${options.source}`, {
      group: true,
      context: 'auth'
    });
    broadcastAuth(false, null, `clearTokenState:${options.source}`);
    // Actual cookie clearing must be done on server-side.
  }

  /* =========================
     9) Verification & Auto-Refresh
     ========================= */
  async function verifyAuthState(forceVerify = false) {
    if (authCheckInProgress && !forceVerify) {
      return authState.isAuthenticated;
    }
    authCheckInProgress = true;

    try {
      const response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
      if (response?.authenticated) {
        broadcastAuth(true, response.username, 'verify_success');
        return true;
      }
      // Server says not authenticated
      await clearTokenState({ source: 'verify_negative' });
      return false;
    } catch (error) {
      notify.warn('[Auth] verifyAuthState error: ' + (error?.message || error), {
        group: true,
        context: 'auth'
      });

      // Possible server error
      if (error.status === 500) {
        await clearTokenState({ source: 'verify_500' });
        throw new Error('Server error during verification');
      }
      // If unauthorized, attempt refresh, then re-verify
      if (error.status === 401) {
        try {
          await refreshTokens();
          return verifyAuthState(true);
        } catch {
          await clearTokenState({ source: 'refresh_failed' });
          return false;
        }
      }
      // Otherwise, keep current state
      return authState.isAuthenticated;
    } finally {
      authCheckInProgress = false;
    }
  }

  /* =========================
     10) Public Auth Actions
     ========================= */
  async function loginUser(username, password) {
    notify.info(`[Auth] Attempting login for user: ${username}`, {
      group: true,
      context: 'auth'
    });
    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_LOGIN, 'POST', {
        username: username.trim(),
        password,
      });
      if (response && response.username) {
        const verified = await verifyAuthState(true);
        if (verified) {
          notify.success("Login successful.", {
            group: true,
            context: "auth"
          });
          return response;
        } else {
          await clearTokenState({ source: 'login_verify_fail' });
          notify.error("Login succeeded but could not verify session.", {
            group: true,
            context: "auth"
          });
          throw new Error('Login succeeded but session could not be verified.');
        }
      } else {
        await clearTokenState({ source: 'login_bad_response' });
        notify.error("Login succeeded but received invalid response from server.", {
          group: true,
          context: "auth"
        });
        throw new Error('Login succeeded but invalid response data.');
      }
    } catch (error) {
      await clearTokenState({ source: 'login_error' });
      notify.error("Login failed: " + (error.message || "Unknown login error."), {
        group: true,
        context: "auth"
      });
      throw error;
    }
  }

  async function logout() {
    notify.info('[Auth] Initiating logout...', {
      group: true,
      context: 'auth'
    });
    await clearTokenState({ source: 'logout_manual' });

    try {
      await getCSRFTokenAsync();
      await authRequest(apiEndpoints.AUTH_LOGOUT, 'POST');
      notify.success('Logout successful.', {
        group: true,
        context: 'auth'
      });
    } catch (err) {
      notify.warn('[Auth] Backend logout call failed: ' + (err?.message || err), {
        group: true,
        context: 'auth'
      });
    }
    // SPA might choose to redirect or show a login modal afterward
  }

  async function registerUser(userData) {
    if (!userData?.username || !userData?.password) {
      notify.error('Username and password required.', {
        group: true,
        context: 'auth'
      });
      throw new Error('Username and password required.');
    }

    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_REGISTER, 'POST', {
        username: userData.username.trim(),
        password: userData.password,
      });

      const verified = await verifyAuthState(true);
      if (!verified) {
        notify.warn('[Auth] Registration succeeded but verification failed.', {
          group: true,
          context: 'auth'
        });
      } else {
        notify.success('Registration successful.', {
          group: true,
          context: 'auth'
        });
      }
      return response;
    } catch (error) {
      await clearTokenState({ source: 'register_error', isError: true });
      notify.error("Registration failed: " + (error.message || "Unknown error."), {
        group: true,
        context: "auth"
      });
      throw error;
    }
  }

  /* =========================
     11) Event Handlers for DOM Forms (with cleanup)
     ========================= */
  function setupAuthForms() {
    // ----- Login Forms
    const loginForms = [
      domAPI.getElementById('loginForm'),
      domAPI.getElementById('loginModalForm')
    ];
    loginForms.forEach(loginForm => {
      if (loginForm && !loginForm._listenerAttached) {
        loginForm._listenerAttached = true;
        loginForm.action = apiEndpoints.AUTH_LOGIN;
        loginForm.method = 'POST';

        const handler = async (e) => {
          e.preventDefault();
          // Clear old errors
          if (loginForm.id === 'loginModalForm') {
            const errorEl = domAPI.getElementById('loginModalError');
            if (errorEl) {
              errorEl.textContent = '';
              errorEl.classList.add('hidden');
            }
          }

          // Submit button updates
          const submitBtn = loginForm.querySelector('button[type="submit"]');
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = sanitizer.sanitize(
              `<span class="loading loading-spinner loading-xs"></span> Logging in...`
            );
          }

          const formData = new FormData(loginForm);
          const username = formData.get('username');
          const password = formData.get('password');

          if (!username || !password) {
            if (loginForm.id === 'loginModalForm') {
              const errorEl = domAPI.getElementById('loginModalError');
              if (errorEl) {
                errorEl.textContent = 'Username and password are required.';
                errorEl.classList.remove('hidden');
              }
            } else {
              notify.error('Username and password are required.', {
                group: true,
                context: 'auth'
              });
            }
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Login';
            }
            return;
          }

          try {
            await publicAuth.login(username, password);
            if (loginForm.id === 'loginModalForm' && modalManager?.hide) {
              modalManager.hide('login');
            }
          } catch (error) {
            let msg;
            if (error.status === 401) {
              msg = 'Incorrect username or password.';
            } else if (error.status === 400) {
              msg = (error.data && error.data.detail) || 'Invalid login request.';
            } else {
              msg = (error.data && error.data.detail) || error.message || 'Login failed due to server error.';
            }
            if (loginForm.id === 'loginModalForm') {
              const errorEl = domAPI.getElementById('loginModalError');
              if (errorEl) {
                errorEl.textContent = msg;
                errorEl.classList.remove('hidden');
              }
            } else {
              notify.error(msg, { group: true, context: 'auth' });
            }
          } finally {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Login';
            }
          }
        };

        // Track the listener for cleanup
        registeredListeners.push(
          eventHandlers.trackListener(loginForm, 'submit', handler, { passive: false })
        );
      }
    });

    // ----- Register Modal
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
          submitBtn.innerHTML = sanitizer.sanitize(
            `<span class="loading loading-spinner loading-xs"></span> Registering...`
          );
        }

        const formData = new FormData(registerModalForm);
        const username = formData.get('username')?.trim();
        const email = formData.get('email')?.trim();
        const password = formData.get('password');
        const passwordConfirm = formData.get('passwordConfirm');

        if (!username || !email || !password || !passwordConfirm) {
          if (errorEl) {
            errorEl.textContent = 'All fields are required.';
            errorEl.classList.remove('hidden');
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Register';
          }
          return;
        }
        if (password !== passwordConfirm) {
          if (errorEl) {
            errorEl.textContent = 'Passwords do not match.';
            errorEl.classList.remove('hidden');
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Register';
          }
          return;
        }

        try {
          await publicAuth.register({ username, password });
          if (modalManager?.hide) modalManager.hide('login');
          notify.success('Registration successful. You may now log in.', {
            group: true,
            context: 'auth'
          });
        } catch (error) {
          let msg;
          if (error.status === 409) {
            msg = 'A user with that username already exists.';
          } else if (error.status === 400) {
            msg = (error.data && error.data.detail) || 'Invalid registration data.';
          } else {
            msg = (error.data && error.data.detail) || error.message || 'Registration failed due to server error.';
          }
          if (errorEl) {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Register';
          }
        }
      };

      registeredListeners.push(
        eventHandlers.trackListener(registerModalForm, 'submit', handler, { passive: false })
      );
    }
  }

  /* =========================
     12) init() - Module Initialization
     ========================= */
  async function init() {
    if (authState.isReady) {
      notify.warn('[Auth] init called multiple times.', {
        group: true,
        context: 'auth'
      });

      // Removed duplicate loginBtn handler for opening login modal (now handled centrally in app.js)
      return true;
    }
    notify.info('[Auth] Initializing auth module...', {
      group: true,
      context: 'auth'
    });

    // Attach form handlers
    setupAuthForms();
    // Also watch for future modal injections
    if (eventHandlers.trackListener) {
      registeredListeners.push(
        eventHandlers.trackListener(document, 'modalsLoaded', setupAuthForms)
      );
    } else {
      // fallback if no trackListener
      document.addEventListener('modalsLoaded', setupAuthForms);
    }

    try {
      await getCSRFTokenAsync();
      const verified = await verifyAuthState(true);
      authState.isReady = true;

      // Start periodic verification
      verifyInterval = setInterval(() => {
        // Use the injected method to check if the document is hidden
        if (!domAPI.isDocumentHidden() && authState.isAuthenticated) {
          verifyAuthState(false).catch(e => {
            notify.warn('[Auth] verifyAuthState periodic error: ' + (e?.message || e), {
              group: true,
              context: 'auth'
            });
          });
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);

      // Let listeners know auth module is ready
      AuthBus.dispatchEvent(
        new CustomEvent('authReady', {
          detail: {
            authenticated: authState.isAuthenticated,
            username: authState.username,
            error: null
          }
        })
      );
      return verified;
    } catch (err) {
      notify.error('[Auth] Initial verification failed in init: ' + (err?.stack || err), {
        group: true,
        context: 'auth'
      });
      await clearTokenState({ source: 'init_fail', isError: true });
      authState.isReady = true;
      broadcastAuth(false, null, 'init_error');
      throw err; // Rethrow for diagnostic or further handling
    }
  }

  /* =========================
     13) Cleanup (Event + Timer Removal)
     ========================= */
  function cleanup() {
    // Remove tracked listeners
    registeredListeners.forEach(l => l.remove());
    registeredListeners.length = 0;
    // Clear the periodic verification interval
    if (verifyInterval) {
      clearInterval(verifyInterval);
      verifyInterval = null;
    }
  }

  /* =========================
     14) Exposed Auth API
     ========================= */
  const publicAuth = {
    /**
     * @returns {boolean} If user is currently authenticated
     */
    isAuthenticated: () => authState.isAuthenticated,

    /**
     * @returns {string | null} Current username, or null if not authenticated
     */
    getCurrentUser: () => authState.username,

    /**
     * @returns {boolean} Whether the module is initialized & complete
     */
    isReady: () => authState.isReady,

    init,
    login: loginUser,
    logout,
    register: registerUser,
    verifyAuthState,
    AuthBus,

    /**
     * CSRF handlers
     */
    getCSRFTokenAsync,
    getCSRFToken,

    /**
     * Basic cookie presence check.
     * For advanced use, consider injecting a cookie manager in `domAPI`.
     */
    hasAuthCookies: () =>
      // Real-world usage: you'd ideally read cookies from an injected utility
      typeof document !== 'undefined' &&
      (document.cookie.includes('access_token') || document.cookie.includes('refresh_token')),

    /**
     * Cleanup method for removing event listeners and intervals (helpful in SPA or unit tests).
     */
    cleanup
  };

  return publicAuth;
  }
/**
 * Provide a minimal direct fetch-based version of fetchCurrentUser,
 * so callers can still import { fetchCurrentUser } without referencing
 * the main module DI.
 */
export async function fetchCurrentUser() {
  try {
    const resp = await fetch('/api/auth/verify', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json'
      }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || !data.user) return null;
    return data.user;
  } catch (err) {
    console.error('[auth] fetchCurrentUser error:', err);
    return null;
  }
}

export default createAuthModule;
