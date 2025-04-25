/**
 * chat.js
 * A refactored chat module that handles conversation management, messaging,
 * and UI rendering for the chat system in a more standardized way:
 * Dependencies:
 * - window.app (external dependency, for state management and API requests)
 * - window.auth (external dependency, for authentication checks)
 * - window.modelConfig (external dependency, for model configuration)
 * - window.eventHandlers (external utility, for event management)
 * - window.formatText (optional external utility, for text formatting)
 * - window.DependencySystem (external dependency, for module registration)
 * - document (browser built-in, for DOM manipulation)
 * - localStorage (browser built-in, for persistent state)
 * - URL, URLSearchParams (browser built-in, for URL parsing)
 */

// Browser APIs:
// - document (DOM access)
// - localStorage (state persistence)
// - URL/URLSearchParams (URL parsing)
// - Event system (event listeners)

// External Dependencies (Global Scope):
// - window.app (application core)
// - window.auth (authentication system)
// - window.modelConfig (model settings)
// - window.eventHandlers (event management)
// - window.formatText (optional text formatting)
// - window.DependencySystem (module registration)

// Optional Dependencies:
// - Gracefully falls back if formatText not available
// - Handles missing auth module
// - Provides basic error handling if showNotification not available


/**
 * Configuration - retains the local config for default model, tokens, etc.
 */
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

    // Event callbacks (unused in this snippet but could be used externally)
    this._eventHandlers = {};

    // Model configuration
    // Pull initial model config from window.modelConfig if available, else fallback
    const globalConfig = window.modelConfig?.getConfig?.() || {};
    this.modelConfig = {
      modelName:
        globalConfig.modelName ||
        localStorage.getItem("modelName") ||
        CHAT_CONFIG.DEFAULT_MODEL,
      maxTokens:
        globalConfig.maxTokens ||
        parseInt(localStorage.getItem("maxTokens") || CHAT_CONFIG.MAX_TOKENS, 10),
      extendedThinking:
        globalConfig.extendedThinking ??
        (localStorage.getItem("extendedThinking") === "true"),
      thinkingBudget:
        globalConfig.thinkingBudget ||
        parseInt(
          localStorage.getItem("thinkingBudget") || CHAT_CONFIG.THINKING_BUDGET,
          10
        ),
      reasoningEffort:
        globalConfig.reasoningEffort ||
        localStorage.getItem("reasoningEffort") ||
        CHAT_CONFIG.REASONING_EFFORT,
      visionEnabled:
        globalConfig.visionEnabled ??
        (localStorage.getItem("visionEnabled") === "true"),
      visionDetail:
        globalConfig.visionDetail ||
        localStorage.getItem("visionDetail") ||
        "auto"
    };
  }

  /**
   * Initialize the chat system
   * @param {Object} options - Configuration options
   * @returns {Promise<boolean>} - Success status
   */
  async initialize(options = {}) {
    if (this.isInitialized) {
      console.warn("[Chat] System already initialized");
      return true;
    }

    console.log("[Chat] Initializing chat system...");

    try {
      // Use app.state.isAuthenticated to avoid multiple direct checks
      if (!window.auth?.isAuthenticated()) {
        console.warn("[Chat] User not authenticated, cannot initialize chat");
        // We can still set up UI but won't load any conversation
      }

      // Setup UI elements
      this._setupUIElements(options);

      // Bind events using eventHandlers
      this._bindEvents();

      // Check URL for conversation ID
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get("chatId");

      // Get project ID from URL or localStorage
      this.projectId = this._getProjectId();

      if (!this.projectId) {
        console.warn("[Chat] No project selected, chat system requires a project");
        this._showMessage("system", "Please select a project to start a conversation");
        this.isInitialized = true;
        return false;
      }

      // If user is authenticated, load or create conversation
      if (window.app.state.isAuthenticated) {
        if (chatId) {
          await this.loadConversation(chatId);
        } else {
          await this.createNewConversation();
        }
      }

      this.isInitialized = true;
      console.log("[Chat] System initialized");

      // Dispatch event
      document.dispatchEvent(
        new CustomEvent("chatInitialized", {
          detail: { instance: this }
        })
      );

      return true;
    } catch (error) {
      console.error("[Chat] Initialization failed:", error);
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
      console.error("[Chat] Invalid conversation ID given to loadConversation");
      return false;
    }

    if (!window.auth?.isAuthenticated()) {
      console.warn("[Chat] loadConversation called but user not authenticated");
      return false;
    }

    if (this.isLoading) {
      console.warn("[Chat] Loading already in progress");
      return false;
    }

    this.isLoading = true;
    this._showLoadingIndicator();

    try {
      // Clear existing messages
      this._clearMessages();

      const endpoint = `/api/projects/${this.projectId}/conversations/${conversationId}`;
      const conversation = await window.app.apiRequest(endpoint, { method: "GET" });

      const messagesEndpoint = `/api/projects/${this.projectId}/conversations/${conversationId}/messages`;
      const messagesResponse = await window.app.apiRequest(messagesEndpoint, { method: "GET" });
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
      if (urlParams.get("chatId") !== conversationId) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("chatId", conversationId);
        window.history.pushState({}, "", newUrl.toString());
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
    if (!window.auth?.isAuthenticated()) {
      console.warn("[Chat] User not authenticated, cannot create conversation");
      throw new Error("Not authenticated");
    }

    if (!this.projectId) {
      throw new Error("[Chat] Project ID is required to create a conversation");
    }

    // Clear existing messages
    this._clearMessages();

    // Create conversation via API
    try {
      const endpoint = `/api/projects/${this.projectId}/conversations`;
      const payload = {
        title: `New Chat ${new Date().toLocaleString()}`,
        model_id: this.modelConfig.modelName
      };

      const response = await window.app.apiRequest(endpoint, { method: "POST", body: payload });
      const conversation = response.data || response;

      if (!conversation.id) {
        throw new Error("[Chat] Invalid response from server creating conversation");
      }

      // Store conversation ID
      this.currentConversationId = conversation.id;

      // Update title
      if (this.titleElement) {
        this.titleElement.textContent = conversation.title || "New Conversation";
      }

      // Update URL
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("chatId", conversation.id);
      window.history.pushState({}, "", newUrl.toString());

      console.log(`[Chat] New conversation created: ${conversation.id}`);
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

    // If not authenticated, user can't send message
    if (!window.auth?.isAuthenticated()) {
      window.app?.showNotification?.("Please log in to send messages", "error");
      return;
    }

    // Ensure there's a conversation
    if (!this.currentConversationId) {
      try {
        await this.createNewConversation();
      } catch (error) {
        this._handleError("creating conversation", error);
        return;
      }
    }

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

      // Add image if present, and validate size
      if (this.currentImage) {
        // Accept base64 data URI or raw string; estimate size in bytes
        let imgData = this.currentImage;
        if (typeof imgData === "string" && imgData.startsWith("data:")) {
          // Only count the data part (skip 'data:image/png;base64,')
          const commaIdx = imgData.indexOf(',');
          const b64 = commaIdx !== -1 ? imgData.slice(commaIdx + 1) : imgData;
          // base64 -> bytes estimate: 3/4 * b64 length
          const sizeBytes = Math.floor((b64.length * 3) / 4);
          if (sizeBytes > 4 * 1024 * 1024) {
            this._hideThinkingIndicator();
            window.app?.showNotification?.("Image is too large (max 4MB). Please choose a smaller file.", "error");
            return;
          }
        }
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
      const endpoint = `/api/projects/${this.projectId}/conversations/${this.currentConversationId}/messages`;
      const response = await window.app.apiRequest(endpoint, { method: "POST", body: messagePayload });

      // Hide thinking indicator
      this._hideThinkingIndicator();

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

    if (!window.auth?.isAuthenticated()) {
      console.warn("[Chat] Cannot delete conversation - not authenticated");
      return false;
    }

    try {
      const endpoint = `/api/projects/${this.projectId}/conversations/${this.currentConversationId}`;
      await window.app.apiRequest(endpoint, { method: "DELETE" });

      // Clear state
      this.currentConversationId = null;
      this._clearMessages();

      // Update URL
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.delete("chatId");
      window.history.pushState(
        {},
        "",
        `${window.location.pathname}${
          urlParams.toString() ? `?${urlParams}` : ""
        }`
      );

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
      const userMessages = this.messageContainer.querySelectorAll(".user-message");
      if (userMessages.length > 0) {
        const lastUserMessage = userMessages[userMessages.length - 1];

        const imageIndicator = document.createElement("div");
        imageIndicator.className = "image-indicator";
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
    // Delegate to modelConfig.js to avoid duplication
    window.modelConfig.updateConfig(config);

    // Re-sync local modelConfig
    this.modelConfig = window.modelConfig.getConfig();

    // Update UI elements
    const modelSelect = document.getElementById("modelSelect");
    if (modelSelect && this.modelConfig.modelName) {
      modelSelect.value = this.modelConfig.modelName;
    }

    const visionToggle = document.getElementById("visionToggle");
    if (visionToggle && this.modelConfig.visionEnabled !== undefined) {
      visionToggle.checked = this.modelConfig.visionEnabled;
    }

    const tokensDisplay = document.getElementById("maxTokensValue");
    if (tokensDisplay && this.modelConfig.maxTokens) {
      tokensDisplay.textContent = `${this.modelConfig.maxTokens} tokens`;
    }
  }

  // =============== PRIVATE METHODS ===============

  /**
   * Set up UI elements
   * @private
   */
  _setupUIElements(options) {
    // Find or create container
    const containerSelector = options.containerSelector || "#chatUI";
    this.container = document.querySelector(containerSelector);

    if (!this.container) {
      console.warn(`[Chat] Container not found: ${containerSelector}`);
      this.container = this._createChatContainer();
    }

    // Set up message container
    const messageSelector = options.messageContainerSelector || "#conversationArea";
    this.messageContainer = document.querySelector(messageSelector);

    if (!this.messageContainer) {
      this.messageContainer = document.createElement("div");
      this.messageContainer.id = messageSelector.replace("#", "");
      this.container.appendChild(this.messageContainer);
    }

    // Set up input field
    const inputSelector = options.inputSelector || "#chatInput";
    this.inputField = document.querySelector(inputSelector);

    if (!this.inputField) {
      const inputArea = document.createElement("div");
      inputArea.className = "chat-input-area";

      this.inputField = document.createElement("input");
      this.inputField.id = inputSelector.replace("#", "");
      this.inputField.className = "chat-input";
      this.inputField.placeholder = "Type your message...";

      this.sendButton = document.createElement("button");
      this.sendButton.className = "chat-send-button";
      this.sendButton.textContent = "Send";

      inputArea.appendChild(this.inputField);
      inputArea.appendChild(this.sendButton);
      this.container.appendChild(inputArea);
    } else {
      // If inputField was found, find the send button
      this.sendButton = document.querySelector(options.sendButtonSelector || "#sendBtn");
    }

    // Set up title element
    this.titleElement = document.querySelector(options.titleSelector || "#chatTitle");
  }

  /**
   * Create a chat container if not found
   * @private
   */
  _createChatContainer() {
    const container = document.createElement("div");
    container.id = "chatUI";
    container.className = "chat-container";

    const main = document.querySelector("main") || document.body;
    main.appendChild(container);

    return container;
  }

  /**
   * Bind event listeners
   * @private
   */
  _bindEvents() {
    // trackListener from eventHandler
    const trackListener =
      window.eventHandlers?.trackListener ??
      ((el, type, fn, opts) => {
        el.addEventListener(type, fn, opts);
        return fn;
      });

    // Input field
    if (this.inputField) {
      trackListener(
        this.inputField,
        "keydown",
        (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage(this.inputField.value);
          }
        },
        { passive: false, description: "Send on Enter" }
      );
    }

    // Send button
    if (this.sendButton) {
      trackListener(this.sendButton, "click", () => {
        this.sendMessage(this.inputField.value);
      });
    }

    // Regenerate event
    trackListener(
      document,
      "regenerateChat",
      () => {
        if (!this.currentConversationId) return;

        const userMessages = Array.from(
          this.messageContainer.querySelectorAll(".user-message")
        );
        if (userMessages.length === 0) return;

        const lastUserMessage = userMessages[userMessages.length - 1];
        const messageText =
          lastUserMessage.querySelector(".message-content")?.textContent;

        if (messageText) {
          // Remove last assistant message
          const assistantMessages = Array.from(
            this.messageContainer.querySelectorAll(".assistant-message")
          );
          if (assistantMessages.length > 0) {
            assistantMessages[assistantMessages.length - 1].remove();
          }

          this.sendMessage(messageText);
        }
      },
      { description: "Regenerate chat message" }
    );

    // Model config changes
    trackListener(document, "modelConfigChanged", (e) => {
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

    const message = document.createElement("div");
    message.className = `message ${role}-message`;
    if (id) message.id = id;

    const header = document.createElement("div");
    header.className = "message-header";
    header.innerHTML = `
      <span class="message-role">
        ${role === "assistant" ? "Claude" : role === "user" ? "You" : "System"}
      </span>
      <span class="message-time">${new Date().toLocaleTimeString()}</span>
    `;

    const contentEl = document.createElement("div");
    contentEl.className = "message-content";
    contentEl.innerHTML = this._formatText(content);

    message.appendChild(header);
    message.appendChild(contentEl);

    // Add thinking block if present
    if (thinking || redactedThinking) {
      const thinkingContainer = this._createThinkingBlock(thinking, redactedThinking);
      message.appendChild(thinkingContainer);
    }

    this.messageContainer.appendChild(message);
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
  }

  /**
   * Use the global formatting function to keep consistency
   * @private
   */
  _sanitizeHtml(unsafe) {
    if (!unsafe) return "";
    const div = document.createElement("div");
    div.textContent = unsafe;
    return div.innerHTML;
  }

  _formatText(text) {
    if (!text) return "";
    const sanitized = this._sanitizeHtml(text);
    // Delegate to formatting.js's window.formatText if available
    return window.formatText ? window.formatText(sanitized) : sanitized;
  }

  /**
   * Create a collapsible thinking block
   * @private
   */
  _createThinkingBlock(thinking, redacted) {
    const container = document.createElement("div");
    container.className = "thinking-container";

    const toggle = document.createElement("button");
    toggle.className = "thinking-toggle";
    toggle.innerHTML = `
      <svg class="thinking-chevron" viewBox="0 0 24 24">
        <path d="M19 9l-7 7-7-7"></path>
      </svg>
      <span>${thinking ? "Show detailed reasoning" : "Safety notice"}</span>
    `;

    const content = document.createElement("div");
    content.className = "thinking-content hidden";

    if (thinking) {
      content.innerHTML = this._formatText(thinking);
    } else if (redacted) {
      content.innerHTML = `
        <div class="redacted-notice">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10
                    10 10 10-4.48 10-10S17.52 2 12 2zm1
                    15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
          </svg>
          <span>Some reasoning was redacted for safety reasons</span>
        </div>
      `;
    }

    toggle.addEventListener("click", () => {
      content.classList.toggle("hidden");
      const chevron = toggle.querySelector(".thinking-chevron");

      if (content.classList.contains("hidden")) {
        toggle.querySelector("span").textContent = thinking
          ? "Show detailed reasoning"
          : "Show safety notice";
        if (chevron) chevron.style.transform = "";
      } else {
        toggle.querySelector("span").textContent = thinking
          ? "Hide detailed reasoning"
          : "Hide safety notice";
        if (chevron) chevron.style.transform = "rotate(180deg)";
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

    const loadingIndicator = document.createElement("div");
    loadingIndicator.id = "chatLoadingIndicator";
    loadingIndicator.className = "loading-indicator";
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
    const indicator = document.getElementById("chatLoadingIndicator");
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

    const thinkingIndicator = document.createElement("div");
    thinkingIndicator.id = "thinkingIndicator";
    thinkingIndicator.className = "thinking-indicator";
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
    const indicator = document.getElementById("thinkingIndicator");
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

    const errorEl = document.createElement("div");
    errorEl.className = "error-message";
    errorEl.innerHTML = `
      <div class="error-icon">
        <svg viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2
                  12s4.48 10 10 10 10-4.48
                  10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
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
      this.messageContainer.innerHTML = "";
    }
  }

  /**
   * Render multiple messages
   * @private
   */
  _renderMessages(messages) {
    this._clearMessages();

    if (!messages || messages.length === 0) {
      this._showMessage("system", "No messages yet");
      return;
    }

    messages.forEach((msg) => {
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
   * Retrieve project ID from various sources
   * @private
   */
  _getProjectId() {
    const storedId = localStorage.getItem("selectedProjectId");
    if (storedId && this._isValidUUID(storedId)) {
      return storedId;
    }

    const pathMatch = window.location.pathname.match(/\/projects\/([0-9a-f-]+)/i);
    if (pathMatch && pathMatch[1] && this._isValidUUID(pathMatch[1])) {
      return pathMatch[1];
    }

    const urlParams = new URLSearchParams(window.location.search);
    const queryId = urlParams.get("project") || urlParams.get("projectId");
    if (queryId && this._isValidUUID(queryId)) {
      return queryId;
    }

    return null;
  }

  /**
   * Validate UUID format
   * @param {string} uuid
   * @returns {boolean}
   * @private
   */
  _isValidUUID(uuid) {
    if (!uuid) return false;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidPattern.test(uuid);
  }

  /**
   * Extract user-friendly error message from error object
   * @param {Object|string} error
   * @returns {string}
   * @private
   */
  _extractErrorMessage(error) {
    if (!error) return "Unknown error occurred";

    if (typeof error === "string") {
      return error;
    }

    if (error.message) {
      return error.message;
    }

    if (typeof error === "object") {
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
   * @private
   */
  _handleError(context, error) {
    const message = this._extractErrorMessage(error);
    console.error(`[Chat - ${context}]`, error);

    if (window.app?.showNotification) {
      window.app.showNotification(message, "error");
    }
  }
}
window.chatManager = new ChatManager();
window.createNewChat = () => window.chatManager.createNewConversation();
window.sendMessage = (message) => window.chatManager.sendMessage(message);
DependencySystem.register('chatManager', window.chatManager);
