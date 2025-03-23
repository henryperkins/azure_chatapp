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
    window.apiRequest("/api/projects", "GET")
      .then((response) => {
        // Some APIs return { data: [ ... ] }, others return [ ... ] directly:
        let projects = Array.isArray(response) ? response : (response.data || []);
        
        // Apply filter
        if (filter === "pinned") {
          projects = projects.filter(p => p.pinned);
        } else if (filter === "archived") {
          projects = projects.filter(p => p.archived);
        } else if (filter === "active") {
          projects = projects.filter(p => !p.archived);
        }
        
        document.dispatchEvent(
          new CustomEvent("projectsLoaded", { detail: projects })
        );
      })
      .catch((err) => {
        console.error("Error loading projects:", err);
        window.showNotification?.("Failed to load projects", "error");
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
    // First try the correct endpoint from routes/projects/conversations.py
    window.apiRequest(`/api/projects/${projectId}/conversations`, "GET")
      .then((response) => {
        // Log the response for debugging
        console.log("Project conversations response:", response);
        const conversations = response.data?.conversations || response.data || [];
        document.dispatchEvent(
          new CustomEvent("projectConversationsLoaded", { detail: conversations })
        );
      })
      .catch((err) => {
        // Fallback attempt if "/conversations" fails
        console.error("Error loading conversations:", err);
        // Try alternative endpoint formats
        window.apiRequest(`/api/${projectId}/conversations`, "GET")
          .then((resp2) => {
            const conv2 = resp2.data?.conversations || resp2.data || [];
            document.dispatchEvent(
              new CustomEvent("projectConversationsLoaded", { detail: conv2 })
            );
          })
          .catch((fallbackErr) => {
            console.error("Error in first fallback conversation load:", fallbackErr);
            // Try a third format
            window.apiRequest(`/api/chat/projects/${projectId}/conversations`, "GET")
              .then((resp3) => {
                const conv3 = resp3.data?.conversations || resp3.data || [];
                document.dispatchEvent(
                  new CustomEvent("projectConversationsLoaded", { detail: conv3 })
                );
              })
              .catch((thirdErr) => {
                console.error("Error in all conversation load attempts:", thirdErr);
                window.showNotification?.("Failed to load conversations", "error");
              });
          });
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
    return fetch(`/api/projects/${projectId}/files`, {
      method: "POST",
      body: formData,
      credentials: "include"
    }).then((response) => {
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
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
