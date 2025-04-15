/**
 * projectManager.js
 * ------------------
 * Handles all data operations (API calls) for projects, files, conversations, artifacts.
 * Dispatches custom DOM events to inform the UI about loaded or updated data.
 * Contains NO direct DOM manipulation or direct form/modals references.
 * Uses ChatUtils for authentication and error handling.
 */

(function () {
  /* ===========================
     API ENDPOINTS
     =========================== */
  // Define API endpoints configuration
  const API_ENDPOINTS = {
    PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations/',
    PROJECT_FILES: '/api/projects/{projectId}/files/'
  };

  // Debug flag for controlling auth token logging
  const DEBUG = false; // Set to true only during development
  const AUTH_LOG_INTERVAL = 5000; // Minimum ms between auth logs for the same operation
  let lastAuthLogTimestamps = {}; // Track last log time by operation

  /* ===========================
     STATE MANAGEMENT
     =========================== */
  // Store the current project in memory for convenience
  let currentProject = null;

  /* ===========================
     EVENT MANAGEMENT
     =========================== */
  /**
   * Emit a custom event with data
   * @param {string} eventName - Name of the event to emit
   * @param {Object} detail - Event data
   */
  function emitEvent(eventName, detail) {
    // Always ensure we pass an object
    const eventDetail = (typeof detail === 'object' && detail !== null) ? detail : {};
    document.dispatchEvent(new CustomEvent(eventName, { detail: eventDetail }));
  }

  /* ===========================
     DATA OPERATIONS - PROJECTS
     =========================== */

  /**
   * Load a list of projects from the server (optionally filtered).
   * Dispatches "projectsLoaded" event with { projects, count, filter, error? }.
   * @param {string} [filter] - Optional filter ("all", "pinned", "archived", "active")
   * @returns {Promise<Array>} - Array of projects
   */
  async function loadProjects(filter = null) {
    const validFilters = ["all", "pinned", "archived", "active"];
    const cleanFilter = validFilters.includes(filter) ? filter : "all";

    // Show loading state immediately
    emitEvent("projectsLoading", { filter: cleanFilter });

    try {
      // Use centralized auth check
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        console.warn("[projectManager] loadProjects skipped: User not authenticated.");
        emitEvent("projectsLoaded", { projects: [], count: 0, filter: { type: cleanFilter }, error: true, reason: 'auth_required' });
        emitEvent("projectAuthError", { reason: 'load_projects', error: new Error("Authentication required") });
        return []; // Return empty array as no projects can be loaded
      }

      // Build query params
      const params = new URLSearchParams();
      params.append("filter", cleanFilter);
      params.append("skip", "0");
      params.append("limit", "100");

      const endpoint = `/api/projects?${params.toString()}`.replace(/^https?:\/\/[^/]+/i, '');

      const response = await window.apiRequest(endpoint, "GET", null);

      // Standardize response format
      let projects = [];
      if (response?.data?.projects) {
        projects = response.data.projects;
      } else if (Array.isArray(response?.data)) {
        projects = response.data;
      } else if (Array.isArray(response)) {
        projects = response;
      } else if (response?.projects) {
        projects = response.projects;
      }

      if (!Array.isArray(projects)) {
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
      window.ChatUtils.handleError('Loading projects', error);
      emitEvent("projectsLoaded", {
        projects: [],
        count: 0,
        filter: { type: filter },
        error: true
      });
      return [];
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
    // Validate project ID format
    try {
      if (!projectId || typeof projectId !== 'string') {
        throw new Error('Invalid project ID');
      }
      if (!window.ChatUtils.isValidUUID(projectId)) {
        throw new Error('Malformed project ID');
      }
    } catch (err) {
      emitEvent('projectDetailsError', { projectId, error: err });
      window.ChatUtils.handleError('Validating project ID', err);
      return null;
    }

    const projectEndpoint = `/api/projects/${projectId}/`;

    try {
      // Clear current project while loading
      currentProject = null;
      emitEvent("projectDetailsLoading", { projectId });

      // Use centralized auth check
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        console.warn(`[projectManager] loadProjectDetails (${projectId}) skipped: User not authenticated.`);
        emitEvent("projectDetailsError", { projectId, error: new Error("Authentication required"), reason: 'auth_required' });
        emitEvent("projectAuthError", { reason: 'project_details', error: new Error("Authentication required") });
        currentProject = null;
        return null;
      }

      const response = await window.apiRequest(projectEndpoint, "GET");
      let projectData = null;

      // Standardize response parsing
      if (response?.data?.id) {
        projectData = response.data;
      } else if (response?.id) {
        projectData = response;
      } else if (response?.success && response?.data?.id) {
        projectData = response.data;
      }

      if (!projectData || !projectData.id) {
        const responseSnippet = JSON.stringify(response || {}).substring(0, 100);
        throw new Error(`Invalid project response format. Received: ${responseSnippet}...`);
      }

      currentProject = projectData;

      // Dispatch "projectLoaded" with a clone
      emitEvent("projectLoaded", JSON.parse(JSON.stringify(currentProject)));

      // If archived, skip loading extra data
      if (currentProject.archived) {
        emitEvent("projectArchivedNotice", { id: currentProject.id });
        return JSON.parse(JSON.stringify(currentProject));
      }

      // Load stats, files, conversations, artifacts in parallel
      const results = await Promise.allSettled([
        loadProjectStats(projectId),
        loadProjectFiles(projectId),
        loadProjectConversations(projectId),
        loadProjectArtifacts(projectId)
      ]);

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const loadType = ['stats', 'files', 'conversations', 'artifacts'][index];
          console.warn(`[projectManager] Failed to load project ${loadType}:`, result.reason);
          window.ChatUtils.handleError(`Loading project ${loadType}`, result.reason);
          emitEvent(`project${loadType.charAt(0).toUpperCase() + loadType.slice(1)}Error`, {
            projectId,
            error: result.reason
          });
        }
      });

      return JSON.parse(JSON.stringify(currentProject));
    } catch (err) {
      console.error("[projectManager] Error loading project details:", err);
      window.ChatUtils.handleError('Loading project details', err);
      emitEvent("projectDetailsError", { projectId, error: err });
      currentProject = null;
      return null;
    }
  }

  /**
   * Load project stats (token usage, file counts, etc.).
   * Dispatches "projectStatsLoaded" with stats.
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  async function loadProjectStats(projectId) {
    try {
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        throw new Error('Not authenticated - please login first');
      }

      const response = await window.apiRequest(`/api/projects/${projectId}/stats`, "GET");
      const stats = response.data || {};

      // Ensure basic fields
      if (typeof stats.file_count === "undefined") stats.file_count = 0;
      if (typeof stats.conversation_count === "undefined") stats.conversation_count = 0;
      if (typeof stats.artifact_count === "undefined") stats.artifact_count = 0;

      emitEvent("projectStatsLoaded", { projectId, ...stats });
      return stats;
    } catch (err) {
      console.error("[projectManager] Error loading project stats:", err);
      window.ChatUtils.handleError('Loading project stats', err);
      emitEvent("projectStatsLoaded", {
        projectId,
        token_usage: 0,
        max_tokens: 0,
        file_count: 0,
        conversation_count: 0,
        artifact_count: 0
      });
      emitEvent("projectStatsError", { projectId, error: err });
      return {
        token_usage: 0,
        max_tokens: 0,
        file_count: 0,
        conversation_count: 0,
        artifact_count: 0
      };
    }
  }

  /**
   * Load files for a project.
   * Dispatches "projectFilesLoaded" with { files }.
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function loadProjectFiles(projectId) {
    try {
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        throw new Error('Not authenticated - please login first');
      }
      const response = await window.apiRequest(`/api/projects/${projectId}/files`, "GET");
      const files = response.data?.files || response.data || [];
      emitEvent("projectFilesLoaded", { projectId, files });
      return files;
    } catch (err) {
      console.error("[projectManager] Error loading project files:", err);
      window.ChatUtils.handleError('Loading project files', err);
      emitEvent("projectFilesLoaded", { projectId, files: [] });
      emitEvent("projectFilesError", { projectId, error: err });
      return [];
    }
  }

  /**
   * Load conversations for a project.
   * Dispatches "projectConversationsLoaded" with conversations[].
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function loadProjectConversations(projectId) {
    try {
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        throw new Error('Not authenticated - please login first');
      }
      const endpoint = `/api/projects/${projectId}/conversations`;
      const response = await window.apiRequest(endpoint, "GET");
      let conversations = [];

      if (response.data?.conversations) {
        conversations = response.data.conversations;
      } else if (response.conversations) {
        conversations = response.conversations;
      } else if (Array.isArray(response)) {
        conversations = response;
      } else if (Array.isArray(response.data)) {
        conversations = response.data;
      }

      emitEvent("projectConversationsLoaded", { projectId, conversations });
      return conversations;
    } catch (err) {
      console.error("[projectManager] Error loading conversations:", err);
      window.ChatUtils.handleError('Loading project conversations', err);
      emitEvent("projectConversationsLoaded", { projectId, conversations: [] });
      emitEvent("projectConversationsError", { projectId, error: err });
      throw err;
    }
  }

  /**
   * Load artifacts for a project.
   * Dispatches "projectArtifactsLoaded" with { artifacts }.
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function loadProjectArtifacts(projectId) {
    try {
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        throw new Error('Not authenticated - please login first');
      }
      const response = await window.apiRequest(`/api/projects/${projectId}/artifacts`, "GET");
      const artifacts = response.data?.artifacts || response.data || [];
      emitEvent("projectArtifactsLoaded", { projectId, artifacts });
      return artifacts;
    } catch (err) {
      console.error("[projectManager] Error loading artifacts:", err);
      window.ChatUtils.handleError('Loading project artifacts', err);
      emitEvent("projectArtifactsLoaded", { projectId, artifacts: [] });
      emitEvent("projectArtifactsError", { projectId, error: err });

      if (err?.response?.status === 404) {
        emitEvent('projectNotFound', { projectId });
        if (currentProject?.id === projectId) {
          currentProject = null;
        }
      } else {
        emitEvent('projectDetailsError', { projectId, error: err });
      }
      throw err;
    }
  }

  /**
   * Create or update a project.
   * @param {string} projectId
   * @param {Object} formData
   * @returns {Promise<Object>}
   */
  async function createOrUpdateProject(projectId, formData) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    const method = projectId ? "PATCH" : "POST";
    const endpoint = projectId
      ? `/api/projects/${projectId}`
      : "/api/projects";
    return window.apiRequest(endpoint, method, formData);
  }

  /**
   * Delete a project by ID.
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  async function deleteProject(projectId) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    return window.apiRequest(`/api/projects/${projectId}`, "DELETE");
  }

  /**
   * Pin/unpin a project (toggle).
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  async function togglePinProject(projectId) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    return window.apiRequest(`/api/projects/${projectId}/pin`, "POST");
  }

  /**
   * Archive/unarchive a project (toggle).
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  async function toggleArchiveProject(projectId) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    return window.apiRequest(`/api/projects/${projectId}/archive`, "PATCH");
  }

  /**
   * Save custom instructions field on the project.
   * @param {string} projectId
   * @param {string} instructions
   * @returns {Promise<Object>}
   */
  async function saveCustomInstructions(projectId, instructions) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    return window.apiRequest(`/api/projects/${projectId}`, "PATCH", {
      custom_instructions: instructions
    });
  }

  /* ===========================
     KNOWLEDGE BASE OPERATIONS
     =========================== */

  /**
   * Check if the project has an active knowledge base
   * @param {string} projectId
   * @returns {boolean} True if KB is active
   */
  function isKnowledgeBaseReady(projectId) {
    if (!currentProject || currentProject.id !== projectId) {
      return false;
    }
    return isKnowledgeBaseActive(currentProject);
  }

  function isKnowledgeBaseActive(project) {
    if (!project) return false;
    const hasKnowledgeBase = !!project.knowledge_base_id;
    const isActive = project.knowledge_base?.is_active !== false;
    return hasKnowledgeBase && isActive;
  }

  /**
   * Validate and prepare files for upload
   * @param {string} projectId
   * @param {FileList} files
   * @returns {Promise<{ validatedFiles: File[], invalidFiles: Array }>}
   */
  function prepareFileUploads(projectId, files) {
    const allowedExtensions = [
      ".txt", ".md", ".csv", ".json", ".pdf", ".doc",
      ".docx", ".py", ".js", ".html", ".css"
    ];
    const maxSizeMB = 30;

    if (!isKnowledgeBaseReady(projectId)) {
      return Promise.reject("Active knowledge base is required for uploads.");
    }

    const validatedFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      const ext = "." + file.name.split(".").pop().toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        invalidFiles.push({ file, reason: `Invalid type ${ext}` });
      } else if (file.size > maxSizeMB * 1024 * 1024) {
        invalidFiles.push({ file, reason: `Exceeds ${maxSizeMB}MB` });
      } else {
        validatedFiles.push(file);
      }
    }

    return Promise.resolve({ validatedFiles, invalidFiles });
  }

  /**
   * Sanitize file content by replacing dangerous patterns
   * @param {File} file
   * @returns {Promise<string>} - Sanitized file text
   */
  async function sanitizeFileContent(file) {
    const fileContent = await file.text();
    // Consolidated regex for performance
    const dangerousPatterns = /curl|<script[^>]*>.*?<\/script>|<script[^>]*>|<\/script>|eval\(.*?\)|document\.cookie|\bexec\(|\bsystem\(/gi;
    return fileContent.replace(dangerousPatterns, "[SANITIZED]");
  }

  /**
   * Parse server errors to user-friendly messages
   * @param {Error} err
   * @returns {Error}
   */
  function parseFileUploadError(err) {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail || err.message;

    if (status === 422) {
      return new Error("File validation failed (unsupported/corrupted format)");
    } else if (status === 413) {
      return new Error("File too large (exceeds maximum allowed size)");
    } else if (status === 400) {
      if (detail.includes("token limit")) {
        const project = getCurrentProject();
        const maxTokens = project?.max_tokens || 200000;
        return new Error(
          `File exceeds project token limit (${maxTokens.toLocaleString()} tokens). ` +
          `Options:\n1. Increase project token limit in settings\n` +
          `2. Split large files into smaller parts\n` +
          `3. Delete unused files to free up tokens`
        );
      }
      return new Error(`Bad request: ${detail}`);
    } else if (status === 404) {
      return new Error("Project knowledge base not found - please configure it first");
    } else if (status === 403) {
      return new Error("Knowledge base not active for this project");
    }
    return new Error(detail || "Upload failed");
  }

  /**
   * Upload a file to a project (single File).
   * @param {string} projectId
   * @param {File} file
   * @returns {Promise<Object>}
   */
  async function uploadFile(projectId, file) {
    if (!currentProject) {
      throw new Error("No project loaded. Please select a project first.");
    }

    // If no KB, attempt to create one automatically
    if (!currentProject.knowledge_base_id) {
      try {
        const defaultKb = {
          name: "Default Knowledge Base",
          description: "Automatically created for file uploads"
        };
        await window.apiRequest(`/api/projects/${projectId}/knowledge-base`, "POST", defaultKb);
        await loadProjectDetails(projectId);
      } catch (kbError) {
        const error = new Error("No active Knowledge Base found. Please enable or create one in project settings before uploading files.");
        error.code = "KB_REQUIRED";
        emitEvent("knowledgeBaseError", { error });
        window.ChatUtils.handleError('Creating default knowledge base', kbError);
        throw error;
      }
    }

    if (currentProject.knowledge_base?.is_active === false) {
      const error = new Error("Knowledge base is disabled");
      error.code = "KB_INACTIVE";
      emitEvent("knowledgeBaseError", { error });
      throw error;
    }

    // Sanitize
    const sanitizedContent = await sanitizeFileContent(file);
    const sanitizedBlob = new Blob([sanitizedContent], { type: file.type });
    const sanitizedFile = new File([sanitizedBlob], file.name, { type: file.type });

    const formData = new FormData();
    formData.append("file", sanitizedFile);
    formData.append("project_id", projectId);

    try {
      const endpoint = API_ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
      const response = await window.apiRequest(
        endpoint,
        "POST",
        formData
      );

      if (response?.data?.processing_status === "pending") {
        return {
          ...response,
          processing: {
            status: "pending",
            message: "File is being processed by knowledge base",
            kb_id: currentProject.knowledge_base_id
          }
        };
      }

      if (response?.data?.processing_status === "failed") {
        throw new Error(response.data.error || "Knowledge base processing failed");
      }

      return response;
    } catch (err) {
      console.error("[projectManager] File upload error:", err);
      window.ChatUtils.handleError('Uploading file', err);
      throw parseFileUploadError(err);
    }
  }

  /**
   * (Optional) Upload file with basic retry logic
   * @param {string} projectId
   * @param {File} file
   * @param {number} [retries=3]
   */
  async function uploadFileWithRetry(projectId, file, retries = 3) {
    let attempt = 0;
    while (attempt < retries) {
      try {
        return await uploadFile(projectId, file);
      } catch (err) {
        // If it's a KB error or final attempt, rethrow
        if (++attempt >= retries || err.code === "KB_REQUIRED" || err.code === "KB_INACTIVE") {
          window.ChatUtils.handleError(`Uploading file (attempt ${attempt}/${retries})`, err);
          throw err;
        }
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 500));
      }
    }
  }

  /**
   * Delete a file from a project
   * @param {string} projectId
   * @param {string} fileId
   * @returns {Promise<Object>}
   */
  async function deleteFile(projectId, fileId) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    return window.apiRequest(`/api/projects/${projectId}/files/${fileId}`, "DELETE");
  }

  /**
   * Delete a conversation from a project
   * @param {string} projectId
   * @param {string} conversationId
   * @returns {Promise<Array>} - resolves with updated stats & conversation list
   */
  async function deleteProjectConversation(projectId, conversationId) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    await window.apiRequest(`/api/projects/${projectId}/conversations/${conversationId}`, "DELETE");
    return Promise.all([
      loadProjectStats(projectId),
      loadProjectConversations(projectId)
    ]);
  }

  /**
   * Delete an artifact
   * @param {string} projectId
   * @param {string} artifactId
   * @returns {Promise<Object>}
   */
  async function deleteArtifact(projectId, artifactId) {
    const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
    if (!isAuthenticated) {
      throw new Error('Not authenticated - please login first');
    }
    return window.apiRequest(`/api/projects/${projectId}/artifacts/${artifactId}`, "DELETE");
  }

  /**
   * Create a new conversation within a project
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  async function createConversation(projectId) {
    console.debug('[ProjectManager] Creating conversation for project:', projectId);

    try {
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        throw new Error('Not authenticated - please login first');
      }

      // Validate project existence
      if (!currentProject || currentProject.id !== projectId) {
        await loadProjectDetails(projectId);
        if (!currentProject) {
          throw new Error("Project not loaded after refresh");
        }
      }

      const payload = {
        title: "New Conversation",
        model: window.MODEL_CONFIG?.modelName || "claude-3-sonnet-20240229",
        system_prompt: window.MODEL_CONFIG?.customInstructions || ""
      };

      console.debug('[ProjectManager] Conversation payload:', payload);

      const response = await window.apiRequest(
        `/api/projects/${projectId}/conversations`,
        "POST",
        payload
      );

      // Validate response structure
      if (!response?.data?.id) {
        console.error('[ProjectManager] Invalid conversation response:', response);
        throw new Error(`Server returned invalid conversation ID: ${JSON.stringify(response)}`);
      }

      console.debug('[ProjectManager] Created conversation:', response.data.id);

      // Link conversation to knowledge base if available
      if (currentProject.knowledge_base_id) {
        await linkConversationToKnowledgeBase(response.data.id);
      }

      return response.data;
    } catch (error) {
      console.error('[ProjectManager] Conversation creation failed:', {
        error: error.message,
        projectId,
        model: window.MODEL_CONFIG?.modelName,
        knowledgeBase: !!currentProject?.knowledge_base_id
      });
      window.ChatUtils.handleError('Creating conversation', error);
      throw new Error(`Failed to create conversation: ${formatProjectError(error)}`);
    }
  }

  /**
   * Link conversation to project's knowledge base
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async function linkConversationToKnowledgeBase(conversationId) {
    const kbId = currentProject?.knowledge_base_id;
    if (!kbId) return;

    try {
      console.debug(`[ProjectManager] Linking conversation ${conversationId} to KB ${kbId}`);
      await window.apiRequest(
        `/api/projects/${currentProject?.id}/knowledge-base/conversations/${conversationId}`,
        "PUT",
        { association_type: "primary" }
      );
      console.debug('[ProjectManager] Knowledge base link successful');
    } catch (linkError) {
      console.error('[ProjectManager] KB linking failed:', {
        conversationId,
        kbId,
        error: linkError.message,
        response: linkError?.response?.data
      });
      window.ChatUtils.handleError('Linking conversation to knowledge base', linkError);
      throw new Error("Created conversation but failed to connect knowledge base");
    }
  }

  /**
   * Format project-related errors for user display
   * @param {Error} error
   * @returns {string}
   */
  function formatProjectError(error) {
    const status = error?.response?.status;
    const serverMessage = error?.response?.data?.error;

    if (status === 403) {
      return "You don't have permissions to create conversations in this project";
    } else if (status === 404) {
      return "Project not found or unavailable";
    }
    return serverMessage || error.message || "Unknown project error";
  }

  /**
   * Load knowledge base details
   * @param {string} knowledgeBaseId
   * @returns {Promise<Object>}
   */
  async function loadKnowledgeBaseDetails(knowledgeBaseId) {
    try {
      const isAuthenticated = await window.ChatUtils.isAuthenticated({ forceVerify: false });
      if (!isAuthenticated) {
        throw new Error('Not authenticated - please login first');
      }
      // Use the correct endpoint that exists in the API
      const kbData = await window.apiRequest(`/api/knowledge-bases/${knowledgeBaseId}`, "GET");
      // Attach to currentProject if relevant
      if (currentProject) {
        currentProject.knowledge_base = kbData.data || kbData;
      }
      emitEvent("knowledgeBaseLoaded", { kb: kbData.data || kbData });
      return currentProject?.knowledge_base;
    } catch (err) {
      console.error("[projectManager] Failed to load knowledge base details:", err);
      window.ChatUtils.handleError('Loading knowledge base details', err);
      emitEvent("knowledgeBaseError", { error: err });
      throw err;
    }
  }

  /* ===========================
     UTILITY FUNCTIONS
     =========================== */

  /**
   * Get the currently loaded project data.
   * @returns {Object|null} - A deep clone of the current project data or null
   */
  function getCurrentProject() {
    return currentProject ? JSON.parse(JSON.stringify(currentProject)) : null;
  }

  /**
   * Checks API endpoint compatibility for a project with timeout and retries.
   * @param {string} projectId
   * @param {number} [timeout=2000]
   * @returns {Promise<"standard"|"simple"|"unknown">}
   */
  async function checkProjectApiEndpoint(projectId, timeout = 2000) {
    if (!projectId) throw new Error("Project ID required");

    // Helper to run a GET request with a race
    const apiCheck = (endpoint) =>
      Promise.race([
        window.apiRequest(endpoint, "GET"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout))
      ]);

    try {
      const stdResponse = await apiCheck(`/api/projects/${projectId}/`);
      if (stdResponse?.id === projectId) {
        return "standard";
      }
    } catch (e) {
      console.debug("[projectManager] Standard endpoint failed:", e.message);
    }

    try {
      const simpleResponse = await apiCheck(`/api/${projectId}`);
      if (simpleResponse?.id === projectId) {
        return "simple";
      }
    } catch (e) {
      console.debug("[projectManager] Simple endpoint failed:", e.message);
    }

    return "unknown";
  }

  /**
   * Initialization function for projectManager
   * @returns {Promise<void>}
   */
  async function initialize() {
    console.log("[projectManager] Initializing...");

    // Wait for auth module to be ready using centralized utility
    await window.ChatUtils.ensureAuthReady();

    // Listen for auth changes
    document.addEventListener('authStateChanged', (event) => {
      const isAuthenticated = event.detail?.authenticated;
      if (!isAuthenticated) {
        currentProject = null; // Only clear project manager state
        emitEvent("authExpired", { message: "Authentication expired" });
      }
    });

    console.log("[projectManager] Initialization complete.");
  }

  /* ===============================
     FINAL EXPORTS
     =============================== */
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

    // Project Operations
    togglePinProject,
    toggleArchiveProject,
    saveCustomInstructions,

    // KB & File Handling
    isKnowledgeBaseReady,
    isKnowledgeBaseActive,
    prepareFileUploads,
    uploadFile,
    uploadFileWithRetry,
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

  console.log('[ProjectManager] projectManager.js loaded and aligned with chat system');
})();
