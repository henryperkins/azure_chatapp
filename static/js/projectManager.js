/**
 * projectManager.js - Refactored to address lint warnings
 *
 * Key changes from original:
 * 1. No direct window usage.
 * 2. No fallback localStorage usage.
 * 3. No direct console.log/error/warn.
 * 4. All event listeners use trackListener from eventHandlers.
 * 5. No raw default export mismatch—exporting createProjectManager directly.
 * 6. All setTimeout calls documented with reasons; you can replace with a scheduler if needed.
 */

/**
 * @typedef {Object} Project
 * @property {string} id         - Unique project ID (UUID).
 * @property {string} name       - Project name.
 * @property {boolean} [archived]   - Whether the project is archived.
 * @property {boolean} [pinned]     - Whether pinned.
 * @property {*} [otherProps]       - Additional props.
 */

/**
 * @typedef {Object} ProjectStats
 * @property {string} projectId        - The project ID for these stats.
 * @property {number} [fileCount]      - Number of files in the project.
 * @property {number} [conversationCount] - Number of conversations.
 * @property {*} [otherStats]          - Additional arbitrary stats.
 */

/**
 * @typedef {Object} FileUploadResult
 * @property {Array<{file: File}>} validatedFiles
 * @property {Array<{file: File, reason: string}>} invalidFiles
 */

// ------------------------------------------------------------------------
// Local Utility Functions
// ------------------------------------------------------------------------

/**
 * Checks if the provided string is a valid project ID (UUID).
 * @param {string} id - Potential project ID.
 * @returns {boolean} True if matches a typical 32/36-char UUID.
 */
function isValidProjectId(id) {
  return typeof id === 'string' && /^[0-9a-f-]{32,36}$/i.test(id) && id.toLowerCase() !== 'null';
}

/**
 * Normalizes a project API response to a guaranteed `.id`, throwing
 * if no valid ID is found.
 * @param {*} response
 * @returns {Object} A normalized project object (with `id`).
 * @throws {Error} If no valid ID can be extracted.
 */
function normalizeProjectResponse(response) {
  let projectData = null;

  if (Array.isArray(response)) projectData = response[0];
  if (!projectData || !projectData.id) projectData = response?.data?.id ? response.data : null;
  if (!projectData || !projectData.id) projectData = response?.id ? response : null;

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

  if (!projectData || !projectData.id || !isValidProjectId(projectData.id)) {
    // Instead of console.error, we use notify/log via a helper,
    // but we can only do so if we have a reference to "this" or some injected logger.
    throw new Error('Invalid or missing project ID after project load');
  }
  return projectData;
}

/**
 * Finds an array of items in known keys or transforms single object into array if needed.
 * @param {*} response
 * @param {Object} [options={}]
 * @param {string[]} [options.listKeys=["projects","conversations","artifacts","files"]]
 * @returns {?Array<*>}
 */
function extractResourceList(response, options = {}) {
  const {
    listKeys = ["projects", "conversations", "artifacts", "files"],
    dataKey = "data",
    singularKey = null
  } = options;

  for (const key of listKeys) {
    if (Array.isArray(response?.[key])) return response[key];
    if (Array.isArray(response?.[dataKey]?.[key])) return response[dataKey][key];
    if (Array.isArray(response?.data)) return response.data;
    if (response?.[key] && response[key].id) return [response[key]];
    if (response?.[dataKey]?.[key] && response[dataKey][key].id) {
      return [response[dataKey][key]];
    }
  }

  if (Array.isArray(response?.[dataKey])) return response[dataKey];
  if (Array.isArray(response)) return response;
  if (response?.[dataKey]?.id) return [response[dataKey]];
  if (response?.id) return [response];

  if (singularKey && response?.[singularKey]) return [response[singularKey]];
  if (singularKey && response?.[dataKey]?.[singularKey]) {
    return [response[dataKey][singularKey]];
  }
  return null;
}

// ------------------------------------------------------------------------
// Retry logic split to avoid a >40 line function
// ------------------------------------------------------------------------

/**
 * Delays for a specified number of milliseconds
 * (replaces raw setTimeout with a named function to clarify usage).
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    // "timing hack" for exponential backoff
    setTimeout(resolve, ms);
  });
}

/**
 * Attempts the provided async function, up to maxRetries, with exponential backoff.
 * Each retry is delayed by attempt * 1000 ms.
 * @async
 * @param {Function} fn - The async function to call.
 * @param {number} [maxRetries=3]
 * @returns {*}
 * @throws if all retries fail.
 */
async function retryWithBackoff(fn, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      // Another "timing hack" but we name it clarifying: exponential backoff.
      await delay(1000 * attempt);
    }
  }
}

// ------------------------------------------------------------------------
// The ProjectManager Class
// ------------------------------------------------------------------------

class ProjectManager {
  /**
   * @param {Object} deps
   * @param {Object} [deps.app] - The main application instance
   * @param {Object} [deps.chatManager] - The chat/conversation manager
   * @param {Object} [deps.modelConfig] - Optional model config manager
   * @param {Object} [deps.DependencySystem] - For resolving other modules
   * @param {Object} [deps.envService] - Must provide isDebugMode() to avoid window usage
   * @param {Object} [deps.storageService] - Must provide getItem, setItem, removeItem (no localStorage fallback)
   * @param {Object} [deps.notificationHandler] - For user notifications & logging (no console.*)
   * @param {Object} [deps.eventHandlers] - Must provide trackListener/untrackListener
   */
  constructor({
    app,
    chatManager,
    modelConfig,
    DependencySystem,
    envService,
    storageService,
    notificationHandler,
    eventHandlers
  } = {}) {
    if (!DependencySystem) {
      throw new Error("DependencySystem is required for ProjectManager");
    }
    this.DependencySystem = DependencySystem;
    this.app = app || this.DependencySystem.modules.get("app");
    if (!this.app) throw new Error("ProjectManager: 'app' dependency missing.");

    // Chat manager
    let resolvedChatManager = chatManager || this.DependencySystem.modules.get("chatManager");
    if (!resolvedChatManager || typeof resolvedChatManager.loadConversation !== 'function') {
      throw new Error("projectManager: 'chatManager' missing or invalid");
    }
    this.chatManager = resolvedChatManager;

    // Model config
    this.modelConfig = modelConfig || this.DependencySystem.modules.get("modelConfig");

    // Must not rely on window => throw if not provided
    if (!envService?.isDebugMode) {
      throw new Error("ProjectManager: envService with isDebugMode() is required to avoid window usage");
    }
    this.env = envService;

    // Must not rely on localStorage => throw if not provided
    if (!storageService?.getItem || !storageService?.setItem) {
      throw new Error("ProjectManager: storageService required for local persistence (no direct localStorage allowed)");
    }
    this.storage = storageService;

    // Must not rely on console => throw if not provided
    if (!notificationHandler?.notifyError || !notificationHandler?.notifyInfo) {
      throw new Error("ProjectManager: notificationHandler with notifyError/notifyInfo required (no direct console logs).");
    }
    this.notifier = notificationHandler; // e.g., { notifyError, notifyInfo }

    // Must use eventHandlers => throw if missing
    if (!eventHandlers?.trackListener || !eventHandlers?.untrackListener) {
      throw new Error("ProjectManager: eventHandlers must provide trackListener/untrackListener (no bare addEventListener).");
    }
    this.eventHandlers = eventHandlers;

    // Config
    this.CONFIG = {
      DEBUG: this.env.isDebugMode(),
      ENDPOINTS: {
        PROJECTS: '/api/projects/',
        PROJECT_DETAIL: '/api/projects/{projectId}/',
        PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations/',
        PROJECT_FILES: '/api/projects/{projectId}/files/',
        PROJECT_STATS: '/api/projects/{projectId}/stats/',
        PROJECT_ARTIFACTS: '/api/projects/{projectId}/artifacts/'
      }
    };

    /** @type {Project|null} */
    this.currentProject = null;
    this.projectLoadingInProgress = false;
    this._eventOccurred = {}; // track certain events
  }

  async initialize() {
    this.notifier.notifyInfo('[ProjectManager] Initializing...');
    // Add any one-time startup logic here
  }

  // ---------------------------------------------------------------------
  // DOM Event Emission
  // ---------------------------------------------------------------------
  _emitEvent(eventName, detail) {
    const evt = new CustomEvent(eventName, { detail, bubbles: false, composed: false });
    evt.timestamp = Date.now();

    if (detail && detail.projectId) {
      this._eventOccurred[`${eventName}_${detail.projectId}`] = true;
    }
    document.dispatchEvent(evt);
  }

  // ---------------------------------------------------------------------
  // Auth Check
  // ---------------------------------------------------------------------
  requireAuthenticatedOrEmit(eventName, detail = {}) {
    if (!this.app?.state?.isAuthenticated) {
      this.notifier.notifyError(
        `[ProjectManager] Not authenticated, cannot proceed with ${eventName}`
      );
      this._emitEvent(eventName, {
        error: { message: 'Authentication required' },
        ...detail
      });
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------
  handleError(eventName, error, fallbackValue, extraDetail = {}) {
    const msg = `[ProjectManager] ${eventName} error: ${error.message || error}`;
    this.notifier.notifyError(msg);
    this._emitEvent(eventName, {
      error: { message: error.message, status: error.status },
      ...extraDetail
    });
    return fallbackValue;
  }

  // ---------------------------------------------------------------------
  // Project Lifecycle
  // ---------------------------------------------------------------------

  async loadProjects(filter = 'all') {
    if (this.projectLoadingInProgress) {
      if (this.CONFIG.DEBUG) {
        this.notifier.notifyInfo("loadProjects: already in progress");
      }
      return [];
    }
    if (!this.requireAuthenticatedOrEmit("projectsLoaded", { reason: 'auth_required' })) {
      return [];
    }

    this.projectLoadingInProgress = true;
    this._emitEvent("projectsLoading", { filter });

    try {
      const params = new URLSearchParams({ filter, skip: '0', limit: '100' });
      const endpoint = `${this.CONFIG.ENDPOINTS.PROJECTS}?${params.toString()}`;
      const response = await this.app.apiRequest(endpoint);

      if (this.CONFIG.DEBUG) {
        this.notifier.notifyInfo(`[ProjectManager] Raw projects response: ${JSON.stringify(response)}`);
      }

      const projects = this._parseProjectsArray(response);

      if (!this.currentProject && projects.length > 0 && this.setCurrentProject) {
        this.setCurrentProject(projects[0]);
        document.dispatchEvent(
          new CustomEvent('currentProjectReady', {
            detail: { project: this.currentProject }
          })
        );
      }
      this._emitEvent("projectsLoaded", { projects, filter });
      return projects;
    } catch (error) {
      return this.handleError("projectsLoaded", error, []);
    } finally {
      this.projectLoadingInProgress = false;
    }
  }

  _parseProjectsArray(response) {
    const array = extractResourceList(response, {
      listKeys: ['projects', 'data']
    });
    if (Array.isArray(array)) return array;
    if (array && array.id) return [array];
    return [];
  }

  async loadProjectDetails(projectId) {
    if (!isValidProjectId(projectId)) {
      return this.handleError(
        "projectDetailsError",
        new Error("Invalid or missing projectId"),
        null,
        { projectId }
      );
    }
    if (!this.requireAuthenticatedOrEmit("projectDetailsError", { projectId })) {
      return null;
    }

    this.currentProject = null;
    this.projectLoadingInProgress = true;
    this._emitEvent("projectDetailsLoading", { projectId });

    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId);
      const response = await this.app.apiRequest(endpoint);
      if (!response) {
        this.projectLoadingInProgress = false;
        return this.handleError("projectDetailsError", new Error("No response returned"), null, { projectId });
      }

      const projectData = normalizeProjectResponse(response);

      this.currentProject = projectData;
      this._emitEvent("projectLoaded", { ...this.currentProject });

      if (this.currentProject.archived) {
        this._emitEvent("projectArchivedNotice", { id: this.currentProject.id });
        this.projectLoadingInProgress = false;
        return { ...this.currentProject };
      }

      const loadPromises = [
        this.loadProjectStats(projectData.id),
        this.loadProjectFiles(projectData.id),
        this.loadProjectConversations(projectData.id),
        this.loadProjectArtifacts(projectData.id),
        projectData.knowledge_base
          ? Promise.resolve(projectData.knowledge_base)
          : this.loadProjectKnowledgeBase(projectData.id)
      ];

      const loadResults = await Promise.allSettled(loadPromises);
      const criticalErrors = loadResults
        .filter((r, i) => r.status === 'rejected' && i < 4)
        .map(r => r.reason);

      if (criticalErrors.length > 0) {
        this.notifier.notifyError(`Critical component load errors: ${criticalErrors.map(e => e.message).join(',')}`);
        this._emitEvent("projectDetailsLoadError", {
          projectId: projectData.id,
          errors: criticalErrors
        });
      }

      const renderingComplete = Promise.all([
        this._createRenderPromise("projectStatsRendered", projectData.id),
        this._createRenderPromise("projectFilesRendered", projectData.id),
        this._createRenderPromise("projectConversationsRendered", projectData.id),
        this._createRenderPromise("projectArtifactsRendered", projectData.id),
        this._createRenderPromise("projectKnowledgeBaseRendered", projectData.id)
      ]);

      try {
        // Another timed wait—justified by ensuring UI rendering completes.
        await Promise.race([
          renderingComplete,
          delay(5000).then(() => {
            throw new Error("Rendering timeout");
          })
        ]);
        this._emitEvent("projectDetailsFullyLoaded", { projectId: projectData.id, success: true });
      } catch (renderError) {
        this.notifier.notifyError(`[ProjectManager] Not all components rendered: ${renderError}`);
        this._emitEvent("projectDetailsFullyLoaded", { projectId: projectData.id, success: false, error: renderError });
      } finally {
        this.projectLoadingInProgress = false;
      }
      return { ...this.currentProject };
    } catch (error) {
      this.projectLoadingInProgress = false;
      this.handleError("projectDetailsError", error, null, { projectId });
      if (error.status === 404) this._emitEvent("projectNotFound", { projectId });
      return null;
    }
  }

  /**
   * Waits for a specific rendering event for the given projectId, or times out.
   * Must use eventHandlers.trackListener.
   * @param {string} eventName
   * @param {string} projectId
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<void>}
   */
  _createRenderPromise(eventName, projectId, timeoutMs = 5000) {
    if (this._eventOccurred[`${eventName}_${projectId}`]) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let resolved = false;
      const handler = (evt) => {
        if (evt.detail?.projectId === projectId && !resolved) {
          resolved = true;
          this.eventHandlers.untrackListener(document, eventName, handler);
          resolve();
        }
      };

      // Must use trackListener
      this.eventHandlers.trackListener(document, eventName, handler, {
        description: `ProjectManager waiting for ${eventName} [${projectId}]`
      });

      // Another "timing hack" but we do it with a named delay:
      delay(timeoutMs).then(() => {
        if (!resolved) {
          this.notifier.notifyError(
            `[ProjectManager] Event ${eventName} for project ${projectId} timed out after ${timeoutMs}ms`
          );
          this.eventHandlers.untrackListener(document, eventName, handler);
          resolve();
        }
      });
    });
  }

  async loadProjectKnowledgeBase(projectId) {
    try {
      this.notifier.notifyInfo(`Loading knowledge base for project ${projectId}...`);
      const endpoint = `/api/projects/${projectId}/knowledge-base`;
      const response = await this.app.apiRequest(endpoint);
      const kb = response?.data || response;
      if (!kb) {
        this.notifier.notifyInfo(`No knowledge base found for project: ${projectId}`);
        this._emitEvent("projectKnowledgeBaseLoaded", { projectId, knowledgeBase: null });
      } else {
        this.notifier.notifyInfo(`Knowledge base loaded for project ${projectId}: ${kb.id}`);
        this._emitEvent("projectKnowledgeBaseLoaded", { projectId, knowledgeBase: kb });
      }
      return kb;
    } catch (error) {
      this.notifier.notifyError(`Error loading KB for project ${projectId}: ${error}`);
      this._emitEvent("projectKnowledgeBaseLoaded", { projectId, knowledgeBase: null });
      return this.handleError("projectKnowledgeBaseError", error, null, { projectId });
    }
  }

  async loadProjectStats(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_STATS.replace('{projectId}', projectId);
      const response = await this.app.apiRequest(endpoint);
      const stats = response?.data || {};
      this._emitEvent("projectStatsLoaded", { projectId, ...stats });
      return stats;
    } catch (error) {
      return this.handleError("projectStatsError", error, {}, { projectId });
    }
  }

  async loadProjectFiles(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_FILES.replace('{projectId}', projectId);
      const response = await this.app.apiRequest(endpoint);
      const files = extractResourceList(response, { listKeys: ["files", "file"] }) || [];
      this._emitEvent("projectFilesLoaded", { projectId, files });
      return files;
    } catch (error) {
      return this.handleError("projectFilesError", error, [], { projectId });
    }
  }

  async loadProjectConversations(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
      const response = await this.app.apiRequest(endpoint);
      const conversations = extractResourceList(response, { listKeys: ["conversations"] }) || [];
      this._emitEvent("projectConversationsLoaded", { projectId, conversations });
      return conversations;
    } catch (error) {
      return this.handleError("projectConversationsError", error, [], { projectId });
    }
  }

  async loadProjectArtifacts(projectId) {
    try {
      const endpoint = this.CONFIG.ENDPOINTS.PROJECT_ARTIFACTS.replace('{projectId}', projectId);
      const response = await this.app.apiRequest(endpoint);
      const artifacts = extractResourceList(response, { listKeys: ["artifacts"] }) || [];
      this._emitEvent("projectArtifactsLoaded", { projectId, artifacts });
      return artifacts;
    } catch (error) {
      return this.handleError("projectArtifactsError", error, [], { projectId });
    }
  }

  async createOrUpdateProject(projectId, projectData) {
    if (!this.requireAuthenticatedOrEmit('projectUpdateError', { projectId })) {
      throw new Error("Auth required");
    }
    const isUpdate = !!projectId;
    const method = isUpdate ? "PATCH" : "POST";
    const endpoint = isUpdate
      ? this.CONFIG.ENDPOINTS.PROJECT_DETAIL.replace('{projectId}', projectId)
      : this.CONFIG.ENDPOINTS.PROJECTS;

    try {
      const response = await this.app.apiRequest(endpoint, { method, body: projectData });
      const resultData = response?.data || response;
      if (!resultData?.id) throw new Error("Invalid response after project save");

      if (isUpdate && this.currentProject?.id === projectId) {
        this.currentProject = { ...this.currentProject, ...resultData };
        this._emitEvent("projectUpdated", { ...this.currentProject });
      } else if (!isUpdate) {
        this._emitEvent("projectCreated", resultData);
      }
      return resultData;
    } catch (error) {
      this.notifier.notifyError(`createOrUpdateProject error: ${error}`);
      throw error;
    }
  }

  async deleteProject(projectId) {
    if (!this.requireAuthenticatedOrEmit("projectDeleteError", { projectId })) {
      throw new Error("Auth required");
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
      this.notifier.notifyError(`deleteProject error: ${error}`);
      throw error;
    }
  }

  async togglePinProject(projectId) {
    if (!this.requireAuthenticatedOrEmit("projectPinToggled", { projectId })) {
      throw new Error("Auth required");
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
      this.notifier.notifyError(`Error toggling pin: ${error}`);
      throw error;
    }
  }

  async toggleArchiveProject(projectId) {
    if (!this.requireAuthenticatedOrEmit("projectArchiveToggled", { projectId })) {
      throw new Error("Auth required");
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
      this.notifier.notifyError(`Error toggling archive: ${error}`);
      throw error;
    }
  }

  // ----------------------------------------------------------------
  // Chat/Conversation Delegations
  // ----------------------------------------------------------------
  async createConversation(projectId, options = {}) {
    try {
      this.storage.setItem("selectedProjectId", projectId);
      return await this.chatManager.createNewConversation(projectId, options);
    } catch (error) {
      this.notifier.notifyError(`createConversation error: ${error}`);
      throw error;
    }
  }

  async deleteProjectConversation(projectId, conversationId) {
    try {
      this.storage.setItem("selectedProjectId", projectId);
      await this.chatManager.deleteConversation(conversationId);
      return true;
    } catch (error) {
      this.notifier.notifyError(`deleteProjectConversation error: ${error}`);
      throw error;
    }
  }

  // ----------------------------------------------------------------
  // File Handling
  // ----------------------------------------------------------------
  getCurrentProject() {
    return this.currentProject ? JSON.parse(JSON.stringify(this.currentProject)) : null;
  }

  async prepareFileUploads(projectId, fileList) {
    // Basic example
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

  async uploadFileWithRetry(projectId, { file }, maxRetries = 3) {
    return retryWithBackoff(async () => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', projectId);
      await this.app.apiRequest(`/api/projects/${projectId}/files/`, {
        method: 'POST',
        body: formData
      });
      return true;
    }, maxRetries);
  }

  // ----------------------------------------------------------------
  // Additional Project Creation Helpers
  // ----------------------------------------------------------------
  async createProject(projectData) {
    try {
      const response = await this.app.apiRequest('/api/projects', {
        method: 'POST',
        body: projectData
      });
      const project = response.data || response;
      if (!project?.id) throw new Error('Invalid project response');
      this.notifier.notifyInfo(`[ProjectManager] Project created: ${project.id}`);

      const [conversation, kb] = await Promise.all([
        this._ensureConversation(project),
        this._ensureKnowledgeBase(project)
      ]);

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
      this.notifier.notifyError(`Error creating project: ${error}`);
      this.app?.showNotification?.('Failed to create project', 'error');
      throw error;
    }
  }

  async _ensureConversation(project) {
    const hasConvo =
      (Array.isArray(project.conversations) && project.conversations.length > 0) ||
      Number(project.conversation_count) > 0;

    if (hasConvo) {
      return project.conversations?.[0];
    }
    return this.createDefaultConversation(project.id);
  }

  async _ensureKnowledgeBase(project) {
    if (project.knowledge_base?.id) return project.knowledge_base;
    return this.initializeKnowledgeBase(project.id);
  }

  async createDefaultConversation(projectId) {
    try {
      const response = await this.app.apiRequest(
        `/api/projects/${projectId}/conversations/`,
        {
          method: 'POST',
          body: {
            title: 'Default Conversation',
            model_id: this.modelConfig?.getConfig?.()?.modelName || 'claude-3-sonnet-20240229'
          }
        }
      );
      const conversation = response?.data?.conversation || response?.data || response?.conversation || response;
      if (!conversation?.id) throw new Error('Failed to create default conversation');
      this.notifier.notifyInfo(`Default conversation created: ${conversation.id}`);
      return conversation;
    } catch (error) {
      this.notifier.notifyError(`Failed to create default conversation: ${error}`);
      this.app?.showNotification?.('Default conversation creation failed', 'error');
      return null;
    }
  }

  async initializeKnowledgeBase(projectId) {
    try {
      const response = await this.app.apiRequest(`/api/projects/${projectId}/knowledge-bases/`, {
        method: 'POST',
        body: {
          name: 'Default Knowledge Base',
          description: 'Auto-created knowledge base.',
          embedding_model: 'text-embedding-3-small'
        }
      });
      const kb = response?.data || response;
      if (!kb?.id) throw new Error('Failed to initialize knowledge base');
      this.notifier.notifyInfo(`Knowledge base initialized: ${kb.id}`);
      return kb;
    } catch (error) {
      this.notifier.notifyError(`Failed to initialize knowledge base: ${error}`);
      this.app?.showNotification?.('Knowledge base initialization failed', 'error');
      return null;
    }
  }
}

/**
 * Factory function: returns a new ProjectManager instance, enforced as default export.
 * @param {Object} deps
 */
export default function createProjectManager(deps) {
  return new ProjectManager(deps);
}

export { isValidProjectId };
