import { createAuthFormListenerFactory } from './authFormListenerFactory.js';

/**
 * Creates and returns a centralized authentication module with dependency injection.
 *
 * This factory function provides a complete authentication system, including login, logout, registration, session verification, CSRF token management, authenticated API requests, event broadcasting, and UI form integration. All external dependencies must be supplied via the `deps` object, ensuring strict modularity and testability.
 *
 * The returned module exposes methods for authentication actions, state queries, event handling, and diagnostics, and manages all authentication state and event wiring internally.
 *
 * @param {object} deps - Dependency injection object containing required services and configuration.
 * @returns {object} Public API for authentication operations, including methods for login, logout, registration, state verification, CSRF handling, event bus, and diagnostics.
 *
 * @throws {Error} If required dependencies or endpoint configurations are missing or invalid.
 *
 * @remark
 * All authentication logic, state, and event handling are encapsulated in this module. No authentication primitives exist outside this context. All previous modular primitives are removed.
 */

export function createAuthModule(deps) {
  // === FACTORY GUARDRAIL: STRICT DI VALIDATION (No fallback, throw immediately, BEFORE destructuring) ===
  if (!deps || typeof deps !== "object") {
    throw new Error("[AuthModule] 'deps' DI object is required as argument to createAuthModule");
  }
  if (!deps.apiClient) throw new Error("[AuthModule] DI param 'apiClient' is required.");
  if (!deps.logger) throw new Error("[AuthModule] DI param 'logger' is required.");
  if (!deps.domReadinessService) throw new Error("[AuthModule] DI param 'domReadinessService' is required.");
  if (!deps.eventHandlers) throw new Error("[AuthModule] DI param 'eventHandlers' is required.");
  if (!deps.domAPI) throw new Error("[AuthModule] DI param 'domAPI' is required.");
  if (!deps.sanitizer) throw new Error("[AuthModule] DI param 'sanitizer' is required.");
  if (!deps.apiEndpoints) throw new Error("[AuthModule] DI param 'apiEndpoints' is required.");

  // Validate that apiEndpoints contains all required auth endpoint keys
  const requiredEndpoints = ['AUTH_CSRF', 'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_REGISTER', 'AUTH_VERIFY', 'AUTH_REFRESH'];
  const missingEndpoints = requiredEndpoints.filter(key => !deps.apiEndpoints[key]);
  if (missingEndpoints.length > 0) {
    throw new Error(`[AuthModule] Missing required auth endpoints in apiEndpoints: ${missingEndpoints.join(', ')}. Available endpoints: ${Object.keys(deps.apiEndpoints).join(', ')}`);
  }

  // DependencySystem and modalManager may be undefined

  const {
    apiClient,
    eventHandlers,
    domAPI,
    sanitizer,
    modalManager,
    apiEndpoints,
    DependencySystem,
    logger,
    domReadinessService
  } = deps;

  // Use canonical safeHandler from DI
  const safeHandler = DependencySystem.modules.get('safeHandler');

  // --- bearer token storage ---------------------------------
  let accessToken = null;           // stores latest JWT / bearer
  let tokenType = 'Bearer';       // e.g. "Bearer"
  let refreshToken = null;           // optional refresh token

  // === 2) INTERNAL UTILITIES & HELPERS ===

  function extendProps(target, props) {
    if (target && props) Object.assign(target, props);
  }
  function applyStyles(target, styles) {
    if (target && styles) Object.assign(target, styles);
  }

  // === 3) DOM/COOKIE & STATE MANAGEMENT ===
  // CONSOLIDATED: No local authState - appModule.state is the single source of truth per .clinerules

  const AuthBus = new EventTarget();

  // Helper to get the canonical app state
  function getAppState() {
    const appModuleRef = DependencySystem?.modules?.get('appModule');
    if (!appModuleRef?.state) {
      logger.warn('[AuthModule] appModule.state not available. Using fallback empty state.', { context: 'getAppState' });
      return {
        isAuthenticated: false,
        currentUser: null,
        isReady: false
      };
    }
    return appModuleRef.state;
  }

  function readCookie(name) {
    const doc = domAPI.getDocument?.();
    if (!doc || typeof doc.cookie !== 'string') return null;
    const cookieStr = doc.cookie;
    if (!cookieStr) return null;
    const m = cookieStr.match(
      new RegExp('(?:^|;\\s*)' + name + '\\s*=\\s*([^;]+)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  function validateUsername(username) {
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
    if (!hasUpper) return { valid: false, message: 'Password must contain an uppercase letter' };
    if (!hasLower) return { valid: false, message: 'Password must contain a lowercase letter' };
    if (!hasNumber) return { valid: false, message: 'Password must contain a number' };
    if (!hasSpecial) return { valid: false, message: 'Password must contain a special character' };
    return { valid: true };
  }

  // === 4) UI/FORM HELPERS ===
  function setButtonLoading(btn, isLoading, loadingText = 'Saving...') {
    if (!btn) return;
    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      const htmlContent = `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`;
      domAPI.setInnerHTML(btn, sanitizer.sanitize(htmlContent));
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
      domAPI.setTextContent(el, msg);
      domAPI.removeClass(el, 'hidden');
    }
  }
  function hideError(el) {
    if (el) {
      domAPI.setTextContent(el, '');
      domAPI.addClass(el, 'hidden');
    }
  }

  // === 5) CSRF & TOKEN LOGIC ===
  let csrfToken = '';
  let csrfTokenPromise = null;
  let _lastLoginTimestamp = 0;
// Logging simplification: always treat as not in log-delivery context
  const _inLogDelivery = false;

  function getCSRFToken() {
    const current = readCookie('csrf_token');
    if (current) csrfToken = current;
    return csrfToken;
  }

  async function fetchCSRFToken() {
    if (!apiEndpoints.AUTH_CSRF) throw new Error('AUTH_CSRF endpoint missing in apiEndpoints');
    const csrfUrl = apiEndpoints.AUTH_CSRF;
    const url = csrfUrl.includes('?')
      ? `${csrfUrl}&ts=${Date.now()}`
      : `${csrfUrl}?ts=${Date.now()}`;

    if (!_inLogDelivery) {
      logger.log('[DIAGNOSTIC][auth.js][fetchCSRFToken] Fetching', url, { context: 'fetchCSRFToken' });
    }

    const data = await apiClient(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      credentials: 'include',
      cache: 'no-store'
    });

    if (!data || !data.token) {
      if (!_inLogDelivery) {
        logger.error('[DIAGNOSTIC][auth.js][fetchCSRFToken] Missing or bad response:', data, { context: 'fetchCSRFToken' });
      }
      throw new Error('CSRF token missing');
    }

    if (!_inLogDelivery) {
      logger.log('[DIAGNOSTIC][auth.js][fetchCSRFToken] Received CSRF token (masked)', { context: 'fetchCSRFToken' });
    }

    return data.token;
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

  // === 6) AUTH REQUEST WRAPPER ===
  // CONSOLIDATED: Standardized error object creation to match apiClient.js pattern
  function extendErrorWithStatus(error, message) {
    if (!error.status) {
      // Use same structure as apiClient.js: status, data (full payload), message
      extendProps(error, {
        status: 0,
        data: { detail: message || 'Network/CORS issue' },
        // message is already set on the Error object
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
        if (!_inLogDelivery) {
          logger.log('[DIAGNOSTIC][auth.js][authRequest] Adding X-CSRF-Token header [masked] for', endpoint, { context: 'authRequest' });
        }
      } else {
        if (!_inLogDelivery) {
          logger.warn('[DIAGNOSTIC][auth.js][authRequest] No CSRF token found for state-changing request', endpoint, { context: 'authRequest' });
        }
      }
    }
    // Bearer-auth header when we already hold an access token
    if (accessToken && !options.headers['Authorization']) {
      options.headers['Authorization'] = `${tokenType} ${accessToken}`;
    }
    if (body) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }
    try {
      if (!_inLogDelivery) {
        logger.log('[DIAGNOSTIC][auth.js][authRequest][REQUEST]', endpoint, options, { context: 'authRequest' });
      }
      const data = await apiClient(endpoint, options);
      if (!_inLogDelivery) {
        logger.log('[DIAGNOSTIC][auth.js][authRequest][RESPONSE]', endpoint, data, { context: 'authRequest' });
      }
      return data;
    } catch (error) {
      if (!_inLogDelivery) {
        logger.error('[DIAGNOSTIC][auth.js][authRequest][ERROR]', endpoint, error, { context: 'authRequest' });
      }
      extendErrorWithStatus(error, error.message);
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
        await getCSRFTokenAsync();
        const response = await authRequest(apiEndpoints.AUTH_REFRESH, 'POST');
        // Store bearer tokens if present
        if (response && response.access_token) {
          accessToken = response.access_token;
          tokenType = response.token_type || 'Bearer';
          refreshToken = response.refresh_token || refreshToken;
        }
        return { success: true, response };
      } catch (error) {
        if (logger && logger.error) logger.error('[refreshTokens] error', error, { context: 'refreshTokens' });
        if (error.status === 401) {
          await clearTokenState({ source: 'refresh_401_error' });
        }
        throw error;
      } finally {
        tokenRefreshInProgress = false;
        tokenRefreshPromise = null;
      }
    })();
    return tokenRefreshPromise;
  }
  async function clearTokenState(options = { source: 'unknown' }) {
    accessToken = null;
    refreshToken = null;
    broadcastAuth(false, null, `clearTokenState:${options.source}`);
  }

  /**
   * Broadcasts authentication state changes to the application and updates relevant UI elements.
   *
   * Updates the canonical appModule.state and dispatches authStateChanged events. This is the ONLY
   * function that should modify authentication state per .clinerules single source of truth.
   *
   * @param {boolean} authenticated - Whether the user is authenticated.
   * @param {object|null} [userObject=null] - The current user object, or `null` if not authenticated.
   * @param {string} [source='unknown'] - The source of the state change for diagnostic purposes.
   */
  function broadcastAuth(authenticated, userObject = null, source = 'unknown') {
    const appModuleRef = DependencySystem?.modules?.get('appModule');
    if (!appModuleRef?.setAuthState) {
      logger.error('[AuthModule][broadcastAuth] appModule.setAuthState not available. Cannot update authentication state.', { source, context: 'broadcastAuth' });
      return;
    }

    const currentState = appModuleRef.state;
    const previousAuth = currentState.isAuthenticated;
    const previousUserObject = currentState.currentUser;

    logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] called.', {
      authenticated, userObject, source,
      previousAuth,
      previousUserObject
    }, { context: 'broadcastAuth' });

    const changed =
      authenticated !== previousAuth ||
      JSON.stringify(userObject) !== JSON.stringify(previousUserObject);

    if (changed) {
      logger.info('[AuthModule][broadcastAuth] Updating canonical app state.', {
        authenticated,
        userId: userObject?.id,
        source,
        context: 'broadcastAuth:appModuleUpdate'
      });

      // SINGLE SOURCE OF TRUTH: Update only appModule.state per .clinerules
      appModuleRef.setAuthState({
        isAuthenticated: authenticated,
        currentUser: userObject
      });

      const eventDetail = {
        authenticated,
        user: userObject,
        timestamp: Date.now(),
        source
      };
      try {
        logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] Broadcasting authStateChanged event', { source, authenticated, userId: userObject?.id, context: 'broadcastAuth:dispatchEvents' });
        if (!eventHandlers.createCustomEvent) {
          throw new Error('[AuthModule] eventHandlers.createCustomEvent is required to DI-create events for guardrail compliance.');
        }
        AuthBus.dispatchEvent(eventHandlers.createCustomEvent('authStateChanged', { detail: eventDetail }));
      } catch (busErr) {
        logger.error('[DIAGNOSTIC][auth.js][broadcastAuth] AuthBus dispatch failed', busErr, { context: 'broadcastAuth' });
      }
    } else {
      logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] No auth/user change; not broadcasting', { context: 'broadcastAuth' });
    }
  }

  // === 9) VERIFICATION, AUTO-REFRESH ===
  let authCheckInProgress = false;
  const AUTH_CONFIG = { VERIFICATION_INTERVAL: 300000 };
  let verifyInterval = null;
  /**
   * Verifies the current authentication state by querying the backend and updates the application state accordingly.
   *
   * This function checks for authentication cookies and calls the backend verification endpoint to determine if the user is authenticated. It handles various response formats, including user objects and boolean flags, and updates the authentication state, user object, and broadcasts changes. On errors, it attempts token refresh for 401 responses, clears tokens for 500 or unhandled errors, and maintains state for network errors if cookies are present.
   *
   * @param {boolean} [forceVerify=false] - If true, forces verification even if a check is already in progress.
   * @returns {Promise<boolean>} Resolves to true if the user is authenticated, false otherwise.
   *
   * @throws {Error} If the backend returns a non-JSON response when JSON is expected.
   */
  async function verifyAuthState(forceVerify = false) {
    // Remove the early return that was causing issues with page refresh
    // Always check auth state on page load/refresh regardless of recent login timestamp
    if (authCheckInProgress && !forceVerify) {
      const currentAuth = getAppState().isAuthenticated;
      logger.debug('[AuthModule][verifyAuthState] Verification already in progress and not forced. Returning current state.', { currentAuth, context: 'verifyAuthState:inProgress' });
      return currentAuth;
    }
    authCheckInProgress = true;
    logger.debug('[AuthModule][verifyAuthState] Starting verification.', { forceVerify, context: 'verifyAuthState:start' });

    try {
      const hasExistingCookies = publicAuth.hasAuthCookies();
      if (!hasExistingCookies && !forceVerify) {
        // HttpOnly cookies are not visible to JavaScript; absence of
        // readable cookies does NOT necessarily indicate the user is logged
        // out. Continue with backend verification instead of clearing state.
        logger.debug('[AuthModule][verifyAuthState] No readable auth cookies (likely HttpOnly). Proceeding with backend verification.', { context: 'verifyAuthState:noReadableCookies' });
      }

      logger.debug('[AuthModule][verifyAuthState] Proceeding to call AUTH_VERIFY endpoint.', { hasExistingCookies, forceVerify, context: 'verifyAuthState:apiCall' });
      let response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');

      // Attempt to parse if response is a string (though apiClient should handle JSON)
      if (typeof response === 'string') {
        try {
          response = JSON.parse(response);
        } catch (parseErr) {
          logger.error('[AuthModule][verifyAuthState] API response was a string, failed to parse as JSON.',
            parseErr,
            { responseString: response, context: 'verifyAuthState:jsonParseError' });
          // Depending on backend, an unparsable string might mean an error page or non-JSON success.
          // For now, assume it's a failure if it's not parsable and was expected to be JSON.
          // If backend sometimes sends non-JSON success, this needs adjustment.
          throw new Error('Non-JSON response from AUTH_VERIFY');
        }
      }
      logger.debug('[AuthModule][verifyAuthState] AUTH_VERIFY response received.', { response, context: 'verifyAuthState:apiResponse' });

      // Enhanced response validation for user object
      let userObject = null;
      if (response && typeof response === 'object') {
        // Common patterns for user object nesting or direct properties
        if (response.user && typeof response.user === 'object' && response.user.id) {
          userObject = response.user;
          logger.debug('[AuthModule][verifyAuthState] User object found in response.user.', { userId: userObject.id, context: 'verifyAuthState:userObjSource' });
        } else if (response.id && response.username) { // User object might be the response itself
          userObject = response;
          logger.debug('[AuthModule][verifyAuthState] User object is the response itself.', { userId: userObject.id, context: 'verifyAuthState:userObjSource' });
        }
      }

      let finalUserObject = null;
      if (userObject) {
        const userIdFromObject = userObject.id || userObject.user_id || userObject.userId || userObject._id;
        if (userIdFromObject) {
          finalUserObject = { ...userObject, id: userIdFromObject }; // Ensure 'id' field is standardized
          logger.debug('[AuthModule][verifyAuthState] Standardized user object.', { finalUserObject, context: 'verifyAuthState:userObjStandardized' });
        } else {
          logger.warn('[AuthModule][verifyAuthState] User object found but lacks a usable ID field.', { userObject, context: 'verifyAuthState:userObjNoId' });
        }
      }

      // Primary condition: Valid user object with an ID means authenticated
      if (finalUserObject?.id) {
        logger.info('[AuthModule][verifyAuthState] Verification successful: Valid user object with ID found.', { username: finalUserObject.username, userId: finalUserObject.id, context: 'verifyAuthState:successWithUserObject' });
        // KILOCODE: Added detailed logging before broadcast
        logger.debug('[AuthModule][verifyAuthState] PRE-BROADCAST (user object):', {
          authenticated: true,
          userObject: JSON.parse(JSON.stringify(finalUserObject)),
          source: 'verify_success_with_user_id',
          context: 'verifyAuthState:preBroadcast:user'
        });
        broadcastAuth(true, finalUserObject, 'verify_success_with_user_id');
        return true;
      }

      // Secondary condition: Check for boolean authentication flags if no complete user object
      const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
      const isAuthenticatedByFlags =
        truthy(response?.authenticated) || truthy(response?.is_authenticated) ||
        truthy(response?.auth) || truthy(response?.isAuth); // Common flag names

      if (isAuthenticatedByFlags) {
        // If authenticated by flag but no user object, create a minimal one if username is available
        const usernameFromResponse = response?.username || response?.user?.username;
        const tempUserObj = usernameFromResponse ? { username: usernameFromResponse, id: `flag-auth-${Date.now()}` } : null;
        logger.info('[AuthModule][verifyAuthState] Verification successful: Authenticated by boolean flag.', { username: tempUserObj?.username, context: 'verifyAuthState:successWithFlag' });
        // KILOCODE: Added detailed logging before broadcast
        logger.debug('[AuthModule][verifyAuthState] PRE-BROADCAST (flag):', {
          authenticated: true,
          userObject: JSON.parse(JSON.stringify(tempUserObj)),
          source: 'verify_success_via_flag',
          context: 'verifyAuthState:preBroadcast:flag'
        });
        broadcastAuth(true, tempUserObj, 'verify_success_via_flag');
        return true;
      }

      // If here, API response did not indicate authentication (no user object, no true flags)
      logger.info('[AuthModule][verifyAuthState] Verification negative: API response does not indicate active authentication.', { response: JSON.parse(JSON.stringify(response)), context: 'verifyAuthState:negativeApiReponse' });
      if (hasExistingCookies) {
        logger.warn('[AuthModule][verifyAuthState] Stale Cookies: Auth cookies were present, but backend verification failed. Clearing token state.', { context: 'verifyAuthState:staleCookies' });
        await clearTokenState({ source: 'verify_stale_cookies_after_api_check' });
      } else {
        await clearTokenState({ source: 'verify_negative_no_cookies_after_api_check' });
      }
      // KILOCODE: Added detailed logging before broadcast
      logger.debug('[AuthModule][verifyAuthState] PRE-BROADCAST (negative API):', {
        authenticated: false,
        userObject: null,
        source: 'verify_negative_after_api_check',
        context: 'verifyAuthState:preBroadcast:negativeApi'
      });
      broadcastAuth(false, null, 'verify_negative_after_api_check');
      return false;

    } catch (error) {
      logger.error('[AuthModule][verifyAuthState] Error during verification API call or processing.', { status: error.status, message: error.message, data: error.data ? JSON.parse(JSON.stringify(error.data)) : null, stack: error.stack, context: 'verifyAuthState:catchAllError' });

      if (error.status === 500) {
        logger.warn('[AuthModule][verifyAuthState] Server error (500). Clearing token state.', { context: 'verifyAuthState:error500' });
        await clearTokenState({ source: 'verify_500_error' });
        // KILOCODE: Added detailed logging before broadcast
        logger.debug('[AuthModule][verifyAuthState] PRE-BROADCAST (500 error):', {
          authenticated: false,
          userObject: null,
          source: 'verify_500_error',
          context: 'verifyAuthState:preBroadcast:500'
        });
        broadcastAuth(false, null, 'verify_500_error');
        return false;
      }

      if (error.status === 401) {
        logger.info('[AuthModule][verifyAuthState] Unauthorized (401). Attempting token refresh.', { context: 'verifyAuthState:error401' });
        try {
          await refreshTokens();
          logger.info('[AuthModule][verifyAuthState] Token refresh successful after 401. Re-verifying.', { context: 'verifyAuthState:postRefreshAttempt' });
          return await verifyAuthState(true); // Force re-verification after refresh
        } catch (refreshErr) {
          logger.error('[AuthModule][verifyAuthState] Token refresh failed after 401.',
            refreshErr,
            { context: 'verifyAuthState:refreshFailed' });
          await clearTokenState({ source: 'refresh_failed_after_401_in_verify' });
          // KILOCODE: Added detailed logging before broadcast
          logger.debug('[AuthModule][verifyAuthState] PRE-BROADCAST (refresh failed):', {
            authenticated: false,
            userObject: null,
            source: 'refresh_failed_after_401_in_verify',
            context: 'verifyAuthState:preBroadcast:refreshFailed'
          });
          broadcastAuth(false, null, 'refresh_failed_after_401_in_verify');
          return false;
        }
      }

      // For network errors (status 0 or no status) or other non-401/500 errors
      const hasCookiesOnNetworkError = publicAuth.hasAuthCookies(); // Re-check, might have changed
      if (hasCookiesOnNetworkError && (error.status === 0 || !error.status)) {
        const currentAuth = getAppState().isAuthenticated;
        logger.warn('[AuthModule][verifyAuthState] Network error occurred, but auth cookies are present. Maintaining current auth state.',
          error,
          { currentAuth, context: 'verifyAuthState:networkErrorWithCookies' });
        // Do not change authentication state here; return existing state.
        // The user might be temporarily offline but still "logged in".
        return currentAuth;
      }

      // For other errors where cookies might not be present or it's not a network error
      logger.warn(`[AuthModule][verifyAuthState] Unhandled error (status: ${error.status || 'unknown'}). Clearing token state.`, { context: 'verifyAuthState:unhandledErrorClear' });
      await clearTokenState({ source: `verify_unhandled_error_status_${error.status || 'unknown'}` });
      // KILOCODE: Added detailed logging before broadcast
      logger.debug('[AuthModule][verifyAuthState] PRE-BROADCAST (unhandled error):', {
        authenticated: false,
        userObject: null,
        source: `verify_unhandled_error_status_${error.status || 'unknown'}`,
        context: 'verifyAuthState:preBroadcast:unhandledError'
      });
      broadcastAuth(false, null, `verify_unhandled_error_status_${error.status || 'unknown'}`);
      return false;
    } finally {
      authCheckInProgress = false;
    }
  }

  /**
   * Attempts to log in a user with the provided credentials.
   *
   * Fetches a CSRF token, sends a login request to the backend, stores authentication tokens on success, and broadcasts the authenticated state. If the backend response does not include a user object, a provisional user is created for state broadcasting. Logs detailed diagnostics and clears token state on failure.
   *
   * @param {string} username - The username to authenticate.
   * @param {string} password - The password for the user.
   * @returns {Promise<Object>} The full API response from the login endpoint.
   *
   * @throws {Error} If the login attempt fails due to invalid credentials, network issues, or backend errors.
   */

  async function loginUser(username, password) {
    logger.info('[AuthModule][loginUser] Attempting login.', { username: username, context: 'loginUser:start' });
    try {
      logger.log('[DIAGNOSTIC][auth.js][loginUser] Attempting login', username, { context: 'loginUser' });
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_LOGIN, 'POST', {
        username: username.trim(),
        password
      });
      logger.info('[AuthModule][loginUser] Login API response received.', { response, context: 'loginUser:apiResponse' });

      if (response && response.access_token) {
        accessToken = response.access_token;
        tokenType = response.token_type || 'Bearer';
        refreshToken = response.refresh_token || null;
        logger.info('[AuthModule][loginUser] Access and refresh tokens stored from login response.', { context: 'loginUser:tokensStored' });
      }

      // Log cookie state after login attempt for diagnostics
      try {
        const doc = domAPI.getDocument?.();
        if (doc && typeof doc.cookie === 'string') {
          logger.debug('[AuthModule][loginUser] Cookies after login API call (contents masked for security).', { hasCookies: !!doc.cookie, context: 'loginUser:cookieCheck' });
          if (!doc.cookie) {
            logger.warn('[AuthModule][loginUser] No cookies seem to be set after login API call. Backend might not be setting session/CSRF cookies correctly.', { context: 'loginUser:noCookiesWarning' });
          }
        }
      } catch (cookieErr) {
        logger.error('[AuthModule][loginUser] Error reading cookies after login.',
          cookieErr,
          { context: 'loginUser:cookieReadError' });
      }

      // Determine user object from response
      let userObject = null;
      if (response && typeof response === 'object') {
        if (response.user && typeof response.user === 'object' && response.user.id) {
          userObject = response.user;
        } else if (response.id && response.username) {
          userObject = response;
        } else if (response.username) { // If only username is directly in response
          userObject = { username: response.username, id: `login-temp-${Date.now()}` };
        }
      }

      if (userObject?.id && userObject?.username) {
        logger.info('[AuthModule][loginUser] Login successful. User object identified from response.', { userId: userObject.id, username: userObject.username, context: 'loginUser:successWithUserObject' });
        broadcastAuth(true, userObject, 'login_success_with_user_object');
      } else {
        // If API indicates success (e.g. 200 OK) but no clear user object, broadcast with provisional user.
        // This might happen if backend sends just a success message or JWT without user details.
        logger.warn('[AuthModule][loginUser] Login API success, but user object not clearly identified in response. Broadcasting provisional auth.', { response, context: 'loginUser:successProvisional' });
        const provisionalUser = { username: username.trim(), id: `provisional-${Date.now()}` };
        broadcastAuth(true, provisionalUser, 'login_success_provisional_user_data');
      }

      _lastLoginTimestamp = Date.now();
      return response; // Return full API response
    } catch (error) {
      logger.error('[AuthModule][loginUser] Login attempt failed.',
        error,
        { username: username, context: 'loginUser:error' });
      await clearTokenState({ source: 'login_api_error' }); // Clear any partial token state on login failure
      throw error; // Re-throw for form handler
    }
  }

  /**
   * Logs out the current user by clearing authentication tokens and broadcasting a logged-out state.
   *
   * Attempts to call the backend logout API endpoint, but ensures the user is logged out locally regardless of API errors.
   */
  async function logout() {
    logger.info('[AuthModule][logout] Initiating logout process.', { context: 'logout:start' });
    accessToken = null;
    refreshToken = null;
    // Broadcast logged-out state immediately
    await clearTokenState({ source: 'logout_manual_clear' });
    // clearTokenState calls broadcastAuth(false, null, ...)

    try {
      await getCSRFTokenAsync(); // Ensure CSRF is available if needed by logout endpoint
      logger.debug('[AuthModule][logout] Attempting to call logout API endpoint.', { context: 'logout:apiCall' });
      await authRequest(apiEndpoints.AUTH_LOGOUT, 'POST');
      logger.info('[AuthModule][logout] Logout API call successful.', { context: 'logout:apiSuccess' });
    } catch (err) {
      // Log error but don't re-throw; user is already logged out on client-side.
      logger.error('[AuthModule][logout] Error calling logout API endpoint. User is already logged out locally.',
        err,
        { context: 'logout:apiError' });
    }
    logger.info('[AuthModule][logout] Logout process completed on client-side.', { context: 'logout:end' });
  }

  /**
   * Registers a new user with the provided credentials.
   *
   * Validates that both username and password are present, then submits a registration request to the backend. After successful registration, forces authentication state verification to synchronize the client with the backend. Clears any partial authentication state and rethrows the error if registration fails.
   *
   * @param {Object} userData - The registration data containing at least a username and password.
   * @returns {Object} The full API response from the registration endpoint.
   *
   * @throws {Error} If username or password is missing, or if the registration request fails.
   */
  async function registerUser(userData) {
    if (!userData?.username || !userData?.password) {
      logger.error('[AuthModule][registerUser] Username and password are required for registration.', { context: 'registerUser:validationError' });
      throw new Error('Username and password required.');
    }
    const trimmedUsername = userData.username.trim();
    logger.info('[AuthModule][registerUser] Attempting user registration.', { username: trimmedUsername, context: 'registerUser:start' });

    try {
      await getCSRFTokenAsync(); // Ensure CSRF token is fetched before POST request
      const response = await authRequest(apiEndpoints.AUTH_REGISTER, 'POST', {
        username: trimmedUsername,
        password: userData.password // Assuming password validation happened in form
      });
      logger.info('[AuthModule][registerUser] Registration API call successful.', { response, context: 'registerUser:apiResponse' });

      // After successful registration, typically backend auto-logins or requires login.
      // Forcing verifyAuthState helps sync client with backend's post-registration state.
      logger.debug('[AuthModule][registerUser] Triggering auth state verification after registration.', { context: 'registerUser:postVerify' });
      await verifyAuthState(true);
      return response; // Return full API response
    } catch (error) {
      logger.error('[AuthModule][registerUser] Registration failed.',
        error,
        { username: trimmedUsername, context: 'registerUser:error' });
      await clearTokenState({ source: 'register_api_error' }); // Clear any partial state
      throw error;
    }
  }

  // === 11) FORM EVENT HANDLER SETUP ===
  const authFormListenerFactory = createAuthFormListenerFactory({
    eventHandlers,
    domAPI,
    domReadinessService,
    browserService: DependencySystem.modules.get('browserService'),
    safeHandler,
    logger,
    DependencySystem
  });

  // CONSOLIDATED: Generic form handler for both login and register
  function createAuthFormHandler(formType, formElement, errorElementId, submitButtonSelector, loadingText, successText) {
    return async (e) => {
      logger.log(`[AuthModule] ${formType} form submit handler invoked.`, { context: `${formType}Form` });
      domAPI.preventDefault(e);
      const errorEl = domAPI.getElementById(errorElementId);
      hideError(errorEl);
      const submitBtn = domAPI.querySelector(submitButtonSelector, formElement);
      setButtonLoading(submitBtn, true, loadingText);

      const browserService = DependencySystem.modules.get('browserService');
      if (!browserService || !browserService.FormData) {
        throw new Error('[AuthModule] browserService.FormData is required for guardrail compliance. No global FormData fallback allowed.');
      }

      const formData = new browserService.FormData(formElement);
      const username = formData.get('username')?.trim();
      const password = formData.get('password');

      // Common validation
      if (!username || !password) {
        showError(errorEl, 'Username and password are required.');
        setButtonLoading(submitBtn, false, successText);
        return;
      }
      if (!validateUsername(username)) {
        showError(errorEl, 'Invalid username. Use 3-32 letters, numbers, or ._-');
        setButtonLoading(submitBtn, false, successText);
        return;
      }
      const pwCheck = validatePassword(password);
      if (!pwCheck.valid) {
        showError(errorEl, pwCheck.message);
        setButtonLoading(submitBtn, false, successText);
        return;
      }

      // Register-specific validation
      if (formType === 'register') {
        const passwordConfirm = formData.get('passwordConfirm');
        if (!passwordConfirm) {
          showError(errorEl, 'All fields are required.');
          setButtonLoading(submitBtn, false, successText);
          return;
        }
        if (password !== passwordConfirm) {
          showError(errorEl, 'Passwords do not match.');
          setButtonLoading(submitBtn, false, successText);
          return;
        }
      }

      try {
        if (formType === 'login') {
          await publicAuth.login(username, password);
        } else {
          await publicAuth.register({ username, password });
        }
        if (modalManager?.hide) modalManager.hide('login');
      } catch (error) {
        logger.error(`[${formType}Form][catch]`, error, { context: `${formType}Form` });
        let msg = `${formType === 'login' ? 'Login' : 'Registration'} failed due to server error.`;

        if (formType === 'login') {
          if (error.status === 401) {
            msg = 'Incorrect username or password.';
          } else if (error.status === 400) {
            msg = error.data?.detail || 'Invalid login request.';
          }
        } else {
          if (error.status === 409) {
            msg = 'A user with that username already exists.';
          } else if (error.status === 400) {
            msg = error.data?.detail || 'Invalid registration data.';
          }
        }

        if (!msg.includes('server error')) {
          // Use specific error message
        } else {
          msg = error.data?.detail || error.message || msg;
        }
        showError(errorEl, msg);
      } finally {
        setButtonLoading(submitBtn, false, successText);
      }
    };
  }

  // No-op: extracted to separate factory

  /**
   * Wiring step 1: Waits for DOM readiness and attaches form event handlers (no network).
   *
   * Ensures all forms and related UI are ready, then wires listeners using the factory.
   * No network/api/CSRF attempted in this setup.
   */
  async function setupAuthFormDOM() {
    await domReadinessService.documentReady();

    // Attach form listeners via dedicated factory
    authFormListenerFactory.setup({
      loginHandler: createAuthFormHandler(
        'login',
        domAPI.getElementById('loginModalForm'),
        'loginModalError',
        'button[type="submit"]',
        'Logging in...',
        'Login'
      ),
      registerHandler: createAuthFormHandler(
        'register',
        domAPI.getElementById('registerModalForm'),
        'registerModalError',
        '#registerModalSubmitBtn',
        'Registering...',
        'Register'
      )
    });
  }

  /**
   * Initializes the authentication module, orchestrating (a) DOM/form wiring and (b) CSRF/auth initialization.
   *
   * Returns the result of the initial authentication verification.
   */
  async function init() {
    // Prevent multiple initializations
    const currentState = getAppState();
    if (currentState.isReady) {
      broadcastAuth(currentState.isAuthenticated, currentState.currentUser, 'init_already_ready');
      return currentState.isAuthenticated;
    }
    // (a) DOM & form setup only
    await setupAuthFormDOM();

    // (b) CSRF fetch, initial verify, periodic, lifecycle
    try {
      // CSRF retry logic: 3 attempts, user-visible modal on failure
      let csrfFetched = false, lastError = null;
      for (let attempt = 0; attempt < 3 && !csrfFetched; ++attempt) {
        try {
          await getCSRFTokenAsync(true);
          csrfFetched = true;
        } catch (csrfErr) {
          lastError = csrfErr;
          logger.error('[AuthModule] CSRF token fetch during init (retry attempt ' + (attempt + 1) + '):', csrfErr, { context: 'init' });
        }
      }
      if (!csrfFetched) {
        logger.error('[AuthModule] Failed to initialize CSRF after 3 attempts. Raising fatal modal.', lastError, { context: 'init' });
        if (modalManager && typeof modalManager.show === 'function') {
          modalManager.show('fatal', {
            title: 'Startup Failure',
            message: 'Could not fetch security token from the server after multiple attempts. Please check your connection or contact support.',
            type: 'error',
            context: 'CSRF_bootstrap'
          });
        }
      }
      let verified = false;
      try {
        verified = await verifyAuthState(true);
      } catch (verifyErr) {
        logger.error('[AuthModule] Error during init verifyAuthState:', verifyErr, { context: 'init' });
        await clearTokenState({ source: 'init_verify_error' });
        verified = false;
      }

      // Setup periodic verification
      const browserService = DependencySystem.modules.get('browserService');
      if (!browserService || typeof browserService.setInterval !== 'function') {
        logger.error('[AuthModule][init] browserService.setInterval is NOT available. Periodic auth verification will NOT run.', { context: 'init:setIntervalMissing' });
        throw new Error('[AuthModule] browserService.setInterval is required for periodic auth verification.');
      }
      if (verifyInterval) browserService.clearInterval(verifyInterval); // Clear existing if any (e.g. re-init)
      verifyInterval = browserService.setInterval(() => {
        const periodicState = getAppState();
        if (!domAPI.isDocumentHidden?.() && periodicState.isAuthenticated) { // Check if document is visible
          logger.debug('[AuthModule][init] Performing periodic auth verification.', { context: 'init:periodicVerify' });
          verifyAuthState(false).catch((err) => {
            logger.warn(
              '[AuthModule][init] Periodic verifyAuthState encountered an error (logged by verifyAuthState).',
              err,
              { context: 'init:periodicVerify:error' }
            );
          });
        } else {
          logger.debug('[AuthModule][init] Skipping periodic auth verification.', { isHidden: domAPI.isDocumentHidden?.(), isAuthenticated: periodicState.isAuthenticated, context: 'init:periodicVerifySkipped' });
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);
      logger.info('[AuthModule][init] Periodic auth verification scheduled.', { interval: AUTH_CONFIG.VERIFICATION_INTERVAL, context: 'init' });

      // Mark auth module as ready in the canonical state
      const appModuleRef = DependencySystem?.modules?.get('appModule');
      if (appModuleRef?.setAppLifecycleState) {
        appModuleRef.setAppLifecycleState({ isReady: true });
      }
      logger.info('[AuthModule][init] Auth module is now ready.', { context: 'init' });

      // Dispatch authReady event
      const finalState = getAppState();
      const readyEventDetail = {
        authenticated: finalState.isAuthenticated,
        user: finalState.currentUser,
        username: finalState.currentUser?.username || null,
        errorDetail: null, // No error at this stage of emitting 'authReady'
        timestamp: Date.now(),
        source: 'init_auth_module_ready'
      };

      if (!eventHandlers.createCustomEvent) {
        logger.error('[AuthModule][init] eventHandlers.createCustomEvent is NOT available. Cannot dispatch authReady event.', { context: 'init:dispatchAuthReady' });
      } else {
        logger.debug('[AuthModule][init] Dispatching authReady event.', { detail: readyEventDetail, context: 'init:dispatchAuthReady' });
        AuthBus.dispatchEvent(eventHandlers.createCustomEvent('authReady', { detail: readyEventDetail }));

        // Also broadcast via domReadinessService for global listeners/replay support
        try {
          if (!domReadinessService?.emitReplayable) {
            throw new Error('[AuthModule] domReadinessService.emitReplayable is required for emitting authReady event. Unsafe fallback disabled.');
          }
          logger.info('[AuthModule] emitReplayable authReady', { context: 'init:dispatchAuthReady', detail: readyEventDetail });
          domReadinessService.emitReplayable('authReady', readyEventDetail);
          logger.debug('[AuthModule] Successfully emitted authReady via domReadinessService', { context: 'init:dispatchAuthReady' });
        } catch (err) {
          logger.error('[AuthModule] Failed to emit authReady event', err, {
            context: 'init:dispatchAuthReady'
          });
        }
      }

      const broadcastState = getAppState();
      logger.debug('[AuthModule][init] Performing final broadcastAuth after init completion.', { authenticated: broadcastState.isAuthenticated, context: 'init' });
      broadcastAuth(broadcastState.isAuthenticated, broadcastState.currentUser, 'init_final_broadcast');

      return verified;
    } catch (err) {
      logger.error('[AuthModule][init] Unhandled error during initialization process.',
        err,
        { stack: err.stack, context: 'init:unhandledError' });
      await clearTokenState({ source: 'init_unhandled_error' });

      const appModuleRef = DependencySystem?.modules?.get('appModule');
      if (appModuleRef?.setAppLifecycleState) {
        appModuleRef.setAppLifecycleState({ isReady: true });
      }
      broadcastAuth(false, null, 'init_unhandled_error');
      throw err;
    }
  }

  function cleanup() {
    authFormListenerFactory.cleanup();
    if (verifyInterval) {
      const browserService = DependencySystem.modules.get('browserService');
      if (!browserService || typeof browserService.clearInterval !== 'function') {
        throw new Error('[AuthModule] browserService.clearInterval is required for guardrail compliance. No global clearInterval fallback allowed.');
      }
      browserService.clearInterval(verifyInterval);
      verifyInterval = null;
    }
  }

  // === 13) FETCH CURRENT USER ===
  async function fetchCurrentUser() {
    try {
      const resp = await apiClient(apiEndpoints.AUTH_VERIFY, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!resp) {
        const location = domAPI.getWindow()?.location;
        const browserService = DependencySystem?.modules?.get('browserService');
        const windowObj = browserService?.getWindow?.();
        if (!windowObj || typeof windowObj.URLSearchParams !== 'function') {
          logger.error('[AuthModule] window.URLSearchParams (via browserService.getWindow()) is required for guardrail compliance (fetchCurrentUser).', { context: 'fetchCurrentUser' });
        }
        const urlParams = location && windowObj?.URLSearchParams ? new windowObj.URLSearchParams(location.search) : null;
        const hasLoginParams = urlParams && urlParams.has('username') && urlParams.has('password');
        if (hasLoginParams) {
          return {
            username: urlParams.get('username'),
            id: 'temp-id-' + Date.now()
          };
        }
        return null;
      }
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
      if (userToReturn) return userToReturn;
      if (publicAuth.hasAuthCookies()) {
        return {
          username: 'authenticated-user',
          id: 'cookie-auth-' + Date.now()
        };
      }
      return null;
    } catch (error) {
      logger.error('[AuthModule][fetchCurrentUser][catch]', error, { context: 'fetchCurrentUser' });
      return null;
    }
  }

  // === 13.5) FETCH LIVE AUTH SETTINGS DIAGNOSTICS ===
  async function fetchAuthSettingsDiagnostic() {
    if (!apiEndpoints.AUTH_SETTINGS) {
      logger.error('[AuthModule] No AUTH_SETTINGS endpoint provided in apiEndpoints', { context: 'fetchAuthSettingsDiagnostic' });
      return;
    }
    try {
      const settings = await apiClient(apiEndpoints.AUTH_SETTINGS, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      logger.info('[AuthModule][fetchAuthSettingsDiagnostic] Backend config LIVE:', settings, { context: 'fetchAuthSettingsDiagnostic' });
      return settings;
    } catch (err) {
      logger.error('[AuthModule][fetchAuthSettingsDiagnostic] Error fetching auth settings:', err, { context: 'fetchAuthSettingsDiagnostic' });
      throw err;
    }
  }

  // === 14) PUBLIC API EXPORT (FACTORY PATTERN) ===
  const publicAuth = {
    // Auth actions only - state reads must go through appModule.state per guardrails
    init,
    login: loginUser,
    logout,
    register: registerUser,
    verifyAuthState,
    AuthBus,
    getCSRFTokenAsync,
    getCSRFToken,
    hasAuthCookies: () => {
      const doc = domAPI.getDocument?.();
      if (!doc || typeof doc.cookie !== 'string') return false;
      const cookieStr = doc.cookie || '';
      return /(?:^|;\s*)(access_token|refresh_token)=/.test(cookieStr);
    },
    cleanup,
    fetchCurrentUser,
    fetchAuthSettingsDiagnostic
  };

  return publicAuth;
}
