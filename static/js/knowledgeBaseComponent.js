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
 * const kb = createKnowledgeBaseComponent({ DependencySystem, app, projectManager, eventHandlers, uiUtils, modalManager });
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
    // Strictly require via options, else from DependencySystem (never window.*)
    name in options ? options[name] : DS.modules.get(name);
  // DI sanitizer for innerHTML (must provide .sanitize)
  const sanitizer = getDep("sanitizer");
  if (!sanitizer || typeof sanitizer.sanitize !== 'function') {
    throw new Error("KnowledgeBaseComponent requires 'sanitizer' (object with .sanitize) for HTML sanitization.");
  }
  const notify = getDep("notify");
  if (!notify) throw new Error(`${MODULE} requires 'notify' dependency`);

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
  const uiUtils = getDep("uiUtils") || getDep("uiUtilsInstance");
  const modalManager = getDep("modalManager"); // For confirmation dialog

  if (!app || !projectManager || !eventHandlers || !uiUtils || !modalManager) {
    throw new Error(
      "KnowledgeBaseComponent requires 'app', 'projectManager', 'eventHandlers', 'uiUtils', and 'modalManager' dependencies.",
    );
  }

  // Extract needed methods from `app`
  const validateUUID = app.validateUUID;
  const apiRequest = app.apiRequest;

  // Configuration handling
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
      // --------------------------------------------------------------
      // Store injected references
      // --------------------------------------------------------------
      this.app = app;
      this.projectManager = projectManager;
      this.eventHandlers = eventHandlers;
      this.uiUtils = uiUtils;
      this.apiRequest = apiRequest;
      this.validateUUID = validateUUID;
      this.config = config;
      this.modalManager = modalManager;

      // --------------------------------------------------------------
      // DRY helpers for loading state and notification fallback
      // --------------------------------------------------------------
      this.notify = notify.withContext({ context: "knowledgeBaseComponent", module: MODULE });
      this._notify = (type, msg, extra = {}) =>
        (this.notify[type] || this.notify.info)(msg, { group: true, source: extra.source || "" });

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

      // --------------------------------------------------------------
      // DOM Element References
      // All elements are either injected or looked up by ID
      // --------------------------------------------------------------
      this.elements = {
        container: elRefs.container || document.getElementById("knowledgeTab"),
        activeSection:
          elRefs.activeSection ||
          document.getElementById("knowledgeBaseActive"),
        inactiveSection:
          elRefs.inactiveSection ||
          document.getElementById("knowledgeBaseInactive"),
        statusBadge:
          elRefs.statusBadge || document.getElementById("kbStatusBadge"),

        searchInput:
          elRefs.searchInput || document.getElementById("knowledgeSearchInput"),
        searchButton:
          elRefs.searchButton ||
          document.getElementById("runKnowledgeSearchBtn"),
        resultsContainer:
          elRefs.resultsContainer ||
          document.getElementById("knowledgeResultsList"),
        resultsSection:
          elRefs.resultsSection ||
          document.getElementById("knowledgeSearchResults"),
        noResultsSection:
          elRefs.noResultsSection ||
          document.getElementById("knowledgeNoResults"),
        topKSelect:
          elRefs.topKSelect || document.getElementById("knowledgeTopK"),

        kbToggle:
          elRefs.kbToggle || document.getElementById("knowledgeBaseEnabled"),
        reprocessButton:
          elRefs.reprocessButton ||
          document.getElementById("reprocessFilesBtn"),
        setupButton:
          elRefs.setupButton ||
          document.getElementById("setupKnowledgeBaseBtn"),
        settingsButton:
          elRefs.settingsButton ||
          document.getElementById("knowledgeBaseSettingsBtn"),

        kbNameDisplay:
          elRefs.kbNameDisplay || document.getElementById("knowledgeBaseName"),
        kbModelDisplay:
          elRefs.kbModelDisplay ||
          document.getElementById("knowledgeBaseModelDisplay"),
        kbVersionDisplay:
          elRefs.kbVersionDisplay ||
          document.getElementById("knowledgeBaseVersionDisplay"),
        kbLastUsedDisplay:
          elRefs.kbLastUsedDisplay ||
          document.getElementById("knowledgeBaseLastUsedDisplay"),

        settingsModal:
          elRefs.settingsModal ||
          document.getElementById("knowledgeBaseSettingsModal"),
        settingsForm:
          elRefs.settingsForm || document.getElementById("knowledgeBaseForm"),
        cancelSettingsBtn:
          elRefs.cancelSettingsBtn ||
          document.getElementById("cancelKnowledgeBaseFormBtn"),
        deleteKnowledgeBaseBtn:
          elRefs.deleteKnowledgeBaseBtn ||
          document.getElementById("deleteKnowledgeBaseBtn"),
        modelSelect:
          elRefs.modelSelect ||
          document.getElementById("knowledgeBaseModelSelect"),

        resultModal:
          elRefs.resultModal || document.getElementById("knowledgeResultModal"),
        resultTitle:
          elRefs.resultTitle || document.getElementById("knowledgeResultTitle"),
        resultSource:
          elRefs.resultSource ||
          document.getElementById("knowledgeResultSource"),
        resultScore:
          elRefs.resultScore || document.getElementById("knowledgeResultScore"),
        resultContent:
          elRefs.resultContent ||
          document.getElementById("knowledgeResultContent"),
        useInChatBtn:
          elRefs.useInChatBtn || document.getElementById("useInChatBtn"),
        knowledgeBaseFilesSection:
          elRefs.knowledgeBaseFilesSection ||
          document.getElementById("knowledgeBaseFilesSection"),
        knowledgeBaseFilesListContainer:
          elRefs.knowledgeBaseFilesListContainer ||
          document.getElementById("knowledgeBaseFilesListContainer"),
        // GitHub Integration Elements
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

      // --------------------------------------------------------------
      // Internal State Management
      // --------------------------------------------------------------
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

      // --------------------------------------------------------------
      // Utility Bindings from UI Utils
      // --------------------------------------------------------------
      this.formatBytes = uiUtils.formatBytes;
      this.formatDate = uiUtils.formatDate;
      this.fileIcon = uiUtils.fileIcon;

      // --------------------------------------------------------------
      // Debounced Search Setup
      // --------------------------------------------------------------
      this.scheduler = getDep("scheduler") || { setTimeout, clearTimeout };
      this.debouncedSearch = this._debounce(
        this.searchKnowledgeBase.bind(this),
        this.config.searchDebounceTime,
      );

      // --------------------------------------------------------------
      // Initialize Event Handlers
      // Uses eventHandlers.trackListener for consistent management
      // --------------------------------------------------------------
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
      this.notify.info("[KnowledgeBaseComponent] initialize() called", {
        group: true, context: "knowledgeBaseComponent", module: MODULE, source: "initialize"
      });
      this._notify('info', `[KnowledgeBaseComponent] Initializing, isVisible: ${isVisible}, projectId: ${projectId}`);

      // Fast path for hiding
      if (this.state.isInitialized && !isVisible) {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden"); // Hide files section too
        return;
      }

      // Check for critical elements but don't throw errors
      // Instead, emit the rendered event so the UI can continue loading
      const requiredIds = [
        "knowledgeTab",
        "knowledgeBaseActive",
        "knowledgeBaseInactive",
        "kbStatusBadge"
      ];

      let hasMissingElements = false;
      for (const id of requiredIds) {
        if (!document.getElementById(id)) {
          this._notify('warning', `[KnowledgeBaseComponent] Required element missing: #${id}`);
          hasMissingElements = true;
        }
      }

      if (hasMissingElements) {
        // Don't throw an error, just log it and continue
        this._notify('error', "[KnowledgeBaseComponent] Some critical elements are missing, but continuing initialization");

        // Ensure projectId is always set for event, fallback to _getCurrentProjectId() if needed
        const fallbackProjectId = projectId || this._getCurrentProjectId() || null;
        if (fallbackProjectId) {
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', {
            detail: { projectId: fallbackProjectId }
          }));
        } else {
          // Still emit event with null/undefined as projectId to unblock promises downstream
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', {
            detail: { projectId: null }
          }));
        }

        return;
      }

      this.state.isInitialized = true;
      if (isVisible) {
        this._validateDOM();
      }

      if (kbData) {
        await this.renderKnowledgeBaseInfo(kbData, projectId);
      } else {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden");


        // Always emit the rendered event, even if we don't have data
        if (projectId) {
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', {
            detail: { projectId }
          }));
        }
      }

      this.elements.container?.classList.toggle("hidden", !isVisible);
      this.elements.container?.classList.toggle(
        "pointer-events-none",
        !isVisible,
      );

      this._notify('info', `[KnowledgeBaseComponent] Initialization complete for projectId: ${projectId}`);

      // --- Standardized "knowledgebasecomponent:initialized" event ---
      const doc = typeof document !== "undefined" ? document : null;
      if (doc) doc.dispatchEvent(new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: true } }));

    }

    /**
     * Bind UI events via eventHandlers
     * @private
     */
    _bindEventHandlers() {
      // Track all listeners for cleanup
      this._boundListeners = this._boundListeners || [];
      const EH = this.eventHandlers;

      const addListener = (el, type, fn, opts) => {
        if (el) {
          const handler = EH.trackListener(el, type, fn, opts);
          this._boundListeners.push({ el, type, handler, opts });
        }
      };

      addListener(this.elements.searchButton, "click", () => this._triggerSearch());
      addListener(this.elements.searchInput, "input", (e) => this.debouncedSearch(e.target.value));
      addListener(this.elements.searchInput, "keyup", (e) => { if (e.key === "Enter") this._triggerSearch(); });
      addListener(this.elements.kbToggle, "change", (e) => this.toggleKnowledgeBase(e.target.checked));
      addListener(this.elements.reprocessButton, "click", () => {
        const pid = this._getCurrentProjectId();
        if (pid) this.reprocessFiles(pid);
      });
      addListener(this.elements.setupButton, "click", () => this._showKnowledgeBaseModal());
      addListener(this.elements.settingsButton, "click", () => this._showKnowledgeBaseModal());
      addListener(this.elements.settingsForm, "submit", (e) => this._handleKnowledgeBaseFormSubmit(e));
      addListener(this.elements.cancelSettingsBtn, "click", () => this._hideKnowledgeBaseModal());
      addListener(this.elements.deleteKnowledgeBaseBtn, "click", () => this._handleDeleteKnowledgeBase());
      addListener(this.elements.modelSelect, "change", () => this._validateSelectedModelDimensions());
      addListener(this.elements.resultModal, "keydown", (e) => {
        if (e.key === "Escape") this._hideResultDetailModal();
      });
      addListener(document, "authStateChanged", (e) => {
        this._handleAuthStateChange(e.detail?.authenticated);
      });
      // GitHub integration listeners
      addListener(this.elements.kbAttachRepoBtn, "click", () => this._handleAttachGitHubRepo());
      addListener(this.elements.kbDetachRepoBtn, "click", () => this._handleDetachGitHubRepo());
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
      return null;
    }

    /**
     * Validate presence of required DOM elements
     * @private
     */
    _validateDOM() {
      const requiredIds = [
        "knowledgeTab",
        "knowledgeBaseActive",
        "knowledgeBaseInactive",
        "kbStatusBadge",
      ];
      requiredIds.forEach((id) => {
        if (!document.getElementById(id)) {
          this._notify(
            "error",
            `Critical Knowledge Base UI element missing: #${id}. Please contact support.`
          );
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
      this._notify('info', `[KnowledgeBaseComponent] Rendering KB info for projectId: ${projectId}`);

      if (!kbData) {
        this._showInactiveState();
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden");


        // Always emit rendered event even if no KB data
        if (projectId) {
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', {
            detail: { projectId }
          }));
        }
        return;
      }

      this.state.knowledgeBase = kbData;
      const pid = projectId || kbData.project_id || this._getCurrentProjectId();
      if (this.elements.activeSection) {
        this.elements.activeSection.dataset.projectId = pid || "";
      }

      this._updateBasicInfo(kbData);
      this._updateModelSelection(kbData.embedding_model);
      this._updateStatusIndicator(kbData.is_active !== false);

      this.elements.activeSection?.classList.remove("hidden");
      this.elements.inactiveSection?.classList.add("hidden");
      if (this.elements.kbToggle) {
        this.elements.kbToggle.checked = kbData.is_active !== false;
      }

      try {
        if (kbData.is_active !== false && kbData.id) {
          this._loadKnowledgeBaseHealth(kbData.id)
            .catch(() => this._notify("warning", "Failed to load KB health"));
          this._loadKnowledgeBaseFiles(pid, kbData.id); // Load files if KB is active
        } else {
            this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
            this._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } }); // Clear list if not active
        }


        this._updateStatusAlerts(kbData);
        this._updateUploadButtonsState();

        // Emit rendered event now that the core rendering is done
        if (pid) {
          this._notify('info', `[KnowledgeBaseComponent] Emitting projectKnowledgeBaseRendered for projectId: ${pid}`);
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', {
            detail: { projectId: pid }
          }));
        }
      } catch {
        this._notify("error", "Error while rendering KB info");

        // Emit rendered event even if there was an error
        if (pid) {
          document.dispatchEvent(new CustomEvent('projectKnowledgeBaseRendered', {
            detail: { projectId: pid }
          }));
        }
      }
    }

    /**
     * Update basic info displays
     * @param {KnowledgeBaseData} kb
     * @private
     */
    _updateBasicInfo(kb) {
      const {
        kbNameDisplay,
        kbModelDisplay,
        kbVersionDisplay,
        kbLastUsedDisplay,
      } = this.elements;
      if (kbNameDisplay) {
        kbNameDisplay.textContent = kb.name || "Project Knowledge Base";
      }
      if (kbModelDisplay) {
        kbModelDisplay.textContent = kb.embedding_model || "Not Set";
      }
      if (kbVersionDisplay) {
        kbVersionDisplay.textContent = kb.version ? `v${kb.version}` : "v1";
      }
      if (kbLastUsedDisplay) {
        kbLastUsedDisplay.textContent = kb.last_used
          ? this.formatDate(kb.last_used)
          : "Never used";
      }
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
      this._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } }); // Clear list
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

      const kbDependentEls = document.querySelectorAll(
        "[data-requires-kb='true']",
      );
      kbDependentEls.forEach((el) => {
        const disabled = !hasKB || !isActive;
        el.disabled = disabled;
        el.classList.toggle("opacity-50", disabled);
        el.classList.toggle("cursor-not-allowed", disabled);
        el.title = disabled
          ? !hasKB
            ? "Setup Knowledge Base first."
            : "Knowledge Base must be active."
          : "Ready to use Knowledge Base features.";
      });

      if (this.elements.reprocessButton) {
        const fileCountEl = document.getElementById("knowledgeFileCount");
        const fileCount = parseInt(fileCountEl?.textContent || "0", 10);
        const reDisabled = !hasKB || !isActive || fileCount === 0;

        this.elements.reprocessButton.disabled = reDisabled;
        this.elements.reprocessButton.classList.toggle(
          "opacity-50",
          reDisabled,
        );
        this.elements.reprocessButton.classList.toggle(
          "cursor-not-allowed",
          reDisabled,
        );

        if (!hasKB) {
          this.elements.reprocessButton.title = "Setup Knowledge Base first.";
        } else if (!isActive) {
          this.elements.reprocessButton.title =
            "Knowledge Base must be active.";
        } else if (fileCount === 0) {
          this.elements.reprocessButton.title = "No files to reprocess.";
        } else {
          this.elements.reprocessButton.title = "Reprocess files.";
        }
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
          this._notify("warning", "Knowledge Base is empty. Upload files via 'Files' tab.");
        } else if (
          kb.stats.file_count > 0 &&
          kb.stats.chunk_count === 0 &&
          kb.stats.unprocessed_files > 0
        ) {
          this._notify("warning", "Files need processing. Click 'Reprocess Files'.");
        } else if (kb.stats.unprocessed_files > 0) {
          this._notify("info", `${kb.stats.unprocessed_files} file(s) need processing.`);
        }
      } else {
        this._notify("warning", "Knowledge Base is disabled. Enable it to use search.");
      }
    }

    /**
     * Perform a search against the knowledge base
     * @param {string} query - Search query
     * @returns {Promise<void>}
     */
    async searchKnowledgeBase(query) {
      if (this.state.isSearching) return;
      const trimmed = (query || "").trim();
      if (
        !trimmed ||
        trimmed.length < this.config.minQueryLength ||
        trimmed.length > this.config.maxQueryLength
      ) {
        this._showNoResults();
        return;
      }

      const pid = this._getCurrentProjectId();
      if (!pid) {
        this._showError("No valid project selected for KB search");
        return;
      }

      const cacheKey = `${pid}-${trimmed}`;
      if (this.state.searchCache.has(cacheKey)) {
        this._renderSearchResults(this.state.searchCache.get(cacheKey));
        return;
      }

      this.state.isSearching = true;
      this._showSearchLoading();

      try {
        const resp = await this.apiRequest(
          `/api/projects/${pid}/knowledge-bases/search`,
          {
            method: "POST",
            body: { query: trimmed, top_k: this._getSelectedTopKValue() },
          },
          false,
        );
        const results = Array.isArray(resp?.data?.results)
          ? resp.data.results
          : [];
        if (results.length) {
          this.state.searchCache.set(cacheKey, results);
          this._renderSearchResults(results);
        } else {
          this._showNoResults();
        }
      } catch {
        this._notify('error', "Search failed. Please try again.");
        this._notify("error", "Search failed. Please try again.");
      } finally {
        this.state.isSearching = false;
        this._hideSearchLoading();
      }
    }

    /**
     * Trigger search from input field
     * @private
     */
    _triggerSearch() {
      if (this.elements.searchInput) {
        this.searchKnowledgeBase(this.elements.searchInput.value);
      }
    }

    /**
     * Render search results in the UI
     * @param {SearchResult[]} results
     * @private
     */
    _renderSearchResults(results) {
      this._clearSearchResults();
      if (!results?.length) return this._showNoResults();
      this._appendSearchResults(results);
      this._toggleResultSections(true);
    }

    _clearSearchResults() {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (resultsContainer) resultsContainer.textContent = "";
      resultsSection?.classList.add("hidden");
      noResultsSection?.classList.add("hidden");
    }

    _appendSearchResults(results) {
      const { resultsContainer } = this.elements;
      if (!resultsContainer) return;
      results.forEach((res) => {
        const item = this._createResultItem(res);
        this.eventHandlers.trackListener(item, "click", () =>
          this._showResultDetail(res),
        );
        this.eventHandlers.trackListener(item, "keydown", (e) => {
          if (["Enter", " "].includes(e.key)) {
            e.preventDefault();
            this._showResultDetail(res);
          }
        });
        resultsContainer.appendChild(item);
      });
    }

    _toggleResultSections(show) {
      const { resultsSection, noResultsSection } = this.elements;
      if (resultsSection) resultsSection.classList.toggle("hidden", !show);
      if (noResultsSection) noResultsSection.classList.toggle("hidden", show);
    }

    /**
     * Create a single result card element
     * @param {SearchResult} result
     * @returns {HTMLElement}
     * @private
     */
    _createResultItem(result) {
      const item = document.createElement("div");
      item.className =
        "card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow mb-3 cursor-pointer border border-base-300";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      const fileInfo = result.file_info || {};
      const filename =
        fileInfo.filename || result.metadata?.file_name || "Unknown source";
      const scorePct = Math.round((result.score || 0) * 100);

      const badgeClass = this._getBadgeClass(scorePct);

      _safeSetInnerHTML(item, `
        <div class="card-body p-3">
          <div class="card-title text-sm justify-between items-center mb-1">
            <div class="flex items-center gap-2 truncate">
              <span class="text-lg">${this.fileIcon(fileInfo.file_type)}</span>
              <span class="truncate" title="${filename}">${filename}</span>
            </div>
            <div class="badge ${badgeClass} badge-sm" title="Relevance: ${scorePct}%">
              ${scorePct}%
            </div>
          </div>
          <p class="text-xs text-base-content/80 kb-line-clamp-3 mb-2">
            ${result.text || "No content available."}
          </p>
        </div>
      `);
      return item;
    }

    _getBadgeClass(scorePct) {
      if (scorePct >= 80) return "badge-success";
      if (scorePct >= 60) return "badge-warning";
      return "badge-ghost";
    }

    /**
     * Show detailed view of a search result
     * @param {SearchResult} result
     * @private
     */
    _showResultDetail(result) {
      const modal = this.elements.resultModal;
      if (!modal || typeof modal.showModal !== "function") {
        this._notify('error', "[KB] Result detail modal not found or invalid.");
        return;
      }
      this._populateResultDetail(result);
      modal.showModal();
    }

    _populateResultDetail(result) {
      const {
        resultTitle,
        resultSource,
        resultScore,
        resultContent,
        useInChatBtn,
      } = this.elements;
      if (!resultTitle || !resultSource || !resultScore || !resultContent)
        return;

      const fileInfo = result.file_info || {};
      const filename =
        fileInfo.filename || result.metadata?.file_name || "Unknown Source";
      const scorePct = Math.round((result.score || 0) * 100);

      const badgeClass = this._getBadgeClass(scorePct);

      resultTitle.textContent = `Detail: ${filename}`;
      resultSource.textContent = filename;
      resultScore.className = `badge ${badgeClass}`;
      resultScore.textContent = `${scorePct}%`;
      resultContent.textContent = result.text || "No content available.";
      resultContent.style.whiteSpace = "pre-wrap";

      if (useInChatBtn) {
        useInChatBtn.onclick = () => {
          this._useInConversation(result);
          this._hideResultDetailModal();
        };
      }
    }

    /**
     * Hide the result detail modal
     * @private
     */
    _hideResultDetailModal() {
      const modal = this.elements.resultModal;
      if (modal && typeof modal.close === "function") {
        modal.close();
      }
    }

    /**
     * Insert result reference into chat input
     * @param {SearchResult} result
     * @private
     */
    _useInConversation(result) {
      const chatInput =
        document.getElementById("chatUIInput") ||
        document.getElementById("projectChatInput") ||
        document.getElementById("chatInput") ||
        document.querySelector('textarea[placeholder*="Send a message"]');

      if (!chatInput) return;
      const filename = result.metadata?.file_name || "the knowledge base";
      const refText = `Referring to content from "${filename}":\n\n> ${result.text.trim()}\n\nBased on this, `;
      const current = chatInput.value.trim();

      chatInput.value = current ? `${current}\n\n${refText}` : refText;
      chatInput.focus();
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /**
     * Toggle knowledge base activation
     * @param {boolean} enabled
     * @returns {Promise<void>}
     */
    async toggleKnowledgeBase(enabled) {
      const pid = this._getCurrentProjectId();
      if (!pid) {
        this._notify("error", "No valid project selected for Knowledge Base toggle");
        return;
      }

      try {
        const resp = await this.apiRequest(
          `/api/projects/${pid}/knowledge-bases/toggle`,
          { method: "POST", body: { enable: enabled } },
        );
        if (resp.success) {
          if (this.state.knowledgeBase) {
            this.state.knowledgeBase.is_active = enabled;
          }
          this._updateStatusIndicator(enabled);
          const storage = getDep("storage");
          if (storage && typeof storage.setItem === "function") {
            storage.setItem(`kb_enabled_${pid}`, String(enabled));
          }

          if (this.projectManager.loadProjectDetails) {
            const project = await this.projectManager.loadProjectDetails(pid);
            this.renderKnowledgeBaseInfo(project?.knowledge_base);
          } else {
            this.renderKnowledgeBaseInfo(this.state.knowledgeBase);
          }
        }
      } catch {
        this._notify("error", "Failed to toggle knowledge base");
      }
    }

    /**
     * Reprocess all files in the knowledge base
     * @param {string} projectId
     * @returns {Promise<void>}
     */
    async reprocessFiles(projectId) {
      if (!this.validateUUID(projectId)) {
        this._notify("error", "No valid project selected for reprocessing");
        return;
      }
      try {
        this._showProcessingState();
        const resp = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-base/reindex`,
          { method: "POST", body: { force: true } },
        );
        if (resp.success) {
          this._notify("success", "Files queued for reprocessing");
          if (this.projectManager.loadProjectDetails) {
            const [project] = await Promise.all([
              this.projectManager.loadProjectDetails(projectId),
              this.projectManager.loadProjectStats?.(projectId),
            ]);
            this.renderKnowledgeBaseInfo(project?.knowledge_base);
          } else if (this.state.knowledgeBase?.id) {
            await this._loadKnowledgeBaseHealth(this.state.knowledgeBase.id);
            await this._loadKnowledgeBaseFiles(projectId, this.state.knowledgeBase.id);
          }
        }
      } catch {
        this._notify('error', "Failed to reprocess files");
      } finally {
        this._hideProcessingState();
      }
    }

    /**
     * Handle settings form submission
     * @param {Event} e - Form submit event
     * @private
     */
    _handleKnowledgeBaseFormSubmit(e) {
      e.preventDefault();
      const form = e.target;
      const projectId = form.dataset.projectId || this._getCurrentProjectId();
      if (!this.validateUUID(projectId)) {
        this._notify("error", "Cannot save settings: Project ID missing or invalid.");
        return;
      }

      const data = new FormData(form);
      const payload = {
        name: data.get("name"),
        description: data.get("description") || null,
        embedding_model: data.get("embedding_model"),
      };

      if (!this.state.knowledgeBase?.id) {
        payload.process_existing_files = form.elements["process_all_files"]?.checked || false;
      }


      if (!payload.name?.trim()) {
        this._notify("error", "Knowledge Base name is required.");
        return;
      }
      if (!payload.embedding_model) {
        this._notify("error", "Embedding model must be selected.");
        return;
      }

      const btn = form.querySelector('button[type="submit"]');
      this._setButtonLoading(btn, true);

      this._submitKnowledgeBaseForm(projectId, payload).finally(() => {
        this._setButtonLoading(btn, false);
      });
    }

    /**
     * Submit settings to the server
     * @param {string} projectId
     * @param {Object} payload
     * @param {string} payload.name
     * @param {string|null} payload.description
     * @param {string} payload.embedding_model
     * @returns {Promise<void>}
     * @private
     */
    async _submitKnowledgeBaseForm(projectId, payload) {
      try {
        const kbId = this.state.knowledgeBase?.id;
        const isUpdating = !!kbId;
        const method = isUpdating ? "PATCH" : "POST";
        const url = isUpdating
          ? `/api/projects/${projectId}/knowledge-bases/${kbId}`
          : `/api/projects/${projectId}/knowledge-bases`;

        const resp = await this.apiRequest(url, { method, body: payload });

        const responseData = isUpdating ? resp.data : (resp.data?.knowledge_base || resp.data);

        if (responseData?.id || resp.success) {
          this._hideKnowledgeBaseModal();
          this._notify("success", "Knowledge Base settings saved.");

          if (this.projectManager.loadProjectDetails) {
            const project = await this.projectManager.loadProjectDetails(projectId);
            this.renderKnowledgeBaseInfo(project?.knowledge_base, projectId);
          } else {
            this.renderKnowledgeBaseInfo({
              ...this.state.knowledgeBase,
              ...responseData,
            }, projectId);
          }
        } else {
          throw new Error(resp.message || "Invalid response from server");
        }
      } catch (err) {
        this._notify('error', `Failed to save settings: ${err.message || 'Unknown error'}`, { source: '_submitKnowledgeBaseForm', originalError: err });
      }
    }

    /**
     * Handle deleting the knowledge base
     * @private
     */
    async _handleDeleteKnowledgeBase() {
        const projectId = this._getCurrentProjectId();
        const kbId = this.state.knowledgeBase?.id;

        if (!projectId || !kbId) {
            this._notify("error", "Cannot delete: Project or Knowledge Base ID missing.");
            return;
        }

        const confirmed = await this.modalManager.confirmAction(
            "Delete Knowledge Base?",
            "Are you sure you want to permanently delete this knowledge base? This action cannot be undone."
        );

        if (!confirmed) {
            return;
        }

        const deleteButton = this.elements.deleteKnowledgeBaseBtn;
        this._setButtonLoading(deleteButton, true, "Deleting...");

        try {
            const resp = await this.apiRequest(
                `/api/projects/${projectId}/knowledge-bases/${kbId}`,
                { method: "DELETE" }
            );

            if (resp.success || resp.data?.deleted_id) {
                this._notify("success", "Knowledge Base deleted successfully.");
                this._hideKnowledgeBaseModal();
                this._showInactiveState();
                if (this.projectManager.loadProjectDetails) {
                    await this.projectManager.loadProjectDetails(projectId);
                }
            } else {
                throw new Error(resp.message || "Failed to delete knowledge base.");
            }
        } catch (err) {
            this._notify('error', `Failed to delete Knowledge Base: ${err.message || 'Unknown error'}`, { source: '_handleDeleteKnowledgeBase', originalError: err });
        } finally {
            this._setButtonLoading(deleteButton, false);
        }
    }


    /**
     * Show the settings modal
     * @private
     */
    _showKnowledgeBaseModal() {
      const modal = this.elements.settingsModal;
      if (!modal || typeof modal.showModal !== "function") {
        this._notify('error', "[KB] Settings modal not found or invalid.");
        return;
      }

      const form = this.elements.settingsForm;
      if (form) {
        form.reset();
        const kbIdInput = form.elements["knowledge_base_id"];
        if (kbIdInput) {
            kbIdInput.value = this.state.knowledgeBase?.id || "";
        }
      }

      this._updateModelSelection(
        this.state.knowledgeBase?.embedding_model || null,
      );

      const deleteBtn = this.elements.deleteKnowledgeBaseBtn;
      const { kbGitHubAttachedRepoInfo, kbAttachedRepoUrlDisplay, kbAttachedRepoBranchDisplay, kbDetachRepoBtn, kbGitHubAttachForm, kbGitHubRepoUrlInput, kbGitHubBranchInput, kbGitHubFilePathsTextarea } = this.elements;


      if (this.state.knowledgeBase && this.state.knowledgeBase.id) {
        const kb = this.state.knowledgeBase;
        if (form) {
            form.elements["name"].value = kb.name || "";
            form.elements["description"].value = kb.description || "";
            const processAllFilesCheckbox = form.elements["process_all_files"];
            if (processAllFilesCheckbox) processAllFilesCheckbox.checked = false;

            const autoEnableCheckbox = form.elements["auto_enable"];
            if (autoEnableCheckbox) autoEnableCheckbox.checked = true;
        }
        if (deleteBtn) deleteBtn.classList.remove("hidden");

        // GitHub section update
        if (kb.repo_url) {
            if (kbGitHubAttachedRepoInfo) kbGitHubAttachedRepoInfo.classList.remove("hidden");
            if (kbAttachedRepoUrlDisplay) kbAttachedRepoUrlDisplay.textContent = kb.repo_url;
            if (kbAttachedRepoBranchDisplay) kbAttachedRepoBranchDisplay.textContent = kb.branch || 'main';
            if (kbGitHubAttachForm) kbGitHubAttachForm.classList.add("hidden");
        } else {
            if (kbGitHubAttachedRepoInfo) kbGitHubAttachedRepoInfo.classList.add("hidden");
            if (kbGitHubAttachForm) kbGitHubAttachForm.classList.remove("hidden");
            if (kbGitHubRepoUrlInput) kbGitHubRepoUrlInput.value = "";
            if (kbGitHubBranchInput) kbGitHubBranchInput.value = "main";
            if (kbGitHubFilePathsTextarea) kbGitHubFilePathsTextarea.value = "";
        }

      } else {
        if (form) {
            const processAllFilesCheckbox = form.elements["process_all_files"];
            if (processAllFilesCheckbox) processAllFilesCheckbox.checked = true;

            const autoEnableCheckbox = form.elements["auto_enable"];
            if (autoEnableCheckbox) autoEnableCheckbox.checked = true;
        }
        if (deleteBtn) deleteBtn.classList.add("hidden");
        // GitHub section for new KB
        if (kbGitHubAttachedRepoInfo) kbGitHubAttachedRepoInfo.classList.add("hidden");
        if (kbGitHubAttachForm) kbGitHubAttachForm.classList.remove("hidden");
        if (kbGitHubRepoUrlInput) kbGitHubRepoUrlInput.value = "";
        if (kbGitHubBranchInput) kbGitHubBranchInput.value = "main";
        if (kbGitHubFilePathsTextarea) kbGitHubFilePathsTextarea.value = "";
      }


      const pid = this._getCurrentProjectId();
      if (pid && form) {
        form.dataset.projectId = pid;
      }

      modal.showModal();
      this._validateSelectedModelDimensions();
    }

    /**
     * Hide the settings modal
     * @private
     */
    _hideKnowledgeBaseModal() {
      const modal = this.elements.settingsModal;
      if (modal && typeof modal.close === "function") {
        modal.close();
      }
    }

    /**
     * Load health metrics for the KB
     * @param {string} kbId
     * @returns {Promise<Object|null>}
     * @private
     */
    async _loadKnowledgeBaseHealth(kbId) {
      if (!kbId || !this.validateUUID(kbId)) return null;
      try {
        const projectId = this._getCurrentProjectId();
        if (!projectId) {
            this._notify('warning', "Project ID not found for KB health check.");
            return null;
        }
        const healthResp = await this.apiRequest(
            `/api/projects/${projectId}/knowledge-bases/status?detailed=true`,
            { method: "GET"},
            false
        );

        if (healthResp?.data) {
            const { kbNameDisplay, kbModelDisplay, knowledgeFileCount, knowledgeChunkCount, knowledgeFileSize } = this.elements;

            if (kbNameDisplay && healthResp.data.name) kbNameDisplay.textContent = healthResp.data.name;
            if (kbModelDisplay && healthResp.data.embedding_model) kbModelDisplay.textContent = healthResp.data.embedding_model;

            if (knowledgeFileCount && healthResp.data.files?.total_files !== undefined) {
                knowledgeFileCount.textContent = healthResp.data.files.total_files;
            }
            if (knowledgeChunkCount && healthResp.data.vector_stats?.total_vectors !== undefined) {
                knowledgeChunkCount.textContent = healthResp.data.vector_stats.total_vectors;
            }
             let totalSize = 0;
             if (healthResp.data.files?.files_details) { // Assuming files_details is an array of file objects with file_size
                 healthResp.data.files.files_details.forEach(file => totalSize += (file.file_size || 0));
             } else if (this.state.knowledgeBase?.stats?.total_size_bytes) { // Fallback to potentially existing stat
                 totalSize = this.state.knowledgeBase.stats.total_size_bytes;
             }

             if (knowledgeFileSize) {
                knowledgeFileSize.textContent = this.formatBytes(totalSize);
             }


            if (this.state.knowledgeBase) {
                this.state.knowledgeBase.name = healthResp.data.name || this.state.knowledgeBase.name;
                this.state.knowledgeBase.embedding_model = healthResp.data.embedding_model || this.state.knowledgeBase.embedding_model;
                if (healthResp.data.files) {
                    this.state.knowledgeBase.stats = {
                        ...this.state.knowledgeBase.stats,
                        file_count: healthResp.data.files.total_files || 0,
                        unprocessed_files: healthResp.data.files.pending_files || 0,
                        // total_size_bytes: totalSize, // Store raw bytes if needed elsewhere
                    };
                }
                if (healthResp.data.vector_stats) {
                     this.state.knowledgeBase.stats.chunk_count = healthResp.data.vector_stats.total_vectors || 0;
                }
                this._updateStatusAlerts(this.state.knowledgeBase);
            }
        }
        return healthResp?.data || null;
      } catch(err) {
        this._notify('error', "Could not verify knowledge base health", { originalError: err});
        this._showStatusAlert(
          "Could not verify knowledge base health",
          "error",
        );
        return null;
      }
    }

    /**
     * Load and render files for the current project's knowledge base.
     * @param {string} projectId - The ID of the current project.
     * @param {string} kbId - The ID of the knowledge base.
     * @private
     */
    async _loadKnowledgeBaseFiles(projectId, kbId) {
        if (!projectId || !kbId) {
            this._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
            this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
            return;
        }

        try {
            const response = await this.apiRequest(
                `/api/projects/${projectId}/knowledge-bases/files-list`,
                { method: "GET" }
            );
            if (response.success && response.data) {
                this._renderKnowledgeBaseFiles(response.data);
                this.elements.knowledgeBaseFilesSection?.classList.toggle("hidden", response.data.files.length === 0);
            } else {
                this._notify("error", "Failed to load knowledge base files.");
                this._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
                this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
            }
        } catch (error) {
            this._notify("error", `Error loading knowledge base files: ${error.message}`, { originalError: error });
            this._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
            this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
        }
    }

    /**
     * Render the list of knowledge base files in the UI.
     * @param {Object} filesData - Data containing the list of files and pagination info.
     * @param {FileInfo[]} filesData.files - Array of file objects.
     * @private
     */
    _renderKnowledgeBaseFiles(filesData) {
        const container = this.elements.knowledgeBaseFilesListContainer;
        if (!container) return;

        _safeSetInnerHTML(container, "");

        if (!filesData || !filesData.files || filesData.files.length === 0) {
            _safeSetInnerHTML(container, '<p class="text-base-content/60 text-center py-4">No files currently in the Knowledge Base.</p>');
            return;
        }

        const ul = document.createElement("ul");
        ul.className = "space-y-2";

        filesData.files.forEach(file => {
            const li = document.createElement("li");
            li.className = "flex items-center justify-between p-2 bg-base-200 rounded-md hover:bg-base-300 transition-colors";

            const processingStatus = file.config?.search_processing?.status || 'unknown';
            let statusBadgeClass = 'badge-ghost';
            if (processingStatus === 'success') statusBadgeClass = 'badge-success';
            else if (processingStatus === 'error') statusBadgeClass = 'badge-error';
            else if (processingStatus === 'pending') statusBadgeClass = 'badge-warning';

            _safeSetInnerHTML(li, `
                <div class="flex items-center gap-3 truncate">
                    <span class="text-xl">${this.fileIcon(file.file_type)}</span>
                    <div class="truncate">
                        <span class="font-medium text-sm block truncate" title="${file.filename}">${file.filename}</span>
                        <span class="text-xs text-base-content/70">${this.formatBytes(file.file_size)}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="badge ${statusBadgeClass} badge-sm capitalize">${processingStatus}</span>
                    <button data-file-id="${file.id}" class="btn btn-xs btn-error btn-outline kb-delete-file-btn" title="Delete file from KB">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            `);

            const deleteBtn = li.querySelector(".kb-delete-file-btn");
            if (deleteBtn) {
                this.eventHandlers.trackListener(deleteBtn, "click", (e) => {
                    e.stopPropagation();
                    const fileId = deleteBtn.dataset.fileId;
                    const projectId = this._getCurrentProjectId();
                    if (projectId && fileId) {
                        this._handleDeleteKnowledgeBaseFile(projectId, fileId, file.filename);
                    }
                });
            }
            ul.appendChild(li);
        });
        container.appendChild(ul);
    }

    /**
     * Handle deletion of a single file from the knowledge base.
     * @param {string} projectId - The ID of the current project.
     * @param {string} fileId - The ID of the file to delete.
     * @param {string} filename - The name of the file for confirmation message.
     * @private
     */
    async _handleDeleteKnowledgeBaseFile(projectId, fileId, filename) {
        const confirmed = await this.modalManager.confirmAction(
            `Delete "${filename}"?`,
            "Are you sure you want to remove this file from the Knowledge Base? This will delete its indexed data."
        );

        if (!confirmed) return;

        try {
            const response = await this.apiRequest(
                `/api/projects/${projectId}/knowledge-bases/files/${fileId}`,
                { method: "DELETE" }
            );

            if (response.success) {
                this._notify("success", `File "${filename}" removed from Knowledge Base.`);
                const kbId = this.state.knowledgeBase?.id;
                if (kbId) {
                    this._loadKnowledgeBaseFiles(projectId, kbId);
                }
                this._loadKnowledgeBaseHealth(kbId);
                if (this.projectManager.loadProjectStats) {
                    this.projectManager.loadProjectStats(projectId);
                }
            } else {
                throw new Error(response.message || "Failed to delete file from KB.");
            }
        } catch (error) {
            this._notify("error", `Error deleting file "${filename}" from KB: ${error.message}`, { originalError: error });
        }
    }

    /**
     * Handle attaching a GitHub repository to the knowledge base.
     * @private
     */
    async _handleAttachGitHubRepo() {
        const projectId = this._getCurrentProjectId();
        const kbId = this.state.knowledgeBase?.id;

        if (!projectId || !kbId) {
            this._notify("error", "Project or Knowledge Base not properly initialized for GitHub attachment.");
            return;
        }

        const repoUrl = this.elements.kbGitHubRepoUrlInput?.value.trim();
        const branch = this.elements.kbGitHubBranchInput?.value.trim() || "main";
        const filePathsRaw = this.elements.kbGitHubFilePathsTextarea?.value.trim();
        const filePaths = filePathsRaw ? filePathsRaw.split('\n').map(p => p.trim()).filter(p => p) : null;

        if (!repoUrl) {
            this._notify("error", "Repository URL is required.");
            return;
        }
        // Basic URL validation (can be improved)
        try {
            new URL(repoUrl);
        } catch (_) {
            this._notify("error", "Invalid Repository URL format.");
            return;
        }

        const attachButton = this.elements.kbAttachRepoBtn;
        this._setButtonLoading(attachButton, true, "Attaching...");

        try {
            const payload = { repo_url: repoUrl, branch };
            if (filePaths && filePaths.length > 0) {
                payload.file_paths = filePaths;
            }

            const response = await this.apiRequest(
                `/api/projects/${projectId}/knowledge-bases/github/attach`,
                { method: "POST", body: payload }
            );

            if (response.success && response.data) {
                this._notify("success", `GitHub repository "${response.data.repo_url}" attached. ${response.data.files_processed} files are being processed.`);
                // Update local state and UI
                if (this.state.knowledgeBase) {
                    this.state.knowledgeBase.repo_url = response.data.repo_url;
                    this.state.knowledgeBase.branch = branch; // Assuming backend doesn't return branch in this specific response
                    this.state.knowledgeBase.file_paths = filePaths; // Assuming backend doesn't return file_paths
                }
                this._showKnowledgeBaseModal(); // Re-render modal to show attached info
                this._loadKnowledgeBaseFiles(projectId, kbId); // Refresh file list
                this._loadKnowledgeBaseHealth(kbId); // Refresh stats
            } else {
                throw new Error(response.message || "Failed to attach GitHub repository.");
            }
        } catch (error) {
            this._notify("error", `Error attaching GitHub repository: ${error.message}`, { originalError: error });
        } finally {
            this._setButtonLoading(attachButton, false);
        }
    }

    /**
     * Handle detaching a GitHub repository from the knowledge base.
     * @private
     */
    async _handleDetachGitHubRepo() {
        const projectId = this._getCurrentProjectId();
        const kbId = this.state.knowledgeBase?.id;
        const repoUrl = this.state.knowledgeBase?.repo_url;

        if (!projectId || !kbId || !repoUrl) {
            this._notify("error", "No repository attached or KB not initialized.");
            return;
        }

        const confirmed = await this.modalManager.confirmAction(
            `Detach "${repoUrl}"?`,
            "Are you sure you want to detach this repository? Files from this repository will be removed from the Knowledge Base."
        );

        if (!confirmed) return;

        const detachButton = this.elements.kbDetachRepoBtn;
        this._setButtonLoading(detachButton, true, "Detaching...");

        try {
            const response = await this.apiRequest(
                `/api/projects/${projectId}/knowledge-bases/github/detach`,
                { method: "POST", body: { repo_url: repoUrl } }
            );

            if (response.success && response.data) {
                this._notify("success", `GitHub repository "${response.data.repo_url}" detached. ${response.data.files_removed} files are being removed.`);
                 if (this.state.knowledgeBase) {
                    delete this.state.knowledgeBase.repo_url;
                    delete this.state.knowledgeBase.branch;
                    delete this.state.knowledgeBase.file_paths;
                }
                this._showKnowledgeBaseModal(); // Re-render modal
                this._loadKnowledgeBaseFiles(projectId, kbId); // Refresh file list
                this._loadKnowledgeBaseHealth(kbId); // Refresh stats
            } else {
                throw new Error(response.message || "Failed to detach GitHub repository.");
            }
        } catch (error) {
            this._notify("error", `Error detaching GitHub repository: ${error.message}`, { originalError: error });
        } finally {
            this._setButtonLoading(detachButton, false);
        }
    }


    /**
     * Show status alert in UI
     * @param {string} message
     * @param {'info'|'success'|'warning'|'error'} [type='info']
     * @private
     */
    _showStatusAlert(message, type = "info") {
      const statusIndicator = document.getElementById("kbStatusIndicator");
      if (!statusIndicator) {
        this._notify(type, message);
        return;
      }
      statusIndicator.textContent = "";
      let cls = "alert-info";
      if (type === "success") cls = "alert-success";
      else if (type === "warning") cls = "alert-warning";
      else if (type === "error") cls = "alert-error";

      const alertDiv = document.createElement("div");
      alertDiv.className = `alert ${cls} shadow-xs text-sm py-2 px-3`;
      alertDiv.setAttribute("role", "alert");
      _safeSetInnerHTML(alertDiv, `<span>${message}</span>`);

      if (type !== "error") {
        const btn = document.createElement("button");
        btn.className = "btn btn-xs btn-ghost btn-circle";
        btn.textContent = "✕";
        btn.onclick = () => alertDiv.remove();
        alertDiv.appendChild(btn);
      }

      statusIndicator.appendChild(alertDiv);
    }

    /**
     * Show error alert
     * @param {string} msg
     * @private
     */
    _showError(msg) {
      this._showStatusAlert(msg, "error");
    }

    /**
     * Show loading indicator for search
     * @private
     */
    _showSearchLoading() {
      const { resultsContainer, resultsSection, noResultsSection } =
        this.elements;
      resultsSection?.classList.remove("hidden");
      noResultsSection?.classList.add("hidden");
      if (resultsContainer) {
        _safeSetInnerHTML(resultsContainer, `
          <div class="flex justify-center items-center p-4 text-base-content/70">
            <span class="loading loading-dots loading-md mr-2"></span>
            <span>Searching knowledge base...</span>
          </div>
        `);
      }
    }

    /**
     * Hide search loading indicator
     * @private
     */
    _hideSearchLoading() {
      if (!this.state.isSearching) {
        const loadingEl = this.elements.resultsContainer?.querySelector(
          ".flex.justify-center.items-center",
        );
        if (loadingEl && loadingEl.textContent.includes("Searching")) {
          loadingEl.remove();
        }
      }
    }

    /**
     * Show "no results" UI
     * @private
     */
    _showNoResults() {
      const { resultsSection, noResultsSection, resultsContainer } =
        this.elements;
      if (resultsContainer) resultsContainer.textContent = "";
      resultsSection?.classList.add("hidden");
      noResultsSection?.classList.remove("hidden");
    }

    /**
     * Show processing spinner on reprocess button
     * @private
     */
    _showProcessingState() {
      const btn = this.elements.reprocessButton;
      if (!btn) return;
      this._processingState = {
        originalContent: btn.innerHTML,
        originalDisabled: btn.disabled,
      };
      btn.disabled = true;
      _safeSetInnerHTML(btn, `<span class="loading loading-spinner loading-xs"></span> Processing...`);
    }

    /**
     * Restore reprocess button state
     * @private
     */
    _hideProcessingState() {
      const btn = this.elements.reprocessButton;
      if (!btn || !this._processingState) return;
      btn.disabled = this._processingState.originalDisabled;
      _safeSetInnerHTML(btn, this._processingState.originalContent);
      this._processingState = null;
    }

    /**
     * Validate dimension compatibility on model change
     * @private
     */
    _validateSelectedModelDimensions() {
      const sel = this.elements.modelSelect;
      if (!sel) return;
      const parent = sel.closest(".form-control");
      if (!parent) return;
      let warning = parent.querySelector(".model-error");
      const opt = sel.options[sel.selectedIndex];
      if (opt.disabled) {
        if (!warning) {
          const labelDiv = parent.querySelector(".label:last-of-type") || parent.querySelector("p.text-xs.text-base-content\\/70.mt-1")?.previousElementSibling;
          if (labelDiv) {
            warning = document.createElement("span");
            warning.className = "label-text-alt text-error model-error";
            labelDiv.appendChild(warning);
          } else {
            warning = document.createElement("div");
            warning.className = "text-error text-xs mt-1 model-error";
            sel.insertAdjacentElement("afterend", warning);
          }
        }
        warning.textContent =
          "Changing dimensions requires reprocessing all files!";
        warning.classList.remove("hidden");
      } else if (warning) {
        warning.classList.add("hidden");
        warning.textContent = "";
      }
    }

    /**
     * Update model selection dropdown
     * @param {string|null} currentModel
     * @private
     */
    _updateModelSelection(currentModel) {
        const selectEl = this.elements.modelSelect || document.getElementById("embeddingModelSelect");
        if (!selectEl) return;

        if (currentModel) {
            let modelFound = false;
            for (let i = 0; i < selectEl.options.length; i++) {
                if (selectEl.options[i].value === currentModel) {
                    selectEl.selectedIndex = i;
                    modelFound = true;
                    break;
                }
            }
            if (!modelFound) {
                const newOption = new Option(`${currentModel} (Current)`, currentModel, false, true);
                selectEl.add(newOption);
                selectEl.value = currentModel;
                this._notify('info', `Current embedding model "${currentModel}" was not in the default list. It has been added.`, { source: '_updateModelSelection' });
            }
        } else {
            selectEl.selectedIndex = 0;
        }
        this._validateSelectedModelDimensions();
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
     * Get selected Top-K value
     * @returns {number}
     * @private
     */
    _getSelectedTopKValue() {
      const val = parseInt(this.elements.topKSelect?.value, 10);
      return isNaN(val) ? 5 : val;
    }

    /**
     * Handle authentication state changes
     * @param {boolean} authenticated
     * @private
     */
    _handleAuthStateChange(authenticated) {
      this.state.authState = authenticated;
      const items = [
        this.elements.searchButton,
        this.elements.reprocessButton,
        this.elements.setupButton,
        this.elements.kbToggle,
        this.elements.settingsButton,
        this.elements.deleteKnowledgeBaseBtn,
        this.elements.kbAttachRepoBtn, // Added
        this.elements.kbDetachRepoBtn, // Added
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

  // Add destroy/cleanup method to remove all event listeners and persistent error banners
  class KnowledgeBaseComponentWithDestroy extends KnowledgeBaseComponent {
    destroy() {
      // Remove all tracked event listeners
      if (this._boundListeners) {
        for (const { el, type, handler, opts } of this._boundListeners) {
          if (el && handler) {
            el.removeEventListener(type, handler, opts);
          }
        }
        this._boundListeners = [];
      }
      // No persistent error banner to remove; cleanup now only resets state
      // Reset state
      this.state.isInitialized = false;
    }
  }

  return new KnowledgeBaseComponentWithDestroy(options);
}
