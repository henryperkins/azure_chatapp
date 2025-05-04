/**
 * projectManager.js – DI-strict, Notification-aware, Advanced Edition
 *
 * Combines:
 *  - Modern DI/notification patterns from Untitled 4
 *  - Full feature set from projectManager (file upload, KB, archive, etc)
 */

/* -------------------------------------------------------------------------- */
/* Local utility helpers – pure and safe to unit-test                         */
/* -------------------------------------------------------------------------- */

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
    if (!DependencySystem) throw new Error('DependencySystem required');
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
        info: (m, o = {}) => h.show(m, 'info', 4000, { ...o, group: true, context: 'projectManager' }),
        success: (m, o = {}) => h.show(m, 'success', 4000, { ...o, group: true, context: 'projectManager' }),
        warn: (m, o = {}) => h.show(m, 'warning', 6000, { ...o, group: true, context: 'projectManager' }),
        error: (m, o = {}) => h.show(m, 'error', 0, { ...o, group: true, context: 'projectManager' }),
      };
    }
    if (!this.notify) throw new Error('notify util or notificationHandler missing');

    // Listener tracking
    if (!listenerTracker) {
      const ev = DependencySystem.modules.get('eventHandlers');
      if (!ev?.trackListener) throw new Error('eventHandlers.trackListener missing');
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

    this.notify.info('[ProjectManager] Initialized');
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  _emit(event, detail) {
    document.dispatchEvent(new CustomEvent(event, { detail }));
  }
  _authOk(failEvent, extraDetail = {}) {
    if (this.app?.state?.isAuthenticated) return true;
    this.notify.warn('[ProjectManager] Auth required');
    this._emit(failEvent, { error: 'auth_required', ...extraDetail });
    return false;
  }
  _handleErr(eventName, err, fallback) {
    this.notify.error(`[ProjectManager] ${eventName}: ${err.message}`, { context: "projectManager", group: true });
    this._emit(eventName, { error: err.message });
    return fallback;
  }

  /* ---------------------------------------------------------------------- */
  /* Core API: Project List/Details                                         */
  /* ---------------------------------------------------------------------- */

  async loadProjects(filter = 'all') {
    if (this._loadingProjects) {
      this.notify.info('[ProjectManager] loadProjects already running');
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
      this.notify.success(`[ProjectManager] ${list.length} projects`);
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
        this.notify.error(`[ProjectManager] Some components failed: ${criticalErrors.map(e => e.message).join(', ')}`, { context: "projectManager", group: true });
        this._emit('projectDetailsLoadError', { id, errors: criticalErrors });
      }
      this.notify.success(`[ProjectManager] Project ${id} ready`);
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
      this.notify.info(`[ProjectManager] Loading knowledge base for project ${id}...`);
      const res = await this.app.apiRequest(this._CONFIG.KB.replace('{id}', id));
      const kb = res?.data || res;
      if (!kb) {
        this.notify.warn(`[ProjectManager] No knowledge base for: ${id}`);
        this._emit('projectKnowledgeBaseLoaded', { id, knowledgeBase: null });
      } else {
        this.notify.success(`[ProjectManager] Knowledge base loaded for ${id}: ${kb.id}`);
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
      this.notify.success(`[ProjectManager] Project ${isUpdate ? 'updated' : 'created'}: ${proj.id}`);
      return proj;
    } catch (err) {
      this._handleErr('projectSaveError', err, null);
      throw err;
    }
  }
  async deleteProject(id) {
    if (!this._authOk('projectDeleteError', { id })) throw new Error('auth');
    try {
      await this.app.apiRequest(this._CONFIG.DETAIL.replace('{id}', id), { method: 'DELETE' });
      if (this.currentProject?.id === id) this.currentProject = null;
      this._emit('projectDeleted', { id });
      this.notify.success(`[ProjectManager] Project ${id} deleted`);
    } catch (err) {
      this._handleErr('projectDeleteError', err);
      throw err;
    }
  }
  async toggleArchiveProject(id) {
    if (!this._authOk('projectArchiveToggled', { id })) throw new Error('auth');
    try {
      const res = await this.app.apiRequest(this._CONFIG.ARCHIVE.replace('{id}', id), { method: "PATCH" });
      this._emit('projectArchiveToggled', { id, archived: res?.archived ?? !this.currentProject?.archived });
      return res;
    } catch (err) {
      this._handleErr('projectArchiveToggled', err);
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
      this._handleErr('conversationCreateError', err);
      throw err;
    }
  }
  async getConversation(conversationId) {
    if (!this._authOk('conversationLoadError', { conversationId })) throw new Error('auth');
    const projectId = this.currentProject?.id;
    if (!isValidProjectId(projectId)) {
      this.notify.error('[ProjectManager] No valid current project ID', { context: "projectManager", group: true });
      throw new Error('No valid project context');
    }
    try {
      const endpoint = `/api/projects/${projectId}/conversations/${conversationId}/`;
      const res = await this.app.apiRequest(endpoint);
      const convo = res?.data || res;
      if (!convo || !convo.id) throw new Error('Invalid conversation data received');
      this.notify.info(`[ProjectManager] Conversation ${conversationId} fetched.`);
      return convo;
    } catch (err) {
      this._handleErr(`conversationLoadError`, err, null);
      throw err;
    }
  }
  async deleteProjectConversation(projectId, conversationId) {
    try {
      this.storage.setItem?.('selectedProjectId', projectId);
      await this.chatManager.deleteConversation(conversationId);
      return true;
    } catch (err) {
      this._handleErr('deleteProjectConversationError', err);
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
      this.notify.error('[ProjectManager] Cannot set invalid project as current', { context: "projectManager", group: true });
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
      this.notify.success('[ProjectManager] Project created: ' + project.id);
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
      this.notify.error('[ProjectManager] Error creating project: ' + (err?.message || err), { context: "projectManager", group: true });
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
      this.notify.success('[ProjectManager] Default conversation created: ' + conversation.id);
      return conversation;
    } catch (err) {
      this.notify.error('[ProjectManager] Failed to create default conversation: ' + (err?.message || err), { context: "projectManager", group: true });
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
  if (!deps.DependencySystem) throw new Error('DependencySystem missing');
  return new ProjectManager(deps);
}

export { isValidProjectId, extractResourceList, normalizeProjectResponse, retryWithBackoff };
export default createProjectManager;
