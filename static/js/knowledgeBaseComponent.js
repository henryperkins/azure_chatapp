/**
 * @module knowledgeBaseComponent
 * @description Factory module for creating KnowledgeBaseComponent instances with dependency injection.
 *
 * ## Dependencies
 * All dependencies must be provided via constructor options or DependencySystem:
 *
 * @typedef {Object} Dependencies
 * @property {Object} DependencySystem - Core dependency resolver (required)
 * @property {Object} app - Application utilities (required)
 * @property {Function} app.validateUUID - UUID validation function
 * @property {Function} app.apiRequest - API communication handler
 * @property {Function} app.getProjectId - Project ID getter
 * @property {Function} app.showNotification - Notification display function
 * @property {Object} projectManager - Project management utilities (required)
 * @property {Object} projectManager.currentProject - Current project data
 * @property {Function} projectManager.loadProjectDetails - Project details loader
 * @property {Function} projectManager.loadProjectStats - Project statistics loader (optional)
 * @property {Object} eventHandlers - Event management system (required)
 * @property {Function} eventHandlers.trackListener - Event listener tracker
 * @property {Object} uiUtils - UI formatting utilities (required)
 * @property {Function} uiUtils.formatBytes - File size formatter
 * @property {Function} uiUtils.formatDate - Date formatter
 * @property {Function} uiUtils.fileIcon - File-type icon mapper
 * @property {Object} [uiUtilsInstance] - Alternate UI utils instance (fallback)
 * @property {Object} modalManager - Modal management utility (required)
 * @property {Object} sanitizer - HTML sanitizer utility (required, with .sanitize method)
 * @property {Object} notify - Notification utility (required)
 * @property {Object} [scheduler] - Optional scheduler for debounce (setTimeout, clearTimeout)
 *
 * @typedef {Object} ElRefs
 * @property {HTMLElement} [container] - Main container element
 * @property {HTMLElement} [activeSection] - Active KB section
 * @property {HTMLElement} [inactiveSection] - Inactive KB section
 * @property {HTMLElement} [statusBadge] - Status indicator badge
 * @property {HTMLElement} [searchInput] - Search input field
 * @property {HTMLElement} [searchButton] - Search button
 * @property {HTMLElement} [resultsContainer] - Search results container
 * @property {HTMLElement} [resultsSection] - Search results section
 * @property {HTMLElement} [noResultsSection] - No-results section
 * @property {HTMLElement} [topKSelect] - Top-K results dropdown
 * @property {HTMLElement} [kbToggle] - Enable/disable toggle
 * @property {HTMLElement} [reprocessButton] - Reprocess files button
 * @property {HTMLElement} [setupButton] - Setup KB button
 * @property {HTMLElement} [settingsButton] - Settings button
 * @property {HTMLElement} [kbNameDisplay] - KB name display
 * @property {HTMLElement} [kbModelDisplay] - Model display
 * @property {HTMLElement} [kbVersionDisplay] - Version display
 * @property {HTMLElement} [kbLastUsedDisplay] - Last-used display
 * @property {HTMLElement} [settingsModal] - Settings modal
 * @property {HTMLElement} [settingsForm] - Settings form
 * @property {HTMLElement} [cancelSettingsBtn] - Cancel settings button
 * @property {HTMLElement} [deleteKnowledgeBaseBtn] - Delete KB button in settings modal
 * @property {HTMLElement} [modelSelect] - Model selection dropdown
 * @property {HTMLElement} [resultModal] - Result detail modal
 * @property {HTMLElement} [resultTitle] - Result title
 * @property {HTMLElement} [resultSource] - Result source label
 * @property {HTMLElement} [resultScore] - Result score badge
 * @property {HTMLElement} [resultContent] - Result content container
 * @property {HTMLElement} [useInChatBtn] - Chat integration button
 * @property {HTMLElement} [knowledgeBaseFilesSection] - Container for KB files list
 * @property {HTMLElement} [knowledgeBaseFilesListContainer] - List container for KB files
 * @property {HTMLElement} [kbGitHubAttachedRepoInfo] - Display for attached GitHub repo
 * @property {HTMLElement} [kbAttachedRepoUrlDisplay] - Span for attached repo URL
 * @property {HTMLElement} [kbAttachedRepoBranchDisplay] - Span for attached repo branch
 * @property {HTMLElement} [kbDetachRepoBtn] - Button to detach GitHub repo
 * @property {HTMLElement} [kbGitHubAttachForm] - Form section for attaching GitHub repo
 * @property {HTMLElement} [kbGitHubRepoUrlInput] - Input for GitHub repo URL
 * @property {HTMLElement} [kbGitHubBranchInput] - Input for GitHub branch
 * @property {HTMLElement} [kbGitHubFilePathsTextarea] - Textarea for specific file paths
 * @property {HTMLElement} [kbAttachRepoBtn] - Button to attach GitHub repo
 *
 * @typedef {Object} Config
 * @property {number} [maxConcurrentProcesses=3] - Max concurrent operations
 * @property {number} [searchDebounceTime=300] - Search debounce delay
 * @property {number} [minQueryLength=2] - Minimum search query length
 * @property {number} [maxQueryLength=500] - Maximum search query length
 *
 * @typedef {Object} FileInfo
 * @property {string} id - File UUID
 * @property {string} filename
 * @property {string} file_type
 * @property {number} file_size
 * @property {string} created_at
 * @property {Object} [config] - File configuration, including search_processing status
 *
 * @typedef {Object} SearchResult
 * @property {FileInfo} file_info
 * @property {Object} metadata
 * @property {number} score
 * @property {string} text
 *
 * @typedef {Object} KnowledgeBaseData
 * @property {string} id
 * @property {string} name
 * @property {string} embedding_model
 * @property {number} version
 * @property {string} last_used
 * @property {boolean} is_active
 * @property {Object} stats
 * @property {number} stats.file_count
 * @property {number} stats.chunk_count
 * @property {number} stats.unprocessed_files
 * @property {number} embedding_dimension
 * @property {string} [repo_url] - Attached GitHub repository URL
 * @property {string} [branch] - Branch of the attached GitHub repository
 * @property {string[]} [file_paths] - Specific file paths from the attached GitHub repository
 */
import { createKnowledgeBaseSearchHandler } from './knowledgeBaseSearchHandler.js';
import { createKnowledgeBaseManager } from './knowledgeBaseManager.js';

/**
 * Factory function to create a KnowledgeBaseComponent instance
 * @param {Object} [options={}] - Configuration options and dependencies
 * @param {Dependencies} options - DI dependencies
 * @param {ElRefs} [options.elRefs] - Pre-injected DOM elements
 * @param {Config} [options.config] - Override default configuration
 * @returns {KnowledgeBaseComponent} Initialized component instance
 * @throws {Error} If required dependencies are missing
 * @example
 * import createKnowledgeBaseComponent from './knowledgeBaseComponent';
 * const kb = createKnowledgeBaseComponent({ DependencySystem, app, projectManager, eventHandlers, uiUtils, modalManager, sanitizer, notify });
 * kb.initialize(true);
 */
const MODULE = "KnowledgeBaseComponent";
export function createKnowledgeBaseComponent(options = {}) {
  // ------------------------------------------------------------------
  // Dependency resolution (strictly from options or DS, no window.*)
  // ------------------------------------------------------------------
  if (!options.DependencySystem) {
    throw new Error("DependencySystem is required for KnowledgeBaseComponent");
  }
  const DS = options.DependencySystem;
  const getDep = (name) =>
    name in options ? options[name] : DS.modules.get(name);

  const sanitizer = getDep("sanitizer");
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') {
    throw new Error("KnowledgeBaseComponent requires 'sanitizer' (object with .sanitize) for HTML sanitization.");
  }
  const notifyDep = getDep("notify");
  if (!notifyDep) throw new Error(`${MODULE} requires 'notify' dependency`);

  /**
   * Safely set element innerHTML, using DI sanitizer.
   * @param {HTMLElement} el
   * @param {string} html
   */
  function _safeSetInnerHTML(el, html) {
    if (!el) return;
    el.innerHTML = sanitizer.sanitize(html);
  }

  // Required dependencies
  const app = getDep("app");
  const projectManager = getDep("projectManager");
  const eventHandlers = getDep("eventHandlers");
  const uiUtils = getDep("uiUtils") || getDep("uiUtilsInstance"); // Fallback for uiUtilsInstance
  const modalManager = getDep("modalManager");

  if (!app || !projectManager || !eventHandlers || !uiUtils || !modalManager) {
    throw new Error(
      "KnowledgeBaseComponent requires 'app', 'projectManager', 'eventHandlers', 'uiUtils', and 'modalManager' dependencies.",
    );
  }

  const validateUUID = app.validateUUID;
  const apiRequest = app.apiRequest;

  const config = {
    maxConcurrentProcesses: options.maxConcurrentProcesses || 3,
    searchDebounceTime: options.searchDebounceTime || 300,
    minQueryLength: options.minQueryLength || 2,
    maxQueryLength: options.maxQueryLength || 500,
  };

  /**
   * Main KnowledgeBase Component class.
   * @class KnowledgeBaseComponent
   */
  class KnowledgeBaseComponent {
    /**
     * Create KnowledgeBaseComponent instance
     * @param {ElRefs} [elRefs={}] - Pre-injected DOM element references
     */
    constructor(elRefs = {}) {
      this.app = app;
      this.projectManager = projectManager;
      this.eventHandlers = eventHandlers;
      this.uiUtils = uiUtils;
      this.apiRequest = apiRequest;
      this.validateUUID = validateUUID;
      this.config = config;
      this.modalManager = modalManager;
      this.getDep = getDep; // Expose getDep for sub-modules if they need it directly

      this.notify = notifyDep.withContext({ context: "knowledgeBaseComponent", module: MODULE });
      this._notify = (type, msg, extra = {}) =>
        (this.notify[type] || this.notify.info)(msg, { group: true, source: extra.source || MODULE });

      this._setButtonLoading = function(btn, isLoading, loadingText = "Saving...") {
        if (!btn) return;
        if (isLoading) {
          btn.disabled = true;
          btn.dataset.originalText = btn.textContent;
          _safeSetInnerHTML(btn, `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`);
        } else {
          btn.disabled = false;
          if (btn.dataset.originalText) {
            btn.textContent = btn.dataset.originalText;
            delete btn.dataset.originalText;
          }
        }
      };
      this._safeSetInnerHTML = _safeSetInnerHTML; // Make it available to sub-modules via this context

      this.elements = {
        container: elRefs.container || document.getElementById("knowledgeTab"),
        activeSection: elRefs.activeSection || document.getElementById("knowledgeBaseActive"),
        inactiveSection: elRefs.inactiveSection || document.getElementById("knowledgeBaseInactive"),
        statusBadge: elRefs.statusBadge || document.getElementById("kbStatusBadge"),
        searchInput: elRefs.searchInput || document.getElementById("knowledgeSearchInput"),
        searchButton: elRefs.searchButton || document.getElementById("runKnowledgeSearchBtn"),
        resultsContainer: elRefs.resultsContainer || document.getElementById("knowledgeResultsList"),
        resultsSection: elRefs.resultsSection || document.getElementById("knowledgeSearchResults"),
        noResultsSection: elRefs.noResultsSection || document.getElementById("knowledgeNoResults"),
        topKSelect: elRefs.topKSelect || document.getElementById("knowledgeTopK"),
        kbToggle: elRefs.kbToggle || document.getElementById("knowledgeBaseEnabled"),
        reprocessButton: elRefs.reprocessButton || document.getElementById("reprocessFilesBtn"),
        setupButton: elRefs.setupButton || document.getElementById("setupKnowledgeBaseBtn"),
        settingsButton: elRefs.settingsButton || document.getElementById("knowledgeBaseSettingsBtn"),
        kbNameDisplay: elRefs.kbNameDisplay || document.getElementById("knowledgeBaseName"),
        kbModelDisplay: elRefs.kbModelDisplay || document.getElementById("knowledgeBaseModelDisplay"),
        kbVersionDisplay: elRefs.kbVersionDisplay || document.getElementById("knowledgeBaseVersionDisplay"),
        kbLastUsedDisplay: elRefs.kbLastUsedDisplay || document.getElementById("knowledgeBaseLastUsedDisplay"),
        settingsModal: elRefs.settingsModal || document.getElementById("knowledgeBaseSettingsModal"),
        settingsForm: elRefs.settingsForm || document.getElementById("knowledgeBaseForm"),
        cancelSettingsBtn: elRefs.cancelSettingsBtn || document.getElementById("cancelKnowledgeBaseFormBtn"),
        deleteKnowledgeBaseBtn: elRefs.deleteKnowledgeBaseBtn || document.getElementById("deleteKnowledgeBaseBtn"),
        modelSelect: elRefs.modelSelect || document.getElementById("knowledgeBaseModelSelect"),
        resultModal: elRefs.resultModal || document.getElementById("knowledgeResultModal"),
        resultTitle: elRefs.resultTitle || document.getElementById("knowledgeResultTitle"),
        resultSource: elRefs.resultSource || document.getElementById("knowledgeResultSource"),
        resultScore: elRefs.resultScore || document.getElementById("knowledgeResultScore"),
        resultContent: elRefs.resultContent || document.getElementById("knowledgeResultContent"),
        useInChatBtn: elRefs.useInChatBtn || document.getElementById("useInChatBtn"),
        knowledgeBaseFilesSection: elRefs.knowledgeBaseFilesSection || document.getElementById("knowledgeBaseFilesSection"),
        knowledgeBaseFilesListContainer: elRefs.knowledgeBaseFilesListContainer || document.getElementById("knowledgeBaseFilesListContainer"),
        kbGitHubAttachedRepoInfo: elRefs.kbGitHubAttachedRepoInfo || document.getElementById("kbGitHubAttachedRepoInfo"),
        kbAttachedRepoUrlDisplay: elRefs.kbAttachedRepoUrlDisplay || document.getElementById("kbAttachedRepoUrlDisplay"),
        kbAttachedRepoBranchDisplay: elRefs.kbAttachedRepoBranchDisplay || document.getElementById("kbAttachedRepoBranchDisplay"),
        kbDetachRepoBtn: elRefs.kbDetachRepoBtn || document.getElementById("kbDetachRepoBtn"),
        kbGitHubAttachForm: elRefs.kbGitHubAttachForm || document.getElementById("kbGitHubAttachForm"),
        kbGitHubRepoUrlInput: elRefs.kbGitHubRepoUrlInput || document.getElementById("kbGitHubRepoUrlInput"),
        kbGitHubBranchInput: elRefs.kbGitHubBranchInput || document.getElementById("kbGitHubBranchInput"),
        kbGitHubFilePathsTextarea: elRefs.kbGitHubFilePathsTextarea || document.getElementById("kbGitHubFilePathsTextarea"),
        kbAttachRepoBtn: elRefs.kbAttachRepoBtn || document.getElementById("kbAttachRepoBtn"),
      };

      this.state = {
        knowledgeBase: null,
        isSearching: false,
        searchCache: new Map(),
        fileProcessingQueue: [],
        activeProcesses: 0,
        lastHealthCheck: null,
        authState: null,
        isInitialized: false,
      };

      this.formatBytes = uiUtils.formatBytes;
      this.formatDate = uiUtils.formatDate;
      this.fileIcon = uiUtils.fileIcon;

      this.scheduler = getDep("scheduler") || { setTimeout, clearTimeout };

      // Instantiate sub-modules, passing `this` as context
      this.searchHandler = createKnowledgeBaseSearchHandler(this);
      this.manager = createKnowledgeBaseManager(this);

      this._bindEventHandlers();
    }

    /**
     * Initialize component (load data and toggle visibility)
     * @param {boolean} isVisible - Whether the KB tab is visible
     * @param {KnowledgeBaseData|null} [kbData=null] - Initial KB data
     * @param {string|null} [projectId=null] - Project UUID override
     * @returns {Promise<void>}
     */
    async initialize(isVisible, kbData = null, projectId = null) {
      this.notify.info(`Initializing, isVisible: ${isVisible}, projectId: ${projectId}`, { source: "initialize" });

      if (this.state.isInitialized && !isVisible) {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
        return;
      }

      const requiredIds = ["knowledgeTab", "knowledgeBaseActive", "knowledgeBaseInactive", "kbStatusBadge"];
      let hasMissingElements = false;
      for (const id of requiredIds) {
        if (!document.getElementById(id)) {
          this._notify('warning', `Required element missing: #${id}`, { source: "initialize" });
          hasMissingElements = true;
        }
      }

      if (hasMissingElements) {
        this._notify('error', "Some critical elements are missing, but continuing initialization", { source: "initialize" });
        const fallbackProjectId = projectId || this._getCurrentProjectId() || null;
        document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId: fallbackProjectId } }));
        return;
      }

      this.state.isInitialized = true;
      if (isVisible) this._validateDOM();

      if (kbData) {
        await this.renderKnowledgeBaseInfo(kbData, projectId);
      } else {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
        if (projectId) {
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId } }));
        }
      }

      this.elements.container?.classList.toggle("hidden", !isVisible);
      this.elements.container?.classList.toggle("pointer-events-none", !isVisible);

      this.notify.info(`Initialization complete for projectId: ${projectId}`, { source: "initialize" });
      const doc = typeof document !== "undefined" ? document : null;
      if (doc) doc.dispatchEvent(new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: true } }));
    }

    /**
     * Bind UI events via eventHandlers
     * @private
     */
    _bindEventHandlers() {
      this._boundListeners = this._boundListeners || [];
      const EH = this.eventHandlers;
      const addListener = (el, type, fn, opts) => {
        if (el) {
          const handler = EH.trackListener(el, type, fn, opts);
          this._boundListeners.push({ el, type, handler, opts });
        }
      };

      // Search related events delegated to searchHandler
      addListener(this.elements.searchButton, "click", () => this.searchHandler.triggerSearch());
      addListener(this.elements.searchInput, "input", (e) => this.searchHandler.debouncedSearch(e.target.value));
      addListener(this.elements.searchInput, "keyup", (e) => { if (e.key === "Enter") this.searchHandler.triggerSearch(); });
      addListener(this.elements.resultModal, "keydown", (e) => this.searchHandler.handleResultModalKeydown(e));


      // Management related events delegated to manager
      addListener(this.elements.kbToggle, "change", (e) => this.manager.toggleKnowledgeBase(e.target.checked));
      addListener(this.elements.reprocessButton, "click", () => {
        const pid = this._getCurrentProjectId();
        if (pid) this.manager.reprocessFiles(pid);
      });
      addListener(this.elements.setupButton, "click", () => this.manager.showKnowledgeBaseModal());
      addListener(this.elements.settingsButton, "click", () => this.manager.showKnowledgeBaseModal());
      addListener(this.elements.settingsForm, "submit", (e) => this.manager.handleKnowledgeBaseFormSubmit(e));
      addListener(this.elements.cancelSettingsBtn, "click", () => this.manager.hideKnowledgeBaseModal());
      addListener(this.elements.deleteKnowledgeBaseBtn, "click", () => this.manager.handleDeleteKnowledgeBase());
      addListener(this.elements.modelSelect, "change", () => this.manager.validateSelectedModelDimensions());

      // GitHub integration listeners delegated to manager
      addListener(this.elements.kbAttachRepoBtn, "click", () => this.manager.handleAttachGitHubRepo());
      addListener(this.elements.kbDetachRepoBtn, "click", () => this.manager.handleDetachGitHubRepo());

      // Auth state change
      addListener(document, "authStateChanged", (e) => {
        this._handleAuthStateChange(e.detail?.authenticated);
      });
    }

    /**
     * Get current project UUID
     * @private
     * @returns {string|null}
     */
    _getCurrentProjectId() {
      if (typeof this.app.getProjectId === "function") {
        const pid = this.app.getProjectId();
        if (this.validateUUID(pid)) return pid;
      }
      const cur = this.projectManager.currentProject;
      if (cur?.id && this.validateUUID(cur.id)) {
        return cur.id;
      }
      this.notify.warning("Could not determine current project ID.", {source: "_getCurrentProjectId"});
      return null;
    }

    /**
     * Validate presence of required DOM elements
     * @private
     */
    _validateDOM() {
      const requiredIds = ["knowledgeTab", "knowledgeBaseActive", "knowledgeBaseInactive", "kbStatusBadge"];
      requiredIds.forEach((id) => {
        if (!document.getElementById(id)) {
          this._notify("error", `Critical Knowledge Base UI element missing: #${id}. Please contact support.`, { source: "_validateDOM" });
          throw new Error(`[KnowledgeBaseComponent] Required element missing: #${id}`);
        }
      });
    }

    /**
     * Render the knowledge base info UI
     * @param {KnowledgeBaseData} kbData
     * @param {string|null} [projectId=null]
     * @returns {Promise<void>}
     */
    async renderKnowledgeBaseInfo(kbData, projectId = null) {
      this.notify.info(`Rendering KB info for projectId: ${projectId}`, { source: "renderKnowledgeBaseInfo" });

      if (!kbData) {
        this._showInactiveState();
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
        if (projectId) {
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId } }));
        }
        return;
      }

      this.state.knowledgeBase = kbData;
      const pid = projectId || kbData.project_id || this._getCurrentProjectId();
      if (this.elements.activeSection) {
        this.elements.activeSection.dataset.projectId = pid || "";
      }

      this._updateBasicInfo(kbData);
      this.manager._updateModelSelection(kbData.embedding_model); // Use manager's method
      this._updateStatusIndicator(kbData.is_active !== false);

      this.elements.activeSection?.classList.remove("hidden");
      this.elements.inactiveSection?.classList.add("hidden");
      if (this.elements.kbToggle) {
        this.elements.kbToggle.checked = kbData.is_active !== false;
      }

      try {
        if (kbData.is_active !== false && kbData.id) {
          this.manager.loadKnowledgeBaseHealth(kbData.id)
            .catch((err) => this.notify.warning("Failed to load KB health", { source: "renderKnowledgeBaseInfo", originalError: err }));
          this.manager.loadKnowledgeBaseFiles(pid, kbData.id);
        } else {
            this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
            // Call manager's internal render files with empty data if it exists, or handle here
            if (this.manager._renderKnowledgeBaseFiles) {
                 this.manager._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
            } else {
                 const container = this.elements.knowledgeBaseFilesListContainer;
                 if (container) _safeSetInnerHTML(container, '<p class="text-base-content/60 text-center py-4">No files currently in the Knowledge Base.</p>');
            }
        }
        this._updateStatusAlerts(kbData);
        this._updateUploadButtonsState();

        if (pid) {
          this.notify.info(`Emitting projectKnowledgeBaseRendered for projectId: ${pid}`, { source: "renderKnowledgeBaseInfo" });
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId: pid } }));
        }
      } catch (err) {
        this.notify.error("Error while rendering KB info", { source: "renderKnowledgeBaseInfo", originalError: err });
        if (pid) {
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId: pid } }));
        }
      }
    }

    /**
     * Update basic info displays
     * @param {KnowledgeBaseData} kb
     * @private
     */
    _updateBasicInfo(kb) {
      const { kbNameDisplay, kbModelDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;
      if (kbNameDisplay) kbNameDisplay.textContent = kb.name || "Project Knowledge Base";
      if (kbModelDisplay) kbModelDisplay.textContent = kb.embedding_model || "Not Set";
      if (kbVersionDisplay) kbVersionDisplay.textContent = kb.version ? `v${kb.version}` : "v1";
      if (kbLastUsedDisplay) kbLastUsedDisplay.textContent = kb.last_used ? this.formatDate(kb.last_used) : "Never used";
    }

    /**
     * Update the status badge indicator
     * @param {boolean} isActive
     * @private
     */
    _updateStatusIndicator(isActive) {
      const badge = this.elements.statusBadge;
      if (!badge) return;
      badge.className = `badge ${isActive ? "badge-success" : "badge-warning"} badge-sm`;
      badge.textContent = isActive ? "Active" : "Inactive";
    }

    /**
     * Show inactive state UI
     * @private
     */
    _showInactiveState() {
      this.state.knowledgeBase = null;
      this.elements.activeSection?.classList.add("hidden");
      this.elements.inactiveSection?.classList.remove("hidden");
      this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
      // Clear file list via manager or directly
      if (this.manager?._renderKnowledgeBaseFiles) {
        this.manager._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
      } else if (this.elements.knowledgeBaseFilesListContainer) {
        _safeSetInnerHTML(this.elements.knowledgeBaseFilesListContainer, '<p class="text-base-content/60 text-center py-4">No files currently in the Knowledge Base.</p>');
      }
      this._updateStatusIndicator(false);
      this._showStatusAlert("Knowledge Base needed. Click 'Setup'.", "info");
      this._updateUploadButtonsState();
    }

    /**
     * Update upload/reprocess button states based on KB status
     * @private
     */
    _updateUploadButtonsState() {
      const hasKB = !!this.state.knowledgeBase;
      const isActive = hasKB && this.state.knowledgeBase.is_active !== false;

      const kbDependentEls = document.querySelectorAll("[data-requires-kb='true']");
      kbDependentEls.forEach((el) => {
        const disabled = !hasKB || !isActive;
        el.disabled = disabled;
        el.classList.toggle("opacity-50", disabled);
        el.classList.toggle("cursor-not-allowed", disabled);
        el.title = disabled ? (!hasKB ? "Setup Knowledge Base first." : "Knowledge Base must be active.") : "Ready to use Knowledge Base features.";
      });

      if (this.elements.reprocessButton) {
        const fileCountEl = document.getElementById("knowledgeFileCount"); // Assuming this element exists and is updated
        const fileCount = parseInt(fileCountEl?.textContent || "0", 10);
        const reDisabled = !hasKB || !isActive || fileCount === 0;

        this.elements.reprocessButton.disabled = reDisabled;
        this.elements.reprocessButton.classList.toggle("opacity-50", reDisabled);
        this.elements.reprocessButton.classList.toggle("cursor-not-allowed", reDisabled);
        this.elements.reprocessButton.title = !hasKB ? "Setup Knowledge Base first." : !isActive ? "Knowledge Base must be active." : fileCount === 0 ? "No files to reprocess." : "Reprocess files.";
      }
    }

    /**
     * Update status alerts based on KB stats
     * @param {KnowledgeBaseData} kb
     * @private
     */
    _updateStatusAlerts(kb) {
      if (kb.is_active !== false) {
        if (kb.stats.file_count === 0) {
          this._notify("warning", "Knowledge Base is empty. Upload files via 'Files' tab.", { source: "_updateStatusAlerts" });
        } else if (kb.stats.file_count > 0 && kb.stats.chunk_count === 0 && kb.stats.unprocessed_files > 0) {
          this._notify("warning", "Files need processing. Click 'Reprocess Files'.", { source: "_updateStatusAlerts" });
        } else if (kb.stats.unprocessed_files > 0) {
          this._notify("info", `${kb.stats.unprocessed_files} file(s) need processing.`, { source: "_updateStatusAlerts" });
        }
      } else {
        this._notify("warning", "Knowledge Base is disabled. Enable it to use search.", { source: "_updateStatusAlerts" });
      }
    }

    /**
     * Show status alert in UI
     * @param {string} message
     * @param {'info'|'success'|'warning'|'error'} [type='info']
     * @private
     */
    _showStatusAlert(message, type = "info") {
      const statusIndicator = document.getElementById("kbStatusIndicator"); // Assuming this element exists for general alerts
      if (!statusIndicator) {
        this._notify(type, message, { source: "_showStatusAlert" }); // Fallback to general notify
        return;
      }
      statusIndicator.textContent = ""; // Clear previous alerts
      let cls = "alert-info";
      if (type === "success") cls = "alert-success";
      else if (type === "warning") cls = "alert-warning";
      else if (type === "error") cls = "alert-error";

      const alertDiv = document.createElement("div");
      alertDiv.className = `alert ${cls} shadow-xs text-sm py-2 px-3`;
      alertDiv.setAttribute("role", "alert");
      _safeSetInnerHTML(alertDiv, `<span>${message}</span>`);

      if (type !== "error") { // Add close button for non-error alerts
        const btn = document.createElement("button");
        btn.className = "btn btn-xs btn-ghost btn-circle";
        btn.textContent = "✕";
        btn.onclick = () => alertDiv.remove();
        alertDiv.appendChild(btn);
      }
      statusIndicator.appendChild(alertDiv);
    }

    /**
     * Debounce helper
     * @param {Function} fn
     * @param {number} wait - milliseconds
     * @returns {Function}
     * @private
     */
    _debounce(fn, wait) {
      let id;
      return (...a) => {
        this.scheduler.clearTimeout?.(id);
        id = this.scheduler.setTimeout?.(() => fn.apply(this, a), wait);
      };
    }

    /**
     * Handle authentication state changes
     * @param {boolean} authenticated
     * @private
     */
    _handleAuthStateChange(authenticated) {
      this.state.authState = authenticated;
      const items = [
        this.elements.searchButton, this.elements.reprocessButton, this.elements.setupButton,
        this.elements.kbToggle, this.elements.settingsButton, this.elements.deleteKnowledgeBaseBtn,
        this.elements.kbAttachRepoBtn, this.elements.kbDetachRepoBtn,
      ];
      items.forEach((el) => {
        if (!el) return;
        el.disabled = !authenticated;
        el.classList.toggle("opacity-50", !authenticated);
        el.classList.toggle("cursor-not-allowed", !authenticated);
      });
      if (!authenticated) {
        this._showStatusAlert("Authentication required", "warning");
      }
    }
  } // end class

  class KnowledgeBaseComponentWithDestroy extends KnowledgeBaseComponent {
    destroy() {
      if (this._boundListeners) {
        for (const { el, type, handler, opts } of this._boundListeners) {
          if (el && handler) {
            el.removeEventListener(type, handler, opts);
          }
        }
        this._boundListeners = [];
      }
      this.state.isInitialized = false;
      this.notify.info("KnowledgeBaseComponent destroyed.", { source: "destroy" });
    }
  }

  return new KnowledgeBaseComponentWithDestroy(options.elRefs);
}
