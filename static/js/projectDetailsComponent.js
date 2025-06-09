/*
// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
*/
/*
// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
*/
import { getSafeHandler } from './utils/getSafeHandler.js';
import { SELECTORS } from './utils/selectorConstants.js';
const MODULE_CONTEXT = "ProjectDetailsComponent";

export function createProjectDetailsComponent({
  domAPI,
  htmlTemplateLoader,
  domReadinessService,
  eventHandlers,
  navigationService,
  sanitizer,
  logger,
  projectManager,
  APP_CONFIG,
  modalManager = null,
  FileUploadComponentClass = null,
  knowledgeBaseComponent = null,
  modelConfig = null,
  chatManager = null,
  apiClient = null,
  app = null,
  DependencySystem,
  authenticationService = null,
  // Phase-1.3: Additional DI compliance parameters
  uiRenderer = null,
  uiUtils = null,
  authModule = null,
  tokenStatsManager = null,
  chatUIEnhancements = null,
  projectContextService = null,
  // Phase-2: Extracted modules
  projectDetailsRenderer = null,
  projectDataCoordinator = null,
  projectEventHandlers = null,
  // Phase-2.3: State and event services
  uiStateService = null,
  eventService = null
} = {}) {
  const missing = [];
  if (!domAPI) missing.push("domAPI");
  if (!htmlTemplateLoader) missing.push("htmlTemplateLoader");
  if (!domReadinessService) missing.push("domReadinessService");
  if (!eventHandlers) missing.push("eventHandlers");
  if (!navigationService) missing.push("navigationService");
  if (!sanitizer) missing.push("sanitizer");
  if (!logger) missing.push("logger");
  if (!uiUtils) missing.push("uiUtils");
  if (!projectDetailsRenderer) missing.push("projectDetailsRenderer");
  if (!projectDataCoordinator) missing.push("projectDataCoordinator");
  if (!uiStateService) missing.push("uiStateService");
  if (!eventService) missing.push("eventService");
  if (!projectContextService) missing.push("projectContextService");
  if (missing.length) {
    if (logger && logger.error) {
      logger.error(`[${MODULE_CONTEXT}] Missing required dependencies: ${missing.join(", ")}`, { context: MODULE_CONTEXT });
    }
    throw new Error(`[${MODULE_CONTEXT}] Missing required dependencies: ${missing.join(", ")}`);
  }
  const formatDate = uiUtils.formatDate || (() => '');
  const formatBytes = uiUtils.formatBytes || (() => '');

  // Resolve authentication service
  const _authService = authenticationService;

  const instance = new ProjectDetailsComponent({
    domAPI,
    htmlTemplateLoader,
    domReadinessService,
    eventHandlers,
    navigationService,
    sanitizer,
    logger,
    projectManager,
    APP_CONFIG,
    modalManager,
    FileUploadComponentClass,
    knowledgeBaseComponent,
    modelConfig,
    chatManager,
    apiClient,
    app,
    DependencySystem,
    formatDate,    // pass to class instance for internal use
    formatBytes,
    authenticationService: _authService,
    // Phase-1.3: Additional DI compliance dependencies
    uiRenderer,
    authModule,
    tokenStatsManager,
    chatUIEnhancements,
    projectContextService,
    // Phase-2: Extracted modules
    projectDetailsRenderer,
    projectDataCoordinator,
    projectEventHandlers,
    // Phase-2.3: State and event services
    uiStateService,
    eventService
  });

  // Expose only the canonical public API for compliance (no dynamic shape)
  return {
    /**
     * Show the project details view.
     */
    show: (...args) => instance.show(...args),
    /**
     * Hide the project details view.
     */
    hide: (...args) => instance.hide(...args),
    /**
     * Initialize the component.
     */
    initialize: (...args) => instance.initialize(...args),
    /**
     * Render the given project object to the UI.
     */
    renderProject: (...args) => instance.renderProject(...args),
    /**
     * Inject or replace the KnowledgeBaseComponent instance after creation.
     * Needed by UIInit during bootstrap.
     */
    setKnowledgeBaseComponent: (...args) =>
      instance.setKnowledgeBaseComponent(...args),
    /**
     * Cleanup logic for ProjectDetailsComponent: detaches listeners, aborts async, and hides UI.
     * Ensures compliance with frontend pattern rules.
     */
    cleanup: () => {
      eventHandlers.cleanupListeners({ context: "ProjectDetailsComponent" });
      instance.cleanup();
      instance.uiStateService.clearState('ProjectDetailsComponent');
    }
  };
}

class ProjectDetailsComponent {
  constructor(deps) {
    this.domAPI = deps.domAPI;
    this.htmlTemplateLoader = deps.htmlTemplateLoader;
    this.domReadinessService = deps.domReadinessService;
    this.eventHandlers = deps.eventHandlers;
    this.navigationService = deps.navigationService;
    this.sanitizer = deps.sanitizer;
    this.logger = deps.logger;
    this.projectManager = deps.projectManager;
    this.APP_CONFIG = deps.APP_CONFIG || {};
    this.modalManager = deps.modalManager;
    this.FileUploadComponentClass = deps.FileUploadComponentClass;
    this.knowledgeBaseComponent = deps.knowledgeBaseComponent;
    // Phase-1.3: Use injected dependencies instead of runtime lookups
    this.app = deps.app;
    this.modelConfig = deps.modelConfig;

    // Store DI container for later safe look-ups
    this.DependencySystem = deps.DependencySystem;
    this.chatManager = deps.chatManager;
    this.apiClient = deps.apiClient;

    // Phase-2.3: Centralised project context (injected only – no runtime lookup)
    this.projectContextService = deps.projectContextService;

    if (!this.projectContextService?.getCurrentProjectId) {
      throw new Error('[ProjectDetailsComponent] projectContextService dependency missing or invalid');
    }

    // Phase-1.3: Use injected uiRenderer instead of runtime lookup
    this.uiRenderer = deps.uiRenderer;

    // Phase-2: Store extracted modules
    this.projectDetailsRenderer = deps.projectDetailsRenderer;
    this.projectDataCoordinator = deps.projectDataCoordinator;

    // Bridge legacy instance methods expected by earlier template listeners to
    // the new extracted modules, preserving single-source logic
    this.renderFiles = (files) => {
      const container = this.elements?.filesList;
      if (!container) return;
      this.projectDetailsRenderer?.renderFiles?.(files, {
        container,
        onDownload: (fileId, fileName) => this._delegateDownloadFile(fileId, fileName),
        onDelete: (fileId, fileName) => this._delegateDeleteFile(fileId, fileName),
        listenersContext: this.listenersContext
      });
    };

    this.renderConversations = (projectId, searchTerm) => {
      // This method is used by sidebar rendering - delegate to uiRenderer for sidebar
      if (this.uiRenderer?.renderConversations) {
        this.uiRenderer.renderConversations(projectId, searchTerm);
      }
    };

    this.renderArtifacts = (artifacts) => {
      const container = this.elements?.artifactsList;
      if (!container) return;
      this.projectDetailsRenderer?.renderArtifacts?.(artifacts, {
        container,
        onDownload: (projectId, artifactId) => this._delegateDownloadArtifact(projectId, artifactId),
        projectId: this.projectId,
        listenersContext: this.listenersContext
      });
    };

    this.renderProjectData = (...a) => this.projectDetailsRenderer?.renderProjectData?.(...a);
    this.containerId = "projectDetailsView";
    this.templatePath = "/static/html/project_details.html";

    // ------------------------------------------------------------------
    // Centralised projectId binding – alias property to ProjectContextService
    // ------------------------------------------------------------------
    Object.defineProperty(this, 'projectId', {
      get: () => this.projectContextService.getCurrentProjectId(),
      set: (val) => {
        try {
          const curr = this.projectContextService.getCurrentProjectId();
          if (val !== curr && this.projectContextService.isValidProjectId(val)) {
            if (this.app?.setCurrentProjectId) {
              this.app.setCurrentProjectId(val);
            }
          }
        } catch (err) {
          this.logger?.warn?.('[ProjectDetailsComponent] failed to set projectId via property setter', {
            context: MODULE_CONTEXT,
            err: err?.message
          });
        }
      },
      configurable: true
    });

    // Remove local state object
    // this.state = { ... }

    this.projectData = null;
    this.listenersContext = MODULE_CONTEXT + "_listeners";
    // this.bus = new EventTarget();
    this.fileUploadComponent = null;
    this.elements = {};
    // Phase-1.3: Store injected authModule instead of runtime lookup
    this.auth = deps.authModule;
    // Utilities injected via factory (globalUtils) for consistent formatting
    this.formatDate = typeof deps.formatDate === 'function' ? deps.formatDate.bind(this) : undefined;
    this.formatBytes = typeof deps.formatBytes === 'function' ? deps.formatBytes.bind(this) : undefined;
    // Canonical safeHandler accessor (single source of truth)
    this.safeHandler = getSafeHandler(this.DependencySystem);
    // Track single KBC bootstrap log/noise
    this._kbcFirstWarned = false;

    // Store centralized authentication service
    this.authenticationService = deps.authenticationService;

    // Phase-1.3: Store additional injected dependencies
    this.tokenStatsManager = deps.tokenStatsManager;
    this.chatUIEnhancements = deps.chatUIEnhancements;

    // Use centralized authentication service or fallback to direct appModule access
    this._isAuthenticated = () => {
      if (this.authenticationService?.isAuthenticated) {
        return this.authenticationService.isAuthenticated();
      }
      // Phase-1.3: Use injected app dependency instead of runtime lookup
      return Boolean(this.app?.state?.isAuthenticated);
    };

    this.uiStateService = deps.uiStateService;
    this.eventService = deps.eventService;
  }

  setProjectManager(pm) {
    this.projectManager = pm;
    if (this.projectDataCoordinator && pm) {
      if (typeof this.projectDataCoordinator.setProjectManager === 'function') {
        this.projectDataCoordinator.setProjectManager(pm);
      } else {
        this.projectDataCoordinator.projectManager = pm;
      }
    }
    this._logInfo('ProjectManager set, emitting projectManagerReady event', { hasProjectManager: !!pm });
    try {
      this.eventService.emit('projectManagerReady', { projectManager: pm });
      this._logInfo('projectManagerReady event emitted successfully');
    } catch (err) {
      this._logError('Failed to emit projectManagerReady event', err);
    }
  }
  /**
   * Injects the ChatManager instance once it becomes available **after** this
   * component has already been constructed.  Because the ProjectDetailsComponent
   * is instantiated before the ChatManager during the application bootstrap
   * sequence, "chat" related UI was never initialised, causing the chat_ui
   * template to remain absent from the DOM.
   *
   * When this setter is called we immediately attempt to (re-)initialise the
   * chat UI for the currently active tab and update any dependent UI state so
   * the button enabling logic reflects the newly available capability.
   *
   * @param {Object|null} cm – The newly created ChatManager instance.
   */
  setChatManager(cm) {
    this.chatManager = cm;
    this._logInfo('ChatManager instance received and set.', { hasChatManager: !!cm });

    // Re-initialize chat UI if user is currently on the Chat tab.
    if ((this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === 'chat' || this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === 'conversations') && this.chatManager?.initialize) {
      try {
        this._restoreChatAndModelConfig();
      } catch (err) {
        this._logError('Error while restoring chat UI after ChatManager injection', err);
      }
    }


    this._updateNewChatButtonState();
  }

  _logInfo(msg, meta) { try { this.logger.info(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch { return; } }
  _logWarn(msg, meta) { try { this.logger.warn(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch { return; } }
  _logError(msg, err, meta) {
    try { this.logger.error(`[${MODULE_CONTEXT}] ${msg}`, err && err.stack ? err.stack : err, { context: MODULE_CONTEXT, ...meta }); }
    catch { throw new Error(`[${MODULE_CONTEXT}] ${msg}: ${err && err.stack ? err.stack : err}`); }
  }

  async _loadTemplate() {
    if (this.uiStateService.getState('ProjectDetailsComponent', 'templateLoaded')) return true;
    this.uiStateService.setState('ProjectDetailsComponent', 'loading', true);
    let container = null;
    try {
      container = this.domAPI.getElementById(this.containerId);
      if (!container) {
        this._logError(`Container #${this.containerId} not found`);
        this.uiStateService.setState('ProjectDetailsComponent', 'loading', false);
        return false;
      }
      const loadResult = await this.htmlTemplateLoader.loadTemplate({
        url: this.templatePath,
        containerSelector: `#${this.containerId}`,
        eventName: 'projectDetailsTemplateLoaded'
      });
      if (loadResult === false) {
        this.uiStateService.setState('ProjectDetailsComponent', 'loading', false);
        return false;
      }
      this.elements.container = container;
      this.uiStateService.setState('ProjectDetailsComponent', 'templateLoaded', true);
      this.uiStateService.setState('ProjectDetailsComponent', 'loading', false);
      this._logInfo("Template loaded");

      // ----------------------------------------------------------
      // Pre-load Chat UI template early so that ChatManager DOM-selector
      // look-ups do not race against user interaction.  This is done
      // only once during the initial template load and relies on the
      // htmlTemplateLoader’s built-in idempotency (data-html-loaded attr).
      // ----------------------------------------------------------
      try {
        if (this.htmlTemplateLoader?.loadTemplate) {
          await this.htmlTemplateLoader.loadTemplate({
            url: '/static/html/chat_ui.html',
            containerSelector: SELECTORS.chatUIContainer,
            eventName: 'chatUITemplatePreloaded',
            timeout: 10_000
          });
          this._logInfo('Chat UI template pre-loaded successfully');
        } else {
          this._logWarn('htmlTemplateLoader missing when attempting chat UI pre-load');
        }
      } catch (err) {
        this._logWarn('Chat UI template pre-load failed (non-blocking)', { err: err?.message });
      }

      return true;
    } catch (err) {
      this._logError(`Failed to load template`, err);
      if (container) this.domAPI.setInnerHTML(container, `<div class="p-4 text-error">Failed to load project details view.</div>`);
      this.uiStateService.setState('ProjectDetailsComponent', 'loading', false);
      return false;
    }
  }

  async _ensureElementsReady() {
    if (!this.uiStateService.getState('ProjectDetailsComponent', 'templateLoaded') || !this.elements.container) {
      this._logWarn(`Template not loaded. Cannot ensure elements are ready.`);
      return false;
    }
    const coreSelectors = [
      '#projectTitle', '#backToProjectsBtn',
      '.project-tab',
      // Tab content containers (Panes)
      '#chatTab', '#filesTab', '#knowledgeTab', '#settingsTab', '#detailsTab'
    ];
    // Optional but expected selectors; if missing we continue with warning.
    const optionalSelectors = [
      // Project metadata editing (in Settings Tab)
      "#projectNameInput", "#projectDescriptionInput",
      // File-upload controls (in Files Tab)
      "#fileInput", "#uploadFileBtn", "#dragDropZone",
      "#filesUploadProgress", "#fileProgressBar", "#uploadStatus",
      // Misc project actions (Header or Settings Tab)
      "#archiveProjectBtn", "#deleteProjectBtn",
      "#editProjectBtn", "#projectMenuBtn", "#projectFab",
      // New Conversation Button (in Chat Tab)
      "#newConversationBtn"
      // KnowledgeBaseComponent internal selectors (e.g., #kbChunkCount) have been removed.
      // ProjectDetailsComponent should only ensure #knowledgeTab (the container) exists, which is in coreSelectors.
    ];
    try {
      await this.domReadinessService.elementsReady(coreSelectors, {
        timeout: this.APP_CONFIG?.TIMEOUTS?.COMPONENT_ELEMENTS_READY ?? 5000,
        context: `${MODULE_CONTEXT}::_ensureElementsReady::core`
      });

      this.domReadinessService.elementsReady(optionalSelectors, {
        observeMutations: true,
        timeout: this.APP_CONFIG?.TIMEOUTS?.OPTIONAL_ELEMENTS_READY ?? 3000,
        context: `${MODULE_CONTEXT}::_ensureElementsReady::optional`
      }).catch((err) => {
        this._logInfo(`Some optional elements not found within timeout, continuing anyway`, {
          missingElements: err?.message || 'unknown',
          context: `${MODULE_CONTEXT}::_ensureElementsReady::optionalElements`
        });
      });

      const $ = (sel) => this.elements.container.querySelector(sel);
      this.elements.title = $("#projectTitle");
      this.elements.backBtn = $("#backToProjectsBtn");
      this.elements.tabBtns = this.elements.container.querySelectorAll(".project-tab");
      this._logInfo(`Found ${this.elements.tabBtns.length} tab buttons`);
      this.elements.tabBtns.forEach((btn, index) => {
        this._logInfo(`Tab button ${index}: ${btn.dataset?.tab || 'no-tab-data'}`, {
          element: btn.tagName,
          classes: btn.className,
          dataset: btn.dataset
        });
      });
      this.elements.tabs = {
        chat: $("#chatTab"),
        files: $("#filesTab"),
        details: $("#detailsTab"),
        knowledge: $("#knowledgeTab"),
        settings: $("#settingsTab")
      };
      Object.entries(this.elements.tabs).forEach(([tabName, tabElement]) => {
        if (!tabElement) {
          this._logWarn(`Tab content element not found: ${tabName}`);
        }
      });
      this.elements.projectNameDisplay = $("#projectNameDisplay");
      this.elements.projectDescriptionDisplay = $("#projectDescriptionDisplay");
      this.elements.projectGoalsDisplay = $("#projectGoalsDisplay");
      this.elements.projectInstructionsDisplay = $("#projectInstructionsDisplay");
      this.elements.projectCreatedDate = $("#projectCreatedDate");
      this.elements.filesList = $("#filesList");
      this.elements.conversationsList = $("#conversationsList");
      this.elements.artifactsList = $("#artifactsList");
      this.elements.fileInput = $("#fileInput");
      this.elements.uploadBtn = $("#uploadFileBtn");
      this.elements.dragZone = $("#dragDropZone");
      this.elements.uploadProgress = $("#filesUploadProgress");
      this.elements.progressBar = $("#fileProgressBar");
      this.elements.uploadStatus = $("#uploadStatus");
      this._logInfo("All critical elements are ready");
      return true;
    } catch (err) {
      this._logError(`Critical elements not ready`, err);
      return false;
    }
  }

  async _initSubComponents() {
    if (!this.FileUploadComponentClass || this.fileUploadComponent) return;
    if (!this.projectManager) {
      this._logWarn('ProjectManager not yet available – skipping FileUploadComponent init');
      return;
    }

    // Define the selectors FileUploadComponent needs.
    const fileUploadElementSelectors = {
      fileInput: '#fileInput',
      uploadBtn: '#uploadFileBtn',
      dragZone: '#dragDropZone',
      uploadProgress: '#filesUploadProgress',
      progressBar: '#fileProgressBar',
      uploadStatus: '#uploadStatus'
    };

    try {
      // Use factory function instead of constructor
      this.fileUploadComponent = this.FileUploadComponentClass({
        eventHandlers: this.eventHandlers,
        domAPI: this.domAPI,
        projectManager: this.projectManager,
        // Phase-1.3: Use injected app dependency instead of runtime lookup
        app: this.app,
        domReadinessService: this.domReadinessService,
        logger: this.logger,
        projectId: this.projectId, // Pass current project ID
        onUploadComplete: this.safeHandler(async () => {
          if (!this.projectId) return;
          await this.projectManager.loadProjectFiles(this.projectId);
        }, "UploadComplete"),
        elements: fileUploadElementSelectors // Pass the selectors object
      });

      const initFn =
        this.fileUploadComponent.init || this.fileUploadComponent.initialize;
      if (typeof initFn === "function") {
        await initFn.call(this.fileUploadComponent);
        this._logInfo("FileUploadComponent initialized successfully.");
      } else {
        this._logWarn("FileUploadComponent does not have an init/initialize method.");
      }
    } catch (err) {
      this._logError("Error initializing FileUploadComponent", err);
    }
  }

  _bindEventListeners() {
    this.eventHandlers.cleanupListeners({ context: 'ProjectDetailsComponent' });
    this._cleanupPendingOperations();
    
    if (!this.elements.container) {
      this._logWarn('Container element not found, cannot bind event listeners');
      return;
    }

    // Use extracted event handlers if available
    if (this.projectEventHandlers) {
      this.projectEventHandlers.bindAllEventListeners({
        projectData: this.projectData,
        backButton: this.elements.backBtn,
        tabButtons: this.elements.tabBtns,
        callbacks: {
          onBack: () => this.navigationService.navigateToProjectList(),
          onTabSwitch: (targetTab) => this.switchTab(targetTab),
          onProjectDeleted: (detail) => this.navigationService.navigateToProjectList(),
          onProjectArchived: (detail) => this._handleProjectUpdate(detail),
          onProjectUpdated: (detail) => this._handleProjectUpdate(detail),
          onAuthStateChange: (detail) => this._handleAuthStateChange(detail)
        }
      });
    } else {
      // Fallback to basic navigation if projectEventHandlers not available
      this._logWarn('ProjectEventHandlers not available, using fallback binding');
      this._bindBasicEventListeners();
    }

    // Bind project-specific data events that remain in this component
    this._bindDataEventListeners();
  }

  _bindBasicEventListeners() {
    if (this.elements.backBtn) {
      this.eventHandlers.trackListener(
        this.elements.backBtn, "click", this.safeHandler(
          () => this.navigationService.navigateToProjectList(), "BackBtn"
        ), { context: 'ProjectDetailsComponent', description: "BackButton" });
    }

    if (this.elements.tabBtns?.length > 0) {
      this.elements.tabBtns.forEach((btn) => {
        const tabName = btn.dataset?.tab;
        if (tabName) {
          this.eventHandlers.trackListener(
            btn, "click", this.safeHandler((ev) => {
              ev.preventDefault();
              this.switchTab(tabName);
            }, `Tab:${tabName}`),
            { context: 'ProjectDetailsComponent', description: `TabBtn:${tabName}` }
          );
        }
      });
    }
  }

  _bindDataEventListeners() {
    const doc = this.domAPI.getDocument();
    
    // Project data loaded events
    this.eventHandlers.trackListener(doc, "projectFilesLoaded",
      this.safeHandler((e) => this.renderFiles(e.detail?.files || []), "FilesLoaded"),
      { context: 'ProjectDetailsComponent', description: "FilesLoaded" });
    
    this.eventHandlers.trackListener(doc, "projectConversationsLoaded",
      this.safeHandler((e) => {
        this.renderConversations(this.projectId);
        if (Array.isArray(e?.detail?.conversations)) {
          this._renderConversationList(e.detail.conversations);
        }
      }, "ConversationsLoaded"),
      { context: 'ProjectDetailsComponent', description: 'ConversationsLoaded' });
    
    this.eventHandlers.trackListener(doc, "projectArtifactsLoaded",
      this.safeHandler((e) => this.renderArtifacts(e.detail?.artifacts || []), "ArtifactsLoaded"),
      { context: 'ProjectDetailsComponent', description: "ArtifactsLoaded" });
    
    this.eventHandlers.trackListener(doc, "projectStatsLoaded",
      this.safeHandler((e) => this.renderStats(e.detail), "StatsLoaded"),
      { context: 'ProjectDetailsComponent', description: "StatsLoaded" });
    
    this.eventHandlers.trackListener(doc, "projectKnowledgeBaseLoaded",
      this.safeHandler(async (e) => this._handleKnowledgeBaseLoaded(e), "KnowledgeLoaded"),
      { context: 'ProjectDetailsComponent', description: "KnowledgeLoaded" });
  }

  _handleProjectUpdate(detail) {
    if (detail?.projectId === this.projectId) {
      this._logInfo('Project updated, refreshing data');
      this.loadProjectData(this.projectId);
    }
  }

  _handleAuthStateChange(detail) {
    const authed = detail?.authenticated ?? this._isAuthenticated();
    this._updateNewChatButtonState();
    
    if (!authed) {
      this.disableChatUI('Sign-in required');
    } else if (this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === 'chat' || 
               this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === 'conversations') {
      this._restoreChatAndModelConfig();
    }
  }

  async _handleKnowledgeBaseLoaded(e) {
    if (!this.knowledgeBaseComponent) return;
    
    const isAuthed = this._isAuthenticated();
    if (isAuthed) {
      try {
        await this.knowledgeBaseComponent.initialize?.(
          false, e.detail?.knowledgeBase, e.detail?.projectId
        );
      } catch (err) {
        this._logError("Error initializing knowledgeBaseComponent", err);
      }
    } else {
      this._logWarn("User not authenticated – deferring KnowledgeBaseComponent initialization");
    }
    
    this.knowledgeBaseComponent.renderKnowledgeBaseInfo?.(
      e.detail?.knowledgeBase, e.detail?.projectId
    );
    
    if (e.detail?.knowledgeBase) {
      this.projectData ||= {};
      this.projectData.knowledge_base = e.detail.knowledgeBase;
      this._updateNewChatButtonState();
      
      if ((this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === 'chat' || 
           this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === 'conversations') && 
          this.chatManager?.initialize) {
        this._restoreChatAndModelConfig();
      }
    }
  }

  switchTab(tabName) {
    if (!this.elements.tabs[tabName]) return;
    this.uiStateService.setState('ProjectDetailsComponent', 'activeTab', tabName);
    this.elements.tabBtns?.forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("tab-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.setAttribute("tabindex", active ? "0" : "-1");
    });
    Object.entries(this.elements.tabs).forEach(([k, el]) => {
      if (el) el.classList.toggle("hidden", k !== tabName);
    });
    this._logInfo(`Activated tab: ${tabName}`);
    this._loadTabContent(tabName);
    if (tabName === 'conversations' || tabName === 'chat') {
      this._restoreChatAndModelConfig();
      this._updateNewChatButtonState();
    }
  }

  _loadTabContent(tab) {
    if (!this.projectId) return;
    switch (tab) {
      case "files":
        // Delegate file loading to extracted coordinator
        this.projectDataCoordinator.loadProjectFiles(this.projectId);
        break;
      case "chat":
        // Delegate conversation loading to extracted coordinator
        this.projectDataCoordinator.loadProjectConversations(this.projectId);
        break;
      case "artifacts":
        // Delegate artifact loading to extracted coordinator
        this.projectDataCoordinator.loadProjectArtifacts(this.projectId);
        break;
      case "details":
        this.projectManager.loadProjectStats(this.projectId);
        break;
      case "knowledge": {
        const tryInit = () => {
          if (this.knowledgeBaseComponent && typeof this.knowledgeBaseComponent.initialize === "function") {
            this.knowledgeBaseComponent.initialize(
              true,
              this.projectData?.knowledge_base,
              this.projectId
            ).catch(e => this._logError("Error initializing knowledgeBaseComponent", e));
            return true;
          }
          return false;
        };

        const isAuthed = this._isAuthenticated();

        /* 1️⃣ Attempt immediate initialisation only if authenticated */
        if (isAuthed && !tryInit()) {
          /* KnowledgeBaseComponent not yet available. Set up a one-time listener
             to retry initialization after the component signals it is ready. */
          this._logWarn("KnowledgeBaseComponent not ready – deferring initialization until available");

          const onceHandler = this.safeHandler(() => {
            // Attempt initialisation again now that KnowledgeBaseComponent is ready
            tryInit();
            this.domAPI.getDocument().removeEventListener('knowledgebasecomponent:initialized', onceHandler);
          }, 'KnowledgeTabDeferredInit');

          this.domAPI
            .getDocument()
            .addEventListener('knowledgebasecomponent:initialized', onceHandler, { once: true });
        } else if (!isAuthed) {
          this._logWarn("User not authenticated – deferring KnowledgeBaseComponent initialization until login");

          const authBus = this.auth?.AuthBus || this.domAPI.getDocument();

          const authOnce = this.safeHandler(() => {
            // Re-invoke _loadTabContent('knowledge') after auth to run regular logic
            this._loadTabContent('knowledge');
          }, 'KnowledgeTabAuthDeferredInit');

          authBus.addEventListener('authStateChanged', authOnce, { once: true });
        }
        break;
      }
    }
  }

  async _fetchProjectData(projectId) {
    this._logInfo(`Fetching data for project ${projectId}... (About to call loadProjectData)`, {
      projectId,
      context: "projectDetailsComponent._fetchProjectData",
      stack: (new Error().stack || "").split('\n')[2] || "unknown"
    });
    try {
      let project;

      // Use data coordinator if available, fallback to project manager
      if (this.projectDataCoordinator?.loadProjectData) {
        project = await this.projectDataCoordinator.loadProjectData(projectId);
      } else {
        project = await this.projectManager.loadProjectDetails(projectId);
      }

      this.projectData = project || null;
      if (!this.projectData) {
        this._logError(`Unable to load project ${projectId}`);
        /* Gracefully recover by returning the user to the project list view.
           This prevents the details page from remaining in an error state
           when the backend reports the project is missing (404 or invalid
           structure). */
        try {
          this.navigationService?.navigateToProjectList?.({ replace: true });
        } catch {
          /* navigation failure is non-fatal; we already logged the original error */
        }
      } else {
        this._logInfo(`Project data loaded`, { projectId });
      }
      this.uiStateService.setState('ProjectDetailsComponent', 'projectDataLoaded', Boolean(this.projectData));
    } catch (err) {
      this._logError(`Error loading project data`, err);
      this.projectData = null;
      this.uiStateService.setState('ProjectDetailsComponent', 'projectDataLoaded', false);
    }
  }

  _renderProjectData() {
    if (!this.elements.container || !this.projectData) return;

    // Delegate to extracted renderer
    if (this.projectDetailsRenderer?.renderProjectData) {
      this.projectDetailsRenderer.renderProjectData(this.projectData, this.elements);
    } else {
      // Fallback implementation
      const { name, description, goals, customInstructions, created_at } = this.projectData;
      if (this.elements.title) this.elements.title.textContent = this.sanitizer.sanitize(name || "Untitled Project");
      if (this.elements.projectNameDisplay) {
        this.elements.projectNameDisplay.textContent = this.sanitizer.sanitize(name || "Untitled Project");
      }
      if (this.elements.projectDescriptionDisplay) {
        this.domAPI.setInnerHTML(this.elements.projectDescriptionDisplay,
          this.sanitizer.sanitize(description || "No description provided."));
      }
      if (this.elements.projectGoalsDisplay) {
        this.domAPI.setInnerHTML(this.elements.projectGoalsDisplay,
          this.sanitizer.sanitize(goals || "No goals specified."));
      }
      if (this.elements.projectInstructionsDisplay) {
        this.domAPI.setInnerHTML(this.elements.projectInstructionsDisplay,
          this.sanitizer.sanitize(customInstructions || "No custom instructions."));
      }
      if (this.elements.projectCreatedDate && created_at) {
        this.elements.projectCreatedDate.textContent = this.sanitizer.sanitize(this.formatDate(created_at));
      }
      // Archive button and badge handled by renderer
    }
  }

  // Removed: _updateArchiveButton and _updateArchiveBadge (handled by projectDetailsRenderer)

  // Delegate file operations to data coordinator
  async _delegateDownloadFile(fileId, fileName) {
    if (!this.projectId || !fileId) return;
    try {
      if (this.projectDataCoordinator?.downloadFile) {
        await this.projectDataCoordinator.downloadFile(this.projectId, fileId, fileName);
      } else {
        await this.projectManager.downloadFile(this.projectId, fileId);
      }
    } catch (e) {
      this._logError("Error downloading file", e);
    }
  }

  async _delegateDeleteFile(fileId, fileName) {
    if (!this.projectId || !fileId) return;
    if (!this.modalManager) return;

    this.modalManager.confirmAction({
      title: "Delete file",
      message: `Delete "${this.sanitizer.sanitize(fileName || fileId)}" permanently?`,
      confirmText: "Delete",
      confirmClass: "btn-error",
      onConfirm: this.safeHandler(async () => {
        try {
          if (this.projectDataCoordinator?.deleteFile) {
            await this.projectDataCoordinator.deleteFile(this.projectId, fileId);
          } else {
            await this.projectManager.deleteFile(this.projectId, fileId);
            await this.projectManager.loadProjectFiles(this.projectId);
          }
        } catch (e) {
          this._logError('Error deleting file', e);
        }
      }, "ConfirmDeleteFile")
    });
  }

  async _delegateDownloadArtifact(projectId, artifactId) {
    try {
      if (this.projectDataCoordinator?.downloadArtifact) {
        await this.projectDataCoordinator.downloadArtifact(projectId, artifactId);
      } else {
        await this.projectManager.downloadArtifact(projectId, artifactId);
      }
    } catch (e) {
      this._logError("Error downloading artifact", e);
    }
  }

  // Removed: _fileItem, _conversationItem, _artifactItem (all rendering now handled by projectDetailsRenderer)

  disableChatUI(reason = 'Chat unavailable') {
    try {
      const input = this.domAPI.getElementById('chatInput');
      const send = this.domAPI.getElementById('chatSendBtn');
      [input, send].forEach(el => {
        if (!el) return;
        el.disabled = true;
        el.title = reason;
        this.domAPI.addClass(el, 'cursor-not-allowed');
        this.domAPI.addClass(el, 'opacity-50');
      });
      const chatBox = this.domAPI.querySelector('#chatTab .chat-container');
      if (chatBox) this.domAPI.addClass(chatBox, 'opacity-40');
    } catch {
      /* intentionally empty */
    }
  }

  /**
   * Render the conversation list inside the chat tab (#conversationsList).
   * Delegates to the extracted renderer module.
   */
  _renderConversationList(conversations = []) {
    try {
      const container = this.elements?.conversationsList || this.domAPI.getElementById?.('conversationsList');
      if (!container) {
        this._logWarn('Conversations list container not found – skipping render');
        return;
      }

      this.projectDetailsRenderer?.renderConversations?.(conversations, {
        container,
        projectId: this.projectId
      });
    } catch (err) {
      this._logError('Failed to render conversation list', err);
    }
  }

  _restoreKnowledgeTab() {
    if (this.knowledgeBaseComponent && typeof this.knowledgeBaseComponent.initialize === "function" && this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === "knowledge") {
      const kbData = this.projectData?.knowledge_base;
      this.knowledgeBaseComponent.initialize(true, kbData, this.projectId)
        .catch(e => this._logError("Error re-initializing knowledge base component", e));
    } else if (this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === "knowledge") {
      this._logWarn("KnowledgeBaseComponent not ready - skipping re-initialization");
    }
  }

  // (Removed _safeAttr and _safeTxt helpers from constructor docstring)

  _restoreStatsCounts() {
    if (!this.projectId) return;
    this.projectManager.loadProjectStats(this.projectId)
      .catch(e => this._logError("Error loading stats in restoreStatsCounts", e));
  }

  // (No _safeTxt or _safeAttr helpers remain)

  setKnowledgeBaseComponent(kbcInstance) {
    this.knowledgeBaseComponent = kbcInstance;
    this._logInfo("KnowledgeBaseComponent instance received and set.", { kbcInstance: !!kbcInstance });
    if (this.uiStateService.getState('ProjectDetailsComponent', 'activeTab') === "knowledge") {
      if (!this.knowledgeBaseComponent || typeof this.knowledgeBaseComponent.initialize !== "function") {
        if (!this._kbcFirstWarned) {
          this._logWarn("KnowledgeBaseComponent instance missing or invalid after set - skipping re-initialization");
          this._kbcFirstWarned = true;
        }
      } else if (!this.projectId) {
        this._logWarn("KnowledgeBaseComponent not initialized because projectId is not yet set (project not loaded)");
      } else {
        const kbData = this.projectData?.knowledge_base;
        this.knowledgeBaseComponent.initialize(true, kbData, this.projectId)
          .catch(e => this._logError("Error re-initializing knowledge base component after set", e));
      }
    }
  }

  async show({ projectId, activeTab } = {}) {
    if (!this.projectManager) {
      this._logWarn('ProjectManager not yet available – defer show()', { projectId, activeTab });
      this._logInfo('Setting up projectManagerReady event listener for deferred show()');
      const deferredShowHandler = this.safeHandler(() => {
        this._logInfo('projectManagerReady event received, retrying show()', { projectId, activeTab });
        this.show({ projectId, activeTab });
        this.eventService.off('projectManagerReady', deferredShowHandler);
      }, 'DeferredShow');
      this.eventService.on('projectManagerReady', deferredShowHandler);
      return;
    }
    this.projectId = projectId;
    this.elements.activeTab = activeTab;
    this._logInfo(`Showing project details for projectId: ${projectId}, activeTab: ${activeTab}`);
    this._loadTemplate()
      .then(() => this._ensureElementsReady())
      .then(() => this._initSubComponents())
      .then(() => this._bindEventListeners())
      .then(() => {
        this._loadTabContent(activeTab);
        this.uiStateService.setState('ProjectDetailsComponent', 'active', true);
      })
      .catch(err => this._logError('Error during show()', err));
  }
}
