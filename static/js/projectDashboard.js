import { ProjectListComponent, ProjectDetailsComponent, KnowledgeBaseComponent } from './projectDashboardComponents.js';
import { UIUtils } from './projectDashboardUtils.js';

/**
 * Project Dashboard - Main controller class
 */
class ProjectDashboard {
  constructor() {
    this.components = {};
    this.state = {
      currentView: null, // 'list' or 'details'
      currentProject: null
    };
  }

  /**
   * Initialize the dashboard with error handling and retry logic
   */
  async init(maxRetries = 3, retryDelay = 300) {
    console.log('Initializing Project Dashboard...');
    
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        if (this._isDocumentReady()) {
          await this._completeInitialization();
          console.log('Project Dashboard initialized successfully');
          return;
        }
      } catch (error) {
        console.error(`Initialization attempt ${attempt + 1} failed:`, error);
        if (attempt === maxRetries - 1) throw error;
      }
      
      attempt++;
      await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
    }
  }

  _isDocumentReady() {
    return document.readyState === 'complete' || 
           document.readyState === 'interactive';
  }

  async _completeInitialization() {
    // Verify required dependencies
    if (!window.projectManager) {
      throw new Error('ProjectManager not available - required dependency');
    }

    // Ensure DOM elements exist or create fallbacks
    const projectListEl = document.getElementById("projectList");
    if (!projectListEl) {
      console.warn("Project list element not found - creating fallback");
      const container = document.createElement("div");
      container.id = "projectList";
      document.querySelector("#projectListView")?.appendChild(container);
    }

    // Initialize components with error handling
    this.components = {
      projectList: new ProjectListComponent({
        elementId: "projectList",
        onViewProject: this.handleViewProject.bind(this)
      }),
      projectDetails: new ProjectDetailsComponent({
        onBack: this.handleBackToList.bind(this)
      }),
      knowledgeBase: new KnowledgeBaseComponent()
    };

    // Verify components initialized properly
    if (!this.components.projectList.element) {
      console.error("Failed to initialize ProjectListComponent");
      throw new Error("ProjectListComponent initialization failed");
    }

    // Process initial state
    this.processUrlParams();
    this.registerEventListeners();
    
    // Load initial data
    await this.loadProjects();
  }

  /**
   * Process URL parameters to determine initial view
   */
  processUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");
    
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  }

  /**
   * Register all event listeners
   */
  registerEventListeners() {
    // Data events
    console.log('[DEBUG] Registering projectsLoaded listener');
    document.addEventListener("projectsLoaded", (event) => {
      console.log('[DEBUG] Received projectsLoaded event with:',
        event.detail?.projects?.length || 0, 'projects');
      this.handleProjectsLoaded(event);
    });
    document.addEventListener("projectLoaded", this.handleProjectLoaded.bind(this));
    document.addEventListener("projectStatsLoaded", this.handleProjectStatsLoaded.bind(this));
    document.addEventListener("projectFilesLoaded", this.handleFilesLoaded.bind(this));
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    document.addEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this));

    // UI events
    document.getElementById("projectForm")?.addEventListener("submit", 
      this.handleProjectFormSubmit.bind(this));
    
    document.getElementById("uploadFileBtn")?.addEventListener("click", () => {
      document.getElementById("fileInput")?.click();
    });
    
    document.getElementById("fileInput")?.addEventListener("change", (e) => {
      if (!e.target.files?.length) return;
      const projectId = this.state.currentProject?.id;
      if (projectId) {
        this.components.projectDetails.uploadFiles(projectId, e.target.files)
          .then(() => {
            // Refresh stats after successful upload
            window.projectManager.loadProjectStats(projectId);
          });
      }
    });

    // Handle browser back/forward navigation
    window.addEventListener('popstate', () => {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get("project");
      
      if (projectId && this.state.currentView !== 'details') {
        this.showProjectDetails(projectId);
      } else if (!projectId && this.state.currentView !== 'list') {
        this.showProjectList();
      }
    });
  }

  /**
   * View management methods
   */
  showProjectList() {
    this.state.currentView = 'list';
    this.components.projectList.show();
    this.components.projectDetails.hide();
    window.history.pushState({}, "", window.location.pathname);
    this.loadProjects();
  }

  async showProjectDetails(projectId) {
    this.state.currentView = 'details';
    this.components.projectList.hide();
    this.components.projectDetails.show();
    window.history.pushState({}, "", `?project=${projectId}`);
    
    try {
      await window.projectManager.loadProjectDetails(projectId);
    } catch (error) {
      console.error("Failed to load project details:", error);
      UIUtils.showNotification("Failed to load project", "error");
      this.showProjectList();
    }
  }

  /**
   * Data loading methods
   */
  async loadProjects(filter = 'all') {
    try {
      if (!window.projectManager) {
        console.error('projectManager not available on window');
        throw new Error('projectManager not initialized');
      }
      
      console.log('[DEBUG] Loading projects with filter:', filter);
      const response = await window.projectManager.loadProjects(filter);
      console.log('[DEBUG] Projects loaded - response:', response);
      console.log('[DEBUG] Projects data:', response?.data?.projects || response?.projects);
      return response;
    } catch (error) {
      console.error("Failed to load projects:", error);
      document.dispatchEvent(new CustomEvent("projectsLoaded", {
        detail: {
          error: true,
          message: error.message
        }
      }));
      throw error;
    }
  }

  /**
   * Event handlers
   */
  handleProjectsLoaded(event) {
    console.log('[DEBUG] Handling projectsLoaded event');
    console.log('[DEBUG] Full event:', event);
    console.log('[DEBUG] Event detail:', event.detail);
    try {
      let projects = [];
      let originalCount = 0;
      let filter = 'all';
      let hasError = false;
      
      console.log('[DEBUG] Raw event detail:', event.detail);

      // Normalize different response formats
      if (Array.isArray(event.detail)) {
        projects = event.detail;
      } else if (event.detail?.data?.projects) {
        projects = event.detail.data.projects;
        originalCount = event.detail.data.count || projects.length;
        filter = event.detail.data.filter?.type || 'all';
      } else if (event.detail?.projects) {
        projects = event.detail.projects;
        originalCount = event.detail.count || projects.length;
        filter = event.detail.filter?.type || 'all';
      }

      hasError = event.detail.error || false;
      console.log('[DEBUG] Calling renderProjects with:', projects.length, 'projects');
      this.components.projectList.renderProjects(projects);

      // Update empty state message
      const noProjectsMsg = document.getElementById('noProjectsMessage');
      if (noProjectsMsg) {
        noProjectsMsg.classList.toggle('hidden', projects.length > 0 || hasError);
        
        if (hasError) {
          noProjectsMsg.textContent = "Error loading projects";
          noProjectsMsg.classList.add('text-red-600');
        } else if (projects.length === 0 && originalCount > 0) {
          noProjectsMsg.textContent = `No projects match the "${filter}" filter`;
          noProjectsMsg.classList.remove('text-red-600');
        } else if (projects.length === 0) {
          noProjectsMsg.textContent = "No projects found";
          noProjectsMsg.classList.remove('text-red-600');
        }
      }
    } catch (error) {
      console.error("Error handling projects:", error);
    }
  }

  handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project;
    this.components.projectDetails.renderProject(project);
    // Knowledge base info is loaded via stats, no separate load needed here.
  }

  handleProjectStatsLoaded(event) {
    const stats = event.detail;
    this.components.projectDetails.renderStats(stats);
    
    // Pass knowledge base info from stats to the KB component
    if (stats && stats.knowledge_base) {
      this.components.knowledgeBase.renderKnowledgeBaseInfo(stats.knowledge_base);
    } else {
      // Render KB as inactive if no info is present in stats
      this.components.knowledgeBase.renderKnowledgeBaseInfo(null);
    }
  }

  handleFilesLoaded(event) {
    this.components.projectDetails.renderFiles(event.detail.files);
  }

  handleConversationsLoaded(event) {
    let conversations = [];
    
    // Normalize different response formats
    if (Array.isArray(event.detail)) {
      conversations = event.detail;
    } else if (event.detail?.conversations) {
      conversations = event.detail.conversations;
    } else if (event.detail?.data?.conversations) {
      conversations = event.detail.data.conversations;
    }
    
    this.components.projectDetails.renderConversations(conversations);
    
    // Refresh stats when conversations are loaded
    if (this.state.currentProject?.id) {
      window.projectManager.loadProjectStats(this.state.currentProject.id);
    }
  }

  handleArtifactsLoaded(event) {
    this.components.projectDetails.renderArtifacts?.(event.detail.artifacts);
  }

  handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }

  handleBackToList() {
    this.showProjectList();
  }

  async handleProjectFormSubmit(e) {
    e.preventDefault();
    
    const form = e.target;
    const projectId = form.querySelector("#projectIdInput").value;
    const isEditing = !!projectId;
    
    const formData = {
      name: form.querySelector("#projectNameInput").value.trim(),
      description: form.querySelector("#projectDescInput").value.trim(),
      goals: form.querySelector("#projectGoalsInput").value.trim(),
      max_tokens: parseInt(form.querySelector("#projectMaxTokensInput").value, 10)
    };

    if (!formData.name) {
      UIUtils.showNotification("Project name is required", "error");
      return;
    }

    try {
      await window.projectManager.createOrUpdateProject(projectId, formData);
      UIUtils.showNotification(
        isEditing ? "Project updated" : "Project created",
        "success"
      );
      ModalManager.hide("project");
      this.loadProjects();
    } catch (error) {
      console.error("Error saving project:", error);
      UIUtils.showNotification("Failed to save project", "error");
    }
  }
}

/**
 * Initialize the project dashboard module
 */
async function initProjectDashboard() {
  try {
    const dashboard = new ProjectDashboard();
    await dashboard.init();
    
    // For debugging and development access
    if (typeof window !== 'undefined') {
      window.projectDashboard = dashboard;
    }
    
    return dashboard;
  } catch (error) {
    console.error("Failed to initialize project dashboard:", error);
    UIUtils.showNotification("Failed to initialize dashboard", "error");
    throw error;
  }
}

// Export for module usage
export { ProjectDashboard, initProjectDashboard };

// Automatic initialization when loaded in browser context
if (typeof window !== 'undefined') {
  // Wait for both DOM and projectManager to be ready
  const startInitialization = async () => {
    try {
      if (!window.projectManager) {
        throw new Error('projectManager not available');
      }

      // Additional check for required DOM elements
      const requiredElements = ['projectList', 'projectListView'];
      const missingElements = requiredElements.filter(id => !document.getElementById(id));
      
      if (missingElements.length > 0) {
        console.warn('Missing required elements:', missingElements);
        // Create fallback container if main one is missing
        if (!document.getElementById('projectList')) {
          const container = document.createElement('div');
          container.id = 'projectList';
          document.body.appendChild(container);
        }
      }

      await initProjectDashboard();
    } catch (error) {
      console.error('Initialization failed:', error);
      // Retry after delay
      setTimeout(startInitialization, 300);
    }
  };

  // Start initialization when both DOM and dependencies are ready
  const startWhenReady = () => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      startInitialization();
    } else {
      document.addEventListener('DOMContentLoaded', startInitialization);
    }
  };

  // Check if projectManager is already available
  if (window.projectManager) {
    startWhenReady();
  } else {
    // Wait for projectManager to be available
    const waitForProjectManager = () => {
      if (window.projectManager) {
        startWhenReady();
      } else {
        setTimeout(waitForProjectManager, 100);
      }
    };
    waitForProjectManager();
  }
}
