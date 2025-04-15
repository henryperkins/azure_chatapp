/**
 * projectDashboard.js
 * --------------------
 * Main controller class for the Project Dashboard UI.
 * Manages the overall UI flow, initialization, and interactions
 * between components and projectManager.js.
 */
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
    // Use the unified modal manager (with a bit more explicit grouping to avoid confusion)
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
      console.log(`[ProjectDashboard][${initId}] Waiting for Authentication...`);
      const authReady = await this._waitForAuthentication();
      console.log(`[ProjectDashboard][${initId}] Authentication wait completed (Authenticated: ${authReady})`);

      // Stagger initialization steps to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay

      console.log(`[ProjectDashboard][${initId}] Waiting for Dashboard Utils...`);
      await this._waitForDashboardUtils();
      console.log(`[ProjectDashboard][${initId}] Dashboard Utils ready.`);

      console.log(`[ProjectDashboard][${initId}] Waiting for Project Manager...`);
      await Promise.race([
        this._waitForProjectManager(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ProjectManager timeout (5s)')), 5000) // Explicit timeout duration
        )
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

  /* ===========================
     VIEW MANAGEMENT
     =========================== */
  // Project list view is now handled by showProjectsView() in projectDashboardUtils.js

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
      window.showProjectsView();
    }
  }

  // Projects loading is now handled directly by projectManager.loadProjects()

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
    const { data, error, message } = event.detail || {}; // Destructure detail
    let projects = data?.projects || (Array.isArray(event.detail) ? event.detail : []); // Handle different event structures
    let hasError = !!error;
    let originalCount = data?.count || projects.length;
    let filter = data?.filter?.type || "all";

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
      window.projectManager.loadProjectStats(this.state.currentProject.id);
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
    `;
    // Ensure the container holding the error is visible
    if (containerEl && containerEl.id === 'projectListView') {
      containerEl.classList.remove('hidden');
    }
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
              Fallback: Projects will appear here.
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
        }
        show() {
          this.element?.classList.remove("hidden");
        }
        hide() {
          this.element?.classList.add("hidden");
        }
        renderProject() { }
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
      throw new Error("projectManager is required but not available");
    }

    // Ensure essential containers exist with improved visibility handling
    this._ensureContainersExist();

    this.showInitializationProgress("Loading components...");

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

  _ensureContainersExist() {
    // Check authentication state first
    const isAuthenticated = window.auth?.isAuthenticated ? true : false;

    let projectListView = document.getElementById("projectListView");
    if (!projectListView) {
      projectListView = document.createElement('main');
      projectListView.id = "projectListView";
      projectListView.className = "flex-1 overflow-y-auto p-4 lg:p-6";
      document.querySelector('.drawer-content')?.appendChild(projectListView);
    }

    // Set visibility based on auth state
    projectListView.classList.toggle('hidden', !isAuthenticated);

    let projectListGrid = document.getElementById("projectList");
    if (!projectListGrid) {
      projectListGrid = document.createElement('div');
      projectListGrid.id = "projectList";
      projectListGrid.className = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
      projectListView.appendChild(projectListGrid);
    }

    let noProjectsMessage = document.getElementById("noProjectsMessage");
    if (!noProjectsMessage) {
      noProjectsMessage = document.createElement('div');
      noProjectsMessage.id = "noProjectsMessage";
      noProjectsMessage.className = "text-center py-10 text-base-content/70 hidden";
      projectListView.appendChild(noProjectsMessage);
    }

    // Add login message if not authenticated
    let loginRequiredMessage = document.getElementById("loginRequiredMessage");
    if (!loginRequiredMessage) {
      loginRequiredMessage = document.createElement('div');
      loginRequiredMessage.id = "loginRequiredMessage";
      loginRequiredMessage.className = "text-center py-10 text-base-content/70";
      loginRequiredMessage.innerHTML = "Please log in to view your projects";
      projectListView.appendChild(loginRequiredMessage);
    }
    loginRequiredMessage.classList.toggle('hidden', isAuthenticated);

    // Ensure project details view is hidden by default
    const projectDetailsView = document.getElementById("projectDetailsView");
    if (projectDetailsView) {
      projectDetailsView.classList.add("hidden");
    } else {
      // Create details view if missing (basic structure)
      const detailsContainer = document.createElement('section');
      detailsContainer.id = "projectDetailsView";
      detailsContainer.className = "flex-1 flex flex-col overflow-hidden hidden";
      document.querySelector('.drawer-content')?.appendChild(detailsContainer);
    }
  }

  async _createComponentsWithRetry(attempts = 0) {
    const maxAttempts = 3;
    const waitTimeout = 5000; // 5 seconds timeout for waiting for components

    try {
      // Helper function to wait for a component constructor
      const waitForComponent = async (componentName) => {
        if (typeof window[componentName] === "function") return; // Already available

        console.log(`[ProjectDashboard] Waiting for ${componentName} to be defined...`);
        await new Promise((resolve, reject) => {
          let checks = 0;
          const interval = setInterval(() => {
            if (typeof window[componentName] === "function") {
              clearInterval(interval);
              resolve();
            } else if (++checks * 100 >= waitTimeout) {
              clearInterval(interval);
              reject(new Error(`${componentName} not available after ${waitTimeout / 1000}s`));
            }
          }, 100);
        }).catch(err => {
          console.warn(`${componentName} wait failed:`, err);
          throw err; // Re-throw to be caught by the outer try-catch
        });
      };

      // Wait for essential components
      await Promise.all([
        waitForComponent('ProjectListComponent'),
        waitForComponent('ProjectDetailsComponent')
        // KnowledgeBaseComponent is optional, no need to wait strictly
      ]);

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

  async _processUrlWithAuthCheck() {
    // Check authentication before handling URL
    let isAuthenticated = false;

    try {
      if (window.auth?.isAuthenticated) {
        isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
      }
    } catch (err) {
      console.warn("[ProjectDashboard] Auth check failed:", err);
    }

    if (isAuthenticated) {
      this.processUrlParams();

      // Initial project load with delay to avoid race conditions
      setTimeout(() => {
        this.loadProjects().catch(err => {
          console.error("[ProjectDashboard] Initial project load failed:", err);
        });
      }, 100);
    } else {
      // Show login required state instead of processing URL
      this.showProjectList(); // This will show login required if auth check fails
    }
  }

  async loadProjects() {
    if (window.projectManager) {
      await window.projectManager.loadProjects('all');
    } else {
      console.warn("[ProjectDashboard] projectManager not available for loading projects.");
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

    // Browser back/forward nav
    window.addEventListener("popstate", (event) => {
      // Add state check to prevent loops if pushState was used without actual nav
      if (event.state !== null) {
        this.processUrlParams(); // Re-process URL on popstate
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
      throw err; // Re-throw if utils are definitely not ready
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


    if (isAuthenticated) {
      // If the state actually changed to authenticated, refresh necessary data
      if (stateChanged) {
        console.log("[ProjectDashboard] Auth state changed to authenticated. Refreshing project list.");
        // Use promise chain instead of setTimeout
        this._ensureProjectManager()
          .then(() => window.projectManager.loadProjects('all'))
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
}

// Add app initializer registration if needed
if (window.appInitializer && window.appInitializer.register) {
  window.appInitializer.register({
    init: () => initProjectDashboard()
  });
}
