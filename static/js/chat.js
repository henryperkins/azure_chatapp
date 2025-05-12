import { wrapApi, safeInvoker } from "./utils/notifications-helpers.js";
import { APP_CONFIG } from './appConfig.js'; // Import APP_CONFIG

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
 * @param {Object} [options.notify] - DI notification util (nuevo)
 * @param {Object} [options.errorReporter] - DI error reporter (nuevo)
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
  apiEndpoints,
  notify,            // nuevo DI
  errorReporter      // nuevo DI
} = {}) {
  // Validate critical dependencies
  if (!notify || typeof notify.withContext !== 'function') {
    throw new Error('[ChatManager Factory] Critical: Injected `notify` dependency is missing or lacks `withContext` method.');
  }
  if (!domAPI || typeof domAPI.getDocument !== 'function') {
    throw new Error('[ChatManager Factory] Critical: Injected `domAPI` dependency is missing or lacks `getDocument` method.');
  }
  // Further validation for domAPI.getDocument().dispatchEvent will be done after getting the document object.
  if (!apiRequest) throw new Error('[ChatManager Factory] apiRequest is required.');
  if (!app) throw new Error('[ChatManager Factory] app is required.');
  if (!eventHandlers) throw new Error('[ChatManager Factory] eventHandlers is required.');
  if (!isValidProjectId) throw new Error('[ChatManager Factory] isValidProjectId is required.');
  if (!isAuthenticated) throw new Error('[ChatManager Factory] isAuthenticated is required.');
  if (!DOMPurify) throw new Error('[ChatManager Factory] DOMPurify is required.');
  if (!apiEndpoints) throw new Error('[ChatManager Factory] apiEndpoints is required.');


  const chatNotify = notify.withContext({ module: 'ChatManager', context: 'chatManager' });

  chatNotify.debug('createChatManager called. Dependencies validated.', {
    source: 'factory',
    dependencies: {
      apiRequest: !!apiRequest,
      app: !!app,
      eventHandlers: !!eventHandlers,
      modelConfig: !!modelConfig,
      projectDetailsComponent: !!projectDetailsComponent,
      isValidProjectId: !!isValidProjectId,
      isAuthenticated: !!isAuthenticated,
      domAPI: !!domAPI,
      navAPI: !!navAPI,
      DOMPurify: !!DOMPurify,
      notificationHandler: !!notificationHandler,
      apiEndpoints: !!apiEndpoints,
      notify: !!notify,
      errorReporter: !!errorReporter
    }
  });

  // Basic validation
  // Provide fallback DOM, Nav, and event handlers if not supplied
  // Use validated domAPI, navAPI, eventHandlers directly or throw if they were meant to be optional but are now required by strict DI.
  // For now, assuming they are required as per the new validation logic for notify and domAPI.
  const _domAPI = domAPI;
  const _navAPI = navAPI; // Assuming navAPI is also critical if used, or needs similar validation.
  const _EH = eventHandlers;


  // Removed _fallbackShow, _send, and notifyFn. Direct usage of chatNotify.
  chatNotify.debug('[ChatManager Debug] Notify function (chatNotify) configured.', 'debug', { context: 'chatManager', module: 'ChatManager', source: 'factory', phase: 'notify-configured' });

  /**
   * The main ChatManager class, constructed with all DI references enclosed.
   */
  class ChatManager {
    _api(endpoint, opts = {}) {
      return wrapApi(
        this.apiRequest,
        { notify: chatNotify, // Use validated chatNotify directly
          errorReporter },
        endpoint,
        opts,
        'ChatManager'
      );
    }
    constructor() {
      chatNotify.debug('ChatManager constructor started.', { source: 'constructor', phase: 'start' });
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
      this.notify = chatNotify; // Use the context-aware notifier directly

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

      chatNotify.debug('ChatManager constructor finished.', {
        source: 'constructor',
        phase: 'end',
        initialState: {
          projectId: this.projectId,
          currentConversationId: this.currentConversationId,
          isInitialized: this.isInitialized,
          isGlobalMode: this.isGlobalMode,
          modelConfig: this.modelConfig
        }
      });
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
     * @param {string} [options.minimizeButtonSelector]
     */
    async initialize(options = {}) {
      const _initStart = performance.now();
      chatNotify.info('ChatManager initialize() called.', {
        source: 'initialize',
        phase: 'start',
        options,
        currentProjectId: this.projectId,
        isInitialized: this.isInitialized
      });

      const requestedProjectId = options.projectId && this.isValidProjectId(options.projectId)
        ? options.projectId
        : null;
      chatNotify.debug(`Requested Project ID: ${requestedProjectId}`, { source: 'initialize', options });

      if (this.isInitialized && this.projectId === requestedProjectId) {
        chatNotify.warn(`Already initialized for project ${requestedProjectId}. Re-binding UI...`, { source: 'initialize', projectId: requestedProjectId });
        this._setupUIElements(options);
        this._bindEvents();
        chatNotify.info(`ChatManager initialize (rebinding) completed for project ${requestedProjectId}.`, { source: 'initialize', phase: 'rebind_complete', durationMs: (performance.now() - _initStart).toFixed(2) });
        return true;
      }

      // If switching or first load:
      const previousProjectId = this.projectId;
      this.projectId = requestedProjectId;
      this.isGlobalMode = !this.isValidProjectId(this.projectId);
      chatNotify.debug(`Global mode determined: ${this.isGlobalMode}. Project ID: ${this.projectId}`, { source: 'initialize' });

      if (this.isInitialized && previousProjectId !== requestedProjectId) {
        chatNotify.info(`Switching from project ${previousProjectId} to ${requestedProjectId}. Resetting state.`, { source: 'initialize', fromProjectId: previousProjectId, toProjectId: requestedProjectId });
        // Reset relevant state
        // this.isInitialized = false; // Keep isInitialized true if re-binding UI for a new project
        this.currentConversationId = null;
        this.loadPromise = null;
        this.isLoading = false;
        this._clearMessages();
      }

      if (!this.isAuthenticated()) {
        const msg = "User not authenticated. Cannot initialize ChatManager.";
        this._showErrorMessage(msg); // This likely calls notify internally or should
        this._handleError("initialization", msg); // Already logs via this.notify
        this.projectDetails?.disableChatUI?.("Not authenticated");
        chatNotify.error(msg, { source: 'initialize', critical: true });
        throw new Error(msg);
      }

      this._setupUIElements(options); // Internally logs
      this._bindEvents(); // Internally logs
const newConversationBtn = this.domAPI.getElementById("newConversationBtn");
      if (newConversationBtn) {
        newConversationBtn.classList.remove("hidden");

        /* remove ONLY previous handlers for this button instead of
           erasing every listener in the app */
        if (typeof this.eventHandlers.cleanupListeners === 'function')
          this.eventHandlers.cleanupListeners({ context: 'chatManager:newConvoBtn' });

        this.eventHandlers.trackListener(
          newConversationBtn,
          "click",
          safeInvoker(async () => {
            try {
              await this.createNewConversation();
            } catch (err) {
              this._handleError("New Conversation Button", err);
              this._showErrorMessage("Failed to start new chat: " + (err?.message || err));
            }
          }, { notify: this.notify, errorReporter: this.errorReporter }),
          { description: "New Conversation Button",
            context: "chatManager:newConvoBtn",
            source: "ChatManager.initialize" }
        );
      }

      if (this.isGlobalMode) {
        chatNotify.info("Starting in global (no-project) mode.", { source: 'initialize' });
        this._clearMessages(); // Internally logs
        this._showMessage("system", "Select a project or start a new global chat."); // Internally logs
        this.isInitialized = true;
        chatNotify.info(`ChatManager initialized (global mode).`, { source: 'initialize', phase: 'complete_global', durationMs: (performance.now() - _initStart).toFixed(2) });

        // Removed dispatch of 'chatmanager:initialized' event (global mode)
        return true;
      }

      chatNotify.info(`Initializing for project ID: ${this.projectId}`, { source: 'initialize' });
      // Initialize is now async due to awaiting loadConversation
      try {
        // Validate domAPI.getDocument().dispatchEvent before use
        const doc = this.domAPI.getDocument();
        if (!doc || typeof doc.dispatchEvent !== 'function') {
          throw new Error('[ChatManager Initialize] Document object from domAPI.getDocument() must have a dispatchEvent method.');
        }

        const urlParams = new URLSearchParams(this.navAPI.getSearch());
          const urlChatId = urlParams.get('chatId');
          chatNotify.debug(`URL params: ${urlParams.toString()}, Chat ID from URL: ${urlChatId}`, { source: 'initialize' });

          if (urlChatId) {
            chatNotify.info(`Found chatId=${urlChatId} in URL, attempting to load conversation...`, { source: 'initialize', chatId: urlChatId });
            const loadedSuccessfully = await this.loadConversation(urlChatId); // Await the load

            if (!loadedSuccessfully) {
              chatNotify.error(`Failed to load conversation ${urlChatId} from API. It may not exist or you may not have access for project ${this.projectId}.`, { source: 'initialize', chatId: urlChatId, projectId: this.projectId });
              this._removeConversationIdFromURL(); // Clear invalid chat ID from URL
              this._clearMessages();
              this._showMessage("system", `Could not load chat ${urlChatId}. Please select a valid conversation or start a new one.`);
              // Do NOT set this.currentConversationId to urlChatId here
            }
          } else {
            chatNotify.info("No chatId in URL. Ready for new chat or selection.", { source: 'initialize' });
          this._clearMessages();
        }

        this.isInitialized = true;
        chatNotify.info(`ChatManager initialized (project mode for ${this.projectId}).`, { source: 'initialize', phase: 'complete_project', durationMs: (performance.now() - _initStart).toFixed(2) });

        // Removed dispatch of 'chatmanager:initialized' event (project mode)
        return true;
      } catch (error) {
        this._handleError("initialization (project mode setup)", error);
        this.projectDetails?.disableChatUI?.("Chat setup error: " + (error.message || error));
        this.isInitialized = false;
        // Removed dispatch of failure 'chatmanager:initialized' event
        throw error;
      }
    }

    /**
     * Cleanup method to remove all tracked event listeners, etc.
     */
    cleanup() {
      chatNotify.info('ChatManager cleanup called.', { source: 'cleanup' });
      // Remove all tracked listeners for this ChatManager instance
      if (typeof this.eventHandlers.cleanupListeners === 'function') {
        this.eventHandlers.cleanupListeners({ context: 'chatManager' });
        chatNotify.debug('Cleaned up event listeners.', { source: 'cleanup' });
      }
      this.isInitialized = false;
      this.currentConversationId = null;
      this.projectId = null;
      this.isGlobalMode = false;
      this._clearMessages(); // Internally logs
      chatNotify.info('ChatManager state reset.', { source: 'cleanup' });
    }

    /**
     * Loads an existing conversation by ID.
     * @param {string} conversationId
     */
    async loadConversation(conversationId) {
      const _loadStart = performance.now();
      chatNotify.info(`Attempting to load conversation ID: ${conversationId} for project ID: ${this.projectId}`, {
        source: 'loadConversation',
        phase: 'start',
        conversationId,
        projectId: this.projectId
      });

      if (!conversationId) {
        chatNotify.error("Invalid conversationId provided.", { source: 'loadConversation', conversationId });
        return false;
      }
      if (!this.isAuthenticated()) {
        chatNotify.warn("User not authenticated. Cannot load conversation.", { source: 'loadConversation' });
        return false;
      }
      if (!this.isValidProjectId(this.projectId)) {
        const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot load conversation.`;
        this._handleError("loading conversation", errorMsg); // Already logs
        this._showErrorMessage("Cannot load conversation: invalid/missing project ID.");
        // chatNotify.error(errorMsg, { source: 'loadConversation' }); // Redundant with _handleError
        return false;
      }

      const requestId = ++this.currentRequestId;
      chatNotify.debug(`Generated request ID: ${requestId} for loading conversation.`, { source: 'loadConversation', requestId });
      if (this.loadPromise) {
        chatNotify.warn("Conversation load already in progress. Awaiting existing promise.", { source: 'loadConversation', existingRequestId: this.currentRequestId -1 });
        const result = await this.loadPromise;
        chatNotify.debug(`Previous loadConversation promise resolved with: ${result}. Current request ID: ${requestId}, Original request ID: ${this.currentRequestId}`, { source: 'loadConversation' });
        return requestId === this.currentRequestId ? result : false; // Ensure only the latest load request's result is used if multiple calls were made
      }

      this.isLoading = true;
      this._showLoadingIndicator();

      this.loadPromise = (async () => {
        try {
          this._clearMessages(); // Internally logs
          chatNotify.debug(`Fetching conversation details and messages for conversation ID: ${conversationId}`, { source: 'loadConversation', conversationId });

          // Parallel fetch conversation + messages
          const [conversationResponse, messagesResponse] = await Promise.all([
            this._api(apiEndpoints.CONVERSATION(this.projectId, conversationId), { method: "GET" }),
            this._api(apiEndpoints.MESSAGES(this.projectId, conversationId), { method: "GET" })
          ]);

          // Enhanced logging for debugging conversation data structure
          chatNotify.debug('Raw conversationResponse from API:', { source: 'loadConversation', response: conversationResponse });
          const conversationDataFromServer = conversationResponse?.data;
          chatNotify.debug('conversationResponse.data:', { source: 'loadConversation', data: conversationDataFromServer });
          const conversationPayload = conversationDataFromServer?.conversation;
          chatNotify.debug('conversationResponse.data.conversation (payload):', { source: 'loadConversation', payload: conversationPayload });

          const conversation = conversationPayload || conversationDataFromServer || conversationResponse;
          chatNotify.debug('Final "conversation" object for ID check:', { source: 'loadConversation', finalObject: conversation, idExists: conversation ? Object.prototype.hasOwnProperty.call(conversation, 'id') : false, idValue: conversation ? conversation.id : undefined });

          if (!conversation || !conversation.id) {
            chatNotify.error('Validation failed: "conversation" object is null/undefined or has no "id" property.', { source: 'loadConversation', checkedObject: conversation });
            throw new Error('Failed to fetch valid conversation details.');
          }

          const messages = messagesResponse.data?.messages || [];
          chatNotify.debug(`Received ${messages.length} messages for conversation ID: ${conversationId}`, { source: 'loadConversation', messagesCount: messages.length });

          this.currentConversationId = conversationId;
          if (this.titleElement) {
            this.titleElement.textContent = conversation.title || "New Conversation";
            chatNotify.debug(`Set chat title to: "${this.titleElement.textContent}"`, { source: 'loadConversation' });
          }
          this._renderMessages(messages); // Internally logs
          this._updateURLWithConversationId(conversationId); // Internally logs

          const loadMs = performance.now() - _loadStart;
          chatNotify.info(`Successfully loaded conversation ID: ${conversationId}. Duration: ${loadMs.toFixed(2)}ms`, {
            source: 'loadConversation',
            phase: 'complete',
            conversationId,
            durationMs: loadMs
          });
          if (loadMs > 2000) { // Example perf threshold
            chatNotify.warn(`Performance: Loading conversation ${conversationId} took ${loadMs.toFixed(1)} ms`, { source: 'loadConversation', durationMs: loadMs, conversationId});
          }
          return true;
        } catch (error) {
          this._handleError("loading conversation", error); // Already logs
          // this.notify(`[ChatManager] loadConversation error`, "error", { phase: "loadConversation", error: error?.message, stack: error?.stack }); // Redundant
          return false;
        } finally {
          this.isLoading = false;
          this._hideLoadingIndicator(); // Internally logs
          this.loadPromise = null;
          chatNotify.debug(`Finished loadConversation attempt for request ID: ${requestId}`, { source: 'loadConversation', requestId });
        }
      })();

      return this.loadPromise;
    }

    /**
     * Creates a new conversation on the server for the current project.
     * @param {string} [overrideProjectId]
     */
    async createNewConversation(overrideProjectId) {
      chatNotify.info('Attempting to create new conversation.', { source: 'createNewConversation', overrideProjectId, currentProjectId: this.projectId });
      if (overrideProjectId) {
        this.projectId = this.isValidProjectId(overrideProjectId) ? overrideProjectId : this.projectId;
        chatNotify.debug(`Project ID updated to: ${this.projectId} due to override.`, { source: 'createNewConversation' });
      }

      if (!this.isAuthenticated()) {
        chatNotify.warn("User not authenticated. Cannot create new conversation.", { source: 'createNewConversation' });
        throw new Error("Not authenticated");
      }
      if (!this.isValidProjectId(this.projectId)) {
        const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot create new conversation.`;
        this._showErrorMessage(errorMsg); // Internally logs
        this._handleError("creating new conversation", errorMsg); // Already logs
        this.projectDetails?.disableChatUI?.("No valid project");
        // chatNotify.error(errorMsg, { source: 'createNewConversation' }); // Redundant
        throw new Error(errorMsg);
      }

      this._clearMessages(); // Internally logs

      try {
        const cfg = this.modelConfigAPI.getConfig();
        const currentUser = this.app?.state?.currentUser || {};
        chatNotify.debug('Current user state for new conversation.', { source: 'createNewConversation', currentUser, modelConfig: cfg });

        /* If the user record hasn’t loaded yet but we are already
           authenticated, proceed and let the backend infer the user
           from the auth token. */
        const payload = {
          title: `New Chat ${new Date().toLocaleString()}`,
          model_id: cfg.modelName || CHAT_CONFIG.DEFAULT_MODEL
        };
        if (currentUser.id) payload.user_id = currentUser.id;
        else chatNotify.warn('Creating conversation without explicit user_id – relying on backend token', { source: 'createNewConversation' });
        chatNotify.debug('New conversation payload prepared.', { source: 'createNewConversation', payload });

        const convoEndpoint = typeof apiEndpoints.CONVERSATIONS === 'function'
          ? apiEndpoints.CONVERSATIONS(this.projectId)
          : String(apiEndpoints.CONVERSATIONS).replace('{id}', this.projectId);
        chatNotify.debug(`Requesting new conversation at endpoint: ${convoEndpoint}`, { source: 'createNewConversation' });

        const response = await this._api(convoEndpoint, { method: "POST", body: payload });
        chatNotify.debug('Received response from new conversation API.', { source: 'createNewConversation', responseData: response?.data });


        let conversation = null;
        if (response?.data?.conversation?.id) conversation = response.data.conversation;
        else if (response?.data?.id) conversation = response.data;
        else if (response?.conversation?.id) conversation = response.conversation;
        else if (response?.id) conversation = response;

        if (!conversation?.id) {
          chatNotify.error('Server response missing valid conversation ID after creation.', { source: 'createNewConversation', response });
          throw new Error("Server response missing conversation ID: " + JSON.stringify(response));
        }
        chatNotify.debug(`Successfully parsed conversation object from API response. ID: ${conversation.id}`, { source: 'createNewConversation', conversation });


        this.currentConversationId = conversation.id;
        if (this.titleElement) {
          this.titleElement.textContent = conversation.title || "New Conversation";
          chatNotify.debug(`Set chat title to: "${this.titleElement.textContent}" for new conversation.`, { source: 'createNewConversation' });
        }
        this._updateURLWithConversationId(conversation.id); // Internally logs
        chatNotify.success(`New conversation created successfully: ID ${conversation.id}`, { source: 'createNewConversation', conversationId: conversation.id });

        // Dispatch event for sidebar or other components to update
        const doc = this.domAPI.getDocument(); // Assumes domAPI.getDocument() is valid due to earlier checks
        // Further assume doc.dispatchEvent is valid based on checks in initialize or stricter DI
        if (doc && typeof doc.dispatchEvent === 'function') {
            chatNotify.debug(`Dispatching chat:conversationCreated event for conversation ${conversation.id}`, { source: 'createNewConversation' });
            const event = new CustomEvent('chat:conversationCreated', {
                detail: {
                    conversationId: conversation.id,
                    projectId: this.projectId,
                    title: conversation.title
                }
            });
            doc.dispatchEvent(event);
        } else {
            chatNotify.error('[ChatManager createNewConversation] Cannot dispatch chat:conversationCreated event. Document or dispatchEvent method not available.', { source: 'createNewConversation' });
            // Depending on strictness, this could throw an error.
        }

        return conversation;
      } catch (error) {
        this._handleError("creating new conversation", error); // Already logs
        this.projectDetails?.disableChatUI?.("Chat error: " + (error.message || error));
        throw error;
      }
    }

    /**
     * Sends a user message (queued) and awaits assistant reply.
     * @param {string} messageText
     */
    async sendMessage(messageText) {
      if (!messageText?.trim()) {
        chatNotify.warn('Attempted to send an empty message.', { source: 'sendMessage' });
        return;
      }
      chatNotify.info(`Adding message to queue. Length: ${messageText.length > 50 ? '>50' : messageText.length} chars.`, {
        source: 'sendMessage',
        // Avoid logging full PII messageText directly here unless APP_CONFIG.DEBUG is on.
        // Log a sanitized version or length instead.
        messagePreview: typeof APP_CONFIG !== 'undefined' && APP_CONFIG.DEBUG ? messageText.substring(0,50) : `Length: ${messageText.length}`
      });

      return this.messageQueue.add(
        safeInvoker(async () => {
          chatNotify.debug('Processing sendMessage task from queue.', { source: 'sendMessageTask' });
          if (!this.isAuthenticated()) {
            chatNotify.error("User not authenticated. Cannot send message.", { source: 'sendMessageTask' });
            // this.notify("Please log in to send messages", "error"); // Redundant if chatNotify used
            return;
          }
          if (!this.isValidProjectId(this.projectId)) {
            const errorMsg = `No valid project ID (${this.projectId}). Select a project before sending messages.`;
            this._showErrorMessage(errorMsg); // Internally logs
            this._handleError("sending message", errorMsg); // Already logs
            this.projectDetails?.disableChatUI?.("No valid project");
            return;
          }
          if (!this.currentConversationId) {
            chatNotify.info("No current conversation ID. Attempting to create a new one before sending message.", { source: 'sendMessageTask' });
            try {
              await this.createNewConversation(); // Internally logs
              if (!this.currentConversationId) { // Check again if creation failed silently or was aborted
                  chatNotify.error("Failed to establish a conversation to send message.", { source: 'sendMessageTask' });
                  return;
              }
            } catch (error) {
              // createNewConversation already logs via _handleError
              // this.projectDetails?.disableChatUI already called in createNewConversation
              return; // Stop if conversation creation failed
            }
          }

          // Show user message in UI
          this._showMessage("user", messageText); // Internally logs
          this._clearInputField(); // Internally logs
          this._showThinkingIndicator(); // Internally logs

          try {
            chatNotify.debug(`Sending message to API for conversation ID: ${this.currentConversationId}`, { source: 'sendMessageTask' });
            const response = await this._sendMessageToAPI(messageText); // Internally logs
            chatNotify.debug('Received API response for sent message.', { source: 'sendMessageTask', responseData: response?.data });
            this._processAssistantResponse(response); // Internally logs
            return response.data;
          } catch (error) {
            this._hideThinkingIndicator(); // Internally logs
            this._showErrorMessage(error.message); // Internally logs
            this._handleError("sending message", error); // Already logs
            this.projectDetails?.disableChatUI?.("Chat error: " + (error.message || error));
          }
        },
        { notify: chatNotify, errorReporter }, // Use the contextual chatNotify
        { context:'chatManager', module:'ChatManager', source:'sendMessageTask' })
      );
    }

    /**
     * Internal method that calls the API for sending a user message.
     * @private
     * @param {string} messageText
     */
    async _sendMessageToAPI(messageText) {
      const cfg = this.modelConfigAPI.getConfig();
      chatNotify.debug('Preparing payload for _sendMessageToAPI.', { source: '_sendMessageToAPI', modelConfigUsed: cfg });
      const payload = {
        content: messageText, // Note: Potentially sensitive. Log carefully.
        role: "user",
        type: "message",
        vision_detail: cfg.visionDetail || "auto"
      };
      if (this.currentImage) {
        chatNotify.debug('Image data present, validating and adding to payload.', { source: '_sendMessageToAPI' });
        this._validateImageSize(); // Internally logs on error
        payload.image_data = "data:..."; // Log placeholder for image data
        // payload.image_data = this.currentImage; // Actual data
        this.currentImage = null; // Clear after adding to payload
      }
      if (cfg.extendedThinking) {
        payload.thinking = {
          type: "enabled",
          budget_tokens: cfg.thinkingBudget
        };
        chatNotify.debug('Extended thinking enabled for this message.', { source: '_sendMessageToAPI', thinkingBudget: cfg.thinkingBudget });
      }
      chatNotify.debug('Final payload for sending message (excluding image_data).', { source: '_sendMessageToAPI', payload: {...payload, image_data: payload.image_data ? "present" : "absent"} });
      return this._api(
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
          this._hideThinkingIndicator(); // Internally logs
          const errorMsg = `Image is too large (${(sizeBytes / (1024*1024)).toFixed(1)}MB). Max allowed: ${CHAT_CONFIG.MAX_IMAGE_SIZE / (1024*1024)}MB.`;
          chatNotify.error(errorMsg, { source: '_validateImageSize', imageSizeBytes: sizeBytes, maxSizeMB: CHAT_CONFIG.MAX_IMAGE_SIZE / (1024*1024) });
          throw new Error(errorMsg);
        }
        chatNotify.debug(`Image size validated: ${(sizeBytes / (1024*1024)).toFixed(1)}MB.`, { source: '_validateImageSize' });
      }
    }

    /**
     * Process the API's assistant response or show an error if missing.
     * @private
     * @param {Object} response
     */
    _processAssistantResponse(response) {
      this._hideThinkingIndicator(); // Internally logs
      chatNotify.debug('Processing assistant response.', { source: '_processAssistantResponse', responseData: response?.data });
      if (response.data?.assistant_message) {
        const { assistant_message, thinking, redacted_thinking } = response.data;
        chatNotify.info('Assistant message received. Rendering.', {
            source: '_processAssistantResponse',
            hasThinking: !!thinking,
            hasRedactedThinking: !!redacted_thinking
        });
        this._showMessage( // Internally logs
          "assistant",
          assistant_message.content,
          null,
          thinking,
          redacted_thinking
        );
      } else if (response.data?.assistant_error) {
        const errMsg = this._extractErrorMessage(response.data.assistant_error);
        chatNotify.error(`Assistant response contained an error: ${errMsg}`, { source: '_processAssistantResponse', assistantError: response.data.assistant_error });
        throw new Error(errMsg);
      } else {
        chatNotify.warn('Assistant response did not contain a message or an error.', { source: '_processAssistantResponse', responseData: response?.data });
      }
    }

    /**
     * Deletes the current conversation (server-side).
     */
    async deleteConversation() {
      chatNotify.info(`Attempting to delete conversation ID: ${this.currentConversationId} for project ID: ${this.projectId}`, {
        source: 'deleteConversation',
        conversationId: this.currentConversationId,
        projectId: this.projectId
      });
      if (!this.currentConversationId) {
        chatNotify.warn("No current conversation ID to delete.", { source: 'deleteConversation' });
        return false;
      }
      if (!this.isAuthenticated()) {
        chatNotify.warn("User not authenticated. Cannot delete conversation.", { source: 'deleteConversation' });
        return false;
      }
      if (!this.isValidProjectId(this.projectId)) {
        const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot delete conversation.`;
        this._handleError("deleting conversation", errorMsg); // Already logs
        this._showErrorMessage("Cannot delete conversation: invalid/missing project ID.");
        return false;
      }
      try {
        await this._api(
          apiEndpoints.CONVERSATION(this.projectId, this.currentConversationId),
          { method: "DELETE" }
        );
        chatNotify.success(`Successfully deleted conversation ID: ${this.currentConversationId}`, { source: 'deleteConversation', conversationId: this.currentConversationId });
        this.currentConversationId = null;
        this._clearMessages(); // Internally logs
        this._removeConversationIdFromURL(); // Internally logs
        return true;
      } catch (error) {
        this._handleError("deleting conversation", error); // Already logs
        return false;
      }
    }

    /**
     * For attaching an image to the next user message.
     * @param {string} base64Image
     */
    setImage(base64Image) {
      this.currentImage = base64Image;
      chatNotify.debug(`Image set for next message. Length: ${base64Image?.length || 0}`, { source: 'setImage' });
    }

    /**
     * Update the model config and refresh internal config state.
     * @param {Object} config
     */
    updateModelConfig(config) {
      chatNotify.info('Updating model configuration.', { source: 'updateModelConfig', newConfig: config });
      this.modelConfigAPI.updateConfig(config);
      this.modelConfig = this.modelConfigAPI.getConfig();
      chatNotify.debug('Model configuration updated and internal state refreshed.', { source: 'updateModelConfig', currentModelConfig: this.modelConfig });
    }

    // -------------------- UI Methods ----------------------

    /**
     * Sets up or rebinds references to container, message area, input, etc.
     * @private
     * @param {Object} options
     */
    _setupUIElements(options) {
      chatNotify.debug('Setting up UI elements for ChatManager.', { source: '_setupUIElements', options });
      const containerSelector = options.containerSelector || "#chatUI";
      const messageContainerSelector = options.messageContainerSelector || "#conversationArea";
      const inputSelector = options.inputSelector || "#chatInput";
      const sendButtonSelector = options.sendButtonSelector || "#sendBtn";
      const titleSelector = options.titleSelector || "#chatTitle";
      const minimizeButtonSelector = options.minimizeButtonSelector || "#minimizeChatBtn";

      const selectorsToValidate = {
        container: containerSelector,
        messageContainer: messageContainerSelector,
        inputField: inputSelector,
        sendButton: sendButtonSelector,
        titleElement: titleSelector,
        minimizeButton: minimizeButtonSelector // Optional, but good to check if selector provided
      };

      for (const [key, selector] of Object.entries(selectorsToValidate)) {
        if (selector.startsWith("#")) { // Only validate IDs for uniqueness
          const elements = this.domAPI.querySelectorAll(
            selector,
            this.container ?? undefined      // limit search scope
          );
          if (elements.length > 1) {
            const errorMsg = `Duplicate DOM elements found for selector '${selector}' (key: ${key}). ChatManager requires unique IDs for its core elements.`;
            chatNotify.error(errorMsg, { source: '_setupUIElements', critical: true, extra: { selector, count: elements.length } });
            throw new Error(errorMsg);
          }
        }
      }

      // Container
      this.container = this.domAPI.querySelector(containerSelector);
      if (!this.container) {
        // If querySelector fails, it implies the element doesn't exist, not necessarily a duplicate.
        // The original logic for creating elements if not found is fine.
        // The check above handles cases where an ID selector *does* find multiple elements.
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

      // Minimize button
      this.minimizeButton = this.domAPI.querySelector(minimizeButtonSelector);

      // Title element
      this.titleElement = this.domAPI.querySelector(titleSelector);
      chatNotify.debug('UI elements setup complete.', {
        source: '_setupUIElements',
        elementsFound: {
          container: !!this.container,
          messageContainer: !!this.messageContainer,
          inputField: !!this.inputField,
          sendButton: !!this.sendButton,
          titleElement: !!this.titleElement,
          minimizeButton: !!this.minimizeButton
        }
      });
    }

    /**
     * Bind UI events via eventHandlers (trackListener). Store them for cleanup.
     * @private
     */
    _bindEvents() {
      chatNotify.debug('Binding UI events for ChatManager.', { source: '_bindEvents' });
      // Remove all listeners for this ChatManager context before rebinding
      if (typeof this.eventHandlers.cleanupListeners === 'function') {
        this.eventHandlers.cleanupListeners({ context: 'chatManager' });
        chatNotify.debug('Cleaned up existing chatManager event listeners before rebinding.', { source: '_bindEvents' });
      }

      const track = (element, event, fn, opts = {}) => {
        if (!element || !fn) return;
        const wrapped = safeInvoker(fn,
          { notify: chatNotify, errorReporter }, // Use validated chatNotify directly
          { context:'chatManager', module:'ChatManager', source: opts.description || event });
        this.eventHandlers.trackListener(element, event, wrapped, {
          ...opts,
          context: 'chatManager',
          source: 'ChatManager._bindEvents'
        });
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

      if (this.minimizeButton) {
        track(
          this.minimizeButton,
          "click",
          () => this._toggleChatVisibility(),
          { description: "Minimize / restore chat" }
        );
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
        if (e.detail) this.updateModelConfig(e.detail); // Internally logs
      }, { description: 'Model config changed event' });
      chatNotify.debug('UI events bound.', { source: '_bindEvents' });
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
      chatNotify.debug(`Showing message in UI. Role: ${role}, Content Length: ${content?.length || 0}`, {
        source: '_showMessage',
        role,
        messageId: id,
        hasThinking: !!thinking,
        isRedacted: redactedThinking
      });
      if (!this.messageContainer) {
        chatNotify.warn('Message container not found. Cannot show message.', { source: '_showMessage' });
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
      this.eventHandlers.trackListener(toggle, "click", handler, {
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
        chatNotify.debug('Chat input field cleared and focused.', { source: '_clearInputField' });
      } else {
        chatNotify.warn('Input field not found. Cannot clear.', { source: '_clearInputField' });
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
        chatNotify.debug(`Updated URL with conversationId: ${conversationId}. New URL: ${newUrl}`, { source: '_updateURLWithConversationId' });
      } else {
        chatNotify.debug(`URL already contains conversationId: ${conversationId}. No update needed.`, { source: '_updateURLWithConversationId' });
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
      chatNotify.debug(`Removed conversationId from URL. New URL: ${newUrl}`, { source: '_removeConversationIdFromURL' });
    }

    _showLoadingIndicator() {
      chatNotify.debug('Showing loading indicator.', { source: '_showLoadingIndicator' });
      if (!this.messageContainer) {
        chatNotify.warn('Message container not found. Cannot show loading indicator.', { source: '_showLoadingIndicator' });
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
        chatNotify.debug('Loading indicator hidden.', { source: '_hideLoadingIndicator' });
      }
    }

    _showThinkingIndicator() {
      chatNotify.debug('Showing thinking indicator.', { source: '_showThinkingIndicator' });
      if (!this.messageContainer) {
        chatNotify.warn('Message container not found. Cannot show thinking indicator.', { source: '_showThinkingIndicator' });
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
        chatNotify.debug('Thinking indicator hidden.', { source: '_hideThinkingIndicator' });
      }
    }

    /**
     * Renders an error block in the chat UI.
     * @private
     * @param {string} message
     */
    _showErrorMessage(message) {
      chatNotify.debug(`Showing error message in UI: "${message}"`, { source: '_showErrorMessage' });
      if (!this.messageContainer) {
        chatNotify.warn('Message container not found. Cannot show error message.', { source: '_showErrorMessage' });
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
        chatNotify.debug('All messages cleared from UI.', { source: '_clearMessages' });
      } else {
        chatNotify.warn('Message container not found. Cannot clear messages.', { source: '_clearMessages' });
      }
    }

    _renderMessages(messages) {
      chatNotify.debug(`Rendering ${messages?.length || 0} messages.`, { source: '_renderMessages', count: messages?.length || 0 });
      this._clearMessages(); // Internally logs
      if (!messages?.length) {
        this._showMessage("system", "No messages yet"); // Internally logs
        return;
      }
      messages.forEach((msg) => { // _showMessage logs internally
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
      // Use the contextual chatNotify
      chatNotify.error(`Error in context "${context}": ${message}`, {
        source: '_handleError',
        errorContext: context,
        originalError: error, // Pass the original error object for full Sentry reporting
        errorMessage: message
      });
    }
  } // end ChatManager class
  chatNotify.debug('ChatManager class defined. Instantiating...', { source: 'factory', phase: 'pre_instantiate' });
  const instance = new ChatManager();
  chatNotify.info('ChatManager instance created successfully.', { source: 'factory', phase: 'instantiated' });
  return instance;
}
