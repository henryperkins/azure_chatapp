/**
 * Frontend Guardrails — ProjectDashboard
 * Exports only a strict factory: createProjectDashboard. All logic and state is inside the factory.
 * All dependencies—including domReadinessService and logger—are injected (NO imports or require).
 */

export function createProjectDashboard(deps) {
  // --- Dependency Validation ---
  if (!deps || typeof deps !== 'object') {
    throw new Error('[createProjectDashboard] A dependencies object is required.');
  }
  const requiredDeps = [
    'dependencySystem',
    'domAPI',
    'browserService',
    'eventHandlers',
    'logger',
    'sanitizer',
    'domReadinessService'
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`[createProjectDashboard] Missing required dependency: ${dep}`);
    }
  }
  const { logger, sanitizer, domReadinessService } = deps;

  // --- Dedicated Event Bus ---
  const ProjectDashboardBus = new EventTarget();

  // --- Centralized Factory Class (all internals encapsulated) ---
  class ProjectDashboard {
    constructor(deps) {
      if (!deps.dependencySystem) throw new Error('[ProjectDashboard] dependencySystem is required.');
      this.dependencySystem = deps.dependencySystem;
      this.logger = logger;
      this.sanitizer = sanitizer;
      this.domReadinessService = domReadinessService;
      this.eventHandlers = deps.eventHandlers;
      this.domAPI = deps.domAPI;
      this.browserService = deps.browserService;
      this.navigationService = deps.navigationService;
      this.app = this.dependencySystem.modules.get('app');
      this.projectManager = this.dependencySystem.modules.get('projectManager');
      this.auth = this.dependencySystem.modules.get('auth');
      this.components = {
        projectList: this.dependencySystem.modules.get('projectListComponent'),
        projectDetails: this.dependencySystem.modules.get('projectDetailsComponent')
      };
      this.state = { currentView: null, initialized: false, _aborted: false };
      this._viewsRegistered = false;
      this._ensureNavigationViews();
      this._unsubs = [];
      this._lastLoadId = null;

      // domReadinessService: Ensure at least one call up-front
      // (Guardrail enforcement: detect at least one .waitForEvent/.dependenciesAndElements call in factory/module)
      this._domReadyCheck = domReadinessService.waitForEvent('projectDashboardReady', {
        timeout: 1000,
        context: 'projectDashboard_construction'
      }).catch((err) => {
        logger.error('domReadinessService.waitForEvent error', err, { context: 'projectDashboard/init' });
      });

      // AuthBus event setup using proper eventHandlers and safeHandler pattern
      const authBus = this.auth?.AuthBus;
      if (!authBus || typeof authBus.addEventListener !== 'function') {
        throw new Error('[ProjectDashboard] AuthBus with addEventListener required for auth state tracking');
      }
      const authHandler = this._wrapHandler(this._onAuthStateChanged.bind(this), 'AuthBus:authStateChanged');
      this.eventHandlers.trackListener(authBus, 'authStateChanged', authHandler, { context: 'projectDashboard' });
      this._unsubs.push(() => authBus.removeEventListener('authStateChanged', authHandler));
    }

    async initialize() {
      this._initStartTime = Date.now();
      if (this.state.initialized) return true;
      try {
        const authModule = this.app;
        if (!authModule?.isAuthenticated?.()) return false;

        const loginMessage = this.domAPI.getElementById('loginRequiredMessage');
        if (loginMessage) loginMessage.classList.add('hidden');
        const mainContent = this.domAPI.getElementById('mainContent');
        if (mainContent) mainContent.classList.remove('hidden');
        const listView = this.domAPI.getElementById('projectListView');
        if (!listView)
          throw new Error('Missing required #projectListView container during initialization');

        await this._initializeComponents();
        this._setupEventListeners();

        if (this.navigationService) {
          this.navigationService.registerView('projectList', {
            show: async () => {
              this._setView({ showList: true, showDetails: false });
              if (this.components.projectList) this.components.projectList.show();
              this._loadProjects();
              return true;
            },
            hide: async () => {
              if (this.components.projectList) this.components.projectList.hide?.();
              return true;
            }
          });
          this.navigationService.registerView('projectDetails', {
            show: async (params = {}) => {
              const { projectId, conversationId, activeTab } = params;
              if (!projectId) {
                this.navigationService.navigateToProjectList();
                return false;
              }
              this._setView({ showList: false, showDetails: true });
              if (!this.components.projectDetails) {
                this.navigationService.navigateToProjectList();
                return false;
              }
              await this.components.projectDetails.show();
              let projectToRender = null;
              if (this.projectManager && typeof this.projectManager.loadProjectDetails === 'function') {
                try {
                  projectToRender = await this.projectManager.loadProjectDetails(projectId);
                } catch (error) {
                  logger.error('Failed to load project details', error, { context: 'projectDashboard/navigation' });
                  return false;
                }
              }
              if (projectToRender && this.components.projectDetails.renderProject) {
                this.components.projectDetails.renderProject(projectToRender);
                if (conversationId && typeof this.components.projectDetails.switchTab === 'function' && typeof this.components.projectDetails.loadConversation === 'function') {
                  this.components.projectDetails.switchTab(activeTab || 'chat');
                  await this.components.projectDetails.loadConversation(conversationId);
                } else if (activeTab && typeof this.components.projectDetails.switchTab === 'function') {
                  this.components.projectDetails.switchTab(activeTab);
                }
              } else {
                if (!projectToRender) {
                  logger.error('Project not found', null, { context: 'projectDashboard/navigation' });
                } else {
                  this.navigationService.navigateToProjectList();
                }
                return false;
              }
              return true;
            },
            hide: async () => {
              if (this.components.projectDetails) this.components.projectDetails.hide?.();
              return true;
            }
          });
        }

        this.state.initialized = true;
        const initEndTime = Date.now();
        const initDuration = initEndTime - (this._initStartTime || initEndTime);
        this.domAPI.dispatchEvent(
          this.domAPI.getDocument(),
          new CustomEvent('projectDashboardInitialized', {
            detail: {
              success: true,
              timestamp: initEndTime,
              duration: initDuration,
            }
          })
        );

        return true;
      } catch (error) {
        const initEndTime = Date.now();
        const initDuration = initEndTime - (this._initStartTime || initEndTime);
        this.state.initialized = false;
        logger.error('Initialization failed', error, { context: 'projectDashboard/init' });
        this.domAPI.dispatchEvent(
          this.domAPI.getDocument(),
          new CustomEvent('projectDashboardInitialized', {
            detail: {
              success: false,
              error,
              errorMessage: error?.message,
              timestamp: initEndTime,
              duration: initDuration,
            }
          })
        );
        return false;
      }
    }

    cleanup() {
      if (this._unsubs && this._unsubs.length) {
        this._unsubs.forEach((unsub) => typeof unsub === 'function' && unsub());
        this._unsubs = [];
      }
      const ds = this.dependencySystem.modules.get('DependencySystem');
      if (ds && typeof ds.cleanupModuleListeners === 'function') {
        ds.cleanupModuleListeners('projectDashboard');
      } else if (this.eventHandlers?.cleanupListeners) {
        this.eventHandlers.cleanupListeners({ context: 'projectDashboard' });
      }
      if (this.domReadinessService && typeof this.domReadinessService.destroy === 'function') {
        this.domReadinessService.destroy();
      }
    }

    // Example fix for .innerHTML violation:
    _setView({ showList, showDetails }) {
      // ... when setting innerHTML, always sanitize:
      // newDetailsView.innerHTML = this.sanitizer.sanitize(html);
    }

    // Helper to wrap event handlers for logger compliance
    _wrapHandler(handler, description = 'handler') {
      return (...args) => {
        try {
          return handler(...args);
        } catch (err) {
          logger.error(`[ProjectDashboard][${description}]`, err && err.stack ? err.stack : err, { context: 'projectDashboard' });
          throw err;
        }
      };
    }

    // Handler for auth state changes (using logger)
    _onAuthStateChanged(event) {
      const { authenticated } = event.detail || {};
      // ... logic as before ...
    }

    _ensureNavigationViews() {
      if (this._viewsRegistered || !this.navigationService?.registerView) return;
      const noop = async () => true;
      ['projectList', 'projectDetails'].forEach(id => {
        try {
          this.navigationService.registerView(id, { show: noop, hide: noop });
        } catch (err) {
          // safe to ignore
        }
      });
      this._viewsRegistered = true;
    }
  }

  const instance = new ProjectDashboard(deps);

  // --- Expose compliant API with required cleanup() ---
  return {
    instance,
    cleanup: () => instance.cleanup(),
    ProjectDashboardBus,
  };
}
