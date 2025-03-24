/**
 * WebSocketService.js
 * Optimized WebSocket connection manager with auto-reconnect
 */

export default class WebSocketService {
  constructor({
    maxReconnectAttempts = 5,
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
    this.onMessage = onMessage;
    this.onError = onError;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
  }

  async connect(chatId) {
    if (!chatId) return this.onError('Chat ID required for WebSocket.');

    this.chatId = chatId;
    try {
      await this._ensureAuthenticated();
      this.wsUrl = await this._buildWsUrl(chatId);
      this._initWebSocket();
    } catch (e) {
      this.onError(e.message);
    }
  }

  send(message) {
    // If WebSocket is open, use it
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    
    // If we've set the HTTP fallback flag, don't show an error
    if (this.useHttpFallback) {
      console.log("Using HTTP fallback instead of WebSocket");
      return false; // Return false to trigger HTTP fallback in MessageService
    }
    
    // Otherwise, show an error
    this.onError('WebSocket not open.');
    return false;
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
  }

  // ----------------------
  // Internal Methods
  // ----------------------
  async _ensureAuthenticated() {
    if (!(await this._api('/api/auth/verify')).ok) {
      if (!(await this._api('/api/auth/refresh', 'POST')).ok) {
        throw new Error('Authentication failed.');
      }
    }
  }

  async _buildWsUrl(chatId) {
    const endpoint = this.projectId
      ? `/api/projects/${this.projectId}/conversations/${chatId}`
      : `/api/chat/conversations/${chatId}`;

    const res = await this._api(endpoint);
    if (!res.ok) throw new Error(`Conversation ${chatId} not accessible.`);

    // Use a safe default hostname if the current one doesn't look right
    const currentHostname = location.hostname;
    const backendHost = window.BACKEND_HOST ||
                       (currentHostname === 'put.photo' ? 'localhost' : currentHostname);
    
    // Use the same port as the current page if not specified in backendHost
    const port = location.port ? `:${location.port}` : '';
    // Use ws:// for localhost, wss:// otherwise
    const wsProtocol = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'ws:' : (location.protocol === 'https:' ? 'wss:' : 'ws:');
    
    // Build the WebSocket URL
    return `${wsProtocol}//${backendHost}${port}${endpoint}/ws`;
    // TODO: Ensure wss:// is used in production
  }

  _initWebSocket() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // When max reconnection attempts are reached, we'll set a flag to use HTTP fallback
      console.warn("WebSocket connection failed after multiple attempts. Using HTTP fallback.");
      this.useHttpFallback = true;
      return this.onError("WebSocket connection unavailable. Using HTTP fallback for communication.");
    }

    try {
      console.log(`Attempting WebSocket connection to: ${this.wsUrl}`);
      this.socket = new WebSocket(this.wsUrl);
      
      this.socket.onopen = () => {
        console.log("WebSocket connection established successfully");
        this.reconnectAttempts = 0;
        this.useHttpFallback = false;
        this.socket.send(JSON.stringify({ type: 'auth', chatId: this.chatId, projectId: this.projectId }));
        this.onConnect();
      };

      this.socket.onmessage = this.onMessage;
      
      this.socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        this._handleReconnect();
      };
      
      this.socket.onclose = (e) => {
        console.log(`WebSocket closed with code: ${e.code}`);
        this._handleClose(e);
      };
    } catch (error) {
      console.error("Error initializing WebSocket:", error);
      this._handleReconnect();
    }
  }

  async _handleClose({ code }) {
    this.onDisconnect({ code });
    if (![1000, 1001].includes(code)) {
      await this._handleReconnect();
    }
  }

  async _handleReconnect() {
    if (++this.reconnectAttempts > this.maxReconnectAttempts) {
      this.useHttpFallback = true;
      console.warn("Max WebSocket reconnection attempts reached. Using HTTP fallback.");
      return this.onError('Unable to establish WebSocket connection. Using HTTP fallback for communication.');
    }
    
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    console.log(`Attempting to reconnect WebSocket in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    setTimeout(() => this.connect(this.chatId), delay);
  }

  async _api(url, method = 'GET') {
    try {
      const res = await fetch(url, { method, credentials: 'include', cache: 'no-cache' });
      return res;
    } catch {
      return { ok: false };
    }
  }
}
