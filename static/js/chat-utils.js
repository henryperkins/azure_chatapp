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
    
    let message = 'An error occurred';
    if (error instanceof TypeError) {
      message = 'Network error - please check your connection';
    } else if (error.response && error.response.status === 401) {
      message = 'Session expired - please log in again';
    } else if (error.message) {
      message = error.message;
    }
    
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