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

  // Event handlers
  this.onMessage = options.onMessage || (() => {});
  this.onError = options.onError || console.error;
  this.onConnect = options.onConnect || (() => {});
  this.onDisconnect = options.onDisconnect || (() => {});
};

// Connect method
window.WebSocketService.prototype.connect = async function(chatId) {
  if (!chatId || this.connecting) {
    return Promise.reject(new Error('Invalid request or already connecting'));
  }
  this.connecting = true;
  this.chatId = chatId;

  try {
    // Use existing auth.verify() instead of creating a new auth check
    const authState = await window.auth?.verify?.() || 
      !!(sessionStorage.getItem('auth_state') && sessionStorage.getItem('userInfo'));
    
    if (!authState) {
      this.connecting = false;
      this.useHttpFallback = true;
      return Promise.reject(new Error('Auth required'));
    }

    // Build URL
    const baseUrl = window.location.origin;
    const params = new URLSearchParams();
    if (chatId) params.append('chatId', chatId);
    if (this.projectId) params.append('projectId', this.projectId);
    
    // Use window.TokenManager instead of direct reference
    if (window.TokenManager?.accessToken) {
      params.append('token', window.TokenManager.accessToken);
    }
    
    // Get backend host from environment or use current host
    const backendHost = process.env.VITE_BACKEND_HOST || window.location.host;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    this.wsUrl = `${wsProtocol}${backendHost}/ws?${params.toString()}`;
    
    console.log('WebSocket URL:', this.wsUrl);
    if (!this.wsUrl.startsWith('ws://') && !this.wsUrl.startsWith('wss://')) {
      throw new Error('Invalid WebSocket URL');
    }

    return new Promise((resolve, reject) => {
      try {
        // Initialize the socket
        this.socket = new WebSocket(this.wsUrl);
        this.socket.onopen = () => {
          this.reconnectAttempts = 0;
          this.connecting = false;
          this.socket.send(JSON.stringify({
            type: 'auth',
            chatId: this.chatId,
            projectId: this.projectId || null
          }));
          this.onConnect();
          resolve(true);
        };
        // Attach message handler
        this.socket.onmessage = this.onMessage;
        this.socket.onerror = (error) => {
          if (this.connecting) {
            reject(error);
            this.connecting = false;
          }
          this._handleReconnect();
        };
        this.socket.onclose = (event) => {
          if (event.code !== 1000) {
            this._handleReconnect();
          }
          this.onDisconnect(event);
          if (this.connecting) {
            reject(new Error('Connection closed'));
            this.connecting = false;
          }
        };
      } catch (error) {
        this.connecting = false;
        this.reconnectAttempts++;
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
  if (this.reconnectAttempts++ >= this.maxRetries) {
    this.useHttpFallback = true;
    this.onError(new Error('Max reconnect attempts reached'));
    return;
  }

  // Auth check again using auth.js functionality
  const authState = await window.auth?.verify?.() || 
    !!(sessionStorage.getItem('auth_state') && sessionStorage.getItem('userInfo'));
    
  if (!authState) {
    this.useHttpFallback = true;
    this.onError(new Error('Authentication required for WebSocket'));
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
      console.warn(`WebSocket reconnect attempt ${this.reconnectAttempts} failed: ${e.message}`);
    }
  }
};

// Connection status check
window.WebSocketService.prototype.isConnected = function() {
  return this.socket && this.socket.readyState === WebSocket.OPEN;
};

// Send message with unique ID for correlation
window.WebSocketService.prototype.send = function(payload) {
  if (!this.isConnected()) {
    return Promise.reject(new Error('WebSocket not connected'));
  }

  const messageId = crypto.randomUUID?.() || (Date.now() + Math.random());
  payload.messageId = messageId;

  return new Promise((resolve, reject) => {
    // Temporary handler for matching response
    const messageHandler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.messageId && data.messageId === messageId) {
          this.socket.removeEventListener('message', messageHandler);
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
    this.socket.send(JSON.stringify(payload));
  });
};

// Disconnect and cleanup
window.WebSocketService.prototype.disconnect = function() {
  if (this.socket) {
    this.socket.close();
    this.socket = null;
  }
};
