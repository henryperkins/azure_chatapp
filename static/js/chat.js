
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
 * Creates and returns a chat manager for handling chat UI, conversation lifecycle, message sending, authentication, and project context changes.
 *
 * The returned chat manager provides methods to initialize the chat UI, manage conversations (create, load, delete), send messages with queueing and abort handling, update model configuration, set images for vision models, and clean up resources. It integrates with injected dependencies for API requests, DOM manipulation, navigation, event handling, logging, and configuration, and uses an event bus for chat-related events.
 *
 * @param {Object} deps - Dependency injection object containing required APIs, services, and configuration.
 * @returns {Object} Chat manager instance with methods: initialize, sendMessage, createNewConversation, loadConversation, deleteConversation, setImage, updateModelConfig, cleanup, and chatBus.
 *
 * @throws {Error} If required dependencies are missing from {@link deps}.
 *
 * @remark
 * The chat manager automatically responds to global authentication and project context changes, disabling or re-initializing the chat UI as needed. It requires valid authentication and project selection to function.
 */

export function createChatManager(deps = {}) {
  const {
    apiRequest,
    app,
    eventHandlers,
    modelConfig,
    projectDetailsComponent,
    isValidProjectId,
    domAPI,
    navAPI,
    DOMPurify,
    apiEndpoints,
    domReadinessService,
    logger,
    DependencySystem,
    APP_CONFIG                // ← NEW (DI)
  } = deps;

  // Dependency-injected global replacements with defaults
  const {
    clock = { now: () => performance.now() },
    urlFactory = (base, search = {}) => {
      const u = new URL(base, navAPI?.getHref?.() || "/");
      Object.entries(search).forEach(([k, v]) => u.searchParams.set(k, v));
      return u;
    },
    eventBusFactory = () => new EventTarget(),
    URLSearchParams = globalThis.URLSearchParams,
    DateCtor = globalThis.Date,
  } = deps;

  if (!apiRequest) throw new Error('Missing apiRequest in createChatManager');
  if (!app) throw new Error('Missing app in createChatManager');
  if (!isValidProjectId) throw new Error('Missing isValidProjectId in createChatManager');
  if (!DOMPurify) throw new Error('Missing DOMPurify in createChatManager');
  if (!apiEndpoints) throw new Error('Missing apiEndpoints in createChatManager');
  if (!domReadinessService) throw new Error('Missing domReadinessService in createChatManager');
  if (!logger) throw new Error('Missing logger in createChatManager');
  if (!APP_CONFIG) throw new Error('Missing APP_CONFIG in createChatManager');

  // --- Dependency-injected global replacements with defaults (moved up) ---
  const _domAPI = domAPI || createDefaultDomAPI();
  const _navAPI = navAPI || createDefaultNavAPI();
  const _EH = eventHandlers || createDefaultEventHandlers({ domReadinessService, logger });


  // Use canonical safeHandler from DI, normalize for both direct function or object with .safeHandler (early bootstrap)
  const safeHandlerRaw = DependencySystem.modules.get('safeHandler');
  const safeHandler =
    typeof safeHandlerRaw === 'function'
      ? safeHandlerRaw
      : (typeof safeHandlerRaw?.safeHandler === 'function'
        ? safeHandlerRaw.safeHandler
        : (fn) => fn); // graceful fallback

  // --- Live Token Estimation Logic ---
  // (patch instance after construction, see after ChatManager)


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

    /**
     * Replace the (placeholder) ProjectDetailsComponent reference with the
     * final instance registered later by coreInit.
     * Called by coreInit once the definitive component is ready.
     */
    setProjectDetailsComponent(component) {
      if (component) this.projectDetails = component;
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const result = await task(controller.signal);
        clearTimeout(timeout);
        resolve(result);
      } finally {
        this.isProcessing = false;
        this.process();
      }
    }
  }

  class ChatManager {
    _api(endpoint, opts = {}, ctx = 'chatManager') {
      const { params, ...rest } = opts;
      if (params && typeof params === 'object') {
        const u = urlFactory(endpoint, params);
        endpoint = String(u);
      }
      return this.apiRequest(endpoint,
        { credentials: 'include', ...rest },
        ctx);
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
      this.DOMPurify = DOMPurify;
      this.chatBus = eventBusFactory();
      this.projectId = null;
      this.currentConversationId = null;
      this.isLoading = false;
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
      this.APP_CONFIG = APP_CONFIG;
      this._appEventListenersAttached = false; // Flag to ensure app/auth listeners are attached once
    }

    /**
     * Ensures UI utilities and methods are attached to the ChatManager instance.
     * @private
     */
    _ensureUIAttached() {
      if (!this._uiAttached) {
        logger.info("[ChatManager][_ensureUIAttached] Attaching UI utilities", { context: "chatManager" });
        // No-op: chatUIUtils is no longer used
        this._uiAttached = true;
      }
    }

    _setupAppEventListeners() {
      if (this._appEventListenersAttached) return;

      logger.debug(`[ChatManager] Setting up AppBus/AuthBus event listeners.`, { context: "chatManager" });
      const appBus = this.DependencySystem?.modules?.get('AppBus');
      const auth = this.DependencySystem?.modules?.get('auth');

      if (appBus) {
        this.eventHandlers.trackListener(appBus, 'currentProjectChanged',
          safeHandler(this._handleAppCurrentProjectChanged.bind(this), "_handleAppCurrentProjectChanged"),
          { context: 'chatManagerAppEvents', description: 'ChatManager_AppBus_CurrentProjectChanged' });
        logger.info(`[ChatManager] Subscribed to AppBus "currentProjectChanged".`, { context: "chatManager" });
      } else {
        logger.warn(`[ChatManager] AppBus not available. Cannot subscribe to "currentProjectChanged".`, { context: "chatManager" });
      }

      if (auth?.AuthBus) {
        this.eventHandlers.trackListener(auth.AuthBus, "authStateChanged",
          safeHandler(this._handleGlobalAuthStateChanged.bind(this), "_handleGlobalAuthStateChanged"),
          { context: 'chatManagerAppEvents', description: "ChatManager_AuthBus_AuthStateChanged" });
        logger.info(`[ChatManager] Subscribed to AuthBus "authStateChanged".`, { context: "chatManager" });
      } else {
        logger.warn(`[ChatManager] AuthBus not available. Cannot subscribe to "authStateChanged".`, { context: "chatManager" });
      }
      this._appEventListenersAttached = true;
    }


    /**
     * Initialize the chat manager with optional UI selectors or overrides.
     */
    async initialize(options = {}) {
      const _initStart = clock.now();
      logger.info(`[ChatManager][initialize] Starting initialization. Project ID: ${options.projectId}`, { options, currentInternalPid: this.projectId, context: "chatManager.initialize" });

      await this.domReadinessService.documentReady();

      await domReadinessService.dependenciesAndElements({
        deps: ['app', 'domAPI', 'eventHandlers', 'AppBus'], // Added AppBus
        context: 'ChatManager.init:core'
      });

      await domReadinessService.dependenciesAndElements({
        deps: ['auth'], // Auth is needed for AuthBus listener
        context: 'ChatManager.init:auth'
      });
      const auth = app?.DependencySystem?.modules?.get('auth') || null;

      this._ensureUIAttached(); // Ensure UI methods are available early
      this._setupAppEventListeners(); // Setup global event listeners if not already

      this.containerSelector = options.containerSelector || this.containerSelector;
      this.messageContainerSelector = options.messageContainerSelector || this.messageContainerSelector;
      this.inputSelector = options.inputSelector || this.inputSelector;
      this.sendButtonSelector = options.sendButtonSelector || this.sendButtonSelector;
      this.titleSelector = options.titleSelector || this.titleSelector;
      this.minimizeButtonSelector = options.minimizeButtonSelector || this.minimizeButtonSelector;

      try {
        if (!auth || !this.app.state.isAuthenticated) { // Check appModule state directly
          const msg = "User not authenticated. Cannot initialize ChatManager.";
          logger.warn(`[ChatManager][initialize] Auth check failed: ${msg}`, { context: "chatManager.initialize" });
          this.projectDetails?.disableChatUI?.("Not authenticated");

          // The global authStateChanged listener (_handleGlobalAuthStateChanged) should handle re-enabling if user logs in.
          // The specific _authChangeListener for retrying init might be redundant if global listener is effective.
          // For now, keeping it to see if it's needed for an initial load race condition.
          if (!this._authChangeListener && auth?.AuthBus) {
            this._authChangeListener = safeHandler(async (e) => {
              logger.info(`[ChatManager][initialize] _authChangeListener triggered by authStateChanged. Authenticated: ${e.detail?.authenticated}`, { context: "chatManager.initialize" });
              if (e.detail?.authenticated && (this.projectId || options.projectId)) { // Ensure projectId is available
                if (this._authChangeListener && auth?.AuthBus?.removeEventListener) { // Use optional chaining
                  auth.AuthBus.removeEventListener('authStateChanged', this._authChangeListener);
                  logger.debug(`[ChatManager][initialize] Removed temporary _authChangeListener.`, { context: "chatManager.initialize" });
                }
                this._authChangeListener = null; // Clear the listener
                // Re-attempt initialization with the project ID that was intended.
                const projectIdForRetry = options.projectId || this.projectId;
                logger.info(`[ChatManager][initialize] Re-attempting initialization after auth. Project ID: ${projectIdForRetry}`, { context: "chatManager.initialize" });
                await this.initialize({ ...options, projectId: projectIdForRetry });
              }
            }, "authChangeListenerForRetry");

            this.eventHandlers.trackListener(
              auth.AuthBus,
              'authStateChanged',
              this._authChangeListener,
              {
                context: 'chatManagerAuthRetryListener',
                description: 'Auth state change listener for chat initialization retry (specific to init failure)'
              }
            );
            logger.debug(`[ChatManager][initialize] Temporary _authChangeListener attached for re-init on auth.`, { context: "chatManager.initialize" });
          }
          throw new Error(msg);
        }

        // Clear the temporary auth change listener if auth is now okay and it was previously set
        if (this._authChangeListener && auth?.AuthBus) {
          eventHandlers.untrackListener(auth.AuthBus, 'authStateChanged', this._authChangeListener);
          logger.debug(`[ChatManager][initialize] Auth successful, removed temporary _authChangeListener.`, { context: "chatManager.initialize" });
          this._authChangeListener = null;
        }

        const newProjectId = options.projectId;
        logger.debug(`[ChatManager][initialize] Requested Project ID: ${newProjectId}, Current internal Project ID: ${this.projectId}`, { context: "chatManager.initialize" });

        // If no new projectId is provided, and internal one exists, use that.
        // This can happen if initialize is called to just refresh UI for current project.
        const targetProjectId = this.isValidProjectId(newProjectId) ? newProjectId : this.projectId;

        if (!this.isValidProjectId(targetProjectId)) {
          const noProjectMsg = `No valid project ID for ChatManager. Provided: ${newProjectId}, Internal: ${this.projectId}`;
          logger.error(`[ChatManager][initialize] ${noProjectMsg}`, { context: "chatManager.initialize" });
          this.projectDetails?.disableChatUI?.("No project selected");
          throw new Error(noProjectMsg);
        }

        // Project Switch Logic
        if (this._uiAttached && this.projectId && this.projectId !== targetProjectId) {
          logger.info(`[ChatManager][initialize] Project changed from ${this.projectId} to ${targetProjectId}. Clearing old project data.`, { context: "chatManager.initialize" });
          this._clearProjectSpecificData(); // Clear conversation list, current conversation, messages
        }
        this.projectId = targetProjectId; // Set the new project ID

        // UI Setup (ensure elements are present and events are bound)
        await this._setupUIElements(); // Resolves DOM elements based on selectors

        // Attach event handlers via chatUIEnhancements
        const chatUIEnh = DependencySystem.modules.get('chatUIEnhancements');
        chatUIEnh.attachEventHandlers({
          inputField        : this.inputField,
          sendButton        : this.sendButton,
          messageContainer  : this.messageContainer,
          onSend            : (txt)=>this.sendMessage(txt)
        });

        // If already initialized for this same project, could be a UI refresh or re-bind.
        if (this._uiAttached && this.projectId === targetProjectId) {
          logger.info(`[ChatManager][initialize] Already initialized for project ${this.projectId}. Re-checking conversation history / UI state.`, { context: "chatManager.initialize" });
          // Potentially reload current conversation if needed, or ensure UI is consistent.
          // _loadConversationHistory will handle loading last/URL-specified convo or creating new one.
          if (this.currentConversationId) {
            await this.loadConversation(this.currentConversationId); // Refresh current conversation view
          } else {
            await this._loadConversationHistory(); // Load history or new convo for current project
          }
          logger.info(`[ChatManager][initialize] Re-initialization for same project ${this.projectId} complete.`, { context: "chatManager.initialize" });
          return true;
        }

        // First time initialization for this project context (or after project switch)
        logger.info(`[ChatManager][initialize] Initializing for project ${this.projectId}. Loading history.`, { context: "chatManager.initialize" });
        await this._loadConversationHistory();

        // Setup "New Conversation" button
        const newConversationBtn = this.domAPI.getElementById("newConversationBtn"); // Assuming global button for now
        if (newConversationBtn) { // This button might be project-specific or global
          newConversationBtn.classList.remove("hidden");
          // Ensure listener is only added once or managed correctly if this init is called multiple times
          this.eventHandlers.cleanupListeners?.({ context: 'chatManagerNewConvoBtn' });
          this.eventHandlers.trackListener(
            newConversationBtn,
            "click",
            safeHandler(async () => {
              logger.debug(`[ChatManager] "New Conversation" button clicked. Current project: ${this.projectId}`, { context: "chatManager" });
              try {
                await this.createNewConversation(); // Uses this.projectId
              } catch (err) {
                logger.error("[ChatManager][New Conversation Button Click]", { error: err, context: "chatManager" });
                const chatUIEnh = DependencySystem.modules.get('chatUIEnhancements');
                chatUIEnh.appendMessage("system", "Failed to start new chat: " + (err?.message || "Unknown error"));
              }
            }, "NewConversationButtonClick"),
            { description: "New Conversation Button", context: "chatManagerNewConvoBtn" }
          );
        } else {
          logger.debug("[ChatManager][initialize] New Conversation button not found.", { context: "chatManager.initialize" });
        }

        this.chatBus?.dispatchEvent(new CustomEvent('chatManagerReady', { detail: { projectId: this.projectId } }));
        logger.info(`[ChatManager][initialize] Initialization successful for project ${this.projectId}. Duration: ${clock.now() - _initStart}ms`, { context: "chatManager.initialize" });
        return true;

      } catch (error) {
        logger.error(`[ChatManager][initialize] Initialization failed for project ${options.projectId || this.projectId}.`, { error: error, context: "chatManager.initialize" });
        const originalErrorMessage = this._extractErrorMessage(error);
        // Specific error handling for KB missing
        const chatUIEnh = DependencySystem.modules.get('chatUIEnhancements');
        if (originalErrorMessage.toLowerCase().includes("project has no knowledge base")) {
          const specificMessage = "Chat initialization failed: Project has no knowledge base. Please add one to enable chat.";
          chatUIEnh.appendMessage("system", specificMessage);
          this.projectDetails?.disableChatUI?.(specificMessage);
        } else if (!originalErrorMessage.includes("User not authenticated")) { // Don't show generic if auth was the issue
          chatUIEnh.appendMessage("system", `Chat error: ${originalErrorMessage}`);
        }
        return false;
      }
    }

    _clearProjectSpecificData() {
      logger.info(`[ChatManager][_clearProjectSpecificData] Clearing data for project ${this.projectId}.`, { context: "chatManager" });
      this.currentConversationId = null;
      this.loadPromise = null; // Cancel any ongoing load for the old project
      this.isLoading = false;
      const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
      if (this.messageContainer) {
        chatUIEnh.setMessageContainer(this.messageContainer);
        chatUIEnh.hideTypingIndicator();
        this.domAPI.replaceChildren(this.messageContainer);
      }
      this._clearConversationList && this._clearConversationList(); // Assumes this method exists or is added via UI utils
      if (this.titleElement) this.titleElement.textContent = "Chat"; // Reset title
      // this.projectId itself will be updated by the calling context (e.g., _handleAppCurrentProjectChanged or initialize)
    }

    _handleAppCurrentProjectChanged(event) {
      const newProject = event?.detail?.project;
      const oldProjectId = this.projectId;
      logger.info(`[ChatManager][_handleAppCurrentProjectChanged] Received. New: ${newProject?.id}, Old: ${oldProjectId}`, { detail: event.detail, context: "chatManager" });

      if (newProject?.id && newProject.id !== oldProjectId) {
        logger.info(`[ChatManager][_handleAppCurrentProjectChanged] Project changed to ${newProject.id}. Re-initializing chat.`, { context: "chatManager" });
        // Cleanup old project listeners and state before re-initializing
        this.eventHandlers.cleanupListeners?.({ context: 'chatManager:UI' }); // Clean UI specific listeners for the old project
        this._clearProjectSpecificData(); // Clear data related to oldProjectId

        // Re-initialize for the new project. Pass along current UI selectors.
        this.initialize({
          projectId: newProject.id,
          containerSelector: this.containerSelector,
          messageContainerSelector: this.messageContainerSelector,
          inputSelector: this.inputSelector,
          sendButtonSelector: this.sendButtonSelector,
          titleSelector: this.titleSelector,
          minimizeButtonSelector: this.minimizeButtonSelector
        }).catch(err => logger.error(`[ChatManager][_handleAppCurrentProjectChanged] Error during re-initialization for new project ${newProject.id}`, { error: err, context: "chatManager" }));
      } else if (!newProject && oldProjectId) {
        logger.info(`[ChatManager][_handleAppCurrentProjectChanged] Project context cleared. Cleaning up chat for project ${oldProjectId}.`, { context: "chatManager" });
        this._clearProjectSpecificData();
        this.projectId = null;
        this.projectDetails?.disableChatUI?.("No project selected");
        if (this.inputField) this.inputField.disabled = true;
        if (this.sendButton) this.sendButton.disabled = true;
      }
    }

    _handleGlobalAuthStateChanged(event) {
      const isAuthenticated = event?.detail?.authenticated;
      logger.info(`[ChatManager][_handleGlobalAuthStateChanged] Received. Authenticated: ${isAuthenticated}`, { detail: event.detail, context: "chatManager" });

      if (!isAuthenticated) {
        logger.info(`[ChatManager][_handleGlobalAuthStateChanged] User logged out. Cleaning up chat.`, { context: "chatManager" });
        this.cleanup(); // Full cleanup on logout
        this.projectDetails?.disableChatUI?.("Logged out");
        if (this.inputField) this.inputField.disabled = true;
        if (this.sendButton) this.sendButton.disabled = true;
      } else {
        // User logged in. If a projectId is already set (e.g. from URL or previous state),
        // try to re-initialize. This might also be handled by a subsequent currentProjectChanged event.
        logger.info(`[ChatManager][_handleGlobalAuthStateChanged] User authenticated.`, { currentProjectId: this.projectId, context: "chatManager" });
        if (this.projectId && !this._uiAttached) { // If a project context exists but chat not initialized
          logger.info(`[ChatManager][_handleGlobalAuthStateChanged] Attempting to re-initialize chat for project ${this.projectId} after auth.`, { context: "chatManager" });
          this.initialize({ projectId: this.projectId }).catch(err => logger.error(`[ChatManager][_handleGlobalAuthStateChanged] Error re-initializing post-auth`, { error: err, context: "chatManager" }));
        } else if (this.projectId && this._uiAttached) {
          if (this.inputField) this.inputField.disabled = false;
          if (this.sendButton) this.sendButton.disabled = false;
        }
      }
    }

    /**
     * Force synchronization of project ID from canonical appModule.state (appState.js)
     * @returns {string|null} The resolved project ID or null if none found
     */
    forceProjectIdSync() {
      logger.debug(`[ChatManager][forceProjectIdSync] Current project ID: ${this.projectId}`, { context: "chatManager" });

      // Get project ID from canonical appModule.state (appState.js)
      const appModule = this.DependencySystem?.modules?.get('appModule');
      const appProjectId = appModule?.state?.currentProjectId;

      if (this.isValidProjectId(appProjectId)) {
        logger.info(`[ChatManager][forceProjectIdSync] Synced project ID from appModule.state: ${appProjectId}`, {
          context: "chatManager",
          oldProjectId: this.projectId,
          newProjectId: appProjectId
        });
        this.projectId = appProjectId;
        return appProjectId;
      }

      // Try to get from URL as fallback
      const navigationService = this.DependencySystem?.modules?.get('navigationService');
      const urlProjectId = navigationService?.getUrlParams?.()?.project;

      if (this.isValidProjectId(urlProjectId)) {
        logger.info(`[ChatManager][forceProjectIdSync] Synced project ID from URL: ${urlProjectId}`, {
          context: "chatManager",
          oldProjectId: this.projectId,
          newProjectId: urlProjectId
        });
        this.projectId = urlProjectId;
        return urlProjectId;
      }

      logger.warn(`[ChatManager][forceProjectIdSync] Could not resolve valid project ID`, {
        context: "chatManager",
        currentProjectId: this.projectId,
        appProjectId,
        urlProjectId
      });

      return null;
    }

    /**
     * Called by coreInit once the definitive ProjectDetailsComponent
     * has been created.  Replaces the placeholder reference.
     */
    setProjectDetailsComponent(component) {
      if (component) {
        this.projectDetails = component;
      }
    }

    cleanup() {
      logger.info(`[ChatManager][cleanup] Cleaning up ChatManager for project ${this.projectId}.`, { context: "chatManager" });
      this.eventHandlers.cleanupListeners?.({ context: "chatManager:UI" });
      this.eventHandlers.cleanupListeners?.({ context: "chatManager" }); // General listeners for this manager instance
      this.eventHandlers.cleanupListeners?.({ context: "chatManagerNewConvoBtn" });
      this.eventHandlers.cleanupListeners?.({ context: 'chatManagerAuthRetryListener' });
      // Enforce full context cleanup as per codebase event pattern rule:
      this.eventHandlers.cleanupListeners?.({ context: "chatManagerAppEvents" }); // Clean global app/auth listeners

      // Rule 4: Ensure static checker sees a direct call inside the method.
      this.eventHandlers.cleanupListeners?.({ context: 'chatManager' });

      const chatUIEnh = this.DependencySystem?.modules?.get?.('chatUIEnhancements');
      chatUIEnh?.cleanup?.(); // Assuming this cleans up its own tracked listeners

      this._clearProjectSpecificData();
      this.projectId = null;
      // this.isGlobalMode = false; // If isGlobalMode is a relevant state
      this._uiAttached = false; // Allow UI to re-attach on next init

      // Clear the specific auth listener if it's still active
      const auth = this.DependencySystem?.modules?.get('auth');
      if (this._authChangeListener && auth?.AuthBus?.removeEventListener) {
        auth.AuthBus.removeEventListener('authStateChanged', this._authChangeListener);
        logger.debug(`[ChatManager][cleanup] Removed temporary _authChangeListener.`, { context: "chatManager" });
        this._authChangeListener = null;
      }
      logger.info(`[ChatManager][cleanup] Cleanup finished.`, { context: "chatManager" });
    }

    async loadConversation(conversationId) {
      if (!conversationId) {
        logger.warn("[ChatManager][loadConversation] No conversation ID provided", { context: "chatManager" });
        return false;
      }

      {
        // Centralized canonical authentication check
        const appModule = this.DependencySystem?.modules?.get('appModule');
        if (!appModule?.state?.isAuthenticated) {
          logger.warn("[ChatManager][loadConversation] User not authenticated", { context: "chatManager" });
          return false;
        }
      }

      // ENHANCED: Try to get project ID from multiple sources if not set
      if (!this.isValidProjectId(this.projectId)) {
        logger.warn(`[ChatManager][loadConversation] Invalid project ID (${this.projectId}), attempting to resolve from app state`, {
          context: "chatManager",
          conversationId,
          currentProjectId: this.projectId
        });

        // Try to get project ID from canonical appModule.state (appState.js)
        const appModule = this.DependencySystem?.modules?.get('appModule');
        const appProjectId = appModule?.state?.currentProjectId;

        if (this.isValidProjectId(appProjectId)) {
          logger.info(`[ChatManager][loadConversation] Found valid project ID from app state: ${appProjectId}`, {
            context: "chatManager",
            conversationId,
            resolvedProjectId: appProjectId
          });
          this.projectId = appProjectId;
        } else {
          // Try to get from URL as last resort
          const navigationService = this.DependencySystem?.modules?.get('navigationService');
          const urlProjectId = navigationService?.getUrlParams?.()?.project;

          if (this.isValidProjectId(urlProjectId)) {
            logger.info(`[ChatManager][loadConversation] Found valid project ID from URL: ${urlProjectId}`, {
              context: "chatManager",
              conversationId,
              resolvedProjectId: urlProjectId
            });
            this.projectId = urlProjectId;
          } else {
            const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot load conversation. App project: ${appProjectId}, URL project: ${urlProjectId}`;
            logger.error("[ChatManager][loading conversation]" + errorMsg, new Error(errorMsg), {
              context: "chatManager",
              conversationId,
              appProjectId,
              urlProjectId
            });
            const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
            chatUIEnh.appendMessage("system", "Cannot load conversation: invalid/missing project ID.");
            return false;
          }
        }
      }

      // Update the current conversation ID in token stats manager
      const tokenStatsManager = this.DependencySystem?.modules?.get('tokenStatsManager');
      if (tokenStatsManager?.fetchConversationTokenStats) {
        tokenStatsManager.fetchConversationTokenStats(conversationId);
      }

      const requestId = ++this.currentRequestId;
      if (this.loadPromise) {
        const result = await this.loadPromise;
        return requestId === this.currentRequestId ? result : false;
      }

      this.isLoading = true;
      const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
      chatUIEnh.showTypingIndicator();

      this.loadPromise = (async () => {
        try {
          if (this.messageContainer) {
            chatUIEnh.setMessageContainer(this.messageContainer);
            chatUIEnh.hideTypingIndicator();
            this.domAPI.replaceChildren(this.messageContainer);
          }

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
          if (this.messageContainer) {
            chatUIEnh.setMessageContainer(this.messageContainer);
            chatUIEnh.hideTypingIndicator();
            this.domAPI.replaceChildren(this.messageContainer);
            if (!messages?.length) {
              chatUIEnh.appendMessage("system", "No messages yet");
            } else {
              messages.forEach((msg) => {
                chatUIEnh.appendMessage(
                  msg.role,
                  msg.content,
                  msg.id,
                  msg.thinking,
                  msg.redacted_thinking
                );
              });
            }
          }
          this._updateURLWithConversationId(conversationId);

          // Update token stats for loaded conversation
          const tokenStatsManager = this.DependencySystem?.modules?.get('tokenStatsManager');
          if (tokenStatsManager?.fetchConversationTokenStats) {
            tokenStatsManager.fetchConversationTokenStats(conversationId);
          }

          return true;
        } catch (error) {
          logger.error("[ChatManager][loading conversation]", error, { context: "chatManager" });
          return false;
        } finally {
          this.isLoading = false;
          chatUIEnh.hideTypingIndicator();
          this.loadPromise = null;
        }
      })();

      return this.loadPromise;
    }

    async createNewConversation(overrideProjectId) {
      if (overrideProjectId) {
        this.projectId = this.isValidProjectId(overrideProjectId) ? overrideProjectId : this.projectId;
      }

      {
        // Centralized canonical authentication check
        const appModule = this.DependencySystem?.modules?.get('appModule');
        if (!appModule?.state?.isAuthenticated) {
          throw new Error("Not authenticated");
        }
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
        logger.info(`[ChatManager][createNewConversation] Using model config for new conversation. Model Name: ${cfg.modelName}`, { context: "chatManager", modelConfig: cfg });
        const currentUser = this.app?.state?.currentUser || {};

        const payload = {
          title: `New Chat ${(new DateCtor()).toLocaleString()}`,
          model_id: cfg.modelName || CHAT_CONFIG.DEFAULT_MODEL
        };
        if (currentUser.id) payload.user_id = currentUser.id;

        const convoEndpoint = typeof apiEndpoints.CONVERSATIONS === 'function'
          ? apiEndpoints.CONVERSATIONS(this.projectId)
          : String(apiEndpoints.CONVERSATIONS).replace('{id}', this.projectId);

        const response = await this._api(
          convoEndpoint,
          { method: "POST", body: payload, returnFullResponse: true }
        );

        // ------------------------------------------------------------------
        // Robust response-shape normalisation
        // ------------------------------------------------------------------
        const headers = response?.headers || {};
        let conversation =
          response?.data?.conversation      // { data:{conversation:{…}} }
          ?? response?.data                 // { data:{…} }
          ?? response?.conversation         // { conversation:{…} }
          ?? response                       // { …direct object… }
          ?? {};

        // If the object still wraps the actual convo in `conversation` key, unwrap it
        if (conversation?.conversation && typeof conversation.conversation === 'object') {
          conversation = conversation.conversation;
        }

        let convId =
          conversation?.id ??
          conversation?.conversation_id ??
          conversation?.uuid ??
          conversation?.conversationId ??
          null;

        // NEW ─ look at Location header if we still don’t have it
        if (!convId && headers.location) {
          const loc = headers.location;               // e.g. “…/conversations/<uuid>"
          convId = loc.split('/').filter(Boolean).pop();
        }

        // Normalise & fallback (old GET logic stays the same)
        if (!convId) {
          // fallback: try GET as before
          const getResp = await this._api(
            convoEndpoint,
            { method: "GET", params: { limit: 1, sort: "desc" } }
          );
          const conversations =
            getResp?.conversations                     // { conversations: [...] }
            ?? getResp?.data?.conversations            // { data: { conversations: [...] } }
            ?? (Array.isArray(getResp?.data)           // { data: [...] }
              ? getResp.data
              : Array.isArray(getResp)             // plain array response
                ? getResp
                : []);

          if (conversations.length) {
            const latest = conversations[0];
            convId =
              latest?.id ??
              latest?.conversation_id ??
              latest?.uuid ??
              latest?.conversationId ??
              null;

            if (!conversation) conversation = latest;
          }
        }

        if (!('id' in conversation) && convId) conversation = { ...(conversation || {}), id: convId };

        this.currentConversationId = convId;
        if (this.titleElement) {
          this.titleElement.textContent = conversation.title || "New Conversation";
        }
        this._updateURLWithConversationId(convId);

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

        if (errorMessage.includes("project has no knowledge base".toLowerCase())) {
          /* KB will be auto-created and ChatManager will be retried by
             ProjectManager ⇒ do NOT disable the chat UI now. */
          const msg = "Project has no knowledge base. Creating one…";
          this._showErrorMessage(msg);
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

      return this.messageQueue.add(async (abortSignal) => {
        {
          // Centralized canonical authentication check
          const appModule = this.DependencySystem?.modules?.get('appModule');
          if (!appModule?.state?.isAuthenticated) {
            return;
          }
        }
        if (!this.isValidProjectId(this.projectId)) {
          const errorMsg = `No valid project ID (${this.projectId}). Select a project before sending messages.`;
          logger.error("[ChatManager][sending message]" + errorMsg, new Error(errorMsg), { context: "chatManager" });
          const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
          chatUIEnh.appendMessage("system", errorMsg);
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

        const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
        chatUIEnh.appendMessage("user", messageText);
        if (this.inputField) {
          this.inputField.value = "";
          this.inputField.focus();
        }
        chatUIEnh.showTypingIndicator();

        try {
          const response = await this._sendMessageToAPI(messageText, abortSignal);
          this._processAssistantResponse(response);

          // Update token stats for the conversation after sending a message
          const tokenStatsManager = this.DependencySystem?.modules?.get('tokenStatsManager');
          if (tokenStatsManager?.fetchConversationTokenStats && this.currentConversationId) {
            tokenStatsManager.fetchConversationTokenStats(this.currentConversationId);
          }

          return response.data;
        } catch (error) {
          logger.error("[ChatManager][sending message]", error, { context: "chatManager" });
          chatUIEnh.hideTypingIndicator();

          const msg = this._extractErrorMessage(error);
          chatUIEnh.appendMessage("system", msg);

          /* Only disable chat UI for unrecoverable conditions */
          const critical =
            msg.toLowerCase().includes("knowledge base") ||
            String(error?.status).startsWith("4");          // auth / permission / missing KB

          if (critical) {
            this.projectDetails?.disableChatUI?.("Chat error: " + msg);
          }
        }
      });
    }

    async _sendMessageToAPI(messageText, abortSignal) {
      const cfg = this.modelConfigAPI.getConfig();
      const modelId = cfg.modelName || CHAT_CONFIG.DEFAULT_MODEL;   // required by API

      // ---- body expected by backend ----
      const userMsg = {
        raw_text: messageText,
        role: "user"
      };

      const payload = {
        new_msg: userMsg,                   // dict → OK
        vision_detail: cfg.visionDetail || "auto"
      };

      if (cfg.reasoningSummary) payload.reasoning_summary = cfg.reasoningSummary;
      if (this.currentImage) {
        this._validateImageSize();
        payload.image_data = this.currentImage;
        this.currentImage = null;
      }
      if (cfg.extendedThinking) {
        payload.thinking = { type: "enabled", budget_tokens: cfg.thinkingBudget };
      }
      // Attach enable_web_search if present in config (frontend)
      if (cfg.enable_web_search !== undefined) {
        payload.enable_web_search = !!cfg.enable_web_search;
      }

      // Send model_id as query-parameter, body as JSON
      return this._api(
        apiEndpoints.MESSAGES(this.projectId, this.currentConversationId),
        {
          method: "POST",
          params: { model_id: modelId },   // <-- added
          body: payload,
          signal: abortSignal
        }
      );
    }

    _validateImageSize() {
      if (
        typeof this.currentImage === "string" &&
        /^data:image\/(png|jpeg|webp|gif);base64,/i.test(this.currentImage)
      ) {
        const commaIdx = this.currentImage.indexOf(',');
        const b64 = commaIdx !== -1 ? this.currentImage.slice(commaIdx + 1) : this.currentImage;
        const sizeBytes = Math.floor((b64.length * 3) / 4);
        if (sizeBytes > CHAT_CONFIG.MAX_IMAGE_SIZE) {
          const errorMsg = `Image is too large (${(sizeBytes / (1024 * 1024)).toFixed(1)}MB). Max allowed: ${CHAT_CONFIG.MAX_IMAGE_SIZE / (1024 * 1024)}MB.`;
          throw new Error(errorMsg);
        }
      }
    }

    _processAssistantResponse(response) {
      const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
      chatUIEnh.hideTypingIndicator();
      if (response.data?.assistant_message) {
        const { assistant_message, thinking, redacted_thinking } = response.data;
        chatUIEnh.appendMessage(
          "assistant",
          assistant_message.content,
          null,
          thinking,
          redacted_thinking
        );

        // --- BEGIN: Token stats + truncation UI wiring ---
        const uiStats = assistant_message.token_stats || response.data.token_stats || {};
        const trunc = assistant_message.truncation_details || response.data.truncation_details || {};

        // Set token counts if UI elements exist
        if (this.domAPI.getElementById) {
          if (uiStats) {
            if (this.domAPI.getElementById('tokenStatInput')) this.domAPI.getElementById('tokenStatInput').textContent = uiStats.prompt_tokens_for_last_exchange || uiStats.prompt_tokens || "0";
            if (this.domAPI.getElementById('tokenStatCompletion')) this.domAPI.getElementById('tokenStatCompletion').textContent = uiStats.completion_tokens_for_last_exchange || "0";
            if (this.domAPI.getElementById('tokenStatContext')) this.domAPI.getElementById('tokenStatContext').textContent = uiStats.total_context_tokens_in_conversation || uiStats.current_tokens || "0";
            if (this.domAPI.getElementById('tokenStatContextMax')) this.domAPI.getElementById('tokenStatContextMax').textContent = uiStats.max_context_tokens_for_model || "0";
            if (this.domAPI.getElementById('tokenStatContextMessages')) this.domAPI.getElementById('tokenStatContextMessages').textContent = uiStats.message_count_in_context || "0";
          }

          // Handle UI truncation warning
          const warningEl = this.domAPI.getElementById('truncationWarning');
          if (warningEl) {
            if (trunc && trunc.is_truncated) {
              warningEl.textContent = `Context trimmed: ${trunc.messages_removed_count || 0} older msgs removed.`;
              this.domAPI.removeClass(warningEl, 'hidden');
            } else {
              this.domAPI.addClass(warningEl, 'hidden');
              warningEl.textContent = "";
            }
          }
        }
        // --- END: Token stats + truncation UI wiring ---

      } else if (response.data?.assistant_error) {
        const errMsg = this._extractErrorMessage(response.data.assistant_error);
        throw new Error(errMsg);
      }
    }

    async deleteConversation() {
      if (!this.currentConversationId) {
        return false;
      }
      {
        // Centralized canonical authentication check
        const appModule = this.DependencySystem?.modules?.get('appModule');
        if (!appModule?.state?.isAuthenticated) {
          return false;
        }
      }
      if (!this.isValidProjectId(this.projectId)) {
        const errorMsg = `Invalid or missing project ID (${this.projectId}). Cannot delete conversation.`;
        logger.error("[ChatManager][deleting conversation]" + errorMsg, new Error(errorMsg), { context: "chatManager" });
        this._showErrorMessage("Cannot delete conversation: invalid/missing project ID.");
        return false;
      }

      // Confirm via DI modal from chatUIEnhancements
      try {
        const chatUIEnh = this.DependencySystem?.modules?.get?.('chatUIEnhancements');
        let confirmDelete = true;
        if (chatUIEnh?.confirmDeleteConversationModal) {
          // Use titleElement for title if present
          const convoTitle = this.titleElement?.textContent || undefined;
          confirmDelete = await chatUIEnh.confirmDeleteConversationModal(convoTitle);
        }
        if (!confirmDelete) return false;

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
      logger.info("[ChatManager][updateModelConfig] Received config to update:", config, { context: "chatManager" });
      this.modelConfigAPI.updateConfig(config, { skipNotify: true });
      this.modelConfig = this.modelConfigAPI.getConfig();
      logger.info(`[ChatManager][updateModelConfig] Model config updated in chatManager. New modelName: ${this.modelConfig.modelName}`, { context: "chatManager", newConfig: this.modelConfig });
    }

    async _loadConversationHistory() {
      const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
      if (!this.projectId) {
        chatUIEnh.appendMessage("system", "Please select a project to start chatting.");
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
      if (typeof err?.data === 'string') return err.data;
      if (typeof err?.response?.data === 'string') return err.response.data;
      if (err?.data?.message) return String(err.data.message);
      if (err?.response?.data?.message) return String(err.response.data.message);
      if (err?.data?.detail) return String(err.data.detail);
      if (err?.response?.data?.detail) return String(err.response.data.detail);
      if (err?.detail) return String(err.detail);
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
      const chatUIEnh = this.DependencySystem.modules.get('chatUIEnhancements');
      if (!messages || !Array.isArray(messages) || !this.messageContainer) {
        return;
      }

      this._clearMessages();
      messages.forEach(message => {
        chatUIEnh.appendMessage(
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
        {
          timeout: this.APP_CONFIG?.TIMEOUTS?.CHAT_UI_READY ?? 8000,
          context: "chatManager::_setupUIElements"
        }
      );

      this.container = this.domAPI.querySelector(this.containerSelector);
      this.messageContainer = this.domAPI.querySelector(this.messageContainerSelector);
      this.inputField = this.domAPI.querySelector(this.inputSelector);
      this.sendButton = this.domAPI.querySelector(this.sendButtonSelector);
      this.titleElement = this.titleSelector
        ? this.domAPI.querySelector(this.titleSelector)
        : null;
      this.minimizeButton = this.minimizeButtonSelector
        ? this.domAPI.querySelector(this.minimizeButtonSelector)
        : null;

      if (!this.container || !this.messageContainer ||
        !this.inputField || !this.sendButton) {
        throw new Error("[ChatManager] Chat UI elements not found. Check selectors/template.");
      }

      this.domAPI.removeClass(this.container, "hidden");

      return true;
    }

  }

  const instance = new ChatManager();

  // --- Live Token Estimation Logic ---
  // Add debounced event listener to input field after UI setup
  // (called from initialize or _setupUIElements)
  instance._estimateCurrentInputTokens = async function () {
    // Only proceed if inputField, projectId, currentConversationId are set
    if (!this.inputField || !this.projectId || !this.currentConversationId) return;
    const currentInputText = this.inputField.value;
    if (!currentInputText.trim()) {
      const liveTokenCountEl = this.domAPI.getElementById && this.domAPI.getElementById('liveTokenCount');
      if (liveTokenCountEl) liveTokenCountEl.textContent = "0";
      // Update token stats manager if available
      const tokenStatsManager = this.DependencySystem?.modules?.get('tokenStatsManager');
      if (tokenStatsManager?.setInputTokenCount) {
        tokenStatsManager.setInputTokenCount(0);
      }
      return;
    }
    // Debounced call to backend endpoint for token estimation
    try {
      const resp = await this.apiRequest(
        `/api/projects/${this.projectId}/conversations/${this.currentConversationId}/estimate-tokens`,
        { method: "POST", body: { current_input: currentInputText } }
      );
      const est = (resp && resp.estimated_tokens_for_input !== undefined)
        ? resp.estimated_tokens_for_input
        : (resp && resp.data && resp.data.estimated_tokens_for_input) || null;
      const liveTokenCountEl = this.domAPI.getElementById && this.domAPI.getElementById('liveTokenCount');
      if (liveTokenCountEl && est !== null) liveTokenCountEl.textContent = String(est);

      // Update token stats manager if available
      const tokenStatsManager = this.DependencySystem?.modules?.get('tokenStatsManager');
      if (tokenStatsManager?.setInputTokenCount && est !== null) {
        tokenStatsManager.setInputTokenCount(est);
      }
    } catch (e) {
      logger.error("[ChatManager][_estimateCurrentInputTokens] Token estimation failed", e, { context: "chatManager" });
      const liveTokenCountEl = this.domAPI.getElementById && this.domAPI.getElementById('liveTokenCount');
      if (liveTokenCountEl) liveTokenCountEl.textContent = "N/A";
    }
  };

  // Attach debounced token estimator to chat input after UI is ready
  const addLiveTokenEstimationListener = (managerInstance) => {
    // Only if input field and required fields present
    if (
      managerInstance.inputField &&
      typeof managerInstance.inputField.addEventListener === "function" &&
      typeof managerInstance._estimateCurrentInputTokens === "function"
    ) {
      // Simple debounce helper, only attach ONCE
      if (!managerInstance._liveTokenListenerAttached) {
        let debounceTimeout = null;
        managerInstance.inputField.addEventListener("input", function () {
          clearTimeout(debounceTimeout);
          debounceTimeout = setTimeout(() => {
            try {
              managerInstance._estimateCurrentInputTokens();
            } catch (e) {
              logger.error("[ChatManager][addLiveTokenEstimationListener] Debounced estimation failed", e, { context: "chatManager" });
            }
          }, 400);
        });
        managerInstance._liveTokenListenerAttached = true;
      }
    }
  };

  // Patch chat manager initialize to add live token estimation wireup
  const origInit = instance.initialize.bind(instance);
  instance.initialize = async function (...args) {
    const out = await origInit(...args);
    // Try to wire up after UI elements are available
    if (this.inputField) {
      addLiveTokenEstimationListener(this);
    } else {
      // Fallback: try again after _setupUIElements
      const origSetup = this._setupUIElements?.bind(this);
      if (origSetup) {
        this._setupUIElements = async (...a) => {
          const z = await origSetup(...a);
          addLiveTokenEstimationListener(this);
          return z;
        };
      }
    }
    return out;
  };

  return {
    initialize: instance.initialize.bind(instance),
    sendMessage: instance.sendMessage.bind(instance),
    createNewConversation: instance.createNewConversation.bind(instance),
    loadConversation: instance.loadConversation.bind(instance),
    deleteConversation: instance.deleteConversation.bind(instance),
    setImage: instance.setImage.bind(instance),
    updateModelConfig: instance.updateModelConfig.bind(instance),
    setProjectDetailsComponent: (comp) => instance.setProjectDetailsComponent(comp),
    // Ensure eventHandlers.cleanupListeners is called directly in the module API, per .clinerules contract
    cleanup: () => {
      if (eventHandlers && eventHandlers.cleanupListeners) {
        eventHandlers.cleanupListeners({ context: "chatManager" });
      }
      instance.cleanup();
    },
    chatBus: instance.chatBus
  };
}
