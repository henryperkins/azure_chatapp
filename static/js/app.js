/**
 * ---------------------------------------------------------------------
 * app.js - Cookie-based auth only, no CORS/origin or localStorage usage.
 * Maintains a single API_CONFIG global object.
 * Uses one fetch wrapper (apiRequest).
 * Listens for authStateChanged to manage the authenticated vs. logged-out UI.
 * Relies on auth.js (or similar) for server-side session cookies.
 * ---------------------------------------------------------------------
 */

//
// PHASE-BASED INITIALIZATION
//
const AppPhase = {
  BOOT: 'boot',
  DOM_READY: 'dom_ready',
  AUTH_CHECKED: 'auth_checked',
  COMPLETE: 'complete'
};

let currentPhase = AppPhase.BOOT;
function setPhase(phase) {
  currentPhase = phase;
  document.dispatchEvent(new CustomEvent('phasechange', { detail: { phase } }));
  console.debug(`[setPhase] Transitioned to phase: ${phase}`);
}

// ---------------------------------------------------------------------
// GLOBAL APP CONFIG & CONSTANTS
// ---------------------------------------------------------------------
// Add initialization tracking
window.__appStartTime = Date.now();
window.__appInitializing = true;

const API_CONFIG = {
  _baseUrl: '',
  get baseUrl() {
    return this._baseUrl;
  },
  set baseUrl(value) {
    // Warn if changing base URL
    if (value !== this._baseUrl) {
      console.warn(`API_CONFIG.baseUrl changed from "${this._baseUrl}" to "${value}"`, new Error().stack);

      // Prevent incorrect domain
      if (value && value.includes('put.photo')) {
        console.error('Prevented setting incorrect domain (put.photo) as API baseUrl');
        return;
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
  AUTH_VERIFY: '/api/auth/verify/',
  PROJECTS: '/api/projects/',
  PROJECT_DETAILS: '/api/projects/{projectId}/',
  // Removed unused endpoint
  PROJECT_CONVERSATIONS: '/api/projects/{project_id}/conversations',
  PROJECT_FILES: '/api/projects/{projectId}/files/'
};

const Notifications = {
  apiError: (msg) => console.error('API Error:', msg),
  projectNotFound: () => console.warn('Project not found')
};

// Cache for DOM elements
const ELEMENTS = {};

// ---------------------------------------------------------------------
// CUSTOM ERROR CLASSES
// ---------------------------------------------------------------------
class APIError extends Error {
  constructor(message, { status, code, isPermanent } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.isPermanent = !!isPermanent;
  }
}

// ---------------------------------------------------------------------
// AUTHENTICATION FUNCTIONS
// ---------------------------------------------------------------------

function handleAuthModalPositioning() {
  const authBtn = document.getElementById("authButton");
  const authDropdown = document.getElementById("authDropdown");

  if (!authBtn || !authDropdown || authDropdown.classList.contains('hidden')) {
    return; // Don't adjust if elements not found or dropdown is hidden
  }

  // Adjust positioning based on viewport
  if (window.innerWidth < 768) { // md breakpoint
    // Center the dropdown on mobile devices
    // The CSS in auth-mobile-fix.css handles most positioning
    // but we still need to ensure it's visible within the viewport

    // Clear any right positioning that might interfere with our centered approach
    authDropdown.style.right = '';

    // Ensure the dropdown is fully visible within viewport heights
    const viewportHeight = window.innerHeight;
    const dropdownRect = authDropdown.getBoundingClientRect();

    // If dropdown would extend beyond viewport, adjust top position
    if (dropdownRect.bottom > viewportHeight) {
      const newTopPosition = Math.max(10, viewportHeight - dropdownRect.height - 10);
      authDropdown.style.top = `${newTopPosition}px`;
    }
  } else {
    // Reset all inline styles for desktop view
    authDropdown.style.right = '';
    authDropdown.style.top = '';
  }
}

/**
 * Ensures user is authenticated (cookie-based).
 * Incorporates authCheckInProgress to avoid race conditions.
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} Whether user is authenticated
 */

/**
 * Clears authentication state across the app
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

/**
 * Ensures user is authenticated, with option to force server verification
 * @param {Object} [options] - Optional configuration
 * @param {boolean} [options.forceVerify=false] - Whether to force server verification
 * @returns {Promise<boolean>} Promise resolving to authentication status
 */
function ensureAuthenticated(options = {}) {
  const { forceVerify = false } = options;

  // Return cached auth state if available and not forcing verification
  if (API_CONFIG.isAuthenticated && !forceVerify && !API_CONFIG.authCheckInProgress) {
    return Promise.resolve(true);
  }

  // Prevent concurrent auth checks
  if (API_CONFIG.authCheckInProgress) {
    return new Promise((resolve) => {
      const listener = (e) => {
        document.removeEventListener('authStateChanged', listener);
        resolve(API_CONFIG.isAuthenticated);
      };
      document.addEventListener('authStateChanged', listener);
    });
  }

  API_CONFIG.authCheckInProgress = true;

  // Use auth.js if available
  if (window.auth?.isAuthenticated) {
    return window.auth.isAuthenticated(options)
      .then(isAuth => {
        API_CONFIG.isAuthenticated = isAuth;
        API_CONFIG.authCheckInProgress = false;
        return isAuth;
      })
      .catch(err => {
        console.error('[ensureAuthenticated] Auth check failed:', err);
        API_CONFIG.isAuthenticated = false;
        API_CONFIG.authCheckInProgress = false;
        return false;
      });
  }

  // Fallback implementation
  return apiRequest(API_ENDPOINTS.AUTH_VERIFY)
    .then(() => {
      API_CONFIG.isAuthenticated = true;
      API_CONFIG.authCheckInProgress = false;
      document.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { authenticated: true }
      }));
      return true;
    })
    .catch(err => {
      console.error('[ensureAuthenticated] Auth verification failed:', err);
      API_CONFIG.isAuthenticated = false;
      API_CONFIG.authCheckInProgress = false;
      document.dispatchEvent(new CustomEvent('authStateChanged', {
        detail: { authenticated: false }
      }));
      return false;
    });
}

// ---------------------------------------------------------------------
// UTILITY FUNCTIONS
// ---------------------------------------------------------------------

function isValidUUID(uuid) {
  try {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof uuid === 'string' && regex.test(uuid);
  } catch (e) {
    console.error('[isValidUUID] Validation error:', e);
    return false;
  }
}

function getElement(selector) {
  return document.querySelector(selector);
}

function getRequiredElement(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`[getRequiredElement] Required element not found: ${selector}`);
  }
  return el;
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

function setViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

// ---------------------------------------------------------------------
// DEDICATED API REQUEST FUNCTIONS
// ---------------------------------------------------------------------

function sanitizeUrl(url) {
  return url
    .replace(/\s+/g, '')
    .replace(/\/+/g, '/');
}

// Track pending requests to prevent duplicates
const pendingRequests = new Map();

/**
 * Enhanced fetch wrapper with:
 *  - Request deduplication
 *  - Timeout handling (only if user doesn't supply their own AbortController)
 *  - Central error parsing
 */
async function apiRequest(endpoint, method = 'GET', data = null, options = {}) {
  const requestKey = `${method}:${endpoint}:${JSON.stringify(data)}`;

  // Deduplication check
  if (pendingRequests.has(requestKey)) {
    console.debug(`[apiRequest] Deduplicating request: ${requestKey}`);
    return pendingRequests.get(requestKey);
  }

  const controller = options.signal?.controller || new AbortController();
  const timeoutMs = options.timeout || 10000;
  // Only apply our timeout if caller hasn't supplied a custom signal
  const timeoutId = options.signal ? null : setTimeout(() => controller.abort(), timeoutMs);

  // Construct request promise
  const requestPromise = (async () => {
    try {
      endpoint = sanitizeUrl(endpoint);

      // If passed a full URL, normalize to avoid domain issues
      if (endpoint.startsWith('https://') || endpoint.startsWith('http://')) {
        console.warn('Full URL detected in endpoint, normalizing:', endpoint);
        const urlObj = new URL(endpoint);

        if (urlObj.hostname.includes('put.photo')) {
          console.error('[apiRequest] Prohibited domain: put.photo');
          throw new Error('Prohibited domain detected in URL');
        }
        endpoint = urlObj.pathname + urlObj.search;
      }

      // Clean double slashes
      const cleanEndpoint = endpoint.replace(/^https?:\/\/[^/]+/, '').replace(/\/+/g, '/');
      const baseUrl = getBaseUrl();
      const uppercaseMethod = method.toUpperCase();

      // Build final URL (with query params for GET/HEAD)
      let finalUrl;
      if (data && ['GET', 'HEAD'].includes(uppercaseMethod)) {
        const queryParams = new URLSearchParams();
        Object.entries(data).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach(v => queryParams.append(key, v));
          } else {
            queryParams.append(key, value);
          }
        });
        const queryString = queryParams.toString();
        finalUrl = cleanEndpoint.startsWith('/')
          ? `${baseUrl}${cleanEndpoint}${cleanEndpoint.includes('?') ? '&' : '?'}${queryString}`
          : `${baseUrl}/${cleanEndpoint}${cleanEndpoint.includes('?') ? '&' : '?'}${queryString}`;
      } else {
        finalUrl = cleanEndpoint.startsWith('/')
          ? `${baseUrl}${cleanEndpoint}`
          : `${baseUrl}/${cleanEndpoint}`;
      }

      console.log(`[apiRequest] ${uppercaseMethod} -> ${finalUrl} (timeout=${timeoutMs}ms)`);

      // Prepare request options
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
      const requestOptions = {
        method: uppercaseMethod,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'X-Forwarded-Host': window.location.host,
          'X-Request-Domain': window.location.hostname,
          'X-CSRF-Token': csrfToken || ''
        },
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        credentials: 'include'
      };

      // If data is present, handle body
      if (data && !['GET', 'HEAD', 'DELETE'].includes(uppercaseMethod)) {
        if (window.auth?.isInitialized) {
          try {
            const token = await window.auth.getAuthToken().catch(err => {
              console.debug('[apiRequest] Continuing with cookie session (no valid bearer token).');
              return null;
            });
            if (token) {
              requestOptions.headers['Authorization'] = 'Bearer ' + token;
            }
          } catch (err) {
            console.error('[apiRequest] Auth token error:', err);
          }
        }
        if (data instanceof FormData) {
          // Let browser handle content-type
          requestOptions.body = data;
        } else {
          requestOptions.headers['Content-Type'] = 'application/json';
          requestOptions.body = JSON.stringify(data);
        }
      }

      const response = await fetch(finalUrl, requestOptions);
      if (!response.ok) {
        API_CONFIG.lastErrorStatus = response.status;
        throw await parseErrorResponse(response, finalUrl);
      }

      // If we have no content, return null
      if (response.status === 204) {
        return null;
      }

      // Attempt JSON parse
      return await response.json();

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestKey);
    }
  })();

  pendingRequests.set(requestKey, requestPromise);
  return requestPromise;
}

/**
 * Parses error response from fetch and returns a standardized Error or APIError.
 */
async function parseErrorResponse(response, finalUrl) {
  const status = response.status;
  const responseClone = response.clone();

  let errData;
  try {
    errData = await response.json();
  } catch {
    // fallback to text if JSON parse fails
    const text = await responseClone.text().catch(() => response.statusText);
    return new APIError(`API error (${status}): ${text || response.statusText}`, {
      status,
      code: `E${status}`
    });
  }

  // Additional nuance for known error structures
  const message = errData.message || errData.error || response.statusText || `HTTP ${status}`;
  return new APIError(`API error (${status}): ${message}`, {
    status,
    code: `E${status}`,
    isPermanent: status === 404
  });
}

// ---------------------------------------------------------------------
// GET BASE URL
// ---------------------------------------------------------------------
function getBaseUrl() {
  if (API_CONFIG.baseUrl && API_CONFIG.baseUrl.includes('put.photo')) {
    console.warn('Detected incorrect API domain (put.photo). Resetting to relative paths.');
    API_CONFIG.baseUrl = '';
  }

  if (!API_CONFIG.baseUrl) {
    API_CONFIG.baseUrl = '';
  }
  return API_CONFIG.baseUrl;
}

// ---------------------------------------------------------------------
// DATA LOADING & RENDERING
// ---------------------------------------------------------------------

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

let currentlyLoadingProjectId = null;
const DEBOUNCE_DELAY = 300; // ms

const debouncedLoadProject = debounce(async (projectId) => {
  if (currentlyLoadingProjectId === projectId) {
    console.log(`[App] Project ${projectId} is already loading.`);
    return;
  }
  currentlyLoadingProjectId = projectId;

  try {
    // Show project details view
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');
    if (projectListView) projectListView.classList.add('hidden');
    if (projectDetailsView) projectDetailsView.classList.remove('hidden');

    // Dispatch projectSelected event
    document.dispatchEvent(new CustomEvent('projectSelected', {
      detail: { projectId }
    }));

    if (window.projectManager?.loadProjectDetails) {
      console.log(`[App] Loading project details: ${projectId}`);
      await window.projectManager.loadProjectDetails(projectId);
    } else if (window.loadProjectDetails) {
      console.log(`[App] Fallback: loadProjectDetails for ${projectId}`);
      await window.loadProjectDetails(projectId);
    } else {
      console.warn(`[App] No function found to load project details for ${projectId}`);
    }
  } catch (error) {
    console.error(`[App] Error loading project ${projectId}:`, error);
  } finally {
    if (currentlyLoadingProjectId === projectId) {
      currentlyLoadingProjectId = null;
    }
  }
}, DEBOUNCE_DELAY);

// Project list items
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

    // Debounced loader
    li.addEventListener('click', () => {
      debouncedLoadProject(projectData.id);
    });

    return li;
  } catch (error) {
    console.error('Error creating project list item:', error);
    return null;
  }
}

// Conversation list
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

// Load conversation list
async function loadConversationList() {
    try {
      if (!await window.auth.isAuthenticated({forceVerify: false})) {
        console.log("[loadConversationList] Not authenticated");
        return [];
      }
      if (API_CONFIG.authCheckInProgress) {
        console.log("[loadConversationList] Auth check in progress, deferring");
        return [];
      }
    } catch (err) {
      console.error("[loadConversationList] Authentication check error:", err);
      return [];  // Return empty array instead of failing
    }

  let projectId = localStorage.getItem("selectedProjectId");

  // If no project is selected, try to select the first available one
  if (!projectId && window.projectManager?.loadProjects) {
    try {
      console.log("[loadConversationList] No project selected, attempting to select first project");
      const projects = await window.projectManager.loadProjects("all");
      if (projects && projects.length > 0) {
        const firstProject = projects[0];
        projectId = firstProject.id;
        localStorage.setItem("selectedProjectId", projectId);
        console.log(`[loadConversationList] Auto-selected project: ${projectId}`);
      } else {
        console.warn("[loadConversationList] No projects found to select");
        renderConversationList({ data: { conversations: [] } });
        return [];
      }
    } catch (err) {
      console.error("[loadConversationList] Error auto-selecting project:", err);
      renderConversationList({ data: { conversations: [] } });
      return [];
    }
  }

  if (!projectId) {
    console.warn("[loadConversationList] No project could be selected, skipping conversation load");
    renderConversationList({ data: { conversations: [] } });
    return [];
  }

  if (!projectId || !isValidUUID(projectId)) {
    console.error('[loadConversationList] Invalid project ID:', projectId);
    renderConversationList({ data: { conversations: [] } });
    return [];
  }

  console.debug('[loadConversationList] Loading conversations for project:', projectId);
  const url = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{project_id}', projectId);
  return apiRequest(url)
    .then(data => {
      renderConversationList(data);
      return data;
    })
    .catch(err => {
      if (err.status === 404) {
        console.warn(`[loadConversationList] Project ${projectId} not found or has no conversations endpoint`);
        // Clear invalid project ID from localStorage
        localStorage.removeItem("selectedProjectId");

        // Try to select a different project
        if (window.projectManager?.loadProjects) {
          console.log("[loadConversationList] Attempting to select a valid project after 404");
          window.projectManager.loadProjects("all")
            .then(projects => {
              if (projects && projects.length > 0) {
                const validProject = projects[0];
                localStorage.setItem("selectedProjectId", validProject.id);
                console.log(`[loadConversationList] Selected alternative project: ${validProject.id}`);
                // Don't recurse immediately as this could cause an infinite loop
                setTimeout(() => loadConversationList(), 500);
              }
            })
            .catch(newErr => console.error("[loadConversationList] Failed to load valid projects:", newErr));
        }
      }

      handleAPIError('loading conversation list', err);
      renderConversationList({ data: { conversations: [] } });
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
  const view = urlParams.get('view');

  if (view === 'projects') {
    console.log('[handleNavigationChange] View=projects detected, showing projects.');

    // Hide chat UI and show project views
    const chatUI = document.getElementById('chatUI');
    const noChatMsg = document.getElementById('noChatSelectedMessage');
    const loginMsg = document.getElementById('loginRequiredMessage');

    if (chatUI) chatUI.classList.add('hidden');
    if (noChatMsg) noChatMsg.classList.add('hidden');
    if (loginMsg) loginMsg.classList.add('hidden');

    // Show project list view instead
      if (window.ProjectDashboard?.showProjectsView) {
        window.ProjectDashboard.showProjectsView();
      } else {
        const listView = document.getElementById('projectListView');
        const detailsView = document.getElementById('projectDetailsView');
        if (listView) {
          listView.classList.remove('hidden');
          listView.style.display = 'flex'; // Ensure display is set to flex
          console.log('[handleNavigationChange] projectListView made visible');
        }
        if (detailsView) detailsView.classList.add('hidden');
      }

    // Make project manager panel visible
    const projectManagerPanel = document.getElementById('projectManagerPanel');
    if (projectManagerPanel) {
      projectManagerPanel.classList.remove('hidden');
      console.log('[handleNavigationChange] projectManagerPanel made visible');
    }

    // Ensure projects are loaded by triggering refresh
    setTimeout(() => {
      if (window.projectListComponent) {
        console.log('[handleNavigationChange] Triggering project list refresh');
        window.projectListComponent.renderProjects({forceRefresh: true});
      } else if (window.projectManager?.loadProjects) {
        console.log('[handleNavigationChange] Using projectManager to load projects');
        window.projectManager.loadProjects('all').catch(err =>
          console.error('[handleNavigationChange] Project loading error:', err)
        );
      }
    }, 100);

    return;
  }

  if (!await ensureAuthenticated()) {
    console.log('[handleNavigationChange] Not authenticated, show login message.');
    const loginMsg = document.getElementById("loginRequiredMessage");
    if (loginMsg) loginMsg.classList.remove("hidden");
    setChatUIVisibility(false);
    return;
  }

  const loginMsg = document.getElementById("loginRequiredMessage");
  if (loginMsg) loginMsg.classList.add("hidden");

  if (chatId) {
    console.log(`[handleNavigationChange] ChatId=${chatId}, loading conversation.`);
    setChatUIVisibility(true);
    window.ChatManager.loadConversation(chatId)
      .catch(err => {
        handleAPIError('loading conversation', err);
        setChatUIVisibility(false);
        window.history.replaceState({}, '', '/');
      });
  } else {
    console.log('[handleNavigationChange] No chatId, showing empty state.');
    setChatUIVisibility(false);
  }
}

// ---------------------------------------------------------------------
// ERROR HANDLING
// ---------------------------------------------------------------------

function handleAPIError(context, error) {
  console.error(`[${context}] API Error:`, error);

  let message = 'An unexpected error occurred';
  if (error.name === 'AbortError' || error.message?.includes('timed out')) {
    message = 'Request timed out. Please retry.';
  } else if (error.status === 401) {
    message = 'Session expired. Please log in again.';
  } else if (error.status === 404) {
    message = 'Resource not found.';
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


// In app.js
async function loadInitialProjects(retryOnFailure = true) {
  try {
    const isAuthenticated = await window.auth.isAuthenticated({forceVerify: false});
    if (!isAuthenticated) {
      console.log("[App] Not authenticated, showing login prompt");
      document.getElementById('loginRequiredMessage')?.classList.remove('hidden');
      return;
    }

    if (window.projectManager?.loadProjects) {
      const projects = await window.projectManager.loadProjects('all');
      console.log(`[App] Loaded ${projects.length} projects`);

      // Ensure project list is rendered
      if (window.projectListComponent?.renderProjects) {
        window.projectListComponent.renderProjects(projects);
      }
    }
  } catch (err) {
    console.error("[App] Error loading initial projects:", err);
    if (retryOnFailure) {
      console.log("[App] Retrying project load after auth verification");
      await window.auth.isAuthenticated({forceVerify: true});
      loadInitialProjects(false);
    }
  }
}

async function loadSidebarProjects() {
  if (!await ensureAuthenticated()) {
    console.log("[loadSidebarProjects] Not authenticated");
    return [];
  }

  try {
    return apiRequest(API_ENDPOINTS.PROJECTS)
      .then(apiResponse => {
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
          console.warn('[loadSidebarProjects] Sidebar project container not found');
          return;
        }

        console.debug('[loadSidebarProjects] Project array length:', projectsArray.length);

        container.innerHTML = '';

        if (projectsArray.length > 0) {
          projectsArray.forEach(project => {
            const li = createProjectListItem(project);
            if (li) container.appendChild(li);
          });
        } else {
          console.warn('[loadSidebarProjects] No projects found, showing empty state.');
          showEmptyState(container, MESSAGES.NO_PROJECTS, 'py-4');
        }

        document.dispatchEvent(new CustomEvent('sidebarProjectsRendered', {
          detail: { count: projectsArray.length }
        }));
        return projectsArray;
      })
      .catch(error => {
        console.error('[loadSidebarProjects] Failed to load sidebar projects:', error);
        document.dispatchEvent(new CustomEvent('sidebarProjectsError', { detail: { error } }));
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
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    const element = document.querySelector(selector);
    if (!element) {
      console.debug(`[cacheElements] Optional element missing for key="${key}": selector="${selector}"`);
    }
    ELEMENTS[key] = element || null;
  });
}

function showModal(type, options = {}) {
  if (window.modalManager && typeof window.modalManager.show === 'function') {
    window.modalManager.show(type, options);
    return true;
  }
  console.error('[showModal] modalManager or show function not available.');
  return false;
}


function setupEventListeners() {
  // Add auth dropdown mobile handling
  const authBtn = document.getElementById('authButton');
  const authDropdown = document.getElementById('authDropdown');

  if (authBtn && authDropdown) {
    authBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();

      // If not authenticated, attempt to show the login modal.
      if (!API_CONFIG.isAuthenticated) {
        if (window.modalManager?.show) {
          console.log('[authBtn] User not authenticated, showing "login" modal.');
          window.modalManager.show('login', {});
        } else {
          console.warn('[authBtn] modalManager not found; fallback to authDropdown');
          const isHidden = authDropdown.classList.contains('hidden');
          authDropdown.classList.toggle("hidden", !isHidden);
          handleAuthModalPositioning();
        }
      } else {
        // If authenticated, toggle dropdown as before
        const isHidden = authDropdown.classList.contains('hidden');
        authDropdown.classList.toggle("hidden", !isHidden);
        handleAuthModalPositioning();
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", e => {
      if (!authDropdown.classList.contains('hidden') &&
          !e.target.closest("#authContainer") &&
          !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
      }
    });

    // Handle touch events on mobile with improved target detection
    document.addEventListener("touchstart", e => {
      if (!authDropdown.classList.contains('hidden') &&
          !e.target.closest("#authContainer") &&
          !e.target.closest("#authDropdown")) {
        authDropdown.classList.add("hidden");
      }
    }, { passive: true });

    // Add window resize handler to reposition dropdown when screen size changes
    window.addEventListener('resize', () => {
      if (!authDropdown.classList.contains('hidden')) {
        handleAuthModalPositioning();
      }
    });
  }

  document.addEventListener('authStateChanged', handleAuthStateChange);
  document.addEventListener('keydown', handleKeyDown);
  // Add listener for project authentication errors
  document.addEventListener('projectAuthError', () => {
    console.log('[App] Received projectAuthError event, showing login UI');
    // Handle auth errors from project manager
    if (window.auth?.handleAuthError) {
      window.auth.handleAuthError(new Error('Session expired or not authenticated'));
    }
    // Show login required message
    const loginMsg = document.getElementById('loginRequiredMessage');
    if (loginMsg) loginMsg.classList.remove('hidden');

    // Hide project details view if visible
    const projectDetailsView = document.getElementById('projectDetailsView');
    if (projectDetailsView) projectDetailsView.classList.add('hidden');
  });

  window.addEventListener('orientationchange', () => {
    window.dispatchEvent(new Event('resize'));
  });
  window.addEventListener('resize', setViewportHeight);

  document.addEventListener('click', (event) => {
    if (event.target.closest('#newConversationBtn')) {
      handleNewConversationClick();
    }

    if (event.target.closest('#createProjectBtn')) {
      showModal('project', {
        updateContent: (modalEl) => {
          const form = modalEl.querySelector('form');
          if (form) form.reset();
          const projectIdInput = modalEl.querySelector('#projectId');
          if (projectIdInput) projectIdInput.value = '';
          const title = modalEl.querySelector('.modal-title, h3');
          if (title) title.textContent = 'Create New Project';
        }
      });
    }

    if (event.target.closest('#backToProjectsBtn')) {
      if (window.ProjectDashboard?.showProjectsView) {
        window.ProjectDashboard.showProjectsView();
      } else if (typeof window.showProjectsView === 'function') {
        window.showProjectsView();
      } else {
        const listView = document.getElementById('projectListView');
        const detailsView = document.getElementById('projectDetailsView');
        if (listView) listView.classList.remove('hidden');
        if (detailsView) detailsView.classList.add('hidden');
      }
    }

    if (event.target.closest('#editProjectBtn')) {
      const currentProject = window.projectManager?.currentProject();
      if (currentProject) {
        showModal('project', {
          updateContent: (modalEl) => {
            const form = modalEl.querySelector('form');
            if (form) {
              form.querySelector('#projectId').value = currentProject.id;
              form.querySelector('#projectName').value = currentProject.name;
              form.querySelector('#projectDescription').value = currentProject.description || '';
              const title = modalEl.querySelector('.modal-title, h3');
              if (title) title.textContent = `Edit Project: ${currentProject.name}`;
            }
          }
        });
      }
    }

    if (event.target.closest('#pinProjectBtn')) {
      const currentProject = window.projectManager?.currentProject();
      if (currentProject?.id && window.projectManager?.togglePinProject) {
        window.projectManager.togglePinProject(currentProject.id)
          .then(updatedProject => {
            window.showNotification?.('Project ' + (updatedProject.pinned ? 'pinned' : 'unpinned'), 'success');
            window.loadProjectDetails?.(currentProject.id);
            window.loadSidebarProjects?.();
          })
          .catch(err => {
            console.error('Error toggling pin:', err);
            window.showNotification?.('Failed to update pin status', 'error');
          });
      }
    }

    if (event.target.closest('#archiveProjectBtn')) {
      const currentProject = window.projectManager?.currentProject();
      if (currentProject && window.ModalManager?.confirmAction) {
        window.ModalManager.confirmAction({
          title: 'Confirm Archive',
          message: `Are you sure you want to ${currentProject.archived ? 'unarchive' : 'archive'} this project?`,
          confirmText: currentProject.archived ? 'Unarchive' : 'Archive',
          confirmClass: currentProject.archived ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700',
          onConfirm: () => {
            window.projectManager.toggleArchiveProject(currentProject.id)
              .then(updatedProject => {
                window.showNotification?.(`Project ${updatedProject.archived ? 'archived' : 'unarchived'}`, 'success');
                if (window.ProjectDashboard?.showProjectsView) window.ProjectDashboard.showProjectsView();
                window.loadSidebarProjects?.();
                window.loadProjects?.();
              })
              .catch(err => {
                console.error('Error toggling archive:', err);
                window.showNotification?.('Failed to update archive status', 'error');
              });
          }
        });
      }
    }

    if (event.target.closest('#minimizeChatBtn')) {
      const chatContainer = document.getElementById('projectChatContainer');
      if (chatContainer) {
        chatContainer.classList.toggle('hidden');
      }
    }
  });

  setupNavigationTracking();
  console.log("[setupEventListeners] Registered all event listeners");
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

function handleAppUpdateAuthUI(authenticated, username = null) {
  if (window.auth && typeof window.auth.updateAuthUI === 'function') {
    window.auth.updateAuthUI(authenticated, username);
  }
}

let lastKnownAuthState = null;
function handleAuthStateChange(e) {
  const { authenticated, username } = e.detail;
  const stateChanged = authenticated !== lastKnownAuthState;
  lastKnownAuthState = authenticated;

  const authStatus = ELEMENTS.AUTH_STATUS || getElement(SELECTORS.AUTH_STATUS);
  if (authStatus) {
    authStatus.textContent = authenticated ? (username || 'Authenticated') : 'Not Authenticated';
    authStatus.classList.toggle('text-green-600', authenticated);
    authStatus.classList.toggle('text-red-600', !authenticated);
  }

  handleAppUpdateAuthUI(authenticated, username);
  API_CONFIG.isAuthenticated = authenticated;

    if (authenticated) {
      if (stateChanged) {
        console.log("[AuthStateChange] User authenticated, loading initial data...");

        // Make sure project list view is visible
        const projectListView = document.getElementById('projectListView');
        if (projectListView) {
          projectListView.classList.remove('hidden');
          console.log("[AuthStateChange] Made project list view visible");

          // Ensure login message is hidden
          const loginRequiredMessage = document.getElementById('loginRequiredMessage');
          if (loginRequiredMessage) {
            loginRequiredMessage.classList.add('hidden');
            console.log("[AuthStateChange] Hidden login required message");
          }
        }

        // Make project manager panel visible
        const projectManagerPanel = document.getElementById('projectManagerPanel');
        if (projectManagerPanel && projectManagerPanel.classList.contains('hidden')) {
          projectManagerPanel.classList.remove('hidden');
          console.log("[AuthStateChange] Made project manager panel visible");
        }

        // Force view=projects if we're on the homepage
        if (!window.location.search) {
          window.history.pushState({}, '', '/?view=projects');
          console.log("[AuthStateChange] Redirected to projects view");
        }

        // Use our new robust project loading sequence
        loadInitialProjects().catch(err => {
          console.error("[AuthStateChange] Error loading initial projects:", err);
        });

        // Still load other components as before
        loadConversationList().catch(err => console.warn("Failed to load conversations:", err));
        loadSidebarProjects().catch(err => console.warn("Failed to load sidebar projects:", err));

        // Check chatId once
        const urlParams = new URLSearchParams(window.location.search);
        const chatId = urlParams.get('chatId');
        if (chatId && typeof window.loadConversation === 'function') {
          window.loadConversation(chatId).catch(err => {
            console.warn("Failed to load conversation:", err);
          });
        }
      } else {
        console.log("[AuthStateChange] Already authenticated, forcing UI refresh anyway.");
        loadInitialProjects().catch(err => {
          console.error("[AuthStateChange] Error forcing initial projects:", err);
        });
        loadConversationList().catch(err => console.warn("Failed forcing conversation load:", err));
        loadSidebarProjects().catch(err => console.warn("Failed forcing sidebar load:", err));
      }
  } else {
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

    const projectDetailsView = document.getElementById('projectDetailsView');
    if (projectDetailsView) projectDetailsView.classList.add('hidden');
    const projectListView = document.getElementById('projectListView');
    if (projectListView) projectListView.classList.remove('hidden');

    console.log("[AuthStateChange] User logged out, UI cleared.");
  }
}

function handleNewConversationClick() {
  ensureAuthenticated().then(isAuth => {
    if (!isAuth) {
      window.showNotification?.("Please log in to create a conversation", "error");
      return;
    }
    if (window.projectManager?.createConversation) {
      window.projectManager.createConversation(null)
        .then(newConversation => {
          window.location.href = '/?chatId=' + newConversation.id;
        })
        .catch(err => {
          handleAPIError('creating conversation', err);
        });
    } else {
      Notifications.apiError('No project manager or conversation creation method found');
    }
  });
}

function setupNavigationTracking() {
  function recordInteraction() {
    sessionStorage.setItem('last_page_interaction', Date.now().toString());
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('a[href*="project"]') ||
      e.target.closest('button[data-action*="project"]') ||
      e.target.closest('#manageDashboardBtn') ||
      e.target.closest('#projectsNav')) {
      recordInteraction();
    }
  });
  window.addEventListener('beforeunload', recordInteraction);
  recordInteraction();
}

// Central Initialization

// Global debug flag - set this based on your environment
window.DEBUG_MODE = window.DEBUG_MODE || false;

async function initializeApplication() {
  setPhase(AppPhase.BOOT);

  // Check for missing debug auth file
  if (DEBUG_MODE && typeof window.loadDebugAuth === 'undefined') {
    console.warn('login-debug.js not found - debug auth features disabled');
  }

  // Wait for DOM readiness
  if (document.readyState !== 'loading') {
    // Already ready
  } else {
    await new Promise((resolve) => {
      document.addEventListener('DOMContentLoaded', resolve);
    });
  }
  setPhase(AppPhase.DOM_READY);

  setViewportHeight();
  cacheElements();
  setupEventListeners();

  // Initialize auth if available
  if (window.auth?.init) {
    console.log("[initializeApplication] Initializing auth module...");
    await window.auth.init();
    console.log("[initializeApplication] Auth init complete");
  } else {
    console.warn("[initializeApplication] Auth module not available");
  }

  setPhase(AppPhase.AUTH_CHECKED);

  console.log("[initializeApplication] Completed base app initialization");
  return true;
}

async function initializeAllModules() {
  try {
    console.log("[initializeAllModules] Starting full initialization");
    await initializeApplication();

    // Initialize project manager if available
    if (window.projectManager?.initialize) {
      await window.projectManager.initialize();
      console.log("[initializeAllModules] projectManager initialized");
    }

    // Initialize sidebar if available
    if (window.sidebar?.initialize) {
      window.sidebar.initialize();
      console.log("[initializeAllModules] sidebar initialized");
    }

    // Handle initial navigation
    await handleNavigationChange();

    // --- NEW: Explicitly initialize main chat if needed ---
    const urlParams = new URLSearchParams(window.location.search);
    const view = urlParams.get('view');
    const chatId = urlParams.get('chatId');

    // Only initialize main chat if we are authenticated AND not in project view AND no specific chat is loaded yet
    if (API_CONFIG.isAuthenticated && view !== 'projects' && !chatId) {
        console.log("[initializeAllModules] Initializing main ChatManager as view is not projects and no chatId is present.");
        if (window.ChatManager?.initializeChat) {
            try {
                await window.ChatManager.initializeChat(); // Initialize the main chat interface
                console.log("[initializeAllModules] Main ChatManager initialized.");
            } catch (chatInitError) {
                console.error("[initializeAllModules] Failed to initialize main ChatManager:", chatInitError);
                // Optionally show an error to the user
            }
        } else {
            console.warn("[initializeAllModules] ChatManager.initializeChat not found.");
        }
    } else {
         console.log("[initializeAllModules] Skipping main ChatManager initialization (view:", view, "chatId:", chatId, "auth:", API_CONFIG.isAuthenticated, ")");
    }
    // --- END NEW ---

    setPhase(AppPhase.COMPLETE);
    console.log("[initializeAllModules] All modules initialized successfully");
    return true;
  } catch (error) {
    console.error("[initializeAllModules] Initialization error:", error);
    return false;
  }
}

function safeInitialize() {
  const projectSearch = ELEMENTS.SIDEBAR_PROJECT_SEARCH;
  if (projectSearch) {
    projectSearch.addEventListener('input', (e) => {
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
      console.log('[safeInitialize] Sidebar New Project button clicked');
      showModal('project', {});
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

// Exports
window.API_CONFIG = API_CONFIG;
window.SELECTORS = SELECTORS;
window.apiRequest = apiRequest;
window.getBaseUrl = getBaseUrl;
window.ensureAuthenticated = ensureAuthenticated;
window.loadConversationList = loadConversationList;
window.loadSidebarProjects = loadSidebarProjects;
window.isValidUUID = isValidUUID;

// Central Initialization Controller
window.appInitializer = {
  status: 'pending',
  queue: [],

  register: (component) => {
    if (window.appInitializer.status === 'ready') {
      component.init();
    } else {
      window.appInitializer.queue.push(component);
    }
  },

  initialize: async () => {
    try {
      console.log("[appInitializer] Starting centralized initialization");
      await initializeAllModules();
      window.appInitializer.status = 'ready';
      window.appInitializer.queue.forEach(c => c.init());
      console.log("[appInitializer] Application fully initialized");
    } catch (error) {
      console.error("[appInitializer] Initialization error:", error);
      alert("Failed to initialize. Please refresh the page.");
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.appInitializer.initialize().catch(error => {
    console.error("[DOMContentLoaded] App init error:", error);
    alert("Failed to initialize. Please refresh the page.");
  });

  // Additional setup tasks
  console.log('[app.js] Dispatching appJsReady event');
  document.dispatchEvent(new CustomEvent('appJsReady'));
});

// Listen for 'authReady' event so we can handle pre-verified sessions
document.addEventListener('authReady', (evt) => {
  if (evt.detail.authenticated) {
    console.log("[app.js] 'authReady' => user is authenticated. Forcing initial load of projects and conversation list.");
    loadInitialProjects().catch(err => {
      console.error("[app.js] Error in forced loadInitialProjects after authReady:", err);
    });
    loadConversationList().catch(err => {
      console.error("[app.js] Error in forced loadConversationList after authReady:", err);
    });
  } else {
    console.log("[app.js] 'authReady' => user not authenticated. Display login message if needed.");
    const loginMsg = document.getElementById('loginRequiredMessage');
    if (loginMsg) loginMsg.classList.remove('hidden');
  }
});

document.addEventListener('projectSelected', (event) => {
  const projectId = event.detail.projectId;
  console.log('[app.js] projectSelected event received for project:', projectId);

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
    projectDetailsView.scrollTop = 0;
  } else {
    console.warn('[app.js] projectDetailsView not found');
  }
});

document.addEventListener('showProjectList', () => {
  console.log('[app.js] showProjectList event received');
  const projectListView = document.getElementById('projectListView');
  const projectDetailsView = document.getElementById('projectDetailsView');
  if (projectListView) projectListView.classList.remove('hidden');
  if (projectDetailsView) projectDetailsView.classList.add('hidden');
  window.history.pushState({}, '', '/?view=projects');
});
