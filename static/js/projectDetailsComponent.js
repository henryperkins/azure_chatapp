/**
 * projectDetailsComponent.js                     — DI-strict, no window.*, no console.*
 *
 * ALL user/system notification, error, warning, or info banners must be routed
 * via the DI notification utility (`notify` injected at construction).
 * For dev/debug logs, use only the injected `notify` (never user-facing popups).
 *
 * For architectural conventions, see notification-system.md and custominstructions.md.
 *
 * Component for displaying project details, files, conversations, artifacts,
 * and knowledge-base data. -- EVERY dependency is passed in, nothing global.
 *
 * Required constructor deps
 * ----------------------------------------------------------
 *   app                    : core app module (validators, formatters, etc.)
 *   projectManager         : backend operations + event emitters
 *   eventHandlers          : centralised listener registry (trackListener / delegate / cleanupListeners)
 *   modalManager           : confirmations / modals
 *   FileUploadComponentClass : class/factory for upload UI
 *   router                 : { getURL():string, navigate(url:string):void }
 *   notify                 : DI notification util: success/warn/error/info/confirm
 *   sanitizer              : { sanitize(html):string }  (for ALL innerHTML)
 *   domAPI                 : { getElementById(id):Element, getDocument():Document, dispatchEvent(evt:Event) }
 *
 * Optional constructor deps
 * ----------------------------------------------------------
 *   knowledgeBaseComponent : KB UI module
 *   modelConfig            : chat-model quick-config panel
 *   onBack                 : callback for back button
 *   chatManager            : optional for chat integration
 */

export class ProjectDetailsComponent {
  constructor({
    onBack,
    app,
    projectManager,
    eventHandlers,
    modalManager,
    FileUploadComponentClass,
    router,
    notify,                 // CHANGED: Now rely on direct injection of notify
    sanitizer,
    domAPI,
    knowledgeBaseComponent = null,
    modelConfig = null,
    chatManager = null
  } = {}) {
    /* ------------------------------------------------------  dependency gate */
    if (
      !app ||
      !projectManager ||
      !eventHandlers ||
      !modalManager ||
      !FileUploadComponentClass ||
      !router ||
      !notify ||
      !sanitizer ||
      !domAPI
    ) {
      throw new Error(
        "[ProjectDetailsComponent] Missing required dependencies " +
        "(app, projectManager, eventHandlers, modalManager, FileUploadComponentClass, " +
        "router, notify, sanitizer, domAPI)."
      );
    }

    /* ------------------------------------------------------  store deps      */
    this.app = app;
    this.projectManager = projectManager;
    this.eventHandlers = eventHandlers;
    this.modalManager = modalManager;
    this.FileUploadComponentClass = FileUploadComponentClass;
    this.router = router;
    this.notify = notify;           // CHANGED: Store the injected notify instance
    this.sanitizer = sanitizer;
    this.domAPI = domAPI;
    this.knowledgeBaseComponent = knowledgeBaseComponent;
    this.modelConfig = modelConfig;
    this.chatManager = chatManager;

    /* ------------------------------------------------------  callbacks      */
    this.onBack = onBack || (() => {
      // CHANGED: Replaced any console/log calls with notify
      this.notify.warn("[ProjectDetailsComponent] onBack callback not provided.", {
        group: true,
        context: "projectDetailsComponent"
      });
    });

    /* ------------------------------------------------------  state + cache  */
    this.state = {
      currentProject: null,
      activeTab: "details",
      isLoading: Object.create(null),
      initialized: false
    };

    this.fileConstants = {
      allowedExtensions: [
        ".txt", ".md", ".csv", ".json", ".pdf", ".doc", ".docx", ".py", ".js",
        ".html", ".css", ".jpg", ".jpeg", ".png", ".gif", ".zip"
      ],
      maxSizeMB: 30
    };

    this.elements = {
      container: null, title: null, description: null, backBtn: null,
      tabContainer: null, filesList: null, conversationsList: null,
      artifactsList: null, tabContents: {}, loadingIndicators: {},
      fileInput: null, uploadBtn: null, dragZone: null,
      uploadProgress: null, progressBar: null, uploadStatus: null
    };

    this.fileUploadComponent = null;
  }

  /* ========== INITIALISATION ================================================= */

  async initialize() {
    if (this.state.initialized) {
      // CHANGED: Use notify instead of app.showNotification
      this.notify.info("[ProjectDetailsComponent] Already initialized.", {
        group: true,
        context: "projectDetailsComponent"
      });
      this.notify.info("Project Details view already initialized.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 4000
      });
      return true;
    }

    try {
      if (!this._findElements()) {
        // CHANGED: Replacement for app.showNotification
        this.notify.error("Critical error: required DOM nodes missing for Project Details.", {
          group: true,
          context: "projectDetailsComponent",
          timeout: 0
        });
        throw new Error("Required DOM nodes missing in #projectDetailsView.");
      }

      this.notify.info("[ProjectDetailsComponent] Found required elements.", {
        group: true,
        context: "projectDetailsComponent"
      });
      this._bindCoreEvents();
      this._initSubComponents();

      this.state.initialized = true;
      // CHANGED: Using notify for success messages
      this.notify.success("Project Details module initialized.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 3000
      });

      // Internal ready flag
      this._uiReadyFlag = true;
      this._maybeEmitReady();

      return true;
    } catch (err) {
      // CHANGED: Use notify.error for initialization failure
      this.notify.error("[ProjectDetailsComponent] Init failed: " + (err?.message || err), {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.notify.error("Project Details failed to initialise.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return false;
    }
  }

  /* ========== DOM HELPER UTILS ============================================== */

  /** always sanitize anything shoved into innerHTML */
  _html(el, raw) {
    el.innerHTML = this.sanitizer.sanitize(raw);
  }

  _clear(el) {
    el.innerHTML = "";
  }

  /* ========== DOM QUERY ===================================================== */

  _findElements() {
    const doc = this.domAPI.getDocument();
    this.elements.container = this.domAPI.getElementById("projectDetailsView");
    if (!this.elements.container) {
      // CHANGED: Use notify.error for DOM error
      this.notify.error("[ProjectDetailsComponent] #projectDetailsView not found", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return false;
    }

    const $ = (sel) => this.elements.container.querySelector(sel);

    this.elements.title = $("#projectTitle");
    this.elements.description = $("#projectDescription");
    this.elements.backBtn = $("#backToProjectsBtn");
    this.elements.tabContainer = this.elements.container.querySelector('.tabs[role="tablist"]');

    this.elements.filesList = $("#projectFilesList");
    this.elements.conversationsList = $("#projectConversationsList");
    this.elements.artifactsList = $("#projectArtifactsList");

    this.elements.tabContents = {
      details: $("#detailsTab"),
      files: $("#filesTab"),
      knowledge: $("#knowledgeTab"),
      conversations: $("#conversationsTab"),
      artifacts: $("#artifactsTab"),
      chat: $("#chatTab")
    };

    this.elements.loadingIndicators = {
      files: $("#filesLoadingIndicator"),
      conversations: $("#conversationsLoadingIndicator"),
      artifacts: $("#projectArtifactsList"),
      stats: $("#statsLoadingIndicator")
    };

    this.elements.fileInput = $("#fileInput");
    this.elements.uploadBtn = $("#uploadFileBtn");
    this.elements.dragZone = $("#dragDropZone");
    this.elements.uploadProgress = $("#filesUploadProgress");
    this.elements.progressBar = $("#fileProgressBar");
    this.elements.uploadStatus = $("#uploadStatus");

    return !!(this.elements.title && this.elements.backBtn && this.elements.tabContainer);
  }

  /* ========== EVENT BINDINGS =============================================== */

  _bindCoreEvents() {
    /* back-button */
    if (this.elements.backBtn) {
      this.eventHandlers.cleanupListeners(this.elements.backBtn, "click");
      this.eventHandlers.trackListener(
        this.elements.backBtn,
        "click",
        (e) => this.onBack(e),
        { description: "ProjectDetails_Back" }
      );
    }

    /* tab-clicks (delegated) */
    if (this.elements.tabContainer) {
      this.eventHandlers.cleanupListeners(this.elements.tabContainer, "click");
      this.eventHandlers.delegate(
        this.elements.tabContainer,
        "click",
        ".project-tab-btn",
        (_e, btn) => {
          const tab = btn.dataset.tab;
          if (tab) this.switchTab(tab);
        },
        { description: "ProjectDetails_TabSwitch" }
      );
    }

    /* "New chat" button (starts disabled) */
    const newChatBtn = this.elements.container.querySelector("#projectNewConversationBtn");
    if (newChatBtn) {
      newChatBtn.disabled = true;
      newChatBtn.classList.add("btn-disabled");
      this.eventHandlers.trackListener(
        newChatBtn,
        "click",
        () => this.createNewConversation(),
        { description: "ProjectDetails_NewConversation" }
      );
    }

    /* doc-based listeners (replacing direct document usage) */
    const doc = this.domAPI.getDocument();
    const on = (evt, cb, desc) =>
      this.eventHandlers.trackListener(doc, evt, cb, { description: desc });

    on("projectConversationsLoaded", (e) => {
      this.renderConversations(e.detail?.conversations || []);
      this.domAPI.dispatchEvent(
        new CustomEvent("projectConversationsRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_ConversationsLoaded");

    on("projectFilesLoaded", (e) => {
      this.renderFiles(e.detail?.files || []);
      this.domAPI.dispatchEvent(
        new CustomEvent("projectFilesRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_FilesLoaded");

    on("projectArtifactsLoaded", (e) => {
      this.renderArtifacts(e.detail?.artifacts || []);
      this.domAPI.dispatchEvent(
        new CustomEvent("projectArtifactsRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_ArtifactsLoaded");

    on("projectStatsLoaded", (e) => {
      this.renderStats(e.detail);
      this.domAPI.dispatchEvent(
        new CustomEvent("projectStatsRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_StatsLoaded");

    on("projectKnowledgeBaseLoaded", (e) => {
      this.knowledgeBaseComponent?.renderKnowledgeBaseInfo?.(
        e.detail?.knowledgeBase,
        e.detail?.projectId
      );
      this.domAPI.dispatchEvent(
        new CustomEvent("projectKnowledgeBaseRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_KnowledgeLoaded");

    on("projectDetailsFullyLoaded", (e) => {
      this.notify.info(`[ProjectDetailsComponent] Project ${e.detail?.projectId} fully loaded.`, {
        group: true,
        context: "projectDetailsComponent"
      });
      const newChat = this.elements.container.querySelector("#projectNewConversationBtn");
      if (newChat) {
        newChat.disabled = false;
        newChat.classList.remove("btn-disabled");
      }
    }, "PD_FullyLoaded");
  }

  /* ========== SUB-COMPONENTS ============================================== */

  _initSubComponents() {
    if (!this.fileUploadComponent && this.FileUploadComponentClass) {
      const els = this.elements;
      const ready =
        els.fileInput && els.uploadBtn && els.dragZone &&
        els.uploadProgress && els.progressBar && els.uploadStatus;

      if (!ready) {
        // CHANGED: using notify warn
        this.notify.warn("[ProjectDetailsComponent] FileUploadComponent DOM nodes missing.", {
          group: true,
          context: "projectDetailsComponent"
        });
        return;
      }

      // Using an inline notify wrapper is no longer strictly needed;
      // we can pass this.notify directly if the subcomponent expects it.
      this.fileUploadComponent = new this.FileUploadComponentClass({
        fileInput: els.fileInput,
        uploadBtn: els.uploadBtn,
        dragZone: els.dragZone,
        uploadProgress: els.uploadProgress,
        progressBar: els.progressBar,
        uploadStatus: els.uploadStatus,
        projectManager: this.projectManager,
        app: this.app,
        eventHandlers: this.eventHandlers,
        notify: this.notify,
        onUploadComplete: () => {
          const id = this.state.currentProject?.id;
          if (id) this.projectManager.loadProjectFiles(id);
        }
      });

      this.fileUploadComponent.initialize?.();
      this.notify.info("[ProjectDetailsComponent] FileUploadComponent ready.", {
        group: true,
        context: "projectDetailsComponent"
      });
    }
  }

  /* ========== PUBLIC API =================================================== */

  show() {
    if (!this.state.initialized || !this.elements.container) {
      // CHANGED: replaced previous error approach
      this.notify.error("[ProjectDetailsComponent] show() called before init.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return;
    }
    this.elements.container.classList.remove("hidden");
    this.elements.container.setAttribute("aria-hidden", "false");
    this.notify.info("[ProjectDetailsComponent] Shown.", {
      group: true,
      context: "projectDetailsComponent"
    });
  }

  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add("hidden");
      this.elements.container.setAttribute("aria-hidden", "true");
      this.notify.info("[ProjectDetailsComponent] Hidden.", {
        group: true,
        context: "projectDetailsComponent"
      });
    }
  }

  /** render top header + reset tab */
  renderProject(project) {
    if (!this.state.initialized) {
      // CHANGED
      this.notify.error("[ProjectDetailsComponent] renderProject before init.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) {
      // CHANGED
      this.notify.error("[ProjectDetailsComponent] Invalid project payload.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.notify.error("Failed to load project details: Invalid or missing project ID.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.onBack();
      return;
    }

    this.notify.info(`[ProjectDetailsComponent] Render project ${project.id}`, {
      group: true,
      context: "projectDetailsComponent"
    });
    this.state.currentProject = project;

    this._dataReadyProjectId = project.id;
    this._dataReadyFlag = true;
    this._maybeEmitReady();

    this.fileUploadComponent?.setProjectId?.(project.id);

    /* header */
    this.elements.title.textContent = project.title || project.name || "Untitled project";
    this.elements.description.textContent = project.description || "";

    this.switchTab("details");
    this.show();
  }

  /** tab switcher */
  switchTab(tabName) {
    if (!this.state.initialized) {
      this.notify.warn("[ProjectDetailsComponent] switchTab before init.", {
        group: true,
        context: "projectDetailsComponent"
      });
      return;
    }

    const TABS = ["details", "files", "knowledge", "conversations", "artifacts"];
    if (!TABS.includes(tabName)) {
      this.notify.warn(`[ProjectDetailsComponent] invalid tab "${tabName}".`, {
        group: true,
        context: "projectDetailsComponent"
      });
      this.notify.warning(`Attempted to switch to invalid tab: ${tabName}`, {
        group: true,
        context: "projectDetailsComponent",
        timeout: 5000
      });
      return;
    }

    const pid = this.state.currentProject?.id;
    const needsProject = ["files", "knowledge", "conversations", "artifacts", "chat"].includes(tabName);

    if (needsProject && !this.app.validateUUID(pid)) {
      this.notify.error(`[ProjectDetailsComponent] tab "${tabName}" needs valid project.`, {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.notify.warning("Please select a valid project before accessing this tab.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 5000
      });
      return;
    }

    this.notify.info(`[ProjectDetailsComponent] tab => ${tabName}`, {
      group: true,
      context: "projectDetailsComponent"
    });
    this.state.activeTab = tabName;
    this.notify.info(`Switched to "${tabName}" tab.`, {
      group: true,
      context: "projectDetailsComponent",
      timeout: 2500
    });

    /* aria & visual */
    this.elements.tabContainer
      ?.querySelectorAll(".project-tab-btn")
      .forEach(btn => {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle("tab-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });

    Object.entries(this.elements.tabContents).forEach(([key, el]) => {
      if (el) el.classList.toggle("hidden", key !== tabName);
    });

    /* lazy load */
    this._loadTabContent(tabName);

    // Chat manager usage (was previously window.DependencySystem)
    if (tabName === "conversations") {
      if (this.chatManager && typeof this.chatManager.initialize === "function") {
        this.chatManager.initialize({
          projectId: this.state.currentProject?.id,
          containerSelector: "#projectChatUI",
          messageContainerSelector: "#projectChatMessages",
          inputSelector: "#projectChatInput",
          sendButtonSelector: "#projectChatSendBtn"
        }).catch((err) => {
          // CHANGED
          this.notify.error("[ProjectDetailsComponent] Failed to init chatManager for conversations: " + (err?.message || err), {
            group: true,
            context: "projectDetailsComponent",
            timeout: 0
          });
          this.notify.error("Unable to initialize chat manager for Conversations tab.", {
            group: true,
            context: "projectDetailsComponent",
            timeout: 0
          });
        });
      } else {
        // CHANGED
        this.notify.error("[ProjectDetailsComponent] chatManager DI missing or invalid for conversations tab.", {
          group: true,
          context: "projectDetailsComponent",
          timeout: 0
        });
        this.notify.error("Chat functionality is currently unavailable (missing dependencies).", {
          group: true,
          context: "projectDetailsComponent",
          timeout: 0
        });
      }
    }
  }

  /**
   * Internal: Fires "projectDetailsReady" when BOTH UI and data are ready.
   */
  _maybeEmitReady() {
    if (
      this.state.initialized &&
      this._uiReadyFlag &&
      this._dataReadyFlag &&
      this.state.currentProject &&
      this.state.currentProject.id
    ) {
      if (this._lastReadyEmittedId === this.state.currentProject.id) return;
      this._lastReadyEmittedId = this.state.currentProject.id;

      this.domAPI.dispatchEvent(
        new CustomEvent("projectDetailsReady", {
          detail: {
            project: this.state.currentProject,
            container: this.elements.container
          }
        })
      );
      this.notify.info(`[ProjectDetailsComponent] Dispatched projectDetailsReady for ${this.state.currentProject.id}`, {
        group: true,
        context: "projectDetailsComponent"
      });
    }
  }

  /* ========== RENDERERS ==================================================== */

  renderFiles(files = []) {
    const c = this.elements.filesList;
    if (!c) {
      this.notify.warn("[ProjectDetailsComponent] filesList node missing.", {
        group: true,
        context: "projectDetailsComponent"
      });
      this.domAPI.dispatchEvent(
        new CustomEvent("projectFilesRendered", {
          detail: { projectId: this.state.currentProject?.id }
        })
      );
      return;
    }

    if (!files.length) {
      this._html(
        c,
        `<div class="text-center py-8 text-base-content/60">
           <p>No files uploaded yet.</p>
           <p class="text-sm mt-1">Drag & drop or click Upload.</p>
         </div>`
      );
      return;
    }

    this._clear(c);
    files.forEach(f => c.appendChild(this._fileItem(f)));
  }

  renderConversations(convs = []) {
    const c = this.elements.conversationsList;
    if (!c) {
      this.notify.warn("[ProjectDetailsComponent] conversationsList missing.", {
        group: true,
        context: "projectDetailsComponent"
      });
      this.domAPI.dispatchEvent(
        new CustomEvent("projectConversationsRendered", {
          detail: { projectId: this.state.currentProject?.id }
        })
      );
      return;
    }

    if (!convs.length) {
      this._html(
        c,
        `<div class="text-center py-8">
           <p>No conversations yet. Click “New Chat”.</p>
         </div>`
      );
      return;
    }

    this._clear(c);
    convs.forEach(cv => c.appendChild(this._conversationItem(cv)));
  }

  renderArtifacts(arts = []) {
    const c = this.elements.artifactsList;
    if (!c) {
      this.notify.warn("[ProjectDetailsComponent] artifactsList missing.", {
        group: true,
        context: "projectDetailsComponent"
      });
      this.domAPI.dispatchEvent(
        new CustomEvent("projectArtifactsRendered", {
          detail: { projectId: this.state.currentProject?.id }
        })
      );
      return;
    }

    if (!arts.length) {
      this._html(c, `<div class="py-8 text-center">No artifacts yet.</div>`);
      return;
    }
    this._clear(c);
    arts.forEach(a => c.appendChild(this._artifactItem(a)));
  }

  renderStats(s = {}) {
    const fileCount = this.elements.container.querySelector('[data-stat="fileCount"]');
    const convoCount = this.elements.container.querySelector('[data-stat="conversationCount"]');
    if (fileCount && s.fileCount !== undefined) fileCount.textContent = s.fileCount;
    if (convoCount && s.conversationCount !== undefined) convoCount.textContent = s.conversationCount;

    // CHANGED
    this.notify.info("[ProjectDetailsComponent] stats updated", {
      group: true,
      context: "projectDetailsComponent"
    });
  }

  /* ========== NEW CONVERSATION ============================================ */

  async createNewConversation() {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid)) {
      this.notify.warning("Invalid project.", {
        group: true,
        context: "projectDetailsComponent"
      });
      return;
    }
    if (this.projectManager.projectLoadingInProgress) {
      this.notify.info("Please wait, project still loading…", {
        group: true,
        context: "projectDetailsComponent"
      });
      return;
    }

    try {
      this.notify.info(`[ProjectDetailsComponent] create conversation @${pid}`, {
        group: true,
        context: "projectDetailsComponent"
      });
      const conv = await this.projectManager.createConversation(pid);
      if (conv?.id) {
        this.notify.success(`Conversation “${conv.title || "Untitled"}” created.`, {
          group: true,
          context: "projectDetailsComponent"
        });
        this._openConversation(conv);
      } else {
        throw new Error("Invalid response from createConversation");
      }
    } catch (err) {
      this.notify.error("[ProjectDetailsComponent] createConversation failed: " + (err?.message || err), {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.notify.error(`Failed: ${err.message}`, {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
    }
  }

  /* ========== CLEANUP ====================================================== */

  destroy() {
    this.notify.info("[ProjectDetailsComponent] destroy()", {
      group: true,
      context: "projectDetailsComponent"
    });
    this.eventHandlers.cleanupListeners(this.elements.container);
    this.eventHandlers.cleanupListeners(this.domAPI.getDocument());
    this.state.initialized = false;
  }

  /* ========== TAB CONTENT LOADER ========================================== */

  _loadTabContent(tab) {
    const pid = this.state.currentProject?.id;

    const load = (section, fn) => this._withLoading(section, () => fn(pid));

    switch (tab) {
      case "files":
        load("files", this.projectManager.loadProjectFiles);
        break;
      case "conversations":
        load("conversations", this.projectManager.loadProjectConversations);
        break;
      case "artifacts":
        load("artifacts", this.projectManager.loadProjectArtifacts);
        break;
      case "details":
        load("stats", this.projectManager.loadProjectStats);
        break;
      case "knowledge":
        if (this.knowledgeBaseComponent) {
          const kb = this.state.currentProject?.knowledge_base;
          Promise.resolve().then(() => this.knowledgeBaseComponent.initialize(true, kb, pid))
            .catch(e => this.notify.error("[ProjectDetailsComponent] KB init failed: " + (e?.message || e), {
              group: true,
              context: "projectDetailsComponent",
              timeout: 0
            }));
        }
        break;
    }

    /* lazy render modelConfig on conversations tab */
    if (tab === "conversations" && this.modelConfig?.renderQuickConfig) {
      const panel = this.elements.container.querySelector("#modelConfigPanel");
      if (panel) {
        Promise.resolve().then(() => {
          try {
            this.modelConfig.renderQuickConfig(panel);
          } catch (e) {
            this.notify.error("[ProjectDetailsComponent] modelConfig render failed: " + (e?.message || e), {
              group: true,
              context: "projectDetailsComponent",
              timeout: 0
            });
          }
          this.domAPI.dispatchEvent(
            new CustomEvent("modelConfigRendered", {
              detail: { projectId: pid }
            })
          );
        });
      }
    }
  }

  /* show / hide indicator while loading */
  async _withLoading(section, asyncFn) {
    if (this.state.isLoading[section]) return;
    this.state.isLoading[section] = true;
    this._toggleIndicator(section, true);
    try {
      await asyncFn();
    } catch (err) {
      // CHANGED: unify error handling
      this.notify.error(`[ProjectDetailsComponent] load ${section} failed: ${err?.message || err}`, {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.notify.error(`Failed to load ${section}.`, {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
    } finally {
      this.state.isLoading[section] = false;
      this._toggleIndicator(section, false);
    }
  }

  _toggleIndicator(sec, show) {
    this.elements.loadingIndicators[sec]?.classList.toggle("hidden", !show);
  }

  /* ========== ITEM BUILDERS =============================================== */

  _fileItem(file) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-box shadow-xs hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.fileId = file.id;

    const fmtB = this.app.formatBytes || (b => `${b} B`);
    const fmtD = this.app.formatDate || (d => new Date(d).toLocaleDateString());
    const icon = this.app.getFileTypeIcon?.(file.file_type) || "📄";

    this._html(div, `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <span class="text-xl text-primary">${icon}</span>
        <div class="flex flex-col min-w-0 flex-1">
          <div class="font-medium truncate" title="${file.filename}">${file.filename}</div>
          <div class="text-xs text-base-content/70">
            ${fmtB(file.file_size)} · ${fmtD(file.created_at)}
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
      downloadBtn,
      "click",
      () => this._downloadFile(file.id, file.filename),
      { description: `DownloadFile_${file.id}` }
    );
    this.eventHandlers.trackListener(
      deleteBtn,
      "click",
      () => this._confirmDeleteFile(file.id, file.filename),
      { description: `DeleteFile_${file.id}` }
    );
    return div;
  }

  _conversationItem(cv) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.conversationId = cv.id;

    const fmt = this.app.formatDate || (d => new Date(d).toLocaleDateString());

    this._html(div, `
      <h4 class="font-medium truncate mb-1">${cv.title || "Untitled conversation"}</h4>
      <p class="text-sm text-base-content/70 truncate">${cv.last_message || "No messages yet"}</p>
      <div class="flex justify-between mt-1 text-xs text-base-content/60">
        <span>${fmt(cv.updated_at)}</span>
        <span class="badge badge-ghost badge-sm">${cv.message_count || 0} msgs</span>
      </div>
    `);

    this.eventHandlers.trackListener(
      div,
      "click",
      () => this._openConversation(cv),
      { description: `OpenConversation_${cv.id}` }
    );
    return div;
  }

  _artifactItem(art) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "p-3 border-b border-base-300 hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.artifactId = art.id;

    const fmt = this.app.formatDate || (d => new Date(d).toLocaleDateString());

    this._html(div, `
      <div class="flex justify-between items-center">
        <h4 class="font-medium truncate">${art.name || "Untitled artifact"}</h4>
        <span class="text-xs text-base-content/60">${fmt(art.created_at)}</span>
      </div>
      <p class="text-sm text-base-content/70 truncate mt-1">${art.description || art.type || "No description"}</p>
      <div class="mt-2">
        <button class="btn btn-xs btn-outline" data-action="download">Download</button>
      </div>
    `);

    const btn = div.querySelector("[data-action=download]");
    this.eventHandlers.trackListener(btn, "click", () => {
      if (this.projectManager.downloadArtifact) {
        this.projectManager.downloadArtifact(this.state.currentProject.id, art.id)
          .catch(e => {
            this.notify.error("[ProjectDetailsComponent] artifact download failed: " + (e?.message || e), {
              group: true,
              context: "projectDetailsComponent",
              timeout: 0
            });
            this.notify.error(`Download failed: ${e.message}`, {
              group: true,
              context: "projectDetailsComponent",
              timeout: 0
            });
          });
      } else {
        this.notify.error("[ProjectDetailsComponent] downloadArtifact not available.", {
          group: true,
          context: "projectDetailsComponent",
          timeout: 0
        });
      }
    }, { description: `DownloadArtifact_${art.id}` });
    return div;
  }

  /* ========== FILE ACTIONS ================================================ */

  _confirmDeleteFile(fileId, fileName) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
      this.notify.error("[ProjectDetailsComponent] deleteFile invalid ids", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return;
    }
    this.modalManager.confirmAction({
      title: "Delete file",
      message: `Delete “${fileName || fileId}” permanently?`,
      confirmText: "Delete",
      confirmClass: "btn-error",
      onConfirm: async () => {
        try {
          await this.projectManager.deleteFile(pid, fileId);
          this.notify.success("File deleted.", {
            group: true,
            context: "projectDetailsComponent"
          });
          this.projectManager.loadProjectFiles(pid);
        } catch (e) {
          this.notify.error("[ProjectDetailsComponent] deleteFile failed: " + (e?.message || e), {
            group: true,
            context: "projectDetailsComponent",
            timeout: 0
          });
          this.notify.error(`Delete failed: ${e.message}`, {
            group: true,
            context: "projectDetailsComponent",
            timeout: 0
          });
        }
      }
    });
  }

  _downloadFile(fileId, fileName) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
      this.notify.error("[ProjectDetailsComponent] downloadFile invalid ids", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return;
    }
    if (!this.projectManager.downloadFile) {
      this.notify.error("[ProjectDetailsComponent] downloadFile not implemented.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return;
    }
    this.projectManager.downloadFile(pid, fileId)
      .catch(e => {
        this.notify.error("[ProjectDetailsComponent] downloadFile failed: " + (e?.message || e), {
          group: true,
          context: "projectDetailsComponent",
          timeout: 0
        });
        this.notify.error(`Download failed: ${e.message}`, {
          group: true,
          context: "projectDetailsComponent",
          timeout: 0
        });
      });
  }

  /* ========== CONVERSATION NAV ============================================ */

  async _openConversation(cv) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !cv?.id) {
      this.notify.error("[ProjectDetailsComponent] openConversation invalid ids", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.notify.error("Invalid conversation.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      return;
    }

    try {
      const conversation = await this.projectManager.getConversation(cv.id);
      const url = new URL(this.router.getURL());
      url.searchParams.set("chatId", cv.id);
      this.router.navigate(url.toString());
      this.notify.info(`[ProjectDetailsComponent] conversation ${cv.id} opened`, {
        group: true,
        context: "projectDetailsComponent"
      });
    } catch (error) {
      this.notify.error("[ProjectDetailsComponent] Failed to fetch conversation: " + (error?.message || error), {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
      this.notify.error("Failed to load conversation details.", {
        group: true,
        context: "projectDetailsComponent",
        timeout: 0
      });
    }
  }
}

/* factory helper for consistent usage across codebase */
export const createProjectDetailsComponent = (opts) => new ProjectDetailsComponent(opts);
