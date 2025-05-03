/**
 * auth.js - DI-Strict, No window.* for Dependency/Module lookup
 *
 * Handles user authentication state based solely on backend HttpOnly cookies and server verification.
 *
 * Features:
 * - Secure, cookie-based authentication (no tokens in JS-accessible storage)
 * - CSRF protection for all state-changing requests
 * - Periodic session verification and automatic refresh
 * - Event system for auth state changes
 * - Graceful fallback for optional eventHandlers only
 *
 * ## Dependencies (resolved via DI, never window.*):
 * - apiRequest (required)
 * - showNotification (optional, for error toast)
 * - eventHandlers (optional, for listener tracking)
 * - modalManager (optional ONLY for modal closure UX; orchestrator should provide as needed)
 *
 * Exports:
 * - createAuthModule: factory for main API for authentication actions and state
 */

/**
 * DI-friendly helper for current user fetch;
 * Tries injected apiRequest (if present), else falls back to fetch.
 */
export async function fetchCurrentUser({ apiRequest, showNotification } = {}) {
  try {
    if (apiRequest) {
      const data = await apiRequest("/api/user/me", { method: "GET" });
      return data?.user || null;
    }
    const resp = await fetch("/api/user/me", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.user || null;
  } catch (err) {
    showNotification?.("[Auth] fetchCurrentUser failed: " + (err?.message || err), "error");
    return null;
  }
}

export function createAuthModule({
  apiRequest,
  showNotification,
  eventHandlers,
  domAPI,
  sanitizer,
  modalManager // if needed, pass explicitly for modal close UX
} = {}) {
  // No fallback to window.DependencySystem or window.*
  if (!apiRequest) {
    throw new Error('Auth module requires apiRequest as a dependency');
  }
  if (!eventHandlers?.trackListener) {
    throw new Error('Auth module requires eventHandlers.trackListener as a dependency');
  }
  if (!domAPI || typeof domAPI.getElementById !== 'function') {
    throw new Error('Auth module requires domAPI with getElementById for safe DOM access');
  }
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') {
    throw new Error('Auth module requires sanitizer for setting innerHTML safely');
  }

  /* =========================
     Configuration
     ========================= */

  const AUTH_CONFIG = {
    VERIFICATION_INTERVAL: 300000, // 5 minutes: How often to re-verify session
  };

  /* =========================
     Internal State
     ========================= */
  const authState = {
    isAuthenticated: false,
    username: null,
    isReady: false, // True after initial verification completes
  };

  const AuthBus = new EventTarget();

  let authCheckInProgress = false;
  let tokenRefreshInProgress = false;
  let tokenRefreshPromise = null;
  let csrfToken = '';
  let csrfTokenPromise = null;

  /* =========================
     CSRF Token Management
     ========================= */
  // Simplified and secure CSRF token fetch per security remediation
  function fetchCSRFToken() {
    try {
      return fetch(`/api/auth/csrf?ts=${Date.now()}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
        },
      })
      .then(response => {
        if (!response.ok) throw new Error(`CSRF fetch failed: ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (!data.token) throw new Error('CSRF token missing in response');
        return data.token;
      });
    } catch (error) {
      showNotification?.('[Auth] CSRF token fetch failed: ' + (error?.message || error), 'error');
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
      getCSRFTokenAsync().catch(e => showNotification?.("[Auth] getCSRFToken error: " + (e?.message || e), "warn"));
    }
    return csrfToken;
  }

  /* =========================
     API Request Wrapper
     ========================= */
  async function authRequest(endpoint, method, body = null) {
    const AUTH_PROTECTED_ENDPOINTS = [
      '/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/refresh'
    ];
    const isAuthProtected = AUTH_PROTECTED_ENDPOINTS.includes(endpoint);

    // Defer to injected apiRequest for non-auth endpoints
    if (!isAuthProtected && apiRequest && endpoint !== '/api/auth/csrf') {
      return apiRequest(endpoint, { method, body });
    }

    const baseHeaders = { Accept: 'application/json' };
    const headers = { ...baseHeaders };
    const options = {
      method: method.toUpperCase(),
      headers,
      credentials: 'include',
    };

    const isStateChanging =
      !['GET', 'HEAD', 'OPTIONS'].includes(options.method) &&
      endpoint !== '/api/auth/csrf';

    if (isStateChanging) {
      const token = await getCSRFTokenAsync();
      if (token) {
        options.headers['X-CSRF-Token'] = token;
      } else {
        showNotification?.(`[Auth] CSRF token missing for request: ${endpoint}`, 'warn');
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
      showNotification?.(`[Auth] Request failed ${method} ${endpoint}: ${error?.message || error}`, 'error');
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
  async function refreshTokens() {
    if (tokenRefreshInProgress) return tokenRefreshPromise;

    tokenRefreshInProgress = true;

    tokenRefreshPromise = (async () => {
      try {
        await getCSRFTokenAsync();
        const response = await authRequest('/api/auth/refresh', 'POST');
        return { success: true, response };
      } catch (error) {
        showNotification?.('[Auth] Refresh token failed: ' + (error?.message || error), 'error');
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
  function broadcastAuth(authenticated, username = null, source = 'unknown') {
    const previous = authState.isAuthenticated;
    const changed = authenticated !== previous || authState.username !== username;

    authState.isAuthenticated = authenticated;
    authState.username = username;

    if (changed) {
      showNotification?.(`[Auth] State changed (${source}): Auth=${authenticated}, User=${username ?? 'None'}`, 'info');
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

  async function clearTokenState(options = { source: 'unknown', isError: false }) {
    showNotification?.(`[Auth] Clearing auth state. Source: ${options.source}`, 'info');
    broadcastAuth(false, null, `clearTokenState:${options.source}`);
    // HttpOnly cookies are cleared by backend on logout
  }

  /* =========================
     Auth Verification
     ========================= */
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
      showNotification?.('[Auth] verifyAuthState error: ' + (error?.message || error), 'warn');

      if (error.status === 500) {
        await clearTokenState({ source: 'verify_500' });
        throw new Error('Server error during verification');
      }

      if (error.status === 401) {
        try {
          await refreshTokens();
          return verifyAuthState(true);
        } catch {
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
  async function loginUser(username, password) {
    showNotification?.(`[Auth] Attempting login for user: ${username}`, 'info');
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

  async function logout() {
    showNotification?.('[Auth] Initiating logout...', 'info');
    await clearTokenState({ source: 'logout_manual' });

    try {
      await getCSRFTokenAsync();
      await authRequest('/api/auth/logout', 'POST');
      showNotification?.('[Auth] Backend logout successful.', 'info');
    } catch (err) {
      showNotification?.('[Auth] Backend logout call failed: ' + (err?.message || err), 'warn');
    } finally {
      // Cosmetic: Allow UI to paint, then redirect user after logout
      // Do not redirect; just update UI and let SPA handle login modal if user clicks login
      // setTimeout(() => {
      //   if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      //     window.location.href = '/login?loggedout=true';
      //   }
      // }, 150);
    }
  }

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
        showNotification?.('[Auth] Registration succeeded but verification failed.', 'warn');
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
  async function init() {
    if (authState.isReady) {
      showNotification?.('[Auth] init called multiple times.', 'warn');
      return true;
    }
    showNotification?.('[Auth] Initializing auth module...', 'info');

    // Set up login & register modal form handlers (if present)
    const setupAuthForms = () => {
      // ----- Login
      const loginForms = [
        domAPI.getElementById('loginForm'),
        domAPI.getElementById('loginModalForm')
      ];
      loginForms.forEach(loginForm => {
        if (loginForm && !loginForm._listenerAttached) {
          loginForm._listenerAttached = true;
          loginForm.action = '/api/auth/login';
          loginForm.method = 'POST';

          const handler = async (e) => {
            e.preventDefault();

            // Hide any previous error message
            if (loginForm.id === 'loginModalForm') {
              const errorEl = domAPI.getElementById('loginModalError');
              if (errorEl) {
                errorEl.textContent = '';
                errorEl.classList.add('hidden');
              }
            }

            // Prevent double submission
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            if (submitBtn) {
              submitBtn.disabled = true;
              submitBtn.innerHTML = sanitizer.sanitize(`<span class="loading loading-spinner loading-xs"></span> Logging in...`);
            }

            const formData = new FormData(loginForm);
            const username = formData.get('username');
            const password = formData.get('password');

            // Basic validation
            if (!username || !password) {
              if (loginForm.id === 'loginModalForm') {
                const errorEl = domAPI.getElementById('loginModalError');
                if (errorEl) {
                  errorEl.textContent = 'Username and password are required.';
                  errorEl.classList.remove('hidden');
                }
              } else {
                showNotification?.('Username and password are required.', 'error');
              }
              if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Login';
              }
              return;
            }

            try {
              await publicAuth.login(username, password);

              // On success, close modal if used – orchestrator or DI must provide modalManager if wanted
              if (loginForm.id === 'loginModalForm' && modalManager?.hide) {
                modalManager.hide('login');
              }
            } catch (error) {
              // Determine user-friendly message
              let msg;
              if (error.status === 401) {
                msg = 'Incorrect username or password.';
              } else if (error.status === 400) {
                msg = (error.data && error.data.detail) || 'Invalid login request.';
              } else {
                msg = (error.data && error.data.detail) || error.message || 'Login failed due to server error.';
              }
              // Display error
              if (loginForm.id === 'loginModalForm') {
                const errorEl = domAPI.getElementById('loginModalError');
                if (errorEl) {
                  errorEl.textContent = msg;
                  errorEl.classList.remove('hidden');
                }
              } else {
                showNotification?.(msg, 'error');
              }
            } finally {
              if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Login';
              }
            }
          };

          eventHandlers.trackListener(loginForm, 'submit', handler, { passive: false });
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
            submitBtn.innerHTML = sanitizer.sanitize(`<span class="loading loading-spinner loading-xs"></span> Registering...`);
          }

          const formData = new FormData(registerModalForm);
          const username = formData.get('username')?.trim();
          const email = formData.get('email')?.trim();
          const password = formData.get('password');
          const passwordConfirm = formData.get('passwordConfirm');

          // Basic validation
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
            showNotification?.('Registration successful. You may now log in.', 'success');
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
        eventHandlers.trackListener(registerModalForm, 'submit', handler, { passive: false });
      }
    };

    setupAuthForms();
    if (eventHandlers?.trackListener) {
      eventHandlers.trackListener(document, 'modalsLoaded', setupAuthForms);
    } else {
      document.addEventListener('modalsLoaded', setupAuthForms);
    }

    try {
      await getCSRFTokenAsync();
      const verified = await verifyAuthState(true);
      authState.isReady = true;
      return verified;

    } catch (err) {
      // Enhanced error logging and propagation
      showNotification?.('[Auth] Initial verification failed in init: ' + ((err && err.stack) ? err.stack : err), 'error');
      await clearTokenState({ source: 'init_fail', isError: true });
      authState.isReady = true;
      broadcastAuth(false, null, 'init_error');
      // Propagate the real cause upward for diagnostics
      throw err;
    } finally {
      setInterval(() => {
        if (!document.hidden && authState.isAuthenticated) {
          verifyAuthState(false).catch(e => showNotification?.('[Auth] verifyAuthState periodic error: ' + (e?.message || e), 'warn'));
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);

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
      typeof document !== 'undefined' && (document.cookie.includes('access_token') || document.cookie.includes('refresh_token'))
  };

  // Return the fully modular, DI-compliant Auth API
  return publicAuth;
}

export default createAuthModule;
