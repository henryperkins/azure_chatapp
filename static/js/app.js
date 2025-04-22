/**
 * app.js - Core application initialization
 * Refactored to simplify the initialization sequence and avoid dependency timeouts.
 * Dependencies:
 * - window.auth (external dependency, for authentication)
 * - window.eventHandlers (external utility, for event management)
 * - window.modalManager (external dependency, for modal dialogs)
 * - window.projectManager (external dependency, for project operations)
 * - window.projectDashboard (external dependency, for project views)
 * - window.chatManager (external dependency, for chat functionality)
 * - window.notificationHandler (external dependency, for notifications)
 * - document (browser built-in, for DOM manipulation)
 * - fetch (browser built-in, for API requests)
 * - AbortController (browser built-in, for request cancellation)
 */

// Browser APIs:
// - document (DOM access)
// - fetch (network requests)
// - AbortController (request cancellation)
// - CustomEvent (event system)

// External Dependencies (Global Scope):
// - window.auth (authentication system)
// - window.eventHandlers (event management)
// - window.modalManager (modal management)
// - window.projectManager (project operations)
// - window.projectDashboard (project UI)
// - window.chatManager (chat functionality)
// - window.notificationHandler (user notifications)

// Optional Dependencies:
// - Gracefully falls back if notificationHandler not available
// - Handles missing projectDashboard with basic fallbacks
// - Provides error handling for missing auth module


// ---------------------------------------------------------------------
// Dependency Management System
// ---------------------------------------------------------------------
/**
 * A more robust dependency management system that supports both callback
 * and promise-based waits, preventing nested waitFor timeouts.
 */
const DependencySystem = {
    modules: new Map(),   // Stores registered modules by name
    states: new Map(),    // Tracks module states: unloaded, loading, loaded, error
    waiters: new Map(),   // Maps each module -> array of callbacks waiting on it

    /**
     * Register a module under a given name.
     * @param {string} name - Unique module name
     * @param {any} instance - The module instance/object
     * @param {string[]} dependencies - Not used directly by default, but can be extended
     */
    register(name, instance, dependencies = []) {
        console.log(`[DependencySystem] Registering module: ${name}`);
        this.modules.set(name, instance);
        this.states.set(name, 'loaded');

        // Notify any callbacks waiting for this module
        this._notifyWaiters(name);
        return instance;
    },

    /**
     * Internal method: notifies waiters that a module is now available.
     */
    _notifyWaiters(name) {
        if (!this.waiters.has(name)) return;

        this.waiters.get(name).forEach((callback) => {
            try {
                callback(this.modules.get(name));
            } catch (error) {
                console.error(`[DependencySystem] Error in waiter callback for ${name}:`, error);
            }
        });

        // Clear waiters for this module
        this.waiters.delete(name);
    },

    /**
     * Wait for one or more modules to be available.
     * @param {string|string[]} names - Module name(s) to wait for
     * @param {function} [callback] - Optional callback invoked once modules are ready
     * @param {number} [timeout=5000] - Timeout in ms
     * @returns {Promise<any[]>} - Resolves once all modules are available
     */
    waitFor(names, callback, timeout = 5000) {
        const nameArray = Array.isArray(names) ? names : [names];

        // Check if all modules are already available
        const allAvailable = nameArray.every((m) => this.modules.has(m));
        if (allAvailable) {
            // If a callback is provided, invoke it synchronously
            const resolvedInstances = nameArray.map((m) => this.modules.get(m));
            if (callback) callback(...resolvedInstances);
            return Promise.resolve(resolvedInstances);
        }

        // Otherwise, set up a Promise and a timeout to handle waiting
        return new Promise((resolve, reject) => {
            const missing = new Set(nameArray.filter((n) => !this.modules.has(n)));

            // For each missing module, add a waiter callback
            missing.forEach((modName) => {
                if (!this.waiters.has(modName)) this.waiters.set(modName, []);
                this.waiters.get(modName).push(() => {
                    // Check if all missing modules are now resolved
                    missing.delete(modName);
                    if (missing.size === 0) {
                        // All modules available
                        const resolvedInstances = nameArray.map((n) => this.modules.get(n));
                        if (callback) {
                            try {
                                callback(...resolvedInstances);
                            } catch (err) {
                                reject(err);
                                return;
                            }
                        }
                        resolve(resolvedInstances);
                    }
                });
            });

            // Set an overall timeout
            const timer = setTimeout(() => {
                const stillMissing = Array.from(missing);
                stillMissing.forEach((m) => this.states.set(m, 'error'));
                reject(new Error(`[DependencySystem] Timeout waiting for module(s): ${stillMissing.join(', ')}`));
            }, timeout);
        });
    }
};

// Expose globally if needed
window.DependencySystem = DependencySystem;

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------
const APP_CONFIG = {
    DEBUG: window.location.hostname === 'localhost' || window.location.search.includes('debug=1'),

    // Timeouts (ms)
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

// ---------------------------------------------------------------------
// Global App State
// ---------------------------------------------------------------------
const appState = {
    initialized: false,
    initializing: true,
    currentPhase: 'boot',
    currentView: null,
    isAuthenticated: false
};

// Track pending requests for deduplication
const pendingRequests = new Map();

// ---------------------------------------------------------------------
// API Request (with CSRF & dedup support)
// ---------------------------------------------------------------------
async function apiRequest(url, options = {}, skipCache = false) {
    const requestKey = `${options.method || 'GET'}-${url}-${JSON.stringify(options.body || {})}`;

    // Deduplicate in-flight requests unless explicitly skipped
    if (!skipCache && pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }

    // Set up headers
    options.headers = options.headers || {};
    const csrfToken = document.getElementById('csrfToken')?.getAttribute('content');
    if (csrfToken) {
        options.headers['X-CSRFToken'] = csrfToken;
    }

    // Enforce JSON for writes
    if (['POST', 'PUT', 'PATCH'].includes(options.method) && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    // Stringify body object
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        options.body = JSON.stringify(options.body);
    }

    // Abort controller for timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APP_CONFIG.TIMEOUTS.API_REQUEST);
    options.signal = controller.signal;

    // Fire off the request
    const requestPromise = (async () => {
        try {
            const response = await fetch(url, options);
            clearTimeout(timer);

            if (!skipCache) pendingRequests.delete(requestKey);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const error = new Error(errorData.message || `API request failed with status ${response.status}`);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }

            // Attempt to parse JSON if present
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            return await response.text();
        } catch (err) {
            if (!skipCache) pendingRequests.delete(requestKey);
            if (err.name === 'AbortError') {
                throw new Error(`API request timed out after ${APP_CONFIG.TIMEOUTS.API_REQUEST}ms`);
            }
            throw err;
        }
    })();

    if (!skipCache) {
        pendingRequests.set(requestKey, requestPromise);
    }

    return requestPromise;
}

// ---------------------------------------------------------------------
// Main App Initialization
// ---------------------------------------------------------------------
async function initApp() {
    console.log('[App] Starting initialization...');
    appState.initializing = true;
    appState.currentPhase = 'boot';

    // Ensure DOM is ready
    if (document.readyState === 'loading') {
        await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve));
    }
    appState.currentPhase = 'dom_ready';

    try {
        // 1. Initialize core systems (e.g. eventHandlers, modals, etc.)
        await initializeCoreSystems();

        // 2. Initialize auth system
        await initializeAuthSystem();

        // 3. Initialize any additional UI and handle initial navigation
        await initializeUIComponents();

        // Finalize app state
        appState.currentPhase = 'initialized';
        appState.initialized = true;
        console.log('[App] Initialization complete.');

    } catch (error) {
        handleInitError(error);
    } finally {
        // Cleanup
        appState.initializing = false;
        const loadingDiv = document.getElementById('appLoading');
        if (loadingDiv) {
            loadingDiv.style.display = 'none';
        }
        document.dispatchEvent(new CustomEvent('appInitialized'));
        console.log('[App] Initialization ended. Phase:', appState.currentPhase);
    }
}

/**
 * Initialize core systems (e.g., event handlers, modal manager)
 */
async function initializeCoreSystems() {
    // Wait for eventHandlers
    await DependencySystem.waitFor('eventHandlers',
        (eventHandlers) => {
            if (typeof eventHandlers.init === 'function') {
                eventHandlers.init();
                console.log('[App] Event handlers initialized');
            }
        },
        APP_CONFIG.TIMEOUTS.COMPONENT_LOAD
    );
    appState.currentPhase = 'event_handlers_ready';

    // Wait for modalManager
    await DependencySystem.waitFor('modalManager',
        (modalManager) => {
            if (window.initModalManager) {
                window.initModalManager(); // calls modalManager.init()
                console.log('[App] Modal Manager initialized');
            }
        },
        APP_CONFIG.TIMEOUTS.COMPONENT_LOAD
    );
    appState.currentPhase = 'modals_ready';
}

/**
 * Initialize auth system
 */
async function initializeAuthSystem() {
  await DependencySystem.waitFor('auth', async (auth) => {
    try {
      console.log('[Auth] Starting auth initialization...');
      const initialized = await auth.init();
      appState.isAuthenticated = auth.isAuthenticated();
      console.log(`[Auth] Auth module ready. Initialized: ${initialized}, Authenticated: ${appState.isAuthenticated}`);
    } catch (error) {
      console.error('[Auth] Initialization error:', error);
      appState.isAuthenticated = false;
    }
  }, APP_CONFIG.TIMEOUTS.AUTH_CHECK);
  appState.currentPhase = 'auth_ready';
}

/**
 * Initialize UI components and trigger the initial navigation
 */
async function initializeUIComponents() {
    // Example: If you have a projectDashboard or other UI modules to wait for
    // (Optional) If not needed, remove or adapt
    await DependencySystem.waitFor('projectDashboard',
        (dashboard) => {
            if (typeof dashboard.init === 'function') {
                dashboard.init();
                console.log('[App] projectDashboard initialized');
            }
        },
        APP_CONFIG.TIMEOUTS.COMPONENT_LOAD
    );

    // Perform initial navigation checks
    handleNavigationChange();
    console.log('[App] Initial navigation handled.');

    // Register global listeners
    registerAppListeners();
    console.log('[App] Global listeners registered.');
}

// ---------------------------------------------------------------------
// Application Utilities & Views
// ---------------------------------------------------------------------

/**
 * Navigate to a specific conversation (example usage of a chatManager)
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
 * Show or hide a DOM element by selector or element
 */
function toggleElement(selector, show) {
    const element =
        typeof selector === 'string'
            ? document.querySelector(APP_CONFIG.SELECTORS[selector] || selector)
            : selector;
    if (element) {
        element.classList.toggle('hidden', !show);
    }
}

/**
 * Show a notification (falls back to console if no handler)
 */
function showNotification(message, type = 'info', duration = 5000) {
    if (window.notificationHandler?.show) {
        window.notificationHandler.show(message, type, { timeout: duration });
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

/**
 * Ensure projectManager is available globally if loaded as a module
 */
if (!window.projectManager && window.projectManagerAPI) {
    window.projectManager = window.projectManagerAPI;
    console.log('[App] Bound projectManagerAPI to window.projectManager');
}

/**
 * Load projects list (checks auth & uses projectManager if available)
 */
async function loadProjects() {
    try {
        if (!appState.isAuthenticated) {
            console.log('[App] Skipping loadProjects - user not authenticated.');
            return [];
        }
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

    console.log('[App] handleNavigationChange', { chatId, view, projectId, isAuthenticated: appState.isAuthenticated });

    try {
        // If not authenticated, show a login message or screen
        if (!appState.isAuthenticated) {
            toggleElement('LOGIN_REQUIRED_MESSAGE', true);
            toggleElement('PROJECT_LIST_VIEW', false);
            toggleElement('PROJECT_DETAILS_VIEW', false);
            return;
        }

        // Hide the login-required message if we're authenticated
        toggleElement('LOGIN_REQUIRED_MESSAGE', false);

        // Example usage: if you have a projectDashboard that handles project views
        if (window.projectDashboard) {
            if (view === 'projects') {
                window.projectDashboard.showProjectList();
                return;
            }
            if (projectId) {
                await window.projectDashboard.showProjectDetails(projectId);
                return;
            }
            if (chatId && window.chatManager) {
                await navigateToConversation(chatId);
                return;
            }
            // Default fallback
            window.projectDashboard.showProjectList();
            return;
        }

        // If no projectDashboard, fallback to a basic approach
        if (projectId) {
            if (window.projectManager?.loadProjectDetails) {
                await window.projectManager.loadProjectDetails(projectId);
            }
            toggleElement('PROJECT_LIST_VIEW', false);
            toggleElement('PROJECT_DETAILS_VIEW', true);
            return;
        }

        if (chatId && window.chatManager) {
            await navigateToConversation(chatId);
            return;
        }

        // Default view is project list
        showProjectListView();

    } catch (error) {
        console.error('[App] Navigation error:', error);
        showNotification(`Navigation error: ${error.message}`, 'error');
        // Fallback to project list view if anything goes wrong
        showProjectListView();
    }
}

/**
 * DEPRECATED in favor of a projectDashboard approach
 */
function showProjectListView() {
    console.warn('[App] showProjectListView is deprecated. Use projectDashboard.showProjectList() if available.');
    appState.currentView = 'projects';
    toggleElement('PROJECT_DETAILS_VIEW', false);
    toggleElement('PROJECT_LIST_VIEW', true);

    if (appState.isAuthenticated) {
        loadProjects().catch((error) => {
            console.error('[App] Error loading projects:', error);
            showNotification('Failed to load projects', 'error');
        });
    }
}

// ---------------------------------------------------------------------
// Auth & Event Listeners
// ---------------------------------------------------------------------
if (window.auth?.AuthBus) {
    window.auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
}

/**
 * Handle auth state changes
 */
function handleAuthStateChange(event) {
    const { authenticated } = event.detail || {};

    // Batch DOM updates using requestAnimationFrame
    requestAnimationFrame(() => {
        const loginRequiredMessage = document.getElementById('loginRequiredMessage');
        const projectListView = document.getElementById('projectListView');
        const projectDetailsView = document.getElementById('projectDetailsView');

        if (!authenticated) {
            // Hide project views, show login message
            if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
            if (projectListView) {
                projectListView.classList.add('hidden');
                projectListView.classList.add('opacity-0');
            }
            if (projectDetailsView) projectDetailsView.classList.add('hidden');
        } else {
            // Show appropriate dashboard view
            if (loginRequiredMessage) loginRequiredMessage.classList.add('hidden');
            if (projectListView) {
                projectListView.classList.remove('hidden');
                // Use a small delay to ensure smooth transition
                setTimeout(() => {
                    projectListView.classList.remove('opacity-0');
                }, 100);
            }

            if (dashboardState.currentView === 'details' && dashboardState.currentProject) {
                projectListView?.classList.add('hidden');
                projectDetailsView?.classList.remove('hidden');
            } else {
                projectListView?.classList.remove('hidden');
                projectDetailsView?.classList.add('hidden');

                // Only load projects if we're showing the list view
                if (dashboardState.currentView === 'list') {
                    loadProjectList();
                }
            }
        }
    });
}

/**
 * Register DOM listeners
 */
function registerAppListeners() {
    window.addEventListener('popstate', handleNavigationChange);
}

/**
 * Handle critical initialization error
 */
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

/**
 * Cleanup function after initApp finishes (success or error)
 */
function cleanupInitialization() {
    // Hide any loading overlays, dispatch final events, etc.
    appState.initializing = false;
}

// ---------------------------------------------------------------------
// Start Application Initialization
// ---------------------------------------------------------------------
if (document.readyState !== 'loading') {
    initApp().catch(handleInitError);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        initApp().catch(handleInitError);
    });
}

// ---------------------------------------------------------------------
// Global exports
// ---------------------------------------------------------------------
window.app = {
    apiRequest,
    navigateToConversation,
    showNotification,
    state: appState,
    initialize: initApp,
    loadProjects,
    getProjectId: () => {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('project') || localStorage.getItem('selectedProjectId');
    },
    // Example utility function
    validateUUID: (uuid) => {
        if (!uuid) return false;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuid);
    }
};

// Deprecated globals - phase these out over time
window.showNotification = showNotification; // For backward compatibility

export default window.app;
