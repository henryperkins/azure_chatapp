/**
 * app.js - Core application initialization
 * Manages the app startup, routing, and global state
 */

/**
 * Robust dependency management system
 * Replaces the polling-based waitForDependency approach
 */
const DependencySystem = {
  // Track registered modules
  modules: new Map(),

  // Track module states (unloaded, loading, loaded, error)
  states: new Map(),

  // Store callbacks waiting for modules
  waiters: new Map(),

  // Register a module when it's ready
  register(name, instance, dependencies = []) {
    console.log(`[DependencySystem] Registering module: ${name}`);

    this.modules.set(name, instance);
    this.states.set(name, 'loaded');

    // Notify any waiters
    this._notifyWaiters(name);

    return instance;
  },

  // Notify anyone waiting for this module
  _notifyWaiters(name) {
    if (!this.waiters.has(name)) return;

    this.waiters.get(name).forEach(callback => {
      try {
        callback(this.modules.get(name));
      } catch (error) {
        console.error(`[DependencySystem] Error in waiter callback for ${name}:`, error);
      }
    });

    // Clear waiters for this module
    this.waiters.delete(name);
  },

  // Wait for a module to be available
  waitFor(names, callback, timeout = 5000) {
    const namesArray = Array.isArray(names) ? names : [names];
    const missingModules = namesArray.filter(name => !this.modules.has(name));

    if (missingModules.length === 0) {
      // All modules are available, call immediately
      const modules = namesArray.map(name => this.modules.get(name));
      callback(...modules);
      return;
    }

    // Create timeout
    const timeoutId = setTimeout(() => {
      missingModules.forEach(name => {
        if (!this.modules.has(name)) {
          console.error(`[DependencySystem] Timeout waiting for module: ${name}`);
          this.states.set(name, 'error');
          // Clean up any waiters
          if (this.waiters.has(name)) {
            this.waiters.delete(name);
          }
        }
      });
    }, timeout);

    // Register waiters for each missing module
    missingModules.forEach(name => {
      if (!this.waiters.has(name)) {
        this.waiters.set(name, []);
      }

      // Add our specialized callback that handles multiple modules
      this.waiters.get(name).push(() => {
        // Check if all required modules are now available
        const stillMissing = namesArray.filter(n => !this.modules.has(n));
        if (stillMissing.length === 0) {
          // All dependencies ready
          clearTimeout(timeoutId);
          const modules = namesArray.map(n => this.modules.get(n));
          callback(...modules);
        }
      });
    });
  }
};

// Add to window for global access
window.DependencySystem = DependencySystem;

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
 * Make an API request with standardized error handling and CSRF protection
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options
 * @param {boolean} [skipCache=false] - Whether to skip the pending request cache
 * @returns {Promise<any>} - Parsed JSON response
 */
async function apiRequest(url, options = {}, skipCache = false) {
  const requestKey = `${options.method || 'GET'}-${url}-${JSON.stringify(options.body || {})}`;

  // Deduplicate in-flight requests unless explicitly skipped
  if (!skipCache && pendingRequests.has(requestKey)) {
    return pendingRequests.get(requestKey);
  }

  // Set up default headers
  options.headers = options.headers || {};

  // Add CSRF token if available
  const csrfToken = document.getElementById('csrfToken')?.getAttribute('content');
  if (csrfToken) {
    options.headers['X-CSRFToken'] = csrfToken;
  }

  // Ensure JSON content type for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(options.method) && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }

  // Convert body to JSON string if it's an object
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.body = JSON.stringify(options.body);
  }

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, APP_CONFIG.TIMEOUTS.API_REQUEST);

  options.signal = controller.signal;

  // Create the promise
  const requestPromise = (async () => {
    try {
      const response = await fetch(url, options);
      clearTimeout(timeout);

      // Remove from pending requests
      if (!skipCache) {
        pendingRequests.delete(requestKey);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(errorData.message || `API request failed with status ${response.status}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
      }

      // Check if response is empty
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }

      return await response.text();
    } catch (error) {
      // Clean up pending request tracking
      if (!skipCache) {
        pendingRequests.delete(requestKey);
      }

      if (error.name === 'AbortError') {
        throw new Error(`API request timed out after ${APP_CONFIG.TIMEOUTS.API_REQUEST}ms`);
      }

      throw error;
    }
  })();

  // Store the promise in pending requests
  if (!skipCache) {
    pendingRequests.set(requestKey, requestPromise);
  }

  return requestPromise;
}

/**
 * Initialize the application
 */
async function initApp() {
  console.log('[App] Starting initialization...');
  appState.initializing = true;
  appState.currentPhase = 'boot';

  if (document.readyState === 'loading') {
    await new Promise(resolve =>
      document.addEventListener('DOMContentLoaded', resolve, { once: true })
    );
  }

  appState.currentPhase = 'dom_ready';

  try {
    // Start the initialization sequence
    await initializeComponents();

    // Load initial data if authenticated
    if (appState.isAuthenticated) {
      console.log('[App] User authenticated, loading initial project data...');
      try {
        if (window.projectManagerAPI?.loadProjects) {
          const currentFilter = localStorage.getItem('projectFilter') || 'all';
          await window.projectManagerAPI.loadProjects(currentFilter);
          console.log('[App] Initial project data loaded.');
        }
      } catch (error) {
        console.error('[App] Error loading initial project data:', error);
        showNotification('Failed to load initial project data', 'error');
      }
    }

    // Perform initial navigation
    await handleNavigationChange();
    console.log('[App] Initial navigation handled.');

    // Register global listeners
    registerAppListeners();
    console.log('[App] Global listeners registered.');

    return true;
  } catch (error) {
    console.error('[App] Initialization failed:', error);
    showNotification('Application failed to initialize. Please refresh.', 'error');
    throw error;
  }
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
if (!window.projectManager) {
  window.projectManager = window.projectManagerAPI;
  console.log('[App] Bound projectManagerAPI to window.projectManager');
}

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
    // Use authenticated state directly from auth or appState
    appState.isAuthenticated = window.auth?.isAuthenticated() ?? appState.isAuthenticated;

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
 * Single initialization function that dynamically adapts to dependencies
 */
async function initializeComponents() {
  // 1. Initialize event handlers first if needed
  DependencySystem.waitFor('eventHandlers', (eventHandlers) => {
    if (typeof eventHandlers.init === 'function') {
      eventHandlers.init();
      console.log('[App] Event handlers initialized');
    }

    // 2. Initialize modal manager
    DependencySystem.waitFor('modalManager', (modalManager) => {
      if (typeof modalManager.init === 'function') {
        modalManager.init();
        console.log('[App] ModalManager initialized');
      }

      if (window.projectModal?.init) {
        window.projectModal.init();
        console.log('[App] ProjectModal initialized');
      }

  // 3. Initialize authentication system
  DependencySystem.waitFor('auth', async (auth) => {
      auth.init().then(() => {
          // IMPORTANT: Update app state with the current auth state AFTER init completes
          appState.isAuthenticated = auth.isAuthenticated();
          appState.username = auth.getCurrentUser();
          appState.currentPhase = 'auth_checked';
          console.log('[App] Auth initialization completed. User authenticated:', appState.isAuthenticated);

          // Add a listener for auth state changes to keep app.state in sync
          window.auth.AuthBus.addEventListener('authStateChanged', event => {
              const { authenticated, username } = event.detail;

              // Keep app state synchronized with auth state
              appState.isAuthenticated = authenticated;
              appState.username = username;

              console.log(`[App] Auth state updated: authenticated=${authenticated}, username=${username}`);

              // Update UI or trigger re-renders as needed
              handleNavigationChange();
          });

          // Wait for authReady event or definitive auth state
          if (!appState.isAuthenticated) {
              console.log('[App] Waiting for definitive auth state...');
              // Use a callback approach instead of await since we're in a non-async callback
              new Promise(resolve => {
                  const authReadyHandler = () => {
                      appState.isAuthenticated = auth.isAuthenticated();
                      window.auth.AuthBus.removeEventListener('authReady', authReadyHandler);
                      resolve();
                  };
                  window.auth.AuthBus.addEventListener('authReady', authReadyHandler);
                  // Safety timeout
                  setTimeout(resolve, 5000);
              }).then(() => {
                  // Initialize UI components after auth state is resolved
                  initializeUIComponents();
              });
          } else {
              // Auth already confirmed, initialize UI directly
              initializeUIComponents();
          }

          // Function to initialize UI components
          function initializeUIComponents() {
              const uiComponents = ['sidebar', 'projectDashboard'];
              DependencySystem.waitFor(uiComponents, () => {
                  if (window.sidebar?.init) {
                      window.sidebar.init();
                      console.log('[App] Sidebar initialized');
                  }

                  if (window.projectDashboard?.init) {
                      window.projectDashboard.init().then(() => {
                          console.log('[App] ProjectDashboard initialized');

                          // Initialize downstream components
                          if (window.chatExtensions?.initChatExtensions) {
                              window.chatExtensions.initChatExtensions();
                          }

                          if (window.chatManager?.initialize) {
                              window.chatManager.initialize();
                          }

                          if (window.initProjectList) {
                              window.initProjectList();
                          }

                          if (window.KnowledgeBaseComponent) {
                              window.knowledgeBaseComponent = new window.KnowledgeBaseComponent();
                          }

                          // Final steps
                          appState.initializing = false;
                          appState.initialized = true;
                          appState.currentPhase = 'complete';
                          console.log('[App] Initialization complete');
                      });
                  }
          }, 10000); // Longer timeout for UI components
      }).catch(error => {
          console.error('[App] Auth initialization failed:', error);
          appState.currentPhase = 'auth_error';
      });
  });
    });
  });
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
  window.addEventListener('popstate', handleNavigationChange);
}

function handleInitError(error) {
  console.error('[App] Critical initialization error:', error);
  console.debug('[App] Diagnostics:', {
    authAvailable: !!window.auth,
    appState: JSON.stringify(appState),
    documentReady: document.readyState,
    eventHandlersAvailable: !!window.eventHandlers
  });
  showNotification('Application failed to initialize. Please refresh.', 'error');
}

// Start initialization if DOM is already ready
if (document.readyState !== 'loading') {
  initApp().catch(handleInitError);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    initApp().catch(handleInitError);
  });
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
