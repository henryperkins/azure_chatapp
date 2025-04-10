/**
 * knowledgeBaseComponent.js
 * -----------------------
 * Component for managing knowledge base functionality
 */

(function () {
  'use strict';

  /**
   * Knowledge Base Component - Handles knowledge base functionality
   * @typedef {Object} KnowledgeBaseOptions
   * @property {string} [name] - Optional name for the knowledge base
   *
   * @class KnowledgeBaseComponent
   */
  class KnowledgeBaseComponent {
    /**
     * @param {KnowledgeBaseOptions} [options] - Configuration options
     */
    /**
     * Initialize the knowledge base component
     * @param {Object} options - Configuration options (optional)
     */
    constructor(options = {}) {
      console.log('[DEBUG] Initializing KnowledgeBaseComponent');

      // Verify required elements exist
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
        'knowledgeTopK' // Added element for top_k selection
      ];
      let allElementsFound = true;
      requiredElements.forEach(id => {
        if (!document.getElementById(id)) {
          console.log(`KB Component: Optional element #${id} not found - this is expected if feature is unused.`);
          // Mark as false only if critical elements are missing, decide based on functionality
          if ([
            'knowledgeTab',
            'knowledgeBaseActive',
            'knowledgeBaseInactive',
            'knowledgeBaseModelSelect',
            'knowledgeFileSize',
            'kbStatusText',
            'kbStatusBadge'
          ].includes(id)) {
            allElementsFound = false;
            console.error(`KB Component: CRITICAL element #${id} missing in DOM. Component cannot initialize properly.`);
          }
        }
      });

      if (!allElementsFound) {
        console.error("KB Component: Cannot initialize due to missing critical DOM elements.");
        return; // Stop initialization if critical elements are missing
      }

      // Add style for disabled model options
      // Get access to UIUtils for styling if available, otherwise create directly
      const utils = window.uiUtilsInstance;
      const style = document.createElement('style');
      style.textContent = `
        .disabled-option {
          opacity: 0.5;
          cursor: not-allowed;
          color: #999; /* Optional: gray out text */
        }
        .disabled-option:hover {
          background-color: inherit !important; /* Prevent hover background */
        }
        /* Basic spinner style */
        .spinner {
          border: 2px solid rgba(0, 0, 0, 0.1);
          border-left-color: #2563eb; /* Blue */
          border-radius: 50%;
          width: 1rem;
          height: 1rem;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        /* Line clamp utility */
        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        /* Notification styles (basic example) */
        .notification {
          padding: 0.75rem 1rem;
          margin-bottom: 1rem;
          border-radius: 0.375rem;
          border: 1px solid transparent;
        }
        .notification.info {
          color: #0c5460; background-color: #d1ecf1; border-color: #bee5eb;
        }
        .notification.warning {
          color: #856404; background-color: #fff3cd; border-color: #ffeeba;
        }
        .notification.error {
          color: #721c24; background-color: #f8d7da; border-color: #f5c6cb;
        }
        .notification.success {
          color: #155724; background-color: #d4edda; border-color: #c3e6cb;
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
        statusIndicator: document.getElementById("kbStatusIndicator"), // Main status area
        statusText: document.getElementById("kbStatusText"), // Specific text for Active/Inactive
        statusBadge: document.getElementById("kbStatusBadge"), // Optional badge
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
        topKSelect: document.getElementById('knowledgeTopK') // Element for Top K
      };

      // Add missing focus styles to search button if it exists
      if (this.elements.searchButton) {
        this.elements.searchButton.classList.add(
          'focus:outline-none',
          'focus:ring-2',
          'focus:ring-blue-500',
          'focus:ring-opacity-50'
        );
      }

      // Add auth state change listener
      document.addEventListener('authStateChanged', (e) => {
        const { authenticated } = e.detail;
        if (!authenticated) {
          // Handle unauthenticated state - disable interactive elements
          this._disableInteractiveElements();
        } else {
          // Re-enable elements and potentially refresh data
          this._enableInteractiveElements();
        }
      });

      // Setup debounced search
      this.debouncedSearch = this._debounce(this.searchKnowledgeBase.bind(this), 300); // 300ms delay

      // Bind all events
      this._bindEvents();
    }

    /**
     * Display a status alert message in the KB status indicator area.
     * @param {string} message - The message to display.
     * @param {'info' | 'warning' | 'error' | 'success'} type - The alert type.
     * @private
     */
    _showStatusAlert(message, type) {
      if (!this.elements.statusIndicator) return;

      const utils = window.uiUtilsInstance;

      // Use UIUtils if available, otherwise create directly
      if (utils && utils.createElement) {
        const alertDiv = utils.createElement('div', {
          className: `notification ${type}`,
          innerHTML: message
        });

        // Optional close button for info/warning
        if (['info', 'warning'].includes(type)) {
          const closeButton = utils.createElement('button', {
            className: 'ml-2 text-lg leading-none font-semibold',
            innerHTML: '&times;',
            onclick: () => alertDiv.remove()
          });
          alertDiv.appendChild(closeButton);
        }

        this.elements.statusIndicator.appendChild(alertDiv);
      } else {
        // Fallback to direct DOM creation
        const alertDiv = document.createElement('div');
        alertDiv.className = `notification ${type}`;
        alertDiv.innerHTML = `${message}`;

        // Optional close button for info/warning
        if (['info', 'warning'].includes(type)) {
          const closeButton = document.createElement('button');
          closeButton.className = 'ml-2 text-lg leading-none font-semibold';
          closeButton.innerHTML = '&times;'; // Close symbol
          closeButton.onclick = () => alertDiv.remove();
          alertDiv.appendChild(closeButton);
        }

        this.elements.statusIndicator.appendChild(alertDiv);
      }
    }

    /**
     * Update text content and title of an element by ID.
     * @param {string} elementId - The ID of the DOM element.
     * @param {string} text - The text content to set.
     * @param {string} fallbackLabel - Label for the title attribute.
     * @private
     */
    _updateElementText(elementId, text, fallbackLabel) {
      const el = document.getElementById(elementId);
      if (el) {
        el.textContent = text;
        el.title = `${fallbackLabel}: ${text}`;
      } else {
        console.warn(`Element #${elementId} not found for KB info display`);
      }
    }

    /**
     /**
      * Get current project ID from multiple sources with fallback support.
      * @param {string|null} fallbackId - Optional fallback project ID.
      * @returns {string|null} The current project ID or null if not found.
      * @private
      */
     _getCurrentProjectId(fallbackId = null) {
       // 1. Check active section data attribute
       if (this.elements.activeSection?.dataset?.projectId) {
         return this.elements.activeSection.dataset.projectId;
       }
       // 2. Check localStorage
       const storedId = localStorage.getItem('selectedProjectId');
       if (storedId) return storedId;
       // 3. Check projectManager global (ensure it exists)
       if (typeof window.projectManager !== 'undefined' && window.projectManager?.currentProject?.id) {
         return window.projectManager.currentProject.id;
       }
       // 4. Use provided fallback ID if available
       if (fallbackId) return fallbackId;
 
       console.warn('Could not determine current project ID.');
       return null;
     }
    /**
     * Formats a filename for display, truncating if necessary.
     * @param {string} filename - The original filename.
     * @returns {string} The formatted filename.
     * @private
     */
    _formatSourceName(filename) {
      if (!filename) return "Unknown source";
      const maxLength = 25;
      return filename.length > maxLength ? `${filename.substring(0, maxLength - 3)}...` : filename;
    }

    /**
     * Disable interactive elements when user is not authenticated
     * @private
     */
    _disableInteractiveElements() {
      const interactiveElements = [
        this.elements.searchButton,
        this.elements.reprocessButton,
        this.elements.setupButton,
        this.elements.kbToggle
      ];
      
      interactiveElements.forEach(el => {
        if (el) {
          el.disabled = true;
          el.classList.add('opacity-50', 'cursor-not-allowed');
        }
      });
      
      // Show authentication required message
      this._showStatusAlert("Authentication required to use knowledge base features.", "warning");
    }

    /**
     * Enable interactive elements when user is authenticated
     * @private
     */
    _enableInteractiveElements() {
      const interactiveElements = [
        this.elements.searchButton,
        this.elements.setupButton
      ];
      
      interactiveElements.forEach(el => {
        if (el) {
          el.disabled = false;
          el.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      });
      
      // Re-enable toggle and reprocess based on KB state
      this._updateUploadButtonsState(!!this.state.knowledgeBase, this.state.knowledgeBase?.is_active !== false);
    }

    /* ===========================
       PUBLIC METHODS
       =========================== */

    /**
     * Render knowledge base information in the UI based on provided data.
     * @param {Object|null} kb - Knowledge base data object, or null if none exists.
     */
    renderKnowledgeBaseInfo(kb, projectId = null) {
      const { activeSection, inactiveSection, kbToggle, statusIndicator, kbNameDisplay, kbVersionDisplay, kbLastUsedDisplay } = this.elements;

      // Clear previous status alerts
      if (statusIndicator) statusIndicator.innerHTML = '';

      if (!activeSection || !inactiveSection) {
        console.error("KB Component: Active/Inactive sections not found in DOM.");
        return;
      }

      if (kb) {
        console.log('[DEBUG] Rendering knowledge base info:', kb);
        this.state.knowledgeBase = kb;

        // Store project and KB IDs in data attributes for reference
        const currentProjectId = this._getCurrentProjectId(projectId) || kb.project_id;
        if (currentProjectId && activeSection) {
          activeSection.dataset.projectId = currentProjectId;
        }
        if (kb.id && activeSection) {
          activeSection.dataset.kbId = kb.id;
        }

        // Update KB Name
        if (kbNameDisplay) {
          kbNameDisplay.textContent = kb.name || "Project Knowledge Base";
          kbNameDisplay.title = `Knowledge Base Name: ${kb.name || 'Default'}`;
        }

        // Update Version
        const versionValue = kb.version ? `v${kb.version}` : 'v1';
        if (kbVersionDisplay) {
          kbVersionDisplay.textContent = versionValue;
          kbVersionDisplay.title = `Schema Version: ${versionValue}`;
        }

        // Update Last Used
        const lastUsedText = kb.last_used && typeof window.uiUtilsInstance?.formatDate === 'function'
          ? window.uiUtilsInstance.formatDate(kb.last_used)
          : kb.last_used
            ? new Date(kb.last_used).toLocaleString()
            : "Never used";
        if (kbLastUsedDisplay) {
          kbLastUsedDisplay.textContent = lastUsedText;
          kbLastUsedDisplay.title = kb.last_used ? `Last used: ${new Date(kb.last_used).toLocaleString()}` : "Not used yet";
        }

        // Update Toggle State (handle undefined/null as active)
        const isActive = kb.is_active !== false;
        if (kbToggle) {
          kbToggle.checked = isActive;
        }

        // Update Embedding Model Selection
        this._updateModelSelection(kb.embedding_model);

        // Update Stats Display
        this._updateKnowledgeBaseStats(kb.stats);

        // Update Status Indicator (Text and Badge)
        this._updateStatusIndicator(isActive);

        // Show relevant status alerts based on KB state
        if (isActive) {
          if (kb.stats?.file_count === 0) {
            this._showStatusAlert("Knowledge Base is empty - upload files to use.", "warning");
          } else if (kb.stats?.file_count > 0 && kb.stats?.chunk_count === 0 && kb.stats?.unprocessed_files > 0) {
            // If files exist but none are processed, prompt reprocessing
            this._showStatusAlert("Files need processing. Click 'Reprocess Files'.", "warning");
          } else if (kb.stats?.unprocessed_files > 0) {
            // If some files are unprocessed
            this._showStatusAlert(`${kb.stats.unprocessed_files} file(s) need processing.`, "info");
          }
        } else {
          this._showStatusAlert("Knowledge Base is disabled. Toggle on to use.", "warning");
        }

        // Show active section, hide inactive
        activeSection.classList.remove("hidden");
        inactiveSection.classList.add("hidden");

        // Update upload/reprocess button states
        this._updateUploadButtonsState(true, isActive);

        // Load health status asynchronously
        if (kb.id) {
          this._loadKnowledgeBaseHealth(kb.id);
        }

      } else {
        // No knowledge base exists for the project
        this.state.knowledgeBase = null;
        if (activeSection) activeSection.classList.add("hidden");
        if (inactiveSection) inactiveSection.classList.remove("hidden");

        // Update status indicator for inactive state
        this._updateStatusIndicator(false); // Show as inactive/required
        if (this.elements.statusText) this.elements.statusText.textContent = "Setup Required";
        this._showStatusAlert("Knowledge Base needed. Click 'Setup' to begin.", "info");


        // Disable upload/reprocess buttons
        this._updateUploadButtonsState(false, false);
      }
    }

    /**
     * Toggle the knowledge base active state via API call.
     * @param {boolean} enabled - The desired state (true for enabled, false for disabled).
     */
    async toggleKnowledgeBase(enabled) {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        console.warn('Toggle KB failed: No active project selected');
        if (window.showNotification) {
          window.showNotification("Please select a project first", "error");
        }
        // Revert UI if toggle element exists
        if (this.elements.kbToggle) this.elements.kbToggle.checked = !enabled;
        return;
      }

      // Verify authentication before proceeding
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) {
          console.warn('Toggle KB failed: User not authenticated');
          if (window.showNotification) {
            window.showNotification("Please login to toggle knowledge base", "error");
          }
          if (this.elements.kbToggle) this.elements.kbToggle.checked = !enabled;
          return;
        }
      } catch (authError) {
        window.auth.handleAuthError(authError, "knowledge base toggle");
        if (this.elements.kbToggle) this.elements.kbToggle.checked = !enabled;
        return;
      }

      const toggle = this.elements.kbToggle;
      const originalState = toggle ? toggle.checked : !enabled; // Store original state before optimistic update

      // Optimistic UI update
      if (toggle) toggle.disabled = true; // Disable during request
      this._updateStatusIndicator(enabled); // Update text/badge immediately
      if (window.showNotification) {
        window.showNotification(`${enabled ? "Enabling" : "Disabling"} knowledge base...`, "info");
      }

      try {
        const token = await window.auth.getAuthToken();
        await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/toggle`,
          "POST",
          { enable: enabled },
          token
        );

        // Update localStorage for potential cross-component use (e.g., chat)
        localStorage.setItem(`kb_enabled_${projectId}`, String(enabled));

        // Invalidate cache if a state manager is available
        if (window.knowledgeBaseState?.invalidateCache) {
          window.knowledgeBaseState.invalidateCache(projectId);
        }

        if (window.showNotification) {
          window.showNotification(`Knowledge base ${enabled ? "enabled" : "disabled"}`, "success");
        }

        // Refresh project details and stats after toggle
        if (window.projectManager?.loadProjectDetails) {
          const project = await window.projectManager.loadProjectDetails(projectId);
          // Re-render KB info with updated data from the project
          this.renderKnowledgeBaseInfo(project?.knowledge_base);
        } else {
          // Fallback if projectManager isn't available: update internal state and re-render partially
          if (this.state.knowledgeBase) this.state.knowledgeBase.is_active = enabled;
          this.renderKnowledgeBaseInfo(this.state.knowledgeBase); // Re-render with potentially stale data but correct active state
        }


      } catch (err) {
        console.error("Error toggling knowledge base:", err);
        // Revert UI on error
        if (toggle) toggle.checked = originalState;
        this._updateStatusIndicator(originalState);
        if (window.showNotification) {
          window.showNotification(`Failed to toggle knowledge base: ${err.message || "Unknown error"}`, "error");
        }
      } finally {
        if (toggle) toggle.disabled = false; // Re-enable toggle
      }
    }

    /**
     * Search the knowledge base with the given query.
     * Uses debouncing via `this.debouncedSearch`.
     * @param {string} query - The search query string.
     */
    async searchKnowledgeBase(query) {
      const projectId = this._getCurrentProjectId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!projectId || !uuidRegex.test(projectId)) {
        console.error('KB Search failed: Invalid project ID', projectId);
        if (window.showNotification) {
          window.showNotification("Please select a project first", "error");
        }
        this._hideSearchLoading();
        return; // Don't proceed
      }

      // Verify authentication before proceeding
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) {
          console.error('KB Search failed: User not authenticated');
          if (window.showNotification) {
            window.showNotification("Please login to search knowledge base", "error");
          }
          this._hideSearchLoading();
          return;
        }
      } catch (authError) {
        // Use auth.js error handling
        window.auth.handleAuthError(authError, "knowledge base search");
        this._hideSearchLoading();
        return;
      }

      const trimmedQuery = query ? query.trim() : '';
      // Special handling for CJK characters which can be meaningful single characters
      const cjkRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/;
      const isCJK = cjkRegex.test(trimmedQuery);
      
      if (!isCJK && trimmedQuery.length < 2) {
        if (window.showNotification) {
          window.showNotification("Search query must be at least 2 characters (1 for Chinese/Japanese)", "warning");
        }
        this._hideSearchLoading();
        this._showNoResults();
        return;
      }

      // Prevent multiple simultaneous searches
      if (this.state.isSearching) {
        console.log("Search already in progress, skipping.");
        return;
      }

      this.state.isSearching = true;
      this._showSearchLoading();

      // Get top_k value from UI or use default
      const topK = this.elements.topKSelect ? parseInt(this.elements.topKSelect.value, 10) : 5;

      // Set a reasonable timeout for the API request (e.g., 10 seconds)
      const requestTimeoutMs = 10000;
      let loadingTimeoutId = setTimeout(() => {
        if (this.state.isSearching) {
          if (window.showNotification) {
            window.showNotification("Search is taking longer than expected...", "info");
          }
        }
      }, 5000); // Notify after 5 seconds

      try {
        const token = await window.auth.getAuthToken();
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases/search`,
          "POST",
          {
            query: trimmedQuery,
            top_k: topK
          },
          token,
          0, // retryCount
          requestTimeoutMs // timeoutMs
        );

        // Ensure results is always an array, even if API returns null/undefined
        const results = Array.isArray(response.data?.results) ? response.data.results : [];

        if (results.length === 0) {
          if (window.showNotification) {
            window.showNotification("No matching results found", "info");
          }
          this._showNoResults();
        } else {
          this._renderSearchResults(results);
        }

      } catch (err) {
        console.error("Knowledge base search error:", err);
        let errorMsg = "Search failed";
        if (err.message?.toLowerCase().includes('timeout')) {
          errorMsg = "Search timed out. Please try again or check KB status.";
        } else if (err.response?.status === 404) {
          errorMsg = "Knowledge base not found or not set up for this project.";
        } else if (err.response?.data?.detail) {
          errorMsg = `Search failed: ${err.response.data.detail}`;
        }

        if (window.showNotification) {
          window.showNotification(errorMsg, "error");
        }
        this._showNoResults(); // Show no results on error
      } finally {
        clearTimeout(loadingTimeoutId); // Clear the notification timeout
        this.state.isSearching = false;
        this._hideSearchLoading(); // Ensure loading indicator is hidden
      }
    }

    /**
     * Trigger the reprocessing of files in the knowledge base.
     * Uses the dedicated reindexing endpoint.
     */
    async reprocessFiles() {
      const projectId = this._getCurrentProjectId();
      if (!projectId) {
        if (window.showNotification) {
          window.showNotification("Please select a project first", "error");
        }
        return;
      }

      // Verify authentication before proceeding
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) {
          console.warn('Reprocess Files failed: User not authenticated');
          if (window.showNotification) {
            window.showNotification("Please login to reprocess files", "error");
          }
          return;
        }
      } catch (authError) {
        window.auth.handleAuthError(authError, "knowledge base file reprocessing");
        return;
      }

      const reprocessBtn = this.elements.reprocessButton;
      let originalButtonContent = '';
      if (reprocessBtn) {
        originalButtonContent = reprocessBtn.innerHTML;
        reprocessBtn.disabled = true;
        reprocessBtn.innerHTML = `
          <div class="inline-flex items-center">
            <div class="spinner mr-2"></div>
            Processing...
          </div>`;
      }

      try {
        if (window.showNotification) {
          window.showNotification("Requesting file reprocessing...", "info");
        }

        // Option to force reindex if needed (e.g., add a checkbox later)
        const requestBody = { force_reindex: true }; // Or false depending on UI choice

        const token = await window.auth.getAuthToken();
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-base/reindex`, // Use the correct reindex endpoint
          "POST",
          requestBody,
          token
        );

        const data = response.data || {};
        const message = data.message || "File reprocessing queued successfully.";
        const queuedCount = data.queued_files ?? -1; // Use nullish coalescing

        if (window.showNotification) {
          window.showNotification(message, "success");
        }

        if (queuedCount === 0 && data.total_files === 0) {
          if (window.showNotification) {
            window.showNotification("No files found to reprocess. Upload files first.", "info");
          }
        }

        // Refresh project details, stats, and potentially file list after reindexing is requested
        if (window.projectManager) {
          await Promise.all([
            window.projectManager.loadProjectDetails(projectId),
            window.projectManager.loadProjectStats(projectId),
            // Optionally reload files if a file list component exists
            // window.projectManager.loadProjectFiles(projectId)
          ]).then(([project]) => {
            // Re-render KB info with potentially updated stats/status
            this.renderKnowledgeBaseInfo(project?.knowledge_base);
          });
        } else {
          // Fallback: attempt to reload KB health if possible
          if (this.state.knowledgeBase?.id) {
            await this._loadKnowledgeBaseHealth(this.state.knowledgeBase.id);
          }
        }


      } catch (error) {
        console.error("Reprocessing error:", error);
        let errorMessage = "Failed to reprocess files";
        if (error.response?.status === 404) {
          errorMessage = "Project or knowledge base not found.";
        } else if (error.response?.status === 400) {
          errorMessage = "Cannot reprocess: Invalid request or KB not ready.";
        } else if (error.response?.data?.detail) {
          errorMessage = `Reprocessing failed: ${error.response.data.detail}`;
        }
        if (window.showNotification) {
          window.showNotification(errorMessage, "error");
        }
      } finally {
        // Restore button state
        if (reprocessBtn) {
          reprocessBtn.innerHTML = originalButtonContent;
          reprocessBtn.disabled = false; // Re-enable button
          // Re-evaluate disabled state based on current KB status after potential refresh
          this._updateUploadButtonsState(!!this.state.knowledgeBase, this.state.knowledgeBase?.is_active !== false);
        }
      }
    }


    /* ===========================
       PRIVATE METHODS
       =========================== */

    /**
     * Bind event listeners to DOM elements.
     * @private
     */
    _bindEvents() {
      // Search Button Click
      if (this.elements.searchButton && this.elements.searchInput) {
        this.elements.searchButton.addEventListener("click", () => {
          const query = this.elements.searchInput.value;
          this.searchKnowledgeBase(query); // Use non-debounced for explicit click
        });
      }

      // Search Input Keyup (for Enter key, using debounced search)
      if (this.elements.searchInput) {
        this.elements.searchInput.addEventListener("keyup", (e) => {
          if (e.key === "Enter") {
            const query = e.target.value;
            this.searchKnowledgeBase(query); // Trigger search immediately on Enter
            // Alternatively, use debounced: this.debouncedSearch(query);
          }
          // Optional: Trigger debounced search on input change after delay
          // const query = e.target.value;
          // if (query.trim().length >= 2) {
          //     this.debouncedSearch(query);
          // } else {
          //      // Clear results if query is too short
          //      if(this.elements.resultsContainer) this.elements.resultsContainer.innerHTML = '';
          //      this._showNoResults();
          // }
        });
      }

      // Reprocess Files Button Click
      if (this.elements.reprocessButton) {
        // Add focus styles dynamically
        this.elements.reprocessButton.classList.add(
          'focus:outline-none', 'focus:ring-2', 'focus:ring-indigo-500', 'focus:ring-opacity-50',
          'transition-colors', 'duration-150'
        );
        this.elements.reprocessButton.addEventListener("click", () => this.reprocessFiles());
      }

      // KB Settings Button (if one exists separately from setup)
      const kbSettingsBtn = document.getElementById("knowledgeBaseSettingsBtn");
      if (kbSettingsBtn) {
        kbSettingsBtn.addEventListener("click", () => this._showKnowledgeBaseModal());
      }

      // KB Enable/Disable Toggle Change
      if (this.elements.kbToggle) {
        this.elements.kbToggle.addEventListener("change", (e) => {
          this.toggleKnowledgeBase(e.target.checked);
        });
      }

      // Setup KB Button Click (in inactive section)
      if (this.elements.setupButton) {
        // Apply consistent styling
        this.elements.setupButton.className =
          'px-4 py-2 bg-green-600 text-white rounded-md ' +
          'hover:bg-green-700 transition-colors duration-200 ' +
          'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 ' +
          'text-sm font-medium shadow-sm';
        this.elements.setupButton.addEventListener("click", () => this._showKnowledgeBaseModal());
      }

      // KB Settings Form Submission
      if (this.elements.settingsForm) {
        this.elements.settingsForm.addEventListener("submit", (e) => this._handleKnowledgeBaseFormSubmit(e));
      }

      // KB Settings Form Cancel Button
      if (this.elements.cancelSettingsBtn) {
        this.elements.cancelSettingsBtn.addEventListener("click", () => this._hideKnowledgeBaseModal());
      }

      // Close modal if clicking outside the modal content (optional)
      if (this.elements.settingsModal) {
        this.elements.settingsModal.addEventListener('click', (event) => {
          // Check if the click is directly on the modal background (not its children)
          if (event.target === this.elements.settingsModal) {
            this._hideKnowledgeBaseModal();
          }
        });
      }
      if (this.elements.resultModal) {
        this.elements.resultModal.addEventListener('click', (event) => {
          if (event.target === this.elements.resultModal) {
            this._hideResultDetailModal();
          }
        });
        // Add listener for close button inside result modal if it exists
        const closeResultBtn = this.elements.resultModal.querySelector('.close-modal-btn'); // Example selector
        if (closeResultBtn) closeResultBtn.addEventListener('click', () => this._hideResultDetailModal());
      }
    }

    /**
     * Debounce function execution.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - The debounce delay in milliseconds.
     * @returns {Function} The debounced function.
     * @private
     */
    _debounce(func, delay) {
      let timeout;
      return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
      };
    }

    /**
     * Show the knowledge base settings modal.
     * Pre-populates form if editing existing KB.
     * @private
     */
    _showKnowledgeBaseModal() {
      console.log('[DEBUG] Opening knowledge base settings modal');
      if (!this.elements.settingsForm) {
        console.error('KB Settings Form element not found.');
        if (window.showNotification) {
          window.showNotification('Could not open settings modal.', 'error');
        }
        return;
      }

      // Reset form fields before showing
      this.elements.settingsForm.reset();
      this._updateModelSelection(null); // Reset model selection dropdown

      // Pre-populate if editing existing KB
      if (this.state.knowledgeBase) {
        const kb = this.state.knowledgeBase;
        const nameInput = this.elements.settingsForm.elements['name'];
        const descInput = this.elements.settingsForm.elements['description'];

        if (nameInput) nameInput.value = kb.name || '';
        if (descInput) descInput.value = kb.description || '';
        this._updateModelSelection(kb.embedding_model); // Set current model
      }

      // Use ModalManager if available, otherwise fallback to direct DOM manipulation
      if (window.modalManager && typeof window.modalManager.show === 'function') {
        window.modalManager.show('knowledge', {
          updateContent: (modalElement) => {
            // Ensure project ID is associated with the form if possible
            const projectId = this._getCurrentProjectId();
            if (projectId) {
              this.elements.settingsForm.dataset.projectId = projectId;
              console.log(`[DEBUG] Set project ID ${projectId} on KB form`);
            } else {
              console.warn("Project ID not available when opening KB modal.");
            }
          }
        });
      } else {
        console.warn('ModalManager not available, using direct DOM manipulation');
        if (this.elements.settingsModal) {
          this.elements.settingsModal.classList.remove('hidden');

          // Ensure project ID is set
          const projectId = this._getCurrentProjectId();
          if (projectId && this.elements.settingsForm) {
            this.elements.settingsForm.dataset.projectId = projectId;
          }
        }
      }
    }

    /**
     * Handle the submission of the knowledge base settings form.
     * Creates or updates the knowledge base via API.
     * @param {Event} e - The form submit event.
     * @private
     */
    async _handleKnowledgeBaseFormSubmit(e) {
      e.preventDefault();
      const form = e.target;
      if (!form) return;

      // Verify authentication before proceeding
      try {
        const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        if (!isAuthenticated) {
          console.warn('KB Form Submit failed: User not authenticated');
          if (window.showNotification) {
            window.showNotification("Please login to save knowledge base settings", "error");
          }
          return;
        }
      } catch (authError) {
        window.auth.handleAuthError(authError, "knowledge base form submission");
        return;
      }

      const formData = new FormData(form);
      const projectId = this._getCurrentProjectId(); // Use helper to get ID

      if (!projectId) {
        if (window.showNotification) {
          window.showNotification("Please select a project first to save settings.", "error");
        }
        return; // Stop if no project context
      }

      // Construct payload matching backend Pydantic model
      const payload = {
        name: formData.get('name'),
        description: formData.get('description') || null, // Ensure null if empty
        embedding_model: formData.get('embedding_model')
      };

      // Add validation (e.g., name is required)
      if (!payload.name || payload.name.trim() === '') {
        if (window.showNotification) {
          window.showNotification("Knowledge base name is required.", "warning");
        }
        const nameInput = form.elements['name'];
        if (nameInput) nameInput.focus();
        return;
      }
      if (!payload.embedding_model) {
        if (window.showNotification) {
          window.showNotification("Please select an embedding model.", "warning");
        }
        if (this.elements.modelSelect) this.elements.modelSelect.focus();
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      let originalButtonText = '';
      if (submitButton) {
        originalButtonText = submitButton.innerHTML;
        submitButton.disabled = true;
        submitButton.innerHTML = `<span class="spinner mr-2"></span> Saving...`;
      }

      try {
        if (window.showNotification) {
          window.showNotification("Saving knowledge base settings...", "info");
        }

        // Determine if creating new or updating existing (though API might handle this via POST/PUT logic)
        // Using POST to a project-specific endpoint often implies creation or idempotent update
        const token = await window.auth.getAuthToken();
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-bases`, // Endpoint for creating/setting KB for a project
          "POST",
          payload,
          token
        );

        console.log('[DEBUG] Knowledge base setup/update response:', response);

        if (response.data?.id) {
          if (window.showNotification) {
            window.showNotification("Knowledge base settings saved successfully", "success");
          }
          this._hideKnowledgeBaseModal(); // Close modal on success

          // IMPORTANT: Refresh the project details to get the latest KB info
          if (window.projectManager?.loadProjectDetails) {
            const updatedProject = await window.projectManager.loadProjectDetails(projectId);
            this.renderKnowledgeBaseInfo(updatedProject?.knowledge_base); // Re-render with fresh data
          } else {
            // Fallback: update internal state and re-render partially
            this.renderKnowledgeBaseInfo(response.data); // Use response data if project manager missing
          }
        } else {
          // Handle cases where response might be successful (2xx) but missing expected data
          console.error('[ERROR] Knowledge base response missing expected data (e.g., id):', response);
          throw new Error('Invalid response format from server.');
        }

      } catch (error) {
        console.error("Knowledge base setup/update failed:", error);
        let errorMessage = "Failed to save knowledge base settings";

        // Provide more specific error messages based on status code or content
        if (error.response?.status === 409) { // Conflict - e.g., KB already exists if endpoint doesn't support update
          errorMessage = "This project already has a knowledge base configured.";
          // Optionally, refresh to show the existing one
          if (window.projectManager?.loadProjectDetails) window.projectManager.loadProjectDetails(projectId);
        } else if (error.response?.status === 422) { // Validation error
          errorMessage = `Validation Error: ${error.response?.data?.detail?.[0]?.msg || 'Invalid data'}`;
        } else if (error.response?.data?.detail) { // Use detail from backend if available
          errorMessage = `Error: ${error.response.data.detail}`;
        } else if (error.message) {
          errorMessage = `Error: ${error.message}`;
        }

        if (window.showNotification) {
          window.showNotification(errorMessage, "error");
        }
      } finally {
        // Restore submit button
        if (submitButton) {
          submitButton.innerHTML = originalButtonText;
          submitButton.disabled = false;
        }
      }
    }


    /**
     * Hide the knowledge base settings modal.
     * @private
     */
    _hideKnowledgeBaseModal() {
      // First try using the ModalManager
      if (window.modalManager && typeof window.modalManager.hide === 'function') {
        window.modalManager.hide('knowledge');
      }
      // Fallback to direct DOM manipulation
      else if (this.elements.settingsModal) {
        this.elements.settingsModal.classList.add('hidden');
      }
    }

    /**
     * Load and potentially display knowledge base health information.
     * @param {string} kbId - The ID of the knowledge base.
     * @returns {Promise<Object|null>} The health data or null on error.
     * @private
     */
    async _loadKnowledgeBaseHealth(kbId) {
      if (!kbId) {
        console.warn("KB Health check skipped: No KB ID provided.");
        return null;
      }

      // Validate KB ID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(kbId)) {
        this._showStatusAlert("Invalid knowledge base ID format", "error");
        return null;
      }

      // Check auth state first - no point retrying if not authenticated
      try {
        const isAuthenticated = await window.auth.isAuthenticated();
        if (!isAuthenticated) {
          this._showStatusAlert("Please login to check knowledge base health", "warning");
          return null;
        }
      } catch (authError) {
        console.error("Auth check failed:", authError);
        this._showStatusAlert("Authentication check failed", "error");
        return null;
      }

      const MAX_RETRIES = 3;
      const BASE_DELAY = 1000; // 1 second
      const TIMEOUT_MS = 10000; // 10 seconds
      let lastError = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // No need to pass the token as apiRequest uses credentials: 'include'
          const response = await window.apiRequest(
            `/api/knowledge-bases/${kbId}/health`,
            "GET",
            null, // No data for GET request
            attempt - 1, // retry count
            TIMEOUT_MS // explicit 10 second timeout
          );
          
          if (!response?.data) {
            throw new Error("Invalid health check response");
          }

          const health = response.data;
          console.log("[DEBUG] KB Health:", health);

          // Update UI elements
          const healthStatusEl = document.getElementById('kbHealthStatus');
          if (healthStatusEl) {
            const statusText = health.status === 'active' ? 'Active' :
                             health.status === 'inactive' ? 'Inactive' : 'Unknown';
            healthStatusEl.textContent = `Status: ${statusText}`;
            healthStatusEl.className = health.status === 'active' ? 'text-green-600' : 'text-yellow-600';
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
          console.error(`KB Health check attempt ${attempt} failed:`, err);
          
          // Skip retries for auth errors - they won't succeed without login
          if (err?.message?.includes('auth') || err?.message?.includes('authenticat')) {
            break;
          }
          
          if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // All retries failed - show specific error
      console.error("KB health check failed:", lastError);
      let errorMsg = "Could not verify knowledge base health";
      let errorType = "error";
      
      if (!lastError) {
        errorMsg = "Unknown error checking knowledge base health";
      } else if (lastError?.message?.includes('auth') || lastError?.message?.includes('authenticat')) {
        errorMsg = "Please login to check knowledge base health";
        errorType = "warning";
      } else if (lastError?.response?.status === 404) {
        errorMsg = "Knowledge base not found - it may have been deleted";
      } else if (lastError?.message?.includes('timeout')) {
        errorMsg = "Health check timed out - vector DB may be unavailable";
      } else if (lastError?.response?.data?.vector_db?.error) {
        errorMsg = `Vector DB error: ${lastError.response.data.vector_db.error}`;
      }
      
      this._showStatusAlert(errorMsg, errorType);
      return null;
    }

    /**
     * Show loading state UI for knowledge base search.
     * @private
     */
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

    /**
     * Show the 'no results found' message in the search results area.
     * @private
     */
    _showNoResults() {
      const { resultsSection, noResultsSection, resultsContainer } = this.elements;

      if (resultsContainer) resultsContainer.innerHTML = ""; // Clear any previous results/loading
      if (resultsSection) resultsSection.classList.add("hidden");
      if (noResultsSection) noResultsSection.classList.remove("hidden");
    }

    /**
     * Hide the search loading state UI.
     * Called when search completes or fails.
     * @private
     */
    _hideSearchLoading() {
      // Check if still searching before removing (might have already been replaced by results/no results)
      if (this.state.isSearching) return; // Should be set to false before calling this

      const { resultsContainer } = this.elements;
      if (resultsContainer) {
        const loadingEl = resultsContainer.querySelector('.flex.justify-center.items-center');
        if (loadingEl && loadingEl.textContent.includes('Searching')) {
          // Only remove if it's the loading indicator
          // resultsContainer.innerHTML = ''; // Or remove just the element: loadingEl.remove();
        }
      }
      // Note: _renderSearchResults or _showNoResults usually handles clearing the container
    }


    /**
     * Update the embedding model selection dropdown.
     * Disables options that don't match existing vector dimensions if a KB exists.
     * @param {string|null} selectedModel - The model currently selected or null.
     * @private
     */
    _updateModelSelection(selectedModel) {
      const modelSelect = this.elements.modelSelect;
      if (!modelSelect) return;

      // Clear existing options and error messages
      modelSelect.innerHTML = '';
      const parent = modelSelect.parentElement;
      const existingError = parent ? parent.querySelector('.model-error') : null;
      if (existingError) existingError.remove();


      // Define available models and their properties
      const models = [
        { value: "all-MiniLM-L6-v2", text: "Local: all-MiniLM-L6-v2 (384d, Fast, Default)", dim: 384 },
        { value: "text-embedding-3-small", text: "OpenAI: text-embedding-3-small (1536d, Recommended)", dim: 1536 },
        { value: "text-embedding-3-large", text: "OpenAI: text-embedding-3-large (3072d, Largest)", dim: 3072 },
        { value: "embed-english-v3.0", text: "Cohere: embed-english-v3.0 (1024d, English)", dim: 1024 }
        // Add other models as needed
      ];

      const existingDim = this.state.knowledgeBase?.embedding_dimension;
      const hasExistingVectors = this.state.knowledgeBase?.stats?.chunk_count > 0;


      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.text;
        option.selected = (model.value === selectedModel);

        // Disable if dimensions mismatch AND vectors already exist
        if (hasExistingVectors && existingDim && existingDim !== model.dim) {
          option.disabled = true;
          option.classList.add('disabled-option');
          option.title = `Dimension mismatch: Existing vectors are ${existingDim}d. Requires reprocessing all files.`;
        }

        modelSelect.appendChild(option);
      });

      // Add validation message if a disabled option is selected (e.g., upon loading existing KB)
      this._validateSelectedModelDimensions();

      // Add change listener to re-validate on selection change
      modelSelect.removeEventListener('change', this._validateSelectedModelDimensions.bind(this)); // Prevent duplicates
      modelSelect.addEventListener('change', this._validateSelectedModelDimensions.bind(this));
    }


    /**
     * Check if the currently selected model in the dropdown is disabled due to dimension mismatch
     * and display a warning if necessary.
     * @private
     */
    _validateSelectedModelDimensions() {
      const modelSelect = this.elements.modelSelect;
      if (!modelSelect || !modelSelect.parentElement) return;

      const parent = modelSelect.parentElement;
      let warningDiv = parent.querySelector('.model-error');

      const selectedOption = modelSelect.options[modelSelect.selectedIndex];

      if (selectedOption && selectedOption.disabled) {
        if (!warningDiv) {
          warningDiv = document.createElement('div');
          warningDiv.className = 'model-error text-red-600 text-xs mt-1'; // Adjusted style
          parent.appendChild(warningDiv); // Append warning message div
        }
        warningDiv.textContent = "Changing dimensions requires reprocessing all files!";
        warningDiv.classList.remove('hidden');
      } else {
        // Hide or remove warning if the selected option is valid
        if (warningDiv) {
          warningDiv.classList.add('hidden');
          // Optionally remove it: warningDiv.remove();
        }
      }
    }


    /**
     * Update the knowledge base statistics display in the UI.
     * @param {Object} stats - The statistics object (e.g., { file_count, total_size, chunk_count }).
     * @private
     */
    _updateKnowledgeBaseStats(stats) {
      const { fileCountDisplay, fileSizeDisplay } = this.elements;
      const utils = window.uiUtilsInstance; // Assuming utils instance is available globally

      if (!stats) {
        // Reset stats if no data provided
        if (fileCountDisplay) fileCountDisplay.textContent = '0';
        if (fileSizeDisplay) fileSizeDisplay.textContent = '0 Bytes';
        return;
      }


      if (fileCountDisplay) {
        fileCountDisplay.textContent = stats.file_count ?? 0; // Use nullish coalescing for default
        fileCountDisplay.title = `Total files associated with the knowledge base: ${stats.file_count ?? 0}`;
      }

      if (fileSizeDisplay && utils?.formatBytes) {
        fileSizeDisplay.textContent = utils.formatBytes(stats.total_size || 0);
        fileSizeDisplay.title = `Total size of all files: ${stats.total_size || 0} bytes`;
      } else if (fileSizeDisplay) {
        fileSizeDisplay.textContent = `${stats.total_size || 0} Bytes`; // Fallback if formatter missing
      }

      // Optionally display chunk count or other stats if elements exist
      const chunkCountEl = document.getElementById('knowledgeChunkCount'); // Example element
      if (chunkCountEl && stats.chunk_count !== undefined) {
        chunkCountEl.textContent = stats.chunk_count;
        chunkCountEl.title = `Total processed text chunks (vectors): ${stats.chunk_count}`;
      }

    }

    /**
     * Update the status indicator text and optionally a badge.
     * @param {boolean} isActive - Whether the knowledge base is currently active.
     * @private
     */
    _updateStatusIndicator(isActive) {
      const { statusText, statusBadge } = this.elements;

      if (statusText) {
        statusText.textContent = isActive ? "Active" : "Inactive";
        statusText.className = isActive
          ? "text-green-600 font-medium"
          : "text-red-600 font-medium";
        statusText.title = isActive
          ? "Knowledge base is enabled and available for use."
          : "Knowledge base is disabled and will not be used.";
      }

      if (statusBadge) {
        statusBadge.className = isActive
          ? "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"
          : "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800";
        statusBadge.innerHTML = isActive
          ? '<span class="h-2 w-2 rounded-full bg-green-400 mr-1.5 flex-shrink-0"></span>Active'
          : '<span class="h-2 w-2 rounded-full bg-red-400 mr-1.5 flex-shrink-0"></span>Inactive';
        statusBadge.title = statusText.title; // Sync titles
      }
    }

    /**
     * Enable or disable upload and reprocess buttons based on KB state.
     * @param {boolean} hasKnowledgeBase - Whether a KB exists for the project.
     * @param {boolean} isActive - Whether the existing KB is active.
     * @private
     */
    _updateUploadButtonsState(hasKnowledgeBase, isActive) {
      // Select all buttons that require an active KB
      const uploadButtons = document.querySelectorAll('[data-requires-kb="true"]');
      const fileCount = parseInt(this.elements.fileCountDisplay?.textContent || '0', 10);

      // Update Upload Buttons
      uploadButtons.forEach(button => {
        const isDisabled = !hasKnowledgeBase || !isActive;
        button.disabled = isDisabled;
        button.classList.toggle('opacity-50', isDisabled);
        button.classList.toggle('cursor-not-allowed', isDisabled);

        if (isDisabled) {
          button.title = !hasKnowledgeBase
            ? "Setup Knowledge Base first to enable uploads."
            : "Knowledge Base must be active to upload files.";
        } else {
          button.title = fileCount > 0 ? "Upload more files" : "Upload first file"; // Dynamic title
        }
      });

      // Update Reprocess Button state
      const reprocessBtn = this.elements.reprocessButton;
      if (reprocessBtn) {
        // Disable if no KB, inactive KB, or no files to process
        const isReprocessDisabled = !hasKnowledgeBase || !isActive || fileCount === 0;
        reprocessBtn.disabled = isReprocessDisabled;
        reprocessBtn.classList.toggle('opacity-50', isReprocessDisabled);
        reprocessBtn.classList.toggle('cursor-not-allowed', isReprocessDisabled);

        if (!hasKnowledgeBase) {
          reprocessBtn.title = "Setup Knowledge Base first.";
        } else if (!isActive) {
          reprocessBtn.title = "Knowledge Base must be active to reprocess files.";
        } else if (fileCount === 0) {
          reprocessBtn.title = "No files to reprocess. Upload files first.";
        } else {
          reprocessBtn.title = "Reprocess all files for search index updates.";
        }
      }
    }

    /**
     * Render the search results in the results container.
     * @param {Array<Object>} results - Array of search result objects from the API.
     * Each object should have { text, score, metadata, file_info (optional) }.
     * @private
     */
    _renderSearchResults(results) {
      const { resultsContainer, resultsSection, noResultsSection } = this.elements;
      if (!resultsContainer) return;

      // Validate results is an array before processing
      if (!Array.isArray(results)) {
        console.warn("RenderSearchResults called with non-array:", results);
        results = []; // Treat as empty if not an array
      }

      resultsContainer.innerHTML = ""; // Clear previous results or loading

      if (results.length === 0) {
        this._showNoResults();
        return;
      }

      // Show results section, hide 'no results' message
      if (resultsSection) resultsSection.classList.remove("hidden");
      if (noResultsSection) noResultsSection.classList.add("hidden");

      results.forEach((result, index) => {
        // Basic validation of result structure
        if (!result || typeof result.text !== 'string' || typeof result.score !== 'number') {
          console.warn(`Skipping invalid search result at index ${index}:`, result);
          return;
        }

        const metadata = result.metadata || {};
        const fileInfo = result.file_info || {}; // Optional file info from backend
        const score = Math.round((result.score || 0) * 100); // Score as percentage

        try {
          const item = this._createSearchResultItem(result.text, score, metadata, fileInfo);
          // Add click listener to show details in modal
          item.addEventListener('click', (e) => {
            // Prevent triggering if a link/button inside the item was clicked
            if (e.target.closest('a, button')) return;
            this._showResultDetail(result);
          });
          resultsContainer.appendChild(item);
        } catch (error) {
          console.error(`Error creating search result item for result ${index}:`, error, result);
          // Optionally append an error placeholder item
          const errorItem = document.createElement('div');
          errorItem.className = 'p-4 mb-3 text-red-600 border border-red-300 rounded';
          errorItem.textContent = 'Error displaying this result.';
          resultsContainer.appendChild(errorItem);
        }

      });
    }

    /**
     * Create a DOM element for a single search result item.
     * @param {string} content - The text content/snippet of the result.
     * @param {number} score - The relevance score (0-100).
     * @param {Object} metadata - Metadata associated with the chunk (e.g., file_name, chunk_index).
     * @param {Object} fileInfo - Optional additional file info (e.g., file_type, created_at).
     * @returns {HTMLElement} The created DOM element for the result item.
     * @private
     */
    _createSearchResultItem(content, score, metadata, fileInfo) {
      const utils = window.uiUtilsInstance; // Get utils instance
      if (!utils?.createElement || !utils?.fileIcon || !utils?.formatDate) {
        console.error("uiUtilsInstance or required methods not found. Cannot create result item.");
        // Fallback: return a simple div with text
        const fallbackItem = document.createElement('div');
        fallbackItem.textContent = `${this._formatSourceName(metadata.file_name)} (${score}%): ${content.substring(0, 100)}...`;
        fallbackItem.className = 'p-4 border rounded mb-2';
        return fallbackItem;
      }


      const filename = fileInfo?.filename || metadata?.file_name || "Unknown Source";
      const fileType = fileInfo?.file_type || metadata?.file_type || "unknown";
      const createdAt = metadata?.processed_at || fileInfo?.created_at; // Prefer processed_at if available
      const chunkIndex = metadata?.chunk_index ?? 'N/A'; // Chunk index if available
      const tokenCount = metadata?.token_count ?? fileInfo?.token_count ?? 'N/A';

      const item = utils.createElement("div", {
        className: "content-item bg-white dark:bg-gray-800 p-3 sm:p-4 rounded-lg shadow-sm mb-3 " +
          "border border-gray-200 dark:border-gray-700 cursor-pointer " +
          "hover:shadow-md hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-150",
        role: "button", // Accessibility
        tabIndex: "0"  // Make it focusable
      });

      // Header: File Icon, Name, Date/Chunk, Score Badge
      const header = utils.createElement("div", {
        className: "flex justify-between items-start gap-2 mb-2" // Use gap for spacing
      });

      // Left side of header: Icon and Text details
      const sourceInfo = utils.createElement("div", { className: "flex items-center gap-2 min-w-0" }); // min-w-0 for truncation

      sourceInfo.appendChild(utils.createElement("span", {
        className: "text-xl text-gray-500 dark:text-gray-400 flex-shrink-0", // Icon size
        innerHTML: utils.fileIcon(fileType) // Use innerHTML if icon is SVG
      }));

      const sourceDetails = utils.createElement("div", { className: "flex flex-col min-w-0" }); // min-w-0 for truncation
      sourceDetails.appendChild(utils.createElement("div", {
        className: "font-medium text-sm text-gray-800 dark:text-gray-100 truncate",
        textContent: this._formatSourceName(filename), // Use formatted name
        title: filename // Full name on hover
      }));
      sourceDetails.appendChild(utils.createElement("div", {
        className: "text-xs text-gray-500 dark:text-gray-400 truncate",
        textContent: `Chunk ${chunkIndex}${createdAt ? ' • ' + utils.formatDate(createdAt) : ''}`
      }));

      sourceInfo.appendChild(sourceDetails);
      header.appendChild(sourceInfo);

      // Right side of header: Score Badge
      const scoreBadge = utils.createElement("div", {
        className: `text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${score >= 80 ? "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100" :
          score >= 60 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-800 dark:text-yellow-100" :
            "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          }`,
        textContent: `${score}%` // Just the percentage for brevity
      });
      scoreBadge.title = `Relevance score: ${score}%`;
      header.appendChild(scoreBadge);

      item.appendChild(header);

      // Content Snippet
      const contentDiv = utils.createElement("p", { // Use <p> for semantics
        className: "text-sm text-gray-600 dark:text-gray-300 line-clamp-3 mb-2", // line-clamp for truncation
        textContent: content || "No content preview available."
      });
      item.appendChild(contentDiv);

      // Footer Metadata (Optional - keep it concise)
      const footer = this._createMetaRow(
        `Tokens: ${tokenCount}`,
        // Add other relevant concise metadata if needed, e.g., file size
        // `Size: ${fileInfo?.size ? utils.formatBytes(fileInfo.size) : 'N/A'}`
      );
      if (footer.children.length > 0) { // Only add footer if there's content
        item.appendChild(footer);
      }

      // Add ARIA label for accessibility
      item.setAttribute('aria-label', `Result from ${filename}, ${score}% match. Content snippet: ${content.substring(0, 100)}...`);


      return item;
    }


    /**
     * Create a metadata row element for search results or other displays.
     * @param {...string} items - Text items to display in the row.
     * @returns {HTMLElement} The created metadata row div.
     * @private
     */
    _createMetaRow(...items) {
      const utils = window.uiUtilsInstance;
      if (!utils?.createElement) return document.createElement('div'); // Fallback


      const row = utils.createElement("div", {
        className: "flex justify-start items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-700" // Subtle separator
      });

      items.forEach(text => {
        if (text) { // Only add if text is not empty/null
          row.appendChild(utils.createElement("span", { textContent: text }));
        }
      });

      return row; // Return even if empty, parent function decides whether to append it
    }


    /**
     * Show the modal displaying details of a selected search result.
     * @param {Object} result - The full search result object.
     * @private
     */
    _showResultDetail(result) {
      const { resultTitle, resultSource, resultScore, resultContent, useInChatBtn } = this.elements;

      if (!resultTitle || !resultSource || !resultScore || !resultContent) {
        console.error('Knowledge result modal elements not found!');
        if (window.showNotification) {
          window.showNotification("Could not display result details.", "error");
        }
        return;
      }

      const metadata = result.metadata || {};
      const fileInfo = result.file_info || {};
      const scorePercentage = Math.round((result.score || 0) * 100);
      const filename = fileInfo.filename || metadata.file_name || "Unknown Source";

      // Populate modal content
  resultTitle.textContent = `Detail: ${this._formatSourceName(filename)}`;
  resultTitle.title = filename; // Full name in title
  resultSource.textContent = filename;
  resultScore.textContent = `${scorePercentage}%`;
      // Use pre-wrap to preserve formatting/line breaks in the text content
      resultContent.textContent = result.text || 'No content available.';
      resultContent.style.whiteSpace = 'pre-wrap';

      // Handle "Use in Chat" button
      if (useInChatBtn) {
        // Remove previous listener to avoid duplicates
        const newBtn = useInChatBtn.cloneNode(true); // Clone to remove listeners
        useInChatBtn.parentNode.replaceChild(newBtn, useInChatBtn);
        this.elements.useInChatBtn = newBtn; // Update element reference

        newBtn.onclick = () => {
          this._useInConversation(result);
          this._hideResultDetailModal(); // Hide modal after clicking
        };
      }

      // Show the modal using ModalManager if available
      if (window.modalManager && typeof window.modalManager.show === 'function') {
        window.modalManager.show('knowledgeResult', {
          onShow: (modal) => {
            // Focus the modal for accessibility
            modal.focus();
          }
        });
      } else {
        // Fallback to direct DOM manipulation
        if (this.elements.resultModal) {
          this.elements.resultModal.classList.remove('hidden');
        }
      }
    }

    /**
    * Hide the knowledge result detail modal.
    * @private
    */
    _hideResultDetailModal() {
      if (window.modalManager && typeof window.modalManager.hide === 'function') {
        window.modalManager.hide('knowledgeResult');
      } else if (this.elements.resultModal) {
        // Fallback to direct DOM manipulation
        this.elements.resultModal.classList.add('hidden');
      }
    }


    /**
     * Insert the content of a search result into the main chat input.
     * @param {Object} result - The search result object.
     * @private
     */
    _useInConversation(result) {
      // Try multiple common IDs for the chat input
      const chatInput = document.getElementById('projectChatInput') || document.getElementById('chatInput') || document.querySelector('textarea[placeholder*="Send a message"]');

      if (!chatInput) {
        if (window.showNotification) {
          window.showNotification("Chat input area not found.", "error");
        }
        console.error("Could not find chat input element.");
        return;
      }

      const filename = result.metadata?.file_name || 'the knowledge base';
      // Construct a formatted reference string
      const referenceText = `Referring to content from "${this._formatSourceName(filename)}":\n\n> ${result.text.trim()}\n\nBased on this, `; // Added prompt start


      // Append or replace existing content (choose one)
      // Option 1: Replace existing content
      // chatInput.value = referenceText;

      // Option 2: Append to existing content (add a newline if needed)
      const currentContent = chatInput.value.trim();
      chatInput.value = currentContent ? `${currentContent}\n\n${referenceText}` : referenceText;


      // Focus the input and potentially trigger an input event for frameworks like React/Vue
      chatInput.focus();
      chatInput.dispatchEvent(new Event('input', { bubbles: true })); // Trigger input event

      if (window.showNotification) {
        window.showNotification("Result content added to chat input.", "success");
      }
    }

  } // End of KnowledgeBaseComponent class
  // End of IIFE

  // Make the class available globally
  window.KnowledgeBaseComponent = KnowledgeBaseComponent;

})(); // End of IIFE
      // Reprocess Files Button Click
