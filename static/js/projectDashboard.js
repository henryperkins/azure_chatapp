/**
 * projectDashboard.js
 *
 * ALL user/system notification, error, warning, or info banners must be
 * routed via the DI notification handler (`notificationHandler.show`). Never
 * use direct `console` or `alert` for user/system feedback. For dev/debug logs,
 * use only `this.logger.*` (DI-injected), never user alerts.
 *
 * For architectural conventions, see notification-system.md and custominstructions.md.
 *
 * Coordinates project dashboard components and state, interacting exclusively
 * via DependencySystem for all dependencies. No global/ .* access for shared modules.
 */

class ProjectDashboard {
  constructor(dependencySystem) {
    if (!dependencySystem) throw new Error('[ProjectDashboard] dependencySystem is required.');

    // Dependency resolution
    const getModule = (key) =>
      dependencySystem.modules.get(key) ||
      dependencySystem.modules.get(
        key.charAt(0).toLowerCase() + key.slice(1)
      );

    this.getModule = getModule;
    this.app = getModule('app');
    this.projectManager = getModule('projectManager');
    this.eventHandlers = getModule('eventHandlers');
    this.auth = getModule('auth');
    this.logger = getModule('logger') || { info: () => { }, warn: () => { }, error: () => { } };
    this.notificationHandler = getModule('notificationHandler');
    if (!this.notificationHandler) throw new Error('[ProjectDashboard] notificationHandler (via DependencySystem) is required.');

    this.components = {
      projectList: getModule('projectListComponent') || null,
      projectDetails: getModule('projectDetailsComponent') || null
    };

    // Injected browser abstractions
    // Note: setTimeout & requestAnimationFrame default shims provided for browser environments only.
    // Prefer explicit scheduling/animation abstractions via DI for testability and portability.
    this.browserService = getModule('browserService') || {
      getLocationHref: () => '',
      setHistory: () => { },
      getSearchParam: () => null,
      setSearchParam: () => { },
      removeSearchParam: () => { },
      setItem: () => { },
      getItem: () => null,
      removeItem: () => { },
      /**
       * For DOM style/layout flushes or async updates—use ONLY if needed for UI smoothness, else prefer hooks/events.
       */
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      /**
       * For animation frames—prefer explicit DI for tests.
       */
      requestAnimationFrame: (fn) =>
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(fn)
          : setTimeout(fn, 0)
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
    const description =
      eventTarget === authBus
        ? 'ProjectDashboard: authStateChanged (AuthBus)'
        : 'ProjectDashboard: authStateChanged (doc)';
    this.eventHandlers.trackListener(eventTarget, 'authStateChanged', handler, { description });
    this._unsubs.push(() => eventTarget.removeEventListener('authStateChanged', handler));
  }

  async initialize() {
    if (this.state.initialized) {
      this.logger.info('[ProjectDashboard] Already initialized.', { context: 'ProjectDashboard' });
      this.notificationHandler.show(
        'Project dashboard is already initialized.',
        'info',
        { group: true, context: 'projectDashboard' }
      );
      return true;
    }
    this.logger.info('[ProjectDashboard] Initializing...', { context: 'ProjectDashboard' });

    try {
      if (!this.app?.state?.isAuthenticated) {
        this.logger.info('[ProjectDashboard] Not authenticated, waiting for login...', {
          context: 'ProjectDashboard'
        });
        this._showLoginRequiredMessage();
        return false;
      }
      const listView = document.getElementById('projectListView');
      if (!listView)
        throw new Error('Missing required #projectListView container during initialization');
      await this._initializeComponents();
      this._processUrlParameters();
      this._setupEventListeners();
      // ---------- NEW: keep URL and UI in sync ----------
      window.addEventListener('popstate', this._handlePopState.bind(this));
      this.state.initialized = true;
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized', { detail: { success: true } }));
      this.logger.info('[ProjectDashboard] Initialization complete.', { context: 'ProjectDashboard' });
      return true;
    } catch (error) {
      this.logger.error('[ProjectDashboard] Initialization failed:', error);
        if (this.notificationHandler?.show) {
          this.notificationHandler.show(
            'Dashboard initialization failed',
            'error',
            { group: true, context: 'projectDashboard' }
          );
        }
        this.state.initialized = false;
        document.dispatchEvent(
          new CustomEvent('projectDashboardInitialized', { detail: { success: false, error } })
        );
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
    // Remove ?project from URL
    this.browserService.removeSearchParam('project');

    this._setView({ showList: true, showDetails: false });

    if (this.components.projectDetails) this.components.projectDetails.hide();
    if (this.components.projectList) {
      this.components.projectList.show();
      this.logger.info('[ProjectDashboard] ProjectList component shown');
      this.notificationHandler.show(
        'Switched to project list view.',
        'info',
        { group: true, context: 'projectDashboard' }
      );
    } else {
      this.logger.warn('[ProjectDashboard] ProjectList component not available');
      this.notificationHandler.show(
        'The project list is currently unavailable.',
        'warning',
        { group: true, context: 'projectDashboard' }
      );
    }

    this._loadProjects();

    // Minimal reflow for styling transitions
    this.browserService.setTimeout(() => {
      const listView = document.getElementById('projectListView');
      if (listView) {
        // reflow hack removed, rely on Tailwind classes for visibility
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
    let currentLoadId = Symbol('loadId');
    this._lastLoadId = currentLoadId;

    // Determine if argument is an object (project) or string (id)
    if (
      typeof projectObjOrId === 'object' &&
      projectObjOrId &&
      projectObjOrId.id &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId.id))
    ) {
      // Provided a project object, always prefer it
      project = projectObjOrId;
      projectId = projectObjOrId.id;
    } else if (
      typeof projectObjOrId === 'string' &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId))
    ) {
      projectId = projectObjOrId;
    } else {
      this.notificationHandler.show(
        'Invalid project ID',
        'error',
        { group: true, context: 'projectDashboard' }
      );
      this.showProjectList();
      return false;
    }

    // Set view state only after successful load
    // Show loading indicator or overlay here if desired
    this.state.currentView = null;

    try {
      if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
        await this.components.projectDetails.initialize();
      }
    } catch (err) {
      this.logger.error('[ProjectDashboard] Error loading project details page:', err);
      this.notificationHandler.show(
        'Error loading project details UI',
        'error',
        { group: true, context: 'projectDashboard' }
      );
      this.browserService.removeItem('selectedProjectId');
      this.showProjectList();
      return false;
    }

    // If we already have a project object, use it directly
    if (project) {
      // Always set as current project to trigger downstream events
      if (this.projectManager && typeof this.projectManager.setCurrentProject === 'function') {
        this.projectManager.setCurrentProject(project);
      }

      if (this.components.projectDetails && this.components.projectDetails.renderProject) {
        try {
          // Step 1: Make sure the DOM element is actually visible
          if (this._lastLoadId !== currentLoadId) {
            this.logger.info('[ProjectDashboard] Aborting showProjectDetails (direct path) due to newer load');
            return false;
          }
          this.logger.info('[ProjectDashboard] Setting initial view visibility first');
          this._setView({ showList: false, showDetails: true });

          // Step 2: Tell the component to show itself
          this.logger.info('[ProjectDashboard] Showing project details component (direct path)');
          if (this.components.projectDetails) this.components.projectDetails.show();

          // Step 3: Hide the list component
          this.logger.info('[ProjectDashboard] Hiding project list component');
          if (this.components.projectList) this.components.projectList.hide();

          // Step 4: Render the data
          this.logger.info('[ProjectDashboard] Rendering project data (direct path)');
          this.components.projectDetails.renderProject(project);

          // Final verification that the details are visible
          this.logger.info('[ProjectDashboard] Performing final visibility check');
          const detailsView = document.getElementById('projectDetailsView');
          if (detailsView) {
            if (detailsView.classList.contains('hidden') || detailsView.style.display === 'none') {
              this.logger.warn(
                '[ProjectDashboard] Details view still hidden after all operations, forcing visibility'
              );
              detailsView.classList.remove('hidden', 'opacity-0');
              detailsView.style.display = '';
              detailsView.setAttribute('aria-hidden', 'false');
            }
          }
        } catch (error) {
          this.logger.error('[ProjectDashboard] Error during view transition:', error);
          // Try one more time with the basic approach
          this._setView({ showList: false, showDetails: true });
        }
      }
      // Update URL param only after successful render
      this.browserService.setSearchParam('project', projectId);
      this.state.currentView = 'details';
      // Optionally, emit projectLoaded event for consistency
      document.dispatchEvent(new CustomEvent('projectLoaded', { detail: project }));
      return true;
    }

    // Otherwise, load via projectManager
    if (this.app?.state?.isAuthenticated && this.projectManager?.loadProjectDetails) {
      try {
        project = await this.projectManager.loadProjectDetails(projectId);
        if (this._lastLoadId !== currentLoadId) {
          this.logger.info('[ProjectDashboard] Aborting showProjectDetails (API path) due to newer load');
          return false;
        }
        if (!project) {
          this.logger.warn('[ProjectDashboard] Project not found after details load');
          this.notificationHandler.show(
            'Project not found',
            'error',
            { group: true, context: 'projectDashboard' }
          );
          this.showProjectList();
          return false;
        }
        if (project && this.components.projectDetails?.renderProject) {
          // Always set as current project to trigger downstream events
          if (this.projectManager && typeof this.projectManager.setCurrentProject === 'function') {
            this.projectManager.setCurrentProject(project);
          }

          try {
            // Step 1
            if (this._lastLoadId !== currentLoadId) {
              this.logger.info(
                '[ProjectDashboard] Aborting showProjectDetails (API path) due to newer load after render check'
              );
              return false;
            }
            this.logger.info('[ProjectDashboard] Setting initial view visibility first (API path)');
            this._setView({ showList: false, showDetails: true });

            // Step 2
            this.logger.info('[ProjectDashboard] Showing project details component (API path)');
            if (this.components.projectDetails) this.components.projectDetails.show();

            // Step 3
            this.logger.info('[ProjectDashboard] Hiding project list component (API path)');
            if (this.components.projectList) this.components.projectList.hide();

            // Step 4
            this.logger.info('[ProjectDashboard] Rendering project data (API path)');
            this.components.projectDetails.renderProject(project);

            // Final verification
            this.logger.info('[ProjectDashboard] Performing final visibility check (API path)');
            const detailsView = document.getElementById('projectDetailsView');
            if (detailsView) {
              if (detailsView.classList.contains('hidden') || detailsView.style.display === 'none') {
                this.logger.warn(
                  '[ProjectDashboard] Details view still hidden after all operations, forcing visibility (API path)'
                );
                detailsView.classList.remove('hidden', 'opacity-0');
                detailsView.style.display = '';
                detailsView.setAttribute('aria-hidden', 'false');
              }
            }
          } catch (error) {
            this.logger.error('[ProjectDashboard] Error during view transition (API path):', error);
            this._setView({ showList: false, showDetails: true });
          }
        }
      } catch (error) {
        if (this._lastLoadId !== currentLoadId) {
          this.logger.info('[ProjectDashboard] Aborting showProjectDetails error handler due to newer load');
          return false;
        }
        this.logger.error('[ProjectDashboard] Failed to load project details:', error);
        this.notificationHandler.show(
          'Failed to load project details',
          'error',
          { group: true, context: 'projectDashboard' }
        );
        this.showProjectList();
        return false;
      }
      // Update URL param only after successful render
      this.browserService.setSearchParam('project', projectId);
      this.state.currentView = 'details';
      return true;
    } else {
      this.showProjectList();
      return false;
    }
  }

  // =================== PRIVATE METHODS ===================

  _setView({ showList, showDetails }) {
    if (this.state._aborted) {
      this.logger.info('[ProjectDashboard] _setView aborted due to navigation change');
      return;
    }
    this.logger.info('[ProjectDashboard] _setView called with:', { showList, showDetails });

    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');

    // Log DOM element state before changes
    this.logger.info('[ProjectDashboard] _setView DOM elements before:', {
      listViewExists: !!listView,
      detailsViewExists: !!detailsView,
      listViewClasses: listView ? listView.className : 'N/A',
      detailsViewClasses: detailsView ? detailsView.className : 'N/A'
    });

    // Ensure both views exist before proceeding
    if (!listView) {
      this.logger.error('[ProjectDashboard] #projectListView element not found in DOM');
      // Try to create it
      try {
        const newListView = document.createElement('div');
        newListView.id = 'projectListView';
        newListView.className = 'flex-1 flex flex-col min-h-0';
        document.querySelector('#projectManagerPanel')?.appendChild(newListView);
        this.logger.info('[ProjectDashboard] Created missing #projectListView element');
      } catch (e) {
        this.logger.error('[ProjectDashboard] Failed to create missing #projectListView:', e);
      }
    }

    if (!detailsView) {
      this.logger.error('[ProjectDashboard] #projectDetailsView element not found in DOM');
      // Try to create it
      try {
        const newDetailsView = document.createElement('div');
        newDetailsView.id = 'projectDetailsView';
        newDetailsView.className = 'hidden';
        document.querySelector('#projectManagerPanel')?.appendChild(newDetailsView);
        this.logger.info('[ProjectDashboard] Created missing #projectDetailsView element');
      } catch (e) {
        this.logger.error('[ProjectDashboard] Failed to create missing #projectDetailsView:', e);
      }
    }

    // Get the elements again
    const finalListView = document.getElementById('projectListView');
    const finalDetailsView = document.getElementById('projectDetailsView');

    // Update list view
    if (finalListView) {
      this.logger.info(
        `[ProjectDashboard] Setting listView visibility: ${showList ? 'VISIBLE' : 'HIDDEN'}`
      );
      finalListView.classList.toggle('hidden', !showList);
      finalListView.setAttribute('aria-hidden', (!showList).toString());
      if (showList) finalListView.classList.remove('opacity-0');
    }

    // Update details view
    if (finalDetailsView) {
      this.logger.info(
        `[ProjectDashboard] Setting detailsView visibility: ${showDetails ? 'VISIBLE' : 'HIDDEN'}`
      );
      finalDetailsView.classList.toggle('hidden', !showDetails);
      finalDetailsView.setAttribute('aria-hidden', (!showDetails).toString());
      if (showDetails) finalDetailsView.classList.remove('opacity-0');
    }

    // Log final state
    this.logger.info('[ProjectDashboard] View state after update:', {
      listViewHidden: finalListView?.classList.contains('hidden') || false,
      detailsViewHidden: finalDetailsView?.classList.contains('hidden') || false,
      listViewDisplay: finalListView?.style.display || 'N/A',
      detailsViewDisplay: finalDetailsView?.style.display || 'N/A'
    });
  }

  _showLoginRequiredMessage() {
    this.state._aborted = true;
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
    if (!projectListEl)
      throw new Error('Missing #projectList element in DOM after injecting project_list.html');

    // ProjectList
    if (this.components.projectList) {
      this.components.projectList.onViewProject = this._handleViewProject.bind(this);
      if (!this.components.projectList.state?.initialized) {
        await this.components.projectList.initialize();
        this.components.projectList.onViewProject = this._handleViewProject.bind(this);
        this.logger.info('[ProjectDashboard] ProjectListComponent initialized.');
      } else {
        this.components.projectList.onViewProject = this._handleViewProject.bind(this);
      }
    } else {
      this.logger.error('[ProjectDashboard] projectListComponent not found (DependencySystem).');
    }

    // ProjectDetails
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
    const projectIdFromUrl = this.browserService.getSearchParam('project');

    // Only navigate if the URL explicitly requests a project
    if (
      projectIdFromUrl &&
      this.state.currentView !== 'details' &&
      this.state.currentProject?.id !== projectIdFromUrl
    ) {
      this.logger.info(`[ProjectDashboard] Processing URL parameter: project=${projectIdFromUrl}`);
      this.showProjectDetails(projectIdFromUrl);
    } else if (!projectIdFromUrl && this.state.currentView !== 'list') {
      this.logger.info('[ProjectDashboard] No project in URL, ensuring list view is shown.');
      this.showProjectList();
    } else {
      this.logger.info(
        `[ProjectDashboard] URL processing skipped: URL=${projectIdFromUrl}, CurrentView=${this.state.currentView}, CurrentProject=${this.state.currentProject?.id}`
      );
    }
  }

  _setupEventListeners() {
    const add = (el, event, handler, opts = {}) => {
      if (!this.eventHandlers?.trackListener)
        throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for event binding');
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
    // Use injected windowObject (from DependencySystem) for popstate
    const win = this.getModule('windowObject') || undefined;
    if (win) {
      add(win, 'popstate', this._handlePopState.bind(this));
    }
    add(document, 'authStateChanged', this._handleAuthStateChange.bind(this));
    add(document, 'projectDeleted', this._handleProjectDeleted.bind(this)); // Add listener for project deletion
  }

  _handleProjectCreated(e) {
    const project = e.detail;
    this.logger.info('[ProjectDashboard] Project created:', project);

    // Ensure all expected rendering events will fire, even if components aren't ready
    if (project && project.id) {
      this.browserService.setTimeout(() => {
        // Emit any missing rendered events to prevent potential UI timeouts
        const projectId = project.id;
        const events = [
          'projectStatsRendered',
          'projectFilesRendered',
          'projectConversationsRendered',
          'projectArtifactsRendered',
          'projectKnowledgeBaseRendered'
        ];

        // Emit these events after a short delay if they haven't been fired yet
        events.forEach((eventName) => {
          document.dispatchEvent(
            new CustomEvent(eventName, {
              detail: { projectId }
            })
          );
        });
      }, 3000);
    }

    this.showProjectDetails(project.id);
    this.browserService.setItem('selectedProjectId', project.id);
  }

  _loadProjects() {
    this.state._aborted = false;
    this.logger.info('[ProjectDashboard] Loading projects...');

    if (!this.app) {
      this.logger.error('[ProjectDashboard] app is null or undefined');
      return;
    }

    if (!this.app?.state?.isAuthenticated) {
      this.logger.warn('[ProjectDashboard] Not authenticated, cannot load projects. Auth state:', this.app?.state);
      return;
    }

    if (!this.projectManager) {
      this.logger.error('[ProjectDashboard] projectManager is null or undefined');
      return;
    }

    if (!this.projectManager?.loadProjects) {
      this.logger.error('[ProjectDashboard] Cannot load projects: projectManager.loadProjects not available');
      return;
    }

    this.browserService.setTimeout(() => {
      this.logger.info('[ProjectDashboard] Attempting to load projects with projectManager.loadProjects...');
      this.projectManager
        .loadProjects('all')
        .then((projects) => {
          if (this.state._aborted) {
            this.logger.info('[ProjectDashboard] _loadProjects aborted, ignoring loaded projects');
            return;
          }
          this.logger.info('[ProjectDashboard] Projects loaded successfully:', projects);
        })
        .catch((error) => {
          this.logger.error('[ProjectDashboard] Error loading projects:', error);
        });
    }, 100);
  }

  _handlePopState() {
    this._processUrlParameters();
  }

  _handleViewProject(projectId) {
    // Push url then show – enables Back button
    history.pushState({}, '', this.browserService.buildUrl ? this.browserService.buildUrl({ project: projectId }) : `?project=${projectId}`);
    this.showProjectDetails(projectId);
  }

  _handleBackToList() {
    // Push url for list-view (no project param) then show list
    history.pushState({}, '', this.browserService.buildUrl ? this.browserService.buildUrl({ project: '' }) : window.location.pathname);
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
    const detailsView = document.getElementById('projectDetailsView');
    if (detailsView) {
      detailsView.classList.add('hidden');
      detailsView.style.display = 'none';
    }
    this.notificationHandler.show(
      'The requested project was not found',
      'error',
      { group: true, context: 'projectDashboard' }
    );
    this.showProjectList();
  }

  _handleProjectDeleted(event) {
    const { projectId } = event.detail || {};
    this.logger.info(`[ProjectDashboard] Project deleted event received for ID: ${projectId}`);
    // If the deleted project was the one being viewed, go back to list
    if (this.state.currentProject && this.state.currentProject.id === projectId) {
      this.logger.info('[ProjectDashboard] Currently viewed project was deleted, returning to list view.');
      this.showProjectList(); // This already calls _loadProjects
    } else {
      // Otherwise, just reload the list in the background if it's already visible
      if (this.state.currentView === 'list') {
        this.logger.info('[ProjectDashboard] Project deleted while list is visible, reloading list.');
        this._loadProjects();
      }
    }
  }
}

export function createProjectDashboard(dependencySystem) {
  return new ProjectDashboard(dependencySystem);
}
