/**
 * projectManager.js
 * ------------------
 * Handles all data operations (API calls) for projects, files, conversations, artifacts.
 * Dispatches custom DOM events to inform the UI about loaded or updated data.
 *
 * This file should contain NO direct DOM manipulation, NO direct form or modal references.
 */

(function() {
  // Store the current project in memory for convenience.
  // The UI can read or reset this as needed.
  let currentProject = null;

  /**
   * Load a list of projects from the server (optionally filtered).
   * Dispatches "projectsLoaded" with { detail: projectsArray }.
   */
  async function loadProjects(filter = null) {
    // Validate filter parameter
    const validFilters = ["all", "pinned", "archived", "active"];
    const cleanFilter = validFilters.includes(filter) ? filter : "all";
    
    console.log("[ProjectManager] Loading projects with filter:", cleanFilter);
    console.trace("[DEBUG] Project load call stack");
    
    try {
      // Verify auth state before proceeding
      if (!TokenManager.accessToken && !sessionStorage.getItem('auth_state')) {
        console.warn("[ProjectManager] No auth tokens available, skipping project load");
        return [];
      }
      
      // Use centralized auth check with retry
      let authState;
      let retries = 3;
      
      while (retries > 0) {
        try {
          authState = await window.auth.verify();
          if (authState) break;
          
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 300));
          retries--;
        } catch (e) {
          console.warn("[ProjectManager] Auth check error, retrying...", e);
          await new Promise(resolve => setTimeout(resolve, 300));
          retries--;
        }
      }
      
      if (!authState) {
        console.warn("[ProjectManager] Not authenticated after retries, skipping project load");
        document.dispatchEvent(new CustomEvent("authError", {
          detail: { message: "Session expired - please log in again" }
        }));
        return [];
      }
// Ensure we use a relative path for the API request
const params = new URLSearchParams();
if (cleanFilter) params.append('filter', cleanFilter);
params.append('skip', '0');
params.append('limit', '100');

const endpoint = `/api/projects/`.replace(/^https?:\/\/[^/]+/i, '');
console.log("[ProjectManager] Making API request to endpoint:", endpoint, {
  headers: TokenManager.getAuthHeader()
});
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

      console.log(`[ProjectManager] Found ${projects.length} projects before filtering`);
      
      // Server is expected to handle filtering via the 'filter' query parameter.
      // No need to filter again on the client-side.
      const filteredProjects = projects;

      console.log(`[ProjectManager] Dispatching ${filteredProjects.length} projects after filtering`);
      
      // Dispatch event with projects data
      console.log('[DEBUG] Dispatching projectsLoaded with:', filteredProjects);
      const eventDetail = {
        projects: filteredProjects,
        filter,
        count: response?.count || filteredProjects.length,
        originalCount: projects.length,
        filterApplied: filter
      };
      console.log('[DEBUG] Event detail:', eventDetail);
      document.dispatchEvent(new CustomEvent("projectsLoaded", {
        detail: eventDetail
      }));
      
      return filteredProjects;
    } catch (error) {
      console.error("[ProjectManager] Error loading projects:", error);
      const errorMsg = error?.response?.data?.message || 
                      error?.message || 
                      "Failed to load projects";
      
      document.dispatchEvent(new CustomEvent("projectsError", {
        detail: { error }
      }));
      
      // Dispatch empty projects to clear UI
      console.error("Failed to load projects - clearing UI");
      document.dispatchEvent(new CustomEvent("projectsLoaded", {
        detail: {
          projects: [],
          filter,
          count: 0,
          originalCount: 0,
          filterApplied: filter,
          error: true
        }
      }));
      
      return [];
    }
  }

  /**
   * Load details for a single project.
   * Dispatches "projectLoaded" with { detail: project }.
   * If not archived, also loads stats, files, conversations, artifacts.
   */
  function loadProjectDetails(projectId) {
    // Always use the standard API endpoint format for consistency
    const projectEndpoint = `/api/projects/${projectId}/`;
    console.log(`[ProjectManager] Loading project details from ${projectEndpoint}`);
      
    window.apiRequest(projectEndpoint, "GET")
      .then((response) => {
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
        
        document.dispatchEvent(
          new CustomEvent("projectLoaded", { detail: currentProject })
        );

        // If project is archived, skip loading extra data
        if (currentProject.archived) {
          console.warn("Project is archived, skipping additional loads.");
          window.showNotification?.("This project is archived", "warning");
          return;
        }

        // Load all project details in parallel
        Promise.all([
          loadProjectStats(projectId),
          loadProjectFiles(projectId),
          loadProjectConversations(projectId),
          loadProjectArtifacts(projectId)
        ]).catch(err => {
          console.warn("Error loading some project details:", err);
        });
      })
      .catch((err) => {
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
      });
  }

  /**
   * Load project stats (token usage, counts, etc.).
   * Dispatches "projectStatsLoaded" with { detail: statsObject }.
   */
  function loadProjectStats(projectId) {
    window.apiRequest(`/api/projects/${projectId}/stats`, "GET")
      .then((response) => {
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

        document.dispatchEvent(
          new CustomEvent("projectStatsLoaded", { detail: stats })
        );
      })
      .catch((err) => {
        console.error("Error loading project stats:", err);
        // Dispatch empty stats to prevent UI issues
        document.dispatchEvent(
          new CustomEvent("projectStatsLoaded", {
            detail: {
              token_usage: 0,
              max_tokens: 0,
              file_count: 0,
              conversation_count: 0,
              artifact_count: 0
            }
          })
        );
      });
  }

  /**
   * Load files for a project.
   * Dispatches "projectFilesLoaded" with { detail: { files: [...] } }.
   */
  function loadProjectFiles(projectId) {
    window.apiRequest(`/api/projects/${projectId}/files`, "GET")
      .then((response) => {
        const files = response.data?.files || response.data || [];
        document.dispatchEvent(
          new CustomEvent("projectFilesLoaded", { detail: { files } })
        );
      })
      .catch((err) => {
        console.error("Error loading project files:", err);
        window.showNotification?.("Failed to load files", "error");
      });
  }

  /**
   * Load conversations for a project.
   * Dispatches "projectConversationsLoaded" with { detail: conversationArray }.
   */
  function loadProjectConversations(projectId) {
    console.log("Loading conversations for project:", projectId);
    const endpoint = `/api/projects/${projectId}/conversations`;
    console.log("API Endpoint:", endpoint);
    
    window.apiRequest(endpoint, "GET")
      .then((response) => {
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
        
        document.dispatchEvent(
          new CustomEvent("projectConversationsLoaded", { 
            detail: conversations 
          })
        );
      })
      .catch((err) => {
        console.error("Error loading conversations:", err);
        window.showNotification?.("Failed to load conversations", "error");
      });
  }

  /**
   * Load artifacts for a project.
   * Dispatches "projectArtifactsLoaded" with { detail: { artifacts: [...] } }.
   */
  function loadProjectArtifacts(projectId) {
    window.apiRequest(`/api/projects/${projectId}/artifacts`, "GET")
      .then((response) => {
        const artifacts = response.data?.artifacts || response.data || [];
        document.dispatchEvent(
          new CustomEvent("projectArtifactsLoaded", { detail: { artifacts } })
        );
      })
      .catch((err) => {
        console.error("Error loading artifacts:", err);
        window.showNotification?.("Failed to load artifacts", "error");
      });
  }

  /**
   * Create or update a project.
   * If projectId is provided, it updates; otherwise creates new.
   * Returns a Promise; the UI can handle .then(...) or .catch(...).
   */
  function createOrUpdateProject(projectId, formData) {
    const method = projectId ? "PATCH" : "POST";
    const endpoint = projectId
      ? `/api/projects/${projectId}`
      : "/api/projects";
    return window.apiRequest(endpoint, method, formData);
  }

  /**
   * Delete a project by ID.
   * Returns a promise; UI can do the confirm prompt.
   */
  function deleteProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}`, "DELETE");
  }

  /**
   * Pin/unpin a project. Toggles automatically on server.
   * Returns a promise.
   */
  function togglePinProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}/pin`, "POST");
  }

  /**
   * Archive/unarchive a project. Toggles automatically on server.
   * Returns a promise.
   */
  function toggleArchiveProject(projectId) {
    return window.apiRequest(`/api/projects/${projectId}/archive`, "PATCH");
  }

  /**
   * Save custom instructions field on the project.
   * Returns a promise.
   */
  function saveCustomInstructions(projectId, instructions) {
    return window.apiRequest(`/api/projects/${projectId}`, "PATCH", {
      custom_instructions: instructions
    });
  }

  /**
   * Upload a file to a project. Accepts a single File object.
   * Returns a promise that resolves or rejects on the upload result.
   */
  function uploadFile(projectId, file) {
    const formData = new FormData();
    formData.append("file", file);
    
    console.log(`Uploading file ${file.name} (${file.size} bytes) to project ${projectId}`);
    
    // Add any required metadata fields to formData
    formData.append('project_id', projectId);
    return window.apiRequest(`/api/projects/${projectId}/knowledge-bases/files`, "POST", formData)
    .then((response) => {
      console.log("File upload response:", response);
      return response; // Just return the response to be handled by caller
    }).catch(err => {
      console.error("File upload error:", err);
      // Handle specific error status codes
      const status = err?.response?.status;
      if (status === 422) {
        throw new Error("File validation failed: The file format may be unsupported or the file is corrupted");
      } else if (status === 413) {
        throw new Error("File too large: The file exceeds the maximum allowed size");
      } else if (status === 400) {
        const detail = err?.response?.data?.detail || "Invalid file";
        throw new Error(`Bad request: ${detail}`);
      } else {
        throw new Error(err?.response?.data?.detail || err.message || "Upload failed");
      }
    });
  }

  /**
   * Delete a file from a project.
   * Returns a promise.
   */
  function deleteFile(projectId, fileId) {
    return window.apiRequest(`/api/projects/${projectId}/files/${fileId}`, "DELETE");
  }

  /**
   * Delete an artifact from a project.
   * Returns a promise.
   */
  function deleteArtifact(projectId, artifactId) {
    return window.apiRequest(`/api/projects/${projectId}/artifacts/${artifactId}`, "DELETE");
  }

  /**
   * Create a new conversation within a project.
   * Returns a promise resolving with the conversation data.
   */
  function createConversation(projectId) {
      const payload = { title: "New Conversation" };

      // Always use project-specific endpoint for project conversations
      console.log("Creating project-associated conversation for project:", projectId);
      return window.apiRequest(`/api/projects/${projectId}/conversations`, "POST", {
        ...payload,
        project_id: projectId  // Explicitly include project_id in payload
      })
        .then(response => {
          console.log("Create conversation successful:", response);
          if (response?.data?.id) {
            return response.data;
          }
          throw new Error("Invalid conversation ID in response");
        })
            .catch(fallbackErr => {
              console.error("Error creating conversation with fallback endpoint:", fallbackErr);
              window.showNotification?.("Failed to create conversation", "error");
              throw fallbackErr; // Re-throw to ensure caller can handle the error
            });
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

  /**
   * Get the current project object
   */
  /**
   * Get the current project object
   * @returns {Object|null} The current project object or null if none loaded
   */
  function getCurrentProject() {
    return currentProject;
  }

  // Expose the manager as a global object
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
    // Conversation
    createConversation,
    // API utilities
    checkProjectApiEndpoint
  };
})();
