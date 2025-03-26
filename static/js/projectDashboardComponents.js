import { AnimationUtils, ModalManager } from './projectDashboardUtils.js';

// Fallback UIUtils implementation if import fails
let UIUtils = {
  toggleVisibility(elementOrId, isVisible) {
    const el = typeof elementOrId === 'string'
      ? document.getElementById(elementOrId)
      : elementOrId;
    if (el) {
      el.classList.toggle('hidden', !isVisible);
    }
  },
  
  createElement(type, attributes = {}, children = []) {
    const element = document.createElement(type);
    
    // Set attributes
    if (attributes.class || attributes.className) {
      element.className = attributes.class || attributes.className;
    }
    if (attributes.style && typeof attributes.style === 'object') {
      Object.assign(element.style, attributes.style);
    }
    if (attributes.textContent) {
      element.textContent = attributes.textContent;
    }
    if (attributes.innerHTML) {
      element.innerHTML = attributes.innerHTML;
    }
    
    return element;
  },
  
  formatNumber(num) {
    return num?.toLocaleString() || '0';
  },
  
  formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString();
  },
  
  formatBytes(bytes) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },
  
  fileIcon(fileType) {
    return '📄'; // Default file icon
  },
  
  showNotification(message, type = 'info') {
    console.log(`[${type}] ${message}`);
  }
};

// Try to import the real UIUtils if available
try {
  const importedUtils = await import('./projectDashboardUtils.js');
  if (importedUtils.UIUtils) {
    UIUtils = importedUtils.UIUtils;
    console.debug('Using imported UIUtils');
  }
} catch (err) {
  console.warn('Failed to import UIUtils, using fallback implementation:', err);
}

/**
 * Project List Component - Handles the project list view
 */
class ProjectListComponent {
  constructor(options) {
    this.elementId = options.elementId;
    this.element = document.getElementById(this.elementId);
    this.onViewProject = options.onViewProject;
    this.messageEl = document.getElementById("noProjectsMessage");
    
    // Debug check and fallback container creation
    if (!this.element) {
      console.error(`ProjectListComponent: Element with ID '${this.elementId}' not found - creating fallback`);
      this.element = document.createElement('div');
      this.element.id = this.elementId;
      this.element.className = 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3';
      const listView = document.getElementById('projectListView');
      if (listView) {
        listView.appendChild(this.element);
      }
    }
    
    this.bindFilterEvents();
  }

  show() {
    const listView = document.getElementById('projectListView');
    const detailsView = document.getElementById('projectDetailsView');
    
    if (listView) listView.classList.remove('hidden');
    if (detailsView) detailsView.classList.add('hidden');
    if (this.element) this.element.style.display = 'grid';
  }

  hide() {
    UIUtils.toggleVisibility("projectListView", false);
  }

  renderProjects(eventOrProjects) {
    try {
      const projects = Array.isArray(eventOrProjects)
        ? eventOrProjects
        : eventOrProjects?.detail?.data?.projects || [];
        
      if (!this.element) {
        console.error('Project list container element not found');
        return;
      }

      this.element.innerHTML = "";

      if (projects.error) {
        const errorMsg = document.createElement('div');
        errorMsg.className = 'text-red-500 text-center py-8 col-span-3';
        errorMsg.textContent = 'Error loading projects';
        this.element.appendChild(errorMsg);
        if (this.messageEl) this.messageEl.classList.add("hidden");
        return;
      }

      if (projects.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'text-gray-500 text-center py-8 col-span-3';
        emptyMsg.textContent = 'No projects available';
        this.element.appendChild(emptyMsg);
        if (this.messageEl) this.messageEl.classList.add("hidden");
        return;
      }

      if (this.messageEl) this.messageEl.classList.add("hidden");
      
      projects.forEach(project => {
        try {
          const card = this.createProjectCard(project);
          if (card) {
            this.element.appendChild(card);
          }
        } catch (err) {
          console.error('Error rendering project card:', err, project);
        }
      });
    } catch (err) {
      console.error('Error in renderProjects:', err);
      const errorMsg = document.createElement('div');
      errorMsg.className = 'text-red-500 text-center py-8 col-span-3';
      errorMsg.textContent = 'Error displaying projects';
      this.element.appendChild(errorMsg);
    }
  }

  createProjectCard(project) {
    const usage = project.token_usage || 0;
    const maxTokens = project.max_tokens || 0;
    const usagePct = maxTokens > 0 ? Math.min(100, (usage / maxTokens) * 100).toFixed(1) : 0;
    
    let card;
    if (UIUtils && UIUtils.createElement) {
      card = UIUtils.createElement("div", {
        className: `bg-white dark:bg-gray-700 rounded-lg shadow-md p-4
          border-2 ${project.pinned ? "border-yellow-400" : "border-blue-400"}
          ${project.archived ? "opacity-75" : ""}
          w-full min-w-[300px] min-h-[200px] mb-4
          hover:shadow-lg transition-all duration-200`,
        style: { display: 'flex', flexDirection: 'column' }
      });
    } else {
      // Fallback implementation
      card = document.createElement('div');
      card.className = `bg-white dark:bg-gray-700 rounded-lg shadow-md p-4
        border-2 ${project.pinned ? "border-yellow-400" : "border-blue-400"}
        ${project.archived ? "opacity-75" : ""}
        w-full min-w-[300px] min-h-[200px] mb-4
        hover:shadow-lg transition-all duration-200`;
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
    }
    
    // Header
    const header = UIUtils.createElement("div", { className: "flex justify-between mb-2" });
    const title = UIUtils.createElement("h3", { 
      className: "font-semibold text-md", 
      textContent: project.name 
    });
    const badges = UIUtils.createElement("div", { 
      className: "text-xs text-gray-500",
      textContent: `${project.pinned ? "📌 " : ""}${project.archived ? "🗃️ " : ""}`
    });
    
    header.appendChild(title);
    header.appendChild(badges);
    card.appendChild(header);
    
    // Description
    const desc = UIUtils.createElement("p", {
      className: "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2",
      textContent: project.description || "No description"
    });
    card.appendChild(desc);
    
    // Token usage
    const tokenWrapper = UIUtils.createElement("div", { className: "mb-2" });
    const tokenHeader = UIUtils.createElement("div", { 
      className: "flex justify-between mb-1 text-xs",
      innerHTML: `
        <span>Tokens: ${UIUtils.formatNumber(usage)} / ${UIUtils.formatNumber(maxTokens)}</span>
        <span>${usagePct}%</span>
      `
    });
    
    const progressOuter = UIUtils.createElement("div", { className: "w-full bg-gray-200 rounded-full h-1.5" });
    const progressInner = UIUtils.createElement("div", { 
      className: "bg-blue-600 h-1.5 rounded-full",
      style: { width: `${usagePct}%` }
    });
    
    progressOuter.appendChild(progressInner);
    tokenWrapper.appendChild(tokenHeader);
    tokenWrapper.appendChild(progressOuter);
    card.appendChild(tokenWrapper);
    
    // Footer
    const footer = UIUtils.createElement("div", { className: "flex justify-between mt-3" });
    const createdInfo = UIUtils.createElement("div", {
      className: "text-xs text-gray-500",
      textContent: `Created ${UIUtils.formatDate(project.created_at)}`
    });
    
    const actions = UIUtils.createElement("div", { className: "flex space-x-1" });
    
    // View button
    const viewBtn = UIUtils.createElement("button", {
      className: "p-1 text-blue-600 hover:text-blue-800 view-project-btn",
      innerHTML: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
                   -1.274 4.057-5.064 7-9.542 7
                   -4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      `,
      onclick: () => this.onViewProject(project.id)
    });
    
    // Delete button
    const deleteBtn = UIUtils.createElement("button", {
      className: "p-1 text-red-600 hover:text-red-800 delete-project-btn",
      innerHTML: `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                   a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6
                   m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
      message: `Are you sure you want to delete "${project.name}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        window.projectManager?.deleteProject(project.id)
          .then(() => {
            UIUtils.showNotification("Project deleted", "success");
            window.projectManager?.loadProjects();
          })
          .catch(err => {
            console.error("Error deleting project:", err);
            UIUtils.showNotification("Failed to delete project", "error");
          });
      }
    });
  }

  bindFilterEvents() {
    const filterButtons = document.querySelectorAll('.project-filter-btn');
    filterButtons.forEach(button => {
      button.addEventListener('click', () => {
        filterButtons.forEach(btn => {
          btn.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
          btn.classList.add('text-gray-600');
        });
        button.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
        button.classList.remove('text-gray-600');
        
        const filter = button.dataset.filter;
        window.projectManager?.loadProjects(filter);
      });
    });
  }
}

/**
 * Project Details Component - Handles the project details view
 */
class ProjectDetailsComponent {
  constructor(options = {}) {
    this.onBack = options.onBack;
    this.state = { currentProject: null };
    this.fileUploadStatus = { completed: 0, failed: 0, total: 0 };
    
    this.elements = {
      container: document.getElementById("projectDetailsView"),
      title: document.getElementById("projectTitle"),
      description: document.getElementById("projectDescription"),
      tokenUsage: document.getElementById("tokenUsage"),
      maxTokens: document.getElementById("maxTokens"),
      tokenPercentage: document.getElementById("tokenPercentage"),
      tokenProgressBar: document.getElementById("tokenProgressBar"),
      filesList: document.getElementById("projectFilesList"),
      conversationsList: document.getElementById("projectConversationsList"),
      artifactsList: document.getElementById("projectArtifactsList"),
      uploadProgress: document.getElementById("filesUploadProgress"),
      progressBar: document.getElementById("fileProgressBar"),
      uploadStatus: document.getElementById("uploadStatus"),
      pinBtn: document.getElementById("pinProjectBtn"),
      backBtn: document.getElementById("backToProjectsBtn"),
    };
    
    this.bindEvents();
    this.setupDragDropHandlers();
  }

  show() {
    UIUtils.toggleVisibility(this.elements.container, true);
  }

  hide() {
    if (UIUtils && UIUtils.toggleVisibility) {
      UIUtils.toggleVisibility(this.elements.container, false);
    } else {
      // Fallback implementation
      if (this.elements.container) {
        this.elements.container.classList.add('hidden');
      }
    }
  }

  renderProject(project) {
    this.state.currentProject = project;
    
    if (this.elements.title) {
      this.elements.title.textContent = project.name;
    }
    if (this.elements.description) {
      this.elements.description.textContent = project.description || "No description provided.";
    }
    
    if (this.elements.pinBtn) {
      const svg = this.elements.pinBtn.querySelector("svg");
      if (svg) svg.setAttribute("fill", project.pinned ? "currentColor" : "none");
      this.elements.pinBtn.classList.toggle("text-yellow-600", project.pinned);
    }
  }

  renderStats(stats) {
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
      AnimationUtils.animateProgress(
        this.elements.tokenProgressBar, 
        parseFloat(this.elements.tokenProgressBar.style.width || "0"), 
        pct
      );
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
      const infoDiv = UIUtils.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: UIUtils.fileIcon(file.file_type)
      }));
      
      const detailDiv = UIUtils.createElement("div", { className: "flex flex-col" });
      detailDiv.appendChild(UIUtils.createElement("div", {
        className: "font-medium",
        textContent: file.filename
      }));
      detailDiv.appendChild(UIUtils.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: `${UIUtils.formatBytes(file.file_size)} · ${UIUtils.formatDate(file.created_at)}`
      }));
      
      infoDiv.appendChild(detailDiv);
      item.appendChild(infoDiv);
      
      // Actions section
      const actions = UIUtils.createElement("div", { className: "flex space-x-2" });
      actions.appendChild(UIUtils.createElement("button", {
        className: "text-red-600 hover:text-red-800",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                     a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
                     a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        `,
        onclick: () => this.confirmDeleteFile(file)
      }));
      
      item.appendChild(actions);
      this.elements.filesList.appendChild(item);
    });
  }

  renderConversations(conversations) {
    if (!this.elements.conversationsList) return;
    
    if (!conversations || conversations.length === 0) {
      this.elements.conversationsList.innerHTML = `
        <div class="text-gray-500 text-center py-8">No conversations yet.</div>
      `;
      return;
    }
    
    this.elements.conversationsList.innerHTML = "";
    
    conversations.forEach(conversation => {
      const convoEl = UIUtils.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer",
        onclick: () => {
          const chatContainer = document.getElementById('projectChatContainer');
          if (chatContainer) chatContainer.classList.remove('hidden');
          if (window.projectChatInterface) {
            window.projectChatInterface.loadConversation(conversation.id);
          }
        }
      });
      
      const infoDiv = UIUtils.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: "💬"
      }));
      
      const textDiv = UIUtils.createElement("div");
      textDiv.appendChild(UIUtils.createElement("div", {
        className: "font-medium",
        textContent: conversation.title || "Untitled conversation"
      }));
      textDiv.appendChild(UIUtils.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: UIUtils.formatDate(conversation.created_at)
      }));
      
      infoDiv.appendChild(textDiv);
      convoEl.appendChild(infoDiv);
      this.elements.conversationsList.appendChild(convoEl);
    });
  }

  bindEvents() {
    if (this.elements.backBtn) {
      this.elements.backBtn.addEventListener("click", () => {
        if (this.onBack) this.onBack();
      });
    }
    
    if (this.elements.pinBtn) {
      this.elements.pinBtn.addEventListener("click", () => this.togglePin());
    }

    document.querySelectorAll('.project-tab-btn').forEach(tabBtn => {
      tabBtn.addEventListener('click', () => {
        const tabName = tabBtn.dataset.tab;
        this.switchTab(tabName);
      });
    });
  }

  switchTab(tabName) {
    document.querySelectorAll('.project-tab-content').forEach(tabContent => {
      tabContent.classList.add('hidden');
    });

    const activeTab = document.getElementById(`${tabName}Tab`);
    if (activeTab) activeTab.classList.remove('hidden');

    document.querySelectorAll('.project-tab-btn').forEach(tabBtn => {
      tabBtn.classList.remove('border-blue-600', 'text-blue-600');
      tabBtn.classList.add('text-gray-500', 'hover:text-gray-700');
    });

    const activeTabBtn = document.querySelector(`.project-tab-btn[data-tab="${tabName}"]`);
    if (activeTabBtn) {
      activeTabBtn.classList.add('border-blue-600', 'text-blue-600');
      activeTabBtn.classList.remove('text-gray-500', 'hover:text-gray-700');
    }
  }

  setupDragDropHandlers() {
    const dragZone = document.getElementById('dragDropZone');
    if (!dragZone) return;
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
      dragZone.addEventListener(event, e => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    
    ['dragenter', 'dragover'].forEach(event => {
      dragZone.addEventListener(event, () => {
        dragZone.classList.add('bg-gray-100', 'dark:bg-gray-700', 'border-blue-400');
      });
    });
    
    ['dragleave', 'drop'].forEach(event => {
      dragZone.addEventListener(event, () => {
        dragZone.classList.remove('bg-gray-100', 'dark:bg-gray-700', 'border-blue-400');
      });
    });
    
    dragZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      const projectId = this.state.currentProject?.id;
      if (projectId && files.length > 0) {
        this.uploadFiles(projectId, files);
      }
    });
  }

  uploadFiles(projectId, files) {
    this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
    
    if (this.elements.uploadProgress) {
      this.elements.uploadProgress.classList.remove("hidden");
      this.elements.progressBar.style.width = "0%";
      this.elements.uploadStatus.textContent = `Uploading 0/${files.length} files...`;
    }
    
    Array.from(files).forEach(file => {
      window.projectManager?.uploadFile(projectId, file)
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
      AnimationUtils.animateProgress(
        this.elements.progressBar,
        parseFloat(this.elements.progressBar.style.width || "0"),
        percentage
      );
    }
    
    if (this.elements.uploadStatus) {
      this.elements.uploadStatus.textContent = 
        `Uploading ${completed}/${total} files${failed > 0 ? ` (${failed} failed)` : ''}`;
    }
    
    if (completed === total) {
      setTimeout(() => {
        if (this.elements.uploadProgress) {
          this.elements.uploadProgress.classList.add("hidden");
        }
        
        if (failed === 0) {
          UIUtils.showNotification("Files uploaded successfully", "success");
        } else {
          UIUtils.showNotification(`${failed} file(s) failed to upload`, "error");
        }
        
        if (window.projectManager?.currentProject) {
          const pid = window.projectManager.currentProject.id;
          window.projectManager.loadProjectFiles(pid);
          window.projectManager.loadProjectStats(pid);
        }
      }, 1000);
    }
  }

  confirmDeleteFile(file) {
    ModalManager.confirmAction({
      title: "Delete File",
      message: `Delete "${file.filename}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        const projectId = this.state.currentProject?.id;
        if (!projectId) return;
        
        window.projectManager?.deleteFile(projectId, file.id)
          .then(() => {
            UIUtils.showNotification("File deleted", "success");
            window.projectManager.loadProjectFiles(projectId);
            window.projectManager.loadProjectStats(projectId);
          })
          .catch(err => {
            console.error("Error deleting file:", err);
            UIUtils.showNotification("Failed to delete file", "error");
          });
      }
    });
  }

  togglePin() {
    const project = this.state.currentProject;
    if (!project) return;
    
    window.projectManager?.togglePinProject(project.id)
      .then(() => {
        UIUtils.showNotification(
          project.pinned ? "Project unpinned" : "Project pinned",
          "success"
        );
        window.projectManager.loadProjectDetails(project.id);
      })
      .catch(err => {
        console.error("Error toggling pin:", err);
        UIUtils.showNotification("Failed to update project", "error");
      });
  }
}

/**
 * Knowledge Base Component - Handles knowledge base functionality
 */
class KnowledgeBaseComponent {
  constructor() {
    this.elements = {
      container: document.getElementById("knowledgeTab"),
      searchInput: document.getElementById("knowledgeSearchInput"),
      searchButton: document.getElementById("runKnowledgeSearchBtn"),
      resultsContainer: document.getElementById("knowledgeResultsList"),
      resultsSection: document.getElementById("knowledgeSearchResults"),
      noResultsSection: document.getElementById("knowledgeNoResults")
    };
    
    this.bindEvents();
  }
  
  bindEvents() {
    this.elements.searchButton?.addEventListener("click", () => {
      const query = this.elements.searchInput?.value?.trim();
      if (query) this.searchKnowledgeBase(query);
    });
    
    document.getElementById("knowledgeBaseEnabled")?.addEventListener("change", (e) => {
      this.toggleKnowledgeBase(e.target.checked);
    });
    
    this.elements.searchInput?.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const query = e.target.value.trim();
        if (query) this.searchKnowledgeBase(query);
      }
    });
  }
  
  loadData(projectId) {
    if (!projectId) return;
    
    window.apiRequest(`/api/projects/${projectId}/knowledge-base`)
      .then(response => {
        this.renderKnowledgeBaseInfo(response.data);
      })
      .catch(err => {
        console.error("Error loading knowledge base:", err);
      });
  }
  
  searchKnowledgeBase(query) {
    const projectId = window.projectManager?.currentProject?.id;
    if (!projectId) {
      UIUtils.showNotification("No project selected", "error");
      return;
    }
    
    this.showSearchLoading();
    
    window.apiRequest(`/api/projects/${projectId}/knowledge-base/search`, "POST", {
      query,
      top_k: 5
    })
      .then(response => {
        this.renderSearchResults(response.data?.results || []);
      })
      .catch(err => {
        console.error("Error searching knowledge base:", err);
        UIUtils.showNotification("Search failed", "error");
        this.showNoResults();
      });
  }
  
  toggleKnowledgeBase(enabled) {
    const projectId = window.projectManager?.currentProject?.id;
    if (!projectId) return;
    
    UIUtils.showNotification(
      `${enabled ? "Enabling" : "Disabling"} knowledge base...`,
      "info"
    );
    
    window.apiRequest(`/api/projects/${projectId}/knowledge-base/toggle`, "POST", {
      enabled
     })
      .then(() => {
        UIUtils.showNotification(
          `Knowledge base ${enabled ? "enabled" : "disabled"}`,
          "success"
        );
        window.projectManager?.loadProjectStats(projectId);
      })
      .catch(err => {
        console.error("Error toggling knowledge base:", err);
        UIUtils.showNotification("Operation failed", "error");
        document.getElementById("knowledgeBaseEnabled").checked = !enabled;
      });
  }
  
  showSearchLoading() {
    if (this.elements.resultsSection) this.elements.resultsSection.classList.add("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.add("hidden");
    
    if (this.elements.resultsContainer) {
      this.elements.resultsContainer.innerHTML = `
        <div class="flex justify-center items-center p-4">
          <div class="spinner mr-2 w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span>Searching...</span>
        </div>
      `;
      this.elements.resultsSection.classList.remove("hidden");
    }
  }
  
  showNoResults() {
    if (this.elements.resultsSection) this.elements.resultsSection.classList.add("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.remove("hidden");
  }
  
  renderSearchResults(results) {
    if (!this.elements.resultsContainer) return;
    
    if (!results || results.length === 0) {
      this.showNoResults();
      return;
    }
    
    this.elements.resultsContainer.innerHTML = "";
    this.elements.resultsSection.classList.remove("hidden");
    this.elements.noResultsSection.classList.add("hidden");
    
    results.forEach(result => {
      const item = UIUtils.createElement("div", {
        className: "bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-3 hover:shadow-md transition-shadow"
      });
      
      // Header with file info and match score
      const header = UIUtils.createElement("div", {
        className: "flex justify-between items-center border-b border-gray-200 pb-2 mb-2"
      });
      
      const fileInfo = UIUtils.createElement("div", { className: "flex items-center" });
      fileInfo.appendChild(UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: UIUtils.fileIcon(result.file_type || "txt")
      }));
      fileInfo.appendChild(UIUtils.createElement("div", {
        className: "font-medium",
        textContent: result.filename || result.file_path || "Unknown source"
      }));
      
      header.appendChild(fileInfo);
      header.appendChild(UIUtils.createElement("div", {
        className: "text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded",
        textContent: `${Math.round(result.score * 100)}% match`
      }));
      
      item.appendChild(header);
      
      // Content snippet
      const snippet = UIUtils.createElement("div", {
        className: "text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-3"
      });
      
      const textContent = result.text || result.content || "";
      snippet.textContent = textContent.length > 200 
        ? textContent.substring(0, 200) + "..." 
        : textContent;
      
      item.appendChild(snippet);
      this.elements.resultsContainer.appendChild(item);
    });
  }
  
  renderKnowledgeBaseInfo(kb) {
    const activeContainer = document.getElementById("knowledgeBaseActive");
    const inactiveContainer = document.getElementById("knowledgeBaseInactive");
    
    if (!activeContainer || !inactiveContainer) return;
    
    if (kb) {
      document.getElementById("knowledgeBaseName").textContent = kb.name || "Project Knowledge Base";
      document.getElementById("knowledgeBaseEnabled").checked = kb.is_active;
      
      // Update stats
      if (kb.stats) {
        const fileCountEl = document.getElementById("knowledgeFileCount");
        if (fileCountEl) fileCountEl.textContent = kb.stats.file_count || 0;
        const totalSizeEl = document.getElementById("knowledgeFileSize");
        if (totalSizeEl) totalSizeEl.textContent = UIUtils.formatBytes(kb.stats.total_size || 0);
      }
      
      activeContainer.classList.remove("hidden");
      inactiveContainer.classList.add("hidden");
    } else {
      activeContainer.classList.add("hidden");
      inactiveContainer.classList.remove("hidden");
    }
  }
}

// Export all components
export { ProjectListComponent, ProjectDetailsComponent, KnowledgeBaseComponent };


