/**
 * WebSocketService.js
 * Manages WebSocket connection, reconnection, and message handling
 */

class WebSocketService {
  constructor(options = {}) {
    this.wsUrl = null;
    this.socket = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || console.error;
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    this.chatId = null;
    this.projectId = null;
  }

  async connect(chatId) {
    if (!chatId) {
      this.onError('No chat ID provided for WebSocket connection');
      return false;
    }

    this.chatId = chatId;
    this.projectId = localStorage.getItem("selectedProjectId");

    try {
      await this._verifyAuth();
      this.wsUrl = await this._buildWsUrl(chatId);
      this._initializeWebSocket();
      return true;
    } catch (error) {
      this.onError('Failed to establish WebSocket connection', error);
      return false;
    }
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.onError('Failed to send message via WebSocket', error);
      return false;
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  // Private methods for internal use
  async _verifyAuth() {
    const authResponse = await fetch('/api/auth/verify', { credentials: 'include' });
    if (!authResponse.ok) {
      throw new Error('Authentication check failed for WebSocket');
    }
    return true;
  }

  async _buildWsUrl(chatId) {
    const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const host = window.location.hostname;
    const port = window.location.port ? `:${window.location.port}` : '';
    const projectId = this.projectId;

    // Verify conversation exists
    const checkEndpoint = projectId
      ? `/api/projects/${projectId}/conversations/${chatId}`
      : `/api/chat/conversations/${chatId}`;

    const response = await fetch(`${window.location.origin}${checkEndpoint}`, {
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`Conversation ${chatId} not accessible: ${response.status}`);
    }

    // Build final wsUrl
    return projectId
      ? `${protocol}${host}${port}/api/projects/${projectId}/conversations/${chatId}/ws`
      : `${protocol}${host}${port}/api/chat/conversations/${chatId}/ws`;
  }

  _initializeWebSocket() {
    if (!this.wsUrl) {
      this.onError("No WebSocket URL available");
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onError("Max WebSocket reconnection attempts reached");
      return;
    }

    // Get auth token
    const authToken = document.cookie
      .split('; ')
      .find(row => row.startsWith('access_token='))
      ?.split('=')[1];

    if (!authToken) {
      this.onError("No auth token for WebSocket");
      return;
    }

    try {
      console.log("Initializing WebSocket:", this.wsUrl);
      this.socket = new WebSocket(this.wsUrl);

      this.socket.onopen = () => {
        console.log("WebSocket connected");
        this.reconnectAttempts = 0;

        this.socket.send(JSON.stringify({
          type: 'auth',
          token: authToken,
          chatId: this.chatId,
          projectId: this.projectId
        }));

        setTimeout(() => {
          try {
            this.socket.send(JSON.stringify({ type: 'ping' }));
          } catch (error) {
            console.warn('Connection verification failed:', error);
          }
        }, 1000);
        
        this.onConnect();
      };

      this.socket.onmessage = (event) => {
        this.onMessage(event);
      };

      this.socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        if (this.reconnectAttempts === 0) {
          this.onError("Connection error occurred. Retrying...");
        }

        // Try refresh
        fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
          .catch(err => console.error('Auth refresh failed:', err));
      };

      this.socket.onclose = (event) => {
        console.warn("WebSocket closed. Code:", event.code, "Reason:", event.reason);
        this.onDisconnect(event);
        this._handleWebSocketClose(event);
      };
    } catch (error) {
      this.onError("Error initializing WebSocket:", error);
      this._scheduleReconnect();
    }
  }

  _handleWebSocketClose(event) {
    switch (event.code) {
      case 1000:
        console.log("WebSocket closed normally");
        break;
      case 1001:
        console.log("Page is being unloaded");
        break;
      case 1006:
        console.warn("Connection closed abnormally");
        this._scheduleReconnect();
        break;
      case 1008:
        console.error("Authentication failure on WebSocket");
        this._tryTokenRefresh();
        break;
      default:
        console.warn(`WebSocket closed with code ${event.code}`);
        this._scheduleReconnect();
    }
  }

  async _tryTokenRefresh() {
    try {
      await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      this._scheduleReconnect();
    } catch (error) {
      console.error("Failed to refresh auth:", error);
      this.onError("Authentication failed. Please log in again.");
    }
  }

  _scheduleReconnect() {
    // Exponential backoff for reconnection
    const backoffDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    console.log(`Reconnecting in ${backoffDelay/1000}s... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (document.visibilityState === 'visible') {
        this.connect(this.chatId);
      }
    }, backoffDelay);
  }
}
