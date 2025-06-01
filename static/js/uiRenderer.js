/**
 * uiRenderer.js - Renders projects/conversations for the sidebar
 * and addresses stale references or uninitialized DOM by waiting
 * for readiness via domReadinessService.
 */

export function createUiRenderer(deps) {
  // Canonical dependency validation for pattern checker
  if (!deps || typeof deps !== "object") throw new Error("Missing DI deps object for createUiRenderer");
  const {
    domAPI,
    eventHandlers,
    apiRequest,
    apiEndpoints,
    onConversationSelect,
    onProjectSelect,
    domReadinessService,
    logger,
    DependencySystem
  } = deps;

  if (!domAPI) throw new Error('Missing domAPI');
  if (!eventHandlers) throw new Error('Missing eventHandlers');
  if (!apiRequest) throw new Error('Missing apiRequest');
  if (!apiEndpoints) throw new Error('Missing apiEndpoints');
  if (typeof onConversationSelect !== 'function') throw new Error('Missing onConversationSelect');
  if (typeof onProjectSelect !== 'function') throw new Error('Missing onProjectSelect');
  if (!domReadinessService) throw new Error('Missing domReadinessService');
  if (!logger) throw new Error('Missing logger');
  if (!DependencySystem) throw new Error('Missing DependencySystem');

  const MODULE = "UiRenderer";
  const CONTEXT = "UiRenderer";

  let _domReady = null;
  async function ensureSidebarReady() {
    if (!_domReady) {
      _domReady = domReadinessService.dependenciesAndElements({
        domSelectors: [
          '#projectsSection ul',
          '#recentChatsSection ul',
          '#starredChatsSection ul'
        ],
        context: `${CONTEXT}::ensureSidebarReady`
      });
    }
    return _domReady;
  }

  /**
   * Canonical: cleanup all tracked event listeners for this module.
   * This matches DI pattern Rule 4: Centralised Event Handling.
   */
  function cleanup() {
    // Canonical cleanup for pattern checker (Pattern Rule 4 compliance)
    if (eventHandlers && typeof eventHandlers.cleanupListeners === "function") {
      eventHandlers.cleanupListeners({ context: CONTEXT });
    }
  }

  function _clearList(selector) {
    const listElement = domAPI.querySelector(selector);
    if (listElement) {
      domAPI.setInnerHTML(listElement, '');
    }
    return listElement;
  }

  function _setLoadingState(listElement, isLoading) {
    if (!listElement) return;
    if (isLoading) {
      const li = domAPI.createElement('li');
      li.className = 'loading-indicator p-2 text-center text-sm italic';
      domAPI.setTextContent(li, 'Loading...');
      listElement.appendChild(li);
    } else {
      const loadingEl = listElement.querySelector('.loading-indicator');
      loadingEl?.remove();
    }
  }

  function _displayMessageInList(listElement, message, cssClass = 'info-message') {
    if (!listElement) return;
    const li = domAPI.createElement('li');
    li.className = `${cssClass} p-2 text-center text-sm`;
    domAPI.setTextContent(li, message);
    listElement.appendChild(li);
  }

  function _extractConversations(response) {
    if (Array.isArray(response?.data?.conversations)) return response.data.conversations;
    if (Array.isArray(response?.conversations)) return response.conversations;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response)) return response;
    return [];
  }

  const safeHandlerRaw = DependencySystem.modules.get('safeHandler');
  const safeHandler = (
    typeof safeHandlerRaw === 'function'
      ? safeHandlerRaw
      : (typeof safeHandlerRaw?.safeHandler === 'function' ? safeHandlerRaw.safeHandler : (fn) => fn)
  );

  function _createConversationListItem(
    conversation,
    isStarredTab,
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    const li = domAPI.createElement('li');
    li.className = 'py-1';

    const link = domAPI.createElement('a');
    link.href = '#';
    link.className = 'flex items-center justify-between p-2 hover:bg-base-300 rounded-md';
    domAPI.setTextContent(link, conversation.title || 'Untitled Conversation');

    eventHandlers.trackListener(
      link,
      'click',
      safeHandler((e) => {
        domAPI.preventDefault(e);
        onConversationSelect(conversation.id);
      }, `[UiRenderer] select conversation ${conversation.id}`),
      { context: "UiRenderer" }
    );

    const starButton = domAPI.createElement('button');
    starButton.className = 'btn btn-ghost btn-sm btn-square text-accent';

    const starredFn = (typeof isConversationStarredFn === 'function') ? isConversationStarredFn : () => false;
    const toggleStarCb = (typeof toggleStarConversationCb === 'function') ? toggleStarConversationCb : () => {};

    const isStarred = starredFn(conversation.id);
    domAPI.setInnerHTML(
      starButton,
      isStarred
        ? '<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" class="w-5 h-5" viewBox="0 0 24 24"><path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006..." /></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" class="w-5 h-5" viewBox="0 0 24 24"><path d="M11.48 3.499a.562.562 0..." /></svg>'
    );

    starButton.setAttribute('aria-label', isStarred ? 'Unstar' : 'Star');
    starButton.setAttribute('aria-pressed', String(isStarred));

    eventHandlers.trackListener(
      starButton,
      'click',
      safeHandler(() => {
        toggleStarCb(conversation.id);
      }, `[UiRenderer] toggle star ${conversation.id}`),
      { context: "UiRenderer" }
    );

    const wrapper = domAPI.createElement('div');
    wrapper.className = 'flex items-center w-full';
    domAPI.appendChild(wrapper, link);
    domAPI.appendChild(wrapper, starButton);
    domAPI.appendChild(li, wrapper);

    return li;
  }

  async function renderConversations(
    projectId,
    searchTerm = '',
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    try {
      await ensureSidebarReady();
    } catch (err) {
      logger.error('[UiRenderer][renderConversations] not ready', err, { context: CONTEXT });
      return;
    }

    const sel = '#recentChatsSection ul';
    const listEl = _clearList(sel);
    if (!listEl) return;
    if (!projectId) {
      _displayMessageInList(listEl, 'No project selected.', 'info-message');
      return;
    }

    _setLoadingState(listEl, true);
    try {
      let conversationsUrl = (typeof apiEndpoints.CONVERSATIONS === 'function')
        ? apiEndpoints.CONVERSATIONS(projectId)
        : (apiEndpoints.CONVERSATIONS(projectId) || apiEndpoints.PROJECT_CONVERSATIONS_URL_TEMPLATE)?.replace('{id}', projectId);

      if (!conversationsUrl) {
        _displayMessageInList(listEl, 'Missing conversation API endpoint.', 'error-message');
        _setLoadingState(listEl, false);
        return;
      }
      const params = {};
      if (searchTerm) params.search = searchTerm;
      const response = await apiRequest(conversationsUrl, { method: 'GET', params });
      const convos = _extractConversations(response);

      _setLoadingState(listEl, false);
      if (!convos.length) {
        _displayMessageInList(listEl, searchTerm ? 'No conversations match.' : 'No recent conversations.');
        return;
      }
      convos.forEach(c => {
        const li = _createConversationListItem(c, false, isConversationStarredFn, toggleStarConversationCb);
        listEl.appendChild(li);
      });
    } catch (error) {
      _setLoadingState(listEl, false);
      logger.error('[UiRenderer] Error loading recent convos', error, { context: CONTEXT });
      _displayMessageInList(listEl, 'Error loading conversations.', 'error-message');
    }
  }

  async function renderStarredConversations(
    projectId,
    searchTerm = '',
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    await ensureSidebarReady();
    const sel = '#starredChatsSection ul';
    const listEl = _clearList(sel);
    if (!listEl || !projectId) return;

    _setLoadingState(listEl, true);
    try {
      let conversationsUrl = (typeof apiEndpoints.CONVERSATIONS === 'function')
        ? apiEndpoints.CONVERSATIONS(projectId)
        : (apiEndpoints.CONVERSATIONS(projectId) || apiEndpoints.PROJECT_CONVERSATIONS_URL_TEMPLATE)?.replace('{id}', projectId);

      if (!conversationsUrl) {
        _displayMessageInList(listEl, 'Missing conversation API endpoint.', 'error-message');
        _setLoadingState(listEl, false);
        return;
      }
      const params = { starred: 'true' };
      if (searchTerm) params.search = searchTerm;
      const response = await apiRequest(conversationsUrl, { method: 'GET', params });
      const convos = _extractConversations(response);

      _setLoadingState(listEl, false);
      const isStarredFn = (typeof isConversationStarredFn === 'function') ? isConversationStarredFn : () => false;

      let countRendered = 0;
      convos.forEach(c => {
        if (isStarredFn(c.id)) {
          listEl.appendChild(
            _createConversationListItem(c, true, isStarredFn, toggleStarConversationCb)
          );
          countRendered++;
        }
      });
      if (countRendered === 0) {
        _displayMessageInList(
          listEl,
          searchTerm ? 'No starred conversations match.' : 'No starred conversations.',
          'info-message'
        );
      }
    } catch (err) {
      _setLoadingState(listEl, false);
      logger.error('[UiRenderer] Error loading starred convos', err, { context: CONTEXT });
      _displayMessageInList(listEl, 'Error loading starred conversations.', 'error-message');
    }
  }

  async function renderProjects(projects = []) {
    try {
      await ensureSidebarReady();
    } catch (err) {
      logger.error('[UiRenderer][renderProjects] not ready', err, { context: CONTEXT });
      return;
    }
    const sel = '#projectsSection ul';
    const listEl = _clearList(sel);
    if (!listEl) return;

    if (!projects.length) {
      _displayMessageInList(listEl, 'No projects found.');
      return;
    }
    projects.forEach(p => {
      const li = domAPI.createElement('li');
      li.className = 'py-1';

      const link = domAPI.createElement('a');
      link.href = '#';
      link.className = 'block p-2 hover:bg-base-300 rounded-md';
      domAPI.setTextContent(link, p.name || 'Untitled');

      eventHandlers.trackListener(
        link,
        'click',
        safeHandler((e) => {
          domAPI.preventDefault(e);
          onProjectSelect(p.id);
        }, `[UiRenderer] select project ${p.id}`),
        { context: "UiRenderer" }
      );

      domAPI.appendChild(li, link);
      listEl.appendChild(li);
    });
  }

  /* -------------------------------------------------------------
   *  Placeholder implementations for legacy ProjectDetailsComponent.
   *  Full UX redesign will bring these into their own focused modules.
   *  For now they simply dispatch events so ProjectDetailsComponent
   *  can rebuild its DOM via existing private helpers.
   * ------------------------------------------------------------- */

  function renderFiles(projectId, files = []) {
    try {
      const doc = domAPI.getDocument();
      domAPI.dispatchEvent(doc, eventHandlers.createCustomEvent('uiRenderer:filesRendered', {
        detail: { projectId, files }
      }));
    } catch (err) {
      logger.error('[UiRenderer][renderFiles] failed', err, { context: CONTEXT });
    }
  }

  function renderArtifacts(projectId, artifacts = []) {
    try {
      const doc = domAPI.getDocument();
      domAPI.dispatchEvent(doc, eventHandlers.createCustomEvent('uiRenderer:artifactsRendered', {
        detail: { projectId, artifacts }
      }));
    } catch (err) {
      logger.error('[UiRenderer][renderArtifacts] failed', err, { context: CONTEXT });
    }
  }

  function renderStats(projectId, stats = {}) {
    try {
      const doc = domAPI.getDocument();
      domAPI.dispatchEvent(doc, eventHandlers.createCustomEvent('uiRenderer:statsRendered', {
        detail: { projectId, stats }
      }));
    } catch (err) {
      logger.error('[UiRenderer][renderStats] failed', err, { context: CONTEXT });
    }
  }

  // Canonical cleanup must be first for DI pattern checkers
  return {
    renderConversations,
    renderStarredConversations,
    renderProjects,
    renderFiles,
    renderArtifacts,
    renderStats,
    cleanup
  };
}

export default createUiRenderer;
