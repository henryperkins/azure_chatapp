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
  // apiEndpoints, // Assuming apiRequest will construct full URLs or endpoints are passed differently
  onConversationSelect, // Callback: (conversationId) => void
  onProjectSelect      // Callback: (projectId) => void
  // sidebarContext removed
} = {}) {
  if (!domAPI) throw new Error(`[${MODULE}] domAPI is required.`);
  if (!eventHandlers) throw new Error(`[${MODULE}] eventHandlers is required.`);
  if (!notify) throw new Error(`[${MODULE}] notify is required.`);
  if (!apiRequest) throw new Error(`[${MODULE}] apiRequest is required.`);
  if (typeof onConversationSelect !== 'function') throw new Error(`[${MODULE}] onConversationSelect callback is required.`);
  if (typeof onProjectSelect !== 'function') throw new Error(`[${MODULE}] onProjectSelect callback is required.`);
  // Removed sidebarContext validation

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

  function _createConversationListItem(conversation, isListItemForStarredTab = false, isConversationStarredFn, toggleStarConversationCb) {
    // Add checks for the new function parameters
    if (typeof isConversationStarredFn !== 'function') {
      uiNotify.warn('isConversationStarredFn is not a function', { source: '_createConversationListItem' });
    }
    if (typeof toggleStarConversationCb !== 'function') {
      uiNotify.warn('toggleStarConversationCb is not a function', { source: '_createConversationListItem' });
    }

    const li = domAPI.createElement('li');
    li.className = 'py-1'; // Basic styling

    const link = domAPI.createElement('a');
    link.href = '#';
    link.className = 'flex items-center justify-between p-2 hover:bg-base-300 rounded-md';
    domAPI.setTextContent(link, conversation.title || 'Untitled Conversation');

    eventHandlers.trackListener(link, 'click', safeInvoker((e) => {
      domAPI.preventDefault(e);
      onConversationSelect(conversation.id);
    }, { notify: uiNotify }, { context: MODULE, source: '_createConversationListItem_select' }), { description: `Select conversation ${conversation.id}` });

    const starButton = domAPI.createElement('button');
    starButton.className = 'btn btn-ghost btn-sm btn-square';
    const isStarred = typeof isConversationStarredFn === 'function' ? isConversationStarredFn(conversation.id) : false;
    domAPI.setInnerHTML(starButton, isStarred
      ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5 text-warning"><path fill-rule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.006 5.404.434c1.164.093 1.636 1.545.749 2.305l-4.116 3.986 1.242 5.38c.317 1.173-.927 2.122-1.966 1.516L12 17.318l-4.555 2.524c-1.039.606-2.283-.343-1.966-1.516l1.242-5.38-4.116-3.986c-.887-.76-.415-2.212.749-2.305l5.404-.434 2.082-5.005Z" clip-rule="evenodd" /></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.615.049.878.83.423 1.268l-4.118 3.986a.562.562 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.822.672l-4.994-2.631a.562.562 0 0 0-.65 0l-4.994 2.63a.562.562 0 0 1-.823-.672l1.285-5.385a.562.562 0 0 0-.182-.557l-4.118-3.986c-.454-.438-.192-1.22.423-1.268l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" /></svg>'
    );
    starButton.setAttribute('aria-label', isStarred ? 'Unstar conversation' : 'Star conversation');
    if (typeof toggleStarConversationCb === 'function') {
      eventHandlers.trackListener(starButton, 'click', safeInvoker((e) => {
        e.stopPropagation(); // Prevent link click
        toggleStarConversationCb(conversation.id);
        // The recursive call to renderStarredConversations() is removed.
        // Re-rendering should be handled by the main sidebar logic listening to 'sidebarStarredChanged'.
      }, { notify: uiNotify }, { context: MODULE, source: '_createConversationListItem_star' }), { description: `Toggle star for conversation ${conversation.id}` });
    }

    link.appendChild(starButton); // Add star button to the link for layout
    domAPI.appendChild(li, link);
    return li;
  }

  async function renderConversations(searchTerm = "", isConversationStarredFn, toggleStarConversationCb) {
    uiNotify.debug('renderConversations called', { searchTerm, source: 'renderConversations' });
    const listElement = _clearList(RECENT_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;

    try {
      // Placeholder: Replace with actual API endpoint and structure
      // Assuming endpoint like /api/conversations?type=recent&q=searchTerm
      const endpoint = `/api/conversations?type=recent${searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ''}`;
      const response = await apiRequest.get(endpoint);
      const conversations = response?.data?.conversations || response?.data || response || [];

      if (conversations.length === 0) {
        const emptyMsg = domAPI.createElement('li');
        emptyMsg.className = 'p-2 text-center text-neutral-content';
        domAPI.setTextContent(emptyMsg, searchTerm ? 'No recent conversations match your search.' : 'No recent conversations.');
        domAPI.appendChild(listElement, emptyMsg);
      } else {
        conversations.forEach(convo => {
          const listItem = _createConversationListItem(convo, false, isConversationStarredFn, toggleStarConversationCb);
          domAPI.appendChild(listElement, listItem);
        });
      }
      uiNotify.info(`Rendered ${conversations.length} recent conversations.`, { count: conversations.length, source: 'renderConversations' });
    } catch (error) {
      uiNotify.error('Failed to fetch or render recent conversations', { error, source: 'renderConversations' });
      const errorMsg = domAPI.createElement('li');
      errorMsg.className = 'p-2 text-error';
      domAPI.setTextContent(errorMsg, 'Could not load recent conversations.');
      domAPI.appendChild(listElement, errorMsg);
    }
  }

  async function renderStarredConversations(searchTerm = "", isConversationStarredFn, toggleStarConversationCb) {
    uiNotify.debug('renderStarredConversations called', { searchTerm, source: 'renderStarredConversations' });
    const listElement = _clearList(STARRED_CONVERSATIONS_LIST_SELECTOR);
    if (!listElement) return;

    try {
      // Placeholder: Replace with actual API endpoint and structure
      // Assuming endpoint like /api/conversations?type=starred&q=searchTerm
      const endpoint = `/api/conversations?type=starred${searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : ''}`;
      const response = await apiRequest.get(endpoint);
      const conversations = response?.data?.conversations || response?.data || response || [];

      if (conversations.length === 0) {
        const emptyMsg = domAPI.createElement('li');
        emptyMsg.className = 'p-2 text-center text-neutral-content';
        domAPI.setTextContent(emptyMsg, searchTerm ? 'No starred conversations match your search.' : 'No starred conversations.');
        domAPI.appendChild(listElement, emptyMsg);
      } else {
        conversations.forEach(convo => {
          const listItem = _createConversationListItem(convo, true, isConversationStarredFn, toggleStarConversationCb);
          domAPI.appendChild(listElement, listItem);
        });
      }
      uiNotify.info(`Rendered ${conversations.length} starred conversations.`, { count: conversations.length, source: 'renderStarredConversations' });
    } catch (error) {
      uiNotify.error('Failed to fetch or render starred conversations', { error, source: 'renderStarredConversations' });
      const errorMsg = domAPI.createElement('li');
      errorMsg.className = 'p-2 text-error';
      domAPI.setTextContent(errorMsg, 'Could not load starred conversations.');
      domAPI.appendChild(listElement, errorMsg);
    }
  }

  function renderProjects(projects = []) {
    uiNotify.debug('renderProjects called', { projectCount: projects.length, source: 'renderProjects' });
    const listElement = _clearList(PROJECT_LIST_SELECTOR);
    if (!listElement) return;

    if (projects.length === 0) {
        const emptyMsg = domAPI.createElement('li');
        emptyMsg.className = 'p-2 text-center text-neutral-content';
        domAPI.setTextContent(emptyMsg, 'No projects found.');
        domAPI.appendChild(listElement, emptyMsg);
    } else {
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
            }, { notify: uiNotify }, { context: MODULE, source: 'renderProjects_select' }), { description: `Select project ${project.id}` });
            domAPI.appendChild(li, link);
            domAPI.appendChild(listElement, li);
        });
    }
    uiNotify.info(`Rendered ${projects.length} projects.`, { count: projects.length, source: 'renderProjects' });
  }

  return {
    renderProjects,
    renderConversations,
    renderStarredConversations,
  };
}
