/**
 * app.js - Application Core (Refactored)
 *
 * Changes in this refactored version:
 * 1. Centralized event binding using eventHandlers (trackListener).
 * 2. Console logging wrapped with if (APP_CONFIG.DEBUG) checks.
 * 3. Added destroyApp() for cleanup in SPA contexts.
 * 4. Preserved core logic, but reorganized some sections for clarity.
 */

import * as globalUtils from './utils/globalUtils.js';
import { createModalManager, createProjectModal } from './modalManager.js';
import { MODAL_MAPPINGS } from './modalConstants.js';
import { createProjectManager } from './projectManager.js';
import { createProjectDashboard } from './projectDashboard.js';
import { ProjectListComponent } from './projectListComponent.js';
import { createProjectDetailsComponent } from './projectDetailsComponent.js';
import { createSidebar } from './sidebar.js';
import { createModelConfig } from './modelConfig.js';
import { createProjectDashboardUtils } from './projectDashboardUtils.js';
import { createChatManager } from './chat.js';
import { createKnowledgeBaseComponent } from './knowledgeBaseComponent.js';
import { createChatExtensions } from './chatExtensions.js';
import FileUploadComponent from './FileUploadComponent.js';
import * as formatting from './formatting.js';
import * as accessibilityUtils from './accessibility-utils.js';
import { createNotificationHandler } from './notification-handler.js';
import { createEventHandlers } from './eventHandler.js';
import { createAuthModule } from './auth.js';

// ---------------------------------------------------------------------
// DependencySystem check
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Local app config & state
// ---------------------------------------------------------------------
const APP_CONFIG = {
    DEBUG: window.location.hostname === 'localhost' || window.location.search.includes('debug=1'),
    TIMEOUTS: {
        INITIALIZATION: 15000,
        AUTH_CHECK: 5000,
        API_REQUEST: 10000,
        COMPONENT_LOAD: 5000,
        DEPENDENCY_WAIT: 10000
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
        PROJECT_KNOWLEDGE_BASE: '/api/projects/{projectId}/knowledge_base'
    },
    SELECTORS: {
        MAIN_SIDEBAR: '#mainSidebar',
        NAV_TOGGLE_BTN: '#navToggleBtn',
        SIDEBAR_PROJECTS: '#sidebarProjects',
        AUTH_BUTTON: '#authButton',
        USER_MENU_BUTTON: '#userMenuButton',
        USER_MENU: '#userMenu',
        PROJECT_LIST_VIEW: '#projectListView',
        PROJECT_DETAILS_VIEW: '#projectDetailsView',
        LOGIN_REQUIRED_MESSAGE: '#loginRequiredMessage',
        APP_LOADING_SPINNER: '#appLoading',
        APP_FATAL_ERROR: '#appFatalError',
        AUTH_STATUS_SPAN: '#authStatus',
        USER_STATUS_SPAN: '#userStatus'
    }
};

const appState = {
    initialized: false,
    initializing: false,
    currentPhase: 'idle',
    isAuthenticated: false
};

// ---------------------------------------------------------------------
// PendingRequests map & Deduplicated API request
// ---------------------------------------------------------------------
const pendingRequests = new Map();

async function apiRequest(url, opts = {}, skipCache = false) {
    const method = (opts.method || "GET").toUpperCase();

    // If GET and not forced to skip, check dedup logic
    if (!skipCache && method === "GET") {
        if (globalUtils.shouldSkipDedup(url)) {
            skipCache = true;
        }
    }

    const auth = DependencySystem.modules.get("auth");
    const unsafeVerb = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const normalizedUrl = globalUtils.normaliseUrl(url);

    // Body dedup key
    const bodyKey = opts.body instanceof FormData
        ? `[form-data-${Date.now()}]`
        : globalUtils.stableStringify(opts.body || {});
    const requestKey = `${method}-${normalizedUrl}-${bodyKey}`;

    // If GET and a matching request is in flight, return the same promise
    if (!skipCache && method === "GET" && pendingRequests.has(requestKey)) {
        if (APP_CONFIG.DEBUG) {
            console.debug(`[API] Dedup hit for: ${requestKey}`);
        }
        return pendingRequests.get(requestKey);
    }

    opts.headers = { Accept: "application/json", ...(opts.headers || {}) };

    // Inject CSRF if needed
    if (unsafeVerb && auth?.getCSRFToken) {
        const csrf = auth.getCSRFToken();
        if (csrf) {
            opts.headers["X-CSRF-Token"] = csrf;
        } else if (APP_CONFIG.DEBUG) {
            console.warn(`[API] CSRF token unavailable for ${method} ${normalizedUrl}`);
        }
    }

    // If the body is a plain object, convert to JSON
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
        if (!opts.headers["Content-Type"]) {
            opts.headers["Content-Type"] = "application/json;charset=UTF-8";
        }
        if (opts.headers["Content-Type"].includes("application/json")) {
            try {
                opts.body = JSON.stringify(opts.body);
            } catch (err) {
                console.error("[API] Failed to stringify body:", err);
                return Promise.reject(new Error("Failed to serialize request body."));
            }
        }
    }

    // Setup fetch timeout
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error(`API Timeout (${APP_CONFIG.TIMEOUTS.API_REQUEST}ms)`)),
        APP_CONFIG.TIMEOUTS.API_REQUEST
    );
    opts.signal = controller.signal;

    const reqPromise = (async () => {
        try {
            if (APP_CONFIG.DEBUG) {
                console.debug(`[API] Requesting: ${method} ${normalizedUrl}`, opts.body ? "with body" : "");
            }
            const resp = await fetch(normalizedUrl, opts);

            if (!resp.ok) {
                let errPayload = {
                    message: `API Error: ${resp.status} ${resp.statusText}`
                };
                try {
                    const errorJson = await resp.clone().json();
                    const detail = errorJson.detail || errorJson.message;
                    if (detail) {
                        errPayload.message = typeof detail === 'string'
                            ? detail
                            : JSON.stringify(detail);
                    }
                    errPayload = { ...errPayload, ...errorJson };
                } catch {
                    try {
                        errPayload.rawResponse = await resp.text();
                    } catch {
                        // ignored
                    }
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

// ---------------------------------------------------------------------
// Wrapper: showNotification
// ---------------------------------------------------------------------
function showNotification(message, type = 'info', duration = 5000) {
    if (APP_CONFIG.DEBUG) {
        console.debug(`[App] showNotification: ${message} (type: ${type}, duration: ${duration})`);
    }
    globalUtils.showNotification(message, type, duration);
}

// ---------------------------------------------------------------------
// Wrapper: toggleElement
// Additional logic for translating string selector keys to APP_CONFIG.SELECTORS
// ---------------------------------------------------------------------
function toggleElement(selectorOrElement, show) {
    try {
        const resolvedSelector = APP_CONFIG.SELECTORS[selectorOrElement] || selectorOrElement;
        globalUtils.toggleElement(resolvedSelector, show);
    } catch {
        // renderAuthHeader error
    }
}

// ---------------------------------------------------------------------
// Create & register modules
// ---------------------------------------------------------------------
DependencySystem.register('apiRequest', apiRequest);

const notificationHandler = createNotificationHandler({ DependencySystem });
/**
 * Compatibility shim: Add .log/.warn/.error/.confirm to the notification handler for legacy consumers.
 */
function createNotificationShim(h) {
    return {
        ...h,
        log: (...args) => h.show?.(args[0], "info", args[1] || {}),
        warn: (...args) => h.show?.(args[0], "warning", args[1] || {}),
        error: (...args) => h.show?.(args[0], "error", args[1] || {}),
        confirm: (...args) => h.show?.(args[0], "info", { ...args[1], action: "Confirm" }),
    };
}
const notificationHandlerWithLog = createNotificationShim(notificationHandler);
DependencySystem.register('notificationHandler', notificationHandler);
DependencySystem.register('modalMapping', MODAL_MAPPINGS);

/**
 * Per-component notification handler with .log/.warn/.error/.confirm,
 * mapped for compatibility with legacy component APIs.
 * Each handler only affects notifications in its own container.
 */
function createBannerHandlerWithLog(containerSelector) {
    const container = typeof containerSelector === "string"
        ? document.querySelector(containerSelector)
        : containerSelector;
    const h = createNotificationHandler({ container });

    // Map to expected log/warn/error/confirm for compatibility
    return {
        log: (...args) => h.show?.(args[0], "info", args[1] || {}),
        warn: (...args) => h.show?.(args[0], "warning", args[1] || {}),
        error: (...args) => h.show?.(args[0], "error", args[1] || {}),
        confirm: (...args) => h.show?.(args[0], "info", { ...args[1], action: "Confirm" })
    };
}

const eventHandlers = createEventHandlers({ DependencySystem });
DependencySystem.register('eventHandlers', eventHandlers);

/**
 * The main "app" object, with references to core config/state and key methods.
 */
const app = {
    apiRequest,
    showNotification,
    validateUUID: globalUtils.isValidProjectId,
    get state() {
        return { ...appState };
    },
    getProjectId() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const urlProjectId = urlParams.get('project');
            if (urlProjectId && globalUtils.isValidProjectId(urlProjectId)) {
                return urlProjectId;
            }
            const pm = DependencySystem.modules.get('projectManager');
            if (pm?.currentProject?.id && globalUtils.isValidProjectId(pm.currentProject.id)) {
                return pm.currentProject.id;
            }
        } catch {
            // ignored
        }
        return null;
    },
    isValidProjectId: globalUtils.isValidProjectId,

    navigateToConversation: async (conversationId) => {
        try {
            const [chatManager] = await waitFor(['chatManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
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
DependencySystem.register('app', app);

// ---------------------------------------------------------------------
// Register sanitizer and storage services for modular DI
// ---------------------------------------------------------------------
/**
 * storageService: abstraction over localStorage for modularity and testability.
 * All storage usage should be via this object—not window.localStorage directly.
 */
const storageService = {
    getItem(key) {
        try {
            return window.localStorage.getItem(key);
        } catch {
            // ignored
            return null;
        }
    },
    setItem(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (e) {
            if (APP_CONFIG.DEBUG) {
                console.warn('[storageService] setItem failed', { key, value, e });
            }
        }
    },
    removeItem(key) {
        try {
            window.localStorage.removeItem(key);
        } catch (e) {
            if (APP_CONFIG.DEBUG) {
                console.warn('[storageService] removeItem failed', { key, e });
            }
        }
    },
    clear() {
        try {
            window.localStorage.clear();
        } catch (e) {
            if (APP_CONFIG.DEBUG) {
                console.warn('[storageService] clear failed', { e });
            }
        }
    },
    key(n) {
        try {
            return window.localStorage.key(n);
        } catch (e) {
            if (APP_CONFIG.DEBUG) {
                console.warn('[storageService] key failed', { n, e });
            }
            return null;
        }
    },
    get length() {
        try {
            return window.localStorage.length;
        } catch (e) {
            if (APP_CONFIG.DEBUG) {
                console.warn('[storageService] length getter failed', { });
            }
            return 0;
        }
    }
};
DependencySystem.register('storage', storageService);

/**
 * sanitizer: abstraction for DOM sanitizer, now directly imported via ESM for DI (no globals).
 */
import DOMPurify from './vendor/dompurify.es.js';
DependencySystem.register('sanitizer', DOMPurify);
DependencySystem.register('DOMPurify', DOMPurify);

// ---------------------------------------------------------------------
// Protect chatManager from accidental overwrites
// ---------------------------------------------------------------------
(function patchDependencySystem(ds) {
    const originalRegister = ds.register.bind(ds);
    ds.register = function (key, value) {
        if (key === 'chatManager' && ds.modules.has('chatManager')) {
            const current = ds.modules.get('chatManager');
            if (current && typeof current.loadConversation === 'function') {
                if (APP_CONFIG.DEBUG) {
                    console.warn('[App] Prevented overwriting of valid chatManager instance.');
                }
                return current;
            }
        }
        return originalRegister(key, value);
    };
})(DependencySystem);

const chatManager = createChatManager({
    DependencySystem,
    apiRequest,
    auth: () => DependencySystem.modules.get('auth'),
    eventHandlers,
    app,
    domAPI: {
        querySelector: (selector) => document.querySelector(selector),
        getElementById: (id) => document.getElementById(id),
        querySelectorAll: (selector) => document.querySelectorAll(selector),
        appendChild: (parent, child) => parent && child && parent.appendChild(child),
        replaceChildren: (parent, ...children) => parent && parent.replaceChildren(...children),
        createElement: (tag) => document.createElement(tag),
        removeChild: (parent, child) => parent && child && parent.removeChild(child),
        setInnerHTML: (el, html) => { if (el) el.innerHTML = html; }
    },
    navAPI: {
        getSearch: () => window.location.search,
        getHref: () => window.location.href,
        pushState: (url) => window.history.pushState({}, '', url),
        getPathname: () => window.location.pathname
    },
    isValidProjectId: globalUtils.isValidProjectId,
    isAuthenticated: () => {
        try {
            const authModule = DependencySystem.modules.get('auth');
            return typeof authModule?.isAuthenticated === 'function'
                ? authModule.isAuthenticated()
                : false;
        } catch (e) {
            return false;
        }
    },
    DOMPurify: DependencySystem.modules.get('sanitizer')
});
if (!chatManager || typeof chatManager.initialize !== 'function') {
    throw new Error('[App] createChatManager() did not return a valid ChatManager instance.');
}
DependencySystem.register('chatManager', chatManager);

// Double-check registration
let regChatManager = DependencySystem.modules.get('chatManager');
if (regChatManager === createChatManager || typeof regChatManager.loadConversation !== 'function') {
    console.error('[App] ERROR: chatManager registered incorrectly – fixing.');
    DependencySystem.modules.delete('chatManager');
    DependencySystem.register('chatManager', chatManager);
}

// ---------------------------------------------------------------------
// Bootstrap & application initialization
// ---------------------------------------------------------------------
function bootstrap() {
    // Use eventHandlers to track DOMContentLoaded if needed
    if (document.readyState === 'loading') {
        eventHandlers.trackListener(
            document,
            'DOMContentLoaded',
            () => {
                onReady();
            },
            { description: 'App DOMContentLoaded' }
        );
    } else {
        onReady();
    }
}
bootstrap();

/**
 * Called when DOM is ready. Proceeds with init.
 */
function onReady() {
    if (APP_CONFIG.DEBUG) {
        console.log(`[App] DOM ready. Starting init...`);
    }
    init().catch(err => {
        console.error("[App] Unhandled error during async init:", err);
    });
}

/**
 * Main initialization sequence
 * @returns {Promise<boolean>} success or failure
 */
async function init() {
    if (appState.initialized || appState.initializing) {
        if (APP_CONFIG.DEBUG) {
            console.info('[App] Initialization attempt skipped (already done or in progress).');
        }
        return appState.initialized;
    }
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Initializing application...');
    }
    appState.initializing = true;
    appState.currentPhase = 'starting';

    toggleElement('APP_LOADING_SPINNER', true);
    const initStartTime = performance.now();

    try {
        appState.currentPhase = 'init_core_systems';
        await initializeCoreSystems();

        appState.currentPhase = 'waiting_core_deps';
        if (APP_CONFIG.DEBUG) {
            console.log('[App] Waiting for essential dependencies...');
        }
        await waitFor(['auth', 'eventHandlers', 'notificationHandler'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);

        appState.currentPhase = 'init_auth';
        await initializeAuthSystem();

        appState.currentPhase = 'init_ui';
        await initializeUIComponents();

        appState.currentPhase = 'registering_listeners';
        registerAppListeners();

        appState.currentPhase = 'finalizing';
        appState.initialized = true;

        // Additional expansions after core init
        try {
            const eh = DependencySystem.modules.get('eventHandlers');
            eh?.init?.();
            DependencySystem.modules.get('modelConfig')?.initializeUI?.();
            // No calls to .init() or .initialize() here; handled explicitly in initializeUIComponents only
        } catch (err) {
            console.warn('[App] Post-initialization safety net failed:', err);
        }

        handleNavigationChange();

        const initEndTime = performance.now();
        if (APP_CONFIG.DEBUG) {
            console.info(
                `[App] Initialization complete in ${(initEndTime - initStartTime).toFixed(2)} ms.`
            );
        }
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
        if (APP_CONFIG.DEBUG) {
            console.log(`[App] Final initialization state: ${appState.currentPhase}`);
        }
    }
}

/**
 * Cleanly tear down the app, removing event listeners and resetting state.
 * Useful if the SPA fully re-initializes or navigates away, etc.
 */
export function destroyApp() {
    if (APP_CONFIG.DEBUG) {
        console.log('[App] destroyApp() called. Cleaning up listeners and states...');
    }
    // Remove all tracked event listeners
    eventHandlers.cleanupListeners();

    // Destroy accessibility enhancements if needed
    accessibilityUtils.destroyAccessibilityEnhancements?.();

    // Clear chat manager if desired
    const chatMgr = DependencySystem.modules.get('chatManager');
    chatMgr?.clear?.();

    // Reset app state flags
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'destroyed';
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Application teardown complete.');
    }
}

// ---------------------------------------------------------------------
// Core Systems Initialization
// ---------------------------------------------------------------------
async function initializeCoreSystems() {
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Initializing core systems...');
    }
    const modalManager = createModalManager();
    DependencySystem.register('modalManager', modalManager);

    const [apiRequestMod, eventHandlersMod, notificationHandlerMod, modalManagerMod] =
        await DependencySystem.waitFor(['apiRequest', 'eventHandlers', 'notificationHandler', 'modalManager']);

    const auth = createAuthModule({
        apiRequest: apiRequestMod,
        eventHandlers: eventHandlersMod,
        showNotification: notificationHandlerMod?.show,
        modalManager: modalManagerMod
    });
    DependencySystem.register('auth', auth);

    const chatMgrInstance = DependencySystem.modules.get('chatManager');
    if (!chatMgrInstance || typeof chatMgrInstance.initialize !== 'function') {
        throw new Error('[App] chatManager registration: not a valid instance with "initialize".');
    }

    const projectManager = createProjectManager({
        DependencySystem,
        chatManager: chatMgrInstance,
        app,
        notificationHandler: notificationHandlerWithLog,
        storage: DependencySystem.modules.get('storage'),
        listenerTracker: {
            add: (target, event, handler, description) =>
                eventHandlers.trackListener(target, event, handler, {
                    description: description || `[ProjectManager] ${event} on ${target?.id || target}`
                }),
            remove: (target, event, handler) => {
                if (eventHandlers.cleanupListeners) {
                    eventHandlers.cleanupListeners(target, event, handler);
                }
            }
        }
    });
    DependencySystem.register('projectManager', projectManager);
    // Enhanced validation for projectManager
    if (typeof DependencySystem.modules.get('projectManager') === 'function') {
        console.error('[App] projectManager registration error: got a function instead of an instance');
        throw new Error('[App] projectManager registration: not a valid instance (got function)');
    }

    if (!projectManager || typeof projectManager.initialize !== 'function') {
        console.error('[App] projectManager invalid:', projectManager);
        throw new Error('[App] projectManager registration: not a valid instance with "initialize" method');
    }

    console.log('[App] projectManager validation passed');

    const projectModal = createProjectModal();
    DependencySystem.register('projectModal', projectModal);

    const modalsReady = new Promise(resolve =>
        document.addEventListener('modalsLoaded', resolve, { once: true })
    );
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Waiting for modal HTML to load...');
    }
    await modalsReady;
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Modal HTML loaded.');
    }

    if (typeof modalManager.init === 'function') {
        modalManager.init();
    } else {
        console.error('[App] modalManager.init function not found!');
    }

    if (typeof chatMgrInstance.initialize === 'function' && appState.isAuthenticated) {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] Initializing ChatManager (user already authenticated)…');
        }
        await chatMgrInstance.initialize();
    }

    if (typeof projectModal.init === 'function') {
        projectModal.init();
    } else {
        console.error('[App] projectModal.init function not found!');
    }

    if (typeof projectManager.initialize === 'function') {
        await projectManager.initialize();
    }

    if (typeof eventHandlersMod?.init === 'function') {
        eventHandlersMod.init();
    }

    if (APP_CONFIG.DEBUG) {
        console.log('[App] Core systems initialized.');
    }
}

// ---------------------------------------------------------------------
// Authentication Initialization and Handler
// ---------------------------------------------------------------------
async function initializeAuthSystem() {
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Initializing authentication system...');
    }
    const auth = DependencySystem.modules.get('auth');
    if (!auth || typeof auth.init !== 'function') {
        throw new Error("[App] Auth module is missing or invalid in DependencySystem.");
    }
    try {
        await auth.init();
        if (!auth.isAuthenticated || typeof auth.isAuthenticated !== 'function') {
            throw new Error("[App] Auth module does not provide isAuthenticated().");
        }
        appState.isAuthenticated = auth.isAuthenticated();
        if (APP_CONFIG.DEBUG) {
            console.log(`[App] Initial authentication state: ${appState.isAuthenticated}`);
        }

        const bus = auth.AuthBus;
        if (bus && typeof bus.addEventListener === 'function') {
            bus.addEventListener('authStateChanged', () => {
                appState.isAuthenticated = auth.isAuthenticated();
                renderAuthHeader();
            });
        }
        renderAuthHeader();
    } catch (err) {
        console.error('[App] Auth system initialization/check failed:', err);
        appState.isAuthenticated = false;
        showNotification(`Authentication check failed: ${err.message}`, 'error');
        throw new Error(`[App] initializeAuthSystem failed: ${err.message}`);
    }
}

// ---------------------------------------------------------------------
// UI Components Initialization
// ---------------------------------------------------------------------
let _uiComponentsInitialized = false;
async function initializeUIComponents() {
    if (_uiComponentsInitialized) {
        if (APP_CONFIG.DEBUG) {
            console.warn('[App] initializeUIComponents called twice, skipping.');
        }
        return;
    }
    _uiComponentsInitialized = true;
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Initializing UI components...');
    }

    // Wait until required deps AND DOM containers are present
    await globalUtils.waitForDepsAndDom({
        deps: ['projectManager', 'eventHandlers', 'modalManager'],
        domSelectors: ['body'],
        DependencySystem
    });

    let projectListView = document.getElementById('projectListView');
    let projectDetailsView = document.getElementById('projectDetailsView');
    if (!projectListView) {
        projectListView = document.createElement('div');
        projectListView.id = 'projectListView';
        projectListView.className = 'w-full';
        document.body.appendChild(projectListView);
    }
    if (!projectDetailsView) {
        projectDetailsView = document.createElement('div');
        projectDetailsView.id = 'projectDetailsView';
        projectDetailsView.className = 'w-full hidden';
        document.body.appendChild(projectDetailsView);
    }

    // Inject /static/html/project_list.html
    if (!document.getElementById('projectList')) {
        try {
            const resp = await fetch('/static/html/project_list.html', { cache: 'reload' });
            if (!resp.ok) {
                throw new Error(`[UI] Failed to fetch project_list.html: HTTP ${resp.status}`);
            }
            const html = await resp.text();
            if (!html || !html.includes('id="projectList"')) {
                throw new Error('[UI] Fetched project_list.html missing required #projectList element.');
            }
            projectListView.innerHTML = html;
            if (!document.getElementById('projectList')) {
                showNotification(
                    'Static /static/html/project_list.html inject failed (missing #projectList)!',
                    'error', 10000
                );
                throw new Error('Injected /static/html/project_list.html but #projectList is still missing!');
            }
        } catch (err) {
            showNotification(`Failed to load project list UI: ${err.message}`, "error", 10000);
            throw err;
        }
    }

    // Inject /static/html/project_details.html
    if (!document.getElementById('projectDetails')) {
        try {
            const resp = await fetch('/static/html/project_details.html', { cache: 'reload' });
            if (!resp.ok) {
                throw new Error(`[UI] Failed to fetch project_details.html: HTTP ${resp.status}`);
            }
            const html = await resp.text();
            if (!html || !html.includes('id="projectDetails"')) {
                throw new Error('[UI] Fetched project_details.html missing required #projectDetails element.');
            }
            projectDetailsView.innerHTML = html;
            if (!document.getElementById('projectDetails')) {
                showNotification(
                    'Static /static/html/project_details.html inject failed (missing #projectDetails)!',
                    'error', 10000
                );
                throw new Error('Injected /static/html/project_details.html but #projectDetails is still missing!');
            }
            } catch (err) {
                showNotification(`Failed to load project details UI: ${err.message}`, "error", 10000);
                throw err;
            }
        }

    const projectManager = DependencySystem.modules.get('projectManager');
    const modalManager = DependencySystem.modules.get('modalManager');

    setTimeout(() => {
        window.setupLoginButtonHandler?.(eventHandlers, modalManager);
    }, 0);

    // Register FileUploadComponent
    if (FileUploadComponent) {
        DependencySystem.register('FileUploadComponent', FileUploadComponent);
    }

    // Chat Extensions
    const chatExtensions = createChatExtensions({
        DependencySystem,
        eventHandlers,
        notificationHandler: notificationHandler.show.bind(notificationHandler)
    });
    DependencySystem.register('chatExtensions', chatExtensions);

    // Model Config
    const modelConfig = createModelConfig();
    DependencySystem.register('modelConfig', modelConfig);

    // Project Dashboard Utils
    const projectDashboardUtils = createProjectDashboardUtils({ DependencySystem });
    DependencySystem.register('projectDashboardUtils', projectDashboardUtils);

    // Project List Component
    const projectListNotificationHandlerRaw = createBannerHandlerWithLog('#projectListView');
    const projectListNotificationHandler = {
        log: (...args) => projectListNotificationHandlerRaw.log?.(...args),
        warn: (...args) => projectListNotificationHandlerRaw.warn?.(...args),
        error: (...args) => projectListNotificationHandlerRaw.error?.(...args),
        confirm: (...args) => projectListNotificationHandlerRaw.confirm?.(...args)
    };
    const projectListComponent = new ProjectListComponent({
        projectManager,
        eventHandlers,
        modalManager,
        app,
        router: {
            navigate: (url) => {
                window.history.pushState({}, '', url);
                window.dispatchEvent(new Event('locationchange'));
            },
            getURL: () => window.location.href
        },
        notificationHandler: projectListNotificationHandler,
        storage: DependencySystem.modules.get('storage'),
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('projectListComponent', projectListComponent);

    // Project Dashboard
    if (DependencySystem.modules.get('projectDashboard') === createProjectDashboard) {
        DependencySystem.modules.delete('projectDashboard');
    }
    const projectDashboard = createProjectDashboard(DependencySystem);
    DependencySystem.register('projectDashboard', projectDashboard);

    // Project Details Component
    const projectDetailsNotificationHandler = createBannerHandlerWithLog('#projectDetailsView');
    const projectDetailsComponent = createProjectDetailsComponent({
        onBack: async () => {
            try {
                const pd = await DependencySystem.waitFor('projectDashboard');
                pd?.showProjectList?.();
        } catch {
            // Error getting project ID
        }
        return null;
    },
        app,
        projectManager,
        eventHandlers,
        modalManager,
        FileUploadComponentClass: DependencySystem.modules.get('FileUploadComponent'),
        router: {
            navigate: (url) => {
                window.history.pushState({}, '', url);
                window.dispatchEvent(new Event('locationchange'));
            },
            getURL: () => window.location.href
        },
        notificationHandler: projectDetailsNotificationHandler,
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('projectDetailsComponent', projectDetailsComponent);

    // Sidebar
    const sidebar = createSidebar({
        DependencySystem,
        eventHandlers,
        app,
        projectDashboard,
        projectManager,
        storageAPI: DependencySystem.modules.get('storage'),
        viewportAPI: {
            getInnerWidth: () => window.innerWidth
        },
      domAPI: {
          getElementById: (id) => document.getElementById(id),
          createElement: (tag) => document.createElement(tag),
          querySelector: (selector) => document.querySelector(selector),
          getActiveElement: () => document.activeElement,
          ownerDocument: document,
          body: document.body
      }
    });
    DependencySystem.register('sidebar', sidebar);

    // Register other utilities
    DependencySystem.register('utils', globalUtils);
    DependencySystem.register('formatting', formatting);
    DependencySystem.register('accessibilityUtils', accessibilityUtils);

    // Knowledge Base Component
    const knowledgeBaseComponent = createKnowledgeBaseComponent({
        DependencySystem,
        apiRequest,
        auth: DependencySystem.modules.get('auth'),
        projectManager,
        showNotification,
        uiUtils: globalUtils,
        sanitizer: DependencySystem.modules.get('sanitizer')
    });
    DependencySystem.register('knowledgeBaseComponent', knowledgeBaseComponent);

    // Initialize new components
    if (typeof sidebar.init === 'function') {
        await sidebar.init();
    }
    chatExtensions.init();
    if (modelConfig?.initializeUI) {
        modelConfig.initializeUI();
    }
    if (typeof knowledgeBaseComponent.initialize === 'function') {
        await knowledgeBaseComponent.initialize();
    }
    if (typeof projectDashboard.initialize === 'function') {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] Initializing ProjectDashboard instance...');
        }
        await projectDashboard.initialize();
    }
    const projectListComp = DependencySystem.modules.get('projectListComponent');
    if (projectListComp?.initialize) {
        await projectListComp.initialize();
    }
    const projectDetailsComp = DependencySystem.modules.get('projectDetailsComponent');
    if (projectDetailsComp?.initialize) {
        await projectDetailsComp.initialize();
    }

    if (appState.isAuthenticated) {
        if (projectManager?.loadProjects) {
            console.log('[App] Calling projectManager.loadProjects from initializeUIComponents');
            projectManager.loadProjects('all').catch(err => {
                console.error('[App] Failed to load projects during initialization:', err);
                showNotification('Failed to load projects. Please try refreshing.', 'error');
            });
        } else {
            console.error('[App] projectManager or loadProjects method not available:', projectManager);
            showNotification('Project manager initialization issue. Please try refreshing.', 'error');
        }
    } else {
        console.warn('[App] Not authenticated, skipping initial project load');
    }

    // Optionally initialize accessibility extras
    if (typeof window.initAccessibilityEnhancements === 'function') {
        window.initAccessibilityEnhancements();
    }
    // Additional optional enhancements for the sidebar
    if (typeof window.initSidebarEnhancements === 'function') {
        window.initSidebarEnhancements();
    }

    if (APP_CONFIG.DEBUG) {
        console.log('[App] UI components initialized.');
    }
}

// ---------------------------------------------------------------------
// Auth header rendering
// ---------------------------------------------------------------------
function renderAuthHeader() {
    try {
        const authMod = DependencySystem.modules.get('auth');
        const isAuth = typeof authMod?.isAuthenticated === 'function' && authMod.isAuthenticated();
        const btn = document.querySelector(APP_CONFIG.SELECTORS.AUTH_BUTTON) || document.querySelector('#loginButton');
        if (btn) {
            btn.textContent = isAuth ? 'Logout' : 'Login';
            btn.onclick = (e) => {
                e.preventDefault();
                if (isAuth) {
                    authMod.logout();
                } else {
                    const modal = DependencySystem.modules.get('modalManager');
                    if (modal?.show) modal.show('login');
                }
            };
        }
        const authStatus = document.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = document.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) authStatus.textContent = isAuth ? 'Signed in' : 'Not signed in';
        if (userStatus) userStatus.textContent = isAuth ? `Hello, ${authMod.getCurrentUser()}` : '';
    } catch {
        // renderAuthHeader error
    }
}

// ---------------------------------------------------------------------
// Global event listeners & chat init triggers
// ---------------------------------------------------------------------
function registerAppListeners() {
    if (APP_CONFIG.DEBUG) {
        console.log('[App] Registering global event listeners...');
    }

    waitFor(['auth', 'chatManager', 'projectManager'], () => {
        attachAuthBusListener('authStateChanged', handleAuthStateChange, '_globalAuthStateChangedAttached');
        setupChatInitializationTrigger();
        // locationchange or other global events can be tracked here:
        eventHandlers.trackListener(window, 'locationchange', handleNavigationChange, {
            description: 'Global locationchange event'
        });
    }).catch(err => console.error('[App] Failed to wait for dependencies:', err));

    if (APP_CONFIG.DEBUG) {
        console.log('[App] Global event listeners registered.');
    }
}

function setupChatInitializationTrigger() {
    const requiredDeps = ['auth', 'chatManager', 'projectManager'];

    const debouncedInitChat = globalUtils.debounce(async (arg = null) => {
        // Defensive: accept either a projectId or a CustomEvent from listeners
        let forceProjectId = arg;
        if (
            arg &&
            typeof arg === 'object' &&
            arg.detail &&
            arg.detail.project &&
            arg.detail.project.id
        ) {
            forceProjectId = arg.detail.project.id;
        }
        try {
            const [authMod, chatMgr, pm] = await waitFor(requiredDeps, null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT / 2);
            if (!authMod || !chatMgr) {
                if (APP_CONFIG.DEBUG) {
                    console.warn('[App] Chat init: Required dependency missing.', [authMod, chatMgr, pm]);
                }
                return;
            }
            if (typeof authMod.isAuthenticated !== "function") {
                if (APP_CONFIG.DEBUG) {
                    console.warn('[App] Chat init: auth.isAuthenticated is not a function.', authMod);
                }
                return;
            }

            const projectId = app.getProjectId();
            const finalProjectId = forceProjectId ?? projectId ?? pm?.currentProject?.id ?? null;

            if (authMod.isAuthenticated() && typeof chatMgr.initialize === "function") {
                if (APP_CONFIG.DEBUG) {
                    console.log(`[App] Debounced chat init triggered. Project: ${finalProjectId}`);
                }
                await chatMgr.initialize({ projectId: finalProjectId });
            } else {
                if (APP_CONFIG.DEBUG) {
                    console.log(
                        `[App] Skipping debounced chat init. Auth: ${authMod.isAuthenticated?.() ?? 'N/A'}, ` +
                        `Project: ${finalProjectId}`
                    );
                }
                chatMgr?.clear?.();
            }
        } catch (err) {
            console.error('[App] Error during debounced chat initialization:', err);
        }
    }, 350);

    waitFor(requiredDeps, () => {
        attachAuthBusListener('authStateChanged', debouncedInitChat, '_globalChatInitAuthAttached');
        if (!document._chatInitProjListenerAttached) {
            eventHandlers.trackListener(
                document,
                'currentProjectChanged',
                () => {
                    debouncedInitChat();
                },
                { description: 'Current project changed -> reinit chat' }
            );
            document._chatInitProjListenerAttached = true;
            if (APP_CONFIG.DEBUG) {
                console.warn('[App] Using eventHandlers for currentProjectChanged -> chat reinit listener.');
            }
        }
        eventHandlers.trackListener(
            document,
            'currentProjectReady',
            e => {
                debouncedInitChat(e.detail?.project?.id);
            },
            { description: 'Project ready -> reinit chat' }
        );
        debouncedInitChat();
    }, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT * 2).catch(
        err => console.error('[App] Failed setup for chat init triggers:', err)
    );
}

// ---------------------------------------------------------------------
// SPA Navigation
// ---------------------------------------------------------------------
let lastHandledProj = null;
let lastHandledChat = null;

async function handleNavigationChange() {
    if (!appState.initialized) {
        if (appState.initializing) {
            await new Promise(r => setTimeout(r, 150));
            if (!appState.initialized) {
                if (APP_CONFIG.DEBUG) {
                    console.warn("[App] handleNavigationChange: Aborted, initialization didn't complete.");
                }
                return;
            }
        } else {
            if (APP_CONFIG.DEBUG) {
                console.warn("[App] handleNavigationChange: Aborted, application not initialized.");
            }
            return;
        }
    }

    const currentUrl = window.location.href;
    if (APP_CONFIG.DEBUG) {
        console.log(`[App] Handling navigation change. URL: ${currentUrl}`);
    }
    let projectDashboard;
    try {
        [projectDashboard] = await waitFor(['projectDashboard'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
    } catch (e) {
        console.error('[App] Project Dashboard unavailable for navigation:', e);
        showNotification('UI Navigation Error.', 'error');
        toggleElement(APP_CONFIG.SELECTORS.APP_FATAL_ERROR, true);
        const errorEl = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (errorEl) errorEl.textContent = 'Core UI component failed to load. Please refresh.';
        return;
    }

    const url = new URL(currentUrl);
    const projectId = url.searchParams.get('project');
    const chatId = url.searchParams.get('chatId') || null;

    if (projectId === lastHandledProj && chatId === lastHandledChat) {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] handleNavigationChange: Same project/chat; skipping re-load.');
        }
        return;
    }
    lastHandledProj = projectId;
    lastHandledChat = chatId;

    if (!appState.isAuthenticated) {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] Navigation change: User not authenticated.');
        }
        projectDashboard.showLoginRequiredMessage?.();
        return;
    }
    toggleElement('LOGIN_REQUIRED_MESSAGE', false);

    try {
        const [projectManager] = await waitFor(['projectManager'], null, APP_CONFIG.TIMEOUTS.DEPENDENCY_WAIT);
        if (projectId && globalUtils.isValidProjectId(projectId)) {
            if (APP_CONFIG.DEBUG) {
                console.log(`[App] Ensuring project ${projectId} details are loaded before UI...`);
            }
            await projectManager.loadProjectDetails(projectId);
            if (typeof projectDashboard.showProjectDetails === 'function') {
                if (APP_CONFIG.DEBUG) {
                    console.log(`[App] Navigating to project details: ${projectId}, chatId=${chatId ?? 'none'}`);
                }
                await projectDashboard.showProjectDetails(projectId);
            }
        } else if (typeof projectDashboard.showProjectList === 'function') {
            if (APP_CONFIG.DEBUG) {
                console.log('[App] Navigating to project list view.');
            }
            await projectDashboard.showProjectList();
        } else {
            console.warn('[App] Unhandled navigation or missing dashboard methods.');
            toggleElement('PROJECT_DETAILS_VIEW', false);
            toggleElement('PROJECT_LIST_VIEW', true);
        }

        if (projectId && globalUtils.isValidProjectId(projectId) && chatId) {
            try {
                const success = await app.navigateToConversation(chatId);
                if (!success) {
                    console.warn("[App] Chat load failed for chatId:", chatId);
                }
            } catch (e) {
                console.warn("[App] Error loading chatId after project ready:", e);
            }
        }
    } catch (navError) {
        console.error('[App] Error during navigation handling:', navError);
        showNotification(`Navigation failed: ${navError.message}`, 'error');
        projectDashboard.showProjectList?.().catch(fb => console.error('[App] Fallback failed:', fb));
    }
}

// ---------------------------------------------------------------------
// AuthBus event handling
// ---------------------------------------------------------------------
function attachAuthBusListener(event, handler, markerGlobalName) {
    const bus = getAuthBus();
    if (!bus || typeof bus.addEventListener !== "function") {
        console.error('[App] Cannot attach listener: AuthBus missing or invalid.', bus);
        return false;
    }
    if (!window[markerGlobalName] || window[markerGlobalName] !== bus) {
        bus.addEventListener(event, handler);
        window[markerGlobalName] = bus;
        if (APP_CONFIG.DEBUG) {
            console.log(`[App] Attached ${event} listener to AuthBus (global marker ${markerGlobalName}).`);
        }
        return true;
    }
    return false;
}

function getAuthBus() {
    const auth = DependencySystem?.modules?.get('auth');
    return auth?.AuthBus;
}

async function handleAuthStateChange(event) {
    const { authenticated, username } = event?.detail || {};
    const newAuthState = !!authenticated;
    if (newAuthState === appState.isAuthenticated) return;

    const previousAuthState = appState.isAuthenticated;
    appState.isAuthenticated = newAuthState;
    if (APP_CONFIG.DEBUG) {
        console.log(`[App] Auth state changed. Authenticated: ${appState.isAuthenticated}, User: ${username || 'N/A'}`);
    }

    requestAnimationFrame(() => {
        toggleElement(APP_CONFIG.SELECTORS.AUTH_BUTTON, !appState.isAuthenticated);
        toggleElement(APP_CONFIG.SELECTORS.USER_MENU, appState.isAuthenticated);
        const authStatus = document.querySelector(APP_CONFIG.SELECTORS.AUTH_STATUS_SPAN);
        const userStatus = document.querySelector(APP_CONFIG.SELECTORS.USER_STATUS_SPAN);
        if (authStatus) {
            authStatus.textContent = appState.isAuthenticated ? (username ?? 'Authenticated') : 'Not Authenticated';
        }
        if (userStatus) {
            userStatus.textContent = appState.isAuthenticated ? (username ?? '') : '';
        }
        setTimeout(() => {
            window.setupLoginButtonHandler?.(DependencySystem.modules.get('eventHandlers'), DependencySystem.modules.get('modalManager'));
        }, 0);
    });

    let projectManager, projectDashboard, sidebar, chatManager, storage;
    try {
        [projectManager, projectDashboard, sidebar, chatManager, storage] = await Promise.all([
            waitFor('projectManager'),
            waitFor('projectDashboard'),
            waitFor('sidebar'),
            waitFor('chatManager'),
            waitFor('storage') // Wait for storage service
        ]);
    } catch (e) {
        console.error('[App] Failed to get modules during auth state change:', e);
        showNotification('Failed to update UI after auth change.', 'error');
        return;
    }

    if (appState.isAuthenticated && !previousAuthState) {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] User logged in. Refreshing data/UI.');
        }
        toggleElement('LOGIN_REQUIRED_MESSAGE', false);
        projectDashboard.showProjectList?.();
        if (projectManager.loadProjects) {
            try {
                const projects = await projectManager.loadProjects('all');
                if (APP_CONFIG.DEBUG) {
                    console.log(`[App] Projects loaded after login: ${projects.length}`);
                }
                sidebar.renderProjects?.(projects);
            } catch (err) {
                console.error('[App] Failed to load projects after login:', err);
                showNotification('Failed to load projects.', 'error');
            }
        }
    } else if (!appState.isAuthenticated && previousAuthState) {
        if (APP_CONFIG.DEBUG) {
            console.log('[App] User logged out. Clearing data/UI.');
        }
        toggleElement('LOGIN_REQUIRED_MESSAGE', true);
        projectManager.currentProject = null;
        storage.removeItem('selectedProjectId');
        projectDashboard.showLoginRequiredMessage?.();
        sidebar.clear?.();
        chatManager.clear?.();
        handleNavigationChange();
    }
}

// ---------------------------------------------------------------------
// Fatal Initialization Error Handler
// ---------------------------------------------------------------------
function handleInitError(error) {
    console.error('[App] CRITICAL INITIALIZATION ERROR:', error);
    appState.initialized = false;
    appState.initializing = false;
    appState.currentPhase = 'failed';

    try {
        showNotification(`Application failed to start: ${error.message}. Please refresh.`, 'error', 15000);
    } catch {
        // ignored
    }

    try {
        const container = document.querySelector(APP_CONFIG.SELECTORS.APP_FATAL_ERROR);
        if (container) {
            container.textContent = `Application Error: ${error.message}. Please refresh.`;
            container.classList.remove('hidden');
        } else {
            alert(`Application Critical Error: ${error.message}. Please refresh.`);
        }
    } catch {
        // ignored
    }
    toggleElement('APP_LOADING_SPINNER', false);
}
