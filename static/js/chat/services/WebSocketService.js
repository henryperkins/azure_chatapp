/**
 * WebSocketService.js
 * Manages WebSocket connections with authentication and reconnection handling
 */
export default class WebSocketService {
  constructor({
    maxReconnectAttempts = 5,
    reconnectInterval = 3000,
    onMessage = () => {},
    onError = console.error,
    onConnect = () => {},
    onDisconnect = () => {}
  } = {}) {
    this.socket = null;
    this.chatId = null;
    this.projectId = localStorage.getItem("selectedProjectId");
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.reconnectInterval = reconnectInterval;
    this.useHttpFallback = false;
    this.authenticated = false;
    this.connecting = false;
    this.wsUrl = null;
    
    this.onMessage = onMessage;
    this.onError = onError;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
  }

  /**
   * Connect to WebSocket with authentication check
   * @param {string} chatId - The conversation ID
   * @returns {Promise} - Resolves when connected or falls back to HTTP
   */
  async connect(chatId) {
    if (!chatId) {
      this.onError('Chat ID required for WebSocket connection');
      return Promise.reject(new Error('Chat ID required'));
    }

    if (this.connecting) {
      return Promise.reject(new Error('Connection already in progress'));
    }

    this.connecting = true;
    this.chatId = chatId;
    
    try {
      // Check authentication first
      const isAuthenticated = await this._checkAuthentication();
      
      if (!isAuthenticated) {
        this.connecting = false;
        this.useHttpFallback = true;
        this.onError('Authentication required for WebSocket connection. Using HTTP fallback.');
        return Promise.reject(new Error('Authentication required'));
      }
      
      this.authenticated = true;
      this.wsUrl = await this._buildWsUrl(chatId);
      
      return new Promise((resolve, reject) => {
        try {
          this._initWebSocket(resolve, reject);
        } catch (error) {
          this.connecting = false;
          reject(error);
        }
      });
    } catch (error) {
      this.connecting = false;
      this.onError('Failed to establish WebSocket connection: ' + error.message);
      this.useHttpFallback = true;
      return Promise.reject(error);
    }
  }

  /**
   * Send message through WebSocket or reject if not connected
   * @param {Object} message - Message to send 
   * @returns {Promise} - Resolves when sent or rejects on error
   */
  send(message) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      try {
        this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect WebSocket connection
   */
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    this.connecting = false;
    this.authenticated = false;
    this.chatId = null;
  }
  
  /**
   * Check if the WebSocket is currently connected
   * @returns {boolean} - True if connected
   */
  isConnected() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Check if fallback to HTTP is being used
   * @returns {boolean} - True if using HTTP fallback
   */
  isUsingHttpFallback() {
    return this.useHttpFallback;
  }

  // ----------------------
  // Internal Methods
  // ----------------------
  
  /**
   * Check if user is authenticated before attempting WebSocket connection
   * @returns {Promise<boolean>} - True if authenticated
   */
  async _checkAuthentication() {
    // First check session storage for quick verification
    const authState = sessionStorage.getItem('auth_state');
    const userInfo = sessionStorage.getItem('userInfo');
    
    if (!authState || !userInfo) {
      console.log('No auth state or user info in session storage');
      return false;
    }
    
    try {
      // Verify with server if we have tokens
      if (window.TokenManager?.accessToken || 
          (JSON.parse(authState)?.hasTokens === true)) {
        
        const verifyResponse = await this._api('/api/auth/verify');
        return verifyResponse.ok;
      }
      return false;
    } catch (error) {
      console.error('Authentication check failed:', error);
      return false;
    }
  }

  /**
   * Build WebSocket URL based on current page URL
   * @param {string} chatId - The conversation ID
   * @returns {Promise<string>} - WebSocket URL
   */
  async _buildWsUrl(chatId) {
    // Get the base URL and replace http(s):// with ws(s)://
    const baseUrl = window.location.origin;
    const wsBase = baseUrl.replace(/^http/, 'ws');
    
    // Check if project ID exists
    const projectId = this.projectId;
    const params = new URLSearchParams();
    
    if (chatId) params.append('chatId', chatId);
    if (projectId) params.append('projectId', projectId);
    
    // Add authentication token if available
    if (window.TokenManager?.accessToken) {
      params.append('token', window.TokenManager.accessToken);
    }
    
    return `${wsBase}/ws?${params.toString()}`;
  }

  /**
   * Initialize WebSocket connection with proper error handling
   * @param {Function} resolve - Promise resolve function
   * @param {Function} reject - Promise reject function
   */
  _initWebSocket(resolve, reject) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`WebSocket connection failed after ${this.maxReconnectAttempts} attempts. Using HTTP fallback.`);
      this.useHttpFallback = true;
      this.connecting = false;
      reject(new Error(`Failed after ${this.maxReconnectAttempts} attempts`));
      return;
    }

    try {
      console.log(`Attempting WebSocket connection to: ${this.wsUrl}`);
      this.socket = new WebSocket(this.wsUrl);
      
      this.socket.onopen = () => {
        console.log("WebSocket connection established");
        this.reconnectAttempts = 0;
        this.connecting = false;
        
        // Send authentication message
        const authMsg = {
          type: 'auth',
          chatId: this.chatId,
          projectId: this.projectId || null
        };
        
        try {
          this.socket.send(JSON.stringify(authMsg));
          this.onConnect();
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      this.socket.onmessage = this.onMessage;
      
      this.socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (this.connecting) {
          reject(error);
          this.connecting = false;
        }
        this._handleReconnect();
      };
      
      this.socket.onclose = (event) => {
        this._handleClose(event).catch(err => {
          console.error("Error handling WebSocket close:", err);
        });
        
        if (this.connecting) {
          reject(new Error('WebSocket closed during connection'));
          this.connecting = false;
        }
      };
    } catch (error) {
      console.error("Error initializing WebSocket:", error);
      this.connecting = false;
      this.reconnectAttempts++;
      reject(error);
    }
  }

  /**
   * Handle WebSocket close event
   * @param {CloseEvent} closeEvent - WebSocket close event
   */
  async _handleClose(closeEvent) {
    // Code 1000 is normal closure
    const abnormalClosure = closeEvent.code !== 1000;
    
    console.log(`WebSocket closed. Code: ${closeEvent.code}, Reason: ${closeEvent.reason}, Abnormal: ${abnormalClosure}`);
    
    this.onDisconnect(closeEvent);
    
    if (abnormalClosure) {
      await this._handleReconnect();
    }
  }

  /**
   * Handle WebSocket reconnection
   */
  async _handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Using HTTP fallback.`);
      this.useHttpFallback = true;
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    
    // Wait before reconnecting
    await new Promise(resolve => setTimeout(resolve, this.reconnectInterval));
    
    // Check authentication again before reconnecting
    const isAuthenticated = await this._checkAuthentication();
    if (!isAuthenticated) {
      console.warn("Authentication lost, cannot reconnect WebSocket");
      this.useHttpFallback = true;
      this.onError("Authentication required for WebSocket. Using HTTP fallback.");
      return;
    }
    
    try {
      await this.connect(this.chatId);
    } catch (error) {
      console.error("Reconnection failed:", error);
    }
  }

  /**
   * Simple API helper for authentication checks
   * @param {string} url - API endpoint
   * @param {string} method - HTTP method
   * @returns {Promise<Response>} - Fetch response
   */
  async _api(url, method = 'GET') {
    try {
      // Add auth header if available
      const headers = {};
      if (window.TokenManager?.getAuthHeader) {
        Object.assign(headers, window.TokenManager.getAuthHeader());
      }
      
      const response = await fetch(url, {
        method,
        headers,
        credentials: 'include',
        cache: 'no-cache'
      });
      
      return response;
    } catch (error) {
      console.error('API request failed:', error);
      return { ok: false };
    }
  }

  /**
   * Test the WebSocket connection and authentication
   * @returns {Promise<object>} Connection test results
   */
  async testConnection() {
    try {
      // First check authentication
      console.log("Testing WebSocket authentication...");
      const isAuthenticated = await this._checkAuthentication();
      
      if (!isAuthenticated) {
        return {
          success: false,
          authenticated: false,
          message: "Authentication required for WebSocket connection"
        };
      }
      
      // Try to build WebSocket URL
      console.log("Building WebSocket URL...");
      const wsUrl = await this._buildWsUrl("test");
      
      return {
        success: true,
        authenticated: true,
        wsUrl: wsUrl,
        message: "WebSocket prerequisites passed"
      };
    } catch (error) {
      console.error("WebSocket connection test failed:", error);
      return {
        success: false,
        error: error.message,
        message: "WebSocket connection test failed"
      };
    }
  }
}