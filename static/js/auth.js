/**
 * auth.js - Refactored Authentication Module (Phase-2)
 * ---------------------------------------------------
 * Slim coordinator that orchestrates authentication using extracted modules:
 * - AuthFormHandler: Form validation and UI interactions
 * - AuthApiService: API calls and CSRF management
 * - AuthStateManager: State management and events
 * 
 * Reduced from 1232 → ~400 lines through separation of concerns.
 */

import { createAuthFormHandler } from './authFormHandler.js';
import { createAuthApiService } from './authApiService.js';
import { createAuthStateManager } from './authStateManager.js';

export function createAuth(deps) {
  // === FACTORY GUARDRAIL: STRICT DI VALIDATION ===
  if (!deps || typeof deps !== "object") {
    throw new Error("[AuthModule] 'deps' DI object is required as argument to createAuth");
  }
  
  const requiredDeps = [
    'apiClient', 'logger', 'domReadinessService', 'eventHandlers',
    'domAPI', 'sanitizer', 'apiEndpoints', 'safeHandler', 'browserService',
    'eventService', 'appModule', 'APP_CONFIG'
  ];
  
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`[AuthModule] DI param '${dep}' is required.`);
    }
  }

  const {
    apiClient, eventHandlers, domAPI, sanitizer, modalManager,
    apiEndpoints, DependencySystem, logger, domReadinessService,
    safeHandler, browserService, eventService, storageService,
    appModule,
    APP_CONFIG
  } = deps;

  const MODULE_CONTEXT = 'AuthModule';

  // === EXTRACTED MODULE INSTANCES ===
  const formHandler = createAuthFormHandler({
    domAPI, sanitizer, eventHandlers, logger, safeHandler
  });

  const apiService = createAuthApiService({
    apiClient, apiEndpoints, logger, browserService
  });

  const stateManager = createAuthStateManager({
    eventService,
    logger,
    browserService,
    storageService
  });

  // === LEGACY EVENT BUS SUPPORT ===
  if (!eventService.getAuthBus) {
    throw new Error('[auth] eventService.getAuthBus() is required');
  }
  const AuthBus = eventService.getAuthBus();

  // === APP STATE INTEGRATION ===
  function getAppState() {
    if (!appModule?.state) {
      logger.warn('[AuthModule] appModule.state not available. Using fallback empty state.', {
        context: MODULE_CONTEXT
      });
      return { isAuthenticated: false, currentUser: null, isReady: false };
    }
    return appModule.state;
  }

  function updateAppState(authData) {
    if (typeof appModule?.setAuthState === 'function') {
      appModule.setAuthState(authData);
    }
  }

  // === CORE AUTHENTICATION METHODS ===
  async function login(username, password) {
    logger.info('[AuthModule] Login attempt', { 
      username, 
      context: MODULE_CONTEXT + ':login' 
    });

    try {
      // Validate inputs using form handler
      const usernameValidation = formHandler.validateUsername(username);
      const passwordValidation = formHandler.validatePassword(password);

      if (!usernameValidation.valid) {
        throw new Error(usernameValidation.message);
      }
      if (!passwordValidation.valid) {
        throw new Error(passwordValidation.message);
      }

      // Perform login via API service
      const response = await apiService.login(usernameValidation.value, passwordValidation.value);

      // Update state managers
      stateManager.setAuthenticatedState(response.user);
      updateAppState({
        isAuthenticated: true,
        currentUser: response.user
      });

      logger.info('[AuthModule] Login successful', { 
        userId: response.user.id,
        username: response.user.username,
        context: MODULE_CONTEXT + ':login' 
      });

      return response;
    } catch (err) {
      logger.error('[AuthModule] Login failed', err, { 
        username, 
        context: MODULE_CONTEXT + ':login' 
      });
      throw err;
    }
  }

  async function logout() {
    logger.info('[AuthModule] Logout attempt', { context: MODULE_CONTEXT + ':logout' });

    try {
      // Perform logout via API service
      await apiService.logout();

      // Update state managers
      stateManager.setUnauthenticatedState();
      updateAppState({
        isAuthenticated: false,
        currentUser: null
      });

      logger.info('[AuthModule] Logout successful', { context: MODULE_CONTEXT + ':logout' });
    } catch (err) {
      logger.error('[AuthModule] Logout failed', err, { context: MODULE_CONTEXT + ':logout' });
      // Update state even if API call failed (cleanup local state)
      stateManager.setUnauthenticatedState();
      updateAppState({
        isAuthenticated: false,
        currentUser: null
      });
      throw err;
    }
  }

  async function register(username, email, password) {
    logger.info('[AuthModule] Registration attempt', { 
      username, email, 
      context: MODULE_CONTEXT + ':register' 
    });

    try {
      // Validate inputs using form handler
      const usernameValidation = formHandler.validateUsername(username);
      const emailValidation = formHandler.validateEmail(email);
      const passwordValidation = formHandler.validatePassword(password);

      if (!usernameValidation.valid) {
        throw new Error(usernameValidation.message);
      }
      if (!emailValidation.valid) {
        throw new Error(emailValidation.message);
      }
      if (!passwordValidation.valid) {
        throw new Error(passwordValidation.message);
      }

      // Perform registration via API service
      const response = await apiService.register(
        usernameValidation.value, 
        emailValidation.value, 
        passwordValidation.value
      );

      logger.info('[AuthModule] Registration successful', { 
        username, email,
        context: MODULE_CONTEXT + ':register' 
      });

      return response;
    } catch (err) {
      logger.error('[AuthModule] Registration failed', err, { 
        username, email,
        context: MODULE_CONTEXT + ':register' 
      });
      throw err;
    }
  }

  async function verifySession() {
    logger.debug('[AuthModule] Verifying session', { context: MODULE_CONTEXT + ':verify' });

    try {
      const response = await apiService.verifySession();

      if (response.authenticated && response.user) {
        // Update state managers
        stateManager.setAuthenticatedState(response.user);
        stateManager.updateLastVerification();
        updateAppState({
          isAuthenticated: true,
          currentUser: response.user
        });

        logger.debug('[AuthModule] Session verification successful', { 
          userId: response.user.id,
          context: MODULE_CONTEXT + ':verify' 
        });
      } else {
        // Update to unauthenticated state
        stateManager.setUnauthenticatedState();
        updateAppState({
          isAuthenticated: false,
          currentUser: null
        });

        logger.debug('[AuthModule] Session verification failed - not authenticated', { 
          context: MODULE_CONTEXT + ':verify' 
        });
      }

      return response;
    } catch (err) {
      logger.error('[AuthModule] Session verification error', err, { 
        context: MODULE_CONTEXT + ':verify' 
      });
      
      // Set unauthenticated state on error
      stateManager.setUnauthenticatedState();
      updateAppState({
        isAuthenticated: false,
        currentUser: null
      });

      return { authenticated: false, user: null };
    }
  }

  async function refreshSession() {
    logger.info('[AuthModule] Refreshing session', { context: MODULE_CONTEXT + ':refresh' });

    try {
      const response = await apiService.refreshSession();

      if (response.success && response.user) {
        stateManager.setAuthenticatedState(response.user);
        stateManager.updateLastVerification();
        updateAppState({
          isAuthenticated: true,
          currentUser: response.user
        });

        logger.info('[AuthModule] Session refresh successful', { 
          userId: response.user.id,
          context: MODULE_CONTEXT + ':refresh' 
        });
      }

      return response;
    } catch (err) {
      logger.error('[AuthModule] Session refresh failed', err, { 
        context: MODULE_CONTEXT + ':refresh' 
      });
      throw err;
    }
  }

  // === ACCESS TOKEN HELPERS (legacy compatibility) ===
  function getAccessToken() {
    try {
      if (storageService && typeof storageService.getItem === 'function') {
        return storageService.getItem('access_token');
      }
      return null;
    } catch (err) {
      logger.error('[AuthModule] getAccessToken failed', err,
        { context: MODULE_CONTEXT + ':getAccessToken' });
      return null;
    }
  }

  function getAccessTokenAsync() {
    return Promise.resolve(getAccessToken());
  }

  // === FORM INTEGRATION ===
  function bindLoginForm(formElement) {
    if (!formElement) {
      logger.warn('[AuthModule] bindLoginForm called with null form element',
                  { context: MODULE_CONTEXT + ':bindLoginForm' });
      return;
    }

    formHandler.bindFormSubmission(formElement, async (data, form) => {
      const submitBtn = form.querySelector('button[type="submit"]');
      
      try {
        formHandler.setButtonLoading(submitBtn, true, 'Signing in...');
        formHandler.hideError(form);

        await login(data.username, data.password);
        
        // Clear form on success
        formHandler.clearForm(form);
        
        // Close modal if it exists
        if (modalManager?.hide) {
          modalManager.hide();
        }
        
      } catch (err) {
        logger.error('[AuthModule] Login form submission failed', err,
          { context: MODULE_CONTEXT + ':LoginForm' });
        formHandler.showError(form, err.message || 'Login failed. Please try again.');
      } finally {
        formHandler.setButtonLoading(submitBtn, false);
      }
    }, { context: MODULE_CONTEXT + ':LoginForm' });

    // Bind input validation
    const usernameInput = formElement.querySelector('input[name="username"]');
    const passwordInput = formElement.querySelector('input[name="password"]');
    
    if (usernameInput) {
      formHandler.bindInputValidation(usernameInput, formHandler.validateUsername, {
        context: MODULE_CONTEXT + ':LoginForm'
      });
    }
    
    if (passwordInput) {
      formHandler.bindInputValidation(passwordInput, formHandler.validatePassword, {
        context: MODULE_CONTEXT + ':LoginForm'
      });
    }
  }

  function bindRegisterForm(formElement) {
    if (!formElement) {
      logger.warn('[AuthModule] bindRegisterForm called with null form element',
                  { context: MODULE_CONTEXT + ':bindRegisterForm' });
      return;
    }

    formHandler.bindFormSubmission(formElement, async (data, form) => {
      const submitBtn = form.querySelector('button[type="submit"]');
      
      try {
        formHandler.setButtonLoading(submitBtn, true, 'Creating account...');
        formHandler.hideError(form);

        await register(data.username, data.email, data.password);
        
        // Clear form on success
        formHandler.clearForm(form);
        
        // Show success message
        formHandler.showError(form, 'Account created successfully! You can now sign in.');
        
      } catch (err) {
        logger.error('[AuthModule] Registration form submission failed', err,
          { context: MODULE_CONTEXT + ':RegisterForm' });
        formHandler.showError(form, err.message || 'Registration failed. Please try again.');
      } finally {
        formHandler.setButtonLoading(submitBtn, false);
      }
    }, { context: MODULE_CONTEXT + ':RegisterForm' });

    // Bind input validation
    const usernameInput = formElement.querySelector('input[name="username"]');
    const emailInput = formElement.querySelector('input[name="email"]');
    const passwordInput = formElement.querySelector('input[name="password"]');
    
    if (usernameInput) {
      formHandler.bindInputValidation(usernameInput, formHandler.validateUsername, {
        context: MODULE_CONTEXT + ':RegisterForm'
      });
    }
    
    if (emailInput) {
      formHandler.bindInputValidation(emailInput, formHandler.validateEmail, {
        context: MODULE_CONTEXT + ':RegisterForm'
      });
    }
    
    if (passwordInput) {
      formHandler.bindInputValidation(passwordInput, formHandler.validatePassword, {
        context: MODULE_CONTEXT + ':RegisterForm'
      });
    }
  }

  // === INITIALIZATION ===
  async function initialize() {
    logger.info('[AuthModule] Initializing', { context: MODULE_CONTEXT + ':initialize' });

    try {
      // Initialize from stored data
      const storedUser = stateManager.initializeFromStorage();
      if (storedUser) {
        logger.debug('[AuthModule] Found stored user data, will verify session', {
          username: storedUser.username,
          context : MODULE_CONTEXT + ':initialize'
        });
      }

      // Wait for global "app:ready" event with extended timeout. Use configurable
      // APP_READY_WAIT so slower devices/network conditions do not cause a
      // bootstrap dead-letter. Falls back to 30 s if the config key is missing.
      const appReadyTimeout = APP_CONFIG?.TIMEOUTS?.APP_READY_WAIT ?? 30000;
      await domReadinessService.waitForEvent('app:ready', { timeout: appReadyTimeout, context: MODULE_CONTEXT + ':initialize' });

      // Verify current session
      await verifySession();

      // Set up periodic session verification
      if (stateManager.isAuthenticated() && stateManager.shouldVerifySession(60000)) {
        // Verify every minute if no recent verification
        setInterval(() => {
          if (stateManager.shouldVerifySession()) {
            verifySession().catch(err => {
              logger.warn('[AuthModule] Periodic session verification failed', err,
                          { context: MODULE_CONTEXT + ':periodicVerify' });
            });
          }
        }, 60000);
      }

      logger.info('[AuthModule] Initialization complete', { 
        authenticated: stateManager.isAuthenticated(),
        context: MODULE_CONTEXT + ':initialize' 
      });

    } catch (err) {
      logger.error('[AuthModule] Initialization failed', err, { 
        context: MODULE_CONTEXT + ':initialize' 
      });
      throw err;
    }
  }

  // === PUBLIC API ===
  return {
    // Authentication methods
    login,
    logout,
    register,
    verifySession,
    refreshSession,

    // State queries (delegate to state manager)
    isAuthenticated: () => stateManager.isAuthenticated(),
    getCurrentUser: () => stateManager.getCurrentUser(),
    getCurrentUserId: () => stateManager.getCurrentUserId(),
    getCurrentUsername: () => stateManager.getCurrentUsername(),
    getAuthState: () => stateManager.getAuthState(),

    // Form binding
    bindLoginForm,
    bindRegisterForm,

    // CSRF management (delegate to API service)
    getCSRFToken: () => apiService.getCSRFToken(),
    getCSRFTokenAsync: (force) => apiService.getCSRFTokenAsync(force),

    // Access token helpers (legacy)
    getAccessToken,
    getAccessTokenAsync,

    // Initialization
    initialize,
    // Alias for backward-compatibility with appInitializer expectations
    init: (...args) => initialize(...args),

    // Legacy compatibility
    AuthBus, // For backward compatibility
    getAppState, // For legacy access patterns

    // Utility methods (delegate to form handler)
    validateUsername: (u) => formHandler.validateUsername(u),
    validatePassword: (p) => formHandler.validatePassword(p),
    validateEmail: (e) => formHandler.validateEmail(e),

    // Session management
    getSessionAge: () => stateManager.getSessionAge(),
    shouldVerifySession: (threshold) => stateManager.shouldVerifySession(threshold),

    cleanup() {
      logger.debug('[AuthModule] cleanup()', { context: MODULE_CONTEXT });
      
      // Cleanup extracted modules
      formHandler.cleanup();
      apiService.cleanup();
      stateManager.cleanup();
      
      // Cleanup event listeners
      eventHandlers.cleanupListeners({ context: MODULE_CONTEXT });
    }
  };
}

export default createAuth;

// Provide legacy alias for DI registration compatibility
export { createAuth as createAuthModule };
