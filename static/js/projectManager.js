// VENDOR-EXEMPT-SIZE: Core module pending refactor in Q3-25
// Refactored to comply with factory export, pure imports, domReadinessService usage, event bus for module events,
// and logger-based error handling per guardrails. No top-level logic is executed here; all initialization occurs inside createProjectManager.

// ----------------------------------------------------------------------------
// 1) Provide a top-level export for isValidProjectId (cannot export from inside a function)
// ----------------------------------------------------------------------------
export function isValidProjectId(id) {
  if (id == null) return false;

  const idStr = String(id).trim();

  if (/^\d+$/.test(idStr)) return true;

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (UUID_REGEX.test(idStr)) return true;

  if (/^[0-9a-f]{32}$/i.test(idStr)) return true;

  return false;
}

// ----------------------------------------------------------------------------
// 2) Primary factory export: createProjectManager
/**
 * Factory function that creates and configures a ProjectManager instance for managing projects and related resources.
 *
 * The returned object includes the ProjectManager instance, a cleanup method, and utility functions for normalizing project responses, extracting resource lists, and retrying asynchronous operations with backoff.
 *
 * @returns {Object} An object containing:
 *   - `instance`: The ProjectManager instance.
 *   - `cleanup`: Function to destroy the instance and clean up listeners.
 *   - `normalizeProjectResponse`: Utility to normalize project server responses.
 *   - `extractResourceList`: Utility to extract resource arrays from API responses.
 *   - `retryWithBackoff`: Utility to retry async functions with exponential backoff.
 *
 * @throws {Error} If required dependencies (`DependencySystem`, `domReadinessService`, or `logger`) are missing.
 *
 * @remark
 * The ProjectManager instance is registered with the DependencySystem under the name `'projectManager'`.
 */
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
    // Debug logging to see actual server response
    logger.error('[ProjectManager] normalizeProjectResponse - raw response:', {
      type: typeof res,
      keys: res ? Object.keys(res) : [],
      hasData: !!res?.data,
      hasProject: !!res?.project,
      hasDataProject: !!res?.data?.project,
      dataKeys: res?.data ? Object.keys(res.data) : [],
      response: JSON.stringify(res, null, 2)
    });

    let data = Array.isArray(res)
      ? res[0]
      : res?.data?.project?.id
        ? res.data.project
        : res?.project?.id
          ? res.project
          : res?.data?.id
            ? res.data
            : res?.id
              ? res
              : null;

    logger.debug('[ProjectManager] normalizeProjectResponse - extracted data:', {
      data: data,
      dataId: data?.id,
      extractedId: data?.id ?? data?.uuid ?? data?.project_id ?? data?.projectId
    });

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

    // Check if data extraction failed completely
    if (!data) {
      // Check if this is an empty response (likely 404 or server error)
      if (res && typeof res === 'object' && Object.keys(res).length === 0) {
        logger.error('[ProjectManager] Server returned empty response - likely project not found or access denied');
        const error = new Error('Project not found or access denied');
        error.status = 404;
        throw error;
      }
      logger.error('[ProjectManager] Could not extract project data from response:', {
        rawResponse: res,
        responseType: typeof res,
        responseKeys: res ? Object.keys(res) : []
      });
      throw new Error('Invalid response structure - no project data found');
    }

    logger.debug('[ProjectManager] normalizeProjectResponse - final validation:', {
      finalData: data,
      finalId: data?.id,
      idLength: data?.id?.length,
      isValid: isValidProjectId(data?.id)
    });

    if (!isValidProjectId(data?.id)) {
      logger.error('[ProjectManager] Invalid project ID detected:', {
        receivedId: data?.id,
        idType: typeof data?.id,
        idLength: data?.id?.length,
        rawResponse: res
      });
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

      this.app = app ?? DependencySystem.modules.get('appModule');
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
      // CONSOLIDATED: Removed _activeProjectId - use canonical appModule.state.currentProjectId instead

      this.apiEndpoints = apiEndpoints;
      this._CONFIG = {
        PROJECTS: apiEndpoints.PROJECTS || '/api/projects/',
        DETAIL: apiEndpoints.DETAIL || '/api/projects/{id}/',
        STATS: apiEndpoints.STATS || '/api/projects/{id}/stats/',
        FILES: apiEndpoints.FILES || '/api/projects/{id}/files/',
        // Always store a string template; never invoke endpoint factories here
        CONVOS: (typeof apiEndpoints.CONVERSATIONS === 'string'
          ? apiEndpoints.CONVERSATIONS
          : '/api/projects/{id}/conversations/'),
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
      /* Always include cookies so authenticated calls reach the server.
         Merge with caller-supplied opts without overwriting them.          */
      const mergedOpts =
        opts && typeof opts === 'object'
          ? { credentials: 'include', ...opts }
          : { credentials: 'include' };

      return this.apiRequest(url, mergedOpts, contextLabel);
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
          if (!this.app?.state?.isAuthenticated) {
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
        logger.error(`[${MODULE}] Requesting project details from URL: ${detailUrl}`);
        
        // Check authentication state first
        const authModule = this.DependencySystem?.modules?.get('auth');
        const authHeader = authModule?.getAuthHeader?.() || this.app?.getAuthHeader?.() || {};
        
        const authState = {
          isAuthenticated: this.app?.state?.isAuthenticated,
          currentUser: this.app?.state?.currentUser?.id || 'none',
          hasAuthToken: !!authHeader.Authorization,
        };
        logger.debug(`[${MODULE}] Authentication state:`, authState);
        
        // Detect auth state mismatch - user is marked as authenticated but has no token
        if (authState.isAuthenticated && !authState.hasAuthToken) {
          logger.error(`[${MODULE}] CRITICAL: Auth state mismatch detected - user is authenticated but has no token. This will cause 401 errors.`);
          const error = new Error('Authentication token missing or expired. Please log in again.');
          error.status = 401;
          error.code = 'AUTH_TOKEN_MISSING';
          throw error;
        }
        
        let detailRes;
        try {
          detailRes = await this._req(detailUrl, undefined, 'loadProjectDetails');
        } catch (apiError) {
          logger.error(`[${MODULE}] API request failed with error:`, {
            error: apiError,
            status: apiError?.status,
            message: apiError?.message,
            data: apiError?.data,
            isAuthError: apiError?.status === 401
          });
          
          // Special handling for auth errors
          if (apiError?.status === 401) {
            logger.error(`[${MODULE}] Authentication failed - user may need to re-login`);
          }
          
          throw apiError; // Re-throw to handle in outer catch
        }
        logger.debug(`[${MODULE}] Received response from server:`, {
          type: typeof detailRes,
          keys: detailRes ? Object.keys(detailRes) : [],
          hasData: !!(detailRes?.data || detailRes?.project)
        });
        const currentProjectObj = normalizeProjectResponse(detailRes);

        // Race condition check: Only update global state if the loaded project is still the active one.
        const globalCurrentProjectId = this.app?.getCurrentProject?.()?.id;
        if (globalCurrentProjectId === id) {
          this.logger.info(`[${MODULE}][loadProjectDetails] Setting current project in app state.`, { projectId: id, context: MODULE });
          this.app.setCurrentProject(currentProjectObj); // This will trigger AppBus 'currentProjectChanged'
        } else {
          this.logger.warn(`[${MODULE}][loadProjectDetails] Global current project changed (${globalCurrentProjectId}) while loading details for ${id}. Not updating global state.`, { context: MODULE });
          // Decide if we should still emit 'projectLoaded' on local bus or a different event.
          // For now, let's assume other components will react to AppBus 'currentProjectChanged'.
          // If this component specifically needs to signal it loaded 'an old project', add custom event.
          this._emit('projectDetailsLoadedForStaleId', { loadedProject: currentProjectObj, currentGlobalProjectId: globalCurrentProjectId, context: MODULE });
          return currentProjectObj; // Return the loaded data, but don't make it the global current
        }

        this._emit('projectLoaded', currentProjectObj); // Emit on local bus

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
        const convosUrl =
          typeof this._CONFIG.CONVOS === 'function'
            ? this._CONFIG.CONVOS(id)
            : this._CONFIG.CONVOS.replace('{id}', id);

        const res = await this._req(
          convosUrl,
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
      if (!this.app?.state?.isAuthenticated) throw new Error('auth');
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
      if (!this.app?.state?.isAuthenticated) throw new Error('auth');
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
      if (!this.app?.state?.isAuthenticated) throw new Error('auth');
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
        return await this.chatManager.createNewConversation(projectId);
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

    // CONSOLIDATED: Get projectId from canonical sources only
    _getEffectiveProjectId() {
      // Priority order: canonical appModule state, app.getProjectId(), browserService location param
      const candidates = [
        // CONSOLIDATED: Use canonical appModule state first
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
      if (!this.app?.state?.isAuthenticated) {
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
        const proj = this.app.getCurrentProject();
        // this.logger.debug(`[${MODULE}][getCurrentProject] Fetched from app.getCurrentProject()`, { projectId: proj?.id, context: MODULE });
        return proj;
      }
      this.logger.warn(`[${MODULE}][getCurrentProject] app.getCurrentProject is not available.`, { context: MODULE });
      return null;
    }

    // CONSOLIDATED: ProjectManager should delegate to canonical appModule state
    // This method is for when ProjectManager ITSELF decides to change the project.
    setCurrentProject(project) {
      if (!project || !project.id) {
        this.logger.warn(`[${MODULE}][setCurrentProject] Invalid project object provided.`, { project, context: MODULE });
        return null;
      }
      this.logger.info(`[${MODULE}][setCurrentProject] Delegating to canonical appModule state.`, { projectId: project.id, context: MODULE });

      // Store in localStorage for persistence
      this.storage?.setItem?.('selectedProjectId', project.id);

      // CONSOLIDATED: Delegate to canonical appModule state instead of maintaining local state
      if (this.app && typeof this.app.setCurrentProject === 'function') {
        this.logger.debug(`[${MODULE}][setCurrentProject] Calling app.setCurrentProject().`, { projectId: project.id, context: MODULE });
        this.app.setCurrentProject(project); // This will trigger AppBus event and update appModule.state
      } else {
        this.logger.warn(`[${MODULE}][setCurrentProject] app.setCurrentProject is not available. Cannot set project globally.`, { context: MODULE });
        // Fallback: emit local event if global state update fails
        this._emit('currentProjectChanged', { project });
      }
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
      if (!this.app?.state?.isAuthenticated) {
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
          message: `Failed to create knowledge base for project ${projectId}: ${createError?.message || 'Unknown error'
            }`
        });
        throw createError;
      }
    }

    async downloadFile(projectId, fileId) {
      const url = this._CONFIG.FILE_DOWNLOAD.replace('{id}', projectId).replace('{file_id}', fileId);
      /* Request the response as a Blob so the caller can trigger a browser download */
      return this._req(
        url,
        { responseType: 'blob' },
        'downloadFile'
      );
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
      this.logger.info(`[${MODULE}] Initializing...`, { context: MODULE });
      await this.domReadinessService.dependenciesAndElements({
        deps: ['app', 'auth', 'AppBus', 'eventHandlers'], // Ensure AppBus and eventHandlers are available for listeners
        timeout: 30000,
        context: `${MODULE}_dependenciesAndElements_wait1`
      });
      this.logger.debug(`[${MODULE}] Core dependencies (app, auth, AppBus, eventHandlers) ready.`, { context: MODULE });

      const auth = this.DependencySystem.modules.get('auth');
      const appModule = this.DependencySystem.modules.get('appModule');

      /* ---------------------------------------------------------------------
       * Guard against legacy or partially-initialised auth modules that do
       * not expose `.isReady()`.  Per Dec 2024 guardrails, the canonical
       * readiness signal is `auth.AuthBus` → `authReady` OR the presence of
       * `appModule.state.isAuthenticated`.
       * ------------------------------------------------------------------- */
      const authIsReadyFn = typeof auth?.isReady === 'function' ? auth.isReady.bind(auth) : null;
      const authReady =
        (authIsReadyFn && authIsReadyFn()) ||
        Boolean(appModule?.state?.isAuthenticated);

      if (!authReady) {
        this.logger.info(`[${MODULE}] Auth not ready yet, waiting for authReady/authStateChanged.`, { context: MODULE });
        await new Promise((resolve) => {
          if (auth?.AuthBus) {
            this.listenerTracker.add(
              auth.AuthBus,
              'authReady',
              () => {
                this.logger.info(`[${MODULE}] Received authReady event.`, { context: MODULE });
                resolve();
              },
              'ProjectManager_AuthReadyListener',
              { once: true }
            );
            /* Fallback: also resolve when authenticated state flips true */
            this.listenerTracker.add(
              auth.AuthBus,
              'authStateChanged',
              (e) => {
                if (e?.detail?.authenticated) resolve();
              },
              'ProjectManager_AuthStateChangedListener',
              { once: true }
            );
          } else {
            /* No AuthBus available – poll appModule.state as last resort */
            const poll = setInterval(() => {
              if (this.DependencySystem.modules.get('appModule')?.state?.isAuthenticated) {
                clearInterval(poll);
                resolve();
              }
            }, 200);
          }
        });
      }
      this.logger.info(`[${MODULE}] Auth module is ready. Current appModule auth state: ${appModule?.state?.isAuthenticated}`, { context: MODULE });

      this._setupEventListeners();

      // CONSOLIDATED: No need to track local _activeProjectId - canonical state is in appModule
      const initialProject = this.app?.getCurrentProject?.();
      if (initialProject?.id) {
        this.logger.info(`[${MODULE}] Initial project found from canonical app state.`, { projectId: initialProject.id, context: MODULE });
        // Optionally, load project details or list if required on init and project exists
        // For now, deferring to explicit calls or UI-triggered loads.
      } else {
        this.logger.info(`[${MODULE}] No initial project found from canonical app state.`, { context: MODULE });
      }

      this.logger.info(`[${MODULE}] Initialization complete.`, { context: MODULE });
      return true;
    }

    _setupEventListeners() {
      this.logger.debug(`[${MODULE}] Setting up event listeners.`, { context: MODULE });
      const appBus = this.DependencySystem.modules.get('AppBus');
      const authBus = this.DependencySystem.modules.get('auth')?.AuthBus;

      if (appBus) {
        this.listenerTracker.add(appBus, 'currentProjectChanged', this._handleCurrentProjectChanged.bind(this), 'ProjectManager_AppBus_CurrentProjectChanged');
        this.logger.debug(`[${MODULE}] Subscribed to AppBus "currentProjectChanged".`, { context: MODULE });
      } else {
        this.logger.warn(`[${MODULE}] AppBus not available. Cannot subscribe to "currentProjectChanged".`, { context: MODULE });
      }

      if (authBus) {
        this.listenerTracker.add(authBus, 'authStateChanged', this._handleAuthStateChanged.bind(this), 'ProjectManager_AuthBus_AuthStateChanged');
        this.logger.debug(`[${MODULE}] Subscribed to AuthBus "authStateChanged".`, { context: MODULE });
      } else {
        this.logger.warn(`[${MODULE}] AuthBus not available. Cannot subscribe to "authStateChanged".`, { context: MODULE });
      }
    }

    _handleCurrentProjectChanged(event) {
      const newProject = event?.detail?.project;
      const oldProject = event?.detail?.previousProject;
      this.logger.info(`[${MODULE}] Received "currentProjectChanged" event via AppBus.`, {
        newProjectId: newProject?.id,
        oldProjectId: oldProject?.id,
        context: MODULE
      });
      // CONSOLIDATED: No need to track local _activeProjectId - canonical state is in appModule
      if (newProject?.id) {
        this.logger.debug(`[${MODULE}] Project changed to ${newProject.id} via canonical state.`, { context: MODULE });
        // Clear any data specific to the old project, IF projectManager caches such details.
        // For example, if this.projects was a list of files for ONLY the current project, clear it.
        // Currently, loadProjects fetches all projects, so it's less of an issue for the main list.
        // However, if specific details like current project's files, stats etc., were cached directly
        // on `this`, they would need clearing here.
        // Example: if (this.detailedFilesCache?.projectId !== newProject.id) this.detailedFilesCache = null;

        // Optionally, trigger a reload of project-specific data if this component is responsible
        // for displaying details of the active project.
        // e.g., if it maintained a this.detailedProjectObject, it might call this.loadProjectDetails(newProject.id);
        // For now, this manager primarily provides methods; UI components would drive reloads.

      } else {
        this.logger.info(`[${MODULE}] Current project cleared (null) via canonical state.`, { context: MODULE });
        // Clear project-specific cached data
      }
    }

    _handleAuthStateChanged(event) {
      const isAuthenticated = event?.detail?.authenticated;
      this.logger.info(`[${MODULE}] Received "authStateChanged" event. Authenticated: ${isAuthenticated}`, { detail: event?.detail, context: MODULE });
      if (!isAuthenticated) {
        this.logger.info(`[${MODULE}] User is now unauthenticated. Clearing cached projects list.`, { context: MODULE });
        this.projects = []; // Clear cached list of all projects
        // CONSOLIDATED: No need to clear local _activeProjectId - canonical state is in appModule
        // Emit an event that project data has been cleared due to auth change, if other parts rely on this.
        this._emit('projectDataClearedDueToAuth', { reason: 'User unauthenticated' });
      } else {
        // User is now authenticated. We might want to trigger a reload of projects.
        // However, UI components or app.js init flow typically handle initial loads post-auth.
        // Only trigger if projectManager is expected to proactively refresh its list on login.
        this.logger.debug(`[${MODULE}] User is now authenticated. Project list can be reloaded if necessary.`, { context: MODULE });
        // Example: this.loadProjects(); // If proactive reload is desired.
      }
    }

    // centralized error handler – simplified per guardrail
    _handleErr(eventType, error, fallbackValue, additionalDetails = {}) {
      this.logger.error(`[${this.moduleName}][${eventType}]`, error, additionalDetails);
      this._emit(eventType, { error, ...additionalDetails });
      return fallbackValue;
    }

    destroy() {
      this.logger.info(`[${MODULE}] Destroying and cleaning up listeners.`, { context: MODULE });
      this.listenerTracker?.remove?.(); // Cleans up listeners tracked via eventHandlers
      if (this._loadProjectsDebounceTimer) {
        clearTimeout(this._loadProjectsDebounceTimer);
      }
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
    // Canonical event listener cleanup per guardrails
    // Centralized cleanup for event listeners via eventHandlers module per guardrails
    const eventHandlers = DependencySystem.modules.get('eventHandlers');
    if (eventHandlers?.cleanupListeners) {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
    DependencySystem.modules.get('eventHandlers')?.cleanupListeners?.({ context: "ProjectManager" });
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
