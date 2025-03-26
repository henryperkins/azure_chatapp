/**
 * chat.js - Consolidated chat functionality with improvements
 */

// --------------------------
// Utility Functions
// --------------------------

/**
 * Centralized authentication check.
 * Uses window.auth.verify() if available, otherwise falls back to session checks.
 */
async function isAuthenticated() {
  if (window.auth?.verify) {
    return await window.auth.verify(); 
  }
  return !!(
    sessionStorage.getItem('auth_state') &&
    sessionStorage.getItem('userInfo')
  );
}

/**
 * Standardized error handling.
 * Logs the error and optionally displays a notification.
 */
function handleError(context, error, notificationFn = window.showNotification) {
  const msg = `[${context}] ${error?.message || error}`;
  console.error(msg);
  if (notificationFn) {
    notificationFn(msg, 'error');
  }
}

// --------------------------
// WebSocket Service
// --------------------------
class WebSocketService {
  constructor(options = {}) {
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
  }

  async connect(chatId) {
    if (!chatId || this.connecting) {
      return Promise.reject(new Error('Invalid request or already connecting'));
    }
    this.connecting = true;
    this.chatId = chatId;

    try {
      // Centralized auth check
      const authState = await isAuthenticated();
      if (!authState) {
        this.connecting = false;
        this.useHttpFallback = true;
        return Promise.reject(new Error('Auth required'));
      }

      // Build URL
      const baseUrl = window.location.origin;
      const wsBase = baseUrl.replace(/^http/, 'ws');
      const params = new URLSearchParams();
      if (chatId) params.append('chatId', chatId);
      if (this.projectId) params.append('projectId', this.projectId);
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
  }

  /**
   * Attempts to reconnect with exponential backoff.
   */
  async _handleReconnect() {
    if (this.reconnectAttempts++ >= this.maxRetries) {
      this.useHttpFallback = true;
      this.onError(new Error('Max reconnect attempts reached'));
      return;
    }

    // Auth check again
    const authState = await isAuthenticated();
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

    try {
      await this.connect(this.chatId);
    } catch (e) {
      // Will retry if attempts remain
      console.warn(`WebSocket reconnect attempt ${this.reconnectAttempts} failed: ${e.message}`);
    }
  }

  isConnected() {
    return this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Sends a message over the socket with a unique messageId, ensuring
   * only the matching listener resolves.
   */
  send(payload) {
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

      // Send the payload
      this.socket.send(JSON.stringify(payload));
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}

// --------------------------
// Message Service
// --------------------------
class MessageService {
  constructor(options = {}) {
    this.onMessageReceived = options.onMessageReceived || (() => {});
    this.onSending = options.onSending || (() => {});
    this.onError = options.onError || console.error;
    this.chatId = null;
    this.wsService = null;
  }

  initialize(chatId, wsService) {
    this.chatId = chatId;
    this.wsService = wsService;
    if (wsService) {
      // Assign a default WebSocket 'onmessage' -> funnel to our handler
      // But note that 'send()' uses an internal event listener for request correlation
      wsService.onMessage = this._handleWsMessage.bind(this);
    }
  }

  async sendMessage(content) {
    try {
      this.onSending();

      if (this.wsService && this.wsService.isConnected()) {
        const wsResponse = await this.wsService.send({
          type: 'message',
          chatId: this.chatId,
          content: content,
          model_id: localStorage.getItem("modelName") || "claude-3-7-sonnet-20250219"
        });
        this.onMessageReceived({
          role: 'assistant',
          content: wsResponse.content || wsResponse.message || '',
          thinking: wsResponse.thinking,
          redacted_thinking: wsResponse.redacted_thinking,
          metadata: wsResponse.metadata || {}
        });
      } else {
        // HTTP fallback
        const projectId = localStorage.getItem("selectedProjectId");
        const url = projectId
          ? `/api/projects/${projectId}/conversations/${this.chatId}/messages`
          : `/api/chat/conversations/${this.chatId}/messages`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: content,
            model_id: localStorage.getItem("modelName") || "claude-3-sonnet-20240229"
          }),
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`API error (${response.status})`);
        }
        const data = await response.json();
        const responseData = data.data || data;
        this.onMessageReceived({
          role: 'assistant',
          content: responseData.content || responseData.message || '',
          thinking: responseData.thinking,
          redacted_thinking: responseData.redacted_thinking,
          metadata: responseData.metadata || {}
        });
      }
    } catch (error) {
      this.onError('Failed to send message', error);
    }
  }

  _handleWsMessage(event) {
    try {
      const data = JSON.parse(event.data);
      // If it's a plain message broadcast from the server
      if (data.type === 'message') {
        this.onMessageReceived({
          role: 'assistant',
          content: data.content || data.message || '',
          thinking: data.thinking,
          redacted_thinking: data.redacted_thinking,
          metadata: data.metadata || {}
        });
      }
    } catch (error) {
      this.onError('Failed to process WebSocket message', error);
    }
  }
}

// --------------------------
// Conversation Service
// --------------------------
class ConversationService {
  constructor(options = {}) {
    this.onConversationLoaded = options.onConversationLoaded || (() => {});
    this.onError = options.onError || console.error;
    this.onLoadingStart = options.onLoadingStart || (() => {});
    this.onLoadingEnd = options.onLoadingEnd || (() => {});
    this.showNotification = options.showNotification || window.showNotification || console.log;
    this.apiRequest = window.apiRequest || this._defaultApiRequest;
    this.currentConversation = null;
  }

  async loadConversation(chatId) {
    if (
      !chatId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId)
    ) {
      this.onError('Invalid conversation ID');
      return false;
    }

    // Check auth
    const authState = await isAuthenticated();
    if (!authState) {
      this.showNotification("Please log in to access conversations", "error");
      return false;
    }

    this.onLoadingStart();

    try {
      const projectId = localStorage.getItem("selectedProjectId");
      const convUrl = projectId
        ? `/api/projects/${projectId}/conversations/${chatId}`
        : `/api/chat/conversations/${chatId}`;
      const msgUrl = projectId
        ? `/api/projects/${projectId}/conversations/${chatId}/messages`
        : `/api/chat/conversations/${chatId}/messages`;

      const conversation = await this.apiRequest(convUrl);
      const messages = await this.apiRequest(msgUrl);

      this.currentConversation = {
        id: chatId,
        ...(conversation.data || conversation),
        messages: messages.data?.messages || []
      };

      this.onConversationLoaded(this.currentConversation);
      this.onLoadingEnd();
      return true;
    } catch (error) {
      this.onLoadingEnd();
      if (error.message === 'Resource not found') {
        this.showNotification("Conversation not found or inaccessible.", "error");
      } else if (error.message.includes('401')) {
        this.showNotification("Please log in to access this conversation", "error");
        window.TokenManager?.clearTokens?.();
      }
      return false;
    }
  }

  /**
   * Create a new conversation, with built-in retries.
   */
  async createNewConversation(maxRetries = 2) {
    const projectId = localStorage.getItem("selectedProjectId");
    const model = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const url = projectId
          ? `/api/projects/${projectId}/conversations`
          : `/api/chat/conversations`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `New Chat ${new Date().toLocaleDateString()}`,
            model_id: model
          }),
          credentials: 'include'
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || `API error (${response.status})`);
        }

        const data = await response.json();
        const conversation = data.data?.id
          ? data.data
          : (data.id ? data : { id: null });

        if (!conversation.id) {
          throw new Error("Invalid response format");
        }

        this.currentConversation = conversation;
        return conversation;
      } catch (error) {
        console.error(`Conversation creation attempt ${attempt + 1} failed:`, error);
        if (attempt === maxRetries) {
          this.showNotification("Failed to create conversation", "error");
          throw error;
        }
        // Exponential-ish backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  async _defaultApiRequest(endpoint, method = "GET", data = null) {
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      };
      if (data) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(endpoint, options);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));

        // Attempt token refresh if 401
        if (response.status === 401 && window.TokenManager?.refreshTokens) {
          try {
            await window.TokenManager.refreshTokens();
            // Retry with same params
            return this._defaultApiRequest(endpoint, method, data);
          } catch (refreshError) {
            console.error('Token refresh failed:', refreshError);
            document.dispatchEvent(new CustomEvent('authStateChanged', {
              detail: { authenticated: false }
            }));
            throw new Error('Authentication failed. Please log in again.');
          }
        }
        throw new Error(errorBody.message || `API error (${response.status})`);
      }
      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }
}

// --------------------------
// UI Components
// --------------------------
class UIComponents {
  constructor(options = {}) {
    // Allow message container selector to be passed in
    const messageContainerSelector = options.messageContainerSelector || '#conversationArea';
    this.messageList = {
      container: document.querySelector(messageContainerSelector),
      thinkingId: 'thinkingIndicator',
      formatText: window.formatText || this._defaultFormatter,

      clear: function() {
        if (this.container) this.container.innerHTML = '';
      },

      setLoading: function(msg = 'Loading...') {
        if (this.container) {
          this.container.innerHTML = `<div class="text-center text-gray-500">${msg}</div>`;
        }
      },

      addThinking: function() {
        const thinkingDiv = document.createElement('div');
        thinkingDiv.id = this.thinkingId;
        thinkingDiv.className = 'mb-2 p-2 rounded bg-gray-50 text-gray-600 flex items-center';
        thinkingDiv.innerHTML = `
          <div class="animate-pulse flex space-x-2">
            <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
            <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
            <div class="w-2 h-2 bg-gray-400 rounded-full"></div>
          </div>
          <span class="ml-2">Claude is thinking...</span>
        `;
        if (this.container) {
          this.container.appendChild(thinkingDiv);
          this.container.scrollTop = this.container.scrollHeight;
        }
        return thinkingDiv;
      },

      removeThinking: function() {
        document.getElementById(this.thinkingId)?.remove();
      },

      renderMessages: function(messages) {
        this.clear();
        if (!messages || messages.length === 0) {
          this.appendMessage("system", "No messages yet");
          return;
        }
        messages.forEach(msg => {
          const metadata = msg.metadata || {};
          this.appendMessage(
            msg.role,
            msg.content,
            null,
            metadata.thinking,
            metadata.redacted_thinking,
            metadata
          );
        });
      },

      appendMessage: function(role, content, id = null, thinking = null, redacted = null, metadata = null) {
        if (!this.container) return null;

        // Create message container
        const msgDiv = document.createElement('div');
        msgDiv.className = `mb-4 p-4 rounded-lg shadow-sm ${this._getClass(role)}`;
        if (id) msgDiv.id = id;

        // Add header with role indicator
        const header = document.createElement('div');
        header.className = 'flex items-center mb-2';
        header.innerHTML = `
          <span class="font-medium ${role === 'assistant' ? 'text-green-700' : 'text-blue-700'}">
            ${role === 'assistant' ? 'Claude' : 'You'}
          </span>
          <span class="ml-2 text-xs text-gray-500">
            ${new Date().toLocaleTimeString()}
          </span>
        `;
        msgDiv.appendChild(header);

        // Add main content
        const contentDiv = document.createElement('div');
        contentDiv.className = 'prose max-w-none';
        contentDiv.innerHTML = this.formatText(content);
        msgDiv.appendChild(contentDiv);

        // Add copy buttons to code blocks
        msgDiv.querySelectorAll('pre code').forEach(block => {
          const btn = document.createElement('button');
          btn.className = 'copy-code-btn';
          btn.textContent = 'Copy';
          btn.onclick = () => {
            navigator.clipboard.writeText(block.textContent)
              .then(() => {
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy', 2000);
              });
          };

          const wrapper = document.createElement('div');
          wrapper.className = 'code-block-wrapper';
          wrapper.appendChild(block.cloneNode(true));
          wrapper.appendChild(btn);
          block.replaceWith(wrapper);
        });

        // Add knowledge base indicator if metadata indicates usage
        if (role === 'assistant' && metadata?.used_knowledge_context) {
          const kb = document.createElement('div');
          kb.className = 'mt-2 bg-blue-50 text-blue-800 rounded p-2 text-xs flex items-center';
          kb.innerHTML = `
            <svg class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Response includes information from project files</span>
          `;
          msgDiv.appendChild(kb);
        }

        // Enhanced thinking block display for Claude models
        if (role === 'assistant' && (thinking || redacted)) {
          const container = document.createElement('div');
          container.className = 'mt-3 border-t border-gray-200 pt-2';

          const toggle = document.createElement('button');
          toggle.className = 'text-gray-600 text-xs flex items-center mb-1 hover:text-gray-800';
          toggle.innerHTML = `
            <svg class="h-4 w-4 mr-1 thinking-chevron transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            ${thinking ? 'Show detailed reasoning' : 'Show safety notice'}
          `;
            
          // Add tooltip explaining thinking blocks
          toggle.title = thinking 
            ? "Claude's step-by-step reasoning process"
            : "Some reasoning was redacted for safety";

          const contentDiv = document.createElement('div');
          contentDiv.className = 'bg-gray-50 p-2 rounded text-gray-800 text-sm hidden thinking-content';

          if (thinking) {
            // Format thinking blocks with proper line breaks
            const formattedThinking = thinking.replace(/\n/g, '<br>');
            contentDiv.innerHTML = window.formatText ? 
                window.formatText(formattedThinking) : 
                formattedThinking;
          } else if (redacted) {
            contentDiv.innerHTML = `
                <div class="flex items-center text-yellow-700">
                    <svg class="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
                    </svg>
                    Claude's full reasoning is encrypted for safety but will be used internally
                </div>
            `;
          }

          toggle.onclick = () => {
            contentDiv.classList.toggle('hidden');
            const chevron = toggle.querySelector('.thinking-chevron');
            if (contentDiv.classList.contains('hidden')) {
              toggle.innerHTML = toggle.innerHTML.replace('Hide', 'Show');
              if (chevron) chevron.style.transform = '';
            } else {
              toggle.innerHTML = toggle.innerHTML.replace('Show', 'Hide');
              if (chevron) chevron.style.transform = 'rotate(180deg)';
            }
          };

          container.appendChild(toggle);
          container.appendChild(contentDiv);
          msgDiv.appendChild(container);
        }

        this.container.appendChild(msgDiv);
        this.container.scrollTop = this.container.scrollHeight;
        return msgDiv;
      },

      addImageIndicator: function(imageUrl) {
        if (!this.container) return;
        const msgDivs = this.container.querySelectorAll("div.bg-blue-50");
        const lastUserDiv = msgDivs?.[msgDivs.length - 1];
        if (lastUserDiv) {
          const container = document.createElement("div");
          container.className = "flex items-center bg-gray-50 rounded p-1 mt-2";

          const img = document.createElement("img");
          img.className = "h-10 w-10 object-cover rounded mr-2";
          img.src = document.getElementById('chatPreviewImg')?.src || imageUrl;
          img.alt = "Attached Image";

          const label = document.createElement("div");
          label.className = "text-xs text-gray-500";
          label.textContent = "📷 Image attached";

          container.appendChild(img);
          container.appendChild(label);
          lastUserDiv.appendChild(container);
        }
      },

      _getClass: function(role) {
        switch (role) {
          case "user":
            return "bg-blue-50 text-blue-900";
          case "assistant":
            return "bg-green-50 text-green-900";
          case "system":
            return "bg-gray-50 text-gray-600 text-sm";
          default:
            return "bg-white";
        }
      },

      _defaultFormatter: function(text) {
        return text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
          .replace(/\n/g, '<br>');
      }
    };

    // Input component
    this.input = {
      element: document.querySelector(options.inputSelector || '#chatInput'),
      button: document.querySelector(options.sendButtonSelector || '#sendBtn'),
      onSend: options.onSend || (() => {}),

      getValue: function() {
        return this.element ? this.element.value.trim() : '';
      },

      clear: function() {
        if (this.element) this.element.value = '';
      },

      focus: function() {
        if (this.element) this.element.focus();
      },

      init: function() {
        if (this.element) {
          this.element.addEventListener("keyup", (e) => {
            if (e.key === "Enter") this._send();
          });
        }
        if (this.button) {
          this.button.addEventListener("click", () => this._send());
        }
      },

      _send: function() {
        const msg = this.getValue();
        if (msg) {
          this.onSend(msg);
          this.clear();
        }
      }
    };

    // Image upload component
    this.imageUpload = {
      button: document.querySelector(options.attachButtonSelector || '#chatAttachImageBtn'),
      input: document.querySelector(options.imageInputSelector || '#chatImageInput'),
      preview: document.querySelector(options.previewSelector || '#chatImagePreview'),
      image: document.querySelector(options.previewImageSelector || '#chatPreviewImg'),
      remove: document.querySelector(options.removeButtonSelector || '#chatRemoveImageBtn'),
      onChange: options.onImageChange || (() => {}),
      showNotification: options.showNotification || window.showNotification || console.log,

      init: function() {
        if (!this.button || !this.input || !this.preview || !this.remove) return;

        this.button.addEventListener("click", () => {
          const model = localStorage.getItem("modelName");
          if (model !== "o1") {
            this.showNotification("Vision only works with the o1 model", "warning");
            return;
          }
          this.input.click();
        });

        this.input.addEventListener("change", async (e) => {
          const file = e.target.files[0];
          if (!file) return;

          if (!['image/jpeg', 'image/png'].includes(file.type)) {
            this.showNotification("Only JPEG/PNG supported", "error");
            this.input.value = '';
            return;
          }

          if (file.size > 5 * 1024 * 1024) {
            this.showNotification("Image must be under 5MB", "error");
            this.input.value = '';
            return;
          }

          try {
            if (this.image) {
              this.image.src = URL.createObjectURL(file);
            }
            this.preview.classList.remove("hidden");

            const reader = new FileReader();
            reader.readAsDataURL(file);
            const base64 = await new Promise((resolve, reject) => {
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
            });

            // Store in a global config for the vision model
            window.MODEL_CONFIG = window.MODEL_CONFIG || {};
            window.MODEL_CONFIG.visionImage = base64;
            window.MODEL_CONFIG.visionDetail = "auto";

            this.onChange(base64);
          } catch (err) {
            console.error("Image processing error:", err);
            this.showNotification("Failed to process image", "error");
            this.preview.classList.add("hidden");
          }
        });

        this.remove.addEventListener("click", () => {
          this.input.value = '';
          this.preview.classList.add("hidden");
          if (window.MODEL_CONFIG) {
            window.MODEL_CONFIG.visionImage = null;
          }
          this.onChange(null);
        });
      },

      clear: function() {
        if (this.input) this.input.value = '';
        if (this.preview) this.preview.classList.add("hidden");
      }
    };
  }

  init() {
    this.input.init();
    this.imageUpload.init();
    return this;
  }
}

// Main Chat Interface class
class ChatInterface {
  constructor(options = {}) {
    this.notificationFunction = options.showNotification || window.showNotification || console.log;
    this.container = document.querySelector(options.containerSelector || '#chatUI');
    this.titleEl = document.querySelector(options.titleSelector || '#chatTitle');
    // Store the selector for potential changes later
    this.messageContainerSelector = options.messageContainerSelector || '#conversationArea';

    this.wsService = null;
    this.messageService = null;
    this.conversationService = null;
    this.ui = null;

    this.currentChatId = null;
    this.currentImage = null;
  }

  initialize() {
    // Determine page context and set selectors
    const isProjectsPage = window.location.pathname.includes('/projects');
    
    // Update selectors based on page context
    if (isProjectsPage) {
      this.containerSelector = '#projectChatUI';
      this.messageContainerSelector = '#projectChatMessages';
      this.inputSelector = '#projectChatInput';
      this.sendButtonSelector = '#projectChatSendBtn';
    } else {
      // Default selectors for index.html/main chat
      this.containerSelector = '#chatUI';
      this.messageContainerSelector = '#conversationArea';
      this.inputSelector = '#chatInput';
      this.sendButtonSelector = '#sendBtn';
    }

    // Extract chat ID from URL or config
    const urlParams = new URLSearchParams(window.location.search);
    this.currentChatId = window.CHAT_CONFIG?.chatId || urlParams.get('chatId');

    // Create services
    this.wsService = new WebSocketService({
      onConnect: () => console.log("WebSocket connected"),
      onError: (err) => handleError('WebSocketService', err, this.notificationFunction)
    });

    this.messageService = new MessageService({
      onMessageReceived: this._handleMessageReceived.bind(this),
      onSending: () => this.ui.messageList.addThinking(),
      onError: (msg, err) => handleError(msg, err, this.notificationFunction)
    });

    this.conversationService = new ConversationService({
      onConversationLoaded: this._handleConversationLoaded.bind(this),
      onLoadingStart: () => this.ui.messageList.setLoading(),
      onLoadingEnd: () => {},
      onError: (msg, err) => handleError(msg, err, this.notificationFunction),
      showNotification: this.notificationFunction
    });

    // Create UI components, passing the message container selector
    this.ui = new UIComponents({
      messageContainerSelector: this.messageContainerSelector, // Pass the selector
      onSend: this._handleSendMessage.bind(this),
      onImageChange: (imageData) => this.currentImage = imageData,
      showNotification: this.notificationFunction
    }).init();

    // Set up auth listeners
    document.addEventListener('authStateChanged', (e) => {
      if (e.detail?.authenticated && this.currentChatId) {
        this.wsService.connect(this.currentChatId)
          .then(() => {
            this.messageService.initialize(this.currentChatId, this.wsService);
          })
          .catch(() => {});
      } else if (!e.detail?.authenticated) {
        this.wsService.disconnect();
      }
    });

    // Initial load
    if (this.currentChatId) {
      this.loadConversation(this.currentChatId);
    } else if (sessionStorage.getItem('userInfo')) {
      // Create new conversation automatically if user is logged in but no chatId present
      setTimeout(() => {
        this.createNewConversation().catch(() => {});
      }, 100);
    } else {
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) loginMsg.classList.remove("hidden");
    }
  }

  loadConversation(chatId) {
    if (!chatId) {
      return Promise.reject(new Error('No conversation ID'));
    }
    this.currentChatId = chatId;

    return this.conversationService.loadConversation(chatId)
      .then(success => {
        if (success) {
          // Attempt to connect the websocket
          this.wsService.connect(chatId)
            .then(() => {
              this.messageService.initialize(chatId, this.wsService);
            })
            .catch(() => {
              // Fall back to HTTP if WebSocket fails
              this.messageService.initialize(chatId, null);
            });
        }
        return success;
      });
  }

  /**
   * Unified conversation creation uses ConversationService.
   */
  async createNewConversation() {
    // Simply delegate to ConversationService
    try {
      const conversation = await this.conversationService.createNewConversation();
      this.currentChatId = conversation.id;
      return conversation;
    } catch (error) {
      // handle the error or show notification
      handleError('ChatInterface#createNewConversation', error, this.notificationFunction);
      throw error;
    }
  }
  
  // Allows changing the target container for message rendering after initialization.
  setTargetContainer(selector) {
    if (!this.ui || !this.ui.messageList) {
      console.error("UI components not initialized yet.");
      return;
    }
    const newContainer = document.querySelector(selector);
    if (newContainer) {
      this.ui.messageList.container = newContainer;
      console.log(`Chat message container set to: ${selector}`);
      // Optionally re-render if needed, or clear the new container
      // this.ui.messageList.clear();
    } else {
      console.error(`Failed to find container with selector: ${selector}`);
    }
  }

  _handleConversationLoaded(conversation) {
    if (this.titleEl) {
      this.titleEl.textContent = conversation.title || "New Chat";
    }
    this.ui.messageList.renderMessages(conversation.messages);
  }

  _handleMessageReceived(message) {
    this.ui.messageList.removeThinking();
    this.ui.messageList.appendMessage(
      message.role,
      message.content,
      null,
      message.thinking,
      message.redacted_thinking,
      message.metadata
    );
  }

  async _handleSendMessage(userMsg) {
    if (!userMsg && !this.currentImage) {
      this.notificationFunction("Cannot send empty message", "error");
      return;
    }

    // Ensure we have a chat
    if (!this.currentChatId) {
      try {
        const conversation = await this.createNewConversation();
        this.currentChatId = conversation.id;
      } catch (err) {
        handleError('Creating conversation failed', err, this.notificationFunction);
        return;
      }
    }

    // Append user's message to UI
    this.ui.messageList.appendMessage("user", userMsg || "Analyze this image");

    // Send message
    await this.messageService.sendMessage(userMsg || "Analyze this image");

    // If there's an image, show indicator
    if (this.currentImage) {
      this.ui.messageList.addImageIndicator(this.currentImage);
      this.currentImage = null;
    }
  }
}

// --------------------------
// Global-level Helpers
// --------------------------

/**
 * Adds basic markdown-like styling. 
 * (Note: For robust Markdown, consider using a real library.)
 */
function _addMarkdownStyles() {
  if (document.getElementById('markdown-styles')) return;
  const style = document.createElement('style');
  style.id = 'markdown-styles';
  style.textContent = `
    .markdown-table{width:100%;border-collapse:collapse;margin:1em 0}
    .markdown-table th,.markdown-table td{padding:.5em;border:1px solid #ddd}
    .markdown-code{background:#f5f5f5;padding:.2em .4em;border-radius:3px}
    .markdown-pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow-x:auto}
    .markdown-quote{border-left:3px solid #ddd;padding:0 1em;color:#666}
    .code-block-wrapper{position:relative}
    .copy-code-btn{position:absolute;right:.5em;top:.5em;padding:.25em .5em;background:#fff;border:1px solid #ddd;
      border-radius:3px;cursor:pointer;font-size:.8em}
    .copy-code-btn:hover{background:#f5f5f5}
  `;
  document.head.appendChild(style);
}

// --------------------------
// Exported Functions
// --------------------------

let chatInterface = null;

function initializeChat() {
  _addMarkdownStyles();
  chatInterface = new ChatInterface();
  chatInterface.initialize();
  window.projectChatInterface = chatInterface; // Expose the instance globally

  // Listen for model configuration changes
  document.addEventListener('modelConfigChanged', (e) => {
    if (chatInterface && chatInterface.messageService) {
      const modelName = e.detail?.modelName || localStorage.getItem('modelName');
      if (modelName) {
        window.MODEL_CONFIG = window.MODEL_CONFIG || {};
        window.MODEL_CONFIG.modelName = modelName;
        window.MODEL_CONFIG.maxTokens = Number(e.detail?.maxTokens) || 200000;
        window.MODEL_CONFIG.thinkingBudget = Number(e.detail?.thinkingBudget) || 10000;
      }
    }
  });
}

function loadConversation(chatId) {
  if (!chatInterface) initializeChat();
  return chatInterface.loadConversation(chatId);
}

async function createNewChat() {
  if (!chatInterface) initializeChat();
  return chatInterface.createNewConversation();
}

async function sendMessage(chatId, userMsg) {
  if (!chatInterface) initializeChat();
  chatInterface.currentChatId = chatId;
  return chatInterface._handleSendMessage(userMsg);
}

async function setupWebSocket(chatId) {
  if (!chatInterface) initializeChat();
  if (!chatId && chatInterface.currentChatId) {
    chatId = chatInterface.currentChatId;
  }
  if (chatId && chatInterface.wsService) {
    try {
      const connected = await chatInterface.wsService.connect(chatId);
      if (connected) {
        chatInterface.messageService.initialize(chatId, chatInterface.wsService);
        return true;
      }
    } catch (error) {}
  }
  return false;
}

async function testWebSocketConnection() {
  if (!chatInterface) initializeChat();

  if (chatInterface.wsService) {
    const authState = await isAuthenticated();
    if (!authState) {
      return { success: false, authenticated: false, message: "Authentication required" };
    }
    try {
      const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/ws?chatId=test`;
      return { success: true, authenticated: true, wsUrl, message: "WebSocket prerequisites passed" };
    } catch (error) {
      return { success: false, error: error.message, message: "WebSocket test failed" };
    }
  }
  
  // Export ChatInterface globally
  if (typeof window !== 'undefined') {
    window.ChatInterface = window.ChatInterface || ChatInterface;
  }
  
  // Expose ChatInterface globally
  if (typeof window !== 'undefined') {
    window.ChatInterface = window.ChatInterface || ChatInterface;
  }
}

// Attach to window
window.loadConversation = loadConversation;
window.createNewChat = createNewChat;
window.sendMessage = sendMessage;
window.setupWebSocket = setupWebSocket;
window.testWebSocketConnection = testWebSocketConnection;
window.initializeChat = initializeChat;

// Auto-initialize chat if #chatUI is present in DOM
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('chatUI')) {
    initializeChat();
  }
});
// Ensure ChatInterface is directly available globally
window.ChatInterface = ChatInterface;