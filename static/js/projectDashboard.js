/**
 * projectDashboard.js
 *
 * Coordinates project dashboard components and state, interacting exclusively
 * via DependencySystem for all dependencies. No global/window.* access for shared modules.
 */

class ProjectDashboard {
  constructor(dependencySystem) {
    if (!dependencySystem) throw new Error('[ProjectDashboard] dependencySystem is required.');

    // Dependency resolution
    const getModule = (key) =>
      dependencySystem.modules.get(key) ||
      dependencySystem.modules.get(key.charAt(0).toLowerCase() + key.slice(1));

    this.getModule = getModule;
    this.app = getModule('app');
    this.projectManager = getModule('projectManager');
    this.eventHandlers = getModule('eventHandlers');
    this.auth = getModule('auth');
    this.logger = getModule('logger') || { info: () => { }, warn: () => { }, error: () => { } };
    this.components = {
      projectList: getModule('projectListComponent') || null,
      projectDetails: getModule('projectDetailsComponent') || null
    };

    // Injected browser abstractions
    this.browserService = getModule('browserService') || {
      getLocationHref: () => '',
      setHistory: () => { },
      getSearchParam: () => null,
      setSearchParam: () => { },
      removeSearchParam: () => { },
      setItem: () => { },
      getItem: () => null,
      removeItem: () => { },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      requestAnimationFrame: (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 0))
    };

    this.state = { currentView: null, currentProject: null, initialized: false };
    this._unsubs = [];

    if (!this.eventHandlers?.trackListener) {
      throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for event binding');
    }

    // AuthBus event
    const authBus = this.auth?.AuthBus;
    const handler = (e) => {
      const { authenticated } = e.detail || {};
      if (!authenticated) return;
      if (!this.state.initialized) {
        this.logger.info('[ProjectDashboard] Authenticated – initializing dashboard');
        this.initialize();
        this._loadProjects();
      } else {
        this.logger.info('[ProjectDashboard] Authenticated – refreshing project list');
        this.showProjectList();
        this._loadProjects();
      }
    };
    const eventTarget = authBus && typeof authBus.addEventListener === 'function' ? authBus : document;
    const description = eventTarget === authBus ? 'ProjectDashboard: authStateChanged (AuthBus)' : 'ProjectDashboard: authStateChanged (doc)';
    this.eventHandlers.trackListener(eventTarget, 'authStateChanged', handler, { description });
    this._unsubs.push(() => eventTarget.removeEventListener('authStateChanged', handler));
  }

  async initialize() {
    if (this.state.initialized) {
      this.logger.info('[ProjectDashboard] Already initialized.');
      return true;
    }
    this.logger.info('[ProjectDashboard] Initializing...');

    try {
      if (!this.app?.state?.isAuthenticated) {
        this.logger.info('[ProjectDashboard] Not authenticated, waiting for login...');
        this._showLoginRequiredMessage();
        return false;
      }
      const listView = document.getElementById('projectListView');
      if (!listView) throw new Error('Missing required #projectListView container during initialization');
      await this._initializeComponents();
      this._processUrlParameters();
      this._setupEventListeners();
      this.state.initialized = true;
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized', { detail: { success: true } }));
      this.logger.info('[ProjectDashboard] Initialization complete.');
      return true;
    } catch (error) {
      this.logger.error('[ProjectDashboard] Initialization failed:', error);
      this.app?.showNotification('Dashboard initialization failed', 'error');
      this.state.initialized = false;
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized', { detail: { success: false, error } }));
      return false;
    }
  }

  cleanup() {
    if (this._unsubs && this._unsubs.length) {
      this._unsubs.forEach((unsub) => typeof unsub === 'function' && unsub());
      this._unsubs = [];
    }
    if (this.eventHandlers?.cleanupListeners) {
      this.eventHandlers.cleanupListeners();
    }
  }

  showProjectList() {
    this.logger.info('[ProjectDashboard] Showing project list view');
    this.state.currentView = 'list';
    this.state.currentProject = null;
    this.browserService.removeItem('selectedProjectId');

    // Remove ?project from URL
    this.browserService.removeSearchParam('project');

    this._setView({ showList: true, showDetails: false });

    if (this.components.projectDetails) this.components.projectDetails.hide();
    if (this.components.projectList) {
      this.components.projectList.show();
      this.logger.info('[ProjectDashboard] ProjectList component shown');
    } else {
      this.logger.warn('[ProjectDashboard] ProjectList component not available');
    }

    this._loadProjects();

    // Minimal reflow for styling transitions
    this.browserService.setTimeout(() => {
      const listView = document.getElementById('projectListView');
      if (listView) {
        listView.style.display = 'none';
        void listView.offsetHeight;
        listView.style.display = '';
      }
    }, 50);
  }

  /**
   * Show project details for a provided project object or projectId.
   * If passed a project object, use it directly; else load via ID.
   * @param {object|string} projectObjOrId
   */
  async showProjectDetails(projectObjOrId) {
    let project = null;
    let projectId = null;

    // Determine if argument is an object (project) or string (id)
    if (
      typeof projectObjOrId === "object" &&
      projectObjOrId &&
      projectObjOrId.id &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId.id))
    ) {
      // Provided a project object, always prefer it
      project = projectObjOrId;
      projectId = projectObjOrId.id;
    } else if (
      typeof projectObjOrId === "string" &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId))
    ) {
      projectId = projectObjOrId;
    } else {
      this.app?.showNotification?.('Invalid project ID', 'error');
      this.showProjectList();
      return false;
    }

    this.state.currentView = 'details';

    try {
      if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
        await this.components.projectDetails.initialize();
      }
    } catch (err) {
      this.logger.error('[ProjectDashboard] Error loading project details page:', err);
      this.app?.showNotification('Error loading project details UI', 'error');
      this.browserService.removeItem('selectedProjectId');
      this.showProjectList();
      return false;
    }

    this._setView({ showList: false, showDetails: true });

    if (this.components.projectList) this.components.projectList.hide();
    if (this.components.projectDetails) this.components.projectDetails.show();

    // Update URL param
    this.browserService.setSearchParam('project', projectId);

    // Persist selection
    this.browserService.setItem('selectedProjectId', projectId);

    // If we already have a project object, use it directly
    if (project) {
      if (this.components.projectDetails && this.components.projectDetails.renderProject) {
        this.components.projectDetails.renderProject(project);
      }
      // Optionally, emit projectLoaded event for consistency
      document.dispatchEvent(new CustomEvent('projectLoaded', { detail: project }));
      return true;
    }

    // Otherwise, load via manager
    if (this.app?.state?.isAuthenticated && this.projectManager?.loadProjectDetails) {
      try {
        project = await this.projectManager.loadProjectDetails(projectId);
        if (!project) {
          this.logger.warn('[ProjectDashboard] Project not found after details load');
          this.app?.showNotification('Project not found', 'error');
          this.browserService.removeItem('selectedProjectId');
          this.showProjectList();
        } else if (this.components.projectDetails && this.components.projectDetails.renderProject) {
          this.components.projectDetails.renderProject(project);
        }
      } catch (error) {
        this.logger.error('[ProjectDashboard] Failed to load project details:', error);
        this.app?.showNotification('Failed to load project details', 'error');
        this.browserService.removeItem('selectedProjectId');
        this.showProjectList();
      }
    } else {
      this.browserService.removeItem('selectedProjectId');
      this.showProjectList();
    }

    return true;
  }

  // =================== PRIVATE METHODS ===================

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
    projectViews.forEach((view) => view.classList.add('hidden'));
  }

  async _initializeComponents() {
    this.logger.info('[ProjectDashboard] Initializing components...');
    const projectListEl = document.getElementById('projectList');
    if (!projectListEl) throw new Error('Missing #projectList element in DOM after injecting project_list.html');
    if (this.components.projectList) {
      this.components.projectList.onViewProject = this._handleViewProject.bind(this);
      if (!this.components.projectList.state?.initialized) {
        await this.components.projectList.initialize();
        this.logger.info('[ProjectDashboard] ProjectListComponent initialized.');
      }
    } else {
      this.logger.error('[ProjectDashboard] projectListComponent not found (DependencySystem).');
    }
    if (this.components.projectDetails) {
      this.components.projectDetails.onBack = this._handleBackToList.bind(this);
      if (!this.components.projectDetails.state?.initialized) {
        await this.components.projectDetails.initialize();
        this.logger.info('[ProjectDashboard] ProjectDetailsComponent initialized.');
      }
    } else {
      this.logger.error('[ProjectDashboard] projectDetailsComponent not found (DependencySystem).');
    }
    this.logger.info('[ProjectDashboard] Components initialized.');
  }

  _processUrlParameters() {
    const projectId = this.browserService.getSearchParam('project');
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  }

  _setupEventListeners() {
    const add = (el, event, handler, opts = {}) => {
      if (!this.eventHandlers?.trackListener) throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for event binding');
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
    this.logger.info('[ProjectDashboard] Project created:', project);
    this.showProjectDetails(project.id);
    this.browserService.setItem('selectedProjectId', project.id);
  }

  _loadProjects() {
    this.logger.info('[ProjectDashboard] Loading projects...');
    if (!this.app?.state?.isAuthenticated) {
      this.logger.warn('[ProjectDashboard] Not authenticated, cannot load projects');
      return;
    }
    if (!this.projectManager?.loadProjects) {
      this.logger.error('[ProjectDashboard] Cannot load projects: projectManager.loadProjects not available');
      return;
    }
    this.browserService.setTimeout(() => {
      this.projectManager.loadProjects('all').catch((error) =>
        this.logger.error('[ProjectDashboard] Error loading projects:', error)
      );
    }, 100);
  }

  _handlePopState() {
    this._processUrlParameters();
  }

  _handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }

  _handleBackToList() {
    this.showProjectList();
  }

  _handleAuthStateChange(event) {
    const { authenticated } = event.detail || {};
    this.browserService.requestAnimationFrame(() => {
      const loginRequiredMessage = document.getElementById('loginRequiredMessage');
      const projectListView = document.getElementById('projectListView');
      const projectDetailsView = document.getElementById('projectDetailsView');
      if (!authenticated) {
        if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
        if (projectListView) projectListView.classList.add('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');
      } else {
        if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');
        this.browserService.removeItem('selectedProjectId');
        this.state.currentView = 'list';
        this.state.currentProject = null;
        this.browserService.removeSearchParam('project');
        if (projectListView) projectListView.classList.remove('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');
        if (!this.components.projectList || !this.components.projectList.initialized) {
          this.logger.info('[ProjectDashboard] Components not initialized after auth, reinitializing...');
          this._initializeComponents().then(() => {
            if (this.components.projectList) {
              this.components.projectList.show();
              this._loadProjects();
            }
          });
        } else {
          if (this.components.projectList) this.components.projectList.show();
          if (this.components.projectDetails) this.components.projectDetails.hide();
          this.browserService.setTimeout(() => {
            this.logger.info('[ProjectDashboard] Loading projects after authentication state change');
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
      this.logger.error('[ProjectDashboard] projectsLoaded event with error:', message);
      this.browserService.requestAnimationFrame(() => {
        if (this.components.projectList?._showErrorState) {
          this.components.projectList._showErrorState(message || 'Failed to load projects');
        }
      });
      return;
    }
    this.browserService.requestAnimationFrame(() => {
      if (this.components.projectList) {
        this.logger.info(`[ProjectDashboard] Rendering ${projects.length} project(s).`);
        this.components.projectList.renderProjects({ projects });
      } else {
        this.logger.warn('[ProjectDashboard] ProjectListComponent not available to render projects.');
      }
    });
  }

  _handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project || null;
    this.browserService.requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderProject(project);
      }
    });
  }

  _handleProjectStatsLoaded(event) {
    const stats = event.detail;
    this.browserService.requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderStats(stats);
      }
    });
  }

  _handleFilesLoaded(event) {
    this.browserService.requestAnimationFrame(() => {
      if (this.components.projectDetails) {
        this.components.projectDetails.renderFiles(event.detail.files);
      }
    });
  }

  _handleArtifactsLoaded(event) {
    this.browserService.requestAnimationFrame(() => {
      if (this.components.projectDetails?.renderArtifacts) {
        this.components.projectDetails.renderArtifacts(event.detail.artifacts);
      }
    });
  }

  _handleProjectNotFound(event) {
    const { projectId } = event.detail || {};
    this.logger.warn('[ProjectDashboard] Project not found:', projectId);
    this.state.currentProject = null;
    this.browserService.removeItem('selectedProjectId');
    const detailsView = document.getElementById('projectDetailsView');
    if (detailsView) {
      detailsView.classList.add('hidden');
      detailsView.style.display = 'none';
    }
    this.app?.showNotification('The requested project was not found', 'error');
    this.showProjectList();
  }
}

export function createProjectDashboard(dependencySystem) {
  return new ProjectDashboard(dependencySystem);
}

export default createProjectDashboard;
