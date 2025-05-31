/**
 * @module knowledgeBaseComponent
 * @description Refactored factory: NO global document/window. All DOM and event wiring via DI.
 */

import { createKnowledgeBaseSearchHandler } from './knowledgeBaseSearchHandler.js';
import { createKnowledgeBaseManager } from './knowledgeBaseManager.js';
import { ELEMENT_SELECTORS } from './utils/selectorConstants.js';

const MODULE = "KnowledgeBaseComponent";
/**
 * Creates and returns a knowledge base UI component instance with full lifecycle management.
 *
 * This factory function resolves all required dependencies via the provided options or dependency injection system, validates their presence, and constructs a knowledge base component that manages UI rendering, event handling, authentication state, and project context changes. The returned component exposes methods for initialization, rendering, and cleanup, and integrates with injected services for DOM manipulation, event tracking, and logging.
 *
 * @param {Object} [options={}] - Configuration and dependency injection options.
 * @returns {KnowledgeBaseComponentWithDestroy} An instance of the knowledge base component with destroy capability.
 *
 * @throws {Error} If required dependencies such as `DependencySystem`, `logger`, `sanitizer`, `app`, `projectManager`, `eventHandlers`, `uiUtils`, `modalManager`, or `domAPI` are missing or invalid.
 */
export function createKnowledgeBaseComponent(options = {}) {
  const DS = options.DependencySystem;
  if (!DS) throw new Error("DependencySystem is required for KnowledgeBaseComponent");
  const getDep = (name) => name in options ? options[name] : DS.modules.get(name);

  const sanitizer = getDep("sanitizer");
  const app = getDep("appModule") || getDep("app");
  const projectManager = getDep("projectManager");
  const eventHandlers = getDep("eventHandlers");
  const uiUtils = getDep("uiUtils") || getDep("uiUtilsInstance");
  const modalManager = getDep("modalManager");
  const domAPI = getDep("domAPI");
  const domReadinessService = getDep("domReadinessService");
  const logger = getDep("logger"); // Ensure logger is fetched for constructor scope if needed early

  if (!domReadinessService)
    throw new Error(`[${MODULE}] requires 'domReadinessService' DI`);
  if (!logger)
    throw new Error(`[${MODULE}] requires 'logger' DI`);
  if (!sanitizer || typeof sanitizer.sanitize !== 'function')
    throw new Error(`[${MODULE}] requires 'sanitizer' (object with .sanitize).`);
  if (!app || !projectManager || !eventHandlers || !uiUtils || !modalManager) {
    throw new Error(
      `[${MODULE}] requires 'app', 'projectManager', 'eventHandlers', 'uiUtils', and 'modalManager' dependencies.`
    );
  }
  if (!domAPI) throw new Error(`${MODULE} requires 'domAPI' abstraction for DOM access.`);

  // --- Element Selectors (resolution deferred to init) ---
  const elRefs = options.elRefs || {}; // For externally provided elements
  // Removed reqEl function from factory scope. It will be part of _initElements.

  // --- domReadinessService Rule 7 compliance: replace any DependencySystem.waitFor(['app']) with domReadinessService.waitForEvent('app:ready', ...)
  // (No such code found in this file, so nothing to replace here.)

  // Use centralized selectors for consistency
  const elementSelectors = {
    ...ELEMENT_SELECTORS.KB,
    // Add any additional selectors not in the centralized config
    searchInput: "knowledgeSearchInput", // Optional - will be added to HTML
    searchButton: "searchKnowledgeBtn", // Optional - will be added to HTML
    resultsContainer: "knowledgeResults",
    resultsSection: "knowledgeResults",
    noResultsSection: "noResults",
    topKSelect: "knowledgeTopK",
    resultModal: "knowledgeResultModal",
    resultTitle: "knowledgeResultTitle",
    resultSource: "knowledgeResultSource",
    resultScore: "knowledgeResultScore",
    resultContent: "knowledgeResultContent",
    useInChatBtn: "useInChatBtn",
    kbGitHubAttachedRepoInfo: "kbGitHubAttachedRepoInfo",
    kbAttachedRepoUrlDisplay: "kbAttachedRepoUrlDisplay",
    kbAttachedRepoBranchDisplay: "kbAttachedRepoBranchDisplay",
    kbDetachRepoBtn: "kbDetachRepoBtn",
    kbGitHubAttachForm: "kbGitHubAttachForm",
    kbGitHubRepoUrlInput: "kbGitHubRepoUrlInput",
    kbGitHubBranchInput: "kbGitHubBranchInput",
    kbGitHubFilePathsTextarea: "kbGitHubFilePathsTextarea",
    kbAttachRepoBtn: "kbAttachRepoBtn",
    // Map centralized names to local names for backward compatibility
    container: ELEMENT_SELECTORS.KB.container,
    activeSection: ELEMENT_SELECTORS.KB.activeSection,
    inactiveSection: ELEMENT_SELECTORS.KB.inactiveSection,
    statusBadge: ELEMENT_SELECTORS.KB.statusBadge,
    kbToggle: ELEMENT_SELECTORS.KB.toggle,
    reprocessButton: ELEMENT_SELECTORS.KB.reprocessButton,
    setupButton: ELEMENT_SELECTORS.KB.setupButton,
    settingsButton: ELEMENT_SELECTORS.KB.settingsButton,
    kbNameDisplay: ELEMENT_SELECTORS.KB.baseName,
    kbModelDisplay: ELEMENT_SELECTORS.KB.modelDisplay,
    kbVersionDisplay: ELEMENT_SELECTORS.KB.versionDisplay,
    kbLastUsedDisplay: ELEMENT_SELECTORS.KB.lastUsedDisplay,
    settingsModal: ELEMENT_SELECTORS.KB.settingsModal,
    settingsForm: ELEMENT_SELECTORS.KB.settingsForm,
    cancelSettingsBtn: ELEMENT_SELECTORS.KB.cancelSettingsBtn,
    deleteKnowledgeBaseBtn: ELEMENT_SELECTORS.KB.deleteBtn,
    modelSelect: ELEMENT_SELECTORS.KB.modelSelect,
    knowledgeBaseFilesSection: ELEMENT_SELECTORS.KB.filesSection,
    knowledgeBaseFilesListContainer: ELEMENT_SELECTORS.KB.filesListContainer,
    knowledgeFileCount: ELEMENT_SELECTORS.KB.docCount,
    knowledgeChunkCount: ELEMENT_SELECTORS.KB.chunkCount,
    knowledgeFileSize: ELEMENT_SELECTORS.KB.fileSize,
  };

  // Resolve validateUUID and apiRequest with robust fallbacks
  const validateUUID = app.validateUUID;
  const apiRequest =
    // 1. Explicit override via factory options
    options.apiRequest
    // 2. DependencySystem registration (e.g., after advanced services phase)
    || getDep("apiRequest")
    // 3. Fallback to app proxy (may still be a placeholder in early phases)
    || app.apiRequest;
  const config = {
    maxConcurrentProcesses: options.maxConcurrentProcesses || 3,
    searchDebounceTime: options.searchDebounceTime || 300,
    minQueryLength: options.minQueryLength || 2,
    maxQueryLength: options.maxQueryLength || 500,
  };

  function _safeSetInnerHTML(el, html) {
    if (!el) return;
    domAPI.setInnerHTML(el, html);
  }

  class KnowledgeBaseComponent {
    constructor() {
      this.app = app;
      this.projectManager = projectManager;
      this.eventHandlers = eventHandlers;
      this.uiUtils = uiUtils;
      this.apiRequest = apiRequest;
      this.validateUUID = validateUUID;
      this.config = config;
      this.modalManager = modalManager;
      this.domAPI = domAPI;
      this.getDep = getDep;
      this.DependencySystem = DS;
      this.domReadinessService = domReadinessService;
      this.logger = logger; // Store logger instance

      this.elementSelectors = elementSelectors;
      this.elements = {};
      this.elRefs = elRefs; // Store elRefs passed in options for _initElements
      this.state = {
        knowledgeBase: null,
        isSearching: false,
        searchCache: new Map(),
        fileProcessingQueue: [],
        activeProcesses: 0,
        lastHealthCheck: null,
        // CONSOLIDATED: No local authState - read from appModule.state
      };

      this.formatBytes = uiUtils.formatBytes;
      this.formatDate = uiUtils.formatDate;
      this.fileIcon = uiUtils.fileIcon;
      this.scheduler = getDep("scheduler") || { setTimeout, clearTimeout };

      // Provide all cb/utilities needed by manager/searchHandler
      this._safeSetInnerHTML = _safeSetInnerHTML;
      this._setButtonLoading = function (btn, isLoading, loadingText = "Saving...") {
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

      // Add utility methods needed by manager
      this._showInactiveState = this._showInactiveState.bind(this);
      this._updateStatusIndicator = this._updateStatusIndicator.bind(this);
      this._updateStatusAlerts = this._updateStatusAlerts.bind(this);
      this._updateUploadButtonsState = this._updateUploadButtonsState.bind(this);
      this.renderKnowledgeBaseInfo = this.renderKnowledgeBaseInfo.bind(this);

      // For model/validation logic
      this._debounce = this._debounce.bind(this);

      // Initialize handlers asynchronously
      this.searchHandler = null;
      this.manager = createKnowledgeBaseManager(this);

      // this._bindEventHandlers(); // Call this after _initElements in initialize
    }

    async _initializeSearchHandler() {
      try {
        this.searchHandler = createKnowledgeBaseSearchHandler(this);
        await this.searchHandler.initialize?.();
        this.logger.debug(`[${MODULE}] Search handler initialized successfully.`, { context: MODULE });
      } catch (error) {
        this.logger.error(`[${MODULE}] Failed to initialize search handler: ${error.message}`, { error, context: MODULE });
        this.searchHandler = null;
      }
    }

    _initElements() {
      const OPTIONAL_KEYS = new Set([
        'activeSection', 'inactiveSection', 'statusBadge',
        'searchInput', 'searchButton', // Search elements are optional (not in current HTML)
        'kbToggle', 'reprocessButton', 'setupButton', 'settingsButton',
        'kbNameDisplay', 'kbModelDisplay', 'kbVersionDisplay', 'kbLastUsedDisplay',
        'knowledgeBaseFilesSection', 'knowledgeBaseFilesListContainer',
        'kbGitHubAttachedRepoInfo', 'kbAttachedRepoUrlDisplay',
        'kbAttachedRepoBranchDisplay', 'kbDetachRepoBtn',
        'kbGitHubAttachForm', 'kbGitHubRepoUrlInput',
        'kbGitHubBranchInput', 'kbGitHubFilePathsTextarea', 'kbAttachRepoBtn',
        'knowledgeFileCount', 'knowledgeChunkCount', 'knowledgeFileSize',
        'noResultsSection', 'topKSelect', 'resultsContainer', 'resultsSection',
        'settingsModal', 'settingsForm', 'cancelSettingsBtn', 'deleteKnowledgeBaseBtn',
        'resultModal', 'resultTitle', 'resultSource', 'resultScore', 'resultContent', 'useInChatBtn'
      ]);
      const reqEl = (key, selector) => {
        // Prioritize elRefs if provided for a key
        const el = this.elRefs[key] || this.domAPI.getElementById(selector);
        if (!el && !OPTIONAL_KEYS.has(key)) {
          throw new Error(`[${MODULE}] Missing required element/ref: ${key} (${selector})`);
        }
        return el;          // may be null for optional keys
      };

      for (const key in this.elementSelectors) {
        // Remap legacy 'knowledgeNoResults' property everywhere to 'noResultsSection'
        const selector = this.elementSelectors[key];
        const sel = typeof selector === 'string'
          ? (selector.startsWith('#') || selector.startsWith('.')
            ? selector
            : `#${selector}`)
          : selector;
        this.elements[key === "noResultsSection" ? "noResultsSection" : key] = this.elRefs[key] || this.domAPI.querySelector(sel);
      }
    }

    async initialize(isVisible, kbData = null, projectId = null) {
      // Build selector list excluding optional search/UI selectors so
      // domReadinessService does not wait for elements that may not be
      // present in certain templates (e.g., mobile view without KB search).
      const OPTIONAL_KEYS = new Set([
        'searchInput', 'searchButton',
        'resultsContainer', 'resultsSection',
        'noResultsSection', 'topKSelect',
        'resultModal', 'resultTitle', 'resultSource',
        'resultScore', 'resultContent', 'useInChatBtn'
      ]);

      const requiredSelectors = Object.entries(this.elementSelectors)
        .filter(([key]) => !OPTIONAL_KEYS.has(key))
        .map(([, sel]) =>
          (sel.startsWith('#') || sel.startsWith('.')) ? sel : `#${sel}`
        );

      // Always ensure the root KB container participates in readiness check
      if (!requiredSelectors.includes('#knowledgeTab')) {
        requiredSelectors.push('#knowledgeTab');
      }

      this.logger.info(`[${MODULE}] Initializing. Received isVisible: ${isVisible}, kbData ID: ${kbData?.id}, projectId: ${projectId}`, { context: MODULE });

      await this.domReadinessService.dependenciesAndElements({
        domSelectors: requiredSelectors,
        deps: ['auth', 'AppBus'], // Ensure auth and AppBus are ready for listeners
        context: MODULE + '::initializeDOM',
        timeout: this.app?.APP_CONFIG?.TIMEOUTS?.COMPONENT_ELEMENTS_READY ?? 8000,
        optional: true
      });
      this.logger.debug(`[${MODULE}] DOM elements and core deps (auth, AppBus) ready.`, { context: MODULE });

      try {
        this._initElements();
        await this._initializeSearchHandler();
        this._bindEventHandlers(); // Bind handlers after elements are initialized
      } catch (error) {
        this.logger.error(`[${MODULE}] Failed to initialize elements or bind handlers: ${error.message}`, { error, context: MODULE });
        this.domAPI.dispatchEvent(
          this.domAPI.getDocument(),
          new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: false, error } })
        );
        this.elements.container?.classList.add("hidden");
        return;
      }

      const auth = this.DependencySystem.modules.get('auth');
      const authIsReady =
        typeof auth?.isReady === 'function'
          ? auth.isReady()
          : this.app?.state?.isReady === true;
      if (!authIsReady) {
        this.logger.info(
          `[${MODULE}] Auth module not ready yet, waiting for authReady event.`,
          { context: MODULE }
        );
        await new Promise((resolve) => {
          // Prefer AuthBus, but fall back to document-level event for safety
          const readyTarget = auth?.AuthBus || this.domAPI.getDocument();
          this.eventHandlers.trackListener(
            readyTarget,
            'authReady',
            () => {
              this.logger.info(
                `[${MODULE}] Received authReady event during init.`,
                { context: MODULE }
              );
              resolve();
            },
            { once: true, context: MODULE, description: 'KB_Init_AuthReady' }
          );
        });
      }
      this.logger.info(`[${MODULE}] Auth module is now ready. App authenticated: ${this.app.state.isAuthenticated}`, { context: MODULE });

      if (!this.app.state.isAuthenticated) {
        this.logger.warn(`[${MODULE}] User not authenticated. Showing inactive state and hiding component.`, { context: MODULE });
        this._showInactiveState();
        this.elements.container?.classList.add("hidden");
        this.domAPI.dispatchEvent(
          this.domAPI.getDocument(),
          new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: true, message: 'Initialized but hidden due to auth state.' } })
        );
        return;
      }

      this.logger.info(`[${MODULE}] First-time initialization logic running.`, { context: MODULE });

      await this.renderOrClear(kbData, projectId);

      if (this.elements.container) {
        this.elements.container.classList.toggle("hidden", !isVisible);
        this.elements.container.classList.toggle("pointer-events-none", !isVisible);
      }

      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: true } })
      );
      this.logger.info(`[${MODULE}] Initialization complete. Final visibility: ${isVisible}`, { context: MODULE });
    }

    async renderOrClear(kbData, projectId) {
      if (kbData) {
        this.logger.debug(`[${MODULE}] Rendering with provided kbData.`, { kbId: kbData.id, projectId, context: MODULE });
        await this.renderKnowledgeBaseInfo(kbData, projectId);
      } else if (projectId) {
        this.logger.debug(`[${MODULE}] No kbData, but projectId ${projectId} provided. Attempting to load KB via manager.`, { context: MODULE });
        // This implies manager should fetch if only projectId is given.
        // For now, KBM's loadKnowledgeBase is called by projectManager, not directly by component on project change without kbData.
        // So, if kbData is null here, it means no KB exists or it shouldn't be shown.
        this._showInactiveState(); // Show inactive if no explicit kbData
        this.domAPI.dispatchEvent(
          this.domAPI.getDocument(),
          new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId } })
        );
      } else {
        this.logger.debug(`[${MODULE}] No kbData or projectId. Showing inactive state.`, { context: MODULE });
        this._showInactiveState();
      }
    }

    _bindEventHandlers() {
      this.logger.debug(`[${MODULE}] Binding event handlers.`, { context: MODULE });
      const EH = this.eventHandlers;
      const DA = this.domAPI;
      const MODULE_CONTEXT = MODULE; // Defined at the top of the factory

      const addListener = (elRef, type, fn, opts = {}) => {
        const element = typeof elRef === 'string' ? this.elements[elRef] : elRef;
        if (element) {
          EH.trackListener(element, type, fn, { ...opts, context: MODULE_CONTEXT, description: opts.description || `${elRef}_${type}` });
        } else {
          this.logger.warn(`[${MODULE}] Element ref "${elRef}" not found for listener type "${type}".`, { context: MODULE_CONTEXT });
        }
      };

      // Search UI
      addListener("searchButton", "click", () => {
        if (this.searchHandler && typeof this.searchHandler.triggerSearch === 'function') {
          this.searchHandler.triggerSearch();
        } else {
          this.logger.error(`[${MODULE}] searchHandler.triggerSearch is not available`, {
            searchHandler: this.searchHandler,
            context: MODULE_CONTEXT
          });
        }
      });
      addListener("searchInput", "input", (e) => {
        if (this.searchHandler && typeof this.searchHandler.debouncedSearch === 'function') {
          this.searchHandler.debouncedSearch(e.target.value);
        } else {
          this.logger.error(`[${MODULE}] searchHandler.debouncedSearch is not available`, {
            searchHandler: this.searchHandler,
            context: MODULE_CONTEXT
          });
        }
      });
      addListener("searchInput", "keyup", (e) => {
        if (e.key === "Enter") {
          if (this.searchHandler && typeof this.searchHandler.triggerSearch === 'function') {
            this.searchHandler.triggerSearch();
          } else {
            this.logger.error(`[${MODULE}] searchHandler.triggerSearch is not available`, {
              searchHandler: this.searchHandler,
              context: MODULE_CONTEXT
            });
          }
        }
      });
      addListener("resultModal", "keydown", (e) => {
        if (this.searchHandler && typeof this.searchHandler.handleResultModalKeydown === 'function') {
          this.searchHandler.handleResultModalKeydown(e);
        } else {
          this.logger.error(`[${MODULE}] searchHandler.handleResultModalKeydown is not available`, {
            searchHandler: this.searchHandler,
            context: MODULE_CONTEXT
          });
        }
      });

      // Management UI
      addListener("kbToggle", "change", (e) => this.manager.toggleKnowledgeBase(e.target.checked));
      addListener("reprocessButton", "click", () => {
        const pid = this._getCurrentProjectId();
        if (pid) this.manager.reprocessFiles(pid); else this.logger.warn(`[${MODULE}] Reprocess clicked but no current project ID found.`, { context: MODULE_CONTEXT });
      });

      const showModalHandler = () => this.manager.showKnowledgeBaseModal();
      addListener("setupButton", "click", showModalHandler);
      addListener("settingsButton", "click", showModalHandler);
      addListener("settingsForm", "submit", (e) => this.manager.handleKnowledgeBaseFormSubmit(e));
      addListener("cancelSettingsBtn", "click", () => this.manager.hideKnowledgeBaseModal());
      addListener("deleteKnowledgeBaseBtn", "click", () => this.manager.handleDeleteKnowledgeBase());
      addListener("modelSelect", "change", () => this.manager.validateSelectedModelDimensions());

      // GitHub integration
      addListener("kbAttachRepoBtn", "click", () => this.manager.handleAttachGitHubRepo());
      addListener("kbDetachRepoBtn", "click", () => this.manager.handleDetachGitHubRepo());

      // Listen to AppBus for currentProjectChanged
      const appBus = this.DependencySystem.modules.get('AppBus');
      if (appBus) {
        EH.trackListener(appBus, 'currentProjectChanged', this._handleAppCurrentProjectChanged.bind(this),
          { context: MODULE, description: 'KBComponent_AppBus_CurrentProjectChanged' });
        this.logger.debug(`[${MODULE}] Subscribed to AppBus "currentProjectChanged".`, { context: MODULE });
      } else {
        this.logger.error(`[${MODULE}] AppBus not available. Cannot subscribe to "currentProjectChanged". Critical for functionality.`, { context: MODULE });
      }

      // Listen to AuthBus for authStateChanged (more direct than document)
      const auth = this.DependencySystem.modules.get('auth');
      if (auth?.AuthBus) {
        EH.trackListener(auth.AuthBus, "authStateChanged", (e) => {
          this.logger.debug(`[${MODULE}] AuthBus authStateChanged event received.`, { detail: e.detail, context: MODULE_CONTEXT });
          this._handleAuthStateChange(e.detail?.authenticated);
        }, { description: "KB AuthBus authStateChanged Listener", context: MODULE_CONTEXT });
        this.logger.debug(`[${MODULE}] Subscribed to AuthBus "authStateChanged".`, { context: MODULE });
      } else {
        // Fallback to document listener if AuthBus isn't available (though it should be via DI)
        this.logger.warn(`[${MODULE}] AuthBus not available. Falling back to document listener for "authStateChanged".`, { context: MODULE });
        addListener(this.domAPI.getDocument(), "authStateChanged", (e) => {
          this._handleAuthStateChange(e.detail?.authenticated);
        }, { description: "KB Document authStateChanged Listener (Fallback)", context: MODULE_CONTEXT });
      }
    }

    _handleAppCurrentProjectChanged(event) {
      const newProject = event?.detail?.project;
      const oldProject = event?.detail?.previousProject; // May be useful for cleanup
      this.logger.info(`[${MODULE}] Event "currentProjectChanged" received via AppBus.`, {
        newProjectId: newProject?.id,
        oldProjectId: oldProject?.id,
        currentInternalKBProjectId: this.state.knowledgeBase?.project_id,
        context: MODULE
      });

      if (newProject?.id && newProject.id !== this.state.knowledgeBase?.project_id) {
        this.logger.info(`[${MODULE}] New project selected (${newProject.id}). Resetting KB view. Manager will load new KB.`, { context: MODULE });
        // Reset UI to prepare for new project's KB.
        // The actual fetching of KB data is expected to be triggered by an orchestrator (e.g. projectDetailsComponent)
        // which would call this.initialize() or this.manager.loadKnowledgeBase()
        // For now, simply clear and show inactive.
        this._showInactiveState();
        this.state.knowledgeBase = null; // Clear internal KB state
        // It is assumed another component (like projectDetailsComponent) will call this.initialize()
        // with the new project's KB data or trigger manager.loadKnowledgeBase().
        // If this component should be fully autonomous, it would call:
        // this.manager.loadKnowledgeBase(newProject.id);
      } else if (!newProject && this.state.knowledgeBase) {
        this.logger.info(`[${MODULE}] Project context cleared. Resetting KB view.`, { context: MODULE });
        this._showInactiveState();
        this.state.knowledgeBase = null;
      }
    }

    _getCurrentProjectId() {
      if (typeof this.app.getProjectId === "function") {
        const pid = this.app.getProjectId();
        if (this.validateUUID(pid)) return pid;
      }
      const cur = this.projectManager.currentProject;
      if (cur?.id && this.validateUUID(cur.id)) {
        return cur.id;
      }
      // notification/logging removed
      return null;
    }

    async renderKnowledgeBaseInfo(kbData, projectId = null) {
      if (!kbData) {
        this._showInactiveState();
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
        if (projectId) {
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
            new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId } })
          );
        }
        return;
      }

      this.state.knowledgeBase = kbData;
      const currentProjectId = projectId || kbData.project_id || this._getCurrentProjectId();
      this.logger.info(`[${MODULE}] Rendering KB Info for KB ID: ${kbData.id}, Project ID: ${currentProjectId}`, { kbData, context: MODULE });

      if (this.elements.activeSection?.dataset) {
        this.elements.activeSection.dataset.projectId = currentProjectId || "";
      }
      this._updateBasicInfo(kbData);
      this.manager._updateModelSelection(kbData.embedding_model); // Manager might need this method if it manipulates the select
      this._updateStatusIndicator(kbData.is_active !== false);

      this.elements.activeSection?.classList.remove("hidden");
      this.elements.inactiveSection?.classList?.add("hidden");
      if (this.elements.kbToggle) {
        this.elements.kbToggle.checked = kbData.is_active !== false;
      }

      try {
        if (kbData.is_active !== false && kbData.id && currentProjectId) {
          this.logger.debug(`[${MODULE}] KB is active. Loading health and files.`, { kbId: kbData.id, projectId: currentProjectId, context: MODULE });
          this.manager.loadKnowledgeBaseHealth(kbData.id).catch(err => this.logger.warn(`[${MODULE}] Error loading KB health (non-critical).`, { err, context: MODULE }));
          this.manager.loadKnowledgeBaseFiles(currentProjectId, kbData.id); // This should handle its own errors and UI updates
        } else {
          this.logger.debug(`[${MODULE}] KB is inactive or no ID. Hiding files section and clearing list.`, { kbIsActive: kbData.is_active, kbId: kbData.id, context: MODULE });
          this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
          if (this.manager._renderKnowledgeBaseFiles) { // Assuming manager has this method for direct rendering
            this.manager._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
          } else {
            const container = this.elements.knowledgeBaseFilesListContainer;
            if (container) _safeSetInnerHTML(container, '<p class="text-base-content/60 text-center py-4">Knowledge Base is inactive or has no files.</p>');
          }
        }
        this._updateStatusAlerts(kbData); // This seems to be for additional alerts, not main status
        this._updateUploadButtonsState(); // Update based on new KB state

        if (currentProjectId) {
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
            new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId: currentProjectId, knowledgeBaseId: kbData.id } })
          );
        }
      } catch (err) {
        this.logger.error(`[${MODULE}] Error during post-render KB info processing (health/files load).`, { error: err, context: MODULE });
        // Ensure event is still dispatched if there was a project ID
        if (currentProjectId) {
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
            new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId: currentProjectId, error: err.message } })
          );
        }
      }
    }

    _updateBasicInfo(kb) {
      const { kbNameDisplay, kbModelDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;
      if (kbNameDisplay) kbNameDisplay.textContent = kb.name || "Project Knowledge Base";
      if (kbModelDisplay) kbModelDisplay.textContent = kb.embedding_model || "Not Set";
      if (kbVersionDisplay) kbVersionDisplay.textContent = kb.version ? `v${kb.version}` : "v1";
      if (kbLastUsedDisplay) kbLastUsedDisplay.textContent = kb.last_used ? this.formatDate(kb.last_used) : "Never used";
    }

    _updateStatusIndicator(isActive) {
      const badge = this.elements.statusBadge;
      if (!badge) return;
      badge.className = `badge ${isActive ? "badge-success" : "badge-warning"} badge-sm`;
      badge.textContent = isActive ? "Active" : "Inactive";
    }

    _showInactiveState() {
      this.logger.info(`[${MODULE}] Showing inactive state.`, { context: MODULE });
      this.state.knowledgeBase = null; // Clear internal state

      this.elements.activeSection?.classList.add("hidden");
      this.elements.inactiveSection?.classList.remove("hidden");
      this.elements.knowledgeBaseFilesSection?.classList.add("hidden");

      // Clear displayed KB info
      if (this.elements.kbNameDisplay) this.elements.kbNameDisplay.textContent = "N/A";
      if (this.elements.kbModelDisplay) this.elements.kbModelDisplay.textContent = "N/A";
      if (this.elements.kbVersionDisplay) this.elements.kbVersionDisplay.textContent = "N/A";
      if (this.elements.kbLastUsedDisplay) this.elements.kbLastUsedDisplay.textContent = "N/A";
      if (this.elements.knowledgeFileCount) this.elements.knowledgeFileCount.textContent = "0";
      if (this.elements.knowledgeChunkCount) this.elements.knowledgeChunkCount.textContent = "0";
      if (this.elements.knowledgeFileSize) this.elements.knowledgeFileSize.textContent = this.formatBytes(0);


      if (this.manager?._renderKnowledgeBaseFiles) { // Ask manager to clear its file list UI
        this.manager._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
      } else if (this.elements.knowledgeBaseFilesListContainer) { // Fallback if manager method not available
        _safeSetInnerHTML(this.elements.knowledgeBaseFilesListContainer, '<p class="text-base-content/60 text-center py-4">No Knowledge Base active or selected.</p>');
      }

      this._updateStatusIndicator(false); // Set status badge to "Inactive"
      // Consider if an alert is always needed or if the UI state is clear enough
      // this._showStatusAlert("Knowledge Base is not active or configured for this project.", "info");
      this._updateUploadButtonsState(); // Disable KB-dependent buttons
    }

    _updateUploadButtonsState() {
      const hasKB = !!this.state.knowledgeBase;
      const isActive = hasKB && this.state.knowledgeBase.is_active !== false;
      const kbDependentEls = this.domAPI.querySelectorAll("[data-requires-kb='true']", this.elements.container);
      kbDependentEls.forEach((el) => {
        const disabled = !hasKB || !isActive;
        el.disabled = disabled;
        el.classList.toggle("opacity-50", disabled);
        el.classList.toggle("cursor-not-allowed", disabled);
        el.title = disabled ? (!hasKB ? "Setup Knowledge Base first." : "Knowledge Base must be active.") : "Ready to use Knowledge Base features.";
      });
      if (this.elements.reprocessButton) {
        const fileCountEl = this.domAPI.getElementById("knowledgeFileCount");
        const fileCount = parseInt(fileCountEl?.textContent || "0", 10);
        const reDisabled = !hasKB || !isActive || fileCount === 0;
        this.elements.reprocessButton.disabled = reDisabled;
        this.elements.reprocessButton.classList.toggle("opacity-50", reDisabled);
        this.elements.reprocessButton.classList.toggle("cursor-not-allowed", reDisabled);
        this.elements.reprocessButton.title = !hasKB ? "Setup Knowledge Base first." : !isActive ? "Knowledge Base must be active." : fileCount === 0 ? "No files to reprocess." : "Reprocess files.";
      }
    }

    _updateStatusAlerts(kb) {
      // notification/logging removed; adjust as needed if visual indicator required
    }

    _showStatusAlert(message, type = "info") {
      const statusIndicator = this.domAPI.getElementById("kbStatusIndicator");
      if (!statusIndicator) {
        return;
      }
      statusIndicator.textContent = "";
      let cls = "alert-info";
      if (type === "success") cls = "alert-success";
      else if (type === "warning") cls = "alert-warning";
      else if (type === "error") cls = "alert-error";
      const alertDiv = this.domAPI.createElement("div");
      alertDiv.className = `alert ${cls} shadow-xs text-sm py-2 px-3`;
      alertDiv.setAttribute("role", "alert");
      _safeSetInnerHTML(alertDiv, `<span>${message}</span>`);
      if (type !== "error") {
        const btn = this.domAPI.createElement("button");
        btn.className = "btn btn-xs btn-ghost btn-circle";
        btn.textContent = "✕";
        this.eventHandlers.trackListener(
          btn,
          'click',
          () => this.domAPI.removeChild(statusIndicator, alertDiv),
          { context: MODULE, description: 'dismissStatusAlert' }
        );
        this.domAPI.appendChild(alertDiv, btn);
      }
      this.domAPI.appendChild(statusIndicator, alertDiv);
    }

    _debounce(fn, wait) {
      let id;
      return (...a) => {
        this.scheduler.clearTimeout?.(id);
        id = this.scheduler.setTimeout?.(() => fn.apply(this, a), wait);
      };
    }

    _handleAuthStateChange(authenticated) {
      this.logger.debug(`[${MODULE}] Auth state changed. Authenticated: ${authenticated}`, { context: MODULE });
      // CONSOLIDATED: No local authState storage - read from appModule.state when needed

      // List of elements that depend on authentication for enabling/disabling
      const authDependentElements = [
        this.elements.searchButton, this.elements.reprocessButton, this.elements.setupButton,
        this.elements.kbToggle, this.elements.settingsButton, this.elements.deleteKnowledgeBaseBtn,
        this.elements.kbAttachRepoBtn, this.elements.kbDetachRepoBtn,
        // Add other elements like file input / upload button if they are directly part of this component's elements
      ];

      authDependentElements.forEach((el) => {
        if (!el) return; // Skip if an optional element isn't found
        el.disabled = !authenticated;
        el.classList.toggle("opacity-50", !authenticated);
        el.classList.toggle("cursor-not-allowed", !authenticated);
        if (!authenticated) {
          el.title = "Authentication required.";
        } else {
          el.removeAttribute("title"); // Or set to its functional title
        }
      });

      if (!authenticated) {
        this.logger.info(`[${MODULE}] User unauthenticated. Clearing KB data and showing inactive state.`, { context: MODULE });
        this._showStatusAlert("Authentication required to use Knowledge Base features.", "warning");
        // Clear KB data and UI to prevent interaction with stale data
        this.state.knowledgeBase = null;
        this._showInactiveState();
      } else {
        // User is authenticated. If there's a current project, KB data might need to be (re)loaded
        // This is often handled by currentProjectChanged or initial load sequence.
        // For now, just ensure UI elements are enabled.
        this.logger.debug(`[${MODULE}] User authenticated. KB UI elements enabled. KB data will load if project context is active.`, { context: MODULE });
        // Potentially re-check/re-load KB if a project is active:
        // const currentProjectId = this._getCurrentProjectId();
        // if (currentProjectId) { this.manager.loadKnowledgeBase(currentProjectId); }
      }
    }
  }

  class KnowledgeBaseComponentWithDestroy extends KnowledgeBaseComponent {
    destroy() {
      const ds = this.getDep('DependencySystem');
      if (ds && typeof ds.cleanupModuleListeners === 'function') {
        ds.cleanupModuleListeners(MODULE);
      } else if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
        this.eventHandlers.cleanupListeners({ context: MODULE });
      }
      // destroy complete
    }
  }

 // --- public API export (no spread-clone) ---
 const instance = new KnowledgeBaseComponentWithDestroy();

 // patch-in canonical cleanup that also clears listeners
 const _origCleanup = typeof instance.cleanup === 'function'
     ? instance.cleanup.bind(instance)
     : () => {};

 instance.cleanup = function (...args) {
   (instance.getDep('DependencySystem')?.modules.get('eventHandlers')
     || instance.eventHandlers)
     ?.cleanupListeners({ context: 'KnowledgeBaseComponent' });
   _origCleanup(...args);
 };

 // --- never expose `.state` directly – wrap instance ------------------
 const publicAPI = new Proxy(instance, {
   get (t, p, r) {
     if (p === 'state') throw new Error('[KBComponent] state is private');
     const v = Reflect.get(t, p, r);
     return (typeof v === 'function') ? v.bind(t) : v;
   },
   set (t, p, v, r) {
     if (p === 'state') throw new Error('[KBComponent] state is read-only');
     return Reflect.set(t, p, v, r);
   },
   has (t, p)                { return (p === 'state') ? false : Reflect.has(t, p); },
   ownKeys (t)               { return Reflect.ownKeys(t).filter(k => k !== 'state'); },
   getOwnPropertyDescriptor (t, p) {
     return (p === 'state') ? undefined : Reflect.getOwnPropertyDescriptor(t, p);
   }
 });

 return publicAPI;
}

export default createKnowledgeBaseComponent;
