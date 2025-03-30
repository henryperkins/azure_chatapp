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

      // Style the search button if it exists
      if (this.elements.searchButton) {
        this.elements.searchButton.className =
          'px-4 py-2.5 bg-blue-600 text-white rounded-lg ' +
          'hover:bg-blue-700 transition-colors duration-200 ' +
          'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 ' +
          'text-sm font-medium';
      }
      
      this._bindEvents();
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
        
        // Update name element
        const nameElement = document.getElementById("knowledgeBaseName");
        if (nameElement) {
          nameElement.textContent = kb.name || "Project Knowledge Base";
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
    async toggleKnowledgeBase(enabled) {
      const project = window.projectManager?.currentProject;
      if (!project?.knowledge_base_id) return;
      
      const toggle = this.elements.kbToggle;
      const originalState = toggle.checked;
      
      // Optimistic UI update
      toggle.checked = enabled;
      window.showNotification(
        `${enabled ? "Enabling" : "Disabling"} knowledge base...`,
        "info"
      );
      
      try {
        await window.apiRequest(
          `/api/knowledge-bases/${project.knowledge_base_id}`,
          "PATCH",
          { is_active: enabled }
        );
        
        window.showNotification(
          `Knowledge base ${enabled ? "enabled" : "disabled"}`,
          "success"
        );
        
        // Refresh stats and KB info
        if (window.projectManager) {
          await Promise.all([
            window.projectManager.loadProjectStats(project.id),
            this._loadKnowledgeBaseHealth(project.knowledge_base_id)
          ]);
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
    searchKnowledgeBase(query) {
      // Debug log current project state
      console.debug('Current project state:', {
        hasProjectManager: !!window.projectManager,
        currentProject: window.projectManager?.currentProject,
        projectId: window.projectManager?.currentProject?.id
      });

      const projectId = window.projectManager?.currentProject?.id;
      if (!projectId) {
        console.error('KB Search failed - no valid project selected');
        window.showNotification("Please select a project first", "error");
        this.state.isSearching = false;
        if (typeof this._hideSearchLoading === 'function') {
            this._hideSearchLoading();
        }
        return Promise.reject('No project selected');
      }
      
      if (typeof this._showSearchLoading === 'function') {
        this._showSearchLoading();
      }
      this.state.isSearching = true;
      
      window.apiRequest(`/api/projects/${projectId}/knowledge-bases/search`, "POST", {
        query,
        top_k: 5
      })
        .then(response => {
          this.state.isSearching = false;
          const results = response.data?.results || [];
          if (typeof this._renderSearchResults === 'function') {
            this._renderSearchResults(results);
          }
        })
        .catch(err => {
          this.state.isSearching = false;
          console.error("Error searching knowledge base:", err);
          window.showNotification("Search failed", "error");
          if (typeof this._showNoResults === 'function') {
            this._showNoResults();
          }
        });
    }

    /**
     * Reprocess files in the knowledge base
     */
    async reprocessFiles() {
      const projectId = window.projectManager?.currentProject?.id;
      if (!projectId) return;

      try {
        window.showNotification("Reprocessing files for search...", "info");
        const response = await window.apiRequest(
          `/api/projects/${projectId}/files/reprocess`,
          "POST"
        );
        
        window.showNotification(
          `Reprocessed ${response.data.processed_success} files successfully`,
          "success"
        );
        
        // Refresh the file list and stats
        if (window.projectManager) {
          window.projectManager.loadProjectFiles(projectId);
          window.projectManager.loadProjectStats(projectId);
        }
      } catch (error) {
        // Handle specific status codes
        const status = error?.response?.status;
        let errorMessage = "Failed to reprocess files";
        
        if (status === 422) {
          errorMessage = "Cannot process files: validation failed";
        } else if (status === 404) {
          errorMessage = "Project or knowledge base not found";
        } else if (error?.response?.data?.detail) {
          errorMessage = error.response.data.detail;
        }
        
        window.showNotification(errorMessage, "error");
        console.error("Reprocessing error:", error);
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
      // Search button
      this.elements.searchButton?.addEventListener("click", () => {
        const query = this.elements.searchInput?.value?.trim();
        if (query) this.searchKnowledgeBase(query);
      });
      
      // Search input (Enter key)
      this.elements.searchInput?.addEventListener("keyup", (e) => {
        if (e.key === "Enter") {
          const query = e.target.value.trim();
          if (query) this.searchKnowledgeBase(query);
        }
      });
  
      // Reprocess files button
      if (this.elements.reprocessButton) {
        this.elements.reprocessButton.className =
          'px-4 py-2.5 bg-gray-600 text-white rounded-lg ' +
          'hover:bg-gray-700 transition-colors duration-200 ' +
          'focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 ' +
          'text-sm font-medium';
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

      // KB form submit
      document.getElementById("knowledgeBaseForm")?.addEventListener("submit", (e) => 
        this._handleKnowledgeBaseFormSubmit(e));
    }
    
    /**
     * Show the knowledge base settings modal
     * @private
     */
    _showKnowledgeBaseModal() {
      console.log('[DEBUG] Opening knowledge base modal');
      
      if (window.modalManager) {
        window.modalManager.show("knowledge");
        console.log('[DEBUG] Using modalManager to show KB modal');
      } else if (window.ModalManager && typeof window.ModalManager.show === 'function') {
        // Try using static ModalManager method if available
        window.ModalManager.show("knowledge");
        console.log('[DEBUG] Using ModalManager.show to show KB modal');
      } else {
        // Fallback to direct DOM manipulation if modalManager isn't available
        const modal = document.getElementById('knowledgeBaseSettingsModal');
        if (modal) {
          console.log('[DEBUG] Showing KB modal directly via DOM');
          modal.classList.remove('hidden');
        } else {
          console.error('[ERROR] KB settings modal not found in DOM');
        }
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
        console.error('No project ID found in:', {
          localStorage: localStorage.getItem('selectedProjectId'),
          projectManager: window.projectManager?.currentProject,
          pathname: window.location.pathname
        });
        return;
      }

      // Check if project already has a knowledge base
      const currentProject = window.projectManager?.currentProject;
      if (currentProject?.knowledge_base_id) {
        console.log('[DEBUG] Project already has knowledge base:', currentProject.knowledge_base_id);
        
        // First try to update the existing KB instead of creating new one
        try {
          console.debug('Checking existing KB:', {
            projectId: currentProject.id,
            kbId: currentProject.knowledge_base_id
          });
          
          const kbResponse = await window.apiRequest(
            `/api/knowledge-bases/${currentProject.knowledge_base_id}`,
            "GET"
          );
          
          console.debug('Existing KB details:', kbResponse.data);
          
          window.showNotification(
            kbResponse.data?.is_active
              ? "Updated active knowledge base settings"
              : "Updated inactive knowledge base settings",
            "success"
          );
          window.modalManager?.hide("knowledge");
          
          // Refresh project details to ensure KB status is current
          if (window.projectManager) {
            await window.projectManager.loadProjectDetails(projectId);
          }
          return;
        } catch (updateError) {
          console.error('Failed to update existing KB:', updateError);
          window.showNotification(
            "This project already has a knowledge base. Please use the existing one.",
            "warning"
          );
          window.modalManager?.hide("knowledge");
          return;
        }
      }

      try {
        // First verify project doesn't already have a KB
        const project = await window.projectManager.getProjectDetails(projectId);
        if (project.knowledge_base_id) {
          throw new Error('Project already has a knowledge base');
        }

        console.log('[DEBUG] Setting up knowledge base for project:', projectId);
        window.showNotification("Setting up knowledge base...", "info");
        
        // Convert form data to object
        const kbData = Object.fromEntries(formData);
        console.log('[DEBUG] Knowledge base data:', kbData);
        
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases`,
          "POST",
          kbData
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
    async _loadKnowledgeBaseHealth(kbId) {
      try {
        const health = await window.apiRequest(
          `/api/knowledge-bases/${kbId}/health`,
          "GET"
        );
        // TODO: Implement renderHealthStatus if needed
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
      
      if (resultsSection) resultsSection.classList.add("hidden");
      if (noResultsSection) noResultsSection.classList.add("hidden");
      
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div class="flex justify-center items-center p-4">
            <div class="spinner mr-2 w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <span>Searching...</span>
          </div>
        `;
        resultsSection.classList.remove("hidden");
      }
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
     * Update model selection dropdown
     * @private
     * @param {string} selectedModel - Currently selected model
     */
    _updateModelSelection(selectedModel) {
      const modelSelect = document.getElementById("knowledgeBaseModelSelect");
      if (!modelSelect) return;
      
      modelSelect.innerHTML = `
        <option value="all-MiniLM-L6-v2" ${selectedModel === 'all-MiniLM-L6-v2' ? 'selected' : ''}>
          all-MiniLM-L6-v2 (Default)
        </option>
        <option value="text-embedding-3-small" ${selectedModel === 'text-embedding-3-small' ? 'selected' : ''}>
          OpenAI text-embedding-3-small
        </option>
        <option value="embed-english-v3.0" ${selectedModel === 'embed-english-v3.0' ? 'selected' : ''}>
          Cohere embed-english-v3.0
        </option>
      `;
    }
    
    /**
     * Update KB stats display
     * @private
     * @param {Object} stats - Knowledge base stats
     */
    _updateKnowledgeBaseStats(stats) {
      if (!stats) return;
      
      const fileCountEl = document.getElementById("knowledgeFileCount");
      if (fileCountEl) fileCountEl.textContent = stats.file_count || 0;
      
      const totalSizeEl = document.getElementById("knowledgeFileSize");
      const utils = window.uiUtilsInstance;
      if (totalSizeEl && utils) {
        totalSizeEl.textContent = utils.formatBytes(stats.total_size || 0);
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
      }
    }
    
    /**
     * Update upload buttons state based on KB status
     * @private
     * @param {boolean} hasKnowledgeBase - Whether project has a KB
     * @param {boolean} isActive - Whether KB is active
     */
    _updateUploadButtonsState(hasKnowledgeBase, isActive) {
      const uploadButtons = document.querySelectorAll('[data-requires-kb="true"]');
      uploadButtons.forEach(button => {
        const isDisabled = !hasKnowledgeBase || !isActive;
        button.disabled = isDisabled;
        
        if (isDisabled) {
          button.classList.add('opacity-50', 'cursor-not-allowed');
          button.title = !hasKnowledgeBase
            ? "Knowledge Base required to upload files"
            : "Knowledge Base is inactive";
        } else {
          button.classList.remove('opacity-50', 'cursor-not-allowed');
          button.title = "Upload file to Knowledge Base";
        }
      });
    }
    
    /**
     * Render search results
     * @private
     * @param {Array} results - Search results
     */
    _renderSearchResults(results) {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (!resultsContainer) return;
      
      if (!results || results.length === 0) {
        this._showNoResults();
        return;
      }
      
      resultsContainer.innerHTML = "";
      resultsSection.classList.remove("hidden");
      noResultsSection.classList.add("hidden");
      
      const utils = window.uiUtilsInstance;
      
      results.forEach(result => {
        // Extract error details if present
        const errorDetails = result.metadata?.processing_error;
        const hasError = errorDetails && !result.success;
        
        const item = utils.createElement("div", {
          className: `content-item bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-3 hover:shadow-md transition-shadow ${
            hasError ? "border-l-4 border-red-500" : ""
          }`
        });
        
        // Header with file info and match score
        const header = utils.createElement("div", {
          className: "flex justify-between items-center border-b border-gray-200 pb-2 mb-2"
        });
        
        const fileInfo = utils.createElement("div", { className: "flex items-center" });
        fileInfo.appendChild(utils.createElement("span", {
          className: "text-lg mr-2",
          textContent: utils.fileIcon(result.file_type || "txt")
        }));
        fileInfo.appendChild(utils.createElement("div", {
          className: "font-medium",
          textContent: result.filename || result.file_path || "Unknown source"
        }));
        
        header.appendChild(fileInfo);
        header.appendChild(utils.createElement("div", {
          className: "text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded",
          textContent: `${Math.round(result.score * 100)}% match`
        }));
        
        item.appendChild(header);
        
        // Content snippet
        const snippet = utils.createElement("div", {
          className: "text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-3"
        });
        
        const textContent = result.text || result.content || "";
        snippet.textContent = textContent.length > 200 
          ? textContent.substring(0, 200) + "..." 
          : textContent;
        
        item.appendChild(snippet);
        resultsContainer.appendChild(item);
      });
    }
  }

  // IMPORTANT: Export to window
  window.KnowledgeBaseComponent = KnowledgeBaseComponent;
})();