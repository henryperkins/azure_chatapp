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

    // Modal manager check
    this.modalManager = typeof window.ModalManager === "function"
      ? new window.ModalManager()
      : window.modalManager;
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

      // Wait for dashboard utilities
      await this._waitForDashboardUtils();

      // Wait for projectManager
      await this._waitForProjectManager();

      // Ensure document is ready
      await this._waitForDocument();

      // Complete initialization steps
      await this._completeInitialization();

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
  showProjectList() {
    this.state.currentView = "list";
    this.components.projectList?.show();
    this.components.projectDetails?.hide();
    window.history.pushState({}, "", window.location.pathname);
    this.loadProjects().catch(err => {
      console.error("[ProjectDashboard] showProjectList load error:", err);
    });
  }

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
      this.showProjectList();
    }
  }

  processUrlParams() {
    if (!window.location.pathname.includes("/projects")) {
      return;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");

    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  }

  async loadProjects(filter = "all") {
    try {
      if (!window.projectManager) {
        throw new Error("projectManager not initialized");
      }
      const response = await window.projectManager.loadProjects(filter);
      return response;
    } catch (error) {
      console.error("[ProjectDashboard] loadProjects failed:", error);
      document.dispatchEvent(
        new CustomEvent("projectsLoaded", {
          detail: { error: true, message: error.message }
        })
      );
      throw error;
    }
  }

  /* ===========================
     EVENT HANDLERS
     =========================== */

  handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }

  handleBackToList() {
    this.showProjectList();
  }

  async handleProjectFormSubmit(e) {
    e.preventDefault();
    const form = e.target;

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

    try {
      await window.projectManager.createOrUpdateProject(projectId, formData);
      this.showNotification(isEditing ? "Project updated" : "Project created", "success");
      this.modalManager?.hide("project");
      this.loadProjects();
    } catch (err) {
      console.error("[ProjectDashboard] Error saving project:", err);
      this.showNotification("Failed to save project", "error");
    }
  }

  handleProjectsLoaded(event) {
    const { data } = event.detail;
    let projects = [];
    let hasError = false;
    let originalCount = 0;
    let filter = "all";

    if (data?.projects) {
      projects = data.projects;
      originalCount = data.count || projects.length;
      filter = data.filter?.type || "all";
    } else if (Array.isArray(event.detail)) {
      // Fallback if detail itself is an array
      projects = event.detail;
      originalCount = projects.length;
    }

    hasError = data?.error || false;
    this.components.projectList?.renderProjects(projects);

    // Show/hide "no projects" message
    const noProjectsMsg = document.getElementById("noProjectsMessage");
    if (noProjectsMsg) {
      noProjectsMsg.classList.toggle("hidden", projects.length > 0 || hasError);

      if (hasError) {
        noProjectsMsg.textContent = "Error loading projects";
        noProjectsMsg.classList.add("text-red-600");
      } else if (projects.length === 0 && originalCount > 0) {
        noProjectsMsg.textContent = `No ${filter} projects found`;
        noProjectsMsg.classList.remove("text-red-600");
      } else if (projects.length === 0) {
        noProjectsMsg.textContent = `No ${filter} projects found`;
        noProjectsMsg.classList.remove("text-red-600");
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
        this.components.knowledgeBase.renderKnowledgeBaseInfo(project.knowledge_base);
      } else if (window.projectManager?.loadKnowledgeBaseDetails) {
        window.projectManager.loadKnowledgeBaseDetails(project.knowledge_base_id)
          .catch(err => {
            console.error("[ProjectDashboard] Failed to load KB details:", err);
          });
      }
    } else if (this.components.knowledgeBase) {
      // Indicate no KB
      this.components.knowledgeBase.renderKnowledgeBaseInfo(null);
    }
  }

  handleProjectStatsLoaded(event) {
    const stats = event.detail;
    this.components.projectDetails?.renderStats(stats);

    // If stats has knowledge_base info, pass it along
    if (stats && stats.knowledge_base && this.components.knowledgeBase) {
      this.components.knowledgeBase.renderKnowledgeBaseInfo(stats.knowledge_base);
    }
  }

  handleFilesLoaded(event) {
    this.components.projectDetails?.renderFiles(event.detail.files);
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
      el.className =
        "fixed top-4 right-4 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-2 rounded shadow-md z-50 flex items-center";
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg"
        fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10"
          stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2
            5.291A7.962 7.962 0 014 12H0c0 3.042
            1.135 5.824 3 7.938l3-2.647z">
        </path>
      </svg>
      <span>${message || "Initializing dashboard..."}</span>
    `;
  }

  hideInitializationProgress() {
    const el = document.getElementById("dashboardInitProgress");
    if (el) {
      el.remove();
    }
  }

  _handleCriticalError(error) {
    console.error("[ProjectDashboard] Critical error:", error);
    this.showNotification("Application failed to initialize", "error");
    const containerEl = document.querySelector("#projectListView");
    if (containerEl) {
      containerEl.innerHTML = `
        <div class="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <svg class="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24"
                stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938
                  4h13.856c1.54 0 2.502-1.667 1.732-3L13.732
                  4c-.77-1.333-2.694-1.333-3.464 0L3.34
                  16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div class="ml-3">
              <h3 class="text-sm leading-5 font-medium text-red-800">
                Dashboard initialization failed
              </h3>
              <div class="mt-1 text-sm leading-5 text-red-700">
                ${error.message || "Unknown error occurred"}. Try refreshing the page.
              </div>
              <div class="mt-4">
                <button type="button" onclick="window.location.reload()"
                  class="inline-flex items-center px-3 py-2 border
                  border-transparent text-sm leading-4 font-medium
                  rounded-md text-red-700 bg-red-100 hover:bg-red-200
                  focus:outline-none focus:border-red-300
                  focus:shadow-outline-red active:bg-red-200
                  transition ease-in-out duration-150">
                  Refresh Page
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
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
            document.querySelector("#projectListView")?.appendChild(this.element);
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

    // Only run project UI if we're on the /projects page
    if (!window.location.pathname.includes("/projects")) {
      return;
    }

    // Create fallback DOM elements if needed
    const projectListEl = document.getElementById("projectList");
    if (!projectListEl) {
      const container = document.createElement("div");
      container.id = "projectList";
      document.querySelector("#projectListView")?.appendChild(container);
    }

    this.showInitializationProgress("Loading components...");

    // Ensure fallback components if the real ones aren't there
    this.ensureFallbackComponents();

    // Create component instances
    this.components.projectList = new window.ProjectListComponent({
      elementId: "projectList",
      onViewProject: this.handleViewProject.bind(this)
    });
    this.components.projectDetails = new window.ProjectDetailsComponent({
      onBack: this.handleBackToList.bind(this)
    });
    if (typeof window.KnowledgeBaseComponent === "function") {
      this.components.knowledgeBase = new window.KnowledgeBaseComponent();
    }

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

    // Process URL
    this.processUrlParams();

    // Check localStorage for stored project
    const storedProjectId = localStorage.getItem("selectedProjectId");
    if (storedProjectId) {
      document.dispatchEvent(new CustomEvent("projectSelected", {
        detail: { projectId: storedProjectId }
      }));
    }

    // Initial project load
    setTimeout(() => {
      this.loadProjects().catch(err => {
        console.error("[ProjectDashboard] Initial project load failed:", err);
      });
    }, 100);
  }

  registerEventListeners() {
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

    // Handle project form
    document.getElementById("projectForm")?.addEventListener(
      "submit",
      this.handleProjectFormSubmit.bind(this)
    );

    // File upload button logic
    let fileInputClicked = false;
    document.getElementById("uploadFileBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (fileInputClicked) return;
      fileInputClicked = true;
      setTimeout(() => {
        fileInputClicked = false;
      }, 500);

      document.getElementById("fileInput")?.click();
    });

    // File input change
    document.getElementById("fileInput")?.addEventListener("change", async (e) => {
      if (!e.target.files?.length) return;
      const projectId = this.state.currentProject?.id;
      if (projectId) {
        try {
          await this.components.projectDetails.uploadFiles(projectId, e.target.files);
          window.projectManager.loadProjectStats(projectId);
        } catch (error) {
          if (error === "Knowledge base not configured") {
            this.showNotification(
              "Set up a knowledge base before uploading files. Click 'Setup KB' in project details.",
              "warning"
            );
          } else {
            console.error("[ProjectDashboard] File upload failed:", error);
            this.showNotification(`File upload failed: ${error}`, "error");
          }
        }
      }
    });

    // Browser back/forward nav
    window.addEventListener("popstate", () => {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get("project");
      if (projectId && this.state.currentView !== "details") {
        this.showProjectDetails(projectId);
      } else if (!projectId && this.state.currentView !== "list") {
        this.showProjectList();
      }
    });
  }

  async _waitForDashboardUtils() {
    if (window.dashboardUtilsReady) return;
    this.showInitializationProgress("Waiting for dashboard utilities...");
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timeout waiting for dashboardUtilsReady")),
        2000
      );
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

/**
 * Initialize the project dashboard with automatic retry if desired.
 * @returns {Promise<ProjectDashboard>}
 */
async function initProjectDashboard() {
  const dashboard = new ProjectDashboard();
  const success = await dashboard.init();
  if (success) {
    window.projectDashboard = dashboard;
    return dashboard;
  }
  throw new Error("ProjectDashboard failed to initialize");
}

// Optional: auto-init on DOM load
if (typeof window !== "undefined") {
  let autoInitAttempts = 0;
  const maxAutoInitAttempts = 3;

  const startInitialization = async () => {
    if (autoInitAttempts >= maxAutoInitAttempts) {
      console.error("[ProjectDashboard] Auto-initialization reached max attempts.");
      return;
    }
    try {
      if (!document.body) {
        // Wait a bit if DOM not ready
        autoInitAttempts++;
        return setTimeout(startInitialization, 300);
      }
      await initProjectDashboard();
    } catch (error) {
      console.error("[ProjectDashboard] Auto-init failed:", error);
      autoInitAttempts++;
      setTimeout(startInitialization, 300);
    }
  };

  if (document.readyState === "complete" || document.readyState === "interactive") {
    startInitialization();
  } else {
    document.addEventListener("DOMContentLoaded", startInitialization);
  }
}
