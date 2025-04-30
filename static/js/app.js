/* eslint-disable no-console */
/**
 * app.js - Refactored Application Core (v2 - Finalized)
 *
 * - Centralized dependency management via DependencySystem.
 * - Deterministic initialization sequence using async/await.
 * - Core utilities consolidated (apiRequest, notification, UUID validation).
 * - Reduced global scope pollution (strict DependencySystem usage).
 * - Consistent use of ES Modules.
 * - Placeholders and examples removed or completed.
 */

// --- Core Dependencies ---
// - DependencySystem is assumed to be loaded via a <script> tag in base.html
// - Utility modules like formatting.js, utils.js should self-register or be handled early if needed

// --- Component Factories/Classes (Imported) ---
import { createModalManager, createProjectModal } from './modalManager.js';
import { createProjectManager, isValidProjectId as validateUUID } from './projectManager.js';
import { createProjectDashboard } from './projectDashboard.js';
import { ProjectListComponent } from './projectListComponent.js';
import { ProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { createChatManager } from './chat.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { initChatExtensions } from './chatExtensions.js';

import './notification-handler.js';    // Registers 'notificationHandler'
import './sidebar-enhancements.js';     // Automatically runs/enhances as needed
import './FileUploadComponent.js';      // Registers 'FileUploadComponent' or adds global enhancements
import './auth.js';                     // Registers 'auth' and possibly 'AuthBus'

/* ---------------------------------------------------------------------
 * Configuration (Centralized)
 * ------------------------------------------------------------------- */
const APP_CONFIG = {
    DEBUG: window.location.hostname === 'localhost' || window.location.search.includes('debug=1'),
    TIMEOUTS: {
        INITIALIZATION: 15_000,
        AUTH_CHECK: 5_000,
        API_REQUEST: 10_000,  // Slightly increased API timeout
        COMPONENT_LOAD: 5_000,
        DEPENDENCY_WAIT: 10_000
    },
    API_ENDPOINTS: {
        AUTH_LOGIN: '/api/auth/login',
        AUTH_REGISTER: '/api/auth/register',
        AUTH_LOGOUT: '/api/auth/logout',
        AUTH_VERIFY: '/api/auth/verify',
        PROJECTS: '/api/projects',
        PROJECT_DETAILS: '/api/projects/{projectId}',
        PROJECT_CONVERSATIONS: '/api/projects/{projectId}/conversations',
        PROJECT_FILES: '/api/projects/{projectId}/files',
        PROJECT_ARTIFACTS: '/api/projects/{projectId}/artifacts',
        PROJECT_KNOWLEDGE_BASE: '/api/projects/{projectId}/knowledge_base',
        // Additional core endpoints can be added or updated here
    },
    SELECTORS: {
        MAIN_SIDEBAR: '#mainSidebar',
        NAV_TOGGLE_BTN: '#navToggleBtn',
        SIDEBAR_PROJECTS: '#sidebarProjects',
        AUTH_BUTTON: '#authButton',             // Button that opens the login/register panel
        USER_MENU_BUTTON: '#userMenuButton',    // Button for the logged-in user's menu
        USER_MENU: '#userMenu',                 // Dropdown menu container
        PROJECT_LIST_VIEW: '#projectListView',
        PROJECT_DETAILS_VIEW: '#projectDetailsView',
        LOGIN_REQUIRED_MESSAGE: '#loginRequiredMessage',
        APP_LOADING_SPINNER: '#appLoading',
        APP_FATAL_ERROR: '#appFatalError',
        AUTH_STATUS_SPAN: '[data-auth-status]',
        USER_STATUS_SPAN: '[data-user-status]'
    }
};

/* ---------------------------------------------------------------------
 * Global App State
 * ------------------------------------------------------------------- */
const appState = {
    initialized: false,
    initializing: false,
    currentPhase: 'idle',
    isAuthenticated: false // Updated by auth initialization
};

/* ---------------------------------------------------------------------
 * Core Utilities
 * ------------------------------------------------------------------- */
const DependencySystem = window.DependencySystem;
if (!DependencySystem) {
    console.error("CRITICAL: DependencySystem not found. Application cannot start.");
    document.body.innerHTML = `
        <div style="padding: 2em; text-align: center; color: red; font-family: sans-serif;">
            <strong>Application Critical Error:</strong> Core dependency system failed to load.
            Please contact support or refresh.
        </div>`;
    throw new Error("DependencySystem is required but not available.");
}
const waitFor = DependencySystem.waitFor.bind(DependencySystem);

/** Simple debounce (trailing edge). */
function debounce(fn, wait = 250) {
    let timeoutId = null;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            timeoutId = null;
            fn.apply(this, args);
        }, wait);
    };
}

/** Stable JSON-like stringify for caching keys, etc. */
function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value)
        .sort()
        .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
        .join(',')}}`;
}

/** Normalizes a URL (sorts query params, removes trailing slash unless root). */
function normaliseUrl(url) {
    try {
        const u = new URL(url, window.location.origin);
        if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
            u.pathname = u.pathname.slice(0, -1);
        }
        const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
        u.search = new URLSearchParams(params).toString();
        return u.toString();
    } catch (e) {
        console.warn(`[App] Failed to normalize URL: ${url}`, e);
        return url;
    }
}

const pendingRequests = new Map();

/** Robust API request utility: handles CSRF, timeouts, dedup (GET), JSON parse, error parsing. */
async function apiRequest(url, opts = {}, skipCache = false) {
    const auth = DependencySystem.modules.get('auth');
    const method = (opts.method || 'GET').toUpperCase();
    const unsafeVerb = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const normalizedUrl = normaliseUrl(url);

    // Build a dedup key, timestamp for formData to avoid collisions
    const bodyKey = opts.body instanceof FormData
        ? `[form-data-${Date.now()}]`
        : stableStringify(opts.body || {});
    const requestKey = `${method}-${normalizedUrl}-${bodyKey}`;

    if (!skipCache && method === 'GET' && pendingRequests.has(requestKey)) {
        if (APP_CONFIG.DEBUG) {
            console.debug(`[API] Dedup hit for: ${requestKey}`);
        }
        return pendingRequests.get(requestKey);
    }

    opts.headers = { Accept: 'application/json', ...(opts.headers || {}) };
    if (unsafeVerb && auth?.getCSRFToken) {
        const csrf = auth.getCSRFToken();
        if (csrf) opts.headers['X-CSRF-Token'] = csrf;
        else if (APP_CONFIG.DEBUG) console.warn(`[API] CSRF token unavailable for ${method} ${normalizedUrl}`);
    }

    // Serialize JSON body if not FormData
    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
        if (!opts.headers['Content-Type']) {
            opts.headers['Content-Type'] = 'application/json;charset=UTF-8';
        }
        if (opts.headers['Content-Type'].includes('application/json')) {
            try {
                opts.body = JSON.stringify(opts.body);
            } catch (err) {
                console.error('[API] Failed to stringify body:', err);
                return Promise.reject(new Error('Failed to serialize request body.'));
            }
        }
    }

    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error(`API Timeout (${APP_CONFIG.TIMEOUTS.API_REQUEST}ms)`)),
        APP_CONFIG.TIMEOUTS.API_REQUEST
    );
    opts.signal = controller.signal;

    const reqPromise = (async () => {
        try {
            if (APP_CONFIG.DEBUG) {
                console.debug(`[API] Requesting: ${method} ${normalizedUrl}`, opts.body ? 'with body' : '');
            }
            const resp = await fetch(normalizedUrl, opts);

            if (!resp.ok) {
                let errPayload = { message: `API Error: ${resp.status} ${resp.statusText}` };
                try {
                    const errorJson = await resp.clone().json();
                    const detail = errorJson.detail || errorJson.message;
                    if (detail) {
                        errPayload.message = typeof detail === 'string' ? detail : JSON.stringify(detail);
                    }
                    errPayload = { ...errPayload, ...errorJson };
                } catch {
                    // Attempt text fallback
                    try { errPayload.rawResponse = await resp.text(); } catch {/* ignore */ }
                }
                const error = new Error(errPayload.message);
                error.status = resp.status;
                error.data = errPayload;
                throw error;
            }

            if (resp.status === 204 || resp.headers.get('content-length') === '0') {
                return undefined;
            }

            if (resp.headers.get('content-type')?.includes('application/json')) {
                const json = await resp.json();
                if (json && typeof json === 'object' && json.status === 'success' && 'data' in json) {
                    return json.data;
                }
                return json;
            }
            return await resp.text();

        } catch (e) {
            if (e.name === 'AbortError') throw e;
            throw e;
        } finally {
            clearTimeout(timer);
            if (!skipCache && method === 'GET') {
                pendingRequests.delete(requestKey);
            }
        }
    })();

    if (!skipCache && method === 'GET') {
        pendingRequests.set(requestKey, reqPromise);
    }
    return reqPromise;
}

/** Displays notifications using the registered 'notificationHandler' module. */
function showNotification(message, type = 'info', duration = 5_000) {
    try {
        const notificationHandler = DependencySystem.modules.get('notificationHandler');
        if (notificationHandler?.show) {
            notificationHandler.show(message, type, { timeout: duration });
        } else if (APP_CONFIG.DEBUG) {
            const logMethod = type === 'error'
                ? console.error
                : type === 'warn'
                    ? console.warn
                    : console.log;
            logMethod(`[Notification Fallback] (${type}): ${message}`);
        }
    } catch (e) {
        console.error("[App] Error showing notification:", e);
        const logMethod = type === 'error'
            ? console.error
            : type === 'warn'
                ? console.warn
                : console.log;
        logMethod(`[Notification Critical Fallback] (${type}): ${message}`);
    }
}

/** Toggles element visibility by adding/removing a "hidden" class. */
function toggleElement(selectorOrElement, show) {
    try {
        const el = typeof selectorOrElement === 'string'
            ? document.querySelector(APP_CONFIG.SELECTORS[selectorOrElement] || selectorOrElement)
            : selectorOrElement;

        if (el instanceof HTMLElement) {
            el.classList.toggle('hidden', !show);
        } else if (APP_CONFIG.DEBUG && typeof selectorOrElement === 'string') {
            console.warn(
                `[App] toggleElement: Element not found for selector: ${APP_CONFIG.SELECTORS[selectorOrElement] || selectorOrElement
                }`
            );
        } else if (APP_CONFIG.DEBUG) {
            console.warn("[App] toggleElement: Invalid element passed:", selectorOrElement);
        }
    } catch (e) {
        console.error(`[App] Error in toggleElement for ${selectorOrElement}:`, e);
    }
}

/* ---------------------------------------------------------------------
 * SPA Router Patch (Ensures 'locationchange' event)
 * ------------------------------------------------------------------- */
(() => {
    if (history.pushState._patched) return;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    const fireLocationChange = () => {
        requestAnimationFrame(() => {
            try {
                window.dispatchEvent(new Event('locationchange'));
            } catch (e) {
                console.error('[App] Error dispatching locationchange event:', e);
            }
        });
    };

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        fireLocationChange();
    };
    history.pushState._patched = true;

    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        fireLocationChange();
    };
    history.replaceState._patched = true;

    window.addEventListener('popstate', fireLocationChange);

    if (APP_CONFIG.DEBUG) {
        console.debug('[App] SPA Router patched.');
    }
})();

/* ---------------------------------------------------------------------
 * Application Instance (Registered with DependencySystem)
 * ------------------------------------------------------------------- */
const app = {
    apiRequest,
    showNotification,
    get state() {
        return { ...appState };
    },
    getProjectId() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const urlProjectId = urlParams.get('project');
            if (urlProjectId && validateUUID(urlProjectId)) {
                return urlProjectId;
            }
            const pm = DependencySystem.modules.get('projectManager');
            if (pm?.currentProject?.id && validateUUID(pm.currentProject.id)) {
                return pm.currentProject.id;
            }
        } catch (e) {
            console.error('[App] Error getting project ID:', e);
        }
        return null;
    },
    validateUUID,
    navigateToConversation: async (conversationId) => {
        try {
            const chatManager = await waitFor('chatManager', null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
            if (!chatManager) throw new Error('Chat Manager dependency not available.');
            const success = await chatManager.loadConversation(conversationId);
            if (!success && APP_CONFIG.DEBUG) {
                console.warn(`[App] navigateToConversation: chatManager reported failure loading ${conversationId}`);
            }
            return success;
        } catch (err) {
            console.error('[App] navigateToConversation error:', err);
            showNotification(`Failed to load conversation: ${err.message}`, 'error');
            return false;
        }
    },
    config: Object.freeze({
        timeouts: { ...APP_CONFIG.TIMEOUTS },
        selectors: { ...APP_CONFIG.SELECTORS },
        debug: APP_CONFIG.DEBUG
    }),
    toggleElement
};

/* -------------------------------------------------------------------
 * Initialization Sequence
 * ------------------------------------------------------------------- */
async function init() {
    if (appState.initialized || appState.initializing) {
        if (APP_CONFIG.DEBUG) {
            console.info('[App] Initialization attempt skipped (already done or in progress).');
        }
        return appState.initialized;
    }
    console.log('[App] Initializing application...');
    appState.initializing = true;
    appState.currentPhase = 'starting';

    toggleElement('APP_LOADING_SPINNER', true);
    const initStartTime = performance.now();

    try {
        // Phase 0: Register core app object in DependencySystem
        appState.currentPhase = 'register_app';
        DependencySystem.register('app', app);
        Object.defineProperty(window, "app", {
            value: app,
            writable: false,
            configurable: false
        });
        if (APP_CONFIG.DEBUG) {
            console.debug('[App] Core app module registered.');
        }

        // Phase 1: Wait for essential systems (Auth, Events, Notifications)
        appState.currentPhase = 'waiting_core_deps';
        console.log('[App] Waiting for essential dependencies...');
        await waitFor(['auth', 'eventHandlers', 'notificationHandler'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (APP_CONFIG.DEBUG) {
            console.debug('[App] Essential dependencies loaded.');
        }

        // Phase 2: Initialize Core Non-UI Systems
        appState.currentPhase = 'init_core_systems';
        await initializeCoreSystems();

        // Phase 3: Initialize Authentication System
        appState.currentPhase = 'init_auth';
        await initializeAuthSystem();

        // Phase 4: Initialize UI Components
        appState.currentPhase = 'init_ui';
        await initializeUIComponents();

        // Phase 5: Register Global Listeners
        appState.currentPhase = 'registering_listeners';
        registerAppListeners();

        // Phase 6: Finalization
        appState.currentPhase = 'finalizing';
        appState.initialized = true;

        // Fire first navigation check
        handleNavigationChange();

        const initEndTime = performance.now();
        console.info(
            `[App] Initialization complete in ${(initEndTime - initStartTime).toFixed(2)} ms.`
        );
        document.dispatchEvent(new CustomEvent('appInitialized', { detail: { success: true } }));
        return true;

    } catch (err) {
        handleInitError(err);
        document.dispatchEvent(new CustomEvent('appInitialized', { detail: { success: false, error: err } }));
        return false;
    } finally {
        appState.initializing = false;
        toggleElement('APP_LOADING_SPINNER', false);
        appState.currentPhase = appState.initialized ? 'initialized' : 'failed';
        console.log(`[App] Final initialization state: ${appState.currentPhase}`);
    }
}

/** Initializes core non-UI modules. */
async function initializeCoreSystems() {
    console.log('[App] Initializing core systems...');

    // Modal Manager
    const modalManager = createModalManager();
    DependencySystem.register('modalManager', modalManager);

    // Project Modal (initialize if it has an init method)
    const projectModal = createProjectModal();
    if (typeof projectModal.init === 'function') {
        await projectModal.init();
    }
    DependencySystem.register('projectModal', projectModal);
    document.dispatchEvent(new Event('modalsLoaded'));

    // Project Manager
    const projectManager = createProjectManager();
    if (typeof projectManager.initialize === 'function') {
        await projectManager.initialize();
    }
    DependencySystem.register('projectManager', projectManager);

    console.log('[App] Core systems initialized.');
}

/** Initializes auth system and sets appState.isAuthenticated. */
async function initializeAuthSystem() {
    console.log('[App] Initializing authentication system...');
    const auth = DependencySystem.modules.get('auth');
    if (!auth) {
        throw new Error("[App] Auth module registered but instance not found.");
    }
    try {
        if (typeof auth.init === 'function') {
            await auth.init();
        }
        appState.isAuthenticated = auth.isAuthenticated();
        console.log(`[App] Initial authentication state: ${appState.isAuthenticated}`);
    } catch (err) {
        console.error('[App] Auth system initialization/check failed:', err);
        appState.isAuthenticated = false;
        showNotification('Authentication check failed.', 'error');
    }
}

/** Initializes UI components and registers them with DependencySystem. */
async function initializeUIComponents() {
    console.log('[App] Initializing UI components...');

    // Register potential component classes if others rely on them
    if (typeof ProjectDetailsComponent === 'function') {
        DependencySystem.register('ProjectDetailsComponent', ProjectDetailsComponent);
    }
    if (typeof ProjectListComponent === 'function') {
        DependencySystem.register('ProjectListComponent', ProjectListComponent);
    }
    if (window.FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', window.FileUploadComponent);
    }

    // Create and register the main dashboard
    const projectDashboard = createProjectDashboard();
    DependencySystem.register('projectDashboard', projectDashboard);

    // Create and register the project details component
    const projectDetailsComponent = createProjectDetailsComponent({
        onBack: async () => {
            try {
                const pd = await waitFor('projectDashboard');
                pd?.showProjectList?.();
            } catch (e) {
                console.error('[App] Error in onBack callback:', e);
                window.location.href = '/';
            }
        }
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponent);

    // Model Config & Dashboard Utils
    const modelConfig = createModelConfig();
    DependencySystem.register('modelConfig', modelConfig);

    const projectDashboardUtils = createProjectDashboardUtils();
    DependencySystem.register('projectDashboardUtils', projectDashboardUtils);

    // Chat Manager
    const chatManager = createChatManager();
    if (typeof chatManager.initialize === 'function') {
        chatManager.initialize = debounce(chatManager.initialize.bind(chatManager), 300);
    }
    DependencySystem.register('chatManager', chatManager);
    initChatExtensions();

    // Sidebar
    const sidebar = createSidebar();
    if (typeof sidebar.init === 'function') {
        await sidebar.init();
    }
    DependencySystem.register('sidebar', sidebar);

    // Knowledge Base
    const kbDeps = await waitFor(['auth', 'projectManager']);
    const knowledgeBaseComponent = createKnowledgeBaseComponent({
        apiRequest,
        auth: kbDeps.auth,
        projectManager: kbDeps.projectManager,
        showNotification
    });
    if (typeof knowledgeBaseComponent.initialize === 'function') {
        await knowledgeBaseComponent.initialize();
    }
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponent);

    // Initialize dashboard last
    if (typeof projectDashboard.initialize === 'function') {
        console.log('[App] Initializing ProjectDashboard instance...');
        await projectDashboard.initialize();
    }

    // Optional global enhancements
    if (typeof window.initAccessibilityEnhancements === 'function') {
        window.initAccessibilityEnhancements();
    }
    if (typeof window.initSidebarEnhancements === 'function') {
        window.initSidebarEnhancements();
    }

    console.log('[App] UI components initialized.');
}

/* ---------------------------------------------------------------------
 * Global Event Listeners
 * ------------------------------------------------------------------- */
function registerAppListeners() {
    console.log('[App] Registering global event listeners...');

    // SPA navigation changes
    window.addEventListener('locationchange', handleNavigationChange);

    // Auth State Change
    waitFor('auth', (auth) => {
        if (auth?.AuthBus?.addEventListener && !auth.AuthBus._appListenerAttached) {
            auth.AuthBus.addEventListener('authStateChanged', handleAuthStateChange);
            auth.AuthBus._appListenerAttached = true;
            console.log('[App] Attached authStateChanged listener to AuthBus.');
        } else if (!auth?.AuthBus?.addEventListener) {
            console.error('[App] Could not attach authStateChanged listener: AuthBus not available or invalid.');
        }
    }).catch(err => console.error('[App] Failed to wait for AuthBus:', err));

    // Chat initialization triggers
    setupChatInitializationTrigger();

    console.log('[App] Global event listeners registered.');
}

/**
 * Sets up debounced chat manager initialization on auth or project changes.
 */
function setupChatInitializationTrigger() {
    const requiredDeps = ['auth', 'chatManager', 'projectManager'];
    const debouncedInitChat = debounce(async () => {
        try {
            const deps = await waitFor(requiredDeps, null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT / 2);
            const projectId = app.getProjectId();
            if (deps.auth.isAuthenticated() && projectId && deps.chatManager?.initialize) {
                if (APP_CONFIG.DEBUG) {
                    console.log(`[App] Debounced chat init triggered. Project: ${projectId}`);
                }
                await deps.chatManager.initialize({ projectId });
            } else {
                if (APP_CONFIG.DEBUG) {
                    console.log(
                        `[App] Skipping debounced chat init. Auth: ${deps.auth?.isAuthenticated()}, Project: ${projectId}`
                    );
                }
                deps.chatManager?.clear?.();
            }
        } catch (err) {
            console.error('[App] Error during debounced chat initialization:', err);
        }
    }, 350);

    // Attach listeners once dependencies are ready
    waitFor(requiredDeps, (deps) => {
        if (deps.auth?.AuthBus && !deps.auth.AuthBus._chatInitListenerAttached) {
            deps.auth.AuthBus.addEventListener('authStateChanged', debouncedInitChat);
            deps.auth.AuthBus._chatInitListenerAttached = true;
        } else if (!deps.auth?.AuthBus) {
            console.error('[App] Cannot listen for auth changes for chat init: AuthBus missing.');
        }

        if (typeof deps.projectManager.addEventListener === 'function' && !deps.projectManager._chatInitListenerAttached) {
            // e.g., 'currentProjectChanged' event from projectManager
            deps.projectManager.addEventListener('currentProjectChanged', debouncedInitChat);
            deps.projectManager._chatInitListenerAttached = true;
        } else {
            console.warn('[App] projectManager lacks addEventListener for chat init triggers.');
        }

        console.log('[App] Chat re-initialization listeners attached.');
        debouncedInitChat(); // Check current state once
    }, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT * 2).catch(err =>
        console.error('[App] Failed setup for chat init triggers:', err)
    );
}

/* ---------------------------------------------------------------------
 * Navigation Logic
 * ------------------------------------------------------------------- */
async function handleNavigationChange() {
    if (!appState.initialized) {
        if (appState.initializing) {
            await new Promise(resolve => setTimeout(resolve, 150));
            if (!appState.initialized) {
                console.warn("[App] handleNavigationChange: Aborted, initialization didn't complete.");
                return;
            }
        } else {
            console.warn("[App] handleNavigationChange: Aborted, application not initialized.");
            return;
        }
    }

    console.log(`[App] Handling navigation change. URL: ${window.location.href}`);
    let projectDashboard;
    try {
        projectDashboard = await waitFor('projectDashboard', null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
    } catch (e) {
        console.error('[App] Project Dashboard unavailable for navigation:', e);
        showNotification('UI Navigation Error.', 'error');
        toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true);
        const errorEl = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (errorEl) {
            errorEl.textContent = 'Core UI component failed to load. Please refresh.';
        }
        return;
    }

    const url = new URL(window.location.href);
    const projectId = url.searchParams.get('project');

    // If not authenticated, show login prompt or message
    if (!appState.isAuthenticated) {
        console.log('[App] Navigation change: User not authenticated.');
        projectDashboard.showLoginRequiredMessage?.();
        return;
    }
    toggleElement('LOGIN_REQUIRED_MESSAGE', false);

    // Authenticated Routing
    try {
        if (projectId && validateUUID(projectId) && typeof projectDashboard.showProjectDetails === 'function') {
            console.log(`[App] Navigating to project details: ${projectId}`);
            await projectDashboard.showProjectDetails(projectId);
        } else if (typeof projectDashboard.showProjectList === 'function') {
            console.log('[App] Navigating to project list view (default/invalid project).');
            await projectDashboard.showProjectList();
        } else {
            console.warn('[App] Unhandled navigation or missing dashboard methods.');
            toggleElement('PROJECT_DETAILS_VIEW', false);
            toggleElement('PROJECT_LIST_VIEW', true);
        }
    } catch (navError) {
        console.error('[App] Error during navigation handling:', navError);
        showNotification(`Navigation failed: ${navError.message}`, 'error');
        if (typeof projectDashboard.showProjectList === 'function') {
            projectDashboard.showProjectList().catch(fberr =>
                console.error('[App] Fallback failed:', fberr)
            );
        }
    }
}

/* ---------------------------------------------------------------------
 * Auth State Change Handler
 * ------------------------------------------------------------------- */
async function handleAuthStateChange(event) {
    const { authenticated, username } = event?.detail || {};
    const newAuthState = !!authenticated;
    if (newAuthState === appState.isAuthenticated) return; // No change

    const previousAuthState = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    console.log(`[App] Auth state changed. Authenticated: ${appState.isAuthenticated}, User: ${username || 'N/A'}`);

    requestAnimationFrame(() => {
        toggleElement(APP_CONFIG.SELECTORS.AUTH_BUTTON, !appState.isAuthenticated);
        toggleElement(APP_CONFIG.SELECTORS.USER_MENU, appState.isAuthenticated);

        const authStatusSpan = document.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatusSpan = document.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatusSpan) {
            authStatusSpan.textContent = appState.isAuthenticated ? (username ?? 'Authenticated') : 'Not Authenticated';
        }
        // Optionally update userStatusSpan text or styling here
        if (APP_CONFIG.DEBUG) {
            console.log('[App] Updated auth UI elements.');
        }
    });

    // If essential modules are missing, log and notify
    let projectManager, projectDashboard, sidebar, chatManager;
    try {
        [projectManager, projectDashboard, sidebar, chatManager] = await Promise.all([
            waitFor('projectManager'),
            waitFor('projectDashboard'),
            waitFor('sidebar'),
            waitFor('chatManager')
        ]);
    } catch (e) {
        console.error('[App] Failed to get modules during auth state change:', e);
        showNotification('Failed to update UI after auth change.', 'error');
        return;
    }

    if (appState.isAuthenticated && !previousAuthState) {
        // --- User Logged IN ---
        console.log('[App] User logged in. Refreshing data/UI.');
        toggleElement('LOGIN_REQUIRED_MESSAGE', false);
        projectDashboard?.showProjectList?.();

        if (projectManager?.loadProjects) {
            try {
                const projects = await projectManager.loadProjects('all');
                console.log(`[App] Projects loaded after login: ${projects?.length || 0}`);
                if (sidebar?.renderProjects && Array.isArray(projects)) {
                    sidebar.renderProjects(projects);
                }
            } catch (err) {
                console.error('[App] Failed to load projects after login:', err);
                showNotification('Failed to load projects.', 'error');
            }
        } else {
            console.error('[App] Cannot load projects: projectManager/loadProjects missing.');
        }

    } else if (!appState.isAuthenticated && previousAuthState) {
        // --- User Logged OUT ---
        console.log('[App] User logged out. Clearing data/UI.');
        toggleElement('LOGIN_REQUIRED_MESSAGE', true);
        if (projectManager) {
            projectManager.currentProject = null;
        }
        localStorage.removeItem('selectedProjectId');
        projectDashboard?.showLoginRequiredMessage?.();
        sidebar?.clear?.();
        chatManager?.clear?.();
        handleNavigationChange();
    }
}

/* ---------------------------------------------------------------------
 * Fatal Initialization Error Handler
 * ------------------------------------------------------------------- */
function handleInitError(error) {
    console.error('[App] CRITICAL INITIALIZATION ERROR:', error);
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'failed';

    try {
        const message = `Application failed to start: ${error.message || 'Unknown error'}. Please refresh.`;
        showNotification(message, 'error', 15000);
    } catch (e) {
        console.error("[App] Failed to show init error notification:", e);
    }

    try {
        const errorContainer = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (errorContainer instanceof HTMLElement) {
            errorContainer.textContent = `Application Error: ${error.message || 'Unknown error'}. Please refresh.`;
            errorContainer.classList.remove('hidden');
        } else {
            alert(`Application Critical Error: ${error.message || 'Unknown error'}. Please refresh.`);
        }
    } catch (e) {
        console.error("[App] Failed to display fatal error in UI:", e);
    }

    toggleElement('APP_LOADING_SPINNER', false);
}

/* ---------------------------------------------------------------------
 * Application Kick-off
 * ------------------------------------------------------------------- */
function bootstrap() {
    if (window.appBootstrapCalled) return;
    window.appBootstrapCalled = true;

    if (!window.DependencySystem) {
        console.error("CRITICAL: DependencySystem not found. Bootstrap aborted.");
        document.body.innerHTML = `
            <div style="padding: 2em; text-align: center; color: red; font-family: sans-serif;">
                <strong>Application Critical Error:</strong> Core dependency system failed to load.
                Please refresh or contact support.
            </div>`;
        return;
    }

    const bootstrapStartTime = performance.now();
    console.log(`[App] Bootstrapping... (Timestamp: ${bootstrapStartTime.toFixed(2)})`);

    const startInit = () => {
        const time = performance.now();
        console.log(
            `[App] DOM ready/loaded. (Delay: ${(time - bootstrapStartTime).toFixed(2)} ms) Starting initialization...`
        );
        init().catch(err => console.error("[App] Unhandled error during async init:", err));
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startInit);
    } else {
        startInit();
    }
}

// Start the application bootstrap process
bootstrap();
