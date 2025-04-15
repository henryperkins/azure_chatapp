/**
 * app.js - Cookie-based auth only, no CORS/origin usage.
 * Maintains API_CONFIG, uses fetch wrapper, manages UI via auth state.
 * Relies on auth.js for session cookies and integrates with chat system modules.
 */

/**
 * Replace local fallback with eventHandlers-based approach.
 * If eventHandlers is missing, do nothing special (no fallback).
 */
function debounce(func, wait) {
  if (!window.eventHandlers?.debounce) {
    console.warn("[app.js] eventHandlers.debounce not found. Debounce calls will just run func immediately.");
    return func;
  }
  return window.eventHandlers.debounce(func, wait);
}

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

// AUTHENTICATION FUNCTIONS
function clearAuthState() {
  if (window.auth?.clear) window.auth.clear();
  else {
    API_CONFIG.isAuthenticated = false;
    document.dispatchEvent(new CustomEvent('authStateChanged', { detail: { authenticated: false } }));
  }
}

function ensureAuthenticated(options = {}) {
  if (window.auth?.verifyAuthState) {
    return window.auth.verifyAuthState(options.forceVerify);
  }

  // Fallback if auth.js not initialized
  API_CONFIG.authCheckInProgress = true;
  return window.ChatUtils.isAuthenticated(options).then(isAuth => {
    API_CONFIG.isAuthenticated = isAuth;
    API_CONFIG.authCheckInProgress = false;
    return isAuth;
  }).catch(err => {
    console.error('[ensureAuthenticated] Auth check failed:', err);
    API_CONFIG.isAuthenticated = false;
    API_CONFIG.authCheckInProgress = false;
    return false;
  });
}

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
  const timeoutMs = options.timeout || 10000;
  const timeoutId = options.signal ? null : setTimeout(() => controller.abort(), timeoutMs);
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
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
      if (!csrfToken) {
        console.error('[API] CSRF token missing - triggering auth refresh');
        await verifyAuthState(true);
        throw new Error('CSRF token missing - please refresh page');
      }
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
        if (window.auth?.isInitialized) {
          try {
            const token = await window.auth.getAuthToken().catch(() => null);
            if (token) requestOptions.headers['Authorization'] = 'Bearer ' + token;
          } catch (err) {
            console.error('[apiRequest] Auth token error:', err);
          }
        }
        requestOptions.body = data instanceof FormData ? data : JSON.stringify(data);
        if (!(data instanceof FormData)) requestOptions.headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(finalUrl, requestOptions);
      if (!response.ok) {
        API_CONFIG.lastErrorStatus = response.status;
        throw await parseErrorResponse(response, finalUrl);
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

async function parseErrorResponse(response, finalUrl) {
  const status = response.status;
  const responseClone = response.clone();
  let errData;
  try {
    errData = await response.json();
  } catch {
    const text = await responseClone.text().catch(() => response.statusText);
    return new APIError(`API error (${status}): ${text || response.statusText}`, { status, code: `E${status}` });
  }
  const message = errData.message || errData.error || response.statusText || `HTTP ${status}`;
  return new APIError(`API error (${status}): ${message}`, { status, code: `E${status}`, isPermanent: status === 404 });
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
    window.ChatUtils.handleError('Loading project', error);
  } finally {
    if (currentlyLoadingProjectId === projectId) currentlyLoadingProjectId = null;
  }
}, DEBOUNCE_DELAY);

async function loadConversationList() {
  if (!await ensureAuthenticated()) {
    log("[loadConversationList] Not authenticated");
    return [];
  }
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
        log(`[loadConversationList] Auto-selected project: ${projectId}`);
      } else {
        if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
        return [];
      }
    } catch (err) {
      console.error("[loadConversationList] Error auto-selecting project:", err);
      window.ChatUtils.handleError('Auto-selecting project for conversations', err);
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
  return apiRequest(url).then(data => {
    if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations(data);
    return data;
  }).catch(err => {
    if (err.status === 404) {
      console.warn(`[loadConversationList] Project ${projectId} not found`);
      localStorage.removeItem("selectedProjectId");
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects("all").then(projects => {
          if (projects && projects.length > 0) {
            localStorage.setItem("selectedProjectId", projects[0].id);
            setTimeout(() => loadConversationList(), 500);
          }
        }).catch(newErr => console.error("[loadConversationList] Failed to load valid projects:", newErr));
      }
    }
    window.ChatUtils.handleError('Loading conversation list', err);
    if (window.uiRenderer?.renderConversations) window.uiRenderer.renderConversations({ data: { conversations: [] } });
    return [];
  });
}

async function loadInitialProjects(retryOnFailure = true) {
  try {
    const isAuthenticated = await ensureAuthenticated();
    if (!isAuthenticated) {
      log("[App] Not authenticated, showing login prompt");
      toggleVisibility(document.getElementById('loginRequiredMessage'), true);
      return;
    }
    if (window.projectManager?.loadProjects) {
      const projects = await window.projectManager.loadProjects('all');
      log(`[App] Loaded ${projects.length} projects`);
    }
  } catch (err) {
    console.error("[App] Error loading initial projects:", err);
    window.ChatUtils.handleError('Loading initial projects', err);
    if (retryOnFailure) {
      await ensureAuthenticated({ forceVerify: true });
      loadInitialProjects(false);
    }
  }
}

async function loadSidebarProjects() {
  if (!await ensureAuthenticated()) {
    log("[loadSidebarProjects] Not authenticated");
    return [];
  }
  try {
    return apiRequest(API_ENDPOINTS.PROJECTS).then(apiResponse => {
      let projectsArray = Array.isArray(apiResponse) ? apiResponse :
        Array.isArray(apiResponse?.data) ? apiResponse.data :
          Array.isArray(apiResponse?.projects) ? apiResponse.projects : [];
      if (window.uiRenderer?.renderProjects) window.uiRenderer.renderProjects(projectsArray);
      document.dispatchEvent(new CustomEvent('sidebarProjectsRendered', { detail: { count: projectsArray.length } }));
      return projectsArray;
    }).catch(error => {
      console.error('[loadSidebarProjects] Failed to load sidebar projects:', error);
      window.ChatUtils.handleError('Loading sidebar projects', error);
      document.dispatchEvent(new CustomEvent('sidebarProjectsError', { detail: { error } }));
      throw error;
    });
  } catch (error) {
    console.error('Failed to load sidebar projects:', error);
    window.ChatUtils.handleError('Loading sidebar projects', error);
    throw error;
  }
}

// NAVIGATION & STATE
async function navigateToConversation(conversationId) {
  window.history.pushState({}, '', `/?chatId=${conversationId}`);

  try {
    // Ensure ChatManager is initialized
    if (!window.ChatManager) {
      console.error('ChatManager not available - initializing chat system');
      await window.ChatManager.initializeChat();
    }

    // Delegate UI visibility to ChatInterface after initialization
    if (window.chatInterface && window.chatInterface.initialized) {
      await window.chatInterface.ui.ensureChatContainerVisible(window.ChatUtils.getProjectId() !== null);
    } else {
      // Fallback if not initialized
      toggleVisibility(getEl('CHAT_UI'), true);
      toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), false);
    }

    return await window.ChatManager.loadConversation(conversationId);
  } catch (error) {
    console.error('Error navigating to conversation:', error);
    window.ChatUtils.handleError('Loading conversation', error);
    // Fallback to hiding UI if load fails
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
    throw error;
  }
}

async function handleNavigationChange() {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');
  const view = urlParams.get('view');
  const projectId = urlParams.get('project');
  if (view === 'projects' || !projectId) {
    log('[handleNavigationChange] View=projects detected or no project ID, showing projects.');
    showProjectListView();
    setTimeout(() => {
      if (window.projectManager?.loadProjects) {
        window.projectManager.loadProjects('all').catch(err => {
          console.error('[handleNavigationChange] Project loading error:', err);
          window.ChatUtils.handleError('Loading projects on navigation', err);
        });
      }
    }, 100);
    return;
  }
  if (projectId) {
    log(`[handleNavigationChange] Project ID=${projectId}, loading project details.`);
    debouncedLoadProject(projectId);
    return;
  }
  if (!await ensureAuthenticated()) {
    log('[handleNavigationChange] Not authenticated, show login message.');
    toggleVisibility(document.getElementById("loginRequiredMessage"), true);
    // Ensure chat UI is hidden if not authenticated
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
    return;
  }
  toggleVisibility(document.getElementById("loginRequiredMessage"), false);
  if (chatId) {
    log(`[handleNavigationChange] ChatId=${chatId}, loading conversation.`);
    await navigateToConversation(chatId);
  } else {
    log('[handleNavigationChange] No chatId, showing empty state.');
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
  }
}

function showProjectListView() {
  if (window.ProjectDashboard?.showProjectList) {
    window.ProjectDashboard.showProjectList();
  } else if (typeof window.showProjectsView === 'function') {
    window.showProjectsView();
  } else {
    console.warn('[showProjectListView] No advanced view management available, using fallback.');
    toggleVisibility(document.getElementById('projectListView'), true);
    toggleVisibility(document.getElementById('projectDetailsView'), false);
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
  document.addEventListener('authStateChanged', handleAuthStateChange);
  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', () => window.dispatchEvent(new Event('resize')));
  if (window.eventHandlers?.init) window.eventHandlers.init();
  else console.warn('[setupEventListeners] Event handlers module not loaded');
}

function refreshAppData() {
  log("[refreshAppData] Refreshing application data after authentication.");
  loadInitialProjects().catch(err => {
    console.error("[refreshAppData] Error loading initial projects:", err);
    window.ChatUtils.handleError('Refreshing initial projects', err);
  });
  loadConversationList().catch(err => {
    console.warn("[refreshAppData] Failed to load conversations:", err);
    window.ChatUtils.handleError('Refreshing conversation list', err);
  });
  loadSidebarProjects().catch(err => {
    console.warn("[refreshAppData] Failed to load sidebar projects:", err);
    window.ChatUtils.handleError('Refreshing sidebar projects', err);
  });
}

let lastKnownAuthState = null;
function handleAuthStateChange(e) {
  const { authenticated, username } = e.detail;
  const stateChanged = authenticated !== lastKnownAuthState;
  lastKnownAuthState = authenticated;
  API_CONFIG.isAuthenticated = authenticated;
  if (window.auth?.updateAuthUI) window.auth.updateAuthUI(authenticated, username);
  if (authenticated) {
    if (stateChanged) {
      log("[AuthStateChange] User authenticated, loading initial data...");
      refreshAppData();
    } else {
      log("[AuthStateChange] Already authenticated, forcing UI refresh.");
      refreshAppData();
    }
  } else {
    log("[AuthStateChange] User logged out, UI cleared.");
    showProjectListView();
    // Ensure chat UI is hidden on logout
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
  }
}

async function initApp() {
  setPhase(AppPhase.BOOT);
  if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r));
  setPhase(AppPhase.DOM_READY);
  setViewportHeight();
  cacheElements();
  setupEventListeners();
  if (window.auth?.init) await window.auth.init();
  setPhase(AppPhase.AUTH_CHECKED);
  // Initialize chat system early to ensure readiness
  if (window.ChatManager?.initializeChat) {
    try {
      await window.ChatManager.initializeChat();
      log("[initApp] Chat system initialized successfully");
    } catch (err) {
      console.error("[initApp] Chat system initialization failed:", err);
      window.ChatUtils.handleError('Chat system initialization', err);
    }
  }

  // Initialize ProjectDashboard if available
  if (window.ProjectDashboard) {
    try {
      log("[initApp] Initializing ProjectDashboard...");
      const dashboard = new window.ProjectDashboard();
      await dashboard.init();
      log("[initApp] ProjectDashboard initialized successfully");
      window.projectDashboard = dashboard;
      document.dispatchEvent(new CustomEvent('projectDashboardInitialized'));
    } catch (err) {
      console.error("[initApp] ProjectDashboard initialization failed:", err);
      window.ChatUtils.handleError('ProjectDashboard initialization', err);
    }
  }

  await handleNavigationChange();
  setPhase(AppPhase.COMPLETE);
  log("[initApp] Application initialized");
  return true;
}

// EXPORTS
window.API_CONFIG = API_CONFIG;
window.SELECTORS = SELECTORS;
window.apiRequest = apiRequest;
window.getBaseUrl = getBaseUrl;
window.ensureAuthenticated = ensureAuthenticated;
window.loadConversationList = loadConversationList;
window.loadSidebarProjects = loadSidebarProjects;
window.isValidUUID = isValidUUID;
window.navigateToConversation = navigateToConversation;

// CENTRAL INITIALIZATION
window.appInitializer = {
  status: 'pending',
  queue: [],
  register: (component) => {
    if (window.appInitializer.status === 'ready') component.init();
    else window.appInitializer.queue.push(component);
  },
  initialize: async () => {
    try {
      log("[appInitializer] Starting centralized initialization");
      await initApp();
      window.appInitializer.status = 'ready';
      window.appInitializer.queue.forEach(c => c.init());
      log("[appInitializer] Application fully initialized");
    } catch (error) {
      console.error("[appInitializer] Initialization error:", error);
      window.ChatUtils?.handleError('App initialization', error) || alert("Failed to initialize. Please refresh the page.");
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.appInitializer.initialize().catch(error => {
    console.error("[DOMContentLoaded] App init error:", error);
    window.ChatUtils?.handleError('App initialization on DOMContentLoaded', error) || alert("Failed to initialize. Please refresh the page.");
  });
  document.dispatchEvent(new CustomEvent('appJsReady'));
});

document.addEventListener('authReady', (evt) => {
  if (evt.detail.authenticated) {
    log("[app.js] 'authReady' => user is authenticated. Forcing initial load of data.");
    refreshAppData();
  } else {
    log("[app.js] 'authReady' => user not authenticated. Display login message if needed.");
    toggleVisibility(document.getElementById('loginRequiredMessage'), true);
  }
});

document.addEventListener('projectSelected', (event) => {
  const projectId = event.detail.projectId;
  if (window.ProjectDashboard?.showProjectDetails) {
    window.ProjectDashboard.showProjectDetails(projectId);
  }
});

document.addEventListener('showProjectList', () => {
  showProjectListView();
  window.history.pushState({}, '', '/?view=projects');
});
