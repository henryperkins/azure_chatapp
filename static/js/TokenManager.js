/**
 * TokenManager.js
 * Manages authentication tokens securely for the chat application
 * using HTTP-only cookies exclusively.
 */

(function() {
  // Singleton pattern to ensure only one TokenManager across the app
  if (window.TokenManager) {
    console.debug('[TokenManager] Already initialized');
    return;
  }

  // Constants
  const TOKEN_CHECK_INTERVAL = 30000; // 30 seconds
  const DEFAULT_TOKEN_BUFFER = 300000; // 5 minute buffer before expiration
  const PROACTIVE_REFRESH_THRESHOLD = 900000; // 15 minutes before expiration

  class TokenManager {
    constructor() {
      // Note: We DON'T store the actual token in memory
      // We only track metadata about the token
      this.expiresAt = null;
      this.version = null;
      this.isInitialized = false;
      this.refreshInProgress = false;
      this.lastRefreshAttempt = null;
      this.refreshFailCount = 0;
      this.maxRefreshRetries = 3;

      // Periodic token check
      this.checkInterval = null;
      this.initializeFromCookies();
    }

    /**
     * Initialize token metadata from cookies
     */
    initializeFromCookies() {
      try {
        // We only check if the access_token cookie exists
        // But we never store its value in JavaScript
        const accessTokenExists = this.getCookie('access_token') !== null;
        
        if (accessTokenExists) {
          // If the token exists, try to parse expiry time
          // without keeping the token in memory
          this._parseTokenExpiry();
          this.isInitialized = true;
          console.debug('[TokenManager] Initialized token metadata from cookies');
          
          // Start periodic check
          this.startPeriodicCheck();
        }
      } catch (err) {
        console.error('[TokenManager] Failed to initialize from cookies:', err);
      }
    }

    /**
     * Parse token expiry using server endpoint
     * @private
     */
    async _parseTokenExpiry() {
      try {
        // Instead of decoding the JWT ourselves, ask the server about token expiry
        const response = await fetch('/api/auth/token-info', {
          method: 'GET',
          credentials: 'include', // Send cookies
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.expiresAt) {
            this.expiresAt = new Date(data.expiresAt).getTime();
            this.version = data.version || null;
          }
        }
      } catch (err) {
        console.error('[TokenManager] Failed to parse token expiry:', err);
        // Default expiry if server doesn't provide it
        this.expiresAt = Date.now() + 3600000; // Default 1 hour
      }
    }

    /**
     * Get a cookie by name
     * @param {string} name - Cookie name
     * @returns {string|null} Cookie value
     */
    getCookie(name) {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop().split(';').shift();
      return null;
    }

    /**
     * Check if the access token is expired or will expire soon
     * @param {number} [bufferMs=DEFAULT_TOKEN_BUFFER] - Buffer time in milliseconds
     * @returns {boolean} True if token is expired or expiring soon
     */
    isExpired(bufferMs = DEFAULT_TOKEN_BUFFER) {
      // If we couldn't get expiry info, check if cookie exists
      if (!this.expiresAt) {
        return this.getCookie('access_token') === null;
      }
      return this.expiresAt - Date.now() < bufferMs;
    }

    /**
     * Check if we have tokens
     * @returns {boolean} True if we have an access token cookie
     */
    hasTokens() {
      return this.getCookie('access_token') !== null;
    }

    /**
     * Start periodically checking token validity
     */
    startPeriodicCheck() {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
      }
      
      this.checkInterval = setInterval(() => {
        // Proactively refresh if token will expire soon
        if (this.expiresAt && (this.expiresAt - Date.now() < PROACTIVE_REFRESH_THRESHOLD)) {
          console.debug('[TokenManager] Proactively refreshing token before expiration');
          this.refresh().catch(err => {
            console.warn('[TokenManager] Proactive refresh failed:', err);
          });
        }
        // Emergency refresh if token is expired or about to expire
        else if (this.isExpired(2 * DEFAULT_TOKEN_BUFFER)) {
          this.refresh().catch(err => {
            console.warn('[TokenManager] Emergency refresh failed:', err);
          });
        }
      }, TOKEN_CHECK_INTERVAL);
    }

    /**
     * Stop the periodic token check
     */
    stopPeriodicCheck() {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
    }

    /**
     * Refresh the access token
     * @returns {Promise<object>} Refreshed token metadata
     */
    async refresh() {
      if (this.refreshInProgress) {
        console.debug('[TokenManager] Refresh already in progress, waiting...');
        return new Promise((resolve, reject) => {
          const checkComplete = () => {
            if (!this.refreshInProgress) {
              if (this.hasTokens()) {
                resolve({ success: true });
              } else {
                reject(new Error('Token refresh failed'));
              }
            } else {
              setTimeout(checkComplete, 100);
            }
          };
          setTimeout(checkComplete, 100);
        });
      }

      // Check for too many consecutive failed refresh attempts
      const now = Date.now();
      if (this.lastRefreshAttempt && (now - this.lastRefreshAttempt < 5000) && this.refreshFailCount >= this.maxRefreshRetries) {
        console.error('[TokenManager] Too many failed refresh attempts, forcing logout');
        if (window.auth && typeof window.auth.logout === 'function') {
          window.auth.logout();
        }
        return Promise.reject(new Error('Too many refresh attempts failed - logged out'));
      }
 
      this.refreshInProgress = true;
      this.lastRefreshAttempt = now;
      
      try {
        console.debug('[TokenManager] Refreshing token...');
        
        // Add timeout to token refresh
        const REFRESH_TIMEOUT = 10000; // 10 seconds
        
        const fetchPromise = fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Token refresh timeout')), REFRESH_TIMEOUT);
        });
        
        // Race the fetch against the timeout
        const response = await Promise.race([fetchPromise, timeoutPromise]);
 
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
        }

        // After refresh, the server sets new HTTP-only cookies
        // We parse token expiry from server response
        const refreshData = await response.json();
        if (refreshData.expiresAt) {
          this.expiresAt = new Date(refreshData.expiresAt).getTime();
        } else {
          // Refresh token expiry info
          await this._parseTokenExpiry();
        }
        
        // Update token version if provided
        if (refreshData.version) {
          this.version = refreshData.version;
        }
        
        // Reset failed attempt counter on success
        this.refreshFailCount = 0;
        
        console.debug('[TokenManager] Token refreshed successfully');
        
        // Notify about token refresh
        document.dispatchEvent(new CustomEvent('tokenRefreshed', {
          detail: { success: true }
        }));
        
        return {
          success: true,
          version: this.version
        };
      } catch (error) {
        // Increment failed attempt counter
        this.refreshFailCount++;
        
        console.error(`[TokenManager] Token refresh failed (attempt ${this.refreshFailCount}/${this.maxRefreshRetries}):`, error);
        
        // Provide more specific error message based on error type
        let errorMessage = 'Token refresh failed';
        let forceLogout = false;
        
        // Parse error response text if available
        let errorDetails = '';
        try {
          if (typeof error.message === 'string' && error.message.includes('{')) {
            const jsonStartIndex = error.message.indexOf('{');
            const jsonStr = error.message.substring(jsonStartIndex);
            const errorObj = JSON.parse(jsonStr);
            errorDetails = errorObj.detail || '';
          }
        } catch (e) {
          // If parsing fails, continue with normal error handling
          console.debug('[TokenManager] Could not parse error JSON:', e);
        }
        
        // Enhanced error classification
        if (error.message?.includes('timeout')) {
          errorMessage = 'Token refresh timed out - network may be slow';
          console.warn('[TokenManager] Network timeout during refresh');
        } else if (error.message?.includes('fetch')) {
          errorMessage = 'Network error during token refresh - please check connection';
          console.warn('[TokenManager] Network error during refresh');
        } else if (error.message?.includes('401')) {
          // Check for specific token invalidation messages
          if (errorDetails.includes('token version mismatch') ||
              errorDetails.includes('Token version mismatch') ||
              error.message?.includes('token version mismatch')) {
            errorMessage = 'Session invalidated due to token version mismatch - please login again';
            console.warn('[TokenManager] Token version mismatch - session invalidated');
            forceLogout = true;
            this.refreshFailCount = this.maxRefreshRetries; // Prevent further retries
          } else if (errorDetails.includes('token revoked') ||
                     errorDetails.includes('Token revoked') ||
                     error.message?.includes('token revoked')) {
            errorMessage = 'Your session has been revoked - please login again';
            console.warn('[TokenManager] Token revoked - session invalidated');
            forceLogout = true;
            this.refreshFailCount = this.maxRefreshRetries; // Prevent further retries
          } else if (error.message?.includes('expired')) {
            errorMessage = 'Token expired - please login again';
            console.warn('[TokenManager] Token expired during refresh');
            forceLogout = true;
          } else if (error.message?.includes('version')) {
            errorMessage = 'Token version mismatch - please login again';
            console.warn('[TokenManager] Token version mismatch during refresh');
            forceLogout = true;
          } else {
            errorMessage = 'Session expired or unauthorized - please login again';
            console.warn('[TokenManager] Unauthorized during refresh (401)');
            forceLogout = true;
          }
        } else if (error.message?.includes('403')) {
          errorMessage = 'Access forbidden - please login again';
          console.warn('[TokenManager] Forbidden during refresh (403)');
          forceLogout = true;
        } else if (error.message) {
          errorMessage = error.message;
          console.warn('[TokenManager] Refresh error:', error.message);
        }
        
        // Force immediate logout on auth failures
        if (forceLogout) {
          console.warn('[TokenManager] Authentication error detected, forcing logout');
          this.showSessionExpiredNotification(errorMessage);
          
          // Small delay to allow notification to appear before logout
          setTimeout(() => {
            if (window.auth && typeof window.auth.logout === 'function') {
              window.auth.logout();
            }
          }, 300);
        }
        
        // Notify about token refresh failure with enhanced details
        document.dispatchEvent(new CustomEvent('tokenRefreshed', {
          detail: {
            success: false,
            error,
            message: errorMessage,
            attempts: this.refreshFailCount
          }
        }));
        
        // Create a more informative error for upstream handlers
        const enhancedError = new Error(errorMessage);
        enhancedError.originalError = error;
        enhancedError.attempts = this.refreshFailCount;
        throw enhancedError;
      } finally {
        this.refreshInProgress = false;
      }
    }

    /**
     * Get WebSocket auth token info - for chat WebSocket authentication
     * @returns {Promise<object>} Object with token info for WebSocket
     */
    async getWSAuthToken() {
      try {
        // If token is expired or will expire soon, refresh it
        if (this.isExpired()) {
          await this.refresh();
        }
        
        // Request a specialized WebSocket token
        const response = await fetch('/api/auth/ws-token', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to get WebSocket token');
        }
        
        const tokenData = await response.json();
        
        return {
          token: tokenData.token,
          version: tokenData.version || this.version
        };
      } catch (error) {
        console.error('[TokenManager] Failed to get WebSocket auth token:', error);
        
        // Handle token invalidation errors from WebSocket token requests
        if (error.message && (
            error.message.includes('401') ||
            error.message.includes('token version mismatch') ||
            error.message.includes('token revoked'))) {
          // Specific handling for failures during WS token acquisition
          console.warn('[TokenManager] WebSocket token request failed due to invalid access token:', error.message);

          // Show notification and force logout
          let errorMessage = 'Session expired or invalid - please login again'; // More general message
          if (error.message.includes('token version mismatch')) {
            errorMessage = 'Session invalidated due to token version mismatch - please login again';
          } else if (error.message.includes('token revoked')) {
            errorMessage = 'Your session has been revoked - please login again';
          }
          
          this.showSessionExpiredNotification(errorMessage);
          
          // Prevent further refresh attempts
          this.refreshFailCount = this.maxRefreshRetries;
          
          // Force logout
          setTimeout(() => {
            if (window.auth && typeof window.auth.logout === 'function') {
              window.auth.logout();
            }
          }, 300);
        }
        
        throw error;
      }
    }

    /**
     * Clear token state (for logout)
     */
    clear() {
      this.expiresAt = null;
      this.version = null;
      this.stopPeriodicCheck();
      console.debug('[TokenManager] Token metadata cleared');
    }
    
    /**
     * Show a user-friendly notification about session expiration
     * @param {string} message - The message to display
     */
    showSessionExpiredNotification(message) {
      // Check if notification system exists
      if (window.notificationSystem && typeof window.notificationSystem.showNotification === 'function') {
        window.notificationSystem.showNotification({
          type: 'warning',
          title: 'Session Expired',
          message: message || 'Your session has expired. Please login again.',
          duration: 8000,
          position: 'top-center'
        });
      } else {
        // Fallback to alert if no notification system
        console.warn('[TokenManager] Session expired:', message);
        
        // Avoid alert() for version mismatch/token revocation as we're about to redirect anyway
        if (!message.includes('version mismatch') && !message.includes('token revoked')) {
          alert(message || 'Your session has expired. Please login again.');
        }
      }
    }
  }

  // Expose singleton instance to window
  // window.TokenManager = new TokenManager(); // Defer initialization
  console.debug('[TokenManager] Module definition loaded');
})();
