/**
 * uiRenderer.js - Renders lists for the sidebar (projects, conversations), with all notification/logging references removed.
 */

// Removed notification/logging imports. Only keep what's essential:
// import { safeInvoker } from './utils/notifications-helpers.js'; // Removed

const MODULE = "UiRenderer";

/**
 * Factory function to create a UI renderer module.
 *
 * @param {Object} config
 * @param {Object} config.domAPI - Object providing DOM manipulation methods.
 * @param {Object} config.eventHandlers - Object providing listener registration (trackListener).
 * @param {Function} config.apiRequest - Function to perform API requests.
 * @param {Object|Function} config.apiEndpoints - Object or function to construct endpoints.
 * @param {Function} config.onConversationSelect - Callback invoked when a conversation is selected.
 * @param {Function} config.onProjectSelect - Callback invoked when a project is selected.
 * @returns {Object} Object containing rendering methods.
 */
export function createUiRenderer({
  domAPI,
  eventHandlers,
  apiRequest,
  apiEndpoints,
  onConversationSelect,
  onProjectSelect
} = {}) {
  // Basic validations (notifications removed)
  if (!domAPI) {
    throw new Error(`[${MODULE}] domAPI is required.`);
  }
  if (!eventHandlers) {
    throw new Error(`[${MODULE}] eventHandlers is required.`);
  }
  if (!apiRequest) {
    throw new Error(`[${MODULE}] apiRequest is required.`);
  }
  if (!apiEndpoints) {
    throw new Error(`[${MODULE}] apiEndpoints is required.`);
  }
  if (typeof onConversationSelect !== 'function') {
    throw new Error(`[${MODULE}] onConversationSelect callback is required.`);
  }
  if (typeof onProjectSelect !== 'function') {
    throw new Error(`[${MODULE}] onProjectSelect callback is required.`);
  }

  // Selectors for different UI sections
  const PROJECT_LIST_SELECTOR = '#projectsSection ul';
  const RECENT_CONVERSATIONS_LIST_SELECTOR = '#recentChatsSection ul';
  const STARRED_CONVERSATIONS_LIST_SELECTOR = '#starredChatsSection ul';

  /**
   * Clears the list identified by the given selector.
   * @param {string} selector - CSS selector for the list element.
   * @returns {HTMLElement|null} The list element, or null if not found.
   */
  function _clearList(selector) {
    const listElement = domAPI.querySelector(selector);
    if (listElement) {
      listElement.innerHTML = '';
    }
    // No notification calls; just return the element.
    return listElement;
  }

  /**
   * Toggles a "loading" state by inserting/removing a loading indicator element.
   * @param {HTMLElement} listElement - The UI list element.
   * @param {boolean} isLoading - Whether to show or hide the loading indicator.
   */
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

  /**
   * Displays a simple message (e.g., an error or info message) in a list.
   * @param {HTMLElement} listElement - The target list element.
   * @param {string} message - Text content of the message.
   * @param {string} [cssClass='info-message'] - CSS class to style the list item.
   */
  function _displayMessageInList(listElement, message, cssClass = 'info-message') {
    if (!listElement) return;
    const messageEl = domAPI.createElement('li');
    messageEl.className = `${cssClass} p-2 text-center text-sm`;
    domAPI.setTextContent(messageEl, message);
    listElement.appendChild(messageEl);
  }

  /**
   * Extracts an array of conversation objects from various possible API responses.
   * @param {any} response - The raw response from an API request.
   * @returns {Array} An array of conversation objects or an empty array if not found.
   */
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
    // No logging/notification; return empty array
    return [];
  }

  /**
   * Creates a <li> element that displays a conversation item, including a star button.
   * @param {Object} conversation - Conversation data.
   * @param {boolean} isListItemForStarredTab - Whether this item is for the starred conversation list.
   * @param {Function} isConversationStarredFn - Function to check if a conversation is starred.
   * @param {Function} toggleStarConversationCb - Callback to toggle star/unstar.
   * @returns {HTMLElement} The newly created <li> element.
   */
  function _createConversationListItem(
    conversation,
    isListItemForStarredTab = false,
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    // Provide default fallbacks to avoid errors; no warnings/logging
    if (typeof isConversationStarredFn !== 'function') {
      isConversationStarredFn = () => false;
    }
    if (typeof toggleStarConversationCb !== 'function') {
      toggleStarConversationCb = () => {};
    }

    const li = domAPI.createElement('li');
    li.className = 'py-1';

    const link = domAPI.createElement('a');
    link.href = '#';
    link.className = 'flex items-center justify-between p-2 hover:bg-base-300 rounded-md';
    domAPI.setTextContent(link, conversation.title || 'Untitled Conversation');

    // Call event handlers directly; removed safeInvoker
    eventHandlers.trackListener(
      link,
      'click',
      (e) => {
        domAPI.preventDefault(e);
        onConversationSelect(conversation.id);
      },
      { description: `Select conversation ${conversation.id}`, context: MODULE }
    );

    // Star button
    const starButton = domAPI.createElement('button');
    starButton.className = 'btn btn-ghost btn-sm btn-square text-accent';
    const isStarred = isConversationStarredFn(conversation.id);

    domAPI.setInnerHTML(
      starButton,
      isStarred
        ? // Starred icon
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.116 3.552.975 5.34c.236 1.282-1.033 2.288-2.188 1.65l-4.851-2.958-4.851 2.958c-1.155.638-2.424-.368-2.188-1.65l.975-5.34-4.116-3.552c-.887-.76-.415-2.212.749-2.305l5.404-.434L10.788 3.21Z" clip-rule="evenodd" /></svg>'
        : // Unstarred icon
          '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.615.049.878.83.423 1.263l-4.118 3.556a.563.563 0 0 0-.162.505l1.046 5.456c.12.618-.528 1.09-.996.77l-4.912-2.93a.562.562 0 0 0-.621 0l-4.912 2.93c-.468.32-.996-.77-.996-.77l1.046-5.456a.563.563 0 0 0-.162-.505L1.71 10.664c-.455-.433-.192-1.214.423-1.263l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>'
    );

    starButton.setAttribute('aria-label', isStarred ? 'Unstar conversation' : 'Star conversation');
    starButton.setAttribute('aria-pressed', isStarred.toString());

    eventHandlers.trackListener(
      starButton,
      'click',
      () => {
        toggleStarConversationCb(conversation.id);
        // The star button UI might re-render or update immediately here if needed.
      },
      { description: `Toggle star for conversation ${conversation.id}`, context: MODULE }
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
   * @param {Function} isConversationStarredFn - Checks if a conversation is starred.
   * @param {Function} toggleStarConversationCb - Toggles star/unstar for a conversation.
   */
  async function renderConversations(
    projectId,
    searchTerm = '',
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    const listElement = _clearList(RECENT_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;

    if (!projectId) {
      // No logging, skip if no project
      return;
    }

    _setLoadingState(listElement, true);

    try {
      let conversationsUrl;
      if (typeof apiEndpoints.CONVERSATIONS === 'function') {
        conversationsUrl = apiEndpoints.CONVERSATIONS(projectId);
      } else {
        conversationsUrl = (
          apiEndpoints.CONVOS ||
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

      _setLoadingState(listElement, false);

      if (conversations.length === 0) {
        _displayMessageInList(
          listElement,
          searchTerm
            ? 'No conversations match your search.'
            : 'No recent conversations in this project.'
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
      // Show user-facing error message only
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
   * @param {Function} isConversationStarredFn - Checks if a conversation is starred.
   * @param {Function} toggleStarConversationCb - Toggles star/unstar for a conversation.
   */
  async function renderStarredConversations(
    projectId,
    searchTerm = '',
    isConversationStarredFn,
    toggleStarConversationCb
  ) {
    const listElement = _clearList(STARRED_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;

    if (!projectId) {
      // Skip if no project
      return;
    }

    _setLoadingState(listElement, true);

    try {
      let conversationsUrl;
      if (typeof apiEndpoints.CONVERSATIONS === 'function') {
        conversationsUrl = apiEndpoints.CONVERSATIONS(projectId);
      } else {
        conversationsUrl = (
          apiEndpoints.CONVOS ||
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

      // If backend does not filter by starred, do it client-side:
      // conversations = conversations.filter(convo => isConversationStarredFn(convo.id));

      _setLoadingState(listElement, false);

      if (conversations.length === 0) {
        _displayMessageInList(
          listElement,
          searchTerm
            ? 'No starred conversations match your search.'
            : 'No starred conversations in this project.'
        );
      } else {
        conversations.forEach((convo) => {
          if (isConversationStarredFn(convo.id)) {
            const listItem = _createConversationListItem(
              convo,
              true,
              isConversationStarredFn,
              toggleStarConversationCb
            );
            listElement.appendChild(listItem);
          }
        });
        // If everything was filtered out
        if (listElement.children.length === 0) {
          _displayMessageInList(
            listElement,
            searchTerm
              ? 'No starred conversations match your search.'
              : 'No starred conversations in this project.'
          );
        }
      }
    } catch (error) {
      _setLoadingState(listElement, false);
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
  function renderProjects(projects = []) {
    const listElement = _clearList(PROJECT_LIST_SELECTOR);
    if (!listElement) return;

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
        (e) => {
          domAPI.preventDefault(e);
          onProjectSelect(project.id);
        },
        { description: `Select project ${project.id}`, context: MODULE }
      );

      domAPI.appendChild(li, link);
      listElement.appendChild(li);
    });
  }

  // Return API
  return {
    renderConversations,
    renderStarredConversations,
    renderProjects
  };
}
