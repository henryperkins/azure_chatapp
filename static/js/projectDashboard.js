/**
 * Project Management Consolidated
 * Combines functionality from:
 * - projectDashboard.js
 * - projectEnhancement.js
 * - Components (ProjectList, ProjectDetails, KnowledgeBase)
 * - Utils (Animation, Modal, Formatting)
 */

// =====================================================================
// UTILITIES
// =====================================================================

/**
 * Animation utilities for counters and progress bars
 */
const AnimationUtils = {
  /**
   * Animate a counter from start to end value
   */
  animateCounter(element, start, end, duration = 500) {
    if (!element) return;
    
    const startTime = performance.now();
    const update = (timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = Math.floor(progress * (end - start) + start);
      
      element.textContent = value.toLocaleString();
      
      if (progress < 1) requestAnimationFrame(update);
    };
    
    requestAnimationFrame(update);
  },
  
  /**
   * Animate a progress bar
   */
  animateProgress(element, start, end, duration = 500) {
    if (!element) return;
    
    const startTime = performance.now();
    const update = (timestamp) => {
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = start + (progress * (end - start));
      
      element.style.width = `${value}%`;
      
      if (progress < 1) requestAnimationFrame(update);
    };
    
    requestAnimationFrame(update);
  }
};

/**
 * UI utilities for common operations
 */
const UIUtils = {
  /**
   * Show notification
   */
  showNotification(message, type = "info") {
    if (window.showNotification) {
      window.showNotification(message, type);
    } else {
      console.log(`[${type}] ${message}`);
    }
  },
  
  /**
   * Format file size
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },
  
  /**
   * Format date
   */
  formatDate(date, includeTime = false) {
    if (!date) return '';
    
    const d = new Date(date);
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };
    
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    
    return d.toLocaleDateString(undefined, options);
  },
  
  /**
   * Format large numbers
   */
  formatNumber(num) {
    return num.toLocaleString();
  },
  
  /**
   * Create DOM element
   */
  createElement(type, attributes = {}, children = []) {
    const element = document.createElement(type);
    
    // Set attributes
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'class' || key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.entries(value).forEach(([prop, val]) => {
          element.style[prop] = val;
        });
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
  
  /**
   * Get file icon based on file type
   */
  fileIcon(fileType) {
    const icons = {
      pdf: '📄',
      doc: '📝',
      docx: '📝',
      txt: '📄',
      csv: '📊',
      json: '📊',
      jpg: '🖼️',
      jpeg: '🖼️',
      png: '🖼️',
      default: '📄'
    };
    
    return icons[fileType?.toLowerCase()] || icons.default;
  },
  
  /**
   * Get artifact icon based on content type
   */
  artifactIcon(contentType) {
    const icons = {
      code: '📝',
      document: '📄',
      image: '🖼️',
      default: '📦'
    };
    
    return icons[contentType?.toLowerCase()] || icons.default;
  },
  
  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m];
    });
  }
};

/**
 * Modal Manager for handling modal displays
 */
const ModalManager = {
  registry: {
    project: "projectFormModal",
    instructions: "instructionsModal",
    confirm: "confirmActionModal",
    content: "contentViewModal",
    knowledge: "knowledgeBaseSettingsModal"
  },
  
  /**
   * Show a modal by ID
   */
  show(id, data = {}) {
    const modalId = this.registry[id] || id;
    const modal = document.getElementById(modalId);
    if (!modal) return null;
    
    // Handle specific modal types
    if (id === "project" && data.project) {
      this._populateProjectForm(data.project);
    } else if (id === "content" && data.content) {
      this._setContentModalData(data.title, data.content);
    }
    
    modal.classList.remove("hidden");
    return modal;
  },
  
  /**
   * Hide a modal by ID
   */
  hide(id) {
    const modalId = this.registry[id] || id;
    document.getElementById(modalId)?.classList.add("hidden");
  },
  
  /**
   * Show project form
   */
  showProjectForm(project = null) {
    this._populateProjectForm(project);
    this.show("project");
  },
  
  /**
   * Show a confirmation dialog
   */
  confirmAction(options) {
    const {
      title = "Confirm Action",
      message = "Are you sure you want to proceed with this action?",
      confirmText = "Confirm",
      cancelText = "Cancel",
      confirmClass = "bg-blue-600",
      onConfirm = () => {},
      onCancel = () => {}
    } = options;
    
    const modal = document.getElementById(this.registry.confirm);
    if (!modal) return;
    
    // Update content
    document.getElementById("confirmActionTitle").textContent = title;
    document.getElementById("confirmActionContent").textContent = message;
    document.getElementById("confirmActionBtn").textContent = confirmText;
    document.getElementById("confirmActionBtn").className = `px-4 py-2 rounded text-white hover:bg-opacity-90 ${confirmClass}`;
    document.getElementById("confirmCancelBtn").textContent = cancelText;
    
    // Set up event handlers
    document.getElementById("confirmActionBtn").onclick = () => {
      onConfirm();
      this.hide("confirm");
    };
    
    document.getElementById("confirmCancelBtn").onclick = () => {
      onCancel();
      this.hide("confirm");
    };
    
    modal.classList.remove("hidden");
    return modal;
  },
  
  // Helper methods
  _populateProjectForm(project) {
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
  },
  
  _setContentModalData(title, content) {
    const titleEl = document.getElementById("contentViewModalTitle");
    const contentEl = document.getElementById("contentViewModalContent");
    
    if (titleEl) titleEl.textContent = title || "Content";
    if (contentEl) contentEl.innerHTML = content || "";
  }
};

// =====================================================================
// COMPONENTS
// =====================================================================

/**
 * Project List Component
 * Handles the project list view
 */
class ProjectListComponent {
  constructor(options) {
    this.elementId = options.elementId;
    this.element = document.getElementById(this.elementId);
    this.onViewProject = options.onViewProject;
    this.messageEl = document.getElementById("noProjectsMessage");
    this.bindFilterEvents();
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
    
    // Create card
    const card = UIUtils.createElement("div", {
      className: `bg-white dark:bg-gray-700 rounded shadow p-4 border-l-4 
        ${project.pinned ? "border-yellow-500" : "border-blue-500"} 
        ${project.archived ? "opacity-60" : ""} w-full md:w-auto mb-2`
    });
    
    // Header
    const header = UIUtils.createElement("div", { className: "flex justify-between mb-2" });
    const title = UIUtils.createElement("h3", { className: "font-semibold text-md", textContent: project.name });
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
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
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
        window.projectManager.deleteProject(project.id)
          .then(() => {
            UIUtils.showNotification("Project deleted", "success");
            window.projectManager.loadProjects();
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

  bindFilterEvents() {
    const filterButtons = document.querySelectorAll('.project-filter-btn');
    filterButtons.forEach(button => {
      button.addEventListener('click', () => {
        // Update active button styling
        filterButtons.forEach(btn => {
          btn.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
          btn.classList.add('text-gray-600');
        });
        button.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
        button.classList.remove('text-gray-600');
        
        // Load projects with selected filter
        const filter = button.dataset.filter;
        window.projectManager.loadProjects(filter);
      });
    });
  }
}

/**
 * Project Details Component
 * Handles the project details view
 */
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
  
  bindEvents() {
    if (this.elements.backBtn) {
      this.elements.backBtn.addEventListener("click", () => {
        if (this.onBack) this.onBack();
      });
    }
    
    if (this.elements.pinBtn) {
      this.elements.pinBtn.addEventListener("click", () => this.togglePin());
    }
  }
  
  setupDragDropHandlers() {
    const dragZone = document.getElementById('dragDropZone');
    if (!dragZone) return;
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
      dragZone.addEventListener(event, this._preventDefaults);
    });
    
    ['dragenter', 'dragover'].forEach(event => {
      dragZone.addEventListener(event, this._highlight.bind(this));
    });
    
    ['dragleave', 'drop'].forEach(event => {
      dragZone.addEventListener(event, this._unhighlight.bind(this));
    });
    
    dragZone.addEventListener('drop', this._handleDrop.bind(this));
  }
  
  _preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  _highlight() {
    document.getElementById('dragDropZone')?.classList.add(
      'bg-gray-100', 'dark:bg-gray-700', 'border-blue-400'
    );
  }
  
  _unhighlight() {
    document.getElementById('dragDropZone')?.classList.remove(
      'bg-gray-100', 'dark:bg-gray-700', 'border-blue-400'
    );
  }
  
  _handleDrop(e) {
    this._unhighlight();
    const dt = e.dataTransfer;
    const files = dt.files;
    const projectId = window.projectManager.currentProject?.id;
    
    if (projectId && files && files.length > 0) {
      this.uploadFiles(projectId, files);
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
    if (this.elements.title) this.elements.title.textContent = project.name;
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
      const currentWidth = parseFloat(this.elements.tokenProgressBar.style.width || "0");
      AnimationUtils.animateProgress(this.elements.tokenProgressBar, currentWidth, pct);
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
      window.projectManager.uploadFile(projectId, file)
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
      AnimationUtils.animateProgress(this.elements.progressBar, 
        parseFloat(this.elements.progressBar.style.width || "0"), percentage);
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
      if (window.projectManager.currentProject) {
        window.projectManager.loadProjectFiles(window.projectManager.currentProject.id);
        window.projectManager.loadProjectStats(window.projectManager.currentProject.id);
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
  
  confirmDeleteFile(file) {
    ModalManager.confirmAction({
      title: "Delete File",
      message: `Are you sure you want to delete the file "${file.filename}"?`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmClass: "bg-red-600",
      onConfirm: () => {
        const projectId = window.projectManager.currentProject?.id;
        if (!projectId) return;
        
        window.projectManager.deleteFile(projectId, file.id)
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
    const project = window.projectManager.currentProject;
    if (!project) return;
    
    window.projectManager.togglePinProject(project.id)
      .then(res => {
        UIUtils.showNotification(
          res.data?.pinned ? "Project pinned" : "Project unpinned",
          "success"
        );
        window.projectManager.loadProjectDetails(project.id);
      })
      .catch(err => {
        console.error("Error toggling pin status:", err);
        UIUtils.showNotification("Failed to update project", "error");
      });
  }
}

/**
 * Knowledge Base Component
 * Handles knowledge base functionality
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
        console.error("Error loading knowledge base data:", err);
      });
  }
  
  searchKnowledgeBase(query) {
    const projectId = window.projectManager.currentProject?.id;
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
        UIUtils.showNotification("Failed to search knowledge base", "error");
        this.showNoResults();
      });
  }
  
  toggleKnowledgeBase(enabled) {
    const projectId = window.projectManager.currentProject?.id;
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
        window.projectManager.loadProjectStats(projectId);
      })
      .catch(err => {
        console.error(`Error ${enabled ? "enabling" : "disabling"} knowledge base:`, err);
        UIUtils.showNotification(
          `Failed to ${enabled ? "enable" : "disable"} knowledge base`,
          "error"
        );
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
          <span>Searching knowledge base...</span>
        </div>
      `;
    }
    
    if (this.elements.resultsSection) this.elements.resultsSection.classList.remove("hidden");
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
    
    if (this.elements.resultsSection) this.elements.resultsSection.classList.remove("hidden");
    if (this.elements.noResultsSection) this.elements.noResultsSection.classList.add("hidden");
    
    this.elements.resultsContainer.innerHTML = "";
    
    results.forEach(result => {
      const item = UIUtils.createElement("div", {
        className: "bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-3 hover:shadow-md transition-shadow"
      });
      
      // Add result content to the item
      const header = UIUtils.createElement("div", {
        className: "flex justify-between items-center border-b border-gray-200 pb-2 mb-2"
      });
      
      const fileInfo = UIUtils.createElement("div", {
        className: "flex items-center"
      });
      
      const fileIcon = UIUtils.createElement("span", {
        className: "text-lg mr-2",
        textContent: UIUtils.fileIcon(result.file_type || "txt")
      });
      
      const fileName = UIUtils.createElement("div", {
        className: "font-medium",
        textContent: result.filename || result.file_path || "Unknown source"
      });
      
      fileInfo.appendChild(fileIcon);
      fileInfo.appendChild(fileName);
      
      const score = UIUtils.createElement("div", {
        className: "text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded",
        textContent: `${Math.round(result.score * 100)}% match`
      });
      
      header.appendChild(fileInfo);
      header.appendChild(score);
      item.appendChild(header);
      
      // Text snippet
      const snippet = UIUtils.createElement("div", {
        className: "text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-3"
      });
      
      const textContent = result.text || result.content || "";
      const displayText = textContent.length > 200 
        ? textContent.substring(0, 200) + "..." 
        : textContent;
      
      snippet.textContent = displayText;
      item.appendChild(snippet);
      
      this.elements.resultsContainer.appendChild(item);
    });
  }
  
  renderKnowledgeBaseInfo(kb) {
    // Simplified version for brevity
    const activeContainer = document.getElementById("knowledgeBaseActive");
    const inactiveContainer = document.getElementById("knowledgeBaseInactive");
    
    if (!activeContainer || !inactiveContainer) return;
    
    if (kb) {
      document.getElementById("knowledgeBaseName").textContent = kb.name || "Project Knowledge Base";
      
      const toggleCheckbox = document.getElementById("knowledgeBaseEnabled");
      if (toggleCheckbox) {
        toggleCheckbox.checked = kb.is_active;
      }
      
      activeContainer.classList.remove("hidden");
      inactiveContainer.classList.add("hidden");
    } else {
      activeContainer.classList.add("hidden");
      inactiveContainer.classList.remove("hidden");
    }
  }
}

// =====================================================================
// MAIN DASHBOARD CONTROLLER
// =====================================================================

/**
 * Project Dashboard
 * Main controller for the project dashboard
 */
class ProjectDashboard {
  constructor() {
    this.components = {};
    this.state = {
      currentView: null, // 'list' or 'details' 
      currentProject: null
    };
  }

  // Initialize the dashboard
  init() {
    console.log("Project Dashboard initialization started");
    
    // Setup components first
    this.setupComponents();
    
    // Then process URL params
    this.processUrlParams();
    
    // Then register events
    this.registerDataEvents();
    this.bindEvents();
    
    console.log("Project Dashboard initialized");
  }

  // Setup UI components with error handling
  setupComponents() {
    try {
      // Initialize view components
      this.components.projectList = new ProjectListComponent({
        elementId: "projectList",
        onViewProject: this.handleViewProject.bind(this)
      });
      
      this.components.projectDetails = new ProjectDetailsComponent({
        onBack: this.handleBackToList.bind(this)
      });
      
      this.components.knowledgeBase = new KnowledgeBaseComponent();
      
      console.debug('All components initialized successfully');
    } catch (error) {
      console.error('Failed to initialize components:', error);
      throw new Error('Component initialization failed');
    }
  }
  
  // Process URL parameters
  processUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");
    
    if (projectId) {
      this.showProjectDetails(projectId);
    } else {
      this.showProjectList();
    }
  }
  
  // Register data event listeners
  registerDataEvents() {
    document.addEventListener("projectsLoaded", this.handleProjectsLoaded.bind(this));
    document.addEventListener("projectLoaded", this.handleProjectLoaded.bind(this));
    document.addEventListener("projectStatsLoaded", this.handleProjectStatsLoaded.bind(this));
    document.addEventListener("projectFilesLoaded", this.handleFilesLoaded.bind(this));
    document.addEventListener("projectConversationsLoaded", this.handleConversationsLoaded.bind(this));
    document.addEventListener("projectArtifactsLoaded", this.handleArtifactsLoaded.bind(this));
  }
  
  // Global event binding
  bindEvents() {
    // Project form handling
    document.getElementById("projectForm")?.addEventListener("submit", 
      this.handleProjectFormSubmit.bind(this));
    
    // File uploads
    document.getElementById("uploadFileBtn")?.addEventListener("click", () => {
      document.getElementById("fileInput")?.click();
    });
    
    document.getElementById("fileInput")?.addEventListener("change", (e) => {
      if (!e.target.files || !e.target.files.length) return;
      
      const projectId = this.state.currentProject?.id;
      if (!projectId) {
        UIUtils.showNotification("No project selected", "error");
        return;
      }
      
      this.components.projectDetails.uploadFiles(projectId, e.target.files);
    });
  }
  
  // View management
  showProjectList() {
    this.state.currentView = 'list';
    this.components.projectList.show();
    this.components.projectDetails.hide();
    window.history.pushState({}, "", window.location.pathname);
    window.projectManager.loadProjects();
  }
  
  showProjectDetails(projectId) {
    this.state.currentView = 'details';
    this.components.projectList.hide();
    this.components.projectDetails.show();
    window.projectManager.loadProjectDetails(projectId);
  }

  // Event handlers
  handleViewProject(projectId) {
    this.showProjectDetails(projectId);
  }
  
  handleBackToList() {
    this.showProjectList();
  }
  
  handleProjectsLoaded(event) {
    console.log("[Dashboard] Received projectsLoaded event", event);
      
    const projects = event.detail || [];
    const originalCount = event.originalCount || projects.length;
    const filter = event.filterApplied || 'all';
    const hasError = event.error || false;

    console.log(`[Dashboard] Rendering ${projects.length} projects (${originalCount} total, filter: ${filter})`);
      
    try {
      this.components.projectList.renderProjects(projects);
        
      // Update empty state visibility and message
      const noProjectsMsg = document.getElementById('noProjectsMessage');
      if (noProjectsMsg) {
        noProjectsMsg.classList.toggle('hidden', projects.length > 0 || hasError);
        
        if (hasError) {
          noProjectsMsg.textContent = "Error loading projects. Please try again.";
          noProjectsMsg.classList.add('text-red-600');
        } else if (projects.length === 0 && originalCount > 0) {
          noProjectsMsg.textContent = `No projects match the "${filter}" filter`;
          noProjectsMsg.classList.remove('text-red-600');
        } else if (projects.length === 0) {
          noProjectsMsg.textContent = "No projects found. Create your first project!";
          noProjectsMsg.classList.remove('text-red-600');
        }
      }
    } catch (error) {
      console.error("[Dashboard] Error rendering projects:", error);
      const noProjectsMsg = document.getElementById('noProjectsMessage');
      if (noProjectsMsg) {
        noProjectsMsg.textContent = "Error displaying projects";
        noProjectsMsg.classList.remove('hidden');
        noProjectsMsg.classList.add('text-red-600');
      }
    }
  }
  
  handleProjectLoaded(event) {
    const project = event.detail;
    this.state.currentProject = project;
    this.components.projectDetails.renderProject(project);
  }
  
  handleProjectStatsLoaded(event) {
    const stats = event.detail;
    this.components.projectDetails.renderStats(stats);
  }
  
  handleFilesLoaded(event) {
    const files = event.detail.files;
    this.components.projectDetails.renderFiles(files);
  }
  
  handleConversationsLoaded(event) {
    const conversations = event.detail;
    this.components.projectDetails.renderConversations?.(conversations);
  }
  
  handleArtifactsLoaded(event) {
    const artifacts = event.detail.artifacts;
    this.components.projectDetails.renderArtifacts?.(artifacts);
  }
  
  handleProjectFormSubmit(e) {
    e.preventDefault();
    
    const projectId = document.getElementById("projectIdInput").value;
    const isEditing = !!projectId;
    
    // Collect form data
    const data = {
      name: document.getElementById("projectNameInput").value.trim(),
      description: document.getElementById("projectDescInput").value.trim(),
      goals: document.getElementById("projectGoalsInput").value.trim(),
      max_tokens: parseInt(document.getElementById("projectMaxTokensInput").value, 10)
    };
    
    if (!data.name) {
      UIUtils.showNotification("Project name is required", "error");
      return;
    }
    
    window.projectManager.createOrUpdateProject(projectId, data)
      .then(() => {
        ModalManager.hide("project");
        UIUtils.showNotification(
          isEditing ? "Project updated successfully" : "Project created successfully",
          "success"
        );
        window.projectManager.loadProjects();
      })
      .catch(err => {
        console.error("Error saving project:", err);
        UIUtils.showNotification("Failed to save project", "error");
      });
  }
}

// =====================================================================
// INITIALIZATION
// =====================================================================

/**
 * Initialize the project dashboard module
 */
async function initProjectDashboard() {
  try {
    console.log("Initializing project dashboard module");
    
    // Create dashboard instance
    const dashboard = new ProjectDashboard();
    
    // Initialize with error handling
    try {
      await dashboard.init();
      console.log("✅ Project dashboard initialized");
    } catch (error) {
      console.error("Dashboard initialization error:", error);
      throw error;
    }
  } catch (error) {
    console.error("❌ Project dashboard module initialization failed:", error);
  }
}

// Export modules to window object
window.ProjectDashboard = ProjectDashboard;
window.ProjectListComponent = ProjectListComponent;
window.ProjectDetailsComponent = ProjectDetailsComponent;
window.KnowledgeBaseComponent = KnowledgeBaseComponent;
window.initProjectDashboard = initProjectDashboard;
window.ModalManager = ModalManager;
window.AnimationUtils = AnimationUtils;
window.UIUtils = UIUtils;

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('projectManagerPanel')) {
    initProjectDashboard();
  }
});
