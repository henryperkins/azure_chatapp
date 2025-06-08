/*
// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
*/
/*
// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
*/
import { getSafeHandler } from './utils/getSafeHandler.js';
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
} = {}) {
  const missing = [];
  if (!domAPI) missing.push("domAPI");
  if (!htmlTemplateLoader) missing.push("htmlTemplateLoader");
  if (!domReadinessService) missing.push("domReadinessService");
  if (!eventHandlers) missing.push("eventHandlers");
  if (!navigationService) missing.push("navigationService");
  if (!sanitizer) missing.push("sanitizer");
  if (!logger) missing.push("logger");
  if (missing.length) {
    if (logger && logger.error) {
      logger.error(`[${MODULE_CONTEXT}] Missing required dependencies: ${missing.join(", ")}`, { context: MODULE_CONTEXT });
    }
    throw new Error(`[${MODULE_CONTEXT}] Missing required dependencies: ${missing.join(", ")}`);
  }
  // Use canonical uiUtils helpers for formatting (preferred over globalUtils)
  const uiUtils = DependencySystem.modules.get('uiUtils') || {};
  const formatDate = uiUtils.formatDate || (() => '');
  const formatBytes = uiUtils.formatBytes || (() => '');

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
    formatBytes
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
    this.app = deps.app || this.eventHandlers.DependencySystem?.modules?.get('appModule');
    this.modelConfig = deps.modelConfig;

    // Store DI container for later safe look-ups
    this.DependencySystem = deps.DependencySystem;
    this.chatManager = deps.chatManager;
    this.apiClient = deps.apiClient;

    // UiRenderer provides heavy DOM list rendering helpers used by event handlers
    this.uiRenderer = deps.DependencySystem?.modules?.get('uiRenderer');

    // Bridge legacy instance methods expected by earlier template listeners to
    // the canonical uiRenderer implementation, preserving single-source logic
    this.renderFiles = (...a) => this.uiRenderer?.renderFiles?.(...a);
    this.renderConversations = (...a) => this.uiRenderer?.renderConversations?.(...a);
    this.renderArtifacts = (...a) => this.uiRenderer?.renderArtifacts?.(...a);
    this.renderStats = (...a) => this.uiRenderer?.renderStats?.(...a);
    this.containerId = "projectDetailsView";
    this.templatePath = "/static/html/project_details.html";
    this.state = {
      templateLoaded: false,
      loading: false,
      activeTab: "chat",
      projectDataLoaded: false
    };
    this.projectId = null;
    this.projectData = null;
    this.listenersContext = MODULE_CONTEXT + "_listeners";
    this.bus = new EventTarget();
    this.fileUploadComponent = null;
    this.elements = {};
    // Keep auth module ref for AuthBus only; auth state comes from appModule.state
    this.auth = this.eventHandlers.DependencySystem?.modules?.get("auth");
    // Utilities injected via factory (globalUtils) for consistent formatting
    this.formatDate = typeof deps.formatDate === 'function' ? deps.formatDate.bind(this) : undefined;
    this.formatBytes = typeof deps.formatBytes === 'function' ? deps.formatBytes.bind(this) : undefined;
    // Canonical safeHandler accessor (single source of truth)
    this.safeHandler = getSafeHandler(this.DependencySystem);
    // Track single KBC bootstrap log/noise
    this._kbcFirstWarned = false;

    this._isAuthenticated = () => Boolean(this.DependencySystem?.modules?.get('appModule')?.state?.isAuthenticated);
  }

  setProjectManager(pm) {
    this.projectManager = pm;
    this._logInfo('ProjectManager set, dispatching projectManagerReady event', { hasProjectManager: !!pm });
    // emit event so deferred show() can continue
    try {
      this.bus.dispatchEvent(new Event('projectManagerReady'));
      this._logInfo('projectManagerReady event dispatched successfully');
    } catch (err) {
      this._logError('Failed to dispatch projectManagerReady event', err);
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
    if ((this.state.activeTab === 'chat' || this.state.activeTab === 'conversations') && this.chatManager?.initialize) {
      try {
        this._restoreChatAndModelConfig();
      } catch (err) {
        this._logError('Error while restoring chat UI after ChatManager injection', err);
      }
    }


    this._updateNewChatButtonState();
  }

  _logInfo(msg, meta) { try { this.logger.info(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch (e) { return; } }
  _logWarn(msg, meta) { try { this.logger.warn(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch (e) { return; } }
  _logError(msg, err, meta) {
    try { this.logger.error(`[${MODULE_CONTEXT}] ${msg}`, err && err.stack ? err.stack : err, { context: MODULE_CONTEXT, ...meta }); }
    catch { throw new Error(`[${MODULE_CONTEXT}] ${msg}: ${err && err.stack ? err.stack : err}`); }
  }
  _setState(partial) { this.state = { ...this.state, ...partial }; }

  async _loadTemplate() {
    if (this.state.templateLoaded) return true;
    this._setState({ loading: true });
    let container = null;
    try {
      container = this.domAPI.getElementById(this.containerId);
      if (!container) {
        this._logError(`Container #${this.containerId} not found`);
        this._setState({ loading: false });
        return false;
      }
      const loadResult = await this.htmlTemplateLoader.loadTemplate({
        url: this.templatePath,
        containerSelector: `#${this.containerId}`,
        eventName: 'projectDetailsTemplateLoaded'
      });
      if (loadResult === false) {
        this._setState({ loading: false });
        return false;
      }
      this.elements.container = container;
      this._setState({ templateLoaded: true, loading: false });
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
            containerSelector: '#chatUIContainer',
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
      this._setState({ loading: false });
      return false;
    }
  }

  async _ensureElementsReady() {
    if (!this.state.templateLoaded || !this.elements.container) {
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
        app: this.eventHandlers.DependencySystem.modules.get("appModule"),
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
    if (this.elements.backBtn) {
      this.eventHandlers.trackListener(
        this.elements.backBtn, "click", this.safeHandler(
          () => { this.navigationService.navigateToProjectList(); }, "BackBtn"
        ), { context: 'ProjectDetailsComponent', description: "BackButton" });
    }
    if (this.elements.tabBtns && this.elements.tabBtns.length > 0) {
      this._logInfo(`Binding ${this.elements.tabBtns.length} tab buttons`);
      this.elements.tabBtns.forEach((btn, index) => {
        if (!btn || !btn.dataset || !btn.dataset.tab) {
          this._logWarn(`Tab button ${index} missing or invalid dataset.tab`, { btn });
          return;
        }
        const tabName = btn.dataset.tab;
        this._logInfo(`Binding tab button: ${tabName}`);
        this.eventHandlers.trackListener(
          btn, "click", this.safeHandler((ev) => {
            this._logInfo(`Tab clicked: ${tabName}`);
            ev.preventDefault();
            ev.stopPropagation();
            this.switchTab(tabName);
          }, `Tab:${tabName}`),
          { context: 'ProjectDetailsComponent', description: `TabBtn:${tabName}` }
        );
      });
    } else {
      this._logWarn('No tab buttons found or tabBtns is empty', {
        tabBtns: this.elements.tabBtns,
        container: !!this.elements.container
      });
    }

    /* ───────── Project action buttons (edit / archive / delete) ───────── */
    const currentPM = this.projectManager || this.DependencySystem?.modules?.get('projectManager');
    const mm = this.modalManager || this.DependencySystem?.modules?.get('modalManager');

    // Edit
    const editBtn = this.elements.container.querySelector('#editProjectBtn');
    if (editBtn && mm?.show) {
      this.eventHandlers.trackListener(
        editBtn,
        'click',
        this.safeHandler(() => {
          if (!this.projectData) return;
          // Open the project modal in edit mode
          mm.show('project', {
            updateContent: (modalEl) => {
              const nameInput = modalEl.querySelector('#projectModalNameInput');
              if (nameInput) nameInput.value = this.projectData.name || '';
              const descInput = modalEl.querySelector('#projectModalDescInput');
              if (descInput) descInput.value = this.projectData.description || '';
            }
          });
        }, 'EditProjectBtn'),
        { context: 'ProjectDetailsComponent', description: 'EditProjectBtn' }
      );
    }

    // Archive / Un-archive
    const archiveBtn = this.elements.container.querySelector('#archiveProjectBtn');
    if (archiveBtn && currentPM && mm?.confirmDelete) {
      this.eventHandlers.trackListener(
        archiveBtn,
        'click',
        this.safeHandler(() => {
          if (!this.projectData?.id) return;
          const isArchived = !!this.projectData.archived;
          mm.confirmDelete({
            title: isArchived ? 'Unarchive Project?' : 'Archive Project?',
            message: isArchived ?
              `Are you sure you want to unarchive "${this.projectData.name}"?` :
              `Are you sure you want to archive "${this.projectData.name}"? Archived projects are hidden by default.`,
            confirmText: isArchived ? 'Unarchive' : 'Archive',
            confirmClass: isArchived ? 'btn-success' : 'btn-warning',
            onConfirm: async () => {
              try {
                await currentPM.toggleArchiveProject(this.projectData.id);
                await currentPM.loadProjects?.();
              } catch (err) {
                this._logError('Error toggling archive', err);
              }
            }
          });
        }, 'ArchiveProjectBtn'),
        { context: 'ProjectDetailsComponent', description: 'ArchiveProjectBtn' }
      );
    }

    // Delete
    const deleteBtn = this.elements.container.querySelector('#deleteProjectBtn');
    if (deleteBtn && currentPM && mm?.confirmDelete) {
      this.eventHandlers.trackListener(
        deleteBtn,
        'click',
        this.safeHandler(() => {
          if (!this.projectData?.id) return;
          mm.confirmDelete({
            title: 'Delete Project?',
            message: `Are you sure you want to permanently delete "${this.projectData.name}"? This action cannot be undone.`,
            confirmText: 'Delete',
            confirmClass: 'btn-error',
            onConfirm: async () => {
              try {
                await currentPM.deleteProject(this.projectData.id);
                this.navigationService.navigateToProjectList();
              } catch (err) {
                this._logError('Error deleting project', err);
              }
            }
          });
        }, 'DeleteProjectBtn'),
        { context: 'ProjectDetailsComponent', description: 'DeleteProjectBtn' }
      );
    }
    const doc = this.domAPI.getDocument();
    this.eventHandlers.trackListener(doc, "projectFilesLoaded",
      this.safeHandler((e) => this.renderFiles(e.detail?.files || []), "FilesLoaded"),
      { context: 'ProjectDetailsComponent', description: "FilesLoaded" });
    /*
     * The uiRenderer.renderConversations(contract) expects the **projectId** as
     * its first parameter (signature: renderConversations(projectId, search, ...)).
     * Passing the conversations array here corrupted the URL construction
     * further down the call-chain, producing a request like
     *   /api/projects/[object Object],[object Object]/conversations
     * which the backend rightfully rejects with 422.
     */
    // When conversations are loaded update both the sidebar via uiRenderer
    // and the in-panel list inside the chat tab so users can select a
    // conversation directly from the Project Details view.
    this.eventHandlers.trackListener(
      doc,
      "projectConversationsLoaded",
      this.safeHandler(
        (e) => {
          // 1️⃣ Sidebar (existing behaviour)
          this.renderConversations(this.projectId);

          // 2️⃣ Project Details panel list (new / fixed behaviour)
          if (Array.isArray(e?.detail?.conversations)) {
            this._renderConversationList(e.detail.conversations);
          }
        },
        "ConversationsLoaded"
      ),
      { context: 'ProjectDetailsComponent', description: 'ConversationsLoaded' }
    );
    this.eventHandlers.trackListener(doc, "projectArtifactsLoaded",
      this.safeHandler((e) => this.renderArtifacts(e.detail?.artifacts || []), "ArtifactsLoaded"),
      { context: 'ProjectDetailsComponent', description: "ArtifactsLoaded" });
    this.eventHandlers.trackListener(doc, "projectStatsLoaded",
      this.safeHandler((e) => this.renderStats(e.detail), "StatsLoaded"),
      { context: 'ProjectDetailsComponent', description: "StatsLoaded" });
    this.eventHandlers.trackListener(
      doc,
      "projectKnowledgeBaseLoaded",
      this.safeHandler(
        async (e) => {
          if (!this.knowledgeBaseComponent) return;
          const _initKbc = async () => {
            try {
              await this.knowledgeBaseComponent.initialize?.(
                false,
                e.detail?.knowledgeBase,
                e.detail?.projectId
              );
            } catch (err) {
              this._logError("Error initializing knowledgeBaseComponent", err);
            }
          };

          // Only initialise after authentication; otherwise defer once.
          // Single source of truth – appModule.state.isAuthenticated
          const isAuthed = this._isAuthenticated();
          const authModule = this.eventHandlers.DependencySystem?.modules?.get?.('auth');

          if (isAuthed) {
            _initKbc();
          } else {
            this._logWarn("User not authenticated – deferring KnowledgeBaseComponent initialization until login");

            const authBus = authModule?.AuthBus || this.domAPI.getDocument();
            const onceAuth = this.safeHandler(() => {
              _initKbc();
            }, 'KBC_Init_AuthWait');

            authBus.addEventListener('authStateChanged', onceAuth, { once: true });
          }
          this.knowledgeBaseComponent.renderKnowledgeBaseInfo?.(
            e.detail?.knowledgeBase,
            e.detail?.projectId
          );
          if (e.detail?.knowledgeBase) {
            this.projectData ||= {};
            this.projectData.knowledge_base = e.detail.knowledgeBase;
            this._updateNewChatButtonState();

            // Now that the Knowledge Base is loaded and active we can safely
            // (re-)attempt ChatManager initialisation if the user is on the
            // chat-related tabs.  This prevents the earlier race condition
            // where ChatManager.initialise was invoked before KB readiness.
            if ((this.state.activeTab === 'chat' || this.state.activeTab === 'conversations') && this.chatManager?.initialize) {
              this._restoreChatAndModelConfig();
            }
          }
        },
        "KnowledgeLoaded"
      ),
      { context: 'ProjectDetailsComponent', description: "KnowledgeLoaded" }
    );

    /* ───────── Auth state synchronisation ───────── */
    {
      // Resolve AuthBus (preferred) or fall back to document
      const authMod = this.eventHandlers.DependencySystem?.modules?.get?.('auth');
      const authTarget = authMod?.AuthBus || this.domAPI.getDocument();

      const _handleAuth = this.safeHandler((ev) => {
        const authed = ev?.detail?.authenticated ?? this._isAuthenticated();

        // 1️⃣ (always) refresh New-Chat button state
        this._updateNewChatButtonState();

        // 2️⃣ toggle chat UI availability
        if (!authed) {
          this.disableChatUI('Sign-in required');
        } else if (this.state.activeTab === 'chat' || this.state.activeTab === 'conversations') {
          // re-enable / re-initialise chat when user logs in
          this._restoreChatAndModelConfig();
        }
      }, 'AuthStateChanged');

      ['authStateChanged', 'auth:stateChanged'].forEach((evt) =>
        this.eventHandlers.trackListener(
          authTarget,
          evt,
          _handleAuth,
          { context: 'ProjectDetailsComponent', description: `Auth sync → ${evt}` }
        )
      );
    }
  }

  switchTab(tabName) {
    if (!this.elements.tabs[tabName]) return;
    this._setState({ activeTab: tabName });
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
        this.projectManager.loadProjectFiles(this.projectId);
        break;
      case "chat":
        this.projectManager.loadProjectConversations(this.projectId);
        break;
      case "artifacts":
        this.projectManager.loadProjectArtifacts(this.projectId);
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
          /* 2️⃣ Try resolving the instance from the DI container */
          const kbc = this.eventHandlers?.DependencySystem?.modules?.get?.('knowledgeBaseComponent');
          if (kbc) {
            this.setKnowledgeBaseComponent(kbc);
            if (tryInit()) break;
          }

          /* 3️⃣ Still unavailable – set up a one-time listener to retry after injection */
          this._logWarn("KnowledgeBaseComponent not ready – deferring initialization until available");
          const onceHandler = this.safeHandler(() => {
            const cmp = this.eventHandlers?.DependencySystem?.modules?.get?.('knowledgeBaseComponent');
            if (cmp) {
              this.setKnowledgeBaseComponent(cmp);
              tryInit();
            }
            this.domAPI.getDocument().removeEventListener('knowledgebasecomponent:initialized', onceHandler);
          }, 'KnowledgeTabDeferredInit');
          this.domAPI
            .getDocument()
            .addEventListener('knowledgebasecomponent:initialized', onceHandler, { once: true });
        } else if (!isAuthed) {
          this._logWarn("User not authenticated – deferring KnowledgeBaseComponent initialization until login");

          const authModule = this.eventHandlers.DependencySystem?.modules?.get?.('auth');
          const authBus = authModule?.AuthBus || this.domAPI.getDocument();

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
    this._logInfo(`Fetching data for project ${projectId}... (About to call loadProjectDetails)`, {
      projectId,
      context: "projectDetailsComponent._fetchProjectData",
      stack: (new Error().stack || "").split('\n')[2] || "unknown"
    });
    try {
      const project = await this.projectManager.loadProjectDetails(projectId);
      this.projectData = project || null;
      if (!this.projectData) {
        this._logError(`Unable to load project ${projectId}`);
        /* Gracefully recover by returning the user to the project list view.
           This prevents the details page from remaining in an error state
           when the backend reports the project is missing (404 or invalid
           structure). */
        try {
          this.navigationService?.navigateToProjectList?.({ replace: true });
        } catch (_) {
          /* navigation failure is non-fatal; we already logged the original error */
        }
      } else {
        this._logInfo(`Project data loaded`, { projectId });
      }
      this._setState({ projectDataLoaded: Boolean(this.projectData) });
    } catch (err) {
      this._logError(`Error loading project data`, err);
      this.projectData = null;
      this._setState({ projectDataLoaded: false });
    }
  }

  _renderProjectData() {
    if (!this.elements.container || !this.projectData) return;
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
  }


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

  _fileItem(file) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-box shadow-xs hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.fileId = file.id;
    this.domAPI.setInnerHTML(div, `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-xl text-primary">📄</span>
        <div class="flex flex-col min-w-0 flex-1">
          <div class="font-medium truncate" title="${this.sanitizer.sanitize(file.filename)}">${this.sanitizer.sanitize(file.filename)}</div>
          <div class="text-xs text-base-content/70">
            ${this.sanitizer.sanitize(this.formatBytes(file.file_size))} · ${this.sanitizer.sanitize(this.formatDate(file.created_at))}
          </div>
        </div>
      </div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-xs btn-square text-info hover:bg-info/10" aria-label="Download" data-action="download">
          ⬇
        </button>
        <button class="btn btn-ghost btn-xs btn-square text-error hover:bg-error/10" aria-label="Delete" data-action="delete">
          ✕
        </button>
      </div>`);
    const [downloadBtn, deleteBtn] = div.querySelectorAll("button");
    this.eventHandlers.trackListener(
      downloadBtn, "click",
      this.safeHandler(() => this._downloadFile(file.id, file.filename), `DownloadFile_${file.id}`),
      { context: this.listenersContext, description: `DownloadFile_${file.id}` });
    this.eventHandlers.trackListener(
      deleteBtn, "click",
      this.safeHandler(() => this._confirmDeleteFile(file.id, file.filename), `DeleteFile_${file.id}`),
      { context: this.listenersContext, description: `DeleteFile_${file.id}` });
    return div;
  }

  _conversationItem(cv) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "conversation-item";
    div.dataset.conversationId = cv.id;
    this.domAPI.setInnerHTML(div, `
      <h4 class="font-medium truncate mb-1">${this.sanitizer.sanitize(cv.title || "Untitled conversation")}</h4>
      <p class="text-sm text-base-content/60 truncate leading-tight mt-0.5">${this.sanitizer.sanitize(cv.last_message || "No messages yet")}</p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${this.sanitizer.sanitize(this.formatDate(cv.updated_at))}</span>
        <span class="badge badge-ghost badge-sm">${this.sanitizer.sanitize(cv.message_count || 0)} msgs</span>
      </div>
    `);
    // No click handler here; chatUIEnhancements handles it.
    return div;
  }

  /**
   * Render the conversation list inside the chat tab (#conversationsList).
   * Replaces existing items and updates the conversations counter.
   *
   * @param {Array<object>} conversations - Array of conversation objects.
   */
  _renderConversationList(conversations = []) {
    try {
      const listContainer = this.elements?.conversationsList || this.domAPI.getElementById?.('conversationsList');
      if (!listContainer) {
        this._logWarn('Conversations list container not found – skipping render');
        return;
      }

      // Clear previous contents
      this.domAPI.setInnerHTML(listContainer, '');

      if (!Array.isArray(conversations) || conversations.length === 0) {
        // Provide a graceful empty-state message expected by project-details-enhancements.js
        const empty = this.domAPI.createElement('div');
        empty.className = 'empty-state text-center p-4 text-base-content/60';
        this.domAPI.setTextContent(empty, 'No conversations yet');
        this.domAPI.appendChild(listContainer, empty);
      } else {
        conversations.forEach((cv) => {
          const item = this._conversationItem(cv);
          this.domAPI.appendChild(listContainer, item);
        });
      }

      // Update badge count in header if present
      const countEl = this.domAPI.getElementById?.('conversationCount');
      if (countEl) {
        this.domAPI.setTextContent(countEl, String(conversations.length));
      }
    } catch (err) {
      this._logError('Failed to render conversation list', err);
    }
  }

  _artifactItem(art) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "p-3 border-b border-base-300 hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.artifactId = art.id;
    this.domAPI.setInnerHTML(div, `
      <div class="flex justify-between items-center">
        <h4 class="font-medium truncate">${this.sanitizer.sanitize(art.name || "Untitled artifact")}</h4>
        <span class="text-xs text-base-content/60">${this.sanitizer.sanitize(this.formatDate(art.created_at))}</span>
      </div>
      <p class="text-sm text-base-content/70 truncate mt-1">${this.sanitizer.sanitize(art.description || art.type || "No description")}</p>
      <div class="mt-2">
        <button class="btn btn-xs btn-outline" data-action="download">Download</button>
      </div>`);
    const btn = div.querySelector("[data-action=download]");
    this.eventHandlers.trackListener(
      btn, "click",
      this.safeHandler(() => this.projectManager.downloadArtifact(this.projectId, art.id), `DownloadArtifact_${art.id}`),
      { context: this.listenersContext, description: `DownloadArtifact_${art.id}` });
    return div;
  }

  async _confirmDeleteFile(fileId, fileName) {
    if (!this.projectId || !fileId) return;
    if (!this.modalManager) return;
    this.modalManager.confirmAction({
      title: "Delete file",
      message: `Delete “${this.sanitizer.sanitize(fileName || fileId)}” permanently?`,
      confirmText: "Delete",
      confirmClass: "btn-error",
      onConfirm: this.safeHandler(async () => {
        try {
          await this.projectManager.deleteFile(this.projectId, fileId);
          await this.projectManager.loadProjectFiles(this.projectId);
        } catch (e) { this._logError('Error deleting file', e); }
      }, "ConfirmDeleteFile")
    });
  }

  async _downloadFile(fileId, fileName) {
    if (!this.projectId || !fileId) return;
    try { await this.projectManager.downloadFile(this.projectId, fileId); }
    catch (e) { this._logError("Error downloading file", e); }
  }


  _cleanupPendingOperations() {
    if (this._pendingOperations) {
      for (const op of this._pendingOperations.values()) {
        op.cancel();
      }
      this._pendingOperations.clear();
    }
  }


  async initialize() {
    await this.domReadinessService.waitForEvent('app:ready');
    this._logInfo("Initializing...");

    /* ──────────────────────────────────────────────────────────────
     * Browser Back-Forward Cache (bfcache) handling
     * ──────────────────────────────────────────────────────────── */
    try {
      const win = this.domAPI?.getWindow?.();
      if (win && this.eventHandlers?.trackListener) {
        this.eventHandlers.trackListener(
          win,
          'pageshow',
          this.safeHandler((event) => {
            // If the page is restored from the bfcache (`event.persisted === true`)
            // many runtime connections (e.g., MessagePorts) are severed. Performing
            // a hard reload ensures the entire application stack is re-initialised
            // in a clean state.
            if (event?.persisted) {
              this._logInfo('Page restored from Back-Forward Cache. Reloading application.');
              if (typeof this.navigationService?.reload === 'function') {
                this.navigationService.reload();
              } else if (typeof win.location?.reload === 'function') {
                win.location.reload();
              }
            }
          }, 'PageShowBFCacheHandler'),
          { context: 'ProjectDetailsComponent', description: 'PageShowBFCacheHandler' }
        );
      }
    } catch (err) {
      this._logError('Failed to register pageshow handler', err);
    }

    this._logInfo("Initialized successfully.");
  }

  async show({ projectId, activeTab } = {}) {
    this._logInfo("show() invoked", { projectId, activeTab });
    this._logInfo("Loading project details template", { projectId });
    if (!projectId) {
      this._logError("No projectId provided. Redirecting to project list.");
      this.navigationService.navigateToProjectList();
      return;
    }
    if (!this.projectManager) {
      // Try to get ProjectManager from DI system as fallback
      const pmFromDI = this.eventHandlers?.DependencySystem?.modules?.get?.('projectManager');
      if (pmFromDI) {
        this._logInfo('ProjectManager found in DI system, setting it directly', { projectId, activeTab });
        this.setProjectManager(pmFromDI);
        // Continue with show() since we now have projectManager
      } else {
        this._logWarn('ProjectManager not yet available – defer show()', { projectId, activeTab });
        // Re-attempt once the DI setter provides the projectManager
        this._logInfo('Setting up projectManagerReady event listener for deferred show()');
        this.bus.addEventListener(
          'projectManagerReady',
          this.safeHandler(() => {
            this._logInfo('projectManagerReady event received, retrying show()', { projectId, activeTab });
            this.show({ projectId, activeTab });
          }, 'DeferredShow'),
          { once: true }
        );
        return;
      }
    }
    this.projectId = projectId;
    this._setState({ loading: true });
    const templateLoaded = await this._loadTemplate();
    this._logInfo(`Template loaded: ${templateLoaded}`, { projectId });
    if (!templateLoaded) return this._setState({ loading: false });

    const elementsReady = await this._ensureElementsReady();
    this._logInfo(`Elements ready: ${elementsReady}`, { projectId });
    if (!elementsReady) {
      this._logError("Project details UI elements not ready, aborting show", new Error("Elements not ready"), { projectId });
      if (this.elements.container) {
        this.domAPI.setInnerHTML(
          this.elements.container,
          `<div class="p-4 text-error">Failed to initialize project details UI elements.</div>`
        );
      }
      return this._setState({ loading: false });
    }

    this.elements.container.classList.remove("hidden");
    this._logInfo("Fetching project data", { projectId });
    await this._fetchProjectData(this.projectId);
    this._renderProjectData();

    /* Abort further initialisation when the project payload is missing (e.g.
       404 or invalid response) – the user has already been redirected back to
       the project list view inside _fetchProjectData(). */
    if (!this.projectData) {
      this._setState({ loading: false });
      return;
    }

    /* ── Ensure KB is fetched early so Chat UI can initialise ── */
    try {
      if (this.projectManager?.loadProjectKnowledgeBase) {
        await this.projectManager.loadProjectKnowledgeBase(this.projectId);
      }
    } catch (err) {
      this._logError('Error loading knowledge base during show()', err);
    }

    // (moved above, after KB load)

    this._logInfo("Initializing subcomponents", { projectId });
    await this._initSubComponents();

    try {
      const tsm = this.eventHandlers.DependencySystem?.modules?.get?.('tokenStatsManager');
      if (tsm?.initialize) await tsm.initialize();
    } catch (e) {
      this._logWarn('TokenStatsManager initialise failed (non-blocking)', { err: e?.message });
    }

    try {
      const pde =
        this.eventHandlers?.DependencySystem?.modules?.get?.(
          'projectDetailsEnhancements'
        );
      if (pde?.initialize) {
        await pde.initialize();
      }
    } catch (err) {
      this._logError(
        'Failed to invoke projectDetailsEnhancements.initialize',
        err
      );
    }

    this._bindEventListeners();
    this._logInfo("Event listeners bound for project details view", { projectId });
    /* Re-request conversation list now that listeners are active.
       The initial load in loadProjectDetails may have fired before
       listeners were registered, leaving the UI empty. */
    try {
      if (this.projectManager?.loadProjectConversations) {
        this._logInfo('Reloading conversations post listener-binding', {
          projectId
        });
        await this.projectManager.loadProjectConversations(projectId);
      }
    } catch (err) {
      this._logError('Error reloading conversations after listener bind', err);
    }
    this._restoreKnowledgeTab();
    this._restoreStatsCounts();
    this.switchTab(activeTab || "chat");
    this._setState({ loading: false });
    this._logInfo(`View for project ${this.projectId} is now visible.`);
  }

  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add("hidden");
      this._logInfo("View hidden.");
    }
    this.eventHandlers.cleanupListeners({ context: 'Sidebar' });
  }

  destroy() {
    // Ensure cleanup of all listeners for this context
    this.eventHandlers.cleanupListeners({ context: 'ProjectDetailsComponent' });
    this.hide();
    this._cleanupPendingOperations();
    this._logInfo("Destroyed.");
  }

  cleanup() { this.destroy(); }

  renderProject(projectObj) {
    if (!projectObj) return;
    this.projectData = projectObj;
    this._renderProjectData();
  }

  _updateNewChatButtonState() {
    const newChatBtn = this.elements.container?.querySelector("#newConversationBtn");
    if (!newChatBtn) return;
    const ready = this.state.projectDataLoaded && this._isAuthenticated();
    newChatBtn.disabled = !ready;
    newChatBtn.classList.toggle("btn-disabled", !ready);
    newChatBtn.title = ready ? 'Start a new conversation' : 'Sign-in required';
    // No click handler here; chatUIEnhancements handles it.
  }


  async _restoreChatAndModelConfig() {
    const tab = this.state.activeTab;
    // Bail out early until the Knowledge Base for the current project is
    // available and active.  ChatManager cannot finish initialisation without
    // an active KB and will otherwise reject with
    // "Project has no knowledge base", emitting a misleading error and
    // leaving the UI in a broken state.  We therefore postpone ChatManager
    // initialisation until `projectKnowledgeBaseLoaded` has fired and the
    // KB is confirmed active.

    // Phase 2 refactor: Chat should initialise even if the Knowledge Base is
    // inactive or still indexing so that users can at least start a basic
    // conversation.  Any KB-powered features will gracefully degrade on the
    // backend / ChatManager side.

    if ((tab === "conversations" || tab === "chat") && this.chatManager?.initialize) {
      const chatTabContent = this.elements.tabs.chat;
      if (chatTabContent) {
        this._logInfo("Initializing chatManager for chat tab", { projectId: this.projectId });

        try {
          // First, load the chat UI template into the container using injected htmlTemplateLoader
          if (this.htmlTemplateLoader?.loadTemplate) {
            await this.htmlTemplateLoader.loadTemplate({
              url: '/static/html/chat_ui.html',
              containerSelector: "#chatUIContainer",
              eventName: 'chatUITemplateLoaded',
              append: false // Replace content instead of appending
            });

            this._logInfo("Chat UI template loaded successfully", { projectId: this.projectId });

            // Wait a moment for DOM to be ready
            await new Promise(resolve => setTimeout(resolve, 100));

            // After template is loaded, initialize the chat manager
            await this.chatManager.initialize({
              projectId: this.projectId,
              /* container is the #chatUIContainer element itself – no inner
                 .chat-container required (template only has the outer div) */
              containerSelector: "#chatUIContainer",
              messageContainerSelector: "#chatMessages",
              inputSelector: "#chatInput",
              sendButtonSelector: "#chatSendBtn",
              titleSelector: "#chatTitle"
            });

            // After chatManager is ready, ensure chatUIEnhancements is initialized
            try {
              const chatUIEnh = this.eventHandlers?.DependencySystem?.modules?.get?.('chatUIEnhancements');
              if (chatUIEnh?.initialize) {
                await chatUIEnh.initialize({ projectId: this.projectId });
              }
            } catch (e) {
              this._logWarn('chatUIEnhancements initialize failed (non-blocking)', { err: e?.message });
            }

            this._logInfo("ChatManager initialized successfully", { projectId: this.projectId });
          } else {
            this._logError("htmlTemplateLoader not available in dependencies");
          }
        } catch (err) {
          this._logError("Failed to load chat UI template or initialize chat manager", err);
        }
      }
    }
  }

  _restoreKnowledgeTab() {
    if (this.knowledgeBaseComponent && typeof this.knowledgeBaseComponent.initialize === "function" && this.state.activeTab === "knowledge") {
      const kbData = this.projectData?.knowledge_base;
      this.knowledgeBaseComponent.initialize(true, kbData, this.projectId)
        .catch(e => this._logError("Error re-initializing knowledge base component", e));
    } else if (this.state.activeTab === "knowledge") {
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

  getEventBus() { return this.bus; }

  setKnowledgeBaseComponent(kbcInstance) {
    this.knowledgeBaseComponent = kbcInstance;
    this._logInfo("KnowledgeBaseComponent instance received and set.", { kbcInstance: !!kbcInstance });
    if (this.state.activeTab === "knowledge") {
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
}
