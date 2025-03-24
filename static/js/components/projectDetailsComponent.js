/**
 * projectDetailsComponent.js
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
    this.setupDragDropHandlers();
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
        ModalManager.show("instructions");
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
          ModalManager.hide("instructions");
          
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
    
    // Close instructions modal button
    document.getElementById("closeInstructionsBtn")?.addEventListener("click", () => {
      ModalManager.hide("instructions");
    });
    
    // New conversation button
    if (this.elements.newConversationBtn) {
      this.elements.newConversationBtn.addEventListener("click", () => this.startNewConversation());
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
    const projectId = projectManager.currentProject?.id;
    
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
    
    // Animate progress bar using AnimationUtils
    if (this.elements.tokenProgressBar) {
      const currentWidth = parseFloat(this.elements.tokenProgressBar.style.width || "0");
      AnimationUtils.animateProgress(this.elements.tokenProgressBar, currentWidth, pct);
    }
    
    // Update counts with animation
    if (this.elements.conversationCount) {
      const oldCount = parseInt(this.elements.conversationCount.textContent || "0", 10);
      const newCount = stats.conversation_count || 0;
      AnimationUtils.animateCounter(this.elements.conversationCount, oldCount, newCount);
    }
    
    if (this.elements.fileCount) {
      const oldCount = parseInt(this.elements.fileCount.textContent || "0", 10);
      const newCount = stats.file_count || 0;
      AnimationUtils.animateCounter(this.elements.fileCount, oldCount, newCount);
    }
    
    if (this.elements.artifactCount) {
      const oldCount = parseInt(this.elements.artifactCount.textContent || "0", 10);
      const newCount = stats.artifact_count || 0;
      AnimationUtils.animateCounter(this.elements.artifactCount, oldCount, newCount);
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
        ModalManager.show("knowledge");
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

// Export the module
window.ProjectDetailsComponent = ProjectDetailsComponent;