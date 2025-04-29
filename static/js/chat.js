/**
 * chat.js
 * Modular ChatManager: export as createChatManager(), uses centralized state via DependencySystem.
 */

import { isValidProjectId, getCurrentProjectId } from './projectManager.js';

const CHAT_CONFIG = {
  DEFAULT_MODEL: "claude-3-sonnet-20240229",
  MAX_TOKENS: 4096,
  THINKING_BUDGET: 16000,
  REASONING_EFFORT: "medium"
};

/**
 * Factory function for ChatManager.
 * Uses DependencySystem ('app', 'modelConfig'), no globals attached!
 */
export function createChatManager() {
  // ---- HELPER: Get centralized modelConfig ----
  function getModelConfig() {
    if (window.DependencySystem?.modules?.has('modelConfig')) {
      return window.DependencySystem.modules.get('modelConfig');
    }
    return {
      getConfig: () => ({}),
      updateConfig: () => {},
      getModelOptions: () => [],
      onConfigChange: () => {}
    };
  }
  // ---- HELPER: Check for centralized authentication ----
  function isAuthenticated() {
    if (window.DependencySystem?.modules?.has("app")) {
      return !!window.DependencySystem.modules.get("app").state.isAuthenticated;
    }
    if (window.app?.state?.isAuthenticated != null) return window.app.state.isAuthenticated;
    // Fallback for legacy (should always use centralized)
    if (window.auth?.isAuthenticated) return window.auth.isAuthenticated();
    return false;
  }

  class ChatManager {
    constructor() {
      this.currentConversationId = null;
      this.projectId = null;
      this.isInitialized = false;
      this.isLoading = false;
      this.currentImage = null;

      this.container = null;
      this.messageContainer = null;
      this.inputField = null;
      this.sendButton = null;
      this.titleElement = null;

      this._eventHandlers = {};
      this.modelConfig = getModelConfig().getConfig();

      // Backwards compatibility alias
      this.createConversation = (...args) => this.createNewConversation(...args);
    }

    _isValidProjectId(id) {
      return isValidProjectId(id);
    }

    async initialize(options = {}) {
      // Always get a valid projectId: options.projectId > getCurrentProjectId() > error
      let projectId =
        (options.projectId && isValidProjectId(options.projectId))
          ? options.projectId
          : getCurrentProjectId();
      this.projectId = projectId;

      // Defensive: Validate project ID before any chat action can initialize
      if (!this._isValidProjectId(this.projectId)) {
        const msg = "[Chat] Project ID required before initializing chat.";
        this._showErrorMessage(msg);
        this._handleError("initialization", msg);
        // Optionally, disable chat UI here globally if helper exists:
        if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
          window.projectDetailsComponent.disableChatUI("Chat unavailable: project not loaded.");
        }
        throw new Error(msg);
      }
      if (this.isInitialized) {
        console.warn("[Chat] System already initialized");
        return true;
      }
      console.log("[Chat] Initializing chat system with projectId:", this.projectId);
      try {
        if (!isAuthenticated()) {
          throw new Error("User not authenticated");
        }
        this._setupUIElements(options);
        this._bindEvents();

        // Attempt to create a new conversation if none exists
        try {
          await this.createNewConversation();
        } catch (convError) {
          // Enhanced diagnostics for backend errors
          console.error("[Chat] Failed to create default conversation:", convError);
          this._showErrorMessage(
            "Could not create a new conversation. Please check your project configuration or contact support."
          );
        }
        this.isInitialized = true;
      } catch (error) {
        this._handleError("initialization", error);
        // Optionally, disable chat UI here as well
        if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
          window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
        }
        throw error;
      }
    }

    async loadConversation(conversationId) {
      if (!conversationId) {
        console.error("[Chat] Invalid conversation ID given to loadConversation");
        return false;
      }
      if (!isAuthenticated()) {
        console.warn("[Chat] loadConversation called but user not authenticated");
        return false;
      }
      if (!this._isValidProjectId(this.projectId)) {
        this._handleError("loading conversation", "[Chat] Project ID is invalid or missing.");
        this._showErrorMessage("Cannot load conversation: Project is not loaded or ID is invalid.");
        return false;
      }
      if (this.isLoading) {
        console.warn("[Chat] Loading already in progress");
        return false;
      }
      this.isLoading = true;
      this._showLoadingIndicator();
      try {
        this._clearMessages();
        const endpoint = `/api/projects/${this.projectId}/conversations/${conversationId}/`;
        const conversation = await window.app.apiRequest(endpoint, { method: "GET" });

        const messagesEndpoint = `/api/projects/${this.projectId}/conversations/${conversationId}/messages/`;
        const messagesResponse = await window.app.apiRequest(messagesEndpoint, { method: "GET" });
        const messages = messagesResponse.data?.messages || [];

        this.currentConversationId = conversationId;
        if (this.titleElement)
          this.titleElement.textContent = conversation.title || "New Conversation";
        this._renderMessages(messages);

        // Update the conversation list in the sidebar using the central UI renderer
        if (window.uiRenderer && typeof window.uiRenderer.renderConversations === "function") {
          // Ensure window.chatConfig is up-to-date for uiRenderer
          window.chatConfig = window.chatConfig || {};
          if (Array.isArray(window.chatConfig.conversations)) {
            // Try to update the title of the current conversation in the list for consistency
            window.chatConfig.conversations = window.chatConfig.conversations.map(conv =>
              conv.id === conversationId ? { ...conv, title: conversation.title } : conv
            );
          }
          window.uiRenderer.renderConversations(window.chatConfig);
        }

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

    async createNewConversation(projectId = null) {
      // Always use passed explicit ID if valid, else prefer stable getter
      let idToUse = isValidProjectId(projectId)
        ? projectId
        : getCurrentProjectId();
      this.projectId = idToUse;

      if (!isAuthenticated()) {
        console.warn("[Chat] User not authenticated, cannot create conversation");
        throw new Error("Not authenticated");
      }
      if (!this._isValidProjectId(this.projectId)) {
        const msg = "[Chat] Project ID is required to create a conversation";
        this._showErrorMessage(msg);
        this._handleError("creating conversation", msg);
        if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
          window.projectDetailsComponent.disableChatUI("Chat unavailable: project not loaded.");
        }
        throw new Error(msg);
      }
      this._clearMessages();
      try {
        const endpoint = `/api/projects/${this.projectId}/conversations/`;
        const config = getModelConfig().getConfig();
        const payload = {
          title: `New Chat ${new Date().toLocaleString()}`,
          model_id: config.modelName || CHAT_CONFIG.DEFAULT_MODEL
        };
        const response = await window.app.apiRequest(endpoint, { method: "POST", body: payload });
        const conversation =
          response?.data?.conversation ||
          response?.data ||
          response?.conversation ||
          response;
        if (!conversation || !conversation.id) throw new Error("[Chat] Invalid response from server creating conversation");
        this.currentConversationId = conversation.id;
        if (this.titleElement) this.titleElement.textContent = conversation.title || "New Conversation";
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set("chatId", conversation.id);
        window.history.pushState({}, "", newUrl.toString());
        console.log(`[Chat] New conversation created: ${conversation.id}`);
        return conversation;
      } catch (error) {
        this._handleError("creating conversation", error);
        if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
          window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
        }
        throw error;
      }
    }

    async sendMessage(messageText) {
      if (!messageText.trim()) return;
      if (!isAuthenticated()) {
        window.app?.showNotification?.("Please log in to send messages", "error");
        return;
      }
      // Always use DRY getter for projectId check
      if (!this._isValidProjectId(this.projectId)) {
        const msg = "No valid project loaded. Please select a valid project before sending messages.";
        this._showErrorMessage(msg);
        this._handleError("sending message", msg);
        if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
          window.projectDetailsComponent.disableChatUI("Chat unavailable: project not loaded.");
        }
        return;
      }
      if (!this.currentConversationId) {
        try {
          await this.createNewConversation();
        } catch (error) {
          this._handleError("creating conversation", error);
          if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
            window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
          }
          return;
        }
      }
      this._showMessage("user", messageText);

      if (this.inputField) {
        this.inputField.value = "";
        this.inputField.focus();
      }
      this._showThinkingIndicator();

      try {
        const modelConfig = getModelConfig().getConfig();
        const messagePayload = {
          content: messageText,
          role: "user",
          type: "message",
          vision_detail: modelConfig.visionDetail || "auto"
        };
        if (this.currentImage) {
          let imgData = this.currentImage;
          if (typeof imgData === "string" && imgData.startsWith("data:")) {
            const commaIdx = imgData.indexOf(',');
            const b64 = commaIdx !== -1 ? imgData.slice(commaIdx + 1) : imgData;
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
        if (modelConfig.extendedThinking) {
          messagePayload.thinking = {
            type: "enabled",
            budget_tokens: modelConfig.thinkingBudget
          };
        }
        const endpoint = `/api/projects/${this.projectId}/conversations/${this.currentConversationId}/messages/`;
        const response = await window.app.apiRequest(endpoint, { method: "POST", body: messagePayload });
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
        this._hideThinkingIndicator();
        this._showErrorMessage(error.message);
        this._handleError("sending message", error);
        if (typeof window.projectDetailsComponent?.disableChatUI === "function") {
          window.projectDetailsComponent.disableChatUI("Chat unavailable: " + (error?.message || error));
        }
      }
    }

    async deleteConversation() {
      if (!this.currentConversationId) return false;
      if (!isAuthenticated()) {
        console.warn("[Chat] Cannot delete conversation - not authenticated");
        return false;
      }
      if (!this._isValidProjectId(this.projectId)) {
        this._handleError("deleting conversation", "[Chat] Project ID is invalid or missing.");
        this._showErrorMessage("Cannot delete conversation: Project is not loaded or ID is invalid.");
        return false;
      }
      try {
        const endpoint = `/api/projects/${this.projectId}/conversations/${this.currentConversationId}/`;
        await window.app.apiRequest(endpoint, { method: "DELETE" });
        this.currentConversationId = null;
        this._clearMessages();
        const urlParams = new URLSearchParams(window.location.search);
        urlParams.delete("chatId");
        window.history.pushState(
          {},
          "",
          `${window.location.pathname}${urlParams.toString() ? `?${urlParams}` : ""}`
        );
        return true;
      } catch (error) {
        this._handleError("deleting conversation", error);
        return false;
      }
    }

    setImage(base64Image) {
      this.currentImage = base64Image;
      if (base64Image && this.messageContainer) {
        const userMessages = this.messageContainer.querySelectorAll(".user-message");
        if (userMessages.length > 0) {
          const lastUserMessage = userMessages[userMessages.length - 1];
          const imageIndicator = document.createElement("div");
          imageIndicator.className = "image-indicator";
          imageIndicator.innerHTML = `<img src="${base64Image}" alt="Attached image" class="preview-image" /><span>Image attached</span>`;
          lastUserMessage.appendChild(imageIndicator);
        }
      }
    }

    updateModelConfig(config) {
      getModelConfig().updateConfig(config);
      this.modelConfig = getModelConfig().getConfig();
      const modelSelect = document.getElementById("modelSelect");
      if (modelSelect && this.modelConfig.modelName) modelSelect.value = this.modelConfig.modelName;
      const visionToggle = document.getElementById("visionToggle");
      if (visionToggle && this.modelConfig.visionEnabled !== undefined) visionToggle.checked = this.modelConfig.visionEnabled;
      const tokensDisplay = document.getElementById("maxTokensValue");
      if (tokensDisplay && this.modelConfig.maxTokens) tokensDisplay.textContent = `${this.modelConfig.maxTokens} tokens`;
    }

    // ==== UI and Private helpers ====
    _setupUIElements(options) {
      const containerSelector = options.containerSelector || "#chatUI";
      this.container = document.querySelector(containerSelector);
      if (!this.container) {
        console.warn(`[Chat] Container not found: ${containerSelector}`);
        this.container = this._createChatContainer();
      }
      const messageSelector = options.messageContainerSelector || "#conversationArea";
      this.messageContainer = document.querySelector(messageSelector);
      if (!this.messageContainer) {
        this.messageContainer = document.createElement("div");
        this.messageContainer.id = messageSelector.replace("#", "");
        this.container.appendChild(this.messageContainer);
      }
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
        this.sendButton = document.querySelector(options.sendButtonSelector || "#sendBtn");
      }
      this.titleElement = document.querySelector(options.titleSelector || "#chatTitle");
      const editBtn = document.getElementById("chatTitleEditBtn");
      if (this.titleElement) this.titleElement.classList.remove("hidden");
      if (editBtn) editBtn.classList.remove("hidden");
      if (window.initChatExtensions) window.initChatExtensions();
    }

    _createChatContainer() {
      const container = document.createElement("div");
      container.id = "chatUI";
      container.className = "chat-container";
      const main = document.querySelector("main") || document.body;
      main.appendChild(container);
      return container;
    }

    _bindEvents() {
      const trackListener =
        window.eventHandlers?.trackListener ??
        ((el, type, fn, opts) => { el.addEventListener(type, fn, opts); return fn; });

      if (this.inputField) {
        trackListener(this.inputField, "keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage(this.inputField.value);
          }
        }, { passive: false, description: "Send on Enter" });
      }
      if (this.sendButton) {
        trackListener(this.sendButton, "click", () => {
          this.sendMessage(this.inputField.value);
        });
      }
      trackListener(document, "regenerateChat", () => {
        if (!this.currentConversationId) return;
        const userMessages = Array.from(this.messageContainer.querySelectorAll(".user-message"));
        if (userMessages.length === 0) return;
        const lastUserMessage = userMessages[userMessages.length - 1];
        const messageText = lastUserMessage.querySelector(".message-content")?.textContent;
        if (messageText) {
          // Remove last assistant message
          const assistantMessages = Array.from(this.messageContainer.querySelectorAll(".assistant-message"));
          if (assistantMessages.length > 0) assistantMessages[assistantMessages.length - 1].remove();
          this.sendMessage(messageText);
        }
      }, { description: "Regenerate chat message" });
      trackListener(document, "modelConfigChanged", (e) => {
        if (e.detail) this.updateModelConfig(e.detail);
      });
    }

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

      if (thinking || redactedThinking) {
        const thinkingContainer = this._createThinkingBlock(thinking, redactedThinking);
        message.appendChild(thinkingContainer);
      }

      this.messageContainer.appendChild(message);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    _sanitizeHtml(unsafe) {
      if (!unsafe) return "";
      const div = document.createElement("div");
      div.textContent = unsafe;
      return div.innerHTML;
    }

    _formatText(text) {
      if (!text) return "";
      const sanitized = this._sanitizeHtml(text);
      return window.formatText ? window.formatText(sanitized) : sanitized;
    }

    _createThinkingBlock(thinking, redacted) {
      const container = document.createElement("div");
      container.className = "thinking-container";
      const toggle = document.createElement("button");
      toggle.className = "thinking-toggle";
      toggle.innerHTML = `
        <svg class="thinking-chevron" viewBox="0 0 24 24"><path d="M19 9l-7 7-7-7"></path></svg>
        <span>${thinking ? "Show detailed reasoning" : "Safety notice"}</span>
      `;
      const content = document.createElement("div");
      content.className = "thinking-content hidden";
      if (thinking) {
        content.innerHTML = this._formatText(thinking);
      } else if (redacted) {
        content.innerHTML = `
          <div class="redacted-notice">
            <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path></svg>
            <span>Some reasoning was redacted for safety reasons</span>
          </div>
        `;
      }
      toggle.addEventListener("click", () => {
        content.classList.toggle("hidden");
        const chevron = toggle.querySelector(".thinking-chevron");
        if (content.classList.contains("hidden")) {
          toggle.querySelector("span").textContent = thinking ? "Show detailed reasoning" : "Show safety notice";
          if (chevron) chevron.style.transform = "";
        } else {
          toggle.querySelector("span").textContent = thinking ? "Hide detailed reasoning" : "Hide safety notice";
          if (chevron) chevron.style.transform = "rotate(180deg)";
        }
      });
      container.appendChild(toggle);
      container.appendChild(content);
      return container;
    }

    _showLoadingIndicator() {
      if (!this.messageContainer) return;
      const loadingIndicator = document.createElement("div");
      loadingIndicator.id = "chatLoadingIndicator";
      loadingIndicator.className = "loading-indicator";
      loadingIndicator.innerHTML = `<div class="loading-spinner"></div><span>Loading conversation...</span>`;
      this.messageContainer.appendChild(loadingIndicator);
    }
    _hideLoadingIndicator() {
      const indicator = document.getElementById("chatLoadingIndicator");
      if (indicator) indicator.remove();
    }
    _showThinkingIndicator() {
      if (!this.messageContainer) return;
      const thinkingIndicator = document.createElement("div");
      thinkingIndicator.id = "thinkingIndicator";
      thinkingIndicator.className = "thinking-indicator";
      thinkingIndicator.innerHTML = `
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>Claude is thinking...</span>
      `;
      this.messageContainer.appendChild(thinkingIndicator);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
    _hideThinkingIndicator() {
      const indicator = document.getElementById("thinkingIndicator");
      if (indicator) indicator.remove();
    }
    _showErrorMessage(message) {
      if (!this.messageContainer) return;
      const errorEl = document.createElement("div");
      errorEl.className = "error-message";
      errorEl.innerHTML = `
        <div class="error-icon">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path></svg>
        </div>
        <div class="error-content"><h4>Error</h4><p>${message}</p></div>
      `;
      this.messageContainer.appendChild(errorEl);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
    _clearMessages() {
      if (this.messageContainer) this.messageContainer.innerHTML = "";
    }
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

    // _getProjectId() no longer used. Use getCurrentProjectId() from projectManager.js everywhere!
    _extractErrorMessage(error) {
      if (!error) return "Unknown error occurred";
      if (typeof error === "string") return error;
      if (error.message) return error.message;
      if (typeof error === "object") {
        try { return JSON.stringify(error); } catch (e) { return "Unknown error object"; }
      }
      return String(error);
    }
    _handleError(context, error) {
      const message = this._extractErrorMessage(error);
      console.error(`[Chat - ${context}]`, error);
      if (window.app?.showNotification) {
        window.app.showNotification(message, "error");
      }
    }
    // Optional backward compatibility: alias createConversation for legacy callers
    // (Removed duplicate constructor)
  } // end ChatManager class

  // Return modular instance, registration and window assignment handled in app.js
  return new ChatManager();
}
