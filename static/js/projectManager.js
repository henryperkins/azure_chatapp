/**
 * projectManager.js - Core project management operations
 * Handles data operations for projects, files, and artifacts
 */

// State management
let currentProject = null;

document.addEventListener("DOMContentLoaded", () => {
  // Initialize based on URL params
  const urlParams = new URLSearchParams(window.location.search);
  const projectId = urlParams.get("project");
  
  if (projectId) {
    loadProjectDetails(projectId);
  } else {
    loadProjects();
  }
  
  // Register event listeners
  setupEventListeners();
});

/**
 * Register core event listeners
 */
function setupEventListeners() {
  // Project navigation
  document.getElementById("backToProjectsBtn")?.addEventListener("click", showProjectListView);
  
  // Project creation and editing
  document.getElementById("createProjectBtn")?.addEventListener("click", () => showModal("projectFormModal"));
  document.getElementById("closeProjectFormBtn")?.addEventListener("click", () => hideModal("projectFormModal"));
  document.getElementById("cancelProjectFormBtn")?.addEventListener("click", () => hideModal("projectFormModal"));
  document.getElementById("projectForm")?.addEventListener("submit", handleProjectFormSubmit);
  
  // Project actions
  document.getElementById("editProjectBtn")?.addEventListener("click", () => {
    if (currentProject) populateProjectForm(currentProject);
  });
  document.getElementById("pinProjectBtn")?.addEventListener("click", () => {
    if (currentProject) togglePinProject(currentProject.id);
  });
  document.getElementById("archiveProjectBtn")?.addEventListener("click", () => {
    if (currentProject) toggleArchiveProject(currentProject.id);
  });
  
  // Tab switching
  document.querySelectorAll(".project-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchProjectTab(btn.dataset.tab));
  });
  
  // Project filters
  document.querySelectorAll(".project-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => filterProjects(btn.dataset.filter));
  });
  
  // Search functionality
  document.getElementById("projectSearchInput")?.addEventListener("input", e => {
    searchProjects(e.target.value);
  });
  
  // Custom instructions
  document.getElementById("editInstructionsBtn")?.addEventListener("click", () => {
    // Initialize the modal with the current project's instructions
    if (currentProject) {
      document.getElementById("customInstructionsInput").value = currentProject.custom_instructions || "";
      showModal("instructionsModal");
    } else {
      console.error("Cannot edit instructions: No current project");
      window.showNotification?.("Error: No project selected", "error");
    }
  });
  document.getElementById("closeInstructionsBtn")?.addEventListener("click", () => hideModal("instructionsModal"));
  document.getElementById("cancelInstructionsBtn")?.addEventListener("click", () => hideModal("instructionsModal"));
  document.getElementById("saveInstructionsBtn")?.addEventListener("click", saveCustomInstructions);
  
  // File upload
  document.getElementById("uploadFileBtn")?.addEventListener("click", () => {
    document.getElementById("fileInput")?.click();
  });
  document.getElementById("fileInput")?.addEventListener("change", handleFileUpload);
  
  // Confirmation modal
  document.getElementById("cancelDeleteBtn")?.addEventListener("click", () => hideModal("deleteConfirmModal"));
  
  // New conversation
  document.getElementById("newConversationBtn")?.addEventListener("click", startNewConversation);
}

/**
 * UI visibility helpers
 */
function showProjectListView() {
  document.getElementById("projectListView")?.classList.remove("hidden");
  document.getElementById("projectDetailsView")?.classList.add("hidden");
  window.history.pushState({}, "", window.location.pathname);
  loadProjects();
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

/**
 * Switch project tabs
 */
function switchProjectTab(tabId) {
  // Update tab buttons
  document.querySelectorAll(".project-tab-btn").forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle("border-b-2", isActive);
    btn.classList.toggle("border-blue-600", isActive);
    btn.classList.toggle("text-blue-600", isActive);
    btn.classList.toggle("text-gray-500", !isActive);
  });
  
  // Update tab content
  document.querySelectorAll(".project-tab-content").forEach(tab => {
    tab.classList.toggle("hidden", tab.id !== `${tabId}Tab`);
  });
}


/**
 * Load projects with optional filtering
 */
function loadProjects(filter = "all") {
  console.log("Loading projects with filter:", filter);
  window.apiRequest("/api/projects")
    .then(response => {
      console.log("API Response:", response);
      
      // Handle both response formats: direct array or {data: array}
      let projects = Array.isArray(response) ? response : (response.data || []);
      
      console.log("Extracted projects:", projects, "Count:", projects.length);
      
      // Apply filter
      if (filter === "pinned") {
        projects = projects.filter(p => p.pinned);
      } else if (filter === "archived") {
        projects = projects.filter(p => p.archived);
      } else if (filter === "active") {
        projects = projects.filter(p => !p.archived);
      }
      
      console.log("Filtered projects:", projects, "Count:", projects.length);
      
      // Dispatch event for UI to render
      document.dispatchEvent(new CustomEvent("projectsLoaded", { detail: projects }));
    })
    .catch(err => {
      console.error("Error loading projects:", err);
      window.showNotification?.("Failed to load projects", "error");
    });
}

/**
 * Filter projects by criteria
 */
function filterProjects(filter) {
  // Update filter buttons
  document.querySelectorAll(".project-filter-btn").forEach(btn => {
    const isActive = btn.dataset.filter === filter;
    btn.classList.toggle("border-b-2", isActive);
    btn.classList.toggle("border-blue-600", isActive);
    btn.classList.toggle("text-blue-600", isActive);
    btn.classList.toggle("text-gray-600", !isActive);
  });
  
  loadProjects(filter);
}

/**
 * Search projects
 */
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

/**
 * Load project details
 */
function loadProjectDetails(projectId) {
  // Update URL
  window.history.pushState({}, "", `?project=${projectId}`);
  showProjectDetailsView();
  
  // Fetch project data
  window.apiRequest(`/api/projects/${projectId}`)
    .then(response => {
      currentProject = response.data;
      document.dispatchEvent(new CustomEvent("projectLoaded", { detail: currentProject }));
      
      // Load related data
      loadProjectStats(projectId);
      loadProjectFiles(projectId);
      loadProjectConversations(projectId);
      loadProjectArtifacts(projectId);
    })
    .catch(err => {
      console.error("Error loading project:", err);
      window.showNotification?.("Failed to load project", "error");
      showProjectListView();
    });
}

/**
 * Load project stats
 */
function loadProjectStats(projectId) {
  window.apiRequest(`/api/projects/${projectId}/stats`)
    .then(response => {
      document.dispatchEvent(new CustomEvent("projectStatsLoaded", { detail: response.data }));
    })
    .catch(err => console.error("Error loading project stats:", err));
}

/**
 * Load project files
 */
function loadProjectFiles(projectId) {
  window.apiRequest(`/api/projects/${projectId}/files`)
    .then(response => {
      document.dispatchEvent(new CustomEvent("projectFilesLoaded", { detail: response.data }));
    })
    .catch(err => console.error("Error loading project files:", err));
}

/**
 * Load project conversations
 */
function loadProjectConversations(projectId) {
  window.apiRequest(`/api/projects/${projectId}/conversations`)
    .then(response => {
      // Adjust for standard response shape: { success, data, message }
      // We only need the actual data payload
      document.dispatchEvent(new CustomEvent("projectConversationsLoaded", { detail: response.data.conversations }));
    })
    .catch(err => console.error("Error loading conversations:", err));
}

/**
 * Load project artifacts
 */
function loadProjectArtifacts(projectId) {
  window.apiRequest(`/api/projects/${projectId}/artifacts`)
    .then(response => {
      document.dispatchEvent(new CustomEvent("projectArtifactsLoaded", { detail: response.data }));
    })
    .catch(err => console.error("Error loading artifacts:", err));
}

/**
 * Handle project form submission
 */
function handleProjectFormSubmit(e) {
  e.preventDefault();
  
  const projectId = document.getElementById("projectIdInput").value;
  const isEditing = !!projectId;
  
  // Get form data
  const formData = {
    name: document.getElementById("projectNameInput").value.trim(),
    description: document.getElementById("projectDescInput").value.trim(),
    goals: document.getElementById("projectGoalsInput").value.trim(),
    max_tokens: parseInt(document.getElementById("projectMaxTokensInput").value)
  };
  
  // Validate
  if (!formData.name) {
    window.showNotification?.("Project name is required", "error");
    return;
  }
  
  // Create or update project
  const method = isEditing ? "PATCH" : "POST";
  const endpoint = isEditing ? `/api/projects/${projectId}` : "/api/projects";
  
  window.apiRequest(endpoint, method, formData)
    .then(response => {
      hideModal("projectFormModal");
      window.showNotification?.(
        isEditing ? "Project updated successfully" : "Project created successfully", 
        "success"
      );
      
      // Reset filters when creating new projects
      if (!isEditing) {
        document.querySelectorAll(".project-filter-btn").forEach(btn => {
          btn.classList.remove("border-b-2", "border-blue-600", "text-blue-600");
        });
        document.querySelector(".project-filter-btn[data-filter='all']")
          ?.classList.add("border-b-2", "border-blue-600", "text-blue-600");
      }
      
      loadProjects(); // Modified line (remove filter param)
    })
    .catch(err => {
      console.error("Error saving project:", err);
      window.showNotification?.("Failed to save project", "error");
    });
}

/**
 * Populate project form for editing
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
 * Toggle project pin status
 */
function togglePinProject(projectId) {
  window.apiRequest(`/api/projects/${projectId}/pin`, "POST")
    .then(response => {
      window.showNotification?.(
        response.data.pinned ? "Project pinned" : "Project unpinned",
        "success"
      );
      loadProjectDetails(projectId);
    })
    .catch(err => {
      console.error("Error toggling project pin:", err);
      window.showNotification?.("Failed to update project", "error");
    });
}

/**
 * Toggle project archive status
 */
function toggleArchiveProject(projectId) {
  window.apiRequest(`/api/projects/${projectId}/archive`, "PATCH")
    .then(response => {
      window.showNotification?.(
        response.data.archived ? "Project archived" : "Project unarchived",
        "success"
      );
      loadProjectDetails(projectId);
    })
    .catch(err => {
      console.error("Error toggling project archive:", err);
      window.showNotification?.("Failed to update project", "error");
    });
}

/**
 * Save custom instructions
 */
function saveCustomInstructions() {
  if (!currentProject) {
    console.error("Cannot save instructions: No current project");
    window.showNotification?.("Error: No project selected", "error");
    return;
  }
  
  console.log("Current project:", currentProject);
  const instructions = document.getElementById("customInstructionsInput").value;
  console.log("Saving instructions:", instructions);
  
  window.apiRequest(`/api/projects/${currentProject.id}`, "PATCH", {
    custom_instructions: instructions
  })
    .then(response => {
      console.log("Save instructions response:", response);
      hideModal("instructionsModal");
      window.showNotification?.("Custom instructions saved", "success");
      
      // Update current project
      currentProject.custom_instructions = instructions;
      document.getElementById("projectInstructions").textContent = 
        instructions || "No custom instructions set.";
    })
    .catch(err => {
      console.error("Error saving instructions:", err);
      window.showNotification?.("Failed to save instructions", "error");
    });
}

/**
 * Handle file upload
 */
function handleFileUpload(e) {
  if (!currentProject) return;
  
  const files = e.target.files;
  if (!files || files.length === 0) return;
  
  // Show upload progress
  document.getElementById("filesUploadProgress")?.classList.remove("hidden");
  document.getElementById("fileProgressBar").style.width = "0%";
  document.getElementById("uploadStatus").textContent = `Uploading 0/${files.length} files...`;
  
  // Trigger upload for each file
  let uploaded = 0;
  let failed = 0;
  
  Array.from(files).forEach(file => uploadFile(file, () => {
    uploaded++;
    updateUploadProgress(uploaded, failed, files.length);
  }, () => {
    failed++;
    uploaded++;
    updateUploadProgress(uploaded, failed, files.length);
  }));
}

/**
 * Upload a single file
 */
function uploadFile(file, onSuccess, onError) {
  const formData = new FormData();
  formData.append("file", file);
  
  fetch(`/api/projects/${currentProject.id}/files`, {
    method: "POST",
    body: formData,
    credentials: "include"
  })
    .then(response => {
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    })
    .then(onSuccess)
    .catch(err => {
      console.error("Error uploading file:", err);
      onError();
    });
}

/**
 * Update upload progress UI
 */
function updateUploadProgress(completed, errors, total) {
  const percentage = Math.round((completed / total) * 100);
  const progressBar = document.getElementById("fileProgressBar");
  const uploadStatus = document.getElementById("uploadStatus");
  
  if (progressBar) progressBar.style.width = `${percentage}%`;
  if (uploadStatus) uploadStatus.textContent = `Uploading ${completed}/${total} files...`;
  
  if (completed === total) {
    if (errors === 0) {
      uploadStatus.textContent = "Upload complete!";
      window.showNotification?.("Files uploaded successfully", "success");
    } else {
      uploadStatus.textContent = `Upload completed with ${errors} error(s)`;
      window.showNotification?.(`${errors} file(s) failed to upload`, "error");
    }
    
    // Refresh data
    loadProjectFiles(currentProject.id);
    loadProjectStats(currentProject.id);
    
    // Reset file input
    document.getElementById("fileInput").value = "";
    
    // Hide progress after delay
    setTimeout(() => {
      document.getElementById("filesUploadProgress")?.classList.add("hidden");
    }, 3000);
  }
}

/**
 * Start a new conversation
 */
function startNewConversation() {
  if (!currentProject) return;
  
  // Set selected project in localStorage
  localStorage.setItem("selectedProjectId", currentProject.id);
  
  // Create conversation
  window.apiRequest("/api/chat/conversations", "POST", {
    title: "New Conversation",
    project_id: currentProject.id
  })
    .then(response => {
      window.location.href = `/?chatId=${response.data.conversation_id}`;
    })
    .catch(err => {
      console.error("Error creating conversation:", err);
      window.showNotification?.("Failed to create conversation", "error");
    });
}

// Export functions
window.projectManager = {
  loadProjects,
  loadProjectDetails,
  // Export the currentProject for other modules to access
  get currentProject() {
    return currentProject;
  },
  confirmDeleteProject: (projectId, name) => {
    document.getElementById("deleteConfirmText").textContent = 
      `Are you sure you want to delete the project "${name}"? This cannot be undone.`;
    
    document.getElementById("confirmDeleteBtn").onclick = () => {
      window.apiRequest(`/api/projects/${projectId}`, "DELETE")
        .then(() => {
          window.showNotification?.("Project deleted", "success");
          showProjectListView();
          hideModal("deleteConfirmModal");
        })
        .catch(err => {
          console.error("Error deleting project:", err);
          window.showNotification?.("Failed to delete project", "error");
        });
    };
    
    showModal("deleteConfirmModal");
  },
  confirmDeleteFile: (fileId, fileName) => {
    document.getElementById("deleteConfirmText").textContent = 
      `Are you sure you want to delete the file "${fileName}"?`;
    
    document.getElementById("confirmDeleteBtn").onclick = () => {
      window.apiRequest(`/api/projects/${currentProject.id}/files/${fileId}`, "DELETE")
        .then(() => {
          window.showNotification?.("File deleted", "success");
          loadProjectFiles(currentProject.id);
          loadProjectStats(currentProject.id);
          hideModal("deleteConfirmModal");
        })
        .catch(err => {
          console.error("Error deleting file:", err);
          window.showNotification?.("Failed to delete file", "error");
        });
    };
    
    showModal("deleteConfirmModal");
  },
  confirmDeleteArtifact: (artifactId, name) => {
    document.getElementById("deleteConfirmText").textContent = 
      `Are you sure you want to delete the artifact "${name}"?`;
    
    document.getElementById("confirmDeleteBtn").onclick = () => {
      window.apiRequest(`/api/projects/${currentProject.id}/artifacts/${artifactId}`, "DELETE")
        .then(() => {
          window.showNotification?.("Artifact deleted", "success");
          loadProjectArtifacts(currentProject.id);
          loadProjectStats(currentProject.id);
          hideModal("deleteConfirmModal");
        })
        .catch(err => {
          console.error("Error deleting artifact:", err);
          window.showNotification?.("Failed to delete artifact", "error");
        });
    };
    
    showModal("deleteConfirmModal");
  }
};
