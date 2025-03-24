/**
 * projectDashboard.js
 * -------------------
 * A refactored implementation of the project dashboard that:
 * - Uses a component-based architecture for better separation of concerns
 * - Implements standardized patterns for DOM manipulation and event handling
 * - Removes arbitrary timeouts and improves async handling
 * - Provides consistent error handling
 */

// Initialize components when DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  ProjectDashboard.init();
});

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
    
    this.components.modals = new ModalManager();
    
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
      this.components.modals.showProjectForm();
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
    
    // Load data if needed
    if (this.state.currentProject) {
      const projectId = this.state.currentProject.id;
      if (tabId === "files") {
        projectManager.loadProjectFiles(projectId);
      } else if (tabId === "conversations") {
        projectManager.loadProjectConversations(projectId);
      } else if (tabId === "artifacts") {
        projectManager.loadProjectArtifacts(projectId);
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
        this.components.modals.hideProjectForm();
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
        this.components.modals.hideModal("knowledgeBaseSettingsModal");
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

// Component classes
class ProjectListComponent {
  constructor(options) {
    this.elementId = options.elementId;
    this.element = document.getElementById(this.elementId);
    this.onViewProject = options.onViewProject;
    this.messageEl = document.getElementById("noProjectsMessage");
  }
  
  show() {
    document.getElementById("projectListView")?.classList.remove("hidden");
  }
  
  hide() {
    document.getElementById("projectListView")?.classList.add("hidden");
  }
  
  renderProjects(projects) {
    if (!this.element) return;
    
    this.element.innerHTML = "";
    
    if (!projects || projects.length === 0) {
      if (this.messageEl) this.messageEl.classList.remove("hidden");
      return;
    }
    
    if (this.messageEl) this.messageEl.classList.add("hidden");
    
    projects.forEach(project => {
      const card = this.createProjectCard(project);
      this.element.appendChild(card);
    });
  }
  
  createProjectCard(project) {
    // Calculate usage percentage
    const usage = project.token_usage || 0;
    const maxTokens = project.max_tokens || 0;
    const usagePct = maxTokens > 0 ? Math.min(100, (usage / maxTokens) * 100).toFixed(1) : 0;
    
    // Create card container
    const card = UIUtils.createElement("div", {
      className: `bg-white dark:bg-gray-700 rounded shadow p-4 border-l-4 
        ${project.pinned ? "border-yellow-500" : "border-blue-500"} 
        ${project.archived ? "opacity-60" : ""} w-full md:w-auto mb-2`
    });
    
    // Header with title and badges
    const header = UIUtils.createElement("div", { className: "flex justify-between mb-2" });
    
    const title = UIUtils.createElement("h3", { 
      className: "font-semibold text-md",
      textContent: project.name
    });
    
    const badges = UIUtils.createElement("div", { className: "text-xs text-gray-500" });
    if (project.pinned) badges.appendChild(document.createTextNode("📌 "));
    if (project.archived) badges.appendChild(document.createTextNode("🗃️ "));
    
    header.appendChild(title);
    header.appendChild(badges);
    card.appendChild(header);
    
    // Description
    const desc = UIUtils.createElement("p", {
      className: "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2",
      textContent: project.description || "No description"
    });
    card.appendChild(desc);
    
    // Token usage progress
    const tokenWrapper = UIUtils.createElement("div", { className: "mb-2" });
    
    const tokenHeader = UIUtils.createElement("div", { 
      className: "flex justify-between mb-1 text-xs",
      innerHTML: `
        <span>Tokens: ${UIUtils.formatNumber(usage)} / ${UIUtils.formatNumber(maxTokens)}</span>
        <span>${usagePct}%</span>
      `
    });
    
    const progressOuter = UIUtils.createElement("div", { 
      className: "w-full bg-gray-200 rounded-full h-1.5" 
    });
    
    const progressInner = UIUtils.createElement("div", { 
      className: "bg-blue-600 h-1.5 rounded-full",
      style: { width: `${usagePct}%` }
    });
    
    progressOuter.appendChild(progressInner);
    tokenWrapper.appendChild(tokenHeader);
    tokenWrapper.appendChild(progressOuter);
    card.appendChild(tokenWrapper);
    
    // Footer with created date and actions
    const footer = UIUtils.createElement("div", { 
      className: "flex justify-between mt-3" 
    });
    
    const createdInfo = UIUtils.createElement("div", {
      className: "text-xs text-gray-500",
      textContent: `Created ${UIUtils.formatDate(project.created_at)}`
    });
    
    const actions = UIUtils.createElement("div", { className: "flex space-x-1" });
    
    // View button
    const viewBtn = UIUtils.createElement("button", {
      className: "p-1 text-blue-600 hover:text-blue-800 view-project-btn flex items-center justify-center",
      innerHTML: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span class="loading-spinner hidden ml-1"></span>
      `,
      onclick: () => this.onViewProject(project.id)
    });
    
    // Delete button
    const deleteBtn = UIUtils.createElement("button", {
      className: "p-1 text-red-600 hover:text-red-800 delete-project-btn",
      innerHTML: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      `,
      onclick: () => this.confirmDelete(project)
    });
    
    actions.appendChild(viewBtn);
    actions.appendChild(deleteBtn);
    
    footer.appendChild(createdInfo);
    footer.appendChild(actions);
    card.appendChild(footer);
    
    return card;
  }
  
  confirmDelete(project) {
    ModalManager.confirmAction({
      title: "Delete Project",
      message: `Are you sure you want to delete the project "${project.name}"? This cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        projectManager.deleteProject(project.id)
          .then(() => {
            UIUtils.showNotification("Project deleted", "success");
            projectManager.loadProjects();
          })
          .catch(err => {
            console.error("Error deleting project:", err);
            UIUtils.showNotification("Failed to delete project", "error");
          });
      }
    });
  }
  
  filterBySearch(term) {
    if (!this.element) return;
    
    const projectCards = this.element.querySelectorAll("div");
    let visibleCount = 0;
    term = term.toLowerCase();
    
    projectCards.forEach(card => {
      const projectName = card.querySelector("h3")?.textContent.toLowerCase() || "";
      const projectDesc = card.querySelector("p")?.textContent.toLowerCase() || "";
      const isMatch = projectName.includes(term) || projectDesc.includes(term);
      card.classList.toggle("hidden", !isMatch);
      if (isMatch) visibleCount++;
    });
    
    if (this.messageEl) {
      if (visibleCount === 0) {
        this.messageEl.textContent = "No matching projects found.";
        this.messageEl.classList.remove("hidden");
      } else {
        this.messageEl.classList.add("hidden");
      }
    }
  }
}

class ProjectDetailsComponent {
  constructor(options = {}) {
    this.onBack = options.onBack;
    this.fileUploadStatus = {
      completed: 0,
      failed: 0,
      total: 0
    };
    
    this.elements = {
      container: document.getElementById("projectDetailsView"),
      title: document.getElementById("projectTitle"),
      description: document.getElementById("projectDescription"),
      goals: document.getElementById("projectGoals"),
      instructions: document.getElementById("projectInstructions"),
      tokenUsage: document.getElementById("tokenUsage"),
      maxTokens: document.getElementById("maxTokens"),
      tokenPercentage: document.getElementById("tokenPercentage"),
      tokenProgressBar: document.getElementById("tokenProgressBar"),
      conversationCount: document.getElementById("conversationCount"),
      fileCount: document.getElementById("fileCount"),
      artifactCount: document.getElementById("artifactCount"),
      filesList: document.getElementById("projectFilesList"),
      conversationsList: document.getElementById("projectConversationsList"),
      artifactsList: document.getElementById("projectArtifactsList"),
      uploadProgress: document.getElementById("filesUploadProgress"),
      progressBar: document.getElementById("fileProgressBar"),
      uploadStatus: document.getElementById("uploadStatus"),
      pinBtn: document.getElementById("pinProjectBtn"),
      archiveBtn: document.getElementById("archiveProjectBtn"),
      backBtn: document.getElementById("backToProjectsBtn"),
      editBtn: document.getElementById("editProjectBtn"),
      editInstructionsBtn: document.getElementById("editInstructionsBtn"),
      newConversationBtn: document.getElementById("newConversationBtn"),
      kbInfoContainer: document.getElementById("knowledgeBaseInfo")
    };
    
    this.bindEvents();
  }
  
  bindEvents() {
    // Back button
    if (this.elements.backBtn) {
      this.elements.backBtn.addEventListener("click", () => {
        if (this.onBack) this.onBack();
      });
    }
    
    // Pin/unpin button
    if (this.elements.pinBtn) {
      this.elements.pinBtn.addEventListener("click", () => this.togglePin());
    }
    
    // Archive/unarchive button
    if (this.elements.archiveBtn) {
      this.elements.archiveBtn.addEventListener("click", () => this.toggleArchive());
    }
    
    // Edit button
    if (this.elements.editBtn) {
      this.elements.editBtn.addEventListener("click", () => {
        const project = projectManager.currentProject;
        if (project) {
          ModalManager.showProjectForm(project);
        }
      });
    }
    
    // Edit instructions button
    if (this.elements.editInstructionsBtn) {
      this.elements.editInstructionsBtn.addEventListener("click", () => {
        const project = projectManager.currentProject;
        if (!project) {
          UIUtils.showNotification("No project selected", "error");
          return;
        }
        document.getElementById("customInstructionsInput").value = project.custom_instructions || "";
        ModalManager.showModal("instructionsModal");
      });
    }
    
    // Save instructions button
    document.getElementById("saveInstructionsBtn")?.addEventListener("click", () => {
      const project = projectManager.currentProject;
      if (!project) return;
      
      const instructions = document.getElementById("customInstructionsInput").value;
      
      projectManager.saveCustomInstructions(project.id, instructions)
        .then(() => {
          UIUtils.showNotification("Custom instructions saved", "success");
          ModalManager.hideModal("instructionsModal");
          
          project.custom_instructions = instructions;
          if (this.elements.instructions) {
            this.elements.instructions.textContent = instructions || "No custom instructions set.";
          }
        })
        .catch(err => {
          console.error("Error saving instructions:", err);
          UIUtils.showNotification("Failed to save instructions", "error");
        });
    });
    
    // New conversation button
    if (this.elements.newConversationBtn) {
      this.elements.newConversationBtn.addEventListener("click", () => this.startNewConversation());
    }
  }
  
  show() {
    if (this.elements.container) {
      this.elements.container.classList.remove("hidden");
    }
  }
  
  hide() {
    if (this.elements.container) {
      this.elements.container.classList.add("hidden");
    }
  }
  
  renderProject(project) {
    // Update text fields
    if (this.elements.title) this.elements.title.textContent = project.name;
    if (this.elements.description) {
      this.elements.description.textContent = project.description || "No description provided.";
    }
    if (this.elements.goals) this.elements.goals.textContent = project.goals || "No goals defined.";
    if (this.elements.instructions) {
      this.elements.instructions.textContent = project.custom_instructions || "No custom instructions set.";
    }
    
    // Update UI state for pin/archive buttons
    if (this.elements.pinBtn) {
      const svg = this.elements.pinBtn.querySelector("svg");
      if (svg) svg.setAttribute("fill", project.pinned ? "currentColor" : "none");
      this.elements.pinBtn.classList.toggle("text-yellow-600", project.pinned);
    }
    
    if (this.elements.archiveBtn) {
      const svg = this.elements.archiveBtn.querySelector("svg");
      if (svg) svg.setAttribute("fill", project.archived ? "currentColor" : "none");
      this.elements.archiveBtn.classList.toggle("text-gray-800", project.archived);
    }
  }
  
  renderStats(stats) {
    // Update token usage stats
    if (this.elements.tokenUsage) {
      this.elements.tokenUsage.textContent = UIUtils.formatNumber(stats.token_usage || 0);
    }
    if (this.elements.maxTokens) {
      this.elements.maxTokens.textContent = UIUtils.formatNumber(stats.max_tokens || 0);
    }
    
    const usage = stats.token_usage || 0;
    const maxT = stats.max_tokens || 0;
    const pct = maxT > 0 ? Math.min(100, (usage / maxT) * 100).toFixed(1) : 0;
    
    if (this.elements.tokenPercentage) {
      this.elements.tokenPercentage.textContent = `${pct}%`;
    }
    if (this.elements.tokenProgressBar) {
      this.elements.tokenProgressBar.style.width = `${pct}%`;
    }
    
    // Update counts
    if (this.elements.conversationCount) {
      this.elements.conversationCount.textContent = stats.conversation_count || 0;
    }
    if (this.elements.fileCount) {
      this.elements.fileCount.textContent = stats.file_count || 0;
    }
    if (this.elements.artifactCount) {
      this.elements.artifactCount.textContent = stats.artifact_count || 0;
    }
    
    // Update knowledge base info
    this.renderKnowledgeBaseInfo(stats.knowledge_base);
  }
  
  renderKnowledgeBaseInfo(kb) {
    if (!this.elements.kbInfoContainer) return;
    
    if (kb) {
      // Display knowledge base info
      this.elements.kbInfoContainer.innerHTML = `
        <div class="mb-2 font-medium">Knowledge Base</div>
        <div class="flex justify-between text-sm mb-1">
          <span>${kb.name || "Unknown"}</span>
          <span class="px-2 py-0.5 bg-${kb.is_active ? 'green' : 'gray'}-100 
              text-${kb.is_active ? 'green' : 'gray'}-800 rounded text-xs">
              ${kb.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>
        <div class="text-xs text-gray-500 mb-2">Model: ${kb.embedding_model || "Default"}</div>
        
        <div class="mt-2 mb-1 text-xs font-medium text-gray-600">File Processing</div>
        <div class="w-full bg-gray-200 rounded-full h-1.5 mb-1">
          <div class="bg-blue-600 h-1.5 rounded-full" 
              style="width: ${projectManager.currentProject?.file_count ? 
                Math.round((kb.indexed_files / projectManager.currentProject.file_count) * 100) : 0}%">
          </div>
        </div>
        <div class="flex justify-between text-xs text-gray-500">
          <span>${kb.indexed_files || 0} indexed</span>
          <span>${kb.pending_files || 0} pending</span>
        </div>
        
        <div class="mt-3">
          <button id="reprocessFilesBtn" class="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
              Reprocess All Files
          </button>
        </div>
      `;
      
      // Add event handler for reprocess button
      document.getElementById("reprocessFilesBtn")?.addEventListener("click", () => {
        if (projectManager.currentProject) {
          ProjectDashboard.reprocessAllFiles(projectManager.currentProject.id);
        }
      });
      
      this.elements.kbInfoContainer.classList.remove("hidden");
    } else {
      // Show create knowledge base button
      this.elements.kbInfoContainer.innerHTML = `
        <div class="mb-2 font-medium">Knowledge Base</div>
        <p class="text-sm text-gray-600 mb-3">
            No knowledge base associated with this project. Create one to enable semantic search.
        </p>
        <button id="createKnowledgeBaseBtn" class="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
            Create Knowledge Base
        </button>
      `;
      
      // Add event handler for create button
      document.getElementById("createKnowledgeBaseBtn")?.addEventListener("click", () => {
        ModalManager.showModal("knowledgeBaseSettingsModal");
      });
      
      this.elements.kbInfoContainer.classList.remove("hidden");
    }
  }
  
  renderFiles(files) {
    if (!this.elements.filesList) return;
    
    if (!files || files.length === 0) {
      this.elements.filesList.innerHTML = `
        <div class="text-gray-500 text-center py-8">No files uploaded yet.</div>
      `;
      return;
    }
    
    this.elements.filesList.innerHTML = "";
    
    files.forEach(file => {
      const item = UIUtils.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2"
      });
      
      // Info section
      const infoDiv = UIUtils.createElement("div", {
        className: "flex items-center"
      });
      
      const iconSpan = UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: UIUtils.fileIcon(file.file_type)
      });
      
      const detailDiv = UIUtils.createElement("div", {
        className: "flex flex-col"
      });
      
      const fileName = UIUtils.createElement("div", {
        className: "font-medium",
        textContent: file.filename
      });
      
      const fileInfo = UIUtils.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: `${UIUtils.formatBytes(file.file_size)} · ${UIUtils.formatDate(file.created_at)}`
      });
      
      detailDiv.appendChild(fileName);
      detailDiv.appendChild(fileInfo);
      infoDiv.appendChild(iconSpan);
      infoDiv.appendChild(detailDiv);
      item.appendChild(infoDiv);
      
      // Actions section
      const actions = UIUtils.createElement("div", {
        className: "flex space-x-2"
      });
      
      // Delete button
      const deleteBtn = UIUtils.createElement("button", {
        className: "text-red-600 hover:text-red-800",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        `,
        onclick: () => this.confirmDeleteFile(file)
      });
      
      actions.appendChild(deleteBtn);
      item.appendChild(actions);
      
      this.elements.filesList.appendChild(item);
    });
  }
  
  renderConversations(data) {
    if (!this.elements.conversationsList) return;
    
    if (!data || !data.conversations || data.conversations.length === 0) {
      this.elements.conversationsList.innerHTML = `
        <div class="text-gray-500 text-center py-8">No conversations yet.</div>
      `;
      return;
    }
    
    this.elements.conversationsList.innerHTML = "";
    
    data.conversations.forEach(conversation => {
      const item = UIUtils.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2"
      });
      
      // Info section
      const infoDiv = UIUtils.createElement("div", {
        className: "flex items-center"
      });
      
      const detailDiv = UIUtils.createElement("div", {
        className: "flex flex-col"
      });
      
      const titleDiv = UIUtils.createElement("div", {
        className: "font-medium",
        textContent: conversation.title || `Conversation ${conversation.id}`
      });
      
      const infoText = UIUtils.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: `${conversation.message_count || 0} messages · ${UIUtils.formatDate(conversation.created_at)}`
      });
      
      detailDiv.appendChild(titleDiv);
      detailDiv.appendChild(infoText);
      infoDiv.appendChild(detailDiv);
      item.appendChild(infoDiv);
      
      // Actions section
      const actions = UIUtils.createElement("div", {
        className: "flex space-x-2"
      });
      
      // View conversation button
      const viewBtn = UIUtils.createElement("a", {
        href: `/?chatId=${conversation.id}`,
        className: "text-blue-600 hover:text-blue-800",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        `
      });
      
      actions.appendChild(viewBtn);
      item.appendChild(actions);
      
      this.elements.conversationsList.appendChild(item);
    });
  }
  
  renderArtifacts(artifacts) {
    if (!this.elements.artifactsList) return;
    
    if (!artifacts || artifacts.length === 0) {
      this.elements.artifactsList.innerHTML = `
        <div class="text-gray-500 text-center py-8">No artifacts generated yet.</div>
      `;
      return;
    }
    
    this.elements.artifactsList.innerHTML = "";
    
    artifacts.forEach(artifact => {
      const item = UIUtils.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2"
      });
      
      // Info section
      const infoDiv = UIUtils.createElement("div", {
        className: "flex items-center"
      });
      
      const iconSpan = UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: UIUtils.artifactIcon(artifact.content_type)
      });
      
      const detailDiv = UIUtils.createElement("div", {
        className: "flex flex-col"
      });
      
      const titleDiv = UIUtils.createElement("div", {
        className: "font-medium",
        textContent: artifact.name || `Artifact ${artifact.id}`
      });
      
      const infoText = UIUtils.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: `${UIUtils.formatDate(artifact.created_at)} · From conversation ${artifact.conversation_id}`
      });
      
      detailDiv.appendChild(titleDiv);
      detailDiv.appendChild(infoText);
      infoDiv.appendChild(iconSpan);
      infoDiv.appendChild(detailDiv);
      item.appendChild(infoDiv);
      
      // Actions section
      const actions = UIUtils.createElement("div", {
        className: "flex space-x-2"
      });
      
      // View button
      const viewBtn = UIUtils.createElement("button", {
        className: "text-blue-600 hover:text-blue-800",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        `,
        onclick: () => this.viewArtifact(artifact)
      });
      
      // Delete button
      const deleteBtn = UIUtils.createElement("button", {
        className: "text-red-600 hover:text-red-800",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        `,
        onclick: () => this.confirmDeleteArtifact(artifact)
      });
      
      actions.appendChild(viewBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(actions);
      
      this.elements.artifactsList.appendChild(item);
    });
  }
  
  uploadFiles(projectId, files) {
    // Reset upload status
    this.fileUploadStatus = {
      completed: 0,
      failed: 0,
      total: files.length
    };
    
    // Show upload progress UI
    if (this.elements.uploadProgress) {
      this.elements.uploadProgress.classList.remove("hidden");
    }
    
    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = "0%";
    }
    
    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent = `Uploading 0/${files.length} files...`;
    }
    
    // Upload files
    [...files].forEach(file => {
      projectManager.uploadFile(projectId, file)
        .then(() => {
          this.fileUploadStatus.completed++;
          this.updateUploadProgress();
        })
        .catch(() => {
          this.fileUploadStatus.failed++;
          this.fileUploadStatus.completed++;
          this.updateUploadProgress();
        });
    });
  }
  
  updateUploadProgress() {
    const { completed, failed, total } = this.fileUploadStatus;
    
    const percentage = Math.round((completed / total) * 100);
    
    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = `${percentage}%`;
    }
    
    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent = `Uploading ${completed}/${total} files...`;
    }
    
    if (completed === total) {
      if (failed === 0) {
        this.elements.uploadStatus.textContent = "Upload complete!";
        UIUtils.showNotification("Files uploaded successfully", "success");
      } else {
        this.elements.uploadStatus.textContent = `Upload completed with ${failed} error(s)`;
        UIUtils.showNotification(`${failed} file(s) failed to upload`, "error");
      }
      
      // Refresh file list & stats
      if (projectManager.currentProject) {
        projectManager.loadProjectFiles(projectManager.currentProject.id);
        projectManager.loadProjectStats(projectManager.currentProject.id);
      }
      
      // Reset input
      document.getElementById("fileInput").value = "";
      
      // Hide progress after a short delay
      setTimeout(() => {
        if (this.elements.uploadProgress) {
          this.elements.uploadProgress.classList.add("hidden");
        }
      }, 3000);
    }
  }
  
  viewArtifact(artifact) {
    ModalManager.createViewModal(
      artifact.name || "Artifact Content",
      `<pre class="whitespace-pre-wrap">${UIUtils.escapeHtml(artifact.content)}</pre>`
    );
  }
  
  confirmDeleteFile(file) {
    ModalManager.confirmAction({
      title: "Delete File",
      message: `Are you sure you want to delete the file "${file.filename}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        const projectId = projectManager.currentProject?.id;
        if (!projectId) return;
        
        projectManager.deleteFile(projectId, file.id)
          .then(() => {
            UIUtils.showNotification("File deleted", "success");
            projectManager.loadProjectFiles(projectId);
            projectManager.loadProjectStats(projectId);
          })
          .catch(err => {
            console.error("Error deleting file:", err);
            UIUtils.showNotification("Failed to delete file", "error");
          });
      }
    });
  }
  
  confirmDeleteArtifact(artifact) {
    ModalManager.confirmAction({
      title: "Delete Artifact",
      message: `Are you sure you want to delete the artifact "${artifact.name || artifact.id}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        const projectId = projectManager.currentProject?.id;
        if (!projectId) return;
        
        projectManager.deleteArtifact(projectId, artifact.id)
          .then(() => {
            UIUtils.showNotification("Artifact deleted", "success");
            projectManager.loadProjectArtifacts(projectId);
            projectManager.loadProjectStats(projectId);
          })
          .catch(err => {
            console.error("Error deleting artifact:", err);
            UIUtils.showNotification("Failed to delete artifact", "error");
          });
      }
    });
  }
  
  togglePin() {
    const project = projectManager.currentProject;
    if (!project) return;
    
    projectManager.togglePinProject(project.id)
      .then(res => {
        UIUtils.showNotification(
          res.data?.pinned ? "Project pinned" : "Project unpinned",
          "success"
        );
        projectManager.loadProjectDetails(project.id);
      })
      .catch(err => {
        console.error("Error toggling pin status:", err);
        UIUtils.showNotification("Failed to update project", "error");
      });
  }
  
  toggleArchive() {
    const project = projectManager.currentProject;
    if (!project) return;
    
    projectManager.toggleArchiveProject(project.id)
      .then(res => {
        UIUtils.showNotification(
          res.data?.archived ? "Project archived" : "Project unarchived",
          "success"
        );
        projectManager.loadProjectDetails(project.id);
      })
      .catch(err => {
        console.error("Error toggling archive status:", err);
        UIUtils.showNotification("Failed to update project", "error");
      });
  }
  
  startNewConversation() {
    const project = projectManager.currentProject;
    if (!project) return;
    
    projectManager.createConversation(project.id)
      .then(res => {
        const conversationId = res.data?.id;
        if (conversationId) {
          window.location.href = `/?chatId=${conversationId}`;
        } else {
          UIUtils.showNotification("Conversation created, but no ID returned", "warning");
        }
      })
      .catch(err => {
        console.error("Error creating conversation:", err);
        UIUtils.showNotification("Failed to create conversation", "error");
      });
  }
}

// Modal Manager
class ModalManager {
  static modals = {};
  
  static showModal(id) {
    document.getElementById(id)?.classList.remove("hidden");
  }
  
  static hideModal(id) {
    document.getElementById(id)?.classList.add("hidden");
  }
  
  static showProjectForm(project = null) {
    const formTitle = document.getElementById("projectFormTitle");
    const idInput = document.getElementById("projectIdInput");
    const nameInput = document.getElementById("projectNameInput");
    const descInput = document.getElementById("projectDescInput");
    const goalsInput = document.getElementById("projectGoalsInput");
    const maxTokensInput = document.getElementById("projectMaxTokensInput");
    
    if (formTitle) formTitle.textContent = project ? "Edit Project" : "Create Project";
    if (idInput) idInput.value = project ? project.id : "";
    if (nameInput) nameInput.value = project ? project.name || "" : "";
    if (descInput) descInput.value = project ? project.description || "" : "";
    if (goalsInput) goalsInput.value = project ? project.goals || "" : "";
    if (maxTokensInput) maxTokensInput.value = project ? project.max_tokens || 200000 : 200000;
    
    this.showModal("projectFormModal");
  }
  
  static hideProjectForm() {
    this.hideModal("projectFormModal");
  }
  
  static confirmAction(options) {
    const {
      title = "Confirm Action",
      message = "Are you sure you want to proceed with this action?",
      confirmText = "Confirm",
      cancelText = "Cancel",
      confirmClass = "bg-blue-600",
      onConfirm = () => {},
      onCancel = () => {}
    } = options;
    
    // Find or create modal
    let modal = document.getElementById("confirmActionModal");
    
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "confirmActionModal";
      modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center hidden";
      
      const modalInner = document.createElement("div");
      modalInner.className = "bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full";
      
      const header = document.createElement("div");
      header.className = "flex justify-between items-center mb-4";
      
      const heading = document.createElement("h3");
      heading.id = "confirmActionTitle";
      heading.className = "text-xl font-semibold";
      
      const closeBtn = document.createElement("button");
      closeBtn.className = "text-gray-500 hover:text-gray-700";
      closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
          viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
      
      header.appendChild(heading);
      header.appendChild(closeBtn);
      
      const content = document.createElement("div");
      content.id = "confirmActionContent";
      content.className = "mb-6";
      
      const actions = document.createElement("div");
      actions.className = "flex justify-end space-x-3";
      
      const cancelBtn = document.createElement("button");
      cancelBtn.id = "confirmCancelBtn";
      cancelBtn.className = "px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-100";
      
      const confirmBtn = document.createElement("button");
      confirmBtn.id = "confirmActionBtn";
      confirmBtn.className = `px-4 py-2 rounded text-white hover:bg-opacity-90 ${confirmClass}`;
      
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      
      modalInner.appendChild(header);
      modalInner.appendChild(content);
      modalInner.appendChild(actions);
      
      modal.appendChild(modalInner);
      document.body.appendChild(modal);
    }
    
    // Update content
    const titleEl = document.getElementById("confirmActionTitle");
    const contentEl = document.getElementById("confirmActionContent");
    const confirmBtnEl = document.getElementById("confirmActionBtn");
    const cancelBtnEl = document.getElementById("confirmCancelBtn");
    const closeBtnEl = modal.querySelector("svg").parentElement;
    
    if (titleEl) titleEl.textContent = title;
    if (contentEl) contentEl.textContent = message;
    if (confirmBtnEl) {
      confirmBtnEl.textContent = confirmText;
      confirmBtnEl.className = `px-4 py-2 rounded text-white hover:bg-opacity-90 ${confirmClass}`;
    }
    if (cancelBtnEl) cancelBtnEl.textContent = cancelText;
    
    // Update handlers
    const handleConfirm = () => {
      onConfirm();
      modal.classList.add("hidden");
    };
    
    const handleCancel = () => {
      onCancel();
      modal.classList.add("hidden");
    };
    
    // Remove old handlers
    const oldConfirmBtn = document.getElementById("confirmActionBtn");
    const oldCancelBtn = document.getElementById("confirmCancelBtn");
    
    if (oldConfirmBtn) {
      const newConfirmBtn = oldConfirmBtn.cloneNode(true);
      oldConfirmBtn.parentNode.replaceChild(newConfirmBtn, oldConfirmBtn);
      newConfirmBtn.addEventListener("click", handleConfirm);
    }
    
    if (oldCancelBtn) {
      const newCancelBtn = oldCancelBtn.cloneNode(true);
      oldCancelBtn.parentNode.replaceChild(newCancelBtn, oldCancelBtn);
      newCancelBtn.addEventListener("click", handleCancel);
    }
    
    if (closeBtnEl) {
      closeBtnEl.onclick = handleCancel;
    }
    
    // Show modal
    modal.classList.remove("hidden");
  }
  
  static createViewModal(title, content) {
    const modalId = "contentViewModal";
    let modal = document.getElementById(modalId);
    
    if (!modal) {
      modal = document.createElement("div");
      modal.id = modalId;
      modal.className = "fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center hidden";
      
      const modalInner = document.createElement("div");
      modalInner.className = "bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto";
      
      const header = document.createElement("div");
      header.className = "flex justify-between items-center mb-4";
      
      const heading = document.createElement("h3");
      heading.id = "contentViewModalTitle";
      heading.className = "text-xl font-semibold";
      header.appendChild(heading);
      
      const closeBtn = document.createElement("button");
      closeBtn.id = "closeContentViewModalBtn";
      closeBtn.className = "text-gray-500 hover:text-gray-700";
      closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
          viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
           d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
      closeBtn.addEventListener("click", () => this.hideViewModal());
      header.appendChild(closeBtn);
      
      const contentWrapper = document.createElement("div");
      contentWrapper.id = "contentViewModalContent";
      
      modalInner.appendChild(header);
      modalInner.appendChild(contentWrapper);
      modal.appendChild(modalInner);
      document.body.appendChild(modal);
    }
    
    // Update content
    const titleEl = document.getElementById("contentViewModalTitle");
    const contentEl = document.getElementById("contentViewModalContent");
    
    if (titleEl) titleEl.textContent = title;
    if (contentEl) contentEl.innerHTML = content || "";
    
    // Show modal
    modal.classList.remove("hidden");
    return { modal, modalContent: contentEl, heading: titleEl };
  }
  
  static hideViewModal() {
    const modal = document.getElementById("contentViewModal");
    if (modal) modal.classList.add("hidden");
  }
}

// Utility functions
const UIUtils = {
  // DOM utilities
  createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.entries(value).forEach(([prop, val]) => {
          element.style[prop] = val;
        });
      } else if (key === 'innerHTML') {
        element.innerHTML = value;
      } else if (key === 'textContent') {
        element.textContent = value;
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventType = key.substring(2).toLowerCase();
        element.addEventListener(eventType, value);
      } else {
        element.setAttribute(key, value);
      }
    });
    
    // Add children
    if (typeof children === 'string') {
      element.textContent = children;
    } else if (Array.isArray(children)) {
      children.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
          element.appendChild(child);
        }
      });
    }
    
    return element;
  },
  
  // Format utilities
  formatNumber(num) {
    if (!num) return "0";
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  },
  
  formatDate(dateString, includeTime = false) {
    if (!dateString) return "";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    
    const opts = { year: "numeric", month: "short", day: "numeric" };
    if (includeTime) {
      opts.hour = "2-digit";
      opts.minute = "2-digit";
    }
    return d.toLocaleDateString(undefined, opts);
  },
  
  formatBytes(bytes) {
    if (!bytes) return "0 Bytes";
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },
  
  fileIcon(fileType) {
    // Basic mapping
    const map = {
      "txt": "📄", "pdf": "📑", "doc": "📝", "docx": "📝",
      "xlsx": "📊", "xls": "📊", "csv": "📊",
      "jpg": "🖼️", "jpeg": "🖼️", "png": "🖼️", "gif": "🖼️",
      "mp3": "🎵", "mp4": "🎬", "zip": "📦",
      "json": "📋", "md": "📋"
    };
    return map[fileType] || "📄";
  },
  
  artifactIcon(contentType) {
    const map = {
      "code": "💻", "document": "📄", "image": "🖼️", "audio": "🎵", "video": "🎬"
    };
    return map[contentType] || "📄";
  },
  
  escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },
  
  // Notification
  showNotification(message, type = "info") {
    if (typeof window.showNotification === "function") {
      window.showNotification(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  }
};