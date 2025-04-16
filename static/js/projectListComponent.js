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
        { id: 'accent', name: 'Accent' }, // Uses accent/accent-content
        { id: 'neutral', name: 'Neutral' } // Uses neutral/neutral-content
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

      // Listen for 'authReady' event so we can force-refresh projects if user is authenticated.
      document.addEventListener('authReady', (evt) => {
        if (evt.detail.authenticated) {
          console.log("[ProjectListComponent] 'authReady' -> user is authenticated. Forcing project refresh.");
          this.renderProjects({ forceRefresh: true });
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

    _ensureContainerVisibility() {
      const container = document.getElementById("projectListView");
      const loginRequiredMessage = document.getElementById("loginRequiredMessage");

      console.log("[ProjectListComponent] Ensuring project list visibility");

      // Make container visible and hide login required message
      if (container) {
        container.classList.remove("hidden");
        container.classList.add("flex", "flex-col"); // Use flex for proper display
        console.log("[ProjectListComponent] Made projectListView visible with flex display");
      } else {
        console.warn("[ProjectListComponent] Failed to find projectListView container");
        // Try to create container if missing
        this._createContainerIfMissing();
      }

      // Check if projectManagerPanel is visible
      const projectManagerPanel = document.getElementById("projectManagerPanel");
      if (projectManagerPanel) {
        projectManagerPanel.classList.remove("hidden");
        projectManagerPanel.classList.add("flex");
        console.log("[ProjectListComponent] Made projectManagerPanel visible");
      }

      // Check if user is authenticated
      const isAuthenticated = window.auth?.isAuthenticated ?
                              window.auth.isAuthenticated({ forceVerify: false }) :
                              Promise.resolve(false);

      isAuthenticated.then(authStatus => {
        // Hide login message if authenticated
        if (loginRequiredMessage) {
          loginRequiredMessage.classList.toggle("hidden", authStatus);
          console.log(`[ProjectListComponent] ${authStatus ? 'Hid' : 'Showed'} login required message based on auth status`);
        }
      }).catch(err => {
        console.warn("[ProjectListComponent] Error checking auth status:", err);
      });

      // Make project list element visible too
      if (this.element) {
        this.element.classList.add("grid"); // Ensure grid display
        this.element.classList.remove("hidden");
        console.log("[ProjectListComponent] Made project list grid visible");
      } else {
        console.warn("[ProjectListComponent] Project list element is null, cannot make visible");
        this._setupDOMReferences(); // Try to re-acquire references
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
          detailsView = document.createElement("div");b
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
        (Array.isArray(eventOrProjects) && eventOrProjects.length === 0); // Also load if empty array
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
        projects = Array.isArray(eventOrProjects.data.projects) ?
          eventOrProjects.data.projects : [];
      } else if (eventOrProjects?.projects) {
        projects = Array.isArray(eventOrProjects.projects) ?
          eventOrProjects.projects : [];
      }

      // Log warning if we got an invalid projects structure
      if (!Array.isArray(projects)) {
        console.warn("Projects data is not an array, using empty array instead", eventOrProjects);
        projects = [];
      }

      return projects.map(p => p.to_dict ? p.to_dict() : p);
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
          case 'pinned': return p.pinned;
          case 'archived': return p.archived;
          default: return true;
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

      // Clear with a safety check
      try {
        this.element.innerHTML = ""; // Clear the grid container
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

      card.className = `card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-shadow cursor-pointer border border-base-300 rounded-box`;
      card.dataset.projectId = project.id;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0'); // Make card focusable

      // Add project name, description, etc. using card-body
      let cardContent = `
        <div class="card-body p-4">
          <h3 class="card-title text-lg truncate mb-1">${project.name || 'Unnamed Project'}</h3>
      `;

      if (this.state.cardCustomization.showDescription) {
        cardContent += `<p class="text-sm text-base-content/80 mb-3 line-clamp-2">${project.description || 'No description'}</p>`;
      }

      // Optional: Add badges if enabled and available
      if (this.state.cardCustomization.showBadges && project.badges && project.badges.length > 0) {
        cardContent += `<div class="card-actions justify-start mb-2 flex-wrap gap-1">`;
        project.badges.forEach(badge => {
          const badgeStyle = badge.style || this.state.cardCustomization.defaultBadgeStyle || 'badge-neutral';
          cardContent += `<span class="badge ${badgeStyle} badge-sm">${badge.icon ? badge.icon + ' ' : ''}${badge.text}</span>`;
        });
        cardContent += `</div>`;
      }

      cardContent += `
          <div class="card-actions justify-end mt-auto pt-2 border-t border-base-content/10 text-xs text-base-content/70">
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

      window.projectManager.deleteProject(projectId)
        .then(() => {
          this._showNotification("Project deleted", "success");
          window.projectManager.loadProjects();
        })
        .catch(err => {
          console.error("Delete failed:", err);
          this._showNotification("Failed to delete project", "error");
        });
    }

    _showModal({ title, content, confirmText, confirmClass, onConfirm }) {
      // Use the global modalManager if available
      if (window.modalManager && window.modalManager.confirmAction) {
        window.modalManager.confirmAction({
          title: title,
          message: content, // Assuming content is simple text or basic HTML
          confirmText: confirmText || "Confirm",
          confirmClass: confirmClass || "btn-primary", // Use DaisyUI button classes
          onConfirm: onConfirm
        });
      } else {
        // Fallback to native confirm
        if (confirm(`${title}

${content}`)) {
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
      // Use the specific class for filter tabs
      const buttons = document.querySelectorAll('.project-filter-tabs .project-filter-btn');
      if (!buttons.length) {
        console.debug("No project filter buttons found. Creating fallback filter tabs...");
        this._createFallbackFilterTabs();
      }

      const initialFilter = this._getInitialFilter();
      this.state.filter = initialFilter;

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
        // to keep it accessible. Adjust as needed in your layout.
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
        // Use DaisyUI tab active class
        btn.classList.toggle('tab-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      this.state.filter = filter;
      this._updateURL(filter);

      // Ensure projectManager exists before calling
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects(filter)
          .catch(err => {
            console.error('Filter failed:', err);
            this._renderErrorState('Filter operation failed');
          })
          .finally(() => {
            // Ensure loading state is hidden even on error
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
          // Use DaisyUI tab active class
          btn.classList.toggle('tab-active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        // Ensure projectManager exists
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
    let button = document.getElementById('createProjectBtn');
    if (!button) {
      console.warn('[ProjectListComponent] Create project button (createProjectBtn) not found');

      // Try to find the button by its text content or class
      const possibleButtons = Array.from(document.querySelectorAll('button'))
        .filter(btn =>
          btn.textContent?.trim().toLowerCase() === 'new project' ||
          btn.classList.contains('btn-primary')
        );

      if (possibleButtons.length > 0) {
        button = possibleButtons[0];
        console.log('[ProjectListComponent] Found alternative button:', button);
      } else {
        // Create a fallback button
        this._createFallbackCreateProjectButton();
        button = document.getElementById('createProjectBtn');
        if (!button) return; // Give up if still not found
      }
    }

    // Safely remove existing handler to prevent duplicates
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
        // Fallback or error message
        alert("Cannot open project form.");
      }
    });
  }

  // Add this method to ProjectListComponent
  _createFallbackCreateProjectButton() {
    // Find a good container for the button
    const headerSection = document.querySelector('.mb-4.flex.items-center.justify-between') ||
                          document.querySelector('#projectListView > div:first-child');

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
      // Create action container
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
      // Find the button added in index.html
      let button = document.getElementById('customizeCardsBtn');
      if (!button) {
        console.debug("Customize cards button (customizeCardsBtn) not found. Creating fallback...");
        button = document.createElement("button");
        button.id = "customizeCardsBtn";
        button.className = "btn btn-sm btn-primary hidden";
        button.textContent = "Customize";
        document.body.appendChild(button);
      }

      // Make it visible and add listener
      button.classList.remove('hidden');
      button.addEventListener('click', () => this._showCustomizationModal());

      // Modal creation should happen regardless of button presence
      this._createCustomizationModal();
    }

    _createCustomizationModal() {
      // Attempt to find an existing modal structure in index.html
      let modal = document.getElementById('cardCustomizationModal');
      if (!modal) {
        console.debug("cardCustomizationModal not found in HTML, creating fallback...");
        // Create a fallback <dialog> dynamically
        modal = document.createElement('dialog');
        modal.id = 'cardCustomizationModal';
        // Basic modal styling for DaisyUI (if needed)
        modal.className = 'modal';

        // Provide a minimal structure with the needed elements
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

      // Now we have a modal reference, wire up the controls
      const closeBtn = modal.querySelector('#closeCustomizationBtn');
      const applyBtn = modal.querySelector('#applyCustomizationBtn');
      const resetBtn = modal.querySelector('#resetCustomizationBtn');

      closeBtn?.addEventListener('click', () => this._hideCustomizationModal());
      applyBtn?.addEventListener('click', () => this._applyCardCustomization());
      resetBtn?.addEventListener('click', () => this._resetCardCustomization());

      // Populate selects if not already done
      this._populateCustomizationSelects();
    }

    _populateCustomizationSelects() {
      const themeSelect = document.getElementById('cardThemeSelect');
      const badgeStyleSelect = document.getElementById('defaultBadgeStyleSelect');

      if (themeSelect && themeSelect.options.length === 0) {
        themeSelect.innerHTML = this.availableThemes.map(theme =>
          `<option value="${theme.id}" ${this.state.cardCustomization.theme === theme.id ? 'selected' : ''}>${theme.name}</option>`
        ).join('');
      }

      if (badgeStyleSelect && badgeStyleSelect.options.length === 0) {
        badgeStyleSelect.innerHTML = this.badgeStyles.map(style =>
          `<option value="${style.id}" ${this.state.cardCustomization.defaultBadgeStyle === style.id ? 'selected' : ''}>${style.name}</option>`
        ).join('');
      }
    }

    _showCustomizationModal() {
      const modal = document.getElementById('cardCustomizationModal');
      if (!modal || typeof modal.showModal !== 'function') {
        console.error("Cannot show customization modal.");
        return;
      }

      // Ensure selects are populated before setting values
      this._populateCustomizationSelects();

      // Set current values from state
      document.getElementById('cardThemeSelect').value = this.state.cardCustomization.theme;
      document.getElementById('showDescriptionCheckbox').checked = this.state.cardCustomization.showDescription;
      // document.getElementById('showTokensCheckbox').checked = this.state.cardCustomization.showTokens; // Removed? Add back if needed
      document.getElementById('showDateCheckbox').checked = this.state.cardCustomization.showDate;
      document.getElementById('showBadgesCheckbox').checked = this.state.cardCustomization.showBadges;
      document.getElementById('defaultBadgeStyleSelect').value = this.state.cardCustomization.defaultBadgeStyle;

      modal.showModal(); // Use dialog's showModal method
    }

    _hideCustomizationModal() {
      const modal = document.getElementById('cardCustomizationModal');
      if (modal && typeof modal.close === 'function') {
        modal.close(); // Use dialog's close method
      }
    }

    _applyCardCustomization() {
      this.state.cardCustomization = {
        theme: document.getElementById('cardThemeSelect').value,
        showDescription: document.getElementById('showDescriptionCheckbox').checked,
        // showTokens: document.getElementById('showTokensCheckbox').checked, // Removed?
        showDate: document.getElementById('showDateCheckbox').checked,
        showBadges: document.getElementById('showBadgesCheckbox').checked,
        defaultBadgeStyle: document.getElementById('defaultBadgeStyleSelect').value,
        globalBadges: this.state.cardCustomization.globalBadges || [] // Preserve global badges if they exist
      };

      this._saveCardCustomization();
      this.renderProjects(this.state.projects); // Re-render cards with new settings
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
        showTokens: true,
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
      // Remove any existing handler to prevent duplicates
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
      // Attach with proper event delegation
      this.element.addEventListener('click', this._cardClickHandler);
      // Log for diagnostics
      console.log("[ProjectListComponent] Project card click handlers bound successfully");
    }

    // Helper function to handle card click logic
    _handleCardClick(projectId, event = null) {
      // Determine action based on clicked element
      let action = 'view'; // Default action
      if (event) {
        const actionElement = event.target.closest('[data-action]');
        if (actionElement) {
          action = actionElement.dataset.action;
        }
      }
      // Find project data
      const project = this.state.projects.find(p => p.id === projectId);
      if (!project) {
        console.warn(`[ProjectListComponent] Project not found for ID: ${projectId}`);
        this._showNotification('Project not found', 'error');
        return;
      }
      // Execute action
      switch (action) {
        case 'view':
          // Navigate to project details URL
          window.history.pushState({}, '', `/?project=${projectId}`);
          if (window.projectManager?.loadProjectDetails) {
            window.projectManager.loadProjectDetails(projectId);
          }
          break;
        case 'pin':
          if (window.projectManager?.togglePinProject) {
            window.projectManager.togglePinProject(projectId)
              .then(() => {
                console.log(`[ProjectListComponent] Toggled pin for project: ${projectId}`);
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
                console.log(`[ProjectListComponent] Toggled archive for project: ${projectId}`);
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

  // Export to global scope
  window.ProjectListComponent = ProjectListComponent;

  // Removed the authStateChanged listener from here.
  // Project loading after authentication is now handled centrally in app.js.

  // Ensure global instance is saved when created
  const originalProjectListComponent = window.ProjectListComponent;
  window.ProjectListComponent = function (options) {
    // Ensure we have valid required options
    if (!options || !options.elementId) {
      console.error("[ProjectListComponent] Missing required elementId option");
      options = options || {};
      options.elementId = options.elementId || "projectList"; // Fall back to default ID
    }

    const instance = new originalProjectListComponent(options);
    window.projectListComponent = instance;

    // Attach a mechanism to allow explicit refresh from outside
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

// Ensure the ProjectListComponent is correctly exposed to the global scope
// This fixes the issue where the dashboard cannot find the component
if (typeof window.ProjectListComponent !== 'function') {
  console.log('[ProjectListComponent] Exposing ProjectListComponent to global scope');

  // The original class constructor might still be available as originalProjectListComponent
  if (typeof window.originalProjectListComponent === 'function') {
    window.ProjectListComponent = window.originalProjectListComponent;
  }
  // Otherwise keep the existing wrapper if it exists
}
