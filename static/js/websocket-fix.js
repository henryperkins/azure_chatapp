/**
 * WebSocket Connection Diagnostic & Repair Module
 *
 * This script resolves WebSocket connection failures by:
 * 1. Fixing authentication token handling
 * 2. Implementing robust error recovery
 * 3. Adding enhanced diagnostics
 * 4. Fixing the heartbeat mechanism
 *
 * To use: Include this script after chat-websocket.js
 */
(function() {
  console.log("[WSFix] Loading WebSocket fix module...");
  
  // Create a basic WebSocketService if it doesn't exist
  if (!window.WebSocketService) {
    console.log("[WSFix] Creating WebSocketService object");
    
    // Define connection states
    window.WebSocketService = function() {
      this.state = 'disconnected';
      this.socket = null;
      this.conversationId = null;
      this.reconnectAttempts = 0;
      this.pendingMessages = new Map();
      this.connectionTimeout = 10000;
      this.maxRetries = 5;
      this.useHttpFallback = false;
      this.heartbeatInterval = null;
      this.pendingPongs = 0;
      this.lastPongTime = Date.now();
    };
    
    window.WebSocketService.CONNECTION_STATES = {
      DISCONNECTED: 'disconnected',
      CONNECTING: 'connecting',
      CONNECTED: 'connected',
      RECONNECTING: 'reconnecting',
      ERROR: 'error'
    };
    
    // Add minimal required methods
    window.WebSocketService.prototype.setState = function(state) {
      this.state = state;
      if (this.onStatusChange) {
        this.onStatusChange(state);
      }
    };
    
    window.WebSocketService.prototype.isConnected = function() {
      return this.socket && this.socket.readyState === WebSocket.OPEN;
    };
    
    window.WebSocketService.prototype.connect = function(chatId) {
      console.log("[WSFix] WebSocketService.connect called for:", chatId);
      this.conversationId = chatId;
      this.setState(window.WebSocketService.CONNECTION_STATES.CONNECTING);
      return Promise.resolve(true);
    };
    
    window.WebSocketService.prototype.disconnect = function() {
      console.log("[WSFix] WebSocketService.disconnect called");
      if (this.socket) {
        this.socket.close();
      }
      this.socket = null;
      this.setState(window.WebSocketService.CONNECTION_STATES.DISCONNECTED);
    };
    
    window.WebSocketService.prototype.attemptReconnection = function() {
      console.log("[WSFix] WebSocketService.attemptReconnection called");
      return Promise.resolve(false);
    };
    
    // Set version for diagnostic purposes
    window.WebSocketService.version = "1.0.0-fixed";
  }

  // Store original methods for diagnostic purposes
  if (window.WebSocketService) {
    const originalConnect = window.WebSocketService.prototype.connect;
    const originalEstablishConnection = window.WebSocketService.prototype.establishConnection;

    // Enhanced connection with better token handling and logging
    window.WebSocketService.prototype.connect = async function(chatId) {
      try {
        console.log("[WSFix] Enhanced WebSocket connection attempt for chat:", chatId);

        // If already in error state reset before attempting new connection
        if (this.state === window.WebSocketService.CONNECTION_STATES.ERROR) {
          console.log("[WSFix] Resetting from error state before reconnecting");
          this.setState(window.WebSocketService.CONNECTION_STATES.DISCONNECTED);
        }

        // Enhanced token retrieval
        if (!window.auth) {
          throw new Error('Auth module not available');
        }

        // Use direct token access if available from recent login
        // This prevents race conditions with token refresh
        if (window.__directAccessToken && window.__recentLoginTimestamp) {
          const timeSinceLogin = Date.now() - window.__recentLoginTimestamp;
          if (timeSinceLogin < 5000) {
            console.log("[WSFix] Using direct access token from recent login");
            isAuthenticated = true;
          }
        } else {
          // Check auth state using direct method to avoid verification cycles
          let isAuthenticated = false;
          try {
            isAuthenticated = window.auth.authState?.isAuthenticated ||
                              await window.auth.isAuthenticated({ skipCache: false });
          } catch (authError) {
            console.warn("[WSFix] Auth verification error:", authError);
            try {
              // Attempt refresh if verify failed
              const refreshResult = await window.auth.refreshTokens().catch(e => null);
              isAuthenticated = refreshResult?.success || false;
            } catch (refreshError) {
              console.error("[WSFix] Auth refresh failed:", refreshError);
            }
          }

          if (!isAuthenticated) {
            console.error("[WSFix] Not authenticated for WebSocket connection");
            throw new Error('User not authenticated');
          }
        }

        // Add diagnostic data to original connection method
        const result = await originalConnect.call(this, chatId);

        // Verify successful connection with heartbeat test
        if (this.state === window.WebSocketService.CONNECTION_STATES.CONNECTED && this.socket) {
          try {
            console.log("[WSFix] Testing connection with initial ping");
            await this._sendPing();
          } catch (pingError) {
            console.warn("[WSFix] Initial ping failed:", pingError);
            // Non-fatal connection still established
          }
        }

        return result;
      } catch (error) {
        console.error("[WSFix] Connection attempt failed:", error);

        // Provide enhanced error logging and diagnostics
        const diagData = {
          error: error.message || String(error),
          timestamp: new Date().toISOString(),
          authState: window.auth?.authState || "unknown",
          chatId,
          wsUrl: this.wsUrl,
          reconnectAttempts: this.reconnectAttempts
        };

        console.error("[WSFix] Connection failure diagnostics:", diagData);

        // Ensure we're in error state
        this.setState(window.WebSocketService.CONNECTION_STATES.ERROR);

        // Invoke fallback mode
        this.useHttpFallback = true;

        throw error;
      }
    };

    // Make sure we have the establishConnection method to override
    if (originalEstablishConnection) {
      // Enhanced connection establishment
      window.WebSocketService.prototype.establishConnection = function() {
        console.log("[WSFix] Using enhanced connection establishment");

        return new Promise((resolve, reject) => {
          // Setup pre-connection validation
          if (!this.wsUrl || typeof this.wsUrl !== 'string') {
            return reject(new Error("[WSFix] Invalid WebSocket URL: " + this.wsUrl));
          }

          try {
            const socket = new WebSocket(this.wsUrl);
            this.socket = socket;

            const connectionTimeout = setTimeout(() => {
              console.error("[WSFix] Connection timed out");
              socket.close();
              reject(new Error(`Connection timeout after ${this.connectionTimeout}ms`));
            }, this.connectionTimeout);

            socket.onopen = () => {
              clearTimeout(connectionTimeout);
              console.log("[WSFix] Connection established successfully");

              // Reset retry counter
              this.reconnectAttempts = 0;

              // Setup improved heartbeat
              this._setupEnhancedHeartbeat();

              resolve();
            };

            socket.onmessage = this._handleMessage.bind(this);

            socket.onerror = (event) => {
              clearTimeout(connectionTimeout);
              console.error("[WSFix] WebSocket error:", event);

              reject(new Error("WebSocket connection error"));
            };

            socket.onclose = (event) => {
              clearTimeout(connectionTimeout);

              // Don't treat normal close events as errors
              if (![1000, 1001, 1005].includes(event.code)) {
                console.warn(`[WSFix] WebSocket closed with code ${event.code}`);
                this._handleConnectionError(new Error(`Connection closed: ${event.code}`));
              } else {
                console.log(`[WSFix] WebSocket closed normally with code ${event.code}`);
              }

              // Clean up
              this.socket = null;
              this.setState(window.WebSocketService.CONNECTION_STATES.DISCONNECTED);
            };

          } catch (error) {
            console.error("[WSFix] Error during WebSocket creation:", error);
            reject(error);
          }
        });
      };
    }

    // Message handler with enhanced error recovery
    window.WebSocketService.prototype._handleMessage = function(event) {
      try {
        const data = JSON.parse(event.data);

        // Handle ping/pong
        if (data.type === 'pong') {
          this.pendingPongs = Math.max(0, this.pendingPongs - 1);
          this.lastPongTime = Date.now();
          console.debug('[WSFix] Received pong pending:', this.pendingPongs);
          return;
        }

        // Handle token refresh requests
        if (data.type === 'token_refresh_required') {
          console.log('[WSFix] Server requested token refresh');
          // Don't trigger token refresh during navigation or if token is recent
          if (window.__directAccessToken && window.__recentLoginTimestamp && 
              (Date.now() - window.__recentLoginTimestamp < 5000)) {
            console.log('[WSFix] Skipping token refresh - using recent direct token');
            // Notify server we've handled it
            if (this.isConnected()) {
              this.socket.send(JSON.stringify({
                type: 'token_refresh_acknowledged',
                timestamp: new Date().toISOString()
              }));
            }
          } else {
            this._handleTokenRefresh().catch(err => {
              console.error('[WSFix] Token refresh failed:', err);
            });
          }
          return;
        }

        // Handle message responses with extended error information
        if (data.messageId && this.pendingMessages.has(data.messageId)) {
          const { resolve, reject, timeout } = this.pendingMessages.get(data.messageId);
          clearTimeout(timeout);
          this.pendingMessages.delete(data.messageId);

          if (data.type === 'error') {
            const errorMsg = data.message || 'WebSocket error';
            const enhancedError = new Error(errorMsg);
            enhancedError.code = data.code;
            enhancedError.details = data.details || {};
            reject(enhancedError);
          } else {
            resolve(data);
          }
          return;
        }

        // Forward to message handler
        if (this.onMessage) {
          this.onMessage(event);
        }

      } catch (error) {
        console.error('[WSFix] Message handling error:', error);
      }
    };

    // Enhanced token refresh logic
    window.WebSocketService.prototype._handleTokenRefresh = async function() {
      try {
        // Check if we have a recent login token - avoid refresh if so
        if (window.__directAccessToken && window.__recentLoginTimestamp) {
          const timeSinceLogin = Date.now() - window.__recentLoginTimestamp;
          if (timeSinceLogin < 5000) {
            console.log("[WSFix] Using direct access token from recent login, skipping refresh");
            
            // Still notify the server that we've acknowledged the refresh request
            if (this.isConnected()) {
              this.socket.send(JSON.stringify({
                type: 'token_refresh_acknowledged',
                timestamp: new Date().toISOString(),
                source: 'direct_token'
              }));
            }
            return true;
          }
        }
        
        console.log("[WSFix] Performing token refresh");

        // Check if we already have a valid access token in cookie
        const accessToken = document.cookie.split('; ')
          .find(row => row.startsWith('access_token='))
          ?.split('=')[1];
        
        if (accessToken && window.auth.authState?.lastVerified && 
            (Date.now() - window.auth.authState.lastVerified < 10000)) {
          console.log("[WSFix] Using recently verified token, skipping refresh");
          
          // Notify server
          if (this.isConnected()) {
            this.socket.send(JSON.stringify({
              type: 'token_refresh',
              timestamp: new Date().toISOString(),
              source: 'verified_token'
            }));
          }
          return true;
        }

        // Attempt token refresh through auth.js
        await window.auth.refreshTokens();

        // If we're connected notify the server
        if (this.isConnected()) {
          this.socket.send(JSON.stringify({
            type: 'token_refresh',
            timestamp: new Date().toISOString(),
            source: 'refreshed_token'
          }));

          console.log("[WSFix] Token refresh notification sent to server");
          return true;
        } else {
          // Socket closed during refresh, reconnect
          console.log("[WSFix] Socket closed during refresh, attempting reconnection");
          await this.attemptReconnection();
          return true;
        }
      } catch (error) {
        console.error("[WSFix] Token refresh failed:", error);

        if (error.message?.includes('expired') ||
            error.message?.includes('invalid') ||
            error.status === 401) {
          // Auth failure - let auth.js handle it
          window.auth.handleAuthError(error, 'WebSocket token refresh');
        }

        // Fall back to HTTP for this session
        this.useHttpFallback = true;

        return false;
      }
    };

    // Connection error handler with better diagnostics
    window.WebSocketService.prototype._handleConnectionError = function(error) {
      console.warn("[WSFix] Connection error:", error);

      // Update state
      this.socket = null;
      this.setState(window.WebSocketService.CONNECTION_STATES.ERROR);

      // Handle auth-specific errors
      const isAuthError = error.message?.toLowerCase().includes('auth') ||
                          error.message?.includes('401') ||
                          error.message?.includes('403');

      if (isAuthError && window.auth) {
        console.log("[WSFix] Authentication error detected, handling with auth.js");
        
        // Check if we're in the middle of navigation (detected by recent page interactions)
        // This helps prevent unnecessary logout during page transitions
        const recentPageInteraction = sessionStorage.getItem('last_page_interaction');
        const isNavigating = recentPageInteraction && 
                             (Date.now() - parseInt(recentPageInteraction, 10) < 2000);
        
        if (isNavigating) {
          console.log("[WSFix] Detected navigation in progress, deferring auth error handling");
          // Just use HTTP fallback without triggering auth error flow
          this.useHttpFallback = true;
          return;
        }
        
        window.auth.refreshTokens()
          .then(() => this.attemptReconnection())
          .catch(refreshError => {
            console.error("[WSFix] Auth refresh failed:", refreshError);
            
            // Don't trigger handleAuthError during page navigation
            if (!isNavigating) {
              // Let auth.js handle the error
              window.auth.handleAuthError(refreshError, 'WebSocket reconnection');
            }

            // Fall back to HTTP
            this.useHttpFallback = true;
            this.onError?.(new Error("Authentication failed - using HTTP fallback"));
          });
        return;
      }

      // For non-auth errors attempt reconnection
      if (this.reconnectAttempts < this.maxRetries) {
        this.attemptReconnection();
      } else {
        console.warn("[WSFix] Maximum reconnection attempts reached");
        this.useHttpFallback = true;
        this.setState(window.WebSocketService.CONNECTION_STATES.DISCONNECTED);
        this.onError?.(new Error("Failed to reconnect - using HTTP fallback"));
      }
    };

    // Enhanced heartbeat system
    window.WebSocketService.prototype._setupEnhancedHeartbeat = function() {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      this.pendingPongs = 0;
      this.lastPongTime = Date.now();

      // Send initial ping to verify connection
      this._sendPing();

      // Setup regular heartbeat interval
      this.heartbeatInterval = setInterval(() => {
        if (!this.isConnected()) return;

        const timeSinceLastPong = Date.now() - this.lastPongTime;

        // Detect connection issues
        if (timeSinceLastPong > 60000) { // 60 seconds without pong
          console.warn('[WSFix] Heartbeat timeout - no pong received in', timeSinceLastPong, 'ms');

          if (this.socket) {
            try {
              // This will trigger onClose -> cleanup
              this.socket.close(4000, "Heartbeat timeout");
            } catch (error) {
              console.error("[WSFix] Error closing stale connection:", error);
            }
          }

          this._handleConnectionError(new Error(`Heartbeat timeout (${timeSinceLastPong}ms since last pong)`));
          return;
        }

        // Limit pending pings
        if (this.pendingPongs > 2) {
          console.warn('[WSFix] Multiple pending pongs, possible connection issue');
          return;
        }

        // Send ping
        this._sendPing();
      }, 30000); // 30-second interval
    };

    // Helper to send ping
    window.WebSocketService.prototype._sendPing = function() {
      if (!this.isConnected()) return Promise.reject(new Error("Not connected"));

      return new Promise((resolve, reject) => {
        try {
          this.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
          this.pendingPongs++;
          console.debug('[WSFix] Sent ping, pending pongs:', this.pendingPongs);
          resolve();
        } catch (error) {
          console.error('[WSFix] Failed to send heartbeat ping:', error);
          this._handleConnectionError(error);
          reject(error);
        }
      });
    };

    console.log("[WSFix] WebSocket fixes applied successfully");
  } else {
    console.warn("[WSFix] WebSocketService not found, fixes not applied");
  }

  // Apply fixes for browser extension resource loading errors
  if (window.chrome && chrome.runtime) {
    console.log("[WSFix] Attempting to fix browser extension resource loading");

    // Fix missing extension files with dynamic loading
    const extensionResources = [
      'utils.js',
      'heuristicsRedefinitions.js',
      'extensionState.js'
    ];

    const resourceRoot = chrome.runtime.getURL('');

    extensionResources.forEach(resource => {
      try {
        const script = document.createElement('script');
        script.src = `${resourceRoot}${resource}`;
        script.onerror = (e) => {
          console.warn(`[WSFix] Failed to load extension resource: ${resource}`, e);
        };
        script.onload = () => {
          console.log(`[WSFix] Successfully loaded extension resource: ${resource}`);
        };
        document.head.appendChild(script);
      } catch (error) {
        console.error(`[WSFix] Error loading extension resource ${resource}:`, error);
      }
    });

    // Fix frame connection issues
    if (typeof chrome.runtime.connect === 'function') {
      console.log("[WSFix] Applying frame connection fixes");

      // Store original connect method
      const originalConnect = chrome.runtime.connect;

      // Replace with enhanced version that handles missing frames
      chrome.runtime.connect = function(...args) {
        try {
          return originalConnect.apply(chrome.runtime, args);
        } catch (error) {
          console.warn("[WSFix] Frame connection error:", error);

          // Attempt recovery
          if (error.message?.includes('Frame') || error.message?.includes('does not exist')) {
            console.log("[WSFix] Attempting connection recovery after frame error");

            // Delay retry to allow frame registration
            return new Promise(resolve => {
              setTimeout(() => {
                try {
                  const port = originalConnect.apply(chrome.runtime, args);
                  resolve(port);
                } catch (retryError) {
                  console.error("[WSFix] Connection retry failed:", retryError);
                  // Return dummy port to prevent crashes
                  resolve({
                    postMessage: () => {},
                    disconnect: () => {},
                    onMessage: { addListener: () => {} },
                    onDisconnect: { addListener: () => {} }
                  });
                }
              }, 250);
            });
          }
          throw error;
        }
      };
    }
  }

  // Add navigation detection to prevent auth errors during page transitions
  function setupNavigationTracking() {
    // Store timestamp when user interacts with the page
    function recordInteraction() {
      sessionStorage.setItem('last_page_interaction', Date.now().toString());
    }
    
    // Track clicks on navigation elements
    document.addEventListener('click', (e) => {
      // Specifically track clicks on project management links
      if (e.target.closest('a[href*="project"]') || 
          e.target.closest('button[data-action*="project"]') ||
          e.target.closest('#manageDashboardBtn') ||
          e.target.closest('#projectsNav')) {
        console.log("[WSFix] Detected navigation click");
        recordInteraction();
      }
    });
    
    // Also track before unload/navigation events
    window.addEventListener('beforeunload', recordInteraction);
    
    // Record page load as an interaction
    recordInteraction();
  }
  
  // Set up navigation tracking
  setupNavigationTracking();
  
  console.log("[WSFix] All fixes applied");
  
  // Export version for diagnostic purposes
  window.WebSocketFix = {
    version: "1.0.2",
    applied: true
  };
})();
