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
    console.warn("[app.js] eventHandlers.debounce not found. Using custom fallback debounce implementation.");
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
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

async function loadProjects() {
  try {
    const isAuthenticated = await ensureAuthenticated();
    if (!isAuthenticated) {
      log("[App] Not authenticated, showing login prompt");
      toggleVisibility(document.getElementById('loginRequiredMessage'), true);
      toggleVisibility(document.getElementById('projectManagerPanel'), false);
      return;
    }

    // Hide login message, show project container when authenticated
    toggleVisibility(document.getElementById('loginRequiredMessage'), false);
    toggleVisibility(document.getElementById('projectManagerPanel'), true);
    toggleVisibility(document.getElementById('projectListView'), true);

    // Ensure components are initialized
    await ensureComponentsInitialized();

    // Load projects through projectManager
    if (window.projectManager?.loadProjects) {
      log("[App] Loading projects through projectManager...");
      const projects = await window.projectManager.loadProjects('all');
      log(`[App] Loaded ${projects.length} projects`);

      // Render projects through the component
      if (window.projectListComponent) {
        window.projectListComponent.renderProjects(projects);
      }

      // Handle empty project list
      if (projects.length === 0) {
        toggleVisibility(document.getElementById('noProjectsMessage'), true);
      }
    }
  } catch (err) {
    console.error("[App] Error loading projects:", err);
    window.ChatUtils.handleError('Loading projects', err);
  } finally {
    // Clear loading flag
    window.__projectLoadingInProgress = false;
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
      window.ChatUtils.showNotification("Please select a project first", "error");
      // Redirect to project selection
      window.history.pushState({}, '', '/?view=projects');
      toggleVisibility(getEl('CHAT_UI'), false);
      toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
      return false;
    }

    // Ensure ChatManager is available
    await ensureChatManagerAvailable().catch(err => {
      console.error('Failed to ensure ChatManager availability:', err);
      throw err;
    });

    if (window.ChatManager && window.ChatManager.loadConversation) {
      // Delegate UI visibility to ChatInterface after initialization
      if (window.chatInterface && window.chatInterface.initialized) {
        await window.chatInterface.ui.ensureChatContainerVisible(window.ChatUtils.getProjectId() !== null);
      } else {
        // Fallback if not initialized
        toggleVisibility(getEl('CHAT_UI'), true);
        toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), false);
      }
      return await window.ChatManager.loadConversation(conversationId);
    } else {
      throw new Error('ChatManager not properly initialized');
    }
  } catch (error) {
    console.error('Error navigating to conversation:', error);
    window.ChatUtils.handleError('Loading conversation', error);
    toggleVisibility(getEl('CHAT_UI'), false);
    toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
    throw error;
  }
}

// Helper function to ensure ChatManager is available - Updated for robustness
async function ensureChatManagerAvailable() {
  if (!window.ChatManager) {
    console.log('Waiting for ChatManager to become available...');

    const chatCoreScript = document.querySelector('script[src*="chat-core.js"]');
    if (!chatCoreScript) {
      console.log('Loading chat-core.js dynamically');
      await loadScript('/static/js/chat-core.js').catch(err => {
        console.error('Failed to load chat-core.js:', err);
        window.ChatUtils.handleError('Loading chat-core.js', err);
      });
    }

    // Wait for ChatManager to be defined with a timeout and event listener
    return new Promise((resolve, reject) => {
      if (window.ChatManager) {
        resolve();
        return;
      }

      document.addEventListener('chatManagerReady', () => {
        console.log('ChatManager is now available via event');
        resolve();
      }, { once: true });

      const checkInterval = setInterval(() => {
        if (window.ChatManager) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        console.error('Timeout waiting for ChatManager');
        reject(new Error('ChatManager initialization timed out'));
      }, 10000); // Increased timeout for more patience
    });
  }
  return Promise.resolve();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function handleNavigationChange() {
  try {
    if (window.__appInitializing) {
      console.log("App still initializing, waiting before handling navigation...");
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!window.__appInitializing) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        setTimeout(() => {
          clearInterval(checkInterval);
          console.warn("Timeout waiting for app initialization during navigation");
          resolve();
        }, 10000);
      });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const view = urlParams.get('view');
    const projectId = urlParams.get('project');

    // Get references to the main views
    const projectListView = document.getElementById('projectListView');
    const projectDetailsView = document.getElementById('projectDetailsView');

    if (view === 'projects' || !projectId) {
      log('[handleNavigationChange] View=projects detected or no project ID, showing projects.');
      // Show list view, hide details view
      if (projectListView) projectListView.classList.remove('hidden');
      if (projectDetailsView) projectDetailsView.classList.add('hidden');
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
      // Show details view, hide list view
      if (projectListView) projectListView.classList.add('hidden');
      if (projectDetailsView) projectDetailsView.classList.remove('hidden');
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
      await ensureChatManagerAvailable().catch(err => {
        console.warn('ChatManager not ready, deferring conversation loading:', err);
        window.pendingChatId = chatId;
      });

      if (window.ChatManager?.loadConversation) {
        await navigateToConversation(chatId);
      } else {
        console.warn('ChatManager not ready, deferring conversation loading');
        window.pendingChatId = chatId;
        // Set up a listener to load pending chat ID when ChatManager is ready
        document.addEventListener('chatManagerReady', async () => {
          if (window.pendingChatId) {
            console.log(`ChatManager ready, loading pending chat ID: ${window.pendingChatId}`);
            await navigateToConversation(window.pendingChatId);
            window.pendingChatId = null;
          }
        }, { once: true });
      }
    } else {
      log('[handleNavigationChange] No chatId, showing empty state.');
      toggleVisibility(getEl('CHAT_UI'), false);
      toggleVisibility(getEl('NO_CHAT_SELECTED_MESSAGE'), true);
    }
  } catch (error) {
    console.error('Navigation error:', error);
    window.ChatUtils.handleError('Navigation change', error);
  }
}

// Define a global flag to track if showProjectListView is in progress
let _showingProjectListView = false;

async function showProjectListView() {
  if (_showingProjectListView) {
    console.log("[App] showProjectListView already in progress, skipping...");
    return;
  }
  _showingProjectListView = true;

  try {
    if (!await ensureAuthenticated()) {
      log("[showProjectListView] Not authenticated");
      return;
    }
    // Avoid inline scripts or unsafe DOM updates
    const projectPanel = document.getElementById('projectManagerPanel');
    if (projectPanel) {
      projectPanel.classList.remove('hidden');
      log("[showProjectListView] Showing project panel");
    }
    // Load projects without triggering unsafe operations
    if (window.dashboardUtilsReady || (typeof window.showProjectsView === 'function')) {
      await loadProjects();
    } else {
      console.warn("[showProjectListView] dashboardUtils not ready, delaying project loading");
      setTimeout(() => loadProjects(), 500); // Delay until utils are potentially ready
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
  document.addEventListener('authStateChanged', handleAuthStateChange);
  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', () => window.dispatchEvent(new Event('resize')));
  if (window.eventHandlers?.init) window.eventHandlers.init();
  else console.warn('[setupEventListeners] Event handlers module not loaded');
}

function refreshAppData() {
  // Guard against multiple concurrent refreshes
  if (API_CONFIG.authCheckInProgress) {
    log("[refreshAppData] Auth check in progress, deferring refresh");
    return;
  }

  log("[refreshAppData] Refreshing application data after authentication.");

  // First ensure component initialization
  ensureComponentsInitialized()
    .then(() => {
      // Single source of truth for project loading
      if (window.projectManager?.loadProjects) {
        return window.projectManager.loadProjects('all');
      } else {
        return Promise.reject(new Error('projectManager not available'));
      }
    })
    .then(projects => {
      log(`[refreshAppData] Loaded ${projects.length} projects`);

      // Direct rendering instead of relying on events
      if (window.projectListComponent?.renderProjects) {
        window.projectListComponent.renderProjects(projects);
        log("[refreshAppData] Rendered projects through projectListComponent");
      }

      // Also refresh conversations and sidebar projects
      return Promise.all([
        loadConversationList().catch(err => {
          console.warn("[refreshAppData] Failed to load conversations:", err);
          window.ChatUtils.handleError('Refreshing conversation list', err);
          return [];
        })
      ]);
    })
    .catch(err => {
      console.error("[refreshAppData] Error refreshing data:", err);
      window.ChatUtils.handleError('Refreshing application data', err);
    });
}

async function ensureComponentsInitialized() {
  // Check if project components are already initialized
  if (window.projectListComponent) {
    return Promise.resolve();
  }

  log("[ensureComponentsInitialized] Waiting for component initialization...");

  // Try to initialize components if needed
  if (typeof window.ProjectListComponent === 'function' && !window.projectListComponent) {
    try {
      window.projectListComponent = new window.ProjectListComponent({
        elementId: "sidebarProjects",
        onViewProject: (projectId) => {
          if (window.ProjectDashboard?.showProjectDetails) {
            window.ProjectDashboard.showProjectDetails(projectId);
          }
        }
      });
      log("[ensureComponentsInitialized] Created projectListComponent instance");
    } catch (err) {
      console.warn("[ensureComponentsInitialized] Error creating projectListComponent:", err);
    }
  }

  // Return a promise that resolves when components are ready or times out
  return new Promise(resolve => {
    let checks = 0;
    const maxChecks = 10;
    const checkInterval = setInterval(() => {
      if (window.projectListComponent || ++checks >= maxChecks) {
        clearInterval(checkInterval);
        log(`[ensureComponentsInitialized] Components ready (or timed out after ${checks} checks)`);
        resolve();
      }
    }, 100);
  });
}

let lastKnownAuthState = null;
function handleAuthStateChange(e) {
  const { authenticated, username } = e.detail;
  const stateChanged = authenticated !== lastKnownAuthState;
  lastKnownAuthState = authenticated;
  API_CONFIG.isAuthenticated = authenticated;

  // Update auth UI if available
  if (window.auth?.updateAuthUI) window.auth.updateAuthUI(authenticated, username);

  if (authenticated) {
    // Prevent redundant data loads when auth check is already in progress
    if (API_CONFIG.authCheckInProgress) {
      log("[AuthStateChange] Auth check in progress, skipping data refresh");
      return;
    }

    if (stateChanged) {
      log("[AuthStateChange] User authenticated, loading initial data...");
      refreshAppData();
    } else {
      // Don't force refresh when state hasn't changed
      log("[AuthStateChange] Already authenticated, no state change, skipping UI refresh.");
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

  // Wait for dashboardUtilsReady to ensure showProjectsView is defined
  if (!window.dashboardUtilsReady) {
    console.log("[initApp] Waiting for dashboardUtilsReady...");
    await new Promise(resolve => {
      document.addEventListener('dashboardUtilsReady', () => {
        console.log("[initApp] dashboardUtilsReady received");
        resolve();
      }, { once: true });
      // Timeout in case event never fires
      setTimeout(() => {
        console.warn("[initApp] Timeout waiting for dashboardUtilsReady, proceeding anyway");
        resolve();
      }, 5000);
    });
  } else {
    console.log("[initApp] dashboardUtilsReady already set, proceeding.");
  }

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

  // Mark initialization as complete to allow UI operations
  window.__appInitializing = false;

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
    if (window.appInitializer.status === 'initializing' || window.appInitializer.status === 'ready') {
      console.log("[appInitializer] Initialization already in progress or complete, skipping...");
      return;
    }
    window.appInitializer.status = 'initializing';

    try {
      log("[appInitializer] Starting centralized initialization");
      await initApp();
      window.appInitializer.status = 'ready';
      window.appInitializer.queue.forEach(c => c.init());
      log("[appInitializer] Application fully initialized");
    } catch (error) {
      console.error("[appInitializer] Initialization error:", error);
      window.ChatUtils?.handleError('App initialization', error) || alert("Failed to initialize. Please refresh the page.");
      window.appInitializer.status = 'error';
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
