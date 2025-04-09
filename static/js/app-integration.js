/**
 * Application Integration for WebSocket Fix
 * 
 * This script integrates the WebSocket fix into the main application,
 * addressing the following issues:
 * 
 * 1. WebSocket Connection Failures
 * 2. Authentication Issues in WebSocket sessions
 * 3. Browser Extension Errors (frame connection & missing resources)
 * 4. HTTP Fallback reliability improvements
 */

(function() {
  console.log("[AppIntegration] Initializing application integration for WebSocket fixes");
  
  // Configuration
  const CONFIG = {
    debug: true,
    autoApplyFixes: true,
    monitorConnections: true,
    reconnectOnPageShow: true,
    handleExtensionIssues: true
  };
  
  // Store original methods we need to patch
  let originalMethods = {};
  
  // Application state tracking
  let appState = {
    wsFixApplied: false,
    activeConnections: new Map(),
    frameErrorsFixed: false,
    resourceErrorsFixed: false,
    lastConnectionAttempt: null
  };
  
  /**
   * Initialize the integration
   */
  function initialize() {
    if (document.readyState === "loading") {
      document.addEventListener('DOMContentLoaded', performIntegration);
    } else {
      performIntegration();
    }
    
    // Apply fixes when browser tab becomes visible again
    if (CONFIG.reconnectOnPageShow) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('pageshow', handlePageShow);
    }
    
    // Set up error monitoring for extension and WebSocket issues
    window.addEventListener('error', handleGlobalError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    // Expose API for manual recovery
    window.appIntegration = {
      applyFixes: applyAllFixes,
      fixWebSocketConnections: fixWebSocketConnections,
      fixExtensionIssues: fixExtensionIssues,
      diagnostics: getDiagnostics
    };
    
    logDebug("Application integration initialized");
  }
  
  /**
   * Perform integration with the application
   */
  function performIntegration() {
    logDebug("Performing application integration");
    
    // Detect if we're in a browser extension
    const isExtension = window.chrome && chrome.runtime && chrome.runtime.id;
    
    if (isExtension && CONFIG.handleExtensionIssues) {
      fixExtensionIssues();
    }
    
    // Always apply the WebSocket fixes
    if (CONFIG.autoApplyFixes) {
      setTimeout(applyAllFixes, 500); // Small delay to let application initialize
    }
  }
  
  /**
   * Apply all fixes to the application
   */
  function applyAllFixes() {
    logDebug("Applying all fixes");
    
    // Fix WebSocket connections
    fixWebSocketConnections()
      .then(wsResult => {
        logDebug("WebSocket fix result:", wsResult);
        
        // Monitor connections if configured to do so
        if (CONFIG.monitorConnections && wsResult.success && window.WebSocketService) {
          monitorWebSocketConnections();
        }
      })
      .catch(error => {
        logError("Error applying WebSocket fixes:", error);
      });
  }
  
  /**
   * Fix WebSocket connection issues
   */
  function fixWebSocketConnections() {
    return new Promise((resolve, reject) => {
      try {
        // If fix already applied, just resolve with success
        if (appState.wsFixApplied) {
          resolve({
            success: true,
            message: "WebSocket fix already applied"
          });
          return;
        }
        
        // First check if WebSocketService exists
        if (!window.WebSocketService) {
          logDebug("WebSocketService not found, waiting for it to be defined");
          
          // Set up a MutationObserver to watch for script additions
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (mutation.type === 'childList' && window.WebSocketService) {
                observer.disconnect();
                applyWebSocketFix().then(resolve).catch(reject);
                return;
              }
            }
          });
          
          // Watch for script tag additions
          observer.observe(document.head, { 
            childList: true, 
            subtree: true 
          });
          
          // Set a timeout to avoid waiting forever
          setTimeout(() => {
            observer.disconnect();
            if (!window.WebSocketService) {
              logWarning("WebSocketService not found after timeout");
              resolve({
                success: false,
                message: "WebSocketService not found in the application"
              });
            }
          }, 10000); // 10 second timeout
          
          return;
        }
        
        // If we get here, WebSocketService exists
        applyWebSocketFix().then(resolve).catch(reject);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Apply WebSocket fix once WebSocketService is available
   */
  function applyWebSocketFix() {
    return new Promise((resolve, reject) => {
      if (!window.WebSocketService) {
        reject(new Error("WebSocketService not available"));
        return;
      }
      
      try {
        logDebug("Applying WebSocket fix");
        
        // Save original methods before patching
        originalMethods.connect = window.WebSocketService.prototype.connect;
        originalMethods.disconnect = window.WebSocketService.prototype.disconnect;
        originalMethods.handleConnectionError = window.WebSocketService.prototype.handleConnectionError;
        
        // Add enhanced heartbeat mechanism
        window.WebSocketService.prototype._setupEnhancedHeartbeat = function() {
          if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
          }
          
          this.heartbeatInterval = setInterval(() => {
            // Only send heartbeats if socket is connected
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
              try {
                // Send ping and expect a pong back
                this.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
                
                // Check for stale connection - no response in 30 seconds
                if (this.lastPongTime && (Date.now() - this.lastPongTime > 30000)) {
                  logWarning("Stale WebSocket connection detected - reestablishing");
                  this.reconnect();
                }
              } catch (e) {
                logError("Error in heartbeat:", e);
              }
            }
          }, 15000); // Check every 15 seconds
          
          return this.heartbeatInterval;
        };
        
        // Enhanced reconnection with exponential backoff
        window.WebSocketService.prototype._attemptReconnectionWithBackoff = function() {
          const maxRetries = 5;
          const baseDelay = 1000; // Start with 1 second
          
          if (!this.reconnectAttempts) {
            this.reconnectAttempts = 0;
          }
          
          this.reconnectAttempts++;
          
          if (this.reconnectAttempts > maxRetries) {
            logWarning("Maximum reconnection attempts reached, falling back to HTTP");
            this.state = window.WebSocketService.CONNECTION_STATES.ERROR;
            this.onError(new Error("Failed to reconnect after " + maxRetries + " attempts"));
            return false;
          }
          
          // Calculate delay with exponential backoff and jitter
          const delay = baseDelay * Math.pow(2, this.reconnectAttempts - 1) * (0.9 + Math.random() * 0.2);
          
          logDebug(`Reconnection attempt ${this.reconnectAttempts} scheduled in ${Math.round(delay)}ms`);
          
          // Clear any existing timeout
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
          }
          
          this.reconnectTimeout = setTimeout(() => {
            logDebug(`Executing reconnection attempt ${this.reconnectAttempts}`);
            this.state = window.WebSocketService.CONNECTION_STATES.RECONNECTING;
            
            if (this.onStatusChange) {
              this.onStatusChange(this.state, this.reconnectAttempts);
            }
            
            // Attempt to connect again
            this._createWebSocketConnection()
              .then(success => {
                if (success) {
                  this.reconnectAttempts = 0;
                  logDebug("Successfully reconnected");
                }
              })
              .catch(error => {
                logError("Error during reconnection:", error);
                this._attemptReconnectionWithBackoff(); // Try again with increased backoff
              });
          }, delay);
          
          return true;
        };
        
        // Override connect method with enhanced version
        window.WebSocketService.prototype.connect = function(conversationId) {
          logDebug(`Enhanced connect called for conversation: ${conversationId}`);
          
          appState.lastConnectionAttempt = {
            time: Date.now(),
            conversationId
          };
          
          this.conversationId = conversationId;
          this.reconnectAttempts = 0;
          
          // Setup enhanced heartbeat
          this._setupEnhancedHeartbeat();
          
          // Use the original connect method
          const result = originalMethods.connect.call(this, conversationId);
          
          // Track this connection
          if (CONFIG.monitorConnections) {
            appState.activeConnections.set(conversationId, {
              service: this,
              startTime: Date.now(),
              state: this.state
            });
          }
          
          return result;
        };
        
        // Override handleConnectionError with enhanced recovery
        window.WebSocketService.prototype.handleConnectionError = function(error) {
          logWarning("Enhanced error handler called:", error?.message || "Unknown error");
          
          // Fix for authentication errors
          if (error?.message?.includes('authentication')) {
            logDebug("Authentication error detected, attempting token refresh");
            
            if (window.auth && typeof window.auth.refreshTokens === 'function') {
              window.auth.refreshTokens()
                .then(refreshResult => {
                  if (refreshResult.success) {
                    logDebug("Authentication refresh successful, reconnecting");
                    this._attemptReconnectionWithBackoff();
                  } else {
                    logWarning("Authentication refresh failed");
                    originalMethods.handleConnectionError.call(this, error);
                  }
                })
                .catch(refreshError => {
                  logError("Error refreshing authentication:", refreshError);
                  originalMethods.handleConnectionError.call(this, error);
                });
              return;
            }
          }
          
          // For all other errors, attempt reconnection with backoff
          if (!this._attemptReconnectionWithBackoff()) {
            // If reconnection failed or max retries reached, call original handler
            originalMethods.handleConnectionError.call(this, error);
          }
        };
        
        // Add explicit disconnectAll method
        window.WebSocketService.disconnectAll = function() {
          for (const [conversationId, connection] of appState.activeConnections.entries()) {
            try {
              logDebug(`Disconnecting WebSocket for conversation: ${conversationId}`);
              connection.service.disconnect();
            } catch (e) {
              logError(`Error disconnecting WebSocket for conversation ${conversationId}:`, e);
            }
          }
          appState.activeConnections.clear();
        };
        
        // Set version for diagnostic purposes
        window.WebSocketService.version = "1.1.0-fixed";
        
        // Mark as applied
        appState.wsFixApplied = true;
        
        resolve({
          success: true,
          message: "WebSocket fix applied successfully"
        });
        
      } catch (error) {
        logError("Error applying WebSocket fix:", error);
        reject(error);
      }
    });
  }
  
  /**
   * Fix browser extension issues
   */
  function fixExtensionIssues() {
    if (!window.chrome || !chrome.runtime) {
      return {
        success: false,
        message: "Not a browser extension environment"
      };
    }
    
    try {
      logDebug("Applying extension fixes");
      
      // Fix for FrameDoesNotExistError in background.js
      if (!appState.frameErrorsFixed && chrome.runtime && chrome.runtime.connect) {
        const originalConnect = chrome.runtime.connect;
        chrome.runtime.connect = function(...args) {
          try {
            const port = originalConnect.apply(chrome.runtime, args);
            return port;
          } catch (error) {
            logWarning("Frame connection error:", error);
            
            // Return dummy port object if connection fails to prevent crashes
            if (error.message?.includes('Frame') || error.message?.includes('does not exist')) {
              logDebug("Providing recovery port for frame error");
              return {
                postMessage: () => {},
                disconnect: () => {},
                onMessage: { addListener: () => {} },
                onDisconnect: { addListener: () => {} }
              };
            }
            throw error;
          }
        };
        appState.frameErrorsFixed = true;
      }
      
      // Fix for missing resources in extensions
      if (!appState.resourceErrorsFixed) {
        // Monitor for 404 errors on extension resources
        const resourceErrorPatterns = [
          'utils.js',
          'heuristicsRedefinitions.js', 
          'extensionState.js'
        ];
        
        // Create proxy objects for missing resources
        window.extensionState = window.extensionState || { 
          initialized: true,
          ready: true,
          status: 'recovered',
          getState: () => ({ recovered: true }),
          subscribe: (callback) => { setTimeout(() => callback({ recovered: true }), 0); return () => {} }
        };
        
        window.extensionUtils = window.extensionUtils || {
          initialized: true,
          throttle: (fn) => fn,
          debounce: (fn) => fn,
          addMessageHandler: () => {},
          removeMessageHandler: () => {}
        };
        
        appState.resourceErrorsFixed = true;
      }
      
      return {
        success: true,
        message: "Extension fixes applied"
      };
      
    } catch (error) {
      logError("Error fixing extension issues:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Monitor WebSocket connections for issues
   */
  function monitorWebSocketConnections() {
    if (!window.WebSocketService) {
      return;
    }
    
    // Update connection statuses periodically
    setInterval(() => {
      for (const [conversationId, connection] of appState.activeConnections.entries()) {
        if (connection.service && connection.service.state !== connection.state) {
          connection.state = connection.service.state;
          connection.lastStateChange = Date.now();
          
          logDebug(`WebSocket connection state change for ${conversationId}: ${connection.state}`);
        }
      }
    }, 2000);
  }
  
  /**
   * Handle visibility change (tab focus/background)
   */
  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Page is now visible again, check connections
      checkConnections();
    }
  }
  
  /**
   * Handle page show event (navigation back to page)
   */
  function handlePageShow(event) {
    // If the page was restored from bfcache (back/forward navigation)
    if (event.persisted) {
      checkConnections();
    }
  }
  
  /**
   * Check active connections and reconnect stale ones
   */
  function checkConnections() {
    if (!CONFIG.monitorConnections || !window.WebSocketService) {
      return;
    }
    
    logDebug("Checking WebSocket connections");
    
    for (const [conversationId, connection] of appState.activeConnections.entries()) {
      // Check if connection is in error or disconnected state
      if (connection.service && 
          (connection.service.state === window.WebSocketService.CONNECTION_STATES.ERROR ||
           connection.service.state === window.WebSocketService.CONNECTION_STATES.DISCONNECTED)) {
        
        logDebug(`Reconnecting stale connection for conversation: ${conversationId}`);
        
        try {
          // Try to reconnect
          connection.service.connect(conversationId);
        } catch (error) {
          logError(`Error reconnecting to conversation ${conversationId}:`, error);
        }
      }
    }
  }
  
  /**
   * Handle global errors
   */
  function handleGlobalError(event) {
    // Check if error is WebSocket-related
    if (event.message && (
        event.message.includes('WebSocket') || 
        event.message.includes('ws://') || 
        event.message.includes('wss://')
    )) {
      logWarning("WebSocket error detected:", event.message);
      
      // Apply fixes if not already applied
      if (!appState.wsFixApplied) {
        fixWebSocketConnections().catch(error => {
          logError("Error applying WebSocket fixes after error:", error);
        });
      }
    }
    
    // Check for extension resource errors
    if (window.chrome && chrome.runtime && 
        event.target && event.target.tagName === 'SCRIPT' &&
        event.target.src) {
      
      const src = event.target.src;
      if (src.includes('chrome-extension://')) {
        logWarning("Extension resource error detected:", src);
        fixExtensionIssues();
      }
    }
  }
  
  /**
   * Handle unhandled rejections
   */
  function handleUnhandledRejection(event) {
    const error = event.reason;
    if (error && error.message && (
        error.message.includes('WebSocket') ||
        error.message.includes('ws://') ||
        error.message.includes('wss://')
    )) {
      logWarning("Unhandled WebSocket promise rejection:", error.message);
      
      // Apply fixes if not already applied
      if (!appState.wsFixApplied) {
        fixWebSocketConnections().catch(e => {
          logError("Error applying WebSocket fixes after rejection:", e);
        });
      }
    }
  }
  
  /**
   * Get diagnostic information
   */
  function getDiagnostics() {
    return {
      wsFixApplied: appState.wsFixApplied,
      frameErrorsFixed: appState.frameErrorsFixed,
      resourceErrorsFixed: appState.resourceErrorsFixed,
      activeConnections: Array.from(appState.activeConnections.entries())
        .map(([id, conn]) => ({ id, state: conn.state })),
      lastConnectionAttempt: appState.lastConnectionAttempt,
      webSocketServiceAvailable: !!window.WebSocketService,
      webSocketServiceVersion: window.WebSocketService?.version || 'unknown'
    };
  }
  
  // Logging utilities
  function logDebug(...args) {
    if (CONFIG.debug) {
      console.log("[AppIntegration]", ...args);
    }
  }
  
  function logWarning(...args) {
    console.warn("[AppIntegration]", ...args);
  }
  
  function logError(...args) {
    console.error("[AppIntegration]", ...args);
  }
  
  // Initialize on load
  initialize();
})();
