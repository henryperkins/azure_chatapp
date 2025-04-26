/**
 * @fileoverview
 * A comprehensive knowledge base management component with search, file processing,
 * and UI interactions, refactored to avoid direct global references. Instead,
 * external dependencies are passed in via the factory function.
 *
 * Usage:
 *   import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
 *
 *   const knowledgeBase = createKnowledgeBaseComponent({
 *     apiRequest,       // optional, else falls back to window.apiRequest
 *     auth,             // optional, else falls back to window.auth
 *     projectManager,   // optional, else falls back to window.projectManager
 *     showNotification, // optional, else falls back to window.showNotification
 *     uiUtilsInstance,  // optional, else falls back to window.uiUtilsInstance
 *     ...
 *   });
 *
 *   // Then initialize as needed:
 *   await knowledgeBase.initialize(true, kbData, projectId);
 */

/**
 * Factory function that creates and returns a KnowledgeBaseComponent instance.
 * @param {object} options - Configuration and external dependencies.
 * @returns {KnowledgeBaseComponentInternal} The knowledge base component instance.
 */
export function createKnowledgeBaseComponent(options = {}) {
  // We'll store external dependencies (or their window.* fallbacks) here:
  const {
    apiRequest = window.apiRequest,
    auth = window.auth,
    projectManager = window.projectManager,
    showNotification = window.showNotification,
    uiUtilsInstance = window.uiUtilsInstance
  } = options;

  // Merge any additional config (searchDebounceTime, maxConcurrentProcesses, etc.)
  const mergedConfig = {
    // Default configs:
    maxConcurrentProcesses: 3,
    searchDebounceTime: 300,
    minQueryLength: 2,
    maxQueryLength: 500,
    // Override with user-supplied options:
    ...options
  };

  /**
   * Internal class that implements the KnowledgeBase logic.
   * This class is not exported directly; use createKnowledgeBaseComponent() instead.
   */
  class KnowledgeBaseComponentInternal {
    constructor(config) {
      // Merge config into this.options
      this.options = config;

      // Save references to the injected dependencies
      this.apiRequest = apiRequest;
      this.auth = auth;
      this.projectManager = projectManager;
      this.showNotification = showNotification;
      this.uiUtils = uiUtilsInstance;

      // Component state
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

      // Basic setup — extracted from original code
      this._validateEnvironment();
      this._setupUtilityMethods();  // Setup utilities early
      this._cacheElements();        // Cache elements early
      this._setupEventListeners();  // Setup listeners early
    }

    /**
     * The primary initialization method.
     * @param {boolean} isVisible - Whether to display the KB container immediately.
     * @param {object|null} kbData - Existing knowledge base data to render (optional).
     * @param {string|null} projectId - The relevant project ID (optional).
     */
    async initialize(isVisible = false, kbData = null, projectId = null) {
      // Slight delay to avoid overlapping with other UI elements
      await new Promise(resolve => setTimeout(resolve, 100));

      if (this.state.isInitialized && !isVisible) {
        // If already initialized but now hidden, just hide sections
        this.elements.activeSection?.classList.add('hidden');
        this.elements.inactiveSection?.classList.add('hidden');
        return;
      }

      this.state.isInitialized = true;

      // Validate DOM elements needed for rendering if visible
      if (isVisible) {
        this._validateDOM();
      }

      // Load initial data if provided
      if (kbData) {
        await this.renderKnowledgeBaseInfo(kbData, projectId);
      } else {
        // Ensure correct sections are hidden if no data
        this.elements.activeSection?.classList.add('hidden');
        this.elements.inactiveSection?.classList.add('hidden');
      }

      // Toggle visibility based on the flag
      this.elements.container?.classList.toggle('hidden', !isVisible);
      this.elements.container?.classList.toggle('pointer-events-none', !isVisible);
    }

    // ==============================
    // Environment & DOM Validation
    // ==============================

    _validateEnvironment() {
      if (typeof window === 'undefined') {
        throw new Error('KnowledgeBaseComponent requires a browser environment');
      }
      if (!this.apiRequest) {
        console.warn('[KB] apiRequest not found - some functionality may be limited.');
      }
      if (!this.auth) {
        console.warn('[KB] Auth module not found - auth features disabled.');
      }
    }

    _validateDOM() {
      const kbContainer = document.getElementById('knowledgeBaseContainer');
      if (!kbContainer || kbContainer.dataset.requiresKb !== 'true') {
        return;
      }

      const criticalElements = [
        'knowledgeTab',
        'knowledgeBaseActive',
        'knowledgeBaseInactive',
        'knowledgeBaseModelSelect',
        'kbStatusBadge'
      ];

      const missingElements = criticalElements.filter(id => !document.getElementById(id));
      if (missingElements.length > 0) {
        console.warn(`[KB] Disabled - missing DOM elements: ${missingElements.join(', ')}`);
        return;
      }

      // Optional elements
      const optionalElements = [
        'knowledgeSearchInput',
        'runKnowledgeSearchBtn',
        'knowledgeResultsList',
        'kbStatusIndicator',
        'setupKnowledgeBaseBtn',
        'reprocessFilesBtn',
        'knowledgeFileCount',
        'knowledgeFileSize', // in projectDetails
        'knowledgeResultModal',
        'knowledgeBaseSettingsModal',
        'knowledgeBaseEnabled'
      ];

      optionalElements.forEach(id => {
        if (!document.getElementById(id)) {
          console.warn(`[KB] Optional element #${id} not found - some features may be limited`);
        }
      });
    }

    // ======================
    // Utility & DOM Caching
    // ======================

    _cacheElements() {
      this.elements = {
        // Core container
        container: document.getElementById("knowledgeTab"),
        activeSection: document.getElementById("knowledgeBaseActive"),
        inactiveSection: document.getElementById("knowledgeBaseInactive"),
        statusBadge: document.getElementById("kbStatusBadge"),

        // Search
        searchInput: document.getElementById("knowledgeSearchInput"),
        searchButton: document.getElementById("runKnowledgeSearchBtn"),
        resultsContainer: document.getElementById("knowledgeResultsList"),
        resultsSection: document.getElementById("knowledgeSearchResults"),
        noResultsSection: document.getElementById("knowledgeNoResults"),
        topKSelect: document.getElementById("knowledgeTopK"),

        // Management
        kbToggle: document.getElementById("knowledgeBaseEnabled"),
        reprocessButton: document.getElementById("reprocessFilesBtn"),
        setupButton: document.getElementById("setupKnowledgeBaseBtn"),
        settingsButton: document.getElementById("knowledgeBaseSettingsBtn"),

        // Info
        kbNameDisplay: document.getElementById("knowledgeBaseName"),
        kbModelDisplay: document.getElementById("knowledgeBaseModelDisplay"),
        kbVersionDisplay: document.getElementById("kbVersionDisplay"),
        kbLastUsedDisplay: document.getElementById("kbLastUsedDisplay"),

        // Modals
        settingsModal: document.getElementById("knowledgeBaseSettingsModal"),
        settingsForm: document.getElementById("knowledgeBaseForm"),
        cancelSettingsBtn: document.getElementById("cancelKnowledgeBaseFormBtn"),
        modelSelect: document.getElementById("knowledgeBaseModelSelect"),
        resultModal: document.getElementById("knowledgeResultModal"),
        resultTitle: document.getElementById("knowledgeResultTitle"),
        resultSource: document.getElementById("knowledgeResultSource"),
        resultScore: document.getElementById("knowledgeResultScore"),
        resultContent: document.getElementById("knowledgeResultContent"),
        useInChatBtn: document.getElementById("useInChatBtn")
      };

      // Accessibility attributes
      if (this.elements.searchButton) {
        this.elements.searchButton.setAttribute('aria-label', 'Search knowledge base');
      }
      if (this.elements.searchInput) {
        this.elements.searchInput.setAttribute('aria-label', 'Knowledge base search query');
      }

      // Settings button -> Show modal
      if (this.elements.settingsButton) {
        this.elements.settingsButton.addEventListener('click', () => this._showKnowledgeBaseModal());
      }
    }

    _setupUtilityMethods() {
      // Fallback if no uiUtils available
      const fallbackUtils = {
        formatBytes: (bytes = 0, decimals = 2) => {
          if (bytes === 0) return '0 Bytes';
          const k = 1024;
          const dm = decimals < 0 ? 0 : decimals;
          const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
          const i = Math.floor(Math.log(bytes) / Math.log(k));
          return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        },
        formatDate: (dateString) => {
          if (!dateString) return '';
          try {
            const d = new Date(dateString);
            return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
          } catch {
            return dateString;
          }
        },
        fileIcon: (fileType) => {
          const icons = {
            pdf: '📄',
            doc: '📝',
            docx: '📝',
            txt: '📄',
            csv: '📊',
            json: '📋',
            md: '📄'
          };
          return icons[fileType?.toLowerCase()] || '📄';
        }
      };

      this.utils = this.uiUtils || fallbackUtils;
      this.formatBytes = this.utils.formatBytes;
      this.formatDate = this.utils.formatDate;
      this.fileIcon = this.utils.fileIcon;
    }

    _setupEventListeners() {
      // Debounce search
      this.debouncedSearch = this._debounce(
        this.searchKnowledgeBase.bind(this),
        this.options.searchDebounceTime
      );

      // When user clicks the "Search" button
      if (this.elements.searchButton) {
        this.elements.searchButton.addEventListener('click', () => this._triggerSearch());
      }

      // Input or Enter key in the search box
      if (this.elements.searchInput) {
        this.elements.searchInput.addEventListener('input', (e) => {
          this.debouncedSearch(e.target.value);
        });
        this.elements.searchInput.addEventListener('keyup', (e) => {
          if (e.key === 'Enter') this._triggerSearch();
        });
      }

      // Toggle KB
      if (this.elements.kbToggle) {
        this.elements.kbToggle.addEventListener('change', (e) => {
          this.toggleKnowledgeBase(e.target.checked);
        });
      }

      // Reprocess
      if (this.elements.reprocessButton) {
        this.elements.reprocessButton.addEventListener('click', () => {
          const projectId = this._getCurrentProjectId();
          if (projectId) this.reprocessFiles(projectId);
        });
      }

      // Setup KB
      if (this.elements.setupButton) {
        this.elements.setupButton.addEventListener('click', () => this._showKnowledgeBaseModal());
      }

      // Modal form submit
      if (this.elements.settingsForm) {
        this.elements.settingsForm.addEventListener('submit', (e) => this._handleKnowledgeBaseFormSubmit(e));
      }

      // Auth changes
      document.addEventListener('authStateChanged', (e) => {
        this._handleAuthStateChange(e.detail?.authenticated);
      });

      // Model selection change
      if (this.elements.modelSelect) {
        this.elements.modelSelect.addEventListener('change', () => this._validateSelectedModelDimensions());
      }
    }

    // ======================
    // Public API
    // ======================

    async renderKnowledgeBaseInfo(kb, projectId = null) {
      this.state.isInitialized = true;

      if (!kb) {
        this._showInactiveState();
        return;
      }

      this.state.knowledgeBase = kb;
      const currentProjectId = projectId || kb.project_id || this._getCurrentProjectId();

      // If we have an activeSection element, store the project ID there
      if (this.elements.activeSection) {
        this.elements.activeSection.dataset.projectId = currentProjectId;
      }

      // Update main UI elements
      this._updateBasicInfo(kb);
      this._updateModelSelection(kb.embedding_model);
      this._updateStatusIndicator(kb.is_active !== false);

      // Show the "active" KB section, hide the "inactive" one
      this.elements.activeSection?.classList.remove('hidden');
      this.elements.inactiveSection?.classList.add('hidden');

      if (this.elements.kbToggle) {
        this.elements.kbToggle.checked = (kb.is_active !== false);
      }

      // If KB is active, check its health
      if (kb.is_active !== false && kb.id) {
        this._loadKnowledgeBaseHealth(kb.id);
      }

      // Possibly show status alerts and update button states
      this._updateStatusAlerts(kb);
      this._updateUploadButtonsState();
    }

    // ======================
    // Searching / Toggling
    // ======================

    async searchKnowledgeBase(query) {
      if (this.state.isSearching) return;

      const trimmedQuery = query?.trim();
      const cjkRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/; // CJK chars

      // Basic query validations
      if (
        !trimmedQuery ||
        (trimmedQuery.length < this.options.minQueryLength && !cjkRegex.test(trimmedQuery)) ||
        trimmedQuery.length > this.options.maxQueryLength
      ) {
        this._showNoResults();
        return;
      }

      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        this._showError('No project selected');
        return;
      }

      // Check cache
      const cacheKey = `${projectId}-${trimmedQuery}`;
      if (this.state.searchCache.has(cacheKey)) {
        this._renderSearchResults(this.state.searchCache.get(cacheKey));
        return;
      }

      this.state.isSearching = true;
      this._showSearchLoading();

      try {
        const token = await this._getAuthToken();
        if (!this.apiRequest) throw new Error('apiRequest not available');

        const response = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/search`,
          {
            method: 'POST',
            body: { query: trimmedQuery, top_k: this._getSelectedTopKValue() }
          },
          false // skipCache if you want
        );

        const results = Array.isArray(response?.data?.results) ? response.data.results : [];
        if (results.length > 0) {
          this.state.searchCache.set(cacheKey, results);
          this._renderSearchResults(results);
        } else {
          this._showNoResults();
        }
      } catch (error) {
        console.error('[KB] Search failed:', error);
        this.showNotification?.('Search failed. Please try again.', 'error');
      } finally {
        this.state.isSearching = false;
        this._hideSearchLoading();
      }
    }

    async toggleKnowledgeBase(enabled) {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        this.showNotification?.('No project selected', 'error');
        return;
      }

      try {
        const token = await this._getAuthToken();
        if (!this.apiRequest) throw new Error('apiRequest not available');

        const response = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/toggle`,
          {
            method: 'POST',
            body: { enable: enabled }
          }
        );

        if (response.success) {
          this._updateLocalState(enabled);
          localStorage.setItem(`kb_enabled_${projectId}`, String(enabled));

          // If you have a knowledgeBaseState cache, you can notify it
          if (window.knowledgeBaseState?.invalidateCache) {
            window.knowledgeBaseState.invalidateCache(projectId);
          }

          // Refresh project data
          if (this.projectManager?.loadProjectDetails) {
            const project = await this.projectManager.loadProjectDetails(projectId);
            this.renderKnowledgeBaseInfo(project?.knowledge_base);
          } else if (this.state.knowledgeBase) {
            this.state.knowledgeBase.is_active = enabled;
            this.renderKnowledgeBaseInfo(this.state.knowledgeBase);
          }
        }
      } catch (error) {
        console.error('[KB] Toggle failed:', error);
        this.showNotification?.('Failed to toggle knowledge base', 'error');
        this._resetToggleState(!enabled);
      }
    }

    // ======================
    // Reprocessing & Files
    // ======================

    async reprocessFiles(projectId) {
      if (!projectId) {
        this.showNotification?.('No project selected', 'error');
        return;
      }

      try {
        this._showProcessingState();

        const token = await this._getAuthToken();
        if (!this.apiRequest) throw new Error('apiRequest not available');

        const response = await this.apiRequest(
          `/api/projects/${projectId}/knowledge-base/reindex`,
          {
            method: 'POST',
            body: { force_reindex: true }
          }
        );

        if (response.success) {
          this.showNotification?.('Files queued for reprocessing', 'success');

          // Refresh project data
          if (this.projectManager) {
            await Promise.all([
              this.projectManager.loadProjectDetails(projectId),
              this.projectManager.loadProjectStats(projectId)
            ]).then(([project]) => {
              this.renderKnowledgeBaseInfo(project?.knowledge_base);
            });
          } else if (this.state.knowledgeBase?.id) {
            await this._loadKnowledgeBaseHealth(this.state.knowledgeBase.id);
          }
        }
      } catch (error) {
        console.error('[KB] Reprocessing failed:', error);
        this.showNotification?.('Failed to reprocess files', 'error');
      } finally {
        this._hideProcessingState();
      }
    }

    async processFiles(projectId, files) {
      const { validFiles, invalidFiles } = this._validateFiles(files);

      if (invalidFiles.length > 0) {
        this._handleInvalidFiles(invalidFiles);
      }
      if (validFiles.length > 0) {
        this.state.fileProcessingQueue.push(...validFiles);
        await this._processQueue(projectId);
      }
    }

    async _processQueue(projectId) {
      while (
        this.state.fileProcessingQueue.length > 0 &&
        this.state.activeProcesses < this.options.maxConcurrentProcesses
      ) {
        const file = this.state.fileProcessingQueue.shift();
        this.state.activeProcesses++;

        try {
          await this._processSingleFile(projectId, file);
        } catch (error) {
          console.error(`[KB] File processing failed for ${file.name}`, error);
        } finally {
          this.state.activeProcesses--;
          this._updateUploadProgress();
        }
      }
    }

    async _processSingleFile(projectId, file) {
      const token = await this._getAuthToken();
      if (!this.apiRequest) throw new Error('apiRequest not available');

      const formData = new FormData();
      formData.append('file', file);

      const response = await this.apiRequest(
        `/api/projects/${projectId}/knowledge-base/files`,
        {
          method: 'POST',
          body: formData
        }
      );

      if (response.success) {
        // Refresh stats after successful upload
        await this._refreshProjectData(projectId);
      }
    }

    async _refreshProjectData(projectId) {
      if (this.projectManager?.loadProjectDetails) {
        const project = await this.projectManager.loadProjectDetails(projectId);
        this.renderKnowledgeBaseInfo(project?.knowledge_base);
      } else if (this.state.knowledgeBase?.id) {
        await this._loadKnowledgeBaseHealth(this.state.knowledgeBase.id);
      }
    }

    // ======================
    // Basic UI Updates
    // ======================

    _updateBasicInfo(kb) {
      const { kbNameDisplay, kbModelDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;

      if (kbNameDisplay) {
        kbNameDisplay.textContent = kb.name || 'Project Knowledge Base';
        kbNameDisplay.title = `Knowledge Base Name: ${kb.name || 'Default'}`;
      }
      if (kbModelDisplay) {
        kbModelDisplay.textContent = kb.embedding_model || 'Not Set';
        kbModelDisplay.title = `Embedding Model: ${kb.embedding_model || 'Not Set'}`;
      }
      if (kbVersionDisplay) {
        const versionValue = kb.version ? `v${kb.version}` : 'v1';
        kbVersionDisplay.textContent = versionValue;
        kbVersionDisplay.title = `Schema Version: ${versionValue}`;
      }
      if (kbLastUsedDisplay) {
        const lastUsedText = kb.last_used ? this.formatDate(kb.last_used) : 'Never used';
        kbLastUsedDisplay.textContent = lastUsedText;
        kbLastUsedDisplay.title = kb.last_used
          ? `Last used: ${new Date(kb.last_used).toLocaleString()}`
          : 'Not used yet';
      }
    }

    _updateModelSelection(selectedModel) {
      const modelSelect = this.elements.modelSelect;
      if (!modelSelect) return;

      modelSelect.innerHTML = '';

      const models = [
        {
          value: 'all-MiniLM-L6-v2',
          text: 'Local: all-MiniLM-L6-v2 (384d, Fast, Default)',
          dim: 384
        },
        {
          value: 'text-embedding-3-small',
          text: 'OpenAI: text-embedding-3-small (1536d, Recommended)',
          dim: 1536
        },
        {
          value: 'text-embedding-3-large',
          text: 'OpenAI: text-embedding-3-large (3072d, Largest)',
          dim: 3072
        }
      ];

      const existingDim = this.state.knowledgeBase?.embedding_dimension;
      const hasExistingVectors = this.state.knowledgeBase?.stats?.chunk_count > 0;

      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.text;
        option.selected = (model.value === selectedModel);

        // If there's a dimension mismatch, disable
        if (hasExistingVectors && existingDim && existingDim !== model.dim) {
          option.disabled = true;
          option.classList.add('kb-disabled-option');
          option.title = `Dimension mismatch: existing vectors are ${existingDim}d.`;
        }
        modelSelect.appendChild(option);
      });

      // Also update the display span
      if (this.elements.kbModelDisplay) {
        const selectedOption = modelSelect.options[modelSelect.selectedIndex];
        this.elements.kbModelDisplay.textContent = selectedOption
          ? selectedOption.text.split('(')[0].trim()
          : selectedModel || 'Not Set';
        this.elements.kbModelDisplay.title = `Embedding Model: ${selectedOption ? selectedOption.text : selectedModel || 'Not Set'
          }`;
      }

      this._validateSelectedModelDimensions();
    }

    _updateStatusIndicator(isActive) {
      const { statusBadge } = this.elements;
      if (!statusBadge) return;

      statusBadge.className = `badge ${isActive ? 'badge-success' : 'badge-warning'} badge-sm`;
      statusBadge.textContent = isActive ? 'Active' : 'Inactive';
      statusBadge.title = isActive
        ? 'Knowledge base is enabled.'
        : 'Knowledge base is disabled.';
    }

    // ======================
    // Search Results
    // ======================

    _renderSearchResults(results) {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (!resultsContainer) return;
      resultsContainer.innerHTML = '';

      if (!Array.isArray(results) || results.length === 0) {
        this._showNoResults();
        return;
      }

      results.forEach(result => {
        const item = this._createResultItem(result);
        item.addEventListener('click', () => this._showResultDetail(result));
        item.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._showResultDetail(result);
          }
        });
        resultsContainer.appendChild(item);
      });

      resultsSection?.classList.remove('hidden');
      noResultsSection?.classList.add('hidden');
    }

    _createResultItem(result) {
      const item = document.createElement('div');
      item.className =
        'card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow mb-3 cursor-pointer border border-base-300';
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      const fileInfo = result.file_info || {};
      const metadata = result.metadata || {};
      const filename = fileInfo.filename || metadata.file_name || 'Unknown source';
      const scorePercentage = Math.round((result.score || 0) * 100);

      let scoreBadgeClass = 'badge-ghost';
      if (scorePercentage >= 80) scoreBadgeClass = 'badge-success';
      else if (scorePercentage >= 60) scoreBadgeClass = 'badge-warning';

      item.innerHTML = `
        <div class="card-body p-3">
          <div class="card-title text-sm justify-between items-center mb-1">
            <div class="flex items-center gap-2 truncate">
              <span class="text-lg">${this.fileIcon(fileInfo.file_type)}</span>
              <span class="truncate" title="${filename}">${this._formatSourceName(filename)}</span>
            </div>
            <div class="badge ${scoreBadgeClass} badge-sm tooltip tooltip-left" data-tip="Relevance: ${scorePercentage}%">
              ${scorePercentage}%
            </div>
          </div>
          <p class="text-xs text-base-content/80 kb-line-clamp-3 mb-2">${result.text || 'No content available.'}</p>
          <div class="card-actions justify-start text-xs text-base-content/60 gap-2 border-t border-base-content/10 pt-1">
            ${metadata.chunk_index !== undefined
          ? `<span>Chunk: ${metadata.chunk_index}</span>`
          : ''
        }
            ${metadata.token_count !== undefined
          ? `<span>Tokens: ${metadata.token_count}</span>`
          : ''
        }
            ${metadata.processed_at
          ? `<span class="hidden sm:inline">Processed: ${this.formatDate(metadata.processed_at)}</span>`
          : ''
        }
          </div>
        </div>
      `;

      item.setAttribute(
        'aria-label',
        `Result from ${filename}, ${scorePercentage}% match`
      );
      return item;
    }

    _validateSelectedModelDimensions() {
      const modelSelect = this.elements.modelSelect;
      if (!modelSelect || !modelSelect.parentElement) return;

      const parent = modelSelect.closest('.form-control');
      if (!parent) return;

      let warningDiv = parent.querySelector('.model-error');
      const selectedOption = modelSelect.options[modelSelect.selectedIndex];

      if (selectedOption && selectedOption.disabled) {
        if (!warningDiv) {
          const labelDiv = parent.querySelector('.label:last-of-type');
          if (labelDiv) {
            warningDiv = document.createElement('span');
            warningDiv.className = 'label-text-alt text-error model-error';
            labelDiv.appendChild(warningDiv);
          } else {
            warningDiv = document.createElement('div');
            warningDiv.className = 'text-error text-xs mt-1 model-error';
            modelSelect.insertAdjacentElement('afterend', warningDiv);
          }
        }
        warningDiv.textContent = 'Changing dimensions requires reprocessing all files!';
        warningDiv.classList.remove('hidden');
      } else if (warningDiv) {
        warningDiv.classList.add('hidden');
        warningDiv.textContent = '';
      }
    }

    // ======================
    // Knowledge Base Modals
    // ======================

    _showKnowledgeBaseModal() {
      const modal = this.elements.settingsModal;
      if (!modal || typeof modal.showModal !== 'function') {
        console.error('[KB] Settings modal not found or invalid.');
        return;
      }

      if (this.elements.settingsForm) {
        this.elements.settingsForm.reset();
      }
      this._updateModelSelection(this.state.knowledgeBase?.embedding_model || null);

      if (this.state.knowledgeBase) {
        const kb = this.state.knowledgeBase;
        const nameInput = this.elements.settingsForm?.elements['name'];
        const descInput = this.elements.settingsForm?.elements['description'];
        if (nameInput) nameInput.value = kb.name || '';
        if (descInput) descInput.value = kb.description || '';
      }

      const projectId = this._getCurrentProjectId();
      if (projectId && this.elements.settingsForm) {
        this.elements.settingsForm.dataset.projectId = projectId;
      }

      modal.showModal();
      console.log('[KnowledgeBase] showKnowledgeBaseModal triggered');
      this._validateSelectedModelDimensions();
    }

    _hideKnowledgeBaseModal() {
      const modal = this.elements.settingsModal;
      if (modal && typeof modal.close === 'function') {
        modal.close();
      }
    }

    _showResultDetail(result) {
      const modal = this.elements.resultModal;
      if (!modal || typeof modal.showModal !== 'function') {
        console.error('[KB] Result detail modal not found or invalid.');
        return;
      }

      const { resultTitle, resultSource, resultScore, resultContent, useInChatBtn } = this.elements;
      if (!resultTitle || !resultSource || !resultScore || !resultContent) return;

      const metadata = result.metadata || {};
      const fileInfo = result.file_info || {};
      const scorePercentage = Math.round((result.score || 0) * 100);
      const filename = fileInfo.filename || metadata.file_name || 'Unknown Source';

      resultTitle.textContent = `Detail: ${this._formatSourceName(filename)}`;
      resultTitle.title = filename;
      resultSource.textContent = filename;

      let scoreBadgeClass = 'badge-ghost';
      if (scorePercentage >= 80) scoreBadgeClass = 'badge-success';
      else if (scorePercentage >= 60) scoreBadgeClass = 'badge-warning';

      resultScore.className = `badge ${scoreBadgeClass}`;
      resultScore.textContent = `${scorePercentage}%`;

      resultContent.textContent = result.text || 'No content available.';
      resultContent.style.whiteSpace = 'pre-wrap';

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
      if (modal && typeof modal.close === 'function') {
        modal.close();
      }
    }

    _useInConversation(result) {
      const chatInput =
        document.getElementById('chatUIInput') ||
        document.getElementById('projectChatInput') ||
        document.getElementById('chatInput') ||
        document.querySelector('textarea[placeholder*="Send a message"]');

      if (!chatInput) return;

      const filename = result.metadata?.file_name || 'the knowledge base';
      const referenceText = `Referring to content from "${this._formatSourceName(filename)}":\n\n> ${result.text.trim()}\n\nBased on this, `;
      const currentContent = chatInput.value.trim();

      chatInput.value = currentContent
        ? `${currentContent}\n\n${referenceText}`
        : referenceText;

      chatInput.focus();
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // ======================
    // Status Alerts
    // ======================

    _showStatusAlert(message, type = 'info') {
      const statusIndicator = this.elements.statusIndicator;
      if (!statusIndicator) return;

      statusIndicator.innerHTML = '';

      let alertClass = 'alert-info';
      if (type === 'success') alertClass = 'alert-success';
      else if (type === 'warning') alertClass = 'alert-warning';
      else if (type === 'error') alertClass = 'alert-error';

      const alertDiv = document.createElement('div');
      alertDiv.className = `alert ${alertClass} shadow-sm text-sm py-2 px-3`;
      alertDiv.setAttribute('role', 'alert');

      let iconSvg = '';
      if (type === 'info') {
        iconSvg = '<svg ...>...</svg>';
      } else if (type === 'success') {
        iconSvg = '<svg ...>...</svg>';
      } else if (type === 'warning') {
        iconSvg = '<svg ...>...</svg>';
      } else if (type === 'error') {
        iconSvg = '<svg ...>...</svg>';
      }

      alertDiv.innerHTML = `${iconSvg}<span>${message}</span>`;

      if (type !== 'error') {
        const closeButton = document.createElement('button');
        closeButton.className = 'btn btn-xs btn-ghost btn-circle';
        closeButton.innerHTML = '✕';
        closeButton.onclick = () => alertDiv.remove();
        alertDiv.appendChild(closeButton);
      }

      statusIndicator.appendChild(alertDiv);
    }

    _showError(message) {
      this._showStatusAlert(message, 'error');
    }

    _showSuccess(message) {
      this._showStatusAlert(message, 'success');
    }

    _showSearchLoading() {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (resultsSection) resultsSection.classList.remove('hidden');
      if (noResultsSection) noResultsSection.classList.add('hidden');

      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="flex justify-center items-center p-4 text-base-content/70">
            <span class="loading loading-dots loading-md mr-2"></span>
            <span>Searching knowledge base...</span>
          </div>
        `;
      }
    }

    _showNoResults() {
      const { resultsSection, noResultsSection, resultsContainer } = this.elements;
      if (resultsContainer) resultsContainer.innerHTML = '';
      resultsSection?.classList.add('hidden');
      noResultsSection?.classList.remove('hidden');
    }

    _hideSearchLoading() {
      if (this.state.isSearching) return;

      const { resultsContainer } = this.elements;
      if (resultsContainer) {
        const loadingEl = resultsContainer.querySelector('.flex.justify-center.items-center');
        if (loadingEl && loadingEl.textContent.includes('Searching')) {
          loadingEl.remove();
        }
      }
    }

    _showProcessingState() {
      const { reprocessButton } = this.elements;
      if (!reprocessButton) return;

      this._processingState = {
        originalContent: reprocessButton.innerHTML,
        originalDisabled: reprocessButton.disabled
      };

      reprocessButton.disabled = true;
      reprocessButton.innerHTML = `
        <span class="loading loading-spinner loading-xs"></span>
        Processing...
      `;
    }

    _hideProcessingState() {
      const { reprocessButton } = this.elements;
      if (!reprocessButton || !this._processingState) return;

      reprocessButton.disabled = this._processingState.originalDisabled;
      reprocessButton.innerHTML = this._processingState.originalContent;
      this._processingState = null;
    }

    _showInactiveState() {
      this.state.knowledgeBase = null;
      this.elements.activeSection?.classList.add('hidden');
      this.elements.inactiveSection?.classList.remove('hidden');
      this._updateStatusIndicator(false);
      this._showStatusAlert('Knowledge Base needed. Click "Setup".', 'info');
      this._updateUploadButtonsState();
    }

    // ======================
    // Auth & Event Handlers
    // ======================

    _triggerSearch() {
      if (this.elements.searchInput) {
        this.searchKnowledgeBase(this.elements.searchInput.value);
      }
    }

    _handleAuthStateChange(authenticated) {
      this.state.authState = authenticated;

      const items = [
        this.elements.searchButton,
        this.elements.reprocessButton,
        this.elements.setupButton,
        this.elements.kbToggle
      ];

      items.forEach(el => {
        if (el) {
          el.disabled = !authenticated;
          el.classList.toggle('opacity-50', !authenticated);
          el.classList.toggle('cursor-not-allowed', !authenticated);
        }
      });

      if (!authenticated) {
        this._showStatusAlert('Authentication required', 'warning');
      }
    }

    // ======================
    // Internal State Updates
    // ======================

    _updateLocalState(enabled) {
      if (this.state.knowledgeBase) {
        this.state.knowledgeBase.is_active = enabled;
      }
      this._updateStatusIndicator(enabled);
      this._updateUploadButtonsState();
    }

    _resetToggleState(originalState) {
      if (this.elements.kbToggle) {
        this.elements.kbToggle.checked = originalState;
      }
      this._updateStatusIndicator(originalState);
    }

    _updateUploadButtonsState() {
      const hasKB = !!this.state.knowledgeBase;
      const isActive = hasKB && this.state.knowledgeBase.is_active !== false;
      const fileCount = parseInt(this.elements.fileCountDisplay?.textContent || '0', 10);

      // Disable or enable [data-requires-kb="true"] elements
      document.querySelectorAll('[data-requires-kb="true"]').forEach(button => {
        const isDisabled = !hasKB || !isActive;
        button.disabled = isDisabled;
        button.classList.toggle('opacity-50', isDisabled);
        button.classList.toggle('cursor-not-allowed', isDisabled);

        if (isDisabled) {
          button.title = !hasKB
            ? 'Setup Knowledge Base first.'
            : 'Knowledge Base must be active.';
        } else {
          button.title = fileCount > 0 ? 'Upload more files' : 'Upload first file';
        }
      });

      // Reprocess button
      if (this.elements.reprocessButton) {
        const isReDisabled = !hasKB || !isActive || fileCount === 0;
        this.elements.reprocessButton.disabled = isReDisabled;
        this.elements.reprocessButton.classList.toggle('opacity-50', isReDisabled);
        this.elements.reprocessButton.classList.toggle('cursor-not-allowed', isReDisabled);

        if (!hasKB) {
          this.elements.reprocessButton.title = 'Setup Knowledge Base first.';
        } else if (!isActive) {
          this.elements.reprocessButton.title = 'Knowledge Base must be active.';
        } else if (fileCount === 0) {
          this.elements.reprocessButton.title = 'No files to reprocess.';
        } else {
          this.elements.reprocessButton.title = 'Reprocess files.';
        }
      }
    }

    async _loadKnowledgeBaseHealth(kbId) {
      if (!kbId) return null;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(kbId)) {
        this._showStatusAlert('Invalid KB ID format', 'error');
        return null;
      }

      try {
        if (!this.auth?.isAuthenticated()) {
          this._showStatusAlert('Please login to check KB health', 'warning');
          return null;
        }
      } catch {
        this._showStatusAlert('Authentication check failed', 'error');
        return null;
      }

      if (!this.apiRequest) {
        console.warn('[KB] apiRequest not available for health check.');
        return null;
      }

      const MAX_RETRIES = 3;
      const BASE_DELAY = 1000;
      const TIMEOUT_MS = 10000;
      let lastError = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await this.apiRequest(
            `/api/knowledge-bases/${kbId}/health`,
            { method: 'GET' },
            false // skipCache
          );
          if (!response?.data) throw new Error('Invalid health check response');
          const health = response.data;

          const healthStatusEl = document.getElementById('kbHealthStatus');
          if (healthStatusEl) {
            const statusText =
              health.status === 'active' ? 'Active' :
                health.status === 'inactive' ? 'Inactive' : 'Unknown';
            healthStatusEl.textContent = `Status: ${statusText}`;
            healthStatusEl.className = statusText === 'Active' ? 'text-green-600' : 'text-yellow-600';
          }

          const vectorCountEl = document.getElementById('kbVectorCount');
          if (vectorCountEl) {
            const vectorStatus = health.vector_db?.status || 'unknown';
            if (vectorStatus === 'healthy' && health.vector_db?.index_count !== undefined) {
              vectorCountEl.textContent = `Vectors: ${health.vector_db.index_count}`;
            } else {
              vectorCountEl.textContent = `Vectors: Status ${vectorStatus}`;
            }
          }
          return health;
        } catch (err) {
          lastError = err;
          if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      console.error('[KB] health check failed:', lastError);
      this._showStatusAlert('Could not verify knowledge base health', 'error');
      return null;
    }

    // ======================
    // Form Submission
    // ======================

    _handleKnowledgeBaseFormSubmit(e) {
      e.preventDefault();
      const form = e.target;
      if (!form) return;

      const formData = new FormData(form);
      const projectId = form.dataset.projectId;
      if (!projectId) {
        this.showNotification?.('Cannot save settings: Project ID missing.', 'error');
        return;
      }

      const payload = {
        name: formData.get('name'),
        description: formData.get('description') || null,
        embedding_model: formData.get('embedding_model')
      };

      if (!payload.name || payload.name.trim() === '') {
        this.showNotification?.('Knowledge Base name is required.', 'error');
        return;
      }
      if (!payload.embedding_model) {
        this.showNotification?.('Embedding model must be selected.', 'error');
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      const originalButtonText = submitButton?.textContent;

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
      }

      this._submitKnowledgeBaseForm(projectId, payload).finally(() => {
        if (submitButton) {
          submitButton.disabled = false;
          if (originalButtonText) {
            submitButton.textContent = originalButtonText;
          }
        }
      });
    }

    async _submitKnowledgeBaseForm(projectId, payload) {
      try {
        const token = await this._getAuthToken();
        if (!this.apiRequest) throw new Error('apiRequest not available');
        const isUpdating = !!this.state.knowledgeBase?.id;
        const method = isUpdating ? 'PUT' : 'POST';
        const url = isUpdating
          ? `/api/knowledge-bases/${this.state.knowledgeBase.id}`
          : `/api/projects/${projectId}/knowledge-bases`;

        const response = await this.apiRequest(url, { method, body: payload });
        if (response.data?.id || response.success) {
          this._hideKnowledgeBaseModal();
          this.showNotification?.('Knowledge Base settings saved.', 'success');

          // Refresh project
          if (this.projectManager?.loadProjectDetails) {
            const updatedProject = await this.projectManager.loadProjectDetails(projectId);
            // The projectLoaded event might call renderKnowledgeBaseInfo again
          } else {
            // Manual fallback
            this.renderKnowledgeBaseInfo(response.data || { ...this.state.knowledgeBase, ...payload });
          }
        } else {
          throw new Error(response.message || 'Invalid response from server');
        }
      } catch (error) {
        console.error('[KB] Save settings failed:', error);
        this.showNotification?.(`Failed to save settings: ${error.message}`, 'error');
      }
    }

    // ======================
    // Status Alerts (Optional)
    // ======================

    _updateStatusAlerts(kb) {
      // This is mostly a pass-through for optional notifications.
      if (kb.is_active !== false) {
        if (kb?.stats?.file_count === 0) {
          this.showNotification?.('Knowledge Base is empty. Upload files via the "Files" tab.', 'warning');
        } else if (kb.stats?.file_count > 0 && kb.stats?.chunk_count === 0 && kb.stats?.unprocessed_files > 0) {
          this.showNotification?.('Files need processing. Click "Reprocess Files".', 'warning');
        } else if (kb.stats?.unprocessed_files > 0) {
          this.showNotification?.(
            `${kb.stats.unprocessed_files} file(s) need processing. Reprocessing may be needed.`,
            'info'
          );
        }
      } else {
        this.showNotification?.('Knowledge Base is disabled. Enable it to use search.', 'warning');
      }
    }

    // ======================
    // Helper Methods
    // ======================

    _getSelectedTopKValue() {
      if (!this.elements.topKSelect) return 5;
      const val = parseInt(this.elements.topKSelect.value, 10);
      return isNaN(val) ? 5 : val;
    }

    _formatSourceName(filename) {
      // Could do some path-stripping or special logic here
      return filename;
    }

    async _getAuthToken() {
      // If you have a CSRF token from auth, retrieve it
      // Otherwise, just return null
      if (this.auth?.getCSRFTokenAsync) {
        const token = await this.auth.getCSRFTokenAsync();
        return token;
      }
      return null;
    }

    _debounce(func, wait) {
      let timeout;
      return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
      };
    }

  } // end of class

  // Finally, create and return the instance
  return new KnowledgeBaseComponentInternal(mergedConfig);
}
