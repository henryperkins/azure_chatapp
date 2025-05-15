/**
 * ProjectDetailsComponent — controlador de la vista “Project Details”
 * (estricto en Inyección de Dependencias y con notificaciones con contexto).
 *
 * Dependencias REQUERIDAS (constructor options):
 *   • onBack                    : fn  – callback para volver (se crea stub si falta)
 *   • app                       : obj – métodos usados:
 *       validateUUID(id) [oblig.], formatBytes?, formatDate?, getFileTypeIcon?
 *   • projectManager            : obj – propiedades / métodos:
 *       projectLoadingInProgress,
 *       loadProjectFiles(id), loadProjectConversations(id),
 *       loadProjectArtifacts(id), loadProjectStats(id),
 *       createConversation(pid), getConversation(cid),
 *       deleteFile(pid,fid), downloadFile(pid,fid), downloadArtifact(pid,aid)
 *   • eventHandlers             : obj – trackListener, untrackListener, delegate, cleanupListeners; expone DependencySystem.
 *   • modalManager              : obj – confirmAction(opts)
 *   • FileUploadComponentClass  : class – debe implementar init()/initialize()
 *   • router                    : obj – getURL(), navigate(url)
 *   • sanitizer                 : obj – sanitize(html)
 *   • domAPI                    : obj – getElementById, querySelector/All, getDocument,
 *                                    dispatchEvent, ownerDocument, add/removeEventListener…
 *
 * Dependencias OPCIONALES:
 *   • browserService            : obj – almacenada, no usada actualmente
 *   • globalUtils               : obj – idem
 *   • knowledgeBaseComponent    : obj – initialize(force,kb,pid) & renderKnowledgeBaseInfo(kb,pid)
 *   • modelConfig               : obj – renderQuickConfig(container)
 *   • chatManager               : obj – initialize({ projectId, … })
 *
 * Import externo:
 *   • waitForDepsAndDom         de './utils/globalUtils.js'
 */

import { waitForDepsAndDom } from './utils/globalUtils.js';

const MODULE = "ProjectDetailsComponent";

// Dedicated intra-module event bus
const ProjectDetailsBus = new EventTarget();

function createProjectDetailsComponent({
  onBack,
  app,
  projectManager,
  eventHandlers,
  modalManager,
  FileUploadComponentClass,
  router,
  sanitizer,
  domAPI,
  globalUtils,
  knowledgeBaseComponent = null,
  modelConfig = null,
  chatManager = null
} = {}) {
  if (
    !app ||
    !projectManager ||
    !eventHandlers ||
    !modalManager ||
    !FileUploadComponentClass ||
    !router ||
    !sanitizer ||
    !domAPI
  ) {
    throw new Error(
      "[ProjectDetailsComponent] Missing required dependencies " +
      "(app, projectManager, eventHandlers, modalManager, FileUploadComponentClass, " +
      "router, sanitizer, domAPI)."
    );
  }

  // Factory validation done. Construct and return instance.
  return new ProjectDetailsComponent({
    onBack,
    app,
    projectManager,
    eventHandlers,
    modalManager,
    FileUploadComponentClass,
    router,
    sanitizer,
    domAPI,
    globalUtils,
    knowledgeBaseComponent,
    modelConfig,
    chatManager
  });
}

class ProjectDetailsComponent {
  constructor({
    onBack,
    app,
    projectManager,
    eventHandlers,
    modalManager,
    FileUploadComponentClass,
    router,
    sanitizer,
    domAPI,
    globalUtils,
    knowledgeBaseComponent = null,
    modelConfig = null,
    chatManager = null
  } = {}) {
    this.app = app;
    this.projectManager = projectManager;
    this.eventHandlers = eventHandlers;
    this.modalManager = modalManager;
    this.FileUploadComponentClass = FileUploadComponentClass;
    this.router = router;
    this.bus = ProjectDetailsBus;

    this.sanitizer = sanitizer;
    this.domAPI = domAPI;
    this.globalUtils = globalUtils;
    this.knowledgeBaseComponent = knowledgeBaseComponent;
    this.modelConfig = modelConfig;
    this.chatManager = chatManager;
    this.DependencySystem = app?.DependencySystem || eventHandlers?.DependencySystem; // Get DependencySystem
    this.navigationService = this.DependencySystem?.modules?.get('navigationService');

    this.onBack = onBack || (() => {});

    this.state = {
      activeTab: "details",
      isLoading: Object.create(null),
      initialized: false,
      projectDataActuallyLoaded: false // New flag
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

    this._backBtnHandler = null;
    this._tabClickHandler = null;
  }
  _setState(patch = {}) {
    this.state = { ...this.state, ...patch };
  }

  async initialize() {
    // Wait for DOM to be ready before finding elements
    await waitForDepsAndDom({
      DependencySystem: this.eventHandlers?.DependencySystem ?? null,
      domAPI          : this.domAPI,
      domSelectors : ['#projectDetailsView'],
      timeout      : 5000
    });

    if (this.state.initialized) {
      return true;
    }
    if (!this._findElements()) {
      throw new Error("Required DOM nodes missing in #projectDetailsView for initialization.");
    }
    this._bindCoreEvents();
    await this._initSubComponents();

    this._setState({ initialized: true });

    // --- Standardized "projectdetailscomponent:initialized" event ---
    const doc = this.domAPI?.getDocument?.() || (typeof document !== "undefined" ? document : null);
    if (doc) {
      if (this.domAPI?.dispatchEvent) {
        this.domAPI.dispatchEvent(doc,
          new CustomEvent('projectdetailscomponent:initialized',
            { detail: { success: true } }));
      } else {
        doc.dispatchEvent(new CustomEvent('projectdetailscomponent:initialized',
          { detail: { success: true } }));
      }
    }

    this.bus.dispatchEvent(new CustomEvent('initialized', { detail: { success: true } }));

    this._uiReadyFlag = true;
    this._maybeEmitReady();

    return true;
  }

  _htmlSafe(el, raw) { el.innerHTML = this.sanitizer.sanitize(raw); }
  // Clearing innerHTML is safe and does not require sanitization.
  _clearSafe(el) { el.innerHTML = ""; }

  _findElements() {
    this.elements.container = this.domAPI.getElementById("projectDetailsView");
    if (!this.elements.container) {
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
      artifacts: $("#artifactsLoadingIndicator"),
      stats: $("#statsLoadingIndicator")
    };
    this.elements.fileInput = $("#fileInput");
    this.elements.uploadBtn = $("#uploadFileBtn");
    this.elements.dragZone = $("#dragDropZone");
    this.elements.uploadProgress = $("#filesUploadProgress");
    this.elements.progressBar = $("#fileProgressBar");
    this.elements.uploadStatus = $("#uploadStatus");

    // More comprehensive check for essential elements
    const essentialElementsFound =
      this.elements.title &&
      this.elements.description &&
      this.elements.backBtn &&
      this.elements.tabContainer &&
      this.elements.tabContents.details; // Crucially check the default tab content

    if (!essentialElementsFound) {
      return false;
    }
    return true;
  }

  _bindCoreEvents() {
    if (this.elements.backBtn) {
      if (this._backBtnHandler)
        this.eventHandlers.untrackListener(this.elements.backBtn, 'click', this._backBtnHandler);
      this._backBtnHandler = (e) => this.onBack(e);
      this.eventHandlers.trackListener(
        this.elements.backBtn,
        'click',
        this._backBtnHandler,
        { description: 'ProjectDetails_Back', context: MODULE }
      );
    }
    if (this.elements.tabContainer) {
      if (this._tabClickHandler)
        this.eventHandlers.untrackListener(this.elements.tabContainer, 'click', this._tabClickHandler); // untrackListener is specific, no context needed
      this._tabClickHandler = (_e, btn) => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      };
      this.eventHandlers.delegate(
        this.elements.tabContainer,
        'click',
        '.project-tab-btn',
        this._tabClickHandler,
        { description: 'ProjectDetails_TabSwitch', context: MODULE }
      );
    }
    const newChatBtn = this.elements.container.querySelector("#projectNewConversationBtn");
    if (newChatBtn) {
      newChatBtn.disabled = true;
      newChatBtn.classList.add("btn-disabled");
      this.eventHandlers.trackListener(
        newChatBtn,
        "click",
        () => this.createNewConversation(),
        { description: "ProjectDetails_NewConversation", context: MODULE }
      );
    }

    const doc = this.domAPI.getDocument();
    // Add context to listeners registered by the 'on' helper
    const on = (evt, cb, desc) =>
      this.eventHandlers.trackListener(doc, evt, cb, { description: desc, context: MODULE });

    on("projectConversationsLoaded", (e) => {
      this.renderConversations(e.detail?.conversations || []);
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent("projectConversationsRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_ConversationsLoaded");

    on("projectFilesLoaded", (e) => {
      this.renderFiles(e.detail?.files || []);
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent("projectFilesRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_FilesLoaded");

    on("projectArtifactsLoaded", (e) => {
      this.renderArtifacts(e.detail?.artifacts || []);
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent("projectArtifactsRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_ArtifactsLoaded");

    on("projectStatsLoaded", (e) => {
      this.renderStats(e.detail);
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
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
        this.domAPI.getDocument(),
        new CustomEvent("projectKnowledgeBaseRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_KnowledgeLoaded");

    on("projectDetailsFullyLoaded", (e) => {
      this._setState({ projectDataActuallyLoaded: true });
      this._updateNewChatButtonState();
    }, "PD_FullyLoaded");

    // Listen for global auth state changes to re-evaluate button state
    on("authStateChanged", (_authEvent) => {
        this._updateNewChatButtonState();
    }, "PD_GlobalAuthStateChanged");
  }

  async _initSubComponents() {
    if (!this.fileUploadComponent && this.FileUploadComponentClass) {
      const els = this.elements;
      const ready =
        els.fileInput && els.uploadBtn && els.dragZone &&
        els.uploadProgress && els.progressBar && els.uploadStatus;

      if (!ready) {
        return;
      }

      this.fileUploadComponent = new this.FileUploadComponentClass({
        app: this.app,
        eventHandlers: this.eventHandlers,
        projectManager: this.projectManager,
        domAPI: this.domAPI,
        onUploadComplete: () => {
          const currentProject = this.app.getCurrentProject();
          const id = currentProject?.id;
          if (id) this.projectManager.loadProjectFiles(id);
        },
        elements: {
          fileInput: els.fileInput,
          uploadBtn: els.uploadBtn,
          dragZone: els.dragZone,
          uploadProgress: els.uploadProgress,
          progressBar: els.progressBar,
          uploadStatus: els.uploadStatus
        }
      });

      // Asegura que el método se invoque con el contexto correcto (`this.fileUploadComponent`)
      const initFn = this.fileUploadComponent.init ?? this.fileUploadComponent.initialize;
      if (typeof initFn === "function") {
        await initFn.call(this.fileUploadComponent);
      }
    }
  }

  show() {
    if (!this.state.initialized || !this.elements.container) {
      return;
    }
    this.elements.container.classList.remove("hidden");
    this.elements.container.classList.remove("opacity-0"); // Ensure opacity is cleared
    this.elements.container.style.display = "";     // let _setView manage flex/layout
    this.elements.container.classList.add("flex-1", "flex-col"); // Match flex container behavior
    this.elements.container.setAttribute("aria-hidden", "false");

    // Ensure the default 'details' tab content is also explicitly shown
    if (this.elements.tabContents && this.elements.tabContents.details) {
      this.elements.tabContents.details.classList.remove("hidden");
      // Ensure all other tabs are hidden
      Object.entries(this.elements.tabContents).forEach(([key, el]) => {
        if (el && key !== 'details') {
          el.classList.add("hidden");
        }
      });
    }

  }

  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add("hidden");
      // this.elements.container.classList.add("opacity-0"); // Optionally add for fade effect
      this.elements.container.setAttribute("aria-hidden", "true");
    }
  }

  renderProject(project) {
    if (!this.state.initialized) {
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) {
      this.onBack();
      return;
    }

    this.app.setCurrentProject(project);
    // mark data ready → enable “New Chat” button
    this._setState({ projectDataActuallyLoaded: true });
    this._updateNewChatButtonState();
    this._dataReadyProjectId = project.id;
    this._dataReadyFlag = true;
    this._maybeEmitReady();
    this.fileUploadComponent?.setProjectId?.(project.id);
    this.elements.title.textContent = project.title || project.name || "Untitled project";
    this.elements.description.textContent = project.description || "";
    this.switchTab("details");
    this.show();
  }

  switchTab(tabName) {
    if (!this.state.initialized) {
      return;
    }

    const TABS = ["details", "files", "knowledge", "conversations", "artifacts", "chat"];
    if (!TABS.includes(tabName)) {
      return;
    }

    const currentProject = this.app.getCurrentProject();
    const pid = currentProject?.id;
    const needsProject = ["files", "knowledge", "conversations", "artifacts", "chat"].includes(tabName);

    if (needsProject && !this.app.validateUUID(pid)) {
      return;
    }

    this._setState({ activeTab: tabName });

    this.elements.tabContainer?.querySelectorAll(".project-tab-btn").forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("tab-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.entries(this.elements.tabContents).forEach(([key, el]) => {
      if (el) el.classList.toggle("hidden", key !== tabName);
    });

    this._loadTabContent(tabName);

    if ((tabName === "conversations" || tabName === "chat") && this.modelConfig?.renderQuickConfig) {
      const panel = this.elements.container.querySelector("#modelConfigPanel");
      if (panel) {
        Promise.resolve().then(() => {
          try {
            this.modelConfig.renderQuickConfig(panel);
          } catch (e) {
            // console.error('Error rendering model config:', e); // Removed
          }
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
            new CustomEvent("modelConfigRendered", {
              detail: { projectId: pid }
            })
          );
        });
      }
    }
    // Initialize chatManager only for the "chat" tab
    // The "chat" functionality is now integrated within the "conversations" tab's HTML structure.
    if (tabName === "chat" && this.chatManager?.initialize) {
      // Use the "conversations" tab content area as the host for the chat UI
      const conversationsTabContent = this.elements.tabContents.conversations;

      if (conversationsTabContent) {
        this.chatManager.initialize({
          projectId: pid,
          containerSelector: "#projectChatUI", // Existing ID in project_details.html within #conversationsTab
          messageContainerSelector: "#projectChatMessages", // Existing ID
          inputSelector: "#projectChatInput", // Existing ID
          sendButtonSelector: "#projectChatSendBtn", // Existing ID
          titleSelector: "#projectChatContainer h3", // Selector for the "Conversation" title if needed
          minimizeButtonSelector: "#projectMinimizeChatBtn" // Existing ID
        }).catch((_err) => {});
      }
    }
  }

  _maybeEmitReady() {
    const currentProject = this.app.getCurrentProject();
    if (
      this.state.initialized &&
      this._uiReadyFlag &&
      this._dataReadyFlag &&
      currentProject &&
      currentProject.id
    ) {
      if (this._lastReadyEmittedId === currentProject.id) return;
      this._lastReadyEmittedId = currentProject.id;

      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent("projectDetailsReady", {
          detail: {
            project: currentProject,
            container: this.elements.container
          }
        })
      );
      this.bus.dispatchEvent(new CustomEvent('ready', {
        detail: { project: currentProject, container: this.elements.container }
      }));
    }
  }

  renderFiles(files = []) {
    const c = this.elements.filesList;
    if (!c) {
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent("projectFilesRendered", {
          detail: { projectId: this.state.currentProject?.id }
        })
      );
      return;
    }
    if (!files.length) {
      this._htmlSafe(
        c,
        `<div class="text-center py-8 text-base-content/60">
           <p>No files uploaded yet.</p>
           <p class="text-sm mt-1">Drag & drop or click Upload.</p>
         </div>`
      );
      return;
    }
    this._clearSafe(c);
    files.forEach(f => c.appendChild(this._fileItem(f)));
  }

  renderConversations(convs = []) {
    const c = this.elements.conversationsList;
    if (!c) {
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent("projectConversationsRendered", {
          detail: { projectId: this.state.currentProject?.id }
        })
      );
      return;
    }
    if (!convs.length) {
      this._htmlSafe(
        c,
        `<div class="text-center py-8">
           <p>No conversations yet. Click “New Chat”.</p>
         </div>`
      );
      return;
    }
    this._clearSafe(c);
    convs.forEach(cv => c.appendChild(this._conversationItem(cv)));
  }

  renderArtifacts(arts = []) {
    const c = this.elements.artifactsList;
    if (!c) {
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent("projectArtifactsRendered", {
          detail: { projectId: this.state.currentProject?.id }
        })
      );
      return;
    }
    if (!arts.length) {
      this._htmlSafe(c, `<div class="py-8 text-center">No artifacts yet.</div>`);
      return;
    }
    this._clearSafe(c);
    arts.forEach(a => c.appendChild(this._artifactItem(a)));
  }

  renderStats(s = {}) {
    const fileCount = this.elements.container.querySelector('#fileCount'); // Corrected selector
    const convoCount = this.elements.container.querySelector('#conversationCount'); // Corrected selector
    if (fileCount && s.fileCount !== undefined) fileCount.textContent = s.fileCount;
    if (convoCount && s.conversationCount !== undefined) convoCount.textContent = s.conversationCount;
  }

  async createNewConversation() {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid)) {
      return;
    }
    if (this.projectManager.projectLoadingInProgress) {
      return;
    }

    // NEW: Use auth module directly via DependencySystem
    const auth = this.eventHandlers?.DependencySystem?.modules?.get('auth');
    const currentUser = auth?.getCurrentUserObject?.() ?? null; // NEW

    if (!currentUser || !currentUser.id) {
      return;
    }

    try {
      const conv = await this.projectManager.createConversation(pid);
      if (conv?.id) {
        this._openConversation(conv);
      }
    } catch (err) {
      // No notification or error reporting
    }

  }  // ← closes createNewConversation()

  _updateNewChatButtonState() {
    const newChatBtn = this.elements.container?.querySelector("#projectNewConversationBtn");
    if (!newChatBtn) return;

    const projectReady = this.state.projectDataActuallyLoaded;

    // NEW: Use auth module directly via DependencySystem
    const auth = this.eventHandlers?.DependencySystem?.modules?.get('auth');
    const userIsReady = !!auth?.isAuthenticated?.(); // NEW

    if (projectReady && userIsReady) {
      newChatBtn.disabled = false;
      newChatBtn.classList.remove("btn-disabled");
    } else {
      newChatBtn.disabled = true;
      newChatBtn.classList.add("btn-disabled");
    }
  }

  destroy() {
    // this.eventHandlers.cleanupListeners(this.elements.container); // Old way
    // this.eventHandlers.cleanupListeners(this.domAPI.getDocument()); // Old way
    // New way: cleanup all listeners registered with this component's context
    if (this.eventHandlers.DependencySystem && typeof this.eventHandlers.DependencySystem.cleanupModuleListeners === 'function') {
        this.eventHandlers.DependencySystem.cleanupModuleListeners(MODULE);
    } else if (typeof this.eventHandlers.cleanupListeners === 'function') {
        this.eventHandlers.cleanupListeners({ context: MODULE });
    }
    this._setState({ initialized: false });
  }

  _loadTabContent(tab) {
    const pid = this.state.currentProject?.id;
    // preserve ProjectManager context
    const load = (section, fn) => this._withLoading(section, () => fn.call(this.projectManager, pid));
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
            .catch(e => {
              // console.error('Error initializing knowledge base component:', e); // Removed
            });
        }
        break;
    }
  }

  async _withLoading(section, asyncFn) {
    if (this.state.isLoading[section]) return;
    this.state.isLoading[section] = true;
    this._toggleIndicator(section, true);
    try {
      await asyncFn();
    } catch (err) {
      // console.error(`Error in _withLoading for section ${section}:`, err); // Removed
    } finally {
      this.state.isLoading[section] = false;
      this._toggleIndicator(section, false);
    }
  }

  _toggleIndicator(sec, show) {
    this.elements.loadingIndicators[sec]?.classList.toggle("hidden", !show);
  }

  _fileItem(file) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "flex items-center justify-between gap-3 p-3 bg-base-100 rounded-box shadow-xs hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.fileId = file.id;

    const fmtB = this.app.formatBytes || (b => `${b} B`);
    const fmtD = this.app.formatDate || (d => new Date(d).toLocaleDateString());
    const icon = this.app.getFileTypeIcon?.(file.file_type) || "📄";

    this._htmlSafe(div, `
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
      { description: `DownloadFile_${file.id}`, context: MODULE }
    );
    this.eventHandlers.trackListener(
      deleteBtn,
      "click",
      () => this._confirmDeleteFile(file.id, file.filename),
      { description: `DeleteFile_${file.id}`, context: MODULE }
    );
    return div;
  }

  _conversationItem(cv) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "p-3 border-b border-base-300 hover:bg-base-200 cursor-pointer transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.conversationId = cv.id;

    const fmt = this.app.formatDate || (d => new Date(d).toLocaleDateString());

    this._htmlSafe(div, `
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
      { description: `OpenConversation_${cv.id}`, context: MODULE }
    );
    return div;
  }

  _artifactItem(art) {
    const doc = this.domAPI.getDocument();
    const div = doc.createElement("div");
    div.className = "p-3 border-b border-base-300 hover:bg-base-200 transition-colors max-w-full w-full overflow-x-auto";
    div.dataset.artifactId = art.id;

    const fmt = this.app.formatDate || (d => new Date(d).toLocaleDateString());

    this._htmlSafe(div, `
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
            // console.error('Error downloading artifact:', e); // Removed
          });
      }
    }, { description: `DownloadArtifact_${art.id}`, context: MODULE });
    return div;
  }

  _confirmDeleteFile(fileId, fileName) {
    const currentProject = this.app.getCurrentProject();
    const pid = currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
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
          this.projectManager.loadProjectFiles(pid);
        } catch (e) {
          // console.error('Error deleting file:', e); // Removed
        }
      }
    });
  }

  _downloadFile(fileId, fileName) {
    const currentProject = this.app.getCurrentProject();
    const pid = currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
      return;
    }
    if (!this.projectManager.downloadFile) {
      return;
    }
    this.projectManager.downloadFile(pid, fileId)
      .catch(e => {
        // console.error('Error downloading file:', e); // Removed
      });
  }

  async _openConversation(cv) {
    const currentProject = this.app.getCurrentProject();
    const pid = currentProject?.id;
    if (!this.app.validateUUID(pid) || !cv?.id) {
      return;
    }
    try {
      await this.projectManager.getConversation(cv.id);

      if (this.navigationService) {
        this.navigationService.navigateToConversation(pid, cv.id);
      } else {
        this.switchTab("chat");
        const url = new URL(this.router.getURL());
        url.searchParams.set("chatId", cv.id);
        this.router.navigate(url.toString());
      }
    } catch (error) {
      // console.error('Error opening conversation:', error); // Removed
    }
  }
}

export { createProjectDetailsComponent };
