/**
 * @module knowledgeBaseComponent
 * @description Refactored factory: NO global document/window. All DOM and event wiring via DI.
 */

import { createKnowledgeBaseSearchHandler } from './knowledgeBaseSearchHandler.js';
import { createKnowledgeBaseManager } from './knowledgeBaseManager.js';

const MODULE = "KnowledgeBaseComponent";
export function createKnowledgeBaseComponent(options = {}) {
  // --- Dependency Resolution ---
  if (!options.DependencySystem) throw new Error("DependencySystem is required for KnowledgeBaseComponent");
  const DS = options.DependencySystem;
  const getDep = (name) => name in options ? options[name] : DS.modules.get(name);

  const sanitizer = getDep("sanitizer");
  const app = getDep("app");
  const projectManager = getDep("projectManager");
  const eventHandlers = getDep("eventHandlers");
  const uiUtils = getDep("uiUtils") || getDep("uiUtilsInstance");
  const modalManager = getDep("modalManager");
  const domAPI = getDep("domAPI");
  if (!sanitizer || typeof sanitizer.sanitize !== 'function')
    throw new Error("KnowledgeBaseComponent requires 'sanitizer' (object with .sanitize).");
  if (!app || !projectManager || !eventHandlers || !uiUtils || !modalManager) {
    throw new Error(
      "KnowledgeBaseComponent requires 'app', 'projectManager', 'eventHandlers', 'uiUtils', and 'modalManager' dependencies."
    );
  }
  if (!domAPI) throw new Error(`${MODULE} requires 'domAPI' abstraction for DOM access.`);

  // --- Element Selectors (resolution deferred to init) ---
  const elRefs = options.elRefs || {}; // For externally provided elements
  // Removed reqEl function from factory scope. It will be part of _initElements.
  const elementSelectors = { // Renamed from 'elements'
    container: "knowledgeTab", // Store selectors (strings)
    activeSection: "knowledgeStatus",
    inactiveSection: "knowledgeBaseInactive",
    statusBadge: "kbStatusBadge",
    searchInput: "knowledgeSearchInput",
    searchButton: "searchKnowledgeBtn",
    resultsContainer: "knowledgeResults",
    resultsSection: "knowledgeResults",
    noResultsSection: "noResults",
    topKSelect: "knowledgeTopK",
    kbToggle: "knowledgeBaseEnabled",
    reprocessButton: "reprocessFilesBtn",
    setupButton: "setupKnowledgeBaseBtn",
    settingsButton: "knowledgeBaseSettingsBtn",
    kbNameDisplay: "knowledgeBaseName",
    kbModelDisplay: "knowledgeBaseModelDisplay",
    kbVersionDisplay: "knowledgeBaseVersionDisplay",
    kbLastUsedDisplay: "knowledgeBaseLastUsedDisplay",
    settingsModal: "knowledgeBaseSettingsModal",
    settingsForm: "knowledgeBaseForm",
    cancelSettingsBtn: "cancelKnowledgeBaseFormBtn",
    deleteKnowledgeBaseBtn: "deleteKnowledgeBaseBtn",
    modelSelect: "knowledgeBaseModelSelect",
    resultModal: "knowledgeResultModal",
    resultTitle: "knowledgeResultTitle",
    resultSource: "knowledgeResultSource",
    resultScore: "knowledgeResultScore",
    resultContent: "knowledgeResultContent",
    useInChatBtn: "useInChatBtn",
    knowledgeBaseFilesSection: "knowledgeBaseFilesSection",
    knowledgeBaseFilesListContainer: "knowledgeBaseFilesListContainer",
    kbGitHubAttachedRepoInfo: "kbGitHubAttachedRepoInfo",
    kbAttachedRepoUrlDisplay: "kbAttachedRepoUrlDisplay",
    kbAttachedRepoBranchDisplay: "kbAttachedRepoBranchDisplay",
    kbDetachRepoBtn: "kbDetachRepoBtn",
    kbGitHubAttachForm: "kbGitHubAttachForm",
    kbGitHubRepoUrlInput: "kbGitHubRepoUrlInput",
    kbGitHubBranchInput: "kbGitHubBranchInput",
    kbGitHubFilePathsTextarea: "kbGitHubFilePathsTextarea",
    kbAttachRepoBtn: "kbAttachRepoBtn",
    knowledgeFileCount: "knowledgeFileCount",
    knowledgeChunkCount: "knowledgeChunkCount",
    knowledgeFileSize: "knowledgeFileSize",
  };

  const validateUUID = app.validateUUID;
  const apiRequest = app.apiRequest;
  const config = {
    maxConcurrentProcesses: options.maxConcurrentProcesses || 3,
    searchDebounceTime: options.searchDebounceTime || 300,
    minQueryLength: options.minQueryLength || 2,
    maxQueryLength: options.maxQueryLength || 500,
  };

  function _safeSetInnerHTML(el, html) {
    if (!el) return;
    el.innerHTML = sanitizer.sanitize(html);
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
      this.DependencySystem = DS; // Assign DependencySystem to the instance

      this.elementSelectors = elementSelectors; // Store selectors from factory
      this.elements = {}; // Will be populated by _initElements
      this.elRefs = elRefs; // Store elRefs passed in options for _initElements
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

      // Provide all cb/utilities needed by manager/searchHandler
      this._safeSetInnerHTML = _safeSetInnerHTML;
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

      // Add utility methods needed by manager
      this._showInactiveState = this._showInactiveState.bind(this);
      this._updateStatusIndicator = this._updateStatusIndicator.bind(this);
      this._updateStatusAlerts = this._updateStatusAlerts.bind(this);
      this._updateUploadButtonsState = this._updateUploadButtonsState.bind(this);
      this.renderKnowledgeBaseInfo = this.renderKnowledgeBaseInfo.bind(this);

      // For model/validation logic
      this._debounce = this._debounce.bind(this);

      this.searchHandler = createKnowledgeBaseSearchHandler(this);
      this.manager = createKnowledgeBaseManager(this);

      this._bindEventHandlers();
    }

    _initElements() {
      const OPTIONAL_KEYS = new Set([
        'activeSection','inactiveSection','statusBadge',
        'kbToggle','reprocessButton','setupButton','settingsButton',
        'kbNameDisplay','kbModelDisplay','kbVersionDisplay','kbLastUsedDisplay',
        'knowledgeBaseFilesSection','knowledgeBaseFilesListContainer',
        'kbGitHubAttachedRepoInfo','kbAttachedRepoUrlDisplay',
        'kbAttachedRepoBranchDisplay','kbDetachRepoBtn',
        'kbGitHubAttachForm','kbGitHubRepoUrlInput',
        'kbGitHubBranchInput','kbGitHubFilePathsTextarea','kbAttachRepoBtn',
        'kbModelDisplay', 'kbVersionDisplay', 'kbLastUsedDisplay',
        'kbGitHubAttachedRepoInfo', 'kbAttachedRepoUrlDisplay',
        'kbAttachedRepoBranchDisplay', 'kbDetachRepoBtn',
        'kbNameDisplay', // extend later if needed
        'knowledgeFileCount', 'knowledgeChunkCount', 'knowledgeFileSize',
        'noResultsSection'      // ← add this line
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
        this.elements[key === "noResultsSection" ? "noResultsSection" : key] = reqEl(key, this.elementSelectors[key]);
      }
    }

    async initialize(isVisible, kbData = null, projectId = null) {
      try {
        this._initElements(); // Resolve DOM elements now
      } catch (error) {
        const logger = this.getDep('logger');
        logger?.error(`[${MODULE}] Failed to initialize elements: ${error.message}`, error);
        this.domAPI.dispatchEvent(
          this.domAPI.getDocument(),
          new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: false, error } })
        );
        // Optionally, display an error in the UI or throw to prevent further execution
        // For now, let's make the component non-functional but not break the app
        this.elements.container?.classList.add("hidden"); // Hide if container was found
        return; // Stop initialization
      }

      if (this.state.isInitialized && !isVisible) {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList?.add("hidden");
        this.elements.knowledgeBaseFilesSection?.classList?.add("hidden");
        return;
      }

      this.state.isInitialized = true;

      if (kbData) {
        await this.renderKnowledgeBaseInfo(kbData, projectId);
      } else {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
        this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
        if (projectId) {
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
            new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId } })
          );
        }
      }

      this.elements.container.classList.toggle("hidden", !isVisible);
      this.elements.container.classList.toggle("pointer-events-none", !isVisible);

      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent('knowledgebasecomponent:initialized', { detail: { success: true } })
      );
    }

    _bindEventHandlers() {
      const EH = this.eventHandlers;
      const DA = this.domAPI;
      const MODULE_CONTEXT = MODULE;

      const addListener = (el, type, fn, opts = {}) => {
        if (el) {
          EH.trackListener(el, type, fn, { ...opts, context: MODULE_CONTEXT });
        }
      };

      // Search UI
      addListener(this.elements.searchButton, "click", () => this.searchHandler.triggerSearch(), { description: "KB Search Button" });
      addListener(this.elements.searchInput, "input", (e) => this.searchHandler.debouncedSearch(e.target.value), { description: "KB Search Input" });
      addListener(this.elements.searchInput, "keyup", (e) => { if (e.key === "Enter") this.searchHandler.triggerSearch(); }, { description: "KB Search Enter" });
      addListener(this.elements.resultModal, "keydown", (e) => this.searchHandler.handleResultModalKeydown(e), { description: "KB Result Modal Keydown" });

      // Management UI
      addListener(this.elements.kbToggle, "change", (e) => this.manager.toggleKnowledgeBase(e.target.checked), { description: "KB Toggle Active" });
      addListener(this.elements.reprocessButton, "click", () => {
        const pid = this._getCurrentProjectId();
        if (pid) this.manager.reprocessFiles(pid);
      }, { description: "KB Reprocess Files" });

      const showModalHandler = () => {
        // notification/logging removed
        this.manager.showKnowledgeBaseModal();
      };
      addListener(this.elements.setupButton, "click", showModalHandler, { description: "KB Setup Button" });
      addListener(this.elements.settingsButton, "click", showModalHandler, { description: "KB Settings Button" });
      addListener(this.elements.settingsForm, "submit", (e) => this.manager.handleKnowledgeBaseFormSubmit(e), { description: "KB Settings Form Submit" });
      addListener(this.elements.cancelSettingsBtn, "click", () => this.manager.hideKnowledgeBaseModal(), { description: "KB Cancel Settings" });
      addListener(this.elements.deleteKnowledgeBaseBtn, "click", () => this.manager.handleDeleteKnowledgeBase(), { description: "KB Delete Button" });
      addListener(this.elements.modelSelect, "change", () => this.manager.validateSelectedModelDimensions(), { description: "KB Model Select Change" });

      // GitHub integration
      addListener(this.elements.kbAttachRepoBtn, "click", () => this.manager.handleAttachGitHubRepo(), { description: "KB Attach GitHub Repo" });
      addListener(this.elements.kbDetachRepoBtn, "click", () => this.manager.handleDetachGitHubRepo(), { description: "KB Detach GitHub Repo" });

      // Auth state change—NO GLOBAL document usage; use injected bus/doc only
      addListener(this.domAPI.getDocument(), "authStateChanged", (e) => {
        this._handleAuthStateChange(e.detail?.authenticated);
      }, { description: "KB Auth State Change Listener" });
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

      const pid = projectId || kbData.project_id || this._getCurrentProjectId();
      if (this.elements.activeSection?.dataset) {
        this.elements.activeSection.dataset.projectId = pid || "";
      }
      this._updateBasicInfo(kbData);
      this.manager._updateModelSelection(kbData.embedding_model);
      this._updateStatusIndicator(kbData.is_active !== false);

      this.elements.activeSection?.classList.remove("hidden");
      this.elements.inactiveSection?.classList?.add("hidden");
      if (this.elements.kbToggle) {
        this.elements.kbToggle.checked = kbData.is_active !== false;
      }

      try {
        if (kbData.is_active !== false && kbData.id) {
          this.manager.loadKnowledgeBaseHealth(kbData.id)
            .catch(() => {});
          this.manager.loadKnowledgeBaseFiles(pid, kbData.id);
        } else {
          this.elements.knowledgeBaseFilesSection?.classList.add("hidden");
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
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
            new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId: pid } })
          );
        }
      } catch (err) {
        if (pid) {
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
            new CustomEvent('projectKnowledgeBaseRendered', { detail: { projectId: pid } })
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
      this.state.knowledgeBase = null;
      if (this.elements.activeSection && this.elements.activeSection.classList) {
        this.elements.activeSection.classList.add("hidden");
      }
      if (this.elements.inactiveSection && this.elements.inactiveSection.classList) {
        this.elements.inactiveSection.classList.remove("hidden");
        // If there was an old reference to this.elements.knowledgeNoResults, update to .noResultsSection
      }
      if (this.elements.knowledgeBaseFilesSection && this.elements.knowledgeBaseFilesSection.classList) {
        this.elements.knowledgeBaseFilesSection.classList.add("hidden");
      }
      if (this.manager?._renderKnowledgeBaseFiles) {
        this.manager._renderKnowledgeBaseFiles({ files: [], pagination: { total: 0 } });
      } else if (this.elements.knowledgeBaseFilesListContainer) {
        _safeSetInnerHTML(this.elements.knowledgeBaseFilesListContainer, '<p class="text-base-content/60 text-center py-4">No files currently in the Knowledge Base.</p>');
      }
      this._updateStatusIndicator(false);
      this._showStatusAlert("Knowledge Base needed. Click 'Setup'.", "info");
      this._updateUploadButtonsState();
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
        btn.onclick = () => alertDiv.remove();
        alertDiv.appendChild(btn);
      }
      statusIndicator.appendChild(alertDiv);
    }

    _debounce(fn, wait) {
      let id;
      return (...a) => {
        this.scheduler.clearTimeout?.(id);
        id = this.scheduler.setTimeout?.(() => fn.apply(this, a), wait);
      };
    }

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
  }

  class KnowledgeBaseComponentWithDestroy extends KnowledgeBaseComponent {
    destroy() {
      const ds = this.getDep('DependencySystem');
      if (ds && typeof ds.cleanupModuleListeners === 'function') {
        ds.cleanupModuleListeners(MODULE);
      } else if (this.eventHandlers && typeof this.eventHandlers.cleanupListeners === 'function') {
        this.eventHandlers.cleanupListeners({ context: MODULE });
      }
      this.state.isInitialized = false;
      // destroy complete
    }
  }

  return new KnowledgeBaseComponentWithDestroy();
}
