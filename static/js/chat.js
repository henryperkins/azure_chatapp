/****
 * Chat Manager Module - Strict DI Version (No window.*, No global DependencySystem)
 *
 * Provides a complete chat interface implementation with conversation management,
 * message handling, and UI integration. All dependencies must be passed as options
 * to the factory function createChatManager().
 *
 * Key Features:
 * - Manages chat conversations (create, load, delete)
 * - Handles message sending with queuing and error handling
 * - Supports image attachments with size validation
 * - Provides UI integration for chat display and input
 * - Implements model configuration management
 * - Includes comprehensive error handling and user feedback
 *
 * Dependencies passed as options to createChatManager():
 *  - apiRequest (required): Async function for making HTTP requests
 *  - app (required): Contains showNotification, optional formatters, etc.
 *  - eventHandlers (optional): Provides trackListener, etc.
 *  - modelConfig (optional): If absent, a stub config is used
 *  - projectDetailsComponent (optional): For disabling UI or other integration
 *  - isValidProjectId, isAuthenticated (functions) from your own validation/auth modules
 *
 * Usage Example:
 * ```
 * import { createChatManager } from './chatManager.js';
 * import { isValidProjectId, isAuthenticated } from './utils/globalUtils.js';
 *
 * const chatManager = createChatManager({
 *   apiRequest: myApiRequestFunction, // required
 *   app,
 *   eventHandlers,
 *   modelConfig,
 *   projectDetailsComponent,
 *   isValidProjectId,
 *   isAuthenticated
 * });
 *
 * await chatManager.initialize({ projectId: '123' });
 * ```
 ****/

import DOMPurify from './vendor/dompurify.es.js';

// Constants for API endpoints
const API_ENDPOINTS = {
  CONVERSATIONS: (projectId) => `/api/projects/${projectId}/conversations/`,
  CONVERSATION: (projectId, conversationId) =>
    `/api/projects/${projectId}/conversations/${conversationId}/`,
  MESSAGES: (projectId, conversationId) =>
    `/api/projects/${projectId}/conversations/${conversationId}/messages/`
};

// Defaults for chat
const CHAT_CONFIG = {
  DEFAULT_MODEL: "claude-3-sonnet-20240229",
  MAX_TOKENS: 4096,
  THINKING_BUDGET: 16000,
  REASONING_EFFORT: "medium",
  MAX_IMAGE_SIZE: 4 * 1024 * 1024 // 4MB
};

/**
 * MessageQueue enforces sequential processing of tasks (e.g., sending messages).
 */
class MessageQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  add(task) {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
      this.process();
    });
  }

  async process() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    const { task, resolve } = this.queue.shift();
    try {
      const result = await task();
      resolve(result);
    } finally {
      this.isProcessing = false;
      this.process();
    }
  }
}

/**
 * Strict DI version of createChatManager().
 * @param {Object} options
 * @param {Function} options.apiRequest - Required async function that executes http requests
 * @param {Object} options.app - Required main application service (for showNotification, etc.)
 * @param {Object} [options.eventHandlers] - Optional event handling utility
 * @param {Object} [options.modelConfig] - Optional model config manager
 * @param {Object} [options.projectDetailsComponent] - Optional UI component to disable/enable chat
 * @param {Function} options.isValidProjectId - Required validation function for project IDs
 * @param {Function} options.isAuthenticated - Required function that returns true if user is logged in
 * @returns {ChatManager} - New instance of ChatManager
 */
export function createChatManager({
  apiRequest,
  app,
  eventHandlers,
  modelConfig,
  projectDetailsComponent,
  isValidProjectId,
  isAuthenticated
} = {}) {
  if (typeof apiRequest !== 'function') {
    throw new Error("[ChatManager] 'apiRequest' must be provided and be a function.");
  }
  if (!app) {
    throw new Error("[ChatManager] 'app' is required. Provide at least an object with showNotification().");
  }
  if (typeof isValidProjectId !== 'function' || typeof isAuthenticated !== 'function') {
    throw new Error("[ChatManager] 'isValidProjectId' and 'isAuthenticated' must be provided as functions.");
  }

  /**
   * Returns the modelConfig object or a stub if missing.
   */
  function getModelConfig() {
    return modelConfig || {
      getConfig: () => ({}),
      updateConfig: () => { },
      getModelOptions: () => [],
      onConfigChange: () => { }
    };
  }

  /**
   * The main ChatManager class, entirely constructed via DI.
   */
  class ChatManager {
    constructor() {
      this.apiRequest = apiRequest; // guaranteed from closure
      this.currentConversationId = null;
      this.projectId = null;
      this.isInitialized = false;
      this.isLoading = false;
      this.isGlobalMode = false;
      this.currentImage = null;
      this.loadPromise = null;
      this.currentRequestId = 0;
      this.messageQueue = new MessageQueue();
      this.container = null;
      this.messageContainer = null;
      this.inputField = null;
      this.sendButton = null;
      this.titleElement = null;
      this.modelConfig = getModelConfig().getConfig();
    }

    /**
     * Basic initialization: sets projectId, sets up UI, ensures authentication, etc.
     * @param {Object} [options]
     * @param {string} [options.projectId] - If provided, use this project ID
     * @param {string} [options.containerSelector] - Optional CSS selector for the chat container
     * @param {string} [options.messageContainerSelector] - Optional CSS selector for messages
     * @param {string} [options.inputSelector] - Optional CSS selector for input field
     * @param {string} [options.sendButtonSelector] - Optional selector for send button
     * @param {string} [options.titleSelector] - Optional selector for conversation title
     */
    async initialize(options = {}) {
      const requestedProjectId = (options.projectId && isValidProjectId(options.projectId))
        ? options.projectId
        : null;

      if (this.isInitialized && this.projectId === requestedProjectId) {
        console.warn(`[ChatManager] Already initialized for project ${requestedProjectId}. Re-binding UI...`);
        this._setupUIElements(options);
        this._bindEvents();
        return true;
      }

      // If switching or first load:
      const previousProjectId = this.projectId;
      this.projectId = requestedProjectId;
      this.isGlobalMode = !isValidProjectId(this.projectId); // allow "no project" mode

      if (this.isInitialized && previousProjectId !== requestedProjectId) {
        // Reset relevant state
        this.isInitialized = false;
        this.currentConversationId = null;
        this.loadPromise = null;
        this.isLoading = false;
        this.messageContainer?.replaceChildren?.();
      }

      if (!isAuthenticated()) {
        const msg = "[ChatManager] User not authenticated";
        this._showErrorMessage(msg);
        this._handleError("initialization", msg);
        projectDetailsComponent?.disableChatUI?.("Not authenticated");
        throw new Error(msg);
      }

      // If no valid project, run "global" mode
      if (this.isGlobalMode) {
        console.info("[ChatManager] Starting in global (no-project) mode.");
        this._setupUIElements(options);
        this._bindEvents();
        this.isInitialized = true;
        return true;
      }

      // Otherwise, do a full project-based init:
      console.log(`[ChatManager] Initializing for projectId: ${this.projectId}`);
      try {
        this._setupUIElements(options);
        this._bindEvents();
        // Create or load a first conversation if you prefer automatically:
        await this.createNewConversation();
        this.isInitialized = true;
        return true;
      } catch (error) {
        this._handleError("initialization", error);
        projectDetailsComponent?.disableChatUI?.("Chat error: " + (error.message || error));
        throw error;
      }
    }

    /**
     * Loads an existing conversation by ID, retrieving messages from the server.
     * @param {string} conversationId
     */
    async loadConversation(conversationId) {
      if (!conversationId) {
        console.error("[ChatManager] Invalid conversationId");
        return false;
      }
      if (!isAuthenticated()) {
        console.warn("[ChatManager] loadConversation: user not authenticated");
        return false;
      }
      if (!isValidProjectId(this.projectId)) {
        this._handleError("loading conversation", "No valid projectId set");
        this._showErrorMessage("Cannot load conversation: invalid or missing project ID.");
        return false;
      }

      const requestId = ++this.currentRequestId;
      if (this.loadPromise) {
        console.warn("[ChatManager] Already loading; waiting for existing loadPromise");
        const result = await this.loadPromise;
        return requestId === this.currentRequestId ? result : false;
      }

      this.isLoading = true;
      this._showLoadingIndicator();

      this.loadPromise = (async () => {
        try {
          // Clear existing
          this._clearMessages();
          // Parallel fetch conversation + messages
          const [conversation, messagesResponse] = await Promise.all([
            this.apiRequest(API_ENDPOINTS.CONVERSATION(this.projectId, conversationId), { method: "GET" }),
            this.apiRequest(API_ENDPOINTS.MESSAGES(this.projectId, conversationId), { method: "GET" })
          ]);

          const messages = messagesResponse.data?.messages || [];
          this.currentConversationId = conversationId;
          if (this.titleElement) {
            this.titleElement.textContent = conversation.title || "New Conversation";
          }
          this._renderMessages(messages);
          this._updateURLWithConversationId(conversationId);
          return true;
        } catch (error) {
          this._handleError("loading conversation", error);
          return false;
        } finally {
          this.isLoading = false;
          this._hideLoadingIndicator();
          this.loadPromise = null;
        }
      })();

      return this.loadPromise;
    }

    /**
     * Creates a new conversation for the current project.
     * @param {string} [overrideProjectId]
     */
    async createNewConversation(overrideProjectId) {
      if (overrideProjectId) {
        this.projectId = isValidProjectId(overrideProjectId) ? overrideProjectId : this.projectId;
      }
      if (!isAuthenticated()) {
        console.warn("[ChatManager] createNewConversation: not authenticated");
        throw new Error("Not authenticated");
      }
      if (!isValidProjectId(this.projectId)) {
        const msg = "[ChatManager] Project ID is invalid or missing, cannot create conversation";
        this._showErrorMessage(msg);
        this._handleError("creating conversation", msg);
        projectDetailsComponent?.disableChatUI?.("No valid project");
        throw new Error(msg);
      }

      // Clear UI
      this._clearMessages();

      try {
        const config = getModelConfig().getConfig();
        const payload = {
          title: `New Chat ${new Date().toLocaleString()}`,
          model_id: config.modelName || CHAT_CONFIG.DEFAULT_MODEL
        };
        const response = await this.apiRequest(API_ENDPOINTS.CONVERSATIONS(this.projectId), {
          method: "POST",
          body: payload
        });

        // Robustly extract conversation object from response at any level
        let conversation = null;
        if (response?.data?.conversation?.id) {
          conversation = response.data.conversation;
        } else if (response?.data?.id) {
          conversation = response.data;
        } else if (response?.conversation?.id) {
          conversation = response.conversation;
        } else if (response?.id) {
          conversation = response;
        }
        if (!conversation?.id) {
          throw new Error("Server response missing conversation ID. Full response: " + JSON.stringify(response));
        }
        this.currentConversationId = conversation.id;
        if (this.titleElement) {
          this.titleElement.textContent = conversation.title || "New Conversation";
        }
        this._updateURLWithConversationId(conversation.id);
        console.log(`[ChatManager] New conversation created: ${conversation.id}`);
        return conversation;
      } catch (error) {
        this._handleError("creating conversation", error);
        projectDetailsComponent?.disableChatUI?.("Chat error: " + (error.message || error));
        throw error;
      }
    }

    /**
     * Queued message send. Displays user message, awaits assistant reply.
     * @param {string} messageText
     */
    async sendMessage(messageText) {
      if (!messageText?.trim()) return;
      return this.messageQueue.add(async () => {
        if (!isAuthenticated()) {
          app?.showNotification("Please log in to send messages", "error");
          return;
        }
        if (!isValidProjectId(this.projectId)) {
          const msg = "No valid project. Select a project before sending messages.";
          this._showErrorMessage(msg);
          this._handleError("sending message", msg);
          projectDetailsComponent?.disableChatUI?.("No valid project");
          return;
        }
        if (!this.currentConversationId) {
          try {
            await this.createNewConversation();
          } catch (error) {
            this._handleError("creating conversation", error);
            projectDetailsComponent?.disableChatUI?.("Chat error: " + (error.message || error));
            return;
          }
        }

        // Show user message
        this._showMessage("user", messageText);
        this._clearInputField();
        this._showThinkingIndicator();

        try {
          const response = await this._sendMessageToAPI(messageText);
          this._processAssistantResponse(response);
          return response.data;
        } catch (error) {
          this._hideThinkingIndicator();
          this._showErrorMessage(error.message);
          this._handleError("sending message", error);
          projectDetailsComponent?.disableChatUI?.("Chat error: " + (error.message || error));
        }
      });
    }

    /**
     * Internal method to call the API for sending a user message.
     * @private
     * @param {string} messageText
     */
    async _sendMessageToAPI(messageText) {
      const cfg = getModelConfig().getConfig();
      const payload = {
        content: messageText,
        role: "user",
        type: "message",
        vision_detail: cfg.visionDetail || "auto"
      };
      if (this.currentImage) {
        this._validateImageSize();
        payload.image_data = this.currentImage;
        this.currentImage = null;
      }
      if (cfg.extendedThinking) {
        payload.thinking = {
          type: "enabled",
          budget_tokens: cfg.thinkingBudget
        };
      }
      return this.apiRequest(
        API_ENDPOINTS.MESSAGES(this.projectId, this.currentConversationId),
        { method: "POST", body: payload }
      );
    }

    /**
     * Ensures the attached image is within the max size limit.
     * @private
     */
    _validateImageSize() {
      if (typeof this.currentImage === 'string' && this.currentImage.startsWith("data:")) {
        const commaIdx = this.currentImage.indexOf(',');
        const b64 = commaIdx !== -1 ? this.currentImage.slice(commaIdx + 1) : this.currentImage;
        const sizeBytes = Math.floor((b64.length * 3) / 4);
        if (sizeBytes > CHAT_CONFIG.MAX_IMAGE_SIZE) {
          this._hideThinkingIndicator();
          app?.showNotification(`Image is too large! (max 4MB)`, "error");
          throw new Error("Image size exceeds maximum allowed");
        }
      }
    }

    /**
     * Processes the server's assistant_message response, or shows an error.
     * @private
     * @param {Object} response
     */
    _processAssistantResponse(response) {
      this._hideThinkingIndicator();
      if (response.data?.assistant_message) {
        const { assistant_message, thinking, redacted_thinking } = response.data;
        this._showMessage("assistant",
          assistant_message.content,
          null,
          thinking,
          redacted_thinking
        );
      } else if (response.data?.assistant_error) {
        const errMsg = this._extractErrorMessage(response.data.assistant_error);
        throw new Error(errMsg);
      }
    }

    /**
     * Deletes the current conversation on the server.
     */
    async deleteConversation() {
      if (!this.currentConversationId) return false;
      if (!isAuthenticated()) {
        console.warn("[ChatManager] deleteConversation: not authenticated");
        return false;
      }
      if (!isValidProjectId(this.projectId)) {
        this._handleError("deleting conversation", "Invalid projectId");
        this._showErrorMessage("Cannot delete conversation: invalid project ID.");
        return false;
      }
      try {
        await this.apiRequest(
          API_ENDPOINTS.CONVERSATION(this.projectId, this.currentConversationId),
          { method: "DELETE" }
        );
        this.currentConversationId = null;
        this._clearMessages();
        this._removeConversationIdFromURL();
        return true;
      } catch (error) {
        this._handleError("deleting conversation", error);
        return false;
      }
    }

    /**
     * Not strictly required. If you want to attach an image to the next user message, call this.
     * @param {string} base64Image
     */
    setImage(base64Image) {
      this.currentImage = base64Image;
      // Optionally show a small image preview in the UI...
    }

    /**
     * Updates model config and synchronizes UI bits if present.
     * @param {Object} config
     */
    updateModelConfig(config) {
      getModelConfig().updateConfig(config);
      this.modelConfig = getModelConfig().getConfig();
      // Optionally update DOM elements like modelSelect, visionToggle, etc.
    }

    // ------------------ UI Methods ------------------

    _setupUIElements(options) {
      // Find or create main container
      this.container = document.querySelector(options.containerSelector || "#chatUI") ||
        this._createChatContainer();

      // Force the main container and its parent tab to be visible
      if (this.container) {
        this.container.classList.remove('hidden');
        this.container.style.display = '';
        // Also try to unhide the tab panel if it's in one
        let tabEl = this.container.closest('.project-tab-content');
        if (tabEl) {
          tabEl.classList.remove('hidden');
          tabEl.style.display = '';
        }
      }

      this.messageContainer = document.querySelector(options.messageContainerSelector || "#conversationArea") ||
        this._createMessageContainer();
      if (this.messageContainer) {
        this.messageContainer.classList.remove('hidden');
        this.messageContainer.style.display = '';
      }

      // Input section
      const inputSel = options.inputSelector || "#chatInput";
      this.inputField = document.querySelector(inputSel);

      if (!this.inputField) {
        const inputArea = document.createElement("div");
        inputArea.className = "chat-input-area";
        this.inputField = document.createElement("input");
        this.inputField.id = inputSel.replace("#", "");
        this.inputField.className = "chat-input";
        this.inputField.placeholder = "Type your message...";
        this.sendButton = document.createElement("button");
        this.sendButton.className = "chat-send-button";
        this.sendButton.textContent = "Send";
        inputArea.append(this.inputField, this.sendButton);
        this.container.appendChild(inputArea);
      } else {
        this.inputField.classList.remove('hidden');
        this.inputField.style.display = '';
        this.sendButton = document.querySelector(options.sendButtonSelector || "#sendBtn");
        if (this.sendButton) {
          this.sendButton.classList.remove('hidden');
          this.sendButton.style.display = '';
        }
      }

      // Title (optional)
      this.titleElement = document.querySelector(options.titleSelector || "#chatTitle");
      if (this.titleElement) {
        this.titleElement.classList.remove("hidden");
        this.titleElement.style.display = '';
      }

      // Always rebind events on the latest elements after DOM re-selection
      this._bindEvents();
    }

    _createChatContainer() {
      const container = document.createElement("div");
      container.id = "chatUI";
      container.className = "chat-container";
      (document.body).appendChild(container);
      return container;
    }

    _createMessageContainer() {
      const container = document.createElement("div");
      container.id = "conversationArea";
      this.container.appendChild(container);
      return container;
    }

    _bindEvents() {
      const trackListener = eventHandlers?.trackListener || ((el, ev, fn) => el.addEventListener(ev, fn));
      if (this.inputField) {
        trackListener(this.inputField, "keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage(this.inputField.value);
          }
        });
      }
      if (this.sendButton) {
        trackListener(this.sendButton, "click", () => {
          this.sendMessage(this.inputField.value);
        });
      }

      // Listen for "regenerateChat" event if you want a special re-gen path:
      trackListener(document, "regenerateChat", () => {
        if (!this.currentConversationId) return;
        const userMessages = Array.from(this.messageContainer.querySelectorAll(".user-message"));
        if (userMessages.length === 0) return;
        const lastUserMessage = userMessages[userMessages.length - 1];
        const messageText = lastUserMessage.querySelector(".message-content")?.textContent;
        if (messageText) {
          // remove last assistant response and re-send
          const assistantMsgs = Array.from(this.messageContainer.querySelectorAll(".assistant-message"));
          if (assistantMsgs.length > 0) assistantMsgs[assistantMsgs.length - 1].remove();
          this.sendMessage(messageText);
        }
      });

      // Listen for "modelConfigChanged" if you want to sync external UI changes:
      trackListener(document, "modelConfigChanged", (e) => {
        if (e.detail) this.updateModelConfig(e.detail);
      });
    }

    _showMessage(role, content, id = null, thinking = null, redactedThinking = false) {
      if (!this.messageContainer) return;
      const message = document.createElement("div");
      message.className = `message ${role}-message`;
      if (id) message.id = id;

      const header = document.createElement("div");
      header.className = "message-header";
      header.innerHTML = `
        <span class="message-role">${role === "assistant" ? "Claude" : role === "user" ? "You" : "System"}</span>
        <span class="message-time">${new Date().toLocaleTimeString()}</span>
      `;

      const contentEl = document.createElement("div");
      contentEl.className = "message-content";
      contentEl.innerHTML = DOMPurify.sanitize(content || "", {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'br', 'p']
      });

      message.append(header, contentEl);

      if (thinking || redactedThinking) {
        message.appendChild(this._createThinkingBlock(thinking, redactedThinking));
      }

      this.messageContainer.appendChild(message);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

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
        content.innerHTML = DOMPurify.sanitize(thinking);
      } else if (redacted) {
        content.innerHTML = `
          <div class="redacted-notice">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2
               12s4.48 10 10 10 10-4.48 10-10S17.52
               2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
            </svg>
            <span>Some reasoning was redacted for safety reasons</span>
          </div>
        `;
      }

      toggle.addEventListener("click", () => {
        content.classList.toggle("hidden");
        const chevron = toggle.querySelector(".thinking-chevron");
        const span = toggle.querySelector("span");
        if (content.classList.contains("hidden")) {
          span.textContent = thinking ? "Show detailed reasoning" : "Show safety notice";
          if (chevron) chevron.style.transform = "";
        } else {
          span.textContent = thinking ? "Hide detailed reasoning" : "Hide safety notice";
          if (chevron) chevron.style.transform = "rotate(180deg)";
        }
      });

      container.append(toggle, content);
      return container;
    }

    _clearInputField() {
      if (this.inputField) {
        this.inputField.value = "";
        this.inputField.focus();
      }
    }

    _updateURLWithConversationId(conversationId) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("chatId") !== conversationId) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("chatId", conversationId);
        window.history.pushState({}, "", newUrl.toString());
      }
    }

    _removeConversationIdFromURL() {
      const urlParams = new URLSearchParams(window.location.search);
      urlParams.delete("chatId");
      window.history.pushState(
        {},
        "",
        `${window.location.pathname}${urlParams.toString() ? `?${urlParams}` : ""}`
      );
    }

    _showLoadingIndicator() {
      if (!this.messageContainer) return;
      const indicator = document.createElement("div");
      indicator.id = "chatLoadingIndicator";
      indicator.className = "loading-indicator";
      indicator.innerHTML = `
        <div class="loading-spinner"></div>
        <span>Loading conversation...</span>
      `;
      this.messageContainer.appendChild(indicator);
    }

    _hideLoadingIndicator() {
      document.getElementById("chatLoadingIndicator")?.remove();
    }

    _showThinkingIndicator() {
      if (!this.messageContainer) return;
      const indicator = document.createElement("div");
      indicator.id = "thinkingIndicator";
      indicator.className = "thinking-indicator";
      indicator.innerHTML = `
        <div class="thinking-dots">
          <span></span><span></span><span></span>
        </div>
        <span>Claude is thinking...</span>
      `;
      this.messageContainer.appendChild(indicator);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    _hideThinkingIndicator() {
      document.getElementById("thinkingIndicator")?.remove();
    }

    /**
     * Renders an error message block in the chat UI.
     * @private
     * @param {string} message
     */
    _showErrorMessage(message) {
      if (!this.messageContainer) return;
      const errorEl = document.createElement("div");
      errorEl.className = "error-message";
      errorEl.innerHTML = `
        <div class="error-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2
             12s4.48 10 10 10 10-4.48 10-10S17.52 2
             12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
          </svg>
        </div>
        <div class="error-content">
          <h4>Error</h4>
          <p>${DOMPurify.sanitize(message)}</p>
        </div>
      `;
      this.messageContainer.appendChild(errorEl);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    _clearMessages() {
      this.messageContainer?.replaceChildren();
    }

    _renderMessages(messages) {
      this._clearMessages();
      if (!messages?.length) {
        this._showMessage("system", "No messages yet");
        return;
      }
      messages.forEach((msg) => {
        this._showMessage(
          msg.role,
          msg.content,
          msg.id,
          msg.thinking,
          msg.redacted_thinking
        );
      });
    }

    _extractErrorMessage(error) {
      if (!error) return "Unknown error occurred";
      if (typeof error === "string") return error;
      if (error.message) return error.message;
      if (typeof error === "object") {
        try {
          return JSON.stringify(error);
        } catch {
          return "Unknown error object";
        }
      }
      return String(error);
    }

    _handleError(context, error) {
      const message = this._extractErrorMessage(error);
      console.error(`[ChatManager - ${context}]`, error);
      app?.showNotification?.(message, "error");
    }
  }

  // Return a new ChatManager instance
  return new ChatManager();
}

export default createChatManager;
