/**
 * projectManager.js
 *
 * Project management module for web applications.
 *
 * ## Dependencies:
 * - window.app: Application core with state management and API requests.
 * - window.DependencySystem: Dependency injection/registration system.
 * - window.chatManager: Chat/conversation management module.
 * - FormData: For file uploads.
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

/* Defensive: one-time cache holder for replay (at top-level) */
window.projectEvents = window.projectEvents || {};

class ProjectManager {
  constructor() {
    // Configuration constants
    this.CONFIG = {
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
    this.currentProject = null;
    this.projectLoadingInProgress = false;
  }

  // --- Always-create full workflow, user-supplied ---

  async createProject(projectData) {
    try {
      const response = await window.app.apiRequest('/api/projects', {
        method: 'POST',
        body: projectData
      });

      const project = response.data || response;

      if (!project || !project.id) {
        throw new Error('Invalid project response');
      }

      console.log('[ProjectManager] Project created:', project.id);

      // 1. Ensure a KB and at least one conversation, idempotent
      const ensureConversation = async () => {
        const hasConvo =
          (Array.isArray(project.conversations) && project.conversations.length) ||
          Number(project.conversation_count) > 0;
        if (hasConvo) return project.conversations?.[0];
        return await this.createDefaultConversation(project.id);
      };

      const ensureKnowledgeBase = async () => {
        if (project.knowledge_base?.id) return project.knowledge_base;
        return await this.initializeKnowledgeBase(project.id);
      };

      const [conversation, kb] = await Promise.all([
        ensureConversation(),
        ensureKnowledgeBase()
      ]);

      // 2. Merge into project object for downstream consumers
      if (conversation) {
        project.conversations = [conversation];
        project.conversation_count = 1;
      }
      if (kb) project.knowledge_base = kb;

      this._emitEvent('projectCreated', project);
      document.dispatchEvent(
        new CustomEvent('projectConversationsLoaded', {
          detail: { projectId: project.id, conversations: project.conversations },
        })
      );

      return project;
    } catch (error) {
      console.error('[ProjectManager] Error creating project:', error);
      window.app?.showNotification('Failed to create project', 'error');
      throw error;
    }
  }

  async createDefaultConversation(projectId) {
    try {
      const response = await window.app.apiRequest(
        `/api/projects/${projectId}/conversations`,
        {
          method: 'POST',
          body: {
            title: 'Default Conversation',
            model_id:
              window.modelConfig?.getConfig()?.modelName || 'claude-3-sonnet-20240229'
          }
        }
      );

      const conversation = response.data || response;

      if (!conversation.id) {
        throw new Error('Failed to create default conversation');
      }

      console.log('[ProjectManager] Default conversation created:', conversation.id);
      return conversation;
    } catch (error) {
      console.error('[ProjectManager] Failed to create default conversation:', error);
      window.app?.showNotification('Default conversation creation failed', 'error');
    }
  }

  async initializeKnowledgeBase(projectId) {
    try {
      const response = await window.app.apiRequest(
        `/api/projects/${projectId}/knowledge-bases`,
        {
          method: 'POST',
          body: {
            name: 'Default Knowledge Base',
            description: 'Auto-created knowledge base.',
            embedding_model: 'text-embedding-3-small' // Adjust model as needed
          }
        }
      );

      const kb = response.data || response;
      if (!kb.id) throw new Error('Failed to initialize knowledge base');

      console.log('[ProjectManager] Knowledge base initialized:', kb.id);
      return kb;
    } catch (error) {
      console.error('[ProjectManager] Failed to initialize knowledge base:', error);
      window.app?.showNotification('Knowledge base initialization failed', 'error');
    }
  }

  /**
   * Initialize the project manager
   * @returns {Promise<void>}
   */
  async initialize() {
    console.log('[ProjectManager] Initializing...');
    // Any one-time setup code can go here
  }

  /**
   * Load a list of projects, optionally filtered.
   *
   * @param {string} [filter='all'] - Filter type (e.g., 'all', 'archived', etc.)
   * @returns {Promise<Project[]>} - Resolves to an array of projects.
   */
  async loadProjects(filter = 'all') {
    if (this.projectLoadingInProgress) {
      this.CONFIG.DEBUG &&
        console.log("[ProjectManager] Project loading already in progress");
      return [];
    }

    // Check authentication from centralized state
    if (!window.app.state.isAuthenticated) {
      console.warn("[ProjectManager] Not authenticated, can't load projects");
      this._emitEvent("projectsLoaded", {
        projects: [],
        reason: 'auth_required'
      });
      return [];
    }

    this.projectLoadingInProgress = true;
    this._emitEvent("projectsLoading", { filter });

    try {
      // Build API endpoint with filter and pagination
      const params = new URLSearchParams();
      params.append("filter", filter);
      params.append("skip", "0");
      params.append("limit", "100");

      const endpoint = `${this.CONFIG.ENDPOINTS.PROJECTS}?${params.toString()}`;
      this.CONFIG.DEBUG &&
        console.log(`[ProjectManager] Requesting projects from: ${endpoint}`);
      const response = await window.app.apiRequest(endpoint);

      // Always log the full API response for debugging
      console.log(
        '%c[FULL /api/projects RESPONSE]',
        'color: orange; font-weight: bold',
        JSON.stringify(response)
      );
      this.CONFIG.DEBUG &&
        console.log('[ProjectManager] Raw projects response:', response);

      // Support various API response shapes
      const projects =
        response?.data?.projects ||
        response?.projects ||
        (Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
            ? response
            : []);

      if (!Array.isArray(projects)) {
        console.warn("[ProjectManager] Unexpected project list format:", response);
        this._emitEvent("projectsLoaded", {
          projects: [],
          reason: 'invalid_format'
        });
        return [];
      }

      this._emitEvent("projectsLoaded", {
        projects,
        filter
      });

      return projects;
    } catch (error) {
      console.error("[ProjectManager] Error loading projects:", error);
      this._emitEvent("projectsLoaded", {
        projects: [],
        error: true,
        message: error.message || 'Unknown error',
        status: error.status
      });
      return [];
    } finally {
      this.projectLoadingInProgress = false;
    }
  }

  /**
   * Load details for a specific project, including related data.
   *
   * @param {string} projectId - The project UUID.
   * @returns {Promise<Project|null>} - Resolves to the project object or null on error.
   */
  async loadProjectDetails(projectId) {
    if (!window.app.validateUUID(projectId)) {
      console.error("[ProjectManager] Invalid project ID:", projectId);
      this._emitEvent("projectDetailsError", {
        projectId,
        error: { message: "Invalid project ID" }
      });
      return null;
    }

    // Check authentication from centralized state
    if (!window.app.state.isAuthenticated) {
      console.warn("[ProjectManager] Not authenticated, can't load project details");
      this._emitEvent("projectDetailsError", {
        projectId,
        error: { message: "Authentication required" }
      });
      return null;
    }

    this.currentProject = null;
    this._emitEvent("projectDetailsLoading", { projectId });

    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
      const response = await window.app.apiRequest(endpoint);

      // Support various API response shapes
      let projectData = null;
      if (response?.data?.id) projectData = response.data;
      else if (response?.id) projectData = response;
      else if ((response?.status === 'success' || response?.success === true) && response?.data?.id) {
        projectData = response.data;
      }

      if (!projectData || projectData.id !== projectId) {
        throw new Error("Invalid project response format or ID mismatch");
      }

      this.currentProject = projectData;
      this._emitEvent("projectLoaded", JSON.parse(JSON.stringify(this.currentProject)));

      // If archived, skip loading related data
      if (this.currentProject.archived) {
        this._emitEvent("projectArchivedNotice", { id: this.currentProject.id });
        return JSON.parse(JSON.stringify(this.currentProject));
      }

      // Load related data in parallel (stats, files, conversations, artifacts)
      await Promise.allSettled([
        this.loadProjectStats(projectId),
        this.loadProjectFiles(projectId),
        this.loadProjectConversations(projectId),
        this.loadProjectArtifacts(projectId)
      ]);

      return JSON.parse(JSON.stringify(this.currentProject));
    } catch (error) {
      console.error("[ProjectManager] Error loading project details:", error);
      this._emitEvent("projectDetailsError", {
        projectId,
        error: { message: error.message, status: error.status }
      });

      if (error.status === 404) {
        this._emitEvent("projectNotFound", { projectId });
      }
      return null;
    }
  }

  /**
   * Load statistics for a project.
   *
   * @param {string} projectId - The project UUID.
   * @returns {Promise<ProjectStats>} - Resolves to stats object.
   */
  async loadProjectStats(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_STATS.replace('{projectId}', projectId);
      const response = await window.app.apiRequest(endpoint);

      const stats = response?.data || {};
      this._emitEvent("projectStatsLoaded", {
        projectId,
        ...stats
      });
      return stats;
    } catch (error) {
      console.error("[ProjectManager] Error loading project stats:", error);
      this._emitEvent("projectStatsError", {
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
   */
  async loadProjectFiles(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
      const response = await window.app.apiRequest(endpoint);

      // Support various API response shapes
      const files =
        response?.data?.files ||
        response?.files ||
        (Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
            ? response
            : []);

      this._emitEvent("projectFilesLoaded", { projectId, files });
      return files;
    } catch (error) {
      console.error("[ProjectManager] Error loading project files:", error);
      this._emitEvent("projectFilesError", {
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
   */
  async loadProjectConversations(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
      const response = await window.app.apiRequest(endpoint);

      // Support various API response shapes
      const conversations =
        response?.data?.conversations ||
        response?.conversations ||
        (Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
            ? response
            : []);

      this._emitEvent("projectConversationsLoaded", { projectId, conversations });
      return conversations;
    } catch (error) {
      console.error("[ProjectManager] Error loading project conversations:", error);
      this._emitEvent("projectConversationsError", {
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
   */
  async loadProjectArtifacts(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_ARTIFACTS.replace('{projectId}', projectId);
      const response = await window.app.apiRequest(endpoint);

      // Support various API response shapes
      const artifacts =
        response?.data?.artifacts ||
        response?.artifacts ||
        (Array.isArray(response?.data)
          ? response.data
          : Array.isArray(response)
            ? response
            : []);

      this._emitEvent("projectArtifactsLoaded", { projectId, artifacts });
      return artifacts;
    } catch (error) {
      console.error("[ProjectManager] Error loading project artifacts:", error);
      this._emitEvent("projectArtifactsError", {
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
   */
  async createOrUpdateProject(projectId, projectData) {
    if (!window.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    const isUpdate = !!projectId;
    const method = isUpdate ? "PATCH" : "POST";
    const endpoint = isUpdate
      ? this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)
      : this.CONFIG.ENDPOINTS.PROJECTS;

    try {
      const response = await window.app.apiRequest(endpoint, { method, body: projectData });
      const resultData = response?.data || response;

      if (!resultData || !resultData.id) {
        throw new Error("Invalid response after project save");
      }

      if (isUpdate && this.currentProject?.id === projectId) {
        this.currentProject = { ...this.currentProject, ...resultData };
        this._emitEvent("projectUpdated", JSON.parse(JSON.stringify(this.currentProject)));
      } else if (!isUpdate) {
        this._emitEvent("projectCreated", resultData);
      }

      return resultData;
    } catch (error) {
      console.error("[ProjectManager] Error saving project:", error);
      throw error;
    }
  }

  /**
   * Delete a project.
   *
   * @param {string} projectId - The project UUID.
   * @returns {Promise<any>} - Resolves to API response.
   */
  async deleteProject(projectId) {
    if (!window.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
      const response = await window.app.apiRequest(endpoint, { method: "DELETE" });

      if (this.currentProject?.id === projectId) {
        this.currentProject = null;
      }

      this._emitEvent("projectDeleted", { projectId });
      return response;
    } catch (error) {
      console.error("[ProjectManager] Error deleting project:", error);
      throw error;
    }
  }

  /**
   * Toggle the pin status for a project.
   *
   * @param {string} projectId - The project UUID.
   * @returns {Promise<any>} - Resolves to API response.
   */
  async togglePinProject(projectId) {
    if (!window.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    try {
      const endpoint = `${this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/pin`;
      const response = await window.app.apiRequest(endpoint, { method: "POST" });

      this._emitEvent("projectPinToggled", {
        projectId,
        pinned: response?.pinned ?? !this.currentProject?.pinned
      });

      return response;
    } catch (error) {
      console.error("[ProjectManager] Error toggling project pin:", error);
      throw error;
    }
  }

  /**
   * Toggle the archive status for a project.
   *
   * @param {string} projectId - The project UUID.
   * @returns {Promise<any>} - Resolves to API response.
   */
  async toggleArchiveProject(projectId) {
    if (!window.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    try {
      const endpoint = `${this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/archive`;
      const response = await window.app.apiRequest(endpoint, { method: "PATCH" });

      this._emitEvent("projectArchiveToggled", {
        projectId,
        archived: response?.archived ?? !this.currentProject?.archived
      });

      return response;
    } catch (error) {
      console.error("[ProjectManager] Error toggling project archive:", error);
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
  async createConversation(projectId, options = {}) {
    try {
      localStorage.setItem("selectedProjectId", projectId);
      return await window.chatManager.createNewConversation(projectId, options);
    } catch (error) {
      console.error("[ProjectManager] createConversation error:", error);
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
  async deleteProjectConversation(projectId, conversationId) {
    try {
      localStorage.setItem("selectedProjectId", projectId);
      await window.chatManager.deleteConversation(conversationId);
      return true;
    } catch (error) {
      console.error("[ProjectManager] deleteProjectConversation error:", error);
      throw error;
    }
  }

  /**
   * Get the currently loaded project.
   *
   * @returns {Project|null} - The current project or null.
   */
  getCurrentProject() {
    return this.currentProject ? JSON.parse(JSON.stringify(this.currentProject)) : null;
  }

  /**
   * Validate and prepare files for upload.
   *
   * @param {string} projectId - The project UUID.
   * @param {FileList|Array<File>} fileList - List of files to validate.
   * @returns {Promise<FileUploadResult>} - Object with validated and invalid files.
   */
  async prepareFileUploads(projectId, fileList) {
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
  async uploadFileWithRetry(projectId, { file }, maxRetries = 3) {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId);

        await window.app.apiRequest(`/api/projects/${projectId}/files`, {
          method: 'POST',
          body: formData
        });
        return true;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // simple backoff
      }
    }
  }

  /**
   * Emit a custom DOM event for projectManager state changes.
   * @private
   * @param {string} eventName - The event name.
   * @param {Object} detail - Event detail object.
   */
  _emitEvent(eventName, detail) {
    // Build event object once (for both dispatches and cache)
    const evt = new CustomEvent(eventName, {
      detail,
      bubbles: false,
      composed: false
    });
    evt.timestamp = Date.now();

    // Dispatch on local EventTarget (ProjectManager instance) for local listeners
    this.dispatchEvent?.(evt);

    // Also dispatch on global document so UI components can hear it
    document.dispatchEvent(evt);

    // Cache for late-joining listeners (store latest 20 per event)
    try {
      const store = window.projectEvents;
      store[eventName] = store[eventName] || [];
      store[eventName].push(evt);
      if (store[eventName].length > 20) store[eventName].shift();
    } catch (e) {
      // Defensive: don't break app if caching fails
      console.warn('[ProjectManager] event cache error:', e);
    }
  }
}

// Export factory function for app.js to use
export function createProjectManager() {
  return new ProjectManager();
}

// For backward compatibility and module registration, app.js will use this code
// instead of having the module self-initialize:
/*
const projectManager = createProjectManager();
await projectManager.initialize();
window.projectManager = projectManager;
DependencySystem.register('projectManager', projectManager);
*/

export default createProjectManager;
