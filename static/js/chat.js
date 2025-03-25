/**
 * chat.js - Consolidated chat functionality under 800 lines
 */

// WebSocket Service - Real-time chat connection with fallback
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
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || console.error;
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
  }

  async connect(chatId) {
    if (!chatId || this.connecting) return Promise.reject(new Error('Invalid request'));
    this.connecting = true; this.chatId = chatId;
    try {
      // Quick auth check
      const authState = sessionStorage.getItem('auth_state');
      const userInfo = sessionStorage.getItem('userInfo');
      if (!authState || !userInfo) {
        this.connecting = false; this.useHttpFallback = true;
        return Promise.reject(new Error('Auth required'));
      }
      // Build URL
      const baseUrl = window.location.origin;
      const wsBase = baseUrl.replace(/^http/, 'ws');
      const params = new URLSearchParams();
      if (chatId) params.append('chatId', chatId);
      if (this.projectId) params.append('projectId', this.projectId);
      if (window.TokenManager?.accessToken) params.append('token', window.TokenManager.accessToken);
      this.wsUrl = `${wsBase}/ws?${params.toString()}`;
      
      return new Promise((resolve, reject) => {
        try {
          // Initialize the socket
          this.socket = new WebSocket(this.wsUrl);
          this.socket.onopen = () => {
            this.reconnectAttempts = 0; this.connecting = false;
            this.socket.send(JSON.stringify({
              type: 'auth', chatId: this.chatId, projectId: this.projectId || null
            }));
            this.onConnect(); resolve();
          };
          this.socket.onmessage = this.onMessage;
          this.socket.onerror = (error) => {
            if (this.connecting) { reject(error); this.connecting = false; }
            this._handleReconnect();
          };
          this.socket.onclose = (event) => {
            if (event.code !== 1000) this._handleReconnect();
            this.onDisconnect(event);
            if (this.connecting) { reject(new Error('Connection closed')); this.connecting = false; }
          };
        } catch (error) {
          this.connecting = false; this.reconnectAttempts++;
          reject(error);
        }
      });
    } catch (error) {
      this.connecting = false; this.useHttpFallback = true;
      return Promise.reject(error);
    }
  }

  async _handleReconnect() {
    if (this.reconnectAttempts++ >= this.maxRetries) {
      this.useHttpFallback = true; return;
    }
    await new Promise(resolve => setTimeout(resolve, this.reconnectInterval));
    try { await this.connect(this.chatId); } catch (e) { /* Silent fail */ }
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket not connected'));
    }
    try {
      this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  disconnect() {
    if (this.socket) { this.socket.close(); this.socket = null; }
    this.connecting = false; this.chatId = null;
  }
  
  isConnected() { return this.socket && this.socket.readyState === WebSocket.OPEN; }
  isUsingHttpFallback() { return this.useHttpFallback; }
}

// Message Service - Sends and receives chat messages
class MessageService {
  constructor(options = {}) {
    this.onMessageReceived = options.onMessageReceived || (() => {});
    this.onError = options.onError || console.error;
    this.onSending = options.onSending || (() => {});
    this.wsService = options.wsService || null;
    this.currentChatId = null;
    this.apiRequest = window.apiRequest || this._defaultApiRequest;
  }

  initialize(chatId, wsService) {
    this.currentChatId = chatId;
    if (wsService) {
      this.wsService = wsService;
      this.wsService.onMessage = this._handleWebSocketMessage.bind(this);
    }
  }

  async sendMessage(content) {
    if (!this.currentChatId) {
      this.onError('No conversation ID available');
      return false;
    }
    this.onSending(content);
    
    // Get model config from localStorage
    const config = {
      model: localStorage.getItem("modelName") || "claude-3-sonnet-20240229",
      maxTokens: parseInt(localStorage.getItem("maxTokens") || "500"),
      vision: localStorage.getItem("visionEnabled") === "true",
      detail: localStorage.getItem("visionDetail") || "auto",
      thinking: localStorage.getItem("extendedThinking") === "true",
      budget: parseInt(localStorage.getItem("thinkingBudget") || "16000")
    };

    const payload = {
      content, role: 'user',
      model_id: config.model,
      max_tokens: config.maxTokens,
      image_data: config.vision ? window.MODEL_CONFIG?.visionImage : null,
      vision_detail: config.detail,
      enable_thinking: config.thinking,
      thinking_budget: config.budget
    };

    // Try WebSocket first
    if (this.wsService && this.wsService.isConnected()) {
      try {
        await this.wsService.send(payload);
        return true;
      } catch (error) { /* Fall through to HTTP */ }
    }

    // HTTP fallback
    const projectId = localStorage.getItem("selectedProjectId");
    const endpoint = projectId 
      ? `/api/projects/${projectId}/conversations/${this.currentChatId}/messages` 
      : `/api/chat/conversations/${this.currentChatId}/messages`;

    try {
      const response = await this.apiRequest(endpoint, "POST", payload);
      let message = null;
      
      if (response.data?.assistant_message) {
        message = typeof response.data.assistant_message === 'string' 
          ? JSON.parse(response.data.assistant_message) 
          : response.data.assistant_message;
      }
      
      if (message) {
        const metadata = message.metadata || {};
        this.onMessageReceived({
          role: message.role,
          content: message.content,
          thinking: metadata.thinking,
          redacted_thinking: metadata.redacted_thinking,
          metadata: metadata
        });
        return true;
      }
      return false;
    } catch (error) {
      this.onError("Error sending message", error);
      return false;
    }
  }

  _handleWebSocketMessage(event) {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'error') {
        this.onError(data.message || 'WebSocket error');
        return;
      }
      
      if (data.role && data.content) {
        const metadata = {};
        if (data.used_knowledge_context) metadata.used_knowledge_context = true;
        
        this.onMessageReceived({
          role: data.role,
          content: data.content,
          thinking: data.thinking,
          redacted_thinking: data.redacted_thinking,
          metadata: metadata
        });
      }
    } catch (error) {
      this.onError('Failed to parse WebSocket message', error);
    }
  }

  async _defaultApiRequest(endpoint, method = "GET", data = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    };
    if (data) options.body = JSON.stringify(data);
    const response = await fetch(endpoint, options);
    if (!response.ok) throw new Error(`API error (${response.status})`);
    return response.json();
  }
}

// Conversation Service - Manages chat conversations
class ConversationService {
  constructor(options = {}) {
    this.onConversationLoaded = options.onConversationLoaded || (() => {});
    this.onError = options.onError || console.error;
    this.onLoadingStart = options.onLoadingStart || (() => {});
    this.onLoadingEnd = options.onLoadingEnd || (() => {});
    this.showNotification = options.showNotification || console.log;
    this.apiRequest = window.apiRequest || this._defaultApiRequest;
    this.currentConversation = null;
  }

  async loadConversation(chatId) {
    if (!chatId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId)) {
      this.onError('Invalid conversation ID');
      return false;
    }
    
    // Check auth
    if (!sessionStorage.getItem('auth_state') || !sessionStorage.getItem('userInfo')) {
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

  async createNewConversation() {
    try {
      const projectId = localStorage.getItem("selectedProjectId");
      const model = localStorage.getItem("modelName") || "claude-3-sonnet-20240229";
      const url = projectId 
        ? `/api/projects/${projectId}/conversations` 
        : `/api/chat/conversations`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ title: "New Chat", model_id: model }),
        credentials: 'include'
      });

      if (!response.ok) throw new Error(`API error (${response.status})`);
      
      const data = await response.json();
      const conversation = data.data?.id ? data.data : (data.id ? data : { id: null });
      
      if (!conversation.id) throw new Error("Invalid response format");
      
      this.currentConversation = conversation;
      return conversation;
    } catch (error) {
      this.showNotification(`Failed to create chat: ${error.message}`, "error");
      throw error;
    }
  }

  async _defaultApiRequest(endpoint, method = "GET", data = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (data) options.body = JSON.stringify(data);
    const response = await fetch(endpoint, options);
    if (!response.ok) {
      if (response.status === 404) throw new Error('Resource not found');
      throw new Error(`API error (${response.status})`);
    }
    return response.json();
  }
}

// UI Components for Chat Interface
class UIComponents {
  constructor(options = {}) {
    // Initialize all UI components
    this.messageList = {
      container: document.querySelector(options.containerSelector || '#conversationArea'),
      thinkingId: 'thinkingIndicator',
      formatText: window.formatText || this._defaultFormatter,
      
      clear: function() { 
        if (this.container) this.container.innerHTML = ''; 
      },
      
      setLoading: function(msg = 'Loading...') {
        if (this.container) this.container.innerHTML = `<div class="text-center text-gray-500">${msg}</div>`;
      },
      
      addThinking: function() {
        return this.appendMessage("assistant", "<em>Thinking...</em>", this.thinkingId);
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
            msg.role, msg.content, null, metadata.thinking, 
            metadata.redacted_thinking, metadata
          );
        });
      },
      
      appendMessage: function(role, content, id = null, thinking = null, redacted = null, metadata = null) {
        if (!this.container) return null;
        
        // Check for summary indicator
        if (content.includes('[Conversation summarized]') && window.showSummaryIndicator) {
          const el = document.createElement('div');
          el.innerHTML = window.showSummaryIndicator();
          this.container.appendChild(el);
        }
        
        // Create message element
        const msgDiv = document.createElement('div');
        msgDiv.className = `mb-2 p-2 rounded ${this._getClass(role)}`;
        if (id) msgDiv.id = id;
        msgDiv.innerHTML = this.formatText(content);
        
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
        
        // Add knowledge base indicator if applicable
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
        
        // Add thinking blocks for assistant messages
        if (role === 'assistant' && (thinking || redacted)) {
          const container = document.createElement('div');
          container.className = 'mt-3 border-t border-gray-200 pt-2';
          
          const toggle = document.createElement('button');
          toggle.className = 'text-gray-600 text-xs flex items-center mb-1';
          toggle.innerHTML = `
            <svg class="h-4 w-4 mr-1 thinking-chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            Show thinking process
          `;
          
          const content = document.createElement('div');
          content.className = 'bg-gray-50 p-2 rounded text-gray-800 text-sm hidden thinking-content';
          
          if (thinking) {
            content.innerHTML = window.formatText ? window.formatText(thinking) : thinking;
          } else if (redacted) {
            content.innerHTML = '<em>Claude\'s full reasoning is available but encrypted for safety.</em>';
          }
          
          toggle.onclick = () => {
            content.classList.toggle('hidden');
            const chevron = toggle.querySelector('.thinking-chevron');
            if (content.classList.contains('hidden')) {
              toggle.innerHTML = toggle.innerHTML.replace('Hide', 'Show');
              if (chevron) chevron.style.transform = '';
            } else {
              toggle.innerHTML = toggle.innerHTML.replace('Show', 'Hide');
              if (chevron) chevron.style.transform = 'rotate(180deg)';
            }
          };
          
          container.appendChild(toggle);
          container.appendChild(content);
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
          case "user": return "bg-blue-50 text-blue-900";
          case "assistant": return "bg-green-50 text-green-900";
          case "system": return "bg-gray-50 text-gray-600 text-sm";
          default: return "bg-white";
        }
      },
      
      _defaultFormatter: function(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                  .replace(/'/g, '&#39;').replace(/\n/g, '<br>');
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
            if (this.image) this.image.src = URL.createObjectURL(file);
            this.preview.classList.remove("hidden");
            
            const reader = new FileReader();
            reader.readAsDataURL(file);
            const base64 = await new Promise((resolve, reject) => {
              reader.onload = () => resolve(reader.result);
              reader.onerror = reject;
            });
            
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
          if (window.MODEL_CONFIG) window.MODEL_CONFIG.visionImage = null;
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

// Main Chat Interface
class ChatInterface {
  constructor(options = {}) {
    this.notificationFunction = options.showNotification || window.showNotification || console.log;
    this.container = document.querySelector(options.containerSelector || '#chatUI');
    this.titleEl = document.querySelector(options.titleSelector || '#chatTitle');
    
    this.wsService = null;
    this.messageService = null;
    this.conversationService = null;
    this.ui = null;
    
    this.currentChatId = null;
    this.currentImage = null;
  }

  initialize() {
    // Extract chat ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    this.currentChatId = window.CHAT_CONFIG?.chatId || urlParams.get('chatId');
    
    // Create services
    this.wsService = new WebSocketService({
      onConnect: () => console.log("WebSocket connected"),
      onError: this._handleError.bind(this)
    });
    
    this.messageService = new MessageService({
      onMessageReceived: this._handleMessageReceived.bind(this),
      onSending: () => this.ui.messageList.addThinking(),
      onError: this._handleError.bind(this)
    });
    
    this.conversationService = new ConversationService({
      onConversationLoaded: this._handleConversationLoaded.bind(this),
      onLoadingStart: () => this.ui.messageList.setLoading(),
      onError: this._handleError.bind(this),
      showNotification: this.notificationFunction
    });
    
    // Create UI components
    this.ui = new UIComponents({
      onSend: this._handleSendMessage.bind(this),
      onImageChange: (imageData) => this.currentImage = imageData,
      showNotification: this.notificationFunction
    }).init();
    
    // Set up auth listeners
    document.addEventListener('authStateChanged', (e) => {
      if (e.detail?.authenticated && this.currentChatId) {
        this.wsService.connect(this.currentChatId).then(() => {
          this.messageService.initialize(this.currentChatId, this.wsService);
        }).catch(() => {});
      } else if (!e.detail?.authenticated) {
        this.wsService.disconnect();
      }
    });
    
    // Initial load
    if (this.currentChatId) {
      this.loadConversation(this.currentChatId);
    } else if (sessionStorage.getItem('userInfo')) {
      setTimeout(() => this.createNewConversation().catch(() => {}), 100);
    } else {
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) loginMsg.classList.remove("hidden");
    }
  }

  loadConversation(chatId) {
    if (!chatId) return Promise.reject(new Error('No conversation ID'));
    
    this.currentChatId = chatId;
    return this.conversationService.loadConversation(chatId)
      .then(success => {
        if (success) {
          this.wsService.connect(chatId)
            .then(() => {
              this.messageService.initialize(chatId, this.wsService);
            })
            .catch(() => {
              this.messageService.initialize(chatId, null);
            });
        }
        return success;
      });
  }

  async createNewConversation() {
    try {
      const conversation = await this.conversationService.createNewConversation();
      this.currentChatId = conversation.id;
      
      if (this.titleEl) this.titleEl.textContent = conversation.title || "New Chat";
      
      this.wsService.connect(conversation.id);
      this.messageService.initialize(conversation.id, this.wsService);
      
      // Update URL
      window.history.pushState({}, "", `/?chatId=${conversation.id}`);
      window.CHAT_CONFIG = window.CHAT_CONFIG || {};
      window.CHAT_CONFIG.chatId = conversation.id;
      
      // Show UI
      const chatUI = document.getElementById("chatUI");
      const noChatMsg = document.getElementById("noChatSelectedMessage");
      if (chatUI) chatUI.classList.remove("hidden");
      if (noChatMsg) noChatMsg.classList.add("hidden");
      
      // Clear message area
      this.ui.messageList.clear();
      
      // Refresh conversation list
      if (typeof window.loadConversationList === 'function') {
        setTimeout(() => window.loadConversationList(), 500);
      }
      
      return conversation;
    } catch (error) {
      this._handleError("Failed to create conversation", error);
      throw error;
    }
  }

  _handleConversationLoaded(conversation) {
    if (this.titleEl) this.titleEl.textContent = conversation.title || "New Chat";
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
        this._handleError("Failed to create conversation", err);
        return;
      }
    }
    
    // Add user message to UI
    this.ui.messageList.appendMessage("user", userMsg || "Analyze this image");
    
    // Send message
    await this.messageService.sendMessage(userMsg || "Analyze this image");
    
    // Add image indicator if needed
    if (this.currentImage) {
      this.ui.messageList.addImageIndicator(this.currentImage);
      this.currentImage = null;
    }
  }

  _handleError(message, error) {
    console.error(message, error);
    this.notificationFunction(message, 'error');
  }
}

// Add Markdown styles
function _addMarkdownStyles() {
  if (document.getElementById('markdown-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'markdown-styles';
  style.textContent = `
    .markdown-table{width:100%;border-collapse:collapse;margin:1em 0}.markdown-table th,.markdown-table td{padding:.5em;border:1px solid #ddd}.markdown-code{background:#f5f5f5;padding:.2em .4em;border-radius:3px}.markdown-pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow-x:auto}.markdown-quote{border-left:3px solid #ddd;padding:0 1em;color:#666}.code-block-wrapper{position:relative}.copy-code-btn{position:absolute;right:.5em;top:.5em;padding:.25em .5em;background:#fff;border:1px solid #ddd;border-radius:3px;cursor:pointer;font-size:.8em}.copy-code-btn:hover{background:#f5f5f5}
  `;
  document.head.appendChild(style);
}

// Global variables and functions
let chatInterface = null;

function initializeChat() {
  _addMarkdownStyles();
  chatInterface = new ChatInterface();
  chatInterface.initialize();
}

function loadConversation(chatId) {
  if (!chatInterface) initializeChat();
  return chatInterface.loadConversation(chatId);
}

async function createNewChat() {
  if (!chatInterface) initializeChat();
  return chatInterface.createNewConversation();
}

function sendMessage(chatId, userMsg) {
  if (!chatInterface) initializeChat();
  chatInterface.currentChatId = chatId;
  return chatInterface._handleSendMessage(userMsg);
}

async function setupWebSocket(chatId) {
  if (!chatInterface) initializeChat();
  if (!chatId && chatInterface.currentChatId) chatId = chatInterface.currentChatId;
  
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
    if (!sessionStorage.getItem('auth_state') || !sessionStorage.getItem('userInfo')) {
      return { success: false, authenticated: false, message: "Authentication required" };
    }
    
    try {
      const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/ws?chatId=test`;
      return { success: true, authenticated: true, wsUrl, message: "WebSocket prerequisites passed" };
    } catch (error) {
      return { success: false, error: error.message, message: "WebSocket test failed" };
    }
  }
  
  return { success: false, message: "Chat interface not initialized" };
}

// Export functions
window.loadConversation = loadConversation;
window.createNewChat = createNewChat;
window.sendMessage = sendMessage;
window.setupWebSocket = setupWebSocket;
window.testWebSocketConnection = testWebSocketConnection;
window.initializeChat = initializeChat;