/**
 * projectManager.js
 * Handles all project-related data operations
 * Uses the central app.apiRequest for networking
 */

// API endpoint templates
const API_ENDPOINTS = {
  PROJECTS: '/api/projects',
  PROJECT_DETAIL: '/api/projects/{projectId}',
  PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations',
  PROJECT_FILES: '/api/projects/{projectId}/files',
  PROJECT_STATS: '/api/projects/{projectId}/stats',
  PROJECT_ARTIFACTS: '/api/projects/{projectId}/artifacts'
};

// Current state
let currentProject = null;
let projectLoadingInProgress = false;

/**
 * Load a list of projects with optional filtering
 */
async function loadProjects(filter = 'all') {
  // Prevent concurrent loading
  if (projectLoadingInProgress) {
    console.log("[projectManager] Project loading already in progress");
    return [];
  }

  // Verify authentication
  try {
    const isAuthenticated = await window.auth.checkAuth();
    if (!isAuthenticated) {
      console.warn("[projectManager] Not authenticated, can't load projects");
      emitEvent("projectsLoaded", {
        projects: [],
        count: 0,
        filter: { type: filter },
        error: true,
        reason: 'auth_required'
      });
      return [];
    }
  } catch (error) {
    console.error("[projectManager] Auth check failed:", error);
    emitEvent("projectsLoaded", {
      projects: [],
      count: 0,
      filter: { type: filter },
      error: true,
      reason: 'auth_error'
    });
    return [];
  }

  projectLoadingInProgress = true;
  emitEvent("projectsLoading", { filter });

  try {
    // Build URL with filter parameters
    const params = new URLSearchParams();
    params.append("filter", filter);
    params.append("skip", "0");
    params.append("limit", "100");

    const endpoint = `${API_ENDPOINTS.PROJECTS}?${params.toString()}`;
    const response = await window.app.apiRequest(endpoint);

    // Extract projects from response
    const projects = response?.data?.projects ||
      response?.projects ||
      (Array.isArray(response?.data) ? response.data :
        (Array.isArray(response) ? response : []));

    if (!Array.isArray(projects)) {
      console.warn("[projectManager] Unexpected project list format:", response);
      emitEvent("projectsLoaded", {
        projects: [],
        count: 0,
        filter: { type: filter },
        error: true,
        reason: 'invalid_format'
      });
      return [];
    }

    emitEvent("projectsLoaded", {
      projects,
      count: projects.length,
      filter: { type: filter }
    });

    return projects;
  } catch (error) {
    console.error("[projectManager] Error loading projects:", error);

    emitEvent("projectsLoaded", {
      projects: [],
      count: 0,
      filter: { type: filter },
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

  // Verify authentication
  try {
    const isAuthenticated = await window.auth.checkAuth();
    if (!isAuthenticated) {
      console.warn("[projectManager] Not authenticated, can't load project details");
      emitEvent("projectDetailsError", {
        projectId,
        error: { message: "Authentication required" },
        reason: 'auth_required'
      });
      return null;
    }
  } catch (error) {
    console.error("[projectManager] Auth check failed:", error);
    emitEvent("projectDetailsError", {
      projectId,
      error: { message: error.message },
      reason: 'auth_error'
    });
    return null;
  }

  // Clear current project while loading
  currentProject = null;
  emitEvent("projectDetailsLoading", { projectId });

  try {
    const endpoint = API_ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint);

    // Extract project data
    let projectData = null;
    if (response?.data?.id) projectData = response.data;
    else if (response?.id) projectData = response;
    else if (response?.success === true && response?.data?.id) projectData = response.data;

    if (!projectData || projectData.id !== projectId) {
      throw new Error("Invalid project response format or ID mismatch");
    }

    currentProject = projectData;
    emitEvent("projectLoaded", JSON.parse(JSON.stringify(currentProject)));

    // Skip related data if project is archived
    if (currentProject.archived) {
      emitEvent("projectArchivedNotice", { id: currentProject.id });
      return JSON.parse(JSON.stringify(currentProject));
    }

    // Load related data in parallel
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
    const endpoint = API_ENDPOINTS.PROJECT_STATS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint);

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
    const endpoint = API_ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint);

    const files = response?.data?.files ||
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
    const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint);

    const conversations = response?.data?.conversations ||
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
    const endpoint = API_ENDPOINTS.PROJECT_ARTIFACTS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint);

    const artifacts = response?.data?.artifacts ||
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
  // Verify authentication
  const isAuthenticated = await window.auth.checkAuth({ forceVerify: true });
  if (!isAuthenticated) {
    throw new Error("Authentication required");
  }

  const isUpdate = !!projectId;
  const method = isUpdate ? "PATCH" : "POST";
  const endpoint = isUpdate ?
    API_ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId) :
    API_ENDPOINTS.PROJECTS;

  try {
    const response = await window.app.apiRequest(endpoint, method, projectData);
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
  // Verify authentication
  const isAuthenticated = await window.auth.checkAuth({ forceVerify: true });
  if (!isAuthenticated) {
    throw new Error("Authentication required");
  }

  try {
    const endpoint = API_ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, "DELETE");

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
  // Verify authentication
  const isAuthenticated = await window.auth.checkAuth({ forceVerify: true });
  if (!isAuthenticated) {
    throw new Error("Authentication required");
  }

  try {
    const endpoint = `${API_ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/pin`;
    const response = await window.app.apiRequest(endpoint, "POST");

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
  // Verify authentication
  const isAuthenticated = await window.auth.checkAuth({ forceVerify: true });
  if (!isAuthenticated) {
    throw new Error("Authentication required");
  }

  try {
    const endpoint = `${API_ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/archive`;
    const response = await window.app.apiRequest(endpoint, "PATCH");

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
 * Create a new conversation in a project
 */
async function createConversation(projectId, options = {}) {
  // Verify authentication
  const isAuthenticated = await window.auth.checkAuth({ forceVerify: true });
  if (!isAuthenticated) {
    throw new Error("Authentication required");
  }

  const finalProjectId = projectId || window.app.getProjectId();
  if (!finalProjectId) {
    throw new Error("Project ID is required");
  }

  const payload = {
    title: options.title || "New Conversation",
    model: options.model || window.MODEL_CONFIG?.modelName || "claude-3-sonnet-20240229",
    system_prompt: options.system_prompt || window.MODEL_CONFIG?.customInstructions || ""
  };

  try {
    const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', finalProjectId);
    const response = await window.app.apiRequest(endpoint, "POST", payload);

    const conversationData = response?.data || response;
    if (!conversationData?.id) {
      throw new Error("Invalid conversation response");
    }

    emitEvent("conversationCreated", {
      projectId: finalProjectId,
      conversation: conversationData
    });

    return conversationData;
  } catch (error) {
    console.error("[projectManager] Error creating conversation:", error);
    emitEvent("conversationCreateFailed", {
      projectId: finalProjectId,
      error: { message: error.message, status: error.status }
    });
    throw error;
  }
}

/**
 * Delete a conversation from a project
 */
async function deleteProjectConversation(projectId, conversationId) {
  // Verify authentication
  const isAuthenticated = await window.auth.checkAuth({ forceVerify: true });
  if (!isAuthenticated) {
    throw new Error("Authentication required");
  }

  try {
    const endpoint = `${API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId)}/${conversationId}`;
    await window.app.apiRequest(endpoint, "DELETE");

    emitEvent("conversationDeleted", { projectId, conversationId });

    // Refresh related data
    await Promise.allSettled([
      loadProjectStats(projectId),
      loadProjectConversations(projectId)
    ]);

    return true;
  } catch (error) {
    console.error("[projectManager] Error deleting conversation:", error);
    emitEvent("conversationDeleteFailed", {
      projectId,
      conversationId,
      error: { message: error.message, status: error.status }
    });
    throw error;
  }
}

/**
 * Emit a custom event
 */
function emitEvent(eventName, detail) {
  const eventDetail = {
    ...detail,
    source: "projectManager"
  };

  document.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
}

/**
 * Get current project
 */
function getCurrentProject() {
  return currentProject ? JSON.parse(JSON.stringify(currentProject)) : null;
}

// Export public API
window.projectManager = {
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
  getCurrentProject
};
