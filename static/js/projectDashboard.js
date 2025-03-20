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
    document.addEventListener("projectLoaded", (e) => {
      document.getElementById("projectTitle").textContent = e.detail.name;
      document.getElementById("projectDescription").textContent = e.detail.description || "No description";
    });
    document.addEventListener("projectStatsLoaded", renderProjectStats);
    document.addEventListener("projectFilesLoaded", (e) => renderProjectFiles(e.detail));
    document.addEventListener("projectConversationsLoaded", (e) => renderProjectConversations(e.detail));
    document.addEventListener("projectArtifactsLoaded", (e) => renderProjectArtifacts(e.detail));
    
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
    if (!window.projectManager || !window.projectManager.currentProject) {
      window.showNotification?.("No project selected", "error");
      return;
    }
    
    const currentProject = window.projectManager.currentProject;
    
    // Create a modal for viewing the file
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
    modal.id = 'fileViewerModal';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto';
    
    // Loading state
    modalContent.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-semibold">Loading file...</h3>
        <button id="closeFileViewerBtn" class="text-gray-500 hover:text-gray-700">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="flex justify-center items-center h-32">
        <svg class="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Add event listener to close button
    document.getElementById('closeFileViewerBtn').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    // Fetch the file content
    window.apiRequest(`/api/projects/${currentProject.id}/files/${fileId}`)
      .then(response => {
        const file = response.data;
        
        // Update modal title
        modalContent.querySelector('h3').textContent = file.filename;
        
        // Clear loading indicator
        modalContent.querySelector('.flex.justify-center').remove();
        
        // Create file content display
        const contentDisplay = document.createElement('div');
        contentDisplay.className = 'mt-4';
        
        if (file.content === null) {
          // File content not available
          contentDisplay.innerHTML = `
            <div class="bg-yellow-50 p-4 rounded">
              <p class="text-yellow-700">File content cannot be displayed. The file may be binary or too large.</p>
              <p class="text-yellow-600 mt-2">File type: ${file.file_type}, Size: ${formatBytes(file.file_size)}</p>
            </div>
          `;
        } else {
          // Display text content
          contentDisplay.innerHTML = `
            <div class="flex justify-between items-center mb-2">
              <div>
                <span class="text-gray-500 text-sm">Type: ${file.file_type}</span>
                <span class="text-gray-500 text-sm ml-4">Size: ${formatBytes(file.file_size)}</span>
              </div>
              <button id="copyFileContentBtn" class="text-blue-600 hover:text-blue-800 text-sm">Copy Content</button>
            </div>
            <pre class="bg-gray-50 dark:bg-gray-700 p-4 rounded overflow-x-auto whitespace-pre-wrap"><code>${escapeHtml(file.content)}</code></pre>
          `;
        }
        
        modalContent.appendChild(contentDisplay);
        
        // Add copy functionality if content is available
        if (file.content) {
          document.getElementById('copyFileContentBtn').addEventListener('click', () => {
            navigator.clipboard.writeText(file.content)
              .then(() => {
                window.showNotification?.('File content copied to clipboard', 'success');
              })
              .catch(err => {
                console.error('Failed to copy: ', err);
                window.showNotification?.('Failed to copy to clipboard', 'error');
              });
          });
        }
      })
      .catch(error => {
        console.error('Error fetching file:', error);
        modalContent.innerHTML = `
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-semibold">Error</h3>
            <button id="closeFileViewerBtn" class="text-gray-500 hover:text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="bg-red-50 p-4 rounded">
            <p class="text-red-700">Failed to load file. Please try again later.</p>
          </div>
        `;
        
        // Reattach close button event
        document.getElementById('closeFileViewerBtn').addEventListener('click', () => {
          document.body.removeChild(modal);
        });
      });
  }
  
  /**
   * View artifact contents
   */
  function viewArtifact(artifactId) {
    if (!window.projectManager || !window.projectManager.currentProject) {
      window.showNotification?.("No project selected", "error");
      return;
    }
    
    const currentProject = window.projectManager.currentProject;
    
    // Create a modal for viewing the artifact
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
    modal.id = 'artifactViewerModal';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto';
    
    // Loading state
    modalContent.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-semibold">Loading artifact...</h3>
        <button id="closeArtifactViewerBtn" class="text-gray-500 hover:text-gray-700">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="flex justify-center items-center h-32">
        <svg class="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
      </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Add event listener to close button
    document.getElementById('closeArtifactViewerBtn').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    
    // Fetch the artifact content
    window.apiRequest(`/api/projects/${currentProject.id}/artifacts/${artifactId}`)
      .then(response => {
        const artifact = response.data;
        
        // Update modal title
        modalContent.querySelector('h3').textContent = artifact.name;
        
        // Clear loading indicator
        modalContent.querySelector('.flex.justify-center').remove();
        
        // Create artifact content display
        const contentDisplay = document.createElement('div');
        contentDisplay.className = 'mt-4';
        
        // Display content based on content type
        switch (artifact.content_type) {
          case 'code':
            contentDisplay.innerHTML = `
              <div class="flex justify-between items-center mb-2">
                <span class="text-gray-500 text-sm">Code Artifact</span>
                <button id="copyArtifactContentBtn" class="text-blue-600 hover:text-blue-800 text-sm">Copy Content</button>
              </div>
              <pre class="bg-gray-50 dark:bg-gray-700 p-4 rounded overflow-x-auto whitespace-pre-wrap"><code>${escapeHtml(artifact.content)}</code></pre>
            `;
            break;
            
          case 'document':
            contentDisplay.innerHTML = `
              <div class="flex justify-between items-center mb-2">
                <span class="text-gray-500 text-sm">Document</span>
                <button id="copyArtifactContentBtn" class="text-blue-600 hover:text-blue-800 text-sm">Copy Content</button>
              </div>
              <div class="bg-white dark:bg-gray-700 p-4 rounded border dark:border-gray-600">
                ${escapeHtml(artifact.content)}
              </div>
            `;
            break;
            
          default:
            contentDisplay.innerHTML = `
              <div class="flex justify-between items-center mb-2">
                <span class="text-gray-500 text-sm">Content Type: ${artifact.content_type}</span>
                <button id="copyArtifactContentBtn" class="text-blue-600 hover:text-blue-800 text-sm">Copy Content</button>
              </div>
              <pre class="bg-gray-50 dark:bg-gray-700 p-4 rounded overflow-x-auto whitespace-pre-wrap">${escapeHtml(artifact.content)}</pre>
            `;
        }
        
        modalContent.appendChild(contentDisplay);
        
        // Add copy functionality
        document.getElementById('copyArtifactContentBtn')?.addEventListener('click', () => {
          navigator.clipboard.writeText(artifact.content)
            .then(() => {
              window.showNotification?.('Artifact content copied to clipboard', 'success');
            })
            .catch(err => {
              console.error('Failed to copy: ', err);
              window.showNotification?.('Failed to copy to clipboard', 'error');
            });
        });
      })
      .catch(error => {
        console.error('Error fetching artifact:', error);
        modalContent.innerHTML = `
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-semibold">Error</h3>
            <button id="closeArtifactViewerBtn" class="text-gray-500 hover:text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="bg-red-50 p-4 rounded">
            <p class="text-red-700">Failed to load artifact. Please try again later.</p>
          </div>
        `;
        
        // Reattach close button event
        document.getElementById('closeArtifactViewerBtn').addEventListener('click', () => {
          document.body.removeChild(modal);
        });
      });
  }
  
  /**
   * Render projects list
   */
  function renderProjectsList(event) {
    console.log("renderProjectsList called with event:", event);
    const projects = event.detail;
    console.log("Projects to render:", projects);
    
    const projectList = document.getElementById("projectList");
    console.log("Project list element:", projectList);
    
    const noProjectsMessage = document.getElementById("noProjectsMessage");
    console.log("No projects message element:", noProjectsMessage);
    
    if (!projectList) {
      console.error("Project list element not found in DOM!");
      return;
    }
    
    projectList.innerHTML = "";
    
    if (!projects || projects.length === 0) {
      console.log("No projects to display");
      if (noProjectsMessage) {
        noProjectsMessage.classList.remove("hidden");
      }
      return;
    }
    
    if (noProjectsMessage) {
      noProjectsMessage.classList.add("hidden");
    }
    
    projects.forEach(project => {
      console.log("Creating card for project:", project);
      const card = createProjectCard(project);
      projectList.appendChild(card);
    });
    
    console.log("Projects rendering complete. Cards added:", projectList.children.length);
  }
  
  // Expose the function globally for direct access
  window.renderProjectsList = renderProjectsList;
  
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
                  ${project.archived ? "opacity-60" : ""}
                  w-full md:w-auto`
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
   * Render project files
   */
  function renderProjectFiles(files) {
    const container = document.getElementById("projectFilesList");
    if (!container) return;

    container.innerHTML = files.length > 0 ? '' : 
      '<div class="text-gray-500 text-center py-8">No files uploaded yet</div>';

    files.forEach(file => {
      const fileItem = document.createElement('div');
      fileItem.className = 'flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2';
      fileItem.innerHTML = `
        <div class="flex items-center">
          <span class="text-lg mr-2">${window.getFileTypeIcon(file.file_type)}</span>
          <div>
            <div class="font-medium">${file.filename}</div>
            <div class="text-xs text-gray-500">
              ${file.file_size ? window.formatBytes(file.file_size) : 'Unknown size'} • 
              ${file.created_at ? new Date(file.created_at).toLocaleDateString() : 'No date'}
            </div>
          </div>
        </div>
        <div class="flex space-x-2">
          <button class="view-file-btn text-blue-600 hover:text-blue-800" data-file-id="${file.id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
            </svg>
          </button>
          <button class="delete-file-btn text-red-600 hover:text-red-800" data-file-id="${file.id}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      `;
      container.appendChild(fileItem);
    });
    
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
  function renderProjectConversations(conversations) {
    const container = document.getElementById("projectConversationsList");
    if (!container) return;

    container.innerHTML = conversations.length > 0 ? '' : 
      '<div class="text-gray-500 text-center py-8">No conversations yet</div>';

    conversations.forEach(convo => {
      const item = document.createElement('div');
      item.className = 'flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2 project-conversation-item';
      item.innerHTML = `
        <div>
          <div class="font-medium">${convo.title}</div>
          <div class="text-xs text-gray-500">${new Date(convo.created_at).toLocaleDateString()}</div>
        </div>
        <button class="open-conversation-btn px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                data-conversation-id="${convo.id}">
          Open
        </button>
      `;
      container.appendChild(item);
    });
  }
  
  /**
   * Render project artifacts
   */
  function renderProjectArtifacts(artifacts) {
    const container = document.getElementById("projectArtifactsList");
    if (!container) return;

    container.innerHTML = artifacts.length > 0 ? '' : 
      '<div class="text-gray-500 text-center py-8">No artifacts generated yet</div>';

    artifacts.forEach(artifact => {
      const card = document.createElement('div');
      card.className = 'bg-white dark:bg-gray-700 p-4 rounded shadow mb-2 artifact-card';
      card.innerHTML = `
        <div class="flex justify-between items-center">
          <div>
            <h4 class="font-medium">${artifact.name}</h4>
            <p class="text-sm text-gray-500">${artifact.content_type}</p>
          </div>
          <div class="flex gap-2">
            <button class="view-artifact-btn text-blue-600 hover:text-blue-800"
                    data-artifact-id="${artifact.id}">
              View
            </button>
            <button class="delete-artifact-btn text-red-600 hover:text-red-800"
                    data-artifact-id="${artifact.id}">
              Delete
            </button>
          </div>
        </div>
      `;
      container.appendChild(card);
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
  
  /**
   * Helper function to format bytes to human-readable format
   */
  function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
  
  /**
   * Helper function to escape HTML in strings
   */
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

    // Add these functions to the end of the file, before the last closing brace
  window.renderProjectDetails = function(event) {
    const project = event.detail;
    
    // Update title with indicator for archived projects
    document.getElementById("projectTitle").innerHTML = project.name + 
      (project.archived ? ' <span class="ml-2 px-2 py-0.5 bg-gray-200 text-gray-600 text-xs rounded">Archived</span>' : '');
    
    // Update description with proper fallback
    const descEl = document.getElementById("projectDescription");
    if (descEl) {
      if (project.description) {
        descEl.textContent = project.description;
      } else {
        descEl.innerHTML = '<em class="text-gray-400">No description provided.</em>';
      }
    }
    
    // Update goals with proper fallback and formatting
    const goalsEl = document.getElementById("projectGoals");
    if (goalsEl) {
      if (project.goals) {
        // Format goals as bullet points if they contain line breaks
        if (project.goals.includes('\n')) {
          const goalsList = project.goals.split('\n').filter(g => g.trim());
          goalsEl.innerHTML = goalsList.map(goal => 
            `<div class="mb-1">• ${goal.trim()}</div>`
          ).join('');
        } else {
          goalsEl.textContent = project.goals;
        }
      } else {
        goalsEl.innerHTML = '<em class="text-gray-400">No goals defined.</em>';
      }
    }
    
    // Update instructions with proper fallback
    const instructionsEl = document.getElementById("projectInstructions");
    if (instructionsEl) {
      if (project.custom_instructions) {
        instructionsEl.textContent = project.custom_instructions;
      } else {
        instructionsEl.innerHTML = '<em class="text-gray-400">No custom instructions set.</em>';
      }
    }
    
    // Update pin button
    const pinBtn = document.getElementById("pinProjectBtn");
    if (pinBtn) {
      pinBtn.querySelector("svg").setAttribute("fill", project.pinned ? "currentColor" : "none");
      pinBtn.classList.toggle("text-yellow-600", project.pinned);
      // Add tooltip
      pinBtn.setAttribute("title", project.pinned ? "Unpin project" : "Pin project");
    }
    
    // Update archive button
    const archiveBtn = document.getElementById("archiveProjectBtn");
    if (archiveBtn) {
      archiveBtn.querySelector("svg").setAttribute("fill", project.archived ? "currentColor" : "none");
      archiveBtn.classList.toggle("text-gray-800", project.archived);
      // Add tooltip
      archiveBtn.setAttribute("title", project.archived ? "Unarchive project" : "Archive project");
    }
    
    // Disable pin button if project is archived
    if (pinBtn && project.archived) {
      pinBtn.disabled = true;
      pinBtn.classList.add("opacity-50", "cursor-not-allowed");
    } else if (pinBtn) {
      pinBtn.disabled = false;
      pinBtn.classList.remove("opacity-50", "cursor-not-allowed");
    }
  };

  window.renderProjectStats = function(event) {
    const stats = event.detail;
    
    // Format numbers for better readability
    document.getElementById("tokenUsage").textContent = formatNumber(stats.token_usage);
    document.getElementById("maxTokens").textContent = formatNumber(stats.max_tokens);
    
    const percentage = stats.max_tokens > 0 
      ? Math.min(100, (stats.token_usage / stats.max_tokens) * 100).toFixed(1)
      : 0;
      
    document.getElementById("tokenPercentage").textContent = `${percentage}%`;
    
    // Set progress bar with color indication based on usage
    const progressBar = document.getElementById("tokenProgressBar");
    progressBar.style.width = `${percentage}%`;
    
    // Apply color based on usage level
    if (percentage > 90) {
      progressBar.classList.remove("bg-blue-600", "bg-yellow-500");
      progressBar.classList.add("bg-red-600");
    } else if (percentage > 70) {
      progressBar.classList.remove("bg-blue-600", "bg-red-600");
      progressBar.classList.add("bg-yellow-500");
    } else {
      progressBar.classList.remove("bg-yellow-500", "bg-red-600");
      progressBar.classList.add("bg-blue-600");
    }
    
    // Update counters with animations for better feedback
    animateCounter("conversationCount", stats.conversation_count);
    animateCounter("fileCount", stats.file_count);
    animateCounter("artifactCount", stats.artifact_count);
  };

  // Helper function to animate counter values
  window.animateCounter = function(id, targetValue) {
    const element = document.getElementById(id);
    if (!element) return;
    
    const currentValue = parseInt(element.textContent) || 0;
    const diff = targetValue - currentValue;
    
    if (diff === 0) return;
    
    // For small differences, just update the value
    if (Math.abs(diff) <= 5) {
      element.textContent = targetValue;
      return;
    }
    
    // For larger differences, animate the change
    let step = diff > 0 ? 1 : -1;
    let current = currentValue;
    
    const interval = setInterval(() => {
      current += step;
      element.textContent = current;
      
      if ((diff > 0 && current >= targetValue) || (diff < 0 && current <= targetValue)) {
        clearInterval(interval);
        element.textContent = targetValue;
      }
    }, 50);
  };

  // File uploads related functions
  window.renderProjectFiles = function(event) {
    // [Paste the full content of the renderProjectFiles function here]
  };

  window.updateUploadProgress = function(completed, errors, total) {
    // [Paste the full content of the updateUploadProgress function here]
  };

  window.handleFileUpload = function(e) {
    // [Paste the full content of the handleFileUpload function here]
  };

  // Conversations related functions
  window.renderProjectConversations = function(event) {
    // [Paste the full content of the renderProjectConversations function here]
  };

  window.startNewConversation = function() {
    // [Paste the full content of the startNewConversation function here]
  };

  // Artifacts related functions
  window.renderProjectArtifacts = function(event) {
    // [Paste the full content of the renderProjectArtifacts function here]
  };

  window.viewArtifact = function(artifactId) {
    // [Paste the full content of the viewArtifact function here]
  };

  // Additional utility functions
  function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) {
      return "Just now";
    } else if (diffMin < 60) {
      return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    } else if (diffHour < 24) {
      return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
    } else if (diffDay < 7) {
      return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
    } else {
      return formatDate(date, false);
    }
  }

  function formatDocumentContent(content) {
    if (!content) return '';
    
    // Simple markdown-like formatting
    const formatted = content
      // Headers
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold mb-2">$1</h1>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mb-2">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold mb-2">$1</h3>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // Line breaks
      .replace(/\n/g, '<br>');
    
    return formatted;
  }
