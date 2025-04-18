/**
 * chat-utils.js
 * Centralized utility functions for the chat application.
 * Provides shared helpers, authentication checks, error handling, and notification logic.
 * Acts as a support module with no direct business logic for UI, messages, or conversations.
 */

// Ensure ChatUtils is defined on the window object for global access
window.ChatUtils = (function () {
  // Private state for error debouncing
  let _lastError = null;
  let _lastErrorTime = 0;
  const _errorDebounceMs = 1000; // Don't show same error within 1 second

  // Module initialization utilities
  const InitUtils = {
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
        console.error(`[ChatUtils] Error during ${moduleName} initialization:`, error);
        throw error;
      }
    }
  };

  // Public ChatUtils object with centralized utilities
  const ChatUtils = {
    /**
     * Initialize ChatUtils and integrate with auth module
     * @returns {Promise<void>}
     */
    async init() {
      await InitUtils.initModule('ChatUtils', () => {
        // Listen via the centralized AuthBus instead of DOM events
        window.auth?.AuthBus.addEventListener('authStateChanged', (e) => {
          this.broadcastAuth(e.detail.authenticated);
        });
      });
    },


    /**
     * Ensure auth module is ready before proceeding, with a timeout
     * @param {number} [timeout=5000] - Maximum time to wait for auth readiness in milliseconds
     * @returns {Promise<void>}
     */
    async ensureAuthReady(timeout = 5000) {
      if (!window.auth || !window.auth.isReady) {
        console.log('[ChatUtils] Auth module not ready, waiting for authReady event...');
        return new Promise(resolve => {
          if (window.auth?.isReady) {
            console.log('[ChatUtils] Auth became ready while checking.');
            resolve();
          } else {
            const listener = () => {
              console.log('[ChatUtils] Received authReady event.');
              resolve();
            };
            window.auth.AuthBus.addEventListener('authReady', listener, { once: true });
            // Safety timeout in case event never fires
            setTimeout(() => {
              console.warn('[ChatUtils] Timeout waiting for authReady event.');
              document.removeEventListener('authReady', listener);
              resolve(); // Resolve anyway to avoid blocking indefinitely
            }, timeout);
          }
        });
      }
      return Promise.resolve();
    },

    /**
     * Centralized error handler for chat components
     * Prevents duplicate error notifications and formats user-friendly messages
     * @param {string} context - Error context description
     * @param {Error|string} error - Error object or message
     * @param {Function} [fallbackNotify] - Notification function if Notifications unavailable
     */
    handleError(context, error, fallbackNotify) {
      // Check if this is a duplicate of the last shown error
      const now = Date.now();
      const errorStr = error instanceof Error ? error.message : String(error);

      if (_lastError === errorStr && now - _lastErrorTime < _errorDebounceMs) {
        console.debug(`[${context}] Duplicate error suppressed:`, errorStr);
        return;
      }

      _lastError = errorStr;
      _lastErrorTime = now;
      console.error(`[${context}]`, error);

      // Format authentication error messages in a user-friendly way
      let message = errorStr;
      let isAuthError = false;

      if (errorStr.includes('Not authenticated') || errorStr.includes('Session expired') || errorStr.includes('401')) {
        isAuthError = true;
        message = 'Your session has expired. Please log in again.';
      } else if (errorStr.includes('network') || errorStr.includes('connection') || errorStr.includes('timeout')) {
        message = 'Network connection issue. Please check your internet connection.';
      } else if (errorStr.includes('Invalid conversation ID')) {
        message = 'Unable to access conversation. Please refresh the page.';
      } else if (errorStr.includes('credit balance') || errorStr.includes('Plans & Billing')) {
        message = 'Your Claude API credit balance is too low. Please go to Plans & Billing to upgrade or purchase credits.';
      } else if (errorStr.includes('content policy') || errorStr.includes('moderation')) {
        message = 'Your request was flagged by content moderation. Please modify your message and try again.';
      } else if (errorStr.includes('rate limit') || errorStr.includes('throttling') || errorStr.includes('429')) {
        message = 'Too many requests. Please wait a moment before trying again.';
      }

      // Send notification to user
      if (typeof window.Notifications?.apiError === 'function') {
        window.Notifications.apiError(message);
      } else if (typeof fallbackNotify === 'function') {
        fallbackNotify(message, 'error');
      } else {
        console.error(`${context} error:`, message);
      }

      // For authentication errors, clear tokens (AuthBus will broadcast state)
      if (isAuthError && window.auth?.clear) {
        window.auth.clear();
      }
    },

    /**
     * Validates a UUID v4 string
     * @param {string} uuid - String to validate
     * @returns {boolean} - Is valid UUID
     */
    isValidUUID(uuid) {
      if (!uuid) {
        console.warn('[ChatUtils] UUID validation failed: UUID is null or undefined');
        return false;
      }
      const isValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
      if (!isValid) {
        console.warn(`[ChatUtils] UUID validation failed for: ${uuid}`);
      }
      return isValid;
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
      if (error.status) {
        const statusCode = error.status;
        if (statusCode === 429) return 'Too many requests. Please wait a moment before trying again.';
        if (statusCode >= 500) return 'The service is currently unavailable. Please try again later.';
        if (statusCode === 401) return 'Session expired - please log in again.';
        if (statusCode === 404) return 'Resource not found - it may have been deleted or moved.';
      }

      return 'Operation failed';
    },

    /**
     * Broadcast authentication state changes to UI components
     * @param {boolean} authenticated - Current authentication state
     */
    broadcastAuth(authenticated) {
      // Dispatch event directly for chat-specific listeners
      window.dispatchEvent(new CustomEvent('chatAuthStateChanged', {
        detail: { authenticated }
      }));
    },

    /**
     * Retrieve the current project ID from various sources (localStorage, URL)
     * @returns {string|null} - Project ID if found, null otherwise
     */
    getProjectId() {
      // Check localStorage first
      let projectId = localStorage.getItem("selectedProjectId")?.trim();
      if (projectId && this.isValidUUID(projectId)) {
        return projectId;
      }

      // Check URL path for project ID (e.g., /projects/{id})
      const pathMatch = window.location.pathname.match(/\/projects\/([0-9a-f-]+)/i);
      if (pathMatch && pathMatch[1] && this.isValidUUID(pathMatch[1])) {
        console.log(`[ChatUtils] Extracted project ID from URL path: ${pathMatch[1]}`);
        return pathMatch[1];
      }

      // Check URL query parameters for projectId
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('projectId') && this.isValidUUID(urlParams.get('projectId'))) {
        projectId = urlParams.get('projectId');
        console.log(`[ChatUtils] Found project ID in URL query: ${projectId}`);
        return projectId;
      }

      console.warn('[ChatUtils] No valid project ID found in localStorage or URL.');
      return null;
    },

    /**
     * Show a notification to the user, centralizing notification logic
     * @param {string} message - Notification message
     * @param {string} type - Notification type (e.g., 'error', 'success', 'warning')
     * @param {Function} [fallbackNotify] - Fallback notification function if global Notifications unavailable
     */
    showNotification(message, type, fallbackNotify) {
      if (window.Notifications) {
        switch (type) {
          case 'error':
            return window.Notifications.apiError(message);
          case 'success':
            return window.Notifications.apiSuccess?.(message);
          default:
            return window.Notifications.apiInfo?.(message) || console.log(`[${type.toUpperCase()}] ${message}`);
        }
      } else if (typeof fallbackNotify === 'function') {
        fallbackNotify(message, type);
      } else {
        console.log(`[Notification - ${type}] ${message}`);
      }
    }
  };

  // Initialize ChatUtils immediately
  ChatUtils.init();

  return ChatUtils;
})();

// Ensure backward compatibility with any existing references to InitUtils
window.InitUtils = window.ChatUtils.InitUtils || {
  featureModules: [],
  initModule: async function (moduleName, initFn) {
    return window.ChatUtils.InitUtils.initModule(moduleName, initFn);
  }
};
