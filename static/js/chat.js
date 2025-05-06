/**
 * chat.js (Strict DI, Linted Edition)
 *
 * Usage:
 *   import { createChatManager } from './chat.js';
 *
 *   const chatManager = createChatManager({
 *     apiRequest,
 *     app,
 *     eventHandlers,
 *     modelConfig,
 *     projectDetailsComponent,
 *     isValidProjectId,
 *     isAuthenticated,
 *     domAPI,
 *     navAPI,
 *     DOMPurify,
 *     notificationHandler
 *   });
 *   await chatManager.initialize({ projectId: '123' });
 *   chatManager.cleanup();
 */

/**
 * @typedef {Object} DomAPI
 * @property {function(string): HTMLElement|null} querySelector
 * @property {function(string): HTMLElement|null} getElementById
 * @property {function(string): NodeListOf<HTMLElement>} querySelectorAll
 * @property {function(HTMLElement, HTMLElement): void} appendChild
 * @property {function(HTMLElement): HTMLElement[]} replaceChildren
 * @property {function(string): HTMLElement} createElement
 * @property {function(HTMLElement, string): void} removeChild
 * @property {function(HTMLElement, string): void} setInnerHTML
 */

/**
 * @typedef {Object} NavAPI
 * @property {function(): string} getSearch
 * @property {function(): string} getHref
 * @property {function(url: string): void} pushState
 * @property {function(): string} getPathname
 */

/**
 * @typedef {Object} EventHandlers
 * @property {function(HTMLElement, string, Function, Object=): any} trackListener
 * @property {function(HTMLElement, string, any): void} untrackListener
 */

/**
 * Default no-op DomAPI fallback if none provided.
 */
function createDefaultDomAPI() {
  throw new Error("[ChatManager] No domAPI provided. All DOM operations must be injected.");
}

/**
 * Default no-op NavAPI fallback if none provided.
 */
function createDefaultNavAPI() {
  throw new Error("[ChatManager] No navAPI provided. All navigation operations must be injected.");
}

/**
 * Default no-op eventHandlers if none provided.
 */
function createDefaultEventHandlers() {
  function trackListener() {
    throw new Error("[ChatManager] No eventHandlers.trackListener provided.");
  }
  function untrackListener() {
    throw new Error("[ChatManager] No eventHandlers.untrackListener provided.");
  }
  return { trackListener, untrackListener };
}

/**
 * Returns the injected modelConfig or a stub if unavailable.
 */
function getInjectedModelConfig(modelConfig) {
  if (modelConfig) return modelConfig;
  return {
    getConfig: () => ({}),
    updateConfig: () => { },
    getModelOptions: () => [],
    onConfigChange: () => { }
  };
}


/**
 * Defaults for chat if modelConfig is not provided or incomplete.
 */
const CHAT_CONFIG = {
  DEFAULT_MODEL: "claude-3-sonnet-20240229",
  MAX_TOKENS: 4096,
  THINKING_BUDGET: 16000,
  REASONING_EFFORT: "medium",
  MAX_IMAGE_SIZE: 4 * 1024 * 1024 // 4MB
};

/**
 * Simple queue to enforce sequential message sending.
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
 * Factory function for the ChatManager, with Strict DI approach.
 * @param {Object} options
 * @param {Function} options.apiRequest - Required (async for HTTP requests).
 * @param {Object} options.app - Required (has showNotification, etc.).
 * @param {EventHandlers} [options.eventHandlers] - For event tracking/untracking.
 * @param {Object} [options.modelConfig] - Model config manager with getConfig, updateConfig, etc.
 * @param {Object} [options.projectDetailsComponent] - Optional for broader UI integration (enable/disable chat).
 * @param {Function} options.isValidProjectId - Required ID validator.
 * @param {Function} options.isAuthenticated - Required auth checker.
 * @param {DomAPI} [options.domAPI] - DOM abstraction. No direct document usage.
 * @param {NavAPI} [options.navAPI] - Navigation / history abstraction. No direct window usage.
 * @param {Object} [options.DOMPurify] - Must be provided.
 * @param {Function} [options.notificationHandler] - For all user/dev notifications.
 * @returns {ChatManager} An instance with initialize, sendMessage, etc.
 */
export function createChatManager({
  apiRequest,
  app,
  eventHandlers,
  modelConfig,
  projectDetailsComponent,
  isValidProjectId,
  isAuthenticated,
  domAPI,
  navAPI,
  DOMPurify,
  notificationHandler,
  apiEndpoints
} = {}) {
  // Basic validation
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] START createChatManager');
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Checking apiRequest:', typeof apiRequest);
  if (typeof apiRequest !== 'function') {
    throw new Error("[ChatManager] 'apiRequest' must be a function.");
  }
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Checking app:', typeof app, !!app);
  if (!app) {
    throw new Error("[ChatManager] 'app' is required; provide at least showNotification().");
  }
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Checking isValidProjectId:', typeof isValidProjectId);
  console.log('[ChatManager Debug] Checking isAuthenticated:', typeof isAuthenticated);
  if (typeof isValidProjectId !== 'function' || typeof isAuthenticated !== 'function') {
    throw new Error("[ChatManager] 'isValidProjectId' and 'isAuthenticated' must be functions.");
  }
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Checking DOMPurify:', typeof DOMPurify, !!DOMPurify);
  if (!DOMPurify) {
    throw new Error("[ChatManager] DOMPurify must be provided via DI.");
  }
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Checking apiEndpoints:', typeof apiEndpoints, !!apiEndpoints);
  if (!apiEndpoints) {
    throw new Error("[ChatManager] 'apiEndpoints' must be provided via DI.");
  }

  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Basic validation passed.');

  // Provide fallback DOM, Nav, and event handlers if not supplied
  const _domAPI = domAPI || createDefaultDomAPI();
  const _navAPI = navAPI || createDefaultNavAPI();
  const _EH = eventHandlers || createDefaultEventHandlers();

  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Fallbacks created/assigned.');

  // Notification handler: prefer injected, then app.showNotification, else throw
  // Unified notification: always inject grouping/context for chatManager
  const notify = notificationHandler
    ? ((msg, type = "info", ...args) => {
        // Find or merge options into last arg (handler interface)
        let opts = {};
        if (
          args.length &&
          typeof args[args.length - 1] === "object" &&
          args[args.length - 1] !== null &&
          !Array.isArray(args[args.length - 1])
        ) {
          opts = { ...args.pop(), group: true, context: "chatManager" };
        } else {
          opts = { group: true, context: "chatManager" };
        }
        // Try handler.show for showNotification-like API
        if (typeof notificationHandler.show === "function") {
          return notificationHandler.show(msg, type, opts);
        }
        // Try handler[type] for log/warn/error
        if (typeof notificationHandler[type] === "function") {
          return notificationHandler[type](msg, ...(args.length > 0 ? args : [opts]));
        }
        // Fallback: call as a function in case handler itself is callable
        if (typeof notificationHandler === "function") {
          return notificationHandler.show(msg, type, opts);
        }
      })
    : ((msg, type = "info", ...args) => {
        // Ensure 4th arg to showNotification is always options with group/context
        let duration = undefined;
        let options = {};
        if (args.length && typeof args[0] === "number") {
          duration = args.shift();
        }
        if (
          args.length &&
          typeof args[args.length - 1] === "object" &&
          args[args.length - 1] !== null &&
          !Array.isArray(args[args.length - 1])
        ) {
          options = { ...args.pop(), group: true, context: "chatManager" };
        } else {
          options = { group: true, context: "chatManager" };
        }
        if (typeof app.showNotification === "function") {
          app.showNotification(msg, type, duration, options);
        } else {
          throw new Error(`[ChatManager] Notification: ${msg}`);
        }
      });

  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Notify function configured.');

  /**
   * The main ChatManager class, constructed with all DI references enclosed.
   */
  class ChatManager {
    constructor() {
      // ADD LOGGING HERE
      console.log('[ChatManager Debug] START ChatManager constructor');
      this.apiRequest = apiRequest;
      this.app = app;
      this.modelConfigAPI = getInjectedModelConfig(modelConfig);
      this.domAPI = _domAPI;
      this.navAPI = _navAPI;
      this.eventHandlers = _EH;
      this.projectDetails = projectDetailsComponent;
      this.isValidProjectId = isValidProjectId;
      this.isAuthenticated = isAuthenticated;
      this.DOMPurify = DOMPurify;
      this.notify = notify;

      this.projectId = null;
      this.currentConversationId = null;
      this.isInitialized = false;
      this.isLoading = false;
      this.isGlobalMode = false;
      this.currentImage = null;
      this.loadPromise = null;
      this.currentRequestId = 0;
      this.messageQueue = new MessageQueue();

      // UI references
      this.container = null;
      this.messageContainer = null;
      this.inputField = null;
      this.sendButton = null;
      this.titleElement = null;

      // Local copy of the model config
      this.modelConfig = this.modelConfigAPI.getConfig();

      // Track event listeners for cleanup
      this._listeners = [];
      // ADD LOGGING HERE
      console.log('[ChatManager Debug] END ChatManager constructor');
    }

    /**
     * Initialize the chat manager with optional UI selectors or overrides.
     * @param {Object} [options={}]
     * @param {string} [options.projectId]
     * @param {string} [options.containerSelector]
     * @param {string} [options.messageContainerSelector]
     * @param {string} [options.inputSelector]
     * @param {string} [options.sendButtonSelector]
     * @param {string} [options.titleSelector]
     */
    async initialize(options = {}) {
      const _initStart = performance.now();
      this.notify(`[ChatManager] initialize() called`, "debug", { phase: "init", options, timestamp: _initStart });
      const requestedProjectId = options.projectId && this.isValidProjectId(options.projectId)
        ? options.projectId
        : null;

      if (this.isInitialized && this.projectId === requestedProjectId) {
        this.notify(`[ChatManager] Already initialized for project ${requestedProjectId}. Re-binding UI...`, "warn", { phase: "init", projectId: requestedProjectId });
        this._setupUIElements(options);
        this._bindEvents();
        this.notify(`[ChatManager] initialize (rebinding) completed`, "debug", { phase: "init", ms: (performance.now() - _initStart).toFixed(2) });
        return true;
      }

      // If switching or first load:
      const previousProjectId = this.projectId;
      this.projectId = requestedProjectId;
      this.isGlobalMode = !this.isValidProjectId(this.projectId);

      if (this.isInitialized && previousProjectId !== requestedProjectId) {
        this.notify(`[ChatManager] Switching to new project: ${requestedProjectId}`, "info", { from: previousProjectId, phase: "init" });
        // Reset relevant state
        this.isInitialized = false;
        this.currentConversationId = null;
        this.loadPromise = null;
        this.isLoading = false;
        this._clearMessages();
      }

      if (!this.isAuthenticated()) {
        const msg = "[ChatManager] User not authenticated.";
        this._showErrorMessage(msg);
        this._handleError("initialization", msg);
        this.notify(msg, "error", { phase: "init", timestamp: performance.now() });
        this.projectDetails?.disableChatUI?.("Not authenticated");
        throw new Error(msg);
      }

      this._setupUIElements(options);
      this._bindEvents();

      if (this.isGlobalMode) {
        this.notify("[ChatManager] Starting in global (no-project) mode.", "info", { phase: "init" });
        this._clearMessages();
        this._showMessage("system", "Select a project or start a new global chat.");
        this.isInitialized = true;
        this.notify(`[ChatManager] initialize complete (global mode)`, "debug", { phase: "init", ms: (performance.now() - _initStart).toFixed(2) });
        return true;
      }

      this.notify(`[ChatManager] Initializing for projectId: ${this.projectId}`, "info", { phase: "init", timestamp: performance.now() });
      try {
        const urlParams = new URLSearchParams(this.navAPI.getSearch());
        const urlChatId = urlParams.get('chatId');
        if (urlChatId) {
          this.notify(`[ChatManager] Found chatId=${urlChatId} in URL, loading conversation...`, "info", { phase: "init", chatId: urlChatId });
          this.loadConversation(urlChatId).catch(loadErr => {
              this._handleError("initialization (load from URL)", loadErr);
              this._clearMessages();
              this._showMessage("system", "Failed to load chat from URL.");
              this.notify(`[ChatManager] loadConversation FAILED`, "error", { phase: "init", chatId: urlChatId, error: loadErr?.message, stack: loadErr?.stack });
          });
        } else {
          this.notify(`[ChatManager] No chatId in URL. Ready for new chat or selection.`, "info", { phase: "init" });
          this._clearMessages();
        }
        this.isInitialized = true;
        this.notify(`[ChatManager] initialize complete (project mode)`, "debug", { phase: "init", ms: (performance.now() - _initStart).toFixed(2) });
        return true;
      } catch (error) {
        this._handleError("initialization (sync setup)", error);
        this.projectDetails?.disableChatUI?.("Chat setup error: " + (error.message || error));
        this.notify(`[ChatManager] initialize threw sync error`, "error", { phase: "init", error: error?.message, stack: error?.stack });
        throw error;
      }
    }

    /**
     * Cleanup method to remove all tracked event listeners, etc.
     */
    cleanup() {
      for (const { element, event, handler, options } of this._listeners) {
        this.eventHandlers.untrackListener(element, event, handler, options);
      }
      this._listeners = [];
      this.isInitialized = false;
      this.currentConversationId = null;
      this.projectId = null;
      this.isGlobalMode = false;
      this._clearMessages();
    }

    /**
     * Loads an existing conversation by ID.
     * @param {string} conversationId
     */
    async loadConversation(conversationId) {
      const _loadStart = performance.now();
      this.notify(`[ChatManager] loadConversation called for conversationId=${conversationId}`, "debug", { phase: "loadConversation", projectId: this.projectId, conversationId, timestamp: _loadStart });
      if (!conversationId) {
        this.notify("[ChatManager] Invalid conversationId", "error", { phase: "loadConversation" });
        return false;
      }
      if (!this.isAuthenticated()) {
        this.notify("[ChatManager] loadConversation: not authenticated", "warn", { phase: "loadConversation" });
        return false;
      }
      if (!this.isValidProjectId(this.projectId)) {
        this._handleError("loading conversation", "No valid projectId set");
        this._showErrorMessage("Cannot load conversation: invalid/missing project ID.");
        this.notify("[ChatManager] loadConversation aborted: invalid/missing projectId", "error", { phase: "loadConversation" });
        return false;
      }

      const requestId = ++this.currentRequestId;
      if (this.loadPromise) {
        this.notify("[ChatManager] Already loading; awaiting existing loadPromise.", "warn", { phase: "loadConversation" });
        const result = await this.loadPromise;
        this.notify(`[ChatManager] Awaited previous loadPromise, returning result (${result})`, "debug", { phase: "loadConversation" });
        return requestId === this.currentRequestId ? result : false;
      }

      this.isLoading = true;
      this._showLoadingIndicator();

      this.loadPromise = (async () => {
        try {
          this._clearMessages();

          // Parallel fetch conversation + messages
          const [conversation, messagesResponse] = await Promise.all([
            this.apiRequest(apiEndpoints.CONVERSATION(this.projectId, conversationId), { method: "GET" }),
            this.apiRequest(apiEndpoints.MESSAGES(this.projectId, conversationId), { method: "GET" })
          ]);

          const messages = messagesResponse.data?.messages || [];
          this.currentConversationId = conversationId;
          if (this.titleElement) {
            this.titleElement.textContent = conversation.title || "New Conversation";
          }
          this._renderMessages(messages);
          this._updateURLWithConversationId(conversationId);
          const loadMs = performance.now() - _loadStart;
          this.notify(`[ChatManager] loadConversation complete (conversationId=${conversationId})`, "debug", { phase: "loadConversation", ms: loadMs });
          if (loadMs > 2000) {
            this.notify(`[ChatManager] loadConversation perf warning: took ${loadMs.toFixed(1)} ms`, "warn", { phase: "loadConversation", ms: loadMs });
          }
          return true;
        } catch (error) {
          this._handleError("loading conversation", error);
          this.notify(`[ChatManager] loadConversation error`, "error", { phase: "loadConversation", error: error?.message, stack: error?.stack });
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
     * Creates a new conversation on the server for the current project.
     * @param {string} [overrideProjectId]
     */
    async createNewConversation(overrideProjectId) {
      if (overrideProjectId) {
        this.projectId = this.isValidProjectId(overrideProjectId) ? overrideProjectId : this.projectId;
      }
      if (!this.isAuthenticated()) {
        this.notify("[ChatManager] createNewConversation: not authenticated", "warn");
        throw new Error("Not authenticated");
      }
      if (!this.isValidProjectId(this.projectId)) {
        const msg = "[ChatManager] Invalid or missing projectId; cannot create conversation.";
        this._showErrorMessage(msg);
        this._handleError("creating conversation", msg);
        this.projectDetails?.disableChatUI?.("No valid project");
        throw new Error(msg);
      }

      this._clearMessages();

      try {
        const cfg = this.modelConfigAPI.getConfig();
        const payload = {
          title: `New Chat ${new Date().toLocaleString()}`,
          model_id: cfg.modelName || CHAT_CONFIG.DEFAULT_MODEL
        };
        const response = await this.apiRequest(
          apiEndpoints.CONVERSATIONS(this.projectId),
          { method: "POST", body: payload }
        );

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
          throw new Error("Server response missing conversation ID: " + JSON.stringify(response));
        }

        this.currentConversationId = conversation.id;
        if (this.titleElement) {
          this.titleElement.textContent = conversation.title || "New Conversation";
        }
        this._updateURLWithConversationId(conversation.id);
        this.notify(`[ChatManager] New conversation created: ${conversation.id}`, "info");
        return conversation;
      } catch (error) {
        this._handleError("creating conversation", error);
        this.projectDetails?.disableChatUI?.("Chat error: " + (error.message || error));
        throw error;
      }
    }

    /**
     * Sends a user message (queued) and awaits assistant reply.
     * @param {string} messageText
     */
    async sendMessage(messageText) {
      if (!messageText?.trim()) return;
      return this.messageQueue.add(async () => {
        if (!this.isAuthenticated()) {
          this.notify("Please log in to send messages", "error");
          return;
        }
        if (!this.isValidProjectId(this.projectId)) {
          const msg = "No valid project; select a project before sending messages.";
          this._showErrorMessage(msg);
          this._handleError("sending message", msg);
          this.projectDetails?.disableChatUI?.("No valid project");
          return;
        }
        if (!this.currentConversationId) {
          try {
            await this.createNewConversation();
          } catch (error) {
            this._handleError("creating conversation", error);
            this.projectDetails?.disableChatUI?.("Chat error: " + (error.message || error));
            return;
          }
        }

        // Show user message in UI
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
          this.projectDetails?.disableChatUI?.("Chat error: " + (error.message || error));
        }
      });
    }

    /**
     * Internal method that calls the API for sending a user message.
     * @private
     * @param {string} messageText
     */
    async _sendMessageToAPI(messageText) {
      const cfg = this.modelConfigAPI.getConfig();
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
        apiEndpoints.MESSAGES(this.projectId, this.currentConversationId),
        { method: "POST", body: payload }
      );
    }

    /**
     * Ensure the currently attached image is within size limits.
     * @private
     */
    _validateImageSize() {
      if (typeof this.currentImage === 'string' && this.currentImage.startsWith("data:")) {
        const commaIdx = this.currentImage.indexOf(',');
        const b64 = commaIdx !== -1 ? this.currentImage.slice(commaIdx + 1) : this.currentImage;
        const sizeBytes = Math.floor((b64.length * 3) / 4);
        if (sizeBytes > CHAT_CONFIG.MAX_IMAGE_SIZE) {
          this._hideThinkingIndicator();
          this.notify("Image is too large! (max 4MB)", "error");
          throw new Error("Image size exceeds maximum allowed threshold");
        }
      }
    }

    /**
     * Process the API's assistant response or show an error if missing.
     * @private
     * @param {Object} response
     */
    _processAssistantResponse(response) {
      this._hideThinkingIndicator();
      if (response.data?.assistant_message) {
        const { assistant_message, thinking, redacted_thinking } = response.data;
        this._showMessage(
          "assistant",
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
     * Deletes the current conversation (server-side).
     */
    async deleteConversation() {
      if (!this.currentConversationId) return false;
      if (!this.isAuthenticated()) {
        this.notify("[ChatManager] deleteConversation: not authenticated", "warn");
        return false;
      }
      if (!this.isValidProjectId(this.projectId)) {
        this._handleError("deleting conversation", "Invalid projectId");
        this._showErrorMessage("Cannot delete conversation: invalid project ID.");
        return false;
      }
      try {
        await this.apiRequest(
          apiEndpoints.CONVERSATION(this.projectId, this.currentConversationId),
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
     * For attaching an image to the next user message.
     * @param {string} base64Image
     */
    setImage(base64Image) {
      this.currentImage = base64Image;
    }

    /**
     * Update the model config and refresh internal config state.
     * @param {Object} config
     */
    updateModelConfig(config) {
      this.modelConfigAPI.updateConfig(config);
      this.modelConfig = this.modelConfigAPI.getConfig();
    }

    // -------------------- UI Methods ----------------------

    /**
     * Sets up or rebinds references to container, message area, input, etc.
     * @private
     * @param {Object} options
     */
    _setupUIElements(options) {
      const containerSelector = options.containerSelector || "#chatUI";
      const messageContainerSelector = options.messageContainerSelector || "#conversationArea";
      const inputSelector = options.inputSelector || "#chatInput";
      const sendButtonSelector = options.sendButtonSelector || "#sendBtn";
      const titleSelector = options.titleSelector || "#chatTitle";

      // Container
      this.container = this.domAPI.querySelector(containerSelector);
      if (!this.container) {
        this.container = this.domAPI.createElement("div");
        this.container.id = containerSelector.replace('#', '');
        this.domAPI.appendChild(this.domAPI.querySelector('body') || {}, this.container);
      }

      // Message container
      this.messageContainer = this.domAPI.querySelector(messageContainerSelector);
      if (!this.messageContainer) {
        this.messageContainer = this.domAPI.createElement("div");
        this.messageContainer.id = messageContainerSelector.replace('#', '');
        this.domAPI.appendChild(this.container, this.messageContainer);
      }

      // Input field
      this.inputField = this.domAPI.querySelector(inputSelector);
      if (!this.inputField) {
        const inputArea = this.domAPI.createElement("div");
        inputArea.className = "chat-input-area";
        const field = this.domAPI.createElement("input");
        field.id = inputSelector.replace('#', '');
        field.className = "chat-input";
        field.placeholder = "Type your message...";
        field.setAttribute("aria-label", "Chat input");
        this.inputField = field;

        const sBtn = this.domAPI.createElement("button");
        sBtn.className = "chat-send-button";
        sBtn.textContent = "Send";
        sBtn.setAttribute("aria-label", "Send message");
        this.sendButton = sBtn;

        this.domAPI.appendChild(inputArea, field);
        this.domAPI.appendChild(inputArea, sBtn);
        this.domAPI.appendChild(this.container, inputArea);
      } else {
        this.sendButton = this.domAPI.querySelector(sendButtonSelector);
      }

      // Title element
      this.titleElement = this.domAPI.querySelector(titleSelector);
    }

    /**
     * Bind UI events via eventHandlers (trackListener). Store them for cleanup.
     * @private
     */
    _bindEvents() {
      for (const { element, event, handler, options } of this._listeners) {
        this.eventHandlers.untrackListener(element, event, handler, options);
      }
      this._listeners = [];

      const track = (element, event, fn, opts = {}) => {
        if (!element || !fn) return;
        this.eventHandlers.trackListener(element, event, fn, opts);
        this._listeners.push({ element, event, handler: fn, options: opts });
      };

      if (this.inputField) {
        track(this.inputField, "keydown", (e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            this.sendMessage(this.inputField.value);
          }
        }, { description: 'Chat input Enter key' });
      }

      if (this.sendButton) {
        track(this.sendButton, "click", () => {
          this.sendMessage(this.inputField?.value);
        }, { description: 'Chat send button' });
      }

      // Listen for a custom "regenerateChat" event
      track(this.domAPI.querySelector('body'), "regenerateChat", () => {
        if (!this.currentConversationId) return;
        if (!this.messageContainer) return;
        const userMessages = Array.from(this.messageContainer.querySelectorAll(".user-message"));
        if (!userMessages.length) return;
        const lastUserMessage = userMessages[userMessages.length - 1];
        const textEl = lastUserMessage?.querySelector(".message-content");
        const messageText = textEl?.textContent;
        if (messageText) {
          // remove last assistant response + re-send
          const assistantMsgs = Array.from(this.messageContainer.querySelectorAll(".assistant-message"));
          if (assistantMsgs.length) {
            const lastAssist = assistantMsgs[assistantMsgs.length - 1];
            lastAssist.remove();
          }
          this.sendMessage(messageText);
        }
      }, { description: 'Regenerate chat event' });

      // Listen for "modelConfigChanged"
      track(this.domAPI.querySelector('body'), "modelConfigChanged", (e) => {
        if (e.detail) this.updateModelConfig(e.detail);
      }, { description: 'Model config changed event' });
    }

    /**
     * Add a message to the UI.
     * @private
     * @param {'user'|'assistant'|'system'} role
     * @param {string} content
     * @param {string|null} [id]
     * @param {string|null} [thinking]
     * @param {boolean} [redactedThinking=false]
     */
    _showMessage(role, content, id = null, thinking = null, redactedThinking = false) {
      if (!this.messageContainer) return;
      const message = this.domAPI.createElement("div");
      message.className = `message ${role}-message`;
      if (id) message.id = id;

      const header = this.domAPI.createElement("div");
      header.className = "message-header";
      const nowStr = new Date().toLocaleTimeString();

      this.domAPI.setInnerHTML(
        header,
        `
          <span class="message-role">${role === "assistant" ? "Claude" : role === "user" ? "You" : "System"}</span>
          <span class="message-time">${nowStr}</span>
        `
      );

      const contentEl = this.domAPI.createElement("div");
      contentEl.className = "message-content";
      this.domAPI.setInnerHTML(
        contentEl,
        this.DOMPurify.sanitize(content || "", {
          ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'br', 'p']
        })
      );

      this.domAPI.appendChild(message, header);
      this.domAPI.appendChild(message, contentEl);

      if (thinking || redactedThinking) {
        const thinkingBlock = this._createThinkingBlock(thinking, redactedThinking);
        this.domAPI.appendChild(message, thinkingBlock);
      }

      this.domAPI.appendChild(this.messageContainer, message);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    /**
     * Create a collapsible block for 'thinking' text or 'redacted' notice.
     * @private
     */
    _createThinkingBlock(thinking, redacted) {
      const container = this.domAPI.createElement("div");
      container.className = "thinking-container";

      const toggle = this.domAPI.createElement("button");
      toggle.className = "thinking-toggle";
      toggle.setAttribute("aria-label", "Toggle reasoning details");
      this.domAPI.setInnerHTML(
        toggle,
        `
          <svg class="thinking-chevron" viewBox="0 0 24 24">
            <path d="M19 9l-7 7-7-7"></path>
          </svg>
          <span>${thinking ? "Show detailed reasoning" : "Safety notice"}</span>
        `
      );

      const content = this.domAPI.createElement("div");
      content.className = "thinking-content hidden";

      if (thinking) {
        this.domAPI.setInnerHTML(content, this.DOMPurify.sanitize(thinking));
      } else if (redacted) {
        this.domAPI.setInnerHTML(
          content,
          `
            <div class="redacted-notice">
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2
                  6.48 2 12s4.48 10 10 10 10-4.48
                  10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z">
                </path>
              </svg>
              <span>Some reasoning was redacted for safety reasons</span>
            </div>
          `
        );
      }

      // Toggle logic
      const handler = () => {
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
      };
      this.eventHandlers.trackListener(toggle, "click", handler);
      this._listeners.push({ element: toggle, event: "click", handler });

      this.domAPI.appendChild(container, toggle);
      this.domAPI.appendChild(container, content);
      return container;
    }

    _clearInputField() {
      if (this.inputField) {
        this.inputField.value = "";
        this.inputField.focus();
      }
    }

    // Uses navAPI for URL manipulation (no direct window/document access)
    _updateURLWithConversationId(conversationId) {
      const searchStr = this.navAPI.getSearch();
      const urlParams = new URLSearchParams(searchStr);
      if (urlParams.get("chatId") !== conversationId) {
        urlParams.set("chatId", conversationId);
        const basePath = this.navAPI.getPathname();
        const newUrl = `${basePath}?${urlParams.toString()}`;
        this.navAPI.pushState(newUrl);
      }
    }

    _removeConversationIdFromURL() {
      const searchStr = this.navAPI.getSearch();
      const urlParams = new URLSearchParams(searchStr);
      urlParams.delete("chatId");
      const basePath = this.navAPI.getPathname();
      let newUrl = basePath;
      const paramString = urlParams.toString();
      if (paramString) {
        newUrl += `?${paramString}`;
      }
      this.navAPI.pushState(newUrl);
    }

    _showLoadingIndicator() {
      if (!this.messageContainer) return;
      const indicator = this.domAPI.createElement("div");
      indicator.id = "chatLoadingIndicator";
      indicator.className = "loading-indicator";
      this.domAPI.setInnerHTML(
        indicator,
        `
        <div class="loading-spinner"></div>
        <span>Loading conversation...</span>
      `
      );
      this.domAPI.appendChild(this.messageContainer, indicator);
    }

    _hideLoadingIndicator() {
      const indicator = this.domAPI.querySelector("#chatLoadingIndicator");
      if (indicator) {
        indicator.remove();
      }
    }

    _showThinkingIndicator() {
      if (!this.messageContainer) return;
      const indicator = this.domAPI.createElement("div");
      indicator.id = "thinkingIndicator";
      indicator.className = "thinking-indicator";
      this.domAPI.setInnerHTML(
        indicator,
        `
          <div class="thinking-dots">
            <span></span><span></span><span></span>
          </div>
          <span>Claude is thinking...</span>
        `
      );
      this.domAPI.appendChild(this.messageContainer, indicator);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    _hideThinkingIndicator() {
      const el = this.domAPI.querySelector("#thinkingIndicator");
      if (el) el.remove();
    }

    /**
     * Renders an error block in the chat UI.
     * @private
     * @param {string} message
     */
    _showErrorMessage(message) {
      if (!this.messageContainer) return;
      const errorEl = this.domAPI.createElement("div");
      errorEl.className = "error-message";
      this.domAPI.setInnerHTML(errorEl, `
        <div class="error-icon">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2
             6.48 2 12s4.48 10 10 10 10-4.48
             10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"></path>
          </svg>
        </div>
        <div class="error-content">
          <h4>Error</h4>
          <p>${this.DOMPurify.sanitize(message)}</p>
        </div>
      `);
      this.domAPI.appendChild(this.messageContainer, errorEl);
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }

    _clearMessages() {
      if (this.messageContainer) {
        this.domAPI.replaceChildren(this.messageContainer);
      }
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

    _extractErrorMessage(err) {
      if (!err) return "Unknown error occurred";
      if (typeof err === "string") return err;
      if (err.message) return err.message;
      try {
        return JSON.stringify(err);
      } catch {
        return "Unknown error object";
      }
    }

    _handleError(context, error) {
      const message = this._extractErrorMessage(error);
      this.notify(`[ChatManager - ${context}] ${message}`, "error", error);
    }
  } // end ChatManager class
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] Instantiating ChatManager class...');
  const instance = new ChatManager();
  // ADD LOGGING HERE
  console.log('[ChatManager Debug] ChatManager instance CREATED.');
  return instance;
}
