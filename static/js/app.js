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
        try {
          // Attempt to retrieve an access token from auth.js
          const token = await window.auth.getAuthToken();
          if (token) {
            requestOptions.headers['Authorization'] = 'Bearer ' + token;
          }
        } catch (err) {
          console.error('[app.js] Unable to retrieve auth token:', err);
          // Propagate authentication errors rather than continuing without auth
          if (err.message === 'Not authenticated') {
            throw new Error('Authentication required. Please log in and try again.');
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
          try {
            const errorData = await response.json();
            console.error('Validation error details:', errorData);
          } catch (parseErr) {
            console.error('Could not parse validation error', parseErr);
          }
        }

        // Clone response before consuming its body
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
            const li = createProjectListItem(project);
            if (li) container.appendChild(li);
          });

          // Also unhide the "projectsSection" if it exists
          const projectsSection = document.getElementById('projectsSection');
          if (projectsSection) {
            projectsSection.classList.remove('hidden');
          }

          const projectListView = document.getElementById('projectListView');
          const projectDetailsView = document.getElementById('projectDetailsView');
          if (projectListView && projectDetailsView) {
            console.debug('[loadSidebarProjects] Showing projectListView, hiding projectDetailsView');
            projectListView.classList.remove('hidden');
            projectDetailsView.classList.add('hidden');
          } else {
            console.warn('[loadSidebarProjects] Missing #projectListView or #projectDetailsView elements.');
          }
        } else {
          console.warn('[loadSidebarProjects] No projects found, rendering empty state.');
          showEmptyState(container, MESSAGES.NO_PROJECTS, 'py-4');
        }
        return projectsArray;
      })
      .catch(error => {
        console.error('[loadSidebarProjects] Failed to load sidebar projects:', error);
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
  handleAppUpdateAuthUI(authenticated, username);

  API_CONFIG.isAuthenticated = authenticated;

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
      // Project search logic goes here
    });
  }

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
