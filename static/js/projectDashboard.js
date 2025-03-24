 /**
 * projectDashboard.js
 * -------------------
 * Handles all DOM manipulation and UI event handling:
 * - Setting up click handlers, forms, and modals
 * - Listening to events from projectManager.js (e.g., "projectsLoaded")
 * - Rendering the updated data into the page
 */

// Wait for DOM to be fully loaded and available
let domReady = false;
let pendingInitialization = null;

document.addEventListener("DOMContentLoaded", () => {
  domReady = true;
  if (pendingInitialization) {
    pendingInitialization();
  }
});

// Initialize the dashboard
function initializeDashboard() {
  const initialization = () => {
    // Verify critical elements exist
    const projectListView = document.getElementById("projectListView");
    const projectDetailsView = document.getElementById("projectDetailsView");

    if (!projectListView || !projectDetailsView) {
      console.error("Critical project view elements not found. Retrying in 1000ms...");
      setTimeout(initializeDashboard, 1000);
      return;
    }

    // 1. Parse URL to see if we need to auto-load a specific project
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get("project");

    if (projectId) {
      showProjectDetailsView().then(success => {
        if (success) {
          projectManager.loadProjectDetails(projectId);
        } else {
          console.error("Failed to show project details view");
          window.showNotification?.("Failed to load project details", "error");
        }
      });
    } else {
      showProjectListView().then(success => {
        if (success) {
          projectManager.loadProjects();
        } else {
          console.error("Failed to show project list view");
          window.showNotification?.("Failed to load projects view", "error");
        }
      });
    }

    // 2. Set up top-level event listeners (buttons, forms, etc.)
    setupGlobalEventListeners();

    // 3. Listen to the custom events dispatched by projectManager.js
    registerDataEventListeners();

    console.log("Dashboard initialized successfully");
  };

  if (!domReady) {
    pendingInitialization = initialization;
  } else {
    initialization();
  }
}

// Start initialization
initializeDashboard();

/**
 * Sets up event listeners for global UI elements: forms, buttons, etc.
 */
function setupGlobalEventListeners() {
  // Nav: Back to projects
  document.getElementById("backToProjectsBtn")?.addEventListener("click", async () => {
      if (await showProjectListView()) {
          projectManager.loadProjects();
      } else {
          window.showNotification?.("Failed to switch view. Please try again.", "error");
      }
  });

  // Create new project
  document.getElementById("createProjectBtn")?.addEventListener("click", () => {
    showModal("projectFormModal");
    // Clear the form for creation
    clearProjectForm();
  });
  document.getElementById("closeProjectFormBtn")?.addEventListener("click", () => hideModal("projectFormModal"));
  document.getElementById("cancelProjectFormBtn")?.addEventListener("click", () => hideModal("projectFormModal"));

  // Project form submission (create or update)
  document.getElementById("projectForm")?.addEventListener("submit", handleProjectFormSubmit);

  // Edit project
  document.getElementById("editProjectBtn")?.addEventListener("click", () => {
    if (projectManager.currentProject) {
      populateProjectForm(projectManager.currentProject);
    }
  });

  // Pin/unpin
  document.getElementById("pinProjectBtn")?.addEventListener("click", () => {
    const p = projectManager.currentProject;
    if (!p) return;
    projectManager.togglePinProject(p.id)
      .then((res) => {
        window.showNotification?.(
          res.data?.pinned ? "Project pinned" : "Project unpinned", 
          "success"
        );
        projectManager.loadProjectDetails(p.id);
      })
      .catch((err) => {
        console.error("Error pinning project:", err);
        window.showNotification?.("Failed to update project", "error");
      });
  });

  // Archive/unarchive
  document.getElementById("archiveProjectBtn")?.addEventListener("click", () => {
    const p = projectManager.currentProject;
    if (!p) return;
    projectManager.toggleArchiveProject(p.id)
      .then((res) => {
        window.showNotification?.(
          res.data?.archived ? "Project archived" : "Project unarchived",
          "success"
        );
        projectManager.loadProjectDetails(p.id);
      })
      .catch((err) => {
        console.error("Error archiving project:", err);
        window.showNotification?.("Failed to update project", "error");
      });
  });

  // Tabs
  document.querySelectorAll(".project-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchProjectTab(btn.dataset.tab));
  });

  // Project filters
  document.querySelectorAll(".project-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => filterProjects(btn.dataset.filter));
  });

  // Project search
  document.getElementById("projectSearchInput")?.addEventListener("input", (e) => {
    searchProjects(e.target.value);
  });

  // Custom instructions
  document.getElementById("editInstructionsBtn")?.addEventListener("click", () => {
    const p = projectManager.currentProject;
    if (!p) {
      window.showNotification?.("No project selected", "error");
      return;
    }
    document.getElementById("customInstructionsInput").value = p.custom_instructions || "";
    showModal("instructionsModal");
  });
  document.getElementById("closeInstructionsBtn")?.addEventListener("click", () => hideModal("instructionsModal"));
  document.getElementById("cancelInstructionsBtn")?.addEventListener("click", () => hideModal("instructionsModal"));
  document.getElementById("saveInstructionsBtn")?.addEventListener("click", () => {
    const p = projectManager.currentProject;
    if (!p) return;
    const instructions = document.getElementById("customInstructionsInput").value;
    projectManager.saveCustomInstructions(p.id, instructions)
      .then(() => {
        window.showNotification?.("Custom instructions saved", "success");
        hideModal("instructionsModal");
        // Update local copy
        p.custom_instructions = instructions;
        document.getElementById("projectInstructions").textContent = instructions || "No custom instructions set.";
      })
      .catch((err) => {
        console.error("Error saving instructions:", err);
        window.showNotification?.("Failed to save instructions", "error");
      });
  });

  // File upload
  document.getElementById("uploadFileBtn")?.addEventListener("click", () => {
    document.getElementById("fileInput")?.click();
  });
  document.getElementById("fileInput")?.addEventListener("change", handleFileUpload);

  // Confirmation modal (just hides modal if canceled)
  document.getElementById("cancelDeleteBtn")?.addEventListener("click", () => hideModal("deleteConfirmModal"));

  // New conversation
  document.getElementById("newConversationBtn")?.addEventListener("click", startNewConversation);
}

/**
 * Listen to custom events from projectManager.js to render data.
 */
function registerDataEventListeners() {
  // Projects list loaded
  document.addEventListener("projectsLoaded", (e) => renderProjectsList(e.detail));
  // Single project loaded
    document.addEventListener("projectLoaded", (e) => {
        setTimeout(() => {
            renderProjectDetails(e.detail);
        }, 500); // Add 500ms delay
    });
    // Stats loaded
    document.addEventListener("projectStatsLoaded", (e) => {
        setTimeout(() => {
            renderProjectStats(e.detail);
        }, 500);
    });  // Add 500ms delay
  // Files loaded
  document.addEventListener("projectFilesLoaded", (e) => renderProjectFiles(e.detail.files));
  // Conversations loaded
  document.addEventListener("projectConversationsLoaded", (e) => renderProjectConversations(e.detail));
  // Artifacts loaded
  document.addEventListener("projectArtifactsLoaded", (e) => renderProjectArtifacts(e.detail.artifacts));
}

/**
 * Render the list of conversations for a project
 */
function renderProjectConversations(data) {
  const list = document.getElementById("projectConversationsList");
  if (!list) return;

  if (!data || !data.conversations || data.conversations.length === 0) {
    list.innerHTML = `<div class="text-gray-500 text-center py-8">No conversations yet.</div>`;
    return;
  }

  list.innerHTML = "";
  data.conversations.forEach(conversation => {
    const item = document.createElement("div");
    item.className = "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2";
    
    // Info section
    const infoDiv = document.createElement("div");
    infoDiv.className = "flex items-center";
    
    const detailDiv = document.createElement("div");
    detailDiv.className = "flex flex-col";
    
    const titleDiv = document.createElement("div");
    titleDiv.className = "font-medium";
    titleDiv.textContent = conversation.title || `Conversation ${conversation.id}`;
    
    const infoText = document.createElement("div");
    infoText.className = "text-xs text-gray-500";
    infoText.textContent = `${conversation.message_count || 0} messages · ${formatDate(conversation.created_at)}`;
    
    detailDiv.appendChild(titleDiv);
    detailDiv.appendChild(infoText);
    infoDiv.appendChild(detailDiv);
    item.appendChild(infoDiv);
    
    // Actions section
    const actions = document.createElement("div");
    actions.className = "flex space-x-2";
    
    // View conversation button
    const viewBtn = document.createElement("a");
    viewBtn.href = `/?chatId=${conversation.id}`;
    viewBtn.className = "text-blue-600 hover:text-blue-800";
    viewBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    `;
    
    actions.appendChild(viewBtn);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

/**
 * Render the list of artifacts for a project
 */
function renderProjectArtifacts(artifacts) {
  const list = document.getElementById("projectArtifactsList");
  if (!list) return;

  if (!artifacts || artifacts.length === 0) {
    list.innerHTML = `<div class="text-gray-500 text-center py-8">No artifacts generated yet.</div>`;
    return;
  }

  list.innerHTML = "";
  artifacts.forEach(artifact => {
    const item = document.createElement("div");
    item.className = "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2";
    
    // Info section
    const infoDiv = document.createElement("div");
    infoDiv.className = "flex items-center";
    
    const iconSpan = document.createElement("span");
    iconSpan.className = "text-lg mr-2";
    iconSpan.textContent = artifactIcon(artifact.content_type);
    infoDiv.appendChild(iconSpan);
    
    const detailDiv = document.createElement("div");
    detailDiv.className = "flex flex-col";
    
    const titleDiv = document.createElement("div");
    titleDiv.className = "font-medium";
    titleDiv.textContent = artifact.name || `Artifact ${artifact.id}`;
    
    const infoText = document.createElement("div");
    infoText.className = "text-xs text-gray-500";
    infoText.textContent = `${formatDate(artifact.created_at)} · From conversation ${artifact.conversation_id}`;
    
    detailDiv.appendChild(titleDiv);
    detailDiv.appendChild(infoText);
    infoDiv.appendChild(detailDiv);
    item.appendChild(infoDiv);
    
    // Actions section
    const actions = document.createElement("div");
    actions.className = "flex space-x-2";
    
    // View button
    const viewBtn = document.createElement("button");
    viewBtn.className = "text-blue-600 hover:text-blue-800";
    viewBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    `;
    viewBtn.addEventListener("click", () => {
      const modal = createViewModal(artifact.name, "Loading artifact content...");
      if (modal.modalContent) {
        modal.modalContent.innerHTML = `<pre class="whitespace-pre-wrap">${escapeHtml(artifact.content)}</pre>`;
      }
    });
    
    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "text-red-600 hover:text-red-800";
    deleteBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    `;
    deleteBtn.addEventListener("click", () => confirmDeleteArtifact(artifact.id, artifact.name));
    
    actions.appendChild(viewBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

/* --------------------------
   UI Visibility / Modal Helpers
--------------------------- */

/**
 * Switch to project list view with retry mechanism and element verification
 * @returns {Promise<boolean>} - Resolves to true if successful
 */
async function showProjectListView(retryCount = 0) {
  const maxRetries = 5;
  const retryDelay = 1000;

  // Try to get required elements
  const elements = {
    projectListView: document.getElementById("projectListView"),
    projectDetailsView: document.getElementById("projectDetailsView")
  };

  // Check if any required elements are missing
  const missingElements = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  // If elements are missing and we haven't exceeded retries, try again
  if (missingElements.length > 0 && retryCount < maxRetries) {
    console.log(`Waiting for elements (attempt ${retryCount + 1}/${maxRetries}): ${missingElements.join(", ")}`);
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(showProjectListView(retryCount + 1));
      }, retryDelay);
    });
  }

  // If we've exceeded retries, log error and return
  if (missingElements.length > 0) {
    console.error(`Failed to find elements after ${maxRetries} retries:`, missingElements);
    return false;
  }

  // All elements found, switch views
  elements.projectListView.classList.remove("hidden");
  elements.projectDetailsView.classList.add("hidden");
  window.history.pushState({}, "", window.location.pathname);

  return true;
}

/**
 * Switch to project details view with retry mechanism and element verification
 * @param {number} retryCount - Number of retries attempted (internal use)
 * @returns {Promise<boolean>} - Resolves to true if successful
 */
async function showProjectDetailsView(retryCount = 0) {
    const maxRetries = 5;
    const retryDelay = 1000; // 1 second

    // Try to get all required elements
    const elements = {
        projectListView: document.getElementById("projectListView"),
        projectDetailsView: document.getElementById("projectDetailsView"),
        projectTitle: document.getElementById("projectTitle"),
        projectDescription: document.getElementById("projectDescription"),
        projectGoals: document.getElementById("projectGoals"),
        projectInstructions: document.getElementById("projectInstructions"),
        tokenUsage: document.getElementById("tokenUsage"),
        maxTokens: document.getElementById("maxTokens"),
        tokenPercentage: document.getElementById("tokenPercentage"),
        tokenProgressBar: document.getElementById("tokenProgressBar"),
        conversationCount: document.getElementById("conversationCount"),
        fileCount: document.getElementById("fileCount"),
        artifactCount: document.getElementById("artifactCount")
    };

    // Check if any required elements are missing
    const missingElements = Object.entries(elements)
        .filter(([, element]) => !element)
        .map(([name]) => name);

    // If elements are missing and we haven't exceeded retries, try again
    if (missingElements.length > 0 && retryCount < maxRetries) {
        console.log(`Waiting for elements (attempt ${retryCount + 1}/${maxRetries}): ${missingElements.join(", ")}`);
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(showProjectDetailsView(retryCount + 1));
            }, retryDelay);
        });
    }

    // If we've exceeded retries, log error and return
    if (missingElements.length > 0) {
        console.error(`Failed to find elements after ${maxRetries} retries:`, missingElements);
        return false;
    }

    // All elements found, switch views
    elements.projectListView.classList.add("hidden");
    elements.projectDetailsView.classList.remove("hidden");

    return true;
}

function showModal(id) {
  document.getElementById(id)?.classList.remove("hidden");
}

function hideModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

/* --------------------------
   Project Form Logic
--------------------------- */

/**
 * Clear the project form for creating a new project.
 */
function clearProjectForm() {
  document.getElementById("projectIdInput").value = "";
  document.getElementById("projectNameInput").value = "";
  document.getElementById("projectDescInput").value = "";
  document.getElementById("projectGoalsInput").value = "";
  document.getElementById("projectMaxTokensInput").value = "200000";
  document.getElementById("projectFormTitle").textContent = "Create Project";
}

/**
 * Populate form fields from an existing project (for editing).
 */
function populateProjectForm(project) {
  document.getElementById("projectIdInput").value = project.id;
  document.getElementById("projectNameInput").value = project.name || "";
  document.getElementById("projectDescInput").value = project.description || "";
  document.getElementById("projectGoalsInput").value = project.goals || "";
  document.getElementById("projectMaxTokensInput").value = project.max_tokens || 200000;
  document.getElementById("projectFormTitle").textContent = "Edit Project";
  showModal("projectFormModal");
}

/**
 * Handle create/update form submit
 */
function handleProjectFormSubmit(e) {
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
    window.showNotification?.("Project name is required", "error");
    return;
  }

  projectManager.createOrUpdateProject(projectId, data)
    .then((response) => {
      hideModal("projectFormModal");
      window.showNotification?.(
        isEditing ? "Project updated successfully" : "Project created successfully",
        "success"
      );
      // Reload the project list
      projectManager.loadProjects();
    })
    .catch((err) => {
      console.error("Error saving project:", err);
      window.showNotification?.("Failed to save project", "error");
    });
}

/* --------------------------
   Project Deletion Flow
--------------------------- */

/**
 * Confirm delete project from anywhere in the UI. Then call projectManager.deleteProject().
 */
function confirmDeleteProject(projectId, projectName) {
  // Show a confirmation modal
  document.getElementById("deleteConfirmText").textContent =
    `Are you sure you want to delete the project "${projectName}"? This cannot be undone.`;
    
  document.getElementById("confirmDeleteBtn").onclick = () => {
    projectManager.deleteProject(projectId)
      .then(() => {
        window.showNotification?.("Project deleted", "success");
        hideModal("deleteConfirmModal");
        showProjectListView();
        projectManager.loadProjects();
      })
      .catch(err => {
        console.error("Error deleting project:", err);
        window.showNotification?.("Failed to delete project", "error");
      });
  };

  showModal("deleteConfirmModal");
}

/* --------------------------
   File Handling
--------------------------- */

/**
 * Handle file input change -> triggers file upload(s).
 */
function handleFileUpload(e) {
  const p = projectManager.currentProject;
  if (!p) return;

  const files = e.target.files;
  if (!files || !files.length) return;

  // Show upload progress UI
  document.getElementById("filesUploadProgress")?.classList.remove("hidden");
  const progressBar = document.getElementById("fileProgressBar");
  const uploadStatus = document.getElementById("uploadStatus");
  progressBar.style.width = "0%";
  uploadStatus.textContent = `Uploading 0/${files.length} files...`;

  let completed = 0;
  let failed = 0;

  [...files].forEach((file) => {
    projectManager.uploadFile(p.id, file)
      .then(() => {
        completed++;
        updateUploadProgress(completed, failed, files.length);
      })
      .catch(() => {
        failed++;
        completed++;
        updateUploadProgress(completed, failed, files.length);
      });
  });
}

/**
 * Update upload progress UI
 */
function updateUploadProgress(completed, errors, total) {
  const progressBar = document.getElementById("fileProgressBar");
  const uploadStatus = document.getElementById("uploadStatus");

  const percentage = Math.round((completed / total) * 100);
  if (progressBar) progressBar.style.width = `${percentage}%`;
  if (uploadStatus) {
    uploadStatus.textContent = `Uploading ${completed}/${total} files...`;
  }

  if (completed === total) {
    if (errors === 0) {
      uploadStatus.textContent = "Upload complete!";
      window.showNotification?.("Files uploaded successfully", "success");
    } else {
      uploadStatus.textContent = `Upload completed with ${errors} error(s)`;
      window.showNotification?.(`${errors} file(s) failed to upload`, "error");
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
      document.getElementById("filesUploadProgress")?.classList.add("hidden");
    }, 3000);
  }
}

/**
 * Confirm delete a file, then call manager.
 */
function confirmDeleteFile(fileId, fileName) {
  document.getElementById("deleteConfirmText").textContent =
    `Are you sure you want to delete the file "${fileName}"?`;
  
  document.getElementById("confirmDeleteBtn").onclick = () => {
    projectManager.deleteFile(projectManager.currentProject.id, fileId)
      .then(() => {
        window.showNotification?.("File deleted", "success");
        hideModal("deleteConfirmModal");
        projectManager.loadProjectFiles(projectManager.currentProject.id);
        projectManager.loadProjectStats(projectManager.currentProject.id);
      })
      .catch(err => {
        console.error("Error deleting file:", err);
        window.showNotification?.("Failed to delete file", "error");
      });
  };

  showModal("deleteConfirmModal");
}

/* --------------------------
   Conversation Handling
--------------------------- */

/**
 * Start a new conversation in the current project, redirect to the chat.
 */
function startNewConversation() {
  const p = projectManager.currentProject;
  if (!p) return;

  projectManager.createConversation(p.id)
    .then((res) => {
      const conversationId = res.data?.id;
      if (conversationId) {
        window.location.href = `/?chatId=${conversationId}`;
      } else {
        window.showNotification?.("Conversation created, but no ID returned", "warning");
      }
    })
    .catch((err) => {
      console.error("Error creating conversation:", err);
      window.showNotification?.("Failed to create conversation", "error");
    });
}

/**
 * Confirm delete a conversation if you have such a flow, then call an API, etc.
 * (Optional, depends on your UI).
 */

/* --------------------------
   Artifact Handling
--------------------------- */

/**
 * Confirm delete artifact, then call manager.
 */
function confirmDeleteArtifact(artifactId, name) {
  document.getElementById("deleteConfirmText").textContent =
    `Are you sure you want to delete the artifact "${name}"?`;
    
  document.getElementById("confirmDeleteBtn").onclick = () => {
    projectManager.deleteArtifact(projectManager.currentProject.id, artifactId)
      .then(() => {
        window.showNotification?.("Artifact deleted", "success");
        hideModal("deleteConfirmModal");
        projectManager.loadProjectArtifacts(projectManager.currentProject.id);
        projectManager.loadProjectStats(projectManager.currentProject.id);
      })
      .catch(err => {
        console.error("Error deleting artifact:", err);
        window.showNotification?.("Failed to delete artifact", "error");
      });
  };

  showModal("deleteConfirmModal");
}

/* --------------------------
   Data Rendering
--------------------------- */

/**
 * Render the projects list (triggered by "projectsLoaded").
 */
function renderProjectsList(projects) {
  const projectList = document.getElementById("projectList");
  const noProjectsMessage = document.getElementById("noProjectsMessage");
  if (!projectList) return;

  projectList.innerHTML = "";
  if (!projects || projects.length === 0) {
    if (noProjectsMessage) noProjectsMessage.classList.remove("hidden");
    return;
  }
  if (noProjectsMessage) noProjectsMessage.classList.add("hidden");

  projects.forEach(project => {
    const card = createProjectCard(project);
    projectList.appendChild(card);
  });
}

/**
 * Generate a single project card in the list view
 */
function createProjectCard(project) {
  // Basic usage percentage calculation
  const usage = project.token_usage || 0;
  const maxTokens = project.max_tokens || 0;
  const usagePct = maxTokens > 0 ? Math.min(100, (usage / maxTokens) * 100).toFixed(1) : 0;

    // Outer container
    const div = document.createElement("div");
    div.className = `bg-white dark:bg-gray-700 rounded shadow p-4 border-l-4 ${
      project.pinned ? "border-yellow-500" : "border-blue-500"
    } ${project.archived ? "opacity-60" : ""} w-full md:w-auto mb-2`;

    // Header
  const header = document.createElement("div");
  header.className = "flex justify-between mb-2";

  const title = document.createElement("h3");
  title.className = "font-semibold text-md";
  title.textContent = project.name;
  header.appendChild(title);

  // Badges
  const badges = document.createElement("div");
  badges.className = "text-xs text-gray-500";
  if (project.pinned) badges.appendChild(document.createTextNode("📌 "));
  if (project.archived) badges.appendChild(document.createTextNode("🗃️ "));
  header.appendChild(badges);

  div.appendChild(header);

  // Description
  const desc = document.createElement("p");
  desc.className = "text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2";
  desc.textContent = project.description || "No description";
  div.appendChild(desc);

  // Token usage
  const tokenWrapper = document.createElement("div");
  tokenWrapper.className = "mb-2";

  const tokenHeader = document.createElement("div");
  tokenHeader.className = "flex justify-between mb-1 text-xs";
  tokenHeader.innerHTML = `
    <span>Tokens: ${formatNumber(usage)} / ${formatNumber(maxTokens)}</span>
    <span>${usagePct}%</span>
  `;
  tokenWrapper.appendChild(tokenHeader);

  const progressOuter = document.createElement("div");
  progressOuter.className = "w-full bg-gray-200 rounded-full h-1.5";
  const progressInner = document.createElement("div");
  progressInner.className = "bg-blue-600 h-1.5 rounded-full";
  progressInner.style.width = `${usagePct}%`;
  progressOuter.appendChild(progressInner);
  tokenWrapper.appendChild(progressOuter);
  div.appendChild(tokenWrapper);

  // Footer
  const footer = document.createElement("div");
  footer.className = "flex justify-between mt-3";

  const createdInfo = document.createElement("div");
  createdInfo.className = "text-xs text-gray-500";
  createdInfo.textContent = `Created ${formatDate(project.created_at)}`;
  footer.appendChild(createdInfo);

  const actions = document.createElement("div");
  actions.className = "flex space-x-1";

    const viewBtn = document.createElement("button");
    viewBtn.className = "p-1 text-blue-600 hover:text-blue-800 view-project-btn flex items-center justify-center";
    viewBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
      <span class="loading-spinner hidden ml-1"></span>
    `;
  
    const loadingSpinner = viewBtn.querySelector('.loading-spinner');
    
    viewBtn.addEventListener("click", async () => {
      try {
        loadingSpinner.classList.remove('hidden');
        viewBtn.disabled = true;
        
        const viewSuccess = await showProjectDetailsView();
        if (viewSuccess) {
          await projectManager.loadProjectDetails(project.id);
        } else {
          window.showNotification?.("Failed to switch to project view. Please try again.", "error");
        }
      } catch (err) {
        console.error("Error loading project details:", err);
        window.showNotification?.("An error occurred while loading project details", "error");
      } finally {
        loadingSpinner.classList.add('hidden');
        viewBtn.disabled = false;
      }
    });
    
    actions.appendChild(viewBtn);

  // Delete
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "p-1 text-red-600 hover:text-red-800 delete-project-btn";
  deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
       d="M19 7l-.867 12.142A2 2 0 0116.138
       21H7.862a2 2 0 01-1.995-1.858L5 7m5
       4v6m4-6v6m1-10V4a1 1 0
       00-1-1h-4a1 1 0 00-1
       1v3M4 7h16" />
    </svg>`;
  deleteBtn.addEventListener("click", () => {
    confirmDeleteProject(project.id, project.name);
  });
  actions.appendChild(deleteBtn);

  footer.appendChild(actions);
  div.appendChild(footer);

  return div;
}

/**
 * Render details for a single project in the "projectDetailsView".
 */
function renderProjectDetails(project) {
    console.log("renderProjectDetails called with project:", project);
    const projectTitle = document.getElementById("projectTitle");
    const projectDescription = document.getElementById("projectDescription");
    const projectGoals = document.getElementById("projectGoals");
    const projectInstructions = document.getElementById("projectInstructions");

    if (projectTitle) {
        projectTitle.textContent = project.name;
    } else {
        console.error("projectTitle element not found");
    }
    if (projectDescription) {
        projectDescription.textContent =
        project.description || "No description provided.";
    } else {
        console.error("projectDescription element not found");
    }
    if (projectGoals) {
        projectGoals.textContent = project.goals || "No goals defined.";
    } else {
        console.error("projectGoals element not found");
    }

    if (projectInstructions) {
        projectInstructions.textContent =
        project.custom_instructions || "No custom instructions set.";
    } else {
        console.error("projectInstructions element not found");
    }

    // Pin/Archive button states
  const pinBtn = document.getElementById("pinProjectBtn");
  if (pinBtn) {
    const svg = pinBtn.querySelector("svg");
    if (svg) svg.setAttribute("fill", project.pinned ? "currentColor" : "none");
    pinBtn.classList.toggle("text-yellow-600", project.pinned);
  }

  const archiveBtn = document.getElementById("archiveProjectBtn");
  if (archiveBtn) {
    const svg = archiveBtn.querySelector("svg");
    if (svg) svg.setAttribute("fill", project.archived ? "currentColor" : "none");
    archiveBtn.classList.toggle("text-gray-800", project.archived);
  }
}

  /**
   * Render project stats with enhanced knowledge base information
   */
  function renderProjectStats(stats) {
      console.log("renderProjectStats called with stats:", stats);
      const tokenUsage = document.getElementById("tokenUsage");
      const maxTokens = document.getElementById("maxTokens");
      const tokenPercentage = document.getElementById("tokenPercentage");
      const tokenProgressBar = document.getElementById("tokenProgressBar");
      const conversationCount = document.getElementById("conversationCount");
      const fileCount = document.getElementById("fileCount");
      const artifactCount = document.getElementById("artifactCount");
      const kbInfoContainer = document.getElementById("knowledgeBaseInfo");

      if (tokenUsage) {
          tokenUsage.textContent = formatNumber(stats.token_usage || 0);
      } else {
          console.error("tokenUsage element not found");
      }
      if (maxTokens) {
          maxTokens.textContent = formatNumber(stats.max_tokens || 0);
      } else {
          console.error("maxTokens element not found");
      }
      const usage = stats.token_usage || 0;
      const maxT = stats.max_tokens || 0;
      const pct = maxT > 0 ? Math.min(100, (usage / maxT) * 100).toFixed(1) : 0;

      if (tokenPercentage) {
          tokenPercentage.textContent = `${pct}%`;
      } else {
          console.error("tokenPercentage element not found");
      }

      if (tokenProgressBar) {
          tokenProgressBar.style.width = `${pct}%`;
      } else {
          console.error("tokenProgressBar element not found");
      }

      // Update counters
      if (conversationCount) {
          conversationCount.textContent = stats.conversation_count || 0;
      } else {
          console.error("conversationCount element not found");
      }

      if (fileCount) {
          fileCount.textContent = stats.file_count || 0;
      } else {
          console.error("fileCount element not found");
      }

      if (artifactCount) {
          artifactCount.textContent = stats.artifact_count || 0;
      } else {
          console.error("artifactCount element not found");
      }

      // Update knowledge base info if available
      if (kbInfoContainer) {
          if (stats.knowledge_base) {
              const kb = stats.knowledge_base;

              // Create or update knowledge base info
              kbInfoContainer.innerHTML = `
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
                          style="width: ${stats.file_count ? Math.round((kb.indexed_files / stats.file_count) * 100) : 0}%">
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

              // Add event listener for reprocess button
              document.getElementById("reprocessFilesBtn")?.addEventListener("click", () => {
                  reprocessAllFiles(projectManager.currentProject.id);
              });

              kbInfoContainer.classList.remove("hidden");
          } else {
              // Show create knowledge base button
              kbInfoContainer.innerHTML = `
                  <div class="mb-2 font-medium">Knowledge Base</div>
                  <p class="text-sm text-gray-600 mb-3">
                      No knowledge base associated with this project. Create one to enable semantic search.
                  </p>
                  <button id="createKnowledgeBaseBtn" class="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
                      Create Knowledge Base
                  </button>
              `;

              // Add event listener for create button
              document.getElementById("createKnowledgeBaseBtn")?.addEventListener("click", () => {
                  showModal("knowledgeBaseSettingsModal");
              });

              kbInfoContainer.classList.remove("hidden");
          }
      } else {
          console.warn('kbInfoContainer not found');
      }
  }

  /**
 * Create a knowledge base for the current project
 */
function createKnowledgeBase(projectId, data) {
    if (!projectId) return;
    
    window.apiRequest(`/api/projects/${projectId}/knowledge-base`, "POST", data)
        .then((response) => {
            hideModal("knowledgeBaseSettingsModal");
            window.showNotification?.("Knowledge base created successfully", "success");
            
            // Reload project stats to show new knowledge base
            projectManager.loadProjectStats(projectId);
        })
        .catch((err) => {
            console.error("Error creating knowledge base:", err);
            window.showNotification?.("Failed to create knowledge base", "error");
        });
}

/**
 * Reprocess all files for search in the knowledge base
 */
function reprocessAllFiles(projectId) {
    if (!projectId) return;
    
    window.showNotification?.("Reprocessing files, this may take a moment...", "info");
    
    window.apiRequest(`/api/projects/${projectId}/files/reprocess`, "POST")
        .then((response) => {
            const data = response.data || {};
            window.showNotification?.(
                `Reprocessed ${data.processed_success || 0} files successfully. ${data.processed_failed || 0} failed.`,
                data.processed_failed ? "warning" : "success"
            );
            
            // Reload project stats to show updated processing status
            projectManager.loadProjectStats(projectId);
        })
        .catch((err) => {
            console.error("Error reprocessing files:", err);
            window.showNotification?.("Failed to reprocess files", "error");
        });
}

// Add event listener for knowledge base form submission
document.getElementById("knowledgeBaseForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    
    const formData = {
        name: document.getElementById("knowledgeBaseNameInput").value.trim(),
        description: document.getElementById("knowledgeBaseDescInput").value.trim(),
        embedding_model: document.getElementById("embeddingModelSelect").value,
        process_existing_files: document.getElementById("processAllFilesCheckbox").checked
    };
    
    createKnowledgeBase(projectManager.currentProject?.id, formData);
});

/**
 * Render the list of files
 */
function renderProjectFiles(files) {
  const filesList = document.getElementById("projectFilesList");
  if (!filesList) return;
  if (!files || files.length === 0) {
    filesList.innerHTML = `<div class="text-gray-500 text-center py-8">No files uploaded yet.</div>`;
    return;
  }

  filesList.innerHTML = "";
  files.forEach(file => {
    const item = document.createElement("div");
    item.className = "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2";

    // Info
    const infoDiv = document.createElement("div");
    infoDiv.className = "flex items-center";
    const iconSpan = document.createElement("span");
    iconSpan.className = "text-lg mr-2";
    iconSpan.textContent = fileIcon(file.file_type);
    infoDiv.appendChild(iconSpan);

    const detailDiv = document.createElement("div");
    detailDiv.className = "flex flex-col";
    
    const fileName = document.createElement("div");
    fileName.className = "font-medium";
    fileName.textContent = file.filename;
    
    const fileInfo = document.createElement("div");
    fileInfo.className = "text-xs text-gray-500";
    fileInfo.textContent = `${formatBytes(file.file_size)} · ${formatDate(file.created_at)}`;
    
    detailDiv.appendChild(fileName);
    detailDiv.appendChild(fileInfo);
    infoDiv.appendChild(detailDiv);
    item.appendChild(infoDiv);
    
    // Actions
    const actions = document.createElement("div");
    actions.className = "flex space-x-2";
    
    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "text-red-600 hover:text-red-800";
    deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>`;
    deleteBtn.addEventListener("click", () => confirmDeleteFile(file.id, file.filename));
    
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
    
    filesList.appendChild(item);
  });
}

function filterProjects(filter) {
  document.querySelectorAll(".project-filter-btn").forEach(btn => {
    const isActive = btn.dataset.filter === filter;
    btn.classList.toggle("border-b-2", isActive);
    btn.classList.toggle("border-blue-600", isActive);
    btn.classList.toggle("text-blue-600", isActive);
    btn.classList.toggle("text-gray-600", !isActive);
  });
  projectManager.loadProjects(filter);
}

function searchProjects(term) {
  const projectCards = document.querySelectorAll("#projectList > div");
  const noProjectsMessage = document.getElementById("noProjectsMessage");
  let visibleCount = 0;
  term = term.toLowerCase();

  projectCards.forEach(card => {
    const projectName = card.querySelector("h3")?.textContent.toLowerCase() || "";
    const projectDesc = card.querySelector("p")?.textContent.toLowerCase() || "";
    const isMatch = projectName.includes(term) || projectDesc.includes(term);
    card.classList.toggle("hidden", !isMatch);
    if (isMatch) visibleCount++;
  });

  if (noProjectsMessage) {
    if (visibleCount === 0) {
      noProjectsMessage.textContent = "No matching projects found.";
      noProjectsMessage.classList.remove("hidden");
    } else {
      noProjectsMessage.classList.add("hidden");
    }
  }
}

/* --------------------------
   Tab switching
--------------------------- */
function switchProjectTab(tabId) {
  document.querySelectorAll(".project-tab-btn").forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle("border-b-2", isActive);
    btn.classList.toggle("border-blue-600", isActive);
    btn.classList.toggle("text-blue-600", isActive);
    btn.classList.toggle("text-gray-500", !isActive);
  });

  document.querySelectorAll(".project-tab-content").forEach(tab => {
    tab.classList.toggle("hidden", tab.id !== `${tabId}Tab`);
  });

  if (projectManager.currentProject) {
    const projectId = projectManager.currentProject.id;
    // Load data if needed
    if (tabId === "files") {
      projectManager.loadProjectFiles(projectId);
    } else if (tabId === "conversations") {
      projectManager.loadProjectConversations(projectId);
      projectManager.loadProjectArtifacts(projectId);
    } else if (tabId === "artifacts") {
      projectManager.loadProjectArtifacts(projectId);
    }
  }
}

/* --------------------------
   Shared UI Helpers
--------------------------- */

/**
 * Create or retrieve a "viewModal" for textual content display.
 */
function createViewModal(title, loadingMessage) {
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
    closeBtn.addEventListener("click", () => hideViewModal());
    header.appendChild(closeBtn);

    const contentWrapper = document.createElement("div");
    contentWrapper.id = "contentViewModalContent";

    modalInner.appendChild(header);
    modalInner.appendChild(contentWrapper);
    modal.appendChild(modalInner);
    document.body.appendChild(modal);
  }

  // Update
  const mTitle = document.getElementById("contentViewModalTitle");
  const mContent = document.getElementById("contentViewModalContent");
  if (mTitle) mTitle.textContent = title;
  if (mContent) mContent.innerHTML = loadingMessage ? loadingMessage : "";

  modal.classList.remove("hidden");
  return { modal, modalContent: mContent, heading: mTitle };
}

function hideViewModal() {
  const modal = document.getElementById("contentViewModal");
  if (modal) modal.classList.add("hidden");
}

/* --------------------------
   Utility functions
--------------------------- */
function formatNumber(num) {
  if (!num) return "0";
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDate(dateString, includeTime = false) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return dateString;

  const opts = { year: "numeric", month: "short", day: "numeric" };
  if (includeTime) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
  }
  return d.toLocaleDateString(undefined, opts);
}

function formatBytes(bytes) {
  if (!bytes) return "0 Bytes";
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function fileIcon(fileType) {
  // Basic mapping
  const map = {
    "txt": "📄", "pdf": "📑", "doc": "📝", "docx": "📝",
    "xlsx": "📊", "xls": "📊", "csv": "📊",
    "jpg": "🖼️", "jpeg": "🖼️", "png": "🖼️", "gif": "🖼️",
    "mp3": "🎵", "mp4": "🎬", "zip": "📦",
    "json": "📋", "md": "📋"
  };
  return map[fileType] || "📄";
}

function artifactIcon(contentType) {
  const map = {
    "code": "💻", "document": "📄", "image": "🖼️", "audio": "🎵", "video": "🎬"
  };
  return map[contentType] || "📄";
}

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}