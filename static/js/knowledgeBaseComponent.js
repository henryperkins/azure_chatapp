/**
 * KnowledgeBaseComponent - Complete Implementation
 * A comprehensive knowledge base management component with search, file processing, and UI interactions
 */
class KnowledgeBaseComponent {
  constructor(options = {}) {
    // Configuration with defaults
    this.options = {
      maxConcurrentProcesses: 3,
      searchDebounceTime: 300,
      minQueryLength: 2,
      maxQueryLength: 500,
      ...options
    };

    // Component state
    this.state = {
      knowledgeBase: null,
      isSearching: false,
      searchCache: new Map(),
      fileProcessingQueue: [],
      activeProcesses: 0,
      lastHealthCheck: null,
      authState: null,
      isInitialized: false // Added initialization flag
    };

    // Basic setup - moved from initialize
    this._validateEnvironment();
    this._setupUtilityMethods(); // Setup utilities early
    this._cacheElements(); // Cache elements early
    this._setupEventListeners(); // Setup listeners early
  }

  // NEW: Initialize method for lazy loading/rendering
  async initialize(isVisible = false, kbData = null, projectId = null) {
    if (this.state.isInitialized && !isVisible) {
        // If already initialized but now hidden, just hide sections
        this.elements.activeSection?.classList.add('hidden');
        this.elements.inactiveSection?.classList.add('hidden');
        return;
    }

    this.state.isInitialized = true;

    // Validate DOM elements needed for rendering if visible
    if (isVisible) {
        this._validateDOM(); // Validate DOM elements needed for rendering
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
  }


  // ======================
  // Initialization Methods
  // ======================

  _validateEnvironment() {
    if (typeof window === 'undefined') {
      throw new Error('KnowledgeBaseComponent requires a browser environment');
    }

    if (!window.apiRequest) {
      console.warn('apiRequest not found - some functionality may be limited');
    }

    if (!window.auth) {
      console.warn('Auth module not found - authentication features will be disabled');
    }
  }

  _validateDOM() {
    // Only validate if KB container exists and is needed
    const kbContainer = document.getElementById('knowledgeBaseContainer');
    if (!kbContainer || kbContainer.dataset.requiresKb !== 'true') {
      return;
    }

    const criticalElements = [
      'knowledgeTab', 'knowledgeBaseActive', 'knowledgeBaseInactive',
      'knowledgeBaseModelSelect',
      'kbStatusBadge'
    ];

    const missingElements = criticalElements.filter(id => !document.getElementById(id));
    if (missingElements.length > 0) {
      console.warn(`Knowledge Base disabled - missing elements: ${missingElements.join(', ')}`);
      return;
    }

    // Warn about optional elements
    const optionalElements = [
      'knowledgeSearchInput', 'runKnowledgeSearchBtn', 'knowledgeResultsList',
      'kbStatusIndicator', 'setupKnowledgeBaseBtn', 'reprocessFilesBtn',
      'knowledgeFileCount', 'knowledgeFileSize', // These are in projectDetails now
      'knowledgeResultModal', 'knowledgeBaseSettingsModal', // DaisyUI dialogs
      'knowledgeBaseEnabled' // Toggle switch
    ];

    optionalElements.forEach(id => {
      if (!document.getElementById(id)) {
        console.warn(`Optional element #${id} not found - some features may be limited`);
      }
    });
  }

  _cacheElements() {
    this.elements = {
      // Core elements
      container: document.getElementById("knowledgeTab"),
      activeSection: document.getElementById("knowledgeBaseActive"),
      inactiveSection: document.getElementById("knowledgeBaseInactive"),
      // statusText: document.getElementById("kbStatusText"), // Removed, using badge only
      statusBadge: document.getElementById("kbStatusBadge"), // DaisyUI badge

      // Search elements
      searchInput: document.getElementById("knowledgeSearchInput"), // DaisyUI input
      searchButton: document.getElementById("runKnowledgeSearchBtn"), // DaisyUI button
      resultsContainer: document.getElementById("knowledgeResultsList"),
      resultsSection: document.getElementById("knowledgeSearchResults"),
      noResultsSection: document.getElementById("knowledgeNoResults"),
      topKSelect: document.getElementById("knowledgeTopK"), // DaisyUI select

      // Management elements
      kbToggle: document.getElementById("knowledgeBaseEnabled"), // DaisyUI toggle
      reprocessButton: document.getElementById("reprocessFilesBtn"), // DaisyUI button
      setupButton: document.getElementById("setupKnowledgeBaseBtn"), // DaisyUI button
      settingsButton: document.getElementById("knowledgeBaseSettingsBtn"), // Added button

      // Info elements (Some might be moved to projectDetails stats)
      kbNameDisplay: document.getElementById("knowledgeBaseName"),
      kbModelDisplay: document.getElementById("knowledgeBaseModelDisplay"), // Added display span
      kbVersionDisplay: document.getElementById("kbVersionDisplay"),
      kbLastUsedDisplay: document.getElementById("kbLastUsedDisplay"),
      // fileCountDisplay: document.getElementById("knowledgeFileCount"), // Moved
      // fileSizeDisplay: document.getElementById("knowledgeFileSize"), // Moved

      // Modal elements (DaisyUI dialogs)
      settingsModal: document.getElementById("knowledgeBaseSettingsModal"),
      settingsForm: document.getElementById("knowledgeBaseForm"),
      cancelSettingsBtn: document.getElementById("cancelKnowledgeBaseFormBtn"), // In form
      modelSelect: document.getElementById("knowledgeBaseModelSelect"), // DaisyUI select in modal
      resultModal: document.getElementById("knowledgeResultModal"),
      resultTitle: document.getElementById("knowledgeResultTitle"),
      resultSource: document.getElementById("knowledgeResultSource"),
      resultScore: document.getElementById("knowledgeResultScore"), // DaisyUI badge
      resultContent: document.getElementById("knowledgeResultContent"),
      useInChatBtn: document.getElementById("useInChatBtn") // DaisyUI button
    };

    // Add accessibility attributes
    if (this.elements.searchButton) {
      this.elements.searchButton.setAttribute('aria-label', 'Search knowledge base');
    }
    if (this.elements.searchInput) {
      this.elements.searchInput.setAttribute('aria-label', 'Knowledge base search query');
    }

    // Add listener for settings button
    if (this.elements.settingsButton) {
       this.elements.settingsButton.addEventListener('click', () => this._showKnowledgeBaseModal());
    }
  }

  _setupUtilityMethods() {
    // Use global uiUtilsInstance if available
    this.utils = window.uiUtilsInstance || {
        formatBytes: (bytes = 0, decimals = 2) => { /* Basic fallback */
            if (bytes === 0) return '0 Bytes'; const k = 1024; const dm = decimals < 0 ? 0 : decimals; const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        },
        formatDate: (dateString) => { /* Basic fallback */
            if (!dateString) return ''; try { const d = new Date(dateString); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString(); } catch (e) { return dateString; }
        },
        fileIcon: (fileType) => { /* Basic fallback */
             const icons = { pdf: '📄', doc: '📝', docx: '📝', txt: '📄', csv: '📊', json: '📋', md: '📄' }; return icons[fileType?.toLowerCase()] || '📄';
        }
    };
    // Assign methods directly to this instance for easier access
    this.formatBytes = this.utils.formatBytes;
    this.formatDate = this.utils.formatDate;
    this.fileIcon = this.utils.fileIcon;
  }

  _setupEventListeners() {
    // Search interactions
    this.debouncedSearch = this._debounce(this.searchKnowledgeBase.bind(this), this.options.searchDebounceTime);

    if (this.elements.searchButton) {
      this.elements.searchButton.addEventListener('click', () => this._triggerSearch());
    }

    if (this.elements.searchInput) {
      this.elements.searchInput.addEventListener('input', (e) => this.debouncedSearch(e.target.value));
      this.elements.searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') this._triggerSearch();
      });
    }

    // Knowledge base toggle (using DaisyUI toggle)
    if (this.elements.kbToggle) {
      this.elements.kbToggle.addEventListener('change', (e) => {
        this.toggleKnowledgeBase(e.target.checked);
      });
    }

    // File reprocessing
    if (this.elements.reprocessButton) {
      this.elements.reprocessButton.addEventListener('click', () => {
        const projectId = this._getCurrentProjectId();
        if (projectId) this.reprocessFiles(projectId);
      });
    }

    // Setup KB button
    if (this.elements.setupButton) {
       this.elements.setupButton.addEventListener('click', () => this._showKnowledgeBaseModal());
    }

    // Modal interactions (using dialog methods)
    if (this.elements.settingsForm) {
      this.elements.settingsForm.addEventListener('submit', (e) => this._handleKnowledgeBaseFormSubmit(e));
    }

    // Cancel button inside the dialog form handles closing via method="dialog"

    // Result modal close handled by dialog structure

    // Auth state changes
    document.addEventListener('authStateChanged', (e) => {
      this._handleAuthStateChange(e.detail.authenticated);
    });

    // Model selection change in modal
    if (this.elements.modelSelect) {
       this.elements.modelSelect.addEventListener('change', () => this._validateSelectedModelDimensions());
    }
  }

  // ======================
  // Public API Methods
  // ======================

  async renderKnowledgeBaseInfo(kb, projectId = null) {
    // Ensure component is considered initialized when rendering info
    this.state.isInitialized = true;

    if (!kb) {
      this._showInactiveState();
      return;
    }

    this.state.knowledgeBase = kb;
    const currentProjectId = projectId || kb.project_id || this._getCurrentProjectId();
    if (this.elements.activeSection) {
       this.elements.activeSection.dataset.projectId = currentProjectId; // Store project ID
    }


    // Update UI elements
    this._updateBasicInfo(kb);
    this._updateModelSelection(kb.embedding_model); // Update select in modal
    this._updateStatusIndicator(kb.is_active !== false); // Update badge
    // this._updateKnowledgeBaseStats(kb.stats); // Stats are now shown in projectDetails

    // Show appropriate sections
    this.elements.activeSection?.classList.remove('hidden');
    this.elements.inactiveSection?.classList.add('hidden');

    // Update toggle state
    if (this.elements.kbToggle) {
       this.elements.kbToggle.checked = (kb.is_active !== false);
    }

    // Check health if KB is active
    if (kb.is_active !== false && kb.id) {
      this._loadKnowledgeBaseHealth(kb.id); // Keep health check
    }

    // Show appropriate status alerts
    this._updateStatusAlerts(kb);

    // Update button states based on KB status
    this._updateUploadButtonsState();
  }

  async searchKnowledgeBase(query) {
    if (this.state.isSearching) return;

    const trimmedQuery = query?.trim();
    const cjkRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/; // CJK characters

    // Validate query
    if (!trimmedQuery ||
        (trimmedQuery.length < this.options.minQueryLength && !cjkRegex.test(trimmedQuery)) ||
        trimmedQuery.length > this.options.maxQueryLength) {
      this._showNoResults();
      return;
    }

    const projectId = this._getCurrentProjectId();
    if (!projectId) {
      this._showError("No project selected");
      return;
    }

    // Check cache first
    const cacheKey = `${projectId}-${trimmedQuery}`;
    if (this.state.searchCache.has(cacheKey)) {
      this._renderSearchResults(this.state.searchCache.get(cacheKey));
      return;
    }

    this.state.isSearching = true;
    this._showSearchLoading();

    try {
      const token = await this._getAuthToken();
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/search`,
        "POST",
        {
          query: trimmedQuery,
          top_k: this._getSelectedTopKValue()
        },
        token
      );

      const results = Array.isArray(response?.data?.results) ? response.data.results : [];

      if (results.length > 0) {
        this.state.searchCache.set(cacheKey, results);
        this._renderSearchResults(results);
      } else {
        this._showNoResults();
      }
    } catch (error) {
      console.error("Search failed:", error);
      this._showError("Search failed. Please try again.");
    } finally {
      this.state.isSearching = false;
      this._hideSearchLoading();
    }
  }

  async toggleKnowledgeBase(enabled) {
    const projectId = this._getCurrentProjectId();
    if (!projectId) {
      this._showError("No project selected");
      return;
    }

    try {
      const token = await this._getAuthToken();
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/toggle`,
        "POST",
        { enable: enabled },
        token
      );

      if (response.success) {
        this._updateLocalState(enabled);
        localStorage.setItem(`kb_enabled_${projectId}`, String(enabled));

        if (window.knowledgeBaseState?.invalidateCache) {
          window.knowledgeBaseState.invalidateCache(projectId);
        }

        // Refresh project data
        if (window.projectManager?.loadProjectDetails) {
          const project = await window.projectManager.loadProjectDetails(projectId);
          this.renderKnowledgeBaseInfo(project?.knowledge_base);
        } else if (this.state.knowledgeBase) {
          this.state.knowledgeBase.is_active = enabled;
          this.renderKnowledgeBaseInfo(this.state.knowledgeBase);
        }
      }
    } catch (error) {
      console.error("Toggle failed:", error);
      this._showError("Failed to toggle knowledge base");
      this._resetToggleState(!enabled);
    }
  }

  async reprocessFiles(projectId) {
    if (!projectId) {
      this._showError("No project selected");
      return;
    }

    try {
      this._showProcessingState();
      const token = await this._getAuthToken();

      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-base/reindex`,
        "POST",
        { force_reindex: true },
        token
      );

      if (response.success) {
        this._showSuccess("Files queued for reprocessing");

        // Refresh project data
        if (window.projectManager) {
          await Promise.all([
            window.projectManager.loadProjectDetails(projectId),
            window.projectManager.loadProjectStats(projectId),
          ]).then(([project]) => {
            this.renderKnowledgeBaseInfo(project?.knowledge_base);
          });
        } else if (this.state.knowledgeBase?.id) {
          await this._loadKnowledgeBaseHealth(this.state.knowledgeBase.id);
        }
      }
    } catch (error) {
      console.error("Reprocessing failed:", error);
      this._showError("Failed to reprocess files");
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
    while (this.state.fileProcessingQueue.length > 0 &&
           this.state.activeProcesses < this.options.maxConcurrentProcesses) {

      const file = this.state.fileProcessingQueue.shift();
      this.state.activeProcesses++;

      try {
        await this._processSingleFile(projectId, file);
      } catch (error) {
        console.error(`File processing failed: ${file.name}`, error);
      } finally {
        this.state.activeProcesses--;
        this._updateUploadProgress();
      }
    }
  }

  // ======================
  // UI Update Methods
  // ======================

  _updateBasicInfo(kb) {
    const { kbNameDisplay, kbModelDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;

    if (kbNameDisplay) {
      kbNameDisplay.textContent = kb.name || "Project Knowledge Base";
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
      const lastUsedText = kb.last_used ? this.formatDate(kb.last_used) : "Never used";
      kbLastUsedDisplay.textContent = lastUsedText;
      kbLastUsedDisplay.title = kb.last_used ? `Last used: ${new Date(kb.last_used).toLocaleString()}` : "Not used yet";
    }
  }

  _updateModelSelection(selectedModel) {
    const modelSelect = this.elements.modelSelect; // The select inside the modal
    if (!modelSelect) return;

    modelSelect.innerHTML = '';

    const models = [
      { value: "all-MiniLM-L6-v2", text: "Local: all-MiniLM-L6-v2 (384d, Fast, Default)", dim: 384 },
      { value: "text-embedding-3-small", text: "OpenAI: text-embedding-3-small (1536d, Recommended)", dim: 1536 },
      { value: "text-embedding-3-large", text: "OpenAI: text-embedding-3-large (3072d, Largest)", dim: 3072 }
    ];

    const existingDim = this.state.knowledgeBase?.embedding_dimension;
    const hasExistingVectors = this.state.knowledgeBase?.stats?.chunk_count > 0;

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.text;
      option.selected = (model.value === selectedModel);

      if (hasExistingVectors && existingDim && existingDim !== model.dim) {
        option.disabled = true;
        option.classList.add('kb-disabled-option');
        option.title = `Dimension mismatch: Existing vectors are ${existingDim}d.`;
      }

      modelSelect.appendChild(option);
    });

    // Update the display span in the main view
    if (this.elements.kbModelDisplay) {
       const selectedOption = modelSelect.options[modelSelect.selectedIndex];
       this.elements.kbModelDisplay.textContent = selectedOption ? selectedOption.text.split('(')[0].trim() : (selectedModel || 'Not Set');
       this.elements.kbModelDisplay.title = `Embedding Model: ${selectedOption ? selectedOption.text : (selectedModel || 'Not Set')}`;
    }

    this._validateSelectedModelDimensions(); // Check warning message
  }

  _updateStatusIndicator(isActive) {
    const { statusBadge } = this.elements;
    if (!statusBadge) return;

    // Use DaisyUI badge classes
    statusBadge.className = `badge ${isActive ? 'badge-success' : 'badge-warning'} badge-sm`;
    statusBadge.textContent = isActive ? "Active" : "Inactive";
    statusBadge.title = isActive ? "Knowledge base is enabled." : "Knowledge base is disabled.";
  }

  _renderSearchResults(results) {
    const { resultsContainer, resultsSection, noResultsSection } = this.elements;

    if (!resultsContainer) return;
    resultsContainer.innerHTML = "";

    if (!Array.isArray(results) || results.length === 0) {
      this._showNoResults();
      return;
    }

    // Use DaisyUI card or list structure for results
    results.forEach(result => {
      const item = this._createResultItem(result); // Uses DaisyUI card structure now
      item.addEventListener('click', () => this._showResultDetail(result));
      item.addEventListener('keydown', (e) => { // Add keyboard accessibility
         if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._showResultDetail(result);
         }
      });
      resultsContainer.appendChild(item);
    });

    if (resultsSection) resultsSection.classList.remove("hidden");
    if (noResultsSection) noResultsSection.classList.add("hidden");
  }

  _createResultItem(result) {
    const item = document.createElement('div');
    // Use DaisyUI card structure
    item.className = 'card card-compact bg-base-100 shadow-md hover:shadow-lg transition-shadow mb-3 cursor-pointer border border-base-300';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    const fileInfo = result.file_info || {};
    const metadata = result.metadata || {};
    const filename = fileInfo.filename || metadata.file_name || "Unknown source";
    const scorePercentage = Math.round((result.score || 0) * 100);

    // Determine badge color based on score
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
          <div class="badge ${scoreBadgeClass} badge-sm tooltip tooltip-left" data-tip="Relevance: ${scorePercentage}%">${scorePercentage}%</div>
        </div>
        <p class="text-xs text-base-content/80 kb-line-clamp-3 mb-2">${result.text || 'No content available.'}</p>
        <div class="card-actions justify-start text-xs text-base-content/60 gap-2 border-t border-base-content/10 pt-1">
          ${metadata.chunk_index !== undefined ? `<span>Chunk: ${metadata.chunk_index}</span>` : ''}
          ${metadata.token_count !== undefined ? `<span>Tokens: ${metadata.token_count}</span>` : ''}
          ${metadata.processed_at ? `<span class="hidden sm:inline">Processed: ${this.formatDate(metadata.processed_at)}</span>` : ''}
        </div>
      </div>
    `;

    item.setAttribute('aria-label', `Result from ${filename}, ${scorePercentage}% match`);
    return item;
  }

  _validateSelectedModelDimensions() {
    const modelSelect = this.elements.modelSelect;
    if (!modelSelect || !modelSelect.parentElement) return;

    const parent = modelSelect.closest('.form-control'); // Find parent form-control
    if (!parent) return;

    let warningDiv = parent.querySelector('.model-error');
    const selectedOption = modelSelect.options[modelSelect.selectedIndex];

    if (selectedOption && selectedOption.disabled) {
      if (!warningDiv) {
        // Find the label div to insert the warning after the select
        const labelDiv = parent.querySelector('.label:last-of-type'); // Target the alt label div
        if (labelDiv) {
           warningDiv = document.createElement('span');
           warningDiv.className = 'label-text-alt text-error model-error'; // Use DaisyUI text color
           labelDiv.appendChild(warningDiv); // Append to the label div
        } else {
           // Fallback: append after select (less ideal layout)
           warningDiv = document.createElement('div');
           warningDiv.className = 'text-error text-xs mt-1 model-error';
           modelSelect.insertAdjacentElement('afterend', warningDiv);
        }
      }
      warningDiv.textContent = "Changing dimensions requires reprocessing all files!";
      warningDiv.classList.remove('hidden');
    } else if (warningDiv) {
      warningDiv.classList.add('hidden');
      warningDiv.textContent = ''; // Clear text
    }
  }

  // ======================
  // Modal Methods
  // ======================

  _showKnowledgeBaseModal() {
    const modal = this.elements.settingsModal;
    if (!modal || typeof modal.showModal !== 'function') {
       console.error("KB Settings modal not found or invalid.");
       return;
    }

    // Reset form and update model selection before showing
    if (this.elements.settingsForm) this.elements.settingsForm.reset();
    this._updateModelSelection(this.state.knowledgeBase?.embedding_model || null); // Pass current or null

    if (this.state.knowledgeBase) {
      const kb = this.state.knowledgeBase;
      const nameInput = this.elements.settingsForm?.elements['name'];
      const descInput = this.elements.settingsForm?.elements['description'];

      if (nameInput) nameInput.value = kb.name || '';
      if (descInput) descInput.value = kb.description || '';
      // Model selection is handled by _updateModelSelection
    }

    // Store project ID on the form for submission
    const projectId = this._getCurrentProjectId();
    if (projectId && this.elements.settingsForm) {
      this.elements.settingsForm.dataset.projectId = projectId;
    }

    modal.showModal(); // Use dialog method
    this._validateSelectedModelDimensions(); // Re-check warning after showing
  }

  _hideKnowledgeBaseModal() {
    const modal = this.elements.settingsModal;
    if (modal && typeof modal.close === 'function') {
      modal.close(); // Use dialog method
    }
  }

  _showResultDetail(result) {
    const modal = this.elements.resultModal;
    if (!modal || typeof modal.showModal !== 'function') {
       console.error("Result detail modal not found or invalid.");
       return;
    }

    const { resultTitle, resultSource, resultScore, resultContent, useInChatBtn } = this.elements;
    if (!resultTitle || !resultSource || !resultScore || !resultContent) return;

    const metadata = result.metadata || {};
    const fileInfo = result.file_info || {};
    const scorePercentage = Math.round((result.score || 0) * 100);
    const filename = fileInfo.filename || metadata.file_name || "Unknown Source";

    resultTitle.textContent = `Detail: ${this._formatSourceName(filename)}`;
    resultTitle.title = filename;
    resultSource.textContent = filename;

    // Determine badge color based on score
    let scoreBadgeClass = 'badge-ghost';
    if (scorePercentage >= 80) scoreBadgeClass = 'badge-success';
    else if (scorePercentage >= 60) scoreBadgeClass = 'badge-warning';
    resultScore.className = `badge ${scoreBadgeClass}`; // Update badge class
    resultScore.textContent = `${scorePercentage}%`;

    resultContent.textContent = result.text || 'No content available.';
    resultContent.style.whiteSpace = 'pre-wrap';

    if (useInChatBtn) {
      useInChatBtn.onclick = () => {
        this._useInConversation(result);
        this._hideResultDetailModal();
      };
    }

    modal.showModal(); // Use dialog method
  }

  _hideResultDetailModal() {
    const modal = this.elements.resultModal;
    if (modal && typeof modal.close === 'function') {
      modal.close(); // Use dialog method
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

    chatInput.value = currentContent ? `${currentContent}\n\n${referenceText}` : referenceText;
    chatInput.focus();
    chatInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ======================
  // Status Methods
  // ======================

  _showStatusAlert(message, type = 'info') {
    const statusIndicator = this.elements.statusIndicator; // The container div
    if (!statusIndicator) return;

    // Remove existing alerts first
    statusIndicator.innerHTML = '';

    // Use DaisyUI alert component
    let alertClass = 'alert-info'; // Default
    if (type === 'success') alertClass = 'alert-success';
    else if (type === 'warning') alertClass = 'alert-warning';
    else if (type === 'error') alertClass = 'alert-error';

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${alertClass} shadow-sm text-sm py-2 px-3`; // Compact alert
    alertDiv.setAttribute('role', 'alert');

    // Add icon based on type
    let iconSvg = '';
    if (type === 'info') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    else if (type === 'success') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
    else if (type === 'warning') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>';
    else if (type === 'error') iconSvg = '<svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';

    alertDiv.innerHTML = `${iconSvg}<span>${message}</span>`;

    // Add close button for non-error alerts
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

    if (resultsSection) resultsSection.classList.remove("hidden");
    if (noResultsSection) noResultsSection.classList.add("hidden");

    if (resultsContainer) {
      // Use DaisyUI loading component
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

    if (resultsContainer) resultsContainer.innerHTML = "";
    if (resultsSection) resultsSection.classList.add("hidden");
    if (noResultsSection) noResultsSection.classList.remove("hidden");
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
    // Use DaisyUI loading component inside button
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

    if (this.elements.activeSection) {
      this.elements.activeSection.classList.add("hidden");
    }

    if (this.elements.inactiveSection) {
      this.elements.inactiveSection.classList.remove("hidden");
    }

    this._updateStatusIndicator(false); // Update badge

    // Removed statusText update

    this._showStatusAlert("Knowledge Base needed. Click 'Setup'.", "info");
    this._updateUploadButtonsState(); // Update button states
  }

  // ======================
  // Event Handlers
  // ======================

  _triggerSearch() {
    if (this.elements.searchInput) {
      this.searchKnowledgeBase(this.elements.searchInput.value);
    }
  }

  _handleAuthStateChange(authenticated) {
    this.state.authState = authenticated;

    const elements = [
      this.elements.searchButton,
      this.elements.reprocessButton,
      this.elements.setupButton,
      this.elements.kbToggle
    ];

    elements.forEach(el => {
      if (el) {
        el.disabled = !authenticated;
        el.classList.toggle('opacity-50', !authenticated);
        el.classList.toggle('cursor-not-allowed', !authenticated);
      }
    });

    if (!authenticated) {
      this._showStatusAlert("Authentication required", "warning");
    }
  }

  // ======================
  // State Management
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
    const hasKnowledgeBase = !!this.state.knowledgeBase;
    const isActive = hasKnowledgeBase && this.state.knowledgeBase.is_active !== false;
    const fileCount = parseInt(this.elements.fileCountDisplay?.textContent || '0', 10);

    // Update upload buttons
    document.querySelectorAll('[data-requires-kb="true"]').forEach(button => {
      const isDisabled = !hasKnowledgeBase || !isActive;
      button.disabled = isDisabled;
      button.classList.toggle('opacity-50', isDisabled);
      button.classList.toggle('cursor-not-allowed', isDisabled);

      if (isDisabled) {
        button.title = !hasKnowledgeBase
          ? "Setup Knowledge Base first."
          : "Knowledge Base must be active.";
      } else {
        button.title = fileCount > 0 ? "Upload more files" : "Upload first file";
      }
    });

    // Update reprocess button
    if (this.elements.reprocessButton) {
      const isReprocessDisabled = !hasKnowledgeBase || !isActive || fileCount === 0;
      this.elements.reprocessButton.disabled = isReprocessDisabled;
      this.elements.reprocessButton.classList.toggle('opacity-50', isReprocessDisabled);
      this.elements.reprocessButton.classList.toggle('cursor-not-allowed', isReprocessDisabled);

      if (!hasKnowledgeBase) {
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

  async _loadKnowledgeBaseHealth(kbId) {
    if (!kbId) return null;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(kbId)) {
      this._showStatusAlert("Invalid KB ID format", "error");
      return null;
    }

    try {
      const isAuthenticated = await window.auth.isAuthenticated();
      if (!isAuthenticated) {
        this._showStatusAlert("Please login to check KB health", "warning");
        return null;
      }
    } catch {
      this._showStatusAlert("Authentication check failed", "error");
      return null;
    }

    const MAX_RETRIES = 3;
    const BASE_DELAY = 1000;
    const TIMEOUT_MS = 10000;
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await window.apiRequest(
          `/api/knowledge-bases/${kbId}/health`,
          "GET",
          null,
          attempt - 1,
          TIMEOUT_MS
        );

        if (!response?.data) throw new Error("Invalid health check response");

        const health = response.data;
        const healthStatusEl = document.getElementById('kbHealthStatus');

        if (healthStatusEl) {
          const statusText = health.status === 'active' ? 'Active' :
                           (health.status === 'inactive' ? 'Inactive' : 'Unknown');
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

    console.error("KB health check failed:", lastError);
    this._showStatusAlert("Could not verify knowledge base health", "error");
    return null;
  }

  _validateFiles(files) {
    const validFiles = [];
    const invalidFiles = [];
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    const ALLOWED_TYPES = [
      'application/pdf',
      'text/plain',
      'text/csv',
      'application/json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    Array.from(files).forEach(file => {
      if (file.size > MAX_FILE_SIZE) {
        invalidFiles.push({
          file,
          reason: `File too large (max ${this.formatBytes(MAX_FILE_SIZE)})`
        });
      } else if (!ALLOWED_TYPES.includes(file.type)) {
        invalidFiles.push({
          file,
          reason: `Unsupported file type (${file.type || 'unknown'})`
        });
      } else {
        validFiles.push(file);
      }
    });

    return { validFiles, invalidFiles };
  }

  _handleInvalidFiles(invalidFiles) {
    if (invalidFiles.length === 0) return;

    const errorList = invalidFiles.map(f =>
      `• ${f.file.name}: ${f.reason}`
    ).join('\n');

    this._showError(`Some files couldn't be processed:\n${errorList}`);
  }

  async _processSingleFile(projectId, file) {
    const token = await this._getAuthToken();
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-base/files`,
        "POST",
        formData,
        token
      );

      if (response.success) {
        // Refresh stats after successful upload
        await this._refreshProjectData(projectId);
      }
    } catch (error) {
      throw error;
    }
  }

  async _refreshProjectData(projectId) {
    if (window.projectManager?.loadProjectDetails) {
      const project = await window.projectManager.loadProjectDetails(projectId);
      this.renderKnowledgeBaseInfo(project?.knowledge_base);
    } else if (this.state.knowledgeBase?.id) {
      await this._loadKnowledgeBaseHealth(this.state.knowledgeBase.id);
    }
  }

  _updateUploadProgress() {
    // TODO: Implement progress tracking if needed
  }

  _handleKnowledgeBaseFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (!form) return;

    const formData = new FormData(form);
    const projectId = form.dataset.projectId; // Get projectId from form dataset
    if (!projectId) {
       this._showError("Cannot save settings: Project ID missing.");
       return;
    }

    const payload = {
      name: formData.get('name'),
      description: formData.get('description') || null,
      embedding_model: formData.get('embedding_model')
    };

    if (!payload.name || payload.name.trim() === '') {
       this._showError("Knowledge Base name is required.");
       return;
    }
    if (!payload.embedding_model) {
       this._showError("Embedding model must be selected.");
       return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.textContent; // Use textContent

    if (submitButton) {
      submitButton.disabled = true;
      // Use DaisyUI loading spinner
      submitButton.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
    }

    this._submitKnowledgeBaseForm(projectId, payload)
      .finally(() => {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText; // Restore original text
        }
      });
  }

  async _submitKnowledgeBaseForm(projectId, payload) {
    try {
      const token = await this._getAuthToken();
      // Determine if creating or updating
      const method = this.state.knowledgeBase?.id ? "PUT" : "POST";
      const url = this.state.knowledgeBase?.id
         ? `/api/knowledge-bases/${this.state.knowledgeBase.id}` // Assuming PUT endpoint exists
         : `/api/projects/${projectId}/knowledge-bases`; // POST endpoint

      const response = await window.apiRequest(url, method, payload, token);

      if (response.data?.id || response.success) { // Check for success flag too
        this._hideKnowledgeBaseModal();
        this._showSuccess("Knowledge Base settings saved.");

        // Refresh project data to get updated KB info
        if (window.projectManager?.loadProjectDetails) {
          const updatedProject = await window.projectManager.loadProjectDetails(projectId);
          // The projectLoaded event should trigger renderKnowledgeBaseInfo
        } else {
           // Manual refresh if manager not available
           this.renderKnowledgeBaseInfo(response.data || { ...this.state.knowledgeBase, ...payload });
        }
      } else {
        throw new Error(response.message || 'Invalid response from server');
      }
    } catch (error) {
      console.error("KB setup/update failed:", error);
      this._showError(`Failed to save settings: ${error.message}`);
    }
  }

  // Add method to update alerts based on KB state
  _updateStatusAlerts(kb) {
     const statusIndicator = this.elements.statusIndicator;
     if (!statusIndicator) return;
     statusIndicator.innerHTML = ''; // Clear previous alerts

     if (kb.is_active !== false) {
       if (kb?.stats?.file_count === 0) {
         this._showStatusAlert("Knowledge Base is empty. Upload files via the 'Files' tab.", "warning");
       } else if (kb.stats?.file_count > 0 && kb.stats?.chunk_count === 0 && kb.stats?.unprocessed_files > 0) {
         this._showStatusAlert("Files need processing. Click 'Reprocess Files'.", "warning");
       } else if (kb.stats?.unprocessed_files > 0) {
         this._showStatusAlert(`${kb.stats.unprocessed_files} file(s) need processing. Reprocessing may be needed.`, "info");
       } else if (kb.stats?.file_count > 0 && kb.stats?.chunk_count > 0) {
          // Optionally show a success/ready state if desired
          // this._showStatusAlert("Knowledge Base is active and ready.", "success");
       }
     } else {
       this._showStatusAlert("Knowledge Base is disabled. Enable it to use search.", "warning");
     }
  }
}

// Export for both browser and module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KnowledgeBaseComponent;
} else {
  window.KnowledgeBaseComponent = KnowledgeBaseComponent;
}
