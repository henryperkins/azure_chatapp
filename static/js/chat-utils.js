/**
 * chat-utils.js
 * Centralized utility functions for chat application
 */

window.ChatUtils = {
  // Track recently shown errors to prevent duplicates
  _lastError: null,
  _lastErrorTime: 0,
  _errorDebounceMs: 1000, // Don't show same error within 1 second

  /**
   * Check if user is authenticated
   * @returns {Promise<boolean>}
   */
  isAuthenticated: async function() {
    return window.auth?.verify?.() || false;
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
    
    // Extract meaningful error message
    let message;
    let isAIError = false;
    let isAuthError = false;
    
    if (typeof error === 'string') {
      message = error;
      isAIError = message.includes('generate response') || message.includes('AI ');
      isAuthError = message.includes('Not authenticated') || message.includes('Session expired');
    } else if (error instanceof Error) {
      message = error.message || error.toString();
      isAIError = (
        message.includes('generate response') ||
        message.includes('AI ') ||
        error.code?.startsWith('AI_')
      );
      isAuthError = (
        message.includes('Not authenticated') ||
        message.includes('Session expired') ||
        error.status === 401
      );

      // Special case for connection errors - don't show these to user as they're handled internally
      if (message.includes('Connection closed') && context === 'WebSocket') {
        console.debug('WebSocket closed, using fallback mechanism');
        return; // Silent return - this is an expected fallback scenario
      }
    } else {
      message = 'Unknown error occurred';
    }

    // Handle auth errors
    if (isAuthError) {
      window.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { authenticated: false }
      }));
    }

    // Format notification based on context and message
    let userMessage = message;
    let errorType = 'error';
    
    // Special case for AI generation errors
    if (isAIError) {
      userMessage = message.replace('Error: ', '');
      errorType = 'warning'; // Less severe visual indicator
    } else if (message.includes('Invalid conversation ID')) { 
      userMessage = 'Unable to access conversation';
    }

    // Send notification
    if (typeof window.Notifications?.apiError === 'function') {
      window.Notifications.apiError(userMessage);
    } else if (typeof fallbackNotify === 'function') {
      fallbackNotify(userMessage, errorType);
    } else {
      console.error(`${context} error:`, userMessage);
    }
    
    // For AI errors, also display UI hint if possible
    if (isAIError && typeof window.UIUtils?.showAIErrorHint === 'function') {
      window.UIUtils.showAIErrorHint(userMessage, error.userAction);
    }
  },

  /**
   * Validates a UUID v4 string
   * @param {string} uuid - String to validate
   * @returns {boolean} - Is valid UUID
   */
  isValidUUID: function(uuid) {
    if (!uuid) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  },

  /**
   * Extracts error message from various response formats
   * @param {any} error - Error object or response
   * @returns {string} - Extracted error message
   */
  extractErrorMessage: function(error) {
    if (typeof error === 'string') return error;
    if (!error) return 'Unknown error';

    // Handle various error response structures
    if (error.response?.data?.detail) return error.response.data.detail;
    if (error.response?.data?.error) return error.response.data.error;
    if (error.message) return error.message;
    if (error.detail) return error.detail;

    return 'Operation failed';
  }
};
