/**
 * app.js - REMEDIATED VERSION
 * ---------------------------
 * - Maintains a single API_CONFIG global object (no more double definitions).
 * - Uses one fetch wrapper (apiRequest).
 * - Listens for authStateChanged to manage the authenticated vs. logged-out UI.
 * - Minimizes overlap with auth.js token logic. (auth.js will call apiRequest and dispatch events.)
 */

// ---------------------------------------------------------------------
// GLOBAL APP CONFIG & CONSTANTS
// ---------------------------------------------------------------------

// Consolidated global config (no second "const API_CONFIG")
window.API_CONFIG = {
  baseUrl: "",
  isAuthenticated: false,
  authCheckInProgress: false,
  lastErrorStatus: null
};

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

// Simple notifications system
const Notifications = {
  apiError: (msg) => console.error('API Error:', msg),
  projectNotFound: () => console.warn('Project not found')
};

// ---------------------------------------------------------------------
// UTILITY FUNCTIONS
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

/**
 * Main UI toggling function for authenticated vs. not-authenticated state.
 * Called whenever "authStateChanged" is dispatched from auth.js.
 */
function updateAuthUI(authenticated, username = null) {
  const authButton   = getElement(SELECTORS.AUTH_BUTTON);
  const userMenu     = getElement(SELECTORS.USER_MENU);
  const loginReqMsg  = getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);
  const noChatMsg    = getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);
  const chatUI       = getElement(SELECTORS.CHAT_UI);
  const authStatus   = getElement(SELECTORS.AUTH_STATUS);

  if (authenticated) {
    authButton?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    loginReqMsg?.classList.add('hidden');
    chatUI?.classList.remove('hidden');
    noChatMsg?.classList.add('hidden');
    
    if (authStatus) {
      authStatus.textContent = username || 'Authenticated';
      authStatus.classList.remove('text-red-600');
      authStatus.classList.add('text-green-600');
    }
    
    window.API_CONFIG.isAuthenticated = true;
  } else {
    authButton?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
    loginReqMsg?.classList.remove('hidden');
    chatUI?.classList.add('hidden');
    noChatMsg?.classList.add('hidden');
    
    if (authStatus) {
      authStatus.textContent = 'Not Authenticated';
      authStatus.classList.remove('text-green-600');
      authStatus.classList.add('text-red-600');
    }
    
    window.API_CONFIG.isAuthenticated = false;
  }
}

// ---------------------------------------------------------------------
// SINGLE FETCH WRAPPER (apiRequest)
// ---------------------------------------------------------------------
/**
 * The one and only fetch wrapper used by the app. Auth refresh logic is
 * in auth.js (TokenManager.refreshTokens), but we'll call it here if 401.
 */
async function apiRequest(endpoint, method = 'GET', data = null, retryCount = 0) {
  const maxRetries = 2;

  // If an auth check is in progress, we wait. (Kept for backward-compat.)
  if (window.API_CONFIG.authCheckInProgress && !endpoint.includes('/auth/')) {
    if (retryCount > 5) {
      console.warn('Too many auth check delays, proceeding with request anyway');
    } else {
      console.log(`Delaying API call to ${endpoint} until auth check completes (attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      return apiRequest(endpoint, method, data, retryCount + 1);
    }
  }

  // Normalize endpoint if full URL was passed
  if (endpoint.startsWith('https://') || endpoint.startsWith('http://')) {
    console.warn('Full URL detected in endpoint, normalizing:', endpoint);
    const urlObj = new URL(endpoint);
    endpoint = urlObj.pathname + urlObj.search;
  }

  // Clean up double slashes
  const cleanEndpoint = endpoint.replace(/^https?:\/\/[^/]+/, '').replace(/\/+/g, '/');
  const baseUrl = getBaseUrl();

  const finalUrl = cleanEndpoint.startsWith('/')
    ? `${baseUrl}${cleanEndpoint}`
    : `${baseUrl}/${cleanEndpoint}`;

  const options = {
    method,
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...TokenManager.getAuthHeader() // from auth.js
    },
    credentials: 'include',
    cache: 'no-store'
  };

  if (data) {
    if (data instanceof FormData) {
      // Let the browser set Content-Type for FormData
      options.body = data;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }
  }

  try {
    console.log(`Making ${method} request to: ${finalUrl}`);
    const response = await fetch(finalUrl, options);

    if (!response.ok) {
      window.API_CONFIG.lastErrorStatus = response.status;
      console.error(`API Error (${response.status}): ${method} ${finalUrl}`);

      // Handle 401 with token refresh
      if (response.status === 401 && retryCount < maxRetries) {
        try {
          if (window.TokenManager?.refreshTokens) {
            await window.TokenManager.refreshTokens();
            // Retry the request once the token is refreshed
            return apiRequest(endpoint, method, data, retryCount + 1);
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
        }
      }

      // Handle 422 (validation) or 404 in special contexts
      if (response.status === 422) {
        try {
          const errorData = await response.json();
          console.error('Validation error details:', errorData);
        } catch (parseErr) {
          console.error('Could not parse validation error', parseErr);
        }
      } else if (response.status === 401) {
        // Clear auth
        sessionStorage.removeItem('userInfo');
        sessionStorage.removeItem('auth_state');
        window.API_CONFIG.isAuthenticated = false;
        document.dispatchEvent(new CustomEvent('authStateChanged', {
          detail: { authenticated: false }
        }));
      }

      throw new Error(`API error (${response.status}): ${response.statusText}`);
    }

    // Attempt to parse JSON
    const jsonData = await response.json();
    // If tokens come back in any endpoint, set them
    if (jsonData.access_token && window.TokenManager?.setTokens) {
      TokenManager.setTokens(jsonData.access_token, jsonData.refresh_token);
    }

    return jsonData;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

// Helpers
function getBaseUrl() {
  if (!window.API_CONFIG.baseUrl) {
    // Always use same protocol as the page
    window.API_CONFIG.baseUrl = window.location.origin;
    console.log('Set API base URL:', window.API_CONFIG.baseUrl);
  }
  return window.API_CONFIG.baseUrl;
}

// Expose so other modules can use it
window.apiRequest = apiRequest;
window.getBaseUrl = getBaseUrl;

// ---------------------------------------------------------------------
// DATA LOADING & RENDERING
// ---------------------------------------------------------------------

function createProjectListItem(project) {
  try {
    const projectData = project.data || project;
    if (!projectData?.id || !projectData?.name) {
      console.error('Invalid project data:', project);
      return null;
    }

    const li = document.createElement('li');
    li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center';
    li.dataset.projectId = projectData.id;

    const nameSpan = document.createElement('span');
    nameSpan.textContent = projectData.name;
    nameSpan.className = 'flex-1 truncate';
    li.appendChild(nameSpan);

    if (projectData.pinned) {
      const pinIcon = document.createElement('span');
      pinIcon.textContent = '📌';
      pinIcon.className = 'ml-1 text-yellow-600';
      li.appendChild(pinIcon);
    }

    li.addEventListener('click', () => {
      localStorage.setItem('selectedProjectId', projectData.id);
      if (window.ProjectDashboard?.showProjectDetailsView) {
        window.ProjectDashboard.showProjectDetailsView(projectData.id);
      }
    });

    return li;
  } catch (error) {
    console.error('Error creating project list item:', error);
    return null;
  }
}

function renderConversationList(data) {
  const container = getElement(SELECTORS.SIDEBAR_CONVERSATIONS);
  if (!container) return;
  container.innerHTML = '';

  window.chatConfig = window.chatConfig || {};
  
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

  if (conversations.length > 0) {
    conversations.forEach(item => {
      container.appendChild(createConversationListItem(item));
    });
  } else {
    showEmptyState(container, MESSAGES.NO_CONVERSATIONS, 'py-4');
  }
}

function createConversationListItem(item) {
  const li = document.createElement('li');
  li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer';

  const container = document.createElement('div');
  container.className = 'flex flex-col';

  // First line
  const firstLine = document.createElement('div');
  firstLine.className = 'flex items-center justify-between';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'flex-1 truncate font-medium';
  titleSpan.textContent = item.title || 'Conversation ' + item.id;
  firstLine.appendChild(titleSpan);

  // Star button
  const isStarred = window.sidebar?.isConversationStarred?.(item.id);
  const starBtn = document.createElement('button');
  starBtn.className = `ml-2 ${isStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
  starBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4"
         fill="${isStarred ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915
            c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c
            .3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976
            2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914
            a1 1 0 00.951-.69l1.519-4.674z"/>
    </svg>`;
  starBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.sidebar?.toggleStarConversation) {
      const nowStarred = window.sidebar.toggleStarConversation(item.id);
      starBtn.className = `ml-2 ${nowStarred ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-500'}`;
      starBtn.querySelector('svg').setAttribute('fill', nowStarred ? 'currentColor' : 'none');
    }
  });
  firstLine.appendChild(starBtn);

  // Second line
  const secondLine = document.createElement('div');
  secondLine.className = 'flex items-center text-xs text-gray-500 mt-1';

  if (item.model_id) {
    const modelSpan = document.createElement('span');
    modelSpan.className = 'truncate';
    modelSpan.textContent = item.model_id;
    secondLine.appendChild(modelSpan);
  }
  if (item.project_id) {
    if (item.model_id) {
      const separator = document.createElement('span');
      separator.className = 'mx-1';
      separator.textContent = '•';
      secondLine.appendChild(separator);
    }
    const projectSpan = document.createElement('span');
    projectSpan.className = 'truncate';
    projectSpan.textContent = 'Project';
    secondLine.appendChild(projectSpan);
  }

  container.appendChild(firstLine);
  container.appendChild(secondLine);
  li.appendChild(container);

  li.addEventListener('click', () => navigateToConversation(item.id));
  return li;
}

function navigateToConversation(conversationId) {
  window.history.pushState({}, '', `/?chatId=${conversationId}`);
  setChatUIVisibility(true);

  if (typeof window.loadConversation === 'function') {
    return window.loadConversation(conversationId).catch(error => {
      handleAPIError('loading conversation', error);
      setChatUIVisibility(false);
    });
  }
  return Promise.resolve();
}

function handleAPIError(context, error) {
  console.error(`[${context}] API Error:`, error);
  let message = 'An error occurred';
  if (error instanceof TypeError) {
    message = 'Network error - please check your connection';
  } else if (error.response && error.response.status === 401) {
    message = 'Session expired - please log in again';
  } else if (error.message) {
    message = error.message;
  }
  if (typeof UIUtils !== 'undefined' && UIUtils.showNotification) {
    UIUtils.showNotification(message, 'error');
  } else {
    alert(message);
  }
}

function loadSidebarProjects() {
  const isAuthenticated = window.API_CONFIG?.isAuthenticated ||
    (sessionStorage.getItem('userInfo') !== null && sessionStorage.getItem('auth_state') !== null);
  
  if (!isAuthenticated) {
    console.log("Not authenticated, skipping sidebar projects load");
    return Promise.resolve([]);
  }

  if (window.API_CONFIG.authCheckInProgress) {
    console.log("Auth check in progress, deferring sidebar projects load");
    return Promise.resolve([]);
  }

  // Add query parameters to match backend validation requirements
  const params = new URLSearchParams({
    filter: 'all',
    skip: '0',
    limit: '100'
  });
  
  const endpoint = `${API_ENDPOINTS.PROJECTS.replace(/^https?:\/\/[^/]+/, '')}?${params}`;
  console.log("Loading sidebar projects from:", endpoint);
  
  return apiRequest(endpoint)
    .then(response => {
      const sidebarProjects = getElement(SELECTORS.SIDEBAR_PROJECTS);
      if (!sidebarProjects) return [];
      
      // If response.data is an array, it's probably { data: [projects] }
      // Or it might be { data: { projects: [] } }
      const projects = Array.isArray(response.data)
        ? response.data
        : response.data?.projects || [];

      sidebarProjects.innerHTML = '';
      if (projects.length === 0) {
        showEmptyState(sidebarProjects, MESSAGES.NO_PROJECTS);
        return [];
      }
      projects.forEach(proj => {
        const item = createProjectListItem(proj);
        if (item) sidebarProjects.appendChild(item);
      });
      return projects;
    })
    .catch(err => {
      handleAPIError('loading sidebar projects', err);
      return [];
    });
}

function loadConversationList() {
  const isAuthenticated = window.API_CONFIG?.isAuthenticated ||
    (sessionStorage.getItem('userInfo') !== null && sessionStorage.getItem('auth_state') !== null);
  
  if (!isAuthenticated) {
    console.log("Not authenticated, skipping conversation list load");
    return Promise.resolve([]);
  }

  if (window.API_CONFIG.authCheckInProgress) {
    console.log("Auth check in progress, deferring conversation list load");
    return Promise.resolve([]);
  }

  const selectedProjectId = localStorage.getItem('selectedProjectId');
  if (!selectedProjectId) {
    return apiRequest(API_ENDPOINTS.CONVERSATIONS)
      .then(data => {
        renderConversationList(data);
        return data;
      })
      .catch(err => {
        handleAPIError('loading conversation list', err);
        return [];
      });
  }

  const endpoint = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', selectedProjectId);
  return apiRequest(endpoint)
    .then(data => {
      if (!data) return [];
      renderConversationList(data);
      return data;
    })
    .catch(err => {
      if (err.message.includes('404')) {
        localStorage.removeItem('selectedProjectId');
        Notifications.projectNotFound();
        loadSidebarProjects().catch(e => console.warn("Failed to load sidebar projects:", e));
        return loadConversationList();
      } else {
        handleAPIError('loading project conversations', err);
        return [];
      }
    });
}

// ---------------------------------------------------------------------
// NAVIGATION & STATE MANAGEMENT
// ---------------------------------------------------------------------

function handleNavigationChange() {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');

  // We still might do a verify, but typically we'd rely on authStateChanged
  apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      if (chatId) {
        setChatUIVisibility(true);
        if (typeof window.loadConversation === 'function') {
          window.loadConversation(chatId).catch(err => {
            handleAPIError('loading conversation', err);
            setChatUIVisibility(false);
          });
        }
      } else {
        if (typeof window.createNewChat === 'function') {
          window.createNewChat().catch(err => {
            handleAPIError('creating new chat', err);
            setChatUIVisibility(false);
          });
        } else {
          setChatUIVisibility(false);
        }
      }
    })
    .catch(error => {
      handleAPIError('auth verification', error);
    });
}

// ---------------------------------------------------------------------
// SIDEBAR MANAGEMENT
// ---------------------------------------------------------------------

function toggleSidebar() {
  const sidebarEl = document.getElementById('mainSidebar');
  if (!sidebarEl) return;
  
  const isHidden = sidebarEl.classList.contains('-translate-x-full');
  if (isHidden) {
    sidebarEl.classList.remove('-translate-x-full');
    sidebarEl.classList.add('translate-x-0');
    const backdrop = document.createElement("div");
    backdrop.id = "sidebarBackdrop";
    backdrop.className = "fixed inset-0 bg-black/50 z-40 md:hidden";
    backdrop.onclick = toggleSidebar;
    document.body.appendChild(backdrop);
  } else {
    sidebarEl.classList.remove('translate-x-0');
    sidebarEl.classList.add('-translate-x-full');
    const existingBackdrop = document.getElementById('sidebarBackdrop');
    if (existingBackdrop) {
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

// ---------------------------------------------------------------------
// UTILITY: Search
// ---------------------------------------------------------------------

function searchSidebarProjects(query) {
  const sidebarProjects = getElement(SELECTORS.SIDEBAR_PROJECTS);
  if (!sidebarProjects) return;

  const projects = sidebarProjects.querySelectorAll('li');
  const searchTerm = query.toLowerCase();

  projects.forEach(project => {
    const projectName = project.querySelector('span')?.textContent.toLowerCase() || '';
    project.classList.toggle('hidden', !projectName.includes(searchTerm));
  });

  const hasVisibleProjects = Array.from(projects).some(p => !p.classList.contains('hidden'));
  const existingEmptyState = sidebarProjects.querySelector('.text-center');
  if (!hasVisibleProjects) {
    if (!existingEmptyState) {
      showEmptyState(sidebarProjects, 'No matching projects found');
    }
  } else if (existingEmptyState) {
    existingEmptyState.remove();
  }
}

// ---------------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------------

function safeInitialize() {
  // Map SELECTORS to elements
  const elementMap = {};
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    elementMap[key] = document.querySelector(selector);
  });

  // Auth dropdown toggling
  const authButton = document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');
  if (authButton && authDropdown) {
    authButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      authDropdown.classList.toggle('hidden');
      authDropdown.classList.toggle('slide-in');
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    if (!e.target.closest('#authContainer') && !e.target.closest('#authDropdown')) {
      authDropdown?.classList.add('hidden');
      authDropdown?.classList.remove('slide-in');
    }
  });

  // Toggle sidebar
  if (elementMap.NAV_TOGGLE_BTN) {
    elementMap.NAV_TOGGLE_BTN.addEventListener('click', toggleSidebar);
  }

  // Project search
  if (elementMap.SIDEBAR_PROJECT_SEARCH) {
    elementMap.SIDEBAR_PROJECT_SEARCH.addEventListener('input', (e) => {
      searchSidebarProjects(e.target.value);
    });
  }

  // New project button
  if (elementMap.SIDEBAR_NEW_PROJECT_BTN) {
    elementMap.SIDEBAR_NEW_PROJECT_BTN.addEventListener('click', () => {
      if (window.projectManager?.showProjectCreateForm) {
        window.projectManager.showProjectCreateForm();
      } else if (elementMap.CREATE_PROJECT_BTN) {
        elementMap.CREATE_PROJECT_BTN.click();
      }
    });
  }

  // Show login
  if (elementMap.SHOW_LOGIN_BTN && elementMap.AUTH_BUTTON) {
    elementMap.SHOW_LOGIN_BTN.addEventListener('click', () => {
      elementMap.AUTH_BUTTON.click();
    });
  }

  // New conversation
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
      // NOTE: This hijacks Ctrl+R
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

// Example main initialization
async function initializeApplication() {
  try {
    console.log("Starting main application initialization");
    // We do not call initAuth here; it's called in auth.js
    // or we might rely on "auth.js" to call it prior or afterwards.

    // Initialize base URL
    getBaseUrl(); // sets window.API_CONFIG.baseUrl if not set
    safeInitialize();

    // Example default localStorage settings
    if (!localStorage.getItem("modelName")) {
      localStorage.setItem("modelName", "claude-3-7-sonnet-20250219");
      if (!localStorage.getItem("thinkingBudget")) {
        localStorage.setItem("thinkingBudget", "16000");
      }
    }

    setupGlobalKeyboardShortcuts();

    console.log("✅ Main application initialization complete");
    return true;
  } catch (error) {
    console.error("❌ Main application initialization failed:", error);
    Notifications.apiError("Failed to initialize application");
    return false;
  }
}

// Some minimal module init approach
const InitUtils = {
  async initModule(name, initFn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Initializing ${name} module (attempt ${i+1}/${maxRetries})...`);
        await initFn();
        console.log(`✅ ${name} module initialized`);
        return true;
      } catch (error) {
        console.error(`Failed to initialize ${name} module:`, error);
        if (i === maxRetries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }
  },
  coreModules: [
    // You can define a list of core modules if needed
  ],
  featureModules: [
    // List your optional feature modules if needed
  ]
};

async function initializeAllModules() {
  try {
    console.log("Starting application initialization sequence");
    // Initialize any modules in whatever order you prefer
    // e.g. initAuth from auth.js, project dashboard, etc.

    // Then main app init
    await initializeApplication();

    // Possibly init other feature modules
    for (const module of InitUtils.featureModules) {
      if (module.init) {
        await InitUtils.initModule(module.name, module.init);
      }
    }

    console.log("✅ Application initialization sequence complete");
    return true;
  } catch (error) {
    console.error("❌ Module initialization failed:", error);
    Notifications.apiError("Application initialization failed");
    const loginRequiredMsg = document.getElementById('loginRequiredMessage');
    if (loginRequiredMsg) {
      loginRequiredMsg.classList.remove('hidden');
    }
    return false;
  }
}

// ---------------------------------------------------------------------
// BOOTSTRAPPING
// ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize everything
    await initializeAllModules();
    // If you have additional UI components:
    if (typeof window.initializeChat === 'function') {
      await InitUtils.initModule('chat', window.initializeChat);
    }
    console.log("✅ DOMContentLoaded: App initialization complete");
  } catch (error) {
    console.error("❌ DOMContentLoaded: App initialization error:", error);
    Notifications.apiError("Application initialization failed");
  }
});

// ---------------------------------------------------------------------
// AUTH EVENT LISTENER (Single place for UI toggle on login/logout)
// ---------------------------------------------------------------------

document.addEventListener('authStateChanged', (e) => {
  const { authenticated, username } = e.detail;
  updateAuthUI(authenticated, username);

  if (authenticated) {
    // If user is logged in, load side data
    loadConversationList().catch(err => console.warn("Failed to load conversations:", err));
    loadSidebarProjects().catch(err => console.warn("Failed to load sidebar projects:", err));

    // Also handle chatId if needed
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    if (chatId && typeof window.loadConversation === 'function') {
      window.loadConversation(chatId).catch(err => {
        console.warn("Failed to load conversation:", err);
      });
    }
  } else {
    // Clear the conversation area if you want
    const conversationArea = getElement(SELECTORS.CONVERSATION_AREA);
    if (conversationArea) {
      conversationArea.innerHTML = '';
    }
    // Show login required UI
    const loginMsg = getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);
    loginMsg?.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// PUBLIC EXPORTS
// ---------------------------------------------------------------------

// Make apiRequest available globally for all other scripts
window.apiRequest = apiRequest;

window.App = {
  apiRequest,
  showNotification: Notifications,
  loadSidebarProjects,
  searchSidebarProjects,
  loadConversationList,
  renderConversationList,
  initialize: initializeApplication
};
