/**
 * projectManager.js
 * ------------------
 * Handles all data operations (API calls) for projects, files, conversations, artifacts.
 * Dispatches custom DOM events to inform the UI about loaded or updated data.
 * Contains NO direct DOM manipulation, NO direct form or modal references.
 */

(function() {
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
   * Dispatches "projectsLoaded" with { detail: projectsArray }.
   * @param {string} filter - Optional filter ("all", "pinned", "archived")
   * @returns {Promise<Array>} Array of projects
   */
  async function loadProjects(filter = null) {
    // Validate filter parameter
    const validFilters = ["all", "pinned", "archived", "active"];
    const cleanFilter = validFilters.includes(filter) ? filter : "all";
    
    console.log("[ProjectManager] Loading projects with filter:", cleanFilter);
    
    try {
      // Check authentication state
      const authState = await checkAuthState();
      if (!authState) {
        console.warn("[ProjectManager] Not authenticated, dispatching empty projects list");
        emitEvent("projectsLoaded", {
          projects: [],
          filter: cleanFilter,
          count: 0,
          originalCount: 0,
          filterApplied: cleanFilter
        });
        return [];
      }

      console.log("[ProjectManager] Authentication confirmed, proceeding with project load");
      
      // Build query parameters for filtering
      const params = new URLSearchParams();
      if (cleanFilter) params.append('filter', cleanFilter);
      params.append('skip', '0');
      params.append('limit', '100');

      const endpoint = `/api/projects?${params.toString()}`.replace(/^https?:\/\/[^/]+/i, '');
      console.log("[ProjectManager] Making filtered API request:", endpoint);
      
      const response = await window.apiRequest(endpoint, "GET");
      console.log("[ProjectManager] Raw API response:", response);
      
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
        console.error("[ProjectManager] Invalid projects data format:", projects);
        projects = [];
      }

      console.log(`[ProjectManager] Found ${projects.length} projects`);
      
      // Dispatch event with standardized structure
      emitEvent("projectsLoaded", {
        data: {
          projects: projects,
          count: projects.length,
          filter: {
            type: filter,
            applied: {
              archived: filter === 'archived',
              pinned: filter === 'pinned'
            }
          }
        }
      });
      
      return projects;
    } catch (error) {
      console.error("[ProjectManager] Error loading projects:", error);
      const errorMsg = error?.response?.data?.message || 
                      error?.message || 
                      "Failed to load projects";
      
      emitEvent("projectsError", { error });
      
      // Dispatch empty projects to clear UI
      console.error("Failed to load projects - clearing UI");
      emitEvent("projectsLoaded", {
        data: {
          projects: [],
          filter,
          count: 0,
          originalCount: 0,
          filterApplied: filter,
          error: true
        }
      });
      
      return [];
    }
  }

  /**
   * Load details for a single project.
   * Dispatches "projectLoaded" with { detail: project }.
   * If not archived, also loads stats, files, conversations, artifacts.
   * @param {string} projectId - Project ID to load
   * @returns {Promise<Object>} Project data
   */
  async function loadProjectDetails(projectId) {
    // Always use the standard API endpoint format for consistency
    const projectEndpoint = `/api/projects/${projectId}/`;
    console.log(`[ProjectManager] Loading project details from ${projectEndpoint}`);
      
    try {
      const response = await window.apiRequest(projectEndpoint, "GET");
      
      // Handle different response formats
      let projectData = null;
      
      if (response?.data) {
        // Format: { data: { project details } }
        projectData = response.data;
      } else if (response?.success && response?.data) {
        // Format: { success: true, data: { project details } }
        projectData = response.data;
      } else if (response?.id) {
        // Format: { id: "uuid", name: "project name", ... }
        projectData = response;
      }
      
      if (!projectData || !projectData.id) {
        console.error("Invalid response format:", response);
        throw new Error("Invalid response format");
      }
      
      currentProject = projectData;
      console.log(`[ProjectManager] Project loaded successfully:`, currentProject);
      localStorage.setItem('selectedProjectId', currentProject.id); // Store projectId
      
      // Debug knowledge base status
      console.log('[DEBUG] Knowledge base info in project:', {
        kb_id: currentProject.knowledge_base_id,
        project_id: currentProject.id,
        has_kb: !!currentProject.knowledge_base_id
      });
      
      // Clean any 'null' string value for knowledge_base_id
      if (currentProject.knowledge_base_id === 'null') {
        console.warn('[WARN] Found knowledge_base_id="null" string, cleaning up');
        currentProject.knowledge_base_id = null;
      }
      
      // If we have a knowledge base ID but no knowledge base object, get the KB details
      if (currentProject.knowledge_base_id && !currentProject.knowledge_base) {
        await loadKnowledgeBaseDetails(currentProject.knowledge_base_id);
      }
      
      // Update knowledge base UI elements
      updateKnowledgeBaseUI(currentProject);
      
      // Dispatch project loaded event
      emitEvent("projectLoaded", currentProject);

      // If project is archived, skip loading extra data
      if (currentProject.archived) {
        console.warn("Project is archived, skipping additional loads.");
        window.showNotification?.("This project is archived", "warning");
        return currentProject;
      }

      // Load all project details in parallel
      await Promise.all([
        loadProjectStats(projectId),
        loadProjectFiles(projectId),
        loadProjectConversations(projectId),
        loadProjectArtifacts(projectId)
      ]).catch(err => {
        console.warn("Error loading some project details:", err);
      });
      
      return currentProject;
    } catch (err) {
      console.error("Error loading project details:", err);
      // Check for specific status codes
      const status = err?.response?.status;
      if (status === 422) {
        window.showNotification?.("Project details validation failed", "error");
      } else if (status === 404) {
        window.showNotification?.("Project not found", "error");
      } else {
        window.showNotification?.("Failed to load project details", "error");
      }
      throw err;
    }
  }

  /**
   * Load project stats (token usage, counts, etc.).
   * Dispatches "projectStatsLoaded" with { detail: statsObject }.
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} Project stats
   */
  async function loadProjectStats(projectId) {
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/stats`, "GET");
      
      // Ensure stats object has required counts
      const stats = response.data || {};
      if (typeof stats.file_count === 'undefined') {
        stats.file_count = 0;
      }
      if (typeof stats.conversation_count === 'undefined') {
        stats.conversation_count = 0;
      }
      if (typeof stats.artifact_count === 'undefined') {
        stats.artifact_count = 0;
      }

      emitEvent("projectStatsLoaded", stats);
      return stats;
    } catch (err) {
      console.error("Error loading project stats:", err);
      // Dispatch empty stats to prevent UI issues
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
   * Dispatches "projectFilesLoaded" with { detail: { files: [...] } }.
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>} Project files
   */
  async function loadProjectFiles(projectId) {
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/files`, "GET");
      const files = response.data?.files || response.data || [];
      
      emitEvent("projectFilesLoaded", { files });
      return files;
    } catch (err) {
      console.error("Error loading project files:", err);
      window.showNotification?.("Failed to load files", "error");
      emitEvent("projectFilesLoaded", { files: [] });
      throw err;
    }
  }

  /**
   * Load conversations for a project.
   * Dispatches "projectConversationsLoaded" with { detail: conversationArray }.
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>} Project conversations
   */
  async function loadProjectConversations(projectId) {
    console.log("Loading conversations for project:", projectId);
    const endpoint = `/api/projects/${projectId}/conversations`;
    
    try {
      const response = await window.apiRequest(endpoint, "GET");
      console.log("Response data:", response);
      
      // Handle different response formats for flexibility
      let conversations = [];
      
      // Format 1: { data: { conversations: [...] } }
      if (response.data?.conversations) {
        conversations = response.data.conversations;
      } 
      // Format 2: { conversations: [...] }
      else if (response.conversations) {
        conversations = response.conversations;
      }
      // Format 3: Array of conversations directly
      else if (Array.isArray(response)) {
        conversations = response;
      }
      // Format 4: data is array directly 
      else if (Array.isArray(response.data)) {
        conversations = response.data;
      }
      
      console.log("Processed conversations:", conversations);
      
      emitEvent("projectConversationsLoaded", conversations);
      return conversations;
    } catch (err) {
      console.error("Error loading conversations:", err);
      window.showNotification?.("Failed to load conversations", "error");
      emitEvent("projectConversationsLoaded", []);
      throw err;
    }
  }

  /**
   * Load artifacts for a project.
   * Dispatches "projectArtifactsLoaded" with { detail: { artifacts: [...] } }.
   * @param {string} projectId - Project ID
   * @returns {Promise<Array>} Project artifacts
   */
  async function loadProjectArtifacts(projectId) {
    try {
      const response = await window.apiRequest(`/api/projects/${projectId}/artifacts`, "GET");
      const artifacts = response.data?.artifacts || response.data || [];
      
      emitEvent("projectArtifactsLoaded", { artifacts });
      return artifacts;
    } catch (err) {
      console.error("Error loading artifacts:", err);
      window.showNotification?.("Failed to load artifacts", "error");
      emitEvent("projectArtifactsLoaded", { artifacts: [] });
      throw err;
    }
  }

  /**
   * Create or update a project.
   * @param {string} projectId - Project ID (null for create)
   * @param {Object} formData - Project data
   * @returns {Promise<Object>} Created/updated project
   */
  async function createOrUpdateProject(projectId, formData) {
    const method = projectId ? "PATCH" : "POST";
    const endpoint = projectId
      ? `/api/projects/${projectId}`
      : "/api/projects";
      
    return window.apiRequest(endpoint, method, formData);
  }

  /**
   * Delete a project by ID.
   * @param {string} projectId - Project ID to delete
   * @returns {Promise<Object>} API response
   */
  function deleteProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}`, "DELETE");
  }

  /**
   * Pin/unpin a project. Toggles automatically on server.
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} API response
   */
  function togglePinProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}/pin`, "POST");
  }

  /**
   * Archive/unarchive a project. Toggles automatically on server.
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} API response
   */
  function toggleArchiveProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}/archive`, "PATCH");
  }

  /**
   * Save custom instructions field on the project.
   * @param {string} projectId - Project ID
   * @param {string} instructions - Custom instructions
   * @returns {Promise<Object>} API response
   */
  function saveCustomInstructions(projectId, instructions) {
    return window.apiRequest(`/api/projects/${projectId}`, "PATCH", {
      custom_instructions: instructions
    });
  }

  /* ===========================
     FILE OPERATIONS
     =========================== */
  
  /**
   * Check if the project has an active knowledge base
   * @param {string} projectId - Project ID
   * @returns {boolean} True if KB is active
   */
  function isKnowledgeBaseReady(projectId) {
    if (!currentProject || currentProject.id !== projectId) {
      console.warn('[KB Check] Project not loaded or ID mismatch');
      return false;
    }
    
    return isKnowledgeBaseActive(currentProject);
  }
  
  /**
   * Check if knowledge base is active (centralized helper)
   * @param {Object} project - Project object
   * @returns {boolean} True if KB exists and is active
   */
  function isKnowledgeBaseActive(project) {
    if (!project) return false;
    
    const hasKnowledgeBase = !!project.knowledge_base_id;
    const isActive = project.knowledge_base?.is_active !== false; // Consider active unless explicitly false
    
    return hasKnowledgeBase && isActive;
  }
  
  /**
   * Validate and prepare files for upload
   * @param {string} projectId - Project ID
   * @param {FileList} files - Files to validate
   * @returns {Promise<Object>} Validated files result
   */
  function prepareFileUploads(projectId, files) {
    const allowedExtensions = ['.txt', '.md', '.csv', '.json', '.pdf', '.doc', '.docx', '.py', '.js', '.html', '.css'];
    const maxSizeMB = 30;
    
    if (!isKnowledgeBaseReady(projectId)) {
      return Promise.reject("Active knowledge base is required for uploads.");
    }
    
    const validatedFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
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
   * Upload a file to a project. Accepts a single File object.
   * @param {string} projectId - Project ID
   * @param {File} file - File to upload
   * @returns {Promise<Object>} Upload response
   */
  async function uploadFile(projectId, file) {
    if (!currentProject) {
      return Promise.reject(new Error("No project loaded. Please select a project first."));
    }
  
    if (!currentProject.knowledge_base_id) {
      try {
        const defaultKb = {
          name: 'Default Knowledge Base',
          description: 'Automatically created for file uploads'
        };
  
        await window.apiRequest(
          `/api/projects/${projectId}/knowledge-base`,
          "POST",
          defaultKb
        );
  
        await loadProjectDetails(projectId);
        window.showNotification?.("Created knowledge base for file upload", "success");
      } catch (kbError) {
        const error = new Error("Knowledge base required before uploading files");
        error.code = "KB_REQUIRED";
        error.action = {
          label: "Setup KB",
          handler: () => window.modalManager?.show("knowledge")
        };
        throw error;
      }
    }
  
    const kbIsActive = currentProject.knowledge_base?.is_active;
    if (kbIsActive === false) {
      const error = new Error("Knowledge base is disabled");
      error.code = "KB_INACTIVE";
      error.action = {
        label: "Activate KB",
        handler: () => window.modalManager?.show("knowledge")
      };
      throw error;
    }
  
    // Sanitize file content before uploading
    const sanitizedContent = await sanitizeFileContent(file);
  
    // Create a new Blob from sanitized content
    const sanitizedBlob = new Blob([sanitizedContent], { type: file.type });
    const sanitizedFile = new File([sanitizedBlob], file.name, { type: file.type });
  
    const formData = new FormData();
    formData.append("file", sanitizedFile);
    formData.append('project_id', projectId);
  
    try {
      const response = await window.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/files`,
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
      console.error("File upload error:", err);
      const status = err?.response?.status;
      if (status === 422) {
        throw new Error("File validation failed: The file format may be unsupported or the file is corrupted");
      } else if (status === 413) {
        throw new Error("File too large: The file exceeds the maximum allowed size");
      } else if (status === 400) {
        const detail = err?.response?.data?.detail || "Invalid file";
        throw new Error(`Bad request: ${detail}`);
      } else if (status === 404) {
        throw new Error("Project knowledge base not found - please configure it first");
      } else if (status === 403) {
        throw new Error("Knowledge base not active for this project");
      } else {
        throw new Error(err?.response?.data?.detail || err.message || "Upload failed");
      }
    }
  }
  
  // Helper function to sanitize file content
  async function sanitizeFileContent(file) {
    const dangerousPatterns = ["curl"]; // Add more patterns as needed
    const fileContent = await file.text();
  
    let sanitizedContent = fileContent;
    dangerousPatterns.forEach(pattern => {
      const regex = new RegExp(pattern, 'gi');
      sanitizedContent = sanitizedContent.replace(regex, '[REMOVED]');
    });
  
    return sanitizedContent;
  }

  /**
   * Delete a file from a project.
   * @param {string} projectId - Project ID
   * @param {string} fileId - File ID
   * @returns {Promise<Object>} API response
   */
  function deleteFile(projectId, fileId) {
    return window.apiRequest(`/api/projects/${projectId}/files/${fileId}`, "DELETE");
  }

  /**
   * Delete a conversation from a project.
   * @param {string} projectId - Project ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} API response
   */
  async function deleteProjectConversation(projectId, conversationId) {
    await window.apiRequest(
      `/api/projects/${projectId}/conversations/${conversationId}`,
      "DELETE"
    );
    
    // Refresh both project stats and conversations list
    return Promise.all([
      loadProjectStats(projectId),
      loadProjectConversations(projectId)
    ]);
  }

  /**
   * Delete an artifact from a project.
   * @param {string} projectId - Project ID
   * @param {string} artifactId - Artifact ID
   * @returns {Promise<Object>} API response
   */
  function deleteArtifact(projectId, artifactId) {
    return window.apiRequest(`/api/projects/${projectId}/artifacts/${artifactId}`, "DELETE");
  }

  /**
   * Create a new conversation within a project.
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} Conversation data
   */
  async function createConversation(projectId) {
    const payload = { title: "New Conversation" };

    // Always use project-specific endpoint for project conversations
    console.log("Creating project-associated conversation for project:", projectId);
    try {
      const response = await window.apiRequest(
        `/api/projects/${projectId}/conversations`, 
        "POST", 
        {
          ...payload,
          project_id: projectId  // Explicitly include project_id in payload
        }
      );
      
      console.log("Create conversation successful:", response);
      if (response?.data?.id) {
        return response.data;
      }
      throw new Error("Invalid conversation ID in response");
    } catch (fallbackErr) {
      console.error("Error creating conversation:", fallbackErr);
      window.showNotification?.("Failed to create conversation", "error");
      throw fallbackErr; // Re-throw to ensure caller can handle the error
    }
  }

  /* ===========================
     KNOWLEDGE BASE OPERATIONS
     =========================== */
  
  /**
   * Load knowledge base details
   * @param {string} knowledgeBaseId - Knowledge base ID
   * @returns {Promise<Object>} Knowledge base data
   */
  async function loadKnowledgeBaseDetails(knowledgeBaseId) {
    try {
      console.log('[DEBUG] Fetching knowledge base details for:', knowledgeBaseId);
      
      const kbData = await window.apiRequest(`/api/knowledge-bases/${knowledgeBaseId}`, "GET");
      console.log('[DEBUG] Loaded knowledge base details:', kbData);
      
      // Add knowledge base data to project
      currentProject.knowledge_base = kbData.data || kbData;
      
      // Update UI with the loaded knowledge base
      updateKnowledgeBaseUI(currentProject);
      
      return currentProject.knowledge_base;
    } catch (err) {
      console.error('[ERROR] Failed to load knowledge base details:', err);
      throw err;
    }
  }
  
  /**
   * Updates the knowledge base UI elements based on project KB status
   * @param {Object} project - The current project object
   */
  function updateKnowledgeBaseUI(project) {
    if (!project) return;
    
    console.log('[ProjectManager] Updating knowledge base UI elements');
    
    // Update KB status indicators
    const hasKnowledgeBase = !!project.knowledge_base_id;
    const isActive = project.knowledge_base?.is_active !== false; // Consider active unless explicitly false
    
    console.log('[ProjectManager] Knowledge base status:', {
      has_kb: hasKnowledgeBase,
      is_active: isActive,
      kb_id: project.knowledge_base_id
    });
    
    // Update the status indicator
    const kbStatus = document.getElementById('kbStatusIndicator');
    if (kbStatus) {
      if (!hasKnowledgeBase) {
        kbStatus.textContent = "✗ Knowledge Base Required";
        kbStatus.className = "text-red-600 text-sm";
      } else if (!isActive) {
        kbStatus.textContent = "⚠ Knowledge Base Inactive";
        kbStatus.className = "text-yellow-600 text-sm";
      } else {
        kbStatus.textContent = "✓ Knowledge Base Ready";
        kbStatus.className = "text-green-600 text-sm";
      }
    }
    
    // Show/hide active/inactive sections if they exist
    const kbActiveSection = document.getElementById('knowledgeBaseActive');
    const kbInactiveSection = document.getElementById('knowledgeBaseInactive');
    
    if (kbActiveSection) {
      kbActiveSection.classList.toggle('hidden', !hasKnowledgeBase);
    }
    
    if (kbInactiveSection) {
      kbInactiveSection.classList.toggle('hidden', hasKnowledgeBase);
    }
    
    // Update KB settings button if exists
    const setupKbButton = document.getElementById('setupKnowledgeBaseBtn');
    if (setupKbButton) {
      // Keep button visible but update text if needed
      if (!hasKnowledgeBase) {
        setupKbButton.textContent = "Set Up Knowledge Base";
        setupKbButton.classList.add('animate-pulse');
      } else if (!isActive) {
        setupKbButton.textContent = "Activate Knowledge Base";
        setupKbButton.classList.add('animate-pulse');
      } else {
        setupKbButton.textContent = "Configure Knowledge Base";
        setupKbButton.classList.remove('animate-pulse');
      }
    }
    
    // Update KB toggle if it exists
    const kbToggle = document.getElementById('knowledgeBaseEnabled');
    if (kbToggle && hasKnowledgeBase) {
      kbToggle.checked = isActive;
    }
    
    // Also update any file upload related elements
    const uploadButtons = document.querySelectorAll('[data-requires-kb="true"]');
    uploadButtons.forEach(button => {
      const isDisabled = !hasKnowledgeBase || !isActive;
      button.disabled = isDisabled;
      
      if (isDisabled) {
        button.classList.add('opacity-50', 'cursor-not-allowed');
        button.title = !hasKnowledgeBase
          ? "Knowledge Base required to upload files"
          : "Knowledge Base is inactive";
      } else {
        button.classList.remove('opacity-50', 'cursor-not-allowed');
        button.title = "Upload file to Knowledge Base";
      }
    });
    
    console.log(`[ProjectManager] KB UI updated: hasKnowledgeBase=${hasKnowledgeBase}, isActive=${isActive}`);
  }

  /* ===========================
     UTILITY FUNCTIONS
     =========================== */
  
  /**
   * Get the current project object
   * @returns {Object|null} The current project object or null if none loaded
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
      
      if (window.TokenManager?.accessToken || sessionStorage.getItem('auth_state')) {
        console.log("[ProjectManager] Found tokens, verifying auth state");
        authState = await window.auth.verify().catch(e => {
          console.warn("[ProjectManager] Auth verification failed:", e);
          return false;
        });
      }
    } catch (e) {
      console.error("[ProjectManager] Auth check error:", e);
    }
    
    return authState;
  }

  /**
   * Checks API endpoint compatibility for a project with timeout and retries.
   * @param {string} projectId - ID of the project to test
   * @param {number} [timeout=2000] - Request timeout in ms
   * @returns {Promise<"standard"|"simple"|"unknown">} Resolves to endpoint format
   */
  async function checkProjectApiEndpoint(projectId, timeout = 2000) {
    if (!projectId) throw new Error('Project ID required');
    
    const controllers = [];
    const signals = [];
    
    try {
      // Try standard endpoint first
      const stdCtrl = new AbortController();
      controllers.push(stdCtrl);
      signals.push(stdCtrl.signal);
      
      const stdResponse = await Promise.race([
        window.apiRequest(`/api/projects/${projectId}/`, "GET", null, { signal: stdCtrl.signal }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ]);
      
      if (stdResponse?.id === projectId) {
        console.debug("[ProjectManager] Using standard endpoint format");
        return "standard";
      }
    } catch (e) {
      console.debug("[ProjectManager] Standard endpoint check failed:", e.message);
    } 
    
    try {
      // Fallback to simple format
      const simpleCtrl = new AbortController();
      controllers.push(simpleCtrl);
      signals.push(simpleCtrl.signal);
      
      const simpleResponse = await Promise.race([
        window.apiRequest(`/api/${projectId}`, "GET", null, { signal: simpleCtrl.signal }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ]);
      
      if (simpleResponse?.id === projectId) {
        console.debug("[ProjectManager] Using simple endpoint format");
        return "simple";
      }
    } catch (e) {
      console.debug("[ProjectManager] Simple endpoint check failed:", e.message);
    }
    
    console.warn("[ProjectManager] Could not determine API endpoint format");
    return "unknown";
  }
  
  // ----------------
  // PUBLIC API
  // ----------------
  
  // Expose the manager as a global object
  window.projectManager = {
    // Data
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
    uploadFile,
    deleteFile,
    deleteArtifact,
    prepareFileUploads,
    isKnowledgeBaseReady,
    // Conversation
    createConversation,
    deleteProjectConversation,
    // Knowledge Base
    loadKnowledgeBaseDetails,
    updateKnowledgeBaseUI,
    // API utilities
    checkProjectApiEndpoint,
    // Event utilities
    emitEvent: emitEvent
  };
})();
