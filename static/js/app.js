/**
 * ---------------------------------------------------------------------
 * app.js - Cookie-based auth only, no CORS/origin or localStorage usage.
 * Maintains a single API_CONFIG global object.
 * Uses one fetch wrapper (apiRequest).
 * Listens for authStateChanged to manage the authenticated vs. logged-out UI.
 * Relies on auth.js (or similar) for server-side session cookies.
 * ---------------------------------------------------------------------
 */

// ---------------------------------------------------------------------
// GLOBAL APP CONFIG & CONSTANTS
// ---------------------------------------------------------------------
// Create API_CONFIG to track changes to baseUrl
const API_CONFIG = {
  _baseUrl: '',  // Private property for storage
  get baseUrl() {
    return this._baseUrl;
  },
  set baseUrl(value) {
    // Log when baseUrl is being changed to track down unwanted changes
    if (value !== this._baseUrl) {
      console.warn(`API_CONFIG.baseUrl changed from "${this._baseUrl}" to "${value}"`, new Error().stack);

      // Detect and prevent incorrect domain
      if (value && value.includes('put.photo')) {
        console.error('Prevented setting incorrect domain (put.photo) as API baseUrl');
        return; // Don't set the value
      }
    }
    this._baseUrl = value;
  },
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
 * Ensures user is authenticated (cookie-based).
 * @param {Object} options - Configuration options
 * @param {boolean} options.forceVerify - Force server verification bypassing cache
 * @param {number} options.maxRetries - Max retry attempts (deprecated, handled by auth.js)
 * @param {number} options.timeoutMs - Timeout in milliseconds (deprecated, handled by auth.js)
 * @returns {Promise<boolean>} Whether user is authenticated
 */
async function ensureAuthenticated(options = {}) {
  if (!window.auth) {
    console.warn('Authentication module not available');
    return false;
  }

  try {
    return await window.auth.isAuthenticated({
      forceVerify: options.forceVerify || false
    });
  } catch (error) {
    console.error('Authentication check failed:', error);
    if (window.auth?.handleAuthError) {
      window.auth.handleAuthError(error, 'Authentication check');
    }
    return false;
  }
}

/**
 * Consistently clears authentication state across the app
 */
function clearAuthState() {
  // Delegate to auth.js
  if (window.auth?.clear) {
    window.auth.clear();
  } else {
    // Fallback for backward compatibility
    API_CONFIG.isAuthenticated = false;
    document.dispatchEvent(new CustomEvent('authStateChanged', {
      detail: { authenticated: false }
    }));
  }

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

// Track pending requests to prevent duplicates
const pendingRequests = new Map();

/**
 * Enhanced fetch wrapper with:
 * - Request deduplication
 * - Permanent error marking
 * - Better error handling
 */
async function apiRequest(endpoint, method = 'GET', data = null, retryCount = 0, timeoutMs = 10000, options = {}) {
  const maxRetries = 2;

  // Create request key for deduplication
  const requestKey = `${method}:${endpoint}:${JSON.stringify(data)}`;

  // Return existing promise if same request is pending
  if (pendingRequests.has(requestKey)) {
    return pendingRequests.get(requestKey);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Create the request promise and store it
  const requestPromise = makeApiRequest();
  pendingRequests.set(requestKey, requestPromise);

  // Clean up when done
  requestPromise.finally(() => {
    pendingRequests.delete(requestKey);
  });

  return requestPromise;

  async function makeApiRequest() {
    endpoint = sanitizeUrl(endpoint);

    // Normalize endpoint if full URL was passed
    if (endpoint.startsWith('https://') || endpoint.startsWith('http://')) {
      console.warn('Full URL detected in endpoint, normalizing:', endpoint);
      const urlObj = new URL(endpoint);

      // Additional protection against incorrect domains
      if (urlObj.hostname === 'put.photo') {
        console.warn('Detected incorrect domain in API request. Using relative paths instead.');
      }

      endpoint = urlObj.pathname + urlObj.search;
    }

    // Clean up double slashes
    const cleanEndpoint = endpoint.replace(/^https?:\/\/[^/]+/, '').replace(/\/+/g, '/');
    const baseUrl = getBaseUrl();
    method = method.toUpperCase();

    // Handle GET/HEAD query parameters
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

    const requestOptions = {
      method,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'X-Forwarded-Host': window.location.host,
        'X-Request-Domain': window.location.hostname
      },
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      credentials: 'include'  // Important for including cookies
    };

    // Body for POST/PUT
      if (data && !['GET', 'HEAD', 'DELETE'].includes(method)) {
        // Check if auth is ready before trying to get token
        if (window.auth?.isInitialized) {
          try {
            // Attempt to retrieve an access token from auth.js
            // but don't block the request if it fails
            const token = await window.auth.getAuthToken().catch(err => {
              console.warn('[app.js] Auth token retrieval failed:', err.message);
              // Log the error but don't throw - let the request continue
              return null;
            });

            if (token) {
              requestOptions.headers['Authorization'] = 'Bearer ' + token;
            }
          } catch (err) {
            // Just log the error instead of throwing
            console.error('[app.js] Auth token error:', err);
          }
        }

        if (data instanceof FormData) {
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

        // Handle auth errors using auth.js
        if (response.status === 401) {
          // Check if this is the login endpoint specifically
          if (cleanEndpoint === '/api/auth/login') {
            console.warn(`Login failed for ${finalUrl}: Invalid credentials (401)`);
            throw new Error('Invalid username or password');
          } else {
            // For other endpoints 401, delegate to auth.js
            window.auth?.handleAuthError?.(
              { status: 401, message: 'Session expired' },
              `API request to ${cleanEndpoint}`
            );
            throw new Error('Session expired. Please login again.');
          }
        } else if (response.status === 404) {
          const error = new Error(`Resource not found (404): ${finalUrl}`);
          error.status = 404;
          error.isPermanent = true; // Mark 404 as permanent
          throw error;
        } else if (response.status === 422) {
          // Clone immediately for 422 errors since we need to parse the validation details
          const responseClone = response.clone();
          try {
            const errorData = await responseClone.json();
            console.error('Validation error details:', errorData);
            const error = new Error(`Validation error (422): ${errorData.message || 'Invalid request data'}`);
            error.status = 422;
            error.data = errorData;
            throw error;
          } catch (parseErr) {
            console.error('Could not parse validation error', parseErr);
            // Fall back to text using the original response
            const errorText = await response.text();
            const error = new Error(`Validation error (422): ${errorText || 'Invalid request data'}`);
            error.status = 422;
            throw error;
          }
        }

        // Clone response before consuming its body for other error cases
        const responseClone = response.clone();

        try {
          // Try to parse response as JSON to handle inconsistent API error formats
          const errorResponse = await response.json();

          // Handle the case where status is "error" but message is "Success"
          if (errorResponse.status === "error" && errorResponse.data?.assistant_error) {
            console.warn("Detected assistant error in response:", errorResponse.data.assistant_error);
            const error = new Error(`API error (${response.status}): ${errorResponse.data.assistant_error}`);
            error.status = response.status;
            error.data = errorResponse.data;
            throw error;
          }

          // Standard error handling for JSON responses
          const error = new Error(`API error (${response.status}): ${
            errorResponse.message || errorResponse.error || response.statusText
          }`);
          error.status = response.status;
          error.data = errorResponse;
          throw error;
        } catch (jsonError) {
          try {
            // Fallback to text using the cloned response
            const errorBody = await responseClone.text();
            const error = new Error(`API error (${response.status}): ${errorBody || response.statusText}`);
            error.status = response.status;
            throw error;
          } catch (textError) {
            // If both JSON and text extraction fail, use the status text
            const error = new Error(`API error (${response.status}): ${response.statusText}`);
            error.status = response.status;
            throw error;
          }
        }
      }

      let jsonData = null;
      if (response.status !== 204) {
        try {
          jsonData = await response.json();
        } catch (err) {
          jsonData = null;
        }
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
}


function getBaseUrl() {
  // We do not rely on window.location.origin or local storage.
  // If needed, set API_CONFIG.baseUrl explicitly or leave empty for relative paths.

  // Fix for incorrect domain - if baseUrl contains 'put.photo', reset it
  if (API_CONFIG.baseUrl && API_CONFIG.baseUrl.includes('put.photo')) {
    console.warn('Detected incorrect API domain (put.photo). Resetting to relative paths.');
    API_CONFIG.baseUrl = '';
  }

  if (!API_CONFIG.baseUrl) {
    // Default to relative root
    API_CONFIG.baseUrl = '';
  }
  return API_CONFIG.baseUrl;
}

// ---------------------------------------------------------------------
// DATA LOADING & RENDERING
// ---------------------------------------------------------------------

// Add a simple debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Variable to track the currently loading project ID
let currentlyLoadingProjectId = null;
const DEBOUNCE_DELAY = 300; // milliseconds

// Debounced version of the project loading logic
const debouncedLoadProject = debounce(async (projectId) => {
  if (currentlyLoadingProjectId === projectId) {
    console.log(`[App] Project ${projectId} is already loading.`);
    return;
  }
  currentlyLoadingProjectId = projectId;

  try {
    // Switch UI immediately for responsiveness
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');
    if (projectListView) projectListView.classList.add('hidden');
    if (projectDetailsView) projectDetailsView.classList.remove('hidden');

    // Dispatch project selected event
    document.dispatchEvent(new CustomEvent('projectSelected', {
      detail: { projectId: projectId }
    }));

    // Load project details using projectManager if available
    if (window.projectManager?.loadProjectDetails) {
      console.log(`[App] Debounced load triggered for project: ${projectId}`);
      await window.projectManager.loadProjectDetails(projectId);
    } else if (window.loadProjectDetails) { // Fallback if projectManager isn't ready
      console.log(`[App] Debounced load triggered (fallback) for project: ${projectId}`);
      await window.loadProjectDetails(projectId);
    } else {
      console.warn(`[App] No function found to load project details for ${projectId}`);
    }
  } catch (error) {
    console.error(`[App] Error loading project ${projectId}:`, error);
    // Optionally, switch back to the list view on error
    // const projectListView = document.getElementById('projectListView');
    // const projectDetailsView = document.getElementById('projectDetailsView');
    // if (projectListView) projectListView.classList.remove('hidden');
    // if (projectDetailsView) projectDetailsView.classList.add('hidden');
  } finally {
    // Allow loading again after completion or error
    if (currentlyLoadingProjectId === projectId) {
      currentlyLoadingProjectId = null;
    }
  }
}, DEBOUNCE_DELAY);


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

    // Use the debounced function for the click handler
    li.addEventListener('click', () => {
      debouncedLoadProject(projectData.id);
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

  container.innerHTML = '';

  const seenIds = new Set();
  const conversations = (data?.data?.conversations || data?.conversations || [])
    .filter(conv => {
      if (!conv?.id || seenIds.has(conv.id)) return false;
      seenIds.add(conv.id);
      return true;
    });

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
    return [];
  }

  if (API_CONFIG.authCheckInProgress) {
    console.log("Auth check in progress, deferring conversation list load");
    return [];
  }

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
  const view = urlParams.get('view'); // Check for view parameter

  // Prioritize showing projects view if specified
  if (view === 'projects') {
    console.log('[handleNavigationChange] View=projects detected, showing projects view.');
    if (window.ProjectDashboard?.showProjectsView) {
      window.ProjectDashboard.showProjectsView();
    } else {
       // Fallback if ProjectDashboard isn't ready or doesn't have the function
       const listView = document.getElementById('projectListView');
       const detailsView = document.getElementById('projectDetailsView');
       if (listView) listView.classList.remove('hidden');
       if (detailsView) detailsView.classList.add('hidden');
    }
    // Don't proceed to load/create chat if showing projects
    return;
  }


  if (!await ensureAuthenticated()) {
    console.log('[handleNavigationChange] Not authenticated, showing login message.');
    const loginMsg = document.getElementById("loginRequiredMessage");
    if (loginMsg) loginMsg.classList.remove("hidden");
    setChatUIVisibility(false); // Ensure chat UI is hidden
    return;
  }

  // Hide login message if authenticated
  const loginMsg = document.getElementById("loginRequiredMessage");
  if (loginMsg) loginMsg.classList.add("hidden");


  if (chatId) {
    console.log(`[handleNavigationChange] ChatId=${chatId} found, loading conversation.`);
    setChatUIVisibility(true);
    if (typeof window.loadConversation === 'function') {
      window.loadConversation(chatId).catch(err => {
        handleAPIError('loading conversation', err);
        setChatUIVisibility(false);
        // Maybe redirect or show an error message specific to chat loading failure
        window.history.replaceState({}, '', '/'); // Clear invalid chatId from URL
      });
    } else {
       console.warn('[handleNavigationChange] window.loadConversation function not found.');
       setChatUIVisibility(false);
    }
  } else {
    // Only create a new chat if NO chatId is present AND we are not explicitly viewing projects
    console.log('[handleNavigationChange] No chatId found, showing empty state (no automatic new chat creation).');
    // Instead of creating a new chat automatically, show the placeholder/empty state.
    // Let the user explicitly click "New Chat" or select a project/conversation.
    setChatUIVisibility(false);

    // --- Removed automatic new chat creation ---
    // if (typeof window.createNewChat === 'function') {
    //   console.log('[handleNavigationChange] No chatId found, creating new chat.');
    //   window.createNewChat().catch(err => {
    //     handleAPIError('creating new chat', err);
    //     setChatUIVisibility(false);
    //   });
    // } else {
    //   console.warn('[handleNavigationChange] window.createNewChat function not found.');
    //   setChatUIVisibility(false);
    // }
    // --- End Removed ---
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
      .then(apiResponse => {
        // Some servers return an object with projects array, or data array, etc.
        // Let's unify it by extracting the array from known properties or fallback to the response itself if it's array.
        let projectsArray = [];
        if (Array.isArray(apiResponse)) {
          projectsArray = apiResponse;
        } else if (Array.isArray(apiResponse?.data)) {
          projectsArray = apiResponse.data;
        } else if (Array.isArray(apiResponse?.projects)) {
          projectsArray = apiResponse.projects;
        } else {
          console.warn('[loadSidebarProjects] Unexpected response shape:', apiResponse);
        }

        const container = ELEMENTS.SIDEBAR_PROJECTS || getElement(SELECTORS.SIDEBAR_PROJECTS);
        if (!container) {
          console.warn('[loadSidebarProjects] No sidebar project container found (SIDEBAR_PROJECTS).');
          return;
        }

        console.debug('[loadSidebarProjects] Raw response:', apiResponse);
        console.debug('[loadSidebarProjects] Resolved projects array length:', projectsArray.length);

        container.innerHTML = '';

        if (projectsArray.length > 0) {
          console.debug('[loadSidebarProjects] Rendering', projectsArray.length, 'projects.');
          projectsArray.forEach(project => {
            const li = createProjectListItem(project); // Uses the updated function
            if (li) container.appendChild(li);
          });

          // REMOVED: Manual view switching logic from here as well.
          // Let the default state or another component manage initial view.
        } else {
          console.warn('[loadSidebarProjects] No projects found, rendering empty state.');
          showEmptyState(container, MESSAGES.NO_PROJECTS, 'py-4');
        }
        // Dispatch an event indicating projects are loaded in the sidebar
        document.dispatchEvent(new CustomEvent('sidebarProjectsRendered', { detail: { count: projectsArray.length } }));
        return projectsArray;
      })
      .catch(error => {
        console.error('[loadSidebarProjects] Failed to load sidebar projects:', error);
        // Dispatch error event
        document.dispatchEvent(new CustomEvent('sidebarProjectsError', { detail: { error } }));
        throw error; // Re-throw if needed
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
    // Listener for the main "New Project" button in the project list view
    if (event.target.closest('#createProjectBtn')) {
      console.log('Create Project button clicked');
      if (window.modalManager && typeof window.modalManager.show === 'function') {
        window.modalManager.show('project', {
          updateContent: (modalEl) => {
            // Reset form if needed
            const form = modalEl.querySelector('form');
            if (form) form.reset();
            // Clear project ID if editing vs creating
            const projectIdInput = modalEl.querySelector('#projectId');
            if (projectIdInput) projectIdInput.value = '';
            // Update title
            const title = modalEl.querySelector('.modal-title, h3');
            if (title) title.textContent = 'Create New Project';
          }
        });
      } else {
        console.error('ModalManager or show function not available.');
      }
    }
    // Listener for the "Back to Projects" button in the details view
    if (event.target.closest('#backToProjectsBtn')) {
        console.log('Back to Projects button clicked');
        if (window.ProjectDashboard && typeof window.ProjectDashboard.showProjectsView === 'function') {
            window.ProjectDashboard.showProjectsView();
        } else if (typeof window.showProjectsView === 'function') {
            window.showProjectsView();
        } else {
            console.error('showProjectsView function not available.');
            // Fallback logic
            const listView = document.getElementById('projectListView');
            const detailsView = document.getElementById('projectDetailsView');
            if (listView) listView.classList.remove('hidden');
            if (detailsView) detailsView.classList.add('hidden');
        }
    }
    // Listener for Edit Project Button
    if (event.target.closest('#editProjectBtn')) {
        console.log('Edit Project button clicked');
        const currentProject = window.projectManager?.currentProject();
        if (currentProject && window.modalManager) {
            window.modalManager.show('project', {
                updateContent: (modalEl) => {
                    // Populate form with current project data
                    const form = modalEl.querySelector('form');
                    if (form) {
                        form.querySelector('#projectId').value = currentProject.id;
                        form.querySelector('#projectName').value = currentProject.name;
                        form.querySelector('#projectDescription').value = currentProject.description || '';
                        // Update title
                        const title = modalEl.querySelector('.modal-title, h3');
                        if (title) title.textContent = `Edit Project: ${currentProject.name}`;
                    }
                }
            });
        } else {
            console.error('Cannot edit: Project data or ModalManager not available.');
        }
    }
    // Listener for Pin Project Button
    if (event.target.closest('#pinProjectBtn')) {
        console.log('Pin Project button clicked');
        const currentProject = window.projectManager?.currentProject();
        if (currentProject && window.projectManager?.togglePinProject) {
            window.projectManager.togglePinProject(currentProject.id)
                .then(updatedProject => {
                    window.showNotification?.(`Project ${updatedProject.pinned ? 'pinned' : 'unpinned'}`, 'success');
                    // Optionally refresh project details or list
                    window.loadProjectDetails?.(currentProject.id); // Refresh details view
                    window.loadSidebarProjects?.(); // Refresh sidebar list
                })
                .catch(err => {
                    console.error('Error toggling pin:', err);
                    window.showNotification?.('Failed to update pin status', 'error');
                });
        } else {
             console.error('Cannot pin: Project data or togglePinProject function not available.');
        }
    }
    // Listener for Archive Project Button
    if (event.target.closest('#archiveProjectBtn')) {
        console.log('Archive Project button clicked');
        const currentProject = window.projectManager?.currentProject();
        if (currentProject && window.projectManager?.toggleArchiveProject && window.ModalManager?.confirmAction) {
             window.ModalManager.confirmAction({
                title: 'Confirm Archive',
                message: `Are you sure you want to ${currentProject.archived ? 'unarchive' : 'archive'} this project?`,
                confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
                confirmClass: currentProject.archived ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700',
                onConfirm: () => {
                    window.projectManager.toggleArchiveProject(currentProject.id)
                        .then(updatedProject => {
                            window.showNotification?.(`Project ${updatedProject.archived ? 'archived' : 'unarchived'}`, 'success');
                            // Go back to list view after archiving/unarchiving
                            if (window.ProjectDashboard?.showProjectsView) window.ProjectDashboard.showProjectsView();
                            window.loadSidebarProjects?.(); // Refresh sidebar list
                            window.loadProjects?.(); // Refresh main list
                        })
                        .catch(err => {
                            console.error('Error toggling archive:', err);
                            window.showNotification?.('Failed to update archive status', 'error');
                        });
                }
            });
        } else {
            console.error('Cannot archive: Project data, toggleArchiveProject, or ModalManager not available.');
        }
    }
    // Listener for Minimize Chat Button (in project details)
    if (event.target.closest('#minimizeChatBtn')) {
        console.log('Minimize chat button clicked');
        const chatContainer = document.getElementById('projectChatContainer');
        if (chatContainer) {
          // Example: Toggle visibility or add a class to collapse
          chatContainer.classList.toggle('hidden'); // Simple hide/show
        }
    }
  });

  // Navigation tracking to prevent auth errors during page transitions
  setupNavigationTracking();

  console.log("Event listeners registered");
}

// Setup tracking for navigation events to prevent auth errors during transitions
function setupNavigationTracking() {
  // Store timestamp when user interacts with the page
  function recordInteraction() {
    sessionStorage.setItem('last_page_interaction', Date.now().toString());
  }

  // Track clicks on navigation elements
  document.addEventListener('click', (e) => {
    if (e.target.closest('a[href*="project"]') ||
        e.target.closest('button[data-action*="project"]') ||
        e.target.closest('#manageDashboardBtn') ||
        e.target.closest('#projectsNav')) {
      console.log("Detected navigation click");
      recordInteraction();
    }
  });

  // Also track before unload events
  window.addEventListener('beforeunload', recordInteraction);

  // Record page load as an interaction
  recordInteraction();
}

// Keep track of the last known auth state to avoid redundant actions
let lastKnownAuthState = null;

function handleAuthStateChange(e) {
  const { authenticated, username } = e.detail;
  const stateChanged = authenticated !== lastKnownAuthState;
  lastKnownAuthState = authenticated; // Update last known state

  // Update auth status elements (always do this)
  const authStatus = ELEMENTS.AUTH_STATUS || getElement(SELECTORS.AUTH_STATUS);
  if (authStatus) {
    authStatus.textContent = authenticated ? (username || 'Authenticated') : 'Not Authenticated';
    authStatus.classList.toggle('text-green-600', authenticated);
    authStatus.classList.toggle('text-red-600', !authenticated);
  }

  // Update general UI based on auth state (always do this)
  handleAppUpdateAuthUI(authenticated, username);

  API_CONFIG.isAuthenticated = authenticated;

  if (authenticated) {
    // Only load data if the state *changed* to authenticated or if data hasn't been loaded yet
    // (Need a flag or check for existing data, simplified here)
    if (stateChanged) {
      console.log("[AuthStateChange] User authenticated, loading initial data.");
      loadConversationList().catch(err => console.warn("Failed to load conversations:", err));
      loadSidebarProjects().catch(err => console.warn("Failed to load sidebar projects:", err));

      // Check for chatId in URL only on initial load/auth change
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chatId');
      if (chatId && typeof window.loadConversation === 'function') {
        window.loadConversation(chatId).catch(err => {
          console.warn("Failed to load conversation:", err);
        });
      }
    } else {
      console.log("[AuthStateChange] Auth state confirmed as authenticated, skipping redundant data load.");
    }
  } else {
    // Clear UI elements when logged out
    const conversationArea = ELEMENTS.CONVERSATION_AREA || getElement(SELECTORS.CONVERSATION_AREA);
    if (conversationArea) conversationArea.innerHTML = '';

    const sidebarConversations = ELEMENTS.SIDEBAR_CONVERSATIONS || getElement(SELECTORS.SIDEBAR_CONVERSATIONS);
    if (sidebarConversations) showEmptyState(sidebarConversations, 'Please log in', 'py-4');

    const sidebarProjects = ELEMENTS.SIDEBAR_PROJECTS || getElement(SELECTORS.SIDEBAR_PROJECTS);
    if (sidebarProjects) showEmptyState(sidebarProjects, 'Please log in', 'py-4');

    const loginMsg = ELEMENTS.LOGIN_REQUIRED_MESSAGE || getElement(SELECTORS.LOGIN_REQUIRED_MESSAGE);
    loginMsg?.classList.remove('hidden');

    const projectManagerPanel = ELEMENTS.PROJECT_MANAGER_PANEL || getElement(SELECTORS.PROJECT_MANAGER_PANEL);
    projectManagerPanel?.classList.add('hidden');

    // Clear current project view if necessary
    const projectDetailsView = document.getElementById('projectDetailsView');
    if (projectDetailsView) projectDetailsView.classList.add('hidden');
    const projectListView = document.getElementById('projectListView');
    if (projectListView) projectListView.classList.remove('hidden'); // Show list view (which might show login required)

    console.log("[AuthStateChange] User logged out, UI cleared.");
  }
}

function handleKeyDown(e) {
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
}

async function handleNewConversationClick() {
  if (!await ensureAuthenticated()) {
    window.showNotification?.("Please log in to create a conversation", "error");
    return;
  }

  // For demonstration, this uses a function in window.projectManager
  if (window.projectManager?.createConversation) {
    window.projectManager.createConversation(null)
      .then(newConversation => {
        window.location.href = `/?chatId=${newConversation.id}`;
      })
      .catch(err => {
        handleAPIError('creating conversation', err);
      });
  } else {
    Notifications.apiError('No project manager or conversation creation method found');
  }
}

function handleAppUpdateAuthUI(authenticated, username = null) {
  if (window.auth && typeof window.auth.updateAuthUI === 'function') {
    window.auth.updateAuthUI(authenticated, username);
  }
}

async function initializeApplication() {
  setViewportHeight();
  cacheElements();
  setupEventListeners();

  try {
    console.log("Starting main application initialization");

    getBaseUrl();
    safeInitialize();

    // Initialize auth if needed
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
    console.log("Initializing all application modules...");

    // Initialize core application
    await initializeApplication();

    // Initialize project manager if available
    if (window.projectManager?.initialize) {
      await window.projectManager.initialize();
      console.log("Project manager initialized");
    }

    // Initialize sidebar if available
    if (window.sidebar?.initialize) {
      window.sidebar.initialize();
      console.log("Sidebar initialized");
    }

  // Removed redundant chat interface initialization to avoid double init
  // (Handled in chat-core.js / ChatManager)

    // Handle any initial navigation
    await handleNavigationChange();

    console.log("All modules initialized successfully");
    return true;
  } catch (error) {
    console.error("Failed to initialize all modules:", error);
    return false;
  }
}

function safeInitialize() {
  const projectSearch = ELEMENTS.SIDEBAR_PROJECT_SEARCH;
  if (projectSearch) {
    projectSearch.addEventListener('input', (e) => {
      // Project search logic goes here (ensure this is implemented if needed)
      const searchTerm = e.target.value.toLowerCase();
      const projectItems = document.querySelectorAll('#sidebarProjects li');
      projectItems.forEach(item => {
          const projectName = item.textContent.toLowerCase();
          item.style.display = projectName.includes(searchTerm) ? '' : 'none';
      });
    });
  }

  const newProjectBtn = ELEMENTS.SIDEBAR_NEW_PROJECT_BTN;
  if (newProjectBtn) {
    newProjectBtn.addEventListener('click', () => {
        console.log('Sidebar New Project button clicked');
        if (window.modalManager && typeof window.modalManager.show === 'function') {
            window.modalManager.show('project', { /* options as needed */ });
        } else {
            console.error('ModalManager or show function not available.');
        }
    });
  }

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
window.ensureAuthenticated = ensureAuthenticated; // <-- Add this line
window.loadConversationList = loadConversationList;
window.loadSidebarProjects = loadSidebarProjects;
window.loadProjects = loadProjects;
window.loadProjectList = loadProjects; // Add alias for loadProjects function to match auth.js reference

// Central Initialization Controller
window.appInitializer = {
  status: 'pending',
  queue: [],

  register: (component) => {
    if (window.appInitializer.status === 'ready') component.init();
    else window.appInitializer.queue.push(component);
  },

  initialize: async () => {
    try {
      console.log("Starting centralized initialization");
      await initializeAllModules();
      window.appInitializer.status = 'ready';
      window.appInitializer.queue.forEach(c => c.init());
      console.log("Application fully initialized");
    } catch (error) {
      console.error("App initialization error:", error);
      alert("Failed to initialize. Please refresh the page.");
    }
  }
};

// Single DOMContentLoaded handler
document.addEventListener('DOMContentLoaded', () => {
  window.appInitializer.initialize().catch(error => {
    console.error("App initialization error:", error);
    alert("Failed to initialize. Please refresh the page.");
  });

  // Signal that app.js is loaded and initialized
  console.log('[app.js] Dispatching appJsReady event');
  document.dispatchEvent(new CustomEvent('appJsReady'));
});

// Add listener for projectSelected event to handle view switching
document.addEventListener('projectSelected', (event) => {
  const projectId = event.detail.projectId;
  console.log(`[app.js] projectSelected event received for project: ${projectId}`);

  // Hide list view, show details view
  const projectListView = document.getElementById('projectListView');
  const projectDetailsView = document.getElementById('projectDetailsView');

  if (projectListView) {
    projectListView.classList.add('hidden');
    console.log('[app.js] Hiding projectListView');
  } else {
    console.warn('[app.js] projectListView not found');
  }

  if (projectDetailsView) {
    projectDetailsView.classList.remove('hidden');
    console.log('[app.js] Showing projectDetailsView');
     // Scroll to top of details view might be helpful
     projectDetailsView.scrollTop = 0;
  } else {
     console.warn('[app.js] projectDetailsView not found');
  }

  // Update URL maybe? (Optional, depends on desired behavior)
  // window.history.pushState({ projectId }, '', `/?view=project&projectId=${projectId}`);
});

// Add listener to go back to project list
// This could be triggered by a "Back" button in the details view
document.addEventListener('showProjectList', () => {
  console.log('[app.js] showProjectList event received');
  const projectListView = document.getElementById('projectListView');
  const projectDetailsView = document.getElementById('projectDetailsView');
  if (projectListView) projectListView.classList.remove('hidden');
  if (projectDetailsView) projectDetailsView.classList.add('hidden');

  // Update URL maybe?
   window.history.pushState({}, '', '/?view=projects');
});
