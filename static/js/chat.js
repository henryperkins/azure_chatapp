import { attachChatUI } from "./chat-ui-utils.js";
import { APP_CONFIG } from './appConfig.js'; // Import APP_CONFIG

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
 * @property {function(): Document} getDocument
 * @property {function(HTMLElement, string): void} addClass
 * @property {function(HTMLElement, string): void} removeClass
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
 * @property {function(HTMLElement|EventTarget, string, Function, Object=): any} trackListener
 * @property {function(HTMLElement|EventTarget, string, any): void} untrackListener
 * @property {function(Object=): void} cleanupListeners
 */

export function createChatManager(deps = {}) {
  const {
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
    apiEndpoints,
    domReadinessService,
    logger,
    DependencySystem
  } = deps;

  if (!apiRequest) throw new Error('Missing apiRequest in createChatManager');
  if (!app) throw new Error('Missing app in createChatManager');
  if (!isValidProjectId) throw new Error('Missing isValidProjectId in createChatManager');
  if (!isAuthenticated) throw new Error('Missing isAuthenticated in createChatManager');
  if (!DOMPurify) throw new Error('Missing DOMPurify in createChatManager');
  if (!apiEndpoints) throw new Error('Missing apiEndpoints in createChatManager');
  if (!domReadinessService) throw new Error('Missing domReadinessService in createChatManager');
  if (!logger) throw new Error('Missing logger in createChatManager');

  function safeHandler(fn, description) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        logger.error(`[ChatManager][${description}]`, err, { context: 'chatManager' });
        throw err;
      }
    };
  }

  function createDefaultDomAPI() {
    throw new Error("[ChatManager] No domAPI provided. All DOM operations must be injected.");
  }
  function createDefaultNavAPI() {
    throw new Error("[ChatManager] No navAPI provided. All navigation operations must be injected.");
  }
  function createDefaultEventHandlers({ domReadinessService, logger }) {
    if (!domReadinessService) throw new Error('Missing domReadinessService in createDefaultEventHandlers');
    if (!logger) throw new Error('Missing logger in createDefaultEventHandlers');
    function trackListener() { throw new Error("[ChatManager] No eventHandlers.trackListener provided."); }
    function untrackListener() { throw new Error("[ChatManager] No eventHandlers.untrackListener provided."); }
    function cleanupListeners() { }
    return { trackListener, untrackListener, cleanupListeners };
  }
  function getInjectedModelConfig(modelCfg) {
    if (modelCfg) return modelCfg;
    return {
      getConfig: () => ({}),
      updateConfig: () => { },
      getModelOptions: () => [],
      onConfigChange: () => { }
    };
  }

  const CHAT_CONFIG = {
    DEFAULT_MODEL: "claude-3-sonnet-20240229",
    MAX_TOKENS: 4096,
    THINKING_BUDGET: 16000,
    REASONING_EFFORT: "medium",
    MAX_IMAGE_SIZE: 4 * 1024 * 1024 // 4MB
  };

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

  const _domAPI = domAPI || createDefaultDomAPI();
  const _navAPI = navAPI || createDefaultNavAPI();
  const _EH = eventHandlers || createDefaultEventHandlers({ domReadinessService, logger });

  class ChatManager {
    _api(endpoint, opts = {}, ctx = 'chatManager') {
      const { params, ...rest } = opts;
      if (params && typeof params === 'object') {
        const u = new URL(endpoint, this.navAPI?.getHref?.() || '/');
        Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
        endpoint = String(u);
      }
      return this.apiRequest(endpoint, rest, ctx);
    }

    constructor() {
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
      this.chatBus = new EventTarget();
      this.projectId = null;
      this.currentConversationId = null;
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
      this.containerSelector = null;
      this.messageContainerSelector = null;
      this.inputSelector = null;
      this.sendButtonSelector = null;
      this.minimizeButtonSelector = null;
      this._authChangeListener = null;
      this.modelConfig = this.modelConfigAPI.getConfig();
      this.DependencySystem = DependencySystem || undefined;
      this.domReadinessService = domReadinessService;
      this._uiAttached = false;
    }

    /**
     * Ensures UI utilities and methods are attached to the ChatManager instance.
     * @private
     */
    _ensureUIAttached() {
      if (!this._uiAttached) {
        logger.info("[ChatManager][_ensureUIAttached] Attaching UI utilities", { context: "chatManager" });
        attachChatUI(this, {
          domAPI: this.domAPI,
          DOMPurify: this.DOMPurify,
          eventHandlers: this.eventHandlers,
          domReadinessService: this.domReadinessService
        });
        this._uiAttached = true;
      }
    }

    /**
     * Initialize the chat manager with optional UI selectors or overrides.
     */
    async initialize(options = {}) {
      const _initStart = performance.now();
      logger.info("[ChatManager][initialize] Starting initialization", { context: "chatManager.initialize", options });

      await domReadinessService.dependenciesAndElements({
        deps: ['app', 'domAPI', 'eventHandlers'],
        context: 'ChatManager.init:core'
      });

      await domReadinessService.dependenciesAndElements({
        deps: ['auth'],
        context: 'ChatManager.init:auth'
      });
      const auth = app?.DependencySystem?.modules?.get('auth') || null;

      this.containerSelector = options.containerSelector || "#chatUIContainer";
      this.messageContainerSelector = options.messageContainerSelector || "#globalChatMessages";
      this.inputSelector = options.inputSelector || "#chatUIInput";
      this.sendButtonSelector = options.sendButtonSelector || "#globalChatSendBtn";
      this.titleSelector = options.titleSelector || "#chatTitle";
      this.minimizeButtonSelector = options.minimizeButtonSelector || "#minimizeChatBtn";

      try {
        if (!auth || !auth.isAuthenticated()) {
          const msg = "User not authenticated. Cannot initialize ChatManager.";
          logger.error("[ChatManager][initialize] Auth failure", new Error(msg), { context: "chatManager.initialize" });
          this.projectDetails?.disableChatUI?.("Not authenticated");

          if (!this._authChangeListener && auth?.AuthBus) {
            this._authChangeListener = safeHandler(async (e) => {
              if (e.detail?.authenticated && this.projectId) {
                this.eventHandlers.cleanupListeners?.({ context: 'chatManagerAuthRetryListener' });
                if (this._authChangeListener && auth?.AuthBus?.removeEventListener) {
                  auth.AuthBus.removeEventListener('authStateChanged', this._authChangeListener);
                }
                this._authChangeListener = null;
                await this.initialize({
                  projectId: this.projectId,
                  containerSelector: this.containerSelector,
                  messageContainerSelector: this.messageContainerSelector,
                  inputSelector: this.inputSelector,
                  sendButtonSelector: this.sendButtonSelector,
                  titleSelector: this.titleSelector,
                  minimizeButtonSelector: this.minimizeButtonSelector
                });
              }
            }, "authChangeListener");

            this.eventHandlers.trackListener(
              auth.AuthBus,
              'authStateChanged',
              this._authChangeListener,
              {
                context: 'chatManagerAuthRetryListener',
                description: 'Auth state change listener for chat initialization retry'
              }
            );
          }
          throw new Error(msg);
        }

        const requestedProjectId = options.projectId && this.isValidProjectId(options.projectId)
          ? options.projectId
          : this.projectId;

        if (options.projectId && this.isValidProjectId(options.projectId)) {
          this.projectId = options.projectId;
        } else if (!this.projectId && requestedProjectId) {
          this.projectId = requestedProjectId;
        }

        if (!this.projectId) {
          const noProjectMsg = "No valid project ID provided for ChatManager initialization.";
          logger.error("[ChatManager][initialize] No valid project ID", new Error(noProjectMsg), { context: "chatManager.initialize" });
          throw new Error(noProjectMsg);
        }

        // Re-initialization for same project
        if (this.isInitialized && this.projectId === requestedProjectId) {
          logger.info("[ChatManager][initialize] Already initialized for project, re-binding UI", { context: "chatManager.initialize", projectId: this.projectId });
          this._ensureUIAttached();
          // await this._setupUIElements(); // (removed duplicate call)
          this.eventHandlers.cleanupListeners?.({ context: 'chatManager:UI' });
          this._setupEventListeners();
          logger.info("[ChatManager][initialize] Re-initialization complete", { context: "chatManager.initialize" });
          return true;
        }

        // Switching projects
        if (this.isInitialized && this.projectId !== requestedProjectId) {
          this.currentConversationId = null;
          this.loadPromise = null;
          this.isLoading = false;
          if (this.messageContainer) this._clearMessages();
        }

        this.projectId = requestedProjectId;
        this.isGlobalMode = !this.isValidProjectId(this.projectId);

        this._ensureUIAttached();

        if (this.isGlobalMode) {
          logger.info("[ChatManager][initialize] Entering global chat mode", { context: "chatManager.initialize" });
          await this._setupUIElements();
          if (this.messageContainer) {
            this._clearMessages();
            this._showMessage("system", "Select a project or start a new global chat.");
          }
          this.eventHandlers.cleanupListeners?.({ context: 'chatManager:UI' });
          this._setupEventListeners();
          this.isInitialized = true;
          return true;
        }

        // Setup "New Conversation" button if it exists
        const newConversationBtn = this.domAPI.getElementById("newConversationBtn");
        if (newConversationBtn) {
          newConversationBtn.classList.remove("hidden");
          this.eventHandlers.cleanupListeners?.({ context: 'chatManager:newConvoBtn' });
          this.eventHandlers.trackListener(
            newConversationBtn,
            "click",
            safeHandler(async () => {
              try {
                await this.createNewConversation();
              } catch (err) {
                logger.error("[ChatManager][New Conversation Button]", err, { context: "chatManager.initialize" });
                this._showErrorMessage("Failed to start new chat: " + (err?.message || err));
              }
            }, "New Conversation Button"),
            { description: "New Conversation Button", context: "chatManager:newConvoBtn", source: "ChatManager.initialize" }
          );
        }

        // Ensure UI elements are present before history/render
        await this._setupUIElements();
        await this._loadConversationHistory();
        this.isInitialized = true;
        this.eventHandlers.cleanupListeners?.({ context: 'chatManager' });
        this.eventHandlers.cleanupListeners?.({ context: 'chatManager:UI' });
        this._setupEventListeners();

        this.chatBus?.dispatchEvent(
          new CustomEvent('chatManagerReady', { detail: { projectId: this.projectId } })
        );

        logger.info("[ChatManager][initialize] Successfully initialized", {
          context: "chatManager.initialize",
          projectId: this.projectId,
          duration: performance.now() - _initStart
        });

        return true;

      } catch (error) {
        logger.error("[ChatManager][initialize] Initialization failed", error, { context: "chatManager.initialize" });
        this.isInitialized = false;
        const originalErrorMessage = this._extractErrorMessage(error);
        if (originalErrorMessage.includes("Project has no knowledge base")) {
          const specificMessage = "Chat initialization failed: Project has no knowledge base. Please add one to enable chat.";
          this._showErrorMessage(specificMessage);
          this.projectDetails?.disableChatUI?.(specificMessage);
        }
        return false;
      }
    }

    cleanup() {
      this.eventHandlers.cleanupListeners?.({ context: "chatManager:UI" });
      this.eventHandlers.cleanupListeners?.({ context: "chatManager" });
      this.isInitialized = false;
      this.currentConversationId = null;
      this.projectId = null;
      this.isGlobalMode = false;
      this._clearMessages();
      this._uiAttached = false;
    }

    async loadConversation(conversationId) {
      if (!conversationId) return false;
      if (!this.isAuthenticated()) return false;
      if (!this.isValidProjectId(this.projectId)) {
        const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot load conversation.`;
        logger.error("[ChatManager][loading conversation]" + errorMsg, new Error(errorMsg), { context: "chatManager" });
        this._showErrorMessage("Cannot load conversation: invalid/missing project ID.");
        return false;
      }

      const requestId = ++this.currentRequestId;
      if (this.loadPromise) {
        const result = await this.loadPromise;
        return requestId === this.currentRequestId ? result : false;
      }

      this.isLoading = true;
      this._showLoadingIndicator();

      this.loadPromise = (async () => {
        try {
          this._clearMessages();

          const [conversationResponse, messagesResponse] = await Promise.all([
            this._api(apiEndpoints.CONVERSATION(this.projectId, conversationId), { method: "GET" }),
            this._api(apiEndpoints.MESSAGES(this.projectId, conversationId), { method: "GET" })
          ]);

          const conversation =
                conversationResponse?.data?.conversation
             ?? conversationResponse?.data
             ?? conversationResponse?.conversation
             ?? conversationResponse;

          if (!conversation?.id) {
            throw new Error('Failed to fetch valid conversation details.');
          }

          const messages = messagesResponse.data?.messages || [];

          this.currentConversationId = conversationId;
          if (this.titleElement) {
            this.titleElement.textContent = conversation.title || "New Conversation";
          }
          this._renderMessages(messages);
          this._updateURLWithConversationId(conversationId);

          return true;
        } catch (error) {
          logger.error("[ChatManager][loading conversation]", error, { context: "chatManager" });
          return false;
        } finally {
          this.isLoading = false;
          this._hideLoadingIndicator();
          this.loadPromise = null;
        }
      })();

      return this.loadPromise;
    }

    async createNewConversation(overrideProjectId) {
      if (overrideProjectId) {
        this.projectId = this.isValidProjectId(overrideProjectId) ? overrideProjectId : this.projectId;
      }

      if (!this.isAuthenticated()) {
        throw new Error("Not authenticated");
      }
      if (!this.isValidProjectId(this.projectId)) {
        const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot create new conversation.`;
        logger.error("[ChatManager][creating new conversation]" + errorMsg, new Error(errorMsg), { context: "chatManager" });
        this._showErrorMessage(errorMsg);
        this.projectDetails?.disableChatUI?.("No valid project");
        throw new Error(errorMsg);
      }

      this._clearMessages();

      try {
        const cfg = this.modelConfigAPI.getConfig();
        const currentUser = this.app?.state?.currentUser || {};

        const payload = {
          title: `New Chat ${new Date().toLocaleString()}`,
          model_id: cfg.modelName || CHAT_CONFIG.DEFAULT_MODEL
        };
        if (currentUser.id) payload.user_id = currentUser.id;

        const convoEndpoint = typeof apiEndpoints.CONVERSATIONS === 'function'
          ? apiEndpoints.CONVERSATIONS(this.projectId)
          : String(apiEndpoints.CONVERSATIONS).replace('{id}', this.projectId);

        const response = await this._api(convoEndpoint, { method: "POST", body: payload });

        const conversation =
              response?.data?.conversation
           ?? response?.data
           ?? response?.conversation
           ?? response;

        if (!conversation?.id) {
          throw new Error('Server response missing conversation ID');
        }

        this.currentConversationId = conversation.id;
        if (this.titleElement) {
          this.titleElement.textContent = conversation.title || "New Conversation";
        }
        this._updateURLWithConversationId(conversation.id);

        const event = new CustomEvent('chat:conversationCreated', {
          detail: {
            conversationId: conversation.id,
            projectId: this.projectId,
            title: conversation.title
          }
        });
        this.chatBus.dispatchEvent(event);

        return conversation;
      } catch (error) {
        logger.error("[ChatManager][creating new conversation]", error, { context: "chatManager" });
        const errorMessage = this._extractErrorMessage(error);

        if (errorMessage.includes("Project has no knowledge base")) {
          const specificMessage = "Project has no knowledge base. Please add one to enable chat.";
          this._showErrorMessage(specificMessage);
          this.projectDetails?.disableChatUI?.(specificMessage);
        } else {
          this._showErrorMessage("Failed to create conversation: " + errorMessage);
          this.projectDetails?.disableChatUI?.("Chat error: " + errorMessage);
        }
        throw error;
      }
    }

    async sendMessage(messageText) {
      if (!messageText?.trim()) {
        return;
      }

      return this.messageQueue.add(async () => {
        if (!this.isAuthenticated()) {
          return;
        }
        if (!this.isValidProjectId(this.projectId)) {
          const errorMsg = `No valid project ID (${this.projectId}). Select a project before sending messages.`;
          logger.error("[ChatManager][sending message]" + errorMsg, new Error(errorMsg), { context: "chatManager" });
          this._showErrorMessage(errorMsg);
          this.projectDetails?.disableChatUI?.("No valid project");
          return;
        }
        if (!this.currentConversationId) {
          try {
            await this.createNewConversation();
            if (!this.currentConversationId) {
              return;
            }
          } catch (error) {
            return;
          }
        }

        this._showMessage("user", messageText);
        this._clearInputField();
        this._showThinkingIndicator();

        try {
          const response = await this._sendMessageToAPI(messageText);
          this._processAssistantResponse(response);
          return response.data;
        } catch (error) {
          logger.error("[ChatManager][sending message]", error, { context: "chatManager" });
          this._hideThinkingIndicator();
          this._showErrorMessage(error.message);
          this.projectDetails?.disableChatUI?.("Chat error: " + (error.message || error));
        }
      });
    }

    async _sendMessageToAPI(messageText) {
      const cfg = this.modelConfigAPI.getConfig();
      const payload = {
        content: messageText,
        role: "user",
        type: "message",
        vision_detail: cfg.visionDetail || "auto"
      };

      // Reasoning summary (concise/detailed) if present in config
      if (cfg.reasoningSummary) {
        payload.reasoning_summary = cfg.reasoningSummary;
      }
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
      return this._api(
        apiEndpoints.MESSAGES(this.projectId, this.currentConversationId),
        { method: "POST", body: payload }
      );
    }

    _validateImageSize() {
      if (typeof this.currentImage === 'string' && this.currentImage.startsWith("data:")) {
        const commaIdx = this.currentImage.indexOf(',');
        const b64 = commaIdx !== -1 ? this.currentImage.slice(commaIdx + 1) : this.currentImage;
        const sizeBytes = Math.floor((b64.length * 3) / 4);
        if (sizeBytes > CHAT_CONFIG.MAX_IMAGE_SIZE) {
          const errorMsg = `Image is too large (${(sizeBytes / (1024*1024)).toFixed(1)}MB). Max allowed: ${CHAT_CONFIG.MAX_IMAGE_SIZE / (1024*1024)}MB.`;
          throw new Error(errorMsg);
        }
      }
    }

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

    async deleteConversation() {
      if (!this.currentConversationId) {
        return false;
      }
      if (!this.isAuthenticated()) {
        return false;
      }
      if (!this.isValidProjectId(this.projectId)) {
        const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot delete conversation.`;
        logger.error("[ChatManager][deleting conversation]" + errorMsg, new Error(errorMsg), { context: "chatManager" });
        this._showErrorMessage("Cannot delete conversation: invalid/missing project ID.");
        return false;
      }
      try {
        await this._api(
          apiEndpoints.CONVERSATION(this.projectId, this.currentConversationId),
          { method: "DELETE" }
        );
        this.currentConversationId = null;
        this._clearMessages();
        this._removeConversationIdFromURL();
        return true;
      } catch (error) {
        logger.error("[ChatManager][deleting conversation]", error, { context: "chatManager" });
        return false;
      }
    }

    setImage(base64Image) {
      this.currentImage = base64Image;
    }

    updateModelConfig(config) {
      this.modelConfigAPI.updateConfig(config, { skipNotify: true });
      this.modelConfig = this.modelConfigAPI.getConfig();
    }

    async _loadConversationHistory() {
      if (!this.projectId) {
        if (this.messageContainer) this._showMessage("system", "Please select a project to start chatting.");
        return;
      }

      const urlParams = new URLSearchParams(this.navAPI.getSearch());
      const urlChatId = urlParams.get('chatId');

      if (urlChatId) {
        const loadedSuccessfully = await this.loadConversation(urlChatId);
        if (loadedSuccessfully) {
          return;
        }
        this._removeConversationIdFromURL();
      }

      try {
        const responseData = await this._api(apiEndpoints.CONVERSATIONS(this.projectId), { method: 'GET', params: { limit: 1, sort: 'desc' } });
        const conversations = responseData?.conversations || (Array.isArray(responseData) ? responseData : []);

        if (conversations && conversations.length > 0) {
          this.currentConversationId = conversations[0].id;
          if (this.titleElement) this.titleElement.textContent = conversations[0].title || "Conversation";
          await this._loadMessages(this.currentConversationId);
          this._updateURLWithConversationId(this.currentConversationId);
        } else {
          await this.createNewConversation();
        }
      } catch (error) {
        logger.error("[ChatManager][_loadConversationHistory]", error, { context: "chatManager" });
        await this.createNewConversation();
      }
    }

    async _loadMessages(conversationId) {
      if (!conversationId) {
        return;
      }
      if (!this.messageContainer) {
        return;
      }
      this._showLoadingIndicator();

      try {
        const response = await this._api(apiEndpoints.MESSAGES(this.projectId, conversationId), { method: 'GET' });
        const messages = response?.messages || response?.data?.messages || response || [];

        this._clearMessages();
        messages.forEach(message => {
          this._showMessage(message.role, message.content, message.id, message.thinking, message.redacted_thinking);
        });
        if (this.messageContainer) {
          this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
        }
      } catch (error) {
        logger.error("[ChatManager][_loadMessages]", error, { context: "chatManager" });
        this._showErrorMessage('Failed to load messages. Please try again.');
      } finally {
        this._hideLoadingIndicator();
      }
    }

    _showMessage(role, content, id = null, thinking = null, redactedThinking = false) {
      if (!this.messageContainer) {
        return;
      }
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

      const safeToggleHandler = safeHandler(handler, "thinking block toggle");

      this.eventHandlers.trackListener(toggle, "click", safeToggleHandler, {
        description: 'Thinking block toggle',
        context: 'chatManager',
        source: 'ChatManager._createThinkingBlock'
      });

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
      if (!this.messageContainer) {
        return;
      }
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
      if (!this.messageContainer) {
        return;
      }
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
      if (el) {
        el.remove();
      }
    }

    _showErrorMessage(message) {
      if (!this.messageContainer) {
        return;
      }
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

    _extractErrorMessage(err) {
      if (!err) return "Unknown error occurred";
      if (typeof err === "string") return err;
      if (err.message) return err.message;
      try {
        return JSON.stringify(err);
      } catch (jsonErr) {
        logger.error("[ChatManager][_extractErrorMessage]", jsonErr, { context: 'chatManager' });
        return "Unknown error object";
      }
    }

    _handleError(context, error) {
      // This method is intentionally left empty but we keep it for external compatibility.
      // Now all errors are logged via logger.error(...) in catch blocks.
    }

    _renderMessages(messages) {
      if (!messages || !Array.isArray(messages) || !this.messageContainer) {
        return;
      }

      this._clearMessages();
      messages.forEach(message => {
        this._showMessage(
          message.role,
          message.content,
          message.id,
          message.thinking,
          message.redacted_thinking
        );
      });

      if (this.messageContainer) {
        this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
      }
    }

    async _setupUIElements() {
      await domReadinessService.elementsReady(
        [
          this.containerSelector,
          this.messageContainerSelector,
          this.inputSelector,
          this.sendButtonSelector
        ],
        { timeout: APP_CONFIG?.TIMEOUTS?.CHAT_UI_READY ?? 8000,
          context: "chatManager::_setupUIElements" }
      );

      this.container        = this.domAPI.querySelector(this.containerSelector);
      this.messageContainer = this.domAPI.querySelector(this.messageContainerSelector);
      this.inputField       = this.domAPI.querySelector(this.inputSelector);
      this.sendButton       = this.domAPI.querySelector(this.sendButtonSelector);
      this.titleElement     = this.titleSelector
                                ? this.domAPI.querySelector(this.titleSelector)
                                : null;
      this.minimizeButton   = this.minimizeButtonSelector
                                ? this.domAPI.querySelector(this.minimizeButtonSelector)
                                : null;

      if (!this.container || !this.messageContainer ||
          !this.inputField || !this.sendButton) {
        throw new Error("[ChatManager] Chat UI elements not found. Check selectors/template.");
      }

      this.domAPI.removeClass(this.container, "hidden");
      const header = this.domAPI.getElementById?.("chatHeaderBar");
      if (header) {
        if (this.isGlobalMode) {
          this.domAPI.removeClass(header, "hidden");
        } else {
          this.domAPI.addClass(header, "hidden");
        }
      }

      return true;
    }

    _setupEventListeners() {
      this.eventHandlers.cleanupListeners?.({ context: "chatManager:UI" });
      const ctx = { context: "chatManager:UI" };

      if (this.sendButton) {
        this.eventHandlers.trackListener(
          this.sendButton,
          "click",
          safeHandler(() => {
            const txt = this.inputField?.value ?? "";
            this.sendMessage(txt).catch(()=>{});
          }, "sendBtnClick"),
          ctx
        );
      }

      if (this.inputField) {
        this.eventHandlers.trackListener(
          this.inputField,
          "keydown",
          safeHandler((e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const txt = this.inputField.value;
              this.sendMessage(txt).catch(()=>{});
            }
          }, "inputEnter"),
          ctx
        );
      }

      if (this.minimizeButton && this.container) {
        this.eventHandlers.trackListener(
          this.minimizeButton,
          "click",
          safeHandler(() => {
            this.container.classList.toggle("hidden");
          }, "minimiseClick"),
          ctx
        );
      }
      return true;
    }
  }

  const instance = new ChatManager();

  return {
    initialize: instance.initialize.bind(instance),
    sendMessage: instance.sendMessage.bind(instance),
    createNewConversation: instance.createNewConversation.bind(instance),
    loadConversation: instance.loadConversation.bind(instance),
    deleteConversation: instance.deleteConversation.bind(instance),
    setImage: instance.setImage.bind(instance),
    updateModelConfig: instance.updateModelConfig.bind(instance),
    cleanup: instance.cleanup.bind(instance),
    chatBus: instance.chatBus
  };
}
