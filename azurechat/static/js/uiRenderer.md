```javascript
/**
 * uiRenderer.js - Renders lists for the sidebar (projects, conversations).
 */
import { safeInvoker } from './utils/notifications-helpers.js'; // Assuming this path

const MODULE = "UiRenderer";

export function createUiRenderer({
  domAPI,
  eventHandlers,
  notify,
  apiRequest,
  apiEndpoints, // Added: To construct full URLs
  onConversationSelect, // Callback: (conversationId) => void
  onProjectSelect      // Callback: (projectId) => void
} = {}) {
  if (!domAPI) throw new Error(`[${MODULE}] domAPI is required.`);
  if (!eventHandlers) throw new Error(`[${MODULE}] eventHandlers is required.`);
  if (!notify) throw new Error(`[${MODULE}] notify is required.`);
  if (!apiRequest) throw new Error(`[${MODULE}] apiRequest is required.`);
  if (!apiEndpoints) throw new Error(`[${MODULE}] apiEndpoints is required.`); // Added validation
  if (typeof onConversationSelect !== 'function') throw new Error(`[${MODULE}] onConversationSelect callback is required.`);
  if (typeof onProjectSelect !== 'function') throw new Error(`[${MODULE}] onProjectSelect callback is required.`);

  const uiNotify = notify.withContext({ module: MODULE });

  const PROJECT_LIST_SELECTOR = '#projectsSection ul';
  const RECENT_CONVERSATIONS_LIST_SELECTOR = '#recentChatsSection ul';
  const STARRED_CONVERSATIONS_LIST_SELECTOR = '#starredChatsSection ul';

  function _clearList(selector) {
    const listElement = domAPI.querySelector(selector);
    if (listElement) {
      listElement.innerHTML = ''; // Simple clear
    } else {
      uiNotify.warn(`List element not found for selector: ${selector}`, { source: '_clearList' });
    }
    return listElement;
  }

  function _setLoadingState(listElement, isLoading) {
    if (!listElement) return;
    if (isLoading) {
      // Add a loading indicator, e.g., a spinner or text
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
    // Adapt this based on your actual API response structure for a list of conversations
    if (response?.data?.conversations && Array.isArray(response.data.conversations)) {
        return response.data.conversations;
    }
    if (response?.conversations && Array.isArray(response.conversations)) {
      return response.conversations;        // ← NEW path: `{ conversations:[…] }`
    }
    if (Array.isArray(response?.data)) { // e.g. if API returns { data: [...] }
        return response.data;
    }
    if (Array.isArray(response)) { // e.g. if API returns [...] directly
        return response;
    }
    uiNotify.warn('Could not extract conversations from API response.', { source: '_extractConversationsFromResponse', responseData: response });
    return [];
  }


  function _createConversationListItem(conversation, isListItemForStarredTab = false, isConversationStarredFn, toggleStarConversationCb) {
    if (typeof isConversationStarredFn !== 'function') {
      uiNotify.warn('isConversationStarredFn is not a function', { source: '_createConversationListItem' });
      // Provide a default fallback to prevent errors if critical
      isConversationStarredFn = () => false;
    }
    if (typeof toggleStarConversationCb !== 'function') {
      uiNotify.warn('toggleStarConversationCb is not a function', { source: '_createConversationListItem' });
      // Provide a default fallback
      toggleStarConversationCb = () => {};
    }

    const li = domAPI.createElement('li');
    li.className = 'py-1';

    const link = domAPI.createElement('a');
    link.href = '#';
    link.className = 'flex items-center justify-between p-2 hover:bg-base-300 rounded-md';
    domAPI.setTextContent(link, conversation.title || 'Untitled Conversation');

    eventHandlers.trackListener(link, 'click', safeInvoker((e) => {
      domAPI.preventDefault(e);
      onConversationSelect(conversation.id);
    }, { notify: uiNotify }, { context: MODULE, source: 'conversationLinkClick' }),
    { description: `Select conversation ${conversation.id}`, context: MODULE });

    // Star button (example, adjust styling as needed)
    const starButton = domAPI.createElement('button');
    starButton.className = 'btn btn-ghost btn-sm btn-square text-accent';
    const isStarred = isConversationStarredFn(conversation.id);
    domAPI.setInnerHTML(starButton, isStarred ?
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.116 3.552.975 5.34c.236 1.282-1.033 2.288-2.188 1.65l-4.851-2.958-4.851 2.958c-1.155.638-2.424-.368-2.188-1.65l.975-5.34-4.116-3.552c-.887-.76-.415-2.212.749-2.305l5.404-.434L10.788 3.21Z" clip-rule="evenodd" /></svg>' :
      '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.615.049.878.83.423 1.263l-4.118 3.556a.563.563 0 0 0-.162.505l1.046 5.456c.12.618-.528 1.09-.996.77l-4.912-2.93a.562.562 0 0 0-.621 0l-4.912 2.93c-.468.32-.1116.152-.996-.77l1.046-5.456a.563.563 0 0 0-.162-.505L1.71 10.664c-.455-.433-.192-1.214.423-1.263l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>'
    );
    starButton.setAttribute('aria-label', isStarred ? 'Unstar conversation' : 'Star conversation');
    starButton.setAttribute('aria-pressed', isStarred.toString());

    eventHandlers.trackListener(starButton, 'click', safeInvoker(() => {
        toggleStarConversationCb(conversation.id);
        // The visual update of the star button will happen when the list re-renders
        // or could be done immediately here if preferred.
    }, { notify: uiNotify }, { context: MODULE, source: 'starButtonClick' }),
    { description: `Toggle star for conversation ${conversation.id}`, context: MODULE });

    const wrapperDiv = domAPI.createElement('div');
    wrapperDiv.className = 'flex items-center w-full'; // Ensure link takes available space
    domAPI.appendChild(wrapperDiv, link);
    domAPI.appendChild(wrapperDiv, starButton);
    domAPI.appendChild(li, wrapperDiv);

    return li;
  }

  async function renderConversations(projectId, searchTerm = '', isConversationStarredFn, toggleStarConversationCb) {
    const listElement = _clearList(RECENT_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;

    if (!projectId) {
      // Nothing to fetch; sidebar will already show an empty-state message.
      uiNotify.debug('renderConversations called without projectId – skipped', { source:'renderConversations' });
      return;
    }

    _setLoadingState(listElement, true);
    try {
      let conversationsUrl;
      if (typeof apiEndpoints.CONVERSATIONS === 'function') {
        conversationsUrl = apiEndpoints.CONVERSATIONS(projectId);
      } else {
        conversationsUrl =
          (apiEndpoints.CONVOS || apiEndpoints.PROJECT_CONVERSATIONS_URL_TEMPLATE)
            ?.replace('{id}', projectId);
      }
      if (!conversationsUrl) {
        uiNotify.error('Conversations API endpoint not configured in apiEndpoints.', {
          source: 'renderConversations', apiEndpoints
        });
        _displayMessageInList(listElement,
          'Configuration error: Missing conversation API endpoint.',
          'error-message');
        _setLoadingState(listElement, false);
        return;
      }

      const queryParams = {};
      if (searchTerm) {
        queryParams.search = searchTerm;
      }

      const response = await apiRequest(conversationsUrl, { method: 'GET', params: queryParams });
      const conversations = _extractConversationsFromResponse(response);

      _setLoadingState(listElement, false); // Remove loading before adding items

      if (conversations.length === 0) {
        _displayMessageInList(listElement, searchTerm ? 'No conversations match your search.' : 'No recent conversations in this project.');
      } else {
        conversations.forEach(convo => {
          const listItem = _createConversationListItem(convo, false, isConversationStarredFn, toggleStarConversationCb);
          listElement.appendChild(listItem);
        });
      }
    } catch (error) {
      _setLoadingState(listElement, false);
      uiNotify.error('Failed to fetch or render recent conversations', { source: 'renderConversations', originalError: error, projectId, searchTerm });
      _displayMessageInList(listElement, 'Error loading conversations. Please try again.', 'error-message');
    }
  }

  async function renderStarredConversations(projectId, searchTerm = '', isConversationStarredFn, toggleStarConversationCb) {
    const listElement = _clearList(STARRED_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;

    if (!projectId) {
      // Nothing to fetch; sidebar will already show an empty-state message.
      uiNotify.debug('renderStarredConversations called without projectId – skipped', { source:'renderStarredConversations' });
      return;
    }

    _setLoadingState(listElement, true);
    try {
      let conversationsUrl;
      if (typeof apiEndpoints.CONVERSATIONS === 'function') {
        conversationsUrl = apiEndpoints.CONVERSATIONS(projectId);
      } else {
        conversationsUrl =
          (apiEndpoints.CONVOS || apiEndpoints.PROJECT_CONVERSATIONS_URL_TEMPLATE)
            ?.replace('{id}', projectId);
      }
      if (!conversationsUrl) {
        uiNotify.error('Conversations API endpoint not configured in apiEndpoints.', {
          source: 'renderStarredConversations', apiEndpoints
        });
        _displayMessageInList(listElement,
          'Configuration error.',
          'error-message');
        _setLoadingState(listElement, false);
        return;
      }

      const queryParams = { starred: 'true' }; // Example: if backend supports this
      if (searchTerm) {
        queryParams.search = searchTerm;
      }

      const response = await apiRequest(conversationsUrl, { method: 'GET', params: queryParams });
      let conversations = _extractConversationsFromResponse(response);

      // If backend doesn't filter by 'starred=true', filter client-side:
      // conversations = conversations.filter(convo => isConversationStarredFn(convo.id));

      _setLoadingState(listElement, false);

      if (conversations.length === 0) {
        _displayMessageInList(listElement, searchTerm ? 'No starred conversations match your search.' : 'No starred conversations in this project.');
      } else {
        conversations.forEach(convo => {
          // Ensure only starred conversations are rendered if backend didn't filter
          if (isConversationStarredFn(convo.id)) {
            const listItem = _createConversationListItem(convo, true, isConversationStarredFn, toggleStarConversationCb);
            listElement.appendChild(listItem);
          }
        });
        // Check if after client-side filtering, the list is empty
        if (listElement.children.length === 0) {
             _displayMessageInList(listElement, searchTerm ? 'No starred conversations match your search.' : 'No starred conversations in this project.');
        }
      }
    } catch (error) {
      _setLoadingState(listElement, false);
      uiNotify.error('Failed to fetch or render starred conversations', { source: 'renderStarredConversations', originalError: error, projectId, searchTerm });
      _displayMessageInList(listElement, 'Error loading starred conversations.', 'error-message');
    }
  }

  // renderProjects remains largely the same, assuming it doesn't fetch but receives data.
  // If it fetches, apply similar apiRequest.get() changes.
  function renderProjects(projects = []) {
    const listElement = _clearList(PROJECT_LIST_SELECTOR);
    if (!listElement) return;

    if (projects.length === 0) {
      _displayMessageInList(listElement, 'No projects found.');
      return;
    }

    projects.forEach(project => {
      const li = domAPI.createElement('li');
      li.className = 'py-1';

      const link = domAPI.createElement('a');
      link.href = '#';
      link.className = 'block p-2 hover:bg-base-300 rounded-md';
      domAPI.setTextContent(link, project.name || 'Untitled Project');

      eventHandlers.trackListener(link, 'click', safeInvoker((e) => {
        domAPI.preventDefault(e);
        onProjectSelect(project.id);
      }, { notify: uiNotify }, { context: MODULE, source: 'projectLinkClick' }),
      { description: `Select project ${project.id}`, context: MODULE });

      domAPI.appendChild(li, link);
      listElement.appendChild(li);
    });
  }

  return {
    renderConversations,
    renderStarredConversations,
    renderProjects,
    // Expose clear functions if needed externally, though typically internal
    // clearRecentConversationsList: () => _clearList(RECENT_CONVERSATIONS_LIST_SELECTOR),
    // clearStarredConversationsList: () => _clearList(STARRED_CONVERSATIONS_LIST_SELECTOR),
    // clearProjectsList: () => _clearList(PROJECT_LIST_SELECTOR),
  };
}

```