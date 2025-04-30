/**
 * projectManager.js - DependencySystem Refactored Edition
 *
 * Project management module, strictly DI-based, with orchestrator-driven dependency resolution.
 *
 * ## Dependencies (all via DependencySystem):
 * - app: Application core (API, state mgmt, notifications)
 * - chatManager: Chat/conversation management
 * - modelConfig: Model configuration manager (optional)
 * - DependencySystem: Dependency injection module (required)
 *
 * No reliance on window.* globals for shared modules. No event replay cabinet.
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


/**
 * Strongly-normalize project fetch/create API responses. Throws if no valid project ID found.
 * See: unified frontend remediation spec.
 */
export function normalizeProjectResponse(response) {
  let projectData = null;
  if (Array.isArray(response)) projectData = response[0];
  if (!projectData || !projectData.id) projectData = response?.data?.id ? response.data : null;
  if (!projectData || !projectData.id) projectData = response?.id ? response : null;

  // Coerce and check for all known keys (uuid, project_id, projectId, id)
  projectData &&= {
    ...projectData,
    id: String(
      projectData.id ??
      projectData.uuid ??
      projectData.project_id ??
      projectData.projectId ??
      ''
    ).trim()
  };
  // Accept only "strong" UUID/project IDs, not 'null', not empty, not loose types
  if (
    !projectData ||
    !projectData.id ||
    projectData.id.toLowerCase() === 'null' ||
    !isValidProjectId(projectData.id)
  ) {
    console.error('[ProjectManager] Invalid project data/ID', { response, projectData });
    throw new Error('Invalid or missing project ID after project load');
  }
  return projectData;
}

/**
 * Utility: Normalizes any API response to a uniform array of records—or single object—for resource loaders.
 */
function extractResourceList(response, options = {}) {
  const {
    listKeys = ["projects", "conversations", "artifacts", "files"],
    dataKey = "data",
    singularKey = null
  } = options;

  // List at root or inside .data, or named key
  for (const key of listKeys) {
    if (Array.isArray(response?.[key])) return response[key];
    if (Array.isArray(response?.[dataKey]?.[key])) return response[dataKey][key];
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.[key])) return response.data[key];
    if (response?.[key] && typeof response[key] === "object" && response[key].id)
      return [response[key]];
    if (response?.[dataKey]?.[key] && typeof response[dataKey][key] === "object" && response[dataKey][key].id)
      return [response[dataKey][key]];
  }
  // fallback for arrays directly
  if (Array.isArray(response?.[dataKey])) return response[dataKey];
  if (Array.isArray(response)) return response;
  // fallback for unique object with id
  if (response?.[dataKey]?.id) return [response[dataKey]];
  if (response?.id) return [response];
  // expanded for wrapped or singular key results
  if (listKeys) {
    for (const key of listKeys) {
      if (Array.isArray(response?.data?.[key])) return response.data[key];
      if (response?.data?.[key] && typeof response.data[key] === "object" && response.data[key].id)
        return [response.data[key]];
    }
  }
  if (singularKey && response?.[singularKey]) return [response[singularKey]];
  if (singularKey && response?.[dataKey]?.[singularKey]) return [response[dataKey][singularKey]];

  return null; // Unable to produce an array
}

/** True UUID (canonical, not just non-empty string) validator. */
export function isValidProjectId(id) {
  // Accept 32/36-cc UUIDs, not 'null', not empty, not accidental number/undefined
  return (
    typeof id === 'string' &&
    /^[0-9a-f-]{32,36}$/i.test(id) &&
    id.toLowerCase() !== 'null'
  );
}

class ProjectManager {
  constructor({ app, chatManager, modelConfig, DependencySystem } = {}) {
    // Support orchestrator-driven dependency injection (DependencySystem first, fallback to args)
    this.DependencySystem = DependencySystem || window.DependencySystem;
    if (!this.DependencySystem) {
      throw new Error("DependencySystem is required for ProjectManager");
    }
    this.app = app || this.DependencySystem.modules.get("app");
    this.chatManager = chatManager || this.DependencySystem.modules.get("chatManager");
    this.modelConfig = modelConfig || this.DependencySystem.modules.get("modelConfig");

    // Defensive: warn if any required dependency missing
    if (!this.app) throw new Error("ProjectManager constructor: 'app' dependency missing.");
    if (!this.chatManager) throw new Error("ProjectManager constructor: 'chatManager' dependency missing.");

    // Configuration constants
    this.CONFIG = {
      DEBUG: window.location.hostname === 'localhost' || window.location.search.includes('debug=1'),
      ENDPOINTS: {
        PROJECTS: '/api/projects/',
        PROJECT_DETAIL: '/api/projects/{projectId}/',
        PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations/',
        PROJECT_FILES: '/api/projects/{projectId}/files/',
        PROJECT_STATS: '/api/projects/{projectId}/stats/',
        PROJECT_ARTIFACTS: '/api/projects/{projectId}/artifacts/'
      }
    };

    this.currentProject = null;
    this.projectLoadingInProgress = false;
  }

  // --- Always-create full workflow, user-supplied ---

  async createProject(projectData) {
    try {
      const response = await this.app.apiRequest('/api/projects', {
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
      this.app?.showNotification('Failed to create project', 'error');
      throw error;
    }
  }

  async createDefaultConversation(projectId) {
    try {
      const response = await this.app.apiRequest(
        `/api/projects/${projectId}/conversations/`,
        {
          method: 'POST',
          body: {
            title: 'Default Conversation',
            model_id:
              (this.modelConfig?.getConfig?.()?.modelName) || 'claude-3-sonnet-20240229'
          }
        }
      );

      const conversation =
        response?.data?.conversation ||
        response?.data ||
        response?.conversation ||
        response;

      if (!conversation || !conversation.id) {
        throw new Error('Failed to create default conversation');
      }

      console.log('[ProjectManager] Default conversation created:', conversation.id);
      return conversation;
    } catch (error) {
      console.error('[ProjectManager] Failed to create default conversation:', error);
      this.app?.showNotification('Default conversation creation failed', 'error');
    }
  }

  async initializeKnowledgeBase(projectId) {
    try {
      const response = await this.app.apiRequest(
        `/api/projects/${projectId}/knowledge-bases/`,
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
      this.app?.showNotification('Knowledge base initialization failed', 'error');
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
    if (!this.app.state.isAuthenticated) {
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
      const response = await this.app.apiRequest(endpoint);

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

      // PATCH: Accept valid single-object project, warn only if neither array nor object with .id
      let normalizedProjects = projects;
      if (Array.isArray(projects)) {
        // proceed
      } else if (projects && typeof projects === "object" && projects.id) {
        normalizedProjects = [projects];
      } else {
        console.warn("[ProjectManager] Unexpected project list format:", response);
        this._emitEvent("projectsLoaded", {
          projects: [],
          reason: 'invalid_format'
        });
        return [];
      }

      this._emitEvent("projectsLoaded", {
        projects: normalizedProjects,
        filter
      });

      return normalizedProjects;
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
    // Defensive: reject empty or loosely-supplied projectId up front
    if (!isValidProjectId(projectId)) {
      console.error("[ProjectManager] Empty or invalid project ID supplied");
      this._emitEvent("projectDetailsError", {
        projectId,
        error: { message: "Project ID is required" }
      });
      return null;
    }

    // Check authentication from centralized state
    if (!this.app.state.isAuthenticated) {
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
      const response = await this.app.apiRequest(endpoint);

      if (!response) return null;

      // Use strict normalization/validation
      let projectData;
      try {
        projectData = normalizeProjectResponse(response);
      } catch (err) {
        this._emitEvent("projectDetailsError", {
          projectId,
          error: { message: err.message, response }
        });
        return null;
      }

      // Normalize both sides to lowercase string to allow 42/UUID, etc.
      const parsedId = String(projectData.id).toLowerCase();
      const requestedId = String(projectId).toLowerCase();
      if (parsedId !== requestedId) {
        console.warn("[ProjectManager] ID mismatch – taking server value:", {
          requestedId,
          parsedId
        });
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
        this.loadProjectStats(projectData.id), // use normalized/validated id
        this.loadProjectFiles(projectData.id),
        this.loadProjectConversations(projectData.id),
        this.loadProjectArtifacts(projectData.id)
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
      const response = await this.app.apiRequest(endpoint);

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
      const response = await this.app.apiRequest(endpoint);

      let files = extractResourceList(response, { listKeys: ["files", "file"] });
      if (!Array.isArray(files)) {
        console.warn("[ProjectManager] Unexpected file list format:", response);
        files = [];
      }

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
      const response = await this.app.apiRequest(endpoint);

      if (!response) return [];

      let conversations = extractResourceList(response, { listKeys: ["conversations", "conversation"] });
      if (!Array.isArray(conversations)) {
        console.warn("[ProjectManager] Unexpected conversation list format:", response);
        conversations = [];
      }

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
      const response = await this.app.apiRequest(endpoint);

      if (!response) return [];

      let artifacts = extractResourceList(response, { listKeys: ["artifacts", "artifact"] });
      if (!Array.isArray(artifacts)) {
        console.warn("[ProjectManager] Unexpected artifact list format:", response);
        artifacts = [];
      }

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
    if (!this.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    const isUpdate = !!projectId;
    const method = isUpdate ? "PATCH" : "POST";
    const endpoint = isUpdate
      ? this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)
      : this.CONFIG.ENDPOINTS.PROJECTS;

    try {
      const response = await this.app.apiRequest(endpoint, { method, body: projectData });
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
    if (!this.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
      const response = await this.app.apiRequest(endpoint, { method: "DELETE" });

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
    if (!this.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    try {
      const endpoint = `${this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/pin`;
      const response = await this.app.apiRequest(endpoint, { method: "POST" });

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
    if (!this.app.state.isAuthenticated) {
      throw new Error("Authentication required");
    }

    try {
      const endpoint = `${this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)}/archive`;
      const response = await this.app.apiRequest(endpoint, { method: "PATCH" });

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
      return await this.chatManager.createNewConversation(projectId, options);
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
      await this.chatManager.deleteConversation(conversationId);
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

        await this.app.apiRequest(`/api/projects/${projectId}/files/`, {
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

    // Dispatch on document so UI components can hear it
    document.dispatchEvent(evt);
  }
}

/**
 * Factory function for dependency-injected ProjectManager construction.
 *
 * Usage from orchestrator (in app.js):
 *
 *    const projectManager = createProjectManager();
 *    DependencySystem.register('projectManager', projectManager);
 */
export function createProjectManager(deps = {}) {
  return new ProjectManager(deps);
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
