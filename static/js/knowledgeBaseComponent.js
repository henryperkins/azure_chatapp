/**
 * knowledgeBaseComponent.js
 * -----------------------
 * Component for managing knowledge base functionality
 */

(function() {
  /**
   * Knowledge Base Component - Handles knowledge base functionality
   */
  class KnowledgeBaseComponent {
    /**
     * Initialize the knowledge base component
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
      console.log('[DEBUG] Initializing KnowledgeBaseComponent');
      
      // Verify required elements exist
      const requiredElements = [
        'kbVersionDisplay', 'kbLastUsedDisplay', 
        'knowledgeBaseEnabled', 'knowledgeBaseName'
      ];
      requiredElements.forEach(id => {
        if (!document.getElementById(id)) {
          console.error(`KB Component: Required element #${id} missing in DOM`);
        }
      });
      
      // Add style for disabled model options
      const style = document.createElement('style');
      style.textContent = `
        .disabled-option {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .disabled-option:hover {
          background-color: inherit !important;
        }
      `;
      document.head.appendChild(style);

      /* ===========================
         STATE MANAGEMENT
         =========================== */
      this.state = { 
        knowledgeBase: null,
        isSearching: false
      };
      
      /* ===========================
         ELEMENT REFERENCES
         =========================== */
      this.elements = {
        container: document.getElementById("knowledgeTab"),
        searchInput: document.getElementById("knowledgeSearchInput"),
        searchButton: document.getElementById("runKnowledgeSearchBtn"),
        resultsContainer: document.getElementById("knowledgeResultsList"),
        resultsSection: document.getElementById("knowledgeSearchResults"),
        noResultsSection: document.getElementById("knowledgeNoResults"),
        statusIndicator: document.getElementById("kbStatusIndicator"),
        activeSection: document.getElementById("knowledgeBaseActive"),
        inactiveSection: document.getElementById("knowledgeBaseInactive"),
        setupButton: document.getElementById("setupKnowledgeBaseBtn"),
        kbToggle: document.getElementById("knowledgeBaseEnabled"),
        reprocessButton: document.getElementById("reprocessFilesBtn")
      };

      // Add missing styles to search button if it exists
      if (this.elements.searchButton) {
        this.elements.searchButton.classList.add(
          'focus:outline-none', 
          'focus:ring-2', 
          'focus:ring-blue-500', 
          'focus:ring-opacity-50'
        );
      }
      
      this.debouncedSearch = this._debounce(this.searchKnowledgeBase.bind(this), 300); // 300ms delay
      this._bindEvents();
    }

    _showStatusAlert(message, type) {
      const alert = this.elements.statusIndicator;
      alert.innerHTML = `
        <div class="notification ${type}">
          ${message}
          ${type === 'info' ? '<button class="ml-2" onclick="this.parentElement.remove()">×</button>' : ''}
        </div>
      `;
    }

    _updateElementText(elementId, text, fallbackLabel) {
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = text;
        el.title = `${fallbackLabel}: ${text}`;
      } else {
        console.warn(`Element #${elementId} not found for KB info display`);
      }
    }

    /* ===========================
       PUBLIC METHODS
       =========================== */
    
    /**
     * Render knowledge base information in the UI
     * @param {Object|null} kb - Knowledge base data
     */
    renderKnowledgeBaseInfo(kb) {
      const { activeSection, inactiveSection, statusIndicator, kbToggle } = this.elements;
      
      if (!activeSection || !inactiveSection) return;
      
      if (kb) {
        console.log('[DEBUG] Rendering knowledge base info:', kb);
        this.state.knowledgeBase = kb;

        // Version display
        const versionValue = kb.version ? `v${kb.version}` : 'v1 (default)';
        this._updateElementText('kbVersionDisplay', versionValue, 'Schema Version');
        
        // Last used display with proper timezone handling
        const lastUsed = kb.last_used ? 
          new Date(kb.last_used).toLocaleString([], { 
            year: 'numeric', month: 'short', day: 'numeric', 
            hour: '2-digit', minute: '2-digit', timeZoneName: 'short' 
          }) : 'Never used';
        this._updateElementText('kbLastUsedDisplay', lastUsed, 'Last used');

        // Add status alerts based on backend conditions
        if (kb.is_active) {
          if (kb.stats?.file_count === 0) {
            this._showStatusAlert(
              "Knowledge Base is empty - upload files to use with conversations",
              "warning"
            );
          } else if (kb.stats?.file_count > 0 && kb.stats?.chunk_count === 0) {
            this._showStatusAlert(
              "Files need processing - click 'Reprocess Files' to make them searchable",
              "warning"
            );
          }
          if (kb.stats?.unprocessed_files > 0) {
            this._showStatusAlert(
              `${kb.stats.unprocessed_files} files need processing`,
              "info"
            );
          }
        } else {
          this._showStatusAlert(
            "Knowledge Base is disabled - toggle to enable for conversations",
            "warning"
          );
        }
        
        // Store the project_id in a data attribute for future reference
        if (kb.project_id && activeSection) {
          activeSection.dataset.projectId = kb.project_id;
          console.log(`[DEBUG] Set KB project_id=${kb.project_id} in data attribute`);
        } else if (window.projectManager?.currentProject?.id) {
          // If KB doesn't have project_id, use the current project's ID
          activeSection.dataset.projectId = window.projectManager.currentProject.id;
          console.log(`[DEBUG] Using current project ID for KB: ${activeSection.dataset.projectId}`);
        }
        
        // Store the knowledge base ID
        if (kb.id && activeSection) {
          activeSection.dataset.kbId = kb.id;
        }
        
        // Update name and version elements
        const nameElement = document.getElementById("knowledgeBaseName");
        if (nameElement) {
          nameElement.textContent = kb.name || "Project Knowledge Base";
        }

        const versionElement = document.getElementById("kbVersionDisplay");
        if (versionElement) {
          versionElement.textContent = `v${kb.version || 1}`;
          versionElement.title = `Knowledge Base Schema Version ${kb.version || 1}`;
        }

        const lastUsedElement = document.getElementById("kbLastUsedDisplay");
        if (lastUsedElement) {
          lastUsedElement.textContent = kb.last_used 
            ? window.uiUtilsInstance.formatDate(kb.last_used)
            : "Never used";
          lastUsedElement.title = kb.last_used 
            ? `Last used at ${new Date(kb.last_used).toLocaleString()}`
            : "This knowledge base has never been queried";
        }
        
        // Update toggle state
        if (kbToggle) {
          kbToggle.checked = kb.is_active !== false; // True unless explicitly false
        }
        
        // Update model selection
        this._updateModelSelection(kb.embedding_model);
        
        // Update stats
        this._updateKnowledgeBaseStats(kb.stats);
        
        // Update status text
        this._updateStatusIndicator(kb.is_active !== false);
        
        // Show active section, hide inactive
        activeSection.classList.remove("hidden");
        inactiveSection.classList.add("hidden");
        
        // Update upload buttons state
        this._updateUploadButtonsState(true, kb.is_active !== false);
      } else {
        // No knowledge base
        if (activeSection) activeSection.classList.add("hidden");
        if (inactiveSection) inactiveSection.classList.remove("hidden");
        
        // Update status indicator
        if (statusIndicator) {
          statusIndicator.textContent = "✗ Knowledge Base Required";
          statusIndicator.className = "text-red-600 text-sm";
        }
        
        // Update upload buttons state
        this._updateUploadButtonsState(false, false);
      }
    }

    /**
     * Toggle knowledge base active state
     * @param {boolean} enabled - Whether to enable the knowledge base
     */
    /**
     * Get current project ID from multiple sources
     * @private
     */
    _getCurrentProjectId() {
      // 1. Check active section data attribute
      if (this.elements.activeSection?.dataset?.projectId) {
        return this.elements.activeSection.dataset.projectId;
      }
      
      // 2. Check localStorage
      const storedId = localStorage.getItem('selectedProjectId');
      if (storedId) return storedId;
      
      // 3. Check projectManager
      if (window.projectManager?.currentProject?.id) {
        return window.projectManager.currentProject.id;
      }
      
      return null;
    }

    async toggleKnowledgeBase(enabled) {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        console.warn('No active project selected');
        window.showNotification("Please select a project first", "error");
        return;
      }
      
      const toggle = this.elements.kbToggle || document.getElementById('knowledgeBaseEnabled');
      if (!toggle) {
        console.error('Cannot find knowledge base toggle element');
        return;
      }
      const originalState = toggle.checked;
      
      // Optimistic UI update
      toggle.checked = enabled;
      window.showNotification(
        `${enabled ? "Enabling" : "Disabling"} knowledge base...`,
        "info"
      );
      
      try {
        // Use the correct toggle endpoint with the proper project ID
        await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/toggle`,
          "POST",
          { enable: enabled }
        );
        
        // Store KB status in localStorage for the chat to access
        localStorage.setItem(`kb_enabled_${projectId}`, String(enabled));
        
        // Also update cache in knowledgeBaseState if available
        if (window.knowledgeBaseState?.invalidateCache) {
          window.knowledgeBaseState.invalidateCache(projectId);
        }
        
        window.showNotification(
          `Knowledge base ${enabled ? "enabled" : "disabled"}`,
          "success"
        );
        
        // Refresh stats and KB info
        if (window.projectManager) {
          await Promise.all([
            window.projectManager.loadProjectStats(projectId),
            window.projectManager.loadProjectDetails(projectId) // Reload the full project
          ]);
          
          // If we can get the KB ID, load its health
          const currentProject = window.projectManager.currentProject();
          if (currentProject?.knowledge_base_id) {
            await this._loadKnowledgeBaseHealth(currentProject.knowledge_base_id);
          }
        }
      } catch (err) {
        console.error("Error toggling knowledge base:", err);
        // Revert UI on error
        if (toggle) toggle.checked = originalState;
        window.showNotification(
          `Failed to toggle knowledge base: ${err.message || "Unknown error"}`,
          "error"
        );
      }
    }

    /**
     * Search the knowledge base with the given query
     * @param {string} query - Search query
     */
    async searchKnowledgeBase(query) {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        console.error('KB Search failed - no valid project selected');
        window.showNotification("Please select a project first", "error");
        this.state.isSearching = false;
        if (typeof this._hideSearchLoading === 'function') {
            this._hideSearchLoading();
        }
        return Promise.reject('No project selected');
      }

      if (!query || query.trim().length < 2) {
        window.showNotification("Search query must be at least 2 characters", "warning");
        return;
      }

      // Set loading state timeout (5s)
      const loadingTimeout = setTimeout(() => {
        if (this.state.isSearching) {
          this.state.isSearching = false;
          window.showNotification("Search taking longer than expected - please wait", "info");
        }
      }, 5000);

      try {
        if (typeof this._showSearchLoading === 'function') {
          this._showSearchLoading();
        }
        this.state.isSearching = true;
        
        // Get top_k value from UI or use default
        const topK = document.getElementById('knowledgeTopK')?.value || 5;
        
        // Use explicit 5s timeout for the search request
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/search`,
          "POST",
          {
            query: query.trim(),
            top_k: parseInt(topK, 10)
          },
          0, // retryCount
          5000 // timeoutMs
        );

        clearTimeout(loadingTimeout);
        this.state.isSearching = false;
        
        // Ensure results is always an array
        const results = Array.isArray(response.data?.results) ? response.data.results : [];
        if (results.length === 0) {
          window.showNotification("No matching results found", "info");
        }
        
        if (typeof this._renderSearchResults === 'function') {
          this._renderSearchResults(results);
        }
      } catch (err) {
        clearTimeout(loadingTimeout);
        this.state.isSearching = false;
        
        let errorMsg = "Search failed";
        if (err.code === 'ETIMEDOUT') {
          errorMsg = "Search timed out - try again or check knowledge base status";
        } else if (err.response?.status === 404) {
          errorMsg = "Project or knowledge base not found";
        } else if (err.message?.includes("No project selected")) {
          errorMsg = "Please select a project first";
        }

        window.showNotification(errorMsg, "error");
        if (typeof this._showNoResults === 'function') {
          this._showNoResults();
        }
        console.error("Knowledge base search error:", err);
      }
    }

    /**
     * Reprocess files in the knowledge base with enhanced status reporting
     */
    async reprocessFiles() {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        window.showNotification("Please select a project first", "error");
        return;
      }

      const reprocessBtn = this.elements.reprocessButton;
      if (reprocessBtn) {
        // Set button to a "loading" state
        const originalText = reprocessBtn.innerHTML;
        reprocessBtn.innerHTML = `
          <div class="inline-flex items-center">
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Processing...
      </div>
    `;
        reprocessBtn.disabled = true;
      }

      try {
        // Optional: let user force a complete rebuild of the vector store
        // by passing { force_reindex: true } if desired:
        const requestBody = {
          force_reindex: true
        };

        window.showNotification("Reprocessing files for search...", "info");

        // *** 1) Use the new route for reindexing ***
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-base/reindex`,
          "POST",
          requestBody
        );

        // The new route typically returns something like:
        // {
        //   "success": true,
        //   "message": "Queued X files for reindexing",
        //   "queued_files": <number>,
        //   "total_files": <number>
        // }

        // *** 2) Parse the new response fields ***
        const queuedCount = response.data?.queued_files || 0;
        const totalCount = response.data?.total_files || 0;
        const successMsg = response.data?.message || "Files reindexed";

        // Provide user feedback
        if (queuedCount === 0 && totalCount === 0) {
          window.showNotification("No files found to reprocess. Please upload files first.", "info");
        } else {
          // If the route includes a detailed 'message', we can show that:
          window.showNotification(successMsg, "success");
        }

        // *** 3) Refresh the file list, stats, etc. after reindex ***
        if (window.projectManager) {
          await Promise.all([
            window.projectManager.loadProjectFiles(projectId),
            window.projectManager.loadProjectStats(projectId),
            window.projectManager.loadProjectDetails(projectId)
          ]);

          // Optionally check KB health again if you want to update the UI further
          const currentProject = window.projectManager.currentProject();
          if (currentProject?.knowledge_base_id) {
            await this._loadKnowledgeBaseHealth(currentProject.knowledge_base_id);
          }
        }

      } catch (error) {
        console.error("Reprocessing error:", error);

        let errorMessage = "Failed to reprocess files";
        const status = error?.response?.status;

        // Return a more specific error for certain statuses
        if (status === 422) {
          errorMessage = "Cannot process files: validation failed";
        } else if (status === 404) {
          errorMessage = "Project or knowledge base not found";
        } else if (status === 400) {
          errorMessage = "Knowledge base setup required before processing files";
        } else if (error?.response?.data?.detail) {
          errorMessage = error.response.data.detail;
        }

        window.showNotification(errorMessage, "error");
      } finally {
        // *** 4) Restore button state ***
        if (reprocessBtn) {
          reprocessBtn.innerHTML = originalText;
          reprocessBtn.disabled = false;
        }
      }
    }

    /* ===========================
       PRIVATE METHODS
       =========================== */
    
    /**
     * Bind event listeners
     * @private
     */
    _bindEvents() {
      // Search button with error handling
      if (this.elements.searchButton) {
        this.elements.searchButton.addEventListener("click", () => {
          const query = this.elements.searchInput?.value?.trim();
          if (query) this.searchKnowledgeBase(query);
        });
      } else {
        console.warn('Knowledge search button not found in DOM');
      }
      
      // Search input (Enter key)
      this.elements.searchInput?.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
          const query = e.target.value.trim();
          if (query) this.debouncedSearch(query); // Call debounced search
        }
      });
  
      // Reprocess files button
      if (this.elements.reprocessButton) {
        this.elements.reprocessButton.classList.add(
          'focus:outline-none',
          'focus:ring-2',
          'focus:ring-gray-500',
          'focus:ring-opacity-50',
          'transition-colors'
        );
        this.elements.reprocessButton.addEventListener("click", () => this.reprocessFiles());
      }
      
      // KB settings button
      const kbSettingsBtn = document.getElementById("knowledgeBaseSettingsBtn");
      if (kbSettingsBtn) {
        kbSettingsBtn.addEventListener("click", () => this._showKnowledgeBaseModal());
      }
      
      // KB toggle
      this.elements.kbToggle?.addEventListener("change", (e) => {
        this.toggleKnowledgeBase(e.target.checked);
      });

      // Setup KB button
      if (this.elements.setupButton) {
        this.elements.setupButton.className =
          'px-4 py-2.5 bg-green-600 text-white rounded-lg ' +
          'hover:bg-green-700 transition-colors duration-200 ' +
          'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 ' +
          'text-sm font-medium';
        this.elements.setupButton.addEventListener("click", () => this._showKnowledgeBaseModal());
      }

      // KB form submit and cancel
      const kbForm = document.getElementById("knowledgeBaseForm");
      if (kbForm) {
        kbForm.addEventListener("submit", (e) => this._handleKnowledgeBaseFormSubmit(e));
        
        // Bind cancel button
        const cancelBtn = document.getElementById("cancelKnowledgeBaseFormBtn");
        if (cancelBtn) {
          cancelBtn.addEventListener("click", () => {
            window.modalManager?.hide("knowledge");
          });
        }
      }
    }
    
    _debounce(func, delay) {
      let timeout;
      return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
      };
    }
    
    /**
     * Show the knowledge base settings modal
     * @private
     */
    _showKnowledgeBaseModal() {
      console.log('[DEBUG] Opening knowledge base modal');
      
      // Create a unified modal access helper
      const showModal = (id, fallbackId) => {
        // Try all methods in sequence with proper error handling
        try {
          // Try window.modalManager.show first
          if (window.modalManager?.show) {
            window.modalManager.show(id);
            return true;
          }
          
          // Try window.ModalManager.show next
          if (window.ModalManager?.show) {
            window.ModalManager.show(id);
            return true;
          }
          
          // Direct DOM as last resort
          const modal = document.getElementById(fallbackId);
          if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('confirm-modal');
            return true;
          }
          
          return false;
        } catch (e) {
          console.error(`Modal error (${id}):`, e);
          return false;
        }
      };
      
      // Try with both known modal IDs
      if (!showModal('knowledge', 'knowledgeBaseSettingsModal')) {
        console.error('Failed to show knowledge base modal');
        window.showNotification?.('Could not open settings', 'error');
      }
      
      // Try to get and store project ID if available
      const projectId = window.projectManager?.currentProject?.id;
      const form = document.getElementById("knowledgeBaseForm");
      if (form && projectId) {
        form.dataset.projectId = projectId;
        console.log(`[DEBUG] Set project ID ${projectId} on KB form`);
      }
    }
    
    /**
     * Handle knowledge base form submission
     * @private
     * @param {Event} e - Form submit event
     */
    /**
     * Handle knowledge base form submission
     * @private
     * @param {Event} e - Form submit event
     */
    async _handleKnowledgeBaseFormSubmit(e) {
      e.preventDefault();
      
      const form = e.target;
      const formData = new FormData(form);
      
      // Get project ID from multiple possible sources
      const projectId = localStorage.getItem('selectedProjectId') ||
                       window.projectManager?.currentProject?.id;
      
      if (!projectId) {
        window.showNotification("Please select a project first", "error");
        window.modalManager?.hide("knowledge");
        return;
      }

      try {
        window.showNotification("Setting up knowledge base...", "info");
        
        // Convert form data to object
        const kbData = Object.fromEntries(formData);
        
        // **ENSURE DATA MATCHES Pydantic MODEL**
        const payload = {
          name: kbData.name,
          description: kbData.description || null, // ensure null if empty
          embedding_model: kbData.embedding_model
        };
        
        // UPDATED: Use the project-specific KB creation endpoint
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases`,
          "POST",
          payload  // Use the properly formatted payload
        );
        
        console.log('[DEBUG] Knowledge base creation response:', response);
        
        if (response.data?.id) {
          console.log(`[DEBUG] Knowledge base created with ID: ${response.data.id}`);
          
          // Reload the full project to ensure knowledge_base_id is updated
          if (window.projectManager) {
            await window.projectManager.loadProjectDetails(projectId);
          }
          
          window.showNotification("Knowledge base setup complete", "success");
          window.modalManager?.hide("knowledge");
        } else {
          console.error('[ERROR] Knowledge base response missing data.id:', response);
          throw new Error('Invalid response format from knowledge base creation');
        }
      } catch (error) {
        console.error("Knowledge base setup failed:", error);
        
        // Check for the specific "already has a knowledge base" error
        if (error.message && error.message.includes("Project already has a knowledge base")) {
          window.showNotification(
            "This project already has a knowledge base. Please use the existing one.",
            "warning"
          );
          
          // Try to refresh the project details to ensure KB info is loaded
          if (window.projectManager?.loadProjectDetails && projectId) {
            window.projectManager.loadProjectDetails(projectId);
          }
        } else {
          // Handle other errors
          window.showNotification(
            `Failed to setup knowledge base: ${error.message || 'Unknown error'}`,
            "error"
          );
        }
      }
    }

    /**
     * Load knowledge base health information
     * @private
     * @param {string} kbId - Knowledge base ID
     */
    /**
     * Load knowledge base health information
     * @private
     * @param {string} kbId - Knowledge base ID
     */
    async _loadKnowledgeBaseHealth(kbId) {
      if (!kbId) return null;
      
      try {
        // UPDATED: Use the proper health endpoint
        const response = await window.apiRequest(
          `/api/knowledge-bases/${kbId}/health`,
          "GET"
        );
        
        const health = response.data || {};
        
        // Update status indicator
        this._updateStatusIndicator(health.status === "active");
        
        // Update metadata display
        if (health.processed_files !== undefined) {
          const fileCountEl = document.getElementById("knowledgeFileCount");
          if (fileCountEl) fileCountEl.textContent = health.processed_files;
        }
        
        return health;
      } catch (err) {
        console.error("Failed to load KB health:", err);
        return null;
      }
    }
    
    /**
     * Show loading state for search
     * @private
     */
    _showSearchLoading() {
      const { resultsSection, noResultsSection, resultsContainer } = this.elements;
      
      if (noResultsSection) noResultsSection.classList.add("hidden");
      
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="flex justify-center items-center p-4">
            <div class="spinner mr-2 w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span>Searching...</span>
          </div>
        `;
      }
      
      if (resultsSection) resultsSection.classList.remove("hidden");
    }
    
    /**
     * Show no results message
     * @private
     */
    _showNoResults() {
      const { resultsSection, noResultsSection } = this.elements;
      
      if (resultsSection) resultsSection.classList.add("hidden");
      if (noResultsSection) noResultsSection.classList.remove("hidden");
    }
    
    /**
     * Hide search loading state
     * @private
     */
    _hideSearchLoading() {
      if (this.state.isSearching) return;
      
      // Clear any loading indicators
      const { resultsContainer } = this.elements;
      if (resultsContainer) {
        const loadingEl = resultsContainer.querySelector('.flex.justify-center.items-center');
        if (loadingEl) {
          loadingEl.remove();
        }
      }
    }
    
    /**
     * Update model selection dropdown
     * @private
     * @param {string} selectedModel - Currently selected model
     */
    _updateModelSelection(selectedModel) {
      const modelSelect = document.getElementById("knowledgeBaseModelSelect");
      if (!modelSelect) return;
      
      // Remove any existing error states FIRST
      const existingErrors = modelSelect.parentElement.querySelectorAll('.model-error');
      existingErrors.forEach(e => e.remove());

      modelSelect.innerHTML = `
        <option value="all-MiniLM-L6-v2" ${selectedModel === 'all-MiniLM-L6-v2' ? 'selected' : ''}>
          Local: All-MiniLM-L6-v2 (384d • Fast • Default)
        </option>
        <option value="text-embedding-3-small" ${
          selectedModel === 'text-embedding-3-small' ? 'selected' : ''
        } ${this._validateDimension(1536, selectedModel)}>
          OpenAI: text-embedding-3-small (1536d • Recommended)
        </option>
        <option value="text-embedding-3-large" ${
          selectedModel === 'text-embedding-3-large' ? 'selected' : ''
        } ${this._validateDimension(3072, selectedModel)}>
          OpenAI: text-embedding-3-large (3072d • Largest)
        </option>
        <option value="embed-english-v3.0" ${
          selectedModel === 'embed-english-v3.0' ? 'selected' : ''
        } ${this._validateDimension(1024, selectedModel)}>
          Cohere: embed-english-v3.0 (1024d • English Only)
        </option>
      `;

      // Add dimension validation helpers
      this._validateSelectedModelDimensions();
    }

    // New helper method
    _validateDimension(requiredDim, selectedModel) {
      const currentProject = window.projectManager?.currentProject;
      const existingDim = currentProject?.knowledge_base?.embedding_dimension;
      
      if (existingDim && existingDim !== requiredDim) {
        return 'disabled class="disabled-option" title="Existing vectors use different dimensions"';
      }
      
      return selectedModel ? '' : '';
    }

    // New validation check
    _validateSelectedModelDimensions() {
      const modelSelect = document.getElementById("knowledgeBaseModelSelect");
      const warning = document.createElement('div');
      warning.className = 'model-error text-red-600 text-sm mt-2';
      
      Array.from(modelSelect.options).forEach(opt => {
        if (opt.disabled && opt.selected) {
          warning.textContent = "Warning: Changing dimensions requires re-processing all files!";
          modelSelect.parentElement.appendChild(warning);
        }
      });
    }
    
    /**
     * Update KB stats display
     * @private
     * @param {Object} stats - Knowledge base stats
     */
    _updateKnowledgeBaseStats(stats) {
      const kb = this.state.knowledgeBase;
      if (!kb || !stats) return;

      const fileCountEl = document.getElementById("knowledgeFileCount");
      if (fileCountEl) fileCountEl.textContent = stats.file_count || 0;
      
      const totalSizeEl = document.getElementById("knowledgeFileSize");
      const utils = window.uiUtilsInstance;
      if (totalSizeEl && utils) {
        totalSizeEl.textContent = utils.formatBytes(stats.total_size || 0);
      }

      const formattedVersion = kb.version ? `Schema v${kb.version}` : 'Schema v1';
      const versionElement = document.getElementById('kbVersionDisplay');
      if (versionElement) {
        versionElement.textContent = formattedVersion;
        versionElement.title = `Knowledge Base Schema Version ${kb.version || 1}`;
      }

      const lastUsed = kb.last_used ?
        window.uiUtilsInstance.formatDate(kb.last_used) : 'Never';
      const lastUsedElement = document.getElementById('kbLastUsedDisplay'); 
      if (lastUsedElement) {
        lastUsedElement.textContent = lastUsed;
        lastUsedElement.title = kb.last_used ? 
          `Last queried at ${new Date(kb.last_used).toLocaleString()}` :
          'This knowledge base has never been queried';
      }
    }
    
    /**
     * Update status indicator text
     * @private
     * @param {boolean} isActive - Whether KB is active
     */
    _updateStatusIndicator(isActive) {
      const statusElement = document.getElementById("kbStatusText");
      if (statusElement) {
        statusElement.textContent = isActive ? "Active" : "Inactive";
        statusElement.className = isActive
          ? "text-green-600 font-medium"
          : "text-red-600 font-medium";

        // Make it clearer to the user what the state means
        statusElement.title = isActive
          ? "Knowledge base is enabled and will be used for search and conversation context"
          : "Knowledge base is disabled and will not be used until activated";
      }
      
      // Update additional status indicators if they exist
      const statusBadge = document.getElementById("kbStatusBadge");
      if (statusBadge) {
        statusBadge.className = isActive
          ? "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
          : "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800";
        statusBadge.innerHTML = isActive
          ? '<span class="h-2 w-2 rounded-full bg-green-400 mr-1.5"></span>Active'
          : '<span class="h-2 w-2 rounded-full bg-red-400 mr-1.5"></span>Inactive';
      }
    }
    
    /**
     * Update upload buttons state based on KB status
     * @private
     * @param {boolean} hasKnowledgeBase - Whether project has a KB
     * @param {boolean} isActive - Whether KB is active
     */
    /**
     * Format source filename for display
     * @private
     */
    _formatSourceName(filename) {
      if (!filename) return "Unknown source";
      // Truncate long filenames
      return filename.length > 25 ? filename.substring(0, 22) + '...' : filename;
    }
    
    /**
     * Update upload buttons state based on KB status
     * @private
     */
    _updateUploadButtonsState(hasKnowledgeBase, isActive) {
      const uploadButtons = document.querySelectorAll('[data-requires-kb="true"]');
      const fileCountEl = document.getElementById("knowledgeFileCount");
      const fileCount = fileCountEl ? parseInt(fileCountEl.textContent, 10) || 0 : 0;
      
      uploadButtons.forEach(button => {
        const isDisabled = !hasKnowledgeBase || !isActive;
        button.disabled = isDisabled;
        
        if (isDisabled) {
          button.classList.add('opacity-50', 'cursor-not-allowed');
          button.title = !hasKnowledgeBase
            ? "Knowledge Base required to upload files - click 'Setup Knowledge Base' first"
            : "Knowledge Base is inactive - toggle it on to enable uploads";
        } else {
          button.classList.remove('opacity-50', 'cursor-not-allowed');
          button.title = fileCount > 0
            ? "Upload more files to Knowledge Base"
            : "Upload your first file to Knowledge Base";
        }
      });
      
      // Update reprocess button state based on file count
      if (this.elements.reprocessButton) {
        if (fileCount === 0) {
          this.elements.reprocessButton.disabled = true;
          this.elements.reprocessButton.classList.add('opacity-50', 'cursor-not-allowed');
          this.elements.reprocessButton.title = "No files to process - upload files first";
        } else {
          this.elements.reprocessButton.disabled = !hasKnowledgeBase || !isActive;
          if (!hasKnowledgeBase || !isActive) {
            this.elements.reprocessButton.classList.add('opacity-50', 'cursor-not-allowed');
            this.elements.reprocessButton.title = "Knowledge Base must be active to process files";
          } else {
            this.elements.reprocessButton.classList.remove('opacity-50', 'cursor-not-allowed');
            this.elements.reprocessButton.title = "Process files for search and context";
          }
        }
      }
    }
    
    /**
     * Render search results
     * @private
     * @param {Array} results - Search results
     */
    /**
     * Render search results with proper error handling and metadata display
     */
    /**
     * Render search results with proper error handling and metadata display
     */
    _renderSearchResults(results) {
        // Validate results is an array before processing
        if (!Array.isArray(results)) results = [];
        const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (!resultsContainer) return;

      // Clear previous results
      resultsContainer.innerHTML = "";
      
      if (!results || results.length === 0) {
        this._showNoResults();
        return;
      }

      resultsSection.classList.remove("hidden");
      noResultsSection.classList.add("hidden");

      results.forEach(result => {
        // Get metadata correctly from the backend response structure
        const metadata = result.metadata || {};
        const score = Math.round((result.score || 0) * 100);
        
        const item = this._createSearchResultItem(
          result.text,
          score,
          metadata,
          result.file_info
        );
        
        item.addEventListener('click', () => this._showResultDetail(result));
        resultsContainer.appendChild(item);
      });
    }

    /**
     * Show detailed view of a search result
     * @private
     */
    _showResultDetail(result) {
      // Get modal elements
      const modal = document.getElementById('knowledgeResultModal');
      const title = document.getElementById('knowledgeResultTitle');
      const source = document.getElementById('knowledgeResultSource');
      const score = document.getElementById('knowledgeResultScore');
      const content = document.getElementById('knowledgeResultContent');
      
      if (!modal || !title || !source || !score || !content) {
        console.error('Knowledge result modal elements not found');
        return;
      }
      
      // Format score as percentage
      const scorePercentage = Math.round((result.score || 0) * 100);
      
      // Populate modal content
      title.textContent = result.metadata?.file_name || 'Knowledge Result';
      source.textContent = result.metadata?.file_name || 'Unknown source';
      score.textContent = `${scorePercentage}% match`;
      content.textContent = result.text || 'No content available';
      
      // Show modal
      if (window.modalManager?.show) {
        window.modalManager.show('knowledgeResult');
      } else {
        modal.classList.remove('hidden');
      }
      
      // Handle "Use in Chat" button
      const useInChatBtn = document.getElementById('useInChatBtn');
      if (useInChatBtn) {
        useInChatBtn.onclick = () => {
          this._useInConversation(result);
          // Hide modal
          if (window.modalManager?.hide) {
            window.modalManager.hide('knowledgeResult');
          } else {
            modal.classList.add('hidden');
          }
        };
      }
    }
    
    /**
     * Use search result in conversation
     * @private
     */
    _useInConversation(result) {
      const chatInput = document.getElementById('projectChatInput') || document.getElementById('chatInput');
      if (!chatInput) {
        window.showNotification("Chat input not found", "error");
        return;
      }
      
      // Format the content for the input
      const content = `Reference from "${result.metadata?.file_name || 'knowledge base'}":\n\n${result.text}\n\nPlease analyze this content.`;
      
      // Set the input value
      chatInput.value = content;
      
      // Focus the input
      chatInput.focus();
      
      // Show notification
      window.showNotification("Knowledge content added to chat input", "success");
    }

    /**
     * Create individual search result item with proper metadata
     */
    /**
     * Create individual search result item with proper metadata
     */
    _createSearchResultItem(content, score, metadata, fileInfo) {
      const utils = window.uiUtilsInstance;
      
      // Standardize metadata handling with defaults
      const filename = fileInfo?.filename || metadata.file_name || "Unknown source";
      const fileType = fileInfo?.file_type || metadata.file_type || "txt";
      const createdAt = metadata.processed_at || fileInfo?.created_at || new Date().toISOString();
      const chunkIndex = metadata.chunk_index || 0;
      const tokenCount = metadata.token_count || fileInfo?.token_count || 'N/A';
      
      const item = utils.createElement("div", {
        className: "content-item bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-3 " +
                   "cursor-pointer hover:shadow-md transition-shadow"
      });

      // Header with file info and score
      const header = utils.createElement("div", {
        className: "flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-2 mb-2"
      });

      // Source info section
      const sourceDiv = utils.createElement("div", { className: "flex items-center truncate" });
      sourceDiv.appendChild(utils.createElement("span", {
        className: "text-lg mr-2",
        textContent: utils.fileIcon(fileType)
      }));
        
      const sourceDetails = utils.createElement("div", { className: "truncate" });
      sourceDetails.appendChild(utils.createElement("div", {
        className: "font-medium truncate",
        textContent: filename,
        title: filename
      }));
      sourceDetails.appendChild(utils.createElement("div", {
        className: "text-xs text-gray-500 truncate",
        textContent: `Chunk ${chunkIndex} • ${utils.formatDate(createdAt)}`
      }));
      
      sourceDiv.appendChild(sourceDetails);
      header.appendChild(sourceDiv);

      // Score badge
      header.appendChild(utils.createElement("div", {
        className: `text-xs px-2 py-1 rounded ${
          score > 75 ? "bg-green-100 text-green-800" :
          score > 50 ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-600"
        }`,
        textContent: `${score}% match`
      }));

      item.appendChild(header);

      // Content snippet (limited to 3 lines)
      const contentDiv = utils.createElement("div", {
        className: "text-sm text-gray-600 dark:text-gray-300 line-clamp-3 mb-2",
        textContent: content?.substring(0, 300) || "No content available"
      });
      item.appendChild(contentDiv);

      // Metadata row
      const metaData = [
        `Tokens: ${metadata.token_count || fileInfo?.token_count || 'N/A'}`,
        `Chunk Size: ${metadata.chunk_size || 'N/A'}`,
        `From: ${this._formatSourceName(fileInfo?.filename || metadata.file_name || 'Unknown')}`
      ];
      
      item.appendChild(this._createMetaRow(...metaData));
      return item;
    }

    _createMetaRow(...items) {
      const row = window.uiUtilsInstance.createElement("div", {
        className: "flex justify-between text-xs text-gray-500 mt-2"
      });
      
      items.forEach(text => {
        row.appendChild(window.uiUtilsInstance.createElement("span", {textContent: text}));
      });
      
      return row;
    }
  }

  // IMPORTANT: Export to window
  window.KnowledgeBaseComponent = KnowledgeBaseComponent;
})();
