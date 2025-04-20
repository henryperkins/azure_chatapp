/**
 * Enhanced ProjectListComponent
 * ----------------------------
 * Manages the project list view with:
 * - Customizable project cards
 * - Advanced filtering
 * - Badge support
 * - Theme management
 * - Responsive design
 */

(function () {
  class ProjectListComponent {
    constructor(options) {
      this._validateOptions(options);
      this._initializeState(options);
      this._setupDOMReferences();
      this._bindEvents();
      this._setupCustomization();
    }

    // ======================
    // PUBLIC API
    // ======================

    show() {
      this._toggleListViewVisibility(true);
    }

    hide() {
      this._toggleListViewVisibility(false);
    }

    renderProjects(eventOrProjects) {
      try {
        this._ensureContainerVisibility();

        // Guard against re-rendering if already in progress
        if (this.state.loading) {
          console.log("[ProjectListComponent] Render already in progress, skipping...");
          return;
        }

        // Skip if this is an event from another source
        if (eventOrProjects?.source && eventOrProjects.source !== "projectManager") {
          console.log("[ProjectListComponent] Ignoring event from other source:", eventOrProjects.source);
          return;
        }

        if (this._shouldLoadProjectsDirectly(eventOrProjects)) {
          return this._loadProjectsThroughManager();
        }

        const projects = this._extractProjects(eventOrProjects);
        this.state.projects = projects;

        this._resetScrollPosition();
        this._renderFilteredProjects();
      } catch (err) {
        console.error('Project rendering error:', err);
        this._renderErrorState('Failed to display projects');
      } finally {
        this._hideLoadingState();
      }
    }

    applyGlobalTheme(themeId) {
      if (!this._isValidTheme(themeId)) return;

      this.state.cardCustomization.theme = themeId;
      this._saveCardCustomization();
      this.renderProjects(this.state.projects);
    }

    addProjectBadge(projectId, badge) {
      if (!badge.text) {
        this._showNotification('Badge text is required', 'error');
        return;
      }

      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) return;

      project.badges = project.badges || [];
      project.badges.push({
        text: badge.text,
        style: badge.style || 'default',
        icon: badge.icon || null
      });

      this._updateProjectCard(projectId);
    }

    // ======================
    // PRIVATE METHODS
    // ======================

    _validateOptions(options) {
      if (!options?.elementId) {
        throw new Error('ProjectListComponent requires elementId option');
      }
    }

    _initializeState(options) {
      this.state = {
        projects: [],
        filter: 'all',
        loading: false,
        cardCustomization: this._loadCardCustomization()
      };

      this.elementId = options.elementId;
      this.onViewProject = options.onViewProject;

      // Define themes based on DaisyUI color semantics
      this.availableThemes = [
        { id: 'default', name: 'Default' }, // Uses base-100/base-content
        { id: 'primary', name: 'Primary' }, // Uses primary/primary-content
        { id: 'secondary', name: 'Secondary' }, // Uses secondary/secondary-content
        { id: 'accent', name: 'Accent' },   // Uses accent/accent-content
        { id: 'neutral', name: 'Neutral' }  // Uses neutral/neutral-content
      ];

      // Define badge styles using DaisyUI badge colors/styles
      this.badgeStyles = [
        { id: 'badge-neutral', name: 'Neutral' },
        { id: 'badge-primary', name: 'Primary' },
        { id: 'badge-secondary', name: 'Secondary' },
        { id: 'badge-accent', name: 'Accent' },
        { id: 'badge-info', name: 'Info' },
        { id: 'badge-success', name: 'Success' },
        { id: 'badge-warning', name: 'Warning' },
        { id: 'badge-error', name: 'Error' },
        { id: 'badge-ghost', name: 'Ghost' },
        { id: 'badge-outline', name: 'Outline' }
      ];
    }

    _setupDOMReferences() {
      this.element = document.getElementById(this.elementId);
      this.messageEl = document.getElementById("noProjectsMessage");

      if (!this.element) {
        this._createFallbackContainer();
      }

      // Double-check that our elements are set up correctly
      if (!this.element) {
        console.error("[ProjectListComponent] Failed to find or create the element with ID:", this.elementId);
      }

      // Ensure the messageEl is available
      if (!this.messageEl) {
        this.messageEl = document.querySelector("#noProjectsMessage") ||
          document.createElement('div');

        if (this.messageEl.id !== "noProjectsMessage") {
          this.messageEl.id = "noProjectsMessage";
          this.messageEl.className = "hidden text-center py-8 text-gray-500";
          const listView = document.getElementById('projectListView');
          if (listView) {
            listView.appendChild(this.messageEl);
          } else {
            document.body.appendChild(this.messageEl);
          }
        }
      }
    }

    _createFallbackContainer() {
      this.element = document.createElement('div');
      this.element.id = this.elementId;
      // Use Tailwind grid classes
      this.element.className = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

      const listView = document.getElementById('projectListView');
      if (listView) {
        // Ensure the container for the grid exists
        const gridContainer = listView.querySelector('#projectList');
        if (gridContainer) {
          gridContainer.appendChild(this.element); // Append to the grid container
        } else {
          listView.appendChild(this.element); // Fallback: append directly to listView
        }
      } else {
        document.body.appendChild(this.element); // Absolute fallback
      }
    }

    _bindEvents() {
      this._bindFilterEvents();
      this._bindCreateProjectButton();
      // Add event delegation for project card clicks
      this._bindProjectCardEvents();

      // Listen for 'authReady' event to refresh projects if user is authenticated
      document.addEventListener('authReady', (evt) => {
        if (evt.detail.authenticated) {
          console.log("[ProjectListComponent] 'authReady' -> user is authenticated. Refreshing projects.");
          // Only refresh projects, don't trigger any modals
          this._loadProjectsThroughManager()
            .then(projects => this.renderProjects(projects))
            .catch(err => console.error("Failed to refresh projects on auth:", err));
        }
      });
    }

    _setupCustomization() {
      this._initializeCustomizationUI();
      this._createCustomizationModal();
    }

    _toggleListViewVisibility(show) {
      const listView = document.getElementById('projectListView');

      if (listView) {
        listView.classList.toggle('hidden', !show);
        console.log(`[ProjectListComponent] Toggled projectListView visibility: ${show ? 'visible' : 'hidden'}`);
      } else {
        console.warn('[ProjectListComponent] projectListView element not found for visibility toggle.');
      }
    }

    async _ensureContainerVisibility() {
      // Ensures the project list or login message is shown based on auth state.
      const projectListView = document.getElementById('projectListView');
      const projectManagerPanel = document.getElementById('projectManagerPanel');
      const projectGrid = document.getElementById('projectGrid'); // Assuming this is the grid container
      const loginRequiredMessage = document.getElementById('loginRequiredMessage');
      const noProjectsMessage = document.getElementById('noProjectsMessage'); // Assuming an ID for this message

      if (!projectListView || !projectManagerPanel || !projectGrid || !loginRequiredMessage) {
          console.error("[ProjectListComponent] Required elements not found for visibility check.");
          return;
      }

      if(AUTH_DEBUG) console.debug("[ProjectListComponent] Ensuring project list visibility");

      try {
          // *** FIX: Await the result of the authentication check ***
          const isAuthenticated = await window.auth.checkAuth(); // Returns a Promise<boolean>
          // ********************************************************

          if (isAuthenticated) {
              if(AUTH_DEBUG) console.debug("[ProjectListComponent] User is authenticated. Showing project panel/list.");
              projectManagerPanel.classList.remove('hidden');
              projectListView.style.display = 'flex'; // Or 'block' depending on layout
              projectGrid.classList.remove('hidden'); // Show the grid
              loginRequiredMessage.classList.add('hidden');
              // Toggle noProjectsMessage based on actual project count later in renderProjects
          } else {
               if(AUTH_DEBUG) console.debug("[ProjectListComponent] User is not authenticated. Showing login message.");
              projectManagerPanel.classList.add('hidden');
              projectListView.style.display = 'none'; // Hide the list view
              projectGrid.classList.add('hidden');    // Hide the grid
              loginRequiredMessage.classList.remove('hidden');
              if (noProjectsMessage) noProjectsMessage.classList.add('hidden'); // Hide no projects message too
          }
      } catch (error) {
          console.error("[ProjectListComponent] Error checking authentication for visibility:", error);
          // Fallback: show login message on error
          projectManagerPanel.classList.add('hidden');
          projectListView.style.display = 'none';
          projectGrid.classList.add('hidden');
          loginRequiredMessage.classList.remove('hidden');
          if (noProjectsMessage) noProjectsMessage.classList.add('hidden');
      }
    }

    // Helper method to create container if it doesn't exist
    _createContainerIfMissing() {
      let container = document.getElementById("projectListView");
      if (!container) {
        console.log("[ProjectListComponent] Creating missing projectListView container");
        container = document.createElement("main");
        container.id = "projectListView";
        container.className = "flex-1 overflow-y-auto p-4 lg:p-6";

        // Find a good parent to append to
        const drawerContent = document.querySelector(".drawer-content") || document.body;
        drawerContent.appendChild(container);

        // Create the project list grid container inside
        const projectList = document.createElement("div");
        projectList.id = "projectList";
        projectList.className = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
        container.appendChild(projectList);

        // Also create details view container if missing
        let detailsView = document.getElementById("projectDetailsView");
        if (!detailsView) {
          detailsView = document.createElement("div");
          detailsView.id = "projectDetailsView";
          detailsView.className = "hidden flex-1 overflow-y-auto p-4 lg:p-6";
          container.parentNode.appendChild(detailsView);
        }

        // Update our element reference
        this.element = projectList;
        console.log("[ProjectListComponent] Created missing containers including projectDetailsView");
      }
      return container;
    }

    _shouldLoadProjectsDirectly(eventOrProjects) {
      return eventOrProjects?.forceRefresh ||
        eventOrProjects?.directCall ||
        !eventOrProjects ||
        (Array.isArray(eventOrProjects) && eventOrProjects.length === 0); // Load if empty array
    }

    _loadProjectsThroughManager() {
      if (!window.projectManager?.loadProjects) {
        throw new Error('projectManager not available');
      }

      // Set loading state to prevent recursive calls
      if (this.state.loading) {
        console.log("[ProjectListComponent] Already loading projects, skipping...");
        return Promise.resolve([]);
      }

      this.state.loading = true;
      this._showLoadingState();
      return window.projectManager.loadProjects()
        .catch(err => {
          console.error('Project loading failed:', err);
          this._renderErrorState('Failed to load projects');
          return [];
        })
        .finally(() => {
          this.state.loading = false;
          this._hideLoadingState();
        });
    }

    _extractProjects(eventOrProjects) {
      let projects = [];

      // Handle different input types and ensure we have an array
      if (Array.isArray(eventOrProjects)) {
        projects = eventOrProjects;
      } else if (eventOrProjects instanceof Event) {
        projects = eventOrProjects.detail?.data?.projects || [];
      } else if (eventOrProjects?.data?.projects) {
        projects = Array.isArray(eventOrProjects.data.projects)
          ? eventOrProjects.data.projects
          : [];
      } else if (eventOrProjects?.projects) {
        projects = Array.isArray(eventOrProjects.projects)
          ? eventOrProjects.projects
          : [];
      }

      // Log warning if we got an invalid structure
      if (!Array.isArray(projects)) {
        console.warn("Projects data is not an array, using empty array instead", eventOrProjects);
        projects = [];
      }

      // If a project has to_dict, convert
      return projects.map(p => (p.to_dict ? p.to_dict() : p));
    }

    _resetScrollPosition() {
      if (this.state.projects.length > 0) {
        requestAnimationFrame(() => {
          if (this.element) this.element.scrollTop = 0;
        });
      }
    }

    _renderFilteredProjects() {
      const filteredProjects = this._getFilteredProjects();

      clearTimeout(this._renderDebounce);
      this._renderDebounce = setTimeout(() => {
        this._performDOMUpdate(filteredProjects);
      }, 50);
    }

    _getFilteredProjects() {
      return this.state.projects.filter(p => {
        switch (this.state.filter) {
          case 'pinned':
            return p.pinned;
          case 'archived':
            return p.archived;
          default:
            return true;
        }
      });
    }

    _performDOMUpdate(filteredProjects) {
      if (!this.element) {
        // Attempt to re-acquire the element if it was missing
        console.warn("[ProjectListComponent] Element not found for DOM update, attempting to recreate");
        this._setupDOMReferences();

        if (!this.element) {
          console.error("[ProjectListComponent] Cannot perform DOM update, element still not found after reacquisition");
          this._createFallbackContainer();
          if (!this.element) {
            console.error("[ProjectListComponent] Failed to create fallback container. Cannot render projects.");
            return;
          }
        }
      }

      console.log(`[ProjectListComponent] Updating DOM with ${filteredProjects.length} projects`);

      // First ensure containers are visible properly
      this._ensureContainerVisibility();

      // Clear old content
      try {
        this.element.innerHTML = "";
      } catch (err) {
        console.error("[ProjectListComponent] Error clearing element:", err);
        // Try one more time to get the element
        this._createFallbackContainer();
        if (!this.element) return;
      }

      if (filteredProjects.length === 0) {
        this._showEmptyState();
        return;
      }

      // Hide empty state message if projects exist
      if (this.messageEl) {
        this.messageEl.classList.add("hidden");
      } else {
        console.warn("[ProjectListComponent] messageEl not found for empty state");
        // Try to create a message element if missing
        this.messageEl = document.querySelector("#noProjectsMessage");
        if (!this.messageEl) {
          const container = document.getElementById("projectListView");
          if (container) {
            this.messageEl = document.createElement("div");
            this.messageEl.id = "noProjectsMessage";
            this.messageEl.className = "text-center py-10 text-base-content/70 hidden";
            container.appendChild(this.messageEl);
          }
        }
      }

      const fragment = document.createDocumentFragment();
      filteredProjects.forEach(project => {
        const card = this._createProjectCard(project);
        if (card) {
          fragment.appendChild(card);
        }
      });

      try {
        this.element.appendChild(fragment); // Append all cards at once
        console.log(`[ProjectListComponent] Successfully rendered ${filteredProjects.length} project cards`);
      } catch (err) {
        console.error("[ProjectListComponent] Error appending project cards:", err);
      }
    }

    _showEmptyState() {
      if (!this.messageEl) return;

      const message = this._getEmptyStateMessage();
      this.messageEl.textContent = message;
      this.messageEl.classList.remove("hidden");
    }

    _getEmptyStateMessage() {
      if (this.state.filter === 'all') return 'No projects available';
      if (this.state.filter === 'pinned') return 'No pinned projects';
      if (this.state.filter === 'archived') return 'No archived projects';
      return 'No projects match your criteria';
    }

    _createProjectCard(project) {
      const card = document.createElement('div');
      // Use DaisyUI card component classes
      const theme = this.state.cardCustomization.theme || 'default';
      const themeBg = theme === 'default' ? 'bg-base-100' : `bg-${theme}`;
      const themeText = theme === 'default' ? 'text-base-content' : `text-${theme}-content`;

      card.className = `card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-shadow border border-base-300 rounded-box relative overflow-visible`;
      card.dataset.projectId = project.id;

      // Add project name, description, etc. using card-body
      let cardContent = `
        <div class="card-body p-4">
          <div class="flex justify-between items-start relative z-10">
            <h3 class="card-title text-lg truncate mb-1">${project.name || 'Unnamed Project'}</h3>
            <div class="flex gap-1">
              <button class="btn btn-ghost btn-xs btn-square hover:bg-base-200" data-action="view" data-project-id="${project.id}" aria-label="Open project">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
              <button class="btn btn-ghost btn-xs btn-square hover:bg-base-200" data-action="edit" data-project-id="${project.id}" aria-label="Edit project">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button class="btn btn-ghost btn-xs btn-square text-error hover:bg-error/10" data-action="delete" data-project-id="${project.id}" aria-label="Delete project">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
      `;

      if (this.state.cardCustomization.showDescription) {
        cardContent += `<p class="text-sm text-base-content/80 mb-3 line-clamp-2 relative z-10">${project.description || 'No description'}</p>`;
      }

      // Make the main area of the card clickable for navigation, but with lower z-index
      cardContent += `<div class="absolute inset-0 cursor-pointer z-0" data-action="view" data-project-id="${project.id}"></div>`;

      // Optional: Add badges if enabled and available
      if (this.state.cardCustomization.showBadges && project.badges && project.badges.length > 0) {
        cardContent += `<div class="card-actions justify-start mb-2 flex-wrap gap-1 relative z-10">`;
        project.badges.forEach(badge => {
          const badgeStyle = badge.style || this.state.cardCustomization.defaultBadgeStyle || 'badge-neutral';
          cardContent += `<span class="badge ${badgeStyle} badge-sm">${badge.icon ? badge.icon + ' ' : ''}${badge.text}</span>`;
        });
        cardContent += `</div>`;
      }

      cardContent += `
          <div class="card-actions justify-end mt-auto pt-2 border-t border-base-content/10 text-xs text-base-content/70 relative z-10">
            ${this.state.cardCustomization.showDate ? `<span>Updated: ${new Date(project.updated_at).toLocaleDateString()}</span>` : ''}
            ${project.pinned ? '<span class="ml-2 tooltip tooltip-left" data-tip="Pinned">📌</span>' : ''}
            ${project.archived ? '<span class="ml-2 tooltip tooltip-left" data-tip="Archived">📦</span>' : ''}
          </div>
        </div>
      `;

      card.innerHTML = cardContent;

      // Add event listeners for keyboard interaction
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this._handleCardClick(project.id);
        }
      });

      return card;
    }

    _updateProjectCard(projectId) {
      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) return;

      const card = this.element.querySelector(`[data-project-id="${projectId}"]`);
      if (!card) return;

      const newCard = this._createProjectCard(project);
      card.replaceWith(newCard);
    }

    _showAddBadgeDialog(projectId) {
      // This function seems deprecated by the customization modal.
      // If needed, it should be updated to use DaisyUI modal.
      console.warn("_showAddBadgeDialog is likely deprecated, use customization modal.");
      this._showCustomizationModal(); // Show the main customization modal instead
    }

    _saveCardCustomizations(projectId) {
      // This function seems deprecated by the customization modal apply function.
      console.warn("_saveCardCustomizations is likely deprecated.");
      // Logic might need merging into _applyCardCustomization if specific per-project customization is still desired.
    }

    _confirmDelete(project) {
      // Use the global modalManager if available
      if (window.modalManager && window.modalManager.confirmAction) {
        window.modalManager.confirmAction({
          title: "Delete Project",
          message: `Are you sure you want to delete "${project.name}"? This action cannot be undone.`,
          confirmText: "Delete",
          confirmClass: "btn-error", // Use DaisyUI button class
          onConfirm: () => this._deleteProject(project.id)
        });
      } else {
        // Fallback to native confirm
        if (confirm(`Delete Project

Are you sure you want to delete "${project.name}"?`)) {
          this._deleteProject(project.id);
        }
      }
    }

    _deleteProject(projectId) {
      if (!window.projectManager?.deleteProject) {
        this._showNotification("Cannot delete project: system error", "error");
        return;
      }

      // First update UI immediately for responsiveness
      const projectIndex = this.state.projects.findIndex(p => p.id === projectId);
      if (projectIndex !== -1) {
        // Create a copy of the projects array
        const updatedProjects = [...this.state.projects];
        // Remove the project from the copy
        updatedProjects.splice(projectIndex, 1);
        // Update state and re-render
        this.state.projects = updatedProjects;
        this._renderFilteredProjects();
      }

      window.projectManager.deleteProject(projectId)
        .then(() => {
          this._showNotification("Project deleted", "success");
          // Refresh from server to ensure UI is in sync
          window.projectManager.loadProjects();
        })
        .catch(err => {
          console.error("Delete failed:", err);
          this._showNotification("Failed to delete project", "error");
          // Refresh from server to restore the project if delete failed
          window.projectManager.loadProjects();
        });
    }

    _showModal({ title, content, confirmText, confirmClass, onConfirm }) {
      // Use the global modalManager if available
      if (window.modalManager && window.modalManager.confirmAction) {
        window.modalManager.confirmAction({
          title: title,
          message: content, // Assuming content is text or basic HTML
          confirmText: confirmText || "Confirm",
          confirmClass: confirmClass || "btn-primary",
          onConfirm: onConfirm
        });
      } else {
        // Fallback to native confirm
        if (confirm(`${title}\n\n${content}`)) {
          onConfirm();
        }
      }
    }

    _showNotification(message, type = 'info') {
      if (window.showNotification) {
        window.showNotification(message, type);
      } else {
        console.log(`${type.toUpperCase()}: ${message}`);
      }
    }

    _renderErrorState(message) {
      if (!this.element) return;

      const error = document.createElement('div');
      error.className = 'text-red-500 text-center py-8 col-span-3';
      error.textContent = message;

      this.element.appendChild(error);
      if (this.messageEl) this.messageEl.classList.add("hidden");
    }

    _showLoadingState() {
      if (!this.element) return;
      this.element.classList.add('opacity-50', 'pointer-events-none');
      this.element.innerHTML = '';

      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 6; i++) { // Show 6 skeleton cards
        const skeleton = document.createElement('div');
        skeleton.className = 'card bg-base-200 shadow-md animate-pulse p-4 rounded-box';
        skeleton.innerHTML = `
          <div class="card-body">
            <div class="h-6 bg-base-300 rounded w-3/4 mb-2"></div>
            <div class="h-4 bg-base-300 rounded w-full mb-1"></div>
            <div class="h-4 bg-base-300 rounded w-5/6"></div>
          </div>
        `;
        fragment.appendChild(skeleton);
      }
      this.element.appendChild(fragment);
    }

    _hideLoadingState() {
      if (!this.element) return;

      this.element.classList.remove('opacity-50', 'pointer-events-none');
      this.element.style.position = ''; // Reset position if set

      const spinnerOverlay = this.element.querySelector('.loading-spinner-overlay');
      if (spinnerOverlay) spinnerOverlay.remove();
    }

  _bindFilterEvents() {
    // Target buttons by their class within the projectFilterTabs ID
    const buttons = document.querySelectorAll('#projectFilterTabs .project-filter-btn');
      if (!buttons.length) {
        console.debug("No project filter buttons found. Creating fallback filter tabs...");
        this._createFallbackFilterTabs();
      }

      const initialFilter = this._getInitialFilter();
      this.state.filter = initialFilter;

      // Finish the snippet where it cut off:
      this._setInitialActiveButton(buttons, initialFilter);
      this._loadInitialProjects(initialFilter);

      buttons.forEach(btn => {
        btn.addEventListener('click', () => this._handleFilterClick(btn, buttons));
      });

      window.addEventListener('popstate', () => this._handlePopState(buttons));
    }

    _createFallbackFilterTabs() {
      // Attempt to locate or create a .project-filter-tabs container
      let container = document.querySelector(".project-filter-tabs");
      if (!container) {
        console.debug("[ProjectListComponent] Creating fallback .project-filter-tabs container.");
        container = document.createElement("div");
        container.className = "project-filter-tabs tabs mb-4";
        // For a basic fallback, append near the top of body or an existing parent
        document.body.prepend(container);
      }

      // Create default filters if none exist
      ["all", "pinned", "archived"].forEach(filter => {
        const btn = document.createElement("button");
        btn.className = "tab tab-bordered project-filter-btn";
        btn.dataset.filter = filter;
        btn.textContent = filter.charAt(0).toUpperCase() + filter.slice(1);
        container.appendChild(btn);
      });
    }

    _getInitialFilter() {
      const params = new URLSearchParams(window.location.search);
      return params.get('filter') || 'all';
    }

    _setInitialActiveButton(buttons, filter) {
      buttons.forEach(btn => {
        const isActive = btn.dataset.filter === filter;
        // Use DaisyUI tab active class
        btn.classList.toggle('tab-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    _loadInitialProjects(filter) {
      if (window.projectManager?.loadProjects) {
        this._showLoadingState();
        window.projectManager.loadProjects(filter)
          .catch(err => {
            console.error('Initial load failed:', err);
            this._renderErrorState('Failed to load projects');
          });
      }
    }

    _handleFilterClick(button, allButtons) {
      const filter = button.dataset.filter;
      if (this.state.filter === filter) return;

      this._showLoadingState();

      allButtons.forEach(btn => {
        const isActive = btn === button;

        // Toggle active class for the button itself
        if (isActive) {
          btn.classList.add('text-base-content');
          btn.classList.remove('text-base-content/60');
          btn.setAttribute('aria-current', 'page');
        } else {
          btn.classList.remove('text-base-content');
          btn.classList.add('text-base-content/60');
          btn.removeAttribute('aria-current');
        }

        // Update the underline span element
        const underlineSpan = btn.querySelector('.absolute.bottom-0');
        if (underlineSpan) {
          if (isActive) {
            underlineSpan.classList.remove('bg-transparent');
            underlineSpan.classList.add('bg-blue-600');
          } else {
            underlineSpan.classList.add('bg-transparent');
            underlineSpan.classList.remove('bg-blue-600');
          }
        }

        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      this.state.filter = filter;
      this._updateURL(filter);

      // Ensure projectManager exists
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects(filter)
          .catch(err => {
            console.error('Filter failed:', err);
            this._renderErrorState('Filter operation failed');
          })
          .finally(() => {
            this._hideLoadingState();
          });
      } else {
        console.error("projectManager not available for filtering");
        this._renderErrorState('System error: Cannot filter projects');
        this._hideLoadingState();
      }
    }

    _updateURL(filter) {
      const url = new URL(window.location);
      url.searchParams.set('filter', filter);
      window.history.pushState({}, '', url);
    }

    _handlePopState(allButtons) {
      const params = new URLSearchParams(window.location.search);
      const newFilter = params.get('filter') || 'all';

      if (newFilter !== this.state.filter) {
        this._showLoadingState();
        this.state.filter = newFilter;

        allButtons.forEach(btn => {
          const isActive = btn.dataset.filter === newFilter;
          btn.classList.toggle('tab-active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        if (window.projectManager?.loadProjects) {
          window.projectManager.loadProjects(newFilter)
            .catch(err => {
              console.error('Navigation load failed:', err);
              this._renderErrorState('Failed to load projects');
            })
            .finally(() => {
              this._hideLoadingState();
            });
        } else {
          console.error("projectManager not available for popstate navigation");
          this._renderErrorState('System error: Cannot load projects');
          this._hideLoadingState();
        }
      }
    }

    _bindCreateProjectButton() {
      // Add loading indicator to container while searching for button
      const container = document.getElementById('projectListView');
      if (container && !container.classList.contains('initializing-buttons')) {
        container.classList.add('initializing-buttons');
      }

      // First attempt to find the button directly
      let button = document.getElementById('createProjectBtn');

      // If button doesn't exist, try alternative approaches
      if (!button) {
        console.log('[ProjectListComponent] Create project button not found, creating fallback...');

        // Create a fallback button
        this._createFallbackCreateProjectButton();
        button = document.getElementById('createProjectBtn');

        // Add a safe retry with exponential backoff
        if (!button) {
          const retryAttempt = parseInt(container?.dataset.buttonRetryAttempt || '0', 10);
          if (retryAttempt < 3) { // Limit retry attempts
            const delay = Math.pow(2, retryAttempt) * 500; // Exponential backoff (500ms, 1000ms, 2000ms)
            console.log(`[ProjectListComponent] Scheduling retry attempt ${retryAttempt + 1} in ${delay}ms`);

            if (container) {
              container.dataset.buttonRetryAttempt = (retryAttempt + 1).toString();
            }

            setTimeout(() => {
              this._bindCreateProjectButton();
            }, delay);
          } else {
            console.warn('[ProjectListComponent] Failed to create project button after multiple attempts');
            this._showNotification('Project creation UI could not be fully initialized. Try refreshing the page.', 'warning');
          }
          return;
        }
      }

      // Clear initialization state
      if (container) {
        container.classList.remove('initializing-buttons');
        delete container.dataset.buttonRetryAttempt;
      }

      // Bind the events to the button
      this._bindButtonEvents(button);
    }

    /**
     * Binds the necessary events to the createProjectBtn
     * Extracted for better code reuse in the delayed retry case
     */
    _bindButtonEvents(button) {
      // Replace any existing handler
      const newButton = button.cloneNode(true);
      if (button.parentNode) {
        button.parentNode.replaceChild(newButton, button);
        button = newButton;
      }

      button.addEventListener('click', () => {
        // Use the global modal manager
        if (window.modalManager) {
          window.modalManager.show('project', {
            updateContent: (modalEl) => {
              // Reset form for creation
              const form = modalEl.querySelector('#projectForm');
              const title = modalEl.querySelector('#projectModalTitle');
              if (form) form.reset();
              if (title) title.textContent = 'Create Project';
              const projectIdInput = modalEl.querySelector('#projectIdInput');
              if (projectIdInput) projectIdInput.value = '';
            }
          });
        } else {
          console.error("[ProjectListComponent] Modal manager not available to show project form.");
          alert("Cannot open project form.");
        }
      });
    }

    _createFallbackCreateProjectButton() {
      const headerSection = document.querySelector('.mb-4.flex.items-center.justify-between')
        || document.querySelector('#projectListView > div:first-child');

      if (!headerSection) {
        // Create a header if not found
        const container = document.getElementById('projectListView');
        if (!container) return;

        const newHeader = document.createElement('div');
        newHeader.className = 'mb-4 flex items-center justify-between';
        newHeader.innerHTML = `
          <h2 class="text-xl font-semibold">Projects</h2>
          <div class="flex gap-2">
            <button id="createProjectBtn" type="button" class="btn btn-primary btn-sm">New Project</button>
          </div>
        `;
        if (container.firstChild) {
          container.insertBefore(newHeader, container.firstChild);
        } else {
          container.appendChild(newHeader);
        }
        console.log('[ProjectListComponent] Created fallback header with project button');
        return;
      }

      // If there's already a header but no button
      let actionsContainer = headerSection.querySelector('.flex.gap-2');
      if (!actionsContainer) {
        actionsContainer = document.createElement('div');
        actionsContainer.className = 'flex gap-2';
        headerSection.appendChild(actionsContainer);
      }

      // Create button
      const button = document.createElement('button');
      button.id = 'createProjectBtn';
      button.type = 'button';
      button.className = 'btn btn-primary btn-sm';
      button.textContent = 'New Project';

      actionsContainer.appendChild(button);
      console.log('[ProjectListComponent] Created fallback create project button');
    }

    _initializeCustomizationUI() {
      let button = document.getElementById('customizeCardsBtn');
      if (!button) {
        console.debug("Customize cards button (customizeCardsBtn) not found. Creating fallback...");
        button = document.createElement("button");
        button.id = "customizeCardsBtn";
        button.className = "btn btn-sm btn-primary hidden";
        button.textContent = "Customize";
        document.body.appendChild(button);
      }

      button.classList.remove('hidden');
      button.addEventListener('click', () => this._showCustomizationModal());

      this._createCustomizationModal();
    }

    _createCustomizationModal() {
      let modal = document.getElementById('cardCustomizationModal');
      if (!modal) {
        console.debug("cardCustomizationModal not found in HTML, creating fallback...");
        modal = document.createElement('dialog');
        modal.id = 'cardCustomizationModal';
        modal.className = 'modal';

        modal.innerHTML = `
          <form method="dialog" class="modal-box">
            <h3 class="font-bold text-xl mb-4">Customize Card Appearance</h3>
            <div class="mb-4">
              <label for="cardThemeSelect" class="block mb-1">Theme:</label>
              <select id="cardThemeSelect" class="select select-bordered w-full max-w-xs"></select>
            </div>

            <div class="mb-4">
              <label class="label cursor-pointer flex items-center gap-2">
                <span class="label-text">Show Description</span>
                <input type="checkbox" id="showDescriptionCheckbox" class="checkbox checkbox-primary"/>
              </label>
              <label class="label cursor-pointer flex items-center gap-2">
                <span class="label-text">Show Date</span>
                <input type="checkbox" id="showDateCheckbox" class="checkbox checkbox-primary"/>
              </label>
              <label class="label cursor-pointer flex items-center gap-2">
                <span class="label-text">Show Badges</span>
                <input type="checkbox" id="showBadgesCheckbox" class="checkbox checkbox-primary"/>
              </label>
            </div>

            <div class="mb-6">
              <label for="defaultBadgeStyleSelect" class="block mb-1">Default Badge Style:</label>
              <select id="defaultBadgeStyleSelect" class="select select-bordered w-full max-w-xs"></select>
            </div>

            <div class="modal-action">
              <button type="button" id="resetCustomizationBtn" class="btn btn-secondary">Reset</button>
              <button type="button" id="applyCustomizationBtn" class="btn btn-primary">Apply</button>
              <button type="button" id="closeCustomizationBtn" class="btn">Close</button>
            </div>
          </form>
        `;
        document.body.appendChild(modal);
      }

      const closeBtn = modal.querySelector('#closeCustomizationBtn');
      const applyBtn = modal.querySelector('#applyCustomizationBtn');
      const resetBtn = modal.querySelector('#resetCustomizationBtn');

      closeBtn?.addEventListener('click', () => this._hideCustomizationModal());
      applyBtn?.addEventListener('click', () => this._applyCardCustomization());
      resetBtn?.addEventListener('click', () => this._resetCardCustomization());

      this._populateCustomizationSelects();
    }

    _populateCustomizationSelects() {
      const themeSelect = document.getElementById('cardThemeSelect');
      const badgeStyleSelect = document.getElementById('defaultBadgeStyleSelect');

      if (themeSelect && themeSelect.options.length === 0) {
        themeSelect.innerHTML = this.availableThemes
          .map(theme => `<option value="${theme.id}" ${this.state.cardCustomization.theme === theme.id ? 'selected' : ''}>${theme.name}</option>`)
          .join('');
      }

      if (badgeStyleSelect && badgeStyleSelect.options.length === 0) {
        badgeStyleSelect.innerHTML = this.badgeStyles
          .map(style => `<option value="${style.id}" ${this.state.cardCustomization.defaultBadgeStyle === style.id ? 'selected' : ''}>${style.name}</option>`)
          .join('');
      }
    }

    _showCustomizationModal() {
      const modal = document.getElementById('cardCustomizationModal');
      if (!modal || typeof modal.showModal !== 'function') {
        console.error("Cannot show customization modal.");
        return;
      }
      // Populate selects before setting values
      this._populateCustomizationSelects();

      document.getElementById('cardThemeSelect').value = this.state.cardCustomization.theme;
      document.getElementById('showDescriptionCheckbox').checked = this.state.cardCustomization.showDescription;
      document.getElementById('showDateCheckbox').checked = this.state.cardCustomization.showDate;
      document.getElementById('showBadgesCheckbox').checked = this.state.cardCustomization.showBadges;
      document.getElementById('defaultBadgeStyleSelect').value = this.state.cardCustomization.defaultBadgeStyle;

      modal.showModal();
    }

    _hideCustomizationModal() {
      const modal = document.getElementById('cardCustomizationModal');
      if (modal && typeof modal.close === 'function') {
        modal.close();
      }
    }

    _applyCardCustomization() {
      this.state.cardCustomization = {
        theme: document.getElementById('cardThemeSelect').value,
        showDescription: document.getElementById('showDescriptionCheckbox').checked,
        showDate: document.getElementById('showDateCheckbox').checked,
        showBadges: document.getElementById('showBadgesCheckbox').checked,
        defaultBadgeStyle: document.getElementById('defaultBadgeStyleSelect').value,
        globalBadges: this.state.cardCustomization.globalBadges || []
      };

      this._saveCardCustomization();
      this.renderProjects(this.state.projects);
      this._hideCustomizationModal();

      this._showNotification('Customization applied', 'success');
    }

    _resetCardCustomization() {
      this.state.cardCustomization = this._getDefaultCardCustomization();
      this._saveCardCustomization();
      this.renderProjects(this.state.projects);
      this._hideCustomizationModal();

      this._showNotification('Customization reset', 'info');
    }

    _loadCardCustomization() {
      try {
        const saved = localStorage.getItem('projectCardsCustomization');
        return saved ? JSON.parse(saved) : this._getDefaultCardCustomization();
      } catch (err) {
        console.error('Load failed:', err);
        return this._getDefaultCardCustomization();
      }
    }

    _saveCardCustomization() {
      try {
        localStorage.setItem(
          'projectCardsCustomization',
          JSON.stringify(this.state.cardCustomization)
        );
      } catch (err) {
        console.error('Save failed:', err);
      }
    }

    _getDefaultCardCustomization() {
      return {
        theme: 'default',
        showDescription: true,
        showTokens: true, // (If you want to remove this, set false or remove the property.)
        showDate: true,
        showBadges: true,
        defaultBadgeStyle: 'default',
        globalBadges: []
      };
    }

    _isValidTheme(themeId) {
      return this.availableThemes.some(theme => theme.id === themeId);
    }

    _bindProjectCardEvents() {
      if (!this.element) {
        console.warn("[ProjectListComponent] Cannot bind card events: container element not found");
        return;
      }
      // Remove any existing handler
      if (this._cardClickHandler) {
        this.element.removeEventListener('click', this._cardClickHandler);
      }
      // Create a persistent handler reference
      this._cardClickHandler = (event) => {
        const projectCard = event.target.closest('.card[data-project-id]');
        if (!projectCard) return;
        const projectId = projectCard.dataset.projectId;
        if (!projectId) return;
        this._handleCardClick(projectId, event);
      };
      this.element.addEventListener('click', this._cardClickHandler);
      console.log("[ProjectListComponent] Project card click handlers bound successfully");
    }

    _handleCardClick(projectId, event = null) {
      // Stop event propagation if this is from a button
      if (event) {
        const actionButton = event.target.closest('button[data-action]');
        if (actionButton) {
          event.stopPropagation();
          const action = actionButton.dataset.action;
          this._executeAction(action, projectId);
          return;
        }

        // Check for other specific action elements
        const actionElement = event.target.closest('[data-action]');
        if (actionElement) {
          const action = actionElement.dataset.action;
          this._executeAction(action, projectId);
          return;
        }
      }
      // Default action is 'view'
      this._executeAction('view', projectId);
    }

    _executeAction(action, projectId) {
      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) {
        console.warn(`[ProjectListComponent] Project not found for ID: ${projectId}`);
        this._showNotification('Project not found', 'error');
        return;
      }

      console.log(`[ProjectListComponent] Executing action '${action}' for project: ${projectId}`);

      switch (action) {
        case 'view':
          window.history.pushState({}, '', `/?project=${projectId}`);
          if (window.projectManager?.loadProjectDetails) {
            window.projectManager.loadProjectDetails(projectId);
          }
          break;
        case 'pin':
          if (window.projectManager?.togglePinProject) {
            window.projectManager.togglePinProject(projectId)
              .then(() => {
                this._showNotification('Project pin toggled', 'success');
                this._loadProjectsThroughManager();
              })
              .catch(this._handleActionError.bind(this, 'pin'));
          }
          break;
        case 'archive':
          if (window.projectManager?.toggleArchiveProject) {
            window.projectManager.toggleArchiveProject(projectId)
              .then(() => {
                this._showNotification('Project archive status toggled', 'success');
                this._loadProjectsThroughManager();
              })
              .catch(this._handleActionError.bind(this, 'archive'));
          }
          break;
        case 'edit':
          this._showEditModal(project);
          break;
        case 'delete':
          this._confirmDelete(project);
          break;
        default:
          console.warn(`[ProjectListComponent] Unknown action: ${action}`);
      }
    }

    _handleActionError(action, err) {
      console.error(`[ProjectListComponent] Error performing ${action} action:`, err);
      this._showNotification(`Failed to ${action} project`, 'error');
    }

    _showEditModal(project) {
      if (!project) return;
      if (window.modalManager?.show) {
        window.modalManager.show('project', {
          updateContent: (modalEl) => {
            const form = modalEl.querySelector('#projectForm');
            const title = modalEl.querySelector('#projectModalTitle');
            if (form) {
              const idInput = form.querySelector('#projectIdInput');
              const nameInput = form.querySelector('#projectNameInput');
              const descInput = form.querySelector('#projectDescInput');
              const goalsInput = form.querySelector('#projectGoalsInput');
              const maxTokensInput = form.querySelector('#projectMaxTokensInput');
              if (idInput) idInput.value = project.id || '';
              if (nameInput) nameInput.value = project.name || '';
              if (descInput) descInput.value = project.description || '';
              if (goalsInput) goalsInput.value = project.goals || '';
              if (maxTokensInput) maxTokensInput.value = project.max_tokens || '';
            }
            if (title) title.textContent = 'Edit Project';
          }
        });
      } else if (window.projectModal?.openModal) {
        window.projectModal.openModal(project);
      }
    }
  }

  // Export the class to global scope
  window.ProjectListComponent = ProjectListComponent;

  // Keep reference to the original, so we can wrap it for a default global instance
  const originalProjectListComponent = window.ProjectListComponent;
  window.ProjectListComponent = function (options) {
    // Ensure valid required options
    if (!options || !options.elementId) {
      console.error("[ProjectListComponent] Missing required elementId option");
      options = options || {};
      options.elementId = options.elementId || "projectList";
    }

    const instance = new originalProjectListComponent(options);
    window.projectListComponent = instance;

    // Attach a method to allow explicit refresh from outside
    instance.forceRender = function (projects) {
      if (Array.isArray(projects) && projects.length > 0) {
        console.log("[ProjectListComponent] Force rendering projects:", projects.length);
        instance.renderProjects(projects);
      } else {
        console.log("[ProjectListComponent] Force refresh with existing projects");
        instance.renderProjects({ forceRefresh: true });
      }
    };

    return instance;
  };
})();

// Ensure the ProjectListComponent is exposed in case the wrapper initialization is skipped
if (typeof window.ProjectListComponent !== 'function') {
  console.log('[ProjectListComponent] Exposing ProjectListComponent to global scope');
  if (typeof window.originalProjectListComponent === 'function') {
    window.ProjectListComponent = window.originalProjectListComponent;
  }
}
