(function() {
  // Singleton instance tracking
  const debugPrefix = '[WebSocketService]';
  
  // Prevent duplicate loading with debug logging
  if (window.__webSocketServiceLoaded) {
    console.debug(`${debugPrefix} Script already loaded - skipping reinitialization`);
    return;
  }

  // Mark as loaded
  window.__webSocketServiceLoaded = true;
  console.debug(`${debugPrefix} Initializing WebSocket service`);

  /**
   * chat-websocket.js
   * Robust WebSocket service for real-time chat communication with:
   * - Automatic reconnection
   * - Authentication handling
   * - HTTP fallback
   * - State management
   */

  /// <reference types="@types/node" />

  /**
   * @typedef {{
   *  WebSocketService: typeof WebSocketService,
   *  ChatUtils: typeof import('./chat-utils'),
   *  API_CONFIG: { WS_ENDPOINT?: string },
   *  TokenManager: {
   *    accessToken?: string,
   *    isExpired: () => boolean,
   *    refresh: () => Promise<void>
   *  },
   *  auth: { verify?: () => Promise<boolean> },
   *  BACKEND_HOST?: string,
   *  MessageService: { httpSend: (payload: any) => Promise<any> }
   * }} AugmentedWindow
   */

  // Singleton pattern implementation
  if (window.WebSocketService) {
    console.debug(`${debugPrefix} Service already exists - using existing instance`);
    return;
  }

  // Track active instances
  const activeInstances = new WeakMap();

  // Connection state constants
  const CONNECTION_STATES = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
  };

  /**
   * Authentication Manager
   * Centralizes all authentication logic
   */
  class AuthManager {
    constructor() {
      this.authCheckInProgress = false;
      
      // Listen for project selection events
      document.addEventListener('projectSelected', (event) => {
        if (event.detail && event.detail.projectId) {
          console.log('Auth manager: Project selected:', event.detail.projectId);
          // Store for future reference
          localStorage.setItem('selectedProjectId', event.detail.projectId);
        }
      });
    }

    async getValidToken() {
      if (this.authCheckInProgress) {
        throw new Error('Auth check already in progress');
      }

      this.authCheckInProgress = true;
      try {
        // Check for existing valid token
        if (window.TokenManager?.accessToken && !window.TokenManager.isExpired()) {
          return window.TokenManager.accessToken;
        }

        // Attempt token refresh if available
        if (window.TokenManager?.refresh) {
          await window.TokenManager.refresh();
          if (window.TokenManager.accessToken) {
            return window.TokenManager.accessToken;
          }
        }

        // Final fallback to auth verification
        if (window.auth?.verify) {
          const verified = await window.auth.verify();
          if (verified && window.TokenManager?.accessToken) {
            return window.TokenManager.accessToken;
          }
        }

        throw new Error('Unable to obtain valid token');
      } finally {
        this.authCheckInProgress = false;
      }
    }
  }

  /**
   * WebSocket Service
   * Handles real-time communication with automatic reconnection
   */
  window.WebSocketService = function (options = {}) {
    // Singleton enforcement
    if (activeInstances.has(this)) {
      console.debug(`${debugPrefix} Returning existing instance`);
      return activeInstances.get(this);
    }
    activeInstances.set(this, this);
  // Configuration
  this.maxRetries = options.maxRetries || 3;
  this.reconnectInterval = options.reconnectInterval || 3000;
  this.connectionTimeout = options.connectionTimeout || 10000;
  this.messageTimeout = options.messageTimeout || 30000;

  // State
  this.state = CONNECTION_STATES.DISCONNECTED;
  this.socket = null;
  this.chatId = null;
  this.projectId = null; // Will be refreshed on each connect
  this.reconnectAttempts = 0;
  this.useHttpFallback = false;
  this.wsUrl = null;
  this.pendingMessages = new Map();
  
  // Listen for project selection events
  document.addEventListener('projectSelected', (event) => {
    if (event.detail && event.detail.projectId) {
      console.log('WebSocketService: Project selected:', event.detail.projectId);
      this.projectId = event.detail.projectId;
    }
  });

  // Dependencies
  this.authManager = new AuthManager();

  // Event handlers
  this.onMessage = options.onMessage || (() => { });
  this.onError = options.onError || ((err) => console.error('WebSocket Error:', err));
  this.onConnect = options.onConnect || (() => { });
  this.onDisconnect = options.onDisconnect || (() => { });
};

// State management
window.WebSocketService.prototype.setState = function (newState) {
  if (this.state === newState) return;

  console.debug(`Connection state: ${this.state} → ${newState}`);
  this.state = newState;

  switch (newState) {
    case CONNECTION_STATES.CONNECTED:
      this.onConnect();
      break;
    case CONNECTION_STATES.DISCONNECTED:
      this.onDisconnect();
      break;
    case CONNECTION_STATES.ERROR:
      this.onError(new Error('Connection error'));
      break;
  }
};

// Connection management
window.WebSocketService.prototype.connect = async function (chatId) {
  const debugPrefix = '[WebSocketService]';
  if (!chatId) throw new Error('Invalid chatId');

  // Return existing connection if already connected to same chat
  if (this.state === CONNECTION_STATES.CONNECTED && this.chatId === chatId) {
    console.debug(`${debugPrefix} Already connected to chat ${chatId}`);
    return true;
  }

  // Queue connection requests if one is already in progress
  if (this.state === CONNECTION_STATES.CONNECTING ||
      this.state === CONNECTION_STATES.RECONNECTING) {
    console.debug(`${debugPrefix} Connection in progress - queuing request for chat ${chatId}`);
    return new Promise((resolve) => {
      const checkConnection = () => {
        if (this.state === CONNECTION_STATES.CONNECTED) {
          resolve(true);
        } else if (this.state === CONNECTION_STATES.DISCONNECTED) {
          this.connect(chatId).then(resolve);
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      checkConnection();
    });
  }

  this.setState(CONNECTION_STATES.CONNECTING);
  this.chatId = chatId;
  this.useHttpFallback = false;

  try {
    const token = await this.authManager.getValidToken();

    const params = new URLSearchParams({
      token: token
    });

    let host = window.API_CONFIG?.WS_ENDPOINT || window.location.host;
    
    // Remove any protocol prefix if already present in the host
    host = host.replace(/^(wss?:\/\/|https?:\/\/)/, '');

    if (!host) {
      console.error('Empty WebSocket host - using HTTP fallback');
      this.useHttpFallback = true;
      throw new Error('Empty WebSocket host');
    }

    const finalProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    
    // Always refresh project ID from localStorage
    this.projectId = this.projectId || localStorage.getItem("selectedProjectId");
    
    // Validate project selection before proceeding
    if (!this.projectId) {
      const errorMsg = 'Please select a project before starting a conversation';
      if (window.UIUtils?.showNotification) {
        window.UIUtils.showNotification(errorMsg, 'warning');
      } else {
        console.warn(errorMsg);
      }
      this.useHttpFallback = true;
      return false;
    }
    
    console.log(`WebSocketService connecting with projectId: ${this.projectId}, chatId: ${chatId}`);

        // Get current conversation details if available
        const currentConversation = window.chatInterface?.conversationService?.currentConversation;
        const conversationProjectId = currentConversation?.project_id;
        const selectedProjectId = localStorage.getItem("selectedProjectId");

        let basePath;
        if (selectedProjectId && conversationProjectId && selectedProjectId === conversationProjectId) {
            console.log(`Using project-scoped WebSocket for conversation ${chatId} in project ${selectedProjectId}`);
            basePath = `/api/projects/${selectedProjectId}/conversations/${chatId}/ws`;
            this.projectId = selectedProjectId;
        } else {
            console.log(`Using standalone WebSocket for conversation ${chatId}`);
            basePath = `/api/conversations/${chatId}/ws`;
            this.projectId = null;
        }

        this.wsUrl = `${finalProtocol}${host}${basePath}?${params}`;
        console.log('Constructed WebSocket URL:', this.wsUrl);
  } catch (error) {
    console.error('Error constructing WebSocket URL:', error);
    this.useHttpFallback = true;
    throw new Error('Invalid WebSocket endpoint configuration');
  }

  if (!validateWebSocketUrl(this.wsUrl)) {
    console.error(`${debugPrefix} Invalid WebSocket URL: ${this.wsUrl}`);
    throw new Error(`Invalid WebSocket URL: ${this.wsUrl}`);
  }

  try {
    await this.establishConnection();
    this.setState(CONNECTION_STATES.CONNECTED);
    return true;
  } catch (error) {
    const errorDetails = {
      name: error.name || 'WebSocketError',
      message: error.message,
      stack: error.stack,
      chatId: this.chatId,
      state: this.state,
      wsUrl: this.wsUrl,
      reconnectAttempts: this.reconnectAttempts,
      timestamp: new Date().toISOString()
    };

    console.error('WebSocket connection failed:', errorDetails);
    
    this.setState(CONNECTION_STATES.ERROR);
    this.useHttpFallback = true;
    
    // Special handling for auth errors
    if (error.message.includes('403') || error.message.includes('token')) {
      try {
        console.log('Attempting token refresh due to auth error');
        await this.handleTokenRefresh();
        // If refresh succeeds, try reconnecting once
        if (this.reconnectAttempts < this.maxRetries) {
          return this.connect(chatId);
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', {
          error: refreshError.message,
          stack: refreshError.stack
        });
      }
    }
    
    // Create enriched error object
    const wsError = new Error(`WebSocket connection failed: ${error.message}`);
    wsError.details = errorDetails;
    wsError.originalError = error;
    throw wsError;
  }
};

window.WebSocketService.prototype.startHeartbeat = function() {
  if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  
  // Reset pending pongs counter
  this.pendingPongs = 0;
  this.lastPongTime = Date.now();
  
  this.heartbeatInterval = setInterval(() => {
    if (!this.isConnected()) return;
    
    // Check if we've missed too many pongs
    const timeSinceLastPong = Date.now() - this.lastPongTime;
    if (timeSinceLastPong > 90000) { // 1.5x heartbeat interval
      console.warn('Heartbeat timeout - no pong received in', timeSinceLastPong, 'ms');
      this.handleConnectionError(new Error(`Heartbeat timeout (${timeSinceLastPong}ms since last pong)`));
      return;
    }
    
    try {
      this.socket.send(JSON.stringify({
        type: 'ping',
        timestamp: Date.now()
      }));
      this.pendingPongs++;
      console.debug('Sent ping, pending pongs:', this.pendingPongs);
    } catch (err) {
      console.error('Failed to send heartbeat ping:', err);
      this.handleConnectionError(err);
    }
  }, 30000);
};

window.WebSocketService.prototype.establishConnection = function () {
  return new Promise((resolve, reject) => {
    this.pendingPongs = 0;
    // Validate URL again right before connection as a safety check
    if (!validateWebSocketUrl(this.wsUrl)) {
      return reject(new Error(`Invalid WebSocket URL: ${this.wsUrl}`));
    }

    const socket = new WebSocket(this.wsUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('Connection timeout'));
    }, this.connectionTimeout);

    socket.onopen = () => {
      clearTimeout(timeout);
      this.socket = socket;
      this.reconnectAttempts = 0;
      resolve();
    };

    socket.onmessage = (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        
        // Handle token refresh success
        if (data.type === 'token_refresh_success') {
          if (window.TokenManager) {
            window.TokenManager.tokenVersion = data.new_version;
            console.log('Token version updated to:', data.new_version);
          }
          return;
        }

        // Handle special message types
        if (data.type === 'pong') {
          this.pendingPongs = Math.max(0, this.pendingPongs - 1);
          this.lastPongTime = Date.now();
          console.debug('Received pong, pending pongs:', this.pendingPongs);
        } else if (data.type === 'token_refresh_required') {
          this.handleTokenRefresh().catch(err => {
            console.error('Token refresh failed:', err);
            this.socket.close(1000, 'Token refresh failed');
          });
          return;
        }

        // Handle pending message responses
        if (data.messageId && this.pendingMessages.has(data.messageId)) {
          const { resolve, reject, timeout } = this.pendingMessages.get(data.messageId);
          clearTimeout(timeout);
          this.pendingMessages.delete(data.messageId);

          data.type === 'error'
            ? reject(new Error(data.message || 'WebSocket error'))
            : resolve(data);
        }

        // Forward to general message handler
        this.onMessage(event);
      } catch (err) {
        console.error('Message parsing error:', err);
      }
    };

    socket.onerror = (error) => {
      clearTimeout(timeout);
      this.handleConnectionError(error);
      reject(error);
    };

    socket.onclose = (event) => {
      clearTimeout(timeout);
      
      // Skip error handling for normal closures (1000, 1001, 1005)
      if (![1000, 1001, 1005].includes(event.code)) {
        this.handleConnectionError(new Error(`Connection closed: ${event.code}`));
      }
      
      this.socket = null;
      this.setState(CONNECTION_STATES.DISCONNECTED);
    };
  });
};

window.WebSocketService.prototype.handleTokenRefresh = async function() {
  try {
    await window.TokenManager.refresh();
    
    // Add token to current connection
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: 'token_refresh',
        token: window.TokenManager.accessToken
      }));
      
      // Reset reconnect attempts and try reconnecting
      this.reconnectAttempts = 0;
      await this.attemptReconnection();
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
    // Graceful degradation
    this.useHttpFallback = true;
    if (this.onError) {
      this.onError(new Error('Session expired - please reload'));
    }
  }
};

window.WebSocketService.prototype.handleConnectionError = async function (error) {
  // Parse error code as number for reliable comparison
  const errorCode = Number(error.code) || 0;
  const errorDetails = {
    code: errorCode,
    reason: error.reason || error.message || 'unknown',
    wasClean: error.wasClean || false
  };

  // Skip all handling for normal closures (code 1005)
  if (errorCode === 1005) {
    this.socket = null;
    this.setState(CONNECTION_STATES.DISCONNECTED);
    return;
  }

  // Special handling for code 1008 (Policy Violation)
  if (errorCode === 1008) {
    console.error('WebSocket policy violation:', errorDetails, {
      state: this.state,
      chatId: this.chatId,
      projectId: this.projectId,
      reconnectAttempt: this.reconnectAttempts,
      wsUrl: this.wsUrl
    });

    // For policy violations, we should not attempt to reconnect
    this.useHttpFallback = true;
    this.setState(CONNECTION_STATES.DISCONNECTED);
    
    if (this.onError) {
      this.onError(new Error('Connection terminated due to policy violation. Using HTTP fallback.'));
    }
    return;
  }

  // Skip logging for normal closures (code 1005)
  if (errorDetails.code !== 1005) {
    console.error('WebSocket connection error:', {
      error: errorDetails,
      state: this.state,
      chatId: this.chatId,
      projectId: this.projectId,
      reconnectAttempt: this.reconnectAttempts,
      wsUrl: this.wsUrl,
      timestamp: new Date().toISOString()
    });
  }

  // Clean state and reference
  this.socket = null;
  this.setState(CONNECTION_STATES.ERROR);
  
  // Define max retries for clarity
  const MAX_RETRIES = 4;

  // Handle common error scenarios
  const isAuthError = (error?.message || '').includes('403') || 
                      (error?.message || '').includes('401') || 
                      (error?.message || '').includes('version mismatch');

  if (isAuthError) {
    try {
      console.log('Auth-related error - triggering token refresh');
      await window.TokenManager.refreshTokens();
      // Token refresh succeeded, attempt immediate reconnection
      if (this.reconnectAttempts < MAX_RETRIES) {
        return await this.attemptReconnection();
      }
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError);
    }
  }

  // Decide whether to retry connection or switch to HTTP fallback
  if (this.state !== CONNECTION_STATES.RECONNECTING && 
      this.reconnectAttempts < MAX_RETRIES) {
    return this.attemptReconnection();
  } 
  
  // Switch to HTTP fallback after exhausting retries
  console.warn('Switching to HTTP fallback after maximum reconnection attempts');
  this.useHttpFallback = true;
  this.setState(CONNECTION_STATES.DISCONNECTED);
  
  if (this.onError) {
    this.onError(new Error('Real-time connection unavailable. Using reliable HTTP fallback.'));
  }
};

window.WebSocketService.prototype.attemptReconnection = function () {
  if (this.reconnectAttempts >= this.maxRetries) {
    console.warn('Max reconnection attempts reached', {
      attempts: this.reconnectAttempts,
      maxRetries: this.maxRetries,
      lastError: this.lastError
    });
    this.useHttpFallback = true;
    this.setState(CONNECTION_STATES.DISCONNECTED);
    return;
  }

  this.setState(CONNECTION_STATES.RECONNECTING);
  this.reconnectAttempts++;
  this.lastError = null;

  // Calculate delay with exponential backoff and jitter
  const baseDelay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
  const jitter = baseDelay * 0.5 * Math.random(); // Up to 50% jitter
  const delay = Math.min(60000, baseDelay + jitter); // Cap at 60 seconds

  console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxRetries})`, {
    baseDelay,
    jitter,
    maxDelay: 60000
  });

  this.reconnectTimeout = setTimeout(() => {
    // Validate URL before reconnection attempt
    if (!validateWebSocketUrl(this.wsUrl)) {
      const error = new Error(`Invalid WebSocket URL for reconnection: ${this.wsUrl}`);
      console.error(error.message);
      this.lastError = error;
      this.useHttpFallback = true;
      this.setState(CONNECTION_STATES.DISCONNECTED);
      return;
    }

    this.connect(this.chatId)
      .catch((error) => {
        this.lastError = error;
        if (this.reconnectAttempts < this.maxRetries) {
          this.attemptReconnection();
        }
      });
  }, delay);
};

// Message handling
window.WebSocketService.prototype.send = function (payload) {
  if (this.useHttpFallback) {
    console.warn('Using HTTP fallback');
    return window.MessageService?.httpSend?.(payload) ||
      Promise.reject(new Error('HTTP fallback unavailable'));
  }

  if (!this.isConnected()) {
    return Promise.reject(new Error('WebSocket not connected'));
  }

  return new Promise((resolve, reject) => {
    const messageId = crypto.randomUUID?.() || `msg-${Date.now()}`;
    
    // Set up timeout for this message
    const messageTmout = setTimeout(() => {
      if (this.pendingMessages.has(messageId)) {
        this.pendingMessages.delete(messageId);
        reject(new Error('Message timeout'));
      }
    }, this.messageTimeout);

    this.pendingMessages.set(messageId, { 
      resolve, 
      reject,
      timeout: messageTmout 
    });

    try {
      this.socket.send(JSON.stringify({
        ...payload,
        messageId,
        timestamp: new Date().toISOString()
      }));
    } catch (err) {
      clearTimeout(messageTmout);
      this.pendingMessages.delete(messageId);
      reject(err);
    }
  });
};

// Connection status
window.WebSocketService.prototype.isConnected = function () {
  return this.socket && this.socket.readyState === WebSocket.OPEN;
};

// Clean disconnection
window.WebSocketService.prototype.disconnect = function () {
  // Clear any pending reconnection attempts
  if (this.reconnectTimeout) {
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }

  // Clear any pending messages
  if (this.pendingMessages.size > 0) {
    this.pendingMessages.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Connection closed'));
    });
    this.pendingMessages.clear();
  }

  // Clear heartbeat
  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }

  // Close the socket if it exists
  if (this.socket) {
    try {
      this.socket.close();
    } catch (err) {
      console.error('Error closing WebSocket:', err);
    }
    this.socket = null;
  }

  this.setState(CONNECTION_STATES.DISCONNECTED);
  console.debug('WebSocket disconnected and cleaned up');
};

/**
 * Cleanup on instance destruction
 * - Disconnects the WebSocket
 * - Clears all event handlers
 * - Removes all references to prevent memory leaks
 */
window.WebSocketService.prototype.destroy = function () {
  // Disconnect first to clean up resources
  this.disconnect();

  // Clear all event handlers
  this.onMessage = () => { };
  this.onError = () => { };
  this.onConnect = () => { };
  this.onDisconnect = () => { };

  // Clear other references
  this.pendingMessages = new Map();
  this.lastError = null;
  this.wsUrl = null;
  this.chatId = null;
  this.projectId = null;

  console.debug('WebSocketService instance destroyed');
};

/**
 * Utility function to validate WebSocket URL
 * @param {string} url - URL to validate
 * @returns {boolean} - Whether the URL is a valid WebSocket URL
 */
function validateWebSocketUrl(url) {
  if (!url || typeof url !== 'string') {
    console.error('Invalid WebSocket URL: URL is empty or not a string');
    return false;
  }

  try {
    const parsed = new URL(url);
    
    // Validate protocol
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      console.error('Invalid WebSocket protocol:', parsed.protocol);
      return false;
    }

    // Validate hostname
    if (!parsed.hostname) {
      console.error('Missing hostname in WebSocket URL');
      return false;
    }

    // Validate path (must start with /)
    if (!parsed.pathname.startsWith('/')) {
      console.error('WebSocket path must start with /:', parsed.pathname);
      return false;
    }

    // Additional security checks
    if (parsed.username || parsed.password) {
      console.error('WebSocket URL should not contain credentials');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Invalid WebSocket URL:', {
      url,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

  // Export for Node.js environments if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketService;
  }
  
  // Export version and constants for debugging after class is fully defined
  window.WebSocketService.version = '1.1.0';
  window.WebSocketService.CONNECTION_STATES = CONNECTION_STATES;

  /**
   * Changelog:
   * v1.1.0 - Improved WebSocket reliability
   *   - Enhanced heartbeat mechanism with ping/pong tracking
   *   - Added specific handling for code 1008 (Policy Violation)
   *   - Strengthened URL validation with security checks
   *   - Improved reconnection logic with better backoff and jitter
   *   - Added detailed logging for connection states and errors
   *   - Better cleanup of resources on disconnect/destroy
   */

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    console.debug(`${debugPrefix} Cleaning up before page unload`);
    if (window.WebSocketService) {
      const instances = Array.from(activeInstances.values());
      instances.forEach(instance => {
        try {
          instance.destroy();
        } catch (err) {
          console.debug(`${debugPrefix} Error during cleanup:`, err);
        }
      });
      activeInstances.clear();
    }
  });
})(); // End of IIFE
