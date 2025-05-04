/**
 * projectDetailsComponent.js                     — DI-strict, no window.*, no console.*
 *
 * Component for displaying project details, files, conversations, artifacts and
 * knowledge-base data. -- EVERY dependency is passed in, nothing global.
 *
 * Required constructor deps  ( = must supply )
 * ----------------------------------------------------------
 *   app                    : core app module (utils, validators, showNotification)
 *   projectManager         : backend operations + event emitters
 *   eventHandlers          : centralised listener registry   (trackListener / delegate / cleanupListeners)
 *   modalManager           : confirmations / modals
 *   FileUploadComponentClass : class/factory for upload UI
 *   router                 : { getURL():string, navigate(url:string):void }
 *   notify                 : DI notification util: success/warn/error/info/confirm
 *   sanitizer              : { sanitize(html):string }      ( for ALL innerHTML )
 *
 * Optional constructor deps
 * ----------------------------------------------------------
 *   knowledgeBaseComponent : KB UI module
 *   modelConfig            : chat-model quick-config panel
 *   onBack                 : callback for back button
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
    notify,
    sanitizer,
    knowledgeBaseComponent = null,
    modelConfig = null
  } = {}) {
    /* ------------------------------------------------------  dependency gate */
    if (
      !app || !projectManager || !eventHandlers ||
      !modalManager || !FileUploadComponentClass ||
      !router || !notify || !sanitizer
    ) {
      throw new Error(
        "[ProjectDetailsComponent] Missing required dependencies " +
        "(app, projectManager, eventHandlers, modalManager, FileUploadComponentClass, " +
        "router, notify, sanitizer)."
      );
    }

    /* ------------------------------------------------------  store deps      */
    this.app = app;
    this.projectManager = projectManager;
    this.eventHandlers = eventHandlers;
    this.modalManager = modalManager;
    this.FileUploadComponentClass = FileUploadComponentClass;
    this.router = router;
    this._rawNotify = notify; // save the root adapter
    this.notification = {
      log: (...args) => notify.info?.(`[ProjectDetailsComponent] ${args[0]}`, { context: "ProjectDetailsComponent" }),
      warn: (...args) => notify.warn?.(`[ProjectDetailsComponent] ${args[0]}`, { context: "ProjectDetailsComponent" }),
      error: (...args) => notify.error?.(`[ProjectDetailsComponent] ${args[0]}`, { context: "ProjectDetailsComponent" }),
      confirm: (...args) => notify.confirm?.(...args)
    };
    this.sanitizer = sanitizer;
    this.knowledgeBaseComponent = knowledgeBaseComponent;
    this.modelConfig = modelConfig;

    /* ------------------------------------------------------  callbacks      */
    this.onBack = onBack || (() => {
      this.notification.warn("[ProjectDetailsComponent] onBack callback not provided.", { context: "ProjectDetailsComponent" });
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
    // Note: Debug logging removed to adhere to no-console rule. Use notificationHandler if needed.
    if (this.state.initialized) {
      this.notification.log("[ProjectDetailsComponent] Already initialized.", { context: "ProjectDetailsComponent" });
      return true;
    }

    try {
      if (!this._findElements()) {
        throw new Error("Required DOM nodes missing in #projectDetailsView.");
      }
      this._bindCoreEvents();
      this._initSubComponents();
      this.state.initialized = true;
      this.notification.log("[ProjectDetailsComponent] Initialised.");

      // Internal ready flag (do NOT emit ready yet: only set UI half of readiness)
      this._uiReadyFlag = true;
      this._maybeEmitReady();

      return true;
    } catch (err) {
      this.notification.error("[ProjectDetailsComponent] Init failed:", err, { context: "ProjectDetailsComponent" });
      this.notification.error("Project Details failed to initialise.");
      return false;
    }
  }

  /* ========== DOM HELPER UTILS ============================================== */

  /** always sanitise anything shoved into innerHTML */
  _html(el, raw) {
    el.innerHTML = this.sanitizer.sanitize(raw);
  }

  _clear(el) {
    el.innerHTML = "";
  }

  /* ========== DOM QUERY ===================================================== */

  _findElements() {
    const $ = (sel) => this.elements.container.querySelector(sel);

    this.elements.container = document.getElementById("projectDetailsView");
    if (!this.elements.container) {
      this.notification.error("[ProjectDetailsComponent] #projectDetailsView not found", { context: "ProjectDetailsComponent" });
      return false;
    }

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
      artifacts: $("#artifactsLoadingIndicator"),
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

    /* "New chat" button (starts disabled until load-complete) */
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

    /* ------------- project-manager → UI events -------------- */
    const on = (evt, cb, desc) =>
      this.eventHandlers.trackListener(document, evt, cb, { description: desc });

    on(
      "projectConversationsLoaded",
      (e) => {
        this.renderConversations(e.detail?.conversations || []);
        document.dispatchEvent(
          new CustomEvent("projectConversationsRendered", { detail: { projectId: e.detail?.projectId } })
        );
      },
      "PD_ConversationsLoaded"
    );

    on(
      "projectFilesLoaded",
      (e) => {
        this.renderFiles(e.detail?.files || []);
        document.dispatchEvent(
          new CustomEvent("projectFilesRendered", { detail: { projectId: e.detail?.projectId } })
        );
      },
      "PD_FilesLoaded"
    );

    on(
      "projectArtifactsLoaded",
      (e) => {
        this.renderArtifacts(e.detail?.artifacts || []);
        document.dispatchEvent(
          new CustomEvent("projectArtifactsRendered", { detail: { projectId: e.detail?.projectId } })
        );
      },
      "PD_ArtifactsLoaded"
    );

    on(
      "projectStatsLoaded",
      (e) => {
        this.renderStats(e.detail);
        document.dispatchEvent(
          new CustomEvent("projectStatsRendered", { detail: { projectId: e.detail?.projectId } })
        );
      },
      "PD_StatsLoaded"
    );

    on(
      "projectKnowledgeBaseLoaded",
      (e) => {
        this.knowledgeBaseComponent?.renderKnowledgeBaseInfo?.(
          e.detail?.knowledgeBase,
          e.detail?.projectId
        );
        document.dispatchEvent(
          new CustomEvent("projectKnowledgeBaseRendered", { detail: { projectId: e.detail?.projectId } })
        );
      },
      "PD_KnowledgeLoaded"
    );

    on(
      "projectDetailsFullyLoaded",
      (e) => {
        this.notification.log(`[ProjectDetailsComponent] Project ${e.detail?.projectId} fully loaded.`);
        const newChat = this.elements.container.querySelector("#projectNewConversationBtn");
        if (newChat) {
          newChat.disabled = false;
          newChat.classList.remove("btn-disabled");
        }
      },
      "PD_FullyLoaded"
    );
  }

  /* ========== SUB-COMPONENTS ============================================== */

  _initSubComponents() {
    if (!this.fileUploadComponent && this.FileUploadComponentClass) {
      const els = this.elements;
      const ready =
        els.fileInput && els.uploadBtn && els.dragZone &&
        els.uploadProgress && els.progressBar && els.uploadStatus;

      if (!ready) {
        this.notification.warn("[ProjectDetailsComponent] FileUploadComponent DOM nodes missing.", { context: "ProjectDetailsComponent" });
        return;
      }

      const fileUploadNotify = {
        log: (...args) => this._rawNotify.info?.(`[FileUploadComponent] ${args[0]}`),
        warn: (...args) => this._rawNotify.warn?.(`[FileUploadComponent] ${args[0]}`),
        error: (...args) => this._rawNotify.error?.(`[FileUploadComponent] ${args[0]}`),
        confirm: (...args) => this._rawNotify.confirm?.(...args),
        success: (...args) => this._rawNotify.success?.(`[FileUploadComponent] ${args[0]}`)
      };
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
        notify: fileUploadNotify,
        onUploadComplete: () => {
          const id = this.state.currentProject?.id;
          if (id) this.projectManager.loadProjectFiles(id);
        }
      });

      this.fileUploadComponent.initialize?.();
      this.notification.log("[ProjectDetailsComponent] FileUploadComponent ready.", { context: "ProjectDetailsComponent" });
    }
  }

  /* ========== PUBLIC API =================================================== */

  show() {
    if (!this.state.initialized || !this.elements.container) {
      this.notification.error("[ProjectDetailsComponent] show() before init.", { context: "ProjectDetailsComponent" });
      return;
    }
    this.elements.container.classList.remove("hidden");
    this.elements.container.setAttribute("aria-hidden", "false");
      this.notification.log("[ProjectDetailsComponent] Shown.", { context: "ProjectDetailsComponent" });
  }

  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add("hidden");
      this.elements.container.setAttribute("aria-hidden", "true");
      this.notification.log("[ProjectDetailsComponent] Hidden.", { context: "ProjectDetailsComponent" });
    }
  }

  /** render top header + reset tab */
  renderProject(project) {
    if (!this.state.initialized) {
      this.notification.error("[ProjectDetailsComponent] renderProject before init.", { context: "ProjectDetailsComponent" });
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) {
      this.notification.error("[ProjectDetailsComponent] Invalid project payload.", { context: "ProjectDetailsComponent" });
      this.app.showNotification("Failed to load project details.", "error");
      this.onBack();
      return;
    }

      this.notification.log(`[ProjectDetailsComponent] Render project ${project.id}`, { context: "ProjectDetailsComponent" });
    this.state.currentProject = project;

    // Set/refresh which project id is ready for the event.
    this._dataReadyProjectId = project.id;
    this._dataReadyFlag = true;
    this._maybeEmitReady();

    /* update upload component */
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
      this.notification.warn("[ProjectDetailsComponent] switchTab before init.", { context: "ProjectDetailsComponent" });
      return;
    }

    const TABS = ["details", "files", "knowledge", "conversations", "artifacts"];
    if (!TABS.includes(tabName)) {
      this.notification.warn(`[ProjectDetailsComponent] invalid tab "${tabName}".`, { context: "ProjectDetailsComponent" });
      return;
    }

    /* project check for data tabs */
    const pid = this.state.currentProject?.id;
    const needsProject = ["files", "knowledge", "conversations", "artifacts", "chat"].includes(tabName);

    if (needsProject && !this.app.validateUUID(pid)) {
      this.notification.error(`[ProjectDetailsComponent] tab "${tabName}" needs valid project.`, { context: "ProjectDetailsComponent" });
      this.app.showNotification("Load a project first.", "warning");
      return;
    }

      this.notification.log(`[ProjectDetailsComponent] tab => ${tabName}`, { context: "ProjectDetailsComponent" });
    this.state.activeTab = tabName;

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

    // ----- ChatManager initialization for conversations tab -----
    if (tabName === "conversations") {
      const chatManager = window.DependencySystem?.modules?.get('chatManager');
      if (chatManager && typeof chatManager.initialize === "function") {
        chatManager.initialize({
          projectId: this.state.currentProject?.id,
          containerSelector: "#projectChatUI",
          messageContainerSelector: "#projectChatMessages",
          inputSelector: "#projectChatInput",
          sendButtonSelector: "#projectChatSendBtn"
        }).catch((err) => {
          this.notification.error("[ProjectDetailsComponent] Failed to initialize chatManager for conversations tab:", err, { context: "ProjectDetailsComponent" });
        });
      } else {
        this.notification.error("[ProjectDetailsComponent] chatManager DI missing or invalid during conversations tab init.", { context: "ProjectDetailsComponent" });
      }
    }
  }

  /**
   * Internal: Fires "projectDetailsReady" when BOTH UI and data are ready.
   * Ensures only fires once per project being shown.
   */
  _maybeEmitReady() {
    if (
      this.state.initialized &&
      this._uiReadyFlag &&
      this._dataReadyFlag &&
      this.state.currentProject &&
      this.state.currentProject.id
    ) {
      // Prevent duplicate for same project
      if (this._lastReadyEmittedId === this.state.currentProject.id) return;
      this._lastReadyEmittedId = this.state.currentProject.id;
      const event = new CustomEvent("projectDetailsReady", {
        detail: {
          project: this.state.currentProject,
          container: this.elements.container
        }
      });
      document.dispatchEvent(event);
      this.notification.log(`[ProjectDetailsComponent] Dispatched projectDetailsReady for ${this.state.currentProject.id}`, { context: "ProjectDetailsComponent" });
    }
  }

  /* ========== RENDERERS ==================================================== */

  renderFiles(files = []) {
    const c = this.elements.filesList;
    if (!c) {
      this.notification.warn("[ProjectDetailsComponent] filesList node missing.", { context: "ProjectDetailsComponent" });
      document.dispatchEvent(new CustomEvent("projectFilesRendered", { detail: { projectId: this.state.currentProject?.id } }));
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
      this.notification.warn("[ProjectDetailsComponent] conversationsList missing.", { context: "ProjectDetailsComponent" });
      document.dispatchEvent(new CustomEvent("projectConversationsRendered", { detail: { projectId: this.state.currentProject?.id } }));
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
      this.notification.warn("[ProjectDetailsComponent] artifactsList missing.", { context: "ProjectDetailsComponent" });
      document.dispatchEvent(new CustomEvent("projectArtifactsRendered", { detail: { projectId: this.state.currentProject?.id } }));
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
    this.notification.log("[ProjectDetailsComponent] stats updated", s, { context: "ProjectDetailsComponent" });
  }

  /* ========== NEW CONVERSATION ============================================ */

  async createNewConversation() {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid)) {
      this.app.showNotification("Invalid project.", "warning");
      return;
    }
    if (this.projectManager.projectLoadingInProgress) {
      this.app.showNotification("Please wait, project still loading…", "info");
      return;
    }

    try {
      this.notification.log(`[ProjectDetailsComponent] create conversation @${pid}`, { context: "ProjectDetailsComponent" });
      const conv = await this.projectManager.createConversation(pid);
      if (conv?.id) {
        this.app.showNotification(`Conversation “${conv.title || "Untitled"}” created.`, "success");
        // Navigate to the new conversation instead of just refreshing the list
        this._openConversation(conv);
        // Optionally reload the list in the background if needed, but prioritize navigation
        // this.projectManager.loadProjectConversations(pid);
      } else {
        throw new Error("Invalid response from createConversation");
      }
    } catch (err) {
      this.notification.error("[ProjectDetailsComponent] createConversation failed:", err, { context: "ProjectDetailsComponent" });
      this.app.showNotification(`Failed: ${err.message}`, "error");
    }
  }

  /* ========== CLEANUP ====================================================== */

  destroy() {
    this.notification.log("[ProjectDetailsComponent] destroy()", { context: "ProjectDetailsComponent" });
    this.eventHandlers.cleanupListeners(this.elements.container);
    this.eventHandlers.cleanupListeners(document);
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
            .catch(e => this.notification.error("[ProjectDetailsComponent] KB init failed:", e));
        }
        break;
    }

    /* lazy render modelConfig on conversations tab */
    if (tab === "conversations" && this.modelConfig?.renderQuickConfig) {
      const panel = document.getElementById("modelConfigPanel");
      if (panel) {
        Promise.resolve().then(() => {
          try {
            this.modelConfig.renderQuickConfig(panel);
          } catch (e) {
            this.notification.error("[ProjectDetailsComponent] modelConfig render failed:", e);
          }
          document.dispatchEvent(new CustomEvent("modelConfigRendered", { detail: { projectId: pid } }));
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
      this.notification.error(`[ProjectDetailsComponent] load ${section} failed:`, err, { context: "ProjectDetailsComponent" });
      this.app.showNotification(`Failed to load ${section}.`, "error");
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
    const div = document.createElement("div");
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

    /* buttons */
    const [downloadBtn, deleteBtn] = div.querySelectorAll("button");
    this.eventHandlers.trackListener(downloadBtn, "click", () => this._downloadFile(file.id, file.filename),
      { description: `DownloadFile_${file.id}` });
    this.eventHandlers.trackListener(deleteBtn, "click", () => this._confirmDeleteFile(file.id, file.filename),
      { description: `DeleteFile_${file.id}` });
    return div;
  }

  _conversationItem(cv) {
    const div = document.createElement("div");
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

    this.eventHandlers.trackListener(div, "click", () => this._openConversation(cv),
      { description: `OpenConversation_${cv.id}` });
    return div;
  }

  _artifactItem(art) {
    const div = document.createElement("div");
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
      if (this.projectManager.downloadArtifact)
        this.projectManager.downloadArtifact(this.state.currentProject.id, art.id)
          .catch(e => {
            this.notification.error("[ProjectDetailsComponent] artifact download failed:", e);
            this.app.showNotification(`Download failed: ${e.message}`, "error");
          });
      else
        this.notification.error("[ProjectDetailsComponent] downloadArtifact not available.", { context: "ProjectDetailsComponent" });
    }, { description: `DownloadArtifact_${art.id}` });
    return div;
  }

  /* ========== FILE ACTIONS ================================================ */

  _confirmDeleteFile(fileId, fileName) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
      this.notification.error("[ProjectDetailsComponent] deleteFile invalid ids", { pid, fileId, context: "ProjectDetailsComponent" });
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
          this.app.showNotification("File deleted.", "success");
          this.projectManager.loadProjectFiles(pid);
        } catch (e) {
          this.notification.error("[ProjectDetailsComponent] deleteFile failed:", e, { context: "ProjectDetailsComponent" });
          this.app.showNotification(`Delete failed: ${e.message}`, "error");
        }
      }
    });
  }

  _downloadFile(fileId, fileName) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
      this.notification.error("[ProjectDetailsComponent] downloadFile invalid ids", { pid, fileId, context: "ProjectDetailsComponent" });
      return;
    }
    if (!this.projectManager.downloadFile) {
      this.notification.error("[ProjectDetailsComponent] downloadFile not implemented.", { context: "ProjectDetailsComponent" });
      return;
    }
    this.projectManager.downloadFile(pid, fileId)
      .catch(e => {
        this.notification.error("[ProjectDetailsComponent] downloadFile failed:", e, { context: "ProjectDetailsComponent" });
        this.app.showNotification(`Download failed: ${e.message}`, "error");
      });
  }

  /* ========== CONVERSATION NAV ============================================ */

  async _openConversation(cv) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !cv?.id) {
      this.notification.error("[ProjectDetailsComponent] openConversation invalid ids", { pid, cv, context: "ProjectDetailsComponent" });
      this.app.showNotification("Invalid conversation.", "error");
      return;
    }

    try {
      // Fetch conversation details from backend to ensure validity
      const conversation = await this.projectManager.getConversation(cv.id);

      // Add chatId param via router
      const url = new URL(this.router.getURL());
      url.searchParams.set("chatId", cv.id);
      this.router.navigate(url.toString());

      this.notification.log(`[ProjectDetailsComponent] conversation ${cv.id} opened`, conversation, { context: "ProjectDetailsComponent" });
    } catch (error) {
      this.notification.error("[ProjectDetailsComponent] Failed to fetch conversation:", error, { context: "ProjectDetailsComponent" });
      this.app.showNotification("Failed to load conversation details.", "error");
    }
  }
}

/* factory helper ⇒ keeps import ergonomics identical to previous version */
export const createProjectDetailsComponent = (opts) => new ProjectDetailsComponent(opts);
