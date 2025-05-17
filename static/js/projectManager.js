
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
      if (err && err.status && ((err.status >= 400 && err.status < 500 && err.status !== 429) || err.status === 405)) {
        throw err;
      }
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
    listenerTracker = null,
    timer = typeof setTimeout === 'function' ? setTimeout : (cb) => cb(),
    storage = { setItem: () => { }, getItem: () => null },
    apiEndpoints,
    apiRequest = null,
    browserService = null,
    domReadinessService,
    domAPI = null
  } = {}) {
    if (!DependencySystem) {
      throw new Error('DependencySystem required');
    }

    this.DependencySystem = DependencySystem;        // ← NUEVA línea

    if (!apiEndpoints) {
      throw new Error('apiEndpoints required');
    }

    if (!domReadinessService)
      throw new Error('[ProjectManager] domReadinessService DI is required');
    this.domReadinessService = domReadinessService;

    this.app = app ?? DependencySystem.modules.get('app');
    this.chatManager = chatManager ?? DependencySystem.modules.get('chatManager');
    this.modelConfig = modelConfig ?? DependencySystem.modules.get('modelConfig');
    this.timer = timer;
    this.storage = storage;
    this.apiRequest = apiRequest ?? app?.apiRequest;
    this.browserService = browserService ?? DependencySystem.modules.get?.('browserService') ?? null;
    this.domAPI       = domAPI ?? DependencySystem.modules.get('domAPI') ?? null;

    // Helper to await app readiness
    // Wait for the central `'app:ready'` event emitted by app.js.
    // The previous 10 s default proved too short on slower devices,
    // causing premature time-outs.  Increase to 30 s (configurable later).
    this._awaitAppReady = async () =>
      this.domReadinessService.waitForEvent('app:ready', {
        deps: ['app'],
        timeout: 30000, // ← bumped up from default 10 000 ms
        context: MODULE + '_awaitAppReady'
      });

    // Listener tracking
    if (!listenerTracker) {
      const ev = DependencySystem.modules.get('eventHandlers');
      if (!ev?.trackListener) {
        throw new Error('eventHandlers.trackListener missing');
      }
      listenerTracker = {
        add: (t, e, h, dsc) => ev.trackListener(t, e, h, { description: dsc, context: MODULE }),
        remove: () => ev.cleanupListeners?.({ context: MODULE }),
      };
    }
    this.listenerTracker = listenerTracker;

    // ELIMINATE local project state; always use app
    this._loadingProjects = false;
    this._loadProjectsDebounceTimer = null;
    this._DEBOUNCE_DELAY = 300;

    this.apiEndpoints = apiEndpoints;
    this._CONFIG = {
      PROJECTS: apiEndpoints.PROJECTS || '/api/projects/',
      DETAIL: apiEndpoints.DETAIL || '/api/projects/{id}/',
      STATS: apiEndpoints.STATS || '/api/projects/{id}/stats/',
      FILES: apiEndpoints.FILES || '/api/projects/{id}/files/',
      CONVOS: apiEndpoints.CONVOS || '/api/projects/{id}/conversations/',
      ARTIFACTS: apiEndpoints.ARTIFACTS || '/api/projects/{id}/artifacts/',
      KB_LIST_URL_TEMPLATE: apiEndpoints.KB_LIST_URL_TEMPLATE || '/api/projects/{id}/knowledge-bases/',
      KB_DETAIL_URL_TEMPLATE: apiEndpoints.KB_DETAIL_URL_TEMPLATE || '/api/projects/{id}/knowledge-bases/{kb_id}/',
      ARCHIVE: apiEndpoints.ARCHIVE || '/api/projects/{id}/archive/',
      FILE_DETAIL        : apiEndpoints.FILE_DETAIL        || '/api/projects/{id}/files/{file_id}/',
      FILE_DOWNLOAD      : apiEndpoints.FILE_DOWNLOAD      || '/api/projects/{id}/files/{file_id}/download/',
      ARTIFACT_DOWNLOAD  : apiEndpoints.ARTIFACT_DOWNLOAD  || '/api/projects/{id}/artifacts/{artifact_id}/download/',
    };
  }

  async _req(url, opts = {}) {
    if (typeof this.apiRequest !== 'function')
      throw new Error('[ProjectManager] apiRequest missing');
    return this.apiRequest(url, opts);
  }

  _emit(event, detail) {
    if (!this.domAPI?.dispatchEvent || !this.domAPI?.getDocument) return;
    const doc = this.domAPI.getDocument();
    if (doc) this.domAPI.dispatchEvent(doc, new CustomEvent(event, { detail }));
  }
  _authOk(failEvent, extraDetail = {}) {
    // 1º: estado canónico de la app
    if (this.app?.state?.isAuthenticated) return true;

    // 2º: fallback – consultar módulo auth por si app.state aún no se ha actualizado
    const auth = this.DependencySystem?.modules?.get?.('auth');
    if (auth?.isAuthenticated?.()) return true;

    // 3º: no autenticado → emitir evento de fallo
    this._emit(failEvent, { error: 'auth_required', ...extraDetail });
    return false;
  }
  _handleErr(eventName, err, fallback, extra = {}) {
    this._emit(eventName, { error: err?.message, ...extra });
    return fallback;
  }

  async loadProjects(filter = 'all') {
    if (this._loadProjectsDebounceTimer) {
      clearTimeout(this._loadProjectsDebounceTimer);
    }
    return new Promise((resolve) => {
      this._loadProjectsDebounceTimer = this.timer.call(null, async () => {
        if (this._loadingProjects) {
          resolve(this.projects || []);
          return;
        }
        if (!this._authOk('projectsLoaded', { filter })) {
          resolve([]);
          return;
        }
        this._loadingProjects = true;
        this._emit('projectsLoading', { filter });
        try {
          let baseUrl = typeof this.apiEndpoints.USER_PROJECTS === 'function' // Check USER_PROJECTS function
            ? this.apiEndpoints.USER_PROJECTS()
            : this.apiEndpoints.USER_PROJECTS || // Then direct USER_PROJECTS string
              (typeof this.apiEndpoints.PROJECTS === 'function' // Then fallback to PROJECTS function
                ? this.apiEndpoints.PROJECTS()
                : this.apiEndpoints.PROJECTS || this._CONFIG.PROJECTS); // Then fallback to PROJECTS string or _CONFIG.PROJECTS
          if (typeof baseUrl === 'string' && !baseUrl.endsWith('/') && !baseUrl.includes('?')) {
            baseUrl += '/';
          }
          const origin = this.browserService?.getLocation?.().origin || '';
          const urlObj = new URL(baseUrl, origin);
          urlObj.searchParams.set('filter', filter);
          const res = await this._req(String(urlObj), undefined, "loadProjects");
          const list = extractResourceList(res, ['projects']);
          this.projects = list;
          this._emit('projectsLoaded', { projects: list, filter });
          resolve(list);
        } catch (err) {
          resolve(this._handleErr('projectsLoaded', err, []));
        } finally {
          this._loadingProjects = false;
        }
      }, this._DEBOUNCE_DELAY);
    });
  }

  async loadProjectDetails(id) {
    if (!isValidProjectId(id)) {
      throw new Error('Invalid projectId');
    }
    if (!this.app || !this.app.state || !this.app.state.currentUser) {
      this._emit('projectDetailsError', { error: 'User not authenticated', status: 403 });
      return null;
    }
    if (!this._authOk('projectDetailsError', { id })) {
      return null;
    }
    let detailUrlTemplate = typeof this.apiEndpoints.DETAIL === 'function'
      ? null
      : String(this.apiEndpoints.DETAIL || this._CONFIG.DETAIL);
    let detailUrl;
    if (detailUrlTemplate) {
      if (detailUrlTemplate.includes('{id}') &&
          !detailUrlTemplate.endsWith('/') &&
          detailUrlTemplate.substring(detailUrlTemplate.indexOf('{id}') + '{id}'.length).length === 0) {
        detailUrlTemplate += '/';
      }
      detailUrl = detailUrlTemplate.replace('{id}', id);
    } else if (typeof this.apiEndpoints.DETAIL === 'function') {
      detailUrl = this.apiEndpoints.DETAIL(id);
    } else {
      throw new Error('Invalid DETAIL endpoint configuration');
    }
    // Remove old: this.currentProject = null;

    try {
      let currentProjectObj;
      const detailRes = await this._req(detailUrl, undefined, "loadProjectDetails");
      currentProjectObj = normalizeProjectResponse(detailRes);
      this.app.setCurrentProject(currentProjectObj);
      this._emit('projectLoaded', currentProjectObj);

      if (currentProjectObj.archived) {
        this._emit('projectArchivedNotice', { id: currentProjectObj.id });
        return { ...currentProjectObj };
      }

      let kbLoadResult = { status: 'fulfilled', value: null };
      if (currentProjectObj && currentProjectObj.knowledge_base_id) {
        try {
          const kbValue = await this.loadProjectKnowledgeBase(currentProjectObj.id, currentProjectObj.knowledge_base_id);
          kbLoadResult = { status: 'fulfilled', value: kbValue };
        } catch (kbError) {
          kbLoadResult = { status: 'rejected', reason: kbError };
        }
      } else {
        this._emit('projectKnowledgeBaseLoaded', { id, knowledgeBase: null });
      }

      const otherResourcesPromises = [
        this.loadProjectStats(id),
        this.loadProjectFiles(id),
        this.loadProjectConversations(id),
        this.loadProjectArtifacts(id),
      ];
      const otherResults = await Promise.allSettled(otherResourcesPromises);
      const [stats, files, convos, artifacts] = otherResults;

      const allResults = [kbLoadResult, stats, files, convos, artifacts];
      const criticalErrors = allResults
        .filter(r => r.status === 'rejected')
        .map(r => r.reason);

      if (criticalErrors.length > 0) {
        this._emit('projectDetailsLoadError', { id, errors: criticalErrors });
      }

      this._emit('projectDetailsFullyLoaded', { projectId: currentProjectObj.id });

      return { ...currentProjectObj };
    } catch (err) {
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
      return null;
    }
  }

  async loadProjectKnowledgeBase(projectId, knowledgeBaseId) {
    if (!knowledgeBaseId) {
      this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: null });
      return null;
    }
    try {
      const url = this._CONFIG.KB_DETAIL_URL_TEMPLATE
        .replace('{id}', projectId)
        .replace('{kb_id}', knowledgeBaseId);
      const res = await this._req(url, undefined, "loadProjectKnowledgeBase");
      const kb = res?.data || res;
      if (!kb || !kb.id) {
        this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: null });
        return null;
      } else {
        this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: kb });
        return kb;
      }
    } catch (err) {
      this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: null });
      throw err;
    }
  }

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

  async saveProject(id, payload) {
    if (!this._authOk('projectSaveError', { id })) throw new Error('auth');
    const isUpdate = Boolean(id);
    const url = isUpdate ? this._CONFIG.DETAIL.replace('{id}', id) : this._CONFIG.PROJECTS;
    const method = isUpdate ? 'PATCH' : 'POST';

    try {
      const res = await this._req(url, { method, body: payload }, "saveProject");
      const proj = res?.data ?? res;
      this._emit(isUpdate ? 'projectUpdated' : 'projectCreated', proj);
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
      return res;
    } catch (err) {
      this._handleErr('projectArchiveToggled', err, null, { method: 'toggleArchiveProject', endpoint: this._CONFIG.ARCHIVE.replace('{id}', id) });
      throw err;
    }
  }

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
      throw new Error('No valid project context');
    }
    try {
      const endpoint = `/api/projects/${projectId}/conversations/${conversationId}/`;
      const res = await this._req(endpoint, undefined, "getConversation");
      const convo = res?.conversation;
      if (!convo || !convo.id) throw new Error('Invalid conversation data received');
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
      return true;
    } catch (err) {
      this._handleErr('deleteProjectConversationError', err, null, { source: 'deleteProjectConversation', detail: { conversationId, projectId } });
      throw err;
    }
  }

  async getCurrentProject() {
    await this._awaitAppReady();
    return this.app && typeof this.app.getCurrentProject === 'function'
      ? this.app.getCurrentProject()
      : null;
  }
  async setCurrentProject(project) {
    if (!project || !project.id) {
      return;
    }
    await this._awaitAppReady();
    this.storage?.setItem?.('selectedProjectId', project.id);
    if (this.app && typeof this.app.setCurrentProject === 'function') {
      this.app.setCurrentProject(project);
    }
    // Optionally emit here as well
    this._emit('currentProjectChanged', { project });
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
    return retryWithBackoff(
      async () => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId);
        await this._req(`/api/projects/${projectId}/files/`, {
          method: 'POST',
          body: formData
        }, "uploadFileWithRetry");
        return true;
      },
      maxRetries,
      this.timer
    );
  }

  /* ---------- NUEVAS utilidades de ficheros / artefactos ---------- */
  async deleteFile(projectId, fileId) {
    if (!this._authOk('projectFileDeleteError', { projectId, fileId })) throw new Error('auth');
    const url = this._CONFIG.FILE_DETAIL.replace('{id}', projectId).replace('{file_id}', fileId);
    return this._req(url, { method: 'DELETE' }, 'deleteFile');
  }

  async downloadFile(projectId, fileId) {
    const url = this._CONFIG.FILE_DOWNLOAD.replace('{id}', projectId).replace('{file_id}', fileId);
    return this._req(url, undefined, 'downloadFile');
  }

  async downloadArtifact(projectId, artifactId) {
    const url = this._CONFIG.ARTIFACT_DOWNLOAD
      .replace('{id}', projectId)
      .replace('{artifact_id}', artifactId);
    return this._req(url, undefined, 'downloadArtifact');
  }

  async createProject(projectData) {
    const response = await this._req(this._CONFIG.PROJECTS, {
      method: 'POST',
      body: projectData
    }, "createProject");
    const project = response.data || response;
    if (!project || !project.id) throw new Error('Invalid project response');
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
      return conversation;
    } catch (err) {
      return null;
    }
  }

  async retryWithBackoff(fn, maxRetries = 3) {
    return retryWithBackoff(fn, maxRetries, this.timer);
  }

  async initialize() { return true; }

  destroy() {
    this.listenerTracker?.remove?.();
  }
}

/* -------------------------------------------------------------------------- */
/* Readiness Gate wrapper                                                     */
/* -------------------------------------------------------------------------- */

function _readyWrapper(deps) {
  if (!deps.DependencySystem) {
    throw new Error('[ProjectManager] DependencySystem must be injected—no global fallback permitted.');
  }
  return Promise.resolve(
    deps.DependencySystem.waitFor?.(['app'])
  ).then(() => {
    const instance = new ProjectManager(deps);
    deps.DependencySystem?.register?.('projectManager', instance);
    return instance;
  });
}

/* Factory export – always returns a NEW instance */

export function createProjectManager(deps = {}) {
  if (!deps.DependencySystem) throw new Error('[createProjectManager] DependencySystem required');

  const instance = new ProjectManager({ ...deps, DependencySystem: deps.DependencySystem });
  deps.DependencySystem.register?.('projectManager', instance);
  return instance;            // returns a fresh instance (not a Promise)
}

export { isValidProjectId, extractResourceList, normalizeProjectResponse, retryWithBackoff };
export default createProjectManager;
