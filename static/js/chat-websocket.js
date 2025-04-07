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
        // First try to use existing valid token
        if (window.TokenManager?.accessToken && !window.TokenManager.isExpired()) {
          if (window.TokenManager.version) {
            const storedVersion = localStorage.getItem('tokenVersion');
            if (storedVersion && storedVersion !== window.TokenManager.version) {
              console.warn('Token version mismatch - refreshing token');
              await window.TokenManager.refresh();
              return window.TokenManager.accessToken;
            }
          }
          return window.TokenManager.accessToken;
        }

        // Use new unified auth verification
        if (window.auth?.isAuthenticated) {
          const isAuthenticated = await window.auth.isAuthenticated();
          if (isAuthenticated && window.TokenManager?.accessToken) {
            if (window.TokenManager.version) {
              localStorage.setItem('tokenVersion', window.TokenManager.version);
            }
            return window.TokenManager.accessToken;
          }
        }

        // Fallback to direct token refresh if available
        if (window.TokenManager?.refresh) {
          await window.TokenManager.refresh();
          if (window.TokenManager.accessToken) {
            if (window.TokenManager.version) {
              localStorage.setItem('tokenVersion', window.TokenManager.version);
            }
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
    
    // Track project context
    this.activeProjectId = localStorage.getItem('selectedProjectId') || null;
    
    // Update on project selection events
    document.addEventListener('projectSelected', (event) => {
      this.activeProjectId = event.detail?.projectId || null;
      localStorage.setItem('selectedProjectId', this.activeProjectId);
    });

    // Configuration
    this.maxRetries = options.maxRetries || 3;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.connectionTimeout = options.connectionTimeout || 10000;
    this.messageTimeout = options.messageTimeout || 60000;

    // State
    this.state = CONNECTION_STATES.DISCONNECTED;
    this.socket = null;
    this.chatId = null;
    this.projectId = null;
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
      
      if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
        console.error('Invalid WebSocket protocol:', parsed.protocol);
        return false;
      }

      if (!parsed.hostname) {
        console.error('Missing hostname in WebSocket URL');
        return false;
      }

      if (!parsed.pathname.startsWith('/')) {
        console.error('WebSocket path must start with /:', parsed.pathname);
        return false;
      }

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
      // Verify authentication state
      const isAuthenticated = await window.auth?.isAuthenticated?.() ?? false;
      this.projectId = localStorage.getItem("selectedProjectId");

      // Get authentication token
      const token = await this.authManager.getValidToken();
      const params = new URLSearchParams({ token });

      // Construct WebSocket URL
      let host = window.API_CONFIG?.WS_ENDPOINT || window.location.host;
      host = host.replace(/^(wss?:\/\/|https?:\/\/)/, '');
      
      if (!host) {
        throw new Error('Empty WebSocket host');
      }

      // Enforce same-origin WebSocket connections
      if (window.location.host !== host) {
        throw new Error(`WebSocket host mismatch (${host} vs ${window.location.host})`);
      }
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      
      // Determine correct WebSocket URL path
      const currentConversation = window.chatInterface?.conversationService?.currentConversation;
      const selectedProjectId = this.projectId;
      const isProjectConversation = currentConversation?.project_id && 
                                  selectedProjectId && 
                                  currentConversation.project_id === selectedProjectId;

      let basePath;
      if (isProjectConversation) {
        console.log(`Using project-scoped WebSocket for conversation ${chatId} in project ${selectedProjectId}`);
        basePath = `/api/chat/projects/${selectedProjectId}/conversations/${chatId}/ws`;
      } else {
        console.log(`Using standalone WebSocket for conversation ${chatId}`);
        basePath = `/api/chat/conversations/${chatId}/ws`;
        this.projectId = null;
      }

      this.wsUrl = `${protocol}${host}${basePath}?${params}`;
      console.debug('Constructed WebSocket URL:', this.wsUrl);

      if (!validateWebSocketUrl(this.wsUrl)) {
        throw new Error(`Invalid WebSocket URL: ${this.wsUrl}`);
      }

      // Verify project selection for authenticated users
      if (isAuthenticated && !this.projectId) {
        const errorMsg = 'Please select a project before starting a conversation';
        if (window.UIUtils?.showNotification) {
          window.UIUtils.showNotification(errorMsg, 'warning');
        } else {
          console.warn(errorMsg);
        }
        this.disconnect();
        this.useHttpFallback = true;
        return false;
      }

      // Check if another instance is already connecting
      if (window.__wsConnecting === this.wsUrl) {
        return new Promise(resolve => {
          const check = () => {
            if (this.state === CONNECTION_STATES.CONNECTED) resolve(true);
            else setTimeout(check, 100);
          };
          check();
        });
      }

      window.__wsConnecting = this.wsUrl;
      try {
        await this.establishConnection();
      } finally {
        window.__wsConnecting = null;
      }
      this.setState(CONNECTION_STATES.CONNECTED);
      return true;

    } catch (error) {
      const enhancedError = new Error(`WebSocket connection failed: ${error.message}`);
      enhancedError.code = 'WS_CONNECTION_ERROR';
      enhancedError.details = {
        originalError: error,
        chatId: this.chatId,
        projectId: this.projectId,
        wsUrl: this.wsUrl
      };

      console.error('WebSocket connection failed:', enhancedError);
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
          console.error('Token refresh failed:', refreshError);
        }
      }

      throw enhancedError;
    }
  };

  window.WebSocketService.prototype.startHeartbeat = function() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    
    this.pendingPongs = 0;
    this.lastPongTime = Date.now();
    
    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected()) return;
      
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      if (timeSinceLastPong > 90000) {
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

      const socket = new WebSocket(this.wsUrl);
      const timeout = setTimeout(() => {
        const err = new Error(`Connection timeout after ${this.connectionTimeout}ms`);
        err.code = 'CONNECTION_TIMEOUT';
        socket.close();
        reject(err);
      }, this.connectionTimeout);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.reconnectAttempts = 0;
        console.debug('WebSocket connection established', {
          url: this.wsUrl,
          chatId: this.chatId,
          projectId: this.projectId
        });
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          
          if (data.type === 'token_refresh_success') {
            if (window.TokenManager) {
              window.TokenManager.tokenVersion = data.new_version;
              console.log('Token version updated to:', data.new_version);
            }
            return;
          }

          if (data.type === 'pong') {
            this.pendingPongs = Math.max(0, this.pendingPongs - 1);
            this.lastPongTime = Date.now();
            console.debug('Received pong, pending pongs:', this.pendingPongs);
            return;
          }
          
          if (data.type === 'token_refresh_required') {
            this.handleTokenRefresh().catch(err => {
              console.error('Token refresh failed:', err);
              this.socket.close(1000, 'Token refresh failed');
            });
            return;
          }

          if (data.messageId && this.pendingMessages.has(data.messageId)) {
            const { resolve, reject, timeout } = this.pendingMessages.get(data.messageId);
            clearTimeout(timeout);
            this.pendingMessages.delete(data.messageId);

            data.type === 'error'
              ? reject(new Error(data.message || 'WebSocket error'))
              : resolve(data);
          }

          this.onMessage(event);
        } catch (err) {
          console.error('Message parsing error:', err);
        }
      };

      socket.onerror = (error) => {
        clearTimeout(timeout);
        const enhancedError = new Error(`WebSocket connection error: ${error.message || 'Unknown error'}`);
        enhancedError.code = 'WS_CONNECTION_ERROR';
        enhancedError.details = {
          url: this.wsUrl,
          chatId: this.chatId,
          state: this.state,
          originalError: error
        };
        console.error('WebSocket connection failed:', enhancedError.details);
        this.handleConnectionError(enhancedError);
        reject(enhancedError);
      };

      socket.onclose = (event) => {
        clearTimeout(timeout);
        
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
      
      if (window.TokenManager.version) {
        localStorage.setItem('tokenVersion', window.TokenManager.version);
      }
      
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: 'token_refresh',
          token: window.TokenManager.accessToken,
          version: window.TokenManager.version
        }));
        
        this.reconnectAttempts = 0;
        await this.attemptReconnection();
      }
      
      this.pendingMessages.forEach(({ resolve, reject, timeout }) => {
        clearTimeout(timeout);
        reject(new Error('Token refreshed - please resend message'));
      });
      this.pendingMessages.clear();
      
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.useHttpFallback = true;
      if (this.onError) {
        const enhancedError = new Error('Session expired - please reload');
        enhancedError.code = 'TOKEN_REFRESH_FAILED';
        this.onError(enhancedError);
      }
    }
  };

  window.WebSocketService.prototype.handleConnectionError = async function (error) {
    const errorCode = Number(error.code) || 0;
    const errorDetails = {
      code: errorCode,
      reason: error.reason || error.message || 'unknown',
      wasClean: error.wasClean || false
    };

    if (errorCode === 1005) {
      this.socket = null;
      this.setState(CONNECTION_STATES.DISCONNECTED);
      return;
    }

    if (errorCode === 1008) {
      const errorInfo = {
        state: this.state,
        chatId: this.chatId,
        projectId: this.projectId,
        reconnectAttempt: this.reconnectAttempts,
        wsUrl: this.wsUrl,
        timestamp: new Date().toISOString()
      };
      console.error('WebSocket policy violation - authentication failure', errorDetails, errorInfo);

      this.useHttpFallback = true;
      this.setState(CONNECTION_STATES.DISCONNECTED);
      
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      try {
        if (window.TokenManager?.refreshTokens) {
          await window.TokenManager.refreshTokens();
          
          if (this.onError) {
            this.onError({
              name: 'AuthenticationRefreshed',
              message: 'Session refreshed. Using reliable HTTP messaging.',
              statusText: 'Session refreshed. Using reliable HTTP messaging.'
            });
          }
        }
      } catch (refreshError) {
        console.error('Token refresh failed after policy violation:', refreshError);
        if (this.onError) {
          const error = new Error('Session expired - please log in again');
          error.details = errorInfo;
          this.onError(error);
        }
      }
      return;
    }

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

    this.socket = null;
    this.setState(CONNECTION_STATES.ERROR);
    
    const MAX_RETRIES = 4;
    const isAuthError = (error?.message || '').includes('403') || 
                        (error?.message || '').includes('401') || 
                        (error?.message || '').includes('version mismatch');

    if (isAuthError) {
      try {
        console.log('Auth-related error - triggering token refresh');
        await window.TokenManager.refreshTokens();
        if (this.reconnectAttempts < MAX_RETRIES) {
          return await this.attemptReconnection();
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
      }
    }

    if (this.state !== CONNECTION_STATES.RECONNECTING && 
        this.reconnectAttempts < MAX_RETRIES) {
      return this.attemptReconnection();
    } 
    
    console.warn('Switching to HTTP fallback after maximum reconnection attempts');
    this.useHttpFallback = true;
    this.setState(CONNECTION_STATES.DISCONNECTED);
    
    if (this.onError) {
      this.onError(new Error('Real-time connection unavailable. Using reliable HTTP fallback.'));
    }
  };

  window.WebSocketService.prototype.attemptReconnection = function () {
    if (this.reconnectAttempts >= this.maxRetries) {
      const errorInfo = {
        attempts: this.reconnectAttempts,
        maxRetries: this.maxRetries,
        lastError: this.lastError,
        chatId: this.chatId,
        projectId: this.projectId,
        timestamp: new Date().toISOString()
      };
      console.warn('Max reconnection attempts reached', errorInfo);
      this.useHttpFallback = true;
      this.setState(CONNECTION_STATES.DISCONNECTED);
      
      if (this.onError) {
        const error = new Error('Failed to reconnect - using HTTP fallback');
        error.details = errorInfo;
        this.onError(error);
      }
      return;
    }

    this.setState(CONNECTION_STATES.RECONNECTING);
    this.reconnectAttempts++;
    this.lastError = null;

    const baseDelay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = baseDelay * 0.5 * Math.random();
    const delay = Math.min(30000, baseDelay + jitter);

    const attemptInfo = {
      attempt: this.reconnectAttempts,
      maxRetries: this.maxRetries,
      delay,
      baseDelay,
      jitter,
      chatId: this.chatId,
      projectId: this.projectId,
      timestamp: new Date().toISOString()
    };
    console.log('Scheduling reconnection attempt', attemptInfo);

    this.reconnectTimeout = setTimeout(() => {
      if (!validateWebSocketUrl(this.wsUrl)) {
        const error = new Error(`Invalid WebSocket URL for reconnection: ${this.wsUrl}`);
        error.details = attemptInfo;
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
      const timeoutMs = payload.timeoutMs || this.messageTimeout;
      
      const messageTmout = setTimeout(() => {
        if (this.pendingMessages.has(messageId)) {
          this.pendingMessages.delete(messageId);
          console.debug(`[WebSocket] Message ${messageId} timed out after ${timeoutMs}ms`);
          reject(new Error('Message timeout'));
        }
      }, timeoutMs);

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

  window.WebSocketService.prototype.isConnected = function () {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  };

  window.WebSocketService.prototype.disconnect = function () {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.pendingMessages.size > 0) {
      console.log(`Safely rejecting ${this.pendingMessages.size} pending messages`);
      this.pendingMessages.forEach(({ reject, timeout }) => {
        clearTimeout(timeout);
        const closeError = new Error('Connection closed - safe disconnect');
        closeError.code = 'SAFE_DISCONNECT';
        reject(closeError);
      });
      this.pendingMessages.clear();
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.socket) {
      try {
        if (this.socket.readyState !== WebSocket.CLOSED && 
            this.socket.readyState !== WebSocket.CLOSING) {
          console.debug('Closing WebSocket connection');
          this.socket.onclose = null;
          this.socket.close();
        }
      } catch (err) {
        console.debug('Non-critical error during WebSocket close:', err);
      }
      this.socket = null;
    }

    if (this.state !== CONNECTION_STATES.DISCONNECTED) {
      this.setState(CONNECTION_STATES.DISCONNECTED);
    }
    
    console.debug('WebSocket disconnected and cleaned up');
  };

  window.WebSocketService.prototype.destroy = function () {
    this.disconnect();
    this.onMessage = () => { };
    this.onError = () => { };
    this.onConnect = () => { };
    this.onDisconnect = () => { };
    this.pendingMessages = new Map();
    this.lastError = null;
    this.wsUrl = null;
    this.chatId = null;
    this.projectId = null;
    console.debug('WebSocketService instance destroyed');
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketService;
  }
  
  // Export version and constants for debugging
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
})();
