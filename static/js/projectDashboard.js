/**
 * projectDashboard.js
 * --------------------
 * Main controller class for the Project Dashboard UI.
 * Manages the overall UI flow, initialization, and interactions
 * between components and projectManager.js.
 *
 * NOTE: This file is loaded as an ES module, so we explicitly export classes to global scope
 */

// Class definition
class ProjectDashboard {
  constructor() {
    /**
     * Number of times we've attempted initialization
     * @private
     */
    this.initAttempts = 0;

    /**
     * Maximum number of initialization retries
     * @private
     */
    this.MAX_INIT_RETRIES = 3;

    /**
     * Default retry delay in ms (exponential backoff used in code)
     * @private
     */
    this.retryDelayBase = 300;

    /**
     * Dashboard-level UI components
     * @type {Object} e.g. { projectList, projectDetails, knowledgeBase }
     */
    this.components = {};

    /**
     * Current dashboard state
     */
    this.state = {
      currentView: null, // e.g. "list" or "details"
      currentProject: null
    };

    // Unified notification function
    this.showNotification = (message, type = "info") => {
      // Try standard wrappers, fallback to console
      if (window.showNotification) {
        window.showNotification(message, type);
      } else if (window.UIUtils?.showNotification) {
        window.UIUtils.showNotification(message, type);
      } else if (window.Notifications) {
        if (type === "error") window.Notifications.apiError(message);
        else if (type === "success") {
          if (window.Notifications.apiSuccess) {
            window.Notifications.apiSuccess(message);
          } else {
            console.log(`[SUCCESS] ${message}`);
          }
        } else {
          console.log(`[${type.toUpperCase()}] ${message}`);
        }
      } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
      }
    };

    // Use centralized modal manager from Utils
    this.modalManager = window.modalManager ||
      (window.ModalManager?.isAvailable?.() ? window.ModalManager : null);

    /**
     * Flag to prevent duplicate auth change handling
     * @private
     */
    this._handlingAuthChange = false;
  }

  /**
   * Initialize the dashboard with retry logic
   * @returns {Promise<boolean>} True if success
   */
  async init() {
    // Check authentication before proceeding
    const authenticated = await (window.auth?.throttledVerifyAuthState?.() ?? false);
    if (!authenticated) {
      console.warn('[ProjectDashboard] Initialization aborted: User is not authenticated.');
      this.showInitializationProgress('Please log in to view your projects.');
      // Optionally, show login screen or message
      let loginMsg = document.getElementById('loginRequiredMessage');
      if (!loginMsg) {
        loginMsg = document.createElement('div');
        loginMsg.id = 'loginRequiredMessage';
        loginMsg.className = 'text-center py-10 text-base-content/70';
        loginMsg.innerHTML = 'Please log in to view your projects';
        document.body.appendChild(loginMsg);
      }
      loginMsg.classList.remove('hidden');
      // Hide project panel if present
      const projectPanel = document.getElementById('projectManagerPanel');
      if (projectPanel) projectPanel.classList.add('hidden');
      this.hideInitializationProgress();
      return false;
    }

    const initId = `init-${Date.now().toString(36)}`; // Unique ID for this init run
    console.log(`[ProjectDashboard][${initId}] Initializing... Attempt: ${this.initAttempts + 1}`);
    this.showInitializationProgress("Starting initialization...");

    try {
      console.log(`[ProjectDashboard][${initId}] Checking max retries...`);
      if (this.initAttempts >= this.MAX_INIT_RETRIES) {
        this.hideInitializationProgress();
        this._handleCriticalError(
          new Error(`Max init attempts (${this.MAX_INIT_RETRIES}) reached.`)
        );
        return false;
      }

      // Check network connectivity first
      console.log(`[ProjectDashboard][${initId}] Checking network connectivity...`);
      if (!navigator.onLine) {
        this.hideInitializationProgress();
        this._handleCriticalError(
          new Error("Network connectivity issue. Please check your internet connection.")
        );
        return false;
      }

      console.log(`[ProjectDashboard][${initId}] Waiting for Authentication...`);
      // Use a timeout for auth wait to prevent hanging
      const authReady = await Promise.race([
        this._waitForAuthentication(),
        new Promise(resolve => setTimeout(() => {
          console.log(`[ProjectDashboard][${initId}] Auth wait timed out, proceeding anyway`);
          resolve(false);
        }, 5000))
      ]);
      console.log(`[ProjectDashboard][${initId}] Authentication wait completed (Authenticated: ${authReady})`);

      // Stagger initialization steps to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay

      console.log(`[ProjectDashboard][${initId}] Waiting for Dashboard Utils...`);
      await this._waitForDashboardUtils();
      console.log(`[ProjectDashboard][${initId}] Dashboard Utils ready.`);

      console.log(`[ProjectDashboard][${initId}] Checking for Component Exports...`);
      await this._ensureComponentsExported();
      console.log(`[ProjectDashboard][${initId}] Component exports verified.`);

      console.log(`[ProjectDashboard][${initId}] Waiting for Project Manager...`);
      await Promise.race([
        this._waitForProjectManager(),
        new Promise(resolve => {
          setTimeout(() => {
            console.log(`[ProjectDashboard][${initId}] ProjectManager wait timed out, proceeding with fallback`);
            // Set up fallback if project manager is unavailable
            if (!window.projectManager) {
              window.projectManager = this._createFallbackProjectManager();
            }
            resolve();
          }, 5000);
        })
      ]);
      console.log(`[ProjectDashboard][${initId}] Project Manager ready.`);

      console.log(`[ProjectDashboard][${initId}] Waiting for Document Ready...`);
      await this._waitForDocument();
      console.log(`[ProjectDashboard][${initId}] Document ready.`);

      // Complete initialization steps in chunks
      console.log(`[ProjectDashboard][${initId}] Starting final initialization steps...`);
      await new Promise(resolve => requestAnimationFrame(async () => {
        console.log(`[ProjectDashboard][${initId}] Running _completeInitialization...`);
        await this._completeInitialization();
        console.log(`[ProjectDashboard][${initId}] _completeInitialization finished.`);
        resolve();
      }));

      console.log(`[ProjectDashboard][${initId}] Initialized successfully.`);
      this.hideInitializationProgress();
      this.initAttempts = 0; // reset on success
      return true;
    } catch (err) {
      console.error(`[ProjectDashboard][${initId}] init attempt failed:`, err); // Log with ID
      this.hideInitializationProgress();

      this.initAttempts++;
      console.log(`[ProjectDashboard][${initId}] Incrementing attempt count to ${this.initAttempts}`);
      if (this.initAttempts < this.MAX_INIT_RETRIES) {
        const delay = this.retryDelayBase * this.initAttempts; // simple backoff
        console.log(
          `[ProjectDashboard] Retrying in ${delay}ms (attempt ${this.initAttempts} of ${this.MAX_INIT_RETRIES}).`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.init();
      }

      this._handleCriticalError(err, initId); // Pass ID for context
      return false;
    }
  }

  /**
   * Ensure required component classes are exported to window
   */
  async _ensureComponentsExported() {
    // Check if required component classes are available in global scope
    const requiredClasses = [
      'ProjectListComponent',
      'ProjectDetailsComponent',
      'KnowledgeBaseComponent'
    ];

    const missingClasses = requiredClasses.filter(className =>
      typeof window[className] !== 'function'
    );

    if (missingClasses.length > 0) {
      console.warn(`[ProjectDashboard] Missing global components: ${missingClasses.join(', ')}. Creating temporary exports...`);

      // Attempt to find modules in the DOM
      const scriptModules = Array.from(document.querySelectorAll('script[type="module"]'));

      // Log module URLs for debugging
      console.log('[ProjectDashboard] Found module scripts:',
        scriptModules.map(s => s.src).filter(s => s).join(', ')
      );

      // Wait for potential delayed exports
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check again after waiting
      for (const className of missingClasses) {
        if (typeof window[className] !== 'function') {
          console.warn(`[ProjectDashboard] Component ${className} still missing after wait.`);
        } else {
          console.log(`[ProjectDashboard] Component ${className} became available.`);
          missingClasses.splice(missingClasses.indexOf(className), 1);
        }
      }
    }
  }

  /* ===========================
     VIEW MANAGEMENT
     =========================== */

  async showProjectDetails(projectId) {
    this.state.currentView = "details";
    this.components.projectList?.hide();
    this.components.projectDetails?.show();
    window.history.pushState({}, "", `?project=${projectId}`);

    try {
      await window.projectManager.loadProjectDetails(projectId);
    } catch (error) {
      console.error("[ProjectDashboard] Failed to load project details:", error);
      this.showNotification("Failed to load project", "error");
      this.components.projectDetails?.hide();
      window.showProjectsView();
    }
  }

  showProjectList() {
    this.state.currentView = "list";
    this.components.projectDetails?.hide();
    this.components.projectList?.show();
    window.history.pushState({}, "", window.location.pathname);
    // Optionally load projects if needed
    if (window.projectManager) {
      window.projectManager.loadProjects('all').catch(err => {
        console.error("[ProjectDashboard] Failed to load projects:", err);
        this.showNotification("Failed to load projects", "error");
      });
    }
  }

  processUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");

    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      try {
        if (typeof window.showProjectsView === 'function') {
          window.showProjectsView();
        } else {
          console.warn("[ProjectDashboard] window.showProjectsView is not a function or not defined, using fallback");
          // Fallback logic to show project list view manually
          const listView = document.getElementById('projectListView');
          if (listView) {
            listView.classList.remove('hidden');
            listView.style.display = 'block'; // Ensure visibility
            console.log("[ProjectDashboard] Fallback: Manually showed projectListView");
          } else {
            console.warn("[ProjectDashboard] Fallback failed: #projectListView not found");
          }
          const detailsView = document.getElementById('projectDetailsView');
          if (detailsView) {
            detailsView.classList.add('hidden');
            console.log("[ProjectDashboard] Fallback: Manually hid projectDetailsView");
          }
          // Optionally, load projects if needed
          if (window.projectManager) {
            window.projectManager.loadProjects('all').catch(err => {
              console.error("[ProjectDashboard] Fallback: Failed to load projects:", err);
              this.showNotification("Failed to load projects", "error");
            });
          }
        }
      } catch (error) {
        console.error("[ProjectDashboard] Error in processUrlParams:", error);
        this.showNotification && this.showNotification("Error processing URL parameters", "error");
      }
    }
  }



  /* ===========================
     EVENT HANDLERS
     =========================== */

  handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }

  handleBackToList() {
    window.showProjectsView();
  }

  handleProjectsLoaded(event) {
    // Skip if this is an event from another source
    if (event.detail?.source && event.detail.source !== "projectManager") {
      console.log("[ProjectDashboard] Ignoring projectsLoaded event from other source:", event.detail.source);
      return;
    }

    const { projects = [], count = 0, filter = { type: "all" }, error = false, message = "" } = event.detail || {};
    const hasError = !!error;
    const originalCount = count;

    // Clear loading state explicitly if it wasn't cleared by loadProjects error handling
    const listContainer = document.getElementById("projectList");
    const loadingIndicator = listContainer?.querySelector('.loading-spinner');
    if (loadingIndicator) listContainer.innerHTML = ''; // Clear loading indicator

    // Render projects using the component
    this.components.projectList?.renderProjects(projects);

    // Show/hide "no projects" message
    const noProjectsMsg = document.getElementById("noProjectsMessage");
    if (noProjectsMsg) {
      const showNoProjects = projects.length === 0 && !hasError;
      noProjectsMsg.classList.toggle("hidden", !showNoProjects);

      if (showNoProjects) {
        if (originalCount > 0) { // Filter applied, but no results
          noProjectsMsg.textContent = `No projects found for filter: '${filter}'`;
        } else { // No projects exist at all
          noProjectsMsg.textContent = `No projects created yet. Click 'Create Project' to start.`;
        }
        noProjectsMsg.classList.remove("text-error"); // Ensure not red
      }

      // Handle error display (redundant if loadProjects handles it, but safe)
      if (hasError && projects.length === 0) {
        noProjectsMsg.textContent = `Error loading projects: ${message || 'Unknown error'}`;
        noProjectsMsg.classList.add("text-error");
        noProjectsMsg.classList.remove("hidden");
      }
    }
  }

  handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project;
    this.components.projectDetails?.renderProject(project);

    // If we have knowledge base info
    if (project.knowledge_base_id && this.components.knowledgeBase) {
      // If project contains knowledge_base object, pass it
      if (project.knowledge_base) {
        this.components.knowledgeBase.renderKnowledgeBaseInfo(project.knowledge_base, project.id);
      } else if (window.projectManager?.loadKnowledgeBaseDetails) {
        window.projectManager.loadKnowledgeBaseDetails(project.knowledge_base_id)
          .catch(err => {
            console.error("[ProjectDashboard] Failed to load KB details:", err);
          });
      }
    } else if (this.components.knowledgeBase) {
      // Indicate no KB, but still pass the project ID
      this.components.knowledgeBase.renderKnowledgeBaseInfo(null, project.id);
    }
  }

  handleProjectStatsLoaded(event) {
    const stats = event.detail;
    this.components.projectDetails?.renderStats(stats);

    // If stats has knowledge_base info, pass it along with the project ID
    if (stats && stats.knowledge_base && this.components.knowledgeBase) {
      this.components.knowledgeBase.renderKnowledgeBaseInfo(stats.knowledge_base, this.state.currentProject?.id);
    }
  }

  handleFilesLoaded(event) {
    this.components.projectDetails?.renderFiles(event.detail.files);
  }

  handleProjectNotFound(event) {
    const { projectId } = event.detail;
    console.warn(`Project not found: ${projectId}`);

    // Clear current project reference
    this.state.currentProject = null;

    // Show notification
    this.showNotification('The requested project was not found', 'error');

    // Return to project list
    this.showProjectList();
  }

  handleConversationsLoaded(event) {
    let conversations = [];

    if (Array.isArray(event.detail)) {
      conversations = event.detail;
    } else if (event.detail?.conversations) {
      conversations = event.detail.conversations;
    } else if (event.detail?.data?.conversations) {
      conversations = event.detail.data.conversations;
    }
    this.components.projectDetails?.renderConversations(conversations);

    // Refresh stats after conversations load
    if (this.state.currentProject?.id) {
      window.projectManager.loadProjectStats(this.state.currentProject.id)
        .catch(err => {
          console.warn('[ProjectDashboard] Error refreshing stats after conversation load:', err);
        });
    }
  }

  handleArtifactsLoaded(event) {
    this.components.projectDetails?.renderArtifacts?.(event.detail.artifacts);
  }

  /* ===========================
     PRIVATE HELPER METHODS
     =========================== */
  _isDocumentReady() {
    return document.readyState === "complete" || document.readyState === "interactive";
  }

  showInitializationProgress(message) {
    let el = document.getElementById("dashboardInitProgress");
    if (!el) {
      el = document.createElement("div");
      el.id = "dashboardInitProgress";
      // Use DaisyUI alert styling
      el.className = "alert alert-info shadow-md fixed top-4 right-4 z-[100] w-auto max-w-xs";
      document.body.appendChild(el);
    }

    const currentMessage = el.querySelector('span')?.textContent;
    if (currentMessage !== message) {
      // Use DaisyUI loading spinner
      el.innerHTML = `
        <span class="loading loading-spinner loading-sm"></span>
        <span>${message || "Initializing dashboard..."}</span>
      `;
    }
    el.style.display = 'flex';
  }

  hideInitializationProgress() {
    const el = document.getElementById("dashboardInitProgress");
    if (el) {
      el.remove();
    }
  }

  _handleCriticalError(error) {
    console.error("[ProjectDashboard] Critical error:", error);
    // Use DaisyUI alert for error display
    const containerEl = document.querySelector("#projectListView") || document.body; // Fallback to body
    const errorElId = 'dashboardCriticalError';
    let errorEl = document.getElementById(errorElId);
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.id = errorElId;
      // Use DaisyUI alert error style
      errorEl.className = 'alert alert-error shadow-lg m-4';
      containerEl.prepend(errorEl); // Prepend to make it visible
    }
    errorEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      <div>
        <h3 class="font-bold">Dashboard Initialization Failed!</h3>
        <div class="text-xs">${error.message || "Unknown error occurred"}. Try refreshing the page.</div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="window.location.reload()">Refresh</button>
      <button class="btn btn-sm btn-ghost" onclick="window.initProjectDashboard()">Retry</button>
    `;
    // Ensure the container holding the error is visible
    if (containerEl && containerEl.id === 'projectListView') {
      containerEl.classList.remove('hidden');
    }
  }

  /**
   * Creates a fallback project manager if the real one isn't available
   * @returns {Object} - Minimal project manager with required methods
   */
  _createFallbackProjectManager() {
    console.warn('[ProjectDashboard] Creating fallback project manager');
    return {
      loadProjects: () => {
        console.warn('[Fallback] loadProjects called');
        return Promise.resolve([]);
      },
      loadProjectDetails: (id) => {
        console.warn('[Fallback] loadProjectDetails called for:', id);
        return Promise.resolve({
          id: id,
          name: "Project Not Available",
          description: "Unable to load project details. Please check your connection.",
          files: [],
          conversations: []
        });
      },
      loadProjectStats: () => Promise.resolve({}),
      loadProjectFiles: () => Promise.resolve([]),
      loadProjectConversations: () => Promise.resolve([]),
      loadProjectArtifacts: () => Promise.resolve([]),
      initialize: () => Promise.resolve(true)
    };
  }

  // Fallback components if real ones are missing
  ensureFallbackComponents() {
    if (typeof window.ProjectListComponent !== "function") {
      console.warn("[ProjectDashboard] Creating fallback ProjectListComponent");
      window.ProjectListComponent = class {
        constructor(options = {}) {
          this.elementId = options.elementId;
          this.element = document.getElementById(this.elementId);
          this.onViewProject = options.onViewProject;
          if (!this.element) {
            this.element = document.createElement("div");
            this.element.id = this.elementId;
            // Ensure projectListView exists or create it
            let projectListView = document.querySelector("#projectListView");
            if (!projectListView) {
              projectListView = document.createElement("div");
              projectListView.id = "projectListView";
              document.body.appendChild(projectListView);
            }
            projectListView.appendChild(this.element);
          }
        }
        show() {
          this.element?.classList.remove("hidden");
        }
        hide() {
          this.element?.classList.add("hidden");
        }
        renderProjects(projects = []) {
          if (!this.element) return;
          this.element.innerHTML = `
            <div class="text-center p-4">
              ${projects.length === 0 ?
              'No projects available. Create a project to get started.' :
              `Displaying ${projects.length} projects.`}
            </div>`;
        }
      };
    }

    if (typeof window.ProjectDetailsComponent !== "function") {
      console.warn("[ProjectDashboard] Creating fallback ProjectDetailsComponent");
      window.ProjectDetailsComponent = class {
        constructor(options = {}) {
          this.element = document.getElementById("projectDetailsView");
          this.onBack = options.onBack;
          if (!this.element) {
            this.element = document.createElement("section");
            this.element.id = "projectDetailsView";
            this.element.className = "flex-1 flex flex-col overflow-hidden hidden";
            document.body.appendChild(this.element);
          }
        }
        show() {
          this.element?.classList.remove("hidden");
        }
        hide() {
          this.element?.classList.add("hidden");
        }
        renderProject(project) {
          if (!this.element) return;
          this.element.innerHTML = `
            <div class="p-4">
              <h2 class="text-xl font-bold">${project?.name || 'Project Details'}</h2>
              <p class="text-gray-600">${project?.description || 'No description available'}</p>
              <button class="btn btn-sm btn-ghost mt-4" id="fallbackBackBtn">Back to Projects</button>
            </div>
          `;
          document.getElementById('fallbackBackBtn')?.addEventListener('click', this.onBack);
        }
        renderStats() { }
        renderFiles() { }
        renderConversations() { }
        renderArtifacts() { }
        uploadFiles() {
          return Promise.reject("uploadFiles not implemented in fallback");
        }
      };
    }

    if (typeof window.KnowledgeBaseComponent !== "function") {
      console.warn("[ProjectDashboard] Creating fallback KnowledgeBaseComponent");
      window.KnowledgeBaseComponent = class {
        constructor() { }
        renderKnowledgeBaseInfo(kb) {
          console.log("Fallback KnowledgeBaseComponent:", kb);
        }
      };
    }
  }

  async _completeInitialization() {
    if (!window.projectManager) {
      window.projectManager = this._createFallbackProjectManager();
      console.warn("[ProjectDashboard] Created fallback projectManager");
    }

    // Wait for templates to load with proper coordination
    console.log("[ProjectDashboard] Waiting for templates before component initialization...");

    // First check the flag to see if templates are claimed to be in the DOM
    let templatesReady = window.templatesLoadedInDOM || false;

    // If not, wait using our template tracker system
    if (!templatesReady && window.waitForTemplatesLoaded) {
      templatesReady = await window.waitForTemplatesLoaded(6000);  // Wait up to 6 seconds
    }

    // If still not ready, we'll wait one more time with DOM checks
    if (!templatesReady) {
      console.warn("[ProjectDashboard] Template tracker didn't confirm loading, doing manual checks");
      await this._manualTemplateCheck();
    }

    this.showInitializationProgress("Loading components...");

    // Ensure essential containers exist with improved visibility handling
    this._ensureContainersExist();

    // Ensure fallback components if the real ones aren't there
    this.ensureFallbackComponents();

    // Create components with retries
    await this._createComponentsWithRetry();

    // Hide spinner after we have components
    this.hideInitializationProgress();

    // Mark dashboard as initialized BEFORE processing URL
    window.projectDashboardInitialized = true;
    document.dispatchEvent(new CustomEvent("projectDashboardInitialized"));

    // Register event listeners
    this.registerEventListeners();

    // If there's a global or existing modal manager, set that up
    if (window.ModalManager && !window.modalManager) {
      window.modalManager = new window.ModalManager();
    }

    // Process URL with auth check AFTER basic setup
    await this._processUrlWithAuthCheck();

    // Mark app initialization as complete AFTER URL processing
    window.__appInitializing = false;
    console.log("[ProjectDashboard] App initialization flag set to false.");
  }

  /**
   * Performs manual checks for critical template elements
   */
  async _manualTemplateCheck() {
    // Critical elements that must be present after template loading
    const criticalElements = [
      // Project list elements
      { id: 'projectList', template: 'project_list.html' },
      { id: 'createProjectBtn', template: 'project_list.html' },
      { id: 'noProjectsMessage', template: 'project_list.html' },

      // Project details elements
      { id: 'projectTitle', template: 'project_details.html' },
      { id: 'backToProjectsBtn', template: 'project_details.html' },
      { id: 'filesTab', template: 'project_details.html' },
      { id: 'dragDropZone', template: 'project_details.html' },
      { id: 'projectFilesList', template: 'project_details.html' },

      // Modal elements
      { id: 'projectFormModal', template: 'modals.html' }
    ];

    // Wait for essential elements from each template
    const maxAttempts = 15;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const missingElements = criticalElements.filter(el => !document.getElementById(el.id));

      if (missingElements.length === 0) {
        console.log("[ProjectDashboard] Manual check confirmed all critical elements exist");
        return true;
      }

      console.log(`[ProjectDashboard] Waiting for elements (${attempts+1}/${maxAttempts}): ${missingElements.map(el => el.id).join(', ')}`);

      // Check template content
      const listView = document.getElementById('projectListView');
      const detailsView = document.getElementById('projectDetailsView');
      const modalsContainer = document.getElementById('modalsContainer');

      if (!listView?.innerHTML || !detailsView?.innerHTML || !modalsContainer?.innerHTML) {
        console.log("[ProjectDashboard] Template containers still empty, waiting...");
      }

      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }

    console.warn("[ProjectDashboard] Some elements still missing after wait, continuing with fallbacks");
    return false;
  }

  async _ensureContainersExist() {
    // Get authentication state (properly await the Promise if it's async)
    let isAuthenticated = false;
    try {
      if (window.auth?.isAuthenticated) {
        if (typeof window.auth.isAuthenticated === 'function') {
          isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
        } else {
          isAuthenticated = !!window.auth.isAuthenticated;
        }
      }
    } catch (err) {
      console.warn('[ProjectDashboard] Error checking authentication:', err);
    }

    console.log(`[ProjectDashboard] _ensureContainersExist (authenticated: ${isAuthenticated})`);

    // Ensure projectManagerPanel exists and is visible when authenticated
    const projectManagerPanel = document.getElementById("projectManagerPanel");
    if (projectManagerPanel) {
      projectManagerPanel.classList.toggle('hidden', !isAuthenticated);
    }

    // Ensure projectListView exists
    let projectListView = document.getElementById("projectListView");
    if (!projectListView) {
      console.log('[ProjectDashboard] Creating missing projectListView element');
      projectListView = document.createElement('main');
      projectListView.id = "projectListView";
      projectListView.className = "flex-1 overflow-y-auto p-4 lg:p-6";

      // Try to find the right container to append to
      const drawerContent = document.querySelector('.drawer-content');
      const projectManagerPanel = document.getElementById('projectManagerPanel');

      if (projectManagerPanel) {
        projectManagerPanel.appendChild(projectListView);
      } else if (drawerContent) {
        drawerContent.appendChild(projectListView);
      } else {
        document.body.appendChild(projectListView);
      }
    }

    // Set proper visibility based on auth state
    projectListView.classList.toggle('hidden', !isAuthenticated);
    if (isAuthenticated) {
      projectListView.style.display = 'flex';
      projectListView.style.flexDirection = 'column';
    }

    // Ensure projectList grid exists
    let projectListGrid = document.getElementById("projectList");
    if (!projectListGrid) {
      console.log('[ProjectDashboard] Creating missing projectList grid element');
      projectListGrid = document.createElement('div');
      projectListGrid.id = "projectList";
      projectListGrid.className = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

      if (projectListView) {
        // Find existing filter tabs to insert after, or prepend
        const filterTabs = projectListView.querySelector('#projectFilterTabs');
        if (filterTabs) {
          filterTabs.after(projectListGrid);
        } else {
          projectListView.appendChild(projectListGrid);
        }
      }
    }

    // Ensure noProjectsMessage exists
    let noProjectsMessage = document.getElementById("noProjectsMessage");
    if (!noProjectsMessage) {
      console.log('[ProjectDashboard] Creating missing noProjectsMessage element');
      noProjectsMessage = document.createElement('div');
      noProjectsMessage.id = "noProjectsMessage";
      noProjectsMessage.className = "text-center py-10 text-base-content/70 hidden";
      noProjectsMessage.textContent = "No projects found. Create your first project using the \"New Project\" button.";
      if (projectListView) {
        projectListView.appendChild(noProjectsMessage);
      }
    }

    // Ensure loginRequiredMessage exists and is properly visible
    let loginRequiredMessage = document.getElementById("loginRequiredMessage");
    if (!loginRequiredMessage) {
      console.log('[ProjectDashboard] Creating missing loginRequiredMessage element');
      loginRequiredMessage = document.createElement('div');
      loginRequiredMessage.id = "loginRequiredMessage";
      loginRequiredMessage.className = "text-center py-10 text-base-content/70";
      loginRequiredMessage.innerHTML = "Please log in to view your projects";

      // Try to find main content container to append to
      const mainContent = document.querySelector('main') || document.body;
      mainContent.appendChild(loginRequiredMessage);
    }

    // Set visibility for login message
    if (loginRequiredMessage) {
      loginRequiredMessage.classList.toggle('hidden', isAuthenticated);
    }

    // Ensure projectDetailsView exists and is properly hidden initially
    const projectDetailsView = document.getElementById("projectDetailsView");
    if (projectDetailsView) {
      projectDetailsView.classList.add("hidden");
    } else {
      console.log('[ProjectDashboard] Creating missing projectDetailsView element');
      // Create details view if missing (basic structure)
      const detailsContainer = document.createElement('section');
      detailsContainer.id = "projectDetailsView";
      detailsContainer.className = "flex-1 flex flex-col overflow-hidden hidden";

      // Find appropriate container to append to
      const projectManagerPanel = document.getElementById('projectManagerPanel');
      if (projectManagerPanel) {
        projectManagerPanel.appendChild(detailsContainer);
      } else {
        const drawerContent = document.querySelector('.drawer-content');
        if (drawerContent) {
          drawerContent.appendChild(detailsContainer);
        } else {
          document.body.appendChild(detailsContainer);
        }
      }
    }

    // Force load HTML templates if they're missing
    await this._ensureTemplatesLoaded();
  }

  /**
   * Ensure HTML templates are loaded for project list and details views
   */
  async _ensureTemplatesLoaded() {
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');

    if (projectListView && projectListView.children.length === 0) {
      console.log('[ProjectDashboard] Attempting to load project_list.html template');
      try {
        const response = await fetch('/static/html/project_list.html');
        if (response.ok) {
          const html = await response.text();
          projectListView.innerHTML = html;
          console.log('[ProjectDashboard] Successfully loaded project_list.html template');

          // Also mark as loaded in the template tracker if it exists
          if (window.templateLoadTracker) {
            window.templateLoadTracker.markLoaded('project_list.html');
          }
        }
      } catch (err) {
        console.error('[ProjectDashboard] Failed to load project_list.html:', err);
      }
    }

    if (projectDetailsView && projectDetailsView.children.length === 0) {
      console.log('[ProjectDashboard] Attempting to load project_details.html template');
      try {
        const response = await fetch('/static/html/project_details.html');
        if (response.ok) {
          const html = await response.text();
          projectDetailsView.innerHTML = html;
          console.log('[ProjectDashboard] Successfully loaded project_details.html template');

          // Also mark as loaded in the template tracker if it exists
          if (window.templateLoadTracker) {
            window.templateLoadTracker.markLoaded('project_details.html');
          }
        }
      } catch (err) {
        console.error('[ProjectDashboard] Failed to load project_details.html:', err);
      }
    }
  }

  async _createComponentsWithRetry(attempts = 0) {
    const maxAttempts = 3;
    const waitTimeout = 5000; // 5 seconds timeout for waiting for components

    try {
      // Create component instances now that constructors are available
      this.components.projectList = new window.ProjectListComponent({
        elementId: "projectList",
        onViewProject: this.handleViewProject.bind(this)
      });

      this.components.projectDetails = new window.ProjectDetailsComponent({
        onBack: this.handleBackToList.bind(this),
        utils: window.uiUtilsInstance || window.UIUtils,
        projectManager: window.projectManager,
        auth: window.auth,
        notification: this.showNotification
      });

      // Conditionally initialize KnowledgeBaseComponent
      const kbContainer = document.getElementById('knowledgeBaseContainer');
      const shouldInitKB = kbContainer && kbContainer.dataset.requiresKb === 'true' && this.state.currentView === 'details' && this.state.currentProject?.knowledge_base_id;

      if (shouldInitKB && typeof window.KnowledgeBaseComponent === "function") {
        console.log("[ProjectDashboard] Initializing KnowledgeBaseComponent.");
        this.components.knowledgeBase = new window.KnowledgeBaseComponent({});
      } else {
        console.log(`[ProjectDashboard] Skipping KnowledgeBaseComponent initialization.`);
        this.components.knowledgeBase = null;
      }

    } catch (err) {
      console.error(`[ProjectDashboard] Component creation attempt ${attempts + 1} failed:`, err);

      if (attempts < maxAttempts) {
        const delay = 100 * Math.pow(2, attempts);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._createComponentsWithRetry(attempts + 1);
      }

      console.warn("[ProjectDashboard] Using fallback components after repeated failures");
      this.ensureFallbackComponents(); // Ensure fallbacks are created if retries fail

      // Re-create with fallbacks if necessary
      if (!this.components.projectList) {
        this.components.projectList = new window.ProjectListComponent({
          elementId: "projectList",
          onViewProject: this.handleViewProject.bind(this)
        });
      }
      if (!this.components.projectDetails) {
        this.components.projectDetails = new window.ProjectDetailsComponent({
          onBack: this.handleBackToList.bind(this),
          utils: window.uiUtilsInstance || window.UIUtils,
          projectManager: window.projectManager,
          auth: window.auth,
          notification: this.showNotification
        });
      }
    }
  }

  async _waitForAuthentication() {
    const waitId = `waitAuth-${Date.now().toString(36)}`;
    console.log(`[ProjectDashboard][${waitId}] Checking authentication state...`);
    this.showInitializationProgress("Checking authentication state...");

    // Check if auth module exists first
    if (!window.auth || typeof window.auth.isAuthenticated !== 'function') {
      console.warn(`[ProjectDashboard][${waitId}] Auth module not available or missing isAuthenticated.`);
      // Proceed without authentication, UI should handle this state
      return false;
    }

    // First check if we already have auth info (quick check)
    try {
      const authenticated = await window.auth.isAuthenticated({ forceVerify: false });
      if (authenticated) {
        console.log(`[ProjectDashboard][${waitId}] User is authenticated (cached), proceeding.`);
        return true;
      }
    } catch (err) {
      console.warn(`[ProjectDashboard][${waitId}] Initial auth check failed:`, err);
      // Continue to wait for event or timeout
    }

    // If not authenticated, wait a bit for possible login or authReady event
    console.log(`[ProjectDashboard][${waitId}] Not authenticated, waiting for authReady or authStateChanged event (max 3s)...`);
    return new Promise((resolve) => {
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (!resolved) {
          console.log(`[ProjectDashboard][${waitId}] Proceeding without confirmed authentication after timeout.`);
          document.removeEventListener("authReady", authListener);
          document.removeEventListener("authStateChanged", authListener);
          resolve(false); // Resolve false after timeout
        }
      }, 3000); // 3-second timeout

      const authListener = (event) => {
        if (resolved) return; // Prevent multiple resolves
        const isAuthenticated = event.detail?.authenticated || false;
        console.log(`[ProjectDashboard][${waitId}] Received '${event.type}' event (Authenticated: ${isAuthenticated})`);
        clearTimeout(timeoutId);
        document.removeEventListener("authReady", authListener);
        document.removeEventListener("authStateChanged", authListener);
        resolved = true;
        resolve(isAuthenticated);
      };

      document.addEventListener("authReady", authListener, { once: true });
      document.addEventListener("authStateChanged", authListener, { once: true });

      // Final check in case event fired before listener attached
      if (window.auth?.isReady) {
        if (!resolved) {
          console.log(`[ProjectDashboard][${waitId}] Auth state already verified, resolving.`);
          clearTimeout(timeoutId);
          document.removeEventListener("authReady", authListener);
          document.removeEventListener("authStateChanged", authListener);
          resolved = true;
          window.auth.isAuthenticated({ forceVerify: false }).then(authenticated => {
            resolve(authenticated);
          }).catch(() => {
            resolve(false);
          });
        }
      }
    });
  }

  async _waitForDashboardUtils() {
    const waitId = `waitUtils-${Date.now().toString(36)}`;
    console.log(`[ProjectDashboard][${waitId}] Checking dashboardUtilsReady...`);

    // First check if the flag is already set
    if (window.dashboardUtilsReady === true) {
      console.log(`[ProjectDashboard][${waitId}] dashboardUtilsReady flag already true.`);
      return;
    }

    this.showInitializationProgress("Waiting for dashboard utilities...");
    console.log(`[ProjectDashboard][${waitId}] dashboardUtilsReady flag not set, starting wait...`);

    try {
      // Increased timeout to 10s (from 5s)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timeout (10s) waiting for dashboardUtilsReady")),
          10000 // Increased timeout
        );

        // Check flag periodically while waiting for event
        const checkInterval = setInterval(() => {
          if (window.dashboardUtilsReady === true) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            document.removeEventListener("dashboardUtilsReady", handleUtilsReady); // Ensure listener removed
            resolve();
          }
        }, 100);

        const handleUtilsReady = () => {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        };

        document.addEventListener("dashboardUtilsReady", handleUtilsReady, { once: true });
      });

      console.log(`[ProjectDashboard][${waitId}] dashboardUtilsReady event received or flag found.`);
    } catch (err) {
      console.error(`[ProjectDashboard][${waitId}] Error waiting for dashboard utils:`, err);
      // If utils are loaded but the event wasn't fired, we can still proceed
      if (window.dashboardUtilsReady === true ||
        (window.ProjectDashboard && window.ProjectDashboard._initialized)) {
        console.warn(`[ProjectDashboard][${waitId}] Proceeding despite timeout - utils appear to be ready`);
        return;
      }

      // Create basic dashboardUtils as fallback
      console.warn(`[ProjectDashboard][${waitId}] Creating fallback dashboard utils`);
      window.dashboardUtilsReady = true;
      window.showProjectsView = window.showProjectsView || function () {
        const listView = document.getElementById('projectListView');
        const detailsView = document.getElementById('projectDetailsView');
        if (listView) listView.classList.remove('hidden');
        if (detailsView) detailsView.classList.add('hidden');
      };
    }
  }

  async _waitForProjectManager() {
    const waitId = `waitPM-${Date.now().toString(36)}`;
    console.log(`[ProjectDashboard][${waitId}] Checking projectManager...`);
    if (window.projectManager) {
      console.log(`[ProjectDashboard][${waitId}] projectManager already available.`);
      return;
    }
    this.showInitializationProgress("Waiting for ProjectManager...");
    console.log(`[ProjectDashboard][${waitId}] projectManager not found, starting wait...`);
    await new Promise((resolve, reject) => {
      let checks = 0;
      const maxChecks = 40; // 40 * 100ms = 4 seconds
      const checkInterval = setInterval(() => {
        if (window.projectManager) {
          console.log(`[ProjectDashboard][${waitId}] projectManager found after ${checks * 100}ms.`);
          clearInterval(checkInterval);
          resolve();
        } else if (++checks >= maxChecks) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for ProjectManager after ${maxChecks * 100}ms`));
        }
      }, 100);
    });
  }

  async _waitForDocument() {
    const waitId = `waitDoc-${Date.now().toString(36)}`;
    console.log(`[ProjectDashboard][${waitId}] Checking document readyState...`);
    if (this._isDocumentReady()) {
      console.log(`[ProjectDashboard][${waitId}] Document already ready.`);
      return;
    }
    this.showInitializationProgress("Waiting for DOM...");
    console.log(`[ProjectDashboard][${waitId}] Document not ready, adding DOMContentLoaded listener.`);
    await new Promise(resolve => {
      document.addEventListener("DOMContentLoaded", () => {
        console.log(`[ProjectDashboard][${waitId}] DOMContentLoaded event fired.`);
        resolve();
      }, { once: true }); // Ensure listener is removed after firing
    });
  }

  async _processUrlWithAuthCheck() {
    // Check authentication before handling URL
    let isAuthenticated = false;

    try {
      if (window.auth?.isAuthenticated) {
        isAuthenticated = await Promise.race([
          window.auth.isAuthenticated({ forceVerify: false }),
          new Promise(resolve => setTimeout(() => {
            console.log("[ProjectDashboard] Auth check timed out, assuming not authenticated");
            resolve(false);
          }, 3000))
        ]);
      }
    } catch (err) {
      console.warn("[ProjectDashboard] Auth check failed:", err);
    }

    if (isAuthenticated) {
      this.processUrlParams();
      // Project loading is now handled by app.js's refreshAppData()
    } else {
      // Show login required state instead of processing URL
      this.showProjectList(); // This will show login required if auth check fails
    }
  }

  async loadProjects() {
    // Check if projects are already being loaded by app.js
    if (window.__projectLoadingInProgress) {
      console.log("[ProjectDashboard] Project loading already in progress from app.js, skipping duplicate load");
      return;
    }

    // Only load projects if we have a manager and no loading is in progress
    if (window.projectManager) {
      try {
        // Set global flag to prevent duplicate loading
        window.__projectLoadingInProgress = true;

        const projects = await window.projectManager.loadProjects('all');

        // Clear flag when done
        window.__projectLoadingInProgress = false;
        return projects;
      } catch (err) {
        console.error("[ProjectDashboard] Error in loadProjects:", err);
        this.showNotification("Failed to load projects. Please check your connection.", "error");

        // Clear flag on error too
        window.__projectLoadingInProgress = false;

        // Dispatch empty projects event to handle UI gracefully
        document.dispatchEvent(new CustomEvent("projectsLoaded", {
          detail: {
            projects: [],
            count: 0,
            filter: { type: 'all' },
            error: true,
            message: err.message || "Connection error",
            source: "projectDashboard"
          }
        }));
        return [];
      }
    } else {
      console.warn("[ProjectDashboard] projectManager not available for loading projects.");
      return [];
    }
  }

  registerEventListeners() {
    // Listen for authentication events
    document.addEventListener("authStateChanged", this._handleAuthStateChange.bind(this));
    document.addEventListener("authStateConfirmed", this._handleAuthStateChange.bind(this));

    // Listen for project-related events from projectManager
    document.addEventListener("projectsLoaded", this.handleProjectsLoaded.bind(this));
    document.addEventListener("projectLoaded", this.handleProjectLoaded.bind(this));
    document.addEventListener("projectStatsLoaded", this.handleProjectStatsLoaded.bind(this));
    document.addEventListener("projectFilesLoaded", this.handleFilesLoaded.bind(this));
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    document.addEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this));
    document.addEventListener("projectNotFound", this.handleProjectNotFound.bind(this));

    // Handle connection changes
    window.addEventListener('online', () => {
      console.log('[ProjectDashboard] Connection restored');
      this.showNotification('Connection restored', 'success');
      // Refresh data if we have a project loaded
      if (this.state.currentProject?.id) {
        this.refreshProjectData(this.state.currentProject.id);
      } else {
        this.loadProjects();
      }
    });

    window.addEventListener('offline', () => {
      console.log('[ProjectDashboard] Connection lost');
      this.showNotification('Connection lost. Some features may be unavailable.', 'warning');
    });

    // Browser back/forward nav
    window.addEventListener("popstate", (event) => {
      // Add state check to prevent loops if pushState was used without actual nav
      if (event.state !== null) {
        this.processUrlParams(); // Re-process URL on popstate
      }
    });
  }

  // NEW: Handle auth state changes (modified)
  _handleAuthStateChange(event) {
    const isAuthenticated = event.detail?.authenticated || false;
    const stateChanged = isAuthenticated !== (this.state.lastAuthState ?? !isAuthenticated); // Compare with previous state

    // Prevent duplicate handling if already processing
    if (this._handlingAuthChange) {
      console.log("[ProjectDashboard] Auth change handling already in progress, skipping.");
      return;
    }
    this._handlingAuthChange = true;
    this.state.lastAuthState = isAuthenticated; // Store current state

    console.log(`[ProjectDashboard] Auth state changed. Authenticated: ${isAuthenticated}, State Changed: ${stateChanged}`);

    // Update UI visibility based on auth state
    const loginRequiredMsg = document.getElementById("loginRequiredMessage");
    const projectPanel = document.getElementById("projectManagerPanel"); // Assuming this is the main container for projects
    if (loginRequiredMsg) loginRequiredMsg.classList.toggle('hidden', isAuthenticated);
    if (projectPanel) projectPanel.classList.toggle('hidden', !isAuthenticated);

    // Make sure project list is visible after login
    const projectListView = document.getElementById('projectListView');
    if (projectListView && isAuthenticated) {
      projectListView.classList.remove('hidden');
      console.log("[ProjectDashboard] Ensured projectListView is visible after authentication");
    }

    if (isAuthenticated) {
      // If the state actually changed to authenticated, refresh necessary data
      if (stateChanged) {
        console.log("[ProjectDashboard] Auth state changed to authenticated. Refreshing project list.");
        // Use promise chain instead of setTimeout
        this._ensureProjectManager()
          .then(() => window.projectManager.loadProjects('all'))
          .then(projects => {
            console.log(`[ProjectDashboard] Successfully loaded ${projects?.length || 0} projects`);
            // Force render the projects after loading
            if (this.components.projectList && typeof this.components.projectList.renderProjects === 'function') {
              console.log("[ProjectDashboard] Explicitly rendering projects after successful load");
              this.components.projectList.renderProjects(projects);
            }
          })
          .catch(err => {
            console.error("[ProjectDashboard] Failed to load projects after auth change:", err);
          })
          .finally(() => {
            this._handlingAuthChange = false;
            // Process URL params again after auth and project load attempt
            this.processUrlParams();
          });
      } else {
        console.log("[ProjectDashboard] Auth state confirmed as authenticated. Ensuring view is correct.");
        // Ensure the correct view is displayed even if auth state didn't strictly change
        this.processUrlParams();
        this._handlingAuthChange = false;
      }
    } else {
      // User is not authenticated, ensure project list/details are hidden and login prompt is shown
      console.log("[ProjectDashboard] Auth state changed to not authenticated. Showing project list view (which handles login prompt).");
      this.showProjectList(); // This should handle showing the login message via _ensureContainersExist
      this._handlingAuthChange = false;
    }
  }

  // Helper to ensure projectManager is available (simple check)
  async _ensureProjectManager() {
    if (window.projectManager) {
      return Promise.resolve();
    } else {
      // Wait a short period for projectManager to potentially become available
      return new Promise((resolve, reject) => {
        let checks = 0;
        const interval = setInterval(() => {
          if (window.projectManager) {
            clearInterval(interval);
            resolve();
          } else if (++checks > 20) { // Wait up to 2 seconds
            clearInterval(interval);
            reject(new Error("projectManager not available after wait"));
          }
        }, 100);
      });
    }
  }

  /**
   * Refresh all data for the currently loaded project
   * @param {string} projectId - The project ID to refresh
   */
  async refreshProjectData(projectId) {
    if (!projectId || !this.projectManager) return;

    try {
      await Promise.allSettled([
        this.projectManager.loadProjectDetails(projectId),
        this.projectManager.loadProjectStats(projectId),
        this.projectManager.loadProjectFiles(projectId),
        this.projectManager.loadProjectConversations(projectId)
      ]);
    } catch (err) {
      console.error('[ProjectDashboard] Error refreshing project data:', err);
    }
  }
}

// Define initialize function
function initProjectDashboard() {
  console.log('[ProjectManager] initProjectDashboard called');
  if (!window.projectDashboard) {
    console.log('[ProjectManager] Creating new ProjectDashboard instance');
    try {
      window.projectDashboard = new ProjectDashboard();
      return window.projectDashboard.init();
    } catch (err) {
      console.error('[ProjectManager] Error creating ProjectDashboard instance:', err);
      return Promise.reject(err);
    }
  } else {
    console.log('[ProjectManager] Using existing ProjectDashboard instance');
    return Promise.resolve(window.projectDashboard);
  }
}

// ES Module Export - Export to global scope
// This is the KEY PART that was missing in the original code
window.ProjectDashboard = ProjectDashboard;
window.initProjectDashboard = initProjectDashboard;

// We also need to ensure the component classes are exported
// Since this file is loaded as a module, we can't see other modules directly

// Explicitly check what's available in other modules
// The new _ensureComponentsExported method will look for these components

// In a module, export means we're exposing it to be imported by other modules,
// but the window.XXX assignment makes it available globally

// Module exports for potential future proper module usage
export { ProjectDashboard, initProjectDashboard };
