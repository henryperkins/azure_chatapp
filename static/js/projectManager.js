// Refactored to comply with factory export, pure imports, domReadinessService usage, event bus for module events,
// and logger-based error handling per guardrails. No top-level logic is executed here; all initialization occurs inside createProjectManager.

// ----------------------------------------------------------------------------
// 1) Provide a top-level export for isValidProjectId (cannot export from inside a function)
// ----------------------------------------------------------------------------
export function isValidProjectId(id) {
  if (id == null) return false;
  const idStr = String(id).trim();
  const uuidLike = /^[0-9a-f-]{32,36}$/i.test(idStr);
  const numeric = /^\d+$/.test(idStr);
  return uuidLike || numeric;
}

// ----------------------------------------------------------------------------
// 2) Primary factory export: createProjectManager
// ----------------------------------------------------------------------------
export function createProjectManager({
  DependencySystem,
  domReadinessService,
  logger,
  timer,
  ...otherDeps
} = {}) {
  if (!DependencySystem) {
    throw new Error('[createProjectManager] Missing DependencySystem');
  }
  if (!domReadinessService) {
    throw new Error('[createProjectManager] Missing domReadinessService');
  }
  if (!logger) {
    throw new Error('[createProjectManager] Missing logger');
  }

  const MODULE = 'ProjectManager';

  function normalizeProjectResponse(res) {
    let data = Array.isArray(res)
      ? res[0]
      : res?.data?.id
        ? res.data
        : res?.id
          ? res
          : null;
    if (data) {
      data = { ...data, id: String(data.id ?? data.uuid ?? data.project_id ?? data.projectId ?? '').trim() };
      // Robust frontend field mapping for key project details
      data.name =
        data.name ??
        data.title ??
        data.project_name ??
        "";
      data.description =
        data.description ??
        data.details ??
        data.project_description ??
        "";
      data.goals =
        data.goals ??
        data.project_goals ??
        "";
      data.customInstructions =
        data.customInstructions ??
        data.instructions ??
        data.custom_instructions ??
        data.project_instructions ??
        "";
    }
    if (!isValidProjectId(data?.id)) {
      throw new Error('Invalid project ID in server response');
    }
    return data;
  }

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

  async function retryWithBackoff(fn, maxRetries, timerRef) {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        logger.error('[ProjectManager][retryWithBackoff-fn]', err, { context: MODULE });
        // rethrow if 4xx not 429 or if we exceeded max retries
        if (
          err &&
          err.status &&
          ((err.status >= 400 && err.status < 500 && err.status !== 429) || err.status === 405)
        ) {
          throw err;
        }
        if (++attempt > maxRetries) {
          throw err;
        }
        await new Promise((r) => timerRef(r, 1000 * attempt));
      }
    }
  }

  class ProjectManager {
    constructor({
      app,
      chatManager,
      DependencySystem,
      logger,
      modelConfig = null,
      listenerTracker = null,
      timer: timerFunc = typeof setTimeout === 'function' ? setTimeout : (cb) => cb(),
      storage = { setItem: () => {}, getItem: () => null },
      apiEndpoints,
      apiRequest = null,
      browserService = null,
      domReadinessService,
      domAPI = null
    } = {}) {
      if (!DependencySystem) {
        throw new Error('DependencySystem required');
      }
      if (!apiEndpoints) {
        throw new Error('apiEndpoints required');
      }
      if (!domReadinessService) {
        throw new Error('[createProjectManager] Missing domReadinessService');
      }

      this.moduleName = MODULE;
      this.logger = logger;
      this.DependencySystem = DependencySystem;
      this.domReadinessService = domReadinessService;

      this.app = app ?? DependencySystem.modules.get('app');
      this.chatManager = chatManager ?? DependencySystem.modules.get('chatManager');
      this.modelConfig = modelConfig ?? DependencySystem.modules.get('modelConfig');
      this.timer = timerFunc;
      this.storage = storage;
      this.apiRequest = apiRequest ?? this.app?.apiRequest;
      this.browserService =
        browserService ?? DependencySystem.modules.get?.('browserService') ?? null;
      this.domAPI = domAPI ?? DependencySystem.modules.get('domAPI') ?? null;

      // Instead of dispatching to DOM, maintain an EventTarget bus
      this.eventBus = new EventTarget();

      // track listeners if provided
      if (!listenerTracker) {
        const ev = DependencySystem.modules.get('eventHandlers');
        if (!ev?.trackListener) {
          throw new Error('eventHandlers.trackListener missing');
        }
        listenerTracker = {
          add: (t, e, h, dsc) => ev.trackListener(t, e, h, { description: dsc, context: MODULE }),
          remove: () => ev.cleanupListeners?.({ context: MODULE })
        };
      }
      this.listenerTracker = listenerTracker;

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
        KB_LIST_URL_TEMPLATE:
          apiEndpoints.KB_LIST_URL_TEMPLATE || '/api/projects/{id}/knowledge-bases/',
        KB_DETAIL_URL_TEMPLATE:
          apiEndpoints.KB_DETAIL_URL_TEMPLATE || '/api/projects/{id}/knowledge-bases/{kb_id}/',
        ARCHIVE: apiEndpoints.ARCHIVE || '/api/projects/{id}/archive/',
        FILE_DETAIL: apiEndpoints.FILE_DETAIL || '/api/projects/{id}/files/{file_id}/',
        FILE_DOWNLOAD: apiEndpoints.FILE_DOWNLOAD || '/api/projects/{id}/files/{file_id}/download/',
        ARTIFACT_DOWNLOAD:
          apiEndpoints.ARTIFACT_DOWNLOAD || '/api/projects/{id}/artifacts/{artifact_id}/download/'
      };
    }

    _req(url, opts = {}, contextLabel = 'n/a') {
      if (typeof this.apiRequest !== 'function') {
        throw new Error('[ProjectManager] apiRequest missing');
      }
      return this.apiRequest(url, opts, contextLabel);
    }

    _emit(event, detail) {
      /* dispatch on local bus (keeps module-internal listeners) */
      this.eventBus.dispatchEvent(new CustomEvent(event, { detail }));

      /* additionally broadcast to the global document so other components
         (e.g. ProjectListComponent, ProjectDashboard) that listen on
         document receive the same updates. All DOM access goes through
         the DI-provided domAPI to respect guardrails. */
      try {
        if (this.domAPI?.getDocument) {
          const doc = this.domAPI.getDocument();
          if (doc) {
            /* use DependencySystem-provided eventHandlers.createCustomEvent
               when available, else fall back to new CustomEvent               */
            const evh = this.DependencySystem?.modules?.get?.('eventHandlers');
            const domEvt = evh?.createCustomEvent
              ? evh.createCustomEvent(event, { detail })
              : new CustomEvent(event, { detail });

            this.domAPI.dispatchEvent(doc, domEvt);
          }
        }
      } catch (err) {
        /* non-fatal: log and continue */
        this.logger?.warn?.(`[ProjectManager] failed to rebroadcast "${event}"`, err, {
          context: this.moduleName
        });
      }
    }

    _authOk(failEvent, extraDetail = {}) {
      if (this.app?.state?.isAuthenticated) return true;
      const auth = this.DependencySystem?.modules?.get?.('auth');
      if (auth?.isAuthenticated?.()) return true;
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
            let baseUrl;
            if (typeof this.apiEndpoints.USER_PROJECTS === 'function') {
              baseUrl = this.apiEndpoints.USER_PROJECTS();
            } else if (this.apiEndpoints.USER_PROJECTS) {
              baseUrl = this.apiEndpoints.USER_PROJECTS;
            } else if (typeof this.apiEndpoints.PROJECTS === 'function') {
              baseUrl = this.apiEndpoints.PROJECTS();
            } else {
              baseUrl = this.apiEndpoints.PROJECTS || this._CONFIG.PROJECTS;
            }

            if (typeof baseUrl === 'string' && !baseUrl.endsWith('/') && !baseUrl.includes('?')) {
              baseUrl += '/';
            }
            const origin = this.browserService?.getLocation?.().origin || '';
            const urlObj = new URL(baseUrl, origin);
            if (filter && filter !== 'all') {
              urlObj.searchParams.set('filter', filter);
            } else {
              urlObj.searchParams.delete('filter');
            }
            const res = await this._req(String(urlObj), undefined, 'loadProjects');
            const list = extractResourceList(res, ['projects']);
            this.projects = list;
            this._emit('projectsLoaded', { projects: list, filter });
            resolve(list);
          } catch (err) {
            logger.error('[ProjectManager][loadProjects]', err, { context: MODULE });
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
      let detailUrlTemplate;
      if (typeof this.apiEndpoints.DETAIL === 'function') {
        detailUrlTemplate = null;
      } else {
        detailUrlTemplate = String(this.apiEndpoints.DETAIL || this._CONFIG.DETAIL);
      }
      let detailUrl;
      if (detailUrlTemplate) {
        if (
          detailUrlTemplate.includes('{id}') &&
          !detailUrlTemplate.endsWith('/') &&
          detailUrlTemplate.substring(detailUrlTemplate.indexOf('{id}') + '{id}'.length).length === 0
        ) {
          detailUrlTemplate += '/';
        }
        detailUrl = detailUrlTemplate.replace('{id}', id);
      } else if (typeof this.apiEndpoints.DETAIL === 'function') {
        detailUrl = this.apiEndpoints.DETAIL(id);
      } else {
        throw new Error('Invalid DETAIL endpoint configuration');
      }

      try {
        const detailRes = await this._req(detailUrl, undefined, 'loadProjectDetails');
        const currentProjectObj = normalizeProjectResponse(detailRes);
        this.app.setCurrentProject(currentProjectObj);
        this._emit('projectLoaded', currentProjectObj);

        if (currentProjectObj.archived) {
          this._emit('projectArchivedNotice', { id: currentProjectObj.id });
          return { ...currentProjectObj };
        }

        let kbLoadResult = { status: 'fulfilled', value: null };
        if (currentProjectObj && currentProjectObj.knowledge_base_id) {
          try {
            const kbValue = await this.loadProjectKnowledgeBase(
              currentProjectObj.id,
              currentProjectObj.knowledge_base_id
            );
            kbLoadResult = { status: 'fulfilled', value: kbValue };
          } catch (kbError) {
            logger.error('[ProjectManager][loadProjectDetails-kbError]', kbError, { context: MODULE });
            kbLoadResult = { status: 'rejected', reason: kbError };
          }
        } else {
          this._emit('projectKnowledgeBaseLoaded', { id, knowledgeBase: null });
        }

        const otherResourcesPromises = [
          this.loadProjectStats(id),
          this.loadProjectFiles(id),
          this.loadProjectConversations(id),
          this.loadProjectArtifacts(id)
        ];
        const otherResults = await Promise.allSettled(otherResourcesPromises);
        const [stats, files, convos, artifacts] = otherResults;

        const allResults = [kbLoadResult, stats, files, convos, artifacts];
        const criticalErrors = allResults
          .filter((r) => r.status === 'rejected')
          .map((r) => r.reason);
        if (criticalErrors.length > 0) {
          this._emit('projectDetailsLoadError', { id, errors: criticalErrors });
        }

        this._emit('projectDetailsFullyLoaded', { projectId: currentProjectObj.id });
        return { ...currentProjectObj };
      } catch (err) {
        logger.error('[ProjectManager][loadProjectDetails]', err, { context: MODULE });
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
        if (status === 404) {
          this._emit('projectNotFound', { id });
        }
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
        const res = await this._req(url, undefined, 'loadProjectKnowledgeBase');
        const kb = res?.data || res;
        if (!kb || !kb.id) {
          this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: null });
          return null;
        } else {
          this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: kb });
          return kb;
        }
      } catch (err) {
        logger.error('[ProjectManager][loadProjectKnowledgeBase]', err, { context: MODULE });
        this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: null });
        throw err;
      }
    }

    async loadProjectStats(id) {
      try {
        const res = await this._req(
          this._CONFIG.STATS.replace('{id}', id),
          undefined,
          'loadProjectStats'
        );
        const stats = res?.data ?? {};
        this._emit('projectStatsLoaded', { id, ...stats });
        return stats;
      } catch (err) {
        logger.error('[ProjectManager][loadProjectStats]', err, { context: MODULE });
        return this._handleErr('projectStatsError', err, {});
      }
    }

    async loadProjectFiles(id) {
      try {
        const res = await this._req(
          this._CONFIG.FILES.replace('{id}', id),
          undefined,
          'loadProjectFiles'
        );
        const files = extractResourceList(res, ['files', 'file']) ?? [];
        this._emit('projectFilesLoaded', { id, files });
        return files;
      } catch (err) {
        logger.error('[ProjectManager][loadProjectFiles]', err, { context: MODULE });
        return this._handleErr('projectFilesError', err, []);
      }
    }

    async loadProjectConversations(id) {
      try {
        const res = await this._req(
          this._CONFIG.CONVOS.replace('{id}', id),
          undefined,
          'loadProjectConversations'
        );
        const conversations = extractResourceList(res, ['conversations']) ?? [];
        this._emit('projectConversationsLoaded', { id, conversations });
        return conversations;
      } catch (err) {
        logger.error('[ProjectManager][loadProjectConversations]', err, { context: MODULE });
        return this._handleErr('projectConversationsError', err, []);
      }
    }

    async loadProjectArtifacts(id) {
      try {
        const res = await this._req(
          this._CONFIG.ARTIFACTS.replace('{id}', id),
          undefined,
          'loadProjectArtifacts'
        );
        const artifacts = extractResourceList(res, ['artifacts']) ?? [];
        this._emit('projectArtifactsLoaded', { id, artifacts });
        return artifacts;
      } catch (err) {
        logger.error('[ProjectManager][loadProjectArtifacts]', err, { context: MODULE });
        return this._handleErr('projectArtifactsError', err, []);
      }
    }

    async saveProject(id, payload) {
      if (!this._authOk('projectSaveError', { id })) throw new Error('auth');
      const isUpdate = Boolean(id);
      const url = isUpdate ? this._CONFIG.DETAIL.replace('{id}', id) : this._CONFIG.PROJECTS;
      const method = isUpdate ? 'PATCH' : 'POST';
      try {
        const res = await this._req(url, { method, body: payload }, 'saveProject');
        const proj = res?.data ?? res;
        this._emit(isUpdate ? 'projectUpdated' : 'projectCreated', proj);
        return proj;
      } catch (err) {
        logger.error('[ProjectManager][saveProject]', err, { context: MODULE });
        this._handleErr('projectSaveError', err, null, {
          method: 'saveProject',
          endpoint: url
        });
        throw err;
      }
    }

    async deleteProject(id) {
      if (!this._authOk('projectDeleteError', { id })) throw new Error('auth');
      try {
        await this._req(
          this._CONFIG.DETAIL.replace('{id}', id),
          { method: 'DELETE' },
          'deleteProject'
        );
        if (this.currentProject?.id === id) {
          this.currentProject = null;
        }
        this._emit('projectDeleted', { id });
      } catch (err) {
        logger.error('[ProjectManager][deleteProject]', err, { context: MODULE });
        this._handleErr('projectDeleteError', err, null, {
          method: 'deleteProject',
          endpoint: this._CONFIG.DETAIL.replace('{id}', id)
        });
        throw err;
      }
    }

    async toggleArchiveProject(id) {
      if (!this._authOk('projectArchiveToggled', { id })) throw new Error('auth');
      try {
        const res = await this._req(
          this._CONFIG.ARCHIVE.replace('{id}', id),
          { method: 'PATCH' },
          'toggleArchiveProject'
        );
        this._emit('projectArchiveToggled', {
          id,
          archived: res?.archived ?? !this.currentProject?.archived
        });
        return res;
      } catch (err) {
        logger.error('[ProjectManager][toggleArchiveProject]', err, { context: MODULE });
        this._handleErr('projectArchiveToggled', err, null, {
          method: 'toggleArchiveProject',
          endpoint: this._CONFIG.ARCHIVE.replace('{id}', id)
        });
        throw err;
      }
    }

    async createConversation(projectId, opts = {}) {
      try {
        this.storage.setItem?.('selectedProjectId', projectId);
        return await this.chatManager.createNewConversation(projectId, opts);
      } catch (origErr) {
        logger.error('[ProjectManager][createConversation]', origErr, { context: MODULE });
        let finalErr = origErr;
        const msg = String(origErr?.message ?? '').toLowerCase();
        if (msg.includes('no knowledge base')) {
          try {
            await this._ensureKnowledgeBase(projectId);
            return await this.chatManager.createNewConversation(projectId, opts);
          } catch (retryErr) {
            logger.error('[ProjectManager][createConversation-retryErr]', retryErr, { context: MODULE });
            finalErr = retryErr;
          }
        }
        this._handleErr('conversationCreateError', finalErr, null, {
          source: 'createConversation',
          detail: { projectId }
        });
        throw finalErr;
      }
    }

    // Get projectId from several possible sources for conversation/context flow robustness
    _getEffectiveProjectId() {
      // Priority order: this.currentProjectId, this.currentProject?.id, app.getCurrentProject().id, app.getProjectId(), browserService location param
      const candidates = [
        this.currentProjectId,
        this.currentProject?.id,
        (this.app?.getCurrentProject && this.app.getCurrentProject()?.id),
        (this.app?.getProjectId && this.app.getProjectId())
      ];
      for (const id of candidates) {
        if (isValidProjectId(id)) return id;
      }
      // Fallback: extract from URL if browserService provides it
      const urlSearch = this.browserService?.getLocation?.().search;
      if (urlSearch) {
        try {
          const params = new URLSearchParams(urlSearch);
          const candidate = params.get('project');
          if (isValidProjectId(candidate)) return candidate;
        } catch {
          // Ignore URL parsing errors for robustness (URL may be malformed or not present)
        }
      }
      return null;
    }

    async getConversation(conversationId) {
      if (!this._authOk('conversationLoadError', { conversationId })) {
        throw new Error('auth');
      }
      const projectId = this._getEffectiveProjectId();
      if (!isValidProjectId(projectId)) {
        this._handleErr('conversationLoadError', new Error('No valid project context'), null, {
          source: 'getConversation',
          detail: { conversationId }
        });
        throw new Error('No valid project context');
      }
      try {
        const endpoint = `/api/projects/${projectId}/conversations/${conversationId}/`;
        const res = await this._req(endpoint, undefined, 'getConversation');
        const convo = res?.conversation;
        if (!convo || !convo.id) {
          throw new Error('Invalid conversation data received');
        }
        return convo;
      } catch (err) {
        logger.error('[ProjectManager][getConversation]', err, { context: MODULE });
        this._handleErr('conversationLoadError', err, null, {
          source: 'getConversation',
          detail: { conversationId, projectId }
        });
        throw err;
      }
    }

    async deleteProjectConversation(projectId, conversationId) {
      try {
        this.storage.setItem?.('selectedProjectId', projectId);
        await this.chatManager.deleteConversation(conversationId);
        return true;
      } catch (err) {
        logger.error('[ProjectManager][deleteProjectConversation]', err, { context: MODULE });
        this._handleErr('deleteProjectConversationError', err, null, {
          source: 'deleteProjectConversation',
          detail: { conversationId, projectId }
        });
        throw err;
      }
    }

    // getCurrentProject is now synchronous and does not block on app:ready.
    getCurrentProject() {
      if (this.app && typeof this.app.getCurrentProject === 'function') {
        return this.app.getCurrentProject();
      }
      // Log a warning if app or method is not available.
      this.logger?.warn?.('[ProjectManager][getCurrentProject] app or app.getCurrentProject is not available.', { context: MODULE });
      return null;
    }

    // setCurrentProject is now synchronous and does not block on app:ready.
    setCurrentProject(project) {
      if (!project || !project.id) {
        return;
      }
      this.storage?.setItem?.('selectedProjectId', project.id);
      if (this.app && typeof this.app.setCurrentProject === 'function') {
        this.app.setCurrentProject(project);
      } else {
        this.logger?.warn?.('[ProjectManager][setCurrentProject] app or app.setCurrentProject is not available.', { context: MODULE });
      }
      this._emit('currentProjectChanged', { project });
      return project;
    }

    async prepareFileUploads(projectId, fileList) {
      const validatedFiles = [];
      const invalidFiles = [];
      for (const file of fileList) {
        if (file.size > 30000000) {
          invalidFiles.push({ file, reason: 'Max size exceeded (30MB)' });
        } else {
          validatedFiles.push({ file });
        }
      }
      return { validatedFiles, invalidFiles };
    }

    async uploadFileWithRetry(projectId, { file }, maxRetries = 3) {
      return retryWithBackoff(
        async () => {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('projectId', projectId);
          await this._req(
            `/api/projects/${projectId}/files/`,
            { method: 'POST', body: formData },
            'uploadFileWithRetry'
          );
          return true;
        },
        maxRetries,
        this.timer
      );
    }

    async deleteFile(projectId, fileId) {
      if (!this._authOk('projectFileDeleteError', { projectId, fileId })) {
        throw new Error('auth');
      }
      const url = this._CONFIG.FILE_DETAIL.replace('{id}', projectId).replace('{file_id}', fileId);
      return this._req(url, { method: 'DELETE' }, 'deleteFile');
    }

    async _ensureKnowledgeBase(projectId) {
      if (!projectId) return null;
      const listUrl = this._CONFIG.KB_LIST_URL_TEMPLATE.replace('{id}', projectId);
      try {
        const res = await this._req(listUrl, undefined, '_ensureKnowledgeBase:list');
        const items = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        const active = items.find((kb) => kb && kb.is_active !== false);
        if (active) return active;
      } catch (listError) {
        logger.error('[ProjectManager][_ensureKnowledgeBase:listError]', listError, { context: MODULE });
        this._emit('projectKnowledgeBaseWarning', {
          projectId,
          message: `No active knowledge base found: ${listError?.message || 'Unknown error'}`
        });
      }
      try {
        const payload = {
          name: 'Project Knowledge Base',
          embedding_model: 'all-MiniLM-L6-v2',
          is_active: true
        };
        const createRes = await this._req(
          listUrl,
          { method: 'POST', body: payload },
          '_ensureKnowledgeBase:create'
        );
        const kbData = createRes?.data ?? createRes;
        this._emit('projectKnowledgeBaseCreated', {
          projectId,
          knowledgeBaseId: kbData?.id,
          message: `Created new knowledge base for project ${projectId}`
        });
        return kbData;
      } catch (createError) {
        logger.error('[ProjectManager][_ensureKnowledgeBase:createError]', createError, { context: MODULE });
        this._emit('projectKnowledgeBaseError', {
          projectId,
          error: createError,
          message: `Failed to create knowledge base for project ${projectId}: ${
            createError?.message || 'Unknown error'
          }`
        });
        throw createError;
      }
    }

    async downloadFile(projectId, fileId) {
      const url = this._CONFIG.FILE_DOWNLOAD.replace('{id}', projectId).replace('{file_id}', fileId);
      return this._req(url, undefined, 'downloadFile');
    }

    async downloadArtifact(projectId, artifactId) {
      const url = this._CONFIG.ARTIFACT_DOWNLOAD.replace('{id}', projectId).replace('{artifact_id}', artifactId);
      return this._req(url, undefined, 'downloadArtifact');
    }

    async createProject(projectData) {
      const response = await this._req(
        this._CONFIG.PROJECTS,
        { method: 'POST', body: projectData },
        'createProject'
      );
      const project = response.data || response;
      if (!project || !project.id) {
        throw new Error('Invalid project response');
      }
      const ensureConversation = async () => {
        const hasConvo =
          (Array.isArray(project.conversations) && project.conversations.length > 0) ||
          Number(project.conversation_count) > 0;
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
              model_id:
                this.modelConfig?.getConfig?.()?.modelName || 'claude-3-sonnet-20240229'
            }
          },
          'createDefaultConversation'
        );
        const conversation =
          response?.data?.conversation || response?.data || response?.conversation || response;
        if (!conversation || !conversation.id) {
          throw new Error('Failed to create default conversation');
        }
        return conversation;
      } catch (err) {
        logger.error('[ProjectManager][createDefaultConversation]', err, { context: MODULE });
        return null;
      }
    }

    async retryWithBackoff(fn, maxRetries = 3) {
      return retryWithBackoff(fn, maxRetries, this.timer);
    }

    async initialize() {
      await this.domReadinessService.dependenciesAndElements({
        deps: ['app'],
        timeout: 30000,
        context: `${MODULE}_dependenciesAndElements`
      });
      return true;
    }

    destroy() {
      this.listenerTracker?.remove?.();
    }
  }

  // ----------------------------------------------------------------------------
  // 4) Instantiate manager and expose cleanup in the returned object
  // ----------------------------------------------------------------------------
  const fullDeps = {
    DependencySystem,
    domReadinessService,
    logger,
    timer,
    ...otherDeps
  };
  const instance = new ProjectManager(fullDeps);
  DependencySystem.register?.('projectManager', instance);

  function cleanup() {
    instance.destroy();
  }

  return {
    instance,
    cleanup,
    normalizeProjectResponse,
    extractResourceList,
    retryWithBackoff
  };
}
