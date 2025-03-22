 // app.js

// Define and expose selectors globally
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
  SHOW_LOGIN_BTN: '#showLoginBtn'
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

function getElement(selector) {
  return document.querySelector(selector);
}

function addEventListener(element, event, handler) {
  if (element) {
    element.addEventListener(event, handler);
  } else {
    console.warn(`Cannot add ${event} listener to non-existent element: ${selector}`);
  }
}
function apiRequest(url, method = 'GET', data = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    credentials: 'include' // This ensures cookies are sent with requests
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  return fetch(url, options)
    .then(response => {
      if (response.status === 401 || response.status === 403) {
        // Handle authentication errors consistently
        document.dispatchEvent(new CustomEvent("authStateChanged", {
          detail: { authenticated: false }
        }));
        throw new Error('Authentication required');
      }
      if (!response.ok) {
        throw new Error(`API error response (${response.status}): ${response.statusText}`);
      }
      return response.json();
    })
    .catch(error => {
      console.error(`API request failed: ${url}`, error);
      throw error;
    });
}

function showNotification(msg, type = 'info') {
  const notificationArea = getElement(SELECTORS.NOTIFICATION_AREA);
  if (!notificationArea) {
    console.warn('No notificationArea found in DOM.');
    return;
  }

  const toast = document.createElement('div');
  toast.classList.add('mb-2', 'px-4', 'py-2', 'rounded', 'shadow', 'text-white', 'transition-opacity', 'opacity-0');

  switch (type) {
    case 'success':
      toast.classList.add('bg-green-600');
      break;
    case 'error':
      toast.classList.add('bg-red-600');
      break;
    default:
      toast.classList.add('bg-gray-700');
  }

  toast.textContent = msg;
  notificationArea.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0');
  });

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
  const toggleBtn = getElement(SELECTORS.NAV_TOGGLE_BTN);
  
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

document.addEventListener('DOMContentLoaded', () => {
  // Initialize UI elements
  const sidebarEl = getElement(SELECTORS.MAIN_SIDEBAR);
  const navToggleBtn = getElement(SELECTORS.NAV_TOGGLE_BTN);

  // Only set up resize handler if sidebar exists
  if (sidebarEl) {
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.contentRect.width >= 768) { // Desktop breakpoint
          sidebarEl.classList.remove('mobile-visible', 'fixed');
          const backdrop = document.getElementById('sidebarBackdrop');
          if (backdrop) backdrop.remove();
          document.body.style.overflow = 'auto';
        }
      }
    });
    
    resizeObserver.observe(document.body);
  }

  updateUserSessionState();
  setupGlobalKeyboardShortcuts();

  // Add click handler only if button exists
  addEventListener(navToggleBtn, 'click', toggleSidebar);

  document.addEventListener('projectUpdated', (e) => {
    console.log("Global event: 'projectUpdated' triggered, detail:", e.detail);
  });

  document.addEventListener('sessionExpired', () => {
    showNotification(MESSAGES.SESSION_EXPIRED, 'error');
    updateUserSessionState();
  });

  const sidebarProjectSearchEl = getElement(SELECTORS.SIDEBAR_PROJECT_SEARCH);
  addEventListener(sidebarProjectSearchEl, 'input', (e) => {
    searchSidebarProjects(e.target.value);
  });

  const sidebarNewProjectBtnEl = getElement(SELECTORS.SIDEBAR_NEW_PROJECT_BTN);
  addEventListener(sidebarNewProjectBtnEl, 'click', () => {
    // Redirect to the projects page
    window.location.href = '/projects';
  });

  const sidebarConversationsEl = getElement(SELECTORS.SIDEBAR_CONVERSATIONS);
  if (sidebarConversationsEl) {
    loadConversationList();
  }

  const sidebarNewChatBtn = document.createElement('button');
  sidebarNewChatBtn.id = 'sidebarNewChatBtn';
  sidebarNewChatBtn.className = 'w-full text-left p-2 bg-blue-500 hover:bg-blue-600 text-white rounded mt-2 flex items-center';
  sidebarNewChatBtn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg> New Standalone Chat';
  sidebarNewChatBtn.addEventListener('click', async () => {
    // First ensure we're creating a standalone chat by removing any selected project
    localStorage.removeItem('selectedProjectId');
    
    // Show a loading notification
    if (window.showNotification) {
      window.showNotification("Creating new standalone chat...", "info");
    }
    
    try {
      // Call the createNewChat function if it exists
      if (typeof window.createNewChat === 'function') {
        // If on projects page, navigate to main chat page first
        if (window.location.pathname.includes('/projects')) {
          window.location.href = '/';
          return;
        }
        
        await window.createNewChat();
        
        // Show success notification
        if (window.showNotification) {
          window.showNotification("New chat created successfully", "success");
        }
      } else {
        if (window.showNotification) {
          window.showNotification("Chat creation function not available", "error");
        }
      }
    } catch (error) {
      console.error("Error in sidebar new chat button:", error);
      // Error notification already shown by createNewChat function
    }
  });

  const sidebarActions = getElement(SELECTORS.SIDEBAR_ACTIONS) || getElement(SELECTORS.MAIN_SIDEBAR);
  if (sidebarActions) {
    sidebarActions.appendChild(sidebarNewChatBtn);
  }

  checkAndHandleAuth();
});

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
  if (!term) {
    document.querySelectorAll(`${SELECTORS.SIDEBAR_PROJECTS} li`).forEach(li => {
      li.classList.remove('hidden');
    });
    return;
  }

  term = term.toLowerCase();
  document.querySelectorAll(`${SELECTORS.SIDEBAR_PROJECTS} li`).forEach(li => {
    const projectName = li.querySelector('span')?.textContent?.toLowerCase() || '';
    const isMatch = projectName.includes(term);
    li.classList.toggle('hidden', !isMatch);
  });
}

function loadConversationList() {
  const selectedProjectId = localStorage.getItem('selectedProjectId');

  if (!selectedProjectId) {
    apiRequest(API_ENDPOINTS.CONVERSATIONS)
      .then(data => {
        renderConversationList(data);
      })
      .catch(err => {
        console.error('Error loading conversation list:', err);
      });
    return;
  }

  apiRequest(API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', selectedProjectId))
    .then(projectResp => {
      const project = projectResp.data;
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

  // Store conversations globally for starred conversations access
  window.chatConfig = window.chatConfig || {};
  window.chatConfig.conversations = data.conversations || [];

  if (data.conversations && data.conversations.length > 0) {
    data.conversations.forEach(item => {
      const li = document.createElement('li');
      li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center';
      
      // Check if the conversation is starred
      const isStarred = window.sidebar && typeof window.sidebar.isConversationStarred === 'function' && 
                        window.sidebar.isConversationStarred(item.id);
      
      // Create an element for the title
      const titleSpan = document.createElement('span');
      titleSpan.className = 'flex-1 truncate';
      titleSpan.textContent = item.title || 'Conversation ' + item.id;
      li.appendChild(titleSpan);
      
      // Add metadata container
      const metaDiv = document.createElement('div');
      metaDiv.className = 'flex items-center ml-2';
      
      // Add star button
      const starBtn = document.createElement('button');
      starBtn.className = `mr-1 ${isStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
      starBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" 
             fill="${isStarred ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      `;
      
      // Add star toggle functionality
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent opening the conversation
        
        // Toggle star state if the function exists
        if (window.sidebar && typeof window.sidebar.toggleStarConversation === 'function') {
          const nowStarred = window.sidebar.toggleStarConversation(item.id);
          
          // Update UI
          starBtn.className = `mr-1 ${nowStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
          starBtn.querySelector('svg').setAttribute('fill', nowStarred ? 'currentColor' : 'none');
          
          // Refresh starred conversations list if visible
          if (document.getElementById('starredChatsSection') && 
              !document.getElementById('starredChatsSection').classList.contains('hidden') &&
              typeof window.sidebar.loadStarredConversations === 'function') {
            window.sidebar.loadStarredConversations();
          }
        }
      });
      
      metaDiv.appendChild(starBtn);
      
      // Add model badge
      if (item.model_id) {
        const modelBadge = document.createElement('span');
        modelBadge.className = 'text-xs text-gray-500 ml-1';
        modelBadge.textContent = item.model_id;
        metaDiv.appendChild(modelBadge);
      }
      
      // Add project badge if applicable
      if (item.project_id) {
        const projectBadge = document.createElement('span');
        projectBadge.className = 'text-xs px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded ml-1';
        projectBadge.textContent = 'Project';
        metaDiv.appendChild(projectBadge);
      }
      
      li.appendChild(metaDiv);
      
      // Add click handler to open conversation
      li.addEventListener('click', () => {
        window.history.pushState({}, '', `/?chatId=${item.id}`);
        const chatUI = getElement(SELECTORS.CHAT_UI);
        const noChatMsg = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);
        if (chatUI) chatUI.classList.remove('hidden');
        if (noChatMsg) noChatMsg.classList.add('hidden');
        const chatTitleEl = getElement(SELECTORS.CHAT_TITLE);
        if (chatTitleEl) chatTitleEl.textContent = item.title;
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

function checkAndHandleAuth() {
  apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      const selectedProjectId = localStorage.getItem('selectedProjectId');
      loadConversationList();

      if (typeof window.projectManager?.loadProjects === 'function') {
        window.projectManager.loadProjects();
        loadSidebarProjects();
      }

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

      if (window.CHAT_CONFIG?.chatId) {
        chatUI?.classList?.remove('hidden');
        noChatMsg?.classList?.add('hidden');
      }

      loginRequiredMessage?.classList?.add('hidden');
    })
    .catch(() => {
      const userMenu = getElement(SELECTORS.USER_MENU);
      const authButton = getElement(SELECTORS.AUTH_BUTTON);
      const loginRequiredMessage = getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);
      const chatUI = getElement(SELECTORS.CHAT_UI);
      const noChatMsg = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);

      userMenu?.classList?.add('hidden');
      authButton?.classList?.remove('hidden');

      if (typeof window.showNotification === 'function') {
        window.showNotification(MESSAGES.LOGIN_REQUIRED, 'info');
      }

      loginRequiredMessage?.classList?.remove('hidden');

      chatUI?.classList?.add('hidden');
      noChatMsg?.classList?.add('hidden');
    });

  addEventListener(getElement(SELECTORS.SHOW_LOGIN_BTN), 'click', () => {
    getElement(SELECTORS.AUTH_BUTTON)?.click();
  });
}

document.addEventListener('authStateChanged', (e) => {
  const authStatus = getElement(SELECTORS.AUTH_STATUS);
  const authButton = getElement(SELECTORS.AUTH_BUTTON);
  const userMenu = getElement(SELECTORS.USER_MENU);
  const chatUI = getElement(SELECTORS.CHAT_UI);

  if (e.detail.authenticated) {
    if (authButton) authButton.classList.add('hidden');
    if (userMenu) userMenu.classList.remove('hidden');

    const authStatusEl = getElement(SELECTORS.AUTH_STATUS);
    const chatUI = getElement(SELECTORS.CHAT_UI);

    if (chatUI) chatUI.classList.remove('hidden');

    if (authStatusEl) {
      authStatusEl.textContent = 'Authenticated';
      authStatusEl.classList.replace('text-red-600', 'text-green-600');
    }

    if (typeof loadConversationList === 'function') {
      loadConversationList();
    }
    if (typeof window.projectManager?.loadProjects === 'function') {
      window.projectManager.loadProjects();
      loadSidebarProjects();
    }
    if (window.CHAT_CONFIG?.chatId) {
      if (typeof window.loadConversation === 'function') {
        window.loadConversation(window.CHAT_CONFIG.chatId);
      }
    }
  } else {
    if (authButton) authButton.classList.remove('hidden');
    if (userMenu) userMenu.classList.add('hidden');

    const authStatusEl = getElement(SELECTORS.AUTH_STATUS);
    const chatUI = getElement(SELECTORS.CHAT_UI);
    const conversationArea = getElement(SELECTORS.CONVERSATION_AREA);

    if (chatUI) chatUI.classList.add('hidden');

    if (authStatusEl) {
      authStatusEl.textContent = 'Not Authenticated';
      authStatusEl.classList.replace('text-green-600', 'text-red-600');
    }

    if (conversationArea) {
      conversationArea.innerHTML = '';
    }
  }
});

window.addEventListener('popstate', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');

  // Cache element references
  const chatUI = getElement(SELECTORS.CHAT_UI);
  const noChatMessage = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);

  if (chatId) {
    // Show chat UI and load conversation
    chatUI?.classList?.remove('hidden');
    noChatMessage?.classList?.add('hidden');

    if (typeof window.loadConversation === 'function') {
      try {
        window.loadConversation(chatId);
      } catch (error) {
        console.error('Error loading conversation:', error);
        if (window.showNotification) {
          window.showNotification('Error loading conversation', 'error');
        }
      }
    }
  } else {
    // Hide chat UI and show no chat message
    chatUI?.classList?.add('hidden');
    noChatMessage?.classList?.remove('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    // Implement focus trapping logic if needed
  }
});

// Expose utility functions globally
window.apiRequest = apiRequest;
window.showNotification = showNotification;
window.loadSidebarProjects = loadSidebarProjects;
window.searchSidebarProjects = searchSidebarProjects;
window.loadConversationList = loadConversationList;
window.renderConversationList = renderConversationList;
window.checkAndHandleAuth = checkAndHandleAuth;

function getModelOptions() {
    return [
        { 
            id: 'claude-3-7-sonnet-20250219', 
            name: 'Claude 3 Sonnet',
            description: 'Medium model, great balance of speed & capability'
        },
        { 
            id: 'gpt-4', 
            name: 'GPT-4',
            description: 'Most capable model, great for complex tasks'
        },
        { 
            id: 'gpt-3.5-turbo', 
            name: 'GPT-3.5 Turbo',
            description: 'Fast and capable, great for most use cases'
        }
    ];
}

// Add this function to document ready listener

function safeInitialize() {
  // Safely bind events only to elements that actually exist
  const elementMap = {};

  // Build element map of what actually exists in the DOM
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    elementMap[key] = document.querySelector(selector);
  });

  // Only bind events to elements that exist
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
      if (typeof window.projectManager?.showProjectCreateForm === 'function') {
        window.projectManager.showProjectCreateForm();
      } else {
        const createBtn = elementMap.CREATE_PROJECT_BTN;
        if (createBtn) createBtn.click();
      }
    });
  }

  if (elementMap.SHOW_LOGIN_BTN && elementMap.AUTH_BUTTON) {
    elementMap.SHOW_LOGIN_BTN.addEventListener('click', () => {
      elementMap.AUTH_BUTTON.click();
    });
  }
}

// DOMContentLoaded listener outside of safeInitialize
document.addEventListener('DOMContentLoaded', safeInitialize);
