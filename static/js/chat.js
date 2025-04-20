/**
 * chat.js
 * A consolidated chat module that handles conversation management, messaging,
 * and UI rendering for the chat system. All conversations are project-based.
 */

// Configuration
const CHAT_CONFIG = {
  DEFAULT_MODEL: "claude-3-sonnet-20240229",
  MAX_TOKENS: 4096,
  THINKING_BUDGET: 16000,
  REASONING_EFFORT: "medium"
};

/**
 * ChatManager - Main class for chat system
 */
class ChatManager {
  constructor() {
    // State
    this.currentConversationId = null;
    this.projectId = null;
    this.isInitialized = false;
    this.isLoading = false;
    this.currentImage = null;

    // UI elements
    this.container = null;
    this.messageContainer = null;
    this.inputField = null;
    this.sendButton = null;
    this.titleElement = null;

    // Event callbacks
    this._eventHandlers = {};

    // Model configuration
    this.modelConfig = {
      modelName: localStorage.getItem("modelName") || CHAT_CONFIG.DEFAULT_MODEL,
      maxTokens: parseInt(localStorage.getItem("maxTokens") || CHAT_CONFIG.MAX_TOKENS, 10),
      extendedThinking: localStorage.getItem("extendedThinking") === "true",
      thinkingBudget: parseInt(localStorage.getItem("thinkingBudget") || CHAT_CONFIG.THINKING_BUDGET, 10),
      reasoningEffort: localStorage.getItem("reasoningEffort") || CHAT_CONFIG.REASONING_EFFORT,
      visionEnabled: localStorage.getItem("visionEnabled") === "true",
      visionDetail: localStorage.getItem("visionDetail") || "auto"
    };
  }

  /**
   * Initialize the chat system
   * @param {Object} options - Configuration options
   * @returns {Promise<boolean>} - Success status
   */
  async initialize(options = {}) {
    if (this.isInitialized) {
      console.warn("Chat system already initialized");
      return true;
    }

    console.log("Initializing chat system...");

    try {
      // Wait for auth to be ready
      await this._ensureAuthReady();

      // Setup UI elements
      this._setupUIElements(options);

      // Bind events
      this._bindEvents();

      // Check URL for conversation ID
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chatId');

      // Get project ID from URL or localStorage
      this.projectId = this._getProjectId();

      if (!this.projectId) {
        console.warn("No project selected, chat system requires a project");
        this._showMessage("system", "Please select a project to start a conversation");
        return false;
      }

      // Load conversation if ID present, otherwise create new
      if (chatId) {
        await this.loadConversation(chatId);
      } else {
        await this.createNewConversation();
      }

      this.isInitialized = true;
      console.log("Chat system initialized");

      // Dispatch event
      document.dispatchEvent(new CustomEvent('chatInitialized', {
        detail: { instance: this }
      }));

      return true;
    } catch (error) {
      console.error("Chat initialization failed:", error);
      this._handleError("initialization", error);
      return false;
    }
  }

  /**
   * Load a conversation by ID
   * @param {string} conversationId - Conversation ID to load
   * @returns {Promise<boolean>} - Success status
   */
  async loadConversation(conversationId) {
    if (!conversationId) {
      console.error("Invalid conversation ID");
      return false;
    }

    if (this.isLoading) {
      console.warn("Loading already in progress");
      return false;
    }

    this.isLoading = true;
    this._showLoadingIndicator();

    try {
      // Verify authentication
      const isAuthenticated = await this._checkAuth();
      if (!isAuthenticated) return false;

      // Clear existing messages
      this._clearMessages();

      // Load conversation from server
      const endpoint = `/api/projects/${this.projectId}/conversations/${conversationId}`;
      const conversation = await window.app.apiRequest(endpoint, "GET");

      // Load messages
      const messagesEndpoint = `/api/projects/${this.projectId}/conversations/${conversationId}/messages`;
      const messagesResponse = await window.app.apiRequest(messagesEndpoint, "GET");
      const messages = messagesResponse.data?.messages || [];

      // Store current conversation ID
      this.currentConversationId = conversationId;

      // Update title
      if (this.titleElement) {
        this.titleElement.textContent = conversation.title || "New Conversation";
      }

      // Render messages
      this._renderMessages(messages);

      // Update URL if needed
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('chatId') !== conversationId) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('chatId', conversationId);
        window.history.pushState({}, '', newUrl.toString());
      }

      this.isLoading = false;
      this._hideLoadingIndicator();

      return true;
    } catch (error) {
      this.isLoading = false;
      this._hideLoadingIndicator();
      this._handleError("loading conversation", error);
      return false;
    }
  }

  /**
   * Create a new conversation
   * @returns {Promise<Object>} - New conversation object
   */
  async createNewConversation() {
    try {
      // Verify authentication
      const isAuthenticated = await this._checkAuth();
      if (!isAuthenticated) {
        throw new Error("Not authenticated");
      }

      // Check for project ID
      if (!this.projectId) {
        throw new Error("Project ID is required to create a conversation");
      }

      // Clear existing messages
      this._clearMessages();

      // Create conversation via API
      const endpoint = `/api/projects/${this.projectId}/conversations`;
      const payload = {
        title: `New Chat ${new Date().toLocaleString()}`,
        model_id: this.modelConfig.modelName
      };

      const response = await window.app.apiRequest(endpoint, "POST", payload);
      const conversation = response.data || response;

      if (!conversation.id) {
        throw new Error("Invalid response from server");
      }

      // Store conversation ID
      this.currentConversationId = conversation.id;

      // Update title
      if (this.titleElement) {
        this.titleElement.textContent = conversation.title || "New Conversation";
      }

      // Update URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('chatId', conversation.id);
      window.history.pushState({}, '', newUrl.toString());

      console.log(`New conversation created: ${conversation.id}`);
      return conversation;
    } catch (error) {
      this._handleError("creating conversation", error);
      throw error;
    }
  }

  /**
   * Send a message in the current conversation
   * @param {string} messageText - Message content to send
   * @returns {Promise<Object>} - Response from server
   */
  async sendMessage(messageText) {
    if (!messageText.trim()) return;

    if (!this.currentConversationId) {
      // Auto-create a conversation if needed
      try {
        await this.createNewConversation();
      } catch (error) {
        this._handleError("creating conversation", error);
        return;
      }
    }

    // Verify authentication
    const isAuthenticated = await this._checkAuth();
    if (!isAuthenticated) return;

    // Immediately show user message in UI
    this._showMessage("user", messageText);

    // Clear input field
    if (this.inputField) {
      this.inputField.value = "";
      this.inputField.focus();
    }

    // Show thinking indicator
    this._showThinkingIndicator();

    try {
      // Create message payload
      const messagePayload = {
        content: messageText,
        role: "user",
        type: "message",
        vision_detail: this.modelConfig.visionDetail || "auto"
      };

      // Add image if present
      if (this.currentImage) {
        messagePayload.image_data = this.currentImage;
        this.currentImage = null;
      }

      // Add extended thinking if enabled
      if (this.modelConfig.extendedThinking) {
        messagePayload.thinking = {
          type: "enabled",
          budget_tokens: this.modelConfig.thinkingBudget
        };
      }

      // Send message
      const endpoint = `/api/chat/projects/${this.projectId}/conversations/${this.currentConversationId}/messages`;
      const response = await window.app.apiRequest(endpoint, "POST", messagePayload);

      // Hide thinking indicator
      this._hideThinkingIndicator();

      // Process and show response
      if (response.data?.assistant_message) {
        const assistantMessage = response.data.assistant_message;
        this._showMessage(
          "assistant",
          assistantMessage.content,
          null,
          response.data.thinking,
          response.data.redacted_thinking,
          assistantMessage.metadata
        );
      } else if (response.data?.assistant_error) {
        const errorMsg = this._extractErrorMessage(response.data.assistant_error);
        throw new Error(errorMsg);
      }

      return response.data;
    } catch (error) {
      // Hide thinking indicator
      this._hideThinkingIndicator();

      // Show error message
      this._showErrorMessage(error.message);
      this._handleError("sending message", error);
    }
  }

  /**
   * Delete current conversation
   * @returns {Promise<boolean>} - Success status
   */
  async deleteConversation() {
    if (!this.currentConversationId) return false;

    try {
      const endpoint = `/api/projects/${this.projectId}/conversations/${this.currentConversationId}`;
      await window.app.apiRequest(endpoint, "DELETE");

      // Clear state
      this.currentConversationId = null;
      this._clearMessages();

      // Update URL
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.delete("chatId");
      window.history.pushState({}, "", `${window.location.pathname}${urlParams.toString() ? `?${urlParams}` : ""}`);

      return true;
    } catch (error) {
      this._handleError("deleting conversation", error);
      return false;
    }
  }

  /**
   * Update the image for the next message
   * @param {string} base64Image - Base64-encoded image data
   */
  setImage(base64Image) {
    this.currentImage = base64Image;
    if (base64Image && this.messageContainer) {
      // Show image indicator in last user message if exists
      const userMessages = this.messageContainer.querySelectorAll('.user-message');
      if (userMessages.length > 0) {
        const lastUserMessage = userMessages[userMessages.length - 1];

        const imageIndicator = document.createElement('div');
        imageIndicator.className = 'image-indicator';
        imageIndicator.innerHTML = `
          <img src="${base64Image}" alt="Attached image" class="preview-image" />
          <span>Image attached</span>
        `;

        lastUserMessage.appendChild(imageIndicator);
      }
    }
  }

  /**
   * Update model configuration
   * @param {Object} config - New configuration
   */
  updateModelConfig(config) {
    this.modelConfig = {
      ...this.modelConfig,
      ...config
    };

    // Save to localStorage
    if (config.modelName) localStorage.setItem("modelName", config.modelName);
    if (config.maxTokens) localStorage.setItem("maxTokens", config.maxTokens);
    if (config.extendedThinking !== undefined) localStorage.setItem("extendedThinking", config.extendedThinking);
    if (config.thinkingBudget) localStorage.setItem("thinkingBudget", config.thinkingBudget);
    if (config.reasoningEffort) localStorage.setItem("reasoningEffort", config.reasoningEffort);
    if (config.visionEnabled !== undefined) localStorage.setItem("visionEnabled", config.visionEnabled);
    if (config.visionDetail) localStorage.setItem("visionDetail", config.visionDetail);

    // Update UI elements if they exist
    const modelSelect = document.getElementById("modelSelect");
    const visionToggle = document.getElementById("visionToggle");
    const tokensDisplay = document.getElementById("maxTokensValue");

    if (modelSelect && config.modelName) {
      modelSelect.value = config.modelName;
    }
    if (visionToggle && config.visionEnabled !== undefined) {
      visionToggle.checked = config.visionEnabled;
    }
    if (tokensDisplay && config.maxTokens) {
      tokensDisplay.textContent = `${config.maxTokens} tokens`;
    }
  }
    // Update UI elements if they exist
    var modelSelect = document.getElementById("modelSelect");
    if (modelSelect && config.modelName) {
      modelSelect.value = config.modelName;
    }

    var visionToggle = document.getElementById("visionToggle");
    if (visionToggle && config.visionEnabled !== undefined) {
      visionToggle.checked = config.visionEnabled;
    }

    // Update tokens display
    var tokensDisplay = document.getElementById("maxTokensValue");
    if (tokensDisplay && config.maxTokens) {
      tokensDisplay.textContent = config.maxTokens + " tokens";
    }

    // Update UI elements if they exist
    const modelSelect = document.getElementById("modelSelect");
    if (modelSelect && config.modelName) {
      modelSelect.value = config.modelName;
    }

    const visionToggle = document.getElementById("visionToggle");
    if (visionToggle && config.visionEnabled !== undefined) {
      visionToggle.checked = config.visionEnabled;
    }

    // Update tokens display
    const tokensDisplay = document.getElementById("maxTokensValue");
    if (tokensDisplay && config.maxTokens) {
      tokensDisplay.textContent = `${config.maxTokens} tokens`;
    }

    // Update UI elements if they exist
    const modelSelect = document.getElementById("modelSelect");
    if (modelSelect && config.modelName) {
      modelSelect.value = config.modelName;
    }

    const visionToggle = document.getElementById("visionToggle");
    if (visionToggle && config.visionEnabled !== undefined) {
      visionToggle.checked = config.visionEnabled;
    }
  }

  // =============== PRIVATE METHODS ===============

  /**
   * Set up UI elements
   * @private
   */
  _setupUIElements(options) {
    // Find or create container
    const containerSelector = options.containerSelector || '#chatUI';
    this.container = document.querySelector(containerSelector);

    if (!this.container) {
      console.warn(`Chat container not found: ${containerSelector}`);
      this.container = this._createChatContainer();
    }

    // Set up message container
    const messageSelector = options.messageContainerSelector || '#conversationArea';
    this.messageContainer = document.querySelector(messageSelector);

    if (!this.messageContainer) {
      this.messageContainer = document.createElement('div');
      this.messageContainer.id = messageSelector.replace('#', '');
      this.container.appendChild(this.messageContainer);
    }

    // Set up input field
    const inputSelector = options.inputSelector || '#chatInput';
    this.inputField = document.querySelector(inputSelector);

    if (!this.inputField) {
      const inputArea = document.createElement('div');
      inputArea.className = 'chat-input-area';

      this.inputField = document.createElement('input');
      this.inputField.id = inputSelector.replace('#', '');
      this.inputField.className = 'chat-input';
      this.inputField.placeholder = 'Type your message...';

      this.sendButton = document.createElement('button');
      this.sendButton.className = 'chat-send-button';
      this.sendButton.textContent = 'Send';

      inputArea.appendChild(this.inputField);
      inputArea.appendChild(this.sendButton);
      this.container.appendChild(inputArea);
    } else {
      this.sendButton = document.querySelector(options.sendButtonSelector || '#sendBtn');
    }

    // Set up title element
    this.titleElement = document.querySelector(options.titleSelector || '#chatTitle');
  }

  /**
   * Create a chat container if not found
   * @private
   */
  _createChatContainer() {
    const container = document.createElement('div');
    container.id = 'chatUI';
    container.className = 'chat-container';

    // Add to page
    const main = document.querySelector('main') || document.body;
    main.appendChild(container);

    return container;
  }

  /**
   * Bind event listeners
   * @private
   */
  _bindEvents() {
    // Input field
    if (this.inputField) {
      this.inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage(this.inputField.value);
        }
      });
    }

    // Send button
    if (this.sendButton) {
      this.sendButton.addEventListener('click', () => {
        this.sendMessage(this.inputField.value);
      });
    }

    // Regenerate button
    document.addEventListener('regenerateChat', () => {
      if (!this.currentConversationId) return;

      // Find last user message
      const userMessages = Array.from(this.messageContainer.querySelectorAll('.user-message'));
      if (userMessages.length === 0) return;

      const lastUserMessage = userMessages[userMessages.length - 1];
      const messageText = lastUserMessage.querySelector('.message-content')?.textContent;

      if (messageText) {
        // Remove last assistant message
        const assistantMessages = Array.from(this.messageContainer.querySelectorAll('.assistant-message'));
        if (assistantMessages.length > 0) {
          assistantMessages[assistantMessages.length - 1].remove();
        }

        // Resend last user message
        this.sendMessage(messageText);
      }
    });

    // Global model config changes
    document.addEventListener('modelConfigChanged', (e) => {
      if (e.detail) {
        this.updateModelConfig(e.detail);
      }
    });
  }

  /**
   * Show a message in the UI
   * @param {string} role - Message role (user, assistant, system)
   * @param {string} content - Message content
   * @param {string} id - Message ID
   * @param {string} thinking - Thinking content
   * @param {boolean} redactedThinking - Whether thinking was redacted
   * @param {Object} metadata - Additional metadata
   * @private
   */
  _showMessage(role, content, id = null, thinking = null, redactedThinking = false, metadata = null) {
    if (!this.messageContainer) return;

    // Create message element
    const message = document.createElement('div');
    message.className = `message ${role}-message`;
    if (id) message.id = id;

    // Create header
    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerHTML = `
      <span class="message-role">${role === 'assistant' ? 'Claude' : role === 'user' ? 'You' : 'System'}</span>
      <span class="message-time">${new Date().toLocaleTimeString()}</span>
    `;

    // Create content
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    contentEl.innerHTML = this._formatText(content);

    // Assemble message
    message.appendChild(header);
    message.appendChild(contentEl);

    // Add thinking block if present
    if (thinking || redactedThinking) {
      const thinkingContainer = this._createThinkingBlock(thinking, redactedThinking);
      message.appendChild(thinkingContainer);
    }

    // Add to container
    this.messageContainer.appendChild(message);

    // Scroll to bottom
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
  }

  /**
   * Create a collapsible thinking block
   * @param {string} thinking - Thinking content
   * @param {boolean} redacted - Whether thinking was redacted
   * @returns {HTMLElement} - Thinking block element
   * @private
   */
  _createThinkingBlock(thinking, redacted) {
    const container = document.createElement('div');
    container.className = 'thinking-container';

    // Create toggle button
    const toggle = document.createElement('button');
    toggle.className = 'thinking-toggle';
    toggle.innerHTML = `
      <svg class="thinking-chevron" viewBox="0 0 24 24">
        <path d="M19 9l-7 7-7-7"></path>
      </svg>
      <span>${thinking ? 'Show detailed reasoning' : 'Safety notice'}</span>
    `;

    // Create content div
    const content = document.createElement('div');
    content.className = 'thinking-content hidden';

    if (thinking) {
      content.innerHTML = this._formatText(thinking);
    } else if (redacted) {
      content.innerHTML = `
        <div class="redacted-notice">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
          </svg>
          <span>Some reasoning was redacted for safety reasons</span>
        </div>
      `;
    }

    // Add toggle behavior
    toggle.addEventListener('click', () => {
      content.classList.toggle('hidden');
      const chevron = toggle.querySelector('.thinking-chevron');

      if (content.classList.contains('hidden')) {
        toggle.querySelector('span').textContent = thinking ? 'Show detailed reasoning' : 'Show safety notice';
        if (chevron) chevron.style.transform = '';
      } else {
        toggle.querySelector('span').textContent = thinking ? 'Hide detailed reasoning' : 'Hide safety notice';
        if (chevron) chevron.style.transform = 'rotate(180deg)';
      }
    });

    container.appendChild(toggle);
    container.appendChild(content);

    return container;
  }

  /**
   * Show loading indicator
   * @private
   */
  _showLoadingIndicator() {
    if (!this.messageContainer) return;

    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'chatLoadingIndicator';
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.innerHTML = `
      <div class="loading-spinner"></div>
      <span>Loading conversation...</span>
    `;

    this.messageContainer.appendChild(loadingIndicator);
  }

  /**
   * Hide loading indicator
   * @private
   */
  _hideLoadingIndicator() {
    const indicator = document.getElementById('chatLoadingIndicator');
    if (indicator) {
      indicator.remove();
    }
  }

  /**
   * Show thinking indicator
   * @private
   */
  _showThinkingIndicator() {
    if (!this.messageContainer) return;

    const thinkingIndicator = document.createElement('div');
    thinkingIndicator.id = 'thinkingIndicator';
    thinkingIndicator.className = 'thinking-indicator';
    thinkingIndicator.innerHTML = `
      <div class="thinking-dots">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <span>Claude is thinking...</span>
    `;

    this.messageContainer.appendChild(thinkingIndicator);
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
  }

  /**
   * Hide thinking indicator
   * @private
   */
  _hideThinkingIndicator() {
    const indicator = document.getElementById('thinkingIndicator');
    if (indicator) {
      indicator.remove();
    }
  }

  /**
   * Show error message
   * @param {string} message - Error message
   * @private
   */
  _showErrorMessage(message) {
    if (!this.messageContainer) return;

    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    errorEl.innerHTML = `
      <div class="error-icon">
        <svg viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
        </svg>
      </div>
      <div class="error-content">
        <h4>Error</h4>
        <p>${message}</p>
      </div>
    `;

    this.messageContainer.appendChild(errorEl);
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
  }

  /**
   * Clear all messages
   * @private
   */
  _clearMessages() {
    if (this.messageContainer) {
      this.messageContainer.innerHTML = '';
    }
  }

  /**
   * Render multiple messages
   * @param {Array} messages - Messages to render
   * @private
   */
  _renderMessages(messages) {
    this._clearMessages();

    if (!messages || messages.length === 0) {
      this._showMessage("system", "No messages yet");
      return;
    }

    messages.forEach(msg => {
      this._showMessage(
        msg.role,
        msg.content,
        msg.id,
        msg.thinking,
        msg.redacted_thinking,
        msg.metadata
      );
    });
  }

  /**
   * Format text for display
   * @param {string} text - Text to format
   * @returns {string} - Formatted HTML
   * @private
   */
  _formatText(text) {
    if (!text) return '';

    // Escape HTML
    let safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Process code blocks
    safe = safe.replace(/```([\s\S]*?)```/g, (match, code) => {
      return `<pre class="code-block"><code>${code.trim()}</code></pre>`;
    });

    // Process inline code
    safe = safe.replace(/`([^`]+)`/g, (match, code) => {
      return `<code class="inline-code">${code}</code>`;
    });

    // Convert line breaks
    safe = safe.replace(/\n/g, '<br>');

    return safe;
  }

  /**
   * Get project ID from various sources
   * @returns {string|null} - Project ID
   * @private
   */
  _getProjectId() {
    // From localStorage
    const storedId = localStorage.getItem('selectedProjectId');
    if (storedId && this._isValidUUID(storedId)) {
      return storedId;
    }

    // From URL path
    const pathMatch = window.location.pathname.match(/\/projects\/([0-9a-f-]+)/i);
    if (pathMatch && pathMatch[1] && this._isValidUUID(pathMatch[1])) {
      return pathMatch[1];
    }

    // From URL query
    const urlParams = new URLSearchParams(window.location.search);
    const queryId = urlParams.get('project') || urlParams.get('projectId');
    if (queryId && this._isValidUUID(queryId)) {
      return queryId;
    }

    return null;
  }

  /**
   * Validate UUID format
   * @param {string} uuid - UUID to validate
   * @returns {boolean} - Is valid UUID
   * @private
   */
  _isValidUUID(uuid) {
    if (!uuid) return false;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(uuid);
  }

  /**
   * Ensure authentication is ready
   * @returns {Promise<void>}
   * @private
   */
  async _ensureAuthReady() {
    if (!window.auth?.isReady) {
      return new Promise(resolve => {
        const authReadyCheck = () => {
          if (window.auth?.isReady) {
            document.removeEventListener('authReady', authReadyCheck);
            resolve();
          }
        };

        document.addEventListener('authReady', authReadyCheck);

        // Safety timeout
        setTimeout(() => {
          document.removeEventListener('authReady', authReadyCheck);
          resolve();
        }, 5000);
      });
    }
  }

  /**
   * Check authentication status
   * @returns {Promise<boolean>} - Is authenticated
   * @private
   */
  async _checkAuth() {
    try {
      const isAuthenticated = await window.auth.checkAuth();

      if (!isAuthenticated) {
        window.showNotification("Please log in to continue", "error");
        return false;
      }

      return true;
    } catch (error) {
      this._handleError("authentication check", error);
      return false;
    }
  }

  /**
   * Extract user-friendly error message from error object
   * @param {Object|string} error - Error object or message
   * @returns {string} - Formatted error message
   * @private
   */
  _extractErrorMessage(error) {
    if (!error) return "Unknown error occurred";

    if (typeof error === 'string') {
      return error;
    }

    if (error.message) {
      return error.message;
    }

    if (typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch (e) {
        return "Unknown error object";
      }
    }

    return String(error);
  }

  /**
   * Handle errors with consistent formatting
   * @param {string} context - Error context
   * @param {Error|string} error - Error object or message
   * @private
   */
  _handleError(context, error) {
    const message = this._extractErrorMessage(error);
    console.error(`[Chat - ${context}]`, error);

    if (window.showNotification) {
      window.showNotification(message, "error");
    }

    // For auth errors, clear state
    if (message.includes('authentication') ||
        message.includes('not authenticated') ||
        message.includes('login') ||
        (error.status === 401)) {
      window.auth?.clearTokenState?.({ source: 'chat_error' });
    }
  }
}

// Create global instance
window.chatManager = new ChatManager();

// Export methods for backward compatibility
window.initializeChat = () => window.chatManager.initialize();
window.loadConversation = (chatId) => window.chatManager.loadConversation(chatId);
window.createNewChat = () => window.chatManager.createNewConversation();
window.sendMessage = (message) => window.chatManager.sendMessage(message);
