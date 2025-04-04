/**
 * ---------------------------
 * - Maintains a single API_CONFIG global object.
 * - Uses one fetch wrapper (apiRequest).
 * - Listens for authStateChanged to manage the authenticated vs. logged-out UI.
 * - Minimizes overlap with auth.js token logic (auth.js calls apiRequest, dispatches events).
 */

// ---------------------------------------------------------------------
// GLOBAL APP CONFIG & CONSTANTS
// ---------------------------------------------------------------------

const API_CONFIG = {
  baseUrl: '',
  WS_ENDPOINT: window.location.origin.replace(/^http/, 'ws'),
  isAuthenticated: false,
  authCheckInProgress: false,
  lastErrorStatus: null
};

const SELECTORS = {
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

const Notifications = {
  apiError: (msg) => console.error('API Error:', msg),
  projectNotFound: () => console.warn('Project not found')
};

// Cache for DOM elements
const ELEMENTS = {};

// ---------------------------------------------------------------------
// AUTHENTICATION FUNCTIONS
// ---------------------------------------------------------------------

/**
 * Ensures user is authenticated, handling token refresh if needed
 * @returns {Promise<boolean>} Whether user is authenticated
 */
async function ensureAuthenticated() {
  // First check memory/storage for quick response
  const hasLocalAuth = window.TokenManager?.accessToken || 
                      (sessionStorage.getItem('userInfo') !== null && 
                       sessionStorage.getItem('auth_state') !== null);
                       
  if (!hasLocalAuth) {
    console.log("No local auth found");
    return false;
  }
  
  // Check if token is expired and needs refresh
  if (window.TokenManager?.isExpired && window.TokenManager.isExpired()) {
    console.log("Token expired, attempting refresh");
    try {
      const refreshed = await window.TokenManager.refreshTokens();
      if (!refreshed) {
        console.log("Token refresh failed");
        return false;
      }
    } catch (error) {
      console.error("Token refresh error:", error);
      return false;
    }
  }
  
  // For low-friction UX, assume auth is valid after memory check and refresh
  API_CONFIG.isAuthenticated = true;
  
  // Optionally verify with backend
  try {
    const response = await apiRequest(API_ENDPOINTS.AUTH_VERIFY, 'GET', null, 0, 3000, 
      { skipAuthCheck: true, skipRetry: true });
    
    const isAuthenticated = response?.authenticated === true;
    API_CONFIG.isAuthenticated = isAuthenticated;
    
    if (!isAuthenticated) {
      console.log("Backend verification failed");
      clearAuthState();
    }
    
    return isAuthenticated;
  } catch (error) {
    console.error("Auth verification error:", error);
    // Only clear state if it's an auth error
    if (error.status === 401) {
      clearAuthState();
      return false;
    }
    // For network errors, assume auth is valid if we have tokens
    return hasLocalAuth;
  }
}

/**
 * Consistently clears authentication state across the app
 */
function clearAuthState() {
  API_CONFIG.isAuthenticated = false;
  sessionStorage.removeItem('userInfo');
  sessionStorage.removeItem('auth_state');
  
  if (window.TokenManager?.clearTokens) {
    window.TokenManager.clearTokens();
  }
  
  document.dispatchEvent(new CustomEvent('authStateChanged', {
    detail: { authenticated: false }
  }));
}

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
  const chatUI = ELEMENTS.CHAT_UI || getElement(SELECTORS.CHAT_UI);
  const noChatMsg = ELEMENTS.NO_CHAT_SELECTED_MESSAGE || getElement(SELECTORS.NO_CHAT_SELECTED_MESSAGE);

  if (chatUI && noChatMsg) {
    if (visible) {
      chatUI.classList.remove('hidden');
      noChatMsg.classList.add('hidden');
    } else {
      chatUI.classList.add('hidden');
      noChatMsg.classList.remove('hidden');
    }
  }
}

// Mobile viewport height fix
function setViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

// ---------------------------------------------------------------------
// API REQUEST FUNCTIONS
// ---------------------------------------------------------------------

function sanitizeUrl(url) {
  return url.replace(/\s+/g, '').replace(/\/+/g, '/');
}

async function apiRequest(endpoint, method = 'GET', data = null, retryCount = 0, timeoutMs = 10000, options = {}) {
  const maxRetries = 2;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Sanitize URL first
  endpoint = sanitizeUrl(endpoint);

  // Skip auth check if explicitly requested
  if (!options.skipAuthCheck && API_CONFIG.authCheckInProgress && !endpoint.includes('/auth/')) {
    if (retryCount > 5) {
      console.warn('Too many auth check delays, proceeding with request anyway');
    } else {
      console.log(`Delaying API call to ${endpoint} until auth check completes (attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, 500));
      return apiRequest(endpoint, method, data, retryCount + 1, timeoutMs, options);
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
  method = method.toUpperCase();

  // Handle data for GET/HEAD
  let finalUrl;
  if (data && ['GET', 'HEAD'].includes(method)) {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        value.forEach(v => queryParams.append(key, v));
      } else {
        queryParams.append(key, value);
      }
    }
    const queryString = queryParams.toString();
    finalUrl = cleanEndpoint.startsWith('/')
      ? `${baseUrl}${cleanEndpoint}${cleanEndpoint.includes('?') ? '&' : '?'}${queryString}`
      : `${baseUrl}/${cleanEndpoint}${cleanEndpoint.includes('?') ? '&' : '?'}${queryString}`;
  } else {
    finalUrl = cleanEndpoint.startsWith('/')
      ? `${baseUrl}${cleanEndpoint}`
      : `${baseUrl}/${cleanEndpoint}`;
  }

  console.log('Constructing API request for endpoint:', finalUrl);

  // Make sure TokenManager is available
  const authHeaders = window.TokenManager?.getAuthHeader() || {};
  console.log('Using auth headers:', authHeaders);

  const requestOptions = {
    method,
    headers: {
      'Accept': 'application/json',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      ...authHeaders
    },
    credentials: 'include',  // Critical for cookies
    cache: 'no-store',
    redirect: 'follow',
    signal: controller.signal
  };

  // Body for POST/PUT
  if (data && !['GET', 'HEAD', 'DELETE'].includes(method)) {
    if (data instanceof FormData) {
      // let the browser set Content-Type for FormData
      requestOptions.body = data;
    } else {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(data);
    }
  }

  try {
    console.log(`Making ${method} request to: ${finalUrl} (timeout: ${timeoutMs}ms)`);
    const response = await fetch(finalUrl, requestOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      API_CONFIG.lastErrorStatus = response.status;
      console.error(`API Error (${response.status}): ${method} ${finalUrl}`);

      // Handle 401 Unauthorized with token refresh
      if (response.status === 401 && retryCount < maxRetries && !options.skipRetry) {
        try {
          if (window.TokenManager?.refreshTokens) {
            console.log('Attempting token refresh due to 401 response');
            const refreshed = await window.TokenManager.refreshTokens();
            if (refreshed) {
              // Try the request again with the new token
              return apiRequest(endpoint, method, data, retryCount + 1, timeoutMs, options);
            }
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          // Now we can safely trigger auth check
          if (!endpoint.includes('/auth/')) {
            // Use our new ensureAuthenticated to handle auth state properly
            await ensureAuthenticated();
          }
        }
      } else if (response.status === 401 && (retryCount >= maxRetries || options.skipRetry)) {
        // Only clear auth state after we've exhausted retries
        if (!endpoint.includes('/auth/')) {
          await ensureAuthenticated();
        }
      }

      if (response.status === 422) {
        try {
          const errorData = await response.json();
          console.error('Validation error details:', errorData);
        } catch (parseErr) {
          console.error('Could not parse validation error', parseErr);
        }
      }

      const errorBody = await response.text();
      const error = new Error(`API error (${response.status}): ${errorBody || response.statusText}`);
      error.status = response.status;
      throw error;
    }

    let jsonData;
    try {
      jsonData = response.status !== 204 ? await response.json() : null;
    } catch (error) {
      jsonData = null;
    }

    // If server returns new tokens in the response
    if (jsonData?.access_token && window.TokenManager?.setTokens) {
      window.TokenManager.setTokens(jsonData.access_token, jsonData.refresh_token);
    }

    return jsonData;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutError.name = 'TimeoutError';
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    console.error('API request failed:', error);
    throw error;
  }
}

function getBaseUrl() {
  if (!API_CONFIG.baseUrl) {
    // Default to window.location.origin
    API_CONFIG.baseUrl = window.location.origin;

    if (API_CONFIG.backendHost) {
      API_CONFIG.baseUrl = `http://${API_CONFIG.backendHost}`;
    }
    console.log('Set API base URL:', API_CONFIG.baseUrl);
  }
  return API_CONFIG.baseUrl;
}

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
    li.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700/50 rounded cursor-pointer flex items-center transition-colors duration-150';
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

      // Switch UI to project details
      const projectListView = document.getElementById('projectListView');
      const projectDetailsView = document.getElementById('projectDetailsView');
      if (projectListView) projectListView.classList.add('hidden');
      if (projectDetailsView) projectDetailsView.classList.remove('hidden');

      // Dispatch project selected event
      document.dispatchEvent(new CustomEvent('projectSelected', {
        detail: { projectId: projectData.id }
      }));

      // Load project details
      if (window.loadProjectDetails) {
        window.loadProjectDetails(projectData.id);
      }
    });

    return li;
  } catch (error) {
    console.error('Error creating project list item:', error);
    return null;
  }
}

function renderConversationList(data) {
  const container = document.getElementById('sidebarConversations');
  if (!container) return;

  // Clear existing content
  container.innerHTML = '';

  // Deduplicate conversations
  const seenIds = new Set();
  const conversations = (data?.data?.conversations || data?.conversations || [])
    .filter(conv => {
      if (!conv?.id || seenIds.has(conv.id)) return false;
      seenIds.add(conv.id);
      return true;
    });

  // Store in global config
  window.chatConfig = window.chatConfig || {};
  window.chatConfig.conversations = conversations;

  if (conversations.length === 0) {
    showEmptyState(container, 'No conversations yet', 'py-4');
    return;
  }

  conversations.forEach(conv => {
    const item = createConversationListItem(conv);
    if (item) container.appendChild(item);
  });
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

async function loadConversationList() {
  if (!await ensureAuthenticated()) {
    console.log("Not authenticated, skipping conversation list load");
    return Promise.resolve([]);
  }

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
        loadSidebarProjects().catch(e => console.warn("Failed to load sidebar projects:", e));
        return loadConversationList();
      } else {
        handleAPIError('loading project conversations', err);
        return [];
      }
    });
}

// ---------------------------------------------------------------------
// NAVIGATION & STATE
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

async function handleNavigationChange() {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');

  // Check auth state first
  if (!await ensureAuthenticated()) {
    const loginMsg = document.getElementById("loginRequiredMessage");
    if (loginMsg) loginMsg.classList.remove("hidden");
    return;
  }

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
}

// ---------------------------------------------------------------------
// ERROR HANDLING
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// PROJECT LOADING FUNCTIONS
// ---------------------------------------------------------------------

async function loadProjects(filter = "all") {
  // First check auth state
  if (!await ensureAuthenticated()) {
    document.dispatchEvent(
      new CustomEvent("projectsLoaded", {
        detail: { 
          data: {
            projects: [],
            count: 0,
            filter: { type: filter },
            error: true,
            message: "Authentication required"
          }
        }
      })
    );
    
    const loginMsg = document.getElementById('loginRequiredMessage');
    if (loginMsg) loginMsg.classList.remove('hidden');
    
    return [];
  }
  
  try {
    if (!window.projectManager) {
      throw new Error("projectManager not initialized");
    }
    const response = await window.projectManager.loadProjects(filter);
    return response;
  } catch (error) {
    console.error("[ProjectDashboard] loadProjects failed:", error);
    document.dispatchEvent(
      new CustomEvent("projectsLoaded", {
        detail: { error: true, message: error.message }
      })
    );
    throw error;
  }
}

async function loadSidebarProjects() {
  if (!await ensureAuthenticated()) {
    console.log("Not authenticated, skipping sidebar projects load");
    return [];
  }
  
  try {
    return apiRequest(API_ENDPOINTS.PROJECTS)
      .then(projects => {
        const container = ELEMENTS.SIDEBAR_PROJECTS || getElement(SELECTORS.SIDEBAR_PROJECTS);

        if (!container) return;
        container.innerHTML = '';

        if (projects?.length > 0) {
          projects.forEach(project => {
            const li = createProjectListItem(project);
            if (li) container.appendChild(li);
          });
        } else {
          showEmptyState(container, MESSAGES.NO_PROJECTS, 'py-4');
        }
        return projects;
      })
      .catch(error => {
        console.error('Failed to load sidebar projects:', error);
        throw error;
      });
  } catch (error) {
    console.error('Failed to load sidebar projects:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------
// INITIALIZATION
// ---------------------------------------------------------------------

function cacheElements() {
  // Cache DOM elements for better performance
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    ELEMENTS[key] = document.querySelector(selector);
  });
  console.log("DOM elements cached:", Object.keys(ELEMENTS).filter(k => ELEMENTS[k]));
}

function setupEventListeners() {
  // Document level listeners
  document.addEventListener('authStateChanged', handleAuthStateChange);
  document.addEventListener('keydown', handleKeyDown);

  // Window level listeners
  window.addEventListener('orientationchange', () => {
    window.dispatchEvent(new Event('resize'));
  });
  window.addEventListener('resize', setViewportHeight);

  // UI element listeners
  document.addEventListener('click', (event) => {
    if (event.target.closest('#newConversationBtn')) {
      handleNewConversationClick();
    }
  });

  console.log("Event listeners registered");
}

// Event handler functions
function handleAuthStateChange(e) {
  const { authenticated, username } = e.detail;

  // Update auth status elements
  const authStatus = ELEMENTS.AUTH_STATUS || getElement(SELECTORS.AUTH_STATUS);
  if (authStatus) {
    authStatus.textContent = authenticated ? (username || 'Authenticated') : 'Not Authenticated';
    authStatus.classList.toggle('text-green-600', authenticated);
    authStatus.classList.toggle('text-red-600', !authenticated);
  }

  // Update UI based on auth state
  updateAuthUI(authenticated, username);

  // Update stored authentication state
  API_CONFIG.isAuthenticated = authenticated;

  // Load data if authenticated
  if (authenticated) {
    loadConversationList().catch(err => console.warn("Failed to load conversations:", err));
    loadSidebarProjects().catch(err => console.warn("Failed to load sidebar projects:", err));

    // Check for chatId in URL
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    if (chatId && typeof window.loadConversation === 'function') {
      window.loadConversation(chatId).catch(err => {
        console.warn("Failed to load conversation:", err);
      });
    }
  } else {
    // Clear the conversation area or show "Please log in"
    const conversationArea = ELEMENTS.CONVERSATION_AREA || getElement(SELECTORS.CONVERSATION_AREA);
    if (conversationArea) {
      conversationArea.innerHTML = '';
    }
    const loginMsg = ELEMENTS.LOGIN_REQUIRED_MESSAGE || getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);
    loginMsg?.classList.remove('hidden');
  }
}

function handleKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
    // e.g. Ctrl+R for "regenerate", Ctrl+C for "copy"
    if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('regenerateChat'));
    }
    if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('copyMessage'));
    }
  }
}

async function handleNewConversationClick() {
  if (!await ensureAuthenticated()) {
    window.showNotification("Please log in to create a conversation", "error");
    return;
  }
  
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

function updateAuthUI(authenticated, username = null) {
  const authBtn = ELEMENTS.AUTH_BUTTON || document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');
  const userMenu = ELEMENTS.USER_MENU || document.getElementById('userMenu');
  const authStatus = ELEMENTS.AUTH_STATUS || document.getElementById('authStatus');
  const userStatus = ELEMENTS.USER_STATUS || document.getElementById('userStatus');
  const projectPanel = ELEMENTS.PROJECT_MANAGER_PANEL || document.getElementById('projectManagerPanel');
  const loginMsg = ELEMENTS.LOGIN_REQUIRED_MESSAGE || document.getElementById('loginRequiredMessage');

  if (authenticated) {
    // Logged in UI
    authBtn?.classList.add('hidden');
    userMenu?.classList.remove('hidden');
    if (authStatus) authStatus.textContent = username || 'Authenticated';
    if (userStatus) {
      userStatus.textContent = 'Online';
      userStatus.classList.remove('text-gray-500');
      userStatus.classList.add('text-green-500');
    }
    authDropdown?.classList.add('hidden');
    projectPanel?.classList.remove('hidden');
    loginMsg?.classList.add('hidden');

    // Show project list by default
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');
    projectListView?.classList.remove('hidden');
    projectDetailsView?.classList.add('hidden');
  } else {
    // Logged out UI
    authBtn?.classList.remove('hidden');
    userMenu?.classList.add('hidden');
    if (authStatus) authStatus.textContent = 'Not Authenticated';
    if (userStatus) {
      userStatus.textContent = 'Offline';
      userStatus.classList.remove('text-green-500');
      userStatus.classList.add('text-gray-500');
    }
    projectPanel?.classList.add('hidden');
    loginMsg?.classList.remove('hidden');
  }
}

async function initializeApplication() {
  // Set initial viewport height
  setViewportHeight();

  // Cache DOM elements
  cacheElements();

  // Register event listeners
  setupEventListeners();

  try {
    console.log("Starting main application initialization");

    // Basic UI setup
    getBaseUrl();
    safeInitialize();

    // Initialize auth - this must happen AFTER apiRequest is available
    // but BEFORE we try to make any authenticated requests
    if (window.auth?.init) {
      console.log("Initializing auth module");
      await window.auth.init();
      console.log("Auth initialization complete");
    } else {
      console.warn('Auth module not available, authentication features will not work');
    }

    console.log("✅ Main application initialization complete");
    return true;
  } catch (error) {
    console.error("❌ Main application initialization failed:", error);
    Notifications.apiError("Failed to initialize application");
    return false;
  }
}

async function initializeAllModules() {
  try {
    console.log("Starting application initialization sequence");

    // The main "app-level" init
    await initializeApplication();
    
    // Check authentication early
    const isAuthenticated = await ensureAuthenticated();
    API_CONFIG.isAuthenticated = isAuthenticated;
    
    // Only try to load user data if authenticated
    if (isAuthenticated) {
      // Load sidebar projects and other user data
      if (typeof window.loadSidebarProjects === 'function') {
        await window.loadSidebarProjects();
      }
    } else {
      // Show login required message
      const loginMsg = document.getElementById("loginRequiredMessage");
      if (loginMsg) loginMsg.classList.remove("hidden");
    }

    // Initialize other modules
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
    const loginRequiredMsg = ELEMENTS.LOGIN_REQUIRED_MESSAGE || document.getElementById('loginRequiredMessage');
    if (loginRequiredMsg) {
      loginRequiredMsg.classList.remove('hidden');
    }
    return false;
  }
}

function safeInitialize() {
  // Projects search
  const projectSearch = ELEMENTS.SIDEBAR_PROJECT_SEARCH;
  if (projectSearch) {
    projectSearch.addEventListener('input', (e) => {
      // Project search implementation would go here
    });
  }

  // New project button
  const newProjectBtn = ELEMENTS.SIDEBAR_NEW_PROJECT_BTN;
  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', () => {
      if (window.projectManager?.showProjectCreateForm) {
        window.projectManager.showProjectCreateForm();
      } else if (ELEMENTS.CREATE_PROJECT_BTN) {
        ELEMENTS.CREATE_PROJECT_BTN.click();
      }
    });
  }

  // Show login
  const showLoginBtn = ELEMENTS.SHOW_LOGIN_BTN;
  const authButton = ELEMENTS.AUTH_BUTTON;
  if (showLoginBtn && authButton) {
    showLoginBtn.addEventListener('click', () => {
      authButton.click();
    });
  }
}

// EXPORTS
window.API_CONFIG = API_CONFIG;
window.SELECTORS = SELECTORS;
window.apiRequest = apiRequest;
window.getBaseUrl = getBaseUrl;
window.loadConversationList = loadConversationList;
window.loadSidebarProjects = loadSidebarProjects;
window.loadProjects = loadProjects;

// Initialize on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log("DOMContentLoaded: Starting full app init");
    await initializeAllModules();
    console.log("Application fully initialized");
  } catch (error) {
    console.error("Application initialization failed:", error);
    alert("Failed to initialize. Please refresh the page and try again.");
  }
});