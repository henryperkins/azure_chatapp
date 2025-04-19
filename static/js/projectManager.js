/**
 * projectManager.js - Aligned with AuthBus
 * ---------------------------------------
 * Handles all data operations (API calls) for projects, files, conversations, artifacts.
 * Dispatches custom DOM events to inform the UI about loaded or updated data.
 * Contains NO direct DOM manipulation or direct form/modals references.
 * Uses window.auth for authentication checks and window.apiRequest for API calls.
 */

(function () {
  /* ===========================
     API ENDPOINTS
     =========================== */
  // Define API endpoints configuration
  const API_ENDPOINTS = {
    PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations/',
    PROJECT_FILES: '/api/projects/{projectId}/files/'
    // Add other endpoints as needed
  };

  /* ===========================
     STATE MANAGEMENT
     =========================== */
  // Store the current project in memory for convenience
  let currentProject = null;
  let isAuthInitialized = false; // Track if auth module reported ready

  /* ===========================
     EVENT MANAGEMENT
     =========================== */
  /**
   * Emit a custom event with data (on document for UI components).
   * projectManager uses standard DOM events for project/file-specific updates,
   * while auth status is handled via AuthBus in auth.js.
   *
   * @param {string} eventName - Name of the event to emit
   * @param {Object} detail - Event payload
   */
  function emitEvent(eventName, detail) {
    // Always ensure we pass an object with a source field
    const eventDetail = {
      ...((typeof detail === 'object' && detail !== null) ? detail : {}),
      source: "projectManager"
    };

    document.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
  }

  /* ===========================
     DATA OPERATIONS - PROJECTS
     =========================== */

  // Track if project loading is already in progress to prevent recursive calls
  let projectLoadingInProgress = false;

  /**
   * Load a list of projects from the server (optionally filtered).
   * Dispatches "projectsLoaded" event with { projects, count, filter, error? }.
   * @param {string} [filter] - Optional filter ("all", "pinned", "archived", "active")
   * @returns {Promise<Array>} - Array of projects
   */
  async function loadProjects(filter = null) {
    console.log("[DEBUG] loadProjects called - TEST LOG");
    // Wait for auth to be fully ready
    if (!window.auth?.isReady) {
      console.log("[projectManager] Waiting for auth to be ready...");
      console.log("[DEBUG] Current auth state:", window.auth?.isReady);
      await new Promise((resolve) => {
        const checkAuth = () => {
          if (window.auth?.isReady) {
            resolve();
          } else {
            setTimeout(checkAuth, 100);
          }
        };
        checkAuth();
      });
    }

    // Check if already loading
    if (projectLoadingInProgress || window.__projectLoadingInProgress) {
      console.log("[projectManager] Project loading already in progress");
      return [];
    }

    // Verify auth state with proper waiting
    let isAuthenticated;
    try {
      // Wait for any in-progress auth check to complete first
      if (window.auth.authCheckInProgress) {
        console.debug('[projectManager] Waiting for auth check to complete...');
        while (window.auth.authCheckInProgress) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        console.warn("[projectManager] User not authenticated, skipping project load");
        emitEvent("projectAuthError", {
          reason: 'load_projects',
          error: new Error("Authentication required"),
          retryAfter: 30000 // 30s cooldown
        });
        return [];
      }
    } catch (err) {
      console.error("[projectManager] Auth verification failed:", err);
      emitEvent("projectAuthError", {
        reason: 'load_projects',
        error: err,
        retryAfter: 30000 // 30s cooldown
      });
      return [];
    }

    // Add cooldown check to prevent rapid retries
    if (window.__projectLoadCooldownUntil && Date.now() < window.__projectLoadCooldownUntil) {
      console.warn("[projectManager] Project loading in cooldown period, skipping");
      return [];
    }

    projectLoadingInProgress = true;
    window.__projectLoadingInProgress = true;

    const validFilters = ["all", "pinned", "archived", "active"];
    const cleanFilter = validFilters.includes(filter) ? filter : "all";

    // Emit an event to show loading state
    emitEvent("projectsLoading", { filter: cleanFilter });

    try {
      // Use centralized auth check from window.auth
      const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        console.warn("[projectManager] loadProjects skipped: User not authenticated.");
        emitEvent("showLoginPrompt", { reason: "loadProjects" }); // Let UI show login
        emitEvent("projectsLoaded", {
          projects: [],
          count: 0,
          filter: { type: cleanFilter },
          error: true,
          reason: 'auth_required'
        });
        emitEvent("projectAuthError", { reason: 'load_projects', error: new Error("Authentication required") });
        return [];
      }

      // Build query params
      const params = new URLSearchParams();
      params.append("filter", cleanFilter);
      params.append("skip", "0");
      params.append("limit", "100"); // Consider pagination

      const endpoint = `/api/projects?${params.toString()}`;

      // Use global apiRequest which should handle CSRF via window.auth
      const response = await window.apiRequest(endpoint, "GET");

      // Standardize response format
      let projects = response?.data?.projects ||
                     response?.projects ||
                     (Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []));

      if (!Array.isArray(projects)) {
        console.warn("[projectManager] Unexpected project list format:", response);
        projects = [];
      }

      emitEvent("projectsLoaded", {
        projects,
        count: projects.length,
        filter: { type: cleanFilter }
      });

      return projects;
    } catch (error) {
      console.error("[projectManager] Error loading projects:", error);

      // Set cooldown on auth errors
      if (error.status === 401) {
        window.__projectLoadCooldownUntil = Date.now() + 30000; // 30s cooldown
        emitEvent("projectAuthError", {
          reason: 'load_projects',
          error,
          retryAfter: 30000
        });
      }

      emitEvent("projectsLoaded", {
        projects: [],
        count: 0,
        filter: { type: cleanFilter },
        error: true,
        message: error.message,
        status: error.status
      });

      return [];
    } finally {
      projectLoadingInProgress = false;
      window.__projectLoadingInProgress = false;
    }
  }

  /**
   * Load details for a single project.
   * Dispatches "projectLoaded" with the project data.
   * Also loads stats, files, conversations, artifacts if not archived.
   * @param {string} projectId - Project ID
   * @returns {Promise<Object|null>} - Project data or null on failure
   */
  async function loadProjectDetails(projectId) {
    if (!isAuthInitialized) {
      console.warn("[projectManager] loadProjectDetails called before auth is ready. Waiting...");
      await new Promise(resolve => window.auth.AuthBus.addEventListener('authReady', resolve, { once: true }));
      console.log("[projectManager] Auth is ready, proceeding with loadProjectDetails.");
    }

    // Basic UUID check
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!projectId || typeof projectId !== 'string' || !uuidRegex.test(projectId)) {
      const error = new Error(`Invalid or malformed project ID: ${projectId}`);
      console.error("[projectManager]", error.message);
      emitEvent('projectDetailsError', { projectId, error });
      return null;
    }

    const projectEndpoint = `/api/projects/${projectId}/`;

    try {
      currentProject = null; // Clear current while loading
      emitEvent("projectDetailsLoading", { projectId });

      // Auth check
      const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        console.warn(`[projectManager] loadProjectDetails (${projectId}) skipped: User not authenticated.`);
        emitEvent("projectDetailsError", {
          projectId,
          error: new Error("Authentication required"),
          reason: 'auth_required'
        });
        emitEvent("projectAuthError", { reason: 'project_details', error: new Error("Authentication required") });
        return null;
      }

      const response = await window.apiRequest(projectEndpoint, "GET");

      // Flexible response parsing
      let projectData = null;
      if (response?.data?.id) projectData = response.data;
      else if (response?.id) projectData = response;
      else if (response?.success === true && response?.data?.id) projectData = response.data;

      if (!projectData || projectData.id !== projectId) {
        const snippet = JSON.stringify(response || {}).substring(0, 100);
        throw new Error(`Invalid project response format or ID mismatch. Received: ${snippet}...`);
      }

      currentProject = projectData;
      emitEvent("projectLoaded", JSON.parse(JSON.stringify(currentProject)));

      // If archived, skip related data
      if (currentProject.archived) {
        console.log(`[projectManager] Project ${projectId} archived, skipping related data.`);
        emitEvent("projectArchivedNotice", { id: currentProject.id });
        return JSON.parse(JSON.stringify(currentProject));
      }

      // Load related data in parallel
      const results = await Promise.allSettled([
        loadProjectStats(projectId),
        loadProjectFiles(projectId),
        loadProjectConversations(projectId),
        loadProjectArtifacts(projectId)
      ]);

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const loadType = ['stats', 'files', 'conversations', 'artifacts'][index];
          console.error(`[projectManager] Failed to load project ${loadType}:`, result.reason);
          emitEvent(`project${loadType.charAt(0).toUpperCase() + loadType.slice(1)}Error`, {
            projectId,
            error: {
              message: result.reason?.message || 'Unknown error',
              status: result.reason?.status
            }
          });
        }
      });

      return JSON.parse(JSON.stringify(currentProject));
    } catch (err) {
      console.error(`[projectManager] Error loading project details for ${projectId}:`, err);
      emitEvent("projectDetailsError", { projectId, error: { message: err.message, status: err.status } });
      if (err.status === 401) {
        emitEvent("projectAuthError", { reason: 'project_details', error: err });
      } else if (err.status === 404) {
        emitEvent('projectNotFound', { projectId });
      }
      currentProject = null;
      return null;
    }
  }

  /**
   * Load project stats (token usage, file counts, etc.).
   * Dispatches "projectStatsLoaded" with stats.
   * @param {string} projectId
   */
  async function loadProjectStats(projectId) {
    const defaultStats = {
      token_usage: 0,
      max_tokens: 0,
      file_count: 0,
      conversation_count: 0,
      artifact_count: 0
    };
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/stats`, "GET");
      const stats = response?.data || {};
      const finalStats = { ...defaultStats, ...stats };
      emitEvent("projectStatsLoaded", { projectId, ...finalStats });
      return finalStats;
    } catch (err) {
      console.error(`[projectManager] Error loading project stats for ${projectId}:`, err);
      emitEvent("projectStatsLoaded", { projectId, ...defaultStats });
      emitEvent("projectStatsError", { projectId, error: { message: err.message, status: err.status } });
      if (err.status === 401) {
        emitEvent("projectAuthError", { reason: 'project_stats', error: err });
      }
      return defaultStats;
    }
  }

  /**
   * Load files for a project.
   * Dispatches "projectFilesLoaded" with { files }.
   * @param {string} projectId
   */
  async function loadProjectFiles(projectId) {
    try {
      const endpoint = API_ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
      const response = await window.apiRequest(endpoint, "GET");
      const files = response?.data?.files ||
                    response?.files ||
                    (Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []));

      if (!Array.isArray(files)) {
        console.warn(`[projectManager] Unexpected file list format for ${projectId}:`, response);
        emitEvent("projectFilesLoaded", { projectId, files: [] });
        return [];
      }

      emitEvent("projectFilesLoaded", { projectId, files });
      return files;
    } catch (err) {
      console.error(`[projectManager] Error loading project files for ${projectId}:`, err);
      emitEvent("projectFilesLoaded", { projectId, files: [] });
      emitEvent("projectFilesError", { projectId, error: { message: err.message, status: err.status } });
      if (err.status === 401) {
        emitEvent("projectAuthError", { reason: 'project_files', error: err });
      }
      return [];
    }
  }

  /**
   * Load conversations for a project.
   * Dispatches "projectConversationsLoaded" with conversations[].
   * @param {string} projectId
   */
  async function loadProjectConversations(projectId) {
    try {
      const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
      const response = await window.apiRequest(endpoint, "GET");
      let conversations = response?.data?.conversations ||
                          response?.conversations ||
                          (Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []));

      if (!Array.isArray(conversations)) {
        console.warn(`[projectManager] Unexpected conversation list format for ${projectId}:`, response);
        emitEvent("projectConversationsLoaded", { projectId, conversations: [] });
        return [];
      }

      emitEvent("projectConversationsLoaded", { projectId, conversations });
      return conversations;
    } catch (err) {
      console.error(`[projectManager] Error loading conversations for ${projectId}:`, err);
      emitEvent("projectConversationsLoaded", { projectId, conversations: [] });
      emitEvent("projectConversationsError", { projectId, error: { message: err.message, status: err.status } });
      if (err.status === 401) {
        emitEvent("projectAuthError", { reason: 'project_conversations', error: err });
      }
      return [];
    }
  }

  /**
   * Load artifacts for a project.
   * Dispatches "projectArtifactsLoaded" with { artifacts }.
   * @param {string} projectId
   */
  async function loadProjectArtifacts(projectId) {
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/artifacts`, "GET");
      const artifacts = response?.data?.artifacts ||
                        response?.artifacts ||
                        (Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []));

      if (!Array.isArray(artifacts)) {
        console.warn(`[projectManager] Unexpected artifact list format for ${projectId}:`, response);
        emitEvent("projectArtifactsLoaded", { projectId, artifacts: [] });
        return [];
      }

      emitEvent("projectArtifactsLoaded", { projectId, artifacts });
      return artifacts;
    } catch (err) {
      console.error(`[projectManager] Error loading artifacts for ${projectId}:`, err);
      emitEvent("projectArtifactsLoaded", { projectId, artifacts: [] });
      emitEvent("projectArtifactsError", { projectId, error: { message: err.message, status: err.status } });

      if (err.status === 404) {
        emitEvent('projectNotFound', { projectId });
        if (currentProject?.id === projectId) currentProject = null;
      } else if (err.status === 401) {
        emitEvent("projectAuthError", { reason: 'project_artifacts', error: err });
      } else {
        emitEvent('projectDetailsError', { projectId, error: { message: err.message, status: err.status } });
      }
      return [];
    }
  }

  /**
   * Create or update a project. Requires authentication.
   * @param {string|null} projectId - Project ID to update, or null/undefined to create
   * @param {Object} projectData - Data for creation/update
   */
  async function createOrUpdateProject(projectId, projectData) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'create_update_project', error: new Error("Authentication required") });
      throw new Error('Authentication required to create or update projects.');
    }

    const isUpdate = !!projectId;
    const method = isUpdate ? "PATCH" : "POST";
    const endpoint = isUpdate ? `/api/projects/${projectId}` : "/api/projects";

    try {
      const response = await window.apiRequest(endpoint, method, projectData);
      const resultData = response?.data || response;
      if (!resultData || !resultData.id) {
        throw new Error("Invalid response from server after project save.");
      }

      if (isUpdate && currentProject?.id === projectId) {
        currentProject = { ...currentProject, ...resultData };
        emitEvent("projectUpdated", JSON.parse(JSON.stringify(currentProject)));
      } else if (!isUpdate) {
        emitEvent("projectCreated", resultData);
      }
      return resultData;
    } catch (error) {
      console.error(`[projectManager] Error ${isUpdate ? 'updating' : 'creating'} project ${projectId || ''}:`, error);
      throw error; // Let the UI handle the error
    }
  }

  /**
   * Delete a project by ID. Requires authentication.
   * @param {string} projectId
   */
  async function deleteProject(projectId) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'delete_project', error: new Error("Authentication required") });
      throw new Error('Authentication required to delete projects.');
    }
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}`, "DELETE");
      if (currentProject?.id === projectId) {
        currentProject = null;
      }
      emitEvent("projectDeleted", { projectId });
      return response;
    } catch (error) {
      console.error(`[projectManager] Error deleting project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Pin/unpin a project (toggle). Requires authentication.
   */
  async function togglePinProject(projectId) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'toggle_pin', error: new Error("Authentication required") });
      throw new Error('Authentication required to pin/unpin projects.');
    }
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/pin`, "POST");
      emitEvent("projectPinToggled", { projectId, pinned: response?.pinned ?? !currentProject?.pinned });
      return response;
    } catch (error) {
      console.error(`[projectManager] Error toggling pin for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Archive/unarchive a project (toggle). Requires authentication.
   */
  async function toggleArchiveProject(projectId) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'toggle_archive', error: new Error("Authentication required") });
      throw new Error('Authentication required to archive/unarchive projects.');
    }
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/archive`, "PATCH");
      emitEvent("projectArchiveToggled", { projectId, archived: response?.archived ?? !currentProject?.archived });

      // If archiving current project, optionally clear local data
      if (response?.archived === true && currentProject?.id === projectId) {
        // E.g. emitEvent("projectArchived", { projectId });
      }
      return response;
    } catch (error) {
      console.error(`[projectManager] Error toggling archive for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Save custom instructions field on the project. Requires authentication.
   */
  async function saveCustomInstructions(projectId, instructions) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'save_instructions', error: new Error("Authentication required") });
      throw new Error('Authentication required to save instructions.');
    }
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}`, "PATCH", {
        custom_instructions: instructions
      });
      if (currentProject?.id === projectId) {
        currentProject.custom_instructions = instructions;
      }
      emitEvent("projectInstructionsSaved", { projectId, instructions });
      return response;
    } catch (error) {
      console.error(`[projectManager] Error saving instructions for project ${projectId}:`, error);
      throw error;
    }
  }

  /* ===========================
     KNOWLEDGE BASE OPERATIONS
     =========================== */

  function isKnowledgeBaseReady() {
    return isKnowledgeBaseActive(currentProject);
  }

  function isKnowledgeBaseActive(project) {
    if (!project) return false;
    const hasKnowledgeBase = !!project.knowledge_base_id;
    const isActive = project.knowledge_base ? project.knowledge_base.is_active !== false : true;
    return hasKnowledgeBase && isActive;
  }

  /**
   * Validate and prepare files for upload.
   */
  function prepareFileUploads(files) {
    const allowedExtensions = [
      ".txt", ".md", ".csv", ".json", ".pdf", ".doc", ".docx",
      ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".scss",
      ".java", ".c", ".cpp", ".h", ".cs", ".php", ".rb", ".go", ".swift", ".kt"
    ];
    const maxSizeMB = 50;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    const validatedFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      const fileName = file.name || '';
      const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

      if (!allowedExtensions.includes(fileExt)) {
        invalidFiles.push({ file, reason: `Invalid file type (${fileExt || 'unknown'})` });
      } else if (file.size > maxSizeBytes) {
        invalidFiles.push({ file, reason: `Exceeds size limit (${maxSizeMB}MB)` });
      } else if (file.size === 0) {
        invalidFiles.push({ file, reason: `File is empty` });
      } else {
        validatedFiles.push(file);
      }
    }

    return { validatedFiles, invalidFiles };
  }

  /**
   * Example sanitization: strip <script> tags, etc.
   */
  async function sanitizeFile(file) {
    try {
      const fileContent = await file.text();
      const dangerousPatterns = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
      const sanitizedContent = fileContent.replace(dangerousPatterns, "[SANITIZED SCRIPT]");
      const sanitizedBlob = new Blob([sanitizedContent], { type: file.type || 'text/plain' });
      return new File([sanitizedBlob], file.name, {
        type: file.type || 'text/plain',
        lastModified: file.lastModified
      });
    } catch (readError) {
      console.error(`[projectManager] Error reading file ${file.name} for sanitization:`, readError);
      throw new Error(`Could not read file ${file.name} for sanitization.`);
    }
  }

  function parseFileUploadError(err) {
    const status = err?.status;
    const detail = err?.message || "File upload failed";

    if (status === 422) {
      return new Error("File validation failed by server (unsupported type, corrupted, or content issues).");
    } else if (status === 413) {
      return new Error("File is too large (exceeds server limit).");
    } else if (status === 400) {
      if (detail.includes("token limit")) {
        const maxTokens = currentProject?.max_tokens || 200000;
        return new Error(
          `File content exceeds project token limit (${maxTokens.toLocaleString()}).\n` +
          `Try splitting the file or increasing the project limit.`
        );
      }
      return new Error(`Upload failed: ${detail}`);
    } else if (status === 404) {
      return new Error("Project or knowledge base not found on server.");
    } else if (status === 403) {
      return new Error("Permission denied or knowledge base is not active.");
    }
    return new Error(detail);
  }

  /**
   * Upload a single validated and sanitized file to the current project's KB.
   */
  async function uploadFile(projectId, file) {
    if (!currentProject || currentProject.id !== projectId) {
      console.warn(`[projectManager] Current project ${currentProject?.id} doesn't match upload target ${projectId}. Reloading...`);
      await loadProjectDetails(projectId);
      if (!currentProject || currentProject.id !== projectId) {
        throw new Error("Target project for upload is not loaded.");
      }
    }

    if (!isKnowledgeBaseReady()) {
      const error = new Error("Knowledge Base is not active or configured for this project. Please enable it.");
      error.code = "KB_NOT_READY";
      emitEvent("knowledgeBaseError", { projectId, error });
      throw error;
    }

    // FormData usage
    const formData = new FormData();
    formData.append("file", file);

    try {
      const endpoint = API_ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
      const response = await window.apiRequest(endpoint, "POST", formData);

      emitEvent("fileUploadSuccess", {
        projectId,
        fileId: response?.data?.id || response?.id,
        fileName: file.name,
        response
      });

      // Check if response indicates background processing
      if (response?.data?.processing_status === "pending" || response?.processing_status === "pending") {
        emitEvent("fileProcessingStarted", {
          projectId,
          fileId: response?.data?.id || response?.id,
          fileName: file.name,
          kb_id: currentProject.knowledge_base_id
        });
        return response;
      }
      // If processing failed
      if (response?.data?.processing_status === "failed" || response?.processing_status === "failed") {
        const failureReason = response?.data?.error || response?.error || "Knowledge base processing failed";
        throw new Error(failureReason);
      }

      // Otherwise assume success
      emitEvent("fileProcessingComplete", {
        projectId,
        fileId: response?.data?.id || response?.id,
        fileName: file.name,
        status: 'completed'
      });
      return response;
    } catch (err) {
      console.error(`[projectManager] File upload failed for ${file.name} in project ${projectId}:`, err);
      const parsedError = parseFileUploadError(err);
      emitEvent("fileUploadFailed", { projectId, fileName: file.name, error: parsedError });
      if (err.status === 401) {
        emitEvent("projectAuthError", { reason: 'file_upload', error: err });
      }
      throw parsedError;
    }
  }

  /**
   * Delete a file from a project. Requires authentication.
   */
  async function deleteFile(projectId, fileId) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'delete_file', error: new Error("Authentication required") });
      throw new Error('Authentication required to delete files.');
    }
    try {
      const endpoint = API_ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
      const response = await window.apiRequest(`${endpoint}${fileId}`, "DELETE");
      emitEvent("fileDeleted", { projectId, fileId });
      return response;
    } catch (error) {
      console.error(`[projectManager] Error deleting file ${fileId} from project ${projectId}:`, error);
      emitEvent("fileDeleteFailed", {
        projectId,
        fileId,
        error: { message: error.message, status: error.status }
      });
      throw error;
    }
  }

  /**
   * Delete a conversation from a project. Requires authentication.
   */
  async function deleteProjectConversation(projectId, conversationId) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'delete_conversation', error: new Error("Authentication required") });
      throw new Error('Authentication required to delete conversations.');
    }
    try {
      const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
      await window.apiRequest(`${endpoint}${conversationId}`, "DELETE");
      emitEvent("conversationDeleted", { projectId, conversationId });

      // Refresh project stats & convos after deletion
      await Promise.allSettled([
        loadProjectStats(projectId),
        loadProjectConversations(projectId)
      ]);
    } catch (error) {
      console.error(`[projectManager] Error deleting conversation ${conversationId} in project ${projectId}:`, error);
      emitEvent("conversationDeleteFailed", {
        projectId,
        conversationId,
        error: { message: error.message, status: error.status }
      });
      throw error;
    }
  }

  /**
   * Delete an artifact from a project. Requires authentication.
   */
  async function deleteArtifact(projectId, artifactId) {
    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'delete_artifact', error: new Error("Authentication required") });
      throw new Error('Authentication required to delete artifacts.');
    }
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/artifacts/${artifactId}`, "DELETE");
      emitEvent("artifactDeleted", { projectId, artifactId });
      return response;
    } catch (error) {
      console.error(`[projectManager] Error deleting artifact ${artifactId} from project ${projectId}:`, error);
      emitEvent("artifactDeleteFailed", {
        projectId,
        artifactId,
        error: { message: error.message, status: error.status }
      });
      throw error;
    }
  }

  /**
   * Create a new conversation within a project. Requires authentication.
   */
  async function createConversation(projectId, options = {}) {
    console.debug(`[ProjectManager] Creating conversation for project: ${projectId}`, options);

    const isAuthenticated = await window.auth.isAuthenticated({ forceVerify: true });
    if (!isAuthenticated) {
      emitEvent("projectAuthError", { reason: 'create_conversation', error: new Error("Authentication required") });
      throw new Error('Authentication required to create conversations.');
    }

    if (!currentProject || currentProject.id !== projectId) {
      console.debug(`[ProjectManager] Project ${projectId} not current, loading...`);
      await loadProjectDetails(projectId);
      if (!currentProject || currentProject.id !== projectId) {
        throw new Error(`Failed to load project ${projectId} before creating conversation.`);
      }
    }

    const payload = {
      title: options.title || "New Conversation",
      model: options.model || window.MODEL_CONFIG?.modelName || "claude-3-sonnet-20240229",
      system_prompt: options.system_prompt || window.MODEL_CONFIG?.customInstructions || ""
    };

    try {
      const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
      const response = await window.apiRequest(endpoint, "POST", payload);

      const conversationData = response?.data || response;
      if (!conversationData?.id) {
        console.error('[ProjectManager] Invalid conversation response:', response);
        throw new Error(`Server returned invalid conversation data: ${JSON.stringify(response)}`);
      }

      emitEvent("conversationCreated", { projectId, conversation: conversationData });

      // Optionally link to KB if active
      if (isKnowledgeBaseActive(currentProject)) {
        try {
          await linkConversationToKnowledgeBase(conversationData.id);
        } catch (linkError) {
          console.warn(`[ProjectManager] Conversation ${conversationData.id} created, but KB link failed:`, linkError);
          emitEvent("knowledgeBaseLinkFailed", {
            projectId,
            conversationId: conversationData.id,
            kbId: currentProject.knowledge_base_id,
            error: linkError
          });
        }
      }

      return conversationData;
    } catch (error) {
      console.error('[ProjectManager] Conversation creation failed:', error);
      const formattedError = formatProjectError(error);
      emitEvent("conversationCreateFailed", { projectId, error: { message: formattedError, status: error.status } });
      throw new Error(`Failed to create conversation: ${formattedError}`);
    }
  }

  /**
   * Link a conversation to the current project's knowledge base.
   */
  async function linkConversationToKnowledgeBase(conversationId) {
    if (!currentProject || !currentProject.id) {
      throw new Error("No current project loaded to link conversation.");
    }
    const projectId = currentProject.id;
    const kbId = currentProject.knowledge_base_id;

    if (!isKnowledgeBaseActive(currentProject)) {
      console.warn(`[ProjectManager] Skipping KB link for conversation ${conversationId}: KB ${kbId} not active.`);
      return;
    }

    try {
      console.debug(`[ProjectManager] Linking conversation ${conversationId} to KB ${kbId}`);
      await window.apiRequest(
        `/api/projects/${projectId}/knowledge-base/conversations/${conversationId}`,
        "PUT",
        { association_type: "primary" }
      );
      emitEvent("knowledgeBaseLinkSuccess", { projectId, conversationId, kbId });
    } catch (linkError) {
      console.error(`[ProjectManager] KB linking failed for conversation ${conversationId}:`, linkError);
      throw new Error(`Failed to link conversation to knowledge base: ${linkError.message}`);
    }
  }

  /**
   * Format project-related errors for user display.
   */
  function formatProjectError(error) {
    const status = error?.status;
    const serverMessage = error?.message || "An unknown error occurred";
    if (status === 403) {
      return "Permission denied for this project operation.";
    } else if (status === 404) {
      return "Project not found or resource is missing.";
    } else if (status === 401) {
      return "Authentication failed or session expired. Please log in again.";
    } else if (status === 400) {
      return `Invalid request: ${serverMessage}`;
    } else if (status >= 500) {
      return `Server error (${status}). Please try again later.`;
    }
    return serverMessage;
  }

  /**
   * Load knowledge base details for the current project.
   */
  async function loadKnowledgeBaseDetails() {
    if (!currentProject || !currentProject.knowledge_base_id) {
      return null;
    }
    const projectId = currentProject.id;
    const kbId = currentProject.knowledge_base_id;

    try {
      const response = await window.apiRequest(`/api/knowledge-bases/${kbId}`, "GET");
      const kbData = response?.data || response;
      if (!kbData || kbData.id !== kbId) {
        throw new Error("Invalid KB details response.");
      }
      currentProject.knowledge_base = kbData;
      emitEvent("knowledgeBaseLoaded", { projectId, kb: kbData });
      return kbData;
    } catch (err) {
      console.error(`[projectManager] Failed to load KB details for ${kbId}:`, err);
      emitEvent("knowledgeBaseError", { projectId, error: { message: err.message, status: err.status } });
      if (err.status === 401) {
        emitEvent("projectAuthError", { reason: 'load_kb_details', error: err });
      }
      return null;
    }
  }

  /* ===========================
     UTILITY FUNCTIONS
     =========================== */

  /**
   * Get the currently loaded project data (returns a deep clone).
   */
  function getCurrentProject() {
    return currentProject ? JSON.parse(JSON.stringify(currentProject)) : null;
  }

  /**
   * Example check to see if a project endpoint is responsive.
   */
  async function checkProjectApiEndpoint(projectId, timeout = 2000) {
    if (!projectId) throw new Error("Project ID required");

    const apiCheck = async (endpoint) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await window.apiRequest(endpoint, "GET", null, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
      } catch (e) {
        clearTimeout(timeoutId);
        throw e;
      }
    };

    try {
      const stdResponse = await apiCheck(`/api/projects/${projectId}/`);
      if (stdResponse?.id === projectId) {
        console.debug(`[projectManager] Endpoint check: /api/projects/${projectId}/ is standard.`);
        return "standard";
      }
    } catch (e) {
      if (e.name !== 'AbortError' && e.status !== 404) {
        console.warn("[projectManager] Standard endpoint check failed:", e.message);
      }
    }

    console.warn(`[projectManager] Could not determine API endpoint type for project ${projectId}.`);
    return "unknown";
  }

  /* ===========================
     INITIALIZATION
     =========================== */

  /**
   * Initialization function for projectManager. Waits for auth to be ready,
   * then subscribes to auth-related events via AuthBus.
   */
  async function initialize() {
    console.log("[projectManager] Initializing...");

    // 1. Wait for Auth Module readiness
    if (!window.auth || !window.auth.isReady) {
      console.log("[projectManager] Waiting for auth module to be ready...");
      await new Promise(resolve => {
        if (window.auth?.AuthBus) {
          window.auth.AuthBus.addEventListener('authReady', resolve, { once: true });
        } else {
          // Fallback if AuthBus missing
          const checkAuth = setInterval(() => {
            if (window.auth?.isReady) {
              clearInterval(checkAuth);
              resolve();
            }
          }, 100);
        }
      });
      console.log("[projectManager] Auth module ready.");
      isAuthInitialized = true;
    } else {
      console.log("[projectManager] Auth module was already ready.");
      isAuthInitialized = true;
    }

    // 2. Listen for Authentication State via AuthBus
    if (window.auth?.AuthBus) {
      window.auth.AuthBus.addEventListener('authStateChanged', (event) => {
        const { authenticated } = event.detail || {};
        console.log(`[projectManager] Received authStateChanged: ${authenticated}`);
        if (!authenticated) {
          // If user logs out, clear the current project
          console.log("[projectManager] User logged out, clearing current project.");
          currentProject = null;
          emitEvent("currentProjectCleared", { reason: "logout" });
        } else {
          // If user logs in, optionally reload a remembered project
          if (currentProject?.id) {
            console.log(`[projectManager] User logged in, might reload project ${currentProject.id}.`);
            // Example: loadProjectDetails(currentProject.id);
          }
        }
      });

      // 3. Listen for Backend Unavailability via AuthBus
      window.auth.AuthBus.addEventListener('backendUnavailable', (event) => {
        const { reason, until } = event.detail || {};
        console.warn(`[projectManager] backendUnavailable (Reason: ${reason}), blocked until ${until?.toLocaleTimeString()}.`);
        emitEvent("backendStatusChanged", { available: false, reason, until });
      });

    } else {
      console.error("[projectManager] Could not find window.auth.AuthBus to listen for auth events.");
    }

    console.log("[projectManager] Initialization complete.");
  }

  /* ===============================
     FINAL EXPORTS
     =============================== */
  // Expose public API via window.projectManager
  window.projectManager = {
    // Initialization
    initialize,

    // Project CRUD & Loading
    loadProjects,
    loadProjectDetails,
    loadProjectStats,
    loadProjectFiles,
    loadProjectConversations,
    loadProjectArtifacts,
    createOrUpdateProject,
    deleteProject,

    // Project Actions
    togglePinProject,
    toggleArchiveProject,
    saveCustomInstructions,

    // KB & File Handling
    isKnowledgeBaseReady,
    isKnowledgeBaseActive,
    prepareFileUploads,
    uploadFile,
    deleteFile,

    // Conversations & Artifacts
    createConversation,
    deleteProjectConversation,
    deleteArtifact,
    linkConversationToKnowledgeBase,

    // Utilities
    getCurrentProject,
    checkProjectApiEndpoint,
    loadKnowledgeBaseDetails
  };

  console.log('[ProjectManager] projectManager.js loaded and aligned with AuthBus.');
})();
