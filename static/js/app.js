/**
 * app.js - Core application initialization
 * Manages the app startup, routing, and global state
 */

// Configuration
const APP_CONFIG = {
  // Timeout values (ms)
  TIMEOUTS: {
    INITIALIZATION: 10000,
    AUTH_CHECK: 5000,
    API_REQUEST: 8000,
    COMPONENT_LOAD: 5000
  },

  // API endpoints
  API_ENDPOINTS: {
    AUTH_VERIFY: '/api/auth/verify/',
    PROJECTS: '/api/projects/',
    PROJECT_DETAILS: '/api/projects/{projectId}/',
    PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations/',
    PROJECT_FILES: '/api/projects/{projectId}/files/'
  },

  // DOM selectors
  SELECTORS: {
    MAIN_SIDEBAR: '#mainSidebar',
    NAV_TOGGLE_BTN: '#navToggleBtn',
    SIDEBAR_PROJECTS: '#sidebarProjects',
    SIDEBAR_CONVERSATIONS: '#sidebarConversations',
    AUTH_BUTTON: '#authButton',
    USER_MENU: '#userMenu',
    CHAT_UI: '#globalChatUI',
    PROJECT_LIST_VIEW: '#projectListView',
    PROJECT_DETAILS_VIEW: '#projectDetailsView',
    NO_CHAT_SELECTED_MESSAGE: '#noChatSelectedMessage',
    LOGIN_REQUIRED_MESSAGE: '#loginRequiredMessage'
  }
};

// Global state
const appState = {
  initialized: false,
  initializing: true,
  currentPhase: 'boot',
  currentView: null,
  currentProjectId: null,
  currentConversationId: null,
  isAuthenticated: false
};

// Pending requests tracking for deduplication
const pendingRequests = new Map();

/**
 * Fetch wrapper with authentication handling
 */
async function apiRequest(endpoint, method = 'GET', data = null, options = {}) {
  // Deduplicate identical requests
  const requestKey = `${method}:${endpoint}:${JSON.stringify(data)}`;
  if (pendingRequests.has(requestKey)) {
    return pendingRequests.get(requestKey);
  }

  // Set up request controller and timeout
  const controller = options.signal?.controller || new AbortController();
  const timeoutMs = options.timeout || APP_CONFIG.TIMEOUTS.API_REQUEST;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Create the Promise
  const requestPromise = (async () => {
    try {
      // Clean up endpoint
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

      // Build query params for GET requests
      let finalUrl = cleanEndpoint;
      if (data && ['GET', 'HEAD'].includes(method.toUpperCase())) {
        const queryParams = new URLSearchParams();
        Object.entries(data).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach(v => queryParams.append(key, v));
          } else {
            queryParams.append(key, value);
          }
        });

        finalUrl += (cleanEndpoint.includes('?') ? '&' : '?') + queryParams.toString();
      }

      // Get CSRF token
      const csrfToken = await window.auth.getCSRFTokenAsync();

      // Build request options
      const requestOptions = {
        method: method.toUpperCase(),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
        signal: controller.signal
      };

      // Handle body for non-GET requests
      if (data && !['GET', 'HEAD'].includes(method.toUpperCase())) {
        if (data instanceof FormData) {
          requestOptions.body = data;
          delete requestOptions.headers['Content-Type'];
        } else {
          requestOptions.body = JSON.stringify(data);
        }
      }

      // Make the request
      const response = await fetch(finalUrl, requestOptions);

      // Handle errors
      if (!response.ok) {
        const errorData = await response.json().catch(() => {
          return { message: response.statusText };
        });

        const error = new Error(errorData.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.data = errorData;

        if (error.status === 401) {
          window.auth.clearTokenState({ source: 'api_401' });
        }

        throw error;
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return null;
      }

      // Parse JSON response
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

  // Store the promise for deduplication
  pendingRequests.set(requestKey, requestPromise);
  return requestPromise;
}

/**
 * Get proper UUID from string or other formats
 */
function validateUUID(uuid) {
  if (!uuid) return null;

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(uuid)) {
    return uuid;
  }

  return null;
}

/**
 * Get project ID from various sources
 */
function getProjectId() {
  // From localStorage
  const storedId = localStorage.getItem('selectedProjectId');
  if (storedId && validateUUID(storedId)) {
    return storedId;
  }

  // From URL path
  const pathMatch = window.location.pathname.match(/\/projects\/([0-9a-f-]+)/i);
  if (pathMatch && pathMatch[1] && validateUUID(pathMatch[1])) {
    return pathMatch[1];
  }

  // From URL query
  const urlParams = new URLSearchParams(window.location.search);
  const queryId = urlParams.get('projectId');
  if (queryId && validateUUID(queryId)) {
    return queryId;
  }

  return null;
}

/**
 * Load the list of conversations
 */
async function loadConversationList() {
  const projectId = getProjectId();
  if (!projectId) {
    return [];
  }

  try {
    const url = APP_CONFIG.API_ENDPOINTS.PROJECT_CONVERSATIONS.replace('{projectId}', projectId);
    const data = await apiRequest(url);

    // Update sidebar with conversations
    if (window.uiRenderer?.renderConversations) {
      window.uiRenderer.renderConversations(data);
    }

    return data;
  } catch (error) {
    if (error.status === 404) {
      // Project not found, reset selection
      localStorage.removeItem('selectedProjectId');
    }

    if (window.uiRenderer?.renderConversations) {
      window.uiRenderer.renderConversations({ data: { conversations: [] } });
    }

    return [];
  }
}

/**
 * Load projects list
 */
async function loadProjects() {
  try {
    const isAuthenticated = await window.auth.checkAuth();
    if (!isAuthenticated) {
      toggleElement('LOGIN_REQUIRED_MESSAGE', true);
      toggleElement('PROJECT_LIST_VIEW', false);
      return [];
    }

    toggleElement('LOGIN_REQUIRED_MESSAGE', false);
    toggleElement('PROJECT_LIST_VIEW', true);

    if (window.projectManager?.loadProjects) {
      return await window.projectManager.loadProjects('all');
    }

    return [];
  } catch (error) {
    console.error('[App] Error loading projects:', error);
    return [];
  }
}

/**
 * Navigate to a specific conversation
 */
async function navigateToConversation(conversationId) {
  if (!validateUUID(conversationId)) {
    throw new Error('Invalid conversation ID');
  }

  // Update URL
  window.history.pushState({}, '', `/?chatId=${conversationId}`);

  try {
    const projectId = getProjectId();
    if (!projectId) {
      showNotification("Please select a project first", "error");
      window.history.pushState({}, '', '/?view=projects');
      toggleElement('CHAT_UI', false);
      toggleElement('NO_CHAT_SELECTED_MESSAGE', true);
      return false;
    }

    if (window.ChatManager?.loadConversation) {
      appState.currentConversationId = conversationId;
      return await window.ChatManager.loadConversation(conversationId);
    } else {
      throw new Error('Chat manager not available');
    }
  } catch (error) {
    console.error('Error navigating to conversation:', error);
    toggleElement('CHAT_UI', false);
    toggleElement('NO_CHAT_SELECTED_MESSAGE', true);
    throw error;
  }
}

/**
 * Toggle element visibility
 */
function toggleElement(selector, show) {
  const element = typeof selector === 'string' ?
    document.querySelector(APP_CONFIG.SELECTORS[selector]) : selector;

  if (element) {
    element.classList.toggle('hidden', !show);
  }
}

/**
 * Show notification
 */
function showNotification(message, type = 'info', duration = 5000) {
  if (window.notificationHandler?.show) {
    window.notificationHandler.show(message, type, { timeout: duration });
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

/**
 * Handle navigation changes
 */
async function handleNavigationChange() {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');
  const view = urlParams.get('view');
  const projectId = urlParams.get('project');

  try {
    const isAuthenticated = await window.auth.checkAuth();
    appState.isAuthenticated = isAuthenticated;

    if (!isAuthenticated) {
      toggleElement('CHAT_UI', false);
      toggleElement('PROJECT_LIST_VIEW', false);
      toggleElement('PROJECT_DETAILS_VIEW', false);
      toggleElement('NO_CHAT_SELECTED_MESSAGE', false);
      toggleElement('LOGIN_REQUIRED_MESSAGE', true);
      return;
    }

    toggleElement('LOGIN_REQUIRED_MESSAGE', false);

    if (view === 'projects') {
      showProjectListView();
      return;
    }

    if (projectId) {
      appState.currentProjectId = projectId;
      localStorage.setItem('selectedProjectId', projectId);

      if (window.projectManager?.loadProjectDetails) {
        await window.projectManager.loadProjectDetails(projectId);
      }

      toggleElement('PROJECT_LIST_VIEW', false);
      toggleElement('PROJECT_DETAILS_VIEW', true);
      return;
    }

    if (chatId) {
      await navigateToConversation(chatId);
      return;
    }

    // Default: show project list
    showProjectListView();
  } catch (error) {
    console.error('Navigation error:', error);
    showNotification('Navigation error: ' + error.message, 'error');
  }
}

/**
 * Show project list view
 */
function showProjectListView() {
  appState.currentView = 'projects';

  toggleElement('PROJECT_DETAILS_VIEW', false);
  toggleElement('CHAT_UI', false);
  toggleElement('NO_CHAT_SELECTED_MESSAGE', false);
  toggleElement('PROJECT_LIST_VIEW', true);

  // Load projects if authenticated
  if (appState.isAuthenticated) {
    loadProjects().catch(error => {
      console.error('[App] Error loading projects:', error);
      showNotification('Failed to load projects', 'error');
    });
  }
}

/**
 * Refresh all app data
 */
function refreshAppData() {
  console.log('[App] Refreshing application data...');

  if (window.projectManager?.loadProjects) {
    window.projectManager.loadProjects('all')
      .then(() => loadConversationList())
      .catch(error => {
        console.error('[App] Error refreshing data:', error);
      });
  }
}

/**
 * Initialize application
 */
async function initApp() {
  console.log('[App] Starting initialization...');
  appState.initializing = true;
  appState.currentPhase = 'boot';

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  appState.currentPhase = 'dom_ready';

  // Initialize auth
  try {
    await window.auth.init();
  } catch (error) {
    console.error('[App] Auth initialization failed:', error);
  }

  appState.currentPhase = 'auth_checked';
  appState.isAuthenticated = window.auth.isAuthenticated();

  // Initialize components
  try {
    if (window.eventHandlers?.init) {
      await window.eventHandlers.init();
    }

    if (window.sidebar) {
      window.sidebar.activateTab(localStorage.getItem('sidebarActiveTab') || 'recent');
    }

    if (window.ChatManager?.initializeChat) {
      await window.ChatManager.initializeChat();
    }
  } catch (error) {
    console.error('[App] Component initialization failed:', error);
  }

  // Process navigation based on URL
  await handleNavigationChange();

  // Mark initialization complete
  appState.initializing = false;
  appState.initialized = true;
  appState.currentPhase = 'complete';

  // Refresh data if authenticated
  if (appState.isAuthenticated) {
    refreshAppData();
  }

  console.log('[App] Initialization complete');
  return true;
}

// Register auth state change listener
if (window.auth?.AuthBus) {
  window.auth.AuthBus.addEventListener('authStateChanged', event => {
    const { authenticated } = event.detail || {};
    appState.isAuthenticated = authenticated;

    const authButton = document.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON);
    const userMenu = document.querySelector(APP_CONFIG.SELECTORS.USER_MENU);

    if (authenticated) {
      if (authButton) authButton.classList.add('hidden');
      if (userMenu) userMenu.classList.remove('hidden');

      // Refresh data
      if (appState.initialized) {
        refreshAppData();
      }
    } else {
      if (authButton) authButton.classList.remove('hidden');
      if (userMenu) userMenu.classList.add('hidden');

      // Show project list (will display login required)
      showProjectListView();
    }
  });
}

// Set up event listeners
document.addEventListener('DOMContentLoaded', () => {
  // Start initialization
  initApp().catch(error => {
    console.error('[App] Critical initialization error:', error);
    showNotification('Application failed to initialize. Please refresh.', 'error');
  });

  // Listen for route changes
  window.addEventListener('popstate', handleNavigationChange);
});

// Export to window
window.app = {
  apiRequest,
  getProjectId,
  loadConversationList,
  navigateToConversation,
  showProjectListView,
  refreshAppData,
  showNotification,
  state: appState
};

export default window.app;
