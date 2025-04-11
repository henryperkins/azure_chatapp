/**
 * chat-utils.js
 * Centralized utility functions for chat application
 */

// Module initialization utilities
window.InitUtils = {
  featureModules: [],

  /**
   * Initialize a module with error handling
   * @param {string} moduleName - Name of module for logging
   * @param {Function} initFn - Initialization function
   * @returns {Promise<void>}
   */
  initModule: async function (moduleName, initFn) {
    try {
      console.log(`⏳ Initializing ${moduleName}...`);
      await initFn();
      console.log(`✅ ${moduleName} initialized successfully`);
    } catch (error) {
      console.error(`[Auth] Error during ${moduleName} initialization:`, error);
      throw error;
    }
  }
};

window.ChatUtils = {
  // Track recently shown errors to prevent duplicates
  _lastError: null,
  _lastErrorTime: 0,
  _errorDebounceMs: 1000, // Don't show same error within 1 second

  /**
   * Initialize chat utilities and integrate with auth module
   * @returns {Promise<void>}
   */
  async init() {
    await window.InitUtils.initModule('ChatUtils', () => {
      // Setup auth state listener
      document.addEventListener('authStateChanged', (e) => {
        const { authenticated } = e.detail;
        this.broadcastAuth(authenticated);
      });
    });
  },

  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>}
   */
  async isAuthenticated() {
    try {
      return await window.auth?.isAuthenticated?.({ forceVerify: true }) || false;
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  },

  /**
   * Centralized error handler for chat components
   * @param {string} context - Error context description
   * @param {Error|string} error - Error object or message
   * @param {Function} [fallbackNotify] - Notification function if Notifications unavailable
   */
  handleError(context, error, fallbackNotify) {
    // Check if this is a duplicate of the last shown error
    const now = Date.now();
    const errorStr = error instanceof Error ? error.message : String(error);

    if (this._lastError === errorStr &&
      now - this._lastErrorTime < this._errorDebounceMs) {
      console.debug(`[${context}] Duplicate error suppressed:`, errorStr);
      return;
    }

    this._lastError = errorStr;
    this._lastErrorTime = now;
    console.error(`[${context}]`, error);

    // Format authentication error messages in a user-friendly way
    let message = errorStr;
    let isAuthError = false;

    if (errorStr.includes('Not authenticated') || errorStr.includes('Session expired')) {
      isAuthError = true;
      message = 'Your session has expired. Please log in again.';
    } else if (errorStr.includes('network') || errorStr.includes('connection') || errorStr.includes('timeout')) {
      message = 'Network connection issue. Please check your internet connection.';
    } else if (errorStr.includes('Invalid conversation ID')) {
      message = 'Unable to access conversation. Please refresh the page.';
    }

    // Send notification
    if (typeof window.Notifications?.apiError === 'function') {
      window.Notifications.apiError(message);
    } else if (typeof fallbackNotify === 'function') {
      fallbackNotify(message, 'error');
    } else {
      console.error(`${context} error:`, message);
    }

    // For authentication errors, trigger auth state change
    if (isAuthError) {
      window.auth.clear();
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { authenticated: false }
      }));
    }
  },

  /**
   * Validates a UUID v4 string
   * @param {string} uuid - String to validate
   * @returns {boolean} - Is valid UUID
   */
  isValidUUID(uuid) {
    if (!uuid) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  },

  /**
   * Extracts error message from various response formats
   * @param {any} error - Error object or response
   * @returns {string} - Extracted error message
   */
  extractErrorMessage(error) {
    if (typeof error === 'string') return error;
    if (!error) return 'Unknown error';

    // Handle various error response structures
    if (error.response?.data?.detail) return error.response.data.detail;
    if (error.response?.data?.error) return error.response.data.error;
    if (error.message) return error.message;
    if (error.detail) return error.detail;

    return 'Operation failed';
  },

  /**
   * Broadcast authentication state changes to UI components
   * @param {boolean} authenticated - Current authentication state
   */
  broadcastAuth(authenticated) {
    // Don't call window.auth.broadcastAuth to avoid circular reference
    // Instead, dispatch event directly for any chat-specific listeners
    window.dispatchEvent(new CustomEvent('chatAuthStateChanged', {
      detail: { authenticated }
    }));
  }
};

// Initialize ChatUtils
window.ChatUtils.init();

