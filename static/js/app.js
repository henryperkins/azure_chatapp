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

// API Configuration
// Export API_CONFIG and utilities to window so other modules can access it
window.API_CONFIG = {
  baseUrl: null,  // Will be set on first use
  isAuthenticated: false,
  authCheckInProgress: false
};

// Helper to get base URL
window.getBaseUrl = function() {
  if (!window.API_CONFIG.baseUrl) {
    // Get URL from current page
    const baseUrl = window.location.origin ||
                   (window.location.protocol + '//' + window.location.host);
    window.API_CONFIG.baseUrl = baseUrl;
    console.log('Set API base URL:', baseUrl);
  }
  return window.API_CONFIG.baseUrl;
};

// Alias for local use
const API_CONFIG = window.API_CONFIG;

async function apiRequest(endpoint, method = 'GET', data = null, retryCount = 0) {
  const maxRetries = 2;
  
  // Don't make API calls if authentication check is in progress
  if (API_CONFIG.authCheckInProgress && !endpoint.includes('/auth/')) {
    if (retryCount > 5) {
      console.warn('Too many auth check delays, proceeding with request anyway');
    } else {
      console.log(`Delaying API call to ${endpoint} until auth check completes (attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      return apiRequest(endpoint, method, data, retryCount + 1);
    }
  }

  // Clean and normalize the endpoint
  const cleanEndpoint = endpoint.replace(/^https?:\/\/[^/]+/, '').replace(/\/+/g, '/');
  const url = cleanEndpoint.startsWith('/')
    ? `${window.getBaseUrl()}${cleanEndpoint}`
    : `${window.getBaseUrl()}/${cleanEndpoint}`;

  const options = {
    method,
    headers: { 
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...TokenManager.getAuthHeader()
    },
    credentials: 'include',
    mode: 'cors',
    cache: 'no-store'
  };

  // Handle FormData differently from JSON
  if (data) {
    if (data instanceof FormData) {
      // Let the browser set Content-Type with boundary
      options.body = data;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(data);
    }
  }

  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      // Handle auth errors with token refresh
      if (response.status === 401 && retryCount < maxRetries) {
        try {
          // If we have a token manager with refresh capability, use it
          if (window.TokenManager?.refreshTokens) {
            await window.TokenManager.refreshTokens();
            
            // Update auth headers with new token
            options.headers = { 
              ...options.headers,
              ...TokenManager.getAuthHeader()
            };
            
            // Retry the request
            return apiRequest(endpoint, method, data, retryCount + 1);
          }
        } catch (error) {
          console.error('Token refresh failed:', error);
          // If refresh fails, proceed to throw the original error
        }
      }
      
      // Handle specific error status codes
      if (response.status === 401) {
        // Clear auth state on 401 errors
        sessionStorage.removeItem('userInfo');
        sessionStorage.removeItem('auth_state');
        API_CONFIG.isAuthenticated = false;
        
        document.dispatchEvent(new CustomEvent('authStateChanged', { 
          detail: { authenticated: false } 
        }));
      }
      
      throw new Error(`API error (${response.status}): ${response.statusText}`);
    }

    const data = await response.json();
  
    // Update tokens if present in response
    if (data.access_token) {
      TokenManager.setTokens(data.access_token, data.refresh_token);
    }
  
    return data;
  } catch (error) {
    console.error(`API request failed:`, error);
    throw error;
  }
}

// ---------------------------------------------------------------------
// USER SESSION MANAGEMENT
// ---------------------------------------------------------------------
function updateUserSessionState() {
  try {
    // Get stored user info
    const userInfo = sessionStorage.getItem('userInfo');
    if (userInfo) {
      const { username } = JSON.parse(userInfo);
      updateAuthUI(true);
      console.log('Session restored for user:', username);
    } else {
      updateAuthUI(false);
      console.log('No active session found');
    }
  } catch (error) {
    console.error('Error updating session state:', error);
    // Clear potentially corrupted session data
    sessionStorage.clear();
    updateAuthUI(false);
  }
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
            2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914 
            a1 1 0 00.951-.69l1.519-4.674z"/>
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
    return window.loadConversation(conversationId).catch(error => {
      handleAPIError('loading conversation', error);
      setChatUIVisibility(false);
    });
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
    .catch((error) => {
      handleAPIError('auth verification', error);
    });
}

// ---------------------------------------------------------------------
// DATA LOADING FUNCTIONS
// ---------------------------------------------------------------------
function loadSidebarProjects() {
  // Skip if not authenticated
  const isAuthenticated = API_CONFIG?.isAuthenticated || 
                        (sessionStorage.getItem('userInfo') !== null && 
                         sessionStorage.getItem('auth_state') !== null);
  
  if (!isAuthenticated) {
    console.log("Not authenticated, skipping sidebar projects load");
    return Promise.resolve([]);
  }
  
  // Also skip if auth check is in progress
  if (API_CONFIG.authCheckInProgress) {
    console.log("Auth check in progress, deferring sidebar projects load");
    return Promise.resolve([]);
  }
  
  return apiRequest(API_ENDPOINTS.PROJECTS)
    .then(response => {
      const projects = Array.isArray(response.data) ? response.data : [];
      const sidebarProjects = getElement(SELECTORS.SIDEBAR_PROJECTS);
      if (!sidebarProjects) return projects;
      
      sidebarProjects.innerHTML = '';
      
      if (projects.length === 0) {
        showEmptyState(sidebarProjects, MESSAGES.NO_PROJECTS);
        return projects;
      }
      
      projects.forEach(project => {
        sidebarProjects.appendChild(createProjectListItem(project));
      });
      
      return projects;
    })
    .catch(err => {
      handleAPIError('loading sidebar projects', err);
      return [];
    });
}

function loadConversationList() {
  // Skip if not authenticated
  const isAuthenticated = API_CONFIG?.isAuthenticated || 
                        (sessionStorage.getItem('userInfo') !== null && 
                         sessionStorage.getItem('auth_state') !== null);
  
  if (!isAuthenticated) {
    console.log("Not authenticated, skipping conversation list load");
    return Promise.resolve([]);
  }
  
  // Also skip if auth check is in progress
  if (API_CONFIG.authCheckInProgress) {
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
        loadSidebarProjects().catch(err => console.warn("Failed to load sidebar projects:", err));
        return loadConversationList();
      } else {
        handleAPIError('loading project conversations', err);
        return [];
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
let authCheckInProgress = false;
let authCheckPromise = null;

async function checkAndHandleAuth() {
  // If a check is already in progress, return the existing promise
  if (authCheckInProgress && authCheckPromise) {
    return authCheckPromise;
  }
  
  try {
    authCheckInProgress = true;
    window.API_CONFIG.authCheckInProgress = true;
    
    // Create a new promise for this check
    authCheckPromise = new Promise(async (resolve, reject) => {
      try {
        // Verify token with the server
        const response = await fetch('/api/auth/verify', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Cache-Control': 'no-cache'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Auth verification failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Update session info
        sessionStorage.setItem('userInfo', JSON.stringify({
          username: data.username,
          roles: data.roles || [],
          lastVerified: Date.now()
        }));
        
        updateAuthUI(true);
        setupTokenRefresh();
        broadcastAuth(true, data.username);
        resolve(true);
      } catch (error) {
        console.error('Auth verification failed:', error);
        TokenManager.clearTokens();
        clearSession();
        updateAuthUI(false);
        broadcastAuth(false);
        reject(error);
      } finally {
        authCheckInProgress = false;
        window.API_CONFIG.authCheckInProgress = false;
        authCheckPromise = null;
      }
    });
    
    return await authCheckPromise;
  } catch (error) {
    authCheckInProgress = false;
    window.API_CONFIG.authCheckInProgress = false;
    throw error;
  }
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
    
    // Create backdrop
    const backdrop = document.createElement("div");
    backdrop.id = "sidebarBackdrop";
    backdrop.className = "fixed inset-0 bg-black/50 z-40 md:hidden";
    backdrop.onclick = toggleSidebar;
    document.body.appendChild(backdrop);
  } else {
    sidebarEl.classList.remove('translate-x-0');
    sidebarEl.classList.add('-translate-x-full');
    
    // Remove backdrop
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
// UTILITY FUNCTIONS (Continued)
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

  // Show empty state if no matches
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
  const elementMap = {};
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    elementMap[key] = document.querySelector(selector);
  });

  // Initialize auth dropdown
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

async function initializeApplication() {
  try {
    console.log("Starting main application initialization");
    
    // Initialize auth first
    await initAuth();
    
    // Initialize base URL
    const baseUrl = window.getBaseUrl();
    console.log("API base URL set to:", baseUrl);
    
    // Initialize UI and handlers
    safeInitialize();
    if (!localStorage.getItem("modelName")) {
      localStorage.setItem("modelName", "claude-3-sonnet-20240229");
    }
    
    updateUserSessionState();
    setupGlobalKeyboardShortcuts();
    
    // Perform auth check and load initial data
    const authSuccess = await checkAndHandleAuth();
    if (!authSuccess) {
      // Changed from warning to info - this is expected when not logged in
      console.info("User not authenticated - showing login UI");
      
      // Make sure login UI is visible
      const loginRequiredMsg = document.getElementById('loginRequiredMessage');
      if (loginRequiredMsg) loginRequiredMsg.classList.remove('hidden');
      
      // We're returning true here since the app initialized correctly, just without auth
      return true;
    }
    
    // Set up window event handlers
    window.addEventListener('popstate', handleNavigationChange);
    window.addEventListener('resize', handleWindowResize);
    
    console.log("✅ Main application initialization complete");
    return true;

  } catch (error) {
    console.error("❌ Main application initialization failed:", error);
    Notifications.apiError("Failed to initialize application");
    return false;
  }
}

// ---------------------------------------------------------------------
// INITIALIZATION UTILITIES
// ---------------------------------------------------------------------
const InitUtils = {
  async initModule(name, initFn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`Initializing ${name} module (attempt ${i + 1}/${maxRetries})...`);
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
    { name: 'auth', init: () => window.initAuth?.() },
    { name: 'formatting', init: () => window.initFormatting?.() },
    { name: 'model config', init: () => window.initModelConfig?.() },
    { name: 'components', init: () => window.initComponents?.() }
  ],

  featureModules: [
    { name: 'chat extensions', init: () => window.initChatExtensions?.() },
    { name: 'project enhancements', init: () => window.initProjectEnhancements?.() },
    { name: 'project dashboard', init: () => window.initProjectDashboard?.() }
  ]
};

// ---------------------------------------------------------------------
// MAIN INITIALIZATION SEQUENCE
// ---------------------------------------------------------------------
/**
 * Initialize all application modules in the correct order
 * Returns true if successful, false if failed
 */

async function initializeAllModules() {
  try {
    console.log("Starting application initialization sequence");

    // Initialize required core modules first
    let coreSuccesses = 0;
    let coreModulesCount = 0;
    
    // Try auth initialization first
    if (window.initAuth) {
      try {
        await InitUtils.initModule('auth', window.initAuth);
        console.log("✓ Auth module initialized");
        coreSuccesses++;
      } catch (error) {
        console.info("Auth module not available - user will need to log in");
        // Still continue with other modules since we can function without auth initially
        API_CONFIG.isAuthenticated = false;
      }
      coreModulesCount++;
    }

    // Initialize other core modules
    for (const module of InitUtils.coreModules) {
      if (module.name !== 'auth' && module.init) {
        coreModulesCount++;
        try {
          await InitUtils.initModule(module.name, module.init);
          console.log(`✓ Core module ${module.name} initialized`);
          coreSuccesses++;
        } catch (error) {
          console.warn(`Core module ${module.name} failed:`, error);
        }
      }
    }

    // Check if enough core modules initialized
    if (coreSuccesses / coreModulesCount < 0.5) {
      console.warn("Less than half of core modules initialized successfully");
    }
    
    // Initialize feature modules
    for (const module of InitUtils.featureModules) {
      if (module.init) {
        try {
          // Skip project dashboard if components aren't available
          if (module.name === 'project dashboard') {
            // Just check if they exist, not if they're fully functional
            if (!window.ProjectListComponent || !window.ProjectDetailsComponent) {
              console.info('Skipping project dashboard - required components not found');
              continue;
            }
          }
          
          await InitUtils.initModule(module.name, module.init);
          console.log(`✓ Feature module ${module.name} initialized`);
        } catch (error) {
          console.warn(`Feature module ${module.name} initialization skipped:`, error.message);
        }
      }
    }

    // Initialize main application
    console.log("Initializing main application...");
    try {
      await initializeApplication();
      console.log("✅ Application initialized successfully");
    } catch (error) {
      console.warn("Application initialized with warnings:", error);
    }
    
    return true;
  } catch (error) {
    console.error("❌ Module initialization failed:", error);
    Notifications.apiError("Application initialization failed");

    // Attempt to show a user-friendly error message
    const loginRequiredMsg = document.getElementById('loginRequiredMessage');
    if (loginRequiredMsg) {
      loginRequiredMsg.classList.remove('hidden');
    }
  }
}

// ---------------------------------------------------------------------
// EVENT LISTENERS & EXPORTS
// ---------------------------------------------------------------------

// Start initialization when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize all core and feature modules
    const success = await initializeAllModules();
    if (!success) {
      throw new Error("Module initialization failed");
    }

    // Initialize additional UI components after core initialization
    if (typeof initializeModelDropdown === 'function') {
      await InitUtils.initModule('model dropdown', initializeModelDropdown);
    }

    if (typeof window.initializeChat === 'function') {
      await InitUtils.initModule('chat', window.initializeChat);
    }

    console.log("✅ Application initialization sequence complete");
  } catch (error) {
    console.error("❌ Application initialization failed:", error);
    Notifications.apiError("Application initialization failed");

    // Attempt to show a user-friendly error message
    const loginRequiredMsg = document.getElementById('loginRequiredMessage');
    if (loginRequiredMsg) {
      loginRequiredMsg.classList.remove('hidden');
    }
  }
});

// Handle authentication state changes
document.addEventListener('authStateChanged', (e) => {
  updateAuthUI(e.detail.authenticated);
  
  if (e.detail.authenticated) {
    // Only load data if we actually have auth tokens
    const hasTokens = window.TokenManager?.accessToken || 
                     (sessionStorage.getItem('auth_state') && 
                      JSON.parse(sessionStorage.getItem('auth_state'))?.hasTokens);
    
    if (hasTokens) {
      // Add small delay to ensure token propagation
      setTimeout(() => {
        try {
          // Load conversations first since they're most important
          loadConversationList().catch(err => {
            console.warn("Failed to load conversations:", err);
          });
          
          // Then load project data if the project manager is available
          if (window.projectManager?.loadProjects) {
            window.projectManager.loadProjects().then(() => {
              loadSidebarProjects().catch(err => {
                console.warn("Failed to load sidebar projects:", err);
              });
            }).catch(err => {
              console.warn("Failed to load projects:", err);
            });
          }
          
          // Finally load the conversation if it's in the URL
          const urlParams = new URLSearchParams(window.location.search);
          const chatId = urlParams.get('chatId') || window.CHAT_CONFIG?.chatId;
          if (chatId && window.loadConversation) {
            window.loadConversation(chatId).catch(err => {
              console.warn("Failed to load conversation:", err);
            });
          }
        } catch (error) {
          console.error('Error loading initial data after auth:', error);
        }
      }, 300);
    } else {
      console.warn('Auth event received but no tokens available - skipping data loading');
    }
  } else {
    // Clear UI for logged out state
    const conversationArea = getElement(SELECTORS.CONVERSATION_AREA);
    if (conversationArea) {
      conversationArea.innerHTML = '';
    }
    
    // Show login required message
    const loginMsg = getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);
    if (loginMsg) {
      loginMsg.classList.remove('hidden');
    }
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
