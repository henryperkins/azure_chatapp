/**
 * app.js
 * ------------------------
 * Main application initialization: 
 *  - Global DOM selectors, messages, endpoints
 *  - Single DOMContentLoaded handler
 *  - Global event listeners (popstate, authStateChanged)
 *  - Project and conversation loading
 *  - Navigation state changes
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
// UTILITY FUNCTIONS
// ---------------------------------------------------------------------
function getElement(selector) {
  return document.querySelector(selector);
}

async function apiRequest(endpoint, method = 'GET', data = null, retryCount = 0) {
  const maxRetries = 2;
  // Always use current host for API requests
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
    console.log(`Making API request to: ${url}`, { method, endpoint });
    const response = await fetch(url, options);

    console.log('API response status:', response.status); // Add logging

    if (response.status === 404) {
      console.warn(`Resource not found: ${url}`);
      throw new Error('Resource not found');
    }

    if (response.status === 401 || response.status === 403) {
      // Try refreshing the token if not exceeded retries
      if (retryCount < maxRetries) {
        try {
          await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include'
          });
          // Retry
          return apiRequest(url, method, data, retryCount + 1);
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
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
  if (!notificationArea) {
    console.warn('No notificationArea found in DOM.');
    return;
  }

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

  // Fade in
  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0');
  });

  // Fade out after 3s
  setTimeout(() => {
    toast.classList.add('opacity-0');
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 3000);
}

function updateUserSessionState() {
  const authStatus = getElement(SELECTORS.AUTH_STATUS);
  apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      if (authStatus) {
        authStatus.textContent = 'Authenticated';
        authStatus.classList.remove('text-red-600');
        authStatus.classList.add('text-green-600');
      }
    })
    .catch(() => {
      if (authStatus) {
        authStatus.textContent = 'Not Authenticated';
        authStatus.classList.remove('text-green-600');
        authStatus.classList.add('text-red-600');
      }
    });
}

function toggleSidebar() {
  const sidebarEl = getElement(SELECTORS.MAIN_SIDEBAR);
  if (sidebarEl) {
    sidebarEl.classList.toggle("translate-x-0");
    sidebarEl.classList.toggle("-translate-x-full");

    // Handle backdrop
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
}

function handleWindowResize() {
  const sidebarEl = getElement(SELECTORS.MAIN_SIDEBAR);
  if (!sidebarEl) return;
  if (window.innerWidth >= 768) {
    sidebarEl.classList.remove('fixed', 'inset-0', 'z-50');
  }
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

// ---------------------------------------------------------------------
// MAIN INITIALIZATION
// ---------------------------------------------------------------------
function initializeApplication() {
  // Basic UI elements
  safeInitialize();

  // Set default model if not set
  if (!localStorage.getItem("modelName")) {
    localStorage.setItem("modelName", "claude-3-sonnet-20240229");
  }

  // Update session state
  updateUserSessionState();

  // Setup keyboard shortcuts
  setupGlobalKeyboardShortcuts();

  // Check and handle user auth
  checkAndHandleAuth();

  // Setup popstate event for navigation
  window.addEventListener('popstate', handleNavigationChange);
}

function safeInitialize() {
  // Safely bind events only to elements that actually exist
  const elementMap = {};
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    elementMap[key] = document.querySelector(selector);
  });

  // Handle nav toggle
  if (elementMap.NAV_TOGGLE_BTN) {
    elementMap.NAV_TOGGLE_BTN.addEventListener('click', toggleSidebar);
  }

  // Project search
  if (elementMap.SIDEBAR_PROJECT_SEARCH) {
    elementMap.SIDEBAR_PROJECT_SEARCH.addEventListener('input', (e) => {
      searchSidebarProjects(e.target.value);
    });
  }

  // "New Project" button
  if (elementMap.SIDEBAR_NEW_PROJECT_BTN) {
    elementMap.SIDEBAR_NEW_PROJECT_BTN.addEventListener('click', () => {
      if (typeof window.projectManager?.showProjectCreateForm === 'function') {
        window.projectManager.showProjectCreateForm();
      } else {
        const createBtn = elementMap.CREATE_PROJECT_BTN;
        if (createBtn) createBtn.click();
      }
    });
  }

  // Handle login button clicks
  if (elementMap.SHOW_LOGIN_BTN && elementMap.AUTH_BUTTON) {
    elementMap.SHOW_LOGIN_BTN.addEventListener('click', () => {
      elementMap.AUTH_BUTTON.click();
    });
  }

    // New conversation button in project details
  document.addEventListener('click', function(event) {
    if (event.target.closest('#newConversationBtn')) {
      const projectId = localStorage.getItem('selectedProjectId');
      if (projectId) {
        window.projectManager.createConversation(projectId)
          .then(newConversation => {
            // Redirect to the new conversation
            window.location.href = `/?chatId=${newConversation.id}`;
          })
          .catch(err => {
            console.error("Failed to create conversation:", err);
            window.showNotification?.("Failed to create conversation", "error");
          });
      } else {
        console.error("No project selected to create conversation in");
        window.showNotification?.("No project selected", "error");
      }
    }
  });
}

// ---------------------------------------------------------------------
// AUTH & UI HANDLING
// ---------------------------------------------------------------------
function checkAndHandleAuth() {
  apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      // Auth success
      loadConversationList();  // Load all or project-specific convos

      if (typeof window.projectManager?.loadProjects === 'function') {
        window.projectManager.loadProjects();
        loadSidebarProjects();
      }

      // If the user has a chatId, load it
      if (window.CHAT_CONFIG?.chatId) {
        if (typeof window.loadConversation === 'function') {
          window.loadConversation(window.CHAT_CONFIG.chatId);
        }
      }

      const userMenu = getElement(SELECTORS.USER_MENU);
      const authButton = getElement(SELECTORS.AUTH_BUTTON);
      const chatUI = getElement(SELECTORS.CHAT_UI);
      const noChatMsg = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);
      const loginRequiredMessage = getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);

      userMenu?.classList?.remove('hidden');
      authButton?.classList?.add('hidden');
      loginRequiredMessage?.classList?.add('hidden');

      // Show chat UI if we have a chatId
      if (window.CHAT_CONFIG?.chatId) {
        chatUI?.classList?.remove('hidden');
        noChatMsg?.classList?.add('hidden');
      }
    })
    .catch(() => {
      // Auth failed
      const userMenu = getElement(SELECTORS.USER_MENU);
      const authButton = getElement(SELECTORS.AUTH_BUTTON);
      const loginRequiredMessage = getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);
      const chatUI = getElement(SELECTORS.CHAT_UI);
      const noChatMsg = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);

      userMenu?.classList?.add('hidden');
      authButton?.classList?.remove('hidden');
      loginRequiredMessage?.classList?.remove('hidden');

      chatUI?.classList?.add('hidden');
      noChatMsg?.classList?.add('hidden');

      showNotification(MESSAGES.LOGIN_REQUIRED, 'info');
    });
}

document.addEventListener('authStateChanged', (e) => {
  const authStatusEl = getElement(SELECTORS.AUTH_STATUS);
  const authButton = getElement(SELECTORS.AUTH_BUTTON);
  const userMenu = getElement(SELECTORS.USER_MENU);
  const chatUI = getElement(SELECTORS.CHAT_UI);
  const conversationArea = getElement(SELECTORS.CONVERSATION_AREA);

  if (e.detail.authenticated) {
    authButton?.classList?.add('hidden');
    userMenu?.classList?.remove('hidden');
    chatUI?.classList?.remove('hidden');
    if (authStatusEl) {
      authStatusEl.textContent = 'Authenticated';
      authStatusEl.classList.replace('text-red-600', 'text-green-600');
    }

    // Reload convos & projects
    if (typeof loadConversationList === 'function') {
      loadConversationList();
    }
    if (typeof window.projectManager?.loadProjects === 'function') {
      window.projectManager.loadProjects();
      loadSidebarProjects();
    }
    if (window.CHAT_CONFIG?.chatId && typeof window.loadConversation === 'function') {
      window.loadConversation(window.CHAT_CONFIG.chatId);
    }
  } else {
    authButton?.classList?.remove('hidden');
    userMenu?.classList?.add('hidden');
    chatUI?.classList?.add('hidden');
    if (authStatusEl) {
      authStatusEl.textContent = 'Not Authenticated';
      authStatusEl.classList.replace('text-green-600', 'text-red-600');
    }
    if (conversationArea) conversationArea.innerHTML = '';
  }
});

// ---------------------------------------------------------------------
// PROJECTS & CONVERSATIONS
// ---------------------------------------------------------------------
function loadSidebarProjects() {
  apiRequest(API_ENDPOINTS.PROJECTS)
    .then(response => {
      const projects = Array.isArray(response.data) ? response.data : [];
      const sidebarProjects = getElement(SELECTORS.SIDEBAR_PROJECTS);
      if (!sidebarProjects) return;

      sidebarProjects.innerHTML = '';

      if (projects.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-gray-500 text-center';
        li.textContent = MESSAGES.NO_PROJECTS;
        sidebarProjects.appendChild(li);
        return;
      }

      projects.forEach(project => {
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
          if (typeof window.projectManager?.loadProjectDetails === 'function') {
            window.projectManager.loadProjectDetails(project.id);
          }
        });

        sidebarProjects.appendChild(li);
      });
    })
    .catch(err => {
      console.error('Error loading sidebar projects:', err);
    });
}

function searchSidebarProjects(term) {
  const allLis = document.querySelectorAll(`${SELECTORS.SIDEBAR_PROJECTS} li`);
  if (!term) {
    // Show all
    allLis.forEach(li => li.classList.remove('hidden'));
    return;
  }

  term = term.toLowerCase();
  allLis.forEach(li => {
    const projectName = li.querySelector('span')?.textContent?.toLowerCase() || '';
    li.classList.toggle('hidden', !projectName.includes(term));
  });
}

function loadConversationList() {
  const selectedProjectId = localStorage.getItem('selectedProjectId');
  if (!selectedProjectId) {
    apiRequest(API_ENDPOINTS.CONVERSATIONS)
      .then(data => renderConversationList(data))
      .catch(err => console.error('Error loading conversation list:', err));
    return;
  }

  apiRequest(API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', selectedProjectId))
    .then(() => {
      const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', selectedProjectId);
      return apiRequest(endpoint);
    })
    .then(data => {
      if (!data) return;
      renderConversationList(data);
    })
    .catch(err => {
      console.error('Error verifying project or loading conversations:', err);
      if (err.message.includes('404')) {
        localStorage.removeItem('selectedProjectId');
        showNotification(MESSAGES.PROJECT_NOT_FOUND, 'error');
        loadSidebarProjects();
        loadConversationList();
      }
    });
}

function renderConversationList(data) {
  const container = getElement(SELECTORS.SIDEBAR_CONVERSATIONS);
  if (!container) return;
  container.innerHTML = '';

  // Store conversations globally for starred usage
  window.chatConfig = window.chatConfig || {};
  
  // Handle different response formats
  let conversations = [];
  console.log("Raw conversation data:", data);
  
  if (data && data.data && data.data.conversations) {
    // Format: { data: { conversations: [...] } }
    conversations = data.data.conversations;
  } else if (data && data.conversations) {
    // Format: { conversations: [...] }
    conversations = data.conversations;
  } else if (data && data.data && Array.isArray(data.data)) {
    // Format: { data: [...] }
    conversations = data.data;
  } else if (Array.isArray(data)) {
    // Format: [...]
    conversations = data;
  } else if (data && data.data && typeof data.data === 'object') {
    // Try to extract any conversation data if it exists
    const possibleConversations = Object.values(data.data).find(val => Array.isArray(val));
    if (possibleConversations) {
      conversations = possibleConversations;
    }
  }
  
  window.chatConfig.conversations = conversations;
  console.log("Processed conversations:", conversations);

  if (conversations && conversations.length > 0) {
    conversations.forEach(item => {
      const li = document.createElement('li');
      li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center';

      const isStarred = window.sidebar &&
                        typeof window.sidebar.isConversationStarred === 'function' &&
                        window.sidebar.isConversationStarred(item.id);

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
        if (window.sidebar && typeof window.sidebar.toggleStarConversation === 'function') {
          const nowStarred = window.sidebar.toggleStarConversation(item.id);
          starBtn.className = `mr-1 ${nowStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
          starBtn.querySelector('svg').setAttribute('fill', nowStarred ? 'currentColor' : 'none');

          // If starred list visible, refresh
          if (document.getElementById('starredChatsSection') &&
              !document.getElementById('starredChatsSection').classList.contains('hidden') &&
              typeof window.sidebar.loadStarredConversations === 'function') {
            window.sidebar.loadStarredConversations();
          }
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
      li.addEventListener('click', () => {
        window.history.pushState({}, '', `/?chatId=${item.id}`);
        const chatUI = getElement(SELECTORS.CHAT_UI);
        const noChatMsg = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);
        if (chatUI) chatUI.classList.remove('hidden');
        if (noChatMsg) noChatMsg.classList.add('hidden');
        const chatTitleEl = getElement(SELECTORS.CHAT_TITLE);
        if (chatTitleEl) chatTitleEl.textContent = item.title;
        
        // Set the chat ID in window.CHAT_CONFIG
        window.CHAT_CONFIG = window.CHAT_CONFIG || {};
        window.CHAT_CONFIG.chatId = item.id;
        
        if (typeof window.loadConversation === 'function') {
          window.loadConversation(item.id);
        }
      });

      container.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.className = 'text-gray-500 text-center py-4';
    li.textContent = MESSAGES.NO_CONVERSATIONS;
    container.appendChild(li);
  }
}

// ---------------------------------------------------------------------
// NAVIGATION HANDLING
// ---------------------------------------------------------------------
function handleNavigationChange() {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');

  apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      const chatUI = getElement(SELECTORS.CHAT_UI);
      const noChatMessage = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);
      if (!chatUI || !noChatMessage) return;

      try {
        if (chatId) {
          chatUI.classList.remove('hidden');
          noChatMessage.classList.add('hidden');
          if (typeof window.loadConversation === 'function') {
            window.loadConversation(chatId).catch(error => {
              console.error('Error loading conversation:', error);
              showNotification('Error loading conversation', 'error');
              chatUI.classList.add('hidden');
              noChatMessage.classList.remove('hidden');
            });
          }
        } else {
          if (typeof window.createNewChat === 'function') {
            window.createNewChat().catch(error => {
              console.error('Error creating new chat:', error);
              chatUI.classList.add('hidden');
              noChatMessage.classList.remove('hidden');
              showNotification('Failed to create new chat', 'error');
            });
          } else {
            chatUI.classList.add('hidden');
            noChatMessage.classList.remove('hidden');
          }
        }
      } catch (error) {
        console.error('Error handling navigation:', error);
        chatUI.classList.add('hidden');
        noChatMessage.classList.remove('hidden');
      }
    })
    .catch(error => {
      console.error('Auth verification failed during navigation:', error);
      showNotification('Please log in to continue', 'error');
    });
}
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', initializeApplication);

// ---------------------------------------------------------------------
// EXPOSED GLOBALS
// ---------------------------------------------------------------------
window.apiRequest = apiRequest;
window.showNotification = showNotification;
window.loadSidebarProjects = loadSidebarProjects;
window.searchSidebarProjects = searchSidebarProjects;
window.loadConversationList = loadConversationList;
window.renderConversationList = renderConversationList;
window.checkAndHandleAuth = checkAndHandleAuth;

// Initialize chat functionality (includes model dropdown)
window.initializeModelDropdown = () => {
  // Initialize the model dropdown first
  if (typeof initializeModelDropdown === 'function') {
    initializeModelDropdown();
  }
  // Then initialize chat
  if (typeof window.initializeChat === 'function') {
    window.initializeChat();
  }
};

// Call initialization after DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.initializeModelDropdown();
});
