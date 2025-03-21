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
    window.apiRequest(`/api/projects/${projectId}`, "GET")
      .then((response) => {
        currentProject = response.data;
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
    window.apiRequest(`/api/projects/${projectId}/conversations`, "GET")
      .then((response) => {
        const conversations = response.data?.conversations || response.data || [];
        document.dispatchEvent(
          new CustomEvent("projectConversationsLoaded", { detail: conversations })
        );
      })
      .catch((err) => {
        // Fallback attempt if "/conversations" fails
        console.error("Error loading conversations:", err);
        window.apiRequest(`/api/projects/${projectId}/chat/conversations`, "GET")
          .then((resp2) => {
            const conv2 = resp2.data?.conversations || resp2.data || [];
            document.dispatchEvent(
              new CustomEvent("projectConversationsLoaded", { detail: conv2 })
            );
          })
          .catch((fallbackErr) => {
            console.error("Error in fallback conversation load:", fallbackErr);
            window.showNotification?.("Failed to load conversations", "error");
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
    return window.apiRequest(`/api/projects/${projectId}/conversations`, "POST", payload);
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
    createConversation
  };
})();
