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
 *   • notify                    : obj – .withContext() → {debug,info,success,warn,error}
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
 *
 * Todas las notificaciones incluyen automáticamente:
 *   { group, context, module:"ProjectDetailsComponent", source, detail, originalError? }.
 */

import { waitForDepsAndDom } from './utils/globalUtils.js';

const MODULE = "ProjectDetailsComponent";

function createProjectDetailsComponent({
  onBack,
  app,
  projectManager,
  eventHandlers,
  modalManager,
  FileUploadComponentClass,
  router,
  notify,
  errorReporter,
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
    !errorReporter ||
    !sanitizer ||
    !domAPI
  ) {
    throw new Error(
      "[ProjectDetailsComponent] Missing required dependencies " +
      "(app, projectManager, eventHandlers, modalManager, FileUploadComponentClass, " +
      "router, notify, errorReporter, sanitizer, domAPI)."
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
    notify,
    errorReporter,
    sanitizer,
    domAPI,
    browserService,
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
    notify,
    errorReporter,
    sanitizer,
    domAPI,
    browserService,
    globalUtils,
    knowledgeBaseComponent = null,
    modelConfig = null,
    chatManager = null
  } = {}) {
    if (!errorReporter) {
      throw new Error("[ProjectDetailsComponent] errorReporter is required for context-rich error logging.");
    }

    this.errorReporter = errorReporter;
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
    this.DependencySystem = app?.DependencySystem || eventHandlers?.DependencySystem; // Get DependencySystem
    this.navigationService = this.DependencySystem?.modules?.get('navigationService');

    this.notify.debug('[ProjectDetailsComponent] Optional dependencies status:', {
        group: false, // Keep constructor logs less noisy unless debugging
        source: "constructor", // context and module are auto-applied
        extra: {
            knowledgeBaseComponent: !!this.knowledgeBaseComponent,
            modelConfig: !!this.modelConfig,
            chatManager: !!this.chatManager
        }
    });

    this.onBack = onBack || (() => {
      this.notify.warn("[ProjectDetailsComponent] onBack callback not provided.", {
        group: true, source: "constructor_onBackFallback" // context and module are auto-applied
      });
    });

    this.state = {
      currentProject: null,
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

  async initialize() {
    const traceId = this.debugTools?.start?.('ProjectDetailsComponent.initialize');
    this.notify.info("[ProjectDetailsComponent] initialize() called", {
      group: true, source: "initialize" // context and module are auto-applied
    });

    // Wait for DOM to be ready before finding elements
    await waitForDepsAndDom({
      DependencySystem: this.eventHandlers?.DependencySystem
                        ?? (typeof window !== 'undefined' ? window.DependencySystem : null),
      domAPI          : this.domAPI,
      domSelectors : ['#projectDetailsView'],
      timeout      : 5000
    });

    if (this.state.initialized) {
      this.notify.info("[ProjectDetailsComponent] Already initialized.", {
        group: true, source: "initialize_alreadyInitialized" // context and module are auto-applied
      });
      this.debugTools?.stop?.(traceId, 'ProjectDetailsComponent.initialize');
      return true;
    }
    try {
      if (!this._findElements()) {
        this.notify.error("Critical error: required DOM nodes missing for Project Details.", {
          group: true, source: "initialize_findElements_critical", timeout: 0 // context and module are auto-applied
        });
        // Add more detail to the error log about which elements were missing
        const missingElements = Object.entries(this.elements)
            .filter(([key, value]) => !value && key !== 'container' /* already checked */ && key !== 'loadingIndicators' && key !== 'tabContents') // filter out complex objects or less critical ones for this specific log
            .map(([key]) => key);
        this.notify.error(`[ProjectDetailsComponent] Missing DOM elements during _findElements: ${missingElements.join(', ')}`, {
            group: true, source: "initialize_findElements_detail", // context and module are auto-applied
            detail: { checkedElements: Object.keys(this.elements).filter(k => k !== 'loadingIndicators' && k !== 'tabContents') }
        });
        throw new Error("Required DOM nodes missing in #projectDetailsView for initialization.");
      }
      this.notify.info("[ProjectDetailsComponent] _findElements successful. All essential elements found.", {
        group: true, source: "initialize_findElements_success" // context and module are auto-applied
      });
      this._bindCoreEvents();
      await this._initSubComponents();

      this.state.initialized = true;
      this.notify.success("Project Details module initialized.", {
        group: true, source: "initialize_success", timeout: 3000 // context and module are auto-applied
      });

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

      this._uiReadyFlag = true;
      this._maybeEmitReady();

      this.debugTools?.stop?.(traceId, 'ProjectDetailsComponent.initialize');
      return true;
    } catch (err) {
      this.notify.error("[ProjectDetailsComponent] Init failed: " + (err?.message || err), {
        group: true, source: "initialize_catch", originalError: err, timeout: 0 // context and module are auto-applied
      });
      this.errorReporter.capture(err, { module: MODULE, source: "initialize", originalError: err });
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
        group: true, source: "_findElements_containerMissing", timeout: 0 // context and module are auto-applied
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
        group: true, source: "_findElements_essentialMissing", // context and module are auto-applied
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
      this.notify.info(`[ProjectDetailsComponent] Received projectDetailsFullyLoaded for project ${e.detail?.projectId}.`, {
        group: true, source: "_bindCoreEvents_projectDetailsFullyLoaded", detail: { projectId: e.detail?.projectId } // context and module are auto-applied
      });
      this.state.projectDataActuallyLoaded = true;
      this.notify.info(`[ProjectDetailsComponent] projectDataActuallyLoaded set to true.`, {
        group: true, source: "_bindCoreEvents_projectDataActuallyLoaded" // context and module are auto-applied
      });
      this._updateNewChatButtonState();
    }, "PD_FullyLoaded");

    // Listen for global auth state changes to re-evaluate button state
    on("authStateChanged", (authEvent) => {
        this.notify.info(`[ProjectDetailsComponent] Auth state changed event received (authenticated: ${authEvent.detail?.authenticated}). Updating chat button.`, {
            group: true, source: "_bindCoreEvents_authStateChanged", // context and module are auto-applied
            detail: { user: authEvent.detail?.user }
        });
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
        this.notify.warn("[ProjectDetailsComponent] FileUploadComponent DOM nodes missing.", {
          group: true, source: "_initSubComponents_fileUploadDomMissing" // context and module are auto-applied
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

      // Asegura que el método se invoque con el contexto correcto (`this.fileUploadComponent`)
      const initFn = this.fileUploadComponent.init ?? this.fileUploadComponent.initialize;
      if (typeof initFn === "function") {
        await initFn.call(this.fileUploadComponent);
      }
      this.notify.info("[ProjectDetailsComponent] FileUploadComponent ready.", {
        group: true, source: "_initSubComponents_fileUploadReady" // context and module are auto-applied
      });
    }
  }

  show() {
    if (!this.state.initialized || !this.elements.container) {
      this.notify.error("[ProjectDetailsComponent] show() called before init.", {
        group: true, source: "show_notInitialized", timeout: 0 // context and module are auto-applied
      });
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

    this.notify.info("[ProjectDetailsComponent] Shown.", {
      group: true, source: "show" // context and module are auto-applied
    });
  }

  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add("hidden");
      // this.elements.container.classList.add("opacity-0"); // Optionally add for fade effect
      this.elements.container.setAttribute("aria-hidden", "true");
      this.notify.info("[ProjectDetailsComponent] Hidden.", {
        group: true, source: "hide" // context and module are auto-applied
      });
    }
  }

  renderProject(project) {
    if (!this.state.initialized) {
      this.notify.error("[ProjectDetailsComponent] renderProject before init.", {
        group: true, source: "renderProject_notInitialized", timeout: 0, detail: { project } // context and module are auto-applied
      });
      return;
    }
    if (!project || !this.app.validateUUID(project.id)) {
      this.notify.error("[ProjectDetailsComponent] Invalid project payload.", {
        group: true, source: "renderProject_invalidPayload", timeout: 0, detail: { project } // context and module are auto-applied
      });
      this.notify.error("Failed to load project details: Invalid or missing project ID.", {
        group: true, source: "renderProject_invalidId", timeout: 0 // context and module are auto-applied
      });
      this.onBack();
      return;
    }

    this.notify.info(`[ProjectDetailsComponent] Render project ${project.id}`, {
      group: true, source: "renderProject", detail: { project } // context and module are auto-applied
    });
    this.state.currentProject = project;
    // mark data ready → enable “New Chat” button
    this.state.projectDataActuallyLoaded = true;
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
      this.notify.warn("[ProjectDetailsComponent] switchTab before init.", {
        group: true, source: "switchTab_notInitialized"
      });
      return;
    }

    const TABS = ["details", "files", "knowledge", "conversations", "artifacts", "chat"];
    if (!TABS.includes(tabName)) {
      this.notify.warn(`[ProjectDetailsComponent] invalid tab "${tabName}".`, {
        group: true, source: "switchTab_invalidTabName"
      });
      this.notify.warn("Attempted to switch to invalid tab: " + tabName, {
        group: true, source: "switchTab_invalidTabAttempt", timeout: 5000
      });
      return;
    }

    const pid = this.state.currentProject?.id;
    const needsProject = ["files", "knowledge", "conversations", "artifacts", "chat"].includes(tabName);

    if (needsProject && !this.app.validateUUID(pid)) {
      this.notify.error(`[ProjectDetailsComponent] tab "${tabName}" needs valid project.`, {
        group: true, source: "switchTab_projectNeeded", detail: { tabName }
      });
      this.notify.warn("Please select a valid project before accessing this tab.", {
        group: true, source: "switchTab_selectValidProject", timeout: 5000
      });
      return;
    }

    this.notify.info(`[ProjectDetailsComponent] tab => ${tabName}`, {
      group: true, source: "switchTab_switchingTo"
    });
    this.state.activeTab = tabName;
    this.notify.info(`Switched to "${tabName}" tab.`, {
      group: true, source: "switchTab_switchedTo", timeout: 2500
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
              group: true, source: "switchTab_modelConfigRenderFail", originalError: e, timeout: 0
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
    // Initialize chatManager only for the "chat" tab
    // The "chat" functionality is now integrated within the "conversations" tab's HTML structure.
    if (tabName === "chat" && this.chatManager?.initialize) {
      // Use the "conversations" tab content area as the host for the chat UI
      const conversationsTabContent = this.elements.tabContents.conversations;

      if (conversationsTabContent) {
        this.notify.info("[ProjectDetailsComponent] Initializing chat within 'conversations' tab.", {
            source: "switchTab_initChatInConversations",
            projectId: this.state.currentProject?.id
        });

        // The HTML already contains elements with IDs like #projectChatUI, #projectChatMessages etc.
        // Pass these existing selectors to the chatManager.
        // The chatManager's _setupUIElements will find these if they exist,
        // or create them if its internal logic is set up to do so (which it is, based on recent chat.js changes).
        this.chatManager.initialize({
          projectId: this.state.currentProject?.id,
          containerSelector: "#projectChatUI", // Existing ID in project_details.html within #conversationsTab
          messageContainerSelector: "#projectChatMessages", // Existing ID
          inputSelector: "#projectChatInput", // Existing ID
          sendButtonSelector: "#projectChatSendBtn", // Existing ID
          titleSelector: "#projectChatContainer h3", // Selector for the "Conversation" title if needed
          minimizeButtonSelector: "#projectMinimizeChatBtn" // Existing ID
        }).catch((err) => {
          this.notify.error("[ProjectDetailsComponent] Failed to init chatManager within conversations tab: " + (err?.message || err), {
            group: true, source: "switchTab_chatManagerInitFailInConversations", originalError: err, timeout: 0
          });
        });
      } else {
        this.notify.error("[ProjectDetailsComponent] Conversations tab content area (#conversationsTab) not found. Cannot initialize chat.", {
            group: true, source: "switchTab_convTabNotFoundForChat", timeout: 0
        });
      }
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
        group: true, source: "_maybeEmitReady", detail: { project: this.state.currentProject }
      });
    }
  }

  renderFiles(files = []) {
    const c = this.elements.filesList;
    if (!c) {
      this.notify.warn("[ProjectDetailsComponent] filesList node missing.", {
        group: true, source: "renderFiles_listNodeMissing"
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
        group: true, source: "renderConversations_listNodeMissing"
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
        group: true, source: "renderArtifacts_listNodeMissing"
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
      group: true, source: "renderStats", detail: { stats: s }
    });
  }

  async createNewConversation() {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid)) {
      this.notify.warn("Invalid project.", {
        group: true, source: "createNewConversation_invalidProject"
      });
      return;
    }
    if (this.projectManager.projectLoadingInProgress) {
      this.notify.info("Please wait, project still loading…", {
        group: true, source: "createNewConversation_loadingInProgress"
      });
      return;
    }

    // Check for User ID before proceeding
    // const currentUser = this.app?.state?.currentUser; // OLD

    // NEW: Use auth module directly via DependencySystem
    const auth = this.DependencySystem?.modules?.get?.('auth') ?? null;
    const currentUser = auth?.getCurrentUserObject?.() ?? null; // NEW

    if (!currentUser || !currentUser.id) {
      this.notify.error("[ProjectDetailsComponent] User ID not available (checked via auth module). Cannot create conversation.", {
        group: true, source: "createNewConversation_noUserId", timeout: 0
      });
      // Optionally, prompt user to log in or refresh
      // this.modalManager.alert({ title: "Authentication Error", message: "Your session might have expired. Please log in again." });
      return;
    }

    try {
      this.notify.info(`[ProjectDetailsComponent] create conversation @${pid} for user ${currentUser.id}`, {
        group: true, source: "createNewConversation_attempt", detail: { projectId: pid, userId: currentUser.id }
      });
      const conv = await this.projectManager.createConversation(pid);
      if (conv?.id) {
        this.notify.success(`Conversation “${conv.title || "Untitled"}” created.`, {
          group: true, source: "createNewConversation_success", detail: { conversationId: conv.id, projectId: pid }
        });
        this._openConversation(conv);
      } else {
        throw new Error("Invalid response from createConversation");
      }
    } catch (err) {
      this.notify.error("[ProjectDetailsComponent] createConversation failed: " + (err?.message || err), {
        group: true, source: "createNewConversation_catch", originalError: err, timeout: 0
      });
      this.errorReporter.capture(err, { module: MODULE, source: "createNewConversation", originalError: err });
    }

  }  // ← closes createNewConversation()

  _updateNewChatButtonState() {
    const newChatBtn = this.elements.container?.querySelector("#projectNewConversationBtn");
    if (!newChatBtn) return;

    const projectReady = this.state.projectDataActuallyLoaded;
    // Treat “authenticated” as sufficient – user object may arrive later
    // const userIsReady = !!(this.app?.state?.isAuthenticated); // OLD

    // NEW: Use auth module directly via DependencySystem
    // Assuming this.DependencySystem is available as per app.js setup
    const auth = this.DependencySystem?.modules?.get?.('auth') ?? null;
    const userIsReady = !!auth?.isAuthenticated?.(); // NEW

    if (projectReady && userIsReady) {
      newChatBtn.disabled = false;
      newChatBtn.classList.remove("btn-disabled");
      this.notify.info(`[ProjectDetailsComponent] _updateNewChatButtonState: ENABLING button. Project Ready: ${projectReady}, User Authenticated: ${userIsReady}`, {
        group: true, source: "_updateNewChatButtonState_enabled", // context and module are auto-applied
        detail: { projectDataActuallyLoaded: this.state.projectDataActuallyLoaded, currentUserId: auth?.getCurrentUserObject?.()?.id }
      });
    } else {
      newChatBtn.disabled = true;
      newChatBtn.classList.add("btn-disabled");
      this.notify.warn(`[ProjectDetailsComponent] _updateNewChatButtonState: DISABLING button. Project Ready: ${projectReady}, User Authenticated: ${userIsReady}`, {
        group: true, source: "_updateNewChatButtonState_disabled", // context and module are auto-applied
        detail: {
            projectDataActuallyLoaded: this.state.projectDataActuallyLoaded,
            authModuleExists: !!auth,
            currentUserId: auth?.getCurrentUserObject?.()?.id, // MODIFIED
            authModuleIsAuthenticated: userIsReady // MODIFIED
        }
      });
    }
  }

  destroy() {
    this.notify.info("[ProjectDetailsComponent] destroy()", {
      group: true, source: "destroy" // context and module are auto-applied
    });
    // this.eventHandlers.cleanupListeners(this.elements.container); // Old way
    // this.eventHandlers.cleanupListeners(this.domAPI.getDocument()); // Old way
    // New way: cleanup all listeners registered with this component's context
    if (this.eventHandlers.DependencySystem && typeof this.eventHandlers.DependencySystem.cleanupModuleListeners === 'function') {
        this.eventHandlers.DependencySystem.cleanupModuleListeners(MODULE);
    } else if (typeof this.eventHandlers.cleanupListeners === 'function') {
        this.eventHandlers.cleanupListeners({ context: MODULE });
    }
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
            .catch(e => {
              this.notify.error("[ProjectDetailsComponent] KB init failed: " + (e?.message || e), {
                group: true, source: "_loadTabContent_kbInitFail", originalError: e, timeout: 0 // context and module are auto-applied
              });
              this.errorReporter.capture(e, { module: MODULE, source: "_loadTabContent", originalError: e });
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
      this.notify.error(`[ProjectDetailsComponent] load ${section} failed: ${err?.message || err}`, {
        group: true, source: `_withLoading_${section}Fail`, originalError: err, timeout: 0 // context and module are auto-applied
      });
      this.errorReporter.capture(err, { module: MODULE, source: "_withLoading", section, originalError: err });
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
            this.notify.error("[ProjectDetailsComponent] artifact download failed: " + (e?.message || e), {
              group: true,
              source: "_artifactItem_downloadCatch", // context and module are auto-applied
              originalError: e,
              timeout: 0,
              detail: { artifactId: art.id }
            });
            // The second notify.error here seems redundant if the first one already captures the essence.
            // However, to strictly follow "standardize all identified logic" without removing existing logic:
            this.notify.error(`Download failed for artifact ${art.name || art.id}: ${e.message}`, {
              group: true,
              source: "_artifactItem_downloadUserMsg", // context and module are auto-applied
              originalError: e,
              timeout: 0,
              detail: { artifactId: art.id }
            });
          });
      } else {
        this.notify.error("[ProjectDetailsComponent] downloadArtifact not available.", {
          group: true,
          source: "_artifactItem_downloadNotAvailable", // context and module are auto-applied
          timeout: 0,
          detail: { artifactId: art.id }
        });
      }
    }, { description: `DownloadArtifact_${art.id}`, context: MODULE });
    return div;
  }

  _confirmDeleteFile(fileId, fileName) {
    const pid = this.state.currentProject?.id;
    if (!this.app.validateUUID(pid) || !fileId) {
      this.notify.error("[ProjectDetailsComponent] deleteFile invalid ids", {
        group: true,
        source: "_confirmDeleteFile_invalidIds", // context and module are auto-applied
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
            source: "_confirmDeleteFile_success", // context and module are auto-applied
            detail: { fileId, fileName, projectId: pid }
          });
          this.projectManager.loadProjectFiles(pid);
        } catch (e) {
          this.notify.error("[ProjectDetailsComponent] deleteFile failed: " + (e?.message || e), {
            group: true,
            source: "_confirmDeleteFile_catch", // context and module are auto-applied
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
        source: "_downloadFile_invalidIds", // context and module are auto-applied
        detail: { fileId, fileName, projectId: pid }
      });
      return;
    }
    if (!this.projectManager.downloadFile) {
      this.notify.error("[ProjectDetailsComponent] downloadFile not implemented.", {
        group: true,
        source: "_downloadFile_notImplemented", // context and module are auto-applied
        detail: { fileId, fileName, projectId: pid }
      });
      return;
    }
    this.projectManager.downloadFile(pid, fileId)
      .catch(e => {
        this.notify.error("[ProjectDetailsComponent] downloadFile failed: " + (e?.message || e), {
          group: true,
          source: "_downloadFile_catch", // context and module are auto-applied
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
        source: "_openConversation_invalidIds", // context and module are auto-applied
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

      // Switch to the chat tab to display the conversation
      // this.switchTab("chat"); // NavigationService will handle activating the tab via params

      /**
       * Capture the current SPA location as a mutable, native `URL` object.
       * This gives us a safe, ergonomic API (`searchParams`, `pathname`, etc.)
       * to modify the query string (e.g., set `chatId`) before calling
       * `router.navigate()`.  Avoids brittle manual string concatenation.
       */
      // const url = new URL(this.router.getURL()); // Handled by NavigationService
      // url.searchParams.set("chatId", cv.id); // Handled by NavigationService
      // this.router.navigate(url.toString()); // Handled by NavigationService

      if (this.navigationService) {
        this.navigationService.navigateToConversation(pid, cv.id);
        this.notify.info(`[ProjectDetailsComponent] Navigating to conversation ${cv.id} via NavigationService`, {
          group: true,
          source: "_openConversation_navService", // context and module are auto-applied
          detail: { conversationId: cv.id, projectId: pid }
        });
      } else {
        // Fallback or error if NavigationService is not available
        this.notify.error("[ProjectDetailsComponent] NavigationService not available to open conversation.", {
          group: true,
          source: "_openConversation_noNavService", // context and module are auto-applied
          detail: { conversationId: cv.id, projectId: pid }
        });
        // Fallback to old method if necessary, though ideally this shouldn't happen
        this.switchTab("chat");
        const url = new URL(this.router.getURL());
        url.searchParams.set("chatId", cv.id);
        this.router.navigate(url.toString());
        this.notify.warn(`[ProjectDetailsComponent] Fallback: conversation ${cv.id} opened and switched to chat tab using router`, {
          group: true,
          source: "_openConversation_fallback", // context and module are auto-applied
          detail: { conversationId: cv.id, projectId: pid }
        });
      }
    } catch (error) {
      this.notify.error("[ProjectDetailsComponent] Failed to fetch conversation: " + (error?.message || error), {
        group: true,
        source: "_openConversation_catch", // context and module are auto-applied
        originalError: error,
        detail: { conversation: cv, projectId: pid }
      });
    }
  }
}

export { createProjectDetailsComponent };
