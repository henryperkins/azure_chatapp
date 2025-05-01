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

class ProjectDashboard {
  constructor() {
    // Dependency references (support both PascalCase/camelCase for orchestrator compatibility)
    this.DependencySystem = window.DependencySystem;
    if (!this.DependencySystem) {
      throw new Error('DependencySystem not available for ProjectDashboard');
    }

    // Flexible DI resolution (align with orchestrator registration style)
    const getModule = (key) =>
      this.DependencySystem.modules.get(key) ||
      this.DependencySystem.modules.get(key.charAt(0).toLowerCase() + key.slice(1));
    this.getModule = getModule;

    this.app = getModule('app');
    this.projectManager = getModule('projectManager');
    // Use the already-registered instance for ProjectListComponent
    this.components = { projectList: null, projectDetails: null };
    this.ProjectDetailsComponent = getModule('ProjectDetailsComponent');
    this.eventHandlers = getModule('eventHandlers');
    this.auth = getModule('auth');

    this.state = {
      currentView: null,      // 'list' or 'details'
      currentProject: null,   // Project ID or null
      initialized: false
    };

    this._unsubs = []; // For listener cleanup if needed

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
    const eventTarget = (authBus && typeof authBus.addEventListener === 'function') ? authBus : document;
    const description = (eventTarget === authBus)
      ? 'ProjectDashboard: authStateChanged (AuthBus)'
      : 'ProjectDashboard: authStateChanged (doc)';

    if (!this.eventHandlers?.trackListener) {
      throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for authentication event binding');
    }
    this.eventHandlers.trackListener(eventTarget, 'authStateChanged', handler, { description });
    this._unsubs.push(() => eventTarget.removeEventListener('authStateChanged', handler));
  }

  /**
   * Initialize the project dashboard.
   * Sets up components and event listeners.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (this.state.initialized) {
      console.log('[ProjectDashboard] Already initialized.');
      return true;
    }
    console.log('[ProjectDashboard] Initializing...');

    try {
      if (!this.app.state.isAuthenticated) {
        console.log('[ProjectDashboard] Not authenticated, waiting for login...');
        this._showLoginRequiredMessage();
        return false;
      }
      const listView = document.getElementById('projectListView');
      if (!listView) {
        throw new Error('Missing required #projectListView container during initialization');
      }
      await this._initializeComponents();
      this._processUrlParameters();
      this._setupEventListeners();
      this.state.initialized = true;
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized', { detail: { success: true } }));
      console.log('[ProjectDashboard] Initialization complete.');
      return true;
    } catch (error) {
      console.error('[ProjectDashboard] Initialization failed:', error);
      this.app?.showNotification('Dashboard initialization failed', 'error');
      this.state.initialized = false;
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized', { detail: { success: false, error } }));
      return false;
    }
  }

  /**
   * Destroy dashboard listeners and clean up (optional; for SPA or teardown support).
   */
  cleanup() {
    if (this._unsubs && this._unsubs.length) {
      this._unsubs.forEach(unsub => typeof unsub === 'function' && unsub());
      this._unsubs = [];
    }
    if (this.eventHandlers?.cleanupListeners) {
      // Remove any listeners registered using trackListener
      this.eventHandlers.cleanupListeners();
    }
  }

  /**
   * Show the project list view and hide details.
   */
  showProjectList() {
    console.log('[ProjectDashboard] Showing project list view');
    this.state.currentView = 'list';
    this.state.currentProject = null;
    localStorage.removeItem('selectedProjectId');

    // Remove ?project param from URL
    const currentUrl = new URL(window.location);
    if (currentUrl.searchParams.has('project')) {
      currentUrl.searchParams.delete('project');
      window.history.replaceState({}, '', currentUrl.toString());
      console.log('[ProjectDashboard] Cleared project param from URL');
    }

    this._setView({ showList: true, showDetails: false });

    if (this.components.projectDetails) this.components.projectDetails.hide();
    if (this.components.projectList) {
      this.components.projectList.show();
      console.log('[ProjectDashboard] ProjectList component shown');
    } else {
      console.warn('[ProjectDashboard] ProjectList component not available');
    }
    this._loadProjects();

    setTimeout(() => {
      const listView = document.getElementById('projectListView');
      if (listView) {
        listView.style.display = 'none'; void listView.offsetHeight; listView.style.display = '';
      }
    }, 50);
  }

  /**
   * Shows the project details view for a given project.
   * Loads HTML, updates URL, and triggers data load.
   * @param {string} projectId
   * @returns {Promise<boolean>}
   */
  async showProjectDetails(projectId) {
    // Validate with app/UUID helper if present
    if (!projectId || (this.app.validateUUID && !this.app.validateUUID(projectId))) {
      this.app?.showNotification?.('Invalid project ID', 'error');
      this.showProjectList();
      return false;
    }
    this.state.currentView = 'details';
    this.state.currentProject = projectId;

    try {
      if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
        await this.components.projectDetails.initialize();
      }
    } catch (err) {
      console.error('[ProjectDashboard] Error loading project details page:', err);
      this.app?.showNotification('Error loading project details UI', 'error');
      localStorage.removeItem('selectedProjectId');
      this.showProjectList();
      return false;
    }

    this._setView({ showList: false, showDetails: true });

    if (this.components.projectList) this.components.projectList.hide();
    if (this.components.projectDetails) this.components.projectDetails.show();

    const currentUrl = new URL(window.location.href);
    const existingId = currentUrl.searchParams.get('project');
    if (existingId !== projectId) {
      currentUrl.searchParams.set('project', projectId);
      window.history.replaceState({}, '', currentUrl.toString());
    }
    localStorage.setItem('selectedProjectId', projectId);

    if (this.app.state.isAuthenticated && this.projectManager?.loadProjectDetails) {
      try {
        const project = await this.projectManager.loadProjectDetails(projectId);
        if (!project) {
          console.warn('[ProjectDashboard] Project not found after details load');
          this.app?.showNotification('Project not found', 'error');
          localStorage.removeItem('selectedProjectId');
          this.showProjectList();
        }
      } catch (error) {
        console.error('[ProjectDashboard] Failed to load project details:', error);
        this.app?.showNotification('Failed to load project details', 'error');
        localStorage.removeItem('selectedProjectId');
        this.showProjectList();
      }
    } else {
      localStorage.removeItem('selectedProjectId');
      this.showProjectList();
    }

    return true;
  }

  // ============= PRIVATE UTILITY METHODS =============

  _setView({ showList, showDetails }) {
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');
    if (listView) {
      listView.classList.toggle('hidden', !showList);
      listView.setAttribute('aria-hidden', (!showList).toString());
      listView.style.display = showList ? '' : 'none';
      if (showList) listView.classList.remove('opacity-0');
    }
    if (detailsView) {
      detailsView.classList.toggle('hidden', !showDetails);
      detailsView.setAttribute('aria-hidden', (!showDetails).toString());
      detailsView.style.display = showDetails ? '' : 'none';
      if (showDetails) detailsView.classList.remove('opacity-0');
    }
  }

  _showLoginRequiredMessage() {
    const loginMessage = document.getElementById('loginRequiredMessage');
    if (loginMessage) loginMessage.classList.remove('hidden');
    const sidebar = document.getElementById('mainSidebar');
    if (sidebar && sidebar.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    const projectViews = document.querySelectorAll('#projectListView, #projectDetailsView');
    projectViews.forEach(view => view.classList.add('hidden'));
  }

  _loadProjectListHtml() { throw new Error('[ProjectDashboard] HTML loading responsibility has been moved to the orchestrator. This method should not be called.'); }
  _loadProjectDetailsHtml() { throw new Error('[ProjectDashboard] HTML loading responsibility has been moved to the orchestrator. This method should not be called.'); }

  async _initializeComponents() {
    console.log('[ProjectDashboard] Initializing components...');
    // Ensure #projectList is present in the DOM before initializing the component
    const projectListEl = document.getElementById('projectList');
    if (!projectListEl) throw new Error('Missing #projectList element in DOM after injecting project_list.html');

    // Use the already-registered instance for ProjectListComponent
    this.components.projectList = this.getModule('projectListComponent');
    if (this.components.projectList) {
      // Optionally set the onViewProject callback if needed:
      this.components.projectList.onViewProject = this._handleViewProject.bind(this);
      // Optionally call initialize if not already done:
      if (!this.components.projectList.state?.initialized) {
        await this.components.projectList.initialize();
        console.log('[ProjectDashboard] ProjectListComponent initialized.');
      }
    } else {
      console.error('[ProjectDashboard] projectListComponent not found (DependencySystem).');
    }

    if (this.ProjectDetailsComponent) {
      this.components.projectDetails = new this.ProjectDetailsComponent({
        onBack: this._handleBackToList.bind(this)
      });
      console.log('[ProjectDashboard] ProjectDetailsComponent created.');
    } else {
      console.error('[ProjectDashboard] ProjectDetailsComponent not found (DependencySystem).');
    }
    console.log('[ProjectDashboard] Components initialized.');
  }

  _processUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  }

  _setupEventListeners() {
    // Only allow eventHandlers.trackListener for event registration; fail-fast if unavailable
    const add = (el, event, handler, opts = {}) => {
      if (!this.eventHandlers?.trackListener) {
        throw new Error("[ProjectDashboard] eventHandlers.trackListener is required for event binding");
      }
      this.eventHandlers.trackListener(el, event, handler, opts);
      this._unsubs.push(() => el.removeEventListener(event, handler, opts));
    };

    add(document, 'projectsLoaded', this._handleProjectsLoaded.bind(this));
    add(document, 'projectLoaded', this._handleProjectLoaded.bind(this));
    add(document, 'projectStatsLoaded', this._handleProjectStatsLoaded.bind(this));
    add(document, 'projectFilesLoaded', this._handleFilesLoaded.bind(this));
    add(document, 'projectArtifactsLoaded', this._handleArtifactsLoaded.bind(this));
    add(document, 'projectNotFound', this._handleProjectNotFound.bind(this));
    add(document, 'projectCreated', this._handleProjectCreated.bind(this));
    add(window, 'popstate', this._handlePopState.bind(this));
    add(document, 'authStateChanged', this._handleAuthStateChange.bind(this));
  }

  _handleProjectCreated(e) {
    const project = e.detail;
    console.log('[ProjectDashboard] Project created:', project);
    this.showProjectDetails(project.id);
    localStorage.setItem('selectedProjectId', project.id);
  }

  _loadProjects() {
    console.log('[ProjectDashboard] Loading projects...');
    if (!this.app?.state?.isAuthenticated) {
      console.warn('[ProjectDashboard] Not authenticated, cannot load projects');
      return;
    }
    if (!this.projectManager?.loadProjects) {
      console.error('[ProjectDashboard] Cannot load projects: projectManager.loadProjects not available');
      return;
    }
    setTimeout(() => {
      this.projectManager.loadProjects('all')
        .catch(error => console.error('[ProjectDashboard] Error loading projects:', error));
    }, 100);
  }

  _handlePopState() { this._processUrlParameters(); }

  _handleViewProject(projectId) { this.showProjectDetails(projectId); }

  _handleBackToList() { this.showProjectList(); }

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
        localStorage.removeItem('selectedProjectId');
        this.state.currentView = 'list';
        this.state.currentProject = null;
        const url = new URL(window.location);
        if (url.searchParams.has('project')) {
          url.searchParams.delete('project');
          window.history.replaceState({}, '', url.toString());
        }
        if (projectListView) projectListView.classList.remove('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');
        if (!this.components.projectList || !this.components.projectList.initialized) {
          console.log('[ProjectDashboard] Components not initialized after auth, reinitializing...');
          this._initializeComponents().then(() => {
            if (this.components.projectList) {
              this.components.projectList.show();
              this._loadProjects();
            }
          });
        } else {
          if (this.components.projectList) this.components.projectList.show();
          if (this.components.projectDetails) this.components.projectDetails.hide();
          setTimeout(() => {
            console.log('[ProjectDashboard] Loading projects after authentication state change');
            this._loadProjects();
            const plv = document.getElementById('projectListView');
            if (plv) plv.classList.remove('opacity-0');
          }, 300);
        }
      }
    });
  }

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

  _handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project?.id || null;
    requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderProject(project);
      }
    });
  }

  _handleProjectStatsLoaded(event) {
    const stats = event.detail;
    requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderStats(stats);
      }
    });
  }

  _handleFilesLoaded(event) {
    requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderFiles(event.detail.files);
      }
    });
  }

  _handleArtifactsLoaded(event) {
    requestAnimationFrame(() => {
      if (this.components.projectDetails?.renderArtifacts) {
        this.components.projectDetails.renderArtifacts(event.detail.artifacts);
      }
    });
  }

  _handleProjectNotFound(event) {
    const { projectId } = event.detail || {};
    console.warn("[ProjectDashboard] Project not found: " + projectId);
    this.state.currentProject = null;
    localStorage.removeItem('selectedProjectId');
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
 * @returns {ProjectDashboard}
 */
export function createProjectDashboard() {
  return new ProjectDashboard();
}

export default createProjectDashboard;
