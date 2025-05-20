/**
 * ProjectDetailsComponent (guardrails-compliant, fully featured)
 * Strict factory-export, dependency-injected, context-logged, modular project details UI.
 * All interactive/business logic is present (files/convos/artifacts/stats/chats/etc.).
 *
 * All guardrails enforced:
 *   - Export only `createProjectDetailsComponent` factory, no top-level logic.
 *   - Validate/fail on all required dependencies up front. DI only.
 *   - All logging via DI-provided logger, with context.
 *   - All DOM/app readiness via DI domReadinessService (never custom events/polling).
 *   - Never access window/document/console except via injected domAPI (DI).
 *   - All network, modals, subcomponents via injected services/classes.
 *   - All user HTML sanitized via sanitizer.sanitize.
 *   - All event listeners tracked/cleaned/removed via eventHandlers, with context.
 *   - No direct mutation of app.state or global.
 *   - No side effects at import.
 */

const MODULE_CONTEXT = "ProjectDetailsComponent";

export function createProjectDetailsComponent(deps) {
  const {
    // Required
    domAPI,
    htmlTemplateLoader,
    domReadinessService,
    eventHandlers,
    navigationService,
    sanitizer,
    logger,
    projectManager,
    APP_CONFIG,
    // Optional
    modalManager,
    FileUploadComponentClass,
    knowledgeBaseComponent = null,
    modelConfig = null,
    chatManager = null,
    apiClient = null,
    app = null               // ← NUEVO
  } = deps || {};

  const missing = [];
  if (!domAPI) missing.push("domAPI");
  if (!htmlTemplateLoader) missing.push("htmlTemplateLoader");
  if (!domReadinessService) missing.push("domReadinessService");
  if (!eventHandlers) missing.push("eventHandlers");
  if (!navigationService) missing.push("navigationService");
  if (!sanitizer) missing.push("sanitizer");
  if (!logger) missing.push("logger");
  if (!projectManager) missing.push("projectManager");
  if (missing.length) {
    if (logger && logger.error) {
      logger.error(`[${MODULE_CONTEXT}] Missing required dependencies: ${missing.join(", ")}`, { context: MODULE_CONTEXT });
    }
    throw new Error(`[${MODULE_CONTEXT}] Missing required dependencies: ${missing.join(", ")}`);
  }

  return new ProjectDetailsComponent({
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
    apiClient
  });
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
      activeTab: "details",
      projectDataLoaded: false
    };
    this.projectId = null;
    this.projectData = null;
    this.listenersContext = MODULE_CONTEXT + "_listeners";
    this.bus = new EventTarget();
    this.fileUploadComponent = null;
    this.elements = {};
    this.auth = this.eventHandlers.DependencySystem?.modules?.get("auth");
  }

  // --- Logging (guardrails) ---
  _logInfo(msg, meta)  { try { this.logger.info(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch (e) { return; } }
  _logWarn(msg, meta)  { try { this.logger.warn(`[${MODULE_CONTEXT}] ${msg}`, { context: MODULE_CONTEXT, ...meta }); } catch (e) { return; } }
  _logError(msg, err, meta) {
    try { this.logger.error(`[${MODULE_CONTEXT}] ${msg}`, err && err.stack ? err.stack : err, { context: MODULE_CONTEXT, ...meta }); }
    catch { throw new Error(`[${MODULE_CONTEXT}] ${msg}: ${err && err.stack ? err.stack : err}`); }
  }
  _safeHandler(fn, description) {
    return (...args) => {
      try { return fn.apply(this, args); }
      catch (err) { this._logError(`In handler [${description}]`, err); throw err; }
    };
  }

  // --- State ---
  _setState(partial) { this.state = { ...this.state, ...partial }; }

  // --- Template & Readiness ---
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

      // htmlTemplateLoader puede devolver `undefined`; considéralo éxito salvo que sea `false`
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
      if (container) container.innerHTML = `<div class="p-4 text-error">Failed to load project details view.</div>`;
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
      '#projectTitle','#backToProjectsBtn',
      '.project-tab-btn','#detailsTab','#filesTab',
      '#conversationsTab','#artifactsTab'
    ];
    const optionalSelectors = [
      "#knowledgeTab",
      "#projectDescription", "#projectGoals", "#projectInstructions",
      "#knowledgeBaseActive", "#knowledgeBaseInactive", "#kbStatusBadge",
      "#knowledgeSearchInput", "#runKnowledgeSearchBtn",
      "#knowledgeResultsList", "#knowledgeSearchResults", "#knowledgeNoResults",
      "#knowledgeTopK",
      "#knowledgeBaseEnabled", "#reprocessFilesBtn", "#setupKnowledgeBaseBtn",
      "#knowledgeBaseSettingsBtn",
      "#knowledgeBaseSettingsModal", "#knowledgeBaseForm",
      "#cancelKnowledgeBaseFormBtn", "#deleteKnowledgeBaseBtn",
      "#knowledgeBaseModelSelect",
      "#knowledgeResultModal", "#knowledgeResultTitle",
      "#knowledgeResultSource", "#knowledgeResultScore",
      "#knowledgeResultContent", "#useInChatBtn",
      "#knowledgeBaseFilesSection", "#knowledgeBaseFilesListContainer",
      "#kbGitHubAttachForm", "#kbGitHubRepoUrlInput",
      "#kbGitHubBranchInput", "#kbGitHubFilePathsTextarea",
      "#kbAttachRepoBtn",
      "#kbGitHubAttachedRepoInfo", "#kbAttachedRepoUrlDisplay",
      "#kbAttachedRepoBranchDisplay", "#kbDetachRepoBtn",
      "#knowledgeBaseName", "#kbModelDisplay",
      "#kbVersionDisplay", "#kbLastUsedDisplay"
    ];
    try {
      await this.domReadinessService.elementsReady(coreSelectors, {
        timeout: this.APP_CONFIG?.TIMEOUTS?.COMPONENT_ELEMENTS_READY ?? 5000,
        context: `${MODULE_CONTEXT}::_ensureElementsReady`
      });
      // fire-and-forget for optional elements – do NOT block init
      this.domReadinessService.elementsReady(optionalSelectors, {
        observeMutations:true,
        timeout: this.APP_CONFIG?.TIMEOUTS?.COMPONENT_ELEMENTS_READY ?? 5000,
        context:`${MODULE_CONTEXT}::optionalElements`
      }).catch(()=>{});
      // Map elements cache
      const $ = (sel) => this.elements.container.querySelector(sel);
      this.elements.title = $("#projectTitle");
      this.elements.backBtn = $("#backToProjectsBtn");
      this.elements.tabBtns = this.elements.container.querySelectorAll(".project-tab-btn");
      this.elements.tabs = {
        details: $("#detailsTab"), files: $("#filesTab"),
        conversations: $("#conversationsTab"), artifacts: $("#artifactsTab"),
        knowledge: $("#knowledgeTab")
      };
      this.elements.description = $("#projectDescription");
      this.elements.goals = $("#projectGoals");
      this.elements.instructions = $("#projectInstructions");
      // Optional: lists/containers for subcomponents
      this.elements.filesList = $("#projectFilesList");
      this.elements.conversationsList = $("#projectConversationsList");
      this.elements.artifactsList = $("#projectArtifactsList");
      // Upload/drag zone
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

  // --- Initialize complex subcomponents and event flows ---
  async _initSubComponents() {
    // File Upload Component
    if (this.FileUploadComponentClass && !this.fileUploadComponent && this.elements.fileInput) {
      try {
        this.fileUploadComponent = new this.FileUploadComponentClass({
          eventHandlers: this.eventHandlers,
          domAPI: this.domAPI,
          projectManager: this.projectManager,
          app: this.eventHandlers.DependencySystem.modules.get("app"),
          onUploadComplete: this._safeHandler(async () => {
            if (!this.projectId) return;
            await this.projectManager.loadProjectFiles(this.projectId);
          }, "UploadComplete"),
          elements: {
            fileInput: this.elements.fileInput,
            uploadBtn: this.elements.uploadBtn,
            dragZone: this.elements.dragZone,
            uploadProgress: this.elements.uploadProgress,
            progressBar: this.elements.progressBar,
            uploadStatus: this.elements.uploadStatus
          }
        });
        const initFn = this.fileUploadComponent.init || this.fileUploadComponent.initialize;
        if (typeof initFn === "function") await initFn.call(this.fileUploadComponent);
      } catch (err) { this._logError("Error initializing FileUploadComponent", err); }
    }
  }

  // Main business/event logic wiring:
  _bindEventListeners() {
    this.eventHandlers.cleanupListeners({ context: 'Sidebar' });

    // Cancel any in-flight async ops to avoid memory-leak / state bleed
    this._cleanupPendingOperations();
    if (!this.elements.container) return;
    // Back
    if (this.elements.backBtn) {
      this.eventHandlers.trackListener(
        this.elements.backBtn, "click", this._safeHandler(
          () => { this.navigationService.navigateToProjectList(); }, "BackBtn"
        ), { context: 'Sidebar', description: "BackButton" });
    }
    // Tabs
    this.elements.tabBtns?.forEach(btn => {
      this.eventHandlers.trackListener(
        btn, "click", this._safeHandler((ev) => {
          const tabName = ev.currentTarget.dataset.tab;
          this.switchTab(tabName);
        }, `Tab:${btn.dataset.tab}`),
        { context: 'Sidebar', description: `TabBtn:${btn.dataset.tab}` }
      );
    });

    // Example: event bus listeners
    const doc = this.domAPI.getDocument();
    // Multi-source event flows for files/convos/artifacts/stats/knowledge
    this.eventHandlers.trackListener(doc, "projectFilesLoaded",
      this._safeHandler((e) => this.renderFiles(e.detail?.files || []), "FilesLoaded"),
      { context: 'Sidebar', description: "FilesLoaded" });
    this.eventHandlers.trackListener(doc, "projectConversationsLoaded",
      this._safeHandler((e) => this.renderConversations(e.detail?.conversations || []), "ConversationsLoaded"),
      { context: 'Sidebar', description: "ConversationsLoaded" });
    this.eventHandlers.trackListener(doc, "projectArtifactsLoaded",
      this._safeHandler((e) => this.renderArtifacts(e.detail?.artifacts || []), "ArtifactsLoaded"),
      { context: 'Sidebar', description: "ArtifactsLoaded" });
    this.eventHandlers.trackListener(doc, "projectStatsLoaded",
      this._safeHandler((e) => this.renderStats(e.detail), "StatsLoaded"),
      { context: 'Sidebar', description: "StatsLoaded" });
    this.eventHandlers.trackListener(
      doc,
      "projectKnowledgeBaseLoaded",
      this._safeHandler(
        async (e) => {
          if (!this.knowledgeBaseComponent) return;
          /* Ensure KnowledgeBaseComponent has captured its DOM elements
             before attempting to render. This prevents a race-condition
             where the KB event fires before KBC.initialize() has run. */
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
      { context: 'Sidebar', description: "KnowledgeLoaded" }
    );
  }

  // --- Tab switching ---
  switchTab(tabName) {
    if (!this.elements.tabs[tabName]) return;
    this._setState({ activeTab: tabName });
    // Highlight the buttons
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

  // --- Per-tab: load/refresh data on view, call PM or init subcomponents as needed ----
  _loadTabContent(tab) {
    if (!this.projectId) return;
    switch (tab) {
      case "files":
        this.projectManager.loadProjectFiles(this.projectId);
        break;
      case "conversations":
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
      // extend
    }
  }

  // --- DATA: fetch
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

  // --- Main render (title/details/etc.) + per-tab specialized rendering
  _renderProjectData() {
    if (!this.elements.container || !this.projectData) return;
    const { name, description, goals, customInstructions } = this.projectData;
    if (this.elements.title)  this.elements.title.textContent = name || "Untitled Project";
    if (this.elements.description)    this.elements.description.innerHTML = this.sanitizer.sanitize(description || "No description.");
    if (this.elements.goals)          this.elements.goals.innerHTML = this.sanitizer.sanitize(goals || "No goals specified.");
    if (this.elements.instructions)   this.elements.instructions.innerHTML = this.sanitizer.sanitize(customInstructions || "No custom instructions.");
    // MAY trigger tab data reloads/rendering here for first view
  }

  // --- Renderers for lists/files/artifacts/convos/stats, always sanitized, all events tracked
  renderFiles(files) {
    const c = this.elements.filesList;
    if (!c) return;
    c.innerHTML = "";
    if (!files.length) {
      c.innerHTML = this.sanitizer.sanitize(`<div class="text-center py-8 text-base-content/60">
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
    c.innerHTML = "";
    if (!convs.length) {
      c.innerHTML = this.sanitizer.sanitize(`<div class="text-center py-8">
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
    c.innerHTML = "";
    if (!arts.length) {
      c.innerHTML = this.sanitizer.sanitize(`<div class="py-8 text-center">No artifacts yet.</div>`);
      return;
    }
    arts.forEach(a => { c.appendChild(this._artifactItem(a)); });
  }

  renderStats(s = {}) {
    const c = this.elements.container;
    if (!c) return;

    const sel = (id) => c.querySelector(id);

    // Counts
    if (sel('#fileCount')        && s.fileCount        !== undefined) sel('#fileCount').textContent        = s.fileCount;
    if (sel('#conversationCount')&& s.conversationCount!== undefined) sel('#conversationCount').textContent = s.conversationCount;
    if (sel('#artifactCount')    && s.artifactCount    !== undefined) sel('#artifactCount').textContent     = s.artifactCount;

    // Token usage
    if (s.tokenUsage !== undefined && s.maxTokens !== undefined && s.maxTokens > 0) {
      const pct = Math.min(100, Math.round((s.tokenUsage / s.maxTokens) * 100));
      if (sel('#tokenUsage'))       sel('#tokenUsage').textContent       = s.tokenUsage;
      if (sel('#maxTokens'))        sel('#maxTokens').textContent        = s.maxTokens;
      if (sel('#tokenPercentage'))  sel('#tokenPercentage').textContent  = pct + '%';
      if (sel('#tokenProgressBar')) {
        sel('#tokenProgressBar').value = pct;
        sel('#tokenProgressBar').max   = 100;
      }
    }
  }

  // --- File/Conversation/Artifact Item DOM (sanitized, event-tracked) ---

  /**
   * Visually highlight the conversation that is currently open
   * @param {string|number} activeId
   */
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

  // ─── Desactivar UI de chat en caso de error / KB inactivo ───
  disableChatUI(reason = 'Chat unavailable') {
    try {
      const input = this.domAPI.getElementById('projectChatInput');
      const send  = this.domAPI.getElementById('projectChatSendBtn');
      [input, send].forEach(el => {
        if (!el) return;
        el.disabled = true;
        el.title    = reason;
        this.domAPI.addClass(el, 'cursor-not-allowed');
        this.domAPI.addClass(el, 'opacity-50');
      });
      const chatBox = this.domAPI.getElementById('projectChatUI');
      if (chatBox) this.domAPI.addClass(chatBox, 'opacity-40');
    } catch {/* silent */ }
  }

  _fileItem(file) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-box shadow-xs hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.fileId = file.id;
    // Offer safe display and controls, all sanitized
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
      this._safeHandler(() => this._downloadFile(file.id, file.filename), `DownloadFile_${file.id}`),
      { context: this.listenersContext, description: `DownloadFile_${file.id}` });
    this.eventHandlers.trackListener(
      deleteBtn, "click",
      this._safeHandler(() => this._confirmDeleteFile(file.id, file.filename), `DeleteFile_${file.id}`),
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
      <p class="text-sm text-base-content/60 truncate mt-1">${this._safeTxt(cv.last_message || "No messages yet")}</p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${this._safeTxt(this._formatDate(cv.updated_at))}</span>
        <span class="badge badge-ghost badge-sm">${this._safeTxt(cv.message_count || 0)} msgs</span>
      </div>
    `);
    this.eventHandlers.trackListener(
      div, "click",
      this._safeHandler(() => this._openConversation(cv), `OpenConversation_${cv.id}`),
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
      this._safeHandler(() => this.projectManager.downloadArtifact(this.projectId, art.id), `DownloadArtifact_${art.id}`),
      { context: this.listenersContext, description: `DownloadArtifact_${art.id}` });
    return div;
  }

  // --- File download/delete/confirm helpers ---
  async _confirmDeleteFile(fileId, fileName) {
    if (!this.projectId || !fileId) return;
    if (!this.modalManager) return;
    this.modalManager.confirmAction({
      title: "Delete file",
      message: `Delete “${this._safeTxt(fileName || fileId)}” permanently?`,
      confirmText: "Delete",
      confirmClass: "btn-error",
      onConfirm: this._safeHandler(async () => {
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
    // ----- Cancel/concurrency handling -----
    if (!this._pendingOperations) this._pendingOperations = new Map();
    const operationKey = `conversation_${cv.id}`;
    // Cancel any existing
    if (this._pendingOperations.has(operationKey)) {
      this._pendingOperations.get(operationKey).cancel();
    }
    // CancelableOperation class definition (injected/defined inline here, singleton-per-method)
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
        // Revalidate project context; set if not present/doesn't match
        const currentProject = this.projectManager.getCurrentProject?.();
        if (!currentProject || currentProject.id !== this.projectId) {
          this.app?.setCurrentProject?.({ id: this.projectId });
          try {
            // Optionally load full project details if possible
            const projectDetails = await this.projectManager.loadProjectDetails(this.projectId);
            if (projectDetails) {
              this.app?.setCurrentProject?.(projectDetails);
            }
          } catch (_e) {
            this._logError("Error loading project before conversation", _e);
            // continue
          }
        }
        // Now get conversation, with context fix
        await this.projectManager.getConversation(cv.id);
        if (operation.canceled) return null;
        if (this.navigationService) {
          this.navigationService.navigateToConversation(this.projectId, cv.id);
        }
        // ENSURE the per-project chatManager loads the selected conversation
        if (this.chatManager && typeof this.chatManager.loadConversation === "function") {
          this.chatManager.loadConversation(cv.id);
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

  // Clean up pending operations on hide/destroy
  _cleanupPendingOperations() {
    if (this._pendingOperations) {
      for (const op of this._pendingOperations.values()) {
        op.cancel();
      }
      this._pendingOperations.clear();
    }
  }


  // -- Utility (defensive rendering, format helpers) --
  _safeAttr(str) { return String(str || "").replace(/[<>"']/g, "_"); }
  _safeTxt(str)  { return this.sanitizer.sanitize(String(str ?? "")); }
  _formatBytes(b) { if (!b) return "0 B"; const n = parseInt(b,10); return n > 1e6 ? (n/1e6).toFixed(1)+" MB" : n > 1e3 ? (n/1e3).toFixed(1)+" kB" : n+" B"; }
  _formatDate(d)  { return d ? (new Date(d)).toLocaleDateString() : ""; }
  _setHTML(el, raw) { el.innerHTML = this.sanitizer.sanitize(raw); }

  // --- LIFECYCLE ---
  async initialize() {
    if (this.state.initialized) return;
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
        this.elements.container.innerHTML = `<div class="p-4 text-error">Failed to initialize project details UI elements.</div>`;
      }
      return this._setState({ loading: false });
    }

    this.elements.container.classList.remove("hidden");
    this._logInfo("Fetching project data", { projectId });
    await this._fetchProjectData(this.projectId);
    this._renderProjectData();
    this._logInfo("Initializing subcomponents", { projectId });
    await this._initSubComponents();

    /* ── Ensure UI-polish module runs (idempotent) ── */
    try {
      const pde =
        this.eventHandlers?.DependencySystem?.modules?.get?.(
          'projectDetailsEnhancements'
        );
      if (pde?.initialize) {
        // Safe to call multiple times – module early-exits if already done
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

    // New Conversation button state, chat/model, KB tab, stats—all advanced flows restored!
    this._updateNewChatButtonState();
    this._logInfo("Restoring chat manager for project details view", { projectId });
    this._restoreChatAndModelConfig();
    this._restoreKnowledgeTab();
    this._restoreStatsCounts();

    this.switchTab(activeTab || "details");
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
    this.hide();
    this._cleanupPendingOperations();    // safety
    this._logInfo("Destroyed.");
  }

  // Expose simple wrapper so external callers (Dashboard) can refresh data
  renderProject(projectObj) {
    if (!projectObj) return;
    this.projectData = projectObj;
    this._renderProjectData();
  }

  // --- Button state for new conversation ---
  _updateNewChatButtonState() {
    const newChatBtn = this.elements.container?.querySelector("#projectNewConversationBtn");
    if (!newChatBtn) return;

    const alreadyBound = newChatBtn.hasAttribute('data-newchat-bound');

    // Project/auth ready?
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
        this._safeHandler(() => this._createNewConversation(), "NewConversationBtn"),
        { context: this.listenersContext, description: "NewConversationBtn" }
      );
      newChatBtn.setAttribute('data-newchat-bound', '1');
    }
  }

  // --- Modal confirm and create new conversation logic ---
  async _createNewConversation() {
    if (!this.projectId || !this.state.projectDataLoaded) return;
    if (this.projectManager.projectLoadingInProgress) return;
    if (!(this.auth && this.auth.getCurrentUserObject?.()?.id)) return;
    try {
      const conv = await this.projectManager.createConversation(this.projectId);
      if (conv?.id) this._openConversation(conv);
    } catch (err) { this._logError("Error creating new conversation", err); }
  }

  // --- Restore chat/model config and panel (on chat/conversations tab) ---
  _restoreChatAndModelConfig() {
    const tab = this.state.activeTab;
    if ((tab === "conversations" || tab === "chat") &&
        this.chatManager?.initialize) {
      const conversationsTabContent = this.elements.tabs.conversations;
      if (conversationsTabContent) {
        this._logInfo("Initializing chatManager for chat tab", { projectId: this.projectId });
    this.chatManager.initialize({
      projectId: this.projectId,
      containerSelector: "#projectChatUI",
      messageContainerSelector: "#projectChatMessages",
      inputSelector: "#projectChatInput",
      sendButtonSelector: "#projectChatSendBtn",
      titleSelector: "#projectChatTitle",
      minimizeButtonSelector: "#projectMinimizeChatBtn"
    })
      .then(() => this._logInfo("chatManager initialized for project details view", { projectId: this.projectId }))
      .catch((err) => { this._logError("Error initializing chatManager", err); });
      }
    }
    // [REMOVED] Model configuration UI in Project Details has been eliminated; use the sidebar
  }

  // --- KB subcomponent hook (re-init on tab switch/delayed inject) ---
  _restoreKnowledgeTab() {
    if (this.knowledgeBaseComponent && this.state.activeTab === "knowledge") {
      const kbData = this.projectData?.knowledge_base;
      this.knowledgeBaseComponent.initialize(true, kbData, this.projectId)
        .catch(e => this._logError("Error re-initializing knowledge base component", e));
    }
  }

  // --- Restore stats rendering (fileCount, convoCount, etc.) ---
  _restoreStatsCounts() {
    if (!this.projectId) return;
    this.projectManager.loadProjectStats(this.projectId)
      .catch(e => this._logError("Error loading stats in restoreStatsCounts", e));
  }

  getEventBus() { return this.bus; }

  setKnowledgeBaseComponent(kbcInstance) {
    this.knowledgeBaseComponent = kbcInstance;
    this._logInfo("KnowledgeBaseComponent instance received and set.", { kbcInstance: !!kbcInstance });
    // If the knowledge tab is already active or becomes active, ensure KBC is initialized
    if (this.state.activeTab === "knowledge" && this.knowledgeBaseComponent && this.projectId) {
      const kbData = this.projectData?.knowledge_base;
      this.knowledgeBaseComponent.initialize(true, kbData, this.projectId)
        .catch(e => this._logError("Error re-initializing knowledge base component after set", e));
    }
  }
}
