/**
 * app.js
 * - Cookie-based auth (no CORS/origin usage).
 * - Maintains API_CONFIG, uses a fetch wrapper, manages UI based on auth state.
 * - Integrates with chat system modules (ChatManager, projectManager, etc.).
 */

const debounce = window.eventHandlers?.debounce ?? (fn => fn);

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

// Timeout config (milliseconds)
const TIMEOUT_CONFIG = {
  INITIALIZATION: 30000,
  AUTH_CHECK: 10000,
  API_REQUEST: 10000,
  COMPONENT_LOAD: 15000,
  CHAT_MANAGER: 20000,
  DOM_READY: 5000
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
  authCheckLock: false
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

// CUSTOM ERROR CLASS
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

const clearAuthState = () => window.auth?.clear?.();
const ensureAuthenticated = (opts = {}) => window.auth.isAuthenticated(opts);

// API REQUEST FUNCTIONS
const pendingRequests = new Map();
function sanitizeUrl(url) {
  return url.replace(/\s+/g, '').replace(/\/+/g, '/');
}

async function parseErrorResponse(response) {
  const status = response.status;
  try {
    const errData = await response.json();
    const message = errData.message || errData.error || response.statusText || `HTTP ${status}`;
    return new APIError(`API error (${status}): ${message}`, {
      status,
      code: `E${status}`,
      isPermanent: status === 404,
      detail: errData.detail
    });
  } catch (e) {
    const text = await response.text().catch(() => response.statusText);
    return new APIError(`API error (${status}): ${text || response.statusText}`, {
      status,
      code: `E${status}`
    });
  }
}

function getBaseUrl() {
  if (API_CONFIG.baseUrl && API_CONFIG.baseUrl.includes('put.photo')) {
    console.warn('Detected incorrect API domain (put.photo). Resetting to relative paths.');
    API_CONFIG.baseUrl = '';
  }
  if (!API_CONFIG.baseUrl) API_CONFIG.baseUrl = '';
  return API_CONFIG.baseUrl;
}

async function apiRequest(endpoint, method = 'GET', data = null, options = {}) {
  const requestKey = `${method}:${endpoint}:${JSON.stringify(data)}`;
  if (pendingRequests.has(requestKey)) {
    log(`[apiRequest] Deduplicating: ${requestKey}`);
    return pendingRequests.get(requestKey);
  }

  const controller = options.signal?.controller || new AbortController();
  const timeoutMs = options.timeout || TIMEOUT_CONFIG.API_REQUEST;
  const timeoutId = options.signal
    ? null
    : setTimeout(() => {
      log(`[apiRequest] Aborting after ${timeoutMs}ms: ${endpoint}`);
      controller.abort();
    }, timeoutMs);

  const requestPromise = (async () => {
    try {
      endpoint = sanitizeUrl(endpoint);
      if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
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
        if (window.auth?.isInitialized && !isAuthEndpoint) {
          try {
            const token = window.auth.getAuthToken();
            if (token) {
              requestOptions.headers.Authorization = 'Bearer ' + token;
            }
          } catch (err) {
            console.error('[apiRequest] Error retrieving token:', err);
          }
        }
        requestOptions.body = data instanceof FormData ? data : JSON.stringify(data);
        if (!(data instanceof FormData)) {
          requestOptions.headers['Content-Type'] = 'application/json';
        }
      }

      const response = await fetch(finalUrl, requestOptions);
      if (!response.ok) {
        const error = await parseErrorResponse(response);
        if (error.status === 401) {
          if (!window.__last401Time || Date.now() - window.__last401Time > 30000) {
            window.__last401Time = Date.now();
            throw error;
          } else {
            throw new APIError('Authentication required (retry throttled)', {
              status: 401,
              code: 'E401_THROTTLED'
            });
          }
        }
        if (error.status === 403) {
          window.auth?.clear?.();
        }
        throw error;
      }
      if (response.status === 204) return null;
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
    window.ChatUtils.handleError('Loading project', error);
  } finally {
    if (currentlyLoadingProjectId === projectId) currentlyLoadingProjectId = null;
  }
}, DEBOUNCE_DELAY);

async function loadConversationList() {
  if (API_CONFIG.authCheckInProgress) {
    log("[loadConversationList] Auth check in progress, deferring");
    return [];
  }
  let projectId = window.ChatUtils.getProjectId();
  if (!projectId && window.projectManager?.loadProjects) {
    try {
      const projects = await window.projectManager.loadProjects("all");
      if (projects && projects.length > 0) {
        projectId = projects[0].id;
        localStorage.setItem("selectedProjectId", projectId);
      } else {
        if (window.uiRenderer?.renderConversations) {
          window.uiRenderer.renderConversations({ data: { conversations: [] } });
        }
        return [];
      }
    } catch (err) {
      console.error("[loadConversationList] Error auto-selecting project:", err);
      if (window.uiRenderer?.renderConversations) {
        window.uiRenderer.renderConversations({ data: { conversations: [] } });
      }
      return [];
    }
  }
  if (!projectId || !isValidUUID(projectId)) {
    console.error('[loadConversationList] Invalid project ID:', projectId);
    if (window.uiRenderer?.renderConversations) {
      window.uiRenderer.renderConversations({ data: { conversations: [] } });
    }
    return [];
  }
  const url = API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{project_id}', projectId);
  try {
    const data = await apiRequest(url);
    if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations(data);
    return data;
  } catch (err) {
    if (err.status === 404) {
      localStorage.removeItem("selectedProjectId");
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects("all")
          .then(projects => {
            if (projects && projects.length > 0) {
              localStorage.setItem("selectedProjectId", projects[0].id);
              setTimeout(() => loadConversationList(), 500);
            } else {
              if (window.uiRenderer?.renderConversations) {
                window.uiRenderer.renderConversations({ data: { conversations: [] } });
              }
            }
          })
          .catch(newErr => {
            console.error("[loadConversationList] Failed to load valid projects after 404:", newErr);
            if (window.uiRenderer?.renderConversations) {
              window.uiRenderer.renderConversations({ data: { conversations: [] } });
            }
          });
      } else {
        if (window.uiRenderer?.renderConversations) {
          window.uiRenderer.renderConversations({ data: { conversations: [] } });
        }
      }
    }
    return [];
  }
}

async function loadProjects() {
  try {
    const isAuthenticated = await ensureAuthenticated();
    if (!isAuthenticated) {
      toggleVisibility(document.getElementById('loginRequiredMessage'), true);
      toggleVisibility(document.getElementById('projectManagerPanel'), false);
      toggleVisibility(document.getElementById('projectListView'), false);
      if (window.projectListComponent?.renderProjects) {
        window.projectListComponent.renderProjects([]);
      }
      return;
    }
    toggleVisibility(document.getElementById('loginRequiredMessage'), false);
    toggleVisibility(document.getElementById('projectManagerPanel'), true);
    toggleVisibility(document.getElementById('projectListView'), true);

    if (window.projectManager?.loadProjects) {
      const params = new URLSearchParams(window.location.search);
      const filter = params.get('filter') || 'all';
      await window.projectManager.loadProjects(filter);
    } else {
      if (window.projectListComponent?.renderProjects) {
        window.projectListComponent.renderProjects([]);
      }
    }
  } catch (err) {
    console.error("[App] Error in loadProjects:", err);
    window.ChatUtils.handleError('Loading projects (App wrapper)', err);
  }
}

// NAVIGATION & STATE
async function navigateToConversation(conversationId) {
  window.history.pushState({}, '', `/?chatId=${conversationId}`);
  try {
    const projectId = window.ChatUtils.getProjectId();
    if (!projectId) {
      window.showNotification("Please select a project first", "error");
      window.history.pushState({}, '', '/?view=projects');
      toggleVisibility(getEl('CHAT_UI'), false);
      toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
      return false;
    }
    await ensureChatManagerAvailable();
    if (window.ChatManager?.loadConversation) {
      return await window.ChatManager.loadConversation(conversationId);
    } else {
      throw new Error('ChatManager not initialized for loadConversation');
    }
  } catch (error) {
    console.error('Error navigating to conversation:', error);
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
    throw error;
  }
}

async function ensureChatManagerAvailable() {
  if (!window.ChatManager) {
    log('Waiting for ChatManager...');
    return new Promise((resolve, reject) => {
      const handleReady = () => {
        log('ChatManager ready event fired');
        resolve();
      };
      document.addEventListener('chatManagerReady', handleReady, { once: true });

      const timeout = setTimeout(() => {
        const errMsg = `ChatManager init timed out after ${TIMEOUT_CONFIG.CHAT_MANAGER}ms.`;
        log(errMsg);
        document.removeEventListener('chatManagerReady', handleReady);
        window.ChatUtils.handleError('Waiting for ChatManager', new Error(errMsg));
        reject(new Error(errMsg));
      }, TIMEOUT_CONFIG.CHAT_MANAGER);

      const checkInterval = setInterval(() => {
        if (window.ChatManager) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          document.removeEventListener('chatManagerReady', handleReady);
          log('ChatManager found via interval check.');
          resolve();
        }
      }, 100);
    });
  }
  return Promise.resolve();
}

async function handleNavigationChange() {
  try {
    if (window.__appInitializing) {
      log("App still initializing, waiting...");
      await new Promise(resolve => {
        const checkStatus = setInterval(() => {
          if (window.appInitializer?.status !== 'initializing') {
            clearInterval(checkStatus);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkStatus);
          log(`Timeout waiting for app initialization (${TIMEOUT_CONFIG.INITIALIZATION}ms)`);
          resolve();
        }, TIMEOUT_CONFIG.INITIALIZATION);
      });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const view = urlParams.get('view');
    const projectId = urlParams.get('project');

    const isAuthenticated = await ensureAuthenticated();
    if (!isAuthenticated) {
      toggleVisibility(getEl('CHAT_UI'), false);
      toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
      return;
    }

    toggleVisibility(document.getElementById("loginRequiredMessage"), false);

    if (view === 'projects') {
      showProjectListView();
      return;
    }
    if (projectId) {
      debouncedLoadProject(projectId);
      return;
    }
    if (chatId) {
      await navigateToConversation(chatId);
      return;
    }
    showProjectListView();
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
  } catch (error) {
    console.error('Navigation error:', error);
    window.ChatUtils.handleError('Navigation change', error);
  }
}

let _showingProjectListView = false;
async function showProjectListView() {
  if (_showingProjectListView) {
    return;
  }
  _showingProjectListView = true;

  try {
    const isAuthenticated = await ensureAuthenticated();
    if (!isAuthenticated) {
      toggleVisibility(document.getElementById('projectManagerPanel'), false);
      toggleVisibility(document.getElementById('projectListView'), false);
      if (window.projectListComponent?.renderProjects) {
        window.projectListComponent.renderProjects([]);
      }
      return;
    }
    const projectPanel = document.getElementById('projectManagerPanel');
    const projectListViewEl = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');
    if (projectPanel) projectPanel.classList.remove('hidden');
    if (projectListViewEl) {
      projectListViewEl.classList.remove('hidden');
      projectListViewEl.style.display = 'flex';
    }
    if (projectDetailsView) projectDetailsView.classList.add('hidden');

    if (window.projectManager?.loadProjects) {
      await window.projectManager.loadProjects('all');
    } else if (window.projectListComponent?.renderProjects) {
      window.projectListComponent.renderProjects([]);
    }
  } catch (error) {
    console.error("[showProjectListView] Error:", error);
    window.ChatUtils.handleError('Showing project list view', error);
  } finally {
    _showingProjectListView = false;
  }
}

// INITIALIZATION
function cacheElements() {
  Object.entries(SELECTORS).forEach(([key, selector]) => {
    const element = document.querySelector(selector);
    ELEMENTS[key] = element || null;
  });
}

function setupEventListeners() {
  // Global listeners might be initialized elsewhere; minimal here.
  log("[app.js] setupEventListeners");
}

function cleanupAppListeners() {
  log("[app.js] cleanupAppListeners");
}

function refreshAppData() {
  if (API_CONFIG.authCheckInProgress) {
    log("[refreshAppData] Auth check in progress, deferring");
    return;
  }
  log("[refreshAppData] Reloading projects & conversations.");

  ensureComponentsInitialized()
    .then(() => {
      if (window.projectManager?.loadProjects) {
        return window.projectManager.loadProjects('all');
      }
      if (window.projectListComponent?.renderProjects) {
        window.projectListComponent.renderProjects([]);
      }
      return [];
    })
    .then(() => loadConversationList().catch(err => {
      console.warn("[refreshAppData] Failed to load conversations:", err);
      return [];
    }))
    .catch(err => {
      console.error("[refreshAppData] Error:", err);
      window.ChatUtils.handleError('Refreshing application data', err);
    });
}

async function ensureComponentsInitialized() {
  if (window.projectListComponent) {
    return;
  }
  log("[ensureComponentsInitialized] Ensuring components...");

  if (window.ProjectDashboard?.ensureContainersExist) {
    await window.ProjectDashboard.ensureContainersExist();
  } else {
    const projectListElement = document.getElementById('projectListView');
    if (!projectListElement) {
      throw new Error("Required UI container missing: #projectListView");
    }
  }
  return new Promise((resolve, reject) => {
    if (window.projectListComponent && window.projectDashboardInitialized) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      const errMsg = `Component initialization timed out`;
      window.ChatUtils.handleError('Component Initialization Timeout', new Error(errMsg));
      document.removeEventListener('projectDashboardInitialized', handleDashboardInit);
      reject(new Error(errMsg));
    }, 1000);
    const handleDashboardInit = () => {
      clearTimeout(timeout);
      resolve();
    };
    document.addEventListener('projectDashboardInitialized', handleDashboardInit, { once: true });
    if (window.projectListComponent && window.projectDashboardInitialized) {
      clearTimeout(timeout);
      document.removeEventListener('projectDashboardInitialized', handleDashboardInit);
      resolve();
    }
  });
}

async function initApp() {
  log("[initApp] Starting initialization.");
  cleanupAppListeners();
  setPhase(AppPhase.BOOT);

  if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r));
  }
  setPhase(AppPhase.DOM_READY);
  setViewportHeight();
  cacheElements();
  setupEventListeners();

  await ensureDashboardUtilsReady();

  if (window.auth?.init) {
    await window.auth.init();
  }
  setPhase(AppPhase.AUTH_CHECKED);

  await ensureProjectDashboardInitialized();

  if (window.ChatManager?.initializeChat) {
    await window.ChatManager.initializeChat();
  }
  await handleNavigationChange();

  window.__appInitializing = false;
  setPhase(AppPhase.COMPLETE);

  if (window.auth?.isAuthenticated?.()) {
    refreshAppData();
  }
  return true;
}

async function ensureDashboardUtilsReady() {
  if (window.dashboardUtilsReady === true) return;
  return new Promise(resolve => {
    document.addEventListener('dashboardUtilsReady', () => resolve(), { once: true });
    setTimeout(() => {
      if (!window.dashboardUtilsReady) {
        console.warn("[app.js] Timeout waiting for dashboardUtilsReady");
        resolve();
      }
    }, 5000);
  });
}

async function ensureProjectDashboardInitialized() {
  if (window.projectDashboardInitialized === true) return;
  return new Promise(resolve => {
    document.addEventListener('projectDashboardInitialized', () => resolve(), { once: true });
    setTimeout(() => {
      if (!window.projectDashboardInitialized) {
        console.warn("[app.js] Timeout waiting for projectDashboardInitialized");
        resolve();
      }
    }, 5000);
  });
}

// GLOBAL EXPORTS
window.API_CONFIG = API_CONFIG;
window.SELECTORS = SELECTORS;
window.apiRequest = apiRequest;
window.getBaseUrl = getBaseUrl;
window.ensureAuthenticated = ensureAuthenticated;
window.loadConversationList = loadConversationList;
window.isValidUUID = isValidUUID;
window.navigateToConversation = navigateToConversation;

// CENTRAL INITIALIZATION
window.appInitializer = {
  status: 'pending',
  queue: [],
  register: (component) => {
    if (window.appInitializer.status === 'ready') {
      try {
        component.init();
      } catch (e) {
        console.error(`[appInitializer] Immediate init error:`, e);
        window.ChatUtils?.handleError(`Component init (${component.name || 'anonymous'})`, e);
      }
    } else {
      window.appInitializer.queue.push(component);
      log(`[appInitializer] Registered component: ${component.name || 'anonymous'}`);
    }
  },
  initialize: async () => {
    if (['initializing', 'ready'].includes(window.appInitializer.status)) {
      console.log("[appInitializer] Already initializing or ready, skipping...");
      return;
    }
    window.appInitializer.status = 'initializing';
    try {
      await initApp();
      window.appInitializer.status = 'ready';
      for (const component of window.appInitializer.queue) {
        try {
          await component.init();
        } catch (e) {
          console.error("[appInitializer] Queue init error:", e);
          window.ChatUtils?.handleError(`Component init (${component.name || 'anonymous'})`, e);
        }
      }
      window.appInitializer.queue = [];
    } catch (error) {
      console.error("[appInitializer] Critical init error:", error);
      window.ChatUtils?.handleError('App initialization', error) ||
        alert("Failed to initialize. Please refresh.");
      window.appInitializer.status = 'error';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  log("[app.js] DOMContentLoaded - starting app initialization.");
  window.appInitializer.initialize().catch(error => {
    console.error("[DOMContentLoaded] Initialization error:", error);
    alert("Failed to start initialization. Please refresh.");
  });
  document.dispatchEvent(new CustomEvent('appJsReady'));

  // Example listeners (if needed):
  // document.addEventListener('authReady', () => { if (window.auth?.isAuthenticated?.()) refreshAppData(); });
  // document.addEventListener('projectSelected', e => debouncedLoadProject(e.detail.projectId));
  // document.addEventListener('showProjectList', () => {
  //   showProjectListView();
  //   window.history.pushState({}, '', '/?view=projects');
  // });
});
