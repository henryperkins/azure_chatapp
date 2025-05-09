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

    // Inject domAPI for all DOM access
    this.domAPI = getModule('domAPI');
    if (!this.domAPI) throw new Error('[ProjectDashboard] domAPI module required for DOM abstraction');

    this.components = {
      projectList: getModule('projectListComponent') || null,
      projectDetails: getModule('projectDetailsComponent') || null
    };

    // Injected browser abstractions
    // Note: setTimeout & requestAnimationFrame default shims provided for browser environments only.
    // Prefer explicit scheduling/animation abstractions via DI for testability and portability.
    this.browserService = getModule('browserService');
    if (!this.browserService) throw new Error('[ProjectDashboard] browserService module required');

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
    this.notificationHandler.show(
      '[ProjectDashboard] initialize() called',
      'info',
      { group: true, context: 'projectDashboard', module: 'ProjectDashboard', source: 'initialize' }
    );
    if (this.state.initialized) {
      this.logger.info('[ProjectDashboard] Already initialized.', { context: 'ProjectDashboard' });
      this.notificationHandler.show(
        'Project dashboard is already initialized.',
        'info',
        { group: true, context: 'projectDashboard', module: 'ProjectDashboard', source: 'initialize' }
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
      const listView = this.domAPI.getElementById('projectListView');
      if (!listView)
        throw new Error('Missing required #projectListView container during initialization');
      await this._initializeComponents();
      this._processUrlParameters();
      this._setupEventListeners();
      // ---------- NEW: keep URL and UI in sync ----------
      // Use DI-injected windowObject if available, else fallback to window with warning.
      const win = this.getModule && this.getModule('windowObject') ? this.getModule('windowObject') : (typeof window !== 'undefined' ? window : null);
      if (win) {
        this.eventHandlers.trackListener(win, 'popstate', this._handlePopState.bind(this), {
          description: 'ProjectDashboard: popstate (DI windowObject or global window)',
          context: 'projectDashboard'
        });
        this._unsubs.push(() => win.removeEventListener('popstate', this._handlePopState.bind(this)));
      } else {
        this.logger.warn('[ProjectDashboard] No windowObject available for popstate event binding');
      }
      this.state.initialized = true;
      this.domAPI.dispatchEvent(this.domAPI.getDocument(), new CustomEvent('projectDashboardInitialized', { detail: { success: true } }));
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
        this.domAPI.dispatchEvent(this.domAPI.getDocument(),
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
        'warn',
        { group: true, context: 'projectDashboard' }
      );
    }

    this._loadProjects();

    // Minimal reflow for styling transitions
    // UI reflow after DOM update: ensure visibility transitions apply after view change.
    this.browserService.setTimeout(() => {
      const listView = this.domAPI.getElementById('projectListView');
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

    // Generate trace/transaction context for troubleshooting
    const DependencySystem = this.getModule?.('DependencySystem') ?? (typeof window !== 'undefined' ? window.DependencySystem : null);
    const traceId = DependencySystem?.getCurrentTraceIds?.().traceId ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    const transactionId = DependencySystem?.generateTransactionId?.() ?? `txn-${Date.now()}`;

    // Determine if argument is an object (project) or string (id)
    if (
      typeof projectObjOrId === 'object' &&
      projectObjOrId &&
      projectObjOrId.id &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId.id))
    ) {
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
        {
          group: true,
          context: 'projectDashboard',
          module: 'ProjectDashboard',
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectObjOrId }
        }
      );
      this.showProjectList();
      return false;
    }

    this.state.currentView = null;

    try {
      if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
        this.notificationHandler.show(
          'Waiting for ProjectDetailsComponent to initialize…',
          'info',
          {
            group: true,
            context: 'projectDashboard',
            module: 'ProjectDashboard',
            source: 'showProjectDetails',
            traceId,
            transactionId,
            extra: { projectId }
          }
        );
        await this.components.projectDetails.initialize();
        this.notificationHandler.show(
          'ProjectDetailsComponent initialized',
          'info',
          {
            group: true,
            context: 'projectDashboard',
            module: 'ProjectDashboard',
            source: 'showProjectDetails',
            traceId,
            transactionId,
            extra: { projectId }
          }
        );
      }
    } catch (err) {
      this.logger.error('[ProjectDashboard] Error loading project details page:', err);
      this.notificationHandler.show(
        'Error loading project details UI',
        'error',
        {
          group: true,
          context: 'projectDashboard',
          module: 'ProjectDashboard',
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectId, error: err?.message, originalError: err }
        }
      );
      this.browserService.removeItem('selectedProjectId');
      this.showProjectList();
      return false;
    }

    // If we already have a project object, use it directly
    if (project) {
      if (this.projectManager && typeof this.projectManager.setCurrentProject === 'function') {
        this.projectManager.setCurrentProject(project);
      }

      if (this.components.projectDetails && this.components.projectDetails.renderProject) {
        try {
          if (this._lastLoadId !== currentLoadId) {
            this.logger.info('[ProjectDashboard] Aborting showProjectDetails (direct path) due to newer load');
            this.notificationHandler.show(
              'Aborted: newer navigation event detected',
              'debug',
              {
                group: true,
                context: 'projectDashboard',
                module: 'ProjectDashboard',
                source: 'showProjectDetails',
                traceId,
                transactionId,
                extra: { projectId }
              }
            );
            return false;
          }
          this.logger.info('[ProjectDashboard] Setting initial view visibility first');
          this._setView({ showList: false, showDetails: true });

          this.logger.info('[ProjectDashboard] Showing project details component (direct path)');
          if (this.components.projectDetails) this.components.projectDetails.show();

          this.logger.info('[ProjectDashboard] Hiding project list component');
          if (this.components.projectList) this.components.projectList.hide();

          this.logger.info('[ProjectDashboard] Rendering project data (direct path)');
          this.components.projectDetails.renderProject(project);

          // Final verification that the details are visible
          this.logger.info('[ProjectDashboard] Performing final visibility check');
          const detailsView = this.domAPI.getElementById('projectDetailsView');
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
          this.notificationHandler.show(
            'Project details displayed successfully.',
            'info',
            {
              group: true,
              context: 'projectDashboard',
              module: 'ProjectDashboard',
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            }
          );
        } catch (error) {
          this.logger.error('[ProjectDashboard] Error during view transition:', error);
          this.notificationHandler.show(
            'Error displaying project details (direct path)',
            'error',
            {
              group: true,
              context: 'projectDashboard',
              module: 'ProjectDashboard',
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId, error: error?.message, originalError: error }
            }
          );
          this._setView({ showList: false, showDetails: true });
        }
      }
      this.browserService.setSearchParam('project', projectId);
      this.state.currentView = 'details';
      document.dispatchEvent(new CustomEvent('projectLoaded', { detail: project }));
      return true;
    }

    // Otherwise, load via projectManager
    if (this.app?.state?.isAuthenticated && this.projectManager?.loadProjectDetails) {
      try {
        project = await this.projectManager.loadProjectDetails(projectId);
        if (this._lastLoadId !== currentLoadId) {
          this.logger.info('[ProjectDashboard] Aborting showProjectDetails (API path) due to newer load');
          this.notificationHandler.show(
            'Aborted: newer navigation event detected (API path)',
            'debug',
            {
              group: true,
              context: 'projectDashboard',
              module: 'ProjectDashboard',
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            }
          );
          return false;
        }
        if (!project) {
          this.logger.warn('[ProjectDashboard] Project not found after details load');
          this.notificationHandler.show(
            'Project not found',
            'error',
            {
              group: true,
              context: 'projectDashboard',
              module: 'ProjectDashboard',
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            }
          );
          this.showProjectList();
          return false;
        }
        if (project && this.components.projectDetails?.renderProject) {
          if (this.projectManager && typeof this.projectManager.setCurrentProject === 'function') {
            this.projectManager.setCurrentProject(project);
          }

          try {
            if (this._lastLoadId !== currentLoadId) {
              this.logger.info(
                '[ProjectDashboard] Aborting showProjectDetails (API path) due to newer load after render check'
              );
            this.notificationHandler.show(
              'Aborted: newer navigation event detected (API path, post-render check)',
              'debug',
              {
                group: true,
                context: 'projectDashboard',
                module: 'ProjectDashboard',
                source: 'showProjectDetails',
                traceId,
                transactionId,
                extra: { projectId }
              }
            );
              return false;
            }
            this.logger.info('[ProjectDashboard] Setting initial view visibility first (API path)');
            this._setView({ showList: false, showDetails: true });

            this.logger.info('[ProjectDashboard] Showing project details component (API path)');
            if (this.components.projectDetails) this.components.projectDetails.show();

            this.logger.info('[ProjectDashboard] Hiding project list component (API path)');
            if (this.components.projectList) this.components.projectList.hide();

            this.logger.info('[ProjectDashboard] Rendering project data (API path)');
            this.components.projectDetails.renderProject(project);

            this.logger.info('[ProjectDashboard] Performing final visibility check (API path)');
            const detailsView = this.domAPI.getElementById('projectDetailsView');
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
            this.notificationHandler.show(
              'Project details displayed successfully (API path).',
              'info',
              {
                group: true,
                context: 'projectDashboard',
                module: 'ProjectDashboard',
                source: 'showProjectDetails',
                traceId,
                transactionId,
                extra: { projectId }
              }
            );
          } catch (error) {
            this.logger.error('[ProjectDashboard] Error during view transition (API path):', error);
            this.notificationHandler.show(
              'Error displaying project details (API path)',
              'error',
              {
                group: true,
                context: 'projectDashboard',
                module: 'ProjectDashboard',
                source: 'showProjectDetails',
                traceId,
                transactionId,
                extra: { projectId, error: error?.message, originalError: error }
              }
            );
            this._setView({ showList: false, showDetails: true });
          }
        }
      } catch (error) {
        if (this._lastLoadId !== currentLoadId) {
          this.logger.info('[ProjectDashboard] Aborting showProjectDetails error handler due to newer load');
          this.notificationHandler.show(
            'Aborted: newer navigation event detected (API path, error handler)',
            'debug',
            {
              group: true,
              context: 'projectDashboard',
              module: 'ProjectDashboard',
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            }
          );
          return false;
        }
        this.logger.error('[ProjectDashboard] Failed to load project details:', error);
        this.notificationHandler.show(
          'Failed to load project details',
          'error',
          {
            group: true,
            context: 'projectDashboard',
            module: 'ProjectDashboard',
            source: 'showProjectDetails',
            traceId,
            transactionId,
            extra: { projectId, error: error?.message, originalError: error }
          }
        );
        this.showProjectList();
        return false;
      }
      this.browserService.setSearchParam('project', projectId);
      this.state.currentView = 'details';
      return true;
    } else {
      this.notificationHandler.show(
        'ProjectManager is unavailable or user not authenticated. Showing project list.',
        'warn',
        {
          group: true,
          context: 'projectDashboard',
          module: 'ProjectDashboard',
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectId }
        }
      );
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

    const listView = this.domAPI.getElementById('projectListView');
    const detailsView = this.domAPI.getElementById('projectDetailsView');

    // Enhanced logging: log both class and style.display before change
    this.logger.info('[ProjectDashboard] _setView DOM elements before:', {
      listViewExists: !!listView,
      detailsViewExists: !!detailsView,
      listViewClasses: listView ? listView.className : 'N/A',
      detailsViewClasses: detailsView ? detailsView.className : 'N/A',
      listViewDisplay: listView ? listView.style.display : 'N/A',
      detailsViewDisplay: detailsView ? detailsView.style.display : 'N/A'
    });

    // CONSISTENT APPROACH: Always modify both classList and style.display
    if (listView) {
      this.logger.info(`[ProjectDashboard] Setting listView visibility: ${showList ? 'VISIBLE' : 'HIDDEN'}`);
      listView.classList.toggle('hidden', !showList);
      listView.setAttribute('aria-hidden', (!showList).toString());
      listView.style.display = showList ? '' : 'none';
      if (showList) listView.classList.remove('opacity-0');
    }

    if (detailsView) {
      this.logger.info(`[ProjectDashboard] Setting detailsView visibility: ${showDetails ? 'VISIBLE' : 'HIDDEN'}`);
      detailsView.classList.toggle('hidden', !showDetails);
      detailsView.setAttribute('aria-hidden', (!showDetails).toString());
      detailsView.style.display = showDetails ? '' : 'none';
      if (showDetails) detailsView.classList.remove('opacity-0');
    }

    // Force browser reflow to ensure visibility transitions apply
    if ((listView && showList) || (detailsView && showDetails)) {
      requestAnimationFrame(() => {
        if (listView && showList) listView.getBoundingClientRect();
        if (detailsView && showDetails) detailsView.getBoundingClientRect();
      });
    }

    // Enhanced logging: log both class and style.display after change
    this.logger.info('[ProjectDashboard] View state after update:', {
      listViewVisible: listView ? !listView.classList.contains('hidden') : false,
      detailsViewVisible: detailsView ? !detailsView.classList.contains('hidden') : false,
      listViewDisplay: listView?.style.display || 'N/A',
      detailsViewDisplay: detailsView?.style.display || 'N/A'
    });
  }

  _showLoginRequiredMessage() {
    this.state._aborted = true;
    const loginMessage = this.domAPI.getElementById('loginRequiredMessage');
    if (loginMessage) loginMessage.classList.remove('hidden');
    const mainContent = this.domAPI.getElementById('mainContent');
    if (mainContent) mainContent.classList.add('hidden');
    const sidebar = this.domAPI.getElementById('mainSidebar');
    if (sidebar && sidebar.contains(this.domAPI.getActiveElement())) {
      this.domAPI.getActiveElement().blur();
    }
    const projectViews = this.domAPI.querySelectorAll('#projectListView, #projectDetailsView');
    projectViews.forEach((view) => view.classList.add('hidden'));
  }

  async _initializeComponents() {
    this.logger.info('[ProjectDashboard] Initializing components...');

    // Ensure globalUtils and waitForDepsAndDom are available
    const waitForDepsAndDom = this.globalUtils?.waitForDepsAndDom;
    if (!waitForDepsAndDom) {
      this.logger.error('[ProjectDashboard] waitForDepsAndDom utility is not available via this.globalUtils. Component initialization might be unstable.');
      // Potentially throw an error or fallback to direct initialization if critical
    }

    // ProjectList
    if (this.components.projectList && !this.components.projectList.state?.initialized) {
      this.logger.info('[ProjectDashboard] Waiting for ProjectList DOM elements...');
      if (waitForDepsAndDom) {
        try {
          await waitForDepsAndDom({
            DependencySystem: this.getModule?.('DependencySystem') ?? (typeof window !== 'undefined' ? window.DependencySystem : null),
            domSelectors: ['#projectList', '#projectList .grid'], // Ensure #projectList and its internal grid are ready
            timeout: 5000,
            notify: this.logger, // Or use this.notificationHandler if preferred for user-facing timeout messages
            source: 'ProjectDashboard_InitProjectList'
          });
          this.logger.info('[ProjectDashboard] ProjectList DOM elements ready.');
        } catch (err) {
          this.logger.error('[ProjectDashboard] Timeout or error waiting for ProjectList DOM elements. Initialization may fail.', { error: err });
          // Decide if to proceed or throw
        }
      }
      this.components.projectList.onViewProject = this._handleViewProject.bind(this);
      await this.components.projectList.initialize(); // Initialize after explicit wait
      // Re-assign onViewProject as initialize might overwrite it if it's set in constructor directly
      this.components.projectList.onViewProject = this._handleViewProject.bind(this);
      this.logger.info('[ProjectDashboard] ProjectListComponent initialized.');
    } else if (this.components.projectList) {
      // Ensure onViewProject is correctly bound even if already initialized
      this.components.projectList.onViewProject = this._handleViewProject.bind(this);
    } else {
      this.logger.error('[ProjectDashboard] projectListComponent not found (DependencySystem).');
    }

    // ProjectDetails
    if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
      this.logger.info('[ProjectDashboard] Waiting for ProjectDetails DOM elements...');
      if (waitForDepsAndDom) {
        try {
          await waitForDepsAndDom({
            DependencySystem: this.getModule?.('DependencySystem') ?? (typeof window !== 'undefined' ? window.DependencySystem : null),
            domSelectors: [ // Ensure #projectDetailsView AND its critical children are ready
              '#projectDetailsView',
              '#projectTitle',
              '#backToProjectsBtn',
              '#projectDetailsView .tabs[role="tablist"]' // More specific selector for tabs
            ],
            timeout: 5000,
            notify: this.logger,
            source: 'ProjectDashboard_InitProjectDetails'
          });
          this.logger.info('[ProjectDashboard] ProjectDetails DOM elements ready.');
        } catch (err) {
          this.logger.error('[ProjectDashboard] Timeout or error waiting for ProjectDetails DOM elements. Initialization may fail.', { error: err });
          // Decide if to proceed or throw
        }
      }
      this.components.projectDetails.onBack = this._handleBackToList.bind(this);
      await this.components.projectDetails.initialize(); // Initialize after explicit wait
      this.logger.info('[ProjectDashboard] ProjectDetailsComponent initialized.');
    } else if (this.components.projectDetails) {
        // Ensure onBack is correctly bound
        this.components.projectDetails.onBack = this._handleBackToList.bind(this);
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
    // Delay event emission to ensure all components are ready and avoid UI race conditions.
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
      this.notificationHandler.show(
        'Project dashboard unavailable. Please refresh the page.',
        'error',
        { group: true, context: 'projectDashboard', module: 'ProjectDashboard', source: '_loadProjects' }
      );
      this.logger.error('[ProjectDashboard] app is null or undefined');
      return;
    }

    if (!this.app?.state?.isAuthenticated) {
      this.notificationHandler.show(
        'Not authenticated. Please log in to view projects.',
        'warning',
        { group: true, context: 'projectDashboard', module: 'ProjectDashboard', source: '_loadProjects' }
      );
      this.logger.warn('[ProjectDashboard] Not authenticated, cannot load projects. Auth state:', this.app?.state);
      return;
    }

    if (!this.projectManager) {
      this.notificationHandler.show(
        'Project manager unavailable. Please refresh the page.',
        'error',
        { group: true, context: 'projectDashboard', module: 'ProjectDashboard', source: '_loadProjects' }
      );
      this.logger.error('[ProjectDashboard] projectManager is null or undefined');
      return;
    }

    if (typeof this.projectManager.loadProjects !== 'function') {
      this.notificationHandler.show(
        'Cannot load projects. Project manager is incomplete.',
        'error',
        { group: true, context: 'projectDashboard', module: 'ProjectDashboard', source: '_loadProjects' }
      );
      this.logger.error('[ProjectDashboard] Cannot load projects: projectManager.loadProjects not available');
      return;
    }

    if (!this.browserService || typeof this.browserService.setTimeout !== 'function') {
      this.logger.error('[ProjectDashboard] browserService.setTimeout not available');
      // Fall back to direct execution if setTimeout isn't available
      this._executeProjectLoad();
      return;
    }

    // Defer project loading to avoid race conditions with UI/component initialization.
    this.browserService.setTimeout(() => this._executeProjectLoad(), 100);
  }

  // New helper method to encapsulate the loading logic
  _executeProjectLoad() {
    if (this.state._aborted) {
      this.logger.info('[ProjectDashboard] Project loading aborted before execution');
      return;
    }

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
        this.notificationHandler.show(
          'Failed to load projects. Please try again.',
          'error',
          { group: true, context: 'projectDashboard', module: 'ProjectDashboard', source: '_executeProjectLoad' }
        );
      });
  }

  _handlePopState() {
    this._processUrlParameters();
  }

  _handleViewProject(projectId) {
    // Push url then show – enables Back button
    history.pushState({}, '', this.browserService.buildUrl ? this.browserService.buildUrl({ project: projectId }) : `?project=${projectId}`);
    // Ensure project details are loaded (fixes missing details view)
    this.showProjectDetails(projectId);
  }

  _handleBackToList() {
    // Push url for list-view (no project param) then show list
    // Use DI-injected historyObject and location if available, else fallback with warning.
    // DI-only: Never use window globals for history/location. Fallback to null or '/' and log a warning.
    const historyObj = this.getModule && this.getModule('historyObject')
      ? this.getModule('historyObject')
      : (this.logger && typeof this.logger.warn === 'function' && this.logger.warn('[ProjectDashboard] No DI-injected historyObject available for pushState'), null);
    const pathname = this.browserService.getLocationPathname
      ? this.browserService.getLocationPathname()
      : (this.logger && typeof this.logger.warn === 'function' && this.logger.warn('[ProjectDashboard] No DI-injected location/pathname available, using \'/\''), '/');
    if (historyObj && typeof historyObj.pushState === 'function') {
      historyObj.pushState(
        {},
        '',
        this.browserService.buildUrl ? this.browserService.buildUrl({ project: '' }) : pathname
      );
    } else {
      this.logger.warn('[ProjectDashboard] No historyObject available for pushState');
    }
    this.showProjectList();
  }

  _handleAuthStateChange(event) {
    const { authenticated } = event.detail || {};
    this.browserService.requestAnimationFrame(() => {
      const loginRequiredMessage = document.getElementById('loginRequiredMessage');
      const mainContent = document.getElementById('mainContent');
      const projectListView = document.getElementById('projectListView');
      const projectDetailsView = document.getElementById('projectDetailsView');
      if (!authenticated) {
        if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
        if (mainContent) mainContent.classList.add('hidden');
        if (projectListView) projectListView.classList.add('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');
      } else {
        if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
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
          // Defer project loading and UI update to next tick after auth state change.
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
