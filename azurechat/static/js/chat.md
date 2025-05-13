```javascript
import { wrapApi, safeInvoker, maybeCapture } from "./utils/notifications-helpers.js";
import { attachChatUI }                       from "./chat-ui-utils.js";
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
    // Allow domAPI to be initially undefined if chat is initialized headless or UI is deferred
    // throw new Error('[ChatManager Factory] Critical: Injected `domAPI` dependency is missing or lacks `getDocument` method.');
  }
  // Further validation for domAPI.getDocument().dispatchEvent will be done after getting the document object.
  if (!apiRequest) throw new Error('[ChatManager Factory] apiRequest is required.');
  if (!app) throw new Error('[ChatManager Factory] app is required.');
  // Allow eventHandlers to be initially undefined if chat is initialized headless or UI is deferred
  // if (!eventHandlers) throw new Error('[ChatManager Factory] eventHandlers is required.');
  if (!isValidProjectId) throw new Error('[ChatManager Factory] isValidProjectId is required.');
  if (!isAuthenticated) throw new Error('[ChatManager Factory] isAuthenticated is required.');
  if (!DOMPurify) throw new Error('[ChatManager Factory] DOMPurify is required.');
  if (!apiEndpoints) throw new Error('[ChatManager Factory] apiEndpoints is required.');

  // DependencySystem is crucial for waitFor
  const DependencySystem = app.DependencySystem; // Assuming app has DependencySystem
  if (!DependencySystem) throw new Error('[ChatManager Factory] DependencySystem is required (via app).');


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
      this.containerSelector = null; // For storing selector from init options
      this.messageContainerSelector = null;
      this.inputSelector = null;
      this.sendButtonSelector = null;
      this.minimizeButtonSelector = null;
      this._authChangeListener = null; // To store the auth listener for cleanup

      // Local copy of the model config
      this.modelConfig = this.modelConfigAPI.getConfig();
      this.DependencySystem = DependencySystem; // Store DependencySystem

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

      attachChatUI(this, {
        domAPI      : this.domAPI,
        DOMPurify   : this.DOMPurify,
        eventHandlers: this.eventHandlers,
        notify      : chatNotify,
        errorReporter
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
     * @param {string} [options.titleSelector] // titleSelector is still used for chat title
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

      // Guardrail #10 – wait until the core app (and DOM helpers) are ready
      await this.DependencySystem.waitFor?.(['app', 'domAPI', 'eventHandlers']);

      // Store selectors from options
      this.containerSelector = options.containerSelector || "#chatUI"; // Default if not provided
      this.messageContainerSelector = options.messageContainerSelector || "#conversationArea";
      this.inputSelector = options.inputSelector || "#chatInput";
      this.sendButtonSelector = options.sendButtonSelector || "#sendBtn";
      this.titleSelector = options.titleSelector || "#chatTitle"; // Keep titleSelector
      this.minimizeButtonSelector = options.minimizeButtonSelector || "#minimizeChatBtn";


      try {
        // Wait for auth module to be ready
        await this.DependencySystem.waitFor(['auth']);
        const auth = this.DependencySystem.modules.get('auth');

        if (!auth || !auth.isAuthenticated()) {
          const msg = "User not authenticated. Cannot initialize ChatManager.";
          // this._showErrorMessage(msg); // Don't show UI error if UI elements might not exist yet
          this._handleError("initialization - not authenticated", msg);
          this.projectDetails?.disableChatUI?.("Not authenticated");
          chatNotify.error(msg, { source: 'initialize', critical: true });

          // Listen for auth state changes to retry initialization
          if (!this._authChangeListener && auth?.AuthBus) {
            this._authChangeListener = async (e) => {
              if (e.detail?.authenticated && this.projectId) { // Check if projectId is set
                chatNotify.info("Auth state changed to authenticated, retrying chat initialization", { source: 'authListener', projectId: this.projectId });
                // Ensure eventHandlers is available before tracking
                if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
                    this.eventHandlers.cleanupListeners({ context: 'chatManagerAuthRetryListener' });
                }
                if (this._authChangeListener && auth?.AuthBus?.removeEventListener) {
                    auth.AuthBus.removeEventListener('authStateChanged', this._authChangeListener);
                }
                this._authChangeListener = null; // Clear listener after use
                await this.initialize({ // Pass original or current options
                    projectId: this.projectId, // Use the currently set projectId
                    containerSelector: this.containerSelector,
                    messageContainerSelector: this.messageContainerSelector,
                    inputSelector: this.inputSelector,
                    sendButtonSelector: this.sendButtonSelector,
                    titleSelector: this.titleSelector,
                    minimizeButtonSelector: this.minimizeButtonSelector
                });
              }
            };
            // Ensure eventHandlers is available before tracking
            if (this.eventHandlers && typeof this.eventHandlers.trackListener === 'function') {
                this.eventHandlers.trackListener(auth.AuthBus, 'authStateChanged', this._authChangeListener, {
                    context: 'chatManagerAuthRetryListener', // Unique context for this listener
                    description: 'Auth state change listener for chat initialization retry'
                });
            } else {
                auth?.AuthBus?.addEventListener('authStateChanged', this._authChangeListener);
                chatNotify.warn('eventHandlers.trackListener not available for auth retry, using direct addEventListener.', {source: 'initialize'});
            }
          }
          throw new Error(msg); // Propagate error to stop further execution in this attempt
        }

        // If already initialized for the same project, re-bind UI if selectors changed, otherwise skip.
        const requestedProjectId = options.projectId && this.isValidProjectId(options.projectId)
          ? options.projectId
          : this.projectId; // Fallback to current if options.projectId is not valid

        if (this.isInitialized && this.projectId === requestedProjectId) {
          chatNotify.warn(`Already initialized for project ${requestedProjectId}. Re-binding UI if selectors changed...`, { source: 'initialize', projectId: requestedProjectId });
          // Only re-setup and re-bind if selectors might have changed or if forced
          // For simplicity, we can re-setup and re-bind.
          await this._setupUIElements(); // Use stored selectors
          this._setupEventListeners();   // Use stored selectors
          chatNotify.info(`ChatManager initialize (rebinding) completed for project ${requestedProjectId}.`, { source: 'initialize', phase: 'rebind_complete', durationMs: (performance.now() - _initStart).toFixed(2) });
          return true;
        }

        // Store projectId if provided and valid
        if (options.projectId && this.isValidProjectId(options.projectId)) {
            this.projectId = options.projectId;
        } else if (!this.projectId && requestedProjectId) { // If this.projectId isn't set, use requested if valid
            this.projectId = requestedProjectId;
        }


        if (!this.projectId) {
            const noProjectMsg = "No valid project ID provided for ChatManager initialization.";
            chatNotify.error(noProjectMsg, { source: 'initialize' });
            throw new Error(noProjectMsg);
        }

        this.isGlobalMode = !this.isValidProjectId(this.projectId); // Recalculate global mode

        // If switching projects, reset relevant state
        if (this.isInitialized && this.projectId !== requestedProjectId) {
            chatNotify.info(`Switching project context. Resetting chat state. From ${this.projectId} to ${requestedProjectId}`, { source: 'initialize' });
            this.currentConversationId = null;
            this.loadPromise = null;
            this.isLoading = false;
            if(this.messageContainer) this._clearMessages(); // Clear messages only if UI is set up
        }
        this.projectId = requestedProjectId; // Update to the new project ID


        await this._setupUIElements(); // Uses stored selectors
        this._setupEventListeners();   // Uses stored selectors

        const newConversationBtn = this.domAPI.getElementById("newConversationBtn");
        if (newConversationBtn) {
            newConversationBtn.classList.remove("hidden");
            if (typeof this.eventHandlers.cleanupListeners === 'function') {
                this.eventHandlers.cleanupListeners({ context: 'chatManager:newConvoBtn' });
            }
            this.eventHandlers.trackListener(
                newConversationBtn,
                "click",
                safeInvoker(async () => {
                    try {
                        await this.createNewConversation();
                    } catch (err) {
                        this._handleError("New Conversation Button", err);
                        this._showErrorMessage("Failed to start new chat: " + (err?.message || err));
                        maybeCapture(errorReporter, err, { module:'ChatManager', source:'newConversationBtn', context:'ui', originalError:err });
                    }
                }, { notify: this.notify, errorReporter: this.errorReporter }),
                { description: "New Conversation Button", context: "chatManager:newConvoBtn", source: "ChatManager.initialize" }
            );
        }

        if (this.isGlobalMode) {
            chatNotify.info("Starting in global (no-project) mode.", { source: 'initialize' });
            if(this.messageContainer) this._clearMessages();
            if(this.messageContainer) this._showMessage("system", "Select a project or start a new global chat.");
            this.isInitialized = true;
            chatNotify.info(`ChatManager initialized (global mode).`, { source: 'initialize', phase: 'complete_global', durationMs: (performance.now() - _initStart).toFixed(2) });
            return true;
        }

        chatNotify.info(`Initializing for project ID: ${this.projectId}`, { source: 'initialize' });

        // Load conversation history or start new one
        await this._loadConversationHistory(); // This will also handle URL params for chatId

        this.isInitialized = true;
        chatNotify.info(`ChatManager initialized (project mode for ${this.projectId}).`, { source: 'initialize', phase: 'complete_project', durationMs: (performance.now() - _initStart).toFixed(2) });
        return true;

      } catch (error) {
        // Error already logged by specific failure points or _handleError
        this.isInitialized = false; // Ensure state reflects failure
        const initEndMs = performance.now() - _initStart;
        chatNotify.error(`ChatManager initialization failed after ${initEndMs.toFixed(2)}ms`, {
            source: 'initializeCatchAll',
            originalError: error, // Keep original error for context
            projectId: this.projectId, // Log current projectId context
            optionsUsed: options // Log options that led to failure
        });
        maybeCapture(errorReporter, error, { module:'ChatManager', source:'initialize', context:'initialization', originalError:error });
        // Do not re-throw here if we want the app to continue running,
        // but allow projectDetailsComponent to know about the failure if needed.
        // Or, re-throw if chat is critical for the view.
        // For now, let's not re-throw to allow other parts of UI to function.
        // Check for specific "Project has no knowledge base" error to provide better feedback
        const originalErrorMessage = this._extractErrorMessage(error.originalError || error);
        if (originalErrorMessage.includes("Project has no knowledge base")) {
          const specificMessage = "Chat initialization failed: Project has no knowledge base. Please add one to enable chat.";
          this._showErrorMessage(specificMessage); // Show in chat UI
          this.projectDetails?.disableChatUI?.(specificMessage); // Update project details component
          chatNotify.warn(specificMessage, { source: 'initializeCatchAll', projectId: this.projectId });
        }
        return false; // Indicate failure
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

          const conversation =
                conversationResponse?.data?.conversation            // {status:'success',data:{conversation:{…}}}
             ?? conversationResponse?.data                          // {status:'success',data:{…}}
             ?? conversationResponse?.conversation                  // {conversation:{…}}
             ?? conversationResponse;                               // fallback (object itself)

          if (!conversation?.id) {
            chatNotify.error('Validation failed: "conversation" object missing ID.', {
              source: 'loadConversation', responsePreview: conversationResponse
            });
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
          maybeCapture(errorReporter, error, { module:'ChatManager', source:'loadConversation', context:'api', originalError:error });
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

        const conversation =
              response?.data?.conversation
           ?? response?.data
           ?? response?.conversation
           ?? response;

        if (!conversation?.id) {
          chatNotify.error('Server response missing valid conversation ID.', {
            source: 'createNewConversation', responsePreview: response
          });
          throw new Error('Server response missing conversation ID');
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
        const errorMessage = this._extractErrorMessage(error);
        this._handleError("creating new conversation", error); // Already logs
        maybeCapture(errorReporter, error, { module:'ChatManager', source:'createNewConversation', context:'api', originalError:error });

        if (errorMessage.includes("Project has no knowledge base")) {
          const specificMessage = "Project has no knowledge base. Please add one to enable chat.";
          this._showErrorMessage(specificMessage);
          this.projectDetails?.disableChatUI?.(specificMessage);
          chatNotify.warn("Chat disabled: Project has no knowledge base.", { source: 'createNewConversation' });
        } else {
          this._showErrorMessage("Failed to create conversation: " + errorMessage);
          this.projectDetails?.disableChatUI?.("Chat error: " + errorMessage);
        }
        throw error; // This re-throws the error
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
            maybeCapture(errorReporter, error, { module:'ChatManager', source:'sendMessageTask', context:'api', originalError:error });
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
        maybeCapture(errorReporter, error, { module:'ChatManager', source:'deleteConversation', context:'api', originalError:error });
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

    // UI methods moved to chat-ui-utils.js via attachChatUI
    async _loadConversationHistory() {
        if (!this.projectId) {
            chatNotify.warn('Cannot load conversation history: no project ID', { source: '_loadConversationHistory' });
            if(this.messageContainer) this._showMessage("system", "Please select a project to start chatting.");
            return;
        }
        chatNotify.info('Loading conversation history or starting new.', { source: '_loadConversationHistory', projectId: this.projectId });

        const urlParams = new URLSearchParams(this.navAPI.getSearch());
        const urlChatId = urlParams.get('chatId');

        if (urlChatId) {
            chatNotify.info(`Found chatId=${urlChatId} in URL, attempting to load specific conversation...`, { source: '_loadConversationHistory', chatId: urlChatId });
            const loadedSuccessfully = await this.loadConversation(urlChatId);
            if (loadedSuccessfully) {
                return; // Specific conversation loaded
            }
            chatNotify.warn(`Failed to load specific conversation ${urlChatId} from URL. Will try to load latest or create new.`, { source: '_loadConversationHistory' });
            this._removeConversationIdFromURL(); // Remove invalid/failed chatId
        }

        // If no specific chat ID in URL, or if it failed to load, try to get latest or create new.
        try {
            // The _api method (via wrapApi) should already return the 'data' part of the response,
            // or the full JSON if it's not wrapped with {status: 'success', data: ...}
            const responseData = await this._api(apiEndpoints.CONVERSATIONS(this.projectId), { method: 'GET', params: { limit: 1, sort: 'desc' } });

            // Adapt to how _api and wrapApi return data.
            // Common patterns: responseData.conversations, or responseData directly if it's an array.
            const conversations = responseData?.conversations || (Array.isArray(responseData) ? responseData : []);

            if (conversations && conversations.length > 0) {
                this.currentConversationId = conversations[0].id;
                if (this.titleElement) this.titleElement.textContent = conversations[0].title || "Conversation";
                await this._loadMessages(this.currentConversationId);
                this._updateURLWithConversationId(this.currentConversationId); // Update URL if we picked the latest
            } else {
                await this.createNewConversation(); // This will set currentConversationId and update URL
            }
            chatNotify.info('Conversation history loaded/initiated.', { source: '_loadConversationHistory', conversationId: this.currentConversationId });
        } catch (error) {
            chatNotify.error('Failed to load or create initial conversation.', { source: '_loadConversationHistory', originalError: error });
            await this.createNewConversation(); // Fallback to creating a new one on error
        }
    }

    async _loadMessages(conversationId) {
        if (!conversationId) {
            chatNotify.warn('Cannot load messages: no conversation ID', { source: '_loadMessages' });
            return;
        }
        if (!this.messageContainer) {
            chatNotify.error('Cannot load messages: messageContainer is not available.', { source: '_loadMessages' });
            return;
        }
        chatNotify.info('Loading messages', { source: '_loadMessages', conversationId });
        this._showLoadingIndicator(); // Show loading indicator for messages

        try {
            const response = await this._api(apiEndpoints.MESSAGES(this.projectId, conversationId), { method: 'GET' });
            const messages = response?.messages || response?.data?.messages || response || []; // Adapt to actual response structure

            this._clearMessages(); // Clear existing messages
            messages.forEach(message => {
                this._showMessage(message.role, message.content, message.id, message.thinking, message.redacted_thinking);
            });
            if (this.messageContainer) {
                 this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
            }
            chatNotify.info(`Loaded ${messages.length} messages`, { source: '_loadMessages', conversationId });
        } catch (error) {
            chatNotify.error('Failed to load messages', { source: '_loadMessages', originalError: error, conversationId });
            this._showErrorMessage('Failed to load messages. Please try again.');
            this._handleError('_loadMessages', error);
            maybeCapture(errorReporter, error, { module:'ChatManager', source:'_loadMessages', context:'api', originalError:error });
        } finally {
            this._hideLoadingIndicator();
        }
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

    _extractErrorMessage(err) {
      if (!err) return "Unknown error occurred";
      if (typeof err === "string") return err;
      if (err.message) return err.message;
      try {
        return JSON.stringify(err);
      } catch (jsonErr) {
        if (errorReporter?.capture) {
          errorReporter.capture(jsonErr, {
            module : 'ChatManager',
            source : '_extractErrorMessage',
            originalError: jsonErr
          });
        }
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
      /* Guardrail #8 – context-rich error logging */
      if (errorReporter?.capture) {
        errorReporter.capture(error, {
          module : 'ChatManager',
          source : '_handleError',
          context,
          originalError: error
        });
      }
    }
  } // end ChatManager class
  chatNotify.debug('ChatManager class defined. Instantiating...', { source: 'factory', phase: 'pre_instantiate' });
  const instance = new ChatManager();
  chatNotify.info('ChatManager instance created successfully.', { source: 'factory', phase: 'instantiated' });
  return instance;
}

```