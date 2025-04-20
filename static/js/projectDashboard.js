/*
// @ts-nocheck
*/

/**
 * projectDashboard.js
 * --------------------
 * Main controller class for the Project Dashboard UI.
 * Manages the overall UI flow, initialization, and interactions
 * between components and projectManager.js.
 *
 * NOTE: This file is loaded as an ES module, so we explicitly export classes to global scope.
 * This version has been updated to rely on the main app and auth modules for authentication
 * checks, thus removing its own direct re-verification logic.
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
      currentProject: null,
      lastAuthState: false
    };

    /**
     * A built-in notification function (console or external)
     */
    this.showNotification = (message, type = "info") => {
      if (window.showNotification) {
        window.showNotification(message, type);
      } else if (window.UIUtils?.showNotification) {
        window.UIUtils.showNotification(message, type);
      } else if (window.Notifications) {
        if (type === "error") {
          window.Notifications.apiError(message);
        } else if (type === "success") {
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

    /**
     * A reference to a modal manager if available
     */
    this.modalManager =
      window.modalManager ||
      (window.ModalManager?.isAvailable?.() ? window.ModalManager : null);

    /**
     * Prevents duplicate handling of some auth events
     * @private
     */
    this._handlingAuthChange = false;
    this._wasAuthenticated = false;

    // Listen for global auth events (if desired)
    if (window.auth?.AuthBus) {
      window.auth.AuthBus.addEventListener("authStateChanged", (e) => {
        const { authenticated } = e.detail || {};
        if (authenticated && !this._wasAuthenticated) {
          this._wasAuthenticated = true;
          // Potentially re-init or reload data if needed
        } else if (!authenticated) {
          this._wasAuthenticated = false;
        }
      });
    }
  }

  /**
   * Main initialization method.
   * Waits for the global auth system to complete initialization,
   * then proceeds if the user is authenticated.
   *
   * @returns {Promise<boolean>} True if success, false if not authenticated or error
   */
  async init() {
    const initId = `init-dashboard-${Date.now().toString(36)}`;
    console.log(`[ProjectDashboard][${initId}] Initializing...`);

    // Indicate we are starting
    this.showInitializationProgress("Waiting for authentication module...");

    // Wait for global auth to finish
    const isAuthenticated = await window.auth.waitForInit();
    console.log(
      `[ProjectDashboard][${initId}] Auth module isReady. Authenticated=${isAuthenticated}`
    );

    // If user isn't authenticated, display login-required messaging
    if (!isAuthenticated) {
      console.warn(
        "[ProjectDashboard] Initialization aborted: User is not authenticated."
      );
      this.showInitializationProgress("Please log in to view your projects.");
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) {
        loginMsg.classList.remove("hidden");
      }
      const projectPanel = document.getElementById("projectManagerPanel");
      if (projectPanel) {
        projectPanel.classList.add("hidden");
      }
      this.hideInitializationProgress();
      window.projectDashboardInitialized = true;
      document.dispatchEvent(
        new CustomEvent("projectDashboardInitialized", {
          detail: { success: false, reason: "Not authenticated" },
        })
      );
      return false;
    }

    try {
      // Now proceed with the rest of the initialization
      // e.g. checking network, ensuring DOM, loading partial HTML templates, etc.
      await this._waitForDashboardUtils();
      await this._ensureComponentsExported();
      await this._waitForProjectManager();
      await this._waitForDocument();

      // Finish up final steps
      await this._completeInitialization(); // Creates components, registers listeners, hides spinner
      console.log(`[ProjectDashboard][${initId}] Initialized successfully.`);

      // Mark everything as done
      window.projectDashboardInitialized = true;
      document.dispatchEvent(
        new CustomEvent("projectDashboardInitialized", { detail: { success: true } })
      );
      return true;
    } catch (err) {
      console.error(`[ProjectDashboard][${initId}] Init failed:`, err);
      this.hideInitializationProgress();
      this._handleCriticalError(err, initId);

      window.projectDashboardInitialized = true;
      document.dispatchEvent(
        new CustomEvent("projectDashboardInitialized", {
          detail: { success: false, reason: err?.message },
        })
      );
      return false;
    }
  }

  /**
   * Create fallback components if real ones not found
   */
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
              ${projects.length === 0
              ? "No projects available. Create a project to get started."
              : `Displaying ${projects.length} projects.`
            }
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
              <h2 class="text-xl font-bold">${project?.name || "Project Details"
            }</h2>
              <p class="text-gray-600">${project?.description || "No description available"
            }</p>
              <button class="btn btn-sm btn-ghost mt-4" id="fallbackBackBtn">Back to Projects</button>
            </div>
          `;
          document
            .getElementById("fallbackBackBtn")
            ?.addEventListener("click", this.onBack);
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
        renderKnowledgeBaseInfo(kbInfo, projectId) {
          console.log("[FallbackKB] Receiving KB for project:", projectId, kbInfo);
        }
      };
    }
  }

  /**
   * Final initialization steps once prerequisites (auth, DOM, manager) are loaded
   */
  async _completeInitialization() {
    this.showInitializationProgress("Loading components...");

    // Ensure containers exist
    await this.ensureContainersExist();

    // Ensure fallback components if the real ones aren't loaded
    this.ensureFallbackComponents();

    // Create real components (or fallback) with retries
    await this._createComponentsWithRetry();

    // Register event listeners for project events, auth changes, etc.
    this.registerEventListeners();

    // If there's a global or existing modal manager, set that up
    if (window.ModalManager && !window.modalManager) {
      window.modalManager = new window.ModalManager();
    }

    this.hideInitializationProgress();
    window.__appInitializing = false;
    console.log("[ProjectDashboard] _completeInitialization finished.");
  }

  /**
   * Creates components with retry if necessary
   */
  async _createComponentsWithRetry(attempts = 0) {
    const maxAttempts = 3;
    try {
      this.components.projectList = new window.ProjectListComponent({
        elementId: "projectList",
        onViewProject: this.handleViewProject.bind(this),
      });

      this.components.projectDetails = new window.ProjectDetailsComponent({
        onBack: this.handleBackToList.bind(this),
        utils: window.uiUtilsInstance || window.UIUtils,
        projectManager: window.projectManager,
        auth: window.auth,
        notification: this.showNotification,
      });

      // Optionally conditionally create KnowledgeBase if your app uses it
      const kbContainer = document.getElementById("knowledgeBaseContainer");
      if (kbContainer && kbContainer.dataset.requiresKb === "true") {
        if (typeof window.KnowledgeBaseComponent === "function") {
          this.components.knowledgeBase = new window.KnowledgeBaseComponent({});
        } else {
          console.warn(
            "[ProjectDashboard] KnowledgeBaseComponent not found; skipping KB initialization."
          );
        }
      }
    } catch (err) {
      console.error(
        `[ProjectDashboard] Component creation attempt ${attempts + 1} failed:`,
        err
      );
      if (attempts < maxAttempts) {
        const delay = 100 * Math.pow(2, attempts);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this._createComponentsWithRetry(attempts + 1);
      }

      console.warn("[ProjectDashboard] Using fallback components after repeated failures");
      this.ensureFallbackComponents();

      // Re-try fallback creation if needed
      if (!this.components.projectList) {
        this.components.projectList = new window.ProjectListComponent({
          elementId: "projectList",
          onViewProject: this.handleViewProject.bind(this),
        });
      }
      if (!this.components.projectDetails) {
        this.components.projectDetails = new window.ProjectDetailsComponent({
          onBack: this.handleBackToList.bind(this),
        });
      }
    }
  }

  /**
   * Wait for essential project manager if not already loaded
   */
  async _waitForProjectManager() {
    if (window.projectManager) {
      return;
    }
    this.showInitializationProgress("Waiting for ProjectManager...");

    return new Promise((resolve, reject) => {
      let checks = 0;
      const maxChecks = 40; // 4 seconds at 100ms intervals
      const interval = setInterval(() => {
        if (window.projectManager) {
          clearInterval(interval);
          resolve();
        } else if (++checks >= maxChecks) {
          clearInterval(interval);
          reject(
            new Error("Timeout waiting for ProjectManager (4s). Using fallback.")
          );
        }
      }, 100);
    })
      .catch((err) => {
        console.warn("[ProjectDashboard] Using fallback manager after wait:", err);
        window.projectManager = this._createFallbackProjectManager();
      })
      .finally(() => {
        this.hideInitializationProgress();
      });
  }

  /**
   * Creates a fallback project manager if none is available
   */
  _createFallbackProjectManager() {
    console.warn("[ProjectDashboard] Creating minimal fallback projectManager");
    return {
      loadProjects: () => Promise.resolve([]),
      loadProjectDetails: (id) =>
        Promise.resolve({
          id,
          name: "Fallback Project",
          description: "No real projectManager detected",
          files: [],
          conversations: [],
        }),
      loadProjectStats: () => Promise.resolve({}),
      loadProjectFiles: () => Promise.resolve([]),
      loadProjectConversations: () => Promise.resolve([]),
      loadProjectArtifacts: () => Promise.resolve([]),
      initialize: () => Promise.resolve(true),
    };
  }

  /**
   * Wait for the DOM to be fully ready
   */
  async _waitForDocument() {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      return;
    }
    this.showInitializationProgress("Waiting for DOM...");
    await new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", () => {
        resolve();
      });
    });
  }

  /**
   * Wait for "dashboardUtilsReady" event or equivalent
   */
  async _waitForDashboardUtils() {
    if (window.dashboardUtilsReady) {
      return;
    }
    this.showInitializationProgress("Waiting for dashboard utilities...");

    // 2-second wait or fallback
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn("[ProjectDashboard] Timeout waiting for dashboardUtilsReady. Continuing anyway.");
        resolve();
      }, 2000);

      document.addEventListener(
        "dashboardUtilsReady",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true }
      );
    });
  }

  /**
   * Ensure certain containers (projectListView, projectDetailsView, etc.) exist
   */
  async ensureContainersExist() {
    let projectManagerPanel = document.getElementById("projectManagerPanel");
    if (projectManagerPanel) {
      projectManagerPanel.classList.remove("hidden");
    }

    let projectListView = document.getElementById("projectListView");
    if (!projectListView) {
      console.log("[ProjectDashboard] Creating missing projectListView element");
      projectListView = document.createElement("main");
      projectListView.id = "projectListView";
      projectListView.className = "flex-1 overflow-y-auto p-4 lg:p-6";
      // Insert into a known container
      const container = projectManagerPanel || document.body;
      container.appendChild(projectListView);
    } else {
      projectListView.classList.remove("hidden");
      projectListView.style.display = "flex";
      projectListView.style.flexDirection = "column";
    }

    let projectListGrid = document.getElementById("projectList");
    if (!projectListGrid) {
      projectListGrid = document.createElement("div");
      projectListGrid.id = "projectList";
      projectListGrid.className = "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
      projectListView.appendChild(projectListGrid);
    }

    let noProjectsMessage = document.getElementById("noProjectsMessage");
    if (!noProjectsMessage) {
      noProjectsMessage = document.createElement("div");
      noProjectsMessage.id = "noProjectsMessage";
      noProjectsMessage.className = "text-center py-10 text-base-content/70 hidden";
      noProjectsMessage.textContent = "No projects found. Create one to begin.";
      projectListView.appendChild(noProjectsMessage);
    }

    let loginRequiredMessage = document.getElementById("loginRequiredMessage");
    if (!loginRequiredMessage) {
      loginRequiredMessage = document.createElement("div");
      loginRequiredMessage.id = "loginRequiredMessage";
      loginRequiredMessage.className = "text-center py-10 text-base-content/70 hidden";
      loginRequiredMessage.innerHTML = "Please log in to view your projects.";
      document.body.appendChild(loginRequiredMessage);
    }

    let projectDetailsView = document.getElementById("projectDetailsView");
    if (!projectDetailsView) {
      projectDetailsView = document.createElement("section");
      projectDetailsView.id = "projectDetailsView";
      projectDetailsView.className = "flex-1 flex flex-col overflow-hidden hidden";
      const container = projectManagerPanel || document.body;
      container.appendChild(projectDetailsView);
    }
  }

  /**
   * Wait for potential partial HTML templates (project_list.html, etc.) to be loaded
   * if you're using dynamic template loading. (Optional / if needed)
   */
  async _manualTemplateCheck() {
    // Implementation if you load partials from /static/html
    // You can adapt or skip this method if your HTML is all inline.
    return true;
  }

  /**
   * Validate that certain exported components exist
   */
  async _ensureComponentsExported() {
    const requiredClasses = [
      "ProjectListComponent",
      "ProjectDetailsComponent",
      "KnowledgeBaseComponent",
    ];
    const missing = requiredClasses.filter((c) => typeof window[c] !== "function");
    if (missing.length > 0) {
      console.warn(
        "[ProjectDashboard] Some required components missing:",
        missing,
        ". Attempting to proceed or fallback."
      );
      // Wait a bit if they might be loaded asynchronously
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /**
   * Register event listeners for project events, such as "projectsLoaded", "projectLoaded", etc.
   */
  registerEventListeners() {
    document.addEventListener("projectsLoaded", this.handleProjectsLoaded.bind(this));
    document.addEventListener("projectLoaded", this.handleProjectLoaded.bind(this));
    document.addEventListener("projectStatsLoaded", this.handleProjectStatsLoaded.bind(this));
    document.addEventListener("projectFilesLoaded", this.handleFilesLoaded.bind(this));
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    document.addEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this));
    document.addEventListener("projectNotFound", this.handleProjectNotFound.bind(this));

    window.addEventListener("online", () => {
      this.showNotification("Connection restored", "success");
      if (this.state.currentProject?.id) {
        this.refreshProjectData(this.state.currentProject.id);
      } else {
        window.projectManager?.loadProjects?.("all");
      }
    });

    window.addEventListener("offline", () => {
      this.showNotification("Connection lost", "warning");
    });

    window.addEventListener("popstate", () => {
      // Re-process URL if needed
      this.processUrlParams();
    });
  }

  processUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      if (typeof window.showProjectsView === "function") {
        window.showProjectsView();
      } else {
        this.showProjectList();
      }
    }
  }

  showProjectDetails(projectId) {
    this.state.currentView = "details";
    this.components.projectList?.hide();
    this.components.projectDetails?.show();
    window.history.pushState({}, "", `?project=${projectId}`);

    if (window.projectManager?.loadProjectDetails) {
      window.projectManager
        .loadProjectDetails(projectId)
        .catch((err) => {
          console.error("[ProjectDashboard] Failed to load project details:", err);
          this.showNotification("Failed to load project details", "error");
          this.components.projectDetails?.hide();
          this.showProjectList();
        });
    }
  }

  showProjectList() {
    this.state.currentView = "list";
    this.components.projectDetails?.hide();
    this.components.projectList?.show();
    window.history.pushState({}, "", window.location.pathname);

    if (window.projectManager?.loadProjects) {
      window.projectManager.loadProjects("all").catch((err) => {
        console.error("[ProjectDashboard] loadProjects error:", err);
        this.showNotification("Failed to load projects", "error");
      });
    }
  }

  handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }

  handleBackToList() {
    this.showProjectList();
  }

  async handleProjectsLoaded(event) {
    const { projects = [], count = 0, filter = "all", error = false, message = "" } =
      event.detail || {};
    if (this.components.projectList?.renderProjects) {
      this.components.projectList.renderProjects(projects);
    }

    const noProjectsMsg = document.getElementById("noProjectsMessage");
    if (!noProjectsMsg) return;

    if (error) {
      noProjectsMsg.textContent = `Error loading projects: ${message || "Unknown error"}`;
      noProjectsMsg.classList.add("text-error");
      noProjectsMsg.classList.remove("hidden");
      return;
    }

    // Show/hide noProjectsMessage
    if (projects.length === 0) {
      noProjectsMsg.textContent = `No projects found for filter: '${filter}'.`;
      noProjectsMsg.classList.remove("text-error");
      noProjectsMsg.classList.remove("hidden");
    } else {
      noProjectsMsg.classList.add("hidden");
    }
  }

  handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project;
    if (this.components.projectDetails?.renderProject) {
      this.components.projectDetails.renderProject(project);
    }
  }

  handleProjectStatsLoaded(event) {
    if (this.components.projectDetails?.renderStats) {
      this.components.projectDetails.renderStats(event.detail);
    }
  }

  handleFilesLoaded(event) {
    if (this.components.projectDetails?.renderFiles) {
      this.components.projectDetails.renderFiles(event.detail.files);
    }
  }

  handleConversationsLoaded(event) {
    if (!this.components.projectDetails?.renderConversations) return;
    let conversations = [];
    if (Array.isArray(event.detail)) {
      conversations = event.detail;
    } else if (event.detail?.conversations) {
      conversations = event.detail.conversations;
    }
    this.components.projectDetails.renderConversations(conversations);
  }

  handleArtifactsLoaded(event) {
    if (this.components.projectDetails?.renderArtifacts) {
      this.components.projectDetails.renderArtifacts(event.detail.artifacts);
    }
  }

  handleProjectNotFound(event) {
    const { projectId } = event.detail;
    console.warn(`[ProjectDashboard] Project not found: ${projectId}`);
    this.state.currentProject = null;
    this.showNotification("The requested project was not found", "error");
    this.showProjectList();
  }

  async refreshProjectData(projectId) {
    if (!window.projectManager || !projectId) return;
    try {
      await Promise.allSettled([
        window.projectManager.loadProjectDetails(projectId),
        window.projectManager.loadProjectStats(projectId),
        window.projectManager.loadProjectFiles(projectId),
        window.projectManager.loadProjectConversations(projectId),
      ]);
    } catch (err) {
      console.error("[ProjectDashboard] Error refreshing project data:", err);
    }
  }

  showInitializationProgress(message) {
    let el = document.getElementById("dashboardInitProgress");
    if (!el) {
      el = document.createElement("div");
      el.id = "dashboardInitProgress";
      el.className =
        "alert alert-info shadow-md fixed top-4 right-4 z-[100] w-auto max-w-xs";
      document.body.appendChild(el);
    }
    const currentMessage = el.querySelector("span")?.textContent;
    if (currentMessage !== message) {
      el.innerHTML = `
        <span class="loading loading-spinner loading-sm"></span>
        <span>${message || "Initializing dashboard..."}</span>
      `;
    }
    el.style.display = "flex";
  }

  hideInitializationProgress() {
    const el = document.getElementById("dashboardInitProgress");
    if (el) {
      el.remove();
    }
  }

  _handleCriticalError(error, initId = "") {
    console.error(`[ProjectDashboard][${initId}] Critical error:`, error);
    const containerEl =
      document.querySelector("#projectListView") || document.body;
    const errorElId = "dashboardCriticalError";
    let errorEl = document.getElementById(errorElId);

    if (!errorEl) {
      errorEl = document.createElement("div");
      errorEl.id = errorElId;
      errorEl.className = "alert alert-error shadow-lg m-4";
      containerEl.prepend(errorEl);
    }

    errorEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2
             a9 9 0 11-18 0 9 9 0 0118 0z"/>
      </svg>
      <div>
        <h3 class="font-bold">Dashboard Initialization Failed!</h3>
        <div class="text-xs">
          ${error?.message || "Unknown error"}. Try refreshing the page.
        </div>
      </div>
      <button class="btn btn-sm btn-ghost" onclick="window.location.reload()">Refresh</button>
      <button class="btn btn-sm btn-ghost" onclick="window.initProjectDashboard()">Retry</button>
    `;

    if (containerEl && containerEl.id === "projectListView") {
      containerEl.classList.remove("hidden");
    }
  }
}

/**
 * Initializes the ProjectDashboard instance
 */
function initProjectDashboard() {
  console.log("[projectDashboard.js] initProjectDashboard called");
  if (!window.projectDashboard) {
    console.log("[projectDashboard.js] Creating new ProjectDashboard instance");
    window.projectDashboard = new ProjectDashboard();
  } else {
    console.log("[projectDashboard.js] Using existing ProjectDashboard instance");
  }
  return window.projectDashboard.init();
}

// Expose globally and as module exports
window.ProjectDashboard = ProjectDashboard;
window.initProjectDashboard = initProjectDashboard;

export { ProjectDashboard, initProjectDashboard };
