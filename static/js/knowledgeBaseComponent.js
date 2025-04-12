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
      authState: null
    };

    // Initialize component
    this._validateEnvironment();
    this._validateDOM();
    this._injectStyles();
    this._cacheElements();
    this._setupEventListeners();
    this._setupUtilityMethods();
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
    const criticalElements = [
      'knowledgeTab', 'knowledgeBaseActive', 'knowledgeBaseInactive',
      'knowledgeBaseModelSelect', 'kbStatusText', 'kbStatusBadge'
    ];

    const missingElements = criticalElements.filter(id => !document.getElementById(id));
    if (missingElements.length > 0) {
      throw new Error(`Missing critical elements: ${missingElements.join(', ')}`);
    }

    // Warn about optional elements
    const optionalElements = [
      'knowledgeSearchInput', 'runKnowledgeSearchBtn', 'knowledgeResultsList',
      'kbStatusIndicator', 'setupKnowledgeBaseBtn', 'reprocessFilesBtn',
      'knowledgeFileCount', 'knowledgeFileSize', 'knowledgeResultModal'
    ];

    optionalElements.forEach(id => {
      if (!document.getElementById(id)) {
        console.warn(`Optional element #${id} not found - some features may be limited`);
      }
    });
  }

  _injectStyles() {
    const styleId = 'kb-component-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .kb-spinner {
        border: 2px solid rgba(0, 0, 0, 0.1);
        border-left-color: #3b82f6;
        border-radius: 50%;
        width: 1rem;
        height: 1rem;
        animation: kb-spin 1s linear infinite;
      }
      @keyframes kb-spin {
        to { transform: rotate(360deg); }
      }
      .kb-result-item {
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .kb-result-item:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
      }
      .kb-status-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.25rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.75rem;
        font-weight: 500;
      }
      .kb-status-active {
        background-color: #ecfdf5;
        color: #059669;
      }
      .kb-status-inactive {
        background-color: #fee2e2;
        color: #dc2626;
      }
      .kb-notification {
        padding: 0.75rem 1rem;
        margin-bottom: 1rem;
        border-radius: 0.375rem;
        border: 1px solid transparent;
      }
      .kb-notification.info {
        color: #0c5460;
        background-color: #d1ecf1;
        border-color: #bee5eb;
      }
      .kb-notification.warning {
        color: #856404;
        background-color: #fff3cd;
        border-color: #ffeeba;
      }
      .kb-notification.error {
        color: #721c24;
        background-color: #f8d7da;
        border-color: #f5c6cb;
      }
      .kb-notification.success {
        color: #155724;
        background-color: #d4edda;
        border-color: #c3e6cb;
      }
      .kb-line-clamp-3 {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .kb-disabled-option {
        opacity: 0.5;
        cursor: not-allowed;
        color: #999;
      }
    `;
    document.head.appendChild(style);
  }

  _cacheElements() {
    this.elements = {
      // Core elements
      container: document.getElementById("knowledgeTab"),
      activeSection: document.getElementById("knowledgeBaseActive"),
      inactiveSection: document.getElementById("knowledgeBaseInactive"),
      statusText: document.getElementById("kbStatusText"),
      statusBadge: document.getElementById("kbStatusBadge"),

      // Search elements
      searchInput: document.getElementById("knowledgeSearchInput"),
      searchButton: document.getElementById("runKnowledgeSearchBtn"),
      resultsContainer: document.getElementById("knowledgeResultsList"),
      resultsSection: document.getElementById("knowledgeSearchResults"),
      noResultsSection: document.getElementById("knowledgeNoResults"),
      topKSelect: document.getElementById("knowledgeTopK"),

      // Management elements
      kbToggle: document.getElementById("knowledgeBaseEnabled"),
      reprocessButton: document.getElementById("reprocessFilesBtn"),
      setupButton: document.getElementById("setupKnowledgeBaseBtn"),

      // Info elements
      kbNameDisplay: document.getElementById("knowledgeBaseName"),
      kbVersionDisplay: document.getElementById("kbVersionDisplay"),
      kbLastUsedDisplay: document.getElementById("kbLastUsedDisplay"),
      fileCountDisplay: document.getElementById("knowledgeFileCount"),
      fileSizeDisplay: document.getElementById("knowledgeFileSize"),

      // Modal elements
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

    // Add accessibility attributes
    if (this.elements.searchButton) {
      this.elements.searchButton.setAttribute('aria-label', 'Search knowledge base');
    }
    if (this.elements.searchInput) {
      this.elements.searchInput.setAttribute('aria-label', 'Knowledge base search query');
    }
  }

  _setupUtilityMethods() {
    // Format bytes for file size display
    this.formatBytes = (bytes, decimals = 2) => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    // Simple date formatter
    this.formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    };

    // File type icons
    this.fileIcon = (fileType) => {
      const icons = {
        pdf: '📄',
        doc: '📝',
        docx: '📝',
        txt: '📝',
        csv: '📊',
        json: '🔠',
        xls: '📊',
        xlsx: '📊',
        default: '📁'
      };
      return icons[fileType?.toLowerCase()] || icons.default;
    };
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

    // Knowledge base toggle
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

    // Modal interactions
    if (this.elements.settingsForm) {
      this.elements.settingsForm.addEventListener('submit', (e) => this._handleKnowledgeBaseFormSubmit(e));
    }

    if (this.elements.cancelSettingsBtn) {
      this.elements.cancelSettingsBtn.addEventListener('click', () => this._hideKnowledgeBaseModal());
    }

    if (this.elements.settingsModal) {
      this.elements.settingsModal.addEventListener('click', (event) => {
        if (event.target === this.elements.settingsModal) this._hideKnowledgeBaseModal();
      });
    }

    if (this.elements.resultModal) {
      this.elements.resultModal.addEventListener('click', (event) => {
        if (event.target === this.elements.resultModal) this._hideResultDetailModal();
      });
    }

    // Auth state changes
    document.addEventListener('authStateChanged', (e) => {
      this._handleAuthStateChange(e.detail.authenticated);
    });
  }

  // ======================
  // Public API Methods
  // ======================

  async renderKnowledgeBaseInfo(kb, projectId = null) {
    if (!kb) {
      this._showInactiveState();
      return;
    }

    this.state.knowledgeBase = kb;
    const currentProjectId = projectId || kb.project_id || this._getCurrentProjectId();

    // Update UI elements
    this._updateBasicInfo(kb);
    this._updateModelSelection(kb.embedding_model);
    this._updateStatusIndicator(kb.is_active !== false);
    this._updateKnowledgeBaseStats(kb.stats);

    // Show appropriate sections
    this.elements.activeSection?.classList.remove('hidden');
    this.elements.inactiveSection?.classList.add('hidden');

    // Check health if KB is active
    if (kb.is_active !== false && kb.id) {
      this._loadKnowledgeBaseHealth(kb.id);
    }

    // Show appropriate status alerts
    if (kb.is_active !== false) {
      if (kb?.stats?.file_count === 0) {
        this._showStatusAlert("Knowledge Base is empty - upload files.", "warning");
      } else if (kb.stats?.file_count > 0 && kb.stats?.chunk_count === 0 && kb.stats?.unprocessed_files > 0) {
        this._showStatusAlert("Files need processing. Click 'Reprocess Files'.", "warning");
      } else if (kb.stats?.unprocessed_files > 0) {
        this._showStatusAlert(`${kb.stats.unprocessed_files} file(s) need processing.`, "info");
      }
    } else {
      this._showStatusAlert("Knowledge Base is disabled.", "warning");
    }
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

  // ======================
  // Core Functionality
  // ======================

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
    const { kbNameDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;

    if (kbNameDisplay) {
      kbNameDisplay.textContent = kb.name || "Project Knowledge Base";
      kbNameDisplay.title = `Knowledge Base Name: ${kb.name || 'Default'}`;
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
    const modelSelect = this.elements.modelSelect;
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

    this._validateSelectedModelDimensions();
  }

  _updateStatusIndicator(isActive) {
    const { statusText, statusBadge } = this.elements;

    if (statusText) {
      statusText.textContent = isActive ? "Active" : "Inactive";
      statusText.className = isActive
        ? "text-green-600 font-medium"
        : "text-red-600 font-medium";
      statusText.title = isActive
        ? "Knowledge base enabled."
        : "Knowledge base disabled.";
    }

    if (statusBadge) {
      statusBadge.className = isActive
        ? "kb-status-badge kb-status-active"
        : "kb-status-badge kb-status-inactive";
      statusBadge.innerHTML = isActive
        ? '<span class="w-2 h-2 rounded-full bg-green-500 mr-1"></span> Active'
        : '<span class="w-2 h-2 rounded-full bg-red-500 mr-1"></span> Inactive';
      statusBadge.title = statusText.title;
    }
  }

  _updateKnowledgeBaseStats(stats) {
    const { fileCountDisplay, fileSizeDisplay } = this.elements;

    if (fileCountDisplay) {
      fileCountDisplay.textContent = stats?.file_count ?? 0;
      fileCountDisplay.title = `Total files: ${stats?.file_count ?? 0}`;
    }

    if (fileSizeDisplay) {
      const sizeText = this.formatBytes(stats?.total_size || 0);
      fileSizeDisplay.textContent = sizeText;
      fileSizeDisplay.title = `Total size: ${stats?.total_size || 0} bytes`;
    }

    const chunkCountEl = document.getElementById('knowledgeChunkCount');
    if (chunkCountEl && stats?.chunk_count !== undefined) {
      chunkCountEl.textContent = stats.chunk_count;
      chunkCountEl.title = `Total chunks: ${stats.chunk_count}`;
    }
  }

  _renderSearchResults(results) {
    const { resultsContainer, resultsSection, noResultsSection } = this.elements;

    if (!resultsContainer) return;
    resultsContainer.innerHTML = "";

    if (!Array.isArray(results) || results.length === 0) {
      this._showNoResults();
      return;
    }

    results.forEach(result => {
      const item = this._createResultItem(result);
      item.addEventListener('click', () => this._showResultDetail(result));
      resultsContainer.appendChild(item);
    });

    if (resultsSection) resultsSection.classList.remove("hidden");
    if (noResultsSection) noResultsSection.classList.add("hidden");
  }

  _createResultItem(result) {
    const item = document.createElement('div');
    item.className = 'kb-result-item bg-white dark:bg-gray-800 p-4 rounded-lg shadow mb-3';

    // Header with source and score
    const header = document.createElement('div');
    header.className = 'flex justify-between items-center mb-2';

    const sourceInfo = document.createElement('div');
    sourceInfo.className = 'flex items-center truncate';
    sourceInfo.innerHTML = `
      <span class="mr-2">${this.fileIcon(result.file_info?.file_type)}</span>
      <span class="truncate">${this._formatSourceName(result.file_info?.filename || result.metadata?.file_name)}</span>
    `;

    const scoreBadge = document.createElement('div');
    const scorePercentage = Math.round((result.score || 0) * 100);
    scoreBadge.className = `px-2 py-1 rounded-full text-xs ${
      scorePercentage >= 80 ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' :
      scorePercentage >= 60 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100' :
      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    }`;
    scoreBadge.textContent = `${scorePercentage}%`;
    scoreBadge.title = `Relevance score: ${scorePercentage}%`;

    header.append(sourceInfo, scoreBadge);

    // Content preview
    const content = document.createElement('p');
    content.className = 'text-sm text-gray-600 dark:text-gray-300 kb-line-clamp-3';
    content.textContent = result.text || 'No content available.';

    // Footer with metadata
    const metadata = result.metadata || {};
    const footer = document.createElement('div');
    footer.className = 'flex justify-start items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700';

    if (metadata.chunk_index !== undefined) {
      footer.appendChild(this._createMetadataSpan(`Chunk: ${metadata.chunk_index}`));
    }

    if (metadata.token_count !== undefined) {
      footer.appendChild(this._createMetadataSpan(`Tokens: ${metadata.token_count}`));
    }

    if (metadata.processed_at) {
      footer.appendChild(this._createMetadataSpan(`Processed: ${this.formatDate(metadata.processed_at)}`));
    }

    item
      if (scorePercentage >= 80 ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100' :
      scorePercentage >= 60 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100' :
      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
    };
    scoreBadge.textContent = `${scorePercentage}%`;
    scoreBadge.title = `Relevance score: ${scorePercentage}%`;

    header.append(sourceInfo, scoreBadge);

    // Content preview
    const content = document.createElement('p');
    content.className = 'text-sm text-gray-600 dark:text-gray-300 kb-line-clamp-3';
    content.textContent = result.text || 'No content available.';

    // Footer with metadata
    const metadata = result.metadata || {};
    const footer = document.createElement('div');
    footer.className = 'flex justify-start items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700';

    if (metadata.chunk_index !== undefined) {
      footer.appendChild(this._createMetadataSpan(`Chunk: ${metadata.chunk_index}`));
    }

    if (metadata.token_count !== undefined) {
      footer.appendChild(this._createMetadataSpan(`Tokens: ${metadata.token_count}`));
    }

    if (metadata.processed_at) {
      footer.appendChild(this._createMetadataSpan(`Processed: ${this.formatDate(metadata.processed_at)}`));
    }

    item.append(header, content, footer);
    item.setAttribute('aria-label', `Result from ${sourceInfo.textContent}, ${scorePercentage}% match`);
    return item;
  }

  _createMetadataSpan(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }

  // ======================
  // Utility Methods
  // ======================

  _getCurrentProjectId() {
    return this.state.knowledgeBase?.id ||
           this.elements.activeSection?.dataset?.projectId ||
           localStorage.getItem('selectedProjectId') ||
           (window.projectManager?.currentProject?.id || null);
  }

  _getSelectedTopKValue() {
    return this.elements.topKSelect ?
      parseInt(this.elements.topKSelect.value) :
      5; // Default value
  }

  _formatSourceName(filename) {
    if (!filename) return "Unknown source";
    const maxLength = 25;
    return filename.length > maxLength ?
      `${filename.substring(0, maxLength - 3)}...` :
      filename;
  }

  _debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  async _getAuthToken() {
    if (!window.auth) return null;
    try {
      return await window.auth.getAuthToken();
    } catch (error) {
      console.error("Failed to get auth token:", error);
      return null;
    }
  }

  _validateSelectedModelDimensions() {
    const modelSelect = this.elements.modelSelect;
    if (!modelSelect || !modelSelect.parentElement) return;

    const parent = modelSelect.parentElement;
    let warningDiv = parent.querySelector('.model-error');
    const selectedOption = modelSelect.options[modelSelect.selectedIndex];

    if (selectedOption && selectedOption.disabled) {
      if (!warningDiv) {
        warningDiv = document.createElement('div');
        warningDiv.className = 'model-error text-red-600 text-xs mt-1';
        parent.appendChild(warningDiv);
      }
      warningDiv.textContent = "Changing dimensions requires reprocessing all files!";
      warningDiv.classList.remove('hidden');
    } else if (warningDiv) {
      warningDiv.classList.add('hidden');
    }
  }

  // ======================
  // Modal Methods
  // ======================

  _showKnowledgeBaseModal() {
    if (!this.elements.settingsForm || !this.elements.settingsModal) return;

    this.elements.settingsForm.reset();
    this._updateModelSelection(null);

    if (this.state.knowledgeBase) {
      const kb = this.state.knowledgeBase;
      const nameInput = this.elements.settingsForm.elements['name'];
      const descInput = this.elements.settingsForm.elements['description'];

      if (nameInput) nameInput.value = kb.name || '';
      if (descInput) descInput.value = kb.description || '';
      this._updateModelSelection(kb.embedding_model);
    }

    this.elements.settingsModal.classList.remove('hidden');
    const projectId = this._getCurrentProjectId();
    if (projectId) {
      this.elements.settingsForm.dataset.projectId = projectId;
    }
  }

  _hideKnowledgeBaseModal() {
    if (this.elements.settingsModal) {
      this.elements.settingsModal.classList.add('hidden');
    }
  }

  _showResultDetail(result) {
    const { resultTitle, resultSource, resultScore, resultContent, useInChatBtn } = this.elements;
    if (!resultTitle || !resultSource || !resultScore || !resultContent) return;

    const metadata = result.metadata || {};
    const fileInfo = result.file_info || {};
    const scorePercentage = Math.round((result.score || 0) * 100);
    const filename = fileInfo.filename || metadata.file_name || "Unknown Source";

    resultTitle.textContent = `Detail: ${this._formatSourceName(filename)}`;
    resultTitle.title = filename;
    resultSource.textContent = filename;
    resultScore.textContent = `${scorePercentage}%`;
    resultContent.textContent = result.text || 'No content available.';
    resultContent.style.whiteSpace = 'pre-wrap';

    if (useInChatBtn) {
      useInChatBtn.onclick = () => {
        this._useInConversation(result);
        this._hideResultDetailModal();
      };
    }

    this.elements.resultModal.classList.remove('hidden');
  }

  _hideResultDetailModal() {
    if (this.elements.resultModal) {
      this.elements.resultModal.classList.add('hidden');
    }
  }

  _useInConversation(result) {
    const chatInput =
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
    const { statusIndicator } = this.elements;
    if (!statusIndicator) return;

    // Remove existing alerts
    const existingAlerts = statusIndicator.querySelectorAll('.kb-notification');
    existingAlerts.forEach(alert => alert.remove());

    const alertDiv = document.createElement('div');
    alertDiv.className = `kb-notification ${type}`;
    alertDiv.innerHTML = message;

    if (['info', 'warning'].includes(type)) {
      const closeButton = document.createElement('button');
      closeButton.className = 'ml-2 text-lg leading-none font-semibold';
      closeButton.innerHTML = '&times;';
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
      resultsContainer.innerHTML = `
        <div class="flex justify-center items-center p-4 text-gray-500">
          <div class="kb-spinner mr-2"></div>
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
    reprocessButton.innerHTML = `
      <div class="inline-flex items-center">
        <div class="kb-spinner mr-2"></div>
        Processing...
      </div>
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

    this._updateStatusIndicator(false);

    if (this.elements.statusText) {
      this.elements.statusText.textContent = "Setup Required";
    }

    this._showStatusAlert("Knowledge Base needed. Click 'Setup'.", "info");
    this._updateUploadButtonsState(false, false);
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
    const projectId = form.dataset.projectId;
    if (!projectId) return;

    const payload = {
      name: formData.get('name'),
      description: formData.get('description') || null,
      embedding_model: formData.get('embedding_model')
    };

    if (!payload.name || payload.name.trim() === '') return;
    if (!payload.embedding_model) return;

    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.innerHTML;

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.innerHTML = `<span class="kb-spinner mr-2"></span> Saving...`;
    }

    this._submitKnowledgeBaseForm(projectId, payload)
      .finally(() => {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText;
        }
      });
  }

  async _submitKnowledgeBaseForm(projectId, payload) {
    try {
      const token = await this._getAuthToken();
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-bases`,
        "POST",
        payload,
        token
      );

      if (response.data?.id) {
        this._hideKnowledgeBaseModal();

        if (window.projectManager?.loadProjectDetails) {
          const updatedProject = await window.projectManager.loadProjectDetails(projectId);
          this.renderKnowledgeBaseInfo(updatedProject?.knowledge_base);
        } else {
          this.renderKnowledgeBaseInfo(response.data);
        }
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      console.error("KB setup/update failed:", error);
      this._showError("Failed to save knowledge base settings");
    }
  }
}

// Export for both browser and module environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KnowledgeBaseComponent;
} else {
  window.KnowledgeBaseComponent = KnowledgeBaseComponent;
}
