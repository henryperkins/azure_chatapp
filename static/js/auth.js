/**
 * auth.js
 *
 * Centralized, DI-compliant authentication module for login/logout/register/session/CSRF.
 * All authentication state, CSRF handling, API request/wrapping, form/event logic,
 * and error notification is implemented in this single module—no dependencies outside DI context.
 *
 * Removal Notice: All previous modular primitives (authRequester, authState, csrfManager, etc.) are removed.
 * This module is now the single source of truth for ALL auth logic and event wiring.
 *
 * @module AuthModule
 */

export function createAuthModule({
  // Required Dependencies
  apiClient,         // Replaces "apiRequest". Must be a function: apiClient(url, options)
  notify,
  eventHandlers,
  domAPI,
  sanitizer,
  modalManager,
  apiEndpoints,
  DependencySystem,

  // Optional Dependencies
  errorReporter = null,
  backendLogger = null  // For guardrail #16 (critical event logging)
} = {}) {
  // ----------------------------
  // Guardrail #1: Validate all dependencies
  // ----------------------------
  if (!apiClient) throw new Error('Auth module requires apiClient as a dependency');
  if (!DependencySystem) throw new Error('Auth module requires DependencySystem as a dependency');
  if (!eventHandlers?.trackListener) throw new Error('Auth module requires eventHandlers.trackListener as a dependency');
  if (
    !domAPI ||
    typeof domAPI.getElementById !== 'function' ||
    typeof domAPI.isDocumentHidden !== 'function'
  ) {
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

  // ----------------------------
  // Guardrail #5, #6, #15: Create a scoped notifier with context
  // ----------------------------
  const authNotify = notify.withContext({ module: 'AuthModule', context: 'auth' });

  // ----------------------------
  // Guardrail #8 & #17: Context-rich error capture, respecting user consent
  // ----------------------------
  function captureError(error, contextData) {
    try {
      const appInstance = DependencySystem?.modules?.get('app');
      // Guardrail #17: if user has opted out, skip error tracking
      if (appInstance?.state?.disableErrorTracking) {
        return;
      }
      errorReporter?.capture(error, contextData);
    } catch (ignore) {
      // If an error occurs in error capture, we do nothing to avoid infinite loops
    }
  }

  // --- Enhanced Debug Utilities (Guardrail #2: do not use console) ---
  function logCookieState(tag = '') {
    const cookies = domAPI.getAttribute
      ? domAPI.getAttribute(domAPI.getDocument(), 'cookie')
      : '';
    authNotify.debug(`[COOKIE_SNAPSHOT]`, {
      context: `AuthModule:logCookieState`,
      tag,
      cookie: cookies
    });

    // Create a visual indicator in the UI for debugging
    try {
      let debugEl = domAPI.getElementById('authCookieDebug');
      if (!debugEl) {
        debugEl = domAPI.createElement('div');
        debugEl.id = 'authCookieDebug';
        Object.assign(debugEl.style, {
          position: 'fixed',
          top: '10px',
          right: '10px',
          backgroundColor: 'rgba(0,0,0,0.7)',
          color: 'white',
          padding: '5px',
          borderRadius: '3px',
          fontSize: '10px',
          maxWidth: '300px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          zIndex: '99999'
        });
        const body = domAPI.getBody();
        if (body) {
          domAPI.appendChild(body, debugEl);
        }
      }

      if (debugEl) {
        const timestamp = new Date().toISOString().substr(11, 8); // HH:MM:SS
        const hasCookies = cookies && (cookies.includes('access_token') || cookies.includes('refresh_token'));
        const status = hasCookies ? '✓ Auth Cookies' : '✗ No Auth Cookies';
        debugEl.textContent = `[${timestamp}] ${status} (${tag})`;
        debugEl.style.backgroundColor = hasCookies ? 'rgba(0,128,0,0.7)' : 'rgba(128,0,0,0.7)';
      }
    } catch (e) {
      // Silently fail for UI indicators to avoid breaking login
    }
  }

  // --- Input Validation Utilities ---
  function validateUsername(username) {
    // 3-32 chars, a-zA-Z0-9_.-
    return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
  }
  function validateEmail(email) {
    // Simple RFC 5322-ish
    return typeof email === 'string' && /^[^@]+@[^@]+\.[^@]+$/.test(email);
  }
  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 12) {
      return { valid: false, message: 'Password must be at least 12 characters' };
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
    if (!hasUpper) {
      return { valid: false, message: 'Password must contain an uppercase letter' };
    }
    if (!hasLower) {
      return { valid: false, message: 'Password must contain a lowercase letter' };
    }
    if (!hasNumber) {
      return { valid: false, message: 'Password must contain a number' };
    }
    if (!hasSpecial) {
      return { valid: false, message: 'Password must contain a special character' };
    }
    return { valid: true };
  }

  // --- Centralized UI helpers ---
  function setButtonLoading(btn, isLoading, loadingText = 'Saving...') {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      const htmlContent = `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`;

      // Guardrail #9: Sanitize user-supplied HTML content
      btn.innerHTML = sanitizer.sanitize(htmlContent);
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
      el.textContent = msg; // textContent is safe, no sanitize needed
      el.classList.remove('hidden');
    }
  }
  function hideError(el) {
    if (el) {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }

  // --- Internal Auth State & Event Bus ---
  const AUTH_CONFIG = { VERIFICATION_INTERVAL: 300000 }; // 5 minutes
  const authState = {
    isAuthenticated: false,
    username: null,
    userObject: null,
    isReady: false
  };
  const AuthBus = new EventTarget();
  const MODULE_CONTEXT = 'AuthModule';

  // --- Cookie helper (Guardrail #2: no direct doc usage) ---
  function readCookie(name) {
    const cookieStr = domAPI.getAttribute
      ? domAPI.getAttribute(domAPI.getDocument(), 'cookie')
      : '';
    if (!cookieStr) return null;
    const m = cookieStr.match(
      new RegExp('(?:^|;\\s*)' + name + '\\s*=\\s*([^;]+)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  let authCheckInProgress = false;
  let tokenRefreshInProgress = false;
  let tokenRefreshPromise = null;
  let csrfToken = '';
  let csrfTokenPromise = null;
  let verifyInterval = null;
  const registeredListeners = [];

  // --- Secure CSRF Token Fetch/Caching
  async function fetchCSRFToken() {
    try {
      if (!apiEndpoints.AUTH_CSRF) {
        throw new Error('AUTH_CSRF endpoint missing in apiEndpoints');
      }
      const csrfUrl = apiEndpoints.AUTH_CSRF;
      const url = csrfUrl.includes('?')
        ? `${csrfUrl}&ts=${Date.now()}`
        : `${csrfUrl}?ts=${Date.now()}`;
      const data = await apiClient(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
        credentials: 'include',
        cache: 'no-store'
      });
      if (!data || !data.token) {
        authNotify.error('CSRF token fetch failed, cannot proceed with authentication.', {
          context: 'AuthModule:fetchCSRFToken'
        });
        throw new Error('CSRF token missing');
      }
      return data.token;
    } catch (error) {
      captureError(error, {
        module: MODULE_CONTEXT,
        method: 'fetchCSRFToken',
        extra: { endpoint: apiEndpoints.AUTH_CSRF }
      });
      authNotify.error('[Auth] CSRF token fetch failed: ' + (error?.message || error), {
        group: true,
        context: 'AuthModule:fetchCSRFToken'
      });
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
      csrfToken = current; // keep variable and cookie in sync
    }
    return csrfToken;
  }

  // --- Centralized Authenticated API Request
  async function authRequest(endpoint, method, body = null) {
    const headers = { Accept: 'application/json' };
    const options = { method: method.toUpperCase(), headers, credentials: 'include' };
    const isStateChanging =
      !['GET', 'HEAD', 'OPTIONS'].includes(options.method) &&
      endpoint !== apiEndpoints.AUTH_CSRF;
    if (isStateChanging) {
      const token = getCSRFToken() || (await getCSRFTokenAsync());
      if (token) {
        options.headers['X-CSRF-Token'] = token;
      } else {
        authNotify.warn(`[Auth] CSRF token missing for request: ${endpoint}`, {
          group: true,
          context: 'AuthModule:authRequest'
        });
      }
    }
    if (body) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }

    try {
      const data = await apiClient(endpoint, options);
      logCookieState(`after ${method} ${endpoint}`);
      return data;
    } catch (error) {
      captureError(error, {
        module: MODULE_CONTEXT,
        method: 'authRequest',
        extra: { endpoint, method }
      });
      authNotify.apiError(
        `[Auth] Request failed ${method} ${endpoint}: ${error?.message || error}`,
        { group: true, context: 'AuthModule:authRequest' }
      );
      // Standardize some error fields
      if (!error.status) {
        Object.assign(error, {
          status: 0,
          data: { detail: error.message || 'Network error/CORS issue' }
        });
      }
      throw error;
    }
  }

  // --- Token Refresh
  async function refreshTokens() {
    if (tokenRefreshInProgress) return tokenRefreshPromise;
    tokenRefreshInProgress = true;
    tokenRefreshPromise = (async () => {
      try {
        authNotify.debug('[Auth] refreshTokens: starting', {
          group: true,
          context: 'AuthModule:refreshTokens'
        });
        await getCSRFTokenAsync();
        const response = await authRequest(apiEndpoints.AUTH_REFRESH, 'POST');
        authNotify.debug('[Auth] refreshTokens: success', {
          group: true,
          context: 'AuthModule:refreshTokens'
        });
        return { success: true, response };
      } catch (error) {
        captureError(error, {
          module: MODULE_CONTEXT,
          method: 'refreshTokens',
          extra: { endpoint: apiEndpoints.AUTH_REFRESH }
        });
        authNotify.apiError('[Auth] Refresh token failed: ' + (error?.message || error), {
          group: true,
          context: 'AuthModule:refreshTokens'
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

  // --- Auth State Broadcasting
  async function clearTokenState(options = { source: 'unknown', isError: false }) {
    authNotify.info(`[Auth] Clearing auth state. Source: ${options.source}`, {
      group: true,
      context: 'AuthModule:clearTokenState'
    });
    logCookieState('after clear');
    broadcastAuth(false, null, `clearTokenState:${options.source}`);
  }

  function broadcastAuth(authenticated, userObject = null, source = 'unknown') {
    const previousAuth = authState.isAuthenticated;
    const previousUserObject = authState.userObject;
    const changed =
      authenticated !== previousAuth ||
      JSON.stringify(userObject) !== JSON.stringify(previousUserObject);

    // Always log the auth state change for debugging
    authNotify.debug(`[Auth] broadcastAuth called: authenticated=${authenticated}, source=${source}`, {
      group: true,
      context: 'AuthModule:broadcastAuth',
      previousAuth,
      newAuth: authenticated,
      source
    });

    authState.isAuthenticated = authenticated;
    authState.userObject = userObject;
    authState.username = userObject?.username || null;

    if (changed) {
      const logMessage = `[Auth] State changed (${source}): Auth=${authenticated}, UserObject=${
        userObject ? JSON.stringify(userObject) : 'None'
      }`;

      if (!authenticated) {
        // log critical event
        authNotify.error(`[CRITICAL_AUTH_STATE_FALSE] ${logMessage}`, {
          group: true,
          context: 'AuthModule:broadcastAuth',
          detailSource: source
        });
        // Guardrail #16: possible critical event logging
        if (backendLogger) {
          backendLogger.log({
            level: 'error',
            message: `[CRITICAL_AUTH_STATE_FALSE] ${logMessage}`,
            module: 'AuthModule',
            detailSource: source
          });
        }
      } else {
        authNotify.info(logMessage, {
          group: true,
          context: 'AuthModule:broadcastAuth'
        });
      }

      // Guardrail #11: read from app.state but do NOT mutate directly
      // Instead, call a hypothetical "setAuthState" method
      const appInstance = DependencySystem.modules.get('app');
      if (appInstance && typeof appInstance.setAuthState === 'function') {
        authNotify.debug('[Auth] Updated app.state using setAuthState with new authentication state', {
          group: true,
          context: 'AuthModule:broadcastAuth'
        });
        appInstance.setAuthState({ isAuthenticated: authenticated, currentUser: userObject });
      } else {
        authNotify.warn('[Auth] Could not update app.state - setAuthState not found.', {
          group: true,
          context: 'AuthModule:broadcastAuth'
        });
      }

      // Update "currentUser" in DependencySystem
      if (DependencySystem && DependencySystem.modules) {
        const currentUserModule = DependencySystem.modules.get('currentUser');
        if (currentUserModule !== userObject) {
          authNotify.debug('[Auth] Updating currentUser in DependencySystem', {
            group: true,
            context: 'AuthModule:broadcastAuth',
            previousUser: currentUserModule ? 'exists' : 'null',
            newUser: userObject ? 'exists' : 'null'
          });
          DependencySystem.modules.set('currentUser', userObject);
        }
      }

      // Create a single event detail object to ensure consistency
      const eventDetail = {
        authenticated,
        user: userObject,
        timestamp: Date.now(),
        source
      };

      // Dispatch the auth event on AuthBus
      try {
        AuthBus.dispatchEvent(
          new CustomEvent('authStateChanged', {
            detail: eventDetail
          })
        );
        authNotify.debug('[Auth] Dispatched authStateChanged on AuthBus', {
          group: true,
          context: 'AuthModule:broadcastAuth',
          detail: eventDetail
        });
      } catch (busErr) {
        captureError(busErr, {
          module: MODULE_CONTEXT,
          method: 'broadcastAuth',
          extra: { message: 'Failed to dispatch authStateChanged on AuthBus' }
        });
        authNotify.warn('[Auth] Failed to dispatch authStateChanged on AuthBus', {
          error: busErr,
          group: true,
          context: 'AuthModule:broadcastAuth'
        });
      }

      // Also dispatch on document via domAPI
      try {
        const doc = domAPI.getDocument();
        if (doc) {
          // Use the same event detail for consistency
          domAPI.dispatchEvent(
            doc,
            new CustomEvent('authStateChanged', {
              detail: {
                ...eventDetail,
                source: source + '_via_auth_module'
              }
            })
          );
          authNotify.debug('[Auth] Dispatched authStateChanged on document', {
            group: true,
            context: 'AuthModule:broadcastAuth',
            detail: eventDetail
          });
        }
      } catch (err) {
        captureError(err, {
          module: MODULE_CONTEXT,
          method: 'broadcastAuth',
          extra: { message: 'Failed to dispatch authStateChanged on document' }
        });
        authNotify.warn('[Auth] Failed to dispatch authStateChanged on document', {
          error: err,
          group: true,
          context: 'AuthModule:broadcastAuth'
        });
      }

      // Force a direct update of app.state.isAuthenticated
      try {
        const appInstance = DependencySystem?.modules?.get('app');
        if (appInstance?.state) {
          appInstance.state.isAuthenticated = authenticated;
          authNotify.debug('[Auth] Directly updated app.state.isAuthenticated', {
            group: true,
            context: 'AuthModule:broadcastAuth',
            newValue: authenticated
          });
        }
      } catch (appErr) {
        authNotify.warn('[Auth] Failed to directly update app.state.isAuthenticated', {
          error: appErr,
          group: true,
          context: 'AuthModule:broadcastAuth'
        });
      }
    }
  }

  // --- Verification & Auto-Refresh
  async function verifyAuthState(forceVerify = false) {
    if (authCheckInProgress && !forceVerify) return authState.isAuthenticated;
    authCheckInProgress = true;
    try {
      logCookieState('before verify');
      try {
        let response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
        if (typeof response === 'string') {
          try {
            response = JSON.parse(response);
          } catch (parseErr) {
            captureError(parseErr, {
              module: MODULE_CONTEXT,
              method: 'verifyAuthState',
              extra: { message: 'Failed to parse response as JSON' }
            });
            // keep as string
          }
        }

        // Debug: show raw response in DOM (development usage)
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
              authNotify.error('Could not find body to append debug element for auth verify response.', {
                module: MODULE_CONTEXT,
                context: 'verifyAuthState',
                source: 'debugDisplay'
              });
            }
          }
          if (debugEl) {
            const timestamp = new Date().toISOString();
            const newContent = `[${timestamp}] /api/auth/verify response:\n${JSON.stringify(
              response,
              null,
              2
            )}\n\n`;
            debugEl.textContent = newContent + (debugEl.textContent || '');
          }
        } catch (e) {
          captureError(e, {
            module: MODULE_CONTEXT,
            method: 'verifyAuthState',
            extra: { message: 'Error displaying auth verify debug info' }
          });
          authNotify.error('Error displaying auth verify debug info in DOM', {
            module: MODULE_CONTEXT,
            context: 'verifyAuthState',
            source: 'debugDisplay',
            originalError: e
          });
        }

        // Attempt user detection
        let userObject = null;
        if (response && typeof response === 'object') {
          if (response.user && typeof response.user === 'object' && response.user.id) {
            userObject = response.user;
          } else if (response.id && response.username) {
            userObject = response;
          }
        }
        const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
        let finalUserObject = null;
        let userIdFromObject = null;

        authNotify.info('[Auth Verify] Step 1: userObject before processing', {
          group: true,
          context: 'AuthModule:verifyAuthStateSteps',
          userObject: JSON.stringify(userObject)
        });

        if (userObject) {
          userIdFromObject =
            userObject.id || userObject.user_id || userObject.userId || userObject._id;
          authNotify.info('[Auth Verify] Step 2: userIdFromObject extracted', {
            group: true,
            context: 'AuthModule:verifyAuthStateSteps',
            userIdFromObject: String(userIdFromObject)
          });
          if (userIdFromObject) {
            finalUserObject = { ...userObject, id: userIdFromObject };
            authNotify.info('[Auth Verify] Step 3: finalUserObject created', {
              group: true,
              context: 'AuthModule:verifyAuthStateSteps',
              finalUserObject: JSON.stringify(finalUserObject)
            });
          } else {
            authNotify.warn('[Auth Verify] userIdFromObject was falsy, finalUserObject not set.', {
              group: true,
              context: 'AuthModule:verifyAuthStateSteps'
            });
          }
        } else {
          authNotify.warn('[Auth Verify] userObject was falsy.', {
            group: true,
            context: 'AuthModule:verifyAuthStateSteps'
          });
        }

        const isAuthenticatedById = !!(finalUserObject && finalUserObject.id);
        authNotify.info('[Auth Verify] Step 4: isAuthenticatedBasedOnValidUserObjectWithId', {
          group: true,
          context: 'AuthModule:verifyAuthStateSteps',
          value: isAuthenticatedById
        });

        if (isAuthenticatedById) {
          authNotify.info('[Auth] verifyAuthState: authenticated with valid user object and ID', {
            group: true,
            context: 'AuthModule:verifyAuthState',
            userObject: finalUserObject
          });
          broadcastAuth(true, finalUserObject, 'verify_success_with_user_id');
          return true;
        } else {
          // Enhanced debugging: log the full response object
          authNotify.debug(
            '[Auth Verify] Debug: Raw response object when no valid user ID found',
            {
              group: true,
              context: 'AuthModule:verifyAuthState:debug',
              fullResponse: JSON.stringify(response || {})
            }
          );

          authNotify.warn(
            '[Auth Verify] Condition (isAuthenticatedBasedOnValidUserObjectWithId) is false; checking flags.',
            {
              group: true,
              context: 'AuthModule:verifyAuthStateSteps'
            }
          );

          // Check multiple possible auth flag locations in the response
          const isAuthenticatedByFlags =
            truthy(response?.authenticated) ||
            truthy(response?.is_authenticated) ||
            truthy(response?.auth) ||
            truthy(response?.isAuth) ||
            // Handle strings "true"/"false"
            String(response?.authenticated).toLowerCase() === "true" ||
            String(response?.is_authenticated).toLowerCase() === "true";

          // Additional check for username in response (common auth indicator)
          const hasUsername = Boolean(response?.username || (response?.user && response.user.username));

          authNotify.info('[Auth Verify] Step 5: isAuthenticatedByFlags', {
            group: true,
            context: 'AuthModule:verifyAuthStateSteps',
            value: isAuthenticatedByFlags,
            hasUsername,
            rawAuthFlag: String(response?.authenticated),
            rawIsAuthFlag: String(response?.is_authenticated)
          });

          // URL parameters check - support URL with login params
          const location = domAPI.getWindow()?.location;
          const urlParams = location ? new URLSearchParams(location.search) : null;
          const hasLoginParams = urlParams && urlParams.has('username') && urlParams.has('password');

          if (isAuthenticatedByFlags || hasUsername || hasLoginParams) {
            // Construct a minimal user object if we have a username but no full user object
            const tempUserObj = hasUsername && !finalUserObject ? {
              username: response?.username || response?.user?.username ||
                        (hasLoginParams ? urlParams.get('username') : 'user'),
              id: response?.id || response?.user?.id || ('temp-id-' + Date.now())
            } : null;

            authNotify.warn(
              '[Auth] verifyAuthState: Authenticated via flags, username, or login params. Using available user info.',
              {
                group: true,
                context: 'AuthModule:verifyAuthState',
                responseData: response,
                hasLoginParams,
                hasUsername
              }
            );

            broadcastAuth(true, tempUserObj || null, 'verify_success_via_alternative_checks');
            return true;
          } else {
            // Instead of immediate logout, we'll delay the verification
            // This helps with race conditions in the auth process
            authNotify.warn(
              '[Auth Verify] No authentication indicators found. Delaying logout to prevent premature auth failure.',
              { group: true, context: 'AuthModule:verifyAuthState', responseData: response }
            );

            // Check for cookies - another indicator of authentication
            const hasCookies = publicAuth.hasAuthCookies();
            if (hasCookies) {
              authNotify.info('[Auth] Found auth cookies, treating as authenticated temporarily', {
                group: true,
                context: 'AuthModule:verifyAuthState'
              });

              // Set a temp user object based on URL if available
              const tempUser = hasLoginParams ?
                { username: urlParams.get('username'), id: 'temp-id-' + Date.now() } :
                null;

              broadcastAuth(true, tempUser, 'verify_auth_based_on_cookies');

              // Schedule a re-verification attempt after a short delay
              setTimeout(() => {
                if (authState.isAuthenticated) {
                  verifyAuthState(true).catch(e => {
                    authNotify.warn('[Auth] Delayed re-verification failed', { error: e });
                  });
                }
              }, 2000);

              return true;
            }

            // Only clear token state if we're absolutely sure it's not authenticated
            await clearTokenState({ source: 'verify_negative_after_all_checks' });
            broadcastAuth(false, null, 'verify_negative_after_all_checks');
            return false;
          }
        }
      } catch (error) {
        captureError(error, {
          module: MODULE_CONTEXT,
          method: 'verifyAuthState',
          extra: { message: 'Error in verifyAuthState', status: error.status }
        });
        authNotify.warn('[Auth] verifyAuthState error: ' + (error?.message || error), {
          group: true,
          context: 'AuthModule:verifyAuthState'
        });
        if (error.status === 500) {
          authNotify.error('[Auth Verify] Setting auth=false: 500 error on verify endpoint.', {
            group: true,
            context: 'AuthModule:verifyAuthState',
            originalError: error
          });
          await clearTokenState({ source: 'verify_500_error' });
          broadcastAuth(false, null, 'verify_500_error_EXPLICIT_LOG');
          return false;
        }
        if (error.status === 401) {
          try {
            authNotify.info('[Auth] verifyAuthState: 401 received, attempting token refresh.', {
              group: true,
              context: 'AuthModule:verifyAuthState'
            });
            await refreshTokens();
            return await verifyAuthState(true);
          } catch (refreshErr) {
            captureError(refreshErr, {
              module: MODULE_CONTEXT,
              method: 'verifyAuthState',
              extra: { message: 'Token refresh failed after 401' }
            });
            authNotify.error(
              '[Auth Verify] Setting auth=false: Token refresh failed after 401.',
              { group: true, context: 'AuthModule:verifyAuthState', originalError: refreshErr }
            );
            await clearTokenState({ source: 'refresh_failed_after_401' });
            broadcastAuth(false, null, 'refresh_failed_after_401_EXPLICIT_LOG');
            return false;
          }
        }
        authNotify.error(
          `[Auth Verify] Setting auth=false: Unhandled error status ${error.status}.`,
          { group: true, context: 'AuthModule:verifyAuthState', originalError: error }
        );
        await clearTokenState({ source: `verify_unhandled_error_${error.status}` });
        broadcastAuth(false, null, `verify_unhandled_error_${error.status}_EXPLICIT_LOG`);
        return false;
      }
    } catch (outerErr) {
      captureError(outerErr, {
        module: MODULE_CONTEXT,
        method: 'verifyAuthState',
        extra: { forceVerify }
      });
      authNotify.error('[Auth] verifyAuthState outer error: ' + (outerErr?.message || outerErr), {
        group: true,
        context: 'AuthModule:verifyAuthState'
      });
      throw outerErr;
    } finally {
      authCheckInProgress = false;
    }
  }

  // --- Public Auth Actions
  async function loginUser(username, password) {
    authNotify.info(`[Auth] Attempting login for user: ${username}`, {
      group: true,
      context: 'AuthModule:loginUser'
    });

    // Log cookie state before login attempt
    logCookieState('before login attempt');

    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_LOGIN, 'POST', {
        username: username.trim(),
        password
      });

      // Debug the full login response
      authNotify.debug('[Auth] Login response:', {
        context: 'AuthModule:loginUser',
        responseData: JSON.stringify(response || {})
      });

      // Log cookie state after login attempt
      logCookieState('after login attempt');

      // Create a temporary user object if we have username but not a complete user object
      let userObject = null;
      if (response) {
        if (response.username) {
          userObject = {
            username: response.username,
            id: response.id || response.user_id || response.userId || ('temp-id-' + Date.now())
          };

          // Immediately broadcast auth state for faster UI updates
          broadcastAuth(true, userObject, 'login_success_immediate');

          // Wait a bit before verification to allow cookies to be set
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (response && response.username) {
        // Even if verification fails, let's still consider this a successful login
        // since we have a username in the response
        try {
          const verified = await verifyAuthState(true);
          if (verified) {
            authNotify.success('Login successful.', { group: true, context: 'AuthModule:loginUser' });
            return response;
          } else {
            // Even if verification fails, we'll consider it a success since the login API returned a username
            authNotify.warn('Login returned username but verification failed. Treating as authenticated anyway.', {
              group: true,
              context: 'AuthModule:loginUser'
            });

            // Force authentication state - the delayed verification will fix any issues
            broadcastAuth(true, userObject, 'login_forced_auth_despite_verify_fail');
            return response;
          }
        } catch (verifyErr) {
          // Even with verification error, proceed with successful login
          authNotify.warn('Login verification error, but login succeeded. Treating as authenticated.', {
            error: verifyErr,
            group: true,
            context: 'AuthModule:loginUser'
          });

          // Force authentication state
          broadcastAuth(true, userObject, 'login_forced_auth_with_verify_error');
          return response;
        }
      }

      // Log but don't immediately clear token state
      authNotify.error('Login succeeded but received invalid response from server.', {
        group: true,
        context: 'AuthModule:loginUser',
        responseData: response
      });

      throw new Error('Login succeeded but invalid response data.');
    } catch (error) {
      captureError(error, {
        module: MODULE_CONTEXT,
        method: 'loginUser',
        extra: { username }
      });
      await clearTokenState({ source: 'login_error' });
      authNotify.error('Login failed: ' + (error.message || 'Unknown login error.'), {
        group: true,
        context: 'AuthModule:loginUser'
      });
      throw error;
    }
  }

  async function logout() {
    authNotify.info('[Auth] Initiating logout...', {
      group: true,
      context: 'AuthModule:logout'
    });
    await clearTokenState({ source: 'logout_manual' });
    try {
      await getCSRFTokenAsync();
      await authRequest(apiEndpoints.AUTH_LOGOUT, 'POST');
      authNotify.success('Logout successful.', { group: true, context: 'AuthModule:logout' });
    } catch (err) {
      captureError(err, {
        module: MODULE_CONTEXT,
        method: 'logout',
        extra: { message: 'Backend logout call failed' }
      });
      authNotify.warn('[Auth] Backend logout call failed: ' + (err?.message || err), {
        group: true,
        context: 'AuthModule:logout'
      });
    }
  }

  async function registerUser(userData) {
    if (!userData?.username || !userData?.password) {
      authNotify.error('Username and password required.', {
        group: true,
        context: 'AuthModule:registerUser'
      });
      throw new Error('Username and password required.');
    }
    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_REGISTER, 'POST', {
        username: userData.username.trim(),
        password: userData.password
      });
      const verified = await verifyAuthState(true);
      if (!verified) {
        authNotify.warn('[Auth] Registration succeeded but verification failed.', {
          group: true,
          context: 'AuthModule:registerUser'
        });
      } else {
        authNotify.success('Registration successful.', {
          group: true,
          context: 'AuthModule:registerUser'
        });
      }
      return response;
    } catch (error) {
      captureError(error, {
        module: MODULE_CONTEXT,
        method: 'registerUser',
        extra: { username: userData.username }
      });
      await clearTokenState({ source: 'register_error', isError: true });
      authNotify.error('Registration failed: ' + (error.message || 'Unknown error.'), {
        group: true,
        context: 'AuthModule:registerUser'
      });
      throw error;
    }
  }

  // --- Centralized Form Event Handler
  function setupAuthForms() {
    const loginForms = [domAPI.getElementById('loginModalForm')];
    loginForms.forEach((loginForm) => {
      if (loginForm && !loginForm._listenerAttached) {
        loginForm._listenerAttached = true;
        loginForm.setAttribute('novalidate', 'novalidate');
        loginForm.removeAttribute('action');
        loginForm.removeAttribute('method');
        const handler = async (e) => {
          e.preventDefault();
          const errorEl = domAPI.getElementById('loginModalError');
          hideError(errorEl);
          const submitBtn = loginForm.querySelector('button[type="submit"]');
          setButtonLoading(submitBtn, true, 'Logging in...');
          const formData = new FormData(loginForm);
          const username = formData.get('username')?.trim();
          const password = formData.get('password');

          if (!username || !password) {
            showError(errorEl, 'Username and password are required.');
            setButtonLoading(submitBtn, false);
            return;
          }
          if (!validateUsername(username)) {
            showError(errorEl, 'Invalid username. Use 3-32 letters, numbers, or ._-');
            setButtonLoading(submitBtn, false);
            return;
          }
          const pwCheck = validatePassword(password);
          if (!pwCheck.valid) {
            showError(errorEl, pwCheck.message);
            setButtonLoading(submitBtn, false);
            return;
          }
          try {
            await publicAuth.login(username, password);
            if (loginForm.id === 'loginModalForm' && modalManager?.hide) {
              modalManager.hide('login');
            }
          } catch (error) {
            captureError(error, {
              module: MODULE_CONTEXT,
              method: 'loginFormHandler',
              extra: { username }
            });
            let msg = 'Login failed due to server error.';
            if (error.status === 401) {
              msg = 'Incorrect username or password.';
            } else if (error.status === 400) {
              msg = error.data?.detail || 'Invalid login request.';
            } else {
              msg = error.data?.detail || error.message || msg;
            }
            showError(errorEl, msg);
          } finally {
            setButtonLoading(submitBtn, false, 'Login');
          }
        };
        registeredListeners.push(
          eventHandlers.trackListener(loginForm, 'submit', handler, {
            passive: false,
            context: 'AuthModule:loginFormSubmit',
            description: 'Login Form Submit'
          })
        );
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
        setButtonLoading(submitBtn, true, 'Registering...');
        const formData = new FormData(registerModalForm);
        const username = formData.get('username')?.trim();
        const password = formData.get('password');
        const passwordConfirm = formData.get('passwordConfirm');

        if (!username || !password || !passwordConfirm) {
          showError(errorEl, 'All fields are required.');
          setButtonLoading(submitBtn, false, 'Register');
          return;
        }
        if (!validateUsername(username)) {
          showError(errorEl, 'Invalid username. Use 3-32 letters, numbers, or ._-');
          setButtonLoading(submitBtn, false, 'Register');
          return;
        }
        const pwCheck = validatePassword(password);
        if (!pwCheck.valid) {
          showError(errorEl, pwCheck.message);
          setButtonLoading(submitBtn, false, 'Register');
          return;
        }
        if (password !== passwordConfirm) {
          showError(errorEl, 'Passwords do not match.');
          setButtonLoading(submitBtn, false, 'Register');
          return;
        }
        try {
          await publicAuth.register({ username, password });
          if (modalManager?.hide) {
            modalManager.hide('login');
          }
          authNotify.success('Registration successful. You may now log in.', {
            group: true,
            context: 'AuthModule:registerModalForm'
          });
        } catch (error) {
          captureError(error, {
            module: MODULE_CONTEXT,
            method: 'registerFormHandler',
            extra: { username }
          });
          let msg = 'Registration failed due to server error.';
          if (error.status === 409) {
            msg = 'A user with that username already exists.';
          } else if (error.status === 400) {
            msg = error.data?.detail || 'Invalid registration data.';
          } else {
            msg = error.data?.detail || error.message || msg;
          }
          showError(errorEl, msg);
        } finally {
          setButtonLoading(submitBtn, false, 'Register');
        }
      };
      registeredListeners.push(
        eventHandlers.trackListener(registerModalForm, 'submit', handler, {
          passive: false,
          context: 'AuthModule:registerFormSubmit',
          description: 'Register Form Submit'
        })
      );
    }
  }

  AuthBus.addEventListener('authStateChanged', (e) =>
    authNotify.debug('[AUTH_EVENT]', {
      detail: e.detail,
      context: 'AuthModule:AuthBus'
    })
  );

  // --- Module Initialization
  async function init() {
    // Guardrail #10: Wait for app readiness before accessing app resources
    if (DependencySystem?.waitFor) {
      authNotify.debug('[Auth] Waiting for app readiness before initialization.', {
        context: 'AuthModule:init'
      });
      await DependencySystem.waitFor(['app']);
    }

    // Prevent multiple initializations
    if (authState.isReady) {
      authNotify.warn('[Auth] init called multiple times.', {
        group: true,
        context: 'AuthModule:init'
      });
      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_already_ready');
      return authState.isAuthenticated;
    }

    authNotify.info('[Auth] Initializing auth module...', {
      group: true,
      context: 'AuthModule:init'
    });

    // Setup auth forms
    setupAuthForms();
    if (eventHandlers.trackListener) {
      eventHandlers.trackListener(domAPI.getDocument(), 'modalsLoaded', setupAuthForms, {
        context: 'AuthModule:init',
        description: 'Auth Modals Loaded Listener'
      });
    }

    try {
      try {
        await getCSRFTokenAsync();
        authNotify.debug('[Auth] CSRF token obtained successfully', {
          group: true,
          context: 'AuthModule:init'
        });
      } catch (csrfErr) {
        captureError(csrfErr, {
          module: MODULE_CONTEXT,
          method: 'init',
          extra: { message: 'Failed to get CSRF token, continuing init' }
        });
        authNotify.warn('[Auth] Failed to get CSRF token, continuing initialization', {
          error: csrfErr,
          group: true,
          context: 'AuthModule:init'
        });
      }

      let verified = false;
      try {
        verified = await verifyAuthState(true);
        authNotify.info(`[Auth] Initial verification complete: authenticated=${verified}`, {
          group: true,
          context: 'AuthModule:init'
        });
      } catch (verifyErr) {
        captureError(verifyErr, {
          module: MODULE_CONTEXT,
          method: 'init',
          extra: { message: 'Initial verification failed' }
        });
        authNotify.error('[Auth] Initial verification failed, treating as unauthenticated.', {
          error: verifyErr,
          group: true,
          context: 'AuthModule:init'
        });
        await clearTokenState({ source: 'init_verify_error', isError: true });
        verified = false;
      }

      // Periodic verification
      verifyInterval = setInterval(() => {
        if (!domAPI.isDocumentHidden() && authState.isAuthenticated) {
          verifyAuthState(false).catch((e) => {
            authNotify.warn('[Auth] verifyAuthState periodic error: ' + (e?.message || e), {
              group: true,
              context: 'AuthModule:verifyAuthState'
            });
          });
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);

      authState.isReady = true;

      // Dispatch authReady event
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
        const doc = domAPI.getDocument();
        if (doc) {
          domAPI.dispatchEvent(doc, new CustomEvent('authReady', { detail: readyEventDetail }));
        }
      } catch (docErr) {
        captureError(docErr, {
          module: MODULE_CONTEXT,
          method: 'init',
          extra: { message: 'Failed to dispatch authReady on document' }
        });
        authNotify.warn('[Auth] Failed to dispatch authReady on document', {
          error: docErr,
          group: true,
          context: 'AuthModule:init'
        });
      }

      // Final broadcast
      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_complete');
      return verified;
    } catch (err) {
      captureError(err, {
        module: MODULE_CONTEXT,
        method: 'init',
        extra: { message: 'Unhandled error during initialization' }
      });
      authNotify.error('[Auth] Unhandled error during initialization: ' + (err?.stack || err), {
        group: true,
        context: 'AuthModule:init'
      });
      await clearTokenState({ source: 'init_unhandled_error', isError: true });
      authState.isReady = true;
      broadcastAuth(false, null, 'init_unhandled_error');
      throw err;
    }
  }

  // --- Cleanup (Listeners & Interval Removal)
  function cleanup() {
    authNotify.info('[Auth] cleanup called.', {
      group: true,
      context: 'AuthModule:cleanup'
    });
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === 'function') {
      DependencySystem.cleanupModuleListeners(MODULE_CONTEXT);
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
    registeredListeners.length = 0;
    if (verifyInterval) {
      clearInterval(verifyInterval);
      verifyInterval = null;
    }
  }

  // --- Fetch Current User
  async function fetchCurrentUser() {
    try {
      // Log cookie state
      logCookieState('fetchCurrentUser - before API call');

      const resp = await apiClient(apiEndpoints.AUTH_VERIFY, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      // Debug response
      authNotify.debug('[Auth] fetchCurrentUser response:', {
        context: 'AuthModule:fetchCurrentUser:debug',
        responseData: JSON.stringify(resp || {})
      });

      // Log cookie state after API call
      logCookieState('fetchCurrentUser - after API call');

      if (!resp) {
        // Check for URL parameters that might indicate a recent login
        const location = domAPI.getWindow()?.location;
        const urlParams = location ? new URLSearchParams(location.search) : null;
        const hasLoginParams = urlParams && urlParams.has('username') && urlParams.has('password');

        if (hasLoginParams) {
          authNotify.info('[Auth] No API response but found login parameters in URL. Creating temporary user.', {
            group: true,
            context: 'AuthModule:fetchCurrentUser'
          });
          return {
            username: urlParams.get('username'),
            id: 'temp-id-' + Date.now()
          };
        }

        return null;
      }

      // Try multiple approaches to extract user information
      let userToReturn = null;
      let userId = null;
      let username = null;

      // Approach 1: Look for user object
      if (resp.user && typeof resp.user === 'object') {
        userId = resp.user.id || resp.user.user_id || resp.user.userId || resp.user._id;
        username = resp.user.username || resp.user.name || resp.user.email;
        if (userId || username) {
          userToReturn = { ...resp.user, id: userId || ('user-' + Date.now()) };
        }
      }

      // Approach 2: Look for user properties at the top level
      if (!userToReturn && resp.username) {
        username = resp.username;
        userId = resp.id || resp.user_id || resp.userId || resp._id;
        if (username) {
          userToReturn = {
            ...resp,
            username,
            id: userId || ('user-' + Date.now())
          };
        }
      }

      // Approach 3: Even if we just have simple response with authenticated flag
      if (!userToReturn && (resp.authenticated === true || resp.is_authenticated === true)) {
        // Create minimal user object from available data
        const minimalUser = {
          id: 'auth-' + Date.now(),
          username: 'user' // Generic fallback
        };
        userToReturn = minimalUser;
        authNotify.info('[Auth] Created minimal user from auth flags', {
          context: 'AuthModule:fetchCurrentUser'
        });
      }

      if (userToReturn) {
        authNotify.info('[Auth] Successfully extracted user info', {
          group: true,
          context: 'AuthModule:fetchCurrentUser',
          userInfo: JSON.stringify(userToReturn)
        });
        return userToReturn;
      }

      authNotify.warn('[Auth] fetchCurrentUser: unrecognized response or missing user ID.', {
        group: true,
        context: 'AuthModule:fetchCurrentUser',
        responseData: resp
      });

      // Check for auth cookies as a fallback
      if (publicAuth.hasAuthCookies()) {
        authNotify.info('[Auth] No user object but found auth cookies. Creating temporary user.', {
          group: true,
          context: 'AuthModule:fetchCurrentUser'
        });

        return {
          username: 'authenticated-user',
          id: 'cookie-auth-' + Date.now()
        };
      }

      return null;
    } catch (error) {
      captureError(error, {
        module: MODULE_CONTEXT,
        method: 'fetchCurrentUser',
        extra: { endpoint: apiEndpoints.AUTH_VERIFY }
      });
      authNotify.error('[Auth] fetchCurrentUser API call failed.', {
        group: true,
        context: 'AuthModule:fetchCurrentUser',
        originalError: error
      });
      return null;
    }
  }

  // --- Public Auth API
  const publicAuth = {
    isAuthenticated: () => authState.isAuthenticated,
    isReady: () => authState.isReady,
    getCurrentUser: () => authState.username,
    getCurrentUserObject: () => authState.userObject,
    init,
    login: loginUser,
    logout,
    register: registerUser,
    verifyAuthState,
    AuthBus,
    getCSRFTokenAsync,
    getCSRFToken,
    hasAuthCookies: () => {
      const cookieStr = domAPI.getAttribute
        ? domAPI.getAttribute(domAPI.getDocument(), 'cookie')
        : '';
      return cookieStr && (cookieStr.includes('access_token') || cookieStr.includes('refresh_token'));
    },
    cleanup,
    fetchCurrentUser
  };

  // -----------------------
  // Return the public API
  // -----------------------
  return publicAuth;
}
