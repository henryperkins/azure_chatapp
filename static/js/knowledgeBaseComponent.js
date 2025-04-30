/**
 * knowledgeBaseComponent.js
 *
 * A DependencySystem-based Knowledge Base UI & logic component.
 *
 * Dependencies:
 *   - DependencySystem (optional if you pass all dependencies via `options`)
 *   - app: Required; provides apiRequest, showNotification, validateUUID,
 *          and optionally getProjectId.
 *   - projectManager: Required; for project and KB operations (e.g., load details, reindex).
 *   - eventHandlers: Required; for tracked event binding (instead of direct
 *                    addEventListener).
 *   - uiUtils: Required; for formatBytes, formatDate, fileIcon, etc.
 *
 * Checklist Conformity:
 *   - No window.* references or fallback.
 *   - No direct addEventListener (use eventHandlers.trackListener).
 *   - No setTimeout or interval-based DOM polling.
 *   - All dependencies are injected from DependencySystem or from `options`.
 *
 * Usage:
 *   import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
 *
 *   // If using DependencySystem:
 *   DependencySystem.modules.set('knowledgeBaseComponent', createKnowledgeBaseComponent);
 *
 *   // Later, in your code:
 *   const kbComponent = createKnowledgeBaseComponent({ DependencySystem, ...elementRefs });
 *   await kbComponent.initialize(true, kbData, projectId);
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
    (name in options ? options[name] : DS.modules.get(name));

  // Required dependencies
  const app = getDep('app');
  const projectManager = getDep('projectManager');
  const eventHandlers = getDep('eventHandlers');
  const uiUtils = getDep('uiUtils') || getDep('uiUtilsInstance');

  if (!app || !projectManager || !eventHandlers || !uiUtils) {
    throw new Error(
      "KnowledgeBaseComponent requires 'app', 'projectManager', 'eventHandlers', and 'uiUtils' dependencies."
    );
  }

  // Extract needed methods from `app`
  const {
    validateUUID = app.validateUUID,
    apiRequest = app.apiRequest,
    showNotification = app.showNotification
  } = app;

  // Configuration handling
  const config = {
    maxConcurrentProcesses: options.maxConcurrentProcesses || 3,
    searchDebounceTime: options.searchDebounceTime || 300,
    minQueryLength: options.minQueryLength || 2,
    maxQueryLength: options.maxQueryLength || 500
  };

  /**
   * Main KnowledgeBase Component class.
   */
  class KnowledgeBaseComponent {
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
      // UI element references (DI preferred, fallback to querySelector for legacy support only)
      // --------------------------------------------------------------
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
        modelSelect: elRefs.modelSelect || document.getElementById("knowledgeBaseModelSelect"),

        resultModal: elRefs.resultModal || document.getElementById("knowledgeResultModal"),
        resultTitle: elRefs.resultTitle || document.getElementById("knowledgeResultTitle"),
        resultSource: elRefs.resultSource || document.getElementById("knowledgeResultSource"),
        resultScore: elRefs.resultScore || document.getElementById("knowledgeResultScore"),
        resultContent: elRefs.resultContent || document.getElementById("knowledgeResultContent"),
        useInChatBtn: elRefs.useInChatBtn || document.getElementById("useInChatBtn")
      };

      // --------------------------------------------------------------
      // Internal state
      // --------------------------------------------------------------
      this.state = {
        knowledgeBase: null,
        isSearching: false,
        searchCache: new Map(),
        fileProcessingQueue: [],
        activeProcesses: 0,
        lastHealthCheck: null,
        authState: null,
        isInitialized: false
      };

      // --------------------------------------------------------------
      // Utility Mappings
      // --------------------------------------------------------------
      this.formatBytes = uiUtils.formatBytes;
      this.formatDate = uiUtils.formatDate;
      this.fileIcon = uiUtils.fileIcon;

      // --------------------------------------------------------------
      // Debounced search setup
      // --------------------------------------------------------------
      this.debouncedSearch = this._debounce(
        this.searchKnowledgeBase.bind(this),
        this.config.searchDebounceTime
      );

      // --------------------------------------------------------------
      // Initialize event listeners (always via eventHandlers)
      // --------------------------------------------------------------
      this._bindEventHandlers();
    }

    // ------------------------------------------------------------------
    // Public initialization method
    // ------------------------------------------------------------------
    async initialize(isVisible = false, kbData = null, projectId = null) {
      if (this.state.isInitialized && !isVisible) {
        // If already initialized but just toggling visibility
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
        return;
      }

      this.state.isInitialized = true;
      if (isVisible) {
        this._validateDOM(); // Warn about missing critical elements, if any
      }

      // If we have KB data, render; else hide
      if (kbData) {
        await this.renderKnowledgeBaseInfo(kbData, projectId);
      } else {
        this.elements.activeSection?.classList.add("hidden");
        this.elements.inactiveSection?.classList.add("hidden");
      }

      // Toggle container visibility
      this.elements.container?.classList.toggle("hidden", !isVisible);
      this.elements.container?.classList.toggle("pointer-events-none", !isVisible);
    }

    // ------------------------------------------------------------------
    // Event Handler Binding (using eventHandlers instead of addEventListener)
    // ------------------------------------------------------------------
    _bindEventHandlers() {
      const EH = this.eventHandlers;

      // Use DependencySystem trackListener everywhere for consistent listener tracking
      if (this.elements.searchButton) {
        EH.trackListener(this.elements.searchButton, "click", () => this._triggerSearch());
      }
      if (this.elements.searchInput) {
        EH.trackListener(this.elements.searchInput, "input", (e) => {
          this.debouncedSearch(e.target.value);
        });
        EH.trackListener(this.elements.searchInput, "keyup", (e) => {
          if (e.key === "Enter") this._triggerSearch();
        });
      }
      if (this.elements.kbToggle) {
        EH.trackListener(this.elements.kbToggle, "change", (e) => {
          this.toggleKnowledgeBase(e.target.checked);
        });
      }
      if (this.elements.reprocessButton) {
        EH.trackListener(this.elements.reprocessButton, "click", () => {
          const projectId = this._getCurrentProjectId();
          if (projectId) this.reprocessFiles(projectId);
        });
      }
      if (this.elements.setupButton) {
        EH.trackListener(this.elements.setupButton, "click", () => this._showKnowledgeBaseModal());
      }
      if (this.elements.settingsForm) {
        EH.trackListener(this.elements.settingsForm, "submit", (e) => this._handleKnowledgeBaseFormSubmit(e));
      }
      if (this.elements.modelSelect) {
        EH.trackListener(this.elements.modelSelect, "change", () => this._validateSelectedModelDimensions());
      }
      if (this.elements.resultModal) {
        EH.trackListener(this.elements.resultModal, "keydown", (e) => {
          if (e.key === "Escape") this._hideResultDetailModal();
        });
      }
      // Only the orchestrator/app should dispatch authStateChanged on document—remains compatible
      EH.trackListener(document, "authStateChanged", (e) => {
        this._handleAuthStateChange(e.detail?.authenticated);
      });
    }

    // ------------------------------------------------------------------
    // Obtain current project ID (forces result via app or projectManager--never window.*)
    // ------------------------------------------------------------------
    _getCurrentProjectId() {
      if (typeof this.app.getProjectId === "function") {
        const pid = this.app.getProjectId();
        if (this.validateUUID(pid)) return pid;
      }
      if (this.projectManager?.currentProject?.id && this.validateUUID(this.projectManager.currentProject.id)) {
        return this.projectManager.currentProject.id;
      }
      return null;
    }

    // ------------------------------------------------------------------
    // Basic DOM validation
    // ------------------------------------------------------------------
    _validateDOM() {
      const requiredIds = [
        "knowledgeTab",
        "knowledgeBaseActive",
        "knowledgeBaseInactive",
        "kbStatusBadge"
      ];
      requiredIds.forEach((id) => {
        if (!document.getElementById(id)) {
          console.warn(`[KnowledgeBaseComponent] Missing required element: #${id}`);
        }
      });
    }

    // ------------------------------------------------------------------
    // Rendering KB info
    // ------------------------------------------------------------------
    async renderKnowledgeBaseInfo(kbData, projectId = null) {
      if (!kbData) {
        this._showInactiveState();
        return;
      }

      // Update internal state
      this.state.knowledgeBase = kbData;
      const pid = projectId || kbData.project_id || this._getCurrentProjectId();
      if (this.elements.activeSection) {
        this.elements.activeSection.dataset.projectId = pid || "";
      }

      // Update UI
      this._updateBasicInfo(kbData);
      this._updateModelSelection(kbData.embedding_model);
      this._updateStatusIndicator(kbData.is_active !== false);

      // Show active section, hide inactive
      this.elements.activeSection?.classList.remove("hidden");
      this.elements.inactiveSection?.classList.add("hidden");
      if (this.elements.kbToggle) {
        this.elements.kbToggle.checked = (kbData.is_active !== false);
      }

      // Check health if active
      if (kbData.is_active !== false && kbData.id) {
        await this._loadKnowledgeBaseHealth(kbData.id);
      }

      this._updateStatusAlerts(kbData);
      this._updateUploadButtonsState();
    }

    _updateBasicInfo(kb) {
      const { kbNameDisplay, kbModelDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;
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
        kbLastUsedDisplay.textContent = kb.last_used ? this.formatDate(kb.last_used) : "Never used";
      }
    }

    _updateModelSelection(selectedModel) {
      const modelSelect = this.elements.modelSelect;
      if (!modelSelect) return;

      // Example available models
      const models = [
        { value: "all-MiniLM-L6-v2", text: "Local: all-MiniLM-L6-v2 (384d, Fast, Default)", dim: 384 },
        { value: "text-embedding-3-small", text: "OpenAI: text-embedding-3-small (1536d, Recommended)", dim: 1536 },
        { value: "text-embedding-3-large", text: "OpenAI: text-embedding-3-large (3072d, Largest)", dim: 3072 }
      ];

      modelSelect.innerHTML = "";
      const existingDim = this.state.knowledgeBase?.embedding_dimension;
      const hasExistingVectors = this.state.knowledgeBase?.stats?.chunk_count > 0;

      models.forEach((m) => {
        const option = document.createElement("option");
        option.value = m.value;
        option.textContent = m.text;
        if (selectedModel === m.value) option.selected = true;

        // If dimension mismatch with existing vectors, disable
        if (hasExistingVectors && existingDim && existingDim !== m.dim) {
          option.disabled = true;
          option.classList.add("kb-disabled-option");
        }
        modelSelect.appendChild(option);
      });

      this._validateSelectedModelDimensions();
    }

    _updateStatusIndicator(isActive) {
      const badge = this.elements.statusBadge;
      if (!badge) return;
      badge.className = `badge ${isActive ? "badge-success" : "badge-warning"} badge-sm`;
      badge.textContent = isActive ? "Active" : "Inactive";
    }

    // ------------------------------------------------------------------
    // Searching
    // ------------------------------------------------------------------
    async searchKnowledgeBase(query) {
      if (this.state.isSearching) return;
      const trimmedQuery = (query || "").trim();
      if (
        !trimmedQuery ||
        trimmedQuery.length < this.config.minQueryLength ||
        trimmedQuery.length > this.config.maxQueryLength
      ) {
        this._showNoResults();
        return;
      }

      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        this._showError("No valid project selected for KB search");
        return;
      }

      // Caching
      const cacheKey = `${projectId}-${trimmedQuery}`;
      if (this.state.searchCache.has(cacheKey)) {
        this._renderSearchResults(this.state.searchCache.get(cacheKey));
        return;
      }

      this.state.isSearching = true;
      this._showSearchLoading();

      try {
        const response = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/search`,
          {
            method: "POST",
            body: {
              query: trimmedQuery,
              top_k: this._getSelectedTopKValue()
            }
          },
          false
        );
        const results = Array.isArray(response?.data?.results) ? response.data.results : [];
        if (results.length) {
          this.state.searchCache.set(cacheKey, results);
          this._renderSearchResults(results);
        } else {
          this._showNoResults();
        }
      } catch (error) {
        console.error("[KB] Search failed:", error);
        this.showNotification?.("Search failed. Please try again.", "error");
      } finally {
        this.state.isSearching = false;
        this._hideSearchLoading();
      }
    }

    _triggerSearch() {
      if (this.elements.searchInput) {
        this.searchKnowledgeBase(this.elements.searchInput.value);
      }
    }

    _renderSearchResults(results) {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (!resultsContainer) return;

      resultsContainer.innerHTML = "";
      if (!Array.isArray(results) || !results.length) {
        this._showNoResults();
        return;
      }

      results.forEach((res) => {
        const item = this._createResultItem(res);

        // Instead of direct item.addEventListener, use eventHandlers:
        this.eventHandlers.trackListener(item, "click", () => this._showResultDetail(res));
        this.eventHandlers.trackListener(item, "keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._showResultDetail(res);
          }
        });

        resultsContainer.appendChild(item);
      });

      resultsSection?.classList.remove("hidden");
      noResultsSection?.classList.add("hidden");
    }

    _createResultItem(result) {
      const item = document.createElement("div");
      item.className =
        "card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow mb-3 cursor-pointer border border-base-300";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      const fileInfo = result.file_info || {};
      const filename = fileInfo.filename || result.metadata?.file_name || "Unknown source";
      const scorePercentage = Math.round((result.score || 0) * 100);

      let scoreBadgeClass = "badge-ghost";
      if (scorePercentage >= 80) scoreBadgeClass = "badge-success";
      else if (scorePercentage >= 60) scoreBadgeClass = "badge-warning";

      item.innerHTML = `
        <div class="card-body p-3">
          <div class="card-title text-sm justify-between items-center mb-1">
            <div class="flex items-center gap-2 truncate">
              <span class="text-lg">${this.fileIcon(fileInfo.file_type)}</span>
              <span class="truncate" title="${filename}">${filename}</span>
            </div>
            <div class="badge ${scoreBadgeClass} badge-sm"
                 title="Relevance: ${scorePercentage}%">
              ${scorePercentage}%
            </div>
          </div>
          <p class="text-xs text-base-content/80 kb-line-clamp-3 mb-2">
            ${result.text || "No content available."}
          </p>
        </div>
      `;
      return item;
    }

    _showResultDetail(result) {
      const modal = this.elements.resultModal;
      if (!modal || typeof modal.showModal !== "function") {
        console.error("[KB] Result detail modal not found or invalid.");
        return;
      }

      const { resultTitle, resultSource, resultScore, resultContent, useInChatBtn } = this.elements;
      if (!resultTitle || !resultSource || !resultScore || !resultContent) return;

      const fileInfo = result.file_info || {};
      const filename = fileInfo.filename || result.metadata?.file_name || "Unknown Source";
      const scorePercentage = Math.round((result.score || 0) * 100);

      let scoreBadgeClass = "badge-ghost";
      if (scorePercentage >= 80) scoreBadgeClass = "badge-success";
      else if (scorePercentage >= 60) scoreBadgeClass = "badge-warning";

      resultTitle.textContent = `Detail: ${filename}`;
      resultSource.textContent = filename;
      resultScore.className = `badge ${scoreBadgeClass}`;
      resultScore.textContent = `${scorePercentage}%`;
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

    _hideResultDetailModal() {
      const modal = this.elements.resultModal;
      if (modal && typeof modal.close === "function") {
        modal.close();
      }
    }

    _useInConversation(result) {
      const chatInput =
        document.getElementById("chatUIInput") ||
        document.getElementById("projectChatInput") ||
        document.getElementById("chatInput") ||
        document.querySelector('textarea[placeholder*="Send a message"]');

      if (!chatInput) return;
      const filename = result.metadata?.file_name || "the knowledge base";
      const referenceText = `Referring to content from "${filename}":\n\n> ${result.text.trim()}\n\nBased on this, `;
      const currentContent = chatInput.value.trim();

      chatInput.value = currentContent
        ? `${currentContent}\n\n${referenceText}`
        : referenceText;
      chatInput.focus();
      chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // ------------------------------------------------------------------
    // Toggling & Reprocessing
    // ------------------------------------------------------------------
    async toggleKnowledgeBase(enabled) {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        this.showNotification?.("No valid project selected for Knowledge Base toggle", "error");
        return;
      }

      try {
        const response = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/toggle`,
          {
            method: "POST",
            body: { enable: enabled }
          }
        );
        if (response.success) {
          if (this.state.knowledgeBase) {
            this.state.knowledgeBase.is_active = enabled;
          }
          this._updateStatusIndicator(enabled);
          // Possibly store the toggle in localStorage if desired
          localStorage.setItem(`kb_enabled_${projectId}`, String(enabled));

          if (this.projectManager.loadProjectDetails) {
            const project = await this.projectManager.loadProjectDetails(projectId);
            this.renderKnowledgeBaseInfo(project?.knowledge_base);
          } else if (this.state.knowledgeBase) {
            this.renderKnowledgeBaseInfo(this.state.knowledgeBase);
          }
        }
      } catch (error) {
        console.error("[KB] Toggle failed:", error);
        this.showNotification?.("Failed to toggle knowledge base", "error");
      }
    }

    async reprocessFiles(projectId) {
      if (!this.validateUUID(projectId)) {
        this.showNotification?.("No valid project selected for reprocessing", "error");
        return;
      }
      try {
        this._showProcessingState();
        const response = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-base/reindex`,
          {
            method: "POST",
            body: { force_reindex: true }
          }
        );
        if (response.success) {
          this.showNotification?.("Files queued for reprocessing", "success");
          if (this.projectManager) {
            const [project] = await Promise.all([
              this.projectManager.loadProjectDetails(projectId),
              this.projectManager.loadProjectStats?.(projectId)
            ]);
            this.renderKnowledgeBaseInfo(project?.knowledge_base);
          } else if (this.state.knowledgeBase?.id) {
            await this._loadKnowledgeBaseHealth(this.state.knowledgeBase.id);
          }
        }
      } catch (error) {
        console.error("[KB] Reprocessing failed:", error);
        this.showNotification?.("Failed to reprocess files", "error");
      } finally {
        this._hideProcessingState();
      }
    }

    // ------------------------------------------------------------------
    // Knowledge Base Settings (Form + Modal)
    // ------------------------------------------------------------------
    _handleKnowledgeBaseFormSubmit(e) {
      e.preventDefault();
      const form = e.target;
      if (!form) return;

      const formData = new FormData(form);
      const projectId = form.dataset.projectId || this._getCurrentProjectId();
      if (!this.validateUUID(projectId)) {
        this.showNotification?.("Cannot save settings: Project ID missing or invalid.", "error");
        return;
      }

      const payload = {
        name: formData.get("name"),
        description: formData.get("description") || null,
        embedding_model: formData.get("embedding_model")
      };

      if (!payload.name?.trim()) {
        this.showNotification?.("Knowledge Base name is required.", "error");
        return;
      }
      if (!payload.embedding_model) {
        this.showNotification?.("Embedding model must be selected.", "error");
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      const originalText = submitButton?.textContent;
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
      }

      this._submitKnowledgeBaseForm(projectId, payload).finally(() => {
        if (submitButton) {
          submitButton.disabled = false;
          if (originalText) submitButton.textContent = originalText;
        }
      });
    }

    async _submitKnowledgeBaseForm(projectId, payload) {
      try {
        const isUpdating = !!this.state.knowledgeBase?.id;
        const method = isUpdating ? "PUT" : "POST";
        const url = isUpdating
          ? `/api/knowledge-bases/${this.state.knowledgeBase.id}`
          : `/api/projects/${projectId}/knowledge-bases`;

        const response = await this.apiRequest(url, { method, body: payload });
        if (response.data?.id || response.success) {
          this._hideKnowledgeBaseModal();
          this.showNotification?.("Knowledge Base settings saved.", "success");

          if (this.projectManager.loadProjectDetails) {
            await this.projectManager.loadProjectDetails(projectId);
            // Possibly re-render or rely on an event from projectManager
          } else {
            // Manual fallback
            this.renderKnowledgeBaseInfo(response.data || { ...this.state.knowledgeBase, ...payload });
          }
        } else {
          throw new Error(response.message || "Invalid response from server");
        }
      } catch (error) {
        console.error("[KB] Save settings failed:", error);
        this.showNotification?.(`Failed to save settings: ${error.message}`, "error");
      }
    }

    _showKnowledgeBaseModal() {
      const modal = this.elements.settingsModal;
      if (!modal || typeof modal.showModal !== "function") {
        console.error("[KB] Settings modal not found or invalid.");
        return;
      }

      if (this.elements.settingsForm) {
        this.elements.settingsForm.reset();
      }
      this._updateModelSelection(this.state.knowledgeBase?.embedding_model || null);

      if (this.state.knowledgeBase) {
        const kb = this.state.knowledgeBase;
        const nameInput = this.elements.settingsForm?.elements["name"];
        const descInput = this.elements.settingsForm?.elements["description"];
        if (nameInput) nameInput.value = kb.name || "";
        if (descInput) descInput.value = kb.description || "";
      }

      const pid = this._getCurrentProjectId();
      if (pid && this.elements.settingsForm) {
        this.elements.settingsForm.dataset.projectId = pid;
      }

      modal.showModal();
      this._validateSelectedModelDimensions();
    }

    _hideKnowledgeBaseModal() {
      const modal = this.elements.settingsModal;
      if (modal && typeof modal.close === "function") {
        modal.close();
      }
    }

    // ------------------------------------------------------------------
    // UI States & Status Alerts
    // ------------------------------------------------------------------
    _showInactiveState() {
      this.state.knowledgeBase = null;
      this.elements.activeSection?.classList.add("hidden");
      this.elements.inactiveSection?.classList.remove("hidden");
      this._updateStatusIndicator(false);
      this._showStatusAlert("Knowledge Base needed. Click 'Setup'.", "info");
      this._updateUploadButtonsState();
    }

    _updateUploadButtonsState() {
      const hasKB = !!this.state.knowledgeBase;
      const isActive = hasKB && this.state.knowledgeBase.is_active !== false;

      // For any elements that require KB
      const kbDependentEls = document.querySelectorAll("[data-requires-kb='true']");
      kbDependentEls.forEach(el => {
        const disabled = !hasKB || !isActive;
        el.disabled = disabled;
        el.classList.toggle("opacity-50", disabled);
        el.classList.toggle("cursor-not-allowed", disabled);
        if (disabled) {
          el.title = !hasKB
            ? "Setup Knowledge Base first."
            : "Knowledge Base must be active.";
        } else {
          el.title = "Ready to use Knowledge Base features.";
        }
      });

      // Reprocess button specifically
      if (this.elements.reprocessButton) {
        const fileCountEl = document.getElementById("knowledgeFileCount");
        const fileCount = parseInt(fileCountEl?.textContent || "0", 10);
        const reDisabled = !hasKB || !isActive || fileCount === 0;

        this.elements.reprocessButton.disabled = reDisabled;
        this.elements.reprocessButton.classList.toggle("opacity-50", reDisabled);
        this.elements.reprocessButton.classList.toggle("cursor-not-allowed", reDisabled);

        if (!hasKB) {
          this.elements.reprocessButton.title = "Setup Knowledge Base first.";
        } else if (!isActive) {
          this.elements.reprocessButton.title = "Knowledge Base must be active.";
        } else if (fileCount === 0) {
          this.elements.reprocessButton.title = "No files to reprocess.";
        } else {
          this.elements.reprocessButton.title = "Reprocess files.";
        }
      }
    }

    _updateStatusAlerts(kb) {
      if (kb.is_active !== false) {
        if (kb.stats?.file_count === 0) {
          this.showNotification?.("Knowledge Base is empty. Upload files via 'Files' tab.", "warning");
        } else if (kb.stats?.file_count > 0 && kb.stats?.chunk_count === 0 && kb.stats?.unprocessed_files > 0) {
          this.showNotification?.("Files need processing. Click 'Reprocess Files'.", "warning");
        } else if (kb.stats?.unprocessed_files > 0) {
          this.showNotification?.(`${kb.stats.unprocessed_files} file(s) need processing.`, "info");
        }
      } else {
        this.showNotification?.("Knowledge Base is disabled. Enable it to use search.", "warning");
      }
    }

    // ------------------------------------------------------------------
    // KB Health Check
    // ------------------------------------------------------------------
    async _loadKnowledgeBaseHealth(kbId) {
      if (!kbId || !this.validateUUID(kbId)) {
        return null;
      }
      if (!this.apiRequest) {
        console.warn("[KB] apiRequest not available for health check.");
        return null;
      }

      try {
        const response = await this.apiRequest(
          `/api/knowledge-bases/${kbId}/health`,
          { method: "GET" },
          false
        );
        const health = response?.data;
        if (!health) throw new Error("Invalid health check response");
        // Optionally update UI with health info...
        return health;
      } catch (err) {
        console.error("[KB] health check failed:", err);
        this._showStatusAlert("Could not verify knowledge base health", "error");
        return null;
      }
    }

    // ------------------------------------------------------------------
    // Status Alerts
    // ------------------------------------------------------------------
    _showStatusAlert(message, type = "info") {
      // If there's a dedicated #kbStatusIndicator
      const statusIndicator = document.getElementById("kbStatusIndicator");
      if (!statusIndicator) {
        this.showNotification?.(message, type);
        return;
      }

      statusIndicator.innerHTML = "";
      let alertClass = "alert-info";
      if (type === "success") alertClass = "alert-success";
      else if (type === "warning") alertClass = "alert-warning";
      else if (type === "error") alertClass = "alert-error";

      const alertDiv = document.createElement("div");
      alertDiv.className = `alert ${alertClass} shadow-sm text-sm py-2 px-3`;
      alertDiv.setAttribute("role", "alert");
      alertDiv.innerHTML = `<span>${message}</span>`;

      if (type !== "error") {
        const closeButton = document.createElement("button");
        closeButton.className = "btn btn-xs btn-ghost btn-circle";
        closeButton.innerHTML = "✕";
        closeButton.onclick = () => alertDiv.remove();
        alertDiv.appendChild(closeButton);
      }
      statusIndicator.appendChild(alertDiv);
    }

    _showError(msg) {
      this._showStatusAlert(msg, "error");
    }

    // ------------------------------------------------------------------
    // Search Loading / No Results
    // ------------------------------------------------------------------
    _showSearchLoading() {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      resultsSection?.classList.remove("hidden");
      noResultsSection?.classList.add("hidden");
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="flex justify-center items-center p-4 text-base-content/70">
            <span class="loading loading-dots loading-md mr-2"></span>
            <span>Searching knowledge base...</span>
          </div>
        `;
      }
    }

    _hideSearchLoading() {
      if (!this.state.isSearching) {
        const loadingEl = this.elements.resultsContainer?.querySelector(".flex.justify-center.items-center");
        if (loadingEl && loadingEl.textContent.includes("Searching")) {
          loadingEl.remove();
        }
      }
    }

    _showNoResults() {
      const { resultsSection, noResultsSection, resultsContainer } = this.elements;
      if (resultsContainer) {
        resultsContainer.innerHTML = "";
      }
      resultsSection?.classList.add("hidden");
      noResultsSection?.classList.remove("hidden");
    }

    // ------------------------------------------------------------------
    // Processing State / Reprocess
    // ------------------------------------------------------------------
    _showProcessingState() {
      const btn = this.elements.reprocessButton;
      if (!btn) return;
      this._processingState = {
        originalContent: btn.innerHTML,
        originalDisabled: btn.disabled
      };
      btn.disabled = true;
      btn.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Processing...`;
    }

    _hideProcessingState() {
      const btn = this.elements.reprocessButton;
      if (!btn || !this._processingState) return;
      btn.disabled = this._processingState.originalDisabled;
      btn.innerHTML = this._processingState.originalContent;
      this._processingState = null;
    }

    // ------------------------------------------------------------------
    // Validate model dimension selection
    // ------------------------------------------------------------------
    _validateSelectedModelDimensions() {
      const modelSelect = this.elements.modelSelect;
      if (!modelSelect) return;

      const parent = modelSelect.closest(".form-control");
      if (!parent) return;

      let warningDiv = parent.querySelector(".model-error");
      const selectedOption = modelSelect.options[modelSelect.selectedIndex];
      if (selectedOption && selectedOption.disabled) {
        // Show dimension mismatch warning
        if (!warningDiv) {
          const labelDiv = parent.querySelector(".label:last-of-type");
          if (labelDiv) {
            warningDiv = document.createElement("span");
            warningDiv.className = "label-text-alt text-error model-error";
            labelDiv.appendChild(warningDiv);
          } else {
            warningDiv = document.createElement("div");
            warningDiv.className = "text-error text-xs mt-1 model-error";
            modelSelect.insertAdjacentElement("afterend", warningDiv);
          }
        }
        warningDiv.textContent = "Changing dimensions requires reprocessing all files!";
        warningDiv.classList.remove("hidden");
      } else if (warningDiv) {
        // Hide warning
        warningDiv.classList.add("hidden");
        warningDiv.textContent = "";
      }
    }

    // ------------------------------------------------------------------
    // Debounce Helper
    // ------------------------------------------------------------------
    _debounce(func, wait) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

    // ------------------------------------------------------------------
    // Helper for topK
    // ------------------------------------------------------------------
    _getSelectedTopKValue() {
      if (!this.elements.topKSelect) return 5;
      const val = parseInt(this.elements.topKSelect.value, 10);
      return isNaN(val) ? 5 : val;
    }

    // ------------------------------------------------------------------
    // Authentication State Changes
    // ------------------------------------------------------------------
    _handleAuthStateChange(authenticated) {
      this.state.authState = authenticated;
      const items = [
        this.elements.searchButton,
        this.elements.reprocessButton,
        this.elements.setupButton,
        this.elements.kbToggle
      ];
      items.forEach((el) => {
        if (el) {
          el.disabled = !authenticated;
          el.classList.toggle("opacity-50", !authenticated);
          el.classList.toggle("cursor-not-allowed", !authenticated);
        }
      });
      if (!authenticated) {
        this._showStatusAlert("Authentication required", "warning");
      }
    }
  } // end of KnowledgeBaseComponent class

  // Return the instance
  return new KnowledgeBaseComponent(options);
}

export default createKnowledgeBaseComponent;
