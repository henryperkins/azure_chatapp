/**
 * projectListComponent.js
 * Simplified project list component that handles rendering and interaction
 * with project cards. Uses eventHandlers for all event binding and
 * delegates data operations to projectManager.
 */

class ProjectListComponent {
  constructor(options = {}) {
    // Required options
    this.elementId = options.elementId || 'projectList';
    this.onViewProject = options.onViewProject || (projectId => {
      window.location.href = `/?project=${projectId}`;
    });

    // State
    this.state = {
      projects: [],
      filter: 'all',
      loading: false,
      customization: this._loadCustomization()
    };

    // Find or create the container element
    this._setupContainer();

    // Bind events
    this._bindEventListeners();

    console.log(`[ProjectListComponent] Initialized with elementId: ${this.elementId}`);
  }

  /**
   * Set up the container element
   * @private
   */
  _setupContainer() {
    this.element = document.getElementById(this.elementId);

    if (!this.element) {
      console.warn(`[ProjectListComponent] Element with ID '${this.elementId}' not found, creating fallback`);
      this.element = document.createElement('div');
      this.element.id = this.elementId;
      this.element.className = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';

      // Try to find a parent to attach to
      const projectListView = document.getElementById('projectListView');
      if (projectListView) {
        projectListView.appendChild(this.element);
      } else {
        document.body.appendChild(this.element);
      }
    }
  }

  /**
   * Bind event listeners using eventHandlers
   * @private
   */
  _bindEventListeners() {
    // Tabs and filtering
    this._bindFilterEvents();

    // Create project button
    const createBtn = document.getElementById('createProjectBtn');
    if (createBtn) {
      window.eventHandlers.trackListener(createBtn, 'click', () => {
        if (window.modalManager) {
          window.modalManager.show('project');
        }
      });
    }

    // Project list events using delegation
    window.eventHandlers.trackListener(this.element, 'click', (e) => {
      const projectCard = e.target.closest('.project-card');
      if (!projectCard) return;

      // Check if a specific action button was clicked
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const projectId = projectCard.dataset.projectId;
        this._handleAction(action, projectId);
        return;
      }

      // Otherwise treat as a card click
      const projectId = projectCard.dataset.projectId;
      if (projectId) {
        this.onViewProject(projectId);
      }
    });

    // Listen for project updates
    document.addEventListener('projectsLoaded', (e) => this.renderProjects(e.detail));

    // Listen for auth changes
    window.auth.AuthBus.addEventListener('authStateChanged', (e) => {
      if (e.detail.authenticated) {
        this._loadProjects();
      }
    });
  }

  /**
   * Bind filter tab events
   * @private
   */
  _bindFilterEvents() {
    const tabs = document.querySelectorAll('#projectFilterTabs .project-filter-btn');

    if (tabs.length === 0) {
      console.warn('[ProjectListComponent] No filter tabs found');
      return;
    }

    // Set initial state from URL or localStorage
    const urlParams = new URLSearchParams(window.location.search);
    this.state.filter = urlParams.get('filter') || localStorage.getItem('projectFilter') || 'all';

    // Initialize active tab
    this._updateActiveTab();

    // Bind click events
    tabs.forEach(tab => {
      window.eventHandlers.trackListener(tab, 'click', () => {
        const filter = tab.dataset.filter;
        if (filter === this.state.filter) return;

        this.state.filter = filter;
        this._updateActiveTab();
        this._updateUrl(filter);
        localStorage.setItem('projectFilter', filter);

        this._loadProjects();
      });
    });
  }

  /**
   * Update active tab styling
   * @private
   */
  _updateActiveTab() {
    const tabs = document.querySelectorAll('#projectFilterTabs .project-filter-btn');
    tabs.forEach(tab => {
      const isActive = tab.dataset.filter === this.state.filter;
      tab.classList.toggle('tab-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  /**
   * Update URL with current filter
   * @private
   */
  _updateUrl(filter) {
    const url = new URL(window.location);
    url.searchParams.set('filter', filter);
    window.history.pushState({}, '', url);
  }

  /**
   * Load projects via projectManager
   * @private
   */
  _loadProjects() {
    if (this.state.loading) return;

    this.state.loading = true;
    this._showLoadingState();

    if (window.projectManager?.loadProjects) {
      window.projectManager.loadProjects(this.state.filter)
        .catch(error => {
          console.error('[ProjectListComponent] Error loading projects:', error);
          this._showErrorState('Failed to load projects');
        })
        .finally(() => {
          this.state.loading = false;
          this._hideLoadingState();
        });
    } else {
      console.error('[ProjectListComponent] projectManager not available');
      this.state.loading = false;
      this._hideLoadingState();
    }
  }

  /**
   * Handle project card actions
   * @param {string} action - Action to perform (view, edit, delete)
   * @param {string} projectId - Project ID to act on
   * @private
   */
  _handleAction(action, projectId) {
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) {
      console.warn(`[ProjectListComponent] Project not found: ${projectId}`);
      return;
    }

    switch (action) {
      case 'view':
        this.onViewProject(projectId);
        break;

      case 'edit':
        if (window.modalManager) {
          window.modalManager.show('project', {
            updateContent: (modal) => {
              const form = modal.querySelector('#projectForm');
              const title = modal.querySelector('#projectModalTitle');

              if (form) {
                const idInput = form.querySelector('#projectIdInput');
                const nameInput = form.querySelector('#projectNameInput');
                const descInput = form.querySelector('#projectDescInput');

                if (idInput) idInput.value = project.id || '';
                if (nameInput) nameInput.value = project.name || '';
                if (descInput) descInput.value = project.description || '';
              }

              if (title) title.textContent = 'Edit Project';
            }
          });
        }
        break;

      case 'delete':
        this._confirmDelete(project);
        break;

      default:
        console.warn(`[ProjectListComponent] Unknown action: ${action}`);
    }
  }

  /**
   * Confirm and handle project deletion
   * @param {Object} project - Project to delete
   * @private
   */
  _confirmDelete(project) {
    if (window.modalManager?.confirmAction) {
      window.modalManager.confirmAction({
        title: 'Delete Project',
        message: `Are you sure you want to delete "${project.name}"? This cannot be undone.`,
        confirmText: 'Delete',
        confirmClass: 'btn-error',
        onConfirm: () => {
          if (window.projectManager?.deleteProject) {
            window.projectManager.deleteProject(project.id)
              .then(() => {
                window.showNotification('Project deleted', 'success');
                this._loadProjects();
              })
              .catch(error => {
                console.error('Delete failed:', error);
                window.showNotification('Failed to delete project', 'error');
              });
          }
        }
      });
    } else {
      const confirmed = confirm(`Delete "${project.name}"? This cannot be undone.`);
      if (confirmed && window.projectManager?.deleteProject) {
        window.projectManager.deleteProject(project.id)
          .then(() => {
            window.showNotification('Project deleted', 'success');
            this._loadProjects();
          })
          .catch(error => {
            console.error('Delete failed:', error);
            window.showNotification('Failed to delete project', 'error');
          });
      }
    }
  }

  /* =========================================================================
   * PUBLIC METHODS
   * ========================================================================= */

  /**
   * Show the component
   */
  show() {
    if (this.element) {
      this.element.classList.remove('hidden');
    }

    const listView = document.getElementById('projectListView');
    if (listView) {
      listView.classList.remove('hidden');
    }
  }

  /**
   * Hide the component
   */
  hide() {
    if (this.element) {
      this.element.classList.add('hidden');
    }

    const listView = document.getElementById('projectListView');
    if (listView) {
      listView.classList.add('hidden');
    }
  }

  /**
   * Render projects
   * @param {Array|Object} data - Projects data
   */
  renderProjects(data) {
    if (!this.element) {
      console.warn('[ProjectListComponent] Cannot render projects: element not found');
      return;
    }

    // Extract projects from various formats
    let projects = [];

    if (Array.isArray(data)) {
      projects = data;
    } else if (data?.projects) {
      projects = data.projects;
    } else if (data?.data?.projects) {
      projects = data.data.projects;
    }

    this.state.projects = projects;

    // Check authentication
    if (!window.app.state.isAuthenticated) {
      this._showLoginRequired();
      return;
    }

    if (projects.length === 0) {
        this._showEmptyState();
        return;
      }

      // Clear and render
      this.element.innerHTML = '';
      const fragment = document.createDocumentFragment();

    projects.forEach(project => {
      const card = this._createProjectCard(project);
      fragment.appendChild(card);

      this.element.appendChild(fragment);
    });
  }

  /**
   * Create a project card
   * @param {Object} project - Project data
   * @returns {HTMLElement} - Card element
   * @private
   */
  _createProjectCard(project) {
    // Create card with theme
    const theme = this.state.customization.theme || 'default';
    const themeBg = theme === 'default' ? 'bg-base-100' : `bg-${theme}`;
    const themeText = theme === 'default' ? 'text-base-content' : `text-${theme}-content`;

    const card = document.createElement('div');
    card.className = `project-card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-shadow border border-base-300 rounded p-4`;
    card.dataset.projectId = project.id;

    // Card header
    const header = document.createElement('div');
    header.className = 'flex justify-between items-start';

    const title = document.createElement('h3');
    title.className = 'font-medium text-lg truncate';
    title.textContent = project.name || 'Unnamed Project';

    const actions = document.createElement('div');
    actions.className = 'flex gap-1';

    // Action buttons
    const actionButtons = [
      {
        action: 'view',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>',
        title: 'View'
      },
      {
        action: 'edit',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>',
        title: 'Edit'
      },
      {
        action: 'delete',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>',
        title: 'Delete',
        className: 'text-error hover:bg-error/10'
      }
    ];

    actionButtons.forEach(button => {
      const btn = document.createElement('button');
      btn.className = `btn btn-ghost btn-xs btn-square ${button.className || 'hover:bg-base-200'}`;
      btn.dataset.action = button.action;
      btn.title = button.title;
      btn.innerHTML = button.icon;
      actions.appendChild(btn);
    });

    header.appendChild(title);
    header.appendChild(actions);
    card.appendChild(header);

    // Description
    if (this.state.customization.showDescription && project.description) {
      const description = document.createElement('p');
      description.className = 'text-sm text-base-content/80 mb-3 line-clamp-2';
      description.textContent = project.description;
      card.appendChild(description);
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'mt-auto pt-2 flex justify-between text-xs text-base-content/70';

    // Date
    if (this.state.customization.showDate && project.updated_at) {
      const date = document.createElement('span');
      date.textContent = window.formatDate(project.updated_at);
      footer.appendChild(date);
    }

    // Badges
    const badges = document.createElement('div');
    badges.className = 'flex gap-1';

    if (project.pinned) {
      const pinBadge = document.createElement('span');
      pinBadge.className = 'tooltip tooltip-left';
      pinBadge.dataset.tip = 'Pinned';
      pinBadge.textContent = '📌';
      badges.appendChild(pinBadge);
    }

    if (project.archived) {
      const archiveBadge = document.createElement('span');
      archiveBadge.className = 'tooltip tooltip-left';
      archiveBadge.dataset.tip = 'Archived';
      archiveBadge.textContent = '📦';
      badges.appendChild(archiveBadge);
    }

    footer.appendChild(badges);
    card.appendChild(footer);

    return card;
  }

  /**
   * Show loading state
   * @private
   */
  _showLoadingState() {
    if (!this.element) return;

    this.element.innerHTML = '';

    // Create skeleton cards
    for (let i = 0; i < 6; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'bg-base-200 animate-pulse rounded-lg p-4';
      skeleton.innerHTML = `
        <div class="h-6 bg-base-300 rounded w-3/4 mb-3"></div>
        <div class="h-4 bg-base-300 rounded w-full mb-2"></div>
        <div class="h-4 bg-base-300 rounded w-2/3 mb-2"></div>
        <div class="h-3 bg-base-300 rounded w-1/3 mt-6"></div>
      `;
      this.element.appendChild(skeleton);
    }
  }

  /**
   * Hide loading state
   * @private
   */
  _hideLoadingState() {
    // Just clear when rendering actual content
  }

  /**
   * Show empty state message
   * @private
   */
  _showEmptyState() {
    if (!this.element) return;

    this.element.innerHTML = `
      <div class="col-span-3 text-center py-10">
        <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
        </svg>
        <p class="mt-4 text-lg">No projects found</p>
        <p class="text-base-content/60 mt-1">Create a new project to get started</p>
        <button id="emptyStateCreateBtn" class="btn btn-primary mt-4">Create Project</button>
      </div>
    `;

    const createBtn = document.getElementById('emptyStateCreateBtn');
    if (createBtn) {
      window.eventHandlers.trackListener(createBtn, 'click', () => {
        if (window.modalManager) {
          window.modalManager.show('project');
        }
      });
    }
  }

  /**
   * Show login required message
   * @private
   */
  _showLoginRequired() {
    if (!this.element) return;

    this.element.innerHTML = `
      <div class="col-span-3 text-center py-10">
        <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
        </svg>
        <p class="mt-4 text-lg">Please log in to view your projects</p>
        <button id="loginButton" class="btn btn-primary mt-4">Login</button>
      </div>
    `;

    const loginBtn = document.getElementById('loginButton');
    if (loginBtn) {
      window.eventHandlers.trackListener(loginBtn, 'click', () => {
        window.location.href = '/login';
      });
    }
  }

  /**
   * Show error state
   * @param {string} message - Error message
   * @private
   */
  _showErrorState(message) {
    if (!this.element) return;

    this.element.innerHTML = `
      <div class="col-span-3 text-center py-10">
        <svg class="w-16 h-16 mx-auto text-error/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p class="mt-4 text-lg text-error">${message}</p>
        <button id="retryButton" class="btn btn-outline btn-error mt-4">Retry</button>
      </div>
    `;

    const retryBtn = document.getElementById('retryButton');
    if (retryBtn) {
      window.eventHandlers.trackListener(retryBtn, 'click', () => {
        this._loadProjects();
      });
    }
  }

  /**
   * Format a date
   * @param {string} dateString - Date string
   * @returns {string} - Formatted date
   * @private
   */
  _formatDate(dateString) {
    if (!dateString) return '';

    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch (e) {
      return dateString;
    }
  }

  /**
   * Load card customization from storage
   * @returns {Object} - Customization settings
   * @private
   */
  _loadCustomization() {
    try {
      const saved = localStorage.getItem('projectCardsCustomization');
      return saved ? JSON.parse(saved) : this._getDefaultCustomization();
    } catch (e) {
      return this._getDefaultCustomization();
    }
  }

  /**
   * Get default card customization
   * @returns {Object} - Default settings
   * @private
   */
  _getDefaultCustomization() {
    return {
      theme: 'default',
      showDescription: true,
      showDate: true,
      showBadges: true
    };
  }
}

// Export to window
window.ProjectListComponent = ProjectListComponent;
