(function() {
  // Prevent multiple executions
  if (window.__webSocketServiceLoaded) {
    console.warn('chat-websocket.js already loaded');
    return;
  }

  // Mark as loaded
  window.__webSocketServiceLoaded = true;

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

  // Only define WebSocketService if it doesn't exist
  if (window.WebSocketService) {
    console.warn('WebSocketService already defined');
    return;
  }

  // 1. Define the constructor FIRST
  window.WebSocketService = function (options = {}) {
    // Configuration
    this.maxRetries = options.maxRetries || 3;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.connectionTimeout = options.connectionTimeout || 10000;
    this.messageTimeout = options.messageTimeout || 30000;

    // State
    this.state = CONNECTION_STATES.DISCONNECTED;
    this.socket = null;
    this.chatId = null;
    this.projectId = localStorage.getItem("selectedProjectId");
    this.reconnectAttempts = 0;
    this.useHttpFallback = false;
    this.wsUrl = null;
    this.pendingMessages = new Map();

    // Dependencies
    this.authManager = new AuthManager();

    // Event handlers
    this.onMessage = options.onMessage || (() => { });
    this.onError = options.onError || ((err) => console.error('WebSocket Error:', err));
    this.onConnect = options.onConnect || (() => { });
    this.onDisconnect = options.onDisconnect || (() => { });
  };

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
  if (!chatId) throw new Error('Invalid chatId');

  if (this.state === CONNECTION_STATES.CONNECTED && this.chatId === chatId) {
    return true;
  }
  if (
    this.state === CONNECTION_STATES.CONNECTING ||
    this.state === CONNECTION_STATES.RECONNECTING
  ) {
    throw new Error('Connection already in progress');
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

    const basePath = `/api/projects/${this.projectId}/conversations/${chatId}/ws`;
    this.wsUrl = `${finalProtocol}${host}${basePath}?${params}`;
    console.log('Constructed WebSocket URL:', this.wsUrl);
  } catch (error) {
    console.error('Error constructing WebSocket URL:', error);
    this.useHttpFallback = true;
    throw new Error('Invalid WebSocket endpoint configuration');
  }

  if (!validateWebSocketUrl(this.wsUrl)) {
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
  
  this.heartbeatInterval = setInterval(() => {
    if (this.isConnected()) {
      this.socket.send(JSON.stringify({ type: 'ping' }));
      this.pendingPongs++;
      
      if (this.pendingPongs > 2) {
        console.warn('Missed pongs - forcing reconnect');
        this.handleConnectionError(new Error('Heartbeat timeout'));
      }
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
      if (event.code !== 1000) { // 1000 = normal closure
        this.handleConnectionError(new Error(`Connection closed: ${event.code}`));
      }
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
  const errorDetails = {
    code: error.code || 'unknown',
    reason: error.reason || error.message || 'unknown',
    wasClean: error.wasClean || false
  };

  console.error('WebSocket connection error:', {
    error: errorDetails,
    url: this.wsUrl,
    state: this.state,
    chatId: this.chatId,
    projectId: this.projectId,
    reconnectAttempt: this.reconnectAttempts
  });

  // Handle specific error codes
  if (error.code === 1006) {
    console.warn('Abnormal closure detected - resetting connection state');
    this.state = CONNECTION_STATES.DISCONNECTED;
    this.socket = null;
  } else if ((error?.message || '').includes('403') || (error?.message || '').includes('401') || (error?.message || '').includes('version mismatch')) {
    console.log('Auth-related error - triggering token refresh');
    try {
      await window.TokenManager.refreshTokens();
      await this.attemptReconnection();
    } catch (refreshError) {
      console.error('Token refresh failed:', refreshError);
    }
  }
  
  this.socket = null;
  this.setState(CONNECTION_STATES.ERROR);

  // Only attempt reconnection if not already in progress
  // and we haven't exceeded max retries
  // Add debug logging
  console.debug('Connection error details:', {
    error: error,
    wsUrl: this.wsUrl,
    state: this.state
  });

  // Maximum reasonable retries before full fallback
  const MAX_RETRIES = 4; 
  
  // Modify this condition:
  if (this.state !== CONNECTION_STATES.RECONNECTING &&
      this.reconnectAttempts < MAX_RETRIES) {
    this.attemptReconnection();
  } else {
    console.warn('Permanent connection failure - switching to HTTP only');
    this.useHttpFallback = true;
    this.setState(CONNECTION_STATES.DISCONNECTED);
    if (this.onError) {
      this.onError(new Error('Real-time connection unavailable. Using reliable HTTP fallback.'));
    }
  }
};

window.WebSocketService.prototype.attemptReconnection = function () {
  if (this.reconnectAttempts >= this.maxRetries) {
    console.warn('Max reconnection attempts reached');
    this.useHttpFallback = true;
    return;
  }

  this.setState(CONNECTION_STATES.RECONNECTING);
  this.reconnectAttempts++;

  // Calculate delay with exponential backoff and jitter
  const delay = Math.min(
    30000, // Max 30 seconds
    this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1) * (1 + Math.random() * 0.5)
  );

  console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

  setTimeout(() => {
    // Validate URL before reconnection attempt
    if (!validateWebSocketUrl(this.wsUrl)) {
      console.error(`Invalid WebSocket URL for reconnection: ${this.wsUrl}`);
      this.useHttpFallback = true;
      return;
    }

    this.connect(this.chatId).catch(() => {
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
  if (this.socket) {
    // Clear any pending messages
    this.pendingMessages.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Connection closed'));
    });
    this.pendingMessages.clear();

    // Close the socket
    this.socket.close();
    this.socket = null;
  }

  this.setState(CONNECTION_STATES.DISCONNECTED);
};

// Cleanup on instance destruction
window.WebSocketService.prototype.destroy = function () {
  this.disconnect();
  this.onMessage = () => { };
  this.onError = () => { };
  this.onConnect = () => { };
  this.onDisconnect = () => { };
};

/**
 * Utility function to validate WebSocket URL
 * @param {string} url - URL to validate
 * @returns {boolean} - Whether the URL is a valid WebSocket URL
 */
function validateWebSocketUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch (error) {
    console.error('Invalid WebSocket URL:', url, error);
    return false;
  }
}

  // Export for Node.js environments if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketService;
  }
  // Export version and constants for debugging
  WebSocketService.version = '1.0.1';
  WebSocketService.CONNECTION_STATES = CONNECTION_STATES;
})(); // End of IIFE
