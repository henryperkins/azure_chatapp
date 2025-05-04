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
 * @property {HTMLElement} [modelSelect] - Model selection dropdown
 * @property {HTMLElement} [resultModal] - Result detail modal
 * @property {HTMLElement} [resultTitle] - Result title
 * @property {HTMLElement} [resultSource] - Result source label
 * @property {HTMLElement} [resultScore] - Result score badge
 * @property {HTMLElement} [resultContent] - Result content container
 * @property {HTMLElement} [useInChatBtn] - Chat integration button
 *
 * @typedef {Object} Config
 * @property {number} [maxConcurrentProcesses=3] - Max concurrent operations
 * @property {number} [searchDebounceTime=300] - Search debounce delay
 * @property {number} [minQueryLength=2] - Minimum search query length
 * @property {number} [maxQueryLength=500] - Maximum search query length
 *
 * @typedef {Object} FileInfo
 * @property {string} filename
 * @property {string} file_type
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
 * const kb = createKnowledgeBaseComponent({ DependencySystem, app, projectManager, eventHandlers, uiUtils });
 * kb.initialize(true);
 */
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
  // DOMPurify global sanitizer for innerHTML
  const DOMPurify = getDep("DOMPurify");
  if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') {
    throw new Error("KnowledgeBaseComponent requires 'DOMPurify' dependency for HTML sanitization.");
  }

  /**
   * Safely set element innerHTML, using DOMPurify.
   * @param {HTMLElement} el
   * @param {string} html
   */
  function setSanitizedHTML(el, html) {
    if (!el) return;
    el.innerHTML = DOMPurify.sanitize(html);
  }

  // Required dependencies
  const app = getDep("app");
  const projectManager = getDep("projectManager");
  const eventHandlers = getDep("eventHandlers");
  const uiUtils = getDep("uiUtils") || getDep("uiUtilsInstance");

  if (!app || !projectManager || !eventHandlers || !uiUtils) {
    throw new Error(
      "KnowledgeBaseComponent requires 'app', 'projectManager', 'eventHandlers', and 'uiUtils' dependencies.",
    );
  }

  // Extract needed methods from `app`
  const {
    validateUUID = app.validateUUID,
    apiRequest = app.apiRequest,
    showNotification = app.showNotification,
  } = app;

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
      this.showNotification = showNotification;
      this.validateUUID = validateUUID;
      this.config = config;

      // --------------------------------------------------------------
      // DRY helpers for loading state and notification fallback
      // --------------------------------------------------------------
      this._setButtonLoading = function(btn, isLoading, loadingText = "Saving...") {
        if (!btn) return;
        if (isLoading) {
          btn.disabled = true;
          btn.dataset.originalText = btn.textContent;
          setSanitizedHTML(btn, `<span class="loading loading-spinner loading-xs"></span> ${loadingText}`);
        } else {
          btn.disabled = false;
          if (btn.dataset.originalText) {
            btn.textContent = btn.dataset.originalText;
            delete btn.dataset.originalText;
          }
        }
      };
      // Use only showNotification; remove direct alert/console
      this._notify = function(type, message) {
        if (this.showNotification) {
          this.showNotification(
            message,
            type,
            undefined,
            { group: true, context: "knowledgeBaseComponent" }
          );
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
      this._notify('info', `[KnowledgeBaseComponent] Initializing, isVisible: ${isVisible}, projectId: ${projectId}`);

      // Fast path for hiding
      if (this.state.isInitialized && !isVisible) {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
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
      addListener(this.elements.settingsForm, "submit", (e) => this._handleKnowledgeBaseFormSubmit(e));
      addListener(this.elements.modelSelect, "change", () => this._validateSelectedModelDimensions());
      addListener(this.elements.resultModal, "keydown", (e) => {
        if (e.key === "Escape") this._hideResultDetailModal();
      });
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
          // Don't await this call - it's not critical to load health info before continuing
          // This allows the rendering to complete faster
          this._loadKnowledgeBaseHealth(kbData.id)
            .catch(() => this._notify("warning", "Failed to load KB health"));
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
      const { resultsContainer, resultsSection, noResultsSection } =
        this.elements;
      if (!resultsContainer) return;

      resultsContainer.textContent = "";
      if (!results.length) {
        this._showNoResults();
        return;
      }

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

      resultsSection?.classList.remove("hidden");
      noResultsSection?.classList.add("hidden");
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

      let badgeClass = "badge-ghost";
      if (scorePct >= 80) badgeClass = "badge-success";
      else if (scorePct >= 60) badgeClass = "badge-warning";

      item.innerHTML = DOMPurify.sanitize(`
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

      let badgeClass = "badge-ghost";
      if (scorePct >= 80) badgeClass = "badge-success";
      else if (scorePct >= 60) badgeClass = "badge-warning";

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

      modal.showModal();
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
        this.showNotification?.(
          "No valid project selected for Knowledge Base toggle",
          "error",
        );
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
      } catch (err) {
        this._notify('error', "Failed to toggle knowledge base");
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
        this.showNotification?.(
          "No valid project selected for reprocessing",
          "error",
        );
        return;
      }
      try {
        this._showProcessingState();
        const resp = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-base/reindex`,
          { method: "POST", body: { force_reindex: true } },
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
          }
        }
      } catch {
        this._notify('error', "Failed to reprocess files");
        this._notify("error", "Failed to reprocess files");
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
        this.showNotification?.(
          "Cannot save settings: Project ID missing or invalid.",
          "error",
        );
        return;
      }

      const data = new FormData(form);
      const payload = {
        name: data.get("name"),
        description: data.get("description") || null,
        embedding_model: data.get("embedding_model"),
      };

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
        const isUpdating = !!this.state.knowledgeBase?.id;
        const method = isUpdating ? "PUT" : "POST";
        const url = isUpdating
          ? `/api/knowledge-bases/${this.state.knowledgeBase.id}`
          : `/api/projects/${projectId}/knowledge-bases`;

        const resp = await this.apiRequest(url, { method, body: payload });
        if (resp.data?.id || resp.success) {
          this._hideKnowledgeBaseModal();
          this._notify("success", "Knowledge Base settings saved.");

          if (this.projectManager.loadProjectDetails) {
            await this.projectManager.loadProjectDetails(projectId);
          } else {
            this.renderKnowledgeBaseInfo({
              ...this.state.knowledgeBase,
              ...payload,
            });
          }
        } else {
          throw new Error(resp.message || "Invalid response from server");
        }
      } catch (err) {
        this._notify('error', `Failed to save settings: ${err.message}`);
        this._notify("error", `Failed to save settings: ${err.message}`);
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

      if (this.elements.settingsForm) {
        this.elements.settingsForm.reset();
      }
      this._updateModelSelection(
        this.state.knowledgeBase?.embedding_model || null,
      );

      if (this.state.knowledgeBase) {
        const kb = this.state.knowledgeBase;
        const form = this.elements.settingsForm;
        form.elements["name"].value = kb.name || "";
        form.elements["description"].value = kb.description || "";
      }

      const pid = this._getCurrentProjectId();
      if (pid && this.elements.settingsForm) {
        this.elements.settingsForm.dataset.projectId = pid;
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
        const resp = await this.apiRequest(
          `/api/knowledge-bases/${kbId}/health`,
          { method: "GET" },
          false,
        );
        return resp?.data || null;
      } catch {
        this._notify('error', "Could not verify knowledge base health");
        this._showStatusAlert(
          "Could not verify knowledge base health",
          "error",
        );
        return null;
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
        this.showNotification?.(message, type);
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
      setSanitizedHTML(alertDiv, `<span>${message}</span>`);

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

    // (Removed: _showPersistentErrorBanner, now all error banners routed through notification system)

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
        setSanitizedHTML(resultsContainer, `
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
      btn.innerHTML = DOMPurify.sanitize(`<span class="loading loading-spinner loading-xs"></span> Processing...`);
    }

    /**
     * Restore reprocess button state
     * @private
     */
    _hideProcessingState() {
      const btn = this.elements.reprocessButton;
      if (!btn || !this._processingState) return;
      btn.disabled = this._processingState.originalDisabled;
      btn.innerHTML = DOMPurify.sanitize(this._processingState.originalContent);
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
          const labelDiv = parent.querySelector(".label:last-of-type");
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
     * Debounce helper
     * @param {Function} func
     * @param {number} wait - milliseconds
     * @returns {Function}
     * @private
     */
    _debounce(func, wait) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
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

export default createKnowledgeBaseComponent;
