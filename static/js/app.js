import { createModalManager, createProjectModal } from './modalManager.js';
import { createProjectManager } from './projectManager.js';
import { createProjectDashboard } from './projectDashboard.js';
import { createProjectListComponent, ProjectListComponent } from './projectListComponent.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createModelConfig } from './modelConfig.js';
// import { createProjectDashboardUtils } from './projectDashboardUtils.js'; // Use window global instead
import './FileUploadComponent.js'; // Exposes window.FileUploadComponent
import './notification-handler.js'; // Initializes notification system
import { createChatManager } from './chat.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { uiRenderer } from './uiRenderer.js';

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
 */

/* DependencySystem is now defined globally via inline script in base.html.
   The local definition and window assignment are no longer needed.
 */
// ---------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------

/**
 * Global app configuration object including debug mode, timeouts, API endpoints,
 * and frequently used DOM selectors.
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
        // Wait for both auth and eventHandlers to be registered before continuing
        await DependencySystem.waitFor(['auth', 'eventHandlers'], null, APP_CONFIG.TIMEOUTS.INITIALIZATION);

        // Now safe to use window.auth and window.eventHandlers everywhere from here
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
    console.log('[App] Initializing core systems...');

    // Create the modal manager
    const modalManager = createModalManager();
    window.modalManager = modalManager;
    DependencySystem.register('modalManager', modalManager);
    console.log('[App] Modal manager initialized and registered');

    // Project modal: Initialize and register only after modalsLoaded,
    // and expose to window before binding any other listeners.
    document.addEventListener('modalsLoaded', async () => {
        console.log('[App] Detected modalsLoaded. Initializing projectModal...');
        const projectModal = createProjectModal();
        await projectModal.init();
        window.projectModal = projectModal;
        DependencySystem.register('projectModal', projectModal);
        console.log('[App] projectModal initialized, exposed globally, and registered with DependencySystem.');
    }, { once: true });

    // Wait for eventHandlers first to ensure app-level events are available.
    await DependencySystem.waitFor('eventHandlers', null, 5000);
    appState.currentPhase = 'event_handlers_ready';
    console.log('[App] Event handlers ready');

    // Ensure notification handler is registered and using the centralized system
    if (window.notificationHandler) {
        DependencySystem.register('notificationHandler', window.notificationHandler);
        console.log('[App] Notification handler initialized and registered');
    } else {
        console.warn('[App] Notification handler not available');
    }

    // Create and initialize the project manager
    const projectManager = createProjectManager();
    await projectManager.initialize();
    window.projectManager = projectManager;
    DependencySystem.register('projectManager', projectManager);
    console.log('[App] Project manager initialized and registered');

    // Initialize auth if available
    if (DependencySystem.modules.has('auth')) {
        console.log('[App] Auth module already registered');
    } else {
        console.log('[App] Waiting for auth module...');
        await DependencySystem.waitFor('auth', null, 5000);
        console.log('[App] Auth module found');
    }

    appState.currentPhase = 'core_systems_ready';
    console.log('[App] Core systems initialized');
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
    console.log('[App] Initializing UI components...');

    // Register legacy/global SPA component classes for ProjectDashboard to access
    window.ProjectListComponent = ProjectListComponent;
    window.ProjectDetailsComponent = (await import('./projectDetailsComponent.js')).ProjectDetailsComponent || createProjectDetailsComponent;

    // Create and initialize the project dashboard
    const projectDashboard = createProjectDashboard();
    window.projectDashboard = projectDashboard;
    DependencySystem.register('projectDashboard', projectDashboard);

    // Initialize the dashboard
    if (typeof projectDashboard.initialize === 'function') {
        await projectDashboard.initialize();
        console.log('[App] Project dashboard initialized');
    }

    // --- ModelConfig initialization/registration (before chatManager) ---
    const modelConfig = createModelConfig();
    window.modelConfig = modelConfig;
    DependencySystem.register('modelConfig', modelConfig);
    console.log('[App] ModelConfig initialized and registered');

    // --- ProjectDashboardUtils initialization/registration ---
    const projectDashboardUtils = window.createProjectDashboardUtils();
    window.projectDashboardUtils = projectDashboardUtils;
    DependencySystem.register('projectDashboardUtils', projectDashboardUtils);
    console.log('[App] ProjectDashboardUtils initialized and registered');

    // --- FileUploadComponent registration ---
    if (window.FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', window.FileUploadComponent);
        console.log('[App] FileUploadComponent registered');
    } else {
        console.warn('[App] FileUploadComponent not available');
    }

    // --- ChatManager initialization/registration ---
    const chatManager = createChatManager();
    window.chatManager = chatManager;
    DependencySystem.register('chatManager', chatManager);
    console.log('[App] ChatManager initialized and registered');

    // --- ProjectListComponent initialization/registration ---
    // DO NOT create a global ProjectListComponent here; always let ProjectDashboard manage the SPA instance.
    // This avoids event wiring conflicts and race conditions.
    // window.ProjectListComponent and window.projectListComponent are set by ProjectDashboard.

    // Deprecate/skip this logic. Keep only for module/class registration reference.
    // DependencySystem.register('projectListComponent', projectListComponent);
    // console.log('[App] ProjectListComponent initialized and registered');

    // --- ProjectDetailsComponent initialization/registration ---
    const projectDetailsComponent = createProjectDetailsComponent({
        onBack: () => {
            if (window.projectDashboard && window.projectDashboard.showProjectList) {
                window.projectDashboard.showProjectList();
            } else {
                window.location.href = '/';
            }
        }
    });
    await projectDetailsComponent.initialize();
    window.projectDetailsComponent = projectDetailsComponent;
    DependencySystem.register('projectDetailsComponent', projectDetailsComponent);
    console.log('[App] ProjectDetailsComponent initialized and registered');

    // --- Sidebar initialization/registration ---
    const sidebar = createSidebar();
    await sidebar.init();
    window.sidebar = sidebar;
    DependencySystem.register('sidebar', sidebar);
    console.log('[App] Sidebar initialized and registered');

    // --- uiRenderer initialization ---
    uiRenderer.initialize();
    console.log('[App] uiRenderer initialized');

    // --- KnowledgeBaseComponent initialization/registration (Injected factory pattern) ---
    const knowledgeBaseComponent = createKnowledgeBaseComponent({
        apiRequest,
        auth: window.auth,
        projectManager: window.projectManager,
        showNotification,
        uiUtilsInstance: window.uiUtilsInstance
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponent);
    console.log('[App] KnowledgeBaseComponent initialized and registered');

    // Initialize chat manager if available
    if (window.chatManager && typeof window.chatManager.initialize === 'function') {
        await window.chatManager.initialize();
        console.log('[App] Chat manager initialized');
    }

    // Perform an initial navigation pass (reading URL params to determine which view to show).
    handleNavigationChange();
    console.log('[App] Initial navigation handled.');

    // Register global event listeners for the app.
    registerAppListeners();
    console.log('[App] Global listeners registered.');

    appState.currentPhase = 'ui_components_ready';
    console.log('[App] UI components initialized.');
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
            projectListView?.classList.remove('hidden', 'opacity-0');
            if (projectListView) projectListView.style.display = '';
            
            // If projectDashboard is available, use it to show project list
            if (window.projectDashboard?.showProjectList) {
                setTimeout(() => window.projectDashboard.showProjectList(), 50);
            }

            // If the user is on a details view, keep the details visible. Otherwise show list.
            if (window.projectDashboard?.state?.currentView === 'details' &&
                window.projectDashboard?.state?.currentProject) {
                projectListView?.classList.add('hidden');
                projectDetailsView?.classList.remove('hidden');
            } else {
                projectListView?.classList.remove('hidden');
                projectDetailsView?.classList.add('hidden');

                // Only call loadProjects if we're showing the project list
                // Instead, let projectDashboard.showProjectList() handle loading via SPA logic.
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

//
// --- Robust Chat Initialization Logic ---
//
function canInitializeChat() {
  return window.auth?.isAuthenticated() && window.app?.getProjectId();
}

// Re-initialize chat when the user logs in
DependencySystem.waitFor(['auth', 'chatManager'], (auth, chatManager) => {
  if (auth && chatManager && auth.AuthBus) {
    auth.AuthBus.addEventListener('authStateChanged', () => {
      if (canInitializeChat()) {
        chatManager.initialize();
      }
    });
  }
});

// Re-initialize chat when the user selects a new project
DependencySystem.waitFor(['projectManager', 'chatManager'], (projectManager, chatManager) => {
  if (projectManager && chatManager) {
    // Prefer a standard EventTarget ('addEventListener') if available
    if (typeof projectManager.addEventListener === 'function') {
      projectManager.addEventListener('projectSelected', () => {
        if (canInitializeChat()) {
          chatManager.initialize();
        }
      });
    }
    // Or custom event system: try .on or equivalent
    else if (typeof projectManager.on === 'function') {
      projectManager.on('projectSelected', () => {
        if (canInitializeChat()) {
          chatManager.initialize();
        }
      });
    }
    // Otherwise, optionally listen for a DOM event or document-level fallback
    else {
      document.addEventListener('projectSelected', () => {
        if (canInitializeChat()) {
          chatManager.initialize();
        }
      });
    }
  }
});

export default window.app;
