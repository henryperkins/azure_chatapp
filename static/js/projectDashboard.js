/**
 * projectDashboard.js
 *
 * A fully remediated implementation of the ProjectDashboard, enforcing:
 * - Factory function export
 * - Strict DI & no top-level logic
 * - Pure imports
 * - Logging via DI logger
 * - HTML sanitization
 * - DOM readiness only via domReadinessService
 * - Single event bus for custom events
 * - Navigation via navigationService
 */

export function createProjectDashboard(deps) {
  // ─────────────────────────────────────────────────────────────────────────
  // 1) Validate dependencies upfront
  // ─────────────────────────────────────────────────────────────────────────
  if (!deps || typeof deps !== 'object') {
    throw new Error('[createProjectDashboard] A dependencies object is required.');
  }

  const {
    dependencySystem,
    domAPI,
    browserService,
    eventHandlers,
    domReadinessService,
    logger,
    sanitizer,
    APP_CONFIG
  } = deps;

  if (!dependencySystem) {
    throw new Error('[createProjectDashboard] Missing dependency: dependencySystem');
  }
  if (!domAPI) {
    throw new Error('[createProjectDashboard] Missing dependency: domAPI');
  }
  if (!browserService) {
    throw new Error('[createProjectDashboard] Missing dependency: browserService');
  }
  if (!eventHandlers) {
    throw new Error('[createProjectDashboard] Missing dependency: eventHandlers');
  }
  if (!domReadinessService) {
    throw new Error('[createProjectDashboard] Missing dependency: domReadinessService');
  }

  if (!logger) {
    throw new Error('[createProjectDashboard] logger dependency is required for observability');
  }
  if (!sanitizer) {
    throw new Error('[createProjectDashboard] sanitizer dependency is required');
  }
  if (!APP_CONFIG) {
    throw new Error('[createProjectDashboard] APP_CONFIG dependency is required');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2) Local event bus for the ProjectDashboard (avoid global doc events)
  // ─────────────────────────────────────────────────────────────────────────
  const dashboardBus = new EventTarget();

  // ─────────────────────────────────────────────────────────────────────────
  // 3) Class Definition: wrapped entirely inside the factory
  //    (no top-level logic)
  // ─────────────────────────────────────────────────────────────────────────
  class ProjectDashboard {
    constructor() {
      // Basic DI references
      this.dependencySystem = dependencySystem;
      this.domAPI = domAPI;
      this.browserService = browserService;
      this.domReadinessService = domReadinessService;
      this.eventHandlers = eventHandlers;
      this.logger = logger;
      this.sanitizer = sanitizer;
      this.dashboardBus = dashboardBus;

      // Modules retrieved from dependencySystem
      this.getModule = (key) => {
        const module = this.dependencySystem.modules.get(key);
        if (!module) {
          logger.error('[ProjectDashboard][getModule]', `Missing required module "${key}"`, { context: 'projectDashboard' });
          throw new Error(`[ProjectDashboard] Module "${key}" not found`);
        }
        return module;
      };

      try {
        this.app = this.getModule('app');
        this.projectManager = this.getModule('projectManager');
        this.auth = this.getModule('auth');
        this.navigationService = this.getModule('navigationService');
      } catch (err) {
        logger.error('[ProjectDashboard][constructor]', err, { context: 'projectDashboard' });
        throw err;
      }

      // Components
      this.components = {
        projectList: this.getModuleSafe('projectListComponent'),
        projectDetails: this.getModuleSafe('projectDetailsComponent')
      };

      // Additional checks
      this._verifyRequiredMethods();

      // Internal state
      this.state = {
        currentView: null,
        initialized: false,
        _aborted: false
      };
      this._viewsRegistered = false;
      this._unsubs = [];

      // Register minimal "stub" views first to avoid "unregistered view" errors
      this._ensureNavigationViews();

      // Listen for auth state changes on AuthBus
      const authBus = this.auth?.AuthBus;
      if (!authBus || typeof authBus.addEventListener !== 'function') {
        logger.error('[ProjectDashboard][constructor]', 'AuthBus with addEventListener not found', { context: 'projectDashboard' });
        throw new Error('[ProjectDashboard] AuthBus is required for auth state tracking.');
      }

      const safeAuthHandler = this._wrapHandler(
        this._onAuthStateChanged.bind(this),
        'authStateChangedGlobal'
      );
      const unsub = this.eventHandlers.trackListener(
        authBus,
        'authStateChanged',
        safeAuthHandler,
        { context: 'projectDashboard' }
      );
      if (typeof unsub === 'function') this._unsubs.push(unsub);
    }

    /**
     * Attempt to get a module from the system, but return null if missing.
     * Logs a warning instead of throwing.
     */
    getModuleSafe(key) {
      const mod = this.dependencySystem.modules.get(key);
      if (!mod) {
        logger.error('[ProjectDashboard][getModuleSafe]', `Optional module "${key}" not found`, { context: 'projectDashboard' });
        return null;
      }
      return mod;
    }

    /**
     * Verifies that essential modules and methods exist.
     */
    _verifyRequiredMethods() {
      if (!this.eventHandlers?.trackListener) {
        logger.error('[ProjectDashboard][constructor]', 'EventHandlers.trackListener is missing', { context: 'projectDashboard' });
        throw new Error('[ProjectDashboard] eventHandlers.trackListener is required');
      }
      if (!this.browserService) {
        throw new Error('[ProjectDashboard] browserService is required');
      }
      if (!this.domAPI) {
        throw new Error('[ProjectDashboard] domAPI is required for DOM manipulation');
      }
    }

    /**
     * Utility: wrap any event handler using canonical safeHandler from DI
     */
    _wrapHandler(handlerFn, description) {
      const safeHandler = this.dependencySystem.modules.get('safeHandler');
      if (!safeHandler) {
        logger.warn('[ProjectDashboard] safeHandler not available in DI, using fallback', { context: 'projectDashboard' });
        return (...args) => {
          try {
            return handlerFn(...args);
          } catch (err) {
            logger.error(`[ProjectDashboard][${description}]`, err, {
              context: 'projectDashboard'
            });
            throw err;
          }
        };
      }
      return safeHandler(handlerFn, `ProjectDashboard:${description}`);
    }

    /**
     * Public method: Initialize the ProjectDashboard
     */
    async initialize() {
      if (this.state.initialized) {
        return true; // Already done
      }

      const initStartTime = Date.now();
      try {
        /*
         * IMPORTANT: Do **not** block ProjectDashboard initialization on the
         * global `app:ready` event.  The dashboard itself is created and
         * initialized from within `initializeUIComponents()` *before* the
         * main app orchestrator emits `app:ready`.  Waiting here would cause
         * a circular dependency:
         *   1. App.init → initializeUIComponents → ProjectDashboard.initialize()
         *   2. ProjectDashboard.initialize() waits for `app:ready`
         *   3. App.init needs initializeUIComponents to finish before it can
         *      progress to the phase that emits `app:ready` ➔ dead-lock
         *
         * Instead we perform a fast synchronous check.  If the `appModule`
         * already reports `state.isReady` we treat the app as ready; if not
         * we continue without waiting—the dashboard listens to later auth and
         * navigation events and will hydrate views on demand.
         */
        const appModule = this.dependencySystem.modules.get('appModule');
        if (!appModule?.state?.isReady) {
          logger.debug?.('[ProjectDashboard] Proceeding before app:ready (bootstrap phase).', { context: 'projectDashboard' });
        }

        // Check authentication (read from app.state or auth module)
        // Lack of authentication at this stage is **not** an error – the user may
        // simply be visiting the landing page before logging in.  Treat it as a
        // normal control-flow branch and surface as a warning-level log instead
        // of an error to avoid noisy error tracking alerts.

        if (!this.auth?.isAuthenticated?.()) {
          logger.warn('[ProjectDashboard][initialize] User not authenticated – dashboard initialisation deferred until login.', { context: 'projectDashboard' });

          // Re-use the same handler that reacts to AuthBus updates so visual
          // feedback (login required message, hidden main content, etc.) is
          // consistent across eager and event-driven code-paths.
          this._onAuthStateChanged({ detail: { authenticated: false } });

          return false;
        }

        // Ensure required DOM elements are ready
        await domReadinessService.dependenciesAndElements({
          deps: ['app'],
          domSelectors: ['#mainContent'],
          context: 'ProjectDashboard_Init'
        });

        // Initialize sub-components
        await this._initializeComponents();
        this._setupEventListeners();
        this._registerNavigationViews();

        // CONSOLIDATED: Check initial authentication state from appModule.state (reuse existing appModule variable)
        const isAuthenticated = appModule?.state?.isAuthenticated ?? false;

        this.logger.debug('[ProjectDashboard][initialize] Checking initial auth state', {
          isAuthenticated,
          appModuleExists: !!appModule,
          context: 'projectDashboard'
        });

        // Si el usuario ya está autenticado, mostrar la vista de proyectos
        if (isAuthenticated) {
          try {
            await this.showProjectList();
          } catch (err) {
            this.logger.error('[ProjectDashboard][initialize] showProjectList failed', err, { context: 'projectDashboard' });
          }
        } else {
          // Show login required state
          const loginMsg = this.domAPI.getElementById('loginRequiredMessage');
          const mainCnt = this.domAPI.getElementById('mainContent');
          if (loginMsg) loginMsg.classList.remove('hidden');
          if (mainCnt) mainCnt.classList.add('hidden');
        }

        // Mark initialized
        this.state.initialized = true;
        const initDuration = Date.now() - initStartTime;

        // Dispatch an internal event on the local bus
        this.dashboardBus.dispatchEvent(
          new CustomEvent('projectDashboardInitialized', {
            detail: {
              success: true,
              timestamp: Date.now(),
              duration: initDuration
            }
          })
        );
        return true;
      } catch (err) {
        logger.error('[ProjectDashboard][initialize]', err, { context: 'projectDashboard' });
        this.state.initialized = false;
        const initDuration = Date.now() - initStartTime;

        this.dashboardBus.dispatchEvent(
          new CustomEvent('projectDashboardInitialized', {
            detail: {
              success: false,
              error: err,
              errorMessage: err?.message,
              timestamp: Date.now(),
              duration: initDuration
            }
          })
        );
        return false;
      }
    }

    /**
     * Cleanup method for unsubscribing from events, etc.
     */
    cleanup() {
      // Unsubscribe from any tracked listeners
      if (this._unsubs?.length) {
        this._unsubs.forEach((unsub) => {
          try {
            unsub?.();
          } catch (err) {
            logger.error('[ProjectDashboard][cleanup]', err, { context: 'projectDashboard' });
          }
        });
        this._unsubs = [];
      }

      // Use eventHandlers cleanup
      if (this.eventHandlers?.cleanupListeners) {
        this.eventHandlers.cleanupListeners({ context: 'projectDashboard' });
      }

      // Detach any local-bus listeners and null-out the bus
      this.dashboardBus?.dispatchEvent(new Event('dashboardDestroyed'));
      this.dashboardBus = null;

      // Cleanup readiness service if applicable
      if (typeof this.domReadinessService.destroy === 'function') {
        try {
          this.domReadinessService.destroy();
        } catch (err) {
          logger.error('[ProjectDashboard][_initializeComponents:detailsTemplate]', err, {
            context: 'projectDashboard'
          });
        }
      }
    }

    /**
     * Show the list of projects.
     */
    async showProjectList() {
      try {
        await domReadinessService.dependenciesAndElements({
          deps: ['app'],
          domSelectors: ['#projectListView'],
          context: 'ProjectDashboard_showList'
        });

        this.state.currentView = 'list';
        this.app.setCurrentProject?.(null); // usage depends on your app interface
        this.browserService.removeSearchParam?.('project');
        this.browserService.removeSearchParam?.('chatId');

        // Toggle UI
        this._setView({ showList: true, showDetails: false });
        if (this.components.projectDetails) {
          this.components.projectDetails.hide?.();
        }

        // Initialize projectList component if not already
        if (this.components.projectList && !this.components.projectList.state?.initialized) {
          try {
            await this.components.projectList.initialize();
          } catch (err) {
            logger.error('[ProjectDashboard][showProjectList:initializeList]', err, { context: 'projectDashboard' });
            return;
          }
        }

        this.components.projectList?.show();
        this._loadProjects();
      } catch (err) {
        logger.error('[ProjectDashboard][showProjectList]', err && err.stack ? err.stack : err, {
          context: 'projectDashboard'
        });
      }
    }

    /**
     * Show details for a given project (by object or ID).
     */
    async showProjectDetails(projectObjOrId) {
      let project = null;
      let projectId = null;
      const currentLoadId = Symbol('loadId');
      this._lastLoadId = currentLoadId;

      try {
        // Determine if argument is an object or a string
        if (typeof projectObjOrId === 'object' && projectObjOrId?.id) {
          project = projectObjOrId;
          projectId = projectObjOrId.id;
        } else if (typeof projectObjOrId === 'string') {
          projectId = projectObjOrId;
        } else {
          await this.showProjectList();
          return false;
        }

        // Initialize projectDetails component if needed
        if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
          try {
            await this.components.projectDetails.initialize();
          } catch (err) {
            logger.error('[ProjectDashboard][showProjectDetails:initializeDetails]', err, { context: 'projectDashboard' });
            throw err;
          }
        }

        // If no project object supplied, load from projectManager
        if (!project) {
          // CONSOLIDATED: Check authentication state from appModule.state
          const appModuleRef = this.app?.DependencySystem?.modules?.get?.('appModule');
          const isAuthenticated = appModuleRef?.state?.isAuthenticated ?? false;

          if (isAuthenticated && this.projectManager?.loadProjectDetails) {
            project = await this.projectManager.loadProjectDetails(projectId);
            if (!project) {
              await this.showProjectList();
              return false;
            }
          } else {
            await this.showProjectList();
            return false;
          }
        }

        if (this._lastLoadId !== currentLoadId) {
          // Another load took place, cancel
          return false;
        }

        // Switch UI to details and render via component show()
        this._setView({ showList: false, showDetails: true });
        this.components.projectList?.hide?.();
        await this.components.projectDetails?.show?.({ projectId });

        // Post success: set search param, handle default conversation, dispatch events
        return this._postProjectDetailsSuccess(project, projectId, typeof projectObjOrId === 'object');
      } catch (err) {
        logger.error('[ProjectDashboard][showProjectDetails:outerCatch]', err, { context: 'projectDashboard' });
        await this.showProjectList();
        return false;
      }
    }

    /**
     * Post success logic after showing project details
     */
    _postProjectDetailsSuccess(project, projectId, wasFullObject) {
      this.browserService.setSearchParam?.('project', projectId);
      this.state.currentView = 'details';

      // If project has conversations, set the first as default in search param
      if (Array.isArray(project.conversations) && project.conversations.length > 0) {
        const conv = project.conversations[0];
        if (conv?.id) {
          this.browserService.setSearchParam?.('chatId', conv.id);
        }
      }

      // Optionally dispatch 'projectLoaded' if we originally had the full object
      if (wasFullObject && project?.id) {
        this.dashboardBus.dispatchEvent(
          new CustomEvent('projectLoaded', { detail: project })
        );
      }

      // Initialize chat manager if available
      const chatManager = this.getModuleSafe('chatManager');
      if (chatManager && typeof chatManager.initialize === 'function') {
        Promise.resolve(chatManager.initialize({ projectId })).catch((err) => {
          logger.error('[ProjectDashboard][_postProjectDetailsSuccess:chatManager]', err, {
            context: 'projectDashboard'
          });
        });
      }

      return true;
    }

    /**
     * Load the list of projects from the projectManager
     */
    _loadProjects() {
      if (this.state._aborted) {
        return;
      }

      // CONSOLIDATED: Single source of truth - only check app.state
      const isAuthed = this.app?.state?.isAuthenticated;

      if (!isAuthed) {
        // Wait a bit and retry if user logs in
        this.browserService.setTimeout(() => {
          if (this.app?.state?.isAuthenticated) {
            this._loadProjects();
          }
        }, 500);
        return;
      }

      if (!this.projectManager || typeof this.projectManager.loadProjects !== 'function') {
        return;
      }

      this.browserService.setTimeout(() => this._executeProjectLoad(), 100);
    }

    /**
     * Actually call projectManager.loadProjects
     */
    _executeProjectLoad() {
      if (this.state._aborted) {
        return;
      }
      this.projectManager
        .loadProjects('all')
        .then(() => {
          // success, no direct log needed unless debugging
        })
        .catch((err) => {
          logger.error('[ProjectDashboard][_executeProjectLoad]', err, { context: 'projectDashboard' });
        });
    }

    /**
     * Setup centralized event listeners with safe handlers
     */
    _setupEventListeners() {
      const doc = this.domAPI.getDocument();
      const add = (target, event, handler, opts = {}) => {
        if (!this.eventHandlers?.trackListener) {
          logger.error('[ProjectDashboard][_setupEventListeners]', 'Missing trackListener', { context: 'projectDashboard' });
          throw new Error('[ProjectDashboard] eventHandlers.trackListener is required');
        }
        const safeHandler = this._wrapHandler(handler, `Evt_${event}`);
        const optionsWithContext = { ...opts, context: 'projectDashboard' };
        // trackListener _already_ stores its own removal; capture the returned unsub if provided.
        const maybeUnsub = this.eventHandlers.trackListener(
          target,
          event,
          safeHandler,
          optionsWithContext
        );
        if (typeof maybeUnsub === 'function') {
          this._unsubs.push(maybeUnsub);
        }
      };

      // Example events: define as needed
      add(doc, 'projectsLoaded', this._handleProjectsLoaded.bind(this), {
        description: 'Dashboard: projectsLoaded'
      });
      add(doc, 'projectLoaded', this._handleProjectLoaded.bind(this), {
        description: 'Dashboard: projectLoaded'
      });
      add(doc, 'projectStatsLoaded', this._handleProjectStatsLoaded.bind(this), {
        description: 'Dashboard: projectStatsLoaded'
      });
      add(doc, 'projectFilesLoaded', this._handleFilesLoaded.bind(this), {
        description: 'Dashboard: projectFilesLoaded'
      });
      add(doc, 'projectArtifactsLoaded', this._handleArtifactsLoaded.bind(this), {
        description: 'Dashboard: projectArtifactsLoaded'
      });
      add(doc, 'projectNotFound', this._handleProjectNotFound.bind(this), {
        description: 'Dashboard: projectNotFound'
      });
      add(doc, 'projectCreated', this._handleProjectCreated.bind(this), {
        description: 'Dashboard: projectCreated'
      });
      add(doc, 'authStateChanged', this._handleAuthStateChange.bind(this), {
        description: 'Dashboard: authStateChanged(global)'
      });
      add(doc, 'auth:stateChanged', this._handleAuthStateChange.bind(this), {
        description: 'Dashboard: auth:stateChanged(global)'
      });
      add(doc, 'projectDeleted', this._handleProjectDeleted.bind(this), {
        description: 'Dashboard: projectDeleted'
      });
    }

    // ───────────────────────────────────────────────────────────────────────────
    //  Event handlers
    // ───────────────────────────────────────────────────────────────────────────

    _handleProjectsLoaded(e) {
      const { projects = [], error = false, message } = e.detail || {};
      if (error) {
        if (this.components.projectList?._showErrorState) {
          // Provide some user feedback
          this.components.projectList._showErrorState(message || 'Failed to load projects');
        }
        return;
      }
      // Render projects
      this.browserService.requestAnimationFrame(() => {
        this.components.projectList?.renderProjects?.({ projects });
      });
    }

    _handleProjectLoaded(e) {
      const project = e.detail;
      (async () => {
        try {
          await this.domReadinessService.dependenciesAndElements({
            deps: ['app'],
            domSelectors: [],
            context: 'ProjectDashboard_appReady'
          });
          this.app.setCurrentProject?.(project || null);
        } catch (err) {
          logger.error('[ProjectDashboard][_handleProjectLoaded]', err, {
            context: 'projectDashboard'
          });
        }
      })();
      this.browserService.requestAnimationFrame(() => {
        this.components.projectDetails?.renderProject?.(project);
      });
    }

    _handleProjectStatsLoaded(e) {
      const stats = e.detail;
      this.browserService.requestAnimationFrame(() => {
        this.components.projectDetails?.renderStats?.(stats);
      });
    }

    _handleFilesLoaded(e) {
      const { files } = e.detail || {};
      this.browserService.requestAnimationFrame(() => {
        this.components.projectDetails?.renderFiles?.(files);
      });
    }

    _handleArtifactsLoaded(e) {
      const { artifacts } = e.detail || {};
      this.browserService.requestAnimationFrame(() => {
        this.components.projectDetails?.renderArtifacts?.(artifacts);
      });
    }

    _handleProjectNotFound(e) {
      const { projectId } = e.detail || {};
      // CONSOLIDATED: Use canonical appModule state instead of local state
      this.app.setCurrentProject?.(null);
      const detailsView = this.domAPI.getElementById('projectDetailsView');
      if (detailsView) {
        detailsView.classList.add('hidden');
        detailsView.style.display = 'none';
      }
      this.showProjectList();
    }

    _handleProjectCreated(e) {
      const project = e.detail;
      if (project?.id) {
        // Possibly schedule post-creation events
        this.browserService.setTimeout(() => {
          const pId = project.id;
          // Fire some "rendered" events
          const events = [
            'projectStatsRendered',
            'projectFilesRendered',
            'projectConversationsRendered',
            'projectArtifactsRendered',
            'projectKnowledgeBaseRendered'
          ];
          events.forEach((evName) => {
            this.dashboardBus.dispatchEvent(
              new CustomEvent(evName, { detail: { projectId: pId } })
            );
          });
        }, 3000);
      }
      this.showProjectDetails(project);
      this.browserService.setItem?.('selectedProjectId', project.id);
    }

    _handleAuthStateChange(event) {
      const { authenticated } = event.detail || {};
      this.browserService.requestAnimationFrame(() => {
        const loginRequiredMessage = this.domAPI.getElementById('loginRequiredMessage');
        const mainContent = this.domAPI.getElementById('mainContent');
        const projectListView = this.domAPI.getElementById('projectListView');
        const projectDetailsView = this.domAPI.getElementById('projectDetailsView');

        if (!authenticated) {
          if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
          if (mainContent) mainContent.classList.add('hidden');
          if (projectListView) projectListView.classList.add('hidden');
          if (projectDetailsView) projectDetailsView.classList.add('hidden');
          this.state._aborted = true;
        } else {
          this.state._aborted = false;
          if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');
          if (mainContent) mainContent.classList.remove('hidden');
          this.state.currentView = 'list';
          // CONSOLIDATED: Use canonical appModule state instead of local state
          this.app.setCurrentProject?.(null);
          this.browserService.removeSearchParam?.('project');

          if (projectListView) {
            projectListView.classList.remove('hidden', 'opacity-0');
            projectListView.style.display = '';
            void projectListView.offsetHeight;
          }
          if (projectDetailsView) projectDetailsView.classList.add('hidden');

          // If components not initialized, do so
          const isProjectListInited = this.components.projectList?.state?.initialized;
          if (!isProjectListInited) {
            this._initializeComponents()
              .then(() => {
                this.components.projectList?.show();
                this._loadProjects();
              })
              .catch((err) => {
                logger.error('[ProjectDashboard][_handleAuthStateChange]', err, {
                  context: 'projectDashboard'
                });
              });
          } else {
            this.components.projectList?.show();
            this.components.projectDetails?.hide();
            this.browserService.setTimeout(() => {
              this._loadProjects();
              this.browserService.setTimeout(() => {
                const plv = this.domAPI.getElementById('projectListView');
                if (plv) {
                  plv.classList.remove('opacity-0');
                  plv.style.display = '';
                  plv.classList.remove('hidden');
                }
              }, 100);
            }, 300);
          }
        }
      });
    }

    /**
     * Separate from global auth changes: local auth event
     */
    _onAuthStateChanged(e) {
      const { authenticated } = e.detail || {};
      if (!authenticated) {
        this.state._aborted = true;
        const loginMsg = this.domAPI.getElementById('loginRequiredMessage');
        const mainCnt = this.domAPI.getElementById('mainContent');
        if (loginMsg) loginMsg.classList.remove('hidden');
        if (mainCnt) mainCnt.classList.add('hidden');
        return;
      }
      this.state._aborted = false;
      this.initialize().catch((err) => {
        logger.error('[ProjectDashboard][_onAuthStateChanged]', err, { context: 'projectDashboard' });
      });
    }

    _handleProjectDeleted(e) {
      const { projectId } = e.detail || {};
      (async () => {
        try {
          await this.domReadinessService.dependenciesAndElements({
            deps: ['app'],
            domSelectors: [],
            context: 'ProjectDashboard_appReady'
          });
          const currentProject = this.app?.getCurrentProject?.();
          if (currentProject?.id === projectId) {
            await this.showProjectList();
          } else {
            if (this.state.currentView === 'list') {
              this._loadProjects();
            }
          }
        } catch (err) {
          logger.error('[ProjectDashboard][_handleProjectDeleted]', err, { context: 'projectDashboard' });
        }
      })();
    }

    /**
     * Ensure main views are at least stub-registered.
     */
    _ensureNavigationViews() {
      if (this._viewsRegistered || !this.navigationService?.registerView) return;
      try {
        this.navigationService.registerView('projectList', {
          show: async () => {                       // delegate to real logic
            try { await this.showProjectList(); } catch {
              // Ignore navigation failures to keep dashboard robust (view not found, etc.)
              return false;
            }
            return true;
          },
          hide: async () => {
            try { this.components.projectList?.hide?.(); } catch {
              // Ignore errors during hide - likely uninitialized, no critical error
            }
            return true;
          }
        });
      } catch (err) {
        // ignore duplicate navigation view registration
      }

      try {
        this.navigationService.registerView('projectDetails', {
          show: async (params = {}) => {
            const { projectId, activeTab, conversationId } = params;
            if (!projectId) return false;
            try {
              await this.showProjectDetails(projectId);
              if (activeTab && this.components.projectDetails?.switchTab) {
                this.components.projectDetails.switchTab(activeTab);
              }
              // (optional) handle conversationId here if needed
            } catch (err) {
              // if initialization or nav failed, do not proceed
              return false;
            }
            return true;
          },
          hide: async () => {
            try { this.components.projectDetails?.hide?.(); } catch (err) {
              // ignore errors during component hide
            }
            return true;
          }
        });
      } catch (err) {
        // ignore duplicate navigation view registration
      }
      this._viewsRegistered = true;
    }

    /**
     * Register final show/hide for projectList & projectDetails.
     */
    _registerNavigationViews() {
      if (!this.navigationService?.registerView) return;
      try {
        // projectList
        this.navigationService.registerView('projectList', {
          show: async () => {
            await this.showProjectList();
            return true;
          },
          hide: async () => {
            this.components.projectList?.hide?.();
            return true;
          }
        });
      } catch (err) {
        logger.error('[ProjectDashboard][_registerNavigationViews:projectList]', err, {
          context: 'projectDashboard'
        });
      }

      try {
        // projectDetails
        this.navigationService.registerView('projectDetails', {
          show: async (params = {}) => {
            const { projectId, conversationId, activeTab } = params;
            if (!projectId) {
              this.navigationService.navigateTo('projectList');
              return false;
            }
            // Switch UI
            this._setView({ showList: false, showDetails: true });
            if (!this.components.projectDetails) {
              this.navigationService.navigateTo('projectList');
              return false;
            }

            await this.components.projectDetails.show({ projectId, activeTab });
            let projectToRender = null;
            if (typeof this.projectManager?.loadProjectDetails === 'function') {
              try {
                projectToRender = await this.projectManager.loadProjectDetails(projectId);
              } catch (error) {
                logger.error('[ProjectDashboard][detailsViewShow:loadProjectDetails]', error, {
                  context: 'projectDashboard'
                });
                // If load fails, an event may be dispatched that triggers showProjectList
                return false;
              }
            }
            if (!projectToRender) {
              // Possibly a 404
              this.navigationService.navigateTo('projectList');
              return false;
            }

            // Render the project
            this.components.projectDetails.renderProject?.(projectToRender);
            // Possibly load conversation
            if (conversationId && this.components.projectDetails.loadConversation) {
              this.components.projectDetails.switchTab?.(activeTab || 'conversations');
              await this.components.projectDetails.loadConversation(conversationId);
            } else if (activeTab && this.components.projectDetails.switchTab) {
              this.components.projectDetails.switchTab(activeTab);
            }
            return true;
          },
          hide: async () => {
            this.components.projectDetails?.hide?.();
            return true;
          }
        });
      } catch (err) {
        logger.error('[ProjectDashboard][_registerNavigationViews:projectDetails]', err, {
          context: 'projectDashboard'
        });
      }
    }

    /**
     * Initialize sub-components, waiting for relevant DOM elements.
     */
    async _initializeComponents() {
      // Reload references in case new modules arrived
      this.components.projectList = this.components.projectList || this.getModuleSafe('projectListComponent');
      this.components.projectDetails =
        this.components.projectDetails || this.getModuleSafe('projectDetailsComponent');

      // ------------------------------------------------------------------
      // 1) Wait for Project-Details template if it hasn’t already been loaded
      // ------------------------------------------------------------------
      const detailsTemplateAlreadyLoaded = (() => {
        try {
          // Fast heuristics: component reports templateLoaded OR DOM element exists
          if (this.components.projectDetails?.state?.templateLoaded) return true;
          const detailsViewEl = this.domAPI.getElementById('projectDetailsView');
          return !!(detailsViewEl && detailsViewEl.childElementCount > 0);
        } catch {
          return false;
        }
      })();

      if (!detailsTemplateAlreadyLoaded) {
        try {
          await this.domReadinessService.waitForEvent('projectDetailsTemplateLoaded', {
            timeout: 8000,
            context: 'ProjectDashboard_template'
          });
        } catch (err) {
          // This is non-fatal; log as warn to avoid noisy error reporting
          logger.warn('[ProjectDashboard][_initializeComponents:detailsTemplate] Event timeout – continuing', {
            err: err?.message || err,
            context: 'projectDashboard'
          });
        }
      }

      // ------------------------------------------------------------------
      // 2) Wait for Project-List template if it hasn’t already been loaded
      // ------------------------------------------------------------------
      const listTemplateAlreadyLoaded = (() => {
        try {
          if (this.components.projectList?.state?.templateLoaded) return true;
          const listViewEl = this.domAPI.getElementById('projectListView');
          return !!(listViewEl && listViewEl.childElementCount > 0);
        } catch {
          return false;
        }
      })();

      if (!listTemplateAlreadyLoaded) {
        try {
          await this.domReadinessService.waitForEvent('projectListHtmlLoaded', {
            timeout: 8000,
            context: 'ProjectDashboard_template'
          });
        } catch (err) {
          logger.warn('[ProjectDashboard][_initializeComponents:listTemplate] Event timeout – continuing', {
            err: err?.message || err,
            context: 'projectDashboard'
          });
        }
      }

      // Initialise child components only once the app is fully ready to avoid
      // premature waits for the `app:ready` event inside their own logic.
      // Always attempt to initialize ProjectListComponent; do not block on appIsReady
      if (this.components.projectList && !this.components.projectList.state?.initialized) {
        try {
          await this.domReadinessService.dependenciesAndElements({
            domSelectors: ['#projectListView'],
            timeout: 5000,
            context: 'ProjectDashboard_InitProjectList'
          });
          await this.components.projectList.initialize();
        } catch (err) {
          logger.error('[ProjectDashboard][_initializeComponents:projectList]', err, {
            context: 'projectDashboard'
          });
        }
      }

      // Retain appIsReady check for details, as details may depend on full app config
      const appIsReady = this.dependencySystem.modules.get('appModule')?.state?.isReady === true;
      if (appIsReady && this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
        try {
          await this.domReadinessService.dependenciesAndElements({
            domSelectors: ['#projectDetailsView'],
            timeout: 5000,
            context: 'ProjectDashboard_InitProjectDetails'
          });
          await this.components.projectDetails.initialize();
        } catch (err) {
          logger.error('[ProjectDashboard][_initializeComponents:projectDetails]', err, {
            context: 'projectDashboard'
          });
        }
      } else if (!appIsReady) {
        logger.debug?.('[ProjectDashboard] Skipping early ProjectDetailsComponent initialization – waiting for app:ready.', {
          context: 'projectDashboard'
        });
      }
    }

    /**
     * Core helper to toggle list vs. details in the DOM
     */
    _setView({ showList, showDetails }) {
      if (this.state._aborted) return;

      // Hide login message
      const loginMessage = this.domAPI.getElementById('loginRequiredMessage');
      if (loginMessage) this.domAPI.toggleClass(loginMessage, 'hidden', true);
      const mainContent = this.domAPI.getElementById('mainContent');
      if (mainContent) this.domAPI.toggleClass(mainContent, 'hidden', false);

      // List view controlling
      const listView = this.domAPI.getElementById('projectListView');
      if (listView) {
        this.domAPI.toggleClass(listView, 'hidden', !showList);
        this.domAPI.toggleClass(listView, 'opacity-0', !showList);
        this.domAPI.setStyle(listView, 'display', showList ? '' : 'none');
      }

      // Details
      const detailsView = this.domAPI.getElementById('projectDetailsView');
      if (detailsView) {
        this.domAPI.toggleClass(detailsView, 'hidden', !showDetails);
        this.domAPI.toggleClass(detailsView, 'opacity-0', !showDetails);
        this.domAPI.setStyle(detailsView, 'display', showDetails ? 'flex' : 'none');
      }
    }

    /**
     * Example method for safely inserting HTML from server:
     */
    _insertTemplate(containerEl, incomingHtml) {
      // Must sanitize per guardrails
      containerEl.innerHTML = this.sanitizer.sanitize(incomingHtml);
    }
  } // End of ProjectDashboard class

  // ─────────────────────────────────────────────────────────────────────────
  // 4) Instantiate the dashboard & return with a cleanup() method
  // ─────────────────────────────────────────────────────────────────────────
  const dashboard = new ProjectDashboard();

  // ==== Speculative/Eager Project Details Template Loading (wait for container) ====
  // Try to find htmlTemplateLoader in dependency system and trigger load
  try {
    const htmlTemplateLoader =
      dependencySystem?.modules?.get?.('htmlTemplateLoader') ||
      (dashboard.components.projectDetails && dashboard.components.projectDetails.htmlTemplateLoader);
    if (htmlTemplateLoader?.loadTemplate) {
      const drs = dependencySystem?.modules?.get?.('domReadinessService');

      const loadDetailsTemplate = () =>
        htmlTemplateLoader.loadTemplate({
          url: '/static/html/project_details.html',
          containerSelector: '#projectDetailsView',
          eventName: 'projectDetailsTemplateLoaded'
        });

      /* Ensure #projectDetailsView exists before loading template */
      if (drs?.elementsReady) {
        drs.elementsReady('#projectDetailsView', {
          timeout: 8000,
          context: 'ProjectDashboard::detailsTplContainer'
        })
          .then(loadDetailsTemplate)
          .catch(loadDetailsTemplate);          // fallback – still attempt
      } else {
        loadDetailsTemplate().catch(() => { });
      }
    }
  } catch (err) {
    logger.warn('[ProjectDashboard] Unable to fire-and-forget details template load', err, { context: 'projectDashboard' });
  }

  // ==== Speculative/Eager Project List Template Loading (wait for container) ====
  try {
    const htmlTemplateLoader =
      dependencySystem?.modules?.get?.('htmlTemplateLoader');

    if (htmlTemplateLoader?.loadTemplate) {
      const drs = dependencySystem?.modules?.get?.('domReadinessService');

      const loadListTemplate = () =>
        htmlTemplateLoader.loadTemplate({
          url: '/static/html/project_list.html',
          containerSelector: '#projectListView',
          eventName: 'projectListHtmlLoaded'
        });

      /* Ensure #projectListView exists before loading template */
      if (drs?.elementsReady) {
        drs.elementsReady('#projectListView', {
          timeout: 8000,
          context: 'ProjectDashboard::listTplContainer'
        })
          .then(loadListTemplate)
          .catch(loadListTemplate);      // fallback – still attempt
      } else {
        loadListTemplate().catch(() => { });
      }
    }
  } catch (err) {
    logger.warn(
      '[ProjectDashboard] Unable to fire-and-forget list template load',
      err,
      { context: 'projectDashboard' }
    );
  }

  function cleanup() {
    dashboard.cleanup();
  }

  // Return an API exposing .initialize() and .cleanup(), plus any additional
  // methods you want to make publicly accessible
  return {
    initialize: dashboard.initialize.bind(dashboard),
    showProjectList: dashboard.showProjectList.bind(dashboard),
    showProjectDetails: dashboard.showProjectDetails.bind(dashboard),
    cleanup: dashboard.cleanup.bind(dashboard),
    // Optionally expose the local bus if needed:
    dashboardBus: dashboard.dashboardBus,
    setProjectListComponent: (component) => {
      if (dashboard.components) dashboard.components.projectList = component;
      else dashboard.logger.warn('[ProjectDashboard] Components object not ready for projectList', { context: 'projectDashboard' });
    },
    setProjectDetailsComponent: (component) => {
      if (dashboard.components) dashboard.components.projectDetails = component;
      else dashboard.logger.warn('[ProjectDashboard] Components object not ready for projectDetails', { context: 'projectDashboard' });
    }
  };
}
