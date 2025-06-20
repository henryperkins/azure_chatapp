/**
 * @module knowledgeBaseComponent
 * @description Refactored factory: NO global document/window. All DOM and event wiring via DI.
 */

// All sub-factories must be resolved via DependencySystem to respect DI guard-rails.
import { ELEMENT_SELECTORS } from './utils/selectorConstants.js';

// Renderer factory is resolved via DI at runtime, but we keep the type
// reference for editors / bundlers that perform static analysis.  Do NOT
// import the implementation directly – that would violate the guard-rails.
// import { createKnowledgeBaseRenderer } from './knowledgeBaseRenderer.js';

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
  const dsModules = DS.modules;
  const getDep = (name) => (name in options ? options[name] : dsModules.get(name));

  const sanitizer = getDep("sanitizer");
  const app = getDep("appModule") || getDep("app");
  const projectManager = getDep("projectManager");
  const eventHandlers = getDep("eventHandlers");
  const uiUtils = getDep("uiUtils") || getDep("uiUtilsInstance");
  const modalManager = getDep("modalManager");
  const domAPI = getDep("domAPI");
  const domReadinessService = getDep("domReadinessService");
  const logger = getDep("logger"); // Ensure logger is fetched for constructor scope if needed early

  // ---------------------------------------------------------------------------
  // Resolve renderer factory — may be absent in early test harnesses.
  // If it's missing, fall back to a minimal no-op stub that satisfies
  // the method surface needed by this controller during unit tests.
  // *Do not* throw here because the DI-contract tests purposefully omit the
  // renderer to keep the harness lightweight.
  // ---------------------------------------------------------------------------

  let createKnowledgeBaseRenderer = getDep('KBRendererFactory');

  /*
   * When the KnowledgeBaseComponent is instantiated inside the full
   * application, `KBRendererFactory` will be registered during the UI init
   * phase.  However, several unit-test suites spin up only a subset of the DI
   * tree and therefore do not register the renderer.  In that environment we
   * lazily create an inert stub so the factory still resolves without
   * violating guard-rails.
   */
  if (!createKnowledgeBaseRenderer || typeof createKnowledgeBaseRenderer !== 'function') {
    const noop = () => {};
    createKnowledgeBaseRenderer = () => ({
      initialize: noop,
      cleanup: noop,
      elements: {},
      updateBasicInfo: noop,
      updateStatusIndicator: noop,
      updateUploadButtonsState: noop,
      showInactiveState: noop,
      renderFileList: noop,
      setActiveTab: noop,
    });
  }

  // ---------------------------------------------------------------------------
  // Resolve buses and auth module ONCE at factory-time so that no runtime
  // container look-ups occur after instantiation (guard-rails compliant).
  // ---------------------------------------------------------------------------

  // Primary unified bus.
  const eventService = getDep("eventService") || null;

  // Legacy AuthBus fallback – _only_ used if eventService is missing (e.g. in
  // very early unit-test harnesses that still stub the old bus).
  const authModule = getDep("auth");
  const authBus = authModule?.AuthBus || null;

  // Expose a raw EventTarget for modules that still rely on direct
  // addEventListener/removeEventListener calls.  We prefer the real bus from
  // eventService (via the internal helper) and gracefully fall back to any
  // legacy AppBus still registered in the container.
  const appBus =
    // 1) eventService internal bus (most recent implementation)
    (typeof eventService?._getBus === 'function' ? eventService._getBus() : null) ||
    // 2) Deprecated AppBus registered during bootstrapCore
    getDep("AppBus") ||
    // 3) As a last resort the authBus (they used to be interchangeable)
    authBus ||
    null;

  // Resolve KB sub-factories via DI (registered in appInitializer)
  const createKnowledgeBaseManager = getDep("KBManagerFactory");
  const createKnowledgeBaseSearchHandler = getDep("KBSearchHandlerFactory");

  if (!createKnowledgeBaseManager || typeof createKnowledgeBaseManager !== 'function') {
    throw new Error(`[${MODULE}] Missing KBManagerFactory (createKnowledgeBaseManager) in DependencySystem`);
  }
  if (!createKnowledgeBaseSearchHandler || typeof createKnowledgeBaseSearchHandler !== 'function') {
    throw new Error(`[${MODULE}] Missing KBSearchHandlerFactory (createKnowledgeBaseSearchHandler) in DependencySystem`);
  }

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

  // Resolve selector constants via DI if available
  const selectorConstantsFromDI = DS?.modules?.has?.('ELEMENT_SELECTORS')
    ? DS.modules.get('ELEMENT_SELECTORS')
    : null;

  const elementSelectorsBase = selectorConstantsFromDI?.KB || ELEMENT_SELECTORS.KB;

  // Use centralized selectors for consistency
  const elementSelectors = {
    ...elementSelectorsBase,
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
    container: elementSelectorsBase.container,
    activeSection: elementSelectorsBase.activeSection,
    inactiveSection: elementSelectorsBase.inactiveSection,
    statusBadge: elementSelectorsBase.statusBadge,
    kbToggle: elementSelectorsBase.toggle,
    reprocessButton: elementSelectorsBase.reprocessButton,
    setupButton: elementSelectorsBase.setupButton,
    settingsButton: elementSelectorsBase.settingsButton,
    kbNameDisplay: elementSelectorsBase.baseName,
    kbModelDisplay: elementSelectorsBase.modelDisplay,
    kbVersionDisplay: elementSelectorsBase.versionDisplay,
    kbLastUsedDisplay: elementSelectorsBase.lastUsedDisplay,
    settingsModal: elementSelectorsBase.settingsModal,
    settingsForm: elementSelectorsBase.settingsForm,
    cancelSettingsBtn: elementSelectorsBase.cancelSettingsBtn,
    deleteKnowledgeBaseBtn: elementSelectorsBase.deleteBtn,
    modelSelect: elementSelectorsBase.modelSelect,
    knowledgeBaseFilesSection: elementSelectorsBase.filesSection,
    knowledgeBaseFilesListContainer: elementSelectorsBase.filesListContainer,
    knowledgeFileCount: elementSelectorsBase.docCount,
    knowledgeChunkCount: elementSelectorsBase.chunkCount,
    knowledgeFileSize: elementSelectorsBase.fileSize,
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

    // Sanitize any string that will be injected to mitigate XSS vectors.
    // We explicitly ignore non-string values so domAPI can still inject
    // Node objects when required by other internal helpers.
    if (typeof html === 'string' && sanitizer?.sanitize) {
      html = sanitizer.sanitize(html, { ALLOWED_TAGS: false, ALLOWED_ATTR: false });
    }

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

      // Buses / modules captured at factory-time to avoid runtime look-ups
      this.appBus = appBus;
      this.authModule = authModule;
      this.authBus = authBus;
      this.eventService = eventService;

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
        // Track whether initialize() has completed successfully
        initialized: false,
        // CONSOLIDATED: No local authState - read from appModule.state
      };

      this.formatBytes = uiUtils.formatBytes;
      this.formatDate = uiUtils.formatDate;
      this.fileIcon = uiUtils.fileIcon;
      this.scheduler = getDep("scheduler") || { setTimeout, clearTimeout };

      // -------------------- UI renderer ------------------------------------
      this.renderer = createKnowledgeBaseRenderer({
        domAPI,
        uiUtils,
        sanitizer,
        logger,
        elementSelectors,
        elRefs
      });

      // Bridge old instance methods → renderer (keeps public API stable)
      this._updateBasicInfo = (...a) => this.renderer.updateBasicInfo(...a);
      this._updateStatusIndicator = (...a) => this.renderer.updateStatusIndicator(...a);
      this._updateUploadButtonsState = () => {
        const hasKB = !!this.state.knowledgeBase;
        const isActive = hasKB && this.state.knowledgeBase.is_active !== false;
        this.renderer.updateUploadButtonsState({
          hasKB,
          isActive,
          formatBytes: this.formatBytes
        });
      };

      this._showInactiveState = () => {
        // Reset internal reference so business logic knows KB is gone.
        this.state.knowledgeBase = null;

        // Delegate UI clearing to renderer
        this.renderer.showInactiveState({ formatBytes: this.formatBytes });

        // Ask manager (if present) to clear its file list to avoid stale rows
        // Clear any existing file list via renderer
        this.renderer.renderFileList({ files: [], pagination: { total: 0 } }, { uiUtils: this.uiUtils });

        // Reflect disabled/enabled state across upload / action buttons
        this._updateUploadButtonsState();
      };

      // Public helper for outside modules (via Proxy) to know init status
      this.isInitialized = () => this.state.initialized === true;

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



    async initialize(isVisible, kbData = null, projectId = null) {
      if (this.state.initialized) {
        // Already initialised – optionally update visibility only
        if (isVisible && this.elements?.container) {
          this.elements.container.classList.remove('hidden');
        }
        return;
      }
      // Build selector list excluding optional search/UI selectors so
      // domReadinessService does not wait for elements that may not be
      // present in certain templates (e.g., mobile view without KB search).
      const OPTIONAL_KEYS = new Set([
        'searchInput', 'searchButton', 'modelSelect',
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
        // Initialise renderer & element references
        this.renderer.initialize();
        this.elements = this.renderer.elements;
        await this._initializeSearchHandler();
        this._bindEventHandlers(); // Bind handlers after elements are initialized

        // Mark component as fully initialised to prevent re-initialisation.
        this.state.initialized = true;
      } catch (error) {
        this.logger.error(`[${MODULE}] Failed to initialize elements or bind handlers: ${error.message}`, { error, context: MODULE });
        this.domAPI.dispatchEvent(
          this.domAPI.getDocument(),
          new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: false, error } })
        );
        this.elements.container?.classList.add("hidden");
        return;
      }

      // Use injected authBus / authModule captured during factory construction
      const auth = this.authModule;
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
          // Use eventService if available, otherwise fall back to AuthBus or document
          if (this.eventService) {
            this.eventService.on('authReady', () => {
              resolve();
            }, { context: MODULE, once: true });
          } else {
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
          }
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
      const _DA = this.domAPI; // underscore-prefixed to satisfy no-unused-vars
      const MODULE_CONTEXT = MODULE; // Defined at the top of the factory

      const addListener = (elRef, type, fn, opts = {}) => {
        const element = typeof elRef === 'string' ? this.elements[elRef] : elRef;
        if (element) {
          EH.trackListener(element, type, fn, {
            ...opts,
            context: MODULE_CONTEXT,
            description: opts.description || `${elRef}_${type}`
          });
        } else {
          // When optional UI fragments (e.g., mobile view without search bar) are
          // not present, quietly skip listener registration.  A debug-level log
          // prevents noisy WARN spam while still allowing deep diagnostics when
          // LOG_LEVEL is set to DEBUG.
          this.logger.debug(
            `[${MODULE}] Optional element ref "${elRef}" absent – skipped ${type} listener registration.`,
            { context: MODULE_CONTEXT }
          );
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
      const appBus = this.appBus;
      if (appBus) {
        EH.trackListener(appBus, 'currentProjectChanged', this._handleAppCurrentProjectChanged.bind(this),
          { context: MODULE, description: 'KBComponent_AppBus_CurrentProjectChanged' });
        this.logger.debug(`[${MODULE}] Subscribed to AppBus "currentProjectChanged".`, { context: MODULE });

        // ────────────────────────────────────────────────────────────────
        // Week-3: Observability – update status badge based on KB events
        // ────────────────────────────────────────────────────────────────

        // Helper inline so it captures `this` context cleanly
        const _updateBadgeState = (state) => {
          const badgeEl = this.elements.statusBadge;
          if (!badgeEl) return;
          switch (state) {
            case 'processing':
              badgeEl.className = 'badge badge-warning badge-sm';
              badgeEl.textContent = 'Processing';
              break;
            case 'ready':
              badgeEl.className = 'badge badge-success badge-sm';
              badgeEl.textContent = 'Ready';
              break;
            case 'error':
              badgeEl.className = 'badge badge-error badge-sm';
              badgeEl.textContent = 'Error';
              break;
            default:
              // fallback to inactive styling handled elsewhere
              break;
          }
        };

        EH.trackListener(appBus, 'knowledgebase:jobProgress', (ev) => {
          const status = ev?.detail?.status;
          if (status === 'processing' || status === 'pending') {
            _updateBadgeState('processing');
          }
        }, { context: MODULE, description: 'KBComponent_KB_JobProgress' });

        EH.trackListener(appBus, 'knowledgebase:ready', () => {
          _updateBadgeState('ready');
        }, { context: MODULE, description: 'KBComponent_KB_Ready' });
      } else {
        this.logger.error(`[${MODULE}] AppBus not available. Cannot subscribe to "currentProjectChanged". Critical for functionality.`, { context: MODULE });
      }

      // Listen to eventService for authStateChanged (unified event system)
      if (this.eventService) {
        this.eventService.on("authStateChanged", (e) => {
          this.logger.debug(`[${MODULE}] eventService authStateChanged event received.`, { detail: e.detail, context: MODULE_CONTEXT });
          this._handleAuthStateChange(e.detail?.authenticated);
        }, { description: "KB eventService authStateChanged Listener", context: MODULE_CONTEXT });
        this.logger.debug(`[${MODULE}] Subscribed to eventService "authStateChanged".`, { context: MODULE });
      } else if (this.authBus) {
        // Fallback to AuthBus if eventService isn't available
        EH.trackListener(this.authBus, "authStateChanged", (e) => {
          this.logger.debug(`[${MODULE}] AuthBus authStateChanged event received (fallback).`, { detail: e.detail, context: MODULE_CONTEXT });
          this._handleAuthStateChange(e.detail?.authenticated);
        }, { description: "KB AuthBus authStateChanged Listener (Fallback)", context: MODULE_CONTEXT });
        this.logger.debug(`[${MODULE}] Subscribed to AuthBus "authStateChanged" (fallback).`, { context: MODULE });
      } else {
        // Final fallback to document listener
        this.logger.warn(`[${MODULE}] Neither eventService nor AuthBus available. Falling back to document listener for "authStateChanged".`, { context: MODULE });
        addListener(this.domAPI.getDocument(), "authStateChanged", (e) => {
          this._handleAuthStateChange(e.detail?.authenticated);
        }, { description: "KB Document authStateChanged Listener (Final Fallback)", context: MODULE_CONTEXT });
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

      // Close any open KB-related modals to avoid memory leaks / stale UI
      try {
        this.modalManager?.closeModal?.('*');
      } catch (err) {
        this.logger.warn(`[${MODULE}] Failed to close KB modals on project change`, { err, context: MODULE });
      }

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
      // Fallback: use global appModule state if available (Week-1 guard-rail compliant)
      const appModuleRef = this.app;
      if (appModuleRef?.state?.currentProjectId && this.validateUUID(appModuleRef.state.currentProjectId)) {
        return appModuleRef.state.currentProjectId;
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
          this.renderer.renderFileList({ files: [], pagination: { total: 0 } }, { uiUtils: this.uiUtils });
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



    _updateStatusAlerts(_kb) {
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

      // Hide status badge when logged out to prevent stale state
      const badgeEl = this.elements?.statusBadge;
      if (badgeEl) {
        if (!authenticated) {
          badgeEl.className = 'badge badge-outline badge-sm hidden';
        } else {
          // When user logs back in, reset to inactive until real status events arrive
          badgeEl.className = 'badge badge-warning badge-sm';
          badgeEl.textContent = 'Inactive';
        }
      }

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
   instance.eventHandlers?.cleanupListeners?.({ context: 'KnowledgeBaseComponent' });
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
