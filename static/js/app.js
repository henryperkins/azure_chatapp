import { createModalManager } from './modalManager.js';

/**
 * @fileoverview
 * Core application initialization and dependency management for a web-based project.
 * This file handles:
 *  - Initial setup of global state and configuration.
 *  - Registration and orchestration of external dependencies (e.g., auth, modal,
 *    project manager, dashboards, etc.).
 *  - An API request utility function with support for CSRF tokens, timeouts,
 *    and request deduplication.
 *  - Event listeners for auth state changes and UI navigation.
 *
 * The end goal is to ensure that all key modules are loaded and available
 * before the user interacts with the UI, while providing robust fallback
 * and error handling during initialization.
 */

/**
 * External Dependencies (Global Scope):
 *  - window.auth (authentication system)
 *  - window.eventHandlers (event management)
 *  - window.modalManager (modal management)
 *  - window.projectManager (project operations)
 *  - window.projectDashboard (project UI)
 *  - window.chatManager (chat functionality)
 *  - window.notificationHandler (user notifications)
 *
 * Optional Dependencies:
 *  - Handles missing projectDashboard with basic fallbacks.
 *  - Gracefully falls back if notificationHandler not available.
 *  - Provides error handling for a missing auth module.
 */

/**
 * Browser APIs used:
 *  - document (DOM access)
 *  - fetch (network requests)
 *  - AbortController (request cancellation)
 *  - CustomEvent (event system)
 */

/**
 * A robust system for module registration and availability checks.
 * Supports both callback-based and Promise-based usage to ensure all
 * required modules are loaded before continuing. This prevents
 * race conditions or "nested waitFor" timeouts.
 */
const DependencySystem = {
    modules: new Map(),   // Stores registered modules by name
    states: new Map(),    // Tracks module states: 'unloaded', 'loading', 'loaded', 'error'
    waiters: new Map(),   // Maps each module name to an array of callbacks waiting on it

    /**
     * Register a module under a given name.
     * @param {string} name - Unique module name.
     * @param {any} instance - The module instance/object.
     * @param {string[]} [dependencies=[]] - Not used by default, but can be extended.
     * @returns {any} The same instance passed in, for chaining or immediate usage.
     */
    register(name, instance, dependencies = []) {
        console.log(`[DependencySystem] Registering module: ${name}`);
        this.modules.set(name, instance);
        this.states.set(name, 'loaded');

        // Notify any callbacks that were waiting for this module.
        this._notifyWaiters(name);
        return instance;
    },

    /**
     * Internal method. Notifies all waiters that a specific module is now available.
     * @param {string} name - The module name that just became available.
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

        // Clear waiters for this module to prevent repeated notifications.
        this.waiters.delete(name);
    },

    /**
     * Wait for one or more modules to be available. If a callback is provided,
     * it's invoked once the modules are ready. A Promise is returned in either case.
     * @param {string|string[]} names - Single or multiple module names to wait for.
     * @param {function} [callback] - Optional callback invoked once modules are ready.
     * @param {number} [timeout=5000] - How long (in ms) to wait before timing out.
     * @returns {Promise<any[]>} Resolves with an array of the requested modules in the same order.
     */
    waitFor(names, callback, timeout = 5000) {
        const nameArray = Array.isArray(names) ? names : [names];

        // If all modules are already registered, resolve immediately.
        if (nameArray.every(name => this.modules.has(name))) {
            const modules = nameArray.map(name => this.modules.get(name));
            if (callback) {
                callback(...modules);
            }
            return Promise.resolve(modules);
        }

        return new Promise((resolve) => {
            const missing = nameArray.filter(name => !this.modules.has(name));
            let resolved = false;

            // Set up a timeout to avoid waiting forever.
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    console.warn(`[DependencySystem] Timeout waiting for: ${missing.join(', ')}`);
                    resolved = true;
                    // Resolve with null for missing modules instead of rejecting.
                    resolve(nameArray.map(name => this.modules.get(name) || null));
                }
            }, timeout);

            // For each missing module, register a callback that will fire when it becomes available.
            missing.forEach(name => {
                if (!this.waiters.has(name)) {
                    this.waiters.set(name, []);
                }

                this.waiters.get(name).push(() => {
                    // Once we've loaded all requested modules, resolve the Promise.
                    if (nameArray.every(n => this.modules.has(n)) && !resolved) {
                        clearTimeout(timeoutId);
                        resolved = true;
                        const modules = nameArray.map(n => this.modules.get(n));
                        if (callback) {
                            callback(...modules);
                        }
                        resolve(modules);
                    }
                });
            });
        });
    }
};

// Expose DependencySystem globally if needed.
// Initialize core dependencies that must exist before anything else.
const modalManagerInstance = createModalManager();
DependencySystem.register('modalManager', modalManagerInstance);
window.modalManager = modalManagerInstance; // (optional: for legacy compatibility)

window.DependencySystem = DependencySystem;

// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

/**
 * Global app configuration object including debug mode, timeouts, API endpoints,
 * and frequently used DOM selectors. These values are referenced across the application
 * to ensure consistency and centralize configuration.
 */
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

    // Commonly used DOM selectors
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

/**
 * Track high-level state of the application, such as whether it has fully initialized,
 * which phase of initialization is currently running, and whether the user is authenticated.
 */
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

/**
 * Makes an API request with built-in CSRF handling, timeouts, and duplicate-request prevention.
 * Automatically parses JSON responses if the server provides a JSON content-type header.
 *
 * @param {string} url - The endpoint to request.
 * @param {object} [options] - Fetch options, including method, headers, body, etc.
 * @param {boolean} [skipCache=false] - If true, skip request deduplication.
 * @returns {Promise<any>} - Resolves with the parsed JSON or raw text, or rejects on error.
 */
async function apiRequest(url, options = {}, skipCache = false) {
    const requestKey = `${options.method || 'GET'}-${url}-${JSON.stringify(options.body || {})}`;

    // Deduplicate in-flight requests unless explicitly skipped.
    if (!skipCache && pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }

    // Prepare headers object if not provided.
    options.headers = options.headers || {};

    // Retrieve CSRF token from auth (if available) and include it in headers.
    const csrfToken = window.auth?.getCSRFToken();
    if (csrfToken) {
        options.headers['X-CSRF-Token'] = csrfToken;
    }

    // If the request method is POST/PUT/PATCH but there's no Content-Type set, use JSON.
    if (['POST', 'PUT', 'PATCH'].includes(options.method) && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
    }

    // If the body is an object (and not FormData), convert it to JSON before sending.
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        options.body = JSON.stringify(options.body);
    }

    // Create an AbortController to handle request timeouts.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APP_CONFIG.TIMEOUTS.API_REQUEST);
    options.signal = controller.signal;

    // Construct the actual request Promise.
    const requestPromise = (async () => {
        try {
            const response = await fetch(url, options);
            clearTimeout(timer);

            // Remove entry from the pending requests cache if caching was enabled.
            if (!skipCache) pendingRequests.delete(requestKey);

            if (!response.ok) {
                // Attempt to parse error details, or provide a fallback message.
                const errorData = await response.json().catch(() => ({}));
                const error = new Error(errorData.message || `API request failed with status ${response.status}`);
                error.status = response.status;
                error.data = errorData;
                throw error;
            }

            // Parse JSON if the response content-type indicates JSON.
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            return await response.text();
        } catch (err) {
            if (!skipCache) pendingRequests.delete(requestKey);

            // Distinguish between aborted requests (timeout) and other errors.
            if (err.name === 'AbortError') {
                throw new Error(`API request timed out after ${APP_CONFIG.TIMEOUTS.API_REQUEST}ms`);
            }
            throw err;
        }
    })();

    // Store the Promise in the pendingRequests Map if caching is enabled.
    if (!skipCache) {
        pendingRequests.set(requestKey, requestPromise);
    }

    return requestPromise;
}

// ---------------------------------------------------------------------
// Main App Initialization
// ---------------------------------------------------------------------

/**
 * Primary app initialization entrypoint. Attempts to load all required
 * dependencies (modules), initialize them, and set up UI components.
 * Once everything is ready, updates the global state to 'initialized'.
 *
 * @returns {Promise<boolean>} Resolves true if initialization is completed, or logs an error.
 */
async function init() {
    // Prevent double-initialization.
    if (window.projectDashboardInitialized) {
        console.log('[App] Already initialized.');
        return true;
    }

    try {
        // Register the global `app` module early, so other modules can waitFor it.
        window.app = {
            apiRequest,
            navigateToConversation,
            showNotification,
            state: appState,
            initialize: init,
            loadProjects,
            getProjectId: () => {
                const urlParams = new URLSearchParams(window.location.search);
                return urlParams.get('project') || localStorage.getItem('selectedProjectId');
            },
            // Example utility function for validating UUID.
            validateUUID: (uuid) => {
                if (!uuid) return false;
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                return uuidRegex.test(uuid);
            }
        };
        DependencySystem.register('app', window.app);
        console.log('[App] Registered app module');

        // Proceed with normal initialization sequence.
        await initializeCoreSystems();
        await initializeAuthSystem();
        await initializeUIComponents();

        // Mark the app as fully initialized.
        appState.currentPhase = 'initialized';
        appState.initialized = true;
        console.log('[App] Initialization complete.');
    } catch (error) {
        handleInitError(error);
    } finally {
        // Whether success or failure, mark the initialization process as finished.
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
 * Initialize core systems needed across the application (e.g., event handlers, modal manager).
 * Waits for them via DependencySystem, logs progress, and provides fallbacks if needed.
 */
async function initializeCoreSystems() {
    // Wait for eventHandlers first to ensure app-level events are available.
    await DependencySystem.waitFor('eventHandlers', null, 5000);
    appState.currentPhase = 'event_handlers_ready';

    // If ensureRegistered is implemented, use it as a robust wait function.
    if (DependencySystem.ensureRegistered) {
        await DependencySystem.ensureRegistered(['modalManager', 'auth', 'projectManager'], 5000);
    } else {
        // Otherwise manually wait for each dependency.
        await DependencySystem.waitFor(['modalManager', 'auth', 'projectManager'], null, 5000);
    }

    // Attempt to ensure modalManager is initialized. If not, log a warning.
    if (!window.modalManager) {
        console.warn('[App] modalManager not found, attempting to initialize...');
        if (typeof window.initModalManager === 'function') {
            window.initModalManager();
        }
    }

    try {
        await DependencySystem.waitFor('modalManager', null, 5000);
        console.log('[App] Modal manager initialized');
        appState.currentPhase = 'modals_ready';
    } catch (error) {
        console.warn('[App] Modal manager initialization timed out:', error);
        // We can proceed, but modal functionality will be degraded.
    }
}

/**
 * Initialize the authentication system, checking current auth state and
 * storing it in the appState. This method ensures we know if the user is
 * logged in before we show certain UI components.
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
 * Initialize UI components and handle initial navigation once all core
 * and auth systems are ready. This is where we set up any dashboards,
 * load project lists, or navigate to chat views if needed.
 */
async function initializeUIComponents() {
    // Wait for a projectDashboard module if available. If not, skip silently.
    await DependencySystem.waitFor('projectDashboard',
        (dashboard) => {
            if (dashboard && typeof dashboard.init === 'function') {
                dashboard.init();
                console.log('[App] projectDashboard initialized');
            }
        },
        APP_CONFIG.TIMEOUTS.COMPONENT_LOAD
    );

    // Perform an initial navigation pass (reading URL params to determine which view to show).
    handleNavigationChange();
    console.log('[App] Initial navigation handled.');

    // Register global event listeners for the app.
    registerAppListeners();
    console.log('[App] Global listeners registered.');
}

// ---------------------------------------------------------------------
// Application Utilities & Views
// ---------------------------------------------------------------------

/**
 * Example method demonstrating how one might navigate to a specific chat
 * using the chatManager dependency.
 * @param {string} conversationId - The ID of the conversation to load.
 * @returns {Promise<any>} Result of the chat load.
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
 * Show or hide a DOM element based on the selector or an element reference.
 * @param {string|Element} selector - CSS selector string or a DOM element.
 * @param {boolean} show - True to show, false to hide.
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
 * Show a user notification (toast). Prefers notificationHandler but falls back
 * to window.showNotification or a console message if none is available.
 * @param {string} message - The message to display.
 * @param {string} [type='info'] - The type of message (info, success, error, etc.).
 * @param {number} [duration=5000] - How long (in ms) to display the notification.
 */
function showNotification(message, type = 'info', duration = 5000) {
    if (window.notificationHandler?.show) {
        window.notificationHandler.show(message, type, { timeout: duration });
    } else if (typeof window.showNotification === 'function' && window.showNotification !== showNotification) {
        // Prevent recursion if our function replaced the global.
        window.showNotification(message, type, { timeout: duration });
    } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Ensure projectManager is available globally if loaded under a different variable.
if (!window.projectManager && window.projectManagerAPI) {
    window.projectManager = window.projectManagerAPI;
    console.log('[App] Bound projectManagerAPI to window.projectManager');
}

/**
 * Loads a list of projects if the user is authenticated. Uses the projectManager if available.
 * @returns {Promise<any[]>} An array of project objects or an empty array on failure.
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
 * Handles navigation changes by reading URL parameters (e.g., ?chatId=123, ?view=projects,
 * ?project=abcd), then deciding which UI component or view to show. Also checks auth status
 * to show/hide login prompts.
 */
async function handleNavigationChange() {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatId');
    const view = urlParams.get('view');
    const projectId = urlParams.get('project');

    console.log('[App] handleNavigationChange', { chatId, view, projectId, isAuthenticated: appState.isAuthenticated });

    try {
        // If not authenticated, show login message and hide other views.
        if (!appState.isAuthenticated) {
            toggleElement('LOGIN_REQUIRED_MESSAGE', true);
            toggleElement('PROJECT_LIST_VIEW', false);
            toggleElement('PROJECT_DETAILS_VIEW', false);
            return;
        }

        // Hide the login-required message if the user is authenticated.
        toggleElement('LOGIN_REQUIRED_MESSAGE', false);

        // If a projectDashboard is available, use that to handle project or chat views.
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
            // Default fallback to the project list view.
            window.projectDashboard.showProjectList();
            return;
        }

        // If no projectDashboard, use a basic fallback approach.
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

        // Default view if nothing else matches.
        showProjectListView();

    } catch (error) {
        console.error('[App] Navigation error:', error);
        showNotification(`Navigation error: ${error.message}`, 'error');
        // If an error occurs, fall back to project list view.
        showProjectListView();
    }
}

/**
 * Basic fallback method to show a project list when projectDashboard is unavailable.
 * Logs a warning to encourage usage of projectDashboard for a richer experience.
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

// Attach the AuthBus listener once the auth module is available.
DependencySystem.waitFor('auth', (auth) => {
    if (auth?.AuthBus) {
        // Mark that we've already attached it to prevent duplicate registrations (e.g., in HMR).
        if (!auth.AuthBus._hasAuthStateChangeListener) {
            auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
            auth.AuthBus._hasAuthStateChangeListener = true;
            console.log('[App] Attached authStateChanged listener.');
        }
    } else {
        console.error('[App] Auth module or AuthBus not found for attaching authStateChanged listener.');
    }
}, 5000);

/**
 * React to changes in user authentication status, e.g., user logs in or out.
 * Update UI elements such as login buttons, user menus, or project views accordingly.
 * @param {CustomEvent} event - The authStateChanged event with detail { authenticated, username }.
 */
function handleAuthStateChange(event) {
    const { authenticated, username } = event.detail || {};
    appState.isAuthenticated = authenticated; // Keep in sync with global appState

    // Use requestAnimationFrame to batch DOM updates.
    requestAnimationFrame(() => {
        const loginRequiredMessage = document.getElementById('loginRequiredMessage');
        const projectListView = document.getElementById('projectListView');
        const projectDetailsView = document.getElementById('projectDetailsView');

        // --- HEADER UPDATE LOGIC START ---
        const authButton = document.getElementById('authButton');
        const userMenu = document.getElementById('userMenu');
        const authStatusSpan = document.getElementById('authStatus');
        const userStatusSpan = document.getElementById('userStatus');
        if (authenticated) {
            // Hide login button, show user menu, display username, etc.
            authButton?.classList.add('hidden');
            userMenu?.classList.remove('hidden');
            if (authStatusSpan) {
                authStatusSpan.textContent = username || 'Authenticated';
            }
            if (userStatusSpan) {
                userStatusSpan.textContent = 'Online';
                userStatusSpan.classList.remove('text-error');
                userStatusSpan.classList.add('text-success');
            }
        } else {
            // Show login button, hide user menu.
            authButton?.classList.remove('hidden');
            userMenu?.classList.add('hidden');
            if (authStatusSpan) {
                authStatusSpan.textContent = 'Not Authenticated';
            }
            if (userStatusSpan) {
                userStatusSpan.textContent = 'Offline';
                userStatusSpan.classList.remove('text-success');
                userStatusSpan.classList.add('text-error');
            }
        }
        // --- HEADER UPDATE LOGIC END ---

        // Show or hide main views based on auth status.
        if (!authenticated) {
            // Show the login-required message, hide project views.
            if (loginRequiredMessage) loginRequiredMessage.classList.remove('hidden');
            projectListView?.classList.add('hidden', 'opacity-0');
            projectDetailsView?.classList.add('hidden');
        } else {
            // Hide the login-required message, reveal project view if appropriate.
            loginRequiredMessage?.classList.add('hidden');
            projectListView?.classList.remove('hidden');
            setTimeout(() => {
                projectListView.classList.remove('opacity-0');
            }, 100);

            // If the user is on a details view, keep the details visible. Otherwise show list.
            if (typeof dashboardState !== "undefined" &&
                dashboardState.currentView === 'details' &&
                dashboardState.currentProject) {
                projectListView?.classList.add('hidden');
                projectDetailsView?.classList.remove('hidden');
            } else {
                projectListView?.classList.remove('hidden');
                projectDetailsView?.classList.add('hidden');

                if (typeof dashboardState !== "undefined" &&
                    dashboardState.currentView === 'list') {
                    loadProjectList();
                }
            }
        }
    });
}

/**
 * Register DOM listeners such as popstate for detecting back/forward navigation,
 * which triggers handleNavigationChange to keep the UI in sync with the URL.
 */
function registerAppListeners() {
    window.addEventListener('popstate', handleNavigationChange);
}

/**
 * Handle critical initialization errors by logging them and showing a notification.
 * Allows the app to fail gracefully if one of the core steps fails.
 * @param {Error} error - The error that caused the initialization failure.
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
 * Cleanup function after initialization completes (or fails). Currently, only sets
 * appState.initializing to false, but could be extended to hide overlays or send analytics.
 */
function cleanupInitialization() {
    // Hide any loading overlays, dispatch final events, etc.
    appState.initializing = false;
}

// Trigger init() automatically once the DOM is loaded, or immediately if it's ready.
if (document.readyState !== 'loading') {
    init().catch(handleInitError);
} else {
    document.addEventListener('DOMContentLoaded', () => {
        init().catch(handleInitError);
    });
}

// ---------------------------------------------------------------------
// Global exports (Deprecated in some cases)
// ---------------------------------------------------------------------
window.app = {
    apiRequest,
    navigateToConversation,
    showNotification,
    state: appState,
    initialize: init,
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

// Providing a backward-compatible global showNotification reference.
window.showNotification = showNotification;

export default window.app;
