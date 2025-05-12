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
  apiEndpoints,
  DependencySystem, // Added DependencySystem
  errorReporter = null // Added errorReporter
} = {}) {
  if (!apiRequest) throw new Error('Auth module requires apiRequest as a dependency');
  if (!DependencySystem) throw new Error('Auth module requires DependencySystem as a dependency'); // Added check
  if (!eventHandlers?.trackListener) throw new Error('Auth module requires eventHandlers.trackListener as a dependency');
  if (!domAPI || typeof domAPI.getElementById !== 'function' || typeof domAPI.isDocumentHidden !== 'function') throw new Error('Auth module requires domAPI with getElementById and isDocumentHidden');
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') throw new Error('Auth module requires sanitizer for setting innerHTML safely');
  if (!notify) throw new Error('Auth module requires a notify object for notifications');
  if (!apiEndpoints) throw new Error('Auth module requires apiEndpoints as a dependency');

  // Canonical, context-aware notifier for this whole module:
  const authNotify = notify.withContext({ module: 'AuthModule', context: 'auth' });

  // --- Debug Utility ---
  function logCookieState(tag = '') {
    // Use domAPI to access cookies instead of document directly
    const cookies = domAPI.getAttribute ? domAPI.getAttribute(domAPI.getDocument(), 'cookie') : '';
    authNotify.debug('[COOKIE_SNAPSHOT]', { tag, cookie: cookies });
  }

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

      // Create HTML content with loading spinner
      const htmlContent = `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`;

      // Sanitize HTML content before setting innerHTML
      if (sanitizer && typeof sanitizer.sanitize === 'function') {
        btn.innerHTML = sanitizer.sanitize(htmlContent);
      } else {
        // Log warning if sanitizer is not available
        if (errorReporter?.capture) {
          const err = new Error('Setting innerHTML without sanitization');
          errorReporter.capture(err, {
            module: MODULE_CONTEXT,
            method: 'setButtonLoading',
            extra: { element: 'button' }
          });
        }

        // Still set the content, but with a warning
        btn.innerHTML = htmlContent;
      }
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
  const authState = { isAuthenticated: false, username: null, userObject: null, isReady: false };
  const AuthBus = new EventTarget();
  const MODULE_CONTEXT = 'AuthModule'; // Define context for listeners

  // --- Cookie helper ------------------------------------------------------
  function readCookie(name) {
    // Use domAPI to access cookies instead of document directly
    const cookieStr = domAPI.getAttribute ? domAPI.getAttribute(domAPI.getDocument(), 'cookie') : '';
    if (!cookieStr) return null;

    const m = cookieStr.match(
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
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(error, {
          module: MODULE_CONTEXT,
          method: 'fetchCSRFToken',
          extra: { endpoint: apiEndpoints.AUTH_CSRF }
        });
      }

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
      logCookieState(`after ${method} ${endpoint}`);
      return data;
    } catch (error) {
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(error, {
          module: MODULE_CONTEXT,
          method: 'authRequest',
          extra: { endpoint, method }
        });
      }

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
        authNotify.debug('[Auth] refreshTokens: starting', { group: true, source: 'refreshTokens' });
        await getCSRFTokenAsync();
        const response = await authRequest(apiEndpoints.AUTH_REFRESH, 'POST');
        authNotify.debug('[Auth] refreshTokens: success', { group: true, source: 'refreshTokens' });
        return { success: true, response };
      } catch (error) {
        // Use errorReporter to capture the error with context
        if (errorReporter?.capture) {
          errorReporter.capture(error, {
            module: MODULE_CONTEXT,
            method: 'refreshTokens',
            extra: { endpoint: apiEndpoints.AUTH_REFRESH }
          });
        }

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
  function broadcastAuth(authenticated, userObject = null, source = 'unknown') {
    const previousAuth = authState.isAuthenticated;
    const previousUserObject = authState.userObject;
    const newUsername = userObject?.username || null;

    const changed = (authenticated !== previousAuth) || (JSON.stringify(userObject) !== JSON.stringify(previousUserObject));

    authState.isAuthenticated = authenticated;
    authState.userObject = userObject;
    authState.username = userObject?.username || null; // Corrected: was newUsername

    if (changed) {
      // Log auth state change appropriately
      const logMessage = `[Auth] State changed (${source}): Auth=${authenticated}, UserObject=${userObject ? JSON.stringify(userObject) : 'None'}`;
      if (!authenticated) { // More prominent log if becoming unauthenticated
        authNotify.error(`[CRITICAL_AUTH_STATE_FALSE] ${logMessage}`, {
          group: true,
          source: 'broadcastAuth',
          context: MODULE_CONTEXT,
          detailSource: source
        });
      } else {
        authNotify.info(logMessage, {
          group: true,
          source: 'broadcastAuth',
          context: MODULE_CONTEXT
        });
      }

      // 1. Update app.state first (central source of truth per requirement #11)
      const appInstance = DependencySystem.modules.get('app');
      if (appInstance && appInstance.state) {
        appInstance.state.isAuthenticated = authenticated;
        appInstance.state.currentUser = userObject;
        authNotify.debug('[Auth] Updated app.state with authentication state', {
          group: true,
          source: 'broadcastAuth',
          context: MODULE_CONTEXT
        });
      } else {
        authNotify.warn('[Auth] Could not update app.state - app not available in DI', {
          group: true,
          source: 'broadcastAuth',
          context: MODULE_CONTEXT
        });
      }

      // 2. Update DependencySystem with the current user
      if (DependencySystem && DependencySystem.modules) {
        // We don't re-register, but we update the existing registration
        const currentUserModule = DependencySystem.modules.get('currentUser');
        if (currentUserModule !== userObject) {
          authNotify.debug('[Auth] Updating currentUser in DependencySystem', {
            group: true,
            source: 'broadcastAuth',
            context: MODULE_CONTEXT,
            previousUser: currentUserModule ? 'exists' : 'null',
            newUser: userObject ? 'exists' : 'null'
          });
          DependencySystem.modules.set('currentUser', userObject);
        }
      }

      // 3. Dispatch the auth event on AuthBus (following requirement #12)
      AuthBus.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: {
          authenticated,
          user: userObject,
          timestamp: Date.now(),
          source
        }
      }));

      // 4. Also dispatch on document via domAPI (no direct document usage per requirement #2)
      try {
        const doc = domAPI.getDocument();
        if (doc) {
          domAPI.dispatchEvent(doc, new CustomEvent('authStateChanged', {
            detail: {
              authenticated,
              user: userObject,
              timestamp: Date.now(),
              source: source + '_via_auth_module'
            }
          }));
        }
      } catch (err) {
        // Use errorReporter to capture the error with context (following requirement #8)
        if (errorReporter?.capture) {
          errorReporter.capture(err, {
            module: MODULE_CONTEXT,
            method: 'broadcastAuth',
            extra: { message: 'Failed to dispatch authStateChanged on document' }
          });
        }

        authNotify.warn('[Auth] Failed to dispatch authStateChanged on document', {
          error: err,
          group: true,
          source: 'broadcastAuth',
          context: MODULE_CONTEXT
        });
      }
    }
  }

  async function clearTokenState(options = { source: 'unknown', isError: false }) {
    authNotify.info(`[Auth] Clearing auth state. Source: ${options.source}`, { group: true, source: 'clearTokenState' });
    logCookieState('after clear');
    broadcastAuth(false, null, `clearTokenState:${options.source}`); // Pass null for userObject
  }

  // --- Verification & Auto-Refresh
  async function verifyAuthState(forceVerify = false) {
    if (authCheckInProgress && !forceVerify) return authState.isAuthenticated;
    authCheckInProgress = true;
    try {
      logCookieState('before verify');
      try {
        let response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
        // If backend sent plain text, attempt JSON parse
        if (typeof response === 'string') {
          try {
            response = JSON.parse(response);
          } catch (parseErr) {
            // Use errorReporter to capture the error with context
            if (errorReporter?.capture) {
              errorReporter.capture(parseErr, {
                module: MODULE_CONTEXT,
                method: 'verifyAuthState',
                extra: { message: 'Failed to parse response as JSON, keeping as string' }
              });
            }
            /* keep as string */
          }
        }

        // --- DISPLAY RAW RESPONSE IN DOM FOR DEBUGGING ---
        try {
          let debugEl = domAPI.getElementById('authVerifyResponseDebug');
          if (!debugEl) {
            debugEl = domAPI.createElement('pre');
            debugEl.id = 'authVerifyResponseDebug';
            Object.assign(debugEl.style, {
              position: 'fixed',
              bottom: '0',
              left: '0',
              right: '0',
              maxHeight: '200px',
              overflowY: 'scroll',
              backgroundColor: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '10px',
              zIndex: '99999',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            });
            const body = domAPI.getBody();
            if (body) {
                domAPI.appendChild(body, debugEl);
            } else {
                authNotify.error("Could not find body to append debug element for auth verify response.", {
                  module: MODULE_CONTEXT,
                  context: 'verifyAuthState',
                  source: 'debugDisplay'
                });
            }
          }
          if (debugEl) {
            const timestamp = new Date().toISOString();
            const newContent = `[${timestamp}] /api/auth/verify response:\n${JSON.stringify(response, null, 2)}\n\n`;
            // Prepend new content to keep the latest at the top
            debugEl.textContent = newContent + (debugEl.textContent || "");
          }
        } catch (e) {
          // Use errorReporter to capture the error with context
          if (errorReporter?.capture) {
            errorReporter.capture(e, {
              module: MODULE_CONTEXT,
              method: 'verifyAuthState',
              extra: { message: 'Error displaying auth verify debug info in DOM' }
            });
          }

          authNotify.error("Error displaying auth verify debug info in DOM", {
            module: MODULE_CONTEXT,
            context: 'verifyAuthState',
            source: 'debugDisplay',
            originalError: e
          });
        }
        // --- END DOM DEBUG DISPLAY ---

        // -----------------------------
        // NUEVA lógica de verificación
        // -----------------------------
        // El backend puede devolver distintos campos; consideramos autenticado si
        //  • authenticated === true            (camelCase)
        //  • is_authenticated === true         (snake_case)
        //  • existe un objeto 'user' con un 'id'
        // Si se detecta usuario, lo extraemos para difundirlo.

        let userObject = null;
        // Ensure response itself is an object before trying to access properties
        if (response && typeof response === 'object') {
            if (response.user && typeof response.user === 'object' && response.user.id) {
              userObject = response.user;
            } else if (response.id && response.username) {
              // Handle cases where the response itself is the user object
              userObject = response;
            }
        }


        const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';

        // Attempt to extract a valid userObject and ensure it has a usable ID
        let finalUserObject = null;
        let userIdFromObject = null;

        authNotify.info('[Auth Verify] Step 1: userObject before processing:', { group: true, source: 'verifyAuthStateSteps', userObject: JSON.stringify(userObject) });

        if (userObject) {
            // Try common ID field names
            userIdFromObject = userObject.id || userObject.user_id || userObject.userId || userObject._id;
            authNotify.info('[Auth Verify] Step 2: userIdFromObject extracted:', { group: true, source: 'verifyAuthStateSteps', userIdFromObject: String(userIdFromObject) });
            if (userIdFromObject) {
                // If an ID was found, ensure the userObject has a consistent 'id' property for downstream use
                finalUserObject = { ...userObject, id: userIdFromObject };
                authNotify.info('[Auth Verify] Step 3: finalUserObject created:', { group: true, source: 'verifyAuthStateSteps', finalUserObject: JSON.stringify(finalUserObject) });
            } else {
                authNotify.warn('[Auth Verify] Step 3: userIdFromObject was falsy, finalUserObject not created from userObject.', { group: true, source: 'verifyAuthStateSteps' });
            }
        } else {
            authNotify.warn('[Auth Verify] Step 1: userObject was falsy.', { group: true, source: 'verifyAuthStateSteps' });
        }

        const isAuthenticatedBasedOnValidUserObjectWithId = !!(finalUserObject && finalUserObject.id);
        authNotify.info('[Auth Verify] Step 4: isAuthenticatedBasedOnValidUserObjectWithId:', { group: true, source: 'verifyAuthStateSteps', value: isAuthenticatedBasedOnValidUserObjectWithId });


        if (isAuthenticatedBasedOnValidUserObjectWithId) {
            authNotify.info('[Auth] verifyAuthState: authenticated with valid user object and ID', { group: true, source: 'verifyAuthState', userObject: finalUserObject });
            broadcastAuth(true, finalUserObject, 'verify_success_with_user_id');
            return true;
        } else {
            authNotify.warn('[Auth Verify] Condition (isAuthenticatedBasedOnValidUserObjectWithId) is FALSE. Checking flags.', { group: true, source: 'verifyAuthStateSteps' });
            // Check flags only if we couldn't establish auth via a user object with a recognized ID
            const isAuthenticatedByFlags = truthy(response?.authenticated) || truthy(response?.is_authenticated);
            authNotify.info('[Auth Verify] Step 5: isAuthenticatedByFlags:', { group: true, source: 'verifyAuthStateSteps', value: isAuthenticatedByFlags, rawAuthFlag: String(response?.authenticated), rawIsAuthFlag: String(response?.is_authenticated) });
            if (isAuthenticatedByFlags) {
                // Backend reports authenticated but didn't include a detailed user object.
                // Accept authentication state and continue with minimal info instead of forcing logout.
                authNotify.warn('[Auth] verifyAuthState: Authenticated=true but no usable user object provided. Proceeding with authenticated session with anonymous user.', {
                    group: true,
                    source: 'verifyAuthState',
                    responseData: response
                });
                // Keep userObject as null; consumers should handle missing user details gracefully.
                broadcastAuth(true, null, 'verify_success_flags_only_no_user');
                return true;
            } else {
                // Not authenticated by any means (no valid user object with ID, and no positive auth flags)
                authNotify.error('[Auth Verify] Setting auth to FALSE: No valid user object and no positive auth flags.', { group: true, source: 'verifyAuthState', responseData: response });
                await clearTokenState({ source: 'verify_negative_no_flags_no_user' });
                broadcastAuth(false, null, 'verify_negative_no_flags_no_user_EXPLICIT_LOG');
                return false;
            }
        }
      } catch (error) {
        // Use errorReporter to capture the error with context
        if (errorReporter?.capture) {
          errorReporter.capture(error, {
            module: MODULE_CONTEXT,
            method: 'verifyAuthState',
            extra: { message: 'Error in verifyAuthState', status: error.status }
          });
        }

        authNotify.warn('[Auth] verifyAuthState error: ' + (error?.message || error), { group: true, source: 'verifyAuthState' });
        if (error.status === 500) {
          authNotify.error('[Auth Verify] Setting auth to FALSE: 500 error from verify endpoint.', { group: true, source: 'verifyAuthState', originalError: error });
          await clearTokenState({ source: 'verify_500_error' });
          broadcastAuth(false, null, 'verify_500_error_EXPLICIT_LOG');
          return false;
        }
        if (error.status === 401) {
          try {
            authNotify.info('[Auth] verifyAuthState: 401 received, attempting token refresh.', { group: true, source: 'verifyAuthState' });
            await refreshTokens();
            return await verifyAuthState(true); // Re-verify after refresh
          }
          catch (refreshErr) {
            // Use errorReporter to capture the error with context
            if (errorReporter?.capture) {
              errorReporter.capture(refreshErr, {
                module: MODULE_CONTEXT,
                method: 'verifyAuthState',
                extra: { message: 'Token refresh failed after 401' }
              });
            }

            authNotify.error('[Auth Verify] Setting auth to FALSE: Token refresh failed after 401.', { group: true, source: 'verifyAuthState', originalError: refreshErr });
            await clearTokenState({ source: 'refresh_failed_after_401' });
            broadcastAuth(false, null, 'refresh_failed_after_401_EXPLICIT_LOG');
            return false;
          }
        }
        // For other errors, maintain current auth state but log it. Or decide to clear.
        // Defaulting to false if error is not a 401 or 500 that's handled.
        authNotify.error(`[Auth Verify] Setting auth to FALSE: Unhandled error status ${error.status}.`, { group: true, source: 'verifyAuthState', originalError: error });
        // To be safe, if verification fails unexpectedly, consider it unauthenticated.
        await clearTokenState({ source: `verify_unhandled_error_${error.status}` });
        broadcastAuth(false, null, `verify_unhandled_error_${error.status}_EXPLICIT_LOG`);
        return false;
        }
    } catch (outerErr) {
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(outerErr, {
          module: MODULE_CONTEXT,
          method: 'verifyAuthState',
          extra: { forceVerify }
        });
      }

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
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(error, {
          module: MODULE_CONTEXT,
          method: 'loginUser',
          extra: { username }
        });
      }

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
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(err, {
          module: MODULE_CONTEXT,
          method: 'logout',
          extra: { message: 'Backend logout call failed' }
        });
      }

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
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(error, {
          module: MODULE_CONTEXT,
          method: 'registerUser',
          extra: { username: userData.username }
        });
      }

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
        // Prevent native form submission → avoids page reload
        loginForm.setAttribute('novalidate', 'novalidate');
        loginForm.removeAttribute('action');
        loginForm.removeAttribute('method');
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
            // Use errorReporter to capture the error with context
            if (errorReporter?.capture) {
              errorReporter.capture(error, {
                module: MODULE_CONTEXT,
                method: 'loginFormHandler',
                extra: { username }
              });
            }

            let msg;
            if (error.status === 401) msg = 'Incorrect username or password.';
            else if (error.status === 400) msg = (error.data && error.data.detail) || 'Invalid login request.';
            else msg = (error.data && error.data.detail) || error.message || 'Login failed due to server error.';
            showError(errorEl, msg);
          } finally {
            setButtonLoading(submitBtn, false, "Login");
          }
        };
        registeredListeners.push(eventHandlers.trackListener(loginForm, 'submit', handler, {
          passive: false,
          context: MODULE_CONTEXT,
          description: 'Login Form Submit'
        }));
      }
    });
    const registerModalForm = domAPI.getElementById('registerModalForm');
    if (registerModalForm && !registerModalForm._listenerAttached) {
      registerModalForm._listenerAttached = true;
      registerModalForm.setAttribute('novalidate', 'novalidate');
      registerModalForm.removeAttribute('action');
      registerModalForm.removeAttribute('method');
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
          // Use errorReporter to capture the error with context
          if (errorReporter?.capture) {
            errorReporter.capture(error, {
              module: MODULE_CONTEXT,
              method: 'registerFormHandler',
              extra: { username }
            });
          }

          let msg;
          if (error.status === 409) msg = 'A user with that username already exists.';
          else if (error.status === 400) msg = (error.data && error.data.detail) || 'Invalid registration data.';
          else msg = (error.data && error.data.detail) || error.message || 'Registration failed due to server error.';
          showError(errorEl, msg);
        } finally {
          setButtonLoading(submitBtn, false, "Register");
        }
      };
      registeredListeners.push(eventHandlers.trackListener(registerModalForm, 'submit', handler, {
        passive: false,
        context: MODULE_CONTEXT,
        description: 'Register Form Submit'
      }));
    }
  }

  // --- Auth Event Monitoring ---
  AuthBus.addEventListener('authStateChanged', e => authNotify.debug('[AUTH_EVENT]', { detail: e.detail, source: 'AuthBus' }));

  // --- Module Initialization
  async function init() {
    // Debug: log presence of cookies at module init
    const cookieStr = domAPI.getAttribute ? domAPI.getAttribute(domAPI.getDocument(), 'cookie') : '';
    if (cookieStr) {
      const hasAccess = cookieStr.includes('access_token');
      const hasRefresh = cookieStr.includes('refresh_token');
      authNotify.info(`[Auth][DEBUG] Cookie presence at init: access_token=${hasAccess}, refresh_token=${hasRefresh}`, { group: true, source: 'init' });
    }

    // Prevent multiple initializations
    if (authState.isReady) {
      authNotify.warn('[Auth] init called multiple times.', { group: true, source: 'init' });
      // Even if already initialized, broadcast current state to ensure all components are in sync
      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_already_ready');
      return authState.isAuthenticated;
    }

    authNotify.info('[Auth] Initializing auth module...', { group: true, source: 'init' });

    // Setup auth forms and ensure they're properly initialized when modals are loaded
    setupAuthForms();
    if (eventHandlers.trackListener) {
      // Use domAPI.getDocument() instead of document directly
      eventHandlers.trackListener(domAPI.getDocument(), 'modalsLoaded', setupAuthForms, {
        context: MODULE_CONTEXT,
        description: 'Auth Modals Loaded Listener'
      });
    }

    try {
      // First, ensure we have a CSRF token
      try {
        await getCSRFTokenAsync();
        authNotify.debug('[Auth] CSRF token obtained successfully', { group: true, source: 'init' });
      } catch (csrfErr) {
        // Use errorReporter to capture the error with context
        if (errorReporter?.capture) {
          errorReporter.capture(csrfErr, {
            module: MODULE_CONTEXT,
            method: 'init',
            extra: { message: 'Failed to get CSRF token, but continuing initialization' }
          });
        }

        authNotify.warn('[Auth] Failed to get CSRF token, but continuing initialization', {
          error: csrfErr,
          group: true,
          source: 'init'
        });
        // Continue initialization even if CSRF token fetch fails
      }

      // Verify authentication state
      let verified = false;
      try {
        verified = await verifyAuthState(true);
        authNotify.info(`[Auth] Initial verification complete: authenticated=${verified}`, {
          group: true,
          source: 'init'
        });
      } catch (verifyErr) {
        // Use errorReporter to capture the error with context
        if (errorReporter?.capture) {
          errorReporter.capture(verifyErr, {
            module: MODULE_CONTEXT,
            method: 'init',
            extra: { message: 'Initial verification failed, treating as unauthenticated' }
          });
        }

        authNotify.error('[Auth] Initial verification failed, treating as unauthenticated', {
          error: verifyErr,
          group: true,
          source: 'init'
        });
        // Set to unauthenticated if verification fails
        await clearTokenState({ source: 'init_verify_error', isError: true });
        verified = false;
      }

      // Set up periodic verification
      verifyInterval = setInterval(() => {
        if (!domAPI.isDocumentHidden() && authState.isAuthenticated) {
          verifyAuthState(false).catch(e => {
            authNotify.warn('[Auth] verifyAuthState periodic error: ' + (e?.message || e), {
              group: true,
              source: 'verifyAuthState'
            });
          });
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);

      // Mark as ready and broadcast events
      authState.isReady = true;

      // Dispatch authReady event on both AuthBus and document
      const readyEventDetail = {
        authenticated: authState.isAuthenticated,
        user: authState.userObject,
        username: authState.username,
        error: null,
        timestamp: Date.now(),
        source: 'init_complete'
      };

      AuthBus.dispatchEvent(new CustomEvent('authReady', { detail: readyEventDetail }));

      try {
        // Use domAPI to dispatch event instead of document directly
        const doc = domAPI.getDocument();
        if (doc) {
          domAPI.dispatchEvent(doc, new CustomEvent('authReady', { detail: readyEventDetail }));
        }
      } catch (docErr) {
        // Use errorReporter to capture the error with context
        if (errorReporter?.capture) {
          errorReporter.capture(docErr, {
            module: MODULE_CONTEXT,
            method: 'init',
            extra: { message: 'Failed to dispatch authReady on document' }
          });
        }

        authNotify.warn('[Auth] Failed to dispatch authReady on document', {
          error: docErr,
          group: true,
          source: 'init'
        });
      }

      // Ensure a final broadcast of auth state
      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_complete');

      return verified;
    } catch (err) {
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(err, {
          module: MODULE_CONTEXT,
          method: 'init',
          extra: { message: 'Unhandled error during initialization' }
        });
      }

      authNotify.error('[Auth] Unhandled error during initialization: ' + (err?.stack || err), {
        group: true,
        source: 'init'
      });

      // Ensure we're in a clean state
      await clearTokenState({ source: 'init_unhandled_error', isError: true });

      // Even if there's an error, mark as ready to prevent hanging
      authState.isReady = true;

      // Broadcast unauthenticated state
      broadcastAuth(false, null, 'init_unhandled_error');

      // Rethrow for upstream handling
      throw err;
    }
  }

  // --- Cleanup (Listeners & Interval Removal)
  function cleanup() {
    authNotify.info('[Auth] cleanup called.', { group: true, source: 'cleanup' });
    // Use context-specific cleanup
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === 'function') {
        DependencySystem.cleanupModuleListeners(MODULE_CONTEXT);
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
        eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
    registeredListeners.length = 0; // Array should be empty if all listeners were context-tracked
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
      if (!resp) return null;

      // Align with verifyAuthState logic for user object extraction, including flexible ID field checking
      let userToReturn = null;
      let userId = null;

      if (resp.user && typeof resp.user === 'object') { // Handles { user: { ... } }
        userId = resp.user.id || resp.user.user_id || resp.user.userId || resp.user._id;
        if (userId) {
          userToReturn = { ...resp.user, id: userId };
        }
      } else if (typeof resp === 'object' && resp.username) { // Handles flat structure { id: ..., username: ... }
        userId = resp.id || resp.user_id || resp.userId || resp._id;
        if (userId) {
          userToReturn = { ...resp, id: userId };
        }
      }

      if (userToReturn) {
        return userToReturn;
      }

      authNotify.warn('[Auth] fetchCurrentUser: User object in response not recognized or essential ID field missing.', { group: true, source: 'fetchCurrentUser', responseData: resp });
      return null;
    } catch (error) {
      // Use errorReporter to capture the error with context
      if (errorReporter?.capture) {
        errorReporter.capture(error, {
          module: MODULE_CONTEXT,
          method: 'fetchCurrentUser',
          extra: { endpoint: apiEndpoints.AUTH_VERIFY }
        });
      }

      authNotify.error('[Auth] fetchCurrentUser API call failed.', { group: true, source: 'fetchCurrentUser', originalError: error });
      return null;
    }
  }

  const publicAuth = {
    isAuthenticated: () => authState.isAuthenticated,
    // getCurrentUser should ideally return the full user object or specific fields as needed.
    // For now, it can return the username for compatibility, but other parts of app rely on app.state.currentUser.
    getCurrentUser: () => authState.username, // Kept for simple username access
    getCurrentUserObject: () => authState.userObject, // New method to get the full object
    isReady: () => authState.isReady,
    init,
    login: loginUser,
    logout,
    register: registerUser,
    verifyAuthState,
    AuthBus,
    getCSRFTokenAsync,
    getCSRFToken,
    hasAuthCookies: () => {
      // Use domAPI to access cookies instead of document directly
      const cookieStr = domAPI.getAttribute ? domAPI.getAttribute(domAPI.getDocument(), 'cookie') : '';
      return cookieStr && (cookieStr.includes('access_token') || cookieStr.includes('refresh_token'));
    },
    cleanup,
    fetchCurrentUser
  };

  return publicAuth;
}
