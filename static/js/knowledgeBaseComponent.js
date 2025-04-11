/**
 * knowledgeBaseComponent.js
 * Reduced without losing functionality.
 */

(function () {
  'use strict';

  /**
   * Knowledge Base Component
   */
  class KnowledgeBaseComponent {
    /**
     * @param {Object} [options] - Configuration options
     */
    constructor(options = {}) {
      // Critical elements needed
      const requiredElements = [
        'kbVersionDisplay', 'kbLastUsedDisplay',
        'knowledgeBaseEnabled', 'knowledgeBaseName',
        'knowledgeTab', 'knowledgeSearchInput', 'runKnowledgeSearchBtn',
        'knowledgeResultsList', 'knowledgeSearchResults', 'knowledgeNoResults',
        'kbStatusIndicator', 'knowledgeBaseActive', 'knowledgeBaseInactive',
        'setupKnowledgeBaseBtn', 'reprocessFilesBtn', 'knowledgeBaseSettingsModal',
        'knowledgeBaseForm', 'cancelKnowledgeBaseFormBtn', 'knowledgeBaseModelSelect',
        'knowledgeFileCount', 'knowledgeFileSize', 'kbStatusText', 'kbStatusBadge',
        'knowledgeResultModal', 'knowledgeResultTitle', 'knowledgeResultSource',
        'knowledgeResultScore', 'knowledgeResultContent', 'useInChatBtn',
        'knowledgeTopK'
      ];
      let allElementsFound = true;
      requiredElements.forEach(id => {
        if (!document.getElementById(id)) {
          console.log(`KB Component: Optional element #${id} not found.`);
          if ([
            'knowledgeTab','knowledgeBaseActive','knowledgeBaseInactive',
            'knowledgeBaseModelSelect','knowledgeFileSize','kbStatusText','kbStatusBadge'
          ].includes(id)) {
            allElementsFound = false;
            console.error(`KB Component: CRITICAL element #${id} missing in DOM.`);
          }
        }
      });
      if (!allElementsFound) {
        console.error("KB Component: Cannot initialize due to missing critical DOM elements.");
        return;
      }

      // Style injection
      const style = document.createElement('style');
      style.textContent = `
        .disabled-option {opacity: 0.5;cursor: not-allowed;color: #999;}
        .disabled-option:hover {background-color: inherit !important;}
        .spinner {border: 2px solid rgba(0, 0, 0, 0.1);border-left-color: #2563eb;border-radius: 50%;width: 1rem;height: 1rem;animation: spin 1s linear infinite;}
        @keyframes spin {to {transform: rotate(360deg);}}
        .line-clamp-3 {-webkit-line-clamp: 3;-webkit-box-orient: vertical;overflow: hidden;display: -webkit-box;}
        .notification {padding: 0.75rem 1rem;margin-bottom: 1rem;border-radius: 0.375rem;border: 1px solid transparent;}
        .notification.info {color: #0c5460;background-color: #d1ecf1;border-color: #bee5eb;}
        .notification.warning {color: #856404;background-color: #fff3cd;border-color: #ffeeba;}
        .notification.error {color: #721c24;background-color: #f8d7da;border-color: #f5c6cb;}
        .notification.success {color: #155724;background-color: #d4edda;border-color: #c3e6cb;}
      `;
      document.head.appendChild(style);

      this.state = { knowledgeBase: null, isSearching: false };
      this.elements = {
        container: document.getElementById("knowledgeTab"),
        searchInput: document.getElementById("knowledgeSearchInput"),
        searchButton: document.getElementById("runKnowledgeSearchBtn"),
        resultsContainer: document.getElementById("knowledgeResultsList"),
        resultsSection: document.getElementById("knowledgeSearchResults"),
        noResultsSection: document.getElementById("knowledgeNoResults"),
        statusIndicator: document.getElementById("kbStatusIndicator"),
        statusText: document.getElementById("kbStatusText"),
        statusBadge: document.getElementById("kbStatusBadge"),
        activeSection: document.getElementById("knowledgeBaseActive"),
        inactiveSection: document.getElementById("knowledgeBaseInactive"),
        setupButton: document.getElementById("setupKnowledgeBaseBtn"),
        kbToggle: document.getElementById("knowledgeBaseEnabled"),
        reprocessButton: document.getElementById("reprocessFilesBtn"),
        settingsModal: document.getElementById('knowledgeBaseSettingsModal'),
        settingsForm: document.getElementById('knowledgeBaseForm'),
        cancelSettingsBtn: document.getElementById('cancelKnowledgeBaseFormBtn'),
        modelSelect: document.getElementById('knowledgeBaseModelSelect'),
        fileCountDisplay: document.getElementById("knowledgeFileCount"),
        fileSizeDisplay: document.getElementById("knowledgeFileSize"),
        kbNameDisplay: document.getElementById("knowledgeBaseName"),
        kbVersionDisplay: document.getElementById("kbVersionDisplay"),
        kbLastUsedDisplay: document.getElementById("kbLastUsedDisplay"),
        resultModal: document.getElementById('knowledgeResultModal'),
        resultTitle: document.getElementById('knowledgeResultTitle'),
        resultSource: document.getElementById('knowledgeResultSource'),
        resultScore: document.getElementById('knowledgeResultScore'),
        resultContent: document.getElementById('knowledgeResultContent'),
        useInChatBtn: document.getElementById('useInChatBtn'),
        topKSelect: document.getElementById('knowledgeTopK')
      };

      if (this.elements.searchButton) {
        this.elements.searchButton.classList.add('focus:outline-none','focus:ring-2','focus:ring-blue-500','focus:ring-opacity-50');
      }

      document.addEventListener('authStateChanged', (e) => {
        if (!e.detail.authenticated) this._disableInteractiveElements();
        else this._enableInteractiveElements();
      });

      this.debouncedSearch = this._debounce(this.searchKnowledgeBase.bind(this), 300);
      this._bindEvents();
    }

    _showStatusAlert(message, type) {
      if (!this.elements.statusIndicator) return;
      const utils = window.uiUtilsInstance;
      if (utils && utils.createElement) {
        const alertDiv = utils.createElement('div', {
          className: `notification ${type}`,
          innerHTML: message
        });
        if (['info','warning'].includes(type)) {
          const closeButton = utils.createElement('button', {
            className: 'ml-2 text-lg leading-none font-semibold',
            innerHTML: '&times;',
            onclick: () => alertDiv.remove()
          });
          alertDiv.appendChild(closeButton);
        }
        this.elements.statusIndicator.appendChild(alertDiv);
      } else {
        const alertDiv = document.createElement('div');
        alertDiv.className = `notification ${type}`;
        alertDiv.innerHTML = `${message}`;
        if (['info','warning'].includes(type)) {
          const closeButton = document.createElement('button');
          closeButton.className = 'ml-2 text-lg leading-none font-semibold';
          closeButton.innerHTML = '&times;';
          closeButton.onclick = () => alertDiv.remove();
          alertDiv.appendChild(closeButton);
        }
        this.elements.statusIndicator.appendChild(alertDiv);
      }
    }

    _updateElementText(elementId, text, fallbackLabel) {
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = text;
        el.title = `${fallbackLabel}: ${text}`;
      }
    }

    _getCurrentProjectId(fallbackId = null) {
      if (this.elements.activeSection?.dataset?.projectId) {
        return this.elements.activeSection.dataset.projectId;
      }
      const storedId = localStorage.getItem('selectedProjectId');
      if (storedId) return storedId;
      if (typeof window.projectManager !== 'undefined' && window.projectManager?.currentProject?.id) {
        return window.projectManager.currentProject.id;
      }
      if (fallbackId) return fallbackId;
      console.warn('Could not determine current project ID.');
      return null;
    }

    _formatSourceName(filename) {
      if (!filename) return "Unknown source";
      const maxLength = 25;
      return filename.length > maxLength ? `${filename.substring(0, maxLength - 3)}...` : filename;
    }

    _disableInteractiveElements() {
      [this.elements.searchButton,this.elements.reprocessButton,
       this.elements.setupButton,this.elements.kbToggle]
      .forEach(el => { if (el) { el.disabled = true; el.classList.add('opacity-50','cursor-not-allowed'); } });
      this._showStatusAlert("Authentication required.", "warning");
    }

    _enableInteractiveElements() {
      [this.elements.searchButton,this.elements.setupButton]
      .forEach(el => { if (el) { el.disabled = false; el.classList.remove('opacity-50','cursor-not-allowed'); } });
      this._updateUploadButtonsState(!!this.state.knowledgeBase, this.state.knowledgeBase?.is_active !== false);
    }

    renderKnowledgeBaseInfo(kb, projectId = null) {
      const { activeSection, inactiveSection, kbToggle, statusIndicator,
        kbNameDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;
      if (statusIndicator) statusIndicator.innerHTML = '';
      if (!activeSection || !inactiveSection) return;
      if (kb) {
        this.state.knowledgeBase = kb;
        const currentProjectId = this._getCurrentProjectId(projectId) || kb.project_id;
        if (currentProjectId && activeSection) activeSection.dataset.projectId = currentProjectId;
        if (kb.id && activeSection) activeSection.dataset.kbId = kb.id;
        if (kbNameDisplay) {
          kbNameDisplay.textContent = kb.name || "Project Knowledge Base";
          kbNameDisplay.title = `Knowledge Base Name: ${kb.name || 'Default'}`;
        }
        const versionValue = kb.version ? `v${kb.version}` : 'v1';
        if (kbVersionDisplay) {
          kbVersionDisplay.textContent = versionValue;
          kbVersionDisplay.title = `Schema Version: ${versionValue}`;
        }
        const lastUsedText =
          kb.last_used && window.uiUtilsInstance?.formatDate
            ? window.uiUtilsInstance.formatDate(kb.last_used)
            : kb.last_used ? new Date(kb.last_used).toLocaleString() : "Never used";
        if (kbLastUsedDisplay) {
          kbLastUsedDisplay.textContent = lastUsedText;
          kbLastUsedDisplay.title = kb.last_used ? `Last used: ${new Date(kb.last_used).toLocaleString()}` : "Not used yet";
        }
        const isActive = kb.is_active !== false;
        if (kbToggle) kbToggle.checked = isActive;
        this._updateModelSelection(kb.embedding_model);
        this._updateKnowledgeBaseStats(kb.stats);
        this._updateStatusIndicator(isActive);
        if (isActive) {
          if (kb?.stats?.file_count === 0) {
            this._showStatusAlert("Knowledge Base is empty - upload files.", "warning");
          } else if (kb.stats?.file_count>0 && kb.stats?.chunk_count===0 && kb.stats?.unprocessed_files>0) {
            this._showStatusAlert("Files need processing. Click 'Reprocess Files'.", "warning");
          } else if (kb.stats?.unprocessed_files>0) {
            this._showStatusAlert(`${kb.stats.unprocessed_files} file(s) need processing.`, "info");
          }
        } else {
          this._showStatusAlert("Knowledge Base is disabled.", "warning");
        }
        activeSection.classList.remove("hidden");
        inactiveSection.classList.add("hidden");
        this._updateUploadButtonsState(true, isActive);
        if (kb.id) this._loadKnowledgeBaseHealth(kb.id);
      } else {
        this.state.knowledgeBase = null;
        activeSection.classList.add("hidden");
        inactiveSection.classList.remove("hidden");
        this._updateStatusIndicator(false);
        if (this.elements.statusText) this.elements.statusText.textContent = "Setup Required";
        this._showStatusAlert("Knowledge Base needed. Click 'Setup'.", "info");
        this._updateUploadButtonsState(false, false);
      }
    }

    async toggleKnowledgeBase(enabled) {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        console.warn('Toggle KB failed: No project.');
        if (this.elements.kbToggle) this.elements.kbToggle.checked = !enabled;
        return;
      }
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) {
          if (this.elements.kbToggle) this.elements.kbToggle.checked = !enabled;
          return;
        }
      } catch (authError) {
        if (this.elements.kbToggle) this.elements.kbToggle.checked = !enabled;
        return;
      }
      const toggle = this.elements.kbToggle;
      const originalState = toggle ? toggle.checked : !enabled;
      if (toggle) toggle.disabled = true;
      this._updateStatusIndicator(enabled);
      try {
        const token = await window.auth.getAuthToken();
        await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/toggle`,
          "POST",
          { enable: enabled },
          token
        );
        localStorage.setItem(`kb_enabled_${projectId}`, String(enabled));
        if (window.knowledgeBaseState?.invalidateCache) {
          window.knowledgeBaseState.invalidateCache(projectId);
        }
        if (window.projectManager?.loadProjectDetails) {
          const project = await window.projectManager.loadProjectDetails(projectId);
          this.renderKnowledgeBaseInfo(project?.knowledge_base);
        } else {
          if (this.state.knowledgeBase) this.state.knowledgeBase.is_active = enabled;
          this.renderKnowledgeBaseInfo(this.state.knowledgeBase);
        }
      } catch (err) {
        console.error("Error toggling KB:", err);
        if (toggle) toggle.checked = originalState;
        this._updateStatusIndicator(originalState);
      } finally {
        if (toggle) toggle.disabled = false;
      }
    }

    async searchKnowledgeBase(query) {
      const projectId = this._getCurrentProjectId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!projectId || !uuidRegex.test(projectId)) {
        console.error('KB Search failed: Invalid project ID');
        this._hideSearchLoading();
        return;
      }
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) {
          this._hideSearchLoading();
          return;
        }
      } catch (authError) {
        window.auth.handleAuthError(authError, "knowledge base search");
        this._hideSearchLoading();
        return;
      }
      const trimmedQuery = query ? query.trim() : '';
      const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
      const isCJK = cjkRegex.test(trimmedQuery);
      if (!isCJK && trimmedQuery.length < 2) {
        this._hideSearchLoading();
        this._showNoResults();
        return;
      }
      if (this.state.isSearching) return;
      this.state.isSearching = true;
      this._showSearchLoading();
      const topK = this.elements.topKSelect ? parseInt(this.elements.topKSelect.value, 10) : 5;
      const requestTimeoutMs = 10000;
      let loadingTimeoutId = setTimeout(() => {}, 5000);
      try {
        const token = await window.auth.getAuthToken();
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/search`,
          "POST",
          { query: trimmedQuery, top_k: topK },
          token,
          0,
          requestTimeoutMs
        );
        const results = Array.isArray(response.data?.results) ? response.data.results : [];
        if (results.length === 0) this._showNoResults();
        else this._renderSearchResults(results);
      } catch (err) {
        console.error("Knowledge base search error:", err);
        this._showNoResults();
      } finally {
        clearTimeout(loadingTimeoutId);
        this.state.isSearching = false;
        this._hideSearchLoading();
      }
    }

    async reprocessFiles() {
      const projectId = this._getCurrentProjectId();
      if (!projectId) return;
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) return;
      } catch (authError) {
        window.auth.handleAuthError(authError, "knowledge base file reprocessing");
        return;
      }
      const reprocessBtn = this.elements.reprocessButton;
      let originalButtonContent = '';
      if (reprocessBtn) {
        originalButtonContent = reprocessBtn.innerHTML;
        reprocessBtn.disabled = true;
        reprocessBtn.innerHTML = `<div class="inline-flex items-center"><div class="spinner mr-2"></div>Processing...</div>`;
      }
      try {
        const token = await window.auth.getAuthToken();
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-base/reindex`,
          "POST",
          { force_reindex: true },
          token
        );
        const data = response.data || {};
        const queuedCount = data.queued_files ?? -1;
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
      } catch (error) {
        console.error("Reprocessing error:", error);
      } finally {
        if (reprocessBtn) {
          reprocessBtn.innerHTML = originalButtonContent;
          reprocessBtn.disabled = false;
          this._updateUploadButtonsState(!!this.state.knowledgeBase, this.state.knowledgeBase?.is_active !== false);
        }
      }
    }

    _bindEvents() {
      if (this.elements.searchButton && this.elements.searchInput) {
        this.elements.searchButton.addEventListener("click", () => {
          const query = this.elements.searchInput.value;
          this.searchKnowledgeBase(query);
        });
      }
      if (this.elements.searchInput) {
        this.elements.searchInput.addEventListener("keyup", (e) => {
          if (e.key === "Enter") {
            this.searchKnowledgeBase(e.target.value);
          }
        });
      }
      if (this.elements.reprocessButton) {
        this.elements.reprocessButton.classList.add('focus:outline-none','focus:ring-2','focus:ring-indigo-500','focus:ring-opacity-50','transition-colors','duration-150');
        this.elements.reprocessButton.addEventListener("click", () => this.reprocessFiles());
      }
      const kbSettingsBtn = document.getElementById("knowledgeBaseSettingsBtn");
      if (kbSettingsBtn) kbSettingsBtn.addEventListener("click", () => this._showKnowledgeBaseModal());
      if (this.elements.kbToggle) {
        this.elements.kbToggle.addEventListener("change", (e) => {
          this.toggleKnowledgeBase(e.target.checked);
        });
      }
      if (this.elements.setupButton) {
        this.elements.setupButton.className =
          'px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors ' +
          'duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 ' +
          'text-sm font-medium shadow-sm';
        this.elements.setupButton.addEventListener("click", () => this._showKnowledgeBaseModal());
      }
      if (this.elements.settingsForm) {
        this.elements.settingsForm.addEventListener("submit", (e) => this._handleKnowledgeBaseFormSubmit(e));
      }
      if (this.elements.cancelSettingsBtn) {
        this.elements.cancelSettingsBtn.addEventListener("click", () => this._hideKnowledgeBaseModal());
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
        const closeResultBtn = this.elements.resultModal.querySelector('.close-modal-btn');
        if (closeResultBtn) closeResultBtn.addEventListener('click', () => this._hideResultDetailModal());
      }
    }

    _debounce(func, delay) {
      let timeout;
      return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
      };
    }

    _showKnowledgeBaseModal() {
      if (!this.elements.settingsForm) return;
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
      if (window.modalManager?.show) {
        window.modalManager.show('knowledge', {
          updateContent: () => {
            const projectId = this._getCurrentProjectId();
            if (projectId) this.elements.settingsForm.dataset.projectId = projectId;
          }
        });
      } else {
        if (this.elements.settingsModal) {
          this.elements.settingsModal.classList.remove('hidden');
          const projectId = this._getCurrentProjectId();
          if (projectId && this.elements.settingsForm) {
            this.elements.settingsForm.dataset.projectId = projectId;
          }
        }
      }
    }

    async _handleKnowledgeBaseFormSubmit(e) {
      e.preventDefault();
      const form = e.target;
      if (!form) return;
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) return;
      } catch (authError) {
        window.auth.handleAuthError(authError, "knowledge base form submission");
        return;
      }
      const formData = new FormData(form);
      const projectId = this._getCurrentProjectId();
      if (!projectId) return;
      const payload = {
        name: formData.get('name'),
        description: formData.get('description') || null,
        embedding_model: formData.get('embedding_model')
      };
      if (!payload.name || payload.name.trim() === '') return;
      if (!payload.embedding_model) return;
      const submitButton = form.querySelector('button[type="submit"]');
      let originalButtonText = '';
      if (submitButton) {
        originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="spinner mr-2"></span> Saving...`;
      }
      try {
        const token = await window.auth.getAuthToken();
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
          throw new Error('Invalid response from server.');
        }
      } catch (error) {
        console.error("KB setup/update failed:", error);
      } finally {
        if (submitButton) {
          submitButton.innerHTML = originalButtonText;
          submitButton.disabled = false;
        }
      }
    }

    _hideKnowledgeBaseModal() {
      if (window.modalManager?.hide) window.modalManager.hide('knowledge');
      else if (this.elements.settingsModal) {
        this.elements.settingsModal.classList.add('hidden');
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
      const MAX_RETRIES = 3; let lastError = null; const BASE_DELAY = 1000; const TIMEOUT_MS = 10000;
      for (let attempt=1; attempt<=MAX_RETRIES; attempt++) {
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
            const st = health.status==='active'?'Active':(health.status==='inactive'?'Inactive':'Unknown');
            healthStatusEl.textContent = `Status: ${st}`;
            healthStatusEl.className = st==='Active'?'text-green-600':'text-yellow-600';
          }
          const vectorCountEl = document.getElementById('kbVectorCount');
          if (vectorCountEl) {
            const vectorStatus = health.vector_db?.status || 'unknown';
            if (vectorStatus==='healthy' && health.vector_db?.index_count!==undefined) {
              vectorCountEl.textContent = `Vectors: ${health.vector_db.index_count}`;
            } else {
              vectorCountEl.textContent = `Vectors: Status ${vectorStatus}`;
            }
          }
          return health;
        } catch (err) {
          lastError = err;
          if (err?.message?.includes('auth')) break;
          if (attempt<MAX_RETRIES) {
            const delay = BASE_DELAY*Math.pow(2, attempt-1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      console.error("KB health check failed:", lastError);
      this._showStatusAlert("Could not verify knowledge base health", "error");
      return null;
    }

    _showSearchLoading() {
      const { resultsSection, noResultsSection, resultsContainer } = this.elements;
      if (resultsSection) resultsSection.classList.remove("hidden");
      if (noResultsSection) noResultsSection.classList.add("hidden");
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="flex justify-center items-center p-4 text-gray-500">
            <div class="spinner mr-2"></div>
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
        if (loadingEl && loadingEl.textContent.includes('Searching')) {}
      }
    }

    _updateModelSelection(selectedModel) {
      const modelSelect = this.elements.modelSelect;
      if (!modelSelect) return;
      modelSelect.innerHTML = '';
      const parent = modelSelect.parentElement;
      const existingError = parent ? parent.querySelector('.model-error') : null;
      if (existingError) existingError.remove();
      const models = [
        { value: "all-MiniLM-L6-v2", text: "Local: all-MiniLM-L6-v2 (384d, Fast, Default)", dim: 384 },
        { value: "text-embedding-3-small", text: "OpenAI: text-embedding-3-small (1536d, Recommended)", dim: 1536 },
        { value: "text-embedding-3-large", text: "OpenAI: text-embedding-3-large (3072d, Largest)", dim: 3072 },
        { value: "embed-english-v3.0", text: "Cohere: embed-english-v3.0 (1024d, English)", dim: 1024 }
      ];
      const existingDim = this.state.knowledgeBase?.embedding_dimension;
      const hasExistingVectors = this.state.knowledgeBase?.stats?.chunk_count>0;
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.text;
        option.selected = (model.value === selectedModel);
        if (hasExistingVectors && existingDim && existingDim !== model.dim) {
          option.disabled = true;
          option.classList.add('disabled-option');
          option.title = `Dimension mismatch: Existing vectors are ${existingDim}d.`;
        }
        modelSelect.appendChild(option);
      });
      this._validateSelectedModelDimensions();
      modelSelect.removeEventListener('change', this._validateSelectedModelDimensions.bind(this));
      modelSelect.addEventListener('change', this._validateSelectedModelDimensions.bind(this));
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
      } else {
        if (warningDiv) warningDiv.classList.add('hidden');
      }
    }

    _updateKnowledgeBaseStats(stats) {
      const { fileCountDisplay, fileSizeDisplay } = this.elements;
      const utils = window.uiUtilsInstance;
      if (!stats) {
        if (fileCountDisplay) fileCountDisplay.textContent = '0';
        if (fileSizeDisplay) fileSizeDisplay.textContent = '0 Bytes';
        return;
      }
      if (fileCountDisplay) {
        fileCountDisplay.textContent = stats.file_count ?? 0;
        fileCountDisplay.title = `Total files: ${stats.file_count ?? 0}`;
      }
      if (fileSizeDisplay && utils?.formatBytes) {
        fileSizeDisplay.textContent = utils.formatBytes(stats.total_size || 0);
        fileSizeDisplay.title = `Total size: ${stats.total_size || 0} bytes`;
      } else if (fileSizeDisplay) {
        fileSizeDisplay.textContent = `${stats.total_size || 0} Bytes`;
      }
      const chunkCountEl = document.getElementById('knowledgeChunkCount');
      if (chunkCountEl && stats.chunk_count !== undefined) {
        chunkCountEl.textContent = stats.chunk_count;
        chunkCountEl.title = `Total chunks: ${stats.chunk_count}`;
      }
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
          ? "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
          : "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800";
        statusBadge.innerHTML = isActive
          ? '<span class="h-2 w-2 rounded-full bg-green-400 mr-1.5 flex-shrink-0"></span>Active'
          : '<span class="h-2 w-2 rounded-full bg-red-400 mr-1.5 flex-shrink-0"></span>Inactive';
        statusBadge.title = statusText.title;
      }
    }

    _updateUploadButtonsState(hasKnowledgeBase, isActive) {
      const uploadButtons = document.querySelectorAll('[data-requires-kb="true"]');
      const fileCount = parseInt(this.elements.fileCountDisplay?.textContent || '0', 10);
      uploadButtons.forEach(button => {
        const isDisabled = !hasKnowledgeBase || !isActive;
        button.disabled = isDisabled;
        button.classList.toggle('opacity-50', isDisabled);
        button.classList.toggle('cursor-not-allowed', isDisabled);
        if (isDisabled) {
          button.title = !hasKnowledgeBase
            ? "Setup KB first."
            : "Knowledge Base must be active.";
        } else {
          button.title = fileCount>0 ? "Upload more files" : "Upload first file";
        }
      });
      const reprocessBtn = this.elements.reprocessButton;
      if (reprocessBtn) {
        const isReprocessDisabled = !hasKnowledgeBase || !isActive || fileCount===0;
        reprocessBtn.disabled = isReprocessDisabled;
        reprocessBtn.classList.toggle('opacity-50', isReprocessDisabled);
        reprocessBtn.classList.toggle('cursor-not-allowed', isReprocessDisabled);
        if (!hasKnowledgeBase) {
          reprocessBtn.title = "Setup Knowledge Base first.";
        } else if (!isActive) {
          reprocessBtn.title = "Knowledge Base must be active.";
        } else if (fileCount === 0) {
          reprocessBtn.title = "No files to reprocess.";
        } else {
          reprocessBtn.title = "Reprocess files.";
        }
      }
    }

    _renderSearchResults(results) {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (!resultsContainer) return;
      if (!Array.isArray(results)) results = [];
      resultsContainer.innerHTML = "";
      if (results.length === 0) {
        this._showNoResults();
        return;
      }
      if (resultsSection) resultsSection.classList.remove("hidden");
      if (noResultsSection) noResultsSection.classList.add("hidden");
      results.forEach((result, index) => {
        if (!result || typeof result.text !== 'string' || typeof result.score !== 'number') return;
        const item = this._createSearchResultItem(
          result.text,
          Math.round(result.score*100),
          result.metadata||{},
          result.file_info||{}
        );
        item.addEventListener('click', (e) => {
          if (e.target.closest('a, button')) return;
          this._showResultDetail(result);
        });
        resultsContainer.appendChild(item);
      });
    }

    _createSearchResultItem(content, score, metadata, fileInfo) {
      const utils = window.uiUtilsInstance;
      if (!utils?.createElement || !utils?.fileIcon || !utils?.formatDate) {
        const fallbackItem = document.createElement('div');
        fallbackItem.textContent = `${this._formatSourceName(metadata.file_name)} (${score}%): ${content.substring(0, 100)}...`;
        fallbackItem.className = 'p-4 border rounded mb-2';
        return fallbackItem;
      }
      const filename = fileInfo?.filename || metadata?.file_name || "Unknown Source";
      const fileType = fileInfo?.file_type || metadata?.file_type || "unknown";
      const createdAt = metadata?.processed_at || fileInfo?.created_at;
      const chunkIndex = metadata?.chunk_index ?? 'N/A';
      const tokenCount = metadata?.token_count ?? fileInfo?.token_count ?? 'N/A';
      const item = utils.createElement("div", {
        className: "content-item bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg shadow-sm mb-3 " +
          "border border-gray-200 dark:border-gray-700 cursor-pointer " +
          "hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-150",
        role: "button", tabIndex: "0"
      });
      const header = utils.createElement("div", { className: "flex justify-between items-start gap-2 mb-2" });
      const sourceInfo = utils.createElement("div", { className: "flex items-center gap-2 min-w-0" });
      sourceInfo.appendChild(utils.createElement("span", {
        className: "text-xl text-gray-500 dark:text-gray-400 flex-shrink-0",
        innerHTML: utils.fileIcon(fileType)
      }));
      const sourceDetails = utils.createElement("div", { className: "flex flex-col min-w-0" });
      sourceDetails.appendChild(utils.createElement("div", {
        className: "font-medium text-sm text-gray-800 dark:text-gray-100 truncate",
        textContent: this._formatSourceName(filename),
        title: filename
      }));
      sourceDetails.appendChild(utils.createElement("div", {
        className: "text-xs text-gray-500 dark:text-gray-400 truncate",
        textContent: `Chunk ${chunkIndex}${createdAt ? ' • ' + utils.formatDate(createdAt) : ''}`
      }));
      sourceInfo.appendChild(sourceDetails);
      header.appendChild(sourceInfo);
      const scoreBadge = utils.createElement("div", {
        className: `text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${
          score>=80?"bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100":
          score>=60?"bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100":
                    "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
        }`,
        textContent: `${score}%`
      });
      scoreBadge.title = `Relevance score: ${score}%`;
      header.appendChild(scoreBadge);
      item.appendChild(header);
      const contentDiv = utils.createElement("p", {
        className: "text-sm text-gray-600 dark:text-gray-300 line-clamp-3 mb-2",
        textContent: content || "No content."
      });
      item.appendChild(contentDiv);
      const footer = this._createMetaRow(`Tokens: ${tokenCount}`);
      if (footer.children.length>0) item.appendChild(footer);
      item.setAttribute('aria-label', `Result from ${filename}, ${score}% match.`);
      return item;
    }

    _createMetaRow(...items) {
      const utils = window.uiUtilsInstance;
      if (!utils?.createElement) return document.createElement('div');
      const row = utils.createElement("div", {
        className: "flex justify-start items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700"
      });
      items.forEach(text => {
        if (text) row.appendChild(utils.createElement("span",{ textContent: text }));
      });
      return row;
    }

    _showResultDetail(result) {
      const { resultTitle, resultSource, resultScore, resultContent, useInChatBtn } = this.elements;
      if (!resultTitle || !resultSource || !resultScore || !resultContent) return;
      const metadata = result.metadata || {};
      const fileInfo = result.file_info || {};
      const scorePercentage = Math.round((result.score || 0)*100);
      const filename = fileInfo.filename || metadata.file_name || "Unknown Source";
      resultTitle.textContent = `Detail: ${this._formatSourceName(filename)}`;
      resultTitle.title = filename;
      resultSource.textContent = filename;
      resultScore.textContent = `${scorePercentage}%`;
      resultContent.textContent = result.text || 'No content available.';
      resultContent.style.whiteSpace = 'pre-wrap';
      if (useInChatBtn) {
        const newBtn = useInChatBtn.cloneNode(true);
        useInChatBtn.parentNode.replaceChild(newBtn, useInChatBtn);
        this.elements.useInChatBtn = newBtn;
        newBtn.onclick = () => {
          this._useInConversation(result);
          this._hideResultDetailModal();
        };
      }
      if (window.modalManager?.show) {
        window.modalManager.show('knowledgeResult',{onShow: (m)=>{m.focus();}});
      } else if (this.elements.resultModal) {
        this.elements.resultModal.classList.remove('hidden');
      }
    }

    _hideResultDetailModal() {
      if (window.modalManager?.hide) window.modalManager.hide('knowledgeResult');
      else if (this.elements.resultModal) {
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
  }

  window.KnowledgeBaseComponent = KnowledgeBaseComponent;
})();