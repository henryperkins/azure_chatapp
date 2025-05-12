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

import { createNotify } from "./utils/notify.js";

class ProjectDashboard {
  constructor(dependencySystem, notify = null) {
    if (!dependencySystem) throw new Error('[ProjectDashboard] dependencySystem is required.');
    this.dependencySystem = dependencySystem; // Store for later use

    // Dependency resolution
    const getModule = (key) =>
      this.dependencySystem.modules.get(key) ||
      this.dependencySystem.modules.get(
        key.charAt(0).toLowerCase() + key.slice(1)
      );

    this.getModule = getModule;
    this.app = getModule('app');
    this.projectManager = getModule('projectManager');
    this.eventHandlers = getModule('eventHandlers');
    this.auth = getModule('auth');
    this.navigationService = getModule('navigationService'); // Added
    this.logger = {
      info: (msg, opts = {}) => this.dashboardNotify.info(msg, opts),
      warn: (msg, opts = {}) => this.dashboardNotify.warn(msg, opts),
      error: (msg, opts = {}) => this.dashboardNotify.error(msg, opts),
      debug: (msg, opts = {}) => this.dashboardNotify.debug(msg, opts)
    };
    this.debugTools = getModule('debugTools') || null;
    // Utilidades globales (waitForDepsAndDom, etc.)
    this.globalUtils = getModule('globalUtils');
    this.notificationHandler = getModule('notificationHandler');
    if (!this.notificationHandler) throw new Error('[ProjectDashboard] notificationHandler (via DependencySystem) is required.');

    // --- Inject notify utility and context-rich dashboardNotify ---
    this.notify =
      notify ||
      getModule('notify') ||
      createNotify({ notificationHandler: this.notificationHandler });

    this.dashboardNotify = this.notify.withContext({
      module: 'ProjectDashboard',
      context: 'projectDashboard'
    });

    // Inject domAPI for all DOM access
    this.domAPI = getModule('domAPI');
    if (!this.domAPI) throw new Error('[ProjectDashboard] domAPI module required for DOM abstraction');

    this.components = {
      projectList: getModule('projectListComponent') || null,
      projectDetails: getModule('projectDetailsComponent') || null
    };

    // Injected browser abstractions
    this.browserService = getModule('browserService');
    if (!this.browserService) throw new Error('[ProjectDashboard] browserService module required');

    this.state = { currentView: null, currentProject: null, initialized: false };
    // Flag & stub view registration to prevent “unregistered view” errors 🔥
    this._viewsRegistered = false;
    this._ensureNavigationViews();
    this._unsubs = [];

    if (!this.eventHandlers?.trackListener) {
      throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for event binding');
    }

    // AuthBus event
    const authBus = this.auth?.AuthBus;
    const handler = (e) => {
      const { authenticated } = e.detail || {};
      this.logger.info(`[ProjectDashboard authStateChanged listener] Event received: authenticated=${authenticated}`, { detail: e.detail });
      if (!authenticated) {
        // If the event indicates logout, ensure the UI reflects this.
        this.logger.info('[ProjectDashboard authStateChanged listener] Not authenticated. Ensuring login message is shown.');
        this._showLoginRequiredMessage(); // Explicitly show login message on logout event
        return;
      }
      // If authenticated:
      const loginMsg = this.domAPI.getElementById('loginRequiredMessage');
      if (loginMsg) loginMsg.classList.add('hidden');
      const mainCnt = this.domAPI.getElementById('mainContent');
      if (mainCnt) mainCnt.classList.remove('hidden');
      this.logger.info('[ProjectDashboard authStateChanged listener] Ensured login message hidden, main content visible.');

      const actionPromise = !this.state.initialized
        ? this.initialize().then(initSuccess => {
          if (initSuccess) {
            this.logger.info('[ProjectDashboard authStateChanged listener] Dashboard initialized successfully. Will load projects.');
            return this._loadProjects();
          }
          this.logger.warn('[ProjectDashboard authStateChanged listener] Dashboard initialization failed after auth event.');
          return null;
        })
        : Promise.resolve(this.showProjectList()); // showProjectList also calls _loadProjects

      actionPromise.then(() => {
        // Final safeguard: ensure project list is visible and login message is hidden
        this.browserService.setTimeout(() => {
          const finalLoginMsg = this.domAPI.getElementById('loginRequiredMessage');
          if (finalLoginMsg) finalLoginMsg.classList.add('hidden');
          const finalMainCnt = this.domAPI.getElementById('mainContent');
          if (finalMainCnt) finalMainCnt.classList.remove('hidden');
          const finalListView = this.domAPI.getElementById('projectListView');
          if (finalListView) {
            finalListView.classList.remove('hidden', 'opacity-0');
            finalListView.style.display = ''; // Ensure display is not 'none'
          }
          this.logger.info('[ProjectDashboard authStateChanged listener] Final visibility safeguard executed for authenticated state.');
        }, 150); // Increased delay slightly
      }).catch(err => {
        this.logger.error('[ProjectDashboard authStateChanged listener] Error in post-auth action promise.', { error: err });
      });
    };
    const eventTarget = authBus && typeof authBus.addEventListener === 'function' ? authBus : document;
    const description =
      eventTarget === authBus
        ? 'ProjectDashboard: authStateChanged (AuthBus)'
        : 'ProjectDashboard: authStateChanged (doc)';
    this.eventHandlers.trackListener(eventTarget, 'authStateChanged', handler, { description, context: 'projectDashboard' });
    this._unsubs.push(() => eventTarget.removeEventListener('authStateChanged', handler));
  }

  async initialize() {
    const traceId = this.debugTools?.start?.('ProjectDashboard.initialize');
    this.dashboardNotify.info('[ProjectDashboard] initialize() called', { source: 'initialize' });
    if (this.state.initialized) {
      this.logger.info('[ProjectDashboard] Already initialized.', { context: 'ProjectDashboard' });
      this.dashboardNotify.info('Project dashboard is already initialized.', { source: 'initialize' });
      this.debugTools?.stop?.(traceId, 'ProjectDashboard.initialize');
      return true;
    }
    this.logger.info('[ProjectDashboard] Initializing...', { context: 'ProjectDashboard' });

    try {
      const authModule = this.getModule('auth');
      if (!authModule?.isAuthenticated?.()) {
        this.logger.warn('[ProjectDashboard initialize] authModule reports not authenticated. Initialization will not complete UI setup that requires auth. Caller or auth event handler should manage login message visibility.');
        this.debugTools?.stop?.(traceId, 'ProjectDashboard.initialize (not authenticated)');
        return false;
      }

      const loginMessage = this.domAPI.getElementById('loginRequiredMessage');
      if (loginMessage) loginMessage.classList.add('hidden');
      const mainContent = this.domAPI.getElementById('mainContent');
      if (mainContent) mainContent.classList.remove('hidden');

      const listView = this.domAPI.getElementById('projectListView');
      if (!listView)
        throw new Error('Missing required #projectListView container during initialization');

      this.logger.info('[ProjectDashboard initialize] Components before _initializeComponents:', { // Changed to info
        projectList: !!this.components.projectList,
        projectDetails: !!this.components.projectDetails,
        projectListExists: this.components.projectList !== null && this.components.projectList !== undefined,
        projectDetailsExists: this.components.projectDetails !== null && this.components.projectDetails !== undefined
      });

      await this._initializeComponents();
      this._setupEventListeners();

      if (this.navigationService) {
        this.navigationService.registerView('projectList', {
          show: async (params = {}) => {
            this.logger.info('[ProjectDashboard] NavigationService: show projectList view', { params });
            this._setView({ showList: true, showDetails: false });
            if (this.components.projectList) this.components.projectList.show();
            this._loadProjects(); // Ensure projects are loaded when list view is shown
            return true;
          },
          hide: async () => {
            this.logger.info('[ProjectDashboard] NavigationService: hide projectList view');
            if (this.components.projectList) this.components.projectList.hide?.();
            return true;
          }
        });

        this.navigationService.registerView('projectDetails', {
          show: async (params = {}) => {
            this.logger.info('[ProjectDashboard] NavigationService: show projectDetails view', { params });
            const { projectId, conversationId, activeTab } = params;

            if (!projectId) {
              this.dashboardNotify.error('Project ID is required to show project details.', { source: 'navService.showProjectDetails' });
              this.navigationService.navigateToProjectList();
              return false;
            }

            this._setView({ showList: false, showDetails: true }); // Switch UI first

            if (!this.components.projectDetails) {
              this.dashboardNotify.error('ProjectDetailsComponent is not available.', { source: 'navService.showProjectDetails' });
              this.navigationService.navigateToProjectList();
              return false;
            }

            await this.components.projectDetails.show(); // Ensure component UI is shown

            let projectToRender = null;
            if (this.projectManager && typeof this.projectManager.loadProjectDetails === 'function') { // Use loadProjectDetails directly
              try {
                projectToRender = await this.projectManager.loadProjectDetails(projectId);
              } catch (error) {
                this.dashboardNotify.error('Failed to load project details from projectManager.', { source: 'navService.showProjectDetails', originalError: error });
                // projectManager.loadProjectDetails already emits projectDetailsError/projectNotFound
                // and projectDashboard listens to projectNotFound to showProjectList.
                return false;
              }
            } else {
              this.dashboardNotify.error('ProjectManager or loadProjectDetails method is not available.', { source: 'navService.showProjectDetails' });
              this.navigationService.navigateToProjectList();
              return false;
            }

            if (projectToRender && this.components.projectDetails.renderProject) {
              this.components.projectDetails.renderProject(projectToRender); // THIS IS KEY

              // Now that renderProject has been called, ProjectDetailsComponent.state.currentProject should be set.
              // Proceed with tab switching if needed.
              if (conversationId && typeof this.components.projectDetails.switchTab === 'function' && typeof this.components.projectDetails.loadConversation === 'function') {
                this.components.projectDetails.switchTab(activeTab || 'chat');
                await this.components.projectDetails.loadConversation(conversationId);
              } else if (activeTab && typeof this.components.projectDetails.switchTab === 'function') {
                this.components.projectDetails.switchTab(activeTab);
              }
            } else {
              // This case means projectToRender was null (e.g., 404) or renderProject is missing
              if (!projectToRender) {
                this.dashboardNotify.warn('Project data was not found or couldn\'t be loaded.', { source: 'navService.showProjectDetails' });
                // projectManager.loadProjectDetails would have emitted projectNotFound,
                // which projectDashboard listens to and calls showProjectList().
              } else {
                this.dashboardNotify.error('ProjectDetailsComponent.renderProject is not available.', { source: 'navService.showProjectDetails' });
                this.navigationService.navigateToProjectList();
              }
              return false;
            }
            return true;
          },
          hide: async () => {
            this.logger.info('[ProjectDashboard] NavigationService: hide projectDetails view');
            if (this.components.projectDetails) this.components.projectDetails.hide?.();
            return true;
          }
        });
        this.dashboardNotify.info('ProjectDashboard views registered with NavigationService.');
      } else {
        this.dashboardNotify.error('NavigationService not available for view registration.');
      }

      this.state.initialized = true;
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent('projectDashboardInitialized', { detail: { success: true } })
      );
      this.logger.info('[ProjectDashboard] Initialization complete.', { context: 'ProjectDashboard' });
      this.debugTools?.stop?.(traceId, 'ProjectDashboard.initialize');
      return true;
    } catch (error) {
      this.logger.error('[ProjectDashboard] Initialization failed:', error);
      this.dashboardNotify.error('Dashboard initialization failed', { source: 'initialize', originalError: error });
      this.state.initialized = false;
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent('projectDashboardInitialized', { detail: { success: false, error } })
      );
      this.debugTools?.stop?.(traceId, 'ProjectDashboard.initialize (error)');
      return false;
    } finally {
      this.debugTools?.stop?.(traceId, 'ProjectDashboard.initialize');
    }
  }

  cleanup() {
    if (this._unsubs && this._unsubs.length) {
      this.dashboardNotify.debug('Running manual _unsubs cleanup.', { source: 'cleanup', count: this._unsubs.length });
      this._unsubs.forEach((unsub) => typeof unsub === 'function' && unsub());
      this._unsubs = [];
    }
    const ds = this.getModule('DependencySystem');
    if (ds && typeof ds.cleanupModuleListeners === 'function') {
      ds.cleanupModuleListeners('projectDashboard');
      this.dashboardNotify.info('Called DependencySystem.cleanupModuleListeners for projectDashboard.', { source: 'cleanup' });
    } else if (this.eventHandlers?.cleanupListeners) {
      this.eventHandlers.cleanupListeners({ context: 'projectDashboard' });
      this.dashboardNotify.info('Called eventHandlers.cleanupListeners for projectDashboard.', { source: 'cleanup' });
    } else {
      this.dashboardNotify.warn('cleanupListeners not available on eventHandlers or DependencySystem.', { source: 'cleanup' });
    }
  }

  async showProjectList() {
    this.logger.info('[ProjectDashboard] Showing project list view');
    this.state._aborted = false; // Explicitly reset _aborted flag here
    this.state.currentView = 'list';
    this.state.currentProject = null;
    this.browserService.removeSearchParam('project');
    this.browserService.removeSearchParam('chatId');

    this._setView({ showList: true, showDetails: false });

    if (this.components.projectDetails) this.components.projectDetails.hide();

    // Initialize ProjectList if needed
    if (this.components.projectList && !this.components.projectList.state?.initialized) {
      try {
        await this.components.projectList.initialize();
        this.logger.info('[ProjectDashboard] ProjectListComponent initialized on demand.');
      } catch (err) {
        this.logger.error('[ProjectDashboard] Failed to initialize ProjectListComponent on demand.', { error: err });
        this.dashboardNotify.error('Failed to load project list UI.', { source: 'showProjectList' });
        // Potentially show an error state instead of just logging
        return; // Stop further execution if initialization fails
      }
    }

    if (this.components.projectList) {
      this.components.projectList.show();
      this.logger.info('[ProjectDashboard] ProjectList component shown');
      this.dashboardNotify.info('Switched to project list view.', { source: 'showProjectList' });
    } else {
      this.logger.warn('[ProjectDashboard] ProjectList component not available');
      this.dashboardNotify.warn('The project list is currently unavailable.', { source: 'showProjectList' });
    }

    this._loadProjects();

    this.browserService.setTimeout(() => {
      const listView = this.domAPI.getElementById('projectListView');
      if (listView) {
        listView.classList.remove('opacity-0');
        listView.style.display = '';
        listView.classList.remove('hidden');
        this.logger.info('[ProjectDashboard] Additional visibility check for project list view completed');
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
    const DependencySystem = this.getModule?.('DependencySystem') || null;
    const traceId = DependencySystem?.getCurrentTraceIds?.().traceId
      ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    const transactionId = DependencySystem?.generateTransactionId?.() ?? `txn-${Date.now()}`;

    // Determine if argument is an object (project) or string (id)
    if (
      typeof projectObjOrId === 'object' &&
      projectObjOrId &&
      projectObjOrId.id &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId.id))
    ) {
      project = projectObjOrId; // Full object
      projectId = projectObjOrId.id;
    } else if (
      typeof projectObjOrId === 'string' &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId))
    ) {
      projectId = projectObjOrId; // ID only
    } else {
      this.dashboardNotify.error('Invalid project ID', {
        source: 'showProjectDetails',
        traceId,
        transactionId,
        extra: { projectObjOrId }
      });
      this.showProjectList();
      return false;
    }

    // Keep a boolean to signify whether we are dealing with a full project object
    const wasFullObject = (typeof projectObjOrId === 'object');

    this.state.currentView = null; // Indicate transition

    // Initialize ProjectDetails if needed, *before* trying to show/render
    if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
      this.dashboardNotify.info('Initializing ProjectDetailsComponent on demand...', {
        source: 'showProjectDetails',
        traceId,
        transactionId,
        extra: { projectId }
      });
      try {
        await this.components.projectDetails.initialize();
        this.dashboardNotify.info('ProjectDetailsComponent initialized on demand.', {
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectId }
        });
      } catch (initErr) {
        this.logger.error('[ProjectDashboard] Failed to initialize ProjectDetailsComponent on demand.', { error: initErr });
        this.dashboardNotify.error('Failed to load project details UI.', {
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectId, error: initErr?.message, originalError: initErr }
        });
        this.showProjectList(); // Go back to list if details UI fails to init
        return false;
      }
    }

    // Now proceed with loading/rendering logic, assuming component is initialized
    try {
      // If we already have a project object, use it directly
      if (project) {
        if (this.projectManager && typeof this.projectManager.setCurrentProject === 'function') {
          this.projectManager.setCurrentProject(project);
        }

        if (this.components.projectDetails && this.components.projectDetails.renderProject) {
          try {
            if (this._lastLoadId !== currentLoadId) {
              this.logger.info('[ProjectDashboard] Aborting showProjectDetails (direct path) due to newer load');
              this.dashboardNotify.debug('Aborted: newer navigation event detected', {
                source: 'showProjectDetails',
                traceId,
                transactionId,
                extra: { projectId }
              });
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
            this.dashboardNotify.info('Project details displayed successfully.', {
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            });
          } catch (error) {
            this.logger.error('[ProjectDashboard] Error during view transition:', error);
            this.dashboardNotify.error('Error displaying project details (direct path)', {
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId, error: error?.message, originalError: error }
            });
            this._setView({ showList: false, showDetails: true });
          }
        }
        return this._postProjectDetailsSuccess(project, projectId, wasFullObject);
      }

      // Otherwise, load via projectManager
      if (this.app?.state?.isAuthenticated && this.projectManager?.loadProjectDetails) {
        try {
          const loadedProject = await this.projectManager.loadProjectDetails(projectId);
          if (this._lastLoadId !== currentLoadId) {
            this.logger.info('[ProjectDashboard] Aborting showProjectDetails (API path) due to newer load');
            this.dashboardNotify.debug('Aborted: newer navigation event detected (API path)', {
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            });
            return false;
          }
          if (!loadedProject) {
            this.logger.warn('[ProjectDashboard] Project not found after details load');
            this.dashboardNotify.error('Project not found', {
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            });
            this.showProjectList();
            return false;
          }
          project = loadedProject;
          if (project && this.components.projectDetails?.renderProject) {
            if (this.projectManager && typeof this.projectManager.setCurrentProject === 'function') {
              this.projectManager.setCurrentProject(project);
            }

            try {
              if (this._lastLoadId !== currentLoadId) {
                this.logger.info(
                  '[ProjectDashboard] Aborting showProjectDetails (API path) due to newer load after render check'
                );
                this.dashboardNotify.debug('Aborted: newer navigation event detected (API path, post-render check)', {
                  source: 'showProjectDetails',
                  traceId,
                  transactionId,
                  extra: { projectId }
                });
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
              this.dashboardNotify.info('Project details displayed successfully (API path).', {
                source: 'showProjectDetails',
                traceId,
                transactionId,
                extra: { projectId }
              });
            } catch (error) {
              this.logger.error('[ProjectDashboard] Error during view transition (API path):', error);
              this.dashboardNotify.error('Error displaying project details (API path)', {
                source: 'showProjectDetails',
                traceId,
                transactionId,
                extra: { projectId, error: error?.message, originalError: error }
              });
              this._setView({ showList: false, showDetails: true });
            }
          }
        } catch (error) {
          if (this._lastLoadId !== currentLoadId) {
            this.logger.info('[ProjectDashboard] Aborting showProjectDetails error handler due to newer load');
            this.dashboardNotify.debug('Aborted: newer navigation event detected (API path, error handler)', {
              source: 'showProjectDetails',
              traceId,
              transactionId,
              extra: { projectId }
            });
            return false;
          }
          this.logger.error('[ProjectDashboard] Failed to load project details:', error);
          this.dashboardNotify.error('Failed to load project details', {
            source: 'showProjectDetails',
            traceId,
            transactionId,
            extra: { projectId, error: error?.message, originalError: error }
          });
          this.showProjectList();
          return false;
        }
        return this._postProjectDetailsSuccess(project, projectId, false);
      } else {
        this.dashboardNotify.warn('ProjectManager is unavailable or user not authenticated. Showing project list.', {
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectId }
        });
        this.showProjectList();
        return false;
      }
    } catch (err) { // Catch errors from the outer try block (e.g., initialization)
      this.logger.error('[ProjectDashboard] Error in showProjectDetails main try block:', err);
      this.dashboardNotify.error('An unexpected error occurred while loading project details.', {
        source: 'showProjectDetails_OuterCatch'
      });
      this.showProjectList(); // Go back to list on unexpected errors
      return false;
    }
  }

  // =================== PRIVATE METHODS ===================

  _postProjectDetailsSuccess(project, projectId, wasFullObject) {
    this.browserService.setSearchParam('project', projectId);
    this.state.currentView = 'details';

    // Always check for a default conversation (assume valid project object)
    if (project.conversations && Array.isArray(project.conversations) && project.conversations.length > 0) {
      const defaultConversation = project.conversations[0];
      if (defaultConversation && defaultConversation.id) {
        this.browserService.setSearchParam('chatId', defaultConversation.id);
        this.dashboardNotify.info(
          `[ProjectDashboard] _postProjectDetailsSuccess: Default conversation ID ${defaultConversation.id} set in URL for project ${projectId}.`,
          {
            source: '_postProjectDetailsSuccess',
            projectId,
            chatId: defaultConversation.id
          }
        );
      } else {
        this.dashboardNotify.warn(
          `[ProjectDashboard] _postProjectDetailsSuccess: Project has conversations array, but the first conversation is invalid or missing an ID. Cannot set default chatId.`,
          {
            source: '_postProjectDetailsSuccess',
            projectId,
            projectConversationsPreview: project.conversations.slice(0, 1)
          }
        );
      }
    } else {
      this.dashboardNotify.info(
        `[ProjectDashboard] _postProjectDetailsSuccess: Project has no conversations array, or it's empty. Cannot set default chatId.`,
        {
          source: '_postProjectDetailsSuccess',
          projectId,
          conversationsDataExists: Object.prototype.hasOwnProperty.call(project, 'conversations'),
          conversationsIsArray: Array.isArray(project.conversations),
          conversationsLength: Array.isArray(project.conversations) ? project.conversations.length : undefined
        }
      );
    }

    // Optionally fire projectLoaded event
    if (project && project.id && wasFullObject) {
      const eventDoc = this.domAPI?.getDocument?.() || document;
      if (this.domAPI?.dispatchEvent) {
        this.domAPI.dispatchEvent(eventDoc, new CustomEvent('projectLoaded', { detail: project }));
      } else {
        eventDoc.dispatchEvent(new CustomEvent('projectLoaded', { detail: project }));
      }
    }

    const cm = this.getModule?.('chatManager');
    if (cm?.initialize) {
      Promise
        .resolve(cm.initialize({ projectId }))
        .catch(err => this.dashboardNotify.error('Chat initialisation failed',
          { source: '_postProjectDetailsSuccess', originalError: err }));
    }
    return true;
  }

  _setView({ showList, showDetails }) {
    if (this.state._aborted) {
      this.logger.info('[ProjectDashboard] _setView aborted due to navigation change');
      return;
    }
    this.logger.info('[ProjectDashboard] _setView called with:', { showList, showDetails });

    const listView = this.domAPI.getElementById('projectListView');
    const detailsView = this.domAPI.getElementById('projectDetailsView');
    const chatHeaderBar = this.domAPI.getElementById('chatHeaderBar');

    this.logger.info('[ProjectDashboard] _setView DOM elements before:', {
      listViewExists: !!listView,
      detailsViewExists: !!detailsView,
      listViewClasses: listView ? listView.className : 'N/A',
      detailsViewClasses: detailsView ? detailsView.className : 'N/A',
      listViewDisplay: listView ? listView.style.display : 'N/A',
      detailsViewDisplay: detailsView ? detailsView.style.display : 'N/A'
    });

    // Handle project list view visibility
    if (listView) {
      if (showList) {
        listView.classList.remove('hidden');
        listView.classList.remove('opacity-0');
        listView.style.display = '';
        this.domAPI.setAttribute(listView, 'aria-hidden', 'false');
        void listView.offsetHeight; // Force a reflow
        this.logger.info('[ProjectDashboard] Project list view made visible', {
          classes: listView.className,
          display: listView.style.display,
          ariaHidden: listView.getAttribute('aria-hidden')
        });

        if (this.components.projectList && typeof this.components.projectList.show === 'function') {
          this.browserService.setTimeout(() => {
            this.components.projectList.show();
            this.logger.debug('[ProjectDashboard] Called projectList.show() from _setView');
          }, 0);
        }
      } else {
        this.domAPI.toggleClass(listView, 'hidden', true);
        listView.style.display = 'none';
        this.domAPI.setAttribute(listView, 'aria-hidden', 'true');
        this.logger.info('[ProjectDashboard] Project list view hidden');
      }
    } else {
      this.logger.warn('[ProjectDashboard] Project list view element not found');
    }

    // Handle project details view visibility
    if (detailsView) {
      if (showDetails) {
        this.domAPI.toggleClass(detailsView, 'hidden', false);
        detailsView.style.display = 'flex';
        this.domAPI.setAttribute(detailsView, 'aria-hidden', 'false');
        detailsView.classList.remove('opacity-0');
        detailsView.classList.add('flex-1', 'flex-col');
        this.logger.info('[ProjectDashboard] Project details view made visible');

        if (this.components.projectDetails && typeof this.components.projectDetails.show === 'function') {
          this.browserService.setTimeout(() => {
            this.components.projectDetails.show();
            this.logger.debug('[ProjectDashboard] Called projectDetails.show() from _setView');
          }, 0);
        }
      } else {
        this.domAPI.toggleClass(detailsView, 'hidden', true);
        detailsView.style.display = 'none';
        this.domAPI.setAttribute(detailsView, 'aria-hidden', 'true');
        detailsView.classList.remove('flex-1', 'flex-col');
        this.logger.info('[ProjectDashboard] Project details view hidden');
      }
    } else {
      this.logger.warn('[ProjectDashboard] Project details view element not found');
    }

    // Handle chat header bar visibility
    if (chatHeaderBar) {
      this.domAPI.toggleClass(chatHeaderBar, 'hidden', !showDetails);
      this.domAPI.setAttribute(chatHeaderBar, 'aria-hidden', String(!showDetails));
    }

    // Manage focus AFTER views are updated
    if (showDetails && detailsView) {
      const focusTarget = detailsView.querySelector('h1, [role="tab"], button:not([disabled])');
      if (focusTarget && typeof focusTarget.focus === 'function') {
        this.browserService.setTimeout(() => focusTarget.focus(), 0);
      } else {
        detailsView.setAttribute('tabindex', '-1');
        this.browserService.setTimeout(() => detailsView.focus(), 0);
      }
    } else if (showList && listView) {
      const focusTarget = listView.querySelector('h2, [role="tab"], button:not([disabled]), a[href]');
      if (focusTarget && typeof focusTarget.focus === 'function') {
        this.browserService.setTimeout(() => focusTarget.focus(), 0);
      } else {
        listView.setAttribute('tabindex', '-1');
        this.browserService.setTimeout(() => listView.focus(), 0);
      }
    }

    // Force browser reflow again to ensure transitions apply
    this.browserService.requestAnimationFrame(() => {
      if (listView && showList) {
        void listView.getBoundingClientRect();
        this.browserService.setTimeout(() => {
          if (listView.classList.contains('hidden') || listView.style.display === 'none') {
            this.logger.warn('[ProjectDashboard] List view still hidden after _setView, forcing visibility');
            listView.classList.remove('hidden');
            listView.classList.remove('opacity-0');
            listView.style.display = '';
          }
        }, 50);
      }
      if (detailsView && showDetails) {
        void detailsView.getBoundingClientRect();
      }
    });

    this.logger.info('[ProjectDashboard] View state after update:', {
      listViewVisible: listView ? !listView.classList.contains('hidden') && listView.style.display !== 'none' : false,
      detailsViewVisible: detailsView ? !detailsView.classList.contains('hidden') && detailsView.style.display !== 'none' : false,
      chatHeaderBarVisible: chatHeaderBar ? !chatHeaderBar.classList.contains('hidden') : false,
      listViewDisplay: listView?.style.display || 'N/A',
      detailsViewDisplay: detailsView?.style.display || 'N/A',
    });
  }

  _showLoginRequiredMessage() {
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
    this.components.projectList = this.components.projectList || this.getModule('projectListComponent') || null;
    this.components.projectDetails = this.components.projectDetails || this.getModule('projectDetailsComponent') || null;

    this.logger.info('[ProjectDashboard] Initializing components...');

    await new Promise((resolve) => {
      const doc = this.domAPI ? this.domAPI.getDocument() : document;
      const detailsTabs = this.domAPI
        ? this.domAPI.querySelector('#projectDetailsView .tabs[role="tablist"]')
        : doc.querySelector('#projectDetailsView .tabs[role="tablist"]');
      if (detailsTabs) return resolve();

      const eventTarget = this.domAPI ? this.domAPI.getDocument() : document;
      if (this.eventHandlers && this.eventHandlers.trackListener) {
        this.eventHandlers.trackListener(eventTarget, 'projectDetailsHtmlLoaded', () => resolve(), { once: true, context: 'projectDashboard', description: 'Wait for projectDetailsHtmlLoaded' });
      } else {
        eventTarget.addEventListener('projectDetailsHtmlLoaded', () => resolve(), { once: true });
      }
    });

    const listViewEl = this.domAPI.getElementById('projectListView');
    if (listViewEl && listViewEl.childElementCount > 0) {
      this.logger.info('[ProjectDashboard] projectListHtml already present – skipping event wait.');
    } else {
      this.logger.info('[ProjectDashboard] Waiting for projectListHtmlLoaded event...');
      await new Promise((resolve, reject) => {
        const eventTarget = this.domAPI ? this.domAPI.getDocument() : document;
        const timeoutId = this.browserService.setTimeout(() => {
          this.logger.error('[ProjectDashboard] Timeout waiting for projectListHtmlLoaded event.');
          reject(new Error('Timeout waiting for projectListHtmlLoaded'));
        }, 10000);

        const handler = (event) => {
          this.browserService.clearTimeout(timeoutId);
          if (event.detail && event.detail.success) {
            this.logger.info('[ProjectDashboard] projectListHtmlLoaded event received successfully.');
            resolve();
          } else {
            this.logger.error('[ProjectDashboard] projectListHtmlLoaded event received with failure.', { error: event.detail?.error });
            reject(new Error(`projectListHtmlLoaded failed: ${event.detail?.error?.message || 'Unknown error'}`));
          }
        };

        if (this.eventHandlers && this.eventHandlers.trackListener) {
          this.eventHandlers.trackListener(eventTarget, 'projectListHtmlLoaded', handler, { once: true, context: 'projectDashboard', description: 'Wait for projectListHtmlLoaded' });
        } else {
          eventTarget.addEventListener('projectListHtmlLoaded', handler, { once: true });
        }
      });
    }

    const waitForDepsAndDom = this.globalUtils?.waitForDepsAndDom;
    if (!waitForDepsAndDom) {
      this.logger.error('[ProjectDashboard] waitForDepsAndDom utility is not available via this.globalUtils. Component initialization might be unstable.');
    }

    // ProjectList
    if (this.components.projectList && !this.components.projectList.state?.initialized) {
      this.logger.info('[ProjectDashboard] Waiting for ProjectList DOM elements...');
      if (waitForDepsAndDom) {
        try {
          await waitForDepsAndDom({
            DependencySystem: this.dependencySystem, // Correct: pass the instance directly
            domSelectors: ['#projectList', '#projectList .grid', '#projectFilterTabs', '#projectListCreateBtn'],
            timeout: 5000,
            notify: this.logger,
            domAPI: this.domAPI,
            source: 'ProjectDashboard_InitProjectList_ExtendedWait'
          });
          this.logger.info('[ProjectDashboard] ProjectList and its essential child DOM elements ready.');
        } catch (err) {
          this.logger.error('[ProjectDashboard] Timeout or error waiting for ProjectList DOM elements. Initialization will halt.', { error: err });
          throw err; // Re-throw if waitForDepsAndDom fails
        }
      }
      // REMOVED: await this.components.projectList.initialize();
      this.logger.info('[ProjectDashboard] ProjectList container check complete.');
    } else if (this.components.projectList && this.components.projectList.state?.initialized) {
      this.logger.info('[ProjectDashboard] ProjectListComponent was already initialized (checked in _initializeComponents).');
    } else {
      this.logger.error('[ProjectDashboard] projectListComponent instance not found in _initializeComponents.');
    }

    // ProjectDetails Container Check
    if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) { // Only check if component exists but is not initialized
      this.logger.info('[ProjectDashboard] Checking ProjectDetails container DOM elements...');
      if (waitForDepsAndDom) {
        try {
          // Check only for the main container existence here
          await waitForDepsAndDom({
            DependencySystem: this.dependencySystem,
            domSelectors: ['#projectDetailsView'], // Just the container
            timeout: 5000,
            notify: this.logger,
            domAPI: this.domAPI,
            source: 'ProjectDashboard_CheckProjectDetailsContainer'
          });
          this.logger.info('[ProjectDashboard] ProjectDetails container element ready.');
        } catch (err) {
          this.logger.error('[ProjectDashboard] Timeout or error waiting for ProjectDetails container element.', { error: err });
          // Don't throw, allow potential initialization later
        }
      }
      // REMOVED: await this.components.projectDetails.initialize();
      this.logger.info('[ProjectDashboard] ProjectDetails container check complete.');
    } else if (this.components.projectDetails && this.components.projectDetails.state?.initialized) {
      this.logger.info('[ProjectDashboard] ProjectDetailsComponent was already initialized (checked in _initializeComponents).');
    } else {
      this.logger.error('[ProjectDashboard] projectDetailsComponent instance not found in _initializeComponents.');
    }

    this.logger.info('[ProjectDashboard] Component container checks complete.');
  }

  _setupEventListeners() {
    const add = (el, event, handler, opts = {}) => {
      if (!this.eventHandlers?.trackListener)
        throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for event binding');
      const optionsWithContext = { ...opts, context: 'projectDashboard' };
      this.eventHandlers.trackListener(el, event, handler, optionsWithContext);
      this._unsubs.push(() => el.removeEventListener(event, handler, opts));
    };

    add(document, 'projectsLoaded', this._handleProjectsLoaded.bind(this), { description: 'Dashboard: projectsLoaded' });
    add(document, 'projectLoaded', this._handleProjectLoaded.bind(this), { description: 'Dashboard: projectLoaded' });
    add(document, 'projectStatsLoaded', this._handleProjectStatsLoaded.bind(this), { description: 'Dashboard: projectStatsLoaded' });
    add(document, 'projectFilesLoaded', this._handleFilesLoaded.bind(this), { description: 'Dashboard: projectFilesLoaded' });
    add(document, 'projectArtifactsLoaded', this._handleArtifactsLoaded.bind(this), { description: 'Dashboard: projectArtifactsLoaded' });
    add(document, 'projectNotFound', this._handleProjectNotFound.bind(this), { description: 'Dashboard: projectNotFound' });
    add(document, 'projectCreated', this._handleProjectCreated.bind(this), { description: 'Dashboard: projectCreated' });
    add(document, 'authStateChanged', this._handleAuthStateChange.bind(this), { description: 'Dashboard: authStateChanged (global)' });
    add(document, 'projectDeleted', this._handleProjectDeleted.bind(this), { description: 'Dashboard: projectDeleted' });
  }

  _handleProjectCreated(e) {
    const project = e.detail;
    this.logger.info('[ProjectDashboard] Project created:', project);

    if (project && project.id) {
      this.browserService.setTimeout(() => {
        const projectId = project.id;
        const events = [
          'projectStatsRendered',
          'projectFilesRendered',
          'projectConversationsRendered',
          'projectArtifactsRendered',
          'projectKnowledgeBaseRendered'
        ];
        events.forEach((eventName) => {
          document.dispatchEvent(
            new CustomEvent(eventName, {
              detail: { projectId }
            })
          );
        });
      }, 3000);
    }
    this.showProjectDetails(project);
    this.browserService.setItem('selectedProjectId', project.id);
  }

  _loadProjects() {
    this.state._aborted = false;
    this.logger.info('[ProjectDashboard] Loading projects...');

    if (!this.app) {
      this.dashboardNotify.error('Project dashboard unavailable. Please refresh the page.', { source: '_loadProjects' });
      this.logger.error('[ProjectDashboard] app is null or undefined');
      return;
    }

    const isAuthed =
      (this.app?.state?.isAuthenticated) ||
      (typeof this.auth?.isAuthenticated === 'function' && this.auth.isAuthenticated());

    if (!isAuthed) {
      this.dashboardNotify.warn('Not authenticated. Please log in to view projects.', { source: '_loadProjects' });
      this.logger.warn('[ProjectDashboard] Not authenticated, cannot load projects. Auth state:', {
        appState: this.app?.state,
        authModuleAuthenticated: typeof this.auth?.isAuthenticated === 'function' ? this.auth.isAuthenticated() : 'n/a'
      });
      this.browserService.setTimeout(() => {
        if (typeof this.auth?.isAuthenticated === 'function' && this.auth.isAuthenticated()) {
          this.logger.info('[ProjectDashboard] Retrying project load after delayed auth success');
          this._loadProjects();
        }
      }, 500);
      return;
    }

    if (!this.projectManager) {
      this.dashboardNotify.error('Project manager unavailable. Please refresh the page.', { source: '_loadProjects' });
      this.logger.error('[ProjectDashboard] projectManager is null or undefined');
      return;
    }

    if (typeof this.projectManager.loadProjects !== 'function') {
      this.dashboardNotify.error('Cannot load projects. Project manager is incomplete.', { source: '_loadProjects' });
      this.logger.error('[ProjectDashboard] Cannot load projects: projectManager.loadProjects not available');
      return;
    }

    if (!this.browserService || typeof this.browserService.setTimeout !== 'function') {
      this.logger.error('[ProjectDashboard] browserService.setTimeout not available');
      this._executeProjectLoad();
      return;
    }

    this.browserService.setTimeout(() => this._executeProjectLoad(), 100);
  }

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
        this.dashboardNotify.error('Failed to load projects. Please try again.', { source: '_executeProjectLoad', originalError: error });
      });
  }

  _handleViewProject(projectId) {
    const newNavPath = `/project-details-view?project=${projectId}`;
    history.pushState({}, '', newNavPath);
    this.showProjectDetails(projectId);
  }

  _handleBackToList() {
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
    const { authenticated, user, source } = event.detail || {};
    this.logger.info('[ProjectDashboard] Auth state changed:', {
      authenticated,
      userId: user?.id,
      source: source || 'unknown'
    });

    this.browserService.requestAnimationFrame(() => {
      const loginRequiredMessage = this.domAPI.getElementById('loginRequiredMessage');
      const mainContent = this.domAPI.getElementById('mainContent');
      const projectListView = this.domAPI.getElementById('projectListView');
      const projectDetailsView = this.domAPI.getElementById('projectDetailsView');

      this.logger.debug('[ProjectDashboard] Current DOM element state:', {
        loginRequiredMessageExists: !!loginRequiredMessage,
        mainContentExists: !!mainContent,
        projectListViewExists: !!projectListView,
        projectDetailsViewExists: !!projectDetailsView,
        projectListViewClasses: projectListView ? projectListView.className : 'N/A',
        projectListViewDisplay: projectListView ? projectListView.style.display : 'N/A'
      });

      if (!authenticated) {
        this.logger.info('[ProjectDashboard] User not authenticated, showing login message');
        if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
        if (mainContent) mainContent.classList.add('hidden');
        if (projectListView) projectListView.classList.add('hidden');
        if (projectDetailsView) projectDetailsView.classList.add('hidden');
        this.state._aborted = true;
      } else {
        this.logger.info('[ProjectDashboard] User authenticated, showing project list');
        this.state._aborted = false;

        if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');
        if (mainContent) mainContent.classList.remove('hidden');
        this.state.currentView = 'list';
        this.state.currentProject = null;
        this.browserService.removeSearchParam('project');

        if (projectListView) {
          projectListView.classList.remove('hidden');
          projectListView.classList.remove('opacity-0');
          projectListView.style.display = '';
          void projectListView.offsetHeight;
          this.logger.info('[ProjectDashboard] Made project list view visible immediately after auth', {
            classes: projectListView.className,
            display: projectListView.style.display
          });
        } else {
          this.logger.warn('[ProjectDashboard] projectListView element not found, cannot make visible');
        }
        if (projectDetailsView) projectDetailsView.classList.add('hidden');

        const componentsInitialized = this.components.projectList && this.components.projectList.state?.initialized;
        if (!componentsInitialized) {
          this.logger.info('[ProjectDashboard] Components not initialized after auth, reinitializing...');
          this._initializeComponents()
            .then(() => {
              if (this.components.projectList) {
                this.components.projectList.show();
                this._loadProjects();
                this.logger.info('[ProjectDashboard] Project list component initialized and shown after auth');
              } else {
                this.logger.error('[ProjectDashboard] Project list component still not available after initialization');
              }
            })
            .catch(err => {
              this.logger.error('[ProjectDashboard] Error initializing components after auth', { error: err });
            });
        } else {
          this.logger.info('[ProjectDashboard] Components already initialized, showing project list');
          if (this.components.projectList) {
            this.components.projectList.show();
            this.logger.info('[ProjectDashboard] Project list component shown after auth');
          } else {
            this.logger.warn('[ProjectDashboard] Project list component not available');
          }
          if (this.components.projectDetails) {
            this.components.projectDetails.hide();
          }
          this.browserService.setTimeout(() => {
            this.logger.info('[ProjectDashboard] Loading projects after authentication state change');
            this._loadProjects();
            this.browserService.setTimeout(() => {
              const plv = this.domAPI.getElementById('projectListView');
              if (plv) {
                plv.classList.remove('opacity-0');
                plv.style.display = '';
                plv.classList.remove('hidden');
                this.logger.info('[ProjectDashboard] Verified project list view visibility after auth');
              } else {
                this.logger.warn('[ProjectDashboard] projectListView element not found in visibility check');
              }
            }, 100);
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
    this.dashboardNotify.error('The requested project was not found', { source: '_handleProjectNotFound' });
    this.showProjectList();
  }

  _handleProjectDeleted(event) {
    const { projectId } = event.detail || {};
    this.logger.info(`[ProjectDashboard] Project deleted event received for ID: ${projectId}`);
    if (this.state.currentProject && this.state.currentProject.id === projectId) {
      this.logger.info('[ProjectDashboard] Currently viewed project was deleted, returning to list view.');
      this.showProjectList();
    } else {
      if (this.state.currentView === 'list') {
        this.logger.info('[ProjectDashboard] Project deleted while list is visible, reloading list.');
        this._loadProjects();
      }
    }
  }

  /**
   * Ensure NavigationService knows about core views even before full
   * initialization. This prevents “Cannot activate unregistered view”
   * errors triggered by auth-independent modules that call
   * navigationService.navigateTo(…).
   * Stub handlers are intentionally no-ops and will be overwritten by the
   * full-feature versions inside initialize().
   */
  _ensureNavigationViews() {
    if (this._viewsRegistered || !this.navigationService?.registerView) return;
    const noop = async () => true;
    ['projectList', 'projectDetails'].forEach(id => {
      try {
        this.navigationService.registerView(id, { show: noop, hide: noop });
      } catch (err) {
        // Duplicate registration or handler validation error – safe to ignore
      }
    });
    this._viewsRegistered = true;
  }
}
export function createProjectDashboard(dependencySystem) {
  return new ProjectDashboard(dependencySystem);
}
