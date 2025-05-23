/**
 * auth.js
 *
 * Centralized, DI-compliant authentication module for login/logout/register/session/CSRF.
 * All authentication state, CSRF handling, API request/wrapping, form/event logic
 * is implemented in this single module—no dependencies outside DI context.
 *
 * Removal Notice: All previous modular primitives (authRequester, authState, csrfManager, etc.) are removed.
 * This module is now the single source of truth for ALL auth logic and event wiring.
 *
 * @module AuthModule
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

  // === safeHandler: For all event handlers (logging errors) ===
  function safeHandler(handler, description) {
    return (...args) => {
      try {
        return handler(...args);
      } catch (err) {
        logger.error(`[AuthModule][${description}] Handler exception`, err, { context: description });
        throw err;
      }
    };
  }

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

  const authState = {
    isAuthenticated: false,
    username: null,
    userObject: null,
    isReady: false
  };

  const AuthBus = new EventTarget();

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
  function getCSRFToken() {
    const current = readCookie('csrf_token');
    if (current && current !== csrfToken) csrfToken = current;
    if (current) {
      logger.log('[DIAGNOSTIC][auth.js][getCSRFToken] using cookie value [masked]', { context: 'getCSRFToken' });
    } else {
      logger.log('[DIAGNOSTIC][auth.js][getCSRFToken] no CSRF cookie found', { context: 'getCSRFToken' });
    }
    return csrfToken;
  }
  async function fetchCSRFToken() {
    if (!apiEndpoints.AUTH_CSRF) throw new Error('AUTH_CSRF endpoint missing in apiEndpoints');
    const csrfUrl = apiEndpoints.AUTH_CSRF;
    const url = csrfUrl.includes('?')
      ? `${csrfUrl}&ts=${Date.now()}`
      : `${csrfUrl}?ts=${Date.now()}`;
    logger.log('[DIAGNOSTIC][auth.js][fetchCSRFToken] Fetching', url, { context: 'fetchCSRFToken' });
    const data = await apiClient(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      credentials: 'include',
      cache: 'no-store'
    });
    if (!data || !data.token) {
      logger.error('[DIAGNOSTIC][auth.js][fetchCSRFToken] Missing or bad response:', data, { context: 'fetchCSRFToken' });
      throw new Error('CSRF token missing');
    }
    logger.log('[DIAGNOSTIC][auth.js][fetchCSRFToken] Received CSRF token (masked)', { context: 'fetchCSRFToken' });
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
        logger.log('[DIAGNOSTIC][auth.js][authRequest] Adding X-CSRF-Token header [masked] for', endpoint, { context: 'authRequest' });
      } else {
        logger.warn('[DIAGNOSTIC][auth.js][authRequest] No CSRF token found for state-changing request', endpoint, { context: 'authRequest' });
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
      logger.log('[DIAGNOSTIC][auth.js][authRequest][REQUEST]', endpoint, options, { context: 'authRequest' });
      const data = await apiClient(endpoint, options);
      logger.log('[DIAGNOSTIC][auth.js][authRequest][RESPONSE]', endpoint, data, { context: 'authRequest' });
      return data;
    } catch (error) {
      logger.error('[DIAGNOSTIC][auth.js][authRequest][ERROR]', endpoint, error, { context: 'authRequest' });
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

  // === 8) BROADCASTING AUTH STATE ===
  function broadcastAuth(authenticated, userObject = null, source = 'unknown') {
    logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] called.', {
      authenticated, userObject, source,
      previousAuth: authState.isAuthenticated,
      previousUserObject: authState.userObject
    }, { context: 'broadcastAuth' });
    const previousAuth = authState.isAuthenticated;
    const previousUserObject = authState.userObject;
    const changed =
      authenticated !== previousAuth ||
      JSON.stringify(userObject) !== JSON.stringify(previousUserObject);
    authState.isAuthenticated = authenticated;
    authState.userObject = userObject;
    authState.username = userObject?.username || null;
    if (changed) {
      const appModuleRef = DependencySystem?.modules?.get('appModule');
      if (appModuleRef && typeof appModuleRef.setAuthState === 'function') {
        logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] Setting appModule state', { isAuthenticated: authenticated, currentUser: userObject }, { context: 'broadcastAuth' });
        appModuleRef.setAuthState({ isAuthenticated: authenticated, currentUser: userObject });
      } else {
        logger.warn('[DIAGNOSTIC][auth.js][broadcastAuth] No appModuleRef or no setAuthState function!', { context: 'broadcastAuth' });
      }
      // Custom: Update username in header's userMenu for a single-line greeting. (No double "Hello,")
      try {
        const doc = domAPI.getDocument?.();
        const userMenu = doc && doc.getElementById && doc.getElementById('userMenu');
        if (userMenu) {
          const usernameDisplay = userMenu.querySelector('#usernameDisplay');
          const initialsSpan = userMenu.querySelector('#userInitials');
          if (usernameDisplay && userObject?.username) {
            // Only set username, do not prepend 'Hello,' (it's in markup)
            usernameDisplay.textContent = userObject.username;
          }
          if (initialsSpan && userObject?.username) {
            // Set user initials (e.g., "AB" for Alice Bob)
            const initials = userObject.username.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            initialsSpan.textContent = initials;
          }
        }
      } catch (DOMerr) {
        logger.error('[AuthModule][broadcastAuth] Could not update userMenu', DOMerr, { context: 'broadcastAuth' });
      }
      const eventDetail = {
        authenticated,
        user: userObject,
        timestamp: Date.now(),
        source
      };
      try {
        logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] Dispatching authStateChanged on AuthBus', eventDetail, { context: 'broadcastAuth' });
        if (!eventHandlers.createCustomEvent) {
          throw new Error('[AuthModule] eventHandlers.createCustomEvent is required to DI-create events for guardrail compliance.');
        }
        AuthBus.dispatchEvent(eventHandlers.createCustomEvent('authStateChanged', { detail: eventDetail }));
      } catch (busErr) {
        logger.error('[DIAGNOSTIC][auth.js][broadcastAuth] AuthBus dispatch failed', busErr, { context: 'broadcastAuth' });
      }
      try {
        const doc = domAPI.getDocument();
        if (doc) {
          logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] Dispatching authStateChanged on doc', { context: 'broadcastAuth' });
          if (!eventHandlers.createCustomEvent) {
            throw new Error('[AuthModule] eventHandlers.createCustomEvent is required to DI-create events for guardrail compliance.');
          }
          domAPI.dispatchEvent(
            doc,
            eventHandlers.createCustomEvent('authStateChanged', {
              detail: {
                ...eventDetail,
                source: source + '_via_auth_module'
              }
            })
          );
        }
      } catch (err) {
        logger.error('[DIAGNOSTIC][auth.js][broadcastAuth] doc dispatch failed', err, { context: 'broadcastAuth' });
      }
    } else {
      logger.log('[DIAGNOSTIC][auth.js][broadcastAuth] No auth/user change; not broadcasting', { context: 'broadcastAuth' });
    }
  }

  // === 9) VERIFICATION, AUTO-REFRESH ===
  let authCheckInProgress = false;
  const AUTH_CONFIG = { VERIFICATION_INTERVAL: 300000 };
  let verifyInterval = null;
  async function verifyAuthState(forceVerify = false) {
    // Remove the early return that was causing issues with page refresh
    // Always check auth state on page load/refresh regardless of recent login timestamp
    if (authCheckInProgress && !forceVerify) return authState.isAuthenticated;
    authCheckInProgress = true;
    try {
      // Check if we have auth cookies first - if not, no point in making the request
      const hasCookies = publicAuth.hasAuthCookies();
      if (!hasCookies && !forceVerify) {
        logger.log('[verifyAuthState] No auth cookies found, skipping verification', { context: 'verifyAuthState' });
        await clearTokenState({ source: 'no_auth_cookies' });
        broadcastAuth(false, null, 'no_auth_cookies');
        return false;
      }

      logger.log('[verifyAuthState] Verifying auth state with backend', {
        forceVerify,
        hasCookies,
        context: 'verifyAuthState'
      });

      let response = await authRequest(apiEndpoints.AUTH_VERIFY, 'GET');
      if (typeof response === 'string') {
        try {
          response = JSON.parse(response);
        } catch (parseErr) {
          logger.error('[verifyAuthState][parseErr]', parseErr, { context: 'verifyAuthState' });
        }
      }

      // Enhanced response validation
      let userObject = null;
      if (response && typeof response === 'object') {
        if (response.user && typeof response.user === 'object' && response.user.id) {
          userObject = response.user;
        } else if (response.id && response.username) {
          userObject = response;
        }
      }

      let finalUserObject = null;
      if (userObject) {
        const userIdFromObject = userObject.id || userObject.user_id || userObject.userId || userObject._id;
        if (userIdFromObject) {
          finalUserObject = { ...userObject, id: userIdFromObject };
        }
      }

      const hasValidUserId = Boolean(finalUserObject && finalUserObject.id);
      if (hasValidUserId) {
        logger.log('[verifyAuthState] Successfully verified user', {
          username: finalUserObject.username,
          context: 'verifyAuthState'
        });
        broadcastAuth(true, finalUserObject, 'verify_success_with_user_id');
        return true;
      }

      // Check for boolean authentication flags
      const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
      const isAuthenticatedByFlags =
        truthy(response?.authenticated) ||
        truthy(response?.is_authenticated) ||
        truthy(response?.auth) ||
        truthy(response?.isAuth) ||
        String(response?.authenticated).toLowerCase() === 'true' ||
        String(response?.is_authenticated).toLowerCase() === 'true';

      const hasUsername = Boolean(response?.username || (response?.user && response.user.username));

      if (isAuthenticatedByFlags || hasUsername) {
        const tempUserObj = hasUsername && !finalUserObject
          ? {
            username: response?.username || response?.user?.username || 'user',
            id: response?.id || response?.user?.id || ('temp-id-' + Date.now())
          }
          : null;
        logger.log('[verifyAuthState] Verified via flags/username', {
          isAuthenticatedByFlags,
          hasUsername,
          context: 'verifyAuthState'
        });
        broadcastAuth(true, tempUserObj || null, 'verify_success_via_alternative_checks');
        return true;
      }

      // If we have cookies but backend says we're not authenticated, the cookies are stale
      if (hasCookies) {
        logger.warn(
          '[AuthModule][verifyAuthState] Auth cookies found but backend verification failed – clearing stale cookies.',
          { context: 'verifyAuthState' }
        );
        await clearTokenState({ source: 'stale_auth_cookies' });
      }

      logger.log('[verifyAuthState] No valid authentication found', { context: 'verifyAuthState' });
      await clearTokenState({ source: 'verify_negative_after_all_checks' });
      broadcastAuth(false, null, 'verify_negative_after_all_checks');
      return false;
    } catch (error) {
      logger.error('[verifyAuthState][catch]', error, { context: 'verifyAuthState' });

      if (error.status === 500) {
        await clearTokenState({ source: 'verify_500_error' });
        broadcastAuth(false, null, 'verify_500_error');
        return false;
      }

      if (error.status === 401) {
        logger.log('[verifyAuthState] 401 error, attempting token refresh', { context: 'verifyAuthState' });
        try {
          await refreshTokens();
          return await verifyAuthState(true);
        } catch (refreshErr) {
          logger.error('[verifyAuthState][refreshErr]', refreshErr, { context: 'verifyAuthState' });
          await clearTokenState({ source: 'refresh_failed_after_401' });
          broadcastAuth(false, null, 'refresh_failed_after_401');
          return false;
        }
      }

      // For network errors or other issues, don't immediately clear auth state
      // if we have cookies - the user might just have a temporary connection issue
      const hasCookies = publicAuth.hasAuthCookies();
      if (hasCookies && (error.status === 0 || !error.status)) {
        logger.warn('[verifyAuthState] Network error but auth cookies present, maintaining auth state', {
          error: error.message,
          context: 'verifyAuthState'
        });
        // Don't change auth state for network errors
        return authState.isAuthenticated;
      }

      await clearTokenState({ source: `verify_unhandled_error_${error.status || 'unknown'}` });
      broadcastAuth(false, null, `verify_unhandled_error_${error.status || 'unknown'}`);
      return false;
    } finally {
      authCheckInProgress = false;
    }
  }

  // === 10) PUBLIC AUTH ACTIONS: login, logout, register ===

  async function loginUser(username, password) {
    try {
      logger.log('[DIAGNOSTIC][auth.js][loginUser] Attempting login', username, { context: 'loginUser' });
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_LOGIN, 'POST', {
        username: username.trim(),
        password
      });
      logger.log('[DIAGNOSTIC][auth.js][loginUser][API RESPONSE]', response, { context: 'loginUser' });
      // Store bearer tokens if present
      if (response && response.access_token) {
        accessToken = response.access_token;
        tokenType = response.token_type || 'Bearer';
        refreshToken = response.refresh_token || null;
      }
      try {
        const doc = domAPI.getDocument?.();
        if (doc && typeof doc.cookie === 'string') {
          logger.log('[DIAGNOSTIC][auth.js][loginUser] Cookies after login: [masked]', { context: 'loginUser' });
        } else {
          logger.log('[DIAGNOSTIC][auth.js][loginUser] Unable to read document.cookie', { context: 'loginUser' });
        }
      } catch (cookieErr) {
        logger.error('[DIAGNOSTIC][auth.js][loginUser] Exception reading cookies:', cookieErr, { context: 'loginUser' });
      }
      if (response && response.username) {
        const userObject = {
          username: response.username,
          id: response.id || response.user_id || response.userId || (`temp-id-${Date.now()}`)
        };
        broadcastAuth(true, userObject, 'login_success_immediate');
        _lastLoginTimestamp = Date.now();
        try {
          const doc = domAPI.getDocument?.();
          if (doc && typeof doc.cookie === 'string' && (!doc.cookie || doc.cookie === '')) {
            logger.warn('[DIAGNOSTIC][auth.js][loginUser] WARNING: No cookies set after successful login! Backend may not be setting cookies.', { context: 'loginUser' });
          }
        } catch (cookieCheckErr) {
          logger.error('[AuthModule] Cookie check after login failed (non-critical):', cookieCheckErr, { context: 'loginUser' });
        }
        return response;
      }
      logger.warn('[DIAGNOSTIC][auth.js][loginUser] Login response lacked user data – broadcasting provisional auth state.', { context: 'loginUser' });
      const provisionalUser = {
        username: username.trim(),
        id: `temp-${Date.now()}`
      };
      broadcastAuth(true, provisionalUser, 'login_success_provisional');
      _lastLoginTimestamp = Date.now();
      try {
        const doc = domAPI.getDocument?.();
        if (doc && typeof doc.cookie === 'string' && (!doc.cookie || doc.cookie === '')) {
          logger.log('[DIAGNOSTIC][auth.js][loginUser] Cookies after login: [masked]', { context: 'loginUser' });
        }
      } catch (cookieCheckErr) {
        logger.error('[AuthModule] Cookie check after provisional login failed (non-critical):', cookieCheckErr, { context: 'loginUser' });
      }
      return response;
    } catch (error) {
      logger.error('[DIAGNOSTIC][auth.js][loginUser][ERROR]', error, { context: 'loginUser' });
      await clearTokenState({ source: 'login_error' });
      throw error;
    }
  }

  async function logout() {
    logger.log('[DIAGNOSTIC][auth.js][logout] Logging out', { context: 'logout' });
    accessToken = null;
    refreshToken = null;
    await clearTokenState({ source: 'logout_manual' });
    try {
      await getCSRFTokenAsync();
      await authRequest(apiEndpoints.AUTH_LOGOUT, 'POST');
      logger.log('[DIAGNOSTIC][auth.js][logout] Logout POST done', { context: 'logout' });
    } catch (err) {
      logger.error('[DIAGNOSTIC][auth.js][logout][ERROR]', err, { context: 'logout' });
    }
  }

  async function registerUser(userData) {
    if (!userData?.username || !userData?.password) {
      throw new Error('Username and password required.');
    }
    try {
      logger.log('[DIAGNOSTIC][auth.js][registerUser] Registering', userData.username, { context: 'registerUser' });
      await getCSRFTokenAsync();
      const response = await authRequest(apiEndpoints.AUTH_REGISTER, 'POST', {
        username: userData.username.trim(),
        password: userData.password
      });
      logger.log('[DIAGNOSTIC][auth.js][registerUser][API RESPONSE]', response, { context: 'registerUser' });
      await verifyAuthState(true);
      return response;
    } catch (error) {
      logger.error('[DIAGNOSTIC][auth.js][registerUser][ERROR]', error, { context: 'registerUser' });
      await clearTokenState({ source: 'register_error' });
      throw error;
    }
  }

  // === 11) FORM EVENT HANDLER SETUP ===
  const registeredListeners = [];
  function setupAuthForms() {
    // #loginModalForm
    const loginForm = domAPI.getElementById('loginModalForm');
    if (loginForm && !loginForm._listenerAttached) {
      loginForm._listenerAttached = true;
      domAPI.setAttribute(loginForm, 'novalidate', 'novalidate');
      domAPI.removeAttribute(loginForm, 'action');
      domAPI.removeAttribute(loginForm, 'method');
      const handler = async (e) => {
        logger.log('[AuthModule] loginModalForm submit handler invoked. Event:', e, { context: 'loginModalForm' });
        domAPI.preventDefault(e);
        const errorEl = domAPI.getElementById('loginModalError');
        hideError(errorEl);
        const submitBtn = domAPI.querySelector('button[type="submit"]', loginForm);
        setButtonLoading(submitBtn, true, 'Logging in...');
        const browserService = DependencySystem.modules.get('browserService');
        if (!browserService || !browserService.FormData) {
          throw new Error('[AuthModule] browserService.FormData is required for guardrail compliance. No global FormData fallback allowed.');
        }
        const formData = new browserService.FormData(loginForm);
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
          if (modalManager?.hide) modalManager.hide('login');
        } catch (error) {
          logger.error('[loginModalForm][catch]', error, { context: 'loginModalForm' });
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
        eventHandlers.trackListener(loginForm, 'submit', safeHandler(handler, 'AuthModule:loginFormSubmit', logger), {
          passive: false,
          context: 'AuthModule:loginFormSubmit',
          description: 'Login Form Submit'
        })
      );
    }

    // #registerModalForm
    const registerForm = domAPI.getElementById('registerModalForm');
    if (registerForm && !registerForm._listenerAttached) {
      registerForm._listenerAttached = true;
      domAPI.setAttribute(registerForm, 'novalidate', 'novalidate');
      domAPI.removeAttribute(registerForm, 'action');
      domAPI.removeAttribute(registerForm, 'method');
      const handler = async (e) => {
        domAPI.preventDefault(e);
        const errorEl = domAPI.getElementById('registerModalError');
        const submitBtn = domAPI.getElementById('registerModalSubmitBtn');
        hideError(errorEl);
        setButtonLoading(submitBtn, true, 'Registering...');
        const browserService = DependencySystem.modules.get('browserService');
        if (!browserService || !browserService.FormData) {
          throw new Error('[AuthModule] browserService.FormData is required for guardrail compliance. No global FormData fallback allowed.');
        }
        const formData = new browserService.FormData(registerForm);
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
          if (modalManager?.hide) modalManager.hide('login');
        } catch (error) {
          logger.error('[registerModalForm][catch]', error, { context: 'registerModalForm' });
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
        eventHandlers.trackListener(registerForm, 'submit', safeHandler(handler, 'AuthModule:registerFormSubmit', logger), {
          passive: false,
          context: 'AuthModule:registerFormSubmit',
          description: 'Register Form Submit'
        })
      );
    }
  }

  // === 12) MODULE INIT & CLEANUP ===

  async function init() {
    // Wait for DOM/app readiness strictly via domReadinessService—no ad-hoc or legacy logic
    // Prevent multiple initializations
    if (authState.isReady) {
      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_already_ready');
      return authState.isAuthenticated;
    }
    setupAuthForms();
    // modalsLoaded, DOM are both handled via the same readiness patterns
    const doc = domAPI.getDocument();
    if (doc && typeof eventHandlers.trackListener === "function") {
      eventHandlers.trackListener(
        doc,
        'modalsLoaded',
        safeHandler(function handleModalsLoadedTracked() {
          eventHandlers.cleanupListeners({ context: 'AuthModule:modalsLoadedListener' });
          setupAuthForms();
          const browserServiceForTimeout = DependencySystem?.modules?.get('browserService');
          if (!browserServiceForTimeout || typeof browserServiceForTimeout.setTimeout !== 'function') {
            logger.error('[AuthModule] browserService.setTimeout is required for guardrail compliance (latePatchTimeout).', { context: 'modalsLoaded' });
            return;
          }
          browserServiceForTimeout.setTimeout(() => {
            const loginF = domAPI.getElementById('loginModalForm');
            if (loginF) {
              domAPI.removeAttribute(loginF, 'action');
              domAPI.removeAttribute(loginF, 'method');
              if (!loginF._listenerAttached) {
                loginF._listenerAttached = true;
                domAPI.setAttribute(loginF, 'novalidate', 'novalidate');
                const lateHandler = async (e) => {
                  domAPI.preventDefault(e);
                  const errorEl = domAPI.getElementById('loginModalError');
                  hideError(errorEl);
                  const submitBtn = domAPI.querySelector('button[type="submit"]', loginF);
                  setButtonLoading(submitBtn, true, 'Logging in...');
                  const browserService = DependencySystem.modules.get('browserService');
                  if (!browserService || !browserService.FormData) {
                    throw new Error('[AuthModule] browserService.FormData is required for guardrail compliance. No global FormData fallback allowed.');
                  }
                  const formData = new browserService.FormData(loginF);
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
                    if (modalManager?.hide) modalManager.hide('login');
                  } catch (error) {
                    logger.error('[loginModalForm:latepatch][catch]', error, { context: 'loginModalForm:latepatch' });
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
                eventHandlers.trackListener(loginF, 'submit', safeHandler(lateHandler, 'AuthModule:loginFormSubmit:LATEPATCH_TRACKED', logger), {
                  passive: false,
                  context: 'AuthModule:loginFormSubmit:LATEPATCH_TRACKED',
                  description: 'Login Form Late Patch Submit (tracked)'
                });
              }
            }
          }, 400);
        }, 'AuthModule:modalsLoadedListener', logger),
        {
          passive: false,
          context: 'AuthModule:modalsLoadedListener',
          description: 'Track modalsLoaded via centralized handler'
        }
      );
    }
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
      const browserService = DependencySystem.modules.get('browserService');
      if (!browserService || typeof browserService.setInterval !== 'function') {
        throw new Error('[AuthModule] browserService.setInterval is required for guardrail compliance. No global setInterval fallback allowed.');
      }
      verifyInterval = browserService.setInterval(() => {
        if (!domAPI.isDocumentHidden && authState.isAuthenticated) {
          verifyAuthState(false).catch((err) => {
            logger.debug('[AuthModule] Periodic verifyAuthState failed (silent):', err, { context: 'init' });
          });
        }
      }, AUTH_CONFIG.VERIFICATION_INTERVAL);
      authState.isReady = true;
      const readyEventDetail = {
        authenticated: authState.isAuthenticated,
        user: authState.userObject,
        username: authState.username,
        error: null,
        timestamp: Date.now(),
        source: 'init_complete'
      };
      if (!eventHandlers.createCustomEvent) {
        logger.error('[AuthModule] eventHandlers.createCustomEvent is required to DI-create authReady event.', { context: 'init' });
      } else {
        AuthBus.dispatchEvent(eventHandlers.createCustomEvent('authReady', { detail: readyEventDetail }));
        try {
          const doc = domAPI.getDocument();
          if (doc) {
            domAPI.dispatchEvent(doc, eventHandlers.createCustomEvent('authReady', { detail: readyEventDetail }));
          }
        } catch (docErr) {
          logger.error('[AuthModule] Failed to dispatch authReady on document', docErr, { context: 'init' });
        }
      }
      broadcastAuth(authState.isAuthenticated, authState.userObject, 'init_complete');
      return verified;
    } catch (err) {
      logger.error('[AuthModule][init][unhandled]', err, { context: 'init' });
      await clearTokenState({ source: 'init_unhandled_error' });
      authState.isReady = true;
      broadcastAuth(false, null, 'init_unhandled_error');
      throw err;
    }
  }

  function cleanup() {
    if (DependencySystem && typeof DependencySystem.cleanupModuleListeners === 'function') {
      DependencySystem.cleanupModuleListeners('AuthModule');
    } else if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: 'AuthModule' });
    }
    registeredListeners.length = 0;
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
