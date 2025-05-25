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
    this.app = deps.app || this.eventHandlers.DependencySystem?.modules?.get('app');
    this.modelConfig = deps.modelConfig;
    this.chatManager = deps.chatManager;
    this.apiClient = deps.apiClient;
    this.containerId = "projectDetailsView";
    this.templatePath = "/static/html/project_details.html";
    this.state = {
      initialized: false,
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
    this.auth = this.eventHandlers.DependencySystem?.modules?.get("auth");
    // Canonical safeHandler injected via DI, fallback is error.
    this.safeHandler = this.eventHandlers?.DependencySystem?.modules?.get?.('safeHandler');
    if (typeof this.safeHandler !== 'function') {
      throw new Error(`[${MODULE_CONTEXT}] Missing required dependency: safeHandler`);
    }
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
  setChatManager(cm) { this.chatManager = cm; }

  _logInfo(msg, meta) { try { this.logger.info(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch (e) { return; } }
  _logWarn(msg, meta) { try { this.logger.warn(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch (e) { return; } }
  _logError(msg, err, meta) {
    try { this.logger.error(`[${MODULE_CONTEXT}] ${msg}`, err && err.stack ? err.stack : err, { context: MODULE_CONTEXT, ...meta }); }
    catch { throw new Error(`[${MODULE_CONTEXT}] ${msg}: ${err && err.stack ? err.stack : err}`); }
  }
  // Canonical safeHandler injected via DI, local fallback removed.

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
      '.project-tab', '#chatTab', '#filesTab', '#knowledgeTab', '#settingsTab'
    ];
    // Optional but expected selectors; if missing we continue with warning.
    const optionalSelectors = [
      // Knowledge tab
      "#knowledgeSearchInput", "#searchKnowledgeBtn",
      "#knowledgeResults",
      "#kbToggle", "#reprocessButton", "#setupButton", "#settingsButton",
      "#modelSelect",
      "#knowledgeBaseName", "#kbModelDisplay", "#kbVersionDisplay", "#kbLastUsedDisplay",
      "#kbDocCount", "#kbChunkCount",
      // Project metadata editing
      "#projectNameInput", "#projectDescriptionInput",
      // File-upload controls (previously missing – caused FileUploadComponent crash)
      "#fileInput", "#uploadFileBtn", "#dragDropZone",
      "#filesUploadProgress", "#fileProgressBar", "#uploadStatus",
      // Misc project actions
      "#archiveProjectBtn", "#deleteProjectBtn",
      "#editProjectBtn", "#projectMenuBtn", "#projectFab"
    ];
    try {
      await this.domReadinessService.elementsReady(coreSelectors, {
        timeout: this.APP_CONFIG?.TIMEOUTS?.COMPONENT_ELEMENTS_READY ?? 5000,
        context: `${MODULE_CONTEXT}::_ensureElementsReady`
      });
      this.domReadinessService.elementsReady(optionalSelectors, {
        observeMutations: true,
        timeout: 2000,
        context: `${MODULE_CONTEXT}::optionalElements`
      }).catch((err) => {
        this._logInfo(`Some optional elements not found within timeout, continuing anyway`, {
          missingElements: err?.message || 'unknown',
          context: `${MODULE_CONTEXT}::optionalElements`
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

    // Validate presence of all required DOM nodes before instantiation.
    const required = {
      fileInput: this.elements.fileInput,
      uploadBtn: this.elements.uploadBtn,
      dragZone: this.elements.dragZone,
      uploadProgress: this.elements.uploadProgress,
      progressBar: this.elements.progressBar,
      uploadStatus: this.elements.uploadStatus
    };
    const missingKeys = Object.entries(required)
      .filter(([_, el]) => !el)
      .map(([k]) => k);

    if (missingKeys.length) {
      this._logError(
        `Cannot initialize FileUploadComponent; missing elements: ${missingKeys.join(
          ", "
        )}`,
        new Error("Missing DOM Elements")
      );
      return;
    }

    try {
      this.fileUploadComponent = new this.FileUploadComponentClass({
        eventHandlers: this.eventHandlers,
        domAPI: this.domAPI,
        projectManager: this.projectManager,
        app: this.eventHandlers.DependencySystem.modules.get("app"),
        domReadinessService: this.domReadinessService,
        logger: this.logger,
        onUploadComplete: this.safeHandler(async () => {
          if (!this.projectId) return;
          await this.projectManager.loadProjectFiles(this.projectId);
        }, "UploadComplete"),
        elements: required
      });
      const initFn =
        this.fileUploadComponent.init || this.fileUploadComponent.initialize;
      if (typeof initFn === "function")
        await initFn.call(this.fileUploadComponent);
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
    const doc = this.domAPI.getDocument();
    this.eventHandlers.trackListener(doc, "projectFilesLoaded",
      this.safeHandler((e) => this.renderFiles(e.detail?.files || []), "FilesLoaded"),
      { context: 'ProjectDetailsComponent', description: "FilesLoaded" });
    this.eventHandlers.trackListener(doc, "projectConversationsLoaded",
      this.safeHandler((e) => this.renderConversations(e.detail?.conversations || []), "ConversationsLoaded"),
      { context: 'ProjectDetailsComponent', description: "ConversationsLoaded" });
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
          try {
            await this.knowledgeBaseComponent.initialize?.(
              false,
              e.detail?.knowledgeBase,
              e.detail?.projectId
            );
          } catch (err) {
            this._logError("Error initializing knowledgeBaseComponent", err);
          }
          this.knowledgeBaseComponent.renderKnowledgeBaseInfo?.(
            e.detail?.knowledgeBase,
            e.detail?.projectId
          );
          if (e.detail?.knowledgeBase) {
            this.projectData ||= {};
            this.projectData.knowledge_base = e.detail.knowledgeBase;
            this._updateNewChatButtonState();
          }
        },
        "KnowledgeLoaded"
      ),
      { context: 'ProjectDetailsComponent', description: "KnowledgeLoaded" }
    );
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
      case "knowledge":
        if (this.knowledgeBaseComponent) {
          this.knowledgeBaseComponent.initialize(true, this.projectData?.knowledge_base, this.projectId)
            .catch(e => this._logError("Error initializing knowledgeBaseComponent", e));
        }
        break;
    }
  }

  async _fetchProjectData(projectId) {
    this._logInfo(`Fetching data for project ${projectId}...`);
    try {
      const project = await this.projectManager.loadProjectDetails(projectId);
      this.projectData = project || null;
      if (!this.projectData) this._logError(`Unable to load project ${projectId}`);
      else this._logInfo(`Project data loaded`, { projectId });
      this._setState({ projectDataLoaded: true });
    } catch (err) {
      this._logError(`Error loading project data`, err);
      this.projectData = null;
      this._setState({ projectDataLoaded: false });
    }
  }

  _renderProjectData() {
    if (!this.elements.container || !this.projectData) return;
    const { name, description, goals, customInstructions, created_at } = this.projectData;
    if (this.elements.title) this.elements.title.textContent = name || "Untitled Project";
    if (this.elements.projectNameDisplay) {
      this.elements.projectNameDisplay.textContent = name || "Untitled Project";
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
      this.elements.projectCreatedDate.textContent = this._formatDate(created_at);
    }
  }

  _formatDate(dateString) {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch (error) {
      return 'Unknown';
    }
  }

  renderFiles(files) {
    const c = this.elements.filesList;
    if (!c) return;
    this.domAPI.replaceChildren(c);
    if (!files.length) {
      this.domAPI.setInnerHTML(c, `<div class="text-center py-8 text-base-content/60">
        <p>No files uploaded yet.</p>
        <p class="text-sm mt-1">Drag & drop or click Upload.</p>
      </div>`);
      return;
    }
    files.forEach(f => { c.appendChild(this._fileItem(f)); });
  }

  renderConversations(convs) {
    const c = this.elements.conversationsList;
    if (!c) return;
    this.domAPI.replaceChildren(c);
    if (!convs.length) {
      this.domAPI.setInnerHTML(c, `<div class="text-center py-8">
        <p>No conversations yet. Click “New Chat”.</p>
      </div>`);
      return;
    }
    convs.forEach(cv => { c.appendChild(this._conversationItem(cv)); });
    if (this.chatManager?.currentConversationId) {
      this._highlightActiveConversation(this.chatManager.currentConversationId);
    }
  }

  renderArtifacts(arts) {
    const c = this.elements.artifactsList;
    if (!c) return;
    this.domAPI.replaceChildren(c);
    if (!arts.length) {
      this.domAPI.setInnerHTML(c, `<div class="py-8 text-center">No artifacts yet.</div>`);
      return;
    }
    arts.forEach(a => { c.appendChild(this._artifactItem(a)); });
  }

  renderStats(s = {}) {
    const c = this.elements.container;
    if (!c) return;
    const sel = (id) => c.querySelector(id);
    if (sel('#fileCount') && s.fileCount !== undefined) sel('#fileCount').textContent = s.fileCount;
    if (sel('#conversationCount') && s.conversationCount !== undefined) sel('#conversationCount').textContent = s.conversationCount;
    if (sel('#artifactCount') && s.artifactCount !== undefined) sel('#artifactCount').textContent = s.artifactCount;
  }

  _highlightActiveConversation(activeId) {
    const list = this.elements?.conversationsList;
    if (!list) return;
    Array.from(list.children).forEach(item => {
      item.classList.toggle(
        'active',
        item.dataset.conversationId === String(activeId)
      );
    });
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
    this._setHTML(div, `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-xl text-primary">📄</span>
        <div class="flex flex-col min-w-0 flex-1">
          <div class="font-medium truncate" title="${this._safeAttr(file.filename)}">${this._safeTxt(file.filename)}</div>
          <div class="text-xs text-base-content/70">
            ${this._safeTxt(this._formatBytes(file.file_size))} · ${this._safeTxt(this._formatDate(file.created_at))}
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
    this._setHTML(div, `
      <h4 class="font-medium truncate mb-1">${this._safeTxt(cv.title || "Untitled conversation")}</h4>
      <p class="text-sm text-base-content/60 truncate leading-tight mt-0.5">${this._safeTxt(cv.last_message || "No messages yet")}</p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${this._safeTxt(this._formatDate(cv.updated_at))}</span>
        <span class="badge badge-ghost badge-sm">${this._safeTxt(cv.message_count || 0)} msgs</span>
      </div>
    `);
    this.eventHandlers.trackListener(
      div, "click",
      this.safeHandler(() => this._openConversation(cv), `OpenConversation_${cv.id}`),
      { context: this.listenersContext, description: `OpenConversation_${cv.id}` });
    return div;
  }

  _artifactItem(art) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "p-3 border-b border-base-300 hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.artifactId = art.id;
    this._setHTML(div, `
      <div class="flex justify-between items-center">
        <h4 class="font-medium truncate">${this._safeTxt(art.name || "Untitled artifact")}</h4>
        <span class="text-xs text-base-content/60">${this._safeTxt(this._formatDate(art.created_at))}</span>
      </div>
      <p class="text-sm text-base-content/70 truncate mt-1">${this._safeTxt(art.description || art.type || "No description")}</p>
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
      message: `Delete “${this._safeTxt(fileName || fileId)}” permanently?`,
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

  async _openConversation(cv) {
    if (!this.projectId || !cv?.id) return;
    if (!this._pendingOperations) this._pendingOperations = new Map();
    const operationKey = `conversation_${cv.id}`;
    if (this._pendingOperations.has(operationKey)) {
      this._pendingOperations.get(operationKey).cancel();
    }
    class CancelableOperation {
      constructor() {
        this.canceled = false;
        this.promise = null;
      }
      execute(asyncFn) {
        this.canceled = false;
        this.promise = (async () => {
          try {
            if (this.canceled) return null;
            return await asyncFn();
          } catch (err) {
            if (this.canceled) {
              return null;
            }
            throw err;
          }
        })();
        return this.promise;
      }
      cancel() {
        this.canceled = true;
        this.promise = null;
      }
    }
    const operation = new CancelableOperation();
    this._pendingOperations.set(operationKey, operation);

    return operation.execute(async () => {
      try {
        const currentProject = this.projectManager.getCurrentProject?.();
        if (!currentProject || currentProject.id !== this.projectId) {
          this.app?.setCurrentProject?.({ id: this.projectId });
          try {
            const projectDetails = await this.projectManager.loadProjectDetails(this.projectId);
            if (projectDetails) {
              this.app?.setCurrentProject?.(projectDetails);
            }
          } catch (_e) {
            this._logError("Error loading project before conversation", _e);
          }
        }
        await this.projectManager.getConversation(cv.id);
        if (operation.canceled) return null;
        if (this.navigationService) {
          this.navigationService.navigateToConversation(this.projectId, cv.id);
        }
        if (this.chatManager && typeof this.chatManager.loadConversation === "function") {
          if (!this.chatManager.projectId || this.chatManager.projectId !== this.projectId) {
            this._logInfo("ChatManager not initialized for current project, initializing first", {
              currentProjectId: this.projectId,
              chatManagerProjectId: this.chatManager.projectId
            });
            if (this.chatManager.forceProjectIdSync) {
              const syncedProjectId = this.chatManager.forceProjectIdSync();
              this._logInfo("Attempted ChatManager project ID sync", {
                syncedProjectId,
                expectedProjectId: this.projectId
              });
            }
            await this.chatManager.initialize({
              projectId: this.projectId,
              containerSelector: "#chatTab .chat-container",
              messageContainerSelector: "#chatMessages",
              inputSelector: "#chatInput",
              sendButtonSelector: "#chatSendBtn",
              titleSelector: "#chatTitle",
              minimizeButtonSelector: "#minimizeChatBtn"
            });
          }
          this._logInfo("Loading conversation in ChatManager", { conversationId: cv.id, projectId: this.projectId });
          await this.chatManager.loadConversation(cv.id);
        }
        this._highlightActiveConversation(cv.id);
      } catch (_e) {
        if (!operation.canceled) {
          this._logError("Error opening conversation", _e);
        }
        return null;
      }
    });
  }

  _cleanupPendingOperations() {
    if (this._pendingOperations) {
      for (const op of this._pendingOperations.values()) {
        op.cancel();
      }
      this._pendingOperations.clear();
    }
  }

  _safeAttr(str) { return String(str || "").replace(/[<>"']/g, "_"); }
  _safeTxt(str) { return this.sanitizer.sanitize(String(str ?? "")); }
  _formatBytes(b) { if (!b) return "0 B"; const n = parseInt(b, 10); return n > 1e6 ? (n / 1e6).toFixed(1) + " MB" : n > 1e3 ? (n / 1e3).toFixed(1) + " kB" : n + " B"; }
  _setHTML(el, raw) { this.domAPI.setInnerHTML(el, raw); }

  async initialize() {
    if (this.state.initialized) return;
    await this.domReadinessService.waitForEvent('app:ready');
    this._logInfo("Initializing...");
    this._setState({ initialized: true });
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
    this._updateNewChatButtonState();
    this._logInfo("Restoring chat manager for project details view", { projectId });
    this._restoreChatAndModelConfig();
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
    this.eventHandlers.cleanupListeners({ context: 'Sidebar' });
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
    const alreadyBound = newChatBtn.hasAttribute('data-newchat-bound');
    const kbActive =
      !!this.projectData?.knowledge_base &&
      this.projectData.knowledge_base.is_active !== false;
    const ready =
      this.state.projectDataLoaded &&
      (this.auth?.isAuthenticated?.() ?? false) &&
      kbActive;
    newChatBtn.disabled = !ready;
    newChatBtn.classList.toggle("btn-disabled", !ready);
    newChatBtn.title = ready
      ? 'Start a new conversation'
      : (kbActive ? 'Sign-in required' : 'Knowledge Base required');
    if (!alreadyBound) {
      this.eventHandlers.trackListener(
        newChatBtn,
        "click",
        this.safeHandler(() => this._createNewConversation(), "NewConversationBtn"),
        { context: this.listenersContext, description: "NewConversationBtn" }
      );
      newChatBtn.setAttribute('data-newchat-bound', '1');
    }
  }

  async _createNewConversation() {
    if (!this.projectId || !this.state.projectDataLoaded) return;
    if (this.projectManager.projectLoadingInProgress) return;
    if (!(this.auth && this.auth.getCurrentUserObject?.()?.id)) return;
    try {
      const conv = await this.projectManager.createConversation(this.projectId);
      if (conv?.id) this._openConversation(conv);
    } catch (err) { this._logError("Error creating new conversation", err); }
  }

  _restoreChatAndModelConfig() {
    const tab = this.state.activeTab;
    if ((tab === "conversations" || tab === "chat") &&
      this.chatManager?.initialize) {
      const chatTabContent = this.elements.tabs.chat;
      if (chatTabContent) {
        this._logInfo("Initializing chatManager for chat tab", { projectId: this.projectId });
        this.chatManager.initialize({
          projectId: this.projectId,
          containerSelector: "#chatTab .chat-container",
          messageContainerSelector: "#chatMessages",
          inputSelector: "#chatInput",
          sendButtonSelector: "#chatSendBtn",
          titleSelector: "#chatTitle",
          minimizeButtonSelector: "#minimizeChatBtn"
        })
          .then(() => this._logInfo("chatManager initialized for project details view", { projectId: this.projectId }))
          .catch((err) => { this._logError("Error initializing chatManager", err); });
      }
    }
  }

  _restoreKnowledgeTab() {
    if (this.knowledgeBaseComponent && this.state.activeTab === "knowledge") {
      const kbData = this.projectData?.knowledge_base;
      this.knowledgeBaseComponent.initialize(true, kbData, this.projectId)
        .catch(e => this._logError("Error re-initializing knowledge base component", e));
    }
  }

  _restoreStatsCounts() {
    if (!this.projectId) return;
    this.projectManager.loadProjectStats(this.projectId)
      .catch(e => this._logError("Error loading stats in restoreStatsCounts", e));
  }

  getEventBus() { return this.bus; }

  setKnowledgeBaseComponent(kbcInstance) {
    this.knowledgeBaseComponent = kbcInstance;
    this._logInfo("KnowledgeBaseComponent instance received and set.", { kbcInstance: !!kbcInstance });
    if (this.state.activeTab === "knowledge" && this.knowledgeBaseComponent && this.projectId) {
      const kbData = this.projectData?.knowledge_base;
      this.knowledgeBaseComponent.initialize(true, kbData, this.projectId)
        .catch(e => this._logError("Error re-initializing knowledge base component after set", e));
    }
  }
}
