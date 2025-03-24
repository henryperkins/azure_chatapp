/**
 * projectDashboard.js
 * -------------------
 * Main controller for the project dashboard
 * Uses a component-based architecture for better separation of concerns
 */

// Main Dashboard Controller
const ProjectDashboard = {
  components: {},
  state: {
    currentView: null, // 'list' or 'details'
    currentProject: null
  },

  // Initialize the dashboard
  init() {
    // Setup UI components
    this.setupComponents();
    
    // Process URL parameters to determine initial view
    this.processUrlParams();
    
    // Register data event listeners
    this.registerDataEvents();
    
    console.log("Project Dashboard initialized");
  },

  // Setup UI components
  setupComponents() {
    // Initialize view components
    this.components.projectList = new ProjectListComponent({
      elementId: "projectList",
      onViewProject: this.handleViewProject.bind(this)
    });
    
    this.components.projectDetails = new ProjectDetailsComponent({
      onBack: this.handleBackToList.bind(this)
    });
    
    this.components.knowledgeBase = new KnowledgeBaseComponent();
    
    // Bind global event listeners
    this.bindEvents();
  },
  
  // Process URL parameters
  processUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");
    
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  },
  
  // Register data event listeners
  registerDataEvents() {
    document.addEventListener("projectsLoaded", this.handleProjectsLoaded.bind(this));
    document.addEventListener("projectLoaded", this.handleProjectLoaded.bind(this));
    document.addEventListener("projectStatsLoaded", this.handleProjectStatsLoaded.bind(this));
    document.addEventListener("projectFilesLoaded", this.handleFilesLoaded.bind(this));
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    document.addEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this));
  },
  
  // Global event binding
  bindEvents() {
    // Global search
    document.getElementById("projectSearchInput")?.addEventListener("input", 
      (e) => this.components.projectList.filterBySearch(e.target.value));
    
    // Filter buttons
    document.querySelectorAll(".project-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.setActiveFilter(btn.dataset.filter);
        projectManager.loadProjects(btn.dataset.filter);
      });
    });
    
    // Project tabs
    document.querySelectorAll(".project-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => this.switchProjectTab(btn.dataset.tab));
    });
    
    // Create project button
    document.getElementById("createProjectBtn")?.addEventListener("click", () => {
      ModalManager.showProjectForm();
    });
    
    // Close project form buttons
    document.getElementById("closeProjectFormBtn")?.addEventListener("click", () => {
      ModalManager.hideProjectForm();
    });
    
    document.getElementById("cancelProjectFormBtn")?.addEventListener("click", () => {
      ModalManager.hideProjectForm();
    });
    
    // Form submissions
    document.getElementById("projectForm")?.addEventListener("submit", 
      this.handleProjectFormSubmit.bind(this));
      
    document.getElementById("knowledgeBaseForm")?.addEventListener("submit", 
      this.handleKbFormSubmit.bind(this));
      
    // File uploads
    document.getElementById("uploadFileBtn")?.addEventListener("click", () => {
      document.getElementById("fileInput")?.click();
    });
    
    document.getElementById("fileInput")?.addEventListener("change", 
      this.handleFileUpload.bind(this));
    
    // Cancel KB form buttons
    document.getElementById("cancelKnowledgeBaseFormBtn")?.addEventListener("click", () => {
      ModalManager.hide("knowledge");
    });
  },
  
  // View management
  showProjectList() {
    this.state.currentView = 'list';
    this.components.projectList.show();
    this.components.projectDetails.hide();
    window.history.pushState({}, "", window.location.pathname);
    projectManager.loadProjects();
  },
  
  showProjectDetails(projectId) {
    this.state.currentView = 'details';
    this.components.projectList.hide();
    this.components.projectDetails.show();
    projectManager.loadProjectDetails(projectId);
  },
  
  // UI state management
  setActiveFilter(filter) {
    document.querySelectorAll(".project-filter-btn").forEach(btn => {
      const isActive = btn.dataset.filter === filter;
      btn.classList.toggle("border-b-2", isActive);
      btn.classList.toggle("border-blue-600", isActive);
      btn.classList.toggle("text-blue-600", isActive);
      btn.classList.toggle("text-gray-600", !isActive);
    });
  },
  
  // Improved tab switching logic
  switchProjectTab(tabId) {
    // Update tab buttons
    document.querySelectorAll(".project-tab-btn").forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle("border-b-2", isActive);
      btn.classList.toggle("border-blue-600", isActive);
      btn.classList.toggle("text-blue-600", isActive);
      btn.classList.toggle("text-gray-500", !isActive);
    });
    
    // Update tab content visibility
    document.querySelectorAll(".project-tab-content").forEach(tab => {
      tab.classList.toggle("hidden", tab.id !== `${tabId}Tab`);
    });
    
    // Optimized data loading strategy
    if (this.state.currentProject) {
      const projectId = this.state.currentProject.id;
      
      const dataLoaders = {
        details: () => {}, // No additional data needed
        files: () => projectManager.loadProjectFiles(projectId),
        conversations: () => projectManager.loadProjectConversations(projectId),
        artifacts: () => projectManager.loadProjectArtifacts(projectId),
        knowledge: () => this.components.knowledgeBase.loadData(projectId)
      };
      
      if (dataLoaders[tabId]) {
        dataLoaders[tabId]();
      }
    }
  },
  
  // Event handlers
  handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  },
  
  handleBackToList() {
    this.showProjectList();
  },
  
  handleProjectsLoaded(event) {
    const projects = event.detail;
    this.components.projectList.renderProjects(projects);
  },
  
  handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project;
    this.components.projectDetails.renderProject(project);
  },
  
  handleProjectStatsLoaded(event) {
    const stats = event.detail;
    this.components.projectDetails.renderStats(stats);
  },
  
  handleFilesLoaded(event) {
    const files = event.detail.files;
    this.components.projectDetails.renderFiles(files);
  },
  
  handleConversationsLoaded(event) {
    const conversations = event.detail;
    this.components.projectDetails.renderConversations(conversations);
  },
  
  handleArtifactsLoaded(event) {
    const artifacts = event.detail.artifacts;
    this.components.projectDetails.renderArtifacts(artifacts);
  },
  
  handleProjectFormSubmit(e) {
    e.preventDefault();
    
    const projectId = document.getElementById("projectIdInput").value;
    const isEditing = !!projectId;
    
    // Collect form data
    const data = {
      name: document.getElementById("projectNameInput").value.trim(),
      description: document.getElementById("projectDescInput").value.trim(),
      goals: document.getElementById("projectGoalsInput").value.trim(),
      max_tokens: parseInt(document.getElementById("projectMaxTokensInput").value, 10),
    };
    
    if (!data.name) {
      UIUtils.showNotification("Project name is required", "error");
      return;
    }
    
    projectManager.createOrUpdateProject(projectId, data)
      .then(() => {
        ModalManager.hideProjectForm();
        UIUtils.showNotification(
          isEditing ? "Project updated successfully" : "Project created successfully",
          "success"
        );
        projectManager.loadProjects();
      })
      .catch(err => {
        console.error("Error saving project:", err);
        UIUtils.showNotification("Failed to save project", "error");
      });
  },
  
  handleKbFormSubmit(e) {
    e.preventDefault();
    
    if (!this.state.currentProject) {
      UIUtils.showNotification("No project selected", "error");
      return;
    }
    
    const formData = {
      name: document.getElementById("knowledgeBaseNameInput").value.trim(),
      description: document.getElementById("knowledgeBaseDescInput").value.trim(),
      embedding_model: document.getElementById("embeddingModelSelect").value,
      process_existing_files: document.getElementById("processAllFilesCheckbox").checked
    };
    
    this.createKnowledgeBase(this.state.currentProject.id, formData);
  },
  
  handleFileUpload(e) {
    if (!this.state.currentProject) {
      UIUtils.showNotification("No project selected", "error");
      return;
    }
    
    const files = e.target.files;
    if (!files || !files.length) return;
    
    this.components.projectDetails.uploadFiles(this.state.currentProject.id, files);
  },
  
  // API Actions
  createKnowledgeBase(projectId, data) {
    window.apiRequest(`/api/projects/${projectId}/knowledge-base`, "POST", data)
      .then(() => {
        ModalManager.hide("knowledge");
        UIUtils.showNotification("Knowledge base created successfully", "success");
        projectManager.loadProjectStats(projectId);
      })
      .catch(err => {
        console.error("Error creating knowledge base:", err);
        UIUtils.showNotification("Failed to create knowledge base", "error");
      });
  },
  
  reprocessAllFiles(projectId) {
    if (!projectId) return;
    
    UIUtils.showNotification("Reprocessing files, this may take a moment...", "info");
    
    window.apiRequest(`/api/projects/${projectId}/files/reprocess`, "POST")
      .then(response => {
        const data = response.data || {};
        UIUtils.showNotification(
          `Reprocessed ${data.processed_success || 0} files successfully. ${data.processed_failed || 0} failed.`,
          data.processed_failed ? "warning" : "success"
        );
        projectManager.loadProjectStats(projectId);
      })
      .catch(err => {
        console.error("Error reprocessing files:", err);
        UIUtils.showNotification("Failed to reprocess files", "error");
      });
  }
};

// Initialize the dashboard when DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  ProjectDashboard.init();
});