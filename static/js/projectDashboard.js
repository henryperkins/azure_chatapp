/**
 * projectDashboard.js
 * -------------------
 * Handles all DOM manipulation and UI event handling:
 * - Setting up click handlers, forms, and modals
 * - Listening to events from projectManager.js (e.g., "projectsLoaded")
 * - Rendering the updated data into the page
 */

document.addEventListener("DOMContentLoaded", () => {
  // 1. Parse URL to see if we need to auto-load a specific project
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get("project");

  if (projectId) {
    projectManager.loadProjectDetails(projectId);
    showProjectDetailsView();
  } else {
    projectManager.loadProjects();
    showProjectListView();
  }

  // 2. Set up top-level event listeners (buttons, forms, etc.)
  setupGlobalEventListeners();

  // 3. Listen to the custom events dispatched by projectManager.js
  registerDataEventListeners();
});

/**
 * Sets up event listeners for global UI elements: forms, buttons, etc.
 */
function setupGlobalEventListeners() {
  // Nav: Back to projects
  document.getElementById("backToProjectsBtn")?.addEventListener("click", () => {
    showProjectListView();
    projectManager.loadProjects();
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
  document.addEventListener("projectLoaded", (e) => renderProjectDetails(e.detail));
  // Stats loaded
  document.addEventListener("projectStatsLoaded", (e) => renderProjectStats(e.detail));
  // Files loaded
  document.addEventListener("projectFilesLoaded", (e) => renderProjectFiles(e.detail.files));
  // Conversations loaded
  document.addEventListener("projectConversationsLoaded", (e) => renderProjectConversations(e.detail));
  // Artifacts loaded
  document.addEventListener("projectArtifactsLoaded", (e) => renderProjectArtifacts(e.detail.artifacts));
}

/* --------------------------
   UI Visibility / Modal Helpers
--------------------------- */

function showProjectListView() {
  document.getElementById("projectListView")?.classList.remove("hidden");
  document.getElementById("projectDetailsView")?.classList.add("hidden");
  window.history.pushState({}, "", window.location.pathname);
}

function showProjectDetailsView() {
  document.getElementById("projectListView")?.classList.add("hidden");
  document.getElementById("projectDetailsView")?.classList.remove("hidden");
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

  // View
  const viewBtn = document.createElement("button");
  viewBtn.className = "p-1 text-blue-600 hover:text-blue-800 view-project-btn";
  viewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
       d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
       d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0
       8.268 2.943 9.542 7-1.274 4.057-5.064
       7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>`;
  viewBtn.addEventListener("click", () => {
    projectManager.loadProjectDetails(project.id);
    showProjectDetailsView();
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
  document.getElementById("projectTitle").textContent = project.name;
  document.getElementById("projectDescription").textContent =
    project.description || "No description provided.";
  document.getElementById("projectGoals").textContent =
    project.goals || "No goals defined.";
  document.getElementById("projectInstructions").textContent =
    project.custom_instructions || "No custom instructions set.";

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
 * Render project stats: token usage, etc.
 */
function renderProjectStats(stats) {
  document.getElementById("tokenUsage").textContent = formatNumber(stats.token_usage || 0);
  document.getElementById("maxTokens").textContent = formatNumber(stats.max_tokens || 0);
  const usage = stats.token_usage || 0;
  const maxT = stats.max_tokens || 0;
  const pct = maxT > 0 ? Math.min(100, (usage / maxT) * 100).toFixed(1) : 0;
  document.getElementById("tokenPercentage").textContent = `${pct}%`;
  document.getElementById("tokenProgressBar").style.width = `${pct}%`;

  // Update counters
  document.getElementById("conversationCount").textContent = stats.conversation_count || 0;
  document.getElementById("fileCount").textContent = stats.file_count || 0;
  document.getElementById("artifactCount").textContent = stats.artifact_count || 0;
}

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
    const filename = document.createElement("div");
    filename.className = "font-medium";
    filename.textContent = file.filename;
    detailDiv.appendChild(filename);

    const meta = document.createElement("div");
    meta.className = "text-xs text-gray-500";
    meta.textContent = `${formatBytes(file.file_size)} • ${formatDate(file.created_at)}`;
    detailDiv.appendChild(meta);

    infoDiv.appendChild(detailDiv);
    item.appendChild(infoDiv);

    // Actions
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "flex space-x-2";

    const viewBtn = document.createElement("button");
    viewBtn.className = "text-gray-600 hover:text-gray-800";
    viewBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5"
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
       d="M15 12a3 3 0 11-6 0 3 3
       0 016 0z" />
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
       d="M2.458 12C3.732 7.943 7.523
       5 12 5c4.478 0 8.268 2.943
       9.542 7-1.274 4.057-5.064
       7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>`;
    viewBtn.addEventListener("click", () => viewFile(file.id));
    actionsDiv.appendChild(viewBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "text-red-600 hover:text-red-800";
    delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5"
      fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
       d="M19 7l-.867 12.142A2 2
       0 0116.138 21H7.862a2 2 0
       01-1.995-1.858L5 7m5
       4v6m4-6v6m1-10V4a1 1 0
       00-1-1h-4a1 1 0
       00-1 1v3M4 7h16" />
    </svg>`;
    delBtn.addEventListener("click", () => {
      confirmDeleteFile(file.id, file.filename);
    });
    actionsDiv.appendChild(delBtn);

    item.appendChild(actionsDiv);
    filesList.appendChild(item);
  });
}

/**
 * View file content (in a modal).
 */
function viewFile(fileId) {
  const p = projectManager.currentProject;
  if (!p) {
    window.showNotification?.("No project selected", "error");
    return;
  }

  // Show a loading modal
  const { modal, modalContent, heading } = createViewModal("Loading file...", "Loading...");
  
  // Fetch file info
  window.apiRequest(`/api/projects/${p.id}/files/${fileId}`, "GET")
    .then((resp) => {
      const file = resp.data;
      heading.textContent = file.filename;

      if (file.content === null) {
        modalContent.innerHTML = `
          <div class="bg-yellow-50 p-4 rounded">
            <p class="text-yellow-700">File content not displayable (binary or large file).</p>
            <p class="text-yellow-600 mt-2">Type: ${file.file_type}, Size: ${formatBytes(file.file_size)}</p>
          </div>
        `;
      } else {
        modalContent.innerHTML = `
          <div class="flex justify-between items-center mb-2">
            <div>
              <span class="text-gray-500 text-sm">Type: ${file.file_type}</span>
              <span class="text-gray-500 text-sm ml-4">Size: ${formatBytes(file.file_size)}</span>
            </div>
            <button id="copyFileContentBtn" class="text-blue-600 hover:text-blue-800 text-sm">Copy Content</button>
          </div>
          <pre class="bg-gray-50 dark:bg-gray-700 p-4 rounded overflow-x-auto whitespace-pre-wrap"><code>${escapeHtml(file.content)}</code></pre>
        `;

        // Copy button
        document.getElementById("copyFileContentBtn")?.addEventListener("click", () => {
          navigator.clipboard.writeText(file.content)
            .then(() => window.showNotification?.("File content copied", "success"))
            .catch(() => window.showNotification?.("Failed to copy", "error"));
        });
      }
    })
    .catch((err) => {
      console.error("Error loading file:", err);
      modalContent.innerHTML = `<div class="bg-red-50 p-4 rounded">Failed to load file. Please try again later.</div>`;
    });
}

/**
 * Render conversations
 */
function renderProjectConversations(conversations) {
  const list = document.getElementById("projectConversationsList");
  if (!list) return;
  
  // Debug output to help identify issues
  console.log("Rendering conversations:", conversations);
  
  if (!conversations || conversations.length === 0) {
    list.innerHTML = `<div class="text-gray-500 text-center py-8">No conversations yet.</div>`;
    return;
  }
  list.innerHTML = "";

  conversations.forEach(conv => {
    const item = document.createElement("div");
    item.className = "flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2";

    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "font-medium";
    title.textContent = conv.title || `Conversation ${conv.id}`;
    const date = document.createElement("div");
    date.className = "text-xs text-gray-500";
    date.textContent = formatDate(conv.created_at, true);
    info.appendChild(title);
    info.appendChild(date);

    const openBtn = document.createElement("button");
    openBtn.className = "px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => {
      window.location.href = `/?chatId=${conv.id}`;
    });

    item.appendChild(info);
    item.appendChild(openBtn);
    list.appendChild(item);
  });
}

/**
 * Render artifacts
 */
function renderProjectArtifacts(artifacts) {
  const list = document.getElementById("projectArtifactsList");
  if (!list) return;
  if (!artifacts || artifacts.length === 0) {
    list.innerHTML = `<div class="text-gray-500 text-center py-8">No artifacts generated yet.</div>`;
    return;
  }
  list.innerHTML = "";

  artifacts.forEach(art => {
    const item = document.createElement("div");
    item.className = "p-3 bg-gray-50 dark:bg-gray-700 rounded mb-2";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between mb-2";

    const left = document.createElement("div");
    left.className = "flex items-center";
    const iconSpan = document.createElement("span");
    iconSpan.className = "text-lg mr-2";
    iconSpan.textContent = artifactIcon(art.content_type);
    left.appendChild(iconSpan);

    const title = document.createElement("div");
    title.className = "font-medium";
    title.textContent = art.name || "Untitled Artifact";
    left.appendChild(title);

    header.appendChild(left);

    const time = document.createElement("div");
    time.className = "text-xs text-gray-500";
    time.textContent = formatDate(art.created_at);
    header.appendChild(time);

    item.appendChild(header);

    const actions = document.createElement("div");
    actions.className = "flex justify-end space-x-2 mt-2";

    const viewBtn = document.createElement("button");
    viewBtn.className = "px-2 py-1 text-xs border border-gray-300 rounded text-gray-700 hover:bg-gray-100";
    viewBtn.textContent = "View";
    viewBtn.addEventListener("click", () => {
      viewArtifact(art.id);
    });
    actions.appendChild(viewBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      confirmDeleteArtifact(art.id, art.name);
    });
    actions.appendChild(deleteBtn);

    item.appendChild(actions);
    list.appendChild(item);
  });
}

/* --------------------------
   Viewing Artifact
--------------------------- */
function viewArtifact(artifactId) {
  const p = projectManager.currentProject;
  if (!p) {
    window.showNotification?.("No project selected", "error");
    return;
  }

  const { modalContent, heading } = createViewModal("Loading artifact...", "Loading...");

  window.apiRequest(`/api/projects/${p.id}/artifacts/${artifactId}`, "GET")
    .then((resp) => {
      const art = resp.data;
      heading.textContent = art.name || "Artifact Details";

      const contentType = art.content_type || "unknown";
      let contentHtml = escapeHtml(art.content || "");

      modalContent.innerHTML = `
        <div class="flex justify-between items-center mb-2">
          <span class="text-gray-500 text-sm">Type: ${contentType}</span>
          <button id="copyArtifactContentBtn" class="text-blue-600 hover:text-blue-800 text-sm">Copy Content</button>
        </div>
        <pre class="bg-gray-50 dark:bg-gray-700 p-4 rounded overflow-x-auto whitespace-pre-wrap">${contentHtml}</pre>
      `;

      document.getElementById("copyArtifactContentBtn")?.addEventListener("click", () => {
        navigator.clipboard.writeText(art.content)
          .then(() => window.showNotification?.("Artifact content copied", "success"))
          .catch(() => window.showNotification?.("Failed to copy", "error"));
      });
    })
    .catch((err) => {
      console.error("Error viewing artifact:", err);
      modalContent.innerHTML = `<div class="bg-red-50 p-4 rounded">Failed to load artifact. Please try again later.</div>`;
    });
}

/* --------------------------
   Filtering & Searching
--------------------------- */
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
