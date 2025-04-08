(function () {
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
   * - Authentication via centralized auth.js
   * - HTTP fallback
   * - State management
   */

  // If a WebSocketService is already defined, skip re-definition
  if (window.WebSocketService) {
    console.debug(`${debugPrefix} Service already exists - using existing instance`);
    return;
  }

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
   * WebSocket Service
   * Handles real-time chat with optional reconnection & fallback
   */
  window.WebSocketService = function (options = {}) {
    // Enforce a singleton for each new instance
    if (activeInstances.has(this)) {
      console.debug(`${debugPrefix} Returning existing instance`);
      return activeInstances.get(this);
    }
    activeInstances.set(this, this);

    // Keep project ID purely in memory
    this.activeProjectId = null;
    document.addEventListener('projectSelected', (event) => {
      this.activeProjectId = event.detail?.projectId || null;
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

    // Event handlers
    this.onMessage = options.onMessage || (() => { });
    this.onError = options.onError || ((err) => console.error('WebSocket Error:', err));
    this.onConnect = options.onConnect || (() => { });
    this.onDisconnect = options.onDisconnect || (() => { });
  };

  /**
   * Validate a WebSocket URL
   */
  function validateWebSocketUrl(url) {
    if (!url || typeof url !== 'string') {
      console.error('Invalid WebSocket URL: URL is empty or not a string');
      return false;
    }
    try {
      const parsed = new URL(url);
      if (!parsed.protocol) {
        console.error('Missing protocol in WebSocket URL');
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

  window.WebSocketService.prototype.connect = async function (chatId) {
    if (!chatId) throw new Error('Invalid chatId');

    // If already connected to this chat, just return
    if (this.state === CONNECTION_STATES.CONNECTED && this.chatId === chatId) {
      console.debug(`${debugPrefix} Already connected to chat ${chatId}`);
      return true;
    }

    // If connecting/reconnecting is in progress, queue requests
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
      // Check auth using the centralized auth.js module
      if (!window.auth) {
        throw new Error('Auth module not available');
      }

      const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        throw new Error('User not authenticated');
      }

      // Get project ID from memory
      this.projectId = this.activeProjectId;

      // Get WebSocket token from centralized auth module
      const tokenData = await window.auth.getWSAuthToken();
      if (!tokenData?.token) {
        throw new Error('WebSocket auth token not available');
      }

      // Build WS host from config or fallback
      let host = window.API_CONFIG?.WS_ENDPOINT || window.location.host;
      host = host.replace(/^(wss?:\/\/|https?:\/\/)/, '');
      if (!host) {
        throw new Error('Empty WebSocket host');
      }
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';

      // See if this is a project-based conversation
      const currentConversation = window.chatInterface?.conversationService?.currentConversation;
      const selectedProjectId = this.projectId;
      const isProjectConversation =
        currentConversation?.project_id &&
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

      this.wsUrl = `${protocol}${host}${basePath}`;
      console.debug('Constructed WebSocket URL:', this.wsUrl);

      if (!validateWebSocketUrl(this.wsUrl)) {
        throw new Error(`Invalid WebSocket URL: ${this.wsUrl}`);
      }

      // If user is authenticated but no project ID is selected (when needed), handle it
      if (isAuthenticated && !this.projectId && isProjectConversation) {
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

      // Avoid multiple simultaneous connections
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

        // After the connection is established, explicitly delete the token variables 
        // to ensure they're not kept in memory
        tokenData.token = null;
        delete tokenData.token;
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

      // If error is auth-related, attempt refresh once using auth.js
      if (error.message.includes('403') || error.message.includes('401') ||
        error.message.includes('token') || error.message.includes('auth')) {
        try {
          console.log('Attempting token refresh due to auth error');
          await window.auth.refreshTokens();
          if (this.reconnectAttempts < this.maxRetries) {
            return this.connect(chatId);
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          // Let auth.js handle auth errors
          window.auth.handleAuthError(refreshError, 'WebSocket connection');
        }
      }
      throw enhancedError;
    }
  };

  window.WebSocketService.prototype.startHeartbeat = function () {
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
        this.socket.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        this.pendingPongs++;
        console.debug('Sent ping, pending pongs:', this.pendingPongs);
      } catch (err) {
        console.error('Failed to send heartbeat ping:', err);
        this.handleConnectionError(err);
      }
    }, 30000);
  };

  /**
   * Establish a WebSocket connection
   * This method sets up WebSocket handlers for real-time messages
   */
  window.WebSocketService.prototype.establishConnection = function () {
    return new Promise((resolve, reject) => {
      this.pendingPongs = 0;
      const socket = new WebSocket(this.wsUrl);
      this.socket = socket;

      const timeout = setTimeout(() => {
        const err = new Error(`Connection timeout after ${this.connectionTimeout}ms`);
        err.code = 'CONNECTION_TIMEOUT';
        socket.close();
        reject(err);
      }, this.connectionTimeout);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.reconnectAttempts = 0;
        console.log('WebSocket connection established');

        // Start heartbeat mechanism
        this.startHeartbeat();

        // Resolve the connection promise
        resolve();
      };

      socket.onmessage = (event) => {
        try {
          // Parse the message data
          const data = JSON.parse(event.data);

          // Handle ping/pong for connection keepalive
          if (data.type === 'pong') {
            this.pendingPongs = Math.max(0, this.pendingPongs - 1);
            this.lastPongTime = Date.now();
            console.debug('Received pong, pending pongs:', this.pendingPongs);
            return;
          }

          // Handle token refresh requests from server
          if (data.type === 'token_refresh_required') {
            this.handleTokenRefresh().catch(err => {
              console.error('Token refresh failed:', err);
              this.socket.close(1000, 'Token refresh failed');
            });
            return;
          }

          // Handle message responses
          if (data.messageId && this.pendingMessages.has(data.messageId)) {
            const { resolve, reject, timeout } = this.pendingMessages.get(data.messageId);
            clearTimeout(timeout);
            this.pendingMessages.delete(data.messageId);

            data.type === 'error'
              ? reject(new Error(data.message || 'WebSocket error'))
              : resolve(data);
          }

          // Forward to the message handler
          this.onMessage(event);
        } catch (err) {
          console.error('Message parsing error:', err);
        }
      };

      socket.onerror = (error) => {
        clearTimeout(timeout);
        const enhancedError = new Error('WebSocket connection error');
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
        console.log(`WebSocket closed with code ${event.code}`);

        // Don't treat normal close events as errors
        if (![1000, 1001, 1005].includes(event.code)) {
          this.handleConnectionError(new Error(`Connection closed: ${event.code}`));
        }

        // Clean up
        this.socket = null;
        this.setState(CONNECTION_STATES.DISCONNECTED);
      };
    });
  };

  window.WebSocketService.prototype.handleTokenRefresh = async function () {
    try {
      console.debug(`${debugPrefix} Token refresh required, using auth.js`);

      // Track refresh attempts
      const refreshStartTime = Date.now();

      // Use auth.js for token refresh
      await window.auth.refreshTokens();

      console.debug(`${debugPrefix} Token refresh successful in ${Date.now() - refreshStartTime}ms`);

      // Process any pending messages that should be rejected due to token refresh
      if (this.pendingMessages.size > 0) {
        console.debug(`${debugPrefix} Rejecting ${this.pendingMessages.size} pending messages due to token refresh`);
        this.pendingMessages.forEach(({ resolve, reject, timeout }) => {
          clearTimeout(timeout);
          reject(new Error('Token refreshed - please resend message'));
        });
        this.pendingMessages.clear();
      }

      // If we're connected, send the refreshed token to the server
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({
          type: 'token_refresh',
          timestamp: new Date().toISOString()
        }));

        this.reconnectAttempts = 0;
        return true;
      } else {
        // If socket is closed, we need to reconnect
        await this.attemptReconnection();
        return true;
      }

    } catch (error) {
      console.error(`${debugPrefix} Token refresh failed:`, error);

      // Let auth.js handle the error
      window.auth.handleAuthError(error, 'WebSocket token refresh');

      this.useHttpFallback = true;
      if (this.onError) {
        this.onError(error);
      }

      return false;
    }
  };

  window.WebSocketService.prototype.handleConnectionError = async function (error) {
    const errorCode = Number(error.code) || 0;
    const wsErrorDetails = {
      code: errorCode,
      reason: error.reason || error.message || 'unknown',
      wasClean: error.wasClean || false
    };

    if (errorCode === 1005) {
      this.socket = null;
      this.setState(CONNECTION_STATES.DISCONNECTED);
      return;
    }

    if (wsErrorDetails.code !== 1005) {
      console.error('WebSocket connection error:', {
        error: wsErrorDetails,
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

    // Check for auth-related errors and let auth.js handle them
    const isAuthError = (error?.message || '').includes('403') ||
      (error?.message || '').includes('401') ||
      (error?.message || '').includes('token') ||
      (error?.message || '').includes('auth');

    if (isAuthError) {
      try {
        console.log('Auth-related error - letting auth.js handle token refresh');
        // Delegate to auth.js for token issues
        await window.auth.refreshTokens();
        if (this.reconnectAttempts < MAX_RETRIES) {
          return await this.attemptReconnection();
        }
      } catch (refreshError) {
        console.error('Token refresh failed:', refreshError);
        // Let auth.js handle auth errors
        window.auth.handleAuthError(refreshError, 'WebSocket reconnection');
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

    // Implement Azure recommended exponential backoff with jitter
    const baseDelay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    const jitter = baseDelay * 0.5 * Math.random();
    const delay = Math.min(30000, baseDelay + jitter); // Cap at 30 seconds

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

  /**
   * Disconnect all active WebSocket connections
   * Added for better auth state management
   */
  window.WebSocketService.disconnectAll = function () {
    console.debug(`${debugPrefix} Disconnecting all WebSocket connections`);
    Array.from(activeInstances.values()).forEach(instance => {
      try {
        instance.disconnect();
      } catch (err) {
        console.debug(`${debugPrefix} Error during disconnect:`, err);
      }
    });
    activeInstances.clear();
  };

  // Expose version info
  window.WebSocketService.version = '2.0.0';
  window.WebSocketService.CONNECTION_STATES = CONNECTION_STATES;

  /**
   * Changelog:
   * v2.0.0 - Integration with centralized auth.js
   *   - Removed AuthManager class 
   *   - Uses auth.js for all authentication operations
   *   - Improved token refresh handling via auth.js
   *   - Enhanced error handling with auth.js integration
   */

  // Clean up all instances on page unload
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
