// AUTO-INJECTED BY GUARDRAIL REMEDIATION
import { wrapApi, emitReady } from "./utils/notifications-helpers.js";

 // Universal error capture helper
function _capture(err, meta, er) {
  if (er?.capture) er.capture(err, meta);
}

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

async function retryWithBackoff(fn, maxRetries, timer, notify, errorReporter) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      _capture(err, { module: MODULE, method: "retryWithBackoff" }, errorReporter);
      if (err && err.status && ((err.status >= 400 && err.status < 500 && err.status !== 429) || err.status === 405)) {
        throw err;
      }
      if (++attempt > maxRetries) throw err;
      notify?.warn?.(
        `Retry attempt ${attempt}/${maxRetries} for ${fn.name || 'anonymous function'}`,
        { module: MODULE, context: 'retryWithBackoff', attempt, maxRetries, originalError: err }
      );
      errorReporter?.capture?.(err, {
        module: MODULE,
        method: 'retryWithBackoff',
        attempt,
        maxRetries
      });
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
    this.debugTools = debugTools || DependencySystem.modules.get?.('debugTools') || null;
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
        add: (t, e, h, dsc) => ev.trackListener(t, e, h, { description: dsc, context: MODULE }),
        remove: () => ev.cleanupListeners?.({ context: MODULE }),
      };
    }
    this.listenerTracker = listenerTracker;

    /** @type {?Object} */
    this.currentProject = null;
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
      ARCHIVE: apiEndpoints.ARCHIVE || '/api/projects/{id}/archive/'
    };

    this.pmNotify?.debug?.('[ProjectManager] Configured API Endpoints:', {
      source: 'constructor',
      extra: { config: JSON.parse(JSON.stringify(this._CONFIG)) }
    });
    this.pmNotify?.info?.('[ProjectManager] Initialized', { group: true, context: 'projectManager', module: MODULE, source: 'constructor' });
  }

  async _req(url, opts = {}, src = MODULE) {
    return wrapApi(
      this.apiRequest,
      { notify: this.notify, errorReporter: this.errorReporter },
      url,
      opts,
      src
    );
  }

  _emit(event, detail) {
    if (this.domAPI && typeof this.domAPI.dispatchEvent === 'function') {
      this.domAPI.dispatchEvent(this.domAPI.getDocument(), new CustomEvent(event, { detail }));
    } else {
      (this.notify || console).warn?.(
        `[ProjectManager] Missing domAPI; using global dispatchEvent`,
        { module: MODULE, context: '_emit', event }
      );
      globalThis.document?.dispatchEvent(new CustomEvent(event, { detail }));
    }
  }
  _authOk(failEvent, extraDetail = {}) {
    if (this.app?.state?.isAuthenticated) return true;
    this.notify.warn('[ProjectManager] Auth required', { group: true, context: 'projectManager', module: MODULE, source: '_authOk', extra: extraDetail });
    this._emit(failEvent, { error: 'auth_required', ...extraDetail });
    return false;
  }
  _handleErr(eventName, err, fallback, extra = {}) {
    _capture(err, { module: MODULE, method: eventName }, this.errorReporter);
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
      ...extra
    });
    this._emit(eventName, { error: err.message, status, endpoint, detail });
    return fallback;
  }

  async loadProjects(filter = 'all') {
    if (this._loadProjectsDebounceTimer) {
      clearTimeout(this._loadProjectsDebounceTimer);
    }
    return new Promise((resolve) => {
      this._loadProjectsDebounceTimer = this.timer.call(null, async () => {
        const _t = this.debugTools?.start?.('ProjectManager.loadProjects_debounced');
        if (this._loadingProjects) {
          this.notify.info('[ProjectManager] loadProjects already running (debounced call skipped)', { group: true, context: 'projectManager', module: MODULE, source: 'loadProjects' });
          this.debugTools?.stop?.(_t, 'ProjectManager.loadProjects_debounced_busy');
          resolve(this.projects || []);
          return;
        }
        if (!this._authOk('projectsLoaded', { filter })) {
          this.debugTools?.stop?.(_t, 'ProjectManager.loadProjects_debounced_auth_fail');
          resolve([]);
          return;
        }
        this._loadingProjects = true;
        this._emit('projectsLoading', { filter });
        try {
          let baseUrl = typeof this.apiEndpoints.PROJECTS === 'function'
            ? this.apiEndpoints.PROJECTS()
            : this.apiEndpoints.PROJECTS || this._CONFIG.PROJECTS;
          if (typeof baseUrl === 'string' && !baseUrl.endsWith('/') && !baseUrl.includes('?')) {
            this.pmNotify?.warn?.(`[ProjectManager] Base URL for PROJECTS (${baseUrl}) is missing a trailing slash. Adding one.`, { source: 'loadProjects_debounced' });
            baseUrl += '/';
          }
          const urlObj = new URL(baseUrl, location.origin);
          urlObj.searchParams.set('filter', filter);
          const res = await this._req(String(urlObj), undefined, "loadProjects");
          const list = extractResourceList(res, ['projects']);
          this.projects = list;
          this.notify.success(`[ProjectManager] ${list.length} projects (debounced)`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjects', detail: { filter } });
          this._emit('projectsLoaded', { projects: list, filter });
          this.debugTools?.stop?.(_t, 'ProjectManager.loadProjects_debounced_success');
          resolve(list);
        } catch (err) {
          _capture(err, { module: MODULE, method: "loadProjects" }, this.errorReporter);
          this.debugTools?.stop?.(_t, 'ProjectManager.loadProjects_debounced_error');
          resolve(this._handleErr('projectsLoaded', err, []));
        } finally {
          this._loadingProjects = false;
        }
      }, this._DEBOUNCE_DELAY);
    });
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
      this.debugTools?.stop?.(_t, 'ProjectManager.loadProjectDetails');
      throw new Error('Invalid projectId');
    }
    if (!this.app || !this.app.state || !this.app.state.currentUser) {
      this.pmNotify?.warn?.("[ProjectManager] Missing app state or currentUser, returning early", {
        source: "loadProjectDetails"
      });
      this._emit('projectDetailsError', { error: 'User not authenticated', status: 403 });
      this.debugTools?.stop?.(_t, 'ProjectManager.loadProjectDetails');
      return null;
    }
    if (!this._authOk('projectDetailsError', { id })) {
      this.pmNotify?.warn?.("[ProjectManager] _authOk returned false, returning early", {
        source: "loadProjectDetails"
      });
      this.debugTools?.stop?.(_t, 'ProjectManager.loadProjectDetails');
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
        this.pmNotify?.warn?.(`[ProjectManager] Detail URL template (${detailUrlTemplate}) for project ID ${id} is missing a trailing slash after {id}. Adding one.`, { source: 'loadProjectDetails' });
        detailUrlTemplate += '/';
      }
      detailUrl = detailUrlTemplate.replace('{id}', id);
    } else if (typeof this.apiEndpoints.DETAIL === 'function') {
      detailUrl = this.apiEndpoints.DETAIL(id);
    } else {
      this.pmNotify?.error?.('[ProjectManager] Invalid DETAIL endpoint configuration.', { source: 'loadProjectDetails' });
      throw new Error('Invalid DETAIL endpoint configuration');
    }
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
        _capture(err, { module: MODULE, method: "loadProjectDetails" }, this.errorReporter);
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

      if (this.currentProject.archived) {
        this._emit('projectArchivedNotice', { id: this.currentProject.id });
        this.debugTools?.stop?.(_t, 'ProjectManager.loadProjectDetails');
        return { ...this.currentProject };
      }

      let kbLoadResult = { status: 'fulfilled', value: null };
      if (this.currentProject && this.currentProject.knowledge_base_id) {
        try {
          const kbValue = await this.loadProjectKnowledgeBase(this.currentProject.id, this.currentProject.knowledge_base_id);
          kbLoadResult = { status: 'fulfilled', value: kbValue };
        } catch (kbError) {
          _capture(kbError, { module: MODULE, method: "loadProjectKnowledgeBase" }, this.errorReporter);
          kbLoadResult = { status: 'rejected', reason: kbError };
          this.pmNotify?.error?.(`[ProjectManager] Failed to load knowledge base details for KB ID ${this.currentProject.knowledge_base_id}`, {
            source: "loadProjectDetails",
            extra: { projectId: id, knowledgeBaseId: this.currentProject.knowledge_base_id, error: kbError }
          });
        }
      } else {
        this.pmNotify?.info?.(`[ProjectManager] No knowledge_base_id found on project ${id}, skipping dedicated KB load.`, {
          source: "loadProjectDetails",
          extra: { projectId: id }
        });
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
        this.notify.error(
          `[ProjectManager] Some project sub-resources failed to load: ${criticalErrors.map(e => e?.message || String(e)).join(', ')}`,
          { group: true, context: 'projectManager', module: MODULE, source: 'loadProjectDetails', detail: { id, failed: criticalErrors } }
        );
        this._emit('projectDetailsLoadError', { id, errors: criticalErrors });
      }
      this.notify.success(`[ProjectManager] Project ${id} and its sub-resources processed.`, { group: true, context: 'projectManager', module: MODULE, source: 'loadProjectDetails', detail: { id } });

      this._emit('projectDetailsFullyLoaded', { projectId: this.currentProject.id });

      this.debugTools?.stop?.(_t, 'ProjectManager.loadProjectDetails');
      return { ...this.currentProject };
    } catch (err) {
      _capture(err, { module: MODULE, method: "loadProjectDetails" }, this.errorReporter);
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
      this.debugTools?.stop?.(_t, 'ProjectManager.loadProjectDetails-error');
      return null;
    }
  }

  async loadProjectKnowledgeBase(projectId, knowledgeBaseId) {
    if (!knowledgeBaseId) {
      this.pmNotify?.info(`[ProjectManager] No knowledgeBaseId provided for project ${projectId}. Assuming no specific KB to load.`, {
        group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { projectId }
      });
      this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: null });
      return null;
    }
    try {
      this.pmNotify?.info(`[ProjectManager] Loading knowledge base details for KB ID ${knowledgeBaseId} (Project ${projectId})...`, {
        group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { projectId, knowledgeBaseId }
      });
      const url = this._CONFIG.KB_DETAIL_URL_TEMPLATE
        .replace('{id}', projectId)
        .replace('{kb_id}', knowledgeBaseId);
      const res = await this._req(url, undefined, "loadProjectKnowledgeBase");
      const kb = res?.data || res;
      if (!kb || !kb.id) {
        this.pmNotify?.warn(`[ProjectManager] No valid knowledge base data returned for KB ID ${knowledgeBaseId} (Project ${projectId}).`, {
          group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { projectId, knowledgeBaseId, response: res }
        });
        this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: null });
        return null;
      } else {
        this.pmNotify?.success(`[ProjectManager] Knowledge base details loaded for KB ID ${kb.id} (Project ${projectId}).`, {
          group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { projectId, kbId: kb.id }
        });
        this._emit('projectKnowledgeBaseLoaded', { id: projectId, knowledgeBase: kb });
        return kb;
      }
    } catch (err) {
      _capture(err, { module: MODULE, method: "loadProjectKnowledgeBase" }, this.errorReporter);
      this.pmNotify?.error(`[ProjectManager] Error loading knowledge base details for KB ID ${knowledgeBaseId} (Project ${projectId}).`, {
        group: true, context: 'projectManager', module: MODULE, source: 'loadProjectKnowledgeBase', detail: { projectId, knowledgeBaseId }, originalError: err
      });
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
      _capture(err, { module: MODULE, method: "loadProjectStats" }, this.errorReporter);
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
      _capture(err, { module: MODULE, method: "loadProjectFiles" }, this.errorReporter);
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
      _capture(err, { module: MODULE, method: "loadProjectConversations" }, this.errorReporter);
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
      _capture(err, { module: MODULE, method: "loadProjectArtifacts" }, this.errorReporter);
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
      this.notify.success(
        `[ProjectManager] Project ${isUpdate ? 'updated' : 'created'}: ${proj.id}`,
        { group: true, context: 'projectManager', module: MODULE, source: 'saveProject', endpoint: url, method, detail: { id: proj.id } }
      );
      return proj;
    } catch (err) {
      _capture(err, { module: MODULE, method: "saveProject" }, this.errorReporter);
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
      _capture(err, { module: MODULE, method: "deleteProject" }, this.errorReporter);
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
      _capture(err, { module: MODULE, method: "toggleArchiveProject" }, this.errorReporter);
      this._handleErr('projectArchiveToggled', err, null, { method: 'toggleArchiveProject', endpoint: this._CONFIG.ARCHIVE.replace('{id}', id) });
      throw err;
    }
  }

  async createConversation(projectId, opts = {}) {
    try {
      this.storage.setItem?.('selectedProjectId', projectId);
      return await this.chatManager.createNewConversation(projectId, opts);
    } catch (err) {
      _capture(err, { module: MODULE, method: "createConversation" }, this.errorReporter);
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
      const convo = res?.conversation;
      if (!convo || !convo.id) throw new Error('Invalid conversation data received');
      this.notify.info(`[ProjectManager] Conversation ${conversationId} fetched.`, { group: true, context: 'projectManager', module: MODULE, source: 'getConversation', detail: { conversationId, projectId } });
      return convo;
    } catch (err) {
      _capture(err, { module: MODULE, method: "getConversation" }, this.errorReporter);
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
      _capture(err, { module: MODULE, method: "deleteProjectConversation" }, this.errorReporter);
      this._handleErr('deleteProjectConversationError', err, null, { source: 'deleteProjectConversation', detail: { conversationId, projectId } });
      throw err;
    }
  }

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
    return retryWithBackoff(
      async () => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('projectId', projectId);
        await this._req(`/api/projects/${projectId}/files/`, {
          method: 'POST',
          body: formData
        }, "uploadFileWithRetry");
        this.notify.success(`[ProjectManager] File uploaded for project ${projectId}`, { group: true, context: 'projectManager', module: MODULE, source: 'uploadFileWithRetry', detail: { projectId, fileName: file.name } });
        return true;
      },
      maxRetries,
      this.timer,
      this.notify,
      this.errorReporter
    );
  }

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
      _capture(err, { module: MODULE, method: "createProject" }, this.errorReporter);
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
      _capture(err, { module: MODULE, method: "createDefaultConversation" }, this.errorReporter);
      this.notify.error('[ProjectManager] Failed to create default conversation: ' + (err?.message || err), { group: true, context: 'projectManager', module: MODULE, source: 'createDefaultConversation', detail: { projectId }, originalError: err });
      return null;
    }
  }

  async retryWithBackoff(fn, maxRetries = 3) {
    return retryWithBackoff(fn, maxRetries, this.timer, this.notify, this.errorReporter);
  }

  async initialize() {
    this.pmNotify.info('[ProjectManager] initialize() called', { group: true, context: 'projectManager', module: MODULE, source: 'initialize' });
    this.pmNotify.debug('[ProjectManager] Dependencies status:', {
      source: 'initialize',
      extra: {
        appAvailable: !!this.app,
        chatManagerAvailable: !!this.chatManager,
        apiRequestAvailable: !!this.apiRequest,
        notifyAvailable: !!this.notify
      }
    });

    this.pmNotify.info('[ProjectManager] initialize() completed successfully.', { group: true, context: 'projectManager', module: MODULE, source: 'initialize' });
    return true;
  }

  destroy() {
    this.pmNotify?.info?.('[ProjectManager] destroy() called', { group: true, context: 'projectManager', module: MODULE, source: 'destroy' });
    if (this.listenerTracker && typeof this.listenerTracker.remove === 'function') {
      this.listenerTracker.remove();
      this.pmNotify?.debug?.('[ProjectManager] Listener cleanup requested via listenerTracker.', { source: 'destroy' });
    } else {
      this.pmNotify?.warn?.('[ProjectManager] listenerTracker.remove is not available. Listeners may not be cleaned up.', { source: 'destroy' });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Readiness Gate wrapper                                                     */
/* -------------------------------------------------------------------------- */

function _readyWrapper(deps) {
  return Promise.resolve(
    deps.DependencySystem?.waitFor?.(['app', 'notify']) ??
    globalThis.DependencySystem?.waitFor?.(['app', 'notify'])
  ).then(() => {
    const instance = new ProjectManager(deps);
    deps.DependencySystem?.register?.('projectManager', instance);
    return instance;
  });
}

/* Factory export – always returns a NEW instance */

export function createProjectManager(deps = {}) {
  return _readyWrapper(deps);
}

export { isValidProjectId, extractResourceList, normalizeProjectResponse, retryWithBackoff };
export default createProjectManager;
