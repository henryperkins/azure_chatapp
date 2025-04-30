/**
 * projectDashboard.js
 *
 * Coordinates project dashboard components and state, interacting exclusively
 * via DependencySystem for all dependencies. No global/window.* access for shared modules.
 *
 * ## Dependencies (all via DependencySystem):
 * - app: Core app module (state mgmt, notifications, utilities)
 * - projectManager: Project management API
 * - ProjectListComponent: Renders the project list
 * - ProjectDetailsComponent: Renders project details
 * - eventHandlers: Utility for event listener tracking/cleanup (if applicable)
 * - auth: Auth module (and AuthBus for state events)
 *
 * ## Initialization/Integration contract:
 * - The orchestrator (e.g., app.js) is responsible for:
 *     - Registering all required modules/components before constructing ProjectDashboard.
 *     - Ensuring main dashboard containers (#projectListView, #projectDetailsView) exist in the DOM before initialization.
 *     - Injecting any required HTML content into containers beforehand.
 * - ProjectDashboard only binds listeners, manages its own state, and coordinates component logic/UI—never fetching or injecting HTML itself.
 */

/**
 * ProjectDashboard
 *
 * Coordinates project dashboard components and state using DependencySystem only.
 * All dependencies are injected via DependencySystem. No global/window access except when required by browser APIs.
 */
class ProjectDashboard {
  constructor() {
    // Dependency references (set in initialize, not accessed via window)
    this.DependencySystem = window.DependencySystem;
    if (!this.DependencySystem) {
      throw new Error('DependencySystem not available for ProjectDashboard');
    }

    // Get all core dependencies once at construction
    this.app = this.DependencySystem.modules.get('app');
    this.projectManager = this.DependencySystem.modules.get('projectManager');
    this.ProjectListComponent = this.DependencySystem.modules.get('ProjectListComponent');
    this.ProjectDetailsComponent = this.DependencySystem.modules.get('ProjectDetailsComponent');
    this.eventHandlers = this.DependencySystem.modules.get('eventHandlers');
    this.auth = this.DependencySystem.modules.get('auth');

    // Component references
    this.components = {
      projectList: null,
      projectDetails: null
    };

    // Dashboard state
    this.state = {
      currentView: null,      // 'list' or 'details'
      currentProject: null,   // Project ID or null
      initialized: false      // Initialization flag
    };

    // Attach listener for authentication state via AuthBus (DependencySystem only)
    const authBus = this.auth?.AuthBus;
    const handler = (e) => {
      const { authenticated } = e.detail || {};
      if (!authenticated) return;
      if (!this.state.initialized) {
        console.log('[ProjectDashboard] Authenticated – initializing dashboard');
        this.initialize();
        this.projectManager?.loadProjects('all');
      } else {
        console.log('[ProjectDashboard] Authenticated – refreshing project list');
        this.showProjectList();
        this._loadProjects();
      }
    };
    if (authBus && typeof authBus.addEventListener === 'function') {
      authBus.addEventListener('authStateChanged', handler);
    } else {
      // For rare/legacy fallback, listen on document
      document.addEventListener('authStateChanged', handler);
    }
  }

  /**
   * Initialize the project dashboard.
   * Sets up components and event listeners.
   *
   * @returns {Promise<boolean>} - Resolves true if initialized , false otherwise.
   */
  async initialize() {
    // Prevent multiple initializations
    if (this.state.initialized) {
      console.log('[ProjectDashboard] Already initialized.');
      return true;
    }

    console.log('[ProjectDashboard] Initializing...');

    try {
      // Check authentication - using centralized app state
      if (!this.app.state.isAuthenticated) {
        console.log('[ProjectDashboard] Not authenticated, waiting for login...');
        this._showLoginRequiredMessage();
        return false;
      }

      // Fail immediately if required containers are not present
      const listView = document.getElementById('projectListView');
      if (!listView) {
        throw new Error('Missing required #projectListView container during initialization');
      }

      // Initialize components (assume HTML is already injected by orchestrator)
      await this._initializeComponents();

      // Process URL parameters for initial view
      this._processUrlParameters();

      // Set up event listeners
      this._setupEventListeners();

      // Mark as initialized
      this.state.initialized = true;

      // Dispatch dashboard initialized event
      document.dispatchEvent(
        new CustomEvent('projectDashboardInitializedEvent', { detail: { success: true } })
      );

      console.log('[ProjectDashboard] Initialization complete.');
      return true;
    } catch (error) {
      console.error('[ProjectDashboard] Initialization failed:', error);
      this.app?.showNotification('Dashboard initialization failed', 'error');
      this.state.initialized = false;
      document.dispatchEvent(
        new CustomEvent('projectDashboardInitializedEvent', { detail: { success: false, error } })
      );
      return false;
    }
  }

  /**
   * Show the project list view and hide details.
   */
  showProjectList() {
    console.log('[ProjectDashboard] Showing project list view');

    // Clear state
    this.state.currentView = 'list';
    this.state.currentProject = null;

    // Aggressively clear localStorage for robustness
    localStorage.removeItem('selectedProjectId');

    // Update URL (remove project param) - do this FIRST
    const currentUrl = new URL(window.location);
    if (currentUrl.searchParams.has('project')) {
      currentUrl.searchParams.delete('project');
      window.history.replaceState({}, '', currentUrl.toString());
      console.log('[ProjectDashboard] Cleared project param from URL');
    }

    // DOM-level, ARIA, and CSS toggles: ONLY #projectListView visible, details truly hidden
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');

    // Hide details view first
    if (detailsView) {
      detailsView.classList.add('hidden');
      detailsView.setAttribute('aria-hidden', 'true');
      detailsView.style.display = 'none';
      console.log('[ProjectDashboard] Details view hidden');
    }

    // Then show list view
    if (listView) {
      listView.classList.remove('hidden', 'opacity-0');
      listView.setAttribute('aria-hidden', 'false');
      listView.style.display = '';
      console.log('[ProjectDashboard] List view shown');
    }

    // Components visibility control
    if (this.components.projectDetails) {
      this.components.projectDetails.hide();
    }

    if (this.components.projectList) {
      this.components.projectList.show();
      console.log('[ProjectDashboard] ProjectList component shown');
    } else {
      console.warn('[ProjectDashboard] ProjectList component not available');
    }

    // Load projects (debounced if available)
    this._loadProjects();

    // Force a redraw for browsers that might have rendering issues
    setTimeout(() => {
      if (listView) {
        listView.style.display = 'none';
        // Force a reflow
        void listView.offsetHeight;
        listView.style.display = '';
      }
    }, 50);
  }

  /**
   * Shows the project details view for a given project.
   * Loads HTML, updates URL, and triggers data load.
   *
   * @param {string} projectId - The project ID to show.
   * @returns {Promise<boolean>} - Resolves true if successful, false if error.
   */
  async showProjectDetails(projectId) {
    if (!projectId) {
      console.error('[ProjectDashboard] showProjectDetails called without a projectId.');
      // If no project id, forcibly clear any stale selectedProjectId and show list
      localStorage.removeItem('selectedProjectId');
      this.showProjectList();
      return false;
    }

    this.state.currentView = 'details';
    this.state.currentProject = projectId;

    try {
      // Component HTML is assumed to be already present by orchestrator

      // Ensure ProjectDetailsComponent is initialized *after* the HTML exists (run only once)
      if (this.components.projectDetails &&
          !this.components.projectDetails.state?.initialized) {
        await this.components.projectDetails.initialize();
      }
    } catch (err) {
      console.error('[ProjectDashboard] Error loading project details page:', err);
      this.app?.showNotification('Error loading project details UI', 'error');
      localStorage.removeItem('selectedProjectId');
      this.showProjectList();
      return false;
    }

    // Dom-level, ARIA, and CSS toggles: ONLY #projectDetailsView visible, list truly hidden
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');
    if (listView) {
      listView.classList.add('hidden');
      listView.setAttribute('aria-hidden', 'true');
      listView.style.display = 'none';
    }
    if (detailsView) {
      detailsView.classList.remove('hidden', 'opacity-0');
      detailsView.setAttribute('aria-hidden', 'false');
      detailsView.style.display = '';
    }

    if (this.components.projectList) {
      this.components.projectList.hide();
    }
    if (this.components.projectDetails) {
      this.components.projectDetails.show();
    }

    // Update URL and localStorage
    const currentUrl = new URL(window.location.href);
    const existingId = currentUrl.searchParams.get('project');

    // Only change history if the target ID actually differs
    if (existingId !== projectId) {
      currentUrl.searchParams.set('project', projectId);
      // replaceState avoids growing the stack when navigating within SPA
      window.history.replaceState({}, '', currentUrl.toString());
    }
    localStorage.setItem('selectedProjectId', projectId);

    // Load project data
    if (this.app.state.isAuthenticated && this.projectManager?.loadProjectDetails) {
      this.projectManager
        .loadProjectDetails(projectId)
        .then(project => {
          // treat explicit 404 / error only; ignore empty objects returned by unrelated calls
          if (!project || (typeof project === 'object' && Object.keys(project).length === 0)) {
            console.warn('[ProjectDashboard] Project not found after details load');
            this.app?.showNotification('Project not found', 'error');
            localStorage.removeItem('selectedProjectId');
            this.showProjectList();
          }
        })
        .catch((error) => {
          console.error('[ProjectDashboard] Failed to load project details:', error);
          this.app?.showNotification('Failed to load project details', 'error');
          localStorage.removeItem('selectedProjectId');
          this.showProjectList();
        });
    } else {
      localStorage.removeItem('selectedProjectId');
      this.showProjectList();
    }

    return true;
  }

  // ======================
  // PRIVATE METHODS
  // ======================

  /**
   * Shows a login required message and hides dashboard views.
   * @private
   */
  _showLoginRequiredMessage() {
    const loginMessage = document.getElementById('loginRequiredMessage');
    if (loginMessage) {
      loginMessage.classList.remove('hidden');
    }
    // Accessibility: If focus is within the sidebar, blur it before hiding
    const sidebar = document.getElementById('mainSidebar');
    if (sidebar && sidebar.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    const projectViews = document.querySelectorAll('#projectListView, #projectDetailsView');
    projectViews.forEach(view => view.classList.add('hidden'));
  }

  // No-op: HTML loading should be orchestrated by the parent module.
  _loadProjectListHtml() {
    throw new Error('[ProjectDashboard] HTML loading responsibility has been moved to the orchestrator. This method should not be called.');
  }
  _loadProjectDetailsHtml() {
    throw new Error('[ProjectDashboard] HTML loading responsibility has been moved to the orchestrator. This method should not be called.');
  }

  /**
   * Initializes dashboard components (list and details).
   * @returns {Promise<void>}
   * @private
   */
  async _initializeComponents() {
    console.log('[ProjectDashboard] Initializing components...');

    // Ensure #projectList is present in the DOM before initializing the component
    const projectListEl = document.getElementById('projectList');
    if (!projectListEl) {
      throw new Error('Missing #projectList element in DOM after injecting project_list.html');
    }

    // Project list component
    if (this.ProjectListComponent) {
      this.components.projectList = new this.ProjectListComponent({
        elementId: 'projectList',
        onViewProject: this._handleViewProject.bind(this)
      });
      try {
        await this.components.projectList.initialize();
        console.log('[ProjectDashboard] ProjectListComponent created and initialized.');
      } catch (err) {
        console.error('[ProjectDashboard] ProjectListComponent failed to initialize:', err);
        throw new Error('ProjectListComponent failed to initialize.');
      }
    } else {
      console.error('[ProjectDashboard] ProjectListComponent not found (DependencySystem).');
    }

    // Project details component
    if (this.ProjectDetailsComponent) {
      this.components.projectDetails = new this.ProjectDetailsComponent({
        onBack: this._handleBackToList.bind(this)
      });
      console.log('[ProjectDashboard] ProjectDetailsComponent created.');
    } else {
      console.error('[ProjectDashboard] ProjectDetailsComponent not found (DependencySystem).');
    }

    console.log('[ProjectDashboard] Components initialized.');

    // (No event replay/caching needed: orchestrator is responsible for correct event timing/data refresh)
  }

  /**
   * Processes URL parameters and localStorage to determine initial dashboard view.
   * @private
   */
  _processUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');

    // Always ignore localStorage for initial view, only respect explicit ?project= param
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  }

  /**
   * Sets up global event listeners for dashboard events and navigation.
   * @private
   */
  _setupEventListeners() {
    // Project events
    document.addEventListener('projectsLoaded', this._handleProjectsLoaded.bind(this));
    document.addEventListener('projectLoaded', this._handleProjectLoaded.bind(this));
    document.addEventListener('projectStatsLoaded', this._handleProjectStatsLoaded.bind(this));
    document.addEventListener('projectFilesLoaded', this._handleFilesLoaded.bind(this));
    document.addEventListener('projectArtifactsLoaded', this._handleArtifactsLoaded.bind(this));
    document.addEventListener('projectNotFound', this._handleProjectNotFound.bind(this));

    // Always navigate to new project after creation
    document.addEventListener('projectCreated', this._handleProjectCreated.bind(this));

    // URL navigation
    window.addEventListener('popstate', this._handlePopState.bind(this));

    // Auth state changes
    document.addEventListener('authStateChanged', this._handleAuthStateChange.bind(this));
  }

  /**
   * Handles the 'projectCreated' event.
   * Navigates to project details and stores selection in localStorage.
   * @param {CustomEvent} e
   * @private
   */
  _handleProjectCreated(e) {
    const project = e.detail;
    console.log('[ProjectDashboard] Project created:', project);

    // Load project details immediately
    this.showProjectDetails(project.id);

    // Store in local storage
    localStorage.setItem('selectedProjectId', project.id);
  }

  /**
   * Load projects helper - ensures component is available
   * @private
   */
  _loadProjects() {
    console.log('[ProjectDashboard] Loading projects...');

    // Check authentication from centralized state
    if (!this.app?.state?.isAuthenticated) {
      console.warn('[ProjectDashboard] Not authenticated, cannot load projects');
      return;
    }

    // Ensure projectManager is available
    if (!this.projectManager?.loadProjects) {
      console.error('[ProjectDashboard] Cannot load projects: projectManager.loadProjects not available');
      return;
    }

    try {
      // Load projects with a slight delay to ensure DOM is ready
      setTimeout(() => {
        this.projectManager.loadProjects('all')
          .catch(error => {
            console.error('[ProjectDashboard] Error loading projects:', error);
          });
      }, 100);
    } catch (error) {
      console.error('[ProjectDashboard] Exception during project loading:', error);
    }
  }

  /**
   * Handles browser navigation (back/forward) by re-processing URL parameters.
   * @private
   */
  _handlePopState() {
    this._processUrlParameters();
  }

  /**
   * Callback for ProjectListComponent when a project is selected.
   * @param {string} projectId - The selected project ID.
   * @private
   */
  _handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }

  /**
   * Callback for ProjectDetailsComponent when user navigates back.
   * @private
   */
  _handleBackToList() {
    this.showProjectList();
  }

  /**
   * Handles authentication state changes.
   * Shows/hides dashboard views and always reloads projects list after login.
   * @param {CustomEvent} event - The auth state change event.
   * @private
   */
  _handleAuthStateChange(event) {
    const { authenticated } = event.detail || {};

    requestAnimationFrame(() => {
      const loginRequiredMessage = document.getElementById('loginRequiredMessage');
      const projectListView = document.getElementById('projectListView');
      const projectDetailsView = document.getElementById('projectDetailsView');

      if (!authenticated) {
        if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
        if (projectListView) projectListView.classList.add('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');
      } else {
        if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');

        // Always clear selected project and show project list after login
        localStorage.removeItem('selectedProjectId');
        this.state.currentView = 'list';
        this.state.currentProject = null;

        // Remove any lingering ?project param from URL to ensure list view
        const url = new URL(window.location);
        if (url.searchParams.has('project')) {
          url.searchParams.delete('project');
          window.history.replaceState({}, '', url.toString());
        }

        if (projectListView) projectListView.classList.remove('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');

        // Make sure components are initialized if they weren't already
        if (!this.components.projectList || !this.components.projectList.initialized) {
          console.log('[ProjectDashboard] Components not initialized after auth, reinitializing...');
          this._initializeComponents().then(() => {
            if (this.components.projectList) {
              this.components.projectList.show();
              this._loadProjects();
            }
          });
        } else {
          // Show and load
          if (this.components.projectList) {
            this.components.projectList.show();
          }
          if (this.components.projectDetails) {
            this.components.projectDetails.hide();
          }

          // Load projects with a sufficient delay to ensure DOM is ready
          setTimeout(() => {
            console.log('[ProjectDashboard] Loading projects after authentication state change');
            this._loadProjects();

            // Verify project list element is visible and update opacity
            const projectListView = document.getElementById('projectListView');
            if (projectListView) {
              projectListView.classList.remove('opacity-0');
            }
          }, 300);
        }
      }
    });
  }

  /**
   * Handles the 'projectsLoaded' event.
   * Renders the project list or shows an error.
   * @param {CustomEvent} event
   * @private
   */
  _handleProjectsLoaded(event) {
    const { projects = [], error = false, message } = event.detail || {};

    if (error) {
      console.error('[ProjectDashboard] projectsLoaded event with error:', message);
      requestAnimationFrame(() => {
        if (this.components.projectList?._showErrorState) {
          this.components.projectList._showErrorState(message || 'Failed to load projects');
        }
      });
      return;
    }

    requestAnimationFrame(() => {
      if (this.components.projectList) {
        console.log("[ProjectDashboard] Rendering " + projects.length + " project(s).");
        this.components.projectList.renderProjects({ projects });
      } else {
        console.warn('[ProjectDashboard] ProjectListComponent not available to render projects.');
      }
    });
  }

  /**
   * Handles the 'projectLoaded' event.
   * Renders the project details.
   * @param {CustomEvent} event
   * @private
   */
  _handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project?.id || null;

    requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderProject(project);
      }
    });
  }

  /**
   * Handles the 'projectStatsLoaded' event.
   * Renders project statistics.
   * @param {CustomEvent} event
   * @private
   */
  _handleProjectStatsLoaded(event) {
    const stats = event.detail;
    requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderStats(stats);
      }
    });
  }

  /**
   * Handles the 'projectFilesLoaded' event.
   * Renders project files.
   * @param {CustomEvent} event
   * @private
   */
  _handleFilesLoaded(event) {
    requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderFiles(event.detail.files);
      }
    });
  }

  /**
   * Handles the 'projectArtifactsLoaded' event.
   * Renders project artifacts.
   * @param {CustomEvent} event
   * @private
   */
  _handleArtifactsLoaded(event) {
    requestAnimationFrame(() => {
      if (this.components.projectDetails?.renderArtifacts) {
        this.components.projectDetails.renderArtifacts(event.detail.artifacts);
      }
    });
  }

  /**
   * Handles the 'projectNotFound' event.
   * Shows a notification and returns to the project list.
   * @param {CustomEvent} event
   * @private
   */
  _handleProjectNotFound(event) {
    const { projectId } = event.detail || {};
    console.warn("[ProjectDashboard] Project not found: " + projectId);

    this.state.currentProject = null;
    localStorage.removeItem('selectedProjectId');

    // Force reset the UI
    const detailsView = document.getElementById('projectDetailsView');
    if (detailsView) {
      detailsView.classList.add('hidden');
      detailsView.style.display = 'none';
    }

    this.app?.showNotification('The requested project was not found', 'error');
    this.showProjectList();
  }
}

/**
 * Factory function to create a new ProjectDashboard instance.
 * @returns {ProjectDashboard} A new ProjectDashboard instance.
 */
export function createProjectDashboard() {
  return new ProjectDashboard();
}

// For backward compatibility and module registration, app.js will use this code
// instead of having the module self-initialize:
/*
const projectDashboard = createProjectDashboard();
window.projectDashboard = projectDashboard;
DependencySystem.register('projectDashboard', projectDashboard);
*/

export default createProjectDashboard;
