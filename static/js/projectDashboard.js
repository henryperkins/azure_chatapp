/**
 * projectDashboard.js
 *
 * Coordinates project dashboard components and state.
 *
 * ## Dependencies:
 * - window.app: Application core with state management and UI helpers.
 * - window.projectManager: Project management API.
 * - window.ProjectListComponent: Renders the project list.
 * - window.ProjectDetailsComponent: Renders project details.
 * - window.DependencySystem: Dependency injection/registration system.
 * - window.eventHandlers: Utility for debouncing.
 */

class ProjectDashboard {
  constructor() {
    // Patch: ensure we always (re)initialize after auth flips to true
    document.addEventListener('authStateChanged', (e) => {
      const { authenticated } = e.detail || {};
      // If the dashboard bailed out earlier, try again the moment we have auth
      if (authenticated && !this.state?.initialized) {
        console.log('[ProjectDashboard] Logged in – resuming initialization');
        this.initialize();          // Will load project_list.html etc.
      }
      // If we *are* initialized already just refresh the list
      else if (authenticated && this.state?.initialized) {
        this.showProjectList();     // makes sure list view is visible
        this._loadProjects?.();     // pulls projects from the API
      }
    });

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

    // Listen once: when auth flips to true and not initialized, re-run initialize and fetch projects
    document.addEventListener('authStateChanged', (e) => {
      if (e.detail?.authenticated && !this.state.initialized) {
        this.initialize();   // initializes the dashboard and reloads the project list UI
        window.projectManager?.loadProjects('all');
      }
    });
  }

  /**
   * Initialize the project dashboard.
   * Sets up components and event listeners.
   *
   * @returns {Promise<boolean>} - Resolves true if initialized, false otherwise.
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
      if (!window.app.state.isAuthenticated) {
        console.log('[ProjectDashboard] Not authenticated, waiting for login...');
        this._showLoginRequiredMessage();
        return false;
      }

      // Wait for DOM ready
      if (document.readyState === 'loading') {
        await new Promise(resolve =>
          document.addEventListener('DOMContentLoaded', resolve, { once: true })
        );
      }

      // NEW: Wait for main container (#projectListView) to exist before proceeding, retries up to 30x/3s
      await (async () => {
        for (let i = 0; i < 30; i++) {
          if (document.getElementById('projectListView')) return;
          await new Promise(r => setTimeout(r, 100));
        }
        throw new Error('Timeout waiting for #projectListView container in DOM during dashboard init');
      })();

      // Load required HTML content
      await this._loadProjectListHtml();

      // Initialize components
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
      window.app?.showNotification('Dashboard initialization failed', 'error');
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
      window.history.pushState({}, '', currentUrl.toString());
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
      await this._loadProjectDetailsHtml();
    } catch (err) {
      console.error('[ProjectDashboard] Error loading project details page:', err);
      window.app?.showNotification('Error loading project details UI', 'error');
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
    currentUrl.searchParams.set('project', projectId);
    window.history.pushState({}, '', currentUrl.toString());
    localStorage.setItem('selectedProjectId', projectId);

    // Load project data
    if (window.app.state.isAuthenticated && window.projectManager?.loadProjectDetails) {
      window.projectManager
        .loadProjectDetails(projectId)
        .then(project => {
          // If project load returns null/undefined, treat as not found
          if (!project) {
            console.warn('[ProjectDashboard] Project not found after details load');
            window.app?.showNotification('Project not found', 'error');
            localStorage.removeItem('selectedProjectId');
            this.showProjectList();
          }
        })
        .catch((error) => {
          console.error('[ProjectDashboard] Failed to load project details:', error);
          window.app?.showNotification('Failed to load project details', 'error');
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
    const projectViews = document.querySelectorAll('#projectListView, #projectDetailsView');
    projectViews.forEach(view => view.classList.add('hidden'));
  }

  /**
   * Loads the project list HTML into #projectListView if not already present.
   * @returns {Promise<void>}
   * @throws {Error} If the container is missing or fetch fails.
   * @private
   */
  async _loadProjectListHtml() {
    const container = document.getElementById('projectListView');
    if (!container) {
      console.error('[ProjectDashboard] projectListView container not found in DOM.');
      throw new Error('Missing projectListView container');
    }

    // Always load and set value—never shortcut if #projectList is present, to ensure proper markup and listeners
    console.log('[ProjectDashboard] Loading project_list.html...');
    try {
      const response = await fetch('/static/html/project_list.html');
      if (!response.ok) {
        console.error('[ProjectDashboard] Failed to load project_list.html. Status:', response.status);
        container.innerHTML = '<p class="text-error text-center">Error loading project list UI.</p>';
        throw new Error("HTTP " + response.status);
      }

      const html = await response.text();
      container.innerHTML = html;
      console.log('[ProjectDashboard] project_list.html loaded successfully.');
    } catch (err) {
      console.error('[ProjectDashboard] Error fetching project_list.html:', err);
      container.innerHTML = '<p class="text-error text-center">Error loading project list UI.</p>';
      throw err;
    }
  }

  /**
   * Loads the project details HTML into #projectDetailsView if not already present.
   * @returns {Promise<void>}
   * @throws {Error} If the container is missing or fetch fails.
   * @private
   */
  async _loadProjectDetailsHtml() {
    const container = document.getElementById('projectDetailsView');
    if (!container) {
      console.error('[ProjectDashboard] projectDetailsView container not found in DOM.');
      throw new Error('Missing projectDetailsView container');
    }

    // Avoid reloading if already present
    if (container.querySelector('#detailsTab')) {
      console.log('[ProjectDashboard] project_details.html is already loaded.');
      return;
    }

    console.log('[ProjectDashboard] Loading project_details.html...');
    try {
      const response = await fetch('/static/html/project_details.html');
      if (!response.ok) {
        console.error('[ProjectDashboard] Failed to load project_details.html. Status:', response.status);
        container.innerHTML = '<p class="text-error text-center">Error loading project details UI.</p>';
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      container.innerHTML = html;
      console.log('[ProjectDashboard] project_details.html loaded successfully.');
    } catch (err) {
      console.error('[ProjectDashboard] Error fetching project_details.html:', err);
      container.innerHTML = '<p class="text-error text-center">Error loading project details UI.</p>';
      throw err;
    }
  }

  /**
   * Initializes dashboard components (list and details).
   * @returns {Promise<void>}
   * @private
   */
  async _initializeComponents() {
    console.log('[ProjectDashboard] Initializing components...');

    // Ensure DOM updates complete if markup was dynamically injected
    await new Promise(requestAnimationFrame);

    // Ensure #projectList exists before building component (addresses async DOM issue)
    await (async () => {
      for (let i = 0; i < 30; i++) {
        if (document.getElementById('projectList')) return;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('Timeout waiting for #projectList in DOM during dashboard component init');
    })();

    // Project list component
    if (window.ProjectListComponent) {
      this.components.projectList = new window.ProjectListComponent({
        elementId: 'projectList',
        onViewProject: this._handleViewProject.bind(this)
      });
      await this.components.projectList.initialize();
      console.log('[ProjectDashboard] ProjectListComponent created and initialized.');
    } else {
      console.error('[ProjectDashboard] ProjectListComponent not found on window.');
    }

    // Project details component
    if (window.ProjectDetailsComponent) {
      this.components.projectDetails = new window.ProjectDetailsComponent({
        onBack: this._handleBackToList.bind(this)
      });
      console.log('[ProjectDashboard] ProjectDetailsComponent created.');
    } else {
      console.error('[ProjectDashboard] ProjectDetailsComponent not found on window.');
    }

    console.log('[ProjectDashboard] Components initialized.');
  }

  /**
   * Processes URL parameters and localStorage to determine initial dashboard view.
   * @private
   */
  _processUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    let projectId = urlParams.get('project');

    // Optionally restore last selected project from localStorage
    if (!projectId) {
      projectId = localStorage.getItem('selectedProjectId');
    }

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
    if (window.app.state.isAuthenticated && window.projectManager?.loadProjects) {
      window.projectManager.loadProjects('all');
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
        this.components.projectList.renderProjects(projects);
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

    window.app?.showNotification('The requested project was not found', 'error');
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
