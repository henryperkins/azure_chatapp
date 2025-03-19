/**
 * projectDashboard.js - UI event handlers for project management
 * Handles rendering and DOM updates based on events
 */

document.addEventListener("DOMContentLoaded", () => {
    // Register event listeners for data loading events
    registerEventListeners();
  });
  
  /**
   * Register event listeners for data-related events
   */
  function registerEventListeners() {
    // Project data events
    document.addEventListener("projectsLoaded", renderProjectsList);
    document.addEventListener("projectLoaded", renderProjectDetails);
    document.addEventListener("projectStatsLoaded", renderProjectStats);
    document.addEventListener("projectFilesLoaded", renderProjectFiles);
    document.addEventListener("projectConversationsLoaded", renderProjectConversations);
    document.addEventListener("projectArtifactsLoaded", renderProjectArtifacts);
    
    // Delegate clicks on the project list
    document.getElementById("projectList")?.addEventListener("click", handleProjectListClicks);
    
    // Delegate clicks on other lists
    document.getElementById("projectFilesList")?.addEventListener("click", handleFilesListClicks);
    document.getElementById("projectConversationsList")?.addEventListener("click", handleConversationsListClicks);
    document.getElementById("projectArtifactsList")?.addEventListener("click", handleArtifactsListClicks);
  }
  
  /**
   * Handle clicks on project list (delegation pattern)
   */
  function handleProjectListClicks(e) {
    // Handle view project button
    if (e.target.closest(".view-project-btn")) {
      const btn = e.target.closest(".view-project-btn");
      const projectId = btn.dataset.projectId;
      window.projectManager.loadProjectDetails(projectId);
    } 
    // Handle delete project button
    else if (e.target.closest(".delete-project-btn")) {
      const btn = e.target.closest(".delete-project-btn");
      const projectId = btn.dataset.projectId;
      const projectName = btn.dataset.projectName || "this project";
      window.projectManager.confirmDeleteProject(projectId, projectName);
    }
  }
  
  /**
   * Handle clicks on files list
   */
  function handleFilesListClicks(e) {
    // Handle view file button
    if (e.target.closest(".view-file-btn")) {
      const btn = e.target.closest(".view-file-btn");
      const fileId = btn.dataset.fileId;
      viewFile(fileId);
    } 
    // Handle delete file button
    else if (e.target.closest(".delete-file-btn")) {
      const btn = e.target.closest(".delete-file-btn");
      const fileId = btn.dataset.fileId;
      const fileName = btn.dataset.filename || "this file";
      window.projectManager.confirmDeleteFile(fileId, fileName);
    }
  }
  
  /**
   * Handle clicks on conversations list
   */
  function handleConversationsListClicks(e) {
    // Handle open conversation button
    if (e.target.closest(".open-conversation-btn")) {
      const btn = e.target.closest(".open-conversation-btn");
      const conversationId = btn.dataset.conversationId;
      window.location.href = `/?chatId=${conversationId}`;
    }
  }
  
  /**
   * Handle clicks on artifacts list
   */
  function handleArtifactsListClicks(e) {
    // Handle view artifact button
    if (e.target.closest(".view-artifact-btn")) {
      const btn = e.target.closest(".view-artifact-btn");
      const artifactId = btn.dataset.artifactId;
      viewArtifact(artifactId);
    } 
    // Handle delete artifact button
    else if (e.target.closest(".delete-artifact-btn")) {
      const btn = e.target.closest(".delete-artifact-btn");
      const artifactId = btn.dataset.artifactId;
      const artifactName = btn.dataset.name || "this artifact";
      window.projectManager.confirmDeleteArtifact(artifactId, artifactName);
    }
  }
  
  /**
   * View file contents
   */
  function viewFile(fileId) {
    // TO DO: Implement file viewer
    window.showNotification?.("File viewer not implemented yet", "info");
  }
  
  /**
   * View artifact contents
   */
  function viewArtifact(artifactId) {
    // TO DO: Implement artifact viewer
    window.showNotification?.("Artifact viewer not implemented yet", "info");
  }
  
  /**
   * Render projects list
   */
  function renderProjectsList(event) {
    const projects = event.detail;
    const projectList = document.getElementById("projectList");
    const noProjectsMessage = document.getElementById("noProjectsMessage");
    
    if (!projectList) return;
    
    projectList.innerHTML = "";
    
    if (projects.length === 0) {
      if (noProjectsMessage) {
        noProjectsMessage.classList.remove("hidden");
      }
      return;
    }
    
    if (noProjectsMessage) {
      noProjectsMessage.classList.add("hidden");
    }
    
    projects.forEach(project => {
      const card = createProjectCard(project);
      projectList.appendChild(card);
    });
  }
  
  /**
   * Create a project card element
   */
  function createProjectCard(project) {
    // Calculate token usage percentage
    const usagePercentage = project.max_tokens > 0 
      ? Math.min(100, (project.token_usage / project.max_tokens) * 100).toFixed(1)
      : 0;
    
    // Create card
    const card = window.createElement("div", {
      className: `bg-white dark:bg-gray-700 rounded shadow p-4 border-l-4 
                  ${project.pinned ? "border-yellow-500" : "border-blue-500"}
                  ${project.archived ? "opacity-60" : ""}`
    });
    
    // Header with title and badges
    const header = window.createElement("div", {
      className: "flex justify-between mb-2"
    });
    
    header.appendChild(window.createElement("h3", {
      className: "font-semibold text-md"
    }, project.name));
    
    const badges = window.createElement("div", {
      className: "text-xs text-gray-500"
    });
    
    if (project.pinned) {
      badges.appendChild(window.createElement("span", {
        className: "text-yellow-600 mr-2"
      }, "📌"));
    }
    
    if (project.archived) {
      badges.appendChild(window.createElement("span", {
        className: "text-gray-600"
      }, "🗃️"));
    }
    
    header.appendChild(badges);
    card.appendChild(header);
    
    // Description
    card.appendChild(window.createElement("p", {
      className: "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2"
    }, project.description || "No description"));
    
    // Token usage bar
    const tokenWrapper = window.createElement("div", {
      className: "mb-2"
    });
    
    const tokenHeader = window.createElement("div", {
      className: "flex justify-between mb-1 text-xs"
    });
    
    tokenHeader.appendChild(window.createElement("span", {}, 
      `Tokens: ${formatNumber(project.token_usage)} / ${formatNumber(project.max_tokens)}`));
    
    tokenHeader.appendChild(window.createElement("span", {}, 
      `${usagePercentage}%`));
    
    tokenWrapper.appendChild(tokenHeader);
    
    const progressContainer = window.createElement("div", {
      className: "w-full bg-gray-200 rounded-full h-1.5"
    });
    
    progressContainer.appendChild(window.createElement("div", {
      className: "bg-blue-600 h-1.5 rounded-full",
      style: `width: ${usagePercentage}%`
    }));
    
    tokenWrapper.appendChild(progressContainer);
    card.appendChild(tokenWrapper);
    
    // Footer with date and actions
    const footer = window.createElement("div", {
      className: "flex justify-between mt-3"
    });
    
    footer.appendChild(window.createElement("div", {
      className: "text-xs text-gray-500"
    }, `Created ${formatDate(project.created_at)}`));
    
    const actions = window.createElement("div", {
      className: "flex space-x-1"
    });
    
    // View button
    const viewBtn = window.createElement("button", {
      className: "p-1 text-blue-600 hover:text-blue-800 view-project-btn",
      dataset: { projectId: project.id }
    });
    
    viewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>`;
    
    actions.appendChild(viewBtn);
    
    // Delete button
    const deleteBtn = window.createElement("button", {
      className: "p-1 text-red-600 hover:text-red-800 delete-project-btn",
      dataset: { 
        projectId: project.id,
        projectName: project.name
      }
    });
    
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>`;
    
    actions.appendChild(deleteBtn);
    footer.appendChild(actions);
    card.appendChild(footer);
    
    return card;
  }
  
  /**
   * Render project details
   */
  function renderProjectDetails(event) {
    const project = event.detail;
    
    // Update title
    document.getElementById("projectTitle").textContent = project.name;
    
    // Update description
    document.getElementById("projectDescription").textContent = 
      project.description || "No description provided.";
    
    // Update goals
    document.getElementById("projectGoals").textContent = 
      project.goals || "No goals defined.";
    
    // Update instructions
    document.getElementById("projectInstructions").textContent = 
      project.custom_instructions || "No custom instructions set.";
    
    // Update pin button
    const pinBtn = document.getElementById("pinProjectBtn");
    if (pinBtn) {
      pinBtn.querySelector("svg").setAttribute("fill", project.pinned ? "currentColor" : "none");
      pinBtn.classList.toggle("text-yellow-600", project.pinned);
    }
    
    // Update archive button
    const archiveBtn = document.getElementById("archiveProjectBtn");
    if (archiveBtn) {
      archiveBtn.querySelector("svg").setAttribute("fill", project.archived ? "currentColor" : "none");
      archiveBtn.classList.toggle("text-gray-800", project.archived);
    }
  }
  
  /**
   * Render project stats
   */
  function renderProjectStats(event) {
    const stats = event.detail;
    
    // Update token usage stats
    document.getElementById("tokenUsage").textContent = formatNumber(stats.token_usage);
    document.getElementById("maxTokens").textContent = formatNumber(stats.max_tokens);
    
    const percentage = stats.max_tokens > 0 
      ? Math.min(100, (stats.token_usage / stats.max_tokens) * 100).toFixed(1)
      : 0;
      
    document.getElementById("tokenPercentage").textContent = `${percentage}%`;
    document.getElementById("tokenProgressBar").style.width = `${percentage}%`;
    
    // Update counters
    document.getElementById("conversationCount").textContent = stats.conversation_count;
    document.getElementById("fileCount").textContent = stats.file_count;
    document.getElementById("artifactCount").textContent = stats.artifact_count;
  }
  
  /**
   * Render project files
   */
  function renderProjectFiles(event) {
    const files = event.detail?.files || [];
    const filesList = document.getElementById("projectFilesList");
    
    if (!filesList) return;
    
    if (files.length === 0) {
      filesList.innerHTML = '<div class="text-gray-500 text-center py-8">No files uploaded yet.</div>';
      return;
    }
    
    filesList.innerHTML = "";
    
    files.forEach(file => {
      const fileItem = window.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded"
      });
      
      // File info
      const infoDiv = window.createElement("div", {
        className: "flex items-center"
      });
      
      infoDiv.appendChild(window.createElement("span", {
        className: "text-lg mr-2"
      }, getFileIcon(file.file_type)));
      
      const detailsDiv = window.createElement("div");
      detailsDiv.appendChild(window.createElement("div", {
        className: "font-medium"
      }, file.filename));
      
      detailsDiv.appendChild(window.createElement("div", {
        className: "text-xs text-gray-500"
      }, `${window.formatBytes(file.file_size)} • ${formatDate(file.created_at)}`));
      
      infoDiv.appendChild(detailsDiv);
      fileItem.appendChild(infoDiv);
      
      // Action buttons
      const buttonsDiv = window.createElement("div", {
        className: "flex space-x-2"
      });
      
      const viewBtn = window.createElement("button", {
        className: "text-gray-600 hover:text-gray-800 view-file-btn",
        dataset: { fileId: file.id }
      });
      
      viewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>`;
      
      buttonsDiv.appendChild(viewBtn);
      
      const deleteBtn = window.createElement("button", {
        className: "text-red-600 hover:text-red-800 delete-file-btn",
        dataset: { 
          fileId: file.id,
          filename: file.filename
        }
      });
      
      deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>`;
      
      buttonsDiv.appendChild(deleteBtn);
      fileItem.appendChild(buttonsDiv);
      
      filesList.appendChild(fileItem);
    });
  }
  
  /**
   * Render project conversations
   */
  function renderProjectConversations(event) {
    const conversations = event.detail?.conversations || [];
    const conversationsList = document.getElementById("projectConversationsList");
    
    if (!conversationsList) return;
    
    if (conversations.length === 0) {
      conversationsList.innerHTML = '<div class="text-gray-500 text-center py-8">No conversations yet.</div>';
      return;
    }
    
    conversationsList.innerHTML = "";
    
    conversations.forEach(conversation => {
      const item = window.createElement("div", {
        className: "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded"
      });
      
      const infoDiv = window.createElement("div");
      infoDiv.appendChild(window.createElement("div", {
        className: "font-medium"
      }, conversation.title));
      
      infoDiv.appendChild(window.createElement("div", {
        className: "text-xs text-gray-500"
      }, formatDate(conversation.created_at, true)));
      
      item.appendChild(infoDiv);
      
      const openBtn = window.createElement("button", {
        className: "px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm open-conversation-btn",
        dataset: { conversationId: conversation.id }
      }, "Open");
      
      item.appendChild(openBtn);
      conversationsList.appendChild(item);
    });
  }
  
  /**
   * Render project artifacts
   */
  function renderProjectArtifacts(event) {
    const artifacts = event.detail?.artifacts || [];
    const artifactsList = document.getElementById("projectArtifactsList");
    
    if (!artifactsList) return;
    
    if (artifacts.length === 0) {
      artifactsList.innerHTML = '<div class="text-gray-500 text-center py-8">No artifacts generated yet.</div>';
      return;
    }
    
    artifactsList.innerHTML = "";
    
    artifacts.forEach(artifact => {
      const item = window.createElement("div", {
        className: "p-3 bg-gray-50 dark:bg-gray-700 rounded"
      });
      
      const header = window.createElement("div", {
        className: "flex items-center justify-between mb-2"
      });
      
      const titleDiv = window.createElement("div", {
        className: "flex items-center"
      });
      
      titleDiv.appendChild(window.createElement("span", {
        className: "text-lg mr-2"
      }, getArtifactIcon(artifact.content_type)));
      
      titleDiv.appendChild(window.createElement("div", {
        className: "font-medium"
      }, artifact.name));
      
      header.appendChild(titleDiv);
      
      header.appendChild(window.createElement("div", {
        className: "text-xs text-gray-500"
      }, formatDate(artifact.created_at)));
      
      item.appendChild(header);
      
      const actions = window.createElement("div", {
        className: "flex justify-end space-x-2 mt-2"
      });
      
      const viewBtn = window.createElement("button", {
        className: "px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-100 view-artifact-btn",
        dataset: { artifactId: artifact.id }
      }, "View");
      
      actions.appendChild(viewBtn);
      
      const deleteBtn = window.createElement("button", {
        className: "px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 delete-artifact-btn",
        dataset: { 
          artifactId: artifact.id,
          name: artifact.name
        }
      }, "Delete");
      
      actions.appendChild(deleteBtn);
      item.appendChild(actions);
      
      artifactsList.appendChild(item);
    });
  }
  
  /**
   * Utility: Format number with commas
   */
  function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  
  /**
   * Utility: Format date
   */
  function formatDate(dateString, showTime = false) {
    if (!dateString) return "";
    
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    
    const options = { year: "numeric", month: "short", day: "numeric" };
    if (showTime) {
      options.hour = "2-digit";
      options.minute = "2-digit";
    }
    
    return date.toLocaleDateString(undefined, options);
  }
  
  /**
   * Utility: Get icon for file type
   */
  function getFileIcon(fileType) {
    const icons = {
      "txt": "📄", "pdf": "📑", "doc": "📝", "docx": "📝", 
      "xlsx": "📊", "xls": "📊", "csv": "📊", 
      "jpg": "🖼️", "jpeg": "🖼️", "png": "🖼️", "gif": "🖼️", 
      "mp3": "🎵", "mp4": "🎬", "zip": "📦", 
      "json": "📋", "md": "📋"
    };
    
    return icons[fileType] || "📄";
  }
  
  /**
   * Utility: Get icon for artifact type
   */
  function getArtifactIcon(contentType) {
    const icons = {
      "code": "💻", "document": "📄", "image": "🖼️", 
      "audio": "🎵", "video": "🎬"
    };
    
    return icons[contentType] || "📄";
  }