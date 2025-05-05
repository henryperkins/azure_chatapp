/**
 * projectManager.js – DI-strict, Notification-aware, Advanced Edition (context-rich notifications)
 *
 * Combines:
 *  - Modern DI/notification patterns from Untitled 4
 *  - Full feature set from projectManager (file upload, KB, archive, etc)
 *  - Notification calls always emit context/module/source/module for end-to-end traceability
 */

/* -------------------------------------------------------------------------- */
/* Local utility helpers – pure and safe to unit-test                         */
/* -------------------------------------------------------------------------- */

const MODULE = "ProjectManager";

function isValidProjectId(id) {
  return typeof id === 'string' && /^[0-9a-f-]{32,36}$/i.test(id ?? '');
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
    try { return await fn(); }
    catch (err) {
      if (++attempt > maxRetries) throw err;
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
  } = {}) {
    if (!DependencySystem) {
      if (notify) notify.error('[ProjectManager] DependencySystem required', { group: true, context: 'projectManager', module: MODULE, source: 'constructor' });
      throw new Error('DependencySystem required');
    }
    this.app = app ?? DependencySystem.modules.get('app');
    this.chatManager = chatManager ?? DependencySystem.modules.get('chatManager');
    this.modelConfig = modelConfig ?? DependencySystem.modules.get('modelConfig');
    this.notify = notify ?? DependencySystem.modules.get?.('notify');
    this.timer = timer;
    this.storage = storage;

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
    this._CONFIG = Object.freeze({
      PROJECTS: '/api/projects/',
      DETAIL: '/api/projects/{id}/',
      FILES: '/api/projects/{id}/files/',
      CONVOS: '/api/projects/{id}/conversations/',
      STATS: '/api/projects/{id}/stats/',
      ARTIFACTS: '/api/projects/{id}/artifacts/',
      KB: '/api/projects/{id}/knowledge-bases/',
      ARCHIVE: '/api/projects/{id}/archive',
    });

    this.notify.info('[ProjectManager] Initialized', { group: true, context: 'projectManager', module: MODULE, source: 'constructor' });
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  _emit(event, detail) {
    document.dispatchEvent(new CustomEvent(event, { detail }));
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
      extra
    });
    this._emit(eventName, { error: err.message, status, endpoint, detail });
    return fallback;
  }

  /* ---------------------------------------------------------------------- */
  /* Core API: Project List/Details                                         */
  /* ---------------------------------------------------------------------- */

  async loadProjects(filter = 'all') {
    if (this._loadingProjects) {
      this.notify.info('[ProjectManager] loadProjects already running', { group: true, context: 'projectManager', module: MODULE, source: 'loadProjects' });
      return [];
    }
    if (!this._authOk('projectsLoaded', { filter })) return [];
    this._loadingProjects = true;
    this._emit('projectsLoading', { filter });

    try {
      const url = new URL(this._CONFIG.PROJECTS, location.origin);
      url.searchParams.set('filter', filter);

      const res = await this.app.apiRequest(String(url));
      const list = extractResourceList(res, ['projects']);
      this.notify.success(`[ProjectManager] ${list.length} projects`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjects', detail: { filter } });
      this._emit('projectsLoaded', { projects: list, filter });
      return list;
    } catch (err) {
      return this._handleErr('projectsLoaded', err, []);
    } finally {
      this._loadingProjects = false;
    }
  }

  async loadProjectDetails(id) {
    if (!isValidProjectId(id)) throw new Error('Invalid projectId');
    if (!this._authOk('projectDetailsError', { id })) return null;

    const detailUrl = this._CONFIG.DETAIL.replace('{id}', id);
    this.currentProject = null;

    try {
      const detailRes = await this.app.apiRequest(detailUrl);
      this.currentProject = normalizeProjectResponse(detailRes);
      this._emit('projectLoaded', this.currentProject);

      // Don't continue if archived
      if (this.currentProject.archived) {
        this._emit('projectArchivedNotice', { id: this.currentProject.id });
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
      return { ...this.currentProject };
    } catch (err) {
      this._handleErr('projectDetailsError', err, null);
      if (err.status === 404) this._emit('projectNotFound', { id });
      return null;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Project Subresources                                                   */
  /* ---------------------------------------------------------------------- */

  async loadProjectStats(id) {
    try {
      const res = await this.app.apiRequest(this._CONFIG.STATS.replace('{id}', id));
      const stats = res?.data ?? {};
      this._emit('projectStatsLoaded', { id, ...stats });
      return stats;
    } catch (err) {
      return this._handleErr('projectStatsError', err, {});
    }
  }
  async loadProjectFiles(id) {
    try {
      const res = await this.app.apiRequest(this._CONFIG.FILES.replace('{id}', id));
      const files = extractResourceList(res, ['files', 'file']) ?? [];
      this._emit('projectFilesLoaded', { id, files });
      return files;
    } catch (err) {
      return this._handleErr('projectFilesError', err, []);
    }
  }
  async loadProjectConversations(id) {
    try {
      const res = await this.app.apiRequest(this._CONFIG.CONVOS.replace('{id}', id));
      const conversations = extractResourceList(res, ['conversations']) ?? [];
      this._emit('projectConversationsLoaded', { id, conversations });
      return conversations;
    } catch (err) {
      return this._handleErr('projectConversationsError', err, []);
    }
  }
  async loadProjectArtifacts(id) {
    try {
      const res = await this.app.apiRequest(this._CONFIG.ARTIFACTS.replace('{id}', id));
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
      const res = await this.app.apiRequest(this._CONFIG.KB.replace('{id}', id));
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
      const res = await this.app.apiRequest(url, { method, body: payload });
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
      await this.app.apiRequest(this._CONFIG.DETAIL.replace('{id}', id), { method: 'DELETE' });
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
      const res = await this.app.apiRequest(this._CONFIG.ARCHIVE.replace('{id}', id), { method: "PATCH" });
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
      const res = await this.app.apiRequest(endpoint);
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
      await this.app.apiRequest(`/api/projects/${projectId}/files/`, {
        method: 'POST',
        body: formData
      });
      this.notify.success(`[ProjectManager] File uploaded for project ${projectId}`, { group: true, context: 'projectManager', module: MODULE, source: 'uploadFileWithRetry', detail: { projectId, fileName: file.name } });
      return true;
    }, maxRetries, this.timer);
  }

  /* ---------------------------------------------------------------------- */
  /* Additional Project Creation Helpers (Ensured Conversation, KB, etc)     */
  /* ---------------------------------------------------------------------- */

  async createProject(projectData) {
    try {
      const response = await this.app.apiRequest(this._CONFIG.PROJECTS, {
        method: 'POST',
        body: projectData
      });
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
      const response = await this.app.apiRequest(
        `/api/projects/${projectId}/conversations/`, {
        method: 'POST',
        body: {
          title: 'Default Conversation',
          model_id: this.modelConfig?.getConfig?.()?.modelName || 'claude-3-sonnet-20240229'
        }
      }
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
    // If you need to preload projects or state at startup, do it here in future.
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Factory export – always returns a NEW instance                              */
/* -------------------------------------------------------------------------- */

export function createProjectManager(deps = {}) {
  if (!deps.DependencySystem) {
    const msg = '[createProjectManager] DependencySystem missing: Did you forget to inject it via DI?';
    if (typeof console !== 'undefined') {
      console.error(msg, { deps });
    }
    throw new Error(msg);
  }
  try {
    return new ProjectManager(deps);
  } catch (err) {
    const diag = `[createProjectManager] Construction failed: ${err && err.message ? err.message : err}`;
    if (typeof console !== 'undefined') {
      console.error(diag, { deps, error: err });
    }
    throw new Error(diag);
  }
}

export { isValidProjectId, extractResourceList, normalizeProjectResponse, retryWithBackoff };
export default createProjectManager;
