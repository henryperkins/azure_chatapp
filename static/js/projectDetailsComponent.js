// Define utility classes with fallbacks
// Using regular imports so we don't need top-level await
import { UIUtils, AnimationUtils, ModalManager } from './projectDashboardUtils.js';

// Fallback classes if the imports don't work
class FallbackUIUtils {
  constructor() { 
    console.log('Fallback UIUtils created in projectDetailsComponent'); 
  }
  toggleVisibility(element, visible) {
    if (!element) return;
    element.classList.toggle('hidden', !visible);
  }
  createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.onclick) el.addEventListener('click', options.onclick);
    return el;
  }
  formatNumber(num) { return num?.toString() || '0'; }
  formatDate(date) { return date || ''; }
  formatBytes(bytes) { return (bytes || 0) + ' bytes'; }
  fileIcon() { return '📄'; }
  showNotification(msg, type) { 
    console.log(`${type}: ${msg}`);
    if (window.showNotification) {
      window.showNotification(msg, type);
    } else {
      alert(`${type}: ${msg}`);
    }
  }
}

class FallbackAnimationUtils {
  constructor() { 
    console.log('Fallback AnimationUtils created in projectDetailsComponent'); 
  }
  animateProgress(el, from, to) { 
    if (el) el.style.width = to + '%'; 
  }
}

// Try to use the imported classes, fall back to our defined ones if they don't exist
const UIUtilsClass = UIUtils || FallbackUIUtils;
const AnimationUtilsClass = AnimationUtils || FallbackAnimationUtils;
const ModalManagerClass = ModalManager;

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

    // Add this event listener
    document.addEventListener("projectConversationsLoaded", (e) => {
      this.renderConversations(e.detail); // Use e.detail directly instead of e.detail.conversations
    });
    
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
      this.elements.tokenProgressBar.style.width = "0%"; // Reset to ensure animation works
      animationUtilsInstance.animateProgress(
        this.elements.tokenProgressBar,
        0,
        pct
      );
    }

    // Update file, conversation and artifact counts
    if (stats.file_count !== undefined) {
      const fileCountEl = document.getElementById('fileCount');
      if (fileCountEl) fileCountEl.textContent = uiUtilsInstance.formatNumber(stats.file_count);
    }
    
    if (stats.conversation_count !== undefined) {
      const convoCountEl = document.getElementById('conversationCount');
      if (convoCountEl) convoCountEl.textContent = uiUtilsInstance.formatNumber(stats.conversation_count);
    }
    
    if (stats.artifact_count !== undefined) {
      const artifactCountEl = document.getElementById('artifactCount');
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
        className: "content-item"
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
    
    // Handle both raw array and event detail format
    const convos = Array.isArray(conversations) ? conversations : [];
    
    if (!convos || convos.length === 0) {
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
          if (chatContainer) {
            chatContainer.classList.remove('hidden');
            // Scroll to chat container
            chatContainer.scrollIntoView({ behavior: 'smooth' });
          }
          
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
      
      // Create delete button
      const deleteBtn = uiUtilsInstance.createElement("button", {
        className: "text-red-600 hover:text-red-800 ml-4",
        innerHTML: `
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862
                     a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4
                     a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        `,
        onclick: (e) => {
          e.stopPropagation(); // Prevent loading the conversation
          this.confirmDeleteConversation(conversation);
        }
      });

      convoEl.appendChild(infoDiv);
      convoEl.appendChild(deleteBtn); // Add the delete button
      
      // Add data attribute for easy selection later
      convoEl.dataset.conversationId = conversation.id;
      
      this.elements.conversationsList.appendChild(convoEl);
    });
  }

  bindEvents() {
    if (this.elements.backBtn) { // Check if backBtn exists before adding listener
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
    
    // Add this new code for the minimize chat button
    const minimizeChatBtn = document.getElementById('minimizeChatBtn');
    if (minimizeChatBtn) {
      minimizeChatBtn.addEventListener('click', () => {
        const chatContainer = document.getElementById('projectChatContainer');
        if (chatContainer) chatContainer.classList.add('hidden');
      });
    }

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
  
  async confirmDeleteConversation(conversation) {
    try {
      const confirmed = await ModalManagerClass.confirmAction({
        title: "Delete Conversation",
        message: `Delete "${conversation.title || 'this conversation'}" and all its messages?`,
        confirmText: "Delete Forever",
        cancelText: "Cancel",
        confirmClass: "bg-red-600",
        destructive: true
      });

      if (!confirmed) return;

      const projectId = this.state.currentProject?.id;
      if (!projectId) {
        throw new Error("No active project selected");
      }

      // Show loading state
      const deleteBtn = document.activeElement;
      const originalText = deleteBtn.innerHTML;
      deleteBtn.innerHTML = `<span class="animate-spin">⏳</span> Deleting...`;
      deleteBtn.disabled = true;

      try {
        await window.projectManager.deleteProjectConversation(projectId, conversation.id);

        // Refresh data
        await Promise.all([
          window.projectManager.loadProjectStats(projectId),
          window.projectManager.loadProjectConversations(projectId)
        ]);

        // ✅ Close the modal immediately after successful deletion
        ModalManagerClass.closeActiveModal();

        // Then show the notification with undo
        uiUtilsInstance.showNotification("Conversation deleted", "success", {
          action: "Undo",
          onAction: async () => {
            try {
              await window.apiRequest(
                `/api/projects/${projectId}/conversations/${conversation.id}/restore`,
                "POST"
              );
              await Promise.all([
                window.projectManager.loadProjectStats(projectId),
                window.projectManager.loadProjectConversations(projectId)
              ]);
            } catch (err) {
              console.error("Restore failed:", err);
            }
          },
          timeout: 5000
        });

      } finally {
        // Reset button state
        deleteBtn.innerHTML = originalText;
        deleteBtn.disabled = false;
      }

    } catch (error) {
      console.error("Delete failed:", error);

      let errorMsg = "Failed to delete conversation";
      if (error?.response?.status === 403) {
        errorMsg = "You don't have permission to delete this";
      } else if (error?.response?.status === 404) {
        errorMsg = "Conversation not found - may already be deleted";
      } else if (error.message.includes("No active project")) {
        errorMsg = "No project selected";
      }

      uiUtilsInstance.showNotification(errorMsg, "error");
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.project-tab-content').forEach(tabContent => {
      tabContent.classList.add('hidden');
    });

    const activeTab = document.getElementById(`${tabName}Tab`);
    if (activeTab) activeTab.classList.remove('hidden');

    document.querySelectorAll('.project-tab-btn').forEach(tabBtn => {
      tabBtn.classList.remove('active');
      tabBtn.setAttribute('aria-selected', 'false');
    });

    const activeTabBtn = document.querySelector(`.project-tab-btn[data-tab="${tabName}"]`);
    if (activeTabBtn) {
      activeTabBtn.classList.add('active');
      activeTabBtn.setAttribute('aria-selected', 'true');
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
        dragZone.classList.add('drag-zone-active');
      });
    });
    
    ['dragleave', 'drop'].forEach(event => {
      dragZone.addEventListener(event, () => {
        dragZone.classList.remove('drag-zone-active');
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
    // Check knowledge base exists with tooltip explanation
    if (!window.projectManager?.currentProject?.knowledge_base_id) {
      const tooltip = document.getElementById('kbRequirementTooltip');
      if (tooltip) {
        tooltip.classList.remove('hidden');
        setTimeout(() => tooltip.classList.add('hidden'), 5000);
      }
      uiUtilsInstance.showNotification(
        "Please setup a knowledge base before uploading files",
        "error"
      );
      return Promise.reject("Knowledge base not configured");
    }

    this.fileUploadStatus = { completed: 0, failed: 0, total: files.length };
    const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'];
    const maxSizeMB = 30;
    
    // Update KB status indicator
    const kbStatus = document.getElementById('kbStatusIndicator');
    if (kbStatus) {
      kbStatus.textContent = window.projectManager?.currentProject?.knowledge_base_id
        ? "✓ Knowledge Base Ready"
        : "✗ Knowledge Base Required";
      kbStatus.className = window.projectManager?.currentProject?.knowledge_base_id
        ? "text-green-600 text-sm"
        : "text-red-600 text-sm";
    }

    // Show supported file types
    const fileTypesInfo = document.getElementById('supportedFileTypes');
    if (fileTypesInfo) {
      fileTypesInfo.innerHTML = `
        <div class="text-xs text-gray-500 mt-2">
          Supported: ${allowedExtensions.join(', ')} (Max ${maxSizeMB}MB)
          <span class="inline-block ml-2" title="Files will be indexed in Knowledge Base">
            ℹ️
          </span>
        </div>
      `;
    }

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
      // Store projectId for use in completion handler
      const currentProjectId = projectId;
      return Promise.all(
        validFiles.map(file => {
          return window.projectManager?.uploadFile(currentProjectId, file)
            .then(response => {
              console.log(`Upload successful for ${file.name}:`, response);
              this.fileUploadStatus.completed++;
              this.updateUploadProgress();
            })
            .catch(error => {
              console.error(`Upload error for ${file.name}:`, error);
               
              // Determine the specific error message based on error type
              let errorMessage = error.message || "Upload failed";
               
              // Handle specific error types
              if (errorMessage.includes("validation") || errorMessage.includes("format")) {
                errorMessage = "File format not supported or validation failed";
              } else if (errorMessage.includes("too large")) {
                errorMessage = "File exceeds size limit";
              } else if (errorMessage.includes("token")) {
                errorMessage = "Project token limit exceeded";
              } else if (error.response?.status === 422) {
                errorMessage = "File validation failed - unsupported format or content";
              }
               
              uiUtilsInstance.showNotification(`Failed to upload ${file.name}: ${errorMessage}`, 'error');
              this.fileUploadStatus.failed++;
              this.fileUploadStatus.completed++;
              this.updateUploadProgress();
            });
        })
      ).finally(() => {
        // Use the stored project ID for refresh
        const pid = currentProjectId || (window.projectManager?.currentProject?.id);
        
        if (pid) {
          window.projectManager.loadProjectFiles(pid);
          window.projectManager.loadProjectStats(pid);
        } else {
          console.warn('Cannot refresh project data - no valid project ID available');
        }
      });
    }
    return Promise.resolve();
  }

  updateUploadProgress() {
    const { completed, failed, total } = this.fileUploadStatus;
    const percentage = Math.round((completed / total) * 100);
      
    if (this.elements.progressBar) {
      this.elements.progressBar.classList.add('transition-all', 'duration-300');
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

// Export the ProjectDetailsComponent as default
export default ProjectDetailsComponent;
