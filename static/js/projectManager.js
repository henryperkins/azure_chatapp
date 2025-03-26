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
  function loadProjects(filter = "all") {
    console.log("[ProjectManager] Loading projects with filter:", filter);
    
    // Check auth state
    const isAuthenticated = window.API_CONFIG?.isAuthenticated || 
                          (sessionStorage.getItem('userInfo') !== null && 
                           sessionStorage.getItem('auth_state') !== null);
    
    if (!isAuthenticated) {
      console.warn("[ProjectManager] Not authenticated, skipping project load");
      return Promise.resolve([]);
    }

    return window.apiRequest("/api/projects", "GET")
      .then((response) => {
        console.log("[ProjectManager] Raw API response:", response);
        
        // Standardize response format
        let projects = [];
        if (response && typeof response === 'object') {
          // Handle both { data: [...] } and { projects: [...] } formats
          projects = response.data || response.projects || [];
        } else if (Array.isArray(response)) {
          projects = response;
        }

        if (!Array.isArray(projects)) {
          console.error("[ProjectManager] Invalid projects data format:", projects);
          projects = [];
        }

        console.log(`[ProjectManager] Found ${projects.length} projects before filtering`);
        
        // Apply filter
        const filteredProjects = projects.filter(project => {
          if (!project) return false;
          if (filter === "pinned") return project.pinned;
          if (filter === "archived") return project.archived;
          if (filter === "active") return !project.archived;
          return true; // 'all' filter
        });

        console.log(`[ProjectManager] Dispatching ${filteredProjects.length} projects after filtering`);
        document.dispatchEvent(
          new CustomEvent("projectsLoaded", { 
            detail: filteredProjects,
            originalCount: projects.length,
            filterApplied: filter
          })
        );
        return filteredProjects;
      })
      .catch((err) => {
        console.error("[ProjectManager] Error loading projects:", err);
        window.showNotification?.("Failed to load projects", "error");
        throw err;
      });
  }

  /**
   * Load details for a single project.
   * Dispatches "projectLoaded" with { detail: project }.
   * If not archived, also loads stats, files, conversations, artifacts.
   */
  function loadProjectDetails(projectId) {
    // First check which API endpoint format works
    checkProjectApiEndpoint(projectId).then(endpointType => {
      // Use the appropriate endpoint format based on what works
      let projectEndpoint = endpointType === "standard" ? 
        `/api/projects/${projectId}` : `/api/${projectId}`;
      
      window.apiRequest(projectEndpoint, "GET")
        .then((response) => {
          currentProject = response.data;
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

          loadProjectStats(projectId);
          loadProjectFiles(projectId);
          loadProjectConversations(projectId);
          loadProjectArtifacts(projectId);
        })
        .catch((err) => {
          console.error("Error loading project details:", err);
          window.showNotification?.("Failed to load project details", "error");
        });
    }).catch(() => {
      // If endpoint check fails, try the standard endpoint anyway
      window.apiRequest(`/api/projects/${projectId}`, "GET")
        .then((response) => {
          currentProject = response.data;
          document.dispatchEvent(
            new CustomEvent("projectLoaded", { detail: currentProject })
          );
          
          loadProjectStats(projectId);
          loadProjectFiles(projectId);
          loadProjectConversations(projectId);
          loadProjectArtifacts(projectId);
        })
        .catch((err) => {
          console.error("Error loading project details:", err);
          window.showNotification?.("Failed to load project details", "error");
        });
    });
  }

  /**
   * Load project stats (token usage, counts, etc.).
   * Dispatches "projectStatsLoaded" with { detail: statsObject }.
   */
  function loadProjectStats(projectId) {
    window.apiRequest(`/api/projects/${projectId}/stats`, "GET")
      .then((response) => {
        document.dispatchEvent(
          new CustomEvent("projectStatsLoaded", { detail: response.data })
        );
      })
      .catch((err) => console.error("Error loading project stats:", err));
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
    
    return fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      body: formData,
      credentials: "include"
    }).then((response) => {
      if (!response.ok) {
        console.error(`Upload failed with status: ${response.status}`);
        return response.text().then(text => {
          try {
            // Try to parse as JSON for better error info
            const errorJson = JSON.parse(text);
            throw new Error(errorJson.detail || errorJson.message || "Upload failed");
          } catch (e) {
            // If it's not parseable as JSON, use the text directly
            throw new Error(`Upload failed: ${text || response.statusText}`);
          }
        });
      }
      return response.json();
    }).catch(err => {
      console.error("File upload error:", err);
      throw err; // Re-throw to allow caller to handle it
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

      // Try the main endpoint first
      console.log("Attempting to create conversation with primary endpoint: /api/projects/" + projectId + "/conversations");
      return window.apiRequest(`/api/projects/${projectId}/conversations`, "POST", payload)
        .then(response => {
          console.log("Create conversation successful (primary endpoint):", response);
          // Check for the ID in the response
          if (response?.data?.id) {
            return response.data;
          } else {
            console.error("Invalid conversation ID in response (primary endpoint):", response);
            throw new Error("Invalid conversation ID");
          }
        })
        .catch(err => {
          console.error("Error creating conversation with primary endpoint:", err);
          // Try the fallback endpoint
          console.log("Attempting to create conversation with fallback endpoint: /api/chat/projects/" + projectId + "/conversations");
          return window.apiRequest(`/api/chat/projects/${projectId}/conversations`, "POST", payload)
            .then(response => {
              console.log("Create conversation successful (fallback endpoint):", response);
              // Check for the ID in the response
              if (response?.data?.id) {
                return response.data;
              } else {
                console.error("Invalid conversation ID in response (fallback endpoint):", response);
                throw new Error("Invalid conversation ID");
              }
            })
            .catch(fallbackErr => {
              console.error("Error creating conversation with fallback endpoint:", fallbackErr);
              window.showNotification?.("Failed to create conversation", "error");
              throw fallbackErr; // Re-throw to ensure caller can handle the error
            });
        });
    }

  /**
   * Check the API endpoint to determine which URL format works
   * for project conversations. This helps adapt to different backend configurations.
   */
  function checkProjectApiEndpoint(projectId) {
    return window.apiRequest(`/api/projects/${projectId}`, "GET")
      .then(() => {
        console.log("API endpoint format is /api/projects/{id}");
        return "standard";
      })
      .catch(() => {
        return window.apiRequest(`/api/${projectId}`, "GET")
          .then(() => {
            console.log("API endpoint format is /api/{id}");
            return "simple";
          })
          .catch(() => {
            console.log("Could not determine API endpoint format");
            return "unknown";
          });
      });
  }

  // Expose the manager as a global object
  window.projectManager = {
    // Data
    currentProject,
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
