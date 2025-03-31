/**
 * chat-utils.js
 * Shared utilities for chat functionality
 */

// Standard error handling that integrates with app.js functionality
window.ChatUtils = {
  /**
   * Standardized error handler that uses app.js's handleAPIError when available
   * @param {string} context - The context where the error occurred
   * @param {Error} error - The error object
   * @param {Function} [fallbackNotify] - Optional fallback notification function
   */
  handleError(context, error, fallbackNotify) {
    // Use app.js handleAPIError if available
    if (typeof window.handleAPIError === 'function') {
      return window.handleAPIError(context, error);
    }
    
    // Otherwise, fallback to basic error handling
    console.error(`[${context}] Error:`, error);
    
    // Extract best message based on error type
    let message = this.extractErrorMessage(error);
    
    // Use provided fallback or show notification via available methods
    if (typeof fallbackNotify === 'function') {
      fallbackNotify(message, 'error');
    } else if (window.Notifications?.apiError) {
      window.Notifications.apiError(message);
    } else if (window.showNotification) {
      window.showNotification(message, 'error');
    } else {
      console.error(message);
    }
  },
  
  /**
   * Extract the most appropriate error message from an error object
   * @param {Error|Object} error - The error object
   * @returns {string} The extracted error message
   */
  extractErrorMessage(error) {
    if (!error) return 'Unknown error occurred';
    
    // Check for network errors
    if (error instanceof TypeError || error.name === 'TypeError') {
      return 'Network error - please check your connection';
    }
    
    // Check for authentication errors
    if (error.response) {
      if (error.response.status === 401) {
        return 'Session expired - please log in again';
      } else if (error.response.status === 403) {
        return 'You don\'t have permission to perform this action';
      } else if (error.response.status === 404) {
        return 'The requested resource was not found';
      } else if (error.response.status === 429) {
        return 'Too many requests - please try again later';
      } else if (error.response.status >= 500) {
        return 'Server error - please try again later';
      }
    }
    
    // Check for specific error messages
    if (error.message) {
      // Sanitize error message to prevent potential XSS
      const sanitizedMessage = error.message
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
        
      // Truncate very long messages
      return sanitizedMessage.length > 150 
        ? sanitizedMessage.substring(0, 150) + '...' 
        : sanitizedMessage;
    }
    
    // Fallback for unknown errors
    return 'An unexpected error occurred';
  },
  
  /**
   * Standardized authentication check that uses auth.js's verify when available
   * @returns {Promise<boolean>} Whether the user is authenticated
   */
  async isAuthenticated() {
    // Use auth.js verify if available (preferred method)
    if (window.auth?.verify) {
      return await window.auth.verify();
    }
    
    // Fallback to session check
    return !!(
      sessionStorage.getItem('auth_state') && 
      sessionStorage.getItem('userInfo')
    );
  }
};
