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
      this.dependencySystem.modules.get(key) || // Use this.dependencySystem
      this.dependencySystem.modules.get(        // Use this.dependencySystem
        key.charAt(0).toLowerCase() + key.slice(1)
      );

    this.getModule = getModule;
    this.app = getModule('app');
    this.projectManager = getModule('projectManager');
    this.eventHandlers = getModule('eventHandlers');
    this.auth = getModule('auth');
    this.logger = getModule('logger') || { info: () => { }, warn: () => { }, error: () => { } };
    this.debugTools    = getModule('debugTools') || null;
    // Utilidades globales (waitForDepsAndDom, etc.)
    this.globalUtils   = getModule('globalUtils');
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
    this.eventHandlers.trackListener(eventTarget, 'authStateChanged', handler, { description, context: 'projectDashboard' });
    // Note: _unsubs might become redundant if all listeners are context-tracked and cleaned up via cleanupListeners({context: ...})
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
      if (!this.app?.state?.isAuthenticated) {
        this.logger.info('[ProjectDashboard] Not authenticated, waiting for login...', {
          context: 'ProjectDashboard'
        });
        this._showLoginRequiredMessage();
        this.debugTools?.stop?.(traceId, 'ProjectDashboard.initialize');
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
      this.debugTools?.stop?.(traceId, 'ProjectDashboard.initialize');
      return true;
    } catch (error) {
      this.logger.error('[ProjectDashboard] Initialization failed:', error);
        this.dashboardNotify.error('Dashboard initialization failed', { source: 'initialize', originalError: error });
        this.state.initialized = false;
        this.domAPI.dispatchEvent(this.domAPI.getDocument(),
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
    // Use context-specific cleanup
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

  showProjectList() {
    this.logger.info('[ProjectDashboard] Showing project list view');
    this.state.currentView = 'list';
    this.state.currentProject = null;
    // Remove ?project from URL
    this.browserService.removeSearchParam('project');
    this.browserService.removeSearchParam('chatId'); // Also remove chatId when going to list

    this._setView({ showList: true, showDetails: false });

    if (this.components.projectDetails) this.components.projectDetails.hide();
    if (this.components.projectList) {
      this.components.projectList.show();
      this.logger.info('[ProjectDashboard] ProjectList component shown');
      this.dashboardNotify.info('Switched to project list view.', { source: 'showProjectList' });
    } else {
      this.logger.warn('[ProjectDashboard] ProjectList component not available');
      this.dashboardNotify.warn('The project list is currently unavailable.', { source: 'showProjectList' });
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
    // DI strict: never use window globals. Use only injected domAPI or browserService.
    const DependencySystem = this.getModule?.('DependencySystem') || null;
    const traceId = DependencySystem?.getCurrentTraceIds?.().traceId ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    const transactionId = DependencySystem?.generateTransactionId?.() ?? `txn-${Date.now()}`;

    // Determine if argument is an object (project) or string (id)
    if (
      typeof projectObjOrId === 'object' &&
      projectObjOrId &&
      projectObjOrId.id &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId.id))
    ) {
      project = projectObjOrId; // project is the full object
      projectId = projectObjOrId.id;
    } else if (
      typeof projectObjOrId === 'string' &&
      (!this.app?.validateUUID || this.app.validateUUID(projectObjOrId))
    ) {
      projectId = projectObjOrId; // project is null, projectId is the string
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

    this.state.currentView = null;

    try {
      if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
        this.dashboardNotify.info('Waiting for ProjectDetailsComponent to initialize…', {
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectId }
        });
        await this.components.projectDetails.initialize();
        this.dashboardNotify.info('ProjectDetailsComponent initialized', {
          source: 'showProjectDetails',
          traceId,
          transactionId,
          extra: { projectId }
        });
      }
    } catch (err) {
      this.logger.error('[ProjectDashboard] Error loading project details page:', err);
      this.dashboardNotify.error('Error loading project details UI', {
        source: 'showProjectDetails',
        traceId,
        transactionId,
        extra: { projectId, error: err?.message, originalError: err }
      });
      this.browserService.removeItem('selectedProjectId');
      this.showProjectList();
      return false;
    }

    // If we already have a project object, use it directly
    if (project) { // project is the full object here
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
      return this._postProjectDetailsSuccess(project, projectId); // Pass full project object
    }

    // Otherwise, load via projectManager (project is null here, projectId is set)
    if (this.app?.state?.isAuthenticated && this.projectManager?.loadProjectDetails) {
      try {
        const loadedProject = await this.projectManager.loadProjectDetails(projectId); // API returns full project
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
        // Now 'project' refers to the loadedProject
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
      // For the API path, pass the loaded project object to _postProjectDetailsSuccess
      return this._postProjectDetailsSuccess(project, projectId);
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
  }

  // =================== PRIVATE METHODS ===================

  _postProjectDetailsSuccess(project, projectId) {
    this.browserService.setSearchParam('project', projectId);
    this.state.currentView = 'details';

    // If a full project object is passed (likely from createProject flow),
    // check for a default conversation and set its ID in the URL.
    // This helps ChatManager pick up the default conversation automatically.
    if (project && project.id) { // Ensure project itself is valid first
        if (project.conversations && Array.isArray(project.conversations) && project.conversations.length > 0) {
            const defaultConversation = project.conversations[0];
            if (defaultConversation && defaultConversation.id) {
                this.browserService.setSearchParam('chatId', defaultConversation.id);
                this.dashboardNotify.info(`[ProjectDashboard] _postProjectDetailsSuccess: Default conversation ID ${defaultConversation.id} set in URL for project ${projectId}.`, {
                    source: '_postProjectDetailsSuccess',
                    projectId,
                    chatId: defaultConversation.id
                    // Avoid logging the whole project object here unless necessary for debugging, as it can be large.
                });
            } else {
                // This case means project.conversations is an array, but the first element is faulty or has no id.
                this.dashboardNotify.warn(`[ProjectDashboard] _postProjectDetailsSuccess: Project has conversations array, but the first conversation is invalid or missing an ID. Cannot set default chatId.`, {
                    source: '_postProjectDetailsSuccess',
                    projectId,
                    projectConversationsPreview: project.conversations.slice(0,1) // Log preview of first item
                });
            }
        } else {
            // This is an expected case for new projects or projects without conversations.
            this.dashboardNotify.info(`[ProjectDashboard] _postProjectDetailsSuccess: Project has no conversations array, or it's empty. Cannot set default chatId.`, {
                source: '_postProjectDetailsSuccess',
                projectId,
                conversationsDataExists: project.hasOwnProperty('conversations'), // Check if the key exists
                conversationsIsArray: Array.isArray(project.conversations),
                conversationsLength: Array.isArray(project.conversations) ? project.conversations.length : undefined
            });
        }
    } else {
      // This case means the project object itself was invalid or missing when _postProjectDetailsSuccess was called.
      this.dashboardNotify.warn(`[ProjectDashboard] _postProjectDetailsSuccess: Invalid or missing project object received. Cannot evaluate conversations to set default chatId.`, {
          source: '_postProjectDetailsSuccess',
          projectId // projectId might still be valid if project object is not
      });
    }

    // Only dispatch if project object is available (direct-path or loaded via API)
    // For API path, projectManager.loadProjectDetails already emits 'projectLoaded'
    // This check ensures 'projectLoaded' is emitted if we came via direct object pass.
    if (project && project.id && (typeof projectObjOrId === 'object')) {
      const eventDoc = this.domAPI?.getDocument?.() || document;
      if (this.domAPI?.dispatchEvent) {
        this.domAPI.dispatchEvent(eventDoc, new CustomEvent('projectLoaded', { detail: project }));
      } else {
        eventDoc.dispatchEvent(new CustomEvent('projectLoaded', { detail: project }));
      }
    }
    // Make sure ChatManager is (re)initialised for this project
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
      listView.setAttribute('aria-hidden', String(!showList));
      listView.style.display = showList ? '' : 'none'; // Use empty string for default display (block or flex)
      // Ensure opacity-0 is removed when shown
      if (showList) {
        listView.classList.remove('opacity-0');
      }
      // Optionally, add opacity-0 back when hiding if you want a fade-out effect controlled here
      // else { listView.classList.add('opacity-0'); }
    }

    if (detailsView) {
      this.logger.info(`[ProjectDashboard] Setting detailsView visibility: ${showDetails ? 'VISIBLE' : 'HIDDEN'}`);
      detailsView.classList.toggle("hidden", !showDetails);
      detailsView.setAttribute("aria-hidden", String(!showDetails));
      detailsView.style.display = showDetails ? "flex" : "none"; // Project details uses flex
      // Ensure opacity-0 is removed and flex classes are present when shown
      if (showDetails) {
        detailsView.classList.remove("opacity-0"); // If it was hidden by opacity
        detailsView.classList.add("flex-1", "flex-col");
      } else {
        detailsView.classList.remove("flex-1", "flex-col");
        // Optionally, add opacity-0 back when hiding
        // detailsView.classList.add('opacity-0');
      }
    }

    // Also manage visibility of the chatHeaderBar
    const chatHeaderBar = this.domAPI.getElementById('chatHeaderBar');
    if (chatHeaderBar) {
      this.logger.info(`[ProjectDashboard] Setting chatHeaderBar visibility: ${showDetails ? 'VISIBLE' : 'HIDDEN'}`);
      chatHeaderBar.classList.toggle('hidden', !showDetails);
      chatHeaderBar.setAttribute('aria-hidden', String(!showDetails));
      // Ensure display style is also set correctly if 'hidden' class only does opacity or similar
      // chatHeaderBar.style.display = showDetails ? '' : 'none'; // Assuming default is block/flex
    }

    // Force browser reflow to ensure visibility transitions apply
    if ((listView && showList) || (detailsView && showDetails)) {
      const raf = this.browserService?.requestAnimationFrame || requestAnimationFrame;
      raf(() => {
        if (listView && showList) listView.getBoundingClientRect();
        if (detailsView && showDetails) detailsView.getBoundingClientRect();
      });
    }

    // Enhanced logging: log both class and style.display after change
    this.logger.info('[ProjectDashboard] View state after update:', {
      listViewVisible: listView ? !listView.classList.contains('hidden') && listView.style.display !== 'none' : false,
      detailsViewVisible: detailsView ? !detailsView.classList.contains('hidden') && detailsView.style.display !== 'none' : false,
      chatHeaderBarVisible: chatHeaderBar ? !chatHeaderBar.classList.contains('hidden') && chatHeaderBar.style.display !== 'none' : false,
      listViewDisplay: listView?.style.display || 'N/A',
      detailsViewDisplay: detailsView?.style.display || 'N/A',
      chatHeaderBarDisplay: chatHeaderBar?.style.display || 'N/A'
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
    // Re-obtiene instancias registradas tras el constructor
    this.components.projectList    = this.components.projectList    || this.getModule('projectListComponent')    || null;
    this.components.projectDetails = this.components.projectDetails || this.getModule('projectDetailsComponent') || null;

    this.logger.info('[ProjectDashboard] Initializing components...');

    /* Wait until the Project Details template is injected */
    await new Promise((resolve) => {
      // Use domAPI if available, otherwise fallback to document
      const doc = this.domAPI ? this.domAPI.getDocument() : document;
      const detailsTabs = this.domAPI ? this.domAPI.querySelector('#projectDetailsView .tabs[role="tablist"]') : doc.querySelector('#projectDetailsView .tabs[role="tablist"]');
      if (detailsTabs) return resolve();

      const eventTarget = this.domAPI ? this.domAPI.getDocument() : document;
      if (this.eventHandlers && this.eventHandlers.trackListener) {
        this.eventHandlers.trackListener(eventTarget, 'projectDetailsHtmlLoaded', () => resolve(), { once: true, context: 'projectDashboard', description: 'Wait for projectDetailsHtmlLoaded' });
      } else { // Fallback for safety, though eventHandlers should be present
        eventTarget.addEventListener('projectDetailsHtmlLoaded', () => resolve(), { once: true });
      }
    });

    /* Wait until the Project List template is injected */
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
        }, 10000); // 10 second timeout

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
            DependencySystem: this.dependencySystem, // Use the stored instance
            domSelectors: ['#projectList', '#projectList .grid', '#projectFilterTabs', '#projectListCreateBtn'], // Ensure key children are also ready
            timeout: 5000, // Keep timeout, but expect these to be ready if #projectList content is loaded
            notify: this.logger,
            domAPI: this.domAPI, // Pass domAPI as well, consistent with the other call
            source: 'ProjectDashboard_InitProjectList_ExtendedWait'
          });
          this.logger.info('[ProjectDashboard] ProjectList and its essential child DOM elements ready.');
        } catch (err) {
          this.logger.error('[ProjectDashboard] Timeout or error waiting for ProjectList DOM elements. Initialization will halt.', { error: err });
          // Decide if to proceed or throw
          throw err; // Re-throw the error to halt initialization of ProjectDashboard if critical elements for ProjectList are missing
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
            DependencySystem: this.getModule?.('DependencySystem') || null,
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
    const chatIdFromUrl = this.browserService.getSearchParam('chatId'); // Check for chatId too

    // Only navigate if the URL explicitly requests a project
    if (
      projectIdFromUrl &&
      (this.state.currentView !== 'details' || this.state.currentProject?.id !== projectIdFromUrl)
    ) {
      this.logger.info(`[ProjectDashboard] Processing URL parameter: project=${projectIdFromUrl}, chat=${chatIdFromUrl}`);
      this.showProjectDetails(projectIdFromUrl); // This will handle setting chatId if it's a new project load
    } else if (!projectIdFromUrl && this.state.currentView !== 'list') {
      this.logger.info('[ProjectDashboard] No project in URL, ensuring list view is shown.');
      this.showProjectList();
    } else {
      this.logger.info(
        `[ProjectDashboard] URL processing skipped: URL Project=${projectIdFromUrl}, Chat=${chatIdFromUrl}, CurrentView=${this.state.currentView}, CurrentProject=${this.state.currentProject?.id}`
      );
    }
  }

  _setupEventListeners() {
    const add = (el, event, handler, opts = {}) => {
      if (!this.eventHandlers?.trackListener)
        throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for event binding');
      // Ensure context is passed for all listeners tracked via this helper
      const optionsWithContext = { ...opts, context: 'projectDashboard' };
      this.eventHandlers.trackListener(el, event, handler, optionsWithContext);
      // If relying on context cleanup, manual _unsubs might be phased out or used for non-trackListener items.
      // For now, keep it to ensure existing cleanup paths are not broken if some listeners are not context-aware yet.
      this._unsubs.push(() => el.removeEventListener(event, handler, opts)); // Original opts for remove
    };

    add(document, 'projectsLoaded', this._handleProjectsLoaded.bind(this), { description: 'Dashboard: projectsLoaded' });
    add(document, 'projectLoaded', this._handleProjectLoaded.bind(this), { description: 'Dashboard: projectLoaded' });
    add(document, 'projectStatsLoaded', this._handleProjectStatsLoaded.bind(this), { description: 'Dashboard: projectStatsLoaded' });
    add(document, 'projectFilesLoaded', this._handleFilesLoaded.bind(this), { description: 'Dashboard: projectFilesLoaded' });
    add(document, 'projectArtifactsLoaded', this._handleArtifactsLoaded.bind(this), { description: 'Dashboard: projectArtifactsLoaded' });
    add(document, 'projectNotFound', this._handleProjectNotFound.bind(this), { description: 'Dashboard: projectNotFound' });
    add(document, 'projectCreated', this._handleProjectCreated.bind(this), { description: 'Dashboard: projectCreated' });

    // The popstate listener in initialize() already has context. This one might be redundant or for a different scope.
    // If this is intended to be separate, it needs its own unique description.
    // For now, assuming the one in initialize() is primary. If this is also needed, ensure its description is unique.
    // const win = this.getModule('windowObject') || undefined;
    // if (win) {
    //   add(win, 'popstate', this._handlePopState.bind(this), { description: 'Dashboard: popstate (global)'});
    // }

    add(document, 'authStateChanged', this._handleAuthStateChange.bind(this), { description: 'Dashboard: authStateChanged (global)' });
    add(document, 'projectDeleted', this._handleProjectDeleted.bind(this), { description: 'Dashboard: projectDeleted' }); // Add listener for project deletion
  }

  _handleProjectCreated(e) {
    const project = e.detail; // project object from ProjectManager
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

    // Pass the full project object to showProjectDetails
    // This allows showProjectDetails to access the default conversation ID if available
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

    if (!this.app?.state?.isAuthenticated) {
      this.dashboardNotify.warn('Not authenticated. Please log in to view projects.', { source: '_loadProjects' });
      this.logger.warn('[ProjectDashboard] Not authenticated, cannot load projects. Auth state:', this.app?.state);
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
        this.dashboardNotify.error('Failed to load projects. Please try again.', { source: '_executeProjectLoad', originalError: error });
      });
  }

  _handlePopState() {
    this._processUrlParameters();
  }

  _handleViewProject(projectId) {
    // Push url then show – enables Back button
    // Construct a clean, absolute path for navigation
    const newNavPath = `/project-details-view?project=${projectId}`;
    history.pushState({}, '', newNavPath);
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
    this.dashboardNotify.error('The requested project was not found', { source: '_handleProjectNotFound' });
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
