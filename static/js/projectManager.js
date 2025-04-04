 /**
 * projectManager.js
 * ------------------
 * Handles all data operations (API calls) for projects, files, conversations, artifacts.
 * Dispatches custom DOM events to inform the UI about loaded or updated data.
 * Contains NO direct DOM manipulation or direct form/modals references.
 */

(function () {
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
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  /* ===========================
     DATA OPERATIONS - PROJECTS
     =========================== */

  /**
   * Load a list of projects from the server (optionally filtered).
   * Dispatches "projectsLoaded" with { data: { projects, count, filter, ... } }.
   * @param {string} [filter] - Optional filter ("all", "pinned", "archived", "active")
   * @returns {Promise<Array>} Array of projects
   */
  async function loadProjects(filter = null) {
    const validFilters = ["all", "pinned", "archived", "active"];
    const cleanFilter = validFilters.includes(filter) ? filter : "all";

    try {
      const authState = await checkAuthState();
      if (!authState) {
        // Not authenticated, dispatch an empty list
        emitEvent("projectsLoaded", {
          data: {
            projects: [],
            count: 0,
            filter: { type: cleanFilter },
            error: false
          }
        });
        return [];
      }

      // Build query params for filter
      const params = new URLSearchParams();
      params.append("filter", cleanFilter);
      params.append("skip", "0");
      params.append("limit", "100");

      const endpoint = `/api/projects?${params.toString()}`.replace(/^https?:\/\/[^/]+/i, '');
      const response = await window.apiRequest(endpoint, "GET");

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
        data: {
          projects,
          count: projects.length,
          filter: { type: cleanFilter }
        }
      });

      return projects;
    } catch (error) {
      console.error("[projectManager] Error loading projects:", error);
      emitEvent("projectsError", { error });

      // Dispatch empty projects to clear UI
      emitEvent("projectsLoaded", {
        data: {
          projects: [],
          count: 0,
          filter: { type: filter },
          error: true
        }
      });

      return [];
    }
  }

  /**
   * Load details for a single project.
   * Dispatches "projectLoaded" with { detail: project }.
   * Also loads stats, files, conversations, artifacts if not archived.
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} Project data
   */
  async function loadProjectDetails(projectId) {
    const projectEndpoint = `/api/projects/${projectId}/`;
    
    try {
      // Check auth state first
      const authState = await checkAuthState();
      if (!authState) {
        emitEvent("projectDetailsError", {
          error: new Error("Not authenticated - please login first")
        });
        return null;
      }

      const response = await window.apiRequest(projectEndpoint, "GET");
      let projectData = null;

      if (response?.data) {
        projectData = response.data;
      } else if (response?.success && response?.data) {
        projectData = response.data;
      } else if (response?.id) {
        projectData = response;
      }

      if (!projectData || !projectData.id) {
        throw new Error("Invalid project response format");
      }

      currentProject = projectData;
      localStorage.setItem("selectedProjectId", currentProject.id);

      // Clean any 'null' string for knowledge_base_id
      if (currentProject.knowledge_base_id === "null") {
        currentProject.knowledge_base_id = null;
      }

      // If we have a KB ID but no attached knowledge_base object, load it
      if (currentProject.knowledge_base_id && !currentProject.knowledge_base) {
        await loadKnowledgeBaseDetails(currentProject.knowledge_base_id);
      }

      // Dispatch "projectLoaded"
      emitEvent("projectLoaded", currentProject);

      // If archived, skip loading extra data
      if (currentProject.archived) {
        emitEvent("projectArchivedNotice", { id: currentProject.id });
        return currentProject;
      }

      // Load stats, files, conversations, artifacts in parallel
      await Promise.all([
        loadProjectStats(projectId),
        loadProjectFiles(projectId),
        loadProjectConversations(projectId),
        loadProjectArtifacts(projectId)
      ]).catch(err => {
        console.warn("[projectManager] Some project detail loads failed:", err);
      });

      return currentProject;
    } catch (err) {
      console.error("[projectManager] Error loading project details:", err);
      emitEvent("projectDetailsError", { error: err });
      throw err;
    }
  }

  /**
   * Load project stats (token usage, file counts, etc.).
   * Dispatches "projectStatsLoaded" with { detail: stats }.
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  async function loadProjectStats(projectId) {
    const authState = await checkAuthState();
    if (!authState) {
      emitEvent("projectStatsError", {
        error: new Error("Not authenticated - please login first")
      });
      return {
        token_usage: 0,
        max_tokens: 0,
        file_count: 0,
        conversation_count: 0,
        artifact_count: 0
      };
    }

    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/stats`, "GET");
      const stats = response.data || {};

      // Ensure basic fields exist
      if (typeof stats.file_count === "undefined") stats.file_count = 0;
      if (typeof stats.conversation_count === "undefined") stats.conversation_count = 0;
      if (typeof stats.artifact_count === "undefined") stats.artifact_count = 0;

      emitEvent("projectStatsLoaded", stats);
      return stats;
    } catch (err) {
      console.error("[projectManager] Error loading project stats:", err);
      // Dispatch fallback stats
      const emptyStats = {
        token_usage: 0,
        max_tokens: 0,
        file_count: 0,
        conversation_count: 0,
        artifact_count: 0
      };
      emitEvent("projectStatsLoaded", emptyStats);
      return emptyStats;
    }
  }

  /**
   * Load files for a project.
   * Dispatches "projectFilesLoaded" with { detail: { files } }.
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function loadProjectFiles(projectId) {
    const authState = await checkAuthState();
    if (!authState) {
      emitEvent("projectFilesError", {
        error: new Error("Not authenticated - please login first")
      });
      return [];
    }

    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/files`, "GET");
      const files = response.data?.files || response.data || [];
      emitEvent("projectFilesLoaded", { files });
      return files;
    } catch (err) {
      console.error("[projectManager] Error loading project files:", err);
      emitEvent("projectFilesLoaded", { files: [] });
      emitEvent("projectFilesError", { error: err });
      throw err;
    }
  }

  /**
   * Load conversations for a project.
   * Dispatches "projectConversationsLoaded" with { detail: conversations[] }.
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function loadProjectConversations(projectId) {
    const authState = await checkAuthState();
    if (!authState) {
      emitEvent("projectConversationsError", {
        error: new Error("Not authenticated - please login first")
      });
      return [];
    }

    const endpoint = `/api/chat/projects/${projectId}/conversations`;
    try {
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

      emitEvent("projectConversationsLoaded", conversations);
      return conversations;
    } catch (err) {
      console.error("[projectManager] Error loading conversations:", err);
      emitEvent("projectConversationsLoaded", []);
      emitEvent("projectConversationsError", { error: err });
      throw err;
    }
  }

  /**
   * Load artifacts for a project.
   * Dispatches "projectArtifactsLoaded" with { detail: { artifacts } }.
   * @param {string} projectId
   * @returns {Promise<Array>}
   */
  async function loadProjectArtifacts(projectId) {
    const authState = await checkAuthState();
    if (!authState) {
      emitEvent("projectArtifactsError", {
        error: new Error("Not authenticated - please login first")
      });
      return [];
    }

    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/artifacts`, "GET");
      const artifacts = response.data?.artifacts || response.data || [];
      emitEvent("projectArtifactsLoaded", { artifacts });
      return artifacts;
    } catch (err) {
      console.error("[projectManager] Error loading artifacts:", err);
      emitEvent("projectArtifactsLoaded", { artifacts: [] });
      emitEvent("projectArtifactsError", { error: err });
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
    const authState = await checkAuthState();
    if (!authState) {
      throw new Error("Not authenticated - please login first");
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
    const authState = await checkAuthState();
    if (!authState) {
      throw new Error("Not authenticated - please login first");
    }
    return window.apiRequest(`/api/projects/${projectId}`, "DELETE");
  }

  /**
   * Pin/unpin a project (toggle).
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  function togglePinProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}/pin`, "POST");
  }

  /**
   * Archive/unarchive a project (toggle).
   * @param {string} projectId
   * @returns {Promise<Object>}
   */
  function toggleArchiveProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}/archive`, "PATCH");
  }

  /**
   * Save custom instructions field on the project.
   * @param {string} projectId
   * @param {string} instructions
   * @returns {Promise<Object>}
   */
  function saveCustomInstructions(projectId, instructions) {
    return window.apiRequest(`/api/projects/${projectId}`, "PATCH", {
      custom_instructions: instructions
    });
  }

  /* ===========================
   * KNOWLEDGE BASE OPERATIONS
   * =========================== */

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
   * Upload a file to a project (single File).
   * @param {string} projectId
   * @param {File} file
   * @returns {Promise<Object>}
   */
  async function uploadFile(projectId, file) {
    if (!currentProject) {
      return Promise.reject(new Error("No project loaded. Please select a project first."));
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
        const error = new Error("Knowledge base required before uploading files");
        error.code = "KB_REQUIRED";
        emitEvent("knowledgeBaseError", { error });
        throw error;
      }
    }

    if (currentProject.knowledge_base?.is_active === false) {
      const error = new Error("Knowledge base is disabled");
      error.code = "KB_INACTIVE";
      emitEvent("knowledgeBaseError", { error });
      throw error;
    }

    // Sanitize file content
    const sanitizedContent = await sanitizeFileContent(file);
    const sanitizedBlob = new Blob([sanitizedContent], { type: file.type });
    const sanitizedFile = new File([sanitizedBlob], file.name, { type: file.type });

    const formData = new FormData();
    formData.append("file", sanitizedFile);
    formData.append("project_id", projectId);

    try {
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/files`,
        "POST",
        formData
      );

      // Check processing status
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
      throw parseFileUploadError(err);
    }
  }

  // Helper function to sanitize file content
  async function sanitizeFileContent(file) {
    const dangerousPatterns = [
      "curl",
      "<script[^>]*>.*?</script>", // Script tags with content
      "<script[^>]*>", // Opening script tags
      "</script>", // Closing script tags
      "eval\\(.*?\\)", // eval() calls
      "document\\.cookie", // Cookie access
      "\\bexec\\(", // exec() calls
      "\\bsystem\\(", // system() calls
    ];
    const fileContent = await file.text();

    let sanitizedContent = fileContent;
    dangerousPatterns.forEach(pattern => {
      const regex = new RegExp(pattern, "gi");
      sanitizedContent = sanitizedContent.replace(regex, "[SANITIZED]");
    });
    return sanitizedContent;
  }

  // Convert server errors to more user-friendly messages
  function parseFileUploadError(err) {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail || err.message;
    
    if (status === 422) {
      return new Error("File validation failed (unsupported/corrupted format)");
    } else if (status === 413) {
      return new Error("File too large (exceeds maximum allowed size)");
    } else if (status === 400) {
      if (detail.includes("token limit")) {
        const project = window.projectManager?.currentProject;
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
   * Delete a file from a project
   * @param {string} projectId
   * @param {string} fileId
   * @returns {Promise<Object>}
   */
  function deleteFile(projectId, fileId) {
    return window.apiRequest(`/api/projects/${projectId}/files/${fileId}`, "DELETE");
  }

  /**
   * Delete a conversation from a project
   * @param {string} projectId
   * @param {string} conversationId
   * @returns {Promise<Array>} - resolves with updated stats & conversation list
   */
  async function deleteProjectConversation(projectId, conversationId) {
    await window.apiRequest(`/api/chat/projects/${projectId}/conversations/${conversationId}`, "DELETE");
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
  function deleteArtifact(projectId, artifactId) {
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
      // Check auth state first
      const authState = await checkAuthState();
      if (!authState) {
        emitEvent("conversationError", {
          error: new Error("Not authenticated - please login first")
        });
        throw new Error("Not authenticated - please login first");
      }

      // Validate project existence
      if (!this.currentProject || this.currentProject.id !== projectId) {
        await this.loadProjectDetails(projectId); 
        if (!this.currentProject) {
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
        `/api/chat/projects/${projectId}/conversations`,
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
      if (this.currentProject.knowledge_base_id) {
        await this.linkConversationToKnowledgeBase(response.data.id);
      }

      return response.data;
    } catch (error) {
      console.error('[ProjectManager] Conversation creation failed:', {
        error: error.message,
        projectId,
        model: window.MODEL_CONFIG?.modelName,
        knowledgeBase: !!this.currentProject?.knowledge_base_id
      });
      
      throw new Error(`Failed to create conversation: ${formatProjectError(error)}`);
    }
  }

  /**
   * Link conversation to project's knowledge base
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async function linkConversationToKnowledgeBase(conversationId) {
    const kbId = this.currentProject.knowledge_base_id;
    if (!kbId) return;

    try {
      console.debug(`[ProjectManager] Linking conversation ${conversationId} to KB ${kbId}`);
      
      await window.apiRequest(
        `/api/knowledge-bases/${kbId}/conversations/${conversationId}`,
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
      
      throw new Error("Created conversation but failed to connect knowledge base");
    }
  }

  /**
   * Format project-related errors for user display
   * @param {Error} error
   * @returns {string}
   */
  function formatProjectError(error) {
    // Enhanced error mapping
    const status = error?.response?.status;
    const serverMessage = error?.response?.data?.error;
    
    return status === 403 ? "You don't have permissions to create conversations in this project" :
           status === 404 ? "Project not found or unavailable" :
           serverMessage || error.message || "Unknown project error";
  }

  /**
   * Load knowledge base details
   * Dispatches event if needed. The UI can handle actual rendering.
   * @param {string} knowledgeBaseId
   * @returns {Promise<Object>}
   */
  async function loadKnowledgeBaseDetails(knowledgeBaseId) {
    try {
      const kbData = await window.apiRequest(`/api/knowledge-bases/${knowledgeBaseId}`, "GET");
      // Attach to currentProject
      if (currentProject) {
        currentProject.knowledge_base = kbData.data || kbData;
      }
      emitEvent("knowledgeBaseLoaded", { kb: kbData.data || kbData });
      return currentProject?.knowledge_base;
    } catch (err) {
      console.error("[projectManager] Failed to load knowledge base details:", err);
      emitEvent("knowledgeBaseError", { error: err });
      throw err;
    }
  }

  /* ===========================
     UTILITY FUNCTIONS
     =========================== */

  /**
   * Get the current project object
   * @returns {Object|null}
   */
  function getCurrentProject() {
    return currentProject;
  }

  /**
   * Check authentication state
   * @returns {Promise<boolean>} Whether user is authenticated
   */
  async function checkAuthState() {
    let authState = false;
    try {
      const authValid = await window.ChatUtils?.isAuthenticated?.();
      if (!authValid) {
        emitEvent("authCheckFailed", {});
        return false;
      }

      if (window.TokenManager?.accessToken || sessionStorage.getItem("auth_state")) {
        authState = await window.auth.verify().catch(e => {
          console.warn("[projectManager] Auth verification failed:", e);
          return false;
        });
      }
    } catch (e) {
      console.error("[projectManager] Auth check error:", e);
    }
    return authState;
  }

  /**
   * Checks API endpoint compatibility for a project with timeout and retries.
   * @param {string} projectId
   * @param {number} [timeout=2000]
   * @returns {Promise<"standard"|"simple"|"unknown">}
   */
  async function checkProjectApiEndpoint(projectId, timeout = 2000) {
    if (!projectId) throw new Error("Project ID required");

    try {
      const stdResponse = await Promise.race([
        window.apiRequest(`/api/projects/${projectId}/`, "GET"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout))
      ]);
      if (stdResponse?.id === projectId) {
        return "standard";
      }
    } catch (e) {
      console.debug("[projectManager] Standard endpoint check failed:", e.message);
    }

    try {
      const simpleResponse = await Promise.race([
        window.apiRequest(`/api/${projectId}`, "GET"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout))
      ]);
      if (simpleResponse?.id === projectId) {
        return "simple";
      }
    } catch (e) {
      console.debug("[projectManager] Simple endpoint check failed:", e.message);
    }

    return "unknown";
  }

  // ----------------
  // PUBLIC API
  // ----------------
  window.projectManager = {
    currentProject: getCurrentProject,
    // Loads
    loadProjects,
    loadProjectDetails,
    loadProjectStats,
    loadProjectFiles,
    loadProjectConversations,
    loadProjectArtifacts,
    // Project CRUD
    createOrUpdateProject,
    deleteProject,
    togglePinProject,
    toggleArchiveProject,
    saveCustomInstructions,
    // File/Artifact CRUD
    prepareFileUploads,
    uploadFile,
    deleteFile,
    deleteArtifact,
    // Conversations
    createConversation,
    deleteProjectConversation,
    linkConversationToKnowledgeBase,
    // Knowledge Base
    isKnowledgeBaseReady,
    loadKnowledgeBaseDetails,
    // Error formatting
    formatProjectError,
    // Error formatting
    formatProjectError,
    // API utils
    checkProjectApiEndpoint,
    // Event utility
    emitEvent
  };
})();
