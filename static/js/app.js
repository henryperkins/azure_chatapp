/**
 * app.js - Cookie-based auth only, no CORS/origin usage.
 * Maintains API_CONFIG, uses fetch wrapper, manages UI via auth state.
 * Relies on auth.js for session cookies and integrates with chat system modules.
 */

// Re‑export debounce from the central eventHandlers utility
const debounce = window.eventHandlers?.debounce ?? ((fn) => fn);   // should never hit fallback

// PHASE-BASED INITIALIZATION
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
}

// GLOBAL APP CONFIG & CONSTANTS
window.__appStartTime = Date.now();
window.__appInitializing = true;
const DEBUG = false;
function log(...args) { if (DEBUG) console.log(...args); }

// Timeout configuration (in milliseconds)
const TIMEOUT_CONFIG = {
  INITIALIZATION: 30000, // 30s for full app initialization
  AUTH_CHECK: 10000,    // 10s for auth verification
  API_REQUEST: 10000,   // 10s for API requests
  COMPONENT_LOAD: 15000, // 15s for component loading
  CHAT_MANAGER: 20000,  // 20s for chat manager initialization
  DOM_READY: 5000       // 5s for DOM ready check
};

const API_CONFIG = {
  _baseUrl: '',
  get baseUrl() { return this._baseUrl; },
  set baseUrl(value) {
    if (value !== this._baseUrl) {
      if (value && value.includes('put.photo')) {
        console.error('Prevented setting incorrect domain (put.photo) as API baseUrl');
        return;
      }
      this._baseUrl = value;
    }
  },
  isAuthenticated: false,
  authCheckInProgress: false,
  lastErrorStatus: null,
  authCheckLock: false // Global auth check coordination
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
  CHAT_UI: '#globalChatUI',
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
  PROJECT_NOT_FOUND: 'Selected project not found or inaccessible.'
};

const API_ENDPOINTS = {
  AUTH_VERIFY: '/api/auth/verify/',
  PROJECTS: '/api/projects/',
  PROJECT_DETAILS: '/api/projects/{projectId}/',
  PROJECT_CONVERSATIONS: '/api/projects/{project_id}/conversations',
  PROJECT_FILES: '/api/projects/{projectId}/files/'
};

const ELEMENTS = {};

// CUSTOM ERROR CLASSES
class APIError extends Error {
  constructor(message, { status, code, isPermanent } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.isPermanent = !!isPermanent;
  }
}

// UTILITY FUNCTIONS
function toggleVisibility(el, show) { el?.classList.toggle('hidden', !show); }
function getEl(key) { return ELEMENTS[key] || (ELEMENTS[key] = document.querySelector(SELECTORS[key])); }
function getRequiredElement(selector) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Required element not found: ${selector}`);
  return el;
}
function setViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
function isValidUUID(uuid) {
  return window.ChatUtils.isValidUUID(uuid);
}

// --- Authentication helpers now delegate *only* to auth.js -----------------
const clearAuthState       = () => window.auth?.clear?.();
const ensureAuthenticated  = (opts = {}) => window.auth.isAuthenticated(opts);

// API REQUEST FUNCTIONS
const pendingRequests = new Map();
function sanitizeUrl(url) {
  return url.replace(/\s+/g, '').replace(/\/+/g, '/');
}

async function apiRequest(endpoint, method = 'GET', data = null, options = {}) {
  const requestKey = `${method}:${endpoint}:${JSON.stringify(data)}`;
  if (pendingRequests.has(requestKey)) {
    log(`[apiRequest] Deduplicating request: ${requestKey}`);
    return pendingRequests.get(requestKey);
  }
  const controller = options.signal?.controller || new AbortController();
  const timeoutMs = options.timeout || TIMEOUT_CONFIG.API_REQUEST;
  const timeoutId = options.signal ? null : setTimeout(() => {
    log(`[apiRequest] Aborting request after ${timeoutMs}ms timeout: ${endpoint}`);
    controller.abort();
  }, timeoutMs);
  const requestPromise = (async () => {
    try {
      endpoint = sanitizeUrl(endpoint);
      if (endpoint.startsWith('https://') || endpoint.startsWith('http://')) {
        const urlObj = new URL(endpoint);
        if (urlObj.hostname.includes('put.photo')) throw new Error('Prohibited domain detected in URL');
        endpoint = urlObj.pathname + urlObj.search;
      }
      const cleanEndpoint = endpoint.replace(/^https?:\/\/[^/]+/, '').replace(/\/+/g, '/');
      const baseUrl = getBaseUrl();
      const uppercaseMethod = method.toUpperCase();
      let finalUrl = cleanEndpoint.startsWith('/')
        ? `${baseUrl}${cleanEndpoint}`
        : `${baseUrl}/${cleanEndpoint}`;
      if (data && ['GET', 'HEAD'].includes(uppercaseMethod)) {
        const queryParams = new URLSearchParams();
        Object.entries(data).forEach(([key, value]) => {
          if (Array.isArray(value)) value.forEach(v => queryParams.append(key, v));
          else queryParams.append(key, value);
        });
        finalUrl += (cleanEndpoint.includes('?') ? '&' : '?') + queryParams.toString();
      }
      const csrfToken = await window.auth.getCSRFTokenAsync();
      const requestOptions = {
        method: uppercaseMethod,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'X-Forwarded-Host': window.location.host,
          'X-Request-Domain': window.location.hostname
        },
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal
      };
      if (data && !['GET', 'HEAD', 'DELETE'].includes(uppercaseMethod)) {
        //
        // Define a list of auth endpoints that should NOT receive Authorization headers
        const authEndpoints = [
          '/api/auth/login',
          '/api/auth/register',
          '/api/auth/refresh',
          '/api/auth/logout',
          '/api/auth/csrf',
          '/api/auth/verify'
        ];
        const isAuthEndpoint = authEndpoints.some(authPath =>
          cleanEndpoint.startsWith(authPath) || finalUrl.includes(authPath)
        );

        // Only add Authorization header if auth is initialized AND it's not an auth endpoint
        if (window.auth?.isInitialized && !isAuthEndpoint) {
          try {
            const token = window.auth.getAuthToken(); // synchronous, returns string
            if (token) {
              requestOptions.headers['Authorization'] = 'Bearer ' + token;
            } else {
              log('[apiRequest] No auth token available for request.');
            }
          } catch (err) {
            console.error('[apiRequest] Error retrieving auth token:', err);
          }
        }

        // Prepare the request body
        requestOptions.body = data instanceof FormData ? data : JSON.stringify(data);
        if (!(data instanceof FormData)) {
          requestOptions.headers['Content-Type'] = 'application/json';
        }
      }
      const response = await fetch(finalUrl, requestOptions);
      if (!response.ok) {
        const error = await parseErrorResponse(response, finalUrl);

        // Special handling for 401 errors
        if (error.status === 401) {
          // Check if we should throttle retries
          if (!window.__last401Time || Date.now() - window.__last401Time > 30000) {
            window.__last401Time = Date.now();
            throw error;
          } else {
            // If we're in cooldown period, throw a different error
            throw new APIError('Authentication required (retry throttled)', {
              status: 401,
              code: 'E401_THROTTLED',
              isPermanent: false
            });
          }
        }

        // For non-401 errors, ensure auth state is cleared if needed
        if (error.status === 403) {
          if (window.auth?.clear) window.auth.clear();
        }

        throw error;
      }
      if (response.status === 204) return null;
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestKey);
    }
  })();
  pendingRequests.set(requestKey, requestPromise);
  return requestPromise;
}

async function parseErrorResponse(response) { // Removed finalUrl param as it's not used
  const status = response.status;
  let errData;
  try {
    errData = await response.json();
  } catch {
    const text = await response.text().catch(() => response.statusText);
    return new APIError(`API error (${status}): ${text || response.statusText}`, { status, code: `E${status}` });
  }

  const message = errData.message || errData.error || response.statusText || `HTTP ${status}`;
  // Do NOT handle 401/403 side effects here. Let handleError in apiRequest do it.
  return new APIError(`API error (${status}): ${message}`, {
    status,
    code: `E${status}`,
    isPermanent: status === 404,
    detail: errData.detail // Include detail if available
  });
}

function getBaseUrl() {
  if (API_CONFIG.baseUrl && API_CONFIG.baseUrl.includes('put.photo')) {
    console.warn('Detected incorrect API domain (put.photo). Resetting to relative paths.');
    API_CONFIG.baseUrl = '';
  }
  if (!API_CONFIG.baseUrl) API_CONFIG.baseUrl = '';
  return API_CONFIG.baseUrl;
}

// DATA LOADING & RENDERING
let currentlyLoadingProjectId = null;
const DEBOUNCE_DELAY = 300;
const debouncedLoadProject = debounce(async (projectId) => {
  if (currentlyLoadingProjectId === projectId) return;
  currentlyLoadingProjectId = projectId;
  try {
    if (window.ProjectDashboard?.showProjectDetails) {
      await window.ProjectDashboard.showProjectDetails(projectId);
    } else if (window.projectManager?.loadProjectDetails) {
      await window.projectManager.loadProjectDetails(projectId);
    } else {
      console.warn(`[App] No function found to load project details for ${projectId}`);
    }
  } catch (error) {
    console.error(`[App] Error loading project ${projectId}:`, error);
    // ChatUtils.handleError already handles 401/notifications
    window.ChatUtils.handleError('Loading project', error);
  } finally {
    if (currentlyLoadingProjectId === projectId) currentlyLoadingProjectId = null;
  }
}, DEBOUNCE_DELAY);

async function loadConversationList() {
  // rely on apiRequest's auth check and handleError for notifications
  if (API_CONFIG.authCheckInProgress) {
    log("[loadConversationList] Auth check in progress, deferring");
    return [];
  }
  let projectId = window.ChatUtils.getProjectId();
  if (!projectId && window.projectManager?.loadProjects) {
    try {
      // projectManager.loadProjects will emit events handled by UI
      const projects = await window.projectManager.loadProjects("all");
      if (projects && projects.length > 0) {
        projectId = projects[0].id;
        localStorage.setItem("selectedProjectId", projectId);
        log(`[loadConversationList] Auto-selected project: ${projectId}`);
      } else {
        // If no projects found, render empty conversations state
        if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
        return [];
      }
    } catch (err) {
      console.error("[loadConversationList] Error auto-selecting project:", err);
      // ChatUtils.handleError called by projectManager.loadProjects
      if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
      return [];
    }
  }
  if (!projectId || !isValidUUID(projectId)) {
    console.error('[loadConversationList] Invalid project ID:', projectId);
    if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
    return [];
  }
  const url = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{project_id}', projectId);
  try {
    const data = await apiRequest(url);
    if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations(data);
    return data;
  } catch (err) {
    // ChatUtils.handleError is called by apiRequest now
    if (err.status === 404) {
      console.warn(`[loadConversationList] Project ${projectId} not found`);
      localStorage.removeItem("selectedProjectId");
      // Trigger project list reload, which should handle finding a new project
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects("all").then(projects => {
          if (projects && projects.length > 0) {
            localStorage.setItem("selectedProjectId", projects[0].id);
            // Slight delay to allow UI update before reloading conversations
            setTimeout(() => loadConversationList(), 500);
          } else {
            // If no projects after refresh, ensure empty state is shown
            if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
          }
        }).catch(newErr => {
          console.error("[loadConversationList] Failed to load valid projects after 404:", newErr);
           if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
        });
      } else {
         // Fallback if projectManager not available
         if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
      }
    }
    // Error handled by apiRequest -> ChatUtils.handleError
    return [];
  }
}

async function loadProjects() {
  try {
    // ensureAuthenticated will show login prompt if needed
    const isAuthenticated = await ensureAuthenticated();
    if (!isAuthenticated) {
      log("[App] Not authenticated, ensure login prompt is visible");
      toggleVisibility(document.getElementById('loginRequiredMessage'), true);
      toggleVisibility(document.getElementById('projectManagerPanel'), false);
      toggleVisibility(document.getElementById('projectListView'), false); // Hide project list container
      // projectListComponent will handle rendering empty state or login message if needed
      if (window.projectListComponent?.renderProjects) {
         window.projectListComponent.renderProjects([]); // Clear list
      }
      return;
    }

    // Hide login message, show project container when authenticated
    toggleVisibility(document.getElementById('loginRequiredMessage'), false);
    toggleVisibility(document.getElementById('projectManagerPanel'), true);
    toggleVisibility(document.getElementById('projectListView'), true);

    // Ensure components are initialized (handled by appInitializer/initApp)
    // await ensureComponentsInitialized(); // This is called by initApp

    // Load projects through projectManager (errors handled by projectManager -> ChatUtils)
    if (window.projectManager?.loadProjects) {
      log("[App] Loading projects through projectManager...");
      const params = new URLSearchParams(window.location.search);
      const filter = params.get('filter') || 'all';
      // projectManager.loadProjects will emit events for rendering and error handling
      await window.projectManager.loadProjects(filter);
      log("[App] projectManager.loadProjects call completed (events dispatched)");

      // The projectListComponent will handle rendering based on events.
      // No need to manually render here or check project count for empty state.
    } else {
      console.warn("[App] projectManager not available to load projects.");
       // Manually render empty state if projectManager is missing
       if (window.projectListComponent?.renderProjects) {
         window.projectListComponent.renderProjects([]);
       }
    }
  } catch (err) {
    console.error("[App] Error in loadProjects wrapper:", err);
    // This catch might only be hit for errors originating *outside* projectManager.loadProjects
    // Errors from projectManager.loadProjects are handled internally and emit events.
    // If this is a critical error, ChatUtils.handleError is the final destination.
    window.ChatUtils.handleError('Loading projects (App wrapper)', err);
  } finally {
    // Clear loading flag is handled by projectManager.loadProjects finally block
    // window.__projectLoadingInProgress = false; // Should be handled by projectManager
  }
}


// NAVIGATION & STATE
async function navigateToConversation(conversationId) {
  window.history.pushState({}, '', `/?chatId=${conversationId}`);

  try {
    // Check if a project is selected before proceeding
    const projectId = window.ChatUtils.getProjectId();
    if (!projectId) {
      console.warn("No project selected, cannot navigate to conversation without project context.");
      // Use standardized notification
      window.showNotification("Please select a project first", "error");
      // Redirect to project selection
      window.history.pushState({}, '', '/?view=projects');
      toggleVisibility(getEl('CHAT_UI'), false);
      toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
      return false;
    }

    // Ensure ChatManager is available
    // ensureChatManagerAvailable handles script loading and timeouts internally,
    // and calls ChatUtils.handleError for its own failures.
    await ensureChatManagerAvailable();


    // ChatManager.loadConversation will internally use ConversationService which
    // uses apiRequest, which in turn calls ChatUtils.handleError for notifications.
    if (window.ChatManager?.loadConversation) {
      // Delegate UI visibility to ChatInterface after initialization
      // chatInterface.loadConversation should handle UI visibility updates
      return await window.ChatManager.loadConversation(conversationId);
    } else {
      throw new Error('ChatManager not properly initialized for loadConversation');
    }
  } catch (error) {
    console.error('Error navigating to conversation:', error);
    // ChatUtils.handleError called by ensureChatManagerAvailable or ChatManager.loadConversation
    // Ensure fallback UI state if navigation fails
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
    throw error;
  }
}

// Helper function to ensure ChatManager is available - Updated for robustness
async function ensureChatManagerAvailable() {
  if (!window.ChatManager) {
    console.log('Waiting for ChatManager to become available...');

    // Rely on chat-core.js loading itself or being loaded by appInitializer.
    // If it's still not available, log a warning but don't try to load it here.
    // appInitializer should handle critical script loading.

    // Wait for ChatManager to be defined with a timeout and event listener
    return new Promise((resolve, reject) => {
      if (window.ChatManager) {
        console.log('ChatManager is already available.');
        resolve();
        return;
      }

      // Wait for the specific 'chatManagerReady' event
      const handleReady = () => {
        console.log('ChatManager is now available via chatManagerReady event');
        resolve();
      };
      document.addEventListener('chatManagerReady', handleReady, { once: true });


      // Timeout in case event never fires
      const timeout = setTimeout(() => {
        const errMsg = `ChatManager initialization timed out after ${TIMEOUT_CONFIG.CHAT_MANAGER}ms. Check chat-core.js loading.`;
        log(errMsg);
        // Clean up the event listener if timeout occurs
        document.removeEventListener('chatManagerReady', handleReady);
        // Use ChatUtils.handleError for this critical timeout
        window.ChatUtils.handleError('Waiting for ChatManager', new Error(errMsg));
        reject(new Error(errMsg));
      }, TIMEOUT_CONFIG.CHAT_MANAGER);

       // Also check periodically in case the event fired before the listener was added
       const checkInterval = setInterval(() => {
         if (window.ChatManager) {
           clearInterval(checkInterval);
           clearTimeout(timeout);
           document.removeEventListener('chatManagerReady', handleReady);
           console.log('ChatManager found via interval check.');
           resolve();
         }
       }, 100);
    });
  }
  console.log('ChatManager is already available.');
  return Promise.resolve();
}

// Removed loadScript function as dynamic script loading should be centralized in appInitializer/chat-core
/*
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
*/

async function handleNavigationChange() {
  try {
    // Check app initialization status
    if (window.__appInitializing) {
      console.log("App still initializing, waiting before handling navigation...");
      // Wait for the appInitializer status to change from 'initializing'
      await new Promise(resolve => {
        const checkStatus = setInterval(() => {
          if (window.appInitializer?.status !== 'initializing') {
            clearInterval(checkStatus);
            resolve();
          }
        }, 100);
        // Add a timeout just in case the status never changes
        setTimeout(() => {
          clearInterval(checkStatus);
          const warnMsg = `Timeout waiting for app initialization flag during navigation (${TIMEOUT_CONFIG.INITIALIZATION}ms)`;
          log(warnMsg);
          resolve(); // Resolve anyway to prevent blocking
        }, TIMEOUT_CONFIG.INITIALIZATION);
      });
      console.log("App initialization status allows navigation handling.");
    }


    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const view = urlParams.get('view');
    const projectId = urlParams.get('project');

    // Get references to the main views
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');

    // Authenticated check should happen before view logic
    // ensureAuthenticated relies on AuthBus and will handle redirects/notifications
    const isAuthenticated = await ensureAuthenticated();
     if (!isAuthenticated) {
      log('[handleNavigationChange] Not authenticated, showing login message via ensureAuthenticated side effect.');
      // ensureAuthenticated should have handled showing the login message.
      // Explicitly hide chat UI and show no chat message if needed
      toggleVisibility(getEl('CHAT_UI'), false);
      toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
      return; // Stop processing if not authenticated
    }

    // User is authenticated, hide login message
    toggleVisibility(document.getElementById("loginRequiredMessage"), false);

    if (view === 'projects') {
      log('[handleNavigationChange] View=projects detected, showing projects list.');
      // showProjectListView already handles toggling list/details visibility
      showProjectListView();
      // loadProjects is called by showProjectListView if needed
      return;
    }
    if (projectId) {
      log(`[handleNavigationChange] Project ID=${projectId}, loading project details.`);
      // This will trigger the project dashboard component to load details
      debouncedLoadProject(projectId); // debouncedLoadProject handles view toggle and loading
      return;
    }
    if (chatId) {
      log(`[handleNavigationChange] ChatId=${chatId}, loading conversation.`);
       // navigateToConversation handles ensuring ChatManager and loading the conversation
      await navigateToConversation(chatId);
      return;
    }

    // Default state: No view, no project, no chat specified.
    // Show the project list view as the default landing page for authenticated users.
    log('[handleNavigationChange] No specific view, project, or chatId specified. Showing project list.');
    showProjectListView(); // Default to showing the project list
    // Ensure chat UI is hidden in this state
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);


  } catch (error) {
    console.error('Navigation error:', error);
    // ChatUtils.handleError called by debouncedLoadProject or navigateToConversation
    // If an error prevents even showing the project list, show a general error
     window.ChatUtils.handleError('Navigation change', error);
  }
}

// Define a global flag to track if showProjectListView is in progress
// let _showingProjectListView = false; // Already declared globally

async function showProjectListView() {
  // This function is called by handleNavigationChange and eventHandler.js
  // It primarily ensures the #projectListView container is visible and triggers project loading.
  // The logic inside is fine, relies on ensureAuthenticated and loadProjects.
  // Errors within loadProjects are handled by projectManager -> ChatUtils.
  // The _showingProjectListView flag helps prevent redundant calls.

  if (_showingProjectListView) {
    console.log("[App] showProjectListView already in progress, skipping...");
    return;
  }
  _showingProjectListView = true;

  try {
    // ensureAuthenticated will show login prompt if needed
    const isAuthenticated = await ensureAuthenticated();
    if (!isAuthenticated) {
      log("[showProjectListView] Not authenticated, ensure login prompt is visible");
      // ensureAuthenticated should handle showing the login message.
      // Hide project list container
      toggleVisibility(document.getElementById('projectManagerPanel'), false);
      toggleVisibility(document.getElementById('projectListView'), false);
      // Clear project list UI if needed
      if (window.projectListComponent?.renderProjects) {
         window.projectListComponent.renderProjects([]);
      }
      return; // Stop if not authenticated
    }

    // User is authenticated, show project container
    const projectPanel = document.getElementById('projectManagerPanel');
    if (projectPanel) {
      projectPanel.classList.remove('hidden');
      log("[showProjectListView] Showing project panel");
    }
    const projectListViewEl = document.getElementById('projectListView');
    if (projectListViewEl) {
        projectListViewEl.classList.remove('hidden');
        projectListViewEl.style.display = 'flex'; // Ensure it's not 'none'
    }


    // Ensure project details view is hidden when showing list view
    const projectDetailsView = document.getElementById('projectDetailsView');
     if (projectDetailsView) {
        projectDetailsView.classList.add('hidden');
     }


    // Load projects through projectManager (errors handled internally)
    if (window.projectManager?.loadProjects) {
       log("[showProjectListView] Loading projects...");
       // projectManager.loadProjects dispatches events for rendering
       await window.projectManager.loadProjects('all');
       log("[showProjectListView] projectManager.loadProjects call completed.");
    } else {
       console.warn("[showProjectListView] projectManager not available to load projects.");
        // Manually render empty state if projectManager is missing
        if (window.projectListComponent?.renderProjects) {
          window.projectListComponent.renderProjects([]);
        }
    }
  } catch (error) {
    console.error("[showProjectListView] Error:", error);
    // ChatUtils.handleError called by ensureAuthenticated or loadProjects (via projectManager)
     window.ChatUtils.handleError('Showing project list view', error);
  } finally {
    _showingProjectListView = false;
  }
}

// INITIALIZATION
function cacheElements() {
  // This function is fine, just caches elements.
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    const element = document.querySelector(selector);
    ELEMENTS[key] = element || null;
  });
}

// Track app listeners for cleanup
// const appListeners = new Set(); // Already declared globally

/**
 * Removed local setupEventListeners in favor of the centralized eventHandler approach.
 * We rely on 'window.eventHandlers.init()' to manage global listeners.
 * This function is called by initApp.
 */
function setupEventListeners() {
   // This function should ideally register app-level listeners using eventHandler.js
   // but it seems to be relying on eventHandler.js.init() being called elsewhere.
   // Let's assume eventHandler.js.init() is called and handles global listeners.
   // If there are any app-specific listeners *not* covered by eventHandler.js,
   // they should be added here using eventHandler.js.trackListener.

   // Currently, this function seems empty/stubbed after previous refactoring.
   // We can keep it as a placeholder or remove if not needed.
   // Based on eventHandler.js, global listeners are set up there, not here.
   // So, this function can likely be removed.
   console.log("[app.js] setupEventListeners (stub)");
}


function cleanupAppListeners() {
   // This function is also likely redundant if eventHandler.js manages all listeners.
   // If any listeners are still managed locally using appListeners, this should
   // use eventHandler.js.cleanupListeners or ensure those listeners are also
   // tracked by eventHandler.js.
    console.log("[app.js] cleanupAppListeners (stub)");
   /*
    appListeners.forEach(({element, type, handler}) => {
      element.removeEventListener(type, handler);
    });
    appListeners.clear();
    */
}


// Handle backend unavailability notifications
/**
 * Removed local handleBackendUnavailable in favor of the unified eventHandler.js version.
 */
// This section is just comments indicating removal, which is correct.


function refreshAppData() {
  // This function is called on authReady (if authenticated) and from loadConversationList after 404
  // It triggers a reload of projects and conversations.
  // projectManager.loadProjects and loadConversationList now use apiRequest,
  // which calls ChatUtils.handleError for error notifications.
  // The rendering is done by projectListComponent and uiRenderer based on events.

  // Guard against multiple concurrent refreshes
  // API_CONFIG.authCheckInProgress is managed by auth.js.
  if (API_CONFIG.authCheckInProgress) {
    log("[refreshAppData] Auth check in progress, deferring refresh");
    return;
  }

  log("[refreshAppData] Refreshing application data after authentication.");

  // Ensure components initialized (called by initApp, but safe to re-ensure if needed)
  ensureComponentsInitialized()
    .then(() => {
      // Single source of truth for project loading (errors handled by projectManager -> ChatUtils)
      if (window.projectManager?.loadProjects) {
        return window.projectManager.loadProjects('all');
      } else {
        // If projectManager is not available, still attempt to load conversations
        console.warn("[refreshAppData] projectManager not available. Skipping project load.");
        // Signal empty project list for UI
         if (window.projectListComponent?.renderProjects) {
            window.projectListComponent.renderProjects([]);
         }
        return Promise.resolve([]); // Resolve with empty projects
      }
    })
    .then(projects => {
      log(`[refreshAppData] Loaded ${projects.length} projects (via event dispatch).`);
      // Rendering handled by projectListComponent based on 'projectsLoaded' event.

      // Now refresh conversations (errors handled by loadConversationList -> ChatUtils)
      return loadConversationList().catch(err => {
          console.warn("[refreshAppData] Failed to load conversations:", err);
          // loadConversationList calls ChatUtils.handleError
          return []; // Return empty array on error
      });
    })
    .catch(err => {
      // This catch block handles errors from ensureComponentsInitialized or the *then* blocks above
      // if they throw synchronously or return a rejected promise not caught internally.
      console.error("[refreshAppData] Error refreshing data:", err);
      // ChatUtils.handleError is the final destination for notifications.
      window.ChatUtils.handleError('Refreshing application data', err);
    });
}

async function ensureComponentsInitialized() {
  // This function's role is to ensure the necessary HTML structure and component
  // instances (like ProjectListComponent) exist *before* data is loaded and rendered.
  // It handles dynamic loading of project_list.html if needed and instantiating
  // ProjectListComponent and potentially ProjectDashboard.

  // Check if ProjectListComponent instance is already created
  if (window.projectListComponent) {
    log("[ensureComponentsInitialized] ProjectListComponent instance already exists.");
    return Promise.resolve();
  }

  log("[ensureComponentsInitialized] Ensuring component initialization...");

  // Rely on ProjectDashboardUtils.js to ensure the main containers exist and
  // potentially load project_list.html if it's missing, and instantiate
  // ProjectListComponent and ProjectDashboard.

  if (window.ProjectDashboard?.ensureContainersExist) {
      // Ensure containers exist, this should also load project_list.html template
      await window.ProjectDashboard.ensureContainersExist();
      log("[ensureComponentsInitialized] Ensured containers exist via ProjectDashboard.");
  } else {
      console.warn("[ensureComponentsInitialized] ProjectDashboard or ensureContainersExist missing. Cannot guarantee HTML template load or container creation.");
      // Fallback check if projectListView exists, assuming HTML is somehow loaded
      const projectListElement = document.getElementById('projectListView');
      if (!projectListElement) {
         console.error("[ensureComponentsInitialized] Critical: #projectListView is missing.");
         throw new Error("Required UI container missing: #projectListView");
      }
  }

  // Now, instantiate components if they haven't been already
  // projectDashboard.js is responsible for instantiating ProjectListComponent
  // and ProjectDetailsComponent. We should wait for that to happen.

  // Wait for ProjectDashboard to signal its components are ready
  return new Promise((resolve, reject) => {
    if (window.projectListComponent && window.projectDashboardInitialized) {
      log("[ensureComponentsInitialized] Components already initialized (instance and flag found).");
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
        const errMsg = `Component initialization timed out after 1000ms`; // Adjusted timeout
        log(errMsg);
        // Use ChatUtils.handleError for notifications
        window.ChatUtils.handleError('Component Initialization Timeout', new Error(errMsg));
        document.removeEventListener('projectDashboardInitialized', handleDashboardInit);
        reject(new Error(errMsg)); // Reject the promise on timeout
    }, 1000); // Shorter timeout for component instantiation wait

    const handleDashboardInit = () => {
        log("[ensureComponentsInitialized] projectDashboardInitialized event received.");
        clearTimeout(timeout);
        resolve();
    };

    // Listen for the event dispatched by ProjectDashboard.js
    document.addEventListener('projectDashboardInitialized', handleDashboardInit, { once: true });

    // Check again immediately in case the event already fired
    if (window.projectListComponent && window.projectDashboardInitialized) {
       log("[ensureComponentsInitialized] Components initialized immediately after adding listener.");
       clearTimeout(timeout);
       document.removeEventListener('projectDashboardInitialized', handleDashboardInit);
       resolve();
    }

  });
}

/**
 * Removed local handleAuthStateChange in favor of the unified eventHandler.js version.
 */

async function initApp() {
  // This is the main application initialization sequence.
  // It needs to orchestrate the setup of authentication, event handlers, UI components, etc.

  log("[initApp] Starting application initialization.");

  // 1. Clean up existing listeners (if any local ones are tracked)
  cleanupAppListeners(); // This is stubbed now, OK if eventHandler handles everything

  // 2. Set initial phase to BOOT
  setPhase(AppPhase.BOOT);

  // 3. Wait for DOMContentLoaded if not already ready
  if (document.readyState === 'loading') {
    log("[initApp] Waiting for DOMContentLoaded...");
    await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    log("[initApp] DOMContentLoaded event fired.");
  }
  setPhase(AppPhase.DOM_READY);
  log("[initApp] App phase set to DOM_READY.");


  // 4. Set viewport height (UI related)
  setViewportHeight();

  // 5. Cache essential DOM elements
  cacheElements(); // This is fine

  // 6. Setup global event listeners (delegated via eventHandler.js)
  // This relies on eventHandler.js.init() being called elsewhere,
  // or we need to call it here if it's the app's responsibility.
  // Assuming eventHandler.js is initialized and handles global listeners.
  setupEventListeners(); // This is stubbed now, OK if eventHandler does it.

  // 7. Wait for dashboardUtilsReady (contains UIUtils, ModalManager, showProjectsView)
  // ProjectDashboard.js also relies on this.
  await ensureDashboardUtilsReady(); // Using a dedicated wait function

  // 8. Initialize Auth Module
  // Auth.js also needs to be initialized. Its init() function
  // waits for CSRF token and performs an initial verification.
  if (window.auth?.init) {
     log("[initApp] Initializing auth module...");
     // auth.init() should handle its own errors and broadcast auth state.
     await window.auth.init();
     log("[initApp] Auth module initialization completed.");
  } else {
     console.warn("[initApp] Auth module or init function not available.");
     // Continue without auth if missing, UI should adapt.
  }
  setPhase(AppPhase.AUTH_CHECKED);
  log("[initApp] App phase set to AUTH_CHECKED.");


  // 9. Ensure Core UI Components are Initialized (Project List, Details, etc.)
  // This includes ensuring HTML templates are loaded and component instances exist.
  // projectDashboard.js takes care of this.
  // We need to wait for ProjectDashboard's initialization to confirm components are ready.
  await ensureProjectDashboardInitialized(); // Using a dedicated wait function
  log("[initApp] Core UI components initialization completed.");


  // 10. Initialize Chat System
  // ChatManager.initializeChat handles loading its dependencies and creating instances.
  if (window.ChatManager?.initializeChat) {
    log("[initApp] Initializing chat system...");
    // ChatManager.initializeChat handles its own errors and calls ChatUtils.handleError
    await window.ChatManager.initializeChat();
    log("[initApp] Chat system initialized successfully.");
  } else {
    console.warn("[initApp] ChatManager or initializeChat function not available.");
    // Continue without chat if missing, UI should adapt.
  }


  // 11. Handle Initial Navigation (based on URL)
  // This determines which view to show (projects list, project details, or a specific chat).
  // This should happen AFTER auth and main UI components are ready.
  log("[initApp] Handling initial navigation based on URL...");
  // handleNavigationChange uses ensureAuthenticated, debouncedLoadProject, navigateToConversation
  // Errors within these are handled by ChatUtils.handleError.
  await handleNavigationChange();
  log("[initApp] Initial navigation handled.");


  // 12. Mark initialization as complete
  window.__appInitializing = false; // Global flag
  setPhase(AppPhase.COMPLETE);
  log("[initApp] Application fully initialized. App phase set to COMPLETE.");

  // Optional: Trigger a final data refresh if user is authenticated,
  // in case auth state changed during initialization.
  if (window.auth?.isAuthenticated?.()) {
     log("[initApp] User is authenticated, triggering final data refresh.");
     refreshAppData(); // refreshAppData will call loadProjects and loadConversationList
  }


  return true;
}

/**
 * Helper to wait specifically for dashboardUtilsReady flag/event.
 */
async function ensureDashboardUtilsReady() {
  log("[app.js] ensureDashboardUtilsReady: Checking dashboardUtilsReady flag...");
  if (window.dashboardUtilsReady === true) {
    log("[app.js] ensureDashboardUtilsReady: Flag already set.");
    return;
  }
  log("[app.js] ensureDashboardUtilsReady: Flag not set, waiting for event.");
  return new Promise(resolve => {
     // Listening for the event dispatched by projectDashboardUtils.js
     document.addEventListener('dashboardUtilsReady', () => {
        log("[app.js] ensureDashboardUtilsReady: dashboardUtilsReady event received.");
        resolve();
     }, { once: true });
     // Add a timeout in case the event doesn't fire
     setTimeout(() => {
        if (!window.dashboardUtilsReady) {
           console.warn("[app.js] ensureDashboardUtilsReady: Timeout waiting for dashboardUtilsReady event.");
           // Proceed anyway, hoping for the best or fallbacks
           resolve();
        }
     }, 5000); // 5 second timeout
  });
}

/**
 * Helper to wait specifically for ProjectDashboard to be initialized.
 */
async function ensureProjectDashboardInitialized() {
   log("[app.js] ensureProjectDashboardInitialized: Checking projectDashboardInitialized flag...");
   if (window.projectDashboardInitialized === true) {
      log("[app.js] ensureProjectDashboardInitialized: Flag already set.");
      return;
   }
   log("[app.js] ensureProjectDashboardInitialized: Flag not set, waiting for event.");
   return new Promise(resolve => {
      // Listening for the event dispatched by ProjectDashboard.js
      document.addEventListener('projectDashboardInitialized', () => {
         log("[app.js] ensureProjectDashboardInitialized: projectDashboardInitialized event received.");
         resolve();
      }, { once: true });
       // Add a timeout in case the event doesn't fire
       setTimeout(() => {
          if (!window.projectDashboardInitialized) {
             console.warn("[app.js] ensureProjectDashboardInitialized: Timeout waiting for projectDashboardInitialized event.");
             // Proceed anyway, hoping ProjectDashboard.js is loaded but event didn't fire
             resolve();
          }
       }, 5000); // 5 second timeout
   });
}


// EXPORTS
window.API_CONFIG = API_CONFIG;
window.SELECTORS = SELECTORS;
window.apiRequest = apiRequest; // Keep apiRequest global for now
window.getBaseUrl = getBaseUrl; // Keep getBaseUrl global for now
window.ensureAuthenticated = ensureAuthenticated; // Keep global for explicit checks
window.loadConversationList = loadConversationList; // Keep global for sidebar/manual refresh
window.isValidUUID = isValidUUID; // Keep global utility
window.navigateToConversation = navigateToConversation; // Keep global for navigation



// CENTRAL INITIALIZATION triggered by DOMContentLoaded event listener below
// This object seems to wrap initApp. We can keep this structure.
window.appInitializer = {
  status: 'pending',
  queue: [], // Components can register their init functions here
  register: (component) => {
    if (window.appInitializer.status === 'ready') {
       // If already ready, initialize the component immediately
       try {
          component.init();
       } catch (e) {
          console.error(`[appInitializer] Error initializing component immediately:`, e);
           // Use ChatUtils.handleError for notification
           window.ChatUtils?.handleError(`Component init (${component.name || 'anonymous'})`, e);
       }
    }
    else {
      // Otherwise, add to the queue to be initialized after app is ready
      window.appInitializer.queue.push(component);
      log(`[appInitializer] Component registered: ${component.name || 'anonymous'}`);
    }
  },
  initialize: async () => {
    if (window.appInitializer.status === 'initializing' || window.appInitializer.status === 'ready') {
      console.log("[appInitializer] Initialization already in progress or complete, skipping...");
      return;
    }
    window.appInitializer.status = 'initializing';
    log("[appInitializer] Starting centralized initialization process.");

    try {
      // Run the main app initialization sequence
      await initApp();

      // Once initApp is complete, process the queue
      window.appInitializer.status = 'ready';
      log(`[appInitializer] App initialized. Processing ${window.appInitializer.queue.length} registered components.`);
      // Process components in the queue
      for (const component of window.appInitializer.queue) {
         try {
            await component.init(); // Await component initialization
            log(`[appInitializer] Component initialized: ${component.name || 'anonymous'}`);
         } catch (e) {
            console.error(`[appInitializer] Error initializing component from queue:`, e);
            // Use ChatUtils.handleError for notification
            window.ChatUtils?.handleError(`Component init (${component.name || 'anonymous'})`, e);
         }
      }
      window.appInitializer.queue = []; // Clear the queue

      log("[appInitializer] Application fully initialized and components processed.");
    } catch (error) {
      console.error("[appInitializer] Critical Initialization error:", error);
      // Use ChatUtils.handleError for final error notification
      window.ChatUtils?.handleError('App initialization', error) || alert("Failed to initialize. Please refresh the page.");
      window.appInitializer.status = 'error'; // Set status to error
    }
  }
};

// Initial call to start the initialization when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  log("[app.js] DOMContentLoaded event fired. Starting app initialization via appInitializer.");
  window.appInitializer.initialize().catch(error => {
    console.error("[DOMContentLoaded] Error starting app initialization:", error);
     // Fallback notification if ChatUtils isn't ready
     alert("Failed to start initialization. Please refresh the page.");
  });
  // Dispatch a general event indicating app.js is loaded, though appInitializer
  // events are more granular for initialization status.
  document.dispatchEvent(new CustomEvent('appJsReady'));
});

// Listener for authReady event from auth.js (via AuthBus)
// This triggers refreshAppData if authenticated.
// This listener is fine.

// Listener for projectSelected event
// This listener is fine.

// Listener for showProjectList event
// This listener is fine, calls showProjectListView.
  showProjectListView();
  window.history.pushState({}, '', '/?view=projects');
});
