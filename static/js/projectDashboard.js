/**
 * projectDashboard.js
 *
 * Coordinates project dashboard components and state, interacting exclusively
 * via DependencySystem for all dependencies. No global/ .* access for shared modules.
 */

class ProjectDashboard {
  constructor(deps) { // Changed to accept a single deps object
    if (!deps.dependencySystem) throw new Error('[ProjectDashboard] dependencySystem is required.');
    this.dependencySystem = deps.dependencySystem; // Store for later use

    // Dependency resolution
    const getModule = (key) =>
      this.dependencySystem.modules.get(key) ||
      this.dependencySystem.modules.get(
        key.charAt(0).toLowerCase() + key.slice(1)
      );

    this.getModule = getModule;
    this.app = getModule('app');
    this.projectManager = getModule('projectManager');
    this.eventHandlers = deps.eventHandlers; // Directly from deps
    this.auth = getModule('auth');
    this.navigationService = getModule('navigationService');

    // Inject domAPI for all DOM access
    this.domAPI = deps.domAPI; // Directly from deps
    if (!this.domAPI) throw new Error('[ProjectDashboard] domAPI module required for DOM abstraction');

    this.components = {
      projectList: getModule('projectListComponent') || null,
      projectDetails: getModule('projectDetailsComponent') || null
    };

    // Injected browser abstractions
    this.browserService = deps.browserService; // Directly from deps
    if (!this.browserService) throw new Error('[ProjectDashboard] browserService module required');

    this.state = { currentView: null, currentProject: null, initialized: false };
    // Flag & stub view registration to prevent "unregistered view" errors 🔥
    this._viewsRegistered = false;
    this._ensureNavigationViews();
    this._unsubs = [];

    if (!this.eventHandlers?.trackListener) {
      throw new Error('[ProjectDashboard] eventHandlers.trackListener is required for event binding');
    }

    // AuthBus event with improved handling
    const authBus = this.auth?.AuthBus;
    const handler = (e) => {
      const { authenticated } = e.detail || {};

      // Always ensure UI elements are in the correct state
      const loginMsg = this.domAPI.getElementById('loginRequiredMessage');
      const mainCnt = this.domAPI.getElementById('mainContent');
      const projectListView = this.domAPI.getElementById('projectListView');
      const projectDetailsView = this.domAPI.getElementById('projectDetailsView');

      if (!authenticated) {
        // If the event indicates logout, ensure the UI reflects this.

        // Show login message, hide main content
        if (loginMsg) loginMsg.classList.remove('hidden');
        if (mainCnt) mainCnt.classList.add('hidden');

        // Hide project views
        if (projectListView) {
          projectListView.classList.add('hidden');
          projectListView.style.display = 'none';
        }
        if (projectDetailsView) {
          projectDetailsView.classList.add('hidden');
          projectDetailsView.style.display = 'none';
        }

        this.state._aborted = true; // Prevent any pending view transitions
        return;
      }

      // If authenticated:
      this.state._aborted = false; // Reset aborted flag

      // Hide login message, show main content
      if (loginMsg) loginMsg.classList.add('hidden');
      if (mainCnt) mainCnt.classList.remove('hidden');

      // Initialize if needed, then show project list
      const actionPromise = !this.state.initialized
        ? this.initialize().then(initSuccess => {
            if (initSuccess) {
              return this.showProjectList(); // This also loads projects
            }
            return null;
          })
        : Promise.resolve(this.showProjectList()); // showProjectList also calls _loadProjects

      actionPromise.then(() => {
        // Final safeguard: ensure project list is visible and login message is hidden
        this.browserService.setTimeout(() => {
          const finalLoginMsg = this.domAPI.getElementById('loginRequiredMessage');
          const finalMainCnt = this.domAPI.getElementById('mainContent');
          const finalListView = this.domAPI.getElementById('projectListView');

          if (finalLoginMsg) finalLoginMsg.classList.add('hidden');
          if (finalMainCnt) finalMainCnt.classList.remove('hidden');

          if (finalListView) {
            finalListView.classList.remove('hidden', 'opacity-0');
            finalListView.style.display = '';
            finalListView.style.visibility = 'visible';
            finalListView.style.opacity = '1';

            // Force reflow
            void finalListView.offsetHeight;
          }
        }, 200); // Increased delay for more reliability
      }).catch(() => {
        // Silent error handling
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
    // Store initialization start time for duration calculation
    this._initStartTime = Date.now();

    // Generate a unique trace ID for this initialization
    const DependencySystem = this.getModule?.('DependencySystem') || null;
    const traceId = DependencySystem?.getCurrentTraceIds?.()?.traceId || `trace-${this._initStartTime}`;
    const transactionId = DependencySystem?.generateTransactionId?.() || `txn-${this._initStartTime}`;

    if (this.state.initialized) {
      return true;
    }

    try {
      const authModule = this.getModule('auth');
      if (!authModule?.isAuthenticated?.()) {
        return false;
      }

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
          show: async (params = {}) => {
            this._setView({ showList: true, showDetails: false });
            if (this.components.projectList) this.components.projectList.show();
            this._loadProjects(); // Ensure projects are loaded when list view is shown
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

            this._setView({ showList: false, showDetails: true }); // Switch UI first

            if (!this.components.projectDetails) {
              this.navigationService.navigateToProjectList();
              return false;
            }

            await this.components.projectDetails.show(); // Ensure component UI is shown

            let projectToRender = null;
            if (this.projectManager && typeof this.projectManager.loadProjectDetails === 'function') { // Use loadProjectDetails directly
              try {
                projectToRender = await this.projectManager.loadProjectDetails(projectId);
              } catch (error) {
                // projectManager.loadProjectDetails already emits projectDetailsError/projectNotFound
                // and projectDashboard listens to projectNotFound to showProjectList.
                return false;
              }
            } else {
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
                // projectManager.loadProjectDetails would have emitted projectNotFound,
                // which projectDashboard listens to and calls showProjectList().
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

      // Mark as initialized
      this.state.initialized = true;

      // Calculate initialization duration
      const initEndTime = Date.now();
      const initDuration = initEndTime - (this._initStartTime || initEndTime);

      // Dispatch initialization event with detailed metadata
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent('projectDashboardInitialized', {
          detail: {
            success: true,
            timestamp: initEndTime,
            duration: initDuration,
            traceId,
            transactionId
          }
        })
      );

      return true;
    } catch (error) {
      // Calculate initialization duration even for failed attempts
      const initEndTime = Date.now();
      const initDuration = initEndTime - (this._initStartTime || initEndTime);

      // Mark as not initialized
      this.state.initialized = false;

      // Dispatch failure event with detailed metadata
      this.domAPI.dispatchEvent(
        this.domAPI.getDocument(),
        new CustomEvent('projectDashboardInitialized', {
          detail: {
            success: false,
            error,
            errorMessage: error?.message,
            timestamp: initEndTime,
            duration: initDuration,
            traceId,
            transactionId
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
    const ds = this.getModule('DependencySystem');
    if (ds && typeof ds.cleanupModuleListeners === 'function') {
      ds.cleanupModuleListeners('projectDashboard');
    } else if (this.eventHandlers?.cleanupListeners) {
      this.eventHandlers.cleanupListeners({ context: 'projectDashboard' });
    }
  }

  async showProjectList() {
    // this.state._aborted = false; // Explicitly reset _aborted flag here // TODO: Refactor state mutation
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
      } catch (err) {
        // Stop further execution if initialization fails
        return;
      }
    }

    if (this.components.projectList) {
      this.components.projectList.show();
    }

    this._loadProjects();

    this.browserService.setTimeout(() => {
      const listView = this.domAPI.getElementById('projectListView');
      if (listView) {
        listView.classList.remove('opacity-0');
        listView.style.display = '';
        listView.classList.remove('hidden');
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
      this.showProjectList();
      return false;
    }

    // Keep a boolean to signify whether we are dealing with a full project object
    const wasFullObject = (typeof projectObjOrId === 'object');

    this.state.currentView = null; // Indicate transition

    // Initialize ProjectDetails if needed, *before* trying to show/render
    if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
      try {
        await this.components.projectDetails.initialize();
      } catch (initErr) {
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
              return false;
            }
            this._setView({ showList: false, showDetails: true });

            if (this.components.projectDetails) this.components.projectDetails.show();

            if (this.components.projectList) this.components.projectList.hide();

            this.components.projectDetails.renderProject(project);

            // Final verification that the details are visible
            const detailsView = this.domAPI.getElementById('projectDetailsView');
            if (detailsView) {
              if (detailsView.classList.contains('hidden') || detailsView.style.display === 'none') {
                detailsView.classList.remove('hidden', 'opacity-0');
                detailsView.style.display = '';
                detailsView.setAttribute('aria-hidden', 'false');
              }
            }
          } catch (error) {
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
            return false;
          }
          if (!loadedProject) {
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
                return false;
              }
              this._setView({ showList: false, showDetails: true });

              if (this.components.projectDetails) this.components.projectDetails.show();

              if (this.components.projectList) this.components.projectList.hide();

              this.components.projectDetails.renderProject(project);

              const detailsView = this.domAPI.getElementById('projectDetailsView');
              if (detailsView) {
                if (detailsView.classList.contains('hidden') || detailsView.style.display === 'none') {
                  detailsView.classList.remove('hidden', 'opacity-0');
                  detailsView.style.display = '';
                  detailsView.setAttribute('aria-hidden', 'false');
                }
              }
            } catch (error) {
              this._setView({ showList: false, showDetails: true });
            }
          }
        } catch (error) {
          if (this._lastLoadId !== currentLoadId) {
            return false;
          }
          this.showProjectList();
          return false;
        }
        return this._postProjectDetailsSuccess(project, projectId, false);
      } else {
        this.showProjectList();
        return false;
      }
    } catch (err) { // Catch errors from the outer try block (e.g., initialization)
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
      }
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
        .catch(() => {
          // Silent error handling
        });
    }
    return true;
  }

  _setView({ showList, showDetails }) {
    if (this.state._aborted) {
      return;
    }

    // First, ensure login message is hidden and main content is visible
    const loginMessage = this.domAPI.getElementById('loginRequiredMessage');
    const mainContent = this.domAPI.getElementById('mainContent');

    if (loginMessage) loginMessage.classList.add('hidden');
    if (mainContent) mainContent.classList.remove('hidden');

    const listView = this.domAPI.getElementById('projectListView');
    const detailsView = this.domAPI.getElementById('projectDetailsView');
    const chatHeaderBar = this.domAPI.getElementById('chatHeaderBar');

    // Handle project list view visibility - use more direct approach to ensure visibility
    if (listView) {
      if (showList) {
        // Force visibility with multiple approaches to overcome any CSS conflicts
        listView.classList.remove('hidden');
        listView.classList.remove('opacity-0');
        listView.style.display = '';
        listView.style.visibility = 'visible'; // Explicitly set visibility
        listView.style.opacity = '1'; // Ensure opacity is set to visible
        this.domAPI.setAttribute(listView, 'aria-hidden', 'false');
        void listView.offsetHeight; // Force a reflow
      } else {
        this.domAPI.toggleClass(listView, 'hidden', true);
        listView.style.display = 'none';
        this.domAPI.setAttribute(listView, 'aria-hidden', 'true');
      }
    }

    // Handle project details view visibility - use more direct approach
    if (detailsView) {
      if (showDetails) {
        // Force visibility with multiple approaches to overcome any CSS conflicts
        detailsView.classList.remove('hidden');
        detailsView.style.display = 'flex';
        detailsView.style.visibility = 'visible'; // Explicitly set visibility
        detailsView.style.opacity = '1'; // Ensure opacity is set to visible
        this.domAPI.setAttribute(detailsView, 'aria-hidden', 'false');
        detailsView.classList.remove('opacity-0');
        detailsView.classList.add('flex-1', 'flex-col');
      } else {
        this.domAPI.toggleClass(detailsView, 'hidden', true);
        detailsView.style.display = 'none';
        this.domAPI.setAttribute(detailsView, 'aria-hidden', 'true');
        detailsView.classList.remove('flex-1', 'flex-col');
      }
    } else {
      // Try to recreate the details view if it's missing
      if (showDetails) {
        const projectManagerPanel = this.domAPI.getElementById('projectManagerPanel');
        if (projectManagerPanel) {
          const newDetailsView = this.domAPI.createElement('div');
          newDetailsView.id = 'projectDetailsView';
          newDetailsView.classList.add('flex-1', 'flex-col');
          newDetailsView.style.display = 'flex';
          newDetailsView.style.visibility = 'visible';
          newDetailsView.style.opacity = '1';
          projectManagerPanel.appendChild(newDetailsView);

          // Load the template content
          this.browserService.fetch('/static/html/project_details.html')
            .then(response => response.text())
            .then(html => {
              newDetailsView.innerHTML = html;

              // Notify that the template is loaded
              this.domAPI.dispatchEvent(
                this.domAPI.getDocument(),
                new CustomEvent('projectDetailsTemplateLoaded', { detail: { success: true } })
              );
            })
            .catch(() => {
              // Silent error handling
            });
        }
      }
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
      // Double-check login message is hidden and main content is visible
      const loginMsg = this.domAPI.getElementById('loginRequiredMessage');
      const mainCnt = this.domAPI.getElementById('mainContent');
      if (loginMsg) loginMsg.classList.add('hidden');
      if (mainCnt) mainCnt.classList.remove('hidden');

      // Ensure list view visibility
      if (listView && showList) {
        void listView.getBoundingClientRect();
        this.browserService.setTimeout(() => {
          if (listView.classList.contains('hidden') || listView.style.display === 'none') {
            listView.classList.remove('hidden');
            listView.classList.remove('opacity-0');
            listView.style.display = '';
            listView.style.visibility = 'visible';
            listView.style.opacity = '1';
          }
        }, 50);
      }

      // Ensure details view visibility
      if (detailsView && showDetails) {
        void detailsView.getBoundingClientRect();
        this.browserService.setTimeout(() => {
          if (detailsView.classList.contains('hidden') || detailsView.style.display === 'none') {
            detailsView.classList.remove('hidden');
            detailsView.classList.remove('opacity-0');
            detailsView.style.display = 'flex';
            detailsView.style.visibility = 'visible';
            detailsView.style.opacity = '1';
            detailsView.classList.add('flex-1', 'flex-col');
          }
        }, 50);
      }
    });

    // Final visibility check with a longer delay to catch any race conditions
    this.browserService.setTimeout(() => {
      const finalLoginMsg = this.domAPI.getElementById('loginRequiredMessage');
      const finalMainCnt = this.domAPI.getElementById('mainContent');

      if (finalLoginMsg) finalLoginMsg.classList.add('hidden');
      if (finalMainCnt) finalMainCnt.classList.remove('hidden');

      if (listView && showList && (listView.classList.contains('hidden') || listView.style.display === 'none')) {
        listView.classList.remove('hidden');
        listView.style.display = '';
        listView.style.visibility = 'visible';
        listView.style.opacity = '1';
      }

      if (detailsView && showDetails && (detailsView.classList.contains('hidden') || detailsView.style.display === 'none')) {
        detailsView.classList.remove('hidden');
        detailsView.style.display = 'flex';
        detailsView.style.visibility = 'visible';
        detailsView.style.opacity = '1';
      }
    }, 150);
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
    // Ensure we have the latest component references from DependencySystem
    this.components.projectList = this.components.projectList || this.getModule('projectListComponent') || null;
    this.components.projectDetails = this.components.projectDetails || this.getModule('projectDetailsComponent') || null;

    // First, wait for project details template to be loaded
    try {
      await new Promise((resolve) => {
        // First check if the template has already been loaded
        const doc = this.domAPI.getDocument();
        const detailsView = this.domAPI.getElementById('projectDetailsView');
        const detailsTabs = detailsView ? this.domAPI.querySelector('#projectDetailsView .tabs[role="tablist"]') : null;

        if (detailsTabs) {
          return resolve();
        }

        // Set up timeout for template loading
        const timeoutId = this.browserService.setTimeout(() => {
          // Don't reject - try to continue even if the template isn't loaded
          // This helps prevent hanging on initialization
          resolve();
        }, 8000);

        // Set up event listener for template loaded event
        const handler = (event) => {
          this.browserService.clearTimeout(timeoutId);
          resolve();
        };

        if (this.eventHandlers && this.eventHandlers.trackListener) {
          this.eventHandlers.trackListener(
            doc,
            'projectDetailsTemplateLoaded',
            handler,
            {
              once: true,
              context: 'projectDashboard',
              description: 'Wait for projectDetailsTemplateLoaded'
            }
          );
        } else {
          doc.addEventListener('projectDetailsTemplateLoaded', handler, { once: true });
        }

        // Check once more after setup in case event fired between our first check and listener setup
        const detailsViewRecheck = this.domAPI.getElementById('projectDetailsView');
        const detailsTabsRecheck = detailsViewRecheck ?
          this.domAPI.querySelector('#projectDetailsView .tabs[role="tablist"]') : null;

        if (detailsTabsRecheck) {
          this.browserService.clearTimeout(timeoutId);
          if (this.eventHandlers && this.eventHandlers.cleanupListeners) {
            this.eventHandlers.cleanupListeners({
              element: doc,
              type: 'projectDetailsTemplateLoaded',
              handler: handler
            });
          }
          resolve();
        }
      });
    } catch (err) {
      // Continue even if there was an error - we'll try to recover
    }

    // Next, wait for project list template to be loaded
    const listViewEl = this.domAPI.getElementById('projectListView');
    if (listViewEl && listViewEl.childElementCount > 0) {
      // Project list template already present
    } else {
      try {
        await new Promise((resolve) => {
          const eventTarget = this.domAPI.getDocument();

          // Set up timeout
          const timeoutId = this.browserService.setTimeout(() => {
            // Resolve anyway to prevent hanging
            resolve();
          }, 8000);

          const handler = (event) => {
            this.browserService.clearTimeout(timeoutId);
            resolve();
          };

          if (this.eventHandlers && this.eventHandlers.trackListener) {
            this.eventHandlers.trackListener(
              eventTarget,
              'projectListHtmlLoaded',
              handler,
              {
                once: true,
                context: 'projectDashboard',
                description: 'Wait for projectListHtmlLoaded'
              }
            );
          } else {
            eventTarget.addEventListener('projectListHtmlLoaded', handler, { once: true });
          }

          // Dispatch an event to trigger template loading if needed
          this.domAPI.dispatchEvent(
            eventTarget,
            new CustomEvent('requestProjectListTemplate', {
              detail: { requesterId: 'projectDashboard' }
            })
          );
        });
      } catch (err) {
        // Continue execution
      }
    }

    // Use waitForDepsAndDom utility if available
    const waitForDepsAndDom = this.globalUtils?.waitForDepsAndDom;
    if (!waitForDepsAndDom) {
      // Component initialization might be unstable
    }

    // Initialize ProjectList component
    if (this.components.projectList && !this.components.projectList.state?.initialized) {
      // Wait for DOM elements if possible
      if (waitForDepsAndDom) {
        try {
          await waitForDepsAndDom({
            DependencySystem: this.dependencySystem,
            domSelectors: ['#projectList', '#projectListView'],
            timeout: 5000,
            domAPI: this.domAPI,
            source: 'ProjectDashboard_InitProjectList'
          });
        } catch (err) {
          // Continue anyway
        }
      }

      // Now explicitly initialize the component
      try {
        if (typeof this.components.projectList.initialize === 'function') {
          await this.components.projectList.initialize();
        }
      } catch (err) {
        // Continue execution to give projectDetails a chance
      }
    }

    // Initialize ProjectDetails component
    if (this.components.projectDetails && !this.components.projectDetails.state?.initialized) {
      // Wait for DOM elements if possible
      if (waitForDepsAndDom) {
        try {
          await waitForDepsAndDom({
            DependencySystem: this.dependencySystem,
            domSelectors: ['#projectDetailsView'],
            timeout: 5000,
            domAPI: this.domAPI,
            source: 'ProjectDashboard_InitProjectDetails'
          });
        } catch (err) {
          // Continue anyway
        }
      }

      // Now explicitly initialize the component
      try {
        if (typeof this.components.projectDetails.initialize === 'function') {
          await this.components.projectDetails.initialize();
        }
      } catch (err) {
        // Silent error handling
      }
    }

    // Double check both components are properly accessible before completing
    this.components.projectList = this.components.projectList || this.getModule('projectListComponent');
    this.components.projectDetails = this.components.projectDetails || this.getModule('projectDetailsComponent');
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
          this.domAPI.dispatchEvent(
            this.domAPI.getDocument(),
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

    if (!this.app) {
      return;
    }

    const isAuthed =
      (this.app?.state?.isAuthenticated) ||
      (typeof this.auth?.isAuthenticated === 'function' && this.auth.isAuthenticated());

    if (!isAuthed) {
      this.browserService.setTimeout(() => {
        if (typeof this.auth?.isAuthenticated === 'function' && this.auth.isAuthenticated()) {
          this._loadProjects();
        }
      }, 500);
      return;
    }

    if (!this.projectManager) {
      return;
    }

    if (typeof this.projectManager.loadProjects !== 'function') {
      return;
    }

    if (!this.browserService || typeof this.browserService.setTimeout !== 'function') {
      this._executeProjectLoad();
      return;
    }

    this.browserService.setTimeout(() => this._executeProjectLoad(), 100);
  }

  _executeProjectLoad() {
    if (this.state._aborted) {
      return;
    }

    this.projectManager
      .loadProjects('all')
      .then((projects) => {
        if (this.state._aborted) {
          return;
        }
      })
      .catch(() => {
        // Silent error handling
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
      : null;
    const pathname = this.browserService.getLocationPathname
      ? this.browserService.getLocationPathname()
      : '/';
    if (historyObj && typeof historyObj.pushState === 'function') {
      historyObj.pushState(
        {},
        '',
        this.browserService.buildUrl ? this.browserService.buildUrl({ project: '' }) : pathname
      );
    }
    this.showProjectList();
  }

  _handleAuthStateChange(event) {
    const { authenticated, user, source } = event.detail || {};

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
        this.state.currentProject = null;
        this.browserService.removeSearchParam('project');

        if (projectListView) {
          projectListView.classList.remove('hidden');
          projectListView.classList.remove('opacity-0');
          projectListView.style.display = '';
          void projectListView.offsetHeight;
        }
        if (projectDetailsView) projectDetailsView.classList.add('hidden');

        const componentsInitialized = this.components.projectList && this.components.projectList.state?.initialized;
        if (!componentsInitialized) {
          this._initializeComponents()
            .then(() => {
              if (this.components.projectList) {
                this.components.projectList.show();
                this._loadProjects();
              }
            })
            .catch(() => {
              // Silent error handling
            });
        } else {
          if (this.components.projectList) {
            this.components.projectList.show();
          }
          if (this.components.projectDetails) {
            this.components.projectDetails.hide();
          }
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

  _handleProjectsLoaded(event) {
    const { projects = [], error = false, message } = event.detail || {};
    if (error) {
      this.browserService.requestAnimationFrame(() => {
        if (this.components.projectList?._showErrorState) {
          this.components.projectList._showErrorState(message || 'Failed to load projects');
        }
      });
      return;
    }
    this.browserService.requestAnimationFrame(() => {
      if (this.components.projectList) {
        this.components.projectList.renderProjects({ projects });
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
    this.state.currentProject = null;
    const detailsView = this.domAPI.getElementById('projectDetailsView');
    if (detailsView) {
      detailsView.classList.add('hidden');
      detailsView.style.display = 'none';
    }
    this.showProjectList();
  }

  _handleProjectDeleted(event) {
    const { projectId } = event.detail || {};
    if (this.state.currentProject && this.state.currentProject.id === projectId) {
      this.showProjectList();
    } else {
      if (this.state.currentView === 'list') {
        this._loadProjects();
      }
    }
  }

  /**
   * Ensure NavigationService knows about core views even before full
   * initialization. This prevents "Cannot activate unregistered view"
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

/**
 * Factory function for ProjectDashboard.
 * Validates all required dependencies at the top and exposes cleanup API.
 */
export function createProjectDashboard(deps) {
  // Validate required dependencies at the top
  if (!deps || typeof deps !== 'object') {
    throw new Error('[createProjectDashboard] A dependencies object is required.');
  }
  const requiredDeps = [
    'dependencySystem',
    'domAPI',
    'browserService',
    'eventHandlers'
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`[createProjectDashboard] Missing required dependency: ${dep}`);
    }
  }
  // Pass the full deps object to the constructor
  return new ProjectDashboard(deps);
}
