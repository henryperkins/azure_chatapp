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

export async function fetchCurrentUser() {
  try {
    const resp = await fetch("/api/user/me", {
      credentials: "include",
      headers: {
        "Content-Type": "application/json"
      }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.user || null;
  } catch {
    return null;
  }
}

export function createAuthModule({
  apiRequest,
  showNotification,
  eventHandlers,
  modalManager // if needed, pass explicitly for modal close UX
} = {}) {
  // No fallback to window.DependencySystem or window.*
  if (!apiRequest) {
    throw new Error('Auth module requires apiRequest as a dependency');
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
  async function fetchCsrfToken() {
    try {
      const response = await fetch(`/api/auth/csrf?ts=${Date.now()}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (!response.ok) throw new Error(`CSRF fetch failed with status ${response.status}`);
      const data = await response.json();
      if (!data.token) throw new Error('CSRF token missing in response');
      return data.token;
    } catch (error) {
      console.error('[Auth] CSRF token fetch failed:', error);
      return null;
    }
  }

  async function getCSRFTokenAsync() {
    if (csrfToken) return csrfToken;
    if (csrfTokenPromise) return csrfTokenPromise;

    csrfTokenPromise = (async () => {
      try {
        const token = await fetchCsrfToken();
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
      getCSRFTokenAsync().catch(console.error);
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
        console.warn(`[Auth] CSRF token missing for request: ${endpoint}`);
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
      console.error(`[Auth] Request failed ${method} ${endpoint}:`, error);
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

  /* =========================
     Auth State Management
     ========================= */
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

  async function clearTokenState(options = { source: 'unknown', isError: false }) {
    console.log(`[Auth] Clearing auth state. Source: ${options.source}`);
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
      console.warn('[Auth] verifyAuthState error:', error);

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
    console.log('[Auth] Attempting login for user:', username);
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
    console.log('[Auth] Initiating logout...');
    await clearTokenState({ source: 'logout_manual' });

    try {
      await getCSRFTokenAsync();
      await authRequest('/api/auth/logout', 'POST');
      console.log('[Auth] Backend logout successful.');
    } catch (err) {
      console.warn('[Auth] Backend logout call failed:', err);
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
        console.warn('[Auth] Registration succeeded but verification failed.');
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
      console.warn('[Auth] init called multiple times.');
      return true;
    }
    console.log('[Auth] Initializing auth module...');

    // Set up login form handler (if present)
    const setupLoginForm = () => {
      const loginForms = [
        document.getElementById('loginForm'),
        document.getElementById('loginModalForm')
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
              const errorEl = document.getElementById('loginModalError');
              if (errorEl) {
                errorEl.textContent = '';
                errorEl.classList.add('hidden');
              }
            }

            // Prevent double submission
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            if (submitBtn) {
              submitBtn.disabled = true;
              submitBtn.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Logging in...`;
            }

            const formData = new FormData(loginForm);
            const username = formData.get('username');
            const password = formData.get('password');

            // Basic validation
            if (!username || !password) {
              if (loginForm.id === 'loginModalForm') {
                const errorEl = document.getElementById('loginModalError');
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
                const errorEl = document.getElementById('loginModalError');
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

          if (eventHandlers?.trackListener) {
            eventHandlers.trackListener(loginForm, 'submit', handler, { passive: false });
          } else {
            loginForm.addEventListener('submit', handler, { passive: false });
          }
        }
      });
    };

    setupLoginForm();
    document.addEventListener('modalsLoaded', setupLoginForm);

    try {
      await getCSRFTokenAsync();
      const verified = await verifyAuthState(true);
      authState.isReady = true;
      return verified;

    } catch (err) {
      // Enhanced error logging and propagation
      console.error('[Auth] Initial verification failed in init:', err && err.stack ? err.stack : err);
      await clearTokenState({ source: 'init_fail', isError: true });
      authState.isReady = true;
      broadcastAuth(false, null, 'init_error');
      // Propagate the real cause upward for diagnostics
      throw err;
    } finally {
      setInterval(() => {
        if (!document.hidden && authState.isAuthenticated) {
          verifyAuthState(false).catch(console.warn);
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
