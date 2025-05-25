/**
 * uiRenderer.js - Sidebar/project/conversations UI rendering (factory, DI, compliance).
 * Pattern Guardrails enforced: factory export, all DI, readiness service, cleanup, logger, safeHandler, no top-level code.
 */

export function createUiRenderer(deps = {}) {
  const { domAPI, eventHandlers, apiRequest, apiEndpoints, onConversationSelect, onProjectSelect, domReadinessService, logger, DependencySystem } = deps;

  // ==== Pattern 1: Factory & DI checks ====
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
  const CONTEXT = "uiRenderer";

  // ==== Pattern 7: App readiness strictly via domReadinessService ====
  let _domReady = null;
  async function ensureSidebarReady() {
    if (!_domReady) {
      _domReady = domReadinessService.dependenciesAndElements([
        "#projectsSection ul",
        "#recentChatsSection ul",
        "#starredChatsSection ul"
      ]);
    }
    return await _domReady;
  }

  // ==== Pattern 2: All DOM/global/event access via DI ====

  // ==== Pattern 4: Centralised Event Handling + 5: Context Tags ====
  function cleanup() {
    try {
      eventHandlers.cleanupListeners({ context: CONTEXT });
    } catch (err) {
      logger.error('Cleanup error', err, { context: CONTEXT });
    }
  }

  function _clearList(selector) {
    const listElement = domAPI.querySelector(selector);
    if (listElement) {
      domAPI.setInnerHTML(listElement, '');   // sanitised
    }
    return listElement;
  }

  function _setLoadingState(listElement, isLoading) {
    if (!listElement) return;
    if (isLoading) {
      const loadingEl = domAPI.createElement('li');
      loadingEl.className = 'loading-indicator p-2 text-center text-sm italic';
      domAPI.setTextContent(loadingEl, 'Loading...');
      listElement.appendChild(loadingEl);
    } else {
      const loadingEl = listElement.querySelector('.loading-indicator');
      if (loadingEl) {
        loadingEl.remove();
      }
    }
  }

  function _displayMessageInList(listElement, message, cssClass = 'info-message') {
    if (!listElement) return;
    const messageEl = domAPI.createElement('li');
    messageEl.className = `${cssClass} p-2 text-center text-sm`;
    domAPI.setTextContent(messageEl, message);
    listElement.appendChild(messageEl);
  }

  function _extractConversationsFromResponse(response) {
    if (response?.data?.conversations && Array.isArray(response.data.conversations)) {
      return response.data.conversations;
    }
    if (response?.conversations && Array.isArray(response.conversations)) {
      return response.conversations;
    }
    if (Array.isArray(response?.data)) {
      return response.data;
    }
    if (Array.isArray(response)) {
      return response;
    }
    return [];
  }

  // Use canonical safeHandler from DI
  const safeHandler = DependencySystem.modules.get('safeHandler');

  function _createConversationListItem(
    conversation,
    isListItemForStarredTab = false,
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    // Robust: allow sidebar to be undefined/null and fallback safely
    const isStarredFn = typeof isConversationStarredFn === 'function' ? isConversationStarredFn : () => false;
    const toggleStarCb = typeof toggleStarConversationCb === 'function' ? toggleStarConversationCb : () => { };

    const li = domAPI.createElement('li');
    li.className = 'py-1';

    const link = domAPI.createElement('a');
    link.href = '#';
    link.className = 'flex items-center justify-between p-2 hover:bg-base-300 rounded-md';
    domAPI.setTextContent(link, conversation.title || 'Untitled Conversation');

    eventHandlers.trackListener(
      link,
      'click',
      safeHandler(
        (e) => {
          domAPI.preventDefault(e);
          onConversationSelect(conversation.id);
        },
        `Select conversation (${conversation.id})`
      ),
      { description: `Select conversation ${conversation.id}`, context: CONTEXT }
    );

    const starButton = domAPI.createElement('button');
    starButton.className = 'btn btn-ghost btn-sm btn-square text-accent';
    const isStarred = isStarredFn(conversation.id);

    domAPI.setInnerHTML(
      starButton,
      isStarred
        ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.116 3.552.975 5.34c.236 1.282-1.033 2.288-2.188 1.65l-4.851-2.958-4.851 2.958c-1.155.638-2.424-.368-2.188-1.65l.975-5.34-4.116-3.552c-.887-.76-.415-2.212.749-2.305l5.404-.434L10.788 3.21Z" clip-rule="evenodd" /></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.615.049.878.83.423 1.263l-4.118 3.556a.563.563 0 0 0-.162.505l1.046 5.456c.12.618-.528 1.09-.996.77l-4.912-2.93a.562.562 0 0 0-.621 0l-4.912 2.93c-.468.32-.996-.77-.996-.77l1.046-5.456a.563.563 0 0 0-.162-.505L1.71 10.664c-.455-.433-.192-1.214.423-1.263l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>'
    );

    starButton.setAttribute('aria-label', isStarred ? 'Unstar conversation' : 'Star conversation');
    starButton.setAttribute('aria-pressed', isStarred.toString());

    eventHandlers.trackListener(
      starButton,
      'click',
      safeHandler(
        () => {
          toggleStarCb(conversation.id);
        },
        `Toggle star (${conversation.id})`
      ),
      { description: `Toggle star for conversation ${conversation.id}`, context: CONTEXT }
    );

    const wrapperDiv = domAPI.createElement('div');
    wrapperDiv.className = 'flex items-center w-full';
    domAPI.appendChild(wrapperDiv, link);
    domAPI.appendChild(wrapperDiv, starButton);
    domAPI.appendChild(li, wrapperDiv);

    return li;
  }

  /**
   * Fetches and renders conversations in the "recent" list.
   * @param {string} projectId - The current project ID.
   * @param {string} [searchTerm=''] - Optional search term.
   * @param {Function} [isConversationStarredFn] - Checks if a conversation is starred; if not provided, behaves as "never starred".
   * @param {Function} [toggleStarConversationCb] - Toggles star/unstar; if not provided, does nothing (no-op).
   *
   * Star/Unstar functionality will gracefully degrade if callbacks are omitted.
   */
  async function renderConversations(
    projectId,
    searchTerm = '',
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    try {
      await ensureSidebarReady();
    } catch (err) {
      logger.error('[UiRenderer][renderConversations] Sidebar not ready', err, { context: CONTEXT });
      return;
    }

    const RECENT_CONVERSATIONS_LIST_SELECTOR = '#recentChatsSection ul';

    const listElement = _clearList(RECENT_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;
    if (!projectId) {
      if (logger && logger.info)
        logger.info('[UiRenderer][renderConversations] called with empty/null projectId', {
          context: CONTEXT,
          module: CONTEXT,
          fn: 'renderConversations',
          projectId,
          searchTerm
        });
      _displayMessageInList(
        listElement,
        'No project selected. Please select a project from the Projects tab.',
        'info-message'
      );
      return;
    }

    _setLoadingState(listElement, true);
    try {
      let conversationsUrl;
      if (typeof apiEndpoints.CONVERSATIONS === 'function') {
        conversationsUrl = apiEndpoints.CONVERSATIONS(projectId);
      } else {
        conversationsUrl = (
          apiEndpoints.CONVERSATIONS(projectId) ||
          apiEndpoints.PROJECT_CONVERSATIONS_URL_TEMPLATE
        )?.replace('{id}', projectId);
      }

      if (!conversationsUrl) {
        _displayMessageInList(
          listElement,
          'Configuration error: Missing conversation API endpoint.',
          'error-message'
        );
        _setLoadingState(listElement, false);
        return;
      }

      const queryParams = {};
      if (searchTerm) {
        queryParams.search = searchTerm;
      }

      const response = await apiRequest(conversationsUrl, {
        method: 'GET',
        params: queryParams
      });
      const conversations = _extractConversationsFromResponse(response);

      if (logger && logger.info) {
        const sample = Array.isArray(conversations) ? conversations.slice(0, 2) : conversations;
        logger.info(
          `[UiRenderer][renderConversations] arrayLength=${Array.isArray(conversations) ? conversations.length : 'non-array'}`,
          {
            context: CONTEXT,
            module: CONTEXT,
            fn: 'renderConversations',
            projectId,
            searchTerm,
            conversationsSample: sample,
            full: Array.isArray(conversations) && conversations.length > 0 ? conversations[0] : undefined
          }
        );
      }

      _setLoadingState(listElement, false);

      if (conversations.length === 0) {
        _displayMessageInList(
          listElement,
          searchTerm ? 'No conversations match your search.' : 'No recent conversations in this project.'
        );
      } else {
        conversations.forEach((convo) => {
          const listItem = _createConversationListItem(
            convo,
            false,
            isConversationStarredFn,
            toggleStarConversationCb
          );
          listElement.appendChild(listItem);
        });
      }
    } catch (error) {
      _setLoadingState(listElement, false);
      logger.error(
        "[UiRenderer][renderConversations] Error loading conversations",
        error,
        {
          context: CONTEXT,
          module: CONTEXT,
          fn: 'renderConversations',
          projectId,
          searchTerm
        }
      );
      _displayMessageInList(
        listElement,
        'Error loading conversations. Please try again.',
        'error-message'
      );
    }
  }

  /**
   * Fetches and renders "starred" conversations.
   * @param {string} projectId - The current project ID.
   * @param {string} [searchTerm=''] - Optional search term.
   * @param {Function} [isConversationStarredFn] - Checks if a conversation is starred; if not provided, behaves as "never starred".
   * @param {Function} [toggleStarConversationCb] - Toggles star/unstar; if not provided, does nothing (no-op).
   *
   * Will gracefully degrade if callbacks are not supplied.
   */
  async function renderStarredConversations(
    projectId,
    searchTerm = '',
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    await ensureSidebarReady();
    const STARRED_CONVERSATIONS_LIST_SELECTOR = '#starredChatsSection ul';
    const listElement = _clearList(STARRED_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;
    if (!projectId) return;

    _setLoadingState(listElement, true);

    try {
      let conversationsUrl;
      if (typeof apiEndpoints.CONVERSATIONS === 'function') {
        conversationsUrl = apiEndpoints.CONVERSATIONS(projectId);
      } else {
        conversationsUrl = (
          apiEndpoints.CONVERSATIONS(projectId) ||
          apiEndpoints.PROJECT_CONVERSATIONS_URL_TEMPLATE
        )?.replace('{id}', projectId);
      }

      if (!conversationsUrl) {
        _displayMessageInList(listElement, 'Configuration error.', 'error-message');
        _setLoadingState(listElement, false);
        return;
      }

      const queryParams = { starred: 'true' };
      if (searchTerm) {
        queryParams.search = searchTerm;
      }

      const response = await apiRequest(conversationsUrl, {
        method: 'GET',
        params: queryParams
      });
      let conversations = _extractConversationsFromResponse(response);

      _setLoadingState(listElement, false);

      // Provide safe fallback for isConversationStarredFn here too
      const isStarredFn = typeof isConversationStarredFn === 'function' ? isConversationStarredFn : () => false;

      if (conversations.length === 0) {
        _displayMessageInList(
          listElement,
          searchTerm ? 'No starred conversations match your search.'
            : 'No starred conversations in this project.'
        );
      } else {
        conversations.forEach((convo) => {
          if (isStarredFn(convo.id)) {
            const listItem = _createConversationListItem(
              convo,
              true,
              isConversationStarredFn,
              toggleStarConversationCb
            );
            listElement.appendChild(listItem);
          }
        });
        if (listElement.children.length === 0) {
          _displayMessageInList(
            listElement,
            searchTerm ? 'No starred conversations match your search.' : 'No starred conversations in this project.'
          );
        }
      }
    } catch (error) {
      _setLoadingState(listElement, false);
      logger.error("[UiRenderer] Error loading starred conversations", error, { context: CONTEXT });
      _displayMessageInList(
        listElement,
        'Error loading starred conversations.',
        'error-message'
      );
    }
  }

  /**
   * Renders a list of projects in the sidebar.
   * @param {Array} projects - Array of project objects.
   */
  async function renderProjects(projects = []) {
    try {
      await ensureSidebarReady();
    } catch (err) {
      logger.error('[UiRenderer][renderProjects] Sidebar not ready', err, { context: CONTEXT });
      return;
    }

    const PROJECT_LIST_SELECTOR = '#projectsSection ul';

    const listElement = _clearList(PROJECT_LIST_SELECTOR);
    if (!listElement) {
      logger.warn('[UiRenderer][renderProjects] Project list element not found', { selector: PROJECT_LIST_SELECTOR, context: CONTEXT });
      return;
    }

    if (logger && logger.info) {
      const sample = Array.isArray(projects) ? projects.slice(0, 2) : projects;
      logger.info(
        `[UiRenderer][renderProjects] arrayLength=${Array.isArray(projects) ? projects.length : 'non-array'}`,
        {
          context: CONTEXT,
          module: CONTEXT,
          fn: 'renderProjects',
          projectsSample: sample,
          full: Array.isArray(projects) && projects.length > 0 ? projects[0] : undefined
        }
      );
    }

    if (projects.length === 0) {
      _displayMessageInList(listElement, 'No projects found.');
      return;
    }

    projects.forEach((project) => {
      const li = domAPI.createElement('li');
      li.className = 'py-1';

      const link = domAPI.createElement('a');
      link.href = '#';
      link.className = 'block p-2 hover:bg-base-300 rounded-md';
      domAPI.setTextContent(link, project.name || 'Untitled Project');

      eventHandlers.trackListener(
        link,
        'click',
        safeHandler(
          (e) => {
            domAPI.preventDefault(e);
            onProjectSelect(project.id);
          },
          `Select project (${project.id})`
        ),
        { description: `Select project ${project.id}`, context: CONTEXT }
      );

      domAPI.appendChild(li, link);
      listElement.appendChild(li);
    });
  }

  // Return fully compliant API object (Pattern 1)
  return {
    renderConversations,
    renderStarredConversations,
    renderProjects,
    cleanup
  };
}
