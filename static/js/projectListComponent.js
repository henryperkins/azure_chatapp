/**
 * projectListComponent.js
 * Handles rendering and interaction with the project list UI.
 * Dependencies:
 * - window.eventHandlers (external utility, for event management)
 * - window.projectManager (external dependency, for project operations)
 * - window.modalManager (external dependency, for modal dialogs)
 * - window.showNotification (external dependency, for notifications)
 * - window.app (external dependency, for authentication state)
 * - window.auth (external dependency, for auth events)
 * - document (browser built-in, for DOM manipulation)
 * - localStorage (browser built-in, for persistent state)
 * - URL (browser built-in, for URL manipulation)
 * - CustomEvent (browser built-in, for custom events)
 */

// Browser APIs:
// - document (DOM access)
// - localStorage (state persistence)
// - URL (URL parsing/manipulation)
// - CustomEvent (event system)

// External Dependencies (Global Scope):
// - window.eventHandlers (event management)
// - window.projectManager (project data operations)
// - window.modalManager (modal management)
// - window.showNotification (notification system)
// - window.app (application state)
// - window.auth (authentication system)

// Optional Dependencies:
// - Notification system falls back to console
// - Modal system has fallback to native confirm
// - Graceful degradation when components aren't available


class ProjectListComponent {
    /**
     * @param {Object} options
     * @param {string} options.elementId - The DOM element ID where the project list will be rendered
     * @param {Function} options.onViewProject - Callback for when a project card is clicked
     */
    constructor(options = {}) {
        // Required options
        this.elementId = options.elementId || 'projectList';
        this.onViewProject = options.onViewProject || ((projectId) => {
            window.location.href = `/?project=${projectId}`;
        });

        // State
        this.state = {
            projects: [],
            filter: 'all',
            loading: false,
            customization: this._loadCustomization(),
            initialized: false
        };

        // We'll defer container setup & event binding until our init method
        console.log(`[ProjectListComponent] Constructing instance with elementId: ${this.elementId}`);
        this._initialize().then(() => this._loadProjects());
    }

    /**
     * Asynchronously initializes the component.
     * Includes retry logic to ensure container element is ready.
     * @private
     */
    async _initialize() {
        try {
            // Step 1: Ensure container
            await this._ensureContainer();

            // Step 2: Bind event listeners
            this._bindEventListeners();

            // Step 3: Mark as initialized
            this.state.initialized = true;
            console.log('[ProjectListComponent] Initialization complete.');
        } catch (error) {
            console.error('[ProjectListComponent] Failed to initialize:', error);
            this._showErrorState('Initialization error');
        }
    }

    /**
     * Ensures the container element exists in the DOM, with limited retries.
     * @private
     */
    async _ensureContainer() {
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
            attempts++;
            this.element = document.getElementById(this.elementId);

            if (this.element) {
                // Container found
                return true;
            }

            console.warn(
                `[ProjectListComponent] Container #${this.elementId} not found (attempt ${attempts}/${maxAttempts}). Retrying...`
            );
            await new Promise((r) => setTimeout(r, 300));
        }

        // If we exit the loop, container is still not found
        throw new Error(`Container #${this.elementId} could not be located after ${maxAttempts} attempts.`);
    }

    /**
     * Bind event listeners using window.eventHandlers if available.
     * @private
     */
    _bindEventListeners() {
        // Filter tab events
        this._bindFilterEvents();

        // Delegated click listener for project cards
        if (window.eventHandlers?.trackListener) {
            window.eventHandlers.trackListener(this.element, 'click', (e) => this._handleCardClick(e));
        } else {
            this.element.addEventListener('click', (e) => this._handleCardClick(e));
        }

        // Listen for project collection events
        document.addEventListener('projectsLoaded', (e) => this.renderProjects(e.detail));
        document.addEventListener('projectCreated', (e) => this._handleProjectCreated(e.detail));
        document.addEventListener('projectUpdated', (e) => this._handleProjectUpdated(e.detail));

        // Listen for auth changes (re-load projects if user logs in)
        if (window.auth?.AuthBus) {
            window.auth.AuthBus.addEventListener('authStateChanged', (e) => {
                if (e.detail?.authenticated) {
                    this._loadProjects();
                }
            });
        }
    }

    /**
     * Bind filter tab events (All, Personal, etc.) if present in DOM.
     * @private
     */
    _bindFilterEvents() {
        const tabs = document.querySelectorAll('#projectFilterTabs .project-filter-btn');
        if (tabs.length === 0) {
            console.warn('[ProjectListComponent] No filter tabs found');
            return;
        }

        // Determine initial filter from URL or localStorage
        const urlParams = new URLSearchParams(window.location.search);
        this.state.filter = urlParams.get('filter') || localStorage.getItem('projectFilter') || 'all';

        // Set the active tab
        this._updateActiveTab();

        // Bind tab clicks
        tabs.forEach((tab, idx) => {
            tab.tabIndex = 0;
            tab.addEventListener('keydown', (e) => {
              if (e.key === 'ArrowRight') {
                tabs[(idx + 1) % tabs.length].focus();
              } else if (e.key === 'ArrowLeft') {
                tabs[(idx - 1 + tabs.length) % tabs.length].focus();
              } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                tab.click();
              }
            });

            const handler = () => {
                const filter = tab.dataset.filter;
                if (filter === this.state.filter) return;

                this.state.filter = filter;
                this._updateActiveTab();
                this._updateUrl(filter);
                localStorage.setItem('projectFilter', filter);

                this._loadProjects();
            };

            if (window.eventHandlers?.trackListener) {
                window.eventHandlers.trackListener(tab, 'click', handler);
            } else {
                tab.addEventListener('click', handler);
            }
        });
    }

    /**
     * Mark the currently active tab visually.
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
     * Update URL to include the current filter, without refreshing page entirely.
     * @private
     */
    _updateUrl(filter) {
        const url = new URL(window.location);
        url.searchParams.set('filter', filter);
        window.history.pushState({}, '', url);
    }

    /**
     * Handler for clicks on project cards (using event delegation).
     * @private
     */
    _handleCardClick(e) {
        const projectCard = e.target.closest('.project-card');
        if (!projectCard) return;

        // Check if an action button was clicked
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
    }

    /**
     * Actually perform the specified action (view, edit, delete).
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
                this._openEditModal(project);
                break;
            case 'delete':
                this._confirmDelete(project);
                break;
            default:
                console.warn(`[ProjectListComponent] Unknown action: ${action}`);
        }
    }

    /**
     * Open the edit modal (via modalManager), populating data for the given project.
     * @private
     */
    _openEditModal(project) {
        if (!window.modalManager?.show) {
            console.error('[ProjectListComponent] modalManager.show is not available');
            return;
        }
        window.modalManager.show('project', {
            updateContent: (modalEl) => {
                const form = modalEl.querySelector('#projectModalForm');
                const title = modalEl.querySelector('#projectModalTitle');

                if (form) {
                    form.reset();
                    form.querySelector('#projectModalIdInput').value = project.id || '';
                    form.querySelector('#projectModalNameInput').value = project.name || '';
                    form.querySelector('#projectModalDescInput').value = project.description || '';
                    form.querySelector('#projectModalGoalsInput').value = project.goals || '';
                    form.querySelector('#projectModalMaxTokensInput').value = project.max_tokens || '';
                }

                if (title) {
                    title.textContent = 'Edit Project';
                }
            }
        });
    }

    /**
     * Confirm and handle the project deletion.
     * @private
     */
    _confirmDelete(project) {
        if (window.modalManager?.confirmAction) {
            window.modalManager.confirmAction({
                title: 'Delete Project',
                message: `Are you sure you want to delete "${project.name}"? This cannot be undone.`,
                confirmText: 'Delete',
                confirmClass: 'btn-error',
                onConfirm: () => this._executeDelete(project.id)
            });
        } else {
            // Fallback to native confirm
            const confirmed = confirm(`Delete "${project.name}"? This cannot be undone.`);
            if (confirmed) {
                this._executeDelete(project.id);
            }
        }
    }

    /**
     * Execute the actual delete operation.
     * @private
     */
    _executeDelete(projectId) {
        if (!window.projectManager?.deleteProject) {
            console.error('[ProjectListComponent] projectManager.deleteProject is not available.');
            return;
        }
        window.projectManager.deleteProject(projectId)
            .then(() => {
                window.app?.showNotification('Project deleted', 'success');
                this._loadProjects();
            })
            .catch(err => {
                console.error('[ProjectListComponent] Failed to delete project:', err);
                window.app?.showNotification('Failed to delete project', 'error');
            });
    }

    /**
     * Load projects via projectManager based on the current filter.
     * @private
     */
    async _loadProjects() {
        if (this.state.loading) return; // Prevent double requests
        if (!window.projectManager?.loadProjects) {
            console.warn('[ProjectListComponent] Cannot load projects, projectManager.loadProjects is missing.');
            return;
        }

        this.state.loading = true;
        this._showLoadingState();

        try {
            // Attempt to load projects using current filter
            await window.projectManager.loadProjects(this.state.filter);
        } catch (error) {
            console.error('[ProjectListComponent] Error loading projects:', error);
            this._showErrorState('Failed to load projects');
        } finally {
            this.state.loading = false;
            // Actual rendering is triggered by the 'projectsLoaded' event
        }
    }

    /**
     * When a project is created externally, add to our local array and re-render.
     * @private
     */
    _handleProjectCreated(project) {
        if (!project) return;
        this.state.projects.unshift(project);
        this.renderProjects(this.state.projects);
    }

    /**
     * When a project is updated externally, replace in our local array and re-render.
     * @private
     */
    _handleProjectUpdated(updatedProject) {
        if (!updatedProject) return;
        const idx = this.state.projects.findIndex(p => p.id === updatedProject.id);
        if (idx >= 0) {
            this.state.projects[idx] = updatedProject;
            this.renderProjects(this.state.projects);
        }
    }

    /* =========================================================================
     * PUBLIC METHODS
     * ========================================================================= */

    /**
     * Show the project list component.
     */
    show() {
        if (this.element) {
            this.element.classList.remove('hidden');
        }
        // ALSO un‑fade the outer view
        const listView = document.getElementById('projectListView');
        if (listView) {
            listView.classList.remove('hidden', 'opacity-0');
        }
    }

    /**
     * Hide the project list component.
     */
    hide() {
        if (this.element) {
            this.element.classList.add('hidden');
        }
        const listView = document.getElementById('projectListView');
        if (listView) {
            listView.classList.add('hidden', 'opacity-0');
        }
    }

    /**
     * Render projects into the component's DOM element.
     * @param {Array|Object} data - Projects, or an object containing projects
     */
    renderProjects(data) {
        if (!this.element) {
            console.warn('[ProjectListComponent] renderProjects called without a valid container element.');
            return;
        }

        // Normalize data
        let projects = [];
        if (Array.isArray(data)) {
            projects = data;
        } else if (data?.projects) {
            projects = data.projects;
        } else if (data?.data?.projects) {
            projects = data.data.projects;
        }

        this.state.projects = projects;

        // If user not authenticated, show login prompt
        if (!window.app.state.isAuthenticated) {
            this._showLoginRequired();
            return;
        }

        // Show empty state if no projects
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
        });

        this.element.appendChild(fragment);
    }

    /* =========================================================================
     * Internal Rendering Helpers
     * ========================================================================= */

    /**
     * Creates a project card element with relevant action buttons.
     * @private
     */
    _createProjectCard(project) {
        const theme = this.state.customization.theme || 'default';
        const themeBg = theme === 'default' ? 'bg-base-100' : `bg-${theme}`;
        const themeText = theme === 'default' ? 'text-base-content' : `text-${theme}-content`;

        const card = document.createElement('li');
        card.className = `project-card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-all duration-200 border border-base-300 rounded-box p-6 flex flex-col h-full`;
        card.dataset.projectId = project.id;
        card.setAttribute('role', 'article');
        card.setAttribute('aria-labelledby', `project-title-${project.id}`);

        // Card header
        const header = document.createElement('div');
        header.className = 'flex justify-between items-start';

        const title = document.createElement('h3');
        title.className = 'font-semibold text-xl mb-3 project-name';
        title.textContent = project.name || 'Unnamed Project';
        title.id = `project-title-${project.id}`;

        const actions = document.createElement('div');
        actions.className = 'flex gap-1';

        // Action buttons (view, edit, delete)
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
            btn.className = `btn btn-ghost btn-xs btn-square focus:ring-2 focus:ring-primary ${button.className || 'hover:bg-base-200'}`;
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
            description.className = 'project-description text-sm text-base-content/80 mb-3 line-clamp-2';
            description.textContent = project.description;
            card.appendChild(description);
        }

        // Footer
        const footer = document.createElement('div');
        footer.className = 'mt-auto pt-2 flex justify-between text-xs text-base-content/70';

        // Date
        if (this.state.customization.showDate && project.updated_at) {
            const date = document.createElement('span');
            // Optional date formatting
            date.textContent = this._formatDate(project.updated_at);
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
     * Shows a loading skeleton while data is being fetched.
     * @private
     */
    _showLoadingState() {
        if (!this.element) return;

        this.element.innerHTML = '';
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
     * Show an empty state message when no projects exist.
     * @private
     */
    _showEmptyState() {
        if (!this.element) return;

        this.element.innerHTML = `
      <div class="col-span-3 text-center py-10">
        <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
        </svg>
        <p class="mt-4 text-lg">No projects found</p>
        <p class="text-base-content/60 mt-1">Create a new project to get started</p>
        <button id="emptyStateCreateBtn" class="btn btn-primary mt-4">Create Project</button>
      </div>
    `;

        // Wire up create button
        const createBtn = document.getElementById('emptyStateCreateBtn');
        if (createBtn) {
            if (window.eventHandlers?.trackListener) {
                window.eventHandlers.trackListener(createBtn, 'click', () => this._openNewProjectModal());
            } else {
                createBtn.addEventListener('click', () => this._openNewProjectModal());
            }
        }
    }

    /**
     * Show a login prompt if user is not authenticated.
     * @private
     */
    _showLoginRequired() {
        if (!this.element) return;

        this.element.innerHTML = `
      <div class="col-span-3 text-center py-10">
        <svg class="w-16 h-16 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z">
          </path>
        </svg>
        <p class="mt-4 text-lg">Please log in to view your projects</p>
        <button id="loginButton" class="btn btn-primary mt-4">Login</button>
      </div>
    `;

        // Wire up login button
        const loginBtn = document.getElementById('loginButton');
        if (loginBtn) {
            if (window.eventHandlers?.trackListener) {
                window.eventHandlers.trackListener(loginBtn, 'click', (e) => {
                    e.preventDefault();
                    const authButton = document.getElementById('authButton');
                    const authDropdown = document.getElementById('authDropdown');
                    if (authButton && authDropdown) {
                        authDropdown.classList.remove('hidden');
                        authButton.setAttribute('aria-expanded', 'true');
                        // Ensure login tab is active
                        if (typeof window.switchAuthTab === 'function') {
                            window.switchAuthTab('login');
                        } else if (typeof switchAuthTab === 'function') {
                            switchAuthTab('login');
                        }
                    } else {
                        // Fallback: notify user or log error
                        if (window.showNotification) {
                            window.showNotification('Login form is not available. Please use the login button in the header.', 'error');
                        } else {
                            alert('Login form is not available. Please use the login button in the header.');
                        }
                    }
                });
            } else {
                loginBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const authButton = document.getElementById('authButton');
                    const authDropdown = document.getElementById('authDropdown');
                    if (authButton && authDropdown) {
                        authDropdown.classList.remove('hidden');
                        authButton.setAttribute('aria-expanded', 'true');
                        if (typeof window.switchAuthTab === 'function') {
                            window.switchAuthTab('login');
                        } else if (typeof switchAuthTab === 'function') {
                            switchAuthTab('login');
                        }
                    } else {
                        if (window.showNotification) {
                            window.showNotification('Login form is not available. Please use the login button in the header.', 'error');
                        } else {
                            alert('Login form is not available. Please use the login button in the header.');
                        }
                    }
                });
            }
        }
    }

    /**
     * Show a generic error state.
     * @param {string} message
     * @private
     */
    _showErrorState(message) {
        if (!this.element) return;

        this.element.innerHTML = `
      <div class="col-span-3 text-center py-10">
        <svg class="w-16 h-16 mx-auto text-error/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p class="mt-4 text-lg text-error">${message}</p>
        <button id="retryButton" class="btn btn-outline btn-error mt-4">Retry</button>
      </div>
    `;

        const retryBtn = document.getElementById('retryButton');
        if (retryBtn) {
            if (window.eventHandlers?.trackListener) {
                window.eventHandlers.trackListener(retryBtn, 'click', () => this._loadProjects());
            } else {
                retryBtn.addEventListener('click', () => this._loadProjects());
            }
        }
    }

    /**
     * Handle opening the "new project" modal.
     * @private
     */
    _openNewProjectModal() {
        if (!window.modalManager?.show) {
            console.error('[ProjectListComponent] modalManager.show not available');
            return;
        }

        window.modalManager.show('project', {
            updateContent: (modalEl) => {
                // Reset form
                const form = modalEl.querySelector('#projectForm');
                if (form) {
                    form.reset();
                    form.querySelector('#projectIdInput').value = '';
                }

                // Update title
                const title = modalEl.querySelector('#projectModalTitle');
                if (title) {
                    title.textContent = 'Create New Project';
                }
            }
        });
    }

    /**
     * Format date strings for display.
     * @param {string} dateString
     * @returns {string}
     * @private
     */
    _formatDate(dateString) {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch (err) {
            return dateString;
        }
    }

    /**
     * Load card customization from localStorage.
     * @private
     */
    _loadCustomization() {
        try {
            const saved = localStorage.getItem('projectCardsCustomization');
            return saved ? JSON.parse(saved) : this._getDefaultCustomization();
        } catch {
            return this._getDefaultCustomization();
        }
    }

    /**
     * Defaults for card customization (theme, showDescription, etc.).
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

// Expose to global
window.ProjectListComponent = ProjectListComponent;
