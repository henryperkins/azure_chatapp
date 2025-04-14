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
      (window.ModalManager?.isAvailable() ? window.modalManager : null);
  }

  /**
   * Initialize the dashboard with retry logic
   * @returns {Promise<boolean>} True if success
   */
  async init() {
    console.log("[ProjectDashboard] Initializing...");
    this.showInitializationProgress("Starting initialization...");

    try {
      if (this.initAttempts >= this.MAX_INIT_RETRIES) {
        this.hideInitializationProgress();
        this._handleCriticalError(
          new Error(`Max init attempts (${this.MAX_INIT_RETRIES}) reached.`)
        );
        return false;
      }

      // Wait for authentication (new step)
      await this._waitForAuthentication();

      // Stagger initialization steps to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));

      // Wait for dashboard utilities
      await this._waitForDashboardUtils();

      // Wait for projectManager with timeout
      await Promise.race([
        this._waitForProjectManager(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('ProjectManager timeout')), 5000)
        )
      ]);

      // Ensure document is ready
      await this._waitForDocument();

      // Complete initialization steps in chunks
      await new Promise(resolve => requestAnimationFrame(async () => {
        await this._completeInitialization();
        resolve();
      }));

      console.log("[ProjectDashboard] Initialized successfully.");
      this.hideInitializationProgress();
      this.initAttempts = 0; // reset on success
      return true;
    } catch (err) {
      console.error(`[ProjectDashboard] init attempt failed:`, err);
      this.hideInitializationProgress();

      this.initAttempts++;
      if (this.initAttempts < this.MAX_INIT_RETRIES) {
        const delay = this.retryDelayBase * this.initAttempts; // simple backoff
        console.log(
          `[ProjectDashboard] Retrying in ${delay}ms (attempt ${this.initAttempts} of ${this.MAX_INIT_RETRIES}).`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.init();
      }

      this._handleCriticalError(err);
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

  async handleProjectFormSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const modalDialog = form.closest('dialog'); // Get the parent dialog

    const projectId = form.querySelector("#projectIdInput")?.value;
    const isEditing = !!projectId;

    const formData = {
      name: form.querySelector("#projectNameInput")?.value.trim(),
      description: form.querySelector("#projectDescInput")?.value.trim(),
      goals: form.querySelector("#projectGoalsInput")?.value.trim(),
      max_tokens: parseInt(
        form.querySelector("#projectMaxTokensInput")?.value,
        10
      )
    };

    if (!formData.name) {
      this.showNotification("Project name is required", "error");
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    const originalButtonText = submitButton?.textContent;

    if (submitButton) {
       submitButton.disabled = true;
       submitButton.innerHTML = `<span class="loading loading-spinner loading-xs"></span> Saving...`;
    }


    try {
      await window.projectManager.createOrUpdateProject(projectId, formData);
      this.showNotification(isEditing ? "Project updated" : "Project created", "success");

      // Close the DaisyUI dialog
      if (modalDialog && typeof modalDialog.close === 'function') {
         modalDialog.close();
      } else {
         // Fallback if modal manager was used differently
         this.modalManager?.hide("project");
      }

      window.projectManager.loadProjects('all'); // Refresh list
    } catch (err) {
      console.error("[ProjectDashboard] Error saving project:", err);
      this.showNotification(`Failed to save project: ${err.message || 'Unknown error'}`, "error");
      // Optionally display error within the modal
      const errorDiv = form.querySelector('.modal-error-display'); // Add an element for this
      if (errorDiv) {
         errorDiv.textContent = `Error: ${err.message || 'Unknown error'}`;
         errorDiv.classList.remove('hidden');
      }
    } finally {
       if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText; // Restore text
       }
    }
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

    // Mark dashboard as initialized
    window.projectDashboardInitialized = true;
    document.dispatchEvent(new CustomEvent("projectDashboardInitialized"));

    // Register event listeners
    this.registerEventListeners();

    // If there's a global or existing modal manager, set that up
    if (window.ModalManager && !window.modalManager) {
      window.modalManager = new window.ModalManager();
    }

    // Process URL with auth check
    await this._processUrlWithAuthCheck();
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

    try {
      // Create component instances
      this.components.projectList = new window.ProjectListComponent({
        elementId: "projectList",
        onViewProject: this.handleViewProject.bind(this)
      });

      // Check if ProjectDetailsComponent is available directly or as a module
      let DetailsComponent;
      if (window.ProjectDetailsComponent) {
        DetailsComponent = window.ProjectDetailsComponent;
      } else {
        try {
          DetailsComponent = (await import('./projectDetailsComponent.js')).ProjectDetailsComponent;
        } catch (err) {
          console.warn("[ProjectDashboard] Could not import ProjectDetailsComponent:", err);
          if (!window.ProjectDetailsComponent) {
            throw new Error("ProjectDetailsComponent not available");
          }
          DetailsComponent = window.ProjectDetailsComponent;
        }
      }

      this.components.projectDetails = new DetailsComponent({
        onBack: this.handleBackToList.bind(this),
        utils: window.uiUtilsInstance || window.UIUtils, // Try both variants
        projectManager: window.projectManager,
        auth: window.auth,
        notification: this.showNotification
      });

      if (typeof window.KnowledgeBaseComponent === "function") {
        this.components.knowledgeBase = new window.KnowledgeBaseComponent({
           // Pass options if needed
        });
      }
    } catch (err) {
      console.error(`[ProjectDashboard] Component creation attempt ${attempts+1} failed:`, err);

      if (attempts < maxAttempts) {
        // Wait with exponential backoff
        const delay = Math.pow(2, attempts) * 300;
        await new Promise(resolve => setTimeout(resolve, delay));
        return this._createComponentsWithRetry(attempts + 1);
      }

      // If we've tried enough, use fallbacks
      console.warn("[ProjectDashboard] Using fallback components after repeated failures");
      this.ensureFallbackComponents();

      // Create with fallbacks
      if (!this.components.projectList) {
        this.components.projectList = new window.ProjectListComponent({
          elementId: "projectList",
          onViewProject: this.handleViewProject.bind(this)
        });
      }

      if (!this.components.projectDetails) {
        this.components.projectDetails = new window.ProjectDetailsComponent({
          onBack: this.handleBackToList.bind(this),
        });
      }
    }
  }

  async _processUrlWithAuthCheck() {
    // Check authentication before handling URL
    let isAuthenticated = false;

    try {
      if (window.auth?.isAuthenticated) {
        isAuthenticated = await window.auth.isAuthenticated({forceVerify: false});
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

  registerEventListeners() {
    // NEW: Listen for authentication events
    document.addEventListener("authStateChanged", this._handleAuthStateChange.bind(this));
    document.addEventListener("authStateConfirmed", this._handleAuthStateChange.bind(this));

    // Listen for project-related events from projectManager
    document.addEventListener(
      "projectsLoaded",
      this.handleProjectsLoaded.bind(this)
    );
    document.addEventListener(
      "projectLoaded",
      this.handleProjectLoaded.bind(this)
    );
    document.addEventListener(
      "projectStatsLoaded",
      this.handleProjectStatsLoaded.bind(this)
    );
    document.addEventListener(
      "projectFilesLoaded",
      this.handleFilesLoaded.bind(this)
    );
    document.addEventListener(
      "projectConversationsLoaded",
      this.handleConversationsLoaded.bind(this)
    );
    document.addEventListener(
      "projectArtifactsLoaded",
      this.handleArtifactsLoaded.bind(this)
    );

    document.addEventListener(
      "projectNotFound",
      this.handleProjectNotFound.bind(this)
    );

    // Handle project form submission (using DaisyUI dialog)
    const projectForm = document.getElementById("projectForm");
    if (projectForm) {
       projectForm.addEventListener("submit", this.handleProjectFormSubmit.bind(this));
    } else {
       console.warn("Project form not found for event listener.");
    }

    // File upload button trigger (already handled in projectDetailsComponent)
    // const uploadBtnTrigger = document.getElementById("uploadFileBtnTrigger");
    // const fileInput = document.getElementById("fileInput");
    // if (uploadBtnTrigger && fileInput) {
    //    uploadBtnTrigger.addEventListener("click", () => fileInput.click());
    //    fileInput.addEventListener("change", async (e) => {
    //       // ... (file upload logic - now likely in projectDetailsComponent) ...
    //    });
    // }

    // Browser back/forward nav
    window.addEventListener("popstate", (event) => {
       // Add state check to prevent loops if pushState was used without actual nav
       if (event.state !== null) {
          this.processUrlParams(); // Re-process URL on popstate
       }
    });

    //Listenfor KB settings button click (handled in knowledgeBaseComponent)
    // document.getElementById('knowledgeBaseSettingsBtn')?.addEventListener('click', () => { ... });

    // Listen for Setup KB button click (handled in knowledgeBaseComponent)
    // document.getElementById('setupKnowledgeBaseBtn')?.addEventListener('click', () => { ... });
  }

  async _waitForDashboardUtils() {
    // First check if the flag is already set
    if (window.dashboardUtilsReady === true) return;

    this.showInitializationProgress("Waiting for dashboard utilities...");

    // If the flag isn't set, we can try two approaches:
    // 1. Check for the flag directly with polling
    // 2. Wait for the event with a timeout

    try {
      // Approach 1: Check the flag with polling (faster)
      for (let i = 0; i < 20; i++) { // try for about 1 second (20 * 50ms = 1000ms)
        if (window.dashboardUtilsReady === true) {
          console.log("[ProjectDashboard] Found dashboardUtilsReady flag");
          return; // Exit immediately if the flag is found
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Approach 2: If polling didn't work, wait for the event with a timeout
      await new Promise((resolve, reject) => {
        // Set a slightly longer timeout since we already waited 1 second
        const timeout = setTimeout(
          () => reject(new Error("Timeout waiting for dashboardUtilsReady")),
          3000
        );

        // Listen for the event
        const handleUtilsReady = () => {
          clearTimeout(timeout);
          resolve();
        };

        document.addEventListener("dashboardUtilsReady", handleUtilsReady, { once: true });

        // Also check the flag one more time
        if (window.dashboardUtilsReady === true) {
          clearTimeout(timeout);
          document.removeEventListener("dashboardUtilsReady", handleUtilsReady);
          resolve();
        }
      });
    } catch (err) {
      console.error("[ProjectDashboard] Error waiting for dashboard utils:", err);
      // If utils are loaded but the event wasn't fired, we can still proceed
      if (window.dashboardUtilsReady === true ||
          window.ProjectDashboard && window.ProjectDashboard._initialized) {
        console.warn("[ProjectDashboard] Proceeding despite event timeout - utils appear to be ready");
        return;
      }
      throw err;
    }
  }

  async _waitForProjectManager() {
    if (window.projectManager) return;
    this.showInitializationProgress("Waiting for ProjectManager...");
    await new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (window.projectManager) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("Timeout waiting for ProjectManager"));
      }, 2000);
    });
  }

  async _waitForAuthentication() {
    this.showInitializationProgress("Checking authentication state...");

    // First check if we already have auth info
    if (window.auth?.isAuthenticated) {
      try {
        const authenticated = await window.auth.isAuthenticated({forceVerify: false});
        if (authenticated) {
          console.log("[ProjectDashboard] User is authenticated, proceeding with initialization");
          return true;
        }
      } catch (err) {
        console.warn("[ProjectDashboard] Auth check error:", err);
      }
    }

    // If not authenticated, wait a bit for possible login
    return new Promise((resolve) => {
      const authListener = (event) => {
        if (event.detail?.authenticated) {
          document.removeEventListener("authStateChanged", authListener);
          console.log("[ProjectDashboard] Auth state changed to authenticated");
          resolve(true);
        }
      };

      document.addEventListener("authStateChanged", authListener);

      // Set a timeout to resolve anyway after 3 seconds
      setTimeout(() => {
        document.removeEventListener("authStateChanged", authListener);
        console.log("[ProjectDashboard] Proceeding without authentication");
        resolve(false);
      }, 3000);
    });
  }

  // NEW: Handle auth state changes
  _handleAuthStateChange(event) {
    const isAuthenticated = event.detail?.authenticated || false;

    if (isAuthenticated) {
      console.log("[ProjectDashboard] Auth state changed to authenticated");

      // If we were showing the project list, reload projects
      if (this.state.currentView === "list") {
        // Delay slightly to allow auth propagation
        setTimeout(() => {
          this.loadProjects().catch(err => {
            console.error("[ProjectDashboard] Failed to load projects after auth change:", err);
          });
        }, 300);
      }
      // If we were showing project details, reload the current project
      else if (this.state.currentView === "details" && this.state.currentProject?.id) {
        setTimeout(() => {
          this.showProjectDetails(this.state.currentProject.id);
        }, 300);
      }
    } else {
      // If logging out, always return to list view (which will show login required)
      this.showProjectList();
    }
  }

  async _waitForDocument() {
    if (this._isDocumentReady()) return;
    this.showInitializationProgress("Waiting for DOM...");
    await new Promise(resolve => {
      document.addEventListener("DOMContentLoaded", () => {
        resolve();
      });
    });
  }
}


// Add app initializer registration if needed
if (window.appInitializer && window.appInitializer.register) {
  window.appInitializer.register({
    init: () => initProjectDashboard()
  });
}
