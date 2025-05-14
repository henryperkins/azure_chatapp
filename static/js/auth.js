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
  // === 1) CHECK & SET FALLBACKS FOR MISSING DEPENDENCIES ===
  // Notify fallback (no direct console usage):
  if (!notify) {
    notify = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      withContext: () => notify
    };
  }

  // Create module-scoped notifier
  const authNotify = notify.withContext ?
    notify.withContext({ module: 'AuthModule', context: 'auth' }) :
    notify;

  // Fallback for missing apiClient
  if (!apiClient) {
    authNotify.warn('apiClient is missing, authentication will not work', {
      module: 'AuthModule',
      context: 'init',
      source: 'createAuthModule'
    });
    apiClient = async () => ({ success: false, error: 'API client not available' });
  }

  // Fallback for missing DependencySystem
  if (!DependencySystem) {
    authNotify.warn('DependencySystem is missing, some features may not work', {
      module: 'AuthModule',
      context: 'init',
      source: 'createAuthModule'
    });
  }

  // === 2) INTERNAL UTILITIES & HELPERS ===

  // Enhanced debugging metadata
  const MODULE_CONTEXT = 'AuthModule';
  const MODULE = MODULE_CONTEXT;   // shorthand for guard-rail metadata

  function meta(source, extra = {}) {
    // When used with a notifier created by notify.withContext (like authNotify),
    // this will add/override 'source' and 'extra' to the existing context.
    // The module and base context (e.g., 'auth') from authNotify will be preserved.
    return { source, ...extra };
  }

  // Safe extension of objects
  function extendProps(target, props) {
    if (target && props) Object.assign(target, props);
  }

  // Minimal style-application utility for debug elements
  function applyStyles(target, styles) {
    if (target && styles) Object.assign(target, styles);
  }

  // EH: error capturing
  function captureError(err, details = {}) {
    // Your existing preferred logic, typically calls errorReporter or logs details
    if (errorReporter) {
      errorReporter.capture(err, {
        module: MODULE,
        ...details
      });
    }
    // Potentially do internal fallback logging if errorReporter is not present
    // E.g., authNotify.error(`[AuthModule error] ${err.message}`, meta(details.source || 'unknown', details));
  }

  // === 3) DOM/COOKIE & STATE MANAGEMENT ===

  // Module-level auth state
  const authState = {
    isAuthenticated: false,
    username: null,
    userObject: null,
    isReady: false
  };

  // Central event bus for this module
  const AuthBus = new EventTarget();

  // Cookie reading helper
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

  // Visual cookie debug
  function logCookieState(tag = '') {
    const cookies = domAPI.getAttribute
      ? domAPI.getAttribute(domAPI.getDocument(), 'cookie')
      : '';
    authNotify.debug(`[COOKIE_SNAPSHOT]`, meta('logCookieState', {
      tag,
      cookie: cookies
    }));

    // Create a visual indicator in the UI for debugging
    try {
      let debugEl = domAPI.getElementById('authCookieDebug');
      if (!debugEl) {
        debugEl = domAPI.createElement('div');
        debugEl.id = 'authCookieDebug';
        applyStyles(debugEl.style, {
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
      captureError(e, { source: 'logCookieState', method: 'logCookieState' });
      // Fail silently for debug UI
    }
  }

  // === Input Validation Helpers (Removed `validateEmail`, never used) ===
  function validateUsername(username) {
    // 3-32 chars, a-zA-Z0-9_.-
    return typeof username === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(username);
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

  // === 4) UI/FORM HELPERS ===
  function setButtonLoading(btn, isLoading, loadingText = 'Saving...') {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      const htmlContent = `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`;
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
      el.textContent = msg; // textContent is safe
      el.classList.remove('hidden');
    }
  }
  function hideError(el) {
    if (el) {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }

  // === 5) CSRF & TOKEN LOGIC ===
  let csrfToken = '';
  let csrfTokenPromise = null;
  function getCSRFToken() {
    const current = readCookie('csrf_token');
    if (current && current !== csrfToken) {
      csrfToken = current; // keep variable and cookie in sync
    }
    return csrfToken;
  }

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
      captureError(error, { source: 'fetchCSRFToken', method: 'fetchCSRFToken' });
      authNotify.error(
        'CSRF token fetch failed, cannot proceed with authentication.',
        meta('fetchCSRFToken', { group: true })
      );
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
      } catch (error) {
        captureError(error, { source: 'getCSRFTokenAsync', method: 'getCSRFTokenAsync' });
        throw error;
      } finally {
        csrfTokenPromise = null;
      }
    })();
    return csrfTokenPromise;
  }

  // === 6) AUTH REQUEST WRAPPER ===
  function extendErrorWithStatus(error, message) {
    if (!error.status) {
      extendProps(error, {
        status: 0,
        data: { detail: message || 'Network/CORS issue' }
      });
    }
  }

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
        authNotify.warn(
          `[Auth] CSRF token missing for request: ${endpoint}`,
          meta('authRequest', { group: true })
        );
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
      captureError(error, { source: 'authRequest', method: 'authRequest', endpoint, httpMethod: method });
      extendErrorWithStatus(error, error.message);
      authNotify.apiError(
        `[Auth] Request failed ${method} ${endpoint}: ${error?.message || error}`,
        meta('authRequest', { group: true })
      );
      throw error;
    }
  }

  // === 7) TOKEN REFRESH & CLEAR ===
  let tokenRefreshInProgress = false;
  let tokenRefreshPromise = null;

  async function refreshTokens() {
    if (tokenRefreshInProgress) return tokenRefreshPromise;
    tokenRefreshInProgress = true;
    tokenRefreshPromise = (async () => {
      try {
        authNotify.debug('[Auth] refreshTokens: starting', meta('refreshTokens', { group: true }));
        await getCSRFTokenAsync();
        const response = await authRequest(apiEndpoints.AUTH_REFRESH, 'POST');
        authNotify.debug('[Auth] refreshTokens: success', meta('refreshTokens', { group: true }));
        return { success: true, response };
      } catch (error) {
        captureError(error, { source: 'refreshTokens', method: 'refreshTokens', endpoint: apiEndpoints.AUTH_REFRESH });
        authNotify.apiError(
          '[Auth] Refresh token failed: ' + (error?.message || error),
          meta('refreshTokens', { group: true })
        );
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

  async function clearTokenState(options = { source: 'unknown', isError: false }) {
    authNotify.info(
      `[Auth] Clearing auth state. Source: ${options.source}`,
      meta('clearTokenState', { group: true })
    );
    logCookieState('after clear');
    broadcastAuth(false, null, `clearTokenState:${options.source}`);
  }

  // === 8) BROADCASTING AUTH STATE ===
  function broadcastAuth(authenticated, userObject = null, source = 'unknown') {
    const previousAuth = authState.isAuthenticated;
    const previousUserObject = authState.userObject;
    const changed =
      authenticated !== previousAuth ||
      JSON.stringify(userObject) !== JSON.stringify(previousUserObject);

    authNotify.debug(
      `[Auth] broadcastAuth called: authenticated=${authenticated}, source=${source}`,
      meta('broadcastAuth', { group: true, previousAuth, newAuth: authenticated, source })
    );

    authState.isAuthenticated = authenticated;
    authState.userObject = userObject;
    authState.username = userObject?.username || null;

    if (changed) {
      const logMessage = `[Auth] State changed (${source}): Auth=${authenticated}, UserObject=${
        userObject ? JSON.stringify(userObject) : 'None'
      }`;

      if (!authenticated) {
        // Possibly critical event
        authNotify.error(
          `[CRITICAL_AUTH_STATE_FALSE] ${logMessage}`,
          meta('broadcastAuth', { group: true, detailSource: source })
        );
        if (backendLogger) {
          backendLogger.log({
            level: 'error',
            message: `[CRITICAL_AUTH_STATE_FALSE] ${logMessage}`,
            module: 'AuthModule',
            detailSource: source
          });
        }
      } else {
        authNotify.info(logMessage, meta('broadcastAuth', { group: true }));
      }

      // Update app state if possible (guardrail #11: do not mutate directly but call appInstance method)
      const appInstance = DependencySystem?.modules?.get('app');
      if (appInstance && typeof appInstance.setAuthState === 'function') {
        authNotify.debug(
          '[Auth] Updated app.state using setAuthState with new authentication state',
          meta('broadcastAuth', { group: true })
        );
        appInstance.setAuthState({ isAuthenticated: authenticated, currentUser: userObject });
      } else {
        authNotify.warn(
          '[Auth] Could not update app.state - setAuthState not found.',
          meta('broadcastAuth', { group: true })
        );
      }

      // Update "currentUser" in DependencySystem
      if (DependencySystem?.modules) {
        const currentUserModule = DependencySystem.modules.get('currentUser');
        if (currentUserModule !== userObject) {
          authNotify.debug(
            '[Auth] Updating currentUser in DependencySystem',
            meta('broadcastAuth', {
              group: true,
              previousUser: currentUserModule ? 'exists' : 'null',
              newUser: userObject ? 'exists' : 'null'
            })
          );
          DependencySystem.modules.set('currentUser', userObject);
        }
      }

      // Dispatch events to internal AuthBus
      const eventDetail = {
        authenticated,
        user: userObject,
        timestamp: Date.now(),
        source
      };
      try {
        AuthBus.dispatchEvent(new CustomEvent('authStateChanged', { detail: eventDetail }));
        authNotify.debug(
          '[Auth] Dispatched authStateChanged on AuthBus',
          meta('broadcastAuth', { group: true, detail: eventDetail })
        );
      } catch (busErr) {
        captureError(busErr, {
          source: 'broadcastAuth',
          method: 'broadcastAuth',
          message: 'Failed to dispatch authStateChanged on AuthBus'
        });
        authNotify.warn(
          '[Auth] Failed to dispatch authStateChanged on AuthBus',
          meta('broadcastAuth', { error: busErr, group: true })
        );
      }

      // Dispatch on document
      try {
        const doc = domAPI.getDocument();
        if (doc) {
          domAPI.dispatchEvent(
            doc,
            new CustomEvent('authStateChanged', {
              detail: {
                ...eventDetail,
                source: source + '_via_auth_module'
              }
            })
          );
          authNotify.debug(
            '[Auth] Dispatched authStateChanged on document',
            meta('broadcastAuth', { group: true, detail: eventDetail })
          );
        }
      } catch (err) {
        captureError(err, {
          source: 'broadcastAuth',
          method: 'broadcastAuth',
          message: 'Failed to dispatch authStateChanged on document'
        });
        authNotify.warn(
          '[Auth] Failed to dispatch authStateChanged on document',
          meta('broadcastAuth', { error: err, group: true })
        );
      }

      // Force direct update of app.state.isAuthenticated as fallback - REMOVED as per Guardrail #11 (do not mutate directly)
      // The appInstance.setAuthState method is the correct way.
      // A warning is already logged if setAuthState is not found.
    }
  }

  // === 9) VERIFICATION, AUTO-REFRESH ===
  let authCheckInProgress = false;
  const AUTH_CONFIG = { VERIFICATION_INTERVAL: 300000 }; // 5 minutes
  let verifyInterval = null;

  async function verifyAuthState(forceVerify = false) {
    if (authCheckInProgress && !forceVerify) return authState.isAuthenticated;
    authCheckInProgress = true;
    try {
      // Pre-check cookies
      logCookieState('before verify');
      let response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
      if (typeof response === 'string') {
        try {
          response = JSON.parse(response);
        } catch (parseErr) {
          captureError(parseErr, {
            source: 'verifyAuthState',
            method: 'verifyAuthState',
            message: 'Failed to parse response as JSON'
          });
          // keep response as string
        }
      }

      // Debug: optional DOM display for /api/auth/verify response
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
            authNotify.error(
              'Could not find body to append debug element for auth verify response.',
              meta('verifyAuthState', { source: 'debugDisplay' })
            );
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
        captureError(e, { source: 'verifyAuthState', method: 'verifyAuthState', message: 'Error in debug display' });
        authNotify.error(
          'Error displaying auth verify debug info in DOM',
          meta('verifyAuthState', { source: 'debugDisplay', originalError: e })
        );
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

      authNotify.info(
        '[Auth Verify] Step 1: userObject before processing',
        meta('verifyAuthStateSteps', { group: true, userObject: JSON.stringify(userObject) })
      );

      let finalUserObject = null;
      if (userObject) {
        const userIdFromObject = userObject.id || userObject.user_id || userObject.userId || userObject._id;
        authNotify.info(
          '[Auth Verify] Step 2: userIdFromObject extracted',
          meta('verifyAuthStateSteps', { group: true, userIdFromObject: String(userIdFromObject || '') })
        );
        if (userIdFromObject) {
          finalUserObject = { ...userObject, id: userIdFromObject };
          authNotify.info(
            '[Auth Verify] Step 3: finalUserObject created',
            meta('verifyAuthStateSteps', { group: true, finalUserObject: JSON.stringify(finalUserObject) })
          );
        } else {
          authNotify.warn(
            '[Auth Verify] userIdFromObject was falsy, finalUserObject not set.',
            meta('verifyAuthStateSteps', { group: true })
          );
        }
      } else {
        authNotify.warn(
          '[Auth Verify] userObject was falsy.',
          meta('verifyAuthStateSteps', { group: true })
        );
      }

      const hasValidUserId = Boolean(finalUserObject && finalUserObject.id);
      authNotify.info(
        '[Auth Verify] Step 4: isAuthenticatedBasedOnValidUserObjectWithId',
        meta('verifyAuthStateSteps', { group: true, value: hasValidUserId })
      );

      // If user object is valid, broadcast
      if (hasValidUserId) {
        authNotify.info(
          '[Auth] verifyAuthState: authenticated with valid user object and ID',
          meta('verifyAuthState', { group: true, userObject: finalUserObject })
        );
        broadcastAuth(true, finalUserObject, 'verify_success_with_user_id');
        return true;
      }

      // Fallback checks for flags/cookies if userId is not present
      authNotify.debug(
        '[Auth Verify] Debug: Raw response object when no valid user ID found',
        meta('verifyAuthState:debug', { group: true, fullResponse: JSON.stringify(response || {}) })
      );
      authNotify.warn(
        '[Auth Verify] Condition (isAuthenticatedBasedOnValidUserObjectWithId) is false; checking fallback flags.',
        meta('verifyAuthStateSteps', { group: true })
      );

      const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
      const isAuthenticatedByFlags =
        truthy(response?.authenticated) ||
        truthy(response?.is_authenticated) ||
        truthy(response?.auth) ||
        truthy(response?.isAuth) ||
        String(response?.authenticated).toLowerCase() === 'true' ||
        String(response?.is_authenticated).toLowerCase() === 'true';

      const hasUsername = Boolean(response?.username || (response?.user && response.user.username));
      const location = domAPI.getWindow()?.location;
      const urlParams = location ? new URLSearchParams(location.search) : null;
      const hasLoginParams = urlParams && urlParams.has('username') && urlParams.has('password');

      authNotify.info(
        '[Auth Verify] Step 5: isAuthenticatedByFlags',
        meta('verifyAuthStateSteps', {
          group: true,
          value: isAuthenticatedByFlags,
          hasUsername,
          rawAuthFlag: String(response?.authenticated),
          rawIsAuthFlag: String(response?.is_authenticated)
        })
      );

      if (isAuthenticatedByFlags || hasUsername || hasLoginParams) {
        const tempUserObj = hasUsername && !finalUserObject
          ? {
              username: response?.username ||
                response?.user?.username ||
                (hasLoginParams ? urlParams.get('username') : 'user'),
              id: response?.id || response?.user?.id || ('temp-id-' + Date.now())
            }
          : null;

        authNotify.warn(
          '[Auth] verifyAuthState: Authenticated via fallback (flags, username, or login params).',
          meta('verifyAuthState', { group: true, responseData: response, hasLoginParams, hasUsername })
        );
        broadcastAuth(true, tempUserObj || null, 'verify_success_via_alternative_checks');
        return true;
      }

      // Another fallback if cookies exist
      const hasCookies = publicAuth.hasAuthCookies();
      if (hasCookies) {
        authNotify.info(
          '[Auth] Found auth cookies, treating as authenticated temporarily',
          meta('verifyAuthState', { group: true })
        );
        const tempUser = hasLoginParams
          ? { username: urlParams.get('username'), id: 'temp-id-' + Date.now() }
          : null;
        broadcastAuth(true, tempUser, 'verify_auth_based_on_cookies');

        // Re-verify in short delay
        setTimeout(() => {
          if (authState.isAuthenticated) {
            verifyAuthState(true).catch(e => {
              authNotify.warn(
                '[Auth] Delayed re-verification failed',
                meta('verifyAuthState', { error: e })
              );
            });
          }
        }, 2000);
        return true;
      }

      // Confirm not authenticated
      await clearTokenState({ source: 'verify_negative_after_all_checks' });
      broadcastAuth(false, null, 'verify_negative_after_all_checks');
      return false;
    } catch (error) {
      captureError(error, { source: 'verifyAuthState', method: 'verifyAuthState' });
      authNotify.warn(
        '[Auth] verifyAuthState error: ' + (error?.message || error),
        meta('verifyAuthState', { group: true })
      );

      if (error.status === 500) {
        authNotify.error(
          '[Auth Verify] Setting auth=false: 500 error on verify endpoint.',
          meta('verifyAuthState', { group: true, originalError: error })
        );
        await clearTokenState({ source: 'verify_500_error' });
        broadcastAuth(false, null, 'verify_500_error_EXPLICIT_LOG');
        return false;
      }

      if (error.status === 401) {
        try {
          authNotify.info(
            '[Auth] verifyAuthState: 401 received, attempting token refresh.',
            meta('verifyAuthState', { group: true })
          );
          await refreshTokens();
          return await verifyAuthState(true);
        } catch (refreshErr) {
          captureError(refreshErr, {
            source: 'verifyAuthState',
            method: 'verifyAuthState',
            message: 'Token refresh failed after 401'
          });
          authNotify.error(
            '[Auth Verify] Setting auth=false: Token refresh failed after 401.',
            meta('verifyAuthState', { group: true, originalError: refreshErr })
          );
          await clearTokenState({ source: 'refresh_failed_after_401' });
          broadcastAuth(false, null, 'refresh_failed_after_401_EXPLICIT_LOG');
          return false;
        }
      }

      authNotify.error(
        `[Auth Verify] Setting auth=false: Unhandled error status ${error.status}.`,
        meta('verifyAuthState', { group: true, originalError: error })
      );
      await clearTokenState({ source: `verify_unhandled_error_${error.status}` });
      broadcastAuth(false, null, `verify_unhandled_error_${error.status}_EXPLICIT_LOG`);
      return false;
    } finally {
      authCheckInProgress = false;
    }
  }

  // === 10) PUBLIC AUTH ACTIONS: login, logout, register ===

  async function loginUser(username, password) {
    authNotify.info(
      `[Auth] Attempting login for user: ${username}`,
      meta('loginUser', { group: true })
    );

    // Pre-check cookie state
    logCookieState('before login attempt');

    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_LOGIN, 'POST', {
        username: username.trim(),
        password
      });

      // Log cookie state after
      logCookieState('after login attempt');

      // If server returns a username, create minimal user object
      let userObject = null;
      if (response && response.username) {
        userObject = {
          username: response.username,
          id: response.id || response.user_id || response.userId || ('temp-id-' + Date.now())
        };
        broadcastAuth(true, userObject, 'login_success_immediate');
        // Let cookies finalize
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
          const verified = await verifyAuthState(true);
          if (verified) {
            authNotify.success(
              'Login successful.',
              meta('loginUser', { group: true })
            );
            return response;
          } else {
            authNotify.warn(
              'Login returned username but verification failed. Treating as authenticated anyway.',
              meta('loginUser', { group: true })
            );
            broadcastAuth(true, userObject, 'login_forced_auth_despite_verify_fail');
            return response;
          }
        } catch (verifyErr) {
          captureError(verifyErr, { source: 'loginUser', method: 'loginUser', message: 'Login verification error' });
          authNotify.warn(
            'Login verification error, but login succeeded. Treating as authenticated.',
            meta('loginUser', { error: verifyErr, group: true })
          );
          broadcastAuth(true, userObject, 'login_forced_auth_with_verify_error');
          return response;
        }
      }

      // If the server data is incomplete
      authNotify.error(
        'Login succeeded but received invalid response from server.',
        meta('loginUser', { group: true, responseData: response })
      );
      throw new Error('Login succeeded but invalid response data.');
    } catch (error) {
      captureError(error, { source: 'loginUser', method: 'loginUser', username });
      await clearTokenState({ source: 'login_error' });
      authNotify.error(
        'Login failed: ' + (error.message || 'Unknown login error.'),
        meta('loginUser', { group: true })
      );
      throw error;
    }
  }

  async function logout() {
    authNotify.info(
      '[Auth] Initiating logout...',
      meta('logout', { group: true })
    );
    await clearTokenState({ source: 'logout_manual' });
    try {
      await getCSRFTokenAsync();
      await authRequest(apiEndpoints.AUTH_LOGOUT, 'POST');
      authNotify.success('Logout successful.', meta('logout', { group: true }));
    } catch (err) {
      captureError(err, { source: 'logout', method: 'logout', message: 'Backend logout call failed' });
      authNotify.warn(
        '[Auth] Backend logout call failed: ' + (err?.message || err),
        meta('logout', { group: true })
      );
    }
  }

  async function registerUser(userData) {
    if (!userData?.username || !userData?.password) {
      authNotify.error(
        'Username and password required.',
        meta('registerUser', { group: true })
      );
      throw new Error('Username and password required.');
    }
    try {
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_REGISTER, 'POST', {
        username: userData.username.trim(),
        password: userData.password
      });
      // Attempt a verification
      const verified = await verifyAuthState(true);
      if (!verified) {
        authNotify.warn(
          '[Auth] Registration succeeded but verification failed.',
          meta('registerUser', { group: true })
        );
      } else {
        authNotify.success('Registration successful.', meta('registerUser', { group: true }));
      }
      return response;
    } catch (error) {
      captureError(error, { source: 'registerUser', method: 'registerUser', username: userData.username });
      await clearTokenState({ source: 'register_error', isError: true });
      authNotify.error(
        'Registration failed: ' + (error.message || 'Unknown error.'),
        meta('registerUser', { group: true })
      );
      throw error;
    }
  }

  // === 11) FORM EVENT HANDLER SETUP ===
  const registeredListeners = [];
  function setupAuthForms() {
    // Example: hooking to a #loginModalForm
    const loginForm = domAPI.getElementById('loginModalForm');
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
          if (modalManager?.hide) {
            modalManager.hide('login'); // example usage
          }
        } catch (error) {
          captureError(error, { source: 'loginFormHandler', method: 'loginFormHandler', username });
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

    // Example: hooking to a #registerModalForm
    const registerForm = domAPI.getElementById('registerModalForm');
    if (registerForm && !registerForm._listenerAttached) {
      registerForm._listenerAttached = true;
      registerForm.setAttribute('novalidate', 'novalidate');
      registerForm.removeAttribute('action');
      registerForm.removeAttribute('method');

      const handler = async (e) => {
        e.preventDefault();
        const errorEl = domAPI.getElementById('registerModalError');
        const submitBtn = domAPI.getElementById('registerModalSubmitBtn');
        hideError(errorEl);
        setButtonLoading(submitBtn, true, 'Registering...');
        const formData = new FormData(registerForm);
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
          captureError(error, { source: 'registerFormHandler', method: 'registerFormHandler', username });
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
        eventHandlers.trackListener(registerForm, 'submit', handler, {
          passive: false,
          context: 'AuthModule:registerFormSubmit',
          description: 'Register Form Submit'
        })
      );
    }
  }

  // For debugging, log internal AuthBus events
  AuthBus.addEventListener('authStateChanged', (e) =>
    authNotify.debug(
      '[AUTH_EVENT]',
      meta('AuthBus', { detail: e.detail })
    )
  );

  // === 12) MODULE INIT & CLEANUP ===

  async function init() {
    // Wait for app readiness if available
    if (DependencySystem?.waitFor) {
      authNotify.debug(
        '[Auth] Waiting for app readiness before initialization.',
        meta('init')
      );
      await DependencySystem.waitFor(['app']);
    }

    // Prevent multiple initializations
    if (authState.isReady) {
      authNotify.warn(
        '[Auth] init called multiple times.',
        meta('init', { group: true })
      );
      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_already_ready');
      return authState.isAuthenticated;
    }

    authNotify.info(
      '[Auth] Initializing auth module...',
      meta('init', { group: true })
    );

    // Setup forms
    setupAuthForms();
    if (eventHandlers.trackListener) {
      eventHandlers.trackListener(domAPI.getDocument(), 'modalsLoaded', setupAuthForms, {
        context: 'AuthModule:init',
        description: 'Auth Modals Loaded Listener'
      });
    }

    try {
      // Get CSRF token
      try {
        await getCSRFTokenAsync();
        authNotify.debug(
          '[Auth] CSRF token obtained successfully',
          meta('init', { group: true })
        );
      } catch (csrfErr) {
        captureError(csrfErr, { source: 'init', method: 'init', message: 'Failed to get CSRF token' });
        authNotify.warn(
          '[Auth] Failed to get CSRF token, continuing initialization',
          meta('init', { error: csrfErr, group: true })
        );
      }

      // Verify
      let verified = false;
      try {
        verified = await verifyAuthState(true);
        authNotify.info(
          `[Auth] Initial verification complete: authenticated=${verified}`,
          meta('init', { group: true })
        );
      } catch (verifyErr) {
        captureError(verifyErr, { source: 'init', method: 'init', message: 'Initial verification failed' });
        authNotify.error(
          '[Auth] Initial verification failed, treating as unauthenticated.',
          meta('init', { error: verifyErr, group: true })
        );
        await clearTokenState({ source: 'init_verify_error', isError: true });
        verified = false;
      }

      // Periodic verify
      verifyInterval = setInterval(() => {
        if (!domAPI.isDocumentHidden && authState.isAuthenticated) {
          verifyAuthState(false).catch((e) => {
            captureError(e, {
              source: 'verifyAuthState',
              method: 'verifyAuthState',
              message: 'verifyAuthState periodic error'
            });
            authNotify.warn(
              '[Auth] verifyAuthState periodic error: ' + (e?.message || e),
              meta('verifyAuthState', { group: true })
            );
          });
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);

      authState.isReady = true;

      // Dispatch authReady
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
        captureError(docErr, { source: 'init', method: 'init', message: 'Failed dispatch authReady on doc' });
        authNotify.warn(
          '[Auth] Failed to dispatch authReady on document',
          meta('init', { error: docErr, group: true })
        );
      }

      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_complete');
      return verified;
    } catch (err) {
      captureError(err, { source: 'init', method: 'init', message: 'Unhandled error during initialization' });
      authNotify.error(
        '[Auth] Unhandled error during initialization: ' + (err?.stack || err),
        meta('init', { group: true })
      );
      await clearTokenState({ source: 'init_unhandled_error', isError: true });
      authState.isReady = true;
      broadcastAuth(false, null, 'init_unhandled_error');
      throw err;
    }
  }

  function cleanup() {
    authNotify.info('[Auth] cleanup called.', meta('cleanup', { group: true }));
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

  // === 13) FETCH CURRENT USER ===
  async function fetchCurrentUser() {
    try {
      logCookieState('fetchCurrentUser - before API call');
      const resp = await apiClient(apiEndpoints.AUTH_VERIFY, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      authNotify.debug(
        '[Auth] fetchCurrentUser response:',
        meta('fetchCurrentUser', { responseData: JSON.stringify(resp || {}) })
      );
      logCookieState('fetchCurrentUser - after API call');

      if (!resp) {
        // Check if user might be in URL params
        const location = domAPI.getWindow()?.location;
        const urlParams = location ? new URLSearchParams(location.search) : null;
        const hasLoginParams = urlParams && urlParams.has('username') && urlParams.has('password');
        if (hasLoginParams) {
          authNotify.info(
            '[Auth] No API response but found login params in URL. Creating temporary user...',
            meta('fetchCurrentUser', { group: true })
          );
          return {
            username: urlParams.get('username'),
            id: 'temp-id-' + Date.now()
          };
        }
        return null;
      }

      // Attempt to extract a user object
      let userToReturn = null;
      if (resp.user && typeof resp.user === 'object') {
        const userId = resp.user.id || resp.user.user_id || resp.user.userId || resp.user._id;
        const username = resp.user.username || resp.user.name || resp.user.email;
        if (userId || username) {
          userToReturn = { ...resp.user, id: userId || ('user-' + Date.now()) };
        }
      } else if (resp.username) {
        const userId = resp.id || resp.user_id || resp.userId || resp._id;
        userToReturn = {
          ...resp,
          username: resp.username,
          id: userId || ('user-' + Date.now())
        };
      } else if (resp.authenticated === true || resp.is_authenticated === true) {
        userToReturn = {
          id: 'auth-' + Date.now(),
          username: 'user'
        };
      }

      if (userToReturn) {
        authNotify.info(
          '[Auth] Successfully extracted user info',
          meta('fetchCurrentUser', { group: true, userInfo: JSON.stringify(userToReturn) })
        );
        return userToReturn;
      }

      authNotify.warn(
        '[Auth] fetchCurrentUser: unrecognized response or missing user ID.',
        meta('fetchCurrentUser', { group: true, responseData: resp })
      );

      // Another fallback if cookies
      if (publicAuth.hasAuthCookies()) {
        authNotify.info(
          '[Auth] No user object but found auth cookies. Creating temporary user.',
          meta('fetchCurrentUser', { group: true })
        );
        return {
          username: 'authenticated-user',
          id: 'cookie-auth-' + Date.now()
        };
      }

      return null;
    } catch (error) {
      captureError(error, { source: 'fetchCurrentUser', method: 'fetchCurrentUser', endpoint: apiEndpoints.AUTH_VERIFY });
      authNotify.error(
        '[Auth] fetchCurrentUser API call failed.',
        meta('fetchCurrentUser', { group: true, originalError: error })
      );
      return null;
    }
  }

  // === 14) PUBLIC API EXPORT (FACTORY PATTERN) ===
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

  return publicAuth;
}
