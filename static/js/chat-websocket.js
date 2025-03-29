/**
 * chat-websocket.js
 * WebSocket service for real-time chat communication
 */

// Define WebSocketService as a constructor function attached to the window
window.WebSocketService = function(options = {}) {
  this.socket = null;
  this.chatId = null;
  this.projectId = localStorage.getItem("selectedProjectId");
  this.reconnectAttempts = 0;
  this.maxRetries = options.maxRetries || 3;
  this.reconnectInterval = options.reconnectInterval || 3000;
  this.useHttpFallback = false;
  this.connecting = false;
  this.wsUrl = null;
  this.authCheckInProgress = false;

  // Event handlers
  this.onMessage = options.onMessage || (() => {});
  this.onError = options.onError || (err => window.ChatUtils?.handleError?.('WebSocket', err) || console.error(err));
  this.onConnect = options.onConnect || (() => {});
  this.onDisconnect = options.onDisconnect || (() => {});
};

// Connect method
window.WebSocketService.prototype.connect = async function(chatId) {
  if (!chatId) {
    return Promise.reject(new Error('Invalid request: missing chatId'));
  }

  // Handle concurrent connection attempts
  if (this.connecting) {
    return new Promise((resolve, reject) => {
      const maxWait = 10000; // Increased timeout to 10 seconds
      const start = Date.now();
      
      const checkConnection = () => {
        if (!this.connecting) {
          this.connect(chatId).then(resolve).catch(reject);
        } else if (Date.now() - start < maxWait) {
          setTimeout(checkConnection, 100);
        } else {
          console.warn('WebSocket connection attempt timed out');
          this.connecting = false; // Reset connecting state on timeout
          this.useHttpFallback = true;
          reject(new Error('Connection timeout'));
        }
      };
      
      checkConnection();
    });
  }

  // Prevent connection attempts if auth system is not initialized or in progress
  if (window.API_CONFIG?.authCheckInProgress || this.authCheckInProgress) {
    console.warn('[WebSocketService] Auth check in progress, deferring connection');
    this.connecting = false;
    return Promise.reject(new Error('Auth check in progress'));
  }

  this.connecting = true;
  this.chatId = chatId;

  try {
    // First check if auth module is initialized
    if (!window.TokenManager && !window.auth) {
      console.warn('[WebSocketService] Auth modules not detected, delaying connection');
      this.connecting = false;
      this.useHttpFallback = true;
      return Promise.reject(new Error('Auth system not initialized'));
    }

    // Use standard authentication check from ChatUtils or auth.js
    this.authCheckInProgress = true;
    try {
      const authState = await window.ChatUtils?.isAuthenticated?.() || 
                      (window.auth?.verify ? await window.auth.verify() : false);
      
      if (!authState) {
        this.connecting = false;
        this.useHttpFallback = true;
        console.warn('WebSocket connection failed: Not authenticated');
        return Promise.reject(new Error('Authentication required'));
      }
    } finally {
      this.authCheckInProgress = false;
    }

    // Build URL parameters
    const params = new URLSearchParams();
    if (chatId) params.append('chatId', chatId);
    if (this.projectId) {
        params.append('projectId', this.projectId);
    }
    
    // Improved token acquisition that doesn't try to initialize auth
    // and instead immediately falls back to HTTP when TokenManager isn't ready
    const getToken = async () => {
      // If token is immediately available, return it
      if (window.TokenManager?.accessToken) {
        console.log('[WebSocketService] Token available, using it for connection');
        return window.TokenManager.accessToken;
      }
      
      // Important change: DON'T try to initialize auth or wait for TokenManager
      // Just immediately throw an error to trigger HTTP fallback
      if (!window.TokenManager) {
        console.warn('[WebSocketService] TokenManager not initialized, using HTTP fallback');
        throw new Error('TokenManager not initialized');
      }
      
      // If we got here, TokenManager exists but access token isn't available yet
      // Wait for a short time (3 seconds max) for token to become available
      // This is a much shorter wait than before (15s → 3s)
      try {
        console.log('[WebSocketService] TokenManager exists, waiting briefly for token');
        await new Promise((resolve, reject) => {
          const tokenTimeout = setTimeout(() => {
            reject(new Error('Token not available in time'));
          }, 3000); // Shorter 3 second timeout
          
          let attempts = 0;
          const maxAttempts = 15; // 3 seconds with 200ms checks
          
          const check = () => {
            if (window.TokenManager?.accessToken) {
              clearTimeout(tokenTimeout);
              console.log('[WebSocketService] Token became available');
              resolve();
            } else if (attempts++ < maxAttempts) {
              setTimeout(check, 200);
            } else {
              clearTimeout(tokenTimeout);
              reject(new Error('Token not available after checks'));
            }
          };
          check();
        });
        
        return window.TokenManager.accessToken;
      } catch (tokenError) {
        console.warn('[WebSocketService] Token not available in time, using HTTP fallback');
        throw tokenError;
      }
    };

    // Get token without too much waiting
    let token;
    try {
      token = await getToken();
      params.append('token', token);
    } catch (tokenError) {
      this.connecting = false;
      this.useHttpFallback = true;
      console.warn('[WebSocketService] Using HTTP fallback due to token issue');
      // Return an error that signals we should use HTTP, not a connection failure
      this.connecting = false;
      return Promise.reject(new Error('Using HTTP fallback'));
    }
    
    // Only log token if we got one
    if (token) {
      console.log('[WebSocketService] Using auth token:', token.substring(0, 6) + '...');
    }
    
    // Get proper protocol and host
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.host;

    if (this.projectId) {
      // Project-specific WebSocket endpoint
      this.wsUrl = `${wsProtocol}${host}/api/projects/${this.projectId}/ws/${chatId}?${params.toString()}`;
    } else {
      // Standalone conversation endpoint
      this.wsUrl = `${wsProtocol}${host}/ws?${params.toString()}`;
    }
    console.log('[WebSocketService] WebSocket URL:', this.wsUrl);
    if (!this.wsUrl.startsWith('ws://') && !this.wsUrl.startsWith('wss://')) {
      throw new Error('Invalid WebSocket URL');
    }

    return new Promise((resolve, reject) => {
      // Set a connection timeout
      const wsConnectionTimeout = setTimeout(() => {
        if (this.connecting) {
          this.connecting = false;
          this.useHttpFallback = true;
          console.warn('WebSocket connection timed out after 10 seconds');
          reject(new Error('WebSocket connection timed out'));
        }
      }, 10000); // 10 second timeout for the socket connection
      
      try {
        // Initialize the socket
        this.socket = new WebSocket(this.wsUrl);
        
        this.socket.onopen = () => {
          clearTimeout(wsConnectionTimeout);
          this.reconnectAttempts = 0;
          this.connecting = false;
          
          try {
            this.socket.send(JSON.stringify({
              type: 'auth',
              chatId: this.chatId,
              projectId: this.projectId || null
            }));
            
            console.log('WebSocket connection established successfully');
            this.onConnect();
            resolve(true);
          } catch (sendError) {
            console.error('Failed to send authentication message:', sendError);
            this.socket.close();
            reject(new Error('Failed to authenticate WebSocket connection'));
          }
        };
        
        // Attach message handler
        this.socket.onmessage = this.onMessage;
        
        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          clearTimeout(wsConnectionTimeout);
          
          if (this.connecting) {
            reject(error);
            this.connecting = false;
          }
          this._handleReconnect();
        };
        
        this.socket.onclose = (event) => {
          clearTimeout(wsConnectionTimeout);
          console.log(`WebSocket connection closed: Code ${event.code}`);
          
          if (event.code !== 1000) {
            this._handleReconnect();
          }
          
          this.onDisconnect(event);
          
          if (this.connecting) {
            reject(new Error(`Connection closed with code ${event.code}`));
            this.connecting = false;
          }
        };
      } catch (error) {
        clearTimeout(wsConnectionTimeout);
        this.connecting = false;
        this.reconnectAttempts++;
        console.error('Failed to create WebSocket:', error);
        reject(error);
      }
    });
  } catch (error) {
    this.connecting = false;
    this.useHttpFallback = true;
    return Promise.reject(error);
  }
};

// Handles reconnection with exponential backoff
window.WebSocketService.prototype._handleReconnect = async function() {
  // Don't attempt reconnection if TokenManager isn't available
  if (!window.TokenManager) {
    console.warn('[WebSocketService] TokenManager not available, skipping reconnection');
    this.useHttpFallback = true;
    return;
  }

  // Limit reconnection attempts based on authentication state
  if (this.reconnectAttempts++ >= this.maxRetries) {
    this.useHttpFallback = true;
    console.warn('[WebSocketService] Maximum reconnect attempts reached, using HTTP fallback');
    return;
  }

  // Only check auth state if we have access to TokenManager
  let authState = false;
  try {
    authState = window.TokenManager?.accessToken ? true : 
                (await window.ChatUtils?.isAuthenticated?.() || 
                (window.auth?.verify ? await window.auth.verify() : false));
  } catch (e) {
    console.warn('[WebSocketService] Auth check failed:', e);
  }
  
  if (!authState) {
    this.useHttpFallback = true;
    console.warn('[WebSocketService] Not authenticated, skipping reconnection');
    return;
  }

  // Exponential backoff
  const delay = Math.min(
    30000,
    this.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1)
  );
  await new Promise(resolve => setTimeout(resolve, delay));

  // Only attempt reconnect if we haven't exceeded max retries
  if (this.reconnectAttempts <= this.maxRetries) {
    try {
      await this.connect(this.chatId);
    } catch (e) {
      console.warn(`[WebSocketService] Reconnect attempt ${this.reconnectAttempts} failed: ${e.message}`);
    }
  }
};

// Connection status check
window.WebSocketService.prototype.isConnected = function() {
  return this.socket && this.socket.readyState === WebSocket.OPEN;
};

// Send message with unique ID for correlation
window.WebSocketService.prototype.send = function(payload) {
  if (this.useHttpFallback) {
    console.log('[WebSocketService] Using HTTP fallback');
    return window.MessageService?.httpSend?.(payload) || 
           Promise.reject(new Error('HTTP fallback not available'));
  }
  
  if (!this.isConnected()) {
    return Promise.reject(new Error('WebSocket not connected'));
  }

  const messageId = crypto.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  payload.messageId = messageId;

  return new Promise((resolve, reject) => {
    // Set up timeout for response
    const timeout = setTimeout(() => {
      this.socket.removeEventListener('message', messageHandler);
      reject(new Error('WebSocket message timed out after 30 seconds'));
    }, 30000);
    
    // Temporary handler for matching response
    const messageHandler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.messageId && data.messageId === messageId) {
          this.socket.removeEventListener('message', messageHandler);
          clearTimeout(timeout);
          
          if (data.type === 'error') {
            reject(new Error(data.message || 'WebSocket error'));
          } else {
            resolve(data);
          }
        }
      } catch (err) {
        // If JSON parse fails or no matching ID, ignore
      }
    };

    this.socket.addEventListener('message', messageHandler);
    
    try {
      this.socket.send(JSON.stringify(payload));
    } catch (err) {
      clearTimeout(timeout);
      this.socket.removeEventListener('message', messageHandler);
      reject(err);
    }
  });
};

// Disconnect and cleanup
window.WebSocketService.prototype.disconnect = function() {
  if (this.socket) {
    this.socket.close();
    this.socket = null;
  }
};
