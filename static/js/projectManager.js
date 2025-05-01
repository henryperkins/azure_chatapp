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

/**
 * @typedef {Object} Project
 * @property {string} id               - Unique project ID (UUID).
 * @property {string} name             - Human-readable project name.
 * @property {boolean} [archived]      - Flag indicating the project is archived.
 * @property {boolean} [pinned]        - Flag indicating if the project is pinned.
 * @property {*} [otherProps]          - Additional arbitrary properties.
 */

/**
 * @typedef {Object} ProjectStats
 * @property {string} projectId        - ID of the project to which stats belong.
 * @property {number} [fileCount]      - Number of files in this project.
 * @property {number} [conversationCount] - Number of conversations in this project.
 * @property {*} [otherStats]          - Any additional arbitrary statistics.
 */

/**
 * @typedef {Object} FileUploadResult
 * @property {Array<{file: File}>} validatedFiles      - Files deemed valid for upload.
 * @property {Array<{file: File, reason: string}>} invalidFiles  - Files deemed invalid, including reason.
 */

/**
 * Strongly-normalize project fetch/create API responses. Throws if no valid project ID is found.
 * Ensures that the resulting object has a properly validated `projectData.id` string.
 *
 * @param {*} response - The raw API response, possibly containing project data in various shapes.
 * @returns {Object} A normalized project object guaranteed to have a valid `.id`.
 * @throws {Error} If no valid project ID can be extracted.
 */
export function normalizeProjectResponse(response) {
  let projectData = null;

  // Attempt to find project data in array or object shapes
  if (Array.isArray(response)) projectData = response[0];
  if (!projectData || !projectData.id) projectData = response?.data?.id ? response.data : null;
  if (!projectData || !projectData.id) projectData = response?.id ? response : null;

  // Normalize ID field among known properties (e.g., uuid, project_id, projectId)
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

  // Accept only strong UUID/IDs, reject 'null' etc.
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
 * Utility: Normalizes any API response to a uniform array of records—or a single object
 * for resource loaders. Searches common property keys like 'projects', 'conversations',
 * 'files', etc., to produce an array.
 *
 * @param {*} response - The raw API response.
 * @param {Object} [options={}] - Configuration for list extraction.
 * @param {string[]} [options.listKeys=["projects","conversations","artifacts","files"]]
 *   Common keys in the response where a list of items might be found.
 * @param {string} [options.dataKey="data"] - The property name at which data might exist (e.g., response.data).
 * @param {string|null} [options.singularKey=null] - A fallback key if the data is singular instead of an array.
 * @returns {?Array<*>} An array of items if found/extracted, or null if not found.
 */
function extractResourceList(response, options = {}) {
  const {
    listKeys = ["projects", "conversations", "artifacts", "files"],
    dataKey = "data",
    singularKey = null
  } = options;

  // Try to locate arrays in possible known structures
  for (const key of listKeys) {
    if (Array.isArray(response?.[key])) return response[key];
    if (Array.isArray(response?.[dataKey]?.[key])) return response[dataKey][key];
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.[key])) return response.data[key];

    // If we find a single object with .id under these keys, wrap it in an array
    if (response?.[key] && typeof response[key] === "object" && response[key].id) {
      return [response[key]];
    }
    if (response?.[dataKey]?.[key] && typeof response[dataKey][key] === "object" && response[dataKey][key].id) {
      return [response[dataKey][key]];
    }
  }

  // Other fallbacks
  if (Array.isArray(response?.[dataKey])) return response[dataKey];
  if (Array.isArray(response)) return response;
  if (response?.[dataKey]?.id) return [response[dataKey]];
  if (response?.id) return [response];

  // Additional loop for nested data
  if (listKeys) {
    for (const key of listKeys) {
      if (Array.isArray(response?.data?.[key])) return response.data[key];
      if (response?.data?.[key] && typeof response.data[key] === "object" && response.data[key].id) {
        return [response.data[key]];
      }
    }
  }

  // Optionally handle a singular key
  if (singularKey && response?.[singularKey]) return [response[singularKey]];
  if (singularKey && response?.[dataKey]?.[singularKey]) return [response[dataKey][singularKey]];

  // If none matched, fallback null
  return null;
}

/**
 * Checks if the provided ID string is a valid project UUID format.
 * @function
 * @param {string} id - Potential project ID to validate.
 * @returns {boolean} True if it matches a 32- or 36-char hex/UUID format and is not 'null'.
 */
export function isValidProjectId(id) {
  return (
    typeof id === 'string' &&
    /^[0-9a-f-]{32,36}$/i.test(id) &&
    id.toLowerCase() !== 'null'
  );
}

/**
 * The ProjectManager class orchestrates loading, creating, and managing projects
 * within the dependency injection context. It also delegates conversation creation
 * to the chatManager and handles knowledge base initialization, file uploading, etc.
 */
class ProjectManager {
  /**
   * Constructs the ProjectManager with provided dependencies or retrieves them from
   * the DependencySystem if not passed explicitly.
   *
   * @param {Object} deps - Dependency injection object
   * @param {Object} [deps.app] - The main application instance (API, state mgmt, notifications)
   * @param {Object} [deps.chatManager] - The chat/conversation manager instance
   * @param {Object} [deps.modelConfig] - Optional model config manager
   * @param {Object} [deps.DependencySystem] - Required dependency injection system
   * @throws {Error} If DependencySystem is not provided or if required dependencies are missing.
   */
  constructor({ app, chatManager, modelConfig, DependencySystem } = {}) {
    if (!DependencySystem) {
      throw new Error("DependencySystem is required for ProjectManager");
    }
    this.DependencySystem = DependencySystem;
    this.app = app || this.DependencySystem.modules.get("app");
    this.chatManager = chatManager || this.DependencySystem.modules.get("chatManager");
    this.modelConfig = modelConfig || this.DependencySystem.modules.get("modelConfig");

    // Verify required dependencies
    if (!this.app) {
      throw new Error("ProjectManager constructor: 'app' dependency missing.");
    }
    if (!this.chatManager) {
      throw new Error("ProjectManager constructor: 'chatManager' dependency missing.");
    }

    /**
     * Configuration constants, including endpoints for project operations.
     * @type {Object}
     */
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

    /**
     * @type {Project|null}
     * Holds the currently loaded project, if any.
     */
    this.currentProject = null;

    /**
     * @type {boolean}
     * Tracks whether a project list load is in progress (to prevent duplicates).
     */
    this.projectLoadingInProgress = false;
  }

  /**
   * Initialize the ProjectManager. Useful for one-time setup tasks.
   * Called by the orchestrator (e.g., app.js) after instantiating ProjectManager.
   * @async
   * @returns {Promise<void>}
   */
  async initialize() {
    console.log('[ProjectManager] Initializing...');
    // Any future one-time startup logic can be placed here
  }

  // --------------------------------------------------------------------------
  // Core Project Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Create a brand-new project, optionally ensuring a default conversation
   * and knowledge base are also created. Dispatches "projectCreated" and
   * "projectConversationsLoaded" events on success.
   *
   * @async
   * @param {Object} projectData - Key-value pairs for the new project's data.
   * @returns {Promise<Project>} The newly created project object (merged with conversation and KB).
   * @throws {Error} If project creation fails.
   */
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

      // 1. Optionally ensure a conversation and knowledge base
      const ensureConversation = async () => {
        const hasConvo =
          (Array.isArray(project.conversations) && project.conversations.length > 0) ||
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

      // Merge conversation and KB into the project object
      if (conversation) {
        project.conversations = [conversation];
        project.conversation_count = 1;
      }
      if (kb) project.knowledge_base = kb;

      this._emitEvent('projectCreated', project);
      document.dispatchEvent(
        new CustomEvent('projectConversationsLoaded', {
          detail: { projectId: project.id, conversations: project.conversations }
        })
      );

      return project;
    } catch (error) {
      console.error('[ProjectManager] Error creating project:', error);
      this.app?.showNotification('Failed to create project', 'error');
      throw error;
    }
  }

  /**
   * Creates a default conversation for a given project, using the model configuration if available.
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @returns {Promise<Object|null>} The conversation object, or null if creation fails.
   */
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
      return null;
    }
  }

  /**
   * Initializes a default knowledge base for the given project.
   * @async
   * @param {string} projectId - The project's UUID.
   * @returns {Promise<Object|null>} The knowledge base object, or null if initialization fails.
   */
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
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Project Loading
  // --------------------------------------------------------------------------

  /**
   * Loads a list of projects from the server, optionally filtered (e.g., archived or pinned).
   * Dispatches "projectsLoading" before fetch, and "projectsLoaded" (or error event) afterwards.
   *
   * @async
   * @param {string} [filter='all'] - Filter type string used by API (e.g., 'all', 'archived').
   * @returns {Promise<Project[]>} An array of loaded project objects.
   */
  async loadProjects(filter = 'all') {
    if (this.projectLoadingInProgress) {
      this.CONFIG.DEBUG &&
        console.log("[ProjectManager] Project loading already in progress");
      return [];
    }

    // Ensure user is authenticated
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
      // Build API endpoint with filter/pagination
      const params = new URLSearchParams();
      params.append("filter", filter);
      params.append("skip", "0");
      params.append("limit", "100");

      const endpoint = `${this.CONFIG.ENDPOINTS.PROJECTS}?${params.toString()}`;
      this.CONFIG.DEBUG && console.log(`[ProjectManager] Requesting projects from: ${endpoint}`);

      const response = await this.app.apiRequest(endpoint);

      // Always log raw response if in debug mode
      console.log(
        '%c[FULL /api/projects RESPONSE]',
        'color: orange; font-weight: bold',
        JSON.stringify(response)
      );
      this.CONFIG.DEBUG && console.log('[ProjectManager] Raw projects response:', response);

      // Attempt to parse the response in typical shapes
      let projects = [];
      if (Array.isArray(response?.data?.projects)) {
        projects = response.data.projects;
      } else if (Array.isArray(response?.projects)) {
        projects = response.projects;
      } else if (Array.isArray(response?.data)) {
        projects = response.data;
      } else if (Array.isArray(response)) {
        projects = response;
      } else if (response?.data && typeof response.data === "object" && response.data.id) {
        projects = [response.data];
      } else if (response && typeof response === "object" && response.id) {
        projects = [response];
      } else if (
        response?.data?.projects &&
        typeof response.data.projects === "object" &&
        response.data.projects.id
      ) {
        projects = [response.data.projects];
      } else if (
        response?.projects &&
        typeof response.projects === "object" &&
        response.projects.id
      ) {
        projects = [response.projects];
      } else {
        projects = [];
      }

      // If we still don't have an array, handle it
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

      // ---------- NEW: auto-select first project if none selected ----------
      if (!this.currentProject && normalizedProjects.length) {
        this.setCurrentProject?.(normalizedProjects[0]);
      }
      // Always emit an event so listeners can safely wait for it
      document.dispatchEvent(
        new CustomEvent('currentProjectReady', {
          detail: { project: this.currentProject }
        })
      );

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
   * Loads details for a specific project, including stats, files, conversations, and artifacts.
   * Dispatches "projectDetailsLoading" initially, then either "projectLoaded" or "projectDetailsError".
   *
   * @async
   * @param {string} projectId - The project UUID.
   * @returns {Promise<Project|null>} The loaded project, or null if errors occur.
   */
  async loadProjectDetails(projectId) {
    if (!isValidProjectId(projectId)) {
      console.error("[ProjectManager] Empty or invalid project ID supplied");
      this._emitEvent("projectDetailsError", {
        projectId,
        error: { message: "Project ID is required" }
      });
      return null;
    }

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

      let projectData;
      try {
        // Strict ID normalization
        projectData = normalizeProjectResponse(response);
      } catch (err) {
        this._emitEvent("projectDetailsError", {
          projectId,
          error: { message: err.message, response }
        });
        return null;
      }

      // Potential ID mismatch check
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

      // Load related data in parallel
      await Promise.allSettled([
        this.loadProjectStats(projectData.id),
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
   * Load project statistics such as file counts, conversation counts, etc.
   * Dispatches "projectStatsLoaded" or "projectStatsError".
   *
   * @async
   * @param {string} projectId - The project’s UUID.
   * @returns {Promise<ProjectStats>} A stats object (may be empty on error).
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
   * Load files for a project, returning an array of file objects.
   * Dispatches "projectFilesLoaded" or "projectFilesError".
   *
   * @async
   * @param {string} projectId - The project’s UUID.
   * @returns {Promise<Array>} Array of file objects.
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
   * Load all conversations for the specified project, returning an array of conversation objects.
   * Dispatches "projectConversationsLoaded" or "projectConversationsError".
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @returns {Promise<Array>} An array of conversation objects.
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
   * Load all artifacts associated with a project.
   * Dispatches "projectArtifactsLoaded" or "projectArtifactsError".
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @returns {Promise<Array>} An array of artifacts or empty on error.
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

  // --------------------------------------------------------------------------
  // Project Create/Update/Delete
  // --------------------------------------------------------------------------

  /**
   * Create a new project or update an existing one. Dispatches "projectUpdated" or "projectCreated"
   * depending on whether it's an update or new creation.
   *
   * @async
   * @param {string|null} projectId - UUID of the project to update, or null for creation.
   * @param {Object} projectData - New data for creating/updating.
   * @returns {Promise<Project>} The saved project object.
   * @throws {Error} If user is not authenticated or if the server response is invalid.
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

      // If updating the current loaded project, merge changes
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
   * Deletes a project from the server. Emits "projectDeleted" on success.
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @returns {Promise<any>} The server response, often an empty object or success message.
   * @throws {Error} If user is not authenticated or server operation fails.
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

  // --------------------------------------------------------------------------
  // Pin & Archive Toggling
  // --------------------------------------------------------------------------

  /**
   * Toggle the 'pinned' status of a project. Emits "projectPinToggled" with updated pin state.
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @returns {Promise<any>} The server response containing the pinned status.
   * @throws {Error} If user is not authenticated or server operation fails.
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
   * Toggle the 'archived' status of a project. Emits "projectArchiveToggled" with updated archived state.
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @returns {Promise<any>} The API response containing the archived status.
   * @throws {Error} If user is not authenticated or server operation fails.
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

  // --------------------------------------------------------------------------
  // Conversation Management (delegates to chatManager)
  // --------------------------------------------------------------------------

  /**
   * Creates a new conversation for the project, delegating to chatManager but updating localStorage
   * for "selectedProjectId".
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @param {Object} [options={}] - Additional conversation options for chatManager.
   * @returns {Promise<Object>} The newly created conversation object.
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
   * Deletes a conversation in the chatManager context.
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @param {string} conversationId - The conversation to delete.
   * @returns {Promise<boolean>} True if deleted successfully, otherwise throws.
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

  // --------------------------------------------------------------------------
  // Getters & File Handling
  // --------------------------------------------------------------------------

  /**
   * Returns the currently loaded project (or null if none is loaded).
   *
   * @returns {Project|null} The active project object, or null.
   */
  getCurrentProject() {
    return this.currentProject ? JSON.parse(JSON.stringify(this.currentProject)) : null;
  }

  /**
   * Prepares files for upload by checking size constraints and categorizing them
   * as valid or invalid.
   *
   * @async
   * @param {string} projectId - The project's UUID (not used in this example, but typically required server-side).
   * @param {FileList|Array<File>} fileList - List of files selected for upload.
   * @returns {Promise<FileUploadResult>} Contains arrays of validated and invalid files.
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
   * Uploads a file to the server with retry logic (exponential backoff).
   *
   * @async
   * @param {string} projectId - The project's UUID.
   * @param {{file: File}} fileObj - An object containing the file to be uploaded.
   * @param {number} [maxRetries=3] - Maximum number of retry attempts.
   * @returns {Promise<boolean>} True if the file is uploaded successfully.
   * @throws {Error} If retries are exhausted.
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

  // --------------------------------------------------------------------------
  // Internal Utilities
  // --------------------------------------------------------------------------

  /**
   * Emits a custom DOM event representing a state change or action in ProjectManager.
   * @private
   * @param {string} eventName - The name of the event (e.g., "projectCreated").
   * @param {Object} detail - Additional data to attach to the event's payload.
   */
  _emitEvent(eventName, detail) {
    const evt = new CustomEvent(eventName, {
      detail,
      bubbles: false,
      composed: false
    });
    evt.timestamp = Date.now();
    document.dispatchEvent(evt);
  }
}

/**
 * Factory function for dependency-injected ProjectManager construction.
 * 
 * Typically called in an orchestrator (like app.js), which then registers
 * the instance with the DependencySystem.
 *
 * Usage:
 *   const projectManager = createProjectManager({ app, chatManager, DependencySystem });
 *   DependencySystem.register('projectManager', projectManager);
 *
 * @param {Object} deps - Dependency object for ProjectManager constructor.
 * @returns {ProjectManager} A new instance of ProjectManager.
 */
export function createProjectManager(deps = {}) {
  return new ProjectManager(deps);
}

// For backward compatibility and module registration example:
// const projectManager = createProjectManager();
// await projectManager.initialize();
// window.projectManager = projectManager;
// DependencySystem.register('projectManager', projectManager);

export default createProjectManager;
