/**
 * projectManager.js
 * Dependencies:
 * - window.app.apiRequest (external dependency, expected to be available in global scope)
 * - window.auth (external dependency, expected to be available in global scope)
 * - window.chatManager (external dependency, expected to be available in global scope)
 * - window.DependencySystem (external dependency, used for module registration)
 * - localStorage (browser built-in)
 * - document (browser built-in, for CustomEvent dispatch)
 * - FormData (browser built-in, for file uploads)
 */


// Configuration
const PROJECT_CONFIG = {
  DEBUG: window.location.hostname === 'localhost' || window.location.search.includes('debug=1'),
  ENDPOINTS: {
    PROJECTS: '/api/projects',
    PROJECT_DETAIL: '/api/projects/{projectId}',
    PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations',
    PROJECT_FILES: '/api/projects/{projectId}/files',
    PROJECT_STATS: '/api/projects/{projectId}/stats',
    PROJECT_ARTIFACTS: '/api/projects/{projectId}/artifacts'
  }
};

// Current state
let currentProject = null;
let projectLoadingInProgress = false;

/**
 * Load a list of projects with optional filtering
 */
async function loadProjects(filter = 'all') {
  if (projectLoadingInProgress) {
    PROJECT_CONFIG.DEBUG && console.log("[projectManager] Project loading already in progress");
    return [];
  }

  try {
    // Check auth state
    if (!window.auth?.isAuthenticated()) {
      console.warn("[projectManager] Not authenticated, can't load projects");
      emitEvent("projectsLoaded", {
        projects: [],
        reason: 'auth_required'
      });
      return [];
    }
  } catch (error) {
    console.error("[projectManager] Auth check failed:", error);
    emitEvent("projectsLoaded", {
      projects: [],
      reason: 'auth_error'
    });
    return [];
  }

  projectLoadingInProgress = true;
  emitEvent("projectsLoading", { filter });

  try {
    // Build URL with filter
    const params = new URLSearchParams();
    params.append("filter", filter);
    params.append("skip", "0");
    params.append("limit", "100");

    const endpoint = `${PROJECT_CONFIG.ENDPOINTS.PROJECTS}?${params.toString()}`;
    console.log(`[projectManager] Requesting projects from: ${endpoint}`); // ADDED: log endpoint
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });
    console.log('[projectManager] Raw projects response:', response); // ADDED: log raw response

    const projects =
      response?.data?.projects ||
      response?.projects ||
      (Array.isArray(response?.data) ? response.data :
        (Array.isArray(response) ? response : []));

    if (!Array.isArray(projects)) {
      console.warn("[projectManager] Unexpected project list format:", response);
      emitEvent("projectsLoaded", {
        projects: [],
        reason: 'invalid_format'
      });
      return [];
    }

    emitEvent("projectsLoaded", {
      projects,
      filter
    });

    return projects;
  } catch (error) {
    console.error("[projectManager] Error loading projects:", error);
    emitEvent("projectsLoaded", {
      projects: [],
      error: true,
      message: error.message || 'Unknown error',
      status: error.status
    });
    return [];
  } finally {
    projectLoadingInProgress = false;
  }
}

/**
 * Load details for a specific project
 */
async function loadProjectDetails(projectId) {
  if (!window.app.validateUUID(projectId)) {
    console.error("[projectManager] Invalid project ID:", projectId);
    emitEvent("projectDetailsError", {
      projectId,
      error: { message: "Invalid project ID" }
    });
    return null;
  }

  try {
    // FIXED: Use the direct auth module check for consistency with loadProjects
    if (!window.auth?.isAuthenticated()) {
      console.warn("[projectManager] Not authenticated, can't load project details");
      emitEvent("projectDetailsError", {
        projectId,
        error: { message: "Authentication required" }
      });
      return null;
    }
  } catch (error) {
    console.error("[projectManager] Auth check failed:", error);
    emitEvent("projectDetailsError", {
      projectId,
      error: { message: error.message }
    });
    return null;
  }

  currentProject = null;
  emitEvent("projectDetailsLoading", { projectId });

  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    let projectData = null;
    if (response?.data?.id) projectData = response.data;
    else if (response?.id) projectData = response;
    else if (response?.success === true && response?.data?.id) projectData = response.data;

    if (!projectData || projectData.id !== projectId) {
      throw new Error("Invalid project response format or ID mismatch");
    }

    currentProject = projectData;
    emitEvent("projectLoaded", JSON.parse(JSON.stringify(currentProject)));

    // Skip related data if archived
    if (currentProject.archived) {
      emitEvent("projectArchivedNotice", { id: currentProject.id });
      return JSON.parse(JSON.stringify(currentProject));
    }

    // Load related data
    await Promise.allSettled([
      loadProjectStats(projectId),
      loadProjectFiles(projectId),
      loadProjectConversations(projectId),
      loadProjectArtifacts(projectId)
    ]);

    return JSON.parse(JSON.stringify(currentProject));
  } catch (error) {
    console.error("[projectManager] Error loading project details:", error);
    emitEvent("projectDetailsError", {
      projectId,
      error: { message: error.message, status: error.status }
    });

    if (error.status === 404) {
      emitEvent("projectNotFound", { projectId });
    }

    return null;
  }
}

/**
 * Load project stats
 */
async function loadProjectStats(projectId) {
  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_STATS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    const stats = response?.data || {};
    emitEvent("projectStatsLoaded", {
      projectId,
      ...stats
    });
    return stats;
  } catch (error) {
    console.error("[projectManager] Error loading project stats:", error);
    emitEvent("projectStatsError", {
      projectId,
      error: { message: error.message, status: error.status }
    });
    return {};
  }
}

/**
 * Load project files
 */
async function loadProjectFiles(projectId) {
  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    const files =
      response?.data?.files ||
      response?.files ||
      (Array.isArray(response?.data) ? response.data :
        (Array.isArray(response) ? response : []));

    emitEvent("projectFilesLoaded", { projectId, files });
    return files;
  } catch (error) {
    console.error("[projectManager] Error loading project files:", error);
    emitEvent("projectFilesError", {
      projectId,
      error: { message: error.message, status: error.status }
    });
    return [];
  }
}

/**
 * Load project conversations
 */
async function loadProjectConversations(projectId) {
  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    const conversations =
      response?.data?.conversations ||
      response?.conversations ||
      (Array.isArray(response?.data) ? response.data :
        (Array.isArray(response) ? response : []));

    emitEvent("projectConversationsLoaded", { projectId, conversations });
    return conversations;
  } catch (error) {
    console.error("[projectManager] Error loading project conversations:", error);
    emitEvent("projectConversationsError", {
      projectId,
      error: { message: error.message, status: error.status }
    });
    return [];
  }
}

/**
 * Load project artifacts
 */
async function loadProjectArtifacts(projectId) {
  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_ARTIFACTS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    const artifacts =
      response?.data?.artifacts ||
      response?.artifacts ||
      (Array.isArray(response?.data) ? response.data :
        (Array.isArray(response) ? response : []));

    emitEvent("projectArtifactsLoaded", { projectId, artifacts });
    return artifacts;
  } catch (error) {
    console.error("[projectManager] Error loading project artifacts:", error);
    emitEvent("projectArtifactsError", {
      projectId,
      error: { message: error.message, status: error.status }
    });
    return [];
  }
}

/**
 * Create or update a project
 */
async function createOrUpdateProject(projectId, projectData) {
  if (!window.auth?.isAuthenticated()) {
    throw new Error("Authentication required");
  }

  const isUpdate = !!projectId;
  const method = isUpdate ? "PATCH" : "POST";
  const endpoint = isUpdate
    ? PROJECT_CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)
    : PROJECT_CONFIG.ENDPOINTS.PROJECTS;

  try {
    const response = await window.app.apiRequest(endpoint, { method, body: projectData });
    const resultData = response?.data || response;

    if (!resultData || !resultData.id) {
      throw new Error("Invalid response after project save");
    }

    if (isUpdate && currentProject?.id === projectId) {
      currentProject = { ...currentProject, ...resultData };
      emitEvent("projectUpdated", JSON.parse(JSON.stringify(currentProject)));
    } else if (!isUpdate) {
      emitEvent("projectCreated", resultData);
    }

    return resultData;
  } catch (error) {
    console.error("[projectManager] Error saving project:", error);
    throw error;
  }
}

/**
 * Delete a project
 */
async function deleteProject(projectId) {
  if (!window.auth?.isAuthenticated()) {
    throw new Error("Authentication required");
  }

  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: "DELETE" });

    if (currentProject?.id === projectId) {
      currentProject = null;
    }

    emitEvent("projectDeleted", { projectId });
    return response;
  } catch (error) {
    console.error("[projectManager] Error deleting project:", error);
    throw error;
  }
}

/**
 * Toggle pin status for a project
 */
async function togglePinProject(projectId) {
  if (!window.auth?.isAuthenticated()) {
    throw new Error("Authentication required");
  }

  try {
    const endpoint = `${PROJECT_CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/pin`;
    const response = await window.app.apiRequest(endpoint, { method: "POST" });

    emitEvent("projectPinToggled", {
      projectId,
      pinned: response?.pinned ?? !currentProject?.pinned
    });

    return response;
  } catch (error) {
    console.error("[projectManager] Error toggling project pin:", error);
    throw error;
  }
}

/**
 * Toggle archive status for a project
 */
async function toggleArchiveProject(projectId) {
  if (!window.auth?.isAuthenticated()) {
    throw new Error("Authentication required");
  }

  try {
    const endpoint = `${PROJECT_CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/archive`;
    const response = await window.app.apiRequest(endpoint, { method: "PATCH" });

    emitEvent("projectArchiveToggled", {
      projectId,
      archived: response?.archived ?? !currentProject?.archived
    });

    return response;
  } catch (error) {
    console.error("[projectManager] Error toggling project archive:", error);
    throw error;
  }
}

/**
 * Create a new conversation (delegated to chatManager)
 */
async function createConversation(projectId, options = {}) {
  try {
    // Ensure project is selected
    localStorage.setItem("selectedProjectId", projectId);
    return await window.chatManager.createNewConversation(options);
  } catch (error) {
    console.error("[projectManager] createConversation error:", error);
    throw error;
  }
}

/**
 * Delete conversation (delegated to chatManager)
 */
async function deleteProjectConversation(projectId, conversationId) {
  try {
    localStorage.setItem("selectedProjectId", projectId);
    await window.chatManager.deleteConversation(conversationId);
    return true;
  } catch (error) {
    console.error("[projectManager] deleteProjectConversation error:", error);
    throw error;
  }
}

/**
 * Emit a custom event (simplified)
 */
function emitEvent(eventName, detail) {
  document.dispatchEvent(new CustomEvent(eventName, {
    detail: {
      ...detail,
      source: "projectManager"
    }
  }));
}

/**
 * Get current project
 */
function getCurrentProject() {
  return currentProject ? JSON.parse(JSON.stringify(currentProject)) : null;
}

// File upload utilities
async function prepareFileUploads(projectId, fileList) {
  const validatedFiles = [];
  const invalidFiles = [];

  for (const file of fileList) {
    if (file.size > 30_000_000) {
      invalidFiles.push({ file, reason: 'Max size exceeded (30MB)' });
    } else {
      validatedFiles.push({ file });
    }
  }
  return { validatedFiles, invalidFiles };
}

async function uploadFileWithRetry(projectId, { file }, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', projectId);

      await window.app.apiRequest(`/api/projects/${projectId}/files`, { method: 'POST', body: formData });
      return true;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // exponential backoff
    }
  }
}

// Export public API
const projectManagerAPI = {
  loadProjects,
  loadProjectDetails,
  loadProjectStats,
  loadProjectFiles,
  loadProjectConversations,
  loadProjectArtifacts,
  createOrUpdateProject,
  deleteProject,
  togglePinProject,
  toggleArchiveProject,
  createConversation,
  deleteProjectConversation,
  getCurrentProject,
  prepareFileUploads,
  uploadFileWithRetry
};

// Attach to window and register with DependencySystem
window.projectManager = window.projectManager || projectManagerAPI;

// Register with DependencySystem when it becomes available
if (window.DependencySystem) {
    window.DependencySystem.register('projectManager', window.projectManager);
} else {
    // Wait for DependencySystem to be available
    Object.defineProperty(window, 'DependencySystem', {
        configurable: true,
        set: function(value) {
            Object.defineProperty(window, 'DependencySystem', {
                value: value,
                configurable: true,
                writable: true
            });
            value.register('projectManager', window.projectManager);
        }
    });
}

export default projectManagerAPI;
