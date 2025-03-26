// Import necessary utility classes directly using ES module syntax
import {
  UIUtils as UIUtilsClass,
  AnimationUtils as AnimationUtilsClass,
  ModalManager
} from './projectDashboardUtils.js';

// Create instances of utility classes for use within this module
const uiUtilsInstance = new UIUtilsClass();
const animationUtilsInstance = new AnimationUtilsClass();

// Ensure instances are available globally if other scripts rely on them (optional, but safer for now)
if (typeof window !== 'undefined') {
  if (!window.UIUtils) window.UIUtils = uiUtilsInstance;
  if (!window.AnimationUtils) window.AnimationUtils = animationUtilsInstance;
}

console.log('UIUtils instance created:', !!uiUtilsInstance?.createElement);
console.log('AnimationUtils instance created:', !!animationUtilsInstance?.animateProgress);


/**
 * Project Details Component - Handles the project details view
 */
class ProjectDetailsComponent {
  constructor(options = {}) {
    this.onBack = options.onBack;
    this.state = { currentProject: null };
    this.fileUploadStatus = { completed: 0, failed: 0, total: 0 };
    
    // Initialize chat interface only if available
    if (typeof window.ChatInterface === 'function') {
      if (!window.projectChatInterface) {
        console.log('Initializing project chat interface');
        try {
          window.projectChatInterface = new window.ChatInterface({
            containerSelector: '#projectChatUI',
            messageContainerSelector: '#projectChatMessages',
            inputSelector: '#projectChatInput',
            sendButtonSelector: '#projectChatSendBtn'
          });
          window.projectChatInterface.initialize();
        } catch (err) {
          console.error('Failed to initialize chat interface:', err);
        }
      } else {
        console.log('Project chat interface already exists');
      }
    } else {
      console.warn('ChatInterface not available - chat functionality will be limited');
    }

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

    console.log('ProjectDetailsComponent elements initialized');
    
    this.bindEvents();
    this.setupDragDropHandlers();
  }

  show() {
    uiUtilsInstance.toggleVisibility(this.elements.container, true);
  }

  hide() {
    if (UIUtils && uiUtilsInstance.toggleVisibility) {
      uiUtilsInstance.toggleVisibility(this.elements.container, false);
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
      this.elements.tokenUsage.textContent = uiUtilsInstance.formatNumber(stats.token_usage || 0);
    }
    if (this.elements.maxTokens) {
      this.elements.maxTokens.textContent = uiUtilsInstance.formatNumber(stats.max_tokens || 0);
    }
    
    const usage = stats.token_usage || 0;
    const maxT = stats.max_tokens || 0;
    const pct = maxT > 0 ? Math.min(100, (usage / maxT) * 100).toFixed(1) : 0;
    
    if (this.elements.tokenPercentage) {
      this.elements.tokenPercentage.textContent = `${pct}%`;
    }
    
    if (this.elements.tokenProgressBar) {
      animationUtilsInstance.animateProgress(
        this.elements.tokenProgressBar,
        parseFloat(this.elements.tokenProgressBar.style.width || "0"),
        pct
      );
    }

    // Update file, conversation and artifact counts
    if (stats.file_count !== undefined) {
      const fileCountEl = document.getElementById('projectFileCount');
      if (fileCountEl) fileCountEl.textContent = uiUtilsInstance.formatNumber(stats.file_count);
    }
    
    if (stats.conversation_count !== undefined) {
      const convoCountEl = document.getElementById('projectConversationCount');
      if (convoCountEl) convoCountEl.textContent = uiUtilsInstance.formatNumber(stats.conversation_count);
    }
    
    if (stats.artifact_count !== undefined) {
      const artifactCountEl = document.getElementById('projectArtifactCount');
      if (artifactCountEl) artifactCountEl.textContent = uiUtilsInstance.formatNumber(stats.artifact_count);
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
      const item = uiUtilsInstance.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2"
      });
      
      // Info section
      const infoDiv = uiUtilsInstance.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(uiUtilsInstance.createElement("span", {
        className: "text-lg mr-2",
        textContent: uiUtilsInstance.fileIcon(file.file_type)
      }));
      
      const detailDiv = uiUtilsInstance.createElement("div", { className: "flex flex-col" });
      detailDiv.appendChild(uiUtilsInstance.createElement("div", {
        className: "font-medium",
        textContent: file.filename
      }));
      detailDiv.appendChild(uiUtilsInstance.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: `${uiUtilsInstance.formatBytes(file.file_size)} · ${uiUtilsInstance.formatDate(file.created_at)}`
      }));
      
      infoDiv.appendChild(detailDiv);
      item.appendChild(infoDiv);
      
      // Actions section
      const actions = uiUtilsInstance.createElement("div", { className: "flex space-x-2" });
      actions.appendChild(uiUtilsInstance.createElement("button", {
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
      const convoEl = uiUtilsInstance.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer",
        onclick: async () => {
          const chatContainer = document.getElementById('projectChatContainer');
          if (chatContainer) chatContainer.classList.remove('hidden');
          
          console.log('Loading conversation', conversation.id);
          
          // Verify chat interface is ready
          if (!window.projectChatInterface) {
            console.error('Project chat interface not initialized');
            return;
          }

          // Ensure target container is set
          try {
            window.projectChatInterface.setTargetContainer('#projectChatMessages');
            console.log('Target container set successfully');
          } catch (err) {
            console.error('Failed to set target container:', err);
          }

          // Load conversation with error handling
          try {
            await window.projectChatInterface.loadConversation(conversation.id);
            console.log('Conversation loaded successfully');
          } catch (err) {
            console.error('Failed to load conversation:', err);
            window.UIUtils?.showNotification('Failed to load conversation', 'error');
          }
        }
      });
      
      const infoDiv = uiUtilsInstance.createElement("div", { className: "flex items-center" });
      infoDiv.appendChild(uiUtilsInstance.createElement("span", {
        className: "text-lg mr-2",
        textContent: "💬"
      }));
      
      const textDiv = uiUtilsInstance.createElement("div");
      textDiv.appendChild(uiUtilsInstance.createElement("div", {
        className: "font-medium",
        textContent: conversation.title || "Untitled conversation"
      }));
      textDiv.appendChild(uiUtilsInstance.createElement("div", {
        className: "text-xs text-gray-500",
        textContent: uiUtilsInstance.formatDate(conversation.created_at)
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

    // Handle new conversation button
    const newConvoBtn = document.getElementById('newConversationBtn');
    if (newConvoBtn) {
      newConvoBtn.addEventListener('click', async (e) => {
        e.preventDefault(); // Prevent default navigation
        e.stopPropagation();
        
        const projectId = this.state.currentProject?.id;
        if (!projectId) return;

        try {
          // Show the chat container
          const chatContainer = document.getElementById('projectChatContainer');
          if (chatContainer) chatContainer.classList.remove('hidden');

          // Initialize or update chat interface with correct selectors
          if (!window.projectChatInterface) {
            window.projectChatInterface = new window.ChatInterface({
              containerSelector: '#projectChatUI',
              messageContainerSelector: '#projectChatMessages',
              inputSelector: '#projectChatInput',
              sendButtonSelector: '#projectChatSendBtn'
            });
            window.projectChatInterface.initialize();
          }

          // Create new conversation
          const conversation = await window.projectChatInterface.createNewConversation();
          
          // Set target container and load conversation
          if (window.projectChatInterface && typeof window.projectChatInterface.setTargetContainer === 'function') {
            window.projectChatInterface.setTargetContainer('#projectChatMessages');
            window.projectChatInterface.loadConversation(conversation.id);
          }

          // Update URL without reloading
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('chatId', conversation.id);
          window.history.pushState({}, '', newUrl);

          // Store project ID in localStorage for chat context
          localStorage.setItem('selectedProjectId', projectId);
        } catch (error) {
          console.error('Error creating new conversation:', error);
          window.UIUtils?.showNotification('Failed to create conversation', 'error');
        }
      });
    }
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
    const allowedExtensions = ['.txt', '.pdf', '.doc', '.docx', '.csv', '.json', '.md', '.xlsx', '.html'];
    const maxSizeMB = 30;
    
    if (this.elements.uploadProgress) {
      this.elements.uploadProgress.classList.remove("hidden");
      this.elements.progressBar.style.width = "0%";
      this.elements.uploadStatus.textContent = `Uploading 0/${files.length} files...`;
    }

    // Validate files first
    const validFiles = [];
    const invalidFiles = [];

    Array.from(files).forEach(file => {
      const fileExt = file.name.split('.').pop().toLowerCase();
      const isValidExt = allowedExtensions.includes(`.${fileExt}`);
      const isValidSize = file.size <= maxSizeMB * 1024 * 1024;

      if (isValidExt && isValidSize) {
        validFiles.push(file);
      } else {
        let errorMsg = '';
        if (!isValidExt) {
          errorMsg = `Invalid file type (.${fileExt}). Allowed: ${allowedExtensions.join(', ')}`;
        } else {
          errorMsg = `File too large (${(file.size / (1024 * 1024)).toFixed(1)}MB > ${maxSizeMB}MB limit)`;
        }
        invalidFiles.push({file, error: errorMsg});
      }
    });

    // Show errors for invalid files
    if (invalidFiles.length > 0) {
      invalidFiles.forEach(({file, error}) => {
        uiUtilsInstance.showNotification(`Skipped ${file.name}: ${error}`, 'error');
        this.fileUploadStatus.failed++;
        this.fileUploadStatus.completed++;
      });
      this.updateUploadProgress();
    }

    // Process valid files
    if (validFiles.length > 0) {
      return Promise.all(
        validFiles.map(file => {
          return window.projectManager?.uploadFile(projectId, file)
            .then(() => {
              this.fileUploadStatus.completed++;
              this.updateUploadProgress();
            })
            .catch(error => {
              uiUtilsInstance.showNotification(`Failed to upload ${file.name}: ${error.message}`, 'error');
              this.fileUploadStatus.failed++;
              this.fileUploadStatus.completed++;
              this.updateUploadProgress();
            });
        })
      );
    }
    return Promise.resolve();
  }

  updateUploadProgress() {
    const { completed, failed, total } = this.fileUploadStatus;
    const percentage = Math.round((completed / total) * 100);
    
    if (this.elements.progressBar) {
      animationUtilsInstance.animateProgress(
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
          uiUtilsInstance.showNotification("Files uploaded successfully", "success");
        } else {
          uiUtilsInstance.showNotification(`${failed} file(s) failed to upload`, "error");
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
            uiUtilsInstance.showNotification("File deleted", "success");
            // Refresh both files and stats
            return Promise.all([
              window.projectManager.loadProjectFiles(projectId),
              window.projectManager.loadProjectStats(projectId)
            ]);
          })
          .catch(err => {
            console.error("Error deleting file:", err);
            uiUtilsInstance.showNotification("Failed to delete file", "error");
          });
      }
    });
  }

  togglePin() {
    const project = this.state.currentProject;
    if (!project) return;
    
    window.projectManager?.togglePinProject(project.id)
      .then(() => {
        uiUtilsInstance.showNotification(
          project.pinned ? "Project unpinned" : "Project pinned",
          "success"
        );
        window.projectManager.loadProjectDetails(project.id);
      })
      .catch(err => {
        console.error("Error toggling pin:", err);
        uiUtilsInstance.showNotification("Failed to update project", "error");
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

    document.getElementById("reprocessFilesBtn")?.addEventListener("click", () => {
      this.reprocessFiles();
    });
    
    document.getElementById("knowledgeBaseEnabled")?.addEventListener("change", (e) => {
      this.toggleKnowledgeBase(e.target.checked);
    });

    document.getElementById("setupKnowledgeBaseBtn")?.addEventListener("click", () => {
      window.modalManager?.show("knowledge");
    });

    document.getElementById("knowledgeBaseForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const form = e.target;
      const formData = new FormData(form);
      const projectId = window.projectManager?.currentProject?.id;
      
      if (!projectId) {
        uiUtilsInstance.showNotification("No project selected", "error");
        return;
      }

      try {
        uiUtilsInstance.showNotification("Setting up knowledge base...", "info");
        
        const response = await window.apiRequest(
          `/api/projects/${projectId}/knowledge-base`,
          "POST",
          Object.fromEntries(formData)
        );

        uiUtilsInstance.showNotification("Knowledge base setup complete", "success");
        window.modalManager?.hide("knowledge");
        
        // Refresh knowledge base info
        await window.projectManager?.loadProjectStats(projectId);
      } catch (error) {
        console.error("Knowledge base setup failed:", error);
        uiUtilsInstance.showNotification("Failed to setup knowledge base", "error");
      }
    });
    
    this.elements.searchInput?.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const query = e.target.value.trim();
        if (query) this.searchKnowledgeBase(query);
      }
    });
  }
  
  // loadData method removed as KB info is now passed via renderKnowledgeBaseInfo
  // from the project stats payload in projectDashboard.js
  
  searchKnowledgeBase(query) {
    const projectId = window.projectManager?.currentProject?.id;
    if (!projectId) {
      uiUtilsInstance.showNotification("No project selected", "error");
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
        uiUtilsInstance.showNotification("Search failed", "error");
        this.showNoResults();
      });
  }
  
  async toggleKnowledgeBase(enabled) {
    const project = window.projectManager?.currentProject;
    if (!project?.knowledge_base_id) return;
    
    const toggle = document.getElementById("knowledgeBaseEnabled");
    const originalState = toggle.checked;
    
    // Optimistic UI update
    toggle.checked = enabled;
    uiUtilsInstance.showNotification(
      `${enabled ? "Enabling" : "Disabling"} knowledge base...`,
      "info"
    );
    
    try {
      const response = await window.apiRequest(
        `/api/knowledge-base/${project.knowledge_base_id}`, 
        "PATCH", 
        { is_active: enabled }
      );
      
      uiUtilsInstance.showNotification(
        `Knowledge base ${enabled ? "enabled" : "disabled"}`,
        "success"
      );
      
      // Refresh stats and KB info
      await Promise.all([
        window.projectManager?.loadProjectStats(project.id),
        this.loadKnowledgeBaseHealth(project.knowledge_base_id)
      ]);
    } catch (err) {
      console.error("Error toggling knowledge base:", err);
      // Revert UI on error
      toggle.checked = originalState;
      uiUtilsInstance.showNotification(
        `Failed to toggle knowledge base: ${err.message || "Unknown error"}`,
        "error"
      );
    }
  }

  async loadKnowledgeBaseHealth(kbId) {
    try {
      const health = await window.apiRequest(
        `/api/knowledge-base/${kbId}/health`,
        "GET"
      );
      this.renderHealthStatus(health);
    } catch (err) {
      console.error("Failed to load KB health:", err);
    }
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

  async reprocessFiles() {
    const projectId = window.projectManager?.currentProject?.id;
    if (!projectId) return;

    try {
      uiUtilsInstance.showNotification("Reprocessing files for search...", "info");
      const response = await window.apiRequest(
        `/api/projects/${projectId}/files/reprocess`,
        "POST"
      );
      
      uiUtilsInstance.showNotification(
        `Reprocessed ${response.data.processed_success} files successfully`,
        "success"
      );
      
      // Refresh the file list and stats
      window.projectManager.loadProjectFiles(projectId);
      window.projectManager.loadProjectStats(projectId);
    } catch (error) {
      uiUtilsInstance.showNotification("Failed to reprocess files", "error");
      console.error("Reprocessing error:", error);
    }
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
      // Extract error details if present
      const errorDetails = result.metadata?.processing_error;
      const hasError = errorDetails && !result.success;
      
      const item = uiUtilsInstance.createElement("div", {
        className: `bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm mb-3 hover:shadow-md transition-shadow ${
          hasError ? "border-l-4 border-red-500" : ""
        }`
      });
      
      // Header with file info and match score
      const header = uiUtilsInstance.createElement("div", {
        className: "flex justify-between items-center border-b border-gray-200 pb-2 mb-2"
      });
      
      const fileInfo = uiUtilsInstance.createElement("div", { className: "flex items-center" });
      fileInfo.appendChild(uiUtilsInstance.createElement("span", {
        className: "text-lg mr-2",
        textContent: uiUtilsInstance.fileIcon(result.file_type || "txt")
      }));
      fileInfo.appendChild(uiUtilsInstance.createElement("div", {
        className: "font-medium",
        textContent: result.filename || result.file_path || "Unknown source"
      }));
      
      header.appendChild(fileInfo);
      header.appendChild(uiUtilsInstance.createElement("div", {
        className: "text-xs px-2 py-1 bg-blue-100 text-blue-800 rounded",
        textContent: `${Math.round(result.score * 100)}% match`
      }));
      
      item.appendChild(header);
      
      // Content snippet
      const snippet = uiUtilsInstance.createElement("div", {
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
    const modelSelect = document.getElementById("knowledgeBaseModelSelect");
    
    if (!activeContainer || !inactiveContainer) return;
    
    if (kb) {
      document.getElementById("knowledgeBaseName").textContent = kb.name || "Project Knowledge Base";
      document.getElementById("knowledgeBaseEnabled").checked = kb.is_active;
      
      if (modelSelect) {
        modelSelect.innerHTML = `
          <option value="all-MiniLM-L6-v2" ${kb.embedding_model === 'all-MiniLM-L6-v2' ? 'selected' : ''}>
            all-MiniLM-L6-v2 (Default)
          </option>
          <option value="text-embedding-3-small" ${kb.embedding_model === 'text-embedding-3-small' ? 'selected' : ''}>
            OpenAI text-embedding-3-small
          </option>
          <option value="embed-english-v3.0" ${kb.embedding_model === 'embed-english-v3.0' ? 'selected' : ''}>
            Cohere embed-english-v3.0
          </option>
        `;
      }
      
      // Update stats
      if (kb.stats) {
        const fileCountEl = document.getElementById("knowledgeFileCount");
        if (fileCountEl) fileCountEl.textContent = kb.stats.file_count || 0;
        const totalSizeEl = document.getElementById("knowledgeFileSize");
        if (totalSizeEl) totalSizeEl.textContent = uiUtilsInstance.formatBytes(kb.stats.total_size || 0);
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
export { ProjectDetailsComponent, KnowledgeBaseComponent };


