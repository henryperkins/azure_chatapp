/**
 * app.js - Refactored with deduplicated code
 * ------------------------
 * Main application initialization with improved code organization
 */

// ---------------------------------------------------------------------
// GLOBAL SELECTORS & CONSTANTS
// ---------------------------------------------------------------------
window.SELECTORS = {
  MAIN_SIDEBAR: '#mainSidebar',
  NAV_TOGGLE_BTN: '#navToggleBtn',
  USER_STATUS: '#userStatus',
  NOTIFICATION_AREA: '#notificationArea',
  SIDEBAR_PROJECT_SEARCH: '#sidebarProjectSearch',
  SIDEBAR_PROJECTS: '#sidebarProjects',
  SIDEBAR_NEW_PROJECT_BTN: '#sidebarNewProjectBtn',
  SIDEBAR_CONVERSATIONS: '#sidebarConversations',
  SIDEBAR_ACTIONS: '#sidebarActions',
  AUTH_STATUS: '#authStatus',
  USER_MENU: '#userMenu',
  AUTH_BUTTON: '#authButton',
  CHAT_UI: '#chatUI',
  NO_CHAT_SELECTED_MESSAGE: '#noChatSelectedMessage',
  LOGIN_REQUIRED_MESSAGE: '#loginRequiredMessage',
  PROJECT_MANAGER_PANEL: '#projectManagerPanel',
  CONVERSATION_AREA: '#conversationArea',
  CHAT_TITLE: '#chatTitle',
  CREATE_PROJECT_BTN: '#createProjectBtn',
  SHOW_LOGIN_BTN: '#showLoginBtn',
  NEW_CONVERSATION_BTN: '#newConversationBtn',
  UPLOAD_FILE_BTN: '#uploadFileBtn',
  FILE_INPUT: '#fileInput'
};

const MESSAGES = {
  NO_PROJECTS: 'No projects found',
  NO_CONVERSATIONS: 'No conversations yet—Begin now!',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  LOGIN_REQUIRED: 'Please log in to use the application',
  PROJECT_NOT_FOUND: 'Selected project not found or inaccessible. It has been deselected.'
};

const API_ENDPOINTS = {
  AUTH_VERIFY: '/api/auth/verify',
  PROJECTS: '/api/projects',
  CONVERSATIONS: '/api/chat/conversations',
  PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations'
};

// ---------------------------------------------------------------------
// UTILITY FUNCTIONS (Refactored)
// ---------------------------------------------------------------------
function getElement(selector) {
  return document.querySelector(selector);
}

function showEmptyState(container, message, extraClasses = '') {
  const element = document.createElement('li');
  element.className = `text-gray-500 text-center ${extraClasses}`;
  element.textContent = message;
  container.innerHTML = '';
  container.appendChild(element);
  return element;
}

function setChatUIVisibility(visible) {
  const chatUI = getElement(SELECTORS.CHAT_UI);
  const noChatMsg = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);
  
  if (visible) {
    chatUI?.classList?.remove('hidden');
    noChatMsg?.classList?.add('hidden');
  } else {
    chatUI?.classList?.add('hidden');
    noChatMsg?.classList?.remove('hidden');
  }
}

function updateAuthUI(authenticated) {
  const elements = {
    authButton: getElement(SELECTORS.AUTH_BUTTON),
    userMenu: getElement(SELECTORS.USER_MENU),
    chatUI: getElement(SELECTORS.CHAT_UI),
    loginRequiredMessage: getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE),
    noChatMsg: getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE),
    authStatus: getElement(SELECTORS.AUTH_STATUS)
  };

  if (authenticated) {
    elements.authButton?.classList?.add('hidden');
    elements.userMenu?.classList?.remove('hidden');
    elements.loginRequiredMessage?.classList?.add('hidden');
    elements.chatUI?.classList?.remove('hidden');
    elements.noChatMsg?.classList?.add('hidden');
    if (elements.authStatus) {
      elements.authStatus.textContent = 'Authenticated';
      elements.authStatus.classList.replace('text-red-600', 'text-green-600');
    }
  } else {
    elements.authButton?.classList?.remove('hidden');
    elements.userMenu?.classList?.add('hidden');
    elements.loginRequiredMessage?.classList?.remove('hidden');
    elements.chatUI?.classList?.add('hidden');
    elements.noChatMsg?.classList?.add('hidden');
    if (elements.authStatus) {
      elements.authStatus.textContent = 'Not Authenticated';
      elements.authStatus.classList.replace('text-green-600', 'text-red-600');
    }
  }
}

async function apiRequest(endpoint, method = 'GET', data = null, retryCount = 0) {
  const maxRetries = 2;
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${window.location.origin}${normalizedEndpoint}`;

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, options);

    if (response.status === 404) {
      throw new Error('Resource not found');
    }

    if (response.status === 401 || response.status === 403) {
      if (retryCount < maxRetries) {
        try {
          await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include'
          });
          return apiRequest(url, method, data, retryCount + 1);
        } catch (refreshError) {
          document.dispatchEvent(new CustomEvent("authStateChanged", {
            detail: { authenticated: false }
          }));
          throw new Error('Authentication required');
        }
      } else {
        document.dispatchEvent(new CustomEvent("authStateChanged", {
          detail: { authenticated: false }
        }));
        throw new Error('Authentication required');
      }
    }

    if (!response.ok) {
      throw new Error(`API error response (${response.status}): ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    console.error(`API request failed: ${url}`, error);
    throw error;
  }
}

function showNotification(msg, type = 'info') {
  const notificationArea = getElement(SELECTORS.NOTIFICATION_AREA);
  if (!notificationArea) return;

  const toast = document.createElement('div');
  toast.classList.add('mb-2', 'px-4', 'py-2', 'rounded', 'shadow', 'text-white',
                    'transition-opacity', 'opacity-0');

  switch (type) {
    case 'success': toast.classList.add('bg-green-600'); break;
    case 'error': toast.classList.add('bg-red-600'); break;
    default: toast.classList.add('bg-gray-700');
  }

  toast.textContent = msg;
  notificationArea.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

const Notifications = {
  authRequired: () => showNotification(MESSAGES.LOGIN_REQUIRED, 'info'),
  sessionExpired: () => showNotification(MESSAGES.SESSION_EXPIRED, 'error'),
  projectNotFound: () => showNotification(MESSAGES.PROJECT_NOT_FOUND, 'error'),
  apiError: (context) => showNotification(`Error ${context}`, 'error')
};

function handleAPIError(context, error) {
  console.error(`Error in ${context}:`, error);
  if (error.message.includes('404')) {
    Notifications.projectNotFound();
  } else if (error.message.includes('401') || error.message.includes('403')) {
    Notifications.sessionExpired();
  }
  return Promise.reject(error);
}

// ---------------------------------------------------------------------
// UI COMPONENT CREATION
// ---------------------------------------------------------------------
function createProjectListItem(project) {
  const li = document.createElement('li');
  li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center';
  li.dataset.projectId = project.id;

  const nameSpan = document.createElement('span');
  nameSpan.textContent = project.name;
  nameSpan.className = 'flex-1 truncate';
  li.appendChild(nameSpan);

  if (project.pinned) {
    const pinIcon = document.createElement('span');
    pinIcon.textContent = '📌';
    pinIcon.className = 'ml-1 text-yellow-600';
    li.appendChild(pinIcon);
  }

  li.addEventListener('click', () => {
    localStorage.setItem('selectedProjectId', project.id);
    if (window.ProjectDashboard?.showProjectDetailsView) {
      window.ProjectDashboard.showProjectDetailsView(project.id);
    }
  });

  return li;
}

function createConversationListItem(item) {
  const li = document.createElement('li');
  li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center';

  const isStarred = window.sidebar?.isConversationStarred?.(item.id);

  const titleSpan = document.createElement('span');
  titleSpan.className = 'flex-1 truncate';
  titleSpan.textContent = item.title || 'Conversation ' + item.id;
  li.appendChild(titleSpan);

  const metaDiv = document.createElement('div');
  metaDiv.className = 'flex items-center ml-2';

  // Star button
  const starBtn = document.createElement('button');
  starBtn.className = `mr-1 ${isStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
  starBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
         fill="${isStarred ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915
            c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c
            .3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976
            2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00
            -.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914 
            a1 1 0 00.951-.69l1.519-4.674z"/>
    </svg>
  `;
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.sidebar?.toggleStarConversation) {
      const nowStarred = window.sidebar.toggleStarConversation(item.id);
      starBtn.className = `mr-1 ${nowStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
      starBtn.querySelector('svg').setAttribute('fill', nowStarred ? 'currentColor' : 'none');
    }
  });
  metaDiv.appendChild(starBtn);

  // Model badge
  if (item.model_id) {
    const modelBadge = document.createElement('span');
    modelBadge.className = 'text-xs text-gray-500 ml-1';
    modelBadge.textContent = item.model_id;
    metaDiv.appendChild(modelBadge);
  }

  // Project badge
  if (item.project_id) {
    const projectBadge = document.createElement('span');
    projectBadge.className = 'text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded ml-1';
    projectBadge.textContent = 'Project';
    metaDiv.appendChild(projectBadge);
  }

  li.appendChild(metaDiv);
  li.addEventListener('click', () => navigateToConversation(item.id));

  return li;
}

// ---------------------------------------------------------------------
// NAVIGATION & STATE MANAGEMENT
// ---------------------------------------------------------------------
function navigateToConversation(conversationId) {
  window.history.pushState({}, '', `/?chatId=${conversationId}`);
  setChatUIVisibility(true);
  
  if (typeof window.loadConversation === 'function') {
    return window.loadConversation(conversationId);
  }
  return Promise.resolve();
}

function handleNavigationChange() {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');

  apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      try {
        if (chatId) {
          setChatUIVisibility(true);
          if (typeof window.loadConversation === 'function') {
            window.loadConversation(chatId).catch(error => {
              handleAPIError('loading conversation', error);
              setChatUIVisibility(false);
            });
          }
        } else {
          if (typeof window.createNewChat === 'function') {
            window.createNewChat().catch(error => {
              handleAPIError('creating new chat', error);
              setChatUIVisibility(false);
            });
          } else {
            setChatUIVisibility(false);
          }
        }
      } catch (error) {
        handleAPIError('handling navigation', error);
        setChatUIVisibility(false);
      }
    })
    .catch(error => {
      handleAPIError('auth verification', error);
    });
}

// ---------------------------------------------------------------------
// DATA LOADING FUNCTIONS
// ---------------------------------------------------------------------
function loadSidebarProjects() {
  apiRequest(API_ENDPOINTS.PROJECTS)
    .then(response => {
      const projects = Array.isArray(response.data) ? response.data : [];
      const sidebarProjects = getElement(SELECTORS.SIDEBAR_PROJECTS);
      if (!sidebarProjects) return;

      sidebarProjects.innerHTML = '';

      if (projects.length === 0) {
        showEmptyState(sidebarProjects, MESSAGES.NO_PROJECTS);
        return;
      }

      projects.forEach(project => {
        sidebarProjects.appendChild(createProjectListItem(project));
      });
    })
    .catch(err => handleAPIError('loading sidebar projects', err));
}

function loadConversationList() {
  const selectedProjectId = localStorage.getItem('selectedProjectId');
  if (!selectedProjectId) {
    apiRequest(API_ENDPOINTS.CONVERSATIONS)
      .then(data => renderConversationList(data))
      .catch(err => handleAPIError('loading conversation list', err));
    return;
  }

  const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', selectedProjectId);
  apiRequest(endpoint)
    .then(data => {
      if (!data) return;
      renderConversationList(data);
    })
    .catch(err => {
      if (err.message.includes('404')) {
        localStorage.removeItem('selectedProjectId');
        Notifications.projectNotFound();
        loadSidebarProjects();
        loadConversationList();
      } else {
        handleAPIError('loading project conversations', err);
      }
    });
}

function renderConversationList(data) {
  const container = getElement(SELECTORS.SIDEBAR_CONVERSATIONS);
  if (!container) return;
  container.innerHTML = '';

  window.chatConfig = window.chatConfig || {};
  
  // Normalize conversation data
  let conversations = [];
  if (data?.data?.conversations) {
    conversations = data.data.conversations;
  } else if (data?.conversations) {
    conversations = data.conversations;
  } else if (data?.data && Array.isArray(data.data)) {
    conversations = data.data;
  } else if (Array.isArray(data)) {
    conversations = data;
  }
  
  window.chatConfig.conversations = conversations;

  if (conversations?.length > 0) {
    conversations.forEach(item => {
      container.appendChild(createConversationListItem(item));
    });
  } else {
    showEmptyState(container, MESSAGES.NO_CONVERSATIONS, 'py-4');
  }
}

// ---------------------------------------------------------------------
// AUTH MANAGEMENT
// ---------------------------------------------------------------------
function checkAndHandleAuth() {
  apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      updateAuthUI(true);
      loadConversationList();
      
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects();
        loadSidebarProjects();
      }

      if (window.CHAT_CONFIG?.chatId && window.loadConversation) {
        window.loadConversation(window.CHAT_CONFIG.chatId);
      }
    })
    .catch(() => {
      updateAuthUI(false);
      Notifications.authRequired();
    });
}

// ---------------------------------------------------------------------
// SIDEBAR MANAGEMENT
// ---------------------------------------------------------------------
function toggleSidebar() {
  const sidebarEl = getElement(SELECTORS.MAIN_SIDEBAR);
  if (!sidebarEl) return;

  sidebarEl.classList.toggle("translate-x-0");
  sidebarEl.classList.toggle("-translate-x-full");

  const existingBackdrop = document.getElementById('sidebarBackdrop');
  if (!existingBackdrop) {
    const backdrop = document.createElement("div");
    backdrop.id = "sidebarBackdrop";
    backdrop.className = "fixed inset-0 bg-black/50 z-40 md:hidden";
    backdrop.onclick = toggleSidebar;
    document.body.appendChild(backdrop);
  } else {
    existingBackdrop.remove();
  }
}

function handleWindowResize() {
  const sidebarEl = getElement(SELECTORS.MAIN_SIDEBAR);
  if (!sidebarEl) return;
  if (window.innerWidth >= 768) {
    sidebarEl.classList.remove('fixed', 'inset-0', 'z-50');
  }
}

// ---------------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------------
function safeInitialize() {
  const elementMap = {};
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    elementMap[key] = document.querySelector(selector);
  });

  // Event listeners
  if (elementMap.NAV_TOGGLE_BTN) {
    elementMap.NAV_TOGGLE_BTN.addEventListener('click', toggleSidebar);
  }

  if (elementMap.SIDEBAR_PROJECT_SEARCH) {
    elementMap.SIDEBAR_PROJECT_SEARCH.addEventListener('input', (e) => {
      searchSidebarProjects(e.target.value);
    });
  }

  if (elementMap.SIDEBAR_NEW_PROJECT_BTN) {
    elementMap.SIDEBAR_NEW_PROJECT_BTN.addEventListener('click', () => {
      if (window.projectManager?.showProjectCreateForm) {
        window.projectManager.showProjectCreateForm();
      } else if (elementMap.CREATE_PROJECT_BTN) {
        elementMap.CREATE_PROJECT_BTN.click();
      }
    });
  }

  if (elementMap.SHOW_LOGIN_BTN && elementMap.AUTH_BUTTON) {
    elementMap.SHOW_LOGIN_BTN.addEventListener('click', () => {
      elementMap.AUTH_BUTTON.click();
    });
  }

  document.addEventListener('click', function(event) {
    if (event.target.closest('#newConversationBtn')) {
      const projectId = localStorage.getItem('selectedProjectId');
      if (projectId && window.projectManager?.createConversation) {
        window.projectManager.createConversation(projectId)
          .then(newConversation => {
            window.location.href = `/?chatId=${newConversation.id}`;
          })
          .catch(err => {
            handleAPIError('creating conversation', err);
          });
      } else {
        Notifications.apiError('no project selected');
      }
    }
  });
}

function setupGlobalKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('regenerateChat'));
      }
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('copyMessage'));
      }
    }
  });
}

function initializeApplication() {
  safeInitialize();

  if (!localStorage.getItem("modelName")) {
    localStorage.setItem("modelName", "claude-3-sonnet-20240229");
  }

  updateUserSessionState();
  setupGlobalKeyboardShortcuts();
  checkAndHandleAuth();
  window.addEventListener('popstate', handleNavigationChange);
  window.addEventListener('resize', handleWindowResize);
}

// ---------------------------------------------------------------------
// EVENT LISTENERS & EXPORTS
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', initializeApplication);

document.addEventListener('authStateChanged', (e) => {
  updateAuthUI(e.detail.authenticated);
  if (e.detail.authenticated) {
    loadConversationList();
    if (window.projectManager?.loadProjects) {
      window.projectManager.loadProjects();
      loadSidebarProjects();
    }
    if (window.CHAT_CONFIG?.chatId && window.loadConversation) {
      window.loadConversation(window.CHAT_CONFIG.chatId);
    }
  } else {
    const conversationArea = getElement(SELECTORS.CONVERSATION_AREA);
    if (conversationArea) conversationArea.innerHTML = '';
  }
});

// Expose public methods
window.App = {
  apiRequest,
  showNotification: Notifications,
  loadSidebarProjects,
  searchSidebarProjects,
  loadConversationList,
  renderConversationList,
  checkAndHandleAuth,
  initialize: initializeApplication
};

// Initialize model dropdown and chat
document.addEventListener('DOMContentLoaded', () => {
  if (typeof initializeModelDropdown === 'function') {
    initializeModelDropdown();
  }
  if (typeof window.initializeChat === 'function') {
    window.initializeChat();
  }
});