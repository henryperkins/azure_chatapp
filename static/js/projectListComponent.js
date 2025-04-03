/**
 * projectListComponent.js
 * -----------------------
 * Component for displaying and managing the project list view
 */

(function() {
  /**
   * Project List Component - Handles the project list view
   */
  class ProjectListComponent {
    /**
     * Initialize the project list component
     * @param {Object} options - Configuration options
     */
    constructor(options) {
      if (!options || !options.elementId) {
        console.error('ProjectListComponent: Missing required options');
        throw new Error('ProjectListComponent requires elementId option');
      }
      
      console.log('[DEBUG] Initializing ProjectListComponent');
      
      /* ===========================
         STATE MANAGEMENT
         =========================== */
      this.state = {
        projects: [],
        filter: 'all',
        loading: false
      };
      
      /* ===========================
         OPTIONS & ELEMENT REFERENCES
         =========================== */
      this.elementId = options.elementId;
      this.element = document.getElementById(this.elementId);
      this.onViewProject = options.onViewProject;
      this.messageEl = document.getElementById("noProjectsMessage");
      
      // Create fallback container if needed
      if (!this.element) {
        console.error(`ProjectListComponent: Element with ID '${this.elementId}' not found - creating fallback`);
        this.element = document.createElement('div');
        this.element.id = this.elementId;
        this.element.className = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 h-full overflow-y-auto';
        const listView = document.getElementById('projectListView');
        if (listView) {
          listView.appendChild(this.element);
        }
      }
      
      this._bindFilterEvents();
      this._bindCreateProjectButton(); // Add this line
    }

    /* ===========================
       PUBLIC METHODS
       =========================== */
    
    /**
     * Show the project list view
     */
    show() {
      const listView = document.getElementById('projectListView');
      const detailsView = document.getElementById('projectDetailsView');
      
      if (listView) {
        listView.classList.remove('hidden');
        listView.classList.add('flex-1', 'min-h-0');
      }
      if (detailsView) detailsView.classList.add('hidden');
      if (this.element) this.element.style.display = 'grid';
    }

    /**
     * Hide the project list view
     */
    hide() {
      const element = document.getElementById("projectListView");
      if (element) {
        window.uiUtilsInstance.toggleVisibility(element, false);
      } else {
        console.error('projectListView element not found');
      }
    }

    /**
     * Render the list of projects
     * @param {Array|Object} eventOrProjects - Projects array or event containing projects
     */
    renderProjects(eventOrProjects) {
      try {
        if (!this.element) {
          console.error('ProjectListComponent: Missing container element');
          return;
        }
        
        // Extract projects from various input formats
        const projects = this._extractProjects(eventOrProjects);
        this.state.projects = projects;

        // Get current filter from state
        const currentFilter = this.state.filter || 'all';
        
        // Clear existing content
        this.element.innerHTML = "";

        // Handle error case
        if (projects.error) {
          this._renderErrorState();
          return;
        }

        // Filter projects based on current filter
        let filteredProjects = projects;
        if (currentFilter === 'pinned') {
          filteredProjects = projects.filter(p => p.pinned);
        } else if (currentFilter === 'archived') {
          filteredProjects = projects.filter(p => p.archived);
        }

        // Handle empty state
        if (filteredProjects.length === 0) {
          const emptyMsg = document.createElement('div');
          emptyMsg.className = 'text-gray-500 dark:text-gray-400 text-center py-8 col-span-3';
          emptyMsg.textContent = currentFilter === 'all'
            ? 'No projects available'
            : `No ${currentFilter} projects found`;
          this.element.appendChild(emptyMsg);
          if (this.messageEl) this.messageEl.classList.add("hidden");
          return;
        }

        // Hide "no projects" message if we have projects
        if (this.messageEl) this.messageEl.classList.add("hidden");
        
        // Render each filtered project
        filteredProjects.forEach(project => {
          try {
            const card = this._createProjectCard(project);
            if (card) {
              this.element.appendChild(card);
            }
          } catch (err) {
            console.error('Error rendering project card:', err, project);
          }
        });
      } catch (err) {
        console.error('Error in renderProjects:', err);
        this._renderErrorState("Error displaying projects");
      }
    }

    /* ===========================
       PRIVATE METHODS
       =========================== */
    
    /**
     * Extract projects array from various input formats
     * @private
     * @param {Array|Object} eventOrProjects - Projects array or event with projects
     * @returns {Array} Array of projects
     */
    _extractProjects(eventOrProjects) {
      let projects = [];
      
      const extractProjects = (obj) => {
        const rawProjects = obj?.data?.projects || obj?.projects || [];
        return rawProjects.map(p => p.to_dict ? p.to_dict() : p);
      };

      if (Array.isArray(eventOrProjects)) {
        projects = eventOrProjects.map(p => p.to_dict ? p.to_dict() : p);
      } else if (eventOrProjects instanceof Event) {
        projects = extractProjects(eventOrProjects.detail);
      } else {
        projects = extractProjects(eventOrProjects);
      }
      
      console.log('[PROJECTS] Raw projects data:', projects);
      return projects;
    }
    
    /**
     * Render error state when projects fail to load
     * @private
     * @param {string} message - Error message to display
     */
    _renderErrorState(message = 'Error loading projects') {
      const errorMsg = document.createElement('div');
      errorMsg.className = 'text-red-500 text-center py-8 col-span-3';
      errorMsg.textContent = message;
      this.element.appendChild(errorMsg);
      if (this.messageEl) this.messageEl.classList.add("hidden");
    }
    
    /**
     * Render empty state when no projects are available
     * @private
     */
    _renderEmptyState() {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'text-gray-500 dark:text-gray-400 text-center py-8 col-span-3 transition-colors duration-200';
      emptyMsg.textContent = 'No projects available';
      this.element.appendChild(emptyMsg);
      if (this.messageEl) this.messageEl.classList.add("hidden");
    }

    /**
     * Create a project card element
     * @private
     * @param {Object} project - Project data
     * @returns {HTMLElement} Project card element
     */
    _createProjectCard(project) {
      console.log('[DEBUG] Creating card for project:', project);
      if (!project) {
        console.error('[DEBUG] Project is null/undefined');
        return null;
      }
      if (!project.id) {
        console.error('[DEBUG] Project missing required id field:', project);
        return null;
      }
      
      // Get project stats
      const usage = project.token_usage || 0;
      const maxTokens = project.max_tokens || 0;
      const usagePct = maxTokens > 0 ? Math.min(100, (usage / maxTokens) * 100).toFixed(1) : 0;
      
      // Create card
      let card;
      if (window.uiUtilsInstance && window.uiUtilsInstance.createElement) {
        card = window.uiUtilsInstance.createElement("div", {
          className: `project-card flex flex-col ${project.pinned ? "project-card-pinned" : "project-card-unpinned"} ${project.archived ? "project-card-archived" : ""}`
        });
      } else {
        // Fallback implementation
        card = document.createElement('div');
        card.className = `project-card flex flex-col ${project.pinned ? "project-card-pinned" : "project-card-unpinned"} ${project.archived ? "project-card-archived" : ""}`;
      }
      
      // Add card header
      this._addCardHeader(card, project);
      
      // Add description
      const desc = window.uiUtilsInstance.createElement("p", {
        className: "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2",
        textContent: project.description || "No description"
      });
      card.appendChild(desc);
      
      // Add token usage
      this._addTokenUsage(card, usage, maxTokens, usagePct);
      
      // Add footer
      this._addCardFooter(card, project);
      
      return card;
    }
    
    /**
     * Add header section to project card
     * @private
     * @param {HTMLElement} card - Project card element
     * @param {Object} project - Project data
     */
    _addCardHeader(card, project) {
      const header = window.uiUtilsInstance.createElement("div", { className: "flex justify-between mb-2" });
      const title = window.uiUtilsInstance.createElement("h3", { 
        className: "text-lg font-semibold", 
        textContent: project.name 
      });
      const statusIndicator = window.uiUtilsInstance.createElement("div", {
        className: "text-xs ml-2 px-2 py-1 rounded-full " + (
          project.archived ? "bg-gray-100 text-gray-600" :
          project.pinned ? "bg-yellow-100 text-yellow-700" : 
          "bg-blue-100 text-blue-700"
        ),
        textContent: project.archived ? "Archived" : 
                    project.pinned ? "Pinned" : "Active"
      });
      
      const badges = window.uiUtilsInstance.createElement("div", { className: "flex items-center" });
      badges.appendChild(statusIndicator);
      header.appendChild(title);
      header.appendChild(badges);
      card.appendChild(header);
    }
    
    /**
     * Add token usage section to project card
     * @private
     * @param {HTMLElement} card - Project card element
     * @param {number} usage - Token usage
     * @param {number} maxTokens - Maximum tokens
     * @param {string} usagePct - Usage percentage
     */
    _addTokenUsage(card, usage, maxTokens, usagePct) {
      const tokenWrapper = window.uiUtilsInstance.createElement("div", { className: "mb-2" });
      const tokenHeader = window.uiUtilsInstance.createElement("div", { 
        className: "flex justify-between mb-1 text-xs",
        innerHTML: `
          <span>Tokens: ${window.uiUtilsInstance.formatNumber(usage)} / ${window.uiUtilsInstance.formatNumber(maxTokens)}</span>
          <span>${usagePct}%</span>
        `
      });
      
      const progressOuter = window.uiUtilsInstance.createElement("div", { className: "progress-outer" });
      const progressInner = window.uiUtilsInstance.createElement("div", { 
        className: "progress-inner h-full transition-all duration-500 ease-out",
        style: { width: `${usagePct}%` }
      });
      
      progressOuter.appendChild(progressInner);
      tokenWrapper.appendChild(tokenHeader);
      tokenWrapper.appendChild(progressOuter);
      card.appendChild(tokenWrapper);
    }
    
    /**
     * Add footer section to project card
     * @private
     * @param {HTMLElement} card - Project card element
     * @param {Object} project - Project data
     */
    _addCardFooter(card, project) {
      const footer = window.uiUtilsInstance.createElement("div", { className: "flex justify-between mt-3" });
      const createdInfo = window.uiUtilsInstance.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: `Created ${window.uiUtilsInstance.formatDate(project.created_at)}`
      });
      
      const actions = window.uiUtilsInstance.createElement("div", { className: "flex space-x-1" });
      
      // View button
      const viewBtn = window.uiUtilsInstance.createElement("button", {
        className: "p-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-150 view-project-btn",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
                     -1.274 4.057-5.064 7-9.542 7
                     -4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        `,
        onclick: () => this.onViewProject(project.id)
      });
      
      // Delete button
      const deleteBtn = window.uiUtilsInstance.createElement("button", {
        className: "p-1 text-red-600 hover:text-red-800 delete-project-btn",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                     a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6
                     m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        `,
        onclick: (e) => {
          e.stopPropagation();
          this._confirmDelete(project);
        }
      });
      
      actions.appendChild(viewBtn);
      actions.appendChild(deleteBtn);
      footer.appendChild(createdInfo);
      footer.appendChild(actions);
      card.appendChild(footer);
    }

    /**
     * Show delete confirmation dialog
     * @private
     * @param {Object} project - Project to delete
     */
    _confirmDelete(project) {
      if (!window.modalManager) {
        console.error('modalManager not available');
        return;
      }
      
      window.modalManager.show('delete', {
        title: "Delete Project",
        message: `Are you sure you want to delete "${project.name}"?`,
        confirmText: "Delete",
        cancelText: "Cancel",
        confirmClass: "bg-red-600",
        onConfirm: () => {
          if (!window.projectManager) {
            console.error('projectManager not available');
            window.showNotification("Cannot delete project: system error", "error");
            return;
          }
          
          window.projectManager.deleteProject(project.id)
            .then(() => {
              window.showNotification("Project deleted", "success");
              window.projectManager.loadProjects();
            })
            .catch(err => {
              console.error("Error deleting project:", err);
              window.showNotification("Failed to delete project", "error");
            });
        }
      });
    }

    /**
     * Bind filter buttons event handlers
     * @private
     */
    _bindFilterEvents() {
      const filterButtons = document.querySelectorAll('.project-filter-btn');
      if (!filterButtons.length) {
        console.warn('No project filter buttons found');
        return;
      }

      // Set initial active filter from URL or default
      const urlParams = new URLSearchParams(window.location.search);
      const initialFilter = urlParams.get('filter') || 'all';
      this.state.filter = initialFilter;

      // Set initial active button with ARIA attributes
      filterButtons.forEach(btn => {
        const isActive = btn.dataset.filter === initialFilter;
        btn.classList.toggle('project-tab-btn-active', isActive);
        btn.classList.toggle('text-gray-500', !isActive);
        btn.setAttribute('aria-selected', isActive);
        btn.setAttribute('aria-current', isActive ? 'page' : 'false');
      });

      // Load initial projects with filter
      if (window.projectManager?.loadProjects) {
        this._showLoadingState();
        window.projectManager.loadProjects(initialFilter)
          .catch(err => {
            console.error('Initial project load failed:', err);
            this._showErrorState('Failed to load projects');
          })
          .finally(() => {
            this._hideLoadingState();
          });
      }

      // Add click handlers
      filterButtons.forEach(button => {
        button.addEventListener('click', () => {
          // Get filter from data attribute
          const filter = button.dataset.filter;
          if (this.state.filter === filter) return; // Skip if already active
          
          // Show loading state
          this._showLoadingState();
          
          // Update UI state
          filterButtons.forEach(btn => {
            const isActive = btn === button;
            btn.classList.toggle('project-tab-btn-active', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
            btn.setAttribute('aria-selected', isActive);
            btn.setAttribute('aria-current', isActive ? 'page' : 'false');
          });
          
          // Update component state
          this.state.filter = filter;
          
          // Update URL without reload
          const url = new URL(window.location);
          url.searchParams.set('filter', filter);
          window.history.pushState({}, '', url);
          
          // Reload projects with new filter
          window.projectManager.loadProjects(filter)
            .catch(err => {
              console.error('Project filter failed:', err);
              this._showErrorState('Filter operation failed');
            })
            .finally(() => {
              this._hideLoadingState();
            });
        });
      });

      // Handle back/forward navigation
      window.addEventListener('popstate', () => {
        const params = new URLSearchParams(window.location.search);
        const newFilter = params.get('filter') || 'all';
        if (newFilter !== this.state.filter) {
          this._showLoadingState();
          this.state.filter = newFilter;
          filterButtons.forEach(btn => {
            const isActive = btn.dataset.filter === newFilter;
            btn.classList.toggle('project-tab-btn-active', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
            btn.setAttribute('aria-selected', isActive);
            btn.setAttribute('aria-current', isActive ? 'page' : 'false');
          });
          window.projectManager.loadProjects(newFilter)
            .catch(err => {
              console.error('Navigation project load failed:', err);
              this._showErrorState('Failed to load projects');
            })
            .finally(() => {
              this._hideLoadingState();
            });
        }
      });
    }

    /**
     * Show loading state for project list
     * @private
     */
    _showLoadingState() {
      if (!this.element) return;
      this.element.classList.add('opacity-50');
      this.element.style.pointerEvents = 'none';
      
      // Add loading spinner if not already present
      if (!this.element.querySelector('.loading-spinner')) {
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner absolute inset-0 flex items-center justify-center';
        spinner.innerHTML = `
          <svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        `;
        this.element.appendChild(spinner);
      }
    }

    /**
     * Hide loading state for project list
     * @private
     */
    _hideLoadingState() {
      if (!this.element) return;
      this.element.classList.remove('opacity-50');
      this.element.style.pointerEvents = '';
      
      const spinner = this.element.querySelector('.loading-spinner');
      if (spinner) {
        spinner.remove();
      }
    }

    /**
     * Bind the "Create Project" button event handler
     * @private
     */
    _bindCreateProjectButton() {
      const createProjectBtn = document.getElementById('createProjectBtn');
      if (createProjectBtn) {
        createProjectBtn.addEventListener('click', () => {
          if (!window.projectModal?.initialized) {
            window.projectModal = new ProjectModal();
          }
          window.projectModal.openModal();
        });
      } else {
        console.error('Create Project button not found');
      }
    }
  }

  // Explicitly export to global window
  window.ProjectListComponent = ProjectListComponent;
})();
