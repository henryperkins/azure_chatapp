/**
 * app.js - Core application initialization
 * Manages the app startup, routing, and global state
 */

// Configuration
const APP_CONFIG = {
  DEBUG: window.location.hostname === 'localhost' || window.location.search.includes('debug=1'),
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
    PROJECT_DETAILS: '/api/projects/{projectId}/'
  },

  // DOM selectors
  SELECTORS: {
    MAIN_SIDEBAR: '#mainSidebar',
    NAV_TOGGLE_BTN: '#navToggleBtn',
    SIDEBAR_PROJECTS: '#sidebarProjects',
    AUTH_BUTTON: '#authButton',
    USER_MENU: '#userMenu',
    PROJECT_LIST_VIEW: '#projectListView',
    PROJECT_DETAILS_VIEW: '#projectDetailsView',
    LOGIN_REQUIRED_MESSAGE: '#loginRequiredMessage'
  }
};

// Global state (reduced)
const appState = {
  initialized: false,
  initializing: true,
  currentPhase: 'boot',
  currentView: null,
  isAuthenticated: false
};

// Pending requests tracking for deduplication
const pendingRequests = new Map();

/**
 * Universal fetch wrapper with authentication handling
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

  const requestPromise = (async () => {
    try {
      // Ensure initial slash
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

      // Handle request body for non-GET/HEAD
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

      // Error handling
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        const error = new Error(errorData.message || `HTTP ${response.status}`);
        error.status = response.status;
        error.data = errorData;

        if (error.status === 401) {
          window.auth.clearTokenState({ source: 'api_401' });
        }

        throw error;
      }

      // 204 No Content
      if (response.status === 204) {
        return null;
      }

      // Parse JSON by default
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

  // Store promise for deduplication
  pendingRequests.set(requestKey, requestPromise);
  return requestPromise;
}

/**
 * Navigate to a specific conversation using the new chat manager
 */
async function navigateToConversation(conversationId) {
  try {
    return await window.chatManager.loadConversation(conversationId);
  } catch (error) {
    console.error('Error navigating to conversation:', error);
    showNotification('Failed to load conversation', 'error');
    throw error;
  }
}

/**
 * Show or hide a DOM element
 */
function toggleElement(selector, show) {
  const element = typeof selector === 'string'
    ? document.querySelector(APP_CONFIG.SELECTORS[selector])
    : selector;

  if (element) {
    element.classList.toggle('hidden', !show);
  }
}

/**
 * Show a notification (fallback to console if no handler)
 */
function showNotification(message, type = 'info', duration = 5000) {
  if (window.notificationHandler?.show) {
    window.notificationHandler.show(message, type, { timeout: duration });
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

/**
 * Load projects list (assumes a projectManager)
 */
async function loadProjects() {
  try {
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
 * Handle navigation based on URL parameters
 */
async function handleNavigationChange() {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get('chatId');
  const view = urlParams.get('view');
  const projectId = urlParams.get('project');

  try {
    appState.isAuthenticated = window.app.state.isAuthenticated;

    if (!appState.isAuthenticated) {
      toggleElement('PROJECT_LIST_VIEW', false);
      toggleElement('PROJECT_DETAILS_VIEW', false);
      toggleElement('LOGIN_REQUIRED_MESSAGE', true);
      return;
    }

    toggleElement('LOGIN_REQUIRED_MESSAGE', false);

    if (view === 'projects') {
      showProjectListView();
      return;
    }

    if (projectId) {
      if (window.projectManager?.loadProjectDetails) {
        await window.projectManager.loadProjectDetails(projectId);
      }

      toggleElement('PROJECT_LIST_VIEW', false);
      toggleElement('PROJECT_DETAILS_VIEW', true);
      return;
    }

    if (chatId) {
      // Navigate to existing conversation
      await navigateToConversation(chatId);
      return;
    }

    // Default view is the project list
    showProjectListView();
  } catch (error) {
    console.error('Navigation error:', error);
    showNotification('Navigation error: ' + error.message, 'error');
  }
}

/**
 * Show the project list view
 */
function showProjectListView() {
  appState.currentView = 'projects';
  toggleElement('PROJECT_DETAILS_VIEW', false);
  toggleElement('PROJECT_LIST_VIEW', true);

  if (appState.isAuthenticated) {
    loadProjects().catch(error => {
      console.error('[App] Error loading projects:', error);
      showNotification('Failed to load projects', 'error');
    });
  }
}

/**
 * Initialize the application
 */
async function initApp() {
  console.log('[App] Starting initialization...');
  appState.initializing = true;
  appState.currentPhase = 'boot';

  // Wait for DOM readiness if needed
  if (document.readyState === 'loading') {
    await new Promise(resolve =>
      document.addEventListener('DOMContentLoaded', resolve, { once: true })
    );
  }

  appState.currentPhase = 'dom_ready';

  // Initialize authentication with proper dependency check
  try {
    // Wait for auth module to be available
    const authTimeout = setTimeout(() => {
      console.warn('[App] Auth module not available after timeout');
    }, APP_CONFIG.TIMEOUTS.AUTH_CHECK);

    while (!window.auth) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    clearTimeout(authTimeout);

    await window.auth.init();
  } catch (error) {
    console.error('[App] Auth initialization failed:', error);
  }

  appState.currentPhase = 'auth_checked';

  // Safe authentication state access
  if (window.auth) {
    appState.isAuthenticated = window.auth.isAuthenticated();
  } else {
    appState.isAuthenticated = false;
    console.warn('[App] Auth module unavailable, defaulting to unauthenticated state');
  }

  // Initialize event system FIRST
  try {
    while (!window.eventHandlers) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    window.eventHandlers.init();
  } catch (error) {
    console.error('[App] Failed to initialize event handlers:', error);
    throw error;
  }

  // Initialize model configuration UI if available
  if (window.uiRenderer?.setupModelDropdown) {
    await window.uiRenderer.setupModelDropdown();
    window.uiRenderer.setupMaxTokensUI();
    window.uiRenderer.setupVisionUI();
  }

  // Initialize core modules in proper sequence with dependency checks
  const initSequence = [
    // Then modal manager
    async () => {
      while (!window.modalManager) await new Promise(resolve => setTimeout(resolve, 100));
      window.modalManager.init();
    },
    // Then project system
    async () => {
      while (!window.projectManager) await new Promise(resolve => setTimeout(resolve, 100));
      await window.projectManager.init();
    },
    // Then sidebar with active tab
    async () => {
      while (!window.sidebar) await new Promise(resolve => setTimeout(resolve, 100));
      window.sidebar.init();
      const defaultTab = localStorage.getItem('sidebarActiveTab') || 'recent';
      window.sidebar.activateTab(defaultTab);
    },
    // Then other components
    () => window.chatExtensions?.initChatExtensions?.(),
    () => window.KnowledgeBaseComponent &&
      (window.knowledgeBaseComponent = new window.KnowledgeBaseComponent()),
    () => window.chatManager?.initialize?.(),
    () => window.projectDashboard?.init?.()
  ];

  // Execute initialization sequence with error handling
  for (const initFn of initSequence) {
    try {
      await initFn();
    } catch (error) {
      console.error('[App] Initialization error:', error);
    }
  }

  // Load initial data if authenticated
  if (appState.isAuthenticated) {
    try {
      if (window.projectManager?.loadProjects) {
        await window.projectManager.loadProjects('all');
      }
    } catch (error) {
      console.error('[App] Error loading initial data:', error);
    }
  }

  // Perform initial navigation
  await handleNavigationChange();

  appState.initializing = false;
  appState.initialized = true;
  appState.currentPhase = 'complete';
  console.log('[App] Initialization complete');
  return true;
}

/**
 * Listen for authentication state changes
 */
if (window.auth?.AuthBus) {
  window.auth.AuthBus.addEventListener('authStateChanged', event => {
    const { authenticated } = event.detail || {};
    appState.isAuthenticated = authenticated;

    const authButton = document.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON);
    const userMenu = document.querySelector(APP_CONFIG.SELECTORS.USER_MENU);

    if (authenticated) {
      if (authButton) authButton.classList.add('hidden');
      if (userMenu) userMenu.classList.remove('hidden');
    } else {
      if (authButton) authButton.classList.remove('hidden');
      if (userMenu) userMenu.classList.add('hidden');
      showProjectListView();
    }
  });
}

/**
 * Register DOM listeners
 */
function registerAppListeners() {
  // Handle back/forward navigation
  window.addEventListener('popstate', handleNavigationChange);
}

// Start initialization if DOM is already ready
if (document.readyState !== 'loading') {
  initApp().catch(handleInitError);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    initApp().catch(handleInitError);
  });
}

function handleInitError(error) {
  console.error('[App] Critical initialization error:', error);

  // Send detailed diagnostics to console
  console.debug('[App] Diagnostics:', {
    authAvailable: !!window.auth,
    appState: JSON.stringify(appState),
    documentReady: document.readyState,
    eventHandlersAvailable: !!window.eventHandlers
  });

  showNotification('Application failed to initialize. Please refresh.', 'error');
}

// Consolidate global exports
window.app = {
  apiRequest,
  navigateToConversation,
  showProjectListView,
  showNotification,
  state: appState,
  initialize: initApp,
  loadProjects,
  getProjectId: () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('project') || localStorage.getItem('selectedProjectId');
  }
};

// Deprecated globals - phase these out over time
window.showNotification = showNotification;

export default window.app;
