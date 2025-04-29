/**
 * projectListComponent.js
 * Handles rendering and interaction with the project list UI.
 *
 * ## Dependencies:
 * - window.app: Application core with state management and API requests.
 * - window.eventHandlers: Utility for event management.
 * - window.projectManager: Project management API.
 * - window.modalManager: Modal dialog management.
 * - window.DependencySystem: Dependency injection/registration system.
 */

function _getProjectModal() {
    return window.DependencySystem?.modules.get('projectModal') || window.projectModal;
}
// --------------------------------------
// ProjectListComponent Class
// --------------------------------------
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
            initialized: false,
            initializationTime: null
        };

        // Element reference - will be set later
        this.element = null;
    }

    // --------------------------------------
    // Lifecycle: Initialization
    // --------------------------------------

    /**
     * Initialize the component with retry capabilities and robust race-condition handling.
     * @returns {Promise<boolean>}
     */
    async _waitForListContainer() {
        const maxAttempts = 40, retryDelay = 100; // 4s max
        let el = null;
        for (let i = 0; i < maxAttempts; i++) {
            el = document.getElementById(this.elementId);
            if (el) return el;
            await new Promise(r => setTimeout(r, retryDelay));
        }
        throw new Error(`Timeout: Project list container #${this.elementId} not found`);
    }

    async initialize() {
        // Diagnostics: Log projectEvents cache (once, then remove if not needed)
        console.log('[DIAG] projectEvents cache on init:', window.projectEvents?.projectsLoaded);

        if (this.state.initialized) {
            console.log('[ProjectListComponent] Already initialized');
            return true;
        }

        try {
            console.log(`[ProjectListComponent] Initializing with elementId: ${this.elementId}`);

            // Save initialization time to handle race conditions
            this.state.initializationTime = Date.now();

            // --- Stricter: Force wait for actual container element before proceeding ---
            await this._waitForListContainer();
            this.element = document.getElementById(this.elementId);
            if (!this.element) throw new Error(`Timeout: Project list container #${this.elementId} not found (post-wait)`);

            // Step 2: Bind event listeners
            this._bindEventListeners();

            // Step 3: Bind create project buttons
            await this._bindCreateProjectButtons();

            // Step 4: Mark as initialized *before* checking cache/loading
            this.state.initialized = true;
            console.log('[ProjectListComponent] Core initialization complete. Container ready.');

            // Patch 1: After initialization, forcibly replay missed projectsLoaded events if any (event "replay" logic)
            this._replayMissedProjectsLoaded();

            // Step 5: Check for cached data or load projects (for fallback robustness)
            setTimeout(() => {
                if (!this._checkForCachedProjectData()) {
                    // If no cached data was rendered, trigger a load
                    this._loadProjects();
                }
            }, 50); // Small delay

            console.log('[ProjectListComponent] Initialization sequence finished.');
            return true;
        } catch (error) {
            console.error('[ProjectListComponent] Failed to initialize:', error);
            this._showErrorState('Initialization error');
            return false;
        }
    }

    /**
     * Patch 3: Ensures the container element exists with retry logic,
     * and if still not found, waits for a DOM event indicating it is ready (projectListReady).
     * @returns {Promise<boolean>} - True if found, false otherwise.
     * @private
     */
    async _ensureContainerWithRetryWithProjectListReady() {
        const maxAttempts = 20;
        const retryInterval = 150;
        let attempts = 0;

        while (attempts < maxAttempts) {
            attempts++;
            this.element = document.getElementById(this.elementId);

            if (this.element) {
                console.log(`[ProjectListComponent] Found container after ${attempts} attempt(s)`);
                return true;
            }

            // On the first failed attempt, if event-based fallback hasn't happened, wait for "projectListReady"
            if (attempts === 3) {
                // Still not present, wait for external event (async HTML injection complete)
                console.warn(`[ProjectListComponent] Waiting for 'projectListReady' event...`);
                await new Promise((resolve) => {
                    // Either projectListReady or next retry will continue
                    let resolved = false;
                    const handler = () => {
                        if (!resolved) {
                            resolved = true;
                            document.removeEventListener('projectListReady', handler);
                            resolve();
                        }
                    };
                    document.addEventListener('projectListReady', handler, { once: true });
                    // Timeout fallback to avoid hanging indefinitely
                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            document.removeEventListener('projectListReady', handler);
                            resolve();
                        }
                    }, 2000);
                });
            } else {
                await new Promise((r) => setTimeout(r, retryInterval));
            }
        }

        // Exceeded maximum attempts
        console.error(`[ProjectListComponent] CRITICAL: Container #${this.elementId} could not be located after ${maxAttempts} attempts.`);
        this._showErrorState(`UI Element #${this.elementId} not found.`);
        return false;
    }

    /**
     * Patch 1: Replay any missed 'projectsLoaded' events, robustly.
     * Called after component is initialized and container is present.
     * This ensures UI sync even if event arrived "too early".
     */
    _replayMissedProjectsLoaded() {
        if (!this.element) {
            console.error("[ProjectListComponent] Cannot replay projectsLoaded: element not found.");
            return false;
        }
        // Try to find any cached event
        if (window.projectEvents && window.projectEvents.projectsLoaded && window.projectEvents.projectsLoaded.length) {
            const recent = window.projectEvents.projectsLoaded.at(-1);
            if (recent && this.renderProjects) {
                this.renderProjects(recent.detail?.projects || recent.detail);
                console.log('[ProjectListComponent] Replayed (rendered) missed projectsLoaded event from cache.');
                return true;
            }
        }
        if (window.projectManager?.currentProjects?.length) {
            this.renderProjects({ projects: window.projectManager.currentProjects });
            console.log('[ProjectListComponent] Replayed missed projectsLoaded using projectManager.currentProjects.');
            return true;
        }
        return false;
    }

    /**
     * Check for cached project data that might have arrived before initialization.
     * (Race condition fallback, can remain as extra line of defense.)
     * @returns {boolean} - True if cached data was found and rendered, false otherwise.
     * @private
     */
    _checkForCachedProjectData() {
        // Ensure element exists before trying to render
        if (!this.element) {
            console.warn('[ProjectListComponent] _checkForCachedProjectData called but element is not ready.');
            return false;
        }

        // If we already have projects in the manager, use them
        if (window.projectManager?.currentProjects?.length > 0) {
            console.log('[ProjectListComponent] Found cached projects in projectManager, rendering...');
            this.renderProjects({ projects: window.projectManager.currentProjects });
            return true;
        }

        // Otherwise, check for any recent 'projectsLoaded' events in a local cache
        const recentEvents = this._getRecentEvents('projectsLoaded');
        if (recentEvents.length > 0) {
            console.log(`[ProjectListComponent] Found ${recentEvents.length} recent projectsLoaded events, processing most recent`);
            const mostRecent = recentEvents[recentEvents.length - 1];
            if (mostRecent.detail && (mostRecent.detail.projects || Array.isArray(mostRecent.detail))) {
                this.renderProjects(mostRecent.detail);
                return true;
            }
        }

        return false; // No cached data rendered
    }

    /**
     * Retrieve recent events from a cached log (window.projectEvents) if available.
     * @param {string} eventName - The name of the event to retrieve
     * @returns {Array<CustomEvent>} - Filtered events near init time
     * @private
     */
    _getRecentEvents(eventName) {
        if (!window.projectEvents || !window.projectEvents[eventName]) {
            return [];
        }

        const initTime = this.state.initializationTime || 0;
        // Include events within ±5 seconds of initialization
        return window.projectEvents[eventName].filter(
            (evt) => evt.timestamp > initTime - 5000 && evt.timestamp < initTime + 5000
        );
    }

    // --------------------------------------
    // Event Binding
    // --------------------------------------

    /**
     * Bind event listeners using window.eventHandlers if available.
     * @private
     */
    _bindEventListeners() {
        this._bindFilterEvents();

        // Listen on *both* projectManager instance and document for robustness
        const handler = (e) => this.renderProjects(e.detail);
        document.addEventListener('projectsLoaded', handler);
        if (window.projectManager?.addEventListener) {
            window.projectManager.addEventListener('projectsLoaded', handler);
        }

        // Delegated click listener for project cards
        window.eventHandlers.trackListener(this.element, 'click', (e) => this._handleCardClick(e), {
            description: 'Project List Card Click'
        });

        // Listen for project collection events (existing handlers remain for create/update)
        document.addEventListener('projectCreated', (e) => this._handleProjectCreated(e.detail));
        document.addEventListener('projectUpdated', (e) => this._handleProjectUpdated(e.detail));

        // Listen for auth changes (re-load projects if user logs in)
        document.addEventListener('authStateChanged', (e) => {
            if (e.detail?.authenticated) {
                this._loadProjects();
            }
        });
    }

    _bindFilterEvents() {
        const container = document.getElementById('projectFilterTabs');
        if (!container) return;

        const tabs = container.querySelectorAll('.tab[data-filter]');
        tabs.forEach((tab) => {
            const filterValue = tab.dataset.filter;
            if (!filterValue) return;

            const keydownHandler = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this._setFilter(filterValue);
                }
            };
            const clickHandler = () => this._setFilter(filterValue);

            if (window.eventHandlers?.trackListener) {
                window.eventHandlers.trackListener(tab, 'keydown', keydownHandler, {
                    passive: false,
                    description: `Filter tab keydown (${tab.dataset.filter})`
                });
                window.eventHandlers.trackListener(tab, 'click', clickHandler, {
                    description: `Filter tab click (${tab.dataset.filter})`
                });
            } else {
                window.eventHandlers.trackListener(tab, 'keydown', keydownHandler, {
                    passive: false,
                    description: `Filter tab keydown (${tab.dataset.filter})`
                });
                window.eventHandlers.trackListener(tab, 'click', clickHandler, {
                    description: `Filter tab click (${tab.dataset.filter})`
                });
            }
        });
    }

    _setFilter(filter) {
        this.state.filter = filter;
        this._updateActiveTab();
        this._updateUrl(filter);
        this._loadProjects();
    }

    _updateActiveTab() {
        const tabs = document.querySelectorAll('#projectFilterTabs .tab[data-filter]');
        tabs.forEach((tab) => {
            const isActive = tab.dataset.filter === this.state.filter;
            tab.classList.toggle('tab-active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    _updateUrl(filter) {
        const url = new URL(window.location);
        url.searchParams.set('filter', filter);
        window.history.pushState({}, '', url);
    }

    // --------------------------------------
    // Render Methods
    // --------------------------------------

    renderProjects(data) {
      /* ---------------------------------------------------------
       * Guard 1:  Ignore events whose payload is obviously not a
       *           list-of-projects.  This prevents a later, rogue
       *           `projectsLoaded` event (carrying conversations,
       *           stats, etc.) from wiping an already correct UI.
       * --------------------------------------------------------- */
      const looksLikeProjectArray = (value) =>
          Array.isArray(value) &&
          value.every((p) => p && typeof p === 'object' && 'id' in p);

      // --- revised guard: only bail if it is *really* a bare conversations payload ---
      const isPureConversationPayload =
            Array.isArray(data?.conversations) &&
            !looksLikeProjectArray(data) &&
            !looksLikeProjectArray(data?.projects);

      if (isPureConversationPayload) {
          console.warn('[ProjectListComponent] Ignoring projectsLoaded that only contains conversations');
          return;   // <-- early-exit only if not a project payload
      }

        if (!this.element) {
            console.error(`[ProjectListComponent.renderProjects] ABORTING: Target element #${this.elementId} is not available in the DOM.`);
            this.element = document.getElementById(this.elementId);
            if (!this.element) {
                this._showErrorState(`Rendering failed: UI element #${this.elementId} missing.`);
                return;
            }
            console.warn(`[ProjectListComponent.renderProjects] Re-found element #${this.elementId} just in time.`);
        }
        console.log('%c[ProjectListComponent.renderProjects] Received:', 'color: teal; font-weight: bold', data);

        let projects = [];
        if (Array.isArray(data)) {
            projects = data;
        } else if (data?.projects && Array.isArray(data.projects)) {
            projects = data.projects;
        } else if (data?.data?.projects && Array.isArray(data.data.projects)) {
            projects = data.data.projects;
        } else if (Array.isArray(data?.data)) {
            projects = data.data;
        } else if (
            typeof data === "object" &&
            !Array.isArray(data) &&
            data?.data && typeof data.data === "object" && !Array.isArray(data.data)
        ) {
            // Possibly wrapped as {data: {id:...}} for a single project fallback
            projects = [data.data];
        } else if (data?.status === 'success' && Array.isArray(data?.conversations)) {
            console.warn('[ProjectListComponent] Received conversations data instead of projects');
            projects = [];
        } else {
            // Log all normalization failures robustly
            console.warn("[ProjectListComponent] Could not find projects array in data:", data);
        }

        console.log('%c[ProjectListComponent.renderProjects] Parsed projects array:', 'color: teal; font-weight: bold', projects);

        this.state.projects = projects || [];
        this.show();

        if (window.projectManager) {
            window.projectManager.currentProjects = projects;
        }

        console.log('[ProjectListComponent] User is authenticated, rendering projects');

        if (!projects || projects.length === 0) {
            this._showEmptyState();
            return;
        }

        this.element.innerHTML = '';
        const fragment = document.createDocumentFragment();

        projects.forEach((project) => {
            if (project && typeof project === 'object') {
                const card = this._createProjectCard(project);
                fragment.appendChild(card);
            }
        });

        this.element.appendChild(fragment);

        console.log(`[ProjectListComponent] Successfully rendered ${projects.length} project(s)`);

        // Advanced DOM validation/debugging - inject after render to trace issues
        setTimeout(() => {
            // 1. Assert the element is still in the visible DOM tree
            let el = this.element;
            let hierarchy = [];
            while (el) {
                hierarchy.push(el.id || el.className || el.tagName);
                if (el === document.body) break;
                el = el.parentElement;
            }
            console.log('[DEBUG] ProjectList element hierarchy:', hierarchy.reverse().join(' > '));

            // 2. Check for actual project cards
            const cards = this.element ? this.element.querySelectorAll('.project-card') : [];
            console.log('[DEBUG] Project card count (direct DOM):', cards.length);

            // 3. Check computed style; is it visible and not clipped?
            if (this.element) {
                const rect = this.element.getBoundingClientRect();
                const cs = window.getComputedStyle(this.element);
                console.log('[DEBUG] ProjectList bounding box:', rect, 'display:', cs.display, 'visibility:', cs.visibility, 'opacity:', cs.opacity);

                // 4. Log z-index and stacking context up the parent chain
                let zIdxLine = [];
                let node = this.element;
                while (node) {
                    zIdxLine.push(`${node.id || node.tagName}: z-index=${window.getComputedStyle(node).zIndex}`);
                    node = node.parentElement;
                }
                console.log('[DEBUG] Stacking context:', zIdxLine.join(' | '));
            }
        }, 250);
    }

    show() {
        console.log('[ProjectListComponent] Show method called');
        if (!this.element) {
            console.warn('[ProjectListComponent.show] Cannot show, element is null. Attempting to find...');
            this.element = document.getElementById(this.elementId);
            if (!this.element) {
                console.error('[ProjectListComponent.show] CRITICAL: Cannot show component, element not found.');
                return;
            }
        }
        // Unhide this.element
        this.element.classList.remove('hidden');
        this.element.style.display = '';

        // Unhide all ancestor containers up to and including #projectListView
        let parent = this.element.parentElement;
        while (parent) {
            if (parent.classList) {
                parent.classList.remove('hidden', 'opacity-0');
            }
            if (parent.style) {
                parent.style.display = '';
            }
            if (parent.id === "projectListView") break;
            parent = parent.parentElement;
        }

        const listView = document.getElementById('projectListView');
        if (listView) {
            listView.classList.remove('hidden', 'opacity-0');
            listView.style.display = '';
            void listView.offsetHeight;
        }
    }

    hide() {
        if (this.element) {
            this.element.classList.add('hidden');
        }
        const listView = document.getElementById('projectListView');
        if (listView) {
            listView.classList.add('hidden', 'opacity-0');
        }
    }

    // --------------------------------------
    // Project Loading
    // --------------------------------------

    async _loadProjects() {
        if (this.state.loading) return;
        if (!window.projectManager?.loadProjects) {
            console.warn('[ProjectListComponent] Cannot load projects, projectManager.loadProjects is missing.');
            return;
        }

        this.state.loading = true;
        this._showLoadingState();

        try {
            await window.projectManager.loadProjects(this.state.filter);
        } catch (error) {
            console.error('[ProjectListComponent] Error loading projects:', error);
            this._showErrorState('Failed to load projects');
        } finally {
            this.state.loading = false;
        }
    }

    // --------------------------------------
    // Event Handlers (Project CRUD)
    // --------------------------------------

    _handleCardClick(e) {
        const projectCard = e.target.closest('.project-card');
        if (!projectCard) return;

        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;
            const projectId = projectCard.dataset.projectId;
            console.log('[ProjectListComponent] Action button clicked:', action, projectId);
            this._handleAction(action, projectId);
            return;
        }

        const projectId = projectCard.dataset.projectId;
        if (projectId) {
            console.log('[ProjectListComponent] Card clicked => onViewProject:', projectId);
            this.onViewProject(projectId);
        }
    }

    _handleAction(action, projectId) {
        const project = this.state.projects.find((p) => p.id === projectId);
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

    _handleProjectCreated(project) {
        if (!project) return;
        this.state.projects.unshift(project);
        this.renderProjects(this.state.projects);
    }

    _handleProjectUpdated(updatedProject) {
        if (!updatedProject) return;
        const idx = this.state.projects.findIndex((p) => p.id === updatedProject.id);
        if (idx >= 0) {
            this.state.projects[idx] = updatedProject;
            this.renderProjects(this.state.projects);
        }
    }

    // --------------------------------------
    // Modals: Create/Edit Projects
    // --------------------------------------

    async _bindCreateProjectButtons() {
        await new Promise((resolve) => {
            const checkReady = () => {
                if (document.getElementById('projectModal') && window.projectModal) {
                    resolve();
                    return true;
                }
                return false;
            };
            if (checkReady()) return;

            const listener = () => {
                if (checkReady()) {
                    document.removeEventListener('modalsLoaded', listener);
                }
            };
            document.addEventListener('modalsLoaded', listener);

            const t0 = Date.now();
            const poll = () => {
                if (!checkReady() && Date.now() - t0 < 5000) {
                    setTimeout(poll, 100);
                }
            };
            poll();
        });

        console.log('[ProjectListComponent] Modals ready. Binding create project buttons.');

        const buttonIds = ['projectListCreateBtn', 'sidebarNewProjectBtn', 'emptyStateCreateBtn'];
        const maxAttempts = 5;

        const attach = (btn) => {
            if (!btn) return;
            const handler = (e) => {
                e.preventDefault();
                const pm = _getProjectModal();
                if (pm?.openModal) {
                    pm.openModal();
                } else {
                    console.error('[ProjectListComponent] projectModal.openModal not available.');
                }
            };
            if (window.eventHandlers?.trackListener) {
                window.eventHandlers.trackListener(btn, 'click', handler, {
                    description: `Open New Project Modal (${btn.id})`
                });
            } else {
                btn.addEventListener('click', handler);
            }
            console.log(`[ProjectListComponent] Attached listener to #${btn.id}`);
        };

        for (const id of buttonIds) {
            let attempts = 0;
            let btn = null;
            while (attempts < maxAttempts && !(btn = document.getElementById(id))) {
                attempts++;
                if (id === 'emptyStateCreateBtn' && attempts > 1) break;
                await new Promise((r) => setTimeout(r, 100 * attempts));
            }
            if (btn) {
                attach(btn);
            } else if (id !== 'emptyStateCreateBtn') {
                console.warn(`[ProjectListComponent] Could not find button #${id} after ${attempts} attempts.`);
            }
        }
    }

    _openNewProjectModal() {
        const pm = _getProjectModal();
        if (pm?.openModal) {
            pm.openModal();
        } else {
            console.error('[ProjectListComponent] projectModal.openModal not available');
        }
    }

    _openEditModal(project) {
        const pm = _getProjectModal();
        if (pm?.openModal) {
            pm.openModal(project);
        } else {
            console.error('[ProjectListComponent] projectModal.openModal not available');
        }
    }

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
            if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                this._executeDelete(project.id);
            }
        }
    }

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
            .catch((err) => {
                console.error('[ProjectListComponent] Failed to delete project:', err);
                window.app?.showNotification('Failed to delete project', 'error');
            });
    }

    // --------------------------------------
    // UI States
    // --------------------------------------

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
        const createBtn = document.getElementById('emptyStateCreateBtn');
        if (createBtn) {
            window.eventHandlers.trackListener(createBtn, 'click', () => this._openNewProjectModal(), {
                description: 'Empty State Create Project Button'
            });
        }
    }

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
        const loginBtn = document.getElementById('loginButton');
        if (loginBtn) {
            const handler = (e) => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('requestLogin'));
            };
            window.eventHandlers.trackListener(loginBtn, 'click', handler, {
                description: 'Login Required Login Button'
            });
        }
    }

    _showErrorState(message) {
        if (!this.element) return;
        const fallbackMsg = (typeof message === 'string' && message.trim()) ? message : "An unknown error occurred.";
        this.element.innerHTML = `
            <div class="col-span-3 text-center py-10">
              <svg class="w-16 h-16 mx-auto text-error/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <p class="mt-4 text-lg text-error">${fallbackMsg}</p>
              <button id="retryButton" class="btn btn-outline btn-error mt-4">Retry</button>
            </div>
        `;

        const retryBtn = document.getElementById('retryButton');
        if (retryBtn) {
            window.eventHandlers.trackListener(retryBtn, 'click', () => this._loadProjects(), {
                description: 'Project List Retry Button'
            });
        }
    }

    // --------------------------------------
    // Card Creation / Utilities
    // --------------------------------------

    _createProjectCard(project) {
        const theme = this.state.customization.theme || 'default';
        const themeBg = theme === 'default' ? 'bg-base-100' : `bg-${theme}`;
        const themeText = theme === 'default' ? 'text-base-content' : `text-${theme}-content`;

        const card = document.createElement('div');
        card.className = `project-card ${themeBg} ${themeText} shadow-md hover:shadow-lg transition-all duration-200 border border-base-300 rounded-box p-6 flex flex-col h-full`;
        card.dataset.projectId = project.id;
        card.setAttribute('role', 'article');
        card.setAttribute('aria-labelledby', `project-title-${project.id}`);

        const header = document.createElement('div');
        header.className = 'flex justify-between items-start';

        const title = document.createElement('h3');
        title.className = 'font-semibold text-xl mb-3 project-name';
        title.textContent = project.name || 'Unnamed Project';
        title.id = `project-title-${project.id}`;

        const actions = document.createElement('div');
        actions.className = 'flex gap-1';

        const actionButtons = [
            {
                action: 'view',
                icon: `
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                       viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0
                             8.268 2.943 9.542 7-1.274 4.057
                             -5.064 7-9.542 7-4.477 0-8.268
                             -2.943-9.542-7z"/>
                  </svg>`,
                title: 'View'
            },
            {
                action: 'edit',
                icon: `
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                       viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m
                             -1.414-9.414a2 2 0 112.828
                             2.828L11.828 15H9v-2.828l8.586
                             -8.586z"/>
                  </svg>`,
                title: 'Edit'
            },
            {
                action: 'delete',
                icon: `
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                       viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M19 7l-.867 12.142A2 2
                             0 0116.138 21H7.862a2 2 0
                             01-1.995-1.858L5 7m5 4v6m4
                             -6v6m1-10V4a1 1 0 00-1-1h
                             -4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>`,
                title: 'Delete',
                className: 'text-error hover:bg-error/10'
            }
        ];

        actionButtons.forEach((button) => {
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

        if (this.state.customization.showDescription && project.description) {
            const description = document.createElement('p');
            description.className = 'project-description text-sm text-base-content/80 mb-3 line-clamp-2';
            description.textContent = project.description;
            card.appendChild(description);
        }

        const footer = document.createElement('div');
        footer.className = 'mt-auto pt-2 flex justify-between text-xs text-base-content/70';

        if (this.state.customization.showDate && project.updated_at) {
            const dateEl = document.createElement('span');
            dateEl.textContent = this._formatDate(project.updated_at);
            footer.appendChild(dateEl);
        }

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

    _formatDate(dateString) {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString();
        } catch (err) {
            return dateString;
        }
    }

    _loadCustomization() {
        try {
            const saved = localStorage.getItem('projectCardsCustomization');
            return saved ? JSON.parse(saved) : this._getDefaultCustomization();
        } catch {
            return this._getDefaultCustomization();
        }
    }

    _getDefaultCustomization() {
        return {
            theme: 'default',
            showDescription: true,
            showDate: true,
            showBadges: true
        };
    }
}

// --------------------------------------
// Factory: createProjectListComponent
// --------------------------------------
export function createProjectListComponent(options = {}) {
    return new ProjectListComponent(options);
}

export { ProjectListComponent };

if (typeof window !== "undefined") {
    window.ProjectListComponent = ProjectListComponent;
}
