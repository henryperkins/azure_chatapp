/**
 * projectManager.js
 *
 * Project management module for web applications.
 *
 * ## Dependencies:
 * - window.app.apiRequest: Function for making API requests.
 * - window.app.validateUUID: Function to validate UUIDs.
 * - window.auth: Authentication module with isAuthenticated().
 * - window.chatManager: Chat/conversation management module.
 * - window.DependencySystem: Optional dependency injection/registration system.
 * - localStorage: Browser built-in for persisting selected project.
 * - document: For dispatching CustomEvents.
 * - FormData: For file uploads.
 *
 * ## Exports:
 * - projectManagerAPI: Main API object (also attached to window.projectManager).
 */

/** @typedef {Object} Project
 *  @property {string} id
 *  @property {string} name
 *  @property {boolean} [archived]
 *  @property {boolean} [pinned]
 *  @property {any} [otherProps]
 */

/** @typedef {Object} ProjectStats
 *  @property {string} projectId
 *  @property {number} [fileCount]
 *  @property {number} [conversationCount]
 *  @property {any} [otherStats]
 */

/** @typedef {Object} FileUploadResult
 *  @property {Array<{file: File}>} validatedFiles
 *  @property {Array<{file: File, reason: string}>} invalidFiles
 */

// Configuration constants
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

// Internal state
let currentProject = null;
let projectLoadingInProgress = false;

/**
 * Load a list of projects, optionally filtered.
 *
 * @param {string} [filter='all'] - Filter type (e.g., 'all', 'archived', etc.)
 * @returns {Promise<Project[]>} - Resolves to an array of projects.
 *
 * Emits:
 * - "projectsLoading" when loading starts.
 * - "projectsLoaded" when loading completes (with projects or error).
 */
async function loadProjects(filter = 'all') {
  if (projectLoadingInProgress) {
    PROJECT_CONFIG.DEBUG && console.log("[projectManager] Project loading already in progress");
    return [];
  }

  try {
    // Check authentication before loading projects
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
    // Build API endpoint with filter and pagination
    const params = new URLSearchParams();
    params.append("filter", filter);
    params.append("skip", "0");
    params.append("limit", "100");

    const endpoint = `${PROJECT_CONFIG.ENDPOINTS.PROJECTS}?${params.toString()}`;
    PROJECT_CONFIG.DEBUG && console.log(`[projectManager] Requesting projects from: ${endpoint}`);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });
    PROJECT_CONFIG.DEBUG && console.log('[projectManager] Raw projects response:', response);

    // Support various API response shapes
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
 * Load details for a specific project, including related data.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<Project|null>} - Resolves to the project object or null on error.
 *
 * Emits:
 * - "projectDetailsLoading" when loading starts.
 * - "projectLoaded" when project details are loaded.
 * - "projectArchivedNotice" if the project is archived.
 * - "projectDetailsError" on error.
 * - "projectNotFound" if project is not found (404).
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

    // Support various API response shapes
    let projectData = null;
    if (response?.data?.id) projectData = response.data;
    else if (response?.id) projectData = response;
    else if (response?.success === true && response?.data?.id) projectData = response.data;

    if (!projectData || projectData.id !== projectId) {
      throw new Error("Invalid project response format or ID mismatch");
    }

    currentProject = projectData;
    emitEvent("projectLoaded", JSON.parse(JSON.stringify(currentProject)));

    // If archived, skip loading related data
    if (currentProject.archived) {
      emitEvent("projectArchivedNotice", { id: currentProject.id });
      return JSON.parse(JSON.stringify(currentProject));
    }

    // Load related data in parallel (stats, files, conversations, artifacts)
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
 * Load statistics for a project.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<ProjectStats>} - Resolves to stats object.
 *
 * Emits:
 * - "projectStatsLoaded" on success.
 * - "projectStatsError" on error.
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
 * Load files for a project.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<Array>} - Resolves to an array of files.
 *
 * Emits:
 * - "projectFilesLoaded" on success.
 * - "projectFilesError" on error.
 */
async function loadProjectFiles(projectId) {
  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    // Support various API response shapes
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
 * Load conversations for a project.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<Array>} - Resolves to an array of conversations.
 *
 * Emits:
 * - "projectConversationsLoaded" on success.
 * - "projectConversationsError" on error.
 */
async function loadProjectConversations(projectId) {
  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    // Support various API response shapes
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
 * Load artifacts for a project.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<Array>} - Resolves to an array of artifacts.
 *
 * Emits:
 * - "projectArtifactsLoaded" on success.
 * - "projectArtifactsError" on error.
 */
async function loadProjectArtifacts(projectId) {
  try {
    const endpoint = PROJECT_CONFIG.ENDPOINTS.PROJECT_ARTIFACTS.replace('{projectId}', projectId);
    const response = await window.app.apiRequest(endpoint, { method: 'GET' });

    // Support various API response shapes
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
 * Create a new project or update an existing one.
 *
 * @param {string|null} projectId - The project UUID (null for create).
 * @param {Object} projectData - The project data to save.
 * @returns {Promise<Project>} - Resolves to the saved project object.
 *
 * Emits:
 * - "projectCreated" on creation.
 * - "projectUpdated" on update.
 *
 * @throws {Error} - If not authenticated or save fails.
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
 * Delete a project.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<any>} - Resolves to API response.
 *
 * Emits:
 * - "projectDeleted" on success.
 *
 * @throws {Error} - If not authenticated or delete fails.
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
 * Toggle the pin status for a project.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<any>} - Resolves to API response.
 *
 * Emits:
 * - "projectPinToggled" on success.
 *
 * @throws {Error} - If not authenticated or toggle fails.
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
 * Toggle the archive status for a project.
 *
 * @param {string} projectId - The project UUID.
 * @returns {Promise<any>} - Resolves to API response.
 *
 * Emits:
 * - "projectArchiveToggled" on success.
 *
 * @throws {Error} - If not authenticated or toggle fails.
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
 * Create a new conversation for a project (delegated to chatManager).
 *
 * @param {string} projectId - The project UUID.
 * @param {Object} [options={}] - Conversation options.
 * @returns {Promise<any>} - Resolves to the new conversation.
 */
async function createConversation(projectId, options = {}) {
  try {
    // Persist selected project for context
    localStorage.setItem("selectedProjectId", projectId);
    return await window.chatManager.createNewConversation(options);
  } catch (error) {
    console.error("[projectManager] createConversation error:", error);
    throw error;
  }
}

/**
 * Delete a conversation from a project (delegated to chatManager).
 *
 * @param {string} projectId - The project UUID.
 * @param {string} conversationId - The conversation UUID.
 * @returns {Promise<boolean>} - Resolves to true on success.
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
 * Emit a custom DOM event for projectManager state changes.
 *
 * @param {string} eventName - The event name.
 * @param {Object} detail - Event detail object.
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
 * Get the currently loaded project.
 *
 * @returns {Project|null} - The current project or null.
 */
function getCurrentProject() {
  return currentProject ? JSON.parse(JSON.stringify(currentProject)) : null;
}

/**
 * Validate and prepare files for upload.
 *
 * @param {string} projectId - The project UUID.
 * @param {FileList|Array<File>} fileList - List of files to validate.
 * @returns {Promise<FileUploadResult>} - Object with validated and invalid files.
 */
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

/**
 * Upload a file to a project, with retry and exponential backoff.
 *
 * @param {string} projectId - The project UUID.
 * @param {{file: File}} fileObj - Object containing the file to upload.
 * @param {number} [maxRetries=3] - Maximum number of retries.
 * @returns {Promise<boolean>} - Resolves to true on success.
 * @throws {Error} - If upload fails after all retries.
 */
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

// Exported API
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

// Attach to window and register with DependencySystem if available
window.projectManager = window.projectManager || projectManagerAPI;

if (window.DependencySystem) {
  window.DependencySystem.register('projectManager', window.projectManager);
} else {
  // Wait for DependencySystem to be available, then register
  Object.defineProperty(window, 'DependencySystem', {
    configurable: true,
    set: function (value) {
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
