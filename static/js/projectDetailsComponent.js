/**
 * projectDetailsComponent.js — DI-strict, troubleshooting-enhanced (context-rich notifications)
 *
 * Notifications always include: group, context, module ("ProjectDetailsComponent"), source (method), detail, and originalError if relevant.
 * All troubleshooting events are immediately tied to their action in logs/Sentry/support.
 */

import { waitForDepsAndDom } from './utils/globalUtils.js';

const MODULE = "ProjectDetailsComponent";

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
    domAPI,
    browserService,
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

    this.app = app;
    this.projectManager = projectManager;
    this.eventHandlers = eventHandlers;
    this.modalManager = modalManager;
    this.FileUploadComponentClass = FileUploadComponentClass;
    this.router = router;
    this.originalNotify = notify; // Preserve original notify API for subcomponents

    // Defensive handling for notify - ensure we have withContext or create a fallback
    if (notify && typeof notify.withContext === 'function') {
      this.notify = notify.withContext({ context: "projectDetailsComponent", module: MODULE });
    } else {
      // Fallback notify: only call injected notify methods with context, no direct console output.
      this.notify = {
        debug: (msg, opts = {}) => {
          if (notify && typeof notify.debug === 'function') {
            notify.debug(msg, { context: "projectDetailsComponent", module: MODULE, ...opts });
          }
        },
        info: (msg, opts = {}) => {
          if (notify && typeof notify.info === 'function') {
            notify.info(msg, { context: "projectDetailsComponent", module: MODULE, ...opts });
          }
        },
        warn: (msg, opts = {}) => {
          if (notify && typeof notify.warn === 'function') {
            notify.warn(msg, { context: "projectDetailsComponent", module: MODULE, ...opts });
          }
        },
        error: (msg, opts = {}) => {
          if (notify && typeof notify.error === 'function') {
            notify.error(msg, { context: "projectDetailsComponent", module: MODULE, ...opts });
          }
        },
        success: (msg, opts = {}) => {
          if (notify && typeof notify.success === 'function') {
            notify.success(msg, { context: "projectDetailsComponent", module: MODULE, ...opts });
          }
        },
        // eslint-disable-next-line no-unused-vars
        withContext: (_ctx) => this.notify // Self-returning stub to prevent cascading failures
      };
    }

    this.sanitizer = sanitizer;
    this.domAPI = domAPI;
    this.browserService = browserService;
    this.globalUtils = globalUtils;
    this.knowledgeBaseComponent = knowledgeBaseComponent;
    this.modelConfig = modelConfig;
    this.chatManager = chatManager;

    this.onBack = onBack || (() => {
      this.notify.warn("[ProjectDetailsComponent] onBack callback not provided.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "onBack"
      });
    });

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

    this._backBtnHandler = null;
    this._tabClickHandler = null;
  }

  async initialize() {
    const traceId = this.debugTools?.start?.('ProjectDetailsComponent.initialize');
    this.notify.info("[ProjectDetailsComponent] initialize() called", {
      group: true, context: "projectDetailsComponent", module: MODULE, source: "initialize"
    });

    // Wait for DOM to be ready before finding elements
    await waitForDepsAndDom({
      DependencySystem: this.eventHandlers?.DependencySystem
                        ?? (typeof window !== 'undefined' ? window.DependencySystem : null),
      domSelectors : ['#projectDetailsView'],
      timeout      : 5000
    });

    if (this.state.initialized) {
      this.notify.info("[ProjectDetailsComponent] Already initialized.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "initialize"
      });
      this.debugTools?.stop?.(traceId, 'ProjectDetailsComponent.initialize');
      return true;
    }
    try {
      if (!this._findElements()) {
        this.notify.error("Critical error: required DOM nodes missing for Project Details.", {
          group: true, context: "projectDetailsComponent", module: MODULE, source: "initialize", timeout: 0
        });
        throw new Error("Required DOM nodes missing in #projectDetailsView.");
      }
      this.notify.info("[ProjectDetailsComponent] Found required elements.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "initialize"
      });
      this._bindCoreEvents();
      await this._initSubComponents();

      this.state.initialized = true;
      this.notify.success("Project Details module initialized.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "initialize", timeout: 3000
      });

      // --- Standardized "projectdetailscomponent:initialized" event ---
      const doc = this.domAPI?.getDocument?.() || (typeof document !== "undefined" ? document : null);
      if (doc && typeof (this.domAPI?.dispatchEvent || doc.dispatchEvent) === "function") {
        (this.domAPI?.dispatchEvent || doc.dispatchEvent).call(
          doc,
          new CustomEvent('projectdetailscomponent:initialized', { detail: { success: true } })
        );
      }

      this._uiReadyFlag = true;
      this._maybeEmitReady();

      this.debugTools?.stop?.(traceId, 'ProjectDetailsComponent.initialize');
      return true;
    } catch (err) {
      this.notify.error("[ProjectDetailsComponent] Init failed: " + (err?.message || err), {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "initialize", originalError: err, timeout: 0
      });
      this.debugTools?.stop?.(traceId, 'ProjectDetailsComponent.initialize (error)');
      return false;
    } finally {
      this.debugTools?.stop?.(traceId, 'ProjectDetailsComponent.initialize');
    }
  }

  _htmlSafe(el, raw) { el.innerHTML = this.sanitizer.sanitize(raw); }
  // Clearing innerHTML is safe and does not require sanitization.
  _clearSafe(el) { el.innerHTML = ""; }

  _findElements() {
    this.elements.container = this.domAPI.getElementById("projectDetailsView");
    if (!this.elements.container) {
      this.notify.error("[ProjectDetailsComponent] #projectDetailsView not found", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "_findElements", timeout: 0
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
      this.notify.error("[ProjectDetailsComponent] Not all essential child elements found within #projectDetailsView.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "_findElements",
        detail: {
          titleFound: !!this.elements.title,
          descriptionFound: !!this.elements.description,
          backBtnFound: !!this.elements.backBtn,
          tabContainerFound: !!this.elements.tabContainer,
          detailsTabFound: !!this.elements.tabContents.details
        }
      });
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
        { description: 'ProjectDetails_Back' }
      );
    }
    if (this.elements.tabContainer) {
      if (this._tabClickHandler)
        this.eventHandlers.untrackListener(this.elements.tabContainer, 'click', this._tabClickHandler);
      this._tabClickHandler = (_e, btn) => {
        const tab = btn.dataset.tab;
        if (tab) this.switchTab(tab);
      };
      this.eventHandlers.delegate(
        this.elements.tabContainer,
        'click',
        '.project-tab-btn',
        this._tabClickHandler,
        { description: 'ProjectDetails_TabSwitch' }
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
        { description: "ProjectDetails_NewConversation" }
      );
    }

    const doc = this.domAPI.getDocument();
    const on = (evt, cb, desc) =>
      this.eventHandlers.trackListener(doc, evt, cb, { description: desc });

    on("projectConversationsLoaded", (e) => {
      this.renderConversations(e.detail?.conversations || []);
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
    new CustomEvent("projectConversationsRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_ConversationsLoaded");

    on("projectFilesLoaded", (e) => {
      this.renderFiles(e.detail?.files || []);
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
    new CustomEvent("projectFilesRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_FilesLoaded");

    on("projectArtifactsLoaded", (e) => {
      this.renderArtifacts(e.detail?.artifacts || []);
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
    new CustomEvent("projectArtifactsRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_ArtifactsLoaded");

    on("projectStatsLoaded", (e) => {
      this.renderStats(e.detail);
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
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
    this.domAPI.ownerDocument,
    new CustomEvent("projectKnowledgeBaseRendered", {
          detail: { projectId: e.detail?.projectId }
        })
      );
    }, "PD_KnowledgeLoaded");

    on("projectDetailsFullyLoaded", (e) => {
      this.notify.info(`[ProjectDetailsComponent] Project ${e.detail?.projectId} fully loaded.`, {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "_bindCoreEvents", detail: { projectId: e.detail?.projectId }
      });
      const newChat = this.elements.container.querySelector("#projectNewConversationBtn");
      if (newChat) {
        newChat.disabled = false;
        newChat.classList.remove("btn-disabled");
      }
    }, "PD_FullyLoaded");
  }

  async _initSubComponents() {
    if (!this.fileUploadComponent && this.FileUploadComponentClass) {
      const els = this.elements;
      const ready =
        els.fileInput && els.uploadBtn && els.dragZone &&
        els.uploadProgress && els.progressBar && els.uploadStatus;

      if (!ready) {
        this.notify.warn("[ProjectDetailsComponent] FileUploadComponent DOM nodes missing.", {
          group: true, context: "projectDetailsComponent", module: MODULE, source: "_initSubComponents"
        });
        return;
      }

      this.fileUploadComponent = new this.FileUploadComponentClass({
        app: this.app,
        eventHandlers: this.eventHandlers,
        projectManager: this.projectManager,
        notify: this.originalNotify, // Ensure full API, not a context-bound wrapper
        domAPI: this.domAPI,
        onUploadComplete: () => {
          const id = this.state.currentProject?.id;
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

      await (this.fileUploadComponent.init ?? this.fileUploadComponent.initialize)?.();
      this.notify.info("[ProjectDetailsComponent] FileUploadComponent ready.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "_initSubComponents"
      });
    }
  }

  show() {
    if (!this.state.initialized || !this.elements.container) {
      this.notify.error("[ProjectDetailsComponent] show() called before init.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "show", timeout: 0
      });
      return;
    }
    this.elements.container.classList.remove("hidden");
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

    this.notify.info("[ProjectDetailsComponent] Shown.", {
      group: true, context: "projectDetailsComponent", module: MODULE, source: "show"
    });
  }

  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add("hidden");
      this.elements.container.setAttribute("aria-hidden", "true");
      this.notify.info("[ProjectDetailsComponent] Hidden.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "hide"
      });
    }
  }

  renderProject(project) {
    if (!this.state.initialized) {
      this.notify.error("[ProjectDetailsComponent] renderProject before init.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "renderProject", timeout: 0, detail: { project }
      });
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) {
      this.notify.error("[ProjectDetailsComponent] Invalid project payload.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "renderProject", timeout: 0, detail: { project }
      });
      this.notify.error("Failed to load project details: Invalid or missing project ID.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "renderProject", timeout: 0
      });
      this.onBack();
      return;
    }

    this.notify.info(`[ProjectDetailsComponent] Render project ${project.id}`, {
      group: true, context: "projectDetailsComponent", module: MODULE, source: "renderProject", detail: { project }
    });
    this.state.currentProject = project;
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
      this.notify.warn("[ProjectDetailsComponent] switchTab before init.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab"
      });
      return;
    }

    const TABS = ["details", "files", "knowledge", "conversations", "artifacts", "chat"];
    if (!TABS.includes(tabName)) {
      this.notify.warn(`[ProjectDetailsComponent] invalid tab "${tabName}".`, {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab"
      });
      this.notify.warn("Attempted to switch to invalid tab: " + tabName, {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab", timeout: 5000
      });
      return;
    }

    const pid = this.state.currentProject?.id;
    const needsProject = ["files", "knowledge", "conversations", "artifacts", "chat"].includes(tabName);

    if (needsProject && !this.app.validateUUID(pid)) {
      this.notify.error(`[ProjectDetailsComponent] tab "${tabName}" needs valid project.`, {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab", detail: { tabName }
      });
      this.notify.warn("Please select a valid project before accessing this tab.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab", timeout: 5000
      });
      return;
    }

    this.notify.info(`[ProjectDetailsComponent] tab => ${tabName}`, {
      group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab"
    });
    this.state.activeTab = tabName;
    this.notify.info(`Switched to "${tabName}" tab.`, {
      group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab", timeout: 2500
    });

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
            this.notify.error("[ProjectDetailsComponent] modelConfig render failed: " + (e?.message || e), {
              group: true, context: "projectDetailsComponent", module: MODULE, source: "_loadTabContent", originalError: e, timeout: 0
            });
          }
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
    new CustomEvent("modelConfigRendered", {
              detail: { projectId: pid }
            })
          );
        });
      }
    }
    if ((tabName === "conversations" || tabName === "chat") && this.chatManager?.initialize) {
      this.chatManager.initialize({
        projectId: this.state.currentProject?.id,
        containerSelector: "#projectChatUI",
        messageContainerSelector: "#projectChatMessages",
        inputSelector: "#projectChatInput",
        sendButtonSelector: "#projectChatSendBtn"
      }).catch((err) => {
        this.notify.error("[ProjectDetailsComponent] Failed to init chatManager for conversations: " + (err?.message || err), {
          group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab", originalError: err, timeout: 0
        });
        this.notify.error("Unable to initialize chat manager for Conversations tab.", {
          group: true, context: "projectDetailsComponent", module: MODULE, source: "switchTab", timeout: 0
        });
      });
    }
  }

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
    this.domAPI.ownerDocument,
    new CustomEvent("projectDetailsReady", {
          detail: {
            project: this.state.currentProject,
            container: this.elements.container
          }
        })
      );
      this.notify.info(`[ProjectDetailsComponent] Dispatched projectDetailsReady for ${this.state.currentProject.id}`, {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "_maybeEmitReady", detail: { project: this.state.currentProject }
      });
    }
  }

  renderFiles(files = []) {
    const c = this.elements.filesList;
    if (!c) {
      this.notify.warn("[ProjectDetailsComponent] filesList node missing.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "renderFiles"
      });
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
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
      this.notify.warn("[ProjectDetailsComponent] conversationsList missing.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "renderConversations"
      });
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
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
      this.notify.warn("[ProjectDetailsComponent] artifactsList missing.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "renderArtifacts"
      });
this.domAPI.dispatchEvent(
    this.domAPI.ownerDocument,
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
    this.notify.info("[ProjectDetailsComponent] stats updated", {
      group: true, context: "projectDetailsComponent", module: MODULE, source: "renderStats", detail: { stats: s }
    });
  }

  async createNewConversation() {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid)) {
      this.notify.warn("Invalid project.", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "createNewConversation"
      });
      return;
    }
    if (this.projectManager.projectLoadingInProgress) {
      this.notify.info("Please wait, project still loading…", {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "createNewConversation"
      });
      return;
    }

    try {
      this.notify.info(`[ProjectDetailsComponent] create conversation @${pid}`, {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "createNewConversation", detail: { projectId: pid }
      });
      const conv = await this.projectManager.createConversation(pid);
      if (conv?.id) {
        this.notify.success(`Conversation “${conv.title || "Untitled"}” created.`, {
          group: true, context: "projectDetailsComponent", module: MODULE, source: "createNewConversation", detail: { conversationId: conv.id, projectId: pid }
        });
        this._openConversation(conv);
      } else {
        throw new Error("Invalid response from createConversation");
      }
    } catch (err) {
      this.notify.error("[ProjectDetailsComponent] createConversation failed: " + (err?.message || err), {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "createNewConversation", originalError: err, timeout: 0
      });
    }
  }

  destroy() {
    this.notify.info("[ProjectDetailsComponent] destroy()", {
      group: true, context: "projectDetailsComponent", module: MODULE, source: "destroy"
    });
    this.eventHandlers.cleanupListeners(this.elements.container);
    this.eventHandlers.cleanupListeners(this.domAPI.getDocument());
    this.state.initialized = false;
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
            .catch(e => this.notify.error("[ProjectDetailsComponent] KB init failed: " + (e?.message || e), {
              group: true, context: "projectDetailsComponent", module: MODULE, source: "_loadTabContent", originalError: e, timeout: 0
            }));
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
      this.notify.error(`[ProjectDetailsComponent] load ${section} failed: ${err?.message || err}`, {
        group: true, context: "projectDetailsComponent", module: MODULE, source: "_withLoading", originalError: err, timeout: 0
      });
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
            this.notify.error("[ProjectDetailsComponent] artifact download failed: " + (e?.message || e), {
              group: true,
              context: "projectDetailsComponent",
              module: MODULE,
              source: "_artifactItem",
              originalError: e,
              timeout: 0
            });
            this.notify.error(`Download failed: ${e.message}`, {
              group: true,
              context: "projectDetailsComponent",
              module: MODULE,
              source: "_artifactItem",
              originalError: e,
              timeout: 0
            });
          });
      } else {
        this.notify.error("[ProjectDetailsComponent] downloadArtifact not available.", {
          group: true,
          context: "projectDetailsComponent",
          module: MODULE,
          source: "_artifactItem",
          timeout: 0
        });
      }
    }, { description: `DownloadArtifact_${art.id}` });
    return div;
  }

  _confirmDeleteFile(fileId, fileName) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
      this.notify.error("[ProjectDetailsComponent] deleteFile invalid ids", {
        group: true,
        context: "projectDetailsComponent",
        module: MODULE,
        source: "_confirmDeleteFile",
        detail: { fileId, fileName, projectId: pid }
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
            context: "projectDetailsComponent",
            module: MODULE,
            source: "_confirmDeleteFile",
            detail: { fileId, fileName, projectId: pid }
          });
          this.projectManager.loadProjectFiles(pid);
        } catch (e) {
          this.notify.error("[ProjectDetailsComponent] deleteFile failed: " + (e?.message || e), {
            group: true,
            context: "projectDetailsComponent",
            module: MODULE,
            source: "_confirmDeleteFile",
            originalError: e,
            detail: { fileId, fileName, projectId: pid }
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
        module: MODULE,
        source: "_downloadFile",
        detail: { fileId, fileName, projectId: pid }
      });
      return;
    }
    if (!this.projectManager.downloadFile) {
      this.notify.error("[ProjectDetailsComponent] downloadFile not implemented.", {
        group: true,
        context: "projectDetailsComponent",
        module: MODULE,
        source: "_downloadFile",
        detail: { fileId, fileName, projectId: pid }
      });
      return;
    }
    this.projectManager.downloadFile(pid, fileId)
      .catch(e => {
        this.notify.error("[ProjectDetailsComponent] downloadFile failed: " + (e?.message || e), {
          group: true,
          context: "projectDetailsComponent",
          module: MODULE,
          source: "_downloadFile",
          originalError: e,
          detail: { fileId, fileName, projectId: pid }
        });
      });
  }

  async _openConversation(cv) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !cv?.id) {
      this.notify.error("[ProjectDetailsComponent] openConversation invalid ids", {
        group: true,
        context: "projectDetailsComponent",
        module: MODULE,
        source: "_openConversation",
        detail: { conversation: cv, projectId: pid }
      });
      return;
    }
    try {
      /**
       * Retrieve the full conversation record from backend/cache for the
       * provided conversation-view model. Awaiting here ensures downstream
       * logic (URL mutation & navigation) executes only after we have the
       * latest messages/metadata.
       *
       * Note: projectManager is injected (DI), adhering to the “No Globals”
       * rule in .roo/rules/rules.md.
       */
      await this.projectManager.getConversation(cv.id);

      /**
       * Capture the current SPA location as a mutable, native `URL` object.
       * This gives us a safe, ergonomic API (`searchParams`, `pathname`, etc.)
       * to modify the query string (e.g., set `chatId`) before calling
       * `router.navigate()`.  Avoids brittle manual string concatenation.
       */
      const url = new URL(this.router.getURL());
      url.searchParams.set("chatId", cv.id);
      this.router.navigate(url.toString());
      this.notify.info(`[ProjectDetailsComponent] conversation ${cv.id} opened`, {
        group: true,
        context: "projectDetailsComponent",
        module: MODULE,
        source: "_openConversation",
        detail: { conversationId: cv.id, projectId: pid }
      });
    } catch (error) {
      this.notify.error("[ProjectDetailsComponent] Failed to fetch conversation: " + (error?.message || error), {
        group: true,
        context: "projectDetailsComponent",
        module: MODULE,
        source: "_openConversation",
        originalError: error,
        detail: { conversation: cv, projectId: pid }
      });
    }
  }
}

export const createProjectDetailsComponent = (opts) => new ProjectDetailsComponent(opts);
