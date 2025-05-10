/**
 * projectManager.js – DI-strict, Notification-aware, Advanced Edition (context-rich notifications)
 *
 * Combines:
 *  - Modern DI/notification patterns from Untitled 4
 *  - Full feature set from projectManager (file upload, KB, archive, etc)
 *  - Notification calls always emit context/module/source/module for end-to-end traceability
 */

/* -------------------------------------------------------------------------- */
/* Imports                                                                   */
/* -------------------------------------------------------------------------- */
import { wrapApi, emitReady } from "./utils/notifications-helpers.js";

/* -------------------------------------------------------------------------- */
/* Local utility helpers – pure and safe to unit-test                         */
/* -------------------------------------------------------------------------- */

const MODULE = "ProjectManager";

/**
 * Validate a project identifier.
 * Accepts:
 *   • UUID strings (32–36 hex chars plus optional hyphens)
 *   • Pure numeric identifiers (one or more digits)
 *   • Already–numeric values (will be coerced to string)
 *
 * This wider validation is required because the backend may return either
 * database-numeric IDs or UUIDs depending on configuration/migration state.
 *
 * @param {string|number} id - Candidate identifier
 * @returns {boolean} True if the value looks like a valid project ID
 */
function isValidProjectId(id) {
  if (id == null) return false;
  const idStr = String(id).trim();
  // UUID v4 or similar: 32-36 hex chars with optional hyphens
  const uuidLike = /^[0-9a-f-]{32,36}$/i.test(idStr);
  // Numeric (database PK)
  const numeric = /^\d+$/.test(idStr);
  return uuidLike || numeric;
}

function normalizeProjectResponse(res) {
  let data = Array.isArray(res) ? res[0]
    : res?.data?.id ? res.data
      : res?.id ? res
        : null;
  if (data) {
    data = { ...data, id: String(data.id ?? data.uuid ?? data.project_id ?? data.projectId ?? '').trim() };
  }
  if (!isValidProjectId(data?.id)) throw new Error('Invalid project ID in server response');
  return data;
}

/** Finds a list in response (keys) or wraps singletons */
function extractResourceList(res, keys = ['projects', 'conversations', 'files', 'artifacts']) {
  for (const k of keys) {
    if (Array.isArray(res?.[k])) return res[k];
    if (Array.isArray(res?.data?.[k])) return res.data[k];
    if (res?.[k]?.id) return [res[k]];
    if (res?.data?.[k]?.id) return [res.data[k]];
  }
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res)) return res;
  if (res?.id) return [res];
  return [];
}

async function retryWithBackoff(fn, maxRetries, timer) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      // Check if the error object has a status property (common for fetch errors)
      // Do not retry 405 errors or other client errors (400-499) except for 429 (Too Many Requests)
      if (err && err.status && ((err.status >= 400 && err.status < 500 && err.status !== 429) || err.status === 405)) {
        throw err;
      }
      if (++attempt > maxRetries) throw err;
      // Log the retry attempt with error details for better debugging
      console.warn(`Retry attempt ${attempt}/${maxRetries} for ${fn.name || 'anonymous function'} due to error:`, err);
      await new Promise(r => timer(r, 1000 * attempt));
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The ProjectManager class                                                   */
/* -------------------------------------------------------------------------- */

class ProjectManager {
  constructor({
    app,
    chatManager,
    DependencySystem,
    modelConfig = null,
    notify = null,
    notificationHandler = null,
    listenerTracker = null,
    timer = typeof setTimeout === 'function' ? setTimeout : (cb) => cb(),
    storage = { setItem: () => { }, getItem: () => null },
    apiEndpoints,
    apiRequest = null,
    errorReporter = null,
    debugTools = null
  } = {}) {
    if (!DependencySystem) {
      if (notify) notify.error('[ProjectManager] DependencySystem required', { group: true, context: 'projectManager', module: MODULE, source: 'constructor' });
      throw new Error('DependencySystem required');
    }
    if (!apiEndpoints) {
      if (notify) notify.error('[ProjectManager] apiEndpoints required', { group: true, context: 'projectManager', module: MODULE, source: 'constructor' });
      throw new Error('apiEndpoints required');
    }

    // Always use notify.withContext for context-rich notifications
    this.pmNotify = (notify?.withContext)
      ? notify.withContext({ module: MODULE, context: 'projectManager' })
      : notify;
    this.app = app ?? DependencySystem.modules.get('app');
    this.chatManager = chatManager ?? DependencySystem.modules.get('chatManager');
    this.modelConfig = modelConfig ?? DependencySystem.modules.get('modelConfig');
    this.notify = notify ?? DependencySystem.modules.get?.('notify');
    this.errorReporter = errorReporter ?? DependencySystem.modules.get?.('errorReporter');
    this.debugTools    = debugTools || DependencySystem.modules.get?.('debugTools') || null;
    this.timer = timer;
    this.storage = storage;
    this.apiRequest = apiRequest ?? app?.apiRequest;

    // Fallback: wrap raw handler if notify util isn't injected yet
    if (!this.notify && notificationHandler?.show) {
      const h = notificationHandler;
      this.notify = {
        info: (m, o = {}) => h.show(m, 'info', 4000, { ...o, group: true, context: 'projectManager', module: MODULE }),
        success: (m, o = {}) => h.show(m, 'success', 4000, { ...o, group: true, context: 'projectManager', module: MODULE }),
        warn: (m, o = {}) => h.show(m, 'warning', 6000, { ...o, group: true, context: 'projectManager', module: MODULE }),
        error: (m, o = {}) => h.show(m, 'error', 0, { ...o, group: true, context: 'projectManager', module: MODULE }),
      };
    }
    if (!this.notify) {
      throw new Error('notify util or notificationHandler missing');
    }
    // Listener tracking
    if (!listenerTracker) {
      const ev = DependencySystem.modules.get('eventHandlers');
      if (!ev?.trackListener) {
        this.notify.error('[ProjectManager] eventHandlers.trackListener missing', { group: true, context: 'projectManager', module: MODULE, source: 'constructor' });
        throw new Error('eventHandlers.trackListener missing');
      }
      listenerTracker = {
        add: (t, e, h, dsc) => ev.trackListener(t, e, h, { description: dsc }),
        remove: (t, e, h) => ev.cleanupListeners?.(t, e, h),
      };
    }
    this.listenerTracker = listenerTracker;

    /** @type {?Object} */
    this.currentProject = null;
    this._loadingProjects = false;
    this.apiEndpoints = apiEndpoints;
    this._CONFIG = {
      PROJECTS: apiEndpoints.PROJECTS || '/api/projects/',
      DETAIL: apiEndpoints.DETAIL   || '/api/projects/{id}/',
      STATS: apiEndpoints.STATS     || '/api/projects/{id}/stats/',
      FILES: apiEndpoints.FILES     || '/api/projects/{id}/files/',
      CONVOS: apiEndpoints.CONVOS   || '/api/projects/{id}/conversations/',
      ARTIFACTS: apiEndpoints.ARTIFACTS || '/api/projects/{id}/artifacts/',
      KB: apiEndpoints.KB           || '/api/projects/{id}/knowledge_base/',
      ARCHIVE: apiEndpoints.ARCHIVE || '/api/projects/{id}/archive/'
    };

    this.pmNotify?.info?.('[ProjectManager] Initialized', { group: true, context: 'projectManager', module: MODULE, source: 'constructor' });
  }

  /* ---------------------------------------------------------------------- */
  /* Standardized DI-safe API request wrapper with error grouping            */
  /* ---------------------------------------------------------------------- */
  /**
   * _req: Unified API request layer with error notification and grouping.
   * Automatically captures endpoint/method and groups API errors.
   * Usage: await this._req(url, opts, src)
   */
  async _req(url, opts = {}, src = MODULE) {
    return wrapApi(
      this.apiRequest,
      { notify: this.notify, errorReporter: this.errorReporter },
      url,
      opts,
      src
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  _emit(event, detail) {
    if (this.domAPI && typeof this.domAPI.dispatchEvent === 'function') {
      this.domAPI.dispatchEvent(this.domAPI.getDocument(), new CustomEvent(event, { detail }));
    } else {
      document.dispatchEvent(new CustomEvent(event, { detail }));
    }
  }
  _authOk(failEvent, extraDetail = {}) {
    if (this.app?.state?.isAuthenticated) return true;
    this.notify.warn('[ProjectManager] Auth required', { group: true, context: 'projectManager', module: MODULE, source: '_authOk', extra: extraDetail });
    this._emit(failEvent, { error: 'auth_required', ...extraDetail });
    return false;
  }
  _handleErr(eventName, err, fallback, extra = {}) {
    // Extract API/context details for richer error reporting
    const status = err?.status || err?.response?.status;
    const detail = err?.detail || err?.response?.data?.detail || err?.response?.detail;
    const endpoint = extra?.endpoint || err?.endpoint || '';
    let errMsg = `[ProjectManager] ${eventName}: ${err.message}`;
    if (status || endpoint || detail) {
      errMsg += ` |`;
      if (endpoint) errMsg += ` endpoint: ${endpoint};`;
      if (status) errMsg += ` HTTP ${status};`;
      if (detail) errMsg += ` detail: ${detail}`;
    }
    this.notify.error(errMsg, {
      group: true,
      context: 'projectManager',
      module: MODULE,
      source: eventName,
      status,
      endpoint,
      detail,
      originalError: err,
      ...extra // Spread all extra context for troubleshooting
    });
    this._emit(eventName, { error: err.message, status, endpoint, detail });
    return fallback;
  }

  /* ---------------------------------------------------------------------- */
  /* Core API: Project List/Details                                         */
  /* ---------------------------------------------------------------------- */

  async loadProjects(filter = 'all') {
    const _t = this.debugTools?.start?.('ProjectManager.loadProjects');
    if (this._loadingProjects) {
      this.notify.info('[ProjectManager] loadProjects already running', { group: true, context: 'projectManager', module: MODULE, source: 'loadProjects' });
      return [];
    }
    if (!this._authOk('projectsLoaded', { filter })) return [];
    this._loadingProjects = true;
    this._emit('projectsLoading', { filter });

    try {
      const url = typeof this.apiEndpoints.PROJECTS === 'function'
        ? this.apiEndpoints.PROJECTS()
        : this.apiEndpoints.PROJECTS || '/api/projects/';
      const urlObj = new URL(url, location.origin);
      urlObj.searchParams.set('filter', filter);

      const res = await this._req(String(urlObj), undefined, "loadProjects");
      const list = extractResourceList(res, ['projects']);
      this.notify.success(`[ProjectManager] ${list.length} projects`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjects', detail: { filter } });
      this._emit('projectsLoaded', { projects: list, filter });
      this.debugTools?.stop?.(_t,'ProjectManager.loadProjects');
      return list;
    } catch (err) {
      this.debugTools?.stop?.(_t,'ProjectManager.loadProjects');
      return this._handleErr('projectsLoaded', err, []);
    } finally {
      this._loadingProjects = false;
      this.debugTools?.stop?.(_t,'ProjectManager.loadProjects');
    }
  }

  async loadProjectDetails(id) {
    const _t = this.debugTools?.start?.('ProjectManager.loadProjectDetails');
    this.pmNotify?.debug?.("[ProjectManager] Entered loadProjectDetails with id", {
      source: "loadProjectDetails",
      extra: { id }
    });
    if (!isValidProjectId(id)) {
      this.pmNotify?.warn?.("[ProjectManager] Invalid projectId, returning early", {
        source: "loadProjectDetails",
        extra: { id }
      });
      this.debugTools?.stop?.(_t,'ProjectManager.loadProjectDetails');
      throw new Error('Invalid projectId');
    }

    // Early authentication and access check
    if (!this.app || !this.app.state || !this.app.state.currentUser) {
      this.pmNotify?.warn?.("[ProjectManager] Missing app state or currentUser, returning early", {
        source: "loadProjectDetails"
      });
      this._emit('projectDetailsError', { error: 'User not authenticated', status: 403 });
      this.debugTools?.stop?.(_t,'ProjectManager.loadProjectDetails');
      return null;
    }

    // NOTE: skip local permission heuristic; always attempt to fetch project details via API
    // (Permission enforcement is handled server-side and will return 403 if unauthorized)

    if (!this._authOk('projectDetailsError', { id })) {
      this.pmNotify?.warn?.("[ProjectManager] _authOk returned false, returning early", {
        source: "loadProjectDetails"
      });
      this.debugTools?.stop?.(_t,'ProjectManager.loadProjectDetails');
      return null;
    }

    const detailUrl = typeof this.apiEndpoints.DETAIL === 'function'
      ? this.apiEndpoints.DETAIL(id)
      : (this.apiEndpoints.DETAIL || '/api/projects/{id}/').replace('{id}', id);
    this.pmNotify?.debug?.("[ProjectManager] Fetching project details from", {
      source: "loadProjectDetails",
      extra: { detailUrl }
    });
    this.currentProject = null;

    try {
      try {
        const detailRes = await this._req(detailUrl, undefined, "loadProjectDetails");
        this.currentProject = normalizeProjectResponse(detailRes);
      } catch (err) {
        // Log full error and response for debugging API issues
        this.pmNotify?.error?.("[ProjectManager] loadProjectDetails error", {
          source: "loadProjectDetails",
          extra: {
            url: detailUrl,
            error: err,
            detailRes: err?.response || err?.data || null
          }
        });
        throw err;
      }
      this._emit('projectLoaded', this.currentProject);

      // Don't continue if archived
      if (this.currentProject.archived) {
        this._emit('projectArchivedNotice', { id: this.currentProject.id });
        this.debugTools?.stop?.(_t,'ProjectManager.loadProjectDetails');
        return { ...this.currentProject };
      }

      // Parallel fetch additional resources (non-fatal on failure)
      const [stats, files, convos, artifacts] = await Promise.allSettled([
        this.loadProjectStats(id),
        this.loadProjectFiles(id),
        this.loadProjectConversations(id),
        this.loadProjectArtifacts(id),
      ]);

      // Track if any critical (first 4) components failed
      const criticalErrors = [stats, files, convos, artifacts]
        .filter(r => r.status === 'rejected')
        .map(r => r.reason);
      if (criticalErrors.length > 0) {
        this.notify.error(
          `[ProjectManager] Some components failed: ${criticalErrors.map(e => e.message).join(', ')}`,
          { group: true, context: 'projectManager', module: MODULE, source: 'loadProjectDetails', detail: { id, failed: criticalErrors } }
        );
        this._emit('projectDetailsLoadError', { id, errors: criticalErrors });
      }
      this.notify.success(`[ProjectManager] Project ${id} ready`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjectDetails', detail: { id } });

      // Notify UI that every required resource is now loaded
      this._emit('projectDetailsFullyLoaded', { projectId: this.currentProject.id });

      this.debugTools?.stop?.(_t,'ProjectManager.loadProjectDetails');
      return { ...this.currentProject };
    } catch (err) {
      // Gather context for troubleshooting
      const userId = this.app?.state?.currentUser?.id || null;
      const status = err?.status || err?.response?.status;
      const endpoint = detailUrl;
      const backendDetail = err?.detail || err?.response?.data?.detail || err?.response?.detail;
      this._handleErr('projectDetailsError', err, null, {
        projectId: id,
        userId,
        status,
        endpoint,
        backendDetail,
        originalError: err
      });
      if (status === 404) this._emit('projectNotFound', { id });
      this.debugTools?.stop?.(_t,'ProjectManager.loadProjectDetails-error');
      return null;
    }
  }
  /**
   * Checks if the user likely has access to the project using local cache.
   * Returns true if project is in user's project list (app.state.currentUser.projects).
   * This is a heuristic and may not reflect true backend permissions.
   * @param {string|number} projectId
   * @returns {boolean}
   */
  _userHasProjectAccess(projectId) {
    const projects = this.app?.state?.currentUser?.projects;
    if (!projects || !Array.isArray(projects)) return false;
    return projects.some(p => String(p.id) === String(projectId));
  }

  /* ---------------------------------------------------------------------- */
  /* Project Subresources                                                   */
  /* ---------------------------------------------------------------------- */

  async loadProjectStats(id) {
    try {
      const res = await this._req(this._CONFIG.STATS.replace('{id}', id), undefined, "loadProjectStats");
      const stats = res?.data ?? {};
      this._emit('projectStatsLoaded', { id, ...stats });
      return stats;
    } catch (err) {
      return this._handleErr('projectStatsError', err, {});
    }
  }
  async loadProjectFiles(id) {
    try {
      const res = await this._req(this._CONFIG.FILES.replace('{id}', id), undefined, "loadProjectFiles");
      const files = extractResourceList(res, ['files', 'file']) ?? [];
      this._emit('projectFilesLoaded', { id, files });
      return files;
    } catch (err) {
      return this._handleErr('projectFilesError', err, []);
    }
  }
  async loadProjectConversations(id) {
    try {
      const res = await this._req(this._CONFIG.CONVOS.replace('{id}', id), undefined, "loadProjectConversations");
      const conversations = extractResourceList(res, ['conversations']) ?? [];
      this._emit('projectConversationsLoaded', { id, conversations });
      return conversations;
    } catch (err) {
      return this._handleErr('projectConversationsError', err, []);
    }
  }
  async loadProjectArtifacts(id) {
    try {
      const res = await this._req(this._CONFIG.ARTIFACTS.replace('{id}', id), undefined, "loadProjectArtifacts");
      const artifacts = extractResourceList(res, ['artifacts']) ?? [];
      this._emit('projectArtifactsLoaded', { id, artifacts });
      return artifacts;
    } catch (err) {
      return this._handleErr('projectArtifactsError', err, []);
    }
  }
  async loadProjectKnowledgeBase(id) {
    try {
      this.notify.info(`[ProjectManager] Loading knowledge base for project ${id}...`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { id } });
      const res = await this._req(this._CONFIG.KB.replace('{id}', id), undefined, "loadProjectKnowledgeBase");
      const kb = res?.data || res;
      if (!kb) {
        this.notify.warn(`[ProjectManager] No knowledge base for: ${id}`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { id } });
        this._emit('projectKnowledgeBaseLoaded', { id, knowledgeBase: null });
      } else {
        this.notify.success(`[ProjectManager] Knowledge base loaded for ${id}: ${kb.id}`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { id } });
        this._emit('projectKnowledgeBaseLoaded', { id, knowledgeBase: kb });
      }
      return kb;
    } catch (err) {
      this._emit('projectKnowledgeBaseLoaded', { id, knowledgeBase: null });
      return this._handleErr('projectKnowledgeBaseError', err, null);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Project Creation/Update/Delete/Archive                                 */
  /* ---------------------------------------------------------------------- */

  async saveProject(id, payload) {
    if (!this._authOk('projectSaveError', { id })) throw new Error('auth');
    const isUpdate = Boolean(id);
    const url = isUpdate ? this._CONFIG.DETAIL.replace('{id}', id) : this._CONFIG.PROJECTS;
    const method = isUpdate ? 'PATCH' : 'POST';

    try {
      const res = await this._req(url, { method, body: payload }, "saveProject");
      const proj = res?.data ?? res;
      this._emit(isUpdate ? 'projectUpdated' : 'projectCreated', proj);
      this.notify.success(
        `[ProjectManager] Project ${isUpdate ? 'updated' : 'created'}: ${proj.id}`,
        { group: true, context: 'projectManager', module: MODULE, source: 'saveProject', endpoint: url, method, detail: { id: proj.id } }
      );
      return proj;
    } catch (err) {
      this._handleErr('projectSaveError', err, null, { method: 'saveProject', endpoint: url });
      throw err;
    }
  }
  async deleteProject(id) {
    if (!this._authOk('projectDeleteError', { id })) throw new Error('auth');
    try {
      await this._req(this._CONFIG.DETAIL.replace('{id}', id), { method: 'DELETE' }, "deleteProject");
      if (this.currentProject?.id === id) this.currentProject = null;
      this._emit('projectDeleted', { id });
      this.notify.success(`[ProjectManager] Project ${id} deleted`, { group: true, context: 'projectManager', module: MODULE, source: 'deleteProject', detail: { id } });
    } catch (err) {
      this._handleErr('projectDeleteError', err, null, { method: 'deleteProject', endpoint: this._CONFIG.DETAIL.replace('{id}', id) });
      throw err;
    }
  }
  async toggleArchiveProject(id) {
    if (!this._authOk('projectArchiveToggled', { id })) throw new Error('auth');
    try {
      const res = await this._req(this._CONFIG.ARCHIVE.replace('{id}', id), { method: "PATCH" }, "toggleArchiveProject");
      this._emit('projectArchiveToggled', { id, archived: res?.archived ?? !this.currentProject?.archived });
      this.notify.success(`[ProjectManager] Project ${id} archive toggled`, { group: true, context: 'projectManager', module: MODULE, source: 'toggleArchiveProject', detail: { id, archived: res?.archived } });
      return res;
    } catch (err) {
      this._handleErr('projectArchiveToggled', err, null, { method: 'toggleArchiveProject', endpoint: this._CONFIG.ARCHIVE.replace('{id}', id) });
      throw err;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Chat/Conversation Delegations                                          */
  /* ---------------------------------------------------------------------- */

  async createConversation(projectId, opts = {}) {
    try {
      this.storage.setItem?.('selectedProjectId', projectId);
      return await this.chatManager.createNewConversation(projectId, opts);
    } catch (err) {
      this._handleErr('conversationCreateError', err, null, { source: 'createConversation', detail: { projectId } });
      throw err;
    }
  }
  async getConversation(conversationId) {
    if (!this._authOk('conversationLoadError', { conversationId })) throw new Error('auth');
    const projectId = this.currentProject?.id;
    if (!isValidProjectId(projectId)) {
      this.notify.error('[ProjectManager] No valid current project ID', { group: true, context: 'projectManager', module: MODULE, source: 'getConversation' });
      throw new Error('No valid project context');
    }
    try {
      const endpoint = `/api/projects/${projectId}/conversations/${conversationId}/`;
      const res = await this._req(endpoint, undefined, "getConversation");
      const convo = res?.data || res;
      if (!convo || !convo.id) throw new Error('Invalid conversation data received');
      this.notify.info(`[ProjectManager] Conversation ${conversationId} fetched.`, { group: true, context: 'projectManager', module: MODULE, source: 'getConversation', detail: { conversationId, projectId } });
      return convo;
    } catch (err) {
      this._handleErr(`conversationLoadError`, err, null, { source: 'getConversation', detail: { conversationId, projectId } });
      throw err;
    }
  }
  async deleteProjectConversation(projectId, conversationId) {
    try {
      this.storage.setItem?.('selectedProjectId', projectId);
      await this.chatManager.deleteConversation(conversationId);
      this.notify.success(`[ProjectManager] Conversation ${conversationId} deleted`, { group: true, context: 'projectManager', module: MODULE, source: 'deleteProjectConversation', detail: { conversationId, projectId } });
      return true;
    } catch (err) {
      this._handleErr('deleteProjectConversationError', err, null, { source: 'deleteProjectConversation', detail: { conversationId, projectId } });
      throw err;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* File Handling                                                          */
  /* ---------------------------------------------------------------------- */

  getCurrentProject() {
    return this.currentProject ? JSON.parse(JSON.stringify(this.currentProject)) : null;
  }
  setCurrentProject(project) {
    if (!project || !project.id) {
      this.notify.error('[ProjectManager] Cannot set invalid project as current', { group: true, context: 'projectManager', module: MODULE, source: 'setCurrentProject' });
      return;
    }
    const previous = this.currentProject;
    this.currentProject = project;
    this.storage?.setItem?.('selectedProjectId', project.id);
    this._emit('currentProjectChanged', { project, previousProject: previous });
    return project;
  }
  async prepareFileUploads(projectId, fileList) {
    const validatedFiles = [];
    const invalidFiles = [];
    for (const file of fileList) {
      if (file.size > 30_000_000) {
        invalidFiles.push({ file, reason: 'Max size exceeded (30MB)' });
      } else validatedFiles.push({ file });
    }
    return { validatedFiles, invalidFiles };
  }
  async uploadFileWithRetry(projectId, { file }, maxRetries = 3) {
    return retryWithBackoff(async () => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('projectId', projectId);
      await this._req(`/api/projects/${projectId}/files/`, {
        method: 'POST',
        body: formData
      }, "uploadFileWithRetry");
      this.notify.success(`[ProjectManager] File uploaded for project ${projectId}`, { group: true, context: 'projectManager', module: MODULE, source: 'uploadFileWithRetry', detail: { projectId, fileName: file.name } });
      return true;
    }, maxRetries, this.timer);
  }

  /* ---------------------------------------------------------------------- */
  /* Additional Project Creation Helpers (Ensured Conversation, KB, etc)     */
  /* ---------------------------------------------------------------------- */

  async createProject(projectData) {
    try {
      const response = await this._req(this._CONFIG.PROJECTS, {
        method: 'POST',
        body: projectData
      }, "createProject");
      const project = response.data || response;
      if (!project || !project.id) throw new Error('Invalid project response');
      this.notify.success('[ProjectManager] Project created: ' + project.id, { group: true, context: 'projectManager', module: MODULE, source: 'createProject' });
      const ensureConversation = async () => {
        const hasConvo = (Array.isArray(project.conversations) && project.conversations.length > 0)
          || Number(project.conversation_count) > 0;
        if (hasConvo) return project.conversations?.[0];
        return await this.createDefaultConversation(project.id);
      };
      const conversation = await ensureConversation();
      if (conversation) {
        project.conversations = [conversation];
        project.conversation_count = 1;
      }
      this._emit('projectCreated', project);
      this._emit('projectConversationsLoaded', { id: project.id, conversations: project.conversations });
      return project;
    } catch (err) {
      // Extract more context for error notification
      const endpoint = this._CONFIG.PROJECTS;
      const status = err?.status || err?.response?.status;
      const detail = err?.detail || err?.response?.data?.detail || err?.response?.detail;
      let message = '[ProjectManager] Error creating project: ' + (err?.message || err);
      if (status || detail) {
        message += ` |`;
        if (status) message += ` HTTP ${status};`;
        if (detail) message += ` detail: ${detail}`;
      }
      this.notify.error(message, { context: "projectManager", group: true, module: MODULE, source: "createProject", endpoint, status, detail, originalError: err });
      throw err;
    }
  }
  async createDefaultConversation(projectId) {
    try {
      const response = await this._req(
        `/api/projects/${projectId}/conversations/`,
        {
          method: 'POST',
          body: {
            title: 'Default Conversation',
            model_id: this.modelConfig?.getConfig?.()?.modelName || 'claude-3-sonnet-20240229'
          }
        }, "createDefaultConversation"
      );
      const conversation =
        response?.data?.conversation ||
        response?.data ||
        response?.conversation ||
        response;
      if (!conversation || !conversation.id) throw new Error('Failed to create default conversation');
      this.notify.success('[ProjectManager] Default conversation created: ' + conversation.id, { group: true, context: 'projectManager', module: MODULE, source: 'createDefaultConversation', detail: { projectId, conversationId: conversation.id } });
      return conversation;
    } catch (err) {
      this.notify.error('[ProjectManager] Failed to create default conversation: ' + (err?.message || err), { group: true, context: 'projectManager', module: MODULE, source: 'createDefaultConversation', detail: { projectId }, originalError: err });
      return null;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* General retry utility                                                  */
  /* ---------------------------------------------------------------------- */
  async retryWithBackoff(fn, maxRetries = 3) {
    return retryWithBackoff(fn, maxRetries, this.timer);
  }

  /* ---------------------------------------------------------------------- */
  /* Required DI lifecycle method: initialize                               */
  /* ---------------------------------------------------------------------- */
  /**
   * Initializes the ProjectManager (DI contract).
   * Ensures compatibility with orchestrator/module loader.
   * Returns a resolved promise immediately.
   * @returns {Promise<boolean>}
   */
  async initialize() {
    this.notify.info('[ProjectManager] initialize() called', { group: true, context: 'projectManager', module: MODULE, source: 'initialize' });

    emitReady({ notify: this.notify }, MODULE);

    /* ---- external coordination hook ---- */
    // Consumers can now wait for “projectManagerReady”.
    this._emit('projectManagerReady', { success: true });

    return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Factory export – always returns a NEW instance                              */
/* -------------------------------------------------------------------------- */

export function createProjectManager(deps = {}) {
  if (!deps.DependencySystem) {
    const msg = '[createProjectManager] DependencySystem missing: Did you forget to inject it via DI?';
    // Use notification system instead of console.error
    if (deps.notify) {
      deps.notify.error(msg, {
        group: true,
        context: 'projectManager',
        module: MODULE,
        source: 'createProjectManager',
        extra: { deps }
      });
    } else if (deps.notificationHandler?.show) {
      deps.notificationHandler.show(msg, 'error', 0, {
        group: true,
        context: 'projectManager',
        module: MODULE,
        source: 'createProjectManager',
        extra: { deps }
      });
    }
    throw new Error(msg);
  }
  try {
    return new ProjectManager({ ...deps, debugTools: deps.debugTools || deps.DependencySystem.modules.get('debugTools') });
  } catch (err) {
    const diag = `[createProjectManager] Construction failed: ${err && err.message ? err.message : err}`;
    // Use notification system instead of console.error
    if (deps.notify) {
      deps.notify.error(diag, {
        group: true,
        context: 'projectManager',
        module: MODULE,
        source: 'createProjectManager',
        extra: { deps, error: err }
      });
    } else if (deps.notificationHandler?.show) {
      deps.notificationHandler.show(diag, 'error', 0, {
        group: true,
        context: 'projectManager',
        module: MODULE,
        source: 'createProjectManager',
        extra: { deps, error: err }
      });
    }
    throw new Error(diag);
  }
}

export { isValidProjectId, extractResourceList, normalizeProjectResponse, retryWithBackoff };
export default createProjectManager;
